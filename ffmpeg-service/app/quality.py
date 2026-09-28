"""Contrôles de la voix générée : texte réellement lu et silences.

Gemini lit parfois mal : mots sautés, fin tronquée, consigne de style lue à
voix haute. On compare donc ce que Whisper entend au texte attendu, et on
découpe la voix dans ses vrais silences (mesurés dans l'audio) plutôt qu'aux
bornes des mots estimées par Whisper, trop imprécises pour ne pas rogner une
syllabe.
"""

import difflib
import re
from dataclasses import dataclass
from pathlib import Path

from . import proc
from .align import Word, normalize

# Seuils de silence : en dessous de -40 dB pendant au moins 120 ms
SILENCE_NOISE_DB = -40
SILENCE_MIN_SECONDS = 0.12


@dataclass
class ReadingCheck:
    coverage: float  # part des mots attendus effectivement entendus
    extra: float  # mots entendus en trop (consigne lue, ajouts), rapportés au texte
    ending_ok: bool  # la fin du texte est bien lue

    @property
    def acceptable(self) -> bool:
        return self.coverage >= 0.85 and self.extra <= 0.25 and self.ending_ok

    def describe(self) -> str:
        parts = [f"{self.coverage:.0%} des mots lus"]
        if not self.ending_ok:
            parts.append("fin tronquée")
        if self.extra > 0.25:
            parts.append("mots ajoutés")
        return ", ".join(parts)


def check_reading(expected_text: str, spoken: list[Word]) -> ReadingCheck:
    """Compare le texte attendu à ce qui a été entendu (Whisper)."""
    expected = [t for t in (normalize(w) for w in expected_text.split()) if t]
    heard = [t for t in (normalize(w.text) for w in spoken) if t]
    if not expected:
        return ReadingCheck(1.0, 0.0, True)
    if not heard:
        return ReadingCheck(0.0, 0.0, False)

    matcher = difflib.SequenceMatcher(a=expected, b=heard, autojunk=False)
    blocks = [b for b in matcher.get_matching_blocks() if b.size]
    matched = sum(b.size for b in blocks)
    # Fin lue : un des deux derniers mots attendus est reconnu
    tail = {len(expected) - 1, len(expected) - 2}
    ending_ok = any(b.a <= i < b.a + b.size for b in blocks for i in tail if i >= 0)
    return ReadingCheck(
        coverage=matched / len(expected),
        extra=max(0, len(heard) - matched) / len(expected),
        ending_ok=ending_ok,
    )


_SILENCE_START = re.compile(r"silence_start: (-?[\d.]+)")
_SILENCE_END = re.compile(r"silence_end: (-?[\d.]+)")


def parse_silences(ffmpeg_log: str, duration: float) -> list[tuple[float, float]]:
    """Intervalles de silence tirés de la sortie du filtre silencedetect."""
    silences: list[tuple[float, float]] = []
    start: float | None = None
    for line in ffmpeg_log.splitlines():
        if m := _SILENCE_START.search(line):
            start = max(0.0, float(m.group(1)))
        elif (m := _SILENCE_END.search(line)) and start is not None:
            silences.append((start, float(m.group(1))))
            start = None
    if start is not None:
        silences.append((start, duration))
    return silences


async def detect_silences(path: Path, duration: float) -> list[tuple[float, float]]:
    log = await proc.run(
        [
            "ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
            "-af", f"silencedetect=noise={SILENCE_NOISE_DB}dB:d={SILENCE_MIN_SECONDS}",
            "-f", "null", "-",
        ],
        timeout=120,
        stderr_output=True,
    )  # fmt: skip
    return parse_silences(log, duration)


def speech_bounds(
    silences: list[tuple[float, float]], duration: float, pad: float = 0.08
) -> tuple[float, float]:
    """Début et fin de la parole (silences d'ouverture et de fin retirés, avec une marge)."""
    start, end = 0.0, duration
    for s, e in silences:
        if s <= 0.01:
            start = max(start, e)
        if e >= duration - 0.01:
            end = min(end, s)
    start, end = max(0.0, start - pad), min(duration, end + pad)
    return (start, end) if end > start else (0.0, duration)


def cut_point(silences: list[tuple[float, float]], after: float, before: float) -> float:
    """Instant de coupe entre deux phrases : au milieu du plus long silence
    situé entre la fin de l'une et le début de l'autre (bornes Whisper élargies,
    car imprécises). Sans silence mesuré, le milieu de l'écart."""
    low, high = after - 0.3, before + 0.3
    candidates = [(e - s, (s + e) / 2) for s, e in silences if e > low and s < high]
    if candidates:
        return max(candidates)[1]
    return (after + before) / 2
