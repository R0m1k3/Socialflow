//! Migration du schéma au démarrage, idempotente.
//!
//! Sur une base existante (créée par l'ancien serveur Node/Drizzle), toutes
//! les instructions sont sans effet ou complètent ce qui manque ; sur une base
//! vide, elles créent l'intégralité du schéma. Chaque instruction est exécutée
//! isolément : un échec est journalisé sans empêcher les suivantes, ni le
//! démarrage de l'application.

use sqlx::PgPool;

const ENUMS: &[&str] = &[
    r#"DO $$ BEGIN CREATE TYPE "platform" AS ENUM('facebook', 'instagram', 'tiktok'); EXCEPTION WHEN duplicate_object THEN null; END $$;"#,
    r#"DO $$ BEGIN CREATE TYPE "post_type" AS ENUM('feed', 'story', 'both', 'reel'); EXCEPTION WHEN duplicate_object THEN null; END $$;"#,
    r#"DO $$ BEGIN CREATE TYPE "post_status" AS ENUM('draft', 'scheduled', 'published', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;"#,
    r#"DO $$ BEGIN CREATE TYPE "media_type" AS ENUM('image', 'video'); EXCEPTION WHEN duplicate_object THEN null; END $$;"#,
    r#"DO $$ BEGIN CREATE TYPE "user_role" AS ENUM('admin', 'user'); EXCEPTION WHEN duplicate_object THEN null; END $$;"#,
    r#"DO $$ BEGIN CREATE TYPE "token_status" AS ENUM('valid', 'expiring', 'expired', 'error'); EXCEPTION WHEN duplicate_object THEN null; END $$;"#,
    r#"ALTER TYPE "post_type" ADD VALUE IF NOT EXISTS 'reel';"#,
    r#"ALTER TYPE "platform" ADD VALUE IF NOT EXISTS 'tiktok';"#,
];

