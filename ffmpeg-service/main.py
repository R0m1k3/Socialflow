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
import time

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
    font_size: int = 64
    music_volume: float = 0.25
    tts_enabled: bool = False
    tts_voice: str = "fr-FR-VivienneMultilingualNeural"
    draw_text: bool = True
    stabilize: bool = False  # Stabilisation vidéo via vidstab


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

    # Determine gender of requested voice to choose appropriate fallbacks
    is_male = any(name in voice for name in ["Remy", "Henri", "Paul"])

    if is_male:
        fallback_voices = [
            voice,  # Try requested voice first
            "fr-FR-HenriNeural",  # Primary Male fallback
            "fr-FR-PaulNeural",  # Secondary Male fallback
        ]
    else:
        fallback_voices = [
            voice,  # Try requested voice first
            "fr-FR-VivienneNeural",  # Primary Female fallback
            "fr-FR-DeniseNeural",  # Secondary Female fallback
        ]

    # Always add English fallback as last resort
    fallback_voices.append("en-US-JennyNeural")

    # Remove duplicates while preserving order
    fallback_voices = list(dict.fromkeys(fallback_voices))

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
        if len(current_chunk) >= 3 or word.endswith((".", "!", "?", ":")):
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
        duration = word_count * 0.3  # 0.3 seconds per word (faster sync)

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
    processing_stats: Optional[dict] = None


