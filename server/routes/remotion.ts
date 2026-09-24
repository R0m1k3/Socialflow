import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import type { User } from "@shared/schema";
import { imagesReelParamsSchema, type ImagesReelResult } from "@shared/reel";
import { storage as dbStorage } from "../storage";
import { enqueueReelJob, getReelJob } from "../services/reels/queue";
import { REMOTION_TEMP_DIR } from "../services/reels/imagesPipeline";
import { resolveStoreName } from "../services/reels/assets";
import { publishReelToPages, storeRenderedVideo } from "../services/reels/publish";

export const remotionRouter = Router();

const uploadDir = REMOTION_TEMP_DIR;
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, `remotion-${uniqueSuffix}${path.extname(file.originalname)}`);
    },
  }),
});

/**
 * GET /api/remotion/render/status/:jobId
 * État d'un rendu, lu dans la file persistante (survit à un redémarrage).
 */
remotionRouter.get("/render/status/:jobId", async (req, res) => {
  const user = req.user as User;
  const job = await getReelJob(req.params.jobId);
  if (!job || job.kind !== "images" || (job.userId !== user.id && user.role !== "admin")) {
    return res.status(404).json({ error: "Job introuvable" });
  }

  if (job.status === "completed") {
    const result = job.result as ImagesReelResult;
    return res.json({ status: "done", url: result.url, thumbnailUrl: result.thumbnailUrl });
  }
  if (job.status === "failed") {
    return res.json({ status: "error", error: "Erreur lors du rendu: " + (job.error ?? "inconnue") });
  }
  res.json({ status: "processing", progress: job.progress, step: job.step, queued: job.status === "pending" });
});

/**
 * POST /api/remotion/render
 * Met en file le rendu d'un Reel à partir d'images (1 à 4).
 */
remotionRouter.post("/render", upload.fields([{ name: "images", maxCount: 4 }, { name: "music", maxCount: 1 }]), async (req, res) => {
  const fields = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const uploaded = [...(fields["images"] ?? []), ...(fields["music"] ?? [])];

  try {
    const user = req.user as User;
    const existing = req.body.existingImageUrls;
    const libraryUrls: string[] = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
    const uploadedImageUrls = (fields["images"] ?? []).map((f) => `/uploads/temp/${path.basename(f.path)}`);

    const musicFile = fields["music"]?.[0];
    const musicVolume = parseFloat(req.body.musicVolume ?? "0.3");

    const parsed = imagesReelParamsSchema.safeParse({
      imageUrls: [...libraryUrls, ...uploadedImageUrls],
      overlayText: req.body.overlayText,
      musicUrl: musicFile ? `/uploads/temp/${path.basename(musicFile.path)}` : req.body.musicTrackUrl,
      musicVolume: Number.isFinite(musicVolume) ? musicVolume : undefined,
      ttsEnabled: req.body.ttsEnabled !== "false",
      ttsEngine: req.body.ttsEngine || undefined,
      ttsVoice: req.body.ttsVoice,
      ttsStyle: req.body.ttsStyle || undefined,
      captionStyle: req.body.captionStyle || undefined,
      storeName: await resolveStoreName(user.id, req.body.selectedPageId),
      tempFiles: uploaded.map((f) => f.path),
    });
    if (!parsed.success) {
      await removeFiles(uploaded);
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Paramètres invalides" });
    }

    const job = await enqueueReelJob({ kind: "images", userId: user.id, params: parsed.data });
    res.json({ jobId: job.id, message: "Rendu démarré en arrière-plan" });
  } catch (err) {
    console.error("❌ Remotion pre-render error:", err);
    await removeFiles(uploaded);
    res.status(500).json({ error: "Erreur lors du lancement du rendu: " + (err instanceof Error ? err.message : err) });
  }
});

async function removeFiles(files: Express.Multer.File[]): Promise<void> {
  await Promise.all(files.map((f) => fs.promises.unlink(f.path).catch(() => { /* déjà absent */ })));
}

/**
 * POST /api/remotion/publish
 * Range la vidéo rendue dans la médiathèque puis la publie (ou la planifie).
 */
remotionRouter.post("/publish", async (req, res) => {
  try {
    const user = req.user as User;

    const { videoUrl, pageIds, scheduledFor, description } = req.body as {
      videoUrl: string;
      pageIds: string[];
      scheduledFor?: string;
      description?: string;
    };

    if (!videoUrl) return res.status(400).json({ error: "videoUrl requis" });
    if (!pageIds?.length) return res.status(400).json({ error: "Au moins une page requise" });

    // Chemin local du rendu à partir de son URL temporaire
    const filename = path.basename(videoUrl.split("?")[0]);
    const localPath = path.join(uploadDir, filename);
    if (!fs.existsSync(localPath)) {
      return res.status(400).json({ error: "Fichier vidéo introuvable (expiré ?)" });
    }

    const videoBuffer = await fs.promises.readFile(localPath);
    const mediaRecord = await storeRenderedVideo(user.id, videoBuffer, filename);

    const post = await dbStorage.createPost({
      userId: user.id,
      content: description || "",
      aiGenerated: "false",
      status: scheduledFor ? "scheduled" : "draft",
      scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
    });
    await dbStorage.updatePostMedia(post.id, [mediaRecord.id]);

    const results = await publishReelToPages({
      postId: post.id,
      pageIds,
      videoBuffer,
      description: description || "",
      scheduledFor,
    });

    res.json({ success: results.some((r) => r.success), results, postId: post.id });
  } catch (err) {
    console.error("❌ Remotion publish error:", err);
    res.status(500).json({ error: "Erreur lors de la publication: " + (err instanceof Error ? err.message : err) });
  }
});
