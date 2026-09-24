import { describe, expect, it } from "vitest";
import {
  cleanCaptionText,
  computeImagesTiming,
  computeReelTiming,
  groupLines,
  offsetWords,
  spreadWords,
} from "./captions";

// Mêmes cas que ffmpeg-service/tests/test_render.py : l'aperçu et le rendu
// doivent tomber sur les mêmes durées.
describe("computeReelTiming", () => {
  it("allonge la vidéo quand la voix dépasse", () => {
    expect(computeReelTiming({ videoDuration: 5, voiceDuration: 10, hasOutro: false, endingEffect: true }).total).toBe(12.8);
  });

  it("réserve l'effet de fin après la voix", () => {
    const timing = computeReelTiming({ videoDuration: 6, voiceDuration: 4.8, hasOutro: true, endingEffect: true });
    expect(timing.total).toBe(9.3);
    expect(timing.logoStart).toBeCloseTo(6.8);
    expect(timing.fadeStart).toBeCloseTo(7.3);
  });

  it("n'a ni logo ni fondu sans effet de fin", () => {
    const timing = computeReelTiming({ videoDuration: 12, hasOutro: true, endingEffect: false });
    expect(timing).toEqual({ total: 12, logoStart: null, fadeStart: null });
  });
});

describe("computeImagesTiming", () => {
  it("garde un Reel d'images entre 25 et 30 s", () => {
    expect(computeImagesTiming({ imageCount: 3, hasEnding: true })).toEqual({ total: 25, endingSeconds: 3 });
    expect(computeImagesTiming({ imageCount: 4, voiceDuration: 40, hasEnding: true }).total).toBe(30);
    expect(computeImagesTiming({ imageCount: 4, voiceDuration: 24, hasEnding: false }).total).toBe(25);
  });
});

describe("groupLines", () => {
  const words = (texts: string[]) => texts.map((text, i) => ({ text, start: i, end: i + 0.5 }));

  it("coupe à la ponctuation et limite chaque ligne", () => {
    const lines = groupLines(words(["Bonjour,", "venez", "découvrir", "nos", "nouveautés"]));
    expect(lines[0].map((w) => w.text)).toEqual(["Bonjour,"]);
    expect(lines.every((line) => line.length <= 3)).toBe(true);
  });
});

describe("texte des sous-titres", () => {
  it("retire hashtags, emojis et liens", () => {
    expect(cleanCaptionText("Promo 🌸 #AménagementExtérieur ici https://x.fr !")).toBe("Promo ici !");
  });

  it("répartit l'estimation sur l'intervalle", () => {
    const spread = spreadWords("un deux trois", 2, 5);
    expect(spread[0].start).toBe(2);
    expect(spread[spread.length - 1].end).toBeCloseTo(5);
  });

  it("décale les mots de la voix vers le temps de la vidéo", () => {
    expect(offsetWords([{ text: "a", start: 0.1, end: 0.4 }], 2)).toEqual([{ text: "a", start: 2.1, end: 2.4 }]);
  });
});
