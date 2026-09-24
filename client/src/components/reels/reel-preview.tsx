import { useEffect, useMemo, useState } from "react";
import { Player } from "@remotion/player";
import { Loader2, Info } from "lucide-react";
import {
  REEL_FPS,
  REEL_HEIGHT,
  REEL_WIDTH,
  VOICE_DELAY,
  cleanCaptionText,
  computeImagesTiming,
  computeReelTiming,
  offsetWords,
  spreadWords,
  type CaptionStyle,
  type TimedWord,
} from "@shared/captions";
import { ReelVideo, type ReelVideoProps } from "@/remotion/ReelVideo";
import { ImageComposition, type ImageCompositionProps } from "@/remotion/ImageComposition";
import type { VoicePreviewResult } from "./voice-picker";

/** Débit moyen d'une voix de synthèse française (estimation avant génération). */
const WORDS_PER_SECOND = 2.6;

interface CommonProps {
  text: string;
  showCaptions: boolean;
  captionStyle: CaptionStyle;
  ttsEnabled: boolean;
  /** Voix générée pour ce texte et ces réglages, sinon null (minutage estimé). */
  voice: VoicePreviewResult | null;
  musicUrl?: string;
  musicVolume: number;
  logoUrl?: string | null;
  storeName?: string;
  endingEffect: boolean;
}

type ReelPreviewProps =
  | (CommonProps & { kind: "video"; videoUrl: string })
  | (CommonProps & { kind: "images"; images: string[] });

/** Durée d'un média lue dans ses métadonnées (vidéo de la médiathèque). */
function useVideoDuration(url: string | undefined): number | null {
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    setDuration(null);
    if (!url) return;
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => setDuration(Number.isFinite(video.duration) ? video.duration : 15);
    video.onerror = () => setDuration(15);
    video.src = url;
    return () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.src = "";
    };
  }, [url]);
  return duration;
}

function estimatedVoiceDuration(text: string): number {
  const words = cleanCaptionText(text).split(" ").filter(Boolean).length;
  return words ? words / WORDS_PER_SECOND + 0.4 : 0;
}

/**
 * Aperçu du Reel dans le navigateur, avec les mêmes compositions Remotion que
 * le rendu final : sous-titres, logo, effet de fin et durée identiques.
 * Sans voix générée, le minutage des mots est estimé.
 */
export function ReelPreview(props: ReelPreviewProps) {
  const videoDuration = useVideoDuration(props.kind === "video" ? props.videoUrl : undefined);
  const { text, showCaptions, captionStyle, ttsEnabled, voice, musicUrl, musicVolume, endingEffect } = props;
  const logoUrl = props.logoUrl ?? undefined;
  const storeName = endingEffect ? props.storeName || undefined : undefined;
  const cleanText = cleanCaptionText(text);
  const voiceDuration = ttsEnabled && cleanText ? voice?.duration ?? estimatedVoiceDuration(text) : 0;
  const estimated = ttsEnabled && Boolean(cleanText) && !voice;

  const composition = useMemo(() => {
    if (props.kind === "images") {
      if (props.images.length === 0) return null;
      const { total, endingSeconds } = computeImagesTiming({
        imageCount: props.images.length,
        voiceDuration,
        hasEnding: Boolean(logoUrl || storeName),
      });
      const contentEnd = total - endingSeconds;
      let words: TimedWord[] = [];
      if (showCaptions && cleanText) {
        words = voice ? voice.words : spreadWords(text, 0, voiceDuration || Math.min(contentEnd - 0.5, 8));
      }
      const inputProps: ImageCompositionProps = {
        images: props.images,
        totalDuration: total,
        words,
        captionStyle,
        audioUrl: voice?.audioUrl,
        musicUrl,
        musicVolume,
        logoUrl,
        storeName,
        endingSeconds,
      };
      return { component: ImageComposition, inputProps, total };
    }

    if (videoDuration == null) return null;
    const timing = computeReelTiming({
      videoDuration,
      voiceDuration: voiceDuration || undefined,
      hasOutro: Boolean(logoUrl),
      endingEffect,
    });
    let words: TimedWord[] = [];
    if (showCaptions && cleanText) {
      if (voice) words = offsetWords(voice.words, VOICE_DELAY);
      else if (ttsEnabled) words = spreadWords(text, VOICE_DELAY, VOICE_DELAY + voiceDuration);
      else words = spreadWords(text, 0.5, (timing.logoStart ?? timing.total) - 0.5);
    }
    const inputProps: ReelVideoProps = {
      videoUrl: props.videoUrl,
      videoDuration,
      totalDuration: timing.total,
      words,
      captionStyle,
      logoUrl,
      storeName,
      logoStart: timing.logoStart,
      fadeStart: timing.fadeStart,
      voiceUrl: voice?.audioUrl,
      voiceDelay: VOICE_DELAY,
      musicUrl,
      musicVolume,
    };
    return { component: ReelVideo, inputProps, total: timing.total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.kind,
    props.kind === "video" ? props.videoUrl : props.images.join("|"),
    videoDuration, text, cleanText, showCaptions, captionStyle, ttsEnabled, voice, voiceDuration,
    musicUrl, musicVolume, logoUrl, storeName, endingEffect,
  ]);

  if (!composition) {
    return (
      <div className="aspect-[9/16] w-full rounded-lg bg-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-white/70" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg bg-black">
        <Player
          // Nouvelle instance quand la durée change : le lecteur repart du début
          key={`${props.kind}-${composition.total}`}
          component={composition.component as React.ComponentType<Record<string, unknown>>}
          inputProps={composition.inputProps as unknown as Record<string, unknown>}
          durationInFrames={Math.max(1, Math.round(composition.total * REEL_FPS))}
          fps={REEL_FPS}
          compositionWidth={REEL_WIDTH}
          compositionHeight={REEL_HEIGHT}
          style={{ width: "100%", aspectRatio: "9 / 16" }}
          controls
          loop
          acknowledgeRemotionLicense
        />
      </div>
      <p className="text-xs text-muted-foreground flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        {estimated
          ? "Minutage estimé : cliquez sur « Tester la voix » pour caler les sous-titres sur la vraie voix."
          : `Aperçu fidèle au rendu final · ${composition.total.toFixed(1)} s`}
      </p>
    </div>
  );
}
