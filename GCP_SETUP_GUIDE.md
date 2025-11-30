# GCP Setup Guide for LeanWorks Hub

This guide will help you set up GCP credentials and services needed to run LeanWorks Hub locally.

## Prerequisites

- Google Cloud Platform account
- `gcloud` CLI installed and configured ([Install Guide](https://cloud.google.com/sdk/docs/install))
- Node.js and npm installed

## Step 1: Create or Select a GCP Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Note your **Project ID** (e.g., `my-leanworks-project`)

```bash
# Set your project ID
export PROJECT_ID="my-leanworks-project"
gcloud config set project $PROJECT_ID
```

## Step 2: Enable Required APIs

Enable the necessary Google Cloud APIs:

```bash
# Enable required APIs
gcloud services enable \
  secretmanager.googleapis.com \
  firebase.googleapis.com \
  sqladmin.googleapis.com \
  storage-api.googleapis.com \
  cloudresourcemanager.googleapis.com
```

## Step 3: Create a Service Account

1. Go to **IAM & Admin** > **Service Accounts** in the Cloud Console
2. Click **Create Service Account**
3. Fill in:
   - **Name**: `leanworks-hub-service`
   - **Description**: Service account for LeanWorks Hub application
4. Click **Create and Continue**

### Grant Required Roles

Grant these roles to the service account:

- **Secret Manager Secret Accessor** - To read secrets
- **Cloud SQL Client** - To connect to Cloud SQL (if using Cloud SQL)
- **Firebase Admin** - To manage Firebase services
- **Storage Admin** - To manage Firebase Storage

```bash
# Set service account email (replace with your actual email)
export SERVICE_ACCOUNT_EMAIL="leanworks-hub-service@${PROJECT_ID}.iam.gserviceaccount.com"

# Grant roles
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/firebase.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/storage.admin"
```

## Step 4: Create and Download Service Account Key

1. In the Service Accounts page, click on your service account
2. Go to the **Keys** tab
3. Click **Add Key** > **Create new key**
4. Select **JSON** format
5. Download the key file
6. Save it as `gcp_credential.json` in the project root

```bash
# Create key and download
gcloud iam service-accounts keys create gcp_credential.json \
  --iam-account=${SERVICE_ACCOUNT_EMAIL}

# Verify the file was created
ls -la gcp_credential.json
```

**⚠️ Security Note:** Never commit `gcp_credential.json` to version control! It's already in `.gitignore`.

## Step 5: Set Up Firebase

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Add project** or select your existing project
3. Follow the setup wizard:
   - Enable Google Analytics (optional)
   - Create a Firebase project
4. Once created, go to **Project Settings** (gear icon)
5. In the **General** tab, scroll down to **Your apps**
6. Click **Add app** > **Web** (</> icon)
7. Register your app (you can use any name)
8. Copy the Firebase configuration object

### Create Firebase Config Secret

The app expects Firebase config in Secret Manager. Create it:

```bash
# Create a temporary file with Firebase config
cat > /tmp/firebase-config.json <<EOF
{
  "apiKey": "YOUR_API_KEY",
  "authDomain": "${PROJECT_ID}.firebaseapp.com",
  "projectId": "${PROJECT_ID}",
  "storageBucket": "${PROJECT_ID}.appspot.com",
  "messagingSenderId": "YOUR_SENDER_ID",
  "appId": "YOUR_APP_ID"
}
EOF

# Create the secret in Secret Manager
gcloud secrets create firebase-config \
  --data-file=/tmp/firebase-config.json \
  --project=$PROJECT_ID

# Clean up
rm /tmp/firebase-config.json
```

**Note:** Replace the placeholder values in the JSON with your actual Firebase config from the console.

## Step 6: Create Required Secrets in Secret Manager

The application needs these secrets:

### 6.1 PostgreSQL Password

```bash
# Generate a secure password
POSTGRES_PASSWORD=$(openssl rand -base64 32)

# Create the secret
echo -n "$POSTGRES_PASSWORD" | gcloud secrets create postgresdb-password \
  --data-file=- \
  --project=$PROJECT_ID

# Save it for database setup
echo "PostgreSQL Password: $POSTGRES_PASSWORD" > .db-password.txt
echo "⚠️ Save this password! You'll need it for database setup."
```

### 6.2 API Key (for AI service)

```bash
# Create API key secret (use a placeholder or your actual API key)
echo -n "7aeCdl+e5wtI/7PZFlGcUaWEM8Mf32AY7qSoThiO5WI=" | gcloud secrets create api-key \
  --data-file=- \
  --project=$PROJECT_ID
```

## Step 7: Set Up Database

You have two options:

### Option A: Local PostgreSQL (Recommended for Development)

1. Install PostgreSQL locally:
   ```bash
   # macOS
   brew install postgresql@14
   brew services start postgresql@14

   # Linux
   sudo apt-get install postgresql postgresql-contrib
   sudo systemctl start postgresql
   ```

2. Create database and user:
   ```bash
   # Connect to PostgreSQL
   psql postgres

   # In PostgreSQL prompt:
   CREATE DATABASE "leanworks-prod";
   CREATE USER postgres WITH PASSWORD 'YOUR_PASSWORD_HERE';
   GRANT ALL PRIVILEGES ON DATABASE "leanworks-prod" TO postgres;
   \q
   ```

3. Run the schema:
   ```bash
   # Set environment variables
   export DB_HOST=localhost
   export DB_PORT=5432
   export DB_USER=postgres
   export DB_PASSWORD=YOUR_PASSWORD_HERE
   export DB_NAME=leanworks-prod

   # Run schema
   psql -h localhost -U postgres -d leanworks-prod -f database/schema.sql
   ```

### Option B: Cloud SQL (Production-like)

1. Create Cloud SQL instance:
   ```bash
   gcloud sql instances create leanworks-prod \
     --database-version=POSTGRES_14 \
     --tier=db-f1-micro \
     --region=us-west1 \
     --root-password=$POSTGRES_PASSWORD
   ```

2. Create database:
   ```bash
   gcloud sql databases create "leanworks-prod" \
     --instance=leanworks-prod
   ```

3. Use Cloud SQL Proxy for local connection:
   ```bash
   # Download Cloud SQL Proxy
   curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.8.0/cloud-sql-proxy.darwin.arm64
   chmod +x cloud-sql-proxy

   # Run proxy (in a separate terminal)
   ./cloud-sql-proxy ${PROJECT_ID}:us-west1:leanworks-prod
   ```

## Step 8: Create .env File for Local Development

Create a `.env` file in the project root:

```bash
cat > .env <<EOF
# Database Configuration (for local PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=YOUR_PASSWORD_HERE
DB_NAME=leanworks-prod
DB_REGION=us-west1

# API Configuration
ASK_API_KEY=7aeCdl+e5wtI/7PZFlGcUaWEM8Mf32AY7qSoThiO5WI=

# Node Environment
NODE_ENV=development
EOF
```

**⚠️ Security:** Add `.env` to `.gitignore` if not already there.

## Step 9: Verify Setup

### Verify Service Account Key

```bash
# Check that the credential file exists and is valid JSON
cat gcp_credential.json | jq '.project_id'
```

### Verify Secrets

```bash
# List all secrets
gcloud secrets list --project=$PROJECT_ID

# Test reading a secret (should work with your service account)
gcloud secrets versions access latest --secret=postgresdb-password --project=$PROJECT_ID
```

### Verify Database Connection

```bash
# Test PostgreSQL connection
psql -h localhost -U postgres -d leanworks-prod -c "SELECT version();"
```

## Step 10: Update Code for Local Development (Optional)

If you want to use local PostgreSQL without Secret Manager, you can modify the code to use environment variables directly. However, the current setup should work with the `.env` file.

## Step 11: Run the Application

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

The application should now:
- ✅ Load GCP credentials from `gcp_credential.json`
- ✅ Connect to PostgreSQL (local or Cloud SQL)
- ✅ Access Firebase services
- ✅ Read secrets from Secret Manager

## Troubleshooting

### Error: "Failed to load GCP credentials"
- Verify `gcp_credential.json` exists in the project root
- Check that the JSON is valid: `cat gcp_credential.json | jq .`
- Ensure the service account email matches

### Error: "Failed to fetch password from Secret Manager"
- Verify the secret exists: `gcloud secrets list`
- Check service account has `roles/secretmanager.secretAccessor`
- The app will fall back to `DB_PASSWORD` from `.env` if Secret Manager fails

### Error: "Failed to initialize Firebase Admin SDK"
- Verify Firebase is enabled in your GCP project
- Check that `firebase-config` secret exists in Secret Manager
- Ensure the service account has Firebase Admin role

### Error: "PostgreSQL connection failed"
- Verify PostgreSQL is running: `psql -h localhost -U postgres -c "SELECT 1;"`
- Check `.env` file has correct database credentials
- For Cloud SQL, ensure Cloud SQL Proxy is running

### Database Schema Not Found
- Run the schema: `psql -h localhost -U postgres -d leanworks-prod -f database/schema.sql`
- Verify tables exist: `psql -h localhost -U postgres -d leanworks-prod -c "\dt"`

## Quick Setup Script

Save this as `setup-gcp.sh` and run it:

```bash
#!/bin/bash
set -e

echo "🚀 Setting up GCP for LeanWorks Hub..."

# Set your project ID
read -p "Enter your GCP Project ID: " PROJECT_ID
gcloud config set project $PROJECT_ID

# Enable APIs
echo "📡 Enabling APIs..."
gcloud services enable \
  secretmanager.googleapis.com \
  firebase.googleapis.com \
  sqladmin.googleapis.com \
  storage-api.googleapis.com

# Create service account
echo "👤 Creating service account..."
gcloud iam service-accounts create leanworks-hub-service \
  --display-name="LeanWorks Hub Service Account" \
  --project=$PROJECT_ID

SERVICE_ACCOUNT_EMAIL="leanworks-hub-service@${PROJECT_ID}.iam.gserviceaccount.com"

# Grant roles
echo "🔐 Granting roles..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/firebase.admin"

# Create key
echo "🔑 Creating service account key..."
gcloud iam service-accounts keys create gcp_credential.json \
  --iam-account=${SERVICE_ACCOUNT_EMAIL}

# Create secrets
echo "🔒 Creating secrets..."
POSTGRES_PASSWORD=$(openssl rand -base64 32)
echo -n "$POSTGRES_PASSWORD" | gcloud secrets create postgresdb-password --data-file=-

echo -n "7aeCdl+e5wtI/7PZFlGcUaWEM8Mf32AY7qSoThiO5WI=" | gcloud secrets create api-key --data-file=-

echo "✅ Setup complete!"
echo "📝 Next steps:"
echo "1. Set up Firebase in the Firebase Console"
echo "2. Create firebase-config secret with your Firebase config"
echo "3. Set up PostgreSQL (local or Cloud SQL)"
echo "4. Create .env file with database credentials"
echo "5. Run: npm install && npm run dev"
```

## Summary

After completing these steps, you should have:

✅ GCP project with required APIs enabled  
✅ Service account with proper permissions  
✅ `gcp_credential.json` file in project root  
✅ Secrets in Secret Manager (postgresdb-password, api-key, firebase-config)  
✅ Firebase project configured  
✅ PostgreSQL database (local or Cloud SQL)  
✅ `.env` file with local configuration  

The application should now run successfully! 🎉

