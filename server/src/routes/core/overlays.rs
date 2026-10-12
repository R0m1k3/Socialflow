//! Incrustations sur une image (bandeau d'angle, pastille de prix, logo),
//! calculées côté serveur puis enregistrées comme un nouveau média.
//!
//! Remplace le traitement sharp de l'ancienne route : les éléments vectoriels
//! sont décrits en SVG et rendus avec resvg, puis composés avec `image`.

use std::io::Cursor;
use std::path::Path;
use std::sync::{Arc, OnceLock};

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageDecoder, ImageReader, RgbaImage};
use resvg::{tiny_skia, usvg};
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::db::{MediaType, NewMedia};
use crate::error::{ApiResult, AppError};
use crate::extract::{is_truthy, Body, JsonExt};
use crate::services::media_store::{self, MediaSource};
use crate::state::AppState;

const RED: &str = "#dc2626";
const YELLOW: &str = "#eab308";
const RIBBON_SIZE: u32 = 150;
const BADGE_PADDING: f64 = 16.0;
const LOGO_PADDING: i64 = 20;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/media/apply-overlays", post(apply_overlays))
}

async fn apply_overlays(
    State(state): State<AppState>,
    user: AuthUser,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    if !body.truthy("imageUrl") {
        return Err(AppError::bad_request("Image URL required"));
    }
    match process(&state, &user.id, &body).await {
        Ok(media) => Ok(Json(media)),
        Err(error) => {
            tracing::error!("💥 Error applying overlays: {error:#}");
            Err(AppError::internal(error.to_string()))
        }
    }
}

/// Paramètres d'incrustation lus dans la requête.
#[derive(Debug, Clone, Default)]
struct OverlaySpec {
    ribbon: Option<Ribbon>,
    badge: Option<PriceBadge>,
    logo: Option<LogoSpec>,
}

#[derive(Debug, Clone)]
struct Ribbon {
    text: String,
    color: &'static str,
    position: String,
}

#[derive(Debug, Clone)]
struct PriceBadge {
    text: String,
    font_size: f64,
    color: &'static str,
    position: String,
}

#[derive(Debug, Clone)]
struct LogoSpec {
    data: Vec<u8>,
    size: String,
    position: String,
    /// Opacité en pourcentage ; `None` = logo opaque.
    opacity: Option<f64>,
}

fn color_of(value: &Value) -> &'static str {
    if value.str_field("color") == Some("red") {
        RED
    } else {
        YELLOW
    }
}

/// Texte affiché d'une valeur JSON (`${value}` en JavaScript).
fn display(value: Option<&Value>) -> String {
    match value {
        None => "undefined".into(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) => "null".into(),
        Some(other) => other.to_string(),
    }
}

async fn process(state: &AppState, user_id: &str, body: &Value) -> anyhow::Result<Value> {
    let image_url = display(body.get("imageUrl"));
    tracing::info!("🎨 Applying overlays server-side...");
    tracing::info!("📥 Image URL: {image_url}");

    let image = media_store::read_media_buffer(state, &image_url).await?;
    tracing::info!("✅ Image downloaded: {} bytes", image.len());

    let mut spec = OverlaySpec::default();
    if let Some(ribbon) = body.get("ribbon").filter(|r| is_truthy(Some(r))) {
        let Some(text) = ribbon.str_field("text") else {
            anyhow::bail!("Cannot read properties of undefined (reading 'length')");
        };
        spec.ribbon = Some(Ribbon {
            text: text.to_string(),
            color: color_of(ribbon),
            position: ribbon.str_field("position").unwrap_or_default().to_string(),
        });
    }
    if let Some(badge) = body.get("priceBadge").filter(|b| is_truthy(Some(b))) {
        spec.badge = Some(PriceBadge {
            text: format!("{} €", display(badge.get("price"))),
            font_size: badge.get("size").and_then(Value::as_f64).unwrap_or(20.0),
            color: color_of(badge),
            position: badge.str_field("position").unwrap_or_default().to_string(),
        });
    }
    if let Some(logo) = body.get("logo").filter(|l| l.truthy("enabled")) {
        spec.logo = load_logo(state, logo).await;
    }

    let fonts_dir = state.config.fonts_dir.clone();
    let output = tokio::task::spawn_blocking(move || render(&image, &spec, &fonts_dir)).await??;

    tracing::info!("✅ Overlays applied, uploading to local storage...");
    let file_name = format!("edited_{}.jpg", chrono::Utc::now().timestamp_millis());
    let stored = media_store::upload_media(state, MediaSource::Bytes(&output), &file_name).await?;

    // Image retouchée : toutes les déclinaisons pointent sur l'original incrusté
    let media = state
        .db
        .create_media(NewMedia {
            user_id: user_id.to_string(),
            media_type: Some(MediaType::Image),
            cloudinary_public_id: Some(stored.public_id),
            original_url: stored.original_url.clone(),
            facebook_landscape_url: None,
            facebook_feed_url: Some(stored.original_url.clone()),
            instagram_feed_url: Some(stored.original_url.clone()),
            instagram_story_url: Some(stored.original_url),
            thumbnail_url: None,
            file_name,
            file_size: i32::try_from(output.len()).unwrap_or(i32::MAX),
        })
        .await?;
    tracing::info!("✅ Image saved with ID: {}", media.id);
    Ok(json!(media))
}

