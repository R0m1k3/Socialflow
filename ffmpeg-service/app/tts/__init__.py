"""Synthèse vocale : moteur au choix, repli sur Edge, voix traitée et mots minutés."""

import logging
from dataclasses import dataclass, field
from pathlib import Path

from .. import align, audio, proc
from ..align import Word
from . import edge, gemini

log = logging.getLogger(__name__)


@dataclass
class VoiceTrack:
    path: Path  # WAV 48 kHz traité
    duration: float
    words: list[Word]  # mots affichés, minutés depuis le début de la voix
    engine: str
    voice: str
    warnings: list[str] = field(default_factory=list)


async def synthesize(
    *,
    text: str,
    display_text: str,
    engine: str | None,
    voice: str | None,
    style: str | None,
    gemini_api_key: str | None,
    workdir: Path,
) -> VoiceTrack:
    warnings: list[str] = []
    raw: Path | None = None
    spoken: list[Word] = []
    used_engine, used_voice = "edge", ""

    if (engine or "gemini") == "gemini":
        if not gemini_api_key:
            warnings.append("Clé Gemini absente : voix Edge utilisée à la place.")
        else:
            try:
                raw, used_voice = await gemini.synthesize(text, voice, style, gemini_api_key, workdir)
                used_engine = "gemini"
            except Exception as error:  # noqa: BLE001 — repli sur Edge
                log.warning("Gemini TTS en échec, repli sur Edge : %s", error)
                warnings.append(f"Gemini indisponible ({error}) : voix Edge utilisée à la place.")

    if raw is None:
        raw, spoken, used_voice = await edge.synthesize(text, voice, style, workdir)

    processed = workdir / "voice.wav"
    await audio.process_voice(raw, processed)
    duration = (await proc.probe(processed)).duration

    if not spoken:
        # Gemini ne donne pas le minutage : Whisper le retrouve dans l'audio
        spoken = await align.transcribe(processed, hint=text)

    words = align.align_words(display_text, spoken, duration)
    log.info("Voix prête : %s/%s, %.1f s, %d mots", used_engine, used_voice, duration, len(words))
    return VoiceTrack(processed, duration, words, used_engine, used_voice, warnings)
