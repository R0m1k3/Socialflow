//! Publications : création (avec médias et programmation par page), lecture,
//! modification du texte et des médias.

use axum::extract::{Path, State};
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde_json::{json, Value};

use super::validate::{Field, Issues, Presence};
use crate::auth::AuthUser;
use crate::db::{
    MediaType, NewPost, NewScheduledPost, Patch, Platform, Post, PostStatus, PostType, User,
};
use crate::error::{ApiResult, AppError, OrApiError};
use crate::extract::{is_truthy, Body, JsonExt};
use crate::state::AppState;
use crate::time::Ts;

/// Nombre maximal de médias par publication.
const MAX_MEDIA: usize = 10;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/posts", get(list_posts).post(create_post))
        .route("/api/posts/{id}", get(get_post).patch(update_post))
        .route("/api/posts/{id}/media", patch(update_post_media))
}

async fn list_posts(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    let posts = state
        .db
        .get_posts(&user.id)
        .await
        .or_500("Failed to fetch posts")?;
    Ok(Json(json!(posts)))
}

/// Texte d'une valeur JSON utilisée comme identifiant.
fn id_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Médias d'une publication, au format `(mediaId, displayOrder)` :
/// `mediaIds` (chaînes ou objets `{ mediaId, displayOrder }`) ou, à défaut,
/// l'ancien champ unique `mediaId`.
fn normalize_media_items(
    media_ids: Option<&Value>,
    media_id: Option<&Value>,
) -> Result<Vec<(String, i32)>, String> {
    if let Some(Value::Array(items)) = media_ids {
        return items
            .iter()
            .enumerate()
            .map(|(index, item)| {
                let index = index as i32;
                match item {
                    Value::String(id) => Ok((id.clone(), index)),
                    Value::Object(_) if item.truthy("mediaId") => {
                        let order = match item.get("displayOrder") {
                            None | Some(Value::Null) => index,
                            Some(Value::Number(n)) => n.as_f64().map(|f| f as i32).unwrap_or(index),
                            Some(Value::String(s)) => s.trim().parse().unwrap_or(index),
                            Some(_) => index,
                        };
                        Ok((id_text(&item["mediaId"]), order))
                    }
                    _ => Err("Invalid media format".to_string()),
                }
            })
            .collect();
    }
    match media_id {
        Some(id) if is_truthy(Some(id)) => Ok(vec![(id_text(id), 0)]),
        _ => Ok(Vec::new()),
    }
}

/// Champs du post validés (schéma `insertPostSchema`).
struct PostFields {
    content: String,
    ai_generated: Option<String>,
    product_info: Option<Value>,
    status: PostStatus,
    scheduled_for: Option<Ts>,
    generation_status: Option<String>,
    generation_progress: Option<i32>,
    generation_error: Option<String>,
}

/// Valide les champs du post ; l'erreur est le message de `ZodError`.
fn parse_post_fields(body: &Value) -> Result<PostFields, String> {
    let scheduled_raw = body.get("scheduledFor");
    let scheduled = is_truthy(scheduled_raw);

    let mut issues = Issues::new();
    let content = issues.string(body, "content", Presence::Required);
    let ai_generated = issues.string(body, "aiGenerated", Presence::Optional);
    let product_info = issues.json(body, "productInfo");
    // Une date de publication fait passer le post en « scheduled »
    let status = if scheduled {
        Field::Set("scheduled".to_string())
    } else {
        issues.enumeration(
            body,
            "status",
            Presence::Optional,
            &["draft", "scheduled", "published", "failed"],
        )
    };
    let scheduled_for = match scheduled_raw {
        // `new Date(chaîne)` avant validation
        Some(Value::String(s)) if !s.is_empty() => {
            issues.converted_date("scheduledFor", Ts::parse(s))
        }
        _ => issues
            .date(body, "scheduledFor", Presence::Nullable)
            .into_option(),
    };
    let generation_status = issues.string(body, "generationStatus", Presence::Nullable);
    let generation_progress = issues.int(body, "generationProgress", Presence::Nullable);
    let generation_error = issues.string(body, "generationError", Presence::Nullable);

    if !issues.is_empty() {
        return Err(issues.zod_message());
    }
    Ok(PostFields {
        content: content.into_option().unwrap_or_default(),
        ai_generated: ai_generated.into_option(),
        product_info: product_info.into_option(),
        status: status
            .into_option()
            .and_then(|s| PostStatus::parse(&s))
            .unwrap_or(PostStatus::Draft),
        scheduled_for,
        generation_status: generation_status.into_option(),
        generation_progress: generation_progress.into_option(),
        generation_error: generation_error.into_option(),
    })
}