/// Logo de l'entreprise configuré dans les paramètres ; `None` (sans faire
/// échouer la requête) s'il est absent ou illisible.
async fn load_logo(state: &AppState, logo: &Value) -> Option<LogoSpec> {
    tracing::info!("🏢 Adding logo overlay...");
    let config = match state.db.get_cloudinary_config().await {
        Ok(config) => config,
        Err(error) => {
            tracing::error!("⚠️  Failed to apply logo: {error}");
            return None;
        }
    };
    let Some(public_id) = config
        .and_then(|c| c.logo_public_id)
        .filter(|p| !p.is_empty())
    else {
        tracing::info!("⚠️  No logo configured in settings");
        return None;
    };
    let url = media_store::build_url(&public_id);
    tracing::info!("📥 Downloading logo from: {url}");
    match media_store::read_media_buffer(state, &url).await {
        Ok(data) => Some(LogoSpec {
            data: data.to_vec(),
            size: logo.str_field("size").unwrap_or("medium").to_string(),
            position: logo.str_field("position").unwrap_or_default().to_string(),
            opacity: logo.get("opacity").and_then(Value::as_f64),
        }),
        Err(error) => {
            tracing::error!("⚠️  Failed to apply logo: {error}");
            None
        }
    }
}

/// Décode une image en appliquant son orientation EXIF (`sharp().rotate()`).
fn decode_oriented(data: &[u8]) -> anyhow::Result<DynamicImage> {
    let mut decoder = ImageReader::new(Cursor::new(data))
        .with_guessed_format()?
        .into_decoder()?;
    let orientation = decoder.orientation().ok();
    let mut image = DynamicImage::from_decoder(decoder)?;
    if let Some(orientation) = orientation {
        image.apply_orientation(orientation);
    }
    Ok(image)
}

fn render(data: &[u8], spec: &OverlaySpec, fonts_dir: &Path) -> anyhow::Result<Vec<u8>> {
    let mut base: RgbaImage = decode_oriented(data)?.to_rgba8();
    let (width, height) = base.dimensions();
    tracing::info!("📐 Image dimensions: {width}x{height}");

    if let Some(ribbon) = &spec.ribbon {
        let geometry = ribbon_geometry(&ribbon.position, width, height);
        let svg = ribbon_svg(ribbon, &geometry);
        let layer = rasterize(&svg, fonts_dir)?;
        image::imageops::overlay(&mut base, &layer, geometry.x, geometry.y);
    }

    if let Some(badge) = &spec.badge {
        let geometry = badge_geometry(&badge.text, badge.font_size, &badge.position, width, height);
        let svg = badge_svg(badge, &geometry);
        let layer = rasterize(&svg, fonts_dir)?;
        image::imageops::overlay(&mut base, &layer, geometry.x, geometry.y);
    }

    if let Some(logo) = &spec.logo {
        match logo_layer(logo, width, height) {
            Ok((layer, x, y)) => {
                image::imageops::overlay(&mut base, &layer, x, y);
                tracing::info!(
                    "✅ Logo added at position {} with {}% opacity",
                    logo.position,
                    logo.opacity.unwrap_or(100.0)
                );
            }
            Err(error) => tracing::error!("⚠️  Failed to apply logo: {error}"),
        }
    }

    let rgb = DynamicImage::ImageRgba8(base).to_rgb8();
    let mut output = Vec::new();
    JpegEncoder::new_with_quality(&mut output, 95).encode_image(&rgb)?;
    Ok(output)
}

