import cron from 'node-cron';
import { TokenManager } from './services/token_manager';
import { AnalyticsService } from './services/analytics';

export function startTokenCron() {
    // Run every day at midnight (00:00) — Token health check
    cron.schedule('0 0 * * *', async () => {
        console.log('[Cron] Running daily token check...');
        await TokenManager.checkAndRefreshTokens();
    });
    console.log('[Cron] Token refresh job scheduled (0 0 * * *).');

    // Run every 6 hours — Analytics sync for all pages
    cron.schedule('0 */6 * * *', async () => {
        console.log('[Cron] Running analytics sync for all pages...');
        try {
            await AnalyticsService.syncAllPages();
        } catch (error) {
            console.error('[Cron] Analytics sync failed:', error);
        }
    });
    console.log('[Cron] Analytics sync job scheduled (0 */6 * * *).');
}
