import emojiRegex from 'emoji-regex';

// Cached regex instance for performance
const emojiPattern = emojiRegex();

/**
 * Removes emojis from text while preserving other Unicode characters
 * Uses the emoji-regex package which correctly identifies emojis without
 * removing legitimate astral-plane characters (CJK Extension B, etc.)
 */
export function removeEmojis(text: string): string {
  return text
    .replace(emojiPattern, '')
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}
