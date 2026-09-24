import React, { useMemo } from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { groupLines, type CaptionStyle, type TimedWord } from "@shared/captions";
import { CAPTION_FONT } from "../fonts";

interface CaptionsProps {
  words: TimedWord[];
  style: CaptionStyle;
  /** Les sous-titres disparaissent à partir de cet instant (effet de fin). */
  hideAfter?: number | null;
}

/** Couleur de mise en avant du mot prononcé, par style. */
const ACCENT = { bold: "#FFE600", neon: "#7C3AED", minimal: "#FFFFFF" } as const;

/**
 * Sous-titres mot à mot, synchronisés sur la voix.
 * Une ligne de 1 à 3 mots à la fois, placée au-dessus des boutons qu'Instagram
 * et TikTok superposent en bas de l'écran.
 */
export const Captions: React.FC<CaptionsProps> = ({ words, style, hideAfter }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps;
  const lines = useMemo(() => groupLines(words), [words]);

  if (hideAfter != null && time >= hideAfter) return null;

  // Ligne courante : du début de son premier mot au début de la suivante
  const index = lines.findIndex((line, i) => {
    const start = line[0].start;
    const next = lines[i + 1]?.[0].start ?? line[line.length - 1].end + 0.4;
    return time >= start && time < next;
  });
  if (index < 0) return null;
  const line = lines[index];

  const lineFrame = Math.round(line[0].start * fps);
  const appear = spring({ frame: frame - lineFrame, fps, config: { damping: 14, stiffness: 180 }, durationInFrames: 8 });

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 520 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
          gap: style === "neon" ? "12px 12px" : style === "bold" ? "4px 38px" : "0 24px",
          maxWidth: "84%",
          transform: `scale(${0.85 + 0.15 * appear})`,
          opacity: appear,
        }}
      >
        {line.map((word, i) => {
          const spoken = time >= word.start;
          const active = spoken && (i === line.length - 1 || time < line[i + 1].start);
          const pop = spring({
            frame: frame - Math.round(word.start * fps),
            fps,
            config: { damping: 12, stiffness: 220 },
            durationInFrames: 6,
          });
          return (
            <Word key={`${index}-${i}`} text={word.text} style={style} active={active} spoken={spoken} pop={pop} />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Word: React.FC<{ text: string; style: CaptionStyle; active: boolean; spoken: boolean; pop: number }> = ({
  text,
  style,
  active,
  spoken,
  pop,
}) => {
  const base: React.CSSProperties = {
    fontFamily: CAPTION_FONT,
    display: "inline-block",
    lineHeight: 1.1,
    textAlign: "center",
    paintOrder: "stroke fill",
  };

  if (style === "bold") {
    return (
      <span
        style={{
          ...base,
          fontSize: 92,
          fontWeight: 900,
          textTransform: "uppercase",
          color: active ? ACCENT.bold : "#FFFFFF",
          WebkitTextStroke: "12px #000000",
          textShadow: "0 8px 24px rgba(0,0,0,0.55)",
          transform: `scale(${active ? 1 + 0.12 * pop : 1})`,
        }}
      >
        {text}
      </span>
    );
  }

  if (style === "neon") {
    return (
      <span
        style={{
          ...base,
          fontSize: 80,
          fontWeight: 800,
          color: "#FFFFFF",
          padding: "6px 18px",
          borderRadius: 18,
          backgroundColor: active ? ACCENT.neon : "rgba(0,0,0,0.45)",
          boxShadow: active ? "0 0 36px rgba(124,58,237,0.75)" : "none",
          transform: `scale(${active ? 1 + 0.08 * pop : 1})`,
        }}
      >
        {text}
      </span>
    );
  }

  return (
    <span
      style={{
        ...base,
        fontSize: 78,
        fontWeight: 700,
        color: ACCENT.minimal,
        opacity: spoken ? 1 : 0.45,
        textShadow: "0 4px 18px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)",
        transform: `translateY(${active ? -6 * pop : 0}px)`,
      }}
    >
      {text}
    </span>
  );
};
