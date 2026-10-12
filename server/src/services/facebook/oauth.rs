//! Renouvellement des tokens Facebook (ex-`facebook_oauth.ts`).
//!
//! Le problème que ce module résout : un token de page saisi à la main finit
//! toujours par mourir (60 jours pour un token issu du Graph Explorer, ou du
//! jour au lendemain si le mot de passe change, si l'utilisateur perd son rôle
//! d'admin, ou si Meta révoque l'autorisation) — et on ne l'apprend qu'au
//! moment où une publication échoue.
//!
//! La parade est celle recommandée par Meta :
//!   1. l'utilisateur autorise l'application (OAuth) ;
//!   2. le code est échangé contre un token utilisateur court ;
//!   3. ce token court est échangé contre un token utilisateur longue durée
//!      (~60 jours) — c'est lui que l'on conserve, chiffré ;
//!   4. les tokens de page dérivés d'un token utilisateur longue durée
//!      n'expirent pas.
//!
//! Conserver le token utilisateur permet de régénérer un token de page sans
//! intervention humaine, et de prolonger le token utilisateur lui-même avant
//! son échéance : tant que l'utilisateur ne retire pas son autorisation, la
//! chaîne se renouvelle toute seule.

use axum::http::HeaderMap;
use chrono::Duration;
use serde_json::Value;

use crate::config::Config;
use crate::extract::is_truthy;
use crate::public_url::resolve_public_base_url;
use crate::state::AppState;
use crate::time::Ts;

/// Permissions nécessaires pour publier et lire les statistiques d'une page.
const DEFAULT_SCOPES: &str = "pages_show_list,pages_manage_posts,pages_read_engagement,pages_manage_engagement,read_insights,business_management,instagram_basic,instagram_content_publish";

fn graph_version() -> String {
    Config::var("FACEBOOK_GRAPH_VERSION").unwrap_or_else(|| "v19.0".to_string())
}

/// Erreur d'autorisation Facebook ; son message est montré tel quel à l'utilisateur.
#[derive(Debug, Clone, thiserror::Error)]
#[error("{0}")]
pub struct FacebookAuthError(pub String);

#[derive(Debug, Clone)]
pub struct FacebookLongLivedToken {
    pub access_token: String,
    /// Nul quand Facebook ne renvoie pas d'échéance (jeton sans expiration).
    pub expires_at: Option<Ts>,
}

