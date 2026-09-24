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
    # Préparation Remotion : le logo est composé par Remotion, mais sa présence
    # allonge la vidéo pour laisser place à l'effet de fin.
    has_logo: bool = False
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
    """Rendu complet par FFmpeg ; le MP4 se récupère via GET /files/{job_id}/output.mp4."""
    return await _guarded(_process, request)


@app.post("/prepare-reel", dependencies=[Depends(require_key)])
async def prepare_reel(request: ReelRequest):
    """Prépare un rendu Remotion : image recadrée à la durée finale, piste son
    finale et minutage des mots. Rien n'est incrusté dans l'image."""
    return await _guarded(_prepare, request)


async def _guarded(handler, request: ReelRequest) -> dict:
    job_id, workdir = jobs.new_job()
    started = time.monotonic()
    try:
        async with render_slot:
            return await handler(request, job_id, workdir, started)
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
    media_type = {"mp4": "video/mp4", "wav": "audio/wav"}.get(name.rsplit(".", 1)[-1])
    return FileResponse(path, media_type=media_type)


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


class Stopwatch:
    def __init__(self, started: float):
        self.started = started
        self.last = time.monotonic()
        self.stats: dict[str, float] = {}

    def lap(self, name: str) -> None:
        now = time.monotonic()
        self.stats[name] = round(now - self.last, 2)
        self.last = now

    def summary(self) -> dict[str, float]:
        return {**self.stats, "total": round(time.monotonic() - self.started, 2)}


async def _gather(request: ReelRequest, workdir: Path, clock: Stopwatch, *, fetch_logo: bool):
    """Téléchargements, analyse, voix et stabilisation : communs aux deux modes."""
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
    has_watermark = (
        fetch_logo
        and bool(request.watermark_url)
        and await _download(request.watermark_url, watermark, "le logo", required=False)
    )
    info = await proc.probe(video)
    if info.duration <= 0:
        raise HTTPException(status_code=400, detail="Vidéo illisible (durée nulle)")
    clock.lap("download")

    track = None
    spoken_text = clean_text(request.text)
    if request.tts_enabled and spoken_text:
        track = await _synthesize(spoken_text, request.text, request, workdir)
    clock.lap("tts")

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
        outro_expected=not fetch_logo and request.has_logo,
        ending_effect=request.enable_ending_effect,
        keep_original_audio=info.has_audio,
    )

    if request.stabilize:
        transforms = workdir / "transforms.trf"
        try:
            await proc.run(render.stabilize_detect_command(video, transforms), timeout=600)
            plan.stabilize_transforms = transforms
        except proc.CommandError as error:
            log.warning("Stabilisation ignorée : %s", error)
    clock.lap("stabilize")
    return plan, track, info


async def _caption_words(request: ReelRequest, plan: render.RenderPlan, track, info) -> list[align.Word]:
    """Mots à afficher, en secondes depuis le début de la vidéo."""
    display = clean_text(request.text)
    if not request.draw_text or not display:
        return []
    if track:
        return [align.Word(w.text, w.start + plan.voice_delay, w.end + plan.voice_delay) for w in track.words]
    return await _caption_words_without_voice(display, plan.video, info, plan)


def _keep_only(workdir: Path, keep: set[Path]) -> None:
    """Seuls les fichiers à télécharger restent jusqu'à la récupération."""
    for entry in workdir.iterdir():
        if entry not in keep:
            entry.unlink(missing_ok=True)


def _voice_info(track) -> dict:
    return {
        "tts_engine": track.engine if track else None,
        "tts_voice": track.voice if track else None,
        "warnings": track.warnings if track else [],
    }


async def _process(request: ReelRequest, job_id: str, workdir: Path, started: float) -> dict:
    clock = Stopwatch(started)
    plan, track, info = await _gather(request, workdir, clock, fetch_logo=True)

    words = await _caption_words(request, plan, track, info)
    if words:
        captions = workdir / "captions.ass"
        font_size = max(48, round(request.font_size * 1.4))
        subtitles.write_captions(words, captions, offset=0.0, font_size=font_size)
        plan.captions = captions
    if request.store_name and plan.has_outro and plan.watermark:
        outro = workdir / "outro.ass"
        subtitles.write_outro(request.store_name, outro, plan.logo_start, plan.total_duration)
        plan.outro = outro
    clock.lap("subtitles")

    await proc.run(render.build_command(plan), timeout=1200)
    clock.lap("encode")
    duration = (await proc.probe(plan.output)).duration
    log.info("Rendu %s terminé : %.1f s de vidéo, étapes %s", job_id, duration, clock.summary())

    _keep_only(workdir, {plan.output})
    return {
        "success": True,
        "job_id": job_id,
        "output_path": f"/files/{job_id}/output.mp4",
        "duration": duration,
        **_voice_info(track),
        "processing_stats": clock.summary(),
    }


async def _prepare(request: ReelRequest, job_id: str, workdir: Path, started: float) -> dict:
    clock = Stopwatch(started)
    plan, track, info = await _gather(request, workdir, clock, fetch_logo=False)
    words = await _caption_words(request, plan, track, info)
    clock.lap("subtitles")

    video_out = workdir / "video.mp4"
    audio_out = workdir / "audio.wav"
    await proc.run(render.build_prepared_video_command(plan, video_out), timeout=1200)
    clock.lap("video")
    mix = render.build_audio_mix_command(plan, audio_out)
    if mix:
        await proc.run(mix, timeout=600)
    clock.lap("audio")
    log.info("Préparation %s terminée : %.1f s, étapes %s", job_id, plan.total_duration, clock.summary())

    _keep_only(workdir, {video_out, audio_out})
    return {
        "success": True,
        "job_id": job_id,
        "video_path": f"/files/{job_id}/video.mp4",
        "audio_path": f"/files/{job_id}/audio.wav" if mix else None,
        "total_duration": plan.total_duration,
        "video_duration": info.duration,
        "logo_start": plan.logo_start if plan.has_outro else None,
        "words": [w.to_dict() for w in words],
        **_voice_info(track),
        "processing_stats": clock.summary(),
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
    end = plan.logo_start if plan.has_outro else plan.total_duration
    return align.align_words(display, [], max(1.0, end - 0.5))
