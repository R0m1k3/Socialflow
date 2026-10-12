//! Bibliothèque de pistes audio (envoi réservé aux administrateurs).
//! Les fichiers sont rangés directement dans le dossier audio persistant,
//! servi sous `/uploads/audio/`.

use axum::extract::{DefaultBodyLimit, Multipart, Path, State};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};

use crate::auth::{AdminUser, AuthUser};
use crate::error::{ApiResult, AppError, OrApiError};
use crate::services::audio::{fix_audio_track_encoding, probe_duration_secs};
use crate::state::AppState;
use crate::upload::{self, UploadRules};

const ALLOWED_AUDIO_MIME_TYPES: [&str; 4] = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg"];

/// 50 Mo par fichier, 20 fichiers par envoi.
const MAX_AUDIO_SIZE: u64 = 50 * 1024 * 1024;
const MAX_AUDIO_FILES: usize = 20;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/audio-tracks",
            get(list_tracks)
                .post(upload_tracks)
                .layer(DefaultBodyLimit::disable()),
        )
        .route("/api/audio-tracks/fix-encoding", post(fix_encoding))
        .route("/api/audio-tracks/{id}", delete(delete_track))
}

fn audio_filter(mime: &str, name: &str) -> Result<(), String> {
    static AUDIO_EXT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\.(mp3|wav|ogg)$").unwrap());
    if ALLOWED_AUDIO_MIME_TYPES.contains(&mime) || AUDIO_EXT.is_match(name) {
        Ok(())
    } else {
        Err(format!("Type de fichier audio non autorisé: {mime}"))
    }
}

/// Titre d'une piste : nom du fichier sans son extension.
fn title_from_file_name(name: &str) -> &str {
    match name.rfind('.') {
        Some(pos) if !name[pos + 1..].is_empty() && !name[pos + 1..].contains('/') => &name[..pos],
        _ => name,
    }
}

async fn upload_tracks(
    State(state): State<AppState>,
    admin: AdminUser,
    multipart: Multipart,
) -> ApiResult<Json<Value>> {
    let dir = state.config.audio_upload_dir.clone();
    let (files, _) = upload::receive_files(
        multipart,
        UploadRules {
            fields: &["files"],
            dir: &dir,
            max_file_size: MAX_AUDIO_SIZE,
            max_files: MAX_AUDIO_FILES,
            filter: &audio_filter,
        },
    )
    .await
    .map_err(super::upload_error)?;

    if files.is_empty() {
        return Err(AppError::bad_request("No audio file uploaded"));
    }

    let mut results = Vec::with_capacity(files.len());
    for file in &files {
        tracing::info!(
            "🎵 Audio saved locally: {} ({:.2} MB)",
            file.original_name,
            file.size as f64 / 1024.0 / 1024.0
        );
        let url = format!("/uploads/audio/{}", file.file_name);
        let duration = probe_duration_secs(&file.path).await;
        let created = state
            .db
            .create_audio_track(
                Some(&admin.id),
                title_from_file_name(&file.original_name),
                &file.original_name,
                &url,
                duration,
            )
            .await;
        match created {
            Ok(track) => results.push(json!({ "success": true, "track": track })),
            Err(error) => {
                // Fichier retiré si l'enregistrement en base échoue
                let _ = tokio::fs::remove_file(&file.path).await;
                results.push(json!({
                    "success": false,
                    "fileName": file.original_name,
                    "error": super::pg_message(&error),
                }));
            }
        }
    }
    Ok(Json(json!({ "results": results })))
}

async fn fix_encoding(State(state): State<AppState>, _admin: AdminUser) -> ApiResult<Json<Value>> {
    fix_audio_track_encoding(&state).await;
    let tracks = state
        .db
        .get_audio_tracks()
        .await
        .or_500("Failed to fix encoding")?;
    Ok(Json(json!({ "success": true, "tracks": tracks })))
}

/// Accessible à tous : les pistes servent à habiller les Reels.
async fn list_tracks(State(state): State<AppState>, _user: AuthUser) -> ApiResult<Json<Value>> {
    let tracks = state
        .db
        .get_audio_tracks()
        .await
        .or_500("Failed to fetch audio tracks")?;
    Ok(Json(json!(tracks)))
}

async fn delete_track(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Failed to delete audio track";
    if state
        .db
        .get_audio_track(&id)
        .await
        .or_500(FAILED)?
        .is_none()
    {
        return Err(AppError::not_found("Audio track not found"));
    }
    // Comme avant, le fichier local est conservé : seule la piste est retirée
    state.db.delete_audio_track(&id).await.or_500(FAILED)?;
    Ok(Json(json!({ "success": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_and_filter() {
        assert_eq!(title_from_file_name("Été 2024.mp3"), "Été 2024");
        assert_eq!(title_from_file_name("a.b.wav"), "a.b");
        assert_eq!(title_from_file_name("sans_extension"), "sans_extension");
        assert_eq!(title_from_file_name("fin."), "fin.");
        assert!(audio_filter("application/octet-stream", "x.OGG").is_ok());
        assert!(audio_filter("audio/mpeg", "x").is_ok());
        assert_eq!(
            audio_filter("video/mp4", "x.mp4").unwrap_err(),
            "Type de fichier audio non autorisé: video/mp4"
        );
    }
}
