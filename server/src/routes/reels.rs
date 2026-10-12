//! Routes des Reels et de la musique (portage de `server/routes/reels.ts`).
//! Toutes exigent une session.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use base64::Engine;
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::db::{NewMusicFavorite, NewPost, PostStatus};
use crate::error::{ApiResult, AppError, OrApiError};
use crate::extract::{is_truthy, Body, QueryMap};
use crate::services::ffmpeg::{self, VoicePreviewOptions};
use crate::services::openrouter;
use crate::services::reels::assets::{
    qwen_target_from_config, resolve_gemini_api_key, resolve_logo_path, resolve_qwen_target,
    resolve_store_name,
};
use crate::services::reels::params::{parse_tts_preview, parse_video_reel_params, srt_text};
use crate::services::reels::pipeline::effective_renderer;
use crate::services::reels::queue::{count_active_reel_jobs, enqueue_reel_job};
use crate::services::reels::tts_sync::estimate_voice_timing;
use crate::state::AppState;
use crate::time::Ts;

pub fn router() -> Router<AppState> {
    Router::new()
        // Musique (Jamendo désactivé : listes vides)
        .route("/api/music/search", get(music_search))
        .route("/api/music/more", get(music_more))
        .route("/api/music/popular", get(music_popular))
        .route(
            "/api/music/favorites",
            get(list_favorites).post(add_favorite),
        )
        .route("/api/music/favorites/check/{track_id}", get(check_favorite))
        .route("/api/music/favorites/{track_id}", delete(remove_favorite))
        .route("/api/music/{track_id}", get(music_details))
        // Reels
        .route("/api/reels/generate-text", post(generate_text))
        .route("/api/reels/voices", get(voices))
        .route("/api/reels/tts-preview", post(tts_preview))
        .route("/api/reels/sync-info", post(sync_info))
        .route("/api/reels", post(create_reel))
        .route("/api/reels/config", get(reels_config))
        .route("/api/reels/ongoing", get(ongoing))
        .route("/api/reels/{id}", delete(delete_reel))
}

// ---------------------------------------------------------------------------
// Musique
// ---------------------------------------------------------------------------

/// `parseInt(value)` : chiffres en tête (signe et espaces tolérés), sinon NaN (null en JSON).
fn js_parse_int(value: &str) -> Value {
    let trimmed = value.trim_start();
    let (sign, digits) = match trimmed.strip_prefix('-') {
        Some(rest) => (-1, rest),
        None => (1, trimmed.strip_prefix('+').unwrap_or(trimmed)),
    };
    let numeric: String = digits.chars().take_while(|c| c.is_ascii_digit()).collect();
    match numeric.parse::<i64>() {
        Ok(n) => json!(sign * n),
        Err(_) => Value::Null,
    }
}

fn empty_music_page(query: &QueryMap) -> Json<Value> {
    Json(json!({
        "tracks": [],
        "pagination": {
            "offset": js_parse_int(query.get("offset").unwrap_or("0")),
            "limit": js_parse_int(query.get("limit").unwrap_or("10")),
            "hasMore": false,
        },
    }))
}

async fn music_search(_user: AuthUser, query: QueryMap) -> Json<Value> {
    empty_music_page(&query)
}

async fn music_more(_user: AuthUser, query: QueryMap) -> Json<Value> {
    empty_music_page(&query)
}

async fn music_popular(_user: AuthUser) -> Json<Value> {
    Json(json!({ "tracks": [] }))
}

async fn list_favorites(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    let favorites = state
        .db
        .get_music_favorites(&user.id)
        .await
        .or_500("Erreur lors de la récupération des favoris")?;
    let tracks: Vec<Value> = favorites
        .into_iter()
        .map(|f| {
            json!({
                "id": f.track_id,
                "title": f.title,
                "artist": f.artist,
                "albumName": f.album_name.unwrap_or_default(),
                "duration": f.duration,
                "previewUrl": f.preview_url,
                "downloadUrl": f.download_url,
                "imageUrl": f.image_url.unwrap_or_default(),
                "license": f.license.unwrap_or_default(),
            })
        })
        .collect();
    Ok(Json(json!({ "tracks": tracks, "isFavorites": true })))
}

