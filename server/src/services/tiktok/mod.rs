//! Service de publication TikTok (Content Posting API v2).
//!
//! Différences structurantes avec Facebook, qui expliquent la forme de ce service :
//!  - Pas de token collable à la main : chaque compte magasin passe par OAuth.
//!    L'access token ne vit que 24h et doit être renouvelé avec le refresh token
//!    (valable 1 an) avant chaque publication.
//!  - La publication est asynchrone : l'upload rend un `publish_id`, et l'identifiant
//!    définitif du post n'est connu qu'en interrogeant /status/fetch/ ensuite.
//!  - `creator_info/query` doit être appelé avant chaque publication pour connaître
//!    les niveaux de confidentialité réellement autorisés sur le compte.
//!
//! Note : tant que l'application n'a pas passé l'audit TikTok, le seul niveau de
//! confidentialité disponible est SELF_ONLY (vidéo visible du seul propriétaire du
//! compte). Le code s'adapte automatiquement à ce que le compte autorise.

mod payload;

use axum::http::header::{CACHE_CONTROL, CONTENT_RANGE, CONTENT_TYPE};
use axum::http::HeaderMap;
use bytes::Bytes;
use chrono::Duration;
use serde_json::{json, Value};

use payload::{
    build_init_body, chunk_range, compute_chunking, decode_uri_component, js_slice, js_string,
    parse_api_payload, parse_token_payload, resolve_privacy_level,
};
pub use payload::{CreatorInfo, PublishOptions, PublishStatus, TokenResponse};

use crate::config::Config;
use crate::db::{Patch, Platform, SocialPage, TokenStatus};
use crate::public_url::resolve_public_base_url;
use crate::state::AppState;
use crate::time::Ts;

const AUTH_BASE_URL: &str = "https://www.tiktok.com/v2/auth/authorize/";
const API_BASE_URL: &str = "https://open.tiktokapis.com/v2";

/// Scopes demandés à l'autorisation. `video.publish` nécessite l'audit TikTok.
const DEFAULT_SCOPES: &str = "user.info.basic,video.publish";

/// Renouvelle le token si sa fin de validité est à moins de 5 minutes.
const TOKEN_REFRESH_MARGIN_MS: i64 = 5 * 60 * 1000;

/// Abandon du suivi d'une publication au-delà de 24h.
const STATUS_TRACKING_LIMIT_MS: i64 = 24 * 60 * 60 * 1000;

/// Message d'une erreur tel que l'exposait l'ancien serveur : pour une erreur
/// PostgreSQL, le seul message du serveur (comme `error.message` de node-postgres).
pub fn error_message(error: &anyhow::Error) -> String {
    if let Some(sqlx::Error::Database(db)) = error.downcast_ref::<sqlx::Error>() {
        return db.message().to_string();
    }
    error.to_string()
}

/// Envoie une requête ; une erreur réseau donne « fetch failed », comme `fetch`
/// côté Node (la cause est journalisée).
pub async fn send(request: reqwest::RequestBuilder) -> anyhow::Result<reqwest::Response> {
    request.send().await.map_err(|e| {
        tracing::warn!("⚠️ Requête HTTP en échec : {e}");
        anyhow::anyhow!("fetch failed")
    })
}

/// Statut HTTP, succès et corps texte d'une réponse.
async fn read_response(response: reqwest::Response) -> anyhow::Result<(u16, bool, String)> {
    let status = response.status();
    let raw = response.text().await.map_err(|e| {
        tracing::warn!("⚠️ Lecture de la réponse TikTok impossible : {e}");
        anyhow::anyhow!("fetch failed")
    })?;
    Ok((status.as_u16(), status.is_success(), raw))
}

/// Identifiants de l'application développeur TikTok (globaux à l'instance).
/// La base prime sur les variables d'environnement.
async fn get_credentials(state: &AppState) -> anyhow::Result<(String, String)> {
    let config = state.db.get_tiktok_config().await?;

    let client_key = config
        .as_ref()
        .map(|c| c.client_key.clone())
        .filter(|k| !k.is_empty())
        .or_else(|| Config::var("TIKTOK_CLIENT_KEY"));
    let client_secret = config
        .as_ref()
        .map(|c| c.client_secret.clone())
        .filter(|s| !s.is_empty())
        .or_else(|| Config::var("TIKTOK_CLIENT_SECRET"));

    match (client_key, client_secret) {
        (Some(key), Some(secret)) => Ok((key, secret)),
        _ => anyhow::bail!(
            "TikTok n'est pas configuré. Renseignez le client key et le client secret \
             de votre application TikTok dans les paramètres."
        ),
    }
}

