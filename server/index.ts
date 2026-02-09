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
  getOrgIdBySlug,
  closeOrgPool,
} from '../database/multi-tenant-pool.js';
import { setupIntegrationEndpoints } from './endpoints/integrations.js';
import { setupImageEndpoints } from './endpoints/images.js';
import { setupFileEndpoints } from './endpoints/files.js';
import { setupDocumentUploadEndpoints } from './endpoints/docs-upload.js';
import { setupTurnEndpoints } from './endpoints/turn.js';
import { setupUpdateEndpoints } from './endpoints/updates.js';
import { setupQueryEndpoints } from './endpoints/query.js';
import { setupPlansEndpoints } from './endpoints/plans.js';
import { setupAIAgentEndpoints } from './endpoints/ai-agents.js';
import { setupAIAgentWebhookEndpoints } from './endpoints/ai-agent-webhooks.js';
import { setWebhookSigningSecretFetcher } from './services/webhook-signing.js';
import { setupAgentAPIv1Endpoints } from './endpoints/agent-api-v1.js';
import { setupAgentTriggerEndpoints } from './endpoints/agent-triggers.js';
import { setupLeanRoutingEndpoints } from './endpoints/lean-routing.js';
import http from 'http';
import { sendVerificationEmail, sendInvitationEmail, sendDocShareInvitationEmail, sendDocShareNotificationEmail } from './services/email.js';
import { notifyAgentOfAssignment } from './services/ai-agent-service.js';
import { emitEvent, EventTypes } from './services/event-bus.js';
import { extractMentions } from './services/mention-service.js';
import { validateRequest } from './middleware/validate-request.js';
import { createTaskSchema, updateTaskSchema, fullUpdateTaskSchema } from './validation/task-schemas.js';
import { createDocSchema, updateDocSchema } from './validation/doc-schemas.js';
import { signupSchema, loginSchema, resendVerificationSchema } from './validation/auth-schemas.js';
import { updateUserProfileSchema } from './validation/user-schemas.js';
import { createOrgSchema, updateOrgSchema, inviteToOrgSchema } from './validation/org-schemas.js';
import { createProjectSchema, updateProjectSchema, addProjectMemberSchema, addProjectCommentSchema } from './validation/project-schemas.js';
import { checkoutSchema, portalSchema, switchPlanSchema } from './validation/subscription-schemas.js';
import { demoRequestSchema, docShareSchema, addTaskCommentSchema } from './validation/misc-schemas.js';
import { queryTaskProgressUpdatesSchema, queryProjectProgressUpdatesSchema } from './validation/update-schemas.js';
import { convertJsonToHtml, convertJsonToHtmlWithPositions } from './utils/contentUtils.js';
import { getStorageBucket, getFirestoreDatabaseName, getSecretName, getCredentialPath, isLocalDev } from './utils/env.js';

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read service account credentials
const serviceAccountPath = join(__dirname, '../', getCredentialPath());
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
    const storageBucket = serviceAccount.storage_bucket || getStorageBucket();
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

