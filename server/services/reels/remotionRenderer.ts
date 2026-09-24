/**
 * Rendu Remotion côté serveur, commun aux Reels vidéo et images : bundle mis
 * en cache, réglages d'encodage des réseaux sociaux, progression.
 */

import os from "os";
import path from "path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

let bundleCache: Promise<string> | null = null;

/** Bundle des compositions, construit une fois par processus. */
export function getRemotionBundle(): Promise<string> {
  if (!bundleCache) {
    // process.cwd() = /app dans Docker, racine du projet en dev
    const entryPoint = path.resolve(process.cwd(), "client/src/remotion/index.ts");
    console.log("📦 [Remotion] Bundle de", entryPoint);
    bundleCache = bundle({
      entryPoint,
      // Mêmes alias que Vite : les compositions importent @shared/*
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          alias: {
            ...(config.resolve?.alias ?? {}),
            "@shared": path.resolve(process.cwd(), "shared"),
          },
        },
      }),
    }).catch((error) => {
      bundleCache = null; // réessayer au prochain rendu
      throw error;
    });
  }
  return bundleCache;
}

/** Rendus en parallèle dans Chromium : par défaut la moitié des cœurs, 1 au minimum. */
function renderConcurrency(): number {
  const configured = Number(process.env.RENDER_CONCURRENCY);
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  return Math.max(1, Math.floor(os.cpus().length / 2));
}

export async function renderReelComposition(options: {
  compositionId: "ReelVideo" | "ImageVideo";
  inputProps: Record<string, unknown>;
  outputLocation: string;
  onProgress?: (ratio: number) => void;
}): Promise<void> {
  const serveUrl = await getRemotionBundle();
  const composition = await selectComposition({
    serveUrl,
    id: options.compositionId,
    inputProps: options.inputProps,
  });

  const startedAt = Date.now();
  await renderMedia({
    composition,
    serveUrl,
    inputProps: options.inputProps,
    outputLocation: options.outputLocation,
    codec: "h264",
    // Qualité visuelle élevée, conforme aux recommandations Instagram/TikTok
    crf: 18,
    x264Preset: "medium",
    pixelFormat: "yuv420p",
    colorSpace: "bt709",
    audioCodec: "aac",
    audioBitrate: "192k",
    concurrency: renderConcurrency(),
    onProgress: ({ progress }) => options.onProgress?.(progress),
    // Une image lente (décodage vidéo sur une petite machine) ne doit pas faire échouer le rendu
    timeoutInMilliseconds: 60_000,
    onBrowserLog: (log) => {
      if (log.type === "error") console.warn("⚠️ [Remotion] Navigateur :", log.text.slice(0, 300));
    },
  });
  console.log(
    `🎞️ [Remotion] ${options.compositionId} rendu en ${((Date.now() - startedAt) / 1000).toFixed(1)} s`,
  );
}
