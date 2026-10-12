//! Authentification par session.
//!
//! Compatible avec l'ancien couple express-session + connect-pg-simple :
//! même cookie (`connect.sid`, signé HMAC-SHA256 avec `SESSION_SECRET`),
//! même table `session`, même structure JSON (`passport.user`). Les sessions
//! ouvertes avant la mise à jour restent donc valides.

use std::ops::Deref;

use axum::extract::FromRequestParts;
use axum::http::header::{COOKIE, SET_COOKIE};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use chrono::Duration;
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde_json::{json, Map, Value};
use sha2::Sha256;

use crate::db::{User, UserRole};
use crate::error::AppError;
use crate::public_url::is_https;
use crate::state::AppState;
use crate::time::Ts;

pub const COOKIE_NAME: &str = "connect.sid";
/// Durée de vie d'une session : 7 jours.
pub const SESSION_TTL_MS: i64 = 7 * 24 * 60 * 60 * 1000;

const COOKIE_ENCODE: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');

/// Session chargée depuis la base ; `data` est l'objet JSON stocké (`sess`).
#[derive(Debug, Clone)]
pub struct Session {
    pub sid: String,
    pub data: Value,
}

impl Session {
    pub fn user_id(&self) -> Option<&str> {
        self.data.get("passport")?.get("user")?.as_str()
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.data.get(key)
    }

    pub fn get_str(&self, key: &str) -> Option<String> {
        self.data
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_string)
    }

    pub fn set(&mut self, key: &str, value: Value) {
        if let Value::Object(map) = &mut self.data {
            map.insert(key.to_string(), value);
        }
    }

    pub fn remove(&mut self, key: &str) -> Option<Value> {
        match &mut self.data {
            Value::Object(map) => map.remove(key),
            _ => None,
        }
    }

    /// Enregistre les données modifiées (et prolonge la session).
    pub async fn save(&self, state: &AppState) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE session SET sess = $2, expire = $3 WHERE sid = $1")
            .bind(&self.sid)
            .bind(&self.data)
            .bind(Ts::now().add(Duration::milliseconds(SESSION_TTL_MS)))
            .execute(&state.db.pool)
            .await?;
        Ok(())
    }
}

fn sign(secret: &str, value: &str) -> String {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC accepte toute clé");
    mac.update(value.as_bytes());
    let sig = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
    format!("{value}.{}", sig.trim_end_matches('='))
}

/// `s:<sid>.<signature>` → sid, si la signature est valide.
fn unsign(secret: &str, signed: &str) -> Option<String> {
    let raw = signed.strip_prefix("s:")?;
    let (value, _) = raw.rsplit_once('.')?;
    let expected = sign(secret, value);
    // Comparaison à temps constant
    let a = expected.as_bytes();
    let b = raw.as_bytes();
    if a.len() != b.len() {
        return None;
    }
    let diff = a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y));
    (diff == 0).then(|| value.to_string())
}

fn session_cookie_value(headers: &HeaderMap) -> Option<String> {
    for header in headers.get_all(COOKIE) {
        let Ok(text) = header.to_str() else { continue };
        for pair in text.split(';') {
            let pair = pair.trim();
            if let Some(value) = pair.strip_prefix(&format!("{COOKIE_NAME}=")) {
                return percent_encoding::percent_decode_str(value)
                    .decode_utf8()
                    .ok()
                    .map(|v| v.into_owned());
            }
        }
    }
    None
}

