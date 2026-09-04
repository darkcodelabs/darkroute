/**
 * THE MAP PANEL ON DRIVE, and the one thing it must never be able to do.
 *
 * =============================================================================
 * WHAT IS BEING GUARDED
 * =============================================================================
 * The owner rows in this panel change which cameras are DRAWN. If one of them
 * ever reaches the alert engine, a driver narrows the map to "police / agency"
 * to see who owns what, forgets, and drives past an HOA reader the app has
 * stopped warning them about - and nothing on screen looks broken, because the
 * filter looks like it is working.
 *
 * So the load-bearing test here is not about pixels: it renders the card, reads
 * every figure on it, sets the filter to the class the nearest camera is NOT,
 * and asserts the card is byte-identical. `features/map/ownerFilter.engine.test
 * .ts` proves the same property at the store, driving the real loop; this
 * proves the SCREEN did not quietly re-derive anything from the drawn set.
 *
 * Everything is driven through the shipped chain - records into the cameras
 * store, `createAlertLoop` over a real fix, `packages/core` doing the measuring
 * - rather than through a hand-built view model, so a screen that agreed with a
 * mock and disagreed with the engine would fail here.
 *
 * This mounts the v1 component. `radar` maps to `DriveScreen` in
 * `app/registry.v1.tsx`, and DEFAULT_DESIGN is v1: a test against the v0 screen
 * would be asserting about a component the build does not render.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAlertStore } from '../../stores/alert.ts';
import { useCamerasStore } from '../../stores/cameras.ts';
import { usePositionStore, positionActions } from '../../stores/position.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import { createAlertLoop } from '../../services/alerts/engineLoop.ts';
import type { AlertLoop } from '../../services/alerts/engineLoop.ts';
import type { CameraRecord } from '../../services/db/schema.ts';
import {
  MAP_PANEL_ALL,
  MAP_PANEL_DISPLAY_ONLY,
  MAP_PANEL_VIEWS,
  MAP_PANEL_ZOOM_CAVEAT,
} from '../map/MapControlPanel.tsx';

import {
  DRIVE_CARD_EXPAND,
  DRIVE_DRAWS,
  DRIVE_DRAWS_ALL,
  DRIVE_DRAWS_STILL,
  DriveScreen,
} from './DriveScreen.tsx';

/** Every loop a test starts, stopped even when the test fails partway. */
const started: AlertLoop[] = [];
function loopUnderTest(): AlertLoop {
  const loop = createAlertLoop();
  started.push(loop);
  return loop;
}

/** A fix in Kansas City, where the shipped tile set has real cameras. */
const FIX = {
  lat: 38.9181,
  lon: -94.6923,
  headingDeg: 0,
  speedMps: 21,
  accuracyM: 8,
  timestampMs: 1_700_000_000_000,
};

/** Metres north of the fix, as a camera. 1 degree of latitude is ~111,320 m. */
function cameraNorthOf(
  metres: number,
  id: string,
  ownerType: CameraRecord['ownerType'],
): CameraRecord {
  const record: CameraRecord = {
    id,
    lat: FIX.lat + metres / 111_320,
    lon: FIX.lon,
    // Facing back down the road, so every camera in the fixture is one the
    // driver is closing on.
    directionDeg: 180,
    confirmations: 1,
  };
  return ownerType === undefined ? record : { ...record, ownerType };
}

/**
 * The road ahead. The NEAREST one is an HOA reader - exactly the class a driver
 * filtering for police would have hidden - so a filter that reached the engine
 * would change the card's own figures rather than failing somewhere quiet.
 */
const AHEAD: readonly CameraRecord[] = [
  cameraNorthOf(90, 'osm:hoa-nearest', 'hoa'),
  cameraNorthOf(240, 'osm:private', 'private'),
  cameraNorthOf(400, 'osm:police-a', 'police'),
  cameraNorthOf(520, 'osm:police-b', 'police'),
  cameraNorthOf(700, 'osm:unrecorded', undefined),
];

function putCameras(cameras: readonly CameraRecord[]): void {
  useCamerasStore.getState().putTiles([
    {
      ref: { z: 11, x: 484, y: 783 },
      cameras,
      fetchedAtMs: FIX.timestampMs,
      freshness: 'fresh',
      source: 'network',
    },
  ]);
}

