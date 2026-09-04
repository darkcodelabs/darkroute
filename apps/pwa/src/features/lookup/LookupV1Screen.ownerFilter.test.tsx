/**
 * LOOK UP'S OWNER CHIPS ARE NOT THE MAP'S OWNER FILTER, AND MUST NEVER BECOME IT.
 *
 * =============================================================================
 * TWO CONTROLS, SAME VOCABULARY, DIFFERENT VERBS
 * =============================================================================
 * There are now two owner filters spelled with the same five words. LOOK UP's
 * chips are a SEARCH predicate: they narrow a list of results and the screen
 * prints its own denominator underneath ("N matching, searched against the M
 * cameras on this phone"). DRIVE's `mapOwnerFilter` is a DRAWING predicate: it
 * decides which dots the map paints. Reading either from the other is the
 * defect this file exists to stop, and it is a one-line change in either
 * direction.
 *
 * The failure is quiet on both sides. Map to LOOK UP: a driver who narrowed the
 * map to police on the way here opens LOOK UP, searches for the HOA reader they
 * are standing under, and is told nothing on this phone matches - from the
 * screen whose whole claim is that it searched everything it holds. LOOK UP to
 * map: a driver who narrowed a SEARCH to HOA last Tuesday drives on Friday with
 * police cameras missing from the map, having never touched the driving screen.
 * Neither looks broken. Both are the app lying about what it knows.
 *
 * =============================================================================
 * WHY A RENDER TEST AND NOT ONLY A grep
 * =============================================================================
 * `LookupV1Screen.source.test.ts` guards this screen's OTHER promise - that it
 * never reaches the network - and it would pass unchanged if somebody wired the
 * shared store into the chips tomorrow, because a store read is not a fetch.
 * So the isolation is asserted here by mounting the screen with the map filter
 * already in force and reading what it drew. The source assertions at the end
 * are the cheap second lock, not the proof.
 *
 * This mounts the v1 component: `lookup` maps to `LookupV1Screen` in
 * `app/registry.v1.tsx` and DEFAULT_DESIGN is v1, so a test against v0's
 * `LookupScreen` would be asserting about a screen the build does not render.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useCamerasStore } from '../../stores/cameras.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import type { CameraRecord } from '../../services/db/schema.ts';
import { OWNER_LABELS } from '../triage/triage.ts';

import { LookupV1Screen } from './LookupV1Screen.tsx';

/**
 * One camera of every class the archive can hold, including a record with no
 * `ownerType` at all - which is the honest majority, since OSM ALPR nodes
 * usually carry no `operator`. Every class is present exactly once, so any
 * filter reaching this screen from anywhere removes a row that can be named.
 */
const ARCHIVE: readonly CameraRecord[] = [
  { id: 'osm:a-police', lat: 38.91, lon: -94.69, directionDeg: 180, ownerType: 'police', street: 'POLICE ST' },
  { id: 'osm:b-inter', lat: 38.92, lon: -94.69, directionDeg: 180, ownerType: 'inter_agency', street: 'SHARED ST' },
  { id: 'osm:c-hoa', lat: 38.93, lon: -94.69, directionDeg: 180, ownerType: 'hoa', street: 'HOA ST' },
  { id: 'osm:d-private', lat: 38.94, lon: -94.69, directionDeg: 180, ownerType: 'private', street: 'PRIVATE ST' },
  { id: 'osm:e-unverified', lat: 38.95, lon: -94.69, directionDeg: 180, ownerType: 'unverified', street: 'UNVERIFIED ST' },
  { id: 'osm:f-unrecorded', lat: 38.96, lon: -94.69, directionDeg: 180, street: 'UNRECORDED ST' },
];

/**
 * The streets are named after the classes so a missing row is a missing NAME
 * rather than one of six identical strings. With no fix the order is by id,
 * which is why the ids sort into the same order as this list.
 */
const EVERY_STREET: readonly string[] = [
  'POLICE ST',
  'SHARED ST',
  'HOA ST',
  'PRIVATE ST',
  'UNVERIFIED ST',
  'UNRECORDED ST',
];

function putArchive(): void {
  useCamerasStore.getState().putTiles([
    {
      ref: { z: 11, x: 484, y: 783 },
      cameras: ARCHIVE,
      fetchedAtMs: 1_700_000_000_000,
      freshness: 'fresh',
      source: 'network',
    },
  ]);
}

/** The results list, which is also where the owner labels appear a SECOND time. */
function results(): HTMLElement {
  return screen.getByRole('list', { name: 'results' });
}

/** The place names LOOK UP drew, in the order it drew them. */
function resultsShown(): readonly string[] {
  return within(results())
    .getAllByRole('button')
    .map((row) => row.querySelector('.fwm-lookupv1-place')?.textContent ?? '');
}

/** An owner chip, by the label the driver reads. */
function chip(name: string): HTMLElement {
  const group = screen.getByRole('group', { name: 'owner' });
  return within(group).getByRole('button', { name });
}

afterEach(() => {
  useCamerasStore.getState().reset();
  useSettingsStore.getState().reset();
});

