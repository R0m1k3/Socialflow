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
import { db } from '../db';
import { cloudinaryConfig } from '@shared/schema';
import { eq } from 'drizzle-orm';

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
            fontSize = 64,
            musicVolume = 0.25,
            drawText = true,
            stabilize = false,
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
            if (musicTrackId.startsWith('internal_')) {
                const internalId = musicTrackId.replace('internal_', '');
                const track = await storage.getAudioTrack(internalId);
                if (track) {
                    finalMusicUrl = track.url;
                }
            } else {
                const track = await freeSoundService.getMusicDetails(musicTrackId);
                if (track) {
                    finalMusicUrl = track.downloadUrl;
                }
            }
        }

        let watermarkUrl: string | undefined = undefined;
        if (req.user) {
            const [userCloudinary] = await db.select().from(cloudinaryConfig).where(eq(cloudinaryConfig.userId, req.user.id));
            if (userCloudinary && userCloudinary.logoPublicId) {
                watermarkUrl = `https://res.cloudinary.com/${userCloudinary.cloudName}/image/upload/${userCloudinary.logoPublicId}`;
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
            stabilize,
            watermarkUrl,
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
 * Prévisualiser la voix TTS
 * POST /api/reels/tts-preview
 */
reelsRouter.post('/reels/tts-preview', async (req: Request, res: Response) => {
    try {
        const { text, voice } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'Texte requis' });
        }

        const result = await ffmpegService.previewTTS(text, voice);

        if (!result.success) {
            return res.status(500).json({ error: result.error || 'Erreur de génération TTS' });
        }

        res.json({ success: true, audioBase64: result.audioBase64 });
    } catch (error) {
        console.error('❌ Error generating TTS preview:', error);
        res.status(500).json({ error: 'Erreur lors de la génération de la voix' });
    }
});

/**
 * Traitement d'arrière-plan pour les Reels
 * Gère le pipeline FFmpeg -> Cloudinary -> Facebook de manière asynchrone
 */

/**
 * Vérifie la file d'attente et lance le prochain job si disponible
 */
async function checkQueueAndProcessNext() {
    try {
        const nextPost = await storage.getNextPendingReel();
        if (nextPost) {
            console.log(`📥 [Queue] Found pending job: ${nextPost.id}. Starting processing...`);

            // Marquer comme processing immédiatement
            await storage.updatePostGenerationStatus(nextPost.id, 'processing', 0);

            // Reconstruire le payload depuis les données stockées (si stockées) ou les defaults
            // Note: En mode "pending", on a perdu le body de la requête initiale car on ne stocke pas tout dans Post.
            // Pour une solution robuste, il faudrait stocker les paramètres de génération dans une table 'reel_jobs'.
            // ICI: HACK PROVISOIRE -> On suppose que les données sont stockées dans 'content' ou 'productInfo' mais ce n'est pas le cas.
            // SOLUTION: On ne peut pas relancer processReelBackground sans les arguments (ttsVoice, music, etc).
            //
            // FIX: Pour le MVP, comme on n'a pas de table 'jobs', on va devoir stocker les paramètres requis dans 'productInfo' (jsonb) du Post
            // lors de la création en mode 'pending'.

            // Récupérer les paramètres stockés
            const jobData = nextPost.productInfo as any;

            if (!jobData || !jobData.videoMediaId) {
                console.error(`❌ [Queue] Job ${nextPost.id} has no stored job data in productInfo.`);
                await storage.updatePostGenerationStatus(nextPost.id, 'failed', 0, "Données de job manquantes");
                return;
            }

            // Lancer le traitement
            processReelBackground(nextPost.userId, nextPost.id, jobData)
                .catch(err => console.error('🔥 [Queue] Unhandled error starting queued job:', err));
        } else {
            console.log('🏁 [Queue] No more pending jobs.');
        }
    } catch (error) {
        console.error('❌ [Queue] Error checking queue:', error);
    }
}

/**
 * Traitement d'arrière-plan pour les Reels
 * Gère le pipeline FFmpeg -> Cloudinary -> Facebook de manière asynchrone
 */
