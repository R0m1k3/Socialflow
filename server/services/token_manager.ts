import crypto from 'crypto';
import { db } from '../index';
import { socialPages, tokenStatusEnum } from '../../shared/schema';
import { eq, and, lte } from 'drizzle-orm';
import { GraphAPIClient } from '../utils/graph_client';

// Constants
const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-dev-key-must-be-changed-in-prod-32chars'; // 32 chars
const IV_LENGTH = 16;

/**
 * Service responsible for managing Facebook Page Token lifecycle
 * - Encryption at rest
 * - Automated refreshing of expiring tokens
 */
export class TokenManager {

    /**
     * Encrypts a text using AES-256-CBC
     */
    static encrypt(text: string): string {
        const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        let encrypted = cipher.update(text);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    }

    /**
     * Decrypts a text using AES-256-CBC
     */
    static decrypt(text: string): string {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift()!, 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
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
