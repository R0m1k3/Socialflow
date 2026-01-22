# Task: Socialflow - Facebook Reels avec Musique et Texte

## Context

Ajout d'une fonctionnalité complète de création de Reels Facebook permettant de capturer une vidéo, ajouter une musique libre de droits (FreeSound API), superposer du texte style TikTok, et publier via l'API Graph Facebook. Le traitement vidéo sera effectué via une API FFmpeg Docker locale.

## Current Focus

**Phase: VERIFICATION** - Implémentation terminée, améliorations UI (preview audio, pagination musique).

## Master Plan

### Phase 0: Clarifications ✅

- [x] Confirmer source de musique → FreeSound API (ex-Jamendo)
- [x] Confirmer URL et format API FFmpeg Docker → `/process-reel`, base64, X-API-Key
- [x] Style texte → TikTok (animation mot par mot)

### Phase 1: Backend Services ✅

- [x] `server/services/ffmpeg.ts` - Intégration API FFmpeg Docker
- [x] `server/services/freesound.ts` - Service recherche musique FreeSound
- [x] `server/services/facebook.ts` - Méthodes `publishReel()` et `publishReelFromBuffer()`

### Phase 2: Database & Routes ✅

- [x] `shared/schema.ts` - Ajout type "reel" à postTypeEnum
- [x] `server/routes/reels.ts` - Routes API complètes
- [x] [NEW] `server/cron.ts` - Setup Daily Token Check
- [x] [NEW] `ffmpeg-service/` - Dedicated Python microservice for video processing
  - [x] `main.py` (FastAPI, FFmpeg logic)
  - [x] `Dockerfile` & `requirements.txt`
  - [x] Fix `font_path` NameError in `main.py`
- [x] [CFG] `docker-compose.yml` - Add `ffmpeg-api` service & Link to App
- [x] `server/routes.ts` - Enregistrement du reelsRouter de la configuration

### Phase 3: Frontend ✅

- [x] `client/src/pages/new-reel.tsx` - Page création Reel (workflow 4 étapes)
- [x] `client/src/App.tsx` - Route `/reel`
- [x] `client/src/components/sidebar.tsx` - Lien navigation "Nouveau Reel"
- [x] `client/src/pages/settings.tsx` - Configuration FFmpeg API

### Phase 4: Configuration & UI ⏳

- [x] Configurer FreeSound API (env vars)
- [x] Configurer FFmpeg API URL et clé (interface Settings)
- [x] Ajouter la voix off (TTS) gratuite via Edge-TTS
  - [x] FFmpeg Service: Installer edge-tts et implémenter le mixage audio
  - [x] Backend: Supporter les options TTS (enable, voice)
  - [x] Améliorer le TTS (Genre, Sync, Cleanup)
  - [x] FFmpeg: Nettoyer le texte (No hashtags/emojis) avant TTS
  - [x] FFmpeg: Générer fichier VTT pour synchro sous-titres
  - [x] FFmpeg: Enlever le son original quand TTS activé
  - [x] Frontend: Sélecteur de voix (Homme/Femme) - *Switched Male default to Henri*
- [/] Ajouter la valeur 'reel' à l'enum post_type en base de données
- [x] Amélioration UI Musique (Pagination, Preview Audio)
- [x] **Improve Camera Capture Quality** (User Request)
  - [x] Create `CameraRecorder` component with 4K/1080p/720p quality selector
  - [x] Integrate CameraRecorder into `new-reel.tsx`
  - [x] Add quality settings panel in camera UI

## Progress Log

- **22 Jan 2026** - Analyse complète et PRD créé
- **22 Jan 2026** - Spécifications confirmées
- **22 Jan 2026** - Backend complet : ffmpeg.ts, freesound.ts, facebook.ts
- **22 Jan 2026** - Frontend créé : new-reel.tsx
- **22 Jan 2026** - Settings FFmpeg ajoutés
- **22 Jan 2026** - Migration Jamendo -> FreeSound effectuée sur demande utilisateur
- **22 Jan 2026** - Correction preview audio et ajout pagination "10 nouvelles musiques"
