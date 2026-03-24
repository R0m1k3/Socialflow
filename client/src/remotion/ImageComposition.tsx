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
  images, overlayText, audioUrl, wordTimings, musicUrl, musicVolume = 0.3
}: ImageCompositionProps) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const durationPerImage = 3 * fps;

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

      {/* TikTok-style word-by-word text overlay */}
      {wordTimings && wordTimings.length > 0 ? (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 120 }}>
          <div
            style={{
              maxWidth: "88%",
              textAlign: "center",
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: "0 14px",
              alignItems: "baseline",
              filter: "drop-shadow(0 2px 12px rgba(0,0,0,0.7))",
            }}
          >
            {wordTimings.map((w, i) => {
              const isActive = i === activeWordIdx;
              const isVisible = w.startFrame <= frame;
              return (
                <span
                  key={i}
                  style={{
                    color: isActive ? "#FFE600" : "white",
                    fontFamily: "'Arial Black', 'Impact', sans-serif",
                    fontSize: 72,
                    fontWeight: 900,
                    lineHeight: 1.15,
                    opacity: isVisible ? 1 : 0,
                    WebkitTextStroke: "3px rgba(0,0,0,0.7)",
                    textShadow: "0 4px 18px rgba(0,0,0,0.85)",
                    transform: isActive ? "scale(1.08)" : "scale(1)",
                    display: "inline-block",
                    transition: "all 0.1s",
                  }}
                >
                  {w.word}
                </span>
              );
            })}
          </div>
        </AbsoluteFill>
      ) : overlayText ? (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 120 }}>
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
      ) : null}
    </AbsoluteFill>
  );
};
