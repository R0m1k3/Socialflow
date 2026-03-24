import { AbsoluteFill, Img, Sequence, useVideoConfig, useCurrentFrame, Audio } from "remotion";

export type WordTiming = {
  word: string;       // display word (may include emoji/hashtag)
  startFrame: number; // frame this word becomes active
  endFrame: number;
};

export type ImageCompositionProps = {
  images: string[];
  overlayText?: string;
  audioUrl?: string;
  wordTimings?: WordTiming[];
};

export const ImageComposition = ({
  images, overlayText, audioUrl, wordTimings
}: ImageCompositionProps) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const durationPerImage = 3 * fps;

  // Determine which word is currently "active" for TikTok highlight
  const activeWordIdx = wordTimings
    ? wordTimings.findIndex(w => frame >= w.startFrame && frame < w.endFrame)
    : -1;

  // Words displayed up to the current active one (progressive reveal)
  const visibleWords = wordTimings
    ? wordTimings.filter(w => w.startFrame <= frame)
    : [];

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {/* Images sequence */}
      {images.map((imgUrl, index) => (
        <Sequence key={index} from={index * durationPerImage} durationInFrames={durationPerImage}>
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
            <Img src={imgUrl} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          </AbsoluteFill>
        </Sequence>
      ))}

      {/* TTS Audio */}
      {audioUrl && <Audio src={audioUrl} startFrom={0} />}

      {/* TikTok-style word-by-word text overlay */}
      {wordTimings && wordTimings.length > 0 ? (
        <AbsoluteFill
          style={{
            justifyContent: "flex-end",
            alignItems: "center",
            paddingBottom: 120,
          }}
        >
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
        /* Fallback: static text if no word timings */
        <AbsoluteFill
          style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 120 }}
        >
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
