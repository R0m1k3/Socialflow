//! Purge quotidienne des anciens médias locaux, pour économiser l'espace disque :
//! - images de plus de 30 jours ;
//! - vidéos de plus de 7 jours.

use chrono::Duration;

use crate::db::{Media, MediaType};
use crate::services::media_store;
use crate::state::AppState;
use crate::time::Ts;

/// Ancienneté au-delà de laquelle une image est purgée.
const IMAGE_RETENTION_DAYS: i64 = 30;
/// Ancienneté au-delà de laquelle une vidéo est purgée.
const VIDEO_RETENTION_DAYS: i64 = 7;

/// Médias d'un type créés avant `before`.
async fn media_older_than(
    state: &AppState,
    media_type: MediaType,
    before: Ts,
) -> Result<Vec<Media>, sqlx::Error> {
    sqlx::query_as("SELECT * FROM media WHERE type = $1 AND created_at < $2")
        .bind(media_type)
        .bind(before)
        .fetch_all(&state.db.pool)
        .await
}

/// Supprime le fichier, la vignette et la ligne d'un média.
async fn purge_one(state: &AppState, item: &Media) -> anyhow::Result<()> {
    if let Some(public_id) = item
        .cloudinary_public_id
        .as_deref()
        .filter(|p| !p.is_empty())
    {
        media_store::delete_media(state, public_id).await?;
    }
    // La vignette n'a plus de raison d'être une fois la ligne supprimée
    if let Some(thumbnail) = item
        .thumbnail_url
        .as_deref()
        .and_then(|t| t.strip_prefix("/uploads/"))
    {
        if let Err(error) = media_store::delete_media(state, thumbnail).await {
            tracing::warn!(
                "[Media Purge] Vignette non supprimée pour {}: {error}",
                item.id
            );
        }
    }
    state.db.delete_media(&item.id).await?;
    Ok(())
}

async fn run(state: &AppState) -> anyhow::Result<()> {
    let now = Ts::now();
    let thirty_days_ago = now.add(Duration::days(-IMAGE_RETENTION_DAYS));
    let seven_days_ago = now.add(Duration::days(-VIDEO_RETENTION_DAYS));

    let old_images = media_older_than(state, MediaType::Image, thirty_days_ago).await?;
    let old_videos = media_older_than(state, MediaType::Video, seven_days_ago).await?;

    if old_images.is_empty() && old_videos.is_empty() {
        tracing::info!("[Media Purge] No old media found to purge.");
        return Ok(());
    }

    tracing::info!(
        "[Media Purge] Found {} old images (>30 days) and {} old videos (>7 days) to purge.",
        old_images.len(),
        old_videos.len()
    );

    let mut success_count = 0;
    let mut error_count = 0;

    for item in old_images.iter().chain(old_videos.iter()) {
        match purge_one(state, item).await {
            Ok(()) => success_count += 1,
            Err(error) => {
                tracing::error!(
                    "[Media Purge] Failed to delete media {}: {error:#}",
                    item.id
                );
                error_count += 1;
            }
        }
    }

    tracing::info!(
        "[Media Purge] Purge completed. Deleted: {success_count}, Failed: {error_count}."
    );
    Ok(())
}

/// Purge les anciens médias. Ne renvoie jamais d'erreur : un échec global est
/// journalisé, comme dans l'ancien serveur.
pub async fn purge_old_media(state: &AppState) -> anyhow::Result<()> {
    tracing::info!("[Media Purge] Starting automatic purge of old media...");
    if let Err(error) = run(state).await {
        tracing::error!("[Media Purge] Fatal error during media purge process: {error:#}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test sur une vraie base : `DATABASE_URL=… cargo test -- --ignored purge`.
    #[tokio::test]
    #[ignore]
    async fn purge_against_database() {
        let config = crate::config::Config::from_env().expect("DATABASE_URL requis");
        crate::crypto::init(&config);
        let pool = crate::db::connect(&config.database_url).await.unwrap();
        let state = AppState::new(config, pool).unwrap();
        let user: String = sqlx::query_scalar("SELECT id FROM users LIMIT 1")
            .fetch_one(&state.db.pool)
            .await
            .unwrap();
        let rows = [
            ("purge_old_img", "image", 31),
            ("purge_new_img", "image", 29),
            ("purge_old_vid", "video", 8),
            ("purge_new_vid", "video", 6),
        ];
        for (id, kind, days) in rows {
            sqlx::query(
                "INSERT INTO media (id, user_id, type, cloudinary_public_id, original_url, file_name, file_size, created_at)
                 VALUES ($1, $2, $3::media_type, $4, '/uploads/x', 'x', 1, now() - make_interval(days => $5))",
            )
            .bind(id)
            .bind(&user)
            .bind(kind)
            .bind(format!("media/{id}.bin"))
            .bind(days)
            .execute(&state.db.pool)
            .await
            .unwrap();
        }

        purge_old_media(&state).await.unwrap();

        let left: Vec<String> =
            sqlx::query_scalar("SELECT id FROM media WHERE id LIKE 'purge_%' ORDER BY id")
                .fetch_all(&state.db.pool)
                .await
                .unwrap();
        assert_eq!(left, vec!["purge_new_img", "purge_new_vid"]);
        sqlx::query("DELETE FROM media WHERE id LIKE 'purge_%'")
            .execute(&state.db.pool)
            .await
            .unwrap();
    }
}
