//! Publication Facebook (API Graph), portage de `server/services/facebook.ts`.
//!
//! Sous-modules : client Graph générique (`graph`), connexion OAuth et
//! renouvellement des jetons (`oauth`), image de story avec texte incrusté
//! (`story_image`, `emoji`).

pub mod emoji;
pub mod graph;
pub mod oauth;
pub mod story_image;

use std::time::Duration;

use anyhow::bail;
use bytes::Bytes;
use once_cell::sync::Lazy;
use regex::Regex;
use reqwest::multipart::{Form, Part};
use serde_json::Value;

use crate::db::{Media, MediaType, Platform, Post, PostType, SocialPage};
use crate::services::media_store;
use crate::state::AppState;

const BASE_URL: &str = "https://graph.facebook.com/v23.0";

/// Suivi du traitement d'une story vidéo après la phase FINISH.
const STORY_STATUS_ATTEMPTS: u32 = 12;
const STORY_STATUS_INTERVAL: Duration = Duration::from_secs(5);

// ----------------------------------------------------------------------
// Utilitaires
// ----------------------------------------------------------------------

/// URL `/{node}/{edge}` de l'API Graph avec ses paramètres en query string.
fn graph_url(node: &str, edge: &str, params: &[(&str, &str)]) -> anyhow::Result<url::Url> {
    let mut url = url::Url::parse(&format!("{BASE_URL}/{node}/{edge}"))?;
    if !params.is_empty() {
        url.query_pairs_mut().extend_pairs(params);
    }
    Ok(url)
}

/// Valeur rendue comme dans un gabarit JavaScript (`${valeur}`).
fn js(value: Option<&Value>) -> String {
    match value {
        None => "undefined".to_string(),
        Some(Value::Null) => "null".to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
    }
}

/// Texte non vide d'un champ (identifiants renvoyés en chaîne ou en nombre).
fn field(data: &Value, key: &str) -> Option<String> {
    match data.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

/// Message d'une erreur Graph : `{prefix}: {message} (code: {code})`.
fn format_api_error(prefix: &str, status: u16, body: &str) -> String {
    match serde_json::from_str::<Value>(body) {
        Ok(data) if data.get("error").is_some_and(Value::is_object) => {
            let error = &data["error"];
            format!(
                "{prefix}: {} (code: {})",
                js(error.get("message")),
                js(error.get("code"))
            )
        }
        _ => {
            let excerpt: String = body.chars().take(500).collect();
            format!("{prefix}: HTTP {status} {excerpt}")
                .trim_end()
                .to_string()
        }
    }
}

async fn api_error(prefix: &str, response: reqwest::Response) -> anyhow::Error {
    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();
    anyhow::anyhow!(format_api_error(prefix, status, &body))
}

/// `POST` sans corps (paramètres en query string), réponse JSON exigée.
async fn post_query(state: &AppState, url: url::Url, error_prefix: &str) -> anyhow::Result<Value> {
    let response = state.http.post(url).send().await?;
    if !response.status().is_success() {
        return Err(api_error(error_prefix, response).await);
    }
    Ok(response.json().await?)
}

/// `POST` multipart, réponse JSON exigée.
async fn post_form(
    state: &AppState,
    url: url::Url,
    form: Form,
    error_prefix: &str,
) -> anyhow::Result<Value> {
    let response = state.http.post(url).multipart(form).send().await?;
    if !response.status().is_success() {
        return Err(api_error(error_prefix, response).await);
    }
    Ok(response.json().await?)
}

/// Contenu d'un média : fichier local `/uploads/...` (à défaut, son URL
/// publique) ou URL distante.
async fn get_media_buffer(state: &AppState, url: &str) -> anyhow::Result<Bytes> {
    if url.starts_with("http") {
        let response = state.http.get(url).send().await?;
        if !response.status().is_success() {
            bail!("Failed to fetch media from {url}");
        }
        return Ok(response.bytes().await?);
    }
    media_store::read_media_buffer(state, url).await
}

fn basename(url: &str) -> String {
    url.rsplit('/').next().unwrap_or(url).to_string()
}

fn image_mime(file_name: &str) -> &'static str {
    if file_name.to_lowercase().ends_with(".png") {
        "image/png"
    } else {
        "image/jpeg"
    }
}

