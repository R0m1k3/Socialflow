//! Médiathèque : envoi, liste paginée, suppression.

use axum::extract::{DefaultBodyLimit, Multipart, Path, State};
use axum::http::HeaderValue;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::db::{MediaType, NewMedia};
use crate::error::{ApiResult, AppError, OrApiError};
use crate::extract::QueryMap;
use crate::services::media_store::{self, MediaSource};
use crate::services::thumbnail::{self, ThumbnailSource};
use crate::state::AppState;
use crate::upload::{self, UploadRules, UploadedFile};

/// Types MIME autorisés pour les médias.
const ALLOWED_MIME_TYPES: [&str; 7] = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/quicktime",
    "video/webm",
];

/// 4 Go par fichier.
const MAX_MEDIA_SIZE: u64 = 4 * 1024 * 1024 * 1024;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/media/upload",
            post(upload_media).layer(DefaultBodyLimit::disable()),
        )
        .route("/api/media/fix-urls", post(fix_urls))
        .route("/api/media", get(list_media))
        .route("/api/media/{id}", delete(delete_media))
}

/// Filtre des médias (iOS envoie parfois `application/octet-stream` : accepté
/// seulement avec une extension d'image ou de vidéo).
fn media_filter(mime: &str, name: &str) -> Result<(), String> {
    if ALLOWED_MIME_TYPES.contains(&mime)
        || (mime == "application/octet-stream" && media_store::has_media_extension(name))
    {
        Ok(())
    } else {
        Err(format!("Type de fichier non autorisé: {mime}"))
    }
}

/// Réception d'un fichier média ou logo dans le dossier temporaire du système
/// (4 Go, 10 fichiers au plus) ; erreurs au format de multer.
pub(super) async fn receive_media(
    multipart: Multipart,
    field: &str,
) -> Result<Vec<UploadedFile>, AppError> {
    let dir = std::env::temp_dir();
    let fields = [field];
    let (files, _) = upload::receive_files(
        multipart,
        UploadRules {
            fields: &fields,
            dir: &dir,
            max_file_size: MAX_MEDIA_SIZE,
            max_files: 10,
            filter: &media_filter,
        },
    )
    .await
    .map_err(super::upload_error)?;
    Ok(files)
}

/// Vidéo d'après le type MIME ou l'extension.
fn is_video(mime: &str, name: &str) -> bool {
    static VIDEO_EXT: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"(?i)\.(mp4|mov|avi|mkv|webm)$").unwrap());
    mime.starts_with("video/") || VIDEO_EXT.is_match(name)
}

async fn upload_media(
    State(state): State<AppState>,
    user: AuthUser,
    multipart: Multipart,
) -> ApiResult<Json<Value>> {
    let files = receive_media(multipart, "file").await?;
    let Some(file) = files.first().cloned() else {
        return Err(AppError::bad_request("No file uploaded"));
    };

    let result = store_upload(&state, &user.id, &file).await;
    // Fichier temporaire supprimé dans tous les cas
    upload::cleanup(&files).await;
    match result {
        Ok(media) => Ok(Json(json!(media))),
        Err(error) => {
            tracing::error!("Error uploading media: {error:#}");
            Err(AppError::internal(error.to_string()))
        }
    }
}

async fn store_upload(
    state: &AppState,
    user_id: &str,
    file: &UploadedFile,
) -> anyhow::Result<crate::db::Media> {
    tracing::info!(
        "📂 Processing upload: {} ({:.2} MB)",
        file.original_name,
        file.size as f64 / 1024.0 / 1024.0
    );
    // Extension imposée d'après le type : jamais de .html ou .svg sous /uploads
    let stored_name = media_store::with_media_extension(&file.original_name, Some(&file.mime));
    let stored =
        media_store::upload_media(state, MediaSource::Path(&file.path), &stored_name).await?;
    let video = is_video(&file.mime, &file.original_name);

    // Vignette extraite tant que la vidéo est sur le disque : elle survit à la
    // suppression du fichier après publication (historique illustré)
    let thumbnail_url = if video {
        thumbnail::create_video_thumbnail(state, ThumbnailSource::Path(&file.path)).await
    } else {
        None
    };

    let file_size = i32::try_from(file.size)
        .map_err(|_| anyhow::anyhow!("value \"{}\" is out of range for type integer", file.size))?;
    let media = state
        .db
        .create_media(NewMedia {
            user_id: user_id.to_string(),
            media_type: Some(if video {
                MediaType::Video
            } else {
                MediaType::Image
            }),
            cloudinary_public_id: Some(stored.public_id),
            original_url: stored.original_url,
            facebook_landscape_url: None,
            facebook_feed_url: stored.facebook_feed_url,
            instagram_feed_url: stored.instagram_feed_url,
            instagram_story_url: stored.instagram_story_url,
            thumbnail_url,
            file_name: file.original_name.clone(),
            file_size,
        })
        .await?;
    Ok(media)
}

