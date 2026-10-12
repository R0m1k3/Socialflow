//! Enregistrement et publication d'un Reel rendu.
//!
//! La vidéo est toujours envoyée en binaire : les fichiers vivent sous
//! /uploads, une URL relative que Facebook ne peut pas télécharger.

use bytes::Bytes;
use serde::Serialize;

use crate::db::{
    Media, MediaType, NewMedia, NewScheduledPost, Patch, Platform, PostStatus, PostType, SocialPage,
};
use crate::services::media_store::{self, MediaSource};
use crate::services::thumbnail::{self, ThumbnailSource};
use crate::services::{facebook, tiktok};
use crate::state::AppState;
use crate::time::Ts;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PagePublishResult {
    pub page_id: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Échec de la story associée : n'empêche pas le Reel d'être publié.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub story_error: Option<String>,
}

impl PagePublishResult {
    fn failed(page_id: &str, error: impl Into<String>) -> Self {
        Self {
            page_id: page_id.to_string(),
            success: false,
            reel_id: None,
            error: Some(error.into()),
            story_error: None,
        }
    }

    fn ok(page_id: &str, reel_id: impl Into<String>, story_error: Option<String>) -> Self {
        Self {
            page_id: page_id.to_string(),
            success: true,
            reel_id: Some(reel_id.into()),
            error: None,
            story_error,
        }
    }
}

/// Range la vidéo rendue dans la médiathèque, avec sa vignette.
pub async fn store_rendered_video(
    state: &AppState,
    user_id: &str,
    video: &[u8],
    file_name: &str,
) -> anyhow::Result<Media> {
    let uploaded = media_store::upload_media(state, MediaSource::Bytes(video), file_name).await?;
    // Vignette extraite maintenant : la vidéo sera supprimée du disque après
    // publication, mais l'historique doit rester illustré.
    let thumbnail_url =
        thumbnail::create_video_thumbnail(state, ThumbnailSource::Bytes(video)).await;

    Ok(state
        .db
        .create_media(NewMedia {
            user_id: user_id.to_string(),
            media_type: Some(MediaType::Video),
            cloudinary_public_id: Some(uploaded.public_id),
            original_url: uploaded.original_url,
            facebook_landscape_url: None,
            facebook_feed_url: uploaded.facebook_feed_url,
            instagram_feed_url: uploaded.instagram_feed_url,
            instagram_story_url: uploaded.instagram_story_url,
            thumbnail_url,
            file_name: file_name.to_string(),
            file_size: i32::try_from(video.len()).unwrap_or(i32::MAX),
        })
        .await?)
}

pub struct PublishOptions<'a> {
    pub post_id: &'a str,
    pub page_ids: &'a [String],
    pub video: Bytes,
    pub description: &'a str,
    pub scheduled_for: Option<&'a str>,
    pub also_story: bool,
}

/// `new Date(value)` ; une date invalide fait échouer l'écriture comme avec Drizzle.
fn parse_date(value: &str) -> anyhow::Result<Ts> {
    Ts::parse(value).ok_or_else(|| anyhow::anyhow!("Invalid time value"))
}

/// Publie (ou planifie) la vidéo sur chaque page, crée les entrées
/// `scheduled_posts` et met à jour le statut du post.
///
/// Avec `also_story`, chaque page Facebook reçoit aussi la vidéo en story
/// (TikTok n'a pas de stories).
pub async fn publish_reel_to_pages(
    state: &AppState,
    options: PublishOptions<'_>,
) -> anyhow::Result<Vec<PagePublishResult>> {
    let mut results = Vec::with_capacity(options.page_ids.len());

    for page_id in options.page_ids {
        match publish_to_page(state, &options, page_id).await {
            Ok(result) => results.push(result),
            Err(error) => {
                tracing::error!(
                    "❌ [Reels] Publication sur la page {page_id} impossible : {error:#}"
                );
                results.push(PagePublishResult::failed(page_id, error.to_string()));
            }
        }
    }

    let succeeded = results.iter().filter(|r| r.success).count();
    let status = if options.scheduled_for.is_some() && succeeded > 0 {
        PostStatus::Scheduled
    } else if succeeded > 0 {
        PostStatus::Published
    } else {
        PostStatus::Failed
    };
    state
        .db
        .update_post(options.post_id, Patch::new().set("status", status))
        .await?;

    Ok(results)
}