fn file_part(data: Bytes, file_name: String, mime: &str) -> anyhow::Result<Part> {
    Ok(Part::stream(reqwest::Body::from(data))
        .file_name(file_name)
        .mime_str(mime)?)
}

fn require_token(page: &SocialPage) -> anyhow::Result<&str> {
    if page.access_token.is_empty() {
        bail!("No access token found for this page");
    }
    Ok(&page.access_token)
}

// ----------------------------------------------------------------------
// Publication
// ----------------------------------------------------------------------

/// Publie un post (feed, story, reel) sur une page Facebook ; renvoie
/// l'identifiant externe (plusieurs stories : identifiants séparés par « , »).
pub async fn publish_post(
    state: &AppState,
    post: &Post,
    page: &SocialPage,
    post_type: PostType,
    media: &[Media],
) -> anyhow::Result<String> {
    if page.platform != Platform::Facebook {
        bail!("This service only supports Facebook pages");
    }
    require_token(page)?;

    match post_type {
        // Les nouveaux posts « both » sont scindés à la création : seul un
        // ancien enregistrement peut arriver ici.
        PostType::Both => bail!(
            "postType \"both\" is not supported. Posts should be split into separate feed and story entries at creation."
        ),
        PostType::Story => {
            if media.is_empty() {
                bail!("Stories require media (photo or video)");
            }
            // Une story par média
            let mut story_ids = Vec::with_capacity(media.len());
            for item in media {
                story_ids.push(publish_story(state, post, page, item).await?);
            }
            Ok(story_ids.join(","))
        }
        PostType::Reel => {
            if media.is_empty() {
                bail!("Reels require a video");
            }
            let Some(video) = media.iter().find(|m| m.media_type == MediaType::Video) else {
                bail!("Reels require a video media");
            };
            // Lecture locale d'abord, URL publique en secours
            let buffer = get_media_buffer(state, &video.original_url).await?;
            publish_video_from_buffer(state, page, buffer, &post.content).await
        }
        PostType::Feed => {
            let images: Vec<&Media> = media.iter().filter(|m| m.media_type == MediaType::Image).collect();
            let videos: Vec<&Media> = media.iter().filter(|m| m.media_type == MediaType::Video).collect();

            if images.len() > 1 {
                publish_multi_photo_post(state, post, page, media).await
            } else if let Some(image) = images.first() {
                // Une image (prioritaire sur d'éventuelles vidéos)
                publish_photo_post(state, post, page, image).await
            } else if let Some(video) = videos.first() {
                publish_video_post(state, post, page, video).await
            } else {
                publish_text_post(state, post, page).await
            }
        }
    }
}

async fn publish_text_post(
    state: &AppState,
    post: &Post,
    page: &SocialPage,
) -> anyhow::Result<String> {
    let url = graph_url(
        &page.page_id,
        "feed",
        &[
            ("access_token", &page.access_token),
            ("message", &post.content),
        ],
    )?;
    let data = post_query(state, url, "Facebook API error").await?;
    Ok(field(&data, "id").unwrap_or_default())
}

async fn publish_photo_post(
    state: &AppState,
    post: &Post,
    page: &SocialPage,
    media: &Media,
) -> anyhow::Result<String> {
    let buffer = get_media_buffer(state, &media.original_url).await?;
    let mut form = Form::new().text("access_token", page.access_token.clone());
    if !post.content.is_empty() {
        form = form.text("message", post.content.clone());
    }
    let form = form.part(
        "source",
        file_part(
            buffer,
            basename(&media.original_url),
            image_mime(&media.original_url),
        )?,
    );

    let url = graph_url(&page.page_id, "photos", &[])?;
    let data = post_form(state, url, form, "Facebook API error").await?;
    // post_id est l'identifiant complet du post
    Ok(field(&data, "post_id")
        .or_else(|| field(&data, "id"))
        .unwrap_or_default())
}

