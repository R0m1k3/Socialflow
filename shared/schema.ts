import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, pgEnum, integer } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const platformEnum = pgEnum("platform", ["facebook", "instagram"]);
export const postTypeEnum = pgEnum("post_type", ["feed", "story", "both", "reel"]);
export const postStatusEnum = pgEnum("post_status", ["draft", "scheduled", "published", "failed"]);
export const mediaTypeEnum = pgEnum("media_type", ["image", "video"]);
export const userRoleEnum = pgEnum("user_role", ["admin", "user"]);

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: userRoleEnum("role").notNull().default("user"),
});

// Update existing enums
export const tokenStatusEnum = pgEnum("token_status", ["valid", "expiring", "expired", "error"]);

// ... (existing tables)

export const socialPages = pgTable("social_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  platform: platformEnum("platform").notNull(),
  pageId: text("page_id").notNull(),
  pageName: text("page_name").notNull(),
  accessToken: text("access_token").notNull(),
  tokenExpiresAt: timestamp("token_expires_at"),
  followersCount: integer("followers_count").default(0),
  isActive: text("is_active").notNull().default("true"),

  // NEW FIELDS
  tokenStatus: tokenStatusEnum("token_status").default("valid"),
  lastTokenCheck: timestamp("last_token_check"),

  createdAt: timestamp("created_at").defaultNow(),
});

// ... (existing tables)

// NEW TABLES

export const postAnalytics = pgTable("post_analytics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  postId: varchar("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  fetchedAt: timestamp("fetched_at").defaultNow(),

  // Standard FB Metrics
  impressions: integer("impressions").default(0),
  reach: integer("reach").default(0),
  engagement: integer("engagement").default(0),
  reactions: integer("reactions").default(0),
  comments: integer("comments").default(0),
  shares: integer("shares").default(0),
  clicks: integer("clicks").default(0),

  rawData: jsonb("raw_data"), // Backup of full JSON response
});

export const pageAnalyticsHistory = pgTable("page_analytics_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: varchar("page_id").notNull().references(() => socialPages.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(), // Snapshot date

  followersCount: integer("followers_count").default(0),
  pageViews: integer("page_views").default(0),
  pageReach: integer("page_reach").default(0),

  createdAt: timestamp("created_at").defaultNow(),
});

// Relations Updates



// Insert Schemas Updates

export const insertSocialPageSchema = createInsertSchema(socialPages).omit({
  id: true,
  createdAt: true,
  tokenStatus: true,     // Managed by System
  lastTokenCheck: true,  // Managed by System
});

export const insertPostAnalyticsSchema = createInsertSchema(postAnalytics).omit({
  id: true,
  fetchedAt: true,
});

export const insertPageAnalyticsHistorySchema = createInsertSchema(pageAnalyticsHistory).omit({
  id: true,
  createdAt: true,
});

// Types

export type PostAnalytics = typeof postAnalytics.$inferSelect;
export type InsertPostAnalytics = z.infer<typeof insertPostAnalyticsSchema>;

export type PageAnalyticsHistory = typeof pageAnalyticsHistory.$inferSelect;
export type InsertPageAnalyticsHistory = z.infer<typeof insertPageAnalyticsHistorySchema>;

// ... (rest of existing types)

export type UserPagePermission = typeof userPagePermissions.$inferSelect;
export type InsertUserPagePermission = z.infer<typeof insertUserPagePermissionSchema>;


