-- ============================================================
-- MIGRATION SQL POUR SERVEUR DOCKER EXISTANT
-- Script de mise à jour pour Social Flow
-- ============================================================
-- Ce fichier contient toutes les commandes SQL pour mettre à jour
-- une base de données existante vers la dernière version du schéma
-- ============================================================

-- ÉTAPE 1: Créer les ENUMs s'ils n'existent pas déjà
-- ============================================================

DO $$ BEGIN
  CREATE TYPE platform AS ENUM ('facebook', 'instagram');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE post_type AS ENUM ('feed', 'story', 'both');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE post_status AS ENUM ('draft', 'scheduled', 'published', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE media_type AS ENUM ('image', 'video');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'user');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- IMPORTANT: Ajouter 'both' à post_type si serveur existant
-- Cette valeur a été ajoutée récemment
DO $$ BEGIN
  ALTER TYPE post_type ADD VALUE IF NOT EXISTS 'both';
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN others THEN null;
END $$;

-- ÉTAPE 2: Créer les tables principales
-- ============================================================

-- Table users
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'user'
);

-- Table social_pages
CREATE TABLE IF NOT EXISTS social_pages (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform platform NOT NULL,
  page_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  access_token TEXT NOT NULL,
  followers_count INTEGER DEFAULT 0,
  is_active TEXT NOT NULL DEFAULT 'true',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table cloudinary_config
CREATE TABLE IF NOT EXISTS cloudinary_config (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  cloud_name TEXT NOT NULL,
  api_key TEXT NOT NULL,
  api_secret TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Table openrouter_config
CREATE TABLE IF NOT EXISTS openrouter_config (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  api_key TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'anthropic/claude-3.5-sonnet',
  system_prompt TEXT NOT NULL DEFAULT 'Tu es un expert en marketing des réseaux sociaux. Génère 3 variations de textes engageants pour des publications Facebook et Instagram à partir des informations produit fournies. Chaque variation doit être unique, captivante et optimisée pour l''engagement.',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Table media
CREATE TABLE IF NOT EXISTS media (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type media_type NOT NULL,
  cloudinary_public_id TEXT,
  original_url TEXT NOT NULL,
  facebook_landscape_url TEXT,
  facebook_feed_url TEXT,
  instagram_feed_url TEXT,
  instagram_story_url TEXT,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table posts
CREATE TABLE IF NOT EXISTS posts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  ai_generated TEXT NOT NULL DEFAULT 'false',
  product_info JSONB,
  status post_status NOT NULL DEFAULT 'draft',
  scheduled_for TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Table post_media
CREATE TABLE IF NOT EXISTS post_media (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id VARCHAR NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id VARCHAR NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0
);

-- Table scheduled_posts
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id VARCHAR NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  page_id VARCHAR NOT NULL REFERENCES social_pages(id) ON DELETE CASCADE,
  post_type post_type NOT NULL,
  scheduled_at TIMESTAMP NOT NULL,
  published_at TIMESTAMP,
  external_post_id TEXT,
  error TEXT
);

-- Table ai_generations
CREATE TABLE IF NOT EXISTS ai_generations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_info JSONB NOT NULL,
  generated_texts JSONB NOT NULL,
  selected_text TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table user_page_permissions
CREATE TABLE IF NOT EXISTS user_page_permissions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id VARCHAR NOT NULL REFERENCES social_pages(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, page_id)
);

-- ÉTAPE 3: Créer les index pour optimiser les performances
-- ============================================================

-- Index pour user_page_permissions
CREATE INDEX IF NOT EXISTS idx_user_page_permissions_user_id ON user_page_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_page_permissions_page_id ON user_page_permissions(page_id);

-- Index pour scheduled_posts
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_scheduled_at ON scheduled_posts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_post_id ON scheduled_posts(post_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_page_id ON scheduled_posts(page_id);

-- Index pour posts
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_for ON posts(scheduled_for);

-- Index pour media
CREATE INDEX IF NOT EXISTS idx_media_user_id ON media(user_id);

-- ÉTAPE 4: Créer les utilisateurs par défaut
-- ============================================================

-- Créer l'utilisateur admin (username: admin, password: admin)
INSERT INTO users (id, username, password, role) 
VALUES (
  'admin-user-id',
  'admin',
  '$2b$10$mw7B1qBoTxxT7BT.Mv9uTeExX27y5nPVN4/e6L7W1VqkTNe/tGw9G',
  'admin'
) ON CONFLICT (username) DO NOTHING;

-- Créer un utilisateur demo (username: demo, password: admin)
INSERT INTO users (id, username, password, role) 
VALUES (
  'demo-user',
  'demo',
  '$2b$10$mw7B1qBoTxxT7BT.Mv9uTeExX27y5nPVN4/e6L7W1VqkTNe/tGw9G',
  'user'
) ON CONFLICT (username) DO NOTHING;

-- ÉTAPE 5: Mise à jour des posts programmés existants (si migration)
-- ============================================================
-- Mettre à jour le statut des posts programmés qui étaient en "draft"
UPDATE posts 
SET status = 'scheduled' 
WHERE scheduled_for IS NOT NULL 
  AND status = 'draft';

-- ============================================================
-- FIN DE LA MIGRATION
-- ============================================================
-- 
-- INSTRUCTIONS D'UTILISATION:
-- 
-- 1. Pour un NOUVEAU serveur Docker:
--    - Rien à faire ! Le docker-compose.yml exécute automatiquement
--      "drizzle-kit push --force" qui crée toutes les tables
--
-- 2. Pour un serveur Docker EXISTANT avec données:
--    - Connectez-vous à PostgreSQL:
--      docker exec -it socialflow-db psql -U socialflow -d socialflow
--    - Exécutez ce fichier:
--      \i /chemin/vers/migration-docker.sql
--    
-- 3. Alternative avec commande directe:
--    docker exec -i socialflow-db psql -U socialflow -d socialflow < migration-docker.sql
-- 
-- ============================================================
