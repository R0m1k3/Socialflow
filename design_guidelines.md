# Social Flow - Design Guidelines

## Design Approach

**Selected Framework:** Design System Approach inspired by modern SaaS dashboards (Linear, Buffer, Notion) with Material Design principles for data-rich interfaces.

**Core Philosophy:** Professional productivity tool prioritizing clarity, efficiency, and visual hierarchy in dark mode with sophisticated blue/purple branding.

## Color Palette

**Dark Mode (Primary Theme):**
- Background Base: 222 20% 8%
- Surface Elevated: 222 18% 12%
- Surface Card: 222 16% 15%
- Border Subtle: 222 12% 20%

**Brand Colors:**
- Primary Blue: 215 85% 58%
- Primary Purple: 265 75% 62%
- Gradient Accent: Linear gradient from Primary Blue to Primary Purple

**Functional Colors:**
- Success Green: 142 76% 48%
- Warning Orange: 35 95% 58%
- Error Red: 0 85% 62%
- Info Cyan: 195 85% 55%

**Text Hierarchy:**
- Primary Text: 0 0% 95%
- Secondary Text: 222 10% 65%
- Tertiary Text: 222 8% 48%

## Typography

**Font Family:**
- Primary: 'Inter' from Google Fonts (400, 500, 600, 700)
- Monospace: 'JetBrains Mono' for timestamps and metrics

**Scale:**
- Headings H1: text-3xl font-semibold
- Headings H2: text-2xl font-semibold
- Headings H3: text-xl font-medium
- Body Large: text-base
- Body: text-sm
- Captions: text-xs text-secondary

## Layout System

**Spacing Primitives:** Tailwind units of 2, 4, 6, 8, 12, 16 (e.g., p-4, gap-6, mt-8)

**Grid Structure:**
- Sidebar: Fixed width 280px (w-70) on desktop, collapsible on mobile
- Main Content: Flexible with max-w-7xl container
- Dashboard Grid: grid-cols-1 md:grid-cols-2 lg:grid-cols-3 with gap-6

**Container Widths:**
- Dashboard sections: max-w-7xl with px-6 to px-8
- Form containers: max-w-2xl
- Content cards: Full width within grid columns

## Component Library

### Sidebar Navigation
- Dark surface (Background Base) with subtle border-right
- Logo + app name at top (h-16)
- Navigation items with icons (Heroicons) + labels
- Active state: Primary gradient background with 12% opacity, blue text
- Hover: Surface Elevated background
- Bottom section: User profile card with avatar, name, settings icon
- Spacing: py-2 between items, px-4 horizontal padding

### Dashboard Cards
- Background: Surface Card with rounded-xl
- Border: 1px solid Border Subtle
- Shadow: Soft shadow (shadow-lg with low opacity)
- Padding: p-6
- Header: Flex justify-between with title (text-lg font-semibold) + action button
- Content spacing: space-y-4 internally

### Post Scheduling Interface
- Calendar view: Week/month grid with date cells
- Post cards: Compact cards showing thumbnail + caption preview + platform badges (FB/IG)
- Drag-and-drop visual indicators
- Time slots: Hourly breakdown with scheduled posts

### Analytics Cards
- Metric cards: Large number (text-3xl font-bold) + label + trend indicator
- Charts: Use Chart.js with gradient fills matching brand colors
- Grid layout for KPIs: 4 columns on desktop, responsive down

### Forms & Inputs
- Input fields: Surface Elevated background, border Border Subtle, rounded-lg, px-4 py-3
- Focus state: Primary Blue border, subtle glow
- Labels: text-sm font-medium mb-2, Secondary Text color
- Textarea: min-h-32 for post composition
- File upload: Dashed border drop zone with center icon and text

### Buttons
- Primary: Gradient background (blue to purple), text-white, rounded-lg, px-6 py-3, font-medium
- Secondary: Border Primary Blue, text Primary Blue, transparent background
- Ghost: Transparent, hover Surface Elevated
- Icon buttons: w-10 h-10, rounded-lg, center content

### Platform Badges
- Small pills (px-3 py-1, rounded-full, text-xs font-medium)
- Facebook: Blue background (215 85% 58% with 15% opacity), blue text
- Instagram: Purple background (265 75% 62% with 15% opacity), purple text

### Status Indicators
- Dots with colors: w-2 h-2 rounded-full
- Scheduled: Primary Blue
- Published: Success Green
- Failed: Error Red
- Draft: Tertiary Text

### Data Tables
- Header row: Surface Elevated background, font-medium, uppercase text-xs
- Rows: Border-bottom subtle, hover Surface Card
- Padding: px-6 py-4
- Alternating backgrounds for better readability

## Animations

**Minimal & Purposeful:**
- Page transitions: Fade-in only (150ms)
- Card hover: Subtle lift (translateY -2px, 200ms)
- Button interactions: Scale 0.98 on active
- Navigation: Smooth color transitions (200ms)
- No distracting scroll animations or complex effects

## Images

**Hero Section:** None - Dashboard-first interface prioritizing immediate utility

**Avatar & Thumbnails:**
- User avatars: w-10 h-10, rounded-full with border
- Post thumbnails: aspect-video, rounded-lg, object-cover
- Platform logos: Use official brand SVGs at 20x20 or 24x24

**Empty States:**
- Illustration placeholders for "No posts scheduled", "No analytics data"
- Center aligned with icon, heading, and CTA button
- Subtle grayscale illustrations maintaining professional tone

## Key Screens Layout

**Dashboard:** 3-column grid with Overview metrics (top row), Recent Posts card, Upcoming Schedule card, Quick Analytics

**Calendrier:** Full-width calendar component, left sidebar filter (platforms, status), right panel for selected post details

**Nouvelle Publication:** Center form (max-w-2xl), left preview panel showing platform-specific mockups, sticky publish/schedule buttons

**Analytiques:** Metric cards grid (4 cols), followed by full-width charts for engagement over time, best posting times heatmap

**Paramètres:** Two-column layout, left navigation tabs, right content panels