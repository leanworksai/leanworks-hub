import express from 'express';
import cors from 'cors';
import Stripe from 'stripe';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import crypto from 'crypto';
import { 
  getSharedPool, 
  getOrgPool, 
  getOrgPoolBySlug,
  getUserOrganizations,
  getPersonalWorkspace,
  checkOrgMembership,
  isOrgOwner,
  getOrgMembers,
  generateOrgSlug,
  generatePersonalSlug,
  sanitizeSlugForDb,
  checkDatabaseExists,
  queryShared,
  queryOrg,
  getUserInfoBatch,
  enrichWithUserNames,
  getOrgSlugById,
} from '../database/multi-tenant-pool.js';
import { setupIntegrationEndpoints } from './endpoints/integrations.js';
import { setupCallEndpoints } from './endpoints/calls.js';
import { setupImageEndpoints } from './endpoints/images.js';
import { setupTurnEndpoints } from './endpoints/turn.js';
import { setupLiveKitEndpoints, setupLiveKitWebSocketServer } from './endpoints/livekit.js';
import { setFirestoreDb } from './services/audio-recorder.js';
import http from 'http';
import { sendVerificationEmail, sendInvitationEmail } from './services/email.js';

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

// ============================================================================
// STRIPE INITIALIZATION (from Secret Manager)
// ============================================================================

// Cache for Stripe secrets
let cachedStripeSecrets: {
  secretKey: string;
  webhookSecret: string;
  priceStandard: string;
  pricePro: string;
} | null = null;
let stripeSecretsCacheTime: number = 0;
const STRIPE_SECRETS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Lazy-initialized Stripe instance
let stripe: Stripe | null = null;
let stripeWebhookSecret: string = '';
let STRIPE_PRICE_IDS: { standard: string; pro: string } = { standard: '', pro: '' };

async function getStripeSecretsFromSecretManager(): Promise<typeof cachedStripeSecrets> {
  // Return cached secrets if still valid
  if (cachedStripeSecrets && Date.now() - stripeSecretsCacheTime < STRIPE_SECRETS_CACHE_TTL) {
    return cachedStripeSecrets;
  }

  const projectId = serviceAccount.project_id;
  
  try {
    // Fetch all Stripe secrets in parallel
    const [secretKeyResult, webhookSecretResult, priceStandardResult, priceProResult] = await Promise.all([
      secretManagerClient.accessSecretVersion({ 
        name: `projects/${projectId}/secrets/stripe-secret-key/versions/latest` 
      }),
      secretManagerClient.accessSecretVersion({ 
        name: `projects/${projectId}/secrets/stripe-webhook-secret/versions/latest` 
      }),
      secretManagerClient.accessSecretVersion({ 
        name: `projects/${projectId}/secrets/stripe-price-standard/versions/latest` 
      }),
      secretManagerClient.accessSecretVersion({ 
        name: `projects/${projectId}/secrets/stripe-price-pro/versions/latest` 
      }),
    ]);

    cachedStripeSecrets = {
      secretKey: secretKeyResult[0].payload?.data?.toString()?.trim() || '',
      // Allow env var override for webhook secret (useful for Stripe CLI local testing)
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || webhookSecretResult[0].payload?.data?.toString()?.trim() || '',
      priceStandard: priceStandardResult[0].payload?.data?.toString()?.trim() || '',
      pricePro: priceProResult[0].payload?.data?.toString()?.trim() || '',
    };
    stripeSecretsCacheTime = Date.now();
    console.log('✅ Stripe secrets fetched from Secret Manager');
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      console.log('ℹ️  Using STRIPE_WEBHOOK_SECRET from environment (Stripe CLI mode)');
    }
    return cachedStripeSecrets;
  } catch (error) {
    console.error('❌ Failed to fetch Stripe secrets from Secret Manager:', error);
    // Fallback to environment variables for local development
    cachedStripeSecrets = {
      secretKey: process.env.STRIPE_SECRET_KEY || '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
      priceStandard: process.env.STRIPE_PRICE_STANDARD || '',
      pricePro: process.env.STRIPE_PRICE_PRO || '',
    };
    console.log('⚠️ Using fallback Stripe secrets from environment variables');
    return cachedStripeSecrets;
  }
}

// Initialize Stripe lazily
async function getStripe(): Promise<Stripe | null> {
  if (stripe) return stripe;
  
  const secrets = await getStripeSecretsFromSecretManager();
  if (!secrets?.secretKey) {
    console.log('⚠️ Stripe not initialized - secret key not available');
    return null;
  }
  
  stripe = new Stripe(secrets.secretKey, { apiVersion: '2024-11-20.acacia' });
  stripeWebhookSecret = secrets.webhookSecret;
  STRIPE_PRICE_IDS = {
    standard: secrets.priceStandard,
    pro: secrets.pricePro,
  };
  console.log('✅ Stripe initialized');
  return stripe;
}

// Initialize Stripe on startup
getStripe().catch(err => console.error('Stripe initialization error:', err));

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
// STATIC FILE SERVING (for production build - serve built frontend)
// ============================================================================
const distPath = join(__dirname, '../dist');
if (existsSync(distPath)) {
  // Serve static files from dist directory
  app.use(express.static(distPath));
  console.log('✅ Serving static files from:', distPath);
} else {
  console.log('⚠️  dist directory not found - static file serving disabled');
  console.log('   Run "npm run build" to create production build');
}

// ============================================================================
// REQUEST LOGGING MIDDLEWARE (for debugging - must be before routes)
// ============================================================================

app.use((req, res, next) => {
  next();
});

// JSON parsing middleware (except for GitHub webhook, Stripe webhook, and image uploads)
app.use((req, res, next) => {
  if (req.path === '/api/integrations/github/webhooks' || 
      req.path === '/api/webhooks/stripe' || 
      req.path.startsWith('/api/images/')) {
    next();
  } else {
    express.json()(req, res, next);
  }
});

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

// Helper function to check if an error is a network/transient error
function isNetworkError(error: any): boolean {
  const networkErrorCodes = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN'];
  const networkErrorMessages = ['socket hang up', 'timeout', 'network', 'connection'];
  
  if (error.code && networkErrorCodes.includes(error.code)) {
    return true;
  }
  
  if (error.message) {
    const lowerMessage = error.message.toLowerCase();
    return networkErrorMessages.some(msg => lowerMessage.includes(msg));
  }
  
  return false;
}

// Helper function to retry Firebase operations with exponential backoff
async function retryFirebaseOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 100
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Only retry on network errors
      if (!isNetworkError(error) || attempt === maxRetries - 1) {
        throw error;
      }
      
      // Exponential backoff: 100ms, 200ms, 400ms
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

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
    let userEmail: string | undefined;
    
    // Try to verify as ID token first (normal flow when Firebase Auth works)
    try {
      const decodedToken = await retryFirebaseOperation(
        () => auth.verifyIdToken(token),
        3, // max retries
        100 // base delay in ms
      );
      (req as any).user = decodedToken;
      userEmail = decodedToken.email;
      (req as any).userEmail = userEmail;
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
              // Verify the user exists and get their info with retry
              const userRecord = await retryFirebaseOperation(
                () => auth.getUser(payload.uid),
                3,
                100
              );
              
              // Create a decoded token-like object
              const decodedToken = {
                uid: userRecord.uid,
                email: userRecord.email,
                email_verified: userRecord.emailVerified,
              };
              
              (req as any).user = decodedToken;
              userEmail = userRecord.email;
              (req as any).userEmail = userEmail;
            }
          }
        } catch (customTokenError: any) {
          // If custom token handling fails, log and throw original error
          console.error('❌ [Backend] authenticateUser: Custom token handling failed', {
            error: customTokenError.message,
            code: customTokenError.code,
            isNetworkError: isNetworkError(customTokenError),
            stack: customTokenError.stack,
          });
          throw idTokenError;
        }
      } else {
      // If we get here, both methods failed or it's not a custom token error
      throw idTokenError;
    }
    }
    
    // Get org context from header (if provided)
    const orgId = req.headers['x-org-id'] as string | undefined;
    if (orgId && userEmail) {
      // Validate org membership
      const membership = await checkOrgMembership(orgId, userEmail);
      if (membership.isMember) {
        (req as any).orgId = orgId;
        (req as any).orgRole = membership.role;
      }
    }
    
    next();
  } catch (error: any) {
    // Only log network errors at warn level to reduce noise
    const logLevel = isNetworkError(error) ? 'warn' : 'error';
    const logMethod = logLevel === 'warn' ? console.warn : console.error;
    
    logMethod(`❌ [Backend] authenticateUser: Authentication failed`, {
      error: error.message,
      code: error.code,
      isNetworkError: isNetworkError(error),
      method: req.method,
      path: req.path,
      url: req.url,
    });
    
    // For network errors, return 503 (Service Unavailable) instead of 401
    // This helps clients distinguish between auth failures and service issues
    const statusCode = isNetworkError(error) ? 503 : 401;
    const errorMessage = isNetworkError(error) 
      ? 'Authentication service temporarily unavailable. Please try again.' 
      : 'Invalid token';
    
    res.status(statusCode).json({ error: errorMessage });
  }
}

// ============================================================================
// ORG MEMBERSHIP MIDDLEWARE
// ============================================================================

/**
 * Middleware to require org membership for org-scoped endpoints
 * Must be used after authenticateUser
 */
async function requireOrgMembership(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = req.headers['x-org-id'] as string || req.params.orgId;
    
    if (!orgId) {
      return res.status(400).json({ error: 'Organization ID is required (X-Org-Id header or orgId param)' });
    }
    
    if (!userEmail) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    const membership = await checkOrgMembership(orgId, userEmail);
    if (!membership.isMember) {
      return res.status(403).json({ error: 'Not a member of this organization' });
    }
    
    (req as any).orgId = orgId;
    (req as any).orgRole = membership.role;
    
    next();
  } catch (error: any) {
    console.error('❌ [Backend] requireOrgMembership failed:', error.message);
    res.status(500).json({ error: 'Failed to verify organization membership' });
  }
}

/**
 * Middleware to require org owner role
 * Must be used after authenticateUser
 */
async function requireOrgOwner(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const userEmail = (req as any).userEmail;
    const headerOrgId = req.headers['x-org-id'] as string;
    const paramOrgId = req.params.orgId;
    const orgId = headerOrgId || paramOrgId;
    
    console.log(`[requireOrgOwner] Checking ownership - headerOrgId: ${headerOrgId}, paramOrgId: ${paramOrgId}, final orgId: ${orgId}, userEmail: ${userEmail}`);
    
    if (!orgId) {
      console.error(`[requireOrgOwner] Missing orgId - headers:`, req.headers, `params:`, req.params);
      return res.status(400).json({ error: 'Organization ID is required' });
    }
    
    if (!userEmail) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    const isOwner = await isOrgOwner(orgId, userEmail);
    console.log(`[requireOrgOwner] Ownership check result - isOwner: ${isOwner} for orgId: ${orgId}, userEmail: ${userEmail}`);
    if (!isOwner) {
      return res.status(403).json({ error: 'Only organization owners can perform this action' });
    }
    
    (req as any).orgId = orgId;
    (req as any).orgRole = 'owner';
    
    next();
  } catch (error: any) {
    console.error('❌ [Backend] requireOrgOwner failed:', error.message);
    res.status(500).json({ error: 'Failed to verify organization ownership' });
  }
}

/**
 * Helper to get org pool from request (after requireOrgMembership)
 */
async function getReqOrgPool(req: express.Request) {
  const orgId = (req as any).orgId;
  if (!orgId) {
    throw new Error('Organization ID not set in request');
  }
  return getOrgPool(orgId);
}

