/**
 * Tests for scripts/check-design-values.mjs.
 *
 * Plain `node:test` + `node:assert` -- no vitest, no dependency. Run with:
 *   node --test scripts/
 *
 * Every case builds a throwaway repo in a temp dir and runs the real CLI as a
 * subprocess, so exit codes and --json output are exercised the way CI does.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const CHECKER = resolve(import.meta.dirname, 'check-design-values.mjs');
const REAL_TOKENS = readFileSync(
  resolve(import.meta.dirname, '..', 'apps/pwa/src/styles/tokens.css'),
  'utf8',
);

const madeDirs = [];
after(() => {
  for (const d of madeDirs) rmSync(d, { recursive: true, force: true });
});

/**
 * @param {Record<string,string>} files  repo-relative path -> contents
 * @param {unknown} allowlist            value written to the allowlist file
 */
function makeRepo(files, allowlist = []) {
  const dir = mkdtempSync(join(tmpdir(), 'fwm-design-values-'));
  madeDirs.push(dir);
  const all = { 'apps/pwa/src/styles/tokens.css': REAL_TOKENS, ...files };
  for (const [rel, content] of Object.entries(all)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(
    join(dir, 'scripts', 'design-values-allowlist.json'),
    JSON.stringify(allowlist, null, 2),
  );
  return dir;
}

function run(dir, extraArgs = []) {
  const res = spawnSync(
    process.execPath,
    [CHECKER, '--root', dir, '--allowlist', join(dir, 'scripts', 'design-values-allowlist.json'),
      ...extraArgs],
    { encoding: 'utf8' },
  );
  let json = null;
  if (extraArgs.includes('--json') && res.stdout.trim() !== '') {
    try { json = JSON.parse(res.stdout); } catch { json = null; }
  }
  return { ...res, json, all: `${res.stdout}\n${res.stderr}` };
}

function runJson(dir, extraArgs = []) {
  return run(dir, ['--json', ...extraArgs]);
}

/** rule ids present in a --json run, as a Set. */
function rules(res) {
  assert.ok(res.json, `expected --json output, got:\n${res.all}`);
  return new Set(res.json.violations.map((v) => v.rule));
}

const CLEAN_CSS = `.fwm-card {
  background: var(--fwm-surface-1);
  color: var(--fwm-text);
  padding: var(--fwm-space-4);
  border-radius: var(--fwm-radius-2);
  font-family: var(--fwm-font-ui);
  box-shadow: var(--fwm-glow-alert);
  transition: opacity var(--fwm-dur-base) var(--fwm-ease-out);
  min-height: var(--fwm-touch-min);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
`;

const CLEAN_TSX = `export function Card() {
  return <div className="fwm-card" data-fwm-state="clear" />;
}
`;

// ---------------------------------------------------------------------------

test('a clean file passes', () => {
  const dir = makeRepo({
    'apps/pwa/src/components/Card.css': CLEAN_CSS,
    'apps/pwa/src/components/Card.tsx': CLEAN_TSX,
  });
  const res = runJson(dir);
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}:\n${res.all}`);
  assert.equal(res.json.ok, true);
  assert.deepEqual(res.json.violations, []);
  assert.ok(res.json.filesScanned >= 3);
});

test('a raw hex color fails', () => {
  const dir = makeRepo({ 'apps/pwa/src/components/Card.css': '.a { color: #FF2D5E; }\n' });
  const res = runJson(dir);
  assert.equal(res.status, 1, `expected exit 1, got ${res.status}:\n${res.all}`);
  assert.ok(rules(res).has('hex-color'));
  const v = res.json.violations.find((x) => x.rule === 'hex-color');
  assert.equal(v.text, '#FF2D5E');
  assert.equal(v.line, 1);
  assert.equal(v.col, 13);
});

test('a raw rgba() color fails', () => {
  const dir = makeRepo({
    'apps/pwa/src/components/Card.tsx':
      "export const s = { background: 'rgba(0, 0, 0, .5)' };\n",
  });
  const res = runJson(dir);
  assert.equal(res.status, 1, res.all);
  assert.ok(rules(res).has('color-fn'));
});

test('a tailwind arbitrary value fails', () => {
  const dir = makeRepo({
    'apps/pwa/src/components/Card.tsx':
      'export const C = () => <div className="text-[13px] gap-[7px] rounded-[4px]" />;\n',
  });
  const res = runJson(dir);
  assert.equal(res.status, 1, res.all);
  assert.equal(res.json.byRule['tailwind-arbitrary'], 3);
});

test('a hover: utility and a :hover rule both fail', () => {
  const dir = makeRepo({
    'apps/pwa/src/components/Card.tsx':
      'export const C = () => <div className="hover:opacity-50" />;\n',
    'apps/pwa/src/components/Card.css': '.a:hover { opacity: var(--fwm-o); }\n',
  });
  const res = runJson(dir);
  assert.equal(res.status, 1, res.all);
  assert.equal(res.json.byRule.hover, 2);
});

test('a third font family fails', () => {
  const dir = makeRepo({
    'apps/pwa/src/components/Card.css': ".a { font-family: 'Inter', sans-serif; }\n",
  });
  const res = runJson(dir);
  assert.equal(res.status, 1, res.all);
  const v = res.json.violations.find((x) => x.rule === 'font-family');
  assert.ok(v, `expected a font-family violation:\n${res.all}`);
  assert.equal(v.text, "'Inter'");
});

test('the shipped font families pass', () => {
  const dir = makeRepo({
    'apps/pwa/src/components/Card.css':
      ".a { font-family: 'Chakra Petch', system-ui, sans-serif; }\n" +
      ".b { font-family: 'JetBrains Mono', ui-monospace, monospace; }\n",
  });
  const res = runJson(dir);
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}:\n${res.all}`);
});

