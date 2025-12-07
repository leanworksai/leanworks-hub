#!/bin/bash

# Test LiveKit token endpoint
# This will help us see the actual server error

echo "🧪 Testing LiveKit token endpoint..."
echo ""

# You'll need to replace this with a valid auth token
# For now, this will show us the error response format
curl -v "http://localhost:3001/api/livekit/token?roomName=test-room&participantName=test-user" \
  -H "Content-Type: application/json" \
  2>&1 | grep -A 20 "< HTTP\|error\|Error"

echo ""
echo "💡 Note: This will fail with 401 (unauthorized) without a valid auth token"
echo "   But it will show us if the endpoint is reachable and what error format we get"

