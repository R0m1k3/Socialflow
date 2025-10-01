import cron, { ScheduledTask } from "node-cron";
import { storage } from "../storage";

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

    // In a real implementation, this would call Facebook/Instagram Graph API
    // For now, we'll simulate the publishing
    console.log(`Publishing post ${post.id} to ${page.platform} page ${page.pageName}`);

    // Update the scheduled post as published
    await storage.updateScheduledPost(scheduledPost.id, {
      publishedAt: new Date(),
      externalPostId: `simulated-${Date.now()}`, // In real app, this would be the ID from FB/IG
    });

    // Update post status
    await storage.updatePost(post.id, {
      status: "published",
    });

    console.log(`Successfully published post ${post.id}`);
  }
}

export const schedulerService = new SchedulerService();