test('an allowlisted pattern passes', () => {
  const files = { 'apps/pwa/src/services/map/tiles.ts': 'export const TILE = { width: 256 };\n' };
  const withoutAllowlist = runJson(makeRepo(files));
  assert.equal(withoutAllowlist.status, 1, withoutAllowlist.all);
  assert.ok(rules(withoutAllowlist).has('length'));

  const dir = makeRepo(files, [{
    path: 'apps/pwa/src/services/map/tiles.ts',
    rule: 'length',
    pattern: '\\b(256|512)\\b',
    reason: 'slippy-map tile pixel size is a protocol constant, not a visual value',
  }]);
  const res = runJson(dir);
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}:\n${res.all}`);
  assert.equal(res.json.allowlisted.length, 1);
  assert.match(res.json.allowlisted[0].reason, /protocol constant/);
});

test('an allowlist entry missing a reason fails the run', () => {
  const dir = makeRepo(
    { 'apps/pwa/src/components/Card.css': CLEAN_CSS },
    [{ path: 'apps/pwa/src/components/Card.css', rule: 'hex-color' }],
  );
  const res = runJson(dir);
  assert.equal(res.status, 1, `expected exit 1, got ${res.status}:\n${res.all}`);
  assert.match(res.all, /allowlist entry missing reason/);
});

test('an allowlist entry with a blank reason fails the run', () => {
  const dir = makeRepo(
    { 'apps/pwa/src/components/Card.css': CLEAN_CSS },
    [{ path: 'apps/pwa/src/components/Card.css', rule: 'hex-color', reason: '   ' }],
  );
  const res = run(dir);
  assert.equal(res.status, 1);
  assert.match(res.all, /allowlist entry missing reason/);
});

test('an allowlist entry naming an unknown rule fails the run', () => {
  const dir = makeRepo(
    { 'apps/pwa/src/components/Card.css': CLEAN_CSS },
    [{ path: 'apps/pwa/src/**', rule: 'vibes', reason: 'because' }],
  );
  const res = run(dir);
  assert.equal(res.status, 1);
  assert.match(res.all, /unknown rule "vibes"/);
});

test('tokens.css may hold raw values; nothing else may', () => {
  const dir = makeRepo({
    'apps/pwa/src/styles/other.css': ':root { --x: #0E0F13; }\n',
  });
  const res = runJson(dir);
  assert.equal(res.status, 1, res.all);
  assert.equal(res.json.violations.length, 1);
  assert.equal(res.json.violations[0].file, 'apps/pwa/src/styles/other.css');
});

test('raw lengths, durations, easings, radii and shadows fail', () => {
  const dir = makeRepo({
    'apps/pwa/src/components/Card.css':
      '.a { padding: 12px; }\n' +
      '.b { transition: opacity 200ms ease-in-out; }\n' +
      '.c { animation: pulse 1.5s cubic-bezier(.2,.8,.2,1); }\n' +
      '.d { border-radius: 50%; }\n' +
      '.e { box-shadow: 0 0 28px rgb(255 45 94 / .28); }\n',
  });
  const res = runJson(dir);
  assert.equal(res.status, 1, res.all);
  const seen = rules(res);
  for (const id of ['length', 'duration', 'easing', 'radius', 'shadow']) {
    assert.ok(seen.has(id), `expected a ${id} violation, saw ${[...seen].join(', ')}\n${res.all}`);
  }
});

test('a css named color fails', () => {
  const dir = makeRepo({ 'apps/pwa/src/components/Card.css': '.a { color: red; }\n' });
  const res = runJson(dir);
  assert.equal(res.status, 1, res.all);
  assert.ok(rules(res).has('named-color'));
});

test('documented values inside comments do not fail', () => {
  const dir = makeRepo({
    'apps/pwa/src/components/Card.tsx':
      '/* the design source renders a 96px hero in #FF2D5E */\n' +
      "// hover: was removed on purpose -- 240ms ease-out\n" +
      "export const URL_BASE = 'https://example.invalid/a//b';\n",
    'apps/pwa/src/components/Card.css':
      '/* 28px glow, #FF2D5E, 400ms */\n.a { color: var(--fwm-text); }\n',
  });
  const res = runJson(dir);
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}:\n${res.all}`);
});