export const cloudinaryConfig = pgTable("cloudinary_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  cloudName: text("cloud_name").notNull(),
  apiKey: text("api_key").notNull(),
  apiSecret: text("api_secret").notNull(),
  logoPublicId: text("logo_public_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const openrouterConfig = pgTable("openrouter_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  apiKey: text("api_key").notNull(),
  model: text("model").notNull().default("anthropic/claude-3.5-sonnet"),
  systemPrompt: text("system_prompt").notNull().default("Tu es un expert en marketing des réseaux sociaux. Génère 3 variations de textes engageants pour des publications Facebook et Instagram à partir des informations produit fournies. Chaque variation doit être unique, captivante et optimisée pour l'engagement."),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const freesoundConfig = pgTable("freesound_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  clientSecret: text("client_secret").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const media = pgTable("media", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: mediaTypeEnum("type").notNull(),
  cloudinaryPublicId: text("cloudinary_public_id"),
  originalUrl: text("original_url").notNull(),
  facebookLandscapeUrl: text("facebook_landscape_url"),
  facebookFeedUrl: text("facebook_feed_url"),
  instagramFeedUrl: text("instagram_feed_url"),
  instagramStoryUrl: text("instagram_story_url"),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const posts = pgTable("posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  aiGenerated: text("ai_generated").notNull().default("false"),
  productInfo: jsonb("product_info"),
  status: postStatusEnum("status").notNull().default("draft"),
  scheduledFor: timestamp("scheduled_for"),
  // Reel generation tracking
  generationStatus: text("generation_status"),  // 'pending' | 'processing' | 'completed' | 'failed'
  generationProgress: integer("generation_progress").default(0),
  generationError: text("generation_error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const postMedia = pgTable("post_media", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  postId: varchar("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  mediaId: varchar("media_id").notNull().references(() => media.id, { onDelete: "cascade" }),
  displayOrder: integer("display_order").notNull().default(0),
});

export const scheduledPosts = pgTable("scheduled_posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  postId: varchar("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  pageId: varchar("page_id").notNull().references(() => socialPages.id, { onDelete: "cascade" }),
  postType: postTypeEnum("post_type").notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  publishedAt: timestamp("published_at"),
  externalPostId: text("external_post_id"),
  error: text("error"),
});

export const aiGenerations = pgTable("ai_generations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  productInfo: jsonb("product_info").notNull(),
  generatedTexts: jsonb("generated_texts").notNull(),
  selectedText: text("selected_text"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const musicFavorites = pgTable("music_favorites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  trackId: text("track_id").notNull(),
  title: text("title").notNull(),
  artist: text("artist").notNull(),
  albumName: text("album_name"),
  duration: integer("duration").notNull(),
  previewUrl: text("preview_url").notNull(),
  downloadUrl: text("download_url").notNull(),
  imageUrl: text("image_url"),
  license: text("license"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userPagePermissions = pgTable("user_page_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  pageId: varchar("page_id").notNull().references(() => socialPages.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const socialPagesRelations = relations(socialPages, ({ one, many }) => ({
  user: one(users, {
    fields: [socialPages.userId],
    references: [users.id],
  }),
  scheduledPosts: many(scheduledPosts),
  userPermissions: many(userPagePermissions),
  analyticsHistory: many(pageAnalyticsHistory), // Relation
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  user: one(users, {
    fields: [posts.userId],
    references: [users.id],
  }),
  postMedia: many(postMedia),
  scheduledPosts: many(scheduledPosts),
  analytics: many(postAnalytics), // Relation
}));

export const postAnalyticsRelations = relations(postAnalytics, ({ one }) => ({
  post: one(posts, {
    fields: [postAnalytics.postId],
    references: [posts.id],
  }),
}));

export const pageAnalyticsHistoryRelations = relations(pageAnalyticsHistory, ({ one }) => ({
  page: one(socialPages, {
    fields: [pageAnalyticsHistory.pageId],
    references: [socialPages.id],
  }),
}));

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  socialPages: many(socialPages),
  media: many(media),
  posts: many(posts),
  aiGenerations: many(aiGenerations),
  pagePermissions: many(userPagePermissions),
  cloudinaryConfig: one(cloudinaryConfig),
  openrouterConfig: one(openrouterConfig),
  freesoundConfig: one(freesoundConfig),
}));

export const cloudinaryConfigRelations = relations(cloudinaryConfig, ({ one }) => ({
  user: one(users, {
    fields: [cloudinaryConfig.userId],
    references: [users.id],
  }),
}));

export const openrouterConfigRelations = relations(openrouterConfig, ({ one }) => ({
  user: one(users, {
    fields: [openrouterConfig.userId],
    references: [users.id],
  }),
}));



export const mediaRelations = relations(media, ({ one, many }) => ({
  user: one(users, {
    fields: [media.userId],
    references: [users.id],
  }),
  postMedia: many(postMedia),
}));



export const postMediaRelations = relations(postMedia, ({ one }) => ({
  post: one(posts, {
    fields: [postMedia.postId],
    references: [posts.id],
  }),
  media: one(media, {
    fields: [postMedia.mediaId],
    references: [media.id],
  }),
}));

export const scheduledPostsRelations = relations(scheduledPosts, ({ one }) => ({
  post: one(posts, {
    fields: [scheduledPosts.postId],
    references: [posts.id],
  }),
  page: one(socialPages, {
    fields: [scheduledPosts.pageId],
    references: [socialPages.id],
  }),
}));

export const aiGenerationsRelations = relations(aiGenerations, ({ one }) => ({
  user: one(users, {
    fields: [aiGenerations.userId],
    references: [users.id],
  }),
}));

export const musicFavoritesRelations = relations(musicFavorites, ({ one }) => ({
  user: one(users, {
    fields: [musicFavorites.userId],
    references: [users.id],
  }),
}));

export const userPagePermissionsRelations = relations(userPagePermissions, ({ one }) => ({
  user: one(users, {
    fields: [userPagePermissions.userId],
    references: [users.id],
  }),
  page: one(socialPages, {
    fields: [userPagePermissions.pageId],
    references: [socialPages.id],
  }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  role: true,
});



export const insertMediaSchema = createInsertSchema(media).omit({
  id: true,
  createdAt: true,
});

export const insertPostSchema = createInsertSchema(posts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertScheduledPostSchema = createInsertSchema(scheduledPosts).omit({
  id: true,
  publishedAt: true,
  externalPostId: true,
  error: true,
});

export const insertAiGenerationSchema = createInsertSchema(aiGenerations).omit({
  id: true,
  createdAt: true,
});

export const insertCloudinaryConfigSchema = createInsertSchema(cloudinaryConfig).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOpenrouterConfigSchema = createInsertSchema(openrouterConfig).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateOpenrouterConfigSchema = insertOpenrouterConfigSchema.partial({
  apiKey: true,
});

export const updateCloudinaryConfigSchema = insertCloudinaryConfigSchema.partial({
  apiKey: true,
  apiSecret: true,
});

export const insertUserPagePermissionSchema = createInsertSchema(userPagePermissions).omit({
  id: true,
  createdAt: true,
});

export const insertPostMediaSchema = createInsertSchema(postMedia).omit({
  id: true,
});

export const insertMusicFavoriteSchema = createInsertSchema(musicFavorites).omit({
  id: true,
  createdAt: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type SocialPage = typeof socialPages.$inferSelect;
export type InsertSocialPage = z.infer<typeof insertSocialPageSchema>;

export type Media = typeof media.$inferSelect;
export type InsertMedia = z.infer<typeof insertMediaSchema>;

export type Post = typeof posts.$inferSelect;
export type InsertPost = z.infer<typeof insertPostSchema>;

export type ScheduledPost = typeof scheduledPosts.$inferSelect;
export type InsertScheduledPost = z.infer<typeof insertScheduledPostSchema>;

export type AiGeneration = typeof aiGenerations.$inferSelect;
export type InsertAiGeneration = z.infer<typeof insertAiGenerationSchema>;

export type CloudinaryConfig = typeof cloudinaryConfig.$inferSelect;
export type InsertCloudinaryConfig = z.infer<typeof insertCloudinaryConfigSchema>;
export type UpdateCloudinaryConfig = z.infer<typeof updateCloudinaryConfigSchema>;

export type OpenrouterConfig = typeof openrouterConfig.$inferSelect;
export type InsertOpenrouterConfig = z.infer<typeof insertOpenrouterConfigSchema>;
export type UpdateOpenrouterConfig = z.infer<typeof updateOpenrouterConfigSchema>;

export type PostMedia = typeof postMedia.$inferSelect;
export type InsertPostMedia = z.infer<typeof insertPostMediaSchema>;

export type MusicFavorite = typeof musicFavorites.$inferSelect;
export type InsertMusicFavorite = z.infer<typeof insertMusicFavoriteSchema>;

export const insertFreesoundConfigSchema = createInsertSchema(freesoundConfig).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateFreesoundConfigSchema = insertFreesoundConfigSchema.omit({
  userId: true
}).partial({
  clientId: true,
  clientSecret: true,
});

export type FreesoundConfig = typeof freesoundConfig.$inferSelect;
export type InsertFreesoundConfig = z.infer<typeof insertFreesoundConfigSchema>;
export type UpdateFreesoundConfig = z.infer<typeof updateFreesoundConfigSchema>;