describe("LOOK UP and the map's owner filter", () => {
  it('draws the same list whether or not the map is filtered', () => {
    putArchive();

    const unfiltered = render(<LookupV1Screen />);
    const before = unfiltered.container.textContent ?? '';
    const rowsBefore = resultsShown();
    unfiltered.unmount();

    // A COLD MOUNT, deliberately. Setting the filter on a screen already on
    // screen proves little: LOOK UP does not subscribe to the settings store,
    // so React would not re-render and the comparison would pass for a reason
    // unrelated to the property. Mounting fresh makes the screen read whatever
    // it reads at first paint.
    useSettingsStore.getState().setMapOwnerFilter('police');
    const filtered = render(<LookupV1Screen />);

    expect(filtered.container.textContent ?? '').toBe(before);
    expect(resultsShown()).toEqual(rowsBefore);
  });

  it('still finds a camera of a class the map has hidden', () => {
    putArchive();
    useSettingsStore.getState().setMapOwnerFilter('police');

    render(<LookupV1Screen />);

    // Every class, including the HOA reader the driver is standing under: the
    // map has hidden it and this is the screen that must still say it is there.
    expect(resultsShown()).toEqual(EVERY_STREET);
    // Scoped to the list, because the chip strip prints the same five labels.
    expect(within(results()).getByText(OWNER_LABELS.hoa)).toBeInTheDocument();
    expect(within(results()).getByText('owner unrecorded')).toBeInTheDocument();

    // And the denominator it prints stays the whole archive, not the drawn set.
    expect(
      screen.getByText(`matching, searched against the ${String(ARCHIVE.length)} cameras on this phone`),
    ).toBeInTheDocument();
  });

  it('recomputes to the same answer once a keystroke forces the memo to run', () => {
    putArchive();
    render(<LookupV1Screen />);
    const before = resultsShown();

    useSettingsStore.getState().setMapOwnerFilter('police');
    // The hits are a `useMemo`, so a leak keyed on a store this screen does not
    // subscribe to would hide until something else made it recompute. Typing
    // and clearing is that something.
    const field = screen.getByRole('searchbox', { name: 'Look up' });
    fireEvent.change(field, { target: { value: 'main' } });
    fireEvent.change(field, { target: { value: '' } });

    expect(resultsShown()).toEqual(before);
  });

  it('starts on ALL OWNERS however the map was left', () => {
    putArchive();
    useSettingsStore.getState().setMapOwnerFilter('hoa');

    render(<LookupV1Screen />);

    expect(chip('All owners')).toHaveAttribute('data-fwm-selected', 'true');
    for (const owner of ['police', 'inter_agency', 'hoa', 'private', 'unverified'] as const) {
      expect(chip(OWNER_LABELS[owner])).toHaveAttribute('data-fwm-selected', 'false');
    }
  });

  it('narrows its own list without touching what the map draws', () => {
    putArchive();
    render(<LookupV1Screen />);

    fireEvent.click(chip(OWNER_LABELS.hoa));

    // The chip did something - otherwise the second assertion is worthless.
    expect(resultsShown()).toEqual(['HOA ST']);
    expect(chip(OWNER_LABELS.hoa)).toHaveAttribute('data-fwm-selected', 'true');

    // And it did it HERE ONLY. A driver who narrows a search has not asked the
    // driving screen to stop drawing anything.
    expect(useSettingsStore.getState().mapOwnerFilter).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The second lock: the screen does not even name the shared filter.
// ---------------------------------------------------------------------------

/** Comments name the things they promise NOT to do; only code is checked. */
function codeOf(relative: string): string {
  const found = [`src/${relative}`, `apps/pwa/src/${relative}`]
    .map((rel) => resolve(process.cwd(), rel))
    .find((path) => existsSync(path));
  expect(found, `${relative} not found`).toBeDefined();
  return readFileSync(found as string, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('the v1 lookup source', () => {
  it('never names the map drawing filter', () => {
    // Named symbols rather than a blanket ban on the settings store: this
    // screen legitimately reads `useCachedCameras` and friends from
    // `stores/index.ts`, and a ban wide enough to catch the filter would catch
    // those too and be deleted the first time it got in somebody's way.
    const code = codeOf('features/lookup/LookupV1Screen.tsx');
    for (const symbol of [
      'mapOwnerFilter',
      'useMapOwnerFilter',
      'setMapOwnerFilter',
      'visibleCameras',
      'ownerFilter',
    ]) {
      expect(
        code,
        `LOOK UP reads ${symbol}. Its chips are a SEARCH predicate and the map's filter is a DRAWING one; sharing them makes one screen silently govern the other.`,
      ).not.toContain(symbol);
    }
  });

  it('still holds its own selection, so there is something to keep separate', () => {
    // If this ever fails, the chips have stopped being local state - which is
    // the first half of the merge the test above forbids the second half of.
    const code = codeOf('features/lookup/LookupV1Screen.tsx');
    expect(code).toContain('useState<CameraOwnerType | null>(null)');
  });

  it('leaves the pure search function free of any store at all', () => {
    // `searchCameras` takes `ownerType` as an argument. The moment it reads a
    // store instead, every caller inherits a filter it did not pass.
    const code = codeOf('features/lookup/search.ts');
    for (const symbol of ['useSettingsStore', 'stores/', 'mapOwnerFilter']) {
      expect(code, `search.ts reads ${symbol}`).not.toContain(symbol);
    }
  });
});
