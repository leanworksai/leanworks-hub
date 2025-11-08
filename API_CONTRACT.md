# Leanworks Hub API Contract

## Base Information

- **Base URL**: `http://localhost:3001` (development)
- **Content-Type**: `application/json`
- **Authentication**: Bearer token in `Authorization` header
- **Database**: Firestore (project: `leanworks-test`)
- **Data Isolation**: All data is domain-based (isolated by user email domain)

## Authentication

All authenticated endpoints require a Bearer token in the Authorization header:

```
Authorization: Bearer <token>
```

The token can be either:
- Firebase ID token (from Firebase Auth)
- Custom token (from `/api/auth/login`)

---

## Authentication APIs

### POST /api/auth/signup

Create a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "firstName": "John",
  "lastName": "Doe",
  "jobTitle": "Software Engineer",
  "responsibilities": "Frontend development" // optional
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Account created successfully!",
  "userId": "firebase-uid-here"
}
```

**Error Responses:**
- `400` - Missing required fields
- `403` - Email not whitelisted
- `400` - Account already exists

---

### POST /api/auth/login

Login and receive a custom token.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "customToken": "firebase-custom-token-jwt",
  "user": {
    "uid": "firebase-uid",
    "email": "user@example.com",
    "emailVerified": true
  }
}
```

**Error Responses:**
- `400` - Missing email or password
- `401` - Invalid email or password
- `500` - Server error

---

## User APIs

### GET /api/users/profile

Get the current authenticated user's profile.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "jobTitle": "Software Engineer",
  "responsibilities": "Frontend development",
  "domain": "example.com",
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

**Error Responses:**
- `401` - Unauthorized
- `404` - User profile not found
- `500` - Server error

---

### GET /api/users

Get all users in the domain.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
[
  {
    "email": "user1@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "jobTitle": "Software Engineer",
    "responsibilities": "Frontend development",
    "domain": "example.com",
    "createdAt": "2024-01-15T10:30:00.000Z"
  },
  {
    "email": "user2@example.com",
    "firstName": "Jane",
    "lastName": "Smith",
    "jobTitle": "Product Manager",
    "domain": "example.com",
    "createdAt": "2024-01-16T11:00:00.000Z"
  }
]
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

## Projects APIs

### GET /api/projects

Get all projects in the domain.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
[
  {
    "name": "Mobile App Redesign",
    "description": "Complete overhaul of the mobile experience",
    "detailedDescription": "Detailed project description...",
    "status": "In Progress",
    "team": 8,
    "dueDate": "2024-12-15",
    "createdDate": "2024-10-01",
    "statusColor": "bg-blue-500",
    "members": [
      {
        "id": "1",
        "name": "Sarah Chen",
        "role": "Lead Designer",
        "avatar": "SC"
      }
    ],
    "tasks": [
      {
        "id": "1",
        "title": "Complete wireframes",
        "status": "completed",
        "assignee": "Sarah Chen",
        "dueDate": "2024-11-01"
      }
    ],
    "progressUpdates": [
      {
        "id": "1",
        "memberName": "Sarah Chen",
        "memberAvatar": "SC",
        "date": "2024-11-10",
        "update": "Completed the final design mockups..."
      }
    ],
    "comments": [
      {
        "id": "comment-1",
        "memberName": "Lisa Anderson",
        "memberAvatar": "LA",
        "date": "2024-11-11",
        "comment": "Great progress!"
      }
    ],
    "summary": {
      "accomplishment": "Completed user flow redesign",
      "decision": "Decided to adopt React Native",
      "risk": "Timeline might slip",
      "direction": "Moving towards beta testing"
    },
    "createdAt": 1696118400000
  }
]
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### GET /api/projects/:name

Get a specific project by name.

