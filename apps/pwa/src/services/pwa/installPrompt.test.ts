import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MIN_SESSIONS_BEFORE_PROMPT,
  createInstallPromptController,
  SESSIONS_AFTER_DECLINE,
  createMemoryShellStore,
  isStandalone,
  resetLaunchCount,
} from './installPrompt.ts';
import type { BeforeInstallPromptEventLike, ShellStore } from './installPrompt.ts';

/**
 * A cancellable event carrying the two members Chromium adds. Built by hand
 * because `BeforeInstallPromptEvent` exists in no test environment.
 */
function makeInstallEvent(outcome: 'accepted' | 'dismissed'): BeforeInstallPromptEventLike {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  const prompted = { called: 0 };
  return Object.assign(event, {
    platforms: ['web'] as const,
    prompt: () => {
      prompted.called += 1;
      return Promise.resolve();
    },
    userChoice: Promise.resolve({ outcome }),
  }) as unknown as BeforeInstallPromptEventLike;
}

/** A store that survives across "launches" in one test. */
function persistentStore(): ShellStore {
  return createMemoryShellStore();
}

async function launch(
  store: ShellStore,
  options: { alert?: boolean } = {},
): Promise<{
  controller: ReturnType<typeof createInstallPromptController>;
  target: EventTarget;
}> {
  resetLaunchCount();
  const target = new EventTarget();
  const controller = createInstallPromptController({
    store,
    target,
    isAlertActive: () => options.alert === true,
  });
  await controller.start();
  return { controller, target };
}

beforeEach(() => {
  resetLaunchCount();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the second-session gate', () => {
  it('is 2, as section 06 requires', () => {
    expect(MIN_SESSIONS_BEFORE_PROMPT).toBe(2);
  });

  it('refuses to prompt on the first session even with an event in hand', async () => {
    const store = persistentStore();
    const { controller, target } = await launch(store);
    target.dispatchEvent(makeInstallEvent('accepted'));

    expect(controller.status().sessions).toBe(1);
    expect(controller.status().captured).toBe(true);
    expect(controller.canPrompt()).toBe(false);
    expect(controller.status().reason).toBe('first-session');
    await expect(controller.prompt()).resolves.toBe('blocked');
  });

  it('allows the prompt on the second session', async () => {
    const store = persistentStore();
    await launch(store);

    const second = await launch(store);
    second.target.dispatchEvent(makeInstallEvent('accepted'));

    expect(second.controller.status().sessions).toBe(2);
    expect(second.controller.canPrompt()).toBe(true);
    await expect(second.controller.prompt()).resolves.toBe('accepted');
  });

  it('counts one launch even when the effect mounts twice, as StrictMode does', async () => {
    const store = persistentStore();
    const target = new EventTarget();
    resetLaunchCount();

    const first = createInstallPromptController({ store, target, isAlertActive: () => false });
    await first.start();
    first.stop();

    const second = createInstallPromptController({ store, target, isAlertActive: () => false });
    await second.start();

    expect(second.status().sessions).toBe(1);
  });
});

describe('the alert gate', () => {
  it('never prompts while a camera alert is live', async () => {
    const store = persistentStore();
    await launch(store);
    const { controller, target } = await launch(store, { alert: true });
    target.dispatchEvent(makeInstallEvent('accepted'));

    expect(controller.status().sessions).toBe(2);
    expect(controller.status().reason).toBe('alert-active');
    expect(controller.canPrompt()).toBe(false);
    await expect(controller.prompt()).resolves.toBe('blocked');
  });

  it('is evaluated at prompt time, not at capture time', async () => {
    const store = persistentStore();
    await launch(store);

    let alerting = false;
    resetLaunchCount();
    const target = new EventTarget();
    const controller = createInstallPromptController({
      store,
      target,
      isAlertActive: () => alerting,
    });
    await controller.start();
    target.dispatchEvent(makeInstallEvent('accepted'));
    expect(controller.canPrompt()).toBe(true);

    // A camera comes into range after the banner became eligible.
    alerting = true;
    expect(controller.canPrompt()).toBe(false);
    await expect(controller.prompt()).resolves.toBe('blocked');
  });
});

