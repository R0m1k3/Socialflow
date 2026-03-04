import cron from 'node-cron';
import { TokenManager } from './services/token_manager';
import { AnalyticsService } from './services/analytics';
import { purgeOldMedia } from './services/media-purge';

export function startTokenCron() {
    // Run every day at midnight (00:00) — Token health check
    cron.schedule('0 0 * * *', async () => {
        console.log('[Cron] Running daily token check...');
        await TokenManager.checkAndRefreshTokens();
    });
    console.log('[Cron] Token refresh job scheduled (0 0 * * *).');

    // Run twice daily (08:00 and 20:00) — Analytics sync for all pages
    cron.schedule('0 8,20 * * *', async () => {
        console.log('[Cron] Running analytics sync for all pages...');
        try {
            await AnalyticsService.syncAllPages();
        } catch (error) {
            console.error('[Cron] Analytics sync failed:', error);
        }
    });
    console.log('[Cron] Analytics sync job scheduled (0 8,20 * * *).');

    // Run every day at 03:00 AM — Cleanup old media from Cloudinary and DB
    cron.schedule('0 3 * * *', async () => {
        console.log('[Cron] Running daily media purge check...');
        try {
            await purgeOldMedia();
        } catch (error) {
            console.error('[Cron] Media purge check failed:', error);
        }
    });
    console.log('[Cron] Media purge job scheduled (0 3 * * *).');
}