const TABLES: &[&str] = &[
    r#"CREATE TABLE IF NOT EXISTS "users" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "username" text NOT NULL,
        "password" text NOT NULL,
        "role" "user_role" DEFAULT 'user' NOT NULL,
        CONSTRAINT "users_username_unique" UNIQUE ("username")
    )"#,
    r#"CREATE TABLE IF NOT EXISTS "social_pages" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
        "platform" "platform" NOT NULL,
        "page_id" text NOT NULL,
        "page_name" text NOT NULL,
        "access_token" text NOT NULL,
        "token_expires_at" timestamp,
        "followers_count" integer DEFAULT 0,
        "is_active" text DEFAULT 'true' NOT NULL,
        "token_status" "token_status" DEFAULT 'valid',
        "last_token_check" timestamp,
        "user_access_token" text,
        "user_token_expires_at" timestamp,
        "token_error" text,
        "refresh_token" text,
        "refresh_token_expires_at" timestamp,
        "scopes" text,
        "avatar_url" text,
        "created_at" timestamp DEFAULT now()
    )"#,
    r#"CREATE TABLE IF NOT EXISTS "media" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
        "type" "media_type" NOT NULL,
        "cloudinary_public_id" text,
        "original_url" text NOT NULL,
        "facebook_landscape_url" text,
        "facebook_feed_url" text,
        "instagram_feed_url" text,
        "instagram_story_url" text,
        "thumbnail_url" text,
        "file_name" text NOT NULL,
        "file_size" integer NOT NULL,
        "created_at" timestamp DEFAULT now()
    )"#,
    r#"CREATE TABLE IF NOT EXISTS "posts" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
        "content" text NOT NULL,
        "ai_generated" text DEFAULT 'false' NOT NULL,
        "product_info" jsonb,
        "status" "post_status" DEFAULT 'draft' NOT NULL,
        "scheduled_for" timestamp,
        "generation_status" text,
        "generation_progress" integer DEFAULT 0,
        "generation_error" text,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
    )"#,
    r#"CREATE TABLE IF NOT EXISTS "post_media" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "post_id" varchar NOT NULL REFERENCES "posts"("id") ON DELETE cascade,
        "media_id" varchar NOT NULL REFERENCES "media"("id") ON DELETE cascade,
        "display_order" integer DEFAULT 0 NOT NULL
    )"#,
    r#"CREATE TABLE IF NOT EXISTS "scheduled_posts" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "post_id" varchar NOT NULL REFERENCES "posts"("id") ON DELETE cascade,
        "page_id" varchar NOT NULL REFERENCES "social_pages"("id") ON DELETE cascade,
        "post_type" "post_type" NOT NULL,
        "scheduled_at" timestamp NOT NULL,
        "published_at" timestamp,
        "external_post_id" text,
        "error" text,
        "publish_id" text,
        "publish_status" text
    )"#,
    r#"CREATE TABLE IF NOT EXISTS "ai_generations" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
        "product_info" jsonb NOT NULL,
        "generated_texts" jsonb NOT NULL,
        "selected_text" text,
        "created_at" timestamp DEFAULT now()
    )"#,
    r#"CREATE TABLE IF NOT EXISTS "cloudinary_config" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "cloud_name" text NOT NULL,
        "api_key" text NOT NULL,
        "api_secret" text NOT NULL,
        "logo_public_id" text,
        "endpoint_url" text,
        "public_url" text,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
    )"#,
    r#"CREATE TABLE IF NOT EXISTS "openrouter_config" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
        "api_key" text NOT NULL,
        "model" text DEFAULT 'anthropic/claude-sonnet-4.5' NOT NULL,
        "system_prompt" text DEFAULT 'Tu es un expert en marketing des réseaux sociaux. Génère 3 variations de textes engageants pour des publications Facebook et Instagram à partir des informations produit fournies. Chaque variation doit être unique, captivante et optimisée pour l''engagement.' NOT NULL,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now(),
        CONSTRAINT "openrouter_config_user_id_unique" UNIQUE ("user_id")
    )"#,
    r#"CREATE TABLE IF NOT EXISTS "user_page_permissions" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
        "page_id" varchar NOT NULL REFERENCES "social_pages"("id") ON DELETE cascade,
        "created_at" timestamp DEFAULT now()
    )"#,
    r#"CREATE TABLE IF NOT EXISTS "post_analytics" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "post_id" varchar NOT NULL REFERENCES "posts"("id") ON DELETE cascade,
        "fetched_at" timestamp DEFAULT now(),
        "impressions" integer DEFAULT 0,
        "reach" integer DEFAULT 0,
        "engagement" integer DEFAULT 0,
        "reactions" integer DEFAULT 0,
        "comments" integer DEFAULT 0,
        "shares" integer DEFAULT 0,
        "clicks" integer DEFAULT 0,
        "raw_data" jsonb
    )"#,
    r#"CREATE TABLE IF NOT EXISTS "page_analytics_history" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "page_id" varchar NOT NULL REFERENCES "social_pages"("id") ON DELETE cascade,
        "date" timestamp NOT NULL,
        "followers_count" integer DEFAULT 0,
        "page_views" integer DEFAULT 0,
        "page_reach" integer DEFAULT 0,
        "page_engagement" integer DEFAULT 0,
        "created_at" timestamp DEFAULT now()
    )"#,
    r#"CREATE TABLE IF NOT EXISTS "music_favorites" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
        "track_id" text NOT NULL,
        "title" text NOT NULL,
        "artist" text NOT NULL,
        "album_name" text,
        "duration" integer NOT NULL,
        "preview_url" text NOT NULL,
        "download_url" text NOT NULL,
        "image_url" text,
        "license" text,
        "created_at" timestamp DEFAULT now()
    )"#,
    r#"CREATE TABLE IF NOT EXISTS "audio_tracks" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" varchar REFERENCES "users"("id") ON DELETE cascade,
        "title" text NOT NULL,
        "file_name" text NOT NULL,
        "url" text NOT NULL,
        "duration" integer DEFAULT 0,
        "created_at" timestamp DEFAULT now()
    )"#,
    r#"CREATE TABLE IF NOT EXISTS "app_config" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "external_api_key" text,
        "gemini_api_key" text,
        "qwen_tts_url" text,
        "qwen_tts_api_key" text,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
    )"#,
    r#"CREATE TABLE IF NOT EXISTS "tiktok_config" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "client_key" text NOT NULL,
        "client_secret" text NOT NULL,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
    )"#,
    r#"CREATE TABLE IF NOT EXISTS "facebook_config" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "app_id" text NOT NULL,
        "app_secret" text NOT NULL,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
    )"#,
    r#"CREATE TABLE IF NOT EXISTS "reel_jobs" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
        "post_id" varchar REFERENCES "posts"("id") ON DELETE cascade,
        "kind" text NOT NULL,
        "params" jsonb NOT NULL,
        "status" text NOT NULL DEFAULT 'pending',
        "step" text,
        "progress" integer NOT NULL DEFAULT 0,
        "attempts" integer NOT NULL DEFAULT 0,
        "result" jsonb,
        "error" text,
        "heartbeat_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
    )"#,
    // Sessions : même table que connect-pg-simple, les utilisateurs déjà
    // connectés le restent après la mise à jour.
    r#"CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default" PRIMARY KEY,
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL
    )"#,
];

