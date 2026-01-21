import { db } from '../db';
import {
    posts,
    scheduledPosts,
    postAnalytics,
    pageAnalyticsHistory,
    socialPages,
    tokenStatusEnum
} from '../../shared/schema';
import { eq, and, isNotNull, desc } from 'drizzle-orm';
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
     * Syncs page-level analytics (Followers, Reach, etc.)
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

        // 1. Fetch Basic Page Info (Followers/Fans) - Essential
        // If this fails, the whole sync fails (because token might be bad)
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

            // Check if it's an Auth Error (Token invalid/expired)
            // Codes: 190 (Invalid OAuth), 102 (API Session), 10 (Permission), 463 (Expired), 467 (Invalid)
            if (error.code === 190 || error.code === 463 || error.code === 467) {
                console.log(`[AnalyticsService] Marking token as EXPIRED for page ${pageId}`);
                await db.update(socialPages)
                    .set({
                        tokenStatus: "expired",
                        lastTokenCheck: new Date()
                    })
                    .where(eq(socialPages.id, pageId));

                // Return gracefully so the UI sees the updated status
                return;
            }

            throw new Error(`Failed to fetch Basic Info: ${error.message || error}`);
        }

        // 2. Fetch Insights (Reach, Engagement) - Optional/Secondary
        // If this fails, we catch it but still save the follower count
        let pageReach = 0;
        let pageViews = 0;

        try {
            const fields = 'insights.metric(page_impressions,page_post_engagements).period(day)';
            const result = await GraphAPIClient.get<any>(page.pageId, {
                accessToken,
                params: { fields }
            });

            const insights = result.insights?.data || [];
            const findMetric = (name: string) => {
                const m = insights.find((i: any) => i.name === name);
                // period(day) returns values array. We take the latest (yesterday usually)
                return m ? (m.values[m.values.length - 1]?.value || 0) : 0;
            };

            pageReach = findMetric('page_impressions');
        } catch (error) {
            console.warn(`[AnalyticsService] Failed to fetch insights for ${pageId} (Permissions?):`, error);
            // Continue execution to save at least the follower count
        }

        // Update Page
        await db.update(socialPages)
            .set({ followersCount: followers })
            .where(eq(socialPages.id, pageId));

        // Insert History
        await db.insert(pageAnalyticsHistory).values({
            pageId,
            date: new Date(),
            followersCount: followers,
            pageReach,
            pageViews
        });

        console.log(`[AnalyticsService] Synced page ${pageId}: ${followers} followers, ${pageReach} reach`);

    }
}
