# Leanworks Hub API Contract

## Base Information

- **Content-Type**: `application/json`
- **Authentication**: Bearer token in `Authorization` header
- **Database**: Hybrid (PostgreSQL for structured data, Firestore for messages/real-time)
- **Data Isolation**: All data is organization-based (isolated by organization ID)
- **Organization Context**: Most endpoints require `X-Org-Id` header to specify the organization context

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

## Health Check API

### GET /api/health

Check API health status.

**Response (200 OK):**
```json
{
  "status": "healthy",
  "database": "hybrid",
  "postgres": "primary",
  "firestore": "messages-only"
}
```

---

## Authentication APIs

### POST /api/auth/signup

Create a new user account. A personal workspace is automatically created for the user.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "firstName": "John",
  "lastName": "Doe",
  "jobTitle": "Software Engineer",
  "timezone": "America/New_York"
}
```

**Response (201 OK):**
```json
{
  "success": true,
  "uid": "firebase-uid-here",
  "email": "user@example.com",
  "message": "Account created! Please check your email to verify your account.",
  "personalOrg": {
    "id": "org-id-123",
    "name": "John's Workspace",
    "slug": "john_workspace",
    "type": "personal"
  }
}
```

**Error Responses:**
- `400` - Missing required fields (email, password, firstName, lastName, timezone) or account already exists
- `500` - Server error

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
    "emailVerified": true,
    "firstName": "John",
    "lastName": "Doe"
  },
  "organizations": [
    {
      "id": "org-id-123",
      "name": "John's Workspace",
      "slug": "john_workspace",
      "type": "personal",
      "role": "owner",
      "isOwner": true
    }
  ],
  "defaultOrgId": "org-id-123"
}
```

**Error Responses:**
- `400` - Missing email or password
- `401` - Invalid email or password
- `403` - Email not verified (code: `EMAIL_NOT_VERIFIED`)
- `500` - Server error

---

### GET /api/auth/verify-email

Verify email address with a verification token.

**Query Parameters:**
- `token` (required) - Email verification token

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Email verified successfully! You can now log in.",
  "email": "user@example.com"
}
```

**Error Responses:**
- `400` - Invalid or expired token, or token already used
- `500` - Server error

---

### POST /api/auth/resend-verification

Resend email verification link.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Verification email sent"
}
```

**Error Responses:**
- `400` - Email is required or already verified
- `404` - User not found
- `500` - Server error

---

### GET /api/auth/verification-status

Check email verification status.

**Query Parameters:**
- `email` (required) - User email

**Response (200 OK):**
```json
{
  "email": "user@example.com",
  "emailVerified": true
}
```

**Error Responses:**
- `400` - Email is required
- `404` - User not found
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

Get all users in the organization.

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
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

### PUT /api/users/profile

Update the current authenticated user's profile.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "jobTitle": "Senior Software Engineer",
  "timezone": "America/New_York"
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

### GET /api/users/:email

Get a specific user's profile by email.

**Parameters:**
- `email` (path) - User email

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
  "jobTitle": "Software Engineer"
}
```

**Error Responses:**
- `401` - Unauthorized
- `404` - User not found
- `500` - Server error

---

### DELETE /api/users/me

Delete the current authenticated user's account.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Account deleted successfully"
}
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

## Organization APIs

All organization endpoints require organization membership. Most endpoints require the `X-Org-Id` header.

### GET /api/orgs

Get all organizations the authenticated user belongs to.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
[
  {
    "id": "org-id-123",
    "name": "My Workspace",
    "slug": "my_workspace",
    "type": "personal",
    "role": "owner",
    "ownerEmail": "user@example.com"
  }
]
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### POST /api/orgs

Create a new organization.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "name": "New Organization",
  "type": "team"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "org": {
    "id": "org-id-123",
    "name": "New Organization",
    "slug": "new_organization",
    "type": "team"
  }
}
```

**Error Responses:**
- `400` - Missing required fields
- `401` - Unauthorized
- `500` - Server error

---

### GET /api/orgs/:orgId

Get a specific organization by ID.

