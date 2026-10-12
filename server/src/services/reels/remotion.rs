//! Rendu Remotion : ressources fournies aux compositions et client du service
//! de rendu (conteneur Node `remotion-service`, voir ce dossier).
//!
//! Le serveur Rust ne peut pas exécuter Remotion (React + Chromium) : il
//! confie la composition au service, qui lit la vidéo et le son préparés via
//! les URL `/uploads/temp/...` servies par l'application.

use std::future::Future;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail};
use base64::Engine;
use futures::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;

use crate::state::AppState;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const POLL_INTERVAL: Duration = Duration::from_secs(1);
/// Garde-fou : un rendu bloqué ne doit pas immobiliser la file indéfiniment.
const MAX_RENDER_TIME: Duration = Duration::from_secs(60 * 60);
/// Erreurs réseau consécutives tolérées pendant le suivi (redémarrage bref, etc.).
const MAX_POLL_ERRORS: u32 = 10;

/// Base des URL internes par lesquelles le service de rendu joint l'application.
fn internal_base(state: &AppState) -> String {
    state
        .config
        .internal_app_url
        .clone()
        .unwrap_or_else(|| format!("http://localhost:{}", state.config.port))
}

/// URL servie (`/uploads/temp/...`) d'un fichier du dossier temporaire,
/// joignable par le service de rendu.
pub fn temp_file_url(state: &AppState, absolute_path: &Path) -> String {
    let relative = absolute_path
        .strip_prefix(&state.config.temp_upload_dir)
        .unwrap_or(absolute_path)
        .components()
        .filter_map(|c| match c {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/");
    format!("{}/uploads/temp/{relative}", internal_base(state))
}

/// Normalisation lexicale (`path.resolve`) : résout `.` et `..` sans toucher au disque.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn absolute(path: &Path) -> PathBuf {
    normalize(&std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf()))
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        _ => "image/jpeg",
    }
}

/// Convertit un chemin local /uploads/... en data URL : les images sont
/// affichées par Chromium dans le service de rendu. Refuse tout chemin
/// sortant du dossier uploads.
pub async fn to_data_url(state: &AppState, relative_url: &str) -> anyhow::Result<String> {
    to_data_url_in(
        &state.config.uploads_dir,
        &state.config.temp_upload_dir,
        relative_url,
    )
    .await
}

pub async fn to_data_url_in(
    uploads_dir: &Path,
    temp_dir: &Path,
    relative_url: &str,
) -> anyhow::Result<String> {
    if !relative_url.starts_with("/uploads/") {
        return Ok(relative_url.to_string());
    }
    let uploads_root = absolute(uploads_dir);
    let temp_root = absolute(temp_dir);
    let file_path = match relative_url.strip_prefix("/uploads/temp/") {
        Some(rest) => normalize(&temp_root.join(rest)),
        None => normalize(&uploads_root.join(&relative_url["/uploads/".len()..])),
    };
    let inside = |root: &Path| file_path.starts_with(root) && file_path != root;
    if !inside(&uploads_root) && !inside(&temp_root) {
        bail!("Chemin d'image refusé : {relative_url}");
    }
    match tokio::fs::read(&file_path).await {
        Ok(data) => Ok(format!(
            "data:{};base64,{}",
            mime_for(&file_path),
            base64::engine::general_purpose::STANDARD.encode(data)
        )),
        Err(_) => {
            tracing::warn!("⚠️ [Remotion] Image introuvable : {}", file_path.display());
            Ok(relative_url.to_string())
        }
    }
}

/// Clé du service de rendu : la même que celle du service FFmpeg.
async fn api_key(state: &AppState) -> String {
    state
        .ffmpeg
        .read()
        .await
        .api_key
        .clone()
        .unwrap_or_default()
}

/// Message d'erreur d'une réponse du service (`{ error }`), sinon le corps.
async fn response_error(response: reqwest::Response) -> String {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string))
        .unwrap_or(text);
    format!(
        "Service de rendu Remotion ({}) : {}",
        status.as_u16(),
        message.chars().take(2000).collect::<String>()
    )
}

#[derive(Debug, Deserialize)]
struct RenderStatus {
    status: String,
    #[serde(default)]
    progress: f64,
    #[serde(default)]
    error: Option<String>,
}

