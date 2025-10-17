# Social Flow - AI-Powered Social Media Management Platform

## Overview

Social Flow is a comprehensive social media automation platform designed to streamline content creation and publication across Facebook and Instagram. It enables users to manage multiple social media pages, generate AI-powered post content, optimize media for different platform formats, and schedule posts with automated publishing. The platform aims to automate the entire social media content workflow, from creation to publication, utilizing AI for text generation and intelligent media formatting tailored for platform-specific requirements. Key capabilities include multi-photo carousel posts with drag-and-drop reordering, a preview modal for realistic platform rendering, and an integrated media library. The project's ambition is to provide a complete, AI-driven solution for social media content management, significantly reducing manual effort and improving content quality and reach.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

### October 17, 2025
- **Docker Deployment Configuration**: Configured Docker Compose for private server deployment with PostgreSQL and application on same network. Application exposed on port 4523:4523 as requested. PostgreSQL and app communicate via internal Docker network and are both on nginx_default external network for reverse proxy access. Updated Dockerfile to use port 4523. Created comprehensive DOCKER.md documentation with setup instructions, network architecture explanation, and troubleshooting guide.

### October 14, 2025
- **Publication History Error Display Fix**: Fixed bug where publication history incorrectly displayed persistent errors for posts that failed initially but succeeded on retry. Problem: When a post failed, the `error` field was populated, but when the post was successfully republished, only `publishedAt` and `externalPostId` were updated without clearing the `error` field. Solution: Modified `schedulerService.publishPost()` to set `error: null` when publication succeeds, ensuring error messages are cleared from the history view after successful republication.
- **Publishing Permissions Security Fix**: Fixed critical security vulnerability in POST `/api/posts` endpoint where standard users could publish to ANY page without verification. Added permission check that validates non-admin users can only publish to pages in their `user_page_permissions` list via `getUserAccessiblePages()`. Admins bypass this check and retain full access. Returns 403 Forbidden if user attempts to publish to unauthorized pages. This prevents privilege escalation and ensures proper page-level access control.
- **AI Generation Permissions Fix**: Enabled AI text generation for all authenticated users (previously admin-only). Changed `/api/ai/generate` endpoint from `requireAdmin` to `requireAuth` middleware. Added `getAnyOpenrouterConfig()` method in storage layer to retrieve first available OpenRouter config, enabling shared credentials across all users (same pattern as Cloudinary). Updated `OpenRouterService.generatePostText()` to use shared config instead of per-user lookup. Standard users can now generate AI-powered post text using admin's OpenRouter configuration.
- **Cloudinary Upload Permissions Fix**: Fixed critical bug preventing non-admin users from uploading media. Problem: System searched for user-specific Cloudinary config (only admins can configure). Solution: Added `getAnyCloudinaryConfig()` method in storage layer to retrieve first available config, enabling shared Cloudinary credentials across all users. Updated `cloudinaryService.uploadMedia()` and `deleteMedia()` to use shared config internally while maintaining userId for media ownership. Upload and image editor endpoints now verify shared config exists before processing. Standard users can now upload media successfully using admin's Cloudinary configuration.
- **Android Camera Upload Fix**: Fixed critical Android camera capture bug where uploads failed with 400 error. Android devices send captured files with invalid names (empty, 'blob', etc.) that Multer rejects. Solution: `handleCameraCapture` now detects invalid filenames and creates new File object with generated name `camera-${timestamp}.${extension}` while preserving MIME type. Applied to both new-post and media-upload components. iPhone functionality unaffected.
- **Mobile Performance Optimizations**: Implemented comprehensive mobile speed optimizations for "Nouvelle publication" and "Médiathèque" pages. Changes include: (1) Adaptive initial loading - 6 media items on mobile (<768px), 12 on desktop; (2) Optimized thumbnail URLs - replaced `originalUrl` with `facebookFeedUrl` (1080x1080 Cloudinary transformed images) for 70-90% reduction in data transfer while keeping `originalUrl` for zoom/preview quality; (3) Native lazy loading - added `loading="lazy"` attribute to all `<img>` tags for deferred off-screen image loading; (4) Responsive grid layout - 2 columns on mobile, 3 on desktop (sm:grid-cols-3) for better touch targets. Expected impact: Initial load time reduced from 3-5s to <1s on mobile devices.
- **Camera Capture in Media Library**: Added camera button 📷 to MediaUpload component, mirroring functionality from new-post page. Mobile users (lg:hidden) can now capture photos/videos directly from device camera and auto-upload to media library. Implementation includes hidden file input with `capture="environment"`, `handleCameraCapture` handler with input value reset (`e.target.value = ''`) to enable repeated captures, and integration with existing `uploadMutation` for seamless cloud storage.
- **Video Publishing for Facebook**: Implemented complete video support for Facebook feed and stories. Added `publishVideoPost()` method using `/videos` endpoint with `file_url` parameter for feed videos, and `publishVideoStory()` using `/video_stories` endpoint for story videos. Modified `publishStory()` to detect video media type and route to appropriate handler. Updated `publishPost()` logic to separate image vs video media filtering and use correct publishing methods. Video preview now uses `<video>` tags with controls in PreviewModal via `renderMedia()` helper function.

