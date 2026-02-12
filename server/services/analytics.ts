import { db } from '../db';
import {
    posts,
    scheduledPosts,
    postAnalytics,
    pageAnalyticsHistory,
    socialPages,
    tokenStatusEnum
} from '../../shared/schema';
import { eq, and, isNotNull, desc, gte, lt } from 'drizzle-orm';
import { GraphAPIClient } from '../utils/graph_client';
import { TokenManager } from './token_manager';

export class AnalyticsService {

    /**
     * Fetches latest metrics for a specific post from Facebook/Instagram
     * and updates the local postAnalytics table.
     * Handles aggregation if a single Post content was published to multiple destinations.
     */
    static async syncPostAnalytics(postId: string) {
        console.log(`[AnalyticsService] Syncing post ${postId}`);

        // Find all published instances of this post with an external ID
        const publishedInstances = await db.query.scheduledPosts.findMany({
            where: and(
                eq(scheduledPosts.postId, postId),
                isNotNull(scheduledPosts.externalPostId)
            ),
            with: {
                page: true
            }
        });

        if (publishedInstances.length === 0) {
            console.log(`[AnalyticsService] No published external posts found for ${postId}`);
            return;
        }

        let totalImpressions = 0;
        let totalReach = 0;
        let totalEngagement = 0;
        let totalReactions = 0;
        let totalComments = 0;
        let totalShares = 0;
        let totalClicks = 0;
        const rawDataList: any[] = [];

        for (const instance of publishedInstances) {
            if (!instance.externalPostId || !instance.page) continue;

            try {
                // We need the page access token
                let accessToken = instance.page.accessToken;
                // Decrypt if needed
                if (accessToken.includes(':')) {
                    try { accessToken = TokenManager.decrypt(accessToken); } catch { }
                }

                // Determine fields based on platform (assuming Facbeook for now as per context)
                // providing a generic list of fields
                const fields = 'insights.metric(post_impressions,post_impressions_unique,post_engaged_users,post_clicks),shares,comments.summary(true),reactions.summary(true)';

                const result = await GraphAPIClient.get<any>(instance.externalPostId, {
                    accessToken,
                    params: { fields }
                });

                rawDataList.push({ id: instance.externalPostId, data: result });

                // Parse Metrics
                // Note: Graph API structure for insights is complex (data array).
                // For simplicity in this implementation, we will try to extract what we can.
                // This is a simplified mapper.

                const insights = result.insights?.data || [];
                const findMetric = (name: string) => {
                    const m = insights.find((i: any) => i.name === name);
                    return m ? (m.values[0]?.value || 0) : 0;
                };

                const impressions = findMetric('post_impressions');
                const reach = findMetric('post_impressions_unique');
                const engagement = findMetric('post_engaged_users');
                const clicks = findMetric('post_clicks'); // might be 'post_clicks_by_type'

                const reactionCount = result.reactions?.summary?.total_count || 0;
                const commentCount = result.comments?.summary?.total_count || 0;
                const shareCount = result.shares?.count || 0;

                totalImpressions += impressions;
                totalReach += reach;
                totalEngagement += engagement;
                totalClicks += clicks; // Aggregation might be complex for unique values, but sum is okay for now
                totalReactions += reactionCount;
                totalComments += commentCount;
                totalShares += shareCount;

            } catch (error) {
                console.error(`[AnalyticsService] Failed to fetch for instance ${instance.id}:`, error);
            }
        }

        // Update DB
        // Check if exists
        const existing = await db.query.postAnalytics.findFirst({
            where: eq(postAnalytics.postId, postId)
        });

        if (existing) {
            await db.update(postAnalytics)
                .set({
                    fetchedAt: new Date(),
                    impressions: totalImpressions,
                    reach: totalReach,
                    engagement: totalEngagement,
                    reactions: totalReactions,
                    comments: totalComments,
                    shares: totalShares,
                    clicks: totalClicks,
                    rawData: rawDataList
                })
                .where(eq(postAnalytics.id, existing.id));
        } else {
            await db.insert(postAnalytics).values({
                postId,
                fetchedAt: new Date(),
                impressions: totalImpressions,
                reach: totalReach,
                engagement: totalEngagement,
                reactions: totalReactions,
                comments: totalComments,
                shares: totalShares,
                clicks: totalClicks,
                rawData: rawDataList
            });
        }
    }

