//! File d'attente persistante des rendus de Reels.
//!
//! Chaque job est une ligne de `reel_jobs` :
//!  - le worker la réserve atomiquement (`FOR UPDATE SKIP LOCKED`), ce qui
//!    exclut tout double traitement, même avec plusieurs instances ;
//!  - un battement de cœur est écrit pendant le rendu ; au démarrage, les jobs
//!    dont le cœur ne bat plus sont remis en file (ou échouent après
//!    `MAX_ATTEMPTS` tentatives).

use std::time::Duration;

use serde_json::Value;

use crate::db::ReelJob;
use crate::state::AppState;
use crate::time::Ts;

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);
/// Au-delà, un job « processing » est considéré comme orphelin.
const STALE_AFTER_MS: i64 = 2 * 60_000;
const POLL_INTERVAL: Duration = Duration::from_secs(10);
const MAX_ATTEMPTS: i32 = 2;

/// Outils fournis à un traitement pour rendre compte de son avancement.
pub struct JobContext {
    pub state: AppState,
    pub job: ReelJob,
}

impl JobContext {
    pub async fn progress(&self, progress: i32, step: &str) -> anyhow::Result<()> {
        update_job(
            &self.state,
            &self.job,
            JobPatch {
                progress: Some(progress),
                step: Some(step.to_string()),
                ..Default::default()
            },
        )
        .await
    }
}

/// Champs modifiés d'un job (les `None` ne sont pas écrits).
#[derive(Debug, Default)]
struct JobPatch {
    status: Option<&'static str>,
    progress: Option<i32>,
    step: Option<String>,
    result: Option<Value>,
    error: Option<String>,
}

/// Ajoute un job à la file et réveille le worker.
pub async fn enqueue_reel_job(
    state: &AppState,
    kind: &str,
    user_id: &str,
    post_id: Option<&str>,
    params: Value,
) -> Result<ReelJob, sqlx::Error> {
    let job: ReelJob = sqlx::query_as(
        "INSERT INTO reel_jobs (kind, user_id, post_id, params) VALUES ($1, $2, $3, $4) RETURNING *",
    )
    .bind(kind)
    .bind(user_id)
    .bind(post_id)
    .bind(params)
    .fetch_one(&state.db.pool)
    .await?;

    if let Some(post_id) = &job.post_id {
        sync_post(state, post_id, "pending", Some(0), None).await?;
    }

    state.reel_queue.notify_one();
    Ok(job)
}

pub async fn get_reel_job(state: &AppState, id: &str) -> Result<Option<ReelJob>, sqlx::Error> {
    sqlx::query_as("SELECT * FROM reel_jobs WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db.pool)
        .await
}

/// Nombre de jobs qui passeront avant un nouveau job (pour informer l'utilisateur).
pub async fn count_active_reel_jobs(state: &AppState) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT count(*)::bigint FROM reel_jobs WHERE status IN ('pending', 'processing')",
    )
    .fetch_one(&state.db.pool)
    .await
}

/// Démarre le worker : récupère les jobs orphelins puis traite la file.
pub fn start(state: AppState) {
    tokio::spawn(async move {
        if let Err(error) = recover(&state).await {
            tracing::error!("❌ [ReelQueue] Récupération des jobs orphelins impossible : {error}");
        }
        tracing::info!("🎬 [ReelQueue] Worker démarré (traitements : video)");

        loop {
            if let Err(error) = drain(&state).await {
                tracing::error!("❌ [ReelQueue] Erreur de la boucle : {error}");
            }
            // Réveil à l'ajout d'un job, ou toutes les 10 s
            tokio::select! {
                _ = state.reel_queue.notified() => {}
                _ = tokio::time::sleep(POLL_INTERVAL) => {}
            }
        }
    });
}

async fn recover(state: &AppState) -> anyhow::Result<()> {
    recover_stale_jobs(state).await?;
    fail_legacy_stuck_posts(state).await?;
    Ok(())
}

async fn drain(state: &AppState) -> anyhow::Result<()> {
    while let Some(job) = claim_next_job(state).await? {
        run_job(state, job).await;
    }
    Ok(())
}

