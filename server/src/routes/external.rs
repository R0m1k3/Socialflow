//! API externe (`/api/v1`) utilisée par des outils tiers (n8n…), protégée par
//! la clé du header `X-API-Key`.

use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;

use axum::extract::{FromRequestParts, Path, State};
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use base64::Engine;
use bytes::Bytes;
use regex::Regex;
use serde_json::{json, Map, Value};

use crate::db::{MediaType, NewMedia, NewPost, NewScheduledPost, Patch, PostStatus, PostType, Val};
use crate::error::AppError;
use crate::extract::{Body, QueryMap};
use crate::services::media_store::{self, MediaSource};
use crate::services::tiktok::error_message;
use crate::state::AppState;
use crate::time::Ts;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/publish", post(publish))
        .route("/pages", get(list_pages))
        .route("/posts", get(list_posts))
        .route("/posts/{id}", delete(delete_post).patch(update_post))
}

// ----------------------------------------------------------------------------
// Authentification par clé API
// ----------------------------------------------------------------------------

fn json_error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

/// Comparaison à temps constant des clés.
fn keys_match(provided: &str, expected: &str) -> bool {
    let (a, b) = (provided.as_bytes(), expected.as_bytes());
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Extracteur : la requête porte la clé de l'API externe (header `X-API-Key`),
/// comparée à `app_config.external_api_key`, à défaut à `EXTERNAL_API_KEY`.
/// Placé en premier paramètre des routes, il est vérifié avant tout le reste.
pub struct ApiKey;

impl FromRequestParts<AppState> for ApiKey {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Response> {
        let provided = parts
            .headers
            .get("x-api-key")
            .map(|v| String::from_utf8_lossy(v.as_bytes()).into_owned())
            .filter(|v| !v.is_empty());

        let Some(provided) = provided else {
            return Err(json_error(
                StatusCode::UNAUTHORIZED,
                "Clé API manquante (header X-API-Key requis)",
            ));
        };

        let config = match state.db.get_app_config().await {
            Ok(config) => config,
            Err(error) => {
                tracing::error!("[apiKey middleware] Error: {error}");
                return Err(json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Erreur interne lors de la vérification de la clé API",
                ));
            }
        };

        let key = config
            .and_then(|c| c.external_api_key)
            .filter(|k| !k.is_empty())
            .or_else(|| state.config.external_api_key.clone());

        match key {
            None => Err(json_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "API externe non configurée",
            )),
            Some(key) if !keys_match(&provided, &key) => {
                Err(json_error(StatusCode::UNAUTHORIZED, "Clé API invalide"))
            }
            Some(_) => Ok(ApiKey),
        }
    }
}

// ----------------------------------------------------------------------------
// Erreurs des routes
// ----------------------------------------------------------------------------

/// Échec d'une route : réponse déjà formée, ou erreur imprévue (→ 500).
enum Failure {
    Api(AppError),
    Other(anyhow::Error),
}

impl From<AppError> for Failure {
    fn from(error: AppError) -> Self {
        Failure::Api(error)
    }
}

impl From<anyhow::Error> for Failure {
    fn from(error: anyhow::Error) -> Self {
        Failure::Other(error)
    }
}

impl From<sqlx::Error> for Failure {
    fn from(error: sqlx::Error) -> Self {
        Failure::Other(error.into())
    }
}

impl Failure {
    /// 500 avec le message de la cause (`error.message`).
    fn with_cause(self, log: &str) -> Response {
        match self {
            Failure::Api(error) => error.into_response(),
            Failure::Other(error) => {
                tracing::error!("{log} {error:#}");
                json_error(StatusCode::INTERNAL_SERVER_ERROR, &error_message(&error))
            }
        }
    }

    /// 500 avec un message générique.
    fn generic(self, log: &str) -> Response {
        match self {
            Failure::Api(error) => error.into_response(),
            Failure::Other(error) => {
                tracing::error!("{log} {error:#}");
                json_error(StatusCode::INTERNAL_SERVER_ERROR, "Erreur interne")
            }
        }
    }
}

type Outcome = Result<Response, Failure>;

// ----------------------------------------------------------------------------
// Validation de POST /publish (schéma zod de l'ancien serveur)
// ----------------------------------------------------------------------------

