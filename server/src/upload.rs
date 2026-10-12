//! Réception de fichiers `multipart/form-data` (équivalent de multer avec
//! stockage disque) : chaque fichier est écrit en flux sur le disque.

use std::path::{Path, PathBuf};

use axum::extract::Multipart;
use rand::Rng;
use tokio::io::AsyncWriteExt;

use crate::error::AppError;

#[derive(Debug, Clone)]
pub struct UploadedFile {
    pub field: String,
    /// Nom d'origine envoyé par le navigateur.
    pub original_name: String,
    /// Nom sur le disque (`<horodatage>-<aléa>-<nom nettoyé>`).
    pub file_name: String,
    pub path: PathBuf,
    pub size: u64,
    pub mime: String,
}

pub struct UploadRules<'a> {
    /// Champs de fichier acceptés (`file`, `logo`, `files`…).
    pub fields: &'a [&'a str],
    pub dir: &'a Path,
    pub max_file_size: u64,
    pub max_files: usize,
    /// Filtre (type MIME, nom d'origine) → message d'erreur si refusé.
    pub filter: &'a (dyn Fn(&str, &str) -> Result<(), String> + Send + Sync),
}

/// Nom de fichier multer : caractères hors `[a-zA-Z0-9.]` remplacés par `_`.
pub fn disk_name(original: &str) -> String {
    let safe: String = original
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let millis = chrono::Utc::now().timestamp_millis();
    let random: u32 = rand::thread_rng().gen_range(0..1_000_000_000);
    format!("{millis}-{random}-{safe}")
}

/// Lit le formulaire ; les champs texte sont renvoyés à part.
pub async fn receive_files(
    mut multipart: Multipart,
    rules: UploadRules<'_>,
) -> Result<(Vec<UploadedFile>, Vec<(String, String)>), AppError> {
    tokio::fs::create_dir_all(rules.dir)
        .await
        .map_err(|e| AppError::internal_logged("Dossier d'upload inaccessible", e))?;

    let mut files: Vec<UploadedFile> = Vec::new();
    let mut fields: Vec<(String, String)> = Vec::new();

    let result: Result<(), AppError> = async {
        while let Some(mut field) = multipart
            .next_field()
            .await
            .map_err(|e| AppError::bad_request(format!("Formulaire invalide : {e}")))?
        {
            let name = field.name().unwrap_or("").to_string();
            let Some(original_name) = field.file_name().map(str::to_string) else {
                let text = field.text().await.unwrap_or_default();
                fields.push((name, text));
                continue;
            };
            if !rules.fields.contains(&name.as_str()) {
                return Err(AppError::internal(format!("Unexpected field: {name}")));
            }
            if files.len() >= rules.max_files {
                return Err(AppError::internal("Too many files"));
            }
            let mime = field
                .content_type()
                .map(str::to_string)
                .unwrap_or_else(|| "application/octet-stream".into());
            if let Err(message) = (rules.filter)(&mime, &original_name) {
                return Err(AppError::internal(message));
            }

            let file_name = disk_name(&original_name);
            let path = rules.dir.join(&file_name);
            let mut out = tokio::fs::File::create(&path)
                .await
                .map_err(|e| AppError::internal_logged("Écriture du fichier impossible", e))?;
            let mut size: u64 = 0;
            let mut uploaded = UploadedFile {
                field: name,
                original_name,
                file_name,
                path: path.clone(),
                size: 0,
                mime,
            };
            // Ajouté tout de suite : nettoyé en cas d'erreur plus bas
            files.push(uploaded.clone());
            while let Some(chunk) = field
                .chunk()
                .await
                .map_err(|e| AppError::bad_request(format!("Réception interrompue : {e}")))?
            {
                size += chunk.len() as u64;
                if size > rules.max_file_size {
                    return Err(AppError::new(
                        axum::http::StatusCode::PAYLOAD_TOO_LARGE,
                        "File too large",
                    ));
                }
                out.write_all(&chunk)
                    .await
                    .map_err(|e| AppError::internal_logged("Écriture du fichier impossible", e))?;
            }
            out.flush().await.ok();
            uploaded.size = size;
            if let Some(last) = files.last_mut() {
                *last = uploaded;
            }
        }
        Ok(())
    }
    .await;

    if let Err(error) = result {
        for file in &files {
            let _ = tokio::fs::remove_file(&file.path).await;
        }
        return Err(error);
    }
    Ok((files, fields))
}

/// Supprime des fichiers temporaires sans se soucier des erreurs.
pub async fn cleanup(files: &[UploadedFile]) {
    for file in files {
        let _ = tokio::fs::remove_file(&file.path).await;
    }
}
