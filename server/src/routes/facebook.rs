//! Connexion et renouvellement des pages Facebook / Instagram (ex-`routes/facebook.ts`).
//!
//! Une page connectée ici embarque le jeton utilisateur longue durée qui a servi
//! à l'obtenir : c'est ce qui permet au gestionnaire de jetons de régénérer son
//! jeton de page tout seul, au lieu d'exiger un copier-coller depuis le Graph
//! Explorer tous les deux mois.
//!
//! Routeur monté sous `/api/facebook` ; toutes les routes exigent une session.

use axum::extract::{Path, State};
use axum::http::header::LOCATION;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use rand::RngCore;
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::config::Config;
use crate::crypto::encrypt;
use crate::db::{NewSocialPage, Patch, Platform, TokenStatus};
use crate::error::{ApiResult, AppError, OrApiError};
use crate::extract::{Body, QueryMap};
use crate::services::facebook::oauth;
use crate::services::token_manager;
use crate::state::AppState;
use crate::time::Ts;

/// Page vers laquelle on renvoie le navigateur à la fin du flux OAuth.
const RETURN_PATH: &str = "/pages";

/// Clé de session de l'état OAuth (protection CSRF).
const SESSION_STATE_KEY: &str = "facebookOAuthState";

const ADMIN_ONLY: &str = "Accès refusé. Réservé aux administrateurs.";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/config", get(get_config).put(put_config))
        .route("/connect", get(connect))
        .route("/callback", get(callback))
        .route("/pages/{id}/refresh", post(refresh_page))
        .route("/tokens/check", post(check_tokens))
}

pub fn build_return_url(success: bool, message: &str) -> String {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("facebook", if success { "success" } else { "error" })
        .append_pair("message", message)
        .finish();
    format!("{RETURN_PATH}?{query}")
}

/// Redirection 302, comme `res.redirect` d'Express.
fn redirect(location: &str) -> Response {
    match location.parse::<axum::http::HeaderValue>() {
        Ok(value) => (StatusCode::FOUND, [(LOCATION, value)]).into_response(),
        Err(_) => (StatusCode::FOUND, [(LOCATION, RETURN_PATH)]).into_response(),
    }
}

fn redirect_error(message: &str) -> Response {
    redirect(&build_return_url(false, message))
}

/// État de la configuration Facebook. L'App Secret n'est jamais renvoyé.
async fn get_config(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    let config = state
        .db
        .get_facebook_config()
        .await
        .or_500("Impossible de lire la configuration Facebook")?;
    let configured = oauth::is_configured(&state).await;

    // Tout le monde a besoin de savoir si la connexion est possible ; seuls les
    // admins voient les détails de l'application développeur.
    if !user.is_admin() {
        return Ok(Json(json!({ "configured": configured })));
    }

    let app_id = config
        .as_ref()
        .map(|c| c.app_id.clone())
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| {
            if Config::var("FACEBOOK_APP_ID").is_some() {
                "(défini par variable d'environnement)".to_string()
            } else {
                String::new()
            }
        });
    let has_app_secret = config.as_ref().is_some_and(|c| !c.app_secret.is_empty())
        || Config::var("FACEBOOK_APP_SECRET").is_some();

    Ok(Json(json!({
        "configured": configured,
        "appId": app_id,
        "hasAppSecret": has_app_secret,
        "redirectUri": oauth::redirect_uri(&state, Some(&headers)),
        "scopes": oauth::scopes().split(',').collect::<Vec<_>>(),
    })))
}

fn js_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// Champ texte validé comme `z.string().trim().min(1, message)` ;
/// `Ok(None)` = absent et facultatif.
fn required_string(
    body: &Value,
    key: &str,
    empty_message: &str,
    optional: bool,
) -> Result<Option<String>, String> {
    match body.get(key) {
        None if optional => Ok(None),
        None => Err("Required".to_string()),
        Some(Value::String(s)) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                Err(empty_message.to_string())
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        Some(other) => Err(format!("Expected string, received {}", js_type(other))),
    }
}

