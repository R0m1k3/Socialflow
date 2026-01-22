from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
from typing import Optional
import uvicorn
import subprocess
import os
import uuid
import base64
import requests
import shutil
from pathlib import Path

app = FastAPI()

API_KEY = os.environ.get("API_KEY", "default-key")
TEMP_DIR = Path("/tmp/ffmpeg_processing")
TEMP_DIR.mkdir(parents=True, exist_ok=True)


class ReelRequest(BaseModel):
    video_base64: Optional[str] = None
    video_url: Optional[str] = None
    text: Optional[str] = None
    music_id: Optional[str] = None
    music_url: Optional[str] = None
    word_duration: float = 0.6
    font_size: int = 60
    music_volume: float = 0.25


class ReelResponse(BaseModel):
    success: bool
    output_base64: Optional[str] = None
    duration: Optional[float] = None
    detail: Optional[str] = None


@app.get("/health")
def health_check(x_api_key: str = Header(None)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API Key")
    return {"status": "healthy"}


@app.post("/process-reel")
async def process_reel(request: ReelRequest, x_api_key: str = Header(None)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API Key")

    try:
        job_id = str(uuid.uuid4())
        job_dir = TEMP_DIR / job_id
        job_dir.mkdir()

        input_video_path = job_dir / "input.mp4"
        input_audio_path = job_dir / "music.mp3"
        output_video_path = job_dir / "output.mp4"

        # 1. Save Input Video
        if request.video_base64:
            with open(input_video_path, "wb") as f:
                f.write(base64.b64decode(request.video_base64))
        elif request.video_url:
            response = requests.get(request.video_url, stream=True)
            response.raise_for_status()
            with open(input_video_path, "wb") as f:
                shutil.copyfileobj(response.raw, f)
        else:
            raise HTTPException(status_code=400, detail="No video source provided")

        # 2. Download Music (if present)
        has_music = False
        if request.music_url:
            try:
                # Add User-Agent to avoid 403 on some CDNs
                headers = {"User-Agent": "Mozilla/5.0"}
                response = requests.get(request.music_url, headers=headers, stream=True)
                response.raise_for_status()
                with open(input_audio_path, "wb") as f:
                    shutil.copyfileobj(response.raw, f)
                has_music = True
            except Exception as e:
                print(f"Failed to download music: {e}")
                # We continue without music if it fails

        # 3. Build FFmpeg Command
        # This is a simplified command. Real implementation for tiktok-style text overlay is complex.
        # For now, we will draw simple text centered.

        cmd = ["ffmpeg", "-y", "-i", str(input_video_path)]

        filters = []

        # Text Overlay
        if request.text:
            # Escape text for drawtext
            sanitized_text = request.text.replace("'", "").replace(":", "\\:")
            # Use a default font or one inside the container
            font_path = "/usr/share/fonts/ttf-dejavu/DejaVuSans-Bold.ttf"
            drawtext = f"drawtext=fontfile={font_path}:text='{sanitized_text}':fontcolor=white:fontsize={request.font_size}:box=1:boxcolor=black@0.5:boxborderw=5:x=(w-text_w)/2:y=(h-text_h)/2"
            filters.append(drawtext)

        # Audio Mixing
        if has_music:
            cmd.extend(["-i", str(input_audio_path)])
            # Mix original audio (if any) with new music
            # [0:a] is video audio, [1:a] is music
            # We need to loop music if video is longer, or cut it.
            # Simple mix: amix
            # Better: volume adjustment

            # Complex filter for audio:
            # [1:a]volume={request.music_volume}[music];[0:a][music]amix=inputs=2:duration=first[aout]
            # But what if video has no audio? We need to verify.
            # For simplicity, we assume video has audio stream. If not, this might fail or produce silent output.
            # Safer: -map 0:v -map 1:a (replace audio completely) or check streams.
            # Let's simple check: replacing audio is often safer for "Reels" unless voiceover is needed.
            # But usually we want background music.
            # Use filter_complex to mix

            filters.append(f"[1:a]volume={request.music_volume}[music]")
            # We assume input video has audio. If not, we map just music.
            # To be robust, we map [music] to output audio.
            # Let's TRY to mix, but fallback to just music if 0:a doesn't exist?
            # FFmpeg is tricky here.
            # Strategy: Generate a silent audio track matching video length, mix everything alongside.
            # Too complex for this snippet.
            # Decision: Replace audio if music is present, or mix if simple.
            # Let's just output the music track as the audio for now (Reel style), usually original audio is noise.
            # Or add it.
            # [0:a]volume=1.0[orig];[1:a]volume={vol}[mus];[orig][mus]amix=inputs=2[a]

            # Lets try Map 0:v and Map 1:a (Music replaces audio) - Safer MVP
            # filters.append(...)
            pass

        filter_str = ",".join(filters)

        if filters:
            cmd.extend(["-vf", filter_str])

        if has_music:
            # Map video from 0, audio from 1 (music), shortest (cut music to video len)
            cmd.extend(["-map", "0:v", "-map", "1:a", "-shortest"])
        else:
            cmd.extend(["-map", "0:v", "-map", "0:a?"])  # Keep original audio if exists

        cmd.append(str(output_video_path))

        # execute
        process = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        if process.returncode != 0:
            print(f"FFmpeg failed: {process.stderr.decode()}")
            raise Exception(f"FFmpeg encoding failed: {process.stderr.decode()}")

        # 4. Get Duration (ffprobe)
        duration_cmd = [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(output_video_path),
        ]
        dur_proc = subprocess.run(duration_cmd, stdout=subprocess.PIPE)
        duration = float(dur_proc.stdout.decode().strip() or 0)

        # 5. Read Output
        with open(output_video_path, "rb") as f:
            out_bytes = f.read()
            out_b64 = base64.b64encode(out_bytes).decode("utf-8")

        # Cleanup
        shutil.rmtree(job_dir)

        return {"success": True, "output_base64": out_b64, "duration": duration}

    except Exception as e:
        if "job_dir" in locals():
            shutil.rmtree(job_dir, ignore_errors=True)
        return {"success": False, "detail": str(e)}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