const POST_TYPES: [&str; 3] = ["feed", "story", "both"];

/// `z.string().datetime({ offset: true })` (même expression que zod 3.24).
static DATETIME_RE: LazyLock<Regex> = LazyLock::new(|| {
    let date = "(([0-9][0-9][2468][048]|[0-9][0-9][13579][26]|[0-9][0-9]0[48]|[02468][048]00|[13579][26]00)-02-29|[0-9]{4}-((0[13578]|1[02])-(0[1-9]|[12][0-9]|3[01])|(0[469]|11)-(0[1-9]|[12][0-9]|30)|(02)-(0[1-9]|1[0-9]|2[0-8])))";
    let time = "([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]+)?";
    Regex::new(&format!("^{date}T{time}(Z|([+-][0-9]{{2}}:?[0-9]{{2}}))$"))
        .expect("expression de date valide")
});

#[derive(Debug, Clone, PartialEq)]
struct PublishInput {
    content: String,
    image_url: Option<String>,
    page_ids: Vec<String>,
    scheduled_at: Option<String>,
    post_type: PostType,
    user_id: Option<String>,
}

/// Type d'une valeur JSON tel que le nomme zod.
fn zod_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn type_issue(expected: &str, value: Option<&Value>) -> String {
    match value {
        None => "Required".to_string(),
        Some(value) => format!("Expected {expected}, received {}", zod_type(value)),
    }
}

/// Valide le corps comme `publishSchema.safeParse` ; en cas d'échec, renvoie
/// `error.flatten().fieldErrors`.
fn validate_publish(body: &Value) -> Result<PublishInput, Value> {
    let mut errors: Vec<(&'static str, String)> = Vec::new();
    let Some(obj) = body.as_object() else {
        // Erreur globale : aucun champ en cause
        return Err(Value::Object(Map::new()));
    };

    // content : z.string().min(1)
    let content = match obj.get("content") {
        Some(Value::String(s)) => {
            if s.is_empty() {
                errors.push(("content", "Le contenu est requis".into()));
            }
            Some(s.clone())
        }
        other => {
            errors.push(("content", type_issue("string", other)));
            None
        }
    };

    // imageUrl : z.string().url().optional()
    let image_url = match obj.get("imageUrl") {
        None => None,
        Some(Value::String(s)) => {
            if url::Url::parse(s).is_err() {
                errors.push(("imageUrl", "URL d'image invalide".into()));
            }
            Some(s.clone())
        }
        Some(other) => {
            errors.push(("imageUrl", type_issue("string", Some(other))));
            None
        }
    };

    // pageIds : z.array(z.string()).min(1)
    let page_ids = match obj.get("pageIds") {
        Some(Value::Array(items)) => {
            if items.is_empty() {
                errors.push(("pageIds", "Au moins une page est requise".into()));
            }
            let mut ids = Vec::new();
            for item in items {
                match item {
                    Value::String(s) => ids.push(s.clone()),
                    other => errors.push(("pageIds", type_issue("string", Some(other)))),
                }
            }
            ids
        }
        other => {
            errors.push(("pageIds", type_issue("array", other)));
            Vec::new()
        }
    };

    // scheduledAt : z.string().datetime({ offset: true }).optional()
    let scheduled_at = match obj.get("scheduledAt") {
        None => None,
        Some(Value::String(s)) => {
            if !DATETIME_RE.is_match(s) {
                errors.push(("scheduledAt", "Invalid datetime".into()));
            }
            Some(s.clone())
        }
        Some(other) => {
            errors.push(("scheduledAt", type_issue("string", Some(other))));
            None
        }
    };

    // postType : z.enum(["feed", "story", "both"]).default("feed")
    let expected_types = "'feed' | 'story' | 'both'";
    let post_type = match obj.get("postType") {
        None => PostType::Feed,
        Some(Value::String(s)) if POST_TYPES.contains(&s.as_str()) => {
            PostType::parse(s).unwrap_or(PostType::Feed)
        }
        Some(Value::String(s)) => {
            errors.push((
                "postType",
                format!("Invalid enum value. Expected {expected_types}, received '{s}'"),
            ));
            PostType::Feed
        }
        Some(other) => {
            errors.push(("postType", type_issue(expected_types, Some(other))));
            PostType::Feed
        }
    };

    // userId : z.string().optional()
    let user_id = match obj.get("userId") {
        None => None,
        Some(Value::String(s)) => Some(s.clone()),
        Some(other) => {
            errors.push(("userId", type_issue("string", Some(other))));
            None
        }
    };

    if !errors.is_empty() {
        let mut details = Map::new();
        for (field, message) in errors {
            details
                .entry(field)
                .or_insert_with(|| Value::Array(Vec::new()))
                .as_array_mut()
                .expect("tableau de messages")
                .push(Value::String(message));
        }
        return Err(Value::Object(details));
    }

    Ok(PublishInput {
        content: content.unwrap_or_default(),
        image_url,
        page_ids,
        scheduled_at,
        post_type,
        user_id,
    })
}

// ----------------------------------------------------------------------------
// Téléchargement d'une image distante
// ----------------------------------------------------------------------------

/// Taille maximale d'une image téléchargée : 10 Mo.
const MAX_IMAGE_SIZE: usize = 10 * 1024 * 1024;

/// Délai d'obtention de la réponse (en-têtes).
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10);

