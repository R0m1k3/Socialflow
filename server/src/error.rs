//! Erreurs HTTP au format attendu par le client : `{ "error": "message" }`.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

#[derive(Debug)]
pub struct AppError {
    pub status: StatusCode,
    pub body: Value,
}

pub type ApiResult<T = Response> = Result<T, AppError>;

impl AppError {
    /// Réponse `{ error: message }` avec le statut donné.
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            body: json!({ "error": message.into() }),
        }
    }

    /// Corps JSON libre (ex. `{ success: false, error }`).
    pub fn json(status: StatusCode, body: Value) -> Self {
        Self { status, body }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, message)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, message)
    }

    /// 500 avec un message fixe ; la cause est journalisée.
    pub fn internal_logged(message: impl Into<String>, cause: impl std::fmt::Display) -> Self {
        let message = message.into();
        tracing::error!("{message}: {cause}");
        Self::internal(message)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        AppError::internal_logged("Erreur de base de données", error)
    }
}

impl From<anyhow::Error> for AppError {
    fn from(error: anyhow::Error) -> Self {
        tracing::error!("{error:#}");
        AppError::internal(error.to_string())
    }
}

/// Raccourcis pour convertir une erreur en réponse 500 au message donné,
/// comme les `catch` des anciennes routes (`res.status(500).json({ error })`).
pub trait OrApiError<T> {
    /// Journalise la cause et renvoie `500 { error: message }`.
    fn or_500(self, message: &str) -> Result<T, AppError>;
    /// Renvoie `500 { error: <message de la cause> }`.
    fn or_500_cause(self) -> Result<T, AppError>;
}

impl<T, E: std::fmt::Display> OrApiError<T> for Result<T, E> {
    fn or_500(self, message: &str) -> Result<T, AppError> {
        self.map_err(|e| AppError::internal_logged(message, e))
    }

    fn or_500_cause(self) -> Result<T, AppError> {
        self.map_err(|e| {
            let message = e.to_string();
            tracing::error!("{message}");
            AppError::internal(message)
        })
    }
}
