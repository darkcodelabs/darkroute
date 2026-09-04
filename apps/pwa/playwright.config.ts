import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end config. Android-first: the default project is a Pixel-class
 * Chromium at the design reference width, not a desktop browser.
 *
 * Browsers are NOT installed by `pnpm install`. Run `pnpm exec playwright
 * install chromium` once before `pnpm test:e2e`.
 */

// @types/node is not a dependency of this workspace, so the one Node global
// this config needs is declared locally rather than pulled in as a type
// package. Not `any`: the shape is exactly what is used below.
declare const process: { env: Record<string, string | undefined> };

const isCI = Boolean(process.env['CI']);
const PORT = 5173;
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // Omitted rather than set to undefined: exactOptionalPropertyTypes is on,
  // so an explicit `undefined` is not the same as "use the default".
  ...(isCI ? { workers: 1 } : {}),
  reporter: isCI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    // Geolocation is granted per-test, never globally: the product must be
    // exercised through its real permission-denied paths too.
    permissions: [],
  },

  projects: [
    {
      name: 'android-phone',
      use: { ...devices['Pixel 7'] },
    },
  ],

  webServer: {
    command: 'pnpm run dev',
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
