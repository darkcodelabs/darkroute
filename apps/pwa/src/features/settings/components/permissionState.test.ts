/**
 * A TOGGLE THAT ONLY DRAWS A SWITCH POSITION IS A SHAPE.
 *
 * Brief 4's rule for every toggle in the product: "on · used while the map is
 * open", not a switch position. The switch says on or off; the words say what
 * that MEANS, and the words are the half a person sitting down to set this can
 * act on.
 *
 * The two failures pinned here are the ones that would be invisible on screen:
 *
 *   SAYING "on" FOR A GRANTED PERMISSION THE APP HAS BEEN TOLD NOT TO USE.
 *   The OS grant and our own use of it are two different facts, and this screen
 *   is the only place a driver can switch the second one off. A row that read
 *   "on" after they did would be the app claiming a capability it is not
 *   exercising, on a counter-surveillance product.
 *
 *   COLLAPSING DENIED AND UNAVAILABLE INTO "off". Both look like off and
 *   neither is: one is fixed in the browser's site settings and the other
 *   cannot be fixed at all. The `<state> · <use>` shape the spec draws cannot
 *   carry an instruction, so those two keep sentences of their own -- and this
 *   is the test that stops somebody tidying them into the pattern.
 */

import { describe, expect, it } from 'vitest';

import { stateLine } from './PermissionsV1.tsx';

const USE = 'used while the map is open';

describe('what a permission row says about itself', () => {
  it('says on only when the OS granted it AND the app is using it', () => {
    expect(stateLine('GRANTED', true, USE)).toBe('on · used while the map is open');
  });

  it('says off for a granted permission the driver switched off here', () => {
    // The grant survives; our use of it does not. Saying "on" here would be the
    // app claiming something it is not doing.
    expect(stateLine('GRANTED', false, USE)).toBe('off · used while the map is open');
  });

  it('says off for a permission that has never been asked for', () => {
    // Literally true -- the app is not using it -- and the alternative was to
    // print the status word, `allow` or `optional`, which are names for what a
    // PROMPT would offer rather than for what is currently happening.
    expect(stateLine('ALLOW', false, USE)).toBe('off · used while the map is open');
    expect(stateLine('OPTIONAL', false, USE)).toBe('off · used while the map is open');
  });

  it('says checking before the permission read has landed', () => {
    // Not "off". The app has not been told anything yet, and a row that reads
    // off before the read returns is a decision the app has not made.
    expect(stateLine('CHECKING', false, USE)).toBe('checking · used while the map is open');
  });

  it('names the only place a refusal can be undone, and does not say off', () => {
    const line = stateLine('DENIED', false, USE);
    expect(line).toContain('site settings');
    expect(line.startsWith('off')).toBe(false);
  });

  it('says a missing capability is missing, not switched off', () => {
    const line = stateLine('UNAVAILABLE', false, USE);
    expect(line).toContain('does not offer it');
    expect(line.startsWith('off')).toBe(false);
  });
});
