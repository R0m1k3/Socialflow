//! Configurations globales : stockage des médias (ex-Cloudinary) et logo de
//! l'entreprise, service FFmpeg.

use axum::extract::{DefaultBodyLimit, Multipart, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};

use super::validate::{Field, Issues, Presence};
use crate::auth::{AdminUser, AuthUser};
use crate::db::{CloudinaryConfig, Patch, Val};
use crate::error::{ApiResult, AppError, OrApiError};
use crate::extract::{is_truthy, Body};
use crate::services::{ffmpeg, media_store};
use crate::state::AppState;
use crate::upload;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/cloudinary/config",
            get(get_storage_config).post(save_storage_config),
        )
        .route(
            "/api/cloudinary/logo",
            post(upload_logo)
                .delete(delete_logo)
                .layer(DefaultBodyLimit::disable()),
        )
        .route(
            "/api/ffmpeg/config",
            get(get_ffmpeg_config).post(save_ffmpeg_config),
        )
}

/// Configuration sans le secret, avec l'URL du logo.
async fn get_storage_config(
    State(state): State<AppState>,
    _user: AuthUser,
) -> ApiResult<Json<Value>> {
    let Some(config) = state
        .db
        .get_cloudinary_config()
        .await
        .or_500("Failed to fetch Cloudinary config")?
    else {
        return Ok(Json(Value::Null));
    };
    let logo_url = config
        .logo_public_id
        .as_deref()
        .filter(|id| !id.is_empty())
        .map(media_store::build_url);
    let mut value = json!(config);
    if let Value::Object(map) = &mut value {
        map.insert("logoUrl".into(), json!(logo_url));
    }
    Ok(Json(value))
}

fn set_optional_text(patch: Patch, column: &'static str, field: Field<String>) -> Patch {
    match field {
        Field::Absent => patch,
        Field::Null => patch.set(column, Val::Text(None)),
        Field::Set(value) => patch.set(column, value),
    }
}

async fn save_storage_config(
    State(state): State<AppState>,
    _admin: AdminUser,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Failed to save Cloudinary config";
    let existing = state.db.get_cloudinary_config().await.or_500(FAILED)?;

    // Mise à jour : clé et secret facultatifs (les anciens sont conservés)
    let secrets = if existing.is_some() {
        Presence::Optional
    } else {
        Presence::Required
    };
    let mut issues = Issues::new();
    let cloud_name = issues.string(&body, "cloudName", Presence::Required);
    let api_key = issues.string(&body, "apiKey", secrets);
    let api_secret = issues.string(&body, "apiSecret", secrets);
    let logo_public_id = issues.string(&body, "logoPublicId", Presence::Nullable);
    let endpoint_url = issues.string(&body, "endpointUrl", Presence::Nullable);
    let public_url = issues.string(&body, "publicUrl", Presence::Nullable);
    if !issues.is_empty() {
        tracing::error!("Error saving Cloudinary config: {}", issues.zod_message());
        return Err(AppError::internal(FAILED));
    }
    let cloud_name = cloud_name.into_option().unwrap_or_default();

    let config: CloudinaryConfig = match existing {
        Some(existing) => {
            let api_key = api_key
                .into_option()
                .filter(|k| !k.is_empty())
                .unwrap_or(existing.api_key);
            let api_secret = api_secret
                .into_option()
                .filter(|s| !s.is_empty())
                .unwrap_or(existing.api_secret);
            let mut patch = Patch::new()
                .set("cloud_name", cloud_name)
                .set("api_key", api_key)
                .set("api_secret", api_secret);
            patch = set_optional_text(patch, "logo_public_id", logo_public_id);
            patch = set_optional_text(patch, "endpoint_url", endpoint_url);
            patch = set_optional_text(patch, "public_url", public_url);
            state
                .db
                .update_cloudinary_config(patch)
                .await
                .or_500(FAILED)?
        }
        None => state
            .db
            .create_cloudinary_config(
                &cloud_name,
                &api_key.into_option().unwrap_or_default(),
                &api_secret.into_option().unwrap_or_default(),
                logo_public_id.into_option().as_deref(),
                endpoint_url.into_option().as_deref(),
                public_url.into_option().as_deref(),
            )
            .await
            .or_500(FAILED)?,
    };
    // Le secret n'est jamais sérialisé
    Ok(Json(json!(config)))
}

