/**
 * NOTHING ON DRIVE MAY LEAVE FULLSCREEN.
 *
 * =============================================================================
 * THE BUG THIS EXISTS FOR
 * =============================================================================
 * Fullscreen used to belong to focus mode: the button asked for it going in and
 * gave it back coming out, which was symmetric and correct while focus was the
 * only thing that ever asked.
 *
 * Then fullscreen became the app's DEFAULT - `services/pwa/immersive.ts` asks
 * on the first touch of the session, once, and deliberately never re-arms. The
 * old `exitFullscreen` in the focus toggle was suddenly a trapdoor: open the
 * app (fullscreen), tap focus, tap it again, and the whole app fell out of
 * fullscreen permanently. Nothing asked a second time, so the only way back was
 * a reload.
 *
 * It was reported as "what's up with full screen mode not being on", with focus
 * mode as the one place it still worked - which is the exact signature of this
 * bug, because focus mode is the only code left that asks.
 *
 * =============================================================================
 * WHY A SOURCE TEST
 * =============================================================================
 * jsdom has no Fullscreen API and no display modes, so a render test can only
 * assert against a mock - which is what a mock would have said before the fix
 * too. The mistake is one line and it is visible in the text. Same reasoning as
 * `mesh.privacy.test.ts`: the class of mistake is one that ships.
 *
 * The rule is asymmetric ON PURPOSE. Entering is fine and is what the focus
 * button is now for - it is the manual way back if the platform dropped it. The
 * ways OUT are the platform's own, Escape and the system drag gesture, and
 * those are the user's decision and must stay final.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/** cwd is `apps/pwa` under `pnpm test:unit` and the repo root under `--root`. */
function read(rel: string): string {
  const found = [rel, `apps/pwa/${rel}`]
    .map((candidate) => resolve(process.cwd(), candidate))
    .find((path) => {
      try {
        readFileSync(path, 'utf8');
        return true;
      } catch {
        return false;
      }
    });
  expect(found, `could not locate ${rel}`).toBeDefined();
  return readFileSync(found as string, 'utf8');
}

describe('the DRIVE fullscreen key', () => {
  it('reads the screen it is supposed to be guarding', () => {
    // A path mistake would make every assertion below vacuous.
    const source = read('src/features/drive/DriveScreen.tsx');
    expect(source).toContain('toggleFull');
    expect(source).toContain('requestFullscreen');
  });

  it('routes its exit through the shared module, never a raw call', () => {
    // DRIVE owns the FULLSCREEN KEY now, so it is allowed to leave - that key
    // is a toggle and a toggle that cannot untoggle is not a control. What it
    // may NOT do is call the DOM directly: `exitImmersive` is where the
    // suppression flag lives that stops an in-flight arm request from
    // immediately undoing the exit.
    const source = read('src/features/drive/DriveScreen.tsx');
    expect(source).not.toContain('exitFullscreen');
    expect(source).toContain('exitImmersive');
  });

  it('holds the only place that may ask for fullscreen automatically', () => {
    // `armImmersive` is the app-wide default and asks exactly once. If a second
    // module starts arming, two of them race on one gesture and the "never
    // re-arm" rule stops meaning anything.
    const app = read('src/app/App.tsx');
    expect(app).toContain('armImmersive');
  });

  it('has EXACTLY ONE way out, and it is a deliberate preference', () => {
    /*
     * THIS ASSERTION USED TO REQUIRE ZERO EXITS, and the tightening is
     * deliberate rather than a relaxation.
     *
     * "No code path may synthesise a way out" was right while fullscreen was
     * something the app took and only the platform could give back. There is
     * now a "Full screen" preference, and a switch somebody turns OFF has to
     * actually turn it off - a toggle that cannot untoggle is not a setting.
     *
     * So the rule becomes a count, which is the thing actually worth guarding:
     * one exit, in `exitImmersive`, and no other. A second `exitFullscreen`
     * appearing anywhere in this module is the regression this catches.
     */
    const immersive = read('src/services/pwa/immersive.ts');
    // CALL SITES, not mentions: the module explains itself in prose and a bare
    // `exitFullscreen` count reads the comments as code.
    const exits = immersive.match(/\.exitFullscreen\?\.\(|\.exitFullscreen\(/g) ?? [];
    expect(exits, 'immersive.ts must hold exactly one exit').toHaveLength(1);
    expect(immersive).toContain('export function enterImmersive');
    expect(immersive).toContain('export function exitImmersive');
  });

  it('keeps the exit to the one key that owns it', () => {
    // A settings switch was tried for this and did not work on a real device
    // while the DRIVE key always did, so the switch was removed rather than
    // left as a second control doing the same job worse. Nothing else in the
    // app may exit: an exit anywhere else is the app overriding a driver.
    expect(read('src/app/App.tsx'), 'App must not exit fullscreen').not.toContain('exitImmersive');
    expect(
      read('src/features/settings/SettingsScreen.tsx'),
      'the settings switch was removed; it must not come back by accident',
    ).not.toContain('exitImmersive');
  });
});
