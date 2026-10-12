//! Contrôle et renouvellement des jetons de page (ex-`token_manager.ts`).
//!
//! Les jetons Facebook sont inspectés via /debug_token et régénérés à partir
//! du jeton utilisateur longue durée conservé lors de la connexion OAuth ;
//! les comptes TikTok sont contrôlés sur l'échéance de leur refresh token.

use chrono::Duration;
use serde::Serialize;

use crate::crypto::{decrypt, encrypt};
use crate::db::{Patch, Platform, SocialPage, TokenStatus};
use crate::services::facebook::{graph, oauth};
use crate::state::AppState;
use crate::time::Ts;

/// Un jeton dont l'échéance est plus proche que cette fenêtre est renouvelé
/// sans attendre : il reste largement le temps de réessayer les jours suivants
/// si Facebook est indisponible au moment du contrôle.
const RENEWAL_WINDOW_DAYS: i64 = 15;

/// En deçà de cette marge, un jeton non renouvelable est signalé « expiring ».
const WARNING_WINDOW_DAYS: i64 = 7;

/// En deçà de cette marge, l'autorisation TikTok est signalée « expiring ».
const TIKTOK_WARNING_DAYS: i64 = 30;

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

impl TokenCheckResult {
    fn new(page: &SocialPage, status: TokenStatus, renewed: bool, error: Option<String>) -> Self {
        Self {
            page_id: page.id.clone(),
            page_name: page.page_name.clone(),
            status: status.as_str().to_string(),
            renewed,
            error,
        }
    }
}

/// Contrôle toutes les pages actives et renouvelle les jetons qui doivent l'être.
pub async fn check_and_refresh_tokens(state: &AppState) -> Vec<TokenCheckResult> {
    tracing::info!("[TokenManager] Starting daily token check...");
    let mut results = Vec::new();

    let pages = match state.db.get_all_social_pages().await {
        Ok(pages) => pages,
        Err(error) => {
            tracing::error!("[TokenManager] Critical error in checkAndRefreshTokens: {error}");
            return results;
        }
    };

    for page in pages.iter().filter(|p| p.is_active == "true") {
        match process_page_token(state, page).await {
            Ok(result) => results.push(result),
            Err(error) => {
                let message = error.to_string();
                tracing::error!(
                    "[TokenManager] Error processing page {} ({}): {error:#}",
                    page.page_name,
                    page.id
                );
                if let Err(db_error) = persist_status(
                    state,
                    &page.id,
                    TokenStatus::Error,
                    Some(message.clone()),
                    None,
                )
                .await
                {
                    tracing::error!(
                        "[TokenManager] Impossible d'enregistrer le statut de {}: {db_error}",
                        page.page_name
                    );
                }
                results.push(TokenCheckResult::new(
                    page,
                    TokenStatus::Error,
                    false,
                    Some(message),
                ));
            }
        }
    }

    tracing::info!("[TokenManager] Finished token check.");
    results
}

/// Contrôle (et renouvellement) d'une seule page, déclenché depuis l'UI.
pub async fn check_page(state: &AppState, page_id: &str) -> anyhow::Result<TokenCheckResult> {
    let Some(page) = state.db.get_social_page(page_id).await? else {
        anyhow::bail!("Page introuvable");
    };
    process_page_token(state, &page).await
}

/// Échéance trop proche (ou dépassée) au regard de la fenêtre donnée.
pub fn expires_within(expires_at: Option<Ts>, now: Ts, days: i64) -> bool {
    expires_at.is_some_and(|at| {
        at.timestamp_millis() - now.timestamp_millis() < Duration::days(days).num_milliseconds()
    })
}

/// Date au format `toLocaleDateString('fr-FR')` (heure du serveur : UTC).
pub fn french_date(ts: Ts) -> String {
    ts.0.format("%d/%m/%Y").to_string()
}

