/**
 * THE INSTALL INVITE ACTUALLY REACHES THE SCREEN.
 *
 * =============================================================================
 * WHY THIS FILE EXISTS
 * =============================================================================
 * This has broken more than once, silently, in ways every other test was happy
 * with. `installPrompt.test.ts` proves the CONTROLLER's gates in isolation and
 * passes throughout; what it cannot see is the wiring - whether App subscribes,
 * whether the overlay id it opens is registered, whether the component renders
 * anything once it is. Each of those is a separate way for a driver to get no
 * prompt on a device that can install, and none of them fails a unit test.
 *
 * So this asserts the WHOLE CHAIN, end to end: a `beforeinstallprompt` arrives,
 * the launch count clears the first-visit gate, and the invite is on screen
 * with a working Install button. It is deliberately not a mock of the middle.
 *
 * If you are here because it went red: the failure is the point. Do not relax
 * it to match the code - the whole reason it exists is that the code kept
 * changing underneath a promise the product makes.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App, INSTALL_OVERLAY } from './App.tsx';
import { V1_OVERLAYS, V1_SCREENS } from './registry.v1.tsx';
import { INSTALL_BODY } from '../features/install/InstallInvite.tsx';
import {
  createInstallPromptController,
  createMemoryShellStore,
  resetLaunchCount,
} from '../services/pwa/installPrompt.ts';
import type { BeforeInstallPromptEventLike, ShellStore } from '../services/pwa/installPrompt.ts';
import { useSettingsStore } from '../stores/settings.ts';
import { closeOverlay, openScreen } from './screenState.ts';

/** What Chrome hands over. Synthesised because no test environment has it. */
function installEvent(): BeforeInstallPromptEventLike {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  return Object.assign(event, {
    platforms: ['web'] as const,
    prompt: () => Promise.resolve(),
    userChoice: Promise.resolve({ outcome: 'accepted' as const }),
  }) as unknown as BeforeInstallPromptEventLike;
}

let store: ShellStore;
let target: EventTarget;

beforeEach(() => {
  resetLaunchCount();
  // A clean stack: the invite is an overlay, and one left open by a previous
  // test would satisfy the assertions here for the wrong reason.
  while (closeOverlay());
  openScreen('radar');
  store = createMemoryShellStore();
  target = new EventTarget();
  // Past first run, or the gate redirects to onboarding and nothing else runs.
  useSettingsStore.setState({ hydrated: true, onboardingCompletedAtMs: 1_700_000_000_000 });
});

afterEach(() => {
  while (closeOverlay());
});

/** One launch of the real shell, wired to a controller this test can drive. */
async function launch() {
  const controller = createInstallPromptController({
    store,
    target,
    isAlertActive: () => false,
  });
  const view = render(
    <App
      screens={V1_SCREENS}
      overlays={V1_OVERLAYS}
      serviceWorker={null}
      sensors={null}
      installPrompt={controller}
      holdWakeLock={false}
    />,
  );
  // App calls start() itself; wait for the launch to be counted.
  await waitFor(() => {
    expect(controller.status().sessions).toBeGreaterThan(0);
  });
  return { controller, view };
}

describe('the install invite reaches the screen', () => {
  it('does NOT offer on a first visit, even with an event in hand', async () => {
    const { controller, view } = await launch();
    target.dispatchEvent(installEvent());
    await waitFor(() => {
      expect(controller.status().captured).toBe(true);
    });
    expect(screen.queryByRole('heading', { name: /add darkroute/i })).toBeNull();
    expect(controller.status().reason).toBe('first-session');
    view.unmount();
  });

  it('OFFERS on a later launch, and the invite is really on screen', async () => {
    // Launch one: counted, then torn down the way a page load is.
    const first = await launch();
    first.view.unmount();

    resetLaunchCount();
    while (closeOverlay());

    const { controller, view } = await launch();
    target.dispatchEvent(installEvent());

    await waitFor(() => {
      expect(controller.status().canPrompt, `blocked by: ${controller.status().reason}`).toBe(true);
    });

    // THE ASSERTION THAT MATTERS. Everything above can be true while the
    // driver still sees nothing, which is exactly how this broke before.
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /add darkroute/i }),
        'the controller said yes but no invite rendered',
      ).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /^install$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /keep using the website/i })).toBeTruthy();
    expect(screen.getByText(INSTALL_BODY)).toBeTruthy();
    expect(INSTALL_BODY).not.toMatch(/keep firing|screen off/i);
    view.unmount();
  });

  it('registers the overlay id App opens', () => {
    /*
     * App opens `{ id: 'install' }`. If the registry loses that key the overlay
     * opens onto nothing, the sheet is empty, and every other assertion here
     * still passes - which is exactly how v0 shipped with an install prompt
     * that could never appear.
     *
     * This used to check two registries, because v0's lived in `main.tsx` and
     * was read as source. v0 is gone and `main.tsx` no longer registers any
     * overlay of its own, so `V1_OVERLAYS` is the whole answer.
     */
    expect(Object.keys(V1_OVERLAYS), 'lost the install overlay').toContain('install');
    expect(INSTALL_OVERLAY.id, 'App opens an id the registry does not carry').toBe('install');
  });
});