**Parameters:**
- `orgId` (path) - Organization ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
{
  "id": "org-id-123",
  "name": "My Organization",
  "slug": "my_organization",
  "type": "team",
  "ownerEmail": "owner@example.com",
  "members": [...]
}
```

**Error Responses:**
- `401` - Unauthorized
- `403` - Not a member of this organization
- `404` - Organization not found
- `500` - Server error

---

### PUT /api/orgs/:orgId

Update an organization. Only organization owners can update.

**Parameters:**
- `orgId` (path) - Organization ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Request Body:**
```json
{
  "name": "Updated Organization Name"
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
- `403` - Only organization owners can update
- `404` - Organization not found
- `500` - Server error

---

### DELETE /api/orgs/:orgId

Delete an organization. Only organization owners can delete.

**Parameters:**
- `orgId` (path) - Organization ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- `401` - Unauthorized
- `403` - Only organization owners can delete
- `404` - Organization not found
- `500` - Server error

---

### POST /api/orgs/:orgId/invite

Invite a user to join the organization. Only organization owners can invite.

**Parameters:**
- `orgId` (path) - Organization ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "role": "member"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Invitation sent successfully"
}
```

**Error Responses:**
- `400` - User already a member or invalid email
- `401` - Unauthorized
- `403` - Only organization owners can invite
- `500` - Server error

---

### GET /api/orgs/invitations/pending

Get pending organization invitations for the authenticated user.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
[
  {
    "id": "invitation-id-123",
    "orgId": "org-id-123",
    "orgName": "My Organization",
    "inviterEmail": "owner@example.com",
    "role": "member",
    "createdAt": "2024-11-15T10:30:00.000Z"
  }
]
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### POST /api/orgs/invitations/:invitationId/accept

Accept an organization invitation.

**Parameters:**
- `invitationId` (path) - Invitation ID

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Invitation accepted successfully"
}
```

**Error Responses:**
- `400` - Invitation already processed or expired
- `401` - Unauthorized
- `404` - Invitation not found
- `500` - Server error

---

### POST /api/orgs/invitations/:invitationId/decline

Decline an organization invitation.

**Parameters:**
- `invitationId` (path) - Invitation ID

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Invitation declined"
}
```

**Error Responses:**
- `400` - Invitation already processed
- `401` - Unauthorized
- `404` - Invitation not found
- `500` - Server error

---

### DELETE /api/orgs/:orgId/members/:memberEmail

Remove a member from an organization. Only organization owners can remove members.

**Parameters:**
- `orgId` (path) - Organization ID
- `memberEmail` (path) - Member email (URL encoded)

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Member removed successfully"
}
```

**Error Responses:**
- `400` - Cannot remove organization owner
- `401` - Unauthorized
- `403` - Only organization owners can remove members
- `404` - Organization or member not found
- `500` - Server error

---

### POST /api/orgs/:orgId/leave

Leave an organization. Members can leave, but owners cannot.

**Parameters:**
- `orgId` (path) - Organization ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Left organization successfully"
}
```

**Error Responses:**
- `400` - Organization owner cannot leave (must transfer ownership or delete organization) or not a member
- `401` - Unauthorized
- `404` - Organization not found
- `500` - Server error

---

## Notifications APIs

### GET /api/notifications

Get all notifications for the authenticated user.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
[
  {
    "id": "notification-id-123",
    "type": "team_invitation",
    "title": "Team Invitation",
    "message": "You have been invited to join Engineering team",
    "read": false,
    "createdAt": "2024-11-15T10:30:00.000Z"
  }
]
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### PATCH /api/notifications/:notificationId/read

Mark a notification as read.

**Parameters:**
- `notificationId` (path) - Notification ID

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
- `404` - Notification not found
- `500` - Server error

---

### PATCH /api/notifications/:notificationId/dismiss

Dismiss a notification.

**Parameters:**
- `notificationId` (path) - Notification ID

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
- `404` - Notification not found
- `500` - Server error

---

## Projects APIs

### GET /api/projects

Get all projects in the organization.

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
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

### GET /api/projects/:id

Get a specific project by ID.

**Parameters:**
- `id` (path) - Project ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

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

### PATCH /api/projects/:id

Update a project.

**Parameters:**
- `id` (path) - Project ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

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

### DELETE /api/projects/:id

Delete a project.

**Parameters:**
- `id` (path) - Project ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- `401` - Unauthorized
- `403` - Not a member of this organization
- `404` - Project not found
- `500` - Server error

---

### POST /api/projects/:id/members

Add a member to a project.

**Parameters:**
- `id` (path) - Project ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Request Body:**
```json
{
  "email": "member@example.com",
  "role": "member"
}
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- `400` - User already a member or invalid email
- `401` - Unauthorized
- `403` - Not a member of this organization
- `404` - Project not found
- `500` - Server error

