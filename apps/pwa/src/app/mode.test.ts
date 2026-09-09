import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ALWAYS_ON_MODE,
  DEFAULT_MODE,
  FWM_MODES,
  applyMode,
  currentMode,
  isFwmMode,
  isWatchSurface,
  reconcileMode,
  requestedMode,
  resolveMode,
} from './mode.ts';

afterEach(() => {
  delete document.documentElement.dataset['fwmMode'];
  delete document.documentElement.dataset['fwmSurface'];
  applyMode(DEFAULT_MODE, 'phone');
  delete document.documentElement.dataset['fwmMode'];
});

describe('the mode list', () => {
  it('is exactly the skins the design system renders, in its order', () => {
    // Six until "DarkRoute Design System 80sv3" added Aurora and Refinement.
    // The list is pinned rather than counted so a mode cannot be added to the
    // code without being added to the design - which is the direction the
    // dependency has to run.
    expect([...FWM_MODES]).toEqual([
      'night-watch',
      'neon-grid',
      'cartridge-96',
      'pursuit',
      'cluster',
      'dash-cast',
      'aurora',
      'refinement',
      // Not from a design file. Asked for directly, and the only mode with a
      // hardware reason rather than a stylistic one.
      'e-ink',
      // v1's own four. v1 is a complete design with its own seven themes, and
      // four of them had no id here - so a v1 build could offer three of its
      // themes and six of v0's, which is two designs on one screen. Their
      // palettes are declared ONLY under `[data-fwm-design="v1"]`; see
      // `V1_MODES` for which picker offers what.
      'slate',
      'carbon',
      'violet',
      'paper',
      // FOUR MORE, and like `e-ink` these came from a direct request rather
      // than from a design file. Said plainly because this list's whole job is
      // to make the code/design dependency run one way: a mode with no card
      // behind it should be visible as such, not blended in with the ones that
      // have one. `sodium` is the second mode in the set with a hardware
      // argument - amber costs a dark-adapted eye far less than short
      // wavelengths - and its block in `tokens.css` carries the reasoning.
      'ember',
      'tide',
      'moss',
      'sodium',
    ]);
  });

  it('keeps every mode declared in the token file', () => {
    // A mode in the union with no `[data-fwm-mode]` block renders as
    // night-watch while SETTINGS shows it selected - the picker would be
    // lying.
    //
    // This asserted `FWM_MODES.length === 8`, which is not that check: a count
    // passes for a mode that was added to the union and never given a block,
    // as long as somebody also updated the number. Read the stylesheet and ask
    // the real question, so the guard maintains itself.
    // Off the working directory rather than `import.meta.url`: under jsdom the
    // module URL is an http: one and `readFileSync` refuses it. Both candidates
    // are tried because cwd is `apps/pwa` under `pnpm test:unit` and the repo
    // root when vitest is pointed at it with `--root`.
    const candidates = ['src/styles/tokens.css', 'apps/pwa/src/styles/tokens.css'];
    const found = candidates
      .map((rel) => resolve(process.cwd(), rel))
      .find((path) => existsSync(path));
    expect(found).toBeDefined();
    const tokens = readFileSync(found as string, 'utf8');
    // The DEFAULT has no block and must not: night-watch IS `:root`, and
    // writing `[data-fwm-mode="night-watch"]` would be a second copy of the
    // base palette that could drift from it. Every OTHER mode is an override
    // and therefore has to exist as one.
    // A mode counts as declared if EITHER design gives it a palette. v1's four
    // are declared only under `[data-fwm-design="v1"]` on purpose: they are not
    // v0 themes, v0's picker does not list them, and adding a v0 block for a
    // theme v0 never offers would be a palette nothing renders.
    const missing = FWM_MODES.filter(
      (mode) =>
        mode !== DEFAULT_MODE &&
        !tokens.includes(`[data-fwm-mode="${mode}"]`) &&
        !tokens.includes(`[data-fwm-design="v1"][data-fwm-mode="${mode}"]`),
    );
    expect(missing).toEqual([]);
  });

  it('keeps the first-launch look and the watch rule as two separate decisions', () => {
    // Two different questions that happen to share a value again. One is
    // taste, the other is a power budget.
    //
    // WHAT THIS ASSERTED BEFORE, twice: `'slate'`, then `'neon-grid'`. The
    // default has now moved three times in two days, which is the point - it
    // is taste and it is allowed to move, so pinning the VALUE just makes this
    // test something to update rather than something that catches anything.
    //
    // What is worth pinning is the SEPARATION: `ALWAYS_ON_MODE` has a hardware
    // constraint behind it and must not follow the look around. They are equal
    // strings today and that is a coincidence, so the test reads them from
    // their own constants and asserts what each one governs instead.
    expect(ALWAYS_ON_MODE).toBe('night-watch');
    expect(FWM_MODES).toContain(DEFAULT_MODE);
    // The watch is forced regardless of what the default happens to be.
    expect(resolveMode(DEFAULT_MODE, 'watch-round').mode).toBe(ALWAYS_ON_MODE);
    expect(resolveMode(DEFAULT_MODE, 'phone').mode).toBe(DEFAULT_MODE);
  });

  it('accepts only the declared modes', () => {
    for (const mode of FWM_MODES) expect(isFwmMode(mode)).toBe(true);
    expect(isFwmMode('midnight')).toBe(false);
    expect(isFwmMode(null)).toBe(false);
  });
});

