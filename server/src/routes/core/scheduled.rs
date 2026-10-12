//! Publications planifiées (calendrier) et agenda par magasin.

use std::collections::{HashMap, HashSet};

use axum::extract::{Path, State};
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde_json::{json, Value};

use super::agenda::{
    agenda_item_from_scheduled_post, agenda_items_from_reel_job, AgendaItem, AgendaPage,
};
use super::validate::{Issues, Presence};
use crate::auth::AuthUser;
use crate::db::{NewScheduledPost, Patch, PostType, ScheduledPost};
use crate::error::{ApiResult, AppError, OrApiError};
use crate::extract::{is_truthy, Body, QueryMap};
use crate::state::AppState;
use crate::time::Ts;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/scheduled-posts/agenda", get(agenda))
        .route(
            "/api/scheduled-posts",
            get(list_scheduled).post(create_scheduled),
        )
        .route(
            "/api/scheduled-posts/{id}",
            patch(update_scheduled).delete(delete_scheduled),
        )
}

/// Ce qui est déjà prévu par jour et par magasin, Reels en montage compris.
async fn agenda(
    State(state): State<AppState>,
    user: AuthUser,
    query: QueryMap,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Failed to fetch publication agenda";
    let start = super::parse_date_param(query.get("startDate"));
    let end = super::parse_date_param(query.get("endDate"));

    let pages = state.db.get_visible_pages(&user).await.or_500(FAILED)?;
    if pages.is_empty() {
        return Ok(Json(json!([])));
    }
    let page_ids: Vec<String> = pages.iter().map(|p| p.id.clone()).collect();
    let pages_by_id: HashMap<String, AgendaPage> = pages
        .into_iter()
        .map(|p| {
            let page = AgendaPage {
                id: p.id.clone(),
                page_name: p.page_name,
                platform: p.platform.as_str().to_string(),
                avatar_url: p.avatar_url,
            };
            (p.id, page)
        })
        .collect();

    let (scheduled, jobs) = tokio::try_join!(
        state.db.get_scheduled_posts_by_pages(&page_ids, start, end),
        state.db.get_rendering_reel_jobs(),
    )
    .or_500(FAILED)?;

    let mut items: Vec<AgendaItem> = scheduled
        .iter()
        .map(agenda_item_from_scheduled_post)
        .collect();
    // Un rendu qui vient de finir peut avoir déjà créé ses publications
    let planned: HashSet<String> = items.iter().map(|i| i.post_id.clone()).collect();
    for job in &jobs {
        if job.post_id.as_ref().is_some_and(|id| planned.contains(id)) {
            continue;
        }
        items.extend(agenda_items_from_reel_job(job, &pages_by_id, start, end));
    }
    items.sort_by(|a, b| a.scheduled_at.cmp(&b.scheduled_at));
    Ok(Json(json!(items)))
}

/// Admin : toutes les pages ; utilisateur : les pages qui lui sont attribuées.
async fn list_scheduled(
    State(state): State<AppState>,
    user: AuthUser,
    query: QueryMap,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Failed to fetch scheduled posts";
    // Une date illisible est ignorée plutôt que transmise à SQL
    let start = super::parse_date_param(query.get("startDate"));
    let end = super::parse_date_param(query.get("endDate"));

    let pages = state.db.get_visible_pages(&user).await.or_500(FAILED)?;
    let page_ids: Vec<String> = pages.into_iter().map(|p| p.id).collect();
    let scheduled = state
        .db
        .get_scheduled_posts_by_pages(&page_ids, start, end)
        .await
        .or_500(FAILED)?;
    Ok(Json(json!(scheduled)))
}

/// Publication planifiée et droit de la modifier (admin ou auteur du post).
async fn owned_scheduled_post(
    state: &AppState,
    user: &AuthUser,
    id: &str,
    failed: &str,
) -> Result<ScheduledPost, AppError> {
    let scheduled = state
        .db
        .get_scheduled_post(id)
        .await
        .or_500(failed)?
        .ok_or_else(|| AppError::not_found("Scheduled post not found"))?;
    let post = state
        .db
        .get_post(&scheduled.post_id)
        .await
        .or_500(failed)?
        .ok_or_else(|| AppError::not_found("Post not found"))?;
    if !user.is_admin() && post.user_id != user.id {
        return Err(AppError::forbidden("Unauthorized"));
    }
    Ok(scheduled)
}

