"""Synthèse vocale locale Qwen3-TTS (service qwen-tts, sans clé ni quota)."""

import logging
from pathlib import Path

import httpx

from .. import config
from ..voices import qwen_instruction, resolve_qwen_voice

log = logging.getLogger(__name__)


class QwenError(RuntimeError):
    pass


def _headers() -> dict[str, str]:
    return {"x-api-key": config.QWEN_TTS_API_KEY} if config.QWEN_TTS_API_KEY else {}


async def synthesize(
    text: str, voice: str | None, style: str | None, workdir: Path, attempt: int = 0
) -> tuple[Path, str]:
    """Génère la voix ; renvoie un WAV brut et la voix utilisée."""
    if not config.QWEN_TTS_URL:
        raise QwenError("service Qwen TTS non configuré (QWEN_TTS_URL)")
    qwen_voice = resolve_qwen_voice(voice)
    payload = {"text": text, "voice": qwen_voice, "instruct": qwen_instruction(style), "language": "French"}
    log.info("Qwen TTS : voix=%s style=%s (%d car.)", qwen_voice, style, len(text))
    try:
        async with httpx.AsyncClient(timeout=config.QWEN_TTS_TIMEOUT) as client:
            response = await client.post(
                f"{config.QWEN_TTS_URL}/synthesize", json=payload, headers=_headers()
            )
    except httpx.HTTPError as error:
        raise QwenError(f"service Qwen TTS injoignable : {error!r}") from error
    if response.status_code != 200:
        raise QwenError(f"Qwen TTS : HTTP {response.status_code} {response.text[:300]}")
    raw = workdir / f"qwen_raw_{attempt}.wav"
    raw.write_bytes(response.content)
    return raw, response.headers.get("x-voice", qwen_voice)


async def list_voices() -> list[dict] | None:
    """Voix proposées par le service (clonées comprises) ; None s'il ne répond pas."""
    if not config.QWEN_TTS_URL:
        return None
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{config.QWEN_TTS_URL}/voices", headers=_headers())
        response.raise_for_status()
        return response.json()["voices"]
    except Exception as error:  # noqa: BLE001 — moteur simplement signalé indisponible
        log.warning("Service Qwen TTS indisponible : %s", error)
        return None
