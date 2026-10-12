//! Statistiques des posts et des pages via l'API Graph (ex-`analytics.ts`).

use chrono::{Duration, NaiveTime};
use serde_json::{json, Value};

use crate::db::{PageAnalyticsHistory, Patch, Platform, PostAnalytics, TokenStatus};
use crate::services::facebook::graph;
use crate::state::AppState;
use crate::time::Ts;

const POST_FIELDS: &str = "insights.metric(post_impressions,post_impressions_unique,post_engaged_users,post_clicks),shares,comments.summary(true),reactions.summary(true)";

/// Codes d'erreur Graph signalant un jeton invalide ou expiré.
const AUTH_ERROR_CODES: [i64; 3] = [190, 463, 467];

/// Métriques d'une publication.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PostMetrics {
    pub impressions: i64,
    pub reach: i64,
    pub engagement: i64,
    pub clicks: i64,
    pub reactions: i64,
    pub comments: i64,
    pub shares: i64,
}

impl PostMetrics {
    fn add(&mut self, other: &PostMetrics) {
        self.impressions += other.impressions;
        self.reach += other.reach;
        self.engagement += other.engagement;
        self.clicks += other.clicks;
        self.reactions += other.reactions;
        self.comments += other.comments;
        self.shares += other.shares;
    }
}

fn number(value: Option<&Value>) -> i64 {
    value.and_then(Value::as_f64).map(|n| n as i64).unwrap_or(0)
}

