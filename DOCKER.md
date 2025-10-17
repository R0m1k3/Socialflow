# Déploiement Docker - Social Flow

## 📋 Configuration

L'application utilise Docker Compose pour orchestrer :
- **PostgreSQL 16** : Base de données sur réseau interne
- **Social Flow App** : Application Node.js exposée sur le port **4523**

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

- **PostgreSQL** : Accessible sur le port **4523** (interne et externe)
- **Application** : Accessible via Nginx sur le réseau `nginx_default`

## 🔧 Architecture réseau

### Réseau interne (`internal`)
- PostgreSQL et l'application communiquent sur ce réseau privé

### Réseau nginx (`nginx_default`)
- Réseau externe pour le reverse proxy Nginx
- PostgreSQL et l'application sont sur ce réseau
- Permet l'accès via Nginx et un domaine personnalisé

### Ports exposés
- **PostgreSQL** : `4523:4523` (port hôte 4523 → port container 4523)
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

## 🔒 Sécurité en production

1. **Variables d'environnement** : Ne commitez JAMAIS le fichier `.env`
2. **Mots de passe** : Utilisez des mots de passe forts et aléatoires
3. **SESSION_SECRET** : Générez une clé aléatoire de 32+ caractères
4. **Firewall** : Limitez l'accès au port 4523 ou utilisez Nginx
5. **HTTPS** : Configurez un certificat SSL (Let's Encrypt + Nginx)

## 📊 Healthchecks

- **PostgreSQL** : Vérifie que la base est prête avant de démarrer l'app
- **Migrations** : Exécutées automatiquement au démarrage (`drizzle-kit push --force`)

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

- `postgres_data` : Données persistantes de PostgreSQL
- Mappages locaux :
  - `./attached_assets` → `/app/attached_assets` (médias uploadés)
  - `./migrations` → `/app/migrations` (migrations DB)

## 🔄 Mise à jour de l'application

```bash
# 1. Pull les dernières modifications
git pull

# 2. Reconstruire l'image
docker-compose build

# 3. Redémarrer
docker-compose up -d

# 4. Vérifier les logs
docker-compose logs -f app
```