/// Bandeau triangulaire d'angle (150 px) et son texte incliné.
#[derive(Debug, Clone, PartialEq)]
struct RibbonGeometry {
    x: i64,
    y: i64,
    polygon: String,
    text_x: f64,
    text_y: f64,
    rotation: i32,
}

fn ribbon_geometry(position: &str, width: u32, height: u32) -> RibbonGeometry {
    let s = RIBBON_SIZE as f64;
    let right = width as i64 - RIBBON_SIZE as i64;
    let bottom = height as i64 - RIBBON_SIZE as i64;
    let size = RIBBON_SIZE;
    let (x, y, polygon, text_x, text_y, rotation) = match position {
        "north_east" => (
            right,
            0,
            format!("0,0 {size},0 {size},{size}"),
            s * 0.7,
            s * 0.3,
            45,
        ),
        "south_west" => (
            0,
            bottom,
            format!("0,0 0,{size} {size},{size}"),
            s * 0.3,
            s * 0.7,
            -135,
        ),
        "south_east" => (
            right,
            bottom,
            format!("{size},0 0,{size} {size},{size}"),
            s * 0.7,
            s * 0.7,
            135,
        ),
        // north_west et toute valeur inconnue
        _ => (
            0,
            0,
            format!("0,0 {size},0 0,{size}"),
            s * 0.3,
            s * 0.3,
            -45,
        ),
    };
    RibbonGeometry {
        x,
        y,
        polygon,
        text_x,
        text_y,
        rotation,
    }
}

/// Taille du texte du bandeau selon sa longueur (JavaScript).
fn ribbon_font_size(text: &str) -> u32 {
    match text.encode_utf16().count() {
        0..=5 => 22,
        6..=8 => 18,
        9..=11 => 15,
        _ => 12,
    }
}

/// Échappe un texte pour l'insérer dans du XML.
fn xml_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c => out.push(c),
        }
    }
    out
}

fn ribbon_svg(ribbon: &Ribbon, g: &RibbonGeometry) -> String {
    format!(
        r#"<svg width="{size}" height="{size}" xmlns="http://www.w3.org/2000/svg"><polygon points="{polygon}" fill="{color}"/><text x="{tx}" y="{ty}" font-family="Arial, sans-serif" font-size="{font}" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle" transform="rotate({rot}, {tx}, {ty})">{text}</text></svg>"#,
        size = RIBBON_SIZE,
        polygon = g.polygon,
        color = ribbon.color,
        tx = g.text_x,
        ty = g.text_y,
        font = ribbon_font_size(&ribbon.text),
        rot = g.rotation,
        text = xml_escape(&ribbon.text),
    )
}

/// Pastille de prix : largeur estimée d'après le nombre de caractères.
#[derive(Debug, Clone, PartialEq)]
struct BadgeGeometry {
    width: f64,
    height: f64,
    x: i64,
    y: i64,
}

fn badge_geometry(
    text: &str,
    font_size: f64,
    position: &str,
    width: u32,
    height: u32,
) -> BadgeGeometry {
    let text_width = text.encode_utf16().count() as f64 * font_size * 0.6;
    let badge_width = text_width + BADGE_PADDING * 2.0;
    let badge_height = font_size + BADGE_PADDING;
    let right = width as f64 - badge_width - BADGE_PADDING;
    let bottom = height as f64 - badge_height - BADGE_PADDING;
    let (x, y) = match position {
        "north_east" => (right, BADGE_PADDING),
        "south_west" => (BADGE_PADDING, bottom),
        "south_east" => (right, bottom),
        _ => (BADGE_PADDING, BADGE_PADDING),
    };
    BadgeGeometry {
        width: badge_width,
        height: badge_height,
        x: x.round() as i64,
        y: y.round() as i64,
    }
}

fn badge_svg(badge: &PriceBadge, g: &BadgeGeometry) -> String {
    format!(
        r#"<svg width="{w}" height="{h}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="{w}" height="{h}" rx="{r}" ry="{r}" fill="{color}"/><text x="{cx}" y="{r}" font-family="Arial, sans-serif" font-size="{font}" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">{text}</text></svg>"#,
        w = g.width,
        h = g.height,
        r = g.height / 2.0,
        cx = g.width / 2.0,
        color = badge.color,
        font = badge.font_size,
        text = xml_escape(&badge.text),
    )
}

