import express from 'express';
import cors from 'cors';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read service account credentials
// Using fs.readFileSync to avoid module import issues with JSON files
const serviceAccountPath = join(__dirname, '../gcp_credential.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

// Initialize Firebase Admin SDK
let firebaseApp;
if (getApps().length === 0) {
  firebaseApp = initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
} else {
  firebaseApp = getApps()[0];
}

const db = getFirestore(firebaseApp, 'leanworks-prod');
const auth = getAuth(firebaseApp);
// Initialize Secret Manager client with explicit service account credentials
const secretManagerClient = new SecretManagerServiceClient({
  credentials: serviceAccount,
  projectId: serviceAccount.project_id,
});
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Extract domain from email
function extractDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() || '';
}

// Validate business email (not personal email domain)
const PERSONAL_EMAIL_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'aol.com',
  'mail.com',
  'protonmail.com',
  'yandex.com',
  'zoho.com',
  'gmx.com',
  'live.com',
  'msn.com',
  'me.com',
  'mac.com',
];

function isBusinessEmail(email: string): boolean {
  const domain = extractDomain(email);
  return !PERSONAL_EMAIL_DOMAINS.includes(domain);
}

// Authentication middleware
async function authenticateUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split('Bearer ')[1];
    
    // Try to verify as ID token first (normal flow when Firebase Auth works)
    try {
      const decodedToken = await auth.verifyIdToken(token);
      // Attach user info to request
      (req as any).user = decodedToken;
      (req as any).userDomain = extractDomain(decodedToken.email || '');
      next();
      return;
    } catch (idTokenError: any) {
      // If ID token verification fails, try to verify as custom token
      // Custom tokens from createCustomToken are JWTs that can be verified
      // by decoding and checking the UID
      try {
        // Decode the JWT without verification first to get the UID
        // Custom tokens have the format: {uid: "...", ...}
        const parts = token.split('.');
        if (parts.length === 3) {
          // It's a JWT, try to decode it
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          
          // If it has a uid, it's likely a custom token
          if (payload.uid) {
            // Verify the user exists and get their info
            const userRecord = await auth.getUser(payload.uid);
            
            // Create a decoded token-like object
            (req as any).user = {
              uid: userRecord.uid,
              email: userRecord.email,
              email_verified: userRecord.emailVerified,
            };
            (req as any).userDomain = extractDomain(userRecord.email || '');
            next();
            return;
          }
        }
        
        // If we can't decode it, reject
        throw new Error('Invalid token format');
      } catch (customTokenError: any) {
        console.error('Token verification failed:', customTokenError.message);
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
      }
    }
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
}

// Helper to get domain-based collection path
function getCollectionPath(collectionName: string, domain: string): string {
  return `domains/${domain}/${collectionName}`;
}

// Helper function to get team ID by team name
async function getTeamIdByName(domain: string, teamName: string): Promise<string | null> {
  const teamsPath = getCollectionPath('teams', domain);
  const snapshot = await db.collection(teamsPath)
    .where('name', '==', teamName)
    .limit(1)
    .get();
  
  if (snapshot.empty) {
    return null;
  }
  
  // Return the document ID (which is the team.id)
  return snapshot.docs[0].id;
}

// Email whitelist - only these emails can signup and login
const EMAIL_WHITELIST = [
  'testuser@leanworks.ai',
  'yanfu@leanworks.ai',
  'vijay@leanworks.ai',
  'qianwen@leanworks.ai',
  // Add more whitelisted emails here
];

function isEmailWhitelisted(email: string): boolean {
  return EMAIL_WHITELIST.includes(email.toLowerCase());
}

// Authentication endpoints
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, firstName, lastName, jobTitle, responsibilities } = req.body;

    if (!email || !password || !firstName || !lastName || !jobTitle) {
      return res.status(400).json({ error: 'Email, password, first name, last name, and job title are required' });
    }

    // Check if email is whitelisted
    if (!isEmailWhitelisted(email)) {
      return res.status(403).json({ error: 'Your email is not authorized to sign up. Please contact your administrator.' });
    }

    // Get domain and collection path
    const domain = extractDomain(email);
    const usersCollectionPath = getCollectionPath('users', domain);
    
    // Check if user already exists in Firestore
    const usersCollection = db.collection(usersCollectionPath);
    const userDoc = await usersCollection.doc(email.toLowerCase()).get();
    
    if (userDoc.exists) {
      return res.status(400).json({ error: 'Account already exists. Please sign in instead.' });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Store user in Firestore users collection (domain-based)
    const userData = {
      email: email.toLowerCase(),
      password: hashedPassword,
      firstName,
      lastName,
      jobTitle,
      responsibilities: responsibilities || '',
      createdAt: new Date(),
      domain: domain,
    };

    await usersCollection.doc(email.toLowerCase()).set(userData);

    // Create Firebase Auth user (for custom token generation)
    let userRecord;
    try {
      userRecord = await auth.createUser({
        email: email.toLowerCase(),
        password,
        emailVerified: true, // No email verification needed
      });
    } catch (error: any) {
      // If user already exists in Firebase Auth, get it
      if (error.code === 'auth/email-already-exists') {
        userRecord = await auth.getUserByEmail(email.toLowerCase());
      } else {
        throw error;
      }
    }

    res.json({ 
      success: true, 
      message: 'Account created successfully!',
      userId: userRecord.uid,
    });
  } catch (error: any) {
    console.error('Signup error:', error);
    res.status(500).json({ error: error.message || 'Failed to create account' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if email is whitelisted
    if (!isEmailWhitelisted(email)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Get domain and collection path
    const domain = extractDomain(email);
    const usersCollectionPath = getCollectionPath('users', domain);
    
    // Get user from Firestore users collection (domain-based)
    const usersCollection = db.collection(usersCollectionPath);
    const userDoc = await usersCollection.doc(email.toLowerCase()).get();
    
    if (!userDoc.exists) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const userData = userDoc.data();
    if (!userData) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, userData.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Get or create Firebase Auth user (for custom token generation)
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email.toLowerCase());
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        // Create user in Firebase Auth if it doesn't exist
        try {
        userRecord = await auth.createUser({
          email: email.toLowerCase(),
          password,
          emailVerified: true,
        });
        } catch (createError: any) {
          console.error('Error creating Firebase Auth user:', createError);
          console.error('Error code:', createError.code);
          console.error('Error message:', createError.message);
          throw createError;
        }
      } else {
        console.error('Error getting Firebase Auth user:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        throw error;
      }
    }

    // Ensure user is verified (no email verification needed, but keep it true)
    if (!userRecord.emailVerified) {
      await auth.updateUser(userRecord.uid, { emailVerified: true });
      // Fetch updated user record to get the latest emailVerified value
      userRecord = await auth.getUser(userRecord.uid);
    }

    // Create custom token for the user
    let customToken;
    try {
      customToken = await auth.createCustomToken(userRecord.uid);
    } catch (tokenError: any) {
      console.error('Error creating custom token:', tokenError);
      console.error('Error code:', tokenError.code);
      console.error('Error message:', tokenError.message);
      console.error('Project ID:', serviceAccount.project_id);
      throw tokenError;
    }

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
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    console.error('Full error:', JSON.stringify(error, null, 2));
    res.status(500).json({ error: error.message || 'Failed to sign in' });
  }
});

