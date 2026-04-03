import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium', headless: true }],
    },
    testTimeout: 30000,
    include: ['tests/**/*.test.ts'],
  },
  publicDir: 'dist',
});
