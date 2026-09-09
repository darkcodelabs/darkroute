/**
 * TRIAGE's arithmetic and strings, against what `B4 · ALERT TRIAGE - BY OWNER
 * TYPE` draws.
 *
 * The subject of most of these is the ONE rule this screen prints on itself:
 * a switch removes an alert and nothing else. The baseline figure, the row
 * captions and the pass counts must all be blind to both the switches and the
 * mute state.
 */

import { describe, expect, it } from 'vitest';

import type { AlertLogEntry, CameraOwnerType } from '../../stores';

import {
  OWNER_LABELS,
  RE_ALERT_OFF_FT,
  TRIAGE_OWNER_TYPES,
  formatProjection,
  isReAlertOn,
  ownerCaption,
  ownerCountIsResolvable,
  ownersAreResolvable,
  projectAlerts,
  projectionLines,
  reAlertCaption,
  summariseOwners,
} from './triage.ts';
import type { OwnerLookup } from './triage.ts';

const ALL_ON: Readonly<Record<CameraOwnerType, boolean>> = {
  police: true,
  inter_agency: true,
  hoa: true,
  private: true,
  unverified: true,
};

let nextId = 1;

/** One recorded camera pass. `muted` defaults to false and is never read. */
function pass(cameraId: string, over: Partial<AlertLogEntry> = {}): AlertLogEntry {
  return {
    id: nextId++,
    cameraId,
    label: null,
    atMs: 0,
    state: 'in_range',
    previousState: 'clear',
    distanceFt: null,
    speedMph: null,
    headingDeg: null,
    muted: false,
    outcome: null,
    ...over,
  };
}

/** A device that knows every camera's owner class. */
function knows(owners: Readonly<Record<string, CameraOwnerType>>): OwnerLookup {
  return (cameraId) => owners[cameraId] ?? null;
}

describe('the row labels and captions are the panel"s', () => {
  it('names the five classes in the order B4 draws them', () => {
    expect(TRIAGE_OWNER_TYPES.map((owner) => OWNER_LABELS[owner])).toEqual([
      'POLICE / AGENCY',
      'INTER-AGENCY SHARED',
      'HOA / NEIGHBORHOOD',
      'PRIVATE / BUSINESS',
      'UNVERIFIED REPORTS',
    ]);
  });

  it('prints the three descriptive captions verbatim', () => {
    const empty = summariseOwners([], knows({}));
    expect(ownerCaption('inter_agency', empty)).toBe('any owner, shared feed');
    expect(ownerCaption('private', empty)).toBe('retail lots, storage');
    expect(ownerCaption('unverified', empty)).toBe('1 confirmation only');
  });

  it('prints an em dash for the agency count nothing in this product measures', () => {
    const empty = summariseOwners([], knows({}));
    expect(ownerCaption('police', empty)).toBe('shared to — agencies');
  });

  it('counts distinct HOA cameras out of the recorded log for the routes caption', () => {
    const owners = knows({ 'cam-1': 'hoa', 'cam-2': 'hoa', 'cam-3': 'police' });
    // cam-1 twice: the same camera on two drives is still one camera.
    const summary = summariseOwners([pass('cam-1'), pass('cam-2'), pass('cam-1'), pass('cam-3')], owners);
    expect(ownerCaption('hoa', summary)).toBe('2 on your usual routes');
  });

  it('prints an em dash rather than zero when no camera record can be resolved', () => {
    const summary = summariseOwners([pass('cam-1'), pass('cam-2')], knows({}));
    expect(ownersAreResolvable(summary)).toBe(false);
    expect(ownerCaption('hoa', summary)).toBe('— on your usual routes');
  });

  it('prints zero when the log genuinely is empty', () => {
    const summary = summariseOwners([], knows({}));
    expect(ownersAreResolvable(summary)).toBe(true);
    expect(ownerCaption('hoa', summary)).toBe('0 on your usual routes');
  });
});

/**
 * Total eviction is the rare case. Partial eviction -- one tile still held, the
 * rest gone -- is the ordinary one, and it is the case where a per-class zero
 * stops being a fact about the road and becomes a fact about the cache.
 */
