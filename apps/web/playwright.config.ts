import { defineConfig } from '@playwright/test';

const mode = process.env.MF_SMOKE_MODE === 'dev' ? 'dev' : 'preview';
export default defineConfig({
  testDir: './tests/federation',
  workers: 1,
  forbidOnly: !!process.env.CI,
  use: { baseURL: 'http://localhost:5173', headless: true },
  webServer: [
    {
      command: `pnpm --filter @mercadoya/mf-catalog ${mode}`,
      cwd: '../..',
      url: 'http://localhost:5174/remoteEntry.js',
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter @mercadoya/web ${mode}`,
      cwd: '../..',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
    },
  ],
});
