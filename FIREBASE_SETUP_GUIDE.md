# Firebase Setup Guide for LeanWorks Hub

This guide will walk you through setting up Firebase for your LeanWorks Hub application.

## Prerequisites

- GCP project already set up
- `gcp_credential.json` file exists
- `gcloud` CLI installed and authenticated

## Step 1: Access Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Sign in with your Google account (same one used for GCP)

## Step 2: Create or Select a Firebase Project

### Option A: Create a New Firebase Project

1. Click **"Add project"** or **"Create a project"**
2. Enter a project name (e.g., "LeanWorks Hub")
3. Click **Continue**
4. **Google Analytics** (optional):
   - You can enable or disable Google Analytics
   - If enabled, select or create an Analytics account
   - Click **Continue**
5. Click **Create project**
6. Wait for project creation (30-60 seconds)
7. Click **Continue** when ready

### Option B: Use Existing GCP Project

1. Click **"Add project"**
2. Select **"Add Firebase to an existing Google Cloud project"**
3. Choose your GCP project from the dropdown
4. Click **Continue**
5. Enable/disable Google Analytics (optional)
6. Click **Continue** and wait for setup

## Step 3: Add a Web App

1. Once in your Firebase project, you'll see the project overview
2. Look for the **"Get started"** section or click the **</> (Web)** icon
3. Click **"Add app"** > **Web** (the `</>` icon)
4. **Register your app**:
   - **App nickname**: `LeanWorks Hub Web` (or any name)
   - **Firebase Hosting**: You can skip this for now (uncheck if checked)
   - Click **Register app**
