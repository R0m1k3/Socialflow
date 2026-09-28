"""Construction des commandes FFmpeg d'un Reel (fonctions pures, testables).

Deux usages :
- rendu complet par FFmpeg (sous-titres ASS incrustés) : `build_command` ;
- préparation pour Remotion, qui compose ensuite les sous-titres animés, le
  logo et l'effet de fin : `build_prepared_video_command` (image seule, déjà
  recadrée et allongée) et `build_audio_mix_command` (piste son finale).
"""

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

COLOR_TAGS = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]


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
    # Effet de fin prévu sans que le logo passe par FFmpeg (rendu Remotion)
    outro_expected: bool = False
    ending_effect: bool = True
    # Petit logo en coin pendant la vidéo (le grand logo de fin dépend de ending_effect)
    show_watermark: bool = True
    keep_original_audio: bool = False

    @property
    def has_outro(self) -> bool:
        return self.ending_effect and (self.watermark is not None or self.outro_expected)

    @property
    def speech_end(self) -> float:
        return self.voice_delay + self.voice_duration if self.voice else 0.0

    @property
    def total_duration(self) -> float:
        """La vidéo s'allonge (dernière image figée) si la voix dure plus longtemps."""
        duration = self.video_duration
        if self.voice:
            duration = max(duration, self.speech_end + VOICE_TAIL)
            if self.has_outro:
                duration = max(duration, self.speech_end + OUTRO_MIN)
        return round(duration, 3)

    @property
    def logo_start(self) -> float:
        """Le grand logo n'arrive qu'une fois la voix terminée."""
        return round(max(0.0, self.total_duration - LOGO_SECONDS, self.speech_end), 3)

    @property
    def fade_start(self) -> float:
        return max(0.0, self.total_duration - FADE_SECONDS)

    @property
    def freeze_duration(self) -> float:
        return max(0.0, self.total_duration - self.video_duration)


def video_filters(plan: RenderPlan) -> list[str]:
    """Stabilisation, HDR, recadrage 9:16, cadence fixe, dernière image figée."""
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
    return chain


def uses_original_audio(plan: RenderPlan) -> bool:
    """Sans musique choisie, la bande son d'origine de la vidéo sert de fond sonore."""
    return plan.music is None and plan.keep_original_audio


def audio_graph(
    plan: RenderPlan, music_idx: int | None, voice_idx: int | None, original_idx: int | None = None
) -> tuple[list[str], str | None]:
    """Graphe audio : voix décalée sur un fond sonore (musique bouclée, ou à
    défaut bande son d'origine) baissé sous la voix, niveau final ~ -14 LUFS.
    Renvoie les filtres et l'étiquette de sortie."""
    graph: list[str] = []
    if voice_idx is not None:
        delay_ms = int(plan.voice_delay * 1000)
        graph.append(f"[{voice_idx}:a]aresample=48000,adelay={delay_ms}:all=1,apad[voice]")

    bed = None
    if music_idx is not None:
        graph.append(f"[{music_idx}:a]aresample=48000,volume={plan.music_volume:.3f}[bed]")
        bed = "bed"
    elif original_idx is not None:
        # Son d'origine conservé à son niveau ; il se tait après la fin de la vidéo
        graph.append(f"[{original_idx}:a:0]aresample=48000,apad[bed]")
        bed = "bed"

    if voice_idx is not None and bed:
        # Le fond sonore baisse automatiquement quand la voix parle (ducking)
        graph.append("[voice]asplit=2[vmix][vkey]")
        graph.append(f"[{bed}][vkey]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[ducked]")
        graph.append("[ducked][vmix]amix=inputs=2:duration=longest:normalize=0[mix]")
        mix = "mix"
    elif voice_idx is not None:
        mix = "voice"
    elif bed:
        mix = bed
    else:
        return graph, None

    tail = ["loudnorm=I=-14:TP=-1.5:LRA=11", "aresample=48000"]
    if plan.ending_effect:
        tail.append(f"afade=t=out:st={plan.fade_start:.3f}:d={FADE_SECONDS}")
    graph.append(f"[{mix}]{','.join(tail)}[aout]")
    return graph, "aout"


def _audio_inputs(plan: RenderPlan, first_index: int) -> tuple[list[str], int | None, int | None, int]:
    args: list[str] = []
    index = first_index
    music_idx = voice_idx = None
    if plan.music:
        # Musique bouclée : une piste plus courte que la vidéo ne coupe plus le son
        args += ["-stream_loop", "-1", "-i", str(plan.music)]
        music_idx, index = index, index + 1
    if plan.voice:
        args += ["-i", str(plan.voice)]
        voice_idx, index = index, index + 1
    return args, music_idx, voice_idx, index


