//! Découpage d'un texte en segments texte / emoji (ex-`twemoji-parser`).
//!
//! La table des caractères emoji est celle reconnue par twemoji-parser 14,
//! élargie au bloc « Symbols and Pictographs Extended-A » (emoji récents).

/// Segment d'une ligne : texte brut ou emoji (avec son URL Twemoji).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Segment {
    Text(String),
    Emoji { text: String, url: String },
}

/// Images Twemoji (fork maintenu, comme côté client).
const TWEMOJI_BASE: &str = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg/";

const ZWJ: char = '\u{200D}';
const VS16: char = '\u{FE0F}';
const KEYCAP: char = '\u{20E3}';

/// Caractères reconnus seuls comme emoji (sans sélecteur de variante).
const EMOJI_RANGES: &[(u32, u32)] = &[
    (0x203c, 0x203c),
    (0x2049, 0x2049),
    (0x2139, 0x2139),
    (0x2194, 0x2199),
    (0x21a9, 0x21aa),
    (0x231a, 0x231b),
    (0x2328, 0x2328),
    (0x23cf, 0x23cf),
    (0x23e9, 0x23f3),
    (0x23f8, 0x23fa),
    (0x24c2, 0x24c2),
    (0x25aa, 0x25ab),
    (0x25b6, 0x25b6),
    (0x25c0, 0x25c0),
    (0x25fb, 0x25fe),
    (0x2600, 0x2604),
    (0x260e, 0x260e),
    (0x2611, 0x2611),
    (0x2614, 0x2615),
    (0x2618, 0x2618),
    (0x261d, 0x261d),
    (0x2620, 0x2620),
    (0x2622, 0x2623),
    (0x2626, 0x2626),
    (0x262a, 0x262a),
    (0x262e, 0x262f),
    (0x2638, 0x263a),
    (0x2640, 0x2640),
    (0x2642, 0x2642),
    (0x2648, 0x2653),
    (0x2660, 0x2660),
    (0x2663, 0x2663),
    (0x2665, 0x2666),
    (0x2668, 0x2668),
    (0x267b, 0x267b),
    (0x267e, 0x267f),
    (0x2692, 0x2697),
    (0x2699, 0x2699),
    (0x269b, 0x269c),
    (0x26a0, 0x26a1),
    (0x26a7, 0x26a7),
    (0x26aa, 0x26ab),
    (0x26b0, 0x26b1),
    (0x26bd, 0x26be),
    (0x26c4, 0x26c5),
    (0x26c8, 0x26c8),
    (0x26ce, 0x26cf),
    (0x26d1, 0x26d1),
    (0x26d3, 0x26d4),
    (0x26e9, 0x26ea),
    (0x26f0, 0x26f5),
    (0x26f7, 0x26fa),
    (0x26fd, 0x26fd),
    (0x2702, 0x2702),
    (0x2705, 0x2705),
    (0x2708, 0x270d),
    (0x270f, 0x270f),
    (0x2712, 0x2712),
    (0x2714, 0x2714),
    (0x2716, 0x2716),
    (0x271d, 0x271d),
    (0x2721, 0x2721),
    (0x2728, 0x2728),
    (0x2733, 0x2734),
    (0x2744, 0x2744),
    (0x2747, 0x2747),
    (0x274c, 0x274c),
    (0x274e, 0x274e),
    (0x2753, 0x2755),
    (0x2757, 0x2757),
    (0x2763, 0x2764),
    (0x2795, 0x2797),
    (0x27a1, 0x27a1),
    (0x27b0, 0x27b0),
    (0x27bf, 0x27bf),
    (0x2934, 0x2935),
    (0x2b05, 0x2b07),
    (0x2b1b, 0x2b1c),
    (0x2b50, 0x2b50),
    (0x2b55, 0x2b55),
    (0x3030, 0x3030),
    (0x303d, 0x303d),
    (0x3297, 0x3297),
    (0x3299, 0x3299),
    (0x1f004, 0x1f004),
    (0x1f0cf, 0x1f0cf),
    (0x1f170, 0x1f171),
    (0x1f17e, 0x1f17f),
    (0x1f18e, 0x1f18e),
    (0x1f191, 0x1f19a),
    (0x1f1e6, 0x1f1ff),
    (0x1f201, 0x1f202),
    (0x1f21a, 0x1f21a),
    (0x1f22f, 0x1f22f),
    (0x1f232, 0x1f23a),
    (0x1f250, 0x1f251),
    (0x1f300, 0x1f321),
    (0x1f324, 0x1f393),
    (0x1f396, 0x1f397),
    (0x1f399, 0x1f39b),
    (0x1f39e, 0x1f3f0),
    (0x1f3f3, 0x1f3f5),
    (0x1f3f7, 0x1f4fd),
    (0x1f4ff, 0x1f53d),
    (0x1f549, 0x1f54e),
    (0x1f550, 0x1f567),
    (0x1f56f, 0x1f570),
    (0x1f573, 0x1f57a),
    (0x1f587, 0x1f587),
    (0x1f58a, 0x1f58d),
    (0x1f590, 0x1f590),
    (0x1f595, 0x1f596),
    (0x1f5a4, 0x1f5a5),
    (0x1f5a8, 0x1f5a8),
    (0x1f5b1, 0x1f5b2),
    (0x1f5bc, 0x1f5bc),
    (0x1f5c2, 0x1f5c4),
    (0x1f5d1, 0x1f5d3),
    (0x1f5dc, 0x1f5de),
    (0x1f5e1, 0x1f5e1),
    (0x1f5e3, 0x1f5e3),
    (0x1f5e8, 0x1f5e8),
    (0x1f5ef, 0x1f5ef),
    (0x1f5f3, 0x1f5f3),
    (0x1f5fa, 0x1f64f),
    (0x1f680, 0x1f6c5),
    (0x1f6cb, 0x1f6d2),
    (0x1f6d5, 0x1f6d7),
    (0x1f6dc, 0x1f6e5),
    (0x1f6e9, 0x1f6e9),
    (0x1f6eb, 0x1f6ec),
    (0x1f6f0, 0x1f6f0),
    (0x1f6f3, 0x1f6fc),
    (0x1f7e0, 0x1f7eb),
    (0x1f7f0, 0x1f7f0),
    (0x1f90c, 0x1f93a),
    (0x1f93c, 0x1f945),
    (0x1f947, 0x1f9ff),
    (0x1fa70, 0x1faff),
];

