import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the SSO backend. Tests are plain TypeScript unit
 * tests for the pure validation chain and catalog modules under `amplify/auth`,
 * so a Node environment with no setup is enough.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['amplify/**/*.test.ts'],
  },
});