/// URL Cloudinary transcodée pour Facebook (H.264, AAC, MP4) ; les autres
/// URL sont renvoyées telles quelles.
pub fn facebook_compatible_video_url(original_url: &str) -> String {
    static CLOUDINARY: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"https://res\.cloudinary\.com/([^/]+)/video/upload/").expect("regex valide")
    });

    let Some(captures) = CLOUDINARY.captures(original_url) else {
        tracing::warn!(
            "Video URL is not from Cloudinary, cannot apply transformations: {original_url}"
        );
        return original_url.to_string();
    };
    let full_match = captures.get(0).map(|m| m.as_str()).unwrap_or_default();
    let cloud_name = &captures[1];
    let video_path = original_url.replacen(full_match, "", 1);

    // vc_h264 : vidéo H.264 ; ac_aac : audio AAC ; f_mp4 : conteneur MP4 ; q_auto : qualité auto
    let transformed =
        format!("https://res.cloudinary.com/{cloud_name}/video/upload/vc_h264,ac_aac,f_mp4,q_auto/{video_path}");
    tracing::info!(
        "🎬 Transforming video for Facebook compatibility: {original_url} → {transformed}"
    );
    transformed
}

async fn publish_video_post(
    state: &AppState,
    post: &Post,
    page: &SocialPage,
    media: &Media,
) -> anyhow::Result<String> {
    let video_url =
        facebook_compatible_video_url(&media_store::resolve_public_url(state, &media.original_url));
    let url = graph_url(
        &page.page_id,
        "videos",
        &[
            ("access_token", &page.access_token),
            ("description", &post.content),
            ("file_url", &video_url),
        ],
    )?;
    let data = post_query(state, url, "Facebook API error publishing video").await?;
    Ok(field(&data, "post_id")
        .or_else(|| field(&data, "id"))
        .unwrap_or_default())
}

async fn publish_multi_photo_post(
    state: &AppState,
    post: &Post,
    page: &SocialPage,
    media: &[Media],
) -> anyhow::Result<String> {
    let images: Vec<&Media> = media
        .iter()
        .filter(|m| m.media_type == MediaType::Image)
        .collect();
    if images.is_empty() {
        bail!("Multi-photo posts require at least one image");
    }
    if images.len() != media.len() {
        tracing::warn!(
            "Filtered out {} non-image media from multi-photo post",
            media.len() - images.len()
        );
    }

    // 1. Envoi de chaque photo non publiée
    let mut photo_ids = Vec::new();
    for image in images {
        if image.original_url.is_empty() {
            tracing::warn!("Skipping media {} - no valid URL found", image.id);
            continue;
        }
        let buffer = get_media_buffer(state, &image.original_url).await?;
        let form = Form::new()
            .text("access_token", page.access_token.clone())
            .text("published", "false")
            .part(
                "source",
                file_part(
                    buffer,
                    basename(&image.original_url),
                    image_mime(&image.original_url),
                )?,
            );
        let url = graph_url(&page.page_id, "photos", &[])?;
        let data = post_form(state, url, form, "Facebook API error uploading photo").await?;
        photo_ids.push(field(&data, "id").unwrap_or_default());
    }

    if photo_ids.is_empty() {
        bail!("No photos were successfully uploaded");
    }

    // 2. Post du fil avec toutes les photos jointes
    let attached: Vec<(String, String)> = photo_ids
        .iter()
        .enumerate()
        .map(|(index, id)| {
            (
                format!("attached_media[{index}]"),
                serde_json::json!({ "media_fbid": id }).to_string(),
            )
        })
        .collect();
    let mut params: Vec<(&str, &str)> = vec![
        ("access_token", &page.access_token),
        ("message", &post.content),
    ];
    params.extend(attached.iter().map(|(k, v)| (k.as_str(), v.as_str())));

    let url = graph_url(&page.page_id, "feed", &params)?;
    let data = post_query(state, url, "Facebook API error creating feed post").await?;
    Ok(field(&data, "id").unwrap_or_default())
}

