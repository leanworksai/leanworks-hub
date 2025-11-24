import express from 'express';
import cors from 'cors';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import crypto from 'crypto';
import { getTenantPool, getDomainFromEmail } from '../database/multi-tenant-pool.js';
import { setupIntegrationEndpoints } from './endpoints/integrations.js';
import { setupCallEndpoints } from './endpoints/calls.js';
import { setupImageEndpoints } from './endpoints/images.js';

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read service account credentials
const serviceAccountPath = join(__dirname, '../gcp_credential.json');
let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
  console.log('✅ Loaded GCP credentials from:', serviceAccountPath);
} catch (error) {
  console.error('❌ Failed to load GCP credentials from:', serviceAccountPath);
  console.error('Error:', error);
  process.exit(1);
}

// Initialize Firebase Admin SDK (for auth and messages only)
let firebaseApp;
try {
  if (getApps().length === 0) {
    // Construct storage bucket name (default is {project-id}.appspot.com)
    const storageBucket = serviceAccount.storage_bucket || `${serviceAccount.project_id}.appspot.com`;
    firebaseApp = initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id,
      storageBucket: storageBucket,
    });
    console.log('✅ Firebase Admin SDK initialized');
    console.log('✅ Storage bucket:', storageBucket);
  } else {
    firebaseApp = getApps()[0];
    console.log('✅ Using existing Firebase Admin SDK instance');
  }
} catch (error) {
  console.error('❌ Failed to initialize Firebase Admin SDK:', error);
  throw error;
}

// Use named database 'leanworks-prod' - this is the database configured in Firebase
// Note: Client SDK will need to be configured to use the same database
const db = getFirestore(firebaseApp, 'leanworks-prod');
console.log('✅ Firestore database initialized:', db.databaseId);
const auth = getAuth(firebaseApp);
const storage = getStorage(firebaseApp);
console.log('✅ Firestore, Auth, and Storage initialized');

// Initialize Secret Manager client
const secretManagerClient = new SecretManagerServiceClient({
  credentials: serviceAccount,
  projectId: serviceAccount.project_id,
});

const app = express();
const PORT = 3001;

app.use(cors());

// Increase timeout for long-running requests (image uploads)
// Must be after cors() but before routes
app.use((req, res, next) => {
  // Set timeout to 2 minutes for image upload endpoints
  if (req.path.startsWith('/api/images/')) {
    req.setTimeout(120000); // 2 minutes
    res.setTimeout(120000);
  }
  next();
});

// ============================================================================
// REQUEST LOGGING MIDDLEWARE (for debugging - must be before routes)
// ============================================================================

app.use((req, res, next) => {
  next();
});

// JSON parsing middleware (except for GitHub webhook and image uploads)
app.use((req, res, next) => {
  if (req.path === '/api/integrations/github/webhooks' || req.path.startsWith('/api/images/')) {
    next();
  } else {
    express.json()(req, res, next);
  }
});

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

async function authenticateUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('❌ [Backend] authenticateUser: No token provided', {
        hasAuthHeader: !!authHeader,
        authHeader: authHeader?.substring(0, 50),
      });
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    
    // Try to verify as ID token first (normal flow when Firebase Auth works)
    try {
      const decodedToken = await auth.verifyIdToken(token);
    (req as any).user = decodedToken;
    (req as any).userEmail = decodedToken.email;
    (req as any).userDomain = getDomainFromEmail(decodedToken.email!);
      next();
      return;
    } catch (idTokenError: any) {
      // If ID token verification fails, try to verify as custom token
      // by decoding and checking the UID
      if (idTokenError.code === 'auth/argument-error' && idTokenError.message?.includes('custom token')) {
        try {
          // Decode the JWT without verification first to get the UID
          const parts = token.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            
            // If it has a uid, it's likely a custom token
            if (payload.uid) {
              // Verify the user exists and get their info
              const userRecord = await auth.getUser(payload.uid);
              
              // Create a decoded token-like object
              const decodedToken = {
                uid: userRecord.uid,
                email: userRecord.email,
                email_verified: userRecord.emailVerified,
              };
              
              (req as any).user = decodedToken;
              (req as any).userEmail = userRecord.email;
              (req as any).userDomain = getDomainFromEmail(userRecord.email!);
    next();
              return;
            }
          }
        } catch (customTokenError: any) {
          // If custom token handling fails, log and throw original error
          console.error('❌ [Backend] authenticateUser: Custom token handling failed', {
            error: customTokenError.message,
            code: customTokenError.code,
            stack: customTokenError.stack,
          });
          throw idTokenError;
        }
      }
      
      // If we get here, both methods failed or it's not a custom token error
      throw idTokenError;
    }
  } catch (error: any) {
    console.error('❌ [Backend] authenticateUser: Authentication failed', {
      error: error.message,
      code: error.code,
      method: req.method,
      path: req.path,
      url: req.url,
    });
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Helper to get Firestore collection path (only for messages now)
function getCollectionPath(collection: string, domain: string) {
  return `domains/${domain}/${collection}`;
}

// Helper to convert snake_case to camelCase
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

// Transform database row to camelCase
function transformRow(row: any): any {
  const transformed: any = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = toCamelCase(key);
    transformed[camelKey] = value;
  }
  return transformed;
}

