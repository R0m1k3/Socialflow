-- Script d'initialisation de la base de données Social Flow
-- Ce fichier contient les commandes SQL pour créer les tables et l'utilisateur admin par défaut

-- IMPORTANT: Pour les serveurs privés existants, ajouter la valeur 'both' à l'enum post_type
-- Commande à exécuter manuellement sur votre serveur privé :
-- ALTER TYPE post_type ADD VALUE IF NOT EXISTS 'both';

-- Créer l'enum pour les rôles utilisateur (si pas déjà créé par drizzle-kit push)
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'user');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Créer l'utilisateur admin par défaut (username: admin, password: admin)
-- Note: Le hash bcrypt pour "admin" est généré avec un salt de 10
INSERT INTO users (id, username, password, role) 
VALUES (
  'admin-user-id',
  'admin',
  '$2b$10$mw7B1qBoTxxT7BT.Mv9uTeExX27y5nPVN4/e6L7W1VqkTNe/tGw9G',
  'admin'
) ON CONFLICT (username) DO NOTHING;

-- Créer un utilisateur demo pour les tests
INSERT INTO users (id, username, password, role) 
VALUES (
  'demo-user',
  'demo',
  '$2b$10$mw7B1qBoTxxT7BT.Mv9uTeExX27y5nPVN4/e6L7W1VqkTNe/tGw9G',
  'user'
) ON CONFLICT (username) DO NOTHING;

-- Créer la table user_page_permissions (permissions d'accès aux pages par utilisateur)
CREATE TABLE IF NOT EXISTS user_page_permissions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id VARCHAR NOT NULL REFERENCES social_pages(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, page_id)
);

-- Index pour optimiser les requêtes de permissions
CREATE INDEX IF NOT EXISTS idx_user_page_permissions_user_id ON user_page_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_page_permissions_page_id ON user_page_permissions(page_id);

-- Liste des tables créées automatiquement par Drizzle ORM :
-- - users (utilisateurs avec rôles)
-- - social_pages (pages Facebook/Instagram connectées)
-- - cloudinary_config (configuration Cloudinary par utilisateur)
-- - openrouter_config (configuration OpenRouter par utilisateur)
-- - media (fichiers médias stockés dans Cloudinary)
-- - posts (publications créées)
-- - scheduled_posts (publications programmées)
-- - ai_generations (historique des générations IA)
-- - post_media (relation many-to-many entre posts et media)
-- - user_page_permissions (permissions d'accès aux pages par utilisateur)
