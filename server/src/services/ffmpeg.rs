//! Client du service FFmpeg (conteneur Python `ffmpeg-service`).
//!
//! Le service rend le Reel puis expose le MP4 en téléchargement
//! (GET /files/{job}/output.mp4) : la vidéo ne transite pas en base64 dans du
//! JSON. Adresse et clé viennent de `state.ffmpeg` (modifiables à chaud depuis
//! les paramètres).

use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use bytes::Bytes;
use futures::StreamExt;
use reqwest::Method;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tokio::io::AsyncWriteExt;

use crate::services::reels::params::SrtCue;
use crate::state::AppState;

/// Un rendu long (stabilisation + encodage) peut dépasser plusieurs minutes.
const PROCESS_TIMEOUT: Duration = Duration::from_secs(20 * 60);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// Qwen (local, CPU) met plusieurs fois la durée de la voix à la générer.
const TTS_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(5);
const VOICES_TIMEOUT: Duration = Duration::from_secs(30);

/// Service Qwen TTS (local ou serveur GPU) réglé dans les paramètres.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QwenTarget {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

/// Catalogue des voix renvoyé par le service (noms de champs du service Python).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VoiceCatalog {
    #[serde(default)]
    pub qwen: Vec<Value>,
    #[serde(default)]
    pub qwen_available: bool,
    /// Modèle et carte graphique du service Qwen, null s'il ne répond pas.
    #[serde(default)]
    pub qwen_status: Option<Value>,
    #[serde(default)]
    pub gemini: Vec<Value>,
    #[serde(default)]
    pub edge: Vec<Value>,
}

/// Erreur renvoyée par le service, avec son message lisible et son statut HTTP.
#[derive(Debug, Clone, thiserror::Error)]
#[error("{message}")]
pub struct FFmpegServiceError {
    pub message: String,
    pub status: Option<u16>,
}

impl FFmpegServiceError {
    pub fn new(message: impl Into<String>, status: Option<u16>) -> Self {
        Self {
            message: message.into(),
            status,
        }
    }
}

/// Mot affiché et son intervalle, en secondes depuis le début de la vidéo.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimedWord {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