/// Rend une composition dans le service Remotion et écrit le MP4 dans
/// `output`. `on_progress` reçoit l'avancement (0..1). Le job du service est
/// toujours supprimé à la fin, réussi ou non.
pub async fn render_composition<F, Fut>(
    state: &AppState,
    base_url: &str,
    composition_id: &str,
    input_props: Value,
    output: &Path,
    mut on_progress: F,
) -> anyhow::Result<()>
where
    F: FnMut(f64) -> Fut,
    Fut: Future<Output = ()>,
{
    let base = base_url.trim_end_matches('/');
    let key = api_key(state).await;
    let unreachable = |e: reqwest::Error| anyhow!("Service de rendu Remotion injoignable : {e}");

    let response = state
        .http
        .post(format!("{base}/renders"))
        .header("X-API-Key", &key)
        .timeout(REQUEST_TIMEOUT)
        .json(&json!({ "compositionId": composition_id, "inputProps": input_props }))
        .send()
        .await
        .map_err(unreachable)?;
    if !response.status().is_success() {
        bail!(response_error(response).await);
    }
    #[derive(Deserialize)]
    struct Created {
        id: String,
    }
    let created: Created = response.json().await.map_err(unreachable)?;
    let render_url = format!("{base}/renders/{}", created.id);

    let started = Instant::now();
    let result = async {
        let mut errors = 0;
        loop {
            if started.elapsed() > MAX_RENDER_TIME {
                bail!(
                    "Rendu Remotion trop long (plus de {} min)",
                    MAX_RENDER_TIME.as_secs() / 60
                );
            }
            tokio::time::sleep(POLL_INTERVAL).await;
            let response = match state
                .http
                .get(&render_url)
                .header("X-API-Key", &key)
                .timeout(REQUEST_TIMEOUT)
                .send()
                .await
            {
                Ok(response) => response,
                Err(error) => {
                    errors += 1;
                    if errors >= MAX_POLL_ERRORS {
                        return Err(unreachable(error));
                    }
                    continue;
                }
            };
            if !response.status().is_success() {
                bail!(response_error(response).await);
            }
            let status: RenderStatus = response.json().await.map_err(unreachable)?;
            errors = 0;
            match status.status.as_str() {
                "done" => break,
                "failed" => bail!(status
                    .error
                    .unwrap_or_else(|| "Rendu Remotion en échec".into())),
                _ => on_progress(status.progress.clamp(0.0, 1.0)).await,
            }
        }

        // Téléchargement en flux du MP4 produit
        let response = state
            .http
            .get(format!("{render_url}/file"))
            .header("X-API-Key", &key)
            .timeout(DOWNLOAD_TIMEOUT)
            .send()
            .await
            .map_err(unreachable)?;
        if !response.status().is_success() {
            bail!(response_error(response).await);
        }
        let mut file = tokio::fs::File::create(output).await?;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            file.write_all(&chunk.map_err(unreachable)?).await?;
        }
        file.flush().await?;
        tracing::info!(
            "🎞️ [Remotion] {composition_id} rendu en {:.1} s",
            started.elapsed().as_secs_f64()
        );
        Ok(())
    }
    .await;

    // Le fichier n'est plus utile au service (sinon purgé plus tard)
    let _ = state
        .http
        .delete(&render_url)
        .header("X-API-Key", &key)
        .timeout(Duration::from_secs(5))
        .send()
        .await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dirs() -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("sf-remotion-test-{}", std::process::id()));
        (root.join("uploads"), root.join("uploads").join("temp"))
    }

    #[tokio::test]
    async fn refuse_un_chemin_qui_sort_du_dossier_uploads() {
        let (uploads, temp) = dirs();
        let error = to_data_url_in(&uploads, &temp, "/uploads/../../etc/passwd")
            .await
            .unwrap_err();
        assert!(error.to_string().contains("refusé"));
        let error = to_data_url_in(&uploads, &temp, "/uploads/temp/../../../etc/passwd")
            .await
            .unwrap_err();
        assert!(error.to_string().contains("refusé"));
    }

    #[tokio::test]
    async fn laisse_les_url_externes_telles_quelles() {
        let (uploads, temp) = dirs();
        assert_eq!(
            to_data_url_in(&uploads, &temp, "https://exemple.fr/logo.png")
                .await
                .unwrap(),
            "https://exemple.fr/logo.png"
        );
    }

    #[tokio::test]
    async fn convertit_un_logo_en_data_url() {
        let (uploads, temp) = dirs();
        let logos = uploads.join("logos");
        std::fs::create_dir_all(&logos).unwrap();
        std::fs::write(logos.join("logo.png"), b"abc").unwrap();
        assert_eq!(
            to_data_url_in(&uploads, &temp, "/uploads/logos/logo.png")
                .await
                .unwrap(),
            "data:image/png;base64,YWJj"
        );
        // Fichier absent : l'URL est rendue telle quelle
        assert_eq!(
            to_data_url_in(&uploads, &temp, "/uploads/logos/absent.png")
                .await
                .unwrap(),
            "/uploads/logos/absent.png"
        );
        let _ = std::fs::remove_dir_all(uploads.parent().unwrap());
    }

    #[test]
    fn normalisation_lexicale() {
        assert_eq!(
            normalize(Path::new("/a/b/../c/./d")),
            PathBuf::from("/a/c/d")
        );
        assert_eq!(normalize(Path::new("/a/../../etc")), PathBuf::from("/etc"));
    }
}
