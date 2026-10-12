//! Agenda des publications (portage de la partie serveur de `shared/agenda.ts`) :
//! ce qui est déjà prévu, jour par jour et magasin par magasin, pour aider à
//! choisir la date d'un nouveau post ou Reel.
//!
//! Il réunit les publications planifiées (`scheduled_posts`) et les Reels encore
//! en montage, qui n'ont pas de ligne `scheduled_posts` avant la fin du rendu.

use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;

use crate::db::{RenderingReelJob, ScheduledPostWithDetails};
use crate::time::Ts;

const PREVIEW_LENGTH: usize = 80;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgendaStatus {
    Scheduled,
    Rendering,
    Published,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaItem {
    pub id: String,
    pub post_id: String,
    pub page_id: String,
    pub page_name: String,
    pub platform: String,
    pub avatar_url: Option<String>,
    pub post_type: String,
    /// ISO 8601.
    pub scheduled_at: String,
    pub status: AgendaStatus,
    pub preview: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgendaPage {
    pub id: String,
    pub page_name: String,
    pub platform: String,
    pub avatar_url: Option<String>,
}

/// Texte d'aperçu : blancs réduits, coupé à 80 caractères (unités UTF-16).
fn preview(text: Option<&str>) -> String {
    let flat = text
        .unwrap_or("")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if flat.encode_utf16().count() <= PREVIEW_LENGTH {
        return flat;
    }
    let mut out = String::new();
    let mut units = 0;
    for c in flat.chars() {
        units += c.len_utf16();
        if units > PREVIEW_LENGTH - 1 {
            break;
        }
        out.push(c);
    }
    out.push('…');
    out
}

fn in_range(date: Ts, start: Option<Ts>, end: Option<Ts>) -> bool {
    start.is_none_or(|s| date >= s) && end.is_none_or(|e| date <= e)
}

/// Statut d'une publication planifiée : elle n'a pas de colonne dédiée.
pub fn scheduled_post_status(published_at: Option<Ts>, error: Option<&str>) -> AgendaStatus {
    if published_at.is_some() {
        AgendaStatus::Published
    } else if error.is_some_and(|e| !e.is_empty()) {
        AgendaStatus::Failed
    } else {
        AgendaStatus::Scheduled
    }
}

pub fn agenda_item_from_scheduled_post(row: &ScheduledPostWithDetails) -> AgendaItem {
    let sp = &row.scheduled;
    AgendaItem {
        id: sp.id.clone(),
        post_id: sp.post_id.clone(),
        page_id: sp.page_id.clone(),
        page_name: row
            .page
            .as_ref()
            .map(|p| p.page_name.clone())
            .unwrap_or_else(|| "Page supprimée".into()),
        platform: row
            .page
            .as_ref()
            .map(|p| p.platform.as_str().to_string())
            .unwrap_or_else(|| "facebook".into()),
        avatar_url: row.page.as_ref().and_then(|p| p.avatar_url.clone()),
        post_type: sp.post_type.as_str().to_string(),
        scheduled_at: sp.scheduled_at.to_iso(),
        status: scheduled_post_status(sp.published_at, sp.error.as_deref()),
        preview: preview(Some(&row.post.content)),
    }
}

/// Entrées d'un Reel en montage, une par page visée et visible de l'utilisateur.
/// Sans date demandée, il part dès la fin du rendu : on le place à sa création.
pub fn agenda_items_from_reel_job(
    job: &RenderingReelJob,
    pages_by_id: &HashMap<String, AgendaPage>,
    start: Option<Ts>,
    end: Option<Ts>,
) -> Vec<AgendaItem> {
    let Some(post_id) = &job.post_id else {
        return Vec::new();
    };
    let params = &job.params;
    let page_ids: Vec<&str> = params
        .get("pageIds")
        .and_then(Value::as_array)
        .map(|ids| ids.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();

    let requested = params
        .get("scheduledFor")
        .and_then(Value::as_str)
        .and_then(Ts::parse);
    let when = requested.unwrap_or(job.created_at);
    if !in_range(when, start, end) {
        return Vec::new();
    }

    let param_text = |key: &str| {
        params
            .get(key)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
    };
    let text = job
        .content
        .as_deref()
        .filter(|c| !c.is_empty())
        .or_else(|| param_text("description"))
        .or_else(|| param_text("overlayText"));

    page_ids
        .into_iter()
        .filter_map(|page_id| {
            let page = pages_by_id.get(page_id)?;
            Some(AgendaItem {
                id: format!("{}:{page_id}", job.id),
                post_id: post_id.clone(),
                page_id: page_id.to_string(),
                page_name: page.page_name.clone(),
                platform: page.platform.clone(),
                avatar_url: page.avatar_url.clone(),
                post_type: "reel".into(),
                scheduled_at: when.to_iso(),
                status: AgendaStatus::Rendering,
                preview: preview(text),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{
        Platform, PostStatus, PostType, ScheduledPost, ScheduledPostPage, ScheduledPostPost,
    };
    use serde_json::json;

    fn page(id: &str, name: &str, platform: &str) -> AgendaPage {
        AgendaPage {
            id: id.into(),
            page_name: name.into(),
            platform: platform.into(),
            avatar_url: None,
        }
    }

    fn pages_by_id() -> HashMap<String, AgendaPage> {
        [
            page("a", "Magasin A", "facebook"),
            page("b", "Magasin B", "tiktok"),
        ]
        .into_iter()
        .map(|p| (p.id.clone(), p))
        .collect()
    }

    fn ts(s: &str) -> Ts {
        Ts::parse(s).unwrap()
    }

    fn row(published_at: Option<Ts>, error: Option<&str>) -> ScheduledPostWithDetails {
        ScheduledPostWithDetails {
            scheduled: ScheduledPost {
                id: "s".into(),
                post_id: "p".into(),
                page_id: "a".into(),
                post_type: PostType::Reel,
                scheduled_at: ts("2026-10-14T18:00:00Z"),
                published_at,
                external_post_id: None,
                error: error.map(str::to_string),
                publish_id: None,
                publish_status: None,
            },
            post: ScheduledPostPost {
                id: "p".into(),
                user_id: "u".into(),
                content: "Promo".into(),
                status: PostStatus::Scheduled,
                scheduled_for: None,
                ai_generated: "false".into(),
                generation_status: None,
                generation_progress: None,
                created_at: None,
            },
            page: Some(ScheduledPostPage {
                id: "a".into(),
                page_id: "fb-a".into(),
                page_name: "Magasin A".into(),
                platform: Platform::Facebook,
                avatar_url: None,
            }),
        }
    }

    fn job(params: Value, created_at: Ts) -> RenderingReelJob {
        RenderingReelJob {
            id: "j".into(),
            post_id: Some("p".into()),
            created_at,
            params,
            content: None,
        }
    }

    #[test]
    fn status_from_publication_columns() {
        assert_eq!(
            agenda_item_from_scheduled_post(&row(None, None)).status,
            AgendaStatus::Scheduled
        );
        assert_eq!(
            agenda_item_from_scheduled_post(&row(Some(Ts::now()), None)).status,
            AgendaStatus::Published
        );
        assert_eq!(
            agenda_item_from_scheduled_post(&row(None, Some("boom"))).status,
            AgendaStatus::Failed
        );
        let item = agenda_item_from_scheduled_post(&row(None, None));
        assert_eq!(item.preview, "Promo");
        assert_eq!(item.scheduled_at, "2026-10-14T18:00:00.000Z");
        let mut orphan = row(None, None);
        orphan.page = None;
        let item = agenda_item_from_scheduled_post(&orphan);
        assert_eq!(
            (item.page_name.as_str(), item.platform.as_str()),
            ("Page supprimée", "facebook")
        );
    }

    #[test]
    fn one_rendering_entry_per_visible_store() {
        let when = ts("2026-10-14T18:00:00Z");
        let items = agenda_items_from_reel_job(
            &job(
                json!({ "pageIds": ["a", "b", "inconnu"], "scheduledFor": when.to_iso() }),
                Ts::now(),
            ),
            &pages_by_id(),
            None,
            None,
        );
        assert_eq!(
            items.iter().map(|i| i.page_id.as_str()).collect::<Vec<_>>(),
            ["a", "b"]
        );
        assert!(items
            .iter()
            .all(|i| i.status == AgendaStatus::Rendering && i.post_type == "reel"));
        assert_eq!(items[0].scheduled_at, when.to_iso());
        assert_eq!(items[0].id, "j:a");
    }

    #[test]
    fn reel_without_date_is_placed_at_creation_and_respects_period() {
        let created_at = ts("2026-10-12T09:00:00Z");
        let j = job(json!({ "pageIds": ["a"] }), created_at);
        assert_eq!(
            agenda_items_from_reel_job(&j, &pages_by_id(), None, None)[0].scheduled_at,
            created_at.to_iso()
        );
        assert!(agenda_items_from_reel_job(
            &j,
            &pages_by_id(),
            Some(ts("2026-10-13T00:00:00Z")),
            None
        )
        .is_empty());
        let mut no_post = j.clone();
        no_post.post_id = None;
        assert!(agenda_items_from_reel_job(&no_post, &pages_by_id(), None, None).is_empty());
    }

    #[test]
    fn preview_text() {
        let j = job(
            json!({ "pageIds": ["a"], "description": "  Belle\n  promo  " }),
            Ts::now(),
        );
        assert_eq!(
            agenda_items_from_reel_job(&j, &pages_by_id(), None, None)[0].preview,
            "Belle promo"
        );
        let long = "x".repeat(100);
        let p = preview(Some(&long));
        assert_eq!(p.chars().count(), 80);
        assert!(p.ends_with('…'));
        assert_eq!(preview(Some(&"y".repeat(80))), "y".repeat(80));
    }
}
