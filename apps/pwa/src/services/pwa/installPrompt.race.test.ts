/**
 * THE REFUSAL HAS TO BE READ BEFORE ANYTHING IS OFFERED.
 *
 * Reported as: press KEEP USING THE WEBSITE, refresh, and the card is back -
 * every time, on a copy that had already been told no.
 *
 * `start()` counts the launch and awaits a write BEFORE it reads the stored
 * dismissal, so there is a window where `sessions` is already past the gate and
 * `dismissed` is still false. `beforeinstallprompt` fires on the browser's
 * schedule, and when it landed inside that window the controller published
 * `canPrompt: true`, the shell opened the sheet, and the refusal arrived a tick
 * later with nothing left to stop.
 *
 * It also explains the odd copy in the report: by the time the card rendered,
 * the real status had resolved to blocked, so the card fell through to its
 * "add it from your browser menu" branch. A phone whose browser HAD offered an
 * install was being told its browser could not.
 *
 * These tests drive the event DURING `start()`, which is the only way to catch
 * it - awaiting `start()` first is exactly the ordering the bug needs to avoid.
 */

import { describe, expect, it } from 'vitest';

import {
  createInstallPromptController,
  createMemoryShellStore,
  resetLaunchCount,
} from './installPrompt.ts';
import type { ShellStore } from './installPrompt.ts';

/** A store that answers slowly, so the window the bug lived in is reachable. */
function slowStore(inner: ShellStore): ShellStore {
  return {
    read: async (key) => {
      await Promise.resolve();
      await Promise.resolve();
      return inner.read(key);
    },
    write: (key, value) => inner.write(key, value),
    clear: () => inner.clear(),
  };
}

function fireInstallEvent(target: EventTarget): void {
  const event = new Event('beforeinstallprompt') as Event & {
    prompt?: () => Promise<void>;
    userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };
  event.prompt = () => Promise.resolve();
  event.userChoice = Promise.resolve({ outcome: 'accepted' as const });
  target.dispatchEvent(event);
}

describe('a refusal that has already been given', () => {
  it('is never overridden by an install event that arrives mid-start', async () => {
    const store = createMemoryShellStore();
    // Two launches and a refusal, the way a real phone would have it.
    resetLaunchCount();
    const first = createInstallPromptController({
      store,
      target: new EventTarget(),
      isAlertActive: () => false,
    });
    await first.start();
    resetLaunchCount();
    const second = createInstallPromptController({
      store,
      target: new EventTarget(),
      isAlertActive: () => false,
    });
    await second.start();
    await second.dismiss();

    // NOW the launch that used to nag. The event fires while start() is still
    // reading, which is the whole point - it is not awaited first.
    resetLaunchCount();
    const target = new EventTarget();
    const seen: boolean[] = [];
    const controller = createInstallPromptController({
      store: slowStore(store),
      target,
      isAlertActive: () => false,
    });
    controller.subscribe((status) => {
      seen.push(status.canPrompt);
    });

    const starting = controller.start();
    fireInstallEvent(target);
    await starting;

    expect(
      seen.some((canPrompt) => canPrompt),
      'the sheet was offered to somebody who had already refused it',
    ).toBe(false);
    expect(controller.status().reason).toBe('already-dismissed');
  });

  it('offers nothing at all before the stored answer has been read', async () => {
    // The general rule the fix rests on: an unread refusal is not the same as
    // no refusal. Even on a first-ever launch, nothing may be published as
    // promptable until start() has finished loading.
    const store = createMemoryShellStore();
    resetLaunchCount();
    const target = new EventTarget();
    const controller = createInstallPromptController({
      store: slowStore(store),
      target,
      isAlertActive: () => false,
    });

    const starting = controller.start();
    fireInstallEvent(target);
    expect(controller.status().canPrompt).toBe(false);
    await starting;
  });
});
