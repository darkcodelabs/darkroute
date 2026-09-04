import { afterEach, describe, expect, it } from 'vitest';

// The real generated artifact, read through Vite's `?raw` loader so the test
// needs no filesystem access and no @types/node. This is the cross-check
// between scripts/generate-assets.mjs and this module: if the generator ever
// emits a shortcut this adapter cannot resolve, this file fails.
import manifestRaw from '../../public/manifest.webmanifest?raw';

import {
  DEFAULT_SCREEN,
  DOCK_SCREENS,
  SCREEN_IDS,
  SCREEN_PARAM,
  SECONDARY_SCREENS,
  closeOverlay,
  disposeScreenState,
  getScreenState,
  goBack,
  initScreenState,
  interruptForAlert,
  isAlertActive,
  isScreenId,
  openOverlay,
  openScreen,
  presentation,
  restoreAfterAlert,
  screenFromSearch,
  searchForScreen,
  subscribe,
  topOverlay,
} from './screenState.ts';
import type { HistoryPort } from './screenState.ts';

/**
 * A history stack that behaves like the browser's: pushState truncates the
 * forward entries, back() moves the cursor and fires popstate.
 */
function createFakeHistory(initialSearch = ''): HistoryPort & { entries(): number } {
  interface Entry {
    state: unknown;
    url: string;
  }
  const stack: Entry[] = [{ state: null, url: `/${initialSearch}` }];
  let index = 0;
  const handlers = new Set<() => void>();

  const parse = (url: string): { pathname: string; search: string; hash: string } => {
    const parsed = new URL(url, 'https://flock.test');
    return { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash };
  };

  return {
    history: {
      get state() {
        return stack[index]?.state ?? null;
      },
      pushState(state: unknown, _title: string, url?: string | URL | null) {
        stack.length = index + 1;
        stack.push({ state, url: String(url ?? stack[index]?.url ?? '/') });
        index = stack.length - 1;
      },
      replaceState(state: unknown, _title: string, url?: string | URL | null) {
        stack[index] = { state, url: String(url ?? stack[index]?.url ?? '/') };
      },
      back() {
        if (index === 0) return;
        index -= 1;
        for (const handler of [...handlers]) handler();
      },
    } as HistoryPort['history'],

    get location() {
      return parse(stack[index]?.url ?? '/');
    },

    addEventListener(_type, handler) {
      handlers.add(handler);
    },
    removeEventListener(_type, handler) {
      handlers.delete(handler);
    },
    entries: () => stack.length,
  };
}

afterEach(() => {
  disposeScreenState();
});

describe('the screen list', () => {
  it('is the dock word-keys, in dock order', () => {
    // SWEEP merged into RADAR and left the dock; the id lives on in
    // SECONDARY_SCREENS so old links resolve. See MERGED_SCREENS.
    // MESH (`node`) joined it: hardware pairing became a destination rather
    // than a detour off SETTINGS.
    expect([...DOCK_SCREENS]).toEqual(['radar', 'lookup', 'ask', 'log', 'node']);
  });

  it('covers every secondary screen the shell can reach', () => {
    expect([...SECONDARY_SCREENS]).toEqual([
      'report',
      'settings',
      // WHAT THIS APP KNOWS - the privacy answers, reached from the `?` beside
      // SETTINGS. Not in any design file; a product decision.
      'help',
      // Merged into radar, kept so old links resolve. See MERGED_SCREENS.
      'sweep',
      'onboarding',
      'offline',
      // `node` is a DOCK screen now, not a secondary one.
      'intel',
      'mesh',
      'board',
      'route',
      'triage',
      'watchlist',
      'zone-audit',
      'record',
      'dead-drop',
      'heat-map',
      // Reachable only by URL, and only rendered when the SERVER says the
      // signed-in identity is an administrator. Never in the dock.
      'admin',
      // The v1 hub. Only the v1 dock links to it; v0's dock has no More key.
      'more',
      // The documented-abuse feed. Its records are the same citation-gated file
      // RADAR's county strip reads.
      'misuse',
      'docs',
    ]);
  });

  it('has no duplicates and defaults to radar', () => {
    expect(new Set(SCREEN_IDS).size).toBe(SCREEN_IDS.length);
    expect(DEFAULT_SCREEN).toBe('radar');
    expect(isScreenId('zone-audit')).toBe(true);
    expect(isScreenId('nope')).toBe(false);
  });
});

