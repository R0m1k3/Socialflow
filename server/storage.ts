import { 
  users, 
  socialPages, 
  media, 
  posts, 
  scheduledPosts,
  aiGenerations,
  cloudinaryConfig,
  type User, 
  type InsertUser,
  type SocialPage,
  type InsertSocialPage,
  type Media,
  type InsertMedia,
  type Post,
  type InsertPost,
  type ScheduledPost,
  type InsertScheduledPost,
  type AiGeneration,
  type InsertAiGeneration,
  type CloudinaryConfig,
  type InsertCloudinaryConfig,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, desc, isNull } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Social Pages
  getSocialPages(userId: string): Promise<SocialPage[]>;
  getSocialPage(id: string): Promise<SocialPage | undefined>;
  createSocialPage(page: InsertSocialPage): Promise<SocialPage>;
  updateSocialPage(id: string, page: Partial<InsertSocialPage>): Promise<SocialPage>;
  deleteSocialPage(id: string): Promise<void>;

  // Media
  getMedia(userId: string): Promise<Media[]>;
  getMediaById(id: string): Promise<Media | undefined>;
  createMedia(media: InsertMedia): Promise<Media>;
  deleteMedia(id: string): Promise<void>;

  // Posts
  getPosts(userId: string): Promise<Post[]>;
  getPost(id: string): Promise<Post | undefined>;
  createPost(post: InsertPost): Promise<Post>;
  updatePost(id: string, post: Partial<InsertPost>): Promise<Post>;
  deletePost(id: string): Promise<void>;

  // Scheduled Posts
  getScheduledPosts(userId: string, startDate?: Date, endDate?: Date): Promise<ScheduledPost[]>;
  getScheduledPost(id: string): Promise<ScheduledPost | undefined>;
  createScheduledPost(scheduledPost: InsertScheduledPost): Promise<ScheduledPost>;
  updateScheduledPost(id: string, scheduledPost: Partial<ScheduledPost>): Promise<ScheduledPost>;
  deleteScheduledPost(id: string): Promise<void>;
  getPendingScheduledPosts(): Promise<ScheduledPost[]>;

  // AI Generations
  getAiGenerations(userId: string): Promise<AiGeneration[]>;
  createAiGeneration(generation: InsertAiGeneration): Promise<AiGeneration>;

  // Cloudinary Config
  getCloudinaryConfig(userId: string): Promise<CloudinaryConfig | undefined>;
  createCloudinaryConfig(config: InsertCloudinaryConfig): Promise<CloudinaryConfig>;
  updateCloudinaryConfig(userId: string, config: Partial<InsertCloudinaryConfig>): Promise<CloudinaryConfig>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  // Social Pages
  async getSocialPages(userId: string): Promise<SocialPage[]> {
    return await db.select().from(socialPages).where(eq(socialPages.userId, userId));
  }

  async getSocialPage(id: string): Promise<SocialPage | undefined> {
    const [page] = await db.select().from(socialPages).where(eq(socialPages.id, id));
    return page || undefined;
  }

  async createSocialPage(page: InsertSocialPage): Promise<SocialPage> {
    const [newPage] = await db.insert(socialPages).values(page).returning();
    return newPage;
  }

  async updateSocialPage(id: string, page: Partial<InsertSocialPage>): Promise<SocialPage> {
    const [updated] = await db.update(socialPages).set(page).where(eq(socialPages.id, id)).returning();
    return updated;
  }

  async deleteSocialPage(id: string): Promise<void> {
    await db.delete(socialPages).where(eq(socialPages.id, id));
  }

  // Media
  async getMedia(userId: string): Promise<Media[]> {
    return await db.select().from(media).where(eq(media.userId, userId)).orderBy(desc(media.createdAt));
  }

  async getMediaById(id: string): Promise<Media | undefined> {
    const [mediaItem] = await db.select().from(media).where(eq(media.id, id));
    return mediaItem || undefined;
  }

  async createMedia(mediaItem: InsertMedia): Promise<Media> {
    const [newMedia] = await db.insert(media).values(mediaItem).returning();
    return newMedia;
  }

  async deleteMedia(id: string): Promise<void> {
    await db.delete(media).where(eq(media.id, id));
  }

  // Posts
  async getPosts(userId: string): Promise<Post[]> {
    return await db.select().from(posts).where(eq(posts.userId, userId)).orderBy(desc(posts.createdAt));
  }

  async getPost(id: string): Promise<Post | undefined> {
    const [post] = await db.select().from(posts).where(eq(posts.id, id));
    return post || undefined;
  }

  async createPost(post: InsertPost): Promise<Post> {
    const [newPost] = await db.insert(posts).values(post).returning();
    return newPost;
  }

  async updatePost(id: string, post: Partial<InsertPost>): Promise<Post> {
    const [updated] = await db.update(posts).set({ ...post, updatedAt: new Date() }).where(eq(posts.id, id)).returning();
    return updated;
  }

  async deletePost(id: string): Promise<void> {
    await db.delete(posts).where(eq(posts.id, id));
  }

  // Scheduled Posts
  async getScheduledPosts(userId: string, startDate?: Date, endDate?: Date): Promise<ScheduledPost[]> {
    let query = db
      .select()
      .from(scheduledPosts)
      .innerJoin(posts, eq(scheduledPosts.postId, posts.id))
      .where(eq(posts.userId, userId));

    if (startDate && endDate) {
      const results = await query;
      return results
        .filter(r => {
          const scheduledAt = new Date(r.scheduled_posts.scheduledAt);
          return scheduledAt >= startDate && scheduledAt <= endDate;
        })
        .map(r => r.scheduled_posts);
    }

    const results = await query;
    return results.map(r => r.scheduled_posts);
  }

  async getScheduledPost(id: string): Promise<ScheduledPost | undefined> {
    const [scheduledPost] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, id));
    return scheduledPost || undefined;
  }

  async createScheduledPost(scheduledPost: InsertScheduledPost): Promise<ScheduledPost> {
    const [newScheduledPost] = await db.insert(scheduledPosts).values(scheduledPost).returning();
    return newScheduledPost;
  }

  async updateScheduledPost(id: string, scheduledPost: Partial<ScheduledPost>): Promise<ScheduledPost> {
    const [updated] = await db.update(scheduledPosts).set(scheduledPost).where(eq(scheduledPosts.id, id)).returning();
    return updated;
  }

  async deleteScheduledPost(id: string): Promise<void> {
    await db.delete(scheduledPosts).where(eq(scheduledPosts.id, id));
  }

  async getPendingScheduledPosts(): Promise<ScheduledPost[]> {
    const now = new Date();
    const results = await db
      .select()
      .from(scheduledPosts)
      .where(
        and(
          isNull(scheduledPosts.publishedAt),
          lte(scheduledPosts.scheduledAt, now)
        )
      );
    return results;
  }

  // AI Generations
  async getAiGenerations(userId: string): Promise<AiGeneration[]> {
    return await db.select().from(aiGenerations).where(eq(aiGenerations.userId, userId)).orderBy(desc(aiGenerations.createdAt));
  }

  async createAiGeneration(generation: InsertAiGeneration): Promise<AiGeneration> {
    const [newGeneration] = await db.insert(aiGenerations).values(generation).returning();
    return newGeneration;
  }

  // Cloudinary Config
  async getCloudinaryConfig(userId: string): Promise<CloudinaryConfig | undefined> {
    const [config] = await db.select().from(cloudinaryConfig).where(eq(cloudinaryConfig.userId, userId));
    return config || undefined;
  }

  async createCloudinaryConfig(config: InsertCloudinaryConfig): Promise<CloudinaryConfig> {
    const [newConfig] = await db.insert(cloudinaryConfig).values(config).returning();
    return newConfig;
  }

  async updateCloudinaryConfig(userId: string, config: Partial<InsertCloudinaryConfig>): Promise<CloudinaryConfig> {
    const [updated] = await db.update(cloudinaryConfig)
      .set({ ...config, updatedAt: new Date() })
      .where(eq(cloudinaryConfig.userId, userId))
      .returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();
