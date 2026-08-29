#!/bin/bash

set -e

# Configuration
CLUSTER_NAME="leanworks-prod"
REGION="us-west1"  # Update this to your cluster's region
ARTIFACT_REGISTRY_REPO="docker-repo"  # Artifact Registry repository name

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting deployment to GKE...${NC}"

# Use the explicitly selected project or the active gcloud project. The
# operator authenticates with gcloud; workloads authenticate with Workload Identity.
PROJECT_ID="${GCP_PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null)}}"
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
    echo -e "${RED}Error: Set GCP_PROJECT_ID or select a project with gcloud config set project.${NC}"
    exit 1
fi
GSA_EMAIL="${GCP_SERVICE_ACCOUNT_EMAIL:-deployment@${PROJECT_ID}.iam.gserviceaccount.com}"

IMAGE_NAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REGISTRY_REPO}/leanworks-hub"

# Verify the operator already has an authenticated gcloud session.
echo -e "${YELLOW}Checking GCP authentication...${NC}"
if ! gcloud auth print-access-token >/dev/null 2>&1; then
    echo -e "${RED}Error: No active gcloud session. Run gcloud auth login first.${NC}"
    exit 1
fi

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

echo -e "${GREEN}Using GCP service account: ${GSA_EMAIL}${NC}"

# Configure the Kubernetes service account for GKE Workload Identity.
echo -e "${YELLOW}Configuring Workload Identity...${NC}"
kubectl apply -f k8s/serviceaccount.yaml
kubectl annotate serviceaccount leanworks-hub-sa \
    iam.gke.io/gcp-service-account="${GSA_EMAIL}" \
    --overwrite 1>/dev/null
if ! gcloud iam service-accounts add-iam-policy-binding "${GSA_EMAIL}" \
    --role="roles/iam.workloadIdentityUser" \
    --member="serviceAccount:${PROJECT_ID}.svc.id.goog[default/leanworks-hub-sa]" \
    --quiet 2>/dev/null; then
    echo -e "${YELLOW}⚠️  Could not bind the Workload Identity user role automatically.${NC}"
    echo -e "${YELLOW}   Verify that the GSA exists and the current account can update its IAM policy.${NC}"
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
kubectl apply -f k8s/backend-config.yaml
kubectl apply -f k8s/cloud-sql-proxy.yaml
kubectl apply -f k8s/livekit-deployment.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/ingress.yaml

# Update the deployment with the new image tag
echo -e "${YELLOW}Updating Kubernetes deployment with new image tag...${NC}"
kubectl set image deployment/leanworks-hub leanworks-hub="$FULL_IMAGE_NAME" -n default

# Force a rollout restart to ensure the new image is pulled
echo -e "${YELLOW}Forcing deployment rollout...${NC}"
kubectl rollout restart deployment/leanworks-hub

# Wait for deployments to be ready
echo -e "${YELLOW}Waiting for LiveKit deployment to be ready...${NC}"
if kubectl wait --for=condition=available --timeout=300s deployment/livekit-server 2>/dev/null; then
    echo -e "${GREEN}✅ LiveKit deployment is ready${NC}"
else
    echo -e "${YELLOW}⚠️  LiveKit deployment may still be starting...${NC}"
    kubectl get pods -l app=livekit-server
fi

echo -e "${YELLOW}Waiting for backend deployment to be ready...${NC}"
kubectl rollout status deployment/leanworks-hub

# Get LiveKit LoadBalancer IP and update backend if available
echo -e "${YELLOW}Checking LiveKit LoadBalancer IP...${NC}"
EXTERNAL_IP=$(kubectl get svc livekit-service -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")

if [ -n "$EXTERNAL_IP" ]; then
    echo -e "${GREEN}✅ LiveKit LoadBalancer IP: ${EXTERNAL_IP}${NC}"
    # Use secure domain URL with SSL (required for HTTPS pages)
    # The ingress routes livekit.leanworks.ai to the LiveKit service
    LIVEKIT_URL="wss://livekit.leanworks.ai"
    echo -e "${YELLOW}Updating backend deployment with LiveKit URL...${NC}"
    if kubectl set env deployment/leanworks-hub LIVEKIT_URL="${LIVEKIT_URL}" 2>/dev/null; then
        echo -e "${GREEN}✅ Backend LIVEKIT_URL updated to: ${LIVEKIT_URL}${NC}"
        echo -e "${GREEN}   (Using secure domain instead of IP for HTTPS compatibility)${NC}"
        kubectl rollout status deployment/leanworks-hub --timeout=120s || echo -e "${YELLOW}⚠️  Rollout may still be in progress${NC}"
    else
        echo -e "${YELLOW}⚠️  Could not update LIVEKIT_URL. You may need to update it manually.${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  LiveKit LoadBalancer IP not available yet.${NC}"
    echo -e "${YELLOW}   The LoadBalancer may take a few minutes to provision.${NC}"
    echo -e "${YELLOW}   Using secure domain URL: wss://livekit.leanworks.ai${NC}"
    # Still set the secure URL even if IP is not available
    LIVEKIT_URL="wss://livekit.leanworks.ai"
    kubectl set env deployment/leanworks-hub LIVEKIT_URL="${LIVEKIT_URL}" 2>/dev/null || echo -e "${YELLOW}⚠️  Could not update LIVEKIT_URL${NC}"
fi

# Get service information
echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${YELLOW}Service information:${NC}"
kubectl get service leanworks-hub-service
echo ""
echo -e "${YELLOW}LiveKit service information:${NC}"
kubectl get service livekit-service livekit-service-udp livekit-service-rtc-tcp 2>/dev/null || echo "LiveKit services may still be provisioning..."

echo -e "${GREEN}To get the external IPs, run:${NC}"
echo "kubectl get service leanworks-hub-service"
echo "kubectl get service livekit-service"
