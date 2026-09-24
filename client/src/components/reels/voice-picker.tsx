import { useEffect, useRef, useState } from "react";
import { Loader2, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getErrorMessage } from "@/lib/queryClient";
import {
  DEFAULT_VOICE,
  TTS_STYLE_OPTIONS,
  voicesFor,
  type TtsEngine,
  type TtsStyle,
} from "@shared/voices";
import type { TimedWord } from "@shared/captions";

export interface VoiceSettings {
  engine: TtsEngine;
  voice: string;
  style: TtsStyle;
}

/** Voix générée par « Tester la voix », réutilisée par l'aperçu vidéo. */
export interface VoicePreviewResult {
  audioUrl: string;
  duration: number;
  words: TimedWord[];
  /** Texte et réglages ayant servi : l'aperçu n'est valable que s'ils n'ont pas changé. */
  text: string;
  settings: VoiceSettings;
}

export function isVoicePreviewCurrent(
  preview: VoicePreviewResult | null,
  text: string,
  settings: VoiceSettings,
): preview is VoicePreviewResult {
  return (
    !!preview &&
    preview.text === text.trim() &&
    preview.settings.engine === settings.engine &&
    preview.settings.voice === settings.voice &&
    preview.settings.style === settings.style
  );
}

interface VoicePickerProps {
  value: VoiceSettings;
  onChange: (value: VoiceSettings) => void;
  /** Texte lu par le bouton « Tester la voix ». */
  sampleText?: string;
  compact?: boolean;
  /** Appelé avec la voix générée (audio et minutage des mots). */
  onPreview?: (result: VoicePreviewResult) => void;
}

const FALLBACK_SAMPLE = "Découvrez nos nouveautés en magasin, on vous attend !";

/**
 * Choix du moteur, de la voix et du ton, avec écoute de l'aperçu.
 * Partagé par les pages Reel (vidéo et images, bureau et mobile).
 */
export function VoicePicker({ value, onChange, sampleText, compact = false, onPreview }: VoicePickerProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audioRef.current?.pause(), []);

  const voices = voicesFor(value.engine);
  const groups = [
    { label: "Voix féminines", items: voices.filter((v) => v.gender === "female") },
    { label: "Voix masculines", items: voices.filter((v) => v.gender === "male") },
  ];

  const setEngine = (engine: TtsEngine) => {
    if (engine !== value.engine) onChange({ ...value, engine, voice: DEFAULT_VOICE[engine] });
  };

  const stop = () => {
    audioRef.current?.pause();
    setPlaying(false);
  };

  const preview = async () => {
    if (playing) return stop();
    setLoading(true);
    try {
      const text = sampleText?.trim() || FALLBACK_SAMPLE;
      const response = await apiRequest("POST", "/api/reels/tts-preview", {
        text,
        ttsEngine: value.engine,
        ttsVoice: value.voice,
        ttsStyle: value.style,
      });
      const data = await response.json();
      for (const warning of data.warnings ?? []) {
        toast({ title: "Voix de secours utilisée", description: warning });
      }
      const audioUrl = `data:audio/mpeg;base64,${data.audioBase64}`;
      if (sampleText?.trim()) {
        onPreview?.({ audioUrl, duration: data.duration, words: data.words ?? [], text, settings: value });
      }
      const audio = new Audio(audioUrl);
      audioRef.current?.pause();
      audioRef.current = audio;
      audio.onended = () => setPlaying(false);
      await audio.play();
      setPlaying(true);
    } catch (error) {
      toast({
        title: "Impossible de tester la voix",
        description: getErrorMessage(error, "La voix n'a pas pu être générée."),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const labelClass = compact ? "text-xs font-medium" : "text-sm font-medium";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Label className={`${labelClass} w-14 shrink-0`}>Moteur</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            className={compact ? "h-7 text-xs" : undefined}
            variant={value.engine === "gemini" ? "default" : "outline"}
            onClick={() => setEngine("gemini")}
          >
            Gemini (naturelle)
          </Button>
          <Button
            type="button"
            size="sm"
            className={compact ? "h-7 text-xs" : undefined}
            variant={value.engine === "edge" ? "default" : "outline"}
            onClick={() => setEngine("edge")}
          >
            Edge (gratuite)
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Label className={`${labelClass} w-14 shrink-0`}>Voix</Label>
        <Select value={value.voice} onValueChange={(voice) => onChange({ ...value, voice })}>
          <SelectTrigger className={compact ? "h-8 text-xs flex-1" : "flex-1"}>
            <SelectValue placeholder="Choisir une voix" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {groups.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.items.map((voice) => (
                  <SelectItem key={voice.id} value={voice.id}>
                    {voice.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-3">
        <Label className={`${labelClass} w-14 shrink-0`}>Ton</Label>
        <Select value={value.style} onValueChange={(style) => onChange({ ...value, style: style as TtsStyle })}>
          <SelectTrigger className={compact ? "h-8 text-xs flex-1" : "flex-1"}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TTS_STYLE_OPTIONS.map((style) => (
              <SelectItem key={style.id} value={style.id}>
                {style.label} <span className="text-muted-foreground">— {style.description}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button
        type="button"
        size="sm"
        variant="secondary"
        className={compact ? "w-full h-8 text-xs" : "w-full"}
        disabled={loading}
        onClick={(e) => {
          e.stopPropagation();
          preview();
        }}
      >
        {loading ? (
          <Loader2 className="w-3 h-3 mr-2 animate-spin" />
        ) : playing ? (
          <Square className="w-3 h-3 mr-2" />
        ) : (
          <Play className="w-3 h-3 mr-2" />
        )}
        {loading ? "Génération de la voix…" : playing ? "Arrêter" : "Tester la voix"}
      </Button>
    </div>
  );
}
