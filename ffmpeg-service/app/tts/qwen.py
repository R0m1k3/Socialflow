"""Synthèse vocale Qwen3-TTS (service qwen-tts, local ou sur un serveur GPU)."""

import logging
from dataclasses import dataclass
from pathlib import Path

import httpx

from .. import config
from ..voices import qwen_instruction, resolve_qwen_voice

log = logging.getLogger(__name__)


class QwenError(RuntimeError):
    pass


@dataclass(frozen=True)
class Target:
    """Service Qwen à appeler : réglé dans les paramètres de l'application,
    sinon par les variables d'environnement."""

    url: str
    api_key: str = ""

    @classmethod
    def resolve(cls, url: str | None = None, api_key: str | None = None) -> "Target | None":
        if url and url.strip():
            return cls(url.strip().rstrip("/"), (api_key or "").strip())
        if config.QWEN_TTS_URL:
            return cls(config.QWEN_TTS_URL, config.QWEN_TTS_API_KEY)
        return None

    @property
    def headers(self) -> dict[str, str]:
        return {"x-api-key": self.api_key} if self.api_key else {}


async def synthesize(
    text: str, voice: str | None, style: str | None, target: Target | None, workdir: Path, attempt: int = 0
) -> tuple[Path, str]:
    """Génère la voix ; renvoie un WAV brut et la voix utilisée."""
    if target is None:
        raise QwenError("service Qwen TTS non configuré (Paramètres → Qwen TTS)")
    qwen_voice = resolve_qwen_voice(voice)
    payload = {"text": text, "voice": qwen_voice, "instruct": qwen_instruction(style), "language": "French"}
    log.info("Qwen TTS (%s) : voix=%s style=%s (%d car.)", target.url, qwen_voice, style, len(text))
    try:
        async with httpx.AsyncClient(timeout=config.QWEN_TTS_TIMEOUT) as client:
            response = await client.post(f"{target.url}/synthesize", json=payload, headers=target.headers)
    except httpx.HTTPError as error:
        raise QwenError(f"service Qwen TTS injoignable : {error!r}") from error
    if response.status_code != 200:
        raise QwenError(f"Qwen TTS : HTTP {response.status_code} {response.text[:300]}")
    raw = workdir / f"qwen_raw_{attempt}.wav"
    raw.write_bytes(response.content)
    return raw, response.headers.get("x-voice", qwen_voice)


async def status(target: Target | None) -> dict | None:
    """État du service (modèle, carte graphique) et voix proposées, clonées
    comprises ; None s'il n'est pas configuré ou ne répond pas."""
    if target is None:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            health = await client.get(f"{target.url}/health", headers=target.headers)
            health.raise_for_status()
            listed = await client.get(f"{target.url}/voices", headers=target.headers)
            listed.raise_for_status()
        return {**health.json(), "voices": listed.json()["voices"]}
    except Exception as error:  # noqa: BLE001 — moteur simplement signalé indisponible
        log.warning("Service Qwen TTS %s indisponible : %s", target.url, error)
        return None