async fn delete_scheduled(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Failed to delete scheduled post";
    owned_scheduled_post(&state, &user, &id, FAILED).await?;
    state.db.delete_scheduled_post(&id).await.or_500(FAILED)?;
    Ok(Json(json!({ "success": true })))
}

/// `new Date(valeur)` pour une chaîne ou un nombre de millisecondes.
fn js_date(value: &Value) -> Option<Ts> {
    match value {
        Value::String(s) => Ts::parse(s),
        Value::Number(n) => n.as_f64().and_then(|f| Ts::from_millis(f as i64)),
        _ => None,
    }
}

/// Seules la date et la page peuvent changer ; la date est recopiée sur le post.
async fn update_scheduled(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Failed to update scheduled post";
    let scheduled = owned_scheduled_post(&state, &user, &id, FAILED).await?;

    let mut patch = Patch::new();
    if let Some(value) = body.get("scheduledAt").filter(|v| is_truthy(Some(v))) {
        let date = js_date(value).ok_or_else(|| AppError::internal(FAILED))?;
        // Reprogrammer relance les publications en échec ou abandonnées
        patch = patch
            .set("scheduled_at", date)
            .set("attempts", 0)
            .set("next_attempt_at", None::<Ts>)
            .set_null("error");
        state
            .db
            .update_post(&scheduled.post_id, Patch::new().set("scheduled_for", date))
            .await
            .or_500(FAILED)?;
    }
    if let Some(page_id) = body.get("pageId").filter(|v| is_truthy(Some(v))) {
        let Some(page_id) = page_id.as_str() else {
            return Err(AppError::internal(FAILED));
        };
        patch = patch.set("page_id", page_id);
    }
    // Rien à modifier : l'ancienne requête de mise à jour échouait
    if patch.is_empty() {
        return Err(AppError::internal(FAILED));
    }
    let updated = state
        .db
        .update_scheduled_post(&id, patch)
        .await
        .or_500(FAILED)?;
    Ok(Json(json!(updated)))
}

/// Création directe (schéma `insertScheduledPostSchema`). « both » crée deux
/// publications indépendantes (story + fil), renvoyées sous forme de tableau.
async fn create_scheduled(
    State(state): State<AppState>,
    _user: AuthUser,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Failed to create scheduled post";

    let mut issues = Issues::new();
    let post_id = issues
        .string(&body, "postId", Presence::Required)
        .into_option();
    let page_id = issues
        .string(&body, "pageId", Presence::Required)
        .into_option();
    let post_type = issues
        .enumeration(
            &body,
            "postType",
            Presence::Required,
            &["feed", "story", "both", "reel"],
        )
        .into_option()
        .and_then(|t| PostType::parse(&t));
    // Plus tolérant que l'ancien `z.date()` (qui refusait toute date JSON) :
    // une date ISO ou un nombre de millisecondes est accepté.
    let scheduled_at = body.get("scheduledAt").and_then(js_date);
    let publish_id = issues
        .string(&body, "publishId", Presence::Nullable)
        .into_option();
    let publish_status = issues
        .string(&body, "publishStatus", Presence::Nullable)
        .into_option();

    let (Some(post_id), Some(page_id), Some(post_type), Some(scheduled_at)) =
        (post_id, page_id, post_type, scheduled_at)
    else {
        tracing::error!("Error creating scheduled post: {}", issues.zod_message());
        return Err(AppError::internal(FAILED));
    };
    if !issues.is_empty() {
        tracing::error!("Error creating scheduled post: {}", issues.zod_message());
        return Err(AppError::internal(FAILED));
    }

    let new = |post_type| NewScheduledPost {
        publish_id: publish_id.clone(),
        publish_status: publish_status.clone(),
        ..NewScheduledPost::new(post_id.clone(), page_id.clone(), post_type, scheduled_at)
    };
    if post_type == PostType::Both {
        let (story, feed) = tokio::try_join!(
            state.db.create_scheduled_post(new(PostType::Story)),
            state.db.create_scheduled_post(new(PostType::Feed)),
        )
        .or_500(FAILED)?;
        return Ok(Json(json!([story, feed])));
    }
    let created = state
        .db
        .create_scheduled_post(new(post_type))
        .await
        .or_500(FAILED)?;
    Ok(Json(json!(created)))
}
