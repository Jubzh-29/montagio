import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { RESET_DEV_CACHE } from './playwright.config';

// The Studio in "local" mode, end to end: Comfy SDK → a fake comfy-api-proxy that
// answers every job with the demo clip. No GPU, no real proxy (that comes with S1/S2).
const PORT = 3101;
const PROXY_PORT = 8190;

export default defineConfig({
  testDir: './e2e-local',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `npx tsx ../../packages/comfy-adapter/scripts/fake-proxy.ts --port ${PROXY_PORT} --clip ../../demo-assets/clips/_default.mp4`,
      url: `http://127.0.0.1:${PROXY_PORT}/api/v2/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `${RESET_DEV_CACHE} && npx next dev --port ${PORT}`,
      // As in the demo config: the probe runs the open-stack scan once before the first test.
      url: `http://localhost:${PORT}/api/open-stack`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        MONTAGIO_BACKEND: 'local',
        COMFY_BASE_URL: `http://127.0.0.1:${PROXY_PORT}`,
        MONTAGIO_DATA: join(tmpdir(), `montagio-e2e-local-${Date.now()}`),
      },
    },
  ],
});
