import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCamerasStore } from '../../stores/cameras.ts';
import { surroundingTiles, tileKey } from '../../stores/fwmCore.ts';
import { usePositionStore } from '../../stores/position.ts';
import { closeFwmDb, createCameraTilesRepository, openFwmDb } from '../db/index.ts';
import type { CameraRecord } from '../db/schema.ts';
import type { MemoryIndexedDB } from '../db/testing/memory-idb.ts';
import { installMemoryIndexedDB } from '../db/testing/memory-idb.ts';

import { GENERATION_CHECK_INTERVAL_MS, createCameraSync, metresBetween } from './sync.ts';
import { replacePersistedTiles, resetTileStore } from './tileStore.ts';

const POSITION = { lat: 38.9181, lon: -94.6923 };
const GENERATION_A = 'a'.repeat(64);
const GENERATION_B = 'b'.repeat(64);
let memory: MemoryIndexedDB;

function camera(id: string, lat = 38.9563, lon = -94.74754): CameraRecord {
  return {
    id,
    lat,
    lon,
    directionDeg: 90,
    ownerType: 'unverified',
    confirmations: 1,
  };
}

function tileBody(z: number, x: number, y: number, cameras: readonly CameraRecord[]): string {
  return JSON.stringify({
    z,
    x,
    y,
    generatedAt: '2026-08-20T17:14:04.587Z',
    attribution: 'Map data © OpenStreetMap contributors',
    licence: 'ODbL-1.0',
    licenceUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    cameras,
  });
}

interface ServerOptions {
  readonly generation: () => string;
  readonly cameras?: (path: string, generation: string) => readonly CameraRecord[];
  readonly fail?: (path: string, generation: string) => boolean;
  readonly responseGeneration?: (path: string, generation: string) => string;
  readonly missing?: boolean;
}

type CameraFetch = typeof fetch & {
  readonly mock: { readonly calls: readonly (readonly [RequestInfo | URL, ...unknown[]])[] };
};

function cameraServer(options: ServerOptions): CameraFetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'https://darkroute.test');
    const generation = options.generation();
    const headers = { 'x-darkroute-camera-generation': generation };
    if (url.pathname === '/cameras/index.json') {
      return new Response(
        JSON.stringify({
          zoom: 11,
          cameras: 100,
          tiles: 50,
          upstream: '2026-09-02T10:00:00Z',
        }),
        { status: 200, headers },
      );
    }

    const match = /^\/cameras\/(\d+)\/(\d+)\/(\d+)\.json$/.exec(url.pathname);
    if (match === null) return new Response('not found', { status: 404 });
    const [, z, x, y] = match;
    const path = `${z}/${x}/${y}.json`;
    if (options.fail?.(path, generation) === true) throw new Error('offline');
    const tileGeneration = options.responseGeneration?.(path, generation) ?? generation;
    const tileHeaders = { 'x-darkroute-camera-generation': tileGeneration };
    if (options.missing === true)
      return new Response('null', { status: 404, headers: tileHeaders });
    const cameras = options.cameras?.(path, generation) ?? [
      camera(`osm:${x ?? ''}${y ?? ''}`, 38.9563, -94.74754),
    ];
    return new Response(tileBody(Number(z), Number(x), Number(y), cameras), {
      status: 200,
      headers: tileHeaders,
    });
  }) as unknown as CameraFetch;
}

function tileCalls(spy: CameraFetch): string[] {
  return spy.mock.calls
    .map(([input]) => String(input))
    .filter((url) => /\/cameras\/11\/\d+\/\d+\.json\?generation=/.test(url));
}

beforeAll(() => {
  memory = installMemoryIndexedDB();
});

afterAll(() => {
  memory.uninstall();
});

beforeEach(() => {
  memory.reset();
  resetTileStore();
  useCamerasStore.getState().reset();
  usePositionStore.getState().reset();
});

