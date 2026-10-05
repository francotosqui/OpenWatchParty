const { defineConfig } = require('@playwright/test');

const baseURL = process.env.OWP_WEB_URL || 'http://localhost:8096/web';
const channel = process.env.OWP_BROWSER_CHANNEL || 'chrome';

module.exports = defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    channel,
    headless: true,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--mute-audio',
        '--disable-dev-shm-usage',
      ],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
