//! URL publique de l'application.
//!
//! Les flux OAuth (Facebook, TikTok) exigent une URI de redirection exacte.
//! `APP_URL` prime ; à défaut, l'URL est reconstruite depuis la requête
//! (en-têtes `X-Forwarded-Proto` / `X-Forwarded-Host` posés par Nginx).

use axum::http::HeaderMap;

use crate::state::AppState;

const DEV_FALLBACK: &str = "http://localhost:5555";

fn first_header_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Base publique sans « / » final (« https://exemple.fr »).
pub fn resolve_public_base_url(state: &AppState, headers: Option<&HeaderMap>) -> String {
    if let Some(url) = &state.config.app_url {
        return url.clone();
    }
    if let Some(headers) = headers {
        let host = first_header_value(headers, "x-forwarded-host").or_else(|| first_header_value(headers, "host"));
        if let Some(host) = host {
            let protocol = first_header_value(headers, "x-forwarded-proto").unwrap_or_else(|| "http".into());
            return format!("{protocol}://{host}");
        }
    }
    DEV_FALLBACK.to_string()
}

/// La requête est-elle arrivée en HTTPS (directement ou derrière le proxy) ?
pub fn is_https(state: &AppState, headers: &HeaderMap) -> bool {
    if let Some(url) = &state.config.app_url {
        if url.starts_with("https://") {
            return true;
        }
    }
    first_header_value(headers, "x-forwarded-proto").as_deref() == Some("https")
}
