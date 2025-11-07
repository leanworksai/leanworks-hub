# Firebase Setup for Local Development

The app uses `gcp_credential.json` to access Firestore locally through a proxy server. **No additional configuration needed!**

## How It Works

1. **Local Development**: Uses a proxy server (`server/index.ts`) that runs Firebase Admin SDK with your `gcp_credential.json`
2. **Production**: Uses Firebase JS SDK (requires web app config)

## Running Locally

Simply run:
```bash
npm run dev
```

This will start:
- **Proxy server** on `http://localhost:3001` (uses `gcp_credential.json`)
- **Vite dev server** on `http://localhost:8080` (your React app)

The React app automatically connects to the proxy server in development mode.

## No Configuration Needed!

Since you only have `gcp_credential.json`, the setup is complete. The proxy server handles all Firestore operations using your service account credentials.

## Verification

When you run `npm run dev`, you should see:
- In terminal: `🚀 Firestore proxy server running on http://localhost:3001`
- In browser console: `🔧 Using Firestore proxy API (gcp_credential.json)`

## How It Works

- **Proxy Server** (`server/index.ts`): Runs Firebase Admin SDK with `gcp_credential.json`
- **React App**: Makes API calls to the proxy server instead of directly to Firestore
- **All CRUD operations** work through the proxy using your service account

## Notes

- The proxy server only runs in development mode
- For production, you'll need to set up Firebase web app config or deploy the proxy server
- The `gcp_credential.json` is used by:
  - Migration script (`npm run migrate:firestore`)
  - Local development proxy server

