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
  /** Petit logo affiché pendant la vidéo (le grand logo de fin dépend de l'effet de fin). */
  showWatermark?: boolean;
  storeName?: string;
  logoStart?: number | null;
  fadeStart?: number | null;
  fadeDuration?: number | null;
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
    videoUrl, videoDuration, totalDuration, words, captionStyle, logoUrl, showWatermark = true, storeName,
    logoStart = null, fadeStart = null, fadeDuration = FADE_SECONDS, mixedAudioUrl, voiceUrl, voiceDelay = 2, musicUrl, musicVolume = 0.25,
  } = props;

  const videoFrames = Math.max(1, Math.floor(videoDuration * fps));
  const totalFrames = Math.max(1, Math.round(totalDuration * fps));
  // Le son d'origine est remplacé par la musique choisie ; sans musique, il reste
  // en fond (baissé sous la voix). Au rendu final, il est déjà dans la piste mixée.
  const keepVideoSound = !mixedAudioUrl && !musicUrl;
  const video = (
    <OffthreadVideo
      src={videoUrl}
      muted={!keepVideoSound}
      volume={keepVideoSound && voiceUrl ? (frame) => previewMusicVolume(frame / fps, words, 1, fadeStart, fadeDuration ?? FADE_SECONDS) : 1}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
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
          volume={(frame) => previewMusicVolume(frame / fps, words, musicVolume, fadeStart, fadeDuration ?? FADE_SECONDS)}
        />
      )}

      <Captions words={words} style={captionStyle} hideAfter={logoStart} />
      {logoUrl && showWatermark && <Watermark logoUrl={logoUrl} until={logoStart} />}
      {logoStart != null && (logoUrl || storeName) && (
        <Outro start={logoStart} logoUrl={logoUrl} storeName={storeName} />
      )}
      {fadeStart != null && <FadeOut start={fadeStart} duration={fadeDuration ?? FADE_SECONDS} />}
    </AbsoluteFill>
  );
};

/** Aperçu : le fond sonore (musique ou son d'origine) baisse pendant la parole et s'éteint avec le fondu final. */
function previewMusicVolume(
  time: number,
  words: TimedWord[],
  base: number,
  fadeStart: number | null,
  fadeDuration: number,
): number {
  const speaking = words.some((w) => time >= w.start - 0.2 && time <= w.end + 0.3);
  const fade =
    fadeStart == null
      ? 1
      : interpolate(time, [fadeStart, fadeStart + fadeDuration], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  return (speaking ? base * 0.35 : base) * fade;
}