describe('a count this device cannot stand behind', () => {
  it('em-dashes a class whose zero could be evicted records rather than empty road', () => {
    // One police camera still on the device; a hundred passes whose tiles are
    // gone. The WHOLE-LOG guard is happy -- something resolved -- so a guard
    // that asked only that question would print `0 on your usual routes` here.
    const passes = [
      pass('cam-police'),
      ...Array.from({ length: 100 }, (_unused, i) => pass(`cam-evicted-${String(i)}`)),
    ];
    const summary = summariseOwners(passes, knows({ 'cam-police': 'police' }));

    expect(ownersAreResolvable(summary)).toBe(true);
    expect(summary.unattributedPasses).toBe(100);
    expect(ownerCountIsResolvable('hoa', summary)).toBe(false);
    expect(ownerCaption('hoa', summary)).toBe('— on your usual routes');
  });

  it('prints the count for a class it did resolve, even beside evicted passes', () => {
    const summary = summariseOwners(
      [pass('cam-hoa'), pass('cam-evicted')],
      knows({ 'cam-hoa': 'hoa' }),
    );

    expect(ownerCountIsResolvable('hoa', summary)).toBe(true);
    // Every camera it names was driven past. It can be a floor; it is not a guess.
    expect(ownerCaption('hoa', summary)).toBe('1 on your usual routes');
  });

  it('prints a real zero when no pass went unattributed', () => {
    const summary = summariseOwners([pass('cam-1'), pass('cam-2')], knows({
      'cam-1': 'police',
      'cam-2': 'private',
    }));

    expect(summary.unattributedPasses).toBe(0);
    expect(ownerCountIsResolvable('hoa', summary)).toBe(true);
    expect(ownerCaption('hoa', summary)).toBe('0 on your usual routes');
  });
});

describe('the projected figure', () => {
  const owners = knows({
    'cam-1': 'police',
    'cam-2': 'hoa',
    'cam-3': 'hoa',
    'cam-4': 'private',
  });
  const passes = [pass('cam-1'), pass('cam-2'), pass('cam-3'), pass('cam-4'), pass('cam-2')];

  it('is every recorded pass when every class is switched on', () => {
    const projection = projectAlerts({
      passes,
      ownerOf: owners,
      enabled: ALL_ON,
      drives: 1,
      driveInProgress: false,
    });
    expect(projection.projected).toBe(5);
    expect(projection.baseline).toBe(5);
  });

  it('drops only the classes that are switched off', () => {
    const projection = projectAlerts({
      passes,
      ownerOf: owners,
      enabled: { ...ALL_ON, hoa: false, private: false },
      drives: 1,
      driveInProgress: false,
    });
    // cam-1 survives; the three HOA passes and the one private pass do not.
    expect(projection.projected).toBe(1);
    expect(projection.filteredPasses).toBe(1);
  });

  it('divides by the number of drives, to the nearest whole alert', () => {
    const projection = projectAlerts({
      passes,
      ownerOf: owners,
      enabled: ALL_ON,
      drives: 2,
      driveInProgress: false,
    });
    expect(projection.baseline).toBe(3);
  });

  it('is null, not zero, when there is no drive to divide by', () => {
    const projection = projectAlerts({
      passes,
      ownerOf: owners,
      enabled: ALL_ON,
      drives: 0,
      driveInProgress: false,
    });
    expect(projection.projected).toBeNull();
    expect(projection.baseline).toBeNull();
    expect(formatProjection(projection.projected)).toBe('—');
  });

  it('keeps alerting on a camera whose owner class this device cannot resolve', () => {
    const projection = projectAlerts({
      passes: [pass('cam-unknown')],
      ownerOf: knows({}),
      enabled: { ...ALL_ON, hoa: false, police: false, private: false, unverified: false, inter_agency: false },
      drives: 1,
      driveInProgress: false,
    });
    expect(projection.projected).toBe(1);
    expect(projection.unattributedPasses).toBe(1);
  });
});

describe('a switch removes the alert and never the record', () => {
  const owners = knows({ 'cam-1': 'police', 'cam-2': 'hoa', 'cam-3': 'hoa' });
  const passes = [pass('cam-1'), pass('cam-2'), pass('cam-3')];

  it('leaves the baseline untouched when every class is switched off', () => {
    const on = projectAlerts({
      passes,
      ownerOf: owners,
      enabled: ALL_ON,
      drives: 1,
      driveInProgress: false,
    });
    const off = projectAlerts({
      passes,
      ownerOf: owners,
      enabled: { police: false, inter_agency: false, hoa: false, private: false, unverified: false },
      drives: 1,
      driveInProgress: false,
    });

    expect(off.projected).toBe(0);
    // The whole point of the card underneath: the record did not move.
    expect(off.baseline).toBe(on.baseline);
    expect(off.totalPasses).toBe(on.totalPasses);
  });

  it('leaves the row captions untouched when the class is switched off', () => {
    // The caption is computed from the log; the switch is not an input to it.
    const summary = summariseOwners(passes, owners);
    expect(ownerCaption('hoa', summary)).toBe('2 on your usual routes');
  });
});

describe('a muted pass counts exactly like an audible one', () => {
  const owners = knows({ 'cam-1': 'police', 'cam-2': 'hoa' });

  it('produces identical figures for an identical drive that was muted', () => {
    const audible = [pass('cam-1'), pass('cam-2')];
    const muted = [pass('cam-1', { muted: true }), pass('cam-2', { muted: true })];
    const input = { ownerOf: owners, enabled: ALL_ON, drives: 1, driveInProgress: false } as const;

    const a = projectAlerts({ passes: audible, ...input });
    const b = projectAlerts({ passes: muted, ...input });

    expect(b.projected).toBe(a.projected);
    expect(b.baseline).toBe(a.baseline);
    expect(summariseOwners(muted, owners)).toEqual(summariseOwners(audible, owners));
  });
});