---

### DELETE /api/projects/:id/members/:memberEmail

Remove a member from a project.

**Parameters:**
- `id` (path) - Project ID
- `memberEmail` (path) - Member email (URL encoded)

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- `400` - Cannot remove project owner
- `401` - Unauthorized
- `403` - Not a member of this organization
- `404` - Project or member not found
- `500` - Server error

---

### POST /api/projects/:id/comments

Add a comment to a project.

**Parameters:**
- `id` (path) - Project ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Request Body:**
```json
{
  "comment": "Great progress on this project!",
  "memberName": "John Doe",
  "memberAvatar": "JD"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "commentId": "comment-id-123"
}
```

**Error Responses:**
- `400` - Comment is required
- `401` - Unauthorized
- `403` - Not a member of this organization
- `404` - Project not found
- `500` - Server error

---

## Documents APIs

### GET /api/docs

Get all documents in the organization.

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
[
  {
    "id": "doc-id-123",
    "title": "Project Requirements",
    "content": "Document content...",
    "createdBy": "user@example.com",
    "createdAt": "2024-11-15T10:30:00.000Z",
    "updatedAt": "2024-11-15T10:30:00.000Z"
  }
]
```

**Error Responses:**
- `401` - Unauthorized
- `403` - Not a member of this organization
- `500` - Server error

---

### GET /api/docs/:id

Get a specific document by ID.

**Parameters:**
- `id` (path) - Document ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
{
  "id": "doc-id-123",
  "title": "Project Requirements",
  "content": "Document content...",
  "createdBy": "user@example.com",
  "createdAt": "2024-11-15T10:30:00.000Z",
  "updatedAt": "2024-11-15T10:30:00.000Z"
}
```

**Error Responses:**
- `401` - Unauthorized
- `403` - Not a member of this organization
- `404` - Document not found
- `500` - Server error

---

### POST /api/docs

Create a new document.

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Request Body:**
```json
{
  "title": "New Document",
  "content": "Document content..."
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "docId": "doc-id-123"
}
```

**Error Responses:**
- `400` - Missing required fields
- `401` - Unauthorized
- `403` - Not a member of this organization
- `500` - Server error

---

### PATCH /api/docs/:id

Update a document.

**Parameters:**
- `id` (path) - Document ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Request Body:**
```json
{
  "title": "Updated Title",
  "content": "Updated content..."
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
- `403` - Not a member of this organization or not the document creator
- `404` - Document not found
- `500` - Server error

---

### DELETE /api/docs/:id

Delete a document.

**Parameters:**
- `id` (path) - Document ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- `401` - Unauthorized
- `403` - Not a member of this organization or not the document creator
- `404` - Document not found
- `500` - Server error

---

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

Get all tasks in the organization.

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
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
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- `401` - Unauthorized
- `403` - Not a member of this organization
- `404` - Task not found
- `500` - Server error

---

### POST /api/tasks/:id/comments

Add a comment to a task.

**Parameters:**
- `id` (path) - Task ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Request Body:**
```json
{
  "comment": "Great work on this task!",
  "memberName": "John Doe",
  "memberAvatar": "JD"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "commentId": "comment-id-123"
}
```

**Error Responses:**
- `400` - Comment is required
- `401` - Unauthorized
- `403` - Not a member of this organization
- `404` - Task not found
- `500` - Server error

---

## Messages APIs

### GET /api/messages

Get all messages (limited to recent messages).

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
[
  {
    "id": "message-id-123",
    "chatId": "dm-user1-user2",
    "role": "user",
    "content": "Hello!",
    "timestamp": "2024-11-15T10:30:00.000Z",
    "userId": "user@example.com",
    "likes": []
  }
]
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### GET /api/messages/:chatId

Get messages for a specific chat.

**Parameters:**
- `chatId` (path) - Chat ID (e.g., `dm-email1-email2`, `project-projectId`, `team-teamId`, `ai-assistant-userEmail`)

**Query Parameters:**
- `afterTimestamp` (optional) - Get messages after this timestamp

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
[
  {
    "id": "message-id-123",
    "chatId": "dm-user1-user2",
    "role": "user",
    "content": "Hello!",
    "timestamp": "2024-11-15T10:30:00.000Z",
    "userId": "user@example.com",
    "imageUrls": null,
    "likes": []
  }
]
```