async fn claim_next_job(state: &AppState) -> Result<Option<ReelJob>, sqlx::Error> {
    let id: Option<String> = sqlx::query_scalar(
        r#"UPDATE reel_jobs
              SET status = 'processing',
                  attempts = attempts + 1,
                  heartbeat_at = now(),
                  updated_at = now(),
                  error = NULL
            WHERE id = (
              SELECT id FROM reel_jobs
               WHERE status = 'pending'
               ORDER BY created_at
               FOR UPDATE SKIP LOCKED
               LIMIT 1
            )
           RETURNING id"#,
    )
    .fetch_optional(&state.db.pool)
    .await?;
    match id {
        Some(id) => get_reel_job(state, &id).await,
        None => Ok(None),
    }
}

/// Message lisible d'une panique du traitement.
fn panic_message(error: tokio::task::JoinError) -> String {
    match error.try_into_panic() {
        Ok(payload) => payload
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| payload.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_else(|| "Erreur inattendue pendant le rendu".into()),
        Err(error) => error.to_string(),
    }
}

async fn run_job(state: &AppState, job: ReelJob) {
    tracing::info!(
        "🎬 [ReelQueue] Job {} ({}), tentative {}",
        job.id,
        job.kind,
        job.attempts
    );

    let heartbeat = {
        let state = state.clone();
        let id = job.id.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(HEARTBEAT_INTERVAL);
            interval.tick().await;
            loop {
                interval.tick().await;
                if let Err(error) =
                    sqlx::query("UPDATE reel_jobs SET heartbeat_at = $2 WHERE id = $1")
                        .bind(&id)
                        .bind(Ts::now())
                        .execute(&state.db.pool)
                        .await
                {
                    tracing::warn!("⚠️ [ReelQueue] Heartbeat {id} : {error}");
                }
            }
        })
    };

    // Le traitement tourne dans sa propre tâche : une panique fait échouer le
    // job sans arrêter le worker.
    let ctx = JobContext {
        state: state.clone(),
        job: job.clone(),
    };
    let outcome = tokio::spawn(async move {
        if ctx.job.kind != "video" {
            anyhow::bail!(
                "Aucun traitement enregistré pour les jobs « {} »",
                ctx.job.kind
            );
        }
        if let Some(post_id) = &ctx.job.post_id {
            sync_post(&ctx.state, post_id, "processing", Some(0), None).await?;
        }
        super::pipeline::run_video_reel_job(&ctx).await
    })
    .await;

    let outcome = match outcome {
        Ok(result) => result.map_err(|e| e.to_string()),
        Err(join_error) => Err(panic_message(join_error)),
    };

    match outcome {
        Ok(result) => {
            let patch = JobPatch {
                status: Some("completed"),
                progress: Some(100),
                step: Some("done".into()),
                result: Some(result),
                error: None,
            };
            match update_job(state, &job, patch).await {
                Ok(()) => tracing::info!("✅ [ReelQueue] Job {} terminé", job.id),
                Err(error) => tracing::error!(
                    "⚠️ [ReelQueue] Statut final non enregistré pour {} : {error}",
                    job.id
                ),
            }
        }
        Err(message) => {
            tracing::error!("❌ [ReelQueue] Job {} en échec : {message}", job.id);
            let patch = JobPatch {
                status: Some("failed"),
                error: Some(message),
                ..Default::default()
            };
            if let Err(error) = update_job(state, &job, patch).await {
                tracing::error!(
                    "⚠️ [ReelQueue] Statut d'échec non enregistré pour {} : {error}",
                    job.id
                );
            }
        }
    }
    heartbeat.abort();
}

async fn update_job(state: &AppState, job: &ReelJob, patch: JobPatch) -> anyhow::Result<()> {
    let now = Ts::now();
    let mut qb = sqlx::QueryBuilder::<sqlx::Postgres>::new("UPDATE reel_jobs SET heartbeat_at = ");
    qb.push_bind(now).push(", updated_at = ").push_bind(now);
    if let Some(status) = patch.status {
        qb.push(", status = ").push_bind(status);
    }
    if let Some(progress) = patch.progress {
        qb.push(", progress = ").push_bind(progress);
    }
    if let Some(step) = &patch.step {
        qb.push(", step = ").push_bind(step.clone());
    }
    if let Some(result) = &patch.result {
        qb.push(", result = ").push_bind(result.clone());
    }
    if let Some(error) = &patch.error {
        qb.push(", error = ").push_bind(error.clone());
    }
    qb.push(" WHERE id = ").push_bind(job.id.clone());
    qb.build().execute(&state.db.pool).await?;

    if let Some(post_id) = &job.post_id {
        let status = patch.status.unwrap_or("processing");
        let progress = if patch.status == Some("failed") {
            Some(0)
        } else {
            patch.progress
        };
        sync_post(state, post_id, status, progress, patch.error.as_deref()).await?;
    }
    Ok(())
}

