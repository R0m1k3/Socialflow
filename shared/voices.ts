/**
 * Voix et styles de lecture proposés pour les Reels.
 * Même catalogue que le service Python (ffmpeg-service/app/voices.py).
 */

export const TTS_ENGINES = ["gemini", "edge"] as const;
export type TtsEngine = (typeof TTS_ENGINES)[number];

export const TTS_STYLES = ["neutral", "dynamic", "warm", "calm", "promo"] as const;
export type TtsStyle = (typeof TTS_STYLES)[number];

export interface VoiceOption {
  id: string;
  label: string;
  gender: "female" | "male";
}

export const TTS_STYLE_OPTIONS: { id: TtsStyle; label: string; description: string }[] = [
  { id: "dynamic", label: "Dynamique", description: "Enthousiaste, rythme entraînant" },
  { id: "warm", label: "Chaleureux", description: "Souriant et proche" },
  { id: "promo", label: "Promo", description: "Annonce énergique des offres" },
  { id: "calm", label: "Calme", description: "Posé et rassurant" },
  { id: "neutral", label: "Neutre", description: "Lecture sans consigne" },
];

export const GEMINI_VOICES: VoiceOption[] = [
  { id: "Kore", label: "Kore — ferme", gender: "female" },
  { id: "Aoede", label: "Aoede — légère", gender: "female" },
  { id: "Leda", label: "Leda — jeune", gender: "female" },
  { id: "Zephyr", label: "Zephyr — lumineuse", gender: "female" },
  { id: "Callirrhoe", label: "Callirrhoe — décontractée", gender: "female" },
  { id: "Autonoe", label: "Autonoe — lumineuse", gender: "female" },
  { id: "Despina", label: "Despina — douce", gender: "female" },
  { id: "Erinome", label: "Erinome — claire", gender: "female" },
  { id: "Laomedeia", label: "Laomedeia — enjouée", gender: "female" },
  { id: "Achernar", label: "Achernar — tendre", gender: "female" },
  { id: "Gacrux", label: "Gacrux — mûre", gender: "female" },
  { id: "Pulcherrima", label: "Pulcherrima — affirmée", gender: "female" },
  { id: "Vindemiatrix", label: "Vindemiatrix — délicate", gender: "female" },
  { id: "Sulafat", label: "Sulafat — chaleureuse", gender: "female" },
  { id: "Charon", label: "Charon — informative", gender: "male" },
  { id: "Puck", label: "Puck — enjouée", gender: "male" },
  { id: "Fenrir", label: "Fenrir — enthousiaste", gender: "male" },
  { id: "Orus", label: "Orus — ferme", gender: "male" },
  { id: "Enceladus", label: "Enceladus — soufflée", gender: "male" },
  { id: "Iapetus", label: "Iapetus — claire", gender: "male" },
  { id: "Umbriel", label: "Umbriel — décontractée", gender: "male" },
  { id: "Algieba", label: "Algieba — veloutée", gender: "male" },
  { id: "Algenib", label: "Algenib — rocailleuse", gender: "male" },
  { id: "Rasalgethi", label: "Rasalgethi — informative", gender: "male" },
  { id: "Alnilam", label: "Alnilam — ferme", gender: "male" },
  { id: "Schedar", label: "Schedar — posée", gender: "male" },
  { id: "Achird", label: "Achird — amicale", gender: "male" },
  { id: "Zubenelgenubi", label: "Zubenelgenubi — naturelle", gender: "male" },
  { id: "Sadachbia", label: "Sadachbia — vive", gender: "male" },
  { id: "Sadaltager", label: "Sadaltager — experte", gender: "male" },
];

export const EDGE_VOICES: VoiceOption[] = [
  { id: "fr-FR-VivienneMultilingualNeural", label: "Vivienne", gender: "female" },
  { id: "fr-FR-DeniseNeural", label: "Denise", gender: "female" },
  { id: "fr-FR-EloiseNeural", label: "Eloise", gender: "female" },
  { id: "fr-FR-RemyMultilingualNeural", label: "Rémy", gender: "male" },
  { id: "fr-FR-HenriNeural", label: "Henri", gender: "male" },
];

export const DEFAULT_VOICE: Record<TtsEngine, string> = {
  gemini: "Kore",
  edge: "fr-FR-VivienneMultilingualNeural",
};

export const DEFAULT_TTS_STYLE: TtsStyle = "dynamic";

export function voicesFor(engine: TtsEngine): VoiceOption[] {
  return engine === "gemini" ? GEMINI_VOICES : EDGE_VOICES;
}
