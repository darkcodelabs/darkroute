/**
 * CAMERAS - the cached tiles, and the engine's answers about them.
 *
 * Two things live here and they are deliberately separate:
 *
 *   TILES        what the device knows exists. Slippy tiles of `CameraRecord`,
 *                keyed `z/x/y`, with the freshness bookkeeping the OFFLINE
 *                screen renders ("CACHED CAMS 4,182 · MAP TILES 318 · DB last
 *                updated 2 days ago").
 *
 *   ASSESSMENTS  what the engine concluded on the last tick: distance, bearing,
 *                relative direction, in-range, muted. These are CACHED OUTPUTS.
 *                Nothing in this file computes them; `@fwm/core` does, and
 *                `./alert.ts` hands the result over in one write.
 *
 * MUTING DOES NOT REMOVE A CAMERA FROM ANYTHING HERE
 *   "MUTED CAMERAS DON'T DISAPPEAR. They still draw on SWEEP in grey, still
 *   count in EXPOSURE, still log to LOOKUP." - Screens II, B4
 *   `CameraAssessment.muted` is carried through so SWEEP can grey the dot, and
 *   {@link CamerasState.countInRange} counts muted cameras like any other.
 */

import { create } from 'zustand';

import type {
  CameraOwnerType,
  CameraRecord,
  TileFreshness,
  TileSource,
} from '../services/db/schema.ts';
import { tileKey } from './fwmCore.ts';
import type { CameraAssessment, CameraLike, TileRef } from './fwmCore.ts';

export type { CameraAssessment, CameraOwnerType, CameraRecord, TileFreshness, TileRef, TileSource };

/** One cached tile as this slice holds it. Mirrors `CameraTileRecord`. */
export interface TileEntry {
  readonly ref: TileRef;
  readonly cameras: readonly CameraRecord[];
  readonly fetchedAtMs: number;
  readonly freshness: TileFreshness;
  readonly source: TileSource;
}

export interface CamerasState {
  /** Immutable archive digest shared by every network tile in this snapshot. */
  readonly generation: string | null;
  /** `z/x/y` -> tile. Replaced wholesale on every write, never mutated. */
  readonly tiles: ReadonlyMap<string, TileEntry>;
  /** Every cached camera, flattened and de-duplicated by id. Cached output. */
  readonly cameras: readonly CameraRecord[];
  /** Tile keys currently being fetched. Drives the "loading" state, not a spinner-forever. */
  readonly loading: ReadonlySet<string>;
  /** Nearest-first assessments from the last engine tick. */
  readonly assessments: readonly CameraAssessment[];
  /** The one the hero numeral is about. Null when nothing is in the sweep. */
  readonly nearest: CameraAssessment | null;
  /** Muted cameras count here too. That is the point of the mute rule. */
  readonly countInRange: number;
  /** Which camera's INTEL CARD is open, if any. Id only - never a payload. */
  readonly selectedCameraId: string | null;
  /** Epoch ms of the last tile write, for "DB last updated 2 days ago". */
  readonly tilesUpdatedAtMs: number | null;
  readonly error: string | null;
}

export interface AssessmentUpdate {
  readonly assessments: readonly CameraAssessment[];
  readonly nearest: CameraAssessment | null;
  readonly countInRange: number;
}

export interface CamerasActions {
  putTile(entry: TileEntry): void;
  putTiles(entries: readonly TileEntry[]): void;
  /** Merge tiles only when they belong to this exact immutable generation. */
  putGenerationTiles(generation: string, entries: readonly TileEntry[]): void;
  /** Replace the complete working set after a generation transition. */
  replaceGeneration(generation: string, entries: readonly TileEntry[]): void;
  dropTile(key: string): void;
  setLoading(keys: readonly string[]): void;
  setFreshness(key: string, freshness: TileFreshness): void;
  clearTiles(): void;
  /** The single write path for engine output. Called only by `./alert.ts`. */
  applyAssessment(update: AssessmentUpdate): void;
  selectCamera(cameraId: string | null): void;
  noteError(message: string | null): void;
  reset(): void;
}

export type CamerasStore = CamerasState & CamerasActions;