async function processReelBackground(
    userId: string,
    postId: string,
    data: {
        videoMediaId: string;
        musicTrackId?: string;
        musicUrl?: string;
        overlayText?: string;
        description?: string;
        ttsEnabled?: boolean;
        ttsVoice?: string;
        pageIds: string[];
        scheduledFor?: string;
        wordDuration?: number;
        fontSize?: number;
        musicVolume?: number;
        drawText?: boolean;
        stabilize?: boolean;
    }
) {
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
        wordDuration,
        fontSize,
        musicVolume,
        drawText,
        stabilize,
    } = data;

    console.log(`🔄 [Background] Starting processing for Post ${postId}`);

    // Helper to update generation progress
    const updateProgress = async (progress: number, status: string = 'processing') => {
        try {
            await storage.updatePostGenerationStatus(postId, status, progress);
        } catch (e) {
            console.error(`⚠️ [Background] Failed to update progress for ${postId}:`, e);
        }
    };

    try {
        await updateProgress(5);
        // 1. Récupérer le média vidéo source
        const media = await storage.getMediaById(videoMediaId);
        if (!media || media.type !== 'video') {
            throw new Error('Vidéo source introuvable ou invalide');
        }

        // 2. Récupérer l'URL de la musique
        let finalMusicUrl = musicUrl;
        if (musicTrackId && !musicUrl) {
            if (musicTrackId.startsWith('internal_')) {
                try {
                    const internalId = musicTrackId.replace('internal_', '');
                    const track = await storage.getAudioTrack(internalId);
                    if (track) {
                        finalMusicUrl = track.url;
                    }
                } catch (e) { console.error('Error fetching internal track', e); }
            } else {
                try {
                    const track = await freeSoundService.getMusicDetails(musicTrackId);
                    if (track) {
                        finalMusicUrl = track.downloadUrl;
                    }
                } catch (e) {
                    console.error(`⚠️ [Background] Failed to fetch music details for ${musicTrackId}`, e);
                }
            }
        }

        console.log('🎬 [Background] FFmpeg Processing:', {
            postId,
            videoUrl: media.originalUrl,
            hasMusic: !!finalMusicUrl, // Log boolean to avoid long URL
            hasText: !!overlayText
        });

        // 3. Traiter la vidéo via FFmpeg
        await updateProgress(15);
        const startTime = Date.now();

        let watermarkUrl: string | undefined = undefined;
        try {
            const [userCloudinary] = await db.select().from(cloudinaryConfig).where(eq(cloudinaryConfig.userId, media.userId));
            if (userCloudinary && userCloudinary.logoPublicId) {
                watermarkUrl = `https://res.cloudinary.com/${userCloudinary.cloudName}/image/upload/${userCloudinary.logoPublicId}`;
            }
        } catch (e) {
            console.error('Error fetching watermark configuration', e);
        }

        const ffmpegResult = await ffmpegService.processReelFromUrl(media.originalUrl, {
            text: overlayText,
            musicUrl: finalMusicUrl,
            ttsEnabled,
            ttsVoice,
            wordDuration,
            fontSize,
            musicVolume,
            drawText,
            stabilize,
            watermarkUrl,
        });

        console.log(`⏱️ [Background] FFmpeg took ${(Date.now() - startTime) / 1000}s`);

        if (!ffmpegResult.success || !ffmpegResult.videoBase64) {
            throw new Error(ffmpegResult.error || 'Erreur de traitement vidéo FFmpeg');
        }

        // 4. Upload sur Cloudinary
        await updateProgress(65);
        console.log('☁️ [Background] Uploading to Cloudinary...');
        const videoBuffer = Buffer.from(ffmpegResult.videoBase64, 'base64');
        const cloudinaryResult = await cloudinaryService.uploadMedia(
            videoBuffer,
            `reel-${Date.now()}.mp4`,
            userId,
            'video/mp4'
        );
        console.log('✅ [Background] Uploaded:', cloudinaryResult.originalUrl);

        // 5. Créer l'enregistrement Media pour la vidéo traitée
        const processedMedia = await storage.createMedia({
            userId: userId,
            type: 'video',
            cloudinaryPublicId: cloudinaryResult.publicId,
            originalUrl: cloudinaryResult.originalUrl,
            facebookFeedUrl: cloudinaryResult.facebookFeedUrl || null,
            instagramFeedUrl: cloudinaryResult.instagramFeedUrl || null,
            instagramStoryUrl: cloudinaryResult.instagramStoryUrl || null,
            fileName: `reel-processed-${Date.now()}.mp4`,
            fileSize: videoBuffer.length,
        });

        // 6. Lier le média traité au Post existant
        await storage.updatePostMedia(postId, [processedMedia.id]);
        await updateProgress(85);

        // 7. Publier sur les pages
        await updateProgress(90);
        const results: { pageId: string; success: boolean; reelId?: string; error?: string }[] = [];

        for (const pageId of pageIds) {
            try {
                const page = await storage.getSocialPage(pageId);
                if (!page) {
                    results.push({ pageId, success: false, error: 'Page non trouvée' });
                    continue;
                }

                if (page.platform !== 'facebook') {
                    results.push({ pageId, success: false, error: 'Seules les pages Facebook sont supportées' });
                    continue;
                }

                // Créer l'entrée scheduled_post (log de publication)
                const scheduledPost = await storage.createScheduledPost({
                    postId: postId,
                    pageId: page.id,
                    postType: 'reel',
                    scheduledAt: scheduledFor ? new Date(scheduledFor) : new Date(),
                });

                if (!scheduledFor) {
                    // Publication immédiate
                    console.log(`🚀 [Background] Publishing to Page ${page.pageName}...`);
                    const finalDescription = description || overlayText || '';

                    const reelId = await facebookService.publishReel(
                        page,
                        cloudinaryResult.originalUrl,
                        finalDescription
                    );

                    // Mise à jour succès
                    await storage.updateScheduledPost(scheduledPost.id, {
                        publishedAt: new Date(),
                        externalPostId: reelId,
                    });

                    results.push({ pageId, success: true, reelId });
                } else {
                    // Planifié
                    results.push({ pageId, success: true, reelId: 'scheduled' });
                }

            } catch (pageError: any) {
                console.error(`❌ [Background] Error publishing to page ${pageId}:`, pageError);
                results.push({
                    pageId,
                    success: false,
                    error: pageError.message || 'Erreur inconnue',
                });
            }
        }

        // 8. Mettre à jour le statut global du Post
        const allSuccess = results.every(r => r.success);
        const anySuccess = results.some(r => r.success);

        // Si au moins une réussite, on considère "published" (ou partial), sinon "failed"
        // Si planifié, reste "scheduled".
        let finalStatus = 'failed';
        if (scheduledFor) {
            finalStatus = 'scheduled';
        } else if (allSuccess) {
            finalStatus = 'published';
        } else if (anySuccess) {
            finalStatus = 'published'; // Partiellement publié
        }

        await storage.updatePost(postId, {
            status: finalStatus,
        });
        await updateProgress(100, 'completed');

        console.log(`✅ [Background] Processing complete for Post ${postId}. Status: ${finalStatus}`);

    } catch (error: any) {
        console.error(`❌ [Background] Critical error for Post ${postId}:`, error);
        await storage.updatePost(postId, {
            status: 'failed',
        });
        try {
            await storage.updatePostGenerationStatus(
                postId, 'failed', 0,
                error?.message || 'Erreur inconnue lors du traitement'
            );
        } catch (e) {
            console.error(`⚠️ [Background] Failed to update error status for ${postId}:`, e);
        }
    } finally {
        // IMPORTANT: Toujours vérifier la file d'attente à la fin (succès ou échec)
        await checkQueueAndProcessNext();
    }
}

