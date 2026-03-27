import { useState, useRef, useEffect } from 'react';
import { ImageIcon, VideoIcon, Play } from 'lucide-react';

interface MediaThumbnailProps {
  src: string;
  alt: string;
  type?: 'image' | 'video';
  className?: string;
  thumbnailUrl?: string;  // Optional pre-generated thumbnail
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|avi|webm|mkv|m4v)(\?.*)?$/i.test(url);
}

/**
 * Renders a media thumbnail that handles:
 * - Local video files: captures first frame as thumbnail
 * - Images: standard <img> with lazy loading
 * - Broken/unavailable URLs: shows a placeholder icon
 */
export function MediaThumbnail({ src, alt, type, className = "w-full h-full object-cover", thumbnailUrl }: MediaThumbnailProps) {
  const [error, setError] = useState(false);
  const [thumbnail, setThumbnail] = useState<string | null>(thumbnailUrl || null);
  const [loading, setLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isVideo = type === 'video' || isVideoUrl(src);

  // Generate thumbnail from video first frame
  useEffect(() => {
    if (!isVideo || thumbnail || error || !src) return;

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata';

    const handleLoadedData = () => {
      // Seek to 1 second or 10% of duration (whichever is smaller)
      const seekTime = Math.min(1, video.duration * 0.1);
      video.currentTime = seekTime;
    };

    const handleSeeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 180;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          setThumbnail(dataUrl);
        }
      } catch (e) {
        console.warn('Failed to generate video thumbnail:', e);
        setError(true);
      }
      video.remove();
    };

    const handleError = () => {
      console.warn('Video thumbnail generation failed for:', src);
      setError(true);
      video.remove();
    };

    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleError);

    setLoading(true);
    video.src = src;
    video.load();

    // Timeout fallback
    const timeout = setTimeout(() => {
      if (!thumbnail) {
        setError(true);
        video.remove();
      }
      setLoading(false);
    }, 5000);

    return () => {
      clearTimeout(timeout);
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
      video.remove();
    };
  }, [src, isVideo, thumbnail, error]);

  // Show placeholder if error or no src
  if ((error && !thumbnail) || !src) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className.replace('object-cover', '')}`}>
        {isVideo
          ? <VideoIcon className="w-8 h-8 text-muted-foreground" />
          : <ImageIcon className="w-8 h-8 text-muted-foreground" />
        }
      </div>
    );
  }

  // Video with generated thumbnail
  if (isVideo) {
    if (thumbnail) {
      return (
        <div className={`relative ${className.replace('object-cover', '')}`}>
          <img
            src={thumbnail}
            alt={alt}
            className={className}
            onError={() => setError(true)}
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
              <Play className="w-5 h-5 text-white fill-white ml-0.5" />
            </div>
          </div>
        </div>
      );
    }

    // Loading state while generating thumbnail
    if (loading) {
      return (
        <div className={`flex items-center justify-center bg-muted animate-pulse ${className.replace('object-cover', '')}`}>
          <VideoIcon className="w-8 h-8 text-muted-foreground" />
        </div>
      );
    }

    // Fallback to video element
    return (
      <div className="relative">
        <video
          ref={videoRef}
          src={src}
          className={className}
          preload="metadata"
          muted
          playsInline
          onError={() => setError(true)}
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
            <Play className="w-5 h-5 text-white fill-white ml-0.5" />
          </div>
        </div>
      </div>
    );
  }

  // Image
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
