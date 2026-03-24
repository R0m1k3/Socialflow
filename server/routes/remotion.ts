import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { ffmpegService } from "../services/ffmpeg";

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
 * Distributes frames proportionally across display words.
 * Hashtags and emojis are display-only (shown but voice skips them).
 */
function computeWordTimings(
  displayText: string,
  audioDurationSeconds: number,
  fps: number,
  startFrame: number
): Array<{ word: string; startFrame: number; endFrame: number }> {
  // Split into display words (preserving hashtags, emojis)
  const displayWords = displayText.split(/\s+/).filter(Boolean);

  // TTS words (stripped - this matches what audio says)
  const ttsText = stripForTTS(displayText);
  const ttsWords = ttsText.split(/\s+/).filter(Boolean);

  // Frames per TTS word (based on actual audio duration)
  const totalTTSFrames = audioDurationSeconds * fps;
  const framesPerTTSWord = ttsWords.length > 0 ? totalTTSFrames / ttsWords.length : fps;

  let currentFrame = startFrame;
  let ttsIdx = 0;

  return displayWords.map((word) => {
    const wordStart = currentFrame;
    // Use TTS pacing if this word is a real spoken word
    const isSpoken = !/^#/.test(word) && !(/[\uD800-\uDFFF\u2600-\u27BF]/.test(word));
    const frameDuration = isSpoken ? framesPerTTSWord : framesPerTTSWord * 0.4; // hashtags flash briefly
    currentFrame += Math.round(frameDuration);
    if (isSpoken) ttsIdx++;
    return { word, startFrame: wordStart, endFrame: currentFrame };
  });
}

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

    // Music: uploaded file takes priority, else use catalog track URL directly
    const musicFile = fields["music"]?.[0];
    const musicUrl: string | undefined = musicFile
      ? `${host}/uploads/temp/${path.basename(musicFile.path)}`
      : (req.body.musicTrackUrl as string | undefined) || undefined;

    const fps = 30;
    const totalVideoDuration = imageUrls.length * 3; // 3s per image

    // --- TTS Audio Generation ---
    let audioUrl: string | undefined;
    let wordTimings: Array<{ word: string; startFrame: number; endFrame: number }> | undefined;
    let totalFrames = totalVideoDuration * fps;

    if (overlayText) {
      const ttsText = stripForTTS(overlayText);
      if (ttsText) {
        console.log("🎙️ Generating TTS for:", ttsText);
        try {
          const ttsResult = await ffmpegService.previewTTS(ttsText, ttsVoice);
          if (ttsResult.success && ttsResult.audioBase64) {
            // Save audio to temp file
            const audioFilename = `tts-${Date.now()}.mp3`;
            const audioPath = path.join(uploadDir, audioFilename);
            fs.writeFileSync(audioPath, Buffer.from(ttsResult.audioBase64, "base64"));
            audioUrl = `${host}/uploads/temp/${audioFilename}`;

            // Estimate audio duration (MP3 at 128kbps ~ 16KB/s)
            const audioBytes = Buffer.from(ttsResult.audioBase64, "base64").length;
            const estimatedAudioDuration = Math.max(audioBytes / 16000, ttsText.split(/\s+/).length * 0.5);
            
            // Expand video if text needs more time than images
            if (estimatedAudioDuration > totalVideoDuration) {
              totalFrames = Math.ceil(estimatedAudioDuration * fps) + fps; // +1s buffer
            }

            wordTimings = computeWordTimings(overlayText, estimatedAudioDuration, fps, 0);
            console.log(`✅ TTS generated, ~${estimatedAudioDuration.toFixed(1)}s, ${wordTimings.length} words`);
          } else {
            console.warn("⚠️ TTS failed:", ttsResult.error);
          }
        } catch (ttsErr) {
          console.warn("⚠️ TTS error (rendering without audio):", ttsErr);
        }
      }
    }

    console.log("🎬 Getting Remotion bundle (cached)...");
    const bundleLocation = await getBundle();

    const inputProps = { images: imageUrls, overlayText, audioUrl, wordTimings, musicUrl, musicVolume };

    console.log("🎬 Selecting composition...");
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: "ImageVideo",
      inputProps,
    });

    // Override duration if TTS needs more frames
    const effectiveDurationInFrames = Math.max(totalFrames, composition.durationInFrames);

    const outputFilename = `out-${Date.now()}.mp4`;
    const outputLocation = path.join(uploadDir, outputFilename);

    console.log("🎬 Rendering media...", effectiveDurationInFrames, "frames");

    await renderMedia({
      composition: { ...composition, durationInFrames: effectiveDurationInFrames },
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
