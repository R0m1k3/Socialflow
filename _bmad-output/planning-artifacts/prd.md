---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
inputDocuments:
  - package.json (stack technique)
  - shared/schema.ts (modèle de données)
  - server/services/facebook.ts (service Facebook existant)
workflowType: 'prd'
lastStep: 11
scope: 'Dashboard Analytics Facebook (Recommandations) + Gestion Tokens Automatique'
projectType: 'brownfield'
documentCounts:
  briefs: 0
  research: 0
  projectDocs: 3
---

# Product Requirements Document - Socialflow

**Author:** Michael
**Date:** 2026-01-20

---

## Executive Summary

**Socialflow** est une application de gestion de réseaux sociaux permettant de publier du contenu sur Facebook (Feed et Stories) avec génération de texte par IA, planification, et gestion multi-utilisateurs.

Ce PRD définit **deux évolutions majeures** pour étendre les capacités de la plateforme :

### 1. Dashboard Analytics Facebook

Tableau de bord complet présentant les performances des publications avec :

- **Métriques clés** : Followers, Reach, Engagement, Clics
- **Historisation des données** : Suivi de l'évolution dans le temps
- **Analyse intelligente** : Recommandations IA sur les meilleurs types de posts, justifiées par les données collectées
- **Vue par page** : Statistiques globales agrégées par page Facebook

### 2. Support Instagram

Extension de Socialflow pour publier sur Instagram depuis la même interface :

- **Récupération du token Instagram** : Déblocage de l'accès API via Instagram Graph API
- **Types de contenu** : Feed (photos/vidéos), Stories, Reels
- **Vision unifiée** : Gérer Facebook et Instagram depuis un seul endroit

### What Makes This Special

**La valeur différenciante de ces évolutions :**

1. **Data-Driven Insights** : Les recommandations IA ne sont pas des suppositions - elles sont **justifiées par les données réelles** de performance (likes, commentaires, reach).

2. **Le moment "Aha!"** : Voir en un coup d'œil les **réactions sur chaque post** (likes, commentaires) et comprendre ce qui fonctionne.

3. **Vision Unifiée** : Une seule plateforme pour gérer **Facebook ET Instagram** - plus besoin de jongler entre plusieurs outils.

---

## Project Classification

| Critère | Valeur |
|---------|--------|
| **Technical Type** | `web_app` + `saas_b2b` |
| **Domain** | Social Media Management |
| **Complexity** | Moyenne |
| **Project Context** | Brownfield - extension du système existant |

### Implications techniques

- **APIs externes** : Facebook Graph API (Insights) + Instagram Graph API
- **Stockage** : Nouvelles tables pour historiser les métriques
- **IA** : Réutilisation possible d'OpenRouter pour les recommandations
- **Architecture** : Extension des services existants, pas de refonte

---

## Success Criteria

### User Success

| Critère | Description |
|---------|-------------|
| **Lisibilité** | Dashboard facile à lire avec les informations importantes clairement visibles |
| **Informations actionnables** | L'utilisateur comprend immédiatement comment améliorer ses publications |
| **Publication unifiée** | Publier sur Instagram ET Facebook en un seul clic |
| **Gain de temps perçu** | L'utilisateur ressent que l'application lui fait gagner du temps |

**Aha! Moments :**

- Découvrir quel type de post fonctionne le mieux grâce aux insights
- Réussir sa première publication simultanée Facebook + Instagram

### Business Success