#[derive(Debug, Clone)]
pub struct InstagramTarget {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct FacebookPageTarget {
    pub id: String,
    pub name: String,
    pub access_token: String,
    pub followers_count: i32,
    /// Compte Instagram professionnel rattaché à la page, s'il existe.
    pub instagram: Option<InstagramTarget>,
}

/// Résultat de /debug_token : ce que Meta sait vraiment du jeton.
#[derive(Debug, Clone)]
pub struct FacebookTokenInfo {
    pub is_valid: bool,
    /// Nul = n'expire pas (cas normal d'un token de page).
    pub expires_at: Option<Ts>,
    pub scopes: Vec<String>,
    pub error: Option<String>,
}

/// Identifiants de l'application Facebook (globaux à l'instance).
/// La base prime sur les variables d'environnement.
async fn credentials(state: &AppState) -> anyhow::Result<(String, String)> {
    let config = state.db.get_facebook_config().await?;
    let app_id = config
        .as_ref()
        .map(|c| c.app_id.clone())
        .filter(|s| !s.is_empty())
        .or_else(|| Config::var("FACEBOOK_APP_ID"));
    let app_secret = config
        .as_ref()
        .map(|c| c.app_secret.clone())
        .filter(|s| !s.is_empty())
        .or_else(|| Config::var("FACEBOOK_APP_SECRET"));

    match (app_id, app_secret) {
        (Some(id), Some(secret)) => Ok((id, secret)),
        _ => Err(FacebookAuthError(
            "Facebook n'est pas configuré. Renseignez l'App ID et l'App Secret de \
             votre application Facebook dans les paramètres."
                .to_string(),
        )
        .into()),
    }
}

pub async fn is_configured(state: &AppState) -> bool {
    credentials(state).await.is_ok()
}

/// URI de redirection OAuth. Les en-têtes permettent de la déduire du domaine
/// réellement utilisé quand `APP_URL` n'est pas défini : sans eux on renverrait
/// `http://localhost:5555`, que Facebook rejette.
pub fn redirect_uri(state: &AppState, headers: Option<&HeaderMap>) -> String {
    if let Some(uri) = Config::var("FACEBOOK_REDIRECT_URI") {
        return uri;
    }
    format!(
        "{}/api/facebook/callback",
        resolve_public_base_url(state, headers)
    )
}

pub fn scopes() -> String {
    Config::var("FACEBOOK_SCOPES").unwrap_or_else(|| DEFAULT_SCOPES.to_string())
}

/// URL de la boîte de dialogue OAuth.
pub fn authorization_url(
    version: &str,
    app_id: &str,
    redirect_uri: &str,
    oauth_state: &str,
    scopes: &str,
) -> String {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("client_id", app_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("state", oauth_state)
        .append_pair("scope", scopes)
        .append_pair("response_type", "code")
        .finish();
    format!("https://www.facebook.com/{version}/dialog/oauth?{query}")
}

/// URL d'autorisation à ouvrir pour connecter les pages d'un compte Facebook.
pub async fn build_authorization_url(
    state: &AppState,
    oauth_state: &str,
    headers: Option<&HeaderMap>,
) -> anyhow::Result<String> {
    let (app_id, _) = credentials(state).await?;
    Ok(authorization_url(
        &graph_version(),
        &app_id,
        &redirect_uri(state, headers),
        oauth_state,
        &scopes(),
    ))
}

/// Échange le code d'autorisation contre un token utilisateur **longue durée**.
/// L'étape intermédiaire (token court) n'est jamais conservée : seul le token
/// longue durée rend les tokens de page permanents.
pub async fn exchange_code_for_user_token(
    state: &AppState,
    code: &str,
    headers: Option<&HeaderMap>,
) -> anyhow::Result<FacebookLongLivedToken> {
    let (app_id, app_secret) = credentials(state).await?;
    let redirect = redirect_uri(state, headers);

    let short_lived = graph_get(
        state,
        "/oauth/access_token",
        &[
            ("client_id", &app_id),
            ("client_secret", &app_secret),
            ("redirect_uri", &redirect),
            ("code", code),
        ],
        "échange du code d'autorisation",
    )
    .await?;

    let Some(token) = non_empty_str(&short_lived, "access_token") else {
        return Err(FacebookAuthError(
            "Facebook n'a pas renvoyé de jeton pour ce code d'autorisation.".to_string(),
        )
        .into());
    };

    extend_user_token(state, &token).await
}

/// Prolonge un token utilisateur. Appelé au retour d'OAuth (token court →
/// ~60 jours) mais aussi périodiquement : ré-échanger un token longue durée
/// encore valide repart pour 60 jours, ce qui évite la reconnexion manuelle.
pub async fn extend_user_token(
    state: &AppState,
    user_token: &str,
) -> anyhow::Result<FacebookLongLivedToken> {
    let (app_id, app_secret) = credentials(state).await?;

    let long_lived = graph_get(
        state,
        "/oauth/access_token",
        &[
            ("grant_type", "fb_exchange_token"),
            ("client_id", &app_id),
            ("client_secret", &app_secret),
            ("fb_exchange_token", user_token),
        ],
        "prolongation du jeton utilisateur",
    )
    .await?;

    let Some(access_token) = non_empty_str(&long_lived, "access_token") else {
        return Err(FacebookAuthError(
            "Facebook n'a pas renvoyé de jeton longue durée.".to_string(),
        )
        .into());
    };

    // expires_in absent ou nul = jeton sans expiration connue.
    let expires_at = long_lived
        .get("expires_in")
        .and_then(Value::as_f64)
        .filter(|s| *s != 0.0 && !s.is_nan())
        .map(|seconds| Ts::now().add(Duration::milliseconds((seconds * 1000.0) as i64)));

    Ok(FacebookLongLivedToken {
        access_token,
        expires_at,
    })
}

/// Pages administrées par le compte, avec leur token de page.
/// Ces tokens sont permanents lorsqu'ils dérivent d'un token utilisateur
/// longue durée : c'est le cœur du renouvellement automatique.
pub async fn list_pages(
    state: &AppState,
    user_token: &str,
) -> anyhow::Result<Vec<FacebookPageTarget>> {
    let response = graph_get(
        state,
        "/me/accounts",
        &[
            (
                "fields",
                "id,name,access_token,fan_count,followers_count,instagram_business_account{id,name,username}",
            ),
            ("limit", "200"),
            ("access_token", user_token),
        ],
        "récupération des pages",
    )
    .await?;
    Ok(parse_pages(&response))
}

pub fn parse_pages(response: &Value) -> Vec<FacebookPageTarget> {
    let Some(pages) = response.get("data").and_then(Value::as_array) else {
        return Vec::new();
    };
    pages
        .iter()
        .map(|page| {
            let text = |key: &str| page.get(key).map(value_text).unwrap_or_default();
            let name = text("name");
            let count = |key: &str| page.get(key).and_then(Value::as_i64);
            let followers = count("followers_count")
                .or_else(|| count("fan_count"))
                .unwrap_or(0);
            let instagram = page
                .get("instagram_business_account")
                .filter(|v| v.is_object())
                .map(|ig| InstagramTarget {
                    id: ig.get("id").map(value_text).unwrap_or_default(),
                    name: non_empty_str(ig, "username")
                        .or_else(|| non_empty_str(ig, "name"))
                        .unwrap_or_else(|| name.clone()),
                });
            FacebookPageTarget {
                id: text("id"),
                access_token: text("access_token"),
                followers_count: followers as i32,
                instagram,
                name,
            }
        })
        .collect()
}

/// Interroge Meta sur l'état réel d'un jeton. Un simple appel /me ne dit pas
/// quand le jeton expire : /debug_token le dit, ce qui permet de renouveler
/// *avant* la panne plutôt qu'après.
pub async fn inspect_token(state: &AppState, token: &str) -> anyhow::Result<FacebookTokenInfo> {
    let (app_id, app_secret) = credentials(state).await?;
    // Jeton d'application : `app_id|app_secret`, accepté par /debug_token.
    let app_token = format!("{app_id}|{app_secret}");
    let response = graph_get(
        state,
        "/debug_token",
        &[("input_token", token), ("access_token", &app_token)],
        "inspection du jeton",
    )
    .await?;
    Ok(parse_token_info(&response))
}

pub fn parse_token_info(response: &Value) -> FacebookTokenInfo {
    let data = response.get("data").cloned().unwrap_or(Value::Null);
    FacebookTokenInfo {
        is_valid: data.get("is_valid") == Some(&Value::Bool(true)),
        // `expires_at: 0` signifie « n'expire pas » chez Meta.
        expires_at: data
            .get("expires_at")
            .and_then(Value::as_f64)
            .filter(|s| *s != 0.0)
            .and_then(|s| Ts::from_millis((s * 1000.0) as i64)),
        scopes: data
            .get("scopes")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        error: data
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}

async fn graph_get(
    state: &AppState,
    endpoint: &str,
    params: &[(&str, &str)],
    context: &str,
) -> anyhow::Result<Value> {
    let mut url = url::Url::parse(&format!(
        "https://graph.facebook.com/{}{endpoint}",
        graph_version()
    ))?;
    url.query_pairs_mut().extend_pairs(params);

    let response = state.http.get(url).send().await.map_err(|error| {
        FacebookAuthError(format!(
            "Facebook injoignable ({context}) : {}",
            reqwest_message(&error)
        ))
    })?;

    let status = response.status();
    let payload: Value = response
        .json()
        .await
        .unwrap_or_else(|_| Value::Object(Default::default()));

    if !status.is_success() || is_truthy(payload.get("error")) {
        let message = payload
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .filter(|m| !m.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
        return Err(FacebookAuthError(format!("Facebook ({context}) : {message}")).into());
    }

    Ok(payload)
}

fn reqwest_message(error: &reqwest::Error) -> String {
    let text = error.to_string();
    if text.is_empty() {
        "erreur réseau".to_string()
    } else {
        text
    }
}

/// Chaîne (ou nombre) d'un champ JSON, non vide.
fn non_empty_str(value: &Value, key: &str) -> Option<String> {
    value.get(key).map(value_text).filter(|s| !s.is_empty())
}

fn value_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn authorization_url_is_encoded() {
        let url = authorization_url(
            "v19.0",
            "123",
            "https://app.fr/api/facebook/callback",
            "abc",
            "a,b",
        );
        assert_eq!(
            url,
            "https://www.facebook.com/v19.0/dialog/oauth?client_id=123&redirect_uri=https%3A%2F%2Fapp.fr%2Fapi%2Ffacebook%2Fcallback&state=abc&scope=a%2Cb&response_type=code"
        );
    }

    #[test]
    fn pages_are_mapped() {
        let response = json!({ "data": [
            { "id": "1", "name": "Boutique", "access_token": "T1", "fan_count": 10, "followers_count": 12,
              "instagram_business_account": { "id": "ig1", "username": "boutique.ig" } },
            { "id": "2", "name": "Autre", "access_token": "T2", "fan_count": 5,
              "instagram_business_account": { "id": "ig2" } },
            { "id": "3", "name": "Sans IG", "access_token": "T3" }
        ]});
        let pages = parse_pages(&response);
        assert_eq!(pages.len(), 3);
        assert_eq!(pages[0].followers_count, 12);
        assert_eq!(pages[0].instagram.as_ref().unwrap().name, "boutique.ig");
        assert_eq!(pages[1].followers_count, 5);
        assert_eq!(pages[1].instagram.as_ref().unwrap().name, "Autre");
        assert_eq!(pages[2].followers_count, 0);
        assert!(pages[2].instagram.is_none());
        assert!(parse_pages(&json!({})).is_empty());
    }

    #[test]
    fn token_info_is_parsed() {
        let info = parse_token_info(
            &json!({ "data": { "is_valid": true, "expires_at": 0, "scopes": ["a"] } }),
        );
        assert!(info.is_valid);
        assert!(info.expires_at.is_none());
        assert_eq!(info.scopes, vec!["a".to_string()]);

        let info = parse_token_info(&json!({ "data": {
            "is_valid": false, "expires_at": 1_700_000_000, "error": { "message": "Session expired" }
        }}));
        assert!(!info.is_valid);
        assert_eq!(
            info.expires_at.unwrap().timestamp_millis(),
            1_700_000_000_000
        );
        assert_eq!(info.error.as_deref(), Some("Session expired"));
    }
}
