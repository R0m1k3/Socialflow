import { pool } from "./db";

export async function migrate() {
  const client = await pool.connect();
  try {
    console.log("[Migration] Starting safe migration Check...");

    // 1. Create Enums if not exist and Update Enums
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "token_status" AS ENUM('valid', 'expiring', 'expired', 'error');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Add 'reel' to post_type enum if not exists
    await client.query(`ALTER TYPE "post_type" ADD VALUE IF NOT EXISTS 'reel';`);

    // Add 'tiktok' to platform enum if not exists
    await client.query(`ALTER TYPE "platform" ADD VALUE IF NOT EXISTS 'tiktok';`);

    // 2. Create Tables if not exist

    // post_analytics
    await client.query(`
      CREATE TABLE IF NOT EXISTS "post_analytics" (
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
      );
    `);

    // page_analytics_history
    await client.query(`
      CREATE TABLE IF NOT EXISTS "page_analytics_history" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "page_id" varchar NOT NULL REFERENCES "social_pages"("id") ON DELETE cascade,
        "date" timestamp NOT NULL,
        "followers_count" integer DEFAULT 0,
        "page_views" integer DEFAULT 0,
        "page_reach" integer DEFAULT 0,
        "created_at" timestamp DEFAULT now()
      );
    `);

    // 3. Add Columns to existing tables if not exist

    // social_pages.token_status
    await client.query(`
      ALTER TABLE "social_pages" 
      ADD COLUMN IF NOT EXISTS "token_status" "token_status" DEFAULT 'valid';
    `);

    // social_pages.last_token_check
    await client.query(`
      ALTER TABLE "social_pages" 
      ADD COLUMN IF NOT EXISTS "last_token_check" timestamp;
    `);

    // music_favorites
    await client.query(`
      CREATE TABLE IF NOT EXISTS "music_favorites" (
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
      );
    `);

    // freesound_config
    await client.query(`
      CREATE TABLE IF NOT EXISTS "freesound_config" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
        "client_id" text NOT NULL,
        "client_secret" text NOT NULL,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now(),
        CONSTRAINT freesound_config_user_id_unique UNIQUE ("user_id")
      );
    `);

    // posts.generation_status (Reel progress tracking)
    await client.query(`
      ALTER TABLE "posts"
      ADD COLUMN IF NOT EXISTS "generation_status" text;
    `);

    // posts.generation_progress
    await client.query(`
      ALTER TABLE "posts"
      ADD COLUMN IF NOT EXISTS "generation_progress" integer DEFAULT 0;
    `);

    // posts.generation_error
    await client.query(`
      ALTER TABLE "posts"
      ADD COLUMN IF NOT EXISTS "generation_error" text;
    `);

    // cloudinary_config.endpoint_url (MinIO internal endpoint URL)
    await client.query(`
      ALTER TABLE "cloudinary_config"
      ADD COLUMN IF NOT EXISTS "endpoint_url" text;
    `);

    // cloudinary_config.public_url (MinIO public-facing base URL)
    await client.query(`
      ALTER TABLE "cloudinary_config"
      ADD COLUMN IF NOT EXISTS "public_url" text;
    `);
    // page_analytics_history.page_engagement
    await client.query(`
      ALTER TABLE "page_analytics_history"
      ADD COLUMN IF NOT EXISTS "page_engagement" integer DEFAULT 0;
    `);

    // audio_tracks (bibliothèque audio interne)
    await client.query(`
      CREATE TABLE IF NOT EXISTS "audio_tracks" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" varchar REFERENCES "users"("id") ON DELETE cascade,
        "title" text NOT NULL,
        "file_name" text NOT NULL,
        "url" text NOT NULL,
        "duration" integer DEFAULT 0,
        "created_at" timestamp DEFAULT now()
      );
    `);

    // app_config (global application settings)
    await client.query(`
      CREATE TABLE IF NOT EXISTS "app_config" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "external_api_key" text,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );
    `);

    // app_config.gemini_api_key
    await client.query(`
      ALTER TABLE "app_config"
      ADD COLUMN IF NOT EXISTS "gemini_api_key" text;
    `);

    // media.thumbnail_url (vignette conservée après suppression de la vidéo)
    await client.query(`
      ALTER TABLE "media"
      ADD COLUMN IF NOT EXISTS "thumbnail_url" text;
    `);

    // tiktok_config (application développeur TikTok, globale)
    await client.query(`
      CREATE TABLE IF NOT EXISTS "tiktok_config" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "client_key" text NOT NULL,
        "client_secret" text NOT NULL,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );
    `);

    // social_pages : champs OAuth TikTok
    await client.query(`
      ALTER TABLE "social_pages"
      ADD COLUMN IF NOT EXISTS "refresh_token" text,
      ADD COLUMN IF NOT EXISTS "refresh_token_expires_at" timestamp,
      ADD COLUMN IF NOT EXISTS "scopes" text,
      ADD COLUMN IF NOT EXISTS "avatar_url" text;
    `);

    // facebook_config (application développeur Facebook, globale)
    await client.query(`
      CREATE TABLE IF NOT EXISTS "facebook_config" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "app_id" text NOT NULL,
        "app_secret" text NOT NULL,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );
    `);

    // social_pages : renouvellement automatique des tokens Facebook
    await client.query(`
      ALTER TABLE "social_pages"
      ADD COLUMN IF NOT EXISTS "user_access_token" text,
      ADD COLUMN IF NOT EXISTS "user_token_expires_at" timestamp,
      ADD COLUMN IF NOT EXISTS "token_error" text;
    `);

    // scheduled_posts : suivi de la publication asynchrone TikTok
    await client.query(`
      ALTER TABLE "scheduled_posts"
      ADD COLUMN IF NOT EXISTS "publish_id" text,
      ADD COLUMN IF NOT EXISTS "publish_status" text;
    `);

    // 4. Index de performance
    //
    // Postgres n'indexe pas les clés étrangères tout seul : sans ces index, le
    // calendrier, l'historique et le scheduler faisaient des parcours complets
    // de table à chaque appel. Ils existaient dans migration-docker.sql, qui
    // n'est monté nulle part — ce fichier-ci est le seul exécuté au démarrage.
    //
    // Chaque index est créé isolément : une table absente sur une vieille
    // installation ne doit pas empêcher la création des suivants.
    const indexes: [string, string][] = [
      // Filtres par propriétaire
      ["idx_posts_user_id", `CREATE INDEX IF NOT EXISTS "idx_posts_user_id" ON "posts" ("user_id")`],
      ["idx_media_user_id", `CREATE INDEX IF NOT EXISTS "idx_media_user_id" ON "media" ("user_id")`],
      ["idx_social_pages_user_id", `CREATE INDEX IF NOT EXISTS "idx_social_pages_user_id" ON "social_pages" ("user_id")`],
      ["idx_ai_generations_user_id", `CREATE INDEX IF NOT EXISTS "idx_ai_generations_user_id" ON "ai_generations" ("user_id")`],

      // Jointures
      ["idx_scheduled_posts_post_id", `CREATE INDEX IF NOT EXISTS "idx_scheduled_posts_post_id" ON "scheduled_posts" ("post_id")`],
      ["idx_post_media_post_id", `CREATE INDEX IF NOT EXISTS "idx_post_media_post_id" ON "post_media" ("post_id")`],
      ["idx_post_media_media_id", `CREATE INDEX IF NOT EXISTS "idx_post_media_media_id" ON "post_media" ("media_id")`],
      ["idx_post_analytics_post_id", `CREATE INDEX IF NOT EXISTS "idx_post_analytics_post_id" ON "post_analytics" ("post_id")`],
      ["idx_page_analytics_history_page_date", `CREATE INDEX IF NOT EXISTS "idx_page_analytics_history_page_date" ON "page_analytics_history" ("page_id", "date")`],
      ["idx_user_page_permissions_user_id", `CREATE INDEX IF NOT EXISTS "idx_user_page_permissions_user_id" ON "user_page_permissions" ("user_id")`],
      ["idx_user_page_permissions_page_id", `CREATE INDEX IF NOT EXISTS "idx_user_page_permissions_page_id" ON "user_page_permissions" ("page_id")`],

      // Calendrier et historique : « les publications de ces pages, sur cette période »
      ["idx_scheduled_posts_page_scheduled_at", `CREATE INDEX IF NOT EXISTS "idx_scheduled_posts_page_scheduled_at" ON "scheduled_posts" ("page_id", "scheduled_at")`],

      // Scheduler (toutes les minutes) : seules les publications non encore
      // traitées comptent, d'où un index partiel qui reste minuscule.
      ["idx_scheduled_posts_pending", `CREATE INDEX IF NOT EXISTS "idx_scheduled_posts_pending" ON "scheduled_posts" ("scheduled_at") WHERE "published_at" IS NULL`],

      // Suivi asynchrone TikTok (toutes les deux minutes)
      ["idx_scheduled_posts_publish_id", `CREATE INDEX IF NOT EXISTS "idx_scheduled_posts_publish_id" ON "scheduled_posts" ("publish_id") WHERE "publish_id" IS NOT NULL`],

      // Reels en cours de génération
      ["idx_posts_generation_status", `CREATE INDEX IF NOT EXISTS "idx_posts_generation_status" ON "posts" ("generation_status") WHERE "generation_status" IS NOT NULL`],
    ];

    for (const [name, statement] of indexes) {
      try {
        await client.query(statement);
      } catch (error) {
        console.warn(`[Migration] Index ${name} non créé:`, error instanceof Error ? error.message : error);
      }
    }

    console.log("[Migration] Safe migration completed.");
  } catch (error) {
    console.error("[Migration] Error during migration:", error);
    // Don't kill the process, let the app try to start even if migration failed
    // (It might have failed because tables already existed in a different state)
  } finally {
    client.release();
  }
}
