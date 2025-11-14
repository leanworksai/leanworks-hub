# Leanworks Hub API Contract

## Base Information

- **Content-Type**: `application/json`
- **Authentication**: Bearer token in `Authorization` header
- **Database**: Firestore (project: `leanworks-prod`)
- **Data Isolation**: All data is domain-based (isolated by user email domain)

## API Access Methods

The APIs can be accessed in different ways depending on your context:

### External Access (Production/Deployed)

When accessing the APIs from outside the Kubernetes cluster or from external clients:

- **Base URL**: `https://<your-domain.com>/api` or `http://<external-ip>/api`
- **Port**: 80 (HTTP) or 443 (HTTPS)
- **Access**: Through nginx reverse proxy
- **Example**: 
  ```
  GET https://leanworks-hub.example.com/api/projects
  POST https://leanworks-hub.example.com/api/auth/login
  ```

**Note**: The external IP can be obtained by running:
```bash
kubectl get service leanworks-hub-service
```

### Internal Access (Within Container/Pod)

When accessing from within the same container or pod (e.g., from the frontend application):

- **Base URL**: `http://localhost:3001/api` or `/api` (relative path)
- **Port**: 3001 (direct backend access) or 80 (via nginx)
- **Access**: Direct to Express server or through nginx proxy
- **Example**:
  ```
  GET http://localhost:3001/api/projects
  POST /api/auth/login  (relative path, proxied by nginx)
  ```

**Note**: In production, the frontend typically uses relative paths (`/api/*`) which are automatically proxied by nginx to the backend server.

### Internal Kubernetes Access (Service-to-Service)

When accessing from other pods/services within the Kubernetes cluster:

- **Base URL**: `http://leanworks-hub-service.default.svc.cluster.local/api` or `http://leanworks-hub-service/api`
- **Port**: 80
- **Access**: Through Kubernetes service DNS
- **Example**:
  ```
  GET http://leanworks-hub-service/api/projects
  ```

### Local Development

When running locally for development:

- **Backend Direct**: `http://localhost:3001/api`
- **Frontend Dev Server**: `http://localhost:8080` (Vite dev server)
- **Note**: In development, you may need to configure the frontend to proxy API requests to `http://localhost:3001`

## Authentication

All authenticated endpoints require a Bearer token in the Authorization header:

```
Authorization: Bearer <token>
```

The token can be either:
- Firebase ID token (from Firebase Auth)
- Custom token (from `/api/auth/login`)

---

## How to Get a Bearer Token

There are two ways to obtain a bearer token for API authentication:

### Method 1: Login Endpoint (Recommended)

The primary method is to use the `/api/auth/login` endpoint, which returns a custom token that can be used directly as a bearer token.

#### Step 1: Call the Login Endpoint

**Request:**
```bash
curl -X POST "https://your-domain.com/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "your-password"
  }'
```

**Response:**
```json
{
  "success": true,
  "customToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "uid": "firebase-uid-123",
    "email": "user@example.com",
    "emailVerified": true
  }
}
```

#### Step 2: Use the Custom Token

The `customToken` from the response is your bearer token. Use it in subsequent API requests:

```bash
curl -X GET "https://your-domain.com/api/projects" \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json"
```

#### Complete Example (JavaScript/TypeScript)

```typescript
// Step 1: Login and get token
async function login(email: string, password: string) {
  const response = await fetch('https://your-domain.com/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  
  if (!response.ok) {
    throw new Error('Login failed');
  }
  
  const data = await response.json();
  return data.customToken; // This is your bearer token
}

// Step 2: Use the token for authenticated requests
async function getProjects(token: string) {
  const response = await fetch('https://your-domain.com/api/projects', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  
  return response.json();
}

// Usage
const token = await login('user@example.com', 'password123');
const projects = await getProjects(token);
```

#### Complete Example (Python)

```python
import requests

API_BASE = "https://your-domain.com/api"

# Step 1: Login and get token
def login(email: str, password: str) -> str:
    response = requests.post(
        f"{API_BASE}/auth/login",
        json={"email": email, "password": password}
    )
    response.raise_for_status()
    data = response.json()
    return data["customToken"]  # This is your bearer token

# Step 2: Use the token for authenticated requests
def get_projects(token: str):
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    response = requests.get(f"{API_BASE}/projects", headers=headers)
    response.raise_for_status()
    return response.json()

# Usage
token = login("user@example.com", "password123")
projects = get_projects(token)
```

