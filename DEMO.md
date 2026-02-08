# Demo Mode Guide

Run the Leanworks Hub application locally without any external dependencies or cloud infrastructure.

## Quick Start

```bash
npm run dev:demo
```

Then open [http://localhost:8081](http://localhost:8081) in your browser.

The app will automatically log you in as `demo@example.com` with full access to all features and demo data.

## What is Demo Mode?

Demo mode is a completely self-contained environment that includes:

- **Mock Express Server** - Running on port 3001 with all API endpoints
- **In-Memory Data** - Pre-populated with realistic sample data
- **Mock Authentication** - Auto-login with demo user (no Firebase needed)
- **Mock External Services** - Stripe, Twilio, Firebase Storage, integrations
- **Vite Dev Server** - Hot module replacement on port 8081

## Features

✅ **No External Dependencies** - No database, no Firebase, no external APIs  
✅ **Auto-Login** - Instantly access the app as demo@example.com  
✅ **Pre-Populated Data** - Full demo data with projects, tasks, plans, AI agents  
✅ **Realistic Experience** - Mock latency for realistic feel  
✅ **Session Persistence** - Changes persist during the session  
✅ **Demo Banner** - Clear indicator in the UI that you're in demo mode  

## Demo Data Included

### Users (5 total)
- Demo User (PM) - demo@example.com (auto-logged in)
- Sarah Chen (Engineering Lead) - sarah@example.com
- Alex Rodriguez (Senior Developer) - alex@example.com
- Jessica Murphy (UI/UX Designer) - jessica@example.com
- Marcus Thompson (DevOps Engineer) - marcus@example.com

### Organization
- **Acme Corporation** - Organization with all 5 users

### Projects (5 total)
1. **Platform Modernization** (Active) - Microservices migration
2. **Mobile App Launch** (Planning) - iOS and Android native apps
3. **AI Features Integration** (Active) - AI-powered features
4. **Design System Refresh** (Active) - UI components and design tokens
5. **Infrastructure Upgrade** (Completed) - Kubernetes and CI/CD improvements

### Tasks (16 total)
- Distributed across projects
- Various statuses: todo, in-progress, review, completed, blocked
- Different priorities and assignees
- Includes AI agent assignments

### Plans (3 total)
1. **Q1 2026 Product Initiative** (Active) - $250K budget
2. **Platform Modernization & Scaling** (Active) - $400K budget
3. **AI & Automation Features** (Planning) - $350K budget

Each plan includes:
- Objectives with target values and current progress
- Budget categories and resource allocations
- Milestones and activity events

### AI Agents (5 total)
1. **ML Trainer Agent** - Trains machine learning models
2. **Code Review Bot** - Performs automated code reviews
3. **Documentation Generator** - Auto-generates documentation
4. **Performance Optimizer** - Analyzes and optimizes performance
5. **Data Analyst** - Analyzes project data and generates insights

### Documents (8 total)
- Product roadmap
- Architecture documentation
- Meeting notes
- Budget report
- Design system guidelines
- Engineering best practices

### Integrations (8 total)
- Slack (connected)
- Jira (connected)
- Linear (connected)
- GitHub, Notion, Outlook, ClickUp, Workday (available to connect)

## Limitations

⚠️ **Session-Only Data** - Changes reset when the server restarts  
⚠️ **No File Uploads** - File operations are mocked  
⚠️ **No Real AI** - AI responses are simulated/templated  
⚠️ **No Email** - Email notifications are mocked  
⚠️ **No Database** - All data exists in memory only  

## Available Endpoints

The mock server provides all core endpoints:

### User & Auth
- `GET /api/user/profile` - Get current user profile
- `GET /api/users` - List all users
- `GET /api/users/:email` - Get user by email

### Organization
- `GET /api/organizations` - List organizations
- `GET /api/organizations/:orgId` - Get organization details
- `GET /api/organizations/:orgId/members` - Get org members

### Projects
- `GET /api/projects` - List projects (supports filters)
- `GET /api/projects/:projectId` - Get project details
- `POST /api/projects` - Create project
- `PUT /api/projects/:projectId` - Update project
- `DELETE /api/projects/:projectId` - Delete project

### Tasks
- `GET /api/tasks` - List tasks (supports filters)
- `GET /api/tasks/:taskId` - Get task details
- `POST /api/tasks` - Create task
- `PUT /api/tasks/:taskId` - Update task
- `DELETE /api/tasks/:taskId` - Delete task

### Plans
- `GET /api/plans` - List plans
- `GET /api/plans/:planId` - Get plan with nested data
- `POST /api/plans` - Create plan
- `PUT /api/plans/:planId` - Update plan
- `DELETE /api/plans/:planId` - Delete plan

### AI Agents
- `GET /api/ai-agents` - List AI agents
- `GET /api/ai-agents/:agentId` - Get agent details
- `GET /api/ai-agent-teams` - List agent teams

### Documents
- `GET /api/docs` - List documents
- `GET /api/docs/:docId` - Get document details

### Integrations
- `GET /api/integrations` - List integrations
- `POST /api/integrations/:integrationId/connect` - Connect integration
- `POST /api/integrations/:integrationId/disconnect` - Disconnect integration

### AI Services (Mocked)
- `POST /api/ask` - Chat with AI assistant
- `POST /api/plans/generate-resource-plan` - Generate resource plan
- `POST /api/plans/generate-insights` - Generate plan insights

## Testing Features

Here are some recommended features to test in demo mode:

### Dashboard & Navigation
- View the home page with demo data
- Navigate between different sections
- Check the demo banner at the top

### Projects
- Browse the 5 demo projects
- Filter by status or search
- Click into project details
- View project members and comments

### Tasks
- Browse 16 demo tasks
- Filter by project, status, assignee
- Check task details with comments
- See AI agent assignments

### Plans
- Browse 3 demo plans
- View plan details with objectives, budget, resources
- Check milestones and activity timeline
- See different plan statuses (active, planning, completed)

### AI Agents
- View list of 5 demo AI agents
- Check agent details and activity logs
- See task assignments with results and logs

### Documents
- Browse documents with folder structure
- View different document types
- Check linked documents

### CRUD Operations
- Create new projects/tasks/plans
- Update existing records
- Delete records
- Changes persist during the session

## Troubleshooting

### Demo server not starting
```bash
# Make sure port 3001 is available
lsof -i :3001

# If in use, kill the process or use a different port
```

### Vite dev server not starting
```bash
# Make sure port 8081 is available
lsof -i :8081

# Check for conflicts with other dev servers
```

### CORS or network errors
- Verify both servers are running (mock server on 3001, Vite on 8081)
- Check browser console for specific error messages
- Clear browser cache and hard refresh

### Changes not persisting
- In-memory data only persists during the current session
- Restart the server with `npm run dev:demo` to reset data

## Switching from Demo to Production

To use the real app with cloud infrastructure:

```bash
# Stop demo mode
Ctrl+C

# Run the normal development environment
npm run dev
```

This will connect to Firebase, your PostgreSQL database, and other external services.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  React App (port 8081)                               │  │
│  │  - Auto-login as demo@example.com                    │  │
│  │  - Demo banner at top                                │  │
│  │  - Mock Firebase Auth                                │  │
│  └──────────────────────────────────────────────────────┘  │
│             ↓ (HTTP Requests)                               │
└─────────────────────────────────────────────────────────────┘
                        ↓
        ┌───────────────────────────────┐
        │  Express Mock Server (3001)   │
        │  ┌─────────────────────────┐  │
        │  │  API Endpoints (REST)   │  │
        │  ├─────────────────────────┤  │
        │  │  In-Memory Mock Data:   │  │
        │  │  - Users                │  │
        │  │  - Projects             │  │
        │  │  - Tasks                │  │
        │  │  - Plans                │  │
        │  │  - AI Agents            │  │
        │  │  - Documents            │  │
        │  │  - Integrations         │  │
        │  │  - etc.                 │  │
        │  └─────────────────────────┘  │
        └───────────────────────────────┘
```

## Performance

Mock server provides realistic experience:
- Simulated API latency (50-200ms per request)
- In-memory data operations (fast)
- No network bottlenecks
- Responsive UI interactions

## Support

For issues or questions about demo mode:
1. Check that both servers are running
2. Verify ports 3001 and 8081 are available
3. Clear browser cache and hard refresh
4. Check browser console for error messages
5. Restart with fresh `npm run dev:demo`