async fn upload_logo(
    State(state): State<AppState>,
    _admin: AdminUser,
    multipart: Multipart,
) -> ApiResult<Json<Value>> {
    let files = super::media::receive_media(multipart, "logo").await?;
    let Some(file) = files.first().cloned() else {
        return Err(AppError::bad_request("No logo file uploaded"));
    };
    let result = store_logo(&state, &file).await;
    upload::cleanup(&files).await;
    match result {
        Ok(value) => Ok(Json(value)),
        Err(error) => {
            tracing::error!("Error uploading logo: {error:#}");
            Err(AppError::internal(error.to_string()))
        }
    }
}

async fn store_logo(state: &AppState, file: &upload::UploadedFile) -> anyhow::Result<Value> {
    // Le stockage local n'a pas besoin d'identifiants : ligne créée au besoin
    let config = match state.db.get_cloudinary_config().await? {
        Some(config) => config,
        None => {
            state
                .db
                .create_cloudinary_config("local", "local", "local", None, None, None)
                .await?
        }
    };
    if let Some(old) = config.logo_public_id.as_deref().filter(|id| !id.is_empty()) {
        if let Err(error) = media_store::delete_logo(state, old).await {
            tracing::warn!("Failed to delete old logo: {error}");
        }
    }

    let data = tokio::fs::read(&file.path).await?;
    let _ = tokio::fs::remove_file(&file.path).await;
    let name = media_store::with_media_extension(&file.original_name, Some(&file.mime));
    let (public_id, url) = media_store::upload_logo(state, &data, &name).await?;
    state
        .db
        .update_cloudinary_config(Patch::new().set("logo_public_id", public_id.as_str()))
        .await?;
    Ok(json!({ "logoPublicId": public_id, "logoUrl": url }))
}

async fn delete_logo(State(state): State<AppState>, _admin: AdminUser) -> ApiResult<Json<Value>> {
    let config = state.db.get_cloudinary_config().await.or_500_cause()?;
    let Some(public_id) = config
        .and_then(|c| c.logo_public_id)
        .filter(|id| !id.is_empty())
    else {
        return Err(AppError::not_found("No logo found"));
    };
    media_store::delete_logo(&state, &public_id)
        .await
        .or_500_cause()?;
    state
        .db
        .update_cloudinary_config(Patch::new().set("logo_public_id", Val::Text(None)))
        .await
        .or_500_cause()?;
    Ok(Json(json!({ "success": true })))
}

async fn get_ffmpeg_config(State(state): State<AppState>, _admin: AdminUser) -> Json<Value> {
    let settings = state.ffmpeg.read().await;
    let api_url = settings.api_url.clone().unwrap_or_default();
    let configured =
        !api_url.is_empty() && settings.api_key.as_deref().is_some_and(|k| !k.is_empty());
    Json(json!({ "apiUrl": api_url, "configured": configured }))
}

/// Reconfigure le service FFmpeg pour la durée de vie du serveur, puis le teste.
async fn save_ffmpeg_config(
    State(state): State<AppState>,
    _admin: AdminUser,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Failed to save FFmpeg config";
    let api_url = body.get("apiUrl");
    if !is_truthy(api_url) {
        return Err(AppError::bad_request("URL de l'API FFmpeg requise"));
    }
    let Some(api_url) = api_url.and_then(Value::as_str).map(str::to_string) else {
        return Err(AppError::internal(FAILED));
    };

    {
        let mut settings = state.ffmpeg.write().await;
        let api_key = match body.get("apiKey").filter(|k| is_truthy(Some(k))) {
            Some(Value::String(key)) => key.clone(),
            Some(_) => return Err(AppError::internal(FAILED)),
            // Clé déjà configurée : on la garde
            None => match settings.api_key.clone().filter(|k| !k.is_empty()) {
                Some(key) => key,
                None => {
                    return Err(AppError::bad_request(
                        "Clé API FFmpeg requise pour la première configuration",
                    ))
                }
            },
        };
        let url = api_url.strip_suffix('/').unwrap_or(&api_url).to_string();
        tracing::info!("🎬 FFmpeg Service configured: {url}");
        settings.api_url = Some(url);
        settings.api_key = Some(api_key);
    }

    let healthy = ffmpeg::health_check(&state).await;
    Ok(Json(json!({
        "success": true,
        "apiUrl": api_url,
        "configured": true,
        "healthy": healthy,
    })))
}
