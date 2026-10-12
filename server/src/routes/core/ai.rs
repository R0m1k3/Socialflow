//! Génération de textes par IA et configuration d'OpenRouter.

use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};

use super::validate::{Issues, Presence};
use crate::auth::{AdminUser, AuthUser};
use crate::db::Patch;
use crate::error::{ApiResult, AppError, OrApiError};
use crate::extract::Body;
use crate::services::openrouter;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/ai/models", get(models))
        .route("/api/ai/generate", post(generate))
        .route("/api/ai/generations", get(generations))
        .route("/api/openrouter/models", get(openrouter_models))
        .route("/api/openrouter/config", get(get_config).post(save_config))
}

async fn models(State(state): State<AppState>, _admin: AdminUser) -> ApiResult<Json<Value>> {
    let models = openrouter::get_available_models(&state)
        .await
        .or_500("Failed to fetch models")?;
    Ok(Json(json!({ "models": models })))
}

async fn generate(
    State(state): State<AppState>,
    user: AuthUser,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    // `{ model, ...productInfo } = req.body`
    let mut product_info = match body {
        Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    let model = product_info.remove("model");
    let model = model.as_ref().and_then(Value::as_str);
    let product_info = Value::Object(product_info);

    let result = async {
        let texts = openrouter::generate_post_text(&state, &product_info, &user.id, model).await?;
        state
            .db
            .create_ai_generation(&user.id, &product_info, &Value::Array(texts.clone()))
            .await?;
        anyhow::Ok(texts)
    }
    .await;

    match result {
        Ok(texts) => Ok(Json(json!({ "variants": texts }))),
        Err(error) => {
            tracing::error!("Error generating text: {error:#}");
            let (status, message) = openrouter::describe_generation_error(&error);
            Err(AppError::new(status, message))
        }
    }
}

async fn generations(State(state): State<AppState>, admin: AdminUser) -> ApiResult<Json<Value>> {
    let generations = state
        .db
        .get_ai_generations(&admin.id)
        .await
        .or_500("Failed to fetch AI generations")?;
    Ok(Json(json!(generations)))
}

/// Catalogue brut des modèles OpenRouter, relayé tel quel.
async fn openrouter_models(
    State(state): State<AppState>,
    _user: AuthUser,
) -> ApiResult<Json<Value>> {
    let result = async {
        let response = state
            .http
            .get("https://openrouter.ai/api/v1/models")
            .send()
            .await?;
        if !response.status().is_success() {
            anyhow::bail!("OpenRouter API error: {}", response.status().as_u16());
        }
        Ok(response.json::<Value>().await?)
    }
    .await;
    result.or_500("Failed to fetch OpenRouter models").map(Json)
}

async fn get_config(State(state): State<AppState>, admin: AdminUser) -> ApiResult<Json<Value>> {
    let config = state
        .db
        .get_openrouter_config(&admin.id)
        .await
        .or_500("Failed to fetch OpenRouter config")?;
    // La clé API n'est jamais sérialisée
    Ok(Json(json!(config)))
}

async fn save_config(
    State(state): State<AppState>,
    admin: AdminUser,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Failed to save OpenRouter config";
    let failed = |reason: String| {
        tracing::error!("Error saving OpenRouter config: {reason}");
        AppError::internal(FAILED)
    };

    let existing = state
        .db
        .get_openrouter_config(&admin.id)
        .await
        .or_500(FAILED)?;

    // Schéma zod : clé API « trim().min(1) », modèle et prompt texte facultatifs
    let mut issues = Issues::new();
    let presence = if existing.is_some() {
        Presence::Optional
    } else {
        Presence::Required
    };
    let api_key = issues
        .string(&body, "apiKey", presence)
        .into_option()
        .map(|k| k.trim().to_string());
    if api_key.as_deref() == Some("") {
        return Err(failed("apiKey : La clé API ne peut pas être vide".into()));
    }
    let model = issues
        .string(&body, "model", Presence::Optional)
        .into_option();
    let system_prompt = issues
        .string(&body, "systemPrompt", Presence::Optional)
        .into_option();
    if !issues.is_empty() {
        return Err(failed(issues.zod_message()));
    }

    let config = match existing {
        Some(existing) => {
            let api_key = api_key
                .filter(|k| !k.is_empty())
                .unwrap_or(existing.api_key);
            if api_key.is_empty() {
                return Err(AppError::bad_request(
                    "Clé API OpenRouter manquante. Veuillez entrer une clé API valide.",
                ));
            }
            let mut patch = Patch::new()
                .set("user_id", admin.id.as_str())
                .set("api_key", api_key);
            if let Some(model) = model {
                patch = patch.set("model", model);
            }
            if let Some(prompt) = system_prompt {
                patch = patch.set("system_prompt", prompt);
            }
            state
                .db
                .update_openrouter_config(&admin.id, patch)
                .await
                .map_err(|e| failed(e.to_string()))?
                .ok_or_else(|| failed("configuration introuvable".into()))?
        }
        None => {
            let api_key = api_key.unwrap_or_default();
            state
                .db
                .create_openrouter_config(
                    &admin.id,
                    &api_key,
                    model.as_deref(),
                    system_prompt.as_deref(),
                )
                .await
                .map_err(|e| failed(e.to_string()))?
        }
    };
    Ok(Json(json!(config)))
}
