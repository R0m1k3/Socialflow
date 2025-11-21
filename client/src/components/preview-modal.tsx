import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, Send, Facebook, Instagram, Heart, MessageCircle, Share2, Bookmark } from 'lucide-react';
import type { Media } from '@shared/schema';
import { removeHashtags } from '@shared/emoji';

interface PreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postText: string;
  selectedMedia: string[];
  mediaList: Media[];
  onPublish: () => void;
  isPublishing: boolean;
  readOnly?: boolean;
}

type PreviewFormat = 'facebook-feed' | 'facebook-story' | 'instagram-feed' | 'instagram-story';

export function PreviewModal({
  open,
  onOpenChange,
  postText,
  selectedMedia,
  mediaList,
  onPublish,
  isPublishing,
  readOnly = false
}: PreviewModalProps) {
  const [previewFormat, setPreviewFormat] = useState<PreviewFormat>('facebook-feed');
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);

  const orderedMedia = selectedMedia
    .map(id => mediaList.find(m => m.id === id))
    .filter((m): m is Media => m !== undefined);

  // Reset photo index when modal opens or media changes
  useEffect(() => {
    if (open) {
      setCurrentPhotoIndex(0);
    }
  }, [open, selectedMedia.length]);

  const nextPhoto = () => {
    setCurrentPhotoIndex((prev) => (prev + 1) % orderedMedia.length);
  };

  const prevPhoto = () => {
    setCurrentPhotoIndex((prev) => (prev - 1 + orderedMedia.length) % orderedMedia.length);
  };

  const goToPhoto = (index: number) => {
    setCurrentPhotoIndex(index);
  };

  const getMediaUrl = (media: Media) => {
    if (previewFormat === 'facebook-feed') {
      return media.facebookFeedUrl || media.originalUrl;
    } else if (previewFormat === 'instagram-feed') {
      return media.instagramFeedUrl || media.originalUrl;
    } else {
      return media.instagramStoryUrl || media.originalUrl;
    }
  };

  const renderMedia = (media: Media, className: string = "w-full h-auto") => {
    const url = getMediaUrl(media);
    
    if (media.type === 'video') {
      return (
        <video
          src={url}
          className={className}
          controls
          playsInline
          data-testid="video-preview"
        />
      );
    }
    
    return (
      <img
        src={url}
        alt={`Photo ${currentPhotoIndex + 1}`}
        className={className}
      />
    );
  };

  const renderFacebookFeed = () => (
    <div className="bg-white rounded-lg overflow-hidden border border-gray-200 max-w-lg mx-auto">
      {/* Header */}
      <div className="p-3 flex items-center gap-3 border-b border-gray-200">
        <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center">
          <Facebook className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-sm text-gray-900">Votre Page</div>
          <div className="text-xs text-gray-500">À l'instant</div>
        </div>
      </div>

      {/* Text */}
      {postText && (
        <div className="p-3 text-sm text-gray-900 whitespace-pre-wrap">
          {postText}
        </div>
      )}

      {/* Media Carousel */}
      {orderedMedia.length > 0 && (
        <div className="relative bg-black">
          {renderMedia(orderedMedia[currentPhotoIndex], "w-full h-auto")}
          {orderedMedia.length > 1 && (
            <>
              <button
                onClick={prevPhoto}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center hover:bg-white transition-colors"
                data-testid="button-prev-photo"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={nextPhoto}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center hover:bg-white transition-colors"
                data-testid="button-next-photo"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                {orderedMedia.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => goToPhoto(idx)}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      idx === currentPhotoIndex ? 'bg-white' : 'bg-white/50'
                    }`}
                    data-testid={`button-photo-indicator-${idx}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="p-3 flex items-center gap-4 border-t border-gray-200">
        <Heart className="w-5 h-5 text-gray-600" />
        <MessageCircle className="w-5 h-5 text-gray-600" />
        <Share2 className="w-5 h-5 text-gray-600" />
      </div>
    </div>
  );

  const renderInstagramFeed = () => (
    <div className="bg-white rounded-lg overflow-hidden border border-gray-200 max-w-lg mx-auto">
      {/* Header */}
      <div className="p-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 flex items-center justify-center">
          <Instagram className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-sm text-gray-900">votre_page</div>
        </div>
      </div>

      {/* Media Carousel */}
      {orderedMedia.length > 0 && (
        <div className="relative bg-black aspect-square">
          {renderMedia(orderedMedia[currentPhotoIndex], "w-full h-full object-cover")}
          {orderedMedia.length > 1 && (
            <>
              <button
                onClick={prevPhoto}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
                data-testid="button-prev-photo"
              >
                <ChevronLeft className="w-5 h-5 text-white" />
              </button>
              <button
                onClick={nextPhoto}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
                data-testid="button-next-photo"
              >
                <ChevronRight className="w-5 h-5 text-white" />
              </button>
              <div className="absolute top-3 left-1/2 -translate-x-1/2 flex gap-1">
                {orderedMedia.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => goToPhoto(idx)}
                    className={`h-1 flex-1 transition-colors rounded ${
                      idx === currentPhotoIndex ? 'bg-white' : 'bg-white/50'
                    }`}
                    style={{ width: '40px' }}
                    data-testid={`button-photo-indicator-${idx}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="p-3 flex items-center gap-4">
        <Heart className="w-6 h-6" />
        <MessageCircle className="w-6 h-6" />
        <Share2 className="w-6 h-6" />
        <Bookmark className="w-6 h-6 ml-auto" />
      </div>

      {/* Text */}
      {postText && (
        <div className="px-3 pb-3">
          <span className="font-semibold text-sm">votre_page</span>
          <span className="text-sm ml-2">{postText}</span>
        </div>
      )}
    </div>
  );

  const wrapText = (text: string, maxWidth: number, fontSize: number): string[] => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return [text];

    // Remove hashtags while keeping emojis
    const cleanText = removeHashtags(text);
    ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    const words = cleanText.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxWidth && currentLine) {
        // Current line would exceed width, push it and start new line
        lines.push(currentLine);
        currentLine = word;
        
        // Check if the word itself is too long for a single line
        const wordMetrics = ctx.measureText(word);
        if (wordMetrics.width > maxWidth) {
          // Word is too long, need to break it into chunks
          const chunks = breakLongWord(ctx, word, maxWidth);
          for (let i = 0; i < chunks.length - 1; i++) {
            lines.push(chunks[i]);
          }
          currentLine = chunks[chunks.length - 1];
        }
      } else if (metrics.width > maxWidth && !currentLine) {
        // First word is too long, need to break it
        const chunks = breakLongWord(ctx, word, maxWidth);
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
  };

  /**
   * Breaks a long word into chunks that fit within maxWidth
   */
  const breakLongWord = (ctx: CanvasRenderingContext2D, word: string, maxWidth: number): string[] => {
    const chunks: string[] = [];
    let currentChunk = '';
    
    for (let i = 0; i < word.length; i++) {
      const char = word[i];
      const testChunk = currentChunk + char;
      const metrics = ctx.measureText(testChunk);
      
      if (metrics.width > maxWidth && currentChunk) {
        chunks.push(currentChunk);
        currentChunk = char;
      } else {
        currentChunk = testChunk;
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    
    return chunks.length > 0 ? chunks : [word];
  };

  const calculateAdaptiveFontSize = (text: string, containerWidth: number, containerHeight: number): { fontSize: number; lines: string[]; isTruncated: boolean } => {
    const MIN_FONT_SIZE = 12;
    const MAX_FONT_SIZE = 72;
    const LINE_HEIGHT_MULTIPLIER = 1.2;
    
    let fontSize = MAX_FONT_SIZE;
    let lines: string[] = [];
    let totalTextHeight = 0;
    
    while (fontSize >= MIN_FONT_SIZE) {
      lines = wrapText(text, containerWidth, fontSize);
      const lineHeight = fontSize * LINE_HEIGHT_MULTIPLIER;
      totalTextHeight = lines.length * lineHeight;
      
      if (totalTextHeight <= containerHeight) {
        break;
      }
      
      fontSize -= 2;
    }

    let isTruncated = false;
    
    if (fontSize < MIN_FONT_SIZE) {
      fontSize = MIN_FONT_SIZE;
      lines = wrapText(text, containerWidth, fontSize);
      const lineHeight = fontSize * LINE_HEIGHT_MULTIPLIER;
      totalTextHeight = lines.length * lineHeight;
      
      const maxLines = Math.floor(containerHeight / lineHeight);
      if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        if (lines[maxLines - 1]) {
          lines[maxLines - 1] = lines[maxLines - 1].substring(0, lines[maxLines - 1].length - 3) + '...';
        }
        isTruncated = true;
      }
    }

    return { fontSize, lines, isTruncated };
  };

  const renderStory = (platform: 'facebook' | 'instagram') => {
    const STORY_WIDTH = 360;
    const STORY_HEIGHT = 640;
    const TEXT_BOX_HEIGHT_RATIO = 0.25;
    const PADDING = 16;
    
    const textBoxHeight = STORY_HEIGHT * TEXT_BOX_HEIGHT_RATIO;
    const maxTextWidth = STORY_WIDTH - (PADDING * 2);
    const maxTextHeight = textBoxHeight - (PADDING * 2);

    const { fontSize, lines } = postText 
      ? calculateAdaptiveFontSize(postText, maxTextWidth, maxTextHeight)
      : { fontSize: 24, lines: [] };

    return (
      <div className="bg-black rounded-lg overflow-hidden mx-auto relative" style={{ width: `${STORY_WIDTH}px`, height: `${STORY_HEIGHT}px` }}>
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 p-3 flex items-center gap-3 z-20">
          {platform === 'instagram' ? (
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 flex items-center justify-center">
              <Instagram className="w-5 h-5 text-white" />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
              <Facebook className="w-5 h-5 text-white" />
            </div>
          )}
          <div className="flex-1">
            <div className="font-semibold text-sm text-white drop-shadow-lg">votre_page</div>
          </div>
        </div>

        {/* Media */}
        {orderedMedia.length > 0 && (
          <div className="relative w-full h-full">
            {renderMedia(orderedMedia[currentPhotoIndex], "w-full h-full object-cover")}
            {orderedMedia.length > 1 && (
              <>
                <div className="absolute top-3 left-3 right-3 flex gap-1 z-20">
                  {orderedMedia.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => goToPhoto(idx)}
                      className={`h-1 flex-1 transition-colors rounded-full ${
                        idx === currentPhotoIndex ? 'bg-white' : 'bg-white/50'
                      }`}
                      data-testid={`button-photo-indicator-${idx}`}
                    />
                  ))}
                </div>
                <button
                  onClick={prevPhoto}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/30 rounded-full flex items-center justify-center hover:bg-black/50 transition-colors z-20"
                  data-testid="button-prev-photo"
                >
                  <ChevronLeft className="w-6 h-6 text-white" />
                </button>
                <button
                  onClick={nextPhoto}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/30 rounded-full flex items-center justify-center hover:bg-black/50 transition-colors z-20"
                  data-testid="button-next-photo"
                >
                  <ChevronRight className="w-6 h-6 text-white" />
                </button>
              </>
            )}
            
            {/* Text overlay box - matching exact server rendering */}
            {postText && (
              <div 
                className="absolute bottom-0 left-0 right-0 flex items-center justify-center z-10"
                style={{ height: `${TEXT_BOX_HEIGHT_RATIO * 100}%` }}
              >
                <div className="absolute inset-0 bg-black/60" />
                <div 
                  className="relative text-white text-center font-bold leading-tight"
                  style={{ 
                    fontSize: `${fontSize}px`,
                    padding: `${PADDING}px`,
                    lineHeight: '1.2'
                  }}
                >
                  {lines.map((line, idx) => (
                    <div key={idx}>{line}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderFacebookStory = () => renderStory('facebook');
  const renderInstagramStory = () => renderStory('instagram');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prévisualisation de la publication</DialogTitle>
          <DialogDescription>
            Visualisez votre publication avant de la publier
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Format selector */}
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium">Format de prévisualisation:</label>
            <Select value={previewFormat} onValueChange={(value: PreviewFormat) => {
              setPreviewFormat(value);
              setCurrentPhotoIndex(0);
            }}>
              <SelectTrigger className="w-64" data-testid="select-preview-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="facebook-feed" data-testid="option-facebook-feed">
                  Feed Facebook (1200x630)
                </SelectItem>
                <SelectItem value="facebook-story" data-testid="option-facebook-story">
                  Story Facebook (1080x1920)
                </SelectItem>
                <SelectItem value="instagram-feed" data-testid="option-instagram-feed">
                  Feed Instagram (1080x1080)
                </SelectItem>
                <SelectItem value="instagram-story" data-testid="option-instagram-story">
                  Story Instagram (1080x1920)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Preview */}
          <div className="border rounded-lg p-6 bg-gray-50">
            {previewFormat === 'facebook-feed' && renderFacebookFeed()}
            {previewFormat === 'facebook-story' && renderFacebookStory()}
            {previewFormat === 'instagram-feed' && renderInstagramFeed()}
            {previewFormat === 'instagram-story' && renderInstagramStory()}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            {readOnly ? (
              <Button
                onClick={() => onOpenChange(false)}
                data-testid="button-close-preview"
              >
                Fermer
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  data-testid="button-cancel-preview"
                >
                  Annuler
                </Button>
                <Button
                  onClick={onPublish}
                  disabled={isPublishing}
                  className="bg-gradient-to-r from-primary to-secondary hover:opacity-90"
                  data-testid="button-publish-from-preview"
                >
                  <Send className="w-4 h-4 mr-2" />
                  {isPublishing ? 'Publication...' : 'Publier'}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
