"""Synthèse vocale Gemini (API generateContent, modalité audio)."""

import base64
import logging
import re
from pathlib import Path

import httpx

from .. import config, proc
from ..voices import resolve_gemini_voice, style_instruction

log = logging.getLogger(__name__)

API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"
FALLBACK_MODEL = "gemini-2.5-flash-preview-tts"


class GeminiError(RuntimeError):
    pass


def build_prompt(text: str, style: str | None) -> str:
    """Texte envoyé au modèle : la consigne de style précède le texte à lire."""
    instruction = style_instruction(style)
    return f"{instruction} :\n{text}" if instruction else text


async def _request(model: str, prompt: str, voice: str, api_key: str) -> dict:
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
        },
    }
    async with httpx.AsyncClient(timeout=120) as client:
        # Clé en en-tête : dans l'URL, elle finissait dans les journaux
        response = await client.post(
            f"{API_ROOT}/{model}:generateContent",
            json=payload,
            headers={"x-goog-api-key": api_key},
        )
    if response.status_code != 200:
        raise GeminiError(f"Gemini {model} : HTTP {response.status_code} {response.text[:300]}")
    return response.json()


async def synthesize(
    text: str, voice: str | None, style: str | None, api_key: str, workdir: Path
) -> tuple[Path, str]:
    """Génère la voix ; renvoie un WAV brut et le nom de la voix utilisée."""
    gemini_voice = resolve_gemini_voice(voice).id
    prompt = build_prompt(text, style)
    model = config.GEMINI_TTS_MODEL
    log.info("Gemini TTS : modèle=%s voix=%s style=%s (%d car.)", model, gemini_voice, style, len(text))

    try:
        data = await _request(model, prompt, gemini_voice, api_key)
    except GeminiError as error:
        if model == FALLBACK_MODEL or "HTTP 404" not in str(error):
            raise
        log.warning("Modèle %s indisponible, repli sur %s", model, FALLBACK_MODEL)
        data = await _request(FALLBACK_MODEL, prompt, gemini_voice, api_key)

    try:
        part = next(p for p in data["candidates"][0]["content"]["parts"] if "inlineData" in p)["inlineData"]
    except (KeyError, IndexError, StopIteration) as error:
        raise GeminiError(f"Réponse Gemini sans audio : {str(data)[:300]}") from error

    audio = base64.b64decode(part["data"])
    mime = part.get("mimeType", "")
    raw = workdir / "gemini_raw.wav"

    if "wav" in mime:
        raw.write_bytes(audio)
    else:
        # PCM brut 16 bits (« audio/L16;codec=pcm;rate=24000 »)
        rate_match = re.search(r"rate=(\d+)", mime)
        pcm = workdir / "gemini.pcm"
        pcm.write_bytes(audio)
        await proc.run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "s16le",
                "-ar",
                rate_match.group(1) if rate_match else "24000",
                "-ac",
                "1",
                "-i",
                str(pcm),
                str(raw),
            ],
            timeout=60,
        )
        pcm.unlink(missing_ok=True)
    return raw, gemini_voice
