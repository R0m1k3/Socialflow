from pathlib import Path

from app.align import Word, spread_words
from app.render import RenderPlan
from app.srt_voice import (
    Cue,
    as_sentence,
    atempo_chain,
    cue_windows,
    mix_command,
    segments_from_reading,
    speed_factor,
    split_by_cue,
)


def test_window_stops_at_next_cue_and_tolerates_a_short_overflow():
    cues = [Cue(0.0, 2.0, "a"), Cue(2.1, 4.0, "b"), Cue(6.0, 7.0, "c")]
    assert cue_windows(cues) == [2.1, 2.15, 1.25]


def test_voice_is_sped_up_only_when_too_long():
    assert speed_factor(1.5, 2.0) == 1.0
    assert speed_factor(3.0, 2.0) == 1.5


def test_atempo_is_split_into_supported_steps():
    assert atempo_chain(1.25) == "atempo=1.2500"
    assert atempo_chain(3.0) == "atempo=2.0000,atempo=1.5000"


def test_each_cue_becomes_a_sentence_for_the_reading():
    assert as_sentence("Venez vite") == "Venez vite."
    assert as_sentence("Promo !") == "Promo !"


def test_words_of_the_single_reading_are_split_between_cues():
    words = [Word(t, i, i + 0.5) for i, t in enumerate(["Bonjour.", "Venez", "vite."])]
    groups = split_by_cue(words, ["Bonjour.", "Venez vite."])
    assert [[w.text for w in g] for g in groups] == [["Bonjour."], ["Venez", "vite."]]
    assert split_by_cue(words, ["Bonjour."]) is None


def test_reading_is_cut_inside_silences_not_on_word_bounds():
    # Whisper situe mal la fin de « Bonjour » (0,9 s) : la vraie parole finit à 1,05 s,
    # puis silence jusqu'à 1,6 s. La coupe tombe dans ce silence, sans rogner le mot.
    groups = [[Word("Bonjour.", 0.2, 0.9)], [Word("Venez", 1.7, 2.1), Word("vite.", 2.1, 2.6)]]
    silences = [(0.0, 0.15), (1.05, 1.6), (2.7, 3.0)]
    first, second = segments_from_reading(groups, silences, 3.0)
    assert first.source_start < 0.15 and 1.05 < first.source_end <= 1.2
    assert 1.45 <= second.source_start < 1.6 and second.source_end > 2.7
    assert first.source_end < second.source_start


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
