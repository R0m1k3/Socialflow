"""Voix calée sur un fichier SRT.

Tout le texte est lu d'une seule traite, puis la voix est découpée phrase par
phrase au point le plus calme de chaque pause, et chaque morceau est posé à l'instant de son
sous-titre. Une lecture unique garde la même intonation, le même rythme et le
même niveau d'un bout à l'autre ; lire chaque sous-titre séparément donnait
une voix différente à chaque phrase, et le découpage aux bornes estimées par
Whisper rognait des syllabes.

Si la lecture unique ne peut pas être répartie entre les sous-titres, on lit
chaque sous-titre séparément (même voix, même graine), en découpant là aussi
au niveau sonore mesuré.

La voix n'est jamais accélérée : quand un morceau est plus long que son
sous-titre, il déborde et les morceaux suivants sont décalés d'autant (le
minutage SRT n'est qu'un instant de départ au plus tôt). Les sous-titres
affichés suivent la voix et la vidéo s'allonge si besoin.
"""

import logging
import re
from dataclasses import dataclass
from pathlib import Path

from . import proc, quality, tts
from .align import Word, display_tokens
from .text import clean_text

log = logging.getLogger(__name__)

# Silence ajouté entre deux morceaux décalés (en plus des marges de chaque morceau)
MIN_GAP = 0.05
# Au-delà de ce retard cumulé sur le minutage SRT, l'utilisateur est prévenu
DRIFT_WARNING = 1.0

_SENTENCE_END = re.compile(r"[.!?…]$")


@dataclass
class Cue:
    start: float
    end: float
    text: str


@dataclass
class Segment:
    """Morceau de la voix lue, à poser à l'instant d'un sous-titre."""

    source_start: float
    source_end: float
    words: list[Word]


def place_segments(cues: list[Cue], durations: list[float]) -> list[float]:
    """Instant de départ de chaque morceau : celui de son sous-titre, ou juste
    après le morceau précédent s'il déborde (vitesse naturelle conservée)."""
    starts: list[float] = []
    previous_end = 0.0
    for cue, duration in zip(cues, durations):
        start = cue.start if not starts else max(cue.start, previous_end + MIN_GAP)
        starts.append(start)
        previous_end = start + duration
    return starts


def as_sentence(text: str) -> str:
    """Chaque sous-titre finit par une ponctuation : la voix y marque une pause,
    ce qui laisse un silence où couper."""
    text = clean_text(text)
    return text if _SENTENCE_END.search(text) else f"{text}."


def split_by_cue(words: list[Word], cue_texts: list[str]) -> list[list[Word]] | None:
    """Répartit les mots de la lecture complète entre les sous-titres
    (les mots affichés suivent l'ordre du texte). None si les comptes divergent."""
    counts = [len(display_tokens(t)) for t in cue_texts]
    if sum(counts) != len(words) or 0 in counts:
        return None
    groups, index = [], 0
    for count in counts:
        groups.append(words[index : index + count])
        index += count
    return groups