test('a hex color hidden in a string literal still fails', () => {
  const dir = makeRepo({
    'apps/pwa/src/components/Card.tsx': "export const HUE = '#FF2D5E';\n",
  });
  const res = runJson(dir);
  assert.equal(res.status, 1, res.all);
  assert.ok(rules(res).has('hex-color'));
});

test('a zero length keeps its unit without failing', () => {
  const dir = makeRepo({
    'apps/pwa/src/components/Card.css':
      '.a { padding-bottom: env(safe-area-inset-bottom, 0px); }\n',
  });
  const res = runJson(dir);
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}:\n${res.all}`);
});

test('a brand image outside the generated set fails', () => {
  const dir = makeRepo({ 'apps/pwa/public/assets/stock-photo.png': 'not-really-a-png' });
  const res = runJson(dir);
  assert.equal(res.status, 1, res.all);
  const v = res.json.violations.find((x) => x.rule === 'asset');
  assert.ok(v, `expected an asset violation:\n${res.all}`);
  assert.equal(v.file, 'apps/pwa/public/assets/stock-photo.png');
});

test('the brand master and its generated icons pass', () => {
  const dir = makeRepo({
    'apps/pwa/public/assets/darkroute-mark.png': 'master',
    'apps/pwa/public/icons/icon-192.png': 'generated',
    'apps/pwa/public/icons/maskable-512.png': 'generated',
  });
  const res = runJson(dir);
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}:\n${res.all}`);
});

