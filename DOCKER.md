# Déploiement Docker - Social Flow

## 📋 Configuration

L'application utilise Docker Compose pour orchestrer :
- **PostgreSQL 16** : Base de données sur réseau interne
- **Social Flow App** : serveur Rust (API + frontend compilé), port interne **5555**
- **ffmpeg-api** / **remotion-renderer** : services de traitement vidéo des Reels

## 🚀 Démarrage rapide

### 1. Copier le fichier d'environnement

```bash
cp .env.example .env
```

### 2. Éditer les variables d'environnement

Modifiez `.env` avec vos valeurs :

```bash
# Base de données
PGDATABASE=socialflow
PGUSER=socialflow
PGPASSWORD=votre_mot_de_passe_securise

# Application
PORT=4523
SESSION_SECRET=votre_cle_secrete_aleatoire

# API OpenRouter (pour la génération IA)
OPENROUTER_API_KEY=votre_cle_openrouter
```

### 3. Lancer les conteneurs

```bash
# Démarrer en arrière-plan
docker-compose up -d

# Voir les logs
docker-compose logs -f

# Arrêter
docker-compose down
```

## 🌐 Accès

- **PostgreSQL** : port **4523**, joignable uniquement depuis les conteneurs (non publié sur l'hôte)
- **Application** : Accessible via Nginx sur le réseau `nginx_default`

## 🔧 Architecture réseau

### Réseau interne (`internal`)
- PostgreSQL et l'application communiquent sur ce réseau privé

### Réseau nginx (`nginx_default`)
- Réseau externe pour le reverse proxy Nginx
- PostgreSQL et l'application sont sur ce réseau
- Permet l'accès via Nginx et un domaine personnalisé

### Ports exposés
- **PostgreSQL** : aucun port publié (pour un accès ponctuel : `127.0.0.1:4523:4523`)
- **Application** : Port 5555 interne (non exposé sur l'hôte, accessible via Nginx)

## 📝 Configuration Nginx

### Prérequis : Créer le réseau nginx

**Avant de lancer docker-compose**, créez le réseau nginx (une seule fois) :

```bash
docker network create nginx_default
```

### Configuration Nginx

Configurez Nginx pour cibler l'application sur le port **5555** :

```nginx
upstream socialflow {
    server socialflow-app:5555;  # ← Port interne de l'application
}

server {
    listen 80;
    server_name votre-domaine.com;

    location / {
        proxy_pass http://socialflow;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Important** : Si vous n'utilisez pas Nginx, vous pouvez retirer le réseau `nginx_default` du `docker-compose.yml`.

## 🛠️ Commandes utiles

### Reconstruire les images

```bash
docker-compose build --no-cache
docker-compose up -d
```

### Voir les logs d'un service spécifique

```bash
docker-compose logs -f app      # Application
docker-compose logs -f postgres # Base de données
```

### Accéder au conteneur

```bash
docker-compose exec app sh       # Shell de l'application
docker-compose exec postgres psql -U socialflow  # PostgreSQL CLI
```

### Nettoyer complètement

```bash
# Arrêter et supprimer les conteneurs, réseaux
docker-compose down

# Supprimer aussi les volumes (⚠️ PERTE DE DONNÉES)
docker-compose down -v
```

## 🔗 URL publique et connexions OAuth (Facebook / TikTok)

Les boutons « Connecter une page » construisent une URI de redirection à partir
de l'URL publique de l'application. Renseignez donc `APP_URL` avec le domaine
réel :

```bash
APP_URL=https://socialflow.exemple.fr
```

Puis déclarez l'URI correspondante chez le fournisseur :

- Facebook : *Connexion Facebook → Paramètres → URI de redirection OAuth valides*
  → `https://socialflow.exemple.fr/api/facebook/callback`
- TikTok : *Login Kit → Redirect URI* → `https://socialflow.exemple.fr/api/tiktok/callback`

Si `APP_URL` est absent, l'URL est déduite des en-têtes `X-Forwarded-Proto` et
`X-Forwarded-Host` envoyés par Nginx — vérifiez que le proxy les transmet
(voir la configuration Nginx ci-dessus). Un `APP_URL` réglé sur
`http://localhost:5555` en production produit une URI que Facebook refuse.

## 🧩 Déploiement via Portainer (stack Git)

La stack se construit depuis les sources : `app` et `ffmpeg-api` ont une section
`build:`, leurs images n'existent sur aucun registre.

- **« Pull and redeploy » échoue** avec `pull access denied for <stack>-app,
  repository does not exist` : Docker cherche sur Docker Hub une image qui est
  construite localement. Le `pull_policy: build` du `docker-compose.yml` évite
  cette tentative ; si votre version de Portainer déclenche quand même le pull,
  décochez **« Re-pull image »** dans la mise à jour de la stack.
- Pour reconstruire après une mise à jour du dépôt : *Stack → Editor →
  Update the stack*, en laissant Docker rebâtir les images (ou
  `docker compose up -d --build` en ligne de commande).
- Le nom des images est figé (`socialflow-app:latest`,
  `socialflow-ffmpeg-api:latest`) : il ne dépend donc plus du nom donné à la
  stack dans Portainer.

## 🎙️ Service ffmpeg-api (voix et rendu des Reels)

- **Premier build plus long** : l'image embarque FFmpeg 7.0.2 (version
  épinglée), les polices des sous-titres et le modèle Whisper qui cale les
  sous-titres mot à mot sur la voix (~150 Mo avec `WHISPER_MODEL=base`).
- **Voix Gemini** : renseignez `GEMINI_API_KEY` (ou la clé dans l'application).
  Sans clé, la voix Edge gratuite est utilisée et un avertissement apparaît
  dans les logs.
- **Moteur de rendu** : par défaut, les Reels vidéo sont montés par Remotion
  (sous-titres animés, identiques à l'aperçu de l'application). En cas de
  serveur trop lent, `REEL_RENDERER=ffmpeg` revient au rendu FFmpeg, plus
  rapide. `RENDER_CONCURRENCY` limite le nombre d'onglets Chromium.
- **Vérifier la version déployée** : au démarrage, les logs de `socialflow-app`
  affichent `[ReelQueue] Worker démarré`, et `socialflow-ffmpeg` répond
  `{"status":"ok","version":2}` sur `/health`.
- **Tests du service** : `pip install -r requirements-dev.txt`, puis `pytest`
  et `ruff check .` dans `ffmpeg-service/`.

## 🔒 Sécurité en production

1. **Variables d'environnement** : Ne commitez JAMAIS le fichier `.env`
2. **Mots de passe** : Utilisez des mots de passe forts et aléatoires
3. **SESSION_SECRET** : Générez une clé aléatoire de 32+ caractères
4. **Base de données** : ne publiez jamais le port 4523 sur toutes les interfaces
5. **HTTPS** : Configurez un certificat SSL (Let's Encrypt + Nginx)

## 📊 Healthchecks

- **PostgreSQL** : Vérifie que la base est prête avant de démarrer l'app
- **Migrations** : exécutées automatiquement par le serveur à chaque démarrage (idempotentes)
- **Application** : `GET /healthz` répond `ok` quand le serveur et la base sont joignables (healthcheck de l'image)

## 🐛 Dépannage

### L'application ne démarre pas

```bash
# Vérifier les logs
docker-compose logs app

# Vérifier que PostgreSQL est prêt
docker-compose exec postgres pg_isready -U socialflow
```

### Port 4523 déjà utilisé

```bash
# Trouver le processus
sudo lsof -i :4523

# Ou changer le port dans .env et docker-compose.yml
```

### Erreur de connexion à la base de données

Vérifiez que `DATABASE_URL` dans `.env` correspond aux variables `PGUSER`, `PGPASSWORD`, etc.

## 📦 Volumes Docker

- `postgres_data` : données persistantes de PostgreSQL
- `encryption_key` : clé de chiffrement des jetons (`/app/.encryption-key-data`)
- `audio_uploads`, `media_uploads`, `logos_uploads`, `stories_uploads` : fichiers téléversés (`/app/uploads/...`)

## 🔄 Mise à jour de l'application

L'image `socialflow-app` est construite à partir des sources
(`pull_policy: build`) : le prochain démarrage de la stack après un `git pull`
applique la nouvelle version.

```bash
# 1. Récupérer les dernières modifications
git pull

# 2. Reconstruire et redémarrer (Portainer : « Update the stack »)
docker compose up -d --build

# 3. Vérifier les logs
docker compose logs -f app
```

Au démarrage, le serveur complète le schéma de la base (tables, colonnes,
index) : aucune commande de migration n'est nécessaire. Les données, les
fichiers téléversés, la clé de chiffrement et les sessions ouvertes sont
conservés.

### Passage au serveur Rust

Depuis la version 2, le serveur est écrit en Rust (dossier `server/`) et
remplace l'ancien serveur Node/Express. La bascule ne demande rien de plus
qu'une reconstruction : mêmes variables d'environnement, même base, mêmes
volumes, et les utilisateurs déjà connectés le restent (cookie `connect.sid`
et table `session` repris tels quels). Le rendu Remotion des Reels tourne
désormais dans son propre conteneur (`remotion-renderer`).
