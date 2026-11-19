import { defineConfig } from '@playwright/test';
import * as fs from 'fs';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html'], ['json', { outputFile: 'playwright-report/test-results.json' }]],
  use: { 
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://banking-3version.onrender.com',
    video: 'on',
    trace: 'on',
    screenshot: 'on',
    launchOptions: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote'
      ]
    }
  },
  projects: [
    {
      name: 'chromium',
    },
  ],
});
