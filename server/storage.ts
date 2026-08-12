import {
  users,
  socialPages,
  media,
  posts,
  postMedia,
  scheduledPosts,
  aiGenerations,
  cloudinaryConfig,
  openrouterConfig,
  userPagePermissions,
  type User,
  type InsertUser,
  type SocialPage,
  type InsertSocialPage,
  type Media,
  type InsertMedia,
  type Post,
  type InsertPost,
  type PostMedia,
  type ScheduledPost,
  type InsertScheduledPost,
  type AiGeneration,
  type InsertAiGeneration,
  type CloudinaryConfig,
  type InsertCloudinaryConfig,
  type OpenrouterConfig,
  type InsertOpenrouterConfig,
  type UserPagePermission,
  type InsertUserPagePermission,
  musicFavorites,
  type MusicFavorite,
  type InsertMusicFavorite,
  audioTracks,
  type AudioTrack,
  type InsertAudioTrack,
  appConfig,
  type AppConfig,
  tiktokConfig,
  type TiktokConfig,
  type InsertTiktokConfig,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, desc, asc, isNull, isNotNull, inArray, notInArray } from "drizzle-orm";
import { encrypt, decrypt, isEncrypted } from "./utils/encryption";

/**
 * Statuts de publication asynchrone (TikTok) qui ne bougeront plus : inutile de
 * continuer à interroger l'API une fois l'un d'eux atteint.
 */
export const TERMINAL_PUBLISH_STATUSES: string[] = [
  'PUBLISH_COMPLETE',
  'FAILED',
  // Vidéo déposée dans la boîte de réception du créateur : elle attend une action
  // manuelle dans TikTok et n'évoluera plus côté API.
  'SEND_TO_USER_INBOX',
];

/**
 * Déchiffre les tokens d'une page avant de la rendre au reste de l'application.
 * Les services (Facebook, TikTok) manipulent toujours des tokens en clair.
 */
