/**
 * THE WRITEUP MUST STAY TRUE OF THE TREE.
 *
 * `docs/public/WHAT-DARKROUTE-IS.md` is the long-form account of what this
 * product is, and its whole argument is that every technical claim names the
 * file that makes it true. A citation pointing at a renamed or deleted file
 * turns that argument into decoration, and a reader who follows one dead path
 * stops trusting the rest of it. Correctly.
 *
 * So this reads the document, pulls out every backticked repository path and
 * every script a fenced command runs, and fails if one of them is no longer in
 * the tree. A rename anywhere breaks CI until the document is updated. It runs
 * with the rest of `scripts/*.test.mjs` under `pnpm test:scripts`.
 *
 * It also reads the `:line` suffixes and fails if one points past the end of
 * its file - a citation to line 1268 of a 900-line script is a range that has
 * gone stale, and it was correct once, which is exactly why nobody rechecks it.
 *
 * WHAT IT CANNOT DO, said once: it does not know a NUMBER went stale, and it
 * does not know a line that still exists still says what the document claims.
 * The measured figures in the document carry their date; re-run its §9 for
 * those, and read the cited line for the rest.
 *
 * THREE SHAPES OF CITATION, resolved three ways:
 *
 *   apps/pwa/src/x/y.ts:12-14    a path from the repository root, any extension,
 *                                with an optional `:line`, `:a-b` or `:a-b,c`
 *                                suffix that is stripped before the check. A
 *                                trailing slash names a directory.
 *   services/cameras/sync.ts     a path relative to one of the source roots the
 *                                public documents abbreviate against.
 *   sync.ts                      a bare source file name. It must exist SOMEWHERE
 *                                in the tree, outside node_modules and build
 *                                output. Restricted to source extensions so a
 *                                data file the document says is ABSENT
 *                                (`continuity.json`) is not mistaken for a
 *                                citation.
 *
 * Anything else in backticks - a URL, an R2 key, a header name, a token, a
 * glob - is ignored, and the parser is tested on a fixture below so a change to
 * it cannot silently start ignoring everything.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
export const DOCUMENT = 'docs/public/WHAT-DARKROUTE-IS.md';

/** Top-level directories a repository-root citation may start with. */
const ROOT_PREFIXES = ['.github/', 'apps/', 'packages/', 'functions/', 'scripts/', 'docs/', 'transparency/'];

/** Where an abbreviated path (`services/cameras/sync.ts`) is looked up. */
const SHORT_BASES = ['apps/pwa/src', 'packages/core/src', 'functions', 'scripts'];

/** A bare file name is a citation only with one of these extensions. */
const SOURCE_EXT = new Set(['.ts', '.tsx', '.mjs', '.css', '.yml', '.yaml', '.xml', '.md']);

/** Never descended when looking for a bare file name. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.turbo', '.vite', 'out']);

/** `path:12`, `path:12-14`, `path:25-27,49` - the line suffix the documents use. */
const LINE_SUFFIX = /:\d+(?:[-–]\d+)?(?:,\d+(?:[-–]\d+)?)*$/;

/**
 * Every backticked span that reads as a repository path, line suffix removed.
 * Pure: takes the markdown, returns sorted unique strings.
 */
