/**
 * The fullscreen arm, and the distinction the first version got wrong.
 *
 * The bug worth a test is not "does it call requestFullscreen" - it is what
 * happens when the call is REFUSED. The original burned its one shot before
 * asking and swallowed the rejection, so a single refusal killed immersive mode
 * for the whole session with nothing anywhere reporting it. A refusal is the
 * browser declining to act; an EXIT is a person deciding. Only the second is
 * final, and these tests pin that difference.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { armImmersive, enterImmersive, exitImmersive, resetImmersiveForTests } from './immersive.ts';

const root = document.documentElement as HTMLElement & {
  requestFullscreen: (options?: FullscreenOptions) => Promise<void>;
};

let request: ReturnType<typeof vi.fn>;

/**
 * Every teardown handed out during a test, called in afterEach.
 *
 * A test that does not await the request leaves `entered` false and its capture
 * listeners still on `document`, and the next test's dispatch then reaches them
 * - which reads as the teardown having failed when it never ran.
 */
let teardowns: (() => void)[] = [];

function arm(): () => void {
  const off = armImmersive();
  teardowns.push(off);
  return off;
}

let exitSpy: ReturnType<typeof vi.fn>;

/** Point `requestFullscreen` at a promise this test controls. */
function respondWith(make: () => Promise<void>) {
  request = vi.fn(make);
  Object.defineProperty(root, 'requestFullscreen', { value: request, configurable: true });
}

beforeEach(() => {
  resetImmersiveForTests();
  respondWith(() => Promise.resolve());
  exitSpy = vi.fn(() => Promise.resolve());
  Object.defineProperty(document, 'exitFullscreen', { value: exitSpy, configurable: true });
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ matches: false, media: query }),
    configurable: true,
  });
});

afterEach(() => {
  for (const off of teardowns) off();
  teardowns = [];
  resetImmersiveForTests();
  vi.restoreAllMocks();
});

/**
 * One tap, as a browser fires it.
 *
 * `pointerdown` and `pointerup` are included because a real tap DOES fire them
 * and the arm must ignore them - entering fullscreen between those two events
 * moves the layout and the browser then generates no `click` at all, which
 * silently eats the tap. See `GESTURES`.
 */
function tap() {
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'click']) {
    document.dispatchEvent(new Event(type, { bubbles: true }));
  }
}

