/**
 * Rendu d'un Reel à partir d'images avec Remotion.
 * Exécuté par la file `reel_jobs` ; la publication reste une étape distincte,
 * déclenchée par l'utilisateur après l'aperçu.
 */

import fs from "fs";
import path from "path";
import { cleanCaptionText, computeImagesTiming } from "@shared/captions";
import { imagesReelParamsSchema, type ImagesReelResult } from "@shared/reel";
import { ffmpegService } from "../ffmpeg";
import { generateVideoThumbnail } from "../thumbnail";
import type { JobContext } from "./queue";
import { resolveGeminiApiKey, resolveLogoPath } from "./assets";
import { REMOTION_TEMP_DIR, localHttpUrl, tempFileUrl, toDataUrl } from "./remotionAssets";
import { renderReelComposition } from "./remotionRenderer";

export { REMOTION_TEMP_DIR };

export async function runImagesReelJob({ job, progress }: JobContext): Promise<ImagesReelResult> {
  const params = imagesReelParamsSchema.parse(job.params);
  const jobTempFiles: string[] = [];

  try {
    await progress(5, "prepare");
    const images = await Promise.all(params.imageUrls.map(toDataUrl));
    const logoPath = await resolveLogoPath();
    const logoUrl = logoPath ? await toDataUrl(logoPath) : undefined;
    const musicUrl = params.musicUrl ? localHttpUrl(params.musicUrl) : undefined;
    const { overlayText, storeName } = params;

    // --- Voix et minutage réel des mots ---
    let audioUrl: string | undefined;
    let words: { text: string; start: number; end: number }[] = [];
    let audioDuration = 0;

    const spokenText = overlayText ? cleanCaptionText(overlayText) : "";
    if (params.ttsEnabled && spokenText) {
      await progress(15, "voice");
      const voice = await ffmpegService.previewVoice(spokenText, {
        voice: params.ttsVoice,
        engine: params.ttsEngine,
        style: params.ttsStyle,
        geminiApiKey: await resolveGeminiApiKey(params.ttsEngine),
      });
      for (const warning of voice.warnings) console.warn(`⚠️ [Reels] ${warning}`);

      const audioPath = path.join(REMOTION_TEMP_DIR, `tts-${job.id}.mp3`);
      await fs.promises.writeFile(audioPath, voice.audio);
      jobTempFiles.push(audioPath);
      audioUrl = tempFileUrl(audioPath);
      audioDuration = voice.duration;
      words = voice.words;
    }

    // --- Durée : 25 à 30 s (mêmes règles que l'aperçu) ---
    const { total, endingSeconds } = computeImagesTiming({
      imageCount: images.length,
      voiceDuration: audioDuration,
      hasEnding: Boolean(logoUrl || storeName),
    });

    await progress(25, "render");
    const outputLocation = path.join(REMOTION_TEMP_DIR, `out-${job.id}.mp4`);
    let lastReported = 25;
    await renderReelComposition({
      compositionId: "ImageVideo",
      outputLocation,
      inputProps: {
        images,
        totalDuration: total,
        words,
        captionStyle: params.captionStyle,
        audioUrl,
        musicUrl,
        musicVolume: params.musicVolume,
        logoUrl,
        storeName,
        endingSeconds,
      },
      onProgress: (ratio) => {
        const pct = 25 + Math.floor(ratio * 70);
        if (pct >= lastReported + 5) {
          lastReported = pct;
          progress(pct, "render").catch(() => { /* non bloquant */ });
        }
      },
    });

    const thumbnailPath = outputLocation.replace(/\.mp4$/, "-thumb.jpg");
    const thumbnailOk = await generateVideoThumbnail(outputLocation, thumbnailPath, 2);

    return {
      url: `/uploads/temp/${path.basename(outputLocation)}`,
      thumbnailUrl: thumbnailOk ? `/uploads/temp/${path.basename(thumbnailPath)}` : null,
    };
  } finally {
    // Images, musique importée et voix ne servent plus une fois le rendu fini
    for (const file of [...params.tempFiles, ...jobTempFiles]) {
      await fs.promises.unlink(file).catch(() => { /* déjà absent */ });
    }
  }
}
