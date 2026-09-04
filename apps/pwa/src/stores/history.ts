/**
 * HISTORY - the LOG screen's memory, in RAM.
 *
 * Three things: the timeline of alerts that actually happened, the trip in
 * progress, and the exposure counters ("FLOCKED TODAY · 12 · CAMERAS · 4
 * UNIQUE", "ALL TIME · 1,284").
 *
 * MUTED ALERTS ARE RECORDED IN FULL
 *   "They still draw on SWEEP in grey, still count in EXPOSURE, still log to
 *   LOOKUP. Muting only removes the alert - never the record."
 * - Flockys Screens II.dc.html, B4
 *   {@link record} therefore does not look at the mute state to decide whether
 *   to append; it only writes it down. There is a test that drives an identical
 *   sequence muted and unmuted and asserts the two histories are the same
 *   length with the same states.
 *
 * PRIVACY
 *   There is no latitude in an entry, on purpose. A trip's exposure is a count,
 *   a distance and a camera id, and none of those need the coordinates that
 *   produced them - a coordinate history IS a movement history. `label` is the
 *   place name the camera record carries ("Vine St & 7th"), which is a property
 *   of the CAMERA, not of the driver.
 *
 *   This slice is never persisted by zustand. The durable copy lives in
 *   IndexedDB (`services/db/repositories/alerts.ts`, `trips.ts`) and is loaded
 *   back through {@link HistoryActions.hydrate}.
 */

import { create } from 'zustand';

import { DEFAULT_MAX_HISTORY_ENTRIES } from './fwmCore.ts';
import { persistAlert } from './historyPersistence.ts';
import type { AlertState } from './fwmCore.ts';

export type { AlertState };

/** What the driver did about an alert, once they did anything. */
export type AlertOutcome = 'confirmed' | 'dismissed';

/**
 * One row of the TIMELINE.
 *
 *   "Vine St & 7th · 14:22:08 · 47 MPH · 380 FT · CONF"
 * - Flockys App Screens.dc.html, 05 · LOG
 */
export interface AlertLogEntry {
  /** Local, monotonic within a session. The durable id is IndexedDB's. */
  readonly id: number;
  /**
   * The camera the transition was about, or null.
   *
   * Null is real: dropping back to `clear` with the nearest camera two miles
   * off is a transition worth recording and there is no camera it is "about".
   */
  readonly cameraId: string | null;
  /** Place name from the camera record, or null when the record has none. */
  readonly label: string | null;
  readonly atMs: number;
  readonly state: AlertState;
  readonly previousState: AlertState;
  readonly distanceFt: number | null;
  readonly speedMph: number | null;
  readonly headingDeg: number | null;
  /** Recorded, never applied. A muted alert is still an alert that occurred. */
  readonly muted: boolean;
  readonly outcome: AlertOutcome | null;
}

/** The drive in progress. `endedAtMs` is null while it is still running. */
export interface TripProgress {
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
  readonly distanceMi: number;
  readonly cameraIdsPassed: readonly string[];
  /** Passes, not cameras: driving the same street twice counts twice. */
  readonly exposureCount: number;
}

/** "FLOCKED TODAY · 12 · CAMERAS · 4 UNIQUE". */
export interface DayExposure {
  /** Epoch ms of local midnight. The app owns the clock and supplies it. */
  readonly dayStartMs: number | null;
  readonly passes: number;
  readonly uniqueCameraIds: readonly string[];
}

export interface HistoryState {
  /** Newest first, capped at `DEFAULT_MAX_HISTORY_ENTRIES`. */
  readonly entries: readonly AlertLogEntry[];
  readonly trip: TripProgress | null;
  readonly today: DayExposure;
  /** "1,284 SINCE MAR 2026". Null until the durable count is loaded. */
  readonly allTimePasses: number | null;
  readonly allTimeSinceMs: number | null;
  /** Bumped on every append, so a list can key off it without deep compare. */
  readonly revision: number;
}

export interface NewAlertLogEntry {
  readonly cameraId: string | null;
  readonly label?: string | null;
  readonly atMs: number;
  readonly state: AlertState;
  readonly previousState: AlertState;
  readonly distanceFt?: number | null;
  readonly speedMph?: number | null;
  readonly headingDeg?: number | null;
  readonly muted: boolean;
}

export interface HistoryActions {
  /** Append one alert. Returns the local id. Mute never gates this. */
  record(entry: NewAlertLogEntry): number;
  setOutcome(id: number, outcome: AlertOutcome): void;
  /** Load the durable copy from IndexedDB over the top of whatever is here. */
  hydrate(entries: readonly AlertLogEntry[], allTimePasses: number | null, sinceMs: number | null): void;
  startTrip(atMs: number): void;
  /** One camera passed. `distanceMi` is the trip odometer delta, from the loop. */
  notePass(cameraId: string, distanceMi?: number): void;
  endTrip(atMs: number): void;
  /** Roll the "today" counters over to a new local day. The app owns the clock. */
  rollDay(dayStartMs: number): void;
  /** "Clear alert log" - destructive, and the durable copy is cleared separately. */
  clear(): void;
  reset(): void;
}

export type HistoryStore = HistoryState & HistoryActions;

const NO_ENTRIES: readonly AlertLogEntry[] = Object.freeze([]);
const NO_IDS: readonly string[] = Object.freeze([]);

const EMPTY_DAY: DayExposure = Object.freeze({
  dayStartMs: null,
  passes: 0,
  uniqueCameraIds: NO_IDS,
});

const INITIAL_STATE: HistoryState = Object.freeze({
  entries: NO_ENTRIES,
  trip: null,
  today: EMPTY_DAY,
  allTimePasses: null,
  allTimeSinceMs: null,
  revision: 0,
});