// Email verification endpoints removed - no email verification required

// User profile endpoint
app.get('/api/users/profile', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).user.email;
    if (!userEmail) {
      return res.status(400).json({ error: 'User email not found' });
    }

    const domain = (req as any).userDomain;
    const usersCollectionPath = getCollectionPath('users', domain);
    const userDoc = await db.collection(usersCollectionPath).doc(userEmail.toLowerCase()).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    const userData = userDoc.data();
    if (!userData) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    // Remove password from response
    const { password, ...profileData } = userData;
    
    // Convert createdAt timestamp if it exists
    const profile = {
      ...profileData,
      createdAt: userData.createdAt?.toDate ? userData.createdAt.toDate().toISOString() : userData.createdAt,
    };

    res.json(profile);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to fetch profile' });
  }
});

// Get all users endpoint
app.get('/api/users', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const usersCollectionPath = getCollectionPath('users', domain);
    const snapshot = await db.collection(usersCollectionPath).get();
    
    const users = snapshot.docs.map(doc => {
      const userData = doc.data();
      // Remove password from response
      const { password, ...userWithoutPassword } = userData;
      
      // Convert createdAt timestamp if it exists
      return {
        ...userWithoutPassword,
        createdAt: userData.createdAt?.toDate ? userData.createdAt.toDate().toISOString() : userData.createdAt,
      };
    });
    
    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to fetch users' });
  }
});

// Helper to convert Firestore timestamps
// Helper function to convert Firestore timestamps recursively
const convertTimestamp = (value: any): any => {
  // Check if it's a Firestore Timestamp
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as any).toDate === 'function') {
    const date = (value as any).toDate();
    // Convert to date string (YYYY-MM-DD format)
    return date.toISOString().split('T')[0];
  }
  
  // Check if it's an array
  if (Array.isArray(value)) {
    return value.map(item => convertTimestamp(item));
  }
  
  // Check if it's a plain object (not null, not Date, not Array)
  if (value && typeof value === 'object' && value.constructor === Object) {
    const converted: any = {};
    for (const [key, val] of Object.entries(value)) {
      // For createdAt, preserve as timestamp in milliseconds if it's a timestamp
      if (key === 'createdAt' && val && typeof val === 'object' && 'toDate' in val) {
        const date = (val as any).toDate();
        converted[key] = date.getTime();
      } else {
        converted[key] = convertTimestamp(val);
      }
    }
    return converted;
  }
  
  // Return primitive values as-is
  return value;
};

const convertDoc = (doc: any) => {
  const data = doc.data();
  if (!data) return null;
  
  // Convert Firestore timestamps recursively
  return convertTimestamp(data);
};

