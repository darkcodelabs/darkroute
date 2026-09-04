/**
 * EVERY SCREEN THAT IS NOT A ROOT HAS A WAY OFF IT.
 *
 * =============================================================================
 * WHY THIS IS A SOURCE TEST AND NOT A RENDER TEST
 * =============================================================================
 * The failure being guarded is a screen that EXISTS, renders perfectly, passes
 * its own suite, and has nothing on it that goes anywhere. Eight of them
 * shipped that way - SETTINGS, OFFLINE, DOCS, HELP, LOOK UP, ASK, ALERT DIET
 * and ADMIN - because every existing test renders one screen and asks about
 * that screen's own job. Nothing asked the question this file asks, which is a
 * question about the SET.
 *
 * Rendering all of them here would mean standing up the stores, the admin
 * identity fetch, the camera archive and the install controller for a check
 * that does not depend on any of it. Reading the source does depend on exactly
 * the right thing: whether the component draws the control.
 *
 * The rendered proof - the control exists in a real browser, has an accessible
 * name and measures at least 44px - is the headless pass, which is a different
 * kind of check and does not replace this one. This is the one that fails when
 * somebody adds screen number nine.
 *
 * =============================================================================
 * WHAT COUNTS AS A ROOT
 * =============================================================================
 * v1's dock: DRIVE, LOG, MESH, MORE. Standing on a root, the dock is the way
 * out and every key on it goes somewhere else. A back arrow on MORE could only
 * point at MORE, which is a control that does nothing.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DOCK_V1_KEYS } from '../dock/DockV1.tsx';

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
 * The component that actually draws each v1 screen's header.
 *
 * Several are VIEWS rather than screens - SETTINGS, ALERT DIET and ASK keep
 * v0's container and swap the drawing - so the file that owns the header is
 * not always the one `registry.v1.tsx` names. This table is the mapping, and
 * it is written out rather than derived because deriving it would mean
 * resolving an import graph to answer a question with eleven answers.
 */
const NON_ROOT_V1_SCREENS: Readonly<Record<string, string>> = {
  settings: 'features/settings/components/SettingsViewV1.tsx',
  offline: 'features/offline/OfflineV1Screen.tsx',
  docs: 'features/docs/DocsScreen.tsx',
  help: 'features/help/HelpV1Screen.tsx',
  ask: 'features/ask/components/AskViewV1.tsx',
  triage: 'features/triage/components/TriageViewV1.tsx',
  admin: 'features/admin/AdminV1Screen.tsx',
  misuse: 'features/misuse/MisuseScreen.tsx',
};

/** The v1 dock destinations, and the file that draws each. */
const ROOT_V1_SCREENS: Readonly<Record<string, string>> = {
  radar: 'features/drive/DriveScreen.tsx',
  log: 'features/exposure/ExposureScreen.tsx',
  node: 'features/mesh/MeshScreen.tsx',
  more: 'features/more/MoreScreen.tsx',
  /*
   * LOOKUP MOVED FROM THE TABLE ABOVE TO THIS ONE, and the test below that
   * compares this list to `DOCK_V1_KEYS` is what forced it. SEARCH is a dock
   * key now, so LOOK UP is lit by its own key while it is on top and is a root
   * exactly as the other four are -- it drew a back key to MORE, which is no
   * longer its parent.
   */
  lookup: 'features/lookup/LookupV1Screen.tsx',
};

