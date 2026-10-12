//! Routes de gestion des comptes TikTok (montées sous `/api/tiktok`, connexion requise).
//!
//! Un compte TikTok de magasin se connecte en OAuth (TikTok n'autorise pas la
//! saisie manuelle d'un token), puis vit dans `social_pages` comme une page
//! Facebook : mêmes permissions, même planification, même calendrier.

use axum::extract::{Path, State};
use axum::http::header::{CONTENT_TYPE, LOCATION};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use rand::RngCore;
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::config::Config;
use crate::db::{NewSocialPage, Patch, Platform};
use crate::error::{ApiResult, AppError};
use crate::extract::{Body, QueryMap};
use crate::services::tiktok;
use crate::state::AppState;

/// Page vers laquelle on renvoie le navigateur à la fin du flux OAuth.
const RETURN_PATH: &str = "/pages";

/// Clé de session de l'état OAuth (protection CSRF).
const OAUTH_STATE_KEY: &str = "tiktokOAuthState";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/config", get(get_config).put(put_config))
        .route("/connect", get(connect))
        .route("/callback", get(callback))
        .route("/accounts/{id}/creator-info", get(creator_info))
}

fn build_return_url(success: bool, message: &str) -> String {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("tiktok", if success { "success" } else { "error" })
        .append_pair("message", message)
        .finish();
    format!("{RETURN_PATH}?{query}")
}

/// Redirection 302, comme `res.redirect()` d'Express.
fn redirect(location: &str) -> Response {
    (
        StatusCode::FOUND,
        [
            (LOCATION, location.to_string()),
            (CONTENT_TYPE, "text/plain; charset=utf-8".to_string()),
        ],
        format!("Found. Redirecting to {location}"),
    )
        .into_response()
}

fn redirect_error(message: &str) -> Response {
    redirect(&build_return_url(false, message))
}

/// État de la configuration TikTok.
/// Le client secret n'est jamais renvoyé au client.
async fn get_config(
    State(state): State<AppState>,
    headers: HeaderMap,
    user: AuthUser,
) -> ApiResult<Json<Value>> {
    let config = state.db.get_tiktok_config().await.map_err(|e| {
        tracing::error!("❌ [TikTok] Erreur lecture configuration: {e}");
        AppError::internal("Impossible de lire la configuration TikTok")
    })?;
    let configured = tiktok::is_configured(&state).await;

    // Tout le monde a besoin de savoir si la connexion est possible ; seuls les
    // admins voient les détails de l'application développeur.
    if !user.is_admin() {
        return Ok(Json(json!({ "configured": configured })));
    }

    let client_key = config
        .as_ref()
        .map(|c| c.client_key.clone())
        .filter(|k| !k.is_empty())
        .unwrap_or_else(|| {
            if Config::var("TIKTOK_CLIENT_KEY").is_some() {
                "(défini par variable d'environnement)".to_string()
            } else {
                String::new()
            }
        });
    let has_client_secret = config.as_ref().is_some_and(|c| !c.client_secret.is_empty())
        || Config::var("TIKTOK_CLIENT_SECRET").is_some();

    Ok(Json(json!({
        "configured": configured,
        "clientKey": client_key,
        "hasClientSecret": has_client_secret,
        "redirectUri": tiktok::redirect_uri(&state, Some(&headers)),
    })))
}

/// Type d'une valeur JSON tel que le nomme zod (`Expected string, received …`).
fn zod_type(value: Option<&Value>) -> &'static str {
    match value {
        None => "undefined",
        Some(Value::Null) => "null",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Number(_)) => "number",
        Some(Value::String(_)) => "string",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
    }
}

/// `z.string().trim().min(1, message)` : valeur rognée, ou message d'erreur zod.
fn required_trimmed(value: Option<&Value>, empty_message: &str) -> Result<String, String> {
    match value {
        None => Err("Required".to_string()),
        Some(Value::String(s)) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                Err(empty_message.to_string())
            } else {
                Ok(trimmed.to_string())
            }
        }
        Some(other) => Err(format!(
            "Expected string, received {}",
            zod_type(Some(other))
        )),
    }
}

/// Validation du corps de `PUT /config` (schémas `insertTiktokConfigSchema` /
/// `updateTiktokConfigSchema`) : renvoie le premier message d'erreur, comme la route.
fn validate_config(
    body: &Value,
    secret_required: bool,
) -> Result<(String, Option<String>), String> {
    if !body.is_object() {
        return Err(format!(
            "Expected object, received {}",
            zod_type(Some(body))
        ));
    }
    let client_key =
        required_trimmed(body.get("clientKey"), "Le client key ne peut pas être vide")?;
    let secret_message = "Le client secret ne peut pas être vide";
    let client_secret = match body.get("clientSecret") {
        // Le secret peut être omis lors d'une mise à jour : on garde l'existant
        None if !secret_required => None,
        value => Some(required_trimmed(value, secret_message)?),
    };
    Ok((client_key, client_secret))
}