describe('the URL adapter', () => {
  it('reads ?screen=', () => {
    // A merged screen resolves to the one it merged into: an old bookmark or a
    // manifest shortcut lands on a real picture, not a placeholder.
    expect(screenFromSearch('?screen=sweep')).toBe('radar');
    expect(screenFromSearch('screen=dead-drop')).toBe('dead-drop');
  });

  it('falls back to radar for a missing or unknown screen', () => {
    expect(screenFromSearch('')).toBe('radar');
    expect(screenFromSearch('?screen=telemetry')).toBe('radar');
  });

  it('preserves every other parameter and drops the default screen', () => {
    expect(searchForScreen('sweep', '?src=pwa')).toBe('?src=pwa&screen=sweep');
    expect(searchForScreen('radar', '?src=pwa&screen=sweep')).toBe('?src=pwa');
    expect(searchForScreen('radar', '')).toBe('');
  });

  it('never puts anything but a screen id in the URL', () => {
    // The overlay id is deliberately not deep-linkable: it can carry a camera
    // reference, and a URL is copied into history, synced across devices and
    // pasted into chats.
    const port = createFakeHistory();
    initScreenState({ port });
    openScreen('lookup');
    openOverlay({ id: 'intel:camera-42', kind: 'modal' });

    expect(port.location.search).toBe(`?${SCREEN_PARAM}=lookup`);
    expect(port.location.search).not.toContain('camera-42');
  });
});

describe('deep links', () => {
  it('adopts ?screen= on init', () => {
    initScreenState({ port: createFakeHistory('?screen=board') });
    expect(getScreenState().screen).toBe('board');
  });

  it('does not leave a phantom entry behind the entry point', () => {
    const port = createFakeHistory('?screen=board');
    initScreenState({ port });
    expect(port.entries()).toBe(1);
    expect(goBack()).toBe(false);
  });

  it('opens the app rather than a blank page for an unknown screen', () => {
    initScreenState({ port: createFakeHistory('?screen=teleport') });
    expect(getScreenState().screen).toBe('radar');
  });
});

describe('openScreen / goBack', () => {
  it('pushes a history entry and pops back to the previous screen', () => {
    const port = createFakeHistory();
    initScreenState({ port });

    openScreen('sweep');
    expect(getScreenState().screen).toBe('sweep');
    expect(port.location.search).toBe('?screen=sweep');

    openScreen('log');
    expect(getScreenState().screen).toBe('log');

    expect(goBack()).toBe(true);
    expect(getScreenState().screen).toBe('sweep');

    expect(goBack()).toBe(true);
    expect(getScreenState().screen).toBe('radar');

    // Nothing of ours left. The platform is free to leave the app.
    expect(goBack()).toBe(false);
  });

  it('replace does not grow the back stack', () => {
    const port = createFakeHistory();
    initScreenState({ port });
    openScreen('onboarding');
    openScreen('radar', { replace: true });
    expect(port.entries()).toBe(2);
    expect(getScreenState().depth).toBe(1);
  });

  it('does not duplicate an entry for the screen already shown', () => {
    const port = createFakeHistory();
    initScreenState({ port });
    openScreen('ask');
    const before = port.entries();
    openScreen('ask');
    expect(port.entries()).toBe(before);
  });

  it('notifies subscribers exactly once per change', () => {
    initScreenState({ port: createFakeHistory() });
    let calls = 0;
    const off = subscribe(() => {
      calls += 1;
    });
    openScreen('mesh');
    expect(calls).toBe(1);
    off();
    openScreen('log');
    expect(calls).toBe(1);
  });
});

describe('overlays', () => {
  it('stacks, reports the top, and closes', () => {
    initScreenState({ port: createFakeHistory() });
    openScreen('sweep');

    expect(openOverlay({ id: 'intel', kind: 'modal' })).toBe(1);
    expect(openOverlay({ id: 'report', kind: 'sheet' })).toBe(2);
    expect(topOverlay()?.id).toBe('report');
    expect(presentation()).toBe('overlay');

    expect(closeOverlay()).toBe(true);
    expect(topOverlay()?.id).toBe('intel');
    expect(closeOverlay('intel')).toBe(true);
    expect(closeOverlay()).toBe(false);
    expect(presentation()).toBe('screen');
  });

  it('back closes the top overlay before leaving the screen', () => {
    initScreenState({ port: createFakeHistory() });
    openScreen('sweep');
    openOverlay({ id: 'intel', kind: 'modal' });

    expect(goBack()).toBe(true);
    expect(getScreenState().overlays).toHaveLength(0);
    expect(getScreenState().screen).toBe('sweep');
  });
});

