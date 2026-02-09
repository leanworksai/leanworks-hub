#!/bin/bash

set -e

# Configuration
ENVIRONMENT="${1:-prod}"  # Default to "prod" if no argument provided
CLUSTER_NAME="leanworks-${ENVIRONMENT}"
DB_INSTANCE_NAME="leanworks-${ENVIRONMENT}"
AUDIO_STORAGE_BUCKET="leanworks-${ENVIRONMENT}"
FIRESTORE_DATABASE_NAME="leanworks-${ENVIRONMENT}"
REGION="us-west1"  # Update this to your cluster's region
if [ "$ENVIRONMENT" = "dev" ]; then
    GCP_CREDENTIAL_FILE="gcp_credential_dev.json"
    CONFIGMAP_FILE="k8s/configmap-dev.yaml"
    GCP_SECRET_NAME="gcp-credentials-dev"
else
    GCP_CREDENTIAL_FILE="gcp_credential.json"
    CONFIGMAP_FILE="k8s/configmap.yaml"
    GCP_SECRET_NAME="gcp-credentials"
fi
ARTIFACT_REGISTRY_REPO="docker-repo"  # Artifact Registry repository name

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting deployment to GKE (${ENVIRONMENT} environment)...${NC}"

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
if kubectl get secret "$GCP_SECRET_NAME" -n default &>/dev/null; then
    echo -e "${YELLOW}Secret already exists, updating...${NC}"
    kubectl create secret generic "$GCP_SECRET_NAME" \
        --from-file=gcp_credential.json="$GCP_CREDENTIAL_FILE" \
        --dry-run=client -o yaml | kubectl apply -f -
    echo -e "${GREEN}Secret updated!${NC}"
else
    kubectl create secret generic "$GCP_SECRET_NAME" \
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

# Ensure Kubernetes service account exists and is annotated for Workload Identity
echo -e "${YELLOW}Ensuring Kubernetes service account exists...${NC}"
kubectl apply -f k8s/serviceaccount.yaml
kubectl annotate serviceaccount leanworks-hub-sa \
    iam.gke.io/gcp-service-account="${GSA_EMAIL}" \
    --overwrite 1>/dev/null
echo -e "${GREEN}Kubernetes service account annotated for Workload Identity.${NC}"

# Allow KSA to impersonate GSA (Workload Identity)
echo -e "${YELLOW}Binding Workload Identity user role...${NC}"
if ! gcloud iam service-accounts add-iam-policy-binding "${GSA_EMAIL}" \
    --role="roles/iam.workloadIdentityUser" \
    --member="serviceAccount:${PROJECT_ID}.svc.id.goog[default/leanworks-hub-sa]" \
    --quiet 2>/dev/null; then
    echo -e "${YELLOW}⚠️  Could not bind Workload Identity user role automatically.${NC}"
    echo -e "${YELLOW}   If Workload Identity is enabled, run manually:${NC}"
    echo -e "   gcloud iam service-accounts add-iam-policy-binding ${GSA_EMAIL} \\"
    echo -e "     --role=\"roles/iam.workloadIdentityUser\" \\"
    echo -e "     --member=\"serviceAccount:${PROJECT_ID}.svc.id.goog[default/leanworks-hub-sa]\""
fi

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
CONFIGMAP_TEMPLATE="${CONFIGMAP_FILE%.yaml}.tmpl.yaml"
if [ -f "$CONFIGMAP_TEMPLATE" ]; then
    CONFIGMAP_MANIFEST=$(mktemp)
    sed -e "s|__PROJECT_ID__|$PROJECT_ID|g" \
        "$CONFIGMAP_TEMPLATE" > "$CONFIGMAP_MANIFEST"
    kubectl apply -f "$CONFIGMAP_MANIFEST"
    rm -f "$CONFIGMAP_MANIFEST"
else
    kubectl apply -f "$CONFIGMAP_FILE"