/// Enregistre les identifiants de l'application développeur TikTok (admin).
async fn put_config(
    State(state): State<AppState>,
    headers: HeaderMap,
    user: AuthUser,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    if !user.is_admin() {
        return Err(AppError::forbidden(
            "Accès refusé. Réservé aux administrateurs.",
        ));
    }

    let invalid = |message: String| {
        tracing::error!("❌ [TikTok] Erreur enregistrement configuration: {message}");
        AppError::bad_request(if message.is_empty() {
            "Configuration TikTok invalide".to_string()
        } else {
            message
        })
    };

    let existing = state
        .db
        .get_tiktok_config()
        .await
        .map_err(|e| invalid(tiktok::error_message(&e.into())))?;
    let (client_key, client_secret) =
        validate_config(&body, existing.is_none()).map_err(invalid)?;

    let config = state
        .db
        .upsert_tiktok_config(Some(&client_key), client_secret.as_deref())
        .await
        .map_err(|e| invalid(tiktok::error_message(&e)))?;

    Ok(Json(json!({
        "success": true,
        "clientKey": config.client_key,
        "redirectUri": tiktok::redirect_uri(&state, Some(&headers)),
    })))
}

/// Démarre la connexion d'un compte TikTok.
/// À appeler par navigation complète du navigateur (window.location), pas en fetch.
async fn connect(State(state): State<AppState>, headers: HeaderMap, user: AuthUser) -> Response {
    if !tiktok::is_configured(&state).await {
        return redirect_error(
            "TikTok n'est pas configuré. Renseignez d'abord le client key et le client secret.",
        );
    }

    // Protection CSRF : l'état est vérifié au retour
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    let oauth_state = hex::encode(bytes);
    let mut session = user.session;
    session.set(OAUTH_STATE_KEY, Value::String(oauth_state.clone()));

    let auth_url = match tiktok::build_authorization_url(&state, &oauth_state, Some(&headers)).await
    {
        Ok(url) => url,
        Err(error) => {
            tracing::error!("❌ [TikTok] Erreur démarrage OAuth: {error:#}");
            return redirect_error(&tiktok::error_message(&error));
        }
    };

    // La session doit être écrite avant la redirection, sinon l'état est perdu
    if let Err(error) = session.save(&state).await {
        tracing::error!("❌ [TikTok] Impossible de sauvegarder la session OAuth: {error}");
        return redirect_error("Erreur de session, réessayez.");
    }
    redirect(&auth_url)
}

/// Retour d'autorisation TikTok : échange le code, puis crée ou met à jour le
/// compte dans social_pages.
async fn callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    user: AuthUser,
    query: QueryMap,
) -> Response {
    match handle_callback(&state, &headers, user, &query).await {
        Ok(response) => response,
        Err(error) => {
            tracing::error!("❌ [TikTok] Erreur callback OAuth: {error:#}");
            redirect_error(&tiktok::error_message(&error))
        }
    }
}