/// Options d'un rendu (ou d'une préparation Remotion). `None` = valeur par
/// défaut du service : le champ n'est pas envoyé, comme `undefined` en JSON.
#[derive(Debug, Clone, Default)]
pub struct ReelRenderOptions {
    pub text: Option<String>,
    /// Sous-titres SRT : remplacent `text`, la voix lit chacun à son instant.
    pub srt_cues: Option<Vec<SrtCue>>,
    pub music_url: Option<String>,
    pub tts_enabled: Option<bool>,
    pub tts_voice: Option<String>,
    pub tts_engine: Option<String>,
    pub tts_style: Option<String>,
    pub gemini_api_key: Option<String>,
    pub qwen: Option<QwenTarget>,
    pub font_size: Option<i64>,
    pub music_volume: Option<f64>,
    pub draw_text: Option<bool>,
    pub stabilize: Option<bool>,
    pub watermark_url: Option<String>,
    pub store_name: Option<String>,
    pub enable_ending_effect: Option<bool>,
    /// Petit logo pendant la vidéo (le grand logo de fin dépend de `enable_ending_effect`).
    pub show_logo: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct ReelRenderResult {
    pub video: Bytes,
    pub duration: f64,
    pub tts_engine: Option<String>,
    pub tts_voice: Option<String>,
    pub warnings: Vec<String>,
}

/// Rendu préparé pour Remotion : fichiers déjà écrits sur le disque.
#[derive(Debug, Clone)]
pub struct PreparedReel {
    pub video_path: PathBuf,
    pub audio_path: Option<PathBuf>,
    pub total_duration: f64,
    pub video_duration: f64,
    pub logo_start: Option<f64>,
    /// Fondu final, calculé par le service pour ne jamais rogner la voix.
    pub fade_start: Option<f64>,
    pub fade_duration: Option<f64>,
    pub words: Vec<TimedWord>,
    pub tts_engine: Option<String>,
    pub tts_voice: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct VoicePreviewOptions {
    pub voice: Option<String>,
    pub engine: Option<String>,
    pub style: Option<String>,
    pub gemini_api_key: Option<String>,
    pub qwen: Option<QwenTarget>,
}

#[derive(Debug, Clone)]
pub struct VoicePreview {
    pub audio: Vec<u8>,
    pub duration: f64,
    pub words: Vec<TimedWord>,
    pub engine: String,
    pub voice: String,
    pub warnings: Vec<String>,
}

// ---------------------------------------------------------------------------
// Appels HTTP
// ---------------------------------------------------------------------------

struct Endpoint {
    url: String,
    key: String,
}

async fn endpoint(state: &AppState) -> Result<Endpoint, FFmpegServiceError> {
    let settings = state.ffmpeg.read().await;
    match (&settings.api_url, &settings.api_key) {
        (Some(url), Some(key)) if !url.is_empty() && !key.is_empty() => Ok(Endpoint {
            url: url.trim_end_matches('/').to_string(),
            key: key.clone(),
        }),
        _ => Err(FFmpegServiceError::new(
            "Le service FFmpeg n'est pas configuré (FFMPEG_API_URL / FFMPEG_API_KEY).",
            None,
        )),
    }
}

fn network_error(path: &str, error: reqwest::Error) -> FFmpegServiceError {
    if error.is_timeout() {
        FFmpegServiceError::new(
            format!("Le service FFmpeg n'a pas répondu à temps ({path})"),
            None,
        )
    } else {
        FFmpegServiceError::new(format!("Service FFmpeg injoignable : {error}"), None)
    }
}

/// Message lisible d'une réponse en erreur : `detail` du JSON FastAPI, sinon le corps.
fn error_detail(body: &str) -> String {
    let detail = match serde_json::from_str::<Value>(body) {
        Ok(Value::Object(map)) => match map.get("detail") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Null) | None => body.to_string(),
            Some(other) => other.to_string(),
        },
        _ => body.to_string(),
    };
    detail.chars().take(2000).collect()
}

async fn call(
    state: &AppState,
    method: Method,
    path: &str,
    body: Option<&Value>,
    headers: &[(&str, String)],
    timeout: Duration,
) -> Result<reqwest::Response, FFmpegServiceError> {
    let endpoint = endpoint(state).await?;
    let mut request = state
        .http
        .request(method, format!("{}{path}", endpoint.url))
        .header("X-API-Key", &endpoint.key)
        .timeout(timeout);
    for (name, value) in headers {
        request = request.header(*name, value);
    }
    if let Some(body) = body {
        request = request.json(body);
    }
    let response = request.send().await.map_err(|e| network_error(path, e))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(FFmpegServiceError::new(
            error_detail(&text),
            Some(status.as_u16()),
        ));
    }
    Ok(response)
}

async fn read_json<T: DeserializeOwned>(
    response: reqwest::Response,
    path: &str,
) -> Result<T, FFmpegServiceError> {
    let bytes = response.bytes().await.map_err(|e| network_error(path, e))?;
    serde_json::from_slice(&bytes).map_err(|e| {
        FFmpegServiceError::new(
            format!("Réponse invalide du service FFmpeg ({path}) : {e}"),
            None,
        )
    })
}

/// Le fichier n'est plus utile au service une fois récupéré (sinon purgé plus tard).
fn delete_job_later(state: &AppState, job_id: &str) {
    let state = state.clone();
    let path = format!("/jobs/{job_id}");
    tokio::spawn(async move {
        let _ = call(&state, Method::DELETE, &path, None, &[], HEALTH_TIMEOUT).await;
    });
}

fn put<T: Into<Value>>(map: &mut Map<String, Value>, key: &str, value: Option<T>) {
    if let Some(value) = value {
        map.insert(key.to_string(), value.into());
    }
}