fi
kubectl apply -f k8s/backend-config.yaml
SQL_PROXY_TEMPLATE="k8s/cloud-sql-proxy.tmpl.yaml"
if [ -f "$SQL_PROXY_TEMPLATE" ]; then
    SQL_PROXY_MANIFEST=$(mktemp)
    sed -e "s|__GCP_SECRET__|$GCP_SECRET_NAME|g" \
        "$SQL_PROXY_TEMPLATE" > "$SQL_PROXY_MANIFEST"
    kubectl apply -f "$SQL_PROXY_MANIFEST"
    rm -f "$SQL_PROXY_MANIFEST"
else
    kubectl apply -f k8s/cloud-sql-proxy.yaml
fi
DEPLOYMENT_TEMPLATE="k8s/deployment.tmpl.yaml"
if [ -f "$DEPLOYMENT_TEMPLATE" ]; then
    DEPLOYMENT_MANIFEST=$(mktemp)
    sed -e "s|__IMAGE__|$FULL_IMAGE_NAME|g" \
        -e "s|__GCP_SECRET__|$GCP_SECRET_NAME|g" \
        "$DEPLOYMENT_TEMPLATE" > "$DEPLOYMENT_MANIFEST"
    kubectl apply -f "$DEPLOYMENT_MANIFEST"
    rm -f "$DEPLOYMENT_MANIFEST"
else
    kubectl apply -f k8s/deployment.yaml
fi

# Apply environment-specific ingress and certificates
if [ "$ENVIRONMENT" = "dev" ]; then
    echo -e "${YELLOW}Applying dev-specific ingress and certificates...${NC}"
    kubectl apply -f k8s/ingress-dev.yaml
else
    echo -e "${YELLOW}Applying production ingress...${NC}"
    kubectl apply -f k8s/ingress.yaml
fi

# Update the deployment with the new image tag
echo -e "${YELLOW}Updating Kubernetes deployment with new image tag...${NC}"
kubectl set image deployment/leanworks-hub leanworks-hub="$FULL_IMAGE_NAME" -n default

# Force a rollout restart to ensure the new image/config are applied
echo -e "${YELLOW}Forcing deployment rollouts...${NC}"
kubectl rollout restart deployment/leanworks-hub
kubectl rollout restart deployment/cloud-sql-proxy

# Wait for deployments to be ready

echo -e "${YELLOW}Waiting for deployments to be ready...${NC}"
kubectl rollout status deployment/leanworks-hub
kubectl rollout status deployment/cloud-sql-proxy

# Note: LIVEKIT_URL is now handled by ConfigMap in deployment.yaml
# No manual override needed - ConfigMap provides environment-specific URLs

# Get service information
echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${YELLOW}Service information:${NC}"
kubectl get service leanworks-hub-service

# Display IP addresses for DNS mapping
echo -e "${GREEN}IP Addresses for DNS mapping:${NC}"
if [ "$ENVIRONMENT" = "dev" ]; then
    DEV_IP=$(gcloud compute addresses describe leanworks-dev-hub-ip --global --format="value(address)" 2>/dev/null)
    if [ -n "$DEV_IP" ]; then
        echo -e "${GREEN}Dev Ingress IP: ${DEV_IP}${NC}"
        echo -e "${YELLOW}DNS Records needed:${NC}"
        echo -e "  dev.leanworks.ai     → A record → ${DEV_IP}"
    else
        echo -e "${YELLOW}⚠️  Dev IP not available yet. Run this command to get it:${NC}"
        echo "gcloud compute addresses describe leanworks-dev-hub-ip --global --format=\"value(address)\""
    fi
else
    # For production, show current ingress IP
    PROD_IP=$(kubectl get ingress leanworks-hub-ingress -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)
    if [ -n "$PROD_IP" ]; then
        echo -e "${GREEN}Production Ingress IP: ${PROD_IP}${NC}"
    fi
fi

echo -e "${GREEN}To get the external IPs manually, run:${NC}"
echo "kubectl get service leanworks-hub-service"
