#!/bin/bash

# Start LiveKit Egress service for local development
# Egress streams audio/video from LiveKit rooms to external destinations

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/egress.local.yaml"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "❌ Config file not found: $CONFIG_FILE"
  exit 1
fi

# Check if Redis is running
if ! docker ps | grep -q redis; then
  echo "⚠️  Redis is not running. Starting Redis container..."
  docker run -d --name livekit-redis -p 6379:6379 redis:7-alpine || {
    if docker ps -a | grep -q livekit-redis; then
      echo "   Redis container exists but stopped. Starting it..."
      docker start livekit-redis
    else
      echo "   Creating new Redis container..."
      docker run -d --name livekit-redis -p 6379:6379 redis:7-alpine
    fi
  }
  echo "✅ Redis started"
  sleep 2
fi

echo "🚀 Starting LiveKit Egress service for local development..."
echo "   LiveKit Server: ws://host.docker.internal:7880"
echo "   Redis: host.docker.internal:6379"
echo "   Config: $CONFIG_FILE"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Run egress service using the official LiveKit egress Docker setup
# Based on: https://github.com/livekit/egress
# Note: LiveKit egress requires GStreamer, which is included in the Docker image
docker run --rm \
  --network host \
  -e EGRESS_CONFIG_FILE=/out/config.yaml \
  -v "$CONFIG_FILE:/out/config.yaml" \
  livekit/egress