async fn create_post(
    State(state): State<AppState>,
    user: AuthUser,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    match create_post_inner(&state, &user, &body).await {
        Ok(Ok(post)) => Ok(Json(json!(post))),
        Ok(Err(response)) => Err(response),
        Err(message) => {
            tracing::error!("Error creating post: {message}");
            Err(AppError::internal(message))
        }
    }
}

/// `Err(message)` : erreur inattendue (500 avec le message) ;
/// `Ok(Err(réponse))` : refus explicite (400/403).
async fn create_post_inner(
    state: &AppState,
    user: &User,
    body: &Value,
) -> Result<Result<Post, AppError>, String> {
    let db_error = |e: sqlx::Error| super::pg_message(&e);

    let media_items = normalize_media_items(body.get("mediaIds"), body.get("mediaId"))?;
    let post_type = body.get("postType");
    let post_type_str = post_type.and_then(Value::as_str);
    let page_ids: Option<&Vec<Value>> = body.get("pageIds").and_then(Value::as_array);
    let has_pages = page_ids.is_some_and(|p| !p.is_empty());

    if media_items.len() > MAX_MEDIA {
        return Ok(Err(AppError::bad_request(
            "Maximum 10 photos autorisées par publication",
        )));
    }
    if matches!(post_type_str, Some("story") | Some("both")) && media_items.is_empty() {
        return Ok(Err(AppError::bad_request(
            "Les stories nécessitent au moins un média (image ou vidéo)",
        )));
    }

    // Reel déjà monté : une seule vidéo, publiée telle quelle sur Facebook ou TikTok
    if post_type_str == Some("reel") {
        if media_items.len() != 1 {
            return Ok(Err(AppError::bad_request(
                "Un Reel nécessite exactement une vidéo",
            )));
        }
        let media = state
            .db
            .get_media_by_id(&media_items[0].0)
            .await
            .map_err(db_error)?;
        let valid = media.is_some_and(|m| {
            m.media_type == MediaType::Video && (user.is_admin() || m.user_id == user.id)
        });
        if !valid {
            return Ok(Err(AppError::bad_request(
                "Le média d'un Reel doit être une de vos vidéos",
            )));
        }
        for page_id in page_ids.into_iter().flatten() {
            let page = state
                .db
                .get_social_page(&id_text(page_id))
                .await
                .map_err(db_error)?;
            if !page.is_some_and(|p| matches!(p.platform, Platform::Facebook | Platform::Tiktok)) {
                return Ok(Err(AppError::bad_request(
                    "Les Reels ne peuvent être publiés que sur Facebook ou TikTok",
                )));
            }
        }
    }

    // Un utilisateur ne publie que sur les pages qui lui sont attribuées
    if !user.is_admin() && has_pages {
        let accessible = state
            .db
            .get_user_accessible_pages(&user.id)
            .await
            .map_err(db_error)?;
        let all_accessible = page_ids.into_iter().flatten().all(|id| {
            id.as_str()
                .is_some_and(|id| accessible.iter().any(|p| p.id == id))
        });
        if !all_accessible {
            return Ok(Err(AppError::forbidden(
                "Vous n'avez pas accès à certaines pages sélectionnées",
            )));
        }
    }

    if is_truthy(body.get("scheduledFor")) && !has_pages {
        return Ok(Err(AppError::bad_request(
            "Les posts programmés nécessitent au moins une page cible",
        )));
    }

    let fields = parse_post_fields(body)?;
    let scheduled_for = fields.scheduled_for;
    let mut new_post = NewPost::new(user.id.clone(), fields.content);
    if let Some(ai) = fields.ai_generated {
        new_post.ai_generated = ai;
    }
    new_post.product_info = fields.product_info;
    new_post.status = fields.status;
    new_post.scheduled_for = scheduled_for;
    new_post.generation_status = fields.generation_status;
    new_post.generation_progress = fields.generation_progress;
    new_post.generation_error = fields.generation_error;
    let post = state.db.create_post(new_post).await.map_err(db_error)?;

    if !media_items.is_empty() {
        state
            .db
            .set_post_media(&post.id, &media_items, false)
            .await
            .map_err(db_error)?;
    }

    if let Some(page_ids) = page_ids.filter(|p| !p.is_empty()) {
        // Sans date : publication immédiate
        let scheduled_at = scheduled_for.unwrap_or_else(Ts::now);
        let type_text = match post_type {
            Some(v) if is_truthy(Some(v)) => id_text(v),
            _ => "feed".to_string(),
        };
        let final_type = PostType::parse(&type_text)
            .ok_or_else(|| format!("invalid input value for enum post_type: \"{type_text}\""))?;
        let also_story = body.get("alsoStory") == Some(&Value::Bool(true));

        for page_id in page_ids {
            let page_id = id_text(page_id);
            let create = |post_type| {
                NewScheduledPost::new(post.id.clone(), page_id.clone(), post_type, scheduled_at)
            };
            if final_type == PostType::Both {
                // « both » : une story et un post de fil, indépendants
                state
                    .db
                    .create_scheduled_post(create(PostType::Story))
                    .await
                    .map_err(db_error)?;
                state
                    .db
                    .create_scheduled_post(create(PostType::Feed))
                    .await
                    .map_err(db_error)?;
            } else {
                state
                    .db
                    .create_scheduled_post(create(final_type))
                    .await
                    .map_err(db_error)?;
                // Reel doublé d'une story : seulement sur Facebook, TikTok n'en a pas
                if final_type == PostType::Reel && also_story {
                    let page = state.db.get_social_page(&page_id).await.map_err(db_error)?;
                    if page.is_some_and(|p| p.platform == Platform::Facebook) {
                        state
                            .db
                            .create_scheduled_post(create(PostType::Story))
                            .await
                            .map_err(db_error)?;
                    }
                }
            }
        }
    }

    Ok(Ok(post))
}

