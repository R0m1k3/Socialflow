# 🚀 Socialflow

**Votre assistant intelligent pour dominer les réseaux sociaux.**

Socialflow est une application tout-en-un conçue pour automatiser, créer et analyser votre contenu sur **Facebook** et **Instagram**. Plus besoin de jongler entre plusieurs outils : tout est là, centralisé et simplifié.

---

## ✨ Fonctionnalités

### 📊 Tableau de Bord Unifié

Vue d'ensemble immédiate de votre activité. Statistiques clés, publications récentes, et suivi de progression des Reels en cours — le tout sur un seul écran.

- **Cartes statistiques** : Followers, publications programmées, Reels en cours
- **Publications récentes** : Historique avec statuts de publication
- **Actions rapides** : Accès direct à la création de contenu
- **Suivi en temps réel** : Progression des Reels (Encodage → Upload → Publication)

![Tableau de Bord](docs/screenshots/dashboard-preview.png)

---

### 🎬 Création de Reels par IA

Créez des vidéos virales en quelques clics sans aucune compétence en montage.

- **Montage automatique** : Transformez vos images et vidéos en Reels dynamiques via FFmpeg
- **Voix-off IA** : Narration professionnelle générée automatiquement
- **Sous-titres automatiques** : Synchronisés avec la voix-off, personnalisables (police, couleur, taille)
- **Musique libre de droits** : Intégration **FreeSound** et **Jamendo** pour des milliers de pistes
- **Hébergement Cloudinary** : Upload automatique vers le cloud pour une diffusion rapide
- **Webcam & Caméra** : Enregistrement intégré directement depuis l'application

![Création de Reel](docs/screenshots/reel-creation.png)

---

### ✍️ Création de Posts Multi-Plateformes

Composez vos publications pour Facebook et Instagram depuis une interface unifiée.

- **Éditeur riche** : Gestion complète des médias (images, vidéos), emojis, et texte
- **Drag & Drop** : Réorganisez vos médias avec le glisser-déposer
- **Génération IA** : Génération de textes (légendes, hashtags) via **OpenRouter** avec choix du modèle IA
- **Multi-pages** : Publiez sur plusieurs pages Facebook/Instagram simultanément
- **Publication immédiate ou programmée** : Planifiez pour plus tard ou publiez maintenant

---

### 🖼️ Éditeur d'Images Intégré

Retouchez vos visuels sans quitter l'application.

- **Textes & annotations** : Ajout de titres, légendes, watermarks
- **Overlays** : Superposition de logos et éléments graphiques
- **Recadrage intelligent** : Optimisé pour les formats réseaux sociaux
- **Export direct** : Réutilisation immédiate dans vos posts et Reels

---

### 📅 Planification & Calendrier

Organisez votre stratégie de contenu sur semaines et mois.

- **Vue calendrier** : Visualisez toutes vos publications planifiées
- **Vue liste** : Accès chronologique avec filtres
- **Drag & Drop** : Réorganisez les dates de publication en les déplaçant
- **Publication automatique** : Le scheduler publie automatiquement aux horaires prévus
- **Édition en ligne** : Modifiez les posts planifiés directement

---

### 📈 Analytics & Statistiques

Suivez la croissance de vos pages avec des données actualisées automatiquement.

- **4 métriques clés** : Abonnés, Portée (impressions uniques), Engagement, Vues de page
- **Graphique d'évolution** : Courbe de croissance jour par jour
- **Tendances** : Comparaison avec la période précédente (variation en %)
- **Synchronisation automatique** : CRON bi-quotidien (8h & 20h), une entrée par jour
- **Connexion Graph API** : Données directes depuis Facebook

---

### 📱 Mobile First

L'application est conçue pour fonctionner aussi bien sur mobile que sur desktop.

- **Interface adaptative** : Chaque page possède sa version mobile dédiée
- **Création mobile** : Posts, Reels, et planification accessibles depuis le téléphone
- **Caméra intégrée** : Enregistrement photo/vidéo via la webcam du téléphone
- **Gestion complète** : Pages, analytics, médias, et paramètres depuis n'importe quel écran

---

### �️ Sécurité & Administration

Architecture Production-Ready avec sécurité renforcée.

| Fonctionnalité                  | Détail                                               |
| ------------------------------- | ---------------------------------------------------- |
| **Authentification**            | bcrypt, sessions PostgreSQL (cookie signé)            |
| **Rate Limiting**               | 1000 req/15min global, 30 tentatives login/15min      |
| **Headers de sécurité**         | CSP, HSTS, X-Frame-Options, nosniff…                  |
| **Chiffrement des tokens**      | Tokens Facebook/Instagram chiffrés (AES-256)          |
| **Gestion multi-utilisateurs**  | Rôles Admin / User, permissions par page              |
| **Console SQL**                 | Requêtes directes en base (admin uniquement)          |
| **Auto-healing tokens**         | Détection et renouvellement automatique des tokens    |
| **CRON jobs**                   | Vérification quotidienne des tokens + analytics       |

---

## 🏗️ Architecture Technique

