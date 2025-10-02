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
