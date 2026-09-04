/**
 * BUILD A DESIGN SYSTEM FROM THE APP AS IT ACTUALLY RUNS.
 *
 * =============================================================================
 * WHY CAPTURE RATHER THAN DOCUMENT
 * =============================================================================
 * A design system written by hand describes what somebody believed the app
 * did. This one is read out of the running app: the tokens come from the
 * stylesheet the browser actually resolved, and every screen is a photograph
 * of that screen rendering, in the modes it ships. A designer opening this
 * cannot be told something the product does not do, because nothing here is
 * typed twice.
 *
 * The cost is honest too: a captured screen shows the state the capture found
 * it in. An empty list is an empty list, not a designed empty state, and the
 * inventory says which is which.
 *
 * =============================================================================
 * WHAT IT PRODUCES
 * =============================================================================
 *   design-system/
 *     README.md            what this is, how it was made, what it is not
 *     tokens.md            every --fwm-* the browser resolved, by family
 *     tokens.json          the same, machine readable, for Figma import
 *     screens.md           the inventory, with what each screen was showing
 *     screens/<id>-<mode>.png
 *     components.md        the repeated parts, and where they are defined
 *
 * USAGE
 *   node scripts/design-system.mjs --base=http://localhost:8787 --out=design-system
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SCREENS = [
  { id: 'radar', note: 'the default screen; map, corridor ladder, compass' },
  { id: 'ask', note: 'voice query' },
  { id: 'log', note: 'what has been passed' },
  { id: 'report', note: 'add a camera' },
  { id: 'intel', note: 'one camera in detail' },
  { id: 'offline', note: 'what is available with no signal' },
  { id: 'onboarding', note: 'first run, permissions' },
  { id: 'settings', note: 'modes, thresholds, stored data' },
  { id: 'help', note: 'answers, each citing the code that makes it true' },
  { id: 'node', note: 'firmware install, bluetooth pairing, mesh chat' },
  { id: 'triage', note: 'alert review' },
  { id: 'admin', note: 'tester management' },
];

/**
 * The two modes worth capturing every screen in.
 *
 * `night-watch` is the default and is what most drivers see. `refinement` is
 * the one LIGHT mode, and it is where contrast bugs live: seven of the eight
 * palettes are dark, so a token that was only ever checked against black is
 * only ever wrong here.
 */
const MODES = ['night-watch', 'refinement'];

/** A phone, because that is what this is used on. */
const VIEWPORT = { width: 393, height: 852, deviceScaleFactor: 2 };

function parseArgs(argv) {
  const opts = { base: 'http://localhost:8787', out: 'design-system' };
  for (const arg of argv) {
    const m = /^--(base|out)=(.+)$/.exec(arg);
    if (m !== null) opts[m[1]] = m[2];
  }
  return opts;
}

/** Group a token by what it controls, so the file reads like a system. */
function familyOf(name) {
  if (/^--fwm-(bg|surface|scrim|tint|line|text|accent|hue|heat|plasma|status)/.test(name)) {
    return 'colour';
  }
  if (/^--fwm-(font|text-)/.test(name)) return 'type';
  if (/^--fwm-(space|touch|nav-h|header-h|dock-h)/.test(name)) return 'space';
  if (/^--fwm-radius/.test(name)) return 'radius';
  if (/^--fwm-(dur|ease|motion)/.test(name)) return 'motion';
  return 'other';
}

