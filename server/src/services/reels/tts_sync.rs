//! Estimation de la durée de lecture d'un texte, affichée pendant la saisie
//! (portage de `server/services/ttsSync.ts`).
//!
//! Le minutage réel des mots vient de la voix au moment du rendu ; ici, une
//! estimation suffit et ne déclenche aucune synthèse (payante avec Gemini).

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

/// Débit moyen d'une voix de synthèse française, en mots par seconde.
const WORDS_PER_SECOND: f64 = 2.6;
/// Au-delà, la voix dépasse la durée confortable d'un Reel.
const MAX_COMFORTABLE_SECONDS: f64 = 45.0;
const PUNCTUATION_PAUSE: f64 = 0.35;

static HASHTAG: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"#[A-Za-z0-9_\x{C0}-\x{FF}]+").expect("regex"));
static LINK: Lazy<Regex> = Lazy::new(|| Regex::new(r"https?://\S+").expect("regex"));
static WORDLIKE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[A-Za-z0-9\x{C0}-\x{FF}]").expect("regex"));
static PAUSE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[.!?;:]").expect("regex"));

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTiming {
    pub word_duration: f64,
    pub audio_duration: f64,
    pub word_count: usize,
    pub punctuation_pause: f64,
    pub is_healthy: bool,
    pub warnings: Vec<String>,
}

/// `Math.round` de JavaScript (les demis arrondis vers le haut).
fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

pub fn estimate_voice_timing(text: &str) -> SyncTiming {
    let without_tags = HASHTAG.replace_all(text, "");
    let cleaned = LINK.replace_all(&without_tags, "");
    let word_count = cleaned
        .split(char::is_whitespace)
        .filter(|w| WORDLIKE.is_match(w))
        .count();
    let pauses = PAUSE.find_iter(text).count();
    let audio_duration = word_count as f64 / WORDS_PER_SECOND + pauses as f64 * PUNCTUATION_PAUSE;

    let mut warnings = Vec::new();
    if audio_duration > MAX_COMFORTABLE_SECONDS {
        warnings.push(format!(
            "Texte long : environ {} s de voix. Visez moins de {} s.",
            js_round(audio_duration),
            MAX_COMFORTABLE_SECONDS
        ));
    }
    if word_count > 0 && word_count < 4 {
        warnings.push("Texte très court : la voix ne durera que quelques secondes.".into());
    }

    SyncTiming {
        word_duration: if word_count > 0 {
            audio_duration / word_count as f64
        } else {
            0.0
        },
        audio_duration,
        word_count,
        punctuation_pause: PUNCTUATION_PAUSE,
        is_healthy: warnings.is_empty(),
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignore_hashtags_et_liens() {
        assert_eq!(
            estimate_voice_timing("Venez vite #promo https://x.fr").word_count,
            2
        );
    }

    #[test]
    fn previent_quand_la_voix_sera_trop_longue() {
        let timing = estimate_voice_timing(&"mot ".repeat(200));
        assert!(!timing.is_healthy);
        assert!(timing.warnings[0].starts_with("Texte long"));
        assert_eq!(
            timing.warnings[0],
            "Texte long : environ 77 s de voix. Visez moins de 45 s."
        );
    }

    #[test]
    fn texte_court() {
        let timing = estimate_voice_timing("Bonjour !");
        assert_eq!(timing.word_count, 1);
        assert_eq!(
            timing.warnings,
            vec!["Texte très court : la voix ne durera que quelques secondes."]
        );
        assert!((timing.audio_duration - (1.0 / 2.6 + 0.35)).abs() < 1e-9);
    }
}
