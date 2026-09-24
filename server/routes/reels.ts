/**
 * Routes API pour les Reels Facebook et la musique Jamendo
 */

import { Router, Request, Response } from 'express';
import type { User } from '@shared/schema';
import { storage } from '../storage';
import { ffmpegService, FFmpegServiceError } from '../services/ffmpeg';
import { ttsPreviewSchema, videoReelParamsSchema, type VideoReelParams } from '@shared/reel';
import { enqueueReelJob, countActiveReelJobs } from '../services/reels/queue';
import { resolveGeminiApiKey, resolveLogoPath, resolveStoreName } from '../services/reels/assets';
import { configuredRenderer } from '../services/reels/videoPipeline';
import { openRouterService, describeGenerationError } from '../services/openrouter';

import { estimateVoiceTiming } from '../services/ttsSync';
/** Piste musicale telle qu'attendue par le client. */
interface MusicTrack {
    id: string;
    title: string;
    artist: string;
    albumName: string;
    duration: number;
    previewUrl: string;
    downloadUrl: string;
    imageUrl: string;
    license: string;
}

export const reelsRouter = Router();

// ============================================
// ROUTES MUSIQUE JAMENDO
// ============================================

/**
 * Recherche de musiques par durée
 * GET /api/music/search?minDuration=10&maxDuration=60&genre=pop&limit=10
 */
reelsRouter.get('/music/search', async (req: Request, res: Response) => {
    try {
        const {
            minDuration = '10',
            maxDuration = '120',
            genre,
            limit = '10',
            offset = '0',
            search,
        } = req.query;

        res.json({
            tracks: [],
            pagination: {
                offset: parseInt(offset as string),
                limit: parseInt(limit as string),
                hasMore: false,
            },
        });
    } catch (error) {
        console.error('❌ Error searching music:', error);
        res.status(500).json({ error: 'Erreur lors de la recherche de musique' });
    }
});

/**
 * Voir plus de musiques (pagination)
 * GET /api/music/more?offset=10&minDuration=10&maxDuration=60
 */
reelsRouter.get('/music/more', async (req: Request, res: Response) => {
    try {
        const {
            minDuration = '10',
            maxDuration = '120',
            genre,
            limit = '10',
            offset = '0',
            search,
        } = req.query;

        res.json({
            tracks: [],
            pagination: {
                offset: parseInt(offset as string),
                limit: parseInt(limit as string),
                hasMore: false,
            },
        });
    } catch (error) {
        console.error('❌ Error loading more music:', error);
        res.status(500).json({ error: 'Erreur lors du chargement des musiques' });
    }
});

/**
 * Obtenir les tracks populaires
 * GET /api/music/popular
 */
reelsRouter.get('/music/popular', async (req: Request, res: Response) => {
    try {
        res.json({ tracks: [] });
    } catch (error) {
        console.error('❌ Error fetching popular music:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des musiques populaires' });
    }
});

// ============================================
// ROUTES FAVORIS MUSIQUE
// ============================================

/**
 * Obtenir les favoris de l'utilisateur
 * GET /api/music/favorites
 */
reelsRouter.get('/music/favorites', async (req: Request, res: Response) => {
    try {
        const user = req.user as User;
        const favorites = await storage.getMusicFavorites(user.id);

        // Convertir en format MusicTrack pour le client
        const tracks: MusicTrack[] = favorites.map(f => ({
            id: f.trackId,
            title: f.title,
            artist: f.artist,
            albumName: f.albumName || '',
            duration: f.duration,
            previewUrl: f.previewUrl,
            downloadUrl: f.downloadUrl,
            imageUrl: f.imageUrl || '',
            license: f.license || '',
        }));

        res.json({ tracks, isFavorites: true });
    } catch (error) {
        console.error('❌ Error fetching music favorites:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des favoris' });
    }
});

/**
 * Vérifier si un track est en favori
 * GET /api/music/favorites/check/:trackId
 */
reelsRouter.get('/music/favorites/check/:trackId', async (req: Request, res: Response) => {
    try {
        const user = req.user as User;
        const { trackId } = req.params;

        const isFavorite = await storage.isMusicFavorite(user.id, trackId);
        res.json({ isFavorite });
    } catch (error) {
        console.error('❌ Error checking music favorite:', error);
        res.status(500).json({ error: 'Erreur lors de la vérification du favori' });
    }
});

