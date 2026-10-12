//! Image de story avec le texte du post incrusté (ex-`imageProcessor.addTextToStoryImage`
//! et `emojiRenderer.ts`).
//!
//! L'image est recadrée en 1080×1920 (« cover »), un bandeau noir translucide
//! occupe le quart inférieur et le texte (sans hashtags) y est centré, en gras,
//! avec une taille de police dégressive de 72 px à 12 px pour tenir dans le
//! bandeau. Les emoji sont dessinés avec les images Twemoji.
//!
//! Rendu : composition de l'image avec `image`, bandeau avec `tiny-skia`,
//! texte et emoji via un SVG rendu par `resvg` (police DejaVu Sans). Les
//! largeurs sont mesurées avec `harfrust` (mise en forme avec crénage, comme
//! le `measureText` de node-canvas).

use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use anyhow::{anyhow, Context};
use base64::Engine;
use bytes::Bytes;
use image::{ImageDecoder, ImageReader, Rgba, RgbaImage};
use once_cell::sync::Lazy;
use regex::Regex;
use resvg::{tiny_skia, usvg};

use super::emoji::{self, Segment};
use crate::state::AppState;

const STORY_WIDTH: u32 = 1080;
const STORY_HEIGHT: u32 = 1920;
const TEXT_BOX_HEIGHT_RATIO: f32 = 0.25;
const MIN_FONT_SIZE: f32 = 12.0;
const MAX_FONT_SIZE: f32 = 72.0;
const PADDING: f32 = 40.0;
const LINE_HEIGHT_MULTIPLIER: f32 = 1.3;
const FONT_FAMILY: &str = "DejaVu Sans";

/// Retire les hashtags en gardant les emoji (ex-`removeHashtags` de `shared/emoji.ts`).
pub fn remove_hashtags(text: &str) -> String {
    static HASHTAG: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"#[A-Za-z0-9_\x{00C0}-\x{017F}]+").expect("regex valide"));
    static SPACES: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+").expect("regex valide"));
    let without = HASHTAG.replace_all(text, "");
    SPACES.replace_all(&without, " ").trim().to_string()
}

// ----------------------------------------------------------------------
// Découpage en lignes (logique pure, indépendante de la police)
// ----------------------------------------------------------------------

