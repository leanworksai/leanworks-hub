import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';

// Firebase web app configuration - using minimal config since we use service account
// API key is optional - we'll handle initialization errors gracefully
// Derive authDomain and storageBucket from projectId if available
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || '';
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyBypassKeyForServiceAccount',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || (projectId ? `${projectId}.firebaseapp.com` : 'leanworks.firebaseapp.com'),
  projectId: projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || (projectId ? `${projectId}.appspot.com` : 'leanworks.appspot.com'),
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '123456789',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:123456789:web:abcdef',
};

// Initialize Firebase with error handling
let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

try {
  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0];
  }
  
  // Initialize Firebase services
  auth = getAuth(app);
  db = getFirestore(app);
} catch (error: any) {
  // If initialization fails (e.g., invalid API key), we'll still try to use it
  // Custom tokens might still work even with invalid API key
  console.warn('Firebase initialization warning (may still work with custom tokens):', error.message);
  
  // Try to get existing app or create a minimal one
  try {
    if (getApps().length > 0) {
      app = getApps()[0];
      auth = getAuth(app);
      db = getFirestore(app);
    }
  } catch (e) {
    console.warn('Could not initialize Firebase services, but authentication may still work');
  }
}

// Export with fallback - these will be null if initialization failed
// but we'll handle that in the auth context
export { auth, db };
export default app;