describe('the camera sync', () => {
  it('fills the store from one pointer-bound tile generation', async () => {
    const server = cameraServer({
      generation: () => GENERATION_A,
      cameras: (path) => [0, 1, 2].map((i) => camera(`osm:${path}:${String(i)}`)),
    });
    const sync = createCameraSync({ fetchImpl: server, now: () => 1_700_000_000_000 });

    const loaded = await sync.syncAt(POSITION.lat, POSITION.lon);

    expect(loaded).toBe(27);
    expect(useCamerasStore.getState().generation).toBe(GENERATION_A);
    expect(useCamerasStore.getState().tiles.size).toBe(9);
    expect(useCamerasStore.getState().cameras).toHaveLength(27);
    sync.stop();
  });

  it('sends only a coarse tile address and the public generation identity', async () => {
    const server = cameraServer({ generation: () => GENERATION_A });
    const sync = createCameraSync({ fetchImpl: server });
    await sync.syncAt(POSITION.lat, POSITION.lon);

    const seen = tileCalls(server);
    expect(seen).toHaveLength(9);
    for (const raw of seen) {
      const url = new URL(raw, 'https://darkroute.test');
      expect(url.pathname).toMatch(/^\/cameras\/11\/\d+\/\d+\.json$/);
      expect(url.searchParams.get('generation')).toBe(GENERATION_A);
      expect(raw).not.toContain('38.9');
      expect(raw).not.toContain('-94.6');
    }
    sync.stop();
  });

  it('treats an identity-bound missing tile as empty, not as an error', async () => {
    const server = cameraServer({ generation: () => GENERATION_A, missing: true });
    const sync = createCameraSync({ fetchImpl: server });

    await expect(sync.syncAt(45, -110)).resolves.toBe(0);
    expect(useCamerasStore.getState().tiles.size).toBe(9);
    expect(useCamerasStore.getState().cameras).toHaveLength(0);
    sync.stop();
  });

  it('never caches "no cameras here" over a failed tile request', async () => {
    const server = cameraServer({ generation: () => GENERATION_A, fail: () => true });
    const sync = createCameraSync({ fetchImpl: server });

    await sync.syncAt(POSITION.lat, POSITION.lon);

    expect(useCamerasStore.getState().tiles.size).toBe(0);
    sync.stop();
  });

  it('reuses held tiles while the immutable generation is unchanged', async () => {
    const server = cameraServer({ generation: () => GENERATION_A });
    const sync = createCameraSync({ fetchImpl: server, now: () => 10_000 });

    await sync.syncAt(POSITION.lat, POSITION.lon);
    expect(tileCalls(server)).toHaveLength(9);
    await sync.syncAt(POSITION.lat + 0.0001, POSITION.lon);

    expect(tileCalls(server)).toHaveLength(9);
    sync.stop();
  });

  it('removes a deleted camera by replacing, never merging, a changed generation', async () => {
    let generation = GENERATION_A;
    let clock = 0;
    const server = cameraServer({
      generation: () => generation,
      cameras: (_path, current) => (current === GENERATION_A ? [camera('osm:deleted')] : []),
    });
    const sync = createCameraSync({ fetchImpl: server, now: () => clock });

    await sync.syncAt(POSITION.lat, POSITION.lon);
    expect(useCamerasStore.getState().cameras.map(({ id }) => id)).toEqual(['osm:deleted']);

    generation = GENERATION_B;
    clock += GENERATION_CHECK_INTERVAL_MS + 1;
    await sync.syncAt(POSITION.lat, POSITION.lon);

    expect(useCamerasStore.getState().generation).toBe(GENERATION_B);
    expect(useCamerasStore.getState().cameras).toEqual([]);
    sync.stop();
  });

  it('moves an id to its new tile without first-id-wins retaining the old location', async () => {
    let generation = GENERATION_A;
    let clock = 0;
    const refs = surroundingTiles(POSITION.lat, POSITION.lon, 11, 1);
    const first = refs[0];
    const last = refs.at(-1);
    if (first === undefined || last === undefined) throw new Error('fixture ring is empty');
    const oldPath = `${String(first.z)}/${String(first.x)}/${String(first.y)}.json`;
    const newPath = `${String(last.z)}/${String(last.x)}/${String(last.y)}.json`;
    const server = cameraServer({
      generation: () => generation,
      cameras: (path, current) => {
        if (current === GENERATION_A && path === oldPath) return [camera('osm:moved', 38, -95)];
        if (current === GENERATION_B && path === newPath) return [camera('osm:moved', 39, -94)];
        return [];
      },
    });
    const sync = createCameraSync({ fetchImpl: server, now: () => clock });

    await sync.syncAt(POSITION.lat, POSITION.lon);
    generation = GENERATION_B;
    clock += GENERATION_CHECK_INTERVAL_MS + 1;
    await sync.syncAt(POSITION.lat, POSITION.lon);

    expect(useCamerasStore.getState().cameras).toMatchObject([
      { id: 'osm:moved', lat: 39, lon: -94 },
    ]);
    sync.stop();
  });

  it('rejects a stale service-worker tile whose header is not the requested generation', async () => {
    let generation = GENERATION_A;
    let clock = 0;
    const server = cameraServer({
      generation: () => generation,
      cameras: (_path, current) => [camera(`osm:${current.slice(0, 1)}`)],
      responseGeneration: (_path, current) => (current === GENERATION_B ? GENERATION_A : current),
    });
    const sync = createCameraSync({ fetchImpl: server, now: () => clock });
    await sync.syncAt(POSITION.lat, POSITION.lon);

    generation = GENERATION_B;
    clock += GENERATION_CHECK_INTERVAL_MS + 1;
    await sync.syncAt(POSITION.lat, POSITION.lon);

    expect(useCamerasStore.getState().generation).toBe(GENERATION_A);
    expect(useCamerasStore.getState().cameras.map(({ id }) => id)).toEqual(['osm:a']);
    sync.stop();
  });

  it('does not commit a mixed generation when one replacement tile fails', async () => {
    let generation = GENERATION_A;
    let clock = 0;
    let failed = false;
    const server = cameraServer({
      generation: () => generation,
      cameras: (_path, current) => [camera(`osm:${current.slice(0, 1)}`)],
      fail: (_path, current) => {
        if (current !== GENERATION_B || failed) return false;
        failed = true;
        return true;
      },
    });
    const sync = createCameraSync({ fetchImpl: server, now: () => clock });
    await sync.syncAt(POSITION.lat, POSITION.lon);

    generation = GENERATION_B;
    clock += GENERATION_CHECK_INTERVAL_MS + 1;
    await sync.syncAt(POSITION.lat, POSITION.lon);

    expect(useCamerasStore.getState().generation).toBe(GENERATION_A);
    expect(useCamerasStore.getState().cameras.map(({ id }) => id)).toEqual(['osm:a']);
    sync.stop();
  });

  it('notices a generation published during a long drive after the one-minute throttle', async () => {
    let generation = GENERATION_A;
    let clock = 1_000;
    const server = cameraServer({
      generation: () => generation,
      cameras: (_path, current) => [camera(`osm:${current.slice(0, 1)}`)],
    });
    const sync = createCameraSync({ fetchImpl: server, now: () => clock });
    await sync.syncAt(POSITION.lat, POSITION.lon);

    generation = GENERATION_B;
    clock += GENERATION_CHECK_INTERVAL_MS - 1;
    await sync.syncAt(POSITION.lat, POSITION.lon);
    expect(useCamerasStore.getState().generation).toBe(GENERATION_A);

    clock += 2;
    await sync.syncAt(POSITION.lat, POSITION.lon);
    expect(useCamerasStore.getState().generation).toBe(GENERATION_B);
    expect(useCamerasStore.getState().cameras.map(({ id }) => id)).toEqual(['osm:b']);
    sync.stop();
  });

  it('hydrates another previously cached ring while moving offline', async () => {
    const elsewhere = { lat: 38.9181, lon: -90.1 };
    const hereRef = surroundingTiles(POSITION.lat, POSITION.lon, 11, 1)[4];
    const thereRef = surroundingTiles(elsewhere.lat, elsewhere.lon, 11, 1)[4];
    if (hereRef === undefined || thereRef === undefined) throw new Error('fixture ring is empty');
    await replacePersistedTiles(null, GENERATION_A, [
      {
        ref: hereRef,
        cameras: [camera('osm:here')],
        fetchedAtMs: Date.now(),
        generation: GENERATION_A,
      },
      {
        ref: thereRef,
        cameras: [camera('osm:there')],
        fetchedAtMs: Date.now(),
        generation: GENERATION_A,
      },
    ]);
    const offline = vi.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    const sync = createCameraSync({ fetchImpl: offline });

    await sync.syncAt(POSITION.lat, POSITION.lon);
    expect(useCamerasStore.getState().cameras.map(({ id }) => id)).toEqual(['osm:here']);
    await sync.syncAt(elsewhere.lat, elsewhere.lon);

    expect(useCamerasStore.getState().generation).toBe(GENERATION_A);
    expect(
      useCamerasStore
        .getState()
        .cameras.map(({ id }) => id)
        .sort(),
    ).toEqual(['osm:here', 'osm:there']);
    sync.stop();
  });

  it('continues to a healthy network generation when cache hydration never resolves', async () => {
    vi.useFakeTimers();
    const blockedHydrate = vi.fn(() => new Promise<number>(() => undefined));
    const server = cameraServer({
      generation: () => GENERATION_A,
      cameras: () => [camera('osm:network')],
    });
    const sync = createCameraSync({
      fetchImpl: server,
      hydrateTilesImpl: blockedHydrate,
      hydrateBudgetMs: 10,
      replacePersistedImpl: async () => 'unavailable',
    });

    try {
      const result = sync.syncAt(POSITION.lat, POSITION.lon);
      await vi.advanceTimersByTimeAsync(11);
      await result;

      expect(blockedHydrate).toHaveBeenCalledOnce();
      expect(useCamerasStore.getState().generation).toBe(GENERATION_A);
      expect(useCamerasStore.getState().cameras.map(({ id }) => id)).toEqual(['osm:network']);
    } finally {
      sync.stop();
      vi.useRealTimers();
    }
  });

  /**
   * THE REVERSAL. This test used to be
   * `keeps memory on G1 when an available database aborts the G2 replacement`,
   * and it asserted `generation === GENERATION_A` with `['osm:old']` still in
   * memory after a failed durable replacement.
   *
   * That assertion was wrong, and it was wrong in the direction this product
   * cannot afford. It described storage vetoing a complete, twice-verified
   * network generation -- and the case it did not cover is the one that
   * matters: on a cold start memory is EMPTY, so "keep what memory had" means
   * keep NOTHING. A driver got an app that fetched every tile, verified every
   * header, re-confirmed the pointer, and then showed no cameras and no
   * warning, on every sync, for the rest of the session.
   *
   * The durable snapshot it was protecting is protected by the DB-wide
   * sentinel instead: `persistTiles` writes through `putManyIfGeneration`,
   * which refuses every write while the sentinel names another generation.
   */
  it('admits a verified G2 to memory even when the database aborts the replacement', async () => {
    const oldRef = surroundingTiles(POSITION.lat, POSITION.lon, 11, 1)[4];
    if (oldRef === undefined) throw new Error('fixture ring is empty');
    useCamerasStore.getState().putGenerationTiles(GENERATION_A, [
      {
        ref: oldRef,
        cameras: [camera('osm:old')],
        fetchedAtMs: 1,
        freshness: 'fresh',
        source: 'network',
      },
    ]);
    const server = cameraServer({
      generation: () => GENERATION_B,
      cameras: () => [camera('osm:new')],
    });
    const sync = createCameraSync({
      fetchImpl: server,
      replacePersistedImpl: async () => 'failed',
    });

    await sync.syncAt(POSITION.lat, POSITION.lon);

    expect(useCamerasStore.getState().generation).toBe(GENERATION_B);
    // Wholesale, not merged: the old records are gone, which is what makes the
    // new generation's tombstones real.
    expect(useCamerasStore.getState().cameras.map(({ id }) => id)).toEqual(['osm:new']);
    expect(useCamerasStore.getState().tiles.size).toBe(9);
    sync.stop();
  });

  it('starts warning from a verified G2 on a cold start whose database refuses it', async () => {
    // THE DEFECT, at the moment it actually bites: nothing in memory, a
    // coherent older generation on disk, a healthy server entirely on G2.
    // Under the old code this was 27 fetched cameras and an empty map.
    const server = cameraServer({
      generation: () => GENERATION_B,
      cameras: (path) => [0, 1, 2].map((i) => camera(`osm:${path}:${String(i)}`)),
    });
    const sync = createCameraSync({
      fetchImpl: server,
      replacePersistedImpl: async () => 'failed',
    });

    const loaded = await sync.syncAt(POSITION.lat, POSITION.lon);

    expect(loaded).toBe(27);
    expect(useCamerasStore.getState().generation).toBe(GENERATION_B);
    expect(useCamerasStore.getState().cameras).toHaveLength(27);
    sync.stop();
  });

  it('warns from a verified G2 when the replacement never SETTLES, not just when it fails', async () => {
    /*
     * THE HOLE IN THE FIRST FIX, and it is the original defect wearing a hat.
     *
     * Admitting G2 on a `failed` verdict only helps when the replacement
     * RESOLVES. A transaction wedged behind a blocked upgrade, or another tab
     * holding the store, never produces a verdict at all - so the await above
     * `replaceGeneration` never returns, and because `syncAt` serialises every
     * sync on one promise queue the next fix does not get a second chance
     * either. Every tile fetched, every header checked, the pointer
     * re-confirmed, and a driver shown nothing.
     *
     * The deadline makes a wedged transaction indistinguishable from a conflict
     * at this level, which is right: both mean the disk did not take it, and
     * both must still warn.
     */
    const server = cameraServer({
      generation: () => GENERATION_B,
      cameras: (path) => [0, 1, 2].map((i) => camera(`osm:${path}:${String(i)}`)),
    });
    const sync = createCameraSync({
      fetchImpl: server,
      // Never settles. The same seam the accepted 'failed' test injects at.
      replacePersistedImpl: () => new Promise(() => undefined),
      durableReplaceTimeoutMs: 10,
    });

    const loaded = await sync.syncAt(POSITION.lat, POSITION.lon);

    expect(loaded).toBe(27);
    expect(useCamerasStore.getState().generation).toBe(GENERATION_B);
    expect(useCamerasStore.getState().cameras).toHaveLength(27);
    sync.stop();
  });

  it('leaves the older coherent durable snapshot alone when it could not be replaced', async () => {
    // The other half of the trade, against the REAL repository rather than an
    // injected failure: a database already holding a coherent G1 conflicts on
    // a G2 replacement, and must still be holding exactly G1 afterwards -- it
    // is what the next cold start hydrates from.
    const ring = surroundingTiles(POSITION.lat, POSITION.lon, 11, 1);
    const durable = ring.map((ref) => ({
      ref,
      cameras: [camera(`osm:old:${tileKey(ref)}`)],
      // Fetched now, not at a fixed epoch: `hydrateTiles` evicts past the hard
      // expiry before it reads, so a fixture dated 2023 would be deleted by the
      // sync under test and this would pass for the wrong reason.
      fetchedAtMs: Date.now(),
      generation: GENERATION_A,
    }));
    expect(await replacePersistedTiles(null, GENERATION_A, durable)).toBe('committed');

    const server = cameraServer({
      generation: () => GENERATION_B,
      cameras: () => [camera('osm:new')],
    });
    const sync = createCameraSync({ fetchImpl: server });

    await sync.syncAt(POSITION.lat, POSITION.lon);

    // Memory moved to the verified network generation ...
    expect(useCamerasStore.getState().generation).toBe(GENERATION_B);
    expect(useCamerasStore.getState().cameras.map(({ id }) => id)).toEqual(['osm:new']);

    // ... and the durable snapshot is untouched and still coherent on G1.
    const db = await openFwmDb();
    try {
      const rows = await createCameraTilesRepository(db).getMany(
        ring.map((ref): [number, number, number] => [ref.z, ref.x, ref.y]),
      );
      expect(rows).toHaveLength(9);
      expect(rows.every((row) => row.generation === GENERATION_A)).toBe(true);
    } finally {
      closeFwmDb(db);
    }
    sync.stop();
  });
});

describe('metresBetween', () => {
  it('measures a short hop the way a car experiences it', () => {
    expect(
      metresBetween({ lat: 38.9181, lon: -94.6923 }, { lat: 38.9191, lon: -94.6923 }),
    ).toBeCloseTo(111, 0);
  });
});
