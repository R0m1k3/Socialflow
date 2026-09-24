/**
 * Enregistrement et publication d'un Reel rendu, commun aux Reels vidéo et
 * images.
 *
 * La vidéo est toujours envoyée en binaire : les fichiers vivent sous
 * /uploads, une URL relative que Facebook ne peut pas télécharger (c'était le
 * cas de l'ancien `publishReel(originalUrl)`).
 */

import type { Media } from "@shared/schema";
import { storage } from "../../storage";
import { minioService } from "../minio";
import { createVideoThumbnail } from "../thumbnail";
import { facebookService } from "../facebook";
import { tiktokService } from "../tiktok";

export interface PagePublishResult {
  pageId: string;
  success: boolean;
  reelId?: string;
  error?: string;
}

/** Range la vidéo rendue dans la médiathèque, avec sa vignette. */
export async function storeRenderedVideo(
  userId: string,
  videoBuffer: Buffer,
  fileName: string,
): Promise<Media> {
  const uploaded = await minioService.uploadMedia(videoBuffer, fileName, userId, "video/mp4");
  // Vignette extraite maintenant : la vidéo sera supprimée du disque après
  // publication, mais l'historique doit rester illustré.
  const thumbnailUrl = await createVideoThumbnail(videoBuffer);

  return storage.createMedia({
    userId,
    type: "video",
    cloudinaryPublicId: uploaded.publicId,
    originalUrl: uploaded.originalUrl,
    facebookFeedUrl: uploaded.facebookFeedUrl,
    instagramFeedUrl: uploaded.instagramFeedUrl,
    instagramStoryUrl: uploaded.instagramStoryUrl,
    thumbnailUrl,
    fileName,
    fileSize: videoBuffer.length,
  });
}

/**
 * Publie (ou planifie) la vidéo sur chaque page, crée les entrées
 * `scheduled_posts` et met à jour le statut du post.
 */
export async function publishReelToPages(options: {
  postId: string;
  pageIds: string[];
  videoBuffer: Buffer;
  description: string;
  scheduledFor?: string;
}): Promise<PagePublishResult[]> {
  const { postId, pageIds, videoBuffer, description, scheduledFor } = options;
  const results: PagePublishResult[] = [];

  for (const pageId of pageIds) {
    try {
      const page = await storage.getSocialPage(pageId);
      if (!page) {
        results.push({ pageId, success: false, error: "Page non trouvée" });
        continue;
      }
      if (page.platform !== "facebook" && page.platform !== "tiktok") {
        results.push({
          pageId,
          success: false,
          error: `Plateforme non supportée pour les reels : ${page.platform}`,
        });
        continue;
      }

      const scheduledPost = await storage.createScheduledPost({
        postId,
        pageId: page.id,
        postType: "reel",
        scheduledAt: scheduledFor ? new Date(scheduledFor) : new Date(),
      });

      if (scheduledFor) {
        // Le planificateur publiera à l'heure dite
        results.push({ pageId, success: true, reelId: "scheduled" });
        continue;
      }

      console.log(`🚀 [Reels] Publication sur ${page.platform} ${page.pageName}...`);
      if (page.platform === "facebook") {
        const reelId = await facebookService.publishVideoFromBuffer(page, videoBuffer, description);
        await storage.updateScheduledPost(scheduledPost.id, {
          publishedAt: new Date(),
          externalPostId: reelId,
        });
        results.push({ pageId, success: true, reelId });
      } else {
        // TikTok finalise la publication de son côté : l'envoi est marqué comme
        // effectué pour ne pas republier, et le poller de statut renseignera
        // l'identifiant définitif du post.
        const publishId = await tiktokService.publishVideoFromBuffer(page, videoBuffer, description);
        await storage.updateScheduledPost(scheduledPost.id, {
          publishedAt: new Date(),
          publishId,
          publishStatus: "PROCESSING_UPLOAD",
        });
        results.push({ pageId, success: true, reelId: publishId });
      }
    } catch (error) {
      console.error(`❌ [Reels] Publication sur la page ${pageId} impossible :`, error);
      results.push({
        pageId,
        success: false,
        error: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const status = scheduledFor && succeeded > 0 ? "scheduled" : succeeded > 0 ? "published" : "failed";
  await storage.updatePost(postId, { status });

  return results;
}

/** Message d'erreur lisible lorsque toutes les publications ont échoué. */
export function describePublishFailure(results: PagePublishResult[]): string {
  const details = results.map((r) => r.error).filter(Boolean).join(" ; ");
  return `Publication impossible sur toutes les pages${details ? ` : ${details}` : ""}`;
}
