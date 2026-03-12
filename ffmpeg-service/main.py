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
        filters_out = subprocess.run(
            ["ffmpeg", "-filters"], capture_output=True, text=True
        ).stdout
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
        filters = subprocess.run(
            ["ffmpeg", "-filters"], capture_output=True, text=True
        ).stdout
        fonts = subprocess.run(["fc-list"], capture_output=True, text=True).stdout
        return {
            "filters_summary": {
                "subtitles": "subtitles" in filters,
                "drawtext": "drawtext" in filters,
            },
            "env": {k: v for k, v in os.environ.items() if "API" not in k},
            "fonts": fonts.splitlines()[:50],  # First 50
            "raw_filters_hint": filters[:500],
        }
    except Exception as e:
        return {"error": str(e)}


# ... (existing imports)


def ensure_fonts():
    """Ensure Noto Color Emoji and other essential fonts are available."""
    print("🎨 Checking for Emoji fonts...")

    # Target directory for user fonts
    font_dir = Path("/usr/share/fonts/truetype/noto")
    if not font_dir.exists():
        try:
            # Fallback to local user fonts if system dir is not writable
            font_dir = Path("/tmp/.fonts")
            font_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            font_dir = Path("/tmp/.fonts")
            font_dir.mkdir(parents=True, exist_ok=True)

    emoji_font_path = font_dir / "NotoColorEmoji.ttf"

    if not emoji_font_path.exists():
        print("📥 Downloading Noto Color Emoji font...")
        try:
            url = "https://github.com/googlefonts/noto-emoji/raw/main/fonts/NotoColorEmoji.ttf"
            response = requests.get(url, stream=True)
            response.raise_for_status()
            with open(emoji_font_path, "wb") as f:
                shutil.copyfileobj(response.raw, f)
            print(f"✅ Downloaded to {emoji_font_path}")

            # Update font cache
            print("🔄 Updating font cache...")
            subprocess.run(
                ["fc-cache", "-f", "-v"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            print("✅ Font cache updated")
        except Exception as e:
            print(f"⚠️ Failed to download emoji font: {e}")
    else:
        print(f"✅ Emoji font already present at {emoji_font_path}")


# Run font setup
ensure_fonts()


# Robust font detection
def get_font_path():
    # ...
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

    return "Sans"  # Generic fallback


FONT_PATH = get_font_path()


class ReelRequest(BaseModel):
    video_base64: Optional[str] = None
    video_url: Optional[str] = None
    text: Optional[str] = None
    music_id: Optional[str] = None
    music_url: Optional[str] = None
    watermark_url: Optional[str] = None
    store_name: Optional[str] = None
    word_duration: float = 0.6
    font_size: int = 64
    music_volume: float = 0.25
    tts_enabled: bool = False
    tts_voice: str = "fr-FR-VivienneMultilingualNeural"
    draw_text: bool = True
    stabilize: bool = False  # Stabilisation vidéo via vidstab


def clean_text_for_display(text: str) -> str:
    """Removes emojis, hashtags, and hidden chars for display (text only)."""
    if not text:
        return ""
    # 0. Remove BOM and other hidden characters
    text = text.replace("\ufeff", "").replace("\u200b", "")
    # 1. Remove emojis
    text = emoji.replace_emoji(text, replace="")
    # 2. Remove hashtags (e.g. #viral #fyp)
    text = re.sub(r"#\w+", "", text)
    # 3. Collapse multiple spaces
    text = re.sub(r"\s+", " ", text).strip()
    return text


def clean_text_for_tts(text: str) -> str:
    if not text:
        return ""
    # 0. Remove BOM and other hidden characters
    text = text.replace("\ufeff", "").replace("\u200b", "")
    # 1. Remove emojis
    text = emoji.replace_emoji(text, replace="")
    # 2. Remove hashtags (e.g. #viral #reels)
    text = re.sub(r"#\w+", "", text)
    # 3. Cleanup whitespace
    return " ".join(text.split())


async def generate_tts_with_subs(
    text: str,
    voice: str,
    audio_path: Path,
    ass_path: Path,
    display_text: Optional[str] = None,
    delay: float = 0.0,
):
    """Generate TTS audio with word-level synchronized subtitles.

    Uses edge_tts.Communicate.stream() to capture WordBoundary events,
    providing millisecond-accurate subtitle timing instead of linear estimation.
    """

    # Determine gender of requested voice to choose appropriate fallbacks
    is_male = any(name in voice for name in ["Remi", "Henri", "Paul"])

    if is_male:
        fallback_voices = [
            voice,
            "fr-FR-HenriNeural",
            "fr-FR-PaulNeural",
        ]
    else:
        fallback_voices = [
            voice,
            "fr-FR-VivienneNeural",
            "fr-FR-DeniseNeural",
        ]

    fallback_voices.append("en-US-JennyNeural")
    fallback_voices = list(dict.fromkeys(fallback_voices))

    last_error = None

    for attempt_voice in fallback_voices:
        try:
            print(f"🔊 TTS attempt with voice: {attempt_voice}")
            communicate = edge_tts.Communicate(text, attempt_voice)

            # Stream audio + word boundaries simultaneously
            word_boundaries = []
            audio_chunks = []

            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio_chunks.append(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    # Offsets are in 100-nanosecond ticks, convert to seconds
                    offset_sec = chunk["offset"] / 10_000_000
                    duration_sec = chunk["duration"] / 10_000_000
                    word_boundaries.append(
                        {
                            "text": chunk["text"],
                            "offset": offset_sec,
                            "duration": duration_sec,
                        }
                    )

            # Write audio to file
            if audio_chunks:
                with open(audio_path, "wb") as f:
                    for audio_data in audio_chunks:
                        f.write(audio_data)

            if audio_path.exists() and audio_path.stat().st_size > 0:
                print(f"✅ TTS audio saved: {audio_path.stat().st_size} bytes")
                print(f"📍 Captured {len(word_boundaries)} word boundaries")

                # Log a few boundaries for debugging
                for wb in word_boundaries[:5]:
                    print(
                        f"   → '{wb['text']}' at {wb['offset']:.2f}s (dur: {wb['duration']:.2f}s)"
                    )

                # Measure total audio duration via ffprobe for safety
                audio_duration = None
                try:
                    duration_cmd = [
                        "ffprobe",
                        "-v",
                        "error",
                        "-show_entries",
                        "format=duration",
                        "-of",
                        "default=noprint_wrappers=1:nokey=1",
                        str(audio_path),
                    ]
                    dur_proc = subprocess.run(
                        duration_cmd, stdout=subprocess.PIPE, text=True
                    )
                    audio_duration = float(dur_proc.stdout.strip())
                    print(f"⏱️ TTS Audio Duration: {audio_duration:.2f}s")
                except Exception as e:
                    print(f"⚠️ Could not measure TTS duration: {e}")

                # Use display_text for subtitle content if provided
                text_to_display = display_text if display_text else text

                if word_boundaries:
                    # Precise synchronization using real word timings
                    # Add delay to TTS start
                    generate_ass_from_word_boundaries(
                        word_boundaries,
                        text_to_display,
                        ass_path,
                        total_duration=audio_duration,
                        delay=delay,
                    )
                else:
                    # Fallback to linear estimation if no boundaries captured
                    print(
                        "⚠️ No word boundaries captured, falling back to linear timing"
                    )
                    generate_simple_ass(
                        text_to_display, ass_path, total_duration=audio_duration, delay=delay
                    )

                print(f"✅ TTS success with voice: {attempt_voice}")
                return
            else:
                print(f"⚠️ Audio file empty or missing with voice: {attempt_voice}")

        except Exception as e:
            print(f"⚠️ TTS failed with voice {attempt_voice}: {e}")
            last_error = e

    raise Exception(f"All TTS voices failed. Last error: {last_error}")


def generate_ass_from_word_boundaries(
    word_boundaries: list,
    display_text: str,
    ass_path: Path,
    font_size: int = 65,
    total_duration: float = None,
    delay: float = 0.0,
):
    """Generate ASS subtitles using precise word-level timing from TTS engine.

    Groups words into readable chunks (~5 words or at punctuation) and uses
    the real start/end timestamps from the TTS engine for each chunk.
    """
    if not word_boundaries:
        return

    # Group word boundaries into chunks of ~5 words, or split at punctuation
    chunks = []
    current_words = []
    current_start = word_boundaries[0]["offset"]

    for i, wb in enumerate(word_boundaries):
        current_words.append(wb["text"])
        is_last = i == len(word_boundaries) - 1
        # Split at punctuation or every 3 words (tighter sync with voice)
        ends_sentence = wb["text"].rstrip().endswith((".", "!", "?", ":", ","))
        at_limit = len(current_words) >= 3

        if is_last or ends_sentence or at_limit:
            # End time = this word's offset + its duration
            chunk_end = wb["offset"] + wb["duration"]
            chunks.append(
                {
                    "text": " ".join(current_words),
                    "start": current_start + delay,
                    "end": chunk_end + delay,
                }
            )
            current_words = []
            # Next chunk starts at the next word's offset
            if not is_last:
                current_start = word_boundaries[i + 1]["offset"]

    # Extend the last chunk to total_duration if available
    # Why: prevents the last subtitle from vanishing before audio ends
    if total_duration and chunks:
        chunks[-1]["end"] = max(chunks[-1]["end"], total_duration)

    # Add 50ms overlap between consecutive chunks to prevent flickering
    for i in range(len(chunks) - 1):
        chunks[i]["end"] = max(chunks[i]["end"], chunks[i + 1]["start"] + 0.05)

    # ASS Header
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Sans,{font_size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,5,50,50,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events = ""
    for chunk in chunks:
        start_ts = format_ass_time(chunk["start"])
        end_ts = format_ass_time(chunk["end"])
        sanitized = chunk["text"].replace("{", "(").replace("}", ")")
        events += f"Dialogue: 0,{start_ts},{end_ts},Default,,0,0,0,,{sanitized}\n"

    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(header + events)

    print(
        f"📄 Generated synced ASS: {ass_path.stat().st_size} bytes, "
        f"{len(chunks)} chunks from {len(word_boundaries)} words"
    )


def generate_simple_ass(
    text: str,
    ass_path: Path,
    font_size: int = 65,
    total_duration: float = None,
    delay: float = 0.0,
):
    """Generate TikTok-style ASS subtitle file with karaoke highlight effect.

    Each word fills from white to yellow as it is spoken, with thick outline
    for readability on any background.
    """
    # Split text into word lists (3 words max per chunk for TikTok readability)
    all_words = text.split()
    chunks = []  # Each chunk is a list of words
    current_chunk = []

    for word in all_words:
        current_chunk.append(word)
        if len(current_chunk) >= 3 or word.endswith((".", "!", "?", ":")):
            chunks.append(current_chunk)
            current_chunk = []

    if current_chunk:
        chunks.append(current_chunk)

    # ASS Header — TikTok Karaoke Style
    # PrimaryColour = Yellow (highlighted/spoken) &H0000FFFF (ASS BGR: 00,FF,FF = RGB FF,FF,00)
    # SecondaryColour = White (before highlight) &H00FFFFFF
    # OutlineColour = Black &H00000000
    # BackColour = Semi-transparent black &H80000000
    # Bold=-1, Outline=3, Shadow=1, Alignment=5 (center middle)
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Sans,{font_size},&H0000FFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,5,50,50,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events = ""
    current_time = delay

    # Calculate total characters across all chunks for proportional timing
    total_chars = sum(len(w) for chunk in chunks for w in chunk)
    if total_chars == 0:
        total_chars = 1

    if total_duration:
        time_per_char = total_duration / total_chars
    else:
        # Fallback: ~80ms per character
        time_per_char = 0.08

    for chunk_words in chunks:
        # Calculate chunk duration from its characters
        chunk_chars = sum(len(w) for w in chunk_words)
        chunk_duration = chunk_chars * time_per_char

        start_time = format_ass_time(current_time)
        end_time = format_ass_time(current_time + chunk_duration)

        # Build karaoke text with \kf tags per word
        # \kf = smooth fill from SecondaryColour (white) to PrimaryColour (yellow)
        karaoke_parts = []
        for word in chunk_words:
            # Word duration in centiseconds, proportional to character length
            word_dur_cs = int((len(word) / chunk_chars) * chunk_duration * 100)
            word_dur_cs = max(word_dur_cs, 10)  # Min 0.1s per word
            sanitized = word.replace("{", "(").replace("}", ")")
            karaoke_parts.append(f"{{\\kf{word_dur_cs}}}{sanitized}")

        karaoke_text = " ".join(karaoke_parts)
        events += (
            f"Dialogue: 0,{start_time},{end_time},Default,,0,0,0,,{karaoke_text}\n"
        )

        current_time += chunk_duration

    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(header + events)

    print(
        f"📄 Generated ASS file (karaoke): {ass_path.stat().st_size} bytes, {len(chunks)} chunks, {len(all_words)} words"
    )


def generate_outro_ass(
    text: str, ass_path: Path, start_time: float, end_time: float, font_size: int = 70
):
    """Generate a simple ASS subtitle for the store name outro, fading in at the end."""
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Sans,{font_size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,4,2,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = ""
    start_str = format_ass_time(start_time)
    end_str = format_ass_time(end_time)

    # Alignment 2 is bottom center. MarginV = 700 pushes it up appropriately below the center logo.
    # \fad(2000,0) fades in over 2000ms.
    sanitized = text.replace("{", "(").replace("}", ")")
    events += f"Dialogue: 0,{start_str},{end_str},Default,,0,0,700,,{{\\fad(2000,0)}}{sanitized}\n"

    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(header + events)


def format_ass_time(seconds: float) -> str:
    """Format seconds as ASS timestamp (H:MM:SS.ss)."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    centis = int((seconds % 1) * 100)
    return f"{hours}:{minutes:02d}:{secs:02d}.{centis:02d}"


def generate_simple_srt(text: str, srt_path: Path):
    # This was a stub, but let's fix the internal helper if it were called
    def format_srt_time(seconds: float) -> str:
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds % 1) * 1000)
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

    pass


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
        tts_ass_path = job_dir / "tts.ass"
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

        # --- Get Video Duration for Fade Out ---
        try:
            video_dur_cmd = [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(input_video_path),
            ]
            dur_proc = subprocess.run(video_dur_cmd, stdout=subprocess.PIPE, text=True)
            video_duration = float(dur_proc.stdout.strip() or 0)
        except Exception as e:
            print(f"⚠️ Could not measure original video duration: {e}")
            video_duration = 30.0  # Fallback

        fade_duration = 2.0
        fade_start = max(0, video_duration - fade_duration)

        # Le logo doit apparaitre à 5 secondes de la fin (3 secondes avant le fondu au noir)
        logo_start_time = max(0, video_duration - 5.0)
        print(
            f"🎬 Video Duration: {video_duration:.2f}s | Logo Start: {logo_start_time:.2f}s | Fade Out Start: {fade_start:.2f}s"
        )

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

        has_watermark = False
        if request.watermark_url:
            try:
                # Add User-Agent to avoid 403 on some CDNs
                headers = {"User-Agent": "Mozilla/5.0"}
                response = requests.get(
                    request.watermark_url, headers=headers, stream=True
                )
                response.raise_for_status()
                with open(job_dir / "watermark.png", "wb") as f:
                    shutil.copyfileobj(response.raw, f)
                has_watermark = True
            except Exception as e:
                print(f"Failed to download watermark: {e}")

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
                    # Pass original text (with emojis) for subtitles, cleaned text for audio
                    await generate_tts_with_subs(
                        tts_clean_text,
                        voice,
                        tts_audio_path,
                        tts_ass_path,
                        display_text=clean_text_for_display(request.text),
                        delay=2.0,
                    )

                    # Verify files were created
                    if tts_audio_path.exists() and tts_audio_path.stat().st_size > 0:
                        print(
                            f"✅ TTS audio generated: {tts_audio_path.stat().st_size} bytes"
                        )
                        has_tts = True
                    else:
                        print("❌ TTS audio file missing or empty!")
                else:
                    print("⚠️ TTS text is empty after cleaning, skipping.")
            except Exception as e:
                import traceback

                print(f"❌ Failed to generate TTS: {e}")
                traceback.print_exc()

        stats["tts_duration"] = time.time() - start_step
        start_step = time.time()

        # 4. Build FFmpeg Command with Unified filter_complex
        cmd = ["ffmpeg", "-y", "-i", str(input_video_path)]

        # --- Stability Pass 1 (if requested) ---
        vidstab_filter = ""
        if request.stabilize:
            print("📐 Starting video stabilization (Pass 1: Detection)...")
            transforms_path = job_dir / "transforms.trf"

            # Run detection pass
            # Aggressive stabilization settings:
            # - shakiness=10: Max sensitivity to shake
            # - accuracy=15: High accuracy
            # - stepsize=32: Larger search window for bigger shakes
            detect_cmd = [
                "ffmpeg",
                "-y",
                "-i",
                str(input_video_path),
                "-vf",
                f"vidstabdetect=stepsize=32:shakiness=10:accuracy=15:result={transforms_path}",
                "-f",
                "null",
                "-",
            ]

            detect_proc = subprocess.run(
                detect_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE
            )

            if detect_proc.returncode == 0 and transforms_path.exists():
                print(
                    "✅ Stabilization Pass 1 complete. Integrating Pass 2 into main filter chain."
                )
                # We will add vidstabtransform to the video chain below
                # smoothing=30 -> Heavy smoothing (default is 10) for handheld feel
                # relative=1 -> Transforms relative to previous frame
                # zoom=5 -> Fixed 5% zoom to avoid black borders from stabilization
                vidstab_filter = f"vidstabtransform=input={transforms_path}:smoothing=30:relative=1:zoom=5,unsharp=5:5:1.0:5:5:0.0,"
            else:
                print(
                    f"⚠️ Stabilization Pass 1 failed: {detect_proc.stderr.decode()[:500]}"
                )

        stats["stabilize_duration"] = time.time() - start_step
        start_step = time.time()

        # --- Audio Checks ---
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

        watermark_idx = -1
        if has_watermark:
            cmd.extend(["-i", str(job_dir / "watermark.png")])
            watermark_idx = input_count
            input_count += 1

        # --- Filter Complex Construction ---
        fc_parts = []

        # A. Video Chain
        # Chain: [0:v] -> [stabilize] -> [scale/crop] -> [text] -> [vout]

        # 1. Stabilization (if enabled) + Scaling/Cropping
        # We apply stabilization FIRST on raw video, THEN crop to 9:16

        # Start of video chain
        v_chain = "[0:v]"

        if vidstab_filter:
            v_chain += vidstab_filter
            # Note: vidstabtransform output is same res as input

        # Scale & Crop to Fill 1080x1920 (Vertical Reel)
        # Then enhance brightness/contrast slightly for Facebook optimization
        v_chain += "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=brightness=0.05:contrast=1.1"

        # 2. Text Overlay
        if request.text and request.draw_text:
            text_filter = ""
            if has_tts:
                # Subtitles (TikTok style) using ASS (already generated in TTS block)
                print(f"🎬 Overlaying subtitles from TTS ASS: {tts_ass_path}")
                ass_path_str = str(tts_ass_path).replace("\\", "/").replace(":", "\\:")
                text_filter = f",subtitles='{ass_path_str}'"
            else:
                # Standard Text (without TTS)
                print(
                    f"🎬 Overlaying subtitles from standard text: {request.text[:30]}..."
                )
                std_ass_path = job_dir / "std_text.ass"
                # Use fontsize 40 by default for standard text
                generate_simple_ass(request.text, std_ass_path, font_size=40, delay=2.0)

                ass_path_str = str(std_ass_path).replace("\\", "/").replace(":", "\\:")
                text_filter = f",subtitles='{ass_path_str}'"

            # Combine formatting + text
            v_chain += text_filter

        if has_watermark:
            if request.store_name:
                # Ouro Party Mode + Persistent bottom right
                
                # We need two scaled versions of the logo
                # [wm_small]: Bottom right persistent logo
                fc_parts.append(f"[{watermark_idx}:v]scale=200:-1,split=2[wm_small_base][wm_large_base]")
                fc_parts.append(f"[wm_large_base]scale=-1:300[wm_large]")

                # 1. Place small logo in bottom right until logo_start_time (5s before the end)
                v_chain += f"[v_pre_small];[v_pre_small][wm_small_base]overlay=W-w-20:H-h-20:enable='between(t,0,{logo_start_time})'"
                
                # 2. Place large logo in the center, and fading it IN during the last 5 seconds
                v_chain += f"[v_pre_large];[v_pre_large][wm_large]overlay=(W-w)/2:(H-h)/2-100:enable='between(t,{logo_start_time},{video_duration})'"
                
                # 3. Drawing the Store Name below the logo using ASS subtitles
                outro_ass_path = job_dir / "outro.ass"
                generate_outro_ass(
                    request.store_name, outro_ass_path, logo_start_time, video_duration
                )
                ass_path_str_2 = (
                    str(outro_ass_path).replace("\\", "/").replace(":", "\\:")
                )
                v_chain += f",subtitles='{ass_path_str_2}'"
            else:
                # Normal watermark (bottom right)
                fc_parts.append(f"[{watermark_idx}:v]scale=200:-1[wm]")
                v_chain += "[v_pre_wm];[v_pre_wm][wm]overlay=W-w-20:H-h-20"

        # Add Video Fade Out
        v_chain += f",fade=t=out:st={fade_start}:d={fade_duration}"

        # End of video chain
        v_chain += "[vout]"
        fc_parts.append(v_chain)

        # B. Audio Chain
        audio_mapped = False

        inputs_for_mix = 0
        audio_mix_str = ""

        # Strategy:
        # If no music and no TTS -> Copy original audio (if exists) or silent
        # If music or TTS -> Mix everything

        if has_music or has_tts:
            # When music or TTS is used, we REMOVE the original video audio
            # and only mix the new audio sources (music + TTS)
            # Original audio is intentionally excluded to avoid background noise/voices

            if has_music:
                # Adjust volume
                fc_parts.append(
                    f"[{music_idx}:a]volume={request.music_volume}[a_music]"
                )
                audio_mix_str += "[a_music]"
                inputs_for_mix += 1

            if has_tts:
                # TTS louder and delayed by 2 seconds (2s) on all channels
                fc_parts.append(f"[{tts_idx}:a]adelay=2s:all=1,volume=1.5[a_tts]")
                audio_mix_str += "[a_tts]"
                inputs_for_mix += 1

            # Mix
            if inputs_for_mix > 0:
                fc_parts.append(
                    f"{audio_mix_str}amix=inputs={inputs_for_mix}:duration=first:dropout_transition=2:normalize=0[amixout]"
                )
                fc_parts.append(
                    f"[amixout]afade=t=out:st={fade_start}:d={fade_duration}[aout]"
                )
                audio_mapped = True
        else:
            # No external audio added
            if has_original_audio:
                # Add audio fade out to original audio
                fc_parts.append(
                    f"[0:a]afade=t=out:st={fade_start}:d={fade_duration}[aout]"
                )
                audio_mapped = True
            else:
                # No audio at all
                audio_mapped = False

        # Apply Filter Complex
        cmd.extend(["-filter_complex", ";".join(fc_parts)])

        # Maps
        cmd.extend(["-map", "[vout]"])  # Map processed video

        if audio_mapped:
            cmd.extend(["-map", "[aout]"])  # Map mixed audio
        elif has_original_audio:
            cmd.extend(["-map", "0:a"])  # Map original audio directly

        # Cut EXACTLY at video length (better than -shortest which can cause issues with amix)
        cmd.extend(["-t", str(video_duration)])

        # Quality settings
        cmd.extend(
            [
                "-c:v",
                "libx264",
                "-profile:v",
                "high",
                "-r",
                "30",
                "-preset",
                "slow",
                "-level",
                "4.1",
                "-crf",
                "18",
                "-b:v",
                "10M",
                "-maxrate",
                "12M",
                "-bufsize",
                "20M",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
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
            stderr_last_lines = "\n".join(process.stderr.decode().splitlines()[-20:])
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

        # Pass original text for subtitles (implied in SRT for preview too if needed, though mostly audio)
        # Preview TTS generation doesn't technically need the full 2s video delay, but if the frontend plays it against standard timing it might.
        # Adding delay=0.0 here explicitly since it's just audio preview, or delay=2.0 if previewing video directly.
        await generate_tts_with_subs(
            clean_text,
            voice,
            tts_audio_path,
            tts_srt_path,
            display_text=clean_text_for_display(request.text),
        )

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
