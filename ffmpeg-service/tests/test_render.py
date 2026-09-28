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
    assert "[0:a:0]aresample=48000,apad[bed]" in _graph(cmd)
    assert cmd[cmd.index("-map", cmd.index("[vout]")) + 1] == "[aout]"


def test_original_audio_stays_under_the_voice_when_no_music_is_chosen():
    plan = RenderPlan(
        video=Path("in.mp4"),
        video_duration=10.0,
        output=Path("out.mp4"),
        voice=Path("v.wav"),
        voice_duration=4.0,
        keep_original_audio=True,
    )
    graph = _graph(build_command(plan))
    assert "[0:a:0]aresample=48000,apad[bed]" in graph
    assert "[bed][vkey]sidechaincompress" in graph


def test_chosen_music_replaces_the_original_audio():
    plan = RenderPlan(
        video=Path("in.mp4"),
        video_duration=10.0,
        output=Path("out.mp4"),
        music=Path("m.mp3"),
        keep_original_audio=True,
    )
    assert "0:a:0" not in _graph(build_command(plan))


def test_prepared_audio_mix_keeps_original_audio_under_voice():
    from app.render import build_audio_mix_command

    plan = RenderPlan(
        video=Path("in.mp4"),
        video_duration=10.0,
        output=Path("out.mp4"),
        voice=Path("v.wav"),
        voice_duration=4.0,
        keep_original_audio=True,
    )
    cmd = build_audio_mix_command(plan, Path("a.wav"))
    # Entrées : voix (0) puis vidéo d'origine (1)
    assert cmd[cmd.index("in.mp4") - 1] == "-i"
    assert "[1:a:0]aresample=48000,apad[bed]" in " ".join(cmd)


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


def test_corner_logo_can_be_hidden_while_keeping_the_ending_logo():
    base = dict(video=Path("in.mp4"), video_duration=6.0, output=Path("out.mp4"), watermark=Path("logo.png"))
    hidden = _graph(build_command(RenderPlan(**base, outro=Path("o.ass"), show_watermark=False)))
    assert "W-w-30:H-h-30" not in hidden
    assert "overlay=(W-w)/2" in hidden

    nothing = _graph(build_command(RenderPlan(**base, show_watermark=False)))
    assert "overlay" not in nothing


def test_prepared_video_has_no_audio_and_final_duration():
    from app.render import build_prepared_video_command

    plan = RenderPlan(
        video=Path("in.mp4"),
        video_duration=6.0,
        output=Path("out.mp4"),
        voice=Path("v.wav"),
        voice_duration=5.0,
        outro_expected=True,
    )
    cmd = build_prepared_video_command(plan, Path("video.mp4"))
    assert "-an" in cmd
    assert cmd[cmd.index("-t") + 1] == "9.500"  # 2 s + 5 s de voix + 2,5 s d'effet de fin
    assert plan.logo_start == 7.0


def test_audio_mix_absent_without_any_sound():
    from app.render import build_audio_mix_command

    plan = RenderPlan(video=Path("in.mp4"), video_duration=6.0, output=Path("out.mp4"))
    assert build_audio_mix_command(plan, Path("a.wav")) is None
    plan.keep_original_audio = True
    assert "loudnorm=I=-14" in " ".join(build_audio_mix_command(plan, Path("a.wav")))
