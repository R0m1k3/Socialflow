"""Catalogue des voix et des styles de lecture."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Voice:
    id: str
    label: str
    gender: str  # "female" | "male"


# Voix natives de Gemini TTS (toutes multilingues, françaises comprises).
GEMINI_VOICES: tuple[Voice, ...] = (
    Voice("Kore", "Kore — ferme", "female"),
    Voice("Aoede", "Aoede — légère", "female"),
    Voice("Leda", "Leda — jeune", "female"),
    Voice("Zephyr", "Zephyr — lumineuse", "female"),
    Voice("Callirrhoe", "Callirrhoe — décontractée", "female"),
    Voice("Autonoe", "Autonoe — lumineuse", "female"),
    Voice("Despina", "Despina — douce", "female"),
    Voice("Erinome", "Erinome — claire", "female"),
    Voice("Laomedeia", "Laomedeia — enjouée", "female"),
    Voice("Achernar", "Achernar — tendre", "female"),
    Voice("Gacrux", "Gacrux — mûre", "female"),
    Voice("Pulcherrima", "Pulcherrima — affirmée", "female"),
    Voice("Vindemiatrix", "Vindemiatrix — délicate", "female"),
    Voice("Sulafat", "Sulafat — chaleureuse", "female"),
    Voice("Charon", "Charon — informative", "male"),
    Voice("Puck", "Puck — enjouée", "male"),
    Voice("Fenrir", "Fenrir — enthousiaste", "male"),
    Voice("Orus", "Orus — ferme", "male"),
    Voice("Enceladus", "Enceladus — soufflée", "male"),
    Voice("Iapetus", "Iapetus — claire", "male"),
    Voice("Umbriel", "Umbriel — décontractée", "male"),
    Voice("Algieba", "Algieba — veloutée", "male"),
    Voice("Algenib", "Algenib — rocailleuse", "male"),
    Voice("Rasalgethi", "Rasalgethi — informative", "male"),
    Voice("Alnilam", "Alnilam — ferme", "male"),
    Voice("Schedar", "Schedar — posée", "male"),
    Voice("Achird", "Achird — amicale", "male"),
    Voice("Zubenelgenubi", "Zubenelgenubi — naturelle", "male"),
    Voice("Sadachbia", "Sadachbia — vive", "male"),
    Voice("Sadaltager", "Sadaltager — experte", "male"),
)

EDGE_VOICES: tuple[Voice, ...] = (
    Voice("fr-FR-VivienneMultilingualNeural", "Vivienne", "female"),
    Voice("fr-FR-DeniseNeural", "Denise", "female"),
    Voice("fr-FR-EloiseNeural", "Eloise", "female"),
    Voice("fr-FR-RemyMultilingualNeural", "Rémy", "male"),
    Voice("fr-FR-HenriNeural", "Henri", "male"),
)

# Voix prédéfinies de Qwen3-TTS (service local). Les voix clonées
# (« clone:nom ») sont listées par le service lui-même.
QWEN_VOICES: tuple[Voice, ...] = (
    Voice("serena", "Serena — douce et chaleureuse", "female"),
    Voice("vivian", "Vivian — vive et lumineuse", "female"),
    Voice("sohee", "Sohee — expressive", "female"),
    Voice("ono_anna", "Anna — espiègle", "female"),
    Voice("aiden", "Aiden — solaire", "male"),
    Voice("ryan", "Ryan — dynamique", "male"),
    Voice("uncle_fu", "Fu — grave et posée", "male"),
    Voice("dylan", "Dylan — jeune et naturelle", "male"),
    Voice("eric", "Eric — légèrement voilée", "male"),
)

# Consignes de lecture ajoutées au texte envoyé à Gemini.
STYLES: dict[str, tuple[str, str]] = {
    "neutral": ("Neutre", ""),
    "dynamic": (
        "Dynamique",
        "Lis ce texte en français sur un ton dynamique et enthousiaste, comme une vidéo "
        "courte sur les réseaux sociaux, à un débit naturel, sans accélérer, en articulant bien",
    ),
    "warm": (
        "Chaleureux",
        "Lis ce texte en français sur un ton chaleureux, souriant et proche, comme si tu conseillais un ami",
    ),
    "calm": (
        "Calme",
        "Lis ce texte en français sur un ton calme, posé et rassurant, sans te presser",
    ),
    "promo": (
        "Promo",
        "Lis ce texte en français comme une annonce promotionnelle énergique, en "
        "insistant sur les offres et les prix, sans accélérer, en articulant bien",
    ),
}

_GEMINI_BY_ID = {v.id.lower(): v for v in GEMINI_VOICES}
_EDGE_BY_ID = {v.id: v for v in EDGE_VOICES}
_QWEN_BY_ID = {v.id: v for v in QWEN_VOICES}

# Consignes de ton pour Qwen (le modèle comprend l'anglais mieux que le français)
QWEN_STYLES: dict[str, str] = {
    "neutral": "Speak natural, native French with clear articulation and a relaxed, natural pace.",
    "dynamic": "Speak native French in an upbeat, enthusiastic and smiling tone, like a social media video, "
    "at a natural pace without rushing, clearly articulated.",
    "warm": "Speak native French in a warm, friendly and caring tone, as if advising a friend, "
    "at a relaxed pace.",
    "calm": "Speak native French in a calm, soothing and reassuring tone, slowly and clearly.",
    "promo": "Speak native French like an energetic promotional announcement, emphasizing offers and prices, "
    "at a natural pace without rushing, clearly articulated.",
}


def resolve_gemini_voice(voice: str | None) -> Voice:
    """Voix Gemini à utiliser.

    Accepte aussi les anciens identifiants « fr-FR-Standard-X » encore stockés
    dans des jobs (B/D = voix masculine).
    """
    if voice and voice.lower() in _GEMINI_BY_ID:
        return _GEMINI_BY_ID[voice.lower()]
    if voice and voice.endswith(("-B", "-D")) or voice_gender(voice) == "male":
        return _GEMINI_BY_ID["charon"]
    return _GEMINI_BY_ID["kore"]


def voice_gender(voice: str | None) -> str:
    """Genre d'une voix, quel que soit le moteur d'origine."""
    if not voice:
        return "female"
    if voice.lower() in _GEMINI_BY_ID:
        return _GEMINI_BY_ID[voice.lower()].gender
    if voice in _EDGE_BY_ID:
        return _EDGE_BY_ID[voice].gender
    if voice.lower() in _QWEN_BY_ID:
        return _QWEN_BY_ID[voice.lower()].gender
    if voice == "male" or voice.endswith(("-B", "-D")):
        return "male"
    return "male" if any(name in voice for name in ("Remy", "Henri", "Paul")) else "female"


def resolve_edge_voice(voice: str | None) -> Voice:
    """Voix Edge à utiliser ; une voix Gemini est remplacée par une voix Edge du même genre."""
    if voice in _EDGE_BY_ID:
        return _EDGE_BY_ID[voice]
    gender = voice_gender(voice)
    return next(v for v in EDGE_VOICES if v.gender == gender)


def resolve_qwen_voice(voice: str | None) -> str:
    """Voix Qwen à utiliser : voix clonée ou prédéfinie ; une voix d'un autre
    moteur est remplacée par une voix Qwen du même genre."""
    if voice and voice.startswith("clone:"):
        return voice
    if voice and voice.lower() in _QWEN_BY_ID:
        return voice.lower()
    return "aiden" if voice_gender(voice) == "male" else "serena"


def qwen_instruction(style: str | None) -> str:
    return QWEN_STYLES.get(style or "neutral", QWEN_STYLES["neutral"])


def edge_fallbacks(primary: Voice) -> list[Voice]:
    """Voix françaises de secours du même genre (jamais d'anglais)."""
    same = [v for v in EDGE_VOICES if v.gender == primary.gender and v != primary]
    return [primary, *same]


def style_instruction(style: str | None) -> str:
    return STYLES.get(style or "neutral", STYLES["neutral"])[1]


def catalog(qwen_voices: list[dict] | None = None) -> dict:
    """Voix par moteur ; `qwen_voices` vient du service Qwen (None s'il ne répond pas)."""
    return {
        "qwen": qwen_voices or [v.__dict__ for v in QWEN_VOICES],
        "qwen_available": qwen_voices is not None,
        "gemini": [v.__dict__ for v in GEMINI_VOICES],
        "edge": [v.__dict__ for v in EDGE_VOICES],
        "styles": [{"id": k, "label": v[0]} for k, v in STYLES.items()],
    }
