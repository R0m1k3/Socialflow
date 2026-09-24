import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { CAPTION_FONT } from "../fonts";

/** Petit logo en haut à droite, hors des zones couvertes par l'interface des réseaux. */
export const Watermark: React.FC<{ logoUrl: string; until?: number | null }> = ({ logoUrl, until }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (until != null && frame / fps >= until) return null;
  return (
    <AbsoluteFill style={{ alignItems: "flex-end", justifyContent: "flex-start", padding: "150px 48px" }}>
      <Img
        src={logoUrl}
        style={{
          width: 150,
          height: 150,
          objectFit: "contain",
          opacity: 0.9,
          filter: "drop-shadow(0 2px 10px rgba(0,0,0,0.55))",
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * Effet de fin : l'image s'assombrit, le logo apparaît en grand puis le nom
 * du magasin glisse en dessous.
 */
export const Outro: React.FC<{ start: number; logoUrl?: string; storeName?: string; opaque?: boolean }> = ({
  start,
  logoUrl,
  storeName,
  opaque = false,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - Math.round(start * fps);
  if (local < 0) return null;

  const enter = spring({ frame: local, fps, config: { damping: 18, stiffness: 90 }, durationInFrames: 24 });
  const name = spring({ frame: local - 8, fps, config: { damping: 18, stiffness: 90 }, durationInFrames: 24 });
  const dim = interpolate(local, [0, 12], [0, opaque ? 1 : 0.62], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 44 }}>
      <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${dim})` }} />
      {logoUrl && (
        <Img
          src={logoUrl}
          style={{
            width: 480,
            height: 480,
            objectFit: "contain",
            opacity: enter,
            transform: `scale(${interpolate(enter, [0, 1], [0.7, 1])})`,
            filter: "drop-shadow(0 6px 30px rgba(0,0,0,0.5))",
          }}
        />
      )}
      {storeName && (
        <div
          style={{
            fontFamily: CAPTION_FONT,
            fontWeight: 800,
            fontSize: 84,
            color: "#FFFFFF",
            textAlign: "center",
            maxWidth: "86%",
            lineHeight: 1.1,
            opacity: name,
            transform: `translateY(${interpolate(name, [0, 1], [30, 0])}px)`,
            textShadow: "0 4px 24px rgba(0,0,0,0.6)",
          }}
        >
          {storeName}
        </div>
      )}
    </AbsoluteFill>
  );
};

/** Fondu au noir final. */
export const FadeOut: React.FC<{ start: number; duration: number }> = ({ start, duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame / fps, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return opacity > 0 ? <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${opacity})` }} /> : null;
};
