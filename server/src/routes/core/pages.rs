//! Pages et comptes connectés (saisie manuelle d'un jeton Facebook/Instagram).

use axum::extract::{Path, State};
use axum::routing::{get, put};
use axum::{Json, Router};
use chrono::Duration;
use serde_json::{json, Value};

use super::validate::{Field, Issues, Presence};
use crate::auth::AuthUser;
use crate::db::{NewSocialPage, Patch, Platform, TokenStatus, Val};
use crate::error::{ApiResult, AppError, OrApiError};
use crate::extract::{Body, JsonExt};
use crate::state::AppState;
use crate::time::Ts;

/// Durée de validité supposée d'un jeton de page saisi à la main.
const TOKEN_LIFETIME_DAYS: i64 = 60;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/pages", get(list_pages).post(create_page))
        .route("/api/pages/{id}", put(update_page).delete(delete_page))
}

/// Les jetons restent au serveur : seule la vue client est renvoyée.
async fn list_pages(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    let pages = state
        .db
        .get_visible_pages(&user)
        .await
        .or_500("Failed to fetch pages")?;
    Ok(Json(Value::Array(
        pages.iter().map(|p| p.to_client()).collect(),
    )))
}

const PLATFORMS: [&str; 3] = ["facebook", "instagram", "tiktok"];

/// Champs du schéma `insertSocialPageSchema` (hors `userId`), dans l'ordre
/// des colonnes ; `partial` rend tout facultatif (mise à jour).
struct PageFields {
    user_id: Field<String>,
    platform: Field<String>,
    page_id: Field<String>,
    page_name: Field<String>,
    access_token: Field<String>,
    followers_count: Field<i32>,
    is_active: Field<String>,
    user_access_token: Field<String>,
    refresh_token: Field<String>,
    scopes: Field<String>,
    avatar_url: Field<String>,
}

fn parse_page_fields(body: &Value, partial: bool, issues: &mut Issues) -> PageFields {
    let required = if partial {
        Presence::Optional
    } else {
        Presence::Required
    };
    let user_id = if partial {
        issues.string(body, "userId", Presence::Optional)
    } else {
        Field::Absent
    };
    let platform = issues.enumeration(body, "platform", required, &PLATFORMS);
    let page_id = issues.string(body, "pageId", required);
    let page_name = issues.string(body, "pageName", required);
    let access_token = issues.string(body, "accessToken", required);
    if partial {
        issues.date(body, "tokenExpiresAt", Presence::Nullable);
    }
    let followers_count = issues.int(body, "followersCount", Presence::Nullable);
    let is_active = issues.string(body, "isActive", Presence::Optional);
    let user_access_token = issues.string(body, "userAccessToken", Presence::Nullable);
    issues.date(body, "userTokenExpiresAt", Presence::Nullable);
    let refresh_token = issues.string(body, "refreshToken", Presence::Nullable);
    issues.date(body, "refreshTokenExpiresAt", Presence::Nullable);
    let scopes = issues.string(body, "scopes", Presence::Nullable);
    let avatar_url = issues.string(body, "avatarUrl", Presence::Nullable);
    PageFields {
        user_id,
        platform,
        page_id,
        page_name,
        access_token,
        followers_count,
        is_active,
        user_access_token,
        refresh_token,
        scopes,
        avatar_url,
    }
}

async fn create_page(
    State(state): State<AppState>,
    user: AuthUser,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Failed to create page";

    // Un compte TikTok passe obligatoirement par le flux OAuth (/api/tiktok/connect)
    if body.str_field("platform") == Some("tiktok") {
        return Err(AppError::bad_request(
            "Un compte TikTok se connecte via l'autorisation TikTok, pas par saisie manuelle d'un jeton.",
        ));
    }

    let mut issues = Issues::new();
    let fields = parse_page_fields(&body, false, &mut issues);
    if !issues.is_empty() {
        tracing::error!("Error creating page: {}", issues.zod_message());
        return Err(AppError::internal(FAILED));
    }

    let page = state
        .db
        .create_social_page(NewSocialPage {
            user_id: user.id.clone(),
            platform: fields
                .platform
                .into_option()
                .and_then(|p| Platform::parse(&p)),
            page_id: fields.page_id.into_option().unwrap_or_default(),
            page_name: fields.page_name.into_option().unwrap_or_default(),
            access_token: fields.access_token.into_option().unwrap_or_default(),
            token_expires_at: Some(Ts::now().add(Duration::days(TOKEN_LIFETIME_DAYS))),
            followers_count: fields.followers_count.into_option(),
            is_active: fields.is_active.into_option(),
            user_access_token: fields.user_access_token.into_option(),
            user_token_expires_at: None,
            refresh_token: fields.refresh_token.into_option(),
            refresh_token_expires_at: None,
            scopes: fields.scopes.into_option(),
            avatar_url: fields.avatar_url.into_option(),
        })
        .await
        .or_500(FAILED)?;
    Ok(Json(page.to_client()))
}