/// Découpe un mot trop long en morceaux tenant dans `max_width`.
fn break_long_word(
    word: &str,
    max_width: f32,
    measure: &mut impl FnMut(&str) -> f32,
) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for ch in word.chars() {
        let mut test = current.clone();
        test.push(ch);
        if measure(&test) > max_width && !current.is_empty() {
            chunks.push(std::mem::replace(&mut current, ch.to_string()));
        } else {
            current = test;
        }
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

/// Répartit le texte en lignes de largeur maximale `max_width` (mots séparés
/// par des espaces ; un mot trop long est coupé).
pub fn wrap_text(text: &str, max_width: f32, measure: &mut impl FnMut(&str) -> f32) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();

    for word in text.split(' ') {
        let test = if current.is_empty() {
            word.to_string()
        } else {
            format!("{current} {word}")
        };
        let width = measure(&test);

        if width > max_width && !current.is_empty() {
            // La ligne déborderait : on la pousse et on repart de ce mot
            lines.push(std::mem::replace(&mut current, word.to_string()));
            if measure(word) > max_width {
                let mut chunks = break_long_word(word, max_width, measure);
                current = chunks.pop().unwrap_or_default();
                lines.extend(chunks);
            }
        } else if width > max_width {
            // Premier mot déjà trop long
            let mut chunks = break_long_word(word, max_width, measure);
            current = chunks.pop().unwrap_or_default();
            lines.extend(chunks);
        } else {
            current = test;
        }
    }

    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

/// Taille de police et lignes retenues pour tenir dans `max_height`.
/// `measure(texte, taille)` donne la largeur d'une ligne.
pub fn fit_text(
    text: &str,
    max_width: f32,
    max_height: f32,
    measure: &mut impl FnMut(&str, f32) -> f32,
) -> (f32, Vec<String>, f32) {
    let mut font_size = MAX_FONT_SIZE;
    let mut lines = Vec::new();
    let mut total_height = 0.0;

    while font_size >= MIN_FONT_SIZE {
        lines = wrap_text(text, max_width, &mut |t| measure(t, font_size));
        total_height = lines.len() as f32 * font_size * LINE_HEIGHT_MULTIPLIER;
        if total_height <= max_height {
            break;
        }
        font_size -= 2.0;
    }

    if font_size < MIN_FONT_SIZE {
        font_size = MIN_FONT_SIZE;
        lines = wrap_text(text, max_width, &mut |t| measure(t, font_size));
        let line_height = font_size * LINE_HEIGHT_MULTIPLIER;
        total_height = lines.len() as f32 * line_height;

        let max_lines = (max_height / line_height).floor() as usize;
        if lines.len() > max_lines {
            lines.truncate(max_lines);
            if let Some(last) = lines.last_mut().filter(|l| !l.is_empty()) {
                let keep = last.chars().count().saturating_sub(3);
                *last = format!("{}...", last.chars().take(keep).collect::<String>());
            }
            total_height = max_lines as f32 * line_height;
        }
    }

    (font_size, lines, total_height)
}

/// Placement « cover » de l'image : (largeur, hauteur, x, y) dans la story.
pub fn cover_rect(width: u32, height: u32) -> (f32, f32, f32, f32) {
    let (sw, sh) = (STORY_WIDTH as f32, STORY_HEIGHT as f32);
    let (w, h) = (width as f32, height as f32);
    if w / h > sw / sh {
        let draw_width = w * (sh / h);
        (draw_width, sh, (sw - draw_width) / 2.0, 0.0)
    } else {
        let draw_height = h * (sw / w);
        (sw, draw_height, 0.0, (sh - draw_height) / 2.0)
    }
}

// ----------------------------------------------------------------------
// Police
// ----------------------------------------------------------------------

struct StoryFont {
    data: Arc<Vec<u8>>,
    fontdb: Arc<usvg::fontdb::Database>,
    units_per_em: f32,
    ascent: f32,
    descent: f32,
    /// Pas de DejaVu Sans Bold disponible : gras simulé par un contour.
    faux_bold: bool,
}

const SYSTEM_FONT_DIRS: &[&str] = &[
    "/usr/share/fonts/truetype/dejavu",
    "/usr/share/fonts/TTF",
    "/usr/share/fonts/dejavu",
];

fn find_font(fonts_dir: &Path, file: &str) -> Option<PathBuf> {
    std::iter::once(fonts_dir.to_path_buf())
        .chain(SYSTEM_FONT_DIRS.iter().map(PathBuf::from))
        .map(|dir| dir.join(file))
        .find(|p| p.is_file())
}

impl StoryFont {
    fn load(fonts_dir: &Path) -> anyhow::Result<Self> {
        // Le texte est en gras : node-canvas prenait DejaVu Sans Bold sur le
        // système (paquet fonts-dejavu-core), à défaut la police normale.
        let (path, faux_bold) = match find_font(fonts_dir, "DejaVuSans-Bold.ttf") {
            Some(path) => (path, false),
            None => (
                find_font(fonts_dir, "DejaVuSans.ttf").ok_or_else(|| {
                    anyhow!(
                        "Police DejaVuSans.ttf introuvable dans {}",
                        fonts_dir.display()
                    )
                })?,
                true,
            ),
        };
        let data =
            std::fs::read(&path).with_context(|| format!("lecture de {}", path.display()))?;

        let (units_per_em, ascent, descent) = {
            use skrifa::instance::{LocationRef, Size};
            use skrifa::MetadataProvider;
            let font = skrifa::FontRef::new(&data).map_err(|e| anyhow!("police invalide : {e}"))?;
            let metrics = font.metrics(Size::unscaled(), LocationRef::default());
            (
                metrics.units_per_em as f32,
                metrics.ascent,
                -metrics.descent,
            )
        };

        let mut db = usvg::fontdb::Database::new();
        db.load_font_data(data.clone());
        tracing::info!("✓ Police {} chargée pour les stories", path.display());

        Ok(Self {
            data: Arc::new(data),
            fontdb: Arc::new(db),
            units_per_em,
            ascent,
            descent,
            faux_bold,
        })
    }
}

fn story_font(fonts_dir: &Path) -> anyhow::Result<&'static StoryFont> {
    static FONT: OnceLock<Result<StoryFont, String>> = OnceLock::new();
    FONT.get_or_init(|| StoryFont::load(fonts_dir).map_err(|e| format!("{e:#}")))
        .as_ref()
        .map_err(|e| anyhow!("{e}"))
}

