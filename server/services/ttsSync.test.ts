import { describe, expect, it } from "vitest";
import { estimateVoiceTiming } from "./ttsSync";

describe("estimateVoiceTiming", () => {
  it("ignore hashtags et liens dans le décompte", () => {
    expect(estimateVoiceTiming("Venez vite #promo https://x.fr").wordCount).toBe(2);
  });

  it("prévient quand la voix sera trop longue", () => {
    const timing = estimateVoiceTiming("mot ".repeat(200));
    expect(timing.isHealthy).toBe(false);
    expect(timing.warnings[0]).toMatch(/Texte long/);
  });
});
