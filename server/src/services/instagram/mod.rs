//! Publication Instagram (API Graph, compte professionnel rattaché à une page
//! Facebook, jeton de la page).
//!
//! Instagram publie en deux temps : un conteneur est créé (`/{ig}/media`), Meta
//! le traite, puis il est publié (`/{ig}/media_publish`). Les vidéos sont
//! envoyées en binaire (resumable upload) ; si Meta refuse cet envoi, elles
//! sont redonnées par URL publique, comme les images, qu'Instagram ne prend
//! que par URL publique et en JPEG : converties puis servies par Socialflow
//! sous `/uploads/instagram/` (d'où le besoin d'`APP_URL`).

use std::fmt;
use std::future::Future;
use std::io::Cursor;
use std::time::Duration;

use anyhow::anyhow;
use serde_json::Value;
use tokio::time::Instant;

use crate::db::{Media, MediaType, Platform, Post, PostType, SocialPage};
use crate::services::facebook::{self, story_image};
use crate::services::{media_store, scheduler};
use crate::state::AppState;

const RUPLOAD: &str = "https://rupload.facebook.com/ig-api-upload/v23.0";

/// Attente maximale du traitement des conteneurs d'une publication.
const PROCESSING_BUDGET: Duration = Duration::from_secs(180);
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(3);
const CHECK_INTERVAL: Duration = Duration::from_secs(10);

/// Délais par appel : le client HTTP partagé n'a qu'un délai de connexion.
const CALL_TIMEOUT: Duration = Duration::from_secs(60);
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(600);

/// Nombre maximal de médias d'un carrousel Instagram.
const MAX_CAROUSEL_ITEMS: usize = 10;

const PREFIX_CREATE: &str = "Instagram API error creating container";
const PREFIX_CHECK: &str = "Instagram API error checking container";
const PREFIX_PUBLISH: &str = "Instagram API error publishing";
const PREFIX_UPLOAD: &str = "Instagram upload error";

// ----------------------------------------------------------------------
// Erreurs
// ----------------------------------------------------------------------

/// Erreur qu'une nouvelle tentative ne résoudrait pas (média refusé,
/// configuration manquante…) : le planificateur ne réessaie pas.
#[derive(Debug)]
pub struct PermanentError(pub String);

impl fmt::Display for PermanentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for PermanentError {}

pub fn permanent(message: impl Into<String>) -> anyhow::Error {
    anyhow::Error::new(PermanentError(message.into()))
}

pub fn is_permanent(error: &anyhow::Error) -> bool {
    error.downcast_ref::<PermanentError>().is_some()
}

async fn timed<T>(
    limit: Duration,
    call: impl Future<Output = anyhow::Result<T>>,
) -> anyhow::Result<T> {
    match tokio::time::timeout(limit, call).await {
        Ok(result) => result,
        Err(_) => Err(anyhow!(
            "Instagram : pas de réponse de Meta (délai de {} s dépassé)",
            limit.as_secs()
        )),
    }
}

// ----------------------------------------------------------------------
// Règles pures (testées)
// ----------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeedKind {
    Empty,
    Image,
    Video,
    Carousel,
    TooMany,
}

