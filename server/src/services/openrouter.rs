//! Génération de textes par IA (OpenRouter).
//!
//! Portage de `server/services/openrouter.ts` : trois variantes de texte sont
//! demandées au modèle, puis extraites de sa réponse en essayant plusieurs
//! formats d'en-têtes (« VERSION 1 - DYNAMIQUE », en gras Markdown ou non).

use axum::http::StatusCode;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::state::AppState;

const CHAT_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const MODELS_URL: &str = "https://openrouter.ai/api/v1/models";

/// Génère les variantes de texte (`{ variant, text, characterCount }`).
pub async fn generate_post_text(
    state: &AppState,
    product_info: &Value,
    user_id: &str,
    model_override: Option<&str>,
) -> anyhow::Result<Vec<Value>> {
    // Configuration de l'utilisateur, sinon la dernière configuration enregistrée
    let config = match state.db.get_openrouter_config(user_id).await? {
        Some(config) => Some(config),
        None => state.db.get_any_openrouter_config().await?,
    };
    let Some(config) = config else {
        anyhow::bail!(
            "Configuration OpenRouter non trouvée. Veuillez demander à un administrateur de configurer OpenRouter dans les Paramètres."
        );
    };
    if config.api_key.trim().is_empty() {
        anyhow::bail!(
            "Clé API OpenRouter manquante ou vide en base de données. Veuillez la ressaisir dans les Paramètres."
        );
    }

    let prompt = build_prompt(product_info, &config.system_prompt);
    let model = model_override
        .filter(|m| !m.is_empty())
        .unwrap_or(&config.model)
        .to_string();

    let fingerprint = hex::encode(Sha256::digest(config.api_key.as_bytes()));
    tracing::info!(
        "[OpenRouter] Generating with model=\"{model}\" keyFingerprint={} keyLength={} configUserId={}",
        &fingerprint[..8],
        config.api_key.chars().count(),
        config.user_id
    );

    let referer = state
        .config
        .app_url
        .clone()
        .unwrap_or_else(|| "http://localhost:5555".into());
    let response = state
        .http
        .post(CHAT_URL)
        .bearer_auth(config.api_key.trim())
        .header("HTTP-Referer", referer)
        .header("X-Title", "Social Flow")
        .json(&json!({
            "model": model,
            "messages": [{ "role": "user", "content": prompt }],
            "temperature": 0.8,
            "max_tokens": 1000,
        }))
        .send()
        .await
        .inspect_err(|e| tracing::error!("Error generating text with OpenRouter: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        tracing::error!("OpenRouter API Error Response: {body}");
        // Le motif renvoyé par OpenRouter (clé invalide, crédits épuisés, modèle
        // inconnu…) est la seule information exploitable pour l'utilisateur.
        anyhow::bail!(
            "OpenRouter a refusé la requête ({} {}) avec le modèle \"{model}\" : {}",
            status.as_u16(),
            status.canonical_reason().unwrap_or(""),
            extract_upstream_message(&body)
        );
    }

    let data: Value = response.json().await?;
    let content = match data.get("choices").and_then(|c| c.get(0)) {
        Some(choice) if !choice.is_null() => choice
            .pointer("/message/content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        _ => {
            tracing::error!(
                "Invalid OpenRouter response - no choices (hasChoices: {}, model: {model})",
                data.get("choices").is_some()
            );
            anyhow::bail!(
                "Réponse invalide de l'API OpenRouter. Vérifiez votre clé API et votre modèle."
            );
        }
    };

    Ok(parse_generated_text(&content))
}

/// Statut HTTP et message à renvoyer pour une erreur de génération.
pub fn describe_generation_error(error: &anyhow::Error) -> (StatusCode, String) {
    let message = error.to_string();
    // Problème de configuration : l'administrateur peut le corriger lui-même
    if message.contains("Configuration OpenRouter non trouvée")
        || message.contains("Clé API OpenRouter manquante")
    {
        return (StatusCode::BAD_REQUEST, message);
    }
    // Refus du service tiers
    if message.contains("OpenRouter a refusé la requête")
        || message.contains("Réponse invalide de l'API OpenRouter")
    {
        return (StatusCode::BAD_GATEWAY, message);
    }
    (StatusCode::INTERNAL_SERVER_ERROR, message)
}

/// Modèles proposés par OpenRouter (champ `data` de leur API).
pub async fn get_available_models(state: &AppState) -> anyhow::Result<Vec<Value>> {
    let response = state.http.get(MODELS_URL).send().await?;
    let status = response.status();
    if !status.is_success() {
        anyhow::bail!(
            "Failed to fetch models: {} {}",
            status.as_u16(),
            status.canonical_reason().unwrap_or("")
        );
    }
    let data: Value = response.json().await?;
    Ok(match data.get("data") {
        Some(Value::Array(models)) => models.clone(),
        _ => Vec::new(),
    })
}

/// Message d'erreur d'une réponse OpenRouter (JSON `{ error: { message } }` ou
/// texte brut), tronqué pour ne pas déverser une page HTML dans l'interface.
fn extract_upstream_message(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return "aucun détail fourni".into();
    }
    if let Ok(parsed) = serde_json::from_str::<Value>(trimmed) {
        let candidates = [
            parsed.pointer("/error/message"),
            parsed.get("message"),
            parsed.get("error"),
        ];
        // Premier champ « truthy », comme `a || b || c`
        let message = candidates
            .into_iter()
            .flatten()
            .find(|v| crate::extract::is_truthy(Some(v)));
        if let Some(Value::String(message)) = message {
            if !message.trim().is_empty() {
                return truncate_utf16(message.trim(), 300);
            }
        }
    }
    static SPACES: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+").unwrap());
    truncate_utf16(&SPACES.replace_all(trimmed, " "), 300)
}