fn image_extension(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "image/jpeg" => Some(".jpg"),
        "image/png" => Some(".png"),
        "image/webp" => Some(".webp"),
        "image/gif" => Some(".gif"),
        _ => None,
    }
}

/// Type MIME d'un en-tête `Content-Type` (sans paramètres).
fn mime_of(content_type: &str) -> String {
    content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_string()
}

struct DownloadedImage {
    buffer: Bytes,
    ext: &'static str,
}

/// Contenu d'une URL `data:` (acceptée par `fetch` côté Node).
fn decode_data_url(url: &str) -> Option<(String, Bytes)> {
    let rest = url.strip_prefix("data:")?;
    let (meta, data) = rest.split_once(',')?;
    let (mime, is_base64) = match meta.strip_suffix(";base64") {
        Some(mime) => (mime, true),
        None => (meta, false),
    };
    let bytes: Vec<u8> = percent_encoding::percent_decode_str(data).collect();
    let bytes = if is_base64 {
        let cleaned: Vec<u8> = bytes
            .into_iter()
            .filter(|b| !b.is_ascii_whitespace())
            .collect();
        base64::engine::general_purpose::STANDARD
            .decode(&cleaned)
            .ok()?
    } else {
        bytes
    };
    let mime = if mime.is_empty() {
        "text/plain;charset=US-ASCII".to_string()
    } else {
        mime.to_string()
    };
    Some((mime, Bytes::from(bytes)))
}

fn check_image(content_type: &str, buffer: Bytes) -> anyhow::Result<DownloadedImage> {
    let mime_type = mime_of(content_type);
    let Some(ext) = image_extension(&mime_type) else {
        anyhow::bail!(
            "Type MIME non supporté: {mime_type}. Formats acceptés: JPEG, PNG, WebP, GIF"
        );
    };
    if buffer.len() > MAX_IMAGE_SIZE {
        anyhow::bail!(
            "Image trop volumineuse ({:.1} MB, max 10 MB)",
            buffer.len() as f64 / 1024.0 / 1024.0
        );
    }
    Ok(DownloadedImage { buffer, ext })
}

async fn download_image(state: &AppState, url: &str) -> anyhow::Result<DownloadedImage> {
    let parsed =
        url::Url::parse(url).map_err(|_| anyhow::anyhow!("Failed to parse URL from {url}"))?;

    if parsed.scheme() == "data" {
        let (mime, buffer) = decode_data_url(url).ok_or_else(|| anyhow::anyhow!("fetch failed"))?;
        return check_image(&mime, buffer);
    }

    let response = match tokio::time::timeout(DOWNLOAD_TIMEOUT, state.http.get(parsed).send()).await
    {
        Err(_) => anyhow::bail!("This operation was aborted"),
        Ok(Err(error)) => {
            tracing::warn!("[external API] Téléchargement impossible de {url}: {error}");
            anyhow::bail!("fetch failed");
        }
        Ok(Ok(response)) => response,
    };

    if !response.status().is_success() {
        anyhow::bail!(
            "Impossible de télécharger l'image (HTTP {})",
            response.status().as_u16()
        );
    }

    let content_type = response
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    // Le type est contrôlé avant de lire le corps, comme l'ancien serveur
    if image_extension(&mime_of(&content_type)).is_none() {
        return check_image(&content_type, Bytes::new());
    }
    let buffer = response.bytes().await.map_err(|error| {
        tracing::warn!("[external API] Lecture impossible de {url}: {error}");
        anyhow::anyhow!("fetch failed")
    })?;
    check_image(&content_type, buffer)
}

