// @ts-check
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config for the whole workspace.
 *
 * Type-aware linting is deliberately NOT enabled yet: it needs a project
 * service that covers the config files at the workspace root, and @types/node
 * is not an approved dependency of this repo. `pnpm typecheck` runs the strict
 * compiler over the same files, so nothing goes unchecked -- only the
 * type-aware ESLint rules are deferred.
 *
 * `pnpm lint` runs this and then scripts/check-design-values.mjs, which is the
 * half that enforces the design-token rules ESLint cannot see.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dev-dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      /*
       * AGENT WORKTREES. `.claude/worktrees/` holds throwaway git worktrees --
       * full checkouts of THIS repository, nested inside it.
       *
       * Not linting them is the obvious half. The half that actually bites is
       * that each carries its own `tsconfig.json`, so typescript-eslint sees
       * several candidate roots and refuses to type-check ANYTHING:
       *
       *   Parsing error: No tsconfigRootDir was set, and multiple candidate
       *   TSConfigRootDirs are present
       *
       * That is not a few extra findings, it is the whole repository failing to
       * lint. Measured: `npx eslint . --max-warnings=0` reported 1,899 errors
       * with three worktrees present and ZERO with the same tree after they
       * were removed. `pnpm lint` therefore went red for reasons that had
       * nothing to do with the code, on any machine that had run an agent.
       *
       * They are already gitignored; this is the linter's half of the same fact.
       */
      '.claude/worktrees/**',
      // Glob, not the name: this said `.venv-darkroute-back-end/**` -- the name
      // installer.sh creates -- so on any machine set up before the rebrand,
      // where the venv still carries the old project name, eslint walked 211 MB
      // of vendored Python wheels and failed on somebody else's bundled
      // JavaScript. Matching any venv makes that impossible to reintroduce.
      '.venv*/**',
      // Generated snapshots from the curation tooling, where present. Its
      // first-party sources are linted with the rest of the repository.
      '**/curation-out/**',
      'sbom/**',
      // The design source, extracted from the .zip for reference. It is the
      // designer's export, not our code, and it is gitignored — linting it
      // would mean editing it, and editing it would mean losing the spec.
      '.design-src/**',
      '.design-src-v2/**',
      '.design-src-v3/**',
      '.design-src-v1/**',
      // Wrangler's dev state and the bundles it compiles `functions/` into.
      // This was the whole of a 454-error lint failure: the generated worker
      // is one file of bundled dependencies, and linting a build output says
      // nothing about the source it was built from, which is linted already.
      '.wrangler/**',
    ],
  },

  ...tseslint.configs.recommended,
  ...tseslint.configs.strict,

  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // --- correctness -------------------------------------------------
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-debugger': 'error',
      'no-alert': 'error',
      'no-implicit-coercion': 'error',
      'no-param-reassign': 'error',

      // --- typescript --------------------------------------------------
      // Rule: no `any` without a written justification. An inline disable is
      // the only way past this, and an inline disable needs a comment.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },

  {
    // Application and library source. The privacy rules below apply here only.
    files: ['apps/pwa/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
    rules: {
      // PRIVACY INVARIANT. Plate values, watchlist entries and exact
      // coordinates must never reach a log sink -- and a log line is the
      // easiest place for them to leak. Every console call in product code is
      // an error; a deliberate diagnostic must carry an inline disable, which
      // forces the author to write down why it is safe.
      'no-console': 'error',

      // PRIVACY INVARIANT. Web Storage is synchronous, unencrypted, readable
      // by any script on the origin, and trivially snapshotted. Local secrets
      // (plates, watchlist) belong in the encrypted IndexedDB vault. Use `idb`.
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message: 'Use the idb-backed local store. Plates/watchlist are local-only secrets.',
        },
        {
          name: 'sessionStorage',
          message: 'Use the idb-backed local store. Plates/watchlist are local-only secrets.',
        },
      ],
    },
  },

  {
    // Build/tooling files: default exports are their contract, and they run in
    // Node where writing to stdout is the point.
    files: [
      '*.{js,mjs,cjs,ts}',
      'scripts/**/*.{js,mjs,ts}',
      'apps/*/vite.config.ts',
      'apps/*/vitest.config.ts',
      'apps/*/playwright.config.ts',
      'apps/*/tailwind.config.ts',
      'apps/*/postcss.config.js',
    ],
    rules: {
      'no-console': 'off',
    },
  },

  {
    // Tests may assert on anything and may reach for shapes the strict rules
    // would otherwise block.
    files: ['**/*.test.{ts,tsx}', 'apps/*/e2e/**/*.ts', 'apps/*/src/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
);