/// Valide le corps de `PUT /config` ; renvoie (appId, appSecret facultatif).
pub fn validate_config_body(
    body: &Value,
    secret_optional: bool,
) -> Result<(String, Option<String>), String> {
    if !body.is_object() {
        return Err(format!("Expected object, received {}", js_type(body)));
    }
    let app_id = required_string(body, "appId", "L'App ID ne peut pas être vide", false);
    let app_secret = required_string(
        body,
        "appSecret",
        "L'App Secret ne peut pas être vide",
        secret_optional,
    );
    // Première erreur dans l'ordre du schéma
    let app_id = app_id?.unwrap_or_default();
    let app_secret = app_secret?;
    Ok((app_id, app_secret))
}

/// Enregistre les identifiants de l'application Facebook (admin).
async fn put_config(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    if !user.is_admin() {
        return Err(AppError::forbidden(ADMIN_ONLY));
    }

    let bad_request = |message: String| {
        tracing::error!("❌ [Facebook] Erreur enregistrement configuration: {message}");
        AppError::bad_request(if message.is_empty() {
            "Configuration Facebook invalide".to_string()
        } else {
            message
        })
    };

    let existing = state
        .db
        .get_facebook_config()
        .await
        .map_err(|e| bad_request(e.to_string()))?;
    // Le secret peut être omis lors d'une mise à jour : on garde l'existant
    let (app_id, app_secret) =
        validate_config_body(&body, existing.is_some()).map_err(bad_request)?;

    let config = state
        .db
        .upsert_facebook_config(Some(&app_id), app_secret.as_deref())
        .await
        .map_err(|e| bad_request(e.to_string()))?;

    Ok(Json(json!({
        "success": true,
        "appId": config.app_id,
        "redirectUri": oauth::redirect_uri(&state, Some(&headers)),
    })))
}

/// Démarre la connexion des pages Facebook. À appeler par navigation
/// complète du navigateur (window.location), pas en fetch.
async fn connect(State(state): State<AppState>, user: AuthUser, headers: HeaderMap) -> Response {
    if !oauth::is_configured(&state).await {
        return redirect_error(
            "Facebook n'est pas configuré. Renseignez d'abord l'App ID et l'App Secret.",
        );
    }

    // Protection CSRF : l'état est vérifié au retour
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    let oauth_state = hex::encode(bytes);

    let auth_url = match oauth::build_authorization_url(&state, &oauth_state, Some(&headers)).await
    {
        Ok(url) => url,
        Err(error) => {
            tracing::error!("❌ [Facebook] Erreur démarrage OAuth: {error:#}");
            return redirect_error(&error.to_string());
        }
    };

    // La session doit être écrite avant la redirection, sinon l'état est perdu
    let mut session = user.session;
    session.set(SESSION_STATE_KEY, Value::String(oauth_state));
    if let Err(error) = session.save(&state).await {
        tracing::error!("❌ [Facebook] Impossible de sauvegarder la session OAuth: {error}");
        return redirect_error("Erreur de session, réessayez.");
    }

    redirect(&auth_url)
}

/// Résumé affiché après la connexion (« 2 pages connectées, 1 page mise à jour »).
pub fn connection_summary(created: usize, updated: usize) -> String {
    let plural = |n: usize| if n > 1 { "s" } else { "" };
    let mut parts = Vec::new();
    if created > 0 {
        parts.push(format!(
            "{created} page{} connectée{}",
            plural(created),
            plural(created)
        ));
    }
    if updated > 0 {
        parts.push(format!(
            "{updated} page{} mise{} à jour",
            plural(updated),
            plural(updated)
        ));
    }
    parts.join(", ")
}

