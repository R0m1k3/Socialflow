//! Tâches périodiques (suivi TikTok, jetons, statistiques, purge des médias,
//! sessions expirées).
//!
//! Les horaires sont ceux de l'ancien `cron.ts` (node-cron), évalués en UTC,
//! l'heure du conteneur. Une boucle se réveille au début de chaque minute et
//! lance les tâches dont l'expression correspond.

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use chrono::{DateTime, Duration, Timelike, Utc};

use crate::services::{analytics, media_purge, tiktok, token_manager};
use crate::state::AppState;

/// Expression cron à cinq champs ; seuls les minutes et les heures peuvent
/// être restreintes (jour, mois et jour de semaine valent `*`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CronSpec {
    minutes: u64,
    hours: u32,
}

/// Champ cron (`*`, `*/n`, `a`, `a-b`, `a-b/n`, listes séparées par des virgules)
/// en masque de bits sur `0..=max`.
fn parse_field(field: &str, max: u32) -> Option<u64> {
    let mut mask = 0u64;
    for item in field.split(',') {
        let (range, step) = match item.split_once('/') {
            Some((range, step)) => (range, step.parse::<u32>().ok().filter(|s| *s > 0)?),
            None => (item, 1),
        };
        let (start, end) = if range == "*" {
            (0, max)
        } else if let Some((a, b)) = range.split_once('-') {
            (a.parse().ok()?, b.parse().ok()?)
        } else {
            let value: u32 = range.parse().ok()?;
            // `5/10` : de 5 jusqu'au maximum, comme cron
            (value, if item.contains('/') { max } else { value })
        };
        if start > end || end > max {
            return None;
        }
        let mut value = start;
        while value <= end {
            mask |= 1 << value;
            value += step;
        }
    }
    Some(mask)
}

impl CronSpec {
    pub fn parse(expression: &str) -> Option<Self> {
        let fields: Vec<&str> = expression.split_whitespace().collect();
        let [minute, hour, day, month, weekday] = fields.as_slice() else {
            return None;
        };
        if [day, month, weekday].iter().any(|f| **f != "*") {
            return None;
        }
        Some(Self {
            minutes: parse_field(minute, 59)?,
            hours: u32::try_from(parse_field(hour, 23)?).ok()?,
        })
    }

    pub fn matches(&self, minute: u32, hour: u32) -> bool {
        minute < 60
            && hour < 24
            && self.minutes & (1 << minute) != 0
            && self.hours & (1 << hour) != 0
    }

    pub fn matches_time(&self, time: DateTime<Utc>) -> bool {
        self.matches(time.minute(), time.hour())
    }
}

/// Début de la minute suivant `now`.
fn next_minute(now: DateTime<Utc>) -> DateTime<Utc> {
    let truncated = now
        .with_second(0)
        .and_then(|t| t.with_nanosecond(0))
        .unwrap_or(now);
    truncated + Duration::minutes(1)
}

/// Attend le début de la minute suivante et renvoie l'instant visé.
pub async fn sleep_until_next_minute() -> DateTime<Utc> {
    let now = Utc::now();
    let next = next_minute(now);
    if let Ok(wait) = (next - now).to_std() {
        tokio::time::sleep(wait).await;
    }
    next
}

/// Libère le verrou d'une tâche, même si elle panique.
struct RunningGuard(Arc<AtomicBool>);

