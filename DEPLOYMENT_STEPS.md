# Async Transcription Architecture - Deployment Steps

## ✅ Completed Steps

1. **Pub/Sub Setup** - ✅ Complete
   - Topics created: `audio-chunks`, `call-events`
   - Subscriptions created: `transcription-workers`, `transcription-workers-call-events`

## 🔧 Remaining Steps

### 2. Grant IAM Roles

The deployment service account (`deployment@leanworks-474204.iam.gserviceaccount.com`) needs these roles:

```bash
# Grant Pub/Sub publisher role (for backend to publish audio chunks and call events)
gcloud projects add-iam-policy-binding leanworks-474204 \
  --member="serviceAccount:deployment@leanworks-474204.iam.gserviceaccount.com" \
  --role="roles/pubsub.publisher"

# Grant Pub/Sub subscriber role (for transcription workers to subscribe)
gcloud projects add-iam-policy-binding leanworks-474204 \
  --member="serviceAccount:deployment@leanworks-474204.iam.gserviceaccount.com" \
  --role="roles/pubsub.subscriber"

# Grant Storage object creator role (for saving audio recordings)
gcloud projects add-iam-policy-binding leanworks-474204 \
  --member="serviceAccount:deployment@leanworks-474204.iam.gserviceaccount.com" \
  --role="roles/storage.objectCreator"
```

**Note:** `roles/secretmanager.secretAccessor` and `roles/cloudsql.client` should already be granted.

### 3. Database Schema

The database schema is managed through `database/schema.sql` and `database/shared-schema.sql`. 
Initialize the schema using:

```bash
npm run db:init
```

### 4. Deploy Updated Code

```bash
# Build and push Docker image
./deploy.sh

# Apply Kubernetes manifests (including new transcription worker)
kubectl apply -f k8s/transcription-worker-deployment.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/serviceaccount.yaml
```

### 5. Verify Deployment

```bash
# Check transcription worker pods
kubectl get pods -l app=transcription-worker

# Check logs
kubectl logs -l app=transcription-worker --tail=50

# Check Pub/Sub subscriptions
gcloud pubsub subscriptions list

# Verify topics
gcloud pubsub topics list
```

## 📋 Summary

- ✅ Pub/Sub infrastructure created
- ⏳ IAM roles need to be granted (manual step)
- ⏳ Code deployment (run `./deploy.sh`)

## 🔍 Verification

After deployment, verify:
1. Transcription worker pods are running
2. Backend can publish to Pub/Sub topics
3. Workers can subscribe to Pub/Sub subscriptions
4. Audio recordings are saved to `gs://leanworks-prod/orgs/{org-slug}/recordings/...`
5. Transcription sessions are created in PostgreSQL

