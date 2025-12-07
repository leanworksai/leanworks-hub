#!/bin/bash

# LiveKit Deployment Script
# This script helps deploy and test LiveKit on GCP Kubernetes

set -e

echo "🚀 LiveKit Deployment Script"
echo "============================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Create Kubernetes Secret
echo -e "${YELLOW}Step 1: Creating Kubernetes Secret for LiveKit${NC}"
echo ""

# Check if secret already exists
if kubectl get secret livekit-secrets >/dev/null 2>&1; then
    echo -e "${YELLOW}Secret 'livekit-secrets' already exists.${NC}"
    read -p "Do you want to update it? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        kubectl delete secret livekit-secrets
    else
        echo "Using existing secret..."
    fi
fi

# Prompt for API credentials
if ! kubectl get secret livekit-secrets >/dev/null 2>&1; then
    echo "Enter LiveKit API credentials:"
    read -p "API Key (e.g., 'devkey' for dev): " API_KEY
    read -sp "API Secret (min 32 chars, will be hidden): " API_SECRET
    echo ""
    read -p "Redis URL (optional, press Enter to skip): " REDIS_URL
    
    # Create secret
    if [ -z "$REDIS_URL" ]; then
        kubectl create secret generic livekit-secrets \
            --from-literal=api-key="$API_KEY" \
            --from-literal=api-secret="$API_SECRET" \
            --from-literal=redis-url=""
    else
        kubectl create secret generic livekit-secrets \
            --from-literal=api-key="$API_KEY" \
            --from-literal=api-secret="$API_SECRET" \
            --from-literal=redis-url="$REDIS_URL"
    fi
    
    echo -e "${GREEN}✅ Secret created${NC}"
else
    echo -e "${GREEN}✅ Using existing secret${NC}"
fi

echo ""

# Step 2: Deploy LiveKit
echo -e "${YELLOW}Step 2: Deploying LiveKit Server${NC}"
kubectl apply -f k8s/livekit-deployment.yaml
echo -e "${GREEN}✅ LiveKit deployment applied${NC}"
echo ""

# Step 3: Wait for deployment
echo -e "${YELLOW}Step 3: Waiting for LiveKit pods to be ready${NC}"
kubectl wait --for=condition=available --timeout=300s deployment/livekit-server || {
    echo -e "${RED}❌ Deployment timeout. Checking status...${NC}"
    kubectl get pods -l app=livekit-server
    exit 1
}
echo -e "${GREEN}✅ LiveKit pods are ready${NC}"
echo ""

# Step 4: Get LoadBalancer IP
echo -e "${YELLOW}Step 4: Getting LoadBalancer External IP${NC}"
echo "Waiting for LoadBalancer to be provisioned (this may take 2-5 minutes)..."
EXTERNAL_IP=""
MAX_WAIT=300  # 5 minutes
ELAPSED=0

while [ -z "$EXTERNAL_IP" ] && [ $ELAPSED -lt $MAX_WAIT ]; do
    EXTERNAL_IP=$(kubectl get svc livekit-service -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
    if [ -z "$EXTERNAL_IP" ]; then
        echo "Waiting for LoadBalancer IP... (${ELAPSED}s)"
        sleep 10
        ELAPSED=$((ELAPSED + 10))
    fi
done

if [ -z "$EXTERNAL_IP" ]; then
    echo -e "${RED}❌ Failed to get LoadBalancer IP after ${MAX_WAIT}s${NC}"
    echo "Check service status:"
    kubectl get svc livekit-service
    exit 1
fi

echo -e "${GREEN}✅ LoadBalancer IP: ${EXTERNAL_IP}${NC}"
echo ""

# Step 5: Test LiveKit server
echo -e "${YELLOW}Step 5: Testing LiveKit Server${NC}"
echo "Testing HTTP endpoint..."
HTTP_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://${EXTERNAL_IP}:7880 || echo "000")
if [ "$HTTP_RESPONSE" = "200" ] || [ "$HTTP_RESPONSE" = "404" ]; then
    echo -e "${GREEN}✅ LiveKit server is responding (HTTP ${HTTP_RESPONSE})${NC}"
else
    echo -e "${YELLOW}⚠️  LiveKit server response: HTTP ${HTTP_RESPONSE}${NC}"
    echo "This might be normal if the server is still starting up."
fi
echo ""

# Step 6: Update backend deployment
echo -e "${YELLOW}Step 6: Updating Backend Deployment${NC}"
echo "Current LIVEKIT_URL in deployment:"
kubectl get deployment leanworks-hub -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="LIVEKIT_URL")].value}' 2>/dev/null || echo "Not found"
echo ""

LIVEKIT_URL="ws://${EXTERNAL_IP}:7880"
echo "Setting LIVEKIT_URL to: ${LIVEKIT_URL}"
kubectl set env deployment/leanworks-hub LIVEKIT_URL="${LIVEKIT_URL}" || {
    echo -e "${RED}❌ Failed to update deployment${NC}"
    echo "You may need to manually update k8s/deployment.yaml and redeploy"
    exit 1
}

echo -e "${GREEN}✅ Backend deployment updated${NC}"
echo "Waiting for backend to restart..."
kubectl rollout status deployment/leanworks-hub --timeout=120s || echo "Rollout may still be in progress"
echo ""

# Step 7: Summary
echo -e "${GREEN}============================${NC}"
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo -e "${GREEN}============================${NC}"
echo ""
echo "LiveKit Configuration:"
echo "  - External IP: ${EXTERNAL_IP}"
echo "  - WebSocket URL: ws://${EXTERNAL_IP}:7880"
echo "  - HTTPS URL: wss://${EXTERNAL_IP}:7881 (if SSL configured)"
echo ""
echo "Next Steps:"
echo "  1. For production, set up a domain and SSL certificate"
echo "  2. Update LIVEKIT_URL to use the domain: wss://livekit.leanworks.ai"
echo "  3. Test token generation from your backend"
echo ""
echo "To check LiveKit logs:"
echo "  kubectl logs -f deployment/livekit-server"
echo ""
echo "To check service status:"
echo "  kubectl get svc livekit-service"
echo ""