**Error Responses:**
- `401` - Unauthorized
- `403` - Access denied (for project/team channels)
- `500` - Server error

---

### POST /api/messages

Create a new message.

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Request Body:**
```json
{
  "chatId": "dm-user1-user2",
  "role": "user",
  "content": "Hello!",
  "memberName": "John Doe",
  "memberAvatar": "JD",
  "projectId": "project-id-123",
  "teamId": "team-id-123",
  "imageUrls": ["https://..."],
  "citedContext": {...}
}
```

**Response (201 OK):**
```json
{
  "success": true,
  "messageId": "message-id-123",
  "message": {
    "id": "message-id-123",
    "chatId": "dm-user1-user2",
    "role": "user",
    "content": "Hello!",
    "timestamp": "2024-11-15T10:30:00.000Z",
    "userId": "user@example.com",
    "likes": []
  }
}
```

**Error Responses:**
- `400` - Missing required fields
- `401` - Unauthorized
- `403` - Access denied (for project/team channels)
- `500` - Server error

---

### PATCH /api/messages/:messageId/like

Toggle like on a message.

**Parameters:**
- `messageId` (path) - Message ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
{
  "success": true,
  "likes": ["user1@example.com", "user2@example.com"],
  "liked": true
}
```

**Error Responses:**
- `401` - Unauthorized
- `404` - Message not found
- `500` - Server error

---

### GET /api/conversations/recent

Get recent conversations for the authenticated user.

**Query Parameters:**
- `limit` (optional) - Maximum number of conversations to return (default: 50)

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
[
  {
    "chatId": "dm-user1-user2",
    "lastMessage": "Hello!",
    "lastMessageTimestamp": "2024-11-15T10:30:00.000Z",
    "lastMessageRole": "user",
    "lastMessageUserId": "user@example.com"
  }
]
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

## Teams APIs

### GET /api/teams

Get all teams in the organization.

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
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

### GET /api/teams/:id

Get a specific team by ID.

**Parameters:**
- `id` (path) - Team ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

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
X-Org-Id: <orgId>
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
- `403` - Only team owner can remove members or not a member of this organization
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
X-Org-Id: <orgId>
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
- `403` - Not a member of this organization
- `404` - Team not found
- `500` - Server error

---

---

## Calls APIs

### POST /api/calls/:chatId/offer

Create a call offer (initiate a call).

**Parameters:**
- `chatId` (path) - Chat ID (must be a DM chat, format: `dm-email1-email2`)

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Request Body:**
```json
{
  "offer": {...},
  "calleeEmail": "callee@example.com"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "callId": "call-id-123"
}
```

**Error Responses:**
- `400` - Missing required fields or invalid chat ID
- `401` - Unauthorized
- `403` - Invalid chat ID or access denied
- `500` - Server error

---

### POST /api/calls/:chatId/answer

Send call answer (accept a call).

**Parameters:**
- `chatId` (path) - Chat ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Request Body:**
```json
{
  "callId": "call-id-123",
  "answer": {...}
}
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- `400` - Missing required fields
- `401` - Unauthorized
- `403` - Only the callee can answer the call
- `404` - Call not found
- `500` - Server error

---

### POST /api/calls/:chatId/ice-candidate

Send ICE candidate for WebRTC connection.

**Parameters:**
- `chatId` (path) - Chat ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Request Body:**
```json
{
  "callId": "call-id-123",
  "candidate": {...}
}
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- `400` - Missing required fields
- `401` - Unauthorized
- `403` - Access denied
- `404` - Call not found
- `500` - Server error

---

### POST /api/calls/:chatId/end

End a call.

**Parameters:**
- `chatId` (path) - Chat ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Request Body:**
```json
{
  "callId": "call-id-123"
}
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Responses:**
- `400` - Missing callId
- `401` - Unauthorized
- `403` - Access denied
- `404` - Call not found
- `500` - Server error

---

### GET /api/calls/incoming

Get all incoming calls for the current user.

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
{
  "calls": [
    {
      "callId": "call-id-123",
      "chatId": "dm-user1-user2",
      "callerEmail": "caller@example.com",
      "calleeEmail": "callee@example.com",
      "status": "ringing",
      "createdAt": "2024-11-15T10:30:00.000Z"
    }
  ]
}
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### GET /api/calls/:chatId/status

