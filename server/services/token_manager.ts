// crypto removed, using shared encryption utility
import { db } from '../db';
import { socialPages } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { GraphAPIClient } from '../utils/graph_client';
import type { SocialPage } from '../../shared/schema';

import { encrypt, decrypt } from '../utils/encryption';
import { facebookOAuthService, FacebookAuthError } from './facebook_oauth';

/**
 * Un jeton dont l'échéance est plus proche que cette fenêtre est renouvelé
 * sans attendre : il reste largement le temps de réessayer les jours suivants
 * si Facebook est indisponible au moment du contrôle.
 */
const RENEWAL_WINDOW_MS = 15 * 24 * 60 * 60 * 1000;

/** En deçà de cette marge, un jeton non renouvelable est signalé « expiring ». */
const WARNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface TokenCheckResult {
    pageId: string;
    pageName: string;
    status: 'valid' | 'expiring' | 'expired' | 'error';
    /** Vrai quand ce passage a effectivement réécrit un nouveau jeton. */
    renewed: boolean;
    error?: string;
}

/**
 * Service responsible for managing Facebook Page Token lifecycle
 * - Encryption at rest
 * - Automated refreshing of expiring tokens
 */
export class TokenManager {

    /**
     * Encrypts a text using shared encryption utility
     */
    static encrypt(text: string): string {
        return encrypt(text);
    }

    /**
     * Decrypts a text using shared encryption utility
     */
    static decrypt(text: string): string {
        return decrypt(text);
    }

    /**
     * Checks all active pages for expiring tokens and refreshes them if needed.
     */
    static async checkAndRefreshTokens(): Promise<TokenCheckResult[]> {
        console.log('[TokenManager] Starting daily token check...');
        const results: TokenCheckResult[] = [];

        try {
            // Fetch active pages
            const pages = await db.query.socialPages.findMany({
                where: eq(socialPages.isActive, "true")
            });

            for (const page of pages) {
                try {
                    results.push(await this.processPageToken(page));
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.error(`[TokenManager] Error processing page ${page.pageName} (${page.id}):`, error);
                    await this.persistStatus(page.id, 'error', message);
                    results.push({
                        pageId: page.id,
                        pageName: page.pageName,
                        status: 'error',
                        renewed: false,
                        error: message,
                    });
                }
            }

            console.log('[TokenManager] Finished token check.');
        } catch (e) {
            console.error('[TokenManager] Critical error in checkAndRefreshTokens:', e);
        }

        return results;
    }

    /** Contrôle (et renouvellement) d'une seule page, déclenché depuis l'UI. */
    static async checkPage(pageId: string): Promise<TokenCheckResult> {
        const [page] = await db.select().from(socialPages).where(eq(socialPages.id, pageId));
        if (!page) {
            throw new Error('Page introuvable');
        }
        return this.processPageToken(page);
    }

    private static async processPageToken(page: SocialPage): Promise<TokenCheckResult> {
        // Les comptes TikTok ont leur propre cycle de vie : l'access token ne dure
        // que 24h et se renouvelle avec le refresh token, pas via la Graph API.
        if (page.platform === 'tiktok') {
            return await this.processTiktokToken(page);
        }

        console.log(`[TokenManager] Checking page: ${page.pageName}`);

        const accessToken = this.readToken(page.accessToken);

        // Sans application Facebook configurée, on ne peut ni interroger
        // /debug_token ni régénérer quoi que ce soit : on se rabat sur le
        // contrôle historique (le jeton répond-il encore ?).
        if (!(await facebookOAuthService.isConfigured())) {
            return this.legacyCheck(page, accessToken);
        }

        let info;
        try {
            info = await facebookOAuthService.inspectToken(accessToken);
        } catch (error) {
            // Facebook injoignable : on ne dégrade pas le statut sur un incident
            // réseau, sinon toute l'UI passerait au rouge le temps d'une panne.
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[TokenManager] Inspection impossible pour ${page.pageName}: ${message}`);
            return this.legacyCheck(page, accessToken);
        }

        const expiresAt = info.expiresAt;
        const expiringSoon =
            expiresAt !== null && expiresAt.getTime() - Date.now() < RENEWAL_WINDOW_MS;

        if (info.isValid && !expiringSoon) {
            // Le jeton de page tient : on en profite pour prolonger le jeton
            // utilisateur s'il approche de son échéance, car c'est lui qui
            // permettra le prochain renouvellement.
            await this.extendUserTokenIfNeeded(page);
            await this.persistStatus(page.id, 'valid', null, { tokenExpiresAt: expiresAt });
            return { pageId: page.id, pageName: page.pageName, status: 'valid', renewed: false };
        }

        const reason = info.isValid
            ? `Le jeton expire le ${expiresAt?.toLocaleDateString('fr-FR')}`
            : info.error || 'Le jeton a été invalidé par Facebook';
        console.warn(`[TokenManager] ${page.pageName}: ${reason} — tentative de renouvellement`);

        // Renouvellement automatique : c'est tout l'intérêt d'avoir conservé le
        // jeton utilisateur longue durée au moment de la connexion OAuth.
        try {
            const renewed = await this.renewFromUserToken(page);
            if (renewed) {
                console.log(`[TokenManager] Jeton renouvelé automatiquement pour ${page.pageName}`);
                return { pageId: page.id, pageName: page.pageName, status: 'valid', renewed: true };
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[TokenManager] Renouvellement impossible pour ${page.pageName}: ${message}`);
            await this.persistStatus(page.id, info.isValid ? 'expiring' : 'expired', message, {
                tokenExpiresAt: expiresAt,
            });
            return {
                pageId: page.id,
                pageName: page.pageName,
                status: info.isValid ? 'expiring' : 'expired',
                renewed: false,
                error: message,
            };
        }

