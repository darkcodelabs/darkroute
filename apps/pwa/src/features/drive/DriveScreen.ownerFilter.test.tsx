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
import { VIEW_ANGLE, VIEW_FULLSCREEN } from '../map/MapViewPanel.tsx';
import { CHIPS } from '../chrome/Chips.tsx';

/**
 * THE CHIP THAT OPENS MAP VIEW, named by the row's own list.
 *
 * `SearchPills` and its `PILL_MAP_VIEW` are gone -- the row under the bar is
 * `features/chrome/Chips.tsx` now -- and the word is unchanged, `Map view`,
 * one capital. Read off `CHIPS` rather than restated so this fails if the chip
 * is renamed or removed rather than silently matching a stale string.
 */
const PILL_MAP_VIEW: string =
  CHIPS.find((chip) => chip.id === 'map-view')?.label ?? 'no map-view chip in CHIPS';
import {
  MAP_PANEL_ALL,
  MAP_PANEL_DISPLAY_ONLY,
  PANEL_THEME,
} from '../map/MapControlPanel.tsx';

import {
  DRIVE_CARD_EXPAND,
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

/**
 * The menu row a piece of text sits in.
 *
 * Needed because the CHOSEN owner row is a `<div>`: `Menu.tsx`'s select row
 * states the current choice rather than offering it, so there is no role to
 * ask for and the label is the only handle on it. The five rows it is not are
 * ordinary buttons and are still addressed by role.
 */
function rowOf(node: HTMLElement): HTMLElement {
  const row = node.closest('.fwm-menu-row');
  expect(row, `no menu row around ${node.textContent ?? ''}`).not.toBeNull();
  return row as HTMLElement;
}

/** The rail key that opens it. Named by state, so it is matched loosely. */
function mapKey(): HTMLElement {
  return screen.getByRole('button', { name: /^Map:/ });
}

/** The MAP VIEW panel, and the pill that opens it. */
function viewPanel(): HTMLElement {
  return screen.getByRole('group', { name: 'map view' });
}

function viewPill(): HTMLElement {
  return screen.getByRole('button', { name: PILL_MAP_VIEW });
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

    /*
     * A GROUP, NOT A REGION, and the name is the half that matters. The
     * `<section aria-label>` this panel used to draw announced as a region;
     * `MenuGroup` announces as a group. What it is FOR is unchanged - it says
     * the six rows under it are six answers to one question - so this asks for
     * it by the role the menu language actually renders rather than dropping
     * the assertion.
     */
    const draws = within(panel()).getByRole('group', { name: 'what the map draws' });

    /*
     * THE CHOSEN ROW IS STATED, NOT OFFERED, so it is not a button. `Menu.tsx`
     * gives the select row no `cursor: pointer` and no press on purpose - the
     * alternatives beside it are the pressable filter rows - so the current
     * choice is read here by its text and its row type instead.
     */
    const all = rowOf(within(draws).getByText(MAP_PANEL_ALL));
    expect(all).toHaveAttribute('data-fwm-row', 'select');
    expect(all).toHaveTextContent('5');

    // Five classes, not the three a first reading of the brief gives: Look up
    // already offers all five, and only `null` includes the unrecorded ones.
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

    /*
     * THE SELECT ROW IS WHERE `aria-pressed` WENT. This panel used to press one
     * of six rows; the menu language fills exactly one row with accent and that
     * row IS the current choice - "one selection, ever" - so the assertion is
     * the same fact read off the language's own marker, plus the count that
     * makes it a rule rather than a coincidence.
     */
    expect(rowOf(within(panel()).getByText(MAP_PANEL_ALL))).toHaveAttribute(
      'data-fwm-row',
      'select',
    );
    expect(panel().querySelectorAll('[data-fwm-row="select"]')).toHaveLength(1);
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

  /**
   * AND BACK TO EVERYTHING, which is the half the select row cannot do itself.
   *
   * The row that states the current choice is deliberately not pressable, so
   * the way back out of a narrowed map is `All owners` becoming a FILTER row
   * the moment it stops being the answer. Without that swap a driver who chose
   * one class could never widen the map again from this panel - and the count
   * that would have told them why it is empty is inside it.
   */
  it('hands All owners back as a pressable row once a class is chosen', () => {
    drive();
    render(<DriveScreen />);
    expandCard();
    fireEvent.click(mapKey());
    fireEvent.click(within(panel()).getByRole('button', { name: /POLICE \/ AGENCY/ }));

    fireEvent.click(mapKey());
    // The chosen class has taken the select row, and it is the only one.
    expect(rowOf(within(panel()).getByText('POLICE / AGENCY'))).toHaveAttribute(
      'data-fwm-row',
      'select',
    );
    expect(panel().querySelectorAll('[data-fwm-row="select"]')).toHaveLength(1);

    fireEvent.click(within(panel()).getByRole('button', { name: new RegExp(MAP_PANEL_ALL) }));
    expect(useSettingsStore.getState().mapOwnerFilter).toBeNull();
  });

  /*
   * The cartography list left this panel. Six rows of prose for a choice made
   * once was most of a small panel, and every one of those rows already exists
   * in SETTINGS beside the palette - so the panel points there instead of
   * carrying a second copy that can drift from the first.
   */
  it('sends you to settings for the theming rather than duplicating it', () => {
    render(<DriveScreen />);
    expandCard();
    fireEvent.click(mapKey());

    expect(within(panel()).queryByRole('button', { name: /Greyscale/ })).not.toBeInTheDocument();

    fireEvent.click(within(panel()).getByRole('button', { name: new RegExp(PANEL_THEME) }));

    // It shuts: the answer is on another screen, and a panel left open behind
    // one is a shut panel stranded over the map.
    expect(screen.queryByRole('group', { name: 'map' })).not.toBeInTheDocument();
  });

  /*
   * FULL SCREEN AND THE ANGLE MOVED, and these two tests moved with them.
   *
   * Both were 48px keys in the rail once - the column a thumb reaches while
   * moving, spent on states set once a drive and then forgotten - then rows in
   * the LAYERS panel, and they are now in MAP VIEW with the rest of the
   * settings about how the map behaves. The guarantee is unchanged and is what
   * these still assert: both are reachable, and changing one does not shut the
   * panel you are reading.
   */
  it('carries full screen and the map angle under map view, not under layers', () => {
    render(<DriveScreen />);
    expandCard();
    fireEvent.click(viewPill());

    expect(
      within(viewPanel()).getByRole('switch', { name: new RegExp(VIEW_FULLSCREEN) }),
    ).toBeInTheDocument();
    expect(
      within(viewPanel()).getByRole('button', { name: new RegExp(VIEW_ANGLE) }),
    ).toBeInTheDocument();

    // And they are NOT in the layers panel any more - a setting in two places
    // is two switches to keep in step.
    fireEvent.click(mapKey());
    expect(
      within(panel()).queryByRole('switch', { name: new RegExp(VIEW_FULLSCREEN) }),
    ).not.toBeInTheDocument();
  });

  it('changes the map angle without shutting the panel', () => {
    render(<DriveScreen />);
    expandCard();
    fireEvent.click(viewPill());

    const before = useSettingsStore.getState().mapTilt;
    fireEvent.click(within(viewPanel()).getByRole('button', { name: new RegExp(VIEW_ANGLE) }));

    expect(useSettingsStore.getState().mapTilt).not.toBe(before);
    // Still open: you look at the result of tilting the map.
    expect(viewPanel()).toBeInTheDocument();
  });

  it('opens one panel at a time, because two glass sheets over one corner is unreadable', () => {
    render(<DriveScreen />);
    expandCard();

    fireEvent.click(mapKey());
    expect(panel()).toBeInTheDocument();

    fireEvent.click(viewPill());
    expect(viewPanel()).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'map' })).not.toBeInTheDocument();
  });

  it('says the filter is display-only whatever is selected', () => {
    drive();
    render(<DriveScreen />);
    expandCard();

    fireEvent.click(mapKey());
    expect(within(panel()).getByText(MAP_PANEL_DISPLAY_ONLY)).toBeInTheDocument();

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
/*
 * TWO BLOCKS RETIRED HERE, and what they covered did not go with them.
 *
 * "the drive card under a drawing filter" and "the MAP DRAWS row on the drive
 * card" both tested a row that lived ON the closest-camera card: it named the
 * owner filter and opened the map panel. By owner decision the screen now shows
 * exactly one card per mode, with no controls of that kind on it - the drawing
 * filter is the LAYERS pill's panel and nothing else.
 *
 * The guarantees are not lost. The filter is display-only and every camera
 * keeps alerting; that is asserted directly against the panel in the blocks
 * above, which is where the control actually is. Re-pointing these at the pill
 * would have been two more tests of the same panel wearing the old names.
 */

/**
 * THE MAP DRAWS ROW - the disclosure, on the surface a driver already reads.
 *
 * Choosing an owner class shuts the panel, so without this row the sentence
 * explaining the hiding leaves the screen at the moment the hiding starts. The
 * tests here are about that sentence being present when it has to be, absent
 * when there is nothing to disown, and about the row being a second door to the
 * same panel rather than a second implementation of the filter.
 */
