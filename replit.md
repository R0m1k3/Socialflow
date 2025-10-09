# Social Flow - AI-Powered Social Media Management Platform

## Overview

Social Flow is a comprehensive social media automation platform designed to streamline content creation and publication across Facebook and Instagram. The application enables users to manage multiple social media pages, generate AI-powered post content, process and optimize media for different platform formats, and schedule posts with automated publishing capabilities.

**Core Purpose**: Automate social media content workflow from creation to publication, with AI assistance for text generation and intelligent media formatting for platform-specific requirements.

**Key Features**:
- Multi-page social media account management (Facebook & Instagram)
- AI-powered content generation using OpenRouter API
- Automated media processing and format optimization
- **Multi-photo carousel posts** (up to 10 photos per post with drag & drop reordering)
- **Preview modal** with realistic Facebook/Instagram rendering before publishing
- Post scheduling with automated publication
- Media library management
- Dashboard analytics and activity tracking

## User Preferences

Preferred communication style: Simple, everyday language.

## Authentication & Authorization

**System**: Passport.js avec stratégie locale et bcrypt pour le hachage des mots de passe

**Rôles utilisateur**:
- `admin` - Accès complet à tous les paramètres, SQL, et gestion des utilisateurs
- `user` - Accès aux fonctionnalités de publication uniquement (pas de paramètres)

**Utilisateur par défaut**:
- Username: `admin`
- Password: `admin`
- Rôle: admin
- **Important**: Changez ce mot de passe en production

**Session Management**:
- express-session avec cookies HTTP-only
- sameSite: 'lax' pour prévention CSRF
- Durée de session: 7 jours
- Secret de session via variable d'environnement `SESSION_SECRET`
- Store de session:
  - **Production**: PostgreSQL via connect-pg-simple (table `session` auto-créée)
  - **Développement**: MemoryStore (par défaut)

**Protection des routes**:
- Backend: Middleware `requireAuth` pour routes utilisateur, `requireAdmin` pour routes admin
- Frontend: Composant `ProtectedRoute` avec vérification de session et redirection vers /login

## System Architecture

### Frontend Architecture

**Framework**: React with TypeScript using Vite as the build tool

**Routing**: Wouter for lightweight client-side routing with protected routes
- Public: `/login`
- Protected (authenticated): Dashboard, Media, AI, Posts, Calendar, Pages, Analytics, History
- Protected (admin only): `/settings`, `/sql`, `/users`

**State Management**: 
- TanStack Query (React Query) for server state management and caching
- Local component state with React hooks

**UI Framework**: 
- Radix UI primitives for accessible, unstyled components
- shadcn/ui component library (New York style variant)
- Tailwind CSS for styling with custom design tokens
- Dark mode as default theme

**Key Design Decisions**:
- Component-based architecture with reusable UI components
- Custom path aliases (@/, @shared) for clean imports
- Responsive design with mobile-first approach
- Real-time data synchronization through React Query

### Backend Architecture

**Runtime**: Node.js with Express.js server

**Type Safety**: Full TypeScript implementation across frontend, backend, and shared schema

**API Design**: RESTful endpoints with conventional HTTP methods
- `/api/auth/*` - Authentication (login, logout, session)
- `/api/users` - User management (admin only)
- `/api/sql/*` - SQL administration (admin only)
- `/api/stats` - Dashboard statistics (authenticated)
- `/api/ai/generate` - AI text generation (authenticated)
- `/api/media/*` - Media upload and management (authenticated)
- `/api/pages/*` - Social page management (authenticated)
- `/api/posts/*` - Post and scheduling management (authenticated)
- `/api/cloudinary/config` - Cloudinary configuration (admin only)
- `/api/openrouter/config` - OpenRouter configuration (admin only)

**File Upload**: Multer middleware for handling multipart/form-data with in-memory storage strategy, integrated with Cloudinary for cloud storage

**Background Processing**: 
- Node-cron for scheduled task execution
- Scheduler service running every minute to check for pending posts
- Automated post publication to social media platforms

**Session Management**: 
- Développement: MemoryStore (sessions en mémoire)
- Production: connect-pg-simple (sessions persistées dans PostgreSQL, table `session`)

**Key Architectural Patterns**:
- Service layer pattern (OpenRouterService, CloudinaryService, SchedulerService)
- Storage abstraction layer for database operations
- Middleware-based request processing pipeline
- Separation of concerns between routes, services, and storage

