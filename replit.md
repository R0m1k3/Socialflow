# Social Flow - AI-Powered Social Media Management Platform

## Overview

Social Flow is a comprehensive AI-powered social media automation platform designed to streamline content creation and publication across Facebook and Instagram. It enables users to manage multiple social media pages, generate AI-powered post content, optimize media for different platform formats, and schedule posts with automated publishing. The platform's ambition is to provide a complete, AI-driven solution for social media content management, significantly reducing manual effort and improving content quality and reach. Key capabilities include multi-photo carousel posts with drag-and-drop reordering, a preview modal for realistic platform rendering, and an integrated media library.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The frontend is built with React and TypeScript, using Vite for bundling and Wouter for routing. State management primarily uses TanStack Query. UI components are built with Radix UI primitives and shadcn/ui, styled with Tailwind CSS, emphasizing a component-based, responsive, mobile-first design with real-time data synchronization. Dark mode is the default theme.

### Backend Architecture

The backend runs on Node.js with Express.js, fully implemented in TypeScript. It follows a RESTful API design with clear endpoints for authentication, user management, AI content generation, media handling, social page management, and post scheduling. Multer is used for file uploads, integrating with Cloudinary. Node-cron handles background processing for scheduled post publication. Architectural patterns include a service layer, storage abstraction, and a middleware-based request processing pipeline. Session management is handled by `express-session` with `connect-pg-simple`.

### Database Architecture

PostgreSQL is the chosen database, utilizing Drizzle ORM for type-safe operations and Neon serverless driver for WebSocket support. The schema includes core tables for `users`, `cloudinary_config`, `social_pages`, `media`, `posts`, `post_media`, `scheduled_posts`, and `ai_generations`. Drizzle Kit manages schema migrations.

### Media Processing Pipeline

The platform leverages Cloudinary for cloud-based image and video storage and transformation. Original files are uploaded, and for publishing, the original image URL is used. Cloudinary generates transformation URLs exclusively for UI preview purposes.

### Authentication & Authorization

Authentication uses Passport.js with local strategy and bcrypt for password hashing. User roles (`admin`, `user`) control access. AI text generation is available to all authenticated users using shared admin OpenRouter configuration. Session management is via `express-session` with HTTP-only cookies and a 7-day duration. Routes are protected on both backend (middleware `requireAuth`, `requireAdmin`) and frontend (`ProtectedRoute` component).

### UI/UX Decisions

The UI is built with Radix UI and shadcn/ui, leveraging Tailwind CSS. Key design decisions include a component-based architecture, custom path aliases, and a responsive, mobile-first approach. The platform supports multi-photo carousel posts with drag-and-drop reordering, and a PreviewModal offers realistic rendering of posts across Facebook and Instagram formats. The calendar view is responsive, with a grid for desktop and an expandable list for mobile, allowing editing and deletion of scheduled posts. Infinite scroll is implemented in the media library and new post pages for performance, using IntersectionObserver.

## External Dependencies

### AI Content Generation

- **OpenRouter API**: Used for AI text generation (e.g., Anthropic Claude 3.5 Sonnet).

### Cloud Storage

- **Cloudinary**: Provides cloud-based image and video storage, transformations, and CDN.

### Social Media APIs

- **Facebook Graph API**: Used for publishing posts to Facebook pages, including multi-photo carousel and video support.
- **Instagram Graph API**: Used for single photo/video posts.

### Database Service

- **Neon Serverless PostgreSQL**: Primary database service.

### UI Component Libraries

- **Radix UI**: Accessible UI primitives.
- **React Hook Form**: Form state management with validation.
- **Zod**: Schema validation.
- **date-fns**: Date manipulation.
- **react-dropzone**: Drag-and-drop file uploads.
- **Lucide React**: Icon library.
- **@dnd-kit**: Drag and drop functionality.