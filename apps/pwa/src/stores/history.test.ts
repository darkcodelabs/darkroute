import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MAX_HISTORY_ENTRIES } from './fwmCore.ts';
import { historyActions, useHistoryStore, type NewAlertLogEntry } from './history.ts';

function entry(overrides: Partial<NewAlertLogEntry> = {}): NewAlertLogEntry {
  return {
    cameraId: 'FWM-0442',
    label: 'Vine St & 7th',
    atMs: 1_000_000,
    state: 'in_range',
    previousState: 'approaching',
    distanceFt: 380,
    speedMph: 47,
    headingDeg: 41,
    muted: false,
    ...overrides,
  };
}

beforeEach(() => {
  historyActions.reset();
});

describe('the timeline', () => {
  it('records newest first and hands back a local id', () => {
    const first = historyActions.record(entry({ atMs: 1_000_000 }));
    const second = historyActions.record(entry({ atMs: 1_002_000, cameraId: 'FWM-0118' }));
    expect(second).not.toBe(first);
    expect(useHistoryStore.getState().entries.map((row) => row.cameraId)).toEqual([
      'FWM-0118',
      'FWM-0442',
    ]);
  });

  it('records a transition with no camera, because those happen', () => {
    historyActions.record(entry({ cameraId: null, state: 'clear', previousState: 'in_range' }));
    expect(useHistoryStore.getState().entries[0]?.cameraId).toBeNull();
  });

  it('writes the mute down without acting on it', () => {
    // A muted alert is still an alert that occurred.
    historyActions.record(entry({ muted: true }));
    expect(useHistoryStore.getState().entries).toHaveLength(1);
    expect(useHistoryStore.getState().entries[0]?.muted).toBe(true);
  });

  it('carries no coordinate, on purpose', () => {
    historyActions.record(entry());
    const row = useHistoryStore.getState().entries[0];
    expect(Object.keys(row ?? {})).not.toContain('lat');
    expect(Object.keys(row ?? {})).not.toContain('lon');
  });

  it('caps at the engine’s history limit rather than growing forever', () => {
    for (let i = 0; i < DEFAULT_MAX_HISTORY_ENTRIES + 25; i++) {
      historyActions.record(entry({ atMs: 1_000_000 + i }));
    }
    expect(useHistoryStore.getState().entries).toHaveLength(DEFAULT_MAX_HISTORY_ENTRIES);
  });

  it('marks CONF / DISM against one row only', () => {
    const id = historyActions.record(entry());
    historyActions.record(entry({ cameraId: 'FWM-0118' }));
    historyActions.setOutcome(id, 'confirmed');
    const rows = useHistoryStore.getState().entries;
    expect(rows.find((row) => row.id === id)?.outcome).toBe('confirmed');
    expect(rows.find((row) => row.id !== id)?.outcome).toBeNull();
  });
});

describe('exposure', () => {
  it('counts passes and unique cameras the way FLOCKED TODAY reads', () => {
    historyActions.rollDay(1_000_000);
    historyActions.notePass('FWM-0442');
    historyActions.notePass('FWM-0118');
    historyActions.notePass('FWM-0442');
    const today = useHistoryStore.getState().today;
    expect(today.passes).toBe(3);
    expect(today.uniqueCameraIds).toHaveLength(2);
  });

  it('rolls the day over without touching the timeline', () => {
    historyActions.rollDay(1_000_000);
    historyActions.notePass('FWM-0442');
    historyActions.record(entry());
    historyActions.rollDay(1_086_400_000);
    expect(useHistoryStore.getState().today.passes).toBe(0);
    expect(useHistoryStore.getState().entries).toHaveLength(1);
  });

  it('accumulates a trip’s distance and camera list', () => {
    historyActions.startTrip(1_000_000);
    historyActions.notePass('FWM-0442', 0.4);
    historyActions.notePass('FWM-0442', 0.8);
    historyActions.endTrip(1_600_000);
    const trip = useHistoryStore.getState().trip;
    expect(trip?.exposureCount).toBe(2);
    expect(trip?.cameraIdsPassed).toEqual(['FWM-0442']);
    expect(trip?.distanceMi).toBeCloseTo(1.2, 6);
    expect(trip?.endedAtMs).toBe(1_600_000);
  });
});

describe('hydration from the durable copy', () => {
  it('keeps the local id counter ahead of what it loaded', () => {
    historyActions.hydrate(
      [
        {
          id: 41,
          cameraId: 'FWM-0442',
          label: 'Reading Rd',
          atMs: 900_000,
          state: 'in_range',
          previousState: 'approaching',
          distanceFt: 760,
          speedMph: 38,
          headingDeg: null,
          muted: false,
          outcome: 'dismissed',
        },
      ],
      1284,
      1_700_000_000_000,
    );
    expect(useHistoryStore.getState().allTimePasses).toBe(1284);
    const next = historyActions.record(entry());
    expect(next).toBeGreaterThan(41);
  });
});