Get call status for a chat.

**Parameters:**
- `chatId` (path) - Chat ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
{
  "callId": "call-id-123",
  "status": "active",
  "callerEmail": "caller@example.com",
  "calleeEmail": "callee@example.com",
  "createdAt": "2024-11-15T10:30:00.000Z"
}
```

**Error Responses:**
- `401` - Unauthorized
- `403` - Invalid chat ID or access denied
- `500` - Server error

---

### POST /api/calls/:callId/start-transcription

Start transcription for an active call.

**Parameters:**
- `callId` (path) - Call ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Transcription started"
}
```

**Error Responses:**
- `400` - Call must be active to start transcription
- `401` - Unauthorized
- `403` - Access denied
- `404` - Call not found
- `500` - Server error

---

## Files APIs

### POST /api/files/upload

Upload a file to Google Cloud Storage.

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
Content-Type: multipart/form-data
```

**Request Body:**
- `file` (file) - File to upload (max 10MB)
- `docId` (string) - Document ID to associate the file with

**Response (200 OK):**
```json
{
  "success": true,
  "fileUrl": "https://storage.googleapis.com/...",
  "fileId": "file-id-123",
  "fileName": "document.pdf",
  "fileSize": 1024000,
  "mimeType": "application/pdf"
}
```

**Error Responses:**
- `400` - Missing docId or file, or file size exceeds 10MB
- `401` - Unauthorized
- `500` - Server error

---

### POST /api/files/refresh

Refresh signed URLs for files.

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Request Body:**
```json
{
  "fileUrls": ["https://storage.googleapis.com/..."],
  "docId": "doc-id-123"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "fileUrls": ["https://storage.googleapis.com/..."]
}
```

**Error Responses:**
- `400` - Missing required fields
- `401` - Unauthorized
- `500` - Server error

---

## Images APIs

### POST /api/images/upload

Upload an image to Firebase Storage. Images are automatically converted to JPG format.

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
Content-Type: multipart/form-data
```

**Request Body:**
- `image` (file) - Image file to upload (max 10MB, formats: JPG, PNG, WebP, GIF)
- `chatId` (string) - Chat ID to associate the image with

**Response (200 OK):**
```json
{
  "success": true,
  "imageUrl": "https://storage.googleapis.com/...",
  "imageId": "image-id-123.jpg"
}
```

**Error Responses:**
- `400` - Missing chatId or image, invalid image format, or image size exceeds 10MB
- `401` - Unauthorized
- `500` - Server error

---

### POST /api/images/refresh

Refresh signed URLs for images.

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Request Body:**
```json
{
  "imageUrls": ["https://storage.googleapis.com/..."],
  "chatId": "chat-id-123"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "imageUrls": ["https://storage.googleapis.com/..."]
}
```

**Error Responses:**
- `400` - Missing required fields
- `401` - Unauthorized
- `500` - Server error

---

## LiveKit APIs

### GET /api/livekit/token

Get LiveKit access token for joining a room.

**Query Parameters:**
- `roomName` (required) - Room name
- `participantName` (optional) - Participant display name
- `canPublish` (optional) - Whether participant can publish (default: true)
- `canSubscribe` (optional) - Whether participant can subscribe (default: true)

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "token": "livekit-jwt-token",
  "url": "wss://livekit.leanworks.ai"
}
```

**Error Responses:**
- `400` - Missing roomName
- `401` - Unauthorized
- `503` - LiveKit service not configured
- `500` - Server error

---

## TURN Server APIs

### GET /api/turn/credentials

Get TURN server credentials for WebRTC.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "iceServers": [
    {
      "urls": "stun:stun.example.com:3478"
    },
    {
      "urls": "turn:turn.example.com:3478",
      "username": "username",
      "credential": "password"
    }
  ],
  "ttl": 86400,
  "expiresAt": "2024-11-16T10:30:00.000Z"
}
```

**Error Responses:**
- `401` - Unauthorized
- `503` - TURN service not configured
- `500` - Server error

---

## Subscription APIs

### GET /api/subscription/status

