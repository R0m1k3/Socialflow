//! Paramètres des rendus de Reels (portage des schémas zod de `shared/reel.ts`
//! et `shared/srt.ts`).
//!
//! Validés à l'entrée des routes et stockés tels quels (JSON camelCase) dans
//! `reel_jobs.params` : un job repris après redémarrage — ou mis en file par
//! l'ancien serveur — retrouve exactement ce que l'utilisateur avait demandé.
//! Les messages reproduisent ceux de zod : seul le premier problème est
//! renvoyé au client (`{ error }`, statut 400).

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const TTS_ENGINES: [&str; 3] = ["qwen", "gemini", "edge"];
pub const TTS_STYLES: [&str; 5] = ["neutral", "dynamic", "warm", "calm", "promo"];
pub const CAPTION_STYLES: [&str; 3] = ["bold", "neon", "minimal"];
pub const DEFAULT_CAPTION_STYLE: &str = "bold";
pub const MAX_SRT_CUES: usize = 300;

/// Sous-titre d'un fichier SRT (secondes).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SrtCue {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// Reel construit à partir d'une vidéo de la médiathèque.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoReelParams {
    pub video_media_id: String,
    pub page_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub music_track_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub music_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overlay_text: Option<String>,
    /// Sous-titres SRT : remplacent le texte libre, la voix lit chacun à son instant.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub srt_cues: Option<Vec<SrtCue>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub tts_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tts_voice: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tts_engine: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tts_style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduled_for: Option<String>,
    /// Publie aussi la vidéo en story sur les pages Facebook (sans effet sur TikTok).
    pub also_story: bool,
    /// Ancien réglage, ignoré : le minutage vient désormais de la voix elle-même.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub word_duration: Option<f64>,
    pub font_size: i64,
    pub music_volume: f64,
    pub draw_text: bool,
    pub caption_style: String,
    pub stabilize: bool,
    /// Petit logo pendant la vidéo ; le grand logo de fin dépend de `enable_ending_effect`.
    pub show_logo: bool,
    pub enable_ending_effect: bool,
    /// Déterminé par le serveur à partir de la première page, jamais par le client.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store_name: Option<String>,
}

/// Aperçu de la voix.
#[derive(Debug, Clone, PartialEq)]
pub struct TtsPreviewParams {
    pub text: String,
    pub tts_voice: Option<String>,
    pub tts_engine: Option<String>,
    pub tts_style: Option<String>,
}

/// Texte complet du SRT (description de la publication, aperçu de la voix).
pub fn srt_text(cues: &[SrtCue]) -> String {
    cues.iter()
        .map(|c| c.text.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}

// ---------------------------------------------------------------------------
// Petit équivalent de zod : chaque fonction renvoie le premier problème
// rencontré, avec le message par défaut de zod v3 (ou le message personnalisé).
// ---------------------------------------------------------------------------

type Issue = String;

/// Type reçu, tel que le nomme zod (`getParsedType`).
fn parsed_type(value: Option<&Value>) -> &'static str {
    match value {
        None => "undefined",
        Some(Value::Null) => "null",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Number(_)) => "number",
        Some(Value::String(_)) => "string",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
    }
}

fn invalid_type(expected: &str, value: Option<&Value>) -> Issue {
    match value {
        None => "Required".into(),
        Some(_) => format!("Expected {expected}, received {}", parsed_type(value)),
    }
}