pub async fn is_configured(state: &AppState) -> bool {
    get_credentials(state).await.is_ok()
}

/// URI de redirection OAuth. Les en-têtes servent de repli quand `APP_URL`
/// n'est pas défini : le domaine public est alors lu sur la requête plutôt que
/// remplacé par `http://localhost:5555`.
pub fn redirect_uri(state: &AppState, headers: Option<&HeaderMap>) -> String {
    if let Some(uri) = Config::var("TIKTOK_REDIRECT_URI") {
        return uri;
    }
    format!(
        "{}/api/tiktok/callback",
        resolve_public_base_url(state, headers)
    )
}

/// URL d'autorisation à ouvrir pour connecter le compte TikTok d'un magasin.
/// Chaque magasin répète ce flux : un compte = une ligne dans social_pages.
pub async fn build_authorization_url(
    state: &AppState,
    oauth_state: &str,
    headers: Option<&HeaderMap>,
) -> anyhow::Result<String> {
    let (client_key, _) = get_credentials(state).await?;
    let scopes = Config::var("TIKTOK_SCOPES").unwrap_or_else(|| DEFAULT_SCOPES.to_string());

    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("client_key", &client_key)
        .append_pair("scope", &scopes)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", &redirect_uri(state, headers))
        .append_pair("state", oauth_state)
        .finish();

    Ok(format!("{AUTH_BASE_URL}?{query}"))
}

/// Échange le code d'autorisation contre un couple access/refresh token.
pub async fn exchange_code_for_token(
    state: &AppState,
    code: &str,
    headers: Option<&HeaderMap>,
) -> anyhow::Result<TokenResponse> {
    let (client_key, client_secret) = get_credentials(state).await?;
    // TikTok renvoie le code URL-encodé dans la query string
    let code = decode_uri_component(code)?;
    let redirect = redirect_uri(state, headers);

    request_token(
        state,
        &[
            ("client_key", client_key.as_str()),
            ("client_secret", client_secret.as_str()),
            ("code", code.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect.as_str()),
        ],
    )
    .await
}

