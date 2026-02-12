# 🚀 Socialflow

**Votre assistant intelligent pour dominer les réseaux sociaux.**

Socialflow est une application tout-en-un conçue pour automatiser, créer et analyser votre contenu sur **Facebook** et **Instagram**. Plus besoin de jongler entre plusieurs outils : tout est là, centralisé et simplifié.

---

## ✨ Ce que vous pouvez faire avec Socialflow

### 1. Tableau de Bord Unifié

Ayez une vue d'ensemble immédiate sur vos performances. Suivez vos followers, votre portée et l'engagement de vos pages en temps réel.
![Tableau de Bord](docs/screenshots/dashboard-preview.png)

### 2. Création de Reels par IA 🎬

Créez des vidéos virales en quelques secondes sans aucune compétence en montage.

- **Montage automatique** : Transformez vos images/vidéos en Reels dynamiques.
- **Voix-off IA** : Ajoutez une narration professionnelle.
- **Sous-titres automatiques** : Parfaitement synchronisés pour capter l'attention.
![Création de Reel](docs/screenshots/reel-creation.png)

### 3. Planification Intuitive 📅

Préparez vos publications à l'avance et laissez Socialflow gérer le reste.

- Vue calendrier claire.
- Glisser-déposer pour réorganiser.
- Publication automatique sur Facebook et Instagram.
![Calendrier de Planification](docs/screenshots/planning.png)

### 4. Suivi de Progression en Temps Réel ⏳

Ne devinez plus si votre vidéo est prête. Suivez l'avancement de la création de vos Reels étape par étape (Encodage, Upload, Publication) directement depuis votre dashboard, sur mobile comme sur ordinateur.
![Suivi de Progression](docs/screenshots/progress-tracking.png)

---

## 🚀 Installation Rapide (En 3 étapes)

Prérequis : Avoir [Docker](https://www.docker.com/) et [Node.js](https://nodejs.org/) installés.

### 1. Récupérer l'application

Ouvrez votre terminal et lancez :

```bash
git clone https://github.com/votre-utilisateur/socialflow.git
cd socialflow
```

### 2. Installer les dépendances

```bash
npm install
```

### 3. Lancer

Démarrez tout le système avec une seule commande :

```bash
npm run dev
# Ou avec Docker pour la production : docker-compose up -d
```

🚀 Rendez-vous sur **`http://localhost:5000`** pour commencer !

---

## ⚙️ Configuration (La première fois seulement)

Créez un fichier `.env` à la racine pour vos clés API (copiez `.env.example` pour commencer) :

```env
# Base de données (PostgreSQL)
DATABASE_URL=postgres://user:pass@localhost:5432/socialflow

# IA & Services
OPENROUTER_API_KEY=votre_cle_ici
CLOUDINARY_URL=votre_url_cloudinary

# Réseaux Sociaux
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
```

---

## 📱 Mobile First

L'application est conçue pour fonctionner aussi bien sur votre ordinateur que sur votre téléphone. Gérez vos réseaux où que vous soyez.

---

*Fait avec ❤️ pour les créateurs de contenu.*
