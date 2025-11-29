import { parse } from 'twemoji-parser';
import { createCanvas, loadImage, CanvasRenderingContext2D } from 'canvas';

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
   * Convert default Twemoji URL to jsDelivr CDN (more reliable)
   * Example: https://twemoji.maxcdn.com/v/latest/72x72/1f600.png
   * Becomes: https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/1f600.png
   */
  private convertToReliableCDN(url: string): string {
    // Extract the emoji filename (e.g., "1f600.png")
    const match = url.match(/\/([a-f0-9\-]+\.png)$/i);
    if (!match) return url;

    const filename = match[1];
    // Use jsDelivr CDN which is more reliable
    return `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${filename}`;
  }

  /**
   * Download and cache emoji image with retry logic
   */
  private async getEmojiImage(url: string): Promise<Buffer> {
    // Use reliable CDN URL
    const reliableUrl = this.convertToReliableCDN(url);

    if (this.emojiCache.has(reliableUrl)) {
      return this.emojiCache.get(reliableUrl)!;
    }

    console.log('🔍 Téléchargement emoji depuis:', reliableUrl);

    // Retry logic: try up to 3 times
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        const response = await fetch(reliableUrl, {
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        console.log('✅ Emoji téléchargé avec succès');
        const buffer = Buffer.from(await response.arrayBuffer());
        this.emojiCache.set(reliableUrl, buffer);
        return buffer;
      } catch (error) {
        lastError = error as Error;
        console.warn(`⚠️ Tentative ${attempt}/3 échouée:`, error instanceof Error ? error.message : error);

        if (attempt < 3) {
          // Wait before retry (exponential backoff: 500ms, 1000ms)
          await new Promise(resolve => setTimeout(resolve, attempt * 500));
        }
      }
    }

    console.error(`❌ Échec téléchargement emoji après 3 tentatives:`, lastError);
    throw lastError || new Error('Failed to fetch emoji');
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
