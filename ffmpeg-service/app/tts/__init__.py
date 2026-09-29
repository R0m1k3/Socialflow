"""Synthèse vocale : moteur au choix (Qwen local, Gemini, Edge), replis
successifs, voix traitée et mots minutés."""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path

from .. import align, audio, config, proc, quality
from ..align import Word
from . import edge, gemini, qwen

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
    qwen_target: qwen.Target | None = None,
) -> VoiceTrack:
    warnings: list[str] = []
    processed: Path | None = None
    spoken: list[Word] = []
    used_engine, used_voice = "edge", ""
    engine = engine or "gemini"

    if engine == "qwen":
        result = await _checked(
            "Qwen",
            lambda attempt: qwen.synthesize(text, voice, style, qwen_target, workdir, attempt),
            config.QWEN_TTS_ATTEMPTS,
            text,
            workdir,
            warnings,
        )
        if result:
            processed, spoken, used_voice, reading_ok = result
            used_engine = "qwen"
            if reading_ok:
                processed, spoken = await _trim_stray_sounds(processed, spoken, workdir)
        elif gemini_api_key:
            engine = "gemini"  # repli sur Gemini quand une clé est disponible

    if engine == "gemini" and processed is None:
        if not gemini_api_key:
            warnings.append("Clé Gemini absente : voix Edge utilisée à la place.")
        else:
            result = await _checked(
                "Gemini",
                lambda attempt: gemini.synthesize(text, voice, style, gemini_api_key, workdir, attempt),
                config.GEMINI_TTS_ATTEMPTS,
                text,
                workdir,
                warnings,
            )
            if result:
                processed, spoken, used_voice, reading_ok = result
                used_engine = "gemini"
                if reading_ok:
                    processed, spoken = await _trim_stray_sounds(processed, spoken, workdir)

    if processed is None:
        raw, spoken, used_voice = await edge.synthesize(text, voice, style, workdir)
        processed = workdir / "voice.wav"
        await audio.process_voice(raw, processed)

    duration = (await proc.probe(processed)).duration
    if not spoken:
        spoken = await align.transcribe(processed)

    words = align.align_words(display_text, spoken, duration)
    log.info("Voix prête : %s/%s, %.1f s, %d mots", used_engine, used_voice, duration, len(words))
    return VoiceTrack(processed, duration, words, used_engine, used_voice, warnings)


# En dessous, une lecture imparfaite est écartée au profit du moteur suivant :
# mieux vaut une autre voix qu'une phrase aux mots sautés ou inventés.
KEEP_IMPERFECT_COVERAGE = 0.85


async def _checked(
    name: str,
    generate: Callable[[int], Awaitable[tuple[Path, str]]],
    attempts: int,
    text: str,
    workdir: Path,
    warnings: list[str],
) -> tuple[Path, list[Word], str, bool] | None:
    """Voix dont la lecture a été vérifiée : Whisper réécoute chaque
    génération ; mots sautés, fin tronquée ou consigne lue à voix haute
    déclenchent une nouvelle génération. Renvoie None pour passer au moteur suivant."""
    best: tuple[quality.ReadingCheck, Path, list[Word], str] | None = None
    last_error: Exception | None = None

    for attempt in range(max(1, attempts)):
        try:
            raw, engine_voice = await generate(attempt)
        except Exception as error:  # noqa: BLE001 — nouvelle tentative, puis moteur suivant
            log.warning("%s TTS en échec (tentative %d) : %s", name, attempt + 1, error)
            last_error = error
            continue

        processed = workdir / f"voice_{name.lower()}_{attempt}.wav"
        await audio.process_voice(raw, processed)
        spoken = await align.transcribe(processed)
        check = quality.check_reading(text, spoken)
        log.info("Lecture %s (tentative %d) : %s", name, attempt + 1, check.describe())

        if best is None or _score(check) > _score(best[0]):
            best = (check, processed, spoken, engine_voice)
        if check.acceptable:
            break

    if best is None:
        warnings.append(f"{name} indisponible ({last_error}) : voix de secours utilisée.")
        return None

    check, processed, spoken, engine_voice = best
    if not check.acceptable:
        if check.coverage < KEEP_IMPERFECT_COVERAGE:
            warnings.append(f"{name} a mal lu le texte ({check.describe()}) : voix de secours utilisée.")
            return None
        warnings.append(f"Lecture {name} imparfaite ({check.describe()}) : écoutez le résultat.")
    return processed, spoken, engine_voice, check.acceptable


# Au-delà de la fin du dernier mot, ce n'est plus de la parole
STRAY_AFTER_LAST_WORD = 0.6
STRAY_BEFORE_FIRST_WORD = 0.4


async def _trim_stray_sounds(path: Path, spoken: list[Word], workdir: Path) -> tuple[Path, list[Word]]:
    """Retire les bruits que le modèle ajoute parfois avant le premier ou après le
    dernier mot. Appelé seulement quand la lecture a été vérifiée : le dernier
    mot est bien reconnu, on ne coupe donc jamais de parole."""
    if not spoken:
        return path, spoken
    envelope = await quality.load_envelope(path)
    duration = envelope.duration
    window_start = max(0.0, spoken[0].start - STRAY_BEFORE_FIRST_WORD)
    window_end = min(duration, spoken[-1].end + STRAY_AFTER_LAST_WORD)
    start, end = envelope.speech_span(window_start, window_end)
    if start < 0.02 and end > duration - 0.02:
        return path, spoken

    trimmed = workdir / "voice_trimmed.wav"
    fade_out = max(0.0, end - start - 0.01)
    await proc.run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(path),
            "-af", f"atrim=start={start:.3f}:end={end:.3f},asetpts=PTS-STARTPTS,"
            f"afade=t=in:d=0.01,afade=t=out:st={fade_out:.3f}:d=0.01",
            "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", str(trimmed),
        ],
        timeout=60,
    )  # fmt: skip
    log.info("Voix recadrée sur la parole : %.2f–%.2f s (sur %.2f s)", start, end, duration)
    shifted = [Word(w.text, w.start - start, w.end - start) for w in spoken if w.start < end]
    return trimmed, shifted


def _score(check: quality.ReadingCheck) -> float:
    return check.coverage - check.extra + (0.2 if check.ending_ok else 0.0)
