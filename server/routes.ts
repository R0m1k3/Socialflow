import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import { openRouterService } from "./services/openrouter";
import { cloudinaryService } from "./services/cloudinary";
import { insertPostSchema, insertScheduledPostSchema, insertSocialPageSchema, insertAiGenerationSchema, insertCloudinaryConfigSchema, insertOpenrouterConfigSchema } from "@shared/schema";

const upload = multer({ storage: multer.memoryStorage() });

export async function registerRoutes(app: Express): Promise<Server> {

  // Stats endpoint
  app.get("/api/stats", async (req, res) => {
    try {
      // For now, return mock stats. In a real app, calculate from database
      const userId = "demo-user"; // In real app, get from session/auth
      
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
  app.post("/api/ai/generate", async (req, res) => {
    try {
      const productInfo = req.body;
      const userId = "demo-user"; // In real app, get from session/auth

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
  app.post("/api/media/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const userId = "demo-user"; // In real app, get from session/auth

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
  app.get("/api/media", async (req, res) => {
    try {
      const userId = "demo-user"; // In real app, get from session/auth
      const media = await storage.getMedia(userId);
      res.json(media);
    } catch (error) {
      console.error("Error fetching media:", error);
      res.status(500).json({ error: "Failed to fetch media" });
    }
  });

  // Delete media
  app.delete("/api/media/:id", async (req, res) => {
    try {
      const userId = "demo-user"; // In real app, get from session/auth
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
  app.get("/api/posts", async (req, res) => {
    try {
      const userId = "demo-user"; // In real app, get from session/auth
      const posts = await storage.getPosts(userId);
      res.json(posts);
    } catch (error) {
      console.error("Error fetching posts:", error);
      res.status(500).json({ error: "Failed to fetch posts" });
    }
  });

  app.post("/api/posts", async (req, res) => {
    try {
      const userId = "demo-user"; // In real app, get from session/auth
      const postData = insertPostSchema.parse({ ...req.body, userId });
      const post = await storage.createPost(postData);
      res.json(post);
    } catch (error) {
      console.error("Error creating post:", error);
      res.status(500).json({ error: "Failed to create post" });
    }
  });

  // Scheduled posts
  app.get("/api/scheduled-posts", async (req, res) => {
    try {
      const userId = "demo-user"; // In real app, get from session/auth
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

  app.post("/api/scheduled-posts", async (req, res) => {
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
  app.get("/api/pages", async (req, res) => {
    try {
      const userId = "demo-user"; // In real app, get from session/auth
      const pages = await storage.getSocialPages(userId);
      res.json(pages);
    } catch (error) {
      console.error("Error fetching pages:", error);
      res.status(500).json({ error: "Failed to fetch pages" });
    }
  });

  app.post("/api/pages", async (req, res) => {
    try {
      const userId = "demo-user"; // In real app, get from session/auth
      const pageData = insertSocialPageSchema.parse({ ...req.body, userId });
      const page = await storage.createSocialPage(pageData);
      res.json(page);
    } catch (error) {
      console.error("Error creating page:", error);
      res.status(500).json({ error: "Failed to create page" });
    }
  });

  // AI Generations
  app.get("/api/ai/generations", async (req, res) => {
    try {
      const userId = "demo-user"; // In real app, get from session/auth
      const generations = await storage.getAiGenerations(userId);
      res.json(generations);
    } catch (error) {
      console.error("Error fetching AI generations:", error);
      res.status(500).json({ error: "Failed to fetch AI generations" });
    }
  });

  // Cloudinary Config
  app.get("/api/cloudinary/config", async (req, res) => {
    try {
      const userId = "demo-user"; // In real app, get from session/auth
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

  app.post("/api/cloudinary/config", async (req, res) => {
    try {
      const userId = "demo-user"; // In real app, get from session/auth
      
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

  // OpenRouter configuration
  app.get("/api/openrouter/config", async (req, res) => {
    try {
      const userId = "demo-user"; // In real app, get from session/auth
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

  app.post("/api/openrouter/config", async (req, res) => {
    try {
      const userId = "demo-user"; // In real app, get from session/auth
      
      const configData = insertOpenrouterConfigSchema.parse({
        ...req.body,
        userId,
      });

      // Check if config already exists
      const existingConfig = await storage.getOpenrouterConfig(userId);
      
      let config;
      if (existingConfig) {
        config = await storage.updateOpenrouterConfig(userId, configData);
      } else {
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