// Projects endpoints
app.get('/api/projects', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const collectionPath = getCollectionPath('projects', domain);
    const snapshot = await db.collection(collectionPath).get();
    const projects = snapshot.docs.map(doc => convertDoc(doc));
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/projects/:id', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const collectionPath = getCollectionPath('projects', domain);
    const doc = await db.collection(collectionPath).doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(convertDoc(doc));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/projects', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const collectionPath = getCollectionPath('projects', domain);
    const project = req.body;
    if (!project.id) {
      return res.status(400).json({ error: 'Project ID is required' });
    }
    await db.collection(collectionPath).doc(project.id).set(project);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.patch('/api/projects/:id', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const collectionPath = getCollectionPath('projects', domain);
    await db.collection(collectionPath).doc(req.params.id).update(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/api/projects/:id', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const collectionPath = getCollectionPath('projects', domain);
    await db.collection(collectionPath).doc(req.params.id).delete();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Tasks endpoints
app.get('/api/tasks', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const collectionPath = getCollectionPath('tasks', domain);
    const snapshot = await db.collection(collectionPath).get();
    const tasks = snapshot.docs.map(doc => convertDoc(doc));
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/tasks/:id', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const collectionPath = getCollectionPath('tasks', domain);
    const doc = await db.collection(collectionPath).doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(convertDoc(doc));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/tasks/project/:projectId', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const collectionPath = getCollectionPath('tasks', domain);
    const snapshot = await db.collection(collectionPath)
      .where('projectId', '==', req.params.projectId)
      .get();
    const tasks = snapshot.docs.map(doc => convertDoc(doc));
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/tasks', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const collectionPath = getCollectionPath('tasks', domain);
    const task = req.body;
    await db.collection(collectionPath).doc(task.id).set(task);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.patch('/api/tasks/:id', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const collectionPath = getCollectionPath('tasks', domain);
    await db.collection(collectionPath).doc(req.params.id).update(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/api/tasks/:id', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const collectionPath = getCollectionPath('tasks', domain);
    await db.collection(collectionPath).doc(req.params.id).delete();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Teams endpoints
app.get('/api/teams', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const collectionPath = getCollectionPath('teams', domain);
    const snapshot = await db.collection(collectionPath).get();
    const teams = snapshot.docs.map(doc => doc.data());
    res.json(teams);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Team join request endpoints - must come before /api/teams/:name to avoid route conflicts
app.post('/api/teams/:teamName/join-request', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const userEmail = (req as any).user.email;
    const teamName = req.params.teamName;
    
    // Get team ID by name
    const teamId = await getTeamIdByName(domain, teamName);
    if (!teamId) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    // Get team details to find owner
    const teamDetailsPath = getCollectionPath('teamDetails', domain);
    const teamDetailDoc = await db.collection(teamDetailsPath).doc(teamId).get();
    
    if (!teamDetailDoc.exists) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    const teamDetail = teamDetailDoc.data();
    if (!teamDetail) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    // Check if user is already a member
    const isMember = teamDetail.members?.some(
      (member: any) => member.email?.toLowerCase() === userEmail.toLowerCase()
    );
    
    if (isMember) {
      return res.status(400).json({ error: 'You are already a member of this team' });
    }
    
    // Check if there's already a pending request
    const joinRequestsPath = getCollectionPath('teamJoinRequests', domain);
    const existingRequests = await db.collection(joinRequestsPath)
      .where('teamName', '==', teamName)
      .where('userEmail', '==', userEmail.toLowerCase())
      .where('status', '==', 'pending')
      .get();
    
    if (!existingRequests.empty) {
      return res.status(400).json({ error: 'You already have a pending request for this team' });
    }
    
    // Get user info for the request
    const usersCollectionPath = getCollectionPath('users', domain);
    const userDoc = await db.collection(usersCollectionPath).doc(userEmail.toLowerCase()).get();
    const userData = userDoc.data();
    const userName = userData 
      ? `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userEmail
      : userEmail;
    
    // Create join request
    const requestData = {
      teamName,
      userEmail: userEmail.toLowerCase(),
      userName,
      status: 'pending',
      ownerEmail: teamDetail.ownerEmail || teamDetail.members?.[0]?.email || '',
      createdAt: new Date(),
    };
    
    const requestRef = await db.collection(joinRequestsPath).add(requestData);
    
    res.json({ 
      success: true, 
      requestId: requestRef.id,
      message: 'Join request sent successfully'
    });
  } catch (error) {
    console.error('Create join request error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to create join request' });
  }
});

// Get join requests for teams owned by the user
app.get('/api/teams/join-requests', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const userEmail = (req as any).user.email;
    const joinRequestsPath = getCollectionPath('teamJoinRequests', domain);
    
    // Get all pending requests for teams owned by this user
    // Note: If orderBy fails due to missing index, remove it and sort in memory
    let snapshot;
    try {
      snapshot = await db.collection(joinRequestsPath)
        .where('ownerEmail', '==', userEmail.toLowerCase())
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'desc')
        .get();
    } catch (error: any) {
      // If index error, fetch without orderBy and sort in memory
      if (error.code === 9 || error.message?.includes('index')) {
        snapshot = await db.collection(joinRequestsPath)
          .where('ownerEmail', '==', userEmail.toLowerCase())
          .where('status', '==', 'pending')
          .get();
        // Sort in memory
        const docs = snapshot.docs.sort((a, b) => {
          const aTime = a.data().createdAt?.toDate?.()?.getTime() || 0;
          const bTime = b.data().createdAt?.toDate?.()?.getTime() || 0;
          return bTime - aTime; // Descending
        });
        // Create a new QuerySnapshot-like object
        snapshot = { docs, empty: docs.length === 0 };
      } else {
        throw error;
      }
    }
    
    const requests = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate().toISOString() : doc.data().createdAt,
    }));
    
    res.json(requests);
  } catch (error) {
    console.error('Get join requests error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to fetch join requests' });
  }
});

// Get invitations for the current user
app.get('/api/teams/invitations', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const userEmail = (req as any).user.email;
    const invitationsPath = getCollectionPath('teamInvitations', domain);
    
    // Get all pending invitations for this user
    let snapshot;
    try {
      snapshot = await db.collection(invitationsPath)
        .where('inviteeEmail', '==', userEmail.toLowerCase())
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'desc')
        .get();
    } catch (error: any) {
      // If index error, fetch without orderBy and sort in memory
      if (error.code === 9 || error.message?.includes('index')) {
        snapshot = await db.collection(invitationsPath)
          .where('inviteeEmail', '==', userEmail.toLowerCase())
          .where('status', '==', 'pending')
          .get();
        // Sort in memory
        const docs = snapshot.docs.sort((a, b) => {
          const aTime = a.data().createdAt?.toDate?.()?.getTime() || 0;
          const bTime = b.data().createdAt?.toDate?.()?.getTime() || 0;
          return bTime - aTime; // Descending
        });
        // Create a new QuerySnapshot-like object
        snapshot = { docs, empty: docs.length === 0 };
      } else {
        throw error;
      }
    }
    
    const invitations = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate().toISOString() : doc.data().createdAt,
    }));
    
    res.json(invitations);
  } catch (error) {
    console.error('Get invitations error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to fetch invitations' });
  }
});

app.get('/api/teams/:id', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const collectionPath = getCollectionPath('teamDetails', domain);
    const teamId = req.params.id;
    
    // Only use team ID for lookup
    const doc = await db.collection(collectionPath).doc(teamId).get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: 'Team not found' });
    }
    res.json(doc.data());
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/teams', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const userEmail = (req as any).user.email;
    const teamsPath = getCollectionPath('teams', domain);
    const teamDetailsPath = getCollectionPath('teamDetails', domain);
    const { team, teamDetail } = req.body;
    
    if (!team.id || !teamDetail.id) {
      return res.status(400).json({ error: 'Team ID is required' });
    }
    
    // Add owner email to team and team detail
    const teamWithOwner = { ...team, ownerEmail: userEmail };
    const teamDetailWithOwner = { ...teamDetail, ownerEmail: userEmail };
    
    // Use team.id as document ID for consistent matching
    await db.collection(teamsPath).doc(team.id).set(teamWithOwner);
    await db.collection(teamDetailsPath).doc(teamDetail.id).set(teamDetailWithOwner);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.patch('/api/teams/:id', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const collectionPath = getCollectionPath('teams', domain);
    await db.collection(collectionPath).doc(req.params.id).update(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.patch('/api/teams/:id/detail', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const collectionPath = getCollectionPath('teamDetails', domain);
    await db.collection(collectionPath).doc(req.params.id).update(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/api/teams/:id', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const teamsPath = getCollectionPath('teams', domain);
    const teamDetailsPath = getCollectionPath('teamDetails', domain);
    await db.collection(teamsPath).doc(req.params.id).delete();
    await db.collection(teamDetailsPath).doc(req.params.id).delete();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Approve join request
app.post('/api/teams/join-requests/:requestId/approve', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const userEmail = (req as any).user.email;
    const requestId = req.params.requestId;
    const joinRequestsPath = getCollectionPath('teamJoinRequests', domain);
    
    // Get the request
    const requestDoc = await db.collection(joinRequestsPath).doc(requestId).get();
    if (!requestDoc.exists) {
      return res.status(404).json({ error: 'Join request not found' });
    }
    
    const requestData = requestDoc.data();
    if (!requestData) {
      return res.status(404).json({ error: 'Join request not found' });
    }
    
    // Verify the user is the owner
    if (requestData.ownerEmail?.toLowerCase() !== userEmail.toLowerCase()) {
      return res.status(403).json({ error: 'Only the team owner can approve requests' });
    }
    
    // Check if already processed
    if (requestData.status !== 'pending') {
      return res.status(400).json({ error: 'This request has already been processed' });
    }
    
    // Get user info to add to team
    const usersCollectionPath = getCollectionPath('users', domain);
    const userDoc = await db.collection(usersCollectionPath).doc(requestData.userEmail).get();
    const userData = userDoc.data();
    
    if (!userData) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get team ID by name
    const teamId = await getTeamIdByName(domain, requestData.teamName);
    if (!teamId) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    // Add user to team
    const teamDetailsPath = getCollectionPath('teamDetails', domain);
    const teamDetailDoc = await db.collection(teamDetailsPath).doc(teamId).get();
    
    if (!teamDetailDoc.exists) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    const teamDetail = teamDetailDoc.data();
    if (!teamDetail) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    // Check if user is already a member
    const isAlreadyMember = teamDetail.members?.some(
      (member: any) => member.email?.toLowerCase() === requestData.userEmail.toLowerCase()
    );
    
    if (isAlreadyMember) {
      // Just mark request as approved
      await db.collection(joinRequestsPath).doc(requestId).update({ status: 'approved' });
      return res.json({ success: true, message: 'User is already a member' });
    }
    
    // Add new member
    const firstName = userData.firstName || '';
    const lastName = userData.lastName || '';
    const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || requestData.userEmail.charAt(0).toUpperCase();
    
    const newMember = {
      name: `${firstName} ${lastName}`.trim() || requestData.userEmail,
      role: userData.jobTitle || 'Member',
      email: requestData.userEmail,
      avatar: initials,
    };
    
    const updatedMembers = [...(teamDetail.members || []), newMember];
    
    // Update team detail
    await db.collection(teamDetailsPath).doc(teamId).update({
      members: updatedMembers,
    });
    
    // Update team member count
    const teamsPath = getCollectionPath('teams', domain);
    const teamDoc = await db.collection(teamsPath).doc(teamId).get();
    if (teamDoc.exists) {
      await db.collection(teamsPath).doc(teamId).update({
        members: updatedMembers.length,
      });
    }
    
    // Update request status
    await db.collection(joinRequestsPath).doc(requestId).update({ status: 'approved' });
    
    res.json({ success: true, message: 'Join request approved successfully' });
  } catch (error) {
    console.error('Approve join request error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to approve join request' });
  }
});

// Reject join request
app.post('/api/teams/join-requests/:requestId/reject', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const userEmail = (req as any).user.email;
    const requestId = req.params.requestId;
    const joinRequestsPath = getCollectionPath('teamJoinRequests', domain);
    
    // Get the request
    const requestDoc = await db.collection(joinRequestsPath).doc(requestId).get();
    if (!requestDoc.exists) {
      return res.status(404).json({ error: 'Join request not found' });
    }
    
    const requestData = requestDoc.data();
    if (!requestData) {
      return res.status(404).json({ error: 'Join request not found' });
    }
    
    // Verify the user is the owner
    if (requestData.ownerEmail?.toLowerCase() !== userEmail.toLowerCase()) {
      return res.status(403).json({ error: 'Only the team owner can reject requests' });
    }
    
    // Check if already processed
    if (requestData.status !== 'pending') {
      return res.status(400).json({ error: 'This request has already been processed' });
    }
    
    // Update request status
    await db.collection(joinRequestsPath).doc(requestId).update({ status: 'rejected' });
    
    res.json({ success: true, message: 'Join request rejected' });
  } catch (error) {
    console.error('Reject join request error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to reject join request' });
  }
});

// Team Invitation endpoints
// Create team invitation (owner only)
app.post('/api/teams/:teamName/invitations', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const userEmail = (req as any).user.email;
    const teamName = req.params.teamName;
    const { inviteeEmail } = req.body;
    
    if (!inviteeEmail) {
      return res.status(400).json({ error: 'Invitee email is required' });
    }
    
    // Get team ID by name
    const teamId = await getTeamIdByName(domain, teamName);
    if (!teamId) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    // Get team details to verify ownership
    const teamDetailsPath = getCollectionPath('teamDetails', domain);
    const teamDetailDoc = await db.collection(teamDetailsPath).doc(teamId).get();
    
    if (!teamDetailDoc.exists) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    const teamDetail = teamDetailDoc.data();
    if (!teamDetail) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    // Verify the user is the owner
    if (teamDetail.ownerEmail?.toLowerCase() !== userEmail.toLowerCase()) {
      return res.status(403).json({ error: 'Only the team owner can send invitations' });
    }
    
    // Check if user is already a member
    const isMember = teamDetail.members?.some(
      (member: any) => member.email?.toLowerCase() === inviteeEmail.toLowerCase()
    );
    
    if (isMember) {
      return res.status(400).json({ error: 'User is already a member of this team' });
    }
    
    // Check if there's already a pending invitation
    const invitationsPath = getCollectionPath('teamInvitations', domain);
    const existingInvitations = await db.collection(invitationsPath)
      .where('teamName', '==', teamName)
      .where('inviteeEmail', '==', inviteeEmail.toLowerCase())
      .where('status', '==', 'pending')
      .get();
    
    if (!existingInvitations.empty) {
      return res.status(400).json({ error: 'An invitation has already been sent to this user' });
    }
    
    // Get owner info for the invitation
    const usersCollectionPath = getCollectionPath('users', domain);
    const ownerDoc = await db.collection(usersCollectionPath).doc(userEmail.toLowerCase()).get();
    const ownerData = ownerDoc.data();
    const ownerName = ownerData 
      ? `${ownerData.firstName || ''} ${ownerData.lastName || ''}`.trim() || userEmail
      : userEmail;
    
    // Create invitation
    const invitationData = {
      teamName,
      teamDescription: teamDetail.description || '',
      inviteeEmail: inviteeEmail.toLowerCase(),
      inviterEmail: userEmail.toLowerCase(),
      inviterName: ownerName,
      status: 'pending',
      createdAt: new Date(),
    };
    
    const invitationRef = await db.collection(invitationsPath).add(invitationData);
    
    res.json({ 
      success: true, 
      invitationId: invitationRef.id,
      message: 'Invitation sent successfully'
    });
  } catch (error) {
    console.error('Create invitation error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to create invitation' });
  }
});

// Accept team invitation
app.post('/api/teams/invitations/:invitationId/accept', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const userEmail = (req as any).user.email;
    const invitationId = req.params.invitationId;
    const invitationsPath = getCollectionPath('teamInvitations', domain);
    
    // Get the invitation
    const invitationDoc = await db.collection(invitationsPath).doc(invitationId).get();
    if (!invitationDoc.exists) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    const invitationData = invitationDoc.data();
    if (!invitationData) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    // Verify the invitation is for the current user
    if (invitationData.inviteeEmail?.toLowerCase() !== userEmail.toLowerCase()) {
      return res.status(403).json({ error: 'This invitation is not for you' });
    }
    
    // Check if already processed
    if (invitationData.status !== 'pending') {
      return res.status(400).json({ error: 'This invitation has already been processed' });
    }
    
    // Get user info to add to team
    const usersCollectionPath = getCollectionPath('users', domain);
    const userDoc = await db.collection(usersCollectionPath).doc(userEmail).get();
    const userData = userDoc.data();
    
    if (!userData) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get team ID by name
    const teamId = await getTeamIdByName(domain, invitationData.teamName);
    if (!teamId) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    // Add user to team
    const teamDetailsPath = getCollectionPath('teamDetails', domain);
    const teamDetailDoc = await db.collection(teamDetailsPath).doc(teamId).get();
    
    if (!teamDetailDoc.exists) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    const teamDetail = teamDetailDoc.data();
    if (!teamDetail) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    // Check if user is already a member
    const isAlreadyMember = teamDetail.members?.some(
      (member: any) => member.email?.toLowerCase() === userEmail.toLowerCase()
    );
    
    if (isAlreadyMember) {
      // Just mark invitation as accepted
      await db.collection(invitationsPath).doc(invitationId).update({ status: 'accepted' });
      return res.json({ success: true, message: 'User is already a member' });
    }
    
    // Add new member
    const firstName = userData.firstName || '';
    const lastName = userData.lastName || '';
    const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || userEmail.charAt(0).toUpperCase();
    
    const newMember = {
      name: `${firstName} ${lastName}`.trim() || userEmail,
      role: userData.jobTitle || 'Member',
      email: userEmail,
      avatar: initials,
    };
    
    const updatedMembers = [...(teamDetail.members || []), newMember];
    
    // Update team detail
    await db.collection(teamDetailsPath).doc(teamId).update({
      members: updatedMembers,
    });
    
    // Update team member count
    const teamsPath = getCollectionPath('teams', domain);
    const teamDoc = await db.collection(teamsPath).doc(teamId).get();
    if (teamDoc.exists) {
      await db.collection(teamsPath).doc(teamId).update({
        members: updatedMembers.length,
      });
    }
    
    // Update invitation status
    await db.collection(invitationsPath).doc(invitationId).update({ status: 'accepted' });
    
    res.json({ success: true, message: 'Invitation accepted successfully' });
  } catch (error) {
    console.error('Accept invitation error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to accept invitation' });
  }
});

// Decline team invitation
app.post('/api/teams/invitations/:invitationId/decline', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const userEmail = (req as any).user.email;
    const invitationId = req.params.invitationId;
    const invitationsPath = getCollectionPath('teamInvitations', domain);
    
    // Get the invitation
    const invitationDoc = await db.collection(invitationsPath).doc(invitationId).get();
    if (!invitationDoc.exists) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    const invitationData = invitationDoc.data();
    if (!invitationData) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    // Verify the invitation is for the current user
    if (invitationData.inviteeEmail?.toLowerCase() !== userEmail.toLowerCase()) {
      return res.status(403).json({ error: 'This invitation is not for you' });
    }
    
    // Check if already processed
    if (invitationData.status !== 'pending') {
      return res.status(400).json({ error: 'This invitation has already been processed' });
    }
    
    // Update invitation status
    await db.collection(invitationsPath).doc(invitationId).update({ status: 'declined' });
    
    res.json({ success: true, message: 'Invitation declined' });
  } catch (error) {
    console.error('Decline invitation error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to decline invitation' });
  }
});

// Remove a member from a team (only for owners)
app.delete('/api/teams/:name/members/:memberEmail', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const userEmail = (req as any).user.email;
    const teamName = req.params.name;
    const memberEmail = decodeURIComponent(req.params.memberEmail);
    
    // Get team ID by name
    const teamId = await getTeamIdByName(domain, teamName);
    if (!teamId) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    const teamsPath = getCollectionPath('teams', domain);
    const teamDetailsPath = getCollectionPath('teamDetails', domain);
    
    // Get team to verify ownership
    const teamDoc = await db.collection(teamsPath).doc(teamId).get();
    if (!teamDoc.exists) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    const team = teamDoc.data();
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    // Verify the user is the owner
    if (team.ownerEmail?.toLowerCase() !== userEmail.toLowerCase()) {
      return res.status(403).json({ error: 'Only the team owner can remove members' });
    }
    
    // Prevent owner from removing themselves
    if (memberEmail.toLowerCase() === userEmail.toLowerCase()) {
      return res.status(400).json({ error: 'Team owner cannot remove themselves. Transfer ownership first or delete the team.' });
    }
    
    // Get team details
    const teamDetailDoc = await db.collection(teamDetailsPath).doc(teamId).get();
    if (!teamDetailDoc.exists) {
      return res.status(404).json({ error: 'Team details not found' });
    }
    
    const teamDetail = teamDetailDoc.data();
    if (!teamDetail) {
      return res.status(404).json({ error: 'Team details not found' });
    }
    
    // Check if member exists
    const members = teamDetail.members || [];
    const memberIndex = members.findIndex(
      (member: any) => member.email?.toLowerCase() === memberEmail.toLowerCase()
    );
    
    if (memberIndex === -1) {
      return res.status(404).json({ error: 'Member not found in team' });
    }
    
    // Remove member
    const updatedMembers = members.filter(
      (member: any) => member.email?.toLowerCase() !== memberEmail.toLowerCase()
    );
    
    // Update team details
    await db.collection(teamDetailsPath).doc(teamId).update({
      members: updatedMembers,
    });
    
    // Update team member count
    await db.collection(teamsPath).doc(teamId).update({
      members: updatedMembers.length,
    });
    
    res.json({ success: true, message: 'Member removed successfully' });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to remove member' });
  }
});

// Leave a team (for members)
app.delete('/api/teams/:name/leave', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const userEmail = (req as any).user.email;
    const teamName = req.params.name;
    
    // Get team ID by name
    const teamId = await getTeamIdByName(domain, teamName);
    if (!teamId) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    const teamsPath = getCollectionPath('teams', domain);
    const teamDetailsPath = getCollectionPath('teamDetails', domain);
    
    // Get team to check ownership
    const teamDoc = await db.collection(teamsPath).doc(teamId).get();
    if (!teamDoc.exists) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    const team = teamDoc.data();
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    // Prevent owner from leaving (they should transfer ownership or delete team)
    if (team.ownerEmail?.toLowerCase() === userEmail.toLowerCase()) {
      return res.status(400).json({ error: 'Team owner cannot leave the team. Transfer ownership first or delete the team.' });
    }
    
    // Get team details
    const teamDetailDoc = await db.collection(teamDetailsPath).doc(teamId).get();
    if (!teamDetailDoc.exists) {
      return res.status(404).json({ error: 'Team details not found' });
    }
    
    const teamDetail = teamDetailDoc.data();
    if (!teamDetail) {
      return res.status(404).json({ error: 'Team details not found' });
    }
    
    // Check if user is a member
    const members = teamDetail.members || [];
    const isMember = members.some(
      (member: any) => member.email?.toLowerCase() === userEmail.toLowerCase()
    );
    
    if (!isMember) {
      return res.status(400).json({ error: 'You are not a member of this team' });
    }
    
    // Remove user from members
    const updatedMembers = members.filter(
      (member: any) => member.email?.toLowerCase() !== userEmail.toLowerCase()
    );
    
    // Update team details
    await db.collection(teamDetailsPath).doc(teamId).update({
      members: updatedMembers,
    });
    
    // Update team member count
    await db.collection(teamsPath).doc(teamId).update({
      members: updatedMembers.length,
    });
    
    res.json({ success: true, message: 'Left team successfully' });
  } catch (error) {
    console.error('Leave team error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to leave team' });
  }
});

// Migration endpoint to backfill ownerEmail for teams
app.post('/api/teams/migrate-owners', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const teamsPath = getCollectionPath('teams', domain);
    const teamDetailsPath = getCollectionPath('teamDetails', domain);
    
    // Get all teams
    const teamsSnapshot = await db.collection(teamsPath).get();
    const teams = teamsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
    
    const results = {
      updated: [] as string[],
      skipped: [] as string[],
      errors: [] as string[],
    };
    
    // Process each team
    for (const team of teams) {
      try {
        const teamName = team.name || team.id;
        
        // Skip if team already has an ownerEmail
        if (team.ownerEmail) {
          results.skipped.push(teamName);
          continue;
        }
        
        // Get team details to find members
        const teamDetailDoc = await db.collection(teamDetailsPath).doc(teamName).get();
        
        if (!teamDetailDoc.exists) {
          results.errors.push(`${teamName}: Team details not found`);
          continue;
        }
        
        const teamDetail = teamDetailDoc.data();
        
        // Find the first member to set as owner
        let ownerEmail: string | null = null;
        
        if (teamDetail?.members && Array.isArray(teamDetail.members) && teamDetail.members.length > 0) {
          // Use the first member's email as the owner
          ownerEmail = teamDetail.members[0].email;
        }
        
        if (!ownerEmail) {
          results.errors.push(`${teamName}: No members found to set as owner`);
          continue;
        }
        
        // Update both teams and teamDetails collections
        await db.collection(teamsPath).doc(teamName).update({
          ownerEmail: ownerEmail,
        });
        
        await db.collection(teamDetailsPath).doc(teamName).update({
          ownerEmail: ownerEmail,
        });
        
        results.updated.push(teamName);
      } catch (error: any) {
        const teamName = team.name || team.id;
        results.errors.push(`${teamName}: ${error.message}`);
      }
    }
    
    res.json({
      success: true,
      message: `Migration completed. Updated: ${results.updated.length}, Skipped: ${results.skipped.length}, Errors: ${results.errors.length}`,
      results,
    });
  } catch (error) {
    console.error('Migrate owners error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to migrate team owners' });
  }
});

// Helper function to create secret name for domain and integration
// Follows the pattern: integrations-{client-domain}-{tool-name}
// Domain and tool name contain only alphanumeric characters (no special characters)
// Example: integrations-examplecom-slack
function getSecretName(domain: string, integrationId: string): string {
  // Sanitize domain name: remove all special characters, keep only alphanumeric
  // Convert to lowercase for consistency
  const sanitizedDomain = domain
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ''); // Remove all non-alphanumeric characters
  
  // Sanitize integration ID: remove all special characters, keep only alphanumeric
  const sanitizedIntegrationId = integrationId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ''); // Remove all non-alphanumeric characters
  
  // Return in format: integrations-{client-domain}-{tool-name}
  // Only hyphens are used as separators between parts
  return `integrations-${sanitizedDomain}-${sanitizedIntegrationId}`;
}

// Helper function to save secret to GCP Secret Manager
async function saveSecret(secretName: string, secretValue: string): Promise<void> {
  const projectId = serviceAccount.project_id;
  const parent = `projects/${projectId}`;
  const fullSecretName = `${parent}/secrets/${secretName}`;

  console.log(`[Secret Manager] Attempting to save secret: ${secretName}`);
  console.log(`[Secret Manager] Full secret path: ${fullSecretName}`);
  console.log(`[Secret Manager] Using service account: ${serviceAccount.client_email}`);
  console.log(`[Secret Manager] Project ID: ${projectId}`);

  try {
    // Try to create the secret first (if it doesn't exist)
    // This avoids needing secretmanager.secrets.get permission
    try {
      console.log(`[Secret Manager] Attempting to create secret: ${secretName}`);
      await secretManagerClient.createSecret({
        parent,
        secretId: secretName,
        secret: {
          replication: {
            automatic: {},
          },
        },
      });
      console.log(`[Secret Manager] Secret created successfully: ${secretName}`);
    } catch (error: any) {
      // If secret already exists (error code 6 = ALREADY_EXISTS), that's fine
      // We'll proceed to add a version
      if (error.code === 6) { // ALREADY_EXISTS
        console.log(`[Secret Manager] Secret already exists: ${secretName}`);
      } else {
        console.error(`[Secret Manager] Error creating secret:`, {
          code: error.code,
          message: error.message,
          details: error.details,
          serviceAccount: serviceAccount.client_email,
        });
        throw error;
      }
    }

    // Add a new version with the secret value
    console.log(`[Secret Manager] Adding version to secret: ${secretName}`);
    await secretManagerClient.addSecretVersion({
      parent: fullSecretName,
      payload: {
        data: Buffer.from(secretValue, 'utf8'),
      },
    });
    console.log(`[Secret Manager] Secret version added successfully: ${secretName}`);
  } catch (error: any) {
    console.error('[Secret Manager] Error saving secret:', {
      secretName,
      projectId,
      serviceAccount: serviceAccount.client_email,
      errorCode: error.code,
      errorMessage: error.message,
      errorDetails: error.details,
      fullError: error,
    });
    
    // Provide more helpful error message
    if (error.code === 7) { // PERMISSION_DENIED
      throw new Error(
        `Permission denied for service account '${serviceAccount.client_email}'. ` +
        `Please verify that this service account has the 'roles/secretmanager.admin' role. ` +
        `Error details: ${error.message}`
      );
    }
    
    throw new Error(`Failed to save secret: ${error.message}`);
  }
}

// Helper function to delete secret from GCP Secret Manager
async function deleteSecret(secretName: string): Promise<void> {
  const projectId = serviceAccount.project_id;
  const fullSecretName = `projects/${projectId}/secrets/${secretName}`;

  try {
    await secretManagerClient.deleteSecret({ name: fullSecretName });
  } catch (error: any) {
    // If secret doesn't exist, that's fine
    if (error.code !== 5) { // NOT_FOUND
      console.error('Error deleting secret:', error);
      throw new Error(`Failed to delete secret: ${error.message}`);
    }
  }
}

// Integrations endpoints
app.get('/api/integrations', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const collectionPath = getCollectionPath('integrations', domain);
    const snapshot = await db.collection(collectionPath).get();
    
    // Map Firestore documents to integration objects
    // Only return integrations that exist in Firestore (connected integrations)
    const integrations = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name || doc.id.charAt(0).toUpperCase() + doc.id.slice(1),
        connected: data.connected || true, // If record exists, it's connected
        secretName: data.secretName, // Include secret name for reference
        connectedAt: data.connectedAt,
        updatedAt: data.updatedAt,
      };
    });

    // Ensure we return all three integrations with their connection status
    // Only show connected integrations from Firestore (which are in sync with Secret Manager)
    const allIntegrations = [
      { id: 'slack', name: 'Slack' },
      { id: 'atlassian', name: 'Atlassian' },
      { id: 'github', name: 'GitHub' },
    ].map(integration => {
      const existing = integrations.find(i => i.id === integration.id);
      return {
        id: integration.id,
        name: integration.name,
        connected: existing ? true : false, // Only connected if record exists in Firestore
        secretName: existing?.secretName, // Include secret name if connected
        connectedAt: existing?.connectedAt,
        updatedAt: existing?.updatedAt,
      };
    });

    res.json(allIntegrations);
  } catch (error) {
    console.error('Get integrations error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to fetch integrations' });
  }
});

app.post('/api/integrations/slack/connect', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const { botToken } = req.body;

    if (!botToken) {
      return res.status(400).json({ error: 'Bot token is required' });
    }

    // Generate secret name
    const secretName = getSecretName(domain, 'slack');
    
    // Save credentials to GCP Secret Manager first
    await saveSecret(secretName, JSON.stringify({ botToken }));

    // Only update Firestore if Secret Manager operation succeeds
    // Store integration record with secret name to keep in sync
    const collectionPath = getCollectionPath('integrations', domain);
    await db.collection(collectionPath).doc('slack').set({
      id: 'slack',
      name: 'Slack',
      connected: true,
      secretName: secretName, // Store the secret name for reference
      connectedAt: new Date(),
      updatedAt: new Date(),
    }, { merge: true });

    console.log(`[Integrations] Slack connected for domain ${domain}, secret: ${secretName}`);
    res.json({ success: true, message: 'Slack connected successfully' });
  } catch (error) {
    console.error('Connect Slack error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to connect Slack' });
  }
});

app.post('/api/integrations/atlassian/connect', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const { email, domain: atlassianDomainUrl, apiToken } = req.body;

    if (!email || !atlassianDomainUrl || !apiToken) {
      return res.status(400).json({ error: 'Email, Atlassian domain, and API token are required' });
    }

    // Generate secret name
    const secretName = getSecretName(domain, 'atlassian');
    
    // Save credentials to GCP Secret Manager first
    // Store domain instead of password for Atlassian integration
    await saveSecret(secretName, JSON.stringify({ email, domain: atlassianDomainUrl, apiToken }));

    // Only update Firestore if Secret Manager operation succeeds
    // Store integration record with secret name to keep in sync
    const collectionPath = getCollectionPath('integrations', domain);
    await db.collection(collectionPath).doc('atlassian').set({
      id: 'atlassian',
      name: 'Atlassian',
      connected: true,
      secretName: secretName, // Store the secret name for reference
      connectedAt: new Date(),
      updatedAt: new Date(),
    }, { merge: true });

    console.log(`[Integrations] Atlassian connected for domain ${domain}, secret: ${secretName}`);
    res.json({ success: true, message: 'Atlassian connected successfully' });
  } catch (error) {
    console.error('Connect Atlassian error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to connect Atlassian' });
  }
});

app.post('/api/integrations/:integrationId/disconnect', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const integrationId = req.params.integrationId;

    if (!['slack', 'atlassian', 'github'].includes(integrationId)) {
      return res.status(400).json({ error: 'Invalid integration ID' });
    }

    // Get the secret name from Firestore if it exists, otherwise generate it
    const collectionPath = getCollectionPath('integrations', domain);
    const integrationDoc = await db.collection(collectionPath).doc(integrationId).get();
    const secretName = integrationDoc.exists && integrationDoc.data()?.secretName 
      ? integrationDoc.data()!.secretName 
      : getSecretName(domain, integrationId);

    // Delete secret from GCP Secret Manager first
    // deleteSecret handles the case where secret doesn't exist, so it's safe to call
    await deleteSecret(secretName);

    // Delete the Firestore record to keep in sync with Secret Manager
    // Only delete if Secret Manager operation succeeds
    await db.collection(collectionPath).doc(integrationId).delete();

    console.log(`[Integrations] ${integrationId} disconnected for domain ${domain}, secret deleted: ${secretName}`);
    res.json({ success: true, message: 'Integration disconnected successfully' });
  } catch (error) {
    console.error('Disconnect integration error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to disconnect integration' });
  }
});

// Messages endpoints
app.get('/api/messages/:chatId', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const chatId = req.params.chatId;
    const afterTimestamp = req.query.afterTimestamp ? new Date(req.query.afterTimestamp as string) : null;
    const collectionPath = getCollectionPath('messages', domain);
    
    // Query messages for this chat, ordered by timestamp
    // If afterTimestamp is provided, only fetch messages after that timestamp
    // If index doesn't exist, fetch without orderBy and sort in memory
    let snapshot;
    try {
      if (afterTimestamp) {
        // Fetch only messages after the specified timestamp
        snapshot = await db.collection(collectionPath)
          .where('chatId', '==', chatId)
          .where('timestamp', '>', afterTimestamp)
          .orderBy('timestamp', 'asc')
          .get();
      } else {
        // Fetch all messages
        snapshot = await db.collection(collectionPath)
          .where('chatId', '==', chatId)
          .orderBy('timestamp', 'asc')
          .get();
      }
    } catch (error: any) {
      // If index error, fetch without orderBy and sort in memory
      if (error.code === 9 || error.message?.includes('index')) {
        snapshot = await db.collection(collectionPath)
          .where('chatId', '==', chatId)
          .get();
        // Sort in memory and filter by timestamp if needed
        let docs = snapshot.docs.sort((a, b) => {
          const aTime = a.data().timestamp?.toDate?.()?.getTime() || 0;
          const bTime = b.data().timestamp?.toDate?.()?.getTime() || 0;
          return aTime - bTime; // Ascending
        });
        
        // Filter by timestamp if afterTimestamp is provided
        if (afterTimestamp) {
          docs = docs.filter(doc => {
            const docTime = doc.data().timestamp?.toDate?.()?.getTime() || 0;
            return docTime > afterTimestamp.getTime();
          });
        }
        
        // Create a new QuerySnapshot-like object
        snapshot = { docs, empty: docs.length === 0 };
      } else {
        throw error;
      }
    }
    
    const messages = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.timestamp,
      };
    });
    
    res.json(messages);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to fetch messages' });
  }
});

app.post('/api/messages', authenticateUser, async (req, res) => {
  try {
    const domain = (req as any).userDomain;
    const userEmail = (req as any).user.email;
    const { chatId, role, content, memberName, memberAvatar, projectId, teamId } = req.body;

    if (!chatId || !content) {
      return res.status(400).json({ error: 'chatId and content are required' });
    }

    // Get user info for memberName and memberAvatar if not provided
    let finalMemberName = memberName || 'You';
    let finalMemberAvatar = memberAvatar || 'U';
    
    if (!memberName || !memberAvatar) {
      const usersCollectionPath = getCollectionPath('users', domain);
      const userDoc = await db.collection(usersCollectionPath).doc(userEmail.toLowerCase()).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        if (userData) {
          const firstName = userData.firstName || '';
          const lastName = userData.lastName || '';
          finalMemberName = `${firstName} ${lastName}`.trim() || userEmail;
          finalMemberAvatar = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || userEmail.charAt(0).toUpperCase();
        }
      }
    }

    const collectionPath = getCollectionPath('messages', domain);
    const messageData: any = {
      chatId,
      role: role || 'user',
      content,
      timestamp: new Date(),
      userId: userEmail.toLowerCase(),
    };

    // Add project-specific fields for project channel messages
    if (projectId) {
      messageData.projectId = projectId;
      messageData.memberName = finalMemberName;
      messageData.memberAvatar = finalMemberAvatar;
    }

    // Add team-specific fields for team channel messages
    if (teamId) {
      messageData.teamId = teamId;
      messageData.memberName = finalMemberName;
      messageData.memberAvatar = finalMemberAvatar;
    }

    const docRef = await db.collection(collectionPath).add(messageData);
    
    res.json({
      success: true,
      messageId: docRef.id,
      message: {
        id: docRef.id,
        ...messageData,
        timestamp: messageData.timestamp.toISOString(),
      },
    });
  } catch (error) {
    console.error('Create message error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to create message' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Firestore proxy server running on http://0.0.0.0:${PORT}`);
  console.log(`📊 Using project: ${serviceAccount.project_id}`);
  console.log(`🗄️  Database: leanworks-prod`);
});

