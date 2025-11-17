import sharp from "sharp";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";
import { createCanvas, loadImage, registerFont } from "canvas";

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

  async addTextToStoryImage(imageUrl: string, text: string): Promise<Buffer> {
    const STORY_WIDTH = 1080;
    const STORY_HEIGHT = 1920;
    const TEXT_BOX_HEIGHT_RATIO = 0.25;
    const MIN_FONT_SIZE = 24;
    const MAX_FONT_SIZE = 72;
    const PADDING = 40;
    const LINE_HEIGHT_MULTIPLIER = 1.3;

    const canvas = createCanvas(STORY_WIDTH, STORY_HEIGHT);
    const ctx = canvas.getContext('2d');

    const image = await loadImage(imageUrl);
    
    const imgWidth = image.width;
    const imgHeight = image.height;
    const targetRatio = STORY_WIDTH / STORY_HEIGHT;
    const imgRatio = imgWidth / imgHeight;

    let drawWidth, drawHeight, offsetX, offsetY;

    if (imgRatio > targetRatio) {
      drawHeight = STORY_HEIGHT;
      drawWidth = imgWidth * (STORY_HEIGHT / imgHeight);
      offsetX = (STORY_WIDTH - drawWidth) / 2;
      offsetY = 0;
    } else {
      drawWidth = STORY_WIDTH;
      drawHeight = imgHeight * (STORY_WIDTH / imgWidth);
      offsetX = 0;
      offsetY = (STORY_HEIGHT - drawHeight) / 2;
    }

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
    ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);

    const textBoxHeight = STORY_HEIGHT * TEXT_BOX_HEIGHT_RATIO;
    const textBoxY = STORY_HEIGHT - textBoxHeight;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, textBoxY, STORY_WIDTH, textBoxHeight);

    const maxTextWidth = STORY_WIDTH - (PADDING * 2);
    const maxTextHeight = textBoxHeight - (PADDING * 2);

    let fontSize = MAX_FONT_SIZE;
    let lines: string[] = [];
    let totalTextHeight = 0;

    while (fontSize >= MIN_FONT_SIZE) {
      ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      
      lines = this.wrapText(ctx, text, maxTextWidth);
      const lineHeight = fontSize * LINE_HEIGHT_MULTIPLIER;
      totalTextHeight = lines.length * lineHeight;

      if (totalTextHeight <= maxTextHeight) {
        break;
      }

      fontSize -= 2;
    }

    if (fontSize < MIN_FONT_SIZE) {
      fontSize = MIN_FONT_SIZE;
      ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      lines = this.wrapText(ctx, text, maxTextWidth);
      const lineHeight = fontSize * LINE_HEIGHT_MULTIPLIER;
      totalTextHeight = lines.length * lineHeight;
      
      const maxLines = Math.floor(maxTextHeight / lineHeight);
      if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        if (lines[maxLines - 1]) {
          lines[maxLines - 1] = lines[maxLines - 1].substring(0, lines[maxLines - 1].length - 3) + '...';
        }
        totalTextHeight = maxLines * lineHeight;
      }
    }

    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lineHeight = fontSize * LINE_HEIGHT_MULTIPLIER;
    const startY = textBoxY + (textBoxHeight - totalTextHeight) / 2 + lineHeight / 2;

    lines.forEach((line, index) => {
      const y = startY + (index * lineHeight);
      ctx.fillText(line, STORY_WIDTH / 2, y);
    });

    return canvas.toBuffer('image/png');
  }

  private wrapText(ctx: any, text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    
    if (currentLine) {
      lines.push(currentLine);
    }

    return lines;
  }
}

export const imageProcessor = new ImageProcessor();