/// Télécharge une image et l'enregistre comme média du propriétaire.
async fn import_image(
    state: &AppState,
    url: &str,
    owner_id: &str,
    prefix: &str,
) -> anyhow::Result<crate::db::Media> {
    let image = download_image(state, url).await?;
    let file_name = format!(
        "{prefix}-{}{}",
        chrono::Utc::now().timestamp_millis(),
        image.ext
    );
    let uploaded =
        media_store::upload_media(state, MediaSource::Bytes(&image.buffer), &file_name).await?;
    let media = state
        .db
        .create_media(NewMedia {
            user_id: owner_id.to_string(),
            media_type: Some(MediaType::Image),
            cloudinary_public_id: Some(uploaded.public_id),
            original_url: uploaded.original_url,
            facebook_feed_url: uploaded.facebook_feed_url,
            instagram_feed_url: uploaded.instagram_feed_url,
            instagram_story_url: uploaded.instagram_story_url,
            file_name,
            file_size: image.buffer.len() as i32,
            ..Default::default()
        })
        .await?;
    Ok(media)
}

// ----------------------------------------------------------------------------
// POST /api/v1/publish
// ----------------------------------------------------------------------------

/// Crée une publication (avec image optionnelle téléchargée depuis une URL)
/// et la programme pour une ou plusieurs pages.
async fn publish(_key: ApiKey, State(state): State<AppState>, Body(body): Body<Value>) -> Response {
    match publish_inner(&state, &body).await {
        Ok(response) => response,
        Err(failure) => failure.with_cause("[external API] Error:"),
    }
}

async fn publish_inner(state: &AppState, body: &Value) -> Outcome {
    let input = match validate_publish(body) {
        Ok(input) => input,
        Err(details) => {
            return Err(AppError::json(
                StatusCode::BAD_REQUEST,
                json!({ "error": "Données invalides", "details": details }),
            )
            .into())
        }
    };

    // Résoudre l'utilisateur propriétaire
    let owner_id = match input.user_id.as_deref().filter(|id| !id.is_empty()) {
        None => {
            let users = state.db.get_all_users().await?;
            match users.into_iter().find(|u| u.is_admin()) {
                Some(admin) => admin.id,
                None => return Err(AppError::internal("Aucun utilisateur admin trouvé").into()),
            }
        }
        Some(user_id) => {
            if state.db.get_user(user_id).await?.is_none() {
                return Err(
                    AppError::bad_request(format!("Utilisateur introuvable: {user_id}")).into(),
                );
            }
            user_id.to_string()
        }
    };

    // Vérifier que toutes les pages existent
    let mut resolved_pages: Vec<(String, String)> = Vec::new();
    for page_id in &input.page_ids {
        match state.db.get_social_page(page_id).await? {
            Some(page) => resolved_pages.push((page.id, page.page_name)),
            None => {
                return Err(AppError::bad_request(format!("Page introuvable: {page_id}")).into())
            }
        }
    }

    // Validation story → image obligatoire
    let needs_image = matches!(input.post_type, PostType::Story | PostType::Both);
    if needs_image && input.image_url.as_deref().is_none_or(str::is_empty) {
        return Err(
            AppError::bad_request("Les stories nécessitent une image (imageUrl requis)").into(),
        );
    }

    // Télécharger l'image si fournie
    let media = match input.image_url.as_deref().filter(|u| !u.is_empty()) {
        Some(url) => Some(import_image(state, url, &owner_id, "external").await?),
        None => None,
    };

    // Créer le post (heure de publication absente = immédiat)
    let scheduled_at = match &input.scheduled_at {
        Some(value) => Ts::parse(value)
            .and_then(|ts| Ts::from_millis(ts.timestamp_millis()))
            .ok_or_else(|| anyhow::anyhow!("Invalid time value"))?,
        None => Ts::now(),
    };

    let mut new_post = NewPost::new(owner_id.clone(), input.content.clone());
    new_post.status = PostStatus::Scheduled;
    new_post.scheduled_for = Some(scheduled_at);
    let post = state.db.create_post(new_post).await?;

    // Lier le média si présent
    if let Some(media) = &media {
        state
            .db
            .set_post_media(&post.id, &[(media.id.clone(), 0)], false)
            .await?;
    }

    // Créer les scheduled_posts par page
    let mut created = Vec::new();
    for (page_id, page_name) in &resolved_pages {
        let types: &[PostType] = if input.post_type == PostType::Both {
            &[PostType::Story, PostType::Feed]
        } else {
            std::slice::from_ref(&input.post_type)
        };
        for post_type in types {
            let scheduled = state
                .db
                .create_scheduled_post(NewScheduledPost::new(
                    post.id.clone(),
                    page_id.clone(),
                    *post_type,
                    scheduled_at,
                ))
                .await?;
            created.push(json!({
                "pageId": page_id,
                "pageName": page_name,
                "scheduledPostId": scheduled.id,
            }));
        }
    }

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "success": true,
            "post": {
                "id": post.id,
                "content": post.content,
                "status": post.status,
                "scheduledAt": scheduled_at,
                "postType": input.post_type,
                "pages": created,
                "media": media.map(|m| json!({ "id": m.id, "url": m.original_url })),
            },
        })),
    )
        .into_response())
}

