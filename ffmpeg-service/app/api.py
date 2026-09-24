"""API HTTP du service : voix, rendu des Reels et récupération des fichiers."""

import asyncio
import base64
import contextlib
import logging
import time
from pathlib import Path

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import align, config, jobs, proc, render, subtitles, tts, voices
from .audio import encode_preview
from .text import clean_text

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("reels")

if not config.API_KEY:
    raise RuntimeError("API_KEY doit être défini : le service refuse de démarrer sans clé.")

# Un seul encodage à la fois : ils saturent le CPU, les suivants attendent
render_slot = asyncio.Semaphore(1)


@contextlib.asynccontextmanager
async def lifespan(_app: FastAPI):
    removed = jobs.purge_expired()
    log.info("Service prêt (%d dossier(s) expiré(s) purgé(s))", removed)

    async def purge_loop():
        while True:
            await asyncio.sleep(600)
            jobs.purge_expired()

    task = asyncio.create_task(purge_loop())
    yield
    task.cancel()


app = FastAPI(title="SocialFlow Reels", lifespan=lifespan)


def require_key(x_api_key: str | None = Header(None)) -> None:
    if x_api_key != config.API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API Key")


class TtsRequest(BaseModel):
    text: str
    tts_voice: str | None = None
    tts_engine: str | None = "gemini"
    tts_style: str | None = None
    gemini_api_key: str | None = None


class ReelRequest(BaseModel):
    video_base64: str | None = None
    video_url: str | None = None
    text: str | None = None
    music_url: str | None = None
    watermark_url: str | None = None
    store_name: str | None = None
    font_size: int = 64
    music_volume: float = 0.25
    tts_enabled: bool = False
    tts_voice: str | None = None
    tts_engine: str | None = "gemini"
    tts_style: str | None = None
    gemini_api_key: str | None = None
    draw_text: bool = True
    stabilize: bool = False
    enable_ending_effect: bool = True
    # Champs d'anciennes versions, acceptés et ignorés
    music_id: str | None = None
    word_duration: float | None = None


@app.get("/health", dependencies=[Depends(require_key)])
async def health():
    return {"status": "ok", "version": 2}


@app.get("/voices", dependencies=[Depends(require_key)])
async def list_voices():
    return voices.catalog()


@app.post("/preview-tts", dependencies=[Depends(require_key)])
async def preview_tts(request: TtsRequest):
    text = clean_text(request.text)
    if not text:
        raise HTTPException(status_code=400, detail="Texte vide après nettoyage (emojis et hashtags retirés)")

    job_id, workdir = jobs.new_job()
    try:
        track = await _synthesize(text, request.text, request, workdir)
        preview = workdir / "preview.mp3"
        await encode_preview(track.path, preview)
        return {
            "success": True,
            "audio_base64": base64.b64encode(preview.read_bytes()).decode(),
            "duration": track.duration,
            "words": [w.to_dict() for w in track.words],
            "engine": track.engine,
            "voice": track.voice,
            "warnings": track.warnings,
        }
    finally:
        jobs.remove_job(job_id)


@app.post("/process-reel", dependencies=[Depends(require_key)])
async def process_reel(request: ReelRequest):
    """Produit le Reel ; le MP4 se récupère ensuite via GET /files/{job_id}/output.mp4."""
    job_id, workdir = jobs.new_job()
    stats: dict[str, float] = {}
    started = time.monotonic()
    try:
        async with render_slot:
            return await _process(request, job_id, workdir, stats, started)
    except HTTPException:
        jobs.remove_job(job_id)
        raise
    except proc.CommandError as error:
        jobs.remove_job(job_id)
        log.error("Rendu %s en échec : %s", job_id, error)
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        jobs.remove_job(job_id)
        log.exception("Rendu %s en échec", job_id)
        raise HTTPException(status_code=500, detail=f"Erreur de rendu : {error}") from error


@app.get("/files/{job_id}/{name}", dependencies=[Depends(require_key)])
async def get_file(job_id: str, name: str):
    path = jobs.job_file(job_id, name)
    if not path:
        raise HTTPException(status_code=404, detail="Fichier introuvable ou expiré")
    return FileResponse(path, media_type="video/mp4" if name.endswith(".mp4") else None)


@app.delete("/jobs/{job_id}", dependencies=[Depends(require_key)])
async def delete_job(job_id: str):
    jobs.remove_job(job_id)
    return {"success": True}


# --- Orchestration --------------------------------------------------------


async def _synthesize(text: str, display_source: str | None, request, workdir: Path) -> tts.VoiceTrack:
    try:
        return await tts.synthesize(
            text=text,
            display_text=clean_text(display_source) or text,
            engine=request.tts_engine,
            voice=request.tts_voice,
            style=request.tts_style,
            gemini_api_key=request.gemini_api_key,
            workdir=workdir,
        )
    except Exception as error:
        log.exception("Voix impossible à générer")
        raise HTTPException(status_code=502, detail=f"La voix n'a pas pu être générée : {error}") from error


