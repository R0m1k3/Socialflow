"""Traitement de la voix : filtrage, compression et niveau sonore constant."""

from pathlib import Path

from . import proc

# Coupe les basses inutiles, lisse la dynamique et amène la voix à -16 LUFS :
# elle reste intelligible par-dessus la musique sans saturer.
VOICE_CHAIN = (
    "highpass=f=80,"
    "acompressor=threshold=0.1:ratio=3:attack=5:release=120:makeup=2,"
    "loudnorm=I=-16:TP=-1.5:LRA=7,"
    "aresample=48000"
)


async def process_voice(source: Path, target: Path) -> None:
    """Produit un WAV 48 kHz mono prêt à mixer."""
    await proc.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-af",
            VOICE_CHAIN,
            "-ac",
            "1",
            "-ar",
            "48000",
            "-c:a",
            "pcm_s16le",
            str(target),
        ],
        timeout=120,
    )


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
