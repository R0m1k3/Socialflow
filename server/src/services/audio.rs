//! Bibliothèque audio : réparation des titres mal encodés et durée des pistes.

use std::path::Path;

use tokio::process::Command;

use crate::state::AppState;

/// Texte UTF-8 qui a été lu comme du latin1 (« Ã© » au lieu de « é ») ?
fn looks_mis_decoded(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    chars
        .windows(2)
        .any(|w| ('\u{C0}'..='\u{C3}').contains(&w[0]) && ('\u{80}'..='\u{BF}').contains(&w[1]))
}

/// Réencode chaque caractère en un octet latin1 puis relit en UTF-8
/// (`Buffer.from(text, 'latin1').toString('utf8')`).
fn latin1_to_utf8(text: &str) -> String {
    let bytes: Vec<u8> = text.chars().map(|c| (c as u32 & 0xFF) as u8).collect();
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Corrige les titres corrompus des pistes audio ; renvoie le nombre corrigé.
pub async fn fix_audio_track_encoding(state: &AppState) -> usize {
    let tracks = match state.db.get_audio_tracks().await {
        Ok(tracks) => tracks,
        Err(error) => {
            tracing::error!("Error fixing audio track encoding: {error}");
            return 0;
        }
    };
    let mut fixed = 0;
    for track in tracks {
        if !looks_mis_decoded(&track.title) {
            continue;
        }
        let title = latin1_to_utf8(&track.title);
        let file_name = latin1_to_utf8(&track.file_name);
        if sqlx::query("UPDATE audio_tracks SET title = $1, file_name = $2 WHERE id = $3")
            .bind(&title)
            .bind(&file_name)
            .bind(&track.id)
            .execute(&state.db.pool)
            .await
            .is_ok()
        {
            fixed += 1;
        }
    }
    if fixed > 0 {
        tracing::info!("🎵 Fixed encoding for {fixed} audio track(s).");
    }
    fixed
}

/// Durée d'un fichier audio en secondes (arrondie), via ffprobe ; 0 si inconnue.
pub async fn probe_duration_secs(path: &Path) -> i32 {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .output()
        .await;
    match output {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
            .trim()
            .parse::<f64>()
            .map(|d| d.round() as i32)
            .unwrap_or(0),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repairs_latin1_mojibake() {
        assert!(looks_mis_decoded("CafÃ©"));
        assert_eq!(latin1_to_utf8("CafÃ©"), "Café");
        assert!(!looks_mis_decoded("Café"));
    }
}