/**
 * Ajouter un favori
 * POST /api/music/favorites
 */
reelsRouter.post('/music/favorites', async (req: Request, res: Response) => {
    try {
        const user = req.user as User;
        const { trackId, title, artist, albumName, duration, previewUrl, downloadUrl, imageUrl, license } = req.body;

        if (!trackId || !title) {
            return res.status(400).json({ error: 'trackId et title requis' });
        }

        // Vérifier si déjà en favori
        const alreadyFavorite = await storage.isMusicFavorite(user.id, trackId);
        if (alreadyFavorite) {
            return res.json({ success: true, message: 'Déjà en favori' });
        }

        await storage.addMusicFavorite({
            userId: user.id,
            trackId,
            title,
            artist: artist || '',
            albumName: albumName || null,
            duration: duration || 0,
            previewUrl: previewUrl || '',
            downloadUrl: downloadUrl || '',
            imageUrl: imageUrl || null,
            license: license || null,
        });

        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error adding music favorite:', error);
        res.status(500).json({ error: 'Erreur lors de l\'ajout du favori' });
    }
});

/**
 * Supprimer un favori
 * DELETE /api/music/favorites/:trackId
 */
reelsRouter.delete('/music/favorites/:trackId', async (req: Request, res: Response) => {
    try {
        const user = req.user as User;
        const { trackId } = req.params;

        await storage.removeMusicFavorite(user.id, trackId);
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error removing music favorite:', error);
        res.status(500).json({ error: 'Erreur lors de la suppression du favori' });
    }
});

// ============================================
// ROUTE DÉTAILS TRACK (après les routes /music/favorites et /music/popular)
// ============================================

/**
 * Détails d'un track
 * GET /api/music/:trackId
 */
reelsRouter.get('/music/:trackId', async (req: Request, res: Response) => {
    try {
        const { trackId } = req.params;
        return res.status(404).json({ error: 'Musique non trouvée' });
    } catch (error) {
        console.error('❌ Error fetching music details:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des détails' });
    }
});

// ============================================
// ROUTES REELS
// ============================================

/**
 * Générer des textes IA pour un Reel (utilise le même service que les posts)
 * POST /api/reels/generate-text
 */
reelsRouter.post('/reels/generate-text', async (req: Request, res: Response) => {
    try {
        const user = req.user as User;
        const { productInfo, model } = req.body;

        if (!productInfo) {
            return res.status(400).json({ error: 'Informations produit requises' });
        }

        // Convertir la chaîne de texte simple en objet ProductInfo
        // Si l'utilisateur envoie une chaîne, on l'utilise comme description du produit
        const productInfoObject = typeof productInfo === 'string'
            ? {
                name: productInfo.trim(),  // Utiliser le texte comme nom
                description: productInfo.trim(),  // Et comme description
            }
            : productInfo;

        const generatedTexts = await openRouterService.generatePostText(productInfoObject, user.id, model);

        // Sauvegarder la génération
        await storage.createAiGeneration({
            userId: user.id,
            productInfo: productInfoObject,
            generatedTexts,
        });

        res.json({ variants: generatedTexts });
    } catch (error) {
        console.error('❌ Error generating Reel text:', error);
        const { status, message } = describeGenerationError(error);
        res.status(status).json({ error: message });
    }
});

/**
 * Prévisualiser la voix TTS
 * POST /api/reels/tts-preview
 */
reelsRouter.post('/reels/tts-preview', async (req: Request, res: Response) => {
    const parsed = ttsPreviewSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Paramètres invalides' });
    }
    const { text, ttsVoice, ttsEngine, ttsStyle } = parsed.data;

    try {
        const preview = await ffmpegService.previewVoice(text, {
            voice: ttsVoice,
            engine: ttsEngine,
            style: ttsStyle,
            geminiApiKey: await resolveGeminiApiKey(ttsEngine),
        });
        res.json({
            success: true,
            audioBase64: preview.audio.toString('base64'),
            duration: preview.duration,
            words: preview.words,
            engine: preview.engine,
            voice: preview.voice,
            warnings: preview.warnings,
        });
    } catch (error) {
        console.error('❌ Error generating TTS preview:', error);
        const message = error instanceof Error ? error.message : 'Erreur lors de la génération de la voix';
        res.status(error instanceof FFmpegServiceError && error.status === 400 ? 400 : 502).json({ error: message });
    }
});