fn post_with_media((post, media): (Post, Vec<crate::db::Media>)) -> Value {
    json!({ "post": post, "media": media })
}

async fn get_post(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Failed to fetch post";
    let found = state
        .db
        .get_post_with_media(&id)
        .await
        .or_500(FAILED)?
        .ok_or_else(|| AppError::not_found("Post not found"))?;

    // Admin : tout ; propriétaire : son post
    if user.is_admin() || found.0.user_id == user.id {
        return Ok(Json(post_with_media(found)));
    }

    // Utilisateur : les posts programmés sur une de ses pages
    let scheduled = state
        .db
        .get_scheduled_posts_by_post(&id)
        .await
        .or_500(FAILED)?;
    if !scheduled.is_empty() {
        let accessible = state
            .db
            .get_user_accessible_pages(&user.id)
            .await
            .or_500(FAILED)?;
        if scheduled
            .iter()
            .any(|sp| accessible.iter().any(|p| p.id == sp.page_id))
        {
            return Ok(Json(post_with_media(found)));
        }
    }
    Err(AppError::forbidden("Unauthorized"))
}

async fn update_post(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Failed to update post";
    let post = state
        .db
        .get_post(&id)
        .await
        .or_500(FAILED)?
        .ok_or_else(|| AppError::not_found("Post not found"))?;
    if post.user_id != user.id {
        return Err(AppError::forbidden("Unauthorized"));
    }

    let mut patch = Patch::new();
    match body.get("content") {
        None => {}
        Some(Value::String(content)) => patch = patch.set("content", content.as_str()),
        // `null` ou autre type : refusé par la base (colonne texte non nulle)
        Some(_) => return Err(AppError::internal(FAILED)),
    }
    let updated = state.db.update_post(&id, patch).await.or_500(FAILED)?;
    Ok(Json(json!(updated)))
}

