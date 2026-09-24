"""Construction de la commande FFmpeg d'un Reel (fonction pure, testable)."""

from dataclasses import dataclass
from pathlib import Path

from . import config
from .subtitles import filter_path

FADE_SECONDS = 2.0
LOGO_SECONDS = 5.0
# Silence laissé après la dernière phrase avant la fin de la vidéo
VOICE_TAIL = 0.8
# Durée minimale de l'effet de fin (grand logo + nom du magasin) après la voix
OUTRO_MIN = 2.5

# HDR (HLG/PQ) → SDR BT.709 : sans cela, les vidéos iPhone sortent ternes
TONEMAP = (
    "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
    "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
)


@dataclass
class RenderPlan:
    video: Path
    video_duration: float
    output: Path
    is_hdr: bool = False
    stabilize_transforms: Path | None = None
    music: Path | None = None
    music_volume: float = 0.25
    voice: Path | None = None
    voice_duration: float = 0.0
    voice_delay: float = config.VOICE_DELAY
    captions: Path | None = None
    watermark: Path | None = None
    outro: Path | None = None  # nom du magasin (effet de fin)
    ending_effect: bool = True
    keep_original_audio: bool = False

    @property
    def speech_end(self) -> float:
        return self.voice_delay + self.voice_duration if self.voice else 0.0

    @property
    def total_duration(self) -> float:
        """La vidéo s'allonge (dernière image figée) si la voix dure plus longtemps."""
        duration = self.video_duration
        if self.voice:
            duration = max(duration, self.speech_end + VOICE_TAIL)
            if self.ending_effect and self.watermark:
                duration = max(duration, self.speech_end + OUTRO_MIN)
        return round(duration, 3)

    @property
    def logo_start(self) -> float:
        """Le grand logo n'arrive qu'une fois la voix terminée."""
        return max(0.0, self.total_duration - LOGO_SECONDS, self.speech_end)

    @property
    def freeze_duration(self) -> float:
        return max(0.0, self.total_duration - self.video_duration)


def build_command(plan: RenderPlan) -> list[str]:
    total = plan.total_duration
    logo_start = plan.logo_start
    fade_start = max(0.0, total - FADE_SECONDS)

    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(plan.video)]
    index = 1
    music_idx = voice_idx = wm_idx = None
    if plan.music:
        # Musique bouclée : une piste plus courte que la vidéo ne coupe plus le son
        cmd += ["-stream_loop", "-1", "-i", str(plan.music)]
        music_idx, index = index, index + 1
    if plan.voice:
        cmd += ["-i", str(plan.voice)]
        voice_idx, index = index, index + 1
    if plan.watermark:
        cmd += ["-i", str(plan.watermark)]
        wm_idx, index = index, index + 1

    graph: list[str] = []

    # --- Vidéo ---
    chain = []
    if plan.stabilize_transforms:
        chain.append(
            f"vidstabtransform=input={filter_path(plan.stabilize_transforms)}:smoothing=30:relative=1:zoom=5,"
            "unsharp=5:5:0.6:5:5:0.0"
        )
    if plan.is_hdr:
        chain.append(TONEMAP)
    chain.append(
        f"scale={config.WIDTH}:{config.HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,"
        f"crop={config.WIDTH}:{config.HEIGHT},setsar=1,fps={config.FPS}"
    )
    if plan.freeze_duration > 0:
        chain.append(f"tpad=stop_mode=clone:stop_duration={plan.freeze_duration:.3f}")
    if plan.captions:
        chain.append(f"subtitles='{filter_path(plan.captions)}'")
    graph.append(f"[0:v]{','.join(chain)}[vbase]")

    current = "vbase"
    if wm_idx is not None:
        corner = "W-w-30:H-h-30"
        if plan.outro and plan.ending_effect:
            graph.append(f"[{wm_idx}:v]scale=200:-1,split=2[wm_small][wm_big0]")
            graph.append("[wm_big0]scale=-1:300[wm_big]")
            graph.append(f"[{current}][wm_small]overlay={corner}:enable='lt(t,{logo_start:.3f})'[vwm1]")
            graph.append(f"[vwm1][wm_big]overlay=(W-w)/2:(H-h)/2-100:enable='gte(t,{logo_start:.3f})'[vwm2]")
            current = "vwm2"
        else:
            graph.append(f"[{wm_idx}:v]scale=200:-1[wm_small]")
            graph.append(f"[{current}][wm_small]overlay={corner}[vwm1]")
            current = "vwm1"
    if plan.outro and plan.ending_effect:
        graph.append(f"[{current}]subtitles='{filter_path(plan.outro)}'[vout0]")
        current = "vout0"

    tail = []
    if plan.ending_effect:
        tail.append(f"fade=t=out:st={fade_start:.3f}:d={FADE_SECONDS}")
    tail.append("format=yuv420p")
    graph.append(f"[{current}]{','.join(tail)}[vout]")

    # --- Audio ---
    mix = None
    if voice_idx is not None:
        delay_ms = int(plan.voice_delay * 1000)
        graph.append(f"[{voice_idx}:a]aresample=48000,adelay={delay_ms}:all=1,apad[voice]")
    if music_idx is not None:
        graph.append(f"[{music_idx}:a]aresample=48000,volume={plan.music_volume:.3f}[music]")

    if voice_idx is not None and music_idx is not None:
        # La musique baisse automatiquement quand la voix parle (ducking)
        graph.append("[voice]asplit=2[vmix][vkey]")
        graph.append("[music][vkey]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[ducked]")
        graph.append("[ducked][vmix]amix=inputs=2:duration=longest:normalize=0[mix]")
        mix = "mix"
    elif voice_idx is not None:
        mix = "voice"
    elif music_idx is not None:
        mix = "music"

    audio_map: list[str] = []
    if mix:
        # Niveau final recommandé par les réseaux sociaux (~ -14 LUFS)
        audio_tail = ["loudnorm=I=-14:TP=-1.5:LRA=11", "aresample=48000"]
        if plan.ending_effect:
            audio_tail.append(f"afade=t=out:st={fade_start:.3f}:d={FADE_SECONDS}")
        graph.append(f"[{mix}]{','.join(audio_tail)}[aout]")
        audio_map = ["-map", "[aout]"]
    elif plan.keep_original_audio:
        audio_map = ["-map", "0:a:0"]

    cmd += ["-filter_complex", ";".join(graph), "-map", "[vout]", *audio_map]
    cmd += [
        "-t",
        f"{total:.3f}",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "19",
        "-maxrate",
        "10M",
        "-bufsize",
        "20M",
        "-profile:v",
        "high",
        "-level",
        "4.2",
        "-g",
        str(config.FPS * 2),
        "-keyint_min",
        str(config.FPS),
        "-pix_fmt",
        "yuv420p",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "bt709",
        "-colorspace",
        "bt709",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        str(plan.output),
    ]
    return cmd


def stabilize_detect_command(video: Path, transforms: Path) -> list[str]:
    return [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(video),
        "-vf",
        f"vidstabdetect=stepsize=32:shakiness=8:accuracy=15:result={filter_path(transforms)}",
        "-f",
        "null",
        "-",
    ]