describe('alert interruption', () => {
  it('moves the overlay stack aside and puts it back', () => {
    initScreenState({ port: createFakeHistory() });
    openScreen('lookup');
    openOverlay({ id: 'report', kind: 'sheet' });

    expect(interruptForAlert()).toBe(true);
    expect(isAlertActive()).toBe(true);
    expect(presentation()).toBe('camera-alert');
    expect(topOverlay()).toBeNull();
    expect(getScreenState().savedOverlays.map((o) => o.id)).toEqual(['report']);

    expect(restoreAfterAlert()).toBe(true);
    expect(isAlertActive()).toBe(false);
    expect(getScreenState().overlays.map((o) => o.id)).toEqual(['report']);
    expect(presentation()).toBe('overlay');
  });

  it('never changes the screen or the URL', () => {
    const port = createFakeHistory();
    initScreenState({ port });
    openScreen('board');
    const entriesBefore = port.entries();
    const searchBefore = port.location.search;

    interruptForAlert();
    expect(getScreenState().screen).toBe('board');
    expect(port.location.search).toBe(searchBefore);
    expect(port.entries()).toBe(entriesBefore);

    restoreAfterAlert();
    expect(port.entries()).toBe(entriesBefore);
  });

  it('a second camera does not destroy the saved stack', () => {
    initScreenState({ port: createFakeHistory() });
    openOverlay({ id: 'report', kind: 'sheet' });

    expect(interruptForAlert()).toBe(true);
    // Another camera comes into range while the alert is up.
    expect(interruptForAlert()).toBe(false);
    expect(getScreenState().savedOverlays.map((o) => o.id)).toEqual(['report']);

    restoreAfterAlert();
    expect(getScreenState().overlays.map((o) => o.id)).toEqual(['report']);
  });

  it('keeps an overlay opened during the alert on top of the restored one', () => {
    initScreenState({ port: createFakeHistory() });
    openOverlay({ id: 'report', kind: 'sheet' });
    interruptForAlert();

    openOverlay({ id: 'intel', kind: 'modal' });
    // Still not presented: the alert owns the screen.
    expect(presentation()).toBe('camera-alert');
    expect(topOverlay()).toBeNull();

    restoreAfterAlert();
    expect(getScreenState().overlays.map((o) => o.id)).toEqual(['report', 'intel']);
    expect(topOverlay()?.id).toBe('intel');
  });

  it('back does not unwind an alert', () => {
    initScreenState({ port: createFakeHistory() });
    openScreen('sweep');
    openOverlay({ id: 'intel', kind: 'modal' });
    interruptForAlert();

    goBack();
    expect(isAlertActive()).toBe(true);
    expect(presentation()).toBe('camera-alert');
  });

  it('restore is a no-op when no alert was active', () => {
    initScreenState({ port: createFakeHistory() });
    expect(restoreAfterAlert()).toBe(false);
  });
});

describe('the generated manifest shortcuts', () => {
  it('resolve through this module to the screens they claim', () => {
    const manifest = JSON.parse(manifestRaw) as {
      shortcuts: { name: string; url: string }[];
    };
    const resolved = manifest.shortcuts.map((shortcut) => {
      const url = new URL(shortcut.url, 'https://flock.test');
      return { name: shortcut.name, screen: screenFromSearch(url.search) };
    });

    expect(resolved).toEqual([
      { name: 'RADAR', screen: 'radar' },
      { name: 'Report camera', screen: 'report' },
    ]);
  });

  it('carries no user data in any shortcut URL', () => {
    const manifest = JSON.parse(manifestRaw) as {
      start_url: string;
      shortcuts: { url: string }[];
    };
    for (const url of [manifest.start_url, ...manifest.shortcuts.map((s) => s.url)]) {
      const params = new URLSearchParams(new URL(url, 'https://flock.test').search);
      for (const [key, value] of params) {
        expect(['src', SCREEN_PARAM]).toContain(key);
        if (key === SCREEN_PARAM) expect(isScreenId(value)).toBe(true);
      }
    }
  });
});