async fn check_favorite(
    State(state): State<AppState>,
    user: AuthUser,
    Path(track_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let is_favorite = state
        .db
        .is_music_favorite(&user.id, &track_id)
        .await
        .or_500("Erreur lors de la vérification du favori")?;
    Ok(Json(json!({ "isFavorite": is_favorite })))
}

/// Valeur texte d'un champ JSON « truthy » (les nombres sont convertis comme en JS).
fn text_field(body: &Value, key: &str) -> Option<String> {
    let value = body.get(key);
    if !is_truthy(value) {
        return None;
    }
    match value? {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        other => Some(other.to_string()),
    }
}

async fn add_favorite(
    State(state): State<AppState>,
    user: AuthUser,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    const ERROR: &str = "Erreur lors de l'ajout du favori";
    let (Some(track_id), Some(title)) = (text_field(&body, "trackId"), text_field(&body, "title"))
    else {
        return Err(AppError::bad_request("trackId et title requis"));
    };

    if state
        .db
        .is_music_favorite(&user.id, &track_id)
        .await
        .or_500(ERROR)?
    {
        return Ok(Json(
            json!({ "success": true, "message": "Déjà en favori" }),
        ));
    }

    let duration = body
        .get("duration")
        .and_then(Value::as_f64)
        .map(|d| d as i32)
        .unwrap_or(0);
    state
        .db
        .add_music_favorite(NewMusicFavorite {
            user_id: user.id.clone(),
            track_id,
            title,
            artist: text_field(&body, "artist").unwrap_or_default(),
            album_name: text_field(&body, "albumName"),
            duration,
            preview_url: text_field(&body, "previewUrl").unwrap_or_default(),
            download_url: text_field(&body, "downloadUrl").unwrap_or_default(),
            image_url: text_field(&body, "imageUrl"),
            license: text_field(&body, "license"),
        })
        .await
        .or_500(ERROR)?;
    Ok(Json(json!({ "success": true })))
}

async fn remove_favorite(
    State(state): State<AppState>,
    user: AuthUser,
    Path(track_id): Path<String>,
) -> ApiResult<Json<Value>> {
    state
        .db
        .remove_music_favorite(&user.id, &track_id)
        .await
        .or_500("Erreur lors de la suppression du favori")?;
    Ok(Json(json!({ "success": true })))
}

async fn music_details(_user: AuthUser, Path(_track_id): Path<String>) -> AppError {
    AppError::not_found("Musique non trouvée")
}

// ---------------------------------------------------------------------------
// Reels
// ---------------------------------------------------------------------------

/// Textes IA pour un Reel (même service que les posts).
async fn generate_text(
    State(state): State<AppState>,
    user: AuthUser,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    let product_info = body.get("productInfo");
    if !is_truthy(product_info) {
        return Err(AppError::bad_request("Informations produit requises"));
    }
    // Une simple chaîne sert de nom et de description du produit
    let product_info = match product_info {
        Some(Value::String(text)) => {
            let text = text.trim();
            json!({ "name": text, "description": text })
        }
        Some(other) => other.clone(),
        None => Value::Null,
    };
    let model = body.get("model").and_then(Value::as_str);

    let fail = |error: anyhow::Error| {
        tracing::error!("❌ Error generating Reel text: {error:#}");
        let (status, message) = openrouter::describe_generation_error(&error);
        AppError::new(status, message)
    };

    let texts = openrouter::generate_post_text(&state, &product_info, &user.id, model)
        .await
        .map_err(fail)?;
    let generated = Value::Array(texts);
    state
        .db
        .create_ai_generation(&user.id, &product_info, &generated)
        .await
        .map_err(|e| fail(e.into()))?;
    Ok(Json(json!({ "variants": generated })))
}

/// Voix disponibles (dont les voix clonées Qwen) et disponibilité du moteur local.
async fn voices(State(state): State<AppState>, _user: AuthUser) -> Json<Value> {
    let result = async {
        let config = state.db.get_app_config().await?;
        ffmpeg::list_voices(&state, qwen_target_from_config(config.as_ref())).await
    }
    .await;
    match result {
        Ok(catalog) => Json(json!({
            "qwenAvailable": catalog.qwen_available,
            "qwen": catalog.qwen,
            "qwenStatus": catalog.qwen_status,
        })),
        Err(error) => {
            tracing::error!("❌ Error listing voices: {error}");
            Json(json!({ "qwenAvailable": false, "qwen": [], "qwenStatus": null }))
        }
    }
}

/// Aperçu de la voix.
async fn tts_preview(
    State(state): State<AppState>,
    _user: AuthUser,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    let params = parse_tts_preview(&body).map_err(AppError::bad_request)?;
    let engine = params.tts_engine.as_deref();

    let options = async {
        Ok::<_, anyhow::Error>(VoicePreviewOptions {
            voice: params.tts_voice.clone(),
            engine: params.tts_engine.clone(),
            style: params.tts_style.clone(),
            gemini_api_key: resolve_gemini_api_key(&state, engine).await?,
            qwen: resolve_qwen_target(&state, engine).await?,
        })
    }
    .await
    .map_err(|error| {
        tracing::error!("❌ Error generating TTS preview: {error}");
        AppError::new(StatusCode::BAD_GATEWAY, error.to_string())
    })?;

    let preview = ffmpeg::preview_voice(&state, &params.text, &options)
        .await
        .map_err(|error| {
            tracing::error!("❌ Error generating TTS preview: {error}");
            let status = if error.status == Some(400) {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::BAD_GATEWAY
            };
            AppError::new(status, error.message)
        })?;

    Ok(Json(json!({
        "success": true,
        "audioBase64": base64::engine::general_purpose::STANDARD.encode(&preview.audio),
        "duration": preview.duration,
        "words": preview.words,
        "engine": preview.engine,
        "voice": preview.voice,
        "warnings": preview.warnings,
    })))
}

/// Estimation locale de la durée de la voix : ne déclenche aucune synthèse.
async fn sync_info(_user: AuthUser, Body(body): Body<Value>) -> ApiResult<Json<Value>> {
    let text = body.get("text");
    if !is_truthy(text) {
        return Err(AppError::bad_request("Texte requis"));
    }
    let Some(text) = text.and_then(Value::as_str) else {
        return Err(AppError::internal("Erreur de calcul de synchronisation"));
    };
    Ok(Json(json!(estimate_voice_timing(text))))
}

/// Crée un Reel : le rendu part dans la file persistante.
async fn create_reel(
    State(state): State<AppState>,
    user: AuthUser,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    let mut params = parse_video_reel_params(&body).map_err(AppError::bad_request)?;

    let fail = |message: String| {
        tracing::error!("❌ Error initiating Reel: {message}");
        AppError::json(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "success": false, "error": message }),
        )
    };

    // Avec un SRT, le texte libre n'est plus utilisé : la voix lit les sous-titres
    if let Some(cues) = &params.srt_cues {
        params.overlay_text = None;
        if params.description.is_none() {
            params.description = Some(srt_text(cues)).filter(|d| !d.is_empty());
        }
    }
    params.store_name = resolve_store_name(
        &state,
        &user.id,
        params.page_ids.first().map(String::as_str),
    )
    .await;

    let waiting = count_active_reel_jobs(&state)
        .await
        .map_err(|e| fail(e.to_string()))?;

    let scheduled_for = match &params.scheduled_for {
        Some(date) => Some(Ts::parse(date).ok_or_else(|| fail("Invalid time value".into()))?),
        None => None,
    };
    let mut new_post = NewPost::new(
        user.id.clone(),
        params
            .description
            .clone()
            .or_else(|| params.overlay_text.clone())
            .unwrap_or_default(),
    );
    new_post.status = if scheduled_for.is_some() {
        PostStatus::Scheduled
    } else {
        PostStatus::Draft
    };
    new_post.scheduled_for = scheduled_for;
    new_post.generation_status = Some("pending".into());
    new_post.generation_progress = Some(0);
    let post = state
        .db
        .create_post(new_post)
        .await
        .map_err(|e| fail(e.to_string()))?;

    let stored = serde_json::to_value(&params).map_err(|e| fail(e.to_string()))?;
    enqueue_reel_job(&state, "video", &user.id, Some(&post.id), stored)
        .await
        .map_err(|e| fail(e.to_string()))?;
    tracing::info!(
        "✨ Reel en file. Post {}, {waiting} job(s) avant lui.",
        post.id
    );

    Ok(Json(json!({
        "success": true,
        "postId": post.id,
        "queued": waiting > 0,
        "message": if waiting > 0 {
            "File d'attente occupée. Votre vidéo sera traitée dès que possible."
        } else {
            "Traitement démarré en arrière-plan."
        },
        "results": [],
        "videoUrl": "",
    })))
}