/// `String.prototype.trim()` : espaces Unicode et BOM.
pub fn js_trim(text: &str) -> &str {
    text.trim_matches(|c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{FEFF}')
}

/// Longueur JavaScript (unités UTF-16).
fn js_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn join_values(options: &[&str]) -> String {
    options
        .iter()
        .map(|o| format!("'{o}'"))
        .collect::<Vec<_>>()
        .join(" | ")
}

/// `z.string().trim().optional().transform(v => v || undefined)`.
fn optional_text(obj: &Map<String, Value>, key: &str) -> Result<Option<String>, Issue> {
    match obj.get(key) {
        None => Ok(None),
        Some(Value::String(s)) => {
            let trimmed = js_trim(s);
            Ok((!trimmed.is_empty()).then(|| trimmed.to_string()))
        }
        other => Err(invalid_type("string", other)),
    }
}

/// `z.string().optional()` (sans trim).
fn optional_string(obj: &Map<String, Value>, key: &str) -> Result<Option<String>, Issue> {
    match obj.get(key) {
        None => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        other => Err(invalid_type("string", other)),
    }
}

/// `z.boolean().default(default)`.
fn bool_or(obj: &Map<String, Value>, key: &str, default: bool) -> Result<bool, Issue> {
    match obj.get(key) {
        None => Ok(default),
        Some(Value::Bool(b)) => Ok(*b),
        other => Err(invalid_type("boolean", other)),
    }
}

fn enum_value(value: Option<&Value>, options: &[&str]) -> Result<String, Issue> {
    match value {
        Some(Value::String(s)) if options.contains(&s.as_str()) => Ok(s.clone()),
        Some(Value::String(s)) => Err(format!(
            "Invalid enum value. Expected {}, received '{s}'",
            join_values(options)
        )),
        other => Err(invalid_type(&join_values(options), other)),
    }
}

/// `z.enum(options).optional()`.
fn optional_enum(
    obj: &Map<String, Value>,
    key: &str,
    options: &[&str],
) -> Result<Option<String>, Issue> {
    match obj.get(key) {
        None => Ok(None),
        value => enum_value(value, options).map(Some),
    }
}

fn number(value: Option<&Value>) -> Result<f64, Issue> {
    match value {
        Some(Value::Number(n)) => n.as_f64().ok_or_else(|| invalid_type("number", value)),
        other => Err(invalid_type("number", other)),
    }
}

fn check_min(n: f64, min: f64, label: &str) -> Result<(), Issue> {
    if n < min {
        return Err(format!("Number must be greater than or equal to {label}"));
    }
    Ok(())
}

fn check_max(n: f64, max: f64, label: &str) -> Result<(), Issue> {
    if n > max {
        return Err(format!("Number must be less than or equal to {label}"));
    }
    Ok(())
}

fn as_object(value: &Value) -> Result<&Map<String, Value>, Issue> {
    match value {
        Value::Object(map) => Ok(map),
        other => Err(invalid_type("object", Some(other))),
    }
}

/// `srtCueSchema` : bornes, texte de 1 à 500 caractères, fin après le début.
fn srt_cue(value: &Value) -> Result<SrtCue, Issue> {
    let obj = as_object(value)?;
    let start = number(obj.get("start"))?;
    check_min(start, 0.0, "0")?;
    let end = number(obj.get("end"))?;
    check_min(end, 0.0, "0")?;
    let text = match obj.get("text") {
        Some(Value::String(s)) => js_trim(s).to_string(),
        other => return Err(invalid_type("string", other)),
    };
    if js_len(&text) < 1 {
        return Err("String must contain at least 1 character(s)".into());
    }
    if js_len(&text) > 500 {
        return Err("String must contain at most 500 character(s)".into());
    }
    if end <= start {
        return Err("Sous-titre de durée nulle".into());
    }
    Ok(SrtCue { start, end, text })
}

/// `srtCuesSchema.optional()`.
fn srt_cues(obj: &Map<String, Value>, key: &str) -> Result<Option<Vec<SrtCue>>, Issue> {
    let items = match obj.get(key) {
        None => return Ok(None),
        Some(Value::Array(items)) => items,
        other => return Err(invalid_type("array", other)),
    };
    if items.is_empty() {
        return Err("Fichier SRT vide".into());
    }
    if items.len() > MAX_SRT_CUES {
        return Err(format!(
            "Fichier SRT trop long ({MAX_SRT_CUES} sous-titres au plus)"
        ));
    }
    items
        .iter()
        .map(srt_cue)
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
}

/// Valide les paramètres d'un Reel vidéo (`videoReelParamsSchema`).
/// Les clés inconnues sont ignorées, les valeurs par défaut appliquées.
pub fn parse_video_reel_params(value: &Value) -> Result<VideoReelParams, Issue> {
    let obj = as_object(value)?;

    let video_media_id = match obj.get("videoMediaId") {
        None => return Err("Vidéo requise".into()),
        Some(Value::String(s)) if s.is_empty() => return Err("Vidéo requise".into()),
        Some(Value::String(s)) => s.clone(),
        other => return Err(invalid_type("string", other)),
    };

    let page_ids = match obj.get("pageIds") {
        None => return Err("Au moins une page requise".into()),
        Some(Value::Array(items)) => {
            if items.is_empty() {
                return Err("Au moins une page requise".into());
            }
            let mut ids = Vec::with_capacity(items.len());
            for item in items {
                match item {
                    Value::String(s) if s.is_empty() => {
                        return Err("String must contain at least 1 character(s)".into())
                    }
                    Value::String(s) => ids.push(s.clone()),
                    other => return Err(invalid_type("string", Some(other))),
                }
            }
            ids
        }
        other => return Err(invalid_type("array", other)),
    };

    let music_track_id = optional_text(obj, "musicTrackId")?;
    let music_url = optional_text(obj, "musicUrl")?;
    let overlay_text = optional_text(obj, "overlayText")?;
    let srt_cues = srt_cues(obj, "srtCues")?;
    let description = optional_text(obj, "description")?;
    let tts_enabled = bool_or(obj, "ttsEnabled", false)?;
    let tts_voice = optional_text(obj, "ttsVoice")?;
    let tts_engine = optional_enum(obj, "ttsEngine", &TTS_ENGINES)?;
    let tts_style = optional_enum(obj, "ttsStyle", &TTS_STYLES)?;
    let scheduled_for = optional_text(obj, "scheduledFor")?;
    let also_story = bool_or(obj, "alsoStory", false)?;
    let word_duration = match obj.get("wordDuration") {
        None => None,
        value => Some(number(value)?),
    };

    let font_size = match obj.get("fontSize") {
        None => 64,
        value => {
            let n = number(value)?;
            if n.fract() != 0.0 || !n.is_finite() {
                return Err("Expected integer, received float".into());
            }
            check_min(n, 16.0, "16")?;
            check_max(n, 200.0, "200")?;
            n as i64
        }
    };

    let music_volume = match obj.get("musicVolume") {
        None => 0.25,
        value => {
            let n = number(value)?;
            check_min(n, 0.0, "0")?;
            check_max(n, 2.0, "2")?;
            n
        }
    };

    let draw_text = bool_or(obj, "drawText", true)?;
    let caption_style = match obj.get("captionStyle") {
        None => DEFAULT_CAPTION_STYLE.to_string(),
        value => enum_value(value, &CAPTION_STYLES)?,
    };
    let stabilize = bool_or(obj, "stabilize", false)?;
    let show_logo = bool_or(obj, "showLogo", true)?;
    let enable_ending_effect = bool_or(obj, "enableEndingEffect", true)?;
    let store_name = optional_string(obj, "storeName")?;

    Ok(VideoReelParams {
        video_media_id,
        page_ids,
        music_track_id,
        music_url,
        overlay_text,
        srt_cues,
        description,
        tts_enabled,
        tts_voice,
        tts_engine,
        tts_style,
        scheduled_for,
        also_story,
        word_duration,
        font_size,
        music_volume,
        draw_text,
        caption_style,
        stabilize,
        show_logo,
        enable_ending_effect,
        store_name,
    })
}

/// Valide une demande d'aperçu de la voix (`ttsPreviewSchema`).
pub fn parse_tts_preview(value: &Value) -> Result<TtsPreviewParams, Issue> {
    let obj = as_object(value)?;
    let text = match obj.get("text") {
        None => return Err("Texte requis".into()),
        Some(Value::String(s)) => js_trim(s).to_string(),
        other => return Err(invalid_type("string", other)),
    };
    if js_len(&text) < 1 {
        return Err("Texte requis".into());
    }
    if js_len(&text) > 2000 {
        return Err("String must contain at most 2000 character(s)".into());
    }
    Ok(TtsPreviewParams {
        text,
        tts_voice: optional_text(obj, "ttsVoice")?,
        tts_engine: optional_enum(obj, "ttsEngine", &TTS_ENGINES)?,
        tts_style: optional_enum(obj, "ttsStyle", &TTS_STYLES)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn base() -> Value {
        json!({ "videoMediaId": "v", "pageIds": ["p"] })
    }

    fn with(extra: Value) -> Value {
        let mut value = base();
        for (k, v) in extra.as_object().unwrap() {
            value[k] = v.clone();
        }
        value
    }

    #[test]
    fn exige_une_video_et_une_page() {
        assert_eq!(
            parse_video_reel_params(&json!({ "pageIds": [] })).unwrap_err(),
            "Vidéo requise"
        );
        assert_eq!(
            parse_video_reel_params(&json!({ "videoMediaId": "" })).unwrap_err(),
            "Vidéo requise"
        );
        assert_eq!(
            parse_video_reel_params(&json!({ "videoMediaId": "v", "pageIds": [] })).unwrap_err(),
            "Au moins une page requise"
        );
        assert_eq!(
            parse_video_reel_params(&json!({ "videoMediaId": "v" })).unwrap_err(),
            "Au moins une page requise"
        );
        assert_eq!(
            parse_video_reel_params(&json!({ "videoMediaId": 3, "pageIds": ["p"] })).unwrap_err(),
            "Expected string, received number"
        );
        assert_eq!(
            parse_video_reel_params(&json!([])).unwrap_err(),
            "Expected object, received array"
        );
    }

    #[test]
    fn applique_les_valeurs_par_defaut() {
        let params = parse_video_reel_params(&base()).unwrap();
        assert_eq!(params.caption_style, "bold");
        assert!(!params.stabilize);
        assert!(params.draw_text);
        assert_eq!(params.music_volume, 0.25);
        assert!(params.show_logo);
        assert!(!params.also_story);
        assert!(!params.tts_enabled);
        assert!(params.enable_ending_effect);
        assert_eq!(params.font_size, 64);
    }

    #[test]
    fn json_stocke_en_camel_case_sans_champs_vides() {
        let params = parse_video_reel_params(&with(json!({
            "overlayText": "  Bonjour  ",
            "description": "   ",
            "inconnu": 1,
        })))
        .unwrap();
        let stored = serde_json::to_value(&params).unwrap();
        assert_eq!(stored["overlayText"], "Bonjour");
        assert!(stored.get("description").is_none());
        assert!(stored.get("inconnu").is_none());
        assert_eq!(stored["captionStyle"], "bold");
        assert_eq!(stored["enableEndingEffect"], true);
        // Relu par le worker : identique
        assert_eq!(parse_video_reel_params(&stored).unwrap(), params);
    }

    #[test]
    fn accepte_les_anciens_parametres() {
        assert!(parse_video_reel_params(&with(json!({ "wordDuration": 0.6 }))).is_ok());
    }

    #[test]
    fn refuse_un_moteur_de_voix_inconnu() {
        assert_eq!(
            parse_video_reel_params(&with(json!({ "ttsEngine": "autre" }))).unwrap_err(),
            "Invalid enum value. Expected 'qwen' | 'gemini' | 'edge', received 'autre'"
        );
        assert_eq!(
            parse_video_reel_params(&with(json!({ "ttsStyle": null }))).unwrap_err(),
            "Expected 'neutral' | 'dynamic' | 'warm' | 'calm' | 'promo', received null"
        );
    }

    #[test]
    fn bornes_numeriques() {
        assert_eq!(
            parse_video_reel_params(&with(json!({ "fontSize": 10 }))).unwrap_err(),
            "Number must be greater than or equal to 16"
        );
        assert_eq!(
            parse_video_reel_params(&with(json!({ "fontSize": 300 }))).unwrap_err(),
            "Number must be less than or equal to 200"
        );
        assert_eq!(
            parse_video_reel_params(&with(json!({ "fontSize": 20.5 }))).unwrap_err(),
            "Expected integer, received float"
        );
        assert_eq!(
            parse_video_reel_params(&with(json!({ "fontSize": 72.0 })))
                .unwrap()
                .font_size,
            72
        );
        assert_eq!(
            parse_video_reel_params(&with(json!({ "musicVolume": 3 }))).unwrap_err(),
            "Number must be less than or equal to 2"
        );
        assert_eq!(
            parse_video_reel_params(&with(json!({ "musicVolume": -1 }))).unwrap_err(),
            "Number must be greater than or equal to 0"
        );
        assert_eq!(
            parse_video_reel_params(&with(json!({ "musicTrackId": null }))).unwrap_err(),
            "Expected string, received null"
        );
        assert_eq!(
            parse_video_reel_params(&with(json!({ "stabilize": "oui" }))).unwrap_err(),
            "Expected boolean, received string"
        );
    }

    #[test]
    fn sous_titres_srt() {
        let ok = parse_video_reel_params(&with(
            json!({ "srtCues": [{ "start": 0, "end": 1, "text": " a " }] }),
        ))
        .unwrap();
        assert_eq!(ok.srt_cues.unwrap()[0].text, "a");
        assert_eq!(
            parse_video_reel_params(&with(
                json!({ "srtCues": [{ "start": 1, "end": 1, "text": "a" }] })
            ))
            .unwrap_err(),
            "Sous-titre de durée nulle"
        );
        assert_eq!(
            parse_video_reel_params(&with(json!({ "srtCues": [] }))).unwrap_err(),
            "Fichier SRT vide"
        );
        let many: Vec<Value> = (0..301)
            .map(|i| json!({ "start": i, "end": i + 1, "text": "x" }))
            .collect();
        assert_eq!(
            parse_video_reel_params(&with(json!({ "srtCues": many }))).unwrap_err(),
            "Fichier SRT trop long (300 sous-titres au plus)"
        );
        assert_eq!(
            parse_video_reel_params(&with(json!({ "srtCues": [{ "end": 1, "text": "a" }] })))
                .unwrap_err(),
            "Required"
        );
    }

    #[test]
    fn texte_du_srt() {
        let cues = vec![
            SrtCue {
                start: 1.0,
                end: 3.5,
                text: "Bonjour à tous !".into(),
            },
            SrtCue {
                start: 4.0,
                end: 6.25,
                text: "Découvrez nos nouveautés en magasin".into(),
            },
        ];
        assert_eq!(
            srt_text(&cues),
            "Bonjour à tous ! Découvrez nos nouveautés en magasin"
        );
    }

    #[test]
    fn apercu_de_la_voix() {
        assert_eq!(
            parse_tts_preview(&json!({ "text": "   " })).unwrap_err(),
            "Texte requis"
        );
        assert_eq!(parse_tts_preview(&json!({})).unwrap_err(), "Texte requis");
        assert_eq!(
            parse_tts_preview(&json!({ "text": "x".repeat(2001) })).unwrap_err(),
            "String must contain at most 2000 character(s)"
        );
        let ok =
            parse_tts_preview(&json!({ "text": " Salut ", "ttsEngine": "edge", "ttsVoice": "" }))
                .unwrap();
        assert_eq!(ok.text, "Salut");
        assert_eq!(ok.tts_engine.as_deref(), Some("edge"));
        assert_eq!(ok.tts_voice, None);
    }
}
