/**
 * File d'attente persistante des rendus de Reels.
 *
 * L'ancienne file comptait les posts « processing » pour décider de lancer un
 * rendu : un redémarrage pendant un job laissait ce compteur à 1 pour toujours
 * et bloquait tous les Reels suivants. Ici, chaque job est une ligne de
 * `reel_jobs` :
 *  - le worker la réserve atomiquement (`FOR UPDATE SKIP LOCKED`), ce qui exclut
 *    tout double traitement, même avec plusieurs instances ;
 *  - un battement de cœur est écrit pendant le rendu ; au démarrage, les jobs
 *    dont le cœur ne bat plus sont remis en file (ou échouent après
 *    MAX_ATTEMPTS tentatives).
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { posts, reelJobs, type ReelJob } from "@shared/schema";
import type { ReelJobKind, ReelJobStatus } from "@shared/reel";

const HEARTBEAT_INTERVAL_MS = 15_000;
/** Au-delà, un job « processing » est considéré comme orphelin. */
const STALE_AFTER_MS = 2 * 60_000;
const POLL_INTERVAL_MS = 10_000;
const MAX_ATTEMPTS = 2;

/** Outils fournis à un handler pour rendre compte de son avancement. */
export interface JobContext {
  job: ReelJob;
  progress(progress: number, step?: string): Promise<void>;
}

export type JobHandler = (ctx: JobContext) => Promise<unknown>;

const handlers = new Map<ReelJobKind, JobHandler>();
let running = false;
let started = false;
let pollTimer: NodeJS.Timeout | null = null;

export function registerReelJobHandler(kind: ReelJobKind, handler: JobHandler): void {
  handlers.set(kind, handler);
}

/** Ajoute un job à la file et réveille le worker. */
export async function enqueueReelJob(input: {
  kind: ReelJobKind;
  userId: string;
  postId?: string;
  params: unknown;
}): Promise<ReelJob> {
  const [job] = await db
    .insert(reelJobs)
    .values({
      kind: input.kind,
      userId: input.userId,
      postId: input.postId,
      params: input.params,
    })
    .returning();

  if (job.postId) {
    await syncPost(job.postId, "pending", 0);
  }

  kick();
  return job;
}

export async function getReelJob(id: string): Promise<ReelJob | undefined> {
  const [job] = await db.select().from(reelJobs).where(eq(reelJobs.id, id));
  return job;
}

/** Nombre de jobs qui passeront avant un nouveau job (utile pour informer l'utilisateur). */
export async function countActiveReelJobs(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reelJobs)
    .where(sql`${reelJobs.status} IN ('pending', 'processing')`);
  return row?.count ?? 0;
}

/**
 * Démarre le worker : récupère les jobs orphelins puis traite la file.
 * Idempotent.
 */
export async function startReelWorker(): Promise<void> {
  if (started) return;
  started = true;

  try {
    await recoverStaleJobs();
    await failLegacyStuckPosts();
  } catch (error) {
    console.error("❌ [ReelQueue] Récupération des jobs orphelins impossible :", error);
  }

  pollTimer = setInterval(kick, POLL_INTERVAL_MS);
  pollTimer.unref();
  kick();
}

/** Relance la boucle si elle est à l'arrêt. */
function kick(): void {
  if (!started || running) return;
  running = true;
  drain()
    .catch((error) => console.error("❌ [ReelQueue] Erreur de la boucle :", error))
    .finally(() => {
      running = false;
    });
}

async function drain(): Promise<void> {
  for (;;) {
    const job = await claimNextJob();
    if (!job) return;
    await runJob(job);
  }
}