## System Architecture

### Frontend Architecture

The frontend is built with **React** and **TypeScript**, using **Vite** for bundling. **Wouter** handles client-side routing. State management primarily uses **TanStack Query (React Query)** for server state and caching. UI components are built with **Radix UI primitives** and **shadcn/ui**, styled with **Tailwind CSS**. The design emphasizes a component-based structure, responsive design with a mobile-first approach, and real-time data synchronization. Dark mode is the default theme.

### Backend Architecture

The backend runs on **Node.js** with **Express.js**, fully implemented in **TypeScript**. It follows a **RESTful API design** with clear endpoints for authentication, user management, AI content generation, media handling, social page management, and post scheduling. **Multer** is used for file uploads, integrating with Cloudinary. **Node-cron** handles background processing for scheduled post publication. Architectural patterns include a service layer, storage abstraction, and a middleware-based request processing pipeline. Session management is handled by `express-session` with `connect-pg-simple` for production.

### Database Architecture

**PostgreSQL** is the chosen database, utilizing **Drizzle ORM** for type-safe operations and **Neon serverless driver** for WebSocket support. The schema includes core tables for `users`, `cloudinary_config`, `social_pages`, `media`, `posts`, `post_media`, `scheduled_posts`, and `ai_generations`. **Drizzle Kit** manages schema migrations.

### Media Processing Pipeline

The platform leverages **Cloudinary** for cloud-based image and video storage and transformation. Original files are uploaded to Cloudinary. For publishing to Facebook/Instagram, the **original image URL** is used, allowing platforms to handle cropping and formatting. Cloudinary generates transformation URLs (e.g., 1200x630px landscape, 1080x1080px square, 1080x1920px vertical) exclusively for UI preview purposes.

### Authentication & Authorization

Authentication uses **Passport.js** with local strategy and `bcrypt` for password hashing. User roles (`admin`, `user`) control access, with `admin` having full access to configuration settings (Cloudinary, OpenRouter, user management) and `user` limited to publishing features. **AI text generation is available to all authenticated users** using shared admin OpenRouter configuration. Session management is via `express-session` with HTTP-only cookies and a 7-day duration. Routes are protected on both the backend (middleware `requireAuth`, `requireAdmin`) and frontend (`ProtectedRoute` component).

### UI/UX Decisions

The UI is built with **Radix UI** and **shadcn/ui**, leveraging **Tailwind CSS**. Key design decisions include a component-based architecture, custom path aliases, and a responsive, mobile-first approach. The platform supports multi-photo carousel posts with drag-and-drop reordering, and a **PreviewModal** offers realistic rendering of posts across Facebook and Instagram formats. The calendar view is responsive, with a grid for desktop and an expandable list for mobile, allowing editing and deletion of scheduled posts. Infinite scroll is implemented in the media library and new post pages for performance, using IntersectionObserver.

## External Dependencies

### AI Content Generation

- **OpenRouter API**: Used for AI text generation, specifically with Anthropic Claude 3.5 Sonnet, to create multiple post text variations.

### Cloud Storage

- **Cloudinary**: Provides cloud-based image and video storage, automatic transformations for platform-specific formats, and a global CDN.

### Social Media APIs

- **Facebook Graph API**: Fully implemented for publishing posts to Facebook pages, including multi-photo carousel support.
- **Instagram Graph API**: Partially implemented for single photo/video posts.

### Database Service

- **Neon Serverless PostgreSQL**: The primary database service, utilizing a WebSocket-based connection pooling and the `@neondatabase/serverless` driver.

### UI Component Libraries

- **Radix UI**: Accessible UI primitives.
- **React Hook Form**: Form state management with validation.
- **Zod**: Schema validation.
- **date-fns**: Date manipulation.
- **react-dropzone**: Drag-and-drop file uploads.
- **Lucide React**: Icon library.
- **@dnd-kit**: Drag and drop functionality for photo carousel reordering.