5. **Copy the Firebase configuration**:
   - You'll see a code snippet with your Firebase config
   - It looks like this:
     ```javascript
     const firebaseConfig = {
       apiKey: "AIzaSy...",
       authDomain: "your-project.firebaseapp.com",
       projectId: "your-project-id",
       storageBucket: "your-project.appspot.com",
       messagingSenderId: "123456789",
       appId: "1:123456789:web:abcdef"
     };
     ```
   - **Copy this entire config object** (you'll need it in the next step)

## Step 4: Create the Secret in GCP Secret Manager

Now we'll store this config in GCP Secret Manager so your app can access it.

### Get Your Project ID

```bash
# Extract project ID from credentials
PROJECT_ID=$(cat gcp_credential.json | jq -r '.project_id')
echo "Project ID: $PROJECT_ID"
```

### Create the Secret

**Method 1: Using the helper script (Easiest)**

```bash
./create-firebase-secret.sh
```

When prompted:
1. Press Enter to continue
2. Paste your Firebase config JSON (the entire object)
3. Press Ctrl+D (or Cmd+D on Mac) when done

**Method 2: Manual creation**

1. Create a temporary file with your Firebase config:

```bash
# Replace the values below with your actual Firebase config
cat > /tmp/firebase-config.json <<EOF
{
  "apiKey": "AIzaSy...your-actual-api-key",
  "authDomain": "your-project.firebaseapp.com",
  "projectId": "your-project-id",
  "storageBucket": "your-project.appspot.com",
  "messagingSenderId": "123456789",
  "appId": "1:123456789:web:abcdef"
}
EOF
```

2. Create the secret:

```bash
PROJECT_ID=$(cat gcp_credential.json | jq -r '.project_id')

gcloud secrets create firebase-config \
  --data-file=/tmp/firebase-config.json \
  --project=$PROJECT_ID
```

3. Clean up:

```bash
rm /tmp/firebase-config.json
```

**Method 3: Using gcloud directly**

```bash
PROJECT_ID=$(cat gcp_credential.json | jq -r '.project_id')

# This will prompt you to paste the config
echo '{
  "apiKey": "YOUR_API_KEY",
  "authDomain": "YOUR_PROJECT.firebaseapp.com",
  "projectId": "YOUR_PROJECT_ID",
  "storageBucket": "YOUR_PROJECT.appspot.com",
  "messagingSenderId": "YOUR_SENDER_ID",
  "appId": "YOUR_APP_ID"
}' | gcloud secrets create firebase-config --data-file=- --project=$PROJECT_ID
```

## Step 5: Verify the Secret

```bash
PROJECT_ID=$(cat gcp_credential.json | jq -r '.project_id')

# List secrets to confirm it exists
gcloud secrets list --project=$PROJECT_ID | grep firebase-config

# Test reading it (should work with your service account)
gcloud secrets versions access latest --secret=firebase-config --project=$PROJECT_ID | jq .
```

## Step 6: Enable Firebase Authentication

1. In Firebase Console, go to **Build** > **Authentication**
2. Click **Get started**
3. Click **Sign-in method** tab
4. Enable **Email/Password**:
   - Click on **Email/Password**
   - Toggle **Enable** to ON
   - Click **Save**

## Step 7: Set Up Firestore Database (if not already done)

1. In Firebase Console, go to **Build** > **Firestore Database**
2. Click **Create database**
3. Choose **Start in production mode** (or test mode for development)
4. Select a location (choose one close to you, e.g., `us-west1`)
5. Click **Enable**

**Important**: Make sure the database name matches what's in your code. The app uses `leanworks-prod` as the database name.

## Step 8: Restart Your Application

If your Docker container is running:

```bash
# Restart the container
docker restart leanworks-hub

# Or rebuild and restart
docker stop leanworks-hub
docker rm leanworks-hub
docker build -t leanworks-hub .
docker run -d --name leanworks-hub -p 8080:80 -p 3001:3001 leanworks-hub
```

## Step 9: Test the Setup

1. Open http://localhost:8080/login
2. The page should load (no more infinite spinner!)
3. Try signing up with a new account
4. Try logging in

### Check Backend Logs

```bash
# Check if Firebase config is loading correctly
docker logs leanworks-hub 2>&1 | grep -i firebase

# Check backend server logs
docker exec leanworks-hub cat /tmp/server.log | grep -i firebase
```

You should see:
```
✅ Firebase Admin SDK initialized
✅ Firestore database initialized: leanworks-prod
```

### Test the API Endpoint

```bash
curl http://localhost:3001/api/firebase-config | jq .
```

You should get your Firebase config JSON back (without errors).

## Troubleshooting

### Error: "Secret not found"
- Verify the secret exists: `gcloud secrets list | grep firebase-config`
- Check the project ID matches: `cat gcp_credential.json | jq .project_id`
- Ensure your service account has `roles/secretmanager.secretAccessor`

### Error: "Invalid API key"
- Verify the API key in the secret starts with `AIza`
- Check that you copied the entire config object correctly
- Re-create the secret with the correct config

### Error: "Firebase not initialized"
- Check backend logs: `docker logs leanworks-hub`
- Verify the secret is accessible: `gcloud secrets versions access latest --secret=firebase-config`
- Ensure Firestore is enabled in Firebase Console

### Login page still spinning
- Check browser console for errors (F12)
- Verify the `/api/firebase-config` endpoint returns valid JSON
- Check network tab to see if the request is failing

### "Database not found" errors
- Ensure Firestore database is created
- Check the database name matches `leanworks-prod`
- Verify the database location matches your GCP region

## Quick Reference

### Firebase Console URLs
- **Main Console**: https://console.firebase.google.com/
- **Project Settings**: https://console.firebase.google.com/project/YOUR_PROJECT_ID/settings/general
- **Authentication**: https://console.firebase.google.com/project/YOUR_PROJECT_ID/authentication
- **Firestore**: https://console.firebase.google.com/project/YOUR_PROJECT_ID/firestore

### Useful Commands

```bash
# Get project ID
cat gcp_credential.json | jq -r '.project_id'

# View Firebase config secret
PROJECT_ID=$(cat gcp_credential.json | jq -r '.project_id')
gcloud secrets versions access latest --secret=firebase-config --project=$PROJECT_ID | jq .

# Update Firebase config secret
PROJECT_ID=$(cat gcp_credential.json | jq -r '.project_id')
# Edit the JSON, then:
cat > /tmp/firebase-config.json <<EOF
{your updated config}
EOF
gcloud secrets versions add firebase-config --data-file=/tmp/firebase-config.json --project=$PROJECT_ID
rm /tmp/firebase-config.json

# Test Firebase config endpoint
curl http://localhost:3001/api/firebase-config
```

## Summary

After completing these steps, you should have:

✅ Firebase project created/configured  
✅ Web app registered  
✅ Firebase config stored in Secret Manager  
✅ Email/Password authentication enabled  
✅ Firestore database created  
✅ Application able to load login page  

Your login page should now work! 🎉