const NO_TILES: ReadonlyMap<string, TileEntry> = Object.freeze(new Map<string, TileEntry>());
const NO_CAMERAS: readonly CameraRecord[] = Object.freeze([]);
const NO_ASSESSMENTS: readonly CameraAssessment[] = Object.freeze([]);
const NOT_LOADING: ReadonlySet<string> = Object.freeze(new Set<string>());

const INITIAL_STATE: CamerasState = Object.freeze({
  generation: null,
  tiles: NO_TILES,
  cameras: NO_CAMERAS,
  loading: NOT_LOADING,
  assessments: NO_ASSESSMENTS,
  nearest: null,
  countInRange: 0,
  selectedCameraId: null,
  tilesUpdatedAtMs: null,
  error: null,
});

/**
 * Flatten every tile into one camera list, newest fetched record per id winning.
 *
 * Tiles overlap at their edges and the same camera can legitimately appear in
 * two of them; the ENGINE also de-duplicates by proximity, but that is a
 * different question (two reports of the same physical camera) and it is not
 * this slice's to answer.
 */
export function flattenTiles(tiles: ReadonlyMap<string, TileEntry>): readonly CameraRecord[] {
  const byId = new Map<string, { camera: CameraRecord; fetchedAtMs: number }>();
  for (const tile of tiles.values()) {
    for (const camera of tile.cameras) {
      const held = byId.get(camera.id);
      if (held === undefined || tile.fetchedAtMs >= held.fetchedAtMs) {
        byId.set(camera.id, { camera, fetchedAtMs: tile.fetchedAtMs });
      }
    }
  }
  return Object.freeze([...byId.values()].map(({ camera }) => camera));
}

/** `CameraRecord` is structurally a `CameraLike`; this names that on purpose. */
export function camerasForEngine(cameras: readonly CameraRecord[]): readonly CameraLike[] {
  return cameras;
}

export function createCamerasStore() {
  return create<CamerasStore>()((set, get) => ({
    ...INITIAL_STATE,

    putTile(entry) {
      get().putTiles([entry]);
    },

    putTiles(entries) {
      if (entries.length === 0) return;
      const tiles = new Map(get().tiles);
      const loading = new Set(get().loading);
      let newestMs = get().tilesUpdatedAtMs ?? 0;
      for (const entry of entries) {
        const key = tileKey(entry.ref);
        tiles.set(key, entry);
        loading.delete(key);
        if (entry.fetchedAtMs > newestMs) newestMs = entry.fetchedAtMs;
      }
      set({
        tiles,
        cameras: flattenTiles(tiles),
        loading: loading.size === 0 ? NOT_LOADING : loading,
        tilesUpdatedAtMs: newestMs,
      });
    },

    putGenerationTiles(generation, entries) {
      if (entries.length === 0) return;
      const current = get();
      if (current.generation !== null && current.generation !== generation) {
        current.replaceGeneration(generation, entries);
        return;
      }
      if (current.generation === null && current.tiles.size > 0) {
        current.replaceGeneration(generation, entries);
        return;
      }
      set({ generation });
      get().putTiles(entries);
    },

    replaceGeneration(generation, entries) {
      const tiles = new Map<string, TileEntry>();
      let newestMs: number | null = null;
      for (const entry of entries) {
        tiles.set(tileKey(entry.ref), entry);
        newestMs = newestMs === null ? entry.fetchedAtMs : Math.max(newestMs, entry.fetchedAtMs);
      }
      set({
        generation,
        tiles,
        cameras: flattenTiles(tiles),
        loading: NOT_LOADING,
        assessments: NO_ASSESSMENTS,
        nearest: null,
        countInRange: 0,
        selectedCameraId: null,
        tilesUpdatedAtMs: newestMs,
      });
    },

    dropTile(key) {
      const current = get().tiles;
      if (!current.has(key)) return;
      const tiles = new Map(current);
      tiles.delete(key);
      set({ tiles, cameras: flattenTiles(tiles) });
    },

    setLoading(keys) {
      set({ loading: keys.length === 0 ? NOT_LOADING : new Set(keys) });
    },

    setFreshness(key, freshness) {
      const existing = get().tiles.get(key);
      if (existing === undefined || existing.freshness === freshness) return;
      const tiles = new Map(get().tiles);
      tiles.set(key, { ...existing, freshness });
      set({ tiles });
    },

    clearTiles() {
      set({
        generation: null,
        tiles: NO_TILES,
        cameras: NO_CAMERAS,
        loading: NOT_LOADING,
        tilesUpdatedAtMs: null,
      });
    },

    applyAssessment(update) {
      set({
        assessments: update.assessments,
        nearest: update.nearest,
        countInRange: update.countInRange,
      });
    },

    selectCamera(cameraId) {
      set({ selectedCameraId: cameraId });
    },

    noteError(message) {
      set({ error: message });
    },

    reset() {
      set({ ...INITIAL_STATE });
    },
  }));
}

