"""Sous-titres ASS : mot à mot, style « Reels » lisible sur tout fond."""

from pathlib import Path

from . import config
from .align import Word

# Couleurs ASS au format &HAABBGGRR
YELLOW = "&H0000E6FF"
WHITE = "&H00FFFFFF"
BLACK = "&H00000000"
SHADOW = "&H64000000"

# Au-delà, une ligne déborde ou se lit mal en un coup d'œil
MAX_WORDS_PER_LINE = 3
MAX_CHARS_PER_LINE = 18
# Bas du texte à ~70 % de la hauteur : au-dessus de la légende et des boutons
# qu'Instagram et TikTok superposent en bas de l'écran.
MARGIN_V = 560
POP_MS = 90


def ass_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    centis = int(round(seconds * 100))
    hours, centis = divmod(centis, 360000)
    minutes, centis = divmod(centis, 6000)
    secs, centis = divmod(centis, 100)
    return f"{hours}:{minutes:02d}:{secs:02d}.{centis:02d}"


def escape(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")")


def header(styles: list[str]) -> str:
    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {config.WIDTH}\n"
        f"PlayResY: {config.HEIGHT}\n"
        "ScaledBorderAndShadow: yes\n"
        "WrapStyle: 2\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        + "".join(f"{s}\n" for s in styles)
        + "\n[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )


def group_lines(words: list[Word]) -> list[list[Word]]:
    """Découpe en lignes courtes, coupées de préférence à la ponctuation."""
    lines: list[list[Word]] = []
    current: list[Word] = []
    for word in words:
        chars = sum(len(w.text) + 1 for w in current) + len(word.text)
        if current and (len(current) >= MAX_WORDS_PER_LINE or chars > MAX_CHARS_PER_LINE):
            lines.append(current)
            current = []
        current.append(word)
        if word.text.endswith((".", "!", "?", ",", ":", ";", "…")):
            lines.append(current)
            current = []
    if current:
        lines.append(current)
    return lines


def karaoke_line(line: list[Word], line_end: float) -> str:
    """Chaque mot passe du blanc au jaune et « saute » légèrement quand il est dit."""
    parts = []
    line_start = line[0].start
    for index, word in enumerate(line):
        next_start = line[index + 1].start if index + 1 < len(line) else line_end
        fill_cs = max(1, int(round((next_start - word.start) * 100)))
        t0 = int(round((word.start - line_start) * 1000))
        pop = (
            f"\\fscx100\\fscy100"
            f"\\t({t0},{t0 + POP_MS},\\fscx112\\fscy112)"
            f"\\t({t0 + POP_MS},{t0 + 2 * POP_MS},\\fscx100\\fscy100)"
        )
        parts.append(f"{{\\kf{fill_cs}{pop}}}{escape(word.text)}")
    return " ".join(parts)


def write_captions(
    words: list[Word], path: Path, *, offset: float, font_size: int, end_time: float | None = None
) -> None:
    """Écrit le fichier ASS des sous-titres, décalés de `offset` secondes."""
    style = (
        f"Style: Caption,{config.SUBTITLE_FONT},{font_size},{YELLOW},{WHITE},{BLACK},{SHADOW},"
        f"-1,0,0,0,100,100,0,0,1,6,3,2,80,80,{MARGIN_V},1"
    )
    lines = group_lines(words)
    events = []
    for index, line in enumerate(lines):
        start = line[0].start
        natural_end = line[-1].end + 0.25
        if index + 1 < len(lines):
            end = min(max(natural_end, line[-1].end), lines[index + 1][0].start)
        else:
            end = max(natural_end, end_time - offset if end_time else natural_end)
        end = max(end, start + 0.3)
        events.append(
            f"Dialogue: 0,{ass_time(start + offset)},{ass_time(end + offset)},Caption,,0,0,0,,"
            f"{karaoke_line(line, end)}"
        )
    path.write_text(header([style]) + "\n".join(events) + "\n", encoding="utf-8")


def write_outro(store_name: str, path: Path, start: float, end: float) -> None:
    """Nom du magasin sous le logo, en fondu, pendant les dernières secondes."""
    style = (
        f"Style: Outro,{config.SUBTITLE_FONT},72,{WHITE},{WHITE},{BLACK},{SHADOW},"
        "-1,0,0,0,100,100,0,0,1,3,4,2,60,60,700,1"
    )
    event = (
        f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Outro,,0,0,0,,{{\\fad(1200,0)}}{escape(store_name)}"
    )
    path.write_text(header([style]) + event + "\n", encoding="utf-8")


def filter_path(path: Path) -> str:
    """Chemin utilisable dans un filtre FFmpeg (échappement de : et ')."""
    return str(path).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
