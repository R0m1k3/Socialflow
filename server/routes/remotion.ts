import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { ffmpegService } from "../services/ffmpeg";
import { storage as dbStorage } from "../storage";
import { minioService as cloudinaryService, buildMinioUrl, resolvePublicUrl } from "../services/minio";
import { facebookService } from "../services/facebook";
import * as musicMetadata from "music-metadata";

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
 * Calculates word timings (in frames) for SPOKEN words only (no hashtags, no emojis).
 * Distributes audio duration evenly across words → tight sync with TTS voice.
 */
function computeWordTimings(
  displayText: string,
  audioDurationSeconds: number,
  fps: number,
  startFrame: number
): Array<{ word: string; startFrame: number; endFrame: number }> {
  // Only keep words that the TTS will actually speak
  const ttsText = stripForTTS(displayText);
  const spokenWords = ttsText.split(/\s+/).filter(Boolean);
  if (spokenWords.length === 0) return [];

  const totalFrames = audioDurationSeconds * fps;
  const framesPerWord = totalFrames / spokenWords.length;

  return spokenWords.map((word, i) => ({
    word,
    startFrame: startFrame + Math.round(i * framesPerWord),
    endFrame: startFrame + Math.round((i + 1) * framesPerWord),
  }));
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
    // Return relative URL so any client (mobile, desktop, Docker) can access it
    res.json({ url: `/uploads/temp/${outputFilename}` });

  } catch (err: any) {
    console.error("❌ Remotion render error:", err);
    res.status(500).json({ error: "Erreur lors du rendu: " + err.message });
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
          console.log(`🚀 Publishing to ${page.pageName}...`);
          const reelId = await facebookService.publishReel(page, resolvePublicUrl(cloudinaryResult.originalUrl), description || "");
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
