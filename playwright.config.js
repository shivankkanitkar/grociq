import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4173' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...(process.env.GROCIQ_LOCAL_CHROME ? { channel: 'chrome' } : {}) } }
  ],
  webServer: {
    command: 'python3 -m http.server 4173 --bind 127.0.0.1',
    url: 'http://127.0.0.1:4173/app/',
    reuseExistingServer: Boolean(process.env.GROCIQ_LOCAL_CHROME),
    timeout: 30_000
  }
});