/// Forme d'une publication de fil selon ses médias.
pub fn feed_kind(images: usize, videos: usize) -> FeedKind {
    match (images, videos) {
        (0, 0) => FeedKind::Empty,
        _ if images + videos > MAX_CAROUSEL_ITEMS => FeedKind::TooMany,
        (1, 0) => FeedKind::Image,
        (0, 1) => FeedKind::Video,
        _ => FeedKind::Carousel,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContainerState {
    Ready,
    Failed,
    Expired,
    Pending,
}

/// État d'un conteneur d'après son `status_code`.
pub fn container_state(status_code: &str) -> ContainerState {
    match status_code {
        "FINISHED" => ContainerState::Ready,
        "ERROR" => ContainerState::Failed,
        "EXPIRED" => ContainerState::Expired,
        _ => ContainerState::Pending,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageKind {
    /// Image seule ou élément de carrousel : ratio imposé entre 4:5 et 1.91:1.
    Feed,
    /// Story : pas de recadrage.
    Story,
}

impl ImageKind {
    fn suffix(self) -> &'static str {
        match self {
            ImageKind::Feed => "feed",
            ImageKind::Story => "story",
        }
    }
}

/// Zone (x, y, largeur, hauteur) à garder pour respecter les ratios du fil
/// Instagram (4:5 à 1.91:1), centrée.
pub fn crop_box(width: u32, height: u32) -> (u32, u32, u32, u32) {
    if width == 0 || height == 0 {
        return (0, 0, width, height);
    }
    let ratio = width as f64 / height as f64;
    if ratio < 0.8 {
        let h = ((width as f64 / 0.8).round() as u32).min(height);
        (0, (height - h) / 2, width, h)
    } else if ratio > 1.91 {
        let w = ((height as f64 * 1.91).round() as u32).min(width);
        ((width - w) / 2, 0, w, height)
    } else {
        (0, 0, width, height)
    }
}

/// Image convertie en JPEG (et recadrée pour le fil).
pub fn prepare_jpeg(bytes: &[u8], kind: ImageKind) -> anyhow::Result<Vec<u8>> {
    let image = story_image::decode_oriented(bytes)
        .map_err(|error| permanent(format!("Image illisible pour Instagram : {error}")))?;
    let image = match kind {
        ImageKind::Feed => {
            let (x, y, w, h) = crop_box(image.width(), image.height());
            image.crop_imm(x, y, w, h)
        }
        ImageKind::Story => image,
    };
    let rgb = image.to_rgb8();
    let mut out = Cursor::new(Vec::new());
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 90).encode_image(&rgb)?;
    Ok(out.into_inner())
}

/// URL publique d'une image préparée : Instagram vient la télécharger.
pub fn public_image_url(app_url: Option<&str>, path: &str) -> anyhow::Result<String> {
    match app_url.map(str::trim) {
        Some(base) if base.starts_with("https://") => {
            Ok(format!("{}{path}", base.trim_end_matches('/')))
        }
        _ => Err(permanent(
            "Instagram télécharge les images depuis Socialflow : définissez APP_URL \
             (adresse publique https, la même que l'URI de redirection déclarée chez Meta) dans la stack.",
        )),
    }
}

/// URL publique d'une vidéo, pour le repli par `video_url` : `https://…` tel
/// quel, `/…` (fichier local) préfixé d'`APP_URL` en https ; sinon aucune
/// (Meta ne télécharge que depuis une adresse publique). Pas de
/// `media_store::resolve_public_url` : il se replie sur `http://localhost:5555`.
pub fn public_video_url(app_url: Option<&str>, original_url: &str) -> Option<String> {
    if original_url.starts_with("https://") {
        return Some(original_url.to_string());
    }
    if !original_url.starts_with('/') {
        return None;
    }
    match app_url.map(str::trim) {
        Some(base) if base.starts_with("https://") => {
            Some(format!("{}{original_url}", base.trim_end_matches('/')))
        }
        _ => None,
    }
}

/// Suffixe de [`fallback_error`] quand aucune URL publique n'est disponible.
const FALLBACK_NO_URL: &str = " impossible : APP_URL doit être une adresse https publique";

/// Échec de l'envoi binaire puis du repli par URL : jamais définitif, car le
/// refus de l'envoi binaire est aléatoire et peut passer à l'essai suivant.
pub fn fallback_error(binary: &str, fallback: &str) -> anyhow::Error {
    anyhow!("{binary} ; repli par URL{fallback}")
}

fn upload_error_message(body: &str) -> String {
    let is_graph_error = serde_json::from_str::<Value>(body)
        .ok()
        .is_some_and(|v| v.get("error").is_some_and(Value::is_object));
    if is_graph_error {
        facebook::format_api_error(PREFIX_UPLOAD, 400, body)
    } else {
        let excerpt: String = body.chars().take(500).collect();
        format!("{PREFIX_UPLOAD}: {excerpt}").trim_end().to_string()
    }
}

// ----------------------------------------------------------------------
// Publication
// ----------------------------------------------------------------------

/// Échéance commune à toutes les attentes d'une publication.
struct Deadline(Instant);

impl Deadline {
    fn start() -> Self {
        Self(Instant::now() + PROCESSING_BUDGET)
    }

    fn remaining(&self) -> Duration {
        self.0.saturating_duration_since(Instant::now())
    }
}

struct Account<'a> {
    ig_id: &'a str,
    token: &'a str,
}

/// Publie un post sur un compte Instagram ; renvoie l'identifiant de la
/// publication (stories : identifiants séparés par « , »).
pub async fn publish_post(
    state: &AppState,
    post: &Post,
    page: &SocialPage,
    post_type: PostType,
    media: &[Media],
) -> anyhow::Result<String> {
    if page.platform != Platform::Instagram {
        return Err(permanent("Ce compte n'est pas un compte Instagram"));
    }
    if page.access_token.trim().is_empty() {
        return Err(permanent(format!(
            "Le compte Instagram \"{}\" n'a pas de jeton : reconnectez « Facebook & Instagram ».",
            page.page_name
        )));
    }
    let account = Account {
        ig_id: &page.page_id,
        token: &page.access_token,
    };
    let caption = post.content.as_str();

    match post_type {
        PostType::Both => Err(permanent(
            "Le type « feed + story » doit être scindé à la création de la publication.",
        )),
        PostType::Story => publish_stories(state, &account, media).await,
        PostType::Reel => {
            let Some(video) = media.iter().find(|m| m.media_type == MediaType::Video) else {
                return Err(permanent("Les reels nécessitent une vidéo"));
            };
            publish_reel(state, &account, video, caption).await
        }
        PostType::Feed => {
            let images = media
                .iter()
                .filter(|m| m.media_type == MediaType::Image)
                .count();
            let videos = media
                .iter()
                .filter(|m| m.media_type == MediaType::Video)
                .count();
            match feed_kind(images, videos) {
                FeedKind::Empty => Err(permanent(
                    "Instagram n'accepte pas les publications sans photo ni vidéo",
                )),
                FeedKind::TooMany => Err(permanent("10 médias maximum sur Instagram")),
                FeedKind::Image => {
                    let image = &media[0];
                    let id = create_image_container(
                        state,
                        &account,
                        image,
                        ImageKind::Feed,
                        &[("caption", caption)],
                    )
                    .await?;
                    let deadline = Deadline::start();
                    wait_all(state, &account, std::slice::from_ref(&id), &[], &deadline).await?;
                    media_publish(state, &account, &id).await
                }
                FeedKind::Video => {
                    let video = media
                        .iter()
                        .find(|m| m.media_type == MediaType::Video)
                        .expect("feed_kind a compté une vidéo");
                    publish_reel(state, &account, video, caption).await
                }
                FeedKind::Carousel => publish_carousel(state, &account, media, caption).await,
            }
        }
    }
}

async fn publish_reel(
    state: &AppState,
    account: &Account<'_>,
    video: &Media,
    caption: &str,
) -> anyhow::Result<String> {
    let container = create_video_container(
        state,
        account,
        &[("media_type", "REELS"), ("caption", caption)],
        video,
    )
    .await?;
    let id = container.id.clone();
    let deadline = Deadline::start();
    wait_all(
        state,
        account,
        std::slice::from_ref(&id),
        &container.retryable(),
        &deadline,
    )
    .await?;
    media_publish(state, account, &id).await
}

/// Stories : tous les conteneurs sont préparés avant la première
/// publication, pour qu'un échec de préparation ne publie rien.
async fn publish_stories(
    state: &AppState,
    account: &Account<'_>,
    media: &[Media],
) -> anyhow::Result<String> {
    if media.is_empty() {
        return Err(permanent("Les stories nécessitent un média"));
    }
    let mut containers = Vec::with_capacity(media.len());
    let mut retryable = Vec::new();
    for item in media {
        let id = if item.media_type == MediaType::Video {
            let container =
                create_video_container(state, account, &[("media_type", "STORIES")], item).await?;
            retryable.extend(container.retryable());
            container.id
        } else {
            create_image_container(
                state,
                account,
                item,
                ImageKind::Story,
                &[("media_type", "STORIES")],
            )
            .await?
        };
        containers.push(id);
    }

    let deadline = Deadline::start();
    wait_all(state, account, &containers, &retryable, &deadline).await?;

    let mut published: Vec<String> = Vec::with_capacity(containers.len());
    for (index, container) in containers.iter().enumerate() {
        match media_publish(state, account, container).await {
            Ok(id) => published.push(id),
            Err(error) if published.is_empty() => return Err(error),
            // Une nouvelle tentative republierait les premières stories
            Err(error) => {
                return Err(permanent(format!(
                    "Stories publiées : {} ; échec à partir de la story {} : {error}",
                    published.join(","),
                    index + 1
                )))
            }
        }
    }
    Ok(published.join(","))
}

async fn publish_carousel(
    state: &AppState,
    account: &Account<'_>,
    media: &[Media],
    caption: &str,
) -> anyhow::Result<String> {
    let mut children = Vec::with_capacity(media.len());
    let mut retryable = Vec::new();
    for item in media {
        let id = if item.media_type == MediaType::Video {
            let container = create_video_container(
                state,
                account,
                &[("media_type", "VIDEO"), ("is_carousel_item", "true")],
                item,
            )
            .await?;
            retryable.extend(container.retryable());
            container.id
        } else {
            create_image_container(
                state,
                account,
                item,
                ImageKind::Feed,
                &[("is_carousel_item", "true")],
            )
            .await?
        };
        children.push(id);
    }

    let deadline = Deadline::start();
    wait_all(state, account, &children, &retryable, &deadline).await?;

    let children_list = children.join(",");
    let carousel = create_container(
        state,
        account,
        &[
            ("media_type", "CAROUSEL"),
            ("children", children_list.as_str()),
            ("caption", caption),
        ],
    )
    .await?;
    wait_all(
        state,
        account,
        std::slice::from_ref(&carousel),
        &[],
        &deadline,
    )
    .await?;
    media_publish(state, account, &carousel).await
}

/// `POST /{ig}/media` ; renvoie l'identifiant du conteneur.
async fn create_container(
    state: &AppState,
    account: &Account<'_>,
    params: &[(&str, &str)],
) -> anyhow::Result<String> {
    let mut all: Vec<(&str, &str)> = params.to_vec();
    all.push(("access_token", account.token));
    let url = facebook::graph_url(account.ig_id, "media", &all)?;
    let data = timed(
        CALL_TIMEOUT,
        facebook::post_query(state, url, PREFIX_CREATE),
    )
    .await?;
    facebook::field(&data, "id")
        .ok_or_else(|| anyhow!("{PREFIX_CREATE}: réponse sans identifiant ({data})"))
}

/// Conteneur vidéo prêt à être attendu puis publié.
struct VideoContainer {
    id: String,
    /// Créé par le repli `video_url` : un refus de Meta peut venir d'un
    /// téléchargement raté, il n'est donc pas définitif.
    via_url: bool,
}

impl VideoContainer {
    /// Identifiants dont l'état `ERROR` reste à retenter (pour `wait_all`).
    fn retryable(&self) -> Vec<String> {
        if self.via_url {
            vec![self.id.clone()]
        } else {
            Vec::new()
        }
    }
}

/// Vidéo envoyée en binaire ; si Meta refuse l'envoi (hors limite de débit),
/// nouveau conteneur par `video_url`, que Meta télécharge lui-même.
async fn create_video_container(
    state: &AppState,
    account: &Account<'_>,
    params: &[(&str, &str)],
    video: &Media,
) -> anyhow::Result<VideoContainer> {
    let buffer = media_store::read_media_buffer(state, &video.original_url).await?;
    let mut all: Vec<(&str, &str)> = params.to_vec();
    all.push(("upload_type", "resumable"));
    let id = create_container(state, account, &all).await?;

    let upload_url = format!("{RUPLOAD}/{id}");
    let upload = async {
        facebook::upload_binary(state, &upload_url, account.token, buffer)
            .await
            .map_err(|body| anyhow!(upload_error_message(&body)))
    };
    let binary_error = match timed(UPLOAD_TIMEOUT, upload).await {
        Ok(()) => return Ok(VideoContainer { id, via_url: false }),
        Err(error) => error,
    };
    let binary = format!("{binary_error:#}");
    if scheduler::is_rate_limited(&binary) {
        return Err(binary_error);
    }

    tracing::warn!(
        "📷 [Instagram] Envoi binaire refusé (conteneur {id}) : {binary} — repli par URL"
    );
    let Some(video_url) = public_video_url(state.config.app_url.as_deref(), &video.original_url)
    else {
        return Err(fallback_error(&binary, FALLBACK_NO_URL));
    };
    let mut all: Vec<(&str, &str)> = params.to_vec();
    all.push(("video_url", video_url.as_str()));
    match create_container(state, account, &all).await {
        Ok(url_id) => {
            tracing::info!("📷 [Instagram] Repli par URL : conteneur {url_id} créé ({video_url})");
            Ok(VideoContainer {
                id: url_id,
                via_url: true,
            })
        }
        Err(url_error) => {
            let message = format!("{url_error:#}");
            // Le planificateur ne lit que le premier « (code: N) » du message
            if scheduler::is_rate_limited(&message) {
                Err(url_error)
            } else {
                Err(fallback_error(&binary, &format!(" : {message}")))
            }
        }
    }
}

async fn create_image_container(
    state: &AppState,
    account: &Account<'_>,
    media: &Media,
    kind: ImageKind,
    params: &[(&str, &str)],
) -> anyhow::Result<String> {
    // Vérifiée avant tout travail : sans URL publique, rien ne peut aboutir
    public_image_url(state.config.app_url.as_deref(), "")?;

    let original = media_store::read_media_buffer(state, &media.original_url).await?;
    let jpeg = tokio::task::spawn_blocking(move || prepare_jpeg(&original, kind)).await??;
    let file_name = format!("{}-{}.jpg", media.id, kind.suffix());
    let path = media_store::upload_instagram_image(state, &jpeg, &file_name).await?;
    let image_url = public_image_url(state.config.app_url.as_deref(), &path)?;

    let mut all: Vec<(&str, &str)> = params.to_vec();
    all.push(("image_url", image_url.as_str()));
    create_container(state, account, &all).await
}

/// Attend que chaque conteneur soit prêt, dans la limite de l'échéance commune.
async fn wait_all(
    state: &AppState,
    account: &Account<'_>,
    ids: &[String],
    retryable: &[String],
    deadline: &Deadline,
) -> anyhow::Result<()> {
    tokio::time::sleep(FIRST_CHECK_DELAY.min(deadline.remaining())).await;
    for id in ids {
        loop {
            let data = timed(CALL_TIMEOUT, container_status(state, account, id)).await?;
            let status_code = data
                .get("status_code")
                .and_then(Value::as_str)
                .unwrap_or("");
            match container_state(status_code) {
                ContainerState::Ready => break,
                ContainerState::Failed => {
                    let detail = facebook::field(&data, "status").unwrap_or_default();
                    if retryable.contains(id) {
                        anyhow::bail!("Instagram a refusé le média (repli par URL) : {detail}");
                    }
                    return Err(permanent(format!("Instagram a refusé le média : {detail}")));
                }
                ContainerState::Expired => {
                    anyhow::bail!("Instagram : conteneur {id} expiré avant publication")
                }
                ContainerState::Pending => {
                    let remaining = deadline.remaining();
                    if remaining.is_zero() {
                        anyhow::bail!(
                            "Instagram : traitement trop long (plus de {} min), nouvel essai plus tard",
                            PROCESSING_BUDGET.as_secs() / 60
                        );
                    }
                    tokio::time::sleep(CHECK_INTERVAL.min(remaining)).await;
                }
            }
        }
    }
    Ok(())
}

async fn container_status(
    state: &AppState,
    account: &Account<'_>,
    id: &str,
) -> anyhow::Result<Value> {
    let mut url = url::Url::parse(&format!("{}/{id}", facebook::BASE_URL))?;
    url.query_pairs_mut()
        .append_pair("fields", "status_code,status")
        .append_pair("access_token", account.token);
    let response = state.http.get(url).send().await?;
    if !response.status().is_success() {
        return Err(facebook::api_error(PREFIX_CHECK, response).await);
    }
    Ok(response.json().await?)
}

async fn media_publish(
    state: &AppState,
    account: &Account<'_>,
    container_id: &str,
) -> anyhow::Result<String> {
    let url = facebook::graph_url(
        account.ig_id,
        "media_publish",
        &[
            ("creation_id", container_id),
            ("access_token", account.token),
        ],
    )?;
    let data = timed(
        CALL_TIMEOUT,
        facebook::post_query(state, url, PREFIX_PUBLISH),
    )
    .await?;
    facebook::field(&data, "id")
        .ok_or_else(|| anyhow!("{PREFIX_PUBLISH}: réponse sans identifiant ({data})"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_video_url_needs_a_public_https_address() {
        assert_eq!(
            public_video_url(None, "https://cdn.example/x.mp4").as_deref(),
            Some("https://cdn.example/x.mp4")
        );
        assert_eq!(
            public_video_url(Some("https://app.fr/"), "/uploads/media/a.mp4").as_deref(),
            Some("https://app.fr/uploads/media/a.mp4")
        );
        assert_eq!(
            public_video_url(Some("https://app.fr"), "http://minio/x.mp4"),
            None
        );
        assert_eq!(public_video_url(Some("https://app.fr"), ""), None);
        assert_eq!(public_video_url(None, "/uploads/media/a.mp4"), None);
        assert_eq!(
            public_video_url(Some("http://localhost:5555"), "/uploads/media/a.mp4"),
            None
        );
    }

    #[test]
    fn fallback_errors_stay_retryable() {
        let no_url = fallback_error("Instagram upload error: boom", FALLBACK_NO_URL);
        assert_eq!(
            no_url.to_string(),
            "Instagram upload error: boom ; repli par URL impossible : APP_URL doit être une adresse https publique"
        );
        assert!(!is_permanent(&no_url));
        let refused = fallback_error("Instagram upload error: boom", " : refus");
        assert_eq!(
            refused.to_string(),
            "Instagram upload error: boom ; repli par URL : refus"
        );
        assert!(!is_permanent(&refused));
    }

    #[test]
    fn crop_box_keeps_instagram_ratios() {
        assert_eq!(crop_box(1000, 1000), (0, 0, 1000, 1000));
        assert_eq!(crop_box(1000, 2000), (0, 375, 1000, 1250));
        assert_eq!(crop_box(3000, 1000), (545, 0, 1910, 1000));
        assert_eq!(crop_box(800, 1000), (0, 0, 800, 1000));
    }

    #[test]
    fn prepare_jpeg_converts_and_rejects_garbage() {
        let png = {
            let image = image::RgbaImage::from_pixel(10, 10, image::Rgba([10, 20, 30, 128]));
            let mut out = Cursor::new(Vec::new());
            image.write_to(&mut out, image::ImageFormat::Png).unwrap();
            out.into_inner()
        };
        let jpeg = prepare_jpeg(&png, ImageKind::Feed).unwrap();
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8]);

        let error = prepare_jpeg(b"pas une image", ImageKind::Story).unwrap_err();
        assert!(is_permanent(&error));
    }

    #[test]
    fn public_image_url_requires_https_app_url() {
        assert!(is_permanent(&public_image_url(None, "/a.jpg").unwrap_err()));
        assert!(is_permanent(
            &public_image_url(Some(""), "/a.jpg").unwrap_err()
        ));
        assert!(is_permanent(
            &public_image_url(Some("http://x.fr"), "/a.jpg").unwrap_err()
        ));
        assert_eq!(
            public_image_url(Some("https://x.fr/"), "/uploads/instagram/a.jpg").unwrap(),
            "https://x.fr/uploads/instagram/a.jpg"
        );
    }

    #[test]
    fn feed_kind_follows_media_count() {
        assert_eq!(feed_kind(0, 0), FeedKind::Empty);
        assert_eq!(feed_kind(1, 0), FeedKind::Image);
        assert_eq!(feed_kind(0, 1), FeedKind::Video);
        assert_eq!(feed_kind(2, 1), FeedKind::Carousel);
        assert_eq!(feed_kind(11, 0), FeedKind::TooMany);
    }

    #[test]
    fn container_states() {
        assert_eq!(container_state("FINISHED"), ContainerState::Ready);
        assert_eq!(container_state("ERROR"), ContainerState::Failed);
        assert_eq!(container_state("EXPIRED"), ContainerState::Expired);
        assert_eq!(container_state("IN_PROGRESS"), ContainerState::Pending);
    }

    #[test]
    fn permanent_errors_are_recognised() {
        assert!(is_permanent(&permanent("x")));
        assert!(!is_permanent(&anyhow!(
            "Instagram API error publishing: quota (code: 4)"
        )));
    }

    #[test]
    fn upload_errors_keep_graph_code() {
        let body = r#"{"error":{"message":"Limit","code":4}}"#;
        assert_eq!(
            upload_error_message(body),
            "Instagram upload error: Limit (code: 4)"
        );
        assert_eq!(upload_error_message("boom"), "Instagram upload error: boom");
    }
}