// Helper to get Firestore collection path using org slug (sanitized name)
async function getOrgCollectionPath(collection: string, orgId: string | undefined): Promise<string> {
  if (!orgId) {
    return `orgs/default/${collection}`;
  }
  
  try {
    const orgSlug = await getOrgSlugById(orgId);
    return `orgs/${orgSlug}/${collection}`;
  } catch (error) {
    console.error(`Failed to get org slug for ${orgId}, using default:`, error);
    return `orgs/default/${collection}`;
  }
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
// AUTHORIZATION HELPERS
// ============================================================================

/**
 * Check if a user has access to a project based on visibility rules
 * Access is granted if:
 * - User is the project owner, OR
 * - Project visibility is 'all_members' (default - visible to all org members), OR
 * - Project visibility is 'specific_members' and user is in visible_to_members
 * Note: project_members table is NOT used for access control - only visibility rules apply
 * @param orgId - Organization ID to query in the correct database
 * @param userEmail - User's email
 * @param projectId - Project ID to check access for
 */
async function hasProjectAccess(orgId: string, userEmail: string, projectId: string): Promise<boolean> {
  try {
    const pool = await getOrgPool(orgId);
    const normalizedEmail = userEmail.toLowerCase();
    const result = await pool.query(`
      SELECT 
        p.visibility,
        p.visible_to_members,
        p.owner_email
      FROM projects p
      WHERE p.id = $1
    `, [projectId]);
    
    if (result.rows.length === 0) {
      return false;
    }
    
    const project = result.rows[0];
    const visibility = project.visibility || 'all_members';
    const isOwner = project.owner_email.toLowerCase() === normalizedEmail;
    
    // Owner always has access
    if (isOwner) {
      return true;
    }
    
    // If visibility is 'all_members', all org members have access
    if (visibility === 'all_members') {
      return true;
    }
    
    // If visibility is 'specific_members', check if user is in visible_to_members
    if (visibility === 'specific_members') {
      const visibleToMembers = Array.isArray(project.visible_to_members) 
        ? project.visible_to_members 
        : (project.visible_to_members ? JSON.parse(project.visible_to_members) : []);
      return visibleToMembers.includes(normalizedEmail);
    }
    
    return false;
  } catch (error) {
    console.error('Error checking project access:', error);
    return false;
  }
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
// DEMO REQUESTS ENDPOINT (Shared DB - Public, no auth required)
// ============================================================================

app.post('/api/demo-requests', async (req, res) => {
  try {
    const { name, email, company, message } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const pool = await getSharedPool();
    const result = await pool.query(`
      INSERT INTO demo_requests (name, email, company, message, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id
    `, [name, email.toLowerCase(), company || null, message || null]);

    res.status(201).json({ 
      success: true,
      id: result.rows[0].id,
      message: 'Demo request submitted successfully'
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message || 'Failed to submit demo request' });
  }
});

// ============================================================================
// USER ENDPOINTS (Shared DB for users, Per-org DB for org data)
// ============================================================================

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, firstName, lastName, jobTitle, timezone } = req.body;
    
    // Validate required fields
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: 'Email, password, first name, and last name are required' });
    }
    
    if (!timezone) {
      return res.status(400).json({ error: 'Timezone is required' });
    }
    
    const normalizedEmail = email.toLowerCase();
    const sharedPool = await getSharedPool();
    
    // Check if user already exists
    const existingUser = await sharedPool.query(
      'SELECT email FROM users WHERE email = $1',
      [normalizedEmail]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }
    
    // Create user in Firebase Auth
    const userRecord = await auth.createUser({
      email: normalizedEmail,
      password,
      displayName: `${firstName} ${lastName}`,
    });
    
    // Hash password for PostgreSQL
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Store user in shared database with 7-day free trial for standard plan
    await sharedPool.query(`
      INSERT INTO users (email, password_hash, first_name, last_name, job_title, timezone, subscription_plan, trial_ends_at, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'standard', NOW() + INTERVAL '7 days', NOW())
    `, [normalizedEmail, passwordHash, firstName, lastName, jobTitle || '', timezone]);
    
    // Auto-create personal workspace for the user
    const personalOrgName = `${firstName}'s Workspace`;
    const personalSlug = generatePersonalSlug(normalizedEmail);
    
    // Create organization record
    const orgResult = await sharedPool.query(`
      INSERT INTO organizations (name, slug, type, owner_email, created_at)
      VALUES ($1, $2, 'personal', $3, NOW())
      RETURNING id, name, slug
    `, [personalOrgName, personalSlug, normalizedEmail]);
    
    const personalOrg = orgResult.rows[0];
    
    // Add user as owner of personal workspace
    await sharedPool.query(`
      INSERT INTO org_members (org_id, user_email, role, joined_at)
      VALUES ($1, $2, 'owner', NOW())
    `, [personalOrg.id, normalizedEmail]);
    
    // Initialize the org database (this auto-creates the DB and schema)
    const orgPool = await getOrgPoolBySlug(personalSlug);
    
    // Add user to org-level users table
    await orgPool.query(`
      INSERT INTO users (email, first_name, last_name, job_title, role, joined_at)
      VALUES ($1, $2, $3, $4, 'owner', NOW())
      ON CONFLICT (email) DO NOTHING
    `, [normalizedEmail, firstName, lastName, jobTitle]);
    
    console.log(`✅ Created personal workspace for ${normalizedEmail}: ${personalOrgName} (${personalSlug})`);

    // Generate email verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    
    // Store verification token in database
    await sharedPool.query(`
      INSERT INTO email_verification_tokens (email, token, created_at, expires_at)
      VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')
    `, [normalizedEmail, verificationToken]);
    
    // Send verification email
    try {
      await sendVerificationEmail(
        secretManagerClient,
        serviceAccount.project_id,
        normalizedEmail,
        firstName,
        verificationToken
      );
      console.log(`✅ Verification email sent to ${normalizedEmail}`);
    } catch (emailError: any) {
      console.error(`⚠️ Failed to send verification email to ${normalizedEmail}:`, emailError.message);
      // Don't fail signup if email fails - user can request resend
    }

    res.status(201).json({ 
      success: true, 
      uid: userRecord.uid,
      email: userRecord.email,
      message: 'Account created! Please check your email to verify your account.',
      personalOrg: {
        id: personalOrg.id,
        name: personalOrg.name,
        slug: personalOrg.slug,
        type: 'personal'
      }
    });
  } catch (error: any) {
    console.error('Signup error:', error);
    // Clean up Firebase user if database operations failed
    if (error.message?.includes('INSERT') || error.message?.includes('database')) {
      try {
        const email = req.body.email?.toLowerCase();
        if (email) {
          const userRecord = await auth.getUserByEmail(email);
          await auth.deleteUser(userRecord.uid);
          console.log('Cleaned up Firebase user after signup failure');
        }
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }
    res.status(500).json({ error: error.message || 'Failed to create account' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.toLowerCase();
    const sharedPool = await getSharedPool();

    // Get user from shared PostgreSQL database
    const userResult = await sharedPool.query(
      'SELECT email, password_hash, first_name, last_name, timezone, email_verified FROM users WHERE email = $1',
      [normalizedEmail]
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

    // Check if email is verified
    if (!userData.email_verified) {
      return res.status(403).json({ 
        error: 'Please verify your email before logging in',
        code: 'EMAIL_NOT_VERIFIED',
        email: normalizedEmail
      });
    }

    // Update last login
    await sharedPool.query(
      'UPDATE users SET last_login = NOW() WHERE email = $1',
      [normalizedEmail]
    );

    // Get user's organizations
    const organizations = await getUserOrganizations(normalizedEmail);
    
    // Find personal workspace (should always exist)
    const personalOrg = organizations.find(org => org.type === 'personal');
    
    // If user has no orgs (shouldn't happen, but handle gracefully)
    if (organizations.length === 0) {
      console.warn(`User ${normalizedEmail} has no organizations, creating personal workspace`);
      
      // Create personal workspace
      const personalOrgName = `${userData.first_name}'s Workspace`;
      const personalSlug = generatePersonalSlug(normalizedEmail);
      
      const orgResult = await sharedPool.query(`
        INSERT INTO organizations (name, slug, type, owner_email, created_at)
        VALUES ($1, $2, 'personal', $3, NOW())
        RETURNING id, name, slug, type
      `, [personalOrgName, personalSlug, normalizedEmail]);
      
      const newOrg = orgResult.rows[0];
      
      await sharedPool.query(`
        INSERT INTO org_members (org_id, user_email, role, joined_at)
        VALUES ($1, $2, 'owner', NOW())
      `, [newOrg.id, normalizedEmail]);
      
      // Initialize the org database
      const orgPool = await getOrgPoolBySlug(personalSlug);
      
      // Add user to org-level users table
      await orgPool.query(`
        INSERT INTO users (email, first_name, last_name, job_title, role, joined_at)
        VALUES ($1, $2, $3, $4, 'owner', NOW())
        ON CONFLICT (email) DO NOTHING
      `, [normalizedEmail, userData.first_name, userData.last_name, userData.job_title || null]);
      
      organizations.push({
        ...newOrg,
        role: 'owner',
        owner_email: normalizedEmail
      });
    }

    // Get or create Firebase Auth user (for custom token generation)
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(normalizedEmail);
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        // Create Firebase Auth user if it doesn't exist
        userRecord = await auth.createUser({
          email: normalizedEmail,
          password,
          emailVerified: true,
          displayName: `${userData.first_name} ${userData.last_name}`,
        });
      } else {
        throw error;
      }
    }

    // Ensure user is verified and has email
    if (!userRecord.email) {
      throw new Error('User record must have an email');
    }
    
    // Ensure email is verified
    if (!userRecord.emailVerified) {
      await auth.updateUser(userRecord.uid, { emailVerified: true });
      userRecord = await auth.getUser(userRecord.uid);
    }
    
    // Set custom claims to ensure email is available in ID tokens
    // Note: Firebase should automatically include email from user record, but we set it explicitly
    // to ensure it's available in request.auth.token.email for Firestore security rules
    // Note: The email in the ID token comes from userRecord.email (which is lowercase from normalizedEmail)
    try {
      await auth.setCustomUserClaims(userRecord.uid, {
        email: userRecord.email,
        email_verified: userRecord.emailVerified,
      });
      console.log('✅ Set custom claims for user:', userRecord.uid, 'email:', userRecord.email);
    } catch (claimsError: any) {
      // If setting claims fails, log but continue (email should still be in standard claims)
      console.warn('⚠️ Failed to set custom claims (non-critical):', claimsError.message);
    }

    // Create custom token
    // The email should be included in the ID token when this custom token is exchanged
    // Firebase automatically includes email from user record, and our custom claims above ensure it
    const customToken = await auth.createCustomToken(userRecord.uid);

    res.json({ 
      success: true,
      customToken,
      user: {
        uid: userRecord.uid,
        email: userRecord.email,
        emailVerified: userRecord.emailVerified,
        firstName: userData.first_name,
        lastName: userData.last_name,
      },
      organizations: organizations.map(org => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        type: org.type,
        role: org.role,
        isOwner: org.owner_email === normalizedEmail,
      })),
      // Default to personal workspace
      defaultOrgId: personalOrg?.id || organizations[0]?.id,
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message || 'Failed to sign in' });
  }
});

// ============================================================================
// EMAIL VERIFICATION ENDPOINTS
// ============================================================================

// Verify email with token
app.get('/api/auth/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Verification token is required' });
    }
    
    const sharedPool = await getSharedPool();
    
    // Find the token and check if it's valid
    const tokenResult = await sharedPool.query(`
      SELECT email, expires_at, used_at
      FROM email_verification_tokens
      WHERE token = $1
    `, [token]);
    
    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid verification token' });
    }
    
    const tokenData = tokenResult.rows[0];
    
    // Check if token was already used
    if (tokenData.used_at) {
      return res.status(400).json({ error: 'This verification link has already been used' });
    }
    
    // Check if token is expired
    if (new Date(tokenData.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This verification link has expired. Please request a new one.' });
    }
    
    // Mark email as verified
    await sharedPool.query(
      'UPDATE users SET email_verified = TRUE WHERE email = $1',
      [tokenData.email]
    );
    
    // Mark token as used
    await sharedPool.query(
      'UPDATE email_verification_tokens SET used_at = NOW() WHERE token = $1',
      [token]
    );
    
    // Update Firebase Auth user's email verification status
    try {
      const userRecord = await auth.getUserByEmail(tokenData.email);
      if (!userRecord.emailVerified) {
        await auth.updateUser(userRecord.uid, { emailVerified: true });
      }
    } catch (firebaseError: any) {
      console.warn('⚠️ Could not update Firebase email verification (non-critical):', firebaseError.message);
    }
    
    console.log(`✅ Email verified for ${tokenData.email}`);
    
    res.json({ 
      success: true, 
      message: 'Email verified successfully! You can now log in.',
      email: tokenData.email
    });
  } catch (error: any) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: error.message || 'Failed to verify email' });
  }
});

// Resend verification email
app.post('/api/auth/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const normalizedEmail = email.toLowerCase();
    const sharedPool = await getSharedPool();
    
    // Check if user exists and is not already verified
    const userResult = await sharedPool.query(
      'SELECT email, first_name, email_verified FROM users WHERE email = $1',
      [normalizedEmail]
    );
    
    if (userResult.rows.length === 0) {
      // Don't reveal if email exists or not for security
      return res.json({ 
        success: true, 
        message: 'If an account exists with this email, a verification link will be sent.' 
      });
    }
    
    const userData = userResult.rows[0];
    
    if (userData.email_verified) {
      return res.status(400).json({ error: 'This email is already verified' });
    }
    
    // Check for rate limiting - don't allow more than 10 tokens in the last hour
    const recentTokens = await sharedPool.query(`
      SELECT COUNT(*) as count
      FROM email_verification_tokens
      WHERE email = $1 AND created_at > NOW() - INTERVAL '1 hour'
    `, [normalizedEmail]);
    
    if (parseInt(recentTokens.rows[0].count) >= 10) {
      return res.status(429).json({ error: 'Too many verification emails requested. Please try again later.' });
    }
    
    // Generate new verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    
    // Store new verification token
    await sharedPool.query(`
      INSERT INTO email_verification_tokens (email, token, created_at, expires_at)
      VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')
    `, [normalizedEmail, verificationToken]);
    
    // Send verification email
    await sendVerificationEmail(
      secretManagerClient,
      serviceAccount.project_id,
      normalizedEmail,
      userData.first_name,
      verificationToken
    );
    
    console.log(`✅ Verification email resent to ${normalizedEmail}`);
    
    res.json({ 
      success: true, 
      message: 'Verification email sent! Please check your inbox.' 
    });
  } catch (error: any) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: error.message || 'Failed to send verification email' });
  }
});

// Check email verification status (public endpoint for signup flow)
app.get('/api/auth/verification-status', async (req, res) => {
  try {
    const { email } = req.query;
    
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const normalizedEmail = email.toLowerCase();
    const sharedPool = await getSharedPool();
    
    const result = await sharedPool.query(
      'SELECT email_verified FROM users WHERE email = $1',
      [normalizedEmail]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ 
      verified: result.rows[0].email_verified 
    });
  } catch (error: any) {
    console.error('Verification status error:', error);
    res.status(500).json({ error: error.message || 'Failed to check verification status' });
  }
});