**Parameters:**
- `name` (path) - Project name

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "name": "Mobile App Redesign",
  "description": "Complete overhaul of the mobile experience",
  "detailedDescription": "Detailed project description...",
  "status": "In Progress",
  "team": 8,
  "dueDate": "2024-12-15",
  "createdDate": "2024-10-01",
  "statusColor": "bg-blue-500",
  "members": [...],
  "tasks": [...],
  "progressUpdates": [...],
  "comments": [...],
  "summary": {...},
  "createdAt": 1696118400000
}
```

**Error Responses:**
- `401` - Unauthorized
- `404` - Project not found
- `500` - Server error

---

### POST /api/projects

Create a new project.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "name": "New Project",
  "description": "Project description",
  "detailedDescription": "Detailed description...",
  "status": "In Progress",
  "team": 5,
  "dueDate": "2024-12-31",
  "createdDate": "2024-11-01",
  "statusColor": "bg-blue-500",
  "members": [
    {
      "id": "1",
      "name": "John Doe",
      "role": "Developer",
      "avatar": "JD"
    }
  ],
  "tasks": [],
  "progressUpdates": [],
  "comments": [],
  "summary": {
    "accomplishment": "",
    "decision": "",
    "risk": "",
    "direction": ""
  }
}
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### PATCH /api/projects/:name

Update a project.

**Parameters:**
- `name` (path) - Project name

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "status": "Completed",
  "statusColor": "bg-green-500"
}
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### DELETE /api/projects/:name

Delete a project.

**Parameters:**
- `name` (path) - Project name

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

## Tasks APIs

### GET /api/tasks

Get all tasks in the domain.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
[
  {
    "id": "task-1",
    "title": "Implement new navigation system",
    "description": "Design and implement a new navigation system...",
    "status": "in-progress",
    "priority": "high",
    "assignee": "Mike Johnson",
    "assigneeAvatar": "MJ",
    "project": "Mobile App Redesign",
    "projectId": "mobile-app-redesign",
    "teams": [],
    "createdBy": "user@example.com",
    "dueDate": "2024-11-20",
    "createdDate": "2024-10-15",
    "createdAt": 1696118400000,
    "estimatedHours": 40,
    "actualHours": 28,
    "tags": ["frontend", "mobile", "navigation"],
    "progressUpdates": [
      {
        "id": "update-1",
        "memberName": "Mike Johnson",
        "memberAvatar": "MJ",
        "date": "2024-11-10",
        "type": "progress",
        "update": "Navigation structure is 70% complete..."
      }
    ],
    "comments": [
      {
        "id": "comment-1",
        "memberName": "Sarah Chen",
        "memberAvatar": "SC",
        "date": "2024-11-11",
        "comment": "Great progress!"
      }
    ]
  }
]
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### GET /api/tasks/:id

Get a specific task by ID.

**Parameters:**
- `id` (path) - Task ID

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "id": "task-1",
  "title": "Implement new navigation system",
  "description": "Design and implement a new navigation system...",
  "status": "in-progress",
  "priority": "high",
  "assignee": "Mike Johnson",
  "assigneeAvatar": "MJ",
  "project": "Mobile App Redesign",
  "projectId": "mobile-app-redesign",
  "teams": [],
  "createdBy": "user@example.com",
  "dueDate": "2024-11-20",
  "createdDate": "2024-10-15",
  "createdAt": 1696118400000,
  "estimatedHours": 40,
  "actualHours": 28,
  "tags": ["frontend", "mobile", "navigation"],
  "progressUpdates": [...],
  "comments": [...]
}
```

**Error Responses:**
- `401` - Unauthorized
- `404` - Task not found
- `500` - Server error

---

### GET /api/tasks/project/:projectId

Get all tasks for a specific project.

**Parameters:**
- `projectId` (path) - Project ID

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
[
  {
    "id": "task-1",
    "title": "Implement new navigation system",
    "description": "...",
    "status": "in-progress",
    "priority": "high",
    "projectId": "mobile-app-redesign",
    ...
  }
]
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### POST /api/tasks

Create a new task.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "id": "task-123",
  "title": "New Task",
  "description": "Task description",
  "status": "todo",
  "priority": "medium",
  "assignee": "John Doe",
  "assigneeAvatar": "JD",
  "project": "Project Name",
  "projectId": "project-id",
  "teams": [],
  "createdBy": "user@example.com",
  "dueDate": "2024-12-31",
  "createdDate": "2024-11-01",
  "createdAt": 1696118400000,
  "estimatedHours": 20,
  "tags": ["tag1", "tag2"],
  "progressUpdates": [],
  "comments": []
}
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### PATCH /api/tasks/:id

