/**
 * EVERY v1 PAGE'S TITLE IS THE RELOAD KEY, AND THE TWO OVERLAYS' ARE NOT.
 *
 * =============================================================================
 * WHY THIS IS A SOURCE TEST AND NOT A RENDER TEST
 * =============================================================================
 * The same argument `backAffordance.source.test.ts` makes, one control over.
 * The failure guarded here is a screen that renders perfectly, passes its own
 * suite, and draws a title nothing happens when you press - which is exactly
 * what thirteen of them shipped, because every existing test renders one screen
 * and asks about that screen's own job. Nothing asked the question about the
 * SET.
 *
 * Rendering all of them would mean standing up the stores, the admin identity
 * fetch, the camera archive and the install controller for a check that does
 * not depend on any of it. Reading the source depends on exactly the right
 * thing: whether the component draws the control.
 *
 * The rendered proof - the control exists, has an accessible name, and measures
 * at least 44px in a real browser - is the headless pass, which is a different
 * kind of check and does not replace this one. This is the one that fails when
 * somebody adds screen number fifteen.
 *
 * =============================================================================
 * THE LIST IS DERIVED, NOT TYPED OUT
 * =============================================================================
 * `NON_ROOT_V1_SCREENS` in the back-key test is a hand-written table, and it
 * needs a second table (`ROOT_V1_SCREENS`) plus a dock cross-check to prove it
 * is complete. This reads the screen ids straight out of `registry.v1.tsx`
 * instead, so a fifteenth v1 screen is in the set the moment it is registered
 * and has to be either given a reload title or written into `NO_RELOAD` with a
 * reason. Forgetting is not one of the options.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function srcRoot(): string {
  const found = ['src', 'apps/pwa/src']
    .map((rel) => resolve(process.cwd(), rel))
    .find((path) => existsSync(path));
  expect(found, 'apps/pwa/src not found from the vitest cwd').toBeDefined();
  return found as string;
}

function sourceOf(relative: string): string {
  const path = join(srcRoot(), relative);
  expect(existsSync(path), `${relative} not found`).toBe(true);
  return readFileSync(path, 'utf8');
}

/** Comments describe controls they do not draw; only code is checked. */
function codeOf(relative: string): string {
  return sourceOf(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/**
 * The screen ids `registry.v1.tsx` registers, read out of its source.
 *
 * The registry is not IMPORTED because importing it pulls in the map canvas,
 * the mesh transport and every store behind fifteen screens to answer a
 * question about a list of keys.
 */
function registeredV1Screens(): readonly string[] {
  const code = codeOf('app/registry.v1.tsx');
  const block = /export const V1_SCREENS: ScreenRegistry = \{([\s\S]*?)\n\};/.exec(code);
  expect(block, 'V1_SCREENS is no longer an object literal this can read').not.toBeNull();
  const ids = [...(block?.[1] ?? '').matchAll(/^\s*'?([a-z-]+)'?:\s*[A-Z]/gm)].flatMap(
    (match) => match[1] ?? [],
  );
  // A parser that silently matches nothing would make every assertion below
  // vacuously true, which is the way a check like this dies unnoticed.
  expect(ids.length, 'parsed no screen ids out of V1_SCREENS').toBeGreaterThan(10);
  return ids;
}

/**
 * The component that draws each v1 screen's title.
 *
 * Several are VIEWS rather than screens - SETTINGS, ALERT DIET, ASK, INTEL and
 * REPORT keep v0's container and swap the drawing - so the file that owns the
 * header is not always the one `registry.v1.tsx` names. Written out rather than
 * derived for the same reason the back-key test writes its table out: deriving
 * it means resolving an import graph to answer a question with fifteen answers.
 * The KEYS are checked against the registry below, so the table cannot fall
 * behind it.
 */
const TITLE_FILE: Readonly<Record<string, string>> = {
  radar: 'features/drive/DriveScreen.tsx',
  log: 'features/exposure/ExposureScreen.tsx',
  node: 'features/mesh/MeshScreen.tsx',
  more: 'features/more/MoreScreen.tsx',
  lookup: 'features/lookup/LookupV1Screen.tsx',
  settings: 'features/settings/components/SettingsViewV1.tsx',
  offline: 'features/offline/OfflineV1Screen.tsx',
  docs: 'features/docs/DocsScreen.tsx',
  help: 'features/help/HelpV1Screen.tsx',
  ask: 'features/ask/components/AskViewV1.tsx',
  triage: 'features/triage/components/TriageViewV1.tsx',
  admin: 'features/admin/AdminV1Screen.tsx',
  misuse: 'features/misuse/MisuseScreen.tsx',
  intel: 'features/intel/components/IntelViewV1.tsx',
  report: 'features/report/components/ReportViewV1.tsx',
  onboarding: 'features/onboarding/components/OnboardingViewV1.tsx',
};

/**
 * THE SCREENS WHOSE TITLE MUST NOT RELOAD, each with the thing it would throw
 * away. This is a carve-out list, so every entry is a decision somebody made
 * and can be argued with, not an oversight.
 */
const NO_RELOAD: Readonly<Record<string, string>> = {
  report:
    'the sheet holds an unsent draft and a photograph, none of it persisted until submit',
  onboarding:
    'a first-run takeover, seen once, whose heading is a wordmark rather than a page title',
  intel:
    'the LOADED card is an overlay over the map as often as a screen and cannot tell which; ' +
    'a reload destroys the card rather than refreshing it. Its EMPTY branch does reload.',
};

describe('the reload title', () => {
  it('covers every screen the v1 registry actually has', () => {
    // If a fifteenth screen is registered and nobody adds it here, this is the
    // test that says so - rather than the screen quietly shipping a dead word.
    expect(new Set(registeredV1Screens())).toEqual(new Set(Object.keys(TITLE_FILE)));
  });

  it('is drawn by every v1 page that is not an overlay or a takeover', () => {
    for (const [screen, file] of Object.entries(TITLE_FILE)) {
      if (screen in NO_RELOAD && screen !== 'intel') continue;
      const code = codeOf(file);
      expect(code, `${screen.toUpperCase()} (${file}) draws no ReloadTitle`).toContain(
        '<ReloadTitle',
      );
      expect(
        code,
        `${screen.toUpperCase()} draws a ReloadTitle with no title or no class`,
      ).toMatch(/<ReloadTitle[^>]*\btitle=[^>]*\bclassName=/s);
    }
  });

  it('is NOT drawn where reloading would throw the driver work away', () => {
    for (const [screen, why] of Object.entries(NO_RELOAD)) {
      if (screen === 'intel') continue; // one branch of two; asserted below.
      const file = TITLE_FILE[screen];
      expect(file, `${screen} is carved out but has no file in TITLE_FILE`).toBeDefined();
      expect(
        codeOf(file as string),
        `${screen.toUpperCase()} reloads on its title, and it must not: ${why}`,
      ).not.toContain('<ReloadTitle');
    }
  });

  it('reloads on INTEL empty state and leaves the loaded card alone', () => {
    /*
     * INTEL is the one file with both answers in it, and the branch is the
     * whole point: `?screen=intel` cold has nothing selected and nothing to
     * lose, while the loaded card is the overlay raised from a map dot.
     *
     * One of each, counted, because "contains a ReloadTitle" would pass if
     * somebody gave the loaded card one too.
     */
    const code = codeOf(TITLE_FILE['intel'] as string);
    expect(
      code.match(/<ReloadTitle/g) ?? [],
      'INTEL draws a reload title in the wrong number of branches',
    ).toHaveLength(1);
    expect(code.match(/<h1/g) ?? [], 'INTEL loaded card no longer draws a plain heading')
      .toHaveLength(1);
  });

  it('is the only thing in the app that reloads from a screen', () => {
    // DRIVE had its own `<button>` calling `globalThis.location.reload()` and
    // its own chrome reset in `drive.css`. Two copies of a control is how the
    // third ends up subtly different; this fails if a feature starts a fresh
    // one instead of importing the component.
    for (const file of Object.values(TITLE_FILE)) {
      expect(codeOf(file), `${file} reloads the page itself instead of using ReloadTitle`)
        .not.toMatch(/location\s*\.\s*reload/);
    }
  });

  it('is a 44px target on BOTH axes, described once, in nav.css', () => {
    /*
     * jsdom has no layout engine, so the rendered size is unassertable in this
     * runner and the headless pass is what measures it. What IS checkable here
     * is that the rule the browser will apply is the token one - `--fwm-touch-
     * min` is 44px on a phone and grows to 48 or 68 on the dash and the watch,
     * so a hardcoded 44 would be under the minimum on two of four surfaces.
     *
     * `min-width` is asserted because leaving it out is not a hypothetical: the
     * first cut of this control set only `min-height`, and the headless pass
     * measured ASK at 42x44 at every viewport and text scale. A target sized by
     * its own label is only as wide as the label, and "Ask" is three letters.
     */
    const css = sourceOf('components/nav/nav.css');
    const rule = /\.fwm-reloadtitle\s*\{[^}]*\}/.exec(css);
    expect(rule, 'nav.css no longer describes the reload title').not.toBeNull();
    const declarations = (rule as RegExpExecArray)[0];
    expect(declarations).toContain('min-height: var(--fwm-touch-min)');
    expect(declarations, 'a short title is a target narrower than the minimum').toContain(
      'min-width: var(--fwm-touch-min)',
    );
    // And it must not look like a button: the UA's border and fill are what
    // would draw a box around the screen's name.
    expect(declarations).toContain('border: none');
    expect(declarations).toContain('font: inherit');
  });
});
