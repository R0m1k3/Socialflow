//! Statistiques des posts et des pages (ex-`routes/analytics.ts`).
//!
//! Routeur monté sous `/api/analytics` ; toutes les routes exigent une session.

use axum::extract::{Path, State};
use axum::http::header::CONTENT_TYPE;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::{ApiResult, AppError, OrApiError};
use crate::services::{analytics, token_manager};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/posts/{post_id}", get(get_post_analytics))
        .route("/posts/{post_id}/refresh", post(refresh_post_analytics))
        .route("/pages/{page_id}/history", get(get_page_history))
        .route("/pages/{page_id}/refresh", post(refresh_page_analytics))
        .route("/tokens/check", post(check_tokens))
}

/// `res.json(undefined)` d'Express : 200 avec un corps vide.
fn json_or_empty(value: Option<Value>) -> Response {
    match value {
        Some(value) => Json(value).into_response(),
        None => ([(CONTENT_TYPE, "application/json; charset=utf-8")], "").into_response(),
    }
}

async fn get_post_analytics(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(post_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let analytics = analytics::get_post_analytics(&state, &post_id)
        .await
        .or_500("Failed to fetch post analytics")?;
    Ok(Json(match analytics {
        Some(row) => serde_json::to_value(row).or_500("Failed to fetch post analytics")?,
        None => json!({}),
    }))
}

async fn refresh_post_analytics(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(post_id): Path<String>,
) -> ApiResult {
    const MESSAGE: &str = "Failed to refresh post analytics";
    analytics::sync_post_analytics(&state, &post_id)
        .await
        .or_500(MESSAGE)?;
    let updated = analytics::get_post_analytics(&state, &post_id)
        .await
        .or_500(MESSAGE)?;
    let value = updated
        .map(serde_json::to_value)
        .transpose()
        .or_500(MESSAGE)?;
    Ok(json_or_empty(value))
}

async fn get_page_history(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(page_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let history = analytics::get_page_history(&state, &page_id)
        .await
        .or_500("Failed to fetch page history")?;
    Ok(Json(
        serde_json::to_value(history).or_500("Failed to fetch page history")?,
    ))
}

async fn refresh_page_analytics(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(page_id): Path<String>,
) -> ApiResult {
    let fail = |error: String| {
        tracing::error!("Refresh error: {error}");
        AppError::internal(if error.is_empty() {
            "Failed to refresh page analytics".to_string()
        } else {
            error
        })
    };
    analytics::sync_page_analytics(&state, &page_id)
        .await
        .map_err(|e| fail(e.to_string()))?;
    let page = state
        .db
        .get_social_page(&page_id)
        .await
        .map_err(|e| fail(e.to_string()))?;
    // Page sans ses jetons (jamais envoyés au navigateur)
    Ok(json_or_empty(page.map(|p| p.to_client())))
}

/// Contrôle manuel des jetons.
async fn check_tokens(State(state): State<AppState>, _user: AuthUser) -> Json<Value> {
    token_manager::check_and_refresh_tokens(&state).await;
    Json(json!({ "success": true, "message": "Token check completed" }))
}
