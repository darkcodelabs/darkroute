/**
 * RUN SOMETHING ONLY IF WHAT IT TESTS IS IN THIS TREE.
 *
 * =============================================================================
 * THE BUG THIS EXISTS TO PREVENT
 * =============================================================================
 * `test:unit` chained `test:gateway`, whose definition was deleted when the
 * operator surface was dropped - but the CALL was left in the chain. So
 * `pnpm test` ended every run with:
 *
 *   ERR_PNPM_NO_SCRIPT  Missing script: test:gateway
 *
 * and exited 1 no matter how many tests passed. The deploy gate runs `pnpm
 * test` before it builds, so production was ungateable and the failure looked
 * like a broken test suite rather than a broken script chain.
 *
 * =============================================================================
 * WHY IT IS CONDITIONAL RATHER THAN JUST RESTORED
 * =============================================================================
 * `backend/` is a PUBLIC_SEED_PREFIX_EXCLUSION: it is not in the published
 * tree. `package.json` is copied into that tree verbatim, so a script that
 * hard-references `backend/gateway/vitest.config.ts` would make `pnpm test`
 * fail for every reader who cloned it - the same class of failure, moved onto
 * somebody else.
 *
 * One tree has the gateway and must test it. The other does not have it and
 * must not pretend to. This resolves that at runtime by looking, which is the
 * only thing that can be true in both.
 *
 * A skip is announced. A silent skip is how a suite quietly stops covering
 * something, and the whole point here is that a missing thing was invisible.
 *
 * USAGE
 *   node scripts/run-if-present.mjs <path> <command> [args...]
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [path, command, ...commandArgs] = process.argv.slice(2);

if (path === undefined || command === undefined) {
  process.stderr.write('usage: run-if-present.mjs <path> <command> [args...]\n');
  process.exit(2);
}

if (!existsSync(resolve(ROOT, path))) {
  // Names the whole command, not argv[0]. "skipped: npx" tells a reader
  // nothing about what stopped being covered.
  process.stdout.write(`skipped: ${[command, ...commandArgs].join(' ')}\n`);
  process.stdout.write(`  ${path} is not in this tree\n`);
  process.exit(0);
}

const result = spawnSync(command, commandArgs, { cwd: ROOT, stdio: 'inherit', shell: false });
if (result.error !== undefined) {
  process.stderr.write(`${command} could not be started: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
