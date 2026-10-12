//! Configuration lue dans l'environnement (mêmes variables que l'ancien serveur).

use std::path::PathBuf;

use anyhow::bail;
use rand::RngCore;

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub session_secret: String,
    pub production: bool,
    /// URL publique (ex. https://socialflow.exemple.fr), sans « / » final.
    pub app_url: Option<String>,
    /// URL interne Docker par laquelle les autres services joignent l'app.
    pub internal_app_url: Option<String>,
    /// Frontend compilé (Vite) : `dist/public`.
    pub static_dir: PathBuf,
    /// Fichiers servis à la racine du domaine (vérifications de domaine).
    pub public_root_dir: PathBuf,
    /// Racine des fichiers servis sous /uploads.
    pub uploads_dir: PathBuf,
    pub audio_upload_dir: PathBuf,
    pub temp_upload_dir: PathBuf,
    /// Polices (DejaVuSans.ttf) pour le texte incrusté dans les images.
    pub fonts_dir: PathBuf,
    pub gemini_api_key: Option<String>,
    pub external_api_key: Option<String>,
    /// « remotion » (défaut) ou « ffmpeg ».
    pub reel_renderer: String,
    /// Service de rendu Remotion (conteneur Node dédié).
    pub remotion_url: Option<String>,
    pub ffmpeg_api_url: Option<String>,
    pub ffmpeg_api_key: Option<String>,
}

fn env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let cwd = std::env::current_dir()?;
        let production = matches!(
            env("NODE_ENV").or_else(|| env("APP_ENV")).as_deref(),
            Some("production")
        );

        let session_secret = match env("SESSION_SECRET") {
            Some(secret) => secret,
            None if production => {
                bail!("SESSION_SECRET non défini en production. Arrêt du serveur.")
            }
            None => {
                tracing::warn!(
                    "⚠️ SESSION_SECRET non défini. Utilisation d'une clé aléatoire pour le développement."
                );
                let mut bytes = [0u8; 32];
                rand::thread_rng().fill_bytes(&mut bytes);
                hex::encode(bytes)
            }
        };

        let database_url = match env("DATABASE_URL") {
            Some(url) => url,
            None => bail!("DATABASE_URL must be set. Did you forget to provision a database?"),
        };

        let uploads_dir = cwd.join("uploads");
        let audio_upload_dir = env("AUDIO_UPLOAD_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| uploads_dir.join("audio"));
        let temp_upload_dir = env("TEMP_UPLOAD_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| uploads_dir.join("temp"));

        let static_dir = env("STATIC_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| cwd.join("dist").join("public"));

        let fonts_dir = env("FONTS_DIR").map(PathBuf::from).unwrap_or_else(|| {
            let local = cwd.join("server").join("fonts");
            if local.exists() {
                local
            } else {
                cwd.join("fonts")
            }
        });

        Ok(Self {
            port: env("PORT").and_then(|p| p.parse().ok()).unwrap_or(5000),
            database_url,
            session_secret,
            production,
            app_url: env("APP_URL").map(|u| u.trim_end_matches('/').to_string()),
            internal_app_url: env("INTERNAL_APP_URL").map(|u| u.trim_end_matches('/').to_string()),
            static_dir,
            public_root_dir: env("PUBLIC_ROOT_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| cwd.join("public-root")),
            uploads_dir,
            audio_upload_dir,
            temp_upload_dir,
            fonts_dir,
            gemini_api_key: env("GEMINI_API_KEY"),
            external_api_key: env("EXTERNAL_API_KEY"),
            reel_renderer: if env("REEL_RENDERER").as_deref() == Some("ffmpeg") {
                "ffmpeg".into()
            } else {
                "remotion".into()
            },
            remotion_url: env("REMOTION_RENDERER_URL").map(|u| u.trim_end_matches('/').to_string()),
            ffmpeg_api_url: env("FFMPEG_API_URL"),
            ffmpeg_api_key: env("FFMPEG_API_KEY"),
        })
    }

    /// Lecture directe d'une variable optionnelle (services peu configurés).
    pub fn var(name: &str) -> Option<String> {
        env(name)
    }
}
