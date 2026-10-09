import { Router, type Request, type Response as ExpressResponse, type NextFunction } from "express";
import { z } from "zod";
import multer from "multer";
import { storage } from "../storage";
import { db } from "../db";
import { postMedia, type Media } from "@shared/schema";
import { minioService } from "../services/minio";
import { requireApiKey } from "../middleware/apiKey";
import { MAX_EXTERNAL_IMAGE_SIZE, decodeImageData, normalizePageIds, validateImage } from "../services/imageData";

const router = Router();

router.use(requireApiKey);

/** Erreur imputable à la requête : renvoyée telle quelle avec son code HTTP. */
class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Fichier gardé en mémoire : 10 MB max, le contenu est validé par sa signature
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_EXTERNAL_IMAGE_SIZE, files: 1 },
});

/**
 * Accepte un fichier image en multipart/form-data sous le champ `field`.
 * Sans effet sur les requêtes JSON. Les erreurs de multer deviennent des
 * réponses JSON explicites au lieu de remonter au gestionnaire global.
 */
function acceptImageFile(field: string) {
  const middleware = imageUpload.single(field);
  return (req: Request, res: ExpressResponse, next: NextFunction) => {
    middleware(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "Image trop volumineuse (max 10 MB)" });
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
          return res.status(400).json({ error: `Fichier attendu dans le champ « ${field} »` });
        }
      }
      const message = err instanceof Error ? err.message : "Requête multipart invalide";
      return res.status(400).json({ error: message });
    });
  };
}

const publishSchema = z.object({
  content: z.string().min(1, "Le contenu est requis"),
  imageUrl: z.string().url("URL d'image invalide").optional(),
  imageData: z.string().min(1).optional(),
  mediaId: z.string().min(1).optional(),
  pageIds: z.preprocess(normalizePageIds, z.array(z.string()).min(1, "Au moins une page est requise")),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  postType: z.enum(["feed", "story", "both"]).default("feed"),
  userId: z.string().optional(),
});

const IMAGE_MIME_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

async function downloadImage(url: string): Promise<{ buffer: Buffer; ext: string; mimeType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Impossible de télécharger l'image (HTTP ${response.status})`);
  }

  const contentType = response.headers.get("content-type")?.split(";")[0].trim() ?? "";
  const ext = IMAGE_MIME_TYPES[contentType];

  if (!ext) {
    throw new Error(`Type MIME non supporté: ${contentType}. Formats acceptés: JPEG, PNG, WebP, GIF`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
  if (buffer.length > MAX_SIZE) {
    throw new Error(`Image trop volumineuse (${(buffer.length / 1024 / 1024).toFixed(1)} MB, max 10 MB)`);
  }

  return { buffer, ext, mimeType: contentType };
}

/** Enregistre une image dans la médiathèque de `ownerId`. */
async function storeImage(buffer: Buffer, ownerId: string, prefix: string): Promise<Media> {
  let detected: { mimeType: string; ext: string };
  try {
    detected = validateImage(buffer);
  } catch (error) {
    const tooLarge = buffer.length > MAX_EXTERNAL_IMAGE_SIZE;
    throw new ApiError(tooLarge ? 413 : 400, error instanceof Error ? error.message : "Image invalide");
  }

  const fileName = `${prefix}-${Date.now()}${detected.ext}`;
  const uploaded = await minioService.uploadMedia(buffer, fileName, ownerId, detected.mimeType);
  return storage.createMedia({
    userId: ownerId,
    type: "image",
    cloudinaryPublicId: uploaded.publicId,
    originalUrl: uploaded.originalUrl,
    facebookFeedUrl: uploaded.facebookFeedUrl,
    instagramFeedUrl: uploaded.instagramFeedUrl,
    instagramStoryUrl: uploaded.instagramStoryUrl,
    fileName,
    fileSize: buffer.length,
  });
}

interface ImageSources {
  file?: Express.Multer.File;
  imageUrl?: string;
  imageData?: string;
  mediaId?: string;
}

function countImageSources({ file, imageUrl, imageData, mediaId }: ImageSources): number {
  return [file, imageUrl, imageData, mediaId].filter((source) => source !== undefined).length;
}

/**
 * Résout l'image d'une publication, quelle que soit la façon dont elle a été
 * transmise : fichier multipart, base64 (`imageData`), média déjà envoyé via
 * POST /api/v1/media (`mediaId`) ou URL publique à télécharger (`imageUrl`).
 */
async function resolveImage(sources: ImageSources, ownerId: string, prefix: string): Promise<Media | null> {
  if (countImageSources(sources) > 1) {
    throw new ApiError(400, "Une seule source d'image à la fois : fichier, imageData, mediaId ou imageUrl");
  }
  for (const key of ["imageUrl", "imageData", "mediaId"] as const) {
    if (sources[key] !== undefined && typeof sources[key] !== "string") {
      throw new ApiError(400, `${key} doit être une chaîne`);
    }
  }

  if (sources.mediaId !== undefined) {
    const media = await storage.getMediaById(sources.mediaId);
    if (!media) {
      throw new ApiError(400, `Média introuvable: ${sources.mediaId}`);
    }
    return media;
  }
  if (sources.file) {
    return storeImage(sources.file.buffer, ownerId, prefix);
  }
  if (sources.imageData !== undefined) {
    let buffer: Buffer;
    try {
      buffer = decodeImageData(sources.imageData);
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : "imageData invalide");
    }
    return storeImage(buffer, ownerId, prefix);
  }
  if (sources.imageUrl !== undefined) {
    const { buffer } = await downloadImage(sources.imageUrl);
    return storeImage(buffer, ownerId, prefix);
  }
  return null;
}

