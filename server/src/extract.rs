//! Extracteurs de requête.
//!
//! `Body<T>` reproduit `express.json()` + `express.urlencoded()` : un corps
//! JSON est lu tel quel, un formulaire est converti en objet, et une requête
//! sans corps donne `{}`. Les erreurs sortent au format `{ error }`.

use axum::body::Bytes;
use axum::extract::{FromRequest, FromRequestParts, Request};
use axum::http::header::CONTENT_TYPE;
use axum::http::request::Parts;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

use crate::error::AppError;

/// Taille maximale d'un corps JSON ou formulaire.
pub const MAX_JSON_BODY: usize = 25 * 1024 * 1024;

pub struct Body<T>(pub T);

impl<S, T> FromRequest<S> for Body<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = AppError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let content_type = req
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();

        let bytes = Bytes::from_request(req, state)
            .await
            .map_err(|e| AppError::new(e.status(), e.body_text()))?;

        let value = if bytes.iter().all(|b| b.is_ascii_whitespace()) {
            Value::Object(Map::new())
        } else if content_type.contains("json") {
            serde_json::from_slice::<Value>(&bytes)
                .map_err(|e| AppError::bad_request(format!("JSON invalide : {e}")))?
        } else if content_type.starts_with("application/x-www-form-urlencoded") {
            let pairs: Vec<(String, String)> = serde_urlencoded_pairs(&bytes);
            let mut map = Map::new();
            for (k, v) in pairs {
                map.insert(k, Value::String(v));
            }
            Value::Object(map)
        } else {
            Value::Object(Map::new())
        };

        let parsed = serde_json::from_value::<T>(value)
            .map_err(|e| AppError::bad_request(format!("Données invalides : {e}")))?;
        Ok(Body(parsed))
    }
}

fn serde_urlencoded_pairs(bytes: &[u8]) -> Vec<(String, String)> {
    url::form_urlencoded::parse(bytes)
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect()
}

/// Paramètres de requête bruts (`?a=1&b=2`), comme `req.query` (valeurs texte).
pub struct QueryMap(pub std::collections::HashMap<String, String>);

impl<S: Send + Sync> FromRequestParts<S> for QueryMap {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let mut map = std::collections::HashMap::new();
        if let Some(q) = parts.uri.query() {
            for (k, v) in url::form_urlencoded::parse(q.as_bytes()) {
                // Premier gagnant, comme une valeur simple d'Express
                map.entry(k.into_owned()).or_insert_with(|| v.into_owned());
            }
        }
        Ok(QueryMap(map))
    }
}

impl QueryMap {
    pub fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).map(|s| s.as_str())
    }

    /// Valeur non vide.
    pub fn non_empty(&self, key: &str) -> Option<&str> {
        self.get(key).filter(|v| !v.is_empty())
    }
}

/// Petits accesseurs pour lire un corps JSON dynamique comme en JavaScript.
pub trait JsonExt {
    /// Chaîne (non vide ou non) si la valeur est une chaîne.
    fn str_field(&self, key: &str) -> Option<&str>;
    /// Chaîne non vide après `trim()`.
    fn trimmed(&self, key: &str) -> Option<String>;
    /// Valeur « truthy » au sens JavaScript.
    fn truthy(&self, key: &str) -> bool;
}

impl JsonExt for Value {
    fn str_field(&self, key: &str) -> Option<&str> {
        self.get(key).and_then(Value::as_str)
    }

    fn trimmed(&self, key: &str) -> Option<String> {
        self.str_field(key)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    }

    fn truthy(&self, key: &str) -> bool {
        is_truthy(self.get(key))
    }
}

pub fn is_truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(false),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}
