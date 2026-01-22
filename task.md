# Task: Socialflow - Facebook Reels avec Musique et Texte

## Context

Ajout d'une fonctionnalité complète de création de Reels Facebook permettant de capturer une vidéo, ajouter une musique libre de droits (Jamendo API), superposer du texte style TikTok, et publier via l'API Graph Facebook. Le traitement vidéo sera effectué via une API FFmpeg Docker locale.

## Current Focus

**Phase: COMPLETED** - Implémentation terminée, prêt pour configuration et tests.

## Master Plan

### Phase 0: Clarifications ✅

- [x] Confirmer source de musique → Jamendo API
- [x] Confirmer URL et format API FFmpeg Docker → `/process-reel`, base64, X-API-Key
- [x] Style texte → TikTok (animation mot par mot)

### Phase 1: Backend Services ✅

- [x] `server/services/ffmpeg.ts` - Intégration API FFmpeg Docker
- [x] `server/services/jamendo.ts` - Service recherche musique Jamendo
- [x] `server/services/facebook.ts` - Méthodes `publishReel()` et `publishReelFromBuffer()`

### Phase 2: Database & Routes ✅

- [x] `shared/schema.ts` - Ajout type "reel" à postTypeEnum
- [x] `server/routes/reels.ts` - Routes API complètes
- [x] `server/routes.ts` - Enregistrement du reelsRouter

### Phase 3: Frontend ✅

- [x] `client/src/pages/new-reel.tsx` - Page création Reel (workflow 4 étapes)
- [x] `client/src/App.tsx` - Route `/reel`
- [x] `client/src/components/sidebar.tsx` - Lien navigation "Nouveau Reel"

### Phase 4: Configuration Requise ⏳

- [ ] Configurer Jamendo Client ID (variable d'environnement)
- [ ] Configurer FFmpeg API URL et clé (variable d'environnement)
- [ ] Ajouter la valeur 'reel' à l'enum post_type en base de données

## Progress Log

- **22 Jan 2026** - Analyse complète de l'application Socialflow effectuée
- **22 Jan 2026** - PRD créé avec architecture proposée  
- **22 Jan 2026** - Spécifications confirmées : Jamendo API, FFmpeg Docker, style TikTok
- **22 Jan 2026** - Backend complet : ffmpeg.ts, jamendo.ts, facebook.ts (publishReel)
- **22 Jan 2026** - Routes API créées dans server/routes/reels.ts
- **22 Jan 2026** - Frontend créé : new-reel.tsx avec workflow 4 étapes
- **22 Jan 2026** - Navigation mise à jour : route et lien sidebar
