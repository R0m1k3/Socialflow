/**
 * Estimation de la durée de lecture d'un texte, affichée pendant la saisie.
 *
 * Auparavant, chaque pause de frappe générait une voix complète pour la
 * mesurer (un appel Gemini facturé à chaque fois). Le minutage réel des mots
 * vient désormais de la voix au moment du rendu ; ici, une estimation suffit.
 */

/** Débit moyen d'une voix de synthèse française, en mots par seconde. */
const WORDS_PER_SECOND = 2.6;
/** Au-delà, la voix dépasse la durée confortable d'un Reel. */
const MAX_COMFORTABLE_SECONDS = 45;

export interface SyncTiming {
  wordDuration: number;
  audioDuration: number;
  wordCount: number;
  punctuationPause: number;
  isHealthy: boolean;
  warnings: string[];
}

export function estimateVoiceTiming(text: string): SyncTiming {
  const words = text
    .replace(/#[\wÀ-ÿ]+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9À-ÿ]/.test(w));
  const pauses = (text.match(/[.!?;:]/g) ?? []).length;
  const punctuationPause = 0.35;
  const audioDuration = words.length / WORDS_PER_SECOND + pauses * punctuationPause;

  const warnings: string[] = [];
  if (audioDuration > MAX_COMFORTABLE_SECONDS) {
    warnings.push(`Texte long : environ ${Math.round(audioDuration)} s de voix. Visez moins de ${MAX_COMFORTABLE_SECONDS} s.`);
  }
  if (words.length > 0 && words.length < 4) {
    warnings.push('Texte très court : la voix ne durera que quelques secondes.');
  }

  return {
    wordDuration: words.length ? audioDuration / words.length : 0,
    audioDuration,
    wordCount: words.length,
    punctuationPause,
    isHealthy: warnings.length === 0,
    warnings,
  };
}
