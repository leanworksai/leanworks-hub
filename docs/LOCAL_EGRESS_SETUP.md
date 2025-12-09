# Setting Up LiveKit Egress for Local Development

This guide explains how to run LiveKit egress service locally to enable transcription during local development.

## Prerequisites

1. **Redis**: The egress service requires Redis for communication with the LiveKit server
2. **Docker**: For running the egress service container

## Quick Start

### 1. Start Redis (if not already running)

The startup script will automatically start Redis, but you can also start it manually:

```bash
docker run -d --name livekit-redis -p 6379:6379 redis:7-alpine
```

### 2. Start LiveKit Server

In one terminal, start the LiveKit server:

```bash
./scripts/start-livekit-local.sh
```

### 3. Start Egress Service

In another terminal, start the egress service:

```bash
./scripts/start-livekit-egress-local.sh
```

### 4. Start Your Backend Server

In a third terminal, start your backend:

```bash
npm run dev
```

## How It Works

1. **LiveKit Server** (`ws://localhost:7880`): Handles WebRTC connections and room management
2. **Egress Service**: Connects to LiveKit server via Redis, streams audio to your WebSocket endpoint
3. **Your Backend**: Receives audio via WebSocket at `/api/livekit/audio-ws` and processes it for transcription

## Configuration

The egress service is configured via `egress.local.yaml`:

```yaml
logging:
  level: debug

api_key: devkey
api_secret: devsecret
ws_url: ws://localhost:7880

redis:
  address: localhost:6379
```

This matches your local LiveKit server configuration in `livekit.local.yaml`.

## Verification

Once all services are running, you should see:

1. **In LiveKit server logs**: Normal room and participant events
2. **In Egress service logs**: Connection to LiveKit server and Redis
3. **In your backend logs**: 
   - `✅ Egress started successfully` (instead of the warning)
   - `🎵 Audio chunk processed for...` (when audio is streaming)
   - `📝 Transcript for...` (when transcripts are generated)

## Troubleshooting

### Egress service can't connect to LiveKit

- Verify LiveKit server is running on `ws://localhost:7880`
- Check that Redis is running: `docker ps | grep redis`
- Verify the API key/secret match in both config files

### No audio chunks received

- Check that egress service is running
- Verify WebSocket endpoint is accessible: `ws://localhost:3001/api/livekit/audio-ws`
- Check backend logs for WebSocket connection errors

### Redis connection errors

- Ensure Redis container is running: `docker ps | grep livekit-redis`
- Check Redis is accessible: `docker exec livekit-redis redis-cli ping` (should return `PONG`)

## Stopping Services

1. Stop egress: `Ctrl+C` in the egress terminal
2. Stop LiveKit server: `Ctrl+C` in the LiveKit terminal
3. Stop Redis (optional): `docker stop livekit-redis`

## Production

In production, egress is typically:
- Deployed as a separate service in Kubernetes
- Configured to connect to the production LiveKit server
- Uses production Redis instance
- Has proper scaling and monitoring

See `k8s/livekit-deployment.yaml` for production deployment configuration.

