/**
 * Service de publication TikTok (Content Posting API v2).
 *
 * Différences structurantes avec Facebook, qui expliquent la forme de ce service :
 *  - Pas de token collable à la main : chaque compte magasin passe par OAuth.
 *    L'access token ne vit que 24h et doit être renouvelé avec le refresh token
 *    (valable 1 an) avant chaque publication.
 *  - La publication est asynchrone : l'upload rend un `publish_id`, et l'identifiant
 *    définitif du post n'est connu qu'en interrogeant /status/fetch/ ensuite.
 *  - `creator_info/query` doit être appelé avant chaque publication pour connaître
 *    les niveaux de confidentialité réellement autorisés sur le compte.
 *
 * Note : tant que l'application n'a pas passé l'audit TikTok, le seul niveau de
 * confidentialité disponible est SELF_ONLY (vidéo visible du seul propriétaire du
 * compte). Le code s'adapte automatiquement à ce que le compte autorise.
 */

import { storage } from '../storage';
import type { SocialPage } from '@shared/schema';

const AUTH_BASE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const API_BASE_URL = 'https://open.tiktokapis.com/v2';

/** Scopes demandés à l'autorisation. `video.publish` nécessite l'audit TikTok. */
const DEFAULT_SCOPES = 'user.info.basic,video.publish';

/** TikTok impose des chunks entre 5 Mo et 64 Mo. */
const MAX_SINGLE_CHUNK_SIZE = 64 * 1024 * 1024;
const CHUNK_SIZE = 32 * 1024 * 1024;

/** Longueur maximale de la légende d'une vidéo TikTok. */
const MAX_TITLE_LENGTH = 2200;

