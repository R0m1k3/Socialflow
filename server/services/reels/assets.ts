/**
 * Résolution des ressources d'un Reel (musique, logo, clé Gemini, nom du
 * magasin), jusqu'ici recopiée dans chaque route.
 */

import type { QwenTarget } from "../ffmpeg";
import { storage } from "../../storage";
import { buildMinioUrl, resolveInternalUrl } from "../minio";

/**
 * URL de la musique téléchargeable par le service FFmpeg (réseau Docker
 * interne : l'URL publique HTTPS n'y est pas joignable).
 */
export async function resolveMusicUrl(
  musicTrackId?: string,
  musicUrl?: string,
): Promise<string | undefined> {
  if (musicUrl) return resolveInternalUrl(musicUrl);
  if (!musicTrackId?.startsWith("internal_")) return undefined;

  try {
    const track = await storage.getAudioTrack(musicTrackId.slice("internal_".length));
    return track ? resolveInternalUrl(track.url) : undefined;
  } catch (error) {
    console.error("⚠️ [Reels] Piste audio introuvable :", error);
    return undefined;
  }
}

/** Chemin relatif (/uploads/...) du logo configuré, s'il existe. */
export async function resolveLogoPath(): Promise<string | undefined> {
  try {
    const config = await storage.getCloudinaryConfig();
    if (config?.logoPublicId) {
      return buildMinioUrl(config.cloudName, config.logoPublicId, config.publicUrl);
    }
  } catch (error) {
    console.error("⚠️ [Reels] Configuration du logo illisible :", error);
  }
  return undefined;
}

/**
 * Clé Gemini : configuration de l'application, sinon variable d'environnement.
 * Aussi transmise avec Qwen, qui se replie sur Gemini si le service local échoue.
 */
export async function resolveGeminiApiKey(ttsEngine?: string): Promise<string | undefined> {
  if (ttsEngine !== "gemini" && ttsEngine !== "qwen") return undefined;
  const appConfig = await storage.getAppConfig();
  return appConfig?.geminiApiKey ?? process.env.GEMINI_API_KEY ?? undefined;
}

/** Service Qwen TTS réglé dans les paramètres (sinon ffmpeg-api prend QWEN_TTS_URL). */
export async function resolveQwenTarget(ttsEngine?: string): Promise<QwenTarget | undefined> {
  if (ttsEngine !== "qwen") return undefined;
  return qwenTargetFromConfig(await storage.getAppConfig());
}

/** Adresse http(s) du service Qwen saisie dans les paramètres, sans « / » final ; null si invalide. */
export function normalizeQwenUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function qwenTargetFromConfig(
  appConfig: { qwenTtsUrl?: string | null; qwenTtsApiKey?: string | null } | undefined,
): QwenTarget | undefined {
  if (!appConfig?.qwenTtsUrl) return undefined;
  return { url: appConfig.qwenTtsUrl, apiKey: appConfig.qwenTtsApiKey ?? undefined };
}

/** Nom affiché dans l'outro : celui de la page choisie, sinon de la première page de l'utilisateur. */
export async function resolveStoreName(
  userId: string,
  preferredPageId?: string,
): Promise<string | undefined> {
  try {
    if (preferredPageId) {
      const page = await storage.getSocialPage(preferredPageId);
      if (page) return page.pageName;
    }
    const pages = await storage.getSocialPages(userId);
    return pages[0]?.pageName;
  } catch (error) {
    console.error("⚠️ [Reels] Nom du magasin introuvable :", error);
    return undefined;
  }
}