impl Drop for RunningGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// Lance une exécution de tâche, sauf si la précédente n'est pas terminée
/// (évite par exemple de publier deux fois le même post).
pub fn spawn_guarded<F>(running: &Arc<AtomicBool>, name: &'static str, task: F)
where
    F: Future<Output = ()> + Send + 'static,
{
    if running.swap(true, Ordering::SeqCst) {
        tracing::warn!("[Cron] {name} : exécution précédente encore en cours, passage ignoré.");
        return;
    }
    let guard = RunningGuard(running.clone());
    tokio::spawn(async move {
        let _guard = guard;
        task.await;
    });
}

type JobFn = fn(AppState) -> std::pin::Pin<Box<dyn Future<Output = ()> + Send>>;

struct Job {
    name: &'static str,
    spec: CronSpec,
    run: JobFn,
    running: Arc<AtomicBool>,
}

impl Job {
    fn new(name: &'static str, expression: &str, run: JobFn) -> Self {
        Self {
            name,
            spec: CronSpec::parse(expression).expect("expression cron valide"),
            run,
            running: Arc::new(AtomicBool::new(false)),
        }
    }
}

async fn tiktok_status_sync(state: AppState) {
    if let Err(error) = tiktok::sync_pending_publications(&state).await {
        tracing::error!("[Cron] TikTok publish status sync failed: {error:#}");
    }
}

async fn token_check(state: AppState) {
    tracing::info!("[Cron] Running token check...");
    let results = token_manager::check_and_refresh_tokens(&state).await;
    let renewed = results.iter().filter(|r| r.renewed).count();
    let failing = results
        .iter()
        .filter(|r| r.status == "expired" || r.status == "error")
        .count();
    tracing::info!(
        "[Cron] Token check done: {} contrôlés, {renewed} renouvelés, {failing} en échec.",
        results.len()
    );
}

async fn analytics_sync(state: AppState) {
    tracing::info!("[Cron] Running analytics sync for all pages...");
    if let Err(error) = analytics::sync_all_pages(&state).await {
        tracing::error!("[Cron] Analytics sync failed: {error:#}");
    }
}

async fn media_purge_job(state: AppState) {
    tracing::info!("[Cron] Running daily media purge check...");
    if let Err(error) = media_purge::purge_old_media(&state).await {
        tracing::error!("[Cron] Media purge check failed: {error:#}");
    }
}

async fn session_prune(state: AppState) {
    crate::auth::prune_sessions(&state).await;
}

pub fn start(state: AppState) {
    let jobs = vec![
        // Toutes les 2 minutes — suivi des publications TikTok (API asynchrone)
        Job::new("TikTok publish status", "*/2 * * * *", |s| {
            Box::pin(tiktok_status_sync(s))
        }),
        // Deux fois par jour (00:00 et 12:00) — contrôle et renouvellement des jetons.
        // Un jeton révoqué par Meta ne prévient pas : passer deux fois par jour
        // réduit d'autant la fenêtre pendant laquelle une publication échouerait.
        Job::new("Token refresh", "0 0,12 * * *", |s| {
            Box::pin(token_check(s))
        }),
        // Deux fois par jour (08:00 et 20:00) — statistiques de toutes les pages
        Job::new("Analytics sync", "0 8,20 * * *", |s| {
            Box::pin(analytics_sync(s))
        }),
        // Tous les jours à 03:00 — purge des anciens médias
        Job::new("Media purge", "0 3 * * *", |s| Box::pin(media_purge_job(s))),
        // Toutes les heures — suppression des sessions expirées
        Job::new("Session cleanup", "0 * * * *", |s| {
            Box::pin(session_prune(s))
        }),
    ];

    tracing::info!("[Cron] TikTok publish status job scheduled (*/2 * * * *).");
    tracing::info!("[Cron] Token refresh job scheduled (0 0,12 * * *).");
    tracing::info!("[Cron] Analytics sync job scheduled (0 8,20 * * *).");
    tracing::info!("[Cron] Media purge job scheduled (0 3 * * *).");
    tracing::info!("[Cron] Session cleanup job scheduled (0 * * * *).");

    tokio::spawn(async move {
        loop {
            let tick = sleep_until_next_minute().await;
            for job in &jobs {
                if job.spec.matches_time(tick) {
                    spawn_guarded(&job.running, job.name, (job.run)(state.clone()));
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn every_two_minutes() {
        let spec = CronSpec::parse("*/2 * * * *").unwrap();
        assert!(spec.matches(0, 0));
        assert!(spec.matches(58, 13));
        assert!(!spec.matches(1, 0));
        assert!(!spec.matches(59, 23));
    }

    #[test]
    fn fixed_hours() {
        let spec = CronSpec::parse("0 0,12 * * *").unwrap();
        assert!(spec.matches(0, 0));
        assert!(spec.matches(0, 12));
        assert!(!spec.matches(1, 12));
        assert!(!spec.matches(0, 8));
        let spec = CronSpec::parse("0 8,20 * * *").unwrap();
        assert!(spec.matches(0, 20) && spec.matches(0, 8) && !spec.matches(0, 9));
        let spec = CronSpec::parse("0 3 * * *").unwrap();
        assert!(spec.matches(0, 3) && !spec.matches(30, 3) && !spec.matches(0, 15));
        let spec = CronSpec::parse("0 * * * *").unwrap();
        assert!((0..24).all(|h| spec.matches(0, h)) && !spec.matches(1, 5));
        let spec = CronSpec::parse("* * * * *").unwrap();
        assert!(spec.matches(17, 9));
    }

    #[test]
    fn ranges_and_invalid_expressions() {
        let spec = CronSpec::parse("10-20/5 1-3 * * *").unwrap();
        assert!(
            spec.matches(15, 2)
                && spec.matches(20, 3)
                && !spec.matches(16, 2)
                && !spec.matches(15, 4)
        );
        assert!(CronSpec::parse("0 0 1 * *").is_none());
        assert!(CronSpec::parse("60 * * * *").is_none());
        assert!(CronSpec::parse("*/0 * * * *").is_none());
        assert!(CronSpec::parse("* * * *").is_none());
    }

    #[test]
    fn next_minute_is_aligned() {
        let now = Utc.with_ymd_and_hms(2026, 10, 12, 11, 59, 42).unwrap();
        assert_eq!(
            next_minute(now),
            Utc.with_ymd_and_hms(2026, 10, 12, 12, 0, 0).unwrap()
        );
        let exact = Utc.with_ymd_and_hms(2026, 10, 12, 12, 0, 0).unwrap();
        assert_eq!(
            next_minute(exact),
            Utc.with_ymd_and_hms(2026, 10, 12, 12, 1, 0).unwrap()
        );
    }

    #[tokio::test]
    async fn guard_skips_overlapping_runs() {
        let running = Arc::new(AtomicBool::new(false));
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        spawn_guarded(&running, "test", async move {
            let _ = rx.await;
        });
        assert!(running.load(Ordering::SeqCst));
        // Deuxième lancement ignoré tant que le premier tourne
        spawn_guarded(&running, "test", async {
            panic!("ne doit pas s'exécuter")
        });
        tx.send(()).unwrap();
        for _ in 0..100 {
            if !running.load(Ordering::SeqCst) {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(!running.load(Ordering::SeqCst));
    }
}
