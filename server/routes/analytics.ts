import { Router } from 'express';
import { db } from '../db';
import { AnalyticsService } from '../services/analytics';
import { TokenManager } from '../services/token_manager';
import { postAnalytics, pageAnalyticsHistory, socialPages } from '../../shared/schema';
import { eq, desc } from 'drizzle-orm';

const router = Router();

// Get Post Analytics
router.get('/posts/:postId', async (req, res) => {
    try {
        const { postId } = req.params;
        const analytics = await db.query.postAnalytics.findFirst({
            where: eq(postAnalytics.postId, postId)
        });
        res.json(analytics || {});
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch post analytics' });
    }
});

// Refresh Post Analytics
router.post('/posts/:postId/refresh', async (req, res) => {
    try {
        const { postId } = req.params;
        await AnalyticsService.syncPostAnalytics(postId);
        const updated = await db.query.postAnalytics.findFirst({
            where: eq(postAnalytics.postId, postId)
        });
        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: 'Failed to refresh post analytics' });
    }
});

// Get Page Analytics History
router.get('/pages/:pageId/history', async (req, res) => {
    try {
        const { pageId } = req.params;
        const history = await db.query.pageAnalyticsHistory.findMany({
            where: eq(pageAnalyticsHistory.pageId, pageId),
            orderBy: [desc(pageAnalyticsHistory.date)],
            limit: 30 // Last 30 entries
        });
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch page history' });
    }
});

// Refresh Page Analytics
router.post('/pages/:pageId/refresh', async (req, res) => {
    try {
        const { pageId } = req.params;
        await AnalyticsService.syncPageAnalytics(pageId);

        const page = await db.query.socialPages.findFirst({
            where: eq(socialPages.id, pageId)
        });
        res.json(page);
    } catch (error) {
        res.status(500).json({ error: 'Failed to refresh page analytics' });
    }
});

// Manual Token Check Trigger
router.post('/tokens/check', async (req, res) => {
    try {
        // This runs in background, but we can await it for manual trigger
        await TokenManager.checkAndRefreshTokens();
        res.json({ success: true, message: 'Token check completed' });
    } catch (error) {
        res.status(500).json({ error: 'Token check failed' });
    }
});

export const analyticsRouter = router;
