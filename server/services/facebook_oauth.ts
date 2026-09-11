/**
 * Renouvellement des tokens Facebook.
 *
 * Le problème que ce service résout : un token de page saisi à la main finit
 * toujours par mourir (60 jours pour un token issu du Graph Explorer, ou du
 * jour au lendemain si le mot de passe change, si l'utilisateur perd son rôle
 * d'admin, ou si Meta révoque l'autorisation) — et on ne l'apprend qu'au
 * moment où une publication échoue.
 *
 * La parade est celle recommandée par Meta :
 *   1. l'utilisateur autorise l'application (OAuth) ;
 *   2. le code est échangé contre un token utilisateur court ;
 *   3. ce token court est échangé contre un token utilisateur longue durée
 *      (~60 jours) — c'est lui que l'on conserve, chiffré ;
 *   4. les tokens de page dérivés d'un token utilisateur longue durée
 *      n'expirent pas.
 *
 * Conserver le token utilisateur permet de régénérer un token de page sans
 * intervention humaine, et de prolonger le token utilisateur lui-même avant
 * son échéance : tant que l'utilisateur ne retire pas son autorisation, la
 * chaîne se renouvelle toute seule.
 */

import type { Request } from 'express';
import { storage } from '../storage';
import { resolvePublicBaseUrl } from '../utils/public_url';

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION?.trim() || 'v19.0';
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Permissions nécessaires pour publier et lire les statistiques d'une page. */
const DEFAULT_SCOPES = [
  'pages_show_list',
  'pages_manage_posts',
  'pages_read_engagement',
  'pages_manage_engagement',
  'read_insights',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
].join(',');

export interface FacebookLongLivedToken {
  accessToken: string;
  /** Nul quand Facebook ne renvoie pas d'échéance (jeton sans expiration). */
  expiresAt: Date | null;
}

export interface FacebookPageTarget {
  id: string;
  name: string;
  accessToken: string;
  followersCount: number;
  /** Compte Instagram professionnel rattaché à la page, s'il existe. */
  instagram: { id: string; name: string } | null;
}

/** Résultat de /debug_token : ce que Meta sait vraiment du jeton. */
export interface FacebookTokenInfo {
  isValid: boolean;
  /** Nul = n'expire pas (cas normal d'un token de page). */
  expiresAt: Date | null;
  scopes: string[];
  error: string | null;
}

export class FacebookAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FacebookAuthError';
  }
}

export class FacebookOAuthService {
  /**
   * Identifiants de l'application Facebook (globaux à l'instance).
   * La base prime sur les variables d'environnement.
   */
  private async getCredentials(): Promise<{ appId: string; appSecret: string }> {
    const config = await storage.getFacebookConfig();

    const appId = config?.appId || process.env.FACEBOOK_APP_ID;
    const appSecret = config?.appSecret || process.env.FACEBOOK_APP_SECRET;

    if (!appId || !appSecret) {
      throw new FacebookAuthError(
        "Facebook n'est pas configuré. Renseignez l'App ID et l'App Secret de " +
        'votre application Facebook dans les paramètres.'
      );
    }

    return { appId, appSecret };
  }

  async isConfigured(): Promise<boolean> {
    try {
      await this.getCredentials();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * URI de redirection OAuth. `req` permet de la déduire du domaine réellement
   * utilisé quand `APP_URL` n'est pas défini : sans lui on renverrait
   * `http://localhost:5555`, que Facebook rejette.
   */
  getRedirectUri(req?: Request): string {
    if (process.env.FACEBOOK_REDIRECT_URI) {
      return process.env.FACEBOOK_REDIRECT_URI;
    }
    return `${resolvePublicBaseUrl(req)}/api/facebook/callback`;
  }

  getScopes(): string {
    return process.env.FACEBOOK_SCOPES || DEFAULT_SCOPES;
  }

  /** URL d'autorisation à ouvrir pour connecter les pages d'un compte Facebook. */
  async buildAuthorizationUrl(state: string, req?: Request): Promise<string> {
    const { appId } = await this.getCredentials();

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: this.getRedirectUri(req),
      state,
      scope: this.getScopes(),
      response_type: 'code',
    });

    return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
  }

