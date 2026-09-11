/**
 * Connexion et renouvellement des pages Facebook / Instagram.
 *
 * Une page connectée ici embarque le jeton utilisateur longue durée qui a servi
 * à l'obtenir : c'est ce qui permet au `TokenManager` de régénérer son jeton de
 * page tout seul, au lieu d'exiger un copier-coller depuis le Graph Explorer
 * tous les deux mois.
 */

import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import type { User } from '@shared/schema';
import { storage } from '../storage';
import { facebookOAuthService } from '../services/facebook_oauth';
import { TokenManager } from '../services/token_manager';
import { encrypt } from '../utils/encryption';
import { insertFacebookConfigSchema, updateFacebookConfigSchema } from '@shared/schema';

export const facebookRouter = Router();

/** Page vers laquelle on renvoie le navigateur à la fin du flux OAuth. */
const RETURN_PATH = '/pages';

function isAdmin(req: Request): boolean {
  const user = req.user as User | undefined;
  return user?.role === 'admin';
}

function buildReturnUrl(status: 'success' | 'error', message: string): string {
  const params = new URLSearchParams({ facebook: status, message });
  return `${RETURN_PATH}?${params.toString()}`;
}

/**
 * État de la configuration Facebook.
 * L'App Secret n'est jamais renvoyé au client.
 */
facebookRouter.get('/config', async (req: Request, res: Response) => {
  try {
    const config = await storage.getFacebookConfig();
    const configured = await facebookOAuthService.isConfigured();

    // Tout le monde a besoin de savoir si la connexion est possible ; seuls les
    // admins voient les détails de l'application développeur.
    if (!isAdmin(req)) {
      return res.json({ configured });
    }

    res.json({
      configured,
      appId: config?.appId || (process.env.FACEBOOK_APP_ID ? "(défini par variable d'environnement)" : ''),
      hasAppSecret: !!(config?.appSecret || process.env.FACEBOOK_APP_SECRET),
      redirectUri: facebookOAuthService.getRedirectUri(req),
      scopes: facebookOAuthService.getScopes().split(','),
    });
  } catch (error) {
    console.error('❌ [Facebook] Erreur lecture configuration:', error);
    res.status(500).json({ error: 'Impossible de lire la configuration Facebook' });
  }
});

/** Enregistre les identifiants de l'application Facebook (admin). */
facebookRouter.put('/config', async (req: Request, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Accès refusé. Réservé aux administrateurs.' });
    }

    const existing = await storage.getFacebookConfig();
    // Le secret peut être omis lors d'une mise à jour : on garde l'existant
    const schema = existing ? updateFacebookConfigSchema : insertFacebookConfigSchema;
    const data = schema.parse(req.body);

    const config = await storage.upsertFacebookConfig(data);

    res.json({
      success: true,
      appId: config.appId,
      redirectUri: facebookOAuthService.getRedirectUri(req),
    });
  } catch (error: any) {
    console.error('❌ [Facebook] Erreur enregistrement configuration:', error);
    res.status(400).json({
      error: error?.errors?.[0]?.message || error?.message || 'Configuration Facebook invalide',
    });
  }
});

/**
 * Démarre la connexion des pages Facebook.
 * À appeler par navigation complète du navigateur (window.location), pas en fetch.
 */
facebookRouter.get('/connect', async (req: Request, res: Response) => {
  try {
    if (!(await facebookOAuthService.isConfigured())) {
      return res.redirect(
        buildReturnUrl('error', "Facebook n'est pas configuré. Renseignez d'abord l'App ID et l'App Secret.")
      );
    }

    // Protection CSRF : l'état est vérifié au retour
    const state = crypto.randomBytes(16).toString('hex');
    (req.session as any).facebookOAuthState = state;

    const authUrl = await facebookOAuthService.buildAuthorizationUrl(state, req);

    // La session doit être écrite avant la redirection, sinon l'état est perdu
    req.session.save((err) => {
      if (err) {
        console.error('❌ [Facebook] Impossible de sauvegarder la session OAuth:', err);
        return res.redirect(buildReturnUrl('error', 'Erreur de session, réessayez.'));
      }
      res.redirect(authUrl);
    });
  } catch (error) {
    console.error('❌ [Facebook] Erreur démarrage OAuth:', error);
    res.redirect(
      buildReturnUrl('error', error instanceof Error ? error.message : 'Erreur de connexion Facebook')
    );
  }
});

/**
 * Retour d'autorisation Facebook : échange le code contre un jeton utilisateur
 * longue durée, puis crée ou met à jour chaque page administrée.
 */