/// Reflète l'état du job sur le post : l'interface (`/reels/ongoing`) lit les
/// colonnes `generation_*` du post.
async fn sync_post(
    state: &AppState,
    post_id: &str,
    status: &str,
    progress: Option<i32>,
    error: Option<&str>,
) -> Result<(), sqlx::Error> {
    let mut qb = sqlx::QueryBuilder::<sqlx::Postgres>::new("UPDATE posts SET generation_status = ");
    qb.push_bind(status.to_string())
        .push(", updated_at = ")
        .push_bind(Ts::now());
    if let Some(progress) = progress {
        qb.push(", generation_progress = ").push_bind(progress);
    }
    if let Some(error) = error {
        qb.push(", generation_error = ")
            .push_bind(error.to_string());
    }
    if status == "failed" {
        qb.push(", status = 'failed'::post_status");
    }
    qb.push(" WHERE id = ").push_bind(post_id.to_string());
    qb.build().execute(&state.db.pool).await?;
    Ok(())
}

/// Remet en file les jobs interrompus (serveur arrêté pendant un rendu), ou
/// les fait échouer s'ils ont déjà épuisé leurs tentatives : un job qui fait
/// tomber le serveur ne doit pas le faire tomber en boucle.
async fn recover_stale_jobs(state: &AppState) -> anyhow::Result<()> {
    let stale_before = Ts::now().add(chrono::Duration::milliseconds(-STALE_AFTER_MS));
    let stale: Vec<ReelJob> = sqlx::query_as(
        "SELECT * FROM reel_jobs WHERE status = 'processing' AND (heartbeat_at IS NULL OR heartbeat_at < $1)",
    )
    .bind(stale_before)
    .fetch_all(&state.db.pool)
    .await?;

    for job in stale {
        if job.attempts >= MAX_ATTEMPTS {
            tracing::warn!(
                "⚠️ [ReelQueue] Job {} abandonné après {} tentatives",
                job.id,
                job.attempts
            );
            update_job(
                state,
                &job,
                JobPatch {
                    status: Some("failed"),
                    error: Some(
                        "Le rendu a été interrompu à plusieurs reprises (redémarrage du serveur)."
                            .into(),
                    ),
                    ..Default::default()
                },
            )
            .await?;
        } else {
            tracing::warn!("♻️ [ReelQueue] Job {} interrompu, remis en file", job.id);
            sqlx::query(
                "UPDATE reel_jobs SET status = 'pending', step = NULL, progress = 0, updated_at = $2 WHERE id = $1",
            )
            .bind(&job.id)
            .bind(Ts::now())
            .execute(&state.db.pool)
            .await?;
            if let Some(post_id) = &job.post_id {
                sync_post(state, post_id, "pending", Some(0), None).await?;
            }
        }
    }
    Ok(())
}

/// Posts laissés « processing »/« pending » par l'ancienne file (avant
/// reel_jobs) : aucun job ne peut les reprendre. On les marque en échec pour
/// que l'utilisateur relance.
async fn fail_legacy_stuck_posts(state: &AppState) -> Result<(), sqlx::Error> {
    let result = sqlx::query(
        r#"UPDATE posts
              SET generation_status = 'failed',
                  generation_progress = 0,
                  generation_error = 'Génération interrompue, veuillez relancer le Reel.',
                  status = 'failed',
                  updated_at = now()
            WHERE generation_status IN ('processing', 'pending')
              AND NOT EXISTS (SELECT 1 FROM reel_jobs j WHERE j.post_id = posts.id)"#,
    )
    .execute(&state.db.pool)
    .await?;
    if result.rows_affected() > 0 {
        tracing::warn!(
            "⚠️ [ReelQueue] {} Reel(s) de l'ancienne file marqués en échec",
            result.rows_affected()
        );
    }
    Ok(())
}
