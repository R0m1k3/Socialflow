//! Publication des posts programmés : toutes les minutes, les publications
//! dues sont envoyées sur Facebook ou TikTok.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use crate::db::{
    Media, MediaType, Patch, Platform, Post, PostStatus, PostType, ScheduledPost, SocialPage,
};
use crate::services::cron::{sleep_until_next_minute, spawn_guarded};
use crate::services::tiktok::error_message;
use crate::services::{facebook, media_store, tiktok};
use crate::state::AppState;
use crate::time::Ts;

/// Démarre la boucle de publication (au début de chaque minute).
pub fn start(state: AppState) {
    let running = Arc::new(AtomicBool::new(false));
    tokio::spawn(async move {
        loop {
            sleep_until_next_minute().await;
            let state = state.clone();
            spawn_guarded(&running, "Scheduler", async move {
                process_pending_posts(&state).await;
            });
        }
    });

    tracing::info!("Scheduler service started");
}

/// Traite les publications dues (une erreur n'interrompt pas les suivantes).
pub async fn process_pending_posts(state: &AppState) {
    let pending = match state.db.get_pending_scheduled_posts().await {
        Ok(pending) => pending,
        Err(error) => {
            tracing::error!("Error processing pending posts: {error}");
            return;
        }
    };

    for scheduled_post in pending {
        if let Err(error) = process_one(state, &scheduled_post).await {
            tracing::error!("Error publishing post {}: {error:#}", scheduled_post.id);
            let recorded = state
                .db
                .update_scheduled_post(
                    &scheduled_post.id,
                    Patch::new().set("error", error_message(&error)),
                )
                .await;
            if let Err(error) = recorded {
                tracing::error!("Error processing pending posts: {error}");
                return;
            }
        }
    }
}

async fn process_one(state: &AppState, scheduled_post: &ScheduledPost) -> anyhow::Result<()> {
    // Les anciens posts « both » doivent avoir été scindés à la création
    // (les nouveaux le sont automatiquement par /api/posts)
    if scheduled_post.post_type == PostType::Both {
        let error_msg = "Legacy postType \"both\" is no longer supported. Deleting this scheduled entry. Please recreate this post - it will automatically be split into separate feed and story posts.";
        tracing::error!(
            "Rejecting and deleting legacy \"both\" post {}: {error_msg}",
            scheduled_post.id
        );

        // Suppression plutôt que « publié », qui serait trompeur
        state.db.delete_scheduled_post(&scheduled_post.id).await?;

        // Le post repasse en brouillon pour être reprogrammé
        state
            .db
            .update_post(
                &scheduled_post.post_id,
                Patch::new().set("status", PostStatus::Draft),
            )
            .await?;
        return Ok(());
    }

    publish_post(state, scheduled_post).await
}

