#!/bin/bash

# Quick script to create Firebase config secret
# Usage: ./create-firebase-secret.sh

set -e

# Get project ID from credentials file
if [ ! -f "gcp_credential.json" ]; then
    echo "❌ gcp_credential.json not found!"
    exit 1
fi

PROJECT_ID=$(cat gcp_credential.json | grep -o '"project_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"project_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

if [ -z "$PROJECT_ID" ]; then
    echo "❌ Could not extract project_id from gcp_credential.json"
    exit 1
fi

echo "📋 Project ID: $PROJECT_ID"
echo ""
echo "To create the Firebase config secret, you need:"
echo "1. Go to https://console.firebase.google.com/"
echo "2. Select or create a project"
echo "3. Click the gear icon > Project Settings"
echo "4. Scroll down to 'Your apps' and click the web icon (</>)"
echo "5. Copy the Firebase configuration object"
echo ""
read -p "Press Enter when you have the Firebase config ready..."

echo ""
echo "Paste your Firebase config JSON (press Ctrl+D when done):"
FIREBASE_CONFIG=$(cat)

# Validate it's valid JSON
echo "$FIREBASE_CONFIG" | jq . > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "❌ Invalid JSON. Please try again."
    exit 1
fi

# Create or update the secret
if gcloud secrets describe firebase-config --project=$PROJECT_ID &>/dev/null; then
    echo "📝 Secret exists, creating new version..."
    echo "$FIREBASE_CONFIG" | gcloud secrets versions add firebase-config --data-file=-
    echo "✅ Firebase config secret updated!"
else
    echo "📝 Creating new secret..."
    echo "$FIREBASE_CONFIG" | gcloud secrets create firebase-config --data-file=-
    echo "✅ Firebase config secret created!"
fi

echo ""
echo "🎉 Done! The login page should work now."

