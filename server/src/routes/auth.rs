//! Connexion, déconnexion, session courante.

use axum::http::header::SET_COOKIE;
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};

use crate::auth::{self, MaybeUser};
use crate::error::{ApiResult, AppError, OrApiError};
use crate::extract::Body;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/session", get(session))
        .route(
            "/api/auth/default-password-status",
            get(default_password_status),
        )
}

async fn login(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
    Body(body): Body<Value>,
) -> ApiResult {
    const BAD_CREDENTIALS: &str = "Nom d'utilisateur ou mot de passe incorrect";

    // passport-local : champs absents ou vides → « Missing credentials »
    let username = body
        .get("username")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let password = body
        .get("password")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let (Some(username), Some(password)) = (username, password) else {
        return Err(AppError::unauthorized("Missing credentials"));
    };

    let user = state
        .db
        .get_user_by_username(username)
        .await
        .or_500("Erreur lors de la connexion")?
        .ok_or_else(|| AppError::unauthorized(BAD_CREDENTIALS))?;

    if !auth::verify_password(password, &user.password).await {
        return Err(AppError::unauthorized(BAD_CREDENTIALS));
    }

    let previous = auth::load_session(&state, &headers).await;
    let (_, cookie) = auth::start_session(&state, &headers, previous.as_ref(), &user.id)
        .await
        .or_500("Erreur lors de la connexion")?;

    Ok(auth::with_cookie(auth::user_json(&user), cookie))
}

async fn logout(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
) -> ApiResult {
    if let Some(session) = auth::load_session(&state, &headers).await {
        auth::destroy_session(&state, &session.sid)
            .await
            .map_err(|_| AppError::internal("Erreur lors de la déconnexion"))?;
    }
    let mut response = Json(json!({ "message": "Déconnecté avec succès" })).into_response();
    response
        .headers_mut()
        .append(SET_COOKIE, auth::clear_session_cookie());
    Ok(response)
}

async fn session(MaybeUser(user): MaybeUser) -> Response {
    match user {
        Some((user, _)) => Json(auth::user_json(&user)).into_response(),
        None => AppError::unauthorized("Non authentifié").into_response(),
    }
}

/// Le mot de passe de `admin` est-il toujours « admin » ?
async fn default_password_status(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> ApiResult<Json<Value>> {
    let admin = state
        .db
        .get_user_by_username("admin")
        .await
        .or_500("Erreur lors de la vérification du statut du mot de passe")?;
    let is_default = match admin {
        Some(admin) => auth::verify_password("admin", &admin.password).await,
        None => false,
    };
    Ok(Json(json!({ "isDefault": is_default })))
}
