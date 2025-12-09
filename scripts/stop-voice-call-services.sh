#!/bin/bash

# Stop voice call services for local development

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🛑 Stopping voice call services..."

# Stop Redis
if docker ps --format '{{.Names}}' | grep -q "^livekit-redis$"; then
  echo "   Stopping Redis..."
  docker stop livekit-redis
  echo -e "${GREEN}✅ Redis stopped${NC}"
else
  echo "   Redis is not running"
fi

# Stop LiveKit server
if docker ps --format '{{.Names}}' | grep -q "^livekit-server$"; then
  echo "   Stopping LiveKit server..."
  docker stop livekit-server
  echo -e "${GREEN}✅ LiveKit server stopped${NC}"
else
  echo "   LiveKit server is not running"
fi

# Stop LiveKit egress
if docker ps --format '{{.Names}}' | grep -q "^livekit-egress$"; then
  echo "   Stopping LiveKit egress..."
  docker stop livekit-egress
  echo -e "${GREEN}✅ LiveKit egress stopped${NC}"
else
  echo "   LiveKit egress is not running"
fi

echo ""
echo -e "${GREEN}✅ All voice call services stopped${NC}"
echo ""
echo "To remove containers completely, run:"
echo "  docker rm livekit-redis livekit-server livekit-egress"

