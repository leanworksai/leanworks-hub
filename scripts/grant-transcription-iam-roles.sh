#!/bin/bash

# Grant IAM roles for async transcription architecture
# Uses the deployment service account from gcp_credential.json

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Service account from gcp_credential.json
SERVICE_ACCOUNT="deployment@leanworks-474204.iam.gserviceaccount.com"
PROJECT_ID="leanworks-474204"

echo -e "${GREEN}Granting IAM roles for async transcription to: ${SERVICE_ACCOUNT}${NC}"
echo -e "${GREEN}Project: ${PROJECT_ID}${NC}"
echo ""

# Required roles
ROLES=(
  "roles/pubsub.publisher"
  "roles/pubsub.subscriber"
  "roles/storage.objectCreator"
)

# Grant each role
for ROLE in "${ROLES[@]}"; do
  echo -e "${YELLOW}Granting ${ROLE}...${NC}"
  if gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet 2>/dev/null; then
    echo -e "${GREEN}✅ ${ROLE} granted${NC}"
  else
    EXIT_CODE=$?
    if [ $EXIT_CODE -ne 0 ]; then
      echo -e "${YELLOW}⚠️  Could not grant ${ROLE} (exit code: ${EXIT_CODE})${NC}"
      echo -e "${YELLOW}   The role may already be granted. Checking...${NC}"
      # Check if role is already granted
      if gcloud projects get-iam-policy "$PROJECT_ID" \
        --flatten="bindings[].members" \
        --filter="bindings.members:serviceAccount:${SERVICE_ACCOUNT} AND bindings.role:${ROLE}" \
        --format="value(bindings.role)" 2>/dev/null | grep -q "${ROLE}"; then
        echo -e "${GREEN}✅ ${ROLE} is already granted${NC}"
      else
        echo -e "${RED}❌ Failed to grant ${ROLE}${NC}"
      fi
    fi
  fi
done

echo ""
echo -e "${GREEN}✅ IAM role granting complete!${NC}"
echo ""
echo -e "${GREEN}Granted roles:${NC}"
for ROLE in "${ROLES[@]}"; do
  echo -e "  - ${ROLE}"
done
echo ""
echo -e "${YELLOW}Note: roles/secretmanager.secretAccessor and roles/cloudsql.client should already be granted${NC}"
echo -e "${YELLOW}      If not, grant them manually or they may be granted via other means${NC}"

