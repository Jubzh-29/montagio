import { defineConfig, devices } from '@playwright/test';

const PORT = 3101;

// The showcase e2e tests what the jury gets: the static export (apps/web/out),
// built by the showcase build and served by a plain static server. One server
// at a time: `npm run e2e` runs the demo suite first, then this one.
export default defineConfig({
  testDir: './e2e-showcase',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure', acceptDownloads: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node scripts/showcase-build.mjs && node scripts/serve-static.mjs out ${PORT}`,
    url: `http://127.0.0.1:${PORT}/showcase/data.json`,
    reuseExistingServer: false,
    // check-open-stack, showcase prepare (FFmpeg, cached after the first run) and next build.
    timeout: 900_000,
    env: { MONTAGIO_REPO_URL: 'https://example.invalid/montagio' },
  },
});
