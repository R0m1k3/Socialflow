//! Reels : file de rendus persistante, montage (service FFmpeg + service
//! Remotion), publication.

pub mod assets;
pub mod params;
pub mod pipeline;
pub mod publish;
pub mod queue;
pub mod remotion;
pub mod tts_sync;

use serde_json::Value;

use crate::state::AppState;

/// Démarre le worker de la file `reel_jobs` : récupération des jobs
/// orphelins, puis traitement de la file (réveil à l'ajout d'un job et
/// toutes les 10 s).
pub fn start(state: AppState) {
    queue::start(state);
}

/// Adresse http(s) du service Qwen saisie dans les paramètres, sans « / » final ; None si invalide.
pub fn normalize_qwen_url(value: Option<&Value>) -> Option<String> {
    let text = value?.as_str()?.trim();
    if text.is_empty() {
        return None;
    }
    let url = url::Url::parse(text).ok()?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return None;
    }
    Some(url.to_string().trim_end_matches('/').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn adresse_qwen() {
        assert_eq!(
            normalize_qwen_url(Some(&json!(" http://gpu:8001/ "))).as_deref(),
            Some("http://gpu:8001")
        );
        assert_eq!(normalize_qwen_url(Some(&json!("ftp://gpu"))), None);
        assert_eq!(normalize_qwen_url(Some(&json!(""))), None);
        assert_eq!(normalize_qwen_url(None), None);
    }
}
