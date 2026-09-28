"""Contrôles de la voix générée : texte réellement lu et silences.

Gemini lit parfois mal : mots sautés, fin tronquée, consigne de style lue à
voix haute. On compare donc ce que Whisper entend au texte attendu, et on
découpe la voix d'après son niveau sonore réel (mesuré toutes les 10 ms)
plutôt qu'aux bornes des mots estimées par Whisper, trop imprécises pour ne
pas rogner une syllabe.
"""

import asyncio
import difflib
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import proc
from .align import Word, normalize


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
    """Compare le texte attendu à ce qui a été entendu (Whisper), lettre à
    lettre : les petites erreurs de reconnaissance (« petit » pour « petits »,
    « week -end » découpé) ne comptent pas comme des mots manquants, alors
    qu'un mot sauté, une fin tronquée ou une phrase ajoutée se voient."""
    expected = "".join(normalize(w) for w in expected_text.split())
    heard = "".join(normalize(w.text) for w in spoken)
    if not expected:
        return ReadingCheck(1.0, 0.0, True)
    if not heard:
        return ReadingCheck(0.0, 0.0, False)

    matcher = difflib.SequenceMatcher(a=expected, b=heard, autojunk=False)
    blocks = [b for b in matcher.get_matching_blocks() if b.size]
    matched = sum(b.size for b in blocks)
    # Fin lue : une bonne partie des dernières lettres du texte est reconnue
    tail_start = max(0, len(expected) - 8)
    tail_matched = sum(max(0, min(b.a + b.size, len(expected)) - max(b.a, tail_start)) for b in blocks)
    return ReadingCheck(
        coverage=matched / len(expected),
        extra=max(0, len(heard) - matched) / len(expected),
        ending_ok=tail_matched >= min(4, len(expected) - tail_start),
    )


# Enveloppe sonore : niveau de la voix toutes les 10 ms
FRAME = 0.01
# Est « audible » ce qui dépasse le niveau de crête moins 38 dB : un seuil
# relatif respecte les fins de phrases douces (« s » final, voix qui retombe),
# qu'un seuil absolu prenait pour du silence.
ACTIVE_RANGE_DB = 38.0
# Marges gardées autour de la parole
LEAD_PAD = 0.08
TAIL_PAD = 0.30


@dataclass
class Envelope:
    db: np.ndarray  # niveau (dBFS) de chaque tranche de 10 ms

    @property
    def duration(self) -> float:
        return len(self.db) * FRAME

    @property
    def threshold(self) -> float:
        if not len(self.db):
            return 0.0
        return float(np.percentile(self.db, 95)) - ACTIVE_RANGE_DB

    def _frames(self, start: float, end: float) -> tuple[int, int]:
        first = max(0, int(start / FRAME))
        last = min(len(self.db), int(np.ceil(end / FRAME)))
        return first, max(first, last)

    def quietest(self, start: float, end: float) -> float:
        """Milieu de la zone la plus calme d'un intervalle : la coupe tombe au
        cœur de la pause, loin des deux phrases qu'elle sépare."""
        first, last = self._frames(start, end)
        if last - first < 1:
            return (start + end) / 2
        smooth = np.convolve(self.db, np.ones(5) / 5, mode="same")[first:last]
        quiet = smooth <= smooth.min() + 3.0  # à 3 dB du minimum
        best_start, best_length, run_start = 0, 0, None
        for i, is_quiet in enumerate([*quiet, False]):
            if is_quiet and run_start is None:
                run_start = i
            elif not is_quiet and run_start is not None:
                if i - run_start > best_length:
                    best_start, best_length = run_start, i - run_start
                run_start = None
        return (first + best_start + best_length / 2) * FRAME

    def first_sound(self, start: float, end: float) -> float | None:
        first, last = self._frames(start, end)
        active = np.nonzero(self.db[first:last] > self.threshold)[0]
        return (first + int(active[0])) * FRAME if len(active) else None

    def last_sound(self, start: float, end: float) -> float | None:
        first, last = self._frames(start, end)
        active = np.nonzero(self.db[first:last] > self.threshold)[0]
        return (first + int(active[-1]) + 1) * FRAME if len(active) else None

    def speech_span(self, start: float, end: float) -> tuple[float, float]:
        """Parole contenue dans [start, end], avec ses marges, sans en sortir."""
        onset, offset = self.first_sound(start, end), self.last_sound(start, end)
        if onset is None or offset is None:
            return start, end
        return max(start, onset - LEAD_PAD), min(end, offset + TAIL_PAD)


def envelope_from_samples(samples: np.ndarray, rate: int) -> Envelope:
    per_frame = int(rate * FRAME)
    count = len(samples) // per_frame
    if count == 0:
        return Envelope(np.array([-120.0]))
    frames = samples[: count * per_frame].reshape(count, per_frame).astype(np.float64)
    rms = np.sqrt(np.mean(frames**2, axis=1))
    return Envelope(20 * np.log10(np.maximum(rms, 1e-6)))


async def load_envelope(path: Path) -> Envelope:
    """Décode l'audio (mono 16 kHz) et mesure son niveau toutes les 10 ms."""
    process = await asyncio.create_subprocess_exec(
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
        "-ac", "1", "-ar", "16000", "-f", "f32le", "-",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )  # fmt: skip
    raw, err = await process.communicate()
    if process.returncode != 0:
        raise proc.CommandError(["ffmpeg"], process.returncode, err.decode(errors="replace"))
    return envelope_from_samples(np.frombuffer(raw, dtype=np.float32), 16000)


def sentence_cut(envelope: Envelope, previous_end: float, next_start: float) -> float:
    """Coupe entre deux phrases, au point le plus calme de la pause. Les bornes
    Whisper sont imprécises : on cherche un peu autour."""
    low = max(0.0, min(previous_end, next_start) - 0.1)
    high = max(previous_end, next_start) + 0.2
    return envelope.quietest(low, high)