Update a task.

**Parameters:**
- `id` (path) - Task ID

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "status": "completed",
  "actualHours": 30
}
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### DELETE /api/tasks/:id

Delete a task.

**Parameters:**
- `id` (path) - Task ID

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

## Teams APIs

### GET /api/teams

Get all teams in the domain.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
[
  {
    "name": "Engineering",
    "members": 24,
    "projects": 8,
    "avatar": "E",
    "description": "Core development team",
    "ownerEmail": "owner@example.com"
  },
  {
    "name": "Design",
    "members": 12,
    "projects": 5,
    "avatar": "D",
    "description": "UI/UX and product design",
    "ownerEmail": "owner@example.com"
  }
]
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### GET /api/teams/:name

Get a specific team by name.

**Parameters:**
- `name` (path) - Team name

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "name": "Engineering",
  "description": "Core development team",
  "avatar": "E",
  "members": [
    {
      "name": "Sarah Johnson",
      "role": "Team Lead",
      "email": "sarah@example.com",
      "avatar": "SJ"
    },
    {
      "name": "Michael Chen",
      "role": "Senior Developer",
      "email": "michael@example.com",
      "avatar": "MC"
    }
  ],
  "ownerEmail": "owner@example.com"
}
```

**Error Responses:**
- `401` - Unauthorized
- `404` - Team not found
- `500` - Server error

---

### POST /api/teams

Create a new team.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "team": {
    "name": "New Team",
    "members": 0,
    "projects": 0,
    "avatar": "NT",
    "description": "Team description"
  },
  "teamDetail": {
    "name": "New Team",
    "description": "Team description",
    "avatar": "NT",
    "members": [
      {
        "name": "John Doe",
        "role": "Team Lead",
        "email": "john@example.com",
        "avatar": "JD"
      }
    ]
  }
}
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Note:** The `ownerEmail` is automatically set to the authenticated user's email.

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### PATCH /api/teams/:name

Update a team.

**Parameters:**
- `name` (path) - Team name

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "description": "Updated description",
  "members": 5
}
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### PATCH /api/teams/:name/detail

Update team details (members, etc.).

**Parameters:**
- `name` (path) - Team name

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "members": [
    {
      "name": "John Doe",
      "role": "Developer",
      "email": "john@example.com",
      "avatar": "JD"
    }
  ]
}
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### DELETE /api/teams/:name

Delete a team.

**Parameters:**
- `name` (path) - Team name

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### POST /api/teams/:teamName/join-request

Request to join a team.

**Parameters:**
- `teamName` (path) - Team name

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:** (empty)

**Response (200 OK):**
```json
{
  "success": true,
  "requestId": "request-id-123",
  "message": "Join request sent successfully"
}
```

**Error Responses:**
- `400` - Already a member or pending request exists
- `401` - Unauthorized
- `404` - Team not found
- `500` - Server error

---

### GET /api/teams/join-requests

Get pending join requests for teams owned by the authenticated user.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
[
  {
    "id": "request-id-123",
    "teamName": "Engineering",
    "userEmail": "newuser@example.com",
    "userName": "New User",
    "status": "pending",
    "ownerEmail": "owner@example.com",
    "createdAt": "2024-11-15T10:30:00.000Z"
  }
]
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### POST /api/teams/join-requests/:requestId/approve

Approve a join request. Only team owners can approve.

**Parameters:**
- `requestId` (path) - Join request ID

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:** (empty)

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Join request approved successfully"
}
```

**Error Responses:**
- `400` - Request already processed or user already a member
- `401` - Unauthorized
- `403` - Only team owner can approve
- `404` - Join request or team not found
- `500` - Server error

---

### POST /api/teams/join-requests/:requestId/reject

Reject a join request. Only team owners can reject.

**Parameters:**
- `requestId` (path) - Join request ID

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:** (empty)

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Join request rejected"
}
```

**Error Responses:**
- `400` - Request already processed
- `401` - Unauthorized
- `403` - Only team owner can reject
- `404` - Join request not found
- `500` - Server error

---

### DELETE /api/teams/:name/members/:memberEmail

Remove a member from a team. Only team owners can remove members.

**Parameters:**
- `name` (path) - Team name
- `memberEmail` (path) - Member email (URL encoded)

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Member removed successfully"
}
```