```
socialflow/
├── client/                    # Frontend React (Vite + TailwindCSS)
│   └── src/
│       ├── pages/             # Pages desktop + mobile
│       ├── components/        # Composants UI (Radix/shadcn)
│       └── remotion/          # Compositions vidéo des Reels (aperçu + rendu)
├── server/                    # Backend Rust (axum + sqlx)
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs            # Démarrage : migrations, routes, tâches de fond
│       ├── migrate.rs         # Schéma PostgreSQL, mis à jour au démarrage
│       ├── auth.rs            # Sessions (cookie connect.sid) et rôles
│       ├── db/                # Accès aux données
│       ├── routes/            # API REST (/api, /api/v1 externe, pages légales)
│       └── services/          # Facebook, TikTok, OpenRouter, Reels, scheduler, crons
├── shared/                    # Types et logique partagés par le frontend
├── remotion-service/          # Rendu des Reels avec Remotion (Node + Chrome)
├── ffmpeg-service/            # Microservice FFmpeg (Python/FastAPI)
├── qwen-tts/                  # Voix Qwen3-TTS (optionnel)
├── docker-compose.yml         # Stack Docker
└── Dockerfile                 # Image de l'application (Rust + frontend compilé)
```

### Stack Technique

| Couche     | Technologies                                                                |
| ---------- | --------------------------------------------------------------------------- |
| **Frontend**   | React 18, Vite, TailwindCSS, Radix UI, Recharts, Wouter                |
| **Backend**    | Rust : axum, tokio, sqlx, reqwest                                        |
| **BDD**        | PostgreSQL 16 (schéma créé et migré automatiquement au démarrage)       |
| **IA**         | OpenRouter (multi-modèle : GPT-4, Claude, Gemini, etc.)                |
| **Médias**     | Stockage local, FFmpeg (vignettes, microservice vidéo), Remotion (Reels) |
| **Réseaux**    | Facebook Graph API (Pages, Instagram, Insights), TikTok Content Posting |
| **Infra**      | Docker Compose, Nginx reverse proxy                                     |

### Mise à jour

L'image de l'application est construite à partir des sources (`pull_policy: build`).
Après un `git pull`, le prochain démarrage de la stack reconstruit l'image et
applique la nouvelle version :

```bash
git pull
docker compose up -d --build
```

Au démarrage, le serveur met le schéma de la base à jour tout seul (aucune
commande de migration à lancer). Les données, les médias, la clé de chiffrement
et les sessions ouvertes sont conservés.

---

## 🚀 Installation Rapide

### Prérequis

- [Docker](https://www.docker.com/) & Docker Compose
- Pour le développement local : [Rust](https://rustup.rs/) (stable), [Node.js](https://nodejs.org/) 20+ et PostgreSQL

### 1. Récupérer l'application

```bash
git clone https://github.com/R0m1k3/Socialflow.git
cd socialflow
```

### 2. Configurer l'environnement

```bash
cp .env.example .env
# Éditez .env avec vos clés API
```

Variables essentielles :

```env
# Base de données
PGPASSWORD=mot-de-passe-fort   # openssl rand -hex 24

# Session (OBLIGATOIRE en production) — openssl rand -hex 32
SESSION_SECRET=votre-cle-secrete-ici
ENCRYPTION_KEY=votre-cle-chiffrement-32-bytes

# IA — https://openrouter.ai/
OPENROUTER_API_KEY=votre-cle-openrouter

# Réseaux Sociaux (optionnel, configurable depuis les Paramètres)
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
```

### 3. Lancer

```bash
# Production (Docker)
docker compose up -d --build

# Développement local (deux terminaux)
npm install
DATABASE_URL=postgresql://... npm run dev:server   # API Rust sur le port 5000
npm run dev                                         # Frontend Vite, relaie /api vers le port 5000
```

🚀 Rendez-vous sur **`http://localhost:5555`** pour commencer !

> **Premier lancement** : un compte `admin` est créé automatiquement, avec le mot de passe de `ADMIN_PASSWORD` ou, à défaut, un mot de passe aléatoire affiché une seule fois dans les journaux (`docker compose logs app | grep "Mot de passe"`). Changez-le ensuite dans les Paramètres.

### Sécurité / variables obligatoires

| Variable | Rôle |
|---|---|
| `PGPASSWORD` | **Obligatoire.** Mot de passe PostgreSQL (`openssl rand -hex 24`). Le port 4523 n'est plus publié sur l'hôte. Instance existante créée avec l'ancien défaut `changeme` : mettez `PGPASSWORD=changeme`, ou changez-le d'abord (`ALTER USER socialflow PASSWORD '…'`) puis reportez la nouvelle valeur. |
| `SESSION_SECRET` | **Obligatoire.** `openssl rand -hex 32`. Les valeurs d'exemple sont refusées. |
| `ADMIN_PASSWORD` | Facultatif. Mot de passe du compte `admin` créé au premier démarrage (sans effet si le compte existe). |
| `ENABLE_SQL_CONSOLE` | `false` par défaut. `true` active la console SQL d'administration, en lecture seule (une seule requête `SELECT`/`WITH`/`EXPLAIN`/`SHOW`). |
| `TRUSTED_PROXIES` | Facultatif. IP/CIDR des reverse proxys dont `X-Forwarded-For` est cru (limitation de débit). Vide : adresses privées seulement. |

Les fichiers téléversés (`/uploads`) ne sont acceptés qu'avec une extension d'image ou de vidéo, et servis avec `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox` (et `Content-Disposition: attachment` hors images, vidéos et sons).

---

## 📖 Documentation Détaillée

Consultez le [Guide d'Installation Complet](INSTALLATION.md) pour :

- Configuration Nginx reverse proxy  
- Certificats SSL (Let's Encrypt)  
- Configuration Cloudinary et FreeSound  
- Mise à jour et sauvegardes  

---

*Fait avec ❤️ pour les créateurs de contenu.*
