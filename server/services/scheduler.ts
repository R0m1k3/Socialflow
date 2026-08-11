import cron, { ScheduledTask } from "node-cron";
import { storage } from "../storage";
import { facebookService } from "./facebook";
import { tiktokService } from "./tiktok";
import { minioService as storageService, readMediaBuffer } from "./minio";

export class SchedulerService {
  private task: ScheduledTask | null = null;

  start() {
    // Run every minute to check for pending posts
    this.task = cron.schedule("* * * * *", async () => {
      await this.processPendingPosts();
    });

    console.log("Scheduler service started");
  }

  stop() {
    if (this.task) {
      this.task.stop();
      console.log("Scheduler service stopped");
    }
  }

  private async processPendingPosts() {
    try {
      const pendingPosts = await storage.getPendingScheduledPosts();

      for (const scheduledPost of pendingPosts) {
        try {
          // Reject legacy "both" posts - they should have been split at creation
          // New posts are automatically split in /api/posts
          if (scheduledPost.postType === 'both') {
            const errorMsg = 'Legacy postType "both" is no longer supported. Deleting this scheduled entry. Please recreate this post - it will automatically be split into separate feed and story posts.';
            console.error(`Rejecting and deleting legacy "both" post ${scheduledPost.id}: ${errorMsg}`);
            
            // Delete the legacy post entirely (don't mark as published - that's misleading)
            await storage.deleteScheduledPost(scheduledPost.id);
            
            // Update parent post status to draft so user can reschedule
            await storage.updatePost(scheduledPost.postId, {
              status: "draft",
            });
            
            continue;
          }
          
          await this.publishPost(scheduledPost);
        } catch (error) {
          console.error(`Error publishing post ${scheduledPost.id}:`, error);
          await storage.updateScheduledPost(scheduledPost.id, {
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    } catch (error) {
      console.error("Error processing pending posts:", error);
    }
  }

  private async publishPost(scheduledPost: any) {
    const post = await storage.getPost(scheduledPost.postId);
    const page = await storage.getSocialPage(scheduledPost.pageId);

    if (!post || !page) {
      throw new Error("Post or page not found");
    }

    console.log(`Publishing post ${post.id} to ${page.platform} page ${page.pageName}`);

    // Get all media for the post (for multi-photo carousels)
    const postMediaList = await storage.getPostMedia(post.id);
    const mediaList: any[] = [];
    for (const pm of postMediaList) {
      const media = await storage.getMediaById(pm.mediaId);
      if (media) {
        mediaList.push(media);
      }
    }

    // Validate that story posts have media
    // Note: "both" should never reach here since they're split at creation
    if (scheduledPost.postType === 'story' && mediaList.length === 0) {
      const errorMsg = 'Les stories nécessitent un média. Ce post ne peut pas être publié.';
      console.error(`Deleting invalid story post ${scheduledPost.id} without media: ${errorMsg}`);
      
      // Delete the invalid scheduled post (don't mark as published - that's misleading)
      await storage.deleteScheduledPost(scheduledPost.id);
      
      // Set post to draft so user can fix and reschedule
      await storage.updatePost(post.id, {
        status: "draft",
      });
      return;
    }

    // Publish to Facebook/Instagram/TikTok
    if (page.platform === 'facebook') {
      const externalPostId = await facebookService.publishPost(post, page, scheduledPost.postType, mediaList);

      // Update the scheduled post as published (clear any previous error)
      await storage.updateScheduledPost(scheduledPost.id, {
        publishedAt: new Date(),
        externalPostId,
        error: null,
      });
    } else if (page.platform === 'tiktok') {
      const publishId = await this.publishToTiktok(post, page, mediaList);

      // TikTok publie de façon asynchrone : on marque l'envoi comme effectué pour
      // ne pas republier à la minute suivante, et le poller de statut renseignera
      // l'identifiant définitif du post.
      await storage.updateScheduledPost(scheduledPost.id, {
        publishedAt: new Date(),
        publishId,
        publishStatus: 'PROCESSING_UPLOAD',
        error: null,
      });
    } else if (page.platform === 'instagram') {
      // Instagram publishing not yet implemented
      console.warn(`Instagram publishing not yet implemented for post ${post.id}`);
      await storage.updateScheduledPost(scheduledPost.id, {
        error: 'Instagram publishing not yet implemented',
      });
      await storage.updatePost(post.id, {
        status: "failed",
      });
      return;
    } else {
      throw new Error(`Unsupported platform: ${page.platform}`);
    }

    // Update post status
    await storage.updatePost(post.id, {
      status: "published",
    });

    // Delete local video files only when no other unpublished scheduled posts reference them
    for (const mediaItem of mediaList) {
      if (mediaItem.type === 'video' && mediaItem.cloudinaryPublicId) {
        try {
          const remainingScheduled = await storage.getScheduledPostsByPost(post.id);
          const hasPending = remainingScheduled.some(sp => !sp.publishedAt);
          if (!hasPending) {
            await storageService.deleteMedia(mediaItem.cloudinaryPublicId, mediaItem.userId, 'video');
            console.log(`[Scheduler] Deleted local video file for media ${mediaItem.id}`);
          } else {
            console.log(`[Scheduler] Kept local video file for media ${mediaItem.id} (pending scheduled posts still exist)`);
          }
        } catch (err) {
          console.warn(`[Scheduler] Failed to delete local video file for media ${mediaItem.id}:`, err);
        }
      }
    }

    console.log(`Successfully published post ${post.id} to ${page.platform} page ${page.pageName}`);
  }

  /**
   * Envoie la vidéo d'un post planifié sur un compte TikTok.
   * TikTok ne sait pas programmer une publication : c'est notre planificateur qui
   * déclenche l'envoi à l'heure voulue.
   *
   * @returns le publish_id à suivre pour connaître le résultat final
   */
  private async publishToTiktok(post: any, page: any, mediaList: any[]): Promise<string> {
    const videoMedia = mediaList.find(m => m.type === 'video');

    if (!videoMedia) {
      throw new Error(
        `Le compte TikTok "${page.pageName}" ne peut recevoir que des vidéos : ce post n'en contient pas.`
      );
    }

    const videoBuffer = await readMediaBuffer(videoMedia.originalUrl);

    return await tiktokService.publishVideoFromBuffer(page, videoBuffer, post.content);
  }
}

export const schedulerService = new SchedulerService();
