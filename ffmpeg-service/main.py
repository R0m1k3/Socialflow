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

# Set HOME for libass/fontconfig to ensure cache can be written
os.environ["HOME"] = "/tmp"
os.environ["XDG_CACHE_HOME"] = "/tmp/.cache"

# List available filters and fonts for debugging
def run_diagnostics():
    print("📋 Checking FFmpeg environment...")
    try:
        filters_out = subprocess.run(["ffmpeg", "-filters"], capture_output=True, text=True).stdout
        has_subtitles = "subtitles" in filters_out
        has_drawtext = "drawtext" in filters_out
        print(f"✅ Filters found: subtitles={has_subtitles}, drawtext={has_drawtext}")
        
        print("📋 Available fonts (fc-list):")
        subprocess.run(["fc-list"], check=True)
    except Exception as e:
        print(f"⚠️ Failed to check FFmpeg environment: {e}")

run_diagnostics()

@app.get("/debug-ffmpeg")
async def debug_ffmpeg():
    try:
        filters = subprocess.run(["ffmpeg", "-filters"], capture_output=True, text=True).stdout
        fonts = subprocess.run(["fc-list"], capture_output=True, text=True).stdout
        return {
            "filters_summary": {
                "subtitles": "subtitles" in filters,
                "drawtext": "drawtext" in filters
            },
            "env": {k: v for k, v in os.environ.items() if "API" not in k},
            "fonts": fonts.splitlines()[:50], # First 50
            "raw_filters_hint": filters[:500]
        }
    except Exception as e:
        return {"error": str(e)}

# Robust font detection
def get_font_path():
    possible_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu-core/DejaVuSans.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
    ]
    for path in possible_paths:
        if os.path.exists(path):
            print(f"✅ Found font at: {path}")
            return path
    
    # Fallback search
    print("⚠️ Specific font not found, searching recursively in /usr/share/fonts...")
    try:
        found = []
        for root, dirs, files in os.walk("/usr/share/fonts"):
            for file in files:
                if file.endswith(".ttf"):
                    found.append(os.path.join(root, file))
        if found:
            print(f"✅ Found {len(found)} fonts, using first: {found[0]}")
            return found[0]
    except Exception as e:
        print(f"⚠️ Error searching for fonts: {e}")

    return "Sans" # Generic fallback

FONT_PATH = get_font_path()


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
    text: str, voice: str, audio_path: Path, srt_path: Path
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

                # Generate a simple SRT file with the full text
                generate_simple_srt(text, srt_path)

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


def generate_simple_srt(text: str, srt_path: Path):
    """Generate a simple SRT subtitle file that displays the full text."""
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

    # Each chunk gets time proportional to its word count
    srt_content = ""
    current_time = 0.0

    for i, chunk in enumerate(chunks):
        word_count = len(chunk.split())
        duration = word_count * 0.4  # 0.4 seconds per word

        start_time = format_srt_time(current_time)
        end_time = format_srt_time(current_time + duration)

        srt_content += f"{i + 1}\n"
        srt_content += f"{start_time} --> {end_time}\n"
        srt_content += f"{chunk}\n\n"

        current_time += duration

    print(f"📄 Generated {len(chunks)} SRT chunks. Content:\n{srt_content}")
    with open(srt_path, "w", encoding="utf-8") as f:
        f.write(srt_content)
    
    if srt_path.exists():
        print(f"✅ SRT file written: {srt_path.stat().st_size} bytes at {srt_path}")
    else:
        print(f"❌ Failed to write SRT file at {srt_path}")


