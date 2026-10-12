//! Logique pure du service TikTok : découpage en chunks, choix de la
//! confidentialité, corps de l'initialisation et lecture des réponses de l'API.

use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::extract::is_truthy;

/// TikTok impose des chunks entre 5 Mo et 64 Mo.
pub const MAX_SINGLE_CHUNK_SIZE: i64 = 64 * 1024 * 1024;
pub const CHUNK_SIZE: i64 = 32 * 1024 * 1024;

/// Longueur maximale de la légende d'une vidéo TikTok.
pub const MAX_TITLE_LENGTH: usize = 2200;

/// Options réellement autorisées sur un compte, renvoyées telles quelles au client.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_avatar_url: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_username: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_nickname: Option<Value>,
    pub privacy_level_options: Vec<String>,
    pub comment_disabled: bool,
    pub duet_disabled: bool,
    pub stitch_disabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_video_post_duration_sec: Option<Value>,
}

impl CreatorInfo {
    /// Lecture du champ `data` de `creator_info/query`.
    pub fn from_data(data: &Value) -> Self {
        // Un champ absent reste absent (comme `undefined` côté JavaScript)
        let field = |key: &str| data.get(key).cloned();
        let privacy_level_options = data
            .get("privacy_level_options")
            .and_then(Value::as_array)
            .map(|options| {
                options
                    .iter()
                    .filter_map(|o| o.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        Self {
            creator_avatar_url: field("creator_avatar_url"),
            creator_username: field("creator_username"),
            creator_nickname: field("creator_nickname"),
            privacy_level_options,
            comment_disabled: data.truthy_field("comment_disabled"),
            duet_disabled: data.truthy_field("duet_disabled"),
            stitch_disabled: data.truthy_field("stitch_disabled"),
            max_video_post_duration_sec: field("max_video_post_duration_sec"),
        }
    }
}

/// Préférences de publication (toutes facultatives).
#[derive(Debug, Clone, Default)]
pub struct PublishOptions {
    pub privacy_level: Option<String>,
    pub disable_comment: bool,
    pub disable_duet: bool,
    pub disable_stitch: bool,
}

/// État d'une publication renvoyé par `/post/publish/status/fetch/`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PublishStatus {
    pub status: Option<String>,
    pub fail_reason: Option<String>,
    pub post_id: Option<String>,
}

impl PublishStatus {
    pub fn from_data(data: &Value) -> Self {
        // Le nom du champ comporte bien une faute de frappe côté API TikTok
        let ids = [
            data.get("publicaly_available_post_id"),
            data.get("publicly_available_post_id"),
        ]
        .into_iter()
        .flatten()
        .find(|v| is_truthy(Some(v)));
        let post_id = ids
            .and_then(Value::as_array)
            .and_then(|ids| ids.first())
            .and_then(js_string);
        Self {
            status: data.get("status").and_then(js_string),
            fail_reason: data.get("fail_reason").and_then(js_string),
            post_id,
        }
    }
}

/// Jetons renvoyés par `/oauth/token/`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TokenResponse {
    pub access_token: String,
    pub expires_in: Option<f64>,
    pub open_id: Option<String>,
    pub refresh_token: Option<String>,
    pub refresh_expires_in: Option<f64>,
    pub scope: Option<String>,
}

impl TokenResponse {
    pub fn from_value(data: &Value) -> Self {
        Self {
            access_token: data
                .get("access_token")
                .and_then(js_string)
                .unwrap_or_default(),
            expires_in: data.get("expires_in").and_then(Value::as_f64),
            open_id: data.get("open_id").and_then(js_string),
            refresh_token: data.get("refresh_token").and_then(js_string),
            refresh_expires_in: data.get("refresh_expires_in").and_then(Value::as_f64),
            scope: data.get("scope").and_then(js_string),
        }
    }
}

trait TruthyField {
    fn truthy_field(&self, key: &str) -> bool;
}

impl TruthyField for Value {
    fn truthy_field(&self, key: &str) -> bool {
        is_truthy(self.get(key))
    }
}

/// Valeur scalaire convertie en texte (`String(x)`), `None` pour null / objet.
pub fn js_string(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

/// Rendu d'une valeur dans un gabarit JavaScript (`${x}`).
pub fn js_display(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Object(_) => "[object Object]".into(),
        Value::Array(items) => items
            .iter()
            .map(|v| match v {
                Value::Null => String::new(),
                other => js_display(other),
            })
            .collect::<Vec<_>>()
            .join(","),
        other => js_string(other).unwrap_or_default(),
    }
}

/// Première valeur « truthy » d'une chaîne de `a || b || …`, rendue en texte.
pub fn first_truthy(values: &[Option<&Value>]) -> Option<String> {
    values
        .iter()
        .find(|v| is_truthy(**v))
        .and_then(|v| v.map(js_display))
}

/// `s.slice(0, n)` : longueur comptée en unités UTF-16, comme en JavaScript
/// (sans couper un caractère en deux).
pub fn js_slice(s: &str, max: usize) -> String {
    let mut used = 0;
    let mut out = String::new();
    for c in s.chars() {
        used += c.len_utf16();
        if used > max {
            break;
        }
        out.push(c);
    }
    out
}

/// Découpage du fichier : un seul chunk jusqu'à 64 Mo, sinon des chunks de 32 Mo,
/// le dernier absorbant le reliquat (règle imposée par TikTok).
pub fn compute_chunking(video_size: i64) -> (i64, i64) {
    if video_size <= MAX_SINGLE_CHUNK_SIZE {
        return (video_size, 1);
    }
    (CHUNK_SIZE, video_size / CHUNK_SIZE)
}

/// Bornes (incluses) du chunk `index`.
pub fn chunk_range(index: i64, chunk_size: i64, total: i64, video_size: i64) -> (i64, i64) {
    let start = index * chunk_size;
    // Le dernier chunk absorbe le reliquat
    let end = if index == total - 1 {
        video_size - 1
    } else {
        start + chunk_size - 1
    };
    (start, end)
}

/// Choisit un niveau de confidentialité réellement autorisé sur le compte.
/// Sans audit TikTok validé, seul SELF_ONLY est proposé : on s'y rabat plutôt
/// que d'échouer, en le signalant dans les logs.
pub fn resolve_privacy_level(
    info: &CreatorInfo,
    requested: Option<&str>,
    page_name: &str,
) -> anyhow::Result<String> {
    let options = &info.privacy_level_options;

    if options.is_empty() {
        anyhow::bail!(
            "Le compte TikTok \"{page_name}\" ne propose aucun niveau de confidentialité. \
             Vérifiez que le compte est bien autorisé et que l'application dispose du scope video.publish."
        );
    }

    let wanted = requested
        .filter(|r| !r.is_empty())
        .unwrap_or("PUBLIC_TO_EVERYONE");
    if options.iter().any(|o| o == wanted) {
        return Ok(wanted.to_string());
    }

    let fallback = if options.iter().any(|o| o == "SELF_ONLY") {
        "SELF_ONLY".to_string()
    } else {
        options[0].clone()
    };
    tracing::warn!(
        "⚠️ [TikTok] \"{wanted}\" indisponible sur {page_name} (options: {}). \
         Publication en {fallback}. Tant que l'application TikTok n'est pas auditée, \
         les vidéos restent privées.",
        options.join(", ")
    );
    Ok(fallback)
}

/// Corps de `/post/publish/video/init/`.
pub fn build_init_body(
    caption: &str,
    privacy_level: &str,
    info: &CreatorInfo,
    options: &PublishOptions,
    video_size: i64,
    chunk_size: i64,
    total_chunk_count: i64,
) -> Value {
    json!({
        "post_info": {
            "title": js_slice(caption, MAX_TITLE_LENGTH),
            "privacy_level": privacy_level,
            // Une option désactivée côté compte doit obligatoirement être déclarée désactivée
            "disable_comment": info.comment_disabled || options.disable_comment,
            "disable_duet": info.duet_disabled || options.disable_duet,
            "disable_stitch": info.stitch_disabled || options.disable_stitch,
        },
        "source_info": {
            "source": "FILE_UPLOAD",
            "video_size": video_size,
            "chunk_size": chunk_size,
            "total_chunk_count": total_chunk_count,
        },
    })
}

/// Les endpoints v2 répondent HTTP 200 avec `error.code === 'ok'` en cas de succès :
/// il ne suffit pas de regarder le statut HTTP. Renvoie le champ `data` (ou `{}`).
pub fn parse_api_payload(status: u16, ok: bool, raw: &str, context: &str) -> anyhow::Result<Value> {
    let payload: Value = serde_json::from_str(raw).map_err(|_| {
        anyhow::anyhow!(
            "Réponse TikTok illisible lors de la {context} ({status}): {}",
            js_slice(raw, 200)
        )
    })?;

    let error_code = payload.get("error").and_then(|e| e.get("code"));
    let has_error_code = is_truthy(error_code) && error_code != Some(&Value::from("ok"));
    if !ok || has_error_code {
        let message = first_truthy(&[payload.get("error").and_then(|e| e.get("message"))])
            .unwrap_or_else(|| js_slice(raw, 200));
        let code = first_truthy(&[error_code]).unwrap_or_else(|| status.to_string());
        anyhow::bail!("Erreur TikTok lors de la {context}: {message} (code: {code})");
    }

    Ok(match payload.get("data") {
        Some(data) if is_truthy(Some(data)) => data.clone(),
        _ => Value::Object(Map::new()),
    })
}

/// Lecture de la réponse de `/oauth/token/` (erreurs signalées par `error` +
/// `error_description`).
pub fn parse_token_payload(status: u16, ok: bool, raw: &str) -> anyhow::Result<TokenResponse> {
    let data: Value = serde_json::from_str(raw).map_err(|_| {
        anyhow::anyhow!(
            "Réponse TikTok illisible ({status}): {}",
            js_slice(raw, 200)
        )
    })?;

    if !ok || is_truthy(data.get("error")) {
        let description = first_truthy(&[data.get("error_description"), data.get("error")])
            .unwrap_or_else(|| js_slice(raw, 200));
        anyhow::bail!("Erreur OAuth TikTok: {description}");
    }

    if !is_truthy(data.get("access_token")) {
        anyhow::bail!("Réponse TikTok inattendue : aucun access token reçu");
    }

    Ok(TokenResponse::from_value(&data))
}

/// `decodeURIComponent` : échoue (« URI malformed ») sur une séquence `%` invalide.
pub fn decode_uri_component(value: &str) -> anyhow::Result<String> {
    let bytes = value.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let valid = i + 2 < bytes.len()
                && bytes[i + 1].is_ascii_hexdigit()
                && bytes[i + 2].is_ascii_hexdigit();
            if !valid {
                anyhow::bail!("URI malformed");
            }
            i += 3;
        } else {
            i += 1;
        }
    }
    percent_encoding::percent_decode_str(value)
        .decode_utf8()
        .map(|s| s.into_owned())
        .map_err(|_| anyhow::anyhow!("URI malformed"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(options: &[&str]) -> CreatorInfo {
        CreatorInfo {
            privacy_level_options: options.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn chunking_follows_tiktok_rules() {
        assert_eq!(compute_chunking(10), (10, 1));
        assert_eq!(
            compute_chunking(MAX_SINGLE_CHUNK_SIZE),
            (MAX_SINGLE_CHUNK_SIZE, 1)
        );
        let size = 100 * 1024 * 1024;
        assert_eq!(compute_chunking(size), (CHUNK_SIZE, 3));
        // Le dernier chunk absorbe le reliquat
        assert_eq!(
            chunk_range(2, CHUNK_SIZE, 3, size),
            (2 * CHUNK_SIZE, size - 1)
        );
        assert_eq!(chunk_range(0, CHUNK_SIZE, 3, size), (0, CHUNK_SIZE - 1));
        assert_eq!(chunk_range(0, 10, 1, 10), (0, 9));
    }

    #[test]
    fn privacy_level_falls_back_to_self_only() {
        let all = info(&["PUBLIC_TO_EVERYONE", "SELF_ONLY"]);
        assert_eq!(
            resolve_privacy_level(&all, None, "p").unwrap(),
            "PUBLIC_TO_EVERYONE"
        );
        assert_eq!(
            resolve_privacy_level(&all, Some("SELF_ONLY"), "p").unwrap(),
            "SELF_ONLY"
        );
        let private = info(&["MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"]);
        assert_eq!(
            resolve_privacy_level(&private, None, "p").unwrap(),
            "SELF_ONLY"
        );
        let other = info(&["FOLLOWER_OF_CREATOR"]);
        assert_eq!(
            resolve_privacy_level(&other, None, "p").unwrap(),
            "FOLLOWER_OF_CREATOR"
        );
        let err = resolve_privacy_level(&info(&[]), None, "Magasin").unwrap_err();
        assert!(err
            .to_string()
            .starts_with("Le compte TikTok \"Magasin\" ne propose aucun niveau"));
    }

    #[test]
    fn init_body_forces_account_restrictions() {
        let mut creator = info(&["SELF_ONLY"]);
        creator.duet_disabled = true;
        let options = PublishOptions {
            disable_comment: true,
            ..Default::default()
        };
        let body = build_init_body("Bonjour", "SELF_ONLY", &creator, &options, 10, 10, 1);
        assert_eq!(
            body,
            json!({
                "post_info": {
                    "title": "Bonjour",
                    "privacy_level": "SELF_ONLY",
                    "disable_comment": true,
                    "disable_duet": true,
                    "disable_stitch": false,
                },
                "source_info": {
                    "source": "FILE_UPLOAD",
                    "video_size": 10,
                    "chunk_size": 10,
                    "total_chunk_count": 1,
                },
            })
        );
        let long = "é".repeat(3000);
        let body = build_init_body(&long, "SELF_ONLY", &creator, &options, 1, 1, 1);
        assert_eq!(
            body["post_info"]["title"].as_str().unwrap().chars().count(),
            2200
        );
        // Un emoji compte pour deux unités UTF-16
        assert_eq!(js_slice("😀😀", 3), "😀");
    }

    #[test]
    fn api_payload_errors() {
        let ok = r#"{"data":{"publish_id":"p1"},"error":{"code":"ok","message":""}}"#;
        assert_eq!(
            parse_api_payload(200, true, ok, "x").unwrap(),
            json!({"publish_id":"p1"})
        );
        let failed =
            r#"{"data":{},"error":{"code":"access_token_invalid","message":"Token invalide"}}"#;
        assert_eq!(
            parse_api_payload(401, false, failed, "suivi de la publication")
                .unwrap_err()
                .to_string(),
            "Erreur TikTok lors de la suivi de la publication: Token invalide (code: access_token_invalid)"
        );
        assert_eq!(
            parse_api_payload(500, false, "{}", "ctx")
                .unwrap_err()
                .to_string(),
            "Erreur TikTok lors de la ctx: {} (code: 500)"
        );
        assert_eq!(
            parse_api_payload(502, false, "<html>", "ctx")
                .unwrap_err()
                .to_string(),
            "Réponse TikTok illisible lors de la ctx (502): <html>"
        );
        assert_eq!(
            parse_api_payload(200, true, r#"{"error":{"code":"ok"}}"#, "x").unwrap(),
            json!({})
        );
    }

    #[test]
    fn token_payload() {
        let raw = r#"{"access_token":"a","expires_in":86400,"open_id":"o","refresh_token":"r","refresh_expires_in":31536000,"scope":"user.info.basic","token_type":"Bearer"}"#;
        let tokens = parse_token_payload(200, true, raw).unwrap();
        assert_eq!(tokens.access_token, "a");
        assert_eq!(tokens.expires_in, Some(86400.0));
        assert_eq!(tokens.open_id.as_deref(), Some("o"));
        let err = r#"{"error":"invalid_grant","error_description":"Code expiré"}"#;
        assert_eq!(
            parse_token_payload(400, false, err)
                .unwrap_err()
                .to_string(),
            "Erreur OAuth TikTok: Code expiré"
        );
        assert_eq!(
            parse_token_payload(200, true, "{}")
                .unwrap_err()
                .to_string(),
            "Réponse TikTok inattendue : aucun access token reçu"
        );
    }

    #[test]
    fn publish_status_reads_misspelled_field() {
        let status = PublishStatus::from_data(&json!({
            "status": "PUBLISH_COMPLETE",
            "publicaly_available_post_id": [7301234567890123456u64]
        }));
        assert_eq!(status.status.as_deref(), Some("PUBLISH_COMPLETE"));
        assert_eq!(status.post_id.as_deref(), Some("7301234567890123456"));
        let status = PublishStatus::from_data(&json!({
            "status": "FAILED", "fail_reason": "spam", "publicly_available_post_id": []
        }));
        assert_eq!(status.fail_reason.as_deref(), Some("spam"));
        assert_eq!(status.post_id, None);
    }

    #[test]
    fn creator_info_serialization() {
        let info = CreatorInfo::from_data(&json!({
            "creator_username": "magasin",
            "privacy_level_options": ["SELF_ONLY"],
            "comment_disabled": true,
        }));
        assert_eq!(
            serde_json::to_value(&info).unwrap(),
            json!({
                "creatorUsername": "magasin",
                "privacyLevelOptions": ["SELF_ONLY"],
                "commentDisabled": true,
                "duetDisabled": false,
                "stitchDisabled": false,
            })
        );
    }

    #[test]
    fn uri_component_decoding() {
        assert_eq!(decode_uri_component("a%2Ab%20c").unwrap(), "a*b c");
        assert_eq!(decode_uri_component("plain").unwrap(), "plain");
        assert!(decode_uri_component("bad%zz").is_err());
        assert!(decode_uri_component("bad%2").is_err());
        assert!(decode_uri_component("%FF").is_err());
    }
}
