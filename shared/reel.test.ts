import { describe, expect, it } from "vitest";
import { imagesReelParamsSchema, ttsPreviewSchema, videoReelParamsSchema } from "./reel";

describe("videoReelParamsSchema", () => {
  it("exige une vidéo et une page, avec des messages lisibles", () => {
    const result = videoReelParamsSchema.safeParse({ pageIds: [] });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toContain("Vidéo requise");
  });

  it("applique les valeurs par défaut", () => {
    const params = videoReelParamsSchema.parse({ videoMediaId: "v", pageIds: ["p"] });
    expect(params).toMatchObject({ captionStyle: "bold", stabilize: false, drawText: true, musicVolume: 0.25 });
  });

  it("accepte les anciens paramètres encore stockés dans des jobs", () => {
    expect(videoReelParamsSchema.safeParse({ videoMediaId: "v", pageIds: ["p"], wordDuration: 0.6 }).success).toBe(true);
  });

  it("refuse un moteur de voix inconnu", () => {
    expect(videoReelParamsSchema.safeParse({ videoMediaId: "v", pageIds: ["p"], ttsEngine: "autre" }).success).toBe(false);
  });
});

describe("imagesReelParamsSchema", () => {
  it("limite à 4 images", () => {
    expect(imagesReelParamsSchema.safeParse({ imageUrls: ["a", "b", "c", "d", "e"] }).success).toBe(false);
  });
});

describe("ttsPreviewSchema", () => {
  it("refuse un texte vide", () => {
    expect(ttsPreviewSchema.safeParse({ text: "   " }).success).toBe(false);
  });
});
