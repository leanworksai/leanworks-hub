/**
 * Deployment Completion Worker
 * Listens for Pub/Sub messages from data-pipeline about deployment completion
 * and sends notifications to users
 */

import { PubSub } from '@google-cloud/pubsub';
import { getSharedPool } from '../../database/multi-tenant-pool.js';
import { getGoogleCloudConfig } from '../utils/google-cloud.js';

// Initialize Pub/Sub client
let pubsubClient: PubSub | null = null;

// Initialize Pub/Sub client
function getPubSubClient(): PubSub {
  if (!pubsubClient) {
    const { projectId } = getGoogleCloudConfig();
    pubsubClient = new PubSub({ projectId });
  }
  return pubsubClient;
}


/**
 * Process deployment completion message
 */
async function processDeploymentCompletion(message: any): Promise<void> {
  let data: any;
  try {
    // Pub/Sub messages can have json property or need to parse data
    if (message.json) {
      data = message.json;
    } else if (message.data) {
      data = JSON.parse(message.data.toString());
    } else {
      console.error('❌ Deployment message has no json or data property:', message);
      message.nack();
      return;
    }
  } catch (error: any) {
    console.error('❌ Error parsing deployment message:', error);
    message.nack();
    return;
  }

  const { org_slug, status, message: statusMessage, timestamp } = data;

  if (!org_slug) {
    console.error('❌ Deployment message missing org_slug:', data);
    message.ack();
    return;
  }

  console.log(`📦 Processing deployment completion for org: ${org_slug}, status: ${status}`);

  try {
    const firestoreDb = getFirestoreDb();
    const sharedPool = await getSharedPool();

    // Get organization details to find owner
    const orgResult = await sharedPool.query(
      'SELECT id, owner_email, name FROM organizations WHERE slug = $1',
      [org_slug]
    );

    if (orgResult.rows.length === 0) {
      console.warn(`⚠️ Organization not found for slug: ${org_slug}`);
      message.ack();
      return;
    }

    const org = orgResult.rows[0];
    const ownerEmail = org.owner_email?.toLowerCase();
    const orgName = org.name;

    if (!ownerEmail) {
      console.warn(`⚠️ Organization ${org_slug} has no owner_email`);
      message.ack();
      return;
    }

    // Create system notification in database
    let notificationTitle: string;
    let notificationMessage: string;
    const notificationType = status === 'success' ? 'deployment_complete' : 'deployment_error';
    
    if (status === 'success') {
      notificationTitle = '🎉 Integration Deployment Complete';
      notificationMessage = `Integration deployment is complete and Leanworks AI is ready for ${orgName}. You can now start using AI features to search and interact with your integrated data sources.`;
    } else {
      notificationTitle = '⚠️ Integration Deployment Error';
      notificationMessage = `Integration deployment encountered an issue for ${orgName}. Please contact support if you need assistance.`;
    }

    // Insert notification in unified notifications table
    await sharedPool.query(`
      INSERT INTO notifications (user_email, org_id, type, title, message, status, created_at)
      VALUES ($1, $2, $3, $4, $5, 'unread', NOW())
    `, [ownerEmail, org.id, notificationType, notificationTitle, notificationMessage]);
    
    console.log(`✅ Created system notification for ${ownerEmail} in org ${org_slug}`);
    console.log(`   Type: ${notificationType}, Title: ${notificationTitle}`);

    message.ack();
  } catch (error: any) {
    console.error(`❌ Error processing deployment completion for ${org_slug}:`, error);
    // Nack the message so it can be retried
    message.nack();
  }
}

/**
 * Start the deployment completion worker
 */
export async function startDeploymentWorker(): Promise<void> {
  console.log('🚀 Starting deployment completion worker...');

  const pubsub = getPubSubClient();
  const topicName = process.env.PUBSUB_DATA_PIPELINE_TOPIC || 'data-pipeline-deployment';
  const subscriptionName = process.env.PUBSUB_DATA_PIPELINE_SUBSCRIPTION || 'deployment-completion-workers';

  // Get or create topic
  const topic = pubsub.topic(topicName);
  const [topicExists] = await topic.exists();
  if (!topicExists) {
    console.warn(`⚠️ Topic ${topicName} does not exist. Creating...`);
    await pubsub.createTopic(topicName);
  }

  // Get or create subscription
  let subscription = pubsub.subscription(subscriptionName);
  const [subExists] = await subscription.exists();
  if (!subExists) {
    console.warn(`⚠️ Subscription ${subscriptionName} does not exist. Creating...`);
    await pubsub.createSubscription(topic, subscriptionName, {
      ackDeadlineSeconds: 60,
      messageRetentionDuration: { seconds: 7 * 24 * 60 * 60 }, // 7 days
    });
    subscription = pubsub.subscription(subscriptionName);
  }

  // Subscribe to deployment completion messages
  subscription.on('message', processDeploymentCompletion);
  console.log(`✅ Subscribed to ${subscriptionName} for topic ${topicName}`);

  console.log('✅ Deployment completion worker started and listening for messages');
}