**Error Responses:**
- `400` - Cannot remove team owner
- `401` - Unauthorized
- `403` - Only team owner can remove members
- `404` - Team or member not found
- `500` - Server error

---

### DELETE /api/teams/:name/leave

Leave a team. Members can leave, but owners cannot.

**Parameters:**
- `name` (path) - Team name

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Left team successfully"
}
```

**Error Responses:**
- `400` - Team owner cannot leave (must transfer ownership or delete team) or not a member
- `401` - Unauthorized
- `404` - Team not found
- `500` - Server error

---

### POST /api/teams/migrate-owners

Migration endpoint to backfill `ownerEmail` for teams. This is a utility endpoint.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:** (empty)

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Migration completed. Updated: 5, Skipped: 2, Errors: 0",
  "results": {
    "updated": ["Team1", "Team2"],
    "skipped": ["Team3"],
    "errors": []
  }
}
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

## Integrations APIs

### GET /api/integrations

Get all integrations and their connection status.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
[
  {
    "id": "slack",
    "name": "Slack",
    "connected": true,
    "connectedAt": "2024-11-15T10:30:00.000Z"
  },
  {
    "id": "atlassian",
    "name": "Atlassian",
    "connected": false,
    "connectedAt": null
  },
  {
    "id": "github",
    "name": "GitHub",
    "connected": false,
    "connectedAt": null
  }
]
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### POST /api/integrations/slack/connect

Connect Slack integration. Credentials are stored in GCP Secret Manager.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "botToken": "xoxb-your-slack-bot-token"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Slack connected successfully"
}
```

**Error Responses:**
- `400` - Bot token is required
- `401` - Unauthorized
- `500` - Server error

---

### POST /api/integrations/atlassian/connect

Connect Atlassian integration. Credentials are stored in GCP Secret Manager.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password",
  "apiToken": "atlassian-api-token"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Atlassian connected successfully"
}
```

**Error Responses:**
- `400` - Email, password, and API token are required
- `401` - Unauthorized
- `500` - Server error

---

### POST /api/integrations/:integrationId/disconnect

Disconnect an integration.

**Parameters:**
- `integrationId` (path) - Integration ID (`slack`, `atlassian`, or `github`)

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:** (empty)

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Integration disconnected successfully"
}
```

**Error Responses:**
- `400` - Invalid integration ID
- `401` - Unauthorized
- `500` - Server error

---

## Common Error Responses

All endpoints may return these common error responses:

### 401 Unauthorized
```json
{
  "error": "Unauthorized: No token provided"
}
```
or
```json
{
  "error": "Unauthorized: Invalid token"
}
```

### 500 Internal Server Error
```json
{
  "error": "Error message here"
}
```

---

## Data Types

### Status Values

**Task Status:**
- `"todo"`
- `"in-progress"`
- `"review"`
- `"completed"`
- `"blocked"`

**Task Priority:**
- `"low"`
- `"medium"`
- `"high"`
- `"urgent"`

**Join Request Status:**
- `"pending"`
- `"approved"`
- `"rejected"`

### Timestamps

- `createdAt` - Timestamp in milliseconds (number)
- `createdDate` - Date string in format `YYYY-MM-DD`
- `dueDate` - Date string in format `YYYY-MM-DD`
- `connectedAt` - ISO 8601 date string

---

## Notes

1. **Domain Isolation**: All data is automatically isolated by the user's email domain. Users from different domains cannot see each other's data.

2. **Email Whitelist**: Signup and login are restricted to whitelisted email addresses. Contact your administrator to add emails to the whitelist.

3. **Team Ownership**: Team owners have special permissions:
   - Can approve/reject join requests
   - Can remove members
   - Cannot leave the team (must transfer ownership or delete team)

4. **Secret Storage**: Integration credentials (Slack, Atlassian) are stored securely in GCP Secret Manager, not in Firestore.

5. **Firestore Timestamps**: Timestamps are automatically converted to appropriate formats (milliseconds for `createdAt`, ISO strings for dates).