// Transform members array to match frontend expectations
function transformMembers(members: any[] | null): any[] {
  if (!members || !Array.isArray(members)) return [];
  return members.map(m => ({
    id: m.email || m.id, // Frontend expects 'id' to be email
    email: m.email,
    name: m.name || `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.email,
    role: m.role || 'member',
    avatar: m.avatar || null
  }));
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'Leanworks Hub API',
    health: '/api/health'
  });
});

app.get('/api/health', async (req, res) => {
  res.json({ 
    status: 'healthy',
    database: 'hybrid',
    postgres: 'primary',
    firestore: 'messages-only'
  });
});

// ============================================================================
// USER ENDPOINTS (PostgreSQL)
// ============================================================================

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, firstName, lastName, jobTitle, timezone } = req.body;
    
    // Validate required fields
    if (!timezone) {
      return res.status(400).json({ error: 'Timezone is required' });
    }
    
    // Create user in Firebase Auth
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: `${firstName} ${lastName}`,
    });

    // Get tenant pool
    const pool = await getTenantPool(email);
    
    // Hash password for PostgreSQL
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Store in PostgreSQL
    await pool.query(`
      INSERT INTO users (email, password_hash, first_name, last_name, job_title, timezone, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [email.toLowerCase(), passwordHash, firstName, lastName, jobTitle, timezone]);

    res.status(201).json({ 
      success: true, 
      uid: userRecord.uid,
      email: userRecord.email 
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Get tenant pool
    const pool = await getTenantPool(email);

    // Get user from PostgreSQL
    const userResult = await pool.query(
      'SELECT email, password_hash, first_name, last_name FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const userData = userResult.rows[0];

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, userData.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login
    await pool.query(
      'UPDATE users SET last_login = NOW() WHERE email = $1',
      [email.toLowerCase()]
    );

    // Get or create Firebase Auth user (for custom token generation)
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email.toLowerCase());
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        // Create Firebase Auth user if it doesn't exist
        userRecord = await auth.createUser({
          email: email.toLowerCase(),
          password,
          emailVerified: true,
          displayName: `${userData.first_name} ${userData.last_name}`,
        });
      } else {
        throw error;
      }
    }

    // Ensure user is verified
    if (!userRecord.emailVerified) {
      await auth.updateUser(userRecord.uid, { emailVerified: true });
      userRecord = await auth.getUser(userRecord.uid);
    }

    // Create custom token
    const customToken = await auth.createCustomToken(userRecord.uid);
    
    // Log token creation for debugging (without exposing the full token)
    console.log('✅ Custom token created:', {
      uid: userRecord.uid,
      email: userRecord.email,
      tokenLength: customToken.length,
      tokenPrefix: customToken.substring(0, 20),
      projectId: serviceAccount.project_id,
    });

    res.json({ 
      success: true,
      customToken,
      user: {
        uid: userRecord.uid,
        email: userRecord.email,
        emailVerified: userRecord.emailVerified,
      }
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message || 'Failed to sign in' });
  }
});

app.get('/api/users', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const pool = await getTenantPool(userEmail);
    
    const result = await pool.query(`
      SELECT email, first_name, last_name, job_title, responsibilities, created_at
      FROM users
      ORDER BY created_at DESC
    `);
    
    // Transform to camelCase and add full name
    const transformed = result.rows.map(row => {
      const user = transformRow(row);
      // Combine first_name and last_name into name field
      const firstName = user.firstName || '';
      const lastName = user.lastName || '';
      user.name = `${firstName} ${lastName}`.trim() || user.email;
      return user;
    });
    
    res.json(transformed);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Specific routes must come before parameterized routes
app.get('/api/users/profile', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const pool = await getTenantPool(userEmail);
    
    const result = await pool.query(`
      SELECT email, first_name, last_name, job_title, timezone, responsibilities, created_at, last_login
      FROM users
      WHERE email = $1
    `, [userEmail]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = transformRow(result.rows[0]);
    const domain = getDomainFromEmail(userEmail);
    res.json({
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      jobTitle: user.jobTitle,
      timezone: user.timezone,
      responsibilities: user.responsibilities,
      domain: domain,
      createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
      lastLogin: user.lastLogin ? new Date(user.lastLogin).toISOString() : null
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.put('/api/users/profile', authenticateUser, async (req, res) => {
  try {
    console.log('📝 [Backend] PUT /api/users/profile - Updating user profile');
    const userEmail = (req as any).userEmail;
    const { jobTitle, timezone, responsibilities } = req.body;
    
    console.log('📝 [Backend] Profile update data:', { 
      userEmail, 
      jobTitle, 
      timezone, 
      hasResponsibilities: !!responsibilities 
    });
    
    // Validate required fields
    if (!jobTitle || !jobTitle.trim()) {
      return res.status(400).json({ error: 'Job title is required' });
    }
    
    if (!timezone) {
      return res.status(400).json({ error: 'Timezone is required' });
    }
    
    const pool = await getTenantPool(userEmail);
    
    // Update user profile
    await pool.query(`
      UPDATE users
      SET job_title = $1, timezone = $2, responsibilities = $3, updated_at = NOW()
      WHERE email = $4
    `, [jobTitle.trim(), timezone, responsibilities || null, userEmail]);
    
    console.log('✅ [Backend] Profile updated successfully for:', userEmail);
    res.json({
      success: true,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    console.error('❌ [Backend] Update user profile error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/users/:email', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const targetEmail = req.params.email;
    const pool = await getTenantPool(userEmail);
    
    const result = await pool.query(`
      SELECT email, first_name, last_name, job_title, responsibilities, created_at, last_login
      FROM users
      WHERE email = $1
    `, [targetEmail]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ============================================================================
// TEAM ENDPOINTS (PostgreSQL)
// ============================================================================

app.get('/api/teams', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const pool = await getTenantPool(userEmail);
    
    const result = await pool.query(`
      SELECT 
        t.id,
        t.name,
        t.description,
        t.avatar,
        t.owner_email,
        t.created_at,
        t.updated_at,
        COALESCE((SELECT json_agg(json_build_object(
          'email', tm.user_email,
          'role', tm.role,
          'avatar', tm.avatar,
          'name', COALESCE(u.first_name || ' ' || u.last_name, tm.user_email)
        )) FROM team_members tm
        LEFT JOIN users u ON tm.user_email = u.email
        WHERE tm.team_id = t.id), '[]'::json) as members,
        (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
      FROM teams t
      ORDER BY t.created_at DESC
    `);
    
    // Transform to camelCase and backfill missing team members
    const transformed = await Promise.all(result.rows.map(async (row) => {
      const team = transformRow(row);
      const ownerEmail = team.ownerEmail || (row as any).owner_email;
      
      // Ensure members is always an array
      const membersArray = Array.isArray(team.members) ? team.members : (team.members ? [team.members] : []);
      const memberList = transformMembers(membersArray);
      // Use member_count from query if available, otherwise use array length
      // member_count is transformed to memberCount by transformRow
      let memberCount = (team as any).memberCount !== undefined ? parseInt((team as any).memberCount) : memberList.length;
      
      // Backfill: If team has no members, add the owner
      if (memberCount === 0 && ownerEmail) {
        try {
          await pool.query(`
            INSERT INTO team_members (team_id, user_email, role)
            VALUES ($1, $2, $3)
            ON CONFLICT (team_id, user_email) DO NOTHING
          `, [team.id, ownerEmail, 'owner']);
          memberCount = 1;
        } catch (error) {
          console.error(`Failed to add owner as member:`, error);
        }
      }
      
      // Ensure we have at least 0 members (not undefined)
      const finalMemberCount = isNaN(memberCount) ? 0 : memberCount;
      
      // Frontend Team interface expects members as number (count)
      team.members = finalMemberCount; // Count for display
      (team as any).memberList = memberList; // Full member list (for detail view if needed)
      (team as any).projects = 0; // Project count (can be calculated later)
      
      // Ensure ownerEmail is set (transformRow should convert owner_email to ownerEmail)
      if (!team.ownerEmail && ownerEmail) {
        team.ownerEmail = ownerEmail;
      }
      
      return team;
    }));
    
    res.json(transformed);
  } catch (error) {
    console.error('Get teams error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Specific routes must come before parameterized routes
// Team join request endpoints - must come before /api/teams/:id to avoid route conflicts
app.post('/api/teams/:teamName/join-request', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const teamName = req.params.teamName;
    const pool = await getTenantPool(userEmail);
    
    // Get team by name
    const teamResult = await pool.query(`
      SELECT id, owner_email FROM teams WHERE name = $1
    `, [teamName]);
    
    if (teamResult.rows.length === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    const team = teamResult.rows[0];
    const teamId = team.id;
    const normalizedUserEmail = userEmail.toLowerCase();
    
    // Check if user is already a member
    const memberCheck = await pool.query(`
      SELECT user_email FROM team_members WHERE team_id = $1 AND user_email = $2
    `, [teamId, normalizedUserEmail]);
    
    if (memberCheck.rows.length > 0) {
      return res.status(400).json({ error: 'You are already a member of this team' });
    }
    
    // Check if there's already a pending request
    const existingRequest = await pool.query(`
      SELECT id FROM team_join_requests 
      WHERE team_id = $1 AND user_email = $2 AND status = 'pending'
    `, [teamId, normalizedUserEmail]);
    
    if (existingRequest.rows.length > 0) {
      return res.status(400).json({ error: 'You already have a pending request for this team' });
    }
    
    // Get user info
    const userResult = await pool.query(`
      SELECT first_name, last_name FROM users WHERE email = $1
    `, [normalizedUserEmail]);
    
    const userData = userResult.rows[0];
    const userName = userData 
      ? `${userData.first_name || ''} ${userData.last_name || ''}`.trim() || normalizedUserEmail
      : normalizedUserEmail;
    
    // Create join request
    const requestResult = await pool.query(`
      INSERT INTO team_join_requests (team_id, user_email, user_name, status, owner_email)
      VALUES ($1, $2, $3, 'pending', $4)
      RETURNING id
    `, [teamId, normalizedUserEmail, userName, team.owner_email]);
    
    res.json({ 
      success: true, 
      requestId: requestResult.rows[0].id,
      message: 'Join request sent successfully'
    });
  } catch (error) {
    console.error('Create join request error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to create join request' });
  }
});

app.get('/api/teams/join-requests', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const pool = await getTenantPool(userEmail);
    
    // Get pending join requests for teams owned by the user
    const result = await pool.query(`
      SELECT 
        tjr.*,
        t.name as team_name,
        t.description as team_description
      FROM team_join_requests tjr
      JOIN teams t ON tjr.team_id = t.id
      WHERE tjr.status = 'pending' AND t.owner_email = $1
      ORDER BY tjr.created_at DESC
    `, [userEmail]);
    
    const requests = result.rows.map(row => {
      const request = transformRow(row);
      return {
        id: request.id,
        teamId: request.teamId,
        teamName: request.teamName,
        teamDescription: request.teamDescription,
        userEmail: request.userEmail,
        userName: request.userName,
        status: request.status,
        ownerEmail: request.ownerEmail,
        createdAt: request.createdAt ? new Date(request.createdAt).toISOString() : null
      };
    });
    
    res.json(requests);
  } catch (error) {
    console.error('Get join requests error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/teams/join-requests/:requestId/approve', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const requestId = req.params.requestId;
    const pool = await getTenantPool(userEmail);
    
    // Get the request with team info
    const requestResult = await pool.query(`
      SELECT 
        jr.*,
        t.id as team_id,
        t.owner_email
      FROM team_join_requests jr
      JOIN teams t ON jr.team_id = t.id
      WHERE jr.id = $1
    `, [requestId]);
    
    if (requestResult.rows.length === 0) {
      return res.status(404).json({ error: 'Join request not found' });
    }
    
    const request = requestResult.rows[0];
    const normalizedUserEmail = userEmail.toLowerCase();
    
    // Verify the user is the owner
    if (request.owner_email?.toLowerCase() !== normalizedUserEmail) {
      return res.status(403).json({ error: 'Only the team owner can approve requests' });
    }
    
    // Check if already processed
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'This request has already been processed' });
    }
    
    // Check if user is already a member
    const memberCheck = await pool.query(`
      SELECT user_email FROM team_members WHERE team_id = $1 AND user_email = $2
    `, [request.team_id, request.user_email]);
    
    if (memberCheck.rows.length > 0) {
      // Just update request status
      await pool.query(
        'UPDATE team_join_requests SET status = $1, processed_by = $2, processed_at = NOW() WHERE id = $3',
        ['approved', normalizedUserEmail, requestId]
      );
      return res.json({ success: true, message: 'User is already a member' });
    }
    
    // Get user info
    const userResult = await pool.query(`
      SELECT first_name, last_name, job_title FROM users WHERE email = $1
    `, [request.user_email]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userResult.rows[0];
    const firstName = userData.first_name || '';
    const lastName = userData.last_name || '';
    const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || request.user_email.charAt(0).toUpperCase();
    
    // Add user to team
    await pool.query(`
      INSERT INTO team_members (team_id, user_email, role, avatar)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (team_id, user_email) DO UPDATE SET
        role = EXCLUDED.role,
        avatar = EXCLUDED.avatar
    `, [request.team_id, request.user_email, userData.job_title || 'member', initials]);
    
    // Update request status
    await pool.query(
      'UPDATE team_join_requests SET status = $1, processed_by = $2, processed_at = NOW() WHERE id = $3',
      ['approved', normalizedUserEmail, requestId]
    );
    
    res.json({ success: true, message: 'Join request approved successfully' });
  } catch (error) {
    console.error('Approve join request error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/teams/join-requests/:requestId/reject', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const requestId = req.params.requestId;
    const pool = await getTenantPool(userEmail);
    
    // Get the request with team info
    const requestResult = await pool.query(`
      SELECT 
        jr.*,
        t.owner_email
      FROM team_join_requests jr
      JOIN teams t ON jr.team_id = t.id
      WHERE jr.id = $1
    `, [requestId]);
    
    if (requestResult.rows.length === 0) {
      return res.status(404).json({ error: 'Join request not found' });
    }
    
    const request = requestResult.rows[0];
    const normalizedUserEmail = userEmail.toLowerCase();
    
    // Verify the user is the owner
    if (request.owner_email?.toLowerCase() !== normalizedUserEmail) {
      return res.status(403).json({ error: 'Only the team owner can reject requests' });
    }
    
    // Check if already processed
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'This request has already been processed' });
    }
    
    // Update request status
    await pool.query(
      'UPDATE team_join_requests SET status = $1, processed_by = $2, processed_at = NOW() WHERE id = $3',
      ['rejected', normalizedUserEmail, requestId]
    );
    
    res.json({ success: true, message: 'Join request rejected' });
  } catch (error) {
    console.error('Reject join request error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/teams/invitations', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const pool = await getTenantPool(userEmail);
    
    // Get pending invitations for the current user
    const result = await pool.query(`
      SELECT 
        ti.*,
        t.name as team_name,
        t.description as team_description
      FROM team_invitations ti
      JOIN teams t ON ti.team_id = t.id
      WHERE ti.invitee_email = $1 AND ti.status = 'pending'
      ORDER BY ti.created_at DESC
    `, [userEmail]);
    
    const invitations = result.rows.map(row => {
      const invitation = transformRow(row);
      return {
        id: invitation.id,
        teamId: invitation.teamId,
        teamName: invitation.teamName,
        teamDescription: invitation.teamDescription,
        inviteeEmail: invitation.inviteeEmail,
        inviterEmail: invitation.inviterEmail,
        inviterName: invitation.inviterName,
        status: invitation.status,
        createdAt: invitation.createdAt ? new Date(invitation.createdAt).toISOString() : null
      };
    });
    
    res.json(invitations);
  } catch (error) {
    console.error('Get invitations error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/teams/:id', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const teamId = req.params.id;
    const pool = await getTenantPool(userEmail);
    
    const result = await pool.query(`
      SELECT 
        t.*,
        COALESCE((SELECT json_agg(json_build_object(
          'email', tm.user_email,
          'role', tm.role,
          'avatar', tm.avatar,
          'name', u.first_name || ' ' || u.last_name
        )) FROM team_members tm
        LEFT JOIN users u ON tm.user_email = u.email
        WHERE tm.team_id = t.id), '[]'::json) as members
      FROM teams t
      WHERE t.id = $1
    `, [teamId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    // Transform to camelCase
    const team = transformRow(result.rows[0]);
    team.members = transformMembers(team.members);
    
    res.json(team);
  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/teams', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const { team, teamDetail } = req.body;
    
    // Extract data from team object (frontend sends { team, teamDetail })
    const name = team?.name || teamDetail?.name;
    const description = team?.description || teamDetail?.description;
    const avatar = team?.avatar || teamDetail?.avatar;
    const teamId = team?.id || teamDetail?.id;
    
    if (!name) {
      return res.status(400).json({ error: 'Team name is required' });
    }
    
    const pool = await getTenantPool(userEmail);
    
    // Normalize email to lowercase (emails are stored in lowercase in users table)
    const normalizedEmail = userEmail.toLowerCase();
    
    // Verify user exists in users table (required for foreign key constraint)
    const userCheck = await pool.query(`
      SELECT email FROM users WHERE email = $1
    `, [normalizedEmail]);
    
    if (userCheck.rows.length === 0) {
      console.error(`❌ User ${normalizedEmail} does not exist in users table`);
      return res.status(400).json({ 
        error: `User ${normalizedEmail} does not exist. Please ensure you are properly registered.` 
      });
    }
    
    // Use provided teamId or generate a new one
    const finalTeamId = teamId || crypto.randomBytes(16).toString('hex');
    
    await pool.query(`
      INSERT INTO teams (id, name, description, avatar, owner_email, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [finalTeamId, name, description, avatar, normalizedEmail]);
    
    // Always add owner as member (owner should always be in team_members table)
    try {
      const ownerResult = await pool.query(`
        INSERT INTO team_members (team_id, user_email, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (team_id, user_email) DO UPDATE SET role = 'owner'
        RETURNING id
      `, [finalTeamId, normalizedEmail, 'owner']);
    } catch (error: any) {
      console.error(`❌ Failed to add owner as member:`, error);
      // Check if it's a foreign key constraint error
      if (error.code === '23503') {
        throw new Error(`User ${normalizedEmail} does not exist in users table. Please ensure the user is registered.`);
      }
      throw error;
    }
    
    // Add all members from teamDetail (excluding owner to avoid duplicate)
    const members = teamDetail?.members || [];
    
    // Add all members from teamDetail
    if (members && members.length > 0) {
      for (const member of members) {
        const memberEmail = member.email?.toLowerCase();
        if (memberEmail && memberEmail !== normalizedEmail) {
          try {
            const memberResult = await pool.query(`
              INSERT INTO team_members (team_id, user_email, role, avatar)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (team_id, user_email) DO NOTHING
              RETURNING id
            `, [finalTeamId, memberEmail, member.role || 'member', member.avatar]);
          } catch (error: any) {
            console.error(`❌ Failed to add member ${memberEmail}:`, error.message);
            // Check if it's a foreign key constraint error
            if (error.code === '23503') {
              console.warn(`⚠️  User ${memberEmail} does not exist in users table, skipping...`);
              // Continue with other members instead of failing
            } else {
              throw error;
            }
          }
        }
      }
    }
    
    // Get member count from database
    const memberCountResult = await pool.query(`
      SELECT COUNT(*) as count FROM team_members WHERE team_id = $1
    `, [finalTeamId]);
    const memberCount = parseInt(memberCountResult.rows[0]?.count || '1');
    
    // Return response in camelCase format matching frontend Team interface
    res.status(201).json({ 
      id: finalTeamId, 
      name, 
      description, 
      avatar, 
      ownerEmail: normalizedEmail,
      members: memberCount,
      projects: 0 // No projects yet
    });
  } catch (error) {
    console.error('Create team error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Remove a member from a team (only for owners)
// NOTE: More specific routes must come before less specific routes like /api/teams/:id
app.delete('/api/teams/:name/members/:memberEmail', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const teamName = req.params.name;
    const memberEmail = decodeURIComponent(req.params.memberEmail).toLowerCase();
    const pool = await getTenantPool(userEmail);
    
    // Get team by name
    const teamResult = await pool.query(`
      SELECT id, owner_email FROM teams WHERE name = $1
    `, [teamName]);
    
    if (teamResult.rows.length === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    const team = teamResult.rows[0];
    const teamId = team.id;
    const ownerEmail = team.owner_email?.toLowerCase();
    const normalizedUserEmail = userEmail.toLowerCase();
    
    // Verify the user is the owner
    if (ownerEmail !== normalizedUserEmail) {
      return res.status(403).json({ error: 'Only the team owner can remove members' });
    }
    
    // Prevent owner from removing themselves
    if (memberEmail === normalizedUserEmail) {
      return res.status(400).json({ error: 'Team owner cannot remove themselves. Transfer ownership first or delete the team.' });
    }
    
    // Check if member exists in team
    const memberCheck = await pool.query(`
      SELECT user_email FROM team_members WHERE team_id = $1 AND user_email = $2
    `, [teamId, memberEmail]);
    
    if (memberCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found in team' });
    }
    
    // Remove member
    await pool.query(`
      DELETE FROM team_members WHERE team_id = $1 AND user_email = $2
    `, [teamId, memberEmail]);
    
    res.json({ success: true, message: 'Member removed successfully' });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Leave a team (for members)
// NOTE: More specific routes must come before less specific routes like /api/teams/:id
app.delete('/api/teams/:name/leave', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const teamName = req.params.name;
    const pool = await getTenantPool(userEmail);
    
    // Get team by name
    const teamResult = await pool.query(`
      SELECT id, owner_email FROM teams WHERE name = $1
    `, [teamName]);
    
    if (teamResult.rows.length === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    const team = teamResult.rows[0];
    const teamId = team.id;
    const ownerEmail = team.owner_email?.toLowerCase();
    const normalizedUserEmail = userEmail.toLowerCase();
    
    // Prevent owner from leaving (they should transfer ownership or delete team)
    if (ownerEmail === normalizedUserEmail) {
      return res.status(400).json({ error: 'Team owner cannot leave the team. Transfer ownership first or delete the team.' });
    }
    
    // Check if user is a member
    const memberCheck = await pool.query(`
      SELECT user_email FROM team_members WHERE team_id = $1 AND user_email = $2
    `, [teamId, normalizedUserEmail]);
    
    if (memberCheck.rows.length === 0) {
      return res.status(400).json({ error: 'You are not a member of this team' });
    }
    
    // Remove user from team
    await pool.query(`
      DELETE FROM team_members WHERE team_id = $1 AND user_email = $2
    `, [teamId, normalizedUserEmail]);
    
    res.json({ success: true, message: 'Left team successfully' });
  } catch (error) {
    console.error('Leave team error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/api/teams/:id', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const teamId = req.params.id;
    const pool = await getTenantPool(userEmail);
    
    // Verify team exists and user is owner
    const teamResult = await pool.query(`
      SELECT owner_email FROM teams WHERE id = $1
    `, [teamId]);
    
    if (teamResult.rows.length === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    const team = teamResult.rows[0];
    if (team.owner_email?.toLowerCase() !== userEmail.toLowerCase()) {
      return res.status(403).json({ error: 'Only the team owner can delete the team' });
    }
    
    // Delete team (team_members and team_join_requests will be cascaded)
    await pool.query('DELETE FROM teams WHERE id = $1', [teamId]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete team error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ============================================================================
// PROJECT ENDPOINTS (PostgreSQL)
// ============================================================================

app.get('/api/projects', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const pool = await getTenantPool(userEmail);
    
    const result = await pool.query(`
      SELECT 
        p.*,
        COALESCE((SELECT json_agg(json_build_object(
          'email', pm.user_email,
          'role', pm.role,
          'avatar', pm.avatar,
          'name', COALESCE(u.first_name || ' ' || u.last_name, pm.user_email)
        )) FROM project_members pm
        LEFT JOIN users u ON pm.user_email = u.email
        WHERE pm.project_id = p.id), '[]'::json) as members,
        COALESCE((SELECT json_agg(json_build_object(
          'id', t.id,
          'title', t.title,
          'description', t.description,
          'status', t.status,
          'priority', t.priority,
          'assigneeId', t.assignee_id,
          'assignee', t.assignee_name,
          'assigneeAvatar', t.assignee_avatar,
          'dueDate', CASE WHEN t.due_date IS NOT NULL THEN t.due_date::text ELSE NULL END,
          'createdDate', CASE WHEN t.created_date IS NOT NULL THEN t.created_date::text ELSE NULL END,
          'createdAt', t.created_at,
          'tags', t.tags,
          'reason', t.reason,
          'projectId', t.project_id,
          'project', p2.name
        ) ORDER BY 
          CASE t.status
            WHEN 'todo' THEN 1
            WHEN 'in-progress' THEN 2
            WHEN 'review' THEN 3
            WHEN 'blocked' THEN 4
            WHEN 'completed' THEN 5
            ELSE 6
          END,
          t.created_at DESC) FROM tasks t
        LEFT JOIN projects p2 ON t.project_id = p2.id
        WHERE t.project_id = p.id), '[]'::json) as tasks
      FROM projects p
      ORDER BY p.created_at DESC
    `);
    
    // Transform to camelCase and fix members structure
    const transformed = result.rows.map(row => {
      const project = transformRow(row);
      project.members = transformMembers(project.members || []);
      
      // Ensure arrays are always arrays, never null
      project.tasks = Array.isArray(project.tasks) ? project.tasks : [];
      project.progressUpdates = [];
      project.comments = [];
      
      // Transform tasks (already in camelCase from JSON query, just need to parse tags and add defaults)
      project.tasks = project.tasks.map((task: any) => {
        // Tasks are already in camelCase from JSON query
        task.tags = Array.isArray(task.tags) ? task.tags : (task.tags ? (typeof task.tags === 'string' ? JSON.parse(task.tags) : []) : []);
        task.progressUpdates = [];
        task.comments = [];
        task.dueDate = task.dueDate ? (typeof task.dueDate === 'string' ? task.dueDate.split('T')[0] : new Date(task.dueDate).toISOString().split('T')[0]) : null;
        task.createdDate = task.createdDate ? (typeof task.createdDate === 'string' ? task.createdDate.split('T')[0] : new Date(task.createdDate).toISOString().split('T')[0]) : null;
        return task;
      });
      
      // Add default values for missing fields
      project.detailedDescription = project.detailedDescription || project.description || '';
      project.statusColor = project.statusColor || '#3b82f6';
      // Frontend uses project.team to display member count (members are already transformed above)
      project.team = Array.isArray(project.members) ? project.members.length : 0;
      project.summary = project.summary || {
        accomplishment: '',
        decision: '',
        risk: '',
        direction: ''
      };
      // Format dates
      project.dueDate = project.dueDate ? (typeof project.dueDate === 'string' ? project.dueDate.split('T')[0] : new Date(project.dueDate).toISOString().split('T')[0]) : null;
      project.createdDate = project.createdDate ? (typeof project.createdDate === 'string' ? project.createdDate.split('T')[0] : new Date(project.createdDate).toISOString().split('T')[0]) : (project.createdAt ? new Date(project.createdAt).toISOString().split('T')[0] : null);
      return project;
    });
    
    res.json(transformed);
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/projects/:id', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const projectId = req.params.id;
    const pool = await getTenantPool(userEmail);
    
    const result = await pool.query(`
      SELECT 
        p.id,
        p.name,
        p.description,
        p.team_id,
        p.status,
        p.priority,
        p.start_date,
        p.end_date,
        CASE WHEN p.due_date IS NOT NULL THEN p.due_date::text ELSE NULL END as due_date,
        p.owner_email,
        p.created_at,
        p.updated_at,
        COALESCE((SELECT json_agg(json_build_object(
          'email', pm.user_email,
          'role', pm.role,
          'avatar', pm.avatar,
          'name', u.first_name || ' ' || u.last_name
        )) FROM project_members pm
        LEFT JOIN users u ON pm.user_email = u.email
        WHERE pm.project_id = p.id), '[]'::json) as members,
        COALESCE((SELECT json_agg(json_build_object(
          'id', pc.id,
          'memberName', pc.member_name,
          'memberAvatar', pc.member_avatar,
          'date', pc.date,
          'comment', pc.comment
        ) ORDER BY pc.created_at DESC) FROM project_comments pc WHERE pc.project_id = p.id), '[]'::json) as comments,
        COALESCE((SELECT json_agg(json_build_object(
          'id', upd.update_id,
          'memberName', COALESCE(u.first_name || ' ' || u.last_name, upd.user_id),
          'memberAvatar', COALESCE(
            CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL 
              THEN UPPER(SUBSTRING(u.first_name, 1, 1) || SUBSTRING(u.last_name, 1, 1))
              ELSE UPPER(SUBSTRING(upd.user_id, 1, 2))
            END,
            'U'
          ),
          'date', upd.date_id,
          'update', upd.update_text,
          'type', 'progress'
        ) ORDER BY upd.timestamp DESC) FROM task_progress_updates upd
        LEFT JOIN users u ON upd.user_id = u.email
        WHERE upd.project_id = p.id), '[]'::json) as progressUpdates,
        COALESCE((SELECT json_agg(json_build_object(
          'id', t.id,
          'title', t.title,
          'description', t.description,
          'status', t.status,
          'priority', t.priority,
          'assigneeId', t.assignee_id,
          'assignee', t.assignee_name,
          'assigneeAvatar', t.assignee_avatar,
          'dueDate', CASE WHEN t.due_date IS NOT NULL THEN t.due_date::text ELSE NULL END,
          'createdDate', CASE WHEN t.created_date IS NOT NULL THEN t.created_date::text ELSE NULL END,
          'createdAt', t.created_at,
          'tags', t.tags,
          'reason', t.reason,
          'projectId', t.project_id,
          'project', p2.name
        ) ORDER BY 
          CASE t.status
            WHEN 'todo' THEN 1
            WHEN 'in-progress' THEN 2
            WHEN 'review' THEN 3
            WHEN 'blocked' THEN 4
            WHEN 'completed' THEN 5
            ELSE 6
          END,
          t.created_at DESC) FROM tasks t
        LEFT JOIN projects p2 ON t.project_id = p2.id
        WHERE t.project_id = p.id), '[]'::json) as tasks
      FROM projects p
      WHERE p.id = $1
    `, [projectId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Transform to camelCase
    const project = transformRow(result.rows[0]);
    project.members = transformMembers(project.members || []);
    
    // Ensure arrays are always arrays, never null
    project.comments = Array.isArray(project.comments) ? project.comments : [];
    project.progressUpdates = Array.isArray(project.progressUpdates) ? project.progressUpdates : [];
    project.tasks = Array.isArray(project.tasks) ? project.tasks : [];
    
    // Transform tasks
    project.tasks = project.tasks.map((task: any) => {
      const transformedTask = transformRow(task);
      transformedTask.tags = Array.isArray(transformedTask.tags) ? transformedTask.tags : (transformedTask.tags ? (typeof transformedTask.tags === 'string' ? JSON.parse(transformedTask.tags) : []) : []);
      transformedTask.progressUpdates = [];
      transformedTask.comments = [];
      transformedTask.dueDate = transformedTask.dueDate ? (typeof transformedTask.dueDate === 'string' ? transformedTask.dueDate.split('T')[0] : new Date(transformedTask.dueDate).toISOString().split('T')[0]) : null;
      transformedTask.createdDate = transformedTask.createdDate ? (typeof transformedTask.createdDate === 'string' ? transformedTask.createdDate.split('T')[0] : new Date(transformedTask.createdDate).toISOString().split('T')[0]) : null;
      return transformedTask;
    });
    
    // Transform progressUpdates to ensure proper format
    project.progressUpdates = project.progressUpdates.map((update: any) => {
      // Updates are already in camelCase from JSON query
      return {
        id: update.id || update.updateId || '',
        memberName: update.memberName || '',
        memberAvatar: update.memberAvatar || '',
        date: update.date ? (typeof update.date === 'string' ? update.date.split('T')[0] : new Date(update.date).toISOString().split('T')[0]) : new Date().toISOString().split('T')[0],
        update: update.update || update.updateText || '',
        type: update.type || 'progress'
      };
    });
    
    // Transform comments to ensure proper format
    project.comments = project.comments.map((comment: any) => {
      const transformed = transformRow(comment);
      return {
        id: transformed.id || '',
        memberName: transformed.memberName || '',
        memberAvatar: transformed.memberAvatar || '',
        date: transformed.date || new Date().toISOString().split('T')[0],
        comment: transformed.comment || ''
      };
    });
    
    project.detailedDescription = project.detailedDescription || project.description || '';
    project.statusColor = project.statusColor || '#3b82f6';
    // Frontend uses project.team to display member count (members are already transformed above)
    project.team = Array.isArray(project.members) ? project.members.length : 0;
    project.summary = project.summary || {
      accomplishment: '',
      decision: '',
      risk: '',
      direction: ''
    };
    // Format dates
    // Handle dueDate (DATE field)
    if (project.dueDate) {
      if (typeof project.dueDate === 'string') {
        project.dueDate = project.dueDate.split('T')[0]; // Already formatted as YYYY-MM-DD
      } else if (project.dueDate instanceof Date) {
        project.dueDate = project.dueDate.toISOString().split('T')[0];
      } else {
        // Try to parse as date
        const date = new Date(project.dueDate);
        if (!isNaN(date.getTime())) {
          project.dueDate = date.toISOString().split('T')[0];
        } else {
          project.dueDate = null;
        }
      }
    } else {
      project.dueDate = null;
    }
    
    // Handle createdDate (DATE field) or use created_at (TIMESTAMP) as fallback
    if (project.createdDate) {
      if (typeof project.createdDate === 'string') {
        project.createdDate = project.createdDate.split('T')[0];
      } else if (project.createdDate instanceof Date) {
        project.createdDate = project.createdDate.toISOString().split('T')[0];
      } else {
        const date = new Date(project.createdDate);
        if (!isNaN(date.getTime())) {
          project.createdDate = date.toISOString().split('T')[0];
        } else {
          project.createdDate = null;
        }
      }
    } else if (project.createdAt) {
      // Fallback to created_at (TIMESTAMP)
      const timestamp = project.createdAt instanceof Date 
        ? project.createdAt.getTime() 
        : (typeof project.createdAt === 'string' ? new Date(project.createdAt).getTime() : project.createdAt);
      if (!isNaN(timestamp)) {
        project.createdDate = new Date(timestamp).toISOString().split('T')[0];
      } else {
        project.createdDate = null;
      }
    } else {
      project.createdDate = null;
    }
    
    res.json(project);
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/projects', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const pool = await getTenantPool(userEmail);
    
    // Extract data from project object (frontend sends full Project object)
    const project = req.body;
    const name = project?.name;
    const description = project?.description || '';
    const teamId = project?.teamId || null; // Can be null if project is not tied to a specific team
    const status = project?.status || 'active';
    const priority = project?.priority || 'medium';
    const dueDate = project?.dueDate || null;
    
    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    
    // Normalize email to lowercase
    const normalizedEmail = userEmail.toLowerCase();
    
    // Use provided project ID or generate a new one
    const projectId = project?.id || crypto.randomBytes(16).toString('hex');
    
    // Insert project
    await pool.query(`
      INSERT INTO projects (id, name, description, team_id, status, priority, owner_email, due_date, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `, [projectId, name, description, teamId, status, priority, normalizedEmail, dueDate]);
    
    // Add project members if provided
    const members = project?.members || [];
    if (members && members.length > 0) {
      for (const member of members) {
        if (member.email) {
          try {
            const memberEmail = member.email.toLowerCase();
            await pool.query(`
              INSERT INTO project_members (project_id, user_email, role, avatar)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (project_id, user_email) DO NOTHING
            `, [projectId, memberEmail, member.role || 'member', member.avatar]);
          } catch (error: any) {
            console.error(`❌ Failed to add project member ${member.email}:`, error.message);
            // Continue with other members instead of failing
          }
        }
      }
    }
    
    // Always add owner as project member (owner should always be in project_members table)
    try {
      const ownerResult = await pool.query(`
        INSERT INTO project_members (project_id, user_email, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (project_id, user_email) DO UPDATE SET role = 'owner'
        RETURNING id
      `, [projectId, normalizedEmail, 'owner']);
    } catch (error: any) {
      console.error(`❌ Failed to add owner as project member:`, error);
      // Check if it's a foreign key constraint error
      if (error.code === '23503') {
        throw new Error(`User ${normalizedEmail} does not exist in users table. Please ensure the user is registered.`);
      }
      throw error;
    }
    
    // Get member count
    const memberCountResult = await pool.query(`
      SELECT COUNT(*) as count FROM project_members WHERE project_id = $1
    `, [projectId]);
    const memberCount = parseInt(memberCountResult.rows[0]?.count || '1');
    
    // Return response matching frontend Project interface
    res.status(201).json({ 
      id: projectId, 
      name, 
      description, 
      teamId,
      status, 
      priority,
      ownerEmail: normalizedEmail,
      dueDate,
      members: memberCount
    });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.patch('/api/projects/:id', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const projectId = req.params.id;
    const updates = req.body;
    const pool = await getTenantPool(userEmail);
    
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    
    // Map camelCase to snake_case for database
    // Note: ownerEmail is intentionally excluded - owner_email should always be the creator and cannot be changed
    const fieldMap: { [key: string]: string } = {
      name: 'name',
      description: 'description',
      teamId: 'team_id',
      status: 'status',
      priority: 'priority',
      dueDate: 'due_date',
      startDate: 'start_date',
      endDate: 'end_date'
    };
    
    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'id' && fieldMap[key]) {
        const dbField = fieldMap[key];
        setClauses.push(`${dbField} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });
    
    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    setClauses.push(`updated_at = NOW()`);
    values.push(projectId);
    
    await pool.query(`
      UPDATE projects 
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
    `, values);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/api/projects/:id', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const projectId = req.params.id;
    const pool = await getTenantPool(userEmail);
    
    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Add project member
app.post('/api/projects/:id/members', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const projectId = req.params.id;
    const { memberEmail, role, avatar } = req.body;
    const pool = await getTenantPool(userEmail);
    
    // Verify user is the project owner
    const projectResult = await pool.query(
      'SELECT owner_email FROM projects WHERE id = $1',
      [projectId]
    );
    
    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    if (projectResult.rows[0].owner_email.toLowerCase() !== userEmail.toLowerCase()) {
      return res.status(403).json({ error: 'Only project owner can add members' });
    }
    
    if (!memberEmail) {
      return res.status(400).json({ error: 'memberEmail is required' });
    }
    
    const normalizedMemberEmail = memberEmail.toLowerCase();
    
    // Check if user exists
    const userResult = await pool.query(
      'SELECT email FROM users WHERE email = $1',
      [normalizedMemberEmail]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get user's name for avatar generation
    const user = userResult.rows[0];
    const userNameResult = await pool.query(
      'SELECT first_name, last_name FROM users WHERE email = $1',
      [normalizedMemberEmail]
    );
    
    let generatedAvatar = avatar;
    if (!generatedAvatar && userNameResult.rows.length > 0) {
      const firstName = userNameResult.rows[0].first_name || '';
      const lastName = userNameResult.rows[0].last_name || '';
      if (firstName && lastName) {
        generatedAvatar = (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
      } else {
        generatedAvatar = normalizedMemberEmail.substring(0, 2).toUpperCase();
      }
    }
    
    // Add member to project
    await pool.query(`
      INSERT INTO project_members (project_id, user_email, role, avatar)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (project_id, user_email) DO UPDATE SET
        role = EXCLUDED.role,
        avatar = EXCLUDED.avatar
    `, [projectId, normalizedMemberEmail, role || 'member', generatedAvatar || null]);
    
    // Get updated member info
    const memberResult = await pool.query(`
      SELECT 
        pm.user_email as email,
        pm.role,
        pm.avatar,
        u.first_name || ' ' || u.last_name as name
      FROM project_members pm
      LEFT JOIN users u ON pm.user_email = u.email
      WHERE pm.project_id = $1 AND pm.user_email = $2
    `, [projectId, normalizedMemberEmail]);
    
    const member = memberResult.rows[0];
    
    res.json({
      success: true,
      member: {
        id: member.email,
        email: member.email,
        name: member.name || member.email,
        role: member.role || 'member',
        avatar: member.avatar || generatedAvatar || 'U'
      }
    });
  } catch (error) {
    console.error('Add project member error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Remove project member
app.delete('/api/projects/:id/members/:memberEmail', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const projectId = req.params.id;
    const memberEmail = req.params.memberEmail.toLowerCase();
    const pool = await getTenantPool(userEmail);
    
    // Verify project exists
    const projectResult = await pool.query(
      'SELECT owner_email FROM projects WHERE id = $1',
      [projectId]
    );
    
    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const ownerEmail = projectResult.rows[0].owner_email.toLowerCase();
    const isOwner = ownerEmail === userEmail.toLowerCase();
    const isRemovingSelf = memberEmail === userEmail.toLowerCase();
    
    // Only owner can remove members, or user can remove themselves
    if (!isOwner && !isRemovingSelf) {
      return res.status(403).json({ error: 'Only project owner can remove members, or you can remove yourself' });
    }
    
    // Prevent removing the owner
    if (memberEmail === ownerEmail) {
      return res.status(400).json({ error: 'Cannot remove project owner' });
    }
    
    // Remove member from project
    await pool.query(
      'DELETE FROM project_members WHERE project_id = $1 AND user_email = $2',
      [projectId, memberEmail]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Remove project member error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ============================================================================
// TASK ENDPOINTS (PostgreSQL)
// ============================================================================

app.get('/api/tasks', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const pool = await getTenantPool(userEmail);
    
    const result = await pool.query(`
      SELECT 
        t.id,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.assignee_id,
        COALESCE(t.assignee_name, u.first_name || ' ' || u.last_name) as assignee_name,
        COALESCE(t.assignee_avatar, 
          CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL 
            THEN UPPER(SUBSTRING(u.first_name, 1, 1) || SUBSTRING(u.last_name, 1, 1))
            ELSE NULL
          END
        ) as assignee_avatar,
        t.project_id,
        COALESCE(t.project_name, p.name) as project_name,
        t.created_by,
        CASE WHEN t.due_date IS NOT NULL THEN t.due_date::text ELSE NULL END as due_date,
        CASE WHEN t.created_date IS NOT NULL THEN t.created_date::text ELSE NULL END as created_date,
        t.created_at,
        t.estimated_hours,
        t.actual_hours,
        t.tags,
        t.reason,
        t.updated_at,
        p.team_id,
        (SELECT COALESCE(json_agg(update_data), '[]'::json) FROM (
          SELECT json_build_object(
            'id', upd.update_id,
            'memberName', COALESCE(u2.first_name || ' ' || u2.last_name, upd.user_id),
            'memberAvatar', COALESCE(
              CASE WHEN u2.first_name IS NOT NULL AND u2.last_name IS NOT NULL 
                THEN UPPER(SUBSTRING(u2.first_name, 1, 1) || SUBSTRING(u2.last_name, 1, 1))
                ELSE UPPER(SUBSTRING(upd.user_id, 1, 2))
              END,
              'U'
            ),
            'date', CASE WHEN upd.date_id IS NOT NULL THEN upd.date_id::text ELSE NULL END,
            'update', upd.update_text,
            'type', 'progress'
          ) as update_data
          FROM task_progress_updates upd
          LEFT JOIN users u2 ON upd.user_id = u2.email
          WHERE upd.associated_tasks @> jsonb_build_array(t.id)
          ORDER BY upd.timestamp DESC
          LIMIT 1
        ) latest_update) as progressUpdates
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assignee_id = u.email
      ORDER BY 
        CASE t.status
          WHEN 'todo' THEN 1
          WHEN 'in-progress' THEN 2
          WHEN 'review' THEN 3
          WHEN 'blocked' THEN 4
          WHEN 'completed' THEN 5
          ELSE 6
        END,
        t.created_at DESC
    `);
    
    // Transform to camelCase
    const transformed = result.rows.map(row => {
      const task = transformRow(row);
      // Map fields to frontend expectations
      task.assigneeId = task.assigneeId || null;
      task.assignee = task.assigneeName || null;
      task.assigneeAvatar = task.assigneeAvatar || null;
      
      // If assigneeId exists but assignee is still null, use email as fallback
      if (task.assigneeId && !task.assignee) {
        task.assignee = task.assigneeId;
        task.assigneeAvatar = task.assigneeId.charAt(0).toUpperCase();
      }
      
      // Format dueDate (DATE field)
      if (task.dueDate) {
        if (typeof task.dueDate === 'string') {
          task.dueDate = task.dueDate.split('T')[0];
        } else {
          task.dueDate = new Date(task.dueDate).toISOString().split('T')[0];
        }
      } else {
        task.dueDate = null;
      }
      
      // Format createdDate (DATE field) or use created_at (BIGINT timestamp) as fallback
      if (task.createdDate) {
        if (typeof task.createdDate === 'string') {
          task.createdDate = task.createdDate.split('T')[0];
        } else {
          task.createdDate = new Date(task.createdDate).toISOString().split('T')[0];
        }
      } else if (task.createdAt) {
        // Fallback to created_at (BIGINT timestamp in milliseconds)
        const timestamp = typeof task.createdAt === 'number' ? task.createdAt : parseInt(task.createdAt);
        if (!isNaN(timestamp)) {
          task.createdDate = new Date(timestamp).toISOString().split('T')[0];
        } else {
          task.createdDate = null;
        }
      } else {
        task.createdDate = null;
      }
      
      // Add required arrays
      task.tags = Array.isArray(task.tags) ? task.tags : (task.tags ? JSON.parse(task.tags) : []);
      
      // Handle progressUpdates - PostgreSQL converts unquoted identifiers to lowercase
      // So progressUpdates becomes progressupdates after transformRow
      if (!task.progressUpdates) {
        const rawProgressUpdates = row.progressupdates || row.progressUpdates;
        if (rawProgressUpdates !== undefined && rawProgressUpdates !== null) {
          task.progressUpdates = rawProgressUpdates;
        }
      }
      
      // Handle progressUpdates - it comes as JSON from the SQL query
      if (task.progressUpdates && typeof task.progressUpdates === 'string') {
        try {
          task.progressUpdates = JSON.parse(task.progressUpdates);
        } catch (e) {
          task.progressUpdates = [];
        }
      }
      
      // Ensure progressUpdates is an array and format dates
      if (task.progressUpdates && Array.isArray(task.progressUpdates)) {
        task.progressUpdates = task.progressUpdates.map((update: any) => {
          let formattedDate = null;
          if (update.date) {
            if (typeof update.date === 'string') {
              formattedDate = update.date.split('T')[0];
            } else if (update.date instanceof Date) {
              formattedDate = update.date.toISOString().split('T')[0];
            } else {
              formattedDate = String(update.date).split('T')[0];
            }
          }
          
          return {
            id: update.id || update.update_id || '',
            memberName: update.memberName || '',
            memberAvatar: update.memberAvatar || 'U',
            date: formattedDate,
            update: update.update || update.update_text || '',
            type: update.type || 'progress'
          };
        });
      } else {
        task.progressUpdates = [];
      }
      
      task.comments = task.comments || [];
      task.project = task.projectName || null;
      return task;
    });
    
    res.json(transformed);
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/tasks/project/:projectId', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const projectId = req.params.projectId;
    const pool = await getTenantPool(userEmail);
    
    const result = await pool.query(`
      SELECT 
        t.id,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.assignee_id,
        COALESCE(t.assignee_name, u.first_name || ' ' || u.last_name) as assignee_name,
        COALESCE(t.assignee_avatar, 
          CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL 
            THEN UPPER(SUBSTRING(u.first_name, 1, 1) || SUBSTRING(u.last_name, 1, 1))
            ELSE NULL
          END
        ) as assignee_avatar,
        t.project_id,
        COALESCE(t.project_name, p.name) as project_name,
        t.created_by,
        CASE WHEN t.due_date IS NOT NULL THEN t.due_date::text ELSE NULL END as due_date,
        CASE WHEN t.created_date IS NOT NULL THEN t.created_date::text ELSE NULL END as created_date,
        t.created_at,
        t.estimated_hours,
        t.actual_hours,
        t.tags,
        t.reason,
        t.updated_at,
        p.team_id
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assignee_id = u.email
      WHERE t.project_id = $1
      ORDER BY 
        CASE t.status
          WHEN 'todo' THEN 1
          WHEN 'in-progress' THEN 2
          WHEN 'review' THEN 3
          WHEN 'blocked' THEN 4
          WHEN 'completed' THEN 5
          ELSE 6
        END,
        t.created_at DESC
    `, [projectId]);
    
    // Transform to camelCase
    const transformed = result.rows.map(row => {
      const task = transformRow(row);
      task.assigneeId = task.assigneeId || null;
      task.assignee = task.assigneeName || null;
      task.assigneeAvatar = task.assigneeAvatar || null;
      
      // If assigneeId exists but assignee is still null, use email as fallback
      if (task.assigneeId && !task.assignee) {
        task.assignee = task.assigneeId;
        task.assigneeAvatar = task.assigneeId.charAt(0).toUpperCase();
      }
      
      // Format dueDate (DATE field)
      if (task.dueDate) {
        if (typeof task.dueDate === 'string') {
          task.dueDate = task.dueDate.split('T')[0];
        } else {
          task.dueDate = new Date(task.dueDate).toISOString().split('T')[0];
        }
      } else {
        task.dueDate = null;
      }
      
      // Format createdDate (DATE field) or use created_at (BIGINT timestamp) as fallback
      if (task.createdDate) {
        if (typeof task.createdDate === 'string') {
          task.createdDate = task.createdDate.split('T')[0];
        } else {
          task.createdDate = new Date(task.createdDate).toISOString().split('T')[0];
        }
      } else if (task.createdAt) {
        // Fallback to created_at (BIGINT timestamp in milliseconds)
        const timestamp = typeof task.createdAt === 'number' ? task.createdAt : parseInt(task.createdAt);
        if (!isNaN(timestamp)) {
          task.createdDate = new Date(timestamp).toISOString().split('T')[0];
        } else {
          task.createdDate = null;
        }
      } else {
        task.createdDate = null;
      }
      
      // Add required arrays
      task.tags = Array.isArray(task.tags) ? task.tags : (task.tags ? JSON.parse(task.tags) : []);
      task.progressUpdates = task.progressUpdates || [];
      task.comments = task.comments || [];
      task.project = task.projectName || null;
      return task;
    });
    
    res.json(transformed);
  } catch (error) {
    console.error('Get tasks by project error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/tasks/:id', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const taskId = req.params.id;
    const pool = await getTenantPool(userEmail);
    
    const result = await pool.query(`
      SELECT 
        t.id,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.assignee_id,
        COALESCE(t.assignee_name, u.first_name || ' ' || u.last_name) as assignee_name,
        COALESCE(t.assignee_avatar, 
          CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL 
            THEN UPPER(SUBSTRING(u.first_name, 1, 1) || SUBSTRING(u.last_name, 1, 1))
            ELSE NULL
          END
        ) as assignee_avatar,
        t.project_id,
        COALESCE(t.project_name, p.name) as project_name,
        t.created_by,
        CASE WHEN t.due_date IS NOT NULL THEN t.due_date::text ELSE NULL END as due_date,
        CASE WHEN t.created_date IS NOT NULL THEN t.created_date::text ELSE NULL END as created_date,
        t.created_at,
        t.estimated_hours,
        t.actual_hours,
        t.tags,
        t.reason,
        t.updated_at,
        p.team_id,
        (SELECT json_agg(json_build_object(
          'id', tc.id,
          'memberName', tc.member_name,
          'memberAvatar', tc.member_avatar,
          'date', tc.date,
          'comment', tc.comment
        ) ORDER BY tc.created_at DESC) FROM task_comments tc WHERE tc.task_id = t.id) as comments,
        COALESCE((SELECT json_agg(json_build_object(
          'id', upd.update_id,
          'memberName', COALESCE(u2.first_name || ' ' || u2.last_name, upd.user_id),
          'memberAvatar', COALESCE(
            CASE WHEN u2.first_name IS NOT NULL AND u2.last_name IS NOT NULL 
              THEN UPPER(SUBSTRING(u2.first_name, 1, 1) || SUBSTRING(u2.last_name, 1, 1))
              ELSE UPPER(SUBSTRING(upd.user_id, 1, 2))
            END,
            'U'
          ),
          'date', CASE WHEN upd.date_id IS NOT NULL THEN upd.date_id::text ELSE NULL END,
          'update', upd.update_text,
          'type', 'progress'
        ) ORDER BY upd.timestamp DESC) FROM task_progress_updates upd
        LEFT JOIN users u2 ON upd.user_id = u2.email
        WHERE upd.associated_tasks @> $2::jsonb), '[]'::json) as progressUpdates
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assignee_id = u.email
      WHERE t.id = $1
    `, [taskId, JSON.stringify([taskId])]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Transform to camelCase
    const task = transformRow(result.rows[0]);
    
    // Handle progressUpdates - it comes as JSON from the SQL query
    // transformRow converts progressUpdates (already camelCase) correctly, but we need to ensure it's parsed
    if (task.progressUpdates && typeof task.progressUpdates === 'string') {
      try {
        task.progressUpdates = JSON.parse(task.progressUpdates);
      } catch (e) {
        console.error('Error parsing progressUpdates:', e);
        task.progressUpdates = [];
      }
    }
    
    // If progressUpdates is still undefined, check if it's in the raw row with different casing
    // PostgreSQL converts unquoted identifiers to lowercase, so progressUpdates becomes progressupdates
    if (task.progressUpdates === undefined) {
      // Check both lowercase and camelCase versions
      const rawProgressUpdates = result.rows[0].progressupdates || result.rows[0].progressUpdates;
      if (rawProgressUpdates !== undefined && rawProgressUpdates !== null) {
        task.progressUpdates = rawProgressUpdates;
      } else {
        task.progressUpdates = [];
      }
    }
    
    task.assigneeId = task.assigneeId || null;
    task.assignee = task.assigneeName || null;
    task.assigneeAvatar = task.assigneeAvatar || null;
    
    // If assigneeId exists but assignee is still null, use email as fallback
    if (task.assigneeId && !task.assignee) {
      task.assignee = task.assigneeId;
      task.assigneeAvatar = task.assigneeId.charAt(0).toUpperCase();
    }
    
    // Format dueDate (DATE field)
    if (task.dueDate) {
      if (typeof task.dueDate === 'string') {
        task.dueDate = task.dueDate.split('T')[0]; // Already formatted
      } else {
        task.dueDate = new Date(task.dueDate).toISOString().split('T')[0];
      }
    } else {
      task.dueDate = null;
    }
    
    // Format createdDate (DATE field) or use created_at (BIGINT timestamp) as fallback
    if (task.createdDate) {
      if (typeof task.createdDate === 'string') {
        task.createdDate = task.createdDate.split('T')[0];
      } else {
        task.createdDate = new Date(task.createdDate).toISOString().split('T')[0];
      }
    } else if (task.createdAt) {
      // Fallback to created_at (BIGINT timestamp in milliseconds)
      const timestamp = typeof task.createdAt === 'number' ? task.createdAt : parseInt(task.createdAt);
      if (!isNaN(timestamp)) {
        task.createdDate = new Date(timestamp).toISOString().split('T')[0];
      } else {
        task.createdDate = null;
      }
    } else {
      task.createdDate = null;
    }
    
    // Add required arrays
    task.tags = Array.isArray(task.tags) ? task.tags : (task.tags ? JSON.parse(task.tags) : []);
    // Ensure progressUpdates is an array and format dates
    // progressUpdates comes from the JSON aggregation in the SQL query
    if (task.progressUpdates && Array.isArray(task.progressUpdates)) {
      task.progressUpdates = task.progressUpdates.map((update: any) => {
        // Handle date formatting - date_id might be a Date object or string
        let formattedDate = null;
        if (update.date) {
          if (typeof update.date === 'string') {
            formattedDate = update.date.split('T')[0]; // Remove time portion if present
          } else if (update.date instanceof Date) {
            formattedDate = update.date.toISOString().split('T')[0];
          } else {
            formattedDate = String(update.date).split('T')[0];
          }
        }
        
        return {
          id: update.id || update.update_id || '',
          memberName: update.memberName || '',
          memberAvatar: update.memberAvatar || 'U',
          date: formattedDate,
          update: update.update || update.update_text || '',
          type: update.type || 'progress'
        };
      });
    } else {
      task.progressUpdates = [];
    }
    task.comments = task.comments || [];
    task.project = task.projectName || null;
    
    res.json(task);
  } catch (error) {
    console.error('Get task error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/tasks', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const { title, description, projectId, projectName, assigneeId, assignee, assigneeAvatar, status, priority, dueDate, tags, reason, estimatedHours } = req.body;
    const pool = await getTenantPool(userEmail);
    
    // If assigneeId is provided but assignee/assigneeAvatar are not, look up the user
    let finalAssignee = assignee;
    let finalAssigneeAvatar = assigneeAvatar;
    
    if (assigneeId && !finalAssignee) {
      try {
        const assigneeUser = await pool.query(
          'SELECT first_name, last_name FROM users WHERE email = $1',
          [assigneeId.toLowerCase()]
        );
        
        if (assigneeUser.rows.length > 0) {
          const user = assigneeUser.rows[0];
          const firstName = user.first_name || '';
          const lastName = user.last_name || '';
          finalAssignee = `${firstName} ${lastName}`.trim() || assigneeId;
          finalAssigneeAvatar = (firstName && lastName) 
            ? `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
            : assigneeId.charAt(0).toUpperCase();
        } else {
          // User not found, use email as fallback
          finalAssignee = assigneeId;
          finalAssigneeAvatar = assigneeId.charAt(0).toUpperCase();
        }
      } catch (error) {
        console.error('Error looking up assignee user:', error);
        // Fallback to email if lookup fails
        finalAssignee = assigneeId;
        finalAssigneeAvatar = assigneeId.charAt(0).toUpperCase();
      }
    }
    
    // If projectId is provided but projectName is not, look up the project
    let finalProjectName = projectName;
    
    if (projectId && !finalProjectName) {
      try {
        const projectResult = await pool.query(
          'SELECT name FROM projects WHERE id = $1',
          [projectId]
        );
        
        if (projectResult.rows.length > 0) {
          finalProjectName = projectResult.rows[0].name;
        }
      } catch (error) {
        console.error('Error looking up project:', error);
        // If lookup fails, projectName will remain null
      }
    }
    
    const taskId = crypto.randomBytes(16).toString('hex');
    
    await pool.query(`
      INSERT INTO tasks (
        id, title, description, project_id, project_name, assignee_id, assignee_name, assignee_avatar, status, 
        priority, due_date, created_by, created_at, tags, reason, estimated_hours
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `, [
      taskId, 
      title, 
      description, 
      projectId || null,
      finalProjectName || null,
      assigneeId || null,
      finalAssignee || null,
      finalAssigneeAvatar || null,
      status || 'todo',
      priority || 'medium',
      dueDate || null,
      userEmail,
      Date.now(),
      tags ? JSON.stringify(tags) : null,
      reason || null,
      estimatedHours || null
    ]);
    
    res.status(201).json({ id: taskId, title, description, projectId, assigneeId, status, priority });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.put('/api/tasks/:id', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const taskId = req.params.id;
    const updates = req.body;
    const pool = await getTenantPool(userEmail);
    
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    
    // Map camelCase to snake_case for database
    const fieldMap: { [key: string]: string } = {
      title: 'title',
      description: 'description',
      projectId: 'project_id',
      assigneeId: 'assignee_id',
      assigneeName: 'assignee_name',
      assigneeAvatar: 'assignee_avatar',
      status: 'status',
      priority: 'priority',
      dueDate: 'due_date',
      createdDate: 'created_date',
      createdBy: 'created_by',
      estimatedHours: 'estimated_hours',
      actualHours: 'actual_hours',
      reason: 'reason'
    };
    
    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'id' && fieldMap[key]) {
        const dbField = fieldMap[key];
        // Handle tags as JSONB
        if (key === 'tags' && Array.isArray(value)) {
          setClauses.push(`tags = $${paramIndex}::jsonb`);
          values.push(JSON.stringify(value));
        } else {
          setClauses.push(`${dbField} = $${paramIndex}`);
          values.push(value);
        }
        paramIndex++;
      }
    });
    
    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    setClauses.push(`updated_at = NOW()`);
    values.push(taskId);
    
    await pool.query(`
      UPDATE tasks 
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
    `, values);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.patch('/api/tasks/:id', authenticateUser, async (req, res) => {
  // PATCH uses same logic as PUT
  try {
    const userEmail = (req as any).userEmail;
    const taskId = req.params.id;
    const updates = req.body;
    const pool = await getTenantPool(userEmail);
    
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    
    // Map camelCase to snake_case for database
    const fieldMap: { [key: string]: string } = {
      title: 'title',
      description: 'description',
      projectId: 'project_id',
      assigneeId: 'assignee_id',
      assigneeName: 'assignee_name',
      assigneeAvatar: 'assignee_avatar',
      status: 'status',
      priority: 'priority',
      dueDate: 'due_date',
      createdDate: 'created_date',
      createdBy: 'created_by',
      estimatedHours: 'estimated_hours',
      actualHours: 'actual_hours',
      reason: 'reason'
    };
    
    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'id' && fieldMap[key]) {
        const dbField = fieldMap[key];
        // Handle tags as JSONB
        if (key === 'tags' && Array.isArray(value)) {
          setClauses.push(`tags = $${paramIndex}::jsonb`);
          values.push(JSON.stringify(value));
        } else {
          setClauses.push(`${dbField} = $${paramIndex}`);
        values.push(value);
        }
        paramIndex++;
      }
    });
    
    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    setClauses.push(`updated_at = NOW()`);
    values.push(taskId);
    
    await pool.query(`
      UPDATE tasks 
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
    `, values);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/api/tasks/:id', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const taskId = req.params.id;
    const pool = await getTenantPool(userEmail);
    
    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ============================================================================
// MESSAGES ENDPOINTS (Firestore Only)
// ============================================================================

app.get('/api/messages', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const collectionPath = getCollectionPath('messages', domain);
    
    const snapshot = await db.collection(collectionPath)
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();
    
    const messages = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        likes: Array.isArray(data.likes) ? data.likes : [], // Normalize likes to always be an array
      };
    });
    
    res.json(messages);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/messages/:chatId', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const userEmail = (req as any).user?.email?.toLowerCase() || (req as any).userEmail?.toLowerCase();
    const chatId = decodeURIComponent(req.params.chatId);
    const afterTimestamp = req.query.afterTimestamp ? new Date(req.query.afterTimestamp as string) : undefined;
    const collectionPath = getCollectionPath('messages', domain);
    
    // For AI assistant conversations, ensure privacy by filtering by userId
    // This provides an additional security layer even if chatId is somehow compromised
    if (chatId.startsWith('ai-assistant-')) {
      if (userEmail && !chatId.endsWith(`-${userEmail}`)) {
        // User is trying to access another user's AI conversation - deny access
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    
    let docs: any[] = [];
    try {
      // Query by chatId (may need Firestore index)
      let query = db.collection(collectionPath)
        .where('chatId', '==', chatId)
        .limit(100);
      
      // For AI assistant conversations, also filter by userId for privacy
      if (chatId.startsWith('ai-assistant-') && userEmail) {
        query = query.where('userId', '==', userEmail);
      }
      
      const snapshot = await query.get();
      docs = Array.from(snapshot.docs);
      
    } catch (queryError: any) {
      // If query fails (e.g., missing index), fetch all and filter in memory
      if (queryError.code === 9 || queryError.message?.includes('index')) {
        console.warn('ChatId index missing, fetching all messages and filtering:', queryError.message);
        const snapshot = await db.collection(collectionPath)
          .limit(500) // Get more to filter
          .get();
        
        // Filter by chatId in memory (and userId for AI assistant conversations)
        docs = Array.from(snapshot.docs).filter(doc => {
          const data = doc.data();
          const matchesChatId = data.chatId === chatId || (!data.chatId && chatId === 'general');
          // For AI assistant conversations, also check userId
          if (chatId.startsWith('ai-assistant-') && userEmail) {
            return matchesChatId && data.userId?.toLowerCase() === userEmail;
          }
          return matchesChatId;
        });
      } else {
        throw queryError;
      }
    }
    
    // Sort by timestamp in memory (descending)
    docs.sort((a, b) => {
      const aTime = a.data().timestamp || 0;
      const bTime = b.data().timestamp || 0;
      return bTime - aTime; // Descending
    });
    
    // Filter by afterTimestamp if provided
    if (afterTimestamp) {
      docs = docs.filter(doc => {
        const timestamp = doc.data().timestamp || 0;
        return timestamp > afterTimestamp.getTime();
      });
    }
    
    // Limit to 100
    docs = docs.slice(0, 100);
    
    const messages = docs.map(doc => {
      const data = doc.data();
      // Handle Firestore Timestamp objects properly
      let timestamp: string;
      if (data.timestamp) {
        if (data.timestamp.toDate && typeof data.timestamp.toDate === 'function') {
          // Firestore Timestamp object
          timestamp = data.timestamp.toDate().toISOString();
        } else if (typeof data.timestamp === 'number') {
          // Unix timestamp (milliseconds)
          timestamp = new Date(data.timestamp).toISOString();
        } else if (data.timestamp instanceof Date) {
          // Date object
          timestamp = data.timestamp.toISOString();
        } else {
          // Already a string or other format
          timestamp = typeof data.timestamp === 'string' ? data.timestamp : new Date().toISOString();
        }
      } else {
        timestamp = new Date().toISOString();
      }
      
      const message = {
        id: doc.id,
        chatId: data.chatId || chatId,
        role: data.role || 'user',
        content: data.content || '',
        timestamp: timestamp,
        userId: data.userId || null,
        projectId: data.projectId || null,
        teamId: data.teamId || null,
        memberName: data.memberName || null,
        memberAvatar: data.memberAvatar || null,
        citedContext: data.citedContext || null,
        imageUrls: data.imageUrls || null, // Explicitly include imageUrls
        likes: Array.isArray(data.likes) ? data.likes : [], // Normalize likes to always be an array
      };
      
      return message;
    });
    
    res.json(messages);
  } catch (error) {
    console.error('Get messages by chatId error:', error);
    // Return empty array instead of error to prevent frontend crashes
    res.json([]);
  }
});

app.post('/api/messages', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const userEmail = (req as any).userEmail;
    const { 
      chatId, 
      role, 
      content, 
      projectId, 
      teamId, 
      memberName, 
      memberAvatar,
      citedContext,
      imageUrls
    } = req.body;
    const collectionPath = getCollectionPath('messages', domain);
    
    const messageData: any = {
      chatId: chatId || 'general',
      role: role || 'user',
      content: content || '',
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
      userId: userEmail,
      likes: [] // Initialize likes as empty array for new messages
    };
    
    if (projectId) messageData.projectId = projectId;
    if (teamId) messageData.teamId = teamId;
    if (memberName) messageData.memberName = memberName;
    if (memberAvatar) messageData.memberAvatar = memberAvatar;
    if (citedContext) messageData.citedContext = citedContext;
    if (imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0) {
      messageData.imageUrls = imageUrls;
    }
    
    const docRef = await db.collection(collectionPath).add(messageData);
    
    // Return response in format expected by frontend: { success: true, messageId, message: {...} }
    res.status(201).json({ 
      success: true,
      messageId: docRef.id,
      message: {
        id: docRef.id,
        chatId: messageData.chatId,
        role: messageData.role,
        content: messageData.content,
        timestamp: new Date(messageData.timestamp).toISOString(),
        userId: messageData.userId,
        projectId: messageData.projectId || null,
        teamId: messageData.teamId || null,
        memberName: messageData.memberName || null,
        memberAvatar: messageData.memberAvatar || null,
        citedContext: messageData.citedContext || null,
        imageUrls: messageData.imageUrls || null,
        likes: Array.isArray(messageData.likes) ? messageData.likes : []
      }
    });
  } catch (error) {
    console.error('Create message error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// PATCH toggle like on a message
app.patch('/api/messages/:messageId/like', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const userEmail = (req as any).user?.email?.toLowerCase() || (req as any).userEmail?.toLowerCase();
    const messageId = req.params.messageId;
    
    if (!userEmail) {
      return res.status(401).json({ error: 'User email not found' });
    }
    
    const collectionPath = getCollectionPath('messages', domain);
    const messageRef = db.collection(collectionPath).doc(messageId);
    const messageDoc = await messageRef.get();
    
    if (!messageDoc.exists) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    const messageData = messageDoc.data();
    // Normalize likes to always be an array (handle null/undefined)
    const likes = Array.isArray(messageData?.likes) ? messageData.likes : [];
    const userEmailLower = userEmail.toLowerCase();
    
    // Toggle like: remove if exists, add if not
    const updatedLikes = likes.includes(userEmailLower)
      ? likes.filter((email: string) => email !== userEmailLower)
      : [...likes, userEmailLower];
    
    await messageRef.update({ likes: updatedLikes });
    
    res.json({
      success: true,
      likes: updatedLikes,
      liked: updatedLikes.includes(userEmailLower),
    });
  } catch (error) {
    console.error('Toggle like error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ============================================================================
// ASK API KEY ENDPOINT (Secret Manager)
// ============================================================================

// Cache for API key to avoid repeated Secret Manager calls
let cachedApiKey: string | null = null;
let apiKeyCacheTime: number = 0;
const API_KEY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache for Firebase config to avoid repeated Secret Manager calls
let cachedFirebaseConfig: any = null;
let firebaseConfigCacheTime: number = 0;
const FIREBASE_CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getApiKeyFromSecretManager(): Promise<string> {
  // Return cached key if still valid
  if (cachedApiKey && Date.now() - apiKeyCacheTime < API_KEY_CACHE_TTL) {
    return cachedApiKey;
  }

  try {
    const projectId = serviceAccount.project_id;
    const secretName = `projects/${projectId}/secrets/api-key/versions/latest`;
    const [version] = await secretManagerClient.accessSecretVersion({ name: secretName });
    const apiKey = version.payload?.data?.toString() || '';
    
    if (apiKey) {
      cachedApiKey = apiKey;
      apiKeyCacheTime = Date.now();
      console.log('✅ API key fetched from Secret Manager');
      return apiKey;
    } else {
      throw new Error('API key is empty');
    }
  } catch (error) {
    console.error('❌ Failed to fetch API key from Secret Manager:', error);
    // Fallback to environment variable for local development
    const fallbackKey = process.env.ASK_API_KEY || '7aeCdl+e5wtI/7PZFlGcUaWEM8Mf32AY7qSoThiO5WI=';
    console.log('⚠️ Using fallback API key from environment variable');
    return fallbackKey;
  }
}

// Endpoint to get API key for local development
app.get('/api/ask-api-key', authenticateUser, async (req, res) => {
  try {
    const apiKey = await getApiKeyFromSecretManager();
    res.json({ apiKey });
  } catch (error) {
    console.error('Error fetching API key:', error);
    res.status(500).json({ error: 'Failed to fetch API key' });
  }
});

// ============================================================================
// FIREBASE CONFIG ENDPOINT (Secret Manager)
// ============================================================================

async function getFirebaseConfigFromSecretManager(): Promise<any> {
  // Return cached config if still valid
  if (cachedFirebaseConfig && Date.now() - firebaseConfigCacheTime < FIREBASE_CONFIG_CACHE_TTL) {
    return cachedFirebaseConfig;
  }

  try {
    const projectId = serviceAccount.project_id;
    const secretName = `projects/${projectId}/secrets/firebase-config/versions/latest`;
    const [version] = await secretManagerClient.accessSecretVersion({ name: secretName });
    
    // Get the raw data - it might be a Buffer or Uint8Array
    let configString: string;
    if (version.payload?.data) {
      if (Buffer.isBuffer(version.payload.data)) {
        configString = version.payload.data.toString('utf8');
      } else if (version.payload.data instanceof Uint8Array) {
        configString = Buffer.from(version.payload.data).toString('utf8');
      } else {
        configString = String(version.payload.data);
      }
    } else {
      throw new Error('Firebase config secret has no data');
    }
    
    if (!configString || configString.trim().length === 0) {
      throw new Error('Firebase config is empty');
    }

    // Trim whitespace and remove any BOM or leading/trailing characters
    configString = configString.trim();
    
    // Try to parse the JSON
    let config: any;
    try {
      config = JSON.parse(configString);
    } catch (parseError: any) {
      console.error('❌ JSON parse error:', parseError.message);
      console.error('Raw config string length:', configString.length);
      console.error('First 200 chars:', configString.substring(0, 200));
      console.error('Last 200 chars:', configString.substring(Math.max(0, configString.length - 200)));
      throw new Error(`Failed to parse Firebase config JSON: ${parseError.message}`);
    }
    
    // Validate required fields
    if (!config.apiKey) {
      throw new Error('Firebase config missing apiKey');
    }
    if (!config.projectId) {
      throw new Error('Firebase config missing projectId');
    }
    
    cachedFirebaseConfig = config;
    firebaseConfigCacheTime = Date.now();
    return config;
  } catch (error) {
    console.error('❌ Failed to fetch Firebase config from Secret Manager:', error);
    throw error;
  }
}

// Endpoint to get Firebase config (public endpoint, no auth required for client-side use)
app.get('/api/firebase-config', async (req, res) => {
  try {
    const config = await getFirebaseConfigFromSecretManager();
    res.json(config);
  } catch (error: any) {
    console.error('Error fetching Firebase config:', error);
    res.status(500).json({ 
      error: 'Failed to fetch Firebase config',
      message: error.message || 'Unknown error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ============================================================================
// AI TASK GENERATION ENDPOINT (Proxies to external AI service)
// ============================================================================

app.post('/api/generate-task', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const requestBody = req.body;
    
    // Determine the external AI service URL
    // In production, this should be the ask-api service URL
    // In local dev, it's http://0.0.0.0:8081
    const isLocalDev = process.env.NODE_ENV !== 'production';
    const aiServiceBase = isLocalDev 
      ? process.env.AI_SERVICE_URL || 'http://0.0.0.0:8081'
      : process.env.AI_SERVICE_URL || 'http://ask-api:80';
    
    const aiServiceUrl = `${aiServiceBase}/api/generate-task`;
    
    // Prepare headers for the AI service request
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // Get API key for authentication
    try {
      const apiKey = await getApiKeyFromSecretManager();
      headers['X-API-Key'] = apiKey;
    } catch (error) {
      console.error('Failed to get API key, request may fail:', error);
      // Continue anyway - the AI service might handle auth differently
    }
    
    // Ensure user_id is set
    if (!requestBody.user_id) {
      requestBody.user_id = userEmail.toLowerCase();
    }
    
    // Proxy the request to the AI service
    const aiResponse = await fetch(aiServiceUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
    
    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: `AI service error: ${aiResponse.status} ${aiResponse.statusText}` };
      }
      return res.status(aiResponse.status).json(errorData);
    }
    
    const aiData = await aiResponse.json();
    
    // Return the response from the AI service
    res.json(aiData);
  } catch (error) {
    console.error('Error generating AI task details:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to generate AI task details' 
    });
  }
});

// ============================================================================
// INTEGRATIONS ENDPOINTS (PostgreSQL + Secret Manager)
// ============================================================================

setupIntegrationEndpoints(app, authenticateUser, secretManagerClient, serviceAccount, db);

// ============================================================================
// CALL ENDPOINTS (Firestore - Optional, can also use Firestore directly)
// ============================================================================

setupCallEndpoints(app, authenticateUser, db);
setupImageEndpoints(app, authenticateUser, storage, firebaseApp);

// ============================================================================
// UPDATE SUMMARIES ENDPOINTS (PostgreSQL)
// ============================================================================

app.get('/api/update-summaries', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const projectId = req.query.projectId as string | undefined;
    const pool = await getTenantPool(userEmail);
    
    let query = `
      SELECT 
        us.project_id,
        us.date_id,
        us.update_summary,
        us.generated_at
      FROM project_progress_updates us
    `;
    const params: any[] = [];
    
    if (projectId) {
      query += ` WHERE us.project_id = $1`;
      params.push(projectId);
    }
    
    query += ` ORDER BY us.date_id DESC, us.project_id`;
    
    const result = await pool.query(query, params);
    
    // Transform to the format expected by frontend
    // Frontend expects: Record<string, { dateId: string; updateSummary: string }>
    // Keyed by projectId
    const summaries: Record<string, { dateId: string; updateSummary: string }> = {};
    
    result.rows.forEach(row => {
      const projectId = row.project_id;
      if (!summaries[projectId]) {
        summaries[projectId] = {
          dateId: row.date_id ? new Date(row.date_id).toISOString().split('T')[0] : '',
          updateSummary: row.update_summary || ''
        };
      }
    });
    
    // If projectId was specified, return single object or null
    if (projectId) {
      if (result.rows.length > 0) {
        const row = result.rows[0];
        res.json({
          projectId: row.project_id,
          dateId: row.date_id ? new Date(row.date_id).toISOString().split('T')[0] : '',
          updateSummary: row.update_summary || ''
        });
      } else {
        res.json(null);
      }
    } else {
      res.json(summaries);
    }
  } catch (error) {
    console.error('Get update summaries error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET updates by task ID
app.get('/api/updates/task/:taskId', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const taskId = req.params.taskId;
    const pool = await getTenantPool(userEmail);
    
    const result = await pool.query(`
      SELECT 
        upd.update_id as id,
        upd.update_id,
        upd.project_id,
        upd.user_id,
        upd.associated_tasks,
        CASE WHEN upd.date_id IS NOT NULL THEN upd.date_id::text ELSE NULL END as date_id,
        upd.reason,
        upd.update_text as update,
        upd.timestamp,
        COALESCE(u.first_name || ' ' || u.last_name, upd.user_id) as memberName,
        COALESCE(
          CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL 
            THEN UPPER(SUBSTRING(u.first_name, 1, 1) || SUBSTRING(u.last_name, 1, 1))
            ELSE UPPER(SUBSTRING(upd.user_id, 1, 2))
          END,
          'U'
        ) as memberAvatar
      FROM task_progress_updates upd
      LEFT JOIN users u ON upd.user_id = u.email
      WHERE upd.associated_tasks @> $1::jsonb
      ORDER BY upd.timestamp DESC
    `, [JSON.stringify([taskId])]);
    
    // Transform to the format expected by frontend
    // Note: PostgreSQL returns unquoted column names in lowercase
    const updates = result.rows.map(row => ({
      updateId: row.update_id,
      associatedTasks: row.associated_tasks,
      dateId: row.date_id || '',
      projectId: row.project_id || '',
      reason: row.reason || '',
      timestamp: row.timestamp ? (typeof row.timestamp === 'string' ? row.timestamp : new Date(row.timestamp).toISOString()) : '',
      update: row.update || '',
      userId: row.user_id || '',
      memberName: row.membername || row.user_id || '',
      memberAvatar: row.memberavatar || 'U',
    }));
    
    res.json(updates);
  } catch (error) {
    console.error('Get updates by task error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ============================================================================
// CATCH-ALL ROUTE (for debugging)
// ============================================================================

app.use((req, res, next) => {
  console.log('🔍 [Backend] Unhandled request', {
    method: req.method,
    path: req.path,
    url: req.url,
    headers: {
      authorization: req.headers.authorization ? 'present' : 'missing',
      'content-type': req.headers['content-type'],
    },
  });
  res.status(404).json({ error: 'Route not found', path: req.path });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server started on port ${PORT}`);
  console.log(`✅ Health check available at http://0.0.0.0:${PORT}/api/health`);
});