export function citedPaths(markdown) {
  const out = new Set();
  for (const match of markdown.matchAll(/`([^`\n]+)`/g)) {
    const raw = match[1].trim();
    if (raw.includes('://') || /\s|[*{}<>=()'"|]/.test(raw)) continue;
    if (raw.startsWith('/') || raw.startsWith('.') && !raw.startsWith('.github/')) continue;
    const path = raw.replace(LINE_SUFFIX, '');
    if (path === '' || path.endsWith(':')) continue;
    const fromRoot = ROOT_PREFIXES.some((prefix) => path.startsWith(prefix));
    const hasSlash = path.includes('/');
    const bare = !hasSlash && SOURCE_EXT.has(extname(path)) && /^[\w.@[\]-]+$/.test(path);
    if (fromRoot || (hasSlash && SOURCE_EXT.has(extname(path))) || bare) out.add(path);
  }
  return [...out].sort();
}

/**
 * Every script a fenced command runs: `node scripts/x.mjs`, or a bare
 * `scripts/x.mjs` argument. Comment lines are skipped - they are output, not
 * commands. Pure.
 */
export function commandScripts(markdown) {
  const out = new Set();
  for (const block of markdown.matchAll(/^```(\w*)\n([\s\S]*?)^```/gm)) {
    if (block[1] !== '' && block[1] !== 'bash' && block[1] !== 'sh') continue;
    for (const line of block[2].split('\n')) {
      if (line.trim().startsWith('#')) continue;
      for (const m of line.matchAll(/(?:^|[\s"'])((?:scripts|apps|functions|packages)\/[\w./\-[\]]+\.mjs)\b/g)) {
        out.add(m[1]);
      }
    }
  }
  return [...out].sort();
}

/**
 * `pnpm <script>` and `pnpm run <script>` in fenced commands. `--filter` forms
 * are checked against the filtered package when it is the PWA. Pure.
 */
export function pnpmScripts(markdown) {
  const out = new Set();
  for (const block of markdown.matchAll(/^```(\w*)\n([\s\S]*?)^```/gm)) {
    if (block[1] !== '' && block[1] !== 'bash' && block[1] !== 'sh') continue;
    for (const line of block[2].split('\n')) {
      if (line.trim().startsWith('#')) continue;
      const m = /(?:^|\s)pnpm\s+(?:--filter\s+(\S+)\s+)?(?:run\s+)?([a-z][\w:-]*)/.exec(line);
      if (m !== null) out.add(`${m[1] ?? '.'} ${m[2]}`);
    }
  }
  return [...out].sort();
}

/**
 * Every citation that carries a line suffix, with the highest line it names.
 * Bare file names are skipped: `sync.ts:63` could be any of several files and
 * a guess would produce a failure nobody can act on. Pure.
 */
export function citedLines(markdown) {
  const out = new Map();
  for (const match of markdown.matchAll(/`([^`\n]+)`/g)) {
    const raw = match[1].trim();
    if (raw.includes('://') || /\s|[*{}<>=()'"|]/.test(raw)) continue;
    const suffix = LINE_SUFFIX.exec(raw);
    if (suffix === null) continue;
    const path = raw.slice(0, suffix.index);
    if (!path.includes('/')) continue;
    if (!ROOT_PREFIXES.some((prefix) => path.startsWith(prefix)) && !SOURCE_EXT.has(extname(path))) continue;
    const highest = Math.max(...suffix[0].slice(1).split(/[-–,]/).map(Number));
    out.set(path, Math.max(out.get(path) ?? 0, highest));
  }
  return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else {
      yield join(dir, entry.name);
    }
  }
}

let basenameIndex = null;
function treeHasBasename(name) {
  if (basenameIndex === null) {
    basenameIndex = new Set();
    for (const file of walk(ROOT)) basenameIndex.add(basename(file));
  }
  return basenameIndex.has(name);
}

/** Where a citation resolves, or null. Exported so the failure can say which rule was tried. */
export function resolveCitation(path, root = ROOT) {
  if (path.includes('/')) {
    const candidates = ROOT_PREFIXES.some((p) => path.startsWith(p))
      ? [path]
      : SHORT_BASES.map((base) => `${base}/${path}`);
    for (const candidate of candidates) {
      const full = join(root, candidate);
      if (existsSync(full)) {
        if (path.endsWith('/') && !statSync(full).isDirectory()) return null;
        return candidate;
      }
    }
    return null;
  }
  return treeHasBasename(path) ? `*/${path}` : null;
}

const FIXTURE = [
  'Read `apps/pwa/src/services/cameras/sync.ts:262-268` and `route.ts:57`, plus',
  '`scripts/camera-generation.mjs:38-47`, `AndroidManifest.xml:25-27,49` and the',
  'directory `apps/pwa/public/cameras/11/`. Ignore `https://darkroute.ai/x.json`,',
  '`__camera/current.json`, `continuity.json`, `/cameras/11/{x}/{y}.json`,',
  '`--fwm-glass-rim`, `x-darkroute-camera-generation`, `apps/pwa/public/cameras/11/**`.',
  '',
  '```bash',
  '# node scripts/not-a-command.mjs',
  'node scripts/check-design-values.mjs',
  'pnpm --filter @fwm/pwa test:unit -- mesh.privacy',
  'pnpm lint',
  '```',
  '',
  '```text',
  'node scripts/ignored-in-text-blocks.mjs',
  '```',
  '',
].join('\n');

describe('the parser', () => {
  it('keeps the three citation shapes and strips the line suffix', () => {
    assert.deepEqual(citedPaths(FIXTURE), [
      'AndroidManifest.xml',
      'apps/pwa/public/cameras/11/',
      'apps/pwa/src/services/cameras/sync.ts',
      'route.ts',
      'scripts/camera-generation.mjs',
    ]);
  });

  it('reads the highest cited line per path, and skips bare names', () => {
    assert.deepEqual(citedLines(FIXTURE), [
      ['apps/pwa/src/services/cameras/sync.ts', 268],
      ['scripts/camera-generation.mjs', 47],
    ]);
  });

  it('reads scripts only from command fences, and never from comment lines', () => {
    assert.deepEqual(commandScripts(FIXTURE), ['scripts/check-design-values.mjs']);
  });

  it('reads pnpm scripts with their filter', () => {
    assert.deepEqual(pnpmScripts(FIXTURE), ['. lint', '@fwm/pwa test:unit']);
  });
});

describe(DOCUMENT, () => {
  const markdown = readFileSync(join(ROOT, DOCUMENT), 'utf8');
  const paths = citedPaths(markdown);
  const scripts = commandScripts(markdown);

  it('cites enough paths that an empty parse would be noticed', () => {
    // The document cites well over a hundred files. Far fewer means the parser
    // or the document changed shape, and a green run on nothing is the failure
    // this whole file exists to prevent.
    assert.ok(paths.length >= 100, `only ${String(paths.length)} paths were parsed`);
    assert.ok(scripts.length >= 3, `only ${String(scripts.length)} command scripts were parsed`);
  });

  it('cites only paths that exist in the tree', () => {
    const missing = paths.filter((path) => resolveCitation(path) === null);
    assert.deepEqual(
      missing,
      [],
      `these citations no longer resolve; update ${DOCUMENT} in the same change:\n  ${missing.join('\n  ')}`,
    );
  });

  it('cites no line past the end of its file', () => {
    const overrun = [];
    for (const [path, highest] of citedLines(markdown)) {
      const resolved = resolveCitation(path);
      if (resolved === null) continue; // reported by the test above
      const lines = readFileSync(join(ROOT, resolved), 'utf8').split('\n').length;
      if (highest > lines) overrun.push(`${path}:${String(highest)} (file has ${String(lines)} lines)`);
    }
    assert.deepEqual(overrun, [], `these citations name a line the file does not have:\n  ${overrun.join('\n  ')}`);
  });

  it('runs only scripts that exist', () => {
    const missing = scripts.filter((script) => !existsSync(join(ROOT, script)));
    assert.deepEqual(missing, [], `fenced commands name scripts that are gone:\n  ${missing.join('\n  ')}`);
  });

  it('names only pnpm scripts that package.json declares', () => {
    const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const pwaPkg = JSON.parse(readFileSync(join(ROOT, 'apps/pwa/package.json'), 'utf8'));
    const missing = pnpmScripts(markdown).filter((entry) => {
      const [filter, script] = entry.split(' ');
      const pkg = filter === '.' ? rootPkg : filter === '@fwm/pwa' ? pwaPkg : null;
      return pkg === null || !Object.hasOwn(pkg.scripts ?? {}, script);
    });
    assert.deepEqual(missing, [], `fenced commands name pnpm scripts that are not declared:\n  ${missing.join('\n  ')}`);
  });

  it('carries the measurement date and the tree it was written against', () => {
    assert.match(markdown, /\*Measured against the working tree and the live host on \d{4}-\d{2}-\d{2}\.\*/);
  });
});