/// `text.slice(0, max)` en unités UTF-16, sans couper un caractère.
fn truncate_utf16(text: &str, max: usize) -> String {
    let mut units = 0;
    let mut out = String::new();
    for c in text.chars() {
        units += c.len_utf16();
        if units > max {
            break;
        }
        out.push(c);
    }
    out
}

/// Longueur JavaScript (`string.length`) : nombre d'unités UTF-16.
fn js_length(text: &str) -> usize {
    text.encode_utf16().count()
}

/// Conversion d'une valeur en texte comme un gabarit JavaScript (`${value}`).
fn js_string(value: Option<&Value>) -> String {
    match value {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => js_number(n),
        Some(Value::Array(items)) => items
            .iter()
            .map(|v| match v {
                Value::Null => String::new(),
                other => js_string(Some(other)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}

fn js_number(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    match n.as_f64() {
        Some(f) if f.fract() == 0.0 && f.abs() < 1e21 => format!("{f:.0}"),
        Some(f) => f.to_string(),
        None => n.to_string(),
    }
}

fn build_prompt(product_info: &Value, system_prompt: &str) -> String {
    let truthy = |key: &str| crate::extract::is_truthy(product_info.get(key));
    // `features?.join(", ")`
    let features = match product_info.get("features") {
        Some(Value::Array(items)) => items
            .iter()
            .map(|v| match v {
                Value::Null => String::new(),
                other => js_string(Some(other)),
            })
            .collect::<Vec<_>>()
            .join(", "),
        _ => String::new(),
    };

    let description = if truthy("description") {
        format!(
            "Description: {}",
            js_string(product_info.get("description"))
        )
    } else {
        String::new()
    };
    let price = if truthy("price") {
        format!("Prix: {}", js_string(product_info.get("price")))
    } else {
        String::new()
    };
    let features = if features.is_empty() {
        String::new()
    } else {
        format!("Caractéristiques: {features}")
    };
    let product_details = format!(
        "Nom: {}\n{description}\n{price}\n{features}",
        js_string(product_info.get("name"))
    );

    format!(
        "{system_prompt}\n\nInformations produit:\n{product_details}\n\nFormat de réponse:\nVERSION 1 - DYNAMIQUE:\n[texte]\n\nVERSION 2 - INFORMATIVE:\n[texte]\n\nVERSION 3 - ÉMOTIONNELLE:\n[texte]"
    )
}

fn variant(name: &str, text: &str) -> Value {
    json!({ "variant": name, "text": text, "characterCount": js_length(text) })
}

fn parse_generated_text(content: &str) -> Vec<Value> {
    let normalized = content.replace("\r\n", "\n");
    let normalized = normalized.trim();
    tracing::info!(
        "🔍 Parsing AI response (length: {} )",
        js_length(normalized)
    );

    let variants = try_multiple_parsing_strategies(normalized);
    if !variants.is_empty() {
        tracing::info!("✅ Parsed successfully: {} variants", variants.len());
        return variants;
    }

    tracing::info!("⚠️ Parsing failed, using fallback");
    vec![variant("Généré par IA", normalized)]
}

fn try_multiple_parsing_strategies(content: &str) -> Vec<Value> {
    let strategy1 = parse_by_version_headers(content);
    if strategy1.len() >= 3 {
        return strategy1;
    }
    let strategy2 = parse_with_headers(content, true);
    if strategy2.len() >= 3 {
        return strategy2;
    }
    let strategy3 = parse_with_headers(content, false);
    if strategy3.len() >= 3 {
        return strategy3;
    }
    if !strategy1.is_empty() {
        strategy1
    } else if !strategy2.is_empty() {
        strategy2
    } else {
        strategy3
    }
}

fn parse_by_version_headers(content: &str) -> Vec<Value> {
    static HEADER: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?i)(?:\*{2})?VERSION\s+([0-9]+)\s*[-–—]\s*([A-ZÀÂÄÉÈÊËÏÎÔÙÛÜ]+)(?:\*{2})?:?")
            .unwrap()
    });
    static SEPARATORS: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^[-*]{3,}\s*").unwrap());
    static NOTES: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^\([^)]+\)\s*").unwrap());

    let matches: Vec<regex::Captures> = HEADER.captures_iter(content).collect();
    let mut variants = Vec::new();
    if matches.len() < 3 {
        return variants;
    }
    for (i, caps) in matches.iter().enumerate() {
        let whole = caps.get(0).expect("groupe 0");
        let end = matches
            .get(i + 1)
            .and_then(|next| next.get(0))
            .map(|m| m.start())
            .unwrap_or(content.len());
        let text = content[whole.end()..end].trim();
        let text = SEPARATORS.replace_all(text, "");
        let text = NOTES.replace_all(&text, "");
        let text = text.trim();
        if !text.is_empty() {
            let style = capitalize_first(&caps[2].to_lowercase());
            variants.push(variant(&format!("Version {} - {style}", &caps[1]), text));
        }
    }
    variants
}

