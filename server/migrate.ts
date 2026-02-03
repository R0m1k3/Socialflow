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

    console.log("[Migration] Safe migration completed.");
  } catch (error) {
    console.error("[Migration] Error during migration:", error);
    // Don't kill the process, let the app try to start even if migration failed
    // (It might have failed because tables already existed in a different state)
  } finally {
    client.release();
  }
}
