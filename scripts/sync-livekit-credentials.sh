#!/bin/bash

# NOTE: This script is DEPRECATED
# LiveKit now fetches credentials directly from GCP Secret Manager via init container
# No manual syncing is needed - the deployment automatically uses Secret Manager
#
# This script is kept for reference but is no longer required.
# If you need to update credentials, just update them in GCP Secret Manager
# and restart the LiveKit deployment.

# Sync LiveKit credentials from GCP Secret Manager to Kubernetes Secret
# This ensures both the LiveKit server and backend use the same credentials

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

PROJECT_ID="leanworks-474204"
SECRET_NAME="livekit-secrets"
NAMESPACE="default"

echo -e "${GREEN}🔄 Syncing LiveKit credentials from GCP Secret Manager to Kubernetes${NC}"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ Error: gcloud CLI is not installed${NC}"
    exit 1
fi

# Check if kubectl is installed
if ! command -v kubectl &> /dev/null; then
    echo -e "${RED}❌ Error: kubectl is not installed${NC}"
    exit 1
fi

# Check if user is authenticated with gcloud
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo -e "${YELLOW}⚠️  Not authenticated with gcloud. Please run: gcloud auth login${NC}"
    exit 1
fi

# Check if kubectl can connect to cluster
if ! kubectl cluster-info &> /dev/null; then
    echo -e "${YELLOW}⚠️  Cannot connect to Kubernetes cluster. Please check your kubeconfig${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites check passed${NC}"
echo ""

# Fetch API Key from GCP Secret Manager
echo -e "${YELLOW}📥 Fetching API key from GCP Secret Manager...${NC}"
API_KEY=$(gcloud secrets versions access latest --secret="livekit-api-key" --project="$PROJECT_ID" 2>/dev/null || echo "")

if [ -z "$API_KEY" ]; then
    echo -e "${RED}❌ Error: Failed to fetch livekit-api-key from GCP Secret Manager${NC}"
    echo "   Make sure the secret exists: gcloud secrets list --project=$PROJECT_ID"
    exit 1
fi

echo -e "${GREEN}✅ API key fetched (length: ${#API_KEY})${NC}"

# Fetch API Secret from GCP Secret Manager
echo -e "${YELLOW}📥 Fetching API secret from GCP Secret Manager...${NC}"
API_SECRET=$(gcloud secrets versions access latest --secret="livekit-api-secret" --project="$PROJECT_ID" 2>/dev/null || echo "")

if [ -z "$API_SECRET" ]; then
    echo -e "${RED}❌ Error: Failed to fetch livekit-api-secret from GCP Secret Manager${NC}"
    echo "   Make sure the secret exists: gcloud secrets list --project=$PROJECT_ID"
    exit 1
fi

echo -e "${GREEN}✅ API secret fetched (length: ${#API_SECRET})${NC}"
echo ""

# Check if secret already exists
if kubectl get secret "$SECRET_NAME" -n "$NAMESPACE" &> /dev/null; then
    echo -e "${YELLOW}⚠️  Secret '$SECRET_NAME' already exists. Updating...${NC}"
    # Delete existing secret
    kubectl delete secret "$SECRET_NAME" -n "$NAMESPACE" --ignore-not-found=true
fi

# Create/update Kubernetes Secret
echo -e "${YELLOW}📤 Creating Kubernetes Secret...${NC}"
kubectl create secret generic "$SECRET_NAME" \
  --from-literal=api-key="$API_KEY" \
  --from-literal=api-secret="$API_SECRET" \
  --namespace="$NAMESPACE" \
  --dry-run=client -o yaml | kubectl apply -f -

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Kubernetes Secret '$SECRET_NAME' created/updated successfully${NC}"
else
    echo -e "${RED}❌ Error: Failed to create Kubernetes Secret${NC}"
    exit 1
fi

echo ""

# Restart LiveKit deployment to pick up new credentials
echo -e "${YELLOW}🔄 Restarting LiveKit deployment to apply new credentials...${NC}"
if kubectl rollout restart deployment/livekit-server -n "$NAMESPACE" &> /dev/null; then
    echo -e "${GREEN}✅ LiveKit deployment restart initiated${NC}"
    echo -e "${YELLOW}   Waiting for rollout to complete...${NC}"
    kubectl rollout status deployment/livekit-server -n "$NAMESPACE" --timeout=120s || echo -e "${YELLOW}⚠️  Rollout may still be in progress${NC}"
else
    echo -e "${YELLOW}⚠️  LiveKit deployment not found. Skipping restart.${NC}"
    echo "   If LiveKit is deployed, restart it manually: kubectl rollout restart deployment/livekit-server"
fi

echo ""
echo -e "${GREEN}============================${NC}"
echo -e "${GREEN}✅ Sync Complete!${NC}"
echo -e "${GREEN}============================${NC}"
echo ""
echo "Summary:"
echo "  - GCP Secret Manager → Kubernetes Secret: ✅"
echo "  - Secret Name: $SECRET_NAME"
echo "  - Namespace: $NAMESPACE"
echo "  - LiveKit Deployment: Restarted"
echo ""
echo "Next steps:"
echo "  1. Verify LiveKit server is running: kubectl get pods -l app=livekit-server"
echo "  2. Check LiveKit logs: kubectl logs -l app=livekit-server --tail=50"
echo "  3. Test voice calls from your application"
echo ""

