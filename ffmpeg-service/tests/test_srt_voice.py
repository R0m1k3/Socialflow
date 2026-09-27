from pathlib import Path

from app.align import Word, spread_words
from app.render import RenderPlan
from app.srt_voice import Cue, atempo_chain, cue_windows, mix_command, speed_factor, spoken_span


def test_window_stops_at_next_cue_and_tolerates_a_short_overflow():
    cues = [Cue(0.0, 2.0, "a"), Cue(2.1, 4.0, "b"), Cue(6.0, 7.0, "c")]
    assert cue_windows(cues) == [2.1, 2.15, 1.25]


def test_voice_is_sped_up_only_when_too_long():
    assert speed_factor(1.5, 2.0) == 1.0
    assert speed_factor(3.0, 2.0) == 1.5


def test_atempo_is_split_into_supported_steps():
    assert atempo_chain(1.25) == "atempo=1.2500"
    assert atempo_chain(3.0) == "atempo=2.0000,atempo=1.5000"


def test_spoken_span_trims_silences_around_words():
    words = [Word("Bonjour", 0.4, 0.9), Word("!", 0.9, 1.2)]
    assert [round(t, 3) for t in spoken_span(words, 2.0)] == [0.35, 1.32]
    assert spoken_span([], 2.0) == (0.0, 2.0)


def test_each_segment_is_placed_at_its_cue_start():
    cmd = mix_command([(Path("a.wav"), 0.0), (Path("b.wav"), 3.25)], Path("voice.wav"))
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert "[1:a]adelay=3250:all=1[s1]" in graph
    assert "amix=inputs=2" in graph and "normalize=0" in graph


def test_srt_voice_starts_without_delay():
    plan = RenderPlan(
        video=Path("in.mp4"),
        video_duration=5.0,
        output=Path("out.mp4"),
        voice=Path("v.wav"),
        voice_duration=8.0,
        voice_delay=0.0,
    )
    assert plan.speech_end == 8.0
    assert plan.total_duration == 8.8


def test_words_spread_over_their_cue():
    words = spread_words("Bonjour à tous", 4.0, 5.0)
    assert words[0].start == 4.0 and round(words[-1].end, 3) == 5.0