/// Stratégies 2 et 3 : en-têtes attendus un par un, en gras Markdown ou non.
/// Les regex JavaScript utilisaient un lookahead `(?=VERSION 2|$)`, que l'on
/// reproduit en cherchant l'en-tête suivant à partir de la fin du courant.
fn parse_with_headers(content: &str, markdown: bool) -> Vec<Value> {
    static MD: Lazy<[Regex; 5]> = Lazy::new(|| {
        [
            Regex::new(r"(?i)\*{2}VERSION\s+1\s*[-–—]\s*DYNAMIQUE:?\*{2}\s*\n").unwrap(),
            Regex::new(r"(?i)\*{2}VERSION\s+2\s*[-–—]\s*INFORMATIVE?:?\*{2}\s*\n").unwrap(),
            Regex::new(r"(?i)\*{2}VERSION\s+3\s*[-–—]\s*[ÉE]MOTIONNELLE?:?\*{2}\s*\n").unwrap(),
            Regex::new(r"(?i)\*{2}VERSION\s+2").unwrap(),
            Regex::new(r"(?i)\*{2}VERSION\s+3").unwrap(),
        ]
    });
    static PLAIN: Lazy<[Regex; 5]> = Lazy::new(|| {
        [
            Regex::new(r"(?i)VERSION\s+1\s*[-–—]\s*DYNAMIQUE:?\s*\n").unwrap(),
            Regex::new(r"(?i)VERSION\s+2\s*[-–—]\s*INFORMATIVE?:?\s*\n").unwrap(),
            Regex::new(r"(?i)VERSION\s+3\s*[-–—]\s*[ÉE]MOTIONNELLE?:?\s*\n").unwrap(),
            Regex::new(r"(?i)VERSION\s+2").unwrap(),
            Regex::new(r"(?i)VERSION\s+3").unwrap(),
        ]
    });
    let [v1, v2, v3, stop2, stop3] = if markdown { &*MD } else { &*PLAIN };

    let section = |header: &Regex, stop: Option<&Regex>| -> Option<String> {
        let found = header.find(content)?;
        let end = stop
            .and_then(|s| s.find_at(content, found.end()))
            .map(|m| m.start())
            .unwrap_or(content.len());
        Some(content[found.end()..end].trim().to_string())
    };

    let mut variants = Vec::new();
    if let Some(text) = section(v1, Some(stop2)) {
        variants.push(variant("Version 1 - Dynamique", &text));
    }
    if let Some(text) = section(v2, Some(stop3)) {
        variants.push(variant("Version 2 - Informative", &text));
    }
    if let Some(text) = section(v3, None) {
        variants.push(variant("Version 3 - Émotionnelle", &text));
    }
    variants
}