// ----------------------------------------------------------------------------
// GET /api/v1/pages
// ----------------------------------------------------------------------------

/// Liste les pages disponibles (id + nom + plateforme), pour connaître les
/// `pageIds` à passer à /publish.
async fn list_pages(_key: ApiKey, State(state): State<AppState>) -> Response {
    let result: Outcome = async {
        let users = state.db.get_all_users().await?;
        let Some(admin) = users.into_iter().find(|u| u.is_admin()) else {
            return Err(AppError::internal("Aucun utilisateur admin trouvé").into());
        };
        let pages = state.db.get_social_pages(&admin.id).await?;
        let list: Vec<Value> = pages
            .iter()
            .map(|p| {
                json!({
                    "id": p.id,
                    "pageName": p.page_name,
                    "platform": p.platform,
                    "pageId": p.page_id,
                    "tokenStatus": p.token_status,
                })
            })
            .collect();
        Ok(Json(list).into_response())
    }
    .await;
    result.unwrap_or_else(|f| f.generic("[external API] Error listing pages:"))
}

// ----------------------------------------------------------------------------
// GET /api/v1/posts
// ----------------------------------------------------------------------------

/// Médias d'un post, dans l'ordre d'affichage : `{ id, url, type }`.
async fn post_media_items(state: &AppState, post_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    let links = state.db.get_post_media(post_id).await?;
    let ids: Vec<String> = links.iter().map(|l| l.media_id.clone()).collect();
    let by_id: HashMap<String, crate::db::Media> = state
        .db
        .get_media_by_ids(&ids)
        .await?
        .into_iter()
        .map(|m| (m.id.clone(), m))
        .collect();
    Ok(links
        .iter()
        .filter_map(|l| by_id.get(&l.media_id))
        .map(|m| json!({ "id": m.id, "url": m.original_url, "type": m.media_type }))
        .collect())
}

/// Liste les publications planifiées (à venir).
///
/// Paramètres : `pageId`, `from`, `to` (ISO 8601), `status` (défaut : scheduled, ou `all`).
async fn list_posts(_key: ApiKey, State(state): State<AppState>, query: QueryMap) -> Response {
    list_posts_inner(&state, &query)
        .await
        .unwrap_or_else(|f| f.generic("[external API] GET /posts error:"))
}

