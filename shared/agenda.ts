/**
 * Agenda des publications : ce qui est déjà prévu, jour par jour et magasin par
 * magasin, pour aider à choisir la date d'un nouveau post ou Reel.
 *
 * Il réunit les publications planifiées (`scheduled_posts`) et les Reels encore
 * en montage, qui n'ont pas de ligne `scheduled_posts` avant la fin du rendu.
 */

export type AgendaStatus = "scheduled" | "rendering" | "published" | "failed";

export interface AgendaItem {
  id: string;
  postId: string;
  pageId: string;
  pageName: string;
  platform: string;
  avatarUrl: string | null;
  postType: string;
  /** ISO 8601. */
  scheduledAt: string;
  status: AgendaStatus;
  preview: string;
}

export interface AgendaPage {
  id: string;
  pageName: string;
  platform: string;
  avatarUrl: string | null;
}

const PREVIEW_LENGTH = 80;

function preview(text: string | null | undefined): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat;
}

function inRange(date: Date, start?: Date, end?: Date): boolean {
  return (!start || date >= start) && (!end || date <= end);
}

/** Statut d'une publication planifiée : elle n'a pas de colonne dédiée. */
export function scheduledPostStatus(row: { publishedAt: Date | string | null; error: string | null }): AgendaStatus {
  if (row.publishedAt) return "published";
  if (row.error) return "failed";
  return "scheduled";
}

export function agendaItemFromScheduledPost(row: {
  id: string;
  postId: string;
  pageId: string;
  postType: string;
  scheduledAt: Date | string;
  publishedAt: Date | string | null;
  error: string | null;
  post?: { content: string | null } | null;
  page?: AgendaPage | null;
}): AgendaItem {
  return {
    id: row.id,
    postId: row.postId,
    pageId: row.pageId,
    pageName: row.page?.pageName ?? "Page supprimée",
    platform: row.page?.platform ?? "facebook",
    avatarUrl: row.page?.avatarUrl ?? null,
    postType: row.postType,
    scheduledAt: new Date(row.scheduledAt).toISOString(),
    status: scheduledPostStatus(row),
    preview: preview(row.post?.content),
  };
}

/**
 * Entrées d'un Reel en montage, une par page visée et visible de l'utilisateur.
 * Sans date demandée, il part dès la fin du rendu : on le place à sa création.
 */
export function agendaItemsFromReelJob(
  job: {
    id: string;
    postId: string | null;
    createdAt: Date | string;
    params: unknown;
    content?: string | null;
  },
  pagesById: Map<string, AgendaPage>,
  start?: Date,
  end?: Date,
): AgendaItem[] {
  if (!job.postId) return [];
  const params = (job.params ?? {}) as { pageIds?: unknown; scheduledFor?: unknown; description?: unknown; overlayText?: unknown };
  const pageIds = Array.isArray(params.pageIds) ? params.pageIds.filter((id): id is string => typeof id === "string") : [];

  const requested = typeof params.scheduledFor === "string" ? new Date(params.scheduledFor) : undefined;
  const when = requested && !Number.isNaN(requested.getTime()) ? requested : new Date(job.createdAt);
  if (!inRange(when, start, end)) return [];

  const text = job.content || (typeof params.description === "string" ? params.description : "")
    || (typeof params.overlayText === "string" ? params.overlayText : "");

  return pageIds.flatMap((pageId) => {
    const page = pagesById.get(pageId);
    if (!page) return [];
    return [{
      id: `${job.id}:${pageId}`,
      postId: job.postId!,
      pageId,
      pageName: page.pageName,
      platform: page.platform,
      avatarUrl: page.avatarUrl,
      postType: "reel",
      scheduledAt: when.toISOString(),
      status: "rendering" as const,
      preview: preview(text),
    }];
  });
}

/** Une publication en échec ne prend plus de place dans le planning. */
export function occupiesSlot(item: AgendaItem): boolean {
  return item.status !== "failed";
}

/** Clé `yyyy-MM-dd` du jour local. */
export function dayKey(date: Date | string): string {
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function groupByDay(items: AgendaItem[]): Map<string, AgendaItem[]> {
  const days = new Map<string, AgendaItem[]>();
  for (const item of items) {
    const key = dayKey(item.scheduledAt);
    const list = days.get(key);
    if (list) list.push(item);
    else days.set(key, [item]);
  }
  days.forEach((list) => list.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)));
  return days;
}

export interface PageAgenda {
  page: AgendaPage;
  selected: boolean;
  items: AgendaItem[];
}

/** Publications d'un jour regroupées par magasin, les magasins choisis en tête. */
export function groupByPage(items: AgendaItem[], selectedPageIds: string[] = []): PageAgenda[] {
  const selected = new Set(selectedPageIds);
  const groups = new Map<string, PageAgenda>();
  for (const item of items) {
    let group = groups.get(item.pageId);
    if (!group) {
      group = {
        page: { id: item.pageId, pageName: item.pageName, platform: item.platform, avatarUrl: item.avatarUrl },
        selected: selected.has(item.pageId),
        items: [],
      };
      groups.set(item.pageId, group);
    }
    group.items.push(item);
  }
  return Array.from(groups.values()).sort(
    (a, b) => Number(b.selected) - Number(a.selected) || a.page.pageName.localeCompare(b.page.pageName),
  );
}

/** Publications déjà prévues sur les magasins choisis, à signaler. */
export function conflictsFor(items: AgendaItem[], selectedPageIds: string[]): AgendaItem[] {
  const selected = new Set(selectedPageIds);
  return items.filter((item) => selected.has(item.pageId) && occupiesSlot(item));
}

/** Nombre de publications par heure locale sur les magasins choisis. */
export function busyHours(items: AgendaItem[], selectedPageIds: string[]): Map<number, number> {
  const hours = new Map<number, number>();
  for (const item of conflictsFor(items, selectedPageIds)) {
    const hour = new Date(item.scheduledAt).getHours();
    hours.set(hour, (hours.get(hour) ?? 0) + 1);
  }
  return hours;
}