@app.get("/health")
def health_check(x_api_key: str = Header(None)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API Key")
    return {"status": "healthy"}


@app.post("/process-reel")
async def process_reel(request: ReelRequest, x_api_key: str = Header(None)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API Key")

    start_total = time.time()
    stats = {
        "download_duration": 0,
        "tts_duration": 0,
        "stabilize_duration": 0,
        "encoding_duration": 0,
        "total_duration": 0,
    }

    try:
        job_id = str(uuid.uuid4())
        job_dir = TEMP_DIR / job_id
        job_dir.mkdir()

        input_video_path = job_dir / "input.mp4"
        input_audio_path = job_dir / "music.mp3"
        tts_audio_path = job_dir / "tts.mp3"
        tts_vtt_path = job_dir / "tts.vtt"
        output_video_path = job_dir / "output.mp4"

        start_step = time.time()
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

        stats["download_duration"] = time.time() - start_step
        start_step = time.time()

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
                    voice = "fr-FR-RemyMultilingualNeural"
                elif voice == "female":
                    voice = "fr-FR-VivienneMultilingualNeural"
                elif not voice or "Neural" not in voice:
                    # Default if invalid
                    voice = "fr-FR-VivienneMultilingualNeural"

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

        stats["tts_duration"] = time.time() - start_step
        start_step = time.time()

        # 3.5 Stabilize video if requested (vidstab two-pass)
        if request.stabilize:
            print("📐 Starting video stabilization (vidstab)...")
            transforms_path = job_dir / "transforms.trf"
            stabilized_path = job_dir / "stabilized.mp4"

            try:
                # Pass 1: Detect motion/shakiness
                print("📐 Pass 1: Detecting motion...")
                detect_cmd = [
                    "ffmpeg",
                    "-y",
                    "-i",
                    str(input_video_path),
                    "-vf",
                    f"vidstabdetect=stepsize=6:shakiness=8:accuracy=9:result={transforms_path}",
                    "-f",
                    "null",
                    "-",
                ]
                detect_proc = subprocess.run(
                    detect_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE
                )

                if detect_proc.returncode != 0:
                    print(
                        f"⚠️ Stabilization pass 1 failed: {detect_proc.stderr.decode()[:500]}"
                    )
                elif transforms_path.exists():
                    # Pass 2: Apply stabilization transform
                    print("📐 Pass 2: Applying stabilization...")
                    transform_cmd = [
                        "ffmpeg",
                        "-y",
                        "-i",
                        str(input_video_path),
                        "-vf",
                        f"vidstabtransform=input={transforms_path}:smoothing=10:crop=black:zoom=1,unsharp=5:5:0.8:3:3:0.4",
                        "-c:v",
                        "libx264",
                        "-preset",
                        "medium",
                        "-crf",
                        "18",
                        "-c:a",
                        "copy",
                        str(stabilized_path),
                    ]
                    transform_proc = subprocess.run(
                        transform_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE
                    )

                    if transform_proc.returncode == 0 and stabilized_path.exists():
                        # Use stabilized video for further processing
                        input_video_path = stabilized_path
                        print("✅ Video stabilization complete!")
                    else:
                        print(
                            f"⚠️ Stabilization pass 2 failed: {transform_proc.stderr.decode()[:500]}"
                        )
                else:
                    print("⚠️ Transforms file not created, skipping stabilization")

            except Exception as e:
                print(f"⚠️ Stabilization error (continuing without): {e}")

        stats["stabilize_duration"] = time.time() - start_step
        start_step = time.time()

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
                # Force style to look like TikTok/Reels text (No Black Box, just Outline)
                # Bigger font size (64 by default) and better vertical margin for 1080p
                style = f"FontName=Arial,FontSize={request.font_size},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=0,Bold=1,Alignment=2,MarginV=300"
                # Escape path for FFmpeg filter
                vtt_path_str = str(tts_vtt_path).replace("\\", "/").replace(":", "\\:")
                video_filters.append(
                    f"subtitles='{vtt_path_str}':force_style='{style}'"
                )
            else:
                # Standard Drawtext logic
                # Scale font for 1080p
                sanitized_text = request.text.replace("'", "").replace(":", "\\:")
                drawtext = f"drawtext=fontfile={FONT_PATH}:text='{sanitized_text}':fontcolor=white:fontsize={request.font_size}:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-text_h-300"
                video_filters.append(drawtext)

        # Audio Mixing Strategy
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

        if has_music:
            music_vol = request.music_volume
            if has_tts:
                music_vol = music_vol * 0.3
            filter_complex_parts.append(f"[1:a]volume={music_vol}[a1]")
            mix_inputs += 1

        if has_tts:
            tts_idx = 2 if has_music else 1
            filter_complex_parts.append(f"[{tts_idx}:a]volume=1.5[a2]")
            mix_inputs += 1

        if mix_inputs > 0:
            inputs_str = "".join(
                ["[a1]" if has_music else "", "[a2]" if has_tts else ""]
            )
            filter_complex_parts.append(
                f"{inputs_str}amix=inputs={mix_inputs}:duration=first:dropout_transition=2:normalize=0[aout]"
            )
            cmd.extend(["-filter_complex", ";".join(filter_complex_parts)])
            cmd.extend(["-map", "0:v", "-map", "[aout]"])
        else:
            cmd.extend(["-map", "0:v"])

        # Scaling to 1080x1920 (Vertical HD Reel Format)
        # unsharp is added to counteract any blurring from scaling
        format_filter = "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,unsharp=5:5:0.8:3:3:0.4"
        video_filters.insert(0, format_filter)

        if video_filters:
            cmd.extend(["-vf", ",".join(video_filters)])

        cmd.extend(["-shortest"])

        # Quality settings
        cmd.extend(
            [
                "-c:v",
                "libx264",
                "-preset",
                "slow",
                "-crf",
                "17",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
            ]
        )

        cmd.append(str(output_video_path))

        # execute
        process = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        stats["encoding_duration"] = time.time() - start_step
        stats["total_duration"] = time.time() - start_total

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

        print(f"📊 Processing Stats: {stats}")

        return {
            "success": True,
            "output_base64": out_b64,
            "duration": duration,
            "processing_stats": stats,
        }

    except Exception as e:
        if "job_dir" in locals():
            shutil.rmtree(job_dir, ignore_errors=True)
        return {"success": False, "detail": str(e)}


@app.post("/preview-tts")
async def preview_tts(request: ReelRequest, x_api_key: str = Header(None)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API Key")

    try:
        job_id = str(uuid.uuid4())
        job_dir = TEMP_DIR / job_id
        job_dir.mkdir()

        tts_audio_path = job_dir / "preview.mp3"
        tts_vtt_path = job_dir / "preview.vtt"  # Not used but needed for function sig

        if not request.text:
            raise HTTPException(status_code=400, detail="Text required for preview")

        clean_text = clean_text_for_tts(request.text)

        # Determine voice (reuse logic)
        voice = request.tts_voice
        if voice == "male":
            voice = "fr-FR-RemyMultilingualNeural"
        elif voice == "female":
            voice = "fr-FR-VivienneMultilingualNeural"
        elif not voice or "Neural" not in voice:
            voice = "fr-FR-VivienneMultilingualNeural"

        await generate_tts_with_subs(clean_text, voice, tts_audio_path, tts_vtt_path)

        if not tts_audio_path.exists():
            raise Exception("TTS generation failed (file missing)")

        with open(tts_audio_path, "rb") as f:
            audio_bytes = f.read()
            audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")

        shutil.rmtree(job_dir)
        return {"success": True, "audio_base64": audio_b64}

    except Exception as e:
        if "job_dir" in locals():
            shutil.rmtree(job_dir, ignore_errors=True)
        return {"success": False, "detail": str(e)}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
