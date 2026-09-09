import { beforeEach, describe, expect, it } from 'vitest';

import {
  camerasActions,
  findAssessment,
  findCamera,
  flattenTiles,
  useCamerasStore,
  type TileEntry,
} from './cameras.ts';
import { tileKey } from './fwmCore.ts';

const TILE_A: TileEntry = {
  ref: { x: 4379, y: 6217, z: 14 },
  cameras: [
    { id: 'FWM-0442', lat: 39.11, lon: -84.5786, directionDeg: 223, ownerType: 'hoa' },
    { id: 'FWM-0118', lat: 39.12, lon: -84.58, directionDeg: null, ownerType: 'police' },
  ],
  fetchedAtMs: 1_000_000,
  freshness: 'fresh',
  source: 'network',
};

// Overlaps TILE_A at the edge: FWM-0118 appears in both, as tiles really do.
const TILE_B: TileEntry = {
  ref: { x: 4380, y: 6217, z: 14 },
  cameras: [
    { id: 'FWM-0118', lat: 39.12, lon: -84.58, directionDeg: null, ownerType: 'police' },
    { id: 'FWM-0873', lat: 39.13, lon: -84.59, directionDeg: null, ownerType: 'private' },
  ],
  fetchedAtMs: 1_000_500,
  freshness: 'stale',
  source: 'network',
};

beforeEach(() => {
  camerasActions.reset();
});

describe('tiles', () => {
  it('keys tiles the way the engine addresses them', () => {
    camerasActions.putTile(TILE_A);
    expect([...useCamerasStore.getState().tiles.keys()]).toEqual([tileKey(TILE_A.ref)]);
  });

  it('flattens overlapping tiles into one camera list', () => {
    camerasActions.putTiles([TILE_A, TILE_B]);
    const ids = useCamerasStore.getState().cameras.map((camera) => camera.id);
    expect(ids).toEqual(['FWM-0442', 'FWM-0118', 'FWM-0873']);
    expect(useCamerasStore.getState().tiles.size).toBe(2);
  });

  it('lets the newest fetched copy win instead of suppressing a moved id', () => {
    camerasActions.putTiles([
      TILE_A,
      {
        ...TILE_B,
        cameras: [
          {
            id: 'FWM-0118',
            lat: 40,
            lon: -83,
            directionDeg: null,
            ownerType: 'police',
          },
        ],
      },
    ]);
    expect(findCamera(useCamerasStore.getState(), 'FWM-0118')).toMatchObject({
      lat: 40,
      lon: -83,
    });
  });

  it('replaces every tile and stale assessment in one generation write', () => {
    camerasActions.putGenerationTiles('a'.repeat(64), [TILE_A]);
    camerasActions.applyAssessment({
      assessments: [],
      nearest: null,
      countInRange: 2,
    });

    camerasActions.replaceGeneration('b'.repeat(64), [TILE_B]);

    const state = useCamerasStore.getState();
    expect(state.generation).toBe('b'.repeat(64));
    expect([...state.tiles.keys()]).toEqual([tileKey(TILE_B.ref)]);
    expect(state.cameras.map(({ id }) => id)).toEqual(['FWM-0118', 'FWM-0873']);
    expect(state.countInRange).toBe(0);
  });

  it('tracks the newest fetch for the "DB last updated" readout', () => {
    camerasActions.putTiles([TILE_A, TILE_B]);
    expect(useCamerasStore.getState().tilesUpdatedAtMs).toBe(TILE_B.fetchedAtMs);
  });

  it('clears a loading marker when the tile it was waiting for arrives', () => {
    camerasActions.setLoading([tileKey(TILE_A.ref), tileKey(TILE_B.ref)]);
    expect(useCamerasStore.getState().loading.size).toBe(2);
    camerasActions.putTile(TILE_A);
    expect([...useCamerasStore.getState().loading]).toEqual([tileKey(TILE_B.ref)]);
  });

  it('drops a tile and the cameras that only it held', () => {
    camerasActions.putTiles([TILE_A, TILE_B]);
    camerasActions.dropTile(tileKey(TILE_B.ref));
    const ids = useCamerasStore.getState().cameras.map((camera) => camera.id);
    expect(ids).toEqual(['FWM-0442', 'FWM-0118']);
  });

  it('records freshness without touching the tile body', () => {
    camerasActions.putTile(TILE_A);
    const before = useCamerasStore.getState().cameras;
    camerasActions.setFreshness(tileKey(TILE_A.ref), 'stale');
    expect(useCamerasStore.getState().tiles.get(tileKey(TILE_A.ref))?.freshness).toBe('stale');
    // The camera list did not need rebuilding, so its identity is untouched.
    expect(useCamerasStore.getState().cameras).toBe(before);
  });

  it('flattenTiles is pure and safe on an empty map', () => {
    expect(flattenTiles(new Map())).toEqual([]);
  });
});

describe('engine output', () => {
  it('stores assessments including muted cameras, which still count', () => {
    camerasActions.applyAssessment({
      assessments: [
        {
          id: 'FWM-0442',
          lat: 39.11,
          lon: -84.5786,
          distanceFt: 425,
          bearingDeg: 41,
          relativeDirection: 'ahead',
          facingVehicle: true,
          directionDeg: 223,
          inRange: true,
          muted: true,
          mergedIds: ['FWM-0442'],
        },
      ],
      nearest: null,
      countInRange: 1,
    });
    const state = useCamerasStore.getState();
    // "MUTED CAMERAS DON'T DISAPPEAR ... still count in EXPOSURE" - B4.
    expect(state.countInRange).toBe(1);
    expect(state.assessments[0]?.muted).toBe(true);
    expect(findAssessment(state, 'FWM-0442')?.distanceFt).toBe(425);
  });

  it('looks a camera up by id without a component reaching into the shape', () => {
    camerasActions.putTile(TILE_A);
    expect(findCamera(useCamerasStore.getState(), 'FWM-0118')?.ownerType).toBe('police');
    expect(findCamera(useCamerasStore.getState(), 'nope')).toBeUndefined();
  });
});