async fn publish_story(
    state: &AppState,
    post: &Post,
    page: &SocialPage,
    media: &Media,
) -> anyhow::Result<String> {
    if media.media_type == MediaType::Video {
        // L'ancien serveur passait l'URL publique de la vidéo (en-tête `file_url`)
        // et Facebook devait venir la télécharger : sans APP_URL joignable depuis
        // Internet (ex. http://localhost:5555), la story échouait alors que le
        // Reel, envoyé en binaire, passait. On envoie donc aussi la vidéo en binaire.
        let video = media_store::read_media_buffer(state, &media.original_url).await?;
        return publish_video_story_from_buffer(state, page, video).await;
    }

    let mut photo = get_media_buffer(state, &media.original_url).await?;
    let mut file_name = basename(&media.original_url);

    if !post.content.trim().is_empty() {
        let story_name = format!("story-{}.png", media.id);
        match story_image::render_story_image(state, photo.clone(), &post.content).await {
            Ok(with_text) => {
                if let Err(error) =
                    media_store::upload_story_image(state, &with_text, &story_name).await
                {
                    tracing::warn!("Impossible d'archiver l'image de story : {error:#}");
                }
                photo = Bytes::from(with_text);
                file_name = story_name;
                tracing::info!("Story image with text generated locally");
            }
            Err(error) => {
                tracing::error!(
                    "Error generating story image with text, using original: {error:#}"
                );
            }
        }
    }

    // 1. Photo envoyée non publiée (obligatoire pour une story)
    let mime = image_mime(&file_name);
    let form = Form::new()
        .text("access_token", page.access_token.clone())
        .text("published", "false")
        .part("source", file_part(photo, file_name, mime)?);
    let url = graph_url(&page.page_id, "photos", &[])?;
    let upload = post_form(
        state,
        url,
        form,
        "Facebook API error uploading photo for story",
    )
    .await?;
    let photo_id = field(&upload, "id").unwrap_or_default();

    // 2. Publication de la photo en story
    let url = graph_url(
        &page.page_id,
        "photo_stories",
        &[
            ("access_token", &page.access_token),
            ("photo_id", &photo_id),
        ],
    )?;
    let story = post_query(state, url, "Facebook API error publishing story").await?;
    Ok(field(&story, "post_id").unwrap_or(photo_id))
}

/// Démarre un envoi en plusieurs phases (`/video_stories` ou `/video_reels`) ;
/// renvoie `(video_id, upload_url)`.
fn parse_start(data: &Value) -> Option<(String, String)> {
    Some((field(data, "video_id")?, field(data, "upload_url")?))
}

/// Envoie la vidéo en binaire vers l'`upload_url` (rupload.facebook.com).
async fn upload_binary(
    state: &AppState,
    upload_url: &str,
    access_token: &str,
    video: Bytes,
) -> Result<(), String> {
    let file_size = video.len();
    let response = state
        .http
        .post(upload_url)
        .header("Authorization", format!("OAuth {access_token}"))
        .header("Content-Type", "application/octet-stream")
        .header("offset", "0")
        .header("file_size", file_size.to_string())
        .body(video)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let ok = response.status().is_success();
    let text = response.text().await.unwrap_or_default();
    // rupload répond `{ "success": true }`
    let refused = serde_json::from_str::<Value>(&text)
        .ok()
        .is_some_and(|v| v.get("success") == Some(&Value::Bool(false)) || v.get("error").is_some());
    if !ok || refused {
        return Err(text);
    }
    Ok(())
}