/// Configuration des services Reels.
async fn reels_config(State(state): State<AppState>, _user: AuthUser) -> Json<Value> {
    let (ffmpeg_configured, logo_url) =
        tokio::join!(ffmpeg::health_check(&state), resolve_logo_path(&state));
    Json(json!({
        "jamendo": { "configured": false },
        "freesound": { "configured": false },
        "ffmpeg": { "configured": ffmpeg_configured },
        // Aperçu : logo affiché par le lecteur, moteur de rendu utilisé
        "logoUrl": logo_url,
        "renderer": effective_renderer(&state),
    }))
}

/// Reels en cours de génération.
async fn ongoing(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    let posts = state
        .db
        .get_ongoing_reel_posts(&user.id)
        .await
        .or_500("Erreur lors de la récupération des reels en cours")?;
    Ok(Json(Value::Array(posts)))
}

/// Supprime un Reel (le post et, en cascade, ses publications et liens médias).
async fn delete_reel(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    const ERROR: &str = "Erreur lors de la suppression du Reel";
    let post = state
        .db
        .get_post(&id)
        .await
        .or_500(ERROR)?
        .ok_or_else(|| AppError::not_found("Reel non trouvé"))?;
    if !user.is_admin() && post.user_id != user.id {
        return Err(AppError::forbidden("Non autorisé à supprimer ce Reel"));
    }
    state.db.delete_post(&id).await.or_500(ERROR)?;
    Ok(Json(
        json!({ "success": true, "message": "Reel supprimé avec succès" }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_int_comme_javascript() {
        assert_eq!(js_parse_int("10"), json!(10));
        assert_eq!(js_parse_int("12abc"), json!(12));
        assert_eq!(js_parse_int(" -3"), json!(-3));
        assert_eq!(js_parse_int("abc"), Value::Null);
        assert_eq!(js_parse_int(""), Value::Null);
    }
}
