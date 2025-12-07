#!/bin/bash

# LiveKit Testing Script
# Tests LiveKit deployment and token generation

set -e

echo "🧪 LiveKit Testing Script"
echo "========================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Step 1: Check LiveKit pods
echo -e "${YELLOW}Step 1: Checking LiveKit Pods${NC}"
PODS=$(kubectl get pods -l app=livekit-server -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
if [ -z "$PODS" ]; then
    echo -e "${RED}❌ No LiveKit pods found${NC}"
    exit 1
fi

for POD in $PODS; do
    STATUS=$(kubectl get pod $POD -o jsonpath='{.status.phase}')
    if [ "$STATUS" = "Running" ]; then
        echo -e "${GREEN}✅ Pod $POD is Running${NC}"
    else
        echo -e "${YELLOW}⚠️  Pod $POD status: $STATUS${NC}"
    fi
done
echo ""

# Step 2: Check LiveKit service
echo -e "${YELLOW}Step 2: Checking LiveKit Service${NC}"
EXTERNAL_IP=$(kubectl get svc livekit-service -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
if [ -z "$EXTERNAL_IP" ]; then
    echo -e "${RED}❌ LoadBalancer IP not found${NC}"
    echo "Service status:"
    kubectl get svc livekit-service
    exit 1
fi
echo -e "${GREEN}✅ LoadBalancer IP: ${EXTERNAL_IP}${NC}"
echo ""

# Step 3: Test HTTP endpoint
echo -e "${YELLOW}Step 3: Testing HTTP Endpoint${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://${EXTERNAL_IP}:7880 || echo "000")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "404" ]; then
    echo -e "${GREEN}✅ HTTP endpoint responding (${HTTP_CODE})${NC}"
else
    echo -e "${RED}❌ HTTP endpoint not responding (${HTTP_CODE})${NC}"
fi
echo ""

# Step 4: Check LiveKit logs
echo -e "${YELLOW}Step 4: Checking Recent LiveKit Logs${NC}"
POD_NAME=$(kubectl get pods -l app=livekit-server -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -n "$POD_NAME" ]; then
    echo "Last 10 lines of logs:"
    kubectl logs $POD_NAME --tail=10 2>&1 | grep -i -E "(error|warn|info|started|listening)" || echo "No relevant log entries"
else
    echo -e "${RED}❌ Could not find LiveKit pod${NC}"
fi
echo ""

# Step 5: Test token generation (if backend is accessible)
echo -e "${YELLOW}Step 5: Testing Token Generation${NC}"
echo "This requires your backend to be running and accessible."
echo ""

# Try to get backend service URL
BACKEND_URL=""
if kubectl get svc leanworks-hub-service >/dev/null 2>&1; then
    BACKEND_IP=$(kubectl get svc leanworks-hub-service -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
    if [ -n "$BACKEND_IP" ]; then
        BACKEND_URL="http://${BACKEND_IP}/api"
    fi
fi

if [ -z "$BACKEND_URL" ]; then
    echo "Backend service not accessible via LoadBalancer."
    echo "You can test token generation manually:"
    echo "  1. Get an auth token from your app"
    echo "  2. Call: curl -H 'Authorization: Bearer <token>' '${BACKEND_URL:-http://localhost:3001}/api/livekit/token?roomName=test-room'"
else
    echo "Backend URL: ${BACKEND_URL}"
    echo "To test token generation, you need an auth token."
    echo "Run this command with a valid token:"
    echo "  curl -H 'Authorization: Bearer <your-token>' '${BACKEND_URL}/livekit/token?roomName=test-room'"
fi
echo ""

# Step 6: Verify environment variables
echo -e "${YELLOW}Step 6: Verifying Configuration${NC}"
echo "LiveKit Secret:"
kubectl get secret livekit-secrets -o jsonpath='{.data.api-key}' 2>/dev/null | base64 -d 2>/dev/null && echo "" || echo "Could not read secret"
echo ""

echo "Backend LIVEKIT_URL:"
kubectl get deployment leanworks-hub -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="LIVEKIT_URL")].value}' 2>/dev/null && echo "" || echo "Not set"
echo ""

# Summary
echo -e "${GREEN}============================${NC}"
echo -e "${GREEN}✅ Testing Complete${NC}"
echo -e "${GREEN}============================${NC}"
echo ""
echo "LiveKit is accessible at:"
echo "  - ws://${EXTERNAL_IP}:7880"
echo "  - wss://${EXTERNAL_IP}:7881 (if SSL configured)"
echo ""
echo "To view LiveKit logs:"
echo "  kubectl logs -f deployment/livekit-server"
echo ""
echo "To test a voice call:"
echo "  1. Ensure your frontend is configured with the correct LIVEKIT_URL"
echo "  2. Start a voice call from your app"
echo "  3. Check browser console and LiveKit logs for any errors"
echo ""