facebookRouter.get('/callback', async (req: Request, res: Response) => {
  const user = req.user as User;
  const { code, state, error: oauthError, error_description: oauthErrorDescription } = req.query;

  try {
    if (oauthError) {
      const description = (oauthErrorDescription as string) || (oauthError as string);
      return res.redirect(buildReturnUrl('error', `Autorisation Facebook refusée : ${description}`));
    }

    const expectedState = (req.session as any)?.facebookOAuthState;
    delete (req.session as any)?.facebookOAuthState;

    if (!state || !expectedState || state !== expectedState) {
      return res.redirect(buildReturnUrl('error', 'Requête de connexion Facebook invalide (état non reconnu).'));
    }

    if (!code || typeof code !== 'string') {
      return res.redirect(buildReturnUrl('error', "Aucun code d'autorisation reçu de Facebook."));
    }

    const userToken = await facebookOAuthService.exchangeCodeForUserToken(code, req);
    const targets = await facebookOAuthService.listPages(userToken.accessToken);

    if (targets.length === 0) {
      return res.redirect(
        buildReturnUrl(
          'error',
          "Aucune page Facebook administrée par ce compte. Connectez-vous avec un compte administrateur de la page."
        )
      );
    }

    // Le jeton utilisateur est la clé du renouvellement automatique : il est
    // conservé chiffré, sur chaque page issue de cette autorisation.
    const encryptedUserToken = encrypt(userToken.accessToken);
    const existingPages = await storage.getSocialPages(user.id);

    let created = 0;
    let updated = 0;

    for (const target of targets) {
      const existing = existingPages.find(
        (page) => page.platform === 'facebook' && page.pageId === target.id
      );

      if (existing) {
        await storage.updateSocialPage(existing.id, {
          pageName: target.name,
          accessToken: target.accessToken,
          // Un jeton de page dérivé d'un jeton utilisateur longue durée n'expire pas.
          tokenExpiresAt: null,
          userAccessToken: encryptedUserToken,
          userTokenExpiresAt: userToken.expiresAt,
          followersCount: target.followersCount,
          tokenStatus: 'valid',
          tokenError: null,
          lastTokenCheck: new Date(),
          isActive: 'true',
        });
        updated++;
        continue;
      }

      const page = await storage.createSocialPage({
        userId: user.id,
        platform: 'facebook',
        pageId: target.id,
        pageName: target.name,
        accessToken: target.accessToken,
        tokenExpiresAt: null,
        userAccessToken: encryptedUserToken,
        userTokenExpiresAt: userToken.expiresAt,
        followersCount: target.followersCount,
        isActive: 'true',
      });
      created++;

      // Les non-admins ne voient que les pages qui leur sont explicitement
      // attribuées : sans cette permission, ils ne verraient pas leur propre page.
      if (user.role !== 'admin') {
        try {
          await storage.createPagePermission({ userId: user.id, pageId: page.id });
        } catch (permissionError) {
          console.error('⚠️ [Facebook] Impossible de créer la permission de page:', permissionError);
        }
      }
    }

    // Un compte Instagram professionnel publie avec le jeton de la page Facebook
    // à laquelle il est rattaché : on le rafraîchit dans la foulée, sans quoi il
    // resterait sur un jeton saisi à la main, condamné à expirer.
    for (const page of existingPages) {
      if (page.platform !== 'instagram') continue;
      const linked = targets.find((target) => target.instagram?.id === page.pageId);
      if (!linked) continue;

      await storage.updateSocialPage(page.id, {
        accessToken: linked.accessToken,
        tokenExpiresAt: null,
        userAccessToken: encryptedUserToken,
        userTokenExpiresAt: userToken.expiresAt,
        tokenStatus: 'valid',
        tokenError: null,
        lastTokenCheck: new Date(),
      });
      updated++;
    }

    const summary = [
      created > 0 ? `${created} page${created > 1 ? 's' : ''} connectée${created > 1 ? 's' : ''}` : null,
      updated > 0 ? `${updated} page${updated > 1 ? 's' : ''} mise${updated > 1 ? 's' : ''} à jour` : null,
    ]
      .filter(Boolean)
      .join(', ');

    console.log(`✅ [Facebook] ${summary} pour ${user.username}`);
    res.redirect(
      buildReturnUrl('success', `${summary}. Les jetons se renouvellent désormais automatiquement.`)
    );
  } catch (error) {
    console.error('❌ [Facebook] Erreur callback OAuth:', error);
    res.redirect(
      buildReturnUrl('error', error instanceof Error ? error.message : 'Connexion Facebook impossible')
    );
  }
});

/** Contrôle (et renouvelle si besoin) le jeton d'une page à la demande. */
facebookRouter.post('/pages/:id/refresh', async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const page = await storage.getSocialPage(req.params.id);

    if (!page) {
      return res.status(404).json({ error: 'Page non trouvée' });
    }

    if (user.role !== 'admin' && page.userId !== user.id) {
      const accessible = await storage.getUserAccessiblePages(user.id);
      if (!accessible.some((p) => p.id === page.id)) {
        return res.status(403).json({ error: 'Accès refusé à cette page' });
      }
    }

    const result = await TokenManager.checkPage(page.id);
    res.json(result);
  } catch (error) {
    console.error('❌ [Facebook] Erreur renouvellement du jeton:', error);
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Impossible de contrôler le jeton',
    });
  }
});

/** Relance le contrôle de toutes les pages (admin). */
facebookRouter.post('/tokens/check', async (req: Request, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Accès refusé. Réservé aux administrateurs.' });
    }

    const results = await TokenManager.checkAndRefreshTokens();
    res.json({
      checked: results.length,
      renewed: results.filter((r) => r.renewed).length,
      failing: results.filter((r) => r.status === 'expired' || r.status === 'error').length,
      results,
    });
  } catch (error) {
    console.error('❌ [Facebook] Erreur contrôle global des jetons:', error);
    res.status(500).json({ error: 'Contrôle des jetons impossible' });
  }
});
