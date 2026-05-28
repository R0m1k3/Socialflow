# Documentation API Socialflow

Bienvenue dans la documentation de l'API de **Socialflow**, une plateforme complète de gestion de contenu pour réseaux sociaux, automatisation de publications, génération de Reels vidéos via FFmpeg et Remotion, et analyse d'audience Facebook & Instagram.

---

## 🚀 Vue d'ensemble de l'API

L'application expose deux types d'API :
1. **API Application (Interne / Client Web)** : Utilisée par le client React/Vite, sécurisée par sessions de cookies d'authentification (`passport.js`).
2. **API Développeur Externe (v1)** : Une API REST standard pour les intégrations tierces, sécurisée par une clé API personnalisée passée dans le header `X-API-Key`.

### Base URLs
- Client Web et API Interne : `/api`
- API Externe v1 : `/api/v1`
- Microservice FFmpeg (Python/FastAPI interne) : `http://ffmpeg-api:8000`

---

## 🔒 Authentification & Contrôle d'Accès

### 1. Sessions Web (API Interne)
La plupart des routes internes requièrent une session active. 
- **Utilisateur Standard** : A accès à ses propres posts, médias, pages connectées et statistiques.
- **Administrateur** : Rôle `admin`. A accès à l'administration des utilisateurs, aux configurations globales de clés API (OpenRouter, Gemini, Cloudinary/MinIO), au terminal SQL et à la gestion globale des pages de tous les utilisateurs.

### 2. Clé API Externe (API v1)
Toutes les requêtes sous `/api/v1` doivent inclure l'en-tête suivant :
```http
X-API-Key: <VOTRE_CLE_API_EXTERNE>
```
La clé externe peut être configurée par un administrateur depuis l'interface des paramètres ou via `/api/settings/external-api`.

---

## 📋 Table des Matières

