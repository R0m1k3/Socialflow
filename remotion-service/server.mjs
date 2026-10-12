#!/usr/bin/env node
/**
 * Service de rendu Remotion des Reels SocialFlow.
 *
 * Le serveur principal (Rust) ne peut pas exécuter Remotion (React +
 * Chromium) : il lui confie la composition « ReelVideo » (sous-titres animés,
 * logo, effet de fin) avec la vidéo et le son déjà préparés par le service
 * FFmpeg, puis récupère le MP4.
 *
 * API (en-tête X-API-Key obligatoire, variable API_KEY) :
 *   POST   /renders            { compositionId, inputProps } → { id }
 *   GET    /renders/:id        → { status, progress (0..1), error? }
 *   GET    /renders/:id/file   → le MP4
 *   DELETE /renders/:id        → annule le rendu et supprime le fichier
 *   GET    /health             → { status: "ok" }
 *
 * `node server.mjs --prepare` construit le bundle et télécharge le Chrome
 * headless shell (étape de build Docker), puis s'arrête.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, makeCancelSignal, renderMedia, selectComposition } from "@remotion/renderer";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Racine contenant client/src/remotion et shared/ : l'image Docker, sinon le dépôt. */
const SOURCE_ROOT =
  process.env.REMOTION_SOURCE_ROOT ||
  (fs.existsSync(path.join(HERE, "client/src/remotion")) ? HERE : path.resolve(HERE, ".."));
const ENTRY_POINT = path.join(SOURCE_ROOT, "client/src/remotion/index.ts");
const BUNDLE_DIR = process.env.BUNDLE_DIR || path.join(HERE, "bundle");
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(os.tmpdir(), "remotion-renders");

const PORT = Number(process.env.PORT) || 8100;
const API_KEY = process.env.API_KEY || "";
/** Rendus simultanés (chacun occupe déjà plusieurs onglets Chromium). */
const MAX_PARALLEL_RENDERS = Math.max(1, Number(process.env.MAX_PARALLEL_RENDERS) || 1);
/** Les props contiennent le logo en data URL. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;
/** Rendus terminés conservés au plus une heure s'ils ne sont pas supprimés. */
const RESULT_TTL_MS = 60 * 60_000;

const log = (...args) => console.log(new Date().toISOString(), ...args);
const warn = (...args) => console.warn(new Date().toISOString(), ...args);

// ---------------------------------------------------------------------------
// Bundle des compositions
// ---------------------------------------------------------------------------

function bundleOptions(outDir) {
  return {
    entryPoint: ENTRY_POINT,
    outDir,
    // Mêmes alias que Vite : les compositions importent @shared/*
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        alias: {
          ...(config.resolve?.alias ?? {}),
          "@shared": path.join(SOURCE_ROOT, "shared"),
        },
        // Dépendances (react, remotion, polices) installées à côté de ce service
        modules: [...(config.resolve?.modules ?? ["node_modules"]), path.join(HERE, "node_modules")],
      },
    }),
  };
}

let bundlePromise = null;

/** Bundle construit au build Docker, sinon construit une fois par processus. */
function getBundle() {
  if (fs.existsSync(path.join(BUNDLE_DIR, "index.html"))) return Promise.resolve(BUNDLE_DIR);
  if (!bundlePromise) {
    log("📦 [Remotion] Bundle de", ENTRY_POINT);
    bundlePromise = bundle(bundleOptions(null)).catch((error) => {
      bundlePromise = null; // réessayer au prochain rendu
      throw error;
    });
  }
  return bundlePromise;
}

/** Onglets Chromium en parallèle : par défaut la moitié des cœurs, 1 au minimum. */
function renderConcurrency() {
  const configured = Number(process.env.RENDER_CONCURRENCY);
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  return Math.max(1, Math.floor(os.cpus().length / 2));
}

// ---------------------------------------------------------------------------
// Rendus
// ---------------------------------------------------------------------------

/** @type {Map<string, {id: string, compositionId: string, inputProps: object, status: string, progress: number, error?: string, output: string, finishedAt?: number, cancel?: () => void}>} */
const renders = new Map();
const waiting = [];
let running = 0;

function enqueue(compositionId, inputProps) {
  const id = crypto.randomUUID();
  const render = {
    id,
    compositionId,
    inputProps,
    status: "pending",
    progress: 0,
    output: path.join(OUTPUT_DIR, `${id}.mp4`),
  };
  renders.set(id, render);
  waiting.push(render);
  pump();
  return render;
}

function pump() {
  while (running < MAX_PARALLEL_RENDERS && waiting.length) {
    const render = waiting.shift();
    if (!renders.has(render.id)) continue; // supprimé avant son tour
    running++;
    run(render).finally(() => {
      running--;
      pump();
    });
  }
}

