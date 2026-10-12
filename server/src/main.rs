// Quelques aides (accès aux données, réponses des services) sont gardées
// complètes même si toutes ne sont pas encore appelées.
#![allow(dead_code)]
//! SocialFlow — serveur HTTP en Rust.
//!
//! Remplace l'ancien serveur Node/Express : mêmes routes `/api`, même base
//! PostgreSQL (le schéma existant est repris tel quel puis complété au
//! démarrage), mêmes sessions (cookie `connect.sid` compatible) et même
//! chiffrement des jetons. Le frontend React compilé est servi depuis
//! `dist/public`.

mod auth;
mod config;
mod crypto;
mod db;
mod error;
mod extract;
mod http;
mod migrate;
mod public_url;
mod routes;
mod services;
mod state;
mod time;
mod upload;

use std::net::SocketAddr;

use anyhow::Context;
use tracing_subscriber::EnvFilter;

use crate::config::Config;
use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,tower_http=warn,hyper=warn")),
        )
        .with_target(false)
        .init();

    let config = Config::from_env()?;
    crypto::init(&config);

    let pool = db::connect(&config.database_url)
        .await
        .context("connexion à PostgreSQL impossible")?;

    migrate::run(&pool).await;

    let state = AppState::new(config, pool)?;

    auth::ensure_admin_user_exists(&state).await?;
    services::audio::fix_audio_track_encoding(&state).await;

    let app = routes::router(state.clone());

    let addr = SocketAddr::from(([0, 0, 0, 0], state.config.port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("impossible d'écouter sur {addr}"))?;
    tracing::info!("serving on port {}", state.config.port);

    // Tâches de fond : publications programmées, crons (jetons, statistiques,
    // purge, suivi TikTok) et file des rendus de Reels. La file démarre une
    // fois le serveur à l'écoute : les rendus lisent des fichiers servis ici.
    services::scheduler::start(state.clone());
    services::cron::start(state.clone());
    services::reels::start(state.clone());

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            sig.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("arrêt demandé, fermeture du serveur");
}
