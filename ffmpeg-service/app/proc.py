"""Exécution asynchrone de FFmpeg/ffprobe : le serveur reste disponible
pendant un encodage (l'ancien subprocess.run bloquait toute l'API)."""

import asyncio
import json
import logging
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)


class CommandError(RuntimeError):
    """Commande externe en échec, avec la fin de sa sortie d'erreur."""

    def __init__(self, cmd: list[str], returncode: int, stderr: str):
        tail = "\n".join(stderr.strip().splitlines()[-15:])
        super().__init__(f"{cmd[0]} a échoué (code {returncode}) :\n{tail}")
        self.returncode = returncode
        self.stderr = stderr


async def run(cmd: list[str], timeout: float = 900) -> str:
    """Lance une commande et renvoie sa sortie standard."""
    log.debug("exec: %s", " ".join(cmd))
    process = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout)
    except TimeoutError as error:
        process.kill()
        await process.wait()
        raise CommandError(cmd, -1, f"délai de {timeout:.0f} s dépassé") from error
    if process.returncode != 0:
        raise CommandError(cmd, process.returncode, stderr.decode(errors="replace"))
    return stdout.decode(errors="replace")


@dataclass
class MediaInfo:
    duration: float
    has_audio: bool
    width: int = 0
    height: int = 0
    color_transfer: str = ""

    @property
    def is_hdr(self) -> bool:
        # HLG (iPhone) ou PQ (HDR10)
        return self.color_transfer in ("arib-std-b67", "smpte2084")


async def probe(path: Path) -> MediaInfo:
    out = await run(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ],
        timeout=60,
    )
    data = json.loads(out)
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), {})
    duration = float(data.get("format", {}).get("duration") or video.get("duration") or 0)
    return MediaInfo(
        duration=duration,
        has_audio=any(s.get("codec_type") == "audio" for s in streams),
        width=int(video.get("width") or 0),
        height=int(video.get("height") or 0),
        color_transfer=video.get("color_transfer") or "",
    )
