-- Script d'initialisation de la base de données Social Flow
-- Ce fichier contient les commandes SQL pour créer les tables et l'utilisateur admin par défaut

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
