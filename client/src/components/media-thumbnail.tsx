import { useState } from 'react';
import { ImageIcon, VideoIcon } from 'lucide-react';

interface MediaThumbnailProps {
  src: string;
  alt: string;
  type?: 'image' | 'video';
  className?: string;
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|avi|webm|mkv|m4v)(\?.*)?$/i.test(url);
}

/**
 * Renders a media thumbnail that handles:
 * - Local video files: uses <video preload="metadata"> to show first frame
 * - Images: standard <img> with lazy loading
 * - Broken/unavailable URLs: shows a placeholder icon
 */
export function MediaThumbnail({ src, alt, type, className = "w-full h-full object-cover" }: MediaThumbnailProps) {
  const [error, setError] = useState(false);
  const isVideo = type === 'video' || isVideoUrl(src);

  if (error || !src) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className.replace('object-cover', '')}`}>
        {isVideo
          ? <VideoIcon className="w-8 h-8 text-muted-foreground" />
          : <ImageIcon className="w-8 h-8 text-muted-foreground" />
        }
      </div>
    );
  }

  if (isVideo) {
    return (
      <video
        src={src}
        className={className}
        preload="metadata"
        muted
        onError={() => setError(true)}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setError(true)}
    />
  );
}
