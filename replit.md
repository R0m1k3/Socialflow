# Social Flow - AI-Powered Social Media Management Platform

## Overview

Social Flow is a comprehensive social media automation platform designed to streamline content creation and publication across Facebook and Instagram. It enables users to manage multiple social media pages, generate AI-powered post content, process and optimize media for different platform formats, and schedule posts with automated publishing. The platform aims to automate the entire social media content workflow, from creation to publication, utilizing AI for text generation and intelligent media formatting tailored for platform-specific requirements. Key capabilities include multi-photo carousel posts with drag-and-drop reordering, a preview modal for realistic platform rendering, and an integrated media library.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

### October 9, 2025
- **AI Variants Position**: Repositioned AI-generated text variations to display after "Contenu" card and before "Texte de la publication" card in new-post page for better workflow
- **Calendar Auto-Refresh**: Fixed calendar not updating after creating a new scheduled post. Added `queryClient.invalidateQueries` with `refetchType: 'all'` in `createPostMutation.onSuccess` to force cache invalidation and immediate refetch
- **Dashboard Scheduled Posts Count**: Fixed scheduled posts count showing 0 in dashboard. Problem was that posts with `scheduledFor` were created with status "draft" instead of "scheduled". Solution: POST /api/posts now sets `status = "scheduled"` when `scheduledFor` is provided. Legacy posts updated with SQL: `UPDATE posts SET status = 'scheduled' WHERE scheduled_for IS NOT NULL AND status = 'draft'`

## System Architecture

### Frontend Architecture

The frontend is built with **React** and **TypeScript**, using **Vite** for bundling. **Wouter** handles client-side routing, including protected routes. State management primarily uses **TanStack Query (React Query)** for server state and caching. UI components are built with **Radix UI primitives** and **shadcn/ui** (New York style), styled with **Tailwind CSS**. The design emphasizes a component-based structure, custom path aliases, responsive design with a mobile-first approach, and real-time data synchronization. Dark mode is the default theme.

### Backend Architecture

The backend runs on **Node.js** with **Express.js**, fully implemented in **TypeScript**. It follows a **RESTful API design** with clear endpoints for authentication, user management, AI content generation, media handling, social page management, and post scheduling. **Multer** is used for file uploads, integrating with Cloudinary for cloud storage. **Node-cron** handles background processing for scheduled post publication. Architectural patterns include a service layer (e.g., OpenRouterService, CloudinaryService), storage abstraction, and a middleware-based request processing pipeline. Session management is handled by `express-session`, using `MemoryStore` for development and `connect-pg-simple` with PostgreSQL for production.

### Database Architecture

**PostgreSQL** is the chosen database, utilizing **Drizzle ORM** for type-safe operations and **Neon serverless driver** for WebSocket support. The schema includes core tables for `users`, `cloudinary_config`, `social_pages`, `media`, `posts`, `post_media` (for multi-photo carousels with display order), `scheduled_posts`, and `ai_generations`. Enumerations define `platform`, `post_type`, `post_status`, and `media_type`. Relationships are defined with foreign key cascading deletes for data integrity. **Drizzle Kit** manages schema migrations.

### Media Processing Pipeline

The platform leverages **Cloudinary** for cloud-based image and video storage and transformation. Original files are uploaded to Cloudinary and stored in the database.

**Publishing Strategy**: All publications to Facebook/Instagram use the **original image URL** - the platforms handle cropping and formatting automatically based on the post type (feed/story/carousel).

**Transformations for Preview Only**: Cloudinary generates transformation URLs for UI preview purposes only:
- **Facebook Landscape**: 1200x630px with intelligent center crop (`crop: fill`) - landscape format
- **Facebook Feed / Instagram Feed**: 1080x1080px with intelligent center crop (`crop: fill`) - square format
- **Instagram Story**: 1080x1920px with padding (`crop: pad`) - vertical format

These transformation URLs are stored in the database (`facebookLandscapeUrl`, `facebookFeedUrl`, `instagramFeedUrl`, `instagramStoryUrl`) and displayed in the media library for visual preview, but are NOT used when publishing to social media platforms.

### Authentication & Authorization

Authentication uses **Passport.js** with local strategy and `bcrypt` for password hashing. User roles (`admin`, `user`) control access, with `admin` having full access and `user` limited to publishing features. Session management is via `express-session` with HTTP-only cookies, `sameSite: 'lax'`, and a 7-day duration, secured by a `SESSION_SECRET` environment variable. Routes are protected on both the backend (middleware `requireAuth`, `requireAdmin`) and frontend (`ProtectedRoute` component).

### UI/UX Decisions

The UI is built with **Radix UI** and **shadcn/ui**, leveraging **Tailwind CSS** for styling. The default theme is dark mode. Key design decisions include a component-based architecture for reusability, custom path aliases, and a responsive, mobile-first approach. The platform supports multi-photo carousel posts with drag-and-drop reordering, and a **PreviewModal** offers realistic rendering of posts across Facebook and Instagram formats before publishing. The calendar view is responsive, with a grid layout for desktop and an expandable list view for mobile, allowing editing and deletion of scheduled posts directly from the calendar.

**Infinite Scroll**: Both the media library and new post pages implement infinite scroll using IntersectionObserver for performance optimization:
- **Media Library**: Loads 5 media items initially, then 5 more when scrolling to bottom (max height: 500px)
- **New Post Page**: Loads 12 media items initially in a 3-column grid, then 12 more when scrolling (max height: 500px)
- Visual loading indicator ("Chargement..." with spinner) appears when more content is available
- Proper cleanup to prevent memory leaks

## External Dependencies

### AI Content Generation

- **OpenRouter API**: Used for AI text generation, specifically with Anthropic Claude 3.5 Sonnet, to create multiple post text variations. Requires `OPENROUTER_API_KEY`.

### Cloud Storage

- **Cloudinary**: Provides cloud-based image and video storage, automatic transformations for platform-specific formats, and a global CDN. User-configurable via settings.

### Social Media APIs

- **Facebook Graph API**: Fully implemented for publishing posts to Facebook pages, including multi-photo carousel support (up to 10 photos). Uses a 2-step process: (1) Upload photos as unpublished via POST /{page-id}/photos with published=false to get photo IDs, (2) Create feed post via POST /{page-id}/feed with attached_media parameter containing photo IDs in order.
- **Instagram Graph API**: Partially implemented. Single photo/video posts work. Carousel posts require a 3-step process (not yet implemented): (1) Create individual media containers with is_carousel_item=true, (2) Create carousel container with media_type=CAROUSEL, (3) Publish the carousel container.

### Database Service

- **Neon Serverless PostgreSQL**: The primary database service, utilizing a WebSocket-based connection pooling and the `@neondatabase/serverless` driver. Connection string via `DATABASE_URL`.

### UI Component Libraries

- **Radix UI**: Accessible UI primitives.
- **React Hook Form**: Form state management with validation.
- **Zod**: Schema validation.
- **date-fns**: Date manipulation.
- **react-dropzone**: Drag-and-drop file uploads.
- **Lucide React**: Icon library.
- **@dnd-kit**: Drag and drop functionality for photo carousel reordering.