/// Caractères qui ne sont des emoji que suivis de U+FE0F (©, ®, ™, ♟).
const VS16_ONLY: &[u32] = &[0xa9, 0xae, 0x2122, 0x265f];

fn in_table(c: char) -> bool {
    let cp = c as u32;
    EMOJI_RANGES
        .binary_search_by(|&(start, end)| {
            if cp < start {
                std::cmp::Ordering::Greater
            } else if cp > end {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Equal
            }
        })
        .is_ok()
}

fn is_regional_indicator(c: char) -> bool {
    ('\u{1F1E6}'..='\u{1F1FF}').contains(&c)
}

fn is_skin_tone(c: char) -> bool {
    ('\u{1F3FB}'..='\u{1F3FF}').contains(&c)
}

fn is_tag(c: char) -> bool {
    ('\u{E0020}'..='\u{E007E}').contains(&c)
}

fn is_keycap_base(c: char) -> bool {
    c.is_ascii_digit() || c == '#' || c == '*'
}

/// Longueur (en caractères) d'un élément emoji commençant à `i`, sans les
/// jonctions ZWJ : base, sélecteur, teinte de peau, drapeau, séquence de tags.
fn element_len(chars: &[char], i: usize) -> usize {
    let c = chars[i];
    let next = |k: usize| chars.get(i + k).copied();

    // Keycaps : 1⃣, 1️⃣, #️⃣…
    if is_keycap_base(c) {
        return match (next(1), next(2)) {
            (Some(KEYCAP), _) => 2,
            (Some(VS16), Some(KEYCAP)) => 3,
            _ => 0,
        };
    }
    if VS16_ONLY.contains(&(c as u32)) {
        return if next(1) == Some(VS16) { 2 } else { 0 };
    }
    if !in_table(c) {
        return 0;
    }
    // Drapeaux : deux indicateurs régionaux
    if is_regional_indicator(c) {
        return if next(1).is_some_and(is_regional_indicator) {
            2
        } else {
            1
        };
    }

    let mut len = 1;
    if next(len) == Some(VS16) {
        len += 1;
    }
    if next(len).is_some_and(is_skin_tone) {
        len += 1;
    }
    // Drapeaux de subdivisions (🏴 + tags + U+E007F)
    if c == '\u{1F3F4}' && next(len).is_some_and(is_tag) {
        let mut k = len;
        while next(k).is_some_and(is_tag) {
            k += 1;
        }
        if next(k) == Some('\u{E007F}') {
            len = k + 1;
        }
    }
    len
}

/// Longueur d'une séquence emoji complète (éléments reliés par ZWJ).
fn emoji_len(chars: &[char], start: usize) -> usize {
    let mut len = element_len(chars, start);
    if len == 0 {
        return 0;
    }
    while chars.get(start + len) == Some(&ZWJ) && start + len + 1 < chars.len() {
        let next = element_len(chars, start + len + 1);
        if next == 0 {
            break;
        }
        len += 1 + next;
    }
    len
}

