/**
 * The six skins of section 05, and the one rule about them that is not
 * cosmetic.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_MODE } from '../../app/mode.ts';

import { MODE_CHOICES, V0_MODES } from './modes.ts';

describe('the picker offers section 05, in section 05 order', () => {
  it('offers every mode the design ships and nothing else', () => {
    expect(MODE_CHOICES.map((choice) => choice.mode)).toEqual([...V0_MODES]);
  });

  it('badges the default wherever section 05 order happens to put it', () => {
    // The badge follows DEFAULT_MODE rather than being transcribed onto one
    // entry, so moving the default cannot leave a stale DEFAULT marker behind on
    // the mode that used to hold it. Section 05's order is a contract and is not
    // reshuffled to bring the default to the front.
    // Derived, so it cannot go stale - and this is the second time the default
    // has moved under it, which is the whole argument for deriving it.
    //
    // WHAT THIS ASSERTED BEFORE: that NOTHING carries the DEFAULT badge,
    // because the default was `slate` and `slate` is not one of the modes this
    // retired picker offers. It has since been `neon-grid` and is now
    // `night-watch`, both of which ARE offered. The rule is the same either
    // way and is written as the rule: at most one entry is badged, and if one
    // is, it is the default.
    const badged = MODE_CHOICES.filter((choice) => choice.badge === 'DEFAULT');
    expect(badged.every((choice) => choice.mode === DEFAULT_MODE)).toBe(true);
    expect(badged.length).toBeLessThanOrEqual(1);
    expect(badged.length).toBe(MODE_CHOICES.some((c) => c.mode === DEFAULT_MODE) ? 1 : 0);
  });

  it('names each one as its card names it', () => {
    const byMode = new Map(MODE_CHOICES.map((choice) => [choice.mode, choice]));
    expect(byMode.get('night-watch')?.name).toBe('Night watch');
    // The DEFAULT badge deliberately outranks an era badge on whichever entry
    // holds it, so the badge for a given mode depends on what the default is
    // that day. Read from `DEFAULT_MODE` rather than transcribed, because this
    // test is about the NAMES and should not fail every time taste moves.
    expect(byMode.get(DEFAULT_MODE)?.badge).toBe('DEFAULT');
    expect(byMode.get('cartridge-96')?.badge).toBe('90s INFOTAINMENT');
    expect(byMode.get('pursuit')?.badge).toBe('SCANNER');
    expect(byMode.get('cluster')?.badge).toBe('80s MOVIE DASH');
    expect(byMode.get('dash-cast')?.badge).toBe(
      'PHONE-PROJECTED HEAD UNIT · 800×480 LANDSCAPE',
    );
  });
});
