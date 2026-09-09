import { defineConfig } from 'vitest/config';

/**
 * @fwm/core runs in plain node. There is no DOM, no jsdom and no setup file:
 * if a test in this package needs a browser global, the code under test has
 * broken the package's zero-platform-dependency rule and the test should fail.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
});
