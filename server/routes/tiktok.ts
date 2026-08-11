/**
 * Routes de gestion des comptes TikTok.
 *
 * Un compte TikTok de magasin se connecte en OAuth (TikTok n'autorise pas la
 * saisie manuelle d'un token), puis vit dans `social_pages` comme une page
 * Facebook : mêmes permissions, même planification, même calendrier.
 */

import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import type { User } from '@shared/schema';
import { storage } from '../storage';
import { tiktokService } from '../services/tiktok';
import { insertTiktokConfigSchema, updateTiktokConfigSchema } from '@shared/schema';

export const tiktokRouter = Router();

/** Page vers laquelle on renvoie le navigateur à la fin du flux OAuth. */
const RETURN_PATH = '/pages';

function isAdmin(req: Request): boolean {
  const user = req.user as User | undefined;
  return user?.role === 'admin';
}

function buildReturnUrl(status: 'success' | 'error', message: string): string {
  const params = new URLSearchParams({ tiktok: status, message });
  return `${RETURN_PATH}?${params.toString()}`;
}

/**
 * État de la configuration TikTok.
 * Le client secret n'est jamais renvoyé au client.
 */
tiktokRouter.get('/config', async (req: Request, res: Response) => {
  try {
    const config = await storage.getTiktokConfig();
    const configured = await tiktokService.isConfigured();

    // Tout le monde a besoin de savoir si la connexion est possible ; seuls les
    // admins voient les détails de l'application développeur.
    if (!isAdmin(req)) {
      return res.json({ configured });
    }

    res.json({
      configured,
      clientKey: config?.clientKey || (process.env.TIKTOK_CLIENT_KEY ? '(défini par variable d\'environnement)' : ''),
      hasClientSecret: !!(config?.clientSecret || process.env.TIKTOK_CLIENT_SECRET),
      redirectUri: tiktokService.getRedirectUri(),
    });
  } catch (error) {
    console.error('❌ [TikTok] Erreur lecture configuration:', error);
    res.status(500).json({ error: 'Impossible de lire la configuration TikTok' });
  }
});

/** Enregistre les identifiants de l'application développeur TikTok (admin). */
tiktokRouter.put('/config', async (req: Request, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Accès refusé. Réservé aux administrateurs.' });
    }

    const existing = await storage.getTiktokConfig();
    // Le secret peut être omis lors d'une mise à jour : on garde l'existant
    const schema = existing ? updateTiktokConfigSchema : insertTiktokConfigSchema;
    const data = schema.parse(req.body);

    const config = await storage.upsertTiktokConfig(data);

    res.json({
      success: true,
      clientKey: config.clientKey,
      redirectUri: tiktokService.getRedirectUri(),
    });
  } catch (error: any) {
    console.error('❌ [TikTok] Erreur enregistrement configuration:', error);
    res.status(400).json({
      error: error?.errors?.[0]?.message || error?.message || 'Configuration TikTok invalide',
    });
  }
});

/**
 * Démarre la connexion d'un compte TikTok.
 * À appeler par navigation complète du navigateur (window.location), pas en fetch.
 */
tiktokRouter.get('/connect', async (req: Request, res: Response) => {
  try {
    if (!(await tiktokService.isConfigured())) {
      return res.redirect(
        buildReturnUrl('error', "TikTok n'est pas configuré. Renseignez d'abord le client key et le client secret.")
      );
    }

    // Protection CSRF : l'état est vérifié au retour
    const state = crypto.randomBytes(16).toString('hex');
    (req.session as any).tiktokOAuthState = state;

    const authUrl = await tiktokService.buildAuthorizationUrl(state);

    // La session doit être écrite avant la redirection, sinon l'état est perdu
    req.session.save((err) => {
      if (err) {
        console.error('❌ [TikTok] Impossible de sauvegarder la session OAuth:', err);
        return res.redirect(buildReturnUrl('error', 'Erreur de session, réessayez.'));
      }
      res.redirect(authUrl);
    });
  } catch (error) {
    console.error('❌ [TikTok] Erreur démarrage OAuth:', error);
    res.redirect(
      buildReturnUrl('error', error instanceof Error ? error.message : 'Erreur de connexion TikTok')
    );
  }
});

