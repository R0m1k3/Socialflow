from pathlib import Path

from app.render import RenderPlan, build_command


def _graph(cmd):
    return cmd[cmd.index("-filter_complex") + 1]


def test_voice_longer_than_video_extends_with_frozen_frame():
    plan = RenderPlan(
        video=Path("in.mp4"),
        video_duration=5.0,
        output=Path("out.mp4"),
        voice=Path("v.wav"),
        voice_duration=10.0,
    )
    assert plan.total_duration == 12.8
    cmd = build_command(plan)
    assert "tpad=stop_mode=clone:stop_duration=7.800" in _graph(cmd)
    assert cmd[cmd.index("-t") + 1] == "12.800"


def test_music_is_looped_and_ducked_under_voice():
    plan = RenderPlan(
        video=Path("in.mp4"),
        video_duration=20.0,
        output=Path("out.mp4"),
        music=Path("m.mp3"),
        voice=Path("v.wav"),
        voice_duration=5.0,
    )
    cmd = build_command(plan)
    assert cmd[cmd.index("m.mp3") - 3 : cmd.index("m.mp3")] == ["-stream_loop", "-1", "-i"]
    graph = _graph(cmd)
    assert "sidechaincompress" in graph
    assert "amix=inputs=2:duration=longest" in graph
    assert "loudnorm=I=-14" in graph


def test_no_brightness_hack_and_hdr_tonemapped():
    plan = RenderPlan(video=Path("in.mp4"), video_duration=5.0, output=Path("out.mp4"), is_hdr=True)
    graph = _graph(build_command(plan))
    assert "eq=" not in graph
    assert "tonemap=tonemap=hable" in graph
    assert "flags=lanczos" in graph


def test_original_audio_kept_when_nothing_added():
    plan = RenderPlan(
        video=Path("in.mp4"), video_duration=5.0, output=Path("out.mp4"), keep_original_audio=True
    )
    cmd = build_command(plan)
    assert cmd[cmd.index("-map", cmd.index("[vout]")) + 1] == "0:a:0"


def test_encoding_targets_social_networks():
    cmd = build_command(RenderPlan(video=Path("in.mp4"), video_duration=5.0, output=Path("out.mp4")))
    joined = " ".join(cmd)
    assert "-crf 19" in joined and "-b:v" not in joined
    assert "-ar 48000" in joined and "-b:a 192k" in joined
    assert "-colorspace bt709" in joined


def test_big_logo_waits_for_the_end_of_the_voice():
    plan = RenderPlan(
        video=Path("in.mp4"),
        video_duration=6.0,
        output=Path("out.mp4"),
        voice=Path("v.wav"),
        voice_duration=4.8,
        watermark=Path("logo.png"),
        outro=Path("o.ass"),
    )
    assert plan.logo_start == 6.8
    assert plan.total_duration == 9.3
    assert "gte(t,6.800)" in _graph(build_command(plan))
