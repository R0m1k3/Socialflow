/**
 * Résolution des ressources d'un Reel (musique, logo, clé Gemini, nom du
 * magasin), jusqu'ici recopiée dans chaque route.
 */

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

/** Clé Gemini : configuration de l'application, sinon variable d'environnement. */
export async function resolveGeminiApiKey(ttsEngine?: string): Promise<string | undefined> {
  if (ttsEngine !== "gemini") return undefined;
  const appConfig = await storage.getAppConfig();
  return appConfig?.geminiApiKey ?? process.env.GEMINI_API_KEY ?? undefined;
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
