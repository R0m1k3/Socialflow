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
- [x] `server/routes.ts` - Enregistrement du reelsRouter de la configuration

### Phase 3: Frontend ✅

- [x] `client/src/pages/new-reel.tsx` - Page création Reel (workflow 4 étapes)
- [x] `client/src/App.tsx` - Route `/reel`
- [x] `client/src/components/sidebar.tsx` - Lien navigation "Nouveau Reel"
- [x] `client/src/pages/settings.tsx` - Configuration FFmpeg API

### Phase 4: Configuration & UI ⏳

- [x] Configurer FreeSound API (env vars)
- [x] Configurer FFmpeg API URL et clé (interface Settings)
- [/] Ajouter la valeur 'reel' à l'enum post_type en base de données
- [x] Amélioration UI Musique (Pagination, Preview Audio)

## Progress Log

- **22 Jan 2026** - Analyse complète et PRD créé
- **22 Jan 2026** - Spécifications confirmées
- **22 Jan 2026** - Backend complet : ffmpeg.ts, freesound.ts, facebook.ts
- **22 Jan 2026** - Frontend créé : new-reel.tsx
- **22 Jan 2026** - Settings FFmpeg ajoutés
- **22 Jan 2026** - Migration Jamendo -> FreeSound effectuée sur demande utilisateur
- **22 Jan 2026** - Correction preview audio et ajout pagination "10 nouvelles musiques"