/// Colonnes ajoutées au fil des versions : complètent les bases anciennes.
const COLUMNS: &[&str] = &[
    r#"ALTER TABLE "social_pages" ADD COLUMN IF NOT EXISTS "token_status" "token_status" DEFAULT 'valid'"#,
    r#"ALTER TABLE "social_pages" ADD COLUMN IF NOT EXISTS "last_token_check" timestamp"#,
    r#"ALTER TABLE "social_pages"
        ADD COLUMN IF NOT EXISTS "refresh_token" text,
        ADD COLUMN IF NOT EXISTS "refresh_token_expires_at" timestamp,
        ADD COLUMN IF NOT EXISTS "scopes" text,
        ADD COLUMN IF NOT EXISTS "avatar_url" text"#,
    r#"ALTER TABLE "social_pages"
        ADD COLUMN IF NOT EXISTS "user_access_token" text,
        ADD COLUMN IF NOT EXISTS "user_token_expires_at" timestamp,
        ADD COLUMN IF NOT EXISTS "token_error" text"#,
    r#"ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "generation_status" text"#,
    r#"ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "generation_progress" integer DEFAULT 0"#,
    r#"ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "generation_error" text"#,
    r#"ALTER TABLE "cloudinary_config" ADD COLUMN IF NOT EXISTS "endpoint_url" text"#,
    r#"ALTER TABLE "cloudinary_config" ADD COLUMN IF NOT EXISTS "public_url" text"#,
    r#"ALTER TABLE "page_analytics_history" ADD COLUMN IF NOT EXISTS "page_engagement" integer DEFAULT 0"#,
    r#"ALTER TABLE "app_config" ADD COLUMN IF NOT EXISTS "gemini_api_key" text"#,
    r#"ALTER TABLE "app_config"
        ADD COLUMN IF NOT EXISTS "qwen_tts_url" text,
        ADD COLUMN IF NOT EXISTS "qwen_tts_api_key" text"#,
    r#"ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "thumbnail_url" text"#,
    r#"ALTER TABLE "scheduled_posts"
        ADD COLUMN IF NOT EXISTS "publish_id" text,
        ADD COLUMN IF NOT EXISTS "publish_status" text"#,
];

