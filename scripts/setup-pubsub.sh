#!/bin/bash

# Setup Google Cloud Pub/Sub topics and subscriptions for async transcription
# This script creates the necessary Pub/Sub infrastructure

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get project ID from gcloud or use environment variable
PROJECT_ID=${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null)}

if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Error: PROJECT_ID not set. Set GOOGLE_CLOUD_PROJECT or configure gcloud.${NC}"
    exit 1
fi

echo -e "${GREEN}Setting up Pub/Sub for project: ${PROJECT_ID}${NC}"

# Topic names
AUDIO_CHUNKS_TOPIC="audio-chunks"
CALL_EVENTS_TOPIC="call-events"

# Subscription names
TRANSCRIPTION_WORKERS_SUB="transcription-workers"

# Create audio-chunks topic
echo -e "${YELLOW}Creating topic: ${AUDIO_CHUNKS_TOPIC}...${NC}"
if gcloud pubsub topics create ${AUDIO_CHUNKS_TOPIC} --project=${PROJECT_ID} 2>/dev/null; then
    echo -e "${GREEN}✅ Topic ${AUDIO_CHUNKS_TOPIC} created${NC}"
else
    echo -e "${YELLOW}⚠️  Topic ${AUDIO_CHUNKS_TOPIC} may already exist${NC}"
fi

# Create call-events topic
echo -e "${YELLOW}Creating topic: ${CALL_EVENTS_TOPIC}...${NC}"
if gcloud pubsub topics create ${CALL_EVENTS_TOPIC} --project=${PROJECT_ID} 2>/dev/null; then
    echo -e "${GREEN}✅ Topic ${CALL_EVENTS_TOPIC} created${NC}"
else
    echo -e "${YELLOW}⚠️  Topic ${CALL_EVENTS_TOPIC} may already exist${NC}"
fi

# Create subscription for transcription workers (on audio-chunks topic)
echo -e "${YELLOW}Creating subscription: ${TRANSCRIPTION_WORKERS_SUB}...${NC}"
if gcloud pubsub subscriptions create ${TRANSCRIPTION_WORKERS_SUB} \
    --topic=${AUDIO_CHUNKS_TOPIC} \
    --ack-deadline=60 \
    --message-retention-duration=7d \
    --project=${PROJECT_ID} 2>/dev/null; then
    echo -e "${GREEN}✅ Subscription ${TRANSCRIPTION_WORKERS_SUB} created${NC}"
else
    echo -e "${YELLOW}⚠️  Subscription ${TRANSCRIPTION_WORKERS_SUB} may already exist${NC}"
fi

# Create subscription for call-events (for transcription workers to know when calls end)
echo -e "${YELLOW}Creating subscription: ${TRANSCRIPTION_WORKERS_SUB}-call-events...${NC}"
if gcloud pubsub subscriptions create ${TRANSCRIPTION_WORKERS_SUB}-call-events \
    --topic=${CALL_EVENTS_TOPIC} \
    --ack-deadline=60 \
    --message-retention-duration=7d \
    --project=${PROJECT_ID} 2>/dev/null; then
    echo -e "${GREEN}✅ Subscription ${TRANSCRIPTION_WORKERS_SUB}-call-events created${NC}"
else
    echo -e "${YELLOW}⚠️  Subscription ${TRANSCRIPTION_WORKERS_SUB}-call-events may already exist${NC}"
fi

echo -e "${GREEN}✅ Pub/Sub setup complete!${NC}"
echo -e "${GREEN}Topics:${NC}"
echo -e "  - ${AUDIO_CHUNKS_TOPIC}"
echo -e "  - ${CALL_EVENTS_TOPIC}"
echo -e "${GREEN}Subscriptions:${NC}"
echo -e "  - ${TRANSCRIPTION_WORKERS_SUB} (subscribes to ${AUDIO_CHUNKS_TOPIC})"
echo -e "  - ${TRANSCRIPTION_WORKERS_SUB}-call-events (subscribes to ${CALL_EVENTS_TOPIC})"

