/**
 * Ressources fournies aux compositions Remotion pendant un rendu serveur.
 */

import fs from "fs";
import path from "path";

/** Dossier temporaire servi sous /uploads/temp (voir server/index.ts). */
export const REMOTION_TEMP_DIR =
  process.env.TEMP_UPLOAD_DIR || path.join(process.cwd(), "uploads", "temp");

/**
 * URL HTTP locale d'un fichier servi par l'application. Vidéo et audio sont
 * lus côté Node par le moteur de rendu : l'adresse locale suffit.
 */
export function localHttpUrl(url: string): string {
  if (!url.startsWith("/")) return url;
  const port = process.env.PORT || "5555";
  return `http://localhost:${port}${url}`;
}

/** URL servie d'un fichier du dossier temporaire. */
export function tempFileUrl(absolutePath: string): string {
  const relative = path.relative(REMOTION_TEMP_DIR, absolutePath).split(path.sep).join("/");
  return localHttpUrl(`/uploads/temp/${relative}`);
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/**
 * Convertit un chemin local /uploads/... en data URL : les images sont
 * affichées par Chromium, qui ne lit pas http://localhost de façon fiable
 * dans Docker. Refuse tout chemin sortant du dossier uploads.
 */
export async function toDataUrl(relativeUrl: string): Promise<string> {
  if (!relativeUrl.startsWith("/uploads/")) return relativeUrl;
  const uploadsRoot = path.join(process.cwd(), "uploads") + path.sep;
  const tempRoot = path.resolve(REMOTION_TEMP_DIR) + path.sep;
  const filePath = relativeUrl.startsWith("/uploads/temp/")
    ? path.resolve(REMOTION_TEMP_DIR, "." + relativeUrl.slice("/uploads/temp".length))
    : path.resolve(process.cwd(), "." + relativeUrl);
  if (!filePath.startsWith(uploadsRoot) && !filePath.startsWith(tempRoot)) {
    throw new Error(`Chemin d'image refusé : ${relativeUrl}`);
  }
  try {
    const buffer = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    return `data:${MIME_BY_EXT[ext] ?? "image/jpeg"};base64,${buffer.toString("base64")}`;
  } catch {
    console.warn(`⚠️ [Remotion] Image introuvable : ${filePath}`);
    return relativeUrl;
  }
}