/// Extrait les métriques de la réponse Graph d'un post.
pub fn parse_post_metrics(result: &Value) -> PostMetrics {
    let insights = result
        .get("insights")
        .and_then(|i| i.get("data"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let metric = |name: &str| {
        insights
            .iter()
            .find(|i| i.get("name").and_then(Value::as_str) == Some(name))
            .map(|m| {
                number(
                    m.get("values")
                        .and_then(|v| v.get(0))
                        .and_then(|v| v.get("value")),
                )
            })
            .unwrap_or(0)
    };
    let summary_count = |key: &str| {
        number(
            result
                .get(key)
                .and_then(|r| r.get("summary"))
                .and_then(|s| s.get("total_count")),
        )
    };

    PostMetrics {
        impressions: metric("post_impressions"),
        reach: metric("post_impressions_unique"),
        engagement: metric("post_engaged_users"),
        clicks: metric("post_clicks"),
        reactions: summary_count("reactions"),
        comments: summary_count("comments"),
        shares: number(result.get("shares").and_then(|s| s.get("count"))),
    }
}

/// Dernière valeur (la plus récente) d'une métrique de page.
pub fn last_insight_value(result: &Value) -> i64 {
    result
        .get("data")
        .and_then(Value::as_array)
        .and_then(|data| data.first())
        .and_then(|first| first.get("values"))
        .and_then(Value::as_array)
        .and_then(|values| values.last())
        .map(|v| number(v.get("value")))
        .unwrap_or(0)
}

fn to_i32(value: i64) -> i32 {
    value.clamp(i32::MIN as i64, i32::MAX as i64) as i32
}

/// Statistiques enregistrées d'un post.
pub async fn get_post_analytics(
    state: &AppState,
    post_id: &str,
) -> Result<Option<PostAnalytics>, sqlx::Error> {
    sqlx::query_as("SELECT * FROM post_analytics WHERE post_id = $1 LIMIT 1")
        .bind(post_id)
        .fetch_optional(&state.db.pool)
        .await
}

/// Historique d'une page : 30 derniers relevés, du plus récent au plus ancien.
pub async fn get_page_history(
    state: &AppState,
    page_id: &str,
) -> Result<Vec<PageAnalyticsHistory>, sqlx::Error> {
    sqlx::query_as(
        "SELECT * FROM page_analytics_history WHERE page_id = $1 ORDER BY date DESC LIMIT 30",
    )
    .bind(page_id)
    .fetch_all(&state.db.pool)
    .await
}

/// Récupère les métriques d'un post sur chaque page où il a été publié et
/// met à jour `post_analytics` (somme des publications).
pub async fn sync_post_analytics(state: &AppState, post_id: &str) -> anyhow::Result<()> {
    tracing::info!("[AnalyticsService] Syncing post {post_id}");

    let published: Vec<_> = state
        .db
        .get_scheduled_posts_by_post(post_id)
        .await?
        .into_iter()
        .filter(|sp| sp.external_post_id.is_some())
        .collect();

    if published.is_empty() {
        tracing::info!("[AnalyticsService] No published external posts found for {post_id}");
        return Ok(());
    }

    let mut totals = PostMetrics::default();
    let mut raw_data = Vec::new();

    for instance in &published {
        let Some(external_id) = instance
            .external_post_id
            .as_deref()
            .filter(|id| !id.is_empty())
        else {
            continue;
        };
        let Some(page) = state.db.get_social_page(&instance.page_id).await? else {
            continue;
        };
        // Les métriques TikTok ne sont pas exposées par la Graph API
        if page.platform == Platform::Tiktok {
            continue;
        }

        match graph::get(
            state,
            external_id,
            Some(&page.access_token),
            &[("fields", POST_FIELDS)],
        )
        .await
        {
            Ok(result) => {
                totals.add(&parse_post_metrics(&result));
                raw_data.push(json!({ "id": external_id, "data": result }));
            }
            Err(error) => {
                tracing::error!(
                    "[AnalyticsService] Failed to fetch for instance {}: {error}",
                    instance.id
                );
            }
        }
    }

    let raw_data = Value::Array(raw_data);
    let existing = get_post_analytics(state, post_id).await?;
    if let Some(existing) = existing {
        sqlx::query(
            r#"UPDATE post_analytics SET fetched_at = $2, impressions = $3, reach = $4, engagement = $5,
               reactions = $6, comments = $7, shares = $8, clicks = $9, raw_data = $10 WHERE id = $1"#,
        )
        .bind(&existing.id)
        .bind(Ts::now())
        .bind(to_i32(totals.impressions))
        .bind(to_i32(totals.reach))
        .bind(to_i32(totals.engagement))
        .bind(to_i32(totals.reactions))
        .bind(to_i32(totals.comments))
        .bind(to_i32(totals.shares))
        .bind(to_i32(totals.clicks))
        .bind(&raw_data)
        .execute(&state.db.pool)
        .await?;
    } else {
        sqlx::query(
            r#"INSERT INTO post_analytics (post_id, fetched_at, impressions, reach, engagement,
               reactions, comments, shares, clicks, raw_data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"#,
        )
        .bind(post_id)
        .bind(Ts::now())
        .bind(to_i32(totals.impressions))
        .bind(to_i32(totals.reach))
        .bind(to_i32(totals.engagement))
        .bind(to_i32(totals.reactions))
        .bind(to_i32(totals.comments))
        .bind(to_i32(totals.shares))
        .bind(to_i32(totals.clicks))
        .bind(&raw_data)
        .execute(&state.db.pool)
        .await?;
    }
    Ok(())
}

/// Début du jour (UTC, l'heure du serveur) et lendemain.
pub fn day_bounds(now: Ts) -> (Ts, Ts) {
    let start = Ts(now.0.date().and_time(NaiveTime::MIN));
    (start, start.add(Duration::days(1)))
}

/// Synchronise les statistiques d'une page (abonnés, portée, engagement,
/// vues). Chaque métrique est récupérée séparément pour plus de résilience.
pub async fn sync_page_analytics(state: &AppState, page_id: &str) -> anyhow::Result<()> {
    tracing::info!("[AnalyticsService] Syncing page {page_id}");

    let Some(page) = state.db.get_social_page(page_id).await? else {
        return Ok(());
    };
    let access_token = page.access_token.as_str();

    // 1. Infos de base (abonnés) — indispensables : un échec signale
    // généralement un jeton invalide, on s'arrête là.
    let mut followers = page.followers_count.unwrap_or(0) as i64;
    match graph::get(
        state,
        &page.page_id,
        Some(access_token),
        &[("fields", "fan_count")],
    )
    .await
    {
        Ok(info) => {
            if let Some(fan_count) = info.get("fan_count").and_then(Value::as_f64) {
                followers = fan_count as i64;
            }
        }
        Err(error) => {
            tracing::error!("[AnalyticsService] Failed to fetch basic info for {page_id}: {error}");
            let preview: String = access_token.chars().take(10).collect();
            tracing::info!("[AnalyticsService] DEBUG: Token used: {preview}...");

            // Erreur d'authentification : jeton marqué expiré, on s'arrête
            if graph::error_code(&error).is_some_and(|code| AUTH_ERROR_CODES.contains(&code)) {
                tracing::info!("[AnalyticsService] Marking token as EXPIRED for page {page_id}");
                state
                    .db
                    .update_social_page(
                        page_id,
                        Patch::new()
                            .set("token_status", TokenStatus::Expired)
                            .set("last_token_check", Ts::now()),
                    )
                    .await?;
                return Ok(());
            }

            anyhow::bail!("Failed to fetch Basic Info: {error}");
        }
    }

    // 2. Chaque métrique de page, indépendamment
    let page_reach = fetch_insight(
        state,
        &page.page_id,
        page_id,
        access_token,
        "page_impressions_unique",
    )
    .await;
    let page_engagement = fetch_insight(
        state,
        &page.page_id,
        page_id,
        access_token,
        "page_post_engagements",
    )
    .await;
    let page_views = fetch_insight(
        state,
        &page.page_id,
        page_id,
        access_token,
        "page_views_total",
    )
    .await;

    tracing::info!(
        "[AnalyticsService] Metrics: followers={followers}, reach={page_reach}, engagement={page_engagement}, views={page_views}"
    );

    // 3. Mise à jour de la page — le statut du jeton se rétablit tout seul
    state
        .db
        .update_social_page(
            page_id,
            Patch::new()
                .set("followers_count", to_i32(followers))
                .set("token_status", TokenStatus::Valid)
                .set("last_token_check", Ts::now()),
        )
        .await?;

    // 4. Relevé historique : un seul par jour et par page
    let (today, tomorrow) = day_bounds(Ts::now());
    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM page_analytics_history WHERE page_id = $1 AND date >= $2 AND date < $3 LIMIT 1",
    )
    .bind(page_id)
    .bind(today)
    .bind(tomorrow)
    .fetch_optional(&state.db.pool)
    .await?;

    if let Some((entry_id,)) = existing {
        sqlx::query(
            r#"UPDATE page_analytics_history SET followers_count = $2, page_reach = $3, page_views = $4,
               page_engagement = $5, date = $6 WHERE id = $1"#,
        )
        .bind(entry_id)
        .bind(to_i32(followers))
        .bind(to_i32(page_reach))
        .bind(to_i32(page_views))
        .bind(to_i32(page_engagement))
        .bind(Ts::now())
        .execute(&state.db.pool)
        .await?;
    } else {
        sqlx::query(
            r#"INSERT INTO page_analytics_history (page_id, date, followers_count, page_reach, page_views, page_engagement)
               VALUES ($1, $2, $3, $4, $5, $6)"#,
        )
        .bind(page_id)
        .bind(Ts::now())
        .bind(to_i32(followers))
        .bind(to_i32(page_reach))
        .bind(to_i32(page_views))
        .bind(to_i32(page_engagement))
        .execute(&state.db.pool)
        .await?;
    }

    tracing::info!(
        "[AnalyticsService] Synced page {page_id}: {followers} followers, {page_reach} reach, {page_engagement} engagement, {page_views} views"
    );
    Ok(())
}

/// Une métrique de page (`period=day`) ; 0 si elle est indisponible.
async fn fetch_insight(
    state: &AppState,
    graph_page_id: &str,
    page_id: &str,
    access_token: &str,
    metric: &str,
) -> i64 {
    let endpoint = format!("{graph_page_id}/insights/{metric}");
    match graph::get(state, &endpoint, Some(access_token), &[("period", "day")]).await {
        Ok(result) => last_insight_value(&result),
        Err(error) => {
            if graph::error_code(&error) == Some(100) {
                tracing::warn!("[AnalyticsService] Metric \"{metric}\" unavailable for {page_id} (Code 100). Skipping.");
            } else {
                tracing::warn!(
                    "[AnalyticsService] Failed to fetch \"{metric}\" for {page_id}: {error}"
                );
            }
            0
        }
    }
}

/// Synchronise les statistiques de toutes les pages (tâche planifiée).
/// Les statistiques passent par la Graph API : les comptes TikTok en sont exclus.
pub async fn sync_all_pages(state: &AppState) -> anyhow::Result<()> {
    tracing::info!("[AnalyticsService] Starting sync for all pages...");
    let pages: Vec<_> = state
        .db
        .get_all_social_pages()
        .await?
        .into_iter()
        .filter(|p| p.platform != Platform::Tiktok)
        .collect();

    for page in &pages {
        if let Err(error) = sync_page_analytics(state, &page.id).await {
            tracing::error!(
                "[AnalyticsService] Failed to sync page {}: {error}",
                page.id
            );
        }
    }

    tracing::info!(
        "[AnalyticsService] Sync complete for {} pages.",
        pages.len()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn post_metrics_are_extracted() {
        let result = json!({
            "insights": { "data": [
                { "name": "post_impressions", "values": [{ "value": 120 }] },
                { "name": "post_impressions_unique", "values": [{ "value": 80 }] },
                { "name": "post_engaged_users", "values": [] },
                { "name": "post_clicks", "values": [{ "value": { "link clicks": 3 } }] }
            ]},
            "shares": { "count": 4 },
            "comments": { "summary": { "total_count": 5 } },
            "reactions": { "summary": { "total_count": 9 } }
        });
        assert_eq!(
            parse_post_metrics(&result),
            PostMetrics {
                impressions: 120,
                reach: 80,
                engagement: 0,
                clicks: 0,
                reactions: 9,
                comments: 5,
                shares: 4
            }
        );
        assert_eq!(parse_post_metrics(&json!({})), PostMetrics::default());
    }

    #[test]
    fn last_value_of_page_insight() {
        let result = json!({ "data": [{ "values": [{ "value": 1 }, { "value": 7 }] }] });
        assert_eq!(last_insight_value(&result), 7);
        assert_eq!(last_insight_value(&json!({ "data": [] })), 0);
        assert_eq!(
            last_insight_value(&json!({ "data": [{ "values": [] }] })),
            0
        );
    }

    #[test]
    fn day_bounds_are_utc_midnight() {
        let (start, end) = day_bounds(Ts::parse("2026-10-12T17:45:12Z").unwrap());
        assert_eq!(start.to_iso(), "2026-10-12T00:00:00.000Z");
        assert_eq!(end.to_iso(), "2026-10-13T00:00:00.000Z");
    }
}