/// Champs communs à /process-reel et /prepare-reel.
fn base_body(video_url: &str, options: &ReelRenderOptions) -> Map<String, Value> {
    let mut body = Map::new();
    body.insert("video_url".into(), video_url.into());
    put(&mut body, "text", options.text.clone());
    if let Some(cues) = &options.srt_cues {
        body.insert(
            "srt_cues".into(),
            serde_json::to_value(cues).unwrap_or(Value::Null),
        );
    }
    put(&mut body, "music_url", options.music_url.clone());
    body.insert(
        "tts_enabled".into(),
        options.tts_enabled.unwrap_or(false).into(),
    );
    put(&mut body, "tts_voice", options.tts_voice.clone());
    put(&mut body, "tts_engine", options.tts_engine.clone());
    put(&mut body, "tts_style", options.tts_style.clone());
    put(&mut body, "gemini_api_key", options.gemini_api_key.clone());
    put(
        &mut body,
        "qwen_tts_url",
        options.qwen.as_ref().map(|q| q.url.clone()),
    );
    put(
        &mut body,
        "qwen_tts_api_key",
        options.qwen.as_ref().and_then(|q| q.api_key.clone()),
    );
    body
}

/// Rend un Reel à partir de l'URL d'une vidéo et renvoie le MP4 produit.
pub async fn render_reel(
    state: &AppState,
    video_url: &str,
    options: &ReelRenderOptions,
) -> Result<ReelRenderResult, FFmpegServiceError> {
    let mut body = base_body(video_url, options);
    body.insert("font_size".into(), options.font_size.unwrap_or(64).into());
    body.insert(
        "music_volume".into(),
        options.music_volume.unwrap_or(0.25).into(),
    );
    body.insert("draw_text".into(), options.draw_text.unwrap_or(true).into());
    body.insert(
        "stabilize".into(),
        options.stabilize.unwrap_or(false).into(),
    );
    put(&mut body, "watermark_url", options.watermark_url.clone());
    put(&mut body, "store_name", options.store_name.clone());
    body.insert(
        "enable_ending_effect".into(),
        options.enable_ending_effect.unwrap_or(true).into(),
    );
    body.insert(
        "show_watermark".into(),
        options.show_logo.unwrap_or(true).into(),
    );

    let tts = if options.tts_enabled.unwrap_or(false) {
        format!(
            "{}/{}/{}",
            options.tts_engine.as_deref().unwrap_or("undefined"),
            options.tts_voice.as_deref().unwrap_or("undefined"),
            options.tts_style.as_deref().unwrap_or("neutral")
        )
    } else {
        "false".into()
    };
    tracing::info!(
        "🎬 Rendu du Reel : vidéo {video_url}, texte {} car., musique {}, voix {tts}",
        options
            .text
            .as_deref()
            .map(|t| t.chars().count())
            .unwrap_or(0),
        options.music_url.is_some()
    );

    #[derive(Deserialize)]
    struct ProcessResponse {
        job_id: String,
        output_path: String,
        #[serde(default)]
        duration: f64,
        #[serde(default)]
        tts_engine: Option<String>,
        #[serde(default)]
        tts_voice: Option<String>,
        #[serde(default)]
        warnings: Option<Vec<String>>,
    }

    let response = call(
        state,
        Method::POST,
        "/process-reel",
        Some(&Value::Object(body)),
        &[],
        PROCESS_TIMEOUT,
    )
    .await?;
    let data: ProcessResponse = read_json(response, "/process-reel").await?;

    let result = async {
        let file = call(
            state,
            Method::GET,
            &data.output_path,
            None,
            &[],
            DOWNLOAD_TIMEOUT,
        )
        .await?;
        let video = file
            .bytes()
            .await
            .map_err(|e| network_error(&data.output_path, e))?;
        let warnings = data.warnings.clone().unwrap_or_default();
        for warning in &warnings {
            tracing::warn!("⚠️ [FFmpeg] {warning}");
        }
        Ok(ReelRenderResult {
            video,
            duration: data.duration,
            tts_engine: data.tts_engine.clone(),
            tts_voice: data.tts_voice.clone(),
            warnings,
        })
    }
    .await;
    delete_job_later(state, &data.job_id);
    result
}

