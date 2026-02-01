# Leanworks Hub

A comprehensive team collaboration platform built with modern technologies. Leanworks Hub combines task management, document collaboration, and AI-powered assistance into a unified workspace.

## Table of Contents

- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)
- [Main Components](#main-components)
- [Component Architecture Walkthroughs](#component-architecture-walkthroughs)
  - [Task Management](#task-management-architecture)
  - [Collaborative Document Editing](#collaborative-document-editing-architecture)
  - [AI Integration](#ai-integration-architecture)
  - [Authentication & Multi-tenant](#authentication--multi-tenant-architecture)
  - [File Upload & Storage](#file-upload--storage-architecture)
  - [Error Handling & Validation](#error-handling--validation-architecture)
- [Access Management](#access-management)
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

**AI Features:**
- **AIChat.tsx** - AI assistant chat interface

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
- **useUpdates.ts** - Update notifications

**Form & Input:**
- **useDocForm.ts** - Document form handling
- **useTableFilterSort.ts** - Table filtering and sorting
- **useDateSelection.ts** - Date picker state

**AI Features:**
- **useAIChat.ts** - AI chat conversation state

**Real-time:**
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

- **files.ts** - File upload and download
- **images.ts** - Image upload and processing
- **integrations.ts** - Third-party integration webhooks
- **query.ts** - AI query/search endpoints
- **turn.ts** - TURN server configuration for WebRTC
- **updates.ts** - Project update endpoints

#### Services (`server/services/`)
Business logic and core services:

- **query-service.ts** - AI-powered query and search logic
- **email.ts** - Email sending (Nodemailer)
- **pubsub-events.ts** - Google Pub/Sub event handling
- **data-pipeline.ts** - Data transformation and processing

#### Workers (`server/workers/`)
Background job processing:

- **deployment-worker.ts** - Deployment automation

#### Validation (`server/validation/`)
Zod schemas for request validation:

- **auth-schemas.ts** - Authentication request validation
- **doc-schemas.ts** - Document validation
- **task-schemas.ts** - Task validation
- **project-schemas.ts** - Project validation
- **user-schemas.ts** - User validation
- **org-schemas.ts** - Organization validation
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
- **cloud-sql-proxy.yaml** - Cloud SQL proxy for database access
- **serviceaccount.yaml** - Kubernetes service account
- **ingress.yaml** - Ingress routing configuration
- **backend-config.yaml** - Google Cloud backend configuration
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

---

## Access Management

### Overview

Leanworks Hub implements a comprehensive access management system that controls user permissions across different organizational scopes and resource types. The system supports fine-grained role-based access control (RBAC) with visibility levels for documents, tasks, and team resources.

### Permission Model

**Scope Levels (Hierarchical):**
```
Global (App Admin)
  └─ Organization (Admin, Member)
      └─ Team (Owner, Lead, Member)
          └─ Project (Owner, Member)
              └─ Resource (Owner, Editor, Viewer)
```

**Resource Types:**
- Documents (docs)
- Tasks
- Projects
- Teams
- Chat Conversations

### Role Hierarchy

| Role | Scope | Permissions |
|------|-------|-------------|
| **App Admin** | Global | Full system access, org management, user management |
| **Org Admin** | Organization | Manage teams, users, billing, integrations |
| **Org Member** | Organization | Create teams, projects, access shared resources |
| **Team Owner** | Team | Create projects, manage team members, delete team |
| **Team Lead** | Team | Create projects, manage team members (limited) |
| **Team Member** | Team | Create and edit own resources, collaborate |
| **Project Owner** | Project | Manage project members, configure project settings |
| **Project Member** | Project | Create and edit tasks, view project resources |
| **Document Owner** | Document | Full edit rights, sharing control, deletion |
| **Document Editor** | Document | View and edit content |
| **Document Viewer** | Document | View only, no edit rights |

### Visibility Controls

**Document Visibility:**
```
PRIVATE
  └─ Only owner and explicitly shared users
TEAM
  └─ All team members
ORGANIZATION
  └─ All organization members
PUBLIC
  └─ Anyone with link (if enabled)
```

**Task Visibility:**
```
PRIVATE
  └─ Assigned users only
PROJECT
  └─ Project members
TEAM
  └─ Team members
```

### Authentication & Authorization Flow

**Session Management:**
```
User Login
  ↓
Firebase authentication
  ↓
Backend creates JWT token with claims:
  ├─ userId
  ├─ email
  ├─ organizations[] (list of org IDs)
  └─ roles (per organization)
  ↓
Token stored in secure httpOnly cookie
  ↓
Frontend stores auth context
  ↓
All API requests include authorization header
  ↓
Backend middleware verifies token & permissions
```

**Permission Checks:**

1. **Authentication Check** - Verify user is logged in
2. **Organization Check** - Verify user belongs to organization
3. **Role Check** - Verify user has minimum required role
4. **Resource Check** - Verify user has access to specific resource
5. **Field-level Check** - Verify user can access specific fields

### Database Schema for Access Control

**Key Tables:**
```sql
-- Organization membership
org_members
  ├─ org_id
  ├─ user_id
  ├─ role (admin, member)
  └─ created_at

-- Team membership
team_members
  ├─ team_id
  ├─ user_id
  ├─ role (owner, lead, member)
  └─ joined_at

-- Document access control
doc_visibility
  ├─ doc_id
  ├─ visibility_type (private, team, organization, public)
  ├─ owner_id
  └─ shared_with[] (user IDs for private docs)

-- Task access control
task_assignees
  ├─ task_id
  ├─ user_id
  └─ role (owner, assignee)

-- Project membership
project_members
  ├─ project_id
  ├─ user_id
  ├─ role (owner, member)
  └─ joined_at
```

### Permission Implementation Details

**Backend Authorization Middleware:**

All protected routes use the authorization middleware stack:

```
Request
  ├─ validateToken() - Verify JWT signature and expiration
  ├─ checkOrgAccess() - Verify user belongs to organization
  ├─ checkResourceAccess() - Verify user can access resource
  ├─ checkPermission() - Verify user has required permission
  └─ Request proceeds to endpoint
```

**Frontend Permission Checks:**

Components conditionally render based on permissions:

```typescript
// Hide/disable UI elements based on user role
{canEdit && <EditButton />}
{canDelete && <DeleteButton />}
{isOwner && <ShareDialog />}

// Conditionally render pages
{userRole === 'admin' && <AdminPanel />}
{hasTeamAccess && <TeamResources />}
```

### Multi-tenant Isolation

**Org-level Isolation:**
```
Each organization has:
  ├─ Separate database schema or isolated connection pool
  ├─ All queries scoped to organization
  ├─ Separate file storage (GCS buckets or prefixes)
  └─ Isolated Pub/Sub topics for real-time updates
```

**Query Scoping Pattern:**
```sql
-- All queries include org context
SELECT * FROM tasks
WHERE organization_id = $1
  AND (
    -- User is owner
    owner_id = $2
    -- User is assignee
    OR assignee_id = $2
    -- Task is in user's team/project
    OR project_id IN (SELECT project_id FROM user_projects WHERE user_id = $2)
  )
```

### API Endpoint Permission Examples

**Documents Endpoint:**
```
GET /api/docs
  └─ Return only docs user can view
  
POST /api/docs
  └─ Require org_member role
  
PUT /api/docs/:id
  └─ Require doc owner or editor role
  
DELETE /api/docs/:id
  └─ Require doc owner role

POST /api/docs/:id/share
  └─ Require doc owner role
```

**Tasks Endpoint:**
```
GET /api/tasks
  └─ Return tasks user can access
  
POST /api/tasks
  └─ Require project_member role
  
PUT /api/tasks/:id
  └─ Require task owner or assignee role
  
DELETE /api/tasks/:id
  └─ Require task owner or project owner role
```

**Teams Endpoint:**
```
GET /api/teams/:id
  └─ Require team member role
  
POST /api/teams/:id/members
  └─ Require team owner or lead role
  
DELETE /api/teams/:id/members/:userId
  └─ Require team owner role
```

### Invitation & Access Grant System

**Invitation Flow:**
```
Admin/Owner creates invitation
  ↓
Generates unique token
  ↓
Sends email with link
  ↓
User clicks link
  ↓
Verifies token validity
  ↓
Creates membership record
  ↓
Grants access to resource
```

**Accepted Invitation:**
- User membership added to team/organization
- User receives notifications for relevant channels
- User can see shared resources immediately

### Audit Logging

**Permission Change Audit Trail:**
```
Events logged:
  ├─ User membership created/updated
  ├─ Role changes
  ├─ Resource sharing changes
  ├─ Access removal
  ├─ Failed permission checks
  └─ Sensitive operations (delete, export)

Audit log includes:
  ├─ Timestamp
  ├─ Actor (who made change)
  ├─ Action type
  ├─ Resource affected
  ├─ Before/after state
  └─ IP address
```

### Best Practices

**For Developers:**
1. Always check permissions in backend endpoints - never rely only on frontend checks
2. Use the permission middleware consistently across all protected routes
3. Scope all database queries to organization context
4. Log permission-related events for auditing
5. Validate user has permission before exposing sensitive data
6. Use principle of least privilege when granting roles
7. Implement role-based route guards in frontend

**For Security:**
1. Use JWT tokens with short expiration times (15-60 minutes)
2. Implement refresh token rotation
3. Invalidate tokens on logout
4. Never store sensitive data in JWT payload
5. Implement rate limiting on authentication endpoints
6. Monitor failed permission checks for suspicious patterns
7. Enforce strong passwords and 2FA for admin accounts
8. Regularly audit user permissions and remove inactive users

### Testing Permissions

**Test Cases to Cover:**
```
✓ User can access own resources
✓ User cannot access others' private resources
✓ User can access team/org resources based on membership
✓ Role elevation is prevented
✓ Permissions are revoked when membership ends
✓ Cross-org data leakage is prevented
✓ Expired tokens are rejected
✓ Invalid tokens are rejected
✓ Permission changes take effect immediately
✓ Audit logs capture all permission changes
```

---

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
npm run dev:stripe       # Stripe webhook listener
```

### Database

```bash
# Initialize database schema
npm run db:init

# Sync users from Teams
npm run sync:users

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

### System Requirements

**Document Processing:**
- LibreOffice must be installed and available in the system PATH for PowerPoint to PDF conversion
- Required for PPT/PPTX file processing

**Installation:**
```bash
# Ubuntu/Debian
sudo apt-get update && sudo apt-get install -y libreoffice

# macOS
brew install libreoffice

# Docker
# Add to Dockerfile:
RUN apt-get update && apt-get install -y libreoffice && rm -rf /var/lib/apt/lists/*
```

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
- **Task Management** - Create, assign, and track tasks with dependencies
- **AI Integration** - AI-powered queries and document assistance
- **Third-party Integrations** - Connect with Slack, GitHub, Linear, Atlassian, Notion, Outlook, and ClickUp
- **Multi-tenant** - Support for multiple organizations
- **Real-time Updates** - Live updates via Pub/Sub and WebSockets
- **Auto-save & Drafts** - Never lose work with auto-save and draft recovery
- **Analytics** - Track user engagement and usage patterns
- **Responsive Design** - Mobile-friendly interface

## License

Proprietary - Leanworks
