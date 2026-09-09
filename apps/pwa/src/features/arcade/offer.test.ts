/**
 * THE GATE, AS A TABLE. Eight conditions; each one flipped alone says no.
 *
 * `isOfferable` is the product rules for the game made testable, and every
 * row here is one of those rules. The two that are easiest to get wrong are
 * spelled out on their own: a null speed is not parked, and the 3-5 mph gap --
 * the engine calls 4 mph stationary and the fix does not call it slow -- must
 * refuse rather than split the difference.
 */

import { describe, expect, it } from 'vitest';

import { DOCK_COLLAPSED_STATE_IDS } from '../dock/dockState.ts';
import { ARCADE_DOCK_STATE, ARCADE_SCREEN, MIN_MOVING_MPH, isOfferable, slowByFix } from './offer.ts';
import type { OfferInput } from './offer.ts';

const OK: OfferInput = Object.freeze({
  stationary: true,
  speedMph: 0,
  inRange: true,
  accuracyGated: false,
  takeoverActive: false,
  shouldAlertUser: false,
  screen: ARCADE_SCREEN,
  pane: 'collapsed',
  state: ARCADE_DOCK_STATE,
  motionReduced: false,
});

describe('isOfferable', () => {
  it('offers when every one of the eight holds', () => {
    expect(isOfferable(OK)).toBe(true);
  });

  it.each<[string, Partial<OfferInput>]>([
    ['not stationary by the engine', { stationary: false }],
    ['speed at the moving threshold', { speedMph: MIN_MOVING_MPH }],
    ['no reader in range', { inRange: false }],
    ['the fix too inaccurate to alert on', { accuracyGated: true }],
    ['a live takeover', { takeoverActive: true }],
    ['the gate open', { shouldAlertUser: true }],
    ['off the map tab', { screen: 'log' }],
    ['the pane expanded', { pane: 'expanded', state: 'armed-expanded' }],
    ['the pane navigating', { pane: 'navigating', state: 'turn-imminent' }],
    ['reduced motion', { motionReduced: true }],
  ])('refuses on %s alone', (_label, flip) => {
    expect(isOfferable({ ...OK, ...flip })).toBe(false);
  });

  it('treats an unknown speed as not parked, the way the engine does', () => {
    expect(isOfferable({ ...OK, speedMph: null })).toBe(false);
    expect(slowByFix(null)).toBe(false);
    expect(slowByFix(Number.NaN)).toBe(false);
  });

  it('refuses in the 3-5 mph gap where the engine says stationary and the fix says moving', () => {
    expect(isOfferable({ ...OK, stationary: true, speedMph: 4 })).toBe(false);
    expect(isOfferable({ ...OK, stationary: true, speedMph: 2.9 })).toBe(true);
  });

  it('refuses on every collapsed state but dense, which keeps the toy off MUTED, OFFLINE and ABUSE ZONE', () => {
    for (const state of DOCK_COLLAPSED_STATE_IDS) {
      expect(isOfferable({ ...OK, state })).toBe(state === 'dense');
    }
  });
});