/// Prépare un rendu Remotion : image recadrée à la durée finale et piste son
/// finale, écrites dans `target_dir`, plus le minutage des mots.
pub async fn prepare_reel(
    state: &AppState,
    video_url: &str,
    options: &ReelRenderOptions,
    has_logo: bool,
    target_dir: &Path,
) -> Result<PreparedReel, FFmpegServiceError> {
    let mut body = base_body(video_url, options);
    body.insert(
        "music_volume".into(),
        options.music_volume.unwrap_or(0.25).into(),
    );
    body.insert("draw_text".into(), options.draw_text.unwrap_or(true).into());
    body.insert(
        "stabilize".into(),
        options.stabilize.unwrap_or(false).into(),
    );
    put(&mut body, "store_name", options.store_name.clone());
    body.insert(
        "enable_ending_effect".into(),
        options.enable_ending_effect.unwrap_or(true).into(),
    );
    body.insert("has_logo".into(), has_logo.into());

    #[derive(Deserialize)]
    struct PrepareResponse {
        job_id: String,
        video_path: String,
        #[serde(default)]
        audio_path: Option<String>,
        #[serde(default)]
        total_duration: f64,
        #[serde(default)]
        video_duration: f64,
        #[serde(default)]
        logo_start: Option<f64>,
        #[serde(default)]
        fade_start: Option<f64>,
        #[serde(default)]
        fade_duration: Option<f64>,
        #[serde(default)]
        words: Option<Vec<TimedWord>>,
        #[serde(default)]
        tts_engine: Option<String>,
        #[serde(default)]
        tts_voice: Option<String>,
        #[serde(default)]
        warnings: Option<Vec<String>>,
    }

    let response = call(
        state,
        Method::POST,
        "/prepare-reel",
        Some(&Value::Object(body)),
        &[],
        PROCESS_TIMEOUT,
    )
    .await?;
    let data: PrepareResponse = read_json(response, "/prepare-reel").await?;

    let result = async {
        tokio::fs::create_dir_all(target_dir).await.map_err(|e| {
            FFmpegServiceError::new(format!("Dossier de rendu inaccessible : {e}"), None)
        })?;
        let video_path = target_dir.join("video.mp4");
        download_to(state, &data.video_path, &video_path).await?;
        let audio_path = match &data.audio_path {
            Some(path) => {
                let target = target_dir.join("audio.wav");
                download_to(state, path, &target).await?;
                Some(target)
            }
            None => None,
        };
        let warnings = data.warnings.clone().unwrap_or_default();
        for warning in &warnings {
            tracing::warn!("⚠️ [FFmpeg] {warning}");
        }
        Ok(PreparedReel {
            video_path,
            audio_path,
            total_duration: data.total_duration,
            video_duration: data.video_duration,
            logo_start: data.logo_start,
            fade_start: data.fade_start,
            fade_duration: data.fade_duration,
            words: data.words.clone().unwrap_or_default(),
            tts_engine: data.tts_engine.clone(),
            tts_voice: data.tts_voice.clone(),
            warnings,
        })
    }
    .await;
    delete_job_later(state, &data.job_id);
    result
}

/// Télécharge un fichier du service en flux, sans le charger en mémoire.
async fn download_to(
    state: &AppState,
    service_path: &str,
    target: &Path,
) -> Result<(), FFmpegServiceError> {
    let response = call(
        state,
        Method::GET,
        service_path,
        None,
        &[],
        DOWNLOAD_TIMEOUT,
    )
    .await?;
    let write_error = |e: std::io::Error| {
        FFmpegServiceError::new(
            format!("Écriture de {} impossible : {e}", target.display()),
            None,
        )
    };
    let mut file = tokio::fs::File::create(target).await.map_err(write_error)?;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| network_error(service_path, e))?;
        file.write_all(&chunk).await.map_err(write_error)?;
    }
    file.flush().await.map_err(write_error)?;
    Ok(())
}

