import { defineConfig, devices } from '@playwright/test';

const PORT = 8124;

// One process serves both halves, so the test server is the real server — not a
// stand-in. `npm test` builds the SPA first, then boots it against a throwaway DB.
export default defineConfig({
  testDir: 'tests',
  testIgnore: '**/*.test.mjs',
  timeout: 30_000,
  fullyParallel: false,        // the tests mutate shared org state, so keep them ordered
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: {
    ...devices['Desktop Chrome'],
    permissions: ['camera', 'microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  } }],

  webServer: {
    command: 'node scripts/load-db.js && node server/index.js',
    url: `http://localhost:${PORT}/v1/auth/me`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      DATABASE_FILE: 'e2e.db',
      PORT: String(PORT),
      NODE_ENV: 'production',
      JWT_SECRET: 'e2e-secret',
      PUBLIC_OWNER_LOGIN: 'true',
      OWNER_EMAIL: 'dana@example.test',
      OWNER_PASSWORD: 'demo1234',
    },
  },
});