/// Retour d'autorisation Facebook : échange le code contre un jeton utilisateur
/// longue durée, puis crée ou met à jour chaque page administrée.
async fn callback(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    query: QueryMap,
) -> Response {
    if let Some(oauth_error) = query.non_empty("error") {
        let description = query.non_empty("error_description").unwrap_or(oauth_error);
        return redirect_error(&format!("Autorisation Facebook refusée : {description}"));
    }

    let AuthUser { user, mut session } = user;
    let expected_state = session.get_str(SESSION_STATE_KEY);
    if session.remove(SESSION_STATE_KEY).is_some() {
        if let Err(error) = session.save(&state).await {
            tracing::warn!(
                "⚠️ [Facebook] Impossible d'effacer l'état OAuth de la session: {error}"
            );
        }
    }

    let received_state = query.non_empty("state");
    let state_ok = matches!(
        (received_state, expected_state.as_deref()),
        (Some(received), Some(expected)) if !expected.is_empty() && received == expected
    );
    if !state_ok {
        return redirect_error("Requête de connexion Facebook invalide (état non reconnu).");
    }

    let Some(code) = query.non_empty("code") else {
        return redirect_error("Aucun code d'autorisation reçu de Facebook.");
    };

    match connect_pages(&state, &user, code, &headers).await {
        Ok(Some(summary)) => {
            tracing::info!("✅ [Facebook] {summary} pour {}", user.username);
            redirect(&build_return_url(
                true,
                &format!("{summary}. Les jetons se renouvellent désormais automatiquement."),
            ))
        }
        Ok(None) => redirect_error(
            "Aucune page Facebook administrée par ce compte. Connectez-vous avec un compte administrateur de la page.",
        ),
        Err(error) => {
            tracing::error!("❌ [Facebook] Erreur callback OAuth: {error:#}");
            redirect_error(&error.to_string())
        }
    }
}

/// Crée ou met à jour les pages issues de l'autorisation ; `None` quand le
/// compte n'administre aucune page.
async fn connect_pages(
    state: &AppState,
    user: &crate::db::User,
    code: &str,
    headers: &HeaderMap,
) -> anyhow::Result<Option<String>> {
    let user_token = oauth::exchange_code_for_user_token(state, code, Some(headers)).await?;
    let targets = oauth::list_pages(state, &user_token.access_token).await?;
    if targets.is_empty() {
        return Ok(None);
    }

    // Le jeton utilisateur est la clé du renouvellement automatique : il est
    // conservé chiffré, sur chaque page issue de cette autorisation.
    let encrypted_user_token = encrypt(&user_token.access_token);
    let existing_pages = state.db.get_social_pages(&user.id).await?;

    let mut created = 0;
    let mut updated = 0;

    for target in &targets {
        let existing = existing_pages
            .iter()
            .find(|p| p.platform == Platform::Facebook && p.page_id == target.id);

        if let Some(existing) = existing {
            state
                .db
                .update_social_page(
                    &existing.id,
                    Patch::new()
                        .set("page_name", target.name.clone())
                        .set("access_token", target.access_token.clone())
                        // Un jeton de page dérivé d'un jeton utilisateur longue durée n'expire pas.
                        .set("token_expires_at", None::<Ts>)
                        .set("user_access_token", encrypted_user_token.clone())
                        .set("user_token_expires_at", user_token.expires_at)
                        .set("followers_count", target.followers_count)
                        .set("token_status", TokenStatus::Valid)
                        .set_null("token_error")
                        .set("last_token_check", Ts::now())
                        .set("is_active", "true"),
                )
                .await?;
            updated += 1;
            continue;
        }

        let page = state
            .db
            .create_social_page(NewSocialPage {
                user_id: user.id.clone(),
                platform: Some(Platform::Facebook),
                page_id: target.id.clone(),
                page_name: target.name.clone(),
                access_token: target.access_token.clone(),
                token_expires_at: None,
                user_access_token: Some(encrypted_user_token.clone()),
                user_token_expires_at: user_token.expires_at,
                followers_count: Some(target.followers_count),
                is_active: Some("true".to_string()),
                ..Default::default()
            })
            .await?;
        created += 1;

        // Les non-admins ne voient que les pages qui leur sont explicitement
        // attribuées : sans cette permission, ils ne verraient pas leur propre page.
        if !user.is_admin() {
            if let Err(error) = state.db.create_page_permission(&user.id, &page.id).await {
                tracing::error!("⚠️ [Facebook] Impossible de créer la permission de page: {error}");
            }
        }
    }

    // Un compte Instagram professionnel publie avec le jeton de la page Facebook
    // à laquelle il est rattaché : on le rafraîchit dans la foulée, sans quoi il
    // resterait sur un jeton saisi à la main, condamné à expirer.
    for page in existing_pages
        .iter()
        .filter(|p| p.platform == Platform::Instagram)
    {
        let Some(linked) = targets
            .iter()
            .find(|t| t.instagram.as_ref().is_some_and(|ig| ig.id == page.page_id))
        else {
            continue;
        };
        state
            .db
            .update_social_page(
                &page.id,
                Patch::new()
                    .set("access_token", linked.access_token.clone())
                    .set("token_expires_at", None::<Ts>)
                    .set("user_access_token", encrypted_user_token.clone())
                    .set("user_token_expires_at", user_token.expires_at)
                    .set("token_status", TokenStatus::Valid)
                    .set_null("token_error")
                    .set("last_token_check", Ts::now()),
            )
            .await?;
        updated += 1;
    }

    Ok(Some(connection_summary(created, updated)))
}

