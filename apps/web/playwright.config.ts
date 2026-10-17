import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/api/models`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      MONTAGIO_BACKEND: 'demo',
      MONTAGIO_DEMO_DURATION_MS: '1500',
      MONTAGIO_DATA: join(tmpdir(), `montagio-e2e-${Date.now()}`),
    },
  },
});
