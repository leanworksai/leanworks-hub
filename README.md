# Leanworks Hub

A comprehensive team collaboration platform built with modern technologies. Leanworks Hub combines task management, document collaboration, team communication, and video conferencing into a unified workspace.

## Table of Contents

- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)
- [Main Components](#main-components)
- [Component Architecture Walkthroughs](#component-architecture-walkthroughs)
  - [Task Management](#task-management-architecture)
  - [Collaborative Document Editing](#collaborative-document-editing-architecture)
  - [Chat & Messaging](#chat--messaging-architecture)
  - [Video Conferencing](#video-conferencing-architecture)
  - [Calendar](#calendar-architecture)
  - [Voice Chat and Transcription](#voice-chat-and-transcription-architecture)
  - [AI Integration](#ai-integration-architecture)
  - [Authentication & Multi-tenant](#authentication--multi-tenant-architecture)
  - [File Upload & Storage](#file-upload--storage-architecture)
  - [Transcription Worker](#transcription-worker-architecture)
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

### Voice Chat and Transcription Architecture

**Files:** `src/components/VoiceCall.tsx`, `src/hooks/useLiveKit.ts`, `server/endpoints/livekit.ts`, `server/workers/transcription-worker.ts`, `server/services/audio-recorder.ts`

**Technology Stack:**
- **LiveKit** - WebRTC infrastructure for real-time audio/video
- **AssemblyAI** - AI-powered transcription service
- **Google Cloud Pub/Sub** - Asynchronous message queue
- **Google Cloud Storage** - Audio chunk storage
- **WebRTC MediaRecorder API** - Browser audio capture

**Voice Call Flow:**

```
User initiates call (1-on-1 or group)
  ↓
Frontend requests access token from /api/calls/token
  ↓
Backend generates LiveKit access token (time-limited JWT)
  ↓
Token includes room name, participant identity, permissions
  ↓
Frontend connects to LiveKit server with token
  ↓
WebRTC peer connections established
  ↓
Audio/video streams transmitted
  ↓
Browser records audio chunks (45 seconds each)
  ↓
Audio chunks published to Pub/Sub topic
  ↓
Transcription worker picks up chunks
  ↓
AssemblyAI transcribes each chunk
  ↓
Transcript stored in PostgreSQL
  ↓
Real-time notifications sent to participants
```

**Detailed Architecture:**

**1. Call Initiation:**

```typescript
// Frontend: src/components/VoiceCall.tsx
const handleStartCall = async () => {
  // Request token from backend
  const response = await fetch('/api/calls/token', {
    method: 'POST',
    body: JSON.stringify({
      roomName: 'chat-123-call',
      participantIdentity: 'john.doe@acme.com',
      participantName: 'John Doe'
    })
  });

  const { token, url } = await response.json();
  // token = JWT signed by LiveKit for accessing the room
  
  // Connect to LiveKit with token
  await startCall(roomName, token);
};
```

**2. Token Generation (Backend):**

```typescript
// server/endpoints/livekit.ts
app.post('/api/calls/token', async (req, res) => {
  const { roomName, participantIdentity, participantName } = req.body;

  // Fetch LiveKit credentials from Secret Manager
  const credentials = await getLiveKitCredentials(...);

  // Create access token (valid for 24 hours)
  const at = new AccessToken(credentials.apiKey, credentials.apiSecret, {
    identity: participantIdentity,
    name: participantName,
  });

  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });

  const token = await at.toJwt();
  
  res.json({
    token,
    url: 'wss://livekit.example.com' // LiveKit server URL
  });
});
```

**3. Audio Recording (Browser):**

```typescript
// Browser automatically records audio from MediaStream
// Uses MediaRecorder API to capture PCM audio

// Audio is recorded in chunks of 45 seconds
// Each chunk is resampled to 16kHz mono (AssemblyAI requirement)
// Stored with 300ms overlap (for continuity)

const audioContext = new AudioContext({ sampleRate: 16000 });
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const source = audioContext.createMediaStreamAudioSource(stream);

// Every 45 seconds:
const audioChunk = getRecordedAudio(); // Buffer from last 45s + 300ms overlap
await recordChunk(callId, participantEmail, audioChunk);
```

**4. Audio Chunk Publishing (Backend):**

```typescript
// server/services/audio-recorder.ts
export async function recordChunk(
  callId: string,
  participantEmail: string,
  audioBuffer: Buffer
): Promise<void> {
  // Upload chunk to Google Cloud Storage
  const filename = `calls/${callId}/${participantEmail}/${Date.now()}.pcm`;
  const bucketName = 'leanworks-audio-storage';
  
  await storage.bucket(bucketName).file(filename).save(audioBuffer);

  // Publish to Pub/Sub for async processing
  const message = {
    callId,
    participantEmail,
    storagePath: filename,
    duration: 45000, // milliseconds
    timestamp: new Date().toISOString(),
  };

  await pubsub.topic('audio-chunks-topic').publishJSON(message);
}
```

**5. Transcription Worker (Async Processing):**

```typescript
// server/workers/transcription-worker.ts
const subscription = pubsub.subscription('audio-chunks-subscription');

subscription.on('message', async (message) => {
  const { callId, participantEmail, storagePath } = message.json();

  try {
    // 1. Download audio chunk from GCS
    const audioBuffer = await storage
      .bucket('leanworks-audio-storage')
      .file(storagePath)
      .download();

    // 2. Detect and handle sample rate
    const actualSampleRate = detectActualSampleRate(audioBuffer);
    if (actualSampleRate === 48000) {
      // Resample 48kHz → 16kHz
      audioBuffer = resample48kHzTo16kHz(audioBuffer);
    }

    // 3. Convert PCM to WAV format (AssemblyAI requirement)
    const wavBuffer = pcmToWav(audioBuffer, 16000);

    // 4. Submit to AssemblyAI for transcription
    const config = {
      encoding: AudioEncoding.PCM_S16LE,
      sample_rate: 16000,
      language_code: 'en_US',
    };

    const transcript = await assemblyAI.transcripts.submit({
      audio_url: wavBuffer, // Or upload to temp storage
      config,
    });

    // 5. Poll for completion (AssemblyAI processes asynchronously)
    let finalTranscript;
    let retries = 0;
    while (transcript.status !== 'completed' && retries < 150) {
      await sleep(2000); // Poll every 2 seconds
      
      finalTranscript = await assemblyAI.transcripts.get(transcript.id);
      retries++;
    }

    // 6. Store transcription in PostgreSQL
    const orgPool = await getOrgPoolBySlug(orgSlug);
    
    await orgPool.query(`
      INSERT INTO call_transcripts (call_id, participant_email, chunk_index, text, confidence, duration)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (call_id, participant_email, chunk_index) DO UPDATE
      SET text = $4, confidence = $5
    `, [callId, participantEmail, chunkIndex, finalTranscript.text, finalTranscript.confidence, 45000]);

    // 7. Publish real-time update via Pub/Sub
    await pubsub.topic('transcription-updates').publishJSON({
      callId,
      participantEmail,
      transcript: finalTranscript.text,
      chunkIndex,
      timestamp: new Date().toISOString(),
    });

    // Mark message as acknowledged
    message.ack();

  } catch (error) {
    console.error('Transcription failed:', error);
    // Retry logic - Pub/Sub will requeue after deadline
    message.nack();
  }
});
```

**6. Call End and Transcript Compilation:**

```
Call ends (all participants leave)
  ↓
Wait for pending transcriptions (max 5 minutes)
  ↓
Fetch all chunks from PostgreSQL (ordered by chunk_index)
  ↓
Stitch transcripts together with speaker names
  ↓
Format as: "<strong>John Doe:</strong> Hello everyone..."
  ↓
Store final transcript in call document
  ↓
Notify participants of completion
```

**Data Model:**

```sql
-- Calls table (org-specific)
calls:
  - id (UUID)
  - room_name (LiveKit room identifier)
  - initiator_email
  - participants[] (list of emails)
  - started_at
  - ended_at
  - duration_seconds
  - recording_path (GCS path to final audio)
  - transcript_status ('pending', 'processing', 'completed', 'failed')
  - final_transcript (HTML formatted)

-- Call transcripts (org-specific, chunked storage)
call_transcripts:
  - call_id (FK to calls)
  - participant_email
  - chunk_index (0, 1, 2, ...)
  - text (transcript for this chunk)
  - confidence (0.0-1.0)
  - duration_ms (usually 45000)
  - transcribed_at

-- Call events (org-specific, for real-time updates)
call_events:
  - id
  - call_id (FK to calls)
  - event_type ('joined', 'left', 'muted', 'unmuted', 'transcript_chunk')
  - participant_email
  - data (JSON with event details)
  - timestamp
```

**Real-time Update Flow:**

```
Transcription completed for chunk
  ↓
Worker publishes to Pub/Sub: transcription-updates topic
  ↓
Backend receives message
  ↓
Stores in PostgreSQL call_transcripts table
  ↓
Broadcasts to connected WebSocket clients
  ↓
Frontend receives update
  ↓
Appends transcript chunk to call transcript UI in real-time
```

**Features:**

- **Speaker Attribution** - Tracks which participant's audio is being transcribed
- **Chunk Overlap** - 300ms overlap prevents cutting off words between chunks
- **Error Recovery** - Failed chunks are automatically retried via Pub/Sub
- **Sample Rate Detection** - Automatically detects and resamples 48kHz → 16kHz
- **Confidence Scoring** - AssemblyAI provides confidence for each transcription
- **Real-time Display** - Transcripts appear as they're processed (not waiting for call end)
- **Call Recording** - Full audio stored in GCS for archival
- **Multi-participant** - Separate transcript streams per participant

**Performance Optimizations:**

- **Asynchronous Processing** - Transcription happens in background workers
- **Chunking** - 45-second chunks instead of full-call batching (faster first results)
- **Parallelization** - Multiple chunks transcribed concurrently (up to 32 AssemblyAI jobs)
- **Pub/Sub Queueing** - Automatic retry with backoff on failures
- **GCS Storage** - Chunks stored separately for durability

**Error Handling:**

```
❌ Audio chunk too large
  → Skip chunk, publish error event, continue

❌ AssemblyAI API timeout
  → Pub/Sub retries up to max attempts, then marks as failed

❌ Sample rate mismatch
  → Auto-detect and resample (transparent to user)

❌ Call ends before transcription complete
  → Store in pendingSummaries, compile when all chunks done
```

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
- Calendar Events
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
