/**
 * Jamendo Music API Service
 * 
 * Intégration avec l'API Jamendo pour rechercher et récupérer des musiques
 * libres de droits pour les Reels.
 * 
 * Documentation: https://developer.jamendo.com/v3.0
 */

interface JamendoTrack {
    id: string;
    name: string;
    duration: number;           // en secondes
    artist_id: string;
    artist_name: string;
    album_name: string;
    album_id: string;
    license_ccurl: string;
    position: number;
    releasedate: string;
    album_image: string;
    audio: string;              // URL du fichier audio complet
    audiodownload: string;      // URL de téléchargement
    prourl: string;
    shorturl: string;
    shareurl: string;
    waveform: string;
    image: string;
    audiodownload_allowed: boolean;
}

interface JamendoResponse {
    headers: {
        status: string;
        code: number;
        error_message: string;
        warnings: string;
        results_count: number;
    };
    results: JamendoTrack[];
}

export interface MusicTrack {
    id: string;
    title: string;
    artist: string;
    albumName: string;
    duration: number;           // en secondes
    previewUrl: string;         // URL audio streaming
    downloadUrl: string;        // URL téléchargement
    imageUrl: string;           // Pochette album
    license: string;
}

interface MusicSearchParams {
    minDuration?: number;       // Durée min en secondes
    maxDuration?: number;       // Durée max en secondes
    genre?: string;             // Genre musical (ex: "pop", "rock", "electronic")
    mood?: string;              // Ambiance (ex: "happy", "sad", "energetic")
    limit?: number;             // Nombre de résultats (default: 10)
    offset?: number;            // Offset pour pagination
    search?: string;            // Recherche texte libre
}

interface JamendoConfig {
    clientId: string;
}

const JAMENDO_API_BASE = 'https://api.jamendo.com/v3.0';

// Mapping des genres Jamendo
const GENRE_MAPPING: Record<string, string> = {
    'pop': 'pop',
    'rock': 'rock',
    'electronic': 'electronic',
    'hiphop': 'hiphop',
    'jazz': 'jazz',
    'classical': 'classical',
    'ambient': 'ambient',
    'chill': 'chillout',
    'dance': 'dance',
    'indie': 'indie',
};

export class JamendoService {
    private config: JamendoConfig | null = null;

    /**
     * Configure le service avec le Client ID Jamendo
     */
    configure(clientId: string): void {
        this.config = { clientId };
        console.log('🎵 Jamendo Service configured');
    }

    /**
     * Vérifie que le service est configuré
     */
    private ensureConfigured(): JamendoConfig {
        if (!this.config) {
            throw new Error('Jamendo Service not configured. Call configure() first.');
        }
        return this.config;
    }

    /**
     * Convertit un track Jamendo en format MusicTrack unifié
     */
    private mapTrack(track: JamendoTrack): MusicTrack {
        return {
            id: track.id,
            title: track.name,
            artist: track.artist_name,
            albumName: track.album_name,
            duration: track.duration,
            previewUrl: track.audio,
            downloadUrl: track.audiodownload,
            imageUrl: track.album_image || track.image,
            license: track.license_ccurl,
        };
    }

    /**
     * Recherche des musiques par durée
     * 
     * @param params - Paramètres de recherche
     * @returns Liste de tracks correspondants
     */
    async searchMusicByDuration(params: MusicSearchParams = {}): Promise<MusicTrack[]> {
        const config = this.ensureConfigured();

        const {
            minDuration = 10,
            maxDuration = 120,
            genre,
            limit = 10,
            offset = 0,
            search,
        } = params;

        // Construction de l'URL avec les paramètres
        const queryParams = new URLSearchParams({
            client_id: config.clientId,
            format: 'json',
            limit: limit.toString(),
            offset: offset.toString(),
            include: 'musicinfo',
            audioformat: 'mp32',  // MP3 320kbps
            durationbetween: `${minDuration}_${maxDuration}`,
            order: 'popularity_total',
        });

        // Ajouter le genre si spécifié
        if (genre && GENRE_MAPPING[genre.toLowerCase()]) {
            queryParams.append('tags', GENRE_MAPPING[genre.toLowerCase()]);
        } else if (genre) {
            queryParams.append('tags', genre.toLowerCase());
        }

        // Ajouter la recherche texte si spécifiée
        if (search) {
            queryParams.append('namesearch', search);
        }

        const url = `${JAMENDO_API_BASE}/tracks/?${queryParams.toString()}`;

        console.log('🎵 Searching Jamendo:', {
            duration: `${minDuration}-${maxDuration}s`,
            genre,
            limit,
            offset,
        });

        try {
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Jamendo API error: ${response.status}`);
            }

            const data = await response.json() as JamendoResponse;

            if (data.headers.code !== 0) {
                throw new Error(`Jamendo API error: ${data.headers.error_message}`);
            }

            const tracks = data.results.map(track => this.mapTrack(track));

            console.log(`✅ Found ${tracks.length} tracks on Jamendo`);
            return tracks;

        } catch (error) {
            console.error('❌ Jamendo search error:', error);
            throw error;
        }
    }

    /**
     * Récupère les détails d'un track par son ID
     */
    async getMusicDetails(trackId: string): Promise<MusicTrack | null> {
        const config = this.ensureConfigured();

        const queryParams = new URLSearchParams({
            client_id: config.clientId,
            format: 'json',
            id: trackId,
            include: 'musicinfo',
            audioformat: 'mp32',
        });

        const url = `${JAMENDO_API_BASE}/tracks/?${queryParams.toString()}`;

        try {
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Jamendo API error: ${response.status}`);
            }

            const data = await response.json() as JamendoResponse;

            if (data.headers.code !== 0 || data.results.length === 0) {
                return null;
            }

            return this.mapTrack(data.results[0]);

        } catch (error) {
            console.error('❌ Jamendo getMusicDetails error:', error);
            return null;
        }
    }

    /**
     * Récupère des tracks populaires (utilisé comme fallback ou découverte)
     */
    async getPopularTracks(limit: number = 10): Promise<MusicTrack[]> {
        const config = this.ensureConfigured();

        const queryParams = new URLSearchParams({
            client_id: config.clientId,
            format: 'json',
            limit: limit.toString(),
            include: 'musicinfo',
            audioformat: 'mp32',
            order: 'popularity_week',
            durationbetween: '15_90',  // Durée idéale pour Reels
        });

        const url = `${JAMENDO_API_BASE}/tracks/?${queryParams.toString()}`;

        try {
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Jamendo API error: ${response.status}`);
            }

            const data = await response.json() as JamendoResponse;

            if (data.headers.code !== 0) {
                throw new Error(`Jamendo API error: ${data.headers.error_message}`);
            }

            return data.results.map(track => this.mapTrack(track));

        } catch (error) {
            console.error('❌ Jamendo getPopularTracks error:', error);
            return [];
        }
    }

    /**
     * Télécharge l'URL du fichier audio (avec redirection si nécessaire)
     * Note: Jamendo fournit directement les URLs de téléchargement
     */
    getDownloadUrl(track: MusicTrack): string {
        // L'URL de téléchargement Jamendo est directement utilisable
        return track.downloadUrl;
    }

    /**
     * Vérifie la validité de la configuration
     */
    async testConnection(): Promise<boolean> {
        try {
            const tracks = await this.getPopularTracks(1);
            return tracks.length > 0;
        } catch {
            return false;
        }
    }
}

export const jamendoService = new JamendoService();