/// Le service répond-il ?
pub async fn health_check(state: &AppState) -> bool {
    call(state, Method::GET, "/health", None, &[], HEALTH_TIMEOUT)
        .await
        .is_ok()
}

/// Voix proposées par moteur ; `qwen` remplace la cible Qwen configurée côté service.
pub async fn list_voices(
    state: &AppState,
    qwen: Option<QwenTarget>,
) -> anyhow::Result<VoiceCatalog> {
    let mut headers: Vec<(&str, String)> = Vec::new();
    if let Some(qwen) = &qwen {
        if !qwen.url.is_empty() {
            headers.push(("X-Qwen-Url", qwen.url.clone()));
        }
        if let Some(key) = qwen.api_key.as_ref().filter(|k| !k.is_empty()) {
            headers.push(("X-Qwen-Key", key.clone()));
        }
    }
    let response = call(
        state,
        Method::GET,
        "/voices",
        None,
        &headers,
        VOICES_TIMEOUT,
    )
    .await?;
    Ok(read_json(response, "/voices").await?)
}

/// Génère la voix seule (aperçu), avec le minutage de chaque mot.
pub async fn preview_voice(
    state: &AppState,
    text: &str,
    options: &VoicePreviewOptions,
) -> Result<VoicePreview, FFmpegServiceError> {
    let mut body = Map::new();
    body.insert("text".into(), text.into());
    put(&mut body, "tts_voice", options.voice.clone());
    put(&mut body, "tts_engine", options.engine.clone());
    put(&mut body, "tts_style", options.style.clone());
    put(&mut body, "gemini_api_key", options.gemini_api_key.clone());
    put(
        &mut body,
        "qwen_tts_url",
        options.qwen.as_ref().map(|q| q.url.clone()),
    );
    put(
        &mut body,
        "qwen_tts_api_key",
        options.qwen.as_ref().and_then(|q| q.api_key.clone()),
    );

    #[derive(Deserialize)]
    struct PreviewResponse {
        #[serde(default)]
        audio_base64: String,
        #[serde(default)]
        duration: f64,
        #[serde(default)]
        words: Option<Vec<TimedWord>>,
        #[serde(default)]
        engine: String,
        #[serde(default)]
        voice: String,
        #[serde(default)]
        warnings: Option<Vec<String>>,
    }

    let response = call(
        state,
        Method::POST,
        "/preview-tts",
        Some(&Value::Object(body)),
        &[],
        TTS_TIMEOUT,
    )
    .await?;
    let data: PreviewResponse = read_json(response, "/preview-tts").await?;
    let audio = base64::engine::general_purpose::STANDARD
        .decode(data.audio_base64.trim())
        .map_err(|e| FFmpegServiceError::new(format!("Audio de l'aperçu illisible : {e}"), None))?;
    Ok(VoicePreview {
        audio,
        duration: data.duration,
        words: data.words.unwrap_or_default(),
        engine: data.engine,
        voice: data.voice,
        warnings: data.warnings.unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detail_des_erreurs() {
        assert_eq!(
            error_detail(r#"{"detail":"Vidéo illisible"}"#),
            "Vidéo illisible"
        );
        assert_eq!(
            error_detail("Internal Server Error"),
            "Internal Server Error"
        );
        assert_eq!(error_detail(r#"{"other":1}"#), r#"{"other":1}"#);
        assert_eq!(error_detail(&"x".repeat(3000)).len(), 2000);
    }

    #[test]
    fn champs_absents_non_envoyes() {
        let body = base_body("http://app/v.mp4", &ReelRenderOptions::default());
        assert_eq!(body.get("tts_enabled"), Some(&Value::Bool(false)));
        // tts_engine absent : le service prend sa valeur par défaut (gemini)
        assert!(!body.contains_key("tts_engine"));
        assert!(!body.contains_key("text"));
    }
}
