# Leanworks Hub

A comprehensive team collaboration platform built with modern technologies. Leanworks Hub combines task management, document collaboration, team communication, and video conferencing into a unified workspace.

## Table of Contents

- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)
- [Main Components](#main-components)
- [Component Architecture Walkthroughs](#component-architecture-walkthroughs)
- [Getting Started](#getting-started)
- [Development](#development)
- [Deployment](#deployment)

## Tech Stack

**Frontend:**
- React 18 with TypeScript
- Vite (build tool)
- Tailwind CSS (styling)
- shadcn/ui (component library)
- TipTap (rich text editor with collaboration)
- LiveKit (real-time communication)

**Backend:**
- Node.js with Express
- TypeScript
- PostgreSQL (multi-tenant database)
- Firebase (authentication & storage)
- Google Cloud Platform (Pub/Sub, Storage, Secret Manager)

**Key Libraries:**
- React Query for data fetching
- React Hook Form for form management
- Zod for validation
- Yjs for collaborative editing
- AssemblyAI for transcription
- Stripe for payments

## Project Structure

```
leanworks-hub/
├── src/                    # Frontend React application
├── server/                 # Backend Express server
├── database/              # Database configuration & schema
├── k8s/                   # Kubernetes deployment configs
├── public/                # Static assets
└── scripts/               # Utility scripts
```

## Architecture Overview

Leanworks Hub follows a **layered monorepo architecture** with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React)                         │
├─────────────────────────────────────────────────────────────┤
│  Pages │ Components │ Hooks │ Services │ Contexts │ Utils  │
├─────────────────────────────────────────────────────────────┤
│              API Client (Axios) + Firebase Auth             │
├─────────────────────────────────────────────────────────────┤
│                  Backend (Express + TypeScript)             │
├─────────────────────────────────────────────────────────────┤
│  Endpoints │ Services │ Workers │ Validation │ Middleware  │
├─────────────────────────────────────────────────────────────┤
│  PostgreSQL (Multi-Tenant) │ Firebase │ Google Cloud       │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow Architecture

**Frontend → Backend Flow:**
1. User interacts with React component
2. Component uses hook to fetch/mutate data (React Query)
3. Hook calls API service (src/services/api.ts)
4. API service sends HTTP request to backend
5. Backend endpoint validates request using Zod schemas
6. Service layer executes business logic
7. Database layer persists data
8. Response returned and UI updates via React Query cache

**Real-time Updates:**
- Google Pub/Sub for server-to-client events
- WebSockets for live collaboration (TipTap + Yjs)
- Firebase Realtime Database for presence tracking

**Multi-tenant Routing:**
- Organization context determines which database pool to use
- All requests include org context in URL or headers
- Database queries automatically scoped to tenant

## Main Components

### Frontend (`src/`)

#### Pages
Core application pages that define the main user workflows:

- **Home.tsx** - Dashboard landing page with overview and quick stats
- **Projects.tsx / ProjectDetail.tsx** - Project management and individual project views
- **Tasks.tsx / TaskDetail.tsx** - Task tracking with detailed task views
- **Chats.tsx** - Team messaging and conversations interface
- **Calendar.tsx** - Event scheduling and calendar management (Month/Week/Day/Agenda views)
- **DocsCatalog.tsx / DocDetail.tsx** - Document library and collaborative document editing
- **Teams.tsx / TeamDetail.tsx** - Team management and team-specific views
- **Integrations.tsx** - Third-party integrations (Slack, GitHub, Linear, Atlassian, etc.)
- **Organizations.tsx** - Organization settings and management
- **Settings.tsx** - User and workspace settings
- **Profile.tsx** - User profile management
- **Subscription.tsx** - Billing and subscription management
- **Login.tsx / Signup.tsx / VerifyEmail.tsx** - Authentication pages

#### Components
Reusable UI components organized by feature:

**Core Layout:**
- **DashboardLayout.tsx** - Main app layout wrapper
- **AppSidebar.tsx** - Navigation sidebar
- **DetailPageHeader.tsx** - Header for detail pages

**Document Editing:**
- **RichTextEditor.tsx** - TipTap-based rich text editor with collaboration
- **DocDetailToolbar.tsx** - Actions for document management
- **ShareDocDialog.tsx** - Document sharing dialog
- **DraftRecoveryDialog.tsx** - Auto-save draft recovery

**Chat Features:**
- **ChatMessage.tsx** - Individual chat message display
- **ChatMessageList.tsx** - Message list with scroll tracking
- **ChatInput.tsx** - Input area with mentions and file uploads
- **ConversationList.tsx** - List of conversations
- **TeamChatWindow.tsx** - Team chat interface
- **AIChat.tsx** - AI assistant chat interface

**Calendar:**
- **calendar/MonthView.tsx** - Month calendar view
- **calendar/WeekView.tsx** - Week calendar view
- **calendar/DayView.tsx** - Day calendar view
- **calendar/AgendaView.tsx** - Agenda/list view
- **calendar/EventDialog.tsx** - Event creation/editing
- **calendar/QuickCreateDialog.tsx** - Quick event creation

**Tables & Data:**
- **TableFilterSort.tsx** - Advanced filtering and sorting for data tables
- **DocsList.tsx** - Document list view
- **TaskTooltip.tsx** - Tooltip for task previews

**Dialogs & Modals:**
- **NewProjectDialog.tsx** - Create new project
- **NewTaskDialog.tsx** - Create new task
- **TaskDetailDialog.tsx** - Task details modal
- **DocDetailDialogs.tsx** - Document-related dialogs
- **IntegrationConnectDialog.tsx** - Connect third-party services
- **LimitVisibilityDialog.tsx** - Visibility/permission settings

**Real-time Communication:**
- **VoiceCall.tsx** - Video/voice call interface using LiveKit
- **GlobalCallListener.tsx** - Handles incoming call notifications

**Other:**
- **ui/** - shadcn/ui component library
- **FloatingAskAI.tsx** - Floating AI assistant button
- **MoreOptionsMenu.tsx** - Context menu for additional actions

#### Hooks (`src/hooks/`)
Custom React hooks for business logic and data management:

**Data Fetching & State:**
- **useDocs.ts** - Document management
- **useTasks.ts** - Task management
- **useProjects.ts** - Project management
- **useTeams.ts** - Team management
- **useUsers.ts** - User data and user map
- **useEvents.ts** - Calendar events
- **useUpdates.ts** - Update notifications
- **useTeamChats.ts** - Team chat messages

**Form & Input:**
- **useDocForm.ts** - Document form handling
- **useTableFilterSort.ts** - Table filtering and sorting
- **useDateSelection.ts** - Date picker state

**AI & Chat:**
- **useAIChat.ts** - AI chat conversation state
- **useChatMessages.ts** - Chat message loading and pagination
- **useChatMentions.ts** - User mentions in chat
- **useChatImages.ts** - Image uploads in chat

**Real-time:**
- **useLiveKit.ts** - LiveKit video conferencing
- **useWebRTC.ts** - WebRTC configuration

**Utilities:**
- **useAutoSave.ts** - Auto-save functionality
- **useDebounce.ts** - Debounce hook
- **useScrollDepth.ts** - Track scroll depth for analytics
- **useTimeOnPage.ts** - Track time spent on page
- **useSectionVisibility.ts** - Intersection observer for sections
- **useTextSelection.ts** - Track selected text
- **useUserTimezone.ts** - User timezone handling
- **useSubscription.ts** - Subscription status
- **use-mobile.tsx** - Detect mobile viewport

#### Services (`src/services/`)
API communication and external service integration:

- **api.ts** - HTTP client and API endpoints for backend communication
- **draftService.ts** - Auto-save drafts to local storage
- **offlineQueue.ts** - Queue for offline operations

#### Utilities & Libraries (`src/lib/` & `src/utils/`)
- **firebase-client.ts / firebase.ts** - Firebase authentication and Firestore
- **analytics.ts** - Event tracking and analytics
- **citedContext.ts** - Context citation system
- **dateTimeUtils.ts** - Date and time utilities
- **tiptapContent.ts** - TipTap editor content handling
- **tiptapExtensions.ts** - Custom TipTap extensions
- **webrtc-config.ts** - WebRTC configuration
- **first-time-tracker.ts** - First-time user tracking
- **journey-tracker.ts** - User journey analytics

### Backend (`server/`)

#### Endpoints (`server/endpoints/`)
API route handlers for different features:

- **calls.ts** - Voice/video call management endpoints
- **messages.ts** - Chat message endpoints
- **livekit.ts** - LiveKit integration for video conferencing
- **files.ts** - File upload and download
- **images.ts** - Image upload and processing
- **integrations.ts** - Third-party integration webhooks
- **query.ts** - AI query/search endpoints
- **turn.ts** - TURN server configuration for WebRTC
- **updates.ts** - Project update endpoints

#### Services (`server/services/`)
Business logic and core services:

- **query-service.ts** - AI-powered query and search logic
- **transcription.ts** - Audio transcription using AssemblyAI
- **audio-recorder.ts** - Audio recording utilities
- **audio-processor.ts** - Audio processing and normalization
- **email.ts** - Email sending (Nodemailer)
- **pubsub-events.ts** - Google Pub/Sub event handling
- **data-pipeline.ts** - Data transformation and processing

#### Workers (`server/workers/`)
Background job processing:

- **transcription-worker.ts** - Asynchronous transcription processing
- **deployment-worker.ts** - Deployment automation

#### Validation (`server/validation/`)
Zod schemas for request validation:

- **auth-schemas.ts** - Authentication request validation
- **call-schemas.ts** - Call/meeting validation
- **message-schemas.ts** - Chat message validation
- **doc-schemas.ts** - Document validation
- **task-schemas.ts** - Task validation
- **project-schemas.ts** - Project validation
- **user-schemas.ts** - User validation
- **org-schemas.ts** - Organization validation
- **event-schemas.ts** - Calendar event validation
- **integration-schemas.ts** - Integration validation
- **subscription-schemas.ts** - Subscription validation
- **update-schemas.ts** - Update validation
- **query-schemas.ts** - Query validation
- **misc-schemas.ts** - Other validations

#### Middleware (`server/middleware/`)
- **validate-request.ts** - Request validation middleware using Zod schemas

#### Utilities (`server/utils/`)
Helper functions:

- **storage.ts** - Google Cloud Storage integration
- **firestore-query.ts** - Firestore query utilities
- **org-paths.ts** - Organization path resolution
- **logger.ts** - Logging utility (Pino logger)
- **contentUtils.ts** - Content processing utilities
- **audio-debug.ts** - Audio debugging utilities

### Database (`database/`)
Multi-tenant PostgreSQL setup:

- **schema.sql** - Main database schema
- **shared-schema.sql** - Shared schema for multi-tenant data
- **config.ts** - Database configuration
- **multi-tenant-pool.ts** - Connection pooling for multiple tenants
- **queries.ts** - Common database queries
- **init-schema.ts** - Schema initialization script

### Infrastructure (`k8s/`)
Kubernetes deployment configuration:

- **deployment.yaml** - Main application deployment
- **transcription-worker-deployment.yaml** - Background worker deployment
- **cloud-sql-proxy.yaml** - Cloud SQL proxy for database access
- **serviceaccount.yaml** - Kubernetes service account
- **ingress.yaml** - Ingress routing configuration
- **backend-config.yaml** - Google Cloud backend configuration
- **livekit-deployment.yaml** - LiveKit server deployment
- **pod-disruption-budgets.yaml** - Pod disruption budgets

## Component Architecture Walkthroughs

This section provides detailed architecture explanations for major components, showing data flow, state management, and integration patterns.

### Task Management Architecture

**File:** `src/pages/TaskDetail.tsx`, `src/hooks/useTasks.ts`, `server/endpoints/queries.ts`

**Data Flow:**
```
User clicks task
  ↓
TaskDetail page loads
  ↓
useTask() hook (React Query)
  ↓
API call to /api/tasks/:id
  ↓
Backend validates request (Zod schema)
  ↓
Database query with org context
  ↓
Response with task details + comments + history
  ↓
UI renders with form for updates
```

**State Management Pattern:**
- React Query for server state (data fetching, caching, sync)
- Local React state for UI state (form values, dialogs)
- URL params for task ID (allows deep linking)
- React Hook Form for form handling

**Key Components:**
- **useTasks.ts** - Custom hook providing:
  - `useTask(taskId)` - Fetch single task with React Query
  - `useUpdateTask()` - Mutate task and invalidate cache
  - `useDeleteTask()` - Delete task
  - `useTasksByProject(projectId)` - Fetch project's tasks
- **TaskDetail.tsx** - Page component rendering:
  - Task metadata (assignee, status, priority, dates)
  - Collapsible sections for details
  - Activity feed / comments
  - Edit forms for various fields

**Backend Integration:**
- Endpoint: `POST /api/tasks` - Create task
- Endpoint: `PUT /api/tasks/:id` - Update task
- Endpoint: `DELETE /api/tasks/:id` - Delete task
- All queries include org context for multi-tenant isolation

**Performance Optimizations:**
- React Query caching prevents redundant requests
- useMemo for derived state (status badges, priority colors)
- useCallback for event handlers to prevent child re-renders
- Pagination for large task lists

---

### Collaborative Document Editing Architecture

**File:** `src/components/RichTextEditor.tsx`, `src/pages/DocDetail.tsx`, `src/hooks/useDocs.ts`

**Technology Stack:**
- **TipTap** - Headless rich text editor
- **Yjs** - Conflict-free collaborative editing
- **y-websocket** - WebSocket provider for Yjs
- **Lowlight** - Code syntax highlighting
- **Marked** - Markdown parsing
- **Mermaid** - Diagram rendering

**Collaboration Flow:**
```
Editor Instance 1     Editor Instance 2
  ↓                        ↓
Yjs Doc (local)      Yjs Doc (local)
  ↓                        ↓
y-websocket provider ←→ WebSocket server
  ↓
PostgreSQL stores final snapshot
```

**Component Architecture:**
- **RichTextEditor.tsx** - Main editor component:
  - Initializes TipTap with custom extensions
  - Handles paste/drop events with Markdown conversion
  - Renders code blocks with syntax highlighting
  - Supports image resizing and embedded content
  - Integrates FloatingAskAI for context-aware suggestions

**Hooks & Services:**
- **useDocs.ts** - Document CRUD operations
- **useAutoSave.ts** - Periodic save to backend
- **draftService.ts** - Local draft recovery
- **tiptapExtensions.ts** - Custom TipTap extensions:
  - Table support with sizing
  - Link handling
  - Color support
  - Image resizing
  - Code block highlighting

**Auto-save Pattern:**
```
User types
  ↓
TipTap onChange fired
  ↓
useAutoSave debounces (3s)
  ↓
normalizeDocContentForSave() converts to HTML
  ↓
API call to /api/docs/:id (PUT)
  ↓
Version saved in DB
  ↓
Draft recovery available if needed
```

**Real-time Collaboration:**
- Uses Yjs for CRDT (Conflict-free Replicated Data Type)
- Multiple editors sync through WebSocket
- Server stores consolidated state in PostgreSQL
- No merge conflicts - Yjs handles concurrency

---

### Chat & Messaging Architecture

**Files:** `src/pages/Chats.tsx`, `src/components/chat/`, `server/endpoints/messages.ts`

**Data Model:**
```
Organization
  ↓
Team
  ├─ Conversations (DMs, group chats)
  │  └─ Messages
  │     ├─ Text content
  │     ├─ Mentions (@user)
  │     ├─ File attachments
  │     └─ Reactions
  └─ Team chat (unified feed)
```

**Component Hierarchy:**
```
Chats (page)
├─ TeamChatSidebar (list conversations)
├─ ConversationList (conversation list)
│  ├─ Conversation item (clickable)
│  └─ Unread badge
└─ TeamChatWindow (main chat area)
   ├─ ChatMessageList (scrollable messages)
   │  ├─ DateSeparator
   │  ├─ ChatMessage (individual message)
   │  │  ├─ Avatar + username
   │  │  ├─ Message content
   │  │  ├─ Timestamp
   │  │  ├─ Reactions
   │  │  └─ LikeButton
   │  └─ Scroll tracking for analytics
   └─ ChatInput (compose new message)
      ├─ Text input
      ├─ Mention suggestions (@)
      ├─ File attachment
      └─ Send button
```

**Hooks:**
- **useTeamChats.ts** - Fetch conversations & messages
- **useChatMessages.ts** - Paginated message loading
- **useChatMentions.ts** - User mention autocomplete
- **useChatImages.ts** - Image upload within chat

**Message Flow:**
```
User types message
  ↓
ChatInput component captures text + mentions + files
  ↓
User clicks send
  ↓
Frontend optimistic update (React Query)
  ↓
API call to /api/messages (POST)
  ↓
Backend validates (Zod schema)
  ↓
Stores in PostgreSQL with org context
  ↓
Publishes to Pub/Sub for real-time delivery
  ↓
Connected clients receive update via WebSocket
  ↓
UI updates with delivered status
```

**Mention System:**
- Regex parsing for `@username` in message text
- Autocomplete suggestions from team members
- Notification triggers when mentioned
- Linked mentions render as badges in UI

---

### Video Conferencing Architecture

**Files:** `src/components/VoiceCall.tsx`, `src/hooks/useLiveKit.ts`, `server/endpoints/livekit.ts`

**Technology:**
- **LiveKit** - Open-source WebRTC infrastructure
- **LiveKit Client SDK** - Browser-side WebRTC
- **LiveKit Server SDK** - Token generation & room management

**Call Flow:**
```
User initiates call
  ↓
Frontend requests access token from /api/calls/token
  ↓
Backend generates time-limited JWT token
  ↓
Token includes room name, participant identity, permissions
  ↓
Frontend connects to LiveKit server with token
  ↓
WebRTC peer connections established
  ↓
Media streams (audio/video) transmitted peer-to-peer
  ↓
Backend relays signaling (SDP, ICE candidates)
```

**VoiceCall Component:**
- Manages LiveKit room connection
- Renders local and remote video/audio tracks
- Handles mic/camera toggle
- Screen sharing support
- Call status indicators
- Participant list

**Hooks:**
- **useLiveKit.ts** - Room connection lifecycle
- **useWebRTC.ts** - WebRTC configuration (STUN/TURN servers)

**TURN Server:**
- Fallback for NAT traversal when peer-to-peer fails
- Endpoint: `/api/turn` returns TURN server credentials
- Reduces call drops in restrictive network environments

---

### Calendar Architecture

**Files:** `src/pages/Calendar.tsx`, `src/components/calendar/`, `src/hooks/useEvents.ts`

**View Types:**
- **MonthView** - Grid layout with event dots
- **WeekView** - Time slots with 7-day columns
- **DayView** - Hourly detailed view
- **AgendaView** - List of upcoming events

**State Management:**
```
Calendar page
  ├─ dateSelection state (current date/range)
  ├─ useEvents() hook fetches events
  ├─ useDateSelection() manages view mode
  └─ Local state for dialogs
      ├─ EventDialog (create/edit)
      └─ QuickCreateDialog (fast entry)
```

**Event Data Flow:**
```
User clicks empty slot or event
  ↓
EventDialog opens
  ↓
Form populated with defaults or event data
  ↓
User edits event
  ↓
useCreateEvent() or useUpdateEvent() mutation
  ↓
API call to /api/events
  ↓
Backend validates and stores
  ↓
React Query cache invalidated
  ↓
UI updates calendar view
```

**Features:**
- Drag-and-drop event creation
- Recurring event support
- Event notifications
- Multi-day events
- Calendar sharing (visibility controls)

---

### AI Integration Architecture

**Files:** `src/components/AIChat.tsx`, `src/components/FloatingAskAI.tsx`, `server/services/query-service.ts`

**Query Flow:**
```
User highlights text or opens AI chat
  ↓
FloatingAskAI or AIChat component
  ↓
User enters question/prompt
  ↓
useAIChat() hook prepares context
  ↓
API call to /api/query (POST)
  ├─ Query text
  ├─ Context (highlighted text, current doc)
  ├─ Document history
  └─ User preferences
  ↓
Backend query-service processes
  ├─ Embeds query using embeddings API
  ├─ Searches document vectors in PostgreSQL
  ├─ Retrieves relevant document sections
  └─ Sends to LLM for response generation
  ↓
Response streamed back to client
  ↓
AIChat displays response with citations
  ├─ References original documents
  ├─ Links to source sections
  └─ Copy/share response
```

**Context Citation System:**
- **citedContext.ts** - Tracks which documents informed AI response
- **ContextBadges.tsx** - Displays cited sources
- Users can click through to view source material

---

### Authentication & Multi-tenant Architecture

**Files:** `src/contexts/AuthContext.tsx`, `src/contexts/OrgContext.tsx`, `database/multi-tenant-pool.ts`

**Authentication Flow:**
```
User navigates to /login
  ↓
Login page captures email + password
  ↓
Firebase authentication via /api/auth/login
  ├─ Backend verifies credentials
  ├─ Creates JWT token
  └─ Returns user + organizations
  ↓
Frontend stores auth token
  ↓
AuthContext provides user info to app
  ↓
Protected routes check authentication
```

**Organization Selection:**
```
User selects organization
  ↓
OrgContext stores org ID + slug in localStorage
  ↓
All subsequent API requests include org context
  ↓
Backend multi-tenant-pool.ts routes to correct DB
  ├─ Org pool (organization-specific data)
  └─ Shared pool (user/org metadata)
```

**Multi-tenant Database Routing:**
```
API request with orgId
  ↓
multi-tenant-pool.ts getOrgPool(orgId)
  ├─ Lookup connection string from mapping
  ├─ Return or create connection pool
  └─ Connection scoped to org database
  ↓
Query executes in isolated database
  ↓
Zero cross-org data leakage
```

---

### File Upload & Storage Architecture

**Files:** `server/endpoints/files.ts`, `server/endpoints/images.ts`, `server/utils/storage.ts`

**Upload Flow:**
```
User selects file in component
  ↓
File uploaded to /api/files (multipart/form-data)
  ↓
Backend validates file type & size
  ↓
storage.ts uploads to Google Cloud Storage
  ├─ Organized by org/date
  ├─ Returns signed URL
  └─ Stores metadata in PostgreSQL
  ↓
Signed URL returned to frontend
  ↓
UI displays file preview/link
```

**Image Processing:**
```
User uploads image
  ↓
images.ts endpoint processes
  ├─ Resize to optimal dimensions (sharp library)
  ├─ Generate thumbnail
  ├─ Compress for web
  └─ Store in GCS
  ↓
Frontend receives optimized URLs
  ├─ Full size for viewing
  ├─ Thumbnail for lists
  └─ Multiple resolutions for responsive UI
```

---

### Transcription Worker Architecture

**Files:** `server/workers/transcription-worker.ts`, `server/services/transcription.ts`

**Async Processing:**
```
Audio recording from call
  ↓
Saved to GCS
  ↓
Job published to Pub/Sub topic
  ↓
Transcription worker picks up job
  ├─ Consumer subscribes to topic
  ├─ Downloads audio from GCS
  ├─ Sends to AssemblyAI API
  └─ Polls for completion
  ↓
Transcription returned
  ↓
Stored in PostgreSQL
  ↓
Published to Pub/Sub for real-time update
  ↓
Frontend receives notification
  ↓
Transcript displayed in call/message context
```

**Resilience:**
- Pub/Sub ensures at-least-once delivery
- Worker retry logic for failed transcriptions
- Timeout handling for long audio files
- Error logging and monitoring

---

### Error Handling & Validation Architecture

**Validation Pattern:**
```
Frontend form
  ├─ React Hook Form client-side validation
  └─ User feedback before submit
  ↓
API request sent
  ↓
Backend middleware: validateRequest()
  ├─ Parses Zod schema (from server/validation/)
  ├─ Validates all fields
  └─ Returns 400 if invalid
  ↓
Service layer executes business logic
  ├─ Additional validation
  ├─ Permission checks
  └─ Side effect execution
  ↓
Success response or error
  ↓
Frontend handles error
  ├─ Toast notification
  ├─ Form field errors
  └─ Retry or fallback UI
```

**Error Recovery:**
- React Query automatic retries for failed requests
- Draft recovery for lost edits (draftService.ts)
- Offline queue for operations (offlineQueue.ts)
- Network error detection and user notification



### Prerequisites
- Node.js (via nvm recommended)
- Bun (for package management)
- Firebase project set up
- Google Cloud Project with Pub/Sub, Storage, and Secret Manager
- PostgreSQL database
- LiveKit instance (self-hosted or managed)

### Installation

```bash
# Clone the repository
git clone <YOUR_GIT_URL>

# Navigate to the project directory
cd leanworks-hub

# Install dependencies
npm install
# or
bun install

# Set up environment variables
cp .env.example .env.local
# Fill in your Firebase, GCP, and other service credentials
```

### Required Environment Variables

- Firebase credentials (API key, auth domain, project ID)
- Google Cloud credentials (for Pub/Sub, Storage, Secret Manager)
- PostgreSQL connection string
- LiveKit API key and URL
- Stripe API keys
- AssemblyAI API key
- Email service credentials (Nodemailer)

## Development

### Start Development Server

```bash
# Run all dev services concurrently
npm run dev

# Or run individual services:
npm run dev:client       # Frontend (Vite)
npm run dev:server       # Backend (Express)
npm run dev:proxy        # Cloud SQL proxy
npm run dev:voice-services  # Voice call services
npm run dev:stripe       # Stripe webhook listener
npm run dev:transcription-worker  # Transcription worker
```

### Database

```bash
# Initialize database schema
npm run db:init

# Sync users from Teams
npm run sync:users

# Test transcription service
npm run test:transcription
```

### Linting & Building

```bash
# Run ESLint
npm run lint

# Build for production
npm run build

# Build for development
npm run build:dev

# Preview production build locally
npm run preview
```

## Deployment

### Docker

```bash
# Build Docker image
docker build -t leanworks-hub .

# Run container
docker run -p 3000:3000 leanworks-hub
```

### Kubernetes

```bash
# Deploy to Kubernetes
kubectl apply -f k8s/

# Scale replicas
kubectl scale deployment leanworks-hub --replicas=3
```

### Firebase Hosting

The project is set up for Firebase hosting. Deploy via:

```bash
npm run build
firebase deploy
```

## Key Features

- **Collaborative Documents** - Real-time document editing with TipTap and Yjs
- **Team Chat** - Instant messaging with mentions and file sharing
- **Video Conferencing** - Built-in voice/video calls with LiveKit
- **Task Management** - Create, assign, and track tasks with dependencies
- **Calendar** - Schedule events with multiple view options
- **AI Integration** - AI-powered queries and document assistance
- **Third-party Integrations** - Connect with Slack, GitHub, Linear, Atlassian, Notion, Outlook, and ClickUp
- **Multi-tenant** - Support for multiple organizations
- **Real-time Updates** - Live updates via Pub/Sub and WebSockets
- **Auto-save & Drafts** - Never lose work with auto-save and draft recovery
- **Analytics** - Track user engagement and usage patterns
- **Responsive Design** - Mobile-friendly interface

## License

Proprietary - Leanworks
