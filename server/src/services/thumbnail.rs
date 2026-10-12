//! Vignettes vidéo, extraites avec FFmpeg au moment de la création du média :
//! elles survivent à la suppression de la vidéo (historique illustré).

use std::path::{Path, PathBuf};

use rand::Rng;
use tokio::process::Command;

use crate::services::media_store;
use crate::state::AppState;

/// Source de la vidéo : fichier sur disque ou contenu en mémoire.
pub enum ThumbnailSource<'a> {
    Path(&'a Path),
    Bytes(&'a [u8]),
}

/// Extrait une image à `seek_time` secondes ; vrai si l'image a été écrite.
pub async fn generate_video_thumbnail(video: &Path, output: &Path, seek_time: f64) -> bool {
    // Arguments séparés : aucun passage par le shell
    let status = Command::new("ffmpeg")
        .args(["-y", "-ss", &seek_time.to_string(), "-i"])
        .arg(video)
        .args(["-vframes", "1", "-q:v", "2"])
        .arg(output)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await;
    match status {
        Ok(s) if s.success() => tokio::fs::metadata(output).await.is_ok(),
        Ok(_) => false,
        Err(error) => {
            tracing::warn!("⚠️ Failed to generate video thumbnail: {error}");
            false
        }
    }
}

/// Produit la vignette et la range dans le stockage public. Tolérante à
/// l'échec : renvoie `None` sans jamais faire échouer l'appelant.
pub async fn create_video_thumbnail(
    state: &AppState,
    source: ThumbnailSource<'_>,
) -> Option<String> {
    let temp_dir = state.config.uploads_dir.join("temp");
    if tokio::fs::create_dir_all(&temp_dir).await.is_err() {
        return None;
    }
    let stamp = format!(
        "{}-{}",
        chrono::Utc::now().timestamp_millis(),
        rand::thread_rng().gen_range(0..1_000_000_000u32)
    );
    let output = temp_dir.join(format!("thumb-{stamp}.jpg"));

    let mut temp_video: Option<PathBuf> = None;
    let video_path: PathBuf = match source {
        ThumbnailSource::Path(path) => path.to_path_buf(),
        ThumbnailSource::Bytes(data) => {
            let path = temp_dir.join(format!("thumb-src-{stamp}.mp4"));
            if tokio::fs::write(&path, data).await.is_err() {
                return None;
            }
            temp_video = Some(path.clone());
            path
        }
    };

    // Une vidéo de moins d'une seconde n'a pas d'image à 1 s : repli sur la première
    let mut ok = generate_video_thumbnail(&video_path, &output, 1.0).await;
    if !ok {
        ok = generate_video_thumbnail(&video_path, &output, 0.0).await;
    }

    let result = if ok {
        match tokio::fs::read(&output).await {
            Ok(data) => {
                match media_store::upload_thumbnail(state, &data, &format!("thumb-{stamp}.jpg"))
                    .await
                {
                    Ok((_, url)) => Some(url),
                    Err(error) => {
                        tracing::warn!("⚠️ Vignette non enregistrée : {error}");
                        None
                    }
                }
            }
            Err(_) => None,
        }
    } else {
        None
    };

    let _ = tokio::fs::remove_file(&output).await;
    if let Some(path) = temp_video {
        let _ = tokio::fs::remove_file(path).await;
    }
    result
}
