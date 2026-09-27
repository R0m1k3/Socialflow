"""Voix calée sur un fichier SRT.

Chaque sous-titre est lu séparément puis posé à son instant de début. Si la
lecture est plus longue que le sous-titre, elle est accélérée (sans changer
la hauteur de la voix) pour finir à temps : la voix respecte le minutage du
fichier, au lieu d'un texte lu d'une traite.
"""

import logging
from dataclasses import dataclass
from pathlib import Path

from . import proc, tts
from .align import Word
from .text import clean_text

log = logging.getLogger(__name__)

# Débordement toléré sur le silence qui suit un sous-titre avant d'accélérer
OVERFLOW_TOLERANCE = 0.25
# Marges gardées autour des mots lors du retrait des silences de la voix
TRIM_LEAD = 0.05
TRIM_TAIL = 0.12
# Au-delà, l'accélération s'entend nettement : l'utilisateur est prévenu
AUDIBLE_SPEEDUP = 1.35


@dataclass
class Cue:
    start: float
    end: float
    text: str


def cue_windows(cues: list[Cue]) -> list[float]:
    """Durée disponible pour lire chaque sous-titre sans empiéter sur le suivant."""
    windows = []
    for i, cue in enumerate(cues):
        limit = cue.end + OVERFLOW_TOLERANCE
        if i + 1 < len(cues):
            limit = min(limit, max(cue.end, cues[i + 1].start))
        windows.append(max(0.1, limit - cue.start))
    return windows


def speed_factor(duration: float, window: float) -> float:
    """Accélération nécessaire pour tenir dans la fenêtre (1 = vitesse normale)."""
    return max(1.0, duration / window) if window > 0 else 1.0


def atempo_chain(factor: float) -> str:
    """Filtre atempo ; découpé en étapes ≤ 2 pour les anciennes versions de FFmpeg."""
    steps = []
    remaining = factor
    while remaining > 2.0:
        steps.append(2.0)
        remaining /= 2.0
    steps.append(remaining)
    return ",".join(f"atempo={s:.4f}" for s in steps)


def spoken_span(words: list[Word], duration: float) -> tuple[float, float]:
    """Partie parlée de la voix : les silences de début et de fin sont retirés."""
    if not words:
        return 0.0, duration
    start = max(0.0, words[0].start - TRIM_LEAD)
    end = min(duration, words[-1].end + TRIM_TAIL)
    return (start, end) if end > start else (0.0, duration)


async def synthesize_cues(
    *,
    cues: list[Cue],
    engine: str | None,
    voice: str | None,
    style: str | None,
    gemini_api_key: str | None,
    workdir: Path,
) -> tts.VoiceTrack:
    """Voix complète : mots minutés en secondes depuis le début de la vidéo."""
    cues = sorted((c for c in cues if clean_text(c.text)), key=lambda c: c.start)
    if not cues:
        raise ValueError("Aucun sous-titre lisible dans le fichier SRT")

    warnings: list[str] = []
    windows = cue_windows(cues)
    segments: list[tuple[Path, float]] = []
    words: list[Word] = []
    used_engine, used_voice = engine or "gemini", voice or ""

    for index, (cue, window) in enumerate(zip(cues, windows)):
        cue_dir = workdir / f"cue_{index:03d}"
        cue_dir.mkdir(exist_ok=True)
        text = clean_text(cue.text)
        track = await tts.synthesize(
            text=text,
            display_text=text,
            engine=used_engine,
            voice=voice,
            style=style,
            gemini_api_key=gemini_api_key,
            workdir=cue_dir,
        )
        for warning in track.warnings:
            if warning not in warnings:
                warnings.append(warning)
        # Après un repli sur Edge, on reste sur Edge : une seule voix du début à la fin
        used_engine, used_voice = track.engine, track.voice

        span_start, span_end = spoken_span(track.words, track.duration)
        factor = speed_factor(span_end - span_start, window)
        if factor > AUDIBLE_SPEEDUP:
            warnings.append(
                f"Sous-titre {index + 1} (« {cue.text[:40]} ») lu {factor:.1f}× plus vite "
                "pour tenir dans son minutage : raccourcissez-le ou allongez sa durée."
            )

        fitted = cue_dir / "fitted.wav"
        trim = f"atrim=start={span_start:.3f}:end={span_end:.3f}"
        await proc.run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(track.path),
                "-af",
                f"{trim},asetpts=PTS-STARTPTS,{atempo_chain(factor)}",
                "-ac",
                "1",
                "-ar",
                "48000",
                "-c:a",
                "pcm_s16le",
                str(fitted),
            ],
            timeout=120,
        )
        segments.append((fitted, cue.start))
        for w in track.words:
            start = cue.start + max(0.0, w.start - span_start) / factor
            end = cue.start + max(0.0, w.end - span_start) / factor
            words.append(Word(w.text, start, min(max(end, start + 0.05), cue.start + window)))

    output = workdir / "voice.wav"
    await proc.run(mix_command(segments, output), timeout=300)
    duration = (await proc.probe(output)).duration
    log.info("Voix SRT prête : %s/%s, %d sous-titres, %.1f s", used_engine, used_voice, len(cues), duration)
    return tts.VoiceTrack(output, duration, _monotonic(words), used_engine, used_voice, warnings)


def mix_command(segments: list[tuple[Path, float]], output: Path) -> list[str]:
    """Pose chaque segment de voix à son instant, sur une seule piste."""
    command = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    for path, _ in segments:
        command += ["-i", str(path)]
    graph = [f"[{i}:a]adelay={int(round(start * 1000))}:all=1[s{i}]" for i, (_, start) in enumerate(segments)]
    labels = "".join(f"[s{i}]" for i in range(len(segments)))
    graph.append(
        f"{labels}amix=inputs={len(segments)}:duration=longest:dropout_transition=0:normalize=0[voice]"
    )
    return command + [
        "-filter_complex",
        ";".join(graph),
        "-map",
        "[voice]",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-c:a",
        "pcm_s16le",
        str(output),
    ]


def _monotonic(words: list[Word]) -> list[Word]:
    for prev, cur in zip(words, words[1:]):
        cur.start = max(cur.start, prev.start + 0.01)
        cur.end = max(cur.end, cur.start + 0.05)
    return words
