//! Utilisateurs et permissions sur les pages (administrateurs).

use axum::extract::{Path, State};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde_json::{json, Value};

use super::validate::{Issues, Presence};
use crate::auth::{hash_password, user_json, AdminUser};
use crate::db::{Patch, UserRole};
use crate::error::{ApiResult, AppError, OrApiError};
use crate::extract::{Body, JsonExt};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/users", get(list_users).post(create_user))
        .route("/api/users/{id}", patch(update_user).delete(delete_user))
        .route(
            "/api/users/{id}/page-permissions",
            get(get_permissions).post(set_permissions),
        )
        .route("/api/admin/migrate-permissions", post(migrate_permissions))
}

async fn list_users(State(state): State<AppState>, _admin: AdminUser) -> ApiResult<Json<Value>> {
    let users = state
        .db
        .get_all_users()
        .await
        .or_500("Erreur lors de la récupération des utilisateurs")?;
    Ok(Json(Value::Array(users.iter().map(user_json).collect())))
}

async fn create_user(
    State(state): State<AppState>,
    _admin: AdminUser,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Erreur lors de la création de l'utilisateur";

    let mut issues = Issues::new();
    let username = issues.string_min(
        &body,
        "username",
        Presence::Required,
        3,
        "Le nom d'utilisateur doit contenir au moins 3 caractères",
    );
    let password = issues.string_min(
        &body,
        "password",
        Presence::Required,
        4,
        "Le mot de passe doit contenir au moins 4 caractères",
    );
    let role = issues.enumeration(&body, "role", Presence::Optional, &["admin", "user"]);
    if !issues.is_empty() {
        tracing::error!("Error creating user: {}", issues.zod_message());
        return Err(AppError::bad_request(
            issues
                .first_message()
                .unwrap_or_else(|| "Données invalides".into()),
        ));
    }
    let (Some(username), Some(password)) = (username.into_option(), password.into_option()) else {
        return Err(AppError::bad_request("Données invalides"));
    };

    if state
        .db
        .get_user_by_username(&username)
        .await
        .or_500(FAILED)?
        .is_some()
    {
        return Err(AppError::conflict("Ce nom d'utilisateur existe déjà"));
    }

    let hash = hash_password(&password).await.or_500(FAILED)?;
    let role = role
        .into_option()
        .and_then(|r| UserRole::parse(&r))
        .unwrap_or(UserRole::User);
    let user = state
        .db
        .create_user(&username, &hash, role)
        .await
        .or_500(FAILED)?;
    Ok(Json(user_json(&user)))
}

async fn update_user(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(user_id): Path<String>,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Erreur lors de la modification de l'utilisateur";

    let existing = state
        .db
        .get_user(&user_id)
        .await
        .or_500(FAILED)?
        .ok_or_else(|| AppError::not_found("Utilisateur non trouvé"))?;

    let mut patch = Patch::new();

    if let Some(username) = body.str_field("username").filter(|u| !u.is_empty()) {
        if username != existing.username {
            if let Some(other) = state
                .db
                .get_user_by_username(username)
                .await
                .or_500(FAILED)?
            {
                if other.id != user_id {
                    return Err(AppError::conflict("Ce nom d'utilisateur est déjà utilisé"));
                }
            }
            patch = patch.set("username", username);
        }
    } else if body.truthy("username") {
        // Valeur non textuelle : l'ancienne route échouait à l'écriture
        return Err(AppError::internal(FAILED));
    }

    if body.truthy("password") {
        let Some(password) = body.str_field("password") else {
            return Err(AppError::internal(FAILED));
        };
        let hash = hash_password(password).await.or_500(FAILED)?;
        patch = patch.set("password", hash);
    }

    if let Some(role) = body.str_field("role").and_then(UserRole::parse) {
        patch = patch.set("role", role);
    }

    if patch.is_empty() {
        return Err(AppError::bad_request("Aucune modification fournie"));
    }

    let updated = state
        .db
        .update_user(&user_id, patch)
        .await
        .or_500(FAILED)?
        .ok_or_else(|| AppError::internal(FAILED))?;
    Ok(Json(user_json(&updated)))
}

async fn delete_user(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(user_id): Path<String>,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Erreur lors de la suppression de l'utilisateur";

    if user_id == admin.id {
        return Err(AppError::bad_request(
            "Vous ne pouvez pas supprimer votre propre compte",
        ));
    }
    if state.db.get_user(&user_id).await.or_500(FAILED)?.is_none() {
        return Err(AppError::not_found("Utilisateur non trouvé"));
    }
    state.db.delete_user(&user_id).await.or_500(FAILED)?;
    Ok(Json(
        json!({ "success": true, "message": "Utilisateur supprimé avec succès" }),
    ))
}

async fn get_permissions(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(user_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let permissions = state
        .db
        .get_user_page_permissions(&user_id)
        .await
        .or_500("Erreur lors de la récupération des permissions")?;
    Ok(Json(json!(permissions)))
}

async fn set_permissions(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(user_id): Path<String>,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Erreur lors de la mise à jour des permissions";

    let Some(page_ids) = body.get("pageIds").and_then(Value::as_array) else {
        return Err(AppError::bad_request("pageIds doit être un tableau"));
    };
    // Identifiants non textuels : l'insertion échouait côté base
    let page_ids: Vec<&str> = page_ids
        .iter()
        .map(Value::as_str)
        .collect::<Option<_>>()
        .ok_or_else(|| AppError::internal(FAILED))?;

    state
        .db
        .delete_all_user_page_permissions(&user_id)
        .await
        .or_500(FAILED)?;
    let mut permissions = Vec::with_capacity(page_ids.len());
    for page_id in page_ids {
        permissions.push(
            state
                .db
                .create_page_permission(&user_id, page_id)
                .await
                .or_500(FAILED)?,
        );
    }
    Ok(Json(json!(permissions)))
}

/// Donne à chaque utilisateur l'accès aux pages qu'il a lui-même connectées.
async fn migrate_permissions(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Erreur lors de la migration des permissions";

    let mut migrated = 0;
    for user in state.db.get_all_users().await.or_500(FAILED)? {
        for page in state.db.get_social_pages(&user.id).await.or_500(FAILED)? {
            let existing = state
                .db
                .get_user_page_permissions(&user.id)
                .await
                .or_500(FAILED)?;
            if !existing.iter().any(|p| p.page_id == page.id) {
                state
                    .db
                    .create_page_permission(&user.id, &page.id)
                    .await
                    .or_500(FAILED)?;
                migrated += 1;
            }
        }
    }
    Ok(Json(json!({
        "success": true,
        "message": format!("{migrated} permissions migrées avec succès"),
        "migratedCount": migrated,
    })))
}