describe('armImmersive', () => {
  it('asks on the first gesture, not on load', () => {
    arm();
    expect(request).not.toHaveBeenCalled();

    document.dispatchEvent(new Event('click', { bubbles: true }));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('IGNORES pointerdown and pointerup, because they eat the tap', () => {
    /*
     * Entering fullscreen resizes the viewport. A browser decides a click from
     * where pointerdown and pointerup BOTH landed, so moving the layout between
     * them means the finger comes up off the button, no click is generated, and
     * the control silently does nothing. Reported as "half those side rail
     * buttons don't work".
     */
    arm();
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(request, 'the press half of a tap must not trigger a resize').not.toHaveBeenCalled();

    document.dispatchEvent(new Event('click', { bubbles: true }));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('makes ONE request per tap, not one per event in the tap', async () => {
    // A single tap fires pointerdown, pointerup and click. Three stacked
    // requests would be three permission decisions for one intent.
    arm();
    tap();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('stops for good once fullscreen is actually entered', async () => {
    arm();
    document.dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    document.dispatchEvent(new Event('click', { bubbles: true }));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('TRIES AGAIN on the next gesture when the browser refuses', async () => {
    /*
     * THE REGRESSION THIS EXISTS FOR.
     *
     * The old version set its flag and removed its listeners synchronously,
     * before the request, and swallowed the rejection - so one refusal was
     * permanent. Which events carry activation varies by engine, input type and
     * version, so a first refusal is entirely ordinary and must not be the end.
     */
    respondWith(() => Promise.reject(new Error('Permissions check failed')));
    arm();

    document.dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event('touchend', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the app is already fullscreen', () => {
    Object.defineProperty(document, 'fullscreenElement', { value: root, configurable: true });
    arm();
    document.dispatchEvent(new Event('click', { bubbles: true }));
    expect(request).not.toHaveBeenCalled();
  });

  it('does nothing in an installed copy, which launches immersive already', () => {
    Object.defineProperty(window, 'matchMedia', {
      value: (query: string) => ({ matches: query.includes('fullscreen'), media: query }),
      configurable: true,
    });
    arm();
    document.dispatchEvent(new Event('click', { bubbles: true }));
    expect(request).not.toHaveBeenCalled();
  });

  it('gives up quietly on a platform with no Fullscreen API at all', () => {
    // iOS Safari does not expose `requestFullscreen` on an element. Retrying
    // that on every gesture for the rest of the session would be pure waste.
    Object.defineProperty(root, 'requestFullscreen', { value: undefined, configurable: true });
    arm();
    expect(() => {
      tap();
    }).not.toThrow();
  });

  it('removes its listeners when torn down', () => {
    const off = arm();
    off();
    document.dispatchEvent(new Event('click', { bubbles: true }));
    expect(request).not.toHaveBeenCalled();
  });

  it('listens for every gesture that can carry activation', () => {
    // Not a bet on which one works: whether a touch pointerdown carries
    // activation is engine- and version-specific, so all of them are armed and
    // a refusal simply moves on to the next.
    for (const type of ['touchend', 'click', 'keydown']) {
      resetImmersiveForTests();
      respondWith(() => Promise.resolve());
      const off = arm();
      document.dispatchEvent(new Event(type, { bubbles: true }));
      expect(request, `${type} did not arm`).toHaveBeenCalledTimes(1);
      off();
    }
  });
});

describe('the preference switch and the arm race on the same click', () => {
  /*
   * THE BUG THIS EXISTS FOR, measured in a real browser before it was fixed.
   *
   * `armImmersive` listens on the DOCUMENT in the capture phase, so the very
   * click that turns the "Full screen" preference OFF reaches the arm first and
   * asks for fullscreen. The switch's own handler then runs and exits - but
   * there is nothing to exit yet, because the request is still pending. It
   * resolves a moment later and the app goes fullscreen.
   *
   * Turning the setting off turned it on. Tearing the listener down from App's
   * effect cannot fix it: that is a render later, after the request is airborne.
   */
  it('does not enter when the exit landed while the request was in flight', async () => {
    // NOT `(() => void) | null`. TypeScript's control-flow analysis cannot see
    // the assignment inside a promise executor, so it narrows the call site to
    // `null` and refuses it. A no-op default keeps the type a function.
    let settle: () => void = () => undefined;
    // MIRROR THE BROWSER: a resolved request sets `fullscreenElement`. Without
    // that, `exitImmersive` short-circuits on "nothing to exit" and the test
    // passes for the wrong reason.
    respondWith(
      () =>
        new Promise<void>((resolve) => {
          settle = () => {
            Object.defineProperty(document, 'fullscreenElement', {
              value: root,
              configurable: true,
            });
            resolve();
          };
        }),
    );
    arm();

    // The arm sees the click first and asks.
    document.dispatchEvent(new Event('click', { bubbles: true }));
    expect(request).toHaveBeenCalledTimes(1);

    // The switch handler runs next, on the same click, and turns it off.
    exitImmersive();

    // Only now does the browser answer the arm's request.
    settle();
    await Promise.resolve();
    await Promise.resolve();

    expect(exitSpy, 'a suppressed request must give the screen back').toHaveBeenCalled();
  });

  it('lets the switch turn it back on afterwards', () => {
    respondWith(() => Promise.resolve());
    exitImmersive();
    enterImmersive();
    expect(request, 'ON must clear the suppression OFF set').toHaveBeenCalledTimes(1);
  });
});
