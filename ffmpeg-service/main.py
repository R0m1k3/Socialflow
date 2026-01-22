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
import edge_tts
import re
import emoji

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
    tts_enabled: bool = False
    tts_voice: str = "fr-FR-VivienneNeural"


def clean_text_for_tts(text: str) -> str:
    # 1. Remove emojis
    text = emoji.replace_emoji(text, replace="")
    # 2. Remove hashtags (e.g. #viral #reels)
    text = re.sub(r"#\w+", "", text)
    # 3. Cleanup whitespace
    return " ".join(text.split())


async def generate_tts_with_subs(
    text: str, voice: str, audio_path: Path, vtt_path: Path
):
    communicate = edge_tts.Communicate(text, voice)
    submaker = edge_tts.SubMaker()

    with open(audio_path, "wb") as file:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                file.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                submaker.feed(chunk)

    with open(vtt_path, "w", encoding="utf-8") as file:
        file.write(submaker.generate_subs())


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
        tts_audio_path = job_dir / "tts.mp3"
        tts_vtt_path = job_dir / "tts.vtt"
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

        # 3. Generate TTS (if enabled)
        has_tts = False
        tts_clean_text = ""

        if request.tts_enabled and request.text:
            try:
                # Clean text for TTS (remove hashtags/emojis)
                tts_clean_text = clean_text_for_tts(request.text)

                # Check for male/female voice map
                voice = request.tts_voice
                if voice == "male":
                    voice = "fr-FR-RemyNeural"
                elif voice == "female":
                    voice = "fr-FR-VivienneNeural"
                elif not voice or "Neural" not in voice:
                    # Default if invalid
                    voice = "fr-FR-VivienneNeural"

                if tts_clean_text:
                    await generate_tts_with_subs(
                        tts_clean_text, voice, tts_audio_path, tts_vtt_path
                    )
                    has_tts = True
            except Exception as e:
                print(f"Failed to generate TTS: {e}")

        # 4. Build FFmpeg Command
        cmd = ["ffmpeg", "-y", "-i", str(input_video_path)]

        video_filters = []
        audio_filters = []

        # Text Overlay
        # If TTS is enabled, we use the generated VTT subtitles for perfect sync
        # If not, we use the standard drawtext
        if request.text:
            if has_tts:
                # Use subtitles filter
                # Force style to look like TikTok/Reels text (Bottom center, white, black box)
                style = f"FontName=Arial,FontSize={request.font_size},PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,BackColour=&H80000000,Bold=1,Alignment=2,MarginV=150"
                # Escape path for FFmpeg filter
                vtt_path_str = str(tts_vtt_path).replace("\\", "/").replace(":", "\\:")
                video_filters.append(
                    f"subtitles='{vtt_path_str}':force_style='{style}'"
                )
            else:
                # Standard Drawtext logic
                sanitized_text = request.text.replace("'", "").replace(":", "\\:")
                drawtext = f"drawtext=fontfile={FONT_PATH}:text='{sanitized_text}':fontcolor=white:fontsize={request.font_size}:box=1:boxcolor=black@0.5:boxborderw=5:x=(w-text_w)/2:y=h-text_h-150"
                video_filters.append(drawtext)

        # Audio Mixing/Volume (Audio Filter)
        if has_music:
            cmd.extend(["-i", str(input_audio_path)])
            # Apply volume adjustment to the music
            # If TTS is present, reduce music volume further to prioritize voice
            music_vol = request.music_volume * 0.5 if has_tts else request.music_volume
            audio_filters.append(f"[1:a]volume={music_vol}[music]")

        if has_tts:
            cmd.extend(["-i", str(tts_audio_path)])
            # TTS is typically input 2 if music exists, or input 1 if no music
            tts_input_idx = 2 if has_music else 1
            audio_filters.append(f"[{tts_input_idx}:a]volume=1.5[voice]")

        # Apply Video Filters if any
        if video_filters:
            cmd.extend(["-vf", ",".join(video_filters)])

        # Apply Audio Filters if any
        # Note: -af applies to the output audio stream.
        # Apply Audio Filters if any
        if audio_filters:
            # If we have multiple audio sources, we need to mix them
            if has_music and has_tts:
                # Mix music and voice
                filter_complex = (
                    ";".join(audio_filters)
                    + ";[music][voice]amix=inputs=2:duration=longest[aout]"
                )
                cmd.extend(["-filter_complex", filter_complex])
                # We need complex filter for mixing, so we don't use -vf/-af separately for audio
                # But we still need video filters
                if video_filters:
                    # Remove the previously added -vf and use filter_complex for everything ideally,
                    # or just keep -vf for video simple chain if separate.
                    # FFmpeg allows -vf and -filter_complex together if they touch different streams.
                    pass
            elif has_music:
                # Valid because we modified the filter previously to verify [1:a]... which requires filter_complex or mapping
                # Let's simplify: if simple volume filter, use -af. If named pads ([music]), use complex.
                # To keep it robust, let's use filter_complex for audio always if we started naming pads.
                cmd.extend(
                    ["-filter_complex", f"[1:a]volume={request.music_volume}[aout]"]
                )
            elif has_tts:
                cmd.extend(["-filter_complex", f"[1:a]volume=1.5[aout]"])

            # Note: The above logic replaces the simple -af append. We need to be careful not to double add.
            # Let's Refactor slightly to ensure clean command construction.

        if has_music or has_tts:
            # Map processed video
            cmd.extend(["-map", "0:v"])

            # Map processed audio [aout]
            cmd.extend(["-map", "[aout]"])

            # -shortest: finish when the shortest input ends
            cmd.extend(["-shortest"])
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
