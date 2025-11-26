#!/bin/bash

set -e

# Configuration
CLUSTER_NAME="leanworks-prod"
REGION="us-west1"  # Update this to your cluster's region
GCP_CREDENTIAL_FILE="gcp_credential.json"
ARTIFACT_REGISTRY_REPO="docker-repo"  # Artifact Registry repository name

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting deployment to GKE...${NC}"

# Check if GCP credentials file exists
if [ ! -f "$GCP_CREDENTIAL_FILE" ]; then
    echo -e "${RED}Error: $GCP_CREDENTIAL_FILE not found!${NC}"
    exit 1
fi

# Read project ID from credentials file
if command -v jq &> /dev/null; then
    PROJECT_ID=$(jq -r '.project_id' "$GCP_CREDENTIAL_FILE")
elif command -v python3 &> /dev/null; then
    PROJECT_ID=$(python3 -c "import json, sys; print(json.load(open('$GCP_CREDENTIAL_FILE'))['project_id'])")
else
    # Fallback: use grep and sed (less robust but works without additional tools)
    PROJECT_ID=$(grep -o '"project_id"[[:space:]]*:[[:space:]]*"[^"]*"' "$GCP_CREDENTIAL_FILE" | sed 's/.*"project_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
fi

if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Error: Could not extract project_id from $GCP_CREDENTIAL_FILE${NC}"
    exit 1
fi

IMAGE_NAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REGISTRY_REPO}/leanworks-hub"

# Set up GCP authentication
echo -e "${YELLOW}Setting up GCP authentication...${NC}"
export GOOGLE_APPLICATION_CREDENTIALS="$GCP_CREDENTIAL_FILE"
gcloud auth activate-service-account --key-file="$GCP_CREDENTIAL_FILE"

# Set the project
echo -e "${YELLOW}Setting GCP project to ${PROJECT_ID}...${NC}"
gcloud config set project "$PROJECT_ID"

# Configure Docker to use gcloud as a credential helper for Artifact Registry
echo -e "${YELLOW}Configuring Docker authentication for Artifact Registry...${NC}"
gcloud auth configure-docker ${REGION}-docker.pkg.dev

# Check if Artifact Registry repository exists, create if it doesn't
echo -e "${YELLOW}Checking Artifact Registry repository...${NC}"
if ! gcloud artifacts repositories describe "$ARTIFACT_REGISTRY_REPO" --location="$REGION" --project="$PROJECT_ID" &>/dev/null; then
    echo -e "${YELLOW}Repository '$ARTIFACT_REGISTRY_REPO' not found. Creating it...${NC}"
    gcloud artifacts repositories create "$ARTIFACT_REGISTRY_REPO" \
        --repository-format=docker \
        --location="$REGION" \
        --description="Docker repository for leanworks-hub" \
        --project="$PROJECT_ID"
    echo -e "${GREEN}Repository created successfully!${NC}"
else
    echo -e "${GREEN}Repository '$ARTIFACT_REGISTRY_REPO' already exists.${NC}"
fi

# Get cluster credentials
echo -e "${YELLOW}Getting GKE cluster credentials...${NC}"
gcloud container clusters get-credentials "$CLUSTER_NAME" --region="$REGION" --project="$PROJECT_ID"

# Create Kubernetes secret for GCP credentials (for Cloud SQL Proxy)
echo -e "${YELLOW}Creating Kubernetes secret for GCP credentials...${NC}"
if kubectl get secret gcp-credentials -n default &>/dev/null; then
    echo -e "${YELLOW}Secret already exists, updating...${NC}"
    kubectl create secret generic gcp-credentials \
        --from-file=gcp_credential.json="$GCP_CREDENTIAL_FILE" \
        --dry-run=client -o yaml | kubectl apply -f -
    echo -e "${GREEN}Secret updated!${NC}"
else
    kubectl create secret generic gcp-credentials \
        --from-file=gcp_credential.json="$GCP_CREDENTIAL_FILE"
    echo -e "${GREEN}Secret created!${NC}"
fi

# Extract service account email for verification
if command -v jq &> /dev/null; then
    GSA_EMAIL=$(jq -r '.client_email' "$GCP_CREDENTIAL_FILE")
elif command -v python3 &> /dev/null; then
    GSA_EMAIL=$(python3 -c "import json, sys; print(json.load(open('$GCP_CREDENTIAL_FILE'))['client_email'])")
else
    GSA_EMAIL=$(grep -o '"client_email"[[:space:]]*:[[:space:]]*"[^"]*"' "$GCP_CREDENTIAL_FILE" | sed 's/.*"client_email"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
fi

if [ -z "$GSA_EMAIL" ]; then
    echo -e "${RED}Error: Could not extract client_email from $GCP_CREDENTIAL_FILE${NC}"
    exit 1
fi

echo -e "${GREEN}Using GCP service account: ${GSA_EMAIL}${NC}"

# Grant Cloud SQL Client role to the service account (if needed)
echo -e "${YELLOW}Verifying Cloud SQL Client role for ${GSA_EMAIL}...${NC}"
if gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${GSA_EMAIL}" \
    --role="roles/cloudsql.client" \
    --condition=None \
    --quiet 2>/dev/null; then
    echo -e "${GREEN}Cloud SQL Client role granted successfully.${NC}"
else
    EXIT_CODE=$?
    if [ $EXIT_CODE -ne 0 ]; then
        echo -e "${YELLOW}⚠️  Could not grant Cloud SQL Client role automatically (exit code: $EXIT_CODE).${NC}"
        echo -e "${YELLOW}   The role may already be granted. If not, please run manually:${NC}"
        echo -e "   gcloud projects add-iam-policy-binding ${PROJECT_ID} \\"
        echo -e "     --member=\"serviceAccount:${GSA_EMAIL}\" \\"
        echo -e "     --role=\"roles/cloudsql.client\""
    fi
fi

# Generate a unique tag based on timestamp
IMAGE_TAG=$(date +%Y%m%d-%H%M%S)
FULL_IMAGE_NAME="${IMAGE_NAME}:${IMAGE_TAG}"

# Build the Docker image for linux/amd64 platform (GKE standard)
echo -e "${YELLOW}Building Docker image for linux/amd64 platform...${NC}"
docker build --platform linux/amd64 -t "$FULL_IMAGE_NAME" -t "$IMAGE_NAME:latest" .

# Push the image to Artifact Registry (both tagged and latest)
echo -e "${YELLOW}Pushing image to Artifact Registry...${NC}"
docker push "$FULL_IMAGE_NAME"
docker push "$IMAGE_NAME:latest"

# Apply Kubernetes manifests (for initial deployment or config changes)
echo -e "${YELLOW}Applying Kubernetes manifests...${NC}"
kubectl apply -f k8s/backend-config.yaml
kubectl apply -f k8s/cloud-sql-proxy.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/ingress.yaml

# Update the deployment with the new image tag
echo -e "${YELLOW}Updating Kubernetes deployment with new image tag...${NC}"
kubectl set image deployment/leanworks-hub leanworks-hub="$FULL_IMAGE_NAME" -n default

# Force a rollout restart to ensure the new image is pulled
echo -e "${YELLOW}Forcing deployment rollout...${NC}"
kubectl rollout restart deployment/leanworks-hub

# Wait for deployment to be ready
echo -e "${YELLOW}Waiting for deployment to be ready...${NC}"
kubectl rollout status deployment/leanworks-hub

# Get service information
echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${YELLOW}Service information:${NC}"
kubectl get service leanworks-hub-service

echo -e "${GREEN}To get the external IP, run:${NC}"
echo "kubectl get service leanworks-hub-service"

