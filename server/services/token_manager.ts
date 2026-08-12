// crypto removed, using shared encryption utility
import { db } from '../db';
import { socialPages, tokenStatusEnum } from '../../shared/schema';
import { eq, and, lte } from 'drizzle-orm';
import { GraphAPIClient } from '../utils/graph_client';

import { encrypt, decrypt } from '../utils/encryption';

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
    static async checkAndRefreshTokens() {
        console.log('[TokenManager] Starting daily token check...');

        try {
            // Fetch active pages
            const pages = await db.query.socialPages.findMany({
                where: eq(socialPages.isActive, "true")
            });

            for (const page of pages) {
                try {
                    await this.processPageToken(page);
                } catch (error) {
                    console.error(`[TokenManager] Error processing page ${page.pageName} (${page.id}):`, error);
                    await db.update(socialPages)
                        .set({
                            tokenStatus: "error",
                            lastTokenCheck: new Date()
                        })
                        .where(eq(socialPages.id, page.id));
                }
            }

            console.log('[TokenManager] Finished token check.');
        } catch (e) {
            console.error('[TokenManager] Critical error in checkAndRefreshTokens:', e);
        }
    }

    private static async processPageToken(page: any) {
        // Les comptes TikTok ont leur propre cycle de vie : l'access token ne dure
        // que 24h et se renouvelle avec le refresh token, pas via la Graph API.
        if (page.platform === 'tiktok') {
            return await this.processTiktokToken(page);
        }

        let accessToken = page.accessToken;

        // Attempt to decrypt. If fails, assume it's plain text (migration phase)
        try {
            if (accessToken.includes(':')) {
                accessToken = this.decrypt(accessToken);
            }
        } catch (e) {
            // Not encrypted or format error, proceed with original
        }

        console.log(`[TokenManager] Checking page: ${page.pageName}`);

        const isValid = await this.verifyToken(accessToken);

        if (isValid) {
            await db.update(socialPages)
                .set({
                    tokenStatus: "valid",
                    lastTokenCheck: new Date()
                })
                .where(eq(socialPages.id, page.id));
        } else {
            await db.update(socialPages)
                .set({
                    tokenStatus: "expired",
                    lastTokenCheck: new Date()
                })
                .where(eq(socialPages.id, page.id));
            console.warn(`[TokenManager] Token expired for ${page.pageName}`);
        }
    }

    /**
     * Vérifie qu'un compte TikTok est toujours utilisable.
     * On ne teste pas l'access token (il est renouvelé à la demande avant chaque
     * publication) mais le refresh token, dont l'expiration déconnecterait le compte.
     */
    private static async processTiktokToken(page: any) {
        console.log(`[TokenManager] Checking TikTok account: ${page.pageName}`);

        const refreshExpiresAt = page.refreshTokenExpiresAt
            ? new Date(page.refreshTokenExpiresAt).getTime()
            : 0;

        let status: "valid" | "expiring" | "expired" = "valid";

        if (!page.refreshToken || (refreshExpiresAt && refreshExpiresAt <= Date.now())) {
            status = "expired";
            console.warn(`[TokenManager] TikTok account ${page.pageName} must be reconnected`);
        } else if (refreshExpiresAt && refreshExpiresAt - Date.now() < 30 * 24 * 60 * 60 * 1000) {
            // Moins de 30 jours de validité restante
            status = "expiring";
        }

        await db.update(socialPages)
            .set({
                tokenStatus: status,
                lastTokenCheck: new Date()
            })
            .where(eq(socialPages.id, page.id));
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