async fn publish_post(state: &AppState, scheduled_post: &ScheduledPost) -> anyhow::Result<()> {
    let post = state.db.get_post(&scheduled_post.post_id).await?;
    let page = state.db.get_social_page(&scheduled_post.page_id).await?;

    let (Some(post), Some(page)) = (post, page) else {
        anyhow::bail!("Post or page not found");
    };

    tracing::info!(
        "Publishing post {} to {} page {}",
        post.id,
        page.platform,
        page.page_name
    );

    // Tous les médias du post (carrousels multi-photos)
    let mut media_list: Vec<Media> = Vec::new();
    for link in state.db.get_post_media(&post.id).await? {
        if let Some(media) = state.db.get_media_by_id(&link.media_id).await? {
            media_list.push(media);
        }
    }

    // Une story sans média ne peut pas être publiée
    if scheduled_post.post_type == PostType::Story && media_list.is_empty() {
        let error_msg = "Les stories nécessitent un média. Ce post ne peut pas être publié.";
        tracing::error!(
            "Deleting invalid story post {} without media: {error_msg}",
            scheduled_post.id
        );

        state.db.delete_scheduled_post(&scheduled_post.id).await?;
        state
            .db
            .update_post(&post.id, Patch::new().set("status", PostStatus::Draft))
            .await?;
        return Ok(());
    }

    match page.platform {
        Platform::Facebook => {
            let external_post_id =
                facebook::publish_post(state, &post, &page, scheduled_post.post_type, &media_list)
                    .await?;

            state
                .db
                .update_scheduled_post(
                    &scheduled_post.id,
                    Patch::new()
                        .set("published_at", Ts::now())
                        .set("external_post_id", external_post_id)
                        .set_null("error"),
                )
                .await?;
        }
        Platform::Tiktok => {
            let publish_id = publish_to_tiktok(state, &post, &page, &media_list).await?;

            // TikTok publie de façon asynchrone : on marque l'envoi comme effectué pour
            // ne pas republier à la minute suivante, et le poller de statut renseignera
            // l'identifiant définitif du post.
            state
                .db
                .update_scheduled_post(
                    &scheduled_post.id,
                    Patch::new()
                        .set("published_at", Ts::now())
                        .set("publish_id", publish_id)
                        .set("publish_status", "PROCESSING_UPLOAD")
                        .set_null("error"),
                )
                .await?;
        }
        Platform::Instagram => {
            // La publication Instagram n'est pas encore implémentée
            tracing::warn!(
                "Instagram publishing not yet implemented for post {}",
                post.id
            );
            state
                .db
                .update_scheduled_post(
                    &scheduled_post.id,
                    Patch::new().set("error", "Instagram publishing not yet implemented"),
                )
                .await?;
            state
                .db
                .update_post(&post.id, Patch::new().set("status", PostStatus::Failed))
                .await?;
            return Ok(());
        }
    }

    state
        .db
        .update_post(&post.id, Patch::new().set("status", PostStatus::Published))
        .await?;

    // Les vidéos locales ne sont supprimées que si plus aucune publication
    // planifiée non envoyée ne les utilise
    for media in &media_list {
        let Some(public_id) = media
            .cloudinary_public_id
            .as_deref()
            .filter(|p| media.media_type == MediaType::Video && !p.is_empty())
        else {
            continue;
        };
        if let Err(error) = delete_video_if_unused(state, &post, media, public_id).await {
            tracing::warn!(
                "[Scheduler] Failed to delete local video file for media {}: {error:#}",
                media.id
            );
        }
    }

    tracing::info!(
        "Successfully published post {} to {} page {}",
        post.id,
        page.platform,
        page.page_name
    );
    Ok(())
}

async fn delete_video_if_unused(
    state: &AppState,
    post: &Post,
    media: &Media,
    public_id: &str,
) -> anyhow::Result<()> {
    let remaining = state.db.get_scheduled_posts_by_post(&post.id).await?;
    let has_pending = remaining.iter().any(|sp| sp.published_at.is_none());
    if has_pending {
        tracing::info!(
            "[Scheduler] Kept local video file for media {} (pending scheduled posts still exist)",
            media.id
        );
    } else {
        media_store::delete_media(state, public_id).await?;
        tracing::info!(
            "[Scheduler] Deleted local video file for media {}",
            media.id
        );
    }
    Ok(())
}

/// Envoie la vidéo d'un post planifié sur un compte TikTok.
/// TikTok ne sait pas programmer une publication : c'est notre planificateur qui
/// déclenche l'envoi à l'heure voulue. Renvoie le `publish_id` à suivre.
async fn publish_to_tiktok(
    state: &AppState,
    post: &Post,
    page: &SocialPage,
    media_list: &[Media],
) -> anyhow::Result<String> {
    let Some(video) = media_list.iter().find(|m| m.media_type == MediaType::Video) else {
        anyhow::bail!(
            "Le compte TikTok \"{}\" ne peut recevoir que des vidéos : ce post n'en contient pas.",
            page.page_name
        );
    };

    let buffer = media_store::read_media_buffer(state, &video.original_url).await?;

    tiktok::publish_video_from_buffer(state, page, buffer, &post.content).await
}
