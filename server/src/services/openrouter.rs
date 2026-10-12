//! Génération de textes par IA (OpenRouter).
//!
//! STUB — à porter depuis `server/services/openrouter.ts`.
#![allow(unused_variables)]

use axum::http::StatusCode;
use serde_json::Value;

use crate::state::AppState;

/// Génère les variantes de texte (`{ variant, text, characterCount }`).
pub async fn generate_post_text(
    state: &AppState,
    product_info: &Value,
    user_id: &str,
    model_override: Option<&str>,
) -> anyhow::Result<Vec<Value>> {
    anyhow::bail!("Configuration OpenRouter non trouvée")
}

/// Statut HTTP et message à renvoyer pour une erreur de génération.
pub fn describe_generation_error(error: &anyhow::Error) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}
