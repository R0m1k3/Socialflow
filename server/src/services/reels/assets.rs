//! Résolution des ressources d'un Reel : musique, logo, clé Gemini, service
//! Qwen et nom du magasin.

use crate::db::AppConfig;
use crate::services::ffmpeg::QwenTarget;
use crate::services::media_store;
use crate::state::AppState;

/// URL de la musique téléchargeable par le service FFmpeg (réseau Docker
/// interne : l'URL publique HTTPS n'y est pas joignable).
pub async fn resolve_music_url(
    state: &AppState,
    music_track_id: Option<&str>,
    music_url: Option<&str>,
) -> Option<String> {
    if let Some(url) = music_url.filter(|u| !u.is_empty()) {
        // Seuls les fichiers de l'application sont acceptés : le service FFmpeg
        // ne doit pas télécharger d'URL arbitraire (SSRF)
        if media_store::local_path(state, url).is_some() {
            return Some(media_store::resolve_internal_url(state, url));
        }
        tracing::warn!(
            "⚠️ [Reels] musicUrl ignorée (seules les URL /uploads/… sont acceptées) : {url}"
        );
    }
    let id = music_track_id?.strip_prefix("internal_")?;
    match state.db.get_audio_track(id).await {
        Ok(track) => track.map(|t| media_store::resolve_internal_url(state, &t.url)),
        Err(error) => {
            tracing::error!("⚠️ [Reels] Piste audio introuvable : {error}");
            None
        }
    }
}

/// Chemin relatif (/uploads/...) du logo configuré, s'il existe.
pub async fn resolve_logo_path(state: &AppState) -> Option<String> {
    match state.db.get_cloudinary_config().await {
        Ok(config) => config
            .and_then(|c| c.logo_public_id)
            .filter(|id| !id.is_empty())
            .map(|id| media_store::build_url(&id)),
        Err(error) => {
            tracing::error!("⚠️ [Reels] Configuration du logo illisible : {error}");
            None
        }
    }
}

/// Clé Gemini : configuration de l'application, sinon variable d'environnement.
/// Aussi transmise avec Qwen, qui se replie sur Gemini si le service local échoue.
pub async fn resolve_gemini_api_key(
    state: &AppState,
    tts_engine: Option<&str>,
) -> anyhow::Result<Option<String>> {
    if !matches!(tts_engine, Some("gemini") | Some("qwen")) {
        return Ok(None);
    }
    let app_config = state.db.get_app_config().await?;
    Ok(app_config
        .and_then(|c| c.gemini_api_key)
        .or_else(|| state.config.gemini_api_key.clone()))
}

/// Service Qwen TTS réglé dans les paramètres (sinon ffmpeg-api prend QWEN_TTS_URL).
pub async fn resolve_qwen_target(
    state: &AppState,
    tts_engine: Option<&str>,
) -> anyhow::Result<Option<QwenTarget>> {
    if tts_engine != Some("qwen") {
        return Ok(None);
    }
    Ok(qwen_target_from_config(
        state.db.get_app_config().await?.as_ref(),
    ))
}

pub fn qwen_target_from_config(app_config: Option<&AppConfig>) -> Option<QwenTarget> {
    let config = app_config?;
    let url = config.qwen_tts_url.as_ref().filter(|u| !u.is_empty())?;
    Some(QwenTarget {
        url: url.clone(),
        api_key: config.qwen_tts_api_key.clone(),
    })
}

/// Nom affiché dans l'outro : celui de la page choisie, sinon de la première page de l'utilisateur.
pub async fn resolve_store_name(
    state: &AppState,
    user_id: &str,
    preferred_page_id: Option<&str>,
) -> Option<String> {
    let result: Result<Option<String>, sqlx::Error> = async {
        if let Some(page_id) = preferred_page_id.filter(|p| !p.is_empty()) {
            if let Some(page) = state.db.get_social_page(page_id).await? {
                return Ok(Some(page.page_name));
            }
        }
        let pages = state.db.get_social_pages(user_id).await?;
        Ok(pages.into_iter().next().map(|p| p.page_name))
    }
    .await;
    match result {
        Ok(name) => name,
        Err(error) => {
            tracing::error!("⚠️ [Reels] Nom du magasin introuvable : {error}");
            None
        }
    }
}
