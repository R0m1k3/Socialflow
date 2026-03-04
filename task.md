# Task: Socialflow - Facebook Reels avec Musique et Texte

## Context

Ajout d'une fonctionnalité complète de création de Reels Facebook permettant de capturer une vidéo, ajouter une musique libre de droits (FreeSound API), superposer du texte style TikTok, et publier via l'API Graph Facebook. Le traitement vidéo sera effectué via une API FFmpeg Docker locale.

## Current Focus

**Phase: EXECUTION** - Conversation libre avec l'Agent BMad Master (Chat with the Agent).

## Master Plan

### Party Mode & Outro (Nouvelle fonctionnalité)

- [x] Créer l'Implementation Plan basé sur la réflexion du Party Mode
- [/] `server/routes/reels.ts` : Passer `storeName` à FFmpeg (le nom de la page).
- [/] `ffmpeg-service/main.py` : Ajouter le scale du logo et `drawtext` du `storeName` centrés.
- [/] Appliquer ces filtres avec un fondu d'entrée correspondant à la durée du fondu de sortie global.

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

### Phase 5: Reels Enhancements ⚡

- [x] **Enable Text Overlay by Default** in `new-reel.tsx`
- [x] **Expand French Voice Options**
  - [x] Research available French voices (Edge-TTS)
  - [x] Update frontend selection list
  - [x] Update backend validation if needed
- [x] **Add Voice Test Button** (Preview TTS)

### Phase 6: Workflow Initialization 🚫

- [~] Run `/bmad-bmgd-workflows-workflow-init` (Annulé: Application, pas un Jeu)

### Phase 7: Amélioration Qualité Vidéo & Stabilisation ✅

- [x] **Amélioration Capture Caméra** (`camera-recorder.tsx`)
  - [x] Augmenter bitrate selon résolution (720p: 12Mbps, 1080p: 25Mbps, 4K: 50Mbps)
  - [x] Ajouter contrainte framerate 30fps
  - [x] Ajouter toggle "Stabilisation serveur" dans réglages
- [x] **Stabilisation FFmpeg vidstab** (`ffmpeg-service/main.py`)
  - [x] Installer vidstab dans le Dockerfile (via static build)
  - [x] Ajouter paramètre `stabilize` au modèle ReelRequest
  - [x] Implémenter stabilisation 2 passes (detect + transform)
  - [x] Améliorer qualité sortie (CRF 18)
- [x] **Backend API** (`ffmpeg.ts`)
  - [x] Passer le paramètre `stabilize` à l'API FFmpeg

### Phase 8: Monitoring & UX ✅

- [x] **Monitoring Performance** (`ffmpeg-service/main.py`)
  - [x] Mesurer et logger les temps de traitement par étape (Download, Stabilize, TTS, Encode)
  - [x] Retourner les métriques dans la réponse API
- [x] **Feedback UI** (`new-reel.tsx`)
  - [x] Ajouter un composant de progression "fake" intelligent pendant la création
  - [x] Afficher les étapes (Upload, Audio, Stabilisation, Encodage)
  - [x] Estimer le temps restant selon les options activées (Stabilisation = +30s)

### Phase 9: Maintenance & Bug Fixes 🛠️

- [x] **Fix API 500** (`server/routes/reels.ts`) : Variable `stabilize` manquante corrigée.
- [x] **Fix iOS Upload** (`client/src/pages/new-reel.tsx`) : Ajout support `.mov` et augmentation limite taille (500MB).
- [ ] **Support Gros Fichiers (4GB)** : Passage à DiskStorage et streaming Cloudinary.
- [x] **Phase 10: Optimisation 1080p & Qualité Maximale** ✅
  - [x] FFmpeg: Forcer scaling 1080x1920 (Vertical HD)
  - [x] FFmpeg: Augmenter CRF à 17 et preset à `slow`
  - [x] FFmpeg: Augmenter taille police par défaut à 64
  - [x] FFmpeg: Positionner texte plus bas (proportionnel 1080p)
  - [x] FFmpeg: Profil H.264 High, 30fps et bitrate 10Mbps
  - [x] Frontend: Ajouter toggle Stabilisation et Qualité
  - [x] Fix: Synchronisation parfaite Texte/Voix (TTS dynamique)
  - [x] Fix: Stabilisation optimisée (Zoom adaptatif + Single Pass)
  - [x] Amélioration: Stabilisation Aggressive (Smoothing 30, Shakiness 10)
  - [x] Fix: Emojis supportés dans le texte (mais ignorés par TTS)