/// Base de polices partagée : polices du système et dossier `fonts/`.
fn font_database(fonts_dir: &Path) -> Arc<usvg::fontdb::Database> {
    static DB: OnceLock<Arc<usvg::fontdb::Database>> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = usvg::fontdb::Database::new();
        db.load_system_fonts();
        db.load_fonts_dir(fonts_dir);
        let has = |family: &str| {
            db.faces()
                .any(|face| face.families.iter().any(|(name, _)| name == family))
        };
        // « Arial, sans-serif » : repli sur une police réellement disponible
        let fallback = ["Arial", "Liberation Sans", "DejaVu Sans", "FreeSans"]
            .into_iter()
            .find(|f| has(f))
            .map(str::to_string);
        if let Some(family) = fallback {
            db.set_sans_serif_family(family);
        }
        Arc::new(db)
    })
    .clone()
}

/// Rend un SVG en image RGBA (alpha non prémultiplié).
fn rasterize(svg: &str, fonts_dir: &Path) -> anyhow::Result<RgbaImage> {
    let options = usvg::Options {
        fontdb: font_database(fonts_dir),
        ..usvg::Options::default()
    };
    let tree = usvg::Tree::from_str(svg, &options)?;
    let size = tree.size().to_int_size();
    let mut pixmap = tiny_skia::Pixmap::new(size.width(), size.height())
        .ok_or_else(|| anyhow::anyhow!("dimensions SVG invalides"))?;
    resvg::render(
        &tree,
        tiny_skia::Transform::identity(),
        &mut pixmap.as_mut(),
    );

    let mut data = Vec::with_capacity(pixmap.data().len());
    for pixel in pixmap.pixels() {
        let c = pixel.demultiply();
        data.extend_from_slice(&[c.red(), c.green(), c.blue(), c.alpha()]);
    }
    RgbaImage::from_raw(size.width(), size.height(), data)
        .ok_or_else(|| anyhow::anyhow!("rendu SVG invalide"))
}

/// Largeur du logo : part de la largeur de l'image, sans dépasser les marges.
fn logo_width(size: &str, width: u32) -> i64 {
    let ratio = match size {
        "small" => 0.35,
        "large" => 0.70,
        _ => 0.50,
    };
    let requested = (width as f64 * ratio).round() as i64;
    requested.min(width as i64 - LOGO_PADDING * 2)
}

fn logo_position(position: &str, width: u32, height: u32, logo_w: i64, logo_h: i64) -> (i64, i64) {
    let (w, h) = (width as i64, height as i64);
    let right = w - logo_w - LOGO_PADDING;
    let bottom = h - logo_h - LOGO_PADDING;
    match position {
        "north_east" => (right, LOGO_PADDING),
        "south_west" => (LOGO_PADDING, bottom),
        "south_east" => (right, bottom),
        "center" => (
            ((w - logo_w) as f64 / 2.0).round() as i64,
            ((h - logo_h) as f64 / 2.0).round() as i64,
        ),
        _ => (LOGO_PADDING, LOGO_PADDING),
    }
}

fn logo_layer(logo: &LogoSpec, width: u32, height: u32) -> anyhow::Result<(RgbaImage, i64, i64)> {
    let source = decode_oriented(&logo.data)?.to_rgba8();
    let target_w = logo_width(&logo.size, width);
    if target_w <= 0 || source.width() == 0 {
        anyhow::bail!("Expected positive integer for width but received {target_w}");
    }
    let target_h =
        ((source.height() as f64 * target_w as f64 / source.width() as f64).round() as u32).max(1);
    let mut resized = image::imageops::resize(
        &source,
        target_w as u32,
        target_h,
        image::imageops::FilterType::Lanczos3,
    );

    if target_h as i64 > height as i64 - LOGO_PADDING * 2 {
        tracing::warn!(
            "⚠️ Logo height {target_h}px exceeds max {}px, would be clipped",
            height as i64 - LOGO_PADDING * 2
        );
    }

    if let Some(opacity) = logo.opacity.filter(|o| *o < 100.0) {
        let factor = (opacity / 100.0).clamp(0.0, 1.0);
        for pixel in resized.pixels_mut() {
            pixel[3] = (pixel[3] as f64 * factor).round() as u8;
        }
    }

    let (x, y) = logo_position(&logo.position, width, height, target_w, target_h as i64);
    Ok((resized, x, y))
}

