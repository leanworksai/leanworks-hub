#!/bin/bash

# Script to get LiveKit LoadBalancer IP and update backend

set -e

echo "🔍 Getting LiveKit LoadBalancer IP"
echo "=================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if service exists
if ! kubectl get svc livekit-service >/dev/null 2>&1; then
    echo -e "${RED}❌ livekit-service not found${NC}"
    exit 1
fi

# Wait for LoadBalancer IP
echo -e "${YELLOW}Waiting for LoadBalancer IP to be assigned...${NC}"
echo "This can take 2-10 minutes on GCP."
echo ""

MAX_WAIT=600  # 10 minutes
ELAPSED=0
EXTERNAL_IP=""

while [ -z "$EXTERNAL_IP" ] && [ $ELAPSED -lt $MAX_WAIT ]; do
    EXTERNAL_IP=$(kubectl get svc livekit-service -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
    
    if [ -n "$EXTERNAL_IP" ] && [ "$EXTERNAL_IP" != "null" ]; then
        break
    fi
    
    # Show progress every 30 seconds
    if [ $((ELAPSED % 30)) -eq 0 ] && [ $ELAPSED -gt 0 ]; then
        echo "Still waiting... (${ELAPSED}s elapsed)"
    fi
    
    sleep 5
    ELAPSED=$((ELAPSED + 5))
done

if [ -z "$EXTERNAL_IP" ] || [ "$EXTERNAL_IP" = "null" ]; then
    echo -e "${RED}❌ LoadBalancer IP not assigned after ${MAX_WAIT}s${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Check GCP Console > Kubernetes Engine > Services"
    echo "  2. Verify LoadBalancer quotas are not exceeded"
    echo "  3. Check service events: kubectl describe svc livekit-service"
    echo "  4. Try deleting and recreating the service"
    exit 1
fi

echo -e "${GREEN}✅ LoadBalancer IP: ${EXTERNAL_IP}${NC}"
echo ""

# Show service details
echo "Service Details:"
kubectl get svc livekit-service
echo ""

# Test connectivity
echo "Testing HTTP endpoint..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://${EXTERNAL_IP}:7880 || echo "000")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "404" ]; then
    echo -e "${GREEN}✅ HTTP endpoint responding (${HTTP_CODE})${NC}"
else
    echo -e "${YELLOW}⚠️  HTTP endpoint returned ${HTTP_CODE}${NC}"
    echo "This might be normal if the server is still starting."
fi
echo ""

# Update backend deployment
echo -e "${YELLOW}Updating backend deployment with LiveKit URL...${NC}"
# Use secure domain URL with SSL (required for HTTPS pages)
# The ingress routes livekit.leanworks.ai to the LiveKit service
LIVEKIT_URL="wss://livekit.leanworks.ai"

if kubectl set env deployment/leanworks-hub LIVEKIT_URL="${LIVEKIT_URL}" 2>/dev/null; then
    echo -e "${GREEN}✅ Backend deployment updated${NC}"
    echo "   LIVEKIT_URL=${LIVEKIT_URL}"
    echo "   (Using secure domain instead of IP for HTTPS compatibility)"
    echo ""
    echo "Waiting for backend rollout..."
    kubectl rollout status deployment/leanworks-hub --timeout=120s || echo "Rollout may still be in progress"
else
    echo -e "${YELLOW}⚠️  Could not update deployment automatically${NC}"
    echo "Please update manually:"
    echo "  kubectl set env deployment/leanworks-hub LIVEKIT_URL=\"${LIVEKIT_URL}\""
    echo ""
    echo "Or edit k8s/deployment.yaml and set:"
    echo "  - name: LIVEKIT_URL"
    echo "    value: \"${LIVEKIT_URL}\""
fi
echo ""

# Summary
echo -e "${GREEN}============================${NC}"
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo -e "${GREEN}============================${NC}"
echo ""
echo "LiveKit Configuration:"
echo "  - External IP: ${EXTERNAL_IP}"
echo "  - WebSocket URL (via domain): wss://livekit.leanworks.ai"
echo "  - Direct IP (insecure, not recommended): ws://${EXTERNAL_IP}:7880"
echo ""
echo "✅ LIVEKIT_URL has been set to: wss://livekit.leanworks.ai"
echo "   This uses the secure domain with SSL (required for HTTPS pages)"
echo ""
echo "Next Steps:"
echo "  1. Verify the ingress is routing livekit.leanworks.ai correctly"
echo "  2. Test voice calls from your application"
echo "  3. Check that SSL certificate is valid for livekit.leanworks.ai"
echo ""
echo "To view LiveKit logs:"
echo "  kubectl logs -f deployment/livekit-server"
echo ""

