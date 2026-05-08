import { Router } from "express";
import { z } from "zod";
import path from "path";
import { storage } from "../storage";
import { db } from "../db";
import { postMedia } from "@shared/schema";
import { minioService } from "../services/minio";
import { requireApiKey } from "../middleware/apiKey";

const router = Router();

router.use(requireApiKey);

const publishSchema = z.object({
  content: z.string().min(1, "Le contenu est requis"),
  imageUrl: z.string().url("URL d'image invalide").optional(),
  pageIds: z.array(z.string()).min(1, "Au moins une page est requise"),
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
 *   pageIds      string[]      IDs des pages cibles (social_pages.id)
 *   scheduledAt  ISO8601?      Date/heure de publication (absent = immédiat)
 *   postType     feed|story|both  Type de publication (défaut: feed)
 *   userId       string?       ID utilisateur propriétaire (défaut: premier admin)
 */
router.post("/publish", async (req, res) => {
  try {
    const parsed = publishSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Données invalides",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { content, imageUrl, pageIds, scheduledAt, postType, userId: bodyUserId } = parsed.data;

    // Résoudre l'utilisateur propriétaire
    let ownerId = bodyUserId;
    if (!ownerId) {
      const users = await storage.getAllUsers();
      const admin = users.find((u) => u.role === "admin");
      if (!admin) {
        return res.status(500).json({ error: "Aucun utilisateur admin trouvé" });
      }
      ownerId = admin.id;
    } else {
      const user = await storage.getUser(ownerId);
      if (!user) {
        return res.status(400).json({ error: `Utilisateur introuvable: ${ownerId}` });
      }
    }

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
    if ((postType === "story" || postType === "both") && !imageUrl) {
      return res.status(400).json({ error: "Les stories nécessitent une image (imageUrl requis)" });
    }

    // Télécharger l'image si fournie
    let mediaRecord: { id: string; originalUrl: string } | null = null;
    if (imageUrl) {
      const { buffer, ext, mimeType } = await downloadImage(imageUrl);

      const fileName = `external-${Date.now()}${ext}`;
      const uploaded = await minioService.uploadMedia(buffer, fileName, ownerId, mimeType);

      const mediaType: "image" | "video" = mimeType.startsWith("video/") ? "video" : "image";
      mediaRecord = await storage.createMedia({
        userId: ownerId,
        type: mediaType,
        cloudinaryPublicId: uploaded.publicId,
        originalUrl: uploaded.originalUrl,
        facebookFeedUrl: uploaded.facebookFeedUrl,
        instagramFeedUrl: uploaded.instagramFeedUrl,
        instagramStoryUrl: uploaded.instagramStoryUrl,
        fileName,
        fileSize: String(buffer.length),
      });
    }

    // Créer le post
    const scheduledFor = scheduledAt ? new Date(scheduledAt) : null;

    const post = await storage.createPost({
      userId: ownerId,
      content,
      status: scheduledFor ? "scheduled" : "scheduled",
      scheduledFor: scheduledFor ?? new Date(),
      aiGenerated: false,
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
    console.error("[external API] Error:", error);
    const message = error instanceof Error ? error.message : "Erreur interne";
    return res.status(500).json({ error: message });
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
      const users = await storage.getAllUsers();
      const allPages = await Promise.all(users.map(u => storage.getSocialPages(u.id)));
      pageIds = allPages.flat().map(p => p.id);
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
        // Récupérer les médias du post
        const postMediaLinks = await storage.getPostMedia(post.id);
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
 */
router.patch("/posts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { content, scheduledAt, imageUrl } = req.body;

    // Vérifier que le post existe et est modifiable
    const post = await storage.getPost(id);
    if (!post) {
      return res.status(404).json({ error: "Post introuvable" });
    }
    if (post.status === "published") {
      return res.status(400).json({ error: "Impossible de modifier un post déjà publié" });
    }

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

    // Remplacer le média si une nouvelle imageUrl est fournie
    if (imageUrl !== undefined) {
      // Résoudre le userId pour le stockage du média
      const ownerId = post.userId;
      const { buffer, ext, mimeType } = await downloadImage(imageUrl);
      const fileName = `external-edit-${Date.now()}${ext}`;
      const uploaded = await minioService.uploadMedia(buffer, fileName, ownerId, mimeType);
      const mediaType: "image" | "video" = mimeType.startsWith("video/") ? "video" : "image";
      const mediaRecord = await storage.createMedia({
        userId: ownerId,
        type: mediaType,
        cloudinaryPublicId: uploaded.publicId,
        originalUrl: uploaded.originalUrl,
        facebookFeedUrl: uploaded.facebookFeedUrl,
        instagramFeedUrl: uploaded.instagramFeedUrl,
        instagramStoryUrl: uploaded.instagramStoryUrl,
        fileName,
        fileSize: String(buffer.length),
      });

      // Remplacer les médias existants par le nouveau
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
    console.error("[external API] PATCH /posts/:id error:", error);
    const message = error instanceof Error ? error.message : "Erreur interne";
    return res.status(500).json({ error: message });
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
