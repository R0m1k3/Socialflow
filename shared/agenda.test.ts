import { describe, expect, it } from "vitest";
import {
  agendaItemFromScheduledPost,
  agendaItemsFromReelJob,
  busyHours,
  conflictsFor,
  groupByDay,
  groupByPage,
  type AgendaItem,
  type AgendaPage,
} from "./agenda";

const storeA: AgendaPage = { id: "a", pageName: "Magasin A", platform: "facebook", avatarUrl: null };
const storeB: AgendaPage = { id: "b", pageName: "Magasin B", platform: "tiktok", avatarUrl: null };
const pagesById = new Map([[storeA.id, storeA], [storeB.id, storeB]]);

function item(overrides: Partial<AgendaItem>): AgendaItem {
  return {
    id: "x",
    postId: "p",
    pageId: "a",
    pageName: "Magasin A",
    platform: "facebook",
    avatarUrl: null,
    postType: "reel",
    scheduledAt: new Date(2026, 9, 14, 18, 0).toISOString(),
    status: "scheduled",
    preview: "",
    ...overrides,
  };
}

describe("agendaItemFromScheduledPost", () => {
  it("déduit le statut des colonnes de publication", () => {
    const base = { id: "s", postId: "p", pageId: "a", postType: "reel", scheduledAt: new Date(), page: storeA, post: { content: "Promo" } };
    expect(agendaItemFromScheduledPost({ ...base, publishedAt: null, error: null }).status).toBe("scheduled");
    expect(agendaItemFromScheduledPost({ ...base, publishedAt: new Date(), error: null }).status).toBe("published");
    expect(agendaItemFromScheduledPost({ ...base, publishedAt: null, error: "boom" }).status).toBe("failed");
  });
});

describe("agendaItemsFromReelJob", () => {
  const when = new Date(2026, 9, 14, 18, 0);

  it("crée une entrée « en montage » par magasin visible", () => {
    const items = agendaItemsFromReelJob(
      { id: "j", postId: "p", createdAt: new Date(), params: { pageIds: ["a", "b", "inconnu"], scheduledFor: when.toISOString() } },
      pagesById,
    );
    expect(items.map((i) => i.pageId)).toEqual(["a", "b"]);
    expect(items.every((i) => i.status === "rendering" && i.postType === "reel")).toBe(true);
    expect(items[0].scheduledAt).toBe(when.toISOString());
  });

  it("place un Reel sans date à sa création et respecte la période", () => {
    const createdAt = new Date(2026, 9, 12, 9, 0);
    const job = { id: "j", postId: "p", createdAt, params: { pageIds: ["a"] } };
    expect(agendaItemsFromReelJob(job, pagesById)[0].scheduledAt).toBe(createdAt.toISOString());
    expect(agendaItemsFromReelJob(job, pagesById, new Date(2026, 9, 13))).toEqual([]);
  });
});

describe("regroupements", () => {
  const items = [
    item({ id: "1", pageId: "b", pageName: "Magasin B", scheduledAt: new Date(2026, 9, 14, 12, 0).toISOString() }),
    item({ id: "2", pageId: "a", scheduledAt: new Date(2026, 9, 14, 18, 0).toISOString() }),
    item({ id: "3", pageId: "a", scheduledAt: new Date(2026, 9, 14, 18, 30).toISOString(), status: "failed" }),
    item({ id: "4", pageId: "a", scheduledAt: new Date(2026, 9, 15, 8, 0).toISOString() }),
  ];

  it("range les publications par jour local", () => {
    const days = groupByDay(items);
    expect(days.get("2026-10-14")?.map((i) => i.id)).toEqual(["1", "2", "3"]);
    expect(days.get("2026-10-15")?.map((i) => i.id)).toEqual(["4"]);
  });

  it("met les magasins choisis en tête", () => {
    const groups = groupByPage(groupByDay(items).get("2026-10-14")!, ["b"]);
    expect(groups.map((g) => [g.page.id, g.selected])).toEqual([["b", true], ["a", false]]);
  });

  it("ne signale que les magasins choisis et ignore les échecs", () => {
    const day = groupByDay(items).get("2026-10-14")!;
    expect(conflictsFor(day, ["a"]).map((i) => i.id)).toEqual(["2"]);
    expect(conflictsFor(day, [])).toEqual([]);
    expect(Array.from(busyHours(day, ["a", "b"]).entries())).toEqual([[12, 1], [18, 1]]);
  });
});
