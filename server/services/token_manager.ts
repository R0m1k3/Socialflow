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