1. [Authentification & Sessions](#1-authentification--sessions)
2. [Gestion des Utilisateurs (Admin uniquement)](#2-gestion-des-utilisateurs-admin-uniquement)
3. [Gestion des Pages de Réseaux Sociaux](#3-gestion-des-pages-de-réseaux-sociaux)
4. [Gestion des Médias (Photos & Vidéos)](#4-gestion-des-médias-photos--vidéos)
5. [Gestion de l'Audio (Musique de fond)](#5-gestion-de-laudio-musique-de-fond)
6. [Publications & Planification](#6-publications--planification)
7. [Reels & Génération Vidéo (FFmpeg)](#7-reels--génération-vidéo-ffmpeg)
8. [Génération Vidéo Avancée (Remotion)](#8-génération-vidéo-avancée-remotion)
9. [IA & Modèles (OpenRouter)](#9-ia--modèles-openrouter)
10. [Statistiques & Paramètres Système](#10-statistiques--paramètres-système)
11. [Console SQL (Admin uniquement)](#11-console-sql-admin-uniquement)
12. [API d'Analyse (Analytics)](#12-api-danalyse-analytics)
13. [API Développeur Externe (v1)](#13-api-développeur-externe-v1)
14. [Microservice Interne FFmpeg (Python)](#14-microservice-interne-ffmpeg-python)

---

## 1. Authentification & Sessions

### Connexion de l'utilisateur
```http
POST /api/auth/login
```
**Body (JSON) :**
```json
{
  "username": "mon_utilisateur",
  "password": "mon_mot_de_passe"
}
```
**Réponse (200 OK) :**
```json
{
  "id": "usr_12345",
  "username": "mon_utilisateur",
  "role": "user"
}
```

### Déconnexion de l'utilisateur
```http
POST /api/auth/logout
```
**Réponse (200 OK) :**
```json
{
  "message": "Déconnecté avec succès"
}
```

### Récupérer la session courante
```http
GET /api/auth/session
```
**Réponse (200 OK) :**
```json
{
  "id": "usr_12345",
  "username": "mon_utilisateur",
  "role": "user"
}
```

### Vérifier si le mot de passe admin par défaut est actif
Permet de savoir si le mot de passe par défaut `"admin"` de l'utilisateur `"admin"` est toujours actif.
```http
GET /api/auth/default-password-status
```
**Réponse (200 OK) :**
```json
{
  "isDefault": true
}
```

---

## 2. Gestion des Utilisateurs (Admin uniquement)

Toutes ces routes requièrent le rôle `admin`.

### Liste des utilisateurs
```http
GET /api/users
```
**Réponse (200 OK) :**
```json
[
  {
    "id": "usr_123",
    "username": "admin",
    "role": "admin"
  },
  {
    "id": "usr_456",
    "username": "user1",
    "role": "user"
  }
]
```

### Créer un nouvel utilisateur
```http
POST /api/users
```
**Body (JSON) :**
```json
{
  "username": "nouvel_utilisateur",
  "password": "mot_de_passe_robuste",
  "role": "user"
}
```
**Réponse (200 OK) :**
```json
{
  "id": "usr_789",
  "username": "nouvel_utilisateur",
  "role": "user"
}
```

### Modifier un utilisateur
```http
PATCH /api/users/:id
```
**Body (JSON) :**
```json
{
  "username": "nouveau_nom",
  "password": "nouveau_mot_de_passe",
  "role": "admin"
}
```
*Note : Tous les champs du body sont optionnels.*

**Réponse (200 OK) :**
```json
{
  "id": "usr_789",
  "username": "nouveau_nom",
  "role": "admin"
}
```

### Supprimer un utilisateur
```http
DELETE /api/users/:id
```
*Note : Un administrateur ne peut pas supprimer son propre compte.*

**Réponse (200 OK) :**
```json
{
  "success": true,
  "message": "Utilisateur supprimé avec succès"
}
```

### Récupérer les permissions de pages d'un utilisateur
```http
GET /api/users/:id/page-permissions
```
**Réponse (200 OK) :**
```json
[
  {
    "id": "perm_001",
    "userId": "usr_456",
    "pageId": "page_999",
    "createdAt": "2026-05-28T18:00:00Z"
  }
]
```

### Mettre à jour les permissions de pages d'un utilisateur
Assigne un ensemble de pages à un utilisateur. Supprime toutes ses anciennes permissions pour appliquer les nouvelles.
```http
POST /api/users/:id/page-permissions
```
**Body (JSON) :**
```json
{
  "pageIds": ["page_999", "page_888"]
}
```
**Réponse (200 OK) :**
```json
[
  { "id": "perm_1", "userId": "usr_456", "pageId": "page_999" },
  { "id": "perm_2", "userId": "usr_456", "pageId": "page_888" }
]
```

### Synchroniser et migrer les permissions de pages existantes
Associe automatiquement les pages existantes à leurs créateurs respectifs dans la table des permissions pour éviter les blocages de visibilité lors des mises à jour système.
```http
POST /api/admin/migrate-permissions
```
**Réponse (200 OK) :**
```json
{
  "success": true,
  "message": "12 permissions migrées avec succès",
  "migratedCount": 12
}
```

---

## 3. Gestion des Pages de Réseaux Sociaux

Les utilisateurs standard ne voient que les pages auxquelles ils ont accès via les permissions de pages. Les admins voient toutes les pages du système.

### Liste des pages connectées
```http
GET /api/pages
```
**Réponse (200 OK) :**
```json
[
  {
    "id": "page_999",
    "userId": "usr_123",
    "platform": "facebook",
    "pageName": "Ma Page Commerciale",
    "pageId": "1002930239023",
    "accessToken": "EAAG...",
    "tokenExpiresAt": "2026-07-28T18:00:00Z",
    "tokenStatus": "valid",
    "lastTokenCheck": "2026-05-28T19:00:00Z",
    "createdAt": "2026-05-28T18:00:00Z"
  }
]
```

### Connecter une nouvelle page
Enregistre un jeton d'accès Facebook / Instagram obtenu après l'authentification OAuth.
```http
POST /api/pages
```
**Body (JSON) :**
```json
{
  "platform": "facebook",
  "pageName": "Ma Nouvelle Page",
  "pageId": "109823908234",
  "accessToken": "EAAG..."
}
```
**Réponse (200 OK) :**
*(Retourne l'objet de page créé avec calcul de l'expiration du jeton par défaut à 60 jours).*

### Modifier une page (renouvellement de token)
```http
PUT /api/pages/:id
```
**Body (JSON) :**
```json
{
  "accessToken": "NOUVEAU_EAAG...",
  "pageName": "Nouveau Nom de Page"
}
```
*Note : Si un `accessToken` est passé, la date d'expiration est automatiquement repoussée de 60 jours et le statut passe à `valid`.*

**Réponse (200 OK) :**
*(Retourne l'objet mis à jour).*

### Déconnecter / Supprimer une page
```http
DELETE /api/pages/:id
```
**Réponse (200 OK) :**
```json
{
  "success": true
}
```

---

## 4. Gestion des Médias (Photos & Vidéos)

Stockage de fichiers images et vidéos via Cloudinary / MinIO.

### Liste des médias de l'utilisateur
```http
GET /api/media
```
**Réponse (200 OK) :**
```json
[
  {
    "id": "med_123",
    "userId": "usr_123",
    "type": "image",
    "cloudinaryPublicId": "socialflow/uploads/med_123",
    "originalUrl": "/uploads/media/usr_123_17169123.jpg",
    "facebookFeedUrl": "/uploads/media/usr_123_17169123.jpg",
    "instagramFeedUrl": "/uploads/media/usr_123_17169123.jpg",
    "instagramStoryUrl": "/uploads/media/usr_123_17169123.jpg",
    "fileName": "promo.jpg",
    "fileSize": "102432",
    "createdAt": "2026-05-28T18:00:00Z"
  }
]
```

### Téléverser un média
```http
POST /api/media/upload
```
**Body (Multipart Form) :**
- `file` : Le fichier binaire (Image ou Vidéo). Limite de taille : 4 Go pour les vidéos, validation MIME stricte.

**Réponse (200 OK) :**
*(Retourne le média créé après publication asynchrone sur le stockage).*

### Appliquer des Overlays (Ribbon, Prix, Logo)
Permet d'appliquer des filtres de vente sur une image (ex: bandeau rouge "PROMO", badge de prix, et logo d'entreprise en filigrane) grâce au traitement serveur `Sharp`.
```http
POST /api/media/apply-overlays
```
**Body (JSON) :**
```json
{
  "imageUrl": "/uploads/media/usr_123_17169123.jpg",
  "ribbon": {
    "text": "PROMO",
    "color": "red",
    "position": "north_west"
  },
  "priceBadge": {
    "price": "49.99",
    "size": 32,
    "color": "yellow",
    "position": "south_east"
  },
  "logo": {
    "enabled": true,
    "size": "medium",
    "opacity": 80,
    "position": "center"
  }
}
```
**Réponse (200 OK) :**
*(Retourne le nouvel enregistrement média créé avec l'image modifiée).*

### Supprimer un média
Supprime le fichier du stockage Cloudinary / MinIO ainsi que son enregistrement en base.
```http
DELETE /api/media/:id
```
**Réponse (200 OK) :**
```json
{
  "success": true
}
```

---

## 5. Gestion de l'Audio (Musique de fond)

Les pistes audio locales sont stockées directement sur le disque persistant dans `/app/uploads/audio` et utilisées pour le rendu sonore des Reels.

### Liste des pistes audio disponibles
```http
GET /api/audio-tracks
```
**Réponse (200 OK) :**
```json
[
  {
    "id": "aud_001",
    "userId": "usr_123",
    "title": "Acoustic Breeze",
    "fileName": "Acoustic_Breeze.mp3",
    "url": "/uploads/audio/1716912345-Acoustic_Breeze.mp3",
    "duration": 124,
    "createdAt": "2026-05-28T18:00:00Z"
  }
]
```

### Téléverser des pistes audio (Admin uniquement)
Permet l'envoi de plusieurs fichiers simultanément. La durée de la musique est lue automatiquement à partir des métadonnées du fichier MP3/WAV.
```http
POST /api/audio-tracks
```
**Body (Multipart Form) :**
- `files` : Tableau de fichiers audio (`audio/mpeg`, `audio/mp3`, `audio/wav`, `audio/ogg`).

**Réponse (200 OK) :**
```json
{
  "results": [
    {
      "success": true,
      "track": { "id": "aud_002", "title": "Summer Vibe", "duration": 180 }
    }
  ]
}
```

### Corriger l'encodage des noms de fichiers audio (Admin uniquement)
Détecte et répare automatiquement les corruptions d'encodage de caractères (ex: Ã© interprété à tort pour "é") résultant des différences d'en-tête de navigateurs.
```http
POST /api/audio-tracks/fix-encoding
```
**Réponse (200 OK) :**
*(Retourne la liste des pistes avec l'encodage réparé).*

### Supprimer une piste audio (Admin uniquement)
```http
DELETE /api/audio-tracks/:id
```
**Réponse (200 OK) :**
```json
{
  "success": true
}
```

---

## 6. Publications & Planification

### Liste des publications (Posts)
```http
GET /api/posts
```
**Réponse (200 OK) :**
```json
[
  {
    "id": "pst_111",
    "userId": "usr_123",
    "content": "Découvrez notre nouvelle collection d'été ! ☀️",
    "status": "scheduled",
    "scheduledFor": "2026-05-30T10:00:00Z",
    "aiGenerated": "true",
    "createdAt": "2026-05-28T18:00:00Z"
  }
]
```

### Détail d'une publication (avec médias connectés)
```http
GET /api/posts/:id
```
**Réponse (200 OK) :**
```json
{
  "post": { "id": "pst_111", "content": "..." },
  "media": [
    { "id": "med_123", "originalUrl": "..." }
  ]
}
```

### Créer et planifier une publication
Crée une publication liée à un ou plusieurs médias, et génère la planification sur les pages réseaux sociaux spécifiées.
```http
POST /api/posts
```
**Body (JSON) :**
```json
{
  "content": "Superbe produit !",
  "mediaIds": ["med_123"],
  "pageIds": ["page_999"],
  "postType": "both",
  "scheduledFor": "2026-05-30T10:00:00Z"
}
```
*Note sur `postType` : `"feed"` (Fil d'actualité), `"story"` (Story), ou `"both"` (génère deux planifications séparées en base).*

**Réponse (200 OK) :**
*(Retourne le post créé).*

### Modifier le texte d'une publication
```http
PATCH /api/posts/:id
```
**Body (JSON) :**
```json
{
  "content": "Nouveau contenu mis à jour."
}
```
**Réponse (200 OK) :**
*(Retourne le post mis à jour).*

### Modifier la liste de médias liés à une publication
```http
PATCH /api/posts/:id/media
```
**Body (JSON) :**
```json
{
  "mediaIds": ["med_123", "med_456"]
}
```
**Réponse (200 OK) :**
*(Retourne le post avec les nouveaux liens médias).*

### Liste des publications planifiées (Scheduled Posts)
```http
GET /api/scheduled-posts?startDate=2026-05-28&endDate=2026-06-28
```
**Réponse (200 OK) :**
```json
[
  {
    "id": "sch_001",
    "postId": "pst_111",
    "pageId": "page_999",
    "postType": "feed",
    "scheduledAt": "2026-05-30T10:00:00Z",
    "publishedAt": null,
    "externalPostId": null
  }
]
```

### Reporter ou ré-assigner une publication planifiée
```http
PATCH /api/scheduled-posts/:id
```
**Body (JSON) :**
```json
{
  "scheduledAt": "2026-06-01T15:00:00Z",
  "pageId": "page_888"
}
```
**Réponse (200 OK) :**
*(Retourne la planification mise à jour).*

### Annuler une publication planifiée
```http
DELETE /api/scheduled-posts/:id
```
**Réponse (200 OK) :**
```json
{
  "success": true
}
```

---

## 7. Reels & Génération Vidéo (FFmpeg)

Gestion du pipeline de rendu et publication asynchrone de Reels vidéo.

### Générer des variantes de textes publicitaires pour Reels (IA)
```http
POST /api/reels/generate-text
```
**Body (JSON) :**
```json
{
  "productInfo": {
    "name": "Chaise Longue Jardin",
    "description": "Profitez du soleil confortablement avec repose-tête intégré"
  },
  "model": "google/gemini-flash-1.5"
}
```
**Réponse (200 OK) :**
```json
{
  "variants": [
    "🔥 Profitez du soleil avec notre nouvelle Chaise Longue Jardin !",
    "✨ Confort ultime : la Chaise Longue Jardin est là."
  ]
}
```

### Aperçu rapide d'un Reel (Rendu asynchrone de test)
Compile temporairement la vidéo avec texte, voix de synthèse (TTS), et musique de fond. Ne publie rien et renvoie la vidéo sous format base64.
```http
POST /api/reels/preview
```
**Body (JSON) :**
```json
{
  "videoMediaId": "med_video_123",
  "musicTrackId": "internal_aud_001",
  "overlayText": "Offre spéciale d'été ! - 50% sur tout le magasin !",
  "ttsEnabled": true,
  "ttsVoice": "fr-FR-VivienneMultilingualNeural",
  "ttsEngine": "gemini",
  "fontSize": 48,
  "musicVolume": 0.2,
  "stabilize": false,
  "enableEndingEffect": true
}
```
**Réponse (200 OK) :**
```json
{
  "success": true,
  "videoBase64": "AAAAIGZ0eXBtcDQyAAAAAG1w...",
  "duration": 15.42
}
```

### Aperçu de synthèse vocale (TTS Preview)
Génère un clip audio base64 rapide pour écouter la voix de synthèse.
```http
POST /api/reels/tts-preview
```
**Body (JSON) :**
```json
{
  "text": "Bonjour ! Bienvenue chez Socialflow.",
  "ttsVoice": "fr-FR-VivienneMultilingualNeural",
  "ttsEngine": "gemini"
}
```
**Réponse (200 OK) :**
```json
{
  "success": true,
  "audioBase64": "SUQzBAAAAAAAI1RTU0UAAAA..."
}
```

### Obtenir les informations de synchronisation syllabique
Calcule la durée d'affichage de chaque mot selon sa structure phonétique française.
```http
POST /api/reels/sync-info
```
**Body (JSON) :**
```json
{
  "text": "Promotion d'été fantastique",
  "ttsVoice": "fr-FR-VivienneMultilingualNeural",
  "ttsEngine": "gemini"
}
```
**Réponse (200 OK) :**
```json
{
  "duration": 3.42,
  "word_timings": [
    { "word": "Promotion", "start": 0.0, "end": 0.8 },
    { "word": "d'été", "start": 0.8, "end": 1.4 },
    { "word": "fantastique", "start": 1.4, "end": 3.2 }
  ]
}
```

### Créer et mettre en file d'attente un job de Reel
Le pipeline FFmpeg asynchrone tourne en arrière-plan avec une file d'attente pour éviter de saturer les cœurs CPU du serveur.
```http
POST /api/reels
```
*(Même format de body que `/api/reels/preview`, avec en plus le tableau `"pageIds"` des pages cibles pour la publication).*

**Réponse (200 OK) :**
```json
{
  "id": "pst_reel_001",
  "content": "Mon Reel...",
  "generationStatus": "pending",
  "generationProgress": 0
}
```
*Le statut passe de `"pending"` (en attente) -> `"processing"` (en cours) -> `"completed"` (succès) ou `"failed"`.*

### Vérifier le statut de traitement d'un Reel
```http
GET /api/reels/status/:postId
```
**Réponse (200 OK) :**
```json
{
  "id": "pst_reel_001",
  "status": "processing",
  "progress": 45,
  "error": null
}
```

---

## 8. Génération Vidéo Avancée (Remotion)

Remotion permet d'assembler des diaporamas complexes et des vidéos à partir d'images à l'aide d'un navigateur Chromium sans tête (headless).

### Lancer un rendu de vidéo diaporama Remotion
```http
POST /api/remotion/render
```
**Body (Multipart Form) :**
- `existingImageUrls` : (Facultatif) Tableau d'URL d'images déjà enregistrées en base (converties directement en base64 pour contourner les limitations de requêtes réseau Chromium sous Docker).
- `images` : Fichiers images téléversés en direct.
- `music` : Fichier de musique téléversé.
- `musicTrackUrl` : (Facultatif) URL de musique existante.
- `overlayText` : Texte de sous-titre pour la synthèse vocale intégrée.
- `musicVolume` : Volume sonore (ex: `0.3`).

**Réponse (200 OK) :**
```json
{
  "jobId": "remotion_job_171691",
  "message": "Rendu démarré en arrière-plan"
}
```

### Vérifier le statut du rendu Remotion
```http
GET /api/remotion/render/status/:jobId
```
**Réponse (200 OK) :**
```json
{
  "status": "done",
  "url": "/uploads/temp/remotion-171691.mp4",
  "thumbnailUrl": "/uploads/temp/remotion-171691-thumb.jpg",
  "error": null
}
```

### Publier le diaporama généré comme Reel
Téléverse le fichier MP4 finalisé vers le stockage puis publie la vidéo sur les pages cibles.
```http
POST /api/remotion/publish
```
**Body (JSON) :**
```json
{
  "videoUrl": "/uploads/temp/remotion-171691.mp4",
  "pageIds": ["page_999"],
  "description": "Mon diaporama animé créé avec Remotion !",
  "scheduledFor": "2026-06-01T12:00:00Z"
}
```
**Réponse (200 OK) :**
```json
{
  "success": true,
  "postId": "pst_remotion_999",
  "results": [
    { "pageId": "page_999", "success": true, "reelId": "scheduled" }
  ]
}
```

---

## 9. IA & Modèles (OpenRouter)

### Liste des modèles d'écriture IA disponibles
```http
GET /api/ai/models
```
**Réponse (200 OK) :**
```json
{
  "models": [
    { "id": "google/gemini-flash-1.5", "name": "Gemini 1.5 Flash" },
    { "id": "meta-llama/llama-3-70b-instruct", "name": "Llama 3 70B" }
  ]
}
```

### Générer des variantes de textes avec l'IA
```http
POST /api/ai/generate
```
**Body (JSON) :**
```json
{
  "model": "google/gemini-flash-1.5",
  "name": "Salon de Jardin teck",
  "description": "Table ronde extensible avec 6 chaises pliantes"
}
```
**Réponse (200 OK) :**
```json
{
  "variants": [
    "☀️ Profitez de vos repas en extérieur avec ce superbe Salon de Jardin en teck !",
    "✨ Élégant et convivial, notre salon de jardin extensible en teck est en solde."
  ]
}
```

### Liste de l'historique des générations (Admin uniquement)
```http
GET /api/ai/generations
```
**Réponse (200 OK) :**
*(Retourne le journal complet de toutes les générations d'IA faites par les utilisateurs).*

---

## 10. Statistiques & Paramètres Système

### Récupérer les statistiques du tableau de bord
Calcule les publications planifiées, le nombre de pages connectées, le total de textes générés, l'espace de stockage des médias et les tendances d'évolution.
```http
GET /api/stats
```
**Réponse (200 OK) :**
```json
{
  "scheduledPosts": 14,
  "scheduledPostsChange": "+12%",
  "scheduledPostsTrending": "up",
  "connectedPages": 3,
  "aiTextsGenerated": 85,
  "aiTextsChange": "+24%",
  "aiTextsTrending": "up",
  "mediaStored": 240
}
```

### Configuration des services d'arrière-plan (Admin uniquement)

#### Clé API Externe
- `GET /api/settings/external-api` : Vérifie si configurée.
- `POST /api/settings/external-api` : Enregistre la clé externe (Body: `{ "apiKey": "ma_cle" }`).
- `DELETE /api/settings/external-api` : Supprime la clé.

#### Clé API Google Gemini (Pour la synthèse vocale TTS natif)
- `GET /api/settings/gemini` : Vérifie si configurée.
- `POST /api/settings/gemini` : Enregistre la clé API Google Gemini (Body: `{ "apiKey": "AIzaSy..." }`).
- `DELETE /api/settings/gemini` : Supprime la clé.

#### Configuration de Cloudinary / MinIO
- `GET /api/cloudinary/config` : Renvoie les paramètres sécurisés (sans le secret API).
- `POST /api/cloudinary/config` : Configure le Bucket / Espace de stockage (Body: `{ "cloudName", "apiKey", "apiSecret", "publicUrl" }`).
- `POST /api/cloudinary/logo` : Téléverse un logo d'entreprise en filigrane (Watermark) pour les vidéos.
- `DELETE /api/cloudinary/logo` : Supprime le logo.

#### Configuration d'OpenRouter (IA d'écriture)
- `GET /api/openrouter/config` : Récupère la clé configurée.
- `POST /api/openrouter/config` : Enregistre la clé OpenRouter (Body: `{ "apiKey": "sk-or-..." }`).

#### Configuration et diagnostic FFmpeg
- `GET /api/ffmpeg/config` : Statut et URL du microservice.
- `POST /api/ffmpeg/config` : Modifie l'adresse URL du service FFmpeg et déclenche un diagnostic immédiat (Body: `{ "apiUrl": "http://ffmpeg-api:8000" }`).

---

## 11. Console SQL (Admin uniquement)

Ces outils exclusifs aux administrateurs permettent de déboguer ou de faire des opérations de maintenance directement sur la base de données PostgreSQL.

### Exécuter une requête SQL arbitraire
```http
POST /api/sql/execute
```
**Body (JSON) :**
```json
{
  "query": "SELECT count(*) FROM users;"
}
```
**Réponse (200 OK) :**
```json
{
  "success": true,
  "result": {
    "command": "SELECT",
    "rowCount": 1,
    "rows": [ { "count": "3" } ]
  }
}
```

### Liste des tables de la base de données
```http
GET /api/sql/tables
```
**Réponse (200 OK) :**
```json
{
  "tables": [
    { "tablename": "users" },
    { "tablename": "posts" },
    { "tablename": "social_pages" }
  ]
}
```

---

## 12. API d'Analyse (Analytics)

Récupération et mise à jour des statistiques de performance des publications et des pages (portée, clics, croissance d'abonnés).

### Statistiques de performance d'un post
```http
GET /api/analytics/posts/:postId
```
**Réponse (200 OK) :**
```json
{
  "id": "anl_post_001",
  "postId": "pst_111",
  "impressions": 1240,
  "reach": 1050,
  "engagement": 85,
  "reactions": 54,
  "comments": 12,
  "shares": 4,
  "clicks": 15,
  "videoViews": 450,
  "lastSyncedAt": "2026-05-28T19:00:00Z"
}
```

### Forcer la mise à jour des statistiques Facebook d'un post
Interroge directement l'API Facebook Graph pour rafraîchir les métriques à l'instant T.
```http
POST /api/analytics/posts/:postId/refresh
```
**Réponse (200 OK) :**
*(Retourne l'objet d'analyse mis à jour).*

### Historique des statistiques d'une page (30 jours)
Permet de tracer des graphes d'évolution de la portée et des abonnés.
```http
GET /api/analytics/pages/:pageId/history
```
**Réponse (200 OK) :**
```json
[
  {
    "id": "anl_hist_001",
    "pageId": "page_999",
    "followers": 12500,
    "reach": 45000,
    "impressions": 52000,
    "engagement": 3200,
    "date": "2026-05-27"
  }
]
```

### Forcer la mise à jour de la croissance de la page
```http
POST /api/analytics/pages/:pageId/refresh
```
**Réponse (200 OK) :**
*(Retourne les informations de la page actualisée).*

### Lancer la vérification de validité de tous les jetons (Tokens)
Vérifie et renouvelle les jetons d'accès Facebook sur le point d'expirer en arrière-plan.
```http
POST /api/analytics/tokens/check
```
**Réponse (200 OK) :**
```json
{
  "success": true,
  "message": "Token check completed"
}
```

---

## 13. API Développeur Externe (v1)

Ces routes sont optimisées pour les appels de scripts d'intégration tierce.
Toutes les requêtes doivent contenir le header `X-API-Key`.

### Publier un message avec téléchargement d'image
Crée une publication en téléchargeant automatiquement l'image depuis une URL publique fournie (ex: depuis votre ERP ou flux e-commerce), et programme sa publication.
```http
POST /api/v1/publish
```
**Body (JSON) :**
```json
{
  "content": "Découvrez cet article exceptionnel !",
  "imageUrl": "https://mon-site.com/images/produit.jpg",
  "pageIds": ["page_999"],
  "scheduledAt": "2026-06-02T08:00:00.000Z",
  "postType": "feed"
}
```
**Réponse (201 Created) :**
```json
{
  "success": true,
  "post": {
    "id": "pst_ext_999",
    "content": "Découvrez cet article exceptionnel !",
    "status": "scheduled",
    "scheduledAt": "2026-06-02T08:00:00.000Z",
    "postType": "feed",
    "pages": [
      { "pageId": "page_999", "pageName": "Ma Page", "scheduledPostId": "sch_ext_001" }
    ],
    "media": {
      "id": "med_ext_999",
      "url": "/uploads/media/external-17169.jpg"
    }
  }
}
```

### Liste des pages disponibles
Retourne les IDs de pages requis pour l'argument `pageIds` de la route `/publish`.
```http
GET /api/v1/pages
```
**Réponse (200 OK) :**
```json
[
  {
    "id": "page_999",
    "pageName": "Ma Page Commerciale",
    "platform": "facebook",
    "pageId": "1002930239023",
    "tokenStatus": "valid"
  }
]
```

### Liste des publications planifiées en attente
```http
GET /api/v1/posts?pageId=page_999&status=scheduled
```
**Réponse (200 OK) :**
*(Retourne le tableau des publications futures).*

### Modifier une publication planifiée externe
```http
PATCH /api/v1/posts/:id
```
**Body (JSON) :**
```json
{
  "content": "Texte corrigé !",
  "scheduledAt": "2026-06-03T10:00:00Z",
  "imageUrl": "https://mon-site.com/images/produit-rectifie.jpg"
}
```
*Note : Tous les champs sont facultatifs. L'envoi d'une nouvelle URL d'image écrase et remplace le média précédent.*

**Réponse (200 OK) :**
*(Retourne la publication modifiée avec sa liste de planification actualisée).*

### Supprimer/Annuler une publication externe
```http
DELETE /api/v1/posts/:id
```
**Réponse (200 OK) :**
```json
{
  "success": true,
  "deleted": "pst_ext_999"
}
```

---

## 14. Microservice Interne FFmpeg (Python)

Ce service s'exécute sur le port `8000` et gère le pipeline de rendu lourd FFmpeg.

### Health Check
```http
GET /health
```
**Réponse (200 OK) :**
```json
{
  "status": "healthy",
  "service": "ffmpeg-service"
}
```

### Diagnostic de la configuration FFmpeg
Vérifie si les binaires système FFmpeg et FFprobe sont installés et accessibles sur le serveur, et dresse la liste des codecs vidéo/audio disponibles.
```http
GET /debug-ffmpeg
```
**Réponse (200 OK) :**
```json
{
  "ffmpeg_installed": true,
  "ffprobe_installed": true,
  "ffmpeg_version": "7.0.1",
  "codecs": ["h264", "aac", "mp3"]
}
```

### Traitement vidéo complexe de Reel
Assemble un fichier vidéo à partir d'une URL de base, y intègre de la musique de fond à volume ajusté, génère la voix de synthèse TTS, et applique des sous-titres animés synchronisés syllabe par syllabe.
```http
POST /process-reel
```
**Headers :**
```http
X-API-Key: <FFMPEG_API_KEY>
```
**Body (JSON) :**
```json
{
  "video_url": "http://socialflow-app:5555/uploads/media/video.mp4",
  "text": "Superbe opportunité à saisir !",
  "music_url": "http://socialflow-app:5555/uploads/audio/track.mp3",
  "music_volume": 0.25,
  "tts_enabled": true,
  "tts_voice": "fr-FR-VivienneMultilingualNeural",
  "tts_engine": "gemini",
  "gemini_api_key": "AIzaSy...",
  "draw_text": true,
  "stabilize": false,
  "watermark_url": "http://socialflow-app:5555/uploads/logos/logo.png",
  "enable_ending_effect": true
}
```
**Réponse (200 OK) :**
```json
{
  "success": true,
  "video_base64": "AAAAIGZ0eXBtcDQyAAAAAG1w...",
  "duration": 12.35
}
```

### Synthétiser et prévisualiser une voix (TTS)
```http
POST /preview-tts
```
**Headers :**
```http
X-API-Key: <FFMPEG_API_KEY>
```
**Body (JSON) :**
```json
{
  "text": "Offre exceptionnelle !",
  "tts_voice": "fr-FR-VivienneMultilingualNeural",
  "tts_engine": "gemini",
  "gemini_api_key": "AIzaSy..."
}
```
**Réponse (200 OK) :**
```json
{
  "success": true,
  "audio_base64": "SUQzBAAAAAAAI1RTU0UAAAA..."
}
```