async fn process_page_token(
    state: &AppState,
    page: &SocialPage,
) -> anyhow::Result<TokenCheckResult> {
    // Les comptes TikTok ont leur propre cycle de vie : l'access token ne dure
    // que 24h et se renouvelle avec le refresh token, pas via la Graph API.
    if page.platform == Platform::Tiktok {
        return process_tiktok_token(state, page).await;
    }

    tracing::info!("[TokenManager] Checking page: {}", page.page_name);

    // Jeton déjà déchiffré par la couche d'accès aux données
    let access_token = page.access_token.clone();

    // Sans application Facebook configurée, on ne peut ni interroger
    // /debug_token ni régénérer quoi que ce soit : on se rabat sur le
    // contrôle historique (le jeton répond-il encore ?).
    if !oauth::is_configured(state).await {
        return legacy_check(state, page, &access_token).await;
    }

    let info = match oauth::inspect_token(state, &access_token).await {
        Ok(info) => info,
        Err(error) => {
            // Facebook injoignable : on ne dégrade pas le statut sur un incident
            // réseau, sinon toute l'UI passerait au rouge le temps d'une panne.
            tracing::warn!(
                "[TokenManager] Inspection impossible pour {}: {error}",
                page.page_name
            );
            return legacy_check(state, page, &access_token).await;
        }
    };

    let expires_at = info.expires_at;
    let expiring_soon = expires_within(expires_at, Ts::now(), RENEWAL_WINDOW_DAYS);

    if info.is_valid && !expiring_soon {
        // Le jeton de page tient : on en profite pour prolonger le jeton
        // utilisateur s'il approche de son échéance, car c'est lui qui
        // permettra le prochain renouvellement.
        extend_user_token_if_needed(state, page).await;
        persist_status(state, &page.id, TokenStatus::Valid, None, Some(expires_at)).await?;
        return Ok(TokenCheckResult::new(page, TokenStatus::Valid, false, None));
    }

    let reason = if info.is_valid {
        format!(
            "Le jeton expire le {}",
            expires_at
                .map(french_date)
                .unwrap_or_else(|| "undefined".to_string())
        )
    } else {
        info.error
            .clone()
            .filter(|e| !e.is_empty())
            .unwrap_or_else(|| "Le jeton a été invalidé par Facebook".to_string())
    };
    tracing::warn!(
        "[TokenManager] {}: {reason} — tentative de renouvellement",
        page.page_name
    );

    let failing_status = if info.is_valid {
        TokenStatus::Expiring
    } else {
        TokenStatus::Expired
    };

    // Renouvellement automatique : c'est tout l'intérêt d'avoir conservé le
    // jeton utilisateur longue durée au moment de la connexion OAuth.
    match renew_from_user_token(state, page).await {
        Ok(true) => {
            tracing::info!(
                "[TokenManager] Jeton renouvelé automatiquement pour {}",
                page.page_name
            );
            return Ok(TokenCheckResult::new(page, TokenStatus::Valid, true, None));
        }
        Ok(false) => {}
        Err(error) => {
            let message = error.to_string();
            tracing::error!(
                "[TokenManager] Renouvellement impossible pour {}: {message}",
                page.page_name
            );
            persist_status(
                state,
                &page.id,
                failing_status,
                Some(message.clone()),
                Some(expires_at),
            )
            .await?;
            return Ok(TokenCheckResult::new(
                page,
                failing_status,
                false,
                Some(message),
            ));
        }
    }

    // Pas de jeton utilisateur en base : la page a été ajoutée à la main,
    // seule une reconnexion peut la remettre d'aplomb.
    let manual = format!(
        "{reason}. Reconnectez la page via « Connecter des pages Facebook » \
         pour activer le renouvellement automatique."
    );
    persist_status(
        state,
        &page.id,
        failing_status,
        Some(manual.clone()),
        Some(expires_at),
    )
    .await?;
    Ok(TokenCheckResult::new(
        page,
        failing_status,
        false,
        Some(manual),
    ))
}

/// Jeton utilisateur conservé (chiffré) sur la page, s'il existe.
fn stored_user_token(page: &SocialPage) -> Option<String> {
    page.user_access_token
        .as_deref()
        .filter(|t| !t.is_empty())
        .map(decrypt)
}

