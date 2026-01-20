import cron from 'node-cron';
import { TokenManager } from './services/token_manager';

export function startTokenCron() {
    // Run every day at midnight (00:00)
    cron.schedule('0 0 * * *', async () => {
        console.log('[Cron] Running daily token check...');
        await TokenManager.checkAndRefreshTokens();
    });
    console.log('[Cron] Token refresh job scheduled (0 0 * * *).');
}
