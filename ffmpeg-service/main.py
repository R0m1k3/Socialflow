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

# Font path for text overlay (installed via fonts-dejavu in Dockerfile)
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


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
        cmd = ["ffmpeg", "-y", "-i", str(input_video_path)]

        video_filters = []
        audio_filters = []

        # Text Overlay (Video Filter)
        if request.text:
            # Escape text for drawtext
            sanitized_text = request.text.replace("'", "").replace(":", "\\:")
            # Move text to bottom (with 150px padding to avoid UI elements)
            drawtext = f"drawtext=fontfile={FONT_PATH}:text='{sanitized_text}':fontcolor=white:fontsize={request.font_size}:box=1:boxcolor=black@0.5:boxborderw=5:x=(w-text_w)/2:y=h-text_h-150"
            video_filters.append(drawtext)

        # Audio Mixing/Volume (Audio Filter)
        if has_music:
            cmd.extend(["-i", str(input_audio_path)])
            # Apply volume adjustment to the music
            audio_filters.append(f"volume={request.music_volume}")

        # Apply Video Filters if any
        if video_filters:
            cmd.extend(["-vf", ",".join(video_filters)])

        # Apply Audio Filters if any
        # Note: -af applies to the output audio stream.
        if audio_filters:
            cmd.extend(["-af", ",".join(audio_filters)])

        if has_music:
            # Map video from input 0
            # Map audio from input 1 (music)
            # -shortest: finish when the shortest input (usually video or music) ends
            cmd.extend(["-map", "0:v", "-map", "1:a", "-shortest"])
        else:
            # Keep original video and audio (if exists)
            cmd.extend(["-map", "0:v", "-map", "0:a?"])

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
