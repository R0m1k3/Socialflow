import cron, { ScheduledTask } from "node-cron";
import { storage } from "../storage";
import { facebookService } from "./facebook";

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

    // Get media if post has media
    const postMediaList = await storage.getPostMedia(post.id);
    const media = postMediaList.length > 0 ? await storage.getMediaById(postMediaList[0].mediaId) : undefined;

    // Validate that story posts have media
    // Note: "both" should never reach here since they're split at creation
    if (scheduledPost.postType === 'story' && !media) {
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

    // Publish to Facebook/Instagram
    let externalPostId: string;
    
    if (page.platform === 'facebook') {
      externalPostId = await facebookService.publishPost(post, page, scheduledPost.postType, media || undefined);
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

    // Update the scheduled post as published
    await storage.updateScheduledPost(scheduledPost.id, {
      publishedAt: new Date(),
      externalPostId,
    });

    // Update post status
    await storage.updatePost(post.id, {
      status: "published",
    });

    console.log(`Successfully published post ${post.id} with external ID: ${externalPostId}`);
  }
}

export const schedulerService = new SchedulerService();
