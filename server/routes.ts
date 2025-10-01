import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import { openRouterService } from "./services/openrouter";
import { imageProcessor } from "./services/imageProcessor";
import { insertPostSchema, insertScheduledPostSchema, insertSocialPageSchema, insertAiGenerationSchema } from "@shared/schema";
import express from "express";
import path from "path";

const upload = multer({ storage: multer.memoryStorage() });

export async function registerRoutes(app: Express): Promise<Server> {
  // Serve uploaded files
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

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

      const generatedTexts = await openRouterService.generatePostText(productInfo);

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
      
      const originalUrl = await imageProcessor.saveOriginalFile(req.file.buffer, req.file.originalname);
      
      let processedUrls = null;
      if (req.file.mimetype.startsWith("image/")) {
        processedUrls = await imageProcessor.processImage(req.file.buffer, req.file.originalname);
      }

      const mediaItem = await storage.createMedia({
        userId,
        type: req.file.mimetype.startsWith("video/") ? "video" : "image",
        originalUrl,
        facebookFeedUrl: processedUrls?.facebookFeed || null,
        instagramFeedUrl: processedUrls?.instagramFeed || null,
        instagramStoryUrl: processedUrls?.instagramStory || null,
        fileName: req.file.originalname,
        fileSize: req.file.size,
      });

      res.json(mediaItem);
    } catch (error) {
      console.error("Error uploading media:", error);
      res.status(500).json({ error: "Failed to upload media" });
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

  const httpServer = createServer(app);

  return httpServer;
}
