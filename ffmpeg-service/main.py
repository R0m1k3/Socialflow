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
    draw_text: bool = True


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
    """Generate TTS audio with subtitles, with retry and fallback voices."""
    import asyncio

    # List of fallback voices to try if the primary fails
    fallback_voices = [
        voice,  # Try requested voice first
        "fr-FR-DeniseNeural",  # Alternative female
        "fr-FR-HenriNeural",  # Alternative male
        "en-US-JennyNeural",  # English fallback
    ]

    last_error = None

    for attempt_voice in fallback_voices:
        try:
            print(f"🔊 TTS attempt with voice: {attempt_voice}")
            communicate = edge_tts.Communicate(text, attempt_voice)

            # Use the simple save() method which is more reliable
            await asyncio.wait_for(communicate.save(str(audio_path)), timeout=60.0)

            # Check if file was created and has content
            if audio_path.exists() and audio_path.stat().st_size > 0:
                print(f"✅ TTS audio saved: {audio_path.stat().st_size} bytes")

                # Generate a simple VTT file with the full text
                # (word-by-word sync would require working SubMaker)
                generate_simple_vtt(text, vtt_path)

                print(f"✅ TTS success with voice: {attempt_voice}")
                return  # Success!
            else:
                print(f"⚠️ Audio file empty or missing with voice: {attempt_voice}")

        except asyncio.TimeoutError:
            print(f"⚠️ TTS timeout with voice: {attempt_voice}")
            last_error = "Timeout"
        except Exception as e:
            print(f"⚠️ TTS failed with voice {attempt_voice}: {e}")
            last_error = e

    # If all voices failed, raise the last error
    raise Exception(f"All TTS voices failed. Last error: {last_error}")


def generate_simple_vtt(text: str, vtt_path: Path):
    """Generate a simple VTT subtitle file that displays the full text."""
    # Split text into chunks for better display
    words = text.split()
    chunks = []
    current_chunk = []

    for word in words:
        current_chunk.append(word)
        if len(current_chunk) >= 5 or word.endswith((".", "!", "?", ":")):
            chunks.append(" ".join(current_chunk))
            current_chunk = []

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    # Estimate timing (average speaking rate: ~150 words per minute = 0.4s per word)
    # Each chunk gets time proportional to its word count
    vtt_content = "WEBVTT\n\n"
    current_time = 0.0

    for i, chunk in enumerate(chunks):
        word_count = len(chunk.split())
        duration = word_count * 0.4  # 0.4 seconds per word

        start_time = format_vtt_time(current_time)
        end_time = format_vtt_time(current_time + duration)

        vtt_content += f"{i + 1}\n"
        vtt_content += f"{start_time} --> {end_time}\n"
        vtt_content += f"{chunk}\n\n"

        current_time += duration

    with open(vtt_path, "w", encoding="utf-8") as f:
        f.write(vtt_content)


def format_vtt_time(seconds: float) -> str:
    """Format seconds as VTT timestamp (HH:MM:SS.mmm)."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


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
                print(f"🔊 TTS enabled. Original: '{request.text}'")
                print(f"🔊 TTS cleaned: '{tts_clean_text}'")

                # Check for male/female voice map
                voice = request.tts_voice
                if voice == "male":
                    voice = "fr-FR-RemyNeural"
                elif voice == "female":
                    voice = "fr-FR-VivienneNeural"
                elif not voice or "Neural" not in voice:
                    # Default if invalid
                    voice = "fr-FR-VivienneNeural"

                print(f"🔊 Using voice: {voice}")

                if tts_clean_text:
                    print(f"🔊 Generating TTS audio to: {tts_audio_path}")
                    await generate_tts_with_subs(
                        tts_clean_text, voice, tts_audio_path, tts_vtt_path
                    )

                    # Verify files were created
                    if tts_audio_path.exists() and tts_audio_path.stat().st_size > 0:
                        print(
                            f"✅ TTS audio generated: {tts_audio_path.stat().st_size} bytes"
                        )
                        has_tts = True
                    else:
                        print(f"❌ TTS audio file missing or empty!")
                else:
                    print("⚠️ TTS text is empty after cleaning, skipping.")
            except Exception as e:
                import traceback

                print(f"❌ Failed to generate TTS: {e}")
                traceback.print_exc()

        # 4. Build FFmpeg Command
        cmd = ["ffmpeg", "-y", "-i", str(input_video_path)]

        video_filters = []
        audio_filters = []

        # Text Overlay
        # If TTS is enabled, we use the generated VTT subtitles for perfect sync
        # If not, we use the standard drawtext
        # Only apply if draw_text is True
        if request.text and request.draw_text:
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

        # Audio Mixing Strategy
        # We need to mix:
        # 1. Original Video Audio (0:a) - if exists
        # 2. Background Music (1:a) - if has_music
        # 3. TTS Voice (1:a or 2:a) - if has_tts

        # Detect if original video has audio
        has_original_audio = False
        try:
            probe_cmd = [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "csv=p=0",
                str(input_video_path),
            ]
            probe_out = subprocess.check_output(probe_cmd).decode().strip()
            if probe_out == "audio":
                has_original_audio = True
        except Exception:
            pass

        filter_complex_parts = []
        mix_inputs = 0

        if has_music:
            cmd.extend(["-i", str(input_audio_path)])

        if has_tts:
            cmd.extend(["-i", str(tts_audio_path)])

        # Prepare inputs for mixing
        # ALWAYS ignore original video audio - only use music and/or TTS
        # (Original audio is never used per user request)

        if has_music:
            # Music volume - ensure it's properly scaled (0.0 to 1.0)
            # Apply volume more aggressively for noticeable effect
            music_vol = request.music_volume
            if has_tts:
                # Reduce music even more when TTS is active so voice is clear
                music_vol = music_vol * 0.3
            print(
                f"🎵 Music volume applied: {music_vol:.2f} (requested: {request.music_volume})"
            )
            filter_complex_parts.append(f"[1:a]volume={music_vol}[a1]")
            mix_inputs += 1

        if has_tts:
            tts_idx = 2 if has_music else 1
            # Voice needs to be loud and clear
            filter_complex_parts.append(f"[{tts_idx}:a]volume=1.5[a2]")
            mix_inputs += 1

        # Build mix command
        if mix_inputs > 0:
            inputs_str = ""
            # Note: Original audio is never mixed in (always muted)
            if has_music:
                inputs_str += "[a1]"
            if has_tts:
                inputs_str += "[a2]"

            # IMPORTANT: normalize=0 prevents amix from auto-adjusting volumes
            # which was causing volume slider to have no effect
            filter_complex_parts.append(
                f"{inputs_str}amix=inputs={mix_inputs}:duration=first:dropout_transition=2:normalize=0[aout]"
            )

            cmd.extend(["-filter_complex", ";".join(filter_complex_parts)])

            # Map processed video and audio
            cmd.extend(["-map", "0:v", "-map", "[aout]"])
        else:
            # No audio at all, just video
            cmd.extend(["-map", "0:v"])

        # Apply Video Filters if any
        if video_filters:
            cmd.extend(["-vf", ",".join(video_filters)])

        # -shortest not needed with duration=first in amix, but good practice if logic changes
        # actually duration=first in amix takes the length of the first input (usually video audio or music if mapped first)
        # We want the video length to dictate.
        # Easier: just use -shortest to cut audio to video length
        cmd.extend(["-shortest"])

        # Quality settings
        cmd.extend(
            [
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "23",  # Good balance for quality/size
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-pix_fmt",
                "yuv420p",  # Ensure compatibility
                "-movflags",
                "+faststart",
            ]
        )

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
