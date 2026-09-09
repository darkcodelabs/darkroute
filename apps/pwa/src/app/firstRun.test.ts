import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useSettingsStore } from '../stores/settings.ts';

import {
  captureEntrySearch,
  clearOnboardedLocally,
  hasExplicitScreenRequest,
  markOnboardedLocally,
  useFirstRunGate,
} from './firstRun.ts';
import { getScreenState, initScreenState, openScreen } from './screenState.ts';

function setSettings(hydrated: boolean, onboardedAtMs: number | null): void {
  useSettingsStore.setState({ hydrated, onboardingCompletedAtMs: onboardedAtMs });
}

beforeEach(() => {
  clearOnboardedLocally();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  captureEntrySearch('');
  initScreenState();
});

describe('hasExplicitScreenRequest', () => {
  it('is true only when the load actually carried a screen parameter', () => {
    expect(hasExplicitScreenRequest('?screen=report')).toBe(true);
    expect(hasExplicitScreenRequest('?src=pwa')).toBe(false);
    expect(hasExplicitScreenRequest('')).toBe(false);
  });
});

describe('the first-run gate', () => {
  it('sends a driver who has never onboarded to onboarding', () => {
    setSettings(true, null);
    captureEntrySearch('');
    initScreenState();

    renderHook(() => {
      useFirstRunGate();
    });

    expect(getScreenState().screen).toBe('onboarding');
  });

  it('waits for the settings store to hydrate before deciding anything', () => {
    // The bug this guards: an unhydrated store reads as "never onboarded", so
    // an ungated version re-runs onboarding on every cold start.
    setSettings(false, null);
    captureEntrySearch('');
    initScreenState();

    renderHook(() => {
      useFirstRunGate();
    });

    expect(getScreenState().screen).not.toBe('onboarding');
  });

  it('leaves a driver who has already onboarded where they were', () => {
    setSettings(true, 1_700_000_000_000);
    captureEntrySearch('');
    initScreenState();

    renderHook(() => {
      useFirstRunGate();
    });

    expect(getScreenState().screen).not.toBe('onboarding');
  });

  it('never hijacks a deep link - a launcher shortcut is not a first run', () => {
    setSettings(true, null);
    window.history.replaceState(null, '', '/?screen=report');
    captureEntrySearch();
    initScreenState();

    renderHook(() => {
      useFirstRunGate();
    });

    expect(getScreenState().screen).toBe('report');
  });

  it('does not hijack ?screen=radar, even though initScreenState drops the parameter', () => {
    // The bug: radar is DEFAULT_SCREEN, so `initScreenState()` rewrites the URL
    // without `screen=radar`. Reading window.location inside the effect then
    // reports "no deep link" and the gate redirects a load that explicitly
    // asked for RADAR. Only the snapshot taken before the rewrite is true.
    setSettings(true, null);
    window.history.replaceState(null, '', '/?screen=radar');
    captureEntrySearch();
    initScreenState();
    expect(window.location.search).not.toContain('screen');

    renderHook(() => {
      useFirstRunGate();
    });

    expect(getScreenState().screen).toBe('radar');
  });
});

describe('the refresh loop', () => {
  it('lets an onboarded driver leave a URL that still says onboarding', () => {
    // THE BUG THIS IS FOR.
    //
    // The gate sends a first-time driver to onboarding by rewriting the URL to
    // `?screen=onboarding`, and that URL outlived the reason for it: every
    // later load read it and opened onboarding again, before this hook ran and
    // regardless of what it decided. Refresh, refresh, refresh, same screen --
    // because the screen was being chosen by the address bar, not by the gate.
    captureEntrySearch('?screen=onboarding');
    initScreenState();
    openScreen('onboarding', { replace: true });
    expect(getScreenState().screen).toBe('onboarding');

    markOnboardedLocally();
    renderHook(() => {
      useFirstRunGate();
    });

    expect(getScreenState().screen).toBe('radar');
  });

  it('still holds a driver who has NOT onboarded on the screen', () => {
    // The other direction has to keep working: the way out must not become a
    // way past.
    clearOnboardedLocally();
    captureEntrySearch('');
    initScreenState();
    renderHook(() => {
      useFirstRunGate();
    });
    expect(getScreenState().screen).toBe('onboarding');
  });
});
