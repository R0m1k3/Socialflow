//! Assemblage des routes HTTP.

mod auth;
mod core;
mod analytics;
mod external;
mod facebook;
mod legal;
mod reels;
mod tiktok;

use axum::extract::{DefaultBodyLimit, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::Router;
use serde_json::json;
use tower::ServiceExt;
use tower_http::services::{ServeDir, ServeFile};

use crate::extract::MAX_JSON_BODY;
use crate::http;
use crate::state::AppState;

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .merge(auth::router())
        .merge(core::router())
        .nest("/api/analytics", analytics::router())
        .nest("/api/facebook", facebook::router())
        .nest("/api/tiktok", tiktok::router())
        .nest("/api/v1", external::router())
        .merge(reels::router())
        .merge(legal::router());

    let config = &state.config;
    for dir in [&config.uploads_dir, &config.audio_upload_dir, &config.temp_upload_dir] {
        let _ = std::fs::create_dir_all(dir);
    }
    for sub in ["media", "logos", "stories"] {
        let _ = std::fs::create_dir_all(config.uploads_dir.join(sub));
    }

    // Fichiers téléversés (médias, logos, stories, musique, fichiers temporaires des rendus)
    let uploads = Router::new()
        .nest_service("/uploads/audio", ServeDir::new(&config.audio_upload_dir))
        .nest_service("/uploads/temp", ServeDir::new(&config.temp_upload_dir))
        .nest_service("/uploads", ServeDir::new(&config.uploads_dir));

    api.merge(uploads)
        .fallback(fallback)
        .layer(DefaultBodyLimit::max(MAX_JSON_BODY))
        .layer(middleware::from_fn_with_state(state.clone(), http::rate_limit))
        .layer(middleware::from_fn(http::log_requests))
        .layer(middleware::from_fn(http::security_headers))
        .with_state(state)
}

/// Route inconnue : JSON pour `/api`, sinon fichiers publics puis l'application React.
async fn fallback(State(state): State<AppState>, headers: HeaderMap, request: Request) -> Response {
    let path = request.uri().path().to_string();
    if path == "/api" || path.starts_with("/api/") {
        return if crate::auth::current_user(&state, &headers).await.is_none() {
            (StatusCode::UNAUTHORIZED, axum::Json(json!({ "error": "Non authentifié" }))).into_response()
        } else {
            (StatusCode::NOT_FOUND, axum::Json(json!({ "error": "Route introuvable" }))).into_response()
        };
    }

    // Vérifications de domaine (TikTok, Google, Meta…), sans les fichiers cachés
    let is_hidden = path.split('/').any(|part| part.starts_with('.'));
    if !is_hidden && path != "/" {
        let candidate = state.config.public_root_dir.join(path.trim_start_matches('/'));
        if candidate.is_file() {
            return serve(ServeFile::new(candidate), request).await;
        }
    }

    let index = state.config.static_dir.join("index.html");
    let spa = ServeDir::new(&state.config.static_dir)
        .append_index_html_on_directories(true)
        .fallback(ServeFile::new(index));
    serve(spa, request).await
}

async fn serve<S>(service: S, request: Request) -> Response
where
    S: tower::Service<Request, Error = std::convert::Infallible> + Send,
    S::Response: IntoResponse,
    S::Future: Send,
{
    match service.oneshot(request).await {
        Ok(response) => response.into_response(),
        Err(never) => match never {},
    }
}
