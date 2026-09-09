/**
 * THE TILE WIDTH, DERIVED, BECAUSE ASSERTING IT HAS FAILED TWICE.
 *
 * =============================================================================
 * TWO WRONG NUMBERS, BOTH IN THE FLATTERING DIRECTION
 * =============================================================================
 * The FAQ tells drivers how much a tile request reveals about where they are.
 * It has now carried two wrong answers, and both erred the same way - toward a
 * bigger tile, which sounds more private:
 *
 *   "about 15 km"   the original. Off by a factor of eight. It is roughly the
 *                   width at zoom 11, and the speeds archive this claim is
 *                   about is read at zoom 14.
 *   "about 2.4 km"  the correction. Right arithmetic, wrong latitude: 2,446 m
 *                   is the width at the EQUATOR. A tile is a fixed slice of a
 *                   Mercator projection, so its ground width shrinks with
 *                   cos(latitude), and essentially every camera in this archive
 *                   is between 25 and 49 degrees north.
 *
 * A third hand-written number would probably also be wrong, so this file does
 * not contain one. It derives the width from `SPEED_ZOOM` - the constant the
 * request is actually made at - and checks the sentence the app prints against
 * the arithmetic. Change the zoom and this fails until the copy is changed too.
 */

import { describe, expect, it } from 'vitest';

import { SPEED_ZOOM } from './speedSource.ts';
import { HELP_SECTIONS } from '../help/answers.ts';

/** WGS84 equatorial circumference, which is what the projection is built on. */
const EQUATORIAL_M = 40_075_017;

/** Ground width of one tile at `zoom`, at `latitudeDeg`. */
function tileWidthM(zoom: number, latitudeDeg: number): number {
  return (EQUATORIAL_M / 2 ** zoom) * Math.cos((latitudeDeg * Math.PI) / 180);
}

/**
 * The latitude the FAQ's number should describe.
 *
 * Not the equator, and not a US extreme. The claim is about a typical driver,
 * and the archive's mass sits across the lower 48; 39 degrees is about the
 * middle of it and is the honest single number for a one-sentence answer.
 */
const TYPICAL_US_LAT = 39;

describe('the tile-width claim in the FAQ', () => {
  it('is derived from the zoom the request is actually made at', () => {
    // If this drifts, the FAQ is describing a request the app no longer makes.
    expect(SPEED_ZOOM).toBe(14);
  });

  it('rounds to the figure the FAQ prints, at a latitude drivers are at', () => {
    const km = tileWidthM(SPEED_ZOOM, TYPICAL_US_LAT) / 1000;
    // 1.90 km. The assertion is deliberately tight: a claim about how much
    // location a request leaks should not be rounded in whichever direction
    // reads better, which is precisely how the last two versions went wrong.
    expect(km).toBeGreaterThan(1.85);
    expect(km).toBeLessThan(1.95);

    const answer = HELP_SECTIONS.flatMap((s) => s.answers).find(
      (entry) => entry.question === 'does my location leave this phone?',
    )?.answer;
    expect(answer, 'the FAQ no longer states a tile width').toBeDefined();
    expect(answer).toContain('1.9 km');
    expect(answer).toContain('roughly 15 km');
  });

  it('is smaller than the equator figure, which is the mistake it replaces', () => {
    // Pinning the relationship, not just the number: whoever edits this next
    // should see immediately that latitude is the variable that bit twice.
    const equator = tileWidthM(SPEED_ZOOM, 0);
    const typical = tileWidthM(SPEED_ZOOM, TYPICAL_US_LAT);
    expect(typical).toBeLessThan(equator);
    expect(equator / typical).toBeGreaterThan(1.25);
  });

  it('does not confuse the z14 speed request with the z11 camera request', () => {
    const answer = HELP_SECTIONS.flatMap((s) => s.answers).find(
      (entry) => entry.question === 'does my location leave this phone?',
    )?.answer;

    expect(answer).toBeDefined();
    expect(answer).not.toContain('2.4 km');
    expect(answer).not.toMatch(/speed[^.]*15 km/);
  });
});