/// Index de performance (Postgres n'indexe pas les clés étrangères seul).
const INDEXES: &[(&str, &str)] = &[
    (
        "idx_posts_user_id",
        r#"CREATE INDEX IF NOT EXISTS "idx_posts_user_id" ON "posts" ("user_id")"#,
    ),
    (
        "idx_media_user_id",
        r#"CREATE INDEX IF NOT EXISTS "idx_media_user_id" ON "media" ("user_id")"#,
    ),
    (
        "idx_social_pages_user_id",
        r#"CREATE INDEX IF NOT EXISTS "idx_social_pages_user_id" ON "social_pages" ("user_id")"#,
    ),
    (
        "idx_ai_generations_user_id",
        r#"CREATE INDEX IF NOT EXISTS "idx_ai_generations_user_id" ON "ai_generations" ("user_id")"#,
    ),
    (
        "idx_scheduled_posts_post_id",
        r#"CREATE INDEX IF NOT EXISTS "idx_scheduled_posts_post_id" ON "scheduled_posts" ("post_id")"#,
    ),
    (
        "idx_post_media_post_id",
        r#"CREATE INDEX IF NOT EXISTS "idx_post_media_post_id" ON "post_media" ("post_id")"#,
    ),
    (
        "idx_post_media_media_id",
        r#"CREATE INDEX IF NOT EXISTS "idx_post_media_media_id" ON "post_media" ("media_id")"#,
    ),
    (
        "idx_post_analytics_post_id",
        r#"CREATE INDEX IF NOT EXISTS "idx_post_analytics_post_id" ON "post_analytics" ("post_id")"#,
    ),
    (
        "idx_page_analytics_history_page_date",
        r#"CREATE INDEX IF NOT EXISTS "idx_page_analytics_history_page_date" ON "page_analytics_history" ("page_id", "date")"#,
    ),
    (
        "idx_user_page_permissions_user_id",
        r#"CREATE INDEX IF NOT EXISTS "idx_user_page_permissions_user_id" ON "user_page_permissions" ("user_id")"#,
    ),
    (
        "idx_user_page_permissions_page_id",
        r#"CREATE INDEX IF NOT EXISTS "idx_user_page_permissions_page_id" ON "user_page_permissions" ("page_id")"#,
    ),
    (
        "idx_scheduled_posts_page_scheduled_at",
        r#"CREATE INDEX IF NOT EXISTS "idx_scheduled_posts_page_scheduled_at" ON "scheduled_posts" ("page_id", "scheduled_at")"#,
    ),
    (
        "idx_scheduled_posts_pending",
        r#"CREATE INDEX IF NOT EXISTS "idx_scheduled_posts_pending" ON "scheduled_posts" ("scheduled_at") WHERE "published_at" IS NULL"#,
    ),
    (
        "idx_scheduled_posts_publish_id",
        r#"CREATE INDEX IF NOT EXISTS "idx_scheduled_posts_publish_id" ON "scheduled_posts" ("publish_id") WHERE "publish_id" IS NOT NULL"#,
    ),
    (
        "idx_reel_jobs_queue",
        r#"CREATE INDEX IF NOT EXISTS "idx_reel_jobs_queue" ON "reel_jobs" ("created_at") WHERE "status" IN ('pending', 'processing')"#,
    ),
    (
        "idx_posts_generation_status",
        r#"CREATE INDEX IF NOT EXISTS "idx_posts_generation_status" ON "posts" ("generation_status") WHERE "generation_status" IS NOT NULL"#,
    ),
    (
        "IDX_session_expire",
        r#"CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")"#,
    ),
];

pub async fn run(pool: &PgPool) {
    tracing::info!("[Migration] Vérification du schéma…");
    let mut failures = 0;

    for statement in ENUMS.iter().chain(TABLES).chain(COLUMNS) {
        if let Err(error) = sqlx::raw_sql(statement).execute(pool).await {
            failures += 1;
            let head: String = statement
                .split_whitespace()
                .take(6)
                .collect::<Vec<_>>()
                .join(" ");
            tracing::warn!("[Migration] Échec de « {head} … » : {error}");
        }
    }

    for (name, statement) in INDEXES {
        if let Err(error) = sqlx::raw_sql(statement).execute(pool).await {
            failures += 1;
            tracing::warn!("[Migration] Index {name} non créé : {error}");
        }
    }

    if failures == 0 {
        tracing::info!("[Migration] Schéma à jour.");
    } else {
        tracing::warn!("[Migration] Terminée avec {failures} avertissement(s).");
    }
}
