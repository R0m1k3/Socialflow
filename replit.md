# Social Flow - AI-Powered Social Media Management Platform

## Overview

Social Flow is a comprehensive AI-powered social media automation platform designed to streamline content creation and publication across Facebook and Instagram. It enables users to manage multiple social media pages, generate AI-powered post content, optimize media for different platform formats, and schedule posts with automated publishing. The platform's ambition is to provide a complete, AI-driven solution for social media content management, significantly reducing manual effort and improving content quality and reach. Key capabilities include multi-photo carousel posts with drag-and-drop reordering, a preview modal for realistic platform rendering, and an integrated media library.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

### November 17, 2025
- **Access Token Expiration Tracking**: Added automatic tracking and visual display of Facebook/Instagram access token expiration dates in the "Pages gérées" section. Implementation: (1) Added `tokenExpiresAt` timestamp column to `social_pages` table in database schema, (2) POST endpoint automatically calculates expiration date as current date + 60 days when adding a new page, (3) Updated existing pages via SQL migration to populate expiration dates based on `createdAt + 60 days`, (4) UI displays expiration status with color-coded visual indicators in page cards: green (>15 days), orange (7-15 days), red (<7 days or expired), with warning icon for urgent/expired tokens, (5) Shows remaining days and formatted expiration date using date-fns with French locale. This helps users proactively identify and renew expiring tokens before they cause publishing failures. Files modified: `shared/schema.ts`, `server/routes.ts`, `client/src/pages/pages.tsx`.
- **Story Text Overlay Minimum Font Size Reduction**: Reduced minimum font size in adaptive text overlay system from 24px to 12px for both Instagram and Facebook stories. This allows significantly more text to fit within the story text box (bottom 25% of image) by enabling smaller font sizes when needed. The adaptive sizing algorithm now scales between 12-72px, reducing in 2px increments until text fits or reaches the new 12px minimum. Modified both server-side image generation (`server/services/imageProcessor.ts`) and client-side preview (`client/src/components/preview-modal.tsx`) to maintain consistency between preview and published stories.
- **Facebook Story Preview with Text Overlay**: Added preview support for Facebook Story format in PreviewModal, matching the existing Instagram Story preview functionality. The unified `renderStory()` function now handles both platforms with platform-specific icons (blue Facebook icon vs. gradient Instagram icon) while maintaining identical text overlay rendering with adaptive font sizing (12-72px), semi-transparent background, and centered text display. Both Facebook Story and Instagram Story previews now accurately show how published stories will appear with text burned into the image.
- **Story Text Overlay with Adaptive Sizing**: Implemented automatic text overlay on Instagram and Facebook stories with intelligent font size adaptation. When publishing a story with text content, the system now generates a composite image with the text burned into the bottom 25% of the image. Features: (1) Adaptive font sizing (originally 24-72px, now 12-72px) that automatically adjusts based on text length to fit within the text box, (2) Aspect ratio preservation for source images (centered with black letterboxing if needed to maintain 9:16 story format), (3) Automatic text wrapping with line breaks on word boundaries, (4) Ellipsis truncation for extremely long text that exceeds available space, (5) Semi-transparent black background (60% opacity) behind text for readability. Implementation uses Canvas (node-canvas) for image composition in `imageProcessor.addTextToStoryImage()`, with the generated image uploaded to Cloudinary in a dedicated `social-flow/stories` folder before publication. This ensures text appears correctly on published stories since Facebook/Instagram APIs don't support text overlays natively. The text box reserves 25% of the image height with 40px padding, and font size reduces in 2px increments until text fits or reaches the minimum.
- **AI Assistant Model Loading Fix**: Fixed bug preventing non-admin users from accessing the AI assistant feature. Problem: The AI chat component (`ai-chat.tsx`) was querying `/api/ai/models` which requires admin privileges (`requireAdmin`), causing model list to fail loading for regular users. Solution: Changed the component to use `/api/openrouter/models` endpoint instead, which only requires authentication (`requireAuth`). Updated data structure access from `modelsData?.models` to `modelsData?.data` to match the OpenRouter API response format `{ data: OpenRouterModel[] }`. This fix enables all authenticated users to load the model list and use the AI assistant feature. The endpoint `/api/openrouter/models` was already being used in Settings page for the same purpose, ensuring consistency across the application.

### November 5, 2025
- **New Post Media Grid Optimization**: Optimized the "Nouvelle publication" media grid for better performance and usability. Changes: (1) Limited display to 12 most recent media items sorted by createdAt descending, (2) Removed infinite scroll functionality, (3) Implemented useMemo with spread copy to prevent React Query cache mutation during sorting, (4) Added conditional rendering for videos using `<video>` elements with `preload="metadata"` instead of broken `<img>` tags to display proper video thumbnails. This ensures faster page load, prevents cache corruption, and provides visual previews for both images and videos.
- **Mobile Calendar Visual Separator**: Added visual separator between future and past dates in mobile calendar list view. A horizontal divider with centered text "PUBLICATIONS PASSÉES" now appears before the first past date when both future/today and past dates exist. The separator uses gray horizontal lines on both sides of uppercase text, providing clear visual distinction between upcoming posts and past posts. The separator only appears when transitioning from future to past dates - it does not show when only past or only future dates exist.
- **Mobile Calendar List Sorting Fix**: Fixed illogical date ordering in mobile calendar list view. Problem: After displaying today's date first, remaining dates were sorted using simple localeCompare, mixing past and future dates together. Solution: Implemented intelligent chronological sorting in `calendar-list-view.tsx` with three-tier logic: (1) Today's date always appears first, (2) Future dates display in ascending chronological order (soonest first), (3) Past dates appear last in descending order (most recent first). The sorting uses ISO date string comparison (yyyy-MM-dd) which preserves chronological order. This provides intuitive navigation where users see today, then upcoming posts in order, then recent past posts.

### October 31, 2025
- **Android Video Upload Fix**: Fixed critical bug preventing video uploads on Android devices. Problem: React-dropzone only accepted `.mp4` and `.mov` formats, but Android browsers often use different video formats like `.webm`, `.3gp`, `.mkv`. Solution: Extended accepted video formats in both `new-post.tsx` and `media-upload.tsx` to include `.webm`, `.3gp`, `.3gpp`, `.mkv`, `.avi` in addition to `.mp4` and `.mov`. Also added `.webp` support for images. Implemented diagnostic console logging to capture file name, MIME type, size, and video detection. Added explicit file size validation (50 MB max) with user-friendly error messages showing actual file size. Fixed camera input reset bug where oversized file rejection prevented subsequent capture attempts - now properly resets input (`e.target.value = ''`) after both errors and successful uploads. Photo uploads on Android already worked; this fix specifically targets video capture compatibility.

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