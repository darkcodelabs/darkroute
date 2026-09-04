/**
 * "NEAR ME" IS PRESSABLE, WHICH IT HAD NEVER BEEN.
 *
 * =============================================================================
 * WHY THIS IS ITS OWN FILE
 * =============================================================================
 * The chip is `disabled={myFips === null}`, and `myFips` came off the nearest
 * cached camera's `countyFips`. No camera in the shipped archive carries that
 * field - 0 of 868 across 60 randomly sampled z11 tiles - so the chip was
 * disabled on every device, always, and nothing in the suite noticed because
 * nothing rendered this screen with a fix and looked at the chip.
 *
 * These tests render the real screen with a real fix and assert the chip's
 * enabled state, which is the whole of what the user reported.
 *
 * THE INDEX IS THE REAL ONE, read off disk, for the reason `countyLocate.test.ts`
 * gives: a fixture would prove the wiring and say nothing about whether the file
 * the app ships actually resolves the county it claims to.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GeoFix } from '../../services/adapters';
import { positionActions } from '../../stores/position.ts';

import { MisuseScreen } from './MisuseScreen.tsx';

const INDEX = readFileSync(resolve(process.cwd(), 'public/records/county-index.json'), 'utf8');
const RECORDS = readFileSync(resolve(process.cwd(), 'public/records/counties.json'), 'utf8');

/** Downtown Cincinnati: Hamilton County, Ohio - FIPS 39061. */
const CINCINNATI: GeoFix = {
  lat: 39.1031,
  lon: -84.512,
  accuracyM: 5,
  altitudeM: null,
  altitudeAccuracyM: null,
  speedMps: 0,
  headingDeg: null,
  timestamp: 1_000_000,
};

/** The middle of the Pacific. In no county, so the chip must stay inert. */
const OPEN_OCEAN: GeoFix = { ...CINCINNATI, lat: 30, lon: -140 };

function serveFiles(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('county-index.json')) return new Response(INDEX, { status: 200 });
      if (url.includes('counties.json')) return new Response(RECORDS, { status: 200 });
      return new Response('{}', { status: 404 });
    }),
  );
}

function nearMeChip(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Near me' }) as HTMLButtonElement;
}

beforeEach(() => {
  positionActions.reset();
  serveFiles();
});

afterEach(() => {
  vi.unstubAllGlobals();
  positionActions.reset();
});

describe('the MISUSE screen near-me filter', () => {
  it('is DISABLED with no fix, which is the honest state and was never the bug', () => {
    render(<MisuseScreen />);
    expect(nearMeChip().disabled).toBe(true);
  });

  it('BECOMES PRESSABLE once there is a fix the county index can place', async () => {
    /*
     * THE REGRESSION THIS EXISTS FOR. Before the on-device county lookup this
     * assertion failed: the chip stayed disabled forever, because the only
     * source of a FIPS was a camera field that no shipped camera carries.
     */
    render(<MisuseScreen />);
    positionActions.ingestFix(CINCINNATI);

    await waitFor(() => {
      expect(nearMeChip().disabled).toBe(false);
    });
  });

  it('stays inert for a fix in no US county, rather than guessing the nearest one', async () => {
    render(<MisuseScreen />);
    positionActions.ingestFix(OPEN_OCEAN);

    // Give the lookup a chance to resolve and be wrong, so this is not just
    // passing on a race.
    await new Promise((r) => setTimeout(r, 50));
    expect(nearMeChip().disabled).toBe(true);
  });

  it('does not fetch the county index when there is no fix to place', async () => {
    render(<MisuseScreen />);
    await new Promise((r) => setTimeout(r, 50));

    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const asked = calls.some((c) => String(c[0]).includes('county-index.json'));
    // A megabyte of county geometry is not something to pull down on a screen
    // that cannot use it yet.
    expect(asked).toBe(false);
  });
});