async fn update_post_media(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    const FAILED: &str = "Failed to update post media";
    let post = state
        .db
        .get_post(&id)
        .await
        .or_500(FAILED)?
        .ok_or_else(|| AppError::not_found("Post not found"))?;
    if post.user_id != user.id {
        return Err(AppError::forbidden("Unauthorized"));
    }

    let Some(media_ids) = body.get("mediaIds").and_then(Value::as_array) else {
        return Err(AppError::bad_request("mediaIds must be an array"));
    };
    if media_ids.len() > MAX_MEDIA {
        return Err(AppError::bad_request(
            "Maximum 10 photos autorisées par publication",
        ));
    }
    let media_ids: Vec<String> = media_ids.iter().map(id_text).collect();

    state
        .db
        .update_post_media(&id, &media_ids)
        .await
        .or_500(FAILED)?;
    let updated = state.db.get_post_with_media(&id).await.or_500(FAILED)?;
    Ok(Json(updated.map(post_with_media).unwrap_or(Value::Null)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_list_normalization() {
        let ids = json!(["a", { "mediaId": "b", "displayOrder": 5 }, { "mediaId": "c" }]);
        assert_eq!(
            normalize_media_items(Some(&ids), None).unwrap(),
            vec![("a".into(), 0), ("b".into(), 5), ("c".into(), 2)]
        );
        // Ancien champ unique
        assert_eq!(
            normalize_media_items(None, Some(&json!("m"))).unwrap(),
            vec![("m".into(), 0)]
        );
        // Un tableau prime sur mediaId ; un non-tableau est ignoré
        assert_eq!(
            normalize_media_items(Some(&json!([])), Some(&json!("m"))).unwrap(),
            vec![]
        );
        assert_eq!(
            normalize_media_items(Some(&json!("x")), Some(&json!("m"))).unwrap(),
            vec![("m".into(), 0)]
        );
        assert_eq!(
            normalize_media_items(None, Some(&json!(""))).unwrap(),
            vec![]
        );
        assert_eq!(
            normalize_media_items(Some(&json!([{ "id": "x" }])), None).unwrap_err(),
            "Invalid media format"
        );
        assert!(normalize_media_items(Some(&json!([null])), None).is_err());
    }

    #[test]
    fn post_fields_validation() {
        let fields = parse_post_fields(
            &json!({ "content": "Bonjour", "scheduledFor": "2026-10-20T10:00:00Z" }),
        )
        .unwrap();
        assert_eq!(fields.status, PostStatus::Scheduled);
        assert_eq!(
            fields.scheduled_for.unwrap().to_iso(),
            "2026-10-20T10:00:00.000Z"
        );

        let fields =
            parse_post_fields(&json!({ "content": "x", "status": "draft", "aiGenerated": "true" }))
                .unwrap();
        assert_eq!(fields.status, PostStatus::Draft);
        assert_eq!(fields.ai_generated.as_deref(), Some("true"));

        let error = parse_post_fields(&json!({})).err().unwrap();
        assert!(error.contains("\"path\": [\n      \"content\"\n    ]"));
        assert!(error.contains("\"message\": \"Required\""));

        let error = parse_post_fields(&json!({ "content": "x", "scheduledFor": "pas une date" }))
            .err()
            .unwrap();
        assert!(error.contains("Invalid date"));
    }
}