/**
 * Retour d'autorisation TikTok : échange le code, puis crée ou met à jour le
 * compte dans social_pages.
 */
tiktokRouter.get('/callback', async (req: Request, res: Response) => {
  const user = req.user as User;
  const { code, state, error: oauthError, error_description: oauthErrorDescription } = req.query;

  try {
    if (oauthError) {
      const description = (oauthErrorDescription as string) || (oauthError as string);
      return res.redirect(buildReturnUrl('error', `Autorisation TikTok refusée : ${description}`));
    }

    const expectedState = (req.session as any)?.tiktokOAuthState;
    delete (req.session as any)?.tiktokOAuthState;

    if (!state || !expectedState || state !== expectedState) {
      return res.redirect(buildReturnUrl('error', 'Requête de connexion TikTok invalide (état non reconnu).'));
    }

    if (!code || typeof code !== 'string') {
      return res.redirect(buildReturnUrl('error', "Aucun code d'autorisation reçu de TikTok."));
    }

    const tokens = await tiktokService.exchangeCodeForToken(code);
    const profile = await tiktokService.getUserInfo(tokens.access_token);
    const openId = profile.openId || tokens.open_id;

    // Un compte déjà connecté est mis à jour plutôt que dupliqué
    const existingPages = await storage.getSocialPages(user.id);
    const existing = existingPages.find(p => p.platform === 'tiktok' && p.pageId === openId);

    if (existing) {
      await storage.updateSocialPage(existing.id, {
        pageName: profile.displayName,
        avatarUrl: profile.avatarUrl || null,
        isActive: 'true',
      });
      await tiktokService.persistTokens(existing.id, tokens);

      console.log(`🔁 [TikTok] Compte reconnecté: ${profile.displayName}`);
      return res.redirect(buildReturnUrl('success', `Compte TikTok "${profile.displayName}" reconnecté.`));
    }

    const page = await storage.createSocialPage({
      userId: user.id,
      platform: 'tiktok',
      pageId: openId,
      pageName: profile.displayName,
      accessToken: tokens.access_token,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      refreshToken: tokens.refresh_token,
      refreshTokenExpiresAt: new Date(Date.now() + tokens.refresh_expires_in * 1000),
      scopes: tokens.scope,
      avatarUrl: profile.avatarUrl || null,
      isActive: 'true',
    });

    // Les non-admins ne voient que les pages qui leur sont explicitement
    // attribuées : sans cette permission, ils ne verraient pas leur propre compte.
    if (user.role !== 'admin') {
      try {
        await storage.createPagePermission({ userId: user.id, pageId: page.id });
      } catch (permissionError) {
        console.error('⚠️ [TikTok] Impossible de créer la permission de page:', permissionError);
      }
    }

    console.log(`✅ [TikTok] Nouveau compte connecté: ${profile.displayName} (${openId})`);
    res.redirect(buildReturnUrl('success', `Compte TikTok "${profile.displayName}" connecté.`));
  } catch (error) {
    console.error('❌ [TikTok] Erreur callback OAuth:', error);
    res.redirect(
      buildReturnUrl('error', error instanceof Error ? error.message : 'Connexion TikTok impossible')
    );
  }
});

/**
 * Options réellement autorisées sur un compte (confidentialité, commentaires,
 * duo, stitch, durée max). TikTok impose de les afficher avant publication.
 */
tiktokRouter.get('/accounts/:id/creator-info', async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const page = await storage.getSocialPage(req.params.id);

    if (!page || page.platform !== 'tiktok') {
      return res.status(404).json({ error: 'Compte TikTok non trouvé' });
    }

    if (user.role !== 'admin' && page.userId !== user.id) {
      const accessible = await storage.getUserAccessiblePages(user.id);
      if (!accessible.some(p => p.id === page.id)) {
        return res.status(403).json({ error: 'Accès refusé à ce compte' });
      }
    }

    const creatorInfo = await tiktokService.getCreatorInfo(page);
    res.json(creatorInfo);
  } catch (error) {
    console.error('❌ [TikTok] Erreur récupération creator info:', error);
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Impossible de contacter TikTok',
    });
  }
});
