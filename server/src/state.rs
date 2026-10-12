//! État partagé par les routes et les tâches de fond.

use std::ops::Deref;
use std::sync::Arc;
use std::time::Duration;

use sqlx::PgPool;
use tokio::sync::{Notify, RwLock};

use crate::config::Config;
use crate::db::Db;
use crate::http::RateLimiter;

/// Adresse et clé du service FFmpeg ; modifiables depuis les paramètres.
#[derive(Debug, Clone, Default)]
pub struct FfmpegSettings {
    pub api_url: Option<String>,
    pub api_key: Option<String>,
}

pub struct Inner {
    pub config: Config,
    pub db: Db,
    /// Client HTTP commun (APIs Meta, TikTok, OpenRouter, services internes).
    pub http: reqwest::Client,
    pub ffmpeg: RwLock<FfmpegSettings>,
    /// Réveille la file des rendus de Reels quand un job est ajouté.
    pub reel_queue: Notify,
    pub global_limiter: RateLimiter,
    pub auth_limiter: RateLimiter,
}

#[derive(Clone)]
pub struct AppState(Arc<Inner>);

impl Deref for AppState {
    type Target = Inner;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl AppState {
    pub fn new(config: Config, pool: PgPool) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .user_agent("SocialFlow/2.0")
            .connect_timeout(Duration::from_secs(30))
            .build()?;

        let ffmpeg = FfmpegSettings {
            api_url: config
                .ffmpeg_api_url
                .as_ref()
                .map(|u| u.trim_end_matches('/').to_string()),
            api_key: config.ffmpeg_api_key.clone(),
        };
        if ffmpeg.api_url.is_none() || ffmpeg.api_key.is_none() {
            tracing::warn!("⚠️ FFmpeg API not configured - video processing will be skipped");
        } else if let Some(url) = &ffmpeg.api_url {
            tracing::info!("🎬 FFmpeg Service configured: {url}");
        }

        Ok(Self(Arc::new(Inner {
            db: Db::new(pool),
            http,
            ffmpeg: RwLock::new(ffmpeg),
            reel_queue: Notify::new(),
            // 1000 requêtes / 15 min par IP sur /api, 30 tentatives de connexion
            global_limiter: RateLimiter::new(1000, Duration::from_secs(15 * 60)),
            auth_limiter: RateLimiter::new(30, Duration::from_secs(15 * 60)),
            config,
        })))
    }
}
