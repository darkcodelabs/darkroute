/**
 * The Functions' own unit tests.
 *
 * `apps/pwa`'s vitest is scoped to `src/**`, so nothing under `functions/` was
 * ever collected -- including the rule that stops an administrator removing
 * themselves and locking the account out of its own admin screen. There is a
 * `typecheck:functions`; this is its test-runner counterpart.
 *
 * Node environment on purpose: these run on Cloudflare Workers, where there is
 * no DOM, and a test that passed only because jsdom supplied one would be
 * testing the wrong runtime.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Rooted here rather than at whatever cwd the runner was launched from --
  // the binary lives in apps/pwa and would otherwise collect that project's
  // tests instead of these.
  root: import.meta.dirname,
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
});
