import { defineConfig } from 'vite';

// SSO frontend runs on http://localhost:3000 in sandbox to match the
// callback/logout URLs registered by the sandbox client in sso-backend
// (http://localhost:3000/api/auth/callback and http://localhost:3000/).
export default defineConfig({
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
  },
});
