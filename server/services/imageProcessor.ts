import sharp from "sharp";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";

interface CropDimensions {
  width: number;
  height: number;
}

interface ProcessedImages {
  facebookFeed: string;
  instagramFeed: string;
  instagramStory: string;
}

const CROP_FORMATS = {
  facebookFeed: { width: 1200, height: 630 } as CropDimensions,
  instagramFeed: { width: 1080, height: 1080 } as CropDimensions,
  instagramStory: { width: 1080, height: 1920 } as CropDimensions,
};

export class ImageProcessor {
  private uploadsDir: string;

  constructor() {
    this.uploadsDir = path.join(process.cwd(), "uploads");
    this.ensureUploadsDirExists();
  }

  private async ensureUploadsDirExists() {
    try {
      await fs.access(this.uploadsDir);
    } catch {
      await fs.mkdir(this.uploadsDir, { recursive: true });
    }
  }

  async processImage(buffer: Buffer, originalFilename: string): Promise<ProcessedImages> {
    const fileExt = path.extname(originalFilename);
    const baseId = randomUUID();

    const processedImages: ProcessedImages = {
      facebookFeed: "",
      instagramFeed: "",
      instagramStory: "",
    };

    // Process Facebook Feed (1200x630)
    const fbFeedFilename = `${baseId}-fb-feed${fileExt}`;
    const fbFeedPath = path.join(this.uploadsDir, fbFeedFilename);
    await sharp(buffer)
      .resize(CROP_FORMATS.facebookFeed.width, CROP_FORMATS.facebookFeed.height, {
        fit: "cover",
        position: "center",
      })
      .toFile(fbFeedPath);
    processedImages.facebookFeed = `/uploads/${fbFeedFilename}`;

    // Process Instagram Feed (1080x1080)
    const igFeedFilename = `${baseId}-ig-feed${fileExt}`;
    const igFeedPath = path.join(this.uploadsDir, igFeedFilename);
    await sharp(buffer)
      .resize(CROP_FORMATS.instagramFeed.width, CROP_FORMATS.instagramFeed.height, {
        fit: "cover",
        position: "center",
      })
      .toFile(igFeedPath);
    processedImages.instagramFeed = `/uploads/${igFeedFilename}`;

    // Process Instagram Story (1080x1920)
    const igStoryFilename = `${baseId}-ig-story${fileExt}`;
    const igStoryPath = path.join(this.uploadsDir, igStoryFilename);
    await sharp(buffer)
      .resize(CROP_FORMATS.instagramStory.width, CROP_FORMATS.instagramStory.height, {
        fit: "cover",
        position: "center",
      })
      .toFile(igStoryPath);
    processedImages.instagramStory = `/uploads/${igStoryFilename}`;

    return processedImages;
  }

  async saveOriginalFile(buffer: Buffer, filename: string): Promise<string> {
    const uniqueFilename = `${randomUUID()}-${filename}`;
    const filePath = path.join(this.uploadsDir, uniqueFilename);
    await fs.writeFile(filePath, buffer);
    return `/uploads/${uniqueFilename}`;
  }

  async deleteFile(filePath: string): Promise<void> {
    try {
      const fullPath = path.join(process.cwd(), filePath);
      await fs.unlink(fullPath);
    } catch (error) {
      console.error("Error deleting file:", error);
    }
  }
}

export const imageProcessor = new ImageProcessor();