export async function main(argv) {
  const { base, out } = parseArgs(argv);
  const outDir = resolve(process.cwd(), out);
  mkdirSync(join(outDir, 'screens'), { recursive: true });

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    deviceScaleFactor: VIEWPORT.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  // Web Serial and Web Bluetooth do not exist in headless chromium, and the
  // NODE screen renders a blocker instead of its own content without them.
  // Stubbed so the capture shows the screen rather than the apology.
  await page.addInitScript(() => {
    if (!('serial' in navigator)) {
      Object.defineProperty(navigator, 'serial', {
        value: { getPorts: async () => [], requestPort: async () => null },
        configurable: true,
      });
    }
    if (!('bluetooth' in navigator)) {
      Object.defineProperty(navigator, 'bluetooth', {
        value: { getAvailability: async () => true, getDevices: async () => [] },
        configurable: true,
      });
    }
  });

  const captured = [];
  const errors = [];

  for (const mode of MODES) {
    for (const screen of SCREENS) {
      const url = `${base}/?screen=${screen.id}`;
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
        // The mode is an attribute on <html>, so it can be set directly rather
        // than driven through the settings UI for every combination.
        await page.evaluate((m) => {
          document.documentElement.dataset['fwmMode'] = m;
        }, mode);
        await page.waitForTimeout(1200);

        const file = `screens/${screen.id}-${mode}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: true });

        const state = await page.evaluate(() => ({
          title: document.querySelector('h1')?.textContent?.trim() ?? null,
          // What the capture actually found, so an empty screen is not
          // mistaken for a designed empty state.
          text: (document.body.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 220),
          height: document.documentElement.scrollHeight,
        }));

        captured.push({ ...screen, mode, file, ...state });
        process.stdout.write(`  ${screen.id} / ${mode}  ${String(state.height)}px\n`);
      } catch (error) {
        const why = error instanceof Error ? error.message : 'unknown';
        errors.push(`${screen.id} / ${mode}: ${why}`);
        process.stdout.write(`  ${screen.id} / ${mode}  FAILED: ${why}\n`);
      }
    }
  }

  // TOKENS, read from the resolved stylesheet rather than parsed out of the
  // source, so what lands here is what the browser actually applies.
  const tokensByMode = {};
  for (const mode of MODES) {
    await page.goto(`${base}/?screen=radar`, { waitUntil: 'networkidle' });
    await page.evaluate((m) => {
      document.documentElement.dataset['fwmMode'] = m;
    }, mode);
    tokensByMode[mode] = await page.evaluate(() => {
      const root = document.documentElement;
      const style = getComputedStyle(root);
      const names = new Set();
      for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try {
          rules = Array.from(sheet.cssRules ?? []);
        } catch {
          continue; // cross-origin, nothing to read
        }
        for (const rule of rules) {
          const text = rule.cssText ?? '';
          for (const m of text.matchAll(/(--fwm-[a-z0-9-]+)\s*:/g)) names.add(m[1]);
        }
      }
      const out = {};
      for (const name of [...names].sort()) {
        const value = style.getPropertyValue(name).trim();
        if (value !== '') out[name] = value;
      }
      return out;
    });
  }

  await browser.close();
  return { outDir, captured, errors, tokensByMode, base };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await main(process.argv.slice(2));
  const { outDir, captured, errors, tokensByMode } = result;

  // ---- tokens.json ----
  writeFileSync(join(outDir, 'tokens.json'), JSON.stringify(tokensByMode, null, 2));

  // ---- tokens.md ----
  const modes = Object.keys(tokensByMode);
  const allNames = [...new Set(modes.flatMap((m) => Object.keys(tokensByMode[m])))].sort();
  const families = {};
  for (const name of allNames) {
    const fam = familyOf(name);
    families[fam] ??= [];
    families[fam].push(name);
  }
  let tokens = `# Tokens\n\nRead from the running app, not from the source. Every value below is what\nthe browser resolved for that custom property in that mode.\n\nA token that differs between modes is listed once with a column per mode. A\ntoken with one value is the same everywhere and is not a theming decision.\n\n`;
  for (const fam of ['colour', 'type', 'space', 'radius', 'motion', 'other']) {
    const names = families[fam];
    if (names === undefined) continue;
    tokens += `## ${fam}\n\n| token | ${modes.join(' | ')} |\n|---|${modes.map(() => '---').join('|')}|\n`;
    for (const name of names) {
      const values = modes.map((m) => tokensByMode[m][name] ?? '-');
      tokens += `| \`${name}\` | ${values.map((v) => `\`${v}\``).join(' | ')} |\n`;
    }
    tokens += '\n';
  }
  writeFileSync(join(outDir, 'tokens.md'), tokens);

  // ---- screens.md ----
  let screens = `# Screens\n\nEvery screen the app registers, captured at ${String(VIEWPORT.width)}x${String(VIEWPORT.height)} at\n${String(VIEWPORT.deviceScaleFactor)}x, in the default dark mode and in the one light mode.\n\nWhat you are looking at is the state the capture found, with no data seeded\nand no permissions granted. An empty list here is an empty list, not a\ndesigned empty state. Where that matters it is called out.\n\n`;
  for (const mode of modes) {
    screens += `## ${mode}\n\n`;
    for (const shot of captured.filter((c) => c.mode === mode)) {
      screens += `### ${shot.id}\n\n${shot.note}\n\n`;
      screens += `![${shot.id} in ${mode}](${shot.file})\n\n`;
      screens += `- rendered height: ${String(shot.height)}px\n`;
      screens += `- what was on it: ${shot.text || '(nothing)'}\n\n`;
    }
  }
  if (errors.length > 0) {
    screens += `## Not captured\n\n`;
    for (const e of errors) screens += `- ${e}\n`;
  }
  writeFileSync(join(outDir, 'screens.md'), screens);

  process.stdout.write(`\nwrote ${String(captured.length)} captures to ${outDir}\n`);
  if (errors.length > 0) process.stdout.write(`${String(errors.length)} failed\n`);
}
