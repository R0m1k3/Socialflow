import { AbsoluteFill, Img, Sequence, useVideoConfig, useCurrentFrame, Html5Audio, spring, interpolate } from "remotion";

export type WordTiming = {
  word: string;
  startFrame: number;
  endFrame: number;
};

export type ImageCompositionProps = {
  images: string[];
  overlayText?: string;
  audioUrl?: string;
  wordTimings?: WordTiming[];
  musicUrl?: string;
  musicVolume?: number;
  logoUrl?: string;
  storeName?: string;
  endingFrames?: number;
};

// Sub-component: one image displayed directly, no entrance transition
const ImageSlide: React.FC<{ src: string }> = ({ src }) => {
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", overflow: "hidden", backgroundColor: "black" }}>
      <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </AbsoluteFill>
  );
};

export const ImageComposition = ({
  images, audioUrl, wordTimings, musicUrl, musicVolume = 0.3,
  logoUrl, storeName, endingFrames = 90,
}: ImageCompositionProps) => {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();

  const hasEnding = !!(logoUrl || storeName);
  const effectiveEndingFrames = hasEnding ? endingFrames : 0;
  const contentFrames = durationInFrames - effectiveEndingFrames;
  const durationPerImage = Math.floor(contentFrames / Math.max(images.length, 1));
  const endingStart = contentFrames;

  // Ending slide spring animation
  const endingProgress = spring({
    frame: frame - endingStart,
    fps,
    config: { damping: 20, stiffness: 80 },
    durationInFrames: 30,
  });

  // Current active word (wordTimings only contains spoken words — no hashtags/emojis)
  const activeWordIdx = wordTimings
    ? wordTimings.findIndex(w => frame >= w.startFrame && frame < w.endFrame)
    : -1;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {/* Images — displayed immediately, no entrance transition */}
      {images.map((imgUrl, index) => (
        <Sequence key={index} from={index * durationPerImage} durationInFrames={durationPerImage}>
          <ImageSlide src={imgUrl} />
        </Sequence>
      ))}

      {/* TTS Audio */}
      {audioUrl && <Html5Audio src={audioUrl} />}

      {/* Background music */}
      {musicUrl && <Html5Audio src={musicUrl} volume={musicVolume} />}

      {/* Word overlay — TikTok style, 3 spoken words at a time, synced to TTS */}
      {frame < endingStart && wordTimings && wordTimings.length > 0 && activeWordIdx >= 0 && (() => {
        const groupIdx = Math.floor(activeWordIdx / 3);
        const groupStart = groupIdx * 3;
        const groupWords = wordTimings.slice(groupStart, groupStart + 3);
        return (
          <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 160 }}>
            <div
              style={{
                maxWidth: "88%",
                textAlign: "center",
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: "0 18px",
                alignItems: "baseline",
                filter: "drop-shadow(0 2px 12px rgba(0,0,0,0.7))",
              }}
            >
              {groupWords.map((w, gi) => {
                const isActive = groupStart + gi === activeWordIdx;
                return (
                  <span
                    key={groupStart + gi}
                    style={{
                      color: isActive ? "#FFE600" : "white",
                      fontFamily: "'Arial Black', 'Impact', sans-serif",
                      fontSize: 76,
                      fontWeight: 900,
                      lineHeight: 1.2,
                      WebkitTextStroke: isActive ? "3px rgba(0,0,0,0.8)" : "2px rgba(0,0,0,0.7)",
                      textShadow: "0 4px 20px rgba(0,0,0,0.9)",
                      display: "inline-block",
                      textTransform: "uppercase",
                      transform: isActive ? "scale(1.08)" : "scale(1)",
                    }}
                  >
                    {w.word}
                  </span>
                );
              })}
            </div>
          </AbsoluteFill>
        );
      })()}

      {/* Logo watermark — bottom right during content */}
      {logoUrl && frame < endingStart && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-end", padding: 48 }}>
          <Img
            src={logoUrl}
            style={{
              width: 150,
              height: 150,
              objectFit: "contain",
              opacity: 0.85,
              borderRadius: 20,
              filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.5))",
            }}
          />
        </AbsoluteFill>
      )}

      {/* Ending slide — large centered logo + store name */}
      {hasEnding && (
        <Sequence from={endingStart} durationInFrames={effectiveEndingFrames}>
          <AbsoluteFill
            style={{
              backgroundColor: "black",
              justifyContent: "center",
              alignItems: "center",
              flexDirection: "column",
              gap: 48,
            }}
          >
            {logoUrl && (
              <Img
                src={logoUrl}
                style={{
                  width: 520,
                  height: 520,
                  objectFit: "contain",
                  opacity: endingProgress,
                  transform: `scale(${interpolate(endingProgress, [0, 1], [0.65, 1])})`,
                  borderRadius: 32,
                  filter: "drop-shadow(0 4px 32px rgba(255,255,255,0.2))",
                }}
              />
            )}
            {storeName && (
              <div
                style={{
                  color: "white",
                  fontSize: 90,
                  fontFamily: "'Arial Black', Impact, sans-serif",
                  fontWeight: 900,
                  textAlign: "center",
                  opacity: endingProgress,
                  letterSpacing: 3,
                  textShadow: "0 4px 24px rgba(255,255,255,0.2)",
                  transform: `translateY(${interpolate(endingProgress, [0, 1], [30, 0])}px)`,
                }}
              >
                {storeName}
              </div>
            )}
          </AbsoluteFill>
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
