import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";

const API_KEY = "cle-de-test";

const mocks = vi.hoisted(() => ({
  storage: {
    getAppConfig: vi.fn(),
    getAllUsers: vi.fn(),
    getUser: vi.fn(),
    getSocialPage: vi.fn(),
    getMediaById: vi.fn(),
    createMedia: vi.fn(),
    createPost: vi.fn(),
    createScheduledPost: vi.fn(),
  },
  insertValues: vi.fn(),
  uploadMedia: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: mocks.storage }));
vi.mock("../db", () => ({ db: { insert: () => ({ values: mocks.insertValues }) } }));
vi.mock("../services/minio", () => ({ minioService: { uploadMedia: mocks.uploadMedia } }));

const { externalRouter } = await import("./external");

// Un PNG valide (signature) de la taille voulue
function png(size: number): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([header, Buffer.alloc(Math.max(0, size - header.length))]);
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  // Même montage que server/index.ts : parseur large pour /api/v1, puis global
  const app = express();
  app.use("/api/v1", express.json({ limit: "15mb" }));
  app.use(express.json());
  app.use("/api/v1", externalRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storage.getAppConfig.mockResolvedValue({ externalApiKey: API_KEY });
  mocks.storage.getAllUsers.mockResolvedValue([{ id: "admin-1", role: "admin" }]);
  mocks.storage.getSocialPage.mockImplementation(async (id: string) =>
    id === "page-1" ? { id, pageName: "Ma Page" } : undefined
  );
  mocks.uploadMedia.mockImplementation(async (_buffer: Buffer, fileName: string) => ({
    publicId: `media/${fileName}`,
    originalUrl: `/uploads/media/${fileName}`,
    facebookFeedUrl: null,
    instagramFeedUrl: null,
    instagramStoryUrl: null,
  }));
  mocks.storage.createMedia.mockImplementation(async (data: Record<string, unknown>) => ({ id: "media-1", ...data }));
  mocks.storage.createPost.mockImplementation(async (data: Record<string, unknown>) => ({ id: "post-1", ...data }));
  mocks.storage.createScheduledPost.mockImplementation(async (data: Record<string, unknown>) => ({ id: `sp-${data.postType}`, ...data }));
});

function form(fields: Record<string, string>, file?: { field: string; buffer: Buffer; name: string; type?: string }) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  if (file) body.append(file.field, new Blob([file.buffer], { type: file.type ?? "image/png" }), file.name);
  return body;
}

describe("POST /api/v1/media", () => {
  it("refuse sans clé API", async () => {
    const res = await fetch(`${baseUrl}/media`, { method: "POST", body: form({}, { field: "file", buffer: png(100), name: "a.png" }) });
    expect(res.status).toBe(401);
    expect(mocks.uploadMedia).not.toHaveBeenCalled();
  });

  it("accepte un fichier multipart et le range dans la médiathèque de l'admin", async () => {
    const res = await fetch(`${baseUrl}/media`, {
      method: "POST",
      headers: { "X-API-Key": API_KEY },
      body: form({}, { field: "file", buffer: png(3 * 1024 * 1024), name: "galette.png", type: "application/octet-stream" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ id: "media-1", type: "image", fileSize: 3 * 1024 * 1024 });
    expect(body.url).toMatch(/^\/uploads\/media\/external-\d+\.png$/);
    expect(mocks.storage.createMedia).toHaveBeenCalledWith(expect.objectContaining({ userId: "admin-1" }));
  });

  it("accepte une image base64 bien au-delà de 100 KB", async () => {
    const res = await fetch(`${baseUrl}/media`, {
      method: "POST",
      headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ imageData: `data:image/png;base64,${png(2 * 1024 * 1024).toString("base64")}` }),
    });
    expect(res.status).toBe(201);
    expect(mocks.uploadMedia.mock.calls[0][0].length).toBe(2 * 1024 * 1024);
  });

  it("renvoie 413 au-delà de 10 MB", async () => {
    const res = await fetch(`${baseUrl}/media`, {
      method: "POST",
      headers: { "X-API-Key": API_KEY },
      body: form({}, { field: "file", buffer: png(10 * 1024 * 1024 + 1), name: "enorme.png" }),
    });
    expect(res.status).toBe(413);
    expect(mocks.uploadMedia).not.toHaveBeenCalled();
  });

  it("refuse un fichier qui n'est pas une image", async () => {
    const res = await fetch(`${baseUrl}/media`, {
      method: "POST",
      headers: { "X-API-Key": API_KEY },
      body: form({}, { field: "file", buffer: Buffer.from("<html></html>"), name: "page.png" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Format/);
  });

  it("refuse une requête sans image", async () => {
    const res = await fetch(`${baseUrl}/media`, {
      method: "POST",
      headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/publish", () => {
  it("programme un post avec un mediaId déjà envoyé", async () => {
    mocks.storage.getMediaById.mockResolvedValue({ id: "media-9", originalUrl: "/uploads/media/x.png", type: "image" });
    const res = await fetch(`${baseUrl}/publish`, {
      method: "POST",
      headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Bonjour", mediaId: "media-9", pageIds: ["page-1"], scheduledAt: "2026-10-05T12:15:00+02:00", postType: "both" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.post.media).toEqual({ id: "media-9", url: "/uploads/media/x.png" });
    expect(body.post.pages).toHaveLength(2);
    expect(mocks.insertValues).toHaveBeenCalledWith({ postId: "post-1", mediaId: "media-9", displayOrder: 0 });
    expect(mocks.uploadMedia).not.toHaveBeenCalled();
  });

  it("accepte l'image en multipart avec pageIds en texte", async () => {
    const res = await fetch(`${baseUrl}/publish`, {
      method: "POST",
      headers: { "X-API-Key": API_KEY },
      body: form({ content: "Bonjour", pageIds: "page-1", scheduledAt: "2026-10-05T10:15:00Z" }, { field: "image", buffer: png(500_000), name: "chaise.png" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.post.media.id).toBe("media-1");
    expect(body.post.pages).toEqual([{ pageId: "page-1", pageName: "Ma Page", scheduledPostId: "sp-feed" }]);
  });

  it("refuse un mediaId inconnu sans créer de post", async () => {
    mocks.storage.getMediaById.mockResolvedValue(undefined);
    const res = await fetch(`${baseUrl}/publish`, {
      method: "POST",
      headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Bonjour", mediaId: "absent", pageIds: ["page-1"] }),
    });
    expect(res.status).toBe(400);
    expect(mocks.storage.createPost).not.toHaveBeenCalled();
  });

  it("refuse plusieurs sources d'image", async () => {
    const res = await fetch(`${baseUrl}/publish`, {
      method: "POST",
      headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Bonjour", mediaId: "media-9", imageUrl: "https://exemple.fr/a.png", pageIds: ["page-1"] }),
    });
    expect(res.status).toBe(400);
    expect(mocks.storage.createPost).not.toHaveBeenCalled();
  });

  it("exige une image pour une story", async () => {
    const res = await fetch(`${baseUrl}/publish`, {
      method: "POST",
      headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Bonjour", pageIds: ["page-1"], postType: "story" }),
    });
    expect(res.status).toBe(400);
  });
});