/// Ajoute un champ texte au patch s'il est présent (`null` compris).
fn set_text(patch: Patch, column: &'static str, field: Field<String>) -> Patch {
    match field {
        Field::Absent => patch,
        Field::Null => patch.set(column, Val::Text(None)),
        Field::Set(value) => patch.set(column, value),
    }
}

async fn update_page(
    State(state): State<AppState>,
    user: AuthUser,
    Path(page_id): Path<String>,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Failed to update page";

    let existing = state
        .db
        .get_social_page(&page_id)
        .await
        .or_500(FAILED)?
        .filter(|p| p.user_id == user.id)
        .ok_or_else(|| AppError::not_found("Page non trouvée"))?;

    let mut issues = Issues::new();
    let fields = parse_page_fields(&body, true, &mut issues);
    if !issues.is_empty() {
        tracing::error!("Error updating page: {}", issues.zod_message());
        return Err(AppError::internal(FAILED));
    }

    let new_token = matches!(&fields.access_token, Field::Set(t) if !t.is_empty());
    let mut patch = Patch::new();
    patch = set_text(patch, "user_id", fields.user_id);
    if let Field::Set(platform) = fields.platform.clone() {
        if let Some(platform) = Platform::parse(&platform) {
            patch = patch.set("platform", platform);
        }
    }
    patch = set_text(patch, "page_id", fields.page_id);
    patch = set_text(patch, "page_name", fields.page_name);
    patch = set_text(patch, "access_token", fields.access_token);
    match fields.followers_count {
        Field::Absent => {}
        Field::Null => patch = patch.set("followers_count", Val::Int(None)),
        Field::Set(count) => patch = patch.set("followers_count", count),
    }
    patch = set_text(patch, "is_active", fields.is_active);
    patch = set_text(patch, "user_access_token", fields.user_access_token);
    patch = set_text(patch, "refresh_token", fields.refresh_token);
    patch = set_text(patch, "scopes", fields.scopes);
    patch = set_text(patch, "avatar_url", fields.avatar_url);

    // Nouveau jeton : échéance recalculée et statut remis à « valide » pour que
    // l'interface se mette à jour (les jetons TikTok ont leur propre cycle)
    if new_token && existing.platform != Platform::Tiktok {
        let now = Ts::now();
        patch = patch
            .set(
                "token_expires_at",
                now.add(Duration::days(TOKEN_LIFETIME_DAYS)),
            )
            .set("token_status", TokenStatus::Valid)
            .set("last_token_check", now);
    }

    // Aucune valeur à écrire : l'ancienne mise à jour échouait
    if patch.is_empty() {
        tracing::error!("Error updating page: No values to set");
        return Err(AppError::internal(FAILED));
    }
    let updated = state
        .db
        .update_social_page(&page_id, patch)
        .await
        .or_500(FAILED)?
        .ok_or_else(|| AppError::internal(FAILED))?;
    Ok(Json(updated.to_client()))
}

async fn delete_page(
    State(state): State<AppState>,
    user: AuthUser,
    Path(page_id): Path<String>,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Failed to delete page";
    state
        .db
        .get_social_page(&page_id)
        .await
        .or_500(FAILED)?
        .filter(|p| p.user_id == user.id)
        .ok_or_else(|| AppError::not_found("Page non trouvée"))?;
    state.db.delete_social_page(&page_id).await.or_500(FAILED)?;
    Ok(Json(json!({ "success": true })))
}
