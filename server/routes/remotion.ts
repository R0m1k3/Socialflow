import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { ffmpegService } from "../services/ffmpeg";
import { storage as dbStorage } from "../storage";
import { minioService as cloudinaryService, buildMinioUrl } from "../services/minio";
import { facebookService } from "../services/facebook";
import * as musicMetadata from "music-metadata";

const execAsync = promisify(exec);

/**
 * Generate a thumbnail from a video file using FFmpeg
 * @param videoPath Path to the video file
 * @param outputPath Path to save the thumbnail
 * @param seekTime Time in seconds to extract the frame (default: 1s)
 */
async function generateVideoThumbnail(videoPath: string, outputPath: string, seekTime: number = 1): Promise<boolean> {
  try {
    const cmd = `ffmpeg -y -ss ${seekTime} -i "${videoPath}" -vframes 1 -q:v 2 "${outputPath}"`;
    await execAsync(cmd);
    return fs.existsSync(outputPath);
  } catch (error) {
    console.warn('⚠️ Failed to generate video thumbnail:', error);
    return false;
  }
}

export const remotionRouter = Router();

interface RenderJob {
  status: 'processing' | 'done' | 'error';
  url?: string;
  thumbnailUrl?: string | null;
  error?: string;
}
const renderJobs = new Map<string, RenderJob>();

remotionRouter.get("/render/status/:jobId", (req, res) => {
  const job = renderJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job introuvable" });
  res.json(job);
});

