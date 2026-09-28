from app.align import Word
from app.quality import check_reading, cut_point, parse_silences, speech_bounds


def _heard(text: str) -> list[Word]:
    return [Word(t, i * 0.3, i * 0.3 + 0.25) for i, t in enumerate(text.split())]


def test_complete_reading_is_accepted():
    check = check_reading(
        "Découvrez nos nouveautés en magasin", _heard("découvrez nos nouveautés en magasin")
    )
    assert check.acceptable and check.coverage == 1.0


def test_truncated_ending_is_rejected():
    check = check_reading("Découvrez nos nouveautés en magasin", _heard("découvrez nos nouveautés"))
    assert not check.ending_ok and not check.acceptable


def test_instruction_read_aloud_is_rejected():
    heard = _heard("lis ce texte sur un ton dynamique découvrez nos nouveautés en magasin")
    assert not check_reading("Découvrez nos nouveautés en magasin", heard).acceptable


def test_silences_are_parsed_from_ffmpeg_log():
    log = (
        "[silencedetect] silence_start: 0\n[silencedetect] silence_end: 0.21 | silence_duration: 0.21\n"
        "[silencedetect] silence_start: 1.5\n"
    )
    assert parse_silences(log, 2.0) == [(0.0, 0.21), (1.5, 2.0)]


def test_speech_bounds_drop_leading_and_trailing_silence():
    start, end = speech_bounds([(0.0, 0.3), (1.5, 2.0)], 2.0, pad=0.1)
    assert round(start, 3) == 0.2 and round(end, 3) == 1.6


def test_cut_point_prefers_the_longest_nearby_silence():
    assert cut_point([(1.0, 1.1), (1.2, 1.8)], after=1.0, before=1.9) == 1.5
    assert cut_point([], after=1.0, before=2.0) == 1.5