/// Contrôle (et renouvelle si besoin) le jeton d'une page à la demande.
async fn refresh_page(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let bad_gateway = |message: String| {
        tracing::error!("❌ [Facebook] Erreur renouvellement du jeton: {message}");
        AppError::new(
            StatusCode::BAD_GATEWAY,
            if message.is_empty() {
                "Impossible de contrôler le jeton".to_string()
            } else {
                message
            },
        )
    };

    let page = state
        .db
        .get_social_page(&id)
        .await
        .map_err(|e| bad_gateway(e.to_string()))?
        .ok_or_else(|| AppError::not_found("Page non trouvée"))?;

    if !user.is_admin() && page.user_id != user.id {
        let accessible = state
            .db
            .get_user_accessible_pages(&user.id)
            .await
            .map_err(|e| bad_gateway(e.to_string()))?;
        if !accessible.iter().any(|p| p.id == page.id) {
            return Err(AppError::forbidden("Accès refusé à cette page"));
        }
    }

    let result = token_manager::check_page(&state, &page.id)
        .await
        .map_err(|e| bad_gateway(e.to_string()))?;
    Ok(Json(serde_json::to_value(result).or_500_cause()?))
}

/// Relance le contrôle de toutes les pages (admin).
async fn check_tokens(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    if !user.is_admin() {
        return Err(AppError::forbidden(ADMIN_ONLY));
    }

    let results = token_manager::check_and_refresh_tokens(&state).await;
    let renewed = results.iter().filter(|r| r.renewed).count();
    let failing = results
        .iter()
        .filter(|r| r.status == "expired" || r.status == "error")
        .count();
    Ok(Json(json!({
        "checked": results.len(),
        "renewed": renewed,
        "failing": failing,
        "results": results,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn return_url_is_encoded_like_url_search_params() {
        assert_eq!(
            build_return_url(false, "Erreur de session, réessayez."),
            "/pages?facebook=error&message=Erreur+de+session%2C+r%C3%A9essayez."
        );
        assert!(build_return_url(true, "ok").starts_with("/pages?facebook=success&message=ok"));
    }

    #[test]
    fn summary_wording() {
        assert_eq!(connection_summary(1, 0), "1 page connectée");
        assert_eq!(connection_summary(2, 0), "2 pages connectées");
        assert_eq!(connection_summary(0, 1), "1 page mise à jour");
        assert_eq!(
            connection_summary(3, 2),
            "3 pages connectées, 2 pages mises à jour"
        );
        assert_eq!(connection_summary(0, 0), "");
    }

    #[test]
    fn config_validation_matches_zod_messages() {
        let ok =
            validate_config_body(&json!({ "appId": " 123 ", "appSecret": " s " }), false).unwrap();
        assert_eq!(ok, ("123".to_string(), Some("s".to_string())));

        assert_eq!(
            validate_config_body(&json!({}), false).unwrap_err(),
            "Required"
        );
        assert_eq!(
            validate_config_body(&json!({ "appId": "  " }), true).unwrap_err(),
            "L'App ID ne peut pas être vide"
        );
        assert_eq!(
            validate_config_body(&json!({ "appId": "1" }), false).unwrap_err(),
            "Required"
        );
        assert_eq!(
            validate_config_body(&json!({ "appId": "1", "appSecret": "" }), true).unwrap_err(),
            "L'App Secret ne peut pas être vide"
        );
        assert_eq!(
            validate_config_body(&json!({ "appId": 12 }), true).unwrap_err(),
            "Expected string, received number"
        );
        // Secret facultatif lors d'une mise à jour
        assert_eq!(
            validate_config_body(&json!({ "appId": "1" }), true).unwrap(),
            ("1".to_string(), None)
        );
    }
}