/**
 * Créer et publier un Reel (Asynchrone avec File d'Attente)
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
            fontSize = 64,
            musicVolume = 0.25,
            drawText = true,
            stabilize = false,
        } = req.body;

        // Validation immédiate
        if (!videoMediaId) {
            return res.status(400).json({ error: 'Vidéo requise' });
        }

        if (!pageIds || pageIds.length === 0) {
            return res.status(400).json({ error: 'Au moins une page requise' });
        }

        // Vérifier le nombre de jobs en cours
        const processingCount = await storage.countProcessingReels();
        // MAX_CONCURRENT = 1
        const isQueueBusy = processingCount >= 1;

        const initialStatus = isQueueBusy ? 'pending' : 'processing';
        const initialMessage = isQueueBusy
            ? "File d'attente pleine. Votre vidéo sera traitée dès que possible."
            : "Traitement démarré en arrière-plan.";

        // Créer immédiatement le Post en base
        // ON STOCKE LES PARAMS DU JOB DANS productInfo POUR POUVOIR LE REPRENDRE PLUS TARD
        // C'est un hack car on n'a pas de table params_job, mais ça marche car productInfo est jsonb
        const post = await storage.createPost({
            userId: user.id,
            content: description || overlayText || '',
            aiGenerated: 'false',
            status: scheduledFor ? 'scheduled' : 'draft',
            scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
            generationStatus: initialStatus,
            generationProgress: 0,
            productInfo: req.body, // Stockage complet des paramètres
        });

        console.log(`✨ Reel Request accepted. Post ID: ${post.id}. Status: ${initialStatus}`);

        if (!isQueueBusy) {
            // Démarrer le traitement en arrière-plan (Fire & Forget)
            processReelBackground(user.id, post.id, req.body).catch(err => {
                console.error('🔥 Unhandled background error:', err);
            });
        } else {
            console.log(`⏳ [Queue] Worker busy (count=${processingCount}). Job ${post.id} is queued.`);
        }

        // Réponse immédiate au client
        res.json({
            success: true,
            postId: post.id,
            message: initialMessage,
            queued: isQueueBusy,
            results: [],
            videoUrl: ""
        });

    } catch (error) {
        console.error('❌ Error initiating Reel:', error);
        res.status(500).json({
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
        const freesoundConfigured = await freeSoundService.testConnection().catch(() => false);
        const ffmpegConfigured = await ffmpegService.healthCheck().catch(() => false);

        res.json({
            jamendo: { configured: freesoundConfigured }, // Keep legacy key for frontend compatibility
            freesound: { configured: freesoundConfigured },
            ffmpeg: { configured: ffmpegConfigured },
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
        const allPosts = await storage.getPosts(user.id);
        const ongoing = allPosts.filter(
            (p) => p.generationStatus === 'processing' || p.generationStatus === 'pending'
        );
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