### Database Architecture

**ORM**: Drizzle ORM for type-safe database operations

**Database**: PostgreSQL (via Neon serverless driver with WebSocket support)

**Schema Design**:

Core Tables:
- `users` - User authentication and profiles with role-based access (admin/user)
- `cloudinary_config` - Cloudinary configuration per user (cloud name, API key, API secret)
- `social_pages` - Connected Facebook/Instagram pages with access tokens
- `media` - Uploaded media files with Cloudinary public IDs and transformation URLs
- `posts` - Post content with AI generation tracking and status
- `post_media` - **NEW**: Junction table linking posts to multiple media with `displayOrder` field for carousel ordering
- `scheduled_posts` - Scheduled publication queue with page assignments
- `ai_generations` - History of AI-generated content

**Enumerations**:
- `platform`: facebook, instagram
- `post_type`: feed, story
- `post_status`: draft, scheduled, published, failed
- `media_type`: image, video

**Relationships**:
- One-to-many: users → social_pages, users → media, users → posts
- Many-to-many: posts ↔ social_pages (through scheduled_posts)
- Foreign key cascading deletes for data integrity

**Migration Strategy**: Drizzle Kit for schema migrations with PostgreSQL dialect

### Media Processing Pipeline

**Cloud Storage**: Cloudinary for image/video storage and transformation

**Format Optimization Strategy**:
- Facebook Feed: 1200x630px (landscape format)
- Instagram Feed: 1080x1080px (square format)
- Instagram Story: 1080x1920px (vertical format)

**Storage**: Cloud-based storage via Cloudinary CDN with automatic transformations

**Processing Flow**:
1. Upload original file to memory buffer via Multer
2. Upload to Cloudinary with unique public_id
3. Cloudinary automatically generates transformation URLs for all platform formats
4. Store Cloudinary public_id and transformation URLs in database
5. Serve optimized images via Cloudinary CDN

## External Dependencies

### AI Content Generation

**Service**: OpenRouter API
- Model: Anthropic Claude 3.5 Sonnet
- Purpose: Generate multiple post text variations from product information
- Configuration: Requires `OPENROUTER_API_KEY` environment variable
- Temperature: 0.8 for creative variation

### Cloud Storage

**Cloudinary**:
- Purpose: Cloud-based image and video storage with automatic transformations
- Configuration: User-configurable via Settings page (cloud name, API key, API secret)
- Storage: Images stored in Cloudinary cloud with unique public IDs
- Transformations: Automatic generation of platform-specific formats (Facebook Feed, Instagram Feed, Instagram Story)
- CDN: Global content delivery network for fast image loading
- Status: Fully integrated for media uploads

### Social Media APIs

**Facebook Graph API**:
- Purpose: Publishing posts to Facebook pages
- Authentication: Page access tokens stored per social_page
- Status: Integration prepared (not fully implemented in codebase)

**Instagram Graph API**:
- Purpose: Publishing posts and stories to Instagram
- Authentication: Page access tokens stored per social_page
- Status: Integration prepared (not fully implemented in codebase)

### Database Service

**Neon Serverless PostgreSQL**:
- WebSocket-based connection pooling
- Connection string via `DATABASE_URL` environment variable
- Serverless-optimized with @neondatabase/serverless driver

### Development Tools

**Replit Integration**:
- Vite plugins for runtime error overlay
- Cartographer plugin for code navigation
- Dev banner for development environment

### Build and Deployment

**Production Build Process**:
1. Vite builds React frontend to `dist/public`
2. esbuild bundles server code to `dist/index.js`
3. Node.js serves bundled application

**Environment Variables Required**:
- `DATABASE_URL` - PostgreSQL connection string
- `OPENROUTER_API_KEY` - AI text generation API key
- `SESSION_SECRET` - Session encryption key
- `APP_URL` - Application public URL
- `PGPASSWORD` - Database password (for Docker deployments)

### UI Component Libraries

- Radix UI: Comprehensive set of accessible UI primitives
- React Hook Form: Form state management with validation
- Zod: Schema validation for forms and API data
- date-fns: Date manipulation and formatting
- react-dropzone: Drag-and-drop file uploads
- Lucide React: Icon library
- **@dnd-kit**: Drag and drop library for photo carousel reordering

## Recent Changes (October 2025)

### Multi-Photo Carousel Feature