/// Mesure des textes : largeur en unités de police, mise en cache.
struct TextMeasurer<'a> {
    font: harfrust::FontRef<'a>,
    shaper_data: harfrust::ShaperData,
    units_per_em: f32,
    cache: HashMap<String, f32>,
}

impl<'a> TextMeasurer<'a> {
    fn new(font: &'a StoryFont) -> anyhow::Result<Self> {
        let font_ref =
            harfrust::FontRef::new(&font.data).map_err(|e| anyhow!("police invalide : {e}"))?;
        let shaper_data = harfrust::ShaperData::new(&font_ref);
        Ok(Self {
            font: font_ref,
            shaper_data,
            units_per_em: font.units_per_em,
            cache: HashMap::new(),
        })
    }

    /// Largeur d'un texte sans emoji, en pixels.
    fn text_width(&mut self, text: &str, font_size: f32) -> f32 {
        if text.is_empty() {
            return 0.0;
        }
        let units = match self.cache.get(text) {
            Some(units) => *units,
            None => {
                let shaper = self.shaper_data.shaper(&self.font).build();
                let mut buffer = harfrust::UnicodeBuffer::new();
                buffer.push_str(text);
                buffer.guess_segment_properties();
                let output = shaper.shape(buffer, harfrust::ShapeOptions::new());
                let units: i32 = output.glyph_positions().iter().map(|p| p.x_advance).sum();
                self.cache.insert(text.to_string(), units as f32);
                units as f32
            }
        };
        units * font_size / self.units_per_em
    }

    /// Largeur d'une ligne : un emoji compte pour la taille de police.
    fn line_width(&mut self, line: &str, font_size: f32) -> f32 {
        emoji::parse(line)
            .iter()
            .map(|segment| match segment {
                Segment::Text(text) => self.text_width(text, font_size),
                Segment::Emoji { .. } => font_size,
            })
            .sum()
    }
}

// ----------------------------------------------------------------------
// Emoji (Twemoji)
// ----------------------------------------------------------------------

static EMOJI_CACHE: Lazy<Mutex<HashMap<String, Bytes>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// Télécharge (et met en cache) l'image SVG d'un emoji.
async fn emoji_image(state: &AppState, url: &str) -> anyhow::Result<Bytes> {
    if let Some(data) = EMOJI_CACHE.lock().ok().and_then(|c| c.get(url).cloned()) {
        return Ok(data);
    }
    let response = state
        .http
        .get(url)
        .timeout(Duration::from_secs(15))
        .send()
        .await?;
    if !response.status().is_success() {
        anyhow::bail!("Failed to fetch emoji: {}", response.status());
    }
    let data = response.bytes().await?;
    if let Ok(mut cache) = EMOJI_CACHE.lock() {
        cache.insert(url.to_string(), data.clone());
    }
    Ok(data)
}

/// Vide le cache des emoji.
pub fn clear_emoji_cache() {
    if let Ok(mut cache) = EMOJI_CACHE.lock() {
        cache.clear();
    }
}

// ----------------------------------------------------------------------
// Rendu
// ----------------------------------------------------------------------

/// Télécharge l'image puis incruste le texte ; renvoie un PNG.
pub async fn add_text_to_story_image(
    state: &AppState,
    image_url: &str,
    text: &str,
) -> anyhow::Result<Vec<u8>> {
    let response = state.http.get(image_url).send().await?;
    if !response.status().is_success() {
        anyhow::bail!("Failed to fetch image from URL: {image_url}");
    }
    let image = response.bytes().await?;
    render_story_image(state, image, text).await
}