#### Complete Example (cURL)

```bash
# Step 1: Login and save token
TOKEN=$(curl -s -X POST "https://your-domain.com/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }' | jq -r '.customToken')

# Step 2: Use token for authenticated requests
curl -X GET "https://your-domain.com/api/projects" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

### Method 2: Firebase ID Token (Alternative)

If you're using Firebase Auth in your application, you can also use Firebase ID tokens:

```typescript
import { auth } from 'firebase/auth';

// Get Firebase ID token
const user = auth.currentUser;
if (user) {
  const idToken = await user.getIdToken();
  
  // Use as bearer token
  const response = await fetch('https://your-domain.com/api/projects', {
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
  });
}
```

**Note:** The backend accepts both custom tokens (from login) and Firebase ID tokens. Custom tokens are simpler for API-only clients.

---

## Token Storage and Management

### Frontend Applications

In frontend applications, tokens are typically stored securely:

1. **In Memory**: Store token in a variable during the session
2. **localStorage**: Persist token across page refreshes (less secure)
3. **Session Storage**: Store token for the browser session only
4. **HttpOnly Cookies**: Most secure (requires server-side setup)

**Example (localStorage):**
```typescript
// After login
const { customToken } = await login(email, password);
localStorage.setItem('auth_token', customToken);

// For subsequent requests
const token = localStorage.getItem('auth_token');
```

### Backend/Server Applications

For server-side applications:

1. Store tokens securely (environment variables, secret managers)
2. Implement token refresh logic
3. Never log or expose tokens

**Example:**
```python
import os
from google.cloud import secretmanager

# Store token securely
def store_token(token):
    # Use secret manager or environment variable
    os.environ['API_TOKEN'] = token

# Retrieve token
def get_token():
    return os.environ.get('API_TOKEN')
