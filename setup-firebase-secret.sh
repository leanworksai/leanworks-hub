#!/bin/bash

set -e

PROJECT_ID="leanworks-474204"

echo "🔥 Firebase Config Secret Setup"
echo "================================"
echo ""
echo "Project ID: $PROJECT_ID"
echo ""
echo "📋 Instructions:"
echo "1. Go to Firebase Console: https://console.firebase.google.com/"
echo "2. Select your project"
echo "3. Click the web icon (</>) to add a web app"
echo "4. Copy the Firebase config object"
echo ""
read -p "Press Enter when you have the Firebase config ready..."

echo ""
echo "📝 Paste your Firebase config JSON below."
echo "   (It should look like: { \"apiKey\": \"...\", \"authDomain\": \"...\", ... })"
echo "   Press Ctrl+D (or Cmd+D on Mac) when done:"
echo ""

# Read the config
FIREBASE_CONFIG=$(cat)

# Validate JSON
if ! echo "$FIREBASE_CONFIG" | python3 -m json.tool > /dev/null 2>&1; then
    echo "❌ Invalid JSON. Please try again."
    exit 1
fi

# Check if secret exists
if gcloud secrets describe firebase-config --project=$PROJECT_ID &>/dev/null; then
    echo ""
    read -p "Secret 'firebase-config' already exists. Create new version? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "$FIREBASE_CONFIG" | gcloud secrets versions add firebase-config --data-file=- --project=$PROJECT_ID
        echo "✅ Firebase config secret updated!"
    else
        echo "⚠️  Skipped. Secret not updated."
        exit 0
    fi
else
    echo "$FIREBASE_CONFIG" | gcloud secrets create firebase-config --data-file=- --project=$PROJECT_ID
    echo "✅ Firebase config secret created!"
fi

echo ""
echo "🎉 Done! Now let's enable authentication and Firestore..."