/// Incruste le texte dans l'image fournie ; renvoie un PNG 1080×1920.
pub async fn render_story_image(
    state: &AppState,
    image: Bytes,
    text: &str,
) -> anyhow::Result<Vec<u8>> {
    let clean_text = remove_hashtags(text);

    // Les emoji sont téléchargés avant le rendu (qui est synchrone)
    let mut emoji_images: HashMap<String, Bytes> = HashMap::new();
    for segment in emoji::parse(&clean_text) {
        if let Segment::Emoji { url, .. } = segment {
            if emoji_images.contains_key(&url) {
                continue;
            }
            match emoji_image(state, &url).await {
                Ok(data) => {
                    emoji_images.insert(url, data);
                }
                Err(error) => tracing::error!("Error downloading emoji from {url}: {error}"),
            }
        }
    }

    let fonts_dir = state.config.fonts_dir.clone();
    tokio::task::spawn_blocking(move || {
        let font = story_font(&fonts_dir)?;
        compose(&image, &clean_text, font, &emoji_images)
    })
    .await?
}

fn decode_oriented(data: &[u8]) -> anyhow::Result<image::DynamicImage> {
    let reader = ImageReader::new(Cursor::new(data)).with_guessed_format()?;
    let mut decoder = reader.into_decoder()?;
    // Rotation EXIF appliquée, comme `sharp().rotate()`
    let orientation = decoder.orientation()?;
    let mut image = image::DynamicImage::from_decoder(decoder)?;
    image.apply_orientation(orientation);
    Ok(image)
}

fn compose(
    image_data: &[u8],
    text: &str,
    font: &StoryFont,
    emoji_images: &HashMap<String, Bytes>,
) -> anyhow::Result<Vec<u8>> {
    let image = decode_oriented(image_data)?;
    if image.width() == 0 || image.height() == 0 {
        anyhow::bail!("image vide");
    }

    // 1. Fond noir + image en « cover »
    let (draw_width, draw_height, offset_x, offset_y) = cover_rect(image.width(), image.height());
    let resized = image
        .resize_exact(
            draw_width.round().max(1.0) as u32,
            draw_height.round().max(1.0) as u32,
            image::imageops::FilterType::CatmullRom,
        )
        .to_rgba8();
    let mut canvas = RgbaImage::from_pixel(STORY_WIDTH, STORY_HEIGHT, Rgba([0, 0, 0, 255]));
    image::imageops::overlay(
        &mut canvas,
        &resized,
        offset_x.round() as i64,
        offset_y.round() as i64,
    );

    // Fond opaque : les pixels sont déjà « prémultipliés »
    let size = tiny_skia::IntSize::from_wh(STORY_WIDTH, STORY_HEIGHT)
        .ok_or_else(|| anyhow!("taille invalide"))?;
    let mut pixmap = tiny_skia::Pixmap::from_vec(canvas.into_raw(), size)
        .ok_or_else(|| anyhow!("pixmap invalide"))?;

    // 2. Bandeau translucide
    let text_box_height = STORY_HEIGHT as f32 * TEXT_BOX_HEIGHT_RATIO;
    let text_box_y = STORY_HEIGHT as f32 - text_box_height;
    let mut paint = tiny_skia::Paint::default();
    paint.set_color_rgba8(0, 0, 0, 153);
    if let Some(rect) =
        tiny_skia::Rect::from_xywh(0.0, text_box_y, STORY_WIDTH as f32, text_box_height)
    {
        pixmap.fill_rect(rect, &paint, tiny_skia::Transform::identity(), None);
    }

    // 3. Texte
    let max_text_width = STORY_WIDTH as f32 - PADDING * 2.0;
    let max_text_height = text_box_height - PADDING * 2.0;
    let mut measurer = TextMeasurer::new(font)?;
    let (font_size, lines, total_height) =
        fit_text(text, max_text_width, max_text_height, &mut |t, size| {
            measurer.line_width(t, size)
        });

    // Emoji utilisables (SVG valide)
    let valid_emoji: HashMap<&str, String> = emoji_images
        .iter()
        .filter(|(_, data)| usvg::Tree::from_data(data, &usvg::Options::default()).is_ok())
        .map(|(url, data)| {
            let uri = format!(
                "data:image/svg+xml;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(data)
            );
            (url.as_str(), uri)
        })
        .collect();

    let line_height = font_size * LINE_HEIGHT_MULTIPLIER;
    let start_y = text_box_y + (text_box_height - total_height) / 2.0 + line_height / 2.0;
    // `textBaseline = 'middle'` : milieu entre le haut et le bas de la police
    let baseline_shift = (font.ascent - font.descent) / 2.0 / font.units_per_em * font_size;

    let mut svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{STORY_WIDTH}" height="{STORY_HEIGHT}" viewBox="0 0 {STORY_WIDTH} {STORY_HEIGHT}">"#
    );
    let text_attrs = if font.faux_bold {
        format!(
            r#" stroke="white" stroke-width="{:.2}" stroke-linejoin="round""#,
            font_size / 24.0
        )
    } else {
        String::new()
    };

    for (index, line) in lines.iter().enumerate() {
        let y = start_y + index as f32 * line_height;
        let line_width = measurer.line_width(line, font_size);
        let mut x = (STORY_WIDTH as f32 - line_width) / 2.0;

        for segment in emoji::parse(line) {
            let fallback_text = match &segment {
                Segment::Text(text) => Some(text.clone()),
                Segment::Emoji { text, url } => match valid_emoji.get(url.as_str()) {
                    Some(uri) => {
                        // Emoji légèrement au-dessus de la ligne de base
                        svg.push_str(&format!(
                            r#"<image x="{x:.2}" y="{:.2}" width="{font_size}" height="{font_size}" xlink:href="{uri}"/>"#,
                            y - font_size * 0.8
                        ));
                        x += font_size;
                        None
                    }
                    // Image indisponible : on écrit le caractère
                    None => Some(text.clone()),
                },
            };
            if let Some(text) = fallback_text {
                svg.push_str(&format!(
                    r#"<text x="{x:.2}" y="{:.2}" font-family="{FONT_FAMILY}" font-weight="bold" font-size="{font_size}" fill="white"{text_attrs} xml:space="preserve">{}</text>"#,
                    y + baseline_shift,
                    xml_escape(&text)
                ));
                x += measurer.text_width(&text, font_size);
            }
        }
    }
    svg.push_str("</svg>");

    let options = usvg::Options {
        font_family: FONT_FAMILY.to_string(),
        fontdb: font.fontdb.clone(),
        ..usvg::Options::default()
    };
    let tree =
        usvg::Tree::from_str(&svg, &options).map_err(|e| anyhow!("SVG du texte invalide : {e}"))?;
    resvg::render(
        &tree,
        tiny_skia::Transform::identity(),
        &mut pixmap.as_mut(),
    );

    pixmap
        .encode_png()
        .map_err(|e| anyhow!("encodage PNG : {e}"))
}