async fn publish_to_page(
    state: &AppState,
    options: &PublishOptions<'_>,
    page_id: &str,
) -> anyhow::Result<PagePublishResult> {
    let Some(page) = state.db.get_social_page(page_id).await? else {
        return Ok(PagePublishResult::failed(page_id, "Page non trouvée"));
    };
    if page.platform != Platform::Facebook && page.platform != Platform::Tiktok {
        return Ok(PagePublishResult::failed(
            page_id,
            format!(
                "Plateforme non supportée pour les reels : {}",
                page.platform
            ),
        ));
    }

    let scheduled_at = match options.scheduled_for {
        Some(date) => parse_date(date)?,
        None => Ts::now(),
    };
    let scheduled_post = state
        .db
        .create_scheduled_post(NewScheduledPost::new(
            options.post_id,
            &page.id,
            PostType::Reel,
            scheduled_at,
        ))
        .await?;
    let with_story = options.also_story && page.platform == Platform::Facebook;

    if let Some(date) = options.scheduled_for {
        // Le planificateur publiera à l'heure dite
        if with_story {
            state
                .db
                .create_scheduled_post(NewScheduledPost::new(
                    options.post_id,
                    &page.id,
                    PostType::Story,
                    parse_date(date)?,
                ))
                .await?;
        }
        return Ok(PagePublishResult::ok(page_id, "scheduled", None));
    }

    tracing::info!(
        "🚀 [Reels] Publication sur {} {}...",
        page.platform,
        page.page_name
    );
    if page.platform == Platform::Facebook {
        let reel_id = facebook::publish_video_from_buffer(
            state,
            &page,
            options.video.clone(),
            options.description,
        )
        .await?;
        state
            .db
            .update_scheduled_post(
                &scheduled_post.id,
                Patch::new()
                    .set("published_at", Ts::now())
                    .set("external_post_id", reel_id.clone()),
            )
            .await?;
        let story_error = if with_story {
            publish_story(state, options.post_id, &page, options.video.clone()).await
        } else {
            None
        };
        Ok(PagePublishResult::ok(page_id, reel_id, story_error))
    } else {
        // TikTok finalise la publication de son côté : l'envoi est marqué comme
        // effectué pour ne pas republier, et le suivi de statut renseignera
        // l'identifiant définitif du post.
        let publish_id = tiktok::publish_video_from_buffer(
            state,
            &page,
            options.video.clone(),
            options.description,
        )
        .await?;
        state
            .db
            .update_scheduled_post(
                &scheduled_post.id,
                Patch::new()
                    .set("published_at", Ts::now())
                    .set("publish_id", publish_id.clone())
                    .set("publish_status", "PROCESSING_UPLOAD"),
            )
            .await?;
        Ok(PagePublishResult::ok(page_id, publish_id, None))
    }
}

/// Publie la story d'une page juste après son Reel : un échec est consigné sur
/// son entrée planifiée (visible dans l'historique) et renvoyé, sans faire
/// échouer le Reel.
async fn publish_story(
    state: &AppState,
    post_id: &str,
    page: &SocialPage,
    video: Bytes,
) -> Option<String> {
    // Créée seulement maintenant : en attente pendant l'envoi du Reel, le
    // planificateur aurait pu la publier une seconde fois.
    let mut scheduled_story_id: Option<String> = None;
    let result: anyhow::Result<()> = async {
        let scheduled = state
            .db
            .create_scheduled_post(NewScheduledPost::new(
                post_id,
                &page.id,
                PostType::Story,
                Ts::now(),
            ))
            .await?;
        scheduled_story_id = Some(scheduled.id.clone());
        let story_id = facebook::publish_video_story_from_buffer(state, page, video).await?;
        state
            .db
            .update_scheduled_post(
                &scheduled.id,
                Patch::new()
                    .set("published_at", Ts::now())
                    .set("external_post_id", story_id),
            )
            .await?;
        Ok(())
    }
    .await;

    match result {
        Ok(()) => None,
        Err(error) => {
            let message = error.to_string();
            tracing::error!(
                "❌ [Reels] Story sur {} impossible : {error:#}",
                page.page_name
            );
            if let Some(id) = scheduled_story_id {
                // Marquée comme traitée pour que le planificateur ne la republie pas en boucle
                if let Err(e) = state
                    .db
                    .update_scheduled_post(
                        &id,
                        Patch::new()
                            .set("published_at", Ts::now())
                            .set("error", message.clone()),
                    )
                    .await
                {
                    tracing::error!("⚠️ [Reels] Échec de la story non enregistré : {e}");
                }
            }
            Some(message)
        }
    }
}

/// Message d'erreur lisible lorsque toutes les publications ont échoué.
pub fn describe_publish_failure(results: &[PagePublishResult]) -> String {
    let details: Vec<&str> = results
        .iter()
        .filter_map(|r| r.error.as_deref())
        .filter(|e| !e.is_empty())
        .collect();
    if details.is_empty() {
        "Publication impossible sur toutes les pages".into()
    } else {
        format!(
            "Publication impossible sur toutes les pages : {}",
            details.join(" ; ")
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_d_echec_global() {
        let results = vec![
            PagePublishResult::failed("a", "Page non trouvée"),
            PagePublishResult::failed("b", "Jeton expiré"),
        ];
        assert_eq!(
            describe_publish_failure(&results),
            "Publication impossible sur toutes les pages : Page non trouvée ; Jeton expiré"
        );
        assert_eq!(
            describe_publish_failure(&[]),
            "Publication impossible sur toutes les pages"
        );
    }

    #[test]
    fn resultat_serialise_sans_champs_vides() {
        let value = serde_json::to_value(PagePublishResult::ok("p", "scheduled", None)).unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "pageId": "p", "success": true, "reelId": "scheduled" })
        );
    }
}