        // Pas de jeton utilisateur en base : la page a été ajoutée à la main,
        // seule une reconnexion peut la remettre d'aplomb.
        const manual =
            `${reason}. Reconnectez la page via « Connecter des pages Facebook » ` +
            'pour activer le renouvellement automatique.';
        const status = info.isValid ? 'expiring' : 'expired';
        await this.persistStatus(page.id, status, manual, { tokenExpiresAt: expiresAt });
        return { pageId: page.id, pageName: page.pageName, status, renewed: false, error: manual };
    }

    /**
     * Régénère le jeton de page à partir du jeton utilisateur longue durée.
     * Renvoie false quand la page n'a pas de jeton utilisateur enregistré.
     */
    private static async renewFromUserToken(page: SocialPage): Promise<boolean> {
        if (!page.userAccessToken) return false;

        const storedUserToken = this.readToken(page.userAccessToken);

        // On prolonge d'abord le jeton utilisateur : le ré-échanger repart pour
        // ~60 jours, ce qui repousse d'autant la prochaine reconnexion manuelle.
        // Un échec ici n'est pas bloquant tant que le jeton actuel fonctionne.
        let userToken = storedUserToken;
        let userTokenExpiresAt = page.userTokenExpiresAt ?? null;
        try {
            const extended = await facebookOAuthService.extendUserToken(storedUserToken);
            userToken = extended.accessToken;
            userTokenExpiresAt = extended.expiresAt;
        } catch (error) {
            console.warn(
                `[TokenManager] Prolongation du jeton utilisateur impossible pour ${page.pageName}:`,
                error instanceof Error ? error.message : error
            );
        }

        const targets = await facebookOAuthService.listPages(userToken);
        // Une page Instagram est publiée avec le jeton de la page Facebook à
        // laquelle son compte professionnel est rattaché.
        const match = targets.find(
            (target) => target.id === page.pageId || target.instagram?.id === page.pageId
        );

        if (!match) {
            throw new FacebookAuthError(
                `La page « ${page.pageName} » n'est plus administrée par le compte Facebook connecté. ` +
                'Reconnectez-la avec un compte administrateur de cette page.'
            );
        }

        // Un jeton de page dérivé d'un jeton utilisateur longue durée n'expire
        // pas : `expiresAt` reste donc généralement nul.
        let pageTokenExpiresAt: Date | null = null;
        try {
            pageTokenExpiresAt = (await facebookOAuthService.inspectToken(match.accessToken)).expiresAt;
        } catch {
            // L'inspection est un confort : le jeton fraîchement émis est bon.
        }

        await db.update(socialPages)
            .set({
                accessToken: match.accessToken,
                tokenExpiresAt: pageTokenExpiresAt,
                userAccessToken: encrypt(userToken),
                userTokenExpiresAt,
                followersCount: match.followersCount || page.followersCount,
                tokenStatus: 'valid',
                tokenError: null,
                lastTokenCheck: new Date(),
            })
            .where(eq(socialPages.id, page.id));

        return true;
    }

    /**
     * Prolonge le jeton utilisateur quand son échéance approche, même si le
     * jeton de page se porte bien : c'est ce qui évite de perdre la capacité de
     * renouveler le jour où le jeton de page est révoqué.
     */
    private static async extendUserTokenIfNeeded(page: SocialPage): Promise<void> {
        if (!page.userAccessToken) return;

        const expiresAt = page.userTokenExpiresAt ? new Date(page.userTokenExpiresAt).getTime() : null;
        if (expiresAt !== null && expiresAt - Date.now() > RENEWAL_WINDOW_MS) return;

        try {
            const extended = await facebookOAuthService.extendUserToken(this.readToken(page.userAccessToken));
            await db.update(socialPages)
                .set({
                    userAccessToken: encrypt(extended.accessToken),
                    userTokenExpiresAt: extended.expiresAt,
                })
                .where(eq(socialPages.id, page.id));
            console.log(`[TokenManager] Jeton utilisateur prolongé pour ${page.pageName}`);
        } catch (error) {
            console.warn(
                `[TokenManager] Impossible de prolonger le jeton utilisateur de ${page.pageName}:`,
                error instanceof Error ? error.message : error
            );
        }
    }

    /**
     * Contrôle historique, utilisé quand l'application Facebook n'est pas
     * configurée : on sait seulement si le jeton répond encore.
     */
    private static async legacyCheck(page: SocialPage, accessToken: string): Promise<TokenCheckResult> {
        const isValid = await this.verifyToken(accessToken);

        if (!isValid) {
            const error =
                "Le jeton n'est plus accepté par Facebook. Configurez l'application Facebook " +
                'dans les paramètres pour activer le renouvellement automatique, ou saisissez un nouveau jeton.';
            await this.persistStatus(page.id, 'expired', error);
            return { pageId: page.id, pageName: page.pageName, status: 'expired', renewed: false, error };
        }

        // Le jeton répond : reste l'échéance déclarée à l'ajout de la page.
        const declared = page.tokenExpiresAt ? new Date(page.tokenExpiresAt).getTime() : null;
        const status = declared !== null && declared - Date.now() < WARNING_WINDOW_MS ? 'expiring' : 'valid';
        await this.persistStatus(page.id, status, null);
        return { pageId: page.id, pageName: page.pageName, status, renewed: false };
    }

    /**
     * Vérifie qu'un compte TikTok est toujours utilisable.
     * On ne teste pas l'access token (il est renouvelé à la demande avant chaque
     * publication) mais le refresh token, dont l'expiration déconnecterait le compte.
     */
    private static async processTiktokToken(page: SocialPage): Promise<TokenCheckResult> {
        console.log(`[TokenManager] Checking TikTok account: ${page.pageName}`);

        const refreshExpiresAt = page.refreshTokenExpiresAt
            ? new Date(page.refreshTokenExpiresAt).getTime()
            : 0;

        let status: "valid" | "expiring" | "expired" = "valid";
        let error: string | null = null;

        if (!page.refreshToken || (refreshExpiresAt && refreshExpiresAt <= Date.now())) {
            status = "expired";
            error = "L'autorisation TikTok a expiré : reconnectez le compte.";
            console.warn(`[TokenManager] TikTok account ${page.pageName} must be reconnected`);
        } else if (refreshExpiresAt && refreshExpiresAt - Date.now() < 30 * 24 * 60 * 60 * 1000) {
            // Moins de 30 jours de validité restante
            status = "expiring";
        }

        await this.persistStatus(page.id, status, error);
        return { pageId: page.id, pageName: page.pageName, status, renewed: false, error: error ?? undefined };
    }

    private static async persistStatus(
        pageId: string,
        status: 'valid' | 'expiring' | 'expired' | 'error',
        error: string | null,
        extra: { tokenExpiresAt?: Date | null } = {}
    ): Promise<void> {
        await db.update(socialPages)
            .set({
                tokenStatus: status,
                tokenError: error,
                lastTokenCheck: new Date(),
                ...(extra.tokenExpiresAt !== undefined ? { tokenExpiresAt: extra.tokenExpiresAt } : {}),
            })
            .where(eq(socialPages.id, pageId));
    }

    /**
     * Les jetons ont pu être enregistrés en clair (saisie manuelle) ou chiffrés
     * (flux OAuth) : `decrypt` renvoie le texte tel quel s'il n'est pas chiffré.
     */
    private static readToken(token: string): string {
        try {
            return this.decrypt(token);
        } catch {
            return token;
        }
    }

    private static async verifyToken(token: string): Promise<boolean> {
        try {
            // Simple validation check: Get 'me' (page profile)
            await GraphAPIClient.get('me', { accessToken: token });
            return true;
        } catch (error) {
            console.error('[TokenManager] Token verification failed:', error);
            return false;
        }
    }
}
