//! Publication Facebook / Instagram (API Graph).
//!
//! STUB — à porter depuis `server/services/facebook.ts` (+ `imageProcessor.ts`,
//! `emojiRenderer.ts`, `facebook_oauth.ts`, `utils/graph_client.ts`).
#![allow(unused_variables)]

use bytes::Bytes;

use crate::db::{Media, Post, PostType, SocialPage};
use crate::state::AppState;

/// Publie un post (feed, story…) sur une page Facebook ; renvoie l'identifiant externe.
pub async fn publish_post(
    state: &AppState,
    post: &Post,
    page: &SocialPage,
    post_type: PostType,
    media: &[Media],
) -> anyhow::Result<String> {
    anyhow::bail!("publication Facebook non implémentée")
}

/// Publie une vidéo (Reel) envoyée en binaire ; renvoie l'identifiant de la vidéo.
pub async fn publish_video_from_buffer(
    state: &AppState,
    page: &SocialPage,
    video: Bytes,
    description: &str,
) -> anyhow::Result<String> {
    anyhow::bail!("publication de vidéo Facebook non implémentée")
}

/// Publie une vidéo en story Facebook ; renvoie l'identifiant de la story.
pub async fn publish_video_story_from_buffer(
    state: &AppState,
    page: &SocialPage,
    video: Bytes,
) -> anyhow::Result<String> {
    anyhow::bail!("story vidéo Facebook non implémentée")
}
