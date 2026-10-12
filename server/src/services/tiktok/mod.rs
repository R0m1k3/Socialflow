//! Comptes TikTok : OAuth, renouvellement des jetons, publication de vidéos.
//!
//! STUB — à porter depuis `server/services/tiktok.ts`.
#![allow(unused_variables)]

use bytes::Bytes;

use crate::db::SocialPage;
use crate::state::AppState;

/// Envoie une vidéo à TikTok ; renvoie le `publish_id` (publication asynchrone).
pub async fn publish_video_from_buffer(
    state: &AppState,
    page: &SocialPage,
    video: Bytes,
    description: &str,
) -> anyhow::Result<String> {
    anyhow::bail!("publication TikTok non implémentée")
}

/// Interroge le statut des envois TikTok en attente et met à jour les publications.
pub async fn sync_pending_publications(state: &AppState) -> anyhow::Result<()> {
    Ok(())
}