Get subscription status for the authenticated user.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "plan": "standard",
  "stripeCustomerId": "cus_...",
  "stripeSubscriptionId": "sub_...",
  "aiDailyUsage": 5,
  "aiUsageLimit": 20,
  "aiUsageRemaining": 15,
  "trialEndsAt": "2024-11-22T10:30:00.000Z",
  "isTrialActive": true,
  "trialDaysRemaining": 7,
  "memberSince": "2024-11-15T10:30:00.000Z"
}
```

**Error Responses:**
- `401` - Unauthorized
- `404` - User not found
- `500` - Server error

---

### POST /api/subscription/checkout

Create a Stripe checkout session.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "plan": "standard",
  "successUrl": "https://leanworks.ai/subscription?success=true",
  "cancelUrl": "https://leanworks.ai/subscription?canceled=true"
}
```

**Response (200 OK):**
```json
{
  "url": "https://checkout.stripe.com/..."
}
```

**Error Responses:**
- `400` - Invalid plan
- `401` - Unauthorized
- `503` - Payment system not configured
- `500` - Server error

---

### POST /api/subscription/portal

Create a Stripe customer portal session.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "returnUrl": "https://leanworks.ai/subscription"
}
```

**Response (200 OK):**
```json
{
  "url": "https://billing.stripe.com/..."
}
```

**Error Responses:**
- `400` - No subscription found
- `401` - Unauthorized
- `503` - Payment system not configured
- `500` - Server error

---

### POST /api/subscription/switch

Switch subscription plan (upgrade or downgrade).

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "plan": "pro"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "plan": "pro",
  "message": "Successfully switched to pro plan"
}
```

**Error Responses:**
- `400` - Invalid plan or already on that plan
- `401` - Unauthorized
- `503` - Payment system not configured
- `500` - Server error

---

### POST /api/subscription/cancel

Cancel subscription (revert to free plan).

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "plan": "free",
  "message": "Subscription canceled. You have been downgraded to the free plan."
}
```

**Error Responses:**
- `400` - No active subscription to cancel
- `401` - Unauthorized
- `503` - Payment system not configured
- `500` - Server error

---

### POST /api/subscription/downgrade-to-free

Downgrade to free plan (alias for cancel).

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "plan": "free",
  "message": "You have been downgraded to the free plan."
}
```

**Error Responses:**
- `401` - Unauthorized
- `503` - Payment system not configured
- `500` - Server error

---

### POST /api/subscription/ai-usage

Increment AI usage counter.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "usage": 6,
  "limit": 20,
  "remaining": 14
}
```

**Error Responses:**
- `401` - Unauthorized
- `404` - User not found
- `429` - AI usage limit reached
- `500` - Server error

---

## AI Task Generation APIs

### POST /api/generate-task

Generate task details using AI.

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Request Body:**
```json
{
  "user_id": "user@example.com",
  "org_slug": "my_org",
  "task_description": "Implement user authentication"
}
```

**Response (200 OK):**
```json
{
  "title": "Implement User Authentication",
  "description": "Detailed task description...",
  "estimatedHours": 8,
  "priority": "high"
}
```

**Error Responses:**
- `400` - Missing required fields
- `401` - Unauthorized
- `500` - Server error

---

## Configuration APIs

### GET /api/firebase-config

Get Firebase configuration (public endpoint, no auth required).

**Response (200 OK):**
```json
{
  "apiKey": "AIza...",
  "authDomain": "leanworks-prod.firebaseapp.com",
  "projectId": "leanworks-prod",
  "storageBucket": "leanworks-prod.appspot.com",
  "messagingSenderId": "123456789",
  "appId": "1:123456789:web:..."
}
```

**Error Responses:**
- `500` - Server error

---

### GET /api/ga4-config

Get Google Analytics 4 Measurement ID (public endpoint, no auth required).

**Response (200 OK):**
```json
{
  "measurementId": "G-XXXXXXXXXX"
}
```

**Error Responses:**
- `404` - GA4 Measurement ID not configured
- `500` - Server error

---

### GET /api/ask-api-key

Get API key for AI service (authenticated endpoint).

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "apiKey": "encrypted-api-key"
}
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

## Update Summaries APIs

### GET /api/update-summaries

Get project update summaries.

**Query Parameters:**
- `projectId` (optional) - Get summary for specific project
- `all` (optional) - If `true`, return all summaries for the project

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
{
  "project-id-123": {
    "dateId": "2024-11-15",
    "updateSummary": "Project update summary..."
  }
}
```

