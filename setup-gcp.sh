#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Setting up GCP for LeanWorks Hub...${NC}\n"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ gcloud CLI is not installed. Please install it first:${NC}"
    echo "   https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Set your project ID
read -p "Enter your GCP Project ID: " PROJECT_ID
if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}❌ Project ID cannot be empty${NC}"
    exit 1
fi

gcloud config set project $PROJECT_ID
echo -e "${GREEN}✅ Project set to: $PROJECT_ID${NC}\n"

# Enable APIs
echo -e "${YELLOW}📡 Enabling required APIs...${NC}"
gcloud services enable \
  secretmanager.googleapis.com \
  firebase.googleapis.com \
  sqladmin.googleapis.com \
  storage-api.googleapis.com \
  cloudresourcemanager.googleapis.com \
  --project=$PROJECT_ID
echo -e "${GREEN}✅ APIs enabled${NC}\n"

# Create service account
echo -e "${YELLOW}👤 Creating service account...${NC}"
if gcloud iam service-accounts describe "leanworks-hub-service@${PROJECT_ID}.iam.gserviceaccount.com" --project=$PROJECT_ID &>/dev/null; then
    echo -e "${YELLOW}⚠️  Service account already exists, skipping creation${NC}"
else
    gcloud iam service-accounts create leanworks-hub-service \
      --display-name="LeanWorks Hub Service Account" \
      --project=$PROJECT_ID
    echo -e "${GREEN}✅ Service account created${NC}"
fi

SERVICE_ACCOUNT_EMAIL="leanworks-hub-service@${PROJECT_ID}.iam.gserviceaccount.com"

# Grant roles
echo -e "${YELLOW}🔐 Granting roles to service account...${NC}"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None \
  --quiet || echo -e "${YELLOW}⚠️  Role may already be granted${NC}"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/cloudsql.client" \
  --condition=None \
  --quiet || echo -e "${YELLOW}⚠️  Role may already be granted${NC}"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/firebase.admin" \
  --condition=None \
  --quiet || echo -e "${YELLOW}⚠️  Role may already be granted${NC}"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/storage.admin" \
  --condition=None \
  --quiet || echo -e "${YELLOW}⚠️  Role may already be granted${NC}"

echo -e "${GREEN}✅ Roles granted${NC}\n"

# Create key
echo -e "${YELLOW}🔑 Creating service account key...${NC}"
if [ -f "gcp_credential.json" ]; then
    read -p "gcp_credential.json already exists. Overwrite? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}⚠️  Skipping key creation${NC}"
    else
        gcloud iam service-accounts keys create gcp_credential.json \
          --iam-account=${SERVICE_ACCOUNT_EMAIL} \
          --project=$PROJECT_ID
        echo -e "${GREEN}✅ Service account key created${NC}"
    fi
else
    gcloud iam service-accounts keys create gcp_credential.json \
      --iam-account=${SERVICE_ACCOUNT_EMAIL} \
      --project=$PROJECT_ID
    echo -e "${GREEN}✅ Service account key created${NC}"
fi

# Create secrets
echo -e "${YELLOW}🔒 Creating secrets in Secret Manager...${NC}"

# PostgreSQL password
if gcloud secrets describe postgresdb-password --project=$PROJECT_ID &>/dev/null; then
    echo -e "${YELLOW}⚠️  postgresdb-password secret already exists${NC}"
    read -p "Create new version? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        POSTGRES_PASSWORD=$(openssl rand -base64 32)
        echo -n "$POSTGRES_PASSWORD" | gcloud secrets versions add postgresdb-password --data-file=-
        echo -e "${GREEN}✅ New password version created${NC}"
        echo -e "${YELLOW}📝 PostgreSQL Password: $POSTGRES_PASSWORD${NC}"
        echo -e "${YELLOW}   (Save this password for database setup!)${NC}"
    fi
else
    POSTGRES_PASSWORD=$(openssl rand -base64 32)
    echo -n "$POSTGRES_PASSWORD" | gcloud secrets create postgresdb-password --data-file=-
    echo -e "${GREEN}✅ postgresdb-password secret created${NC}"
    echo -e "${YELLOW}📝 PostgreSQL Password: $POSTGRES_PASSWORD${NC}"
    echo -e "${YELLOW}   (Save this password for database setup!)${NC}"
fi

# API key
if gcloud secrets describe api-key --project=$PROJECT_ID &>/dev/null; then
    echo -e "${YELLOW}⚠️  api-key secret already exists${NC}"
else
    echo -n "7aeCdl+e5wtI/7PZFlGcUaWEM8Mf32AY7qSoThiO5WI=" | gcloud secrets create api-key --data-file=-
    echo -e "${GREEN}✅ api-key secret created${NC}"
fi

echo -e "\n${GREEN}✅ GCP setup complete!${NC}\n"
echo -e "${YELLOW}📝 Next steps:${NC}"
echo "1. Set up Firebase in the Firebase Console: https://console.firebase.google.com/"
echo "2. Create firebase-config secret with your Firebase config JSON"
echo "3. Set up PostgreSQL (local or Cloud SQL)"
echo "4. Create .env file with database credentials"
echo "5. Run: npm install && npm run dev"
echo ""
echo -e "${YELLOW}💡 Tip: See GCP_SETUP_GUIDE.md for detailed instructions${NC}"