**Overview**: Support for creating posts with up to 10 photos in a carousel format with drag & drop reordering and preview modal.

**Database Changes**:
- Added `post_media` table with `displayOrder` integer field for ordered media
- Posts can now have multiple photos via `post_media` junction table
- API accepts array of media IDs with display order

**Frontend Components**:

**New Post Page** (`/new-post`):
- **Photo Selection**: "Photos sélectionnées" section shows selected photos with order numbers (1, 2, 3...)
- **Drag & Drop**: Uses @dnd-kit/sortable for reordering selected photos
  - Drag handle (GripVertical icon) on each selected photo
  - Visual order indicators on each photo
  - Separate section for selected vs. all photos
- **Limit**: Maximum 10 photos per post
- **Preview Button**: Opens PreviewModal instead of immediate publish

**PreviewModal Component** (`client/src/components/preview-modal.tsx`):
- **Realistic Rendering**: Shows post exactly as it will appear on Facebook/Instagram
- **Format Switching**: Toggle between:
  - Feed Facebook (1200x630px) - Horizontal carousel
  - Feed Instagram (1080x1080px) - Square carousel
  - Story Instagram (1080x1920px) - Vertical carousel
- **Carousel Navigation**:
  - Next/Previous buttons (ChevronLeft/ChevronRight)
  - Clickable photo indicators (dots for Facebook, bars for Instagram)
  - Shows current photo index
- **Publish Integration**: Publish button in modal triggers post creation

**API Changes**:
- `POST /api/posts` accepts `mediaIds` parameter as:
  - Simple string array (using index as order): `["id1", "id2", "id3"]`
  - Or array of objects with displayOrder: `[{mediaId: "id1", displayOrder: 0}, ...]`
- Backwards compatible with single media posts

**Storage Layer**:
- `createPost` method creates post_media entries with displayOrder
- Bulk insert of media-post relationships with proper ordering

### Calendar Responsive Improvements

**Overview**: Enhanced calendar page with mobile-responsive list view, edit functionality for scheduled posts, and improved visual display with page names and platform icons.

**Desktop View (≥768px)**:
- Grid calendar layout with 7 columns (days of week)
- Scheduled posts displayed in day cells with:
  - Time (HH:mm format)
  - Platform icon (Facebook/Instagram from react-icons/si)
  - Page name (from social_pages.page_name)
  - Edit button (blue pencil icon, hover to show)
  - Delete button (red trash icon, hover to show)
- Color coding: Blue for pending posts, Green for published posts
- Legend showing status colors

**Mobile View (<768px)**:
- **CalendarListView Component**: Chronological list with date grouping
- **Expandable Sections**: Click to expand/collapse posts by date
- Each date section displays: "Day Date Month Year" with post count
- Highlighted "Aujourd'hui" for current date
- Posts display:
  - Time in large font (text-lg)
  - Status badge (Programmé/Publié)
  - Platform icon + page name
  - Edit button (44px x 44px touch target)
  - Delete button (44px x 44px touch target)
- Responsive breakpoint detection via useMediaQuery hook

**Edit Scheduled Post Feature**:
- **EditScheduledPostDialog Component**: Modal dialog for editing scheduled posts
- **Date Picker**: HTML5 date input with YYYY-MM-DD format
- **Time Picker**: HTML5 time input with HH:mm format
- **Page Selector**: Dropdown with platform icons and page names
- Pre-fills current values via useEffect when dialog opens
- **API**: PATCH /api/scheduled-posts/:id endpoint
- Updates: scheduledAt timestamp and pageId
- Cache invalidation after successful update
- Toast notification: "Programmation modifiée"

**Frontend Components Created**:
- `client/src/components/calendar-list-view.tsx` - Mobile list view with expandable dates
- `client/src/components/edit-scheduled-post-dialog.tsx` - Edit dialog for scheduled posts
- `client/src/hooks/use-media-query.ts` - Responsive breakpoint detection hook

**Backend Changes**:
- `PATCH /api/scheduled-posts/:id` - Update scheduledAt and pageId for a scheduled post
- Validates date/time and page existence before update
- Returns updated scheduled post with joined page data

**Mobile Optimizations**:
- 44px minimum touch targets for all interactive elements
- Reduced padding and spacing on mobile devices
- Large, readable text sizes for time and status
- Expandable sections to reduce visual clutter
- Smooth transitions for expand/collapse animations