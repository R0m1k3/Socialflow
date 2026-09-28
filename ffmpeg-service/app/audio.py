"""Traitement de la voix : filtrage, compression et niveau sonore constant."""

import json
from pathlib import Path

from . import proc

# Nettoyage de la voix : coupe les basses inutiles, retire le souffle de fond
# (réduction douce, sans gate qui hacherait les fins de phrases) et arrondit
# les pics. Pas de gain ajouté : c'est la normalisation qui règle le niveau.
CLEAN_CHAIN = (
    "highpass=f=80,"
    "afftdn=nr=10:nf=-50:tn=1,"
    "acompressor=threshold=0.125:ratio=2.5:attack=5:release=150:makeup=1"
)
# Niveau cible de la voix : intelligible par-dessus la musique sans saturer
TARGET = "I=-16:TP=-1.5:LRA=11"
# Fondu de 5 ms aux extrémités : pas de clic au début ni à la fin
EDGE_FADE = 0.005


async def process_voice(source: Path, target: Path) -> None:
    """Produit un WAV 48 kHz mono prêt à mixer.

    Normalisation en deux passes, en mode linéaire : un seul gain appliqué à
    toute la voix. Le mode dynamique (une passe) relevait les passages calmes
    et amplifiait souffles et bruits entre les phrases."""
    measure = await proc.run(
        [
            "ffmpeg", "-hide_banner", "-nostats", "-i", str(source),
            "-af", f"{CLEAN_CHAIN},loudnorm={TARGET}:print_format=json", "-f", "null", "-",
        ],
        timeout=120,
        stderr_output=True,
    )  # fmt: skip
    stats = _loudnorm_stats(measure)
    if stats:
        loudnorm = (
            f"loudnorm={TARGET}:linear=true:"
            f"measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:"
            f"measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:"
            f"offset={stats['target_offset']}"
        )
    else:
        loudnorm = f"loudnorm={TARGET}"
    duration = (await proc.probe(source)).duration
    fades = f"afade=t=in:d={EDGE_FADE},afade=t=out:st={max(0.0, duration - EDGE_FADE):.3f}:d={EDGE_FADE}"
    await proc.run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(source),
            "-af", f"{CLEAN_CHAIN},{loudnorm},aresample=48000,{fades}",
            "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", str(target),
        ],
        timeout=120,
    )  # fmt: skip


def _loudnorm_stats(ffmpeg_log: str) -> dict[str, str] | None:
    """Mesures de la première passe (bloc JSON écrit par loudnorm)."""
    start, end = ffmpeg_log.rfind("{"), ffmpeg_log.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        stats = json.loads(ffmpeg_log[start : end + 1])
    except json.JSONDecodeError:
        return None
    keys = ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")
    if not all(k in stats for k in keys):
        return None
    # Voix quasi muette : les mesures valent -inf, la normalisation simple suffit
    if any("inf" in str(stats[k]) for k in keys):
        return None
    return {k: stats[k] for k in keys}


async def encode_preview(source: Path, target: Path) -> None:
    """MP3 de bonne qualité pour l'écoute dans le navigateur."""
    await proc.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-c:a",
            "libmp3lame",
            "-b:a",
            "160k",
            str(target),
        ],
        timeout=120,
    )
