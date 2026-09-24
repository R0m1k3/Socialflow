"""Calage mot à mot du texte affiché sur la voix.

Le texte affiché (ponctuation, majuscules) diffère légèrement des mots
reconnus ou annoncés par le moteur de voix : on apparie les deux séquences
(difflib) et on interpole les mots sans correspondance. Remplace ffsubsync,
qui ne faisait qu'un décalage global du texte réparti uniformément.
"""

import asyncio
import difflib
import logging
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from . import config

log = logging.getLogger(__name__)


@dataclass
class Word:
    text: str
    start: float
    end: float

    def to_dict(self) -> dict:
        return {"text": self.text, "start": round(self.start, 3), "end": round(self.end, 3)}


def normalize(token: str) -> str:
    """Forme comparable d'un mot : minuscules, sans accents ni ponctuation."""
    decomposed = unicodedata.normalize("NFKD", token.lower())
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", stripped)


def display_tokens(text: str) -> list[str]:
    """Mots à afficher ; la ponctuation isolée est rattachée au mot précédent."""
    tokens: list[str] = []
    for raw in text.split():
        if tokens and not normalize(raw):
            tokens[-1] += raw if raw in ",.!?;:…" else f" {raw}"
        else:
            tokens.append(raw)
    return tokens


def align_words(display_text: str, spoken: list[Word], total_duration: float | None = None) -> list[Word]:
    """Attribue à chaque mot affiché un début et une fin tirés des mots prononcés."""
    tokens = display_tokens(display_text)
    if not tokens:
        return []
    if not spoken:
        return _spread(tokens, 0.0, total_duration or len(tokens) * 0.4)

    timed: list[Word | None] = [None] * len(tokens)
    matcher = difflib.SequenceMatcher(
        a=[normalize(t) for t in tokens], b=[normalize(w.text) for w in spoken], autojunk=False
    )
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            src = spoken[block.b + k]
            timed[block.a + k] = Word(tokens[block.a + k], src.start, src.end)

    # Mots non appariés : répartis dans le trou entre leurs voisins datés
    end_of_speech = max(spoken[-1].end, total_duration or 0.0)
    i = 0
    while i < len(tokens):
        if timed[i] is not None:
            i += 1
            continue
        j = i
        while j < len(tokens) and timed[j] is None:
            j += 1
        gap_start = timed[i - 1].end if i > 0 else 0.0
        gap_end = timed[j].start if j < len(tokens) else end_of_speech
        if gap_end - gap_start < 0.05 * (j - i):
            gap_end = gap_start + 0.25 * (j - i)
        timed[i:j] = _spread(tokens[i:j], gap_start, gap_end)
        i = j

    words = [w for w in timed if w is not None]
    # Monotonie stricte : un mot ne commence jamais avant la fin du précédent
    for prev, cur in zip(words, words[1:]):
        cur.start = max(cur.start, prev.start + 0.01)
        cur.end = max(cur.end, cur.start + 0.05)
    return words


def _spread(tokens: list[str], start: float, end: float) -> list[Word]:
    """Répartit des mots sur un intervalle au prorata de leur longueur."""
    weights = [max(1, len(normalize(t))) for t in tokens]
    total = sum(weights)
    words, cursor = [], start
    for token, weight in zip(tokens, weights):
        duration = (end - start) * weight / total
        words.append(Word(token, cursor, cursor + duration))
        cursor += duration
    return words


@lru_cache(maxsize=1)
def _model():
    from faster_whisper import WhisperModel

    log.info("Chargement du modèle Whisper %s", config.WHISPER_MODEL)
    return WhisperModel(config.WHISPER_MODEL, device="cpu", compute_type=config.WHISPER_COMPUTE_TYPE)


def _transcribe_sync(audio: Path, hint: str | None) -> list[Word]:
    segments, _ = _model().transcribe(
        str(audio),
        language="fr",
        word_timestamps=True,
        initial_prompt=hint or None,
        vad_filter=False,
        beam_size=5,
    )
    return [
        Word(w.word.strip(), float(w.start), float(w.end))
        for segment in segments
        for w in (segment.words or [])
        if w.word.strip()
    ]


async def transcribe(audio: Path, hint: str | None = None) -> list[Word]:
    """Mots prononcés et leurs instants (Whisper, exécuté hors de la boucle async)."""
    return await asyncio.to_thread(_transcribe_sync, audio, hint)