def format_srt_time(seconds: float) -> str:
    """Format seconds as SRT timestamp (HH:MM:SS,mmm)."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


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
        tts_srt_path = job_dir / "tts.srt"
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
                        tts_clean_text, voice, tts_audio_path, tts_srt_path
                    )

                    # Verify files were created
                    if tts_audio_path.exists() and tts_audio_path.stat().st_size > 0:
                        print(
                            f"✅ TTS audio generated: {tts_audio_path.stat().st_size} bytes"
                        )
                        has_tts = True
                        # Generate SRT
                        generate_simple_srt(tts_clean_text, tts_srt_path)
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

        # 4. Build FFmpeg Command with Unified filter_complex
        cmd = ["ffmpeg", "-y", "-i", str(input_video_path)]

        # --- Audio Checks ---
        has_original_audio = False
        try:
            probe_cmd = [
                "ffprobe", "-v", "error", "-select_streams", "a:0",
                "-show_entries", "stream=codec_type", "-of", "csv=p=0",
                str(input_video_path),
            ]
            probe_out = subprocess.check_output(probe_cmd).decode().strip()
            if probe_out == "audio":
                has_original_audio = True
        except Exception:
            pass

        # --- Inputs ---
        # 0: Video (already added)
        # 1: Music (optional)
        # 2: TTS (optional)
        
        input_count = 1
        music_idx = -1
        tts_idx = -1

        if has_music:
            cmd.extend(["-i", str(input_audio_path)])
            music_idx = input_count
            input_count += 1
        
        if has_tts:
            cmd.extend(["-i", str(tts_audio_path)])
            tts_idx = input_count
            input_count += 1

        # --- Filter Complex Construction ---
        fc_parts = []
        
        # A. Video Chain
        # 1. Scale & Crop to Fill 1080x1920 (Vertical Reel)
        # [0:v] -> [v_processed]
        # Using 'increase' + 'crop' to ensure full screen coverage without black bars
        video_filters_str = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,unsharp=5:5:0.8:3:3:0.4"
        
        # 2. Text Overlay
        if request.text and request.draw_text:
            text_filter = ""
            if has_tts:
                # Subtitles (TikTok style) using SRT (already generated in TTS block)
                print(f"🎬 Overlaying subtitles from TTS SRT: {tts_srt_path}")
                # White color (&H00FFFFFF), Size 20, Centered (Alignment 5)
                # Note: FontSize 10 is extremely small, using 20 for minimum legibility
                style = f"FontName=DejaVu Sans,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=0,Bold=1,Alignment=5,MarginV=0"
                srt_path_str = str(tts_srt_path).replace("\\", "/").replace(":", "\\:")
                text_filter = f"subtitles='{srt_path_str}':force_style='{style}'"
            else:
                # Standard Text (without TTS)
                print(f"🎬 Overlaying subtitles from standard text: {request.text[:30]}...")
                std_srt_path = job_dir / "std_text.srt"
                generate_simple_srt(request.text, std_srt_path)
                
                # White color (&H00FFFFFF), Size 20, Centered (Alignment 5)
                style = f"FontName=DejaVu Sans,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=0,Bold=1,Alignment=5,MarginV=0"
                srt_path_str = str(std_srt_path).replace("\\", "/").replace(":", "\\:")
                text_filter = f"subtitles='{std_srt_path}':force_style='{style}'"
            
            # Combine formatting + text
            video_filters_str += f",{text_filter}"

        # Define Video Chain
        fc_parts.append(f"[0:v]{video_filters_str}[vout]")

        # B. Audio Chain
        audio_mapped = False
        
        inputs_for_mix = 0
        audio_mix_str = ""

        # Strategy:
        # If no music and no TTS -> Copy original audio (if exists) or silent
        # If music or TTS -> Mix everything
        
        if has_music or has_tts:
            # Prepare inputs
            if has_original_audio:
                audio_mix_str += "[0:a]"
                inputs_for_mix += 1
            
            if has_music:
                # Adjust volume
                fc_parts.append(f"[{music_idx}:a]volume={request.music_volume}[a_music]")
                audio_mix_str += "[a_music]"
                inputs_for_mix += 1
            
            if has_tts:
                # TTS louder
                fc_parts.append(f"[{tts_idx}:a]volume=1.5[a_tts]")
                audio_mix_str += "[a_tts]"
                inputs_for_mix += 1
            
            # Mix
            if inputs_for_mix > 0:
                fc_parts.append(f"{audio_mix_str}amix=inputs={inputs_for_mix}:duration=first:dropout_transition=2:normalize=0[aout]")
                audio_mapped = True
        else:
            # No external audio added
            if has_original_audio:
                # Just pass through original audio
                # We can map 0:a directly, no filter needed for audio
                audio_mapped = False 
            else:
                # No audio at all
                audio_mapped = False

        # Apply Filter Complex
        cmd.extend(["-filter_complex", ";".join(fc_parts)])
        
        # Maps
        cmd.extend(["-map", "[vout]"]) # Map processed video
        
        if audio_mapped:
            cmd.extend(["-map", "[aout]"]) # Map mixed audio
        elif has_original_audio:
            cmd.extend(["-map", "0:a"]) # Map original audio directly
        
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
        print(f"🚀 Executing FFmpeg command: {' '.join(cmd)}")

        # execute
        process = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        # Log detailed output on failure OR success for debugging font issues
        if process.returncode != 0:
            print(f"❌ FFmpeg failed. Stderr:\n{process.stderr.decode()}")
        else:
            # Check stderr for font warnings even on success
            stderr_last_lines = '\n'.join(process.stderr.decode().splitlines()[-20:])
            print(f"✅ FFmpeg executed. Stderr (last 20 lines):\n{stderr_last_lines}")

        stats["encoding_duration"] = time.time() - start_step
        stats["total_duration"] = time.time() - start_total

        if process.returncode != 0:
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
        tts_srt_path = job_dir / "preview.srt"  # Consistent with rest of app

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

        await generate_tts_with_subs(clean_text, voice, tts_audio_path, tts_srt_path)

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
