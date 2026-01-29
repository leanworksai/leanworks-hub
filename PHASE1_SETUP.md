# Phase 1: Database & Foundation Setup

**Status:** Ready to Execute  
**Estimated Time:** 30-60 minutes  
**Prerequisites:** Database access, GCP access

---

## Overview

Phase 1 sets up the foundation for document upload support:
1. Database schema changes (backward compatible)
2. GCP Pub/Sub topic and subscription
3. Environment configuration

---

## Step 1: Install Dependencies

```bash
# Install document processing libraries
npm install pdf-parse mammoth xlsx exceljs canvas

# Verify installation
npm list | grep -E "(pdf-parse|mammoth|xlsx|exceljs|canvas)"
```

**Expected output:**
```
├── pdf-parse@1.1.1
├── mammoth@1.6.0
├── xlsx@0.18.5
├── exceljs@4.4.0
└── canvas@2.11.2
```

---

## Step 2: Run Database Migration

### Option A: Run on All Org Databases (Recommended)

This script automatically:
1. Connects to the shared database
2. Lists all organizations
3. Runs the migration on each org database
4. Reports success/failure
5. Skips databases that are already migrated

```bash
# Make sure your cloud-sql-proxy is running
# (it should be running from npm run dev:proxy)

# First, do a dry run to see what would happen (no changes made)
tsx scripts/run-migration-all-orgs.ts --dry-run

# If everything looks good, run the actual migration
tsx scripts/run-migration-all-orgs.ts
```

**Expected output:**
```
🚀 Starting database migration for all organizations...

Database Configuration:
  Host: localhost
  Port: 5432
  User: postgres

📋 Fetching list of organizations from shared database...
✅ Found 3 organizations

🔄 Running migration for: Acme Corp (org_acme)
✅ Migration completed for Acme Corp in 245ms

🔄 Running migration for: Tech Startup (org_techstartup)
✅ Migration completed for Tech Startup in 198ms

🔄 Running migration for: Consulting LLC (org_consulting)
✅ Migration completed for Consulting LLC in 212ms

================================================================================
📊 MIGRATION SUMMARY
================================================================================

✅ Successful: 3/3
   - Acme Corp (org_acme) - 245ms
   - Tech Startup (org_techstartup) - 198ms
   - Consulting LLC (org_consulting) - 212ms

⏱️  Total time: 655ms (0.66s)

================================================================================

🎉 All migrations completed successfully!
```

### Option B: Run on Single Org Database

If you want to run on a specific org database:

```bash
# Connect to specific org database
psql -h localhost -U postgres -d org_yourorg

# Run the migration
\i database/migrations/add-document-upload-support.sql

# Verify migration
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'docs'
AND column_name IN ('doc_type', 'file_metadata', 'storage_path', 'processing_status', 'file_size', 'mime_type');
```

**Expected output:**
```
     column_name     |     data_type
---------------------+--------------------
 doc_type            | character varying
 file_metadata       | jsonb
 storage_path        | character varying
 processing_status   | character varying
 file_size           | bigint
 mime_type           | character varying
```

---

## Step 3: Set Up GCP Pub/Sub

```bash
# Make script executable
chmod +x scripts/setup-document-processing-pubsub.sh

# Run setup script
./scripts/setup-document-processing-pubsub.sh
```

**Expected output:**
```
🚀 Setting up Pub/Sub for document processing...
Project: leanworks-474204
Topic: document-processing
Subscription: document-processing-sub

📝 Setting project to leanworks-474204...
📤 Creating Pub/Sub topic: document-processing...
✅ Topic document-processing created
📥 Creating Pub/Sub subscription: document-processing-sub...
✅ Subscription document-processing-sub created

✅ Pub/Sub setup complete!
```

---

## Step 4: Update Environment Variables

Add to your `.env` file:

```bash
# Document Processing
PUBSUB_DOC_PROCESSING_TOPIC=document-processing
PUBSUB_DOC_PROCESSING_SUBSCRIPTION=document-processing-sub
GOOGLE_CLOUD_PROJECT=leanworks-474204

# File Upload Settings
MAX_FILE_SIZE=52428800  # 50MB in bytes
FILE_URL_EXPIRATION_DAYS=365

# Processing Settings
DOC_PROCESSING_MAX_RETRIES=3
DOC_PROCESSING_ACK_DEADLINE=600  # 10 minutes
DOC_PROCESSING_CONCURRENCY=5
```

