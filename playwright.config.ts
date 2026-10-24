import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3200);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Starts the app on a fresh demo database unless E2E_EXTERNAL_SERVER is set.
  webServer: process.env.E2E_EXTERNAL_SERVER
    ? undefined
    : {
        command: 'scripts/e2e-server.sh',
        url: `http://localhost:${PORT}/sign-in`,
        reuseExistingServer: false,
        timeout: 240_000,
        env: { E2E_PORT: String(PORT) },
      },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath: '/opt/pw-browsers/chromium' } } }],
});
