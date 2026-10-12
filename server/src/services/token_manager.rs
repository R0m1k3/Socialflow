//! Contrôle et renouvellement des jetons de page.
//!
//! STUB — à porter depuis `server/services/token_manager.ts`.
#![allow(unused_variables)]

use serde::Serialize;

use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenCheckResult {
    pub page_id: String,
    pub page_name: String,
    /// 'valid' | 'expiring' | 'expired' | 'error'
    pub status: String,
    /// Vrai quand ce passage a effectivement réécrit un nouveau jeton.
    pub renewed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Contrôle toutes les pages et renouvelle les jetons qui doivent l'être.
pub async fn check_and_refresh_tokens(state: &AppState) -> Vec<TokenCheckResult> {
    Vec::new()
}
