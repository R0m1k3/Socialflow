//! Reels : file de rendus persistante, montage, publication.
//!
//! STUB — à porter depuis `server/services/reels/*`.
#![allow(unused_variables)]

use serde_json::Value;

use crate::state::AppState;

/// Démarre le worker de la file `reel_jobs`.
pub fn start(state: AppState) {}

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