function decryptPageTokens(page: SocialPage): SocialPage {
  return {
    ...page,
    accessToken: decrypt(page.accessToken),
    refreshToken: page.refreshToken ? decrypt(page.refreshToken) : page.refreshToken,
  };
}

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, user: Partial<InsertUser>): Promise<User>;
  deleteUser(id: string): Promise<void>;

  // Social Pages
  getSocialPages(userId: string): Promise<SocialPage[]>;
  getSocialPage(id: string): Promise<SocialPage | undefined>;
  createSocialPage(page: InsertSocialPage): Promise<SocialPage>;
  updateSocialPage(id: string, page: Partial<SocialPage>): Promise<SocialPage>;
  deleteSocialPage(id: string): Promise<void>;

  // Media
  getMedia(userId: string): Promise<Media[]>;
  getMediaById(id: string): Promise<Media | undefined>;
  createMedia(media: InsertMedia): Promise<Media>;
  deleteMedia(id: string): Promise<void>;
  getPostMedia(postId: string): Promise<PostMedia[]>;

  // Posts
  getPosts(userId: string): Promise<Post[]>;
  getPost(id: string): Promise<Post | undefined>;
  getPostWithMedia(id: string): Promise<{ post: Post; media: Media[] } | undefined>;
  createPost(post: InsertPost): Promise<Post>;
  updatePost(id: string, post: Partial<InsertPost>): Promise<Post>;
  updatePostGenerationStatus(id: string, status: string, progress: number, error?: string): Promise<Post>;
  deletePost(id: string): Promise<void>;
  updatePostMedia(postId: string, mediaIds: string[]): Promise<void>;
  countProcessingReels(): Promise<number>;
  getNextPendingReel(): Promise<Post | undefined>;

  // Scheduled Posts
  getScheduledPosts(userId: string, startDate?: Date, endDate?: Date): Promise<ScheduledPost[]>;
  getScheduledPostsByPages(pageIds: string[], startDate?: Date, endDate?: Date): Promise<ScheduledPost[]>;
  getScheduledPost(id: string): Promise<ScheduledPost | undefined>;
  getScheduledPostsByPost(postId: string): Promise<ScheduledPost[]>;
  createScheduledPost(scheduledPost: InsertScheduledPost): Promise<ScheduledPost>;
  updateScheduledPost(id: string, scheduledPost: Partial<ScheduledPost>): Promise<ScheduledPost>;
  deleteScheduledPost(id: string): Promise<void>;
  getPendingScheduledPosts(): Promise<ScheduledPost[]>;
  getScheduledPostsAwaitingPublishStatus(): Promise<ScheduledPost[]>;

  // AI Generations
  getAiGenerations(userId: string): Promise<AiGeneration[]>;
  createAiGeneration(generation: InsertAiGeneration): Promise<AiGeneration>;

  // TikTok Config
  getTiktokConfig(): Promise<TiktokConfig | undefined>;
  upsertTiktokConfig(config: Partial<InsertTiktokConfig>): Promise<TiktokConfig>;

  // Cloudinary Config
  getCloudinaryConfig(): Promise<CloudinaryConfig | undefined>;
  createCloudinaryConfig(config: InsertCloudinaryConfig): Promise<CloudinaryConfig>;
  updateCloudinaryConfig(config: Partial<InsertCloudinaryConfig>): Promise<CloudinaryConfig>;

  // OpenRouter Config
  getOpenrouterConfig(userId: string): Promise<OpenrouterConfig | undefined>;
  getAnyOpenrouterConfig(): Promise<OpenrouterConfig | undefined>;
  createOpenrouterConfig(config: InsertOpenrouterConfig): Promise<OpenrouterConfig>;
  updateOpenrouterConfig(userId: string, config: Partial<InsertOpenrouterConfig>): Promise<OpenrouterConfig>;

  // User Page Permissions
  getUserPagePermissions(userId: string): Promise<UserPagePermission[]>;
  getPagePermissions(pageId: string): Promise<UserPagePermission[]>;
  createPagePermission(permission: InsertUserPagePermission): Promise<UserPagePermission>;
  deletePagePermission(userId: string, pageId: string): Promise<void>;
  deleteAllUserPagePermissions(userId: string): Promise<void>;
  getUserAccessiblePages(userId: string): Promise<SocialPage[]>;

  // Music Favorites
  getMusicFavorites(userId: string): Promise<MusicFavorite[]>;
  addMusicFavorite(favorite: InsertMusicFavorite): Promise<MusicFavorite>;
  removeMusicFavorite(userId: string, trackId: string): Promise<void>;
  isMusicFavorite(userId: string, trackId: string): Promise<boolean>;

  // Audio Tracks
  getAudioTracks(): Promise<AudioTrack[]>;
  // Audio Tracks
  getAudioTrack(id: string): Promise<AudioTrack | undefined>;
  createAudioTrack(track: InsertAudioTrack): Promise<AudioTrack>;
  deleteAudioTrack(id: string): Promise<void>;

  // App Config
  getAppConfig(): Promise<AppConfig | undefined>;
  upsertAppConfig(data: Partial<Pick<AppConfig, 'externalApiKey' | 'geminiApiKey'>>): Promise<AppConfig>;
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

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: string, updateData: Partial<InsertUser>): Promise<User> {
    const [updated] = await db.update(users).set(updateData).where(eq(users.id, id)).returning();
    return updated;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  // Social Pages
  async getSocialPages(userId: string): Promise<SocialPage[]> {
    const pages = await db.select().from(socialPages).where(eq(socialPages.userId, userId));
    return pages.map(page => decryptPageTokens(page));
  }

  async getSocialPage(id: string): Promise<SocialPage | undefined> {
    const [page] = await db.select().from(socialPages).where(eq(socialPages.id, id));
    return page ? decryptPageTokens(page) : undefined;
  }

  async createSocialPage(page: InsertSocialPage): Promise<SocialPage> {
    // Chiffrer les tokens avant stockage
    const encryptedPage = {
      ...page,
      accessToken: encrypt(page.accessToken),
      ...(page.refreshToken ? { refreshToken: encrypt(page.refreshToken) } : {}),
    };
    const [newPage] = await db.insert(socialPages).values(encryptedPage).returning();
    return decryptPageTokens(newPage);
  }

  async updateSocialPage(id: string, page: Partial<SocialPage>): Promise<SocialPage> {
    // Chiffrer les tokens présents dans la mise à jour
    const updateData: Partial<SocialPage> = { ...page };
    if (page.accessToken) {
      updateData.accessToken = encrypt(page.accessToken);
    }
    if (page.refreshToken) {
      updateData.refreshToken = encrypt(page.refreshToken);
    }
    const [updated] = await db.update(socialPages).set(updateData).where(eq(socialPages.id, id)).returning();
    return decryptPageTokens(updated);
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

  async getPostMedia(postId: string): Promise<PostMedia[]> {
    return await db.select().from(postMedia).where(eq(postMedia.postId, postId)).orderBy(asc(postMedia.displayOrder));
  }

  // Posts
  async getPosts(userId: string): Promise<Post[]> {
    return await db.select().from(posts).where(eq(posts.userId, userId)).orderBy(desc(posts.createdAt));
  }

  async getPost(id: string): Promise<Post | undefined> {
    const [post] = await db.select().from(posts).where(eq(posts.id, id));
    return post || undefined;
  }

  async getPostWithMedia(id: string): Promise<{ post: Post; media: Media[] } | undefined> {
    const post = await this.getPost(id);
    if (!post) return undefined;

    const postMediaLinks = await this.getPostMedia(id);
    const mediaItems: Media[] = [];

    for (const link of postMediaLinks) {
      const mediaItem = await this.getMediaById(link.mediaId);
      if (mediaItem) {
        mediaItems.push(mediaItem);
      }
    }

    return { post, media: mediaItems };
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

  async updatePostGenerationStatus(
    id: string,
    status: string,
    progress: number,
    error?: string
  ): Promise<Post> {
    const updateData: Record<string, unknown> = {
      generationStatus: status,
      generationProgress: progress,
      updatedAt: new Date(),
    };
    if (error !== undefined) {
      updateData.generationError = error;
    }
    const [updated] = await db
      .update(posts)
      .set(updateData)
      .where(eq(posts.id, id))
      .returning();
    return updated;
  }

  async updatePostMedia(postId: string, mediaIds: string[]): Promise<void> {
    await db.delete(postMedia).where(eq(postMedia.postId, postId));

    if (mediaIds.length > 0) {
      const postMediaEntries = mediaIds.map((mediaId, index) => ({
        postId,
        mediaId,
        displayOrder: index,
      }));
      await db.insert(postMedia).values(postMediaEntries);
    }
  }

  async countProcessingReels(): Promise<number> {
    const processing = await db
      .select()
      .from(posts)
      .where(eq(posts.generationStatus, "processing"));
    return processing.length;
  }

  async getNextPendingReel(): Promise<Post | undefined> {
    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.generationStatus, "pending"))
      .orderBy(asc(posts.createdAt))
      .limit(1);
    return post || undefined;
  }

  // Scheduled Posts
  async getScheduledPosts(userId: string, startDate?: Date, endDate?: Date): Promise<any[]> {
    let query = db
      .select()
      .from(scheduledPosts)
      .innerJoin(posts, eq(scheduledPosts.postId, posts.id))
      .leftJoin(socialPages, eq(scheduledPosts.pageId, socialPages.id))
      .where(eq(posts.userId, userId));

    if (startDate && endDate) {
      const results = await query;
      return results
        .filter(r => {
          const scheduledAt = new Date(r.scheduled_posts.scheduledAt);
          return scheduledAt >= startDate && scheduledAt <= endDate;
        })
        .map(r => ({
          ...r.scheduled_posts,
          post: r.posts,
          page: r.social_pages,
        }));
    }

    const results = await query;
    return results.map(r => ({
      ...r.scheduled_posts,
      post: r.posts,
      page: r.social_pages,
    }));
  }

  async getScheduledPostsByPages(pageIds: string[], startDate?: Date, endDate?: Date): Promise<any[]> {
    if (pageIds.length === 0) {
      return [];
    }

    let query = db
      .select()
      .from(scheduledPosts)
      .innerJoin(posts, eq(scheduledPosts.postId, posts.id))
      .leftJoin(socialPages, eq(scheduledPosts.pageId, socialPages.id))
      .where(inArray(scheduledPosts.pageId, pageIds));

    if (startDate && endDate) {
      const results = await query;
      return results
        .filter(r => {
          const scheduledAt = new Date(r.scheduled_posts.scheduledAt);
          return scheduledAt >= startDate && scheduledAt <= endDate;
        })
        .map(r => ({
          ...r.scheduled_posts,
          post: r.posts,
          page: r.social_pages,
        }));
    }

    const results = await query;
    return results.map(r => ({
      ...r.scheduled_posts,
      post: r.posts,
      page: r.social_pages,
    }));
  }

  async getScheduledPost(id: string): Promise<ScheduledPost | undefined> {
    const [scheduledPost] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, id));
    return scheduledPost || undefined;
  }

  async getScheduledPostsByPost(postId: string): Promise<ScheduledPost[]> {
    return await db.select().from(scheduledPosts).where(eq(scheduledPosts.postId, postId));
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

  /**
   * Publications déjà envoyées à TikTok dont le statut final n'est pas encore
   * connu (l'API répond de façon asynchrone via un publish_id).
   */
  async getScheduledPostsAwaitingPublishStatus(): Promise<ScheduledPost[]> {
    return await db
      .select()
      .from(scheduledPosts)
      .where(
        and(
          isNotNull(scheduledPosts.publishId),
          notInArray(scheduledPosts.publishStatus, TERMINAL_PUBLISH_STATUSES)
        )
      );
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
  async getCloudinaryConfig(): Promise<CloudinaryConfig | undefined> {
    const [config] = await db.select().from(cloudinaryConfig).limit(1);
    return config || undefined;
  }

  async createCloudinaryConfig(config: InsertCloudinaryConfig): Promise<CloudinaryConfig> {
    const [newConfig] = await db.insert(cloudinaryConfig).values(config).returning();
    return newConfig;
  }

  async updateCloudinaryConfig(config: Partial<InsertCloudinaryConfig>): Promise<CloudinaryConfig> {
    const existingConfig = await this.getCloudinaryConfig();
    if (!existingConfig) throw new Error("Cloudinary config not initialized");

    const [updated] = await db.update(cloudinaryConfig)
      .set({ ...config, updatedAt: new Date() })
      .where(eq(cloudinaryConfig.id, existingConfig.id))
      .returning();
    return updated;
  }

  // OpenRouter Config
  async getOpenrouterConfig(userId: string): Promise<OpenrouterConfig | undefined> {
    const [config] = await db.select().from(openrouterConfig).where(eq(openrouterConfig.userId, userId));
    return config || undefined;
  }

  async getAnyOpenrouterConfig(): Promise<OpenrouterConfig | undefined> {
    const [config] = await db.select().from(openrouterConfig).orderBy(desc(openrouterConfig.updatedAt)).limit(1);
    return config || undefined;
  }

  async createOpenrouterConfig(config: InsertOpenrouterConfig): Promise<OpenrouterConfig> {
    const [newConfig] = await db.insert(openrouterConfig).values(config).returning();
    return newConfig;
  }

  async updateOpenrouterConfig(userId: string, config: Partial<InsertOpenrouterConfig>): Promise<OpenrouterConfig> {
    const [updated] = await db.update(openrouterConfig)
      .set({ ...config, updatedAt: new Date() })
      .where(eq(openrouterConfig.userId, userId))
      .returning();
    return updated;
  }

  // User Page Permissions
  async getUserPagePermissions(userId: string): Promise<UserPagePermission[]> {
    return await db.select().from(userPagePermissions).where(eq(userPagePermissions.userId, userId));
  }

  async getPagePermissions(pageId: string): Promise<UserPagePermission[]> {
    return await db.select().from(userPagePermissions).where(eq(userPagePermissions.pageId, pageId));
  }

  async createPagePermission(permission: InsertUserPagePermission): Promise<UserPagePermission> {
    const [newPermission] = await db.insert(userPagePermissions).values(permission).returning();
    return newPermission;
  }

  async deletePagePermission(userId: string, pageId: string): Promise<void> {
    await db.delete(userPagePermissions).where(
      and(
        eq(userPagePermissions.userId, userId),
        eq(userPagePermissions.pageId, pageId)
      )
    );
  }

  async deleteAllUserPagePermissions(userId: string): Promise<void> {
    await db.delete(userPagePermissions).where(eq(userPagePermissions.userId, userId));
  }

  async getUserAccessiblePages(userId: string): Promise<SocialPage[]> {
    const permissions = await db
      .select()
      .from(userPagePermissions)
      .innerJoin(socialPages, eq(userPagePermissions.pageId, socialPages.id))
      .where(eq(userPagePermissions.userId, userId));

    return permissions.map(p => p.social_pages);
  }

  // Music Favorites
  async getMusicFavorites(userId: string): Promise<MusicFavorite[]> {
    return db.select().from(musicFavorites)
      .where(eq(musicFavorites.userId, userId))
      .orderBy(desc(musicFavorites.createdAt));
  }

  async addMusicFavorite(favorite: InsertMusicFavorite): Promise<MusicFavorite> {
    const [created] = await db.insert(musicFavorites).values(favorite).returning();
    return created;
  }

  async removeMusicFavorite(userId: string, trackId: string): Promise<void> {
    await db.delete(musicFavorites).where(
      and(
        eq(musicFavorites.userId, userId),
        eq(musicFavorites.trackId, trackId)
      )
    );
  }

  async isMusicFavorite(userId: string, trackId: string): Promise<boolean> {
    const [fav] = await db.select().from(musicFavorites).where(
      and(
        eq(musicFavorites.userId, userId),
        eq(musicFavorites.trackId, trackId)
      )
    );
    return !!fav;
  }

  // Audio Tracks
  async getAudioTracks(): Promise<AudioTrack[]> {
    return db.select().from(audioTracks).orderBy(desc(audioTracks.createdAt));
  }

  async getAudioTrack(id: string): Promise<AudioTrack | undefined> {
    const [track] = await db.select().from(audioTracks).where(eq(audioTracks.id, id));
    return track || undefined;
  }

  async createAudioTrack(track: InsertAudioTrack): Promise<AudioTrack> {
    const [newTrack] = await db.insert(audioTracks).values(track).returning();
    return newTrack;
  }

  async deleteAudioTrack(id: string): Promise<void> {
    await db.delete(audioTracks).where(eq(audioTracks.id, id));
  }

  // App Config
  async getAppConfig(): Promise<AppConfig | undefined> {
    const [config] = await db.select().from(appConfig).limit(1);
    return config || undefined;
  }

  // TikTok Config
  async getTiktokConfig(): Promise<TiktokConfig | undefined> {
    const [config] = await db.select().from(tiktokConfig).limit(1);
    if (!config) return undefined;
    return { ...config, clientSecret: decrypt(config.clientSecret) };
  }

  async upsertTiktokConfig(data: Partial<InsertTiktokConfig>): Promise<TiktokConfig> {
    const values: Partial<TiktokConfig> = { ...data };
    if (data.clientSecret) {
      values.clientSecret = encrypt(data.clientSecret);
    }

    const [existing] = await db.select().from(tiktokConfig).limit(1);
    if (existing) {
      const [updated] = await db.update(tiktokConfig)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(tiktokConfig.id, existing.id))
        .returning();
      return { ...updated, clientSecret: decrypt(updated.clientSecret) };
    }

    if (!values.clientKey || !values.clientSecret) {
      throw new Error("Le client key et le client secret TikTok sont requis");
    }

    const [created] = await db.insert(tiktokConfig)
      .values({ clientKey: values.clientKey, clientSecret: values.clientSecret })
      .returning();
    return { ...created, clientSecret: decrypt(created.clientSecret) };
  }

  async upsertAppConfig(data: Partial<Pick<AppConfig, 'externalApiKey' | 'geminiApiKey'>>): Promise<AppConfig> {
    const existing = await this.getAppConfig();
    if (existing) {
      const [updated] = await db.update(appConfig)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(appConfig.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(appConfig).values(data).returning();
    return created;
  }
}

export const storage = new DatabaseStorage();
