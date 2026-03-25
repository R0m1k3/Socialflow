import fs from 'fs';
import path from 'path';

const UPLOADS_BASE = path.resolve(process.cwd(), 'uploads');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getAppUrl(): string {
  return (process.env.APP_URL || 'http://localhost:5555').replace(/\/$/, '');
}

/**
 * Builds the public URL for a locally stored file.
 * objectKey is the relative path from uploads/ (e.g. "media/123-file.jpg").
 * bucketName and publicUrlOverride are ignored (local storage compatibility shim).
 */
export function buildMinioUrl(_bucketName: string, objectKey: string, _publicUrlOverride?: string | null): string {
  return `${getAppUrl()}/uploads/${objectKey}`;
}

class LocalStorageService {
  async uploadMedia(
    file: Buffer | string,
    fileName: string,
    _userId: string,
    _mimeType: string
  ): Promise<{
    publicId: string;
    originalUrl: string;
    facebookFeedUrl: string | null;
    instagramFeedUrl: string | null;
    instagramStoryUrl: string | null;
  }> {
    const dir = path.join(UPLOADS_BASE, 'media');
    ensureDir(dir);

    const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '-');
    const objectKey = `media/${Date.now()}-${safeName}`;
    const filePath = path.join(UPLOADS_BASE, objectKey);

    const body: Buffer = typeof file === 'string' ? fs.readFileSync(file) : file;
    fs.writeFileSync(filePath, body);

    const url = buildMinioUrl('', objectKey);
    return { publicId: objectKey, originalUrl: url, facebookFeedUrl: url, instagramFeedUrl: url, instagramStoryUrl: url };
  }

  async deleteMedia(publicId: string, _userId: string, _mediaType: 'image' | 'video'): Promise<void> {
    const filePath = path.join(UPLOADS_BASE, publicId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  async uploadStoryImageWithText(buffer: Buffer, originalFileName: string): Promise<string> {
    const dir = path.join(UPLOADS_BASE, 'stories');
    ensureDir(dir);

    const safeName = path.basename(originalFileName).replace(/[^a-zA-Z0-9._-]/g, '-');
    const objectKey = `stories/story-${Date.now()}-${safeName}`;

    fs.writeFileSync(path.join(UPLOADS_BASE, objectKey), buffer);
    return buildMinioUrl('', objectKey);
  }

  async uploadLogo(buffer: Buffer, fileName: string): Promise<{ publicId: string; url: string }> {
    const dir = path.join(UPLOADS_BASE, 'logos');
    ensureDir(dir);

    const ext = path.extname(fileName) || '.png';
    const objectKey = `logos/logo-${Date.now()}${ext}`;

    fs.writeFileSync(path.join(UPLOADS_BASE, objectKey), buffer);
    return { publicId: objectKey, url: buildMinioUrl('', objectKey) };
  }

  async deleteLogo(publicId: string): Promise<void> {
    const filePath = path.join(UPLOADS_BASE, publicId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

export const minioService = new LocalStorageService();
