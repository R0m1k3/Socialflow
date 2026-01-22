/**
 * FreeSound Music API Service
 * 
 * Intégration avec l'API FreeSound pour rechercher et récupérer des sons
 * libres de droits pour les Reels.
 * 
 * Documentation: https://freesound.org/docs/api/
 */

interface FreeSoundResult {
    id: number;
    name: string;
    duration: number;
    username: string;
    tags: string[];
    license: string;
    previews: {
        'preview-hq-mp3': string;
        'preview-lq-mp3': string;
        'preview-hq-ogg': string;
        'preview-lq-ogg': string;
    };
    images: {
        waveform_m: string;
        waveform_l: string;
        spectral_m: string;
        spectral_l: string;
    };
    download?: string;
}

interface FreeSoundSearchResponse {
    count: number;
    next: string | null;
    previous: string | null;
    results: FreeSoundResult[];
}

export interface MusicTrack {
    id: string;
    title: string;
    artist: string;
    albumName: string;
    duration: number;           // en secondes
    previewUrl: string;         // URL audio streaming
    downloadUrl: string;        // URL téléchargement
    imageUrl: string;           // Waveform image
    license: string;
}

interface MusicSearchParams {
    minDuration?: number;       // Durée min en secondes
    maxDuration?: number;       // Durée max en secondes
    genre?: string;             // Genre musical / tag
    limit?: number;             // Nombre de résultats (default: 10)
    offset?: number;            // Offset pour pagination
    search?: string;            // Recherche texte libre
}

interface FreeSoundConfig {
    clientId: string;
    clientSecret: string;
}

const FREESOUND_API_BASE = 'https://freesound.org/apiv2';

export class FreeSoundService {
    private config: FreeSoundConfig | null = null;

    /**
     * Configure le service avec les credentials FreeSound
     */
    configure(clientId: string, clientSecret: string): void {
        this.config = { clientId, clientSecret };
        console.log('🎵 FreeSound Service configured');
    }

    /**
     * Vérifie que le service est configuré
     */
    private ensureConfigured(): FreeSoundConfig {
        if (!this.config) {
            throw new Error('FreeSound Service not configured. Call configure() first.');
        }
        return this.config;
    }

    /**
     * Convertit un résultat FreeSound en format MusicTrack unifié
     */
    private mapResult(result: FreeSoundResult): MusicTrack {
        return {
            id: result.id.toString(),
            title: result.name,
            artist: result.username,
            albumName: 'FreeSound',
            duration: Math.round(result.duration),
            previewUrl: result.previews['preview-hq-mp3'] || result.previews['preview-lq-mp3'],
            downloadUrl: result.previews['preview-hq-mp3'], // On utilise le preview HQ
            imageUrl: result.images?.waveform_m || '',
            license: result.license,
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

        // Construction du filtre de durée
        const durationFilter = `duration:[${minDuration} TO ${maxDuration}]`;

        // Recherche de musiques/sons musicaux
        let query = search || 'music';
        if (genre) {
            query = `${query} ${genre}`;
        }

        const queryParams = new URLSearchParams({
            token: config.clientSecret, // FreeSound utilise le token dans l'URL pour les requêtes simples
            query: query,
            filter: durationFilter,
            page_size: limit.toString(),
            page: Math.floor(offset / limit + 1).toString(),
            fields: 'id,name,duration,username,tags,license,previews,images',
            sort: 'rating_desc',
        });

        const url = `${FREESOUND_API_BASE}/search/text/?${queryParams.toString()}`;

        console.log('🎵 Searching FreeSound:', {
            query,
            duration: `${minDuration}-${maxDuration}s`,
            limit,
            offset,
        });

        try {
            const response = await fetch(url);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('FreeSound API error:', response.status, errorText);
                throw new Error(`FreeSound API error: ${response.status}`);
            }

            const data = await response.json() as FreeSoundSearchResponse;

            const tracks = data.results.map(result => this.mapResult(result));

            console.log(`✅ Found ${tracks.length} tracks on FreeSound`);
            return tracks;

        } catch (error) {
            console.error('❌ FreeSound search error:', error);
            throw error;
        }
    }

    /**
     * Récupère les détails d'un son par son ID
     */
    async getMusicDetails(trackId: string): Promise<MusicTrack | null> {
        const config = this.ensureConfigured();

        const url = `${FREESOUND_API_BASE}/sounds/${trackId}/?token=${config.clientSecret}&fields=id,name,duration,username,tags,license,previews,images`;

        try {
            const response = await fetch(url);

            if (!response.ok) {
                console.error('FreeSound API error:', response.status);
                return null;
            }

            const result = await response.json() as FreeSoundResult;
            return this.mapResult(result);

        } catch (error) {
            console.error('❌ FreeSound getMusicDetails error:', error);
            return null;
        }
    }

    /**
     * Récupère des sons populaires (utilisé comme fallback ou découverte)
     */
    async getPopularTracks(limit: number = 10): Promise<MusicTrack[]> {
        const config = this.ensureConfigured();

        const queryParams = new URLSearchParams({
            token: config.clientSecret,
            query: 'music loop beat',
            filter: 'duration:[15 TO 90]',
            page_size: limit.toString(),
            fields: 'id,name,duration,username,tags,license,previews,images',
            sort: 'downloads_desc',
        });

        const url = `${FREESOUND_API_BASE}/search/text/?${queryParams.toString()}`;

        try {
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`FreeSound API error: ${response.status}`);
            }

            const data = await response.json() as FreeSoundSearchResponse;
            return data.results.map(result => this.mapResult(result));

        } catch (error) {
            console.error('❌ FreeSound getPopularTracks error:', error);
            return [];
        }
    }

    /**
     * Retourne l'URL de téléchargement/preview
     */
    getDownloadUrl(track: MusicTrack): string {
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

export const freeSoundService = new FreeSoundService();
