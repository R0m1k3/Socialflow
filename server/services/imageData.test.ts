import { describe, expect, it } from "vitest";
import { MAX_EXTERNAL_IMAGE_SIZE, decodeImageData, normalizePageIds, sniffImageMime, validateImage } from "./imageData";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const GIF = Buffer.from("GIF89a\0\0", "latin1");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);

describe("sniffImageMime", () => {
  it("reconnaît les formats acceptés par leur signature", () => {
    expect(sniffImageMime(PNG)).toBe("image/png");
    expect(sniffImageMime(JPEG)).toBe("image/jpeg");
    expect(sniffImageMime(GIF)).toBe("image/gif");
    expect(sniffImageMime(WEBP)).toBe("image/webp");
  });

  it("refuse le reste", () => {
    expect(sniffImageMime(Buffer.from("<html></html>"))).toBeNull();
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
  });
});

describe("decodeImageData", () => {
  it("décode le base64 brut et les data URL", () => {
    const base64 = PNG.toString("base64");
    expect(decodeImageData(base64).equals(PNG)).toBe(true);
    expect(decodeImageData(`data:image/png;base64,${base64}`).equals(PNG)).toBe(true);
  });

  it("tolère les retours à la ligne du base64", () => {
    const base64 = JPEG.toString("base64");
    expect(decodeImageData(`${base64.slice(0, 4)}\n${base64.slice(4)}`).equals(JPEG)).toBe(true);
  });

  it("refuse ce qui n'est pas du base64", () => {
    expect(() => decodeImageData("https://exemple.fr/image.jpg")).toThrow(/base64/);
    expect(() => decodeImageData("")).toThrow(/base64/);
  });
});

describe("validateImage", () => {
  it("renvoie type et extension", () => {
    expect(validateImage(JPEG)).toEqual({ mimeType: "image/jpeg", ext: ".jpg" });
  });

  it("refuse une image au-delà de 10 MB", () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_EXTERNAL_IMAGE_SIZE)]);
    expect(() => validateImage(big)).toThrow(/trop volumineuse/);
  });

  it("refuse un format non reconnu", () => {
    expect(() => validateImage(Buffer.from("pas une image"))).toThrow(/Format/);
  });
});

describe("normalizePageIds", () => {
  it("laisse un tableau intact", () => {
    expect(normalizePageIds(["a", "b"])).toEqual(["a", "b"]);
  });

  it("accepte un tableau JSON ou une liste séparée par des virgules", () => {
    expect(normalizePageIds('["a","b"]')).toEqual(["a", "b"]);
    expect(normalizePageIds("a, b,")).toEqual(["a", "b"]);
  });
});