async def _download(url: str, target: Path, what: str, required: bool) -> bool:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=15), follow_redirects=True) as client:
            async with client.stream("GET", url, headers={"User-Agent": "Mozilla/5.0"}) as response:
                response.raise_for_status()
                with target.open("wb") as out:
                    async for chunk in response.aiter_bytes(1 << 20):
                        out.write(chunk)
        return True
    except Exception as error:
        if required:
            detail = f"Téléchargement de {what} impossible : {error}"
            raise HTTPException(status_code=400, detail=detail) from error
        log.warning("Téléchargement de %s impossible, on continue sans : %s", what, error)
        return False


async def _process(request: ReelRequest, job_id: str, workdir: Path, stats: dict, started: float) -> dict:
    step = time.monotonic()
    video = workdir / "input.mp4"
    if request.video_base64:
        video.write_bytes(base64.b64decode(request.video_base64))
    elif request.video_url:
        await _download(request.video_url, video, "la vidéo", required=True)
    else:
        raise HTTPException(status_code=400, detail="Aucune vidéo fournie")

    music = workdir / "music.audio"
    has_music = bool(request.music_url) and await _download(
        request.music_url, music, "la musique", required=False
    )
    watermark = workdir / "watermark.png"
    has_watermark = bool(request.watermark_url) and await _download(
        request.watermark_url, watermark, "le logo", required=False
    )
    info = await proc.probe(video)
    if info.duration <= 0:
        raise HTTPException(status_code=400, detail="Vidéo illisible (durée nulle)")
    stats["download"] = time.monotonic() - step

    # --- Voix ---
    step = time.monotonic()
    track = None
    spoken_text = clean_text(request.text)
    if request.tts_enabled and spoken_text:
        track = await _synthesize(spoken_text, request.text, request, workdir)
    stats["tts"] = time.monotonic() - step

    plan = render.RenderPlan(
        video=video,
        video_duration=info.duration,
        output=workdir / "output.mp4",
        is_hdr=info.is_hdr,
        music=music if has_music else None,
        music_volume=request.music_volume,
        voice=track.path if track else None,
        voice_duration=track.duration if track else 0.0,
        watermark=watermark if has_watermark else None,
        ending_effect=request.enable_ending_effect,
        keep_original_audio=info.has_audio,
    )

    # --- Sous-titres ---
    step = time.monotonic()
    font_size = max(48, round(request.font_size * 1.4))
    display = clean_text(request.text)
    if request.draw_text and display:
        captions = workdir / "captions.ass"
        if track:
            subtitles.write_captions(track.words, captions, offset=plan.voice_delay, font_size=font_size)
        else:
            words = await _caption_words_without_voice(display, video, info, plan)
            subtitles.write_captions(words, captions, offset=0.0, font_size=font_size)
        plan.captions = captions
    if request.store_name and request.enable_ending_effect and has_watermark:
        outro = workdir / "outro.ass"
        subtitles.write_outro(request.store_name, outro, plan.logo_start, plan.total_duration)
        plan.outro = outro
    stats["subtitles"] = time.monotonic() - step

    # --- Stabilisation (1re passe) ---
    step = time.monotonic()
    if request.stabilize:
        transforms = workdir / "transforms.trf"
        try:
            await proc.run(render.stabilize_detect_command(video, transforms), timeout=600)
            plan.stabilize_transforms = transforms
        except proc.CommandError as error:
            log.warning("Stabilisation ignorée : %s", error)
    stats["stabilize"] = time.monotonic() - step

    # --- Encodage ---
    step = time.monotonic()
    await proc.run(render.build_command(plan), timeout=1200)
    stats["encode"] = time.monotonic() - step
    stats["total"] = time.monotonic() - started

    duration = (await proc.probe(plan.output)).duration
    log.info(
        "Rendu %s terminé : %.1f s de vidéo, étapes %s",
        job_id,
        duration,
        {k: round(v, 1) for k, v in stats.items()},
    )

    # Seul le résultat est conservé jusqu'au téléchargement
    for entry in workdir.iterdir():
        if entry != plan.output:
            entry.unlink(missing_ok=True)

    return {
        "success": True,
        "job_id": job_id,
        "output_path": f"/files/{job_id}/output.mp4",
        "duration": duration,
        "tts_engine": track.engine if track else None,
        "tts_voice": track.voice if track else None,
        "warnings": track.warnings if track else [],
        "processing_stats": stats,
    }


async def _caption_words_without_voice(display: str, video: Path, info, plan: render.RenderPlan):
    """Sans voix de synthèse : calage sur la parole de la vidéo si elle en contient,
    sinon texte réparti sur la durée (hors effet de fin)."""
    if info.has_audio:
        try:
            spoken = await align.transcribe(video, hint=display)
            if len(spoken) >= max(2, len(display.split()) // 3):
                return align.align_words(display, spoken, info.duration)
        except Exception as error:  # noqa: BLE001 — on retombe sur la répartition
            log.warning("Transcription de la vidéo impossible : %s", error)
    end = plan.logo_start if plan.ending_effect and plan.watermark else plan.total_duration
    return align.align_words(display, [], max(1.0, end - 0.5))
