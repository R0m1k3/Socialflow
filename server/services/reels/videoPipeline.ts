/**
 * Rendu d'un Reel à partir d'une vidéo : FFmpeg → médiathèque → publication.
 * Exécuté par la file `reel_jobs` (voir queue.ts).
 */

import { videoReelParamsSchema } from "@shared/reel";
import { storage } from "../../storage";
import { ffmpegService } from "../ffmpeg";
import { resolveInternalUrl } from "../minio";
import type { JobContext } from "./queue";
import { resolveGeminiApiKey, resolveLogoPath, resolveMusicUrl } from "./assets";
import { describePublishFailure, publishReelToPages, storeRenderedVideo } from "./publish";

export async function runVideoReelJob({ job, progress }: JobContext) {
  if (!job.postId) throw new Error("Job vidéo sans post associé");
  const postId = job.postId;
  const params = videoReelParamsSchema.parse(job.params);

  await progress(5, "prepare");
  const media = await storage.getMediaById(params.videoMediaId);
  if (!media || media.type !== "video") {
    throw new Error("Vidéo source introuvable ou invalide");
  }

  const [musicUrl, logoPath, geminiApiKey] = await Promise.all([
    resolveMusicUrl(params.musicTrackId, params.musicUrl),
    resolveLogoPath(),
    resolveGeminiApiKey(params.ttsEngine),
  ]);

  await progress(15, "render");
  const startedAt = Date.now();
  const rendered = await ffmpegService.renderReel(resolveInternalUrl(media.originalUrl), {
    text: params.overlayText,
    musicUrl,
    ttsEnabled: params.ttsEnabled,
    ttsVoice: params.ttsVoice,
    ttsEngine: params.ttsEngine,
    ttsStyle: params.ttsStyle,
    geminiApiKey,
    fontSize: params.fontSize,
    musicVolume: params.musicVolume,
    drawText: params.drawText,
    stabilize: params.stabilize,
    watermarkUrl: logoPath ? resolveInternalUrl(logoPath) : undefined,
    storeName: params.storeName,
    enableEndingEffect: params.enableEndingEffect,
  });
  console.log(`⏱️ [Reels] Rendu : ${((Date.now() - startedAt) / 1000).toFixed(1)} s, vidéo de ${rendered.duration.toFixed(1)} s`);

  await progress(65, "store");
  const videoBuffer = rendered.video;
  const processedMedia = await storeRenderedVideo(job.userId, videoBuffer, `reel-${Date.now()}.mp4`);
  await storage.updatePostMedia(postId, [processedMedia.id]);

  await progress(85, "publish");
  const results = await publishReelToPages({
    postId,
    pageIds: params.pageIds,
    videoBuffer,
    description: params.description || params.overlayText || "",
    scheduledFor: params.scheduledFor,
  });

  if (!results.some((r) => r.success)) {
    throw new Error(describePublishFailure(results));
  }

  return { mediaId: processedMedia.id, results };
}
