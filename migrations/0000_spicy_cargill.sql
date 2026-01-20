CREATE TYPE "public"."media_type" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('facebook', 'instagram');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('draft', 'scheduled', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."post_type" AS ENUM('feed', 'story', 'both');--> statement-breakpoint
CREATE TYPE "public"."token_status" AS ENUM('valid', 'expiring', 'expired', 'error');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TABLE "ai_generations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"product_info" jsonb NOT NULL,
	"generated_texts" jsonb NOT NULL,
	"selected_text" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cloudinary_config" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"cloud_name" text NOT NULL,
	"api_key" text NOT NULL,
	"api_secret" text NOT NULL,
	"logo_public_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "cloudinary_config_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"type" "media_type" NOT NULL,
	"cloudinary_public_id" text,
	"original_url" text NOT NULL,
	"facebook_landscape_url" text,
	"facebook_feed_url" text,
	"instagram_feed_url" text,
	"instagram_story_url" text,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "openrouter_config" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"api_key" text NOT NULL,
	"model" text DEFAULT 'anthropic/claude-3.5-sonnet' NOT NULL,
	"system_prompt" text DEFAULT 'Tu es un expert en marketing des réseaux sociaux. Génère 3 variations de textes engageants pour des publications Facebook et Instagram à partir des informations produit fournies. Chaque variation doit être unique, captivante et optimisée pour l''engagement.' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "openrouter_config_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "page_analytics_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" varchar NOT NULL,
	"date" timestamp NOT NULL,
	"followers_count" integer DEFAULT 0,
	"page_views" integer DEFAULT 0,
	"page_reach" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "post_analytics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" varchar NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "post_media" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" varchar NOT NULL,
	"media_id" varchar NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"content" text NOT NULL,
	"ai_generated" text DEFAULT 'false' NOT NULL,
	"product_info" jsonb,
	"status" "post_status" DEFAULT 'draft' NOT NULL,
	"scheduled_for" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scheduled_posts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" varchar NOT NULL,
	"page_id" varchar NOT NULL,
	"post_type" "post_type" NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"published_at" timestamp,
	"external_post_id" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "social_pages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"platform" "platform" NOT NULL,
	"page_id" text NOT NULL,
	"page_name" text NOT NULL,
	"access_token" text NOT NULL,
	"token_expires_at" timestamp,
	"followers_count" integer DEFAULT 0,
	"is_active" text DEFAULT 'true' NOT NULL,
	"token_status" "token_status" DEFAULT 'valid',
	"last_token_check" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_page_permissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"page_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloudinary_config" ADD CONSTRAINT "cloudinary_config_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openrouter_config" ADD CONSTRAINT "openrouter_config_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_analytics_history" ADD CONSTRAINT "page_analytics_history_page_id_social_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."social_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_analytics" ADD CONSTRAINT "post_analytics_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_page_id_social_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."social_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_pages" ADD CONSTRAINT "social_pages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_page_permissions" ADD CONSTRAINT "user_page_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_page_permissions" ADD CONSTRAINT "user_page_permissions_page_id_social_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."social_pages"("id") ON DELETE cascade ON UPDATE no action;