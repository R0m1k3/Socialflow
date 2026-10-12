//! Stockage local des fichiers (ex-`minio.ts`) : tout vit sous `uploads/`
//! et est servi en relatif (`/uploads/<clé>`), quel que soit le domaine.

use std::path::{Path, PathBuf};

use bytes::Bytes;

use crate::state::AppState;

/// URL d'un fichier stocké : relative, pour fonctionner sur tout domaine.
pub fn build_url(object_key: &str) -> String {
    format!("/uploads/{object_key}")
}

/// URL absolue pour les services externes (API Facebook…) : préfixée par `APP_URL`.
pub fn resolve_public_url(state: &AppState, url: &str) -> String {
    if url.is_empty() || !url.starts_with('/') {
        return url.to_string();
    }
    let base = state.config.app_url.as_deref().unwrap_or("http://localhost:5555");
    format!("{}{url}", base.trim_end_matches('/'))
}

/// URL absolue pour les services Docker internes (FFmpeg…) : `INTERNAL_APP_URL`.
pub fn resolve_internal_url(state: &AppState, url: &str) -> String {
    if url.is_empty() || !url.starts_with('/') {
        return url.to_string();
    }
    let base = state
        .config
        .internal_app_url
        .as_deref()
        .or(state.config.app_url.as_deref())
        .unwrap_or("http://localhost:5555");
    format!("{}{url}", base.trim_end_matches('/'))
}

/// Chemin disque d'une URL `/uploads/...`, si elle reste dans le dossier des
/// uploads (refuse toute remontée `..`).
pub fn local_path(state: &AppState, url: &str) -> Option<PathBuf> {
    let rest = url.strip_prefix("/uploads/")?;
    let rest = rest.split(['?', '#']).next().unwrap_or(rest);
    let decoded = percent_encoding::percent_decode_str(rest).decode_utf8().ok()?;
    if decoded.split('/').any(|part| part == ".." || part.is_empty()) {
        return None;
    }
    let (root, relative) = if let Some(r) = decoded.strip_prefix("audio/") {
        (state.config.audio_upload_dir.clone(), r.to_string())
    } else if let Some(r) = decoded.strip_prefix("temp/") {
        (state.config.temp_upload_dir.clone(), r.to_string())
    } else {
        (state.config.uploads_dir.clone(), decoded.to_string())
    };
    Some(root.join(relative))
}

/// Contenu d'un média, local (`/uploads/...`) ou distant.
pub async fn read_media_buffer(state: &AppState, url: &str) -> anyhow::Result<Bytes> {
    if let Some(path) = local_path(state, url) {
        if let Ok(data) = tokio::fs::read(&path).await {
            return Ok(Bytes::from(data));
        }
    }
    let absolute = resolve_public_url(state, url);
    let response = state.http.get(&absolute).send().await?;
    if !response.status().is_success() {
        anyhow::bail!(
            "Impossible de récupérer le média depuis {absolute} ({})",
            response.status().as_u16()
        );
    }
    Ok(response.bytes().await?)
}

fn safe_name(file_name: &str) -> String {
    let base = Path::new(file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    base.chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') { c } else { '-' })
        .collect()
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

async fn write(state: &AppState, object_key: &str, data: &[u8]) -> anyhow::Result<()> {
    let path = state.config.uploads_dir.join(object_key);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(&path, data).await?;
    Ok(())
}

/// Résultat d'un enregistrement de média : toutes les déclinaisons pointent sur le même fichier.
#[derive(Debug, Clone)]
pub struct StoredMedia {
    pub public_id: String,
    pub original_url: String,
    pub facebook_feed_url: Option<String>,
    pub instagram_feed_url: Option<String>,
    pub instagram_story_url: Option<String>,
}

/// Source d'un média à ranger : fichier sur disque ou contenu en mémoire.
pub enum MediaSource<'a> {
    Path(&'a Path),
    Bytes(&'a [u8]),
}

pub async fn upload_media(state: &AppState, source: MediaSource<'_>, file_name: &str) -> anyhow::Result<StoredMedia> {
    let object_key = format!("media/{}-{}", now_ms(), safe_name(file_name));
    let target = state.config.uploads_dir.join(&object_key);
    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    match source {
        MediaSource::Path(path) => {
            // Copie plutôt que renommage : le fichier temporaire peut être sur un autre volume
            tokio::fs::copy(path, &target).await?;
        }
        MediaSource::Bytes(data) => tokio::fs::write(&target, data).await?,
    }
    let url = build_url(&object_key);
    Ok(StoredMedia {
        public_id: object_key,
        original_url: url.clone(),
        facebook_feed_url: Some(url.clone()),
        instagram_feed_url: Some(url.clone()),
        instagram_story_url: Some(url),
    })
}

/// Supprime un fichier rangé par `upload_media` (clé relative à `uploads/`).
pub async fn delete_media(state: &AppState, public_id: &str) -> anyhow::Result<()> {
    if public_id.split('/').any(|p| p == "..") {
        anyhow::bail!("clé de média invalide : {public_id}");
    }
    let path = state.config.uploads_dir.join(public_id);
    match tokio::fs::remove_file(&path).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Image de story avec texte incrusté ; renvoie son URL.
pub async fn upload_story_image(state: &AppState, data: &[u8], original_file_name: &str) -> anyhow::Result<String> {
    let object_key = format!("stories/story-{}-{}", now_ms(), safe_name(original_file_name));
    write(state, &object_key, data).await?;
    Ok(build_url(&object_key))
}

/// Vignette vidéo (conservée après la suppression de la vidéo source).
pub async fn upload_thumbnail(state: &AppState, data: &[u8], file_name: &str) -> anyhow::Result<(String, String)> {
    let object_key = format!("thumbnails/{}", safe_name(file_name));
    write(state, &object_key, data).await?;
    let url = build_url(&object_key);
    Ok((object_key, url))
}

/// Logo de l'entreprise ; renvoie (clé, URL).
pub async fn upload_logo(state: &AppState, data: &[u8], file_name: &str) -> anyhow::Result<(String, String)> {
    let ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_else(|| ".png".into());
    let object_key = format!("logos/logo-{}{ext}", now_ms());
    write(state, &object_key, data).await?;
    let url = build_url(&object_key);
    Ok((object_key, url))
}

pub async fn delete_logo(state: &AppState, public_id: &str) -> anyhow::Result<()> {
    delete_media(state, public_id).await
}
