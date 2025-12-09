#!/bin/bash

# Ensure voice call services are running for local development
# This script checks and starts:
# 1. Redis (required by LiveKit)
# 2. LiveKit server
# 3. LiveKit egress service
#
# Similar to how cloud-sql-proxy is handled in dev:proxy

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LIVEKIT_CONFIG="$PROJECT_ROOT/livekit.local.yaml"
EGRESS_CONFIG="$PROJECT_ROOT/egress.local.yaml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check if a port is in use
check_port() {
  local port=$1
  if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
    return 0  # Port is in use
  else
    return 1  # Port is not in use
  fi
}

# Function to check if a Docker container is running
check_container() {
  local container_name=$1
  if docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
    return 0  # Container is running
  else
    return 1  # Container is not running
  fi
}

# Function to start Redis
start_redis() {
  echo -e "${YELLOW}⚠️  Redis is not running. Starting Redis container...${NC}"
  
  if docker ps -a --format '{{.Names}}' | grep -q "^livekit-redis$"; then
    echo "   Redis container exists but stopped. Starting it..."
    docker start livekit-redis
  else
    echo "   Creating new Redis container..."
    docker run -d --name livekit-redis -p 6379:6379 redis:7-alpine
  fi
  
  # Wait for Redis to be ready
  echo "   Waiting for Redis to be ready..."
  for i in {1..10}; do
    if docker exec livekit-redis redis-cli ping >/dev/null 2>&1; then
      echo -e "${GREEN}✅ Redis started and ready${NC}"
      return 0
    fi
    sleep 1
  done
  
  echo -e "${RED}❌ Redis failed to start${NC}"
  return 1
}

# Function to start LiveKit server
start_livekit() {
  echo -e "${YELLOW}⚠️  LiveKit server is not running. Starting LiveKit server...${NC}"
  
  if [ ! -f "$LIVEKIT_CONFIG" ]; then
    echo -e "${RED}❌ LiveKit config file not found: $LIVEKIT_CONFIG${NC}"
    return 1
  fi
  
  # Start LiveKit server in detached mode
  docker run -d \
    --name livekit-server \
    -p 7880:7880 \
    -p 50000-50010:50000-50010/udp \
    -p 50000-50010:50000-50010/tcp \
    -v "$LIVEKIT_CONFIG:/etc/livekit/livekit.yaml" \
    livekit/livekit-server \
    --config /etc/livekit/livekit.yaml >/dev/null 2>&1 || {
    # If container already exists, start it
    if docker ps -a --format '{{.Names}}' | grep -q "^livekit-server$"; then
      echo "   LiveKit container exists but stopped. Starting it..."
      docker start livekit-server
    else
      echo -e "${RED}❌ Failed to start LiveKit server${NC}"
      return 1
    fi
  }
  
  # Wait for LiveKit to be ready
  echo "   Waiting for LiveKit server to be ready..."
  for i in {1..30}; do
    if check_port 7880; then
      echo -e "${GREEN}✅ LiveKit server started and ready${NC}"
      return 0
    fi
    sleep 1
  done
  
  echo -e "${RED}❌ LiveKit server failed to start${NC}"
  return 1
}

# Function to start LiveKit egress
start_egress() {
  echo -e "${YELLOW}⚠️  LiveKit egress is not running. Starting egress service...${NC}"
  
  if [ ! -f "$EGRESS_CONFIG" ]; then
    echo -e "${RED}❌ Egress config file not found: $EGRESS_CONFIG${NC}"
    return 1
  fi
  
  # Start egress in detached mode
  docker run -d \
    --name livekit-egress \
    --network host \
    -e EGRESS_CONFIG_FILE=/out/config.yaml \
    -v "$EGRESS_CONFIG:/out/config.yaml" \
    livekit/egress >/dev/null 2>&1 || {
    # If container already exists, start it
    if docker ps -a --format '{{.Names}}' | grep -q "^livekit-egress$"; then
      echo "   Egress container exists but stopped. Starting it..."
      docker start livekit-egress
    else
      echo -e "${RED}❌ Failed to start LiveKit egress${NC}"
      return 1
    fi
  }
  
  # Wait a bit for egress to initialize
  sleep 2
  echo -e "${GREEN}✅ LiveKit egress started${NC}"
  return 0
}

# Main function
main() {
  echo "🔍 Checking voice call services..."
  
  local services_ok=true
  
  # Check Redis
  if check_container "livekit-redis"; then
    echo -e "${GREEN}✅ Redis is running${NC}"
  elif check_port 6379; then
    echo -e "${GREEN}✅ Redis port 6379 is in use (may be running outside Docker)${NC}"
  else
    if ! start_redis; then
      services_ok=false
    fi
  fi
  
  # Check LiveKit server
  if check_container "livekit-server"; then
    echo -e "${GREEN}✅ LiveKit server is running${NC}"
  elif check_port 7880; then
    echo -e "${GREEN}✅ LiveKit port 7880 is in use (may be running outside Docker)${NC}"
  else
    if ! start_livekit; then
      services_ok=false
    fi
  fi
  
  # Check LiveKit egress
  if check_container "livekit-egress"; then
    echo -e "${GREEN}✅ LiveKit egress is running${NC}"
  else
    if ! start_egress; then
      services_ok=false
    fi
  fi
  
  if [ "$services_ok" = true ]; then
    echo ""
    echo -e "${GREEN}✅ All voice call services are running${NC}"
    echo ""
    echo "Services:"
    echo "  - Redis: localhost:6379"
    echo "  - LiveKit Server: ws://localhost:7880"
    echo "  - LiveKit Egress: running"
    echo ""
    echo "To stop services, run:"
    echo "  docker stop livekit-redis livekit-server livekit-egress"
    echo ""
    return 0
  else
    echo ""
    echo -e "${RED}❌ Some services failed to start${NC}"
    return 1
  fi
}

# Run main function
main "$@"

