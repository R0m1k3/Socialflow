import { parse } from 'twemoji-parser';
import { createCanvas, loadImage, CanvasRenderingContext2D } from 'canvas';
import fetch from 'node-fetch';

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
   * Download and cache emoji image
   */
  private async getEmojiImage(url: string): Promise<Buffer> {
    if (this.emojiCache.has(url)) {
      return this.emojiCache.get(url)!;
    }

    const response = await fetch(url);
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
          
          // Draw emoji slightly above baseline to align with text
          const emojiSize = fontSize;
          const emojiY = y - fontSize * 0.8; // Adjust vertical position
          
          ctx.drawImage(emojiImage, currentX, emojiY, emojiSize, emojiSize);
          currentX += emojiSize;
        } catch (error) {
          console.error('Error loading emoji:', error);
          // Fallback: draw text representation
          ctx.fillText(segment.content, currentX, y);
          currentX += ctx.measureText(segment.content).width;
        }
      }
    }
  }

  /**
   * Wrap text with emojis into multiple lines
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

  /**
   * Clear emoji cache
   */
  clearCache(): void {
    this.emojiCache.clear();
  }
}

// Singleton instance
export const emojiRenderer = new EmojiRenderer();
