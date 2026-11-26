import { defineConfig, devices } from '@playwright/test';

// Smoke test against the production build served by `vite preview`.
// Headless Chromium has no GPU, so WebGL2 runs on SwiftShader (software).
// Set CHROMIUM_PATH to use a system Chrome/Chromium instead of the
// Playwright-downloaded one (`npx playwright install chromium`).
const executablePath = process.env.CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Desktop Chrome'],
    launchOptions: {
      executablePath,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