- [x] **Phase 11: Clarification UX Mobile** ✅
  - [x] Modifier l'alerte iOS pour prévenir que les réglages se font après
  - [x] Ajouter une flèche ou une animation pour attirer l'œil sur le Switch de stabilisation
  - [x] S'assurer que le bouton "Suivant" est bien visible sous le Switch
  - [x] Renommer toggle stabilisation pour clarté (Anti-tremblements)
  - [x] Déplacer le toggle en bas de page (UX)
- [x] **Phase 12: Optimisation Safari (Bypass Compression)** ✅
  - [x] Ajouter l'attribut `multiple` à l'input file pour forcer l'envoi du fichier original (Bypass Safari downscaling)
  - [x] Mettre à jour les MIME types pour inclure `video/quicktime` (iPhone natif)
  - [x] Documenter que la stabilisation native dépend des réglages iOS de l'utilisateur
  - [x] **Fix Build Failure** : Correction syntaxe `useDropzone` et JSX dans `new-reel.tsx`.
  - [x] **Fix Mobile Overlay** : Force `drawText: true` sur le client mobile.
  - [x] **Fix Font Issue** : Ajout de `fontconfig`, `fc-cache`, et utilisation de police générique "Sans".
  - [x] **Refactor FFmpeg** : Passage à un pipeline `filter_complex` unifié pour éviter les conflits et garantir l'overlay.
  - [x] **Fix Indentation** : Correction de l'erreur de syntaxe Python introduite.
- [x] **Phase 13: Polissage Final Texte & Emojis** ✅
  - [x] Filtrer les hashtags de l'affichage vidéo (clean_text_for_display)
  - [x] Revenir à `DejaVu Sans` pour garantir l'affichage -> **Solution Finale**: Auto-download `Noto Color Emoji` + Config `Sans` generic.
  - [x] Vérifier la logique de stabilisation (Toggle fonctionnel)
  - [x] **Update**: Suppression totale des emojis de l'affichage (demande utilisateur)
  - [x] **Update**: Augmentation de la taille de police (50 -> 65)
  - [x] **Fix F-String Syntax** : Correction de l'erreur `f-string expression part cannot include a backslash`.
  - [x] **Final Robust Fix** : Switch complet vers le filtre `subtitles` et format `.srt` pour contourner l'absence de `drawtext` dans l'environnement.
  - [x] **Style Adjustment** : Réduction de la taille du texte à 30 pour un rendu plus élégant.

### Phase 14: Synchronisation Parfaite Texte/Voix ⏳

- [x] Récupérer les Word Boundaries via `edge_tts`
- [x] Générer le fichier `.ass` avec des timestamps précis
- [ ] Rebuild Docker et valider la synchronisation sur un Reel de test

### Phase 15: Améliorations UX & Fixes (Mobile TTS, Clean Text, Delete Reel) 🚀

- [x] **Mobile UX**: Activer TTS par défaut sur mobile (`new-reel.tsx`)
- [x] **Fix Text Rendering**: Nettoyer le texte (BOM removal) dans `ffmpeg-service/main.py` pour éviter le carré blanc
- [x] **Feature**: Suppression de Reels
  - [x] Backend: Route `DELETE /api/reels/:id`
  - [x] Storage: Méthode `deleteReel`
  - [x] Frontend: Bouton suppression avec confirmation sur les cartes de Reels

### Phase 16: Queue Management & Dashboard ⏳

- [x] **Backend**: Implement Queue Logic (Single Worker Pattern)
  - [x] Helper `processNextJob()`
  - [x] Modify `POST /api/reels` to queue if busy
  - [x] Trigger next job on completion/failure
- [x] **Frontend**: Queue Visualization
  - [x] Create `QueueStatus` widget
  - [x] Display "En attente (Position X)" in progress component

### Phase 17: Mobile Dashboard Simplification 📱

- [x] **Mobile Dashboard**: Redesign `pages/mobile/dashboard.tsx`
  - [x] Keep `OngoingReels` widget
  - [x] Create Main Action Grid (New Post, Reel, Calendar, Analytics)
  - [x] Create Secondary Menu List
  - [x] Remove `StatsCards` and `RecentPublications` from main view