def segments_from_reading(groups: list[list[Word]], envelope: quality.Envelope) -> list[Segment] | None:
    """Découpe la lecture complète entre les phrases, au point le plus calme de
    chaque pause, puis retire le silence autour de chaque phrase en gardant une
    marge (300 ms après le dernier son : les fins de phrases ne sont pas rognées)."""
    cuts = [0.0]
    for previous, following in zip(groups, groups[1:]):
        cuts.append(quality.sentence_cut(envelope, previous[-1].end, following[0].start, after=cuts[-1]))
    cuts.append(envelope.duration)
    if any(b <= a for a, b in zip(cuts, cuts[1:])):
        return None

    segments = []
    for i, group in enumerate(groups):
        seg_start, seg_end = envelope.speech_span(cuts[i], cuts[i + 1])
        segments.append(Segment(seg_start, seg_end, group))
    return segments


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

    options = dict(engine=engine, voice=voice, style=style, gemini_api_key=gemini_api_key)
    texts = [as_sentence(c.text) for c in cues]

    # 1. Lecture d'une seule traite, découpée dans les silences
    script = " ".join(texts)
    reading = await tts.synthesize(text=script, display_text=script, workdir=workdir, **options)
    envelope = await quality.load_envelope(reading.path)
    groups = split_by_cue(reading.words, texts)
    segments = segments_from_reading(groups, envelope) if groups else None

    if segments:
        sources = [(reading.path, seg) for seg in segments]
        warnings = list(reading.warnings)
        used_engine, used_voice = reading.engine, reading.voice
    else:
        # 2. Repli : chaque sous-titre lu séparément, avec la voix de la lecture complète
        log.warning("Lecture SRT non répartie entre les sous-titres : lecture phrase par phrase")
        sources, warnings = [], list(reading.warnings)
        used_engine, used_voice = reading.engine, reading.voice
        for index, text in enumerate(texts):
            cue_dir = workdir / f"cue_{index:03d}"
            cue_dir.mkdir(exist_ok=True)
            track = await tts.synthesize(
                text=text,
                display_text=text,
                workdir=cue_dir,
                **{**options, "engine": used_engine, "voice": used_voice or voice},
            )
            warnings += [w for w in track.warnings if w not in warnings]
            cue_envelope = await quality.load_envelope(track.path)
            span = cue_envelope.speech_span(0.0, cue_envelope.duration)
            sources.append((track.path, Segment(span[0], span[1], track.words)))

    durations = [segment.source_end - segment.source_start for _, segment in sources]
    starts = place_segments(cues, durations)
    placed: list[tuple[Path, float]] = []
    words: list[Word] = []
    for index, (cue, start, (source, segment)) in enumerate(zip(cues, starts, sources)):
        fitted = workdir / f"segment_{index:03d}.wav"
        await proc.run(extract_command(source, segment, fitted), timeout=120)
        placed.append((fitted, start))
        added_period = not _SENTENCE_END.search(clean_text(cue.text))
        for position, w in enumerate(segment.words):
            text = w.text
            if added_period and position == len(segment.words) - 1:
                text = text.rstrip(".")  # point ajouté pour la lecture, pas à afficher
            word_start = start + max(0.0, w.start - segment.source_start)
            word_end = start + max(0.0, w.end - segment.source_start)
            words.append(Word(text or w.text, word_start, max(word_end, word_start + 0.05)))

    drift = max((s - c.start for s, c in zip(starts, cues)), default=0.0)
    if drift > DRIFT_WARNING:
        warnings.append(
            f"Le texte lu dépasse le minutage du SRT : les derniers sous-titres sont décalés "
            f"de {drift:.1f} s (voix gardée à vitesse normale). Raccourcissez le texte "
            "ou allongez les durées pour rester calé."
        )

    output = workdir / "voice_srt.wav"
    await proc.run(mix_command(placed, output), timeout=300)
    duration = (await proc.probe(output)).duration
    log.info(
        "Voix SRT prête : %s/%s, %d sous-titres, %.1f s (%s)",
        used_engine,
        used_voice,
        len(cues),
        duration,
        "lecture unique" if segments else "phrase par phrase",
    )
    return tts.VoiceTrack(output, duration, _monotonic(words), used_engine, used_voice, warnings)


def extract_command(source: Path, segment: Segment, output: Path) -> list[str]:
    """Extrait un morceau de voix, à vitesse normale, avec un fondu de 10 ms
    aux bords (pas de clic)."""
    length = segment.source_end - segment.source_start
    fade_out = max(0.0, length - 0.01)
    filters = (
        f"atrim=start={segment.source_start:.3f}:end={segment.source_end:.3f},asetpts=PTS-STARTPTS,"
        f"afade=t=in:d=0.01,afade=t=out:st={fade_out:.3f}:d=0.01"
    )
    return [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(source),
        "-af", filters, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", str(output),
    ]  # fmt: skip


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
        "-filter_complex", ";".join(graph), "-map", "[voice]",
        "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", str(output),
    ]  # fmt: skip


def _monotonic(words: list[Word]) -> list[Word]:
    for prev, cur in zip(words, words[1:]):
        cur.start = max(cur.start, prev.start + 0.01)
        cur.end = max(cur.end, cur.start + 0.05)
    return words
