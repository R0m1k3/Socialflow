from app.align import Word, align_words, display_tokens, normalize


def test_normalize_strips_accents_and_punctuation():
    assert normalize("Été,") == "ete"
    assert normalize("«") == ""


def test_display_tokens_attach_isolated_punctuation():
    assert display_tokens("Bonjour ! Venez vite .") == ["Bonjour!", "Venez", "vite."]


def test_align_uses_engine_timings_and_keeps_display_text():
    spoken = [Word("Bonjour", 0.05, 0.6), Word("découvrez", 0.99, 1.35), Word("nos", 1.35, 1.44)]
    words = align_words("Bonjour, découvrez nos", spoken)
    assert [w.text for w in words] == ["Bonjour,", "découvrez", "nos"]
    assert words[1].start == 0.99


def test_unmatched_words_are_interpolated_between_neighbours():
    spoken = [Word("les", 0.0, 0.2), Word("prix", 1.0, 1.3)]
    words = align_words("les super promos prix", spoken)
    assert [w.text for w in words] == ["les", "super", "promos", "prix"]
    assert 0.2 <= words[1].start < words[2].start < 1.0
    assert all(b.start > a.start for a, b in zip(words, words[1:]))


def test_without_spoken_words_text_is_spread_over_duration():
    words = align_words("un deux trois", [], total_duration=3.0)
    assert words[0].start == 0.0
    assert abs(words[-1].end - 3.0) < 1e-6