/// Identifiant de session (comme `uid-safe(24)` : 32 caractères base64url).
fn new_sid() -> String {
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn cookie_meta(secure: bool, expires: Ts) -> Value {
    json!({
        "originalMaxAge": SESSION_TTL_MS,
        "expires": expires.to_iso(),
        "secure": secure,
        "httpOnly": true,
        "path": "/",
        "sameSite": "lax",
    })
}

/// En-tête `Set-Cookie` de la session.
pub fn session_cookie(
    state: &AppState,
    headers: &HeaderMap,
    sid: &str,
    expires: Ts,
) -> HeaderValue {
    let signed = sign(&state.config.session_secret, sid);
    let encoded =
        percent_encoding::utf8_percent_encode(&format!("s:{signed}"), COOKIE_ENCODE).to_string();
    let mut cookie = format!(
        "{COOKIE_NAME}={encoded}; Path=/; Expires={}; HttpOnly; SameSite=Lax",
        expires.utc().format("%a, %d %b %Y %H:%M:%S GMT")
    );
    if is_https(state, headers) {
        cookie.push_str("; Secure");
    }
    HeaderValue::from_str(&cookie).expect("cookie ASCII")
}

/// En-tête `Set-Cookie` qui efface la session côté navigateur.
pub fn clear_session_cookie() -> HeaderValue {
    HeaderValue::from_static(
        "connect.sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
    )
}

/// Charge la session de la requête (cookie valide et session non expirée).
pub async fn load_session(state: &AppState, headers: &HeaderMap) -> Option<Session> {
    let cookie = session_cookie_value(headers)?;
    let sid = unsign(&state.config.session_secret, &cookie)?;
    let row: Option<(Value,)> =
        sqlx::query_as("SELECT sess FROM session WHERE sid = $1 AND expire > $2")
            .bind(&sid)
            .bind(Ts::now())
            .fetch_optional(&state.db.pool)
            .await
            .ok()?;
    row.map(|(data,)| Session { sid, data })
}

/// Ouvre une nouvelle session pour l'utilisateur (l'ancienne est détruite,
/// comme le faisait passport lors de la connexion).
pub async fn start_session(
    state: &AppState,
    headers: &HeaderMap,
    previous: Option<&Session>,
    user_id: &str,
) -> Result<(Session, HeaderValue), sqlx::Error> {
    if let Some(previous) = previous {
        destroy_session(state, &previous.sid).await?;
    }
    let sid = new_sid();
    let expires = Ts::now().add(Duration::milliseconds(SESSION_TTL_MS));
    let data = json!({
        "cookie": cookie_meta(is_https(state, headers), expires),
        "passport": { "user": user_id },
    });
    sqlx::query("INSERT INTO session (sid, sess, expire) VALUES ($1, $2, $3)")
        .bind(&sid)
        .bind(&data)
        .bind(expires)
        .execute(&state.db.pool)
        .await?;
    let cookie = session_cookie(state, headers, &sid, expires);
    Ok((Session { sid, data }, cookie))
}

pub async fn destroy_session(state: &AppState, sid: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM session WHERE sid = $1")
        .bind(sid)
        .execute(&state.db.pool)
        .await?;
    Ok(())
}

/// Prolonge la session en base (équivalent du `touch` de connect-pg-simple).
fn touch_session(state: &AppState, sid: String) {
    let state = state.clone();
    tokio::spawn(async move {
        let expire = Ts::now().add(Duration::milliseconds(SESSION_TTL_MS));
        let _ = sqlx::query("UPDATE session SET expire = $2 WHERE sid = $1")
            .bind(sid)
            .bind(expire)
            .execute(&state.db.pool)
            .await;
    });
}

/// Purge des sessions expirées (appelée périodiquement).
pub async fn prune_sessions(state: &AppState) {
    let _ = sqlx::query("DELETE FROM session WHERE expire < $1")
        .bind(Ts::now())
        .execute(&state.db.pool)
        .await;
}

/// Utilisateur connecté et sa session.
pub async fn current_user(state: &AppState, headers: &HeaderMap) -> Option<(User, Session)> {
    let session = load_session(state, headers).await?;
    let user_id = session.user_id()?.to_string();
    let user = state.db.get_user(&user_id).await.ok()??;
    touch_session(state, session.sid.clone());
    Some((user, session))
}

/// Extracteur : utilisateur authentifié, sinon `401 { error: "Non authentifié" }`.
pub struct AuthUser {
    pub user: User,
    pub session: Session,
}

impl Deref for AuthUser {
    type Target = User;

    fn deref(&self) -> &User {
        &self.user
    }
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        match current_user(state, &parts.headers).await {
            Some((user, session)) => Ok(AuthUser { user, session }),
            None => Err(AppError::unauthorized("Non authentifié")),
        }
    }
}

/// Extracteur : administrateur, sinon 401 / 403.
pub struct AdminUser {
    pub user: User,
    pub session: Session,
}

impl Deref for AdminUser {
    type Target = User;

    fn deref(&self) -> &User {
        &self.user
    }
}

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let AuthUser { user, session } = AuthUser::from_request_parts(parts, state).await?;
        if user.role != UserRole::Admin {
            return Err(AppError::forbidden(
                "Accès refusé. Réservé aux administrateurs.",
            ));
        }
        Ok(AdminUser { user, session })
    }
}

/// Extracteur optionnel.
pub struct MaybeUser(pub Option<(User, Session)>);

impl FromRequestParts<AppState> for MaybeUser {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        Ok(MaybeUser(current_user(state, &parts.headers).await))
    }
}

/// Réponse JSON accompagnée d'un `Set-Cookie`.
pub fn with_cookie(body: Value, cookie: HeaderValue) -> Response {
    let mut response = axum::Json(body).into_response();
    response.headers_mut().append(SET_COOKIE, cookie);
    response
}

pub fn user_json(user: &User) -> Value {
    let mut map = Map::new();
    map.insert("id".into(), Value::String(user.id.clone()));
    map.insert("username".into(), Value::String(user.username.clone()));
    map.insert("role".into(), Value::String(user.role.as_str().into()));
    Value::Object(map)
}

pub async fn hash_password(password: &str) -> anyhow::Result<String> {
    let password = password.to_string();
    Ok(tokio::task::spawn_blocking(move || bcrypt::hash(password, 10)).await??)
}

pub async fn verify_password(password: &str, hash: &str) -> bool {
    let password = password.to_string();
    let hash = hash.to_string();
    tokio::task::spawn_blocking(move || bcrypt::verify(password, &hash).unwrap_or(false))
        .await
        .unwrap_or(false)
}

/// Crée l'utilisateur `admin` / `admin` au premier démarrage.
pub async fn ensure_admin_user_exists(state: &AppState) -> anyhow::Result<()> {
    if state.db.get_user_by_username("admin").await?.is_some() {
        tracing::info!("✓ Utilisateur admin existe déjà");
        return Ok(());
    }
    tracing::info!("🔧 Création de l'utilisateur admin par défaut...");
    let hash = hash_password("admin").await?;
    state
        .db
        .create_user("admin", &hash, UserRole::Admin)
        .await?;
    tracing::info!("✅ Utilisateur admin créé avec succès (admin / admin)");
    tracing::warn!("⚠️  IMPORTANT: Changez ce mot de passe immédiatement !");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_matches_cookie_signature_package() {
        // Valeur produite par `cookie-signature` (Node) : sign('abc', 'secret')
        assert_eq!(
            sign("secret", "abc"),
            "abc.mUba1OAOkT/Ivo5dP34RCkqegy+D+wnDRShdeGONig4"
        );
        assert_eq!(
            unsign(
                "secret",
                "s:abc.mUba1OAOkT/Ivo5dP34RCkqegy+D+wnDRShdeGONig4"
            )
            .as_deref(),
            Some("abc")
        );
        assert!(unsign("secret", "s:abc.invalid").is_none());
        assert!(unsign("other", "s:abc.mUba1OAOkT/Ivo5dP34RCkqegy+D+wnDRShdeGONig4").is_none());
    }
}
