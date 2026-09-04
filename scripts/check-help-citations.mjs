/**
 * check-help-citations.mjs - every privacy answer must point at a real file.
 *
 * `features/help/answers.ts` is the screen that tells a driver what this app
 * does with them, and its entire argument is "go and check" - each answer names
 * the files that make it true. A citation pointing at a renamed or deleted file
 * turns the page into decoration, and a reader who follows one dead path stops
 * trusting the rest of it. Correctly.
 *
 * It lives here rather than in the app's own suite because that suite runs
 * under a tsconfig with no filesystem types, deliberately. This runs in CI via
 * `pnpm lint`.
 *
 * Exit codes: 0 = every citation resolves, 1 = at least one does not.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'apps/pwa/src/features/help/answers.ts');

/** Pull the `checkIn: [...]` string literals out without executing any TS. */
export function citationsIn(source) {
  const cited = new Set();
  for (const block of source.matchAll(/checkIn:\s*\[([^\]]*)\]/g)) {
    for (const literal of block[1].matchAll(/'([^']+)'/g)) cited.add(literal[1]);
  }
  return [...cited].sort();
}

function main() {
  if (!existsSync(SOURCE)) {
    process.stderr.write(`check-help-citations: ${SOURCE} is missing\n`);
    return 1;
  }
  const cited = citationsIn(readFileSync(SOURCE, 'utf8'));
  if (cited.length === 0) {
    process.stderr.write('check-help-citations: no citations found - the parser or the file changed\n');
    return 1;
  }

  const missing = cited.filter((file) => !existsSync(join(ROOT, file)));
  for (const file of missing) process.stdout.write(`  MISSING  ${file}\n`);
  process.stdout.write(
    `help citations: ${String(cited.length - missing.length)}/${String(cited.length)} resolve\n`,
  );
  return missing.length === 0 ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);
if (invokedDirectly) process.exit(main());
