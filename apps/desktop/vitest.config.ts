/**
 * The console's tests: today, its Pages Functions.
 *
 * Node environment because those run on Cloudflare Workers, where there is no
 * DOM. The React views have no tests yet; when they do they will want jsdom and
 * a second project, not a change to this one.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['functions/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
