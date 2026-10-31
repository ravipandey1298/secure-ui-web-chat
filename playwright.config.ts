import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: { baseURL: 'http://localhost:3100', trace: 'off', screenshot: 'only-on-failure' },
  // Traces are off because they would retain the raw one-time URL credentials.
  webServer: {
    command: 'node --experimental-strip-types tests/browser-server.ts',
    url: 'http://localhost:3100/admin/login',
    timeout: 60000,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium', channel: 'chrome' },
    },
    {
      name: 'iphone-viewport',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', channel: 'chrome' },
    },
  ],
});