/// Régénère le jeton de page à partir du jeton utilisateur longue durée.
/// Renvoie `false` quand la page n'a pas de jeton utilisateur enregistré.
async fn renew_from_user_token(state: &AppState, page: &SocialPage) -> anyhow::Result<bool> {
    let Some(stored) = stored_user_token(page) else {
        return Ok(false);
    };

    // On prolonge d'abord le jeton utilisateur : le ré-échanger repart pour
    // ~60 jours, ce qui repousse d'autant la prochaine reconnexion manuelle.
    // Un échec ici n'est pas bloquant tant que le jeton actuel fonctionne.
    let mut user_token = stored.clone();
    let mut user_token_expires_at = page.user_token_expires_at;
    match oauth::extend_user_token(state, &stored).await {
        Ok(extended) => {
            user_token = extended.access_token;
            user_token_expires_at = extended.expires_at;
        }
        Err(error) => tracing::warn!(
            "[TokenManager] Prolongation du jeton utilisateur impossible pour {}: {error}",
            page.page_name
        ),
    }

    let targets = oauth::list_pages(state, &user_token).await?;
    // Une page Instagram est publiée avec le jeton de la page Facebook à
    // laquelle son compte professionnel est rattaché.
    let Some(target) = targets.iter().find(|t| {
        t.id == page.page_id || t.instagram.as_ref().is_some_and(|ig| ig.id == page.page_id)
    }) else {
        return Err(oauth::FacebookAuthError(format!(
            "La page « {} » n'est plus administrée par le compte Facebook connecté. \
             Reconnectez-la avec un compte administrateur de cette page.",
            page.page_name
        ))
        .into());
    };

    // Un jeton de page dérivé d'un jeton utilisateur longue durée n'expire
    // pas : l'échéance reste donc généralement nulle. L'inspection est un
    // confort : le jeton fraîchement émis est bon.
    let page_token_expires_at = oauth::inspect_token(state, &target.access_token)
        .await
        .ok()
        .and_then(|info| info.expires_at);

    let followers = if target.followers_count != 0 {
        Some(target.followers_count)
    } else {
        page.followers_count
    };

    state
        .db
        .update_social_page(
            &page.id,
            Patch::new()
                .set("access_token", target.access_token.clone())
                .set("token_expires_at", page_token_expires_at)
                .set("user_access_token", encrypt(&user_token))
                .set("user_token_expires_at", user_token_expires_at)
                .set("followers_count", followers)
                .set("token_status", TokenStatus::Valid)
                .set_null("token_error")
                .set("last_token_check", Ts::now()),
        )
        .await?;

    Ok(true)
}

/// Prolonge le jeton utilisateur quand son échéance approche, même si le
/// jeton de page se porte bien : c'est ce qui évite de perdre la capacité de
/// renouveler le jour où le jeton de page est révoqué.
async fn extend_user_token_if_needed(state: &AppState, page: &SocialPage) {
    let Some(stored) = stored_user_token(page) else {
        return;
    };
    if let Some(expires_at) = page.user_token_expires_at {
        if !expires_within(Some(expires_at), Ts::now(), RENEWAL_WINDOW_DAYS) {
            return;
        }
    }

    let result = async {
        let extended = oauth::extend_user_token(state, &stored).await?;
        state
            .db
            .update_social_page(
                &page.id,
                Patch::new()
                    .set("user_access_token", encrypt(&extended.access_token))
                    .set("user_token_expires_at", extended.expires_at),
            )
            .await?;
        anyhow::Ok(())
    }
    .await;

    match result {
        Ok(()) => tracing::info!(
            "[TokenManager] Jeton utilisateur prolongé pour {}",
            page.page_name
        ),
        Err(error) => tracing::warn!(
            "[TokenManager] Impossible de prolonger le jeton utilisateur de {}: {error}",
            page.page_name
        ),
    }
}

/// Contrôle historique, utilisé quand l'application Facebook n'est pas
/// configurée : on sait seulement si le jeton répond encore.
async fn legacy_check(
    state: &AppState,
    page: &SocialPage,
    access_token: &str,
) -> anyhow::Result<TokenCheckResult> {
    if !verify_token(state, access_token).await {
        let error = "Le jeton n'est plus accepté par Facebook. Configurez l'application Facebook \
                     dans les paramètres pour activer le renouvellement automatique, ou saisissez un nouveau jeton."
            .to_string();
        persist_status(
            state,
            &page.id,
            TokenStatus::Expired,
            Some(error.clone()),
            None,
        )
        .await?;
        return Ok(TokenCheckResult::new(
            page,
            TokenStatus::Expired,
            false,
            Some(error),
        ));
    }

    // Le jeton répond : reste l'échéance déclarée à l'ajout de la page.
    let status = if expires_within(page.token_expires_at, Ts::now(), WARNING_WINDOW_DAYS) {
        TokenStatus::Expiring
    } else {
        TokenStatus::Valid
    };
    persist_status(state, &page.id, status, None, None).await?;
    Ok(TokenCheckResult::new(page, status, false, None))
}

