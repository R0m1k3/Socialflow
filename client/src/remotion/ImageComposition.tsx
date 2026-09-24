import React from "react";
import { AbsoluteFill, Html5Audio, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionStyle, TimedWord } from "@shared/captions";
import { Captions } from "./components/Captions";
import { Outro, Watermark } from "./components/Branding";

export type ImageCompositionProps = {
  images: string[];
  totalDuration: number;
  /** Mots minutés depuis le début de la vidéo (la voix démarre à 0). */
  words: TimedWord[];
  captionStyle: CaptionStyle;
  audioUrl?: string;
  musicUrl?: string;
  musicVolume?: number;
  logoUrl?: string;
  storeName?: string;
  /** Durée de la diapositive de fin (logo + nom du magasin), en secondes. */
  endingSeconds?: number;
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

/** Reel à partir d'images : diaporama animé, voix, sous-titres et diapositive de fin. */
export const ImageComposition: React.FC<ImageCompositionProps> = ({
  images, words, captionStyle, audioUrl, musicUrl, musicVolume = 0.3, logoUrl, storeName, endingSeconds = 3,
}) => {
  const { fps, durationInFrames } = useVideoConfig();
  const hasEnding = Boolean(logoUrl || storeName) && endingSeconds > 0;
  const endingFrames = hasEnding ? Math.round(endingSeconds * fps) : 0;
  const contentFrames = durationInFrames - endingFrames;
  const perImage = Math.floor(contentFrames / Math.max(images.length, 1));
  const endingStart = contentFrames / fps;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {images.map((imgUrl, index) => (
        <Sequence key={index} from={index * perImage} durationInFrames={perImage}>
          <ImageSlide src={imgUrl} effectIndex={index} />
        </Sequence>
      ))}

      {audioUrl && <Html5Audio src={audioUrl} />}
      {musicUrl && (
        <Html5Audio
          src={musicUrl}
          loop
          volume={(frame) =>
            (words.some((w) => frame / fps >= w.start - 0.2 && frame / fps <= w.end + 0.3)
              ? musicVolume * 0.35
              : musicVolume) *
            interpolate(frame, [durationInFrames - fps, durationInFrames], [1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          }
        />
      )}

      <Captions words={words} style={captionStyle} hideAfter={hasEnding ? endingStart : null} />
      {logoUrl && <Watermark logoUrl={logoUrl} until={hasEnding ? endingStart : null} />}
      {hasEnding && <Outro start={endingStart} logoUrl={logoUrl} storeName={storeName} opaque />}
    </AbsoluteFill>
  );
};