/// Chemin de polices utilisé par défaut dans les tests.
#[cfg(test)]
fn test_fonts_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fonts")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ribbon_positions() {
        let g = ribbon_geometry("south_east", 800, 600);
        assert_eq!((g.x, g.y, g.rotation), (650, 450, 135));
        assert_eq!(g.polygon, "150,0 0,150 150,150");
        assert!((g.text_x - 105.0).abs() < 1e-9);
        let g = ribbon_geometry("inconnu", 800, 600);
        assert_eq!((g.x, g.y, g.rotation), (0, 0, -45));
        assert_eq!(ribbon_font_size("Promo"), 22);
        assert_eq!(ribbon_font_size("Soldes!!"), 18);
        assert_eq!(ribbon_font_size("Nouveauté!!"), 15);
        assert_eq!(ribbon_font_size("Très grosse promo"), 12);
    }

    #[test]
    fn badge_positions() {
        let g = badge_geometry("12 €", 20.0, "north_east", 800, 600);
        assert_eq!((g.width, g.height), (80.0, 36.0));
        assert_eq!((g.x, g.y), (704, 16));
        let g = badge_geometry("12 €", 20.0, "south_west", 800, 600);
        assert_eq!((g.x, g.y), (16, 548));
    }

    #[test]
    fn logo_sizes_and_positions() {
        assert_eq!(logo_width("small", 1000), 350);
        assert_eq!(logo_width("large", 1000), 700);
        assert_eq!(logo_width("medium", 1000), 500);
        // Plafonné aux marges
        assert_eq!(logo_width("large", 100), 60);
        assert_eq!(logo_position("south_east", 1000, 800, 500, 100), (480, 680));
        assert_eq!(logo_position("center", 1000, 800, 500, 101), (250, 350));
        assert_eq!(logo_position("north_west", 1000, 800, 500, 100), (20, 20));
    }

    #[test]
    fn escapes_text() {
        assert_eq!(xml_escape("A&B <\"c\">"), "A&amp;B &lt;&quot;c&quot;&gt;");
        let ribbon = Ribbon {
            text: "<b>".into(),
            color: RED,
            position: "north_west".into(),
        };
        let svg = ribbon_svg(&ribbon, &ribbon_geometry("north_west", 300, 300));
        assert!(svg.contains("&lt;b&gt;</text>"));
        assert!(rasterize(&svg, &test_fonts_dir()).is_ok());
    }

    #[test]
    fn renders_overlays_on_jpeg() {
        let base = RgbaImage::from_pixel(400, 300, image::Rgba([0, 0, 255, 255]));
        let mut jpeg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg, 90)
            .encode_image(&DynamicImage::ImageRgba8(base).to_rgb8())
            .unwrap();
        let mut png_logo = Vec::new();
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(
            10,
            5,
            image::Rgba([255, 255, 255, 255]),
        ))
        .write_to(&mut Cursor::new(&mut png_logo), image::ImageFormat::Png)
        .unwrap();
        let spec = OverlaySpec {
            ribbon: Some(Ribbon {
                text: "Promo".into(),
                color: RED,
                position: "north_west".into(),
            }),
            badge: Some(PriceBadge {
                text: "9,99 €".into(),
                font_size: 20.0,
                color: YELLOW,
                position: "south_east".into(),
            }),
            logo: Some(LogoSpec {
                data: png_logo,
                size: "small".into(),
                position: "center".into(),
                opacity: Some(50.0),
            }),
        };
        let output = render(&jpeg, &spec, &test_fonts_dir()).unwrap();
        let out = image::load_from_memory(&output).unwrap().to_rgb8();
        assert_eq!(out.dimensions(), (400, 300));
        // Coin du bandeau rouge
        let corner = out.get_pixel(5, 5);
        assert!(corner[0] > 180 && corner[2] < 80, "{corner:?}");
        // Logo blanc à 50 % au centre : mélange bleu/blanc
        let center = out.get_pixel(200, 150);
        assert!(
            center[0] > 90 && center[0] < 170 && center[2] > 200,
            "{center:?}"
        );
    }
}
