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
  const rendered = await ffmpegService.processReelFromUrl(resolveInternalUrl(media.originalUrl), {
    text: params.overlayText,
    musicUrl,
    ttsEnabled: params.ttsEnabled,
    ttsVoice: params.ttsVoice,
    ttsEngine: params.ttsEngine,
    geminiApiKey,
    wordDuration: params.wordDuration,
    fontSize: params.fontSize,
    musicVolume: params.musicVolume,
    drawText: params.drawText,
    stabilize: params.stabilize,
    watermarkUrl: logoPath ? resolveInternalUrl(logoPath) : undefined,
    storeName: params.storeName,
    enableEndingEffect: params.enableEndingEffect,
  });
  console.log(`⏱️ [Reels] FFmpeg : ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);

  if (!rendered.success || !rendered.videoBase64) {
    throw new Error(rendered.error || "Erreur de traitement vidéo FFmpeg");
  }
  if (rendered.ttsError) {
    // Voix demandée mais absente : ne jamais publier un Reel muet sans le dire
    throw new Error(`La voix n'a pas pu être générée : ${rendered.ttsError}`);
  }

  await progress(65, "store");
  const videoBuffer = Buffer.from(rendered.videoBase64, "base64");
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