/// Statut d'un compte TikTok d'après l'échéance de son refresh token.
pub fn tiktok_status(
    refresh_token: Option<&str>,
    refresh_expires_at: Option<Ts>,
    now: Ts,
) -> TokenStatus {
    // Échéance absente = 0, comme l'ancien serveur
    let expires_ms = refresh_expires_at
        .map(|t| t.timestamp_millis())
        .unwrap_or(0);
    let now_ms = now.timestamp_millis();
    let has_refresh = refresh_token.is_some_and(|t| !t.is_empty());

    if !has_refresh || (expires_ms != 0 && expires_ms <= now_ms) {
        TokenStatus::Expired
    } else if expires_ms != 0
        && expires_ms - now_ms < Duration::days(TIKTOK_WARNING_DAYS).num_milliseconds()
    {
        TokenStatus::Expiring
    } else {
        TokenStatus::Valid
    }
}

/// Vérifie qu'un compte TikTok est toujours utilisable.
/// On ne teste pas l'access token (il est renouvelé à la demande avant chaque
/// publication) mais le refresh token, dont l'expiration déconnecterait le compte.
async fn process_tiktok_token(
    state: &AppState,
    page: &SocialPage,
) -> anyhow::Result<TokenCheckResult> {
    tracing::info!("[TokenManager] Checking TikTok account: {}", page.page_name);

    let status = tiktok_status(
        page.refresh_token.as_deref(),
        page.refresh_token_expires_at,
        Ts::now(),
    );
    let error = (status == TokenStatus::Expired).then(|| {
        tracing::warn!(
            "[TokenManager] TikTok account {} must be reconnected",
            page.page_name
        );
        "L'autorisation TikTok a expiré : reconnectez le compte.".to_string()
    });

    persist_status(state, &page.id, status, error.clone(), None).await?;
    Ok(TokenCheckResult::new(page, status, false, error))
}

/// Enregistre le résultat du contrôle ; `token_expires_at` n'est modifié que
/// s'il est fourni (`Some(None)` l'efface).
async fn persist_status(
    state: &AppState,
    page_id: &str,
    status: TokenStatus,
    error: Option<String>,
    token_expires_at: Option<Option<Ts>>,
) -> anyhow::Result<()> {
    let mut patch = Patch::new()
        .set("token_status", status)
        .set("token_error", error)
        .set("last_token_check", Ts::now());
    if let Some(expires_at) = token_expires_at {
        patch = patch.set("token_expires_at", expires_at);
    }
    state.db.update_social_page(page_id, patch).await?;
    Ok(())
}

/// Le jeton répond-il encore (`GET /me`) ?
async fn verify_token(state: &AppState, token: &str) -> bool {
    match graph::get(state, "me", Some(token), &[]).await {
        Ok(_) => true,
        Err(error) => {
            tracing::error!("[TokenManager] Token verification failed: {error}");
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts(s: &str) -> Ts {
        Ts::parse(s).unwrap()
    }

    #[test]
    fn expiry_window() {
        let now = ts("2026-01-01T00:00:00Z");
        assert!(!expires_within(None, now, 15));
        assert!(expires_within(Some(ts("2026-01-10T00:00:00Z")), now, 15));
        assert!(expires_within(Some(ts("2025-12-01T00:00:00Z")), now, 15));
        assert!(!expires_within(Some(ts("2026-01-20T00:00:00Z")), now, 15));
        assert!(expires_within(Some(ts("2026-01-07T23:00:00Z")), now, 7));
    }

    #[test]
    fn french_date_format() {
        assert_eq!(french_date(ts("2026-03-05T10:00:00Z")), "05/03/2026");
    }

    #[test]
    fn tiktok_statuses() {
        let now = ts("2026-01-01T00:00:00Z");
        assert_eq!(tiktok_status(None, None, now), TokenStatus::Expired);
        assert_eq!(tiktok_status(Some(""), None, now), TokenStatus::Expired);
        assert_eq!(tiktok_status(Some("r"), None, now), TokenStatus::Valid);
        assert_eq!(
            tiktok_status(Some("r"), Some(ts("2025-12-31T00:00:00Z")), now),
            TokenStatus::Expired
        );
        assert_eq!(
            tiktok_status(Some("r"), Some(ts("2026-01-15T00:00:00Z")), now),
            TokenStatus::Expiring
        );
        assert_eq!(
            tiktok_status(Some("r"), Some(ts("2026-06-01T00:00:00Z")), now),
            TokenStatus::Valid
        );
    }
}
