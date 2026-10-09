// Décodage et identification des images reçues par l'API externe : le type
// annoncé par le client (multipart, data URL) n'est pas fiable, iOS et bien des
// scripts envoient « application/octet-stream », donc on lit les octets.

export const MAX_EXTERNAL_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

export const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

/** Type MIME d'après la signature du fichier, ou null si ce n'est pas une image acceptée. */
export function sniffImageMime(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString("latin1"))) {
    return "image/gif";
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") {
    return "image/webp";
  }
  return null;
}

/**
 * Décode une image transmise en base64, brute ou sous forme de data URL
 * (`data:image/png;base64,...`).
 */
export function decodeImageData(data: string): Buffer {
  const match = /^data:[^;,]*;base64,([\s\S]*)$/.exec(data.trim());
  const base64 = (match ? match[1] : data).replace(/\s+/g, "");

  if (base64.length === 0 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(base64)) {
    throw new Error("imageData doit être une image encodée en base64 (ou une data URL)");
  }
  return Buffer.from(base64, "base64");
}

/** Vérifie taille et format ; renvoie le type MIME et l'extension détectés. */
export function validateImage(buffer: Buffer): { mimeType: string; ext: string } {
  if (buffer.length > MAX_EXTERNAL_IMAGE_SIZE) {
    throw new Error(`Image trop volumineuse (${(buffer.length / 1024 / 1024).toFixed(1)} MB, max 10 MB)`);
  }
  const mimeType = sniffImageMime(buffer);
  if (!mimeType) {
    throw new Error("Format d'image non reconnu. Formats acceptés : JPEG, PNG, WebP, GIF");
  }
  return { mimeType, ext: IMAGE_EXTENSIONS[mimeType] };
}

/**
 * `pageIds` arrive en tableau en JSON, mais en texte en multipart :
 * on accepte un tableau JSON (`["a","b"]`) ou une liste séparée par des virgules.
 */
export function normalizePageIds(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return trimmed.split(",").map((id) => id.trim()).filter(Boolean);
}
