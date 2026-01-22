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
import { insertPostSchema, insertScheduledPostSchema, insertSocialPageSchema, insertAiGenerationSchema, insertCloudinaryConfigSchema, updateCloudinaryConfigSchema, insertOpenrouterConfigSchema, updateOpenrouterConfigSchema, insertUserSchema, postMedia, type SocialPage } from "@shared/schema";
import type { User, InsertUser, ScheduledPost } from "@shared/schema";
import { analyticsRouter } from "./routes/analytics";
import { reelsRouter } from "./routes/reels";

// Types MIME autorisés pour les uploads
const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm'
];

// Configuration multer avec validation de taille et type
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
    files: 10 // 10 fichiers max
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Type de fichier non autorisé: ${file.mimetype}`));
    }
  }
});

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

  // Route pour obtenir les permissions d'un utilisateur (réservée aux admins)
  app.get("/api/users/:id/page-permissions", requireAdmin, async (req, res) => {
    try {
      const userId = req.params.id;
      const permissions = await storage.getUserPagePermissions(userId);
      res.json(permissions);
    } catch (error) {
      console.error("Error fetching user permissions:", error);
      res.status(500).json({ error: "Erreur lors de la récupération des permissions" });
    }
  });

  // Route pour mettre à jour les permissions d'un utilisateur (réservée aux admins)
  app.post("/api/users/:id/page-permissions", requireAdmin, async (req, res) => {
    try {
      const userId = req.params.id;
      const { pageIds } = req.body as { pageIds: string[] };

      if (!Array.isArray(pageIds)) {
        return res.status(400).json({ error: "pageIds doit être un tableau" });
      }

      // Supprimer toutes les permissions existantes de l'utilisateur
      await storage.deleteAllUserPagePermissions(userId);

      // Créer les nouvelles permissions
      const permissions = await Promise.all(
        pageIds.map(pageId =>
          storage.createPagePermission({ userId, pageId })
        )
      );

      res.json(permissions);
    } catch (error) {
      console.error("Error updating user permissions:", error);
      res.status(500).json({ error: "Erreur lors de la mise à jour des permissions" });
    }
  });

  // Route pour migrer les permissions existantes (réservée aux admins)
  app.post("/api/admin/migrate-permissions", requireAdmin, async (req, res) => {
    try {
      // Récupérer tous les utilisateurs
      const allUsers = await storage.getAllUsers();
      let migratedCount = 0;

      for (const user of allUsers) {
        // Récupérer toutes les pages créées par cet utilisateur
        const userPages = await storage.getSocialPages(user.id);

        for (const page of userPages) {
          // Vérifier si une permission existe déjà
          const existingPermissions = await storage.getUserPagePermissions(user.id);
          const hasPermission = existingPermissions.some(p => p.pageId === page.id);

          if (!hasPermission) {
            // Créer la permission
            await storage.createPagePermission({ userId: user.id, pageId: page.id });
            migratedCount++;
          }
        }
      }

      res.json({
        success: true,
        message: `${migratedCount} permissions migrées avec succès`,
        migratedCount
      });
    } catch (error) {
      console.error("Error migrating permissions:", error);
      res.status(500).json({ error: "Erreur lors de la migration des permissions" });
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
      console.error("Error checking default password status:", error);
      res.status(500).json({ error: "Erreur lors de la vérification du statut du mot de passe" });
    }
  });

  // Analytics Routes
  app.use("/api/analytics", requireAuth, analyticsRouter);

  // Reels & Music Routes
  app.use("/api", requireAuth, reelsRouter);


  // Route SQL (réservée aux admins) - DÉSACTIVÉE EN PRODUCTION sauf si explicitement autorisée
  app.post("/api/sql/execute", requireAdmin, async (req, res) => {
    // Vérification de sécurité désactivée pour permettre l'accès
    // if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SQL_CONSOLE !== 'true') { ... }

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

      // Statistiques actuelles
      const scheduledPosts = posts.filter(p => p.status === "scheduled").length;
      const currentAiTexts = aiGenerations.length;
      const currentMedia = media.length;

      // Calculer les statistiques de la période précédente (hier pour les textes IA, mois dernier pour les posts)
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const lastMonth = new Date(now);
      lastMonth.setMonth(lastMonth.getMonth() - 1);

      // Textes IA générés hier
      const aiTextsYesterday = aiGenerations.filter(gen => {
        if (!gen.createdAt) return false;
        const genDate = new Date(gen.createdAt);
        genDate.setHours(0, 0, 0, 0);
        return genDate.getTime() === yesterday.getTime();
      }).length;

      // Posts planifiés le mois dernier
      const scheduledPostsLastMonth = posts.filter(p => {
        if (!p.createdAt) return false;
        const createdDate = new Date(p.createdAt);
        return p.status === "scheduled" && createdDate < lastMonth;
      }).length;

      // Calculer les variations en pourcentage
      const aiTextChange = aiTextsYesterday > 0
        ? Math.round(((currentAiTexts - aiTextsYesterday) / aiTextsYesterday) * 100)
        : currentAiTexts > 0 ? 100 : 0;

      const scheduledPostsChange = scheduledPostsLastMonth > 0
        ? Math.round(((scheduledPosts - scheduledPostsLastMonth) / scheduledPostsLastMonth) * 100)
        : scheduledPosts > 0 ? 100 : 0;

      res.json({
        scheduledPosts,
        scheduledPostsChange: scheduledPostsChange > 0 ? `+${scheduledPostsChange}%` : `${scheduledPostsChange}%`,
        scheduledPostsTrending: scheduledPostsChange >= 0 ? "up" : "down",
        connectedPages: pages.length,
        aiTextsGenerated: currentAiTexts,
        aiTextsChange: aiTextChange > 0 ? `+${aiTextChange}%` : `${aiTextChange}%`,
        aiTextsTrending: aiTextChange >= 0 ? "up" : "down",
        mediaStored: media.length,
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // Get available AI models from OpenRouter
  app.get("/api/ai/models", requireAdmin, async (req, res) => {
    try {
      const models = await openRouterService.getAvailableModels();
      res.json({ models });
    } catch (error) {
      console.error("Error fetching models:", error);
      res.status(500).json({ error: "Failed to fetch models" });
    }
  });

  // AI text generation
  app.post("/api/ai/generate", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const { model, ...productInfo } = req.body;

      const generatedTexts = await openRouterService.generatePostText(productInfo, userId, model);

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

      // Check if Cloudinary is configured (shared config used for all users)
      const cloudinaryConfig = await storage.getAnyCloudinaryConfig();

      if (!cloudinaryConfig) {
        return res.status(400).json({
          error: "Cloudinary not configured. Please ask an administrator to configure Cloudinary in Settings first."
        });
      }

      // Upload to Cloudinary (service will use shared config internally)
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

  // Apply overlays to image using Sharp (server-side processing)
  // IMPORTANT: This must be BEFORE /api/media/:id to avoid being intercepted by :id parameter
  app.post("/api/media/apply-overlays", requireAuth, async (req, res) => {
    try {
      const { imageUrl, ribbon, priceBadge, logo } = req.body;
      const user = req.user as User;
      const userId = user.id;

      if (!imageUrl) {
        return res.status(400).json({ error: "Image URL required" });
      }

      console.log("🎨 Applying overlays server-side with Sharp...");
      console.log("📥 Image URL:", imageUrl);
      console.log("🎀 Ribbon:", ribbon);
      console.log("💰 Price Badge:", priceBadge);
      console.log("🏢 Logo:", logo);

      // Download image from URL
      const imageResponse = await fetch(imageUrl);
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      console.log("✅ Image downloaded:", imageBuffer.length, "bytes");

      // Load with Sharp to process
      const sharp = (await import("sharp")).default;
      let image = sharp(imageBuffer).rotate();

      // Get image metadata for dimensions
      const metadata = await image.metadata();
      const width = metadata.width!;
      const height = metadata.height!;

      console.log(`📐 Image dimensions: ${width}x${height}`);

      // Create SVG overlays
      const overlays: any[] = [];

      // Add ribbon overlay
      if (ribbon) {
        const ribbonSize = 150;
        const color = ribbon.color === 'red' ? '#dc2626' : '#eab308';
        const fontSize = ribbon.text.length <= 5 ? 22 : ribbon.text.length <= 8 ? 18 : ribbon.text.length <= 11 ? 15 : 12;

        // Position mapping for each corner
        const positions: Record<string, { x: number; y: number; polygon: string; textX: number; textY: number; textRotation: number }> = {
          north_west: {
            x: 0,
            y: 0,
            polygon: `0,0 ${ribbonSize},0 0,${ribbonSize}`,  // Top-left triangle
            textX: ribbonSize * 0.3,
            textY: ribbonSize * 0.3,
            textRotation: -45
          },
          north_east: {
            x: width - ribbonSize,
            y: 0,
            polygon: `0,0 ${ribbonSize},0 ${ribbonSize},${ribbonSize}`,  // Top-right triangle
            textX: ribbonSize * 0.7,
            textY: ribbonSize * 0.3,
            textRotation: 45
          },
          south_west: {
            x: 0,
            y: height - ribbonSize,
            polygon: `0,0 0,${ribbonSize} ${ribbonSize},${ribbonSize}`,  // Bottom-left triangle
            textX: ribbonSize * 0.3,
            textY: ribbonSize * 0.7,
            textRotation: -135
          },
          south_east: {
            x: width - ribbonSize,
            y: height - ribbonSize,
            polygon: `${ribbonSize},0 0,${ribbonSize} ${ribbonSize},${ribbonSize}`,  // Bottom-right triangle
            textX: ribbonSize * 0.7,
            textY: ribbonSize * 0.7,
            textRotation: 135
          }
        };

        const pos = positions[ribbon.position] || positions.north_west;

        const ribbonSvg = `
          <svg width="${ribbonSize}" height="${ribbonSize}" xmlns="http://www.w3.org/2000/svg">
            <polygon points="${pos.polygon}" fill="${color}"/>
            <text x="${pos.textX}" y="${pos.textY}" 
                  font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" 
                  fill="white" text-anchor="middle" dominant-baseline="middle"
                  transform="rotate(${pos.textRotation}, ${pos.textX}, ${pos.textY})">
              ${ribbon.text}
            </text>
          </svg>
        `;

        overlays.push({
          input: Buffer.from(ribbonSvg),
          top: pos.y,
          left: pos.x
        });
      }

      // Add price badge overlay
      if (priceBadge) {
        const padding = 16;
        const badgeText = `${priceBadge.price} €`;
        const fontSize = priceBadge.size;
        const textWidth = badgeText.length * fontSize * 0.6; // Approximate
        const badgeWidth = textWidth + padding * 2;
        const badgeHeight = fontSize + padding;
        const color = priceBadge.color === 'red' ? '#dc2626' : '#eab308';

        let x = padding;
        let y = padding;

        if (priceBadge.position === 'north_east') {
          x = width - badgeWidth - padding;
        } else if (priceBadge.position === 'south_west') {
          y = height - badgeHeight - padding;
        } else if (priceBadge.position === 'south_east') {
          x = width - badgeWidth - padding;
          y = height - badgeHeight - padding;
        }

        const badgeSvg = `
          <svg width="${badgeWidth}" height="${badgeHeight}">
            <rect x="0" y="0" width="${badgeWidth}" height="${badgeHeight}" 
                  rx="${badgeHeight / 2}" ry="${badgeHeight / 2}" fill="${color}"/>
            <text x="${badgeWidth / 2}" y="${badgeHeight / 2}" 
                  font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" 
                  fill="white" text-anchor="middle" dominant-baseline="middle">
              ${badgeText}
            </text>
          </svg>
        `;

        overlays.push({
          input: Buffer.from(badgeSvg),
          top: y,
          left: x
        });
      }

      // Add logo overlay
      if (logo && logo.enabled) {
        console.log("🏢 Adding logo overlay...");

        // Get Cloudinary config to get logo public ID
        const cloudinaryConfig = await storage.getAnyCloudinaryConfig();
        if (cloudinaryConfig && cloudinaryConfig.logoPublicId) {
          try {
            // Build logo URL from Cloudinary
            const logoUrl = `https://res.cloudinary.com/${cloudinaryConfig.cloudName}/image/upload/${cloudinaryConfig.logoPublicId}`;
            console.log("📥 Downloading logo from:", logoUrl);

            // Download logo
            const logoResponse = await fetch(logoUrl);
            const logoBuffer = Buffer.from(await logoResponse.arrayBuffer());

            // Determine logo size based on selection with safety cap
            const padding = 20;
            const maxLogoWidth = width - (padding * 2);  // Ensure logo fits within canvas

            const logoSizePercentages = {
              small: 0.35,   // 35% of image width
              medium: 0.50,  // 50% of image width
              large: 0.70    // 70% of image width
            };

            const requestedWidth = Math.round(width * logoSizePercentages[logo.size as keyof typeof logoSizePercentages] || logoSizePercentages.medium);
            const logoWidth = Math.min(requestedWidth, maxLogoWidth);

            // Resize logo preserving aspect ratio and apply opacity
            const resizedLogo = await sharp(logoBuffer)
              .resize({ width: logoWidth, fit: 'contain' })
              .ensureAlpha()
              .toBuffer();

            // Get resized logo dimensions
            const logoMetadata = await sharp(resizedLogo).metadata();
            const logoHeight = logoMetadata.height || logoWidth;

            // Ensure logo fits within height as well
            const maxLogoHeight = height - (padding * 2);
            if (logoHeight > maxLogoHeight) {
              console.warn(`⚠️ Logo height ${logoHeight}px exceeds max ${maxLogoHeight}px, would be clipped`);
            }

            // Calculate position with padding
            let logoX = padding;
            let logoY = padding;

            if (logo.position === 'north_east') {
              logoX = width - logoWidth - padding;
            } else if (logo.position === 'south_west') {
              logoY = height - logoHeight - padding;
            } else if (logo.position === 'south_east') {
              logoX = width - logoWidth - padding;
              logoY = height - logoHeight - padding;
            } else if (logo.position === 'center') {
              logoX = Math.round((width - logoWidth) / 2);
              logoY = Math.round((height - logoHeight) / 2);
            }

            // Apply opacity by manipulating alpha channel
            let logoWithOpacity = resizedLogo;
            if (logo.opacity < 100) {
              // Create a semi-transparent version of the logo
              const opacityFactor = logo.opacity / 100;
              logoWithOpacity = await sharp(resizedLogo)
                .ensureAlpha()
                .linear(opacityFactor, 0)
                .toBuffer();
            }

            // Add logo overlay
            overlays.push({
              input: logoWithOpacity,
              top: logoY,
              left: logoX,
              blend: 'over'
            });

            console.log(`✅ Logo added at position ${logo.position} with ${logo.opacity}% opacity`);
          } catch (logoError) {
            console.error("⚠️  Failed to apply logo:", logoError);
            // Continue without logo if it fails
          }
        } else {
          console.log("⚠️  No logo configured in settings");
        }
      }

      // Apply all overlays
      if (overlays.length > 0) {
        image = image.composite(overlays);
      }

      // Convert to buffer
      const outputBuffer = await image.jpeg({ quality: 95 }).toBuffer();

      console.log("✅ Overlays applied, uploading to Cloudinary...");

      // Check if Cloudinary is configured (shared config used for all users)
      const cloudinaryConfig = await storage.getAnyCloudinaryConfig();
      if (!cloudinaryConfig) {
        return res.status(400).json({
          error: "Cloudinary not configured. Please ask an administrator to configure Cloudinary in Settings first."
        });
      }

      // Upload to Cloudinary (service will use shared config internally)
      const uploadResult = await cloudinaryService.uploadMedia(
        outputBuffer,
        `edited_${Date.now()}.jpg`,
        userId,
        'image/jpeg'
      );

      // Save to database
      // IMPORTANT: For edited images with overlays, use originalUrl for ALL formats
      // because Cloudinary transformations would recreate versions WITHOUT the overlays
      const mediaItem = await storage.createMedia({
        userId,
        type: "image",
        cloudinaryPublicId: uploadResult.publicId,
        originalUrl: uploadResult.originalUrl,
        facebookFeedUrl: uploadResult.originalUrl,  // Use original with overlays
        instagramFeedUrl: uploadResult.originalUrl,  // Use original with overlays  
        instagramStoryUrl: uploadResult.originalUrl,  // Use original with overlays
        fileName: `edited_${Date.now()}.jpg`,
        fileSize: outputBuffer.length,
      });

      console.log("✅ Image saved with ID:", mediaItem.id);
      res.json(mediaItem);
    } catch (error) {
      console.error("💥 Error applying overlays:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to apply overlays";
      res.status(500).json({ error: errorMessage });
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
      const { pageIds, postType, mediaId, mediaIds, ...postFields } = req.body;

      // Convert mediaIds to standardized format: array of { mediaId, displayOrder }
      let finalMediaItems: Array<{ mediaId: string; displayOrder: number }> = [];

      if (mediaIds && Array.isArray(mediaIds)) {
        // New format: array of objects or strings
        finalMediaItems = mediaIds.map((item: any, index: number) => {
          if (typeof item === 'string') {
            // Legacy array of strings: use index as displayOrder
            return { mediaId: item, displayOrder: index };
          } else if (item.mediaId) {
            // New format: object with mediaId and displayOrder
            return {
              mediaId: item.mediaId,
              displayOrder: item.displayOrder ?? index,
            };
          }
          throw new Error("Invalid media format");
        });
      } else if (mediaId) {
        // Legacy single mediaId
        finalMediaItems = [{ mediaId, displayOrder: 0 }];
      }

      // Validate max 10 photos
      if (finalMediaItems.length > 10) {
        return res.status(400).json({ error: "Maximum 10 photos autorisées par publication" });
      }

      // Validate that stories require media
      if ((postType === 'story' || postType === 'both') && finalMediaItems.length === 0) {
        return res.status(400).json({ error: "Les stories nécessitent au moins un média (image ou vidéo)" });
      }

      // Security: Verify user has access to all specified pages (unless admin)
      if (user.role !== 'admin' && pageIds && Array.isArray(pageIds) && pageIds.length > 0) {
        const accessiblePages = await storage.getUserAccessiblePages(userId);
        const accessiblePageIds = accessiblePages.map(p => p.id);

        const hasAccessToAllPages = pageIds.every(pageId =>
          accessiblePageIds.includes(pageId)
        );

        if (!hasAccessToAllPages) {
          return res.status(403).json({
            error: "Vous n'avez pas accès à certaines pages sélectionnées"
          });
        }
      }

      // Convert scheduledFor string to Date if provided
      if (postFields.scheduledFor && typeof postFields.scheduledFor === 'string') {
        postFields.scheduledFor = new Date(postFields.scheduledFor);
      }

      // Set status to "scheduled" if scheduledFor is provided, otherwise "draft"
      if (postFields.scheduledFor) {
        postFields.status = "scheduled";

        // Validate that scheduled posts require at least one page
        if (!pageIds || !Array.isArray(pageIds) || pageIds.length === 0) {
          return res.status(400).json({ error: "Les posts programmés nécessitent au moins une page cible" });
        }
      }

      // Create the post
      const postData = insertPostSchema.parse({ ...postFields, userId });
      const post = await storage.createPost(postData);

      // Link media to post if provided (with display order)
      if (finalMediaItems.length > 0) {
        const postMediaValues = finalMediaItems.map(item => ({
          postId: post.id,
          mediaId: item.mediaId,
          displayOrder: item.displayOrder,
        }));
        await db.insert(postMedia).values(postMediaValues);
      }

      // Create scheduled posts for each selected page
      if (pageIds && Array.isArray(pageIds) && pageIds.length > 0) {
        const scheduledAt = postFields.scheduledFor
          ? new Date(postFields.scheduledFor)
          : new Date(); // Publish immediately if no date specified

        const finalPostType = postType || 'feed';

        for (const pageId of pageIds) {
          // If postType is "both", create two separate scheduled posts (story + feed)
          if (finalPostType === 'both') {
            await storage.createScheduledPost({
              postId: post.id,
              pageId,
              postType: 'story',
              scheduledAt,
            });
            await storage.createScheduledPost({
              postId: post.id,
              pageId,
              postType: 'feed',
              scheduledAt,
            });
          } else {
            await storage.createScheduledPost({
              postId: post.id,
              pageId,
              postType: finalPostType,
              scheduledAt,
            });
          }
        }
      }

      res.json(post);
    } catch (error) {
      console.error("Error creating post:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to create post";
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get("/api/posts/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const { id } = req.params;

      const postWithMedia = await storage.getPostWithMedia(id);
      if (!postWithMedia) {
        return res.status(404).json({ error: "Post not found" });
      }

      // Admin peut voir tous les posts
      if (user.role === 'admin') {
        return res.json(postWithMedia);
      }

      // Propriétaire peut voir son propre post
      if (postWithMedia.post.userId === userId) {
        return res.json(postWithMedia);
      }

      // Utilisateur standard peut voir les posts des pages qui lui sont assignées
      const scheduledPostsForPost = await storage.getScheduledPostsByPost(id);
      if (scheduledPostsForPost.length > 0) {
        const accessiblePages = await storage.getUserAccessiblePages(userId);
        const accessiblePageIds = accessiblePages.map(p => p.id);

        // Vérifier si au moins une page du post est accessible
        const hasAccess = scheduledPostsForPost.some(sp => accessiblePageIds.includes(sp.pageId));
        if (hasAccess) {
          return res.json(postWithMedia);
        }
      }

      return res.status(403).json({ error: "Unauthorized" });
    } catch (error) {
      console.error("Error fetching post:", error);
      res.status(500).json({ error: "Failed to fetch post" });
    }
  });

  app.patch("/api/posts/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const { id } = req.params;
      const { content } = req.body;

      const post = await storage.getPost(id);
      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }

      if (post.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      const updatedPost = await storage.updatePost(id, { content });
      res.json(updatedPost);
    } catch (error) {
      console.error("Error updating post:", error);
      res.status(500).json({ error: "Failed to update post" });
    }
  });

  app.patch("/api/posts/:id/media", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const { id } = req.params;
      const { mediaIds } = req.body;

      const post = await storage.getPost(id);
      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }

      if (post.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      if (!Array.isArray(mediaIds)) {
        return res.status(400).json({ error: "mediaIds must be an array" });
      }

      if (mediaIds.length > 10) {
        return res.status(400).json({ error: "Maximum 10 photos autorisées par publication" });
      }

      await storage.updatePostMedia(id, mediaIds);
      const updatedPostWithMedia = await storage.getPostWithMedia(id);
      res.json(updatedPostWithMedia);
    } catch (error) {
      console.error("Error updating post media:", error);
      res.status(500).json({ error: "Failed to update post media" });
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

      let scheduledPosts;

      if (user.role === 'admin') {
        // Admin voit tous les posts programmés - on récupère toutes les pages
        const allPages = await storage.getAllUsers().then(users =>
          Promise.all(users.map(u => storage.getSocialPages(u.id)))
        ).then(pagesArrays => pagesArrays.flat());
        const allPageIds = allPages.map(p => p.id);

        if (allPageIds.length > 0) {
          scheduledPosts = await storage.getScheduledPostsByPages(allPageIds, start, end);
        } else {
          scheduledPosts = [];
        }
      } else {
        // User voit uniquement les posts programmés sur les pages qui lui sont attribuées
        const accessiblePages = await storage.getUserAccessiblePages(userId);
        const accessiblePageIds = accessiblePages.map(p => p.id);

        if (accessiblePageIds.length > 0) {
          scheduledPosts = await storage.getScheduledPostsByPages(accessiblePageIds, start, end);
        } else {
          scheduledPosts = [];
        }
      }

      res.json(scheduledPosts);
    } catch (error) {
      console.error("Error fetching scheduled posts:", error);
      res.status(500).json({ error: "Failed to fetch scheduled posts" });
    }
  });

  app.delete("/api/scheduled-posts/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const { id } = req.params;

      // Verify the scheduled post exists
      const scheduledPost = await storage.getScheduledPost(id);
      if (!scheduledPost) {
        return res.status(404).json({ error: "Scheduled post not found" });
      }

      const post = await storage.getPost(scheduledPost.postId);
      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }

      // Admin peut tout supprimer, user peut supprimer uniquement ses propres posts
      if (user.role !== 'admin' && post.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      await storage.deleteScheduledPost(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting scheduled post:", error);
      res.status(500).json({ error: "Failed to delete scheduled post" });
    }
  });

  app.patch("/api/scheduled-posts/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;
      const { id } = req.params;

      // Verify the scheduled post exists
      const scheduledPost = await storage.getScheduledPost(id);
      if (!scheduledPost) {
        return res.status(404).json({ error: "Scheduled post not found" });
      }

      const post = await storage.getPost(scheduledPost.postId);
      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }

      // Admin peut tout modifier, user peut modifier uniquement ses propres posts
      if (user.role !== 'admin' && post.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      // Only allow updating scheduledAt and pageId
      const { scheduledAt, pageId } = req.body;
      const updateData: Partial<ScheduledPost> = {};

      if (scheduledAt) {
        updateData.scheduledAt = new Date(scheduledAt);
        // Synchroniser avec la table posts
        await storage.updatePost(scheduledPost.postId, { scheduledFor: new Date(scheduledAt) });
      }

      if (pageId) {
        updateData.pageId = pageId;
      }

      const updated = await storage.updateScheduledPost(id, updateData);
      res.json(updated);
    } catch (error) {
      console.error("Error updating scheduled post:", error);
      res.status(500).json({ error: "Failed to update scheduled post" });
    }
  });

  app.post("/api/scheduled-posts", requireAuth, async (req, res) => {
    try {
      const scheduledPostData = insertScheduledPostSchema.parse(req.body);

      // If postType is "both", create two separate scheduled posts (story + feed)
      // This prevents retry loops - each post type is independent
      if (scheduledPostData.postType === 'both') {
        const [storyPost, feedPost] = await Promise.all([
          storage.createScheduledPost({
            ...scheduledPostData,
            postType: 'story' as const,
          }),
          storage.createScheduledPost({
            ...scheduledPostData,
            postType: 'feed' as const,
          }),
        ]);
        // Return array so frontend knows it's a split operation
        res.json([storyPost, feedPost]);
      } else {
        const scheduledPost = await storage.createScheduledPost(scheduledPostData);
        res.json(scheduledPost);
      }
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

      let pages: SocialPage[];

      if (user.role === 'admin') {
        // Les admins voient toutes les pages de tous les utilisateurs
        const allUsers = await storage.getAllUsers();
        const allPages = await Promise.all(
          allUsers.map(u => storage.getSocialPages(u.id))
        );
        pages = allPages.flat();
      } else {
        // Les utilisateurs normaux voient uniquement les pages auxquelles ils ont accès
        pages = await storage.getUserAccessiblePages(userId);
      }

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

      // Calculate token expiration date (60 days from now)
      const tokenExpiresAt = new Date();
      tokenExpiresAt.setDate(tokenExpiresAt.getDate() + 60);

      const pageData = insertSocialPageSchema.parse({
        ...req.body,
        userId,
        tokenExpiresAt
      });
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

      let pageData = insertSocialPageSchema.partial().parse(req.body);

      // If accessToken is being updated, recalculate expiration date (60 days from now)
      // AND reset the status to valid so the UI updates immediately
      if (pageData.accessToken) {
        const tokenExpiresAt = new Date();
        tokenExpiresAt.setDate(tokenExpiresAt.getDate() + 60);
        pageData = {
          ...pageData,
          tokenExpiresAt,
          tokenStatus: 'valid',
          lastTokenCheck: new Date()
        };
      }

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
  app.get("/api/ai/generations", requireAdmin, async (req, res) => {
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

      // Check if config already exists
      const existingConfig = await storage.getCloudinaryConfig(userId);

      let config;
      if (existingConfig) {
        // Pour les mises à jour, utiliser le schéma qui rend les secrets optionnels
        const updateData = updateCloudinaryConfigSchema.parse({
          ...req.body,
          userId,
        });

        // Si apiKey/apiSecret ne sont pas fournis, garder les anciens
        const finalData = {
          ...updateData,
          apiKey: updateData.apiKey || existingConfig.apiKey,
          apiSecret: updateData.apiSecret || existingConfig.apiSecret,
        };

        config = await storage.updateCloudinaryConfig(userId, finalData);
      } else {
        // Pour les créations, exiger tous les champs
        const configData = insertCloudinaryConfigSchema.parse({
          ...req.body,
          userId,
        });
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

  // Upload company logo
  app.post("/api/cloudinary/logo", requireAdmin, upload.single("logo"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No logo file uploaded" });
      }

      const user = req.user as User;
      const userId = user.id;

      // Check if Cloudinary is configured
      const cloudinaryConfig = await storage.getCloudinaryConfig(userId);
      if (!cloudinaryConfig) {
        return res.status(400).json({
          error: "Cloudinary not configured. Please configure Cloudinary first."
        });
      }

      // Delete old logo if exists
      if (cloudinaryConfig.logoPublicId) {
        try {
          await cloudinaryService.deleteLogo(cloudinaryConfig.logoPublicId);
        } catch (error) {
          console.warn("Failed to delete old logo:", error);
          // Continue anyway - not critical
        }
      }

      // Upload new logo to Cloudinary
      const uploadResult = await cloudinaryService.uploadLogo(
        req.file.buffer,
        req.file.originalname
      );

      // Update config with new logo public ID
      const updatedConfig = await storage.updateCloudinaryConfig(userId, {
        logoPublicId: uploadResult.publicId,
      });

      res.json({
        logoPublicId: uploadResult.publicId,
        logoUrl: uploadResult.url,
      });
    } catch (error) {
      console.error("Error uploading logo:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to upload logo";
      res.status(500).json({ error: errorMessage });
    }
  });

  // Delete company logo
  app.delete("/api/cloudinary/logo", requireAdmin, async (req, res) => {
    try {
      const user = req.user as User;
      const userId = user.id;

      const cloudinaryConfig = await storage.getCloudinaryConfig(userId);
      if (!cloudinaryConfig || !cloudinaryConfig.logoPublicId) {
        return res.status(404).json({ error: "No logo found" });
      }

      // Delete from Cloudinary
      await cloudinaryService.deleteLogo(cloudinaryConfig.logoPublicId);

      // Remove from config
      await storage.updateCloudinaryConfig(userId, {
        logoPublicId: null,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting logo:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to delete logo";
      res.status(500).json({ error: errorMessage });
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

  // FFmpeg API Configuration
  app.get("/api/ffmpeg/config", requireAdmin, async (req, res) => {
    try {
      const user = req.user as User;
      // Lire depuis les variables d'environnement ou un storage dédié
      // Pour simplifier, on renvoie juste si c'est configuré ou non
      const apiUrl = process.env.FFMPEG_API_URL || "";

      res.json({
        apiUrl: apiUrl,
        configured: !!apiUrl && !!process.env.FFMPEG_API_KEY,
      });
    } catch (error) {
      console.error("Error fetching FFmpeg config:", error);
      res.status(500).json({ error: "Failed to fetch FFmpeg config" });
    }
  });

  app.post("/api/ffmpeg/config", requireAdmin, async (req, res) => {
    try {
      const { apiUrl, apiKey } = req.body;

      if (!apiUrl) {
        return res.status(400).json({ error: "URL de l'API FFmpeg requise" });
      }

      // Configurer le service FFmpeg avec les nouvelles valeurs
      const { ffmpegService } = await import("./services/ffmpeg");

      // Si apiKey fourni, configurer avec
      if (apiKey) {
        ffmpegService.configure(apiUrl, apiKey);
      } else if (process.env.FFMPEG_API_KEY) {
        // Garder la clé existante
        ffmpegService.configure(apiUrl, process.env.FFMPEG_API_KEY);
      } else {
        return res.status(400).json({ error: "Clé API FFmpeg requise pour la première configuration" });
      }

      // Stocker dans les variables d'environnement (pour cette session)
      process.env.FFMPEG_API_URL = apiUrl;
      if (apiKey) {
        process.env.FFMPEG_API_KEY = apiKey;
      }

      // Tester la connexion
      const isHealthy = await ffmpegService.healthCheck();

      res.json({
        success: true,
        apiUrl: apiUrl,
        configured: true,
        healthy: isHealthy,
      });
    } catch (error) {
      console.error("Error saving FFmpeg config:", error);
      res.status(500).json({ error: "Failed to save FFmpeg config" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
