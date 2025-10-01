# Social Flow - AI-Powered Social Media Management Platform

## Overview

Social Flow is a comprehensive social media automation platform designed to streamline content creation and publication across Facebook and Instagram. The application enables users to manage multiple social media pages, generate AI-powered post content, process and optimize media for different platform formats, and schedule posts with automated publishing capabilities.

**Core Purpose**: Automate social media content workflow from creation to publication, with AI assistance for text generation and intelligent media formatting for platform-specific requirements.

**Key Features**:
- Multi-page social media account management (Facebook & Instagram)
- AI-powered content generation using OpenRouter API
- Automated media processing and format optimization
- Post scheduling with automated publication
- Media library management
- Dashboard analytics and activity tracking

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React with TypeScript using Vite as the build tool

**Routing**: Wouter for lightweight client-side routing

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
- `/api/stats` - Dashboard statistics
- `/api/ai/generate` - AI text generation
- `/api/media/*` - Media upload and management
- `/api/pages/*` - Social page management
- `/api/posts/*` - Post and scheduling management

**File Upload**: Multer middleware for handling multipart/form-data with in-memory storage strategy

**Background Processing**: 
- Node-cron for scheduled task execution
- Scheduler service running every minute to check for pending posts
- Automated post publication to social media platforms

**Session Management**: Stateless authentication with session cookies (connect-pg-simple for PostgreSQL session store)

**Key Architectural Patterns**:
- Service layer pattern (OpenRouterService, ImageProcessor, SchedulerService)
- Storage abstraction layer for database operations
- Middleware-based request processing pipeline
- Separation of concerns between routes, services, and storage

### Database Architecture

**ORM**: Drizzle ORM for type-safe database operations

**Database**: PostgreSQL (via Neon serverless driver with WebSocket support)

**Schema Design**:

Core Tables:
- `users` - User authentication and profiles
- `social_pages` - Connected Facebook/Instagram pages with access tokens
- `media` - Uploaded media files with platform-specific processed versions
- `posts` - Post content with AI generation tracking and status
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

**Image Processing Library**: Sharp for high-performance image manipulation

**Format Optimization Strategy**:
- Facebook Feed: 1200x630px (landscape format)
- Instagram Feed: 1080x1080px (square format)
- Instagram Story: 1080x1920px (vertical format)

**Storage**: Local filesystem storage in `/uploads` directory with unique UUID-based filenames

**Processing Flow**:
1. Upload original file to memory buffer
2. Generate three optimized versions for different platforms
3. Store all versions with references in database
4. Serve via `/uploads` static route

## External Dependencies

### AI Content Generation

**Service**: OpenRouter API
- Model: Anthropic Claude 3.5 Sonnet
- Purpose: Generate multiple post text variations from product information
- Configuration: Requires `OPENROUTER_API_KEY` environment variable
- Temperature: 0.8 for creative variation

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