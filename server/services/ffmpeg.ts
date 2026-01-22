/**
 * FFmpeg Docker API Service
 * 
 * Intégration avec l'API FFmpeg Docker locale pour le traitement vidéo des Reels.
 * L'API attend une vidéo en base64 et retourne la vidéo traitée en base64.
 */

interface FFmpegReelRequest {
    video_base64?: string;      // Vidéo source en base64
    video_url?: string;         // OU URL de la vidéo source
    text?: string;              // Texte overlay style TikTok
    music_id?: string;          // ID de la musique (catalogue FFmpeg)
    music_url?: string;         // OU URL directe de la musique
    tts_enabled?: boolean;      // Activation du TTS
    tts_voice?: string;         // Voix TTS (ex: fr-FR-VivienneNeural)
    word_duration?: number;     // Durée par mot (default: 0.6s)
    font_size?: number;         // Taille police (default: 60)
    music_volume?: number;      // Volume musique (default: 0.25)
}

interface FFmpegReelResponse {
    success: boolean;
    output_base64?: string;     // Vidéo traitée en base64
    duration?: number;          // Durée de la vidéo en secondes
    detail?: string;            // Message d'erreur si échec
}

interface FFmpegConfig {
    apiUrl: string;
    apiKey: string;
}

export class FFmpegService {
    private config: FFmpegConfig | null = null;

    /**
     * Configure le service avec l'URL et la clé API
     */
    configure(apiUrl: string, apiKey: string): void {
        this.config = { apiUrl, apiKey };
        console.log('🎬 FFmpeg Service configured:', apiUrl);
    }

    /**
     * Vérifie que le service est configuré
     */
    private ensureConfigured(): FFmpegConfig {
        if (!this.config) {
            throw new Error('FFmpeg Service not configured. Call configure() first.');
        }
        return this.config;
    }

    /**
     * Traite une vidéo pour créer un Reel avec musique et texte overlay
     * 
     * @param videoBase64 - Vidéo source encodée en base64
     * @param options - Options de traitement (texte, musique, etc.)
     * @returns Vidéo traitée en base64
     */
    async processReelVideo(
        videoBase64: string,
        options: {
            text?: string;
            musicId?: string;
            musicUrl?: string;
            ttsEnabled?: boolean;
            ttsVoice?: string;
            wordDuration?: number;
            fontSize?: number;
            musicVolume?: number;
        } = {}
    ): Promise<{ success: boolean; videoBase64?: string; duration?: number; error?: string }> {
        const config = this.ensureConfigured();

        const requestBody: FFmpegReelRequest = {
            video_base64: videoBase64,
            text: options.text,
            music_id: options.musicId,
            music_url: options.musicUrl,
            tts_enabled: options.ttsEnabled,
            tts_voice: options.ttsVoice,
            word_duration: options.wordDuration ?? 0.6,
            font_size: options.fontSize ?? 60,
            music_volume: options.musicVolume ?? 0.25,
        };

        // Remove undefined values
        Object.keys(requestBody).forEach(key => {
            if (requestBody[key as keyof FFmpegReelRequest] === undefined) {
                delete requestBody[key as keyof FFmpegReelRequest];
            }
        });

        console.log('🎬 Processing Reel video:', {
            hasVideo: !!videoBase64,
            hasText: !!options.text,
            hasMusicId: !!options.musicId,
            hasMusicUrl: !!options.musicUrl,
            hasTTS: options.ttsEnabled,
        });

        try {
            const response = await fetch(`${config.apiUrl}/process-reel`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': config.apiKey,
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ FFmpeg API error:', response.status, errorText);
                return {
                    success: false,
                    error: `FFmpeg API error: ${response.status} - ${errorText}`,
                };
            }

            const data = await response.json() as FFmpegReelResponse;

            if (!data.success) {
                console.error('❌ FFmpeg processing failed:', data.detail);
                return {
                    success: false,
                    error: data.detail || 'Unknown FFmpeg processing error',
                };
            }

            console.log('✅ Reel video processed successfully, duration:', data.duration);
            return {
                success: true,
                videoBase64: data.output_base64,
                duration: data.duration,
            };

        } catch (error) {
            console.error('❌ FFmpeg Service error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Traite une vidéo depuis une URL (télécharge, traite, retourne base64)
     */
    async processReelFromUrl(
        videoUrl: string,
        options: {
            text?: string;
            musicId?: string;
            musicUrl?: string;
            ttsEnabled?: boolean;
            ttsVoice?: string;
            wordDuration?: number;
            fontSize?: number;
            musicVolume?: number;
        } = {}
    ): Promise<{ success: boolean; videoBase64?: string; duration?: number; error?: string }> {
        const config = this.ensureConfigured();

        const requestBody: FFmpegReelRequest = {
            video_url: videoUrl,
            text: options.text,
            music_id: options.musicId,
            music_url: options.musicUrl,
            tts_enabled: options.ttsEnabled,
            tts_voice: options.ttsVoice,
            word_duration: options.wordDuration ?? 0.6,
            font_size: options.fontSize ?? 60,
            music_volume: options.musicVolume ?? 0.25,
        };

        // Remove undefined values
        Object.keys(requestBody).forEach(key => {
            if (requestBody[key as keyof FFmpegReelRequest] === undefined) {
                delete requestBody[key as keyof FFmpegReelRequest];
            }
        });

        console.log('🎬 Processing Reel from URL:', {
            videoUrl,
            hasText: !!options.text,
            hasMusicId: !!options.musicId,
            hasMusicUrl: !!options.musicUrl,
            hasTTS: options.ttsEnabled,
        });

        try {
            const response = await fetch(`${config.apiUrl}/process-reel`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': config.apiKey,
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ FFmpeg API error:', response.status, errorText);
                return {
                    success: false,
                    error: `FFmpeg API error: ${response.status} - ${errorText}`,
                };
            }

            const data = await response.json() as FFmpegReelResponse;

            if (!data.success) {
                console.error('❌ FFmpeg processing failed:', data.detail);
                return {
                    success: false,
                    error: data.detail || 'Unknown FFmpeg processing error',
                };
            }

            console.log('✅ Reel video processed successfully from URL');
            return {
                success: true,
                videoBase64: data.output_base64,
                duration: data.duration,
            };

        } catch (error) {
            console.error('❌ FFmpeg Service error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Vérifie la santé de l'API FFmpeg
     */
    async healthCheck(): Promise<boolean> {
        try {
            const config = this.ensureConfigured();
            const response = await fetch(`${config.apiUrl}/health`, {
                method: 'GET',
                headers: {
                    'X-API-Key': config.apiKey,
                },
            });
            return response.ok;
        } catch {
            return false;
        }
    }
}

export const ffmpegService = new FFmpegService();
