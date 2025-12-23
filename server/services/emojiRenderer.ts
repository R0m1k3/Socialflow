import { parse } from 'twemoji-parser';
import { createCanvas, loadImage, CanvasRenderingContext2D } from 'canvas';
import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

interface EmojiSegment {
  type: 'text' | 'emoji';
  content: string;
  url?: string;
}

/**
 * Service to render text with emojis on canvas using Twemoji
 * Converts emojis to images and renders them alongside text
 */
export class EmojiRenderer {
  private emojiCache = new Map<string, Buffer>();
  private emojiAssetsDir = path.join(process.cwd(), 'server', 'assets', 'emoji');

  /**
   * Parse text into segments of text and emojis
   */
  private parseTextWithEmojis(text: string): EmojiSegment[] {
    const emojis = parse(text);

    if (emojis.length > 0) {
      console.log(`📝 Texte avec ${emojis.length} emoji(s) détecté(s)`);
    }

    if (emojis.length === 0) {
      return [{ type: 'text', content: text }];
    }

    const segments: EmojiSegment[] = [];
    let lastIndex = 0;

    for (const emoji of emojis) {
      // Add text before emoji
      if (emoji.indices[0] > lastIndex) {
        const textContent = text.substring(lastIndex, emoji.indices[0]);
        if (textContent) {
          segments.push({ type: 'text', content: textContent });
        }
      }

      // Add emoji
      segments.push({
        type: 'emoji',
        content: emoji.text,
        url: emoji.url
      });

      lastIndex = emoji.indices[1];
    }

    // Add remaining text
    if (lastIndex < text.length) {
      const textContent = text.substring(lastIndex);
      if (textContent) {
        segments.push({ type: 'text', content: textContent });
      }
    }

    return segments;
  }

  /**
   * Extract emoji filename from URL
   * Example: https://twemoji.maxcdn.com/v/latest/72x72/1f600.png => 1f600.png
   */
  private getEmojiFilename(url: string): string | null {
    const match = url.match(/\/([a-f0-9\-]+\.png)$/i);
    return match ? match[1] : null;
  }

  /**
   * Ensure emoji assets directory exists
   */
  private async ensureEmojiDir(): Promise<void> {
    try {
      await fs.access(this.emojiAssetsDir);
    } catch {
      await fs.mkdir(this.emojiAssetsDir, { recursive: true });
    }
  }

  /**
   * Download emoji from CDN and save locally
   */
  private async downloadEmoji(filename: string): Promise<Buffer> {
    const url = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${filename}`;
    const localPath = path.join(this.emojiAssetsDir, filename);

    console.log(`🔍 Téléchargement emoji: ${filename}`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Save to disk for future use
      await fs.writeFile(localPath, buffer);
      console.log(`✅ Emoji sauvegardé: ${filename}`);

      return buffer;
    } catch (error) {
      console.error(`❌ Erreur téléchargement ${filename}:`, error instanceof Error ? error.message : error);
      throw error;
    }
  }

  /**
   * Get emoji image - from cache, disk, or download
   */
  private async getEmojiImage(url: string): Promise<Buffer> {
    const filename = this.getEmojiFilename(url);
    if (!filename) {
      throw new Error(`Invalid emoji URL: ${url}`);
    }

    // Check memory cache first
    const cacheKey = filename;
    if (this.emojiCache.has(cacheKey)) {
      return this.emojiCache.get(cacheKey)!;
    }

    // Ensure directory exists
    await this.ensureEmojiDir();

    // Check if file exists locally
    const localPath = path.join(this.emojiAssetsDir, filename);
    try {
      const buffer = await fs.readFile(localPath);
      this.emojiCache.set(cacheKey, buffer);
      return buffer;
    } catch {
      // File doesn't exist locally, download it
      const buffer = await this.downloadEmoji(filename);
      this.emojiCache.set(cacheKey, buffer);
      return buffer;
    }
  }

  /**
   * Measure the width of text with emojis
   */
  async measureText(text: string, ctx: CanvasRenderingContext2D, fontSize: number): Promise<number> {
    const segments = this.parseTextWithEmojis(text);
    let totalWidth = 0;

    for (const segment of segments) {
      if (segment.type === 'text') {
        totalWidth += ctx.measureText(segment.content).width;
      } else {
        // Emoji width is approximately equal to font size
        totalWidth += fontSize;
      }
    }

    return totalWidth;
  }

  /**
   * Draw text with emojis on canvas
   */
  async drawText(
    text: string,
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    fontSize: number
  ): Promise<void> {
    const segments = this.parseTextWithEmojis(text);
    let currentX = x;

    for (const segment of segments) {
      if (segment.type === 'text') {
        ctx.fillText(segment.content, currentX, y);
        currentX += ctx.measureText(segment.content).width;
      } else if (segment.url) {
        try {
          const emojiBuffer = await this.getEmojiImage(segment.url);
          const emojiImage = await loadImage(emojiBuffer);

          // Draw emoji centered vertically with text
          // When textBaseline is 'middle', y represents the vertical center
          const emojiSize = fontSize;
          const emojiY = y - (emojiSize / 2); // Center the emoji around y

          ctx.drawImage(emojiImage, currentX, emojiY, emojiSize, emojiSize);
          currentX += emojiSize;
        } catch (error) {
          console.error(`❌ Impossible de charger l'emoji "${segment.content}":`, error instanceof Error ? error.message : error);
          // Fallback: draw text representation
          ctx.fillText(segment.content, currentX, y);
          currentX += ctx.measureText(segment.content).width;
        }
      }
    }
  }

  /**
   * Break a long word that exceeds maxWidth into chunks
   */
  private async breakLongWord(
    word: string,
    ctx: CanvasRenderingContext2D,
    maxWidth: number,
    fontSize: number
  ): Promise<string[]> {
    const chunks: string[] = [];
    let currentChunk = '';

    // Split word into individual characters (graphemes for emoji support)
    const chars = Array.from(word);

    for (const char of chars) {
      const testChunk = currentChunk + char;
      const width = await this.measureText(testChunk, ctx, fontSize);

      if (width > maxWidth && currentChunk) {
        chunks.push(currentChunk);
        currentChunk = char;
      } else {
        currentChunk = testChunk;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Wrap text with emojis into multiple lines
   * Handles long words/emoji sequences by breaking them when needed
   */
  async wrapText(
    text: string,
    ctx: CanvasRenderingContext2D,
    maxWidth: number,
    fontSize: number
  ): Promise<string[]> {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = await this.measureText(testLine, ctx, fontSize);

      if (testWidth > maxWidth && currentLine) {
        // Current line would exceed width, push it and start new line
        lines.push(currentLine);
        currentLine = word;

        // Check if the word itself is too long for a single line
        const wordWidth = await this.measureText(word, ctx, fontSize);
        if (wordWidth > maxWidth) {
          // Word is too long, need to break it into chunks
          const chunks = await this.breakLongWord(word, ctx, maxWidth, fontSize);
          for (let i = 0; i < chunks.length - 1; i++) {
            lines.push(chunks[i]);
          }
          currentLine = chunks[chunks.length - 1];
        }
      } else if (testWidth > maxWidth && !currentLine) {
        // First word is too long, need to break it
        const chunks = await this.breakLongWord(word, ctx, maxWidth, fontSize);
        for (let i = 0; i < chunks.length - 1; i++) {
          lines.push(chunks[i]);
        }
        currentLine = chunks[chunks.length - 1];
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines;
  }

  /**
   * Clear emoji cache
   */
  clearCache(): void {
    this.emojiCache.clear();
  }
}

// Singleton instance
export const emojiRenderer = new EmojiRenderer();
