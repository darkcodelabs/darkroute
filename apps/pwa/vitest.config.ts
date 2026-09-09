import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Unit / component test runner.
 *
 * Deliberately separate from vite.config.ts: the PWA plugin must not run
 * during tests (it would generate a service worker per test run), and the
 * alias set is the only thing the two configs need to agree on.
 */

const srcDir = new URL('./src/', import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': srcDir,
      /**
       * THE SAME ALIAS vite.config.ts CARRIES, and the reason mesh.ts has
       * never had a test.
       *
       * `@meshtastic/js` ships an exports map pointing at `./dist/index.ts`,
       * a file that is not in the package, so a bare import fails to resolve.
       * The app config works around it and this one did not, which meant any
       * test importing `connectMesh` failed before it ran a line. The comment
       * above says the alias set is the only thing these two configs need to
       * agree on; it was the one thing they did not.
       *
       * `'@'` does not shadow this: Vite matches an alias by prefix, and
       * `'@'` only wins for `'@/...'`.
       */
      '@meshtastic/js': new URL(
        './node_modules/@meshtastic/js/dist/index.js',
        import.meta.url,
      ).pathname,
    },
  },

  test: {
    environment: 'jsdom',
    globals: true,
    // REQUIRED FILE, owned by the app agent: src/test/setup.ts must exist and
    // must contain `import '@testing-library/jest-dom/vitest';` plus an
    // afterEach(cleanup). Without it the jest-dom matchers are not registered.
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // e2e/ is Playwright's; vitest must never try to run those specs.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'dev-dist/**'],
    css: false,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