/**
 * A live drive: cameras cached, a fix on the position store, one engine tick.
 *
 * The loop is returned so a test can tick it AGAIN. That matters: a leak of the
 * drawing filter into a memo keyed on `[assessments]` is invisible until the
 * next tick recomputes it, so a test that only re-renders would pass over a
 * defect that a driver would meet a second later.
 */
function drive(): AlertLoop {
  putCameras(AHEAD);
  positionActions.ingestFix({
    lat: FIX.lat,
    lon: FIX.lon,
    accuracyM: FIX.accuracyM,
    altitudeM: null,
    altitudeAccuracyM: null,
    headingDeg: FIX.headingDeg,
    speedMps: FIX.speedMps,
    // `GeoFix` stamps `timestamp`; the engine's own fix stamps `timestampMs`.
    // Two names for one instant, and `vitest run` does not typecheck, so the
    // wrong one runs green here and fails the build.
    timestamp: FIX.timestampMs,
  });
  const loop = loopUnderTest();
  loop.tick(FIX);
  return loop;
}

/** The panel, which is only in the accessibility tree while it is open. */
function panel(): HTMLElement {
  return screen.getByRole('group', { name: 'map' });
}

/** The rail key that opens it. Named by state, so it is matched loosely. */
function mapKey(): HTMLElement {
  return screen.getByRole('button', { name: /^Map:/ });
}

/** The secondary cartography disclosure inside the open map panel. */
function mapViewDisclosure(): HTMLDetailsElement {
  const details = within(panel()).getByText(MAP_PANEL_VIEWS).closest('details');
  if (!(details instanceof HTMLDetailsElement)) throw new Error('MAP VIEW disclosure is missing');
  return details;
}

