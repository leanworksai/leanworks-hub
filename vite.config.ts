import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Read project ID from gcp_credential.json
  let projectId: string | undefined;
  try {
    const credentialPath = path.resolve(__dirname, "./gcp_credential.json");
    const credentials = JSON.parse(readFileSync(credentialPath, "utf8"));
    projectId = credentials.project_id;
  } catch (error) {
    console.warn("Warning: Could not read project_id from gcp_credential.json");
  }

  // Load environment variables
  const env = loadEnv(mode, process.cwd(), "");
  
  // Override VITE_FIREBASE_PROJECT_ID with value from credential file if available
  if (projectId) {
    env.VITE_FIREBASE_PROJECT_ID = projectId;
  }

  return {
  base: '/',
  server: {
    host: "::",
    port: 8081,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
    envPrefix: "VITE_",
    // Make the project ID available as an environment variable
    define: {
      ...(projectId && {
        "import.meta.env.VITE_FIREBASE_PROJECT_ID": JSON.stringify(projectId),
      }),
    },
  };
});
