import twemoji from 'twemoji';

export interface EmojiSegment {
  type: 'text' | 'emoji';
  content: string;
  url?: string;
}

/**
 * Parse text and identify emoji segments
 * Returns an array of segments with text and emoji parts
 */
export function parseTextWithEmojis(text: string): EmojiSegment[] {
  const segments: EmojiSegment[] = [];
  let lastIndex = 0;

  // Use twemoji to parse and replace emojis
  const parsed = twemoji.parse(text, {
    callback: (icon: string, options: any) => {
      return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${icon}.png`;
    }
  });

  // Extract emoji positions using a temporary div
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = parsed;

  const walker = document.createTreeWalker(
    tempDiv,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    null
  );

  let node;
  let currentText = '';
  
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) {
        currentText += node.textContent;
      }
    } else if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'IMG') {
      // Push any accumulated text before this emoji
      if (currentText) {
        segments.push({ type: 'text', content: currentText });
        currentText = '';
      }
      
      const img = node as HTMLImageElement;
      segments.push({
        type: 'emoji',
        content: img.alt || '',
        url: img.src
      });
    }
  }

  // Push any remaining text
  if (currentText) {
    segments.push({ type: 'text', content: currentText });
  }

  // If no emojis were found, return the original text as a single segment
  if (segments.length === 0) {
    return [{ type: 'text', content: text }];
  }

  return segments;
}

/**
 * Convert text with emojis to HTML string with Twemoji images
 */
export function textToTwemojiHtml(text: string, className?: string): string {
  return twemoji.parse(text, {
    className: className || 'inline-block align-middle',
    callback: (icon: string, options: any) => {
      return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${icon}.png`;
    }
  });
}