export const useCamerasStore = createCamerasStore();

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** The hero numeral's subject. Returned by reference, so it is render-stable. */
export const useNearestCamera = (): CameraAssessment | null => useCamerasStore((s) => s.nearest);

/** "425 FT" - null when nothing has been assessed yet, never a stand-in number. */
export const useNearestDistanceFt = (): number | null =>
  useCamerasStore((s) => s.nearest?.distanceFt ?? null);

/** "3 in range". Counts muted cameras: muting removes the alert, not the record. */
export const useCountInRange = (): number => useCamerasStore((s) => s.countInRange);

export const useCameraAssessments = (): readonly CameraAssessment[] =>
  useCamerasStore((s) => s.assessments);

/** "CACHED CAMS 4,182" on the OFFLINE screen. */
export const useCachedCameraCount = (): number => useCamerasStore((s) => s.cameras.length);

/** "MAP TILES 318". */
export const useCachedTileCount = (): number => useCamerasStore((s) => s.tiles.size);

export const useTilesUpdatedAtMs = (): number | null => useCamerasStore((s) => s.tilesUpdatedAtMs);

/**
 * The archive digest the LIVE warnings belong to, or null before one is known.
 *
 * The OFFLINE screen compares it with the generation on disk: the two can
 * legitimately differ after a durable replacement conflict, and a screen that
 * reports offline capability has to be able to see that.
 */
export const useCameraGeneration = (): string | null => useCamerasStore((s) => s.generation);

export const useCachedCameras = (): readonly CameraRecord[] => useCamerasStore((s) => s.cameras);

export const useSelectedCameraId = (): string | null => useCamerasStore((s) => s.selectedCameraId);

export const useTilesLoading = (): boolean => useCamerasStore((s) => s.loading.size > 0);

export const useCamerasError = (): string | null => useCamerasStore((s) => s.error);

/** Pure lookups, for a component that already has an id. */
export function findAssessment(
  state: CamerasState,
  cameraId: string,
): CameraAssessment | undefined {
  return state.assessments.find((assessment) => assessment.id === cameraId);
}

export function findCamera(state: CamerasState, cameraId: string): CameraRecord | undefined {
  return state.cameras.find((camera) => camera.id === cameraId);
}

export const camerasActions = {
  putTile: (entry: TileEntry): void => {
    useCamerasStore.getState().putTile(entry);
  },
  putTiles: (entries: readonly TileEntry[]): void => {
    useCamerasStore.getState().putTiles(entries);
  },
  putGenerationTiles: (generation: string, entries: readonly TileEntry[]): void => {
    useCamerasStore.getState().putGenerationTiles(generation, entries);
  },
  replaceGeneration: (generation: string, entries: readonly TileEntry[]): void => {
    useCamerasStore.getState().replaceGeneration(generation, entries);
  },
  dropTile: (key: string): void => {
    useCamerasStore.getState().dropTile(key);
  },
  setLoading: (keys: readonly string[]): void => {
    useCamerasStore.getState().setLoading(keys);
  },
  setFreshness: (key: string, freshness: TileFreshness): void => {
    useCamerasStore.getState().setFreshness(key, freshness);
  },
  clearTiles: (): void => {
    useCamerasStore.getState().clearTiles();
  },
  /** Engine output. Called by `./alert.ts` and by nothing else. */
  applyAssessment: (update: AssessmentUpdate): void => {
    useCamerasStore.getState().applyAssessment(update);
  },
  selectCamera: (cameraId: string | null): void => {
    useCamerasStore.getState().selectCamera(cameraId);
  },
  reset: (): void => {
    useCamerasStore.getState().reset();
  },
};
