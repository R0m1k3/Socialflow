---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - package.json
  - shared/schema.ts
workflowType: 'architecture'
project_name: 'Socialflow'
user_name: 'Michael'
date: '2026-01-20'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
Le système doit évoluer pour intégrer deux modules critiques :

1. **Gestion des Tokens (Critique)** : Un système robuste de renouvellement automatique des tokens Facebook Page est nécessaire pour éviter les interruptions de service (expiration ~60 jours).
2. **Analytics & Recommandations** : Un nouveau sous-système pour ingérer, stocker et analyser les métriques Facebook (Insights API) et fournir des recommandations simples (règles métier).

**Non-Functional Requirements:**

- **Fiabilité** : Le job de renouvellement de token est le point de défaillance unique (SPOF) à sécuriser absolument.
- **Isolation des données** : L'architecture multi-tenant actuelle doit être strictement appliquée aux nouvelles données analytiques.
- **Performance** : Les dashboards doivent rester rapides (<2s) malgré l'historisation croissante des données.

**Scale & Complexity:**

- **Primary domain**: Web App B2B (Social Media Management)
- **Complexity level**: Moyenne (L'authentification OAuth et les APIs tierces ajoutent de la complexité accidentelle).
- **Estimated architectural components**: 3 majeurs (TokenManager, AnalyticsIngestor, RecommendationEngine).

### Technical Constraints & Dependencies

- **Facebook Graph API** : Dépendance forte. Besoin de gérer les rate limits et les erreurs transitoires.
- **Drizzle ORM** : Le schéma doit être étendu pour supporter les nouvelles métriques sans casser l'existant.
- **Architecture existante** : On ne réécrit pas, on étend. Les nouveaux services doivent s'intégrer dans le pattern Service/Controller existant.

### Cross-Cutting Concerns Identified

- **Gestion des erreurs et Retries** : Critique pour les appels API Facebook.
- **Logging & Monitoring** : Essentiel pour savoir si le renouvellement de token a échoué silencieusement.
- **Sécurité des Credentials** : Stockage sécurisé des tokens (chiffrement au repos recommandé par NFRs).

## Starter Template Evaluation (Brownfield Context)

**Project Status:** Brownfield (Existing Codebase)
**Decision:** Keep existing stack. No new starter template needed.

### Existing Architecture Stack

**Primary Technology Domain:** Full-Stack Web Application (Node.js/React)

**Architectural Decisions Already in Place:**

**Language & Runtime:**

- **Runtime:** Node.js
- **Language:** TypeScript (Strict mode)

**Frontend Stack:**

- **Framework:** React 18
- **Build Tool:** Vite
- **Routing:** Wouter (Client-side)
- **State Management:** TanStack Query (React Query)
- **Styling:** Radix UI + Tailwind CSS

**Backend Stack:**

- **Server:** Express.js
- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **Auth:** Passport.js (Session based)

**Infrastructure:**

- **Deployment:** Docker (Containerized)
- **Media Storage:** Cloudinary

**Decision:** The new features (Analytics, Token Automations) will simply extend this existing mature architecture. No migration required.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**

1. **Token Refresh Strategy**: Must be automated and robust (SPOF).
2. **Analytics Schema Design**: Must support efficiently querying historical data.
3. **Job Scheduling**: How to reliable trigger daily tasks in this stack.

**Important Decisions (Shape Architecture):**

1. **Facebook Service Refactoring**: Split monolithic service vs maintain as is.
2. **Recommendation Engine Logic**: Hardcoded heuristics vs External AI.

### Data Architecture

**Schema Extensions (Drizzle ORM):**

- **New Tables**:
  - `postAnalytics`: Stockage des snapshots de métriques (impressions, clicks, etc.) liés à `posts`.
  - `pageAnalyticsHistory`: Snapshots journaliers des followers par page.
- **Modifications**:
  - `socialPages`: Ajout de champs de statut (`tokenStatus`, `lastTokenCheck`).
- **Migration Strategy**: Drizzle Kit (`drizzle-kit push` ou migration files).

### Authentication & Security

**Token Management:**

- **Encryption**: Les tokens sont sensibles.
  - _Décision_: Chiffrement au repos via une utilité `encrypt/decrypt` (AES-256) avant insertion en DB, transparent pour le service applicatif.
- **Refresh Mechanism**:
  - _Décision_: Utilisation d'un endpoint API dédié sécurisé (`/api/cron/refresh-tokens`) appelé par un CRON externe (type GitHub Actions ou service d'hébergement) ou un scheduler in-process (type `node-cron`) si déploiement persistant.
  - _Choix Brownfield_: `node-cron` pour simplicité du déploiement Docker unique actuel.

