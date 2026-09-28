import numpy as np

from app.align import Word
from app.quality import FRAME, Envelope, check_reading, envelope_from_samples, sentence_cut


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


def _envelope(levels):
    """Enveloppe synthétique : liste de (durée en s, niveau en dB)."""
    db = []
    for seconds, level in levels:
        db += [level] * int(round(seconds / FRAME))
    return Envelope(np.array(db, dtype=float))


def test_soft_sentence_endings_are_kept():
    # Parole à -20 dB, fin de phrase douce à -50 dB (relatif : -30 dB, audible),
    # puis vrai silence à -90 dB
    env = _envelope([(0.2, -90), (1.0, -20), (0.3, -50), (0.6, -90)])
    start, end = env.speech_span(0.0, env.duration)
    assert round(start, 2) == 0.12  # 80 ms avant la parole
    assert round(end, 2) == 1.8  # 300 ms après la fin douce (à 1,5 s)


def test_cut_falls_in_the_quietest_part_of_the_pause():
    env = _envelope([(1.0, -20), (0.15, -60), (0.2, -85), (0.15, -60), (1.0, -20)])
    cut = sentence_cut(env, previous_end=0.95, next_start=1.55)
    assert 1.15 <= cut <= 1.35


def test_envelope_from_samples_measures_level():
    rate = 16000
    samples = np.concatenate([np.zeros(rate // 2), 0.5 * np.ones(rate // 2)]).astype(np.float32)
    env = envelope_from_samples(samples, rate)
    assert env.db[0] < -100 and abs(env.db[-1] - 20 * np.log10(0.5)) < 0.1


def test_small_recognition_errors_are_not_missing_words():
    expected = "Découvrez nos plantes de saison à petits prix. On vous attend ce week-end."
    heard = _heard("Découvrez nos plans de saison à petit prix. On vous attend ce week -end.")
    check = check_reading(expected, heard)
    assert check.acceptable, check


def test_skipped_words_are_detected_and_named():
    expected = (
        "Pour Halloween découvrez nos costumes nos bonbons et toute notre décoration effrayante en magasin."
    )
    heard = _heard("Pour Halloween découvrez nos costumes et toute notre décoration en magasin.")
    check = check_reading(expected, heard)
    assert not check.acceptable
    assert "bonbons" in check.missing and "effrayante" in check.missing
    assert "non entendus" in check.describe()
