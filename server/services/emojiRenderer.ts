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
    console.log(`📝 Parse texte: "${text}" => ${emojis.length} emoji(s) trouvé(s)`);

    if (emojis.length === 0) {
      return [{ type: 'text', content: text }];
    }

    const segments: EmojiSegment[] = [];
    let lastIndex = 0;

    for (const emoji of emojis) {
      console.log(`  - Emoji détecté: "${emoji.text}" => URL: ${emoji.url}`);

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
   * Download and cache emoji image
   */
  private async getEmojiImage(url: string): Promise<Buffer> {
    if (this.emojiCache.has(url)) {
      return this.emojiCache.get(url)!;
    }

    console.log('🔍 Téléchargement emoji depuis:', url);
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`❌ Erreur téléchargement emoji: ${response.status} ${response.statusText}`);
      throw new Error(`Failed to fetch emoji: ${response.status}`);
    }

    console.log('✅ Emoji téléchargé avec succès');
    const buffer = Buffer.from(await response.arrayBuffer());
    this.emojiCache.set(url, buffer);
    return buffer;
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
          console.log(`✅ Emoji "${segment.content}" dessiné avec succès`);
        } catch (error) {
          console.error(`❌ Erreur lors du chargement/rendu de l'emoji "${segment.content}":`, error);
          console.error('   URL:', segment.url);
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