describe('the caption beside the figure', () => {
  const owners = knows({ 'cam-1': 'police', 'cam-2': 'hoa' });
  const passes = [pass('cam-1'), pass('cam-2')];

  it('reads "down from N" / "with current filters" when the switches remove something', () => {
    const projection = projectAlerts({
      passes,
      ownerOf: owners,
      enabled: { ...ALL_ON, hoa: false },
      drives: 1,
      driveInProgress: false,
    });
    expect(projectionLines(projection)).toEqual(['down from 2', 'with current filters']);
  });

  it('says so instead of comparing a number with itself when nothing is filtered', () => {
    const projection = projectAlerts({
      passes,
      ownerOf: owners,
      enabled: ALL_ON,
      drives: 1,
      driveInProgress: false,
    });
    expect(projectionLines(projection)).toEqual(['nothing filtered out', 'with current filters']);
  });

  it('says there is no drive rather than projecting from nothing', () => {
    const projection = projectAlerts({
      passes,
      ownerOf: owners,
      enabled: ALL_ON,
      drives: 0,
      driveInProgress: false,
    });
    expect(projectionLines(projection)).toEqual(['no drives on record', 'nothing to project yet']);
  });

  it('says a drive with no cameras had no cameras', () => {
    const projection = projectAlerts({
      passes: [],
      ownerOf: owners,
      enabled: ALL_ON,
      drives: 1,
      driveInProgress: false,
    });
    expect(projectionLines(projection)).toEqual(['no cameras this drive', 'nothing to filter yet']);
  });
});

/**
 * The denominator is the one recorded trip, so while that trip is open the hero
 * is a running count of a drive that is still happening. The caption is the
 * only thing standing between that number and the word PROJECTED.
 * GAP: see docs/gaps-inbox/triage.md#drive-count-is-not-in-the-store
 */
describe('the window the figures are counted over', () => {
  const owners = knows({ 'cam-1': 'police', 'cam-2': 'hoa' });
  const passes = [pass('cam-1'), pass('cam-2')];

  it('names the open drive rather than implying a rate over finished drives', () => {
    const projection = projectAlerts({
      passes,
      ownerOf: owners,
      enabled: { ...ALL_ON, hoa: false },
      drives: 1,
      driveInProgress: true,
    });

    expect(projection.driveInProgress).toBe(true);
    expect(projectionLines(projection)).toEqual(['down from 2', 'this drive so far']);
  });

  it('says so when nothing is filtered out of a drive still being driven', () => {
    const projection = projectAlerts({
      passes,
      ownerOf: owners,
      enabled: ALL_ON,
      drives: 1,
      driveInProgress: true,
    });

    expect(projectionLines(projection)).toEqual(['nothing filtered out', 'this drive so far']);
  });

  it('says no cameras YET at the kerb, where the running count reads zero', () => {
    const projection = projectAlerts({
      passes: [],
      ownerOf: owners,
      enabled: ALL_ON,
      drives: 1,
      driveInProgress: true,
    });

    expect(projection.projected).toBe(0);
    expect(projectionLines(projection)).toEqual([
      'no cameras yet this drive',
      'nothing to filter yet',
    ]);
  });

  it('prints the design"s qualifier verbatim once the drive has ended', () => {
    const projection = projectAlerts({
      passes,
      ownerOf: owners,
      enabled: { ...ALL_ON, hoa: false },
      drives: 1,
      driveInProgress: false,
    });

    expect(projectionLines(projection)).toEqual(['down from 2', 'with current filters']);
  });

  it('is never in progress when there is no drive to be in the middle of', () => {
    const projection = projectAlerts({
      passes,
      ownerOf: owners,
      enabled: ALL_ON,
      drives: 0,
      driveInProgress: true,
    });

    expect(projection.driveInProgress).toBe(false);
    expect(projectionLines(projection)).toEqual(['no drives on record', 'nothing to project yet']);
  });
});

describe('the re-alert threshold', () => {
  it('renders the distance B4 states, through RADAR"s formatter', () => {
    expect(reAlertCaption(150)).toBe('closer than 150 ft');
  });

  it('switches off at a distance no mute can be pierced by', () => {
    expect(isReAlertOn(RE_ALERT_OFF_FT)).toBe(false);
    expect(reAlertCaption(RE_ALERT_OFF_FT)).toBe('muted stays muted');
  });

  it('follows RADAR into miles rather than printing four-figure feet', () => {
    expect(reAlertCaption(2640)).toBe('closer than 0.5 mi');
  });
});
