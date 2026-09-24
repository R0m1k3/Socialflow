import { describe, expect, it } from "vitest";
import { toDataUrl } from "./remotionAssets";

describe("toDataUrl", () => {
  it("refuse un chemin qui sort du dossier uploads", async () => {
    await expect(toDataUrl("/uploads/../../etc/passwd")).rejects.toThrow(/refusé/);
  });

  it("laisse les URL externes telles quelles", async () => {
    await expect(toDataUrl("https://exemple.fr/logo.png")).resolves.toBe("https://exemple.fr/logo.png");
  });
});