fn xml_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            // Caractères de contrôle interdits en XML
            c if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') => {}
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Mesure factice : 10 px par caractère.
    fn fixed(text: &str) -> f32 {
        text.chars().count() as f32 * 10.0
    }

    #[test]
    fn hashtags_are_removed() {
        assert_eq!(
            remove_hashtags("Promo #soldes été #Été2024 ! 🔥"),
            "Promo été ! 🔥"
        );
        assert_eq!(remove_hashtags("  a\n\n b\tc  "), "a b c");
        assert_eq!(remove_hashtags("#seul"), "");
    }

    #[test]
    fn wrap_keeps_words_together() {
        let lines = wrap_text("aaa bbb ccc dd", 70.0, &mut fixed);
        assert_eq!(lines, vec!["aaa bbb", "ccc dd"]);
    }

    #[test]
    fn wrap_breaks_long_words() {
        // Premier mot trop long
        assert_eq!(
            wrap_text("abcdefghij", 40.0, &mut fixed),
            vec!["abcd", "efgh", "ij"]
        );
        // Mot trop long après une ligne existante
        assert_eq!(
            wrap_text("ab abcdefghij x", 40.0, &mut fixed),
            vec!["ab", "abcd", "efgh", "ij x"]
        );
    }

    #[test]
    fn wrap_empty_text() {
        assert!(wrap_text("", 100.0, &mut fixed).is_empty());
    }

    #[test]
    fn font_shrinks_until_text_fits() {
        // 1000 px de large, 400 px de haut ; 0,6 × taille par caractère
        let mut measure = |t: &str, size: f32| t.chars().count() as f32 * size * 0.6;
        let (size, lines, height) = fit_text("Bonjour", 1000.0, 400.0, &mut measure);
        assert_eq!(size, 72.0);
        assert_eq!(lines, vec!["Bonjour"]);
        assert!((height - 93.6).abs() < 0.01);

        let long = "mot ".repeat(200);
        let (size, lines, height) = fit_text(long.trim(), 1000.0, 400.0, &mut measure);
        assert!((12.0..72.0).contains(&size));
        assert!(height <= 400.0);
        assert!(!lines.is_empty());
    }

    #[test]
    fn text_is_truncated_at_minimum_size() {
        let mut measure = |t: &str, size: f32| t.chars().count() as f32 * size * 0.6;
        let huge = "abcdefgh ".repeat(2000);
        let (size, lines, height) = fit_text(huge.trim(), 1000.0, 400.0, &mut measure);
        assert_eq!(size, 12.0);
        // floor(400 / 15.6) = 25 lignes
        assert_eq!(lines.len(), 25);
        assert!(lines.last().unwrap().ends_with("..."));
        assert!((height - 25.0 * 15.6).abs() < 0.01);
    }

    #[test]
    fn cover_fills_the_story() {
        // Paysage : hauteur pleine, centré horizontalement
        let (w, h, x, y) = cover_rect(1920, 1080);
        assert_eq!(h, 1920.0);
        assert!((w - 3413.33).abs() < 0.01);
        assert!((x - (1080.0 - w) / 2.0).abs() < 0.01);
        assert_eq!(y, 0.0);
        // Carré : plus large que 9:16, hauteur pleine
        let (w, h, x, y) = cover_rect(1000, 1000);
        assert_eq!((w, h, x, y), (1920.0, 1920.0, -420.0, 0.0));
        // Très haut : largeur pleine, centré verticalement
        let (w, h, x, y) = cover_rect(500, 2000);
        assert_eq!((w, h, x, y), (1080.0, 4320.0, 0.0, -1200.0));
    }

    /// Rendu d'exemple à inspecter : `STORY_OUT=/tmp/story.png cargo test render_sample -- --ignored`
    /// (télécharge les emoji depuis le CDN Twemoji).
    #[tokio::test]
    #[ignore]
    async fn render_sample() {
        let out = std::env::var("STORY_OUT").unwrap_or_else(|_| "story-sample.png".into());
        let text = std::env::var("STORY_TEXT").unwrap_or_else(|_| {
            "🎉 Grande promo d'automne chez nous ! -30 % sur toute la collection 🍂🔥 \
             Venez découvrir nos nouveautés en magasin dès samedi 👉 #promo #automne #soldes"
                .into()
        });

        // Image de test : dégradé paysage
        let photo = RgbaImage::from_fn(1600, 900, |x, y| {
            Rgba([(x / 7) as u8, (y / 4) as u8, 160, 255])
        });
        let mut jpeg = Vec::new();
        image::DynamicImage::ImageRgba8(photo)
            .to_rgb8()
            .write_to(&mut Cursor::new(&mut jpeg), image::ImageFormat::Jpeg)
            .unwrap();

        let clean = remove_hashtags(&text);
        let http = reqwest::Client::new();
        let mut emoji_images = HashMap::new();
        for segment in emoji::parse(&clean) {
            if let Segment::Emoji { url, .. } = segment {
                match http.get(&url).send().await {
                    Ok(r) if r.status().is_success() => {
                        emoji_images.insert(url, r.bytes().await.unwrap());
                    }
                    other => {
                        eprintln!("emoji {url} indisponible : {:?}", other.map(|r| r.status()))
                    }
                }
            }
        }

        let fonts = Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts");
        let font = StoryFont::load(&fonts).unwrap();
        let png = compose(&jpeg, &clean, &font, &emoji_images).unwrap();
        std::fs::write(&out, png).unwrap();
    }

    #[test]
    fn xml_is_escaped() {
        assert_eq!(xml_escape("a<b & \"c\"\u{1}"), "a&lt;b &amp; &quot;c&quot;");
    }
}