const uploadDir = path.join(process.cwd(), "uploads", "temp");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
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
 * Uses Unicode-aware regex to handle French accented chars in hashtags
 * (e.g. #AménagementExtérieur must be fully removed, not just #Am).
 */
function stripForTTS(text: string): string {
  return text
    // Hashtags with Unicode letters (covers all French accented chars)
    .replace(/#[\w\u00C0-\u024F\u1E00-\u1EFF]*/g, ' ')
    // Emoji: surrogate pairs (covers virtually all emoji in UTF-16 strings)
    .replace(/[\uD800-\uDFFF][\uDC00-\uDFFF]/g, ' ')  // surrogate pairs (most emojis)
    .replace(/[\u2600-\u27BF]/g, ' ')                  // misc symbols & arrows
    .replace(/[\u2B00-\u2BFF]/g, ' ')                  // misc symbols extended
    .replace(/\s+/g, ' ')
    .trim();
}

/** Estimates syllable count for a French word (vowel-group method). */
function countSyllablesFr(word: string): number {
  const clean = word.replace(/[^a-zàâéèêëîïôùûüç]/gi, '').toLowerCase();
  if (!clean) return 1;
  const groups = clean.match(/[aeiouyàâéèêëîïôùûü]+/gi);
  return Math.max(1, groups?.length ?? 1);
}

/** Purely-punctuation token (should not appear in overlay). */
const PUNCT_ONLY = /^[.,!?;:…\-—«»"''()\[\]]+$/;

/**
 * Calculates word timings (in frames) for SPOKEN words only.
 * Duration per word is weighted by syllable count → much tighter sync with TTS voice.
 */
function computeWordTimings(
  displayText: string,
  audioDurationSeconds: number,
  fps: number,
  startFrame: number
): Array<{ word: string; startFrame: number; endFrame: number }> {
  const ttsText = stripForTTS(displayText);
  // Filter out standalone punctuation tokens
  const spokenWords = ttsText.split(/\s+/).filter(w => w && !PUNCT_ONLY.test(w));
  if (spokenWords.length === 0) return [];

  // Strip leading/trailing punctuation from each word for clean display
  const cleanWords = spokenWords.map(w => w.replace(/^[.,!?;:…«»"''()\[\]]+|[.,!?;:…«»"''()\[\]]+$/g, '') || w);

  // Syllable-weighted distribution: longer words get proportionally more screen time
  const syllables = cleanWords.map(countSyllablesFr);
  const totalSyllables = syllables.reduce((a, b) => a + b, 0);
  const totalFrames = audioDurationSeconds * fps;

  let currentFrame = startFrame;
  return cleanWords.map((word, i) => {
    const wordStart = currentFrame;
    const wordFrames = Math.round((syllables[i] / totalSyllables) * totalFrames);
    currentFrame += wordFrames;
    return { word, startFrame: wordStart, endFrame: currentFrame };
  });
}

// Duration constants
const FPS = 30;
const ENDING_SECONDS = 3;      // ending slide (logo + store name)
const MIN_CONTENT_SECONDS = 22; // so total >= 25s
const MAX_CONTENT_SECONDS = 27; // so total <= 30s

/**
 * Converts a local /uploads/... relative path to a base64 data URL.
 * Chromium inside Docker cannot reliably fetch http://localhost via HTTP,
 * so we embed images directly — zero network dependency.
 */
async function toDataUrl(relativeUrl: string): Promise<string> {
  if (!relativeUrl || !relativeUrl.startsWith('/uploads/')) return relativeUrl;
  const filePath = path.join(process.cwd(), relativeUrl);
  try {
    const buffer = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === 'png' ? 'image/png'
               : ext === 'gif' ? 'image/gif'
               : ext === 'webp' ? 'image/webp'
               : 'image/jpeg';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch {
    console.warn(`⚠️ toDataUrl: file not found: ${filePath}`);
    return relativeUrl;
  }
}

remotionRouter.post("/render", upload.fields([{ name: "images", maxCount: 4 }, { name: "music", maxCount: 1 }]), async (req, res) => {
  try {
    const fields = req.files as Record<string, Express.Multer.File[]>;
    const files = fields["images"] ?? [];
    let imageUrls: string[] = [];

    // For audio/music we still need HTTP URLs (data URLs for audio are too large)
    const port = process.env.PORT || "5555";
    const host = `http://localhost:${port}`;

    // Library images: resolve relative paths → data URLs (avoids Chromium HTTP issues)
    const existing = req.body.existingImageUrls;
    if (existing) {
      const rawUrls = Array.isArray(existing) ? existing : [existing];
      const resolved = await Promise.all(rawUrls.map(toDataUrl));
      imageUrls.push(...resolved);
    }
    // Newly uploaded temp files: read from disk → data URL
    if (files && files.length > 0) {
      const resolved = await Promise.all(files.map(async f => {
        const buffer = await fs.promises.readFile(f.path);
        const ext = path.extname(f.originalname).slice(1).toLowerCase();
        const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        return `data:${mime};base64,${buffer.toString('base64')}`;
      }));
      imageUrls.push(...resolved);
    }

    if (imageUrls.length === 0) {
      return res.status(400).json({ error: "Aucune image fournie" });
    }

    const overlayText: string | undefined = typeof req.body.overlayText === 'string' && req.body.overlayText.trim()
      ? req.body.overlayText.trim()
      : undefined;

    const ttsVoice: string = req.body.ttsVoice || "fr-FR-VivienneMultilingualNeural";
    const musicVolume: number = parseFloat(req.body.musicVolume ?? "0.3");

    // Music: HTTP URLs are fine for audio (Remotion uses Web Audio API, not <Img>)
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
        const relLogo = buildMinioUrl(cloudinaryConfig.cloudName, cloudinaryConfig.logoPublicId, cloudinaryConfig.publicUrl);
        logoUrl = await toDataUrl(relLogo);
        console.log("🏢 Logo embedded as data URL:", logoUrl.slice(0, 40) + "...");
      }
    } catch (e) {
      console.warn("⚠️ Could not fetch logo config:", e);
    }
    try {
      const user = req.user as any;
      if (user?.id) {
        const pages = await dbStorage.getSocialPages(user.id);
        if (pages.length > 0) {
          // Use the page selected by the user, or fall back to first page
          const selectedPageId = req.body.selectedPageId as string | undefined;
          const page = selectedPageId ? pages.find(p => p.id === selectedPageId) : pages[0];
          storeName = (page ?? pages[0]).pageName;
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
            const audioBuffer = Buffer.from(ttsResult.audioBase64, "base64");
            fs.writeFileSync(audioPath, audioBuffer);
            audioUrl = `${host}/uploads/temp/${audioFilename}`;

            // Get exact audio duration from MP3 metadata
            try {
              const meta = await musicMetadata.parseFile(audioPath);
              estimatedAudioDuration = meta.format.duration ?? 0;
            } catch {
              // Fallback: rough estimate from byte size (128kbps = 16KB/s)
              estimatedAudioDuration = audioBuffer.length / 16000;
            }
            estimatedAudioDuration = Math.max(estimatedAudioDuration, ttsText.split(/\s+/).length * 0.35);

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

    const jobId = Date.now().toString();
    renderJobs.set(jobId, { status: 'processing' });
    res.json({ jobId, message: "Rendu démarré en arrière-plan" });

    // Run async to prevent 504 Gateway Timeout
    (async () => {
      try {
        const outputFilename = `out-${Date.now()}.mp4`;
        const outputLocation = path.join(uploadDir, outputFilename);

        console.log("🎬 Rendering media...", totalFrames, "frames (Job:", jobId, ")");

        await renderMedia({
          composition: { ...composition, durationInFrames: totalFrames },
          serveUrl: bundleLocation,
          codec: "h264",
          outputLocation,
          inputProps,
          chromiumOptions: {
            disableWebSecurity: true,
            ignoreCertificateErrors: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
          },
          concurrency: 1, // Limit concurrency to prevent Docker memory exhaustion
        });

        console.log("✅ Render completed:", outputFilename);

        // Generate thumbnail for the video
        const thumbnailFilename = outputFilename.replace('.mp4', '-thumb.jpg');
        const thumbnailPath = path.join(uploadDir, thumbnailFilename);
        const thumbnailGenerated = await generateVideoThumbnail(outputLocation, thumbnailPath, 2);

        if (thumbnailGenerated) {
          console.log("🖼️ Thumbnail generated:", thumbnailFilename);
        }

        renderJobs.set(jobId, {
          status: 'done',
          url: `/uploads/temp/${outputFilename}`,
          thumbnailUrl: thumbnailGenerated ? `/uploads/temp/${thumbnailFilename}` : null,
        });

      } catch (err: any) {
        console.error("❌ Remotion render error for Job", jobId, ":", err);
        renderJobs.set(jobId, { status: 'error', error: "Erreur lors du rendu: " + err.message });
      }
    })();

  } catch (err: any) {
    console.error("❌ Remotion pre-render error:", err);
    res.status(500).json({ error: "Erreur lors du lancement du rendu: " + err.message });
  }
});

/**
 * POST /api/remotion/publish
 * Uploads the rendered MP4 to Cloudinary and publishes (or schedules) it as a Reel.
 */
remotionRouter.post("/publish", async (req, res) => {
  try {
    const user = req.user as any;
    if (!user?.id) return res.status(401).json({ error: "Non authentifié" });

    const { videoUrl, pageIds, scheduledFor, description } = req.body as {
      videoUrl: string;
      pageIds: string[];
      scheduledFor?: string;
      description?: string;
    };

    if (!videoUrl) return res.status(400).json({ error: "videoUrl requis" });
    if (!pageIds?.length) return res.status(400).json({ error: "Au moins une page requise" });

    // Resolve the local file path from the temp URL
    const filename = path.basename(videoUrl.split("?")[0]);
    const localPath = path.join(uploadDir, filename);
    if (!fs.existsSync(localPath)) {
      return res.status(400).json({ error: "Fichier vidéo introuvable (expiré ?)" });
    }

    console.log("☁️ Uploading Remotion video to Cloudinary...");
    const cloudinaryResult = await cloudinaryService.uploadMedia(
      localPath,
      filename,
      user.id,
      "video/mp4"
    );
    console.log("✅ Cloudinary upload:", cloudinaryResult.originalUrl);

    // Create a Post record to track this publication
    const post = await dbStorage.createPost({
      userId: user.id,
      content: description || "",
      aiGenerated: "false",
      status: scheduledFor ? "scheduled" : "published",
      scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
    });

    // Create a Media record for the processed video
    const mediaRecord = await dbStorage.createMedia({
      userId: user.id,
      type: "video",
      cloudinaryPublicId: cloudinaryResult.publicId,
      originalUrl: cloudinaryResult.originalUrl,
      facebookFeedUrl: null,
      instagramFeedUrl: null,
      instagramStoryUrl: null,
      fileName: filename,
      fileSize: fs.statSync(localPath).size,
    });

    await dbStorage.updatePostMedia(post.id, [mediaRecord.id]);

    const results: { pageId: string; success: boolean; reelId?: string; error?: string }[] = [];

    for (const pageId of pageIds) {
      try {
        const page = await dbStorage.getSocialPage(pageId);
        if (!page) { results.push({ pageId, success: false, error: "Page introuvable" }); continue; }
        if (page.platform !== "facebook") { results.push({ pageId, success: false, error: "Seules les pages Facebook sont supportées" }); continue; }

        const scheduledPost = await dbStorage.createScheduledPost({
          postId: post.id,
          pageId: page.id,
          postType: "reel",
          scheduledAt: scheduledFor ? new Date(scheduledFor) : new Date(),
        });

        if (!scheduledFor) {
          console.log(`🚀 Publishing to ${page.pageName} (direct binary upload)...`);
          // Upload video bytes directly — Facebook cannot access local URLs
          const videoBuffer = await fs.promises.readFile(localPath);
          const reelId = await facebookService.publishVideoFromBuffer(page, videoBuffer, description || "");
          await dbStorage.updateScheduledPost(scheduledPost.id, { publishedAt: new Date(), externalPostId: reelId });
          results.push({ pageId, success: true, reelId });
        } else {
          results.push({ pageId, success: true, reelId: "scheduled" });
        }
      } catch (pageErr: any) {
        console.error(`❌ Error publishing to page ${pageId}:`, pageErr);
        results.push({ pageId, success: false, error: pageErr.message });
      }
    }

    const anySuccess = results.some(r => r.success);
    if (!anySuccess) {
      await dbStorage.updatePost(post.id, { status: "failed" });
    }

    res.json({ success: anySuccess, results, postId: post.id });

  } catch (err: any) {
    console.error("❌ Remotion publish error:", err);
    res.status(500).json({ error: "Erreur lors de la publication: " + err.message });
  }
});
