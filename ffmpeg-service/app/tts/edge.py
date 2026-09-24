"""Synthèse vocale Edge (gratuite, fournit le minutage des mots)."""

import logging
from pathlib import Path

import edge_tts

from .. import config
from ..align import Word
from ..voices import edge_fallbacks, resolve_edge_voice

log = logging.getLogger(__name__)

# Réglages de lecture par style (Edge n'interprète pas de consigne en texte)
STYLE_PROSODY = {
    "dynamic": ("+8%", "+2Hz"),
    "promo": ("+10%", "+3Hz"),
    "calm": ("-8%", "-2Hz"),
    "warm": ("-2%", "+0Hz"),
}


async def synthesize(
    text: str, voice: str | None, style: str | None, workdir: Path
) -> tuple[Path, list[Word], str]:
    """Génère la voix ; renvoie le MP3, les mots minutés et la voix utilisée."""
    rate, pitch = STYLE_PROSODY.get(style or "", ("+0%", "+0Hz"))
    last_error: Exception | None = None

    for candidate in edge_fallbacks(resolve_edge_voice(voice)):
        target = workdir / "edge.mp3"
        try:
            communicate = edge_tts.Communicate(
                text,
                candidate.id,
                rate=rate,
                pitch=pitch,
                # edge-tts 7 ne renvoie plus que les phrases par défaut
                boundary="WordBoundary",
                proxy=config.OUTBOUND_PROXY,
            )
            words: list[Word] = []
            with target.open("wb") as out:
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        out.write(chunk["data"])
                    elif chunk["type"] == "WordBoundary":
                        start = chunk["offset"] / 10_000_000
                        words.append(Word(chunk["text"], start, start + chunk["duration"] / 10_000_000))
            if target.stat().st_size == 0:
                raise RuntimeError("audio vide")
            log.info("Edge TTS : voix=%s, %d mots minutés", candidate.id, len(words))
            return target, words, candidate.id
        except Exception as error:  # noqa: BLE001 — on essaie la voix suivante
            log.warning("Edge TTS %s en échec : %s", candidate.id, error)
            last_error = error

    raise RuntimeError(f"Aucune voix Edge disponible : {last_error}")