describe('capture', () => {
  it('calls preventDefault so the browser does not show its own infobar', async () => {
    const store = persistentStore();
    const { target } = await launch(store);
    const event = makeInstallEvent('accepted');
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores an event that is not a beforeinstallprompt event', async () => {
    const store = persistentStore();
    const { controller, target } = await launch(store);
    target.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true }));
    expect(controller.status().captured).toBe(false);
    expect(controller.status().reason).toBe('no-event');
  });

  it('nothing is prompted by start(): it only counts and captures', async () => {
    const store = persistentStore();
    await launch(store);
    const target = new EventTarget();
    resetLaunchCount();
    const event = makeInstallEvent('accepted');
    const prompt = vi.spyOn(event, 'prompt');
    const controller = createInstallPromptController({ store, target, isAlertActive: () => false });
    await controller.start();
    target.dispatchEvent(event);
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe('dismissal', () => {
  it('holds the offer for a COOLDOWN after the BROWSER dialog is declined', async () => {
    /*
     * THIS ASSERTION USED TO SAY `already-dismissed`, AND THAT WAS THE BUG.
     *
     * Backing out of Chrome's own install sheet wrote the same permanent key as
     * the app's own "keep using the website" button, so one back gesture
     * retired the install offer forever on a device where the app was not
     * installed - with nothing on any screen saying why. Somebody who gets that
     * far tapped INSTALL; they want it. A decline there is "not now".
     */
    const store = persistentStore();
    await launch(store);
    const second = await launch(store);
    second.target.dispatchEvent(makeInstallEvent('dismissed'));

    await expect(second.controller.prompt()).resolves.toBe('dismissed');
    expect(second.controller.status().reason).toBe('recently-declined');
    expect(
      second.controller.status().dismissed,
      'a browser decline must not read as the permanent refusal',
    ).toBe(false);

    const third = await launch(store);
    third.target.dispatchEvent(makeInstallEvent('accepted'));
    expect(third.controller.canPrompt(), 'still cooling down').toBe(false);
    expect(third.controller.status().reason).toBe('recently-declined');
  });

  it('gives the offer back once the cooldown is served', async () => {
    const store = persistentStore();
    await launch(store);
    const declined = await launch(store);
    declined.target.dispatchEvent(makeInstallEvent('dismissed'));
    await declined.controller.prompt();

    // A LAUNCH IS A PAGE LOAD, and `start()` on one controller counts once by
    // design - that guard is what stops a re-render inflating the count. So the
    // cooldown has to be walked with real launches, which is what `launch`
    // simulates: it resets the per-load guard and builds a fresh controller.
    let later = await launch(store);
    for (let i = 0; i < SESSIONS_AFTER_DECLINE; i += 1) {
      later = await launch(store);
    }
    later.target.dispatchEvent(makeInstallEvent('accepted'));
    expect(later.controller.status().reason).not.toBe('recently-declined');
    expect(later.controller.canPrompt(), 'the offer is back').toBe(true);
  });

  it('keeps the app\u2019s OWN refusal permanent, because its copy promises that', async () => {
    const store = persistentStore();
    await launch(store);
    const { controller, target } = await launch(store);
    target.dispatchEvent(makeInstallEvent('accepted'));
    await controller.dismiss();

    const later = await launch(store);
    later.target.dispatchEvent(makeInstallEvent('accepted'));
    expect(later.controller.status().reason, 'never means never').toBe('already-dismissed');
  });

  it('can be undone, so a permanent refusal is not a one-way door', async () => {
    const store = persistentStore();
    await launch(store);
    const { controller, target } = await launch(store);
    target.dispatchEvent(makeInstallEvent('accepted'));
    await controller.dismiss();
    expect(controller.status().reason).toBe('already-dismissed');

    await controller.allowAgain();
    expect(controller.status().dismissed).toBe(false);
    expect(controller.status().reason).not.toBe('already-dismissed');
  });

  it('dismiss() records the refusal without showing anything', async () => {
    const store = persistentStore();
    await launch(store);
    const { controller, target } = await launch(store);
    target.dispatchEvent(makeInstallEvent('accepted'));

    await controller.dismiss();
    expect(controller.status().dismissed).toBe(true);
    await expect(controller.prompt()).resolves.toBe('unavailable');
  });
});

describe('already installed', () => {
  it('does not offer to install an app that is already installed', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));

    const store = persistentStore();
    await launch(store);
    const { controller } = await launch(store);
    expect(controller.status().installed).toBe(true);
    expect(controller.status().reason).toBe('already-installed');
  });
});

describe('the event is single-use', () => {
  it('is dropped after prompting, whatever the answer', async () => {
    const store = persistentStore();
    await launch(store);
    const { controller, target } = await launch(store);
    target.dispatchEvent(makeInstallEvent('accepted'));

    await expect(controller.prompt()).resolves.toBe('accepted');
    expect(controller.status().captured).toBe(false);
    await expect(controller.prompt()).resolves.toBe('unavailable');
  });
});

describe('isStandalone knows every display mode an install can run in', () => {
  /*
   * THE BUG THIS PINS.
   *
   * The manifest asks for `display: fullscreen`, so an installed copy reports
   * its display mode as `fullscreen`, not `standalone`. This function tested
   * `standalone` alone and therefore answered "not installed" inside the
   * installed app - and `already-installed` is the FIRST gate in
   * `blockReason`, so every gate below it was being decided on a false
   * premise and the app was willing to offer an install to somebody already
   * standing inside one.
   */
  const original = globalThis.matchMedia;

  function withDisplayMode(mode: string | null, fullscreenElement: Element | null = null) {
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: mode !== null && query.includes(`display-mode: ${mode}`),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: fullscreenElement,
    });
  }

  afterEach(() => {
    Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: original });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });

  it('counts fullscreen as installed, which is what the manifest now asks for', () => {
    withDisplayMode('fullscreen');
    expect(isStandalone()).toBe(true);
  });

  it('still counts standalone, and counts minimal-ui', () => {
    withDisplayMode('standalone');
    expect(isStandalone()).toBe(true);
    withDisplayMode('minimal-ui');
    expect(isStandalone()).toBe(true);
  });

  it('does not count a browser tab', () => {
    withDisplayMode('browser');
    expect(isStandalone()).toBe(false);
    withDisplayMode(null);
    expect(isStandalone()).toBe(false);
  });

  it('does not count a TAB we put into element fullscreen ourselves', () => {
    // `armImmersive` fullscreens a browser tab on the first touch, and a tab in
    // element fullscreen matches `(display-mode: fullscreen)` too. Without the
    // `fullscreenElement` check that tab would claim to be an installed app and
    // silently switch off the install offer for everybody browsing the site.
    withDisplayMode('fullscreen', document.documentElement);
    expect(isStandalone()).toBe(false);
  });
});