/**
 * Calculer la synchronisation texte/voix TTS
 * POST /api/reels/sync-info
 */
reelsRouter.post('/reels/sync-info', async (req: Request, res: Response) => {
    try {
        const { text } = req.body;
        if (!text) {
            return res.status(400).json({ error: 'Texte requis' });
        }
        // Estimation locale : ne déclenche aucune synthèse (payante avec Gemini)
        res.json(estimateVoiceTiming(text));
    } catch (error) {
        console.error('❌ Error calculating sync:', error);
        res.status(500).json({ error: 'Erreur de calcul de synchronisation' });
    }
});

/**
 * Créer et publier un Reel : le rendu part dans la file persistante.
 * POST /api/reels
 */
reelsRouter.post('/reels', async (req: Request, res: Response) => {
    try {
        const user = req.user as User;
        const parsed = videoReelParamsSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Paramètres invalides' });
        }

        const params: VideoReelParams = {
            ...parsed.data,
            storeName: await resolveStoreName(user.id, parsed.data.pageIds[0]),
        };

        const waiting = await countActiveReelJobs();

        const post = await storage.createPost({
            userId: user.id,
            content: params.description || params.overlayText || '',
            aiGenerated: 'false',
            status: params.scheduledFor ? 'scheduled' : 'draft',
            scheduledFor: params.scheduledFor ? new Date(params.scheduledFor) : undefined,
            generationStatus: 'pending',
            generationProgress: 0,
        });

        await enqueueReelJob({ kind: 'video', userId: user.id, postId: post.id, params });
        console.log(`✨ Reel en file. Post ${post.id}, ${waiting} job(s) avant lui.`);

        res.json({
            success: true,
            postId: post.id,
            queued: waiting > 0,
            message: waiting > 0
                ? "File d'attente occupée. Votre vidéo sera traitée dès que possible."
                : 'Traitement démarré en arrière-plan.',
            results: [],
            videoUrl: '',
        });
    } catch (error) {
        console.error('❌ Error initiating Reel:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Erreur lors de l\'initialisation du Reel',
        });
    }
});

/**
 * Obtenir la configuration des services Reels
 * GET /api/reels/config
 */
reelsRouter.get('/reels/config', async (req: Request, res: Response) => {
    try {
        const [ffmpegConfigured, logoUrl] = await Promise.all([
            ffmpegService.healthCheck().catch(() => false),
            resolveLogoPath(),
        ]);

        res.json({
            jamendo: { configured: false },
            freesound: { configured: false },
            ffmpeg: { configured: ffmpegConfigured },
            // Aperçu : logo affiché par le lecteur, moteur de rendu utilisé
            logoUrl: logoUrl ?? null,
            renderer: configuredRenderer(),
        });
    } catch (error) {
        console.error('❌ Error fetching Reels config:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération de la configuration' });
    }
});

/**
 * Reels en cours de génération
 * GET /api/reels/ongoing
 */
reelsRouter.get('/reels/ongoing', async (req: Request, res: Response) => {
    try {
        const user = req.user as User;
        const ongoing = await storage.getOngoingReelPosts(user.id);
        res.json(ongoing);
    } catch (error) {
        console.error('❌ Error fetching ongoing reels:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des reels en cours' });
    }
});

/**
 * Supprimer un Reel
 * DELETE /api/reels/:id
 */
reelsRouter.delete('/reels/:id', async (req: Request, res: Response) => {
    try {
        const user = req.user as User;
        const { id } = req.params;

        // Vérifier si le post existe
        const post = await storage.getPost(id);
        if (!post) {
            return res.status(404).json({ error: 'Reel non trouvé' });
        }

        // Vérifier les permissions (admin ou propriétaire)
        if (user.role !== 'admin' && post.userId !== user.id) {
            return res.status(403).json({ error: 'Non autorisé à supprimer ce Reel' });
        }

        // Supprimer le post (cascade supprimera scheduled_posts et liens media)
        await storage.deletePost(id);

        res.json({ success: true, message: 'Reel supprimé avec succès' });
    } catch (error) {
        console.error('❌ Error deleting Reel:', error);
        res.status(500).json({ error: 'Erreur lors de la suppression du Reel' });
    }
});
