import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

// Every run starts with a cold Turbopack dev cache, as in CI: a cache warmed on
// another commit makes pages reload in a loop after a branch switch or merge.
export const RESET_DEV_CACHE = `node -e "require('node:fs').rmSync('.next/dev/cache/turbopack', { recursive: true, force: true, maxRetries: 5 })"`;

export default defineConfig({
  testDir: './e2e',
  // Compiles every route once the server is up, so no test pays a cold compile.
  globalSetup: './e2e/warm-up.ts',
  timeout: 60_000,
  fullyParallel: false,
  // One worker: parallel spec files starved each other of CPU on a loaded dev machine (5 s waits missed), and it keeps the PC cooler.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `${RESET_DEV_CACHE} && npx next dev --port ${PORT}`,
    // The readiness probe runs the open-stack scan once, and the route memoizes it, before the first test.
    url: `http://localhost:${PORT}/api/open-stack`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      MONTAGIO_BACKEND: 'demo',
      MONTAGIO_DEMO_DURATION_MS: '1500',
      // Every extension and every effect, dated or not: the suite covers what the GPU sessions will validate.
      MONTAGIO_EXTENSIONS: 'all',
      MONTAGIO_DATA: join(tmpdir(), `montagio-e2e-${Date.now()}`),
    },
  },
});