test('test files are not scanned', () => {
  const dir = makeRepo({
    'apps/pwa/src/components/Card.test.tsx': "export const HUE = '#FF2D5E';\n",
  });
  const res = runJson(dir);
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}:\n${res.all}`);
});

test('--fix-hint names the closest token', () => {
  const dir = makeRepo({
    'apps/pwa/src/components/Card.css':
      '.a { color: #FF2D5E; }\n.b { padding: 12px; }\n.c { transition: opacity 200ms linear; }\n',
  });
  const res = runJson(dir, ['--fix-hint']);
  assert.equal(res.status, 1, res.all);
  const hint = (rule) => res.json.violations.find((v) => v.rule === rule)?.fixHint ?? '';
  assert.equal(hint('hex-color'), 'var(--fwm-alert-in-range)', 'exact value match wins');
  assert.match(hint('length'), /--fwm-space-3/);
  assert.match(hint('duration'), /--fwm-dur-fast/);
});

test('--json reports counts by rule and an explicit exit code', () => {
  const dir = makeRepo({
    'apps/pwa/src/components/Card.css': '.a { color: #FF2D5E; }\n.b:hover { opacity: 1; }\n',
  });
  const res = runJson(dir);
  assert.equal(res.json.ok, false);
  assert.equal(res.json.exitCode, 1);
  assert.equal(res.json.byRule['hex-color'], 1);
  assert.equal(res.json.byRule.hover, 1);
  assert.equal(typeof res.json.filesScanned, 'number');
});

test('the human report prints path:line:col - rule - text and a summary', () => {
  const dir = makeRepo({ 'apps/pwa/src/components/Card.css': '.a { color: #FF2D5E; }\n' });
  const res = run(dir);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /apps\/pwa\/src\/components\/Card\.css:1:13 - hex-color - #FF2D5E/);
  assert.match(res.stdout, /files scanned:/);
  assert.match(res.stdout, /exit code:\s+1/);
});

test('packages/*/src is scanned too', () => {
  const dir = makeRepo({ 'packages/core/src/alert.ts': "export const HUE = '#3DE08A';\n" });
  const res = runJson(dir);
  assert.equal(res.status, 1, res.all);
  assert.equal(res.json.violations[0].file, 'packages/core/src/alert.ts');
});

test('node_modules and dist are skipped', () => {
  const dir = makeRepo({
    'apps/pwa/src/node_modules/junk/a.css': '.a { color: #FF2D5E; }\n',
    'apps/pwa/src/dist/a.css': '.a { color: #FF2D5E; }\n',
  });
  const res = runJson(dir);
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}:\n${res.all}`);
});

/**
 * A template literal must not swallow the rest of the file.
 *
 * Stepping into `${` used to set the scanner back to code mode and drop the
 * quote entirely, forgetting that a template was still open. The `}` closed
 * nothing, so the template's own closing backtick was read as the START of a
 * new string -- and that string ran to the end of the file. Every comment after
 * the first interpolated template went unmasked, and the checker began reading
 * prose as code: it reported two lengths and three hex colours in
 * `intelState.ts`, every one of them inside a comment that named the token it
 * came from.
 *
 * It only ever over-reported, never under-reported, so nothing bad shipped
 * because of it -- but it blocks correct work, which is its own kind of bad.
 */
test('maskComments: an interpolated template does not leak into later comments', async () => {
  const { maskComments } = await import('./check-design-values.mjs');

  const cases = [
    ['plain template', 'const a = `x`;\n/* c 375px */\n'],
    ['one expression', 'const a = `${b}`;\n/* c 375px */\n'],
    ['two expressions', 'const a = `${b} @ ${c}`;\n/* c 375px */\n'],
    ['object literal inside the expression', 'const a = `${ {x: 1}.x }`;\n/* c 375px */\n'],
    ['a template inside a template', 'const a = `${ `${b}` }`;\n/* c 375px */\n'],
    ['a string after the template', "const a = `${b}`;\nconst c = 'x';\n/* c 375px */\n"],
  ];

  for (const [name, src] of cases) {
    const masked = maskComments(src, '.ts');
    assert.ok(
      !masked.includes('375px'),
      `${name}: comment leaked through the mask -> ${JSON.stringify(masked)}`,
    );
  }

  // And the code itself is still there to be checked -- masking comments must
  // not mask the program.
  assert.ok(maskComments('const a = `${b}`;\n/* c */\n', '.ts').includes('const a ='));
});

// ---------------------------------------------------------------------------
// unresolved-var
// ---------------------------------------------------------------------------

