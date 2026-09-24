/**
 * Paramètres des rendus de Reels, validés à l'entrée des routes et stockés tels
 * quels dans `reel_jobs.params` : un job repris après redémarrage retrouve ainsi
 * exactement ce que l'utilisateur avait demandé.
 */

import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

/** Reel construit à partir d'une vidéo de la médiathèque. */
export const videoReelParamsSchema = z.object({
  videoMediaId: z.string({ required_error: "Vidéo requise" }).min(1, "Vidéo requise"),
  pageIds: z
    .array(z.string().min(1), { required_error: "Au moins une page requise" })
    .min(1, "Au moins une page requise"),
  musicTrackId: optionalText,
  musicUrl: optionalText,
  overlayText: optionalText,
  description: optionalText,
  ttsEnabled: z.boolean().default(false),
  ttsVoice: optionalText,
  ttsEngine: z.enum(["gemini", "edge"]).optional(),
  scheduledFor: optionalText,
  wordDuration: z.number().positive().max(5).default(0.6),
  fontSize: z.number().int().min(16).max(200).default(64),
  musicVolume: z.number().min(0).max(2).default(0.25),
  drawText: z.boolean().default(true),
  stabilize: z.boolean().default(false),
  enableEndingEffect: z.boolean().default(true),
  // Déterminé par le serveur à partir de la première page, jamais par le client
  storeName: z.string().optional(),
});

export type VideoReelParams = z.infer<typeof videoReelParamsSchema>;

/** Reel construit à partir d'images (rendu Remotion). */
export const imagesReelParamsSchema = z.object({
  // Chemins relatifs /uploads/... ou URL absolues
  imageUrls: z.array(z.string().min(1)).min(1, "Aucune image fournie").max(4),
  overlayText: optionalText,
  musicUrl: optionalText,
  musicVolume: z.number().min(0).max(2).default(0.3),
  ttsEngine: z.enum(["gemini", "edge"]).optional(),
  ttsVoice: optionalText,
  storeName: z.string().optional(),
  // Fichiers temporaires à supprimer une fois le rendu terminé
  tempFiles: z.array(z.string()).default([]),
});

export type ImagesReelParams = z.infer<typeof imagesReelParamsSchema>;

export type ReelJobKind = "video" | "images";

export type ReelJobStatus = "pending" | "processing" | "completed" | "failed";

/** Résultat d'un rendu d'images, consulté par le client pour l'aperçu. */
export interface ImagesReelResult {
  url: string;
  thumbnailUrl: string | null;
}