describe('the back affordance', () => {
  it('is drawn by every v1 screen that is not a dock root', () => {
    for (const [screen, file] of Object.entries(NON_ROOT_V1_SCREENS)) {
      const code = codeOf(file);
      expect(code, `${screen.toUpperCase()} (${file}) draws no BackKey`).toContain('<BackKey');
      expect(
        code,
        `${screen.toUpperCase()} draws a BackKey with no destination and no handler`,
      ).toMatch(/<BackKey[^>]*\b(to=|onBack=)/s);
    }
  });

  it('sends all of them to MORE, which is the hub every one of them sits behind', () => {
    for (const [screen, file] of Object.entries(NON_ROOT_V1_SCREENS)) {
      expect(codeOf(file), `${screen.toUpperCase()} points its arrow somewhere other than MORE`)
        .toContain('to="more"');
    }
  });

  it('is drawn by INTEL in BOTH of its states, which is where it was missing', () => {
    /*
     * INTEL is not a MORE child - it is raised from a map dot - so it is not in
     * the table above, and it has two branches. The loaded card returns one
     * way and the "no camera selected" empty state returns EARLY, above the
     * header, so a cold `?screen=intel` deep link landed on a screen with no
     * exit drawn on it at all and no dock key lit either.
     *
     * Two assertions rather than one, because the branch is the bug.
     */
    const code = codeOf('features/intel/components/IntelViewV1.tsx');

    /*
     * THE TWO BRANCHES DRAW DIFFERENT CONTROLS, on purpose, and this assertion
     * originally demanded two BackKeys. It is one BackKey and one OverlayClose:
     *
     * - LOADED CARD -> `OverlayClose`, the round X the report sheet draws. The
     *   card is raised over DRIVE far more often than it is a screen, and a
     *   chevron is a promise about where you came from that a modal cannot
     *   keep. It takes `closeIntelCard`, the only thing that knows whether
     *   there is an overlay to pop.
     * - EMPTY STATE -> `BackKey to="radar"`. There is nothing to close, and
     *   `OverlayClose` renders DISABLED without a handler, which on a cold
     *   `?screen=intel` deep link is a greyed-out X as the only control on
     *   screen. DRIVE is the useful answer to "no camera selected".
     */
    expect(code.match(/<BackKey/g) ?? [], 'INTEL draws a back key in the wrong number of branches')
      .toHaveLength(1);
    expect(code, 'INTEL empty state no longer offers DRIVE').toContain('to="radar"');
    expect(code, 'INTEL loaded card no longer draws the product close key').toContain(
      '<OverlayClose onClose={onDismiss} />',
    );
  });

  it('is NOT drawn by a dock root, because the only parent a root has is itself', () => {
    for (const [screen, file] of Object.entries(ROOT_V1_SCREENS)) {
      expect(
        codeOf(file),
        `${screen.toUpperCase()} is a v1 dock key; a back arrow there points at the screen ` +
          'the driver is already looking at',
      ).not.toContain('<BackKey');
    }
  });

  it('covers every key the v1 dock actually has', () => {
    // If the dock gains or loses a key, the root list above is wrong and the
    // test that skips those screens is skipping the wrong ones.
    expect(new Set(DOCK_V1_KEYS.map((key) => key.screen))).toEqual(
      new Set(Object.keys(ROOT_V1_SCREENS)),
    );
  });

  it('covers every screen the v1 dock says lives behind MORE', () => {
    // `DOCK_V1_KEYS`' `also` list is the design's own statement of what MORE is
    // the parent of. Anything on it that this file does not check is a screen
    // that can go back to having no exit without a test noticing.
    const behindMore = DOCK_V1_KEYS.find((key) => key.screen === 'more')?.also ?? [];
    for (const screen of behindMore) {
      expect(
        Object.keys(NON_ROOT_V1_SCREENS),
        `${screen} is listed behind MORE but has no entry in NON_ROOT_V1_SCREENS`,
      ).toContain(screen);
    }
  });

  it('is the only ROUND back control in the app', () => {
    /*
     * MISUSE and INTEL each had their own `-back` rule, byte-identical, in two
     * feature stylesheets. That is how the third copy ends up subtly different.
     * Both are deleted and `.fwm-backkey` is the one description; this fails if
     * a fourth screen starts a fresh copy instead of importing the component.
     *
     * ROUND is the whole test, and it is not pedantry. `.fwm-radios-back` in
     * MESH is a `‹ ALL` text button that returns from one conversation to the
     * room list - a different control, inside one screen, already carrying a
     * readable name and never claiming to be chrome. Matching every selector
     * ending in `-back` would condemn it, so the offence is specifically the
     * round chrome key: a pill radius on a control named `-back`.
     */
    const ROUND_BACK_RULE = /\.fwm-[a-z0-9-]+-back\s*\{[^}]*--fwm-radius-full[^}]*\}/;
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!entry.endsWith('.css')) continue;
        if (ROUND_BACK_RULE.test(readFileSync(path, 'utf8'))) {
          offenders.push(path.slice(srcRoot().length + 1));
        }
      }
    };
    walk(srcRoot());

    expect(offenders, 'these stylesheets redraw the back key instead of using it').toEqual([]);
  });
});