| Horizon | Objectif |
|---------|----------|
| **3 mois** | Fonctionnalités déployées et utilisées (metrics à définir post-lancement) |
| **Métrique clé** | Nombre de posts publiés (indicateur d'adoption) |

### Technical Success

| Critère | Cible |
|---------|-------|
| **Intégration Facebook Insights** | API fonctionnelle, données récupérées correctement |
| **Intégration Instagram Graph API** | Token récupéré, publications Feed/Stories/Reels opérationnelles |
| **Historisation** | Données stockées et requêtables pour analyse |
| **Performance** | Dashboard charge en < 3 secondes |

### Measurable Outcomes

- ✅ Les utilisateurs peuvent voir les stats de leurs posts (likes, commentaires, reach)
- ✅ Les recommandations IA sont basées sur des données réelles
- ✅ Publication Instagram fonctionne (Feed, Stories, Reels)
- ✅ Vision unifiée : une seule interface pour gérer les deux plateformes

---

## Product Scope

### MVP - Minimum Viable Product

**Dashboard Analytics :**

- Affichage des métriques par page (followers, reach, engagement)
- Historique des performances sur 30 jours
- Liste des posts avec leurs réactions (likes, commentaires)

**Instagram :**

- Récupération automatique du token Instagram Business
- Publication sur le Feed Instagram (photos/vidéos)
- Publication de Stories Instagram

### Growth Features (Post-MVP)

- Recommandations IA ("Vos photos fonctionnent mieux le mardi")
- Comparaison de performance entre posts
- Publication de Reels Instagram
- Analytics Instagram (en plus de Facebook)

### Vision (Future)

- Rapport PDF automatique des performances
- Suggestions automatiques de contenu basées sur les tendances
- Support d'autres plateformes (TikTok, LinkedIn, X)
- Planification intelligente basée sur les meilleurs horaires

---

## User Journeys

### Journey 1 : Sophie Durand - La Community Manager Débordée

**Profil :** Sophie, 28 ans, community manager dans une agence web. Elle gère les réseaux sociaux de 5 clients différents.

**Sa douleur :** Sophie passe ses lundis matin à compiler des rapports Excel pour chaque client, copiant manuellement les statistiques depuis Facebook. Elle doit ensuite publier le même contenu sur Facebook ET Instagram séparément, ce qui double son temps de travail. "Je fais plus de copier-coller que de créatif", soupire-t-elle.

**Son parcours avec Socialflow :**

Un mardi matin, Sophie ouvre Socialflow pour préparer les publications de la semaine. Elle clique sur le nouveau **Dashboard Analytics** et découvre immédiatement que les posts photos de son client "Boulangerie Martin" génèrent 3x plus d'engagement que les posts texte.

Elle décide de créer un nouveau post avec une belle photo de croissants. En quelques clics, elle rédige le texte, sélectionne l'image, puis aperçoit une **nouvelle option** : publier sur **Facebook ET Instagram** simultanément. Un seul clic, et le post est programmé sur les deux plateformes.

**Le moment de victoire :** Le vendredi, Sophie génère son rapport client en 2 minutes au lieu de 30. Les graphiques montrent clairement l'évolution des followers et l'engagement. Son client est impressionné par la clarté des données. Sophie rentre chez elle à 18h au lieu de 20h.

**Capabilities révélées :**

- Dashboard Analytics avec vue par page
- Historique des performances
- Publication multi-plateforme (FB + IG) en un clic
- Visualisation claire des types de posts performants

---

### Journey 2 : Marc Lefebvre - Le Gérant de Commerce Local

**Profil :** Marc, 45 ans, propriétaire d'une boutique de vélos. Il gère lui-même sa page Facebook mais n'a jamais osé Instagram.

**Sa douleur :** Marc publie "quand il y pense" sur Facebook, sans vraie stratégie. Il ne sait pas ce qui fonctionne. Instagram lui fait peur : "C'est pour les jeunes, je ne sais pas comment ça marche."

**Son parcours avec Socialflow :**

Marc se connecte à Socialflow un dimanche soir tranquille. Il découvre le **Dashboard** et voit que ses photos de vélos restaurés ont beaucoup plus de likes que ses posts promotionnels. "Ah, les gens aiment voir mon travail !"

Encouragé, il décide de poster une photo de sa dernière restauration. Socialflow lui propose de publier aussi sur Instagram. Hésitant, il clique sur "Connecter Instagram". Le système détecte automatiquement son compte Instagram professionnel lié à sa page Facebook. **En 30 secondes, c'est configuré.**

Il publie sa photo sur les deux plateformes. Le lendemain, il reçoit 3 messages de clients potentiels via Instagram - des gens qui ne l'auraient jamais trouvé sur Facebook.

**Le moment de victoire :** Marc regarde ses stats un mois plus tard. +150 followers Instagram, +40% d'engagement sur ses posts "restauration". Il comprend maintenant que montrer son expertise attire plus de clients que les promotions.

**Capabilities révélées :**

- Configuration Instagram simplifiée (auto-détection du compte lié)
- Insights sur les types de contenus performants
- Publication simultanée pour les non-technophiles
- Suivi de l'évolution des followers

---

### Journey 3 : Admin Système - Configuration Multi-Utilisateurs

**Profil :** Thomas, administrateur Socialflow dans l'agence de Sophie.

**Sa douleur :** Gérer les accès de 10 community managers à 30 pages clients différentes, sans qu'ils voient les données des autres clients.

**Son parcours avec Socialflow :**

Thomas reçoit une demande : "Sophie doit maintenant gérer le client Instagram BioMarché." Il se connecte en admin, va dans les paramètres utilisateurs, et assigne la page BioMarché (Facebook + Instagram) à Sophie.

Sophie voit immédiatement la nouvelle page dans son dashboard, avec l'analytics et la possibilité de publier. Elle n'a accès qu'aux pages qui lui sont assignées.

Quand un stagiaire quitte l'agence, Thomas retire ses accès en 2 clics. Sécurité maintenue.

**Capabilities révélées :**

- Gestion des permissions par utilisateur
- Assignation de pages (FB + IG) aux utilisateurs
- Isolation des données entre utilisateurs
- Révocation rapide des accès

---

### Journey 4 : Erreur et Récupération - Token Instagram Expiré

**Profil :** Sophie, 3 mois après avoir connecté Instagram.

**Sa douleur :** Son post Instagram échoue avec l'erreur "Token expiré".

**Son parcours :**

Sophie tente de publier sur Instagram mais voit un message d'erreur clair : "🔴 La connexion Instagram a expiré. Reconnectez en 1 clic."

Elle clique sur "Reconnecter", est redirigée vers Facebook pour réautoriser, et revient sur Socialflow. Le système confirme : "✅ Instagram reconnecté". Elle relance sa publication qui passe sans problème.

**Le moment de soulagement :** Pas besoin d'appeler le support. L'erreur était claire, la solution évidente.

**Capabilities révélées :**

- Messages d'erreur explicites et actionnables
- Reconnexion OAuth simplifiée
- Gestion gracieuse des tokens expirés

---

### Journey Requirements Summary

| Capability | Journeys |
|------------|----------|
| Dashboard Analytics | Sophie, Marc |
| Publication multi-plateforme | (Reporté en Phase 2) |
| Configuration Instagram auto | (Reporté en Phase 2) |
| Insights & Recommandations FB | Sophie |
| Gestion permissions | Admin |
| Gestion erreurs token | Erreur/Récupération |
| Historique followers | Sophie |

---

## Web App + SaaS B2B Specific Requirements

### Project-Type Overview

Socialflow est une **application web SPA (Single Page Application)** construite avec React et Vite, exposant une API REST Express.js. L'architecture existante est maintenue pour les nouvelles fonctionnalités.

**Caractéristiques confirmées :**

- ✅ SPA React conservée
- ✅ Pas de temps réel requis (polling acceptable pour les stats)
- ✅ Multi-tenant existant suffisant
- ✅ Intégrations limitées à Facebook/Instagram/Cloudinary/OpenRouter

### Technical Architecture Considerations

#### Frontend (Existant - Extension)

| Aspect | Spécification |
|--------|---------------|
| Framework | React 18 avec Vite |
| Routing | Wouter (client-side) |
| State | TanStack Query (React Query) |
| UI | Radix UI + Tailwind CSS |
| Charts | Recharts (pour le dashboard analytics) |

**Nouvelles pages à créer :**

- `/analytics` - Dashboard des statistiques
- Extension de `/settings` - Configuration Instagram

#### Backend (Existant - Extension)

| Aspect | Spécification |
|--------|---------------|
| Runtime | Node.js avec Express |
| ORM | Drizzle ORM |
| Base de données | PostgreSQL |
| Auth | Passport.js (sessions) |
| Déploiement | Docker |

**Nouveaux services à créer :**

- `AnalyticsService` - Récupération des insights Facebook
- `InstagramService` - Publication sur Instagram via Graph API

#### Nouvelles Tables de Données

```sql
-- Statistiques par post
CREATE TABLE post_analytics (
  id UUID PRIMARY KEY,
  post_id UUID REFERENCES posts(id),
  impressions INTEGER,
  reach INTEGER,
  engagement INTEGER,
  reactions_count INTEGER,
  comments_count INTEGER,
  clicks INTEGER,
  fetched_at TIMESTAMP
);

-- Historique followers par page
CREATE TABLE page_analytics_history (
  id UUID PRIMARY KEY,
  page_id UUID REFERENCES social_pages(id),
  followers_count INTEGER,
  recorded_at TIMESTAMP
);

-- Comptes Instagram liés
CREATE TABLE instagram_accounts (
  id UUID PRIMARY KEY,
  page_id UUID REFERENCES social_pages(id),
  instagram_business_id TEXT,
  access_token TEXT,
  token_expires_at TIMESTAMP
);
```

### API Integration Requirements

#### Facebook Graph API - Insights

| Endpoint | Données récupérées |
|----------|-------------------|
| `/{page-id}?fields=followers_count` | Nombre de followers |
| `/{post-id}/insights` | Impressions, reach, engagement |
| `/{post-id}/reactions` | Nombre de réactions par type |
| `/{post-id}/comments` | Nombre de commentaires |

**Permissions requises :** `pages_read_engagement`, `read_insights`

#### Instagram Graph API

| Endpoint | Action |
|----------|--------|
| `/{page-id}?fields=instagram_business_account` | Récupérer l'ID Instagram lié |
| `/{ig-id}/media` | Créer un post (step 1) |
| `/{ig-id}/media_publish` | Publier le post (step 2) |
| `/{ig-id}/stories` | Publier une story |

**Permissions requises :** `instagram_basic`, `instagram_content_publish`

### Implementation Considerations

#### Priorité d'implémentation

1. **Phase 1 - Instagram Token** : Récupération automatique de l'Instagram Business Account ID
2. **Phase 2 - Publication Instagram** : Feed et Stories
3. **Phase 3 - Analytics Facebook** : Dashboard avec métriques
4. **Phase 4 - Historisation** : Stockage et graphiques d'évolution

#### Points d'attention

- **Rate Limits** : Facebook impose des limites d'appels API (à monitorer)
- **Token Refresh** : Les tokens expirent, prévoir le renouvellement automatique
- **Rétrocompatibilité** : Les nouvelles features ne doivent pas casser l'existant

---

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**Approche choisie :** Problem-Solving MVP

- Résoudre le problème core avec le minimum de features
- Focus sur la valeur utilisateur immédiate
- Itérer rapidement basé sur le feedback

**Timeline :** Flexible (estimation 4-6 semaines)

**Équipe requise :** 1 développeur full-stack

### MVP Feature Set (Phase 1)

**Philosophie :** Focus total sur la fiabilité (Tokens) et la valeur ajoutée (Analytics + Recommandations). La publication Instagram est reportée.

#### Module 1 : Gestion des Tokens (Fondation Critique)

| Feature | Priorité | Effort |
|---------|----------|--------|
| Récupération & Stockage Token Facebook | 🔥 Critique | 2h |
| **Renouvellement automatique Token Facebook** | 🔥 Critique | 4h |
| Détection expiration & UI reconnexion | 🔥 Critique | 3h |
| Notification email "Token Expiré" | ⭐ Important | 2h |

> ⚠️ **Point critique** : Les tokens Facebook Page expirent (~60 jours). L'automatisation du renouvellement est la clé de la fiabilité.

#### Module 2 : Dashboard Analytics & Recommandations

| Feature | Priorité | Effort |
|---------|----------|--------|
| Récupération métriques posts (API Insights) | 🔥 Critique | 4h |
| Affichage KPIs globaux (Reach, Engagement) | 🔥 Critique | 3h |
| Historisation quotidienne des Followers | ⭐ Important | 3h |
| **Moteur de Recommandations (Basique)** | 🔥 Critique | 4h |
| *Ex: "Publiez des Vidéos le Mardi"* | | |

> **Note sur les Recommandations** : Analyse simple basée sur l'historique (ex: Top 3 formats, Top 3 horaires).

### Post-MVP Features (Phase 2)

| Feature | Description |
|---------|-------------|
| **Support Complet Instagram** | Publication Feed/Stories & Analytics |
| Publication multi-plateforme | Unification FB + IG |
| Recommandations IA avancées | Analyse sémantique du contenu |
| Rapport PDF | Export automatique |

### Phase 3 (Vision Future)

- Support TikTok, LinkedIn
- Planification intelligente auto
- Multi-comptes à grande échelle

### Risk Mitigation Strategy

#### Risques Techniques

| Risque | Impact | Mitigation |
|--------|--------|------------|
| Token expiration non détectée | 🔴 Haut | CRON job de vérification quotidien + alertes |
| Rate limits Facebook/Instagram | 🟡 Moyen | Cache des données, throttling des requêtes |
| API Instagram change | 🟡 Moyen | Abstraction du service, logs détaillés |

#### Risques Fonctionnels

| Risque | Impact | Mitigation |
|--------|--------|------------|
| Instagram non lié à la page FB | 🔴 Haut | Message clair + guide de configuration |
| Permissions insuffisantes | 🟡 Moyen | Vérification des permissions au login |

### Token Renewal Strategy (Critique)

**Workflow de renouvellement automatique :**

1. **CRON Job quotidien** (3h du matin)
2. Pour chaque page stockée :
   - Vérifier `token_expires_at`
   - Si expiration < 7 jours → renouveler via `/oauth/access_token?grant_type=fb_exchange_token`
   - Mettre à jour le token en base
3. Si renouvellement échoue :
   - Marquer la page comme `token_expired`
   - Afficher alerte dans l'UI

---

## Functional Requirements

### Gestion des Tokens & Authentification

- **FR1** : Le système peut stocker de manière sécurisée les tokens d'accès Facebook Page
- **FR2** : Le système peut renouveler automatiquement les tokens Facebook avant leur expiration (CRON)
- **FR3** : Le système peut détecter quand un token Facebook est devenu invalide
- **FR4** : L'utilisateur est notifié (UI/Email) lorsqu'une reconnexion manuelle Facebook est requise

### Dashboard Analytics & Recommandations

- **FR5** : L'utilisateur peut voir les KPIs globaux de sa page (Followers, Reach hebdo, Engagement)
- **FR6** : L'utilisateur peut voir l'historique d'évolution des followers
- **FR7** : L'utilisateur peut voir la liste des posts avec leurs performances individuelles
- **FR8** : Le système analyse les posts passés pour recommander le **meilleur format** (Vidéo vs Image)
- **FR9** : Le système analyse les posts passés pour recommander le **meilleur jour/heure** (basé sur l'engagement)
- **FR10** : Le système offre des insights textuels simples (ex: "Vos vidéos génèrent 2x plus d'engagement")

### Gestion des Pages

- **FR19** : L'administrateur peut assigner des pages (Facebook + Instagram) à des utilisateurs
- **FR20** : L'utilisateur peut voir uniquement les pages qui lui sont assignées
- **FR21** : L'administrateur peut révoquer l'accès d'un utilisateur à une page
- **FR22** : Le système peut afficher le statut de connexion de chaque page (connectée, token expiré, erreur)

### Publication Facebook (Existant - Confirmation)

- **FR23** : L'utilisateur peut publier du contenu texte sur Facebook
- **FR24** : L'utilisateur peut publier des photos sur le feed Facebook
- **FR25** : L'utilisateur peut publier des vidéos sur le feed Facebook
- **FR26** : L'utilisateur peut publier des stories Facebook
- **FR27** : L'utilisateur peut programmer des publications Facebook

### Gestion des Médias (Existant - Confirmation)

- **FR28** : L'utilisateur peut uploader des médias (images/vidéos) via Cloudinary
- **FR29** : L'utilisateur peut sélectionner des médias depuis la bibliothèque pour les publications
- **FR30** : L'utilisateur peut éditer des images avant publication

---

## Non-Functional Requirements

### Security & Data Protection

- **NFR1 (Token Storage)** : Les tokens d'accès (Facebook/Instagram) doivent être chiffrés au repos dans la base de données.
- **NFR2 (Data Isolation)** : Un utilisateur ne doit jamais pouvoir accéder aux données analytiques d'une page qui ne lui est pas assignée, même via manipulation d'API.
- **NFR3 (Least Privilege)** : L'application ne doit demander que les permissions Facebook/Instagram strictement nécessaires (`pages_read_engagement`, `read_insights`, `instagram_content_publish`).

### Performance & Responsiveness

- **NFR4 (Dashboard Load)** : Le dashboard analytics doit s'afficher en moins de 2 secondes pour une page avec < 1 an d'historique.
- **NFR5 (Async Processing)** : Les opérations longues (publication vidéo, récupération historique massif) doivent être traitées de manière asynchrone sans bloquer l'UI.
- **NFR6 (Feedback)** : L'interface doit fournir un feedback visuel immédiat (< 200ms) lors d'une action utilisateur (ex: clic sur "Publier").

### Reliability & Availability

- **NFR7 (Token Monitor)** : Le processus de vérification des tokens doit s'exécuter quotidiennement avec un taux de succès > 99.9%.
- **NFR8 (Error Recovery)** : En cas d'échec d'un appel API Facebook/Instagram (ex: timeout), le système doit réessayer automatiquement jusqu'à 3 fois avant d'échouer.
- **NFR9 (Data Consistency)** : Les statistiques affichées doivent être synchronisées avec la source (Facebook) au moins une fois toutes les 24h.

### API & Integration Constraints

- **NFR10 (Rate Limiting)** : Le système doit respecter les quotas d'appels des APIs Graph API et gérer les headers `X-Page-Usage` pour éviter le blocage.
- **NFR11 (Deprecation)** : Le code doit utiliser les versions d'API Facebook supportées au moins pour les 12 prochains mois.
