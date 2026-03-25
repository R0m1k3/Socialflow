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

/**
 * Ken Burns presets — deterministic per image index.
 * Each entry: starting transform → ending transform over the slide duration.
 * Scale > 1 to avoid black edges when translating.
 */
const KB_PRESETS = [
  // zoom in, center
  { fromScale: 1.0,  toScale: 1.14, fromX: "0%",   toX: "0%",   fromY: "0%",   toY: "0%" },
  // zoom in + drift right
  { fromScale: 1.06, toScale: 1.18, fromX: "-3%",  toX: "3%",   fromY: "0%",   toY: "0%" },
  // zoom in + drift left
  { fromScale: 1.06, toScale: 1.18, fromX: "3%",   toX: "-3%",  fromY: "0%",   toY: "0%" },
  // zoom out, center
  { fromScale: 1.16, toScale: 1.04, fromX: "0%",   toX: "0%",   fromY: "0%",   toY: "0%" },
  // pan up + slight zoom
  { fromScale: 1.1,  toScale: 1.14, fromX: "0%",   toX: "0%",   fromY: "3%",   toY: "-3%" },
  // pan down + zoom in
  { fromScale: 1.06, toScale: 1.16, fromX: "0%",   toX: "0%",   fromY: "-3%",  toY: "3%" },
  // diagonal drift bottom-right
  { fromScale: 1.08, toScale: 1.18, fromX: "-2%",  toX: "2%",   fromY: "-2%",  toY: "2%" },
  // diagonal drift top-left + zoom out
  { fromScale: 1.18, toScale: 1.06, fromX: "2%",   toX: "-2%",  fromY: "2%",   toY: "-2%" },
];

/**
 * ImageSlide with Ken Burns effect (slow zoom / pan).
 * The effect index is derived from the image index for deterministic behaviour in Remotion.
 */
const ImageSlide: React.FC<{ src: string; effectIndex: number }> = ({ src, effectIndex }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const preset = KB_PRESETS[effectIndex % KB_PRESETS.length];
  // progress: 0 → 1 over the slide duration, using easeInOut via interpolate extrapolate clamp
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], { extrapolateRight: "clamp" });

  const scale  = interpolate(progress, [0, 1], [preset.fromScale, preset.toScale]);
  const transX = interpolate(progress, [0, 1], [parseFloat(preset.fromX), parseFloat(preset.toX)]);
  const transY = interpolate(progress, [0, 1], [parseFloat(preset.fromY), parseFloat(preset.toY)]);

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "black" }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale}) translate(${transX}%, ${transY}%)`,
          transformOrigin: "center center",
          willChange: "transform",
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * CaptionGroup — renders a group of words (CapCut-style).
 * Active word is highlighted in yellow with glow; others are white.
 * Background: semi-transparent dark pill.
 */
const CaptionGroup: React.FC<{
  words: WordTiming[];
  activeIdx: number;   // index within this group (0-3), -1 if none active
  groupFirstFrame: number;
  fps: number;
}> = ({ words, activeIdx, groupFirstFrame, fps }) => {
  const frame = useCurrentFrame();

  // Fade in when this group first appears
  const fadeIn = spring({
    frame: frame - groupFirstFrame,
    fps,
    config: { damping: 30, stiffness: 120 },
    durationInFrames: 10,
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: "0 22px",
        maxWidth: "90%",
        opacity: fadeIn,
      }}
    >
      {words.map((w, i) => {
        const isActive = i === activeIdx;
        return (
          <span
            key={i}
            style={{
              fontFamily: "'Arial Black', 'Impact', 'Helvetica Neue', sans-serif",
              fontSize: isActive ? 82 : 74,
              fontWeight: 900,
              lineHeight: 1.15,
              color: isActive ? "#FFE600" : "white",
              textTransform: "uppercase",
              textShadow: isActive
                ? "0 0 30px rgba(255,230,0,0.6), 0 4px 24px rgba(0,0,0,0.95)"
                : "0 3px 18px rgba(0,0,0,0.9)",
              WebkitTextStroke: isActive ? "3px rgba(0,0,0,0.85)" : "2px rgba(0,0,0,0.75)",
              display: "inline-block",
              transform: isActive ? "scale(1.1)" : "scale(1)",
              transition: "transform 0.05s",
            }}
          >
            {w.word}
          </span>
        );
      })}
    </div>
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

  // Group words into sets of 3 for caption display
  const WORDS_PER_GROUP = 3;
  const activeWordIdx = wordTimings
    ? wordTimings.findIndex(w => frame >= w.startFrame && frame < w.endFrame)
    : -1;

  // Only show caption when a word is actively being spoken
  const renderCaption = frame < endingStart && activeWordIdx >= 0;

  const groupIdx = activeWordIdx >= 0 ? Math.floor(activeWordIdx / WORDS_PER_GROUP) : 0;
  const groupStart = groupIdx * WORDS_PER_GROUP;
  const groupWords = wordTimings ? wordTimings.slice(groupStart, groupStart + WORDS_PER_GROUP) : [];
  const activeIdxInGroup = activeWordIdx - groupStart;

  // First frame of the current group (for fade-in)
  const groupFirstFrame = groupWords.length > 0 ? groupWords[0].startFrame : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {/* Images — displayed immediately, no entrance transition */}
      {images.map((imgUrl, index) => (
        <Sequence key={index} from={index * durationPerImage} durationInFrames={durationPerImage}>
          <ImageSlide src={imgUrl} effectIndex={index} />
        </Sequence>
      ))}

      {/* TTS Audio */}
      {audioUrl && <Html5Audio src={audioUrl} />}

      {/* Background music */}
      {musicUrl && <Html5Audio src={musicUrl} volume={musicVolume} />}

      {/* Caption overlay — CapCut style */}
      {renderCaption && (
        <AbsoluteFill
          style={{
            justifyContent: "flex-end",
            alignItems: "center",
            paddingBottom: 180,
          }}
        >
          {/* Semi-transparent dark background pill */}
          <div
            style={{
              backgroundColor: "rgba(0,0,0,0.55)",
              borderRadius: 28,
              paddingTop: 22,
              paddingBottom: 22,
              paddingLeft: 36,
              paddingRight: 36,
              maxWidth: "92%",
              backdropFilter: "blur(4px)",
            }}
          >
            <CaptionGroup
              words={groupWords}
              activeIdx={activeIdxInGroup}
              groupFirstFrame={groupFirstFrame}
              fps={fps}
            />
          </div>
        </AbsoluteFill>
      )}

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
