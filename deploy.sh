#!/bin/bash

set -e

# Configuration
PROJECT_ID="leanworks"
CLUSTER_NAME="leanworks-cluster"
REGION="us-central1"  # Update this to your cluster's region
IMAGE_NAME="gcr.io/${PROJECT_ID}/leanworks-hub"
GCP_CREDENTIAL_FILE="gcp_credential.json"

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

# Set up GCP authentication
echo -e "${YELLOW}Setting up GCP authentication...${NC}"
export GOOGLE_APPLICATION_CREDENTIALS="$GCP_CREDENTIAL_FILE"
gcloud auth activate-service-account --key-file="$GCP_CREDENTIAL_FILE"

# Set the project
echo -e "${YELLOW}Setting GCP project to ${PROJECT_ID}...${NC}"
gcloud config set project "$PROJECT_ID"

# Configure Docker to use gcloud as a credential helper
echo -e "${YELLOW}Configuring Docker authentication...${NC}"
gcloud auth configure-docker

# Get cluster credentials
echo -e "${YELLOW}Getting GKE cluster credentials...${NC}"
gcloud container clusters get-credentials "$CLUSTER_NAME" --region="$REGION" --project="$PROJECT_ID"

# Build the Docker image for linux/amd64 platform (GKE standard)
echo -e "${YELLOW}Building Docker image for linux/amd64 platform...${NC}"
docker build --platform linux/amd64 -t "$IMAGE_NAME:latest" .

# Push the image to Google Container Registry
echo -e "${YELLOW}Pushing image to GCR...${NC}"
docker push "$IMAGE_NAME:latest"

# Apply Kubernetes manifests
echo -e "${YELLOW}Deploying to Kubernetes...${NC}"
kubectl apply -f k8s/deployment.yaml

# Wait for deployment to be ready
echo -e "${YELLOW}Waiting for deployment to be ready...${NC}"
kubectl rollout status deployment/leanworks-hub

# Get service information
echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${YELLOW}Service information:${NC}"
kubectl get service leanworks-hub-service

echo -e "${GREEN}To get the external IP, run:${NC}"
echo "kubectl get service leanworks-hub-service"