/// Publie une vidéo en story Facebook en envoyant directement les données
/// binaires (start → upload → finish sur /video_stories) ; renvoie
/// l'identifiant de la story.
pub async fn publish_video_story_from_buffer(
    state: &AppState,
    page: &SocialPage,
    video: Bytes,
) -> anyhow::Result<String> {
    let access_token = require_token(page)?.to_string();

    // Phase 1 : START
    let url = graph_url(
        &page.page_id,
        "video_stories",
        &[("access_token", &access_token), ("upload_phase", "start")],
    )?;
    let start = post_query(state, url, "Facebook Story API error (START phase)").await?;
    let Some((video_id, upload_url)) = parse_start(&start) else {
        bail!("Facebook Story API error (START phase): réponse inattendue {start}");
    };

    // Phase 2 : UPLOAD
    if let Err(text) = upload_binary(state, &upload_url, &access_token, video).await {
        bail!("Facebook Story API error (UPLOAD phase): {text}");
    }

    // Phase 3 : FINISH
    let url = graph_url(
        &page.page_id,
        "video_stories",
        &[
            ("access_token", &access_token),
            ("upload_phase", "finish"),
            ("video_id", &video_id),
        ],
    )?;
    let response = state.http.post(url).send().await?;
    let status = response.status();
    let raw = response.text().await.unwrap_or_default();
    let finish: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
    if !status.is_success() || finish.get("error").is_some() {
        bail!(format_api_error(
            "Facebook Story API error (FINISH phase)",
            status.as_u16(),
            &raw
        ));
    }
    if finish.get("success") == Some(&Value::Bool(false)) {
        bail!("Facebook Story API error (FINISH phase): {raw}");
    }

    // La story n'apparaît qu'une fois la vidéo traitée : on suit son statut
    // pour remonter une éventuelle erreur de traitement à l'utilisateur.
    wait_for_video_story(state, &video_id, &access_token).await?;

    tracing::info!("✅ Story vidéo publiée sur {}", page.page_name);
    Ok(field(&finish, "post_id").unwrap_or(video_id))
}

/// État du traitement d'une vidéo (`GET /{video-id}?fields=status`).
#[derive(Debug, PartialEq, Eq)]
enum VideoProcessing {
    Done,
    Pending,
    Failed(String),
}

fn video_processing_state(data: &Value) -> VideoProcessing {
    let status = &data["status"];
    let phase_errors = |name: &str| -> Option<String> {
        let phase = &status[name];
        if phase["status"].as_str() != Some("error") {
            return None;
        }
        let messages: Vec<String> = phase["errors"]
            .as_array()
            .map(|errors| {
                errors
                    .iter()
                    .filter_map(|e| e["message"].as_str())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        Some(if messages.is_empty() {
            format!("échec de la phase {name}")
        } else {
            messages.join(" ; ")
        })
    };

    for phase in ["uploading_phase", "processing_phase", "publishing_phase"] {
        if let Some(message) = phase_errors(phase) {
            return VideoProcessing::Failed(message);
        }
    }
    match status["video_status"].as_str() {
        Some("error") => VideoProcessing::Failed("traitement de la vidéo en erreur".to_string()),
        Some("ready") => VideoProcessing::Done,
        _ if status["publishing_phase"]["status"].as_str() == Some("complete") => {
            VideoProcessing::Done
        }
        _ => VideoProcessing::Pending,
    }
}

/// Attend la fin du traitement d'une story vidéo (au plus une minute). Une
/// erreur signalée par Facebook fait échouer la publication ; un statut
/// illisible ou un traitement encore en cours ne bloque pas.
async fn wait_for_video_story(
    state: &AppState,
    video_id: &str,
    access_token: &str,
) -> anyhow::Result<()> {
    for attempt in 0..STORY_STATUS_ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(STORY_STATUS_INTERVAL).await;
        }
        let mut url = url::Url::parse(&format!("{BASE_URL}/{video_id}"))?;
        url.query_pairs_mut()
            .append_pair("fields", "status")
            .append_pair("access_token", access_token);
        let data: Value = match state.http.get(url).send().await {
            Ok(response) => match response.json().await {
                Ok(data) => data,
                Err(error) => {
                    tracing::warn!("Statut de la story vidéo {video_id} illisible : {error}");
                    return Ok(());
                }
            },
            Err(error) => {
                tracing::warn!("Statut de la story vidéo {video_id} indisponible : {error}");
                return Ok(());
            }
        };
        if data.get("error").is_some() {
            tracing::warn!("Statut de la story vidéo {video_id} indisponible : {data}");
            return Ok(());
        }
        match video_processing_state(&data) {
            VideoProcessing::Done => return Ok(()),
            VideoProcessing::Failed(message) => {
                bail!("Facebook Story API error (traitement de la vidéo) : {message}")
            }
            VideoProcessing::Pending => {}
        }
    }
    tracing::warn!("Story vidéo {video_id} toujours en traitement chez Facebook, publication supposée en cours");
    Ok(())
}