/** Renouvelle le token si sa fin de validité est à moins de 5 minutes. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface TiktokCreatorInfo {
  creatorAvatarUrl?: string;
  creatorUsername?: string;
  creatorNickname?: string;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec?: number;
}

export interface TiktokPublishOptions {
  privacyLevel?: string;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
}

export interface TiktokPublishStatus {
  status: string;
  failReason?: string;
  postId?: string;
}

interface TiktokTokenResponse {
  access_token: string;
  expires_in: number;
  open_id: string;
  refresh_token: string;
  refresh_expires_in: number;
  scope: string;
  token_type: string;
}

export class TiktokService {
  /**
   * Identifiants de l'application développeur TikTok (globaux à l'instance).
   * La base prime sur les variables d'environnement.
   */
  private async getCredentials(): Promise<{ clientKey: string; clientSecret: string }> {
    const config = await storage.getTiktokConfig();

    const clientKey = config?.clientKey || process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = config?.clientSecret || process.env.TIKTOK_CLIENT_SECRET;

    if (!clientKey || !clientSecret) {
      throw new Error(
        "TikTok n'est pas configuré. Renseignez le client key et le client secret " +
        "de votre application TikTok dans les paramètres."
      );
    }

    return { clientKey, clientSecret };
  }

  async isConfigured(): Promise<boolean> {
    try {
      await this.getCredentials();
      return true;
    } catch {
      return false;
    }
  }

  getRedirectUri(): string {
    if (process.env.TIKTOK_REDIRECT_URI) {
      return process.env.TIKTOK_REDIRECT_URI;
    }
    const base = (process.env.APP_URL || 'http://localhost:5555').replace(/\/$/, '');
    return `${base}/api/tiktok/callback`;
  }

  /**
   * URL d'autorisation à ouvrir pour connecter le compte TikTok d'un magasin.
   * Chaque magasin répète ce flux : un compte = une ligne dans social_pages.
   */
  async buildAuthorizationUrl(state: string): Promise<string> {
    const { clientKey } = await this.getCredentials();

    const params = new URLSearchParams({
      client_key: clientKey,
      scope: process.env.TIKTOK_SCOPES || DEFAULT_SCOPES,
      response_type: 'code',
      redirect_uri: this.getRedirectUri(),
      state,
    });

    return `${AUTH_BASE_URL}?${params.toString()}`;
  }

  /** Échange le code d'autorisation contre un couple access/refresh token. */
  async exchangeCodeForToken(code: string): Promise<TiktokTokenResponse> {
    const { clientKey, clientSecret } = await this.getCredentials();

    return await this.requestToken({
      client_key: clientKey,
      client_secret: clientSecret,
      // TikTok renvoie le code URL-encodé dans la query string
      code: decodeURIComponent(code),
      grant_type: 'authorization_code',
      redirect_uri: this.getRedirectUri(),
    });
  }

  /** Renouvelle un access token expiré. TikTok rend aussi un nouveau refresh token. */
  async refreshAccessToken(refreshToken: string): Promise<TiktokTokenResponse> {
    const { clientKey, clientSecret } = await this.getCredentials();

    return await this.requestToken({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  private async requestToken(body: Record<string, string>): Promise<TiktokTokenResponse> {
    const response = await fetch(`${API_BASE_URL}/oauth/token/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: new URLSearchParams(body).toString(),
    });

    const raw = await response.text();
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`Réponse TikTok illisible (${response.status}): ${raw.slice(0, 200)}`);
    }

    // L'endpoint OAuth signale les erreurs avec `error` + `error_description`
    if (!response.ok || data.error) {
      const description = data.error_description || data.error || raw.slice(0, 200);
      throw new Error(`Erreur OAuth TikTok: ${description}`);
    }

    if (!data.access_token) {
      throw new Error("Réponse TikTok inattendue : aucun access token reçu");
    }

    return data as TiktokTokenResponse;
  }

  /**
   * Récupère un access token valide pour une page, en le renouvelant si besoin.
   * Le nouveau couple de tokens est persisté immédiatement : le refresh token
   * TikTok est à usage unique, le perdre déconnecterait le compte.
   */
  async getValidAccessToken(page: SocialPage): Promise<string> {
    if (page.platform !== 'tiktok') {
      throw new Error('Ce service ne gère que les comptes TikTok');
    }

    const expiresAt = page.tokenExpiresAt ? new Date(page.tokenExpiresAt).getTime() : 0;
    const stillValid = expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now();

    if (stillValid && page.accessToken) {
      return page.accessToken;
    }

    if (!page.refreshToken) {
      throw new Error(
        `Le compte TikTok "${page.pageName}" doit être reconnecté (aucun refresh token enregistré).`
      );
    }

    console.log(`🔄 [TikTok] Renouvellement du token pour ${page.pageName}`);

    let tokens: TiktokTokenResponse;
    try {
      tokens = await this.refreshAccessToken(page.refreshToken);
    } catch (error) {
      await storage.updateSocialPage(page.id, {
        tokenStatus: 'expired',
        lastTokenCheck: new Date(),
      });
      throw new Error(
        `Impossible de renouveler le token TikTok de "${page.pageName}". ` +
        `Le compte doit être reconnecté. (${error instanceof Error ? error.message : 'erreur inconnue'})`
      );
    }

    await this.persistTokens(page.id, tokens);

    return tokens.access_token;
  }

  /** Enregistre un couple de tokens fraîchement obtenu sur une page. */
  async persistTokens(pageId: string, tokens: TiktokTokenResponse): Promise<void> {
    await storage.updateSocialPage(pageId, {
      accessToken: tokens.access_token,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      refreshToken: tokens.refresh_token,
      refreshTokenExpiresAt: new Date(Date.now() + tokens.refresh_expires_in * 1000),
      scopes: tokens.scope,
      tokenStatus: 'valid',
      lastTokenCheck: new Date(),
    });
  }

  /** Profil public du compte, utilisé pour nommer la page à la connexion. */
  async getUserInfo(accessToken: string): Promise<{
    openId: string;
    displayName: string;
    avatarUrl?: string;
  }> {
    const params = new URLSearchParams({
      fields: 'open_id,display_name,avatar_url',
    });

    const response = await fetch(`${API_BASE_URL}/user/info/?${params.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const data = await this.parseApiResponse(response, 'récupération du profil');
    const user = data.user || {};

    return {
      openId: user.open_id,
      displayName: user.display_name || 'Compte TikTok',
      avatarUrl: user.avatar_url,
    };
  }

  /**
   * Options réellement autorisées sur le compte (confidentialité, commentaires,
   * duo, stitch, durée max). TikTok impose cet appel avant chaque publication.
   */
  async getCreatorInfo(page: SocialPage): Promise<TiktokCreatorInfo> {
    return await this.queryCreatorInfo(await this.getValidAccessToken(page));
  }

  /**
   * Variante prenant un token déjà résolu : le refresh token TikTok tourne à chaque
   * renouvellement, donc une même opération ne doit déclencher qu'un seul refresh.
   */
  private async queryCreatorInfo(accessToken: string): Promise<TiktokCreatorInfo> {
    const response = await fetch(`${API_BASE_URL}/post/publish/creator_info/query/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
    });

    const data = await this.parseApiResponse(response, 'récupération des options du compte');

    return {
      creatorAvatarUrl: data.creator_avatar_url,
      creatorUsername: data.creator_username,
      creatorNickname: data.creator_nickname,
      privacyLevelOptions: data.privacy_level_options || [],
      commentDisabled: !!data.comment_disabled,
      duetDisabled: !!data.duet_disabled,
      stitchDisabled: !!data.stitch_disabled,
      maxVideoPostDurationSec: data.max_video_post_duration_sec,
    };
  }

  /**
   * Publie une vidéo sur un compte TikTok en trois temps :
   *   1. init  — déclare la taille et le découpage, récupère publish_id + upload_url
   *   2. upload — envoie les données binaires par chunks
   *   3. (plus tard) status/fetch — le poller récupère l'identifiant du post
   *
   * On envoie le fichier (FILE_UPLOAD) plutôt qu'une URL (PULL_FROM_URL) : cette
   * seconde option exigerait de faire vérifier le domaine de l'instance chez TikTok
   * et que les médias soient publiquement accessibles.
   *
   * @returns le publish_id à suivre pour connaître le résultat final
   */
  async publishVideoFromBuffer(
    page: SocialPage,
    videoBuffer: Buffer,
    caption?: string,
    options: TiktokPublishOptions = {}
  ): Promise<string> {
    if (page.platform !== 'tiktok') {
      throw new Error('Ce service ne gère que les comptes TikTok');
    }

    // Un seul renouvellement de token pour toute la publication
    const accessToken = await this.getValidAccessToken(page);
    const creatorInfo = await this.queryCreatorInfo(accessToken);
    const privacyLevel = this.resolvePrivacyLevel(creatorInfo, options.privacyLevel, page.pageName);

    const videoSize = videoBuffer.length;
    const { chunkSize, totalChunkCount } = this.computeChunking(videoSize);

    console.log('🎬 [TikTok] Publication en cours:', {
      compte: page.pageName,
      taille: `${(videoSize / 1024 / 1024).toFixed(2)} Mo`,
      chunks: totalChunkCount,
      confidentialite: privacyLevel,
    });

    // ── Étape 1 : init ────────────────────────────────────────────────────────
    const initBody = {
      post_info: {
        title: (caption || '').slice(0, MAX_TITLE_LENGTH),
        privacy_level: privacyLevel,
        // Une option désactivée côté compte doit obligatoirement être déclarée désactivée
        disable_comment: creatorInfo.commentDisabled || !!options.disableComment,
        disable_duet: creatorInfo.duetDisabled || !!options.disableDuet,
        disable_stitch: creatorInfo.stitchDisabled || !!options.disableStitch,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: videoSize,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount,
      },
    };

    const initResponse = await fetch(`${API_BASE_URL}/post/publish/video/init/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(initBody),
    });

    const initData = await this.parseApiResponse(initResponse, 'initialisation de la publication');
    const publishId: string = initData.publish_id;
    const uploadUrl: string = initData.upload_url;

    if (!publishId || !uploadUrl) {
      throw new Error("TikTok n'a pas renvoyé d'identifiant de publication");
    }

    console.log(`📤 [TikTok] Upload initialisé: publish_id=${publishId}`);

    // ── Étape 2 : upload des chunks ───────────────────────────────────────────
    for (let index = 0; index < totalChunkCount; index++) {
      const start = index * chunkSize;
      // Le dernier chunk absorbe le reliquat
      const end = index === totalChunkCount - 1 ? videoSize - 1 : start + chunkSize - 1;
      const chunk = videoBuffer.subarray(start, end + 1);

      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': chunk.length.toString(),
          'Content-Range': `bytes ${start}-${end}/${videoSize}`,
        },
        body: new Blob([chunk], { type: 'video/mp4' }),
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(
          `Échec de l'envoi du chunk ${index + 1}/${totalChunkCount} vers TikTok ` +
          `(${uploadResponse.status}): ${errorText.slice(0, 200)}`
        );
      }

      console.log(`📤 [TikTok] Chunk ${index + 1}/${totalChunkCount} envoyé`);
    }

    console.log(`✅ [TikTok] Vidéo transmise pour ${page.pageName}, traitement en cours côté TikTok`);

    return publishId;
  }

  /** Interroge TikTok sur l'avancement d'une publication. */
  async getPublishStatus(page: SocialPage, publishId: string): Promise<TiktokPublishStatus> {
    const accessToken = await this.getValidAccessToken(page);

    const response = await fetch(`${API_BASE_URL}/post/publish/status/fetch/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id: publishId }),
    });

    const data = await this.parseApiResponse(response, 'suivi de la publication');

    // Le nom du champ comporte bien une faute de frappe côté API TikTok
    const postIds: string[] = data.publicaly_available_post_id || data.publicly_available_post_id || [];

    return {
      status: data.status,
      failReason: data.fail_reason,
      postId: postIds.length > 0 ? postIds[0] : undefined,
    };
  }

  /**
   * Met à jour les publications TikTok encore en cours de traitement.
   * Appelé périodiquement : c'est ce qui renseigne l'identifiant définitif du post
   * (ou l'erreur) une fois que TikTok a fini d'encoder la vidéo.
   */
  async syncPendingPublications(): Promise<void> {
    const pending = await storage.getScheduledPostsAwaitingPublishStatus();

    if (pending.length === 0) {
      return;
    }

    console.log(`🔎 [TikTok] Suivi de ${pending.length} publication(s) en cours...`);

    for (const scheduledPost of pending) {
      try {
        const page = await storage.getSocialPage(scheduledPost.pageId);
        if (!page || page.platform !== 'tiktok' || !scheduledPost.publishId) {
          continue;
        }

        const status = await this.getPublishStatus(page, scheduledPost.publishId);

        if (status.status === 'PUBLISH_COMPLETE') {
          await storage.updateScheduledPost(scheduledPost.id, {
            publishStatus: status.status,
            // À défaut d'ID public (compte privé), on garde le publish_id comme référence
            externalPostId: status.postId || scheduledPost.publishId,
            error: null,
          });
          console.log(`✅ [TikTok] Publication terminée sur ${page.pageName}`);
          continue;
        }

        if (status.status === 'FAILED') {
          await storage.updateScheduledPost(scheduledPost.id, {
            publishStatus: 'FAILED',
            error: `Publication TikTok échouée : ${status.failReason || 'raison inconnue'}`,
          });
          console.error(`❌ [TikTok] Publication échouée sur ${page.pageName}: ${status.failReason}`);
          continue;
        }

        // Filet de sécurité : au-delà de 24h, on cesse d'interroger l'API
        const sentAt = scheduledPost.publishedAt ? new Date(scheduledPost.publishedAt).getTime() : 0;
        if (sentAt && Date.now() - sentAt > 24 * 60 * 60 * 1000) {
          await storage.updateScheduledPost(scheduledPost.id, {
            publishStatus: 'FAILED',
            error: `Statut TikTok toujours "${status.status}" après 24h, suivi abandonné.`,
          });
          console.error(`❌ [TikTok] Suivi abandonné pour ${page.pageName} (statut ${status.status})`);
          continue;
        }

        await storage.updateScheduledPost(scheduledPost.id, { publishStatus: status.status });
      } catch (error) {
        console.error(
          `⚠️ [TikTok] Impossible de récupérer le statut de la publication ${scheduledPost.id}:`,
          error instanceof Error ? error.message : error
        );
      }
    }
  }

  /**
   * Choisit un niveau de confidentialité réellement autorisé sur le compte.
   * Sans audit TikTok validé, seul SELF_ONLY est proposé : on s'y rabat plutôt
   * que d'échouer, en le signalant dans les logs.
   */
  private resolvePrivacyLevel(
    creatorInfo: TiktokCreatorInfo,
    requested: string | undefined,
    pageName: string
  ): string {
    const options = creatorInfo.privacyLevelOptions;

    if (options.length === 0) {
      throw new Error(
        `Le compte TikTok "${pageName}" ne propose aucun niveau de confidentialité. ` +
        `Vérifiez que le compte est bien autorisé et que l'application dispose du scope video.publish.`
      );
    }

    const wanted = requested || 'PUBLIC_TO_EVERYONE';
    if (options.includes(wanted)) {
      return wanted;
    }

    const fallback = options.includes('SELF_ONLY') ? 'SELF_ONLY' : options[0];
    console.warn(
      `⚠️ [TikTok] "${wanted}" indisponible sur ${pageName} (options: ${options.join(', ')}). ` +
      `Publication en ${fallback}. Tant que l'application TikTok n'est pas auditée, ` +
      `les vidéos restent privées.`
    );
    return fallback;
  }

  /**
   * Découpage du fichier : un seul chunk jusqu'à 64 Mo, sinon des chunks de 32 Mo,
   * le dernier absorbant le reliquat (règle imposée par TikTok).
   */
  private computeChunking(videoSize: number): { chunkSize: number; totalChunkCount: number } {
    if (videoSize <= MAX_SINGLE_CHUNK_SIZE) {
      return { chunkSize: videoSize, totalChunkCount: 1 };
    }
    return {
      chunkSize: CHUNK_SIZE,
      totalChunkCount: Math.floor(videoSize / CHUNK_SIZE),
    };
  }

  /**
   * Les endpoints v2 répondent HTTP 200 avec `error.code === 'ok'` en cas de succès :
   * il ne suffit pas de regarder le statut HTTP.
   */
  private async parseApiResponse(response: Response, context: string): Promise<any> {
    const raw = await response.text();

    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(`Réponse TikTok illisible lors de la ${context} (${response.status}): ${raw.slice(0, 200)}`);
    }

    const errorCode = payload?.error?.code;
    if (!response.ok || (errorCode && errorCode !== 'ok')) {
      const message = payload?.error?.message || raw.slice(0, 200);
      throw new Error(`Erreur TikTok lors de la ${context}: ${message} (code: ${errorCode || response.status})`);
    }

    return payload.data || {};
  }
}

export const tiktokService = new TiktokService();
