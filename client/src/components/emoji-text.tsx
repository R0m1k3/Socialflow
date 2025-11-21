import { useMemo } from 'react';
import { parseTextWithEmojis } from '@/lib/emojiUtils';

interface EmojiTextProps {
  text: string;
  className?: string;
  emojiSize?: number;
}

/**
 * Component that renders text with emojis as Twemoji images
 * Matches the backend Twemoji rendering for consistent preview
 */
export function EmojiText({ text, className = '', emojiSize = 20 }: EmojiTextProps) {
  const segments = useMemo(() => parseTextWithEmojis(text), [text]);

  return (
    <span className={className}>
      {segments.map((segment, idx) => {
        if (segment.type === 'text') {
          return <span key={idx}>{segment.content}</span>;
        } else {
          return (
            <img
              key={idx}
              src={segment.url}
              alt={segment.content}
              className="inline-block align-middle"
              style={{
                width: `${emojiSize}px`,
                height: `${emojiSize}px`,
                marginLeft: '2px',
                marginRight: '2px'
              }}
              draggable={false}
            />
          );
        }
      })}
    </span>
  );
}
