#!/bin/bash

# Quick fix script to update LIVEKIT_URL in production to use secure domain
# This fixes the mixed content error where HTTPS pages try to connect to insecure WebSocket

set -e

echo "🔧 Fixing LIVEKIT_URL in production deployment..."
echo ""

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl not found. Please install kubectl first."
    exit 1
fi

# Check if we can connect to the cluster
if ! kubectl cluster-info &> /dev/null; then
    echo "❌ Cannot connect to Kubernetes cluster. Please check your kubeconfig."
    exit 1
fi

# Get current value
CURRENT_URL=$(kubectl get deployment leanworks-hub -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="LIVEKIT_URL")].value}' 2>/dev/null || echo "not set")
echo "Current LIVEKIT_URL: ${CURRENT_URL}"
echo ""

# Set to secure domain URL
NEW_URL="wss://livekit.leanworks.ai"
echo "Setting LIVEKIT_URL to: ${NEW_URL}"
echo "  (This uses the secure domain with SSL, required for HTTPS pages)"
echo ""

if kubectl set env deployment/leanworks-hub LIVEKIT_URL="${NEW_URL}"; then
    echo "✅ Environment variable updated"
    echo ""
    echo "Waiting for deployment to restart..."
    kubectl rollout status deployment/leanworks-hub --timeout=120s || {
        echo "⚠️  Rollout may still be in progress. Check status with:"
        echo "   kubectl rollout status deployment/leanworks-hub"
    }
    echo ""
    echo "✅ Fix applied! The deployment will restart with the new URL."
    echo ""
    echo "Verification:"
    echo "  kubectl get deployment leanworks-hub -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name==\"LIVEKIT_URL\")].value}'"
    echo ""
    echo "To check if pods are ready:"
    echo "  kubectl get pods -l app=leanworks-hub"
else
    echo "❌ Failed to update deployment"
    echo ""
    echo "You can try manually:"
    echo "  kubectl set env deployment/leanworks-hub LIVEKIT_URL=\"${NEW_URL}\""
    exit 1
fi

