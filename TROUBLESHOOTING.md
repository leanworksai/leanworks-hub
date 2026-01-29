# Document Upload Feature - Troubleshooting Guide

## Current Issue: 404 Errors on Upload Endpoints

### Symptoms:
```
Failed to load resource: the server responded with a status of 404 (Not Found)
/api/docs/upload
/api/docs/:docId/status
```

### Root Cause:
The document upload endpoints are not being registered with the Express server.

### Solution:

#### 1. Verify Server Import

Check that [`server/index.ts`](server/index.ts) has the correct import:

```typescript
import { setupDocumentUploadEndpoints } from './endpoints/docs-upload.js';
```

**Note the `.js` extension!** TypeScript ES modules require explicit `.js` extensions even though the source file is `.ts`.

#### 2. Verify Endpoint Registration

Check that [`server/index.ts`](server/index.ts) calls the setup function:

```typescript
setupDocumentUploadEndpoints(app, authenticateUser, storage);
```

This should be near line 6492, after `setupFileEndpoints`.

#### 3. Check for Server Errors

Look at the server console output for any errors during startup:
- Import errors
- Module not found errors
- Syntax errors

#### 4. Restart the Server

The server needs to be restarted to pick up the new endpoints:

```bash
# Stop the current server (Ctrl+C)
# Then restart:
npm run dev
```

#### 5. Verify Endpoints are Registered

After server starts, check the console for:
```
✅ Document upload endpoints registered at /api/docs/upload
```

#### 6. Test Endpoints Manually

```bash
# Test health endpoint
curl http://localhost:5000/api/docs/upload/health

# Expected response:
# {"status":"ok","endpoint":"/api/docs/upload","supportedTypes":{...}}
```

---

## Common Issues & Solutions

### Issue: "require is not defined"

**Cause:** Using `require()` in ES module context

**Solution:** Use `createRequire`:
```typescript
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
```

**Fixed in:**
- [`server/services/processors/pdf-processor.ts`](server/services/processors/pdf-processor.ts)
- [`server/services/processors/powerpoint-processor.ts`](server/services/processors/powerpoint-processor.ts)

### Issue: "Module not found"

**Cause:** Missing `.js` extension in import path

**Solution:** Add `.js` extension to all relative imports:
```typescript
// Wrong:
import { setupDocumentUploadEndpoints } from './endpoints/docs-upload';

// Correct:
import { setupDocumentUploadEndpoints } from './endpoints/docs-upload.js';
```

### Issue: "Cannot find module 'jszip'"

**Cause:** Missing dependencies

**Solution:**
```bash
npm install jszip xml2js @types/xml2js
```

### Issue: Endpoints return 404

**Possible Causes:**
1. Server not restarted after adding endpoints
2. Import path incorrect (missing `.js` extension)
3. Setup function not called
4. Server startup error (check console)

**Solution:**
1. Check server console for errors
2. Verify import has `.js` extension
3. Verify setup function is called
4. Restart server

### Issue: "Unexpected end of JSON input"

**Cause:** Server returned non-JSON response (likely HTML error page)

**Solution:** Check server logs for the actual error. The 404 suggests endpoints aren't registered.

---

## Debugging Steps

### 1. Check Server Logs

Look for these messages in server console:

**Success:**
```
✅ Document upload endpoints registered at /api/docs/upload
```

**Errors:**
```
❌ Failed to load module: ./endpoints/docs-upload.js
Error: Cannot find module...
```

### 2. Check Import Paths

All imports in [`server/index.ts`](server/index.ts) should have `.js` extensions:

```typescript
import { setupDocumentUploadEndpoints } from './endpoints/docs-upload.js';
```

### 3. Check File Exports

Verify [`server/endpoints/docs-upload.ts`](server/endpoints/docs-upload.ts) exports the function:

```typescript
export function setupDocumentUploadEndpoints(
  app: express.Application,
  authenticateUser: express.RequestHandler,
  storage: any
) {
  // ...
}
```

### 4. Test Individual Endpoints

After server starts successfully, test each endpoint:

```bash
# Health check (no auth required)
curl http://localhost:5000/api/docs/upload/health

# Supported types (no auth required)
curl http://localhost:5000/api/docs/upload/supported-types

# Upload (requires auth)
curl -X POST http://localhost:5000/api/docs/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-org-slug: YOUR_ORG_SLUG" \
  -F "file=@test.pdf"
```

### 5. Check Network Tab

In browser DevTools → Network tab:
- Check the actual URL being called
- Check request headers (Authorization, x-org-slug)
- Check response status and body
- Check if request is being proxied correctly

---

## Quick Fix Checklist

- [ ] Server has been restarted
- [ ] Import in server/index.ts has `.js` extension
- [ ] Setup function is called in server/index.ts
- [ ] No errors in server console
- [ ] Health endpoint returns 200 OK
- [ ] Browser is pointing to correct port (5000 for API, 3000 for frontend)
- [ ] Vite proxy is configured correctly (if using Vite dev server)

---

## Vite Proxy Configuration

If you're using Vite dev server, ensure [`vite.config.ts`](vite.config.ts) has proxy configured:

```typescript
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
```

---

## Next Steps After Fixing 404

Once endpoints are working:

1. **Test upload flow:**
   - Click '+' button
   - Select "Upload a file"
   - Choose a PDF/Word/Excel/PowerPoint file
   - Click "Upload"
   - Verify progress tracking works
   - Verify processing completes

2. **Check database:**
   ```sql
   SELECT id, title, doc_type, processing_status FROM docs WHERE doc_type != 'rich_text';
   SELECT * FROM doc_processing_jobs;
   ```

3. **Check GCS:**
   - Verify files are uploaded to `orgs/{orgSlug}/documents/{docId}/`

4. **Check Pub/Sub:**
   ```bash
   gcloud pubsub topics list | grep document-processing
   gcloud pubsub subscriptions describe document-processing-sub
   ```

---

## Contact

If issues persist, check:
1. Server console logs for detailed errors
2. Browser console for client-side errors
3. Network tab for request/response details
4. Database for migration status
5. GCP console for Pub/Sub status
