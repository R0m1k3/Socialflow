import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { ffmpegService } from "../services/ffmpeg";
import { storage as dbStorage } from "../storage";

export const remotionRouter = Router();

const uploadDir = path.join(process.cwd(), "uploads", "temp");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `remotion-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({ storage });

/** Cached Remotion bundle URL — only bundle once per process lifecycle */
let remotionBundleCache: string | null = null;

async function getBundle(): Promise<string> {
  if (remotionBundleCache) return remotionBundleCache;
  // Use process.cwd() (= /app in Docker, project root in dev) — works in both CJS and ESM
  const entryPoint = path.resolve(process.cwd(), "client/src/remotion/index.ts");
  console.log("📦 Bundling Remotion from:", entryPoint);
  remotionBundleCache = await bundle({ entryPoint });
  console.log("📦 Bundle cached at:", remotionBundleCache);
  return remotionBundleCache;
}

/**
 * Strips hashtags and emojis from text for TTS synthesis.
 * Visual display keeps the full text.
 */
function stripForTTS(text: string): string {
  return text
    .replace(/#\w+/g, '')      // remove hashtags
    .replace(/[\uD800-\uDFFF]/g, '') // surrogate pairs (most emojis)
    .replace(/[\u2600-\u27BF]/g, '') // misc symbols
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculates word timings (in frames at 30fps) based on audio duration.
 * Each word appears only when spoken, then disappears (no accumulation).
 */
function computeWordTimings(
  displayText: string,
  audioDurationSeconds: number,
  fps: number,
  startFrame: number
): Array<{ word: string; startFrame: number; endFrame: number }> {
  const displayWords = displayText.split(/\s+/).filter(Boolean);
  const ttsText = stripForTTS(displayText);
  const ttsWords = ttsText.split(/\s+/).filter(Boolean);

  const totalTTSFrames = audioDurationSeconds * fps;
  const framesPerTTSWord = ttsWords.length > 0 ? totalTTSFrames / ttsWords.length : fps;

  let currentFrame = startFrame;

  return displayWords.map((word) => {
    const wordStart = currentFrame;
    const isSpoken = !/^#/.test(word) && !(/[\uD800-\uDFFF\u2600-\u27BF]/.test(word));
    const frameDuration = isSpoken ? framesPerTTSWord : framesPerTTSWord * 0.4;
    currentFrame += Math.round(frameDuration);
    return { word, startFrame: wordStart, endFrame: currentFrame };
  });
}

// Duration constants
const FPS = 30;
const ENDING_SECONDS = 3;      // ending slide (logo + store name)
const MIN_CONTENT_SECONDS = 22; // so total >= 25s
const MAX_CONTENT_SECONDS = 27; // so total <= 30s

remotionRouter.post("/render", upload.fields([{ name: "images", maxCount: 4 }, { name: "music", maxCount: 1 }]), async (req, res) => {
  try {
    const fields = req.files as Record<string, Express.Multer.File[]>;
    const files = fields["images"] ?? [];
    let imageUrls: string[] = [];

    const existing = req.body.existingImageUrls;
    if (existing) {
      if (Array.isArray(existing)) imageUrls.push(...existing);
      else imageUrls.push(existing);
    }

    const host = req.protocol + "://" + req.get("host");
    if (files && files.length > 0) {
      imageUrls.push(...files.map(f => `${host}/uploads/temp/${path.basename(f.path)}`));
    }

    if (imageUrls.length === 0) {
      return res.status(400).json({ error: "Aucune image fournie" });
    }

    const overlayText: string | undefined = typeof req.body.overlayText === 'string' && req.body.overlayText.trim()
      ? req.body.overlayText.trim()
      : undefined;

    const ttsVoice: string = req.body.ttsVoice || "fr-FR-VivienneMultilingualNeural";
    const musicVolume: number = parseFloat(req.body.musicVolume ?? "0.3");

    // Music: uploaded file takes priority, else use catalog track URL (make relative paths absolute)
    const musicFile = fields["music"]?.[0];
    const rawMusicTrackUrl = req.body.musicTrackUrl as string | undefined;
    const musicUrl: string | undefined = musicFile
      ? `${host}/uploads/temp/${path.basename(musicFile.path)}`
      : rawMusicTrackUrl?.startsWith('/') ? `${host}${rawMusicTrackUrl}` : rawMusicTrackUrl || undefined;

    // --- Fetch logo and store name from config ---
    let logoUrl: string | undefined;
    let storeName: string | undefined;
    try {
      const cloudinaryConfig = await dbStorage.getCloudinaryConfig();
      if (cloudinaryConfig?.cloudName && cloudinaryConfig?.logoPublicId) {
        logoUrl = `https://res.cloudinary.com/${cloudinaryConfig.cloudName}/image/upload/${cloudinaryConfig.logoPublicId}`;
        console.log("🏢 Logo URL:", logoUrl);
      }
    } catch (e) {
      console.warn("⚠️ Could not fetch logo config:", e);
    }
    try {
      const user = req.user as any;
      if (user?.id) {
        const pages = await dbStorage.getSocialPages(user.id);
        if (pages.length > 0) {
          storeName = pages[0].pageName;
          console.log("🏪 Store name:", storeName);
        }
      }
    } catch (e) {
      console.warn("⚠️ Could not fetch store name:", e);
    }

    // --- TTS Audio Generation ---
    let audioUrl: string | undefined;
    let wordTimings: Array<{ word: string; startFrame: number; endFrame: number }> | undefined;
    let estimatedAudioDuration = 0;

    if (overlayText) {
      const ttsText = stripForTTS(overlayText);
      if (ttsText) {
        console.log("🎙️ Generating TTS for:", ttsText);
        try {
          const ttsResult = await ffmpegService.previewTTS(ttsText, ttsVoice);
          if (ttsResult.success && ttsResult.audioBase64) {
            const audioFilename = `tts-${Date.now()}.mp3`;
            const audioPath = path.join(uploadDir, audioFilename);
            fs.writeFileSync(audioPath, Buffer.from(ttsResult.audioBase64, "base64"));
            audioUrl = `${host}/uploads/temp/${audioFilename}`;

            // Estimate audio duration (MP3 at 128kbps ~ 16KB/s)
            const audioBytes = Buffer.from(ttsResult.audioBase64, "base64").length;
            estimatedAudioDuration = Math.max(audioBytes / 16000, ttsText.split(/\s+/).length * 0.5);

            wordTimings = computeWordTimings(overlayText, estimatedAudioDuration, FPS, 0);
            console.log(`✅ TTS generated, ~${estimatedAudioDuration.toFixed(1)}s, ${wordTimings.length} words`);
          } else {
            console.warn("⚠️ TTS failed:", ttsResult.error);
          }
        } catch (ttsErr) {
          console.warn("⚠️ TTS error (rendering without audio):", ttsErr);
        }
      }
    }

    // --- Duration: 25-30s total ---
    // content = max(tts duration, images*3s), clamped to 22-27s; ending = 3s
    const naturalContent = Math.max(estimatedAudioDuration, imageUrls.length * 3);
    const contentSeconds = Math.min(Math.max(naturalContent, MIN_CONTENT_SECONDS), MAX_CONTENT_SECONDS);
    const endingFrames = (logoUrl || storeName) ? ENDING_SECONDS * FPS : 0;
    const totalFrames = Math.round(contentSeconds * FPS) + endingFrames;

    console.log(`🎬 Duration: ${contentSeconds.toFixed(1)}s content + ${ENDING_SECONDS}s ending = ${(totalFrames / FPS).toFixed(1)}s total`);

    console.log("🎬 Getting Remotion bundle (cached)...");
    const bundleLocation = await getBundle();

    const inputProps = {
      images: imageUrls,
      overlayText,
      audioUrl,
      wordTimings,
      musicUrl,
      musicVolume,
      logoUrl,
      storeName,
      endingFrames,
    };

    console.log("🎬 Selecting composition...");
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: "ImageVideo",
      inputProps,
    });

    const outputFilename = `out-${Date.now()}.mp4`;
    const outputLocation = path.join(uploadDir, outputFilename);

    console.log("🎬 Rendering media...", totalFrames, "frames");

    await renderMedia({
      composition: { ...composition, durationInFrames: totalFrames },
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation,
      inputProps,
      chromiumOptions: {
        disableWebSecurity: true,
        ignoreCertificateErrors: true,
      },
    });

    console.log("✅ Render completed:", outputFilename);
    res.json({ url: `${host}/uploads/temp/${outputFilename}` });

  } catch (err: any) {
    console.error("❌ Remotion render error:", err);
    res.status(500).json({ error: "Erreur lors du rendu: " + err.message });
  }
});