/// Migration ponctuelle : URL absolues `http(s)://hôte/uploads/…` → relatives.
async fn fix_urls(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    if !user.is_admin() {
        return Err(AppError::forbidden("Admin only"));
    }
    let result = sqlx::query(
        r#"UPDATE media SET
             original_url        = regexp_replace(original_url,        '^https?://[^/]+(/uploads/)', '\1'),
             facebook_feed_url   = regexp_replace(facebook_feed_url,   '^https?://[^/]+(/uploads/)', '\1'),
             instagram_feed_url  = regexp_replace(instagram_feed_url,  '^https?://[^/]+(/uploads/)', '\1'),
             instagram_story_url = regexp_replace(instagram_story_url, '^https?://[^/]+(/uploads/)', '\1')
           WHERE
             original_url ~ '^https?://[^/]+/uploads/'
             OR facebook_feed_url  ~ '^https?://[^/]+/uploads/'
             OR instagram_feed_url ~ '^https?://[^/]+/uploads/'
             OR instagram_story_url ~ '^https?://[^/]+/uploads/'"#,
    )
    .execute(&state.db.pool)
    .await
    .or_500("Migration failed")?;
    Ok(Json(json!({ "updated": result.rows_affected() })))
}

/// Sans `limit`, toute la médiathèque est renvoyée (les écrans qui retrouvent
/// un média par son identifiant en dépendent) ; avec, `X-Total-Count` donne le total.
async fn list_media(
    State(state): State<AppState>,
    user: AuthUser,
    query: QueryMap,
) -> ApiResult<Response> {
    const FAILED: &str = "Failed to fetch media";
    let limit = super::parse_positive_int(query.get("limit"));
    let offset = super::parse_positive_int(query.get("offset"));
    let media = state
        .db
        .get_media(&user.id, limit, offset)
        .await
        .or_500(FAILED)?;

    let mut response = Json(json!(media)).into_response();
    if limit.is_some() {
        let total = state.db.get_media_count(&user.id).await.or_500(FAILED)?;
        if let Ok(value) = HeaderValue::from_str(&total.to_string()) {
            response.headers_mut().insert("X-Total-Count", value);
        }
    }
    Ok(response)
}

async fn delete_media(
    State(state): State<AppState>,
    user: AuthUser,
    Path(media_id): Path<String>,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Failed to delete media";
    let media = state
        .db
        .get_media_by_id(&media_id)
        .await
        .or_500(FAILED)?
        .filter(|m| m.user_id == user.id)
        .ok_or_else(|| AppError::not_found("Media not found"))?;

    if let Some(public_id) = media
        .cloudinary_public_id
        .as_deref()
        .filter(|p| !p.is_empty())
    {
        media_store::delete_media(&state, public_id)
            .await
            .or_500(FAILED)?;
    }
    state.db.delete_media(&media_id).await.or_500(FAILED)?;
    Ok(Json(json!({ "success": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_detection_and_filter() {
        assert!(is_video("video/mp4", "a.bin"));
        assert!(is_video("application/octet-stream", "clip.MOV"));
        assert!(!is_video("image/png", "a.png"));
        assert!(media_filter("image/png", "a.png").is_ok());
        assert!(media_filter("application/octet-stream", "clip.MOV").is_ok());
        assert!(media_filter("application/octet-stream", "a").is_err());
        assert!(media_filter("application/octet-stream", "x.html").is_err());
        assert_eq!(
            media_store::with_media_extension("x.html", Some("image/png")),
            "x.html.png"
        );
        assert_eq!(media_store::with_media_extension("a.JPG", None), "a.JPG");
        assert_eq!(
            media_store::with_media_extension("a.svg", None),
            "a.svg.bin"
        );
        assert_eq!(
            media_filter("application/pdf", "a.pdf").unwrap_err(),
            "Type de fichier non autorisé: application/pdf"
        );
    }
}
