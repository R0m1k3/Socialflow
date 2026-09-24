/**
 * Rendu d'un Reel à partir d'images avec Remotion.
 * Exécuté par la file `reel_jobs` ; la publication reste une étape distincte,
 * déclenchée par l'utilisateur après l'aperçu.
 */

import fs from "fs";
import path from "path";
import * as musicMetadata from "music-metadata";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { imagesReelParamsSchema, type ImagesReelResult } from "@shared/reel";
import { ffmpegService } from "../ffmpeg";
import { generateVideoThumbnail } from "../thumbnail";
import type { JobContext } from "./queue";
import { resolveGeminiApiKey, resolveLogoPath } from "./assets";

export const REMOTION_TEMP_DIR = path.join(process.cwd(), "uploads", "temp");

// Durées
const FPS = 30;
const ENDING_SECONDS = 3; // diapositive de fin (logo + nom du magasin)
const MIN_CONTENT_SECONDS = 22; // total >= 25 s
const MAX_CONTENT_SECONDS = 27; // total <= 30 s

/** Bundle Remotion mis en cache : un seul bundle par processus. */
let bundleCache: Promise<string> | null = null;

function getBundle(): Promise<string> {
  if (!bundleCache) {
    // process.cwd() = /app dans Docker, racine du projet en dev
    const entryPoint = path.resolve(process.cwd(), "client/src/remotion/index.ts");
    console.log("📦 Bundling Remotion from:", entryPoint);
    bundleCache = bundle({ entryPoint }).catch((error) => {
      bundleCache = null; // réessayer au prochain rendu
      throw error;
    });
  }
  return bundleCache;
}