/** The card's own MAP DRAWS row, which is the second opener for the panel. */
function drawsRow(): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${DRIVE_DRAWS}`) });
}

/**
 * THE CARD'S WARNING TEXT - everything on the card except the MAP DRAWS row.
 *
 * That row is the ONE part of the card the drawing filter is supposed to
 * change: it names the current selection and, when a class is hidden, carries
 * the sentence saying so. Everything around it - the distance, the owner chip,
 * the route count, the ETA, the queue - is derived from the assessments and
 * must not move by a character.
 *
 * Comparing the whole card would therefore be a test that fails for the right
 * reason and the wrong reason indistinguishably. Cutting the row out keeps this
 * comparison about the FIGURES; the row has its own tests below, and they
 * assert it changed.
 */
function cardWarningText(container: HTMLElement): string {
  const card = container.querySelector('.fwm-drive-closest');
  if (card === null) throw new Error('no closest card was rendered');
  const withoutTheRow = card.cloneNode(true) as HTMLElement;
  const row = withoutTheRow.querySelector('.fwm-drive-draws');
  if (row === null) throw new Error('the MAP DRAWS row is missing from the card');
  row.remove();
  return withoutTheRow.textContent ?? '';
}

afterEach(() => {
  // Loops before stores, or a leaked subscription re-ticks into the next test.
  while (started.length > 0) started.pop()?.stop();
  useAlertStore.getState().reset();
  useCamerasStore.getState().reset();
  usePositionStore.getState().reset();
  useSettingsStore.getState().reset();
  vi.restoreAllMocks();
});

/*
 * THE MAP-HANDOFF CASE THAT USED TO BE HERE HAS MOVED, AND REVERSED.
 *
 * `the DRIVE map handoff > offers no route key on an iPhone` asserted that the
 * primary key was absent under an iPhone user agent, because the key called
 * `navigateTo`, iOS does not register `geo:`, and the only fallback would have
 * been an unannounced HTTPS request.
 *
 * The key does not call `navigateTo` any more. It plans a multi-stop detour and
 * asks before handing it over, and no URI scheme carries waypoints - so the
 * handoff is an HTTPS request on every platform and is announced on every
 * platform. Withholding the key from iPhone drivers would no longer protect
 * anybody. The reversal, with the full argument, is
 * `DriveScreen.detour.test.tsx > the route key on an iPhone`.
 */

/**
 * Open the closest card, because it now OPENS COLLAPSED.
 *
 * `cardMini` defaults to `true` by owner decision, and the collapsed card
 * deliberately drops the keys, the queue and the MAP DRAWS row - it keeps the
 * distance and the owner and nothing else. Those controls are `hidden`, so
 * `getByRole` cannot see them, which is correct: a hidden control is not
 * available to a user either.
 *
 * The tests that are ABOUT one of those controls call this first, as a
 * precondition rather than as part of what is under test. The one below that is
 * about the SHRUNK card deliberately does not - it starts in the state it is
 * testing and no longer has to click its way there.
 */
function expandCard(): void {
  /*
   * TOLERANT OF THERE BEING NO CARD, which is a real state and not a mistake:
   * several tests in this file are about the map control panel or the rail key
   * and run with nothing in range, so no closest card is drawn and there is
   * nothing to expand. `queryByRole` rather than `getByRole` so those tests do
   * not fail on a precondition they have no interest in - and this stays a
   * precondition helper rather than quietly becoming an assertion that a card
   * exists. The tests that need the card assert on its contents directly.
   */
  const key = screen.queryByRole('button', { name: DRIVE_CARD_EXPAND });
  if (key !== null) fireEvent.click(key);
}

describe('the DRIVE map panel', () => {
  it('is shut until the rail key is pressed, and shuts again on the next press', () => {
    render(<DriveScreen />);
    expandCard();

    expect(screen.queryByRole('group', { name: 'map' })).not.toBeInTheDocument();
    expect(mapKey()).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(mapKey());
    expect(panel()).toBeInTheDocument();
    expect(mapKey()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(mapKey());
    expect(screen.queryByRole('group', { name: 'map' })).not.toBeInTheDocument();
  });

  it('shuts on Escape, because there is no scrim to tap', () => {
    render(<DriveScreen />);
    expandCard();
    fireEvent.click(mapKey());
    expect(panel()).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'map' })).not.toBeInTheDocument();
  });

  it('offers all five owner classes plus everything, counted off the cached archive', () => {
    drive();
    render(<DriveScreen />);
    expandCard();
    fireEvent.click(mapKey());

    // A `<section>` with an accessible name is a `region`, not a group.
    const draws = within(panel()).getByRole('region', { name: 'what the map draws' });

    // Five classes, not the three a first reading of the brief gives: Look up
    // already offers all five, and only `null` includes the unrecorded ones.
    expect(within(draws).getByRole('button', { name: /All owners/ })).toHaveTextContent('5');
    expect(within(draws).getByRole('button', { name: /POLICE \/ AGENCY/ })).toHaveTextContent('2');
    expect(within(draws).getByRole('button', { name: /HOA \/ NEIGHBORHOOD/ })).toHaveTextContent(
      '1',
    );
    expect(within(draws).getByRole('button', { name: /PRIVATE \/ BUSINESS/ })).toHaveTextContent(
      '1',
    );
    // The unrecorded camera is in the ALL count and in no class count. Absence
    // of an assertion is not the `unverified` assertion.
    expect(within(draws).getByRole('button', { name: /UNVERIFIED REPORTS/ })).toHaveTextContent(
      '0',
    );
    expect(within(draws).getByRole('button', { name: /INTER-AGENCY SHARED/ })).toHaveTextContent(
      '0',
    );
  });

  it('starts on all owners every session, and never persists the choice', () => {
    render(<DriveScreen />);
    expandCard();
    fireEvent.click(mapKey());

    expect(
      within(panel()).getByRole('button', { name: new RegExp(MAP_PANEL_ALL) }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(useSettingsStore.getState().mapOwnerFilter).toBeNull();
  });

  it('sets the drawing filter from a row, and shuts so the map can be seen', () => {
    drive();
    render(<DriveScreen />);
    expandCard();
    fireEvent.click(mapKey());

    fireEvent.click(within(panel()).getByRole('button', { name: /POLICE \/ AGENCY/ }));

    expect(useSettingsStore.getState().mapOwnerFilter).toBe('police');
    expect(screen.queryByRole('group', { name: 'map' })).not.toBeInTheDocument();
  });

  it('changes the cartography without shutting, because that is a comparison', () => {
    render(<DriveScreen />);
    expandCard();
    fireEvent.click(mapKey());

    // Secondary until deliberately requested: it no longer makes the panel a
    // tall scrolling list when somebody opened it to filter owners.
    expect(mapViewDisclosure()).not.toHaveAttribute('open');
    fireEvent.click(within(panel()).getByText(MAP_PANEL_VIEWS));

    fireEvent.click(within(panel()).getByRole('button', { name: /Greyscale/ }));

    expect(useSettingsStore.getState().mapView).toBe('grayscale');
    // Still open: the reason the old control was a cycle at all was flipping
    // between two flavours to compare them, and closing after every press puts
    // the key back between the driver and the next one.
    expect(panel()).toBeInTheDocument();
  });

  it('says the filter is display-only whatever is selected', () => {
    drive();
    render(<DriveScreen />);
    expandCard();

    fireEvent.click(mapKey());
    expect(within(panel()).getByText(MAP_PANEL_DISPLAY_ONLY)).toBeInTheDocument();
    expect(within(panel()).getByText(MAP_PANEL_ZOOM_CAVEAT)).toBeInTheDocument();

    // And with a class hidden, which is the moment it matters.
    fireEvent.click(within(panel()).getByRole('button', { name: /POLICE \/ AGENCY/ }));
    fireEvent.click(mapKey());
    expect(within(panel()).getByText(MAP_PANEL_DISPLAY_ONLY)).toBeInTheDocument();
  });

  it('carries the still-alerting fact on the key itself, for a screen reader', () => {
    render(<DriveScreen />);
    expandCard();

    expect(mapKey()).toHaveAccessibleName('Map: Match theme');

    act(() => {
      useSettingsStore.getState().setMapOwnerFilter('hoa');
    });
    // "plus the two closest" is not padding. The two nearest cameras keep their
    // markers whatever the filter says (`MapCanvas` drives them off `labelled`,
    // not off the filtered source), so a driver who filters to HOA and then
    // sees a police reader on the map has been told why in advance rather than
    // left to assume the filter is broken.
    expect(mapKey()).toHaveAccessibleName(
      'Map: Match theme, drawing HOA / NEIGHBORHOOD only, plus the two closest. ' +
        'all cameras still alerting.',
    );
  });
});

/**
 * THE ONE THAT FAILS IF ANYBODY WIRES THE FILTER INTO THE ENGINE.
 *
 * Everything the driver is warned by is on the closest card: the big distance,
 * the owner chip, "Route around all N", the queue. Every one of them derives
 * from the assessments, which are computed over ALL cameras. The filter selects
 * a class the nearest camera does not belong to, so a leak moves the nearest
 * camera from 90 m away to 400 m away and this comparison goes red.
 */
describe('the drive card under a drawing filter', () => {
  it('is byte-identical with a filter on that hides its own nearest camera', () => {
    const loop = drive();
    const view = render(<DriveScreen />);
    expandCard();

    // Open the queue first, so the comparison covers the whole list and not
    // just the three dots the shut state shows.
    fireEvent.click(screen.getByRole('button', { name: /more$/ }));
    const before = cardWarningText(view.container);
    expect(before).toBeTruthy();
    // The fixture is only meaningful if the card is about the HOA reader.
    // The card's chip is `chipLabel`'s short form, not the panel's row label.
    expect(before).toContain('HOA');
    expect(before).toContain('Route around all 5');

    act(() => {
      useSettingsStore.getState().setMapOwnerFilter('police');
      // The SECOND tick is the point. The card is built out of memos keyed on
      // the assessments, so a filter that had leaked into one of them would
      // still be showing the old, correct figures until something recomputed.
      // Same position, same speed, so every figure must land the same.
      loop.tick({ ...FIX, timestampMs: FIX.timestampMs + 2_000 });
    });

    expect(cardWarningText(view.container)).toBe(before);
    // And the camera the map has just stopped drawing is still the one being
    // warned about. That combination IS the safety property.
    expect(useCamerasStore.getState().nearest?.id).toBe('osm:hoa-nearest');
    // The one thing that DID move is the disclosure, which is the point of it.
    expect(drawsRow().textContent).toContain(DRIVE_DRAWS_STILL);
  });
});

/**
 * THE MAP DRAWS ROW - the disclosure, on the surface a driver already reads.
 *
 * Choosing an owner class shuts the panel, so without this row the sentence
 * explaining the hiding leaves the screen at the moment the hiding starts. The
 * tests here are about that sentence being present when it has to be, absent
 * when there is nothing to disown, and about the row being a second door to the
 * same panel rather than a second implementation of the filter.
 */
describe('the MAP DRAWS row on the drive card', () => {
  it('names the current selection, and says nothing further while nothing is hidden', () => {
    drive();
    render(<DriveScreen />);
    expandCard();

    const row = drawsRow();
    expect(row.textContent).toContain(DRIVE_DRAWS_ALL);
    // No sentence, because there is nothing yet to explain: the row's own value
    // already reads `all owners`. A disclaimer under a filter that is not
    // filtering trains a driver to stop reading it.
    expect(row.textContent).not.toContain(DRIVE_DRAWS_STILL);
    expect(screen.queryByText(DRIVE_DRAWS_STILL)).toBeNull();
  });

  it('names the hidden class and says the hiding is display-only', () => {
    drive();
    render(<DriveScreen />);
    expandCard();

    act(() => {
      useSettingsStore.getState().setMapOwnerFilter('police');
    });

    const row = drawsRow();
    // `OWNER_LABELS.police`, the same words the panel's own row carries.
    expect(row.textContent).toContain('POLICE / AGENCY');
    expect(row.textContent).toContain(DRIVE_DRAWS_STILL);
    // Said once, not twice: the value beside it already names the class, and
    // the sentence deliberately does not repeat it.
    expect(row.textContent?.match(/POLICE \/ AGENCY/g)).toHaveLength(1);
  });

  it('opens the same panel the rail key opens, and the key knows it is open', () => {
    drive();
    render(<DriveScreen />);
    expandCard();

    expect(screen.queryByRole('group', { name: 'map' })).toBeNull();
    expect(drawsRow().getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(drawsRow());

    // ONE panel, reached from two places. A second panel here would be a second
    // place the display-only sentence has to be kept true.
    expect(within(panel()).getByText(MAP_PANEL_DISPLAY_ONLY)).toBeTruthy();
    expect(drawsRow().getAttribute('aria-expanded')).toBe('true');
    expect(mapKey().getAttribute('aria-expanded')).toBe('true');

    // And it shuts from the row it opened from.
    fireEvent.click(drawsRow());
    expect(screen.queryByRole('group', { name: 'map' })).toBeNull();
  });

  it('sets nothing itself - the panel owns the filter', () => {
    drive();
    render(<DriveScreen />);
    expandCard();

    fireEvent.click(drawsRow());
    expect(useSettingsStore.getState().mapOwnerFilter).toBeNull();

    // The row is a door. Picking the class is still the panel's job, so there
    // is exactly one component in the app that writes this value.
    fireEvent.click(within(panel()).getByRole('button', { name: /HOA/ }));
    expect(useSettingsStore.getState().mapOwnerFilter).toBe('hoa');
    expect(drawsRow().textContent).toContain(DRIVE_DRAWS_STILL);
  });

  it('goes away with the rest of the controls when the card is shrunk', () => {
    drive();
    render(<DriveScreen />);

    act(() => {
      useSettingsStore.getState().setMapOwnerFilter('police');
    });

    /*
     * NO CLICK TO SHRINK, and no `expandCard()` either: the card OPENS
     * collapsed now, so this test begins in the state it is about.
     *
     * WHAT THIS DID BEFORE: expanded was the default, so it asserted the row
     * was present, clicked `DRIVE_CARD_MINI` to shrink, and asserted the row
     * had gone. The first assertion has moved to the sibling tests above, which
     * expand explicitly; what is left here is the half that still means
     * something - that the collapsed card carries no MAP DRAWS row while the
     * rail key still carries the fact.
     */
    expect(screen.getByRole('button', { name: DRIVE_CARD_EXPAND })).toBeTruthy();

    // The mini card keeps the distance and the owner and drops every control,
    // this one included. The rail key still carries the fact - see the key's
    // accessible name - so the filter is not silent, it is just not restating
    // itself inside a card the driver has deliberately made smaller.
    expect(screen.queryByRole('button', { name: new RegExp(`^${DRIVE_DRAWS}`) })).toBeNull();
    expect(mapKey().getAttribute('aria-label')).toContain('all cameras still alerting');
  });
});
