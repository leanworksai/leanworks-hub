#!/bin/bash

# Start LiveKit server for local development
# Uses minimal port range to avoid conflicts

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/livekit.local.yaml"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "❌ Config file not found: $CONFIG_FILE"
  exit 1
fi

echo "🚀 Starting LiveKit server for local development..."
echo "   WebSocket: ws://localhost:7880"
echo "   RTC Ports: 50000-50010 (UDP/TCP)"
echo "   Config: $CONFIG_FILE"
echo ""
echo "Press Ctrl+C to stop"
echo ""

docker run --rm \
  -p 7880:7880 \
  -p 50000-50010:50000-50010/udp \
  -p 50000-50010:50000-50010/tcp \
  -v "$CONFIG_FILE:/etc/livekit/livekit.yaml" \
  livekit/livekit-server \
  --config /etc/livekit/livekit.yaml