/** URL HTTP locale : l'audio est lu par Chromium, trop lourd pour une data URL. */
function localHttpUrl(url: string): string {
  if (!url.startsWith("/")) return url;
  const port = process.env.PORT || "5555";
  return `http://localhost:${port}${url}`;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

/**
 * Convertit un chemin local /uploads/... en data URL : Chromium dans Docker ne
 * lit pas http://localhost de façon fiable, les images sont donc embarquées.
 */
async function toDataUrl(relativeUrl: string): Promise<string> {
  if (!relativeUrl.startsWith("/uploads/")) return relativeUrl;
  const uploadsRoot = path.join(process.cwd(), "uploads") + path.sep;
  const filePath = path.resolve(process.cwd(), "." + relativeUrl);
  if (!filePath.startsWith(uploadsRoot)) {
    throw new Error(`Chemin d'image refusé : ${relativeUrl}`);
  }
  try {
    const buffer = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? "image/jpeg";
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    console.warn(`⚠️ toDataUrl: fichier introuvable : ${filePath}`);
    return relativeUrl;
  }
}

/**
 * Retire hashtags et emojis avant la synthèse vocale. Les lettres accentuées
 * font partie du hashtag (#AménagementExtérieur est retiré en entier).
 */
export function stripForTTS(text: string): string {
  return text
    .replace(/#[\wÀ-ɏḀ-ỿ]*/g, " ")
    .replace(/[\uD800-\uDFFF][\uDC00-\uDFFF]/g, " ") // paires de substitution (la plupart des emojis)
    .replace(/[☀-➿]/g, " ") // symboles divers
    .replace(/[⬀-⯿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Nombre de syllabes d'un mot français (groupes de voyelles). */
function countSyllablesFr(word: string): number {
  const clean = word.replace(/[^a-zàâéèêëîïôùûüç]/gi, "").toLowerCase();
  if (!clean) return 1;
  return Math.max(1, clean.match(/[aeiouyàâéèêëîïôùûü]+/gi)?.length ?? 1);
}

const PUNCT_ONLY = /^[.,!?;:…\-—«»"''()\[\]]+$/;
const EDGE_PUNCT = /^[.,!?;:…«»"''()\[\]]+|[.,!?;:…«»"''()\[\]]+$/g;

/**
 * Timings des mots prononcés (en images), répartis au prorata des syllabes.
 * Estimation provisoire : remplacée par les vrais timings de la voix au lot
 * « voix et sous-titres ».
 */
export function computeWordTimings(
  displayText: string,
  audioDurationSeconds: number,
  fps: number,
  startFrame: number,
): Array<{ word: string; startFrame: number; endFrame: number }> {
  const spokenWords = stripForTTS(displayText)
    .split(/\s+/)
    .filter((w) => w && !PUNCT_ONLY.test(w));
  if (spokenWords.length === 0) return [];

  const cleanWords = spokenWords.map((w) => w.replace(EDGE_PUNCT, "") || w);
  const syllables = cleanWords.map(countSyllablesFr);
  const totalSyllables = syllables.reduce((a, b) => a + b, 0);
  const totalFrames = audioDurationSeconds * fps;

  let currentFrame = startFrame;
  return cleanWords.map((word, i) => {
    const wordStart = currentFrame;
    currentFrame += Math.round((syllables[i] / totalSyllables) * totalFrames);
    return { word, startFrame: wordStart, endFrame: currentFrame };
  });
}

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

    // --- Voix ---
    let audioUrl: string | undefined;
    let wordTimings: ReturnType<typeof computeWordTimings> | undefined;
    let audioDuration = 0;

    const ttsText = overlayText ? stripForTTS(overlayText) : "";
    if (overlayText && ttsText) {
      await progress(15, "voice");
      const geminiApiKey = await resolveGeminiApiKey(params.ttsEngine);
      const tts = await ffmpegService.previewTTS(ttsText, params.ttsVoice, params.ttsEngine, geminiApiKey);
      if (!tts.success || !tts.audioBase64) {
        throw new Error(`La voix n'a pas pu être générée : ${tts.error ?? "réponse vide"}`);
      }

      const audioFilename = `tts-${job.id}.mp3`;
      const audioPath = path.join(REMOTION_TEMP_DIR, audioFilename);
      const audioBuffer = Buffer.from(tts.audioBase64, "base64");
      await fs.promises.writeFile(audioPath, audioBuffer);
      jobTempFiles.push(audioPath);
      audioUrl = localHttpUrl(`/uploads/temp/${audioFilename}`);

      try {
        audioDuration = (await musicMetadata.parseFile(audioPath)).format.duration ?? 0;
      } catch {
        audioDuration = audioBuffer.length / 16000; // estimation à 128 kb/s
      }
      audioDuration = Math.max(audioDuration, ttsText.split(/\s+/).length * 0.35);
      wordTimings = computeWordTimings(overlayText, audioDuration, FPS, 0);
    }

    // --- Durée : 25 à 30 s ---
    const naturalContent = Math.max(audioDuration, images.length * 3);
    const contentSeconds = Math.min(Math.max(naturalContent, MIN_CONTENT_SECONDS), MAX_CONTENT_SECONDS);
    const endingFrames = logoUrl || storeName ? ENDING_SECONDS * FPS : 0;
    const totalFrames = Math.round(contentSeconds * FPS) + endingFrames;

    await progress(25, "render");
    const serveUrl = await getBundle();
    const inputProps = {
      images,
      overlayText,
      audioUrl,
      wordTimings,
      musicUrl,
      musicVolume: params.musicVolume,
      logoUrl,
      storeName,
      endingFrames,
    };
    const composition = await selectComposition({ serveUrl, id: "ImageVideo", inputProps });

    const outputFilename = `out-${job.id}.mp4`;
    const outputLocation = path.join(REMOTION_TEMP_DIR, outputFilename);
    let lastReported = 25;

    await renderMedia({
      composition: { ...composition, durationInFrames: totalFrames },
      serveUrl,
      codec: "h264",
      outputLocation,
      inputProps,
      chromiumOptions: {
        disableWebSecurity: true,
        ignoreCertificateErrors: true,
      },
      concurrency: 1, // évite d'épuiser la mémoire du conteneur
      onProgress: ({ progress: ratio }) => {
        const pct = 25 + Math.floor(ratio * 70);
        if (pct >= lastReported + 5) {
          lastReported = pct;
          progress(pct, "render").catch(() => { /* non bloquant */ });
        }
      },
    });

    const thumbnailFilename = outputFilename.replace(".mp4", "-thumb.jpg");
    const thumbnailOk = await generateVideoThumbnail(
      outputLocation,
      path.join(REMOTION_TEMP_DIR, thumbnailFilename),
      2,
    );

    return {
      url: `/uploads/temp/${outputFilename}`,
      thumbnailUrl: thumbnailOk ? `/uploads/temp/${thumbnailFilename}` : null,
    };
  } finally {
    // Images, musique importée et voix ne servent plus une fois le rendu fini
    for (const file of [...params.tempFiles, ...jobTempFiles]) {
      await fs.promises.unlink(file).catch(() => { /* déjà absent */ });
    }
  }
}