def _video_encoding(crf: int, preset: str) -> list[str]:
    return [
        "-c:v", "libx264", "-preset", preset, "-crf", str(crf),
        "-maxrate", "10M", "-bufsize", "20M",
        "-profile:v", "high", "-level", "4.2",
        "-g", str(config.FPS * 2), "-keyint_min", str(config.FPS),
        "-pix_fmt", "yuv420p", *COLOR_TAGS,
    ]  # fmt: skip


def build_command(plan: RenderPlan) -> list[str]:
    """Rendu complet par FFmpeg, sous-titres ASS incrustés."""
    total = plan.total_duration
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(plan.video)]
    audio_args, music_idx, voice_idx, index = _audio_inputs(plan, 1)
    cmd += audio_args
    wm_idx = None
    if plan.watermark:
        cmd += ["-i", str(plan.watermark)]
        wm_idx = index

    chain = video_filters(plan)
    if plan.captions:
        chain.append(f"subtitles='{filter_path(plan.captions)}'")
    graph = [f"[0:v]{','.join(chain)}[vbase]"]

    current = "vbase"
    if wm_idx is not None:
        corner = "W-w-30:H-h-30"
        big_logo = bool(plan.outro and plan.ending_effect)
        logo_start = plan.logo_start
        if big_logo and plan.show_watermark:
            graph.append(f"[{wm_idx}:v]split=2[wm_small0][wm_big0]")
            graph.append("[wm_small0]scale=200:-1[wm_small]")
        elif plan.show_watermark:
            graph.append(f"[{wm_idx}:v]scale=200:-1[wm_small]")
        elif big_logo:
            graph.append(f"[{wm_idx}:v]null[wm_big0]")
        if plan.show_watermark:
            until = f":enable='lt(t,{logo_start:.3f})'" if big_logo else ""
            graph.append(f"[{current}][wm_small]overlay={corner}{until}[vwm1]")
            current = "vwm1"
        if big_logo:
            graph.append("[wm_big0]scale=-1:300[wm_big]")
            graph.append(
                f"[{current}][wm_big]overlay=(W-w)/2:(H-h)/2-100:enable='gte(t,{logo_start:.3f})'[vwm2]"
            )
            current = "vwm2"
    if plan.outro and plan.ending_effect:
        graph.append(f"[{current}]subtitles='{filter_path(plan.outro)}'[vout0]")
        current = "vout0"

    tail = []
    if plan.ending_effect:
        tail.append(f"fade=t=out:st={plan.fade_start:.3f}:d={FADE_SECONDS}")
    tail.append("format=yuv420p")
    graph.append(f"[{current}]{','.join(tail)}[vout]")

    # La vidéo (entrée 0) fournit la bande son d'origine si aucune musique n'est choisie
    original_idx = 0 if uses_original_audio(plan) else None
    audio_filters, audio_out = audio_graph(plan, music_idx, voice_idx, original_idx)
    graph += audio_filters
    audio_map = ["-map", f"[{audio_out}]"] if audio_out else []

    cmd += ["-filter_complex", ";".join(graph), "-map", "[vout]", *audio_map]
    cmd += ["-t", f"{total:.3f}", *_video_encoding(19, "medium")]
    cmd += ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"]
    cmd.append(str(plan.output))
    return cmd


def build_prepared_video_command(plan: RenderPlan, output: Path) -> list[str]:
    """Image seule, prête pour Remotion : recadrée, en cadence fixe, à la durée finale.
    Qualité élevée (CRF 16) : elle sera réencodée une fois par Remotion."""
    chain = [*video_filters(plan), "format=yuv420p"]
    return [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(plan.video),
        "-vf", ",".join(chain), "-an", "-t", f"{plan.total_duration:.3f}",
        *_video_encoding(16, "veryfast"), "-movflags", "+faststart", str(output),
    ]  # fmt: skip


def build_audio_mix_command(plan: RenderPlan, output: Path) -> list[str] | None:
    """Piste son finale (WAV 48 kHz stéréo), ou None s'il n'y a aucun son à produire."""
    total = f"{plan.total_duration:.3f}"
    audio_args, music_idx, voice_idx, index = _audio_inputs(plan, 0)
    original_idx = None
    if uses_original_audio(plan):
        audio_args += ["-i", str(plan.video)]
        original_idx = index
    graph, audio_out = audio_graph(plan, music_idx, voice_idx, original_idx)
    if not audio_out:
        return None
    return [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *audio_args,
        "-filter_complex", ";".join(graph), "-map", f"[{audio_out}]", "-t", total,
        "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", str(output),
    ]  # fmt: skip


def stabilize_detect_command(video: Path, transforms: Path) -> list[str]:
    return [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(video),
        "-vf", f"vidstabdetect=stepsize=32:shakiness=8:accuracy=15:result={filter_path(transforms)}",
        "-f", "null", "-",
    ]  # fmt: skip
