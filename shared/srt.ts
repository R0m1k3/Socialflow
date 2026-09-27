/**
 * Fichiers de sous-titres SRT : lecture côté navigateur, validation côté
 * serveur et minutage de l'aperçu. Quand un SRT est fourni, il remplace le
 * texte libre : la voix lit chaque sous-titre à son instant.
 */

import { z } from "zod";
import { cleanCaptionText, spreadWords, type TimedWord } from "./captions";

export const MAX_SRT_CUES = 300;

export const srtCueSchema = z
  .object({
    start: z.number().min(0),
    end: z.number().min(0),
    text: z.string().trim().min(1).max(500),
  })
  .refine((cue) => cue.end > cue.start, { message: "Sous-titre de durée nulle" });

export const srtCuesSchema = z
  .array(srtCueSchema)
  .min(1, "Fichier SRT vide")
  .max(MAX_SRT_CUES, `Fichier SRT trop long (${MAX_SRT_CUES} sous-titres au plus)`);

export type SrtCue = z.infer<typeof srtCueSchema>;

const TIMING = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function toSeconds(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
}

/**
 * Lit un fichier SRT. Les balises (<i>, {\an8}…) sont retirées, les lignes
 * d'un même sous-titre réunies ; les sous-titres sans texte lisible sont
 * ignorés. Lève une erreur lisible si aucun sous-titre n'est trouvé.
 */
export function parseSrt(content: string): SrtCue[] {
  const blocks = content
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/);

  const cues: SrtCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((l) => TIMING.test(l));
    if (timingIndex < 0) continue;
    const match = lines[timingIndex].match(TIMING)!;
    const start = toSeconds(match[1], match[2], match[3], match[4]);
    const end = toSeconds(match[5], match[6], match[7], match[8]);
    const text = lines
      .slice(timingIndex + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\{[^}]*\}/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || end <= start || !cleanCaptionText(text)) continue;
    cues.push({ start: round(start), end: round(end), text });
  }

  if (!cues.length) throw new Error("Aucun sous-titre valide trouvé dans ce fichier SRT");
  if (cues.length > MAX_SRT_CUES) {
    throw new Error(`Fichier SRT trop long (${MAX_SRT_CUES} sous-titres au plus)`);
  }
  return cues.sort((a, b) => a.start - b.start);
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/** Texte complet du SRT (description de la publication, aperçu de la voix). */
export function srtText(cues: SrtCue[]): string {
  return cues.map((c) => c.text).join(" ");
}

/** Fin du dernier sous-titre : la vidéo dure au moins jusque-là. */
export function srtEnd(cues: SrtCue[]): number {
  return cues.reduce((max, c) => Math.max(max, c.end), 0);
}

/** Mots de chaque sous-titre répartis sur son intervalle (aperçu, rendu sans voix). */
export function srtWords(cues: SrtCue[]): TimedWord[] {
  return cues.flatMap((c) => spreadWords(c.text, c.start, c.end));
}

/** « 1:05 » pour l'affichage. */
export function formatSrtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
