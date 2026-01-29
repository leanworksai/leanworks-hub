#!/bin/bash

# Setup GCP Pub/Sub for Document Processing
# This script creates the necessary Pub/Sub topic and subscription

set -e  # Exit on error

PROJECT_ID="leanworks-474204"
TOPIC_NAME="document-processing"
SUBSCRIPTION_NAME="document-processing-sub"
DL_TOPIC_NAME="document-processing-dl"

echo "🚀 Setting up Pub/Sub for document processing..."
echo "Project: $PROJECT_ID"
echo "Topic: $TOPIC_NAME"
echo "Subscription: $SUBSCRIPTION_NAME"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI is not installed"
    echo "Please install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" &> /dev/null; then
    echo "❌ Error: Not authenticated with gcloud"
    echo "Please run: gcloud auth login"
    exit 1
fi

# Set project
echo "📝 Setting project to $PROJECT_ID..."
gcloud config set project $PROJECT_ID

# Create topic
echo "📤 Creating Pub/Sub topic: $TOPIC_NAME..."
if gcloud pubsub topics describe $TOPIC_NAME &> /dev/null; then
    echo "✅ Topic $TOPIC_NAME already exists"
else
    gcloud pubsub topics create $TOPIC_NAME \
        --message-retention-duration=7d \
        --message-storage-policy-allowed-regions=us-west1
    echo "✅ Topic $TOPIC_NAME created"
fi

# Create dead letter topic
echo "📤 Creating dead letter Pub/Sub topic: $DL_TOPIC_NAME..."
if gcloud pubsub topics describe $DL_TOPIC_NAME &> /dev/null; then
    echo "✅ Dead letter topic $DL_TOPIC_NAME already exists"
else
    gcloud pubsub topics create $DL_TOPIC_NAME \
        --message-retention-duration=7d \
        --message-storage-policy-allowed-regions=us-west1
    echo "✅ Dead letter topic $DL_TOPIC_NAME created"
fi

# Create subscription
echo "📥 Creating Pub/Sub subscription: $SUBSCRIPTION_NAME..."
if gcloud pubsub subscriptions describe $SUBSCRIPTION_NAME &> /dev/null; then
    echo "✅ Subscription $SUBSCRIPTION_NAME already exists"
else
    gcloud pubsub subscriptions create $SUBSCRIPTION_NAME \
        --topic=$TOPIC_NAME \
        --dead-letter-topic=$DL_TOPIC_NAME \
        --ack-deadline=600 \
        --message-retention-duration=7d \
        --max-delivery-attempts=5 \
        --enable-message-ordering
    echo "✅ Subscription $SUBSCRIPTION_NAME created"
fi

# Verify setup
echo ""
echo "🔍 Verifying setup..."
echo "Topic details:"
gcloud pubsub topics describe $TOPIC_NAME

echo ""
echo "Subscription details:"
gcloud pubsub subscriptions describe $SUBSCRIPTION_NAME

echo ""
echo "✅ Pub/Sub setup complete!"
echo ""
echo "Next steps:"
echo "1. Update your .env file with:"
echo "   PUBSUB_DOC_PROCESSING_TOPIC=$TOPIC_NAME"
echo "   PUBSUB_DOC_PROCESSING_SUBSCRIPTION=$SUBSCRIPTION_NAME"
echo "2. Start the document processing worker"
echo "3. Test with a document upload"