async fn handle_callback(
    state: &AppState,
    headers: &HeaderMap,
    user: AuthUser,
    query: &QueryMap,
) -> anyhow::Result<Response> {
    if let Some(oauth_error) = query.non_empty("error") {
        let description = query.non_empty("error_description").unwrap_or(oauth_error);
        return Ok(redirect_error(&format!(
            "Autorisation TikTok refusée : {description}"
        )));
    }

    let AuthUser { user, mut session } = user;
    let expected_state = session.get_str(OAUTH_STATE_KEY);
    if session.remove(OAUTH_STATE_KEY).is_some() {
        if let Err(error) = session.save(state).await {
            tracing::warn!("⚠️ [TikTok] Session non enregistrée après le retour OAuth: {error}");
        }
    }

    let received_state = query.non_empty("state");
    let state_ok = matches!(
        (received_state, expected_state.as_deref()),
        (Some(received), Some(expected)) if !expected.is_empty() && received == expected
    );
    if !state_ok {
        return Ok(redirect_error(
            "Requête de connexion TikTok invalide (état non reconnu).",
        ));
    }

    let Some(code) = query.non_empty("code") else {
        return Ok(redirect_error("Aucun code d'autorisation reçu de TikTok."));
    };

    let tokens = tiktok::exchange_code_for_token(state, code, Some(headers)).await?;
    let profile = tiktok::get_user_info(state, &tokens.access_token).await?;
    let open_id = profile
        .open_id
        .clone()
        .or_else(|| tokens.open_id.clone().filter(|id| !id.is_empty()))
        .ok_or_else(|| {
            anyhow::anyhow!("Réponse TikTok inattendue : identifiant du compte absent")
        })?;

    // Un compte déjà connecté est mis à jour plutôt que dupliqué
    let existing_pages = state.db.get_social_pages(&user.id).await?;
    let existing = existing_pages
        .iter()
        .find(|p| p.platform == Platform::Tiktok && p.page_id == open_id);

    if let Some(existing) = existing {
        state
            .db
            .update_social_page(
                &existing.id,
                Patch::new()
                    .set("page_name", profile.display_name.clone())
                    .set("avatar_url", profile.avatar_url.clone())
                    .set("is_active", "true"),
            )
            .await?;
        tiktok::persist_tokens(state, &existing.id, &tokens).await?;

        tracing::info!("🔁 [TikTok] Compte reconnecté: {}", profile.display_name);
        return Ok(redirect(&build_return_url(
            true,
            &format!("Compte TikTok \"{}\" reconnecté.", profile.display_name),
        )));
    }

    let (token_expires_at, refresh_token_expires_at) = tiktok::token_expirations(&tokens);
    let page = state
        .db
        .create_social_page(NewSocialPage {
            user_id: user.id.clone(),
            platform: Some(Platform::Tiktok),
            page_id: open_id.clone(),
            page_name: profile.display_name.clone(),
            access_token: tokens.access_token.clone(),
            token_expires_at,
            refresh_token: tokens.refresh_token.clone(),
            refresh_token_expires_at,
            scopes: tokens.scope.clone(),
            avatar_url: profile.avatar_url.clone(),
            is_active: Some("true".to_string()),
            ..Default::default()
        })
        .await?;

    // Les non-admins ne voient que les pages qui leur sont explicitement
    // attribuées : sans cette permission, ils ne verraient pas leur propre compte.
    if !user.is_admin() {
        if let Err(error) = state.db.create_page_permission(&user.id, &page.id).await {
            tracing::error!("⚠️ [TikTok] Impossible de créer la permission de page: {error}");
        }
    }

    tracing::info!(
        "✅ [TikTok] Nouveau compte connecté: {} ({open_id})",
        profile.display_name
    );
    Ok(redirect(&build_return_url(
        true,
        &format!("Compte TikTok \"{}\" connecté.", profile.display_name),
    )))
}

/// Options réellement autorisées sur un compte (confidentialité, commentaires,
/// duo, stitch, durée max). TikTok impose de les afficher avant publication.
async fn creator_info(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let bad_gateway = |error: anyhow::Error| {
        tracing::error!("❌ [TikTok] Erreur récupération creator info: {error:#}");
        AppError::json(
            StatusCode::BAD_GATEWAY,
            json!({ "error": tiktok::error_message(&error) }),
        )
    };

    let page = state
        .db
        .get_social_page(&id)
        .await
        .map_err(|e| bad_gateway(e.into()))?;
    let Some(page) = page.filter(|p| p.platform == Platform::Tiktok) else {
        return Err(AppError::not_found("Compte TikTok non trouvé"));
    };

    if !user.is_admin() && page.user_id != user.id {
        let accessible = state
            .db
            .get_user_accessible_pages(&user.id)
            .await
            .map_err(|e| bad_gateway(e.into()))?;
        if !accessible.iter().any(|p| p.id == page.id) {
            return Err(AppError::forbidden("Accès refusé à ce compte"));
        }
    }

    let info = tiktok::get_creator_info(&state, &page)
        .await
        .map_err(bad_gateway)?;
    Ok(Json(serde_json::to_value(info).unwrap_or(Value::Null)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn return_url_is_url_encoded() {
        assert_eq!(
            build_return_url(true, "Compte TikTok \"Nancy\" connecté."),
            "/pages?tiktok=success&message=Compte+TikTok+%22Nancy%22+connect%C3%A9."
        );
    }

    #[test]
    fn config_validation_matches_zod_messages() {
        assert_eq!(
            validate_config(&json!({ "clientKey": " k ", "clientSecret": " s " }), true),
            Ok(("k".to_string(), Some("s".to_string())))
        );
        assert_eq!(
            validate_config(&json!({ "clientKey": "k" }), true),
            Err("Required".to_string())
        );
        assert_eq!(
            validate_config(&json!({ "clientKey": "k" }), false),
            Ok(("k".to_string(), None))
        );
        assert_eq!(
            validate_config(&json!({ "clientKey": "  " }), false),
            Err("Le client key ne peut pas être vide".to_string())
        );
        assert_eq!(
            validate_config(&json!({ "clientKey": "k", "clientSecret": "" }), false),
            Err("Le client secret ne peut pas être vide".to_string())
        );
        assert_eq!(
            validate_config(&json!({ "clientKey": 3 }), false),
            Err("Expected string, received number".to_string())
        );
        assert_eq!(
            validate_config(&json!({ "clientKey": "k", "clientSecret": null }), false),
            Err("Expected string, received null".to_string())
        );
        assert_eq!(
            validate_config(&json!([]), false),
            Err("Expected object, received array".to_string())
        );
    }
}
