import React from "react";
import { AbsoluteFill, Freeze, Html5Audio, OffthreadVideo, Sequence, interpolate, useVideoConfig } from "remotion";
import { FADE_SECONDS, type CaptionStyle, type TimedWord } from "@shared/captions";
import { Captions } from "./components/Captions";
import { FadeOut, Outro, Watermark } from "./components/Branding";

export type ReelVideoProps = {
  videoUrl: string;
  /** Durée de la vidéo source (s) : au-delà, la dernière image est figée (aperçu). */
  videoDuration: number;
  totalDuration: number;
  words: TimedWord[];
  captionStyle: CaptionStyle;
  logoUrl?: string;
  storeName?: string;
  logoStart?: number | null;
  fadeStart?: number | null;
  /** Rendu final : piste son déjà mixée (voix, musique baissée sous la voix, niveau normalisé). */
  mixedAudioUrl?: string;
  /** Aperçu : pistes séparées, mixées dans le navigateur. */
  voiceUrl?: string;
  voiceDelay?: number;
  musicUrl?: string;
  musicVolume?: number;
};

/** Reel à partir d'une vidéo : image, sous-titres animés, logo et effet de fin. */
export const ReelVideo: React.FC<ReelVideoProps> = (props) => {
  const { fps } = useVideoConfig();
  const {
    videoUrl, videoDuration, totalDuration, words, captionStyle, logoUrl, storeName,
    logoStart = null, fadeStart = null, mixedAudioUrl, voiceUrl, voiceDelay = 2, musicUrl, musicVolume = 0.25,
  } = props;

  const videoFrames = Math.max(1, Math.floor(videoDuration * fps));
  const totalFrames = Math.max(1, Math.round(totalDuration * fps));
  const hasAddedAudio = Boolean(mixedAudioUrl || voiceUrl || musicUrl);
  const video = (
    <OffthreadVideo src={videoUrl} muted={hasAddedAudio} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {totalFrames > videoFrames ? (
        <>
          <Sequence durationInFrames={videoFrames}>{video}</Sequence>
          <Sequence from={videoFrames}>
            <Freeze frame={videoFrames - 1}>{video}</Freeze>
          </Sequence>
        </>
      ) : (
        video
      )}

      {mixedAudioUrl && <Html5Audio src={mixedAudioUrl} />}
      {!mixedAudioUrl && voiceUrl && (
        <Sequence from={Math.round(voiceDelay * fps)}>
          <Html5Audio src={voiceUrl} />
        </Sequence>
      )}
      {!mixedAudioUrl && musicUrl && (
        <Html5Audio
          src={musicUrl}
          loop
          volume={(frame) => previewMusicVolume(frame / fps, words, musicVolume, fadeStart)}
        />
      )}

      <Captions words={words} style={captionStyle} hideAfter={logoStart} />
      {logoUrl && <Watermark logoUrl={logoUrl} until={logoStart} />}
      {logoStart != null && (logoUrl || storeName) && (
        <Outro start={logoStart} logoUrl={logoUrl} storeName={storeName} />
      )}
      {fadeStart != null && <FadeOut start={fadeStart} duration={FADE_SECONDS} />}
    </AbsoluteFill>
  );
};

/** Aperçu : la musique baisse pendant la parole et s'éteint avec le fondu final. */
function previewMusicVolume(time: number, words: TimedWord[], base: number, fadeStart: number | null): number {
  const speaking = words.some((w) => time >= w.start - 0.2 && time <= w.end + 0.3);
  const fade =
    fadeStart == null
      ? 1
      : interpolate(time, [fadeStart, fadeStart + FADE_SECONDS], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  return (speaking ? base * 0.35 : base) * fade;
}