```

---

## Token Expiration and Refresh

**Custom Tokens**: Custom tokens from `/api/auth/login` are JWT tokens that don't expire automatically. However, for security:

1. **Re-authenticate periodically**: Call login again to get a fresh token
2. **Handle 401 errors**: If you receive a 401 Unauthorized, the token may be invalid - re-authenticate
3. **Token refresh**: Implement logic to refresh tokens before they expire

**Example Error Handling:**
```typescript
async function authenticatedRequest(url: string, token: string) {
  let response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  
  // If unauthorized, token may be expired - re-authenticate
  if (response.status === 401) {
    // Re-login to get new token
    const newToken = await login(email, password);
    // Retry request with new token
    response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${newToken}`,
        'Content-Type': 'application/json',
      },
    });
  }
  
  return response;
}
```

---

## Example Request with Bearer Token

**Example Request:**
```bash
curl -X GET "https://your-domain.com/api/projects" \
  -H "Authorization: Bearer your-token-here" \
  -H "Content-Type: application/json"
```

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
  "assigneeId": "mike.johnson@example.com",
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
  "assigneeId": "john.doe@example.com",
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

---

## API Calling Examples

### External Access Examples

#### Using cURL (External)
```bash
# Login
curl -X POST "https://leanworks-hub.example.com/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'

# Get projects (with token)
curl -X GET "https://leanworks-hub.example.com/api/projects" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json"

# Create a project
curl -X POST "https://leanworks-hub.example.com/api/projects" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Project",
    "description": "Project description",
    "status": "In Progress"
  }'
```

#### Using JavaScript/TypeScript (External)
```typescript
// External API client
const API_BASE_URL = 'https://leanworks-hub.example.com/api';

async function login(email: string, password: string) {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  return response.json();
}

async function getProjects(token: string) {
  const response = await fetch(`${API_BASE_URL}/projects`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  return response.json();
}
```

#### Using Python (External)
```python
import requests

API_BASE_URL = "https://leanworks-hub.example.com/api"

# Login
response = requests.post(
    f"{API_BASE_URL}/auth/login",
    json={
        "email": "user@example.com",
        "password": "password123"
    }
)
token = response.json()["customToken"]

# Get projects
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}
projects = requests.get(f"{API_BASE_URL}/projects", headers=headers)
print(projects.json())
```

### Internal Access Examples (Frontend Application)

#### Using JavaScript/TypeScript (Internal - Relative Paths)
```typescript
// Internal API client (from frontend app)
// Uses relative paths - automatically proxied by nginx
const API_BASE_URL = '/api';  // Relative path

async function login(email: string, password: string) {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  return response.json();
}

async function getProjects(token: string) {
  const response = await fetch(`${API_BASE_URL}/projects`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  return response.json();
}
```

#### Using cURL (Internal - Direct Backend)
```bash
# From within the container/pod
# Direct access to backend (bypassing nginx)
curl -X GET "http://localhost:3001/api/projects" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json"

# Or through nginx proxy
curl -X GET "http://localhost/api/projects" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json"
```

### Kubernetes Service-to-Service Examples

#### Using cURL (Kubernetes Internal)
```bash
# From another pod in the same cluster
curl -X GET "http://leanworks-hub-service/api/projects" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json"

# With full DNS name
curl -X GET "http://leanworks-hub-service.default.svc.cluster.local/api/projects" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json"
```

#### Using Python (Kubernetes Internal)
```python
import requests
import os

# Kubernetes service DNS
API_BASE_URL = os.getenv(
    "API_BASE_URL", 
    "http://leanworks-hub-service/api"
)

response = requests.get(
    f"{API_BASE_URL}/projects",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
)
```

### Local Development Examples

#### Frontend Development (Vite)
```typescript
// In vite.config.ts or environment variable
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

// Or configure proxy in vite.config.ts:
// server: {
//   proxy: {
//     '/api': {
//       target: 'http://localhost:3001',
//       changeOrigin: true,
//     }
//   }
// }
// Then use: const API_BASE_URL = '/api';
```

#### Backend Development
```bash
# Start backend server
npm run dev  # or: npx tsx server/index.ts

# Backend runs on http://localhost:3001
# Test directly:
curl -X GET "http://localhost:3001/api/projects" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

## Network Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    External Clients                         │
│  (Web browsers, mobile apps, external services)            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ HTTPS/HTTP
                         │
┌────────────────────────▼────────────────────────────────────┐
│              Kubernetes LoadBalancer Service                 │
│              (External IP: <your-external-ip>)              │
│              Port: 80/443                                    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │
┌────────────────────────▼────────────────────────────────────┐
│                    Nginx Container                          │
│              Port: 80 (listening)                           │
│              - Serves static frontend files                  │
│              - Proxies /api/* to backend                    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Proxy: /api/* → localhost:3001
                         │
┌────────────────────────▼────────────────────────────────────┐
│              Express Backend Server                          │
│              Port: 3001 (listening on 0.0.0.0)              │
│              - Handles all /api/* requests                   │
│              - Connects to Firestore                         │
└─────────────────────────────────────────────────────────────┘
```

**Internal Access Paths:**
- Frontend → `/api/*` → Nginx → `localhost:3001/api/*` → Express
- Direct Backend → `localhost:3001/api/*` → Express

**External Access Paths:**
- External Client → `https://domain.com/api/*` → LoadBalancer → Nginx → `localhost:3001/api/*` → Express

---

## Best Practices

1. **Use Relative Paths in Frontend**: When calling from the frontend application, use relative paths (`/api/*`) instead of absolute URLs. This ensures the requests are automatically proxied by nginx and works in all environments.

2. **Environment Variables**: Use environment variables for API base URLs:
   ```typescript
   const API_BASE_URL = process.env.REACT_APP_API_URL || '/api';
   ```

3. **Error Handling**: Always handle authentication errors (401) and implement token refresh logic.

4. **HTTPS in Production**: Always use HTTPS for external access in production. Configure TLS/SSL at the load balancer or ingress level.

5. **CORS Configuration**: Currently, CORS allows all origins. For production, restrict CORS to specific domains.

6. **Token Storage**: Store authentication tokens securely (e.g., httpOnly cookies or secure storage) and never expose them in logs or client-side code.

