//! Paramètres globaux : clé de l'API externe, clé Gemini, service Qwen TTS.

use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};

use crate::auth::AdminUser;
use crate::db::{Patch, Val};
use crate::error::{ApiResult, AppError, OrApiError};
use crate::extract::{Body, JsonExt};
use crate::services::ffmpeg::{self, QwenTarget};
use crate::services::reels::normalize_qwen_url;
use crate::state::AppState;

const READ_FAILED: &str = "Erreur lors de la récupération de la configuration";
const SAVE_FAILED: &str = "Erreur lors de la sauvegarde de la configuration";
const DELETE_KEY_FAILED: &str = "Erreur lors de la suppression de la clé";

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/settings/external-api",
            get(get_external_api)
                .post(save_external_api)
                .delete(delete_external_api),
        )
        .route(
            "/api/settings/gemini",
            get(get_gemini).post(save_gemini).delete(delete_gemini),
        )
        .route(
            "/api/settings/qwen",
            get(get_qwen).post(save_qwen).delete(delete_qwen),
        )
        .route("/api/settings/qwen/test", post(test_qwen))
}

fn is_set(value: &Option<String>) -> bool {
    value.as_deref().is_some_and(|v| !v.is_empty())
}

/// Clé API obligatoire et non vide (`apiKey.trim() !== ""`).
fn required_api_key(body: &Value) -> Result<String, AppError> {
    body.trimmed("apiKey")
        .ok_or_else(|| AppError::bad_request("La clé API est requise"))
}

async fn get_external_api(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    let config = state.db.get_app_config().await.or_500(READ_FAILED)?;
    Ok(Json(
        json!({ "configured": config.is_some_and(|c| is_set(&c.external_api_key)) }),
    ))
}

async fn save_external_api(
    State(state): State<AppState>,
    _admin: AdminUser,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    let key = required_api_key(&body)?;
    state
        .db
        .upsert_app_config(Patch::new().set("external_api_key", key))
        .await
        .or_500(SAVE_FAILED)?;
    Ok(Json(json!({ "success": true, "configured": true })))
}

async fn delete_external_api(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    state
        .db
        .upsert_app_config(Patch::new().set_null("external_api_key"))
        .await
        .or_500(DELETE_KEY_FAILED)?;
    Ok(Json(json!({ "success": true, "configured": false })))
}

async fn get_gemini(State(state): State<AppState>, _admin: AdminUser) -> ApiResult<Json<Value>> {
    let config = state.db.get_app_config().await.or_500(READ_FAILED)?;
    Ok(Json(
        json!({ "configured": config.is_some_and(|c| is_set(&c.gemini_api_key)) }),
    ))
}

async fn save_gemini(
    State(state): State<AppState>,
    _admin: AdminUser,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    let key = required_api_key(&body)?;
    state
        .db
        .upsert_app_config(Patch::new().set("gemini_api_key", key))
        .await
        .or_500(SAVE_FAILED)?;
    Ok(Json(json!({ "success": true, "configured": true })))
}

async fn delete_gemini(State(state): State<AppState>, _admin: AdminUser) -> ApiResult<Json<Value>> {
    state
        .db
        .upsert_app_config(Patch::new().set_null("gemini_api_key"))
        .await
        .or_500(DELETE_KEY_FAILED)?;
    Ok(Json(json!({ "success": true, "configured": false })))
}

async fn get_qwen(State(state): State<AppState>, _admin: AdminUser) -> ApiResult<Json<Value>> {
    let config = state.db.get_app_config().await.or_500(READ_FAILED)?;
    let url = config
        .as_ref()
        .and_then(|c| c.qwen_tts_url.clone())
        .unwrap_or_default();
    let has_key = config.is_some_and(|c| is_set(&c.qwen_tts_api_key));
    Ok(Json(json!({ "url": url, "hasApiKey": has_key })))
}

async fn save_qwen(
    State(state): State<AppState>,
    _admin: AdminUser,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    let Some(url) = normalize_qwen_url(body.get("url")) else {
        return Err(AppError::bad_request(
            "Adresse invalide (ex. http://192.168.1.20:8001)",
        ));
    };
    let mut patch = Patch::new().set("qwen_tts_url", url);
    // Clé laissée vide : on garde celle déjà enregistrée
    if let Some(key) = body.trimmed("apiKey") {
        patch = patch.set("qwen_tts_api_key", key);
    }
    state
        .db
        .upsert_app_config(patch)
        .await
        .or_500(SAVE_FAILED)?;
    Ok(Json(json!({ "success": true })))
}

async fn delete_qwen(State(state): State<AppState>, _admin: AdminUser) -> ApiResult<Json<Value>> {
    state
        .db
        .upsert_app_config(
            Patch::new()
                .set("qwen_tts_url", Val::Text(None))
                .set("qwen_tts_api_key", Val::Text(None)),
        )
        .await
        .or_500("Erreur lors de la suppression de la configuration")?;
    Ok(Json(json!({ "success": true })))
}

/// Teste la connexion depuis le service FFmpeg (c'est lui qui appelle Qwen).
/// Répond toujours 200 : `{ ok: false, error }` en cas d'échec.
async fn test_qwen(
    State(state): State<AppState>,
    _admin: AdminUser,
    Body(body): Body<Value>,
) -> Json<Value> {
    match run_qwen_test(&state, &body).await {
        Ok(value) => Json(value),
        Err(error) => {
            tracing::error!("Error testing Qwen config: {error:#}");
            Json(json!({ "ok": false, "error": error.to_string() }))
        }
    }
}

async fn run_qwen_test(state: &AppState, body: &Value) -> anyhow::Result<Value> {
    let config = state.db.get_app_config().await?;
    let url = normalize_qwen_url(body.get("url"))
        .or_else(|| config.as_ref().and_then(|c| c.qwen_tts_url.clone()))
        .filter(|u| !u.is_empty());
    let api_key = body
        .trimmed("apiKey")
        .or_else(|| config.as_ref().and_then(|c| c.qwen_tts_api_key.clone()))
        .filter(|k| !k.is_empty());

    let catalog = ffmpeg::list_voices(state, url.map(|url| QwenTarget { url, api_key })).await?;
    let status = catalog
        .qwen_status
        .as_ref()
        .filter(|s| crate::extract::is_truthy(Some(s)));
    let Some(status) = status.filter(|_| catalog.qwen_available) else {
        return Ok(
            json!({ "ok": false, "error": "Service Qwen injoignable (adresse, port, clé ou pare-feu)" }),
        );
    };

    let mut result = serde_json::Map::new();
    result.insert("ok".into(), Value::Bool(true));
    if let Value::Object(fields) = status {
        for (key, value) in fields {
            result.insert(key.clone(), value.clone());
        }
    }
    result.insert("voices".into(), json!(catalog.qwen.len()));
    Ok(Value::Object(result))
}
