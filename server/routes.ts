import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import multer from "multer";
import bcrypt from "bcrypt";
import passport from "./auth";
import { z } from "zod";
import { openRouterService } from "./services/openrouter";
import { cloudinaryService } from "./services/cloudinary";
import { insertPostSchema, insertScheduledPostSchema, insertSocialPageSchema, insertAiGenerationSchema, insertCloudinaryConfigSchema, insertOpenrouterConfigSchema, updateOpenrouterConfigSchema, insertUserSchema, postMedia } from "@shared/schema";
import type { User, InsertUser } from "@shared/schema";

const upload = multer({ storage: multer.memoryStorage() });

// Middleware pour vérifier l'authentification
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Non authentifié" });
  }
  next();
}

// Middleware pour vérifier le rôle admin
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Non authentifié" });
  }
  const user = req.user as User;
  if (user.role !== "admin") {
    return res.status(403).json({ error: "Accès refusé. Réservé aux administrateurs." });
  }
  next();
}

export async function registerRoutes(app: Express): Promise<Server> {

  // Routes d'authentification
  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: User | false, info: any) => {
      if (err) {
        return next(err);
      }
      if (!user) {
        return res.status(401).json({ error: info?.message || "Authentification échouée" });
      }
      req.logIn(user, (err) => {
        if (err) {
          return next(err);
        }
        return res.json({
          id: user.id,
          username: user.username,
          role: user.role,
        });
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ error: "Erreur lors de la déconnexion" });
      }
      res.json({ message: "Déconnecté avec succès" });
    });
  });

  app.get("/api/auth/session", (req, res) => {
    if (req.isAuthenticated()) {
      const user = req.user as User;
      res.json({
        id: user.id,
        username: user.username,
        role: user.role,
      });
    } else {
      res.status(401).json({ error: "Non authentifié" });
    }
  });

  // Route pour obtenir la liste de tous les utilisateurs (réservée aux admins)
  app.get("/api/users", requireAdmin, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      
      // Ne pas envoyer les mots de passe
      const safeUsers = allUsers.map(user => ({
        id: user.id,
        username: user.username,
        role: user.role,
      }));
      
      res.json(safeUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ error: "Erreur lors de la récupération des utilisateurs" });
    }
  });

  // Route pour créer un nouvel utilisateur (réservée aux admins)
  app.post("/api/users", requireAdmin, async (req, res) => {
    try {
      // Validation Zod
      const createUserSchema = insertUserSchema.extend({
        username: insertUserSchema.shape.username.min(3, "Le nom d'utilisateur doit contenir au moins 3 caractères"),
        password: insertUserSchema.shape.password.min(4, "Le mot de passe doit contenir au moins 4 caractères"),
      });

      const validatedData = createUserSchema.parse(req.body);

      // Vérifier si l'utilisateur existe déjà
      const existingUser = await storage.getUserByUsername(validatedData.username);
      if (existingUser) {
        return res.status(409).json({ error: "Ce nom d'utilisateur existe déjà" });
      }

      // Hasher le mot de passe
      const hashedPassword = await bcrypt.hash(validatedData.password, 10);

      const newUser = await storage.createUser({
        username: validatedData.username,
        password: hashedPassword,
        role: validatedData.role || "user",
      });

      res.json({
        id: newUser.id,
        username: newUser.username,
        role: newUser.role,
      });
    } catch (error: any) {
      console.error("Error creating user:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors[0]?.message || "Données invalides" });
      }
      res.status(500).json({ error: "Erreur lors de la création de l'utilisateur" });
    }
  });

  // Route pour modifier un utilisateur (réservée aux admins)
  app.patch("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const userId = req.params.id;
      const { username, password, role } = req.body;
      
      // Vérifier si l'utilisateur existe
      const existingUser = await storage.getUser(userId);
      if (!existingUser) {
        return res.status(404).json({ error: "Utilisateur non trouvé" });
      }

      const updateData: Partial<InsertUser> = {};
      
      if (username && username !== existingUser.username) {
        // Vérifier si le nouveau username est déjà pris
        const userWithSameUsername = await storage.getUserByUsername(username);
        if (userWithSameUsername && userWithSameUsername.id !== userId) {
          return res.status(409).json({ error: "Ce nom d'utilisateur est déjà utilisé" });
        }
        updateData.username = username;
      }
      
      if (password) {
        // Hasher le nouveau mot de passe
        updateData.password = await bcrypt.hash(password, 10);
      }
      
      if (role && (role === "admin" || role === "user")) {
        updateData.role = role;
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "Aucune modification fournie" });
      }

      const updatedUser = await storage.updateUser(userId, updateData);
      
      res.json({
        id: updatedUser.id,
        username: updatedUser.username,
        role: updatedUser.role,
      });
    } catch (error: any) {
      console.error("Error updating user:", error);
      res.status(500).json({ error: "Erreur lors de la modification de l'utilisateur" });
    }
  });

  // Route pour supprimer un utilisateur (réservée aux admins)
  app.delete("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const userId = req.params.id;
      const currentUser = req.user as User;
      
      // Empêcher l'admin de se supprimer lui-même
      if (userId === currentUser.id) {
        return res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre compte" });
      }

      // Vérifier si l'utilisateur existe
      const existingUser = await storage.getUser(userId);
      if (!existingUser) {
        return res.status(404).json({ error: "Utilisateur non trouvé" });
      }

      await storage.deleteUser(userId);
      
      res.json({ success: true, message: "Utilisateur supprimé avec succès" });
    } catch (error: any) {
      console.error("Error deleting user:", error);
      res.status(500).json({ error: "Erreur lors de la suppression de l'utilisateur" });
    }
  });

  // Route pour vérifier si le mot de passe admin par défaut a été changé
  app.get("/api/auth/default-password-status", async (req, res) => {
    try {
      const adminUser = await storage.getUserByUsername("admin");
      
      if (!adminUser) {
        return res.json({ isDefault: false });
      }

      // Vérifier si le mot de passe correspond à "admin"
      const isDefaultPassword = await bcrypt.compare("admin", adminUser.password);
      
      res.json({ isDefault: isDefaultPassword });
    } catch (error) {
      console.error("Error checking default password:", error);
      res.status(500).json({ error: "Erreur lors de la vérification" });
    }
  });

  // Route SQL (réservée aux admins)
  app.post("/api/sql/execute", requireAdmin, async (req, res) => {
    try {
      // Validation Zod
      const sqlQuerySchema = z.object({
        query: z.string().min(1, "La requête SQL ne peut pas être vide"),
      });

      const validatedData = sqlQuerySchema.parse(req.body);

      const { db } = await import("./db");
      const result = await db.execute(validatedData.query);
      
      res.json({
        success: true,
        result,
      });
    } catch (error: any) {
      console.error("Error executing SQL:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({
          success: false,
          error: error.errors[0]?.message || "Données invalides",
        });
      }
      res.status(500).json({
        success: false,
        error: error.message || "Erreur lors de l'exécution de la requête SQL",
      });
    }
  });

  // Route pour obtenir la liste des tables (réservée aux admins)
  app.get("/api/sql/tables", requireAdmin, async (req, res) => {
    try {
      const { db } = await import("./db");
      const result = await db.execute<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;`
      );
      
      res.json({
        tables: result.rows || result,
      });
    } catch (error: any) {
      console.error("Error fetching tables:", error);
      res.status(500).json({
        error: error.message || "Erreur lors de la récupération des tables",
      });
    }
  });


  // Stats endpoint
  app.get("/api/stats", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      
      const posts = await storage.getPosts(userId);
      const pages = await storage.getSocialPages(userId);
      const media = await storage.getMedia(userId);
      const aiGenerations = await storage.getAiGenerations(userId);

      const scheduledPosts = posts.filter(p => p.status === "scheduled").length;

      res.json({
        scheduledPosts,
        connectedPages: pages.length,
        aiTextsGenerated: aiGenerations.length,
        mediaStored: media.length,
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // AI text generation
  app.post("/api/ai/generate", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const productInfo = req.body;

      const generatedTexts = await openRouterService.generatePostText(productInfo, userId);

      // Save to database
      await storage.createAiGeneration({
        userId,
        productInfo,
        generatedTexts,
      });

      res.json({ variants: generatedTexts });
    } catch (error) {
      console.error("Error generating text:", error);
      res.status(500).json({ error: "Failed to generate text" });
    }
  });

  // Media upload
  app.post("/api/media/upload", requireAuth, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const user = req.user as User;
      const userId = user.id;

      // Check if Cloudinary is configured
      const cloudinaryConfig = await storage.getCloudinaryConfig(userId);
      
      if (!cloudinaryConfig) {
        return res.status(400).json({ 
          error: "Cloudinary not configured. Please configure Cloudinary in Settings first." 
        });
      }

      // Upload to Cloudinary
      const uploadResult = await cloudinaryService.uploadMedia(
        req.file.buffer,
        req.file.originalname,
        userId,
        req.file.mimetype
      );

      const mediaItem = await storage.createMedia({
        userId,
        type: req.file.mimetype.startsWith("video/") ? "video" : "image",
        cloudinaryPublicId: uploadResult.publicId,
        originalUrl: uploadResult.originalUrl,
        facebookFeedUrl: uploadResult.facebookFeedUrl,
        instagramFeedUrl: uploadResult.instagramFeedUrl,
        instagramStoryUrl: uploadResult.instagramStoryUrl,
        fileName: req.file.originalname,
        fileSize: req.file.size,
      });

      res.json(mediaItem);
    } catch (error) {
      console.error("Error uploading media:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to upload media";
      res.status(500).json({ error: errorMessage });
    }
  });

  // Get media
  app.get("/api/media", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const media = await storage.getMedia(userId);
      res.json(media);
    } catch (error) {
      console.error("Error fetching media:", error);
      res.status(500).json({ error: "Failed to fetch media" });
    }
  });

  // Delete media
  app.delete("/api/media/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const mediaId = req.params.id;
      
      // Get media to find cloudinary public ID
      const allMedia = await storage.getMedia(userId);
      const mediaToDelete = allMedia.find(m => m.id === mediaId);
      
      if (!mediaToDelete) {
        return res.status(404).json({ error: "Media not found" });
      }

      // Delete from Cloudinary
      if (mediaToDelete.cloudinaryPublicId) {
        await cloudinaryService.deleteMedia(
          mediaToDelete.cloudinaryPublicId, 
          userId,
          mediaToDelete.type
        );
      }

      // Delete from database
      await storage.deleteMedia(mediaId);
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting media:", error);
      res.status(500).json({ error: "Failed to delete media" });
    }
  });

  // Posts
  app.get("/api/posts", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const posts = await storage.getPosts(userId);
      res.json(posts);
    } catch (error) {
      console.error("Error fetching posts:", error);
      res.status(500).json({ error: "Failed to fetch posts" });
    }
  });

  app.post("/api/posts", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const { pageIds, postType, mediaId, ...postFields } = req.body;
      
      // Convert scheduledFor string to Date if provided
      if (postFields.scheduledFor && typeof postFields.scheduledFor === 'string') {
        postFields.scheduledFor = new Date(postFields.scheduledFor);
      }
      
      // Create the post
      const postData = insertPostSchema.parse({ ...postFields, userId });
      const post = await storage.createPost(postData);
      
      // Link media to post if provided
      if (mediaId) {
        await db.insert(postMedia).values({
          postId: post.id,
          mediaId: mediaId,
        });
      }
      
      // Create scheduled posts for each selected page
      if (pageIds && Array.isArray(pageIds) && pageIds.length > 0) {
        const scheduledAt = postFields.scheduledFor 
          ? new Date(postFields.scheduledFor) 
          : new Date(); // Publish immediately if no date specified
        
        for (const pageId of pageIds) {
          await storage.createScheduledPost({
            postId: post.id,
            pageId,
            postType: postType || 'feed',
            scheduledAt,
          });
        }
      }
      
      res.json(post);
    } catch (error) {
      console.error("Error creating post:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to create post";
      res.status(500).json({ error: errorMessage });
    }
  });

  // Scheduled posts
  app.get("/api/scheduled-posts", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const { startDate, endDate } = req.query;
      
      const start = startDate ? new Date(startDate as string) : undefined;
      const end = endDate ? new Date(endDate as string) : undefined;
      
      const scheduledPosts = await storage.getScheduledPosts(userId, start, end);
      res.json(scheduledPosts);
    } catch (error) {
      console.error("Error fetching scheduled posts:", error);
      res.status(500).json({ error: "Failed to fetch scheduled posts" });
    }
  });

  app.post("/api/scheduled-posts", requireAuth, async (req, res) => {
    try {
      const scheduledPostData = insertScheduledPostSchema.parse(req.body);
      const scheduledPost = await storage.createScheduledPost(scheduledPostData);
      res.json(scheduledPost);
    } catch (error) {
      console.error("Error creating scheduled post:", error);
      res.status(500).json({ error: "Failed to create scheduled post" });
    }
  });

  // Social pages
  app.get("/api/pages", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const pages = await storage.getSocialPages(userId);
      res.json(pages);
    } catch (error) {
      console.error("Error fetching pages:", error);
      res.status(500).json({ error: "Failed to fetch pages" });
    }
  });

  app.post("/api/pages", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const pageData = insertSocialPageSchema.parse({ ...req.body, userId });
      const page = await storage.createSocialPage(pageData);
      res.json(page);
    } catch (error) {
      console.error("Error creating page:", error);
      res.status(500).json({ error: "Failed to create page" });
    }
  });

  app.put("/api/pages/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const pageId = req.params.id;
      
      const existingPage = await storage.getSocialPage(pageId);
      if (!existingPage || existingPage.userId !== userId) {
        return res.status(404).json({ error: "Page non trouvée" });
      }
      
      const pageData = insertSocialPageSchema.partial().parse(req.body);
      const updatedPage = await storage.updateSocialPage(pageId, pageData);
      res.json(updatedPage);
    } catch (error) {
      console.error("Error updating page:", error);
      res.status(500).json({ error: "Failed to update page" });
    }
  });

  app.delete("/api/pages/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const pageId = req.params.id;
      
      const existingPage = await storage.getSocialPage(pageId);
      if (!existingPage || existingPage.userId !== userId) {
        return res.status(404).json({ error: "Page non trouvée" });
      }
      
      await storage.deleteSocialPage(pageId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting page:", error);
      res.status(500).json({ error: "Failed to delete page" });
    }
  });

  // AI Generations
  app.get("/api/ai/generations", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const generations = await storage.getAiGenerations(userId);
      res.json(generations);
    } catch (error) {
      console.error("Error fetching AI generations:", error);
      res.status(500).json({ error: "Failed to fetch AI generations" });
    }
  });

  // Cloudinary Config
  app.get("/api/cloudinary/config", requireAdmin, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const config = await storage.getCloudinaryConfig(userId);
      
      if (!config) {
        return res.json(null);
      }

      // Don't send the API secret to the client
      const { apiSecret, ...safeConfig } = config;
      res.json(safeConfig);
    } catch (error) {
      console.error("Error fetching Cloudinary config:", error);
      res.status(500).json({ error: "Failed to fetch Cloudinary config" });
    }
  });

  app.post("/api/cloudinary/config", requireAdmin, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      
      const configData = insertCloudinaryConfigSchema.parse({
        ...req.body,
        userId,
      });

      // Check if config already exists
      const existingConfig = await storage.getCloudinaryConfig(userId);
      
      let config;
      if (existingConfig) {
        config = await storage.updateCloudinaryConfig(userId, configData);
      } else {
        config = await storage.createCloudinaryConfig(configData);
      }

      // Don't send the API secret back
      const { apiSecret, ...safeConfig } = config;
      res.json(safeConfig);
    } catch (error) {
      console.error("Error saving Cloudinary config:", error);
      res.status(500).json({ error: "Failed to save Cloudinary config" });
    }
  });

  // OpenRouter models list
  app.get("/api/openrouter/models", requireAuth, async (req, res) => {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: {
          "Content-Type": "application/json",
        }
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status}`);
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Error fetching OpenRouter models:", error);
      res.status(500).json({ error: "Failed to fetch OpenRouter models" });
    }
  });

  // OpenRouter configuration
  app.get("/api/openrouter/config", requireAdmin, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const config = await storage.getOpenrouterConfig(userId);
      
      if (!config) {
        return res.json(null);
      }

      // Don't send the API key to the client
      const { apiKey, ...safeConfig } = config;
      res.json(safeConfig);
    } catch (error) {
      console.error("Error fetching OpenRouter config:", error);
      res.status(500).json({ error: "Failed to fetch OpenRouter config" });
    }
  });

  app.post("/api/openrouter/config", requireAdmin, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      
      // Check if config already exists
      const existingConfig = await storage.getOpenrouterConfig(userId);
      
      let config;
      if (existingConfig) {
        // Pour les mises à jour, utiliser le schéma qui rend apiKey optionnel
        const updateData = updateOpenrouterConfigSchema.parse({
          ...req.body,
          userId,
        });
        
        // Si apiKey n'est pas fourni, garder l'ancien
        const finalData = {
          ...updateData,
          apiKey: updateData.apiKey || existingConfig.apiKey,
        };
        
        config = await storage.updateOpenrouterConfig(userId, finalData);
      } else {
        // Pour les créations, exiger tous les champs
        const configData = insertOpenrouterConfigSchema.parse({
          ...req.body,
          userId,
        });
        config = await storage.createOpenrouterConfig(configData);
      }

      // Don't send the API key back
      const { apiKey, ...safeConfig } = config;
      res.json(safeConfig);
    } catch (error) {
      console.error("Error saving OpenRouter config:", error);
      res.status(500).json({ error: "Failed to save OpenRouter config" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