    /**
     * Syncs page-level analytics (Followers, Reach, Engagement, Views)
     * Each metric is fetched independently for maximum resilience.
     */
    static async syncPageAnalytics(pageId: string) {
        console.log(`[AnalyticsService] Syncing page ${pageId}`);

        const page = await db.query.socialPages.findFirst({
            where: eq(socialPages.id, pageId)
        });

        if (!page) return;

        let accessToken = page.accessToken;
        if (accessToken.includes(':')) {
            try { accessToken = TokenManager.decrypt(accessToken); } catch { }
        }

        // 1. Fetch Basic Page Info (Followers/Fans) — Essential
        // If this fails, the token is likely invalid → abort
        let followers = page.followersCount || 0;
        try {
            const basicInfo = await GraphAPIClient.get<any>(page.pageId, {
                accessToken,
                params: { fields: 'fan_count' }
            });
            if (basicInfo.fan_count !== undefined) {
                followers = basicInfo.fan_count;
            }
        } catch (error: any) {
            console.error(`[AnalyticsService] Failed to fetch basic info for ${pageId}:`, error);

            const tokenPreview = accessToken ? `${accessToken.substring(0, 10)}...` : 'undefined';
            console.log(`[AnalyticsService] DEBUG: Token used: ${tokenPreview}`);

            // Auth errors → mark token as expired and abort
            if (error.code === 190 || error.code === 463 || error.code === 467) {
                console.log(`[AnalyticsService] Marking token as EXPIRED for page ${pageId}`);
                await db.update(socialPages)
                    .set({
                        tokenStatus: "expired",
                        lastTokenCheck: new Date()
                    })
                    .where(eq(socialPages.id, pageId));
                return;
            }

            throw new Error(`Failed to fetch Basic Info: ${error.message || error}`);
        }

        // Helper: fetch a single page insight metric safely
        const fetchInsight = async (metricName: string): Promise<number> => {
            try {
                const result = await GraphAPIClient.get<any>(
                    `${page.pageId}/insights/${metricName}`,
                    {
                        accessToken,
                        params: { period: 'day' }
                    }
                );
                const data = result.data || [];
                if (data.length > 0) {
                    const values = data[0].values || [];
                    // Take the most recent value (last entry = yesterday)
                    return values.length > 0
                        ? (values[values.length - 1]?.value || 0)
                        : 0;
                }
                return 0;
            } catch (error: any) {
                if (error.code === 100) {
                    console.warn(`[AnalyticsService] Metric "${metricName}" unavailable for ${pageId} (Code 100). Skipping.`);
                } else {
                    console.warn(`[AnalyticsService] Failed to fetch "${metricName}" for ${pageId}:`, error.message || error);
                }
                return 0;
            }
        };

        // 2. Fetch each insight independently (resilient)
        const pageReach = await fetchInsight('page_impressions_unique');
        const pageEngagement = await fetchInsight('page_post_engagements');
        const pageViews = await fetchInsight('page_views_total');

        console.log(`[AnalyticsService] Metrics: followers=${followers}, reach=${pageReach}, engagement=${pageEngagement}, views=${pageViews}`);

        // 3. Update Page — auto-heal token status
        await db.update(socialPages)
            .set({
                followersCount: followers,
                tokenStatus: 'valid',
                lastTokenCheck: new Date()
            })
            .where(eq(socialPages.id, pageId));

        // 4. Upsert History snapshot — one entry per day per page
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const existingEntry = await db.query.pageAnalyticsHistory.findFirst({
            where: and(
                eq(pageAnalyticsHistory.pageId, pageId),
                gte(pageAnalyticsHistory.date, today),
                lt(pageAnalyticsHistory.date, tomorrow)
            )
        });

        if (existingEntry) {
            // Update today's existing entry with latest values
            await db.update(pageAnalyticsHistory)
                .set({
                    followersCount: followers,
                    pageReach,
                    pageViews,
                    pageEngagement,
                    date: new Date(),
                })
                .where(eq(pageAnalyticsHistory.id, existingEntry.id));
        } else {
            // Insert new entry for today
            await db.insert(pageAnalyticsHistory).values({
                pageId,
                date: new Date(),
                followersCount: followers,
                pageReach,
                pageViews,
                pageEngagement,
            });
        }

        console.log(`[AnalyticsService] Synced page ${pageId}: ${followers} followers, ${pageReach} reach, ${pageEngagement} engagement, ${pageViews} views`);
    }

    /**
     * Syncs analytics for ALL active pages.
     * Called by the CRON job.
     */
    static async syncAllPages(): Promise<void> {
        console.log('[AnalyticsService] Starting sync for all pages...');
        const allPages = await db.query.socialPages.findMany();

        for (const page of allPages) {
            try {
                await this.syncPageAnalytics(page.id);
            } catch (error: any) {
                console.error(`[AnalyticsService] Failed to sync page ${page.id}:`, error.message);
            }
        }

        console.log(`[AnalyticsService] Sync complete for ${allPages.length} pages.`);
    }
}
