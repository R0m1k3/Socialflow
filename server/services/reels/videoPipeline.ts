/**
 * Rendu d'un Reel à partir d'une vidéo, puis médiathèque et publication.
 * Exécuté par la file `reel_jobs` (voir queue.ts).
 *
 * Deux moteurs :
 * - « remotion » (défaut) : le service Python prépare l'image (recadrage, HDR,
 *   stabilisation) et la piste son finale, Remotion compose les sous-titres
 *   animés, le logo et l'effet de fin — le même rendu que l'aperçu ;
 * - « ffmpeg » : tout est fait par le service Python (sous-titres ASS),
 *   plus rapide, conservé en secours (REEL_RENDERER=ffmpeg).
 */

import fs from "fs";
import path from "path";
import { videoReelParamsSchema, type VideoReelParams } from "@shared/reel";
import { storage } from "../../storage";
import { ffmpegService, type ReelRenderOptions } from "../ffmpeg";
import { resolveInternalUrl } from "../minio";
import type { JobContext } from "./queue";
import { resolveGeminiApiKey, resolveLogoPath, resolveMusicUrl, resolveQwenTarget } from "./assets";
import { describePublishFailure, publishReelToPages, storeRenderedVideo } from "./publish";
import { REMOTION_TEMP_DIR, tempFileUrl, toDataUrl } from "./remotionAssets";
import { renderReelComposition } from "./remotionRenderer";

export type ReelRenderer = "remotion" | "ffmpeg";

export function configuredRenderer(): ReelRenderer {
  return process.env.REEL_RENDERER === "ffmpeg" ? "ffmpeg" : "remotion";
}

export async function runVideoReelJob({ job, progress }: JobContext) {
  if (!job.postId) throw new Error("Job vidéo sans post associé");
  const postId = job.postId;
  const params = videoReelParamsSchema.parse(job.params);

  await progress(5, "prepare");
  const media = await storage.getMediaById(params.videoMediaId);
  if (!media || media.type !== "video") {
    throw new Error("Vidéo source introuvable ou invalide");
  }

  const [musicUrl, logoPath, geminiApiKey, qwen] = await Promise.all([
    resolveMusicUrl(params.musicTrackId, params.musicUrl),
    resolveLogoPath(),
    resolveGeminiApiKey(params.ttsEngine),
    resolveQwenTarget(params.ttsEngine),
  ]);

  const options: ReelRenderOptions = {
    text: params.srtCues ? undefined : params.overlayText,
    srtCues: params.srtCues,
    musicUrl,
    ttsEnabled: params.ttsEnabled,
    ttsVoice: params.ttsVoice,
    ttsEngine: params.ttsEngine,
    ttsStyle: params.ttsStyle,
    geminiApiKey,
    qwen,
    fontSize: params.fontSize,
    musicVolume: params.musicVolume,
    drawText: params.drawText,
    stabilize: params.stabilize,
    storeName: params.storeName,
    enableEndingEffect: params.enableEndingEffect,
    showLogo: params.showLogo,
  };

  const renderer = configuredRenderer();
  const startedAt = Date.now();
  const videoBuffer =
    renderer === "remotion"
      ? await renderWithRemotion(job.id, resolveInternalUrl(media.originalUrl), options, params, logoPath, progress)
      : await renderWithFfmpeg(resolveInternalUrl(media.originalUrl), options, logoPath, progress);
  console.log(`⏱️ [Reels] Rendu ${renderer} : ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);

  await progress(88, "store");
  const processedMedia = await storeRenderedVideo(job.userId, videoBuffer, `reel-${Date.now()}.mp4`);
  await storage.updatePostMedia(postId, [processedMedia.id]);

  await progress(93, "publish");
  const results = await publishReelToPages({
    postId,
    pageIds: params.pageIds,
    videoBuffer,
    description: params.description || params.overlayText || "",
    scheduledFor: params.scheduledFor,
    alsoStory: params.alsoStory,
  });

  if (!results.some((r) => r.success)) {
    throw new Error(describePublishFailure(results));
  }

  return { mediaId: processedMedia.id, renderer, results };
}

async function renderWithFfmpeg(
  videoUrl: string,
  options: ReelRenderOptions,
  logoPath: string | undefined,
  progress: JobContext["progress"],
): Promise<Buffer> {
  await progress(15, "render");
  // Le logo sert au coin de la vidéo et/ou à l'effet de fin : inutile de l'envoyer si aucun des deux
  const logoUsed = Boolean(logoPath) && (options.showLogo !== false || options.enableEndingEffect !== false);
  const rendered = await ffmpegService.renderReel(videoUrl, {
    ...options,
    watermarkUrl: logoUsed && logoPath ? resolveInternalUrl(logoPath) : undefined,
  });
  return rendered.video;
}

async function renderWithRemotion(
  jobId: string,
  videoUrl: string,
  options: ReelRenderOptions,
  params: VideoReelParams,
  logoPath: string | undefined,
  progress: JobContext["progress"],
): Promise<Buffer> {
  const workdir = path.join(REMOTION_TEMP_DIR, `reel-${jobId}`);
  try {
    // 1. Image recadrée à la durée finale, piste son finale, mots minutés
    await progress(10, "voice");
    const prepared = await ffmpegService.prepareReel(videoUrl, { ...options, hasLogo: Boolean(logoPath) }, workdir);

    // 2. Composition : sous-titres animés, logo, effet de fin
    await progress(40, "render");
    const outputLocation = path.join(workdir, "reel.mp4");
    let lastReported = 40;
    await renderReelComposition({
      compositionId: "ReelVideo",
      outputLocation,
      inputProps: {
        videoUrl: tempFileUrl(prepared.videoPath),
        videoDuration: prepared.totalDuration,
        totalDuration: prepared.totalDuration,
        words: prepared.words,
        captionStyle: params.captionStyle,
        logoUrl: logoPath ? await toDataUrl(logoPath) : undefined,
        showWatermark: params.showLogo,
        storeName: params.enableEndingEffect ? params.storeName : undefined,
        logoStart: prepared.logoStart,
        fadeStart: prepared.fadeStart,
        fadeDuration: prepared.fadeDuration,
        mixedAudioUrl: prepared.audioPath ? tempFileUrl(prepared.audioPath) : undefined,
      },
      onProgress: (ratio) => {
        const pct = 40 + Math.floor(ratio * 45);
        if (pct >= lastReported + 5) {
          lastReported = pct;
          progress(pct, "render").catch(() => { /* non bloquant */ });
        }
      },
    });
    return await fs.promises.readFile(outputLocation);
  } finally {
    await fs.promises.rm(workdir, { recursive: true, force: true }).catch(() => { /* déjà absent */ });
  }
}