### API & Communication Patterns

**Facebook Integration:**

- **Service Layer**:
  - Création de `AnalyticsService.ts` séparé de `FacebookService.ts` pour éviter le God Object.
  - Abstraction commune `GraphAPIClient` pour gérer les appels HTTP, rate limits et erreurs.
- **Frontend-Backend**:
  - Nouveau routeur `analytics.routes.ts`.
  - Cache: React Query sur le frontend (staleTime 5min) pour éviter le spam F5 sur les analytics.

### Infrastructure & Deployment

**Job Scheduling (CRON):**

- **Pattern**: In-process scheduling via `node-cron`.
  - _Avantage_: Pas de nouvelle infrastructure requise.
  - _Inconvénient_: Si le serveur redémarre, le job peut sauter un tour (acceptable pour un refresh journalier avec marge de 7 jours).

### Decision Impact Analysis

**Implementation Sequence:**

1. **Schema Update**: Créer les tables Analytics et mettre à jour SocialPages.
2. **Token Manager**: Implémenter le chiffrement et le service de renouvellement.
3. **Cron Job**: Configurer `node-cron` pour le check quotidien.
4. **Analytics Ingestion**: Service pour puller les data de FB vers DB.
5. **Analytics API**: Exposer les données au front.
6. **UI**: Dashboard Analytics.

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:**

- **Naming**: Drizzle (snake_case DB) vs API (camelCase JSON).
- **Service Structure**: Business Logic placement (Controller vs Service).
- **Error Handling**: Silent fails in Cron Jobs vs User Feedback in UI.

### Naming Patterns

**Database Naming Conventions (Drizzle):**

- **Tables**: `snake_case` plural (ex: `post_analytics`)
- **Columns**: `snake_case` (ex: `followers_count`)
- **Foreign Keys**: `snake_case` ending with `_id` (ex: `page_id`)

**API Naming Conventions (REST):**

- **Endpoints**: Kebab-case plural resources (ex: `/api/analytics/posts-insights`)
- **JSON Props**: `camelCase` (ex: `followersCount` - necessitates transformation from DB snake_case)

**Code Naming Conventions:**

- **Services**: `TopicService.ts` containing class `TopicService`
- **Interfaces**: PascalCase, generally not prefixed with 'I' in TS modern patterns (ex: `FacebookInsight`)

### Structure Patterns

**Project Organization:**

- **Services**: `server/services/*.ts` - Business logic enabling re-use.
- **Routes**: `server/routes.ts` - HTTP handlers, params validation, calling services.
- **Schema**: `shared/schema.ts` - Centralized Drizzle schema & Zod types.

### Communication Patterns

**Async Jobs (Cron):**

- **Logging**: All cron jobs MUST log start/finish/error with timestamp.
- **State**: Jobs extending `socialPages` status must update `last_token_check` timestamp.

### Process Patterns

**Error Handling:**

- **External APIs (FB/IG)**:
  - Never crash the server on API failure.
  - Wrap calls in try/catch.
  - Throw typed application errors (`FacebookApiError`) for upstream handling.

**Enforcement Guidelines:**

**All AI Agents MUST:**

