/**
 * Pub/Sub Event Publisher
 * Publishes call lifecycle events to Pub/Sub for async processing
 */

import { PubSub } from '@google-cloud/pubsub';
import { getGoogleCloudConfig } from '../utils/google-cloud.js';

// Initialize client (lazy initialization)
let pubsubClient: PubSub | null = null;
let callEventsTopic: any = null;

// Initialize Pub/Sub client
function getPubSubClient(): PubSub {
  if (!pubsubClient) {
    const { projectId } = getGoogleCloudConfig();
    pubsubClient = new PubSub({ projectId });
  }
  return pubsubClient;
}

// Get or create call-events topic
async function getCallEventsTopic() {
  if (!callEventsTopic) {
    const pubsub = getPubSubClient();
    const topicName = process.env.PUBSUB_CALL_EVENTS_TOPIC || 'call-events';
    callEventsTopic = pubsub.topic(topicName);
    
    // Check if topic exists, create if not (in production, topics should be created via setup script)
    const [exists] = await callEventsTopic.exists();
    if (!exists) {
      console.warn(`⚠️ Pub/Sub topic ${topicName} does not exist. Creating...`);
      await pubsub.createTopic(topicName);
      callEventsTopic = pubsub.topic(topicName);
    }
  }
  return callEventsTopic;
}

/**
 * Publish a call event to Pub/Sub
 */
export async function publishCallEvent(
  event: 'transcription_started' | 'call_ended' | 'audio_chunk_ready',
  data: {
    callId: string;
    chatId?: string;
    roomName?: string;
    participants?: Array<{ email: string; name?: string }>;
    orgSlug?: string; // Use orgSlug instead of orgId
    endReason?: string; // For call_ended event: reason for call ending
    // For audio_chunk_ready event:
    participantEmail?: string;
    chunkIndex?: number;
    storageUrl?: string;
    chunkStartTime?: number;
    chunkEndTime?: number;
    isFinal?: boolean;
  }
): Promise<void> {
  try {
    const topic = await getCallEventsTopic();
    const message = {
      event,
      ...data,
      timestamp: Date.now(),
    };

    const messageId = await topic.publishMessage({
      json: message,
    });

    console.log(`📤 Published call event to Pub/Sub: ${event} for call ${data.callId} (messageId: ${messageId})`);
  } catch (error: any) {
    console.error(`❌ Error publishing call event to Pub/Sub:`, error);
    throw error;
  }
}