Or if `projectId` is specified:
```json
{
  "projectId": "project-id-123",
  "dateId": "2024-11-15",
  "updateSummary": "Project update summary..."
}
```

**Error Responses:**
- `401` - Unauthorized
- `403` - Not a member of this organization
- `500` - Server error

---

### GET /api/updates/task/:taskId

Get updates associated with a task.

**Parameters:**
- `taskId` (path) - Task ID

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Response (200 OK):**
```json
[
  {
    "updateId": "update-id-123",
    "associatedTasks": ["task-id-123"],
    "dateId": "2024-11-15",
    "projectId": "project-id-123",
    "reason": "Weekly update",
    "timestamp": "2024-11-15T10:30:00.000Z",
    "update": "Task is progressing well...",
    "userId": "user@example.com",
    "memberName": "John Doe",
    "memberAvatar": "JD"
  }
]
```

**Error Responses:**
- `401` - Unauthorized
- `403` - Not a member of this organization
- `500` - Server error

---

## Demo Requests API

### POST /api/demo-requests

Submit a demo request (public endpoint, no auth required).

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "company": "Acme Corp",
  "message": "I'd like to schedule a demo"
}
```

**Response (201 OK):**
```json
{
  "success": true,
  "id": 123,
  "message": "Demo request submitted successfully"
}
```

**Error Responses:**
- `400` - Missing required fields
- `500` - Server error

---

## Integrations APIs

### GET /api/integrations

Get all integrations and their connection status for the organization.

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
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
  },
  {
    "id": "outlook",
    "name": "Outlook",
    "connected": false,
    "connectedAt": null
  }
]
```

**Error Responses:**
- `401` - Unauthorized
- `500` - Server error

---

### POST /api/integrations/:integrationId/connect

Connect an integration. Credentials are stored in GCP Secret Manager. Only organization owners can connect integrations.

**Parameters:**
- `integrationId` (path) - Integration ID (`slack`, `atlassian`, or `outlook`)

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

**Request Body:**

For Slack:
```json
{
  "botToken": "xoxb-your-slack-bot-token"
}
```

For Atlassian:
```json
{
  "email": "user@example.com",
  "domain": "your-domain.atlassian.net",
  "apiToken": "atlassian-api-token"
}
```

For Outlook:
```json
{
  "clientId": "client-id",
  "clientSecret": "client-secret",
  "tenantId": "tenant-id"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Integration connected successfully"
}
```

**Error Responses:**
- `400` - Missing required fields or invalid integration ID
- `401` - Unauthorized
- `403` - Only organization owners can connect integrations
- `500` - Server error

---

### POST /api/integrations/:integrationId/disconnect

Disconnect an integration. Only organization owners can disconnect integrations.

**Parameters:**
- `integrationId` (path) - Integration ID (`slack`, `atlassian`, `github`, or `outlook`)

**Headers:**
```
Authorization: Bearer <token>
X-Org-Id: <orgId>
```

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

1. **Organization-Based Isolation**: All data is automatically isolated by organization ID. Users must be members of an organization to access its data. Most endpoints require the `X-Org-Id` header to specify the organization context.

2. **Email Verification**: Users must verify their email address before logging in. Verification links are sent via email during signup.

3. **Organization Roles**: 
   - **Owner**: Can manage organization settings, invite/remove members, connect integrations
   - **Member**: Can access organization data and collaborate

4. **Team Ownership**: Team owners have special permissions:
   - Can approve/reject join requests
   - Can remove members
   - Cannot leave the team (must transfer ownership or delete team)

5. **Secret Storage**: Integration credentials (Slack, Atlassian, GitHub, Outlook) are stored securely in GCP Secret Manager, not in the database.

6. **Database Architecture**: 
   - **PostgreSQL**: Used for structured data (users, projects, tasks, teams, organizations)
   - **Firestore**: Used for real-time data (messages, calls)
   - Each organization has its own PostgreSQL database (multi-tenant architecture)

7. **Timestamps**: Timestamps are automatically converted to appropriate formats (milliseconds for `createdAt`, ISO strings for dates).

8. **GitHub Integration**: GitHub uses OAuth App installation flow. The callback endpoint is `/api/integrations/github/callback`.

9. **Webhooks**: 
   - Stripe webhooks: `/api/webhooks/stripe`
   - GitHub webhooks: `/api/integrations/github/webhook`
   - LiveKit webhooks: `/api/livekit/webhook`

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

