//! Routes principales (portage des routes définies directement dans
//! `server/routes.ts`) : utilisateurs, paramètres, console SQL, statistiques,
//! IA, médias, pistes audio, posts, publications planifiées, pages et
//! configurations.

mod agenda;
mod ai;
mod audio;
mod configs;
mod media;
mod overlays;
mod pages;
mod posts;
mod scheduled;
mod settings;
mod sql;
mod stats;
mod users;
mod validate;

use axum::http::StatusCode;
use axum::Router;
use serde_json::{json, Value};

use crate::error::AppError;
use crate::state::AppState;
use crate::time::Ts;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(users::router())
        .merge(settings::router())
        .merge(sql::router())
        .merge(stats::router())
        .merge(ai::router())
        .merge(media::router())
        .merge(overlays::router())
        .merge(audio::router())
        .merge(posts::router())
        .merge(scheduled::router())
        .merge(pages::router())
        .merge(configs::router())
}

/// `Number.parseInt(value, 10)` limité aux entiers positifs : `None` si la
/// valeur est absente, vide, illisible ou négative.
pub(crate) fn parse_positive_int(value: Option<&str>) -> Option<i64> {
    let value = value.filter(|v| !v.is_empty())?;
    // parseInt ignore les blancs de tête et s'arrête au premier caractère non numérique
    let rest = value.trim_start();
    let (negative, digits) = match rest.as_bytes().first() {
        Some(b'-') => (true, &rest[1..]),
        Some(b'+') => (false, &rest[1..]),
        _ => (false, rest),
    };
    let end = digits.bytes().take_while(u8::is_ascii_digit).count();
    if end == 0 {
        return None;
    }
    let parsed: i64 = digits[..end].parse().unwrap_or(i64::MAX);
    if negative && parsed != 0 {
        return None;
    }
    Some(parsed)
}

/// Paramètre de date (`new Date(value)`), ignoré s'il est vide ou illisible.
pub(crate) fn parse_date_param(value: Option<&str>) -> Option<Ts> {
    value.filter(|v| !v.is_empty()).and_then(Ts::parse)
}

/// Erreur de réception multer : elle passait par le gestionnaire d'erreurs
/// d'Express, qui répondait `500 { message }`.
pub(crate) fn upload_error(error: AppError) -> AppError {
    let message = error
        .body
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or("Internal Server Error");
    // multer : « Unexpected field » sans le nom du champ
    let message = if message.starts_with("Unexpected field") {
        "Unexpected field".to_string()
    } else {
        message.to_string()
    };
    AppError::json(
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({ "message": message }),
    )
}

/// Message d'une erreur sqlx tel que l'aurait donné le pilote `pg`
/// (message PostgreSQL brut pour une erreur de la base).
pub(crate) fn pg_message(error: &sqlx::Error) -> String {
    match error {
        sqlx::Error::Database(db) => db.message().to_string(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positive_int_like_parse_int() {
        assert_eq!(parse_positive_int(None), None);
        assert_eq!(parse_positive_int(Some("")), None);
        assert_eq!(parse_positive_int(Some("12")), Some(12));
        assert_eq!(parse_positive_int(Some(" 7abc")), Some(7));
        assert_eq!(parse_positive_int(Some("1e3")), Some(1));
        assert_eq!(parse_positive_int(Some("-3")), None);
        assert_eq!(parse_positive_int(Some("-0")), Some(0));
        assert_eq!(parse_positive_int(Some("abc")), None);
    }

    #[test]
    fn date_param() {
        assert!(parse_date_param(Some("")).is_none());
        assert!(parse_date_param(Some("nope")).is_none());
        assert_eq!(
            parse_date_param(Some("2026-10-01T00:00:00.000Z"))
                .unwrap()
                .to_iso(),
            "2026-10-01T00:00:00.000Z"
        );
    }
}
