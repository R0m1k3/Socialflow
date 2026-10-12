//! Compteurs du tableau de bord.

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime};
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::{ApiResult, OrApiError};
use crate::state::AppState;
use crate::time::Ts;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/stats", get(stats))
}

async fn stats(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    let now = Ts::now();
    let (yesterday_start, yesterday_end, last_month) = periods(now.0);
    let stats = state
        .db
        .get_dashboard_stats(
            &user.id,
            Ts(yesterday_start),
            Ts(yesterday_end),
            Ts(last_month),
        )
        .await
        .or_500("Failed to fetch stats")?;

    let ai_change = change_percent(stats.ai_texts_generated, stats.ai_texts_yesterday);
    let scheduled_change = change_percent(stats.scheduled_posts, stats.scheduled_posts_last_month);

    Ok(Json(json!({
        "scheduledPosts": stats.scheduled_posts,
        "scheduledPostsChange": format_change(scheduled_change),
        "scheduledPostsTrending": if scheduled_change >= 0 { "up" } else { "down" },
        "connectedPages": stats.connected_pages,
        "aiTextsGenerated": stats.ai_texts_generated,
        "aiTextsChange": format_change(ai_change),
        "aiTextsTrending": if ai_change >= 0 { "up" } else { "down" },
        "mediaStored": stats.media_stored,
    })))
}

/// Début d'hier, début d'aujourd'hui (minuit UTC, l'heure du conteneur) et
/// même instant le mois dernier (`setMonth(getMonth() - 1)`).
fn periods(now: NaiveDateTime) -> (NaiveDateTime, NaiveDateTime, NaiveDateTime) {
    let yesterday = (now - Duration::days(1))
        .date()
        .and_hms_opt(0, 0, 0)
        .unwrap_or(now);
    let today = yesterday + Duration::days(1);
    (yesterday, today, previous_month(now))
}

/// `Date.setMonth(mois - 1)` : un jour qui n'existe pas déborde sur le mois
/// suivant (31 mars → 3 mars, ou 2 mars une année bissextile).
fn previous_month(now: NaiveDateTime) -> NaiveDateTime {
    let (year, month) = if now.month() == 1 {
        (now.year() - 1, 12)
    } else {
        (now.year(), now.month() - 1)
    };
    let first = NaiveDate::from_ymd_opt(year, month, 1).unwrap_or(now.date());
    (first + Duration::days(i64::from(now.day()) - 1)).and_time(now.time())
}

/// Variation en pourcentage, arrondie comme `Math.round`.
fn change_percent(current: i64, previous: i64) -> i64 {
    if previous > 0 {
        let ratio = (current - previous) as f64 / previous as f64 * 100.0;
        (ratio + 0.5).floor() as i64
    } else if current > 0 {
        100
    } else {
        0
    }
}

fn format_change(change: i64) -> String {
    if change > 0 {
        format!("+{change}%")
    } else {
        format!("{change}%")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap()
    }

    #[test]
    fn percentages() {
        assert_eq!(format_change(change_percent(5, 0)), "+100%");
        assert_eq!(format_change(change_percent(0, 0)), "0%");
        assert_eq!(format_change(change_percent(3, 2)), "+50%");
        assert_eq!(format_change(change_percent(1, 2)), "-50%");
        assert_eq!(format_change(change_percent(2, 2)), "0%");
        // Math.round(-2.5) = -2, Math.round(2.5) = 3
        assert_eq!(change_percent(195, 200), -2);
        assert_eq!(change_percent(41, 40), 3);
        // -0,4 % arrondi donne 0 (et non « -0 »)
        assert_eq!(format_change(change_percent(996, 1000)), "0%");
    }

    #[test]
    fn utc_periods() {
        let (start, end, month) = periods(at("2026-03-31 15:20:00"));
        assert_eq!(start, at("2026-03-30 00:00:00"));
        assert_eq!(end, at("2026-03-31 00:00:00"));
        assert_eq!(month, at("2026-03-03 15:20:00"));
        let (start, _, month) = periods(at("2026-01-01 00:10:00"));
        assert_eq!(start, at("2025-12-31 00:00:00"));
        assert_eq!(month, at("2025-12-01 00:10:00"));
    }
}
