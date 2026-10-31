import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// In development the API runs on :4000 and is reached through this proxy, so the browser
// sees one origin (localhost:5173) for both the app and the API, including sign-in redirects.
//
// DEV_NETWORK_HOST in the project's .env (for example 192-168-1-20.sslip.io) opens the
// development server to other devices on the network, over https, because Microsoft sign-in
// accepts plain http only for localhost. For testing only (D74).
export default defineConfig(async ({ mode }) => {
  const networkHost = loadEnv(mode, repoRoot, '').DEV_NETWORK_HOST?.trim();
  // Loaded only when needed, so a copy without it installed still starts on localhost.
  const ssl = networkHost ? (await import('@vitejs/plugin-basic-ssl')).default : null;
  return {
    plugins: [react(), tailwindcss(), ...(ssl ? [ssl()] : [])],
    server: {
      port: 5173,
      strictPort: true,
      ...(networkHost ? { host: '0.0.0.0', allowedHosts: [networkHost] } : {}),
      proxy: {
        '/api': { target: 'http://127.0.0.1:4000', changeOrigin: false },
      },
    },
    build: { outDir: 'dist', sourcemap: false },
  };
});
