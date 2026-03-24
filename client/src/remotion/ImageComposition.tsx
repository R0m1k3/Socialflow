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
  endingFrames?: number; // frames reserved for ending slide (default 90 = 3s at 30fps)
};

// 6 modern, simple entrance transitions
type Transition = "fade" | "slideLeft" | "slideRight" | "zoomIn" | "zoomOut" | "slideUp";
const TRANSITIONS: Transition[] = ["zoomIn", "slideLeft", "fade", "slideRight", "zoomOut", "slideUp"];

// Deterministic "random" — varied order that never repeats two in a row
const TRANSITION_ORDER = [0, 1, 2, 3, 4, 5, 1, 3, 0, 4, 2, 5];
function pickTransition(index: number): Transition {
  return TRANSITIONS[TRANSITION_ORDER[index % TRANSITION_ORDER.length]];
}

// Sub-component: one image with its entrance spring animation
const ImageSlide: React.FC<{ src: string; transition: Transition }> = ({ src, transition }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({ frame, fps, config: { damping: 22, stiffness: 160 }, durationInFrames: 22 });

  let wrapStyle: React.CSSProperties = {};
  switch (transition) {
    case "fade":
      wrapStyle = { opacity: progress };
      break;
    case "slideLeft":
      wrapStyle = {
        opacity: interpolate(progress, [0, 0.4], [0, 1], { extrapolateRight: "clamp" }),
        transform: `translateX(${interpolate(progress, [0, 1], [110, 0])}%)`,
      };
      break;
    case "slideRight":
      wrapStyle = {
        opacity: interpolate(progress, [0, 0.4], [0, 1], { extrapolateRight: "clamp" }),
        transform: `translateX(${interpolate(progress, [0, 1], [-110, 0])}%)`,
      };
      break;
    case "slideUp":
      wrapStyle = {
        opacity: interpolate(progress, [0, 0.4], [0, 1], { extrapolateRight: "clamp" }),
        transform: `translateY(${interpolate(progress, [0, 1], [80, 0])}%)`,
      };
      break;
    case "zoomIn":
      wrapStyle = {
        opacity: interpolate(progress, [0, 0.5], [0, 1], { extrapolateRight: "clamp" }),
        transform: `scale(${interpolate(progress, [0, 1], [0.75, 1])})`,
      };
      break;
    case "zoomOut":
      wrapStyle = {
        opacity: interpolate(progress, [0, 0.5], [0, 1], { extrapolateRight: "clamp" }),
        transform: `scale(${interpolate(progress, [0, 1], [1.25, 1])})`,
      };
      break;
  }

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", overflow: "hidden", ...wrapStyle }}>
      <Img src={src} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
    </AbsoluteFill>
  );
};

export const ImageComposition = ({
  images, overlayText, audioUrl, wordTimings, musicUrl, musicVolume = 0.3,
  logoUrl, storeName, endingFrames = 90,
}: ImageCompositionProps) => {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();

  // Reserve last endingFrames for the ending slide; spread images across the rest
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

  const activeWordIdx = wordTimings
    ? wordTimings.findIndex(w => frame >= w.startFrame && frame < w.endFrame)
    : -1;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {/* Images with entrance transitions */}
      {images.map((imgUrl, index) => (
        <Sequence key={index} from={index * durationPerImage} durationInFrames={durationPerImage}>
          <ImageSlide src={imgUrl} transition={pickTransition(index)} />
        </Sequence>
      ))}

      {/* TTS Audio */}
      {audioUrl && <Html5Audio src={audioUrl} />}

      {/* Background music */}
      {musicUrl && <Html5Audio src={musicUrl} volume={musicVolume} />}

      {/* TikTok-style 3-words-at-a-time overlay (content section only) */}
      {frame < endingStart && (
        wordTimings && wordTimings.length > 0 && activeWordIdx >= 0 ? (() => {
          // Group index: which chunk of 3 is currently active
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
        })() : overlayText ? (
          <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 160 }}>
            <div
              style={{
                backgroundColor: "rgba(0,0,0,0.55)",
                borderRadius: 16,
                padding: "24px 32px",
                color: "white",
                fontSize: 60,
                fontWeight: "bold",
                fontFamily: "sans-serif",
                textAlign: "center",
                lineHeight: 1.4,
                maxWidth: "90%",
                WebkitTextStroke: "1px rgba(0,0,0,0.4)",
              }}
            >
              {overlayText}
            </div>
          </AbsoluteFill>
        ) : null
      )}

      {/* Logo watermark — bottom right, always visible during content */}
      {logoUrl && frame < endingStart && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-end", padding: 48 }}>
          <Img
            src={logoUrl}
            style={{
              width: 130,
              height: 130,
              objectFit: "contain",
              opacity: 0.82,
              borderRadius: 16,
              filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.5))",
            }}
          />
        </AbsoluteFill>
      )}

      {/* Ending slide — centered logo + store name */}
      {hasEnding && (
        <Sequence from={endingStart} durationInFrames={effectiveEndingFrames}>
          <AbsoluteFill
            style={{
              backgroundColor: "black",
              justifyContent: "center",
              alignItems: "center",
              flexDirection: "column",
              gap: 40,
            }}
          >
            {logoUrl && (
              <Img
                src={logoUrl}
                style={{
                  width: 300,
                  height: 300,
                  objectFit: "contain",
                  opacity: endingProgress,
                  transform: `scale(${interpolate(endingProgress, [0, 1], [0.65, 1])})`,
                  borderRadius: 24,
                  filter: "drop-shadow(0 4px 24px rgba(255,255,255,0.15))",
                }}
              />
            )}
            {storeName && (
              <div
                style={{
                  color: "white",
                  fontSize: 80,
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