fn capitalize_first(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(variants: &[Value]) -> Vec<(String, String)> {
        variants
            .iter()
            .map(|v| {
                (
                    v["variant"].as_str().unwrap().to_string(),
                    v["text"].as_str().unwrap().to_string(),
                )
            })
            .collect()
    }

    #[test]
    fn parses_plain_version_headers() {
        let content = "VERSION 1 - DYNAMIQUE:\nSuper promo !\n\nVERSION 2 - INFORMATIVE:\n(note)\nProduit de qualité.\n---\nVERSION 3 - ÉMOTIONNELLE:\nUn coup de cœur 😍";
        let parsed = parse_generated_text(content);
        assert_eq!(
            texts(&parsed),
            vec![
                ("Version 1 - Dynamique".into(), "Super promo !".into()),
                (
                    "Version 2 - Informative".into(),
                    "Produit de qualité.".into()
                ),
                (
                    "Version 3 - Émotionnelle".into(),
                    "Un coup de cœur 😍".into()
                ),
            ]
        );
        // Longueur JavaScript : l'émoji compte pour deux
        assert_eq!(parsed[2]["characterCount"], 18);
    }

    #[test]
    fn parses_markdown_headers() {
        let content = "**VERSION 1 – DYNAMIQUE**\nA\n\n**VERSION 2 – INFORMATIVE**\nB\n\n**VERSION 3 – émotionnelle**\nC";
        let parsed = parse_generated_text(content);
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0]["text"], "A");
        assert_eq!(parsed[2]["variant"], "Version 3 - Émotionnelle");
    }

    #[test]
    fn fallback_returns_whole_text() {
        let parsed = parse_generated_text("  Juste un texte\r\n ");
        assert_eq!(
            texts(&parsed),
            vec![("Généré par IA".into(), "Juste un texte".into())]
        );
    }

    #[test]
    fn markdown_lookahead_strategy() {
        // Une seule version reconnue par la stratégie 1 : la stratégie 2 prend le relais
        let content = "**VERSION 1 - DYNAMIQUE:**\nUn\n**VERSION 2 - INFORMATIV:**\nDeux\n**VERSION 3 - EMOTIONNELL:**\nTrois";
        let parsed = parse_with_headers(content, true);
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[1]["text"], "Deux");
    }

    #[test]
    fn prompt_matches_template() {
        let prompt = build_prompt(
            &json!({ "name": "Vase", "price": 12, "features": ["bleu", "verre"] }),
            "SYS",
        );
        assert!(prompt.starts_with("SYS\n\nInformations produit:\nNom: Vase\n\nPrix: 12\nCaractéristiques: bleu, verre\n\nFormat de réponse:"));
        let missing = build_prompt(&json!({}), "S");
        assert!(missing.contains("Nom: undefined\n\n\n\n"));
    }

    #[test]
    fn upstream_messages() {
        assert_eq!(extract_upstream_message(""), "aucun détail fourni");
        assert_eq!(
            extract_upstream_message(r#"{"error":{"message":" Invalid key "}}"#),
            "Invalid key"
        );
        assert_eq!(
            extract_upstream_message("<html>\n  oops </html>"),
            "<html> oops </html>"
        );
    }

    #[test]
    fn generation_error_statuses() {
        let e = anyhow::anyhow!("Configuration OpenRouter non trouvée. Veuillez…");
        assert_eq!(describe_generation_error(&e).0, StatusCode::BAD_REQUEST);
        let e = anyhow::anyhow!("OpenRouter a refusé la requête (401 Unauthorized)");
        assert_eq!(describe_generation_error(&e).0, StatusCode::BAD_GATEWAY);
        let e = anyhow::anyhow!("boom");
        assert_eq!(
            describe_generation_error(&e),
            (StatusCode::INTERNAL_SERVER_ERROR, "boom".into())
        );
    }
}