1. Use `db.insert(...).returning()` pattern for creations.
2. Use Zod schemas from `shared/schema.ts` for validation.
3. Encrypt sensitive tokens before saving using `encrypt()` utility.

## Project Structure & Boundaries

### Complete Project Directory Structure

```
Socialflow/
├── package.json
├── tsconfig.json
├── server/
│   ├── index.ts                # App entry point
│   ├── routes.ts               # Main router (delegates to sub-routers)
│   ├── services/
│   │   ├── facebook.ts         # Legacy Facebook service
│   │   ├── analytics.ts        # [NEW] Analytics logic (fetch insights)
│   │   ├── token_manager.ts    # [NEW] Token encryption & refresh logic
│   │   └── recommendation.ts   # [NEW] Recommendation engine
│   └── routes/
│       └── analytics.routes.ts # [NEW] Analytics specific endpoints
├── client/src/
│   ├── App.tsx                 # Main frontend component
│   ├── pages/
│   │   ├── Dashboard.tsx       # Existing Dashboard
│   │   └── analytics/          # [NEW] Analytics Section
│   │       └── AnalyticsPage.tsx
│   ├── components/
│   │   ├── analytics/          # [NEW] Shared Analytics Components
│   │   │   ├── StatCard.tsx
│   │   │   ├── FollowersChart.tsx
│   │   │   └── PostsTable.tsx
│   │   └── ui/                 # Existing UI components (Radix)
│   └── lib/
│       ├── api.ts              # API client
│       └── queryClient.ts      # React Query config
├── shared/
│   └── schema.ts               # Drizzle Schema & Zod Types
└── migrations/                 # Drizzle migrations
```

### Architectural Boundaries

**API Boundaries:**

- **Endpoints**: `/api/analytics/*` (Protected by `requireAuth`)
- **Internal Services**: Services communicate securely; `AnalyticsService` calls `FacebookService` only if necessary, prefers direct API calls via `GraphClient`.

**Component Boundaries:**

- **Frontend**: `AnalyticsPage` is the orchestrator. Contains `StatCard`, `Charts`.
- **State**: React Query manages server state (caching insights). Local state for UI filters (date range).

### Requirements to Structure Mapping

**Feature/Epic Mapping:**
**Analytics Module**:

- Backend: `server/services/analytics.ts` + `server/routes/analytics.routes.ts`
- Frontend: `client/src/pages/analytics/`
- Data: `post_analytics`, `page_analytics_history` (in `schema.ts`)

**Token Management Module**:

- Service: `server/services/token_manager.ts`
- Job: `server/jobs/token_refresh_job.ts` (Scheduled via node-cron in `server/index.ts`)
- Data: `social_pages` (extended fields)

### Integration Points

**External Integrations:**

- **Facebook Graph API**: Accessed via `server/utils/graph_client.ts` (to be created for standardized access).
- **Cron System**: `node-cron` initialized in `server/index.ts` triggers `TokenManager.checkAndRefreshTokens()`.

## Architecture Validation Results

### Coherence Validation ✅

- **Pattern Consistency**: The service-based architecture aligns with the existing Express/Drizzle stack.
- **Structure Alignment**: New `analytics.ts` and `token_manager.ts` fit naturally into `server/services`.

### Requirements Coverage Validation ✅

- **Critical (Token Refresh)**: Covered by `TokenManager.checkAndRefreshTokens()` + encryption.
- **Critical (Analytics)**: Covered by new schema + `AnalyticsService`.
- **Security**: Encryption at rest addresses strict NFRs.

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION
**Confidence Level:** High

### Implementation Handoff

**AI Agent Guidelines:**

- Strictly follow `camelCase` for JSON and `snake_case` for DB.
- Use `Zod` schemas for all validation.
- **Do not bypass** the encryption utility for token storage.

**First Implementation Priority:**
Initialize modules: `npx drizzle-kit push` (after schema update) -> `TokenManager` setup.
