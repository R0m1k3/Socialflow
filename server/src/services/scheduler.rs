//! Publication des posts programmés : toutes les minutes, les publications
//! dues sont envoyées sur Facebook ou TikTok.

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use once_cell::sync::Lazy;
use regex::Regex;

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

/// Nombre de tentatives en échec après lequel une publication est abandonnée
/// (il faut alors la reprogrammer).
pub const MAX_PUBLISH_ATTEMPTS: i32 = 5;

/// Délai avant la tentative suivante, selon le nombre d'échecs déjà subis.
/// Une limite de débit (quota d'appels, blocage anti-spam) appelle des délais
/// plus longs : réessayer tout de suite prolonge le blocage.
fn retry_delay(attempts: i32, rate_limited: bool) -> chrono::Duration {
    const MINUTES: [i64; 4] = [5, 15, 60, 180];
    const RATE_LIMITED_MINUTES: [i64; 4] = [30, 60, 120, 240];
    let table = if rate_limited {
        &RATE_LIMITED_MINUTES
    } else {
        &MINUTES
    };
    let index = usize::try_from(attempts - 1)
        .unwrap_or(0)
        .min(table.len() - 1);
    chrono::Duration::minutes(table[index])
}

/// Code d'erreur Graph repris dans le message (`... (code: 4)`).
fn graph_error_code(message: &str) -> Option<i64> {
    static CODE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\(code: (\d+)").unwrap());
    CODE.captures(message)?.get(1)?.as_str().parse().ok()
}

/// Erreur due à une limite de débit : quotas de l'application (4), de
/// l'utilisateur (17), de la page (32, 613, 80001…) ou blocage temporaire
/// anti-spam (368), ou `rate_limit_exceeded` côté TikTok.
fn is_rate_limited(message: &str) -> bool {
    if let Some(code) = graph_error_code(message) {
        if matches!(code, 4 | 17 | 32 | 368 | 613 | 80001..=80014) {
            return true;
        }
    }
    let lower = message.to_lowercase();
    lower.contains("rate_limit") || lower.contains("request limit")
}

async fn page_platform(state: &AppState, page_id: &str) -> Option<Platform> {
    match state.db.get_social_page(page_id).await {
        Ok(page) => page.map(|p| p.platform),
        Err(error) => {
            tracing::warn!("[Scheduler] Page {page_id} illisible : {error}");
            None
        }
    }
}

/// Traite les publications dues (une erreur n'interrompt pas les suivantes).
///
/// Un échec n'est retenté qu'après un délai croissant, et au plus
/// `MAX_PUBLISH_ATTEMPTS` fois : sans cela, chaque publication en échec était
/// renvoyée toutes les minutes et épuisait le quota d'appels de l'application.
/// Après une limite de débit, les autres publications de la même plateforme
/// sont reportées au lieu d'aggraver le blocage.
pub async fn process_pending_posts(state: &AppState) {
    let pending = match state
        .db
        .get_pending_scheduled_posts(MAX_PUBLISH_ATTEMPTS)
        .await
    {
        Ok(pending) => pending,
        Err(error) => {
            tracing::error!("Error processing pending posts: {error}");
            return;
        }
    };

    let mut cooldowns: HashMap<Platform, Ts> = HashMap::new();

    for scheduled_post in pending {
        if !cooldowns.is_empty() {
            let platform = page_platform(state, &scheduled_post.page_id).await;
            if let Some(until) = platform.and_then(|p| cooldowns.get(&p)).copied() {
                tracing::info!(
                    "[Scheduler] Post {} reporté au {until} (limite de débit atteinte)",
                    scheduled_post.id
                );
                let deferred = state
                    .db
                    .update_scheduled_post(
                        &scheduled_post.id,
                        Patch::new().set("next_attempt_at", until),
                    )
                    .await;
                if let Err(error) = deferred {
                    tracing::error!("Error processing pending posts: {error}");
                    return;
                }
                continue;
            }
        }

        if let Err(error) = process_one(state, &scheduled_post).await {
            let message = error_message(&error);
            let rate_limited = is_rate_limited(&message);
            let attempts = scheduled_post.attempts + 1;
            let retry_at = Ts::now().add(retry_delay(attempts, rate_limited));
            let next_attempt_at = (attempts < MAX_PUBLISH_ATTEMPTS).then_some(retry_at);

            match next_attempt_at {
                Some(at) => tracing::error!(
                    "Error publishing post {} (tentative {attempts}/{MAX_PUBLISH_ATTEMPTS}, nouvel essai le {at}): {error:#}",
                    scheduled_post.id
                ),
                None => tracing::error!(
                    "Error publishing post {} (abandon après {attempts} tentatives): {error:#}",
                    scheduled_post.id
                ),
            }

            if rate_limited {
                if let Some(platform) = page_platform(state, &scheduled_post.page_id).await {
                    cooldowns.insert(platform, retry_at);
                }
            }

            let recorded = state
                .db
                .update_scheduled_post(
                    &scheduled_post.id,
                    Patch::new()
                        .set("error", message)
                        .set("attempts", attempts)
                        .set("next_attempt_at", next_attempt_at),
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
                        .set_null("error")
                        .set("next_attempt_at", None::<Ts>),
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
                        .set_null("error")
                        .set("next_attempt_at", None::<Ts>),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_facebook_rate_limits() {
        assert!(is_rate_limited(
            "Facebook Story API error (START phase): (#4) Application request limit reached (code: 4)"
        ));
        assert!(is_rate_limited(
            "Facebook Reel START error: Nous limitons le nombre de fois que vous pouvez publier (code: 368, subcode: 1390008)"
        ));
        assert!(is_rate_limited(
            "Facebook API error: Page request limit reached (code: 32)"
        ));
        assert!(is_rate_limited("TikTok error: rate_limit_exceeded"));
    }

    #[test]
    fn other_errors_are_not_rate_limits() {
        assert!(!is_rate_limited(
            "Facebook API error: Error validating access token (code: 190)"
        ));
        assert!(!is_rate_limited(
            "Facebook API error: Invalid parameter (code: 100)"
        ));
        assert!(!is_rate_limited("Post or page not found"));
    }

    #[test]
    fn retry_delays_grow_and_stay_bounded() {
        assert_eq!(retry_delay(1, false), chrono::Duration::minutes(5));
        assert_eq!(retry_delay(2, false), chrono::Duration::minutes(15));
        assert_eq!(retry_delay(9, false), chrono::Duration::minutes(180));
        assert_eq!(retry_delay(1, true), chrono::Duration::minutes(30));
        assert_eq!(retry_delay(4, true), chrono::Duration::minutes(240));
        assert_eq!(retry_delay(0, true), chrono::Duration::minutes(30));
    }
}
