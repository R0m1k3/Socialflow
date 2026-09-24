/**
 * Client du service FFmpeg (conteneur Python `ffmpeg-service`).
 *
 * Le service rend le Reel puis expose le MP4 en téléchargement
 * (GET /files/{job}/output.mp4) : la vidéo ne transite plus en base64 dans du
 * JSON, qui gonflait sa taille d'un tiers et la gardait entière en mémoire.
 */

import type { TtsEngine, TtsStyle } from '@shared/voices';

/** Un rendu long (stabilisation + encodage) peut dépasser plusieurs minutes. */
const PROCESS_TIMEOUT_MS = 20 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const TTS_TIMEOUT_MS = 3 * 60_000;
const HEALTH_TIMEOUT_MS = 5_000;

export interface ReelRenderOptions {
    text?: string;
    musicUrl?: string;
    ttsEnabled?: boolean;
    ttsVoice?: string;
    ttsEngine?: TtsEngine;
    ttsStyle?: TtsStyle;
    geminiApiKey?: string;
    fontSize?: number;
    musicVolume?: number;
    drawText?: boolean;
    stabilize?: boolean;
    watermarkUrl?: string;
    storeName?: string;
    enableEndingEffect?: boolean;
}

export interface ReelRenderResult {
    video: Buffer;
    duration: number;
    ttsEngine?: string | null;
    ttsVoice?: string | null;
    warnings: string[];
}

export interface TimedWord {
    text: string;
    start: number;
    end: number;
}

export interface VoicePreview {
    audio: Buffer;
    duration: number;
    words: TimedWord[];
    engine: string;
    voice: string;
    warnings: string[];
}

interface FFmpegConfig {
    apiUrl: string;
    apiKey: string;
}

/** Erreur renvoyée par le service, avec son message lisible. */
export class FFmpegServiceError extends Error {
    constructor(message: string, readonly status?: number) {
        super(message);
        this.name = 'FFmpegServiceError';
    }
}

export class FFmpegService {
    private config: FFmpegConfig | null = null;

    configure(apiUrl: string, apiKey: string): void {
        this.config = { apiUrl: apiUrl.replace(/\/$/, ''), apiKey };
        console.log('🎬 FFmpeg Service configured:', this.config.apiUrl);
    }

    private ensureConfigured(): FFmpegConfig {
        if (!this.config) {
            throw new FFmpegServiceError("Le service FFmpeg n'est pas configuré (FFMPEG_API_URL / FFMPEG_API_KEY).");
        }
        return this.config;
    }

    private async call(path: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
        const config = this.ensureConfigured();
        const { timeoutMs, headers, ...rest } = init;
        const response = await fetch(`${config.apiUrl}${path}`, {
            ...rest,
            headers: { 'X-API-Key': config.apiKey, ...headers },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
            const body = await response.text();
            let detail = body;
            try {
                detail = JSON.parse(body).detail ?? body;
            } catch { /* corps non JSON */ }
            throw new FFmpegServiceError(String(detail).slice(0, 2000), response.status);
        }
        return response;
    }

    /**
     * Rend un Reel à partir de l'URL d'une vidéo et renvoie le MP4 produit.
     * Lève FFmpegServiceError en cas d'échec (voix comprise).
     */
    async renderReel(videoUrl: string, options: ReelRenderOptions = {}): Promise<ReelRenderResult> {
        const body = {
            video_url: videoUrl,
            text: options.text,
            music_url: options.musicUrl,
            tts_enabled: options.ttsEnabled ?? false,
            tts_voice: options.ttsVoice,
            tts_engine: options.ttsEngine,
            tts_style: options.ttsStyle,
            gemini_api_key: options.geminiApiKey,
            font_size: options.fontSize ?? 64,
            music_volume: options.musicVolume ?? 0.25,
            draw_text: options.drawText ?? true,
            stabilize: options.stabilize ?? false,
            watermark_url: options.watermarkUrl,
            store_name: options.storeName,
            enable_ending_effect: options.enableEndingEffect ?? true,
        };

        console.log('🎬 Rendu du Reel :', {
            videoUrl,
            textLength: options.text?.length ?? 0,
            music: !!options.musicUrl,
            tts: options.ttsEnabled ? `${options.ttsEngine}/${options.ttsVoice}/${options.ttsStyle ?? 'neutral'}` : false,
        });

        const response = await this.call('/process-reel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            timeoutMs: PROCESS_TIMEOUT_MS,
        });
        const data = await response.json() as {
            job_id: string;
            output_path: string;
            duration: number;
            tts_engine?: string | null;
            tts_voice?: string | null;
            warnings?: string[];
        };

        try {
            const file = await this.call(data.output_path, { method: 'GET', timeoutMs: DOWNLOAD_TIMEOUT_MS });
            const video = Buffer.from(await file.arrayBuffer());
            for (const warning of data.warnings ?? []) console.warn(`⚠️ [FFmpeg] ${warning}`);
            return {
                video,
                duration: data.duration,
                ttsEngine: data.tts_engine,
                ttsVoice: data.tts_voice,
                warnings: data.warnings ?? [],
            };
        } finally {
            // Le fichier n'est plus utile au service une fois récupéré
            this.call(`/jobs/${data.job_id}`, { method: 'DELETE', timeoutMs: HEALTH_TIMEOUT_MS })
                .catch(() => { /* purgé plus tard par le service */ });
        }
    }

    async healthCheck(): Promise<boolean> {
        try {
            await this.call('/health', { method: 'GET', timeoutMs: HEALTH_TIMEOUT_MS });
            return true;
        } catch {
            return false;
        }
    }

    /** Génère la voix seule (aperçu), avec le minutage de chaque mot. */
    async previewVoice(
        text: string,
        options: { voice?: string; engine?: TtsEngine; style?: TtsStyle; geminiApiKey?: string } = {},
    ): Promise<VoicePreview> {
        const response = await this.call('/preview-tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text,
                tts_voice: options.voice,
                tts_engine: options.engine,
                tts_style: options.style,
                gemini_api_key: options.geminiApiKey,
            }),
            timeoutMs: TTS_TIMEOUT_MS,
        });
        const data = await response.json() as {
            audio_base64: string;
            duration: number;
            words: TimedWord[];
            engine: string;
            voice: string;
            warnings?: string[];
        };
        return {
            audio: Buffer.from(data.audio_base64, 'base64'),
            duration: data.duration,
            words: data.words ?? [],
            engine: data.engine,
            voice: data.voice,
            warnings: data.warnings ?? [],
        };
    }
}

export const ffmpegService = new FFmpegService();