// Use named database based on environment - this is the database configured in Firebase
// Note: Client SDK will need to be configured to use the same database
const db = getFirestore(firebaseApp, getFirestoreDatabaseName());
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
        name: `projects/${projectId}/secrets/${getSecretName('stripe-secret-key')}/versions/latest`
      }),
      secretManagerClient.accessSecretVersion({
        name: `projects/${projectId}/secrets/${getSecretName('stripe-webhook-secret')}/versions/latest`
      }),
      secretManagerClient.accessSecretVersion({
        name: `projects/${projectId}/secrets/${getSecretName('stripe-price-standard')}/versions/latest`
      }),
      secretManagerClient.accessSecretVersion({
        name: `projects/${projectId}/secrets/${getSecretName('stripe-price-pro')}/versions/latest`
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
// Increase limit to 12MB to match nginx client_max_body_size and handle large documents
app.use((req, res, next) => {
  if (req.path === '/api/integrations/github/webhooks' || 
      req.path === '/api/webhooks/stripe' || 
      req.path.startsWith('/api/images/')) {
    next();
  } else {
    express.json({ limit: '12mb' })(req, res, next);
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

// Rate limiting for "No token provided" logs to prevent spam
const noTokenLogCache = new Map<string, number>();
const NO_TOKEN_LOG_INTERVAL = 60000; // Log once per minute per endpoint

async function authenticateUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    const apiKey = req.headers['x-api-key'] as string | undefined;
    
    // Check for API key authentication first
    if (apiKey) {
      try {
        const validApiKey = await getApiKeyFromSecretManager();
        if (apiKey === validApiKey) {
          // API key is valid - allow request to proceed
          // Extract user email from X-User-Email header if provided (for API key auth)
          const userEmail = req.headers['x-user-email'] as string | undefined;
          if (userEmail) {
            (req as any).userEmail = userEmail.toLowerCase();
          }
          (req as any).authenticatedViaApiKey = true;
          
          // If org context is provided, validate membership (same as Bearer token flow)
          const orgIdentifier = req.headers['x-org-identifier'] as string ||
                               req.headers['x-org-id'] as string | undefined;
          if (orgIdentifier && userEmail) {
            try {
              const orgId = await resolveOrgId(orgIdentifier);
              const membership = await checkOrgMembership(orgId, userEmail.toLowerCase());
              if (membership.isMember) {
                (req as any).orgId = orgId;
                (req as any).orgRole = membership.role;
              }
            } catch (error: any) {
              // Log error but continue without org context if slug conversion fails
              if (process.env.NODE_ENV === 'development') {
                console.warn('⚠️ [Backend] authenticateUser: Failed to resolve org context for API key auth', {
                  error: error.message,
                  orgIdentifier,
                });
              }
            }
          }
          
          next();
          return;
        } else {
          return res.status(401).json({ error: 'Invalid API key' });
        }
      } catch (error: any) {
        console.error('❌ [Backend] authenticateUser: API key validation failed', {
          error: error.message,
          method: req.method,
          path: req.path,
        });
        return res.status(401).json({ error: 'Invalid API key' });
      }
    }
    
    // Fall back to Bearer token authentication
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // Rate limit logging to prevent spam from polling/retry mechanisms
      // Only log in development mode to reduce production noise
      const endpointKey = `${req.method} ${req.path}`;
      const now = Date.now();
      const lastLogTime = noTokenLogCache.get(endpointKey) || 0;
      
      if (process.env.NODE_ENV === 'development' && now - lastLogTime > NO_TOKEN_LOG_INTERVAL) {
        console.warn('⚠️ [Backend] authenticateUser: No token provided', {
          hasAuthHeader: !!authHeader,
          authHeader: authHeader?.substring(0, 50),
          method: req.method,
          path: req.path,
        });
        noTokenLogCache.set(endpointKey, now);
      }
      
      return res.status(401).json({ error: 'No token or API key provided' });
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
    const orgIdentifier = req.headers['x-org-identifier'] as string ||
                         req.headers['x-org-id'] as string | undefined;
    if (orgIdentifier && userEmail) {
      // Validate org membership
      try {
        const orgId = await resolveOrgId(orgIdentifier);
        const membership = await checkOrgMembership(orgId, userEmail);
        if (membership.isMember) {
          (req as any).orgId = orgId;
          (req as any).orgRole = membership.role;
        }
      } catch (error: any) {
        // Log error but don't fail authentication - org context is optional
        if (process.env.NODE_ENV === 'development') {
          console.warn('⚠️ [Backend] authenticateUser: Failed to resolve org context', {
            error: error.message,
            orgIdentifier,
          });
        }
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
 * Helper function to convert org identifier (slug or UUID) to org ID
 * @param orgIdentifier - Can be a UUID or a slug
 * @returns The org ID (UUID)
 */
async function resolveOrgId(orgIdentifier: string): Promise<string> {
  // Check if orgIdentifier is a UUID or a slug
  // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (36 chars with hyphens)
  // or xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (32 hex chars)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgIdentifier) ||
                /^[0-9a-f]{32}$/i.test(orgIdentifier);
  
  if (isUuid) {
    return orgIdentifier;
  } else {
    // It's a slug, convert to ID
    return await getOrgIdBySlug(orgIdentifier);
  }
}

/**
 * Middleware to require org membership for org-scoped endpoints
 * Must be used after authenticateUser
 */
async function requireOrgMembership(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const userEmail = (req as any).userEmail;
    const orgIdentifier = req.headers['x-org-identifier'] as string ||
                          req.headers['x-org-id'] as string ||
                          req.params.orgId;

    console.log(`🔒 requireOrgMembership: ${req.method} ${req.path}, userEmail: ${userEmail}, orgIdentifier: ${orgIdentifier}, headers:`, {
      'x-org-identifier': req.headers['x-org-identifier'],
      'x-org-id': req.headers['x-org-id'],
      'x-org-slug': req.headers['x-org-slug']
    });

    if (!orgIdentifier) {
      console.error(`❌ requireOrgMembership: No orgIdentifier found for ${req.method} ${req.path}`);
      return res.status(400).json({ error: 'Organization identifier is required (X-Org-Identifier or X-Org-Id header, or orgId param)' });
    }
    
    if (!userEmail) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    // Resolve org identifier (slug or UUID) to org ID
    let orgId: string;
    try {
      orgId = await resolveOrgId(orgIdentifier);
    } catch (error: any) {
      console.error('❌ [Backend] requireOrgMembership: Failed to resolve org identifier', {
        error: error.message,
        orgIdentifier,
        method: req.method,
        path: req.path,
      });
      return res.status(404).json({ error: `Organization not found: ${orgIdentifier}` });
    }
    
    const membership = await checkOrgMembership(orgId, userEmail);
    if (!membership.isMember) {
      return res.status(403).json({ error: 'Not a member of this organization' });
    }

    // Get the org slug for database connections
    const orgSlug = await getOrgSlugById(orgId);

    (req as any).orgId = orgId;
    (req as any).orgSlug = orgSlug;
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
    const orgIdentifier = headerOrgId || paramOrgId;
    
    console.log(`[requireOrgOwner] Checking ownership - headerOrgId: ${headerOrgId}, paramOrgId: ${paramOrgId}, final orgIdentifier: ${orgIdentifier}, userEmail: ${userEmail}`);
    
    if (!orgIdentifier) {
      console.error(`[requireOrgOwner] Missing orgId - headers:`, req.headers, `params:`, req.params);
      return res.status(400).json({ error: 'Organization ID is required' });
    }
    
    if (!userEmail) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    // Resolve org identifier (slug or UUID) to org ID
    let orgId: string;
    try {
      orgId = await resolveOrgId(orgIdentifier);
    } catch (error: any) {
      console.error('❌ [Backend] requireOrgOwner: Failed to resolve org identifier', {
        error: error.message,
        orgIdentifier,
        method: req.method,
        path: req.path,
      });
      return res.status(404).json({ error: `Organization not found: ${orgIdentifier}` });
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
    
    // Match by ID (UUID format) only - no slug fallback
    const result = await pool.query(`
      SELECT 
        p.visibility,
        p.visible_to_members,
        p.owner_email
      FROM projects p
      WHERE p.id = $1
    `, [projectId]);
    
    if (result.rows.length === 0) {
      // Project ID not found - treat as no project (task becomes unlinked)
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

app.post('/api/demo-requests', validateRequest(demoRequestSchema), async (req, res) => {
  try {
    const { name, email, company, message } = req.body;

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

app.post('/api/auth/signup', validateRequest(signupSchema), async (req, res) => {
  try {
    const { email, password, firstName, lastName, jobTitle, timezone } = req.body;
    
    // Validation handled by middleware
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

app.post('/api/auth/login', validateRequest(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation handled by middleware
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
app.post('/api/auth/resend-verification', validateRequest(resendVerificationSchema), async (req, res) => {
  try {
    const { email } = req.body;
    
    // Validation handled by middleware
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
    
    // Extract query parameters
    const status = req.query.status as string | undefined;
    const role = req.query.role as string | undefined;
    const searchTerm = req.query.searchTerm as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    
    // If org context is provided, return org members from org-specific users table
    // Otherwise, return all users the requesting user can see (from their orgs)
    if (orgId) {
      // Validate membership - resolve org identifier (slug or UUID) to org ID first
      let resolvedOrgId: string;
      try {
        resolvedOrgId = await resolveOrgId(orgId);
      } catch (error: any) {
        return res.status(404).json({ error: `Organization not found: ${orgId}` });
      }
      
      const membership = await checkOrgMembership(resolvedOrgId, userEmail);
      if (!membership.isMember) {
        return res.status(403).json({ error: 'Not a member of this organization' });
      }
      
      // Build WHERE conditions
      const whereConditions: string[] = [];
      const queryParams: any[] = [];
      let paramIndex = 1;
      
      // Base condition - exclude inactive by default unless status filter is provided
      if (status) {
        whereConditions.push(`status = $${paramIndex}`);
        queryParams.push(status);
        paramIndex++;
      } else {
        whereConditions.push(`status != 'inactive'`);
      }
      
      if (role) {
        whereConditions.push(`role = $${paramIndex}`);
        queryParams.push(role);
        paramIndex++;
      }
      
      if (searchTerm) {
        whereConditions.push(`(
          email ILIKE $${paramIndex}
          OR first_name ILIKE $${paramIndex}
          OR last_name ILIKE $${paramIndex}
          OR job_title ILIKE $${paramIndex}
        )`);
        queryParams.push(`%${searchTerm}%`);
        paramIndex++;
      }
      
      // Build LIMIT clause
      const limitClause = limit ? `LIMIT $${paramIndex}` : '';
      if (limit) {
        queryParams.push(limit);
      }
      
      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
      
      // Get org members from org-specific users table
      const orgPool = await getOrgPool(resolvedOrgId);
      const result = await orgPool.query(`
        SELECT email, first_name, last_name, job_title, responsibilities,
               avatar, timezone, status, role, joined_at, last_active_at, created_at
        FROM users 
        ${whereClause}
        ORDER BY 
          CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
          created_at ASC
        ${limitClause}
      `, queryParams);
      
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
      
      // Build WHERE conditions
      const whereConditions: string[] = [];
      const queryParams: any[] = [userEmail];
      let paramIndex = 2;
      
      whereConditions.push(`om.org_id IN (
        SELECT org_id FROM org_members WHERE user_email = $1
      )`);
      
      if (searchTerm) {
        whereConditions.push(`(
          u.email ILIKE $${paramIndex}
          OR u.first_name ILIKE $${paramIndex}
          OR u.last_name ILIKE $${paramIndex}
          OR u.job_title ILIKE $${paramIndex}
        )`);
        queryParams.push(`%${searchTerm}%`);
        paramIndex++;
      }
      
      // Build LIMIT clause
      const limitClause = limit ? `LIMIT $${paramIndex}` : '';
      if (limit) {
        queryParams.push(limit);
      }
      
      const whereClause = whereConditions.join(' AND ');
      
      const result = await sharedPool.query(`
        SELECT DISTINCT u.email, u.first_name, u.last_name, u.job_title, u.responsibilities, u.created_at
        FROM users u
        INNER JOIN org_members om ON u.email = om.user_email
        WHERE ${whereClause}
        ORDER BY u.created_at DESC
        ${limitClause}
      `, queryParams);
      
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

app.put('/api/users/profile', authenticateUser, validateRequest(updateUserProfileSchema), async (req, res) => {
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
    
    // Validation handled by middleware
    
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
    
    // 1. Get user's personal workspace (will be deleted)
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
        
        // Delete projects owned by user
        await orgPool.query('DELETE FROM projects WHERE owner_email = $1', [userEmail]);
        
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
app.post('/api/orgs', authenticateUser, validateRequest(createOrgSchema), async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const { name, description } = req.body;
    
    // Validation handled by middleware
    
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
app.put('/api/orgs/:orgId', authenticateUser, requireOrgOwner, validateRequest(updateOrgSchema), async (req, res) => {
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
    
    // Get organization details including slug and owner_email
    const orgResult = await sharedPool.query(
      'SELECT id, slug, type, name, owner_email FROM organizations WHERE id = $1',
      [orgId]
    );
    
    if (orgResult.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    const org = orgResult.rows[0];
    
    if (org.type === 'personal') {
      return res.status(400).json({ error: 'Cannot delete personal workspace' });
    }
    
    const orgSlug = org.slug;
    const orgName = org.name;
    const ownerEmail = org.owner_email;
    
    console.log(`🗑️ Starting complete deletion of organization: ${orgName} (${orgSlug})`);
    
    // 1. Get database name
    const dbName = sanitizeSlugForDb(orgSlug);
    console.log(`📦 Organization database: ${dbName}`);
    
    // 2. Close and remove connection pool for this org
    try {
      await closeOrgPool(dbName);
    } catch (poolError: any) {
      console.warn(`⚠️ Error closing connection pool: ${poolError.message}`);
    }
    
    // 4. Drop the PostgreSQL database
    try {
      // Get password from Secret Manager
      const passwordSecretName = `projects/${serviceAccount.project_id}/secrets/${getSecretName('postgresdb-password')}/versions/latest`;
      const [passwordVersion] = await secretManagerClient.accessSecretVersion({ name: passwordSecretName });
      const password = (passwordVersion.payload?.data?.toString() || '').trim();
      // For local development, use localhost (Cloud SQL Proxy)
      // For production, use Unix socket path
      const isLocalDev = process.env.NODE_ENV === 'development' || !process.env.DB_HOST;
      const dbHost = process.env.DB_HOST || (isLocalDev 
        ? 'localhost'  // Local development: use Cloud SQL Proxy on localhost
        : `/cloudsql/${serviceAccount.project_id}:us-west1:leanworks-prod`);  // Production: use Unix socket
      const dbPort = parseInt(process.env.DB_PORT || '5432');
      
      const { Client } = await import('pg');
      const adminClient = new Client({
        host: dbHost,
        ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
        database: 'postgres', // Connect to postgres database to drop the org database
        user: process.env.DB_USER || 'postgres',
        password: password,
        ssl: false,
      });
      
      await adminClient.connect();
      console.log(`🗑️ Dropping database: ${dbName}`);
      
      // Terminate all connections to the database first
      await adminClient.query(`
        SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
        WHERE pg_stat_activity.datname = $1
          AND pid <> pg_backend_pid()
      `, [dbName]);
      
      // Drop the database
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      await adminClient.end();
      console.log(`✅ Database ${dbName} dropped successfully`);
    } catch (dbError: any) {
      console.error(`❌ Error dropping database ${dbName}:`, dbError.message);
      // Continue with other cleanup even if database drop fails
    }
    
    // 5. Delete all Firestore collections for this org
    try {
      const orgPath = `orgs/${orgSlug}`;
      console.log(`🔥 Deleting Firestore collections under ${orgPath}`);
      
      // List of collections to delete
      const collections = ['messages', 'calls', 'callInvitations'];
      
      for (const collection of collections) {
        try {
          const collectionRef = db.collection(`${orgPath}/${collection}`);
          let totalDeleted = 0;
          
          // Firestore batches are limited to 500 operations, so we need to batch in chunks
          while (true) {
            const snapshot = await collectionRef.limit(500).get();
            
            if (snapshot.empty) {
              break;
            }
            
            console.log(`  Deleting batch of ${snapshot.size} documents from ${collection}...`);
            const batch = db.batch();
            snapshot.docs.forEach((doc) => {
              batch.delete(doc.ref);
            });
            await batch.commit();
            totalDeleted += snapshot.size;
            
            // If we got fewer than 500, we're done
            if (snapshot.size < 500) {
              break;
            }
          }
          
          if (totalDeleted > 0) {
            console.log(`  ✅ Deleted ${totalDeleted} documents from ${collection} collection`);
          }
        } catch (collectionError: any) {
          console.warn(`  ⚠️ Error deleting ${collection} collection: ${collectionError.message}`);
        }
      }
      
      console.log(`✅ Firestore collections deleted for ${orgSlug}`);
    } catch (firestoreError: any) {
      console.error(`❌ Error deleting Firestore collections: ${firestoreError.message}`);
      // Continue with org deletion even if Firestore cleanup fails
    }
    
    // 6. Delete org record from shared database (cascade will handle members and invitations)
    console.log(`🗑️ Deleting organization record from shared database`);
    await sharedPool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    
    console.log(`✅ Organization ${orgName} (${orgSlug}) completely deleted`);
    res.json({ success: true, message: 'Organization deleted completely' });
  } catch (error) {
    console.error('❌ Delete org error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get unified notifications for current user (includes all types: org invitations, system messages, etc.)
app.get('/api/notifications', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const sharedPool = await getSharedPool();
    
    // Get unread and read (but not dismissed) notifications, ordered by most recent
    // For org_invitation type, only include if the invitation is still pending and not expired
    const result = await sharedPool.query(`
      SELECT 
        n.id,
        n.user_email,
        n.org_id,
        n.type,
        n.title,
        n.message,
        n.status,
        n.metadata,
        n.action_url,
        n.created_at,
        n.read_at,
        n.dismissed_at
      FROM notifications n
      LEFT JOIN org_invitations oi ON 
        n.type = 'org_invitation' AND 
        n.metadata->>'invitation_id' = oi.id::text
      WHERE n.user_email = $1 
        AND n.status != 'dismissed'
        AND (
          n.type != 'org_invitation' OR
          (oi.status = 'pending' AND oi.expires_at > NOW())
        )
      ORDER BY n.created_at DESC
      LIMIT 50
    `, [userEmail]);
    
    const notifications = result.rows.map(row => ({
      id: row.id,
      userEmail: row.user_email,
      orgId: row.org_id,
      type: row.type,
      title: row.title,
      message: row.message,
      status: row.status,
      metadata: row.metadata,
      actionUrl: row.action_url,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
      dismissedAt: row.dismissed_at ? new Date(row.dismissed_at).toISOString() : null,
    }));
    
    res.json(notifications);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Mark notification as read
app.patch('/api/notifications/:notificationId/read', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const notificationId = req.params.notificationId;
    const sharedPool = await getSharedPool();
    
    // Verify notification belongs to user
    const checkResult = await sharedPool.query(
      'SELECT id FROM notifications WHERE id = $1 AND user_email = $2',
      [notificationId, userEmail]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    // Update notification status
    await sharedPool.query(`
      UPDATE notifications
      SET status = 'read', read_at = NOW()
      WHERE id = $1 AND user_email = $2
    `, [notificationId, userEmail]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Dismiss notification
app.patch('/api/notifications/:notificationId/dismiss', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const notificationId = req.params.notificationId;
    const sharedPool = await getSharedPool();
    
    // Verify notification belongs to user
    const checkResult = await sharedPool.query(
      'SELECT id FROM notifications WHERE id = $1 AND user_email = $2',
      [notificationId, userEmail]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    // Update notification status
    await sharedPool.query(`
      UPDATE notifications
      SET status = 'dismissed', dismissed_at = NOW()
      WHERE id = $1 AND user_email = $2
    `, [notificationId, userEmail]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Dismiss notification error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Invite user to organization
app.post('/api/orgs/:orgId/invite', authenticateUser, requireOrgOwner, validateRequest(inviteToOrgSchema), async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = req.params.orgId;
    const { email: inviteeEmail, message } = req.body;
    
    console.log(`[Invite] Request received - orgId: ${orgId}, userEmail: ${userEmail}, body:`, JSON.stringify(req.body));
    
    // Validation handled by middleware
    const normalizedInviteeEmail = inviteeEmail.toLowerCase();
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
    const orgResult = await sharedPool.query('SELECT name, slug FROM organizations WHERE id = $1', [orgId]);
    const orgName = orgResult.rows[0]?.name || 'Unknown Organization';
    const orgSlug = orgResult.rows[0]?.slug;
    
    // Get inviter's name
    const inviterResult = await sharedPool.query(
      'SELECT first_name, last_name FROM users WHERE email = $1',
      [userEmail]
    );
    const inviterData = inviterResult.rows[0] || {};
    const inviterName = inviterData.first_name && inviterData.last_name
      ? `${inviterData.first_name} ${inviterData.last_name}`
      : inviterData.first_name || inviterData.last_name || userEmail.split('@')[0];
    
    // Create or update notification for the invitee
    try {
      const notificationMetadata = JSON.stringify({
        invitation_id: invitation.id,
        org_id: orgId,
        inviter_email: userEmail,
        inviter_name: inviterName,
        org_name: orgName,
        org_slug: orgSlug,
        expires_at: invitation.expires_at
      });

      // Check if notification already exists for this invitation
      const existingNotif = await sharedPool.query(`
        SELECT id FROM notifications 
        WHERE user_email = $1 
          AND type = 'org_invitation' 
          AND metadata->>'invitation_id' = $2
      `, [normalizedInviteeEmail, invitation.id]);

      if (existingNotif.rows.length > 0) {
        // Update existing notification - reset to unread, update metadata and timestamps
        await sharedPool.query(`
          UPDATE notifications 
          SET title = $1,
              message = $2,
              status = 'unread',
              metadata = $3::jsonb,
              created_at = NOW(),
              read_at = NULL,
              dismissed_at = NULL
          WHERE id = $4
        `, [
          `${inviterName} invited you to join ${orgName}`,
          message || `You have been invited to join ${orgName}`,
          notificationMetadata,
          existingNotif.rows[0].id
        ]);
        console.log(`✅ Updated notification for invitation ${invitation.id}`);
      } else {
        // Create new notification
        await sharedPool.query(`
          INSERT INTO notifications (
            user_email,
            org_id,
            type,
            title,
            message,
            status,
            metadata,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
        `, [
          normalizedInviteeEmail,
          orgId,
          'org_invitation',
          `${inviterName} invited you to join ${orgName}`,
          message || `You have been invited to join ${orgName}`,
          'unread',
          notificationMetadata
        ]);
        console.log(`✅ Created notification for invitation ${invitation.id}`);
      }
    } catch (notifError: any) {
      // Don't fail invitation if notification creation fails
      console.warn(`⚠️ Failed to create/update notification for invitation: ${notifError.message}`);
    }
    
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

// Get invitation preview (public endpoint for signup page)
app.get('/api/orgs/invitations/:invitationId/preview', async (req, res) => {
  try {
    const invitationId = req.params.invitationId;
    const sharedPool = await getSharedPool();
    
    // Get invitation details
    const result = await sharedPool.query(`
      SELECT 
        i.id,
        i.invitee_email,
        i.inviter_email,
        i.expires_at,
        o.name as org_name,
        o.slug as org_slug,
        u.first_name as inviter_first_name,
        u.last_name as inviter_last_name
      FROM org_invitations i
      INNER JOIN organizations o ON i.org_id = o.id
      LEFT JOIN users u ON i.inviter_email = u.email
      WHERE i.id = $1 AND i.status = 'pending'
    `, [invitationId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invitation not found or already processed' });
    }
    
    const invitation = result.rows[0];
    
    // Check if invitation has expired
    if (new Date(invitation.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invitation has expired' });
    }
    
    // Build inviter name
    const inviterName = invitation.inviter_first_name && invitation.inviter_last_name
      ? `${invitation.inviter_first_name} ${invitation.inviter_last_name}`
      : invitation.inviter_first_name || invitation.inviter_last_name || invitation.inviter_email.split('@')[0];
    
    res.json({
      invitationId: invitation.id,
      orgName: invitation.org_name,
      orgSlug: invitation.org_slug,
      inviterName: inviterName,
      inviterEmail: invitation.inviter_email,
      inviteeEmail: invitation.invitee_email,
      expiresAt: invitation.expires_at
    });
  } catch (error) {
    console.error('Invitation preview error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
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
// PROJECT ENDPOINTS (PostgreSQL)
// ============================================================================

app.get('/api/projects', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const pool = await getOrgPool(orgId);
    
    // Extract query parameters
    const status = req.query.status as string | undefined;
    const owner = req.query.owner as string | undefined;
    const memberEmail = req.query.memberEmail as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    
    // Build WHERE conditions
    const whereConditions: string[] = [];
    const queryParams: any[] = [userEmail.toLowerCase(), JSON.stringify([userEmail.toLowerCase()])];
    let paramIndex = 3;
    
    // Base visibility conditions
    whereConditions.push(`(
      -- Owner always has access
      p.owner_email = $1
      -- OR visibility is 'all_members' (default - visible to all org members)
      OR (p.visibility = 'all_members' OR p.visibility IS NULL)
      -- OR visibility is 'specific_members' and user is in visible_to_members
      OR (p.visibility = 'specific_members' AND p.visible_to_members IS NOT NULL AND p.visible_to_members @> $2::jsonb)
    )`);
    
    // Add filter conditions
    if (status) {
      whereConditions.push(`p.status = $${paramIndex}`);
      queryParams.push(status);
      paramIndex++;
    }
    
    if (owner) {
      whereConditions.push(`p.owner_email = $${paramIndex}`);
      queryParams.push(owner.toLowerCase());
      paramIndex++;
    }
    
    if (memberEmail) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = p.id AND pm.user_email = $${paramIndex}
      )`);
      queryParams.push(memberEmail.toLowerCase());
      paramIndex++;
    }
    
    // Build LIMIT clause
    const limitClause = limit ? `LIMIT $${paramIndex}` : '';
    if (limit) {
      queryParams.push(limit);
    }
    
    const whereClause = whereConditions.join(' AND ');
    
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
      WHERE ${whereClause}
      ORDER BY p.created_at DESC
      ${limitClause}
    `, queryParams);
    
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
      // Frontend uses project.memberCount to display member count (members are already transformed above)
      project.memberCount = Array.isArray(project.members) ? project.members.length : 0;
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
    // Frontend uses project.memberCount to display member count (members are already transformed above)
    project.memberCount = Array.isArray(project.members) ? project.members.length : 0;
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

app.post('/api/projects', authenticateUser, requireOrgMembership, validateRequest(createProjectSchema), async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const pool = await getOrgPool(orgId);
    
    // Validation handled by middleware
    const project = req.body;
    const name = project.name;
    const description = project.description || '';
    const teamId = project.teamId || null;
    const status = project.status || 'active';
    const priority = project.priority || 'medium';
    const dueDate = project.dueDate || null;
    const projectVisibility = project.visibility || 'all_members';
    const visibleToMembersArray = (projectVisibility === 'specific_members' && project.visibleToMembers)
      ? project.visibleToMembers.map((email: string) => email.toLowerCase())
      : [];
    
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
    
    // Emit event
    emitEvent(EventTypes.PROJECT_CREATED, 'project', projectId, orgId, 'human', userEmail,
      { name, status, priority, teamId },
      extractMentions(description)
    ).catch(err => console.error('[Event Bus] Project created event error:', err));

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

app.patch('/api/projects/:id', authenticateUser, requireOrgMembership, validateRequest(updateProjectSchema), async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const projectId = req.params.id;
    const updates = req.body;
    const pool = await getOrgPool(orgId);
    
    // Get project details for ownership check
    const projectCheck = await pool.query(
      'SELECT owner_email FROM projects WHERE id = $1',
      [projectId]
    );
    
    if (projectCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const projectOwnerEmail = projectCheck.rows[0].owner_email?.toLowerCase();
    const normalizedUserEmail = userEmail.toLowerCase();
    
    // Check if user is trying to update fields that require ownership
    // Only owners can update: name, description, status, dueDate, startDate, endDate
    const ownerOnlyFields = ['name', 'description', 'status', 'dueDate', 'startDate', 'endDate', 'visibility', 'visibleToMembers', 'priority'];
    const hasOwnerOnlyChanges = ownerOnlyFields.some(field => updates[field] !== undefined);
    
    if (hasOwnerOnlyChanges && projectOwnerEmail !== normalizedUserEmail) {
      return res.status(403).json({ error: 'Only the project owner can update this project' });
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

    emitEvent(EventTypes.PROJECT_UPDATED, 'project', projectId, orgId, 'human', userEmail,
      { updatedFields: Object.keys(updates) }
    ).catch(err => console.error('[Event Bus] Project updated event error:', err));
    
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

    emitEvent(EventTypes.PROJECT_DELETED, 'project', projectId, orgId, 'human', userEmail)
      .catch(err => console.error('[Event Bus] Project deleted event error:', err));
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Add project member
app.post('/api/projects/:id/members', authenticateUser, requireOrgMembership, validateRequest(addProjectMemberSchema), async (req, res) => {
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
    
    // Validation handled by middleware
    
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

// Add project comment
app.post('/api/projects/:id/comments', authenticateUser, requireOrgMembership, validateRequest(addProjectCommentSchema), async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const projectId = req.params.id;
    const { comment } = req.body;
    const pool = await getOrgPool(orgId);
    
    // Validation handled by middleware
    
    // Verify project exists
    const projectResult = await pool.query(
      'SELECT id FROM projects WHERE id = $1',
      [projectId]
    );
    
    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Get user info for member name and avatar
    const userResult = await pool.query(
      'SELECT first_name, last_name FROM users WHERE email = $1',
      [userEmail.toLowerCase()]
    );
    
    let memberName = userEmail;
    let memberAvatar = 'U';
    
    if (userResult.rows.length > 0) {
      const firstName = userResult.rows[0].first_name || '';
      const lastName = userResult.rows[0].last_name || '';
      if (firstName && lastName) {
        memberName = `${firstName} ${lastName}`;
        memberAvatar = (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
      } else {
        memberAvatar = userEmail.substring(0, 2).toUpperCase();
      }
    }
    
    // Get user's timezone from shared database
    const sharedPool = await getSharedPool();
    const userTimezoneResult = await sharedPool.query(
      'SELECT timezone FROM users WHERE email = $1',
      [userEmail.toLowerCase()]
    );
    const userTimezone = userTimezoneResult.rows[0]?.timezone || 'America/Los_Angeles';
    
    // Generate comment ID
    const commentId = crypto.randomBytes(16).toString('hex');
    
    // Get today's date in user's timezone
    const now = new Date();
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: userTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now);
    
    // Insert comment
    await pool.query(
      `INSERT INTO project_comments (id, project_id, member_name, member_avatar, date, comment)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [commentId, projectId, memberName, memberAvatar, today, comment.trim()]
    );

    // Emit event with mentions extracted from comment
    emitEvent(EventTypes.PROJECT_COMMENTED, 'project', projectId, orgId, 'human', userEmail,
      { commentId, comment: comment.trim() },
      extractMentions(comment)
    ).catch(err => console.error('[Event Bus] Project commented event error:', err));
    
    res.json({
      success: true,
      comment: {
        id: commentId,
        memberName,
        memberAvatar,
        date: today,
        comment: comment.trim()
      }
    });
  } catch (error) {
    console.error('Add project comment error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Add task comment
app.post('/api/tasks/:id/comments', authenticateUser, requireOrgMembership, validateRequest(addTaskCommentSchema), async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const taskId = req.params.id;
    const { comment } = req.body;
    const pool = await getOrgPool(orgId);
    
    // Validation handled by middleware
    
    // Verify task exists
    const taskResult = await pool.query(
      'SELECT id FROM tasks WHERE id = $1',
      [taskId]
    );
    
    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Get user info for member name and avatar
    const userResult = await pool.query(
      'SELECT first_name, last_name FROM users WHERE email = $1',
      [userEmail.toLowerCase()]
    );
    
    let memberName = userEmail;
    let memberAvatar = 'U';
    
    if (userResult.rows.length > 0) {
      const firstName = userResult.rows[0].first_name || '';
      const lastName = userResult.rows[0].last_name || '';
      if (firstName && lastName) {
        memberName = `${firstName} ${lastName}`;
        memberAvatar = (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
      } else {
        memberAvatar = userEmail.substring(0, 2).toUpperCase();
      }
    }
    
    // Get user's timezone from shared database
    const sharedPool = await getSharedPool();
    const userTimezoneResult = await sharedPool.query(
      'SELECT timezone FROM users WHERE email = $1',
      [userEmail.toLowerCase()]
    );
    const userTimezone = userTimezoneResult.rows[0]?.timezone || 'America/Los_Angeles';
    
    // Generate comment ID
    const commentId = crypto.randomBytes(16).toString('hex');
    
    // Get today's date in user's timezone
    const now = new Date();
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: userTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now);
    
    // Insert comment
    await pool.query(
      `INSERT INTO task_comments (id, task_id, member_name, member_avatar, date, comment)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [commentId, taskId, memberName, memberAvatar, today, comment.trim()]
    );

    // Emit event with mentions extracted from comment
    emitEvent(EventTypes.TASK_COMMENTED, 'task', taskId, orgId, 'human', userEmail,
      { commentId, comment: comment.trim() },
      extractMentions(comment)
    ).catch(err => console.error('[Event Bus] Task commented event error:', err));
    
    res.json({
      success: true,
      comment: {
        id: commentId,
        memberName,
        memberAvatar,
        date: today,
        comment: comment.trim()
      }
    });
  } catch (error) {
    console.error('Add task comment error:', error);
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
    
    if (!orgId) {
      return res.status(400).json({ error: 'Organization ID is required' });
    }
    
    if (!userEmail) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    console.log(`📚 GET /api/docs - Fetching docs for org ${orgId} (user: ${userEmail})`);
    
    const pool = await getOrgPool(orgId);
    const normalizedEmail = userEmail.toLowerCase();
    
    // Filter docs based on visibility:
    // - 'all_members': visible to all org members (default)
    // - 'specific_members': visible to owner and members in visible_to_members array (limited visibility)
    // Check if metadata column exists, then query accordingly
    let result;
    try {
      result = await pool.query(`
        SELECT
          id,
          title,
          content,
          owner_email,
          project_id,
          team_id,
          folder_id,
          is_folder,
          tags,
          COALESCE(metadata, '{}'::jsonb) as metadata,
          visibility,
          visible_to_members,
          created_at,
          updated_at,
          doc_type,
          storage_path,
          file_metadata,
          processing_status,
          file_size,
          mime_type
        FROM docs
        WHERE
          visibility = 'all_members'
          OR owner_email = $1
          OR (visibility = 'specific_members' AND visible_to_members IS NOT NULL AND visible_to_members @> $2::jsonb)
        ORDER BY created_at DESC
      `, [normalizedEmail, JSON.stringify([normalizedEmail])]);
    } catch (error: any) {
      // If metadata column doesn't exist, query without it
      if (error.message?.includes('column "metadata" does not exist') || error.message?.includes('column docs.metadata does not exist')) {
        result = await pool.query(`
          SELECT
            id,
            title,
            content,
            owner_email,
            project_id,
            team_id,
            folder_id,
            is_folder,
            tags,
            visibility,
            visible_to_members,
            created_at,
            updated_at
          FROM docs
          WHERE
            visibility = 'all_members'
            OR owner_email = $1
            OR (visibility = 'specific_members' AND visible_to_members IS NOT NULL AND visible_to_members @> $2::jsonb)
          ORDER BY created_at DESC
        `, [normalizedEmail, JSON.stringify([normalizedEmail])]);
      } else {
        throw error;
      }
    }
    
    console.log(`📚 GET /api/docs - Returning ${result.rows.length} docs for org ${orgId} (user: ${userEmail})`);
    
    // Helper function to safely parse JSONB fields
    const parseJsonbField = (value: any): any => {
      if (value === null || value === undefined) {
        return [];
      }
      if (Array.isArray(value)) {
        return value;
      }
      if (typeof value === 'object') {
        return value;
      }
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return [];
        }
      }
      return [];
    };

    // Helper function to safely parse metadata JSONB field
    const parseMetadata = (value: any): any => {
      if (value === null || value === undefined) {
        return {};
      }
      if (typeof value === 'object') {
        return value;
      }
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return {};
        }
      }
      return {};
    };
    
    // Transform to camelCase
    const transformed = result.rows.map(row => {
      try {
        const doc = transformRow(row);
        // PostgreSQL JSONB fields are already parsed, but handle both cases
        doc.tags = parseJsonbField(doc.tags);
        doc.visibleToMembers = parseJsonbField(doc.visibleToMembers);
        // Metadata might not exist if column doesn't exist yet
        doc.metadata = doc.metadata !== undefined ? parseMetadata(doc.metadata) : {};
        doc.createdAt = doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString();
        doc.updatedAt = doc.updatedAt ? new Date(doc.updatedAt).toISOString() : new Date().toISOString();
        return doc;
      } catch (transformError) {
        console.error(`Error transforming doc row:`, transformError, row);
        throw transformError;
      }
    });
    
    res.json(transformed);
  } catch (error) {
    console.error('❌ Get docs error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('Error details:', { errorMessage, errorStack, orgId: (req as any).orgId, userEmail: (req as any).userEmail });
    res.status(500).json({ error: errorMessage });
  }
});

app.get('/api/docs/:id', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const docId = req.params.id;
    
    if (!orgId) {
      return res.status(400).json({ error: 'Organization ID is required' });
    }
    
    if (!userEmail) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    const pool = await getOrgPool(orgId);
    const normalizedEmail = userEmail.toLowerCase();
    
    // Helper function to safely parse JSONB fields
    const parseJsonbField = (value: any): any => {
      if (value === null || value === undefined) {
        return [];
      }
      if (Array.isArray(value)) {
        return value;
      }
      if (typeof value === 'object') {
        return value;
      }
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return [];
        }
      }
      return [];
    };

    // Helper function to safely parse metadata JSONB field
    const parseMetadata = (value: any): any => {
      if (value === null || value === undefined) {
        return {};
      }
      if (typeof value === 'object') {
        return value;
      }
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return {};
        }
      }
      return {};
    };
    
    // Get doc and check visibility
    let result;
    try {
      result = await pool.query(`
        SELECT
          id,
          title,
          content,
          owner_email,
          project_id,
          team_id,
          folder_id,
          is_folder,
          tags,
          COALESCE(metadata, '{}'::jsonb) as metadata,
          visibility,
          visible_to_members,
          created_at,
          updated_at,
          doc_type,
          storage_path,
          file_metadata,
          processing_status,
          file_size,
          mime_type
        FROM docs
        WHERE id = $1
      `, [docId]);
    } catch (error: any) {
      // If metadata column doesn't exist, query without it
      if (error.message?.includes('column "metadata" does not exist') || error.message?.includes('column docs.metadata does not exist')) {
        result = await pool.query(`
          SELECT
            id,
            title,
            content,
            owner_email,
            project_id,
            team_id,
            folder_id,
            is_folder,
            tags,
            visibility,
            visible_to_members,
            created_at,
            updated_at
          FROM docs
          WHERE id = $1
        `, [docId]);
      } else {
        throw error;
      }
    }
    
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
      const visibleToMembers = parseJsonbField(row.visible_to_members);
      hasAccess = isOwner || (Array.isArray(visibleToMembers) && visibleToMembers.includes(normalizedEmail));
    }
    
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this document' });
    }
    
    const doc = transformRow(row);
    doc.tags = parseJsonbField(doc.tags);
    doc.visibleToMembers = parseJsonbField(doc.visibleToMembers);
    // Metadata might not exist if column doesn't exist yet
    doc.metadata = doc.metadata !== undefined ? parseMetadata(doc.metadata) : {};
    doc.createdAt = doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString();
    doc.updatedAt = doc.updatedAt ? new Date(doc.updatedAt).toISOString() : new Date().toISOString();

    // Check if HTML format is requested
    const format = req.query.format as string;
    if (format === 'html' && doc.content) {
      console.log('🔄 [API] Converting document content to HTML format');
      try {
        const conversionResult = await convertJsonToHtmlWithPositions(doc.content);
        doc.content = conversionResult.html;
        doc.format = 'html';

        console.log('✅ [API] Document converted to HTML format');
      } catch (conversionError) {
        console.error('❌ [API] Failed to convert document to HTML:', conversionError);
        // Fall back to JSON format if conversion fails
        doc.format = 'json';
      }
    } else {
      doc.format = 'json';
    }

    res.json(doc);
  } catch (error) {
    console.error('❌ Get doc error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('Error details:', { errorMessage, errorStack, docId: req.params.id, orgId: (req as any).orgId, userEmail: (req as any).userEmail });
    res.status(500).json({ error: errorMessage });
  }
});

app.post('/api/docs', authenticateUser, requireOrgMembership, validateRequest(createDocSchema), async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const pool = await getOrgPool(orgId);
    
    const { id, title, content, projectId, teamId, folderId, isFolder, tags, visibility, visibleToMembers, metadata } = req.body;
    
    // Validation is handled by middleware, so visibility and visibleToMembers are already validated
    const docVisibility = visibility || 'all_members';
    const visibleToMembersArray = (docVisibility === 'specific_members' && visibleToMembers)
      ? visibleToMembers.map((email: string) => email.toLowerCase())
      : [];
    
    const normalizedEmail = userEmail.toLowerCase();
    const docId = id || crypto.randomBytes(16).toString('hex');
    
    // Handle content based on whether this is a folder or document
    let docContent = content;
    if (isFolder) {
      // Folders have empty content
      docContent = '{}';
    } else if (!content || content.trim().length === 0) {
      // Regular documents get default TipTap empty structure
      docContent = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
    }
    
    // Check if metadata column exists, if not, insert without it
    try {
      await pool.query(`
        INSERT INTO docs (id, title, content, owner_email, project_id, team_id, folder_id, is_folder, tags, metadata, visibility, visible_to_members, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      `, [
        docId,
        title,
        docContent,
        normalizedEmail,
        projectId || null,
        teamId || null,
        folderId || null,
        isFolder || false,
        tags ? JSON.stringify(tags) : '[]',
        metadata ? JSON.stringify(metadata) : '{}',
        docVisibility,
        JSON.stringify(visibleToMembersArray)
      ]);
    } catch (error: any) {
      // If metadata column doesn't exist, insert without it
      if (error.message?.includes('column "metadata" does not exist')) {
        await pool.query(`
          INSERT INTO docs (id, title, content, owner_email, project_id, team_id, folder_id, is_folder, tags, visibility, visible_to_members, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        `, [
          docId,
          title,
          docContent,
          normalizedEmail,
          projectId || null,
          teamId || null,
          folderId || null,
          isFolder || false,
          tags ? JSON.stringify(tags) : '[]',
          docVisibility,
          JSON.stringify(visibleToMembersArray)
        ]);
      } else {
        throw error;
      }
    }
    
    res.status(201).json({
      id: docId,
      title,
      content: docContent,
      ownerEmail: normalizedEmail,
      projectId: projectId || null,
      teamId: teamId || null,
      folderId: folderId || null,
      isFolder: isFolder || false,
      tags: tags || [],
      visibility: docVisibility,
      visibleToMembers: visibleToMembersArray
    });
  } catch (error) {
    console.error('Create doc error:', error);
    // Check if it's a database constraint error
    if ((error as any).code === '23514' || (error as any).code === '23505') {
      return res.status(400).json({ 
        error: 'Database constraint violation',
        details: { message: (error as Error).message }
      });
    }
    res.status(500).json({ error: (error as Error).message });
  }
});

app.patch('/api/docs/:id', authenticateUser, requireOrgMembership, validateRequest(updateDocSchema), async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const docId = req.params.id;
    const updates = req.body;
    const pool = await getOrgPool(orgId);
    const normalizedEmail = userEmail.toLowerCase();
    
    // Helper function to safely parse JSONB fields
    const parseJsonbField = (value: any): any => {
      if (value === null || value === undefined) {
        return [];
      }
      if (Array.isArray(value)) {
        return value;
      }
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return [];
        }
      }
      return [];
    };
    
    // Verify doc exists and user has access to edit
    const checkResult = await pool.query(
      'SELECT id, owner_email, visibility, visible_to_members FROM docs WHERE id = $1',
      [docId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Doc not found' });
    }
    
    const doc = checkResult.rows[0];
    const isOwner = doc.owner_email?.toLowerCase() === normalizedEmail;
    const docVisibility = doc.visibility || 'all_members';
    
    // Check if user has access to edit based on visibility
    let hasEditAccess = isOwner || docVisibility === 'all_members';
    
    if (docVisibility === 'specific_members') {
      const visibleToMembers = parseJsonbField(doc.visible_to_members);
      const normalizedVisibleToMembers = Array.isArray(visibleToMembers) 
        ? visibleToMembers.map((email: string) => email?.toLowerCase())
        : [];
      hasEditAccess = isOwner || normalizedVisibleToMembers.includes(normalizedEmail);
    }
    
    if (!hasEditAccess) {
      return res.status(403).json({ error: 'You do not have permission to edit this document' });
    }
    
    // Check if user is trying to CHANGE visibility - only owners can do this
    // Allow non-owners to include visibility fields if they're not changing
    if (updates.visibility !== undefined || updates.visibleToMembers !== undefined) {
      const currentVisibility = doc.visibility || 'all_members';
      const currentVisibleToMembers = parseJsonbField(doc.visible_to_members);
      const newVisibility = updates.visibility !== undefined ? updates.visibility : currentVisibility;
      const newVisibleToMembers = updates.visibleToMembers !== undefined 
        ? (Array.isArray(updates.visibleToMembers) ? updates.visibleToMembers.map((e: string) => e?.toLowerCase()) : [])
        : currentVisibleToMembers;
      
      const visibilityChanged = newVisibility !== currentVisibility;
      const visibleToMembersChanged = JSON.stringify(newVisibleToMembers.sort()) !== JSON.stringify(Array.isArray(currentVisibleToMembers) ? currentVisibleToMembers.map((e: string) => e?.toLowerCase()).sort() : []);
      
      if ((visibilityChanged || visibleToMembersChanged) && !isOwner) {
        return res.status(403).json({ error: 'Only the document owner can update visibility settings' });
      }
      
      // If visibility is not changing, remove it from updates to avoid unnecessary checks
      if (!visibilityChanged && !isOwner) {
        delete updates.visibility;
      }
      if (!visibleToMembersChanged && !isOwner) {
        delete updates.visibleToMembers;
      }
    }

    // Additional validation for folder operations
    if (updates.folderId !== undefined) {
      // Check for circular references if moving a folder
      const currentDocResult = await pool.query(
        'SELECT is_folder FROM docs WHERE id = $1',
        [docId]
      );

      if (currentDocResult.rows.length > 0 && currentDocResult.rows[0].is_folder) {
        // This is a folder being moved - check for circular references
        let targetFolderId = updates.folderId;
        const visitedFolders = new Set([docId]);

        while (targetFolderId) {
          if (visitedFolders.has(targetFolderId)) {
            return res.status(400).json({
              error: 'Cannot move folder: circular reference detected'
            });
          }

          visitedFolders.add(targetFolderId);
          const parentResult = await pool.query(
            'SELECT folder_id FROM docs WHERE id = $1',
            [targetFolderId]
          );

          if (parentResult.rows.length > 0) {
            targetFolderId = parentResult.rows[0].folder_id;
          } else {
            targetFolderId = null;
          }
        }
      }
    }

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    
    const fieldMap: { [key: string]: string } = {
      title: 'title',
      content: 'content',
      projectId: 'project_id',
      teamId: 'team_id',
      folderId: 'folder_id',
      isFolder: 'is_folder',
      visibility: 'visibility'
    };
    
    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'id' && fieldMap[key]) {
        const dbField = fieldMap[key];
        // Visibility is already validated by schema
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
      } else if (key === 'metadata' && typeof value === 'object') {
        setClauses.push(`metadata = $${paramIndex}::jsonb`);
        values.push(JSON.stringify(value));
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
    // Check if it's a database constraint error
    if ((error as any).code === '23514' || (error as any).code === '23505') {
      return res.status(400).json({ 
        error: 'Database constraint violation',
        details: { message: (error as Error).message }
      });
    }
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

// Share doc via email
app.post('/api/docs/:docId/share', authenticateUser, requireOrgMembership, validateRequest(docShareSchema), async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const docId = req.params.docId;
    const { email: recipientEmail, message } = req.body;
    const pool = await getOrgPool(orgId);
    const sharedPool = await getSharedPool();
    const normalizedEmail = userEmail.toLowerCase();

    // Validation handled by middleware
    const normalizedRecipientEmail = recipientEmail.toLowerCase();

    // Get doc details and verify ownership/permission
    let docResult;
    try {
      docResult = await pool.query(`
        SELECT id, title, owner_email, visibility, visible_to_members, COALESCE(metadata, '{}'::jsonb) as metadata
        FROM docs WHERE id = $1
      `, [docId]);
    } catch (error: any) {
      if (error.message?.includes('column "metadata" does not exist')) {
        docResult = await pool.query(`
          SELECT id, title, owner_email, visibility, visible_to_members
          FROM docs WHERE id = $1
        `, [docId]);
      } else {
        throw error;
      }
    }

    if (docResult.rows.length === 0) {
      return res.status(404).json({ error: 'Doc not found' });
    }

    const doc = docResult.rows[0];
    const isOwner = doc.owner_email?.toLowerCase() === normalizedEmail;

    // Check if user has permission to share (owner or has edit access)
    if (!isOwner) {
      const docVisibility = doc.visibility || 'all_members';
      let hasEditAccess = docVisibility === 'all_members';
      
      if (docVisibility === 'specific_members') {
        const visibleToMembers = doc.visible_to_members ? 
          (Array.isArray(doc.visible_to_members) ? doc.visible_to_members : JSON.parse(doc.visible_to_members)) : [];
        const normalizedVisibleToMembers = Array.isArray(visibleToMembers) 
          ? visibleToMembers.map((email: string) => email?.toLowerCase())
          : [];
        hasEditAccess = normalizedVisibleToMembers.includes(normalizedEmail);
      }

      if (!hasEditAccess) {
        return res.status(403).json({ error: 'You do not have permission to share this document' });
      }
    }

    // Get org info
    const orgResult = await sharedPool.query('SELECT name, slug FROM organizations WHERE id = $1', [orgId]);
    const orgName = orgResult.rows[0]?.name || 'Unknown Organization';
    const orgSlug = orgResult.rows[0]?.slug;

    // Get sharer's name
    const sharerResult = await sharedPool.query(
      'SELECT first_name, last_name FROM users WHERE email = $1',
      [userEmail]
    );
    const sharerData = sharerResult.rows[0] || {};
    const sharerName = sharerData.first_name && sharerData.last_name
      ? `${sharerData.first_name} ${sharerData.last_name}`
      : sharerData.first_name || sharerData.last_name || userEmail.split('@')[0];

    // Check if recipient is already an org member
    const memberCheck = await sharedPool.query(
      'SELECT 1 FROM org_members WHERE org_id = $1 AND user_email = $2',
      [orgId, normalizedRecipientEmail]
    );

    const isExistingMember = memberCheck.rows.length > 0;

    if (isExistingMember) {
      // Add to doc's visibleToMembers if not already there
      const currentVisibleToMembers = doc.visible_to_members ? 
        (Array.isArray(doc.visible_to_members) ? doc.visible_to_members : JSON.parse(doc.visible_to_members)) : [];
      
      const normalizedCurrentVisible = Array.isArray(currentVisibleToMembers) 
        ? currentVisibleToMembers.map((email: string) => email?.toLowerCase())
        : [];

      if (!normalizedCurrentVisible.includes(normalizedRecipientEmail)) {
        // Add recipient to visibleToMembers
        const updatedVisibleToMembers = [...currentVisibleToMembers, normalizedRecipientEmail];
        
        // Update doc visibility to 'specific_members' if currently 'all_members'
        const newVisibility = doc.visibility === 'all_members' ? 'specific_members' : doc.visibility;

        await pool.query(`
          UPDATE docs 
          SET visible_to_members = $1::jsonb,
              visibility = $2,
              updated_at = NOW()
          WHERE id = $3
        `, [JSON.stringify(updatedVisibleToMembers), newVisibility, docId]);
      }

      // Get recipient's name
      let recipientName = normalizedRecipientEmail.split('@')[0];
      try {
        const recipientResult = await sharedPool.query(
          'SELECT first_name, last_name FROM users WHERE email = $1',
          [normalizedRecipientEmail]
        );
        if (recipientResult.rows.length > 0) {
          const recipientData = recipientResult.rows[0];
          if (recipientData.first_name || recipientData.last_name) {
            recipientName = [recipientData.first_name, recipientData.last_name].filter(Boolean).join(' ') || recipientName;
          }
        }
      } catch (err) {
        console.warn('Could not fetch recipient name:', err);
      }

      // Send notification email
      try {
        await sendDocShareNotificationEmail(
          secretManagerClient,
          serviceAccount.project_id,
          normalizedRecipientEmail,
          recipientName,
          sharerName,
          doc.title,
          docId,
          orgSlug || '',
          message || undefined
        );
        console.log(`✅ Doc share notification email sent to ${normalizedRecipientEmail}`);
      } catch (emailError: any) {
        console.error(`⚠️ Failed to send doc share notification email to ${normalizedRecipientEmail}:`, emailError.message);
        // Don't fail the request if email fails
      }

      res.json({
        success: true,
        isNewMember: false,
        message: 'Document shared successfully',
      });
    } else {
      // Not an org member - create/update invitation
      const existingInvite = await sharedPool.query(
        "SELECT id FROM org_invitations WHERE org_id = $1 AND invitee_email = $2 AND status = 'pending'",
        [orgId, normalizedRecipientEmail]
      );

      let invitation;
      if (existingInvite.rows.length > 0) {
        // Update existing invitation
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
        // Create new invitation
        const token = crypto.randomBytes(32).toString('hex');

        const result = await sharedPool.query(`
          INSERT INTO org_invitations (org_id, invitee_email, inviter_email, message, token, created_at, expires_at)
          VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + INTERVAL '7 days')
          RETURNING id, org_id, invitee_email, inviter_email, status, created_at, expires_at
        `, [orgId, normalizedRecipientEmail, userEmail, message || null, token]);

        invitation = result.rows[0];
      }

      // Get invitee's name (if they have an account)
      let inviteeName = normalizedRecipientEmail.split('@')[0];
      try {
        const inviteeResult = await sharedPool.query(
          'SELECT first_name, last_name FROM users WHERE email = $1',
          [normalizedRecipientEmail]
        );
        if (inviteeResult.rows.length > 0) {
          const inviteeData = inviteeResult.rows[0];
          if (inviteeData.first_name || inviteeData.last_name) {
            inviteeName = [inviteeData.first_name, inviteeData.last_name].filter(Boolean).join(' ') || inviteeName;
          }
        }
      } catch (err) {
        console.warn('Could not fetch invitee name:', err);
      }

      // Send invitation email with doc context
      try {
        await sendDocShareInvitationEmail(
          secretManagerClient,
          serviceAccount.project_id,
          normalizedRecipientEmail,
          inviteeName,
          sharerName,
          orgName,
          doc.title,
          invitation.id,
          message || undefined
        );
        console.log(`✅ Doc share invitation email sent to ${normalizedRecipientEmail}`);
      } catch (emailError: any) {
        console.error(`⚠️ Failed to send doc share invitation email to ${normalizedRecipientEmail}:`, emailError.message);
        // Don't fail the request if email fails
      }

      res.json({
        success: true,
        isNewMember: true,
        message: 'Invitation sent successfully',
      });
    }
  } catch (error) {
    console.error('Share doc error:', error);
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
    
    // Extract query parameters
    const status = req.query.status as string | undefined;
    const priority = req.query.priority as string | undefined;
    const assignee = req.query.assignee as string | undefined;
    const projectId = req.query.projectId as string | undefined;
    const createdAfter = req.query.createdAfter as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const sortBy = req.query.sortBy as string | undefined;
    const sortOrder = (req.query.sortOrder as string | undefined)?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    
    // Build WHERE conditions
    const whereConditions: string[] = [];
    const queryParams: any[] = [userEmail.toLowerCase(), JSON.stringify([userEmail.toLowerCase()])];
    let paramIndex = 3;
    
    // Base visibility conditions
    whereConditions.push(`(
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
    )`);
    
    // Add filter conditions
    if (status) {
      whereConditions.push(`t.status = $${paramIndex}`);
      queryParams.push(status);
      paramIndex++;
    }
    
    if (priority) {
      whereConditions.push(`t.priority = $${paramIndex}`);
      queryParams.push(priority);
      paramIndex++;
    }
    
    if (assignee) {
      whereConditions.push(`t.assignee_id = $${paramIndex}`);
      queryParams.push(assignee.toLowerCase());
      paramIndex++;
    }
    
    if (projectId) {
      whereConditions.push(`t.project_id = $${paramIndex}`);
      queryParams.push(projectId);
      paramIndex++;
    }
    
    if (createdAfter) {
      whereConditions.push(`(t.created_date >= $${paramIndex}::date OR (t.created_date IS NULL AND t.created_at >= $${paramIndex}::timestamp))`);
      queryParams.push(createdAfter);
      paramIndex++;
    }
    
    // Build ORDER BY clause
    let orderByClause = '';
    if (sortBy) {
      const validSortFields: { [key: string]: string } = {
        'status': 't.status',
        'priority': 't.priority',
        'createdAt': 't.created_at',
        'createdDate': 't.created_date',
        'dueDate': 't.due_date',
        'title': 't.title',
        'assignee': 't.assignee_id'
      };
      const sortField = validSortFields[sortBy] || 't.created_at';
      orderByClause = `ORDER BY ${sortField} ${sortOrder}`;
    } else {
      // Default ordering
      orderByClause = `ORDER BY 
        CASE t.status
          WHEN 'todo' THEN 1
          WHEN 'in-progress' THEN 2
          WHEN 'review' THEN 3
          WHEN 'blocked' THEN 4
          WHEN 'completed' THEN 5
          ELSE 6
        END,
        t.created_at DESC`;
    }
    
    // Build LIMIT clause
    const limitClause = limit ? `LIMIT $${paramIndex}` : '';
    if (limit) {
      queryParams.push(limit);
    }
    
    const whereClause = whereConditions.join(' AND ');
    
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
      WHERE ${whereClause}
      ${orderByClause}
      ${limitClause}
    `, queryParams);
    
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

app.post('/api/tasks', authenticateUser, requireOrgMembership, validateRequest(createTaskSchema), async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const { title, description, projectId, projectName, assigneeId, assignee, assigneeAvatar, status, priority, dueDate, tags, reason, estimatedHours, visibility, visibleToMembers } = req.body;
    
    // Validation is handled by middleware, so visibility and visibleToMembers are already validated
    const taskVisibility = visibility || 'all_members';
    const visibleToMembersArray = (taskVisibility === 'specific_members' && visibleToMembers) 
      ? visibleToMembers.map((email: string) => email.toLowerCase())
      : [];
    
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
    
    // Use createdDate from request or default to today
    const createdDate = req.body.createdDate || new Date().toISOString().split('T')[0];
    const createdAt = req.body.createdAt || Date.now();
    
    await pool.query(`
      INSERT INTO tasks (
        id, title, description, project_id, project_name, assignee_id, assignee_name, assignee_avatar, status, 
        priority, due_date, created_by, created_at, created_date, tags, reason, estimated_hours, visibility, visible_to_members
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    `, [
      taskId, 
      title, 
      description || null, 
      projectId || null,
      finalProjectName || null,
      assigneeId || null,
      finalAssignee || null,
      finalAssigneeAvatar || null,
      status || 'todo',
      priority || 'medium',
      dueDate || null,
      userEmail,
      createdAt,
      createdDate,
      tags && tags.length > 0 ? JSON.stringify(tags) : null,
      reason || null,
      estimatedHours || null,
      taskVisibility,
      JSON.stringify(visibleToMembersArray)
    ]);
    
    // Emit event to the platform event bus
    emitEvent(
      EventTypes.TASK_CREATED,
      'task', taskId, orgId, 'human', userEmail,
      { title, status: status || 'todo', projectId, assigneeId, priority: priority || 'medium' },
      extractMentions(description)
    ).catch(err => console.error('[Event Bus] Task created event error:', err));

    res.status(201).json({ id: taskId, title, description, projectId, assigneeId, status, priority });
  } catch (error) {
    console.error('Create task error:', error);
    // Check if it's a database constraint error
    if ((error as any).code === '23514' || (error as any).code === '23505') {
      return res.status(400).json({ 
        error: 'Database constraint violation',
        details: { message: (error as Error).message }
      });
    }
    res.status(500).json({ error: (error as Error).message });
  }
});

app.put('/api/tasks/:id', authenticateUser, requireOrgMembership, validateRequest(fullUpdateTaskSchema), async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const taskId = req.params.id;
    const updates = req.body;
    const pool = await getOrgPool(orgId);
    
    // Check if task exists
    const taskCheck = await pool.query(
      'SELECT created_by FROM tasks WHERE id = $1',
      [taskId]
    );
    
    if (taskCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Check if user is trying to update visibility - only creators can do this
    if (updates.visibility !== undefined || updates.visibleToMembers !== undefined) {
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
      projectName: 'project_name',
      assigneeId: 'assignee_id',
      assignee: 'assignee_name',
      assigneeName: 'assignee_name',
      assigneeAvatar: 'assignee_avatar',
      status: 'status',
      priority: 'priority',
      dueDate: 'due_date',
      createdDate: 'created_date',
      estimatedHours: 'estimated_hours',
      actualHours: 'actual_hours',
      reason: 'reason'
    };
    
    // Handle visibility separately (already validated by schema)
    if (updates.visibility !== undefined) {
      const taskVisibility = updates.visibility;
      setClauses.push(`visibility = $${paramIndex}`);
      values.push(taskVisibility);
      paramIndex++;
      
      // Handle visibleToMembers (already validated by schema)
      if (taskVisibility === 'specific_members') {
        const visibleToMembersArray = updates.visibleToMembers.map((email: string) => email.toLowerCase());
        setClauses.push(`visible_to_members = $${paramIndex}`);
        values.push(JSON.stringify(visibleToMembersArray));
        paramIndex++;
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
          paramIndex++;
        } else if (value !== undefined && value !== null) {
          setClauses.push(`${dbField} = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }
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
    
    // Emit event
    emitEvent(
      updates.status !== undefined ? EventTypes.TASK_STATUS_CHANGED : EventTypes.TASK_UPDATED,
      'task', taskId, orgId, 'human', userEmail,
      { updatedFields: Object.keys(updates), ...updates },
      extractMentions(updates.description)
    ).catch(err => console.error('[Event Bus] Task updated event error:', err));

    res.json({ success: true });
  } catch (error) {
    console.error('Update task error:', error);
    // Check if it's a database constraint error
    if ((error as any).code === '23514' || (error as any).code === '23505') {
      return res.status(400).json({ 
        error: 'Database constraint violation',
        details: { message: (error as Error).message }
      });
    }
    res.status(500).json({ error: (error as Error).message });
  }
});

app.patch('/api/tasks/:id', authenticateUser, requireOrgMembership, validateRequest(updateTaskSchema), async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const taskId = req.params.id;
    const updates = req.body;
    console.log('📝 PATCH /api/tasks/:id - Received updates:', {
      taskId,
      updates,
      updateKeys: Object.keys(updates),
      updateValues: Object.entries(updates).map(([k, v]) => `${k}=${v}`)
    });
    const pool = await getOrgPool(orgId);
    
    // Check if task exists
    const taskCheck = await pool.query(
      'SELECT created_by FROM tasks WHERE id = $1',
      [taskId]
    );
    
    if (taskCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Check if user is trying to update visibility - only creators can do this
    if (updates.visibility !== undefined || updates.visibleToMembers !== undefined) {
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
      projectName: 'project_name',
      assigneeId: 'assignee_id',
      assignee: 'assignee_name',
      assigneeName: 'assignee_name',
      assigneeAvatar: 'assignee_avatar',
      assigneeType: 'assignee_type',
      status: 'status',
      priority: 'priority',
      dueDate: 'due_date',
      createdDate: 'created_date',
      estimatedHours: 'estimated_hours',
      actualHours: 'actual_hours',
      reason: 'reason'
    };
    
    // Handle visibility separately (already validated by schema)
    if (updates.visibility !== undefined) {
      const taskVisibility = updates.visibility;
      setClauses.push(`visibility = $${paramIndex}`);
      values.push(taskVisibility);
      paramIndex++;
      
      // Handle visibleToMembers (already validated by schema)
      if (taskVisibility === 'specific_members') {
        const visibleToMembersArray = updates.visibleToMembers.map((email: string) => email.toLowerCase());
        setClauses.push(`visible_to_members = $${paramIndex}`);
        values.push(JSON.stringify(visibleToMembersArray));
        paramIndex++;
      } else {
        setClauses.push(`visible_to_members = $${paramIndex}`);
        values.push(JSON.stringify([]));
        paramIndex++;
      }
    }
    
    // Handle AI agent assignment
    let agentAssignmentData:
      | { type: 'ai_agent'; agentIds: string[] }
      | { type: 'ai_team'; agentTeamId: string }
      | null = null;
    if (updates.assigneeType) {
      setClauses.push(`assignee_type = $${paramIndex}`);
      values.push(updates.assigneeType);
      paramIndex++;

      if (updates.assigneeType === 'ai_agent') {
        const rawAgentIds: string[] = Array.isArray(updates.agentIds) && updates.agentIds.length > 0
          ? updates.agentIds.filter((id: unknown): id is string => typeof id === 'string')
          : updates.agentId
          ? [String(updates.agentId)]
          : [];
        const uniqueAgentIds = Array.from(new Set(rawAgentIds.filter(Boolean)));
        agentAssignmentData = {
          type: 'ai_agent',
          agentIds: uniqueAgentIds,
        };
        // Clear human assignee fields
        setClauses.push(`assignee_id = NULL, assignee_name = NULL, assignee_avatar = NULL`);
      } else if (updates.assigneeType === 'ai_team' && updates.agentTeamId) {
        agentAssignmentData = {
          type: 'ai_team',
          agentTeamId: updates.agentTeamId,
        };
        // Clear human assignee fields
        setClauses.push(`assignee_id = NULL, assignee_name = NULL, assignee_avatar = NULL`);
      } else if (updates.assigneeType === 'human') {
        // Assigning to human - clear AI fields by not setting them
      }
    }

    Object.entries(updates).forEach(([key, value]) => {
      if (key === 'agentId' || key === 'agentTeamId' || key === 'agentIds') {
        return;
      }
      if (key !== 'id' && key !== 'visibility' && key !== 'visibleToMembers' && fieldMap[key]) {
        const dbField = fieldMap[key];
        // Handle tags as JSONB
        if (key === 'tags' && Array.isArray(value)) {
          setClauses.push(`tags = $${paramIndex}::jsonb`);
          values.push(JSON.stringify(value));
          console.log(`  ✅ Adding field: ${key} -> ${dbField} = ${JSON.stringify(value)}`);
          paramIndex++;
        } else if (value !== undefined && value !== null) {
          setClauses.push(`${dbField} = $${paramIndex}`);
          values.push(value);
          console.log(`  ✅ Adding field: ${key} -> ${dbField} = ${value}`);
          paramIndex++;
        } else {
          console.log(`  ⏭️ Skipping field: ${key} (value is null/undefined)`);
        }
      } else if (fieldMap[key]) {
        console.log(`  🚫 Skipping field: ${key} (reserved/ignored)`);
      } else {
        console.log(`  ❌ Unmapped field: ${key}`);
      }
    });
    
    if (setClauses.length === 0) {
      console.log('⚠️ No fields to update after processing');
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    setClauses.push(`updated_at = NOW()`);
    values.push(taskId);
    
    await pool.query(`
      UPDATE tasks 
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
    `, values);
    
    // If AI agent assignment, create task_ai_assignments record and notify agent
    if (agentAssignmentData) {
      try {
        const now = new Date();

        if (agentAssignmentData.type === 'ai_agent') {
          let agentIds = agentAssignmentData.agentIds;
          if (agentIds.length === 0) {
            const autoAgent = await pool.query(
              `SELECT id FROM ai_agents WHERE status = 'active' ORDER BY created_at ASC LIMIT 1`
            );
            if (autoAgent.rows.length > 0) {
              agentIds = [autoAgent.rows[0].id];
            }
          }

          if (agentIds.length > 0) {
            const taskDetails = await pool.query(
              'SELECT id, title, description, priority, due_date FROM tasks WHERE id = $1',
              [taskId]
            );
            const task = taskDetails.rows[0];

            for (const agentId of agentIds) {
              const assignmentId = `taa_${crypto.randomBytes(8).toString('hex')}`;
              await pool.query(
                `INSERT INTO task_ai_assignments 
                 (id, task_id, agent_id, status, assigned_at, created_at, updated_at)
                 VALUES ($1, $2, $3, 'pending', $4, $5, $6)`,
                [assignmentId, taskId, agentId, now, now, now]
              );

              if (task) {
                try {
                  await notifyAgentOfAssignment(
                    orgId,
                    agentId,
                    taskId,
                    assignmentId,
                    {
                      id: task.id,
                      title: task.title,
                      description: task.description,
                      priority: task.priority,
                      dueDate: task.due_date,
                    }
                  );
                } catch (notifyError) {
                  console.error('[Backend] Error notifying agent:', notifyError);
                  // Don't fail the request if notification fails
                }
              }
            }
          }
        } else if (agentAssignmentData.type === 'ai_team') {
          const assignmentId = `taa_${crypto.randomBytes(8).toString('hex')}`;
          await pool.query(
            `INSERT INTO task_ai_assignments 
             (id, task_id, agent_team_id, status, assigned_at, created_at, updated_at)
             VALUES ($1, $2, $3, 'pending', $4, $5, $6)`,
            [assignmentId, taskId, agentAssignmentData.agentTeamId, now, now, now]
          );

          // Get team members and notify each agent
          const teamMembers = await pool.query(
            `SELECT agent_id FROM ai_agent_team_members 
             WHERE team_id = $1 
             ORDER BY priority DESC`,
            [agentAssignmentData.agentTeamId]
          );

          const taskDetails = await pool.query(
            'SELECT id, title, description, priority, due_date FROM tasks WHERE id = $1',
            [taskId]
          );

          if (taskDetails.rows.length > 0 && teamMembers.rows.length > 0) {
            const task = taskDetails.rows[0];
            const firstAgent = teamMembers.rows[0];
            // Notify the first agent in the team
            try {
              await notifyAgentOfAssignment(
                orgId,
                firstAgent.agent_id,
                taskId,
                assignmentId,
                {
                  id: task.id,
                  title: task.title,
                  description: task.description,
                  priority: task.priority,
                  dueDate: task.due_date,
                }
              );
            } catch (notifyError) {
              console.error('[Backend] Error notifying agent team:', notifyError);
              // Don't fail the request if notification fails
            }
          }
        }
      } catch (error: any) {
        console.error('[Backend] Error creating AI assignment:', error);
        // Don't fail the request if assignment creation fails
      }
    }

    // Emit event
    const eventType = agentAssignmentData ? EventTypes.TASK_ASSIGNED
      : updates.status !== undefined ? EventTypes.TASK_STATUS_CHANGED
      : EventTypes.TASK_UPDATED;
    emitEvent(
      eventType, 'task', taskId, orgId, 'human', userEmail,
      { updatedFields: Object.keys(updates), assigneeType: updates.assigneeType, ...updates },
      extractMentions(updates.description)
    ).catch(err => console.error('[Event Bus] Task patch event error:', err));
    
    res.json({ success: true });
  } catch (error) {
    console.error('Update task error:', error);
    // Check if it's a database constraint error
    if ((error as any).code === '23514' || (error as any).code === '23505') {
      return res.status(400).json({ 
        error: 'Database constraint violation',
        details: { message: (error as Error).message }
      });
    }
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

    emitEvent(EventTypes.TASK_DELETED, 'task', taskId, orgId, 'human', userEmail)
      .catch(err => console.error('[Event Bus] Task deleted event error:', err));
    
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
      const role = req.query.role as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const orderBy = (req.query.orderBy as string | undefined)?.toLowerCase() === 'desc' ? 'desc' : 'asc';
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
    
    // Extract projectId for filtering (project channels only)
    let projectId: string | null = null;
    if (chatId.startsWith('project-')) {
      projectId = chatId.replace('project-', '');
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
      
      // Filter by role if provided
      if (role) {
        query = query.where('role', '==', role);
      }
      
      // Use a higher limit initially to allow filtering and sorting in memory
      query = query.limit(Math.max(limit, 500));
      
      const snapshot = await query.get();
      docs = Array.from(snapshot.docs);
      
    } catch (queryError: any) {
      // If query fails (e.g., missing index), fetch all and filter in memory
      if (queryError.code === 9 || queryError.message?.includes('index')) {
        console.warn('ChatId index missing, fetching all messages and filtering:', queryError.message);
        const snapshot = await db.collection(collectionPath)
          .limit(500) // Get more to filter
          .get();
        
        // Filter by chatId in memory (and userId for AI assistant conversations, projectId for channels)
        docs = Array.from(snapshot.docs).filter(doc => {
          const data = doc.data();
          const matchesChatId = data.chatId === chatId || (!data.chatId && chatId === 'general');
          
          // For AI assistant conversations, also check userId
          if (chatId.startsWith('ai-assistant-') && userEmail) {
            if (!matchesChatId || data.userId?.toLowerCase() !== userEmail) return false;
          }
          
          // For project channels, also check projectId
          if (projectId) {
            if (!matchesChatId || data.projectId !== projectId) return false;
          }
          
          // Filter by role if provided
          if (role && data.role !== role) {
            return false;
          }
          
          return matchesChatId;
        });
      } else {
        throw queryError;
      }
    }
    
    // Filter by afterTimestamp if provided
    if (afterTimestamp) {
      docs = docs.filter(doc => {
        const timestamp = doc.data().timestamp || 0;
        const timestampMs = typeof timestamp === 'number' 
          ? timestamp 
          : (timestamp.toDate?.()?.getTime() || 0);
        return timestampMs > afterTimestamp.getTime();
      });
    }
    
    // Sort by timestamp in memory
    docs.sort((a, b) => {
      const aTime = a.data().timestamp?.toDate?.()?.getTime() || 
                    (typeof a.data().timestamp === 'number' ? a.data().timestamp : 0);
      const bTime = b.data().timestamp?.toDate?.()?.getTime() || 
                    (typeof b.data().timestamp === 'number' ? b.data().timestamp : 0);
      return orderBy === 'desc' ? bTime - aTime : aTime - bTime;
    });
    
    // Apply limit
    docs = docs.slice(0, limit);
    
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
// CLEAR CHAT HISTORY ENDPOINT (Firestore Only)
// ============================================================================

// Handler for clear chat history (shared by both endpoints)
const clearChatHistoryHandler = async (req: any, res: any) => {
  try {
    const userEmail = (req as any).userEmail?.toLowerCase();
    const chatId = decodeURIComponent(req.params.chatId);

    // Only allow AI assistant chats
    if (!chatId.startsWith('ai-assistant-')) {
      return res.status(400).json({ error: 'Only AI assistant chats are supported' });
    }

    // Verify the user owns this chat (AI chats include user email)
    if (!chatId.endsWith(`-${userEmail}`)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
    const collectionPath = await getOrgCollectionPath('messages', orgId);

    // Delete all messages in the chat
    const chatQuery = db.collection(collectionPath).where('chatId', '==', chatId);
    const snapshot = await chatQuery.get();

    if (snapshot.empty) {
      return res.status(404).json({ error: 'Chat not found or already empty' });
    }

    // Delete messages in batches
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();

    console.log(`✅ Cleared ${snapshot.docs.length} messages from chat: ${chatId}`);
    res.json({
      success: true,
      message: `Cleared ${snapshot.docs.length} messages from chat history`,
      messagesDeleted: snapshot.docs.length
    });
  } catch (error) {
    console.error('Clear chat history error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
};

// DELETE /api/messages/clear/:chatId - Clear chat history
app.delete('/api/messages/clear/:chatId', authenticateUser, clearChatHistoryHandler);

// ============================================================================
// AI CHAT STREAMING ENDPOINT (Proxies to external AI service)
// ============================================================================

app.post('/api/messages/stream', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const { chatId, message, citedContext, orgId, orgSlug, imageUrls } = req.body;

    // Validate required fields
    if (!chatId || !message) {
      return res.status(400).json({ error: 'chatId and message are required' });
    }

    // Determine the external AI service URL
    const aiServiceBase = isLocalDev()
      ? process.env.AI_SERVICE_URL || 'http://0.0.0.0:8082'
      : process.env.AI_SERVICE_URL || 'http://ask-api:80';

    const aiServiceUrl = `${aiServiceBase}/api/ask`;

    // Prepare headers for the AI service request
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Use Bearer token for production, API key for local testing
    if (isLocalDev()) {
      // Local testing: use API key
      try {
        const apiKey = await getApiKeyFromSecretManager();
        headers['X-API-Key'] = apiKey;
      } catch (error) {
        console.error('Failed to get API key for streaming, request may fail:', error);
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

    // Check and increment AI usage BEFORE making the AI call
    const sharedPool = await getSharedPool();
    const usageCheck = await checkAndIncrementAiUsage(userEmail, sharedPool, false);
    if (!usageCheck.allowed) {
      return res.status(429).json({
        error: usageCheck.error,
        retryAfter: usageCheck.retryAfter
      });
    }

    // Prepare request payload for the Python ask API
    const requestPayload: any = {
      user_id: userEmail,
      org_slug: orgSlug,
      session_id: chatId,
      query: message,
      stream: true
    };

    if (citedContext) {
      requestPayload.cited_context = citedContext;
    }

    if (imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0) {
      requestPayload.images = imageUrls;
    }

    console.log(`🚀 [Streaming] Proxying to ${aiServiceUrl} for user ${userEmail}`);

    const abortController = new AbortController();
    req.on('close', () => {
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    });

    // Make streaming request to the Python ask API
    const aiResponse = await fetch(aiServiceUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestPayload),
      signal: abortController.signal,
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

    // Set up SSE headers for the response
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      'Connection': 'keep-alive',
    });

    // Stream the response from the Python ask API to the client
    const reader = aiResponse.body?.getReader();
    if (!reader) {
      return res.status(500).json({ error: 'No response body from AI service' });
    }

    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
      }
    } catch (error) {
      if (req.aborted || res.writableEnded) {
        // Client disconnected; avoid noisy logs and writes
      } else {
        console.error('Error streaming response:', error);
        // Try to send an error event if possible
        try {
          res.write(`data: ${JSON.stringify({ type: 'error', error: 'Stream interrupted' })}\n\n`);
        } catch {
          // Connection might already be closed
        }
      }
    } finally {
      res.end();
    }

  } catch (error) {
    console.error('Error in streaming endpoint:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? (error as Error).stack : undefined
    });
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

// Cache for GA4 Measurement ID to avoid repeated Secret Manager calls
let cachedGA4MeasurementId: string | null = null;
let ga4MeasurementIdCacheTime: number = 0;
const GA4_CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getApiKeyFromSecretManager(): Promise<string> {
  // Return cached key if still valid
  if (cachedApiKey && Date.now() - apiKeyCacheTime < API_KEY_CACHE_TTL) {
    return cachedApiKey;
  }

  try {
    const projectId = serviceAccount.project_id;
    const secretName = `projects/${projectId}/secrets/${getSecretName('api-key')}/versions/latest`;
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
    const secretName = `projects/${projectId}/secrets/${getSecretName('firebase-config')}/versions/latest`;
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
// GA4 CONFIG ENDPOINT (Secret Manager)
// ============================================================================

async function getGA4MeasurementIdFromSecretManager(): Promise<string | null> {
  // Return cached ID if still valid
  if (cachedGA4MeasurementId && Date.now() - ga4MeasurementIdCacheTime < GA4_CONFIG_CACHE_TTL) {
    return cachedGA4MeasurementId;
  }

  try {
    const projectId = serviceAccount.project_id;
    const secretName = `projects/${projectId}/secrets/${getSecretName('ga4-measurement-id')}/versions/latest`;
    const [version] = await secretManagerClient.accessSecretVersion({ name: secretName });
    
    // Get the raw data - it might be a Buffer or Uint8Array
    let measurementId: string;
    if (version.payload?.data) {
      if (Buffer.isBuffer(version.payload.data)) {
        measurementId = version.payload.data.toString('utf8');
      } else if (version.payload.data instanceof Uint8Array) {
        measurementId = Buffer.from(version.payload.data).toString('utf8');
      } else {
        measurementId = String(version.payload.data);
      }
    } else {
      throw new Error('GA4 Measurement ID secret has no data');
    }
    
    // Trim whitespace
    measurementId = measurementId.trim();
    
    // Validate format (should start with G-)
    if (!measurementId || !measurementId.startsWith('G-')) {
      throw new Error(`Invalid GA4 Measurement ID format: ${measurementId.substring(0, 20)}...`);
    }
    
    cachedGA4MeasurementId = measurementId;
    ga4MeasurementIdCacheTime = Date.now();
    return measurementId;
  } catch (error: any) {
    console.error('❌ Failed to fetch GA4 Measurement ID from Secret Manager:', error);
    
    // Fallback to environment variable
    const envMeasurementId = process.env.VITE_GA4_MEASUREMENT_ID || process.env.GA4_MEASUREMENT_ID;
    if (envMeasurementId && envMeasurementId.startsWith('G-')) {
      console.log('✅ Using GA4 Measurement ID from environment variable');
      cachedGA4MeasurementId = envMeasurementId.trim();
      ga4MeasurementIdCacheTime = Date.now();
      return cachedGA4MeasurementId;
    }
    
    // Return null if no valid measurement ID found
    console.warn('⚠️ No valid GA4 Measurement ID available');
    return null;
  }
}

// Endpoint to get GA4 Measurement ID (public endpoint, no auth required for client-side use)
app.get('/api/ga4-config', async (req, res) => {
  try {
    const measurementId = await getGA4MeasurementIdFromSecretManager();
    if (measurementId) {
      res.json({ measurementId });
    } else {
      res.status(404).json({ 
        error: 'GA4 Measurement ID not configured',
        message: 'GA4 Measurement ID not found in Secret Manager or environment variables'
      });
    }
  } catch (error: any) {
    console.error('Error fetching GA4 config:', error);
    res.status(500).json({ 
      error: 'Failed to fetch GA4 config',
      message: error.message || 'Unknown error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ============================================================================
// AI TASK GENERATION ENDPOINT (Proxies to external AI service)
// ============================================================================

// Helper function to get AI usage limits based on plan
function getAiUsageLimit(plan: string): number | null {
  if (plan === 'free') {
    return 10; // 10 credits per day for free plan
  } else if (plan === 'standard') {
    return 30; // 30 credits per day for standard plan
  }
  // Pro is unlimited
  return null;
}

// Helper function to check and increment AI usage
async function checkAndIncrementAiUsage(
  userEmail: string,
  sharedPool: any,
  checkOnly: boolean = false
): Promise<{ allowed: boolean; usage: number; limit: number | null; remaining: number | null; error?: string }> {
  const today = new Date().toISOString().split('T')[0];
  
  // Get current usage and plan
  const result = await sharedPool.query(`
    SELECT subscription_plan, ai_daily_usage, ai_usage_reset_date, trial_ends_at, stripe_subscription_id
    FROM users WHERE email = $1
  `, [userEmail]);
  
  if (result.rows.length === 0) {
    return { allowed: false, usage: 0, limit: null, remaining: null, error: 'User not found' };
  }
  
  const user = result.rows[0];
  let plan = user.subscription_plan || 'free';
  let currentUsage = user.ai_daily_usage || 0;
  
  // Reset if new day
  if (user.ai_usage_reset_date !== today) {
    currentUsage = 0;
  }
  
  // Check trial status
  const trialEndsAt = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
  const isTrialActive = trialEndsAt && trialEndsAt > new Date();
  
  // If trial has expired and user has no Stripe subscription, downgrade to free
  if (!isTrialActive && trialEndsAt && !user.stripe_subscription_id && plan !== 'free') {
    await sharedPool.query(`
      UPDATE users 
      SET subscription_plan = 'free', trial_ends_at = NULL
      WHERE email = $1
    `, [userEmail]);
    plan = 'free';
    console.log(`✅ Auto-downgraded ${userEmail} to free plan after trial expiration`);
  }
  
  const limit = getAiUsageLimit(plan);
  
  // Check if limit is reached
  if (limit !== null && currentUsage >= limit) {
    return {
      allowed: false,
      usage: currentUsage,
      limit,
      remaining: 0,
      error: 'AI usage limit reached'
    };
  }
  
  // If checkOnly, don't increment
  if (checkOnly) {
    return {
      allowed: true,
      usage: currentUsage,
      limit,
      remaining: limit !== null ? Math.max(0, limit - currentUsage) : null
    };
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
  
  return {
    allowed: true,
    usage: currentUsage + 1,
    limit,
    remaining: limit !== null ? Math.max(0, limit - currentUsage - 1) : null
  };
}

app.post('/api/generate-task', authenticateUser, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const requestBody = req.body;
    const orgId = req.headers['x-org-id'] as string | undefined;
    
    // Determine the external AI service URL
    const isLocalDev = process.env.NODE_ENV !== 'production';
    const aiServiceBase = isLocalDev 
      ? process.env.AI_SERVICE_URL || 'http://0.0.0.0:8082'
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
    
    // Check and increment AI usage BEFORE making the AI call
    const sharedPool = await getSharedPool();
    const usageCheck = await checkAndIncrementAiUsage(userEmail, sharedPool, false);
    
    if (!usageCheck.allowed) {
      return res.status(429).json({
        error: usageCheck.error || 'AI usage limit reached',
        limit: usageCheck.limit,
        usage: usageCheck.usage,
        remaining: usageCheck.remaining,
      });
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

setupImageEndpoints(app, authenticateUser, storage, firebaseApp);
setupFileEndpoints(app, authenticateUser, storage);
setupDocumentUploadEndpoints(app, authenticateUser, requireOrgMembership, storage);

// ============================================================================
// PLANS ENDPOINTS
// ============================================================================

setupPlansEndpoints(app, authenticateUser, requireOrgMembership);

// ============================================================================
// AI AGENTS ENDPOINTS
// ============================================================================

setupAIAgentEndpoints(app, authenticateUser, requireOrgMembership, secretManagerClient, serviceAccount);
setupAIAgentWebhookEndpoints(app, secretManagerClient, serviceAccount);
// Fetcher for developer-provided webhook signing secret (HMAC outbound webhooks)
setWebhookSigningSecretFetcher(async (agentId: string) => {
  try {
    const name = `projects/${serviceAccount.project_id}/secrets/ai-agent-${agentId}-webhook-signing-secret/versions/latest`;
    const [version] = await secretManagerClient.accessSecretVersion({ name });
    return version.payload?.data?.toString() ?? null;
  } catch {
    return null;
  }
});
setupAgentAPIv1Endpoints(app);
setupAgentTriggerEndpoints(app, authenticateUser, requireOrgMembership);
setupLeanRoutingEndpoints(app, authenticateUser, requireOrgMembership);

// ============================================================================
// UPDATE ENDPOINTS (Project and Task Progress Updates)
// ============================================================================

setupUpdateEndpoints(app, authenticateUser);

// ============================================================================
// QUERY ENDPOINTS (PostgreSQL - Read-only SQL queries)
// ============================================================================

setupQueryEndpoints(app, authenticateUser, requireOrgMembership);

// ============================================================================
// TURN SERVER ENDPOINTS (Twilio TURN credentials)
// ============================================================================

setupTurnEndpoints(app, authenticateUser, secretManagerClient, serviceAccount.project_id);


// ============================================================================
// UPDATE SUMMARIES ENDPOINTS (PostgreSQL)
// ============================================================================

app.get('/api/update-summaries', authenticateUser, requireOrgMembership, async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const orgId = (req as any).orgId;
    const projectId = req.query.projectId as string | undefined;
    const all = req.query.all === 'true'; // If all=true, return all summaries for the project
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
    
    // If projectId was specified and all=true, return array of all summaries
    if (projectId && all) {
      const summaries = result.rows.map(row => ({
        projectId: row.project_id,
        dateId: row.date_id ? new Date(row.date_id).toISOString().split('T')[0] : '',
        updateSummary: row.update_summary || '',
        generatedAt: row.generated_at ? new Date(row.generated_at).toISOString() : null
      }));
      res.json(summaries);
      return;
    }
    
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
    
    // Get actual plan from database
    const plan = user.subscription_plan || 'free';
    
    // Calculate AI usage limits based on plan using helper function
    const aiUsageLimit = getAiUsageLimit(plan);
    
    res.json({
      plan,
      stripeCustomerId: user.stripe_customer_id,
      stripeSubscriptionId: user.stripe_subscription_id,
      aiDailyUsage,
      aiUsageLimit,
      aiUsageRemaining: aiUsageLimit !== null ? Math.max(0, aiUsageLimit - aiDailyUsage) : null,
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
app.post('/api/subscription/checkout', authenticateUser, validateRequest(checkoutSchema), async (req, res) => {
  try {
    const stripeClient = await getStripe();
    if (!stripeClient) {
      return res.status(503).json({ error: 'Payment system not configured' });
    }
    
    const userEmail = (req as any).userEmail;
    const { plan, successUrl, cancelUrl } = req.body;
    
    // Validation handled by middleware
    
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
      // Verify customer exists in Stripe, create new one if it doesn't
      try {
        await stripeClient.customers.retrieve(userResult.rows[0].stripe_customer_id);
        customerId = userResult.rows[0].stripe_customer_id;
      } catch (error: any) {
        // Customer doesn't exist in Stripe, create a new one
        console.log(`⚠️ Customer ${userResult.rows[0].stripe_customer_id} not found in Stripe, creating new customer for ${userEmail}`);
        const customer = await stripeClient.customers.create({
          email: userEmail,
          name: `${userResult.rows[0]?.first_name || ''} ${userResult.rows[0]?.last_name || ''}`.trim() || undefined,
          metadata: { userEmail },
        });
        customerId = customer.id;
        
        // Save new customer ID
        await sharedPool.query(
          'UPDATE users SET stripe_customer_id = $1 WHERE email = $2',
          [customerId, userEmail]
        );
      }
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
app.post('/api/subscription/portal', authenticateUser, validateRequest(portalSchema), async (req, res) => {
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

// Switch subscription plan (upgrade or downgrade between plans)
app.post('/api/subscription/switch', authenticateUser, validateRequest(switchPlanSchema), async (req, res) => {
  try {
    const userEmail = (req as any).userEmail;
    const { plan } = req.body;
    
    // Validation handled by middleware
    
    const sharedPool = await getSharedPool();
    const userResult = await sharedPool.query(
      'SELECT stripe_customer_id, stripe_subscription_id, subscription_plan FROM users WHERE email = $1',
      [userEmail]
    );
    
    if (!userResult.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const currentPlan = userResult.rows[0].subscription_plan;
    if (currentPlan === plan) {
      return res.status(400).json({ error: `You are already on the ${plan} plan` });
    }
    
    const isSwitchingToFree = plan === 'free';
    const isSwitchingFromFree = currentPlan === 'free';
    const isSwitchingToPaid = plan === 'standard' || plan === 'pro';
    const isSwitchingBetweenPaid = (currentPlan === 'standard' || currentPlan === 'pro') && 
                                    (plan === 'standard' || plan === 'pro');
    
    // If switching to a paid plan without an active subscription, redirect to checkout
    if (isSwitchingToPaid && !userResult.rows[0].stripe_subscription_id) {
      const stripeClient = await getStripe();
      if (!stripeClient) {
        return res.status(503).json({ error: 'Payment system not configured' });
      }
      
      const priceId = STRIPE_PRICE_IDS[plan as keyof typeof STRIPE_PRICE_IDS];
      if (!priceId) {
        return res.status(400).json({ error: `Price ID not configured for ${plan} plan` });
      }
      
      // Get or create Stripe customer
      let customerId: string;
      if (userResult.rows[0].stripe_customer_id) {
        // Verify customer exists in Stripe, create new one if it doesn't
        try {
          await stripeClient.customers.retrieve(userResult.rows[0].stripe_customer_id);
          customerId = userResult.rows[0].stripe_customer_id;
        } catch (error: any) {
          // Customer doesn't exist in Stripe, create a new one
          console.log(`⚠️ Customer ${userResult.rows[0].stripe_customer_id} not found in Stripe, creating new customer for ${userEmail}`);
          const customerResult = await sharedPool.query(
            'SELECT first_name, last_name FROM users WHERE email = $1',
            [userEmail]
          );
          const customer = await stripeClient.customers.create({
            email: userEmail,
            name: `${customerResult.rows[0]?.first_name || ''} ${customerResult.rows[0]?.last_name || ''}`.trim() || undefined,
            metadata: { userEmail },
          });
          customerId = customer.id;
          
          // Save new customer ID
          await sharedPool.query(
            'UPDATE users SET stripe_customer_id = $1 WHERE email = $2',
            [customerId, userEmail]
          );
        }
      } else {
        const customerResult = await sharedPool.query(
          'SELECT first_name, last_name FROM users WHERE email = $1',
          [userEmail]
        );
        const customer = await stripeClient.customers.create({
          email: userEmail,
          name: `${customerResult.rows[0]?.first_name || ''} ${customerResult.rows[0]?.last_name || ''}`.trim() || undefined,
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
        success_url: `${req.headers.origin}/subscription?success=true`,
        cancel_url: `${req.headers.origin}/subscription?canceled=true`,
        metadata: { userEmail, plan },
      });
      
      // Return checkout URL instead of switching directly
      return res.json({ 
        checkoutUrl: session.url,
        requiresCheckout: true,
        message: 'Please complete checkout to switch to this plan'
      });
    }
    
    // Switching between standard and pro requires an active Stripe subscription
    if (isSwitchingBetweenPaid) {
      if (!userResult.rows[0].stripe_subscription_id) {
        return res.status(400).json({ 
          error: 'An active Stripe subscription is required to switch between Standard and Pro plans. Please subscribe first.' 
        });
      }
      
      const stripeClient = await getStripe();
      if (!stripeClient) {
        return res.status(503).json({ error: 'Payment system not configured' });
      }
      
      const priceId = STRIPE_PRICE_IDS[plan as keyof typeof STRIPE_PRICE_IDS];
      if (!priceId) {
        return res.status(400).json({ error: `Price ID not configured for ${plan} plan` });
      }
      
      try {
        // Get the subscription to find the current subscription item
        const subscription = await stripeClient.subscriptions.retrieve(
          userResult.rows[0].stripe_subscription_id
        );
        
        if (!subscription.items.data[0]) {
          return res.status(400).json({ error: 'Invalid subscription state' });
        }
        
        // Update the subscription with the new price
        await stripeClient.subscriptions.update(
          userResult.rows[0].stripe_subscription_id,
          {
            items: [{
              id: subscription.items.data[0].id,
              price: priceId,
            }],
            proration_behavior: 'create_prorations', // Prorate the change
          }
        );
        console.log(`✅ Stripe subscription updated: ${userEmail} ${currentPlan} -> ${plan}`);
      } catch (stripeError: any) {
        console.error('Stripe subscription update error:', stripeError);
        return res.status(500).json({ error: `Failed to update Stripe subscription: ${stripeError.message}` });
      }
    }
    
    // If switching to free, cancel Stripe subscription if it exists
    if (isSwitchingToFree && userResult.rows[0].stripe_subscription_id) {
      const stripeClient = await getStripe();
      if (stripeClient) {
        try {
          await stripeClient.subscriptions.cancel(userResult.rows[0].stripe_subscription_id);
          console.log(`✅ Stripe subscription canceled: ${userEmail}`);
        } catch (stripeError: any) {
          console.error('Stripe subscription cancellation error:', stripeError);
          // Continue with database update even if Stripe cancel fails
          console.log('⚠️ Continuing with database update despite Stripe cancellation error');
        }
      }
    }
    
    // Update the database
    // If switching to free, also clear stripe_subscription_id
    if (isSwitchingToFree) {
      await sharedPool.query(
        'UPDATE users SET subscription_plan = $1, stripe_subscription_id = NULL WHERE email = $2',
        [plan, userEmail]
      );
    } else {
      await sharedPool.query(
        'UPDATE users SET subscription_plan = $1 WHERE email = $2',
        [plan, userEmail]
      );
    }
    
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
        webhookSecretLength: currentWebhookSecret?.length || 0,
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
    
    // Use helper function to check and increment usage
    const usageResult = await checkAndIncrementAiUsage(userEmail, sharedPool, false);
    
    if (!usageResult.allowed) {
      return res.status(429).json({ 
        error: usageResult.error || 'AI usage limit reached',
        limit: usageResult.limit,
        usage: usageResult.usage,
        plan,
        isTrialActive,
        remaining: usageResult.remaining,
      });
    }
    
    res.json({ 
      success: true, 
      usage: usageResult.usage,
      limit: usageResult.limit,
      remaining: usageResult.remaining,
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
  // Ignore Socket.IO requests (likely from browser extensions or third-party scripts)
  if (req.path.startsWith('/socket.io/')) {
    return res.status(404).end();
  }
  
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


// Start deployment completion worker
import { startDeploymentWorker } from './workers/deployment-worker.js';
startDeploymentWorker().catch((error) => {
  console.error('❌ Failed to start deployment worker:', error);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server started on port ${PORT}`);
  console.log(`✅ Health check available at http://0.0.0.0:${PORT}/api/health`);
  console.log(`✅ WebSocket server available at ws://0.0.0.0:${PORT}/api/livekit/audio-ws`);
});


