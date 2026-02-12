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
| **Authentification**            | Passport.js + bcrypt, sessions PostgreSQL             |
| **Rate Limiting**               | 100 req/15min global, 5 tentatives login/15min        |
| **Headers de sécurité**         | Helmet (CSP, HSTS, XSS protection)                   |
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
│       ├── pages/             # 17 pages desktop + 13 pages mobile
│       ├── components/        # 47 composants UI (Radix/shadcn)
│       └── hooks/             # Hooks React personnalisés
├── server/                    # Backend Express.js (TypeScript)
│   ├── routes.ts              # 45+ endpoints REST API
│   ├── routes/                # Routes modulaires (analytics, reels)
│   ├── services/              # 12 services métier
│   │   ├── analytics.ts       # Sync Facebook Graph API
│   │   ├── facebook.ts        # Publication Facebook/Instagram
│   │   ├── openrouter.ts      # Génération texte IA
│   │   ├── cloudinary.ts      # Upload cloud médias
│   │   ├── ffmpeg.ts          # Encodage vidéo (microservice)
│   │   ├── freesound.ts       # Musique libre de droits
│   │   ├── jamendo.ts         # Musique libre de droits
│   │   ├── imageProcessor.ts  # Traitement images (Sharp)
│   │   ├── scheduler.ts       # Publications programmées
│   │   └── token_manager.ts   # Gestion tokens OAuth
│   └── cron.ts                # Tâches planifiées
├── shared/                    # Schéma DB partagé (Drizzle ORM)
├── ffmpeg-service/            # Microservice FFmpeg (Python/FastAPI)
├── docker-compose.yml         # Stack Docker (3 services)
└── Dockerfile                 # Image production Node.js
```

### Stack Technique

| Couche     | Technologies                                                                |
| ---------- | --------------------------------------------------------------------------- |
| **Frontend**   | React 18, Vite, TailwindCSS, Radix UI, Recharts, Framer Motion, Wouter |
| **Backend**    | Express.js, TypeScript, Passport.js, Helmet, node-cron                  |
| **BDD**        | PostgreSQL 16, Drizzle ORM, connect-pg-simple (sessions)                |
| **IA**         | OpenRouter (multi-modèle : GPT-4, Claude, Gemini, etc.)                |
| **Médias**     | Cloudinary (upload), Sharp (images), FFmpeg microservice (vidéo)        |
| **Musique**    | FreeSound API, Jamendo API                                               |
| **Réseaux**    | Facebook Graph API v19 (Pages, Instagram, Insights)                     |
| **Infra**      | Docker Compose, Nginx reverse proxy                                     |

---

## 🚀 Installation Rapide

### Prérequis

- [Docker](https://www.docker.com/) & Docker Compose
- [Node.js](https://nodejs.org/) v18+ (pour le développement local)

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
DATABASE_URL=postgresql://socialflow:changeme@postgres:4523/socialflow

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
docker-compose up -d

# Développement local
npm install
npm run dev
```

🚀 Rendez-vous sur **`http://localhost:5555`** pour commencer !

> **Premier lancement** : Un compte admin est créé automatiquement (`admin` / `admin`). Changez le mot de passe immédiatement dans les Paramètres.

---

## 📖 Documentation Détaillée

Consultez le [Guide d'Installation Complet](INSTALLATION.md) pour :

- Configuration Nginx reverse proxy  
- Certificats SSL (Let's Encrypt)  
- Configuration Cloudinary et FreeSound  
- Mise à jour et sauvegardes  

---

*Fait avec ❤️ pour les créateurs de contenu.*
