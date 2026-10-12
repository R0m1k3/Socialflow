//! Accès aux données (portage de `storage.ts`).
//!
//! Les jetons des pages et les secrets des applications Facebook/TikTok sont
//! chiffrés au repos ; les fonctions de ce module les rendent déchiffrés.

pub mod models;

use std::collections::HashMap;
use std::time::Duration;

use serde_json::Value;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{Executor, PgPool, Postgres, QueryBuilder, Row};

pub use models::*;

use crate::crypto::{decrypt, encrypt};
use crate::time::Ts;

/// Statuts de publication TikTok définitifs : inutile d'interroger l'API au-delà.
pub const TERMINAL_PUBLISH_STATUSES: [&str; 3] =
    ["PUBLISH_COMPLETE", "FAILED", "SEND_TO_USER_INBOX"];

pub async fn connect(url: &str) -> Result<PgPool, sqlx::Error> {
    let options: PgConnectOptions = url.parse()?;
    PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(30))
        .after_connect(|conn, _meta| {
            Box::pin(async move {
                // Les colonnes `timestamp` contiennent de l'UTC
                conn.execute("SET TIME ZONE 'UTC'").await?;
                Ok(())
            })
        })
        .connect_with(options)
        .await
}

/// Valeur à écrire dans une colonne, pour les mises à jour partielles.
#[derive(Debug, Clone)]
pub enum Val {
    Text(Option<String>),
    Int(Option<i32>),
    Time(Option<Ts>),
    Json(Option<Value>),
    /// Valeur d'un type énuméré PostgreSQL : (type, valeur).
    Enum(&'static str, Option<String>),
    /// Expression SQL brute (ex. `now()`).
    Raw(&'static str),
}

impl From<String> for Val {
    fn from(v: String) -> Self {
        Val::Text(Some(v))
    }
}
impl From<&str> for Val {
    fn from(v: &str) -> Self {
        Val::Text(Some(v.to_string()))
    }
}
impl From<Option<String>> for Val {
    fn from(v: Option<String>) -> Self {
        Val::Text(v)
    }
}
impl From<i32> for Val {
    fn from(v: i32) -> Self {
        Val::Int(Some(v))
    }
}
impl From<Option<i32>> for Val {
    fn from(v: Option<i32>) -> Self {
        Val::Int(v)
    }
}
impl From<Ts> for Val {
    fn from(v: Ts) -> Self {
        Val::Time(Some(v))
    }
}
impl From<Option<Ts>> for Val {
    fn from(v: Option<Ts>) -> Self {
        Val::Time(v)
    }
}
impl From<Value> for Val {
    fn from(v: Value) -> Self {
        Val::Json(Some(v))
    }
}
impl From<TokenStatus> for Val {
    fn from(v: TokenStatus) -> Self {
        Val::Enum(TokenStatus::PG_TYPE, Some(v.as_str().into()))
    }
}
impl From<PostStatus> for Val {
    fn from(v: PostStatus) -> Self {
        Val::Enum(PostStatus::PG_TYPE, Some(v.as_str().into()))
    }
}
impl From<PostType> for Val {
    fn from(v: PostType) -> Self {
        Val::Enum(PostType::PG_TYPE, Some(v.as_str().into()))
    }
}
impl From<UserRole> for Val {
    fn from(v: UserRole) -> Self {
        Val::Enum(UserRole::PG_TYPE, Some(v.as_str().into()))
    }
}
impl From<Platform> for Val {
    fn from(v: Platform) -> Self {
        Val::Enum(Platform::PG_TYPE, Some(v.as_str().into()))
    }
}

/// Mise à jour partielle : liste ordonnée de (colonne, valeur).
///
/// ```ignore
/// db.update_scheduled_post(&id, Patch::new().set("published_at", Ts::now()).set("error", None::<String>)).await?;
/// ```
#[derive(Debug, Clone, Default)]
pub struct Patch {
    sets: Vec<(&'static str, Val)>,
}

impl Patch {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set(mut self, column: &'static str, value: impl Into<Val>) -> Self {
        self.sets.retain(|(c, _)| *c != column);
        self.sets.push((column, value.into()));
        self
    }

    pub fn set_null(self, column: &'static str) -> Self {
        self.set(column, Val::Text(None))
    }

    pub fn is_empty(&self) -> bool {
        self.sets.is_empty()
    }

    pub fn has(&self, column: &str) -> bool {
        self.sets.iter().any(|(c, _)| *c == column)
    }

    fn map_text(mut self, column: &str, f: impl Fn(&str) -> String) -> Self {
        for (c, v) in self.sets.iter_mut() {
            if *c == column {
                if let Val::Text(Some(text)) = v {
                    *text = f(text);
                }
            }
        }
        self
    }

    fn push_into(&self, qb: &mut QueryBuilder<'_, Postgres>) {
        let mut first = true;
        for (column, value) in &self.sets {
            if !first {
                qb.push(", ");
            }
            first = false;
            qb.push(format!("\"{column}\" = "));
            match value.clone() {
                Val::Text(v) => {
                    qb.push_bind(v);
                }
                Val::Int(v) => {
                    qb.push_bind(v);
                }
                Val::Time(v) => {
                    qb.push_bind(v);
                }
                Val::Json(v) => {
                    qb.push_bind(v);
                }
                Val::Enum(ty, v) => {
                    qb.push_bind(v);
                    qb.push(format!("::{ty}"));
                }
                Val::Raw(sql) => {
                    qb.push(sql);
                }
            }
        }
    }
}

/// Exécute `UPDATE table SET … WHERE id = $id RETURNING *`.
async fn update_returning<T>(
    pool: &PgPool,
    table: &str,
    id: &str,
    patch: &Patch,
) -> Result<Option<T>, sqlx::Error>
where
    T: for<'r> sqlx::FromRow<'r, sqlx::postgres::PgRow> + Send + Unpin,
{
    if patch.is_empty() {
        let sql = format!("SELECT * FROM \"{table}\" WHERE id = $1");
        return sqlx::query_as::<_, T>(&sql)
            .bind(id)
            .fetch_optional(pool)
            .await;
    }
    let mut qb = QueryBuilder::<Postgres>::new(format!("UPDATE \"{table}\" SET "));
    patch.push_into(&mut qb);
    qb.push(" WHERE id = ");
    qb.push_bind(id.to_string());
    qb.push(" RETURNING *");
    qb.build_query_as::<T>().fetch_optional(pool).await
}

fn decrypt_page(mut page: SocialPage) -> SocialPage {
    page.access_token = decrypt(&page.access_token);
    page.refresh_token = page.refresh_token.map(|t| decrypt(&t));
    page
}

/// Données d'une nouvelle page (jetons en clair : chiffrés à l'écriture).
#[derive(Debug, Clone, Default)]
pub struct NewSocialPage {
    pub user_id: String,
    pub platform: Option<Platform>,
    pub page_id: String,
    pub page_name: String,
    pub access_token: String,
    pub token_expires_at: Option<Ts>,
    pub followers_count: Option<i32>,
    pub is_active: Option<String>,
    pub user_access_token: Option<String>,
    pub user_token_expires_at: Option<Ts>,
    pub refresh_token: Option<String>,
    pub refresh_token_expires_at: Option<Ts>,
    pub scopes: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct NewMedia {
    pub user_id: String,
    pub media_type: Option<MediaType>,
    pub cloudinary_public_id: Option<String>,
    pub original_url: String,
    pub facebook_landscape_url: Option<String>,
    pub facebook_feed_url: Option<String>,
    pub instagram_feed_url: Option<String>,
    pub instagram_story_url: Option<String>,
    pub thumbnail_url: Option<String>,
    pub file_name: String,
    pub file_size: i32,
}

#[derive(Debug, Clone)]
pub struct NewPost {
    pub user_id: String,
    pub content: String,
    pub ai_generated: String,
    pub product_info: Option<Value>,
    pub status: PostStatus,
    pub scheduled_for: Option<Ts>,
    pub generation_status: Option<String>,
    pub generation_progress: Option<i32>,
    pub generation_error: Option<String>,
}

impl NewPost {
    pub fn new(user_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            user_id: user_id.into(),
            content: content.into(),
            ai_generated: "false".into(),
            product_info: None,
            status: PostStatus::Draft,
            scheduled_for: None,
            generation_status: None,
            generation_progress: None,
            generation_error: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct NewScheduledPost {
    pub post_id: String,
    pub page_id: String,
    pub post_type: PostType,
    pub scheduled_at: Ts,
    pub publish_id: Option<String>,
    pub publish_status: Option<String>,
}

impl NewScheduledPost {
    pub fn new(
        post_id: impl Into<String>,
        page_id: impl Into<String>,
        post_type: PostType,
        scheduled_at: Ts,
    ) -> Self {
        Self {
            post_id: post_id.into(),
            page_id: page_id.into(),
            post_type,
            scheduled_at,
            publish_id: None,
            publish_status: None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct NewMusicFavorite {
    pub user_id: String,
    pub track_id: String,
    pub title: String,
    pub artist: String,
    pub album_name: Option<String>,
    pub duration: i32,
    pub preview_url: String,
    pub download_url: String,
    pub image_url: Option<String>,
    pub license: Option<String>,
}

/// Compteurs du tableau de bord.
#[derive(Debug, Clone, Default)]
pub struct DashboardStats {
    pub scheduled_posts: i64,
    pub scheduled_posts_last_month: i64,
    pub connected_pages: i64,
    pub ai_texts_generated: i64,
    pub ai_texts_yesterday: i64,
    pub media_stored: i64,
}

/// Job de rendu de Reel en cours, pour l'agenda.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct RenderingReelJob {
    pub id: String,
    pub post_id: Option<String>,
    pub created_at: Ts,
    pub params: Value,
    pub content: Option<String>,
}

#[derive(Clone)]
pub struct Db {
    pub pool: PgPool,
}

impl Db {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    // ------------------------------------------------------------------
    // Utilisateurs
    // ------------------------------------------------------------------

    pub async fn get_user(&self, id: &str) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM users WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn get_user_by_username(&self, username: &str) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM users WHERE username = $1")
            .bind(username)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn get_all_users(&self) -> Result<Vec<User>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM users")
            .fetch_all(&self.pool)
            .await
    }

    /// `password` doit déjà être haché.
    pub async fn create_user(
        &self,
        username: &str,
        password_hash: &str,
        role: UserRole,
    ) -> Result<User, sqlx::Error> {
        sqlx::query_as(
            "INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING *",
        )
        .bind(username)
        .bind(password_hash)
        .bind(role)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn update_user(&self, id: &str, patch: Patch) -> Result<Option<User>, sqlx::Error> {
        update_returning(&self.pool, "users", id, &patch).await
    }

    pub async fn delete_user(&self, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn get_dashboard_stats(
        &self,
        user_id: &str,
        yesterday_start: Ts,
        yesterday_end: Ts,
        last_month: Ts,
    ) -> Result<DashboardStats, sqlx::Error> {
        let row = sqlx::query(
            r#"SELECT
                (SELECT count(*) FROM posts WHERE user_id = $1 AND status = 'scheduled') AS scheduled,
                (SELECT count(*) FROM posts WHERE user_id = $1 AND status = 'scheduled' AND created_at < $4) AS scheduled_last_month,
                (SELECT count(*) FROM ai_generations WHERE user_id = $1) AS ai_total,
                (SELECT count(*) FROM ai_generations WHERE user_id = $1 AND created_at >= $2 AND created_at < $3) AS ai_yesterday,
                (SELECT count(*) FROM social_pages WHERE user_id = $1) AS pages,
                (SELECT count(*) FROM media WHERE user_id = $1) AS media"#,
        )
        .bind(user_id)
        .bind(yesterday_start)
        .bind(yesterday_end)
        .bind(last_month)
        .fetch_one(&self.pool)
        .await?;
        Ok(DashboardStats {
            scheduled_posts: row.try_get("scheduled")?,
            scheduled_posts_last_month: row.try_get("scheduled_last_month")?,
            connected_pages: row.try_get("pages")?,
            ai_texts_generated: row.try_get("ai_total")?,
            ai_texts_yesterday: row.try_get("ai_yesterday")?,
            media_stored: row.try_get("media")?,
        })
    }

    // ------------------------------------------------------------------
    // Pages sociales
    // ------------------------------------------------------------------

    pub async fn get_social_pages(&self, user_id: &str) -> Result<Vec<SocialPage>, sqlx::Error> {
        let pages: Vec<SocialPage> =
            sqlx::query_as("SELECT * FROM social_pages WHERE user_id = $1")
                .bind(user_id)
                .fetch_all(&self.pool)
                .await?;
        Ok(pages.into_iter().map(decrypt_page).collect())
    }

    pub async fn get_all_social_pages(&self) -> Result<Vec<SocialPage>, sqlx::Error> {
        let pages: Vec<SocialPage> = sqlx::query_as("SELECT * FROM social_pages")
            .fetch_all(&self.pool)
            .await?;
        Ok(pages.into_iter().map(decrypt_page).collect())
    }

    pub async fn get_social_page(&self, id: &str) -> Result<Option<SocialPage>, sqlx::Error> {
        let page: Option<SocialPage> = sqlx::query_as("SELECT * FROM social_pages WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(page.map(decrypt_page))
    }

    pub async fn create_social_page(&self, page: NewSocialPage) -> Result<SocialPage, sqlx::Error> {
        let created: SocialPage = sqlx::query_as(
            r#"INSERT INTO social_pages (
                user_id, platform, page_id, page_name, access_token, token_expires_at,
                followers_count, is_active, user_access_token, user_token_expires_at,
                refresh_token, refresh_token_expires_at, scopes, avatar_url
            ) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 0), COALESCE($8, 'true'), $9, $10, $11, $12, $13, $14)
            RETURNING *"#,
        )
        .bind(&page.user_id)
        .bind(page.platform.unwrap_or(Platform::Facebook))
        .bind(&page.page_id)
        .bind(&page.page_name)
        .bind(encrypt(&page.access_token))
        .bind(page.token_expires_at)
        .bind(page.followers_count)
        .bind(page.is_active)
        .bind(page.user_access_token)
        .bind(page.user_token_expires_at)
        .bind(page.refresh_token.filter(|t| !t.is_empty()).map(|t| encrypt(&t)))
        .bind(page.refresh_token_expires_at)
        .bind(page.scopes)
        .bind(page.avatar_url)
        .fetch_one(&self.pool)
        .await?;
        Ok(decrypt_page(created))
    }

    /// Mise à jour partielle ; `access_token` et `refresh_token` sont chiffrés
    /// ici (une valeur vide n'est pas chiffrée, comme avant).
    pub async fn update_social_page(
        &self,
        id: &str,
        patch: Patch,
    ) -> Result<Option<SocialPage>, sqlx::Error> {
        let patch = patch
            .map_text("access_token", |t| {
                if t.is_empty() {
                    t.to_string()
                } else {
                    encrypt(t)
                }
            })
            .map_text("refresh_token", |t| {
                if t.is_empty() {
                    t.to_string()
                } else {
                    encrypt(t)
                }
            });
        let updated: Option<SocialPage> =
            update_returning(&self.pool, "social_pages", id, &patch).await?;
        Ok(updated.map(decrypt_page))
    }

    pub async fn delete_social_page(&self, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM social_pages WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // ------------------------------------------------------------------
    // Médias
    // ------------------------------------------------------------------

    pub async fn get_media(
        &self,
        user_id: &str,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<Media>, sqlx::Error> {
        sqlx::query_as(
            "SELECT * FROM media WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        )
        .bind(user_id)
        .bind(limit)
        .bind(offset.unwrap_or(0))
        .fetch_all(&self.pool)
        .await
    }

    pub async fn get_media_by_ids(&self, ids: &[String]) -> Result<Vec<Media>, sqlx::Error> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        sqlx::query_as("SELECT * FROM media WHERE id = ANY($1)")
            .bind(ids)
            .fetch_all(&self.pool)
            .await
    }

    pub async fn get_media_count(&self, user_id: &str) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar("SELECT count(*) FROM media WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn get_media_by_id(&self, id: &str) -> Result<Option<Media>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM media WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn create_media(&self, media: NewMedia) -> Result<Media, sqlx::Error> {
        sqlx::query_as(
            r#"INSERT INTO media (
                user_id, type, cloudinary_public_id, original_url, facebook_landscape_url,
                facebook_feed_url, instagram_feed_url, instagram_story_url, thumbnail_url,
                file_name, file_size
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *"#,
        )
        .bind(&media.user_id)
        .bind(media.media_type.unwrap_or(MediaType::Image))
        .bind(media.cloudinary_public_id)
        .bind(media.original_url)
        .bind(media.facebook_landscape_url)
        .bind(media.facebook_feed_url)
        .bind(media.instagram_feed_url)
        .bind(media.instagram_story_url)
        .bind(media.thumbnail_url)
        .bind(media.file_name)
        .bind(media.file_size)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn update_media(&self, id: &str, patch: Patch) -> Result<Option<Media>, sqlx::Error> {
        update_returning(&self.pool, "media", id, &patch).await
    }

    pub async fn delete_media(&self, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM media WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn get_post_media(&self, post_id: &str) -> Result<Vec<PostMedia>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM post_media WHERE post_id = $1 ORDER BY display_order ASC")
            .bind(post_id)
            .fetch_all(&self.pool)
            .await
    }

    // ------------------------------------------------------------------
    // Posts
    // ------------------------------------------------------------------

    pub async fn get_posts(&self, user_id: &str) -> Result<Vec<Post>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM posts WHERE user_id = $1 ORDER BY created_at DESC")
            .bind(user_id)
            .fetch_all(&self.pool)
            .await
    }

    pub async fn get_post(&self, id: &str) -> Result<Option<Post>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM posts WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    /// Post et médias, dans l'ordre d'affichage.
    pub async fn get_post_with_media(
        &self,
        id: &str,
    ) -> Result<Option<(Post, Vec<Media>)>, sqlx::Error> {
        let Some(post) = self.get_post(id).await? else {
            return Ok(None);
        };
        let links = self.get_post_media(id).await?;
        let ids: Vec<String> = links.iter().map(|l| l.media_id.clone()).collect();
        let by_id: HashMap<String, Media> = self
            .get_media_by_ids(&ids)
            .await?
            .into_iter()
            .map(|m| (m.id.clone(), m))
            .collect();
        let media = links
            .iter()
            .filter_map(|l| by_id.get(&l.media_id).cloned())
            .collect();
        Ok(Some((post, media)))
    }

    pub async fn create_post(&self, post: NewPost) -> Result<Post, sqlx::Error> {
        sqlx::query_as(
            r#"INSERT INTO posts (
                user_id, content, ai_generated, product_info, status, scheduled_for,
                generation_status, generation_progress, generation_error
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 0), $9) RETURNING *"#,
        )
        .bind(post.user_id)
        .bind(post.content)
        .bind(post.ai_generated)
        .bind(post.product_info)
        .bind(post.status)
        .bind(post.scheduled_for)
        .bind(post.generation_status)
        .bind(post.generation_progress)
        .bind(post.generation_error)
        .fetch_one(&self.pool)
        .await
    }

    /// Mise à jour partielle ; `updated_at` est toujours renouvelé.
    pub async fn update_post(&self, id: &str, patch: Patch) -> Result<Option<Post>, sqlx::Error> {
        let patch = patch.set("updated_at", Ts::now());
        update_returning(&self.pool, "posts", id, &patch).await
    }

    pub async fn update_post_generation_status(
        &self,
        id: &str,
        status: &str,
        progress: i32,
        error: Option<&str>,
    ) -> Result<Option<Post>, sqlx::Error> {
        let mut patch = Patch::new()
            .set("generation_status", status)
            .set("generation_progress", progress);
        if let Some(error) = error {
            patch = patch.set("generation_error", error);
        }
        self.update_post(id, patch).await
    }

    pub async fn delete_post(&self, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM posts WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Remplace les médias d'un post (ordre = position dans la liste).
    pub async fn update_post_media(
        &self,
        post_id: &str,
        media_ids: &[String],
    ) -> Result<(), sqlx::Error> {
        let items: Vec<(String, i32)> = media_ids
            .iter()
            .enumerate()
            .map(|(i, id)| (id.clone(), i as i32))
            .collect();
        self.set_post_media(post_id, &items, true).await
    }

    /// Lie des médias à un post avec un ordre explicite ; `replace` efface d'abord les liens existants.
    pub async fn set_post_media(
        &self,
        post_id: &str,
        items: &[(String, i32)],
        replace: bool,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        if replace {
            sqlx::query("DELETE FROM post_media WHERE post_id = $1")
                .bind(post_id)
                .execute(&mut *tx)
                .await?;
        }
        for (media_id, order) in items {
            sqlx::query(
                "INSERT INTO post_media (post_id, media_id, display_order) VALUES ($1, $2, $3)",
            )
            .bind(post_id)
            .bind(media_id)
            .bind(order)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await
    }

    // ------------------------------------------------------------------
    // Publications planifiées
    // ------------------------------------------------------------------

    pub async fn get_scheduled_posts(
        &self,
        user_id: &str,
        start: Option<Ts>,
        end: Option<Ts>,
    ) -> Result<Vec<ScheduledPostWithDetails>, sqlx::Error> {
        self.query_scheduled_posts(
            "p.user_id = $1",
            ScopeBind::Text(user_id.to_string()),
            start,
            end,
        )
        .await
    }

    pub async fn get_scheduled_posts_by_pages(
        &self,
        page_ids: &[String],
        start: Option<Ts>,
        end: Option<Ts>,
    ) -> Result<Vec<ScheduledPostWithDetails>, sqlx::Error> {
        if page_ids.is_empty() {
            return Ok(Vec::new());
        }
        self.query_scheduled_posts(
            "sp.page_id = ANY($1)",
            ScopeBind::List(page_ids.to_vec()),
            start,
            end,
        )
        .await
    }

    async fn query_scheduled_posts(
        &self,
        scope: &str,
        bind: ScopeBind,
        start: Option<Ts>,
        end: Option<Ts>,
    ) -> Result<Vec<ScheduledPostWithDetails>, sqlx::Error> {
        let sql = format!(
            r#"SELECT sp.*,
                p.id AS p_id, p.user_id AS p_user_id, p.content AS p_content, p.status AS p_status,
                p.scheduled_for AS p_scheduled_for, p.ai_generated AS p_ai_generated,
                p.generation_status AS p_generation_status, p.generation_progress AS p_generation_progress,
                p.created_at AS p_created_at,
                pg.id AS pg_id, pg.page_id AS pg_page_id, pg.page_name AS pg_page_name,
                pg.platform AS pg_platform, pg.avatar_url AS pg_avatar_url
            FROM scheduled_posts sp
            INNER JOIN posts p ON sp.post_id = p.id
            LEFT JOIN social_pages pg ON sp.page_id = pg.id
            WHERE {scope}
              AND ($2::timestamp IS NULL OR sp.scheduled_at >= $2)
              AND ($3::timestamp IS NULL OR sp.scheduled_at <= $3)
            ORDER BY sp.scheduled_at DESC"#
        );
        let query = sqlx::query(&sql);
        let query = match bind {
            ScopeBind::Text(v) => query.bind(v),
            ScopeBind::List(v) => query.bind(v),
        };
        let rows = query.bind(start).bind(end).fetch_all(&self.pool).await?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let scheduled = <ScheduledPost as sqlx::FromRow<_>>::from_row(&row)?;
            let post = ScheduledPostPost {
                id: row.try_get("p_id")?,
                user_id: row.try_get("p_user_id")?,
                content: row.try_get("p_content")?,
                status: row.try_get("p_status")?,
                scheduled_for: row.try_get("p_scheduled_for")?,
                ai_generated: row.try_get("p_ai_generated")?,
                generation_status: row.try_get("p_generation_status")?,
                generation_progress: row.try_get("p_generation_progress")?,
                created_at: row.try_get("p_created_at")?,
            };
            let page_id: Option<String> = row.try_get("pg_id")?;
            let page = match page_id {
                Some(id) => Some(ScheduledPostPage {
                    id,
                    page_id: row.try_get("pg_page_id")?,
                    page_name: row.try_get("pg_page_name")?,
                    platform: row.try_get("pg_platform")?,
                    avatar_url: row.try_get("pg_avatar_url")?,
                }),
                None => None,
            };
            out.push(ScheduledPostWithDetails {
                scheduled,
                post,
                page,
            });
        }
        Ok(out)
    }

    pub async fn get_scheduled_post(&self, id: &str) -> Result<Option<ScheduledPost>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM scheduled_posts WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn get_scheduled_posts_by_post(
        &self,
        post_id: &str,
    ) -> Result<Vec<ScheduledPost>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM scheduled_posts WHERE post_id = $1")
            .bind(post_id)
            .fetch_all(&self.pool)
            .await
    }

    pub async fn create_scheduled_post(
        &self,
        sp: NewScheduledPost,
    ) -> Result<ScheduledPost, sqlx::Error> {
        sqlx::query_as(
            r#"INSERT INTO scheduled_posts (post_id, page_id, post_type, scheduled_at, publish_id, publish_status)
               VALUES ($1, $2, $3, $4, $5, $6) RETURNING *"#,
        )
        .bind(sp.post_id)
        .bind(sp.page_id)
        .bind(sp.post_type)
        .bind(sp.scheduled_at)
        .bind(sp.publish_id)
        .bind(sp.publish_status)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn update_scheduled_post(
        &self,
        id: &str,
        patch: Patch,
    ) -> Result<Option<ScheduledPost>, sqlx::Error> {
        update_returning(&self.pool, "scheduled_posts", id, &patch).await
    }

    pub async fn delete_scheduled_post(&self, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM scheduled_posts WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Publications dues et pas encore traitées.
    pub async fn get_pending_scheduled_posts(&self) -> Result<Vec<ScheduledPost>, sqlx::Error> {
        sqlx::query_as(
            "SELECT * FROM scheduled_posts WHERE published_at IS NULL AND scheduled_at <= $1",
        )
        .bind(Ts::now())
        .fetch_all(&self.pool)
        .await
    }

    /// Envois TikTok dont le statut final n'est pas encore connu.
    pub async fn get_scheduled_posts_awaiting_publish_status(
        &self,
    ) -> Result<Vec<ScheduledPost>, sqlx::Error> {
        // `NOT IN` ignore les statuts NULL, comme `notInArray` de Drizzle
        sqlx::query_as(
            "SELECT * FROM scheduled_posts WHERE publish_id IS NOT NULL AND publish_status NOT IN ($1, $2, $3)",
        )
        .bind(TERMINAL_PUBLISH_STATUSES[0])
        .bind(TERMINAL_PUBLISH_STATUSES[1])
        .bind(TERMINAL_PUBLISH_STATUSES[2])
        .fetch_all(&self.pool)
        .await
    }

    /// Reels en cours de génération (et échecs des dernières 24 h), avec l'étape du rendu.
    pub async fn get_ongoing_reel_posts(&self, user_id: &str) -> Result<Vec<Value>, sqlx::Error> {
        let since = Ts::now().add(chrono::Duration::hours(-24));
        let posts: Vec<Post> = sqlx::query_as(
            r#"SELECT * FROM posts
               WHERE user_id = $1
                 AND (generation_status IN ('processing', 'pending')
                      OR (generation_status = 'failed' AND updated_at >= $2 AND generation_error IS NOT NULL))
               ORDER BY created_at DESC"#,
        )
        .bind(user_id)
        .bind(since)
        .fetch_all(&self.pool)
        .await?;
        if posts.is_empty() {
            return Ok(Vec::new());
        }
        let ids: Vec<String> = posts.iter().map(|p| p.id.clone()).collect();
        let steps: Vec<(Option<String>, Option<String>)> =
            sqlx::query_as("SELECT post_id, step FROM reel_jobs WHERE post_id = ANY($1)")
                .bind(&ids)
                .fetch_all(&self.pool)
                .await?;
        let step_by_post: HashMap<String, Option<String>> = steps
            .into_iter()
            .filter_map(|(post_id, step)| post_id.map(|p| (p, step)))
            .collect();
        Ok(posts
            .into_iter()
            .map(|post| {
                let step = step_by_post.get(&post.id).cloned().flatten();
                let mut value = serde_json::to_value(&post).unwrap_or(Value::Null);
                if let Value::Object(map) = &mut value {
                    map.insert(
                        "generationStep".into(),
                        step.map(Value::String).unwrap_or(Value::Null),
                    );
                }
                value
            })
            .collect())
    }

    /// Reels vidéo en file ou en montage (leurs publications n'existent qu'après le rendu).
    pub async fn get_rendering_reel_jobs(&self) -> Result<Vec<RenderingReelJob>, sqlx::Error> {
        sqlx::query_as(
            r#"SELECT j.id, j.post_id, j.created_at, j.params, p.content
               FROM reel_jobs j LEFT JOIN posts p ON j.post_id = p.id
               WHERE j.kind = 'video' AND j.status IN ('pending', 'processing')"#,
        )
        .fetch_all(&self.pool)
        .await
    }

    // ------------------------------------------------------------------
    // Générations IA
    // ------------------------------------------------------------------

    pub async fn get_ai_generations(
        &self,
        user_id: &str,
    ) -> Result<Vec<AiGeneration>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM ai_generations WHERE user_id = $1 ORDER BY created_at DESC")
            .bind(user_id)
            .fetch_all(&self.pool)
            .await
    }

    pub async fn create_ai_generation(
        &self,
        user_id: &str,
        product_info: &Value,
        generated_texts: &Value,
    ) -> Result<AiGeneration, sqlx::Error> {
        sqlx::query_as(
            "INSERT INTO ai_generations (user_id, product_info, generated_texts) VALUES ($1, $2, $3) RETURNING *",
        )
        .bind(user_id)
        .bind(product_info)
        .bind(generated_texts)
        .fetch_one(&self.pool)
        .await
    }

    // ------------------------------------------------------------------
    // Configuration du stockage (ex-Cloudinary, désormais local) et logo
    // ------------------------------------------------------------------

    pub async fn get_cloudinary_config(&self) -> Result<Option<CloudinaryConfig>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM cloudinary_config LIMIT 1")
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn create_cloudinary_config(
        &self,
        cloud_name: &str,
        api_key: &str,
        api_secret: &str,
        logo_public_id: Option<&str>,
        endpoint_url: Option<&str>,
        public_url: Option<&str>,
    ) -> Result<CloudinaryConfig, sqlx::Error> {
        sqlx::query_as(
            r#"INSERT INTO cloudinary_config (cloud_name, api_key, api_secret, logo_public_id, endpoint_url, public_url)
               VALUES ($1, $2, $3, $4, $5, $6) RETURNING *"#,
        )
        .bind(cloud_name)
        .bind(api_key)
        .bind(api_secret)
        .bind(logo_public_id)
        .bind(endpoint_url)
        .bind(public_url)
        .fetch_one(&self.pool)
        .await
    }

    /// Met à jour la configuration existante (erreur si elle n'existe pas).
    pub async fn update_cloudinary_config(&self, patch: Patch) -> anyhow::Result<CloudinaryConfig> {
        let existing = self
            .get_cloudinary_config()
            .await?
            .ok_or_else(|| anyhow::anyhow!("Cloudinary config not initialized"))?;
        let patch = patch.set("updated_at", Ts::now());
        let updated = update_returning::<CloudinaryConfig>(
            &self.pool,
            "cloudinary_config",
            &existing.id,
            &patch,
        )
        .await?
        .ok_or_else(|| anyhow::anyhow!("Cloudinary config not initialized"))?;
        Ok(updated)
    }

    // ------------------------------------------------------------------
    // OpenRouter
    // ------------------------------------------------------------------

    pub async fn get_openrouter_config(
        &self,
        user_id: &str,
    ) -> Result<Option<OpenrouterConfig>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM openrouter_config WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn get_any_openrouter_config(&self) -> Result<Option<OpenrouterConfig>, sqlx::Error> {
        sqlx::query_as(
            "SELECT * FROM openrouter_config ORDER BY updated_at DESC NULLS LAST LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
    }

    /// `model` / `system_prompt` absents : valeurs par défaut de la table.
    pub async fn create_openrouter_config(
        &self,
        user_id: &str,
        api_key: &str,
        model: Option<&str>,
        system_prompt: Option<&str>,
    ) -> Result<OpenrouterConfig, sqlx::Error> {
        sqlx::query_as(
            r#"INSERT INTO openrouter_config (user_id, api_key, model, system_prompt)
               VALUES ($1, $2,
                       COALESCE($3, 'anthropic/claude-sonnet-4.5'),
                       COALESCE($4, 'Tu es un expert en marketing des réseaux sociaux. Génère 3 variations de textes engageants pour des publications Facebook et Instagram à partir des informations produit fournies. Chaque variation doit être unique, captivante et optimisée pour l''engagement.'))
               RETURNING *"#,
        )
        .bind(user_id)
        .bind(api_key)
        .bind(model)
        .bind(system_prompt)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn update_openrouter_config(
        &self,
        user_id: &str,
        patch: Patch,
    ) -> Result<Option<OpenrouterConfig>, sqlx::Error> {
        let patch = patch.set("updated_at", Ts::now());
        let mut qb = QueryBuilder::<Postgres>::new("UPDATE openrouter_config SET ");
        patch.push_into(&mut qb);
        qb.push(" WHERE user_id = ");
        qb.push_bind(user_id.to_string());
        qb.push(" RETURNING *");
        qb.build_query_as().fetch_optional(&self.pool).await
    }

    // ------------------------------------------------------------------
    // Permissions des utilisateurs sur les pages
    // ------------------------------------------------------------------

    pub async fn get_user_page_permissions(
        &self,
        user_id: &str,
    ) -> Result<Vec<UserPagePermission>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM user_page_permissions WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(&self.pool)
            .await
    }

    pub async fn get_page_permissions(
        &self,
        page_id: &str,
    ) -> Result<Vec<UserPagePermission>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM user_page_permissions WHERE page_id = $1")
            .bind(page_id)
            .fetch_all(&self.pool)
            .await
    }

    pub async fn create_page_permission(
        &self,
        user_id: &str,
        page_id: &str,
    ) -> Result<UserPagePermission, sqlx::Error> {
        sqlx::query_as(
            "INSERT INTO user_page_permissions (user_id, page_id) VALUES ($1, $2) RETURNING *",
        )
        .bind(user_id)
        .bind(page_id)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn delete_page_permission(
        &self,
        user_id: &str,
        page_id: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM user_page_permissions WHERE user_id = $1 AND page_id = $2")
            .bind(user_id)
            .bind(page_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn delete_all_user_page_permissions(&self, user_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM user_page_permissions WHERE user_id = $1")
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Pages attribuées à un utilisateur (jetons déchiffrés).
    pub async fn get_user_accessible_pages(
        &self,
        user_id: &str,
    ) -> Result<Vec<SocialPage>, sqlx::Error> {
        let pages: Vec<SocialPage> = sqlx::query_as(
            r#"SELECT sp.* FROM user_page_permissions upp
               INNER JOIN social_pages sp ON upp.page_id = sp.id
               WHERE upp.user_id = $1"#,
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(pages.into_iter().map(decrypt_page).collect())
    }

    /// Pages visibles par l'utilisateur : toutes pour un admin, sinon celles attribuées.
    pub async fn get_visible_pages(&self, user: &User) -> Result<Vec<SocialPage>, sqlx::Error> {
        if user.is_admin() {
            self.get_all_social_pages().await
        } else {
            self.get_user_accessible_pages(&user.id).await
        }
    }

    // ------------------------------------------------------------------
    // Musique
    // ------------------------------------------------------------------

    pub async fn get_music_favorites(
        &self,
        user_id: &str,
    ) -> Result<Vec<MusicFavorite>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM music_favorites WHERE user_id = $1 ORDER BY created_at DESC")
            .bind(user_id)
            .fetch_all(&self.pool)
            .await
    }

    pub async fn add_music_favorite(
        &self,
        fav: NewMusicFavorite,
    ) -> Result<MusicFavorite, sqlx::Error> {
        sqlx::query_as(
            r#"INSERT INTO music_favorites (user_id, track_id, title, artist, album_name, duration,
                   preview_url, download_url, image_url, license)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *"#,
        )
        .bind(fav.user_id)
        .bind(fav.track_id)
        .bind(fav.title)
        .bind(fav.artist)
        .bind(fav.album_name)
        .bind(fav.duration)
        .bind(fav.preview_url)
        .bind(fav.download_url)
        .bind(fav.image_url)
        .bind(fav.license)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn remove_music_favorite(
        &self,
        user_id: &str,
        track_id: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM music_favorites WHERE user_id = $1 AND track_id = $2")
            .bind(user_id)
            .bind(track_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn is_music_favorite(
        &self,
        user_id: &str,
        track_id: &str,
    ) -> Result<bool, sqlx::Error> {
        let found: Option<String> = sqlx::query_scalar(
            "SELECT id FROM music_favorites WHERE user_id = $1 AND track_id = $2 LIMIT 1",
        )
        .bind(user_id)
        .bind(track_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(found.is_some())
    }

    // ------------------------------------------------------------------
    // Pistes audio
    // ------------------------------------------------------------------

    pub async fn get_audio_tracks(&self) -> Result<Vec<AudioTrack>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM audio_tracks ORDER BY created_at DESC")
            .fetch_all(&self.pool)
            .await
    }

    pub async fn get_audio_track(&self, id: &str) -> Result<Option<AudioTrack>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM audio_tracks WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn create_audio_track(
        &self,
        user_id: Option<&str>,
        title: &str,
        file_name: &str,
        url: &str,
        duration: i32,
    ) -> Result<AudioTrack, sqlx::Error> {
        sqlx::query_as(
            "INSERT INTO audio_tracks (user_id, title, file_name, url, duration) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        )
        .bind(user_id)
        .bind(title)
        .bind(file_name)
        .bind(url)
        .bind(duration)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn delete_audio_track(&self, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM audio_tracks WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // ------------------------------------------------------------------
    // Configuration de l'application
    // ------------------------------------------------------------------

    pub async fn get_app_config(&self) -> Result<Option<AppConfig>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM app_config LIMIT 1")
            .fetch_optional(&self.pool)
            .await
    }

    /// Colonnes possibles : external_api_key, gemini_api_key, qwen_tts_url, qwen_tts_api_key.
    pub async fn upsert_app_config(&self, patch: Patch) -> Result<AppConfig, sqlx::Error> {
        if let Some(existing) = self.get_app_config().await? {
            let patch = patch.clone().set("updated_at", Ts::now());
            if let Some(updated) =
                update_returning(&self.pool, "app_config", &existing.id, &patch).await?
            {
                return Ok(updated);
            }
        }
        let id: String = sqlx::query_scalar("INSERT INTO app_config DEFAULT VALUES RETURNING id")
            .fetch_one(&self.pool)
            .await?;
        let patch = patch.set("updated_at", Ts::now());
        update_returning(&self.pool, "app_config", &id, &patch)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }

    // ------------------------------------------------------------------
    // Applications développeur Facebook et TikTok (secrets chiffrés)
    // ------------------------------------------------------------------

    pub async fn get_facebook_config(&self) -> Result<Option<FacebookConfig>, sqlx::Error> {
        let config: Option<FacebookConfig> =
            sqlx::query_as("SELECT * FROM facebook_config LIMIT 1")
                .fetch_optional(&self.pool)
                .await?;
        Ok(config.map(|mut c| {
            c.app_secret = decrypt(&c.app_secret);
            c
        }))
    }

    /// Crée ou met à jour ; `app_secret` absent = secret inchangé.
    pub async fn upsert_facebook_config(
        &self,
        app_id: Option<&str>,
        app_secret: Option<&str>,
    ) -> anyhow::Result<FacebookConfig> {
        let existing: Option<FacebookConfig> =
            sqlx::query_as("SELECT * FROM facebook_config LIMIT 1")
                .fetch_optional(&self.pool)
                .await?;
        let secret = app_secret.filter(|s| !s.is_empty()).map(encrypt);
        let mut row: FacebookConfig = match existing {
            Some(existing) => {
                let mut patch = Patch::new();
                if let Some(app_id) = app_id {
                    patch = patch.set("app_id", app_id);
                }
                if let Some(secret) = secret {
                    patch = patch.set("app_secret", secret);
                }
                let patch = patch.set("updated_at", Ts::now());
                update_returning(&self.pool, "facebook_config", &existing.id, &patch)
                    .await?
                    .ok_or_else(|| anyhow::anyhow!("configuration Facebook introuvable"))?
            }
            None => {
                let (Some(app_id), Some(secret)) = (app_id.filter(|s| !s.is_empty()), secret)
                else {
                    anyhow::bail!("L'App ID et l'App Secret Facebook sont requis");
                };
                sqlx::query_as(
                    "INSERT INTO facebook_config (app_id, app_secret) VALUES ($1, $2) RETURNING *",
                )
                .bind(app_id)
                .bind(secret)
                .fetch_one(&self.pool)
                .await?
            }
        };
        row.app_secret = decrypt(&row.app_secret);
        Ok(row)
    }

    pub async fn get_tiktok_config(&self) -> Result<Option<TiktokConfig>, sqlx::Error> {
        let config: Option<TiktokConfig> = sqlx::query_as("SELECT * FROM tiktok_config LIMIT 1")
            .fetch_optional(&self.pool)
            .await?;
        Ok(config.map(|mut c| {
            c.client_secret = decrypt(&c.client_secret);
            c
        }))
    }

    /// Crée ou met à jour ; `client_secret` absent = secret inchangé.
    pub async fn upsert_tiktok_config(
        &self,
        client_key: Option<&str>,
        client_secret: Option<&str>,
    ) -> anyhow::Result<TiktokConfig> {
        let existing: Option<TiktokConfig> = sqlx::query_as("SELECT * FROM tiktok_config LIMIT 1")
            .fetch_optional(&self.pool)
            .await?;
        let secret = client_secret.filter(|s| !s.is_empty()).map(encrypt);
        let mut row: TiktokConfig = match existing {
            Some(existing) => {
                let mut patch = Patch::new();
                if let Some(key) = client_key {
                    patch = patch.set("client_key", key);
                }
                if let Some(secret) = secret {
                    patch = patch.set("client_secret", secret);
                }
                let patch = patch.set("updated_at", Ts::now());
                update_returning(&self.pool, "tiktok_config", &existing.id, &patch)
                    .await?
                    .ok_or_else(|| anyhow::anyhow!("configuration TikTok introuvable"))?
            }
            None => {
                let (Some(key), Some(secret)) = (client_key.filter(|s| !s.is_empty()), secret)
                else {
                    anyhow::bail!("Le client key et le client secret TikTok sont requis");
                };
                sqlx::query_as("INSERT INTO tiktok_config (client_key, client_secret) VALUES ($1, $2) RETURNING *")
                    .bind(key)
                    .bind(secret)
                    .fetch_one(&self.pool)
                    .await?
            }
        };
        row.client_secret = decrypt(&row.client_secret);
        Ok(row)
    }
}

enum ScopeBind {
    Text(String),
    List(Vec<String>),
}