/** Propriétaire des médias et posts créés : `userId` fourni, sinon le premier admin. */
async function resolveOwnerId(userId: string | undefined): Promise<string> {
  if (userId) {
    const user = await storage.getUser(userId);
    if (!user) {
      throw new ApiError(400, `Utilisateur introuvable: ${userId}`);
    }
    return userId;
  }
  const users = await storage.getAllUsers();
  const admin = users.find((u) => u.role === "admin");
  if (!admin) {
    throw new ApiError(500, "Aucun utilisateur admin trouvé");
  }
  return admin.id;
}

function sendError(res: ExpressResponse, error: unknown, context: string) {
  if (error instanceof ApiError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(`[external API] ${context} error:`, error);
  const message = error instanceof Error ? error.message : "Erreur interne";
  return res.status(500).json({ error: message });
}

/**
 * POST /api/v1/media
 *
 * Envoie une image dans la médiathèque, sans passer par un hébergeur public.
 * Renvoie un `id` à passer en `mediaId` à /publish ou PATCH /posts/:id.
 *
 * Deux formats :
 *   multipart/form-data   champ `file` (+ `userId` optionnel)
 *   application/json      { "imageData": "<base64 ou data URL>", "userId"?: "..." }
 *
 * Formats : JPEG, PNG, WebP, GIF — 10 MB max.
 */
router.post("/media", acceptImageFile("file"), async (req, res) => {
  try {
    const { imageData, userId } = (req.body ?? {}) as { imageData?: unknown; userId?: unknown };
    if (imageData !== undefined && typeof imageData !== "string") {
      return res.status(400).json({ error: "imageData doit être une chaîne base64" });
    }
    if (!req.file && imageData === undefined) {
      return res.status(400).json({
        error: "Aucune image reçue : envoyez un fichier (multipart, champ « file ») ou imageData (base64)",
      });
    }
    if (req.file && imageData !== undefined) {
      return res.status(400).json({ error: "Envoyez soit un fichier, soit imageData, pas les deux" });
    }

    const ownerId = await resolveOwnerId(typeof userId === "string" && userId ? userId : undefined);
    const media = await resolveImage({ file: req.file, imageData }, ownerId, "external");

    return res.status(201).json({
      id: media!.id,
      url: media!.originalUrl,
      type: media!.type,
      fileName: media!.fileName,
      fileSize: media!.fileSize,
    });
  } catch (error) {
    return sendError(res, error, "POST /media");
  }
});

/**
 * POST /api/v1/publish
 *
 * Crée une publication (avec image optionnelle téléchargée depuis une URL)
 * et la programme pour une ou plusieurs pages Facebook/Instagram.
 *
 * Headers:
 *   X-API-Key: <EXTERNAL_API_KEY>
 *
 * Body:
 *   content      string        Texte de la publication
 *   imageUrl     string?       URL publique de l'image à télécharger
 *   imageData    string?       Image en base64 (ou data URL)
 *   mediaId      string?       Image déjà envoyée via POST /api/v1/media
 *   pageIds      string[]      IDs des pages cibles (social_pages.id)
 *   scheduledAt  ISO8601?      Date/heure de publication (absent = immédiat)
 *   postType     feed|story|both  Type de publication (défaut: feed)
 *   userId       string?       ID utilisateur propriétaire (défaut: premier admin)
 *
 * Accepte aussi multipart/form-data : mêmes champs en texte (pageIds en
 * tableau JSON ou séparés par des virgules) et l'image dans le champ `image`.
 * Une seule source d'image par requête.
 */
router.post("/publish", acceptImageFile("image"), async (req, res) => {
  try {
    const parsed = publishSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Données invalides",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { content, imageUrl, imageData, mediaId, pageIds, scheduledAt, postType, userId: bodyUserId } = parsed.data;
    const imageSources: ImageSources = { file: req.file, imageUrl, imageData, mediaId };

    const ownerId = await resolveOwnerId(bodyUserId);

    // Vérifier que toutes les pages existent
    const resolvedPages: Array<{ id: string; pageName: string }> = [];
    for (const pageId of pageIds) {
      const page = await storage.getSocialPage(pageId);
      if (!page) {
        return res.status(400).json({ error: `Page introuvable: ${pageId}` });
      }
      resolvedPages.push({ id: page.id, pageName: page.pageName });
    }

    // Validation story → image obligatoire
    if ((postType === "story" || postType === "both") && countImageSources(imageSources) === 0) {
      return res.status(400).json({ error: "Les stories nécessitent une image (fichier, imageData, mediaId ou imageUrl)" });
    }

    const mediaRecord = await resolveImage(imageSources, ownerId, "external");

    // Créer le post
    const scheduledFor = scheduledAt ? new Date(scheduledAt) : null;

    const post = await storage.createPost({
      userId: ownerId,
      content,
      status: scheduledFor ? "scheduled" : "scheduled",
      scheduledFor: scheduledFor ?? new Date(),
      aiGenerated: "false",
    });

    // Lier le média si présent
    if (mediaRecord) {
      await db.insert(postMedia).values({
        postId: post.id,
        mediaId: mediaRecord.id,
        displayOrder: 0,
      });
    }

    // Créer les scheduled_posts par page
    const scheduledAt_ = scheduledFor ?? new Date();
    const createdSchedules: Array<{ pageId: string; pageName: string; scheduledPostId: string }> = [];

    for (const page of resolvedPages) {
      if (postType === "both") {
        const story = await storage.createScheduledPost({
          postId: post.id,
          pageId: page.id,
          postType: "story",
          scheduledAt: scheduledAt_,
        });
        const feed = await storage.createScheduledPost({
          postId: post.id,
          pageId: page.id,
          postType: "feed",
          scheduledAt: scheduledAt_,
        });
        createdSchedules.push(
          { pageId: page.id, pageName: page.pageName, scheduledPostId: story.id },
          { pageId: page.id, pageName: page.pageName, scheduledPostId: feed.id }
        );
      } else {
        const sp = await storage.createScheduledPost({
          postId: post.id,
          pageId: page.id,
          postType: postType,
          scheduledAt: scheduledAt_,
        });
        createdSchedules.push({ pageId: page.id, pageName: page.pageName, scheduledPostId: sp.id });
      }
    }

    return res.status(201).json({
      success: true,
      post: {
        id: post.id,
        content: post.content,
        status: post.status,
        scheduledAt: scheduledAt_,
        postType,
        pages: createdSchedules,
        media: mediaRecord
          ? { id: mediaRecord.id, url: mediaRecord.originalUrl }
          : null,
      },
    });
  } catch (error) {
    return sendError(res, error, "POST /publish");
  }
});

/**
 * GET /api/v1/pages
 *
 * Liste toutes les pages disponibles (id + nom + plateforme).
 * Utile pour connaître les pageIds à passer à /publish.
 */
router.get("/pages", async (_req, res) => {
  try {
    const users = await storage.getAllUsers();
    const admin = users.find((u) => u.role === "admin");
    if (!admin) {
      return res.status(500).json({ error: "Aucun utilisateur admin trouvé" });
    }

    const pages = await storage.getSocialPages(admin.id);
    return res.json(
      pages.map((p) => ({
        id: p.id,
        pageName: p.pageName,
        platform: p.platform,
        pageId: p.pageId,
        tokenStatus: p.tokenStatus,
      }))
    );
  } catch (error) {
    console.error("[external API] Error listing pages:", error);
    return res.status(500).json({ error: "Erreur interne" });
  }
});

/**
 * GET /api/v1/posts
 *
 * Liste les publications planifiées (à venir).
 *
 * Query params:
 *   pageId    string?   Filtrer par page spécifique
 *   from      ISO8601?  Date de début (scheduledAt >= from)
 *   to        ISO8601?  Date de fin (scheduledAt <= to)
 *   status    string?   Statut du post (défaut: scheduled)
 */
router.get("/posts", async (req, res) => {
  try {
    const { pageId, from, to, status } = req.query as Record<string, string | undefined>;
    const postStatus = status || "scheduled";

    // Récupérer toutes les pages (ou une seule si filtrée)
    let pageIds: string[];
    if (pageId) {
      const page = await storage.getSocialPage(pageId);
      if (!page) {
        return res.status(404).json({ error: `Page introuvable: ${pageId}` });
      }
      pageIds = [pageId];
    } else {
      pageIds = (await storage.getAllSocialPages()).map(p => p.id);
    }

    if (pageIds.length === 0) {
      return res.json([]);
    }

    const startDate = from ? new Date(from) : undefined;
    const endDate = to ? new Date(to) : undefined;

    const scheduledPosts = await storage.getScheduledPostsByPages(pageIds, startDate, endDate);

    // Grouper par postId, filtrer par statut et posts non publiés
    const postMap = new Map<string, {
      id: string;
      content: string;
      status: string;
      scheduledFor: Date | null;
      createdAt: Date | null;
      media: Array<{ id: string; url: string; type: string }>;
      schedules: Array<{
        id: string;
        pageId: string;
        pageName: string;
        platform: string;
        postType: string;
        scheduledAt: Date;
      }>;
    }>();

    for (const sp of scheduledPosts) {
      // sp = { ...scheduled_posts, post: Post, page: SocialPage }
      const post = sp.post;
      if (!post) continue;

      // Ne montrer que les posts non publiés avec le bon statut
      if (sp.publishedAt) continue;
      if (post.status !== postStatus && postStatus !== "all") continue;

      if (!postMap.has(post.id)) {
        // Récupérer les médias du post, en une requête plutôt qu'une par média
        const postMediaLinks = await storage.getPostMedia(post.id);
        const byId = new Map(
          (await storage.getMediaByIds(postMediaLinks.map(link => link.mediaId)))
            .map(item => [item.id, item])
        );
        const mediaItems = postMediaLinks
          .map(link => byId.get(link.mediaId))
          .filter((item): item is NonNullable<typeof item> => item !== undefined)
          .map(item => ({
            id: item.id,
            url: item.originalUrl,
            type: item.type,
          }));

        postMap.set(post.id, {
          id: post.id,
          content: post.content,
          status: post.status,
          scheduledFor: post.scheduledFor,
          createdAt: post.createdAt,
          media: mediaItems,
          schedules: [],
        });
      }

      const page = sp.page;
      postMap.get(post.id)!.schedules.push({
        id: sp.id,
        pageId: sp.pageId,
        pageName: page?.pageName || "Inconnu",
        platform: page?.platform || "facebook",
        postType: sp.postType,
        scheduledAt: sp.scheduledAt,
      });
    }

    return res.json(Array.from(postMap.values()));
  } catch (error) {
    console.error("[external API] GET /posts error:", error);
    return res.status(500).json({ error: "Erreur interne" });
  }
});

/**
 * PATCH /api/v1/posts/:id
 *
 * Modifier une publication planifiée.
 *
 * Body:
 *   content      string?   Nouveau texte
 *   scheduledAt  ISO8601?  Nouvelle date/heure de publication
 *   imageUrl     string?   URL d'une nouvelle image (remplace l'existante)
 *   imageData    string?   Nouvelle image en base64 (remplace l'existante)
 *   mediaId      string?   Image déjà envoyée via POST /api/v1/media
 *
 * Accepte aussi multipart/form-data avec l'image dans le champ `image`.
 */
router.patch("/posts/:id", acceptImageFile("image"), async (req, res) => {
  try {
    const { id } = req.params;
    const { content, scheduledAt, imageUrl, imageData, mediaId } = req.body ?? {};

    // Vérifier que le post existe et est modifiable
    const post = await storage.getPost(id);
    if (!post) {
      return res.status(404).json({ error: "Post introuvable" });
    }
    if (post.status === "published") {
      return res.status(400).json({ error: "Impossible de modifier un post déjà publié" });
    }

    // Image résolue d'abord : une image refusée ne laisse pas le post à moitié modifié
    const mediaRecord = await resolveImage({ file: req.file, imageUrl, imageData, mediaId }, post.userId, "external-edit");

    // Mettre à jour le contenu si fourni
    if (content !== undefined) {
      await storage.updatePost(id, { content });
    }

    // Mettre à jour la date de planification si fournie
    if (scheduledAt !== undefined) {
      const newDate = new Date(scheduledAt);
      await storage.updatePost(id, { scheduledFor: newDate });

      // Propager à tous les scheduled_posts du post
      const scheduledPosts = await storage.getScheduledPostsByPost(id);
      for (const sp of scheduledPosts) {
        if (!sp.publishedAt) {
          await storage.updateScheduledPost(sp.id, { scheduledAt: newDate });
        }
      }
    }

    // Remplacer les médias existants par la nouvelle image
    if (mediaRecord) {
      await storage.updatePostMedia(id, [mediaRecord.id]);
    }

    // Retourner le post mis à jour
    const updatedPost = await storage.getPost(id);
    const postMediaLinks = await storage.getPostMedia(id);
    const mediaItems: Array<{ id: string; url: string; type: string }> = [];
    for (const link of postMediaLinks) {
      const mediaItem = await storage.getMediaById(link.mediaId);
      if (mediaItem) {
        mediaItems.push({
          id: mediaItem.id,
          url: mediaItem.originalUrl,
          type: mediaItem.type,
        });
      }
    }

    const scheduledPosts = await storage.getScheduledPostsByPost(id);

    return res.json({
      success: true,
      post: {
        id: updatedPost!.id,
        content: updatedPost!.content,
        status: updatedPost!.status,
        scheduledFor: updatedPost!.scheduledFor,
        createdAt: updatedPost!.createdAt,
        media: mediaItems,
        schedules: await Promise.all(scheduledPosts.filter(sp => !sp.publishedAt).map(async sp => {
          const page = await storage.getSocialPage(sp.pageId);
          return {
            id: sp.id,
            pageId: sp.pageId,
            pageName: page?.pageName || "Inconnu",
            platform: page?.platform || "facebook",
            postType: sp.postType,
            scheduledAt: sp.scheduledAt,
          };
        })),
      },
    });
  } catch (error) {
    return sendError(res, error, "PATCH /posts/:id");
  }
});

/**
 * DELETE /api/v1/posts/:id
 *
 * Supprimer un post planifié et toutes ses planifications associées.
 * La suppression en cascade gère les scheduled_posts et post_media.
 */
router.delete("/posts/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const post = await storage.getPost(id);
    if (!post) {
      return res.status(404).json({ error: "Post introuvable" });
    }
    if (post.status === "published") {
      return res.status(400).json({ error: "Impossible de supprimer un post déjà publié" });
    }

    await storage.deletePost(id);

    return res.json({ success: true, deleted: id });
  } catch (error) {
    console.error("[external API] DELETE /posts/:id error:", error);
    return res.status(500).json({ error: "Erreur interne" });
  }
});

export { router as externalRouter };
