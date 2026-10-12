//! Client du service FFmpeg (conteneur Python `ffmpeg-service`).
//!
//! STUB — à porter depuis `server/services/ffmpeg.ts`.
#![allow(unused_variables)]

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::state::AppState;

/// Service Qwen TTS (local ou serveur GPU) réglé dans les paramètres.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QwenTarget {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

/// Catalogue des voix renvoyé par le service (noms de champs du service Python).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VoiceCatalog {
    #[serde(default)]
    pub qwen: Vec<Value>,
    #[serde(default)]
    pub qwen_available: bool,
    /// Modèle et carte graphique du service Qwen, null s'il ne répond pas.
    #[serde(default)]
    pub qwen_status: Option<Value>,
    #[serde(default)]
    pub gemini: Vec<Value>,
    #[serde(default)]
    pub edge: Vec<Value>,
}

/// Le service répond-il ?
pub async fn health_check(state: &AppState) -> bool {
    false
}

/// Voix disponibles ; `qwen` remplace la cible Qwen configurée côté service.
pub async fn list_voices(state: &AppState, qwen: Option<QwenTarget>) -> anyhow::Result<VoiceCatalog> {
    anyhow::bail!("service FFmpeg non implémenté")
}