/// Nom du fichier Twemoji : points de code en hexadécimal séparés par « - »,
/// sans U+FE0F sauf dans les séquences ZWJ (comme twemoji-parser).
pub fn codepoints(emoji: &str) -> String {
    let keep_vs16 = emoji.contains(ZWJ);
    emoji
        .chars()
        .filter(|c| keep_vs16 || *c != VS16)
        .map(|c| format!("{:x}", c as u32))
        .collect::<Vec<_>>()
        .join("-")
}

pub fn twemoji_url(emoji: &str) -> String {
    format!("{TWEMOJI_BASE}{}.svg", codepoints(emoji))
}

/// Découpe le texte en segments texte / emoji.
pub fn parse(text: &str) -> Vec<Segment> {
    let chars: Vec<char> = text.chars().collect();
    let mut segments = Vec::new();
    let mut current = String::new();
    let mut i = 0;

    while i < chars.len() {
        let len = emoji_len(&chars, i);
        if len > 0 {
            if !current.is_empty() {
                segments.push(Segment::Text(std::mem::take(&mut current)));
            }
            let emoji: String = chars[i..i + len].iter().collect();
            segments.push(Segment::Emoji {
                url: twemoji_url(&emoji),
                text: emoji,
            });
            i += len;
        } else {
            // Un U+FE0F isolé n'a pas d'image : on l'ignore
            if chars[i] != VS16 {
                current.push(chars[i]);
            }
            i += 1;
        }
    }
    if !current.is_empty() {
        segments.push(Segment::Text(current));
    }
    segments
}

#[cfg(test)]
mod tests {
    use super::*;

    fn emojis(text: &str) -> Vec<String> {
        parse(text)
            .into_iter()
            .filter_map(|s| match s {
                Segment::Emoji { url, .. } => {
                    Some(url.trim_start_matches(TWEMOJI_BASE).to_string())
                }
                Segment::Text(_) => None,
            })
            .collect()
    }

    #[test]
    fn plain_text_is_one_segment() {
        assert_eq!(
            parse("Bonjour à tous"),
            vec![Segment::Text("Bonjour à tous".into())]
        );
        assert!(parse("").is_empty());
        // © ® ™ sans sélecteur, chiffres seuls : pas des emoji
        assert!(emojis("© ® ™ 123 #1 *").is_empty());
    }

    #[test]
    fn segments_keep_surrounding_text() {
        assert_eq!(
            parse("Promo 🔥 ici"),
            vec![
                Segment::Text("Promo ".into()),
                Segment::Emoji {
                    text: "🔥".into(),
                    url: format!("{TWEMOJI_BASE}1f525.svg")
                },
                Segment::Text(" ici".into()),
            ]
        );
    }

    // Valeurs attendues relevées avec twemoji-parser 14
    #[test]
    fn matches_twemoji_parser() {
        assert_eq!(
            emojis("©️ ❤ ❤️ ☀"),
            vec!["a9.svg", "2764.svg", "2764.svg", "2600.svg"]
        );
        assert_eq!(
            emojis("1️⃣ 1⃣ #️⃣ *️⃣"),
            vec!["31-20e3.svg", "31-20e3.svg", "23-20e3.svg", "2a-20e3.svg"]
        );
        assert_eq!(emojis("🇫🇷 🇫"), vec!["1f1eb-1f1f7.svg", "1f1eb.svg"]);
        assert_eq!(emojis("👍🏽"), vec!["1f44d-1f3fd.svg"]);
        assert_eq!(emojis("👨‍👩‍👧"), vec!["1f468-200d-1f469-200d-1f467.svg"]);
        assert_eq!(emojis("🏳️‍🌈"), vec!["1f3f3-fe0f-200d-1f308.svg"]);
        assert_eq!(emojis("❤️‍🔥"), vec!["2764-fe0f-200d-1f525.svg"]);
        assert_eq!(
            emojis("👩🏻‍❤️‍👨🏼"),
            vec!["1f469-1f3fb-200d-2764-fe0f-200d-1f468-1f3fc.svg"]
        );
        assert_eq!(
            emojis("🏴󠁧󠁢󠁳󠁣󠁴󠁿"),
            vec!["1f3f4-e0067-e0062-e0073-e0063-e0074-e007f.svg"]
        );
        assert_eq!(
            emojis("😀🎉✨⭐✅"),
            vec!["1f600.svg", "1f389.svg", "2728.svg", "2b50.svg", "2705.svg"]
        );
    }

    #[test]
    fn stray_variation_selector_is_dropped() {
        assert_eq!(parse("a\u{FE0F}b"), vec![Segment::Text("ab".into())]);
    }
}