/// Renouvelle un access token expiré. TikTok rend aussi un nouveau refresh token.
pub async fn refresh_access_token(
    state: &AppState,
    refresh_token: &str,
) -> anyhow::Result<TokenResponse> {
    let (client_key, client_secret) = get_credentials(state).await?;

    request_token(
        state,
        &[
            ("client_key", client_key.as_str()),
            ("client_secret", client_secret.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ],
    )
    .await
}

async fn request_token(state: &AppState, form: &[(&str, &str)]) -> anyhow::Result<TokenResponse> {
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(form)
        .finish();

    let response = send(
        state
            .http
            .post(format!("{API_BASE_URL}/oauth/token/"))
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .header(CACHE_CONTROL, "no-cache")
            .body(body),
    )
    .await?;

    let (status, ok, raw) = read_response(response).await?;
    parse_token_payload(status, ok, &raw)
}

/// Récupère un access token valide pour une page, en le renouvelant si besoin.
/// Le nouveau couple de tokens est persisté immédiatement : le refresh token
/// TikTok est à usage unique, le perdre déconnecterait le compte.
pub async fn get_valid_access_token(state: &AppState, page: &SocialPage) -> anyhow::Result<String> {
    if page.platform != Platform::Tiktok {
        anyhow::bail!("Ce service ne gère que les comptes TikTok");
    }

    let expires_at = page
        .token_expires_at
        .map(|t| t.timestamp_millis())
        .unwrap_or(0);
    let still_valid = expires_at - TOKEN_REFRESH_MARGIN_MS > Ts::now().timestamp_millis();

    if still_valid && !page.access_token.is_empty() {
        return Ok(page.access_token.clone());
    }

    let Some(refresh_token) = page.refresh_token.as_deref().filter(|t| !t.is_empty()) else {
        anyhow::bail!(
            "Le compte TikTok \"{}\" doit être reconnecté (aucun refresh token enregistré).",
            page.page_name
        );
    };

    tracing::info!(
        "🔄 [TikTok] Renouvellement du token pour {}",
        page.page_name
    );

    let tokens = match refresh_access_token(state, refresh_token).await {
        Ok(tokens) => tokens,
        Err(error) => {
            state
                .db
                .update_social_page(
                    &page.id,
                    Patch::new()
                        .set("token_status", TokenStatus::Expired)
                        .set("last_token_check", Ts::now()),
                )
                .await?;
            anyhow::bail!(
                "Impossible de renouveler le token TikTok de \"{}\". \
                 Le compte doit être reconnecté. ({})",
                page.page_name,
                error_message(&error)
            );
        }
    };

    persist_tokens(state, &page.id, &tokens).await?;

    Ok(tokens.access_token)
}

/// Échéance « maintenant + n secondes ».
fn expires_in(now: Ts, seconds: f64) -> Ts {
    now.add(Duration::milliseconds((seconds * 1000.0) as i64))
}

/// Enregistre un couple de tokens fraîchement obtenu sur une page.
pub async fn persist_tokens(
    state: &AppState,
    page_id: &str,
    tokens: &TokenResponse,
) -> anyhow::Result<()> {
    let now = Ts::now();
    // Un champ absent de la réponse laisse la colonne inchangée
    let mut patch = Patch::new().set("access_token", tokens.access_token.clone());
    if let Some(seconds) = tokens.expires_in {
        patch = patch.set("token_expires_at", expires_in(now, seconds));
    }
    if let Some(refresh_token) = &tokens.refresh_token {
        patch = patch.set("refresh_token", refresh_token.clone());
    }
    if let Some(seconds) = tokens.refresh_expires_in {
        patch = patch.set("refresh_token_expires_at", expires_in(now, seconds));
    }
    if let Some(scope) = &tokens.scope {
        patch = patch.set("scopes", scope.clone());
    }
    let patch = patch
        .set("token_status", TokenStatus::Valid)
        .set("last_token_check", now);

    state.db.update_social_page(page_id, patch).await?;
    Ok(())
}

/// Échéances d'un couple de tokens, pour la création d'une page.
pub fn token_expirations(tokens: &TokenResponse) -> (Option<Ts>, Option<Ts>) {
    let now = Ts::now();
    (
        tokens.expires_in.map(|s| expires_in(now, s)),
        tokens.refresh_expires_in.map(|s| expires_in(now, s)),
    )
}

/// Profil public du compte, utilisé pour nommer la page à la connexion.
#[derive(Debug, Clone)]
pub struct UserProfile {
    pub open_id: Option<String>,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

pub async fn get_user_info(state: &AppState, access_token: &str) -> anyhow::Result<UserProfile> {
    let response = send(
        state
            .http
            .get(format!(
                "{API_BASE_URL}/user/info/?fields=open_id%2Cdisplay_name%2Cavatar_url"
            ))
            .bearer_auth(access_token),
    )
    .await?;

    let data = parse_api_response(response, "récupération du profil").await?;
    let user = data.get("user").cloned().unwrap_or(Value::Null);
    let text = |key: &str| user.get(key).and_then(js_string).filter(|s| !s.is_empty());

    Ok(UserProfile {
        open_id: text("open_id"),
        display_name: text("display_name").unwrap_or_else(|| "Compte TikTok".to_string()),
        avatar_url: text("avatar_url"),
    })
}

/// Options réellement autorisées sur le compte (confidentialité, commentaires,
/// duo, stitch, durée max). TikTok impose cet appel avant chaque publication.
pub async fn get_creator_info(state: &AppState, page: &SocialPage) -> anyhow::Result<CreatorInfo> {
    let token = get_valid_access_token(state, page).await?;
    query_creator_info(state, &token).await
}

/// Variante prenant un token déjà résolu : le refresh token TikTok tourne à chaque
/// renouvellement, donc une même opération ne doit déclencher qu'un seul refresh.
async fn query_creator_info(state: &AppState, access_token: &str) -> anyhow::Result<CreatorInfo> {
    let response = send(
        state
            .http
            .post(format!("{API_BASE_URL}/post/publish/creator_info/query/"))
            .bearer_auth(access_token)
            .header(CONTENT_TYPE, "application/json; charset=UTF-8"),
    )
    .await?;

    let data = parse_api_response(response, "récupération des options du compte").await?;
    Ok(CreatorInfo::from_data(&data))
}

/// Publie une vidéo avec les options par défaut ; renvoie le `publish_id`
/// (publication asynchrone, suivie par [`sync_pending_publications`]).
pub async fn publish_video_from_buffer(
    state: &AppState,
    page: &SocialPage,
    video: Bytes,
    description: &str,
) -> anyhow::Result<String> {
    publish_video_with_options(state, page, video, description, &PublishOptions::default()).await
}

/// Publie une vidéo sur un compte TikTok en trois temps :
///   1. init  — déclare la taille et le découpage, récupère publish_id + upload_url
///   2. upload — envoie les données binaires par chunks
///   3. (plus tard) status/fetch — le poller récupère l'identifiant du post
///
/// On envoie le fichier (FILE_UPLOAD) plutôt qu'une URL (PULL_FROM_URL) : cette
/// seconde option exigerait de faire vérifier le domaine de l'instance chez TikTok
/// et que les médias soient publiquement accessibles.
pub async fn publish_video_with_options(
    state: &AppState,
    page: &SocialPage,
    video: Bytes,
    caption: &str,
    options: &PublishOptions,
) -> anyhow::Result<String> {
    if page.platform != Platform::Tiktok {
        anyhow::bail!("Ce service ne gère que les comptes TikTok");
    }

    // Un seul renouvellement de token pour toute la publication
    let access_token = get_valid_access_token(state, page).await?;
    let creator_info = query_creator_info(state, &access_token).await?;
    let privacy_level = resolve_privacy_level(
        &creator_info,
        options.privacy_level.as_deref(),
        &page.page_name,
    )?;

    let video_size = video.len() as i64;
    let (chunk_size, total_chunk_count) = compute_chunking(video_size);

    tracing::info!(
        "🎬 [TikTok] Publication en cours: compte={}, taille={:.2} Mo, chunks={}, confidentialite={}",
        page.page_name,
        video_size as f64 / 1024.0 / 1024.0,
        total_chunk_count,
        privacy_level
    );

    // ── Étape 1 : init ────────────────────────────────────────────────────────
    let init_body = build_init_body(
        caption,
        &privacy_level,
        &creator_info,
        options,
        video_size,
        chunk_size,
        total_chunk_count,
    );

    let init_response = send(
        state
            .http
            .post(format!("{API_BASE_URL}/post/publish/video/init/"))
            .bearer_auth(&access_token)
            .header(CONTENT_TYPE, "application/json; charset=UTF-8")
            .body(init_body.to_string()),
    )
    .await?;

    let init_data = parse_api_response(init_response, "initialisation de la publication").await?;
    let publish_id = init_data
        .get("publish_id")
        .and_then(js_string)
        .filter(|s| !s.is_empty());
    let upload_url = init_data
        .get("upload_url")
        .and_then(js_string)
        .filter(|s| !s.is_empty());

    let (Some(publish_id), Some(upload_url)) = (publish_id, upload_url) else {
        anyhow::bail!("TikTok n'a pas renvoyé d'identifiant de publication");
    };

    tracing::info!("📤 [TikTok] Upload initialisé: publish_id={publish_id}");

    // ── Étape 2 : upload des chunks ───────────────────────────────────────────
    for index in 0..total_chunk_count {
        let (start, end) = chunk_range(index, chunk_size, total_chunk_count, video_size);
        let chunk = video.slice(start as usize..(end + 1).max(start) as usize);

        let upload_response = send(
            state
                .http
                .put(&upload_url)
                .header(CONTENT_TYPE, "video/mp4")
                .header(CONTENT_RANGE, format!("bytes {start}-{end}/{video_size}"))
                .body(chunk),
        )
        .await?;

        if !upload_response.status().is_success() {
            let status = upload_response.status().as_u16();
            let error_text = upload_response.text().await.unwrap_or_default();
            anyhow::bail!(
                "Échec de l'envoi du chunk {}/{} vers TikTok ({}): {}",
                index + 1,
                total_chunk_count,
                status,
                js_slice(&error_text, 200)
            );
        }

        tracing::info!(
            "📤 [TikTok] Chunk {}/{} envoyé",
            index + 1,
            total_chunk_count
        );
    }

    tracing::info!(
        "✅ [TikTok] Vidéo transmise pour {}, traitement en cours côté TikTok",
        page.page_name
    );

    Ok(publish_id)
}

/// Interroge TikTok sur l'avancement d'une publication.
pub async fn get_publish_status(
    state: &AppState,
    page: &SocialPage,
    publish_id: &str,
) -> anyhow::Result<PublishStatus> {
    let access_token = get_valid_access_token(state, page).await?;

    let response = send(
        state
            .http
            .post(format!("{API_BASE_URL}/post/publish/status/fetch/"))
            .bearer_auth(&access_token)
            .header(CONTENT_TYPE, "application/json; charset=UTF-8")
            .body(json!({ "publish_id": publish_id }).to_string()),
    )
    .await?;

    let data = parse_api_response(response, "suivi de la publication").await?;
    Ok(PublishStatus::from_data(&data))
}

/// Met à jour les publications TikTok encore en cours de traitement.
/// Appelé périodiquement : c'est ce qui renseigne l'identifiant définitif du post
/// (ou l'erreur) une fois que TikTok a fini d'encoder la vidéo.
pub async fn sync_pending_publications(state: &AppState) -> anyhow::Result<()> {
    let pending = state
        .db
        .get_scheduled_posts_awaiting_publish_status()
        .await?;

    if pending.is_empty() {
        return Ok(());
    }

    tracing::info!(
        "🔎 [TikTok] Suivi de {} publication(s) en cours...",
        pending.len()
    );

    for scheduled_post in pending {
        if let Err(error) = sync_one(state, &scheduled_post).await {
            tracing::error!(
                "⚠️ [TikTok] Impossible de récupérer le statut de la publication {}: {}",
                scheduled_post.id,
                error_message(&error)
            );
        }
    }

    Ok(())
}

async fn sync_one(
    state: &AppState,
    scheduled_post: &crate::db::ScheduledPost,
) -> anyhow::Result<()> {
    let page = state.db.get_social_page(&scheduled_post.page_id).await?;
    let (Some(page), Some(publish_id)) = (page, scheduled_post.publish_id.as_deref()) else {
        return Ok(());
    };
    if page.platform != Platform::Tiktok || publish_id.is_empty() {
        return Ok(());
    }

    let status = get_publish_status(state, &page, publish_id).await?;
    let current = status.status.as_deref();

    if current == Some("PUBLISH_COMPLETE") {
        state
            .db
            .update_scheduled_post(
                &scheduled_post.id,
                Patch::new()
                    .set("publish_status", "PUBLISH_COMPLETE")
                    // À défaut d'ID public (compte privé), on garde le publish_id comme référence
                    .set(
                        "external_post_id",
                        status
                            .post_id
                            .clone()
                            .filter(|id| !id.is_empty())
                            .unwrap_or_else(|| publish_id.to_string()),
                    )
                    .set_null("error"),
            )
            .await?;
        tracing::info!("✅ [TikTok] Publication terminée sur {}", page.page_name);
        return Ok(());
    }

    if current == Some("FAILED") {
        let reason = status
            .fail_reason
            .clone()
            .filter(|r| !r.is_empty())
            .unwrap_or_else(|| "raison inconnue".to_string());
        state
            .db
            .update_scheduled_post(
                &scheduled_post.id,
                Patch::new()
                    .set("publish_status", "FAILED")
                    .set("error", format!("Publication TikTok échouée : {reason}")),
            )
            .await?;
        tracing::error!(
            "❌ [TikTok] Publication échouée sur {}: {}",
            page.page_name,
            status.fail_reason.as_deref().unwrap_or("undefined")
        );
        return Ok(());
    }

    // Filet de sécurité : au-delà de 24h, on cesse d'interroger l'API
    let sent_at = scheduled_post
        .published_at
        .map(|t| t.timestamp_millis())
        .unwrap_or(0);
    if sent_at != 0 && Ts::now().timestamp_millis() - sent_at > STATUS_TRACKING_LIMIT_MS {
        let shown = current.unwrap_or("undefined");
        state
            .db
            .update_scheduled_post(
                &scheduled_post.id,
                Patch::new().set("publish_status", "FAILED").set(
                    "error",
                    format!("Statut TikTok toujours \"{shown}\" après 24h, suivi abandonné."),
                ),
            )
            .await?;
        tracing::error!(
            "❌ [TikTok] Suivi abandonné pour {} (statut {shown})",
            page.page_name
        );
        return Ok(());
    }

    match current {
        Some(current) => {
            state
                .db
                .update_scheduled_post(
                    &scheduled_post.id,
                    Patch::new().set("publish_status", current),
                )
                .await?;
        }
        // Statut absent de la réponse : rien à enregistrer, on réessaiera
        None => anyhow::bail!("No values to set"),
    }

    Ok(())
}

async fn parse_api_response(response: reqwest::Response, context: &str) -> anyhow::Result<Value> {
    let (status, ok, raw) = read_response(response).await?;
    parse_api_payload(status, ok, &raw, context)
}