/**
 * THE GATE CHECKED THAT A VALUE WAS A TOKEN. IT NEVER CHECKED THE TOKEN WAS
 * REAL.
 *
 * `--fwm-tint-scan-line`, `--fwm-space-5` and `--fwm-shadow-ink` all shipped as
 * references before they existed, in two days, and every rule above passed
 * them: each asks whether a value is expressed as `var(--fwm-*)`, and all three
 * were. CSS throws away a declaration whose custom property is undefined -- no
 * warning, no fallback, no paint -- so two of the three shipped a transparent
 * border and no padding, on a screen somebody reads while driving.
 */
test('a var(--fwm-*) that names nothing fails', () => {
  const dir = makeRepo({
    'apps/pwa/src/features/mesh/meshChat.css':
      '.fwm-chat-send svg {\n  width: var(--fwm-space-5);\n}\n',
  });
  const res = runJson(dir);
  assert.equal(res.status, 1, `expected exit 1, got ${res.status}:\n${res.all}`);
  const v = res.json.violations.find((x) => x.rule === 'unresolved-var');
  assert.ok(v, `expected an unresolved-var violation:\n${res.all}`);
  assert.equal(v.text, 'var(--fwm-space-5)');
  assert.equal(v.line, 2);
  assert.match(v.why, /not defined in tokens\.css or in this file/);
});

/**
 * Component-scoped locals are the normal way a screen derives a stroke from the
 * space scale without minting a token, and there are dozens of them. A rule
 * that flagged those would be deleted within a day, which is the same as not
 * having one.
 */
test("a component's own local resolves", () => {
  const dir = makeRepo({
    'apps/pwa/src/features/radar/radar.css':
      '.fwm-radar {\n  --fwm-radar-ring-w: calc(var(--fwm-space-1) * 0.75);\n}\n' +
      '.fwm-radar-card {\n  border-width: var(--fwm-radar-ring-w);\n}\n',
  });
  const res = runJson(dir);
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}:\n${res.all}`);
});

/**
 * The pre-existing shape of this bug, and the one that survives review: the
 * name is spelled correctly and does exist -- on a screen that is never this
 * screen's ancestor, so the cascade never carries it here. Naming the file that
 * declares it is the difference between "this is undefined" and "you are
 * reading SETTINGS' local from NODE", which are fixed differently.
 */
test("another component's local fails, and the message names the file that declares it", () => {
  const dir = makeRepo({
    'apps/pwa/src/features/settings/settings.css':
      '.fwm-settings {\n  --fwm-settings-rule-w: calc(var(--fwm-space-1) / 4);\n}\n',
    'apps/pwa/src/features/node/node.css':
      '.fwm-node-key {\n  border: var(--fwm-settings-rule-w) solid var(--fwm-line);\n}\n',
  });
  const res = runJson(dir);
  assert.equal(res.status, 1, `expected exit 1, got ${res.status}:\n${res.all}`);
  // SETTINGS reads its own declaration and is not at fault; NODE is.
  assert.equal(res.json.violations.length, 1, res.all);
  const v = res.json.violations[0];
  assert.equal(v.rule, 'unresolved-var');
  assert.equal(v.file, 'apps/pwa/src/features/node/node.css');
  assert.match(v.why, /apps\/pwa\/src\/features\/settings\/settings\.css/);
});

/**
 * A FALLBACK IS THE ONE HONEST ANSWER TO "THIS MAY NOT BE DEFINED".
 *
 * `--fwm-vehicle-rotation` is written onto the vehicle marker by `MapCanvas`
 * once a heading arrives, so no stylesheet can declare it and none should.
 * Without the `0deg` the transform is invalid until the first fix and the arrow
 * paints off-centre -- the fallback is what makes first paint correct, which is
 * the same reason it makes the reference legitimate. An EMPTY fallback states
 * nothing and still paints nothing, so it buys nothing.
 */
test('a fallback resolves the reference; an empty fallback does not', () => {
  const ok = runJson(makeRepo({
    'apps/pwa/src/features/map/map.css':
      '.fwm-map-vehicle {\n  transform: rotate(var(--fwm-vehicle-rotation, 0deg));\n}\n',
  }));
  assert.equal(ok.status, 0, `expected exit 0, got ${ok.status}:\n${ok.all}`);

  const empty = runJson(makeRepo({
    'apps/pwa/src/features/map/map.css':
      '.fwm-map-vehicle {\n  transform: rotate(var(--fwm-vehicle-rotation,));\n}\n',
  }));
  assert.equal(empty.status, 1, `expected exit 1, got ${empty.status}:\n${empty.all}`);
  assert.ok(rules(empty).has('unresolved-var'), empty.all);
});

/**
 * Half the token comments in this repo quote a `var(--fwm-*)` to say which
 * token a rule belongs to. Prose about a token is not a read of one, and a rule
 * that could not tell the difference would report the documentation.
 */
test('a var(--fwm-*) named in a comment is not a reference', () => {
  const dir = makeRepo({
    'apps/pwa/src/features/report/report.css':
      '/* Read as `var(--fwm-report-tint)` at every use. */\n' +
      '.fwm-report {\n  color: var(--fwm-text);\n}\n',
  });
  const res = runJson(dir);
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}:\n${res.all}`);
});