### Phase 18: Mobile Hub Polish ✨

- [x] **Entry Point**: Verify no forced redirects to `/new`.
- [x] **Hub Design**: Refactor `DashboardMobile` with `Card` components and consistent styling.

### Phase 19: Internal MP3 Management & Logo Overlay 🎵🖼️

- [x] **Database & Routing**
  - [x] Add `AudioTrack` table to schema (`id`, `title`, `url`, `createdAt`)
  - [x] Create API routes for managing audio tracks (Upload, List, Delete)
- [x] **Admin UI**
  - [x] Create an "Assets" or "Resources" admin page
  - [x] Implement MP3 upload functionality
  - [x] Display list of uploaded audio tracks with delete option
- [x] **Reel Creation UI**
  - [x] Replace FreeSound search with a selector/list of internal MP3s
  - [x] Maintain audio preview functionality
- [ ] **FFmpeg Integration**
  - [ ] Pass the appropriate `audio_url` (local/hosted MP3) and `logo_url` (from existing settings/image editor) to the FFmpeg service
  - [ ] Update `ffmpeg-service/main.py` to download/read the logo image
  - [ ] Implement `overlay` filter in the video processing pipeline to scale (max width 150px) and position the logo in the bottom right corner (e.g., `W-w-20:H-h-20`)

### Phase 13: Activation Agent BMad ✅

- [x] Activer l'agent `bmad-master.md`
- [x] Charger la configuration `_bmad/core/config.yaml`
- [x] Afficher le menu de l'agent en français
- [x] Ré-activation de l'agent bmad-master.md (11 Fev 2026)

### Phase 20: Activation BMad Master Agent (Mars 2026) ⏳

- [x] Charger la configuration et le persona
- [x] Saluer l'utilisateur en français et afficher le menu
- [x] Attendre la sélection de l'utilisateur
- [x] Utilisateur a choisi `[CH]` : Discuter avec l'agent de n'importe quel sujet.

### Phase 21: Correction Synchronisation Texte/Audio Reel ⏳

- [x] Diagnostiquer : L'audio TTS a été décalé de 2s (`adelay=2s:all=1` dans FFmpeg), mais le timing des mots dans `.ass` n'a pas été ajusté proportionnellement.
- [x] Modifier `ffmpeg-service/main.py` pour passer le délai au générateur ASS.
- [x] Mettre à jour `generate_ass_from_word_boundaries` pour inclure le délai de 2s dans `start` et `end`.
- [x] Valider que les tags `Dialogue` dans le `.ass` commencent à `T+2.0s`.

## Progress Log

- [x] Activation du mode Party et salutation de l'utilisateur. En attente du sujet de discussion.
- [x] Définition des spécifications pour la gestion interne des MP3 et l'incrustation du logo de l'Éditeur d'image. Fin du Mode Party.

- [x] Analyze `ffmpeg-service/main.py` for text encoding issues <!-- id: 5 -->
- [x] Analyze `server/routes.ts` and `server/storage.ts` for deletion logic <!-- id: 6 -->
- [x] Create `implementation_plan.md` <!-- id: 7 -->
- [x] Implement text cleaning in `ffmpeg-service/main.py` <!-- id: 8 -->
- [x] Add `DELETE /api/reels/:id` route in `server/routes/reels.ts` <!-- id: 9 -->
- [x] Add delete button to `RecentPublications` component <!-- id: 10 -->
- [x] Enable TTS by default on mobile in `new-reel.tsx` <!-- id: 11 -->
- [x] Verify changes <!-- id: 12 -->
- **22 Jan 2026** - Analyse complète et PRD créé
- **22 Jan 2026** - Spécifications confirmées
- **22 Jan 2026** - Backend complet : ffmpeg.ts, freesound.ts, facebook.ts
- **22 Jan 2026** - Frontend créé : new-reel.tsx
- **22 Jan 2026** - Settings FFmpeg ajoutés
- **22 Jan 2026** - Migration Jamendo -> FreeSound effectuée sur demande utilisateur
- **22 Jan 2026** - Correction preview audio et ajout pagination "10 nouvelles musiques"
