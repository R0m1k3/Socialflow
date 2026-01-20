# Task: Socialflow - Analytics & Token Management

## Context

Implementation of a robust Facebook Page Token management system (automatic renewal) and a new Facebook Analytics module (ingestion & dashboard) to improve platform reliability and value.

## Current Focus

Planning and Architecture Definition.

## Master Plan

### Phase 1: Foundation & Data

- [x] Requirements & Architecture Analysis
- [x] **Review Implementation Plan**
- [x] [BACKEND] Update Database Schema (Analytics tables, SocialPages extension)
- [ ] [BACKEND] Run Drizzle Migration (Pending DB connectivity)

### Phase 2: Core Services

- [x] [NEW] `server/services/token_manager.ts` (Encryption + Refresh Logic)
- [x] [NEW] `server/services/analytics.ts` (Graph API Fetch, DB Store)
- [x] [NEW] `server/utils/graph_client.ts` (Typed Graph API Client)
- [x] [MODIFY] `server/routes.ts` - Register analytics routes
- [x] [NEW] `server/cron.ts` - Setup Daily Token Check

### Phase 3: Frontend

- [x] [NEW] `client/src/components/analytics/AnalyticsDashboard.tsx`
- [x] [NEW] `client/src/components/analytics/MetricsCard.tsx`
- [x] [NEW] `client/src/pages/AnalyticsPage.tsx` & Mobile Version
- [x] [MODIFY] `client/src/App.tsx` - Add /analytics route
- [x] [MODIFY] `client/src/components/sidebar.tsx` - Add navigation link

### Phase 4: Verification

- [x] [TEST] Verify implementation builds correctly (`npm run build`)
- [ ] [TEST] Simulate Token Refresh Job
- [ ] [MANUAL] Validate Analytics Data accuracy through UI

## Progress Log

- **20 Jan 2026** - Architecture defined: Service-based approach, Encryption for tokens, Node-cron for scheduling.
- **20 Jan 2026** - **Build Fixed**: Resolved circular dependencies (`db` import) and frontend type errors.