async fn list_posts_inner(state: &AppState, query: &QueryMap) -> Outcome {
    let post_status = query.non_empty("status").unwrap_or("scheduled");

    // Toutes les pages, ou une seule si filtrée
    let page_ids: Vec<String> = match query.non_empty("pageId") {
        Some(page_id) => {
            if state.db.get_social_page(page_id).await?.is_none() {
                return Err(AppError::not_found(format!("Page introuvable: {page_id}")).into());
            }
            vec![page_id.to_string()]
        }
        None => state
            .db
            .get_all_social_pages()
            .await?
            .into_iter()
            .map(|p| p.id)
            .collect(),
    };

    if page_ids.is_empty() {
        return Ok(Json(json!([])).into_response());
    }

    // Une date illisible faisait échouer la requête (`Invalid time value`)
    let parse_bound = |key: &str| -> Result<Option<Ts>, Failure> {
        match query.non_empty(key) {
            None => Ok(None),
            Some(value) => Ts::parse(value)
                .map(Some)
                .ok_or_else(|| anyhow::anyhow!("Invalid time value").into()),
        }
    };
    let start = parse_bound("from")?;
    let end = parse_bound("to")?;

    let scheduled_posts = state
        .db
        .get_scheduled_posts_by_pages(&page_ids, start, end)
        .await?;

    // Grouper par post, en ne gardant que les posts non publiés au bon statut
    let mut order: Vec<String> = Vec::new();
    let mut posts: HashMap<String, Value> = HashMap::new();

    for sp in scheduled_posts {
        if sp.scheduled.published_at.is_some() {
            continue;
        }
        let post = &sp.post;
        if post.status.as_str() != post_status && post_status != "all" {
            continue;
        }

        if !posts.contains_key(&post.id) {
            let media = post_media_items(state, &post.id).await?;
            order.push(post.id.clone());
            posts.insert(
                post.id.clone(),
                json!({
                    "id": post.id,
                    "content": post.content,
                    "status": post.status,
                    "scheduledFor": post.scheduled_for,
                    "createdAt": post.created_at,
                    "media": media,
                    "schedules": [],
                }),
            );
        }

        let schedule = json!({
            "id": sp.scheduled.id,
            "pageId": sp.scheduled.page_id,
            "pageName": sp.page.as_ref().map(|p| p.page_name.clone()).filter(|n| !n.is_empty()).unwrap_or_else(|| "Inconnu".into()),
            "platform": sp.page.as_ref().map(|p| p.platform.as_str()).unwrap_or("facebook"),
            "postType": sp.scheduled.post_type,
            "scheduledAt": sp.scheduled.scheduled_at,
        });
        if let Some(Value::Array(schedules)) =
            posts.get_mut(&post.id).and_then(|p| p.get_mut("schedules"))
        {
            schedules.push(schedule);
        }
    }

    let list: Vec<Value> = order.iter().filter_map(|id| posts.remove(id)).collect();
    Ok(Json(list).into_response())
}

// ----------------------------------------------------------------------------
// PATCH /api/v1/posts/:id
// ----------------------------------------------------------------------------

/// Valeur JSON écrite dans une colonne texte, comme le faisait node-postgres.
fn text_value(value: &Value) -> Val {
    match value {
        Value::Null => Val::Text(None),
        Value::String(s) => Val::Text(Some(s.clone())),
        Value::Number(n) => Val::Text(Some(n.to_string())),
        Value::Bool(b) => Val::Text(Some(b.to_string())),
        other => Val::Text(Some(other.to_string())),
    }
}

/// `new Date(value)` ; `None` pour une date invalide.
fn js_new_date(value: &Value) -> Option<Ts> {
    match value {
        Value::Null => Ts::from_millis(0),
        Value::Bool(b) => Ts::from_millis(i64::from(*b)),
        Value::Number(n) => n.as_f64().and_then(|f| Ts::from_millis(f.trunc() as i64)),
        Value::String(s) => Ts::parse(s).and_then(|ts| Ts::from_millis(ts.timestamp_millis())),
        _ => None,
    }
}

/// Texte d'une valeur passée à `fetch()` (`String(value)`).
fn js_url_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Null => "null".into(),
        Value::Object(_) => "[object Object]".into(),
        Value::Array(items) => items
            .iter()
            .map(|v| match v {
                Value::Null => String::new(),
                Value::String(s) => s.clone(),
                other => js_url_text(other),
            })
            .collect::<Vec<_>>()
            .join(","),
        other => other.to_string(),
    }
}