---

## Step 5: Verify Setup

### Check Database

```sql
-- Check docs table structure
\d docs

-- Check doc_processing_jobs table
\d doc_processing_jobs

-- Test search function
SELECT * FROM search_docs('test', NULL, NULL, 10, 0);

-- Check doc stats
SELECT * FROM get_doc_stats();
```

### Check Pub/Sub

```bash
# List topics
gcloud pubsub topics list --project=leanworks-474204

# List subscriptions
gcloud pubsub subscriptions list --project=leanworks-474204

# Test publishing a message
gcloud pubsub topics publish document-processing \
  --message='{"test": true}' \
  --project=leanworks-474204
```

---

## Troubleshooting

### Database Migration Fails

**Error:** `relation "docs" does not exist`
- **Solution:** Make sure you're connected to the correct org database (e.g., `org_yourorg`)

**Error:** `column "doc_type" already exists`
- **Solution:** Migration was already run. Check if columns exist:
  ```sql
  SELECT column_name FROM information_schema.columns WHERE table_name = 'docs';
  ```

### Pub/Sub Setup Fails

**Error:** `gcloud: command not found`
- **Solution:** Install Google Cloud SDK: https://cloud.google.com/sdk/docs/install

**Error:** `Permission denied`
- **Solution:** Authenticate with gcloud:
  ```bash
  gcloud auth login
  gcloud config set project leanworks-474204
  ```

**Error:** `Topic already exists`
- **Solution:** This is fine! The script will skip creation and use the existing topic.

---

## Rollback (if needed)

If you need to rollback the migration:

```sql
-- WARNING: This will delete data!

-- Drop new table
DROP TABLE IF EXISTS doc_processing_jobs CASCADE;

-- Drop new indexes
DROP INDEX IF EXISTS idx_docs_doc_type;
DROP INDEX IF EXISTS idx_docs_processing_status;
DROP INDEX IF EXISTS idx_docs_file_metadata;
DROP INDEX IF EXISTS idx_docs_content_fts;
DROP INDEX IF EXISTS idx_docs_ready_created;
DROP INDEX IF EXISTS idx_docs_project_ready;

-- Drop new functions
DROP FUNCTION IF EXISTS search_docs(TEXT, VARCHAR(50)[], VARCHAR(50), INTEGER, INTEGER);
DROP FUNCTION IF EXISTS get_doc_stats();

-- Drop new columns
ALTER TABLE docs DROP COLUMN IF EXISTS doc_type;
ALTER TABLE docs DROP COLUMN IF EXISTS file_metadata;
ALTER TABLE docs DROP COLUMN IF EXISTS storage_path;
ALTER TABLE docs DROP COLUMN IF EXISTS processing_status;
ALTER TABLE docs DROP COLUMN IF EXISTS file_size;
ALTER TABLE docs DROP COLUMN IF EXISTS mime_type;
```

---

## Next Steps

Once Phase 1 is complete, proceed to:
- **Phase 2:** Backend Services (document processors, Pub/Sub service, worker)
- **Phase 3:** API Endpoints (upload, status, preview, download)
- **Phase 4:** Frontend Components (UI dropdown, upload dialog, viewers)

---

## Verification Checklist

- [ ] Dependencies installed (`pdf-parse`, `mammoth`, `xlsx`, `exceljs`, `canvas`)
- [ ] Database migration completed successfully
- [ ] New columns added to `docs` table
- [ ] `doc_processing_jobs` table created
- [ ] Indexes created
- [ ] Helper functions created
- [ ] GCP Pub/Sub topic created
- [ ] GCP Pub/Sub subscription created
- [ ] Environment variables updated
- [ ] Database verification queries run successfully
- [ ] Pub/Sub test message published successfully

---

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review the migration SQL file: `database/migrations/add-document-upload-support.sql`
3. Check GCP Pub/Sub console: https://console.cloud.google.com/cloudpubsub
4. Review logs for any error messages