async function run(render) {
  render.status = "rendering";
  const startedAt = Date.now();
  const { cancelSignal, cancel } = makeCancelSignal();
  render.cancel = cancel;
  try {
    const serveUrl = await getBundle();
    const composition = await selectComposition({
      serveUrl,
      id: render.compositionId,
      inputProps: render.inputProps,
    });
    await renderMedia({
      composition,
      serveUrl,
      inputProps: render.inputProps,
      outputLocation: render.output,
      codec: "h264",
      // Qualité visuelle élevée, conforme aux recommandations Instagram/TikTok
      crf: 18,
      x264Preset: "medium",
      pixelFormat: "yuv420p",
      colorSpace: "bt709",
      audioCodec: "aac",
      audioBitrate: "192k",
      concurrency: renderConcurrency(),
      cancelSignal,
      onProgress: ({ progress }) => {
        render.progress = progress;
      },
      // Une image lente (décodage vidéo sur une petite machine) ne doit pas faire échouer le rendu
      timeoutInMilliseconds: 60_000,
      onBrowserLog: (entry) => {
        if (entry.type === "error") warn("⚠️ [Remotion] Navigateur :", entry.text.slice(0, 300));
      },
    });
    render.status = "done";
    render.progress = 1;
    log(`🎞️ [Remotion] ${render.compositionId} ${render.id} rendu en ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
  } catch (error) {
    render.status = "failed";
    render.error = error instanceof Error ? error.message : String(error);
    warn(`❌ [Remotion] Rendu ${render.id} en échec :`, render.error);
    fs.promises.rm(render.output, { force: true }).catch(() => {});
  } finally {
    render.cancel = undefined;
    render.finishedAt = Date.now();
    // Les props (logo en data URL) ne servent plus
    render.inputProps = null;
  }
}

function remove(id) {
  const render = renders.get(id);
  if (!render) return;
  renders.delete(id);
  render.cancel?.();
  fs.promises.rm(render.output, { force: true }).catch(() => {});
}

// Purge des rendus oubliés
setInterval(() => {
  const now = Date.now();
  for (const render of renders.values()) {
    if (render.finishedAt && now - render.finishedAt > RESULT_TTL_MS) remove(render.id);
  }
}, 10 * 60_000).unref();

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}

function authorized(req) {
  const given = Buffer.from(String(req.headers["x-api-key"] ?? ""));
  const expected = Buffer.from(API_KEY);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Corps de requête trop volumineux"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(Object.assign(new Error("JSON invalide"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

async function handle(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);

  if (!authorized(req)) return send(res, 401, { error: "Invalid API Key" });

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { status: "ok", renders: renders.size, running });
  }

  if (parts[0] !== "renders") return send(res, 404, { error: "Route introuvable" });

  if (parts.length === 1 && req.method === "POST") {
    const body = await readJson(req);
    if (typeof body?.compositionId !== "string" || !body.compositionId) {
      return send(res, 400, { error: "compositionId requis" });
    }
    if (body.inputProps == null || typeof body.inputProps !== "object" || Array.isArray(body.inputProps)) {
      return send(res, 400, { error: "inputProps doit être un objet" });
    }
    const render = enqueue(body.compositionId, body.inputProps);
    log(`🎬 [Remotion] Rendu ${render.id} (${render.compositionId}) en file`);
    return send(res, 202, { id: render.id });
  }

  const render = parts[1] ? renders.get(parts[1]) : undefined;

  if (parts.length === 2 && req.method === "DELETE") {
    remove(parts[1]);
    return send(res, 200, { success: true });
  }
  if (!render) return send(res, 404, { error: "Rendu introuvable ou expiré" });

  if (parts.length === 2 && req.method === "GET") {
    return send(res, 200, {
      status: render.status,
      progress: render.progress,
      ...(render.error ? { error: render.error } : {}),
    });
  }

  if (parts.length === 3 && parts[2] === "file" && req.method === "GET") {
    if (render.status !== "done") return send(res, 409, { error: "Rendu non terminé" });
    let stat;
    try {
      stat = await fs.promises.stat(render.output);
    } catch {
      return send(res, 404, { error: "Fichier introuvable ou expiré" });
    }
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": stat.size });
    fs.createReadStream(render.output)
      .on("error", () => res.destroy())
      .pipe(res);
    return;
  }

  return send(res, 405, { error: "Méthode non autorisée" });
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

async function prepare() {
  log("📦 [Remotion] Pré-bundle de", ENTRY_POINT, "→", BUNDLE_DIR);
  await fs.promises.rm(BUNDLE_DIR, { recursive: true, force: true });
  await bundle(bundleOptions(BUNDLE_DIR));
  log("🌐 [Remotion] Téléchargement du Chrome headless shell…");
  await ensureBrowser();
  log("✅ [Remotion] Bundle et navigateur prêts");
}

if (process.argv.includes("--prepare")) {
  prepare().catch((error) => {
    console.error("❌ [Remotion] Préparation impossible :", error);
    process.exit(1);
  });
} else {
  if (!API_KEY) {
    console.error("API_KEY doit être défini : le service refuse de démarrer sans clé.");
    process.exit(1);
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (res.headersSent) return res.destroy();
      send(res, error?.status ?? 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
  server.listen(PORT, "0.0.0.0", () => {
    log(`🎬 [Remotion] Service de rendu à l'écoute sur le port ${PORT} (rendus simultanés : ${MAX_PARALLEL_RENDERS})`);
  });

  // Bundle et navigateur prêts avant le premier rendu (sans bloquer le démarrage)
  getBundle().catch((error) => warn("⚠️ [Remotion] Bundle impossible :", error.message));
  ensureBrowser().catch((error) => warn("⚠️ [Remotion] Navigateur indisponible :", error.message));

  const shutdown = () => {
    log("Arrêt du service de rendu");
    for (const render of renders.values()) render.cancel?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
