/**
 * The navigation slice is a MIRROR, so its tests are mostly about the mirror
 * staying true - including in the one direction that matters most, when a
 * camera alert moves the overlay stack aside from outside React.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  disposeScreenState,
  getScreenState,
  initScreenState,
  openScreen,
} from '../app/screenState.ts';
import { navigationActions, useNavigationStore } from './navigation.ts';

beforeEach(() => {
  disposeScreenState();
  initScreenState({ initialScreen: 'radar' });
  navigationActions.sync();
});

afterEach(() => {
  disposeScreenState();
});

describe('the mirror', () => {
  it('starts on the screen the URL adapter resolved', () => {
    expect(useNavigationStore.getState().screen).toBe('radar');
    expect(useNavigationStore.getState().presentation).toBe('screen');
  });

  it('follows a screen change made through the underlying store', () => {
    openScreen('lookup');
    expect(useNavigationStore.getState().screen).toBe('lookup');
  });

  it('follows a screen change made through the slice', () => {
    navigationActions.openScreen('sweep');
    expect(getScreenState().screen).toBe('sweep');
    expect(useNavigationStore.getState().screen).toBe('sweep');
  });

  it('caches the top overlay and the presentation rather than deriving them', () => {
    navigationActions.openOverlay({ id: 'report', kind: 'sheet' });
    const state = useNavigationStore.getState();
    expect(state.topOverlay).toEqual({ id: 'report', kind: 'sheet' });
    expect(state.presentation).toBe('overlay');
    // The cached array is the same reference the underlying store holds, so a
    // subscriber comparing by identity sees no change until one really happens.
    expect(state.overlays).toBe(getScreenState().overlays);
  });
});

describe('overlays', () => {
  it('closes the top one, then reports honestly that there is nothing left', () => {
    navigationActions.openOverlay({ id: 'report', kind: 'sheet' });
    navigationActions.openOverlay({ id: 'intel', kind: 'modal' });
    expect(useNavigationStore.getState().topOverlay?.id).toBe('intel');

    expect(navigationActions.closeOverlay()).toBe(true);
    expect(useNavigationStore.getState().topOverlay?.id).toBe('report');
    expect(navigationActions.closeOverlay('report')).toBe(true);
    expect(navigationActions.closeOverlay()).toBe(false);
    expect(useNavigationStore.getState().presentation).toBe('screen');
  });
});

describe('alert interruption', () => {
  it('saves the stack, is idempotent, and restores it', () => {
    navigationActions.openOverlay({ id: 'report', kind: 'sheet' });

    expect(navigationActions.saveForAlert()).toBe(true);
    expect(useNavigationStore.getState().presentation).toBe('camera-alert');
    expect(useNavigationStore.getState().topOverlay).toBeNull();
    expect(useNavigationStore.getState().savedOverlays.map((o) => o.id)).toEqual(['report']);

    // A second camera entering range must not overwrite the saved stack with
    // the (now empty) current one.
    expect(navigationActions.saveForAlert()).toBe(false);
    expect(useNavigationStore.getState().savedOverlays.map((o) => o.id)).toEqual(['report']);

    expect(navigationActions.restoreAfterAlert()).toBe(true);
    expect(useNavigationStore.getState().topOverlay?.id).toBe('report');
    expect(navigationActions.restoreAfterAlert()).toBe(false);
  });

  it('does not change the screen the driver was on', () => {
    navigationActions.openScreen('log');
    navigationActions.saveForAlert();
    expect(useNavigationStore.getState().screen).toBe('log');
    navigationActions.restoreAfterAlert();
    expect(useNavigationStore.getState().screen).toBe('log');
  });
});

describe('back', () => {
  it('reports false when this module has nothing to unwind', () => {
    // False means the platform must be allowed to leave the app - a back press
    // that silently does nothing is how an app earns a one-star review.
    expect(navigationActions.back()).toBe(false);
  });

  it('reports true once something has been pushed', () => {
    navigationActions.openScreen('ask');
    expect(navigationActions.back()).toBe(true);
  });
});