/// Publie une vidéo comme Reel Facebook via l'API Reels (start → upload →
/// finish sur /video_reels) ; renvoie l'identifiant du Reel.
///
/// Spécifications vidéo requises pour les Reels : MP4 H.264, 9:16, 3 à 90 s,
/// 1080×1920 recommandé.
pub async fn publish_video_from_buffer(
    state: &AppState,
    page: &SocialPage,
    video: Bytes,
    description: &str,
) -> anyhow::Result<String> {
    let access_token = require_token(page)?.to_string();
    let file_size = video.len();

    tracing::info!(
        "🎬 Publishing video as Facebook Reel via /video_reels endpoint: page {} ({}), {:.2} MB",
        page.page_id,
        page.page_name,
        file_size as f64 / 1024.0 / 1024.0
    );

    // Phase 1 : START
    let url = graph_url(
        &page.page_id,
        "video_reels",
        &[("access_token", &access_token), ("upload_phase", "start")],
    )?;
    let response = state.http.post(url).send().await?;
    let ok = response.status().is_success();
    let start_raw = response.text().await.unwrap_or_default();
    tracing::info!("📤 Facebook Reel START response: {start_raw}");
    let start: Value = serde_json::from_str(&start_raw).unwrap_or(Value::Null);

    if !ok || start.get("error").is_some() {
        let error = start.get("error");
        let subcode = error.and_then(|e| e.get("error_subcode"));
        let code = error.and_then(|e| e.get("code"));
        if subcode.and_then(Value::as_i64) == Some(1_363_042) {
            bail!(
                "Le token Facebook de la page \"{}\" n'a pas la permission \"publish_video\". \
                 Régénérez le token dans Graph API Explorer en ajoutant les permissions : \
                 pages_manage_posts, pages_read_engagement, publish_video. (code: {}, subcode: {})",
                page.page_name,
                js(code),
                js(subcode)
            );
        }
        let message = error
            .and_then(|e| e.get("message"))
            .filter(|m| !m.is_null())
            .map(|m| js(Some(m)))
            .unwrap_or_else(|| start_raw.clone());
        bail!(
            "Facebook Reel START error: {message} (code: {}, subcode: {})",
            js(code),
            js(subcode)
        );
    }

    let Some((video_id, upload_url)) = parse_start(&start) else {
        bail!("Facebook Reel START error: {start_raw} (code: undefined, subcode: undefined)");
    };
    tracing::info!("📤 Reel upload initialized: video_id={video_id}, upload_url={upload_url}");

    // Phase 2 : UPLOAD
    if let Err(text) = upload_binary(state, &upload_url, &access_token, video).await {
        bail!("Facebook Reel UPLOAD error: {text}");
    }
    tracing::info!("📤 Reel video data uploaded successfully ({file_size} bytes)");

    // Phase 3 : FINISH
    let mut params: Vec<(&str, &str)> = vec![
        ("access_token", &access_token),
        ("upload_phase", "finish"),
        ("video_id", &video_id),
        ("video_state", "PUBLISHED"),
    ];
    if !description.is_empty() {
        params.push(("description", description));
    }
    let url = graph_url(&page.page_id, "video_reels", &params)?;
    let response = state.http.post(url).send().await?;
    let ok = response.status().is_success();
    let finish_raw = response.text().await.unwrap_or_default();
    tracing::info!("📤 Facebook Reel FINISH response: {finish_raw}");
    let finish: Value = serde_json::from_str(&finish_raw).unwrap_or(Value::Null);

    if !ok || finish.get("error").is_some() {
        let error = finish.get("error");
        let message = error
            .and_then(|e| e.get("message"))
            .filter(|m| !m.is_null())
            .map(|m| js(Some(m)))
            .unwrap_or_else(|| finish_raw.clone());
        bail!(
            "Facebook Reel FINISH error: {message} (code: {})",
            js(error.and_then(|e| e.get("code")))
        );
    }

    let post_id = field(&finish, "post_id").unwrap_or(video_id);
    tracing::info!("✅ Reel published successfully! ID: {post_id}");
    Ok(post_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn graph_urls_are_built_like_url_search_params() {
        let url = graph_url(
            "123",
            "feed",
            &[("access_token", "T"), ("message", "Été & promo !")],
        )
        .unwrap();
        assert_eq!(
            url.as_str(),
            "https://graph.facebook.com/v23.0/123/feed?access_token=T&message=%C3%89t%C3%A9+%26+promo+%21"
        );
        let attached = graph_url(
            "1",
            "feed",
            &[("attached_media[0]", r#"{"media_fbid":"9"}"#)],
        )
        .unwrap();
        assert_eq!(
            attached.query(),
            Some("attached_media%5B0%5D=%7B%22media_fbid%22%3A%229%22%7D")
        );
    }

    #[test]
    fn api_errors_are_formatted_like_the_old_server() {
        let body = r#"{"error":{"message":"Invalid OAuth access token.","type":"OAuthException","code":190}}"#;
        assert_eq!(
            format_api_error("Facebook API error", 400, body),
            "Facebook API error: Invalid OAuth access token. (code: 190)"
        );
        assert_eq!(
            format_api_error("Facebook API error", 400, r#"{"error":{"message":"x"}}"#),
            "Facebook API error: x (code: undefined)"
        );
        assert_eq!(
            format_api_error("Facebook API error", 502, "<html>Bad gateway</html>"),
            "Facebook API error: HTTP 502 <html>Bad gateway</html>"
        );
    }

    #[test]
    fn cloudinary_videos_are_transcoded() {
        assert_eq!(
            facebook_compatible_video_url(
                "https://res.cloudinary.com/demo/video/upload/v1/clip.mov"
            ),
            "https://res.cloudinary.com/demo/video/upload/vc_h264,ac_aac,f_mp4,q_auto/v1/clip.mov"
        );
        assert_eq!(
            facebook_compatible_video_url("https://app.fr/uploads/media/a.mp4"),
            "https://app.fr/uploads/media/a.mp4"
        );
    }

    #[test]
    fn helpers() {
        assert_eq!(basename("/uploads/media/123-photo.PNG"), "123-photo.PNG");
        assert_eq!(image_mime("photo.PNG"), "image/png");
        assert_eq!(image_mime("photo.jpg"), "image/jpeg");
        assert_eq!(field(&json!({ "id": 12 }), "id").as_deref(), Some("12"));
        assert_eq!(field(&json!({ "post_id": "" }), "post_id"), None);
        assert_eq!(js(None), "undefined");
        assert_eq!(js(Some(&json!(190))), "190");
    }

    #[test]
    fn video_story_processing_states() {
        let ready = json!({ "status": { "video_status": "ready" } });
        assert_eq!(video_processing_state(&ready), VideoProcessing::Done);

        let published = json!({ "status": { "video_status": "processing",
            "publishing_phase": { "status": "complete" } } });
        assert_eq!(video_processing_state(&published), VideoProcessing::Done);

        let pending = json!({ "status": { "video_status": "processing",
            "processing_phase": { "status": "in_progress" } } });
        assert_eq!(video_processing_state(&pending), VideoProcessing::Pending);

        let failed = json!({ "status": { "video_status": "error",
            "processing_phase": { "status": "error", "errors": [{ "code": 1, "message": "Format non pris en charge" }] } } });
        assert_eq!(
            video_processing_state(&failed),
            VideoProcessing::Failed("Format non pris en charge".to_string())
        );

        let bare_error = json!({ "status": { "video_status": "error" } });
        assert!(matches!(
            video_processing_state(&bare_error),
            VideoProcessing::Failed(_)
        ));
    }

    /// Appels réels à l'API Graph avec un jeton bidon : vérifie les messages
    /// d'erreur remontés à l'utilisateur.
    /// `cargo test graph_errors_with_fake_token -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn graph_errors_with_fake_token() {
        let config = crate::config::Config {
            port: 0,
            database_url: String::new(),
            session_secret: "x".into(),
            production: false,
            app_url: None,
            internal_app_url: None,
            static_dir: ".".into(),
            public_root_dir: ".".into(),
            uploads_dir: std::env::temp_dir(),
            audio_upload_dir: std::env::temp_dir(),
            temp_upload_dir: std::env::temp_dir(),
            fonts_dir: ".".into(),
            gemini_api_key: None,
            external_api_key: None,
            reel_renderer: "ffmpeg".into(),
            remotion_url: None,
            ffmpeg_api_url: None,
            ffmpeg_api_key: None,
        };
        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://localhost/none")
            .unwrap();
        let state = AppState::new(config, pool).unwrap();
        let page = SocialPage {
            id: "p".into(),
            user_id: "u".into(),
            platform: Platform::Facebook,
            page_id: "1234567890".into(),
            page_name: "Test".into(),
            access_token: "fake-token".into(),
            token_expires_at: None,
            followers_count: None,
            is_active: "true".into(),
            token_status: None,
            last_token_check: None,
            user_access_token: None,
            user_token_expires_at: None,
            token_error: None,
            refresh_token: None,
            refresh_token_expires_at: None,
            scopes: None,
            avatar_url: None,
            created_at: None,
        };
        let post = Post {
            id: "post".into(),
            user_id: "u".into(),
            content: "Bonjour".into(),
            ai_generated: "false".into(),
            product_info: None,
            status: crate::db::PostStatus::Scheduled,
            scheduled_for: None,
            generation_status: None,
            generation_progress: None,
            generation_error: None,
            created_at: None,
            updated_at: None,
        };

        let text = publish_post(&state, &post, &page, PostType::Feed, &[])
            .await
            .unwrap_err();
        println!("texte : {text}");
        assert!(text.to_string().starts_with("Facebook API error: "));
        assert!(text.to_string().contains("(code: 190)"));

        let story = publish_video_story_from_buffer(&state, &page, Bytes::from_static(b"x"))
            .await
            .unwrap_err();
        println!("story vidéo : {story}");
        assert!(story
            .to_string()
            .starts_with("Facebook Story API error (START phase): "));

        let reel = publish_video_from_buffer(&state, &page, Bytes::from_static(b"x"), "d")
            .await
            .unwrap_err();
        println!("reel : {reel}");
        assert!(reel.to_string().starts_with("Facebook Reel START error: "));

        // Story photo : image locale, texte incrusté puis envoi refusé
        let photo = image::RgbImage::from_pixel(800, 600, image::Rgb([200, 80, 40]));
        let name = format!("story-test-{}.jpg", std::process::id());
        photo.save(std::env::temp_dir().join(&name)).unwrap();
        let media = Media {
            id: "m1".into(),
            user_id: "u".into(),
            media_type: MediaType::Image,
            cloudinary_public_id: None,
            original_url: format!("/uploads/{name}"),
            facebook_landscape_url: None,
            facebook_feed_url: None,
            instagram_feed_url: None,
            instagram_story_url: None,
            thumbnail_url: None,
            file_name: name.clone(),
            file_size: 0,
            created_at: None,
        };
        let story = publish_post(&state, &post, &page, PostType::Story, &[media])
            .await
            .unwrap_err();
        println!("story photo : {story}");
        assert!(story
            .to_string()
            .starts_with("Facebook API error uploading photo for story: "));
        let _ = std::fs::remove_file(std::env::temp_dir().join(&name));
    }
}
