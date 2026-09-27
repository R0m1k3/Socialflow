import { describe, expect, it } from "vitest";
import { parseSrt, srtEnd, srtText, srtWords } from "./srt";
import { videoReelParamsSchema } from "./reel";

const SAMPLE = `﻿1
00:00:01,000 --> 00:00:03,500
Bonjour à tous !

2
00:00:04,000 --> 00:00:06,250
<i>Découvrez</i> nos
nouveautés en magasin

3
00:00:07,000 --> 00:00:07,000
Durée nulle, ignoré
`;

describe("parseSrt", () => {
  it("lit les sous-titres, retire les balises et réunit les lignes", () => {
    const cues = parseSrt(SAMPLE.replace(/\n/g, "\r\n"));
    expect(cues).toEqual([
      { start: 1, end: 3.5, text: "Bonjour à tous !" },
      { start: 4, end: 6.25, text: "Découvrez nos nouveautés en magasin" },
    ]);
    expect(srtText(cues)).toBe("Bonjour à tous ! Découvrez nos nouveautés en magasin");
    expect(srtEnd(cues)).toBe(6.25);
  });

  it("accepte les millisecondes séparées par un point et sans numéro", () => {
    expect(parseSrt("00:00:02.5 --> 00:00:04.0\nSalut")).toEqual([{ start: 2.5, end: 4, text: "Salut" }]);
  });

  it("refuse un fichier sans sous-titre", () => {
    expect(() => parseSrt("pas un srt")).toThrow(/Aucun sous-titre/);
  });

  it("répartit les mots dans l'intervalle de leur sous-titre", () => {
    const words = srtWords(parseSrt(SAMPLE));
    const second = words.findIndex((w) => w.text === "Découvrez");
    expect(words[0].start).toBe(1);
    expect(words[second - 1].end).toBeCloseTo(3.5);
    expect(words[second].start).toBe(4);
    expect(words[words.length - 1].end).toBeCloseTo(6.25);
  });
});

describe("videoReelParamsSchema avec SRT", () => {
  it("accepte des sous-titres valides et refuse une durée nulle", () => {
    const base = { videoMediaId: "v", pageIds: ["p"] };
    expect(videoReelParamsSchema.safeParse({ ...base, srtCues: [{ start: 0, end: 1, text: "a" }] }).success).toBe(true);
    expect(videoReelParamsSchema.safeParse({ ...base, srtCues: [{ start: 1, end: 1, text: "a" }] }).success).toBe(false);
  });
});
