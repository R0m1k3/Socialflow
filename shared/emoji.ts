/**
 * Removes hashtags from text while preserving emojis and other content
 * Matches patterns like #hashtag, #HashTag123, etc.
 */
export function removeHashtags(text: string): string {
  return text
    .replace(/#[\w\u00C0-\u017F]+/g, '') // Remove hashtags (supports accented characters)
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}
