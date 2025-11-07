# Troubleshooting Blank Page

If `http://localhost:8080/` shows a blank page, follow these steps:

## 1. Check Browser Console

Open your browser's developer console (F12 or Cmd+Option+I) and check for:
- **Red error messages** - These will tell you what's wrong
- **Network tab** - Check if files are loading (look for 404 errors)

## 2. Restart Dev Servers

Stop all running servers and restart:

```bash
# Stop all processes
pkill -f "vite|tsx.*server"

# Wait a moment, then restart
npm run dev
```

You should see:
- `🚀 Firestore proxy server running on http://localhost:3001`
- Vite dev server starting on port 8080

## 3. Check Both Servers Are Running

Verify both servers are accessible:
- Proxy: `curl http://localhost:3001/api/projects` (should return JSON)
- Vite: Open `http://localhost:8080` in browser

## 4. Common Issues

### Blank White Page
- **Cause**: JavaScript error preventing React from rendering
- **Fix**: Check browser console for errors

### "Cannot GET /" or 404
- **Cause**: Vite server not running
- **Fix**: Restart with `npm run dev`

### Network Errors (CORS, fetch failed)
- **Cause**: Proxy server not running
- **Fix**: Make sure proxy server starts on port 3001

### Port Already in Use
- **Cause**: Another process using port 8080 or 3001
- **Fix**: 
  ```bash
  lsof -ti:8080 | xargs kill -9
  lsof -ti:3001 | xargs kill -9
  npm run dev
  ```

## 5. Verify Setup

Make sure:
- ✅ `gcp_credential.json` exists in project root
- ✅ `node_modules` is installed (`npm install`)
- ✅ No syntax errors in `src/App.tsx` or `src/main.tsx`

## 6. Check Terminal Output

When running `npm run dev`, you should see:
```
[0] 🚀 Firestore proxy server running on http://localhost:3001
[0] 📊 Using project: leanworks
[0] 🗄️  Database: leanworks-test
[1]   VITE v5.4.19  ready in XXX ms
[1]   ➜  Local:   http://localhost:8080/
```

If you see errors, share them for help debugging.