/// Planifications non publiées d'un post, avec la page.
async fn pending_schedules(state: &AppState, post_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    let mut schedules = Vec::new();
    for sp in state.db.get_scheduled_posts_by_post(post_id).await? {
        if sp.published_at.is_some() {
            continue;
        }
        let page = state.db.get_social_page(&sp.page_id).await?;
        schedules.push(json!({
            "id": sp.id,
            "pageId": sp.page_id,
            "pageName": page.as_ref().map(|p| p.page_name.clone()).filter(|n| !n.is_empty()).unwrap_or_else(|| "Inconnu".into()),
            "platform": page.as_ref().map(|p| p.platform.as_str()).unwrap_or("facebook"),
            "postType": sp.post_type,
            "scheduledAt": sp.scheduled_at,
        }));
    }
    Ok(schedules)
}

/// Modifie une publication planifiée : `content`, `scheduledAt`, `imageUrl`.
async fn update_post(
    _key: ApiKey,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Body(body): Body<Value>,
) -> Response {
    update_post_inner(&state, &id, &body)
        .await
        .unwrap_or_else(|f| f.with_cause("[external API] PATCH /posts/:id error:"))
}

async fn update_post_inner(state: &AppState, id: &str, body: &Value) -> Outcome {
    // Vérifier que le post existe et est modifiable
    let Some(post) = state.db.get_post(id).await? else {
        return Err(AppError::not_found("Post introuvable").into());
    };
    if post.status == PostStatus::Published {
        return Err(AppError::bad_request("Impossible de modifier un post déjà publié").into());
    }

    // Mettre à jour le contenu si fourni
    if let Some(content) = body.get("content") {
        state
            .db
            .update_post(id, Patch::new().set("content", text_value(content)))
            .await?;
    }

    // Mettre à jour la date de planification si fournie
    if let Some(value) = body.get("scheduledAt") {
        let new_date = js_new_date(value).ok_or_else(|| anyhow::anyhow!("Invalid time value"))?;
        state
            .db
            .update_post(id, Patch::new().set("scheduled_for", new_date))
            .await?;

        // Propager à tous les scheduled_posts du post
        for sp in state.db.get_scheduled_posts_by_post(id).await? {
            if sp.published_at.is_none() {
                state
                    .db
                    .update_scheduled_post(&sp.id, Patch::new().set("scheduled_at", new_date))
                    .await?;
            }
        }
    }

    // Remplacer le média si une nouvelle imageUrl est fournie
    if let Some(image_url) = body.get("imageUrl") {
        let media = import_image(
            state,
            &js_url_text(image_url),
            &post.user_id,
            "external-edit",
        )
        .await?;
        state.db.update_post_media(id, &[media.id]).await?;
    }

    // Retourner le post mis à jour
    let updated = state
        .db
        .get_post(id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Cannot read properties of undefined (reading 'id')"))?;

    let mut media_items = Vec::new();
    for link in state.db.get_post_media(id).await? {
        if let Some(item) = state.db.get_media_by_id(&link.media_id).await? {
            media_items
                .push(json!({ "id": item.id, "url": item.original_url, "type": item.media_type }));
        }
    }

    let schedules = pending_schedules(state, id).await?;

    Ok(Json(json!({
        "success": true,
        "post": {
            "id": updated.id,
            "content": updated.content,
            "status": updated.status,
            "scheduledFor": updated.scheduled_for,
            "createdAt": updated.created_at,
            "media": media_items,
            "schedules": schedules,
        },
    }))
    .into_response())
}

// ----------------------------------------------------------------------------
// DELETE /api/v1/posts/:id
// ----------------------------------------------------------------------------

/// Supprime un post planifié ; la cascade supprime ses planifications et liens médias.
async fn delete_post(
    _key: ApiKey,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let result: Outcome = async {
        let Some(post) = state.db.get_post(&id).await? else {
            return Err(AppError::not_found("Post introuvable").into());
        };
        if post.status == PostStatus::Published {
            return Err(
                AppError::bad_request("Impossible de supprimer un post déjà publié").into(),
            );
        }
        state.db.delete_post(&id).await?;
        Ok(Json(json!({ "success": true, "deleted": id })).into_response())
    }
    .await;
    result.unwrap_or_else(|f| f.generic("[external API] DELETE /posts/:id error:"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publish_validation_success_and_defaults() {
        let input = validate_publish(&json!({
            "content": "Promo",
            "pageIds": ["p1"],
            "scheduledAt": "2026-05-01T10:30:00+02:00",
            "extra": true,
        }))
        .unwrap();
        assert_eq!(input.post_type, PostType::Feed);
        assert_eq!(input.page_ids, vec!["p1".to_string()]);
        assert_eq!(
            input.scheduled_at.as_deref(),
            Some("2026-05-01T10:30:00+02:00")
        );
    }

    #[test]
    fn publish_validation_field_errors() {
        let details = validate_publish(&json!({})).unwrap_err();
        assert_eq!(
            details,
            json!({ "content": ["Required"], "pageIds": ["Required"] })
        );

        let details = validate_publish(&json!({
            "content": "",
            "imageUrl": "pas une url",
            "pageIds": [],
            "scheduledAt": "2026-05-01 10:30",
            "postType": "reel",
            "userId": 4,
        }))
        .unwrap_err();
        assert_eq!(
            details,
            json!({
                "content": ["Le contenu est requis"],
                "imageUrl": ["URL d'image invalide"],
                "pageIds": ["Au moins une page est requise"],
                "scheduledAt": ["Invalid datetime"],
                "postType": ["Invalid enum value. Expected 'feed' | 'story' | 'both', received 'reel'"],
                "userId": ["Expected string, received number"],
            })
        );

        let details = validate_publish(&json!({
            "content": 3, "pageIds": ["a", 1, null], "postType": 2, "imageUrl": null
        }))
        .unwrap_err();
        assert_eq!(
            details,
            json!({
                "content": ["Expected string, received number"],
                "imageUrl": ["Expected string, received null"],
                "pageIds": ["Expected string, received number", "Expected string, received null"],
                "postType": ["Expected 'feed' | 'story' | 'both', received number"],
            })
        );

        assert_eq!(validate_publish(&json!([])).unwrap_err(), json!({}));
    }

    #[test]
    fn datetime_regex_matches_zod() {
        for ok in [
            "2026-05-01T10:30:00Z",
            "2026-05-01T10:30:00.123Z",
            "2026-05-01T10:30:00+02:00",
            "2026-05-01T10:30:00+0200",
            "2024-02-29T00:00:00Z",
        ] {
            assert!(DATETIME_RE.is_match(ok), "{ok}");
        }
        for bad in [
            "2026-05-01T10:30Z",
            "2026-05-01T10:30:00",
            "2023-02-29T00:00:00Z",
            "2026-13-01T00:00:00Z",
            "2026-05-01 10:30:00Z",
            "２０２６-05-01T10:30:00Z",
        ] {
            assert!(!DATETIME_RE.is_match(bad), "{bad}");
        }
    }

    #[test]
    fn image_checks() {
        assert_eq!(mime_of("image/png; charset=binary"), "image/png");
        assert!(check_image("image/png", Bytes::from_static(b"x")).is_ok());
        assert_eq!(
            check_image("text/html; charset=utf-8", Bytes::new())
                .err()
                .unwrap()
                .to_string(),
            "Type MIME non supporté: text/html. Formats acceptés: JPEG, PNG, WebP, GIF"
        );
        let big = Bytes::from(vec![0u8; MAX_IMAGE_SIZE + 1]);
        assert_eq!(
            check_image("image/jpeg", big).err().unwrap().to_string(),
            "Image trop volumineuse (10.0 MB, max 10 MB)"
        );
        let (mime, data) = decode_data_url("data:image/png;base64,aGVsbG8=").unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(&data[..], b"hello");
    }

    #[test]
    fn js_conversions() {
        assert_eq!(
            js_new_date(&json!(null)).unwrap().to_iso(),
            "1970-01-01T00:00:00.000Z"
        );
        assert_eq!(
            js_new_date(&json!("2026-05-01T10:30:00.123456+02:00"))
                .unwrap()
                .to_iso(),
            "2026-05-01T08:30:00.123Z"
        );
        assert!(js_new_date(&json!("demain")).is_none());
        assert!(js_new_date(&json!({})).is_none());
        assert_eq!(js_url_text(&json!(null)), "null");
        assert_eq!(js_url_text(&json!(12)), "12");
        assert!(keys_match("abc", "abc"));
        assert!(!keys_match("abc", "abd"));
        assert!(!keys_match("abc", "abcd"));
    }
}
