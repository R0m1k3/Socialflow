"""Synthèse vocale Qwen3-TTS, appelée par le service ffmpeg-api.

Tourne sur carte graphique NVIDIA si elle est disponible (bien plus rapide,
gros modèle 1.7B), sinon sur CPU. Peut être installé sur un autre serveur
(ex. Unraid avec GPU) : l'adresse se règle dans les paramètres de SocialFlow.

- Voix prédéfinies (modèle CustomVoice) : le ton est donné par une consigne.
- Voix clonées : un extrait de référence dans voices/ (modèle Base, chargé
  seulement si au moins une voix y est déposée).

Une seule génération à la fois : chacune occupe tous les cœurs (ou le GPU).
"""

import asyncio
import contextlib
import io
import json
import logging
import os
import time
from pathlib import Path

import soundfile as sf
import torch
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("qwen-tts")

MODEL = os.environ.get("QWEN_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice")
CLONE_MODEL = os.environ.get("QWEN_TTS_CLONE_MODEL", "Qwen/Qwen3-TTS-12Hz-0.6B-Base")
VOICES_DIR = Path(os.environ.get("QWEN_TTS_VOICES_DIR", Path(__file__).parent / "voices"))
# « auto » : premier GPU NVIDIA s'il y en a un, sinon CPU (ou « cuda:1 », « cpu »…)
_DEVICE_SETTING = os.environ.get("QWEN_TTS_DEVICE", "auto")
DEVICE = ("cuda:0" if torch.cuda.is_available() else "cpu") if _DEVICE_SETTING == "auto" else _DEVICE_SETTING
# bfloat16 sur GPU (moitié moins de mémoire, plus rapide) ; float32 sur CPU
DTYPE = getattr(torch, os.environ.get("QWEN_TTS_DTYPE") or ("bfloat16" if DEVICE.startswith("cuda") else "float32"))
THREADS = int(os.environ.get("QWEN_TTS_THREADS", "0")) or os.cpu_count() or 1
API_KEY = os.environ.get("API_KEY", "")

# Voix prédéfinies du modèle CustomVoice (toutes parlent français)
PRESETS: dict[str, tuple[str, str]] = {
    "serena": ("Serena — douce et chaleureuse", "female"),
    "vivian": ("Vivian — vive et lumineuse", "female"),
    "sohee": ("Sohee — expressive", "female"),
    "ono_anna": ("Anna — espiègle", "female"),
    "aiden": ("Aiden — solaire", "male"),
    "ryan": ("Ryan — dynamique", "male"),
    "uncle_fu": ("Fu — grave et posée", "male"),
    "dylan": ("Dylan — jeune et naturelle", "male"),
    "eric": ("Eric — légèrement voilée", "male"),
}
DEFAULT_PRESET = "serena"

torch.set_num_threads(THREADS)
_lock = asyncio.Lock()
_models: dict[str, object] = {}
_clone_prompts: dict[str, object] = {}


def _load(name: str):
    if name not in _models:
        from qwen_tts import Qwen3TTSModel

        started = time.monotonic()
        _models[name] = Qwen3TTSModel.from_pretrained(_local_path(name), device_map=DEVICE, dtype=DTYPE)
        log.info("Modèle %s chargé sur %s en %.1f s", name, _device_label(), time.monotonic() - started)
    return _models[name]


def _local_path(name: str) -> str:
    """Dossier du modèle téléchargé au build. Avec un nom de dépôt, transformers
    interroge l'API Hugging Face au chargement (détection des tokenizers Mistral),
    ce qui échoue en mode hors ligne ; avec un chemin local, non."""
    from huggingface_hub import snapshot_download

    try:
        return snapshot_download(name, local_files_only=True)
    except Exception:  # noqa: BLE001 — absent du cache : téléchargement normal
        return name


def _device_label() -> str:
    if DEVICE.startswith("cuda"):
        return f"{torch.cuda.get_device_name(torch.device(DEVICE))} ({DEVICE}, {DTYPE})"
    return f"CPU ({THREADS} threads, {DTYPE})"


def clones() -> dict[str, dict]:
    """Voix de référence déposées dans voices/ : nom.wav + nom.txt (+ nom.json)."""
    found = {}
    for wav in sorted(VOICES_DIR.glob("*.wav")):
        transcript = wav.with_suffix(".txt")
        if not transcript.exists():
            log.warning("Voix %s ignorée : transcription %s absente", wav.name, transcript.name)
            continue
        meta_file = wav.with_suffix(".json")
        meta = json.loads(meta_file.read_text()) if meta_file.exists() else {}
        found[wav.stem] = {
            "id": f"clone:{wav.stem}",
            "label": meta.get("label", wav.stem.replace("_", " ").title()),
            "gender": meta.get("gender", "female"),
            "wav": wav,
            "text": transcript.read_text().strip(),
        }
    return found


def _generate(text: str, voice: str, instruct: str, language: str) -> tuple[bytes, str]:
    if voice.startswith("clone:") and CLONE_MODEL:
        name = voice.removeprefix("clone:")
        clone = clones().get(name)
        if clone is None:
            raise HTTPException(status_code=404, detail=f"Voix clonée inconnue : {name}")
        model = _load(CLONE_MODEL)
        if name not in _clone_prompts:
            _clone_prompts[name] = model.create_voice_clone_prompt(
                ref_audio=str(clone["wav"]), ref_text=clone["text"], x_vector_only_mode=False
            )
        wavs, rate = model.generate_voice_clone(
            text=text, language=language, voice_clone_prompt=_clone_prompts[name]
        )
        used = clone["id"]
    else:
        speaker = voice.lower() if voice.lower() in PRESETS else DEFAULT_PRESET
        kwargs = {"text": text, "language": language, "speaker": speaker}
        if instruct:
            kwargs["instruct"] = instruct
        wavs, rate = _load(MODEL).generate_custom_voice(**kwargs)
        used = speaker

    buffer = io.BytesIO()
    sf.write(buffer, wavs[0], rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue(), used


@contextlib.asynccontextmanager
async def lifespan(_app: FastAPI):
    # Chargé au démarrage : la première voix n'attend pas le chargement
    await asyncio.to_thread(_load, MODEL)
    log.info("Service prêt, %d voix clonée(s)", len(clones()))
    yield


app = FastAPI(title="SocialFlow Qwen TTS", lifespan=lifespan)


def require_key(x_api_key: str | None = Header(None)) -> None:
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API Key")


class SynthesisRequest(BaseModel):
    text: str
    voice: str | None = None
    instruct: str | None = None
    language: str = "French"


@app.get("/health", dependencies=[Depends(require_key)])
async def health():
    return {"status": "ok", "model": MODEL, "device": _device_label(), "busy": _lock.locked()}


@app.get("/voices", dependencies=[Depends(require_key)])
async def voices():
    presets = [{"id": k, "label": v[0], "gender": v[1]} for k, v in PRESETS.items()]
    cloned = [{k: c[k] for k in ("id", "label", "gender")} for c in clones().values()] if CLONE_MODEL else []
    return {"voices": [*cloned, *presets]}


@app.post("/synthesize", dependencies=[Depends(require_key)])
async def synthesize(request: SynthesisRequest):
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Texte vide")
    async with _lock:
        started = time.monotonic()
        audio, used = await asyncio.to_thread(
            _generate, text, request.voice or DEFAULT_PRESET, (request.instruct or "").strip(), request.language
        )
    log.info("Voix %s : %d car. en %.1f s", used, len(text), time.monotonic() - started)
    return Response(audio, media_type="audio/wav", headers={"X-Voice": used})