/**
 * A fallback nobody can resolve is not a fallback. Reading to the first `)`
 * would end the reference at the inner name and take the fallback for the outer
 * one's own text, so `var(--fwm-a, var(--fwm-typo))` would both hide the typo
 * and mis-report the name it did read.
 */
test('a var() inside a fallback is checked too', () => {
  const good = runJson(makeRepo({
    'apps/pwa/src/features/sweep/sweep.css':
      '.fwm-sweep {\n  transition-timing-function: var(--fwm-ease-linear, var(--fwm-ease-mech));\n}\n',
  }));
  assert.equal(good.status, 0, `expected exit 0, got ${good.status}:\n${good.all}`);

  const bad = runJson(makeRepo({
    'apps/pwa/src/features/sweep/sweep.css':
      '.fwm-sweep {\n  transition-timing-function: var(--fwm-ease-linear, var(--fwm-ease-nope));\n}\n',
  }));
  assert.equal(bad.status, 1, `expected exit 1, got ${bad.status}:\n${bad.all}`);
  const v = bad.json.violations.find((x) => x.rule === 'unresolved-var');
  assert.ok(v, `expected an unresolved-var violation:\n${bad.all}`);
  assert.equal(v.text, 'var(--fwm-ease-nope)');
});

/**
 * A silent failure must not be hidden by a loud one.
 *
 * A rule that claims marks the bytes it explains so later rules do not
 * double-report them, and `color-mix()`'s claim runs straight through the
 * `var()` inside it. Ordered anywhere after `color-fn`, an unresolved reference
 * that happened to sit in a colour function would be suppressed by the finding
 * above it -- one bug quietly eating another, which is the shape of the bug
 * this rule exists to stop. It runs first, and claims nothing.
 */
test('an unresolved reference inside a claimed range is still reported', () => {
  const dir = makeRepo({
    'apps/pwa/src/features/intel/intel.css':
      '.fwm-intel {\n' +
      '  background: color-mix(in srgb, var(--fwm-tint-scan-line) 82%, transparent);\n' +
      '}\n',
  });
  const res = runJson(dir);
  assert.equal(res.status, 1, `expected exit 1, got ${res.status}:\n${res.all}`);
  assert.ok(rules(res).has('unresolved-var'), res.all);
});

/**
 * A rule id the allowlist does not know is not merely un-exemptable: it fails
 * the whole run as a bad allowlist, so the first person to write the obvious
 * exemption would break the gate rather than the build they were fixing.
 */
test('unresolved-var can be allowlisted like any other rule', () => {
  const files = {
    'apps/pwa/src/features/map/map.css':
      '.fwm-map-vehicle {\n  transform: rotate(var(--fwm-vehicle-rotation));\n}\n',
  };
  assert.equal(runJson(makeRepo(files)).status, 1);

  const res = runJson(makeRepo(files, [{
    path: 'apps/pwa/src/features/map/map.css',
    rule: 'unresolved-var',
    pattern: '^var\\(--fwm-vehicle-rotation\\)$',
    reason: 'set on the marker element by MapCanvas; no stylesheet can declare it',
  }]));
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}:\n${res.all}`);
});