export function createHistoryStore() {
  let nextId = 1;

  return create<HistoryStore>()((set, get) => ({
    ...INITIAL_STATE,

    record(entry) {
      const id = nextId++;
      const full: AlertLogEntry = {
        id,
        cameraId: entry.cameraId,
        label: entry.label ?? null,
        atMs: entry.atMs,
        state: entry.state,
        previousState: entry.previousState,
        distanceFt: entry.distanceFt ?? null,
        speedMph: entry.speedMph ?? null,
        headingDeg: entry.headingDeg ?? null,
        muted: entry.muted,
        outcome: null,
      };
      const state = get();
      const entries = [full, ...state.entries].slice(0, DEFAULT_MAX_HISTORY_ENTRIES);
      set({ entries, revision: state.revision + 1 });
      // WRITE THROUGH, not awaited. This runs on the alert path, on every
      // position fix, so storage latency must never sit between a camera
      // coming into range and the driver being told. See
      // `historyPersistence.ts` for why there is no batching.
      persistAlert(full);
      return id;
    },

    setOutcome(id, outcome) {
      const state = get();
      let changed = false;
      const entries = state.entries.map((entry) => {
        if (entry.id !== id || entry.outcome === outcome) return entry;
        changed = true;
        return { ...entry, outcome };
      });
      if (!changed) return;
      set({ entries, revision: state.revision + 1 });
    },

    hydrate(entries, allTimePasses, sinceMs) {
      // Keep the local id counter ahead of anything loaded, so a session that
      // hydrates and then records cannot collide with a restored id.
      for (const entry of entries) if (entry.id >= nextId) nextId = entry.id + 1;
      set({
        entries: [...entries].slice(0, DEFAULT_MAX_HISTORY_ENTRIES),
        allTimePasses,
        allTimeSinceMs: sinceMs,
        revision: get().revision + 1,
      });
    },

    startTrip(atMs) {
      set({
        trip: {
          startedAtMs: atMs,
          endedAtMs: null,
          distanceMi: 0,
          cameraIdsPassed: NO_IDS,
          exposureCount: 0,
        },
      });
    },

    notePass(cameraId, distanceMi = 0) {
      const state = get();
      const today = state.today;
      const seenToday = today.uniqueCameraIds.includes(cameraId);
      const nextToday: DayExposure = {
        dayStartMs: today.dayStartMs,
        passes: today.passes + 1,
        uniqueCameraIds: seenToday
          ? today.uniqueCameraIds
          : [...today.uniqueCameraIds, cameraId],
      };
      const trip = state.trip;
      set({
        today: nextToday,
        allTimePasses: state.allTimePasses === null ? null : state.allTimePasses + 1,
        trip:
          trip === null
            ? null
            : {
                ...trip,
                distanceMi: trip.distanceMi + distanceMi,
                exposureCount: trip.exposureCount + 1,
                cameraIdsPassed: trip.cameraIdsPassed.includes(cameraId)
                  ? trip.cameraIdsPassed
                  : [...trip.cameraIdsPassed, cameraId],
              },
      });
    },

    endTrip(atMs) {
      const trip = get().trip;
      if (trip === null) return;
      set({ trip: { ...trip, endedAtMs: atMs } });
    },

    rollDay(dayStartMs) {
      if (get().today.dayStartMs === dayStartMs) return;
      set({ today: { dayStartMs, passes: 0, uniqueCameraIds: NO_IDS } });
    },

    clear() {
      set({ entries: NO_ENTRIES, revision: get().revision + 1 });
    },

    reset() {
      nextId = 1;
      set({ ...INITIAL_STATE });
    },
  }));
}

export const useHistoryStore = createHistoryStore();

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const useAlertLog = (): readonly AlertLogEntry[] => useHistoryStore((s) => s.entries);
export const useAlertLogLength = (): number => useHistoryStore((s) => s.entries.length);
export const useCurrentTrip = (): TripProgress | null => useHistoryStore((s) => s.trip);
export const useTodayExposure = (): DayExposure => useHistoryStore((s) => s.today);
export const useTodayPasses = (): number => useHistoryStore((s) => s.today.passes);
export const useTodayUniqueCount = (): number =>
  useHistoryStore((s) => s.today.uniqueCameraIds.length);
export const useAllTimePasses = (): number | null => useHistoryStore((s) => s.allTimePasses);

/** The most recent entry, or null. Reference-stable between appends. */
export const useLatestAlert = (): AlertLogEntry | null =>
  useHistoryStore((s) => s.entries[0] ?? null);

export const historyActions = {
  record: (entry: NewAlertLogEntry): number => useHistoryStore.getState().record(entry),
  setOutcome: (id: number, outcome: AlertOutcome): void => {
    useHistoryStore.getState().setOutcome(id, outcome);
  },
  hydrate: (
    entries: readonly AlertLogEntry[],
    allTimePasses: number | null,
    sinceMs: number | null,
  ): void => {
    useHistoryStore.getState().hydrate(entries, allTimePasses, sinceMs);
  },
  startTrip: (atMs: number): void => {
    useHistoryStore.getState().startTrip(atMs);
  },
  notePass: (cameraId: string, distanceMi?: number): void => {
    useHistoryStore.getState().notePass(cameraId, distanceMi);
  },
  endTrip: (atMs: number): void => {
    useHistoryStore.getState().endTrip(atMs);
  },
  rollDay: (dayStartMs: number): void => {
    useHistoryStore.getState().rollDay(dayStartMs);
  },
  clear: (): void => {
    useHistoryStore.getState().clear();
  },
  reset: (): void => {
    useHistoryStore.getState().reset();
  },
};
