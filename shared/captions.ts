/**
 * Sous-titres et minutage des Reels, partagés entre l'aperçu (navigateur),
 * le rendu Remotion (serveur) et les tests.
 * Les règles de durée reprennent celles du service Python (app/render.py).
 */

export const CAPTION_STYLES = ["bold", "neon", "minimal"] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

export const CAPTION_STYLE_OPTIONS: { id: CaptionStyle; label: string; description: string }[] = [
  { id: "bold", label: "Impact", description: "Majuscules, mot prononcé en jaune" },
  { id: "neon", label: "Surligné", description: "Mot prononcé sur fond coloré" },
  { id: "minimal", label: "Épuré", description: "Texte qui se révèle au fil de la voix" },
];

export const DEFAULT_CAPTION_STYLE: CaptionStyle = "bold";

/** Mot affiché et son intervalle, en secondes depuis le début de la vidéo. */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export const REEL_FPS = 30;
export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;

/** La voix démarre après ce délai (le temps de capter l'attention). */
export const VOICE_DELAY = 2;
const VOICE_TAIL = 0.8;
const OUTRO_MIN = 2.5;
const LOGO_SECONDS = 5;
export const FADE_SECONDS = 2;

export interface ReelTiming {
  total: number;
  /** Début de l'effet de fin (grand logo), ou null sans effet de fin. */
  logoStart: number | null;
  fadeStart: number | null;
}

/** Durée finale : la vidéo s'allonge (dernière image figée) si la voix dépasse. */
export function computeReelTiming(input: {
  videoDuration: number;
  voiceDuration?: number;
  hasOutro: boolean;
  endingEffect: boolean;
}): ReelTiming {
  const hasOutro = input.hasOutro && input.endingEffect;
  const speechEnd = input.voiceDuration ? VOICE_DELAY + input.voiceDuration : 0;
  let total = input.videoDuration;
  if (input.voiceDuration) {
    total = Math.max(total, speechEnd + VOICE_TAIL);
    if (hasOutro) total = Math.max(total, speechEnd + OUTRO_MIN);
  }
  total = Math.round(total * 1000) / 1000;
  return {
    total,
    logoStart: hasOutro ? Math.max(0, total - LOGO_SECONDS, speechEnd) : null,
    fadeStart: input.endingEffect ? Math.max(0, total - FADE_SECONDS) : null,
  };
}

const MAX_WORDS_PER_LINE = 3;
const MAX_CHARS_PER_LINE = 18;
const LINE_BREAK = /[.!?,:;…]$/;

/** Découpe en lignes courtes, coupées de préférence à la ponctuation. */
export function groupLines(words: TimedWord[]): TimedWord[][] {
  const lines: TimedWord[][] = [];
  let current: TimedWord[] = [];
  for (const word of words) {
    const chars = current.reduce((n, w) => n + w.text.length + 1, 0) + word.text.length;
    if (current.length && (current.length >= MAX_WORDS_PER_LINE || chars > MAX_CHARS_PER_LINE)) {
      lines.push(current);
      current = [];
    }
    current.push(word);
    if (LINE_BREAK.test(word.text)) {
      lines.push(current);
      current = [];
    }
  }
  if (current.length) lines.push(current);
  return lines;
}

/** Retire emojis, hashtags et liens : ce qui n'est ni lu ni affiché. */
export function cleanCaptionText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/#[\wÀ-ÿ]+/g, " ")
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, " ")
    .replace(/[☀-➿⬀-⯿️]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Répartit un texte sur un intervalle au prorata de la longueur des mots.
 * Sert d'aperçu tant que la voix n'a pas été générée.
 */
export function spreadWords(text: string, start: number, end: number): TimedWord[] {
  const tokens = cleanCaptionText(text).split(" ").filter(Boolean);
  if (!tokens.length || end <= start) return [];
  const weights = tokens.map((t) => Math.max(1, t.replace(/[^\wÀ-ÿ]/g, "").length));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let cursor = start;
  return tokens.map((text, i) => {
    const duration = ((end - start) * weights[i]) / totalWeight;
    const word = { text, start: cursor, end: cursor + duration };
    cursor += duration;
    return word;
  });
}

/** Décale des mots minutés depuis le début de la voix vers le temps de la vidéo. */
export function offsetWords(words: TimedWord[], offset: number): TimedWord[] {
  return words.map((w) => ({ ...w, start: w.start + offset, end: w.end + offset }));
}

const IMAGES_ENDING_SECONDS = 3;
const IMAGES_MIN_CONTENT = 22;
const IMAGES_MAX_CONTENT = 27;
const SECONDS_PER_IMAGE = 3;

/** Reel d'images : 25 à 30 s, diapositive de fin comprise. */
export function computeImagesTiming(input: { imageCount: number; voiceDuration?: number; hasEnding: boolean }): {
  total: number;
  endingSeconds: number;
} {
  const natural = Math.max((input.voiceDuration ?? 0) + 1, input.imageCount * SECONDS_PER_IMAGE);
  const content = Math.min(Math.max(natural, IMAGES_MIN_CONTENT), IMAGES_MAX_CONTENT);
  const endingSeconds = input.hasEnding ? IMAGES_ENDING_SECONDS : 0;
  return { total: content + endingSeconds, endingSeconds };
}
