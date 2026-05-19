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
    tts_engine?: string;         // Moteur TTS: "edge" ou "gemini"
    gemini_api_key?: string;     // Clé API Google Gemini pour TTS
    word_duration?: number;     // Durée par mot (default: 0.6s)
    font_size?: number;         // Taille police (default: 24)
    music_volume?: number;      // Volume musique (default: 0.25)
    draw_text?: boolean;        // Dessiner le texte sur la vidéo (default: true)
    stabilize?: boolean;        // Stabilisation vidéo via vidstab (default: false)
    watermark_url?: string;     // URL du logo
    store_name?: string;        // Nom du magasin pour l'outro
    enable_ending_effect?: boolean; // Activer l'effet de fin (logo+fondu)
}

interface FFmpegReelResponse {
    success: boolean;
    output_base64?: string;
    duration?: number;
    detail?: string;
    tts_error?: string;
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
            ttsEngine?: string;
            geminiApiKey?: string;
            wordDuration?: number;
            fontSize?: number;
            musicVolume?: number;
            drawText?: boolean;
            stabilize?: boolean;
            watermarkUrl?: string;
            storeName?: string;
            enableEndingEffect?: boolean;
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
            tts_engine: options.ttsEngine,
            gemini_api_key: options.geminiApiKey,
            word_duration: options.wordDuration ?? 0.6,
            font_size: options.fontSize ?? 64,
            music_volume: options.musicVolume ?? 0.25,
            draw_text: options.drawText ?? true,
            stabilize: options.stabilize ?? false,
            watermark_url: options.watermarkUrl,
            store_name: options.storeName,
            enable_ending_effect: options.enableEndingEffect ?? true,
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
            drawText: options.drawText,
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
            ttsEngine?: string;
            geminiApiKey?: string;
            wordDuration?: number;
            fontSize?: number;
            musicVolume?: number;
            drawText?: boolean;
            stabilize?: boolean;
            watermarkUrl?: string;
            storeName?: string;
            enableEndingEffect?: boolean;
        } = {}
    ): Promise<{ success: boolean; videoBase64?: string; duration?: number; error?: string; ttsError?: string }> {
        const config = this.ensureConfigured();

        const requestBody: FFmpegReelRequest = {
            video_url: videoUrl,
            text: options.text,
            music_id: options.musicId,
            music_url: options.musicUrl,
            tts_enabled: options.ttsEnabled,
            tts_voice: options.ttsVoice,
            tts_engine: options.ttsEngine,
            gemini_api_key: options.geminiApiKey,
            word_duration: options.wordDuration ?? 0.6,
            font_size: options.fontSize ?? 64,
            music_volume: options.musicVolume ?? 0.25,
            draw_text: options.drawText ?? true,
            stabilize: options.stabilize ?? false,
            watermark_url: options.watermarkUrl,
            store_name: options.storeName,
            enable_ending_effect: options.enableEndingEffect ?? true,
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
            textLength: options.text?.length || 0,
            hasMusicId: !!options.musicId,
            hasMusicUrl: !!options.musicUrl,
            ttsEnabled: options.ttsEnabled,
            drawText: options.drawText,
        });

        const debugBody = { ...requestBody };
        console.log('📤 Sending to FFmpeg API:', JSON.stringify({ ...debugBody, text: debugBody.text ? `[${debugBody.text.length} chars]` : undefined }));

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

            if (data.tts_error) {
                console.error('❌ TTS failed in Python service:', data.tts_error);
            }
            console.log('✅ Reel video processed successfully from URL');
            return {
                success: true,
                videoBase64: data.output_base64,
                duration: data.duration,
                ttsError: data.tts_error,
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
    async previewTTS(
        text: string,
        ttsVoice?: string,
        ttsEngine?: string,
        geminiApiKey?: string
    ): Promise<{ success: boolean; audioBase64?: string; error?: string }> {
        const config = this.ensureConfigured();

        try {
            const response = await fetch(`${config.apiUrl}/preview-tts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': config.apiKey,
                },
                body: JSON.stringify({
                    text,
                    tts_enabled: true,
                    tts_voice: ttsVoice,
                    tts_engine: ttsEngine,
                    gemini_api_key: geminiApiKey,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                return { success: false, error: `FFmpeg API error: ${response.status} - ${errorText}` };
            }

            const data = await response.json();

            if (!data.success) {
                return { success: false, error: data.detail };
            }

            return { success: true, audioBase64: data.audio_base64 };

        } catch (error) {
            console.error('❌ TTS Preview error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
}

export const ffmpegService = new FFmpegService();
