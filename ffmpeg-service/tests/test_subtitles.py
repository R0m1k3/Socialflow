from app.align import Word
from app.subtitles import ass_time, group_lines, write_captions


def test_ass_time_format():
    assert ass_time(0) == "0:00:00.00"
    assert ass_time(61.234) == "0:01:01.23"


def test_lines_break_on_punctuation_and_length():
    words = [Word(t, i, i + 0.5) for i, t in enumerate("Bonjour, venez découvrir nos nouveautés".split())]
    lines = group_lines(words)
    assert [w.text for w in lines[0]] == ["Bonjour,"]
    assert all(len(line) <= 3 for line in lines)


def test_captions_are_offset_and_escape_braces(tmp_path):
    path = tmp_path / "c.ass"
    write_captions([Word("{prix}", 0.0, 0.5), Word("fous", 0.5, 1.0)], path, offset=2.0, font_size=80)
    content = path.read_text()
    assert "Dialogue: 0,0:00:02.00," in content
    assert "{prix}" not in content.split("[Events]")[1].replace("{\\", "")
    assert "(prix)" in content
