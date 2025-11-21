declare module 'twemoji-parser' {
  export interface EmojiEntity {
    text: string;
    url: string;
    indices: [number, number];
    type: string;
  }

  export function parse(text: string, options?: { buildUrl?: (codePoint: string, assetType: string) => string }): EmojiEntity[];
  export function toCodePoints(unicodeSurrogates: string): string[];
}