async function claimNextJob(): Promise<ReelJob | undefined> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE reel_jobs
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
    RETURNING id
  `);
  const id = result.rows[0]?.id;
  return id ? getReelJob(id) : undefined;
}

async function runJob(job: ReelJob): Promise<void> {
  const handler = handlers.get(job.kind as ReelJobKind);
  console.log(`🎬 [ReelQueue] Job ${job.id} (${job.kind}), tentative ${job.attempts}`);

  const heartbeat = setInterval(() => {
    db.update(reelJobs)
      .set({ heartbeatAt: new Date() })
      .where(eq(reelJobs.id, job.id))
      .catch((error) => console.warn(`⚠️ [ReelQueue] Heartbeat ${job.id} :`, error));
  }, HEARTBEAT_INTERVAL_MS);

  const ctx: JobContext = {
    job,
    async progress(progress, step) {
      await updateJob(job, { progress, step });
    },
  };

  try {
    if (!handler) {
      throw new Error(`Aucun traitement enregistré pour les jobs « ${job.kind} »`);
    }
    if (job.postId) {
      await syncPost(job.postId, "processing", 0);
    }
    const result = await handler(ctx);
    await updateJob(job, { status: "completed", progress: 100, step: "done", result: result ?? null });
    console.log(`✅ [ReelQueue] Job ${job.id} terminé`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ [ReelQueue] Job ${job.id} en échec :`, error);
    await updateJob(job, { status: "failed", error: message }).catch((e) =>
      console.error(`⚠️ [ReelQueue] Statut d'échec non enregistré pour ${job.id} :`, e),
    );
  } finally {
    clearInterval(heartbeat);
  }
}

async function updateJob(
  job: ReelJob,
  patch: {
    status?: ReelJobStatus;
    progress?: number;
    step?: string;
    result?: unknown;
    error?: string;
  },
): Promise<void> {
  await db
    .update(reelJobs)
    .set({ ...patch, heartbeatAt: new Date(), updatedAt: new Date() })
    .where(eq(reelJobs.id, job.id));

  if (job.postId) {
    const status = patch.status ?? "processing";
    const progress = patch.status === "failed" ? 0 : patch.progress;
    await syncPost(job.postId, status, progress, patch.error);
  }
}

/**
 * Reflète l'état du job sur le post : l'interface (`/reels/ongoing`) lit les
 * colonnes `generation_*` du post.
 */
async function syncPost(
  postId: string,
  status: ReelJobStatus,
  progress?: number,
  error?: string,
): Promise<void> {
  const patch: Partial<typeof posts.$inferInsert> = {
    generationStatus: status,
    updatedAt: new Date(),
  };
  if (progress !== undefined) patch.generationProgress = progress;
  if (error !== undefined) patch.generationError = error;
  if (status === "failed") patch.status = "failed";
  await db.update(posts).set(patch).where(eq(posts.id, postId));
}

/**
 * Remet en file les jobs interrompus (serveur arrêté pendant un rendu), ou les
 * fait échouer s'ils ont déjà épuisé leurs tentatives : un job qui fait tomber
 * le serveur ne doit pas le faire tomber en boucle.
 */
async function recoverStaleJobs(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await db
    .select()
    .from(reelJobs)
    .where(
      and(
        eq(reelJobs.status, "processing"),
        sql`(${reelJobs.heartbeatAt} IS NULL OR ${reelJobs.heartbeatAt} < ${staleBefore})`,
      ),
    );

  for (const job of stale) {
    if (job.attempts >= MAX_ATTEMPTS) {
      console.warn(`⚠️ [ReelQueue] Job ${job.id} abandonné après ${job.attempts} tentatives`);
      await updateJob(job, {
        status: "failed",
        error: "Le rendu a été interrompu à plusieurs reprises (redémarrage du serveur).",
      });
    } else {
      console.warn(`♻️ [ReelQueue] Job ${job.id} interrompu, remis en file`);
      await db
        .update(reelJobs)
        .set({ status: "pending", step: null, progress: 0, updatedAt: new Date() })
        .where(eq(reelJobs.id, job.id));
      if (job.postId) await syncPost(job.postId, "pending", 0);
    }
  }
}

/**
 * Posts laissés « processing »/« pending » par l'ancienne file (avant
 * reel_jobs) : ils n'ont aucun job pour les reprendre et bloquaient l'affichage
 * des Reels en cours. On les marque en échec pour que l'utilisateur relance.
 */
async function failLegacyStuckPosts(): Promise<void> {
  const result = await db.execute(sql`
    UPDATE posts
       SET generation_status = 'failed',
           generation_progress = 0,
           generation_error = 'Génération interrompue, veuillez relancer le Reel.',
           status = 'failed',
           updated_at = now()
     WHERE generation_status IN ('processing', 'pending')
       AND NOT EXISTS (SELECT 1 FROM reel_jobs j WHERE j.post_id = posts.id)
  `);
  if (result.rowCount) {
    console.warn(`⚠️ [ReelQueue] ${result.rowCount} Reel(s) de l'ancienne file marqués en échec`);
  }
}