app.get('/api/users', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = req.headers['x-org-id'] as string;
    
    // If org context is provided, return org members from org-specific users table
    // Otherwise, return all users the requesting user can see (from their orgs)
    if (orgId) {
      // Validate membership
      const membership = await checkOrgMembership(orgId, userEmail);
      if (!membership.isMember) {
        return res.status(403).json({ error: 'Not a member of this organization' });
      }
      
      // Get org members from org-specific users table
      const orgPool = await getOrgPool(orgId);
      const result = await orgPool.query(`
        SELECT email, first_name, last_name, job_title, responsibilities,
               avatar, timezone, status, role, joined_at, last_active_at, created_at
        FROM users 
        WHERE status != 'inactive'
        ORDER BY 
          CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
          created_at ASC
      `);
      
      const transformed = result.rows.map(member => ({
        email: member.email,
        firstName: member.first_name,
        lastName: member.last_name,
        name: `${member.first_name || ''} ${member.last_name || ''}`.trim() || member.email,
        jobTitle: member.job_title,
        responsibilities: member.responsibilities,
        avatar: member.avatar,
        timezone: member.timezone,
        status: member.status,
        role: member.role,
        joinedAt: member.joined_at,
        lastActiveAt: member.last_active_at,
      }));
      
      res.json(transformed);
    } else {
      // No org context - return users from all orgs the user belongs to
      const sharedPool = await getSharedPool();
      const result = await sharedPool.query(`
        SELECT DISTINCT u.email, u.first_name, u.last_name, u.job_title, u.responsibilities, u.created_at
        FROM users u
        INNER JOIN org_members om ON u.email = om.user_email
        WHERE om.org_id IN (
          SELECT org_id FROM org_members WHERE user_email = $1
        )
        ORDER BY u.created_at DESC
      `, [userEmail]);
      
    const transformed = result.rows.map(row => {
      const user = transformRow(row);
      const firstName = user.firstName || '';
      const lastName = user.lastName || '';
      user.name = `${firstName} ${lastName}`.trim() || user.email;
      return user;
    });
    
    res.json(transformed);
    }
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Specific routes must come before parameterized routes
app.get('/api/users/profile', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const sharedPool = await getSharedPool();
    
    const result = await sharedPool.query(`
      SELECT email, first_name, last_name, job_title, timezone, responsibilities, created_at, last_login
      FROM users
      WHERE email = $1
    `, [userEmail]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = transformRow(result.rows[0]);
    
    // Get user's organizations
    const organizations = await getUserOrganizations(userEmail);
    
    res.json({
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      jobTitle: user.jobTitle,
      timezone: user.timezone,
      responsibilities: user.responsibilities,
      createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
      lastLogin: user.lastLogin ? new Date(user.lastLogin).toISOString() : null,
      organizations: organizations.map(org => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        type: org.type,
        role: org.role,
        isOwner: org.owner_email === userEmail,
      })),
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
    
    // User data is in shared DB
    const sharedPool = await getSharedPool();
    
    // Update user profile
    await sharedPool.query(`
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
    const sharedPool = await getSharedPool();
    
    const result = await sharedPool.query(`
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

// Delete user's own account
app.delete('/api/users/me', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    console.log(`🗑️ [Backend] DELETE /api/users/me - Deleting account for: ${userEmail}`);
    
    const sharedPool = await getSharedPool();
    
    // 1. Check if user owns any team organizations (cannot delete if owner of team org)
    const ownedTeamOrgs = await sharedPool.query(
      `SELECT id, name, type FROM organizations WHERE owner_email = $1 AND type = 'team'`,
      [userEmail]
    );
    
    if (ownedTeamOrgs.rows.length > 0) {
      console.log(`❌ [Backend] Cannot delete account - user owns ${ownedTeamOrgs.rows.length} team organization(s)`);
      return res.status(400).json({ 
        error: 'Cannot delete account while you own team organizations. Please transfer ownership or delete your organizations first.',
        ownedOrganizations: ownedTeamOrgs.rows.map(org => ({ id: org.id, name: org.name }))
      });
    }
    
    // 2. Get user's personal workspace (will be deleted)
    const personalWorkspace = await sharedPool.query(
      `SELECT id, slug FROM organizations WHERE owner_email = $1 AND type = 'personal'`,
      [userEmail]
    );
    
    // 3. Get all organizations where user is a member (to clean up per-org data)
    const memberOrgs = await sharedPool.query(
      `SELECT o.id, o.slug FROM organizations o 
       INNER JOIN org_members om ON o.id = om.org_id 
       WHERE om.user_email = $1`,
      [userEmail]
    );
    
    console.log(`📋 [Backend] User is member of ${memberOrgs.rows.length} organization(s)`);
    
    // 4. Clean up per-org databases
    for (const org of memberOrgs.rows) {
      try {
        console.log(`🧹 [Backend] Cleaning up user data from org: ${org.slug}`);
        const orgPool = await getOrgPoolBySlug(org.slug);
        
        // Remove from team_members
        await orgPool.query('DELETE FROM team_members WHERE user_email = $1', [userEmail]);
        
        // Remove from project_members
        await orgPool.query('DELETE FROM project_members WHERE user_email = $1', [userEmail]);
        
        // Unassign from tasks (set assignee to null)
        await orgPool.query(
          'UPDATE tasks SET assignee_id = NULL, assignee_name = NULL, assignee_avatar = NULL WHERE assignee_id = $1', 
          [userEmail]
        );
        
        // Update task created_by to indicate deleted user
        await orgPool.query(
          `UPDATE tasks SET created_by = '[deleted user]' WHERE created_by = $1`,
          [userEmail]
        );
        
        // Delete docs owned by user
        await orgPool.query('DELETE FROM docs WHERE owner_email = $1', [userEmail]);
        
        // Delete teams owned by user
        await orgPool.query('DELETE FROM teams WHERE owner_email = $1', [userEmail]);
        
        // Delete projects owned by user
        await orgPool.query('DELETE FROM projects WHERE owner_email = $1', [userEmail]);
        
        // Clean up team invitations
        await orgPool.query('DELETE FROM team_invitations WHERE invitee_email = $1 OR inviter_email = $1', [userEmail]);
        
        // Clean up team join requests
        await orgPool.query('DELETE FROM team_join_requests WHERE user_email = $1 OR owner_email = $1', [userEmail]);
        
        console.log(`✅ [Backend] Cleaned up org: ${org.slug}`);
      } catch (orgError) {
        console.error(`⚠️ [Backend] Error cleaning up org ${org.slug}:`, orgError);
        // Continue with other orgs even if one fails
      }
    }
    
    // 5. Delete personal workspace if it exists (this will cascade delete org_members for that org)
    if (personalWorkspace.rows.length > 0) {
      const personalOrgId = personalWorkspace.rows[0].id;
      const personalSlug = personalWorkspace.rows[0].slug;
      
      console.log(`🗑️ [Backend] Deleting personal workspace: ${personalSlug}`);
      await sharedPool.query('DELETE FROM organizations WHERE id = $1', [personalOrgId]);
    }
    
    // 6. Delete user from shared database (cascades to org_members, org_invitations, email_verification_tokens)
    console.log(`🗑️ [Backend] Deleting user from shared database: ${userEmail}`);
    await sharedPool.query('DELETE FROM users WHERE email = $1', [userEmail]);
    
    // 7. Delete from Firebase Auth
    try {
      console.log(`🗑️ [Backend] Deleting user from Firebase Auth: ${userEmail}`);
      const userRecord = await auth.getUserByEmail(userEmail);
      await auth.deleteUser(userRecord.uid);
      console.log(`✅ [Backend] Deleted user from Firebase Auth`);
    } catch (firebaseError: any) {
      // Log but don't fail - user data is already deleted from database
      console.warn(`⚠️ [Backend] Failed to delete Firebase user (may not exist):`, firebaseError.message);
    }
    
    console.log(`✅ [Backend] Account deleted successfully for: ${userEmail}`);
    res.json({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    console.error('❌ [Backend] Delete user account error:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to delete account' });
  }
});

// ============================================================================
// ORGANIZATION ENDPOINTS (Shared DB)
// ============================================================================

// Get user's organizations
app.get('/api/orgs', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const organizations = await getUserOrganizations(userEmail);
    
    res.json(organizations.map(org => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      type: org.type,
      role: org.role,
      description: org.description,
      avatar: org.avatar,
      isOwner: org.owner_email === userEmail,
      createdAt: org.created_at,
      joinedAt: org.joined_at,
    })));
  } catch (error) {
    console.error('Get orgs error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Create a new organization
app.post('/api/orgs', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const { name, description } = req.body;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Organization name is required' });
    }
    
    const sharedPool = await getSharedPool();
    
    // Generate slug from name
    const slug = generateOrgSlug(name.trim());
    
    // Check if slug already exists in organizations table
    const existingOrg = await sharedPool.query(
      'SELECT 1 FROM organizations WHERE slug = $1',
      [slug]
    );
    if (existingOrg.rows.length > 0) {
      return res.status(409).json({ 
        error: `An organization with a similar name already exists. Please choose a different name.` 
      });
    }
    
    // Check if a database with the sanitized name already exists
    const dbName = sanitizeSlugForDb(slug);
    const dbExists = await checkDatabaseExists(dbName);
    if (dbExists) {
      return res.status(409).json({ 
        error: `An organization with this name cannot be created because the database "${dbName}" already exists. Please choose a different name.` 
      });
    }
    
    // Create organization
    const orgResult = await sharedPool.query(`
      INSERT INTO organizations (name, slug, type, owner_email, description, created_at)
      VALUES ($1, $2, 'team', $3, $4, NOW())
      RETURNING id, name, slug, type, owner_email, description, created_at
    `, [name.trim(), slug, userEmail, description || null]);
    
    const org = orgResult.rows[0];
    
    // Add creator as owner
    await sharedPool.query(`
      INSERT INTO org_members (org_id, user_email, role, joined_at)
      VALUES ($1, $2, 'owner', NOW())
    `, [org.id, userEmail]);
    
    // Initialize org database (this will create it since we already checked it doesn't exist)
    const orgPool = await getOrgPoolBySlug(slug);
    
    // Get user info from shared DB to add to org users table
    const userResult = await sharedPool.query(
      'SELECT first_name, last_name, job_title FROM users WHERE email = $1',
      [userEmail]
    );
    const userData = userResult.rows[0] || {};
    
    // Add user to org-level users table
    await orgPool.query(`
      INSERT INTO users (email, first_name, last_name, job_title, role, joined_at)
      VALUES ($1, $2, $3, $4, 'owner', NOW())
      ON CONFLICT (email) DO NOTHING
    `, [userEmail, userData.first_name || '', userData.last_name || '', userData.job_title || null]);
    
    console.log(`✅ Created organization ${name} (${slug}) with database ${dbName} for ${userEmail}`);
    
    res.status(201).json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      type: org.type,
      description: org.description,
      isOwner: true,
      role: 'owner',
      createdAt: org.created_at,
    });
  } catch (error) {
    console.error('Create org error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get organization details
app.get('/api/orgs/:orgId', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = req.params.orgId;
    const sharedPool = await getSharedPool();
    
    // Get org details
    const orgResult = await sharedPool.query(`
      SELECT o.*, 
             (SELECT COUNT(*) FROM org_members WHERE org_id = o.id) as member_count,
             (SELECT COUNT(*) FROM org_invitations WHERE org_id = o.id AND status = 'pending') as pending_invitations
      FROM organizations o
      WHERE o.id = $1
    `, [orgId]);
    
    if (orgResult.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    const org = orgResult.rows[0];
    
    // Get members
    const members = await getOrgMembers(orgId);
    
    res.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      type: org.type,
      description: org.description,
      avatar: org.avatar,
      isOwner: org.owner_email === userEmail,
      ownerEmail: org.owner_email,
      memberCount: parseInt(org.member_count),
      pendingInvitations: parseInt(org.pending_invitations),
      createdAt: org.created_at,
      members: members.map(m => ({
        email: m.email,
        firstName: m.first_name,
        lastName: m.last_name,
        name: `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.email,
        role: m.role,
        jobTitle: m.job_title,
        joinedAt: m.joined_at,
      })),
    });
  } catch (error) {
    console.error('Get org details error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Update organization
app.put('/api/orgs/:orgId', authenticateUser, requireOrgOwner, async (req, res) => {
  try {
    const orgId = req.params.orgId;
    const { name, description, avatar } = req.body;
    const sharedPool = await getSharedPool();
    
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    
    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }
    if (avatar !== undefined) {
      updates.push(`avatar = $${paramIndex++}`);
      values.push(avatar);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }
    
    values.push(orgId);
    const result = await sharedPool.query(`
      UPDATE organizations 
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${paramIndex}
      RETURNING id, name, slug, type, description, avatar, owner_email, created_at
    `, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update org error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Delete organization (owner only, cannot delete personal workspace)
app.delete('/api/orgs/:orgId', authenticateUser, requireOrgOwner, async (req, res) => {
  try {
    const orgId = req.params.orgId;
    const sharedPool = await getSharedPool();
    
    // Check if it's a personal workspace
    const orgResult = await sharedPool.query(
      'SELECT type FROM organizations WHERE id = $1',
      [orgId]
    );
    
    if (orgResult.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    if (orgResult.rows[0].type === 'personal') {
      return res.status(400).json({ error: 'Cannot delete personal workspace' });
    }
    
    // Delete org (cascade will handle members and invitations)
    await sharedPool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    
    res.json({ success: true, message: 'Organization deleted' });
  } catch (error) {
    console.error('Delete org error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Invite user to organization
app.post('/api/orgs/:orgId/invite', authenticateUser, requireOrgOwner, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = req.params.orgId;
    const { email: inviteeEmail, message } = req.body;
    
    console.log(`[Invite] Request received - orgId: ${orgId}, userEmail: ${userEmail}, body:`, JSON.stringify(req.body));
    
    if (!inviteeEmail) {
      console.log(`[Invite] Missing inviteeEmail in request body`);
      return res.status(400).json({ error: 'Invitee email is required' });
    }
    
    const trimmedEmail = typeof inviteeEmail === 'string' ? inviteeEmail.trim() : String(inviteeEmail).trim();
    if (!trimmedEmail) {
      console.log(`[Invite] Empty inviteeEmail after trimming`);
      return res.status(400).json({ error: 'Invitee email is required' });
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      console.log(`[Invite] Invalid email format: ${trimmedEmail}`);
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    const normalizedInviteeEmail = trimmedEmail.toLowerCase();
    const sharedPool = await getSharedPool();
    
    // Check if user is already a member
    const existingMember = await sharedPool.query(
      'SELECT 1 FROM org_members WHERE org_id = $1 AND user_email = $2',
      [orgId, normalizedInviteeEmail]
    );
    
    if (existingMember.rows.length > 0) {
      console.log(`[Invite] User ${normalizedInviteeEmail} is already a member of org ${orgId}`);
      return res.status(400).json({ error: 'User is already a member of this organization' });
    }
    
    // Check for existing pending invitation - if exists, update it instead of creating new one
    const existingInvite = await sharedPool.query(
      "SELECT id FROM org_invitations WHERE org_id = $1 AND invitee_email = $2 AND status = 'pending'",
      [orgId, normalizedInviteeEmail]
    );
    
    let invitation;
    if (existingInvite.rows.length > 0) {
      // Update existing invitation - reset expiration and update message/token
      console.log(`[Invite] Updating existing invitation for ${normalizedInviteeEmail} to org ${orgId}`);
      const existingInvitationId = existingInvite.rows[0].id;
      const token = crypto.randomBytes(32).toString('hex');
      
      const updateResult = await sharedPool.query(`
        UPDATE org_invitations 
        SET inviter_email = $1, 
            message = $2, 
            token = $3, 
            created_at = NOW(), 
            expires_at = NOW() + INTERVAL '7 days',
            updated_at = NOW()
        WHERE id = $4
        RETURNING id, org_id, invitee_email, inviter_email, status, created_at, expires_at
      `, [userEmail, message || null, token, existingInvitationId]);
      
      invitation = updateResult.rows[0];
    } else {
      // Generate invitation token
      const token = crypto.randomBytes(32).toString('hex');
      
      // Create new invitation
      const result = await sharedPool.query(`
        INSERT INTO org_invitations (org_id, invitee_email, inviter_email, message, token, created_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + INTERVAL '7 days')
        RETURNING id, org_id, invitee_email, inviter_email, status, created_at, expires_at
      `, [orgId, normalizedInviteeEmail, userEmail, message || null, token]);
      
      invitation = result.rows[0];
    }
    
    // Get org name and inviter info for email
    const orgResult = await sharedPool.query('SELECT name FROM organizations WHERE id = $1', [orgId]);
    const orgName = orgResult.rows[0]?.name || 'Unknown Organization';
    
    // Get inviter's name
    const inviterResult = await sharedPool.query(
      'SELECT first_name, last_name FROM users WHERE email = $1',
      [userEmail]
    );
    const inviterData = inviterResult.rows[0] || {};
    const inviterName = inviterData.first_name && inviterData.last_name
      ? `${inviterData.first_name} ${inviterData.last_name}`
      : inviterData.first_name || inviterData.last_name || userEmail.split('@')[0];
    
    // Get invitee's name if they already have an account
    let inviteeName = normalizedInviteeEmail.split('@')[0];
    try {
      const inviteeResult = await sharedPool.query(
        'SELECT first_name, last_name FROM users WHERE email = $1',
        [normalizedInviteeEmail]
      );
      if (inviteeResult.rows.length > 0) {
        const inviteeData = inviteeResult.rows[0];
        if (inviteeData.first_name || inviteeData.last_name) {
          inviteeName = [inviteeData.first_name, inviteeData.last_name].filter(Boolean).join(' ') || inviteeName;
        }
      }
    } catch (err) {
      // If we can't get invitee name, use email prefix
      console.warn('Could not fetch invitee name:', err);
    }
    
    console.log(`✅ Invitation created for ${normalizedInviteeEmail} to join ${orgName}`);
    
    // Send invitation email
    try {
      await sendInvitationEmail(
        secretManagerClient,
        serviceAccount.project_id,
        normalizedInviteeEmail,
        inviteeName,
        inviterName,
        orgName,
        invitation.id,
        message || undefined
      );
      console.log(`✅ Invitation email sent to ${normalizedInviteeEmail}`);
    } catch (emailError: any) {
      console.error(`⚠️ Failed to send invitation email to ${normalizedInviteeEmail}:`, emailError.message);
      // Don't fail the invitation if email fails - invitation is still created
    }
    
    res.status(201).json({
      id: invitation.id,
      inviteeEmail: invitation.invitee_email,
      status: invitation.status,
      createdAt: invitation.created_at,
      expiresAt: invitation.expires_at,
    });
  } catch (error) {
    console.error('Invite to org error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Invite error details:', {
      orgId: req.params.orgId,
      userEmail: (req as any).userEmail,
      body: req.body,
      error: errorMessage
    });
    res.status(500).json({ error: errorMessage });
  }
});

// Get pending invitations for user
app.get('/api/orgs/invitations/pending', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const sharedPool = await getSharedPool();
    
    const result = await sharedPool.query(`
      SELECT 
        i.id,
        i.org_id,
        i.inviter_email,
        i.message,
        i.created_at,
        i.expires_at,
        o.name as org_name,
        o.slug as org_slug,
        o.type as org_type,
        u.first_name as inviter_first_name,
        u.last_name as inviter_last_name
      FROM org_invitations i
      INNER JOIN organizations o ON i.org_id = o.id
      INNER JOIN users u ON i.inviter_email = u.email
      WHERE i.invitee_email = $1 
        AND i.status = 'pending'
        AND i.expires_at > NOW()
      ORDER BY i.created_at DESC
    `, [userEmail]);
    
    res.json(result.rows.map(row => ({
      id: row.id,
      orgId: row.org_id,
      orgName: row.org_name,
      orgSlug: row.org_slug,
      orgType: row.org_type,
      inviterEmail: row.inviter_email,
      inviterName: `${row.inviter_first_name || ''} ${row.inviter_last_name || ''}`.trim(),
      message: row.message,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    })));
  } catch (error) {
    console.error('Get pending invitations error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Accept invitation
app.post('/api/orgs/invitations/:invitationId/accept', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const invitationId = req.params.invitationId;
    const sharedPool = await getSharedPool();
    
    // Get invitation
    const inviteResult = await sharedPool.query(`
      SELECT i.*, o.name as org_name, o.slug as org_slug
      FROM org_invitations i
      INNER JOIN organizations o ON i.org_id = o.id
      WHERE i.id = $1 AND i.invitee_email = $2
    `, [invitationId, userEmail]);
    
    if (inviteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    const invitation = inviteResult.rows[0];
    
    if (invitation.status !== 'pending') {
      return res.status(400).json({ error: `Invitation has already been ${invitation.status}` });
    }
    
    if (new Date(invitation.expires_at) < new Date()) {
      await sharedPool.query(
        "UPDATE org_invitations SET status = 'expired' WHERE id = $1",
        [invitationId]
      );
      return res.status(400).json({ error: 'Invitation has expired' });
    }
    
    // Add user to org
    await sharedPool.query(`
      INSERT INTO org_members (org_id, user_email, role, joined_at)
      VALUES ($1, $2, 'member', NOW())
      ON CONFLICT (org_id, user_email) DO NOTHING
    `, [invitation.org_id, userEmail]);
    
    // Get user info and add to org-level users table
    const userResult = await sharedPool.query(
      'SELECT first_name, last_name, job_title FROM users WHERE email = $1',
      [userEmail]
    );
    const userData = userResult.rows[0] || {};
    
    const orgPool = await getOrgPool(invitation.org_id);
    await orgPool.query(`
      INSERT INTO users (email, first_name, last_name, job_title, role, joined_at)
      VALUES ($1, $2, $3, $4, 'member', NOW())
      ON CONFLICT (email) DO NOTHING
    `, [userEmail, userData.first_name || '', userData.last_name || '', userData.job_title || null]);
    
    // Update invitation status
    await sharedPool.query(`
      UPDATE org_invitations 
      SET status = 'accepted', responded_at = NOW()
      WHERE id = $1
    `, [invitationId]);
    
    console.log(`✅ ${userEmail} accepted invitation to org ${invitation.org_name}`);
    
    res.json({
      success: true,
      orgId: invitation.org_id,
      orgName: invitation.org_name,
      orgSlug: invitation.org_slug,
    });
  } catch (error) {
    console.error('Accept invitation error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Decline invitation
app.post('/api/orgs/invitations/:invitationId/decline', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const invitationId = req.params.invitationId;
    const sharedPool = await getSharedPool();
    
    const result = await sharedPool.query(`
      UPDATE org_invitations 
      SET status = 'declined', responded_at = NOW()
      WHERE id = $1 AND invitee_email = $2 AND status = 'pending'
      RETURNING id
    `, [invitationId, userEmail]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invitation not found or already processed' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Decline invitation error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Remove member from organization
app.delete('/api/orgs/:orgId/members/:memberEmail', authenticateUser, requireOrgOwner, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = req.params.orgId;
    const memberEmail = decodeURIComponent(req.params.memberEmail).toLowerCase();
    const sharedPool = await getSharedPool();
    
    // Cannot remove yourself (owner)
    if (memberEmail === userEmail) {
      return res.status(400).json({ error: 'Cannot remove yourself from the organization. Transfer ownership first.' });
    }
    
    // Remove member
    const result = await sharedPool.query(
      'DELETE FROM org_members WHERE org_id = $1 AND user_email = $2 RETURNING id',
      [orgId, memberEmail]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Leave organization (for non-owners)
app.post('/api/orgs/:orgId/leave', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = req.params.orgId;
    const sharedPool = await getSharedPool();
    
    // Check if user is owner
    const isOwner = await isOrgOwner(orgId, userEmail);
    if (isOwner) {
      return res.status(400).json({ error: 'Owners cannot leave. Transfer ownership or delete the organization.' });
    }
    
    // Remove membership
    await sharedPool.query(
      'DELETE FROM org_members WHERE org_id = $1 AND user_email = $2',
      [orgId, userEmail]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Leave org error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ============================================================================
// TEAM ENDPOINTS (Per-Org DB)
// ============================================================================

app.get('/api/teams', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const pool = await getOrgPool(orgId);
    
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
          'name', tm.user_email
        )) FROM team_members tm
        WHERE tm.team_id = t.id), '[]'::json) as members,
        (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
      FROM teams t
      ORDER BY t.created_at DESC
    `);

    // Collect all member emails for batch user lookup
    const allMemberEmails: string[] = [];
    for (const row of result.rows) {
      if (row.members && Array.isArray(row.members)) {
        for (const member of row.members) {
          if (member.email) allMemberEmails.push(member.email);
        }
      }
      if (row.owner_email) allMemberEmails.push(row.owner_email);
    }

    // Batch fetch user names from shared database
    const userInfo = await getUserInfoBatch(allMemberEmails);

    // Enrich members with user names
    for (const row of result.rows) {
      if (row.members && Array.isArray(row.members)) {
        for (const member of row.members) {
          if (member.email && userInfo.has(member.email)) {
            member.name = userInfo.get(member.email)!.name;
          }
        }
      }
    }
    
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
app.post('/api/teams/:teamName/join-request', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const teamName = req.params.teamName;
    const orgId = (req as any).orgId;
    const pool = await getOrgPool(orgId);
    
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

app.get('/api/teams/join-requests', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const pool = await getOrgPool(orgId);
    
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

app.post('/api/teams/join-requests/:requestId/approve', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const requestId = req.params.requestId;
    const orgId = (req as any).orgId;
    const pool = await getOrgPool(orgId);
    
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

app.post('/api/teams/join-requests/:requestId/reject', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const requestId = req.params.requestId;
    const orgId = (req as any).orgId;
    const pool = await getOrgPool(orgId);
    
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

app.get('/api/teams/invitations', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const pool = await getOrgPool(orgId);
    
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

app.get('/api/teams/:id', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const teamId = req.params.id;
    const orgId = (req as any).orgId;
    const pool = await getOrgPool(orgId);
    
    const result = await pool.query(`
      SELECT 
        t.*,
        COALESCE((SELECT json_agg(json_build_object(
          'email', tm.user_email,
          'role', tm.role,
          'avatar', tm.avatar,
          'name', tm.user_email
        )) FROM team_members tm
        WHERE tm.team_id = t.id), '[]'::json) as members
      FROM teams t
      WHERE t.id = $1
    `, [teamId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    // Collect member emails for batch user lookup
    const row = result.rows[0];
    const memberEmails: string[] = [];
    if (row.members && Array.isArray(row.members)) {
      for (const member of row.members) {
        if (member.email) memberEmails.push(member.email);
      }
    }
    
    // Batch fetch user names from shared database
    const userInfo = await getUserInfoBatch(memberEmails);
    
    // Enrich members with user names
    if (row.members && Array.isArray(row.members)) {
      for (const member of row.members) {
        if (member.email && userInfo.has(member.email)) {
          member.name = userInfo.get(member.email)!.name;
        }
      }
    }
    
    // Transform to camelCase
    const team = transformRow(row);
    team.members = transformMembers(team.members);
    
    res.json(team);
  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/teams', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const { team, teamDetail } = req.body;
    
    // Extract data from team object (frontend sends { team, teamDetail })
    const name = team?.name || teamDetail?.name;
    const description = team?.description || teamDetail?.description;
    const avatar = team?.avatar || teamDetail?.avatar;
    const teamId = team?.id || teamDetail?.id;
    
    if (!name) {
      return res.status(400).json({ error: 'Team name is required' });
    }
    
    const pool = await getOrgPool(orgId);
    
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
app.delete('/api/teams/:name/members/:memberEmail', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const teamName = req.params.name;
    const memberEmail = decodeURIComponent(req.params.memberEmail).toLowerCase();
    const pool = await getOrgPool(orgId);
    
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
app.delete('/api/teams/:name/leave', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const teamName = req.params.name;
    const pool = await getOrgPool(orgId);
    
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

app.delete('/api/teams/:id', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const teamId = req.params.id;
    const pool = await getOrgPool(orgId);
    
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

app.get('/api/projects', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const pool = await getOrgPool(orgId);
    
    const result = await pool.query(`
      SELECT 
        p.*,
        COALESCE((SELECT json_agg(json_build_object(
          'email', pm.user_email,
          'role', pm.role,
          'avatar', pm.avatar,
          'name', pm.user_email
        )) FROM project_members pm
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
      WHERE (
        -- Owner always has access
        p.owner_email = $1
        -- OR visibility is 'all_members' (default - visible to all org members)
        OR (p.visibility = 'all_members' OR p.visibility IS NULL)
        -- OR visibility is 'specific_members' and user is in visible_to_members
        OR (p.visibility = 'specific_members' AND p.visible_to_members IS NOT NULL AND p.visible_to_members @> $2::jsonb)
      )
      ORDER BY p.created_at DESC
    `, [userEmail.toLowerCase(), JSON.stringify([userEmail.toLowerCase()])]);
    
    // Collect all member emails for batch user lookup
    const allMemberEmails: string[] = [];
    for (const row of result.rows) {
      if (row.members && Array.isArray(row.members)) {
        for (const member of row.members) {
          if (member.email) allMemberEmails.push(member.email);
        }
      }
    }
    
    // Batch fetch user names from shared database
    const userInfo = await getUserInfoBatch(allMemberEmails);
    
    // Enrich members with user names
    for (const row of result.rows) {
      if (row.members && Array.isArray(row.members)) {
        for (const member of row.members) {
          if (member.email && userInfo.has(member.email)) {
            member.name = userInfo.get(member.email)!.name;
          }
        }
      }
    }
    
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

app.get('/api/projects/:id', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const projectId = req.params.id;
    const pool = await getOrgPool(orgId);
    
    // Check if user has access to this project (based on visibility rules)
    const hasAccess = await hasProjectAccess(orgId, userEmail, projectId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied: You do not have access to this project based on visibility settings' });
    }
    
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
        p.visibility,
        p.visible_to_members,
        p.created_at,
        p.updated_at,
        COALESCE((SELECT json_agg(json_build_object(
          'email', pm.user_email,
          'role', pm.role,
          'avatar', pm.avatar,
          'name', pm.user_email
        )) FROM project_members pm
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
          'userId', upd.user_id,
          'memberName', upd.user_id,
          'memberAvatar', COALESCE(UPPER(SUBSTRING(upd.user_id, 1, 2)), 'U'),
          'date', upd.date_id,
          'update', upd.update_text,
          'type', 'progress'
        ) ORDER BY upd.timestamp DESC) FROM task_progress_updates upd
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
    
    const row = result.rows[0];
    
    // Collect all emails for batch user lookup
    const allEmails: string[] = [];
    if (row.members && Array.isArray(row.members)) {
      for (const member of row.members) {
        if (member.email) allEmails.push(member.email);
      }
    }
    if (row.progressUpdates && Array.isArray(row.progressUpdates)) {
      for (const update of row.progressUpdates) {
        if (update.userId) allEmails.push(update.userId);
      }
    }
    
    // Batch fetch user names from shared database
    const userInfo = await getUserInfoBatch(allEmails);
    
    // Enrich members with user names
    if (row.members && Array.isArray(row.members)) {
      for (const member of row.members) {
        if (member.email && userInfo.has(member.email)) {
          member.name = userInfo.get(member.email)!.name;
        }
      }
    }
    
    // Enrich progress updates with user names
    if (row.progressUpdates && Array.isArray(row.progressUpdates)) {
      for (const update of row.progressUpdates) {
        if (update.userId && userInfo.has(update.userId)) {
          const user = userInfo.get(update.userId)!;
          update.memberName = user.name;
          update.memberAvatar = user.firstName && user.lastName 
            ? (user.firstName[0] + user.lastName[0]).toUpperCase() 
            : update.memberAvatar;
        }
      }
    }
    
    // Transform to camelCase
    const project = transformRow(row);
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

app.post('/api/projects', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const pool = await getOrgPool(orgId);
    
    // Extract data from project object (frontend sends full Project object)
    const project = req.body;
    const name = project?.name;
    const description = project?.description || '';
    const teamId = project?.teamId || null; // Can be null if project is not tied to a specific team
    const status = project?.status || 'active';
    const priority = project?.priority || 'medium';
    const dueDate = project?.dueDate || null;
    
    // Validate visibility (default to 'all_members' - visible to all org members)
    const validVisibility = ['all_members', 'specific_members'];
    const projectVisibility = project?.visibility && validVisibility.includes(project.visibility) ? project.visibility : 'all_members';
    
    // Validate visibleToMembers for specific_members visibility
    let visibleToMembersArray: string[] = [];
    if (projectVisibility === 'specific_members') {
      if (Array.isArray(project?.visibleToMembers) && project.visibleToMembers.length > 0) {
        visibleToMembersArray = project.visibleToMembers.map((email: string) => email.toLowerCase());
      } else {
        return res.status(400).json({ error: 'visibleToMembers must be a non-empty array when visibility is specific_members' });
      }
    }
    
    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    
    // Normalize email to lowercase
    const normalizedEmail = userEmail.toLowerCase();
    
    // Use provided project ID or generate a new one
    const projectId = project?.id || crypto.randomBytes(16).toString('hex');
    
    // Insert project
    await pool.query(`
      INSERT INTO projects (id, name, description, team_id, status, priority, owner_email, due_date, visibility, visible_to_members, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    `, [projectId, name, description, teamId, status, priority, normalizedEmail, dueDate, projectVisibility, JSON.stringify(visibleToMembersArray)]);
    
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

app.patch('/api/projects/:id', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const projectId = req.params.id;
    const updates = req.body;
    const pool = await getOrgPool(orgId);
    
    // Check if user is trying to update visibility - only owners can do this
    if (updates.visibility !== undefined || updates.visibleToMembers !== undefined) {
      const projectCheck = await pool.query(
        'SELECT owner_email FROM projects WHERE id = $1',
        [projectId]
      );
      
      if (projectCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      const projectOwnerEmail = projectCheck.rows[0].owner_email?.toLowerCase();
      const normalizedUserEmail = userEmail.toLowerCase();
      
      if (projectOwnerEmail !== normalizedUserEmail) {
        return res.status(403).json({ error: 'Only the project owner can update visibility settings' });
      }
    }
    
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
    
    // Handle visibility separately
    if (updates.visibility !== undefined) {
      const validVisibility = ['all_members', 'specific_members'];
      const projectVisibility = validVisibility.includes(updates.visibility) ? updates.visibility : 'all_members';
      setClauses.push(`visibility = $${paramIndex}`);
      values.push(projectVisibility);
      paramIndex++;
      
      // Handle visibleToMembers
      if (projectVisibility === 'specific_members') {
        if (Array.isArray(updates.visibleToMembers) && updates.visibleToMembers.length > 0) {
          const visibleToMembersArray = updates.visibleToMembers.map((email: string) => email.toLowerCase());
          setClauses.push(`visible_to_members = $${paramIndex}`);
          values.push(JSON.stringify(visibleToMembersArray));
          paramIndex++;
        } else {
          return res.status(400).json({ error: 'visibleToMembers must be a non-empty array when visibility is specific_members' });
        }
      } else {
        setClauses.push(`visible_to_members = $${paramIndex}`);
        values.push(JSON.stringify([]));
        paramIndex++;
      }
    }
    
    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'visibility' && key !== 'visibleToMembers' && fieldMap[key]) {
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

app.delete('/api/projects/:id', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const projectId = req.params.id;
    const pool = await getOrgPool(orgId);
    
    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Add project member
app.post('/api/projects/:id/members', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const projectId = req.params.id;
    const { memberEmail, role, avatar } = req.body;
    const pool = await getOrgPool(orgId);
    
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
        pm.avatar
      FROM project_members pm
      WHERE pm.project_id = $1 AND pm.user_email = $2
    `, [projectId, normalizedMemberEmail]);
    
    const member = memberResult.rows[0];
    
    // Fetch user name from shared database
    const userInfo = await getUserInfoBatch([member.email]);
    const userName = userInfo.has(member.email) ? userInfo.get(member.email)!.name : member.email;
    
    res.json({
      success: true,
      member: {
        id: member.email,
        email: member.email,
        name: userName,
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
app.delete('/api/projects/:id/members/:memberEmail', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const projectId = req.params.id;
    const memberEmail = req.params.memberEmail.toLowerCase();
    const pool = await getOrgPool(orgId);
    
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
// DOCS ENDPOINTS (PostgreSQL)
// ============================================================================

app.get('/api/docs', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const pool = await getOrgPool(orgId);
    const normalizedEmail = userEmail.toLowerCase();
    
    // Filter docs based on visibility:
    // - 'all_members': visible to all org members (default)
    // - 'specific_members': visible to owner and members in visible_to_members array (limited visibility)
    const result = await pool.query(`
      SELECT 
        id,
        title,
        content,
        owner_email,
        project_id,
        team_id,
        tags,
        is_pinned,
        visibility,
        visible_to_members,
        created_at,
        updated_at
      FROM docs
      WHERE 
        visibility = 'all_members'
        OR owner_email = $1
        OR (visibility = 'specific_members' AND visible_to_members IS NOT NULL AND visible_to_members @> $2::jsonb)
      ORDER BY is_pinned DESC, created_at DESC
    `, [normalizedEmail, JSON.stringify([normalizedEmail])]);
    
    console.log(`📚 GET /api/docs - Returning ${result.rows.length} docs for org ${orgId} (user: ${userEmail})`);
    
    // Transform to camelCase
    const transformed = result.rows.map(row => {
      const doc = transformRow(row);
      doc.tags = Array.isArray(doc.tags) ? doc.tags : (doc.tags ? JSON.parse(doc.tags) : []);
      doc.visibleToMembers = Array.isArray(doc.visibleToMembers) 
        ? doc.visibleToMembers 
        : (doc.visibleToMembers ? JSON.parse(doc.visibleToMembers) : []);
      doc.createdAt = doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString();
      doc.updatedAt = doc.updatedAt ? new Date(doc.updatedAt).toISOString() : new Date().toISOString();
      return doc;
    });
    
    res.json(transformed);
  } catch (error) {
    console.error('Get docs error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/docs/:id', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const docId = req.params.id;
    const pool = await getOrgPool(orgId);
    const normalizedEmail = userEmail.toLowerCase();
    
    // Get doc and check visibility
    const result = await pool.query(`
      SELECT 
        id,
        title,
        content,
        owner_email,
        project_id,
        team_id,
        tags,
        is_pinned,
        visibility,
        visible_to_members,
        created_at,
        updated_at
      FROM docs
      WHERE id = $1
    `, [docId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Doc not found' });
    }
    
    const row = result.rows[0];
    const docVisibility = row.visibility || 'all_members';
    
    // Check if user has access
    const isOwner = row.owner_email.toLowerCase() === normalizedEmail;
    const isAllMembers = docVisibility === 'all_members';
    const isSpecificMembers = docVisibility === 'specific_members';
    
    let hasAccess = isOwner || isAllMembers;
    
    if (isSpecificMembers) {
      const visibleToMembers = Array.isArray(row.visible_to_members) 
        ? row.visible_to_members 
        : (row.visible_to_members ? JSON.parse(row.visible_to_members) : []);
      hasAccess = isOwner || visibleToMembers.includes(normalizedEmail);
    }
    
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this document' });
    }
    
    const doc = transformRow(row);
    doc.tags = Array.isArray(doc.tags) ? doc.tags : (doc.tags ? JSON.parse(doc.tags) : []);
    doc.visibleToMembers = Array.isArray(doc.visibleToMembers) 
      ? doc.visibleToMembers 
      : (doc.visibleToMembers ? JSON.parse(doc.visibleToMembers) : []);
    doc.createdAt = doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString();
    doc.updatedAt = doc.updatedAt ? new Date(doc.updatedAt).toISOString() : new Date().toISOString();
    
    res.json(doc);
  } catch (error) {
    console.error('Get doc error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/docs', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const pool = await getOrgPool(orgId);
    
    const { id, title, content, projectId, teamId, tags, isPinned, visibility, visibleToMembers } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }
    
    // Validate visibility (default to 'all_members' - visible to all org members)
    const validVisibility = ['all_members', 'specific_members'];
    const docVisibility = visibility && validVisibility.includes(visibility) ? visibility : 'all_members';
    
    // Validate visibleToMembers for specific_members visibility
    let visibleToMembersArray: string[] = [];
    if (docVisibility === 'specific_members') {
      if (!Array.isArray(visibleToMembers) || visibleToMembers.length === 0) {
        return res.status(400).json({ error: 'visibleToMembers must be a non-empty array when visibility is specific_members' });
      }
      visibleToMembersArray = visibleToMembers.map((email: string) => email.toLowerCase());
    }
    
    const normalizedEmail = userEmail.toLowerCase();
    const docId = id || crypto.randomBytes(16).toString('hex');
    
    await pool.query(`
      INSERT INTO docs (id, title, content, owner_email, project_id, team_id, tags, is_pinned, visibility, visible_to_members, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    `, [
      docId,
      title,
      content,
      normalizedEmail,
      projectId || null,
      teamId || null,
      tags ? JSON.stringify(tags) : '[]',
      isPinned || false,
      docVisibility,
      JSON.stringify(visibleToMembersArray)
    ]);
    
    res.status(201).json({ 
      id: docId, 
      title, 
      content,
      ownerEmail: normalizedEmail,
      projectId: projectId || null,
      teamId: teamId || null,
      tags: tags || [],
      isPinned: isPinned || false,
      visibility: docVisibility,
      visibleToMembers: visibleToMembersArray
    });
  } catch (error) {
    console.error('Create doc error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.patch('/api/docs/:id', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const docId = req.params.id;
    const updates = req.body;
    const pool = await getOrgPool(orgId);
    const normalizedEmail = userEmail.toLowerCase();
    
    // Verify doc exists and user has access to edit
    const checkResult = await pool.query(
      'SELECT id, owner_email FROM docs WHERE id = $1',
      [docId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Doc not found' });
    }
    
    // Only owner can edit docs
    const isOwner = checkResult.rows[0].owner_email.toLowerCase() === normalizedEmail;
    if (!isOwner) {
      return res.status(403).json({ error: 'Only the document owner can edit it' });
    }
    
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    
    const fieldMap: { [key: string]: string } = {
      title: 'title',
      content: 'content',
      projectId: 'project_id',
      teamId: 'team_id',
      isPinned: 'is_pinned',
      visibility: 'visibility'
    };
    
    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'id' && fieldMap[key]) {
        const dbField = fieldMap[key];
        // Validate visibility value
        if (key === 'visibility') {
          const validVisibility = ['private', 'specific_members', 'all_members'];
          if (!validVisibility.includes(value as string)) {
            return; // Skip invalid visibility
          }
        }
        setClauses.push(`${dbField} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      } else if (key === 'tags' && Array.isArray(value)) {
        setClauses.push(`tags = $${paramIndex}::jsonb`);
        values.push(JSON.stringify(value));
        paramIndex++;
      } else if (key === 'visibleToMembers' && Array.isArray(value)) {
        setClauses.push(`visible_to_members = $${paramIndex}::jsonb`);
        values.push(JSON.stringify(value.map((email: string) => email.toLowerCase())));
        paramIndex++;
      }
    });
    
    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    setClauses.push(`updated_at = NOW()`);
    values.push(docId);
    
    await pool.query(`
      UPDATE docs 
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
    `, values);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Update doc error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/api/docs/:id', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const docId = req.params.id;
    const pool = await getOrgPool(orgId);
    
    // Verify doc exists (all org members can delete docs)
    const checkResult = await pool.query(
      'SELECT id FROM docs WHERE id = $1',
      [docId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Doc not found' });
    }
    
    await pool.query('DELETE FROM docs WHERE id = $1', [docId]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete doc error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ============================================================================
// TASK ENDPOINTS (PostgreSQL)
// ============================================================================

app.get('/api/tasks', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const pool = await getOrgPool(orgId);
    
    const result = await pool.query(`
      SELECT 
        t.id,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.assignee_id,
        t.assignee_name,
        t.assignee_avatar,
        t.project_id,
        COALESCE(t.project_name, p.name) as project_name,
        t.created_by,
        t.visibility,
        t.visible_to_members,
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
            'userId', upd.user_id,
            'memberName', upd.user_id,
            'memberAvatar', COALESCE(UPPER(SUBSTRING(upd.user_id, 1, 2)), 'U'),
            'date', CASE WHEN upd.date_id IS NOT NULL THEN upd.date_id::text ELSE NULL END,
            'update', upd.update_text,
            'type', 'progress'
          ) as update_data
          FROM task_progress_updates upd
          WHERE upd.associated_tasks @> jsonb_build_array(t.id)
          ORDER BY upd.timestamp DESC
          LIMIT 1
        ) latest_update) as progressUpdates
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE (
        -- Tasks with projects: project visibility determines task visibility
        (t.project_id IS NOT NULL AND (
          -- Project owner always has access
          p.owner_email = $1
          -- OR project visibility is 'all_members' (default - all org members can see)
          OR (p.visibility = 'all_members' OR p.visibility IS NULL)
          -- OR project visibility is 'specific_members' and user is in visible_to_members
          OR (p.visibility = 'specific_members' AND p.visible_to_members IS NOT NULL AND p.visible_to_members @> $2::jsonb)
        ))
        -- OR tasks without projects: check task visibility
        OR (t.project_id IS NULL AND (
          -- Creator or assignee always has access
          (t.created_by = $1 OR t.assignee_id = $1)
          -- OR task visibility is 'all_members' (default - visible to all org members)
          OR (t.visibility = 'all_members' OR t.visibility IS NULL)
          -- OR task visibility is 'specific_members' and user is in visible_to_members
          OR (t.visibility = 'specific_members' AND t.visible_to_members IS NOT NULL AND t.visible_to_members @> $2::jsonb)
        ))
      )
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
    `, [userEmail.toLowerCase(), JSON.stringify([userEmail.toLowerCase()])]);
    
    // Collect all user emails for batch lookup
    const allEmails: string[] = [];
    for (const row of result.rows) {
      if (row.assignee_id) allEmails.push(row.assignee_id);
      if (row.progressUpdates && Array.isArray(row.progressUpdates)) {
        for (const update of row.progressUpdates) {
          if (update.userId) allEmails.push(update.userId);
        }
      }
    }
    
    // Batch fetch user names from shared database
    const userInfo = await getUserInfoBatch(allEmails);
    
    // Enrich results with user names
    for (const row of result.rows) {
      if (row.assignee_id && userInfo.has(row.assignee_id)) {
        const user = userInfo.get(row.assignee_id)!;
        if (!row.assignee_name) row.assignee_name = user.name;
        if (!row.assignee_avatar && user.firstName && user.lastName) {
          row.assignee_avatar = (user.firstName[0] + user.lastName[0]).toUpperCase();
        }
      }
      if (row.progressUpdates && Array.isArray(row.progressUpdates)) {
        for (const update of row.progressUpdates) {
          if (update.userId && userInfo.has(update.userId)) {
            const user = userInfo.get(update.userId)!;
            update.memberName = user.name;
            if (user.firstName && user.lastName) {
              update.memberAvatar = (user.firstName[0] + user.lastName[0]).toUpperCase();
            }
          }
        }
      }
    }
    
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

app.get('/api/tasks/project/:projectId', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const projectId = req.params.projectId;
    const pool = await getOrgPool(orgId);
    
    // Check if user has access to this project (based on visibility rules)
    const hasAccess = await hasProjectAccess(orgId, userEmail, projectId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied: You do not have access to this project based on visibility settings' });
    }
    
    const result = await pool.query(`
      SELECT 
        t.id,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.assignee_id,
        t.assignee_name,
        t.assignee_avatar,
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
    
    // Collect all assignee emails for batch lookup
    const assigneeEmails: string[] = [];
    for (const row of result.rows) {
      if (row.assignee_id) assigneeEmails.push(row.assignee_id);
    }
    
    // Batch fetch user names from shared database
    const userInfo = await getUserInfoBatch(assigneeEmails);
    
    // Enrich results with user names
    for (const row of result.rows) {
      if (row.assignee_id && userInfo.has(row.assignee_id)) {
        const user = userInfo.get(row.assignee_id)!;
        if (!row.assignee_name) row.assignee_name = user.name;
        if (!row.assignee_avatar && user.firstName && user.lastName) {
          row.assignee_avatar = (user.firstName[0] + user.lastName[0]).toUpperCase();
        }
      }
    }
    
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

app.get('/api/tasks/:id', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const taskId = req.params.id;
    const pool = await getOrgPool(orgId);
    
    // First, get the task to check its project_id
    const taskCheck = await pool.query(`
      SELECT project_id, assignee_id, created_by
      FROM tasks
      WHERE id = $1
    `, [taskId]);
    
    if (taskCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const taskInfo = taskCheck.rows[0];
    
    // If task has a project, check if user has access to that project (project visibility determines task visibility)
    if (taskInfo.project_id) {
      const hasAccess = await hasProjectAccess(orgId, userEmail, taskInfo.project_id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied: You must have access to the project to view this task' });
      }
    } else {
      // If task has no project, check task visibility
      const userEmailLower = userEmail.toLowerCase();
      const isCreator = taskInfo.created_by && taskInfo.created_by.toLowerCase() === userEmailLower;
      const isAssignee = taskInfo.assignee_id && taskInfo.assignee_id.toLowerCase() === userEmailLower;
      const taskVisibility = taskInfo.visibility || 'all_members';
      
      // Creator or assignee always has access
      if (isCreator || isAssignee) {
        // Allow access
      } else if (taskVisibility === 'all_members') {
        // All org members have access
        // Allow access
      } else if (taskVisibility === 'specific_members') {
        // Check if user is in visible_to_members
        const visibleToMembers = Array.isArray(taskInfo.visible_to_members) 
          ? taskInfo.visible_to_members 
          : (taskInfo.visible_to_members ? JSON.parse(taskInfo.visible_to_members) : []);
        const hasAccess = visibleToMembers.some((email: string) => email.toLowerCase() === userEmailLower);
        if (!hasAccess) {
          return res.status(403).json({ error: 'Access denied: This task is only visible to specific members' });
        }
      } else {
        // Default: only creator and assignee
        return res.status(403).json({ error: 'Access denied: You must be the creator or assignee to view this task' });
      }
    }
    
    const result = await pool.query(`
      SELECT 
        t.id,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.assignee_id,
        t.assignee_name,
        t.assignee_avatar,
        t.project_id,
        COALESCE(t.project_name, p.name) as project_name,
        t.created_by,
        t.visibility,
        t.visible_to_members,
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
          'userId', upd.user_id,
          'memberName', upd.user_id,
          'memberAvatar', COALESCE(UPPER(SUBSTRING(upd.user_id, 1, 2)), 'U'),
          'date', CASE WHEN upd.date_id IS NOT NULL THEN upd.date_id::text ELSE NULL END,
          'update', upd.update_text,
          'type', 'progress'
        ) ORDER BY upd.timestamp DESC) FROM task_progress_updates upd
        WHERE upd.associated_tasks @> $2::jsonb), '[]'::json) as progressUpdates
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.id = $1
    `, [taskId, JSON.stringify([taskId])]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const row = result.rows[0];
    
    // Collect all emails for batch user lookup
    const allEmails: string[] = [];
    if (row.assignee_id) allEmails.push(row.assignee_id);
    if (row.progressupdates && Array.isArray(row.progressupdates)) {
      for (const update of row.progressupdates) {
        if (update.userId) allEmails.push(update.userId);
      }
    }
    
    // Batch fetch user names from shared database
    const userInfo = await getUserInfoBatch(allEmails);
    
    // Enrich results with user names
    if (row.assignee_id && userInfo.has(row.assignee_id)) {
      const user = userInfo.get(row.assignee_id)!;
      if (!row.assignee_name) row.assignee_name = user.name;
      if (!row.assignee_avatar && user.firstName && user.lastName) {
        row.assignee_avatar = (user.firstName[0] + user.lastName[0]).toUpperCase();
      }
    }
    if (row.progressupdates && Array.isArray(row.progressupdates)) {
      for (const update of row.progressupdates) {
        if (update.userId && userInfo.has(update.userId)) {
          const user = userInfo.get(update.userId)!;
          update.memberName = user.name;
          if (user.firstName && user.lastName) {
            update.memberAvatar = (user.firstName[0] + user.lastName[0]).toUpperCase();
          }
        }
      }
    }
    
    // Transform to camelCase
    const task = transformRow(row);
    
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
    
    // Ensure createdBy is set (transformRow should handle this, but be explicit)
    if (!task.createdBy && row.created_by) {
      task.createdBy = row.created_by;
    }
    
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

app.post('/api/tasks', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const { title, description, projectId, projectName, assigneeId, assignee, assigneeAvatar, status, priority, dueDate, tags, reason, estimatedHours, visibility, visibleToMembers } = req.body;
    
    // Validate visibility (default to 'all_members' - visible to all org members)
    const validVisibility = ['all_members', 'specific_members'];
    const taskVisibility = visibility && validVisibility.includes(visibility) ? visibility : 'all_members';
    
    // Validate visibleToMembers for specific_members visibility
    let visibleToMembersArray: string[] = [];
    if (taskVisibility === 'specific_members') {
      if (Array.isArray(visibleToMembers) && visibleToMembers.length > 0) {
        visibleToMembersArray = visibleToMembers.map((email: string) => email.toLowerCase());
      } else {
        return res.status(400).json({ error: 'visibleToMembers must be a non-empty array when visibility is specific_members' });
      }
    }
    const pool = await getOrgPool(orgId);
    
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
        priority, due_date, created_by, created_at, tags, reason, estimated_hours, visibility, visible_to_members
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
      estimatedHours || null,
      taskVisibility,
      JSON.stringify(visibleToMembersArray)
    ]);
    
    res.status(201).json({ id: taskId, title, description, projectId, assigneeId, status, priority });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.put('/api/tasks/:id', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const taskId = req.params.id;
    const updates = req.body;
    const pool = await getOrgPool(orgId);
    
    // Check if user is trying to update visibility - only creators can do this
    if (updates.visibility !== undefined || updates.visibleToMembers !== undefined) {
      const taskCheck = await pool.query(
        'SELECT created_by FROM tasks WHERE id = $1',
        [taskId]
      );
      
      if (taskCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Task not found' });
      }
      
      const taskCreatorEmail = taskCheck.rows[0].created_by?.toLowerCase();
      const normalizedUserEmail = userEmail.toLowerCase();
      
      if (taskCreatorEmail !== normalizedUserEmail) {
        return res.status(403).json({ error: 'Only the task creator can update visibility settings' });
      }
    }
    
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
    
    // Handle visibility separately
    if (updates.visibility !== undefined) {
      const validVisibility = ['all_members', 'specific_members'];
      const taskVisibility = validVisibility.includes(updates.visibility) ? updates.visibility : 'all_members';
      setClauses.push(`visibility = $${paramIndex}`);
      values.push(taskVisibility);
      paramIndex++;
      
      // Handle visibleToMembers
      if (taskVisibility === 'specific_members') {
        if (Array.isArray(updates.visibleToMembers) && updates.visibleToMembers.length > 0) {
          const visibleToMembersArray = updates.visibleToMembers.map((email: string) => email.toLowerCase());
          setClauses.push(`visible_to_members = $${paramIndex}`);
          values.push(JSON.stringify(visibleToMembersArray));
          paramIndex++;
        } else {
          return res.status(400).json({ error: 'visibleToMembers must be a non-empty array when visibility is specific_members' });
        }
      } else {
        setClauses.push(`visible_to_members = $${paramIndex}`);
        values.push(JSON.stringify([]));
        paramIndex++;
      }
    }
    
    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'visibility' && key !== 'visibleToMembers' && fieldMap[key]) {
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

app.patch('/api/tasks/:id', authenticateUser, requireOrgMembership, async (req, res) => {
  // PATCH uses same logic as PUT
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const taskId = req.params.id;
    const updates = req.body;
    const pool = await getOrgPool(orgId);
    
    // Check if user is trying to update visibility - only creators can do this
    if (updates.visibility !== undefined || updates.visibleToMembers !== undefined) {
      const taskCheck = await pool.query(
        'SELECT created_by FROM tasks WHERE id = $1',
        [taskId]
      );
      
      if (taskCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Task not found' });
      }
      
      const taskCreatorEmail = taskCheck.rows[0].created_by?.toLowerCase();
      const normalizedUserEmail = userEmail.toLowerCase();
      
      if (taskCreatorEmail !== normalizedUserEmail) {
        return res.status(403).json({ error: 'Only the task creator can update visibility settings' });
      }
    }
    
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
    
    // Handle visibility separately (same as PUT endpoint)
    if (updates.visibility !== undefined) {
      const validVisibility = ['all_members', 'specific_members'];
      const taskVisibility = validVisibility.includes(updates.visibility) ? updates.visibility : 'all_members';
      setClauses.push(`visibility = $${paramIndex}`);
      values.push(taskVisibility);
      paramIndex++;
      
      // Handle visibleToMembers
      if (taskVisibility === 'specific_members') {
        if (Array.isArray(updates.visibleToMembers) && updates.visibleToMembers.length > 0) {
          const visibleToMembersArray = updates.visibleToMembers.map((email: string) => email.toLowerCase());
          setClauses.push(`visible_to_members = $${paramIndex}`);
          values.push(JSON.stringify(visibleToMembersArray));
          paramIndex++;
        } else {
          return res.status(400).json({ error: 'visibleToMembers must be a non-empty array when visibility is specific_members' });
        }
      } else {
        setClauses.push(`visible_to_members = $${paramIndex}`);
        values.push(JSON.stringify([]));
        paramIndex++;
      }
    }
    
    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'visibility' && key !== 'visibleToMembers' && fieldMap[key]) {
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

app.delete('/api/tasks/:id', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const taskId = req.params.id;
    const pool = await getOrgPool(orgId);
    
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
    const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
    const collectionPath = await getOrgCollectionPath('messages', orgId);
    
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
      const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
      const userEmail = (req as any).user?.email?.toLowerCase() || (req as any).userEmail?.toLowerCase();
      const chatId = decodeURIComponent(req.params.chatId);
      const afterTimestamp = req.query.afterTimestamp ? new Date(req.query.afterTimestamp as string) : undefined;
      const collectionPath = await getOrgCollectionPath('messages', orgId);
    
    // For AI assistant conversations, ensure privacy by filtering by userId
    // This provides an additional security layer even if chatId is somehow compromised
    if (chatId.startsWith('ai-assistant-')) {
      if (userEmail && !chatId.endsWith(`-${userEmail}`)) {
        // User is trying to access another user's AI conversation - deny access
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    
    let docs: any[] = [];
    
    // Extract projectId or teamId for filtering
    let projectId: string | null = null;
    let teamId: string | null = null;
    if (chatId.startsWith('project-')) {
      projectId = chatId.replace('project-', '');
    } else if (chatId.startsWith('team-')) {
      teamId = chatId.replace('team-', '');
    }
    
    try {
      // Query by chatId (may need Firestore index)
      let query = db.collection(collectionPath)
        .where('chatId', '==', chatId);
      
      // For AI assistant conversations, also filter by userId for privacy
      if (chatId.startsWith('ai-assistant-') && userEmail) {
        query = query.where('userId', '==', userEmail);
      }
      
      // For project channels, also filter by projectId to ensure we only get messages for this project
      if (projectId) {
        query = query.where('projectId', '==', projectId);
      }
      
      // For team channels, also filter by teamId to ensure we only get messages for this team
      if (teamId) {
        query = query.where('teamId', '==', teamId);
      }
      
      query = query.limit(100);
      
      const snapshot = await query.get();
      docs = Array.from(snapshot.docs);
      
    } catch (queryError: any) {
      // If query fails (e.g., missing index), fetch all and filter in memory
      if (queryError.code === 9 || queryError.message?.includes('index')) {
        console.warn('ChatId index missing, fetching all messages and filtering:', queryError.message);
        const snapshot = await db.collection(collectionPath)
          .limit(500) // Get more to filter
          .get();
        
        // Filter by chatId in memory (and userId for AI assistant conversations, projectId/teamId for channels)
        docs = Array.from(snapshot.docs).filter(doc => {
          const data = doc.data();
          const matchesChatId = data.chatId === chatId || (!data.chatId && chatId === 'general');
          
          // For AI assistant conversations, also check userId
          if (chatId.startsWith('ai-assistant-') && userEmail) {
            return matchesChatId && data.userId?.toLowerCase() === userEmail;
          }
          
          // For project channels, also check projectId
          if (projectId) {
            return matchesChatId && data.projectId === projectId;
          }
          
          // For team channels, also check teamId
          if (teamId) {
            return matchesChatId && data.teamId === teamId;
          }
          
          return matchesChatId;
        });
      } else {
        throw queryError;
      }
    }
    
    // Sort by timestamp in memory (ascending - oldest first)
    docs.sort((a, b) => {
      const aTime = a.data().timestamp?.toDate?.()?.getTime() || 
                    (typeof a.data().timestamp === 'number' ? a.data().timestamp : 0);
      const bTime = b.data().timestamp?.toDate?.()?.getTime() || 
                    (typeof b.data().timestamp === 'number' ? b.data().timestamp : 0);
      return aTime - bTime; // Ascending order (oldest first)
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
      const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
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
      const collectionPath = await getOrgCollectionPath('messages', orgId);
    
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
    const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
    const userEmail = (req as any).user?.email?.toLowerCase() || (req as any).userEmail?.toLowerCase();
    const messageId = req.params.messageId;
    
    if (!userEmail) {
      return res.status(401).json({ error: 'User email not found' });
    }
    
    const collectionPath = await getOrgCollectionPath('messages', orgId);
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
  } catch (error: any) {
    console.error('❌ Failed to fetch Firebase config from Secret Manager:', error);
    
    // Fallback to environment variables or construct from service account
    console.warn('⚠️ Attempting fallback: using service account project ID to construct Firebase config');
    const projectId = serviceAccount.project_id;
    
    // Try to get from environment variables first
    const envApiKey = process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY;
    if (envApiKey && envApiKey.startsWith('AIza')) {
      console.log('✅ Using Firebase config from environment variables');
      const fallbackConfig = {
        apiKey: envApiKey,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
        projectId: projectId,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '123456789',
        appId: process.env.FIREBASE_APP_ID || `1:123456789:web:${projectId}`,
      };
      cachedFirebaseConfig = fallbackConfig;
      firebaseConfigCacheTime = Date.now();
      return fallbackConfig;
    }
    
    // Last resort: construct minimal config (may not work for all features)
    console.warn('⚠️ Using minimal Firebase config - some features may not work');
    const minimalConfig = {
      apiKey: 'AIzaSyDummyKeyForDevelopmentOnly',
      authDomain: `${projectId}.firebaseapp.com`,
      projectId: projectId,
      storageBucket: `${projectId}.appspot.com`,
      messagingSenderId: '123456789',
      appId: `1:123456789:web:${projectId}`,
    };
    cachedFirebaseConfig = minimalConfig;
    firebaseConfigCacheTime = Date.now();
    return minimalConfig;
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
    const orgId = req.headers['x-org-id'] as string | undefined;
    
    // Determine the external AI service URL
    const isLocalDev = process.env.NODE_ENV !== 'production';
    const aiServiceBase = isLocalDev 
      ? process.env.AI_SERVICE_URL || 'http://0.0.0.0:8081'
      : process.env.AI_SERVICE_URL || 'http://ask-api:80';
    
    const aiServiceUrl = `${aiServiceBase}/api/generate-task`;
    
    // Prepare headers for the AI service request
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // Use Bearer token for production, API key for local testing
    if (isLocalDev) {
      // Local testing: use API key
      try {
        const apiKey = await getApiKeyFromSecretManager();
        headers['X-API-Key'] = apiKey;
      } catch (error) {
        console.error('Failed to get API key, request may fail:', error);
        // Continue anyway - the AI service might handle auth differently
      }
    } else {
      // Production (GKE): use Bearer token
      // Get the Bearer token from the incoming request
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        headers['Authorization'] = authHeader;
      } else {
        // Fallback to API key if Bearer token not available
        console.warn(`⚠️ No Bearer token in request, falling back to API key for ${userEmail}`);
        try {
          const apiKey = await getApiKeyFromSecretManager();
          headers['X-API-Key'] = apiKey;
        } catch (error) {
          console.error('Failed to get API key, request may fail:', error);
        }
      }
    }
    
    // Ensure user_id is set
    if (!requestBody.user_id) {
      requestBody.user_id = userEmail.toLowerCase();
    }
    
    // Ensure org_slug is set from org context if not provided
    if (!requestBody.org_slug && orgId) {
      try {
        const orgSlug = await getOrgSlugById(orgId);
        requestBody.org_slug = orgSlug;
      } catch (error) {
        console.error('Failed to get org slug for generate-task:', error);
      }
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

setupIntegrationEndpoints(app, authenticateUser, secretManagerClient, serviceAccount, db, requireOrgOwner);

// ============================================================================
// CALL ENDPOINTS (Firestore - Optional, can also use Firestore directly)
// ============================================================================

setupCallEndpoints(app, authenticateUser, db, secretManagerClient, serviceAccount.project_id);
setupImageEndpoints(app, authenticateUser, storage, firebaseApp);

// ============================================================================
// TURN SERVER ENDPOINTS (Twilio TURN credentials)
// ============================================================================

setupTurnEndpoints(app, authenticateUser, secretManagerClient, serviceAccount.project_id);

// ============================================================================
// LIVEKIT ENDPOINTS (LiveKit SFU token generation)
// ============================================================================

setupLiveKitEndpoints(app, authenticateUser, db, secretManagerClient, serviceAccount.project_id);

// ============================================================================
// UPDATE SUMMARIES ENDPOINTS (PostgreSQL)
// ============================================================================

app.get('/api/update-summaries', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const projectId = req.query.projectId as string | undefined;
    const pool = await getOrgPool(orgId);
    
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
app.get('/api/updates/task/:taskId', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const taskId = req.params.taskId;
    const pool = await getOrgPool(orgId);
    
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
        upd.timestamp
      FROM task_progress_updates upd
      WHERE upd.associated_tasks @> $1::jsonb
      ORDER BY upd.timestamp DESC
    `, [JSON.stringify([taskId])]);
    
    // Collect all user emails for batch lookup
    const userEmails: string[] = [];
    for (const row of result.rows) {
      if (row.user_id) userEmails.push(row.user_id);
    }
    
    // Batch fetch user names from shared database
    const userInfo = await getUserInfoBatch(userEmails);
    
    // Transform to the format expected by frontend
    // Note: PostgreSQL returns unquoted column names in lowercase
    const updates = result.rows.map(row => {
      const user = row.user_id && userInfo.has(row.user_id) ? userInfo.get(row.user_id)! : null;
      return {
        updateId: row.update_id,
        associatedTasks: row.associated_tasks,
        dateId: row.date_id || '',
        projectId: row.project_id || '',
        reason: row.reason || '',
        timestamp: row.timestamp ? (typeof row.timestamp === 'string' ? row.timestamp : new Date(row.timestamp).toISOString()) : '',
        update: row.update || '',
        userId: row.user_id || '',
        memberName: user ? user.name : row.user_id || '',
        memberAvatar: user && user.firstName && user.lastName 
          ? (user.firstName[0] + user.lastName[0]).toUpperCase() 
          : (row.user_id ? row.user_id.substring(0, 2).toUpperCase() : 'U'),
      };
    });
    
    res.json(updates);
  } catch (error) {
    console.error('Get updates by task error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ============================================================================
// SUBSCRIPTION ENDPOINTS (Stripe Integration)
// ============================================================================

// Get subscription status
app.get('/api/subscription/status', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const sharedPool = await getSharedPool();
    
    const result = await sharedPool.query(`
      SELECT 
        subscription_plan,
        stripe_customer_id,
        stripe_subscription_id,
        ai_daily_usage,
        ai_usage_reset_date,
        trial_ends_at,
        created_at
      FROM users WHERE email = $1
    `, [userEmail]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    const today = new Date().toISOString().split('T')[0];
    
    // Reset daily usage if it's a new day
    let aiDailyUsage = user.ai_daily_usage || 0;
    if (user.ai_usage_reset_date !== today) {
      aiDailyUsage = 0;
      await sharedPool.query(`
        UPDATE users SET ai_daily_usage = 0, ai_usage_reset_date = $1 WHERE email = $2
      `, [today, userEmail]);
    }
    
    // Calculate trial status
    const trialEndsAt = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
    const isTrialActive = trialEndsAt && trialEndsAt > new Date();
    const trialDaysRemaining = trialEndsAt 
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : 0;
    
    // HARD CODED: Everyone is on standard tier
    const plan = 'standard';
    
    // Calculate AI usage limits based on plan (standard = 20 per day)
    const aiUsageLimit: number = 20; // 20 per day for standard plan
    
    res.json({
      plan,
      stripeCustomerId: user.stripe_customer_id,
      stripeSubscriptionId: user.stripe_subscription_id,
      aiDailyUsage,
      aiUsageLimit,
      aiUsageRemaining: Math.max(0, aiUsageLimit - aiDailyUsage),
      trialEndsAt: user.trial_ends_at,
      isTrialActive,
      trialDaysRemaining,
      memberSince: user.created_at,
    });
  } catch (error) {
    console.error('Get subscription status error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Create Stripe checkout session
app.post('/api/subscription/checkout', authenticateUser, async (req, res) => {
  try {
    const stripeClient = await getStripe();
    if (!stripeClient) {
      return res.status(503).json({ error: 'Payment system not configured' });
    }
    
    const userEmail = (req as any).userEmail;
    const { plan, successUrl, cancelUrl } = req.body;
    
    if (!plan || !['standard', 'pro'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan. Must be "standard" or "pro"' });
    }
    
    const priceId = STRIPE_PRICE_IDS[plan as keyof typeof STRIPE_PRICE_IDS];
    if (!priceId) {
      return res.status(400).json({ error: `Price ID not configured for ${plan} plan` });
    }
    
    const sharedPool = await getSharedPool();
    
    // Get or create Stripe customer
    let customerId: string;
    const userResult = await sharedPool.query(
      'SELECT stripe_customer_id, first_name, last_name FROM users WHERE email = $1',
      [userEmail]
    );
    
    if (userResult.rows[0]?.stripe_customer_id) {
      customerId = userResult.rows[0].stripe_customer_id;
    } else {
      const customer = await stripeClient.customers.create({
        email: userEmail,
        name: `${userResult.rows[0]?.first_name || ''} ${userResult.rows[0]?.last_name || ''}`.trim() || undefined,
        metadata: { userEmail },
      });
      customerId = customer.id;
      
      // Save customer ID
      await sharedPool.query(
        'UPDATE users SET stripe_customer_id = $1 WHERE email = $2',
        [customerId, userEmail]
      );
    }
    
    // Create checkout session
    const session = await stripeClient.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl || `${req.headers.origin}/subscription?success=true`,
      cancel_url: cancelUrl || `${req.headers.origin}/subscription?canceled=true`,
      metadata: { userEmail, plan },
    });
    
    res.json({ url: session.url });
  } catch (error) {
    console.error('Create checkout session error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Create Stripe customer portal session
app.post('/api/subscription/portal', authenticateUser, async (req, res) => {
  try {
    const stripeClient = await getStripe();
    if (!stripeClient) {
      return res.status(503).json({ error: 'Payment system not configured' });
    }
    
    const userEmail = (req as any).userEmail;
    const { returnUrl } = req.body;
    
    const sharedPool = await getSharedPool();
    const userResult = await sharedPool.query(
      'SELECT stripe_customer_id FROM users WHERE email = $1',
      [userEmail]
    );
    
    if (!userResult.rows[0]?.stripe_customer_id) {
      return res.status(400).json({ error: 'No subscription found' });
    }
    
    const session = await stripeClient.billingPortal.sessions.create({
      customer: userResult.rows[0].stripe_customer_id,
      return_url: returnUrl || `${req.headers.origin}/subscription`,
    });
    
    res.json({ url: session.url });
  } catch (error) {
    console.error('Create portal session error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Switch subscription plan (upgrade or downgrade between paid plans)
app.post('/api/subscription/switch', authenticateUser, async (req, res) => {
  try {
    const stripeClient = await getStripe();
    if (!stripeClient) {
      return res.status(503).json({ error: 'Payment system not configured' });
    }
    
    const userEmail = (req as any).userEmail;
    const { plan } = req.body;
    
    if (!plan || !['standard', 'pro'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan. Must be "standard" or "pro"' });
    }
    
    const priceId = STRIPE_PRICE_IDS[plan as keyof typeof STRIPE_PRICE_IDS];
    if (!priceId) {
      return res.status(400).json({ error: `Price ID not configured for ${plan} plan` });
    }
    
    const sharedPool = await getSharedPool();
    const userResult = await sharedPool.query(
      'SELECT stripe_customer_id, stripe_subscription_id, subscription_plan FROM users WHERE email = $1',
      [userEmail]
    );
    
    if (!userResult.rows[0]?.stripe_subscription_id) {
      return res.status(400).json({ error: 'No active subscription found. Please subscribe first.' });
    }
    
    const currentPlan = userResult.rows[0].subscription_plan;
    if (currentPlan === plan) {
      return res.status(400).json({ error: `You are already on the ${plan} plan` });
    }
    
    // Get the subscription to find the current subscription item
    const subscription = await stripeClient.subscriptions.retrieve(
      userResult.rows[0].stripe_subscription_id
    );
    
    if (!subscription.items.data[0]) {
      return res.status(400).json({ error: 'Invalid subscription state' });
    }
    
    // Update the subscription with the new price
    const updatedSubscription = await stripeClient.subscriptions.update(
      userResult.rows[0].stripe_subscription_id,
      {
        items: [{
          id: subscription.items.data[0].id,
          price: priceId,
        }],
        proration_behavior: 'create_prorations', // Prorate the change
      }
    );
    
    // Update the database
    await sharedPool.query(
      'UPDATE users SET subscription_plan = $1 WHERE email = $2',
      [plan, userEmail]
    );
    
    console.log(`✅ Plan switched: ${userEmail} ${currentPlan} -> ${plan}`);
    
    res.json({ 
      success: true, 
      plan,
      message: `Successfully switched to ${plan} plan`,
    });
  } catch (error) {
    console.error('Switch plan error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Cancel subscription (revert to free plan)
app.post('/api/subscription/cancel', authenticateUser, async (req, res) => {
  try {
    const stripeClient = await getStripe();
    if (!stripeClient) {
      return res.status(503).json({ error: 'Payment system not configured' });
    }
    
    const userEmail = (req as any).userEmail;
    
    const sharedPool = await getSharedPool();
    const userResult = await sharedPool.query(
      'SELECT stripe_subscription_id, subscription_plan FROM users WHERE email = $1',
      [userEmail]
    );
    
    if (!userResult.rows[0]?.stripe_subscription_id) {
      return res.status(400).json({ error: 'No active subscription to cancel' });
    }
    
    // Cancel the subscription immediately and downgrade to free
    await stripeClient.subscriptions.cancel(userResult.rows[0].stripe_subscription_id);
    
    // Update database to free plan
    await sharedPool.query(
      'UPDATE users SET subscription_plan = $1, stripe_subscription_id = NULL WHERE email = $2',
      ['free', userEmail]
    );
    
    console.log(`✅ Subscription canceled and downgraded to free: ${userEmail}`);
    
    res.json({ 
      success: true,
      plan: 'free',
      message: 'Subscription canceled. You have been downgraded to the free plan.',
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Downgrade to free plan (alias for cancel)
app.post('/api/subscription/downgrade-to-free', authenticateUser, async (req, res) => {
  try {
    const stripeClient = await getStripe();
    if (!stripeClient) {
      return res.status(503).json({ error: 'Payment system not configured' });
    }
    
    const userEmail = (req as any).userEmail;
    
    const sharedPool = await getSharedPool();
    const userResult = await sharedPool.query(
      'SELECT stripe_subscription_id, subscription_plan FROM users WHERE email = $1',
      [userEmail]
    );
    
    if (!userResult.rows[0]?.stripe_subscription_id) {
      // Already on free or no subscription, just update database
      await sharedPool.query(
        'UPDATE users SET subscription_plan = $1, stripe_subscription_id = NULL WHERE email = $2',
        ['free', userEmail]
      );
      return res.json({ 
        success: true,
        plan: 'free',
        message: 'You are now on the free plan.',
      });
    }
    
    // Cancel the subscription immediately and downgrade to free
    await stripeClient.subscriptions.cancel(userResult.rows[0].stripe_subscription_id);
    
    // Update database to free plan
    await sharedPool.query(
      'UPDATE users SET subscription_plan = $1, stripe_subscription_id = NULL WHERE email = $2',
      ['free', userEmail]
    );
    
    console.log(`✅ Downgraded to free: ${userEmail}`);
    
    res.json({ 
      success: true,
      plan: 'free',
      message: 'You have been downgraded to the free plan.',
    });
  } catch (error) {
    console.error('Downgrade to free error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Stripe webhook handler
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const stripeClient = await getStripe();
    if (!stripeClient) {
      return res.status(503).json({ error: 'Payment system not configured' });
    }
    
    // Always prioritize env var for webhook secret (Stripe CLI uses different secret each time)
    // Refresh secrets to get latest, but env var takes precedence
    const secrets = await getStripeSecretsFromSecretManager();
    const currentWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || secrets?.webhookSecret || stripeWebhookSecret;
    
    const sig = req.headers['stripe-signature'];
    if (!sig || !currentWebhookSecret) {
      console.error('Webhook error: Missing signature or webhook secret', {
        hasSig: !!sig,
        hasSecret: !!currentWebhookSecret,
        secretLength: currentWebhookSecret?.length || 0,
        usingEnvVar: !!process.env.STRIPE_WEBHOOK_SECRET,
      });
      return res.status(400).json({ error: 'Missing signature or webhook secret' });
    }
    
    let event: Stripe.Event;
    try {
      event = stripeClient.webhooks.constructEvent(req.body, sig, currentWebhookSecret);
    } catch (err: any) {
      console.error('Webhook signature verification failed:', err.message);
      console.error('Debug info:', {
        signaturePresent: !!sig,
        webhookSecretPresent: !!currentWebhookSecret,
        webhookSecretPrefix: currentWebhookSecret?.substring(0, 10) || 'none',
        usingEnvVar: !!process.env.STRIPE_WEBHOOK_SECRET,
        bodyType: typeof req.body,
        bodyLength: req.body?.length || 0,
      });
      console.error('💡 Tip: If using Stripe CLI, check the webhook secret it printed and update STRIPE_WEBHOOK_SECRET in .env');
      return res.status(400).json({ error: 'Invalid signature' });
    }
    
    console.log('📦 Stripe webhook received:', event.type);
    
    const sharedPool = await getSharedPool();
    
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userEmail = session.metadata?.userEmail;
        const plan = session.metadata?.plan;
        
        if (userEmail && plan) {
          await sharedPool.query(`
            UPDATE users 
            SET subscription_plan = $1, 
                stripe_subscription_id = $2,
                trial_ends_at = NULL
            WHERE email = $3
          `, [plan, session.subscription, userEmail]);
          console.log(`✅ Subscription activated: ${userEmail} -> ${plan}`);
        }
        break;
      }
      
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        
        // Get user by customer ID
        const userResult = await sharedPool.query(
          'SELECT email FROM users WHERE stripe_customer_id = $1',
          [customerId]
        );
        
        if (userResult.rows.length > 0) {
          const userEmail = userResult.rows[0].email;
          
          // Determine plan from price
          let plan = 'free';
          const priceId = subscription.items.data[0]?.price?.id;
          if (priceId === STRIPE_PRICE_IDS.pro) {
            plan = 'pro';
          } else if (priceId === STRIPE_PRICE_IDS.standard) {
            plan = 'standard';
          }
          
          await sharedPool.query(`
            UPDATE users 
            SET subscription_plan = $1, 
                stripe_subscription_id = $2
            WHERE email = $3
          `, [plan, subscription.id, userEmail]);
          console.log(`✅ Subscription updated: ${userEmail} -> ${plan}`);
        }
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        
        // Get user by customer ID
        const userResult = await sharedPool.query(
          'SELECT email FROM users WHERE stripe_customer_id = $1',
          [customerId]
        );
        
        if (userResult.rows.length > 0) {
          const userEmail = userResult.rows[0].email;
          await sharedPool.query(`
            UPDATE users 
            SET subscription_plan = 'free', 
                stripe_subscription_id = NULL
            WHERE email = $1
          `, [userEmail]);
          console.log(`✅ Subscription canceled: ${userEmail} -> free`);
        }
        break;
      }
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
    
    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Increment AI usage (called when user uses AI features)
app.post('/api/subscription/ai-usage', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const sharedPool = await getSharedPool();
    const today = new Date().toISOString().split('T')[0];
    
    // Get current usage and plan
    const result = await sharedPool.query(`
      SELECT subscription_plan, ai_daily_usage, ai_usage_reset_date, trial_ends_at, stripe_subscription_id
      FROM users WHERE email = $1
    `, [userEmail]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    let plan = user.subscription_plan || 'free';
    let currentUsage = user.ai_daily_usage || 0;
    
    // Reset if new day
    if (user.ai_usage_reset_date !== today) {
      currentUsage = 0;
    }
    
    // Check limits
    const trialEndsAt = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
    const isTrialActive = trialEndsAt && trialEndsAt > new Date();
    
    // If trial has expired and user has no Stripe subscription, downgrade to free
    if (!isTrialActive && trialEndsAt && !user.stripe_subscription_id && plan !== 'free') {
      // Trial expired and no active subscription - downgrade to free
      await sharedPool.query(`
        UPDATE users 
        SET subscription_plan = 'free', trial_ends_at = NULL
        WHERE email = $1
      `, [userEmail]);
      plan = 'free';
      console.log(`✅ Auto-downgraded ${userEmail} to free plan after trial expiration`);
    }
    
    let limit: number | null = null;
    if (plan === 'free') {
      limit = 0; // No AI access on free plan
    } else if (plan === 'standard') {
      limit = 20;
    }
    // Pro is unlimited
    
    if (limit !== null && currentUsage >= limit) {
      return res.status(429).json({ 
        error: 'AI usage limit reached',
        limit,
        usage: currentUsage,
        plan,
        isTrialActive,
      });
    }
    
    // Increment usage
    await sharedPool.query(`
      UPDATE users 
      SET ai_daily_usage = CASE 
        WHEN ai_usage_reset_date = $1 THEN ai_daily_usage + 1 
        ELSE 1 
      END,
      ai_usage_reset_date = $1
      WHERE email = $2
    `, [today, userEmail]);
    
    res.json({ 
      success: true, 
      usage: currentUsage + 1,
      limit,
      remaining: limit !== null ? Math.max(0, limit - currentUsage - 1) : null,
    });
  } catch (error) {
    console.error('Increment AI usage error:', error);
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
  // If it's an API route, return JSON error
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Route not found', path: req.path });
  }
  
  // For non-API routes, serve index.html (SPA routing)
  const indexPath = join(__dirname, '../dist/index.html');
  if (existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Route not found', path: req.path });
  }
});

// ============================================================================
// START SERVER
// ============================================================================

// Create HTTP server (needed for WebSocket support)
const server = http.createServer(app);

// Set up WebSocket server for LiveKit audio streaming
setupLiveKitWebSocketServer(server);
// Initialize audio recorder with Firestore for org-slug lookup
setFirestoreDb(db);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server started on port ${PORT}`);
  console.log(`✅ Health check available at http://0.0.0.0:${PORT}/api/health`);
  console.log(`✅ WebSocket server available at ws://0.0.0.0:${PORT}/api/livekit/audio-ws`);
});