  /**
   * Échange le code d'autorisation contre un token utilisateur **longue durée**.
   * L'étape intermédiaire (token court) n'est jamais conservée : seul le token
   * longue durée rend les tokens de page permanents.
   */
  async exchangeCodeForUserToken(code: string, req?: Request): Promise<FacebookLongLivedToken> {
    const { appId, appSecret } = await this.getCredentials();

    const shortLived = await this.graphGet<{ access_token?: string }>('/oauth/access_token', {
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: this.getRedirectUri(req),
      code,
    }, "échange du code d'autorisation");

    if (!shortLived.access_token) {
      throw new FacebookAuthError('Facebook n\'a pas renvoyé de jeton pour ce code d\'autorisation.');
    }

    return this.extendUserToken(shortLived.access_token);
  }

  /**
   * Prolonge un token utilisateur. Appelé au retour d'OAuth (token court →
   * ~60 jours) mais aussi périodiquement : ré-échanger un token longue durée
   * encore valide repart pour 60 jours, ce qui évite la reconnexion manuelle.
   */
  async extendUserToken(userToken: string): Promise<FacebookLongLivedToken> {
    const { appId, appSecret } = await this.getCredentials();

    const longLived = await this.graphGet<{ access_token?: string; expires_in?: number }>(
      '/oauth/access_token',
      {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: userToken,
      },
      'prolongation du jeton utilisateur'
    );

    if (!longLived.access_token) {
      throw new FacebookAuthError("Facebook n'a pas renvoyé de jeton longue durée.");
    }

    return {
      accessToken: longLived.access_token,
      // expires_in absent ou nul = jeton sans expiration connue.
      expiresAt: longLived.expires_in
        ? new Date(Date.now() + longLived.expires_in * 1000)
        : null,
    };
  }

  /**
   * Pages administrées par le compte, avec leur token de page.
   * Ces tokens sont permanents lorsqu'ils dérivent d'un token utilisateur
   * longue durée : c'est le cœur du renouvellement automatique.
   */
  async listPages(userToken: string): Promise<FacebookPageTarget[]> {
    const response = await this.graphGet<{
      data?: {
        id: string;
        name: string;
        access_token: string;
        fan_count?: number;
        followers_count?: number;
        instagram_business_account?: { id: string; name?: string; username?: string };
      }[];
    }>(
      '/me/accounts',
      {
        fields: 'id,name,access_token,fan_count,followers_count,instagram_business_account{id,name,username}',
        limit: '200',
        access_token: userToken,
      },
      'récupération des pages'
    );

    return (response.data ?? []).map((page) => ({
      id: page.id,
      name: page.name,
      accessToken: page.access_token,
      followersCount: page.followers_count ?? page.fan_count ?? 0,
      instagram: page.instagram_business_account
        ? {
            id: page.instagram_business_account.id,
            name:
              page.instagram_business_account.username ||
              page.instagram_business_account.name ||
              page.name,
          }
        : null,
    }));
  }

  /**
   * Interroge Meta sur l'état réel d'un jeton. Un simple appel /me ne dit pas
   * quand le jeton expire : /debug_token le dit, ce qui permet de renouveler
   * *avant* la panne plutôt qu'après.
   */
  async inspectToken(token: string): Promise<FacebookTokenInfo> {
    const { appId, appSecret } = await this.getCredentials();

    const response = await this.graphGet<{
      data?: {
        is_valid?: boolean;
        expires_at?: number;
        scopes?: string[];
        error?: { message?: string };
      };
    }>(
      '/debug_token',
      {
        input_token: token,
        // Jeton d'application : `app_id|app_secret`, accepté par /debug_token.
        access_token: `${appId}|${appSecret}`,
      },
      'inspection du jeton'
    );

    const data = response.data ?? {};

    return {
      isValid: data.is_valid === true,
      // `expires_at: 0` signifie « n'expire pas » chez Meta.
      expiresAt: data.expires_at ? new Date(data.expires_at * 1000) : null,
      scopes: data.scopes ?? [],
      error: data.error?.message ?? null,
    };
  }

  private async graphGet<T>(
    endpoint: string,
    params: Record<string, string>,
    context: string
  ): Promise<T> {
    const url = new URL(`${GRAPH_URL}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    let response: Response;
    try {
      response = await fetch(url.toString());
    } catch (error) {
      throw new FacebookAuthError(
        `Facebook injoignable (${context}) : ${error instanceof Error ? error.message : 'erreur réseau'}`
      );
    }

    const payload: any = await response.json().catch(() => ({}));

    if (!response.ok || payload?.error) {
      const message = payload?.error?.message || `HTTP ${response.status}`;
      throw new FacebookAuthError(`Facebook (${context}) : ${message}`);
    }

    return payload as T;
  }
}

export const facebookOAuthService = new FacebookOAuthService();