describe('applyMode', () => {
  it('writes data-fwm-mode and touches nothing else', () => {
    const classBefore = document.documentElement.className;
    const result = applyMode('pursuit', 'phone');

    expect(result.mode).toBe('pursuit');
    expect(result.reason).toBe('requested');
    expect(document.documentElement.getAttribute('data-fwm-mode')).toBe('pursuit');
    // A mode may never change layout, hit targets or hierarchy. From
    // TypeScript the only lever is this one attribute -- prove nothing else
    // moved.
    expect(document.documentElement.className).toBe(classBefore);
    expect(document.documentElement.getAttribute('style')).toBeNull();
    expect(document.documentElement.getAttribute('data-fwm-surface')).toBeNull();
  });

  it('writes the attribute for night-watch too, even though it has no override block', () => {
    applyMode('night-watch', 'phone');
    expect(document.documentElement.getAttribute('data-fwm-mode')).toBe('night-watch');
    expect(currentMode()).toBe('night-watch');
  });

  it('falls back to the default for an unknown mode and says so', () => {
    const result = applyMode('vaporwave', 'phone');
    expect(result.mode).toBe(DEFAULT_MODE);
    expect(result.reason).toBe('unknown-mode');
    expect(result.requested).toBe('vaporwave');
    expect(document.documentElement.getAttribute('data-fwm-mode')).toBe(DEFAULT_MODE);
  });

  it('still forces night watch onto an always-on face, whatever the default is', () => {
    // The reason DEFAULT_MODE and ALWAYS_ON_MODE had to stop being one constant:
    // a watch face burns pixels for hours and slate is not the low-power block.
    const result = applyMode('slate', 'watch-round');
    expect(result.mode).toBe(ALWAYS_ON_MODE);
    expect(result.reason).toBe('forced-watch');
  });
});

describe('the always-on watch rule', () => {
  it('forces night-watch on watch-round', () => {
    const result = applyMode('neon-grid', 'watch-round');
    expect(result.mode).toBe('night-watch');
    expect(result.reason).toBe('forced-watch');
    expect(document.documentElement.getAttribute('data-fwm-mode')).toBe('night-watch');
  });

  it('forces night-watch on watch-square', () => {
    expect(applyMode('cluster', 'watch-square').mode).toBe('night-watch');
  });

  it('does not report a forced change when night-watch was what was asked for', () => {
    const result = applyMode('night-watch', 'watch-round');
    expect(result.mode).toBe('night-watch');
    expect(result.reason).toBe('requested');
  });

  it('leaves phone and dash free to pick any mode', () => {
    expect(applyMode('dash-cast', 'dash').mode).toBe('dash-cast');
    expect(applyMode('cartridge-96', 'phone').mode).toBe('cartridge-96');
  });

  it('identifies the two watch surfaces and nothing else', () => {
    expect(isWatchSurface('watch-round')).toBe(true);
    expect(isWatchSurface('watch-square')).toBe(true);
    expect(isWatchSurface('phone')).toBe(false);
    expect(isWatchSurface('dash')).toBe(false);
    expect(isWatchSurface(null)).toBe(false);
  });

  it('reads the surface off the document when none is passed', () => {
    document.documentElement.dataset['fwmSurface'] = 'watch-round';
    expect(resolveMode('pursuit').mode).toBe('night-watch');
  });
});

describe('reconcileMode', () => {
  it('restores the requested mode when a device stops being a watch', () => {
    applyMode('pursuit', 'watch-round');
    expect(currentMode()).toBe('night-watch');
    expect(requestedMode()).toBe('pursuit');

    // A foldable that unfolds, or a surface re-detect after install.
    const result = reconcileMode('phone');
    expect(result.mode).toBe('pursuit');
    expect(currentMode()).toBe('pursuit');
  });

  it('drops back to night-watch the moment the surface becomes a watch', () => {
    applyMode('neon-grid', 'phone');
    expect(currentMode()).toBe('neon-grid');

    expect(reconcileMode('watch-square').mode).toBe('night-watch');
    expect(currentMode()).toBe('night-watch');
  });
});
