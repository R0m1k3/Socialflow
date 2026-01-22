/**
 * Routes API pour les Reels Facebook et la musique Jamendo
 */

import { Router, Request, Response } from 'express';
import type { User, Media, SocialPage } from '@shared/schema';
import { storage } from '../storage';
import { freeSoundService, type MusicTrack } from '../services/freesound';
import { ffmpegService } from '../services/ffmpeg';
import { facebookService } from '../services/facebook';
import { cloudinaryService } from '../services/cloudinary';
import { openRouterService } from '../services/openrouter';

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

        const tracks = await freeSoundService.searchMusicByDuration({
            minDuration: parseInt(minDuration as string),
            maxDuration: parseInt(maxDuration as string),
            genre: genre as string | undefined,
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
            search: search as string | undefined,
        });

        res.json({
            tracks,
            pagination: {
                offset: parseInt(offset as string),
                limit: parseInt(limit as string),
                hasMore: tracks.length === parseInt(limit as string),
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

        const tracks = await freeSoundService.searchMusicByDuration({
            minDuration: parseInt(minDuration as string),
            maxDuration: parseInt(maxDuration as string),
            genre: genre as string | undefined,
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
            search: search as string | undefined,
        });

        res.json({
            tracks,
            pagination: {
                offset: parseInt(offset as string),
                limit: parseInt(limit as string),
                hasMore: tracks.length === parseInt(limit as string),
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
        const limit = parseInt(req.query.limit as string) || 10;
        const tracks = await freeSoundService.getPopularTracks(limit);
        res.json({ tracks });
    } catch (error) {
        console.error('❌ Error fetching popular music:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des musiques populaires' });
    }
});

/**
 * Détails d'un track
 * GET /api/music/:trackId
 */
reelsRouter.get('/music/:trackId', async (req: Request, res: Response) => {
    try {
        const { trackId } = req.params;
        const track = await freeSoundService.getMusicDetails(trackId);

        if (!track) {
            return res.status(404).json({ error: 'Musique non trouvée' });
        }

        res.json(track);
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
        res.status(500).json({ error: 'Erreur lors de la génération du texte' });
    }
});

/**
 * Prévisualiser un Reel (traitement sans publication)
 * POST /api/reels/preview
 */
reelsRouter.post('/reels/preview', async (req: Request, res: Response) => {
    try {
        const user = req.user as User;
        const {
            videoMediaId,
            musicTrackId,
            musicUrl,
            overlayText,
            ttsEnabled,
            ttsVoice,
            wordDuration = 0.6,
            fontSize = 60,
            musicVolume = 0.25,
            drawText = true,
        } = req.body;

        // Récupérer le média vidéo
        const media = await storage.getMediaById(videoMediaId);
        if (!media) {
            return res.status(404).json({ error: 'Vidéo non trouvée' });
        }

        if (media.type !== 'video') {
            return res.status(400).json({ error: 'Le média doit être une vidéo' });
        }

        // Récupérer l'URL de la musique si trackId fourni
        let finalMusicUrl = musicUrl;
        if (musicTrackId && !musicUrl) {
            const track = await freeSoundService.getMusicDetails(musicTrackId);
            if (track) {
                finalMusicUrl = track.downloadUrl;
            }
        }

        // Traiter la vidéo via FFmpeg
        const result = await ffmpegService.processReelFromUrl(media.originalUrl, {
            text: overlayText,
            musicUrl: finalMusicUrl,
            ttsEnabled,
            ttsVoice,
            wordDuration,
            fontSize,
            musicVolume,
            drawText,
        });

        if (!result.success) {
            return res.status(500).json({ error: result.error || 'Erreur de traitement vidéo' });
        }

        // Retourner la vidéo en base64 pour prévisualisation
        res.json({
            success: true,
            videoBase64: result.videoBase64,
            duration: result.duration,
        });
    } catch (error) {
        console.error('❌ Error previewing Reel:', error);
        res.status(500).json({ error: 'Erreur lors de la prévisualisation du Reel' });
    }
});

/**
 * Créer et publier un Reel
 * POST /api/reels
 */
reelsRouter.post('/reels', async (req: Request, res: Response) => {
    try {
        const user = req.user as User;
        const {
            videoMediaId,
            musicTrackId,
            musicUrl,
            overlayText,
            description,
            ttsEnabled,
            ttsVoice,
            pageIds,
            scheduledFor,
            wordDuration = 0.6,
            fontSize = 60,
            musicVolume = 0.25,
            drawText = true,
        } = req.body;

        // Validation
        if (!videoMediaId) {
            return res.status(400).json({ error: 'Vidéo requise' });
        }

        if (!pageIds || pageIds.length === 0) {
            return res.status(400).json({ error: 'Au moins une page requise' });
        }

        // Récupérer le média vidéo
        const media = await storage.getMediaById(videoMediaId);
        if (!media) {
            return res.status(404).json({ error: 'Vidéo non trouvée' });
        }

        if (media.type !== 'video') {
            return res.status(400).json({ error: 'Le média doit être une vidéo' });
        }

        // Récupérer l'URL de la musique si trackId fourni
        let finalMusicUrl = musicUrl;
        if (musicTrackId && !musicUrl) {
            const track = await freeSoundService.getMusicDetails(musicTrackId);
            if (track) {
                finalMusicUrl = track.downloadUrl;
            }
        }

        console.log('🎬 Processing Reel:', {
            videoMediaId,
            hasMusic: !!finalMusicUrl,
            hasText: !!overlayText,
            textPreview: overlayText?.substring(0, 50),
            ttsEnabled: ttsEnabled,
            ttsVoice: ttsVoice,
            drawText: drawText,
            pageCount: pageIds.length,
        });

        // Traiter la vidéo via FFmpeg
        const ffmpegResult = await ffmpegService.processReelFromUrl(media.originalUrl, {
            text: overlayText,
            musicUrl: finalMusicUrl,
            ttsEnabled,
            ttsVoice,
            wordDuration,
            fontSize,
            musicVolume,
            drawText,
        });

        if (!ffmpegResult.success || !ffmpegResult.videoBase64) {
            return res.status(500).json({
                error: ffmpegResult.error || 'Erreur de traitement vidéo',
            });
        }

        // Upload la vidéo traitée sur Cloudinary
        const videoBuffer = Buffer.from(ffmpegResult.videoBase64, 'base64');
        const cloudinaryResult = await cloudinaryService.uploadMedia(
            videoBuffer,
            `reel-${Date.now()}.mp4`,
            user.id,
            'video/mp4'
        );

        console.log('✅ Reel uploaded to Cloudinary:', cloudinaryResult.originalUrl);

        // Créer le post en base
        const post = await storage.createPost({
            userId: user.id,
            content: description || overlayText || '',
            aiGenerated: 'false',
            status: scheduledFor ? 'scheduled' : 'draft',
            scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
        });

        // Publier sur chaque page sélectionnée
        const results: { pageId: string; success: boolean; reelId?: string; error?: string }[] = [];

        for (const pageId of pageIds) {
            try {
                const page = await storage.getSocialPage(pageId);
                if (!page) {
                    results.push({ pageId, success: false, error: 'Page non trouvée' });
                    continue;
                }

                if (page.platform !== 'facebook') {
                    results.push({ pageId, success: false, error: 'Seules les pages Facebook sont supportées pour les Reels' });
                    continue;
                }

                // Créer l'entrée scheduled_post
                const scheduledPost = await storage.createScheduledPost({
                    postId: post.id,
                    pageId: page.id,
                    postType: 'reel',
                    scheduledAt: scheduledFor ? new Date(scheduledFor) : new Date(),
                });

                // Si pas de planification, publier immédiatement
                if (!scheduledFor) {
                    const finalDescription = description || overlayText || '';
                    const reelId = await facebookService.publishReel(
                        page,
                        cloudinaryResult.originalUrl,
                        finalDescription
                    );

                    // Mettre à jour le scheduled_post avec l'ID externe
                    await storage.updateScheduledPost(scheduledPost.id, {
                        publishedAt: new Date(),
                        externalPostId: reelId,
                    });

                    results.push({ pageId, success: true, reelId });
                } else {
                    results.push({ pageId, success: true, reelId: 'scheduled' });
                }
            } catch (pageError) {
                console.error(`❌ Error publishing Reel to page ${pageId}:`, pageError);
                results.push({
                    pageId,
                    success: false,
                    error: pageError instanceof Error ? pageError.message : 'Erreur inconnue',
                });
            }
        }

        // Mettre à jour le statut du post
        const allSuccess = results.every(r => r.success);
        await storage.updatePost(post.id, {
            status: scheduledFor ? 'scheduled' : (allSuccess ? 'published' : 'failed'),
        });

        res.json({
            success: allSuccess,
            postId: post.id,
            results,
            videoUrl: cloudinaryResult.originalUrl,
        });
    } catch (error) {
        console.error('❌ Error creating Reel:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Erreur lors de la création du Reel',
        });
    }
});

/**
 * Obtenir la configuration des services Reels
 * GET /api/reels/config
 */
reelsRouter.get('/reels/config', async (req: Request, res: Response) => {
    try {
        const jamendoConfigured = await freeSoundService.testConnection().catch(() => false);
        const ffmpegConfigured = await ffmpegService.healthCheck().catch(() => false);

        res.json({
            jamendo: { configured: jamendoConfigured },
            ffmpeg: { configured: ffmpegConfigured },
        });
    } catch (error) {
        console.error('❌ Error fetching Reels config:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération de la configuration' });
    }
});
