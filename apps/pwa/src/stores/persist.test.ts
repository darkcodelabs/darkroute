/**
 * The persistence boundary is a privacy control, so its tests are written as
 * refusals: the interesting assertion is always that something did NOT happen.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PlateShapedValueError,
  assertPersistSafe,
  createGuardedPersistStorage,
  createMemoryPersistPort,
  getPersistPort,
  installPersistPort,
  isPersistDurable,
  resetPersistPort,
  type PersistPort,
} from './persist.ts';

/** Let the middleware's async write settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('assertPersistSafe', () => {
  it('accepts the ordinary settings shape', () => {
    expect(() =>
      assertPersistSafe({
        thresholdFt: 500,
        mutedUntilMs: null,
        mutedCameras: { 'FWM-0442': 1_700_000_000_000 },
        mode: 'night-watch',
        ownerTypesEnabled: { police: true, hoa: false },
      }),
    ).not.toThrow();
  });

  it('throws on a plate-shaped string anywhere in the value', () => {
    // "HVK 8842" is the design's own example plate (Screens II, B5).
    expect(() => assertPersistSafe({ note: 'HVK 8842' })).toThrow(PlateShapedValueError);
    expect(() => assertPersistSafe({ deep: { list: ['ok', '471 TRB'] } })).toThrow(
      PlateShapedValueError,
    );
  });

  it('throws on a plate hidden in a KEY, where a value walk would miss it', () => {
    expect(() => assertPersistSafe({ reads: { HVK8842: 73 } })).toThrow(PlateShapedValueError);
  });

  it('allows a camera id as a key ONLY inside the id-keyed mute field', () => {
    // `looksLikePlate('FWM-0442')` is true - a camera id and a plate really are
    // structurally identical - so the exemption is positional, not textual.
    expect(() => assertPersistSafe({ mutedCameras: { 'FWM-0442': 1 } })).not.toThrow();
    expect(() => assertPersistSafe({ somethingElse: { 'FWM-0442': 1 } })).toThrow(
      PlateShapedValueError,
    );
  });

  it('allows a UUID only where a session id belongs', () => {
    // A UUID is plate-shaped too ("7425-40de" is eight mixed alphanumerics).
    const uuid = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    expect(() => assertPersistSafe({ sessionId: uuid })).not.toThrow();
    expect(() => assertPersistSafe({ sessionId: null })).not.toThrow();
    expect(() => assertPersistSafe({ someOtherId: uuid })).toThrow(PlateShapedValueError);
    // And the exemption cannot carry free text.
    expect(() => assertPersistSafe({ sessionId: 'HVK 8842' })).toThrow(PlateShapedValueError);
  });

  it('refuses a key inside the mute field that is not shaped like a camera id', () => {
    expect(() => assertPersistSafe({ mutedCameras: { 'HVK 8842': 1 } })).toThrow(
      PlateShapedValueError,
    );
  });

  it('allows the id shape the catalogue ACTUALLY issues, not just the design files', () => {
    /*
     * The regression this exists for. `FWM-0442` is the shape used throughout
     * the design files and it was the only shape accepted - but every camera in
     * the shipped catalogue is `osm:<digits>`, so muting one real camera put a
     * key here that the walker refused.
     *
     * It did not warn. The refusal threw out of the settings write, so every
     * later write died too, silently; the mute stayed in memory so the app
     * looked fine; and the next load hydrated from defaults, taking the theme,
     * glass, tone, tilt, threshold and the onboarding flag with it. On the read
     * side a refused blob is deleted rather than repaired.
     */
    expect(() => assertPersistSafe({ mutedCameras: { 'osm:13375397501': 1 } })).not.toThrow();
    expect(() => assertPersistSafe({ mutedCameras: { 'osm:1': 1 } })).not.toThrow();

    /*
     * NOTE, because the obvious assertion here is false: `osm:13375397501` in a
     * NON-exempt field does not throw. It is not plate-shaped - a colon and
     * eleven straight digits is nothing like a plate - so the detector has no
     * opinion on it anywhere, and there is nothing for the positional exemption
     * to protect. That is why this shape was safe to add.
     *
     * The exemption's positional nature is still proved above by `FWM-0442`,
     * which IS plate-shaped and IS refused outside `mutedCameras`.
     */

    // And still an allowlist of machine-issued shapes, not "any string".
    for (const key of ['osm:', 'osm:abc', 'osm:12ab', 'notosm:123', 'osm 123']) {
      expect(() => assertPersistSafe({ mutedCameras: { [key]: 1 } }), key).toThrow(
        PlateShapedValueError,
      );
    }
  });

  it('throws on a field whose NAME implies plate custody, however empty', () => {
    // The shape must not exist here, not merely today's contents of it.
    expect(() => assertPersistSafe({ watchlist: [] })).toThrow(PlateShapedValueError);
    expect(() => assertPersistSafe({ plate_value: null })).toThrow(PlateShapedValueError);
    expect(() => assertPersistSafe({ licensePlates: {} })).toThrow(PlateShapedValueError);
  });

  it('never puts the offending value in the message', () => {
    try {
      assertPersistSafe({ handle: 'HVK 8842' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PlateShapedValueError);
      expect((error as Error).message).not.toContain('HVK');
      expect((error as PlateShapedValueError).path).toBe('$.handle');
    }
  });

  it('refuses a Map or a Set, which JSON would silently flatten to {}', () => {
    expect(() => assertPersistSafe({ tiles: new Map() })).toThrow(PlateShapedValueError);
    expect(() => assertPersistSafe({ seen: new Set() })).toThrow(PlateShapedValueError);
  });
});

describe('guarded persist storage', () => {
  let port: PersistPort;

  beforeEach(() => {
    port = createMemoryPersistPort();
  });

  it('round-trips a safe value', async () => {
    const storage = createGuardedPersistStorage<{ thresholdFt: number }>({ port });
    await storage.setItem('fwm.test', { state: { thresholdFt: 750 }, version: 1 });
    const read = await storage.getItem('fwm.test');
    expect(read).toEqual({ state: { thresholdFt: 750 }, version: 1 });
  });

  it('THROWS SYNCHRONOUSLY out of a store action when a plate reaches the serializer', () => {
    interface LeakyStore {
      readonly note: string;
      setNote(note: string): void;
    }
    const store = create<LeakyStore>()(
      persist(
        (set) => ({
          note: '',
          setNote(note) {
            set({ note });
          },
        }),
        {
          name: 'fwm.test.leaky',
          storage: createGuardedPersistStorage<{ note: string }>({ port }),
          partialize: (state) => ({ note: state.note }),
          skipHydration: true,
        },
      ),
    );

    expect(() => {
      store.getState().setNote('parked at Reading Rd');
    }).not.toThrow();

    expect(() => {
      store.getState().setNote('HVK 8842');
    }).toThrow(PlateShapedValueError);
  });

  it('writes nothing to the port when the guard refuses', async () => {
    const storage = createGuardedPersistStorage<{ handle: string }>({ port });
    expect(() => storage.setItem('fwm.test', { state: { handle: '471 TRB' }, version: 1 })).toThrow(
      PlateShapedValueError,
    );
    await expect(port.getItem('fwm.test')).resolves.toBeNull();
  });

  it('refuses to HYDRATE a tampered blob, drops it, and does not throw', async () => {
    const onRejected = vi.fn();
    const storage = createGuardedPersistStorage<{ handle: string }>({ port, onRejected });
    // Written behind the guard's back, as a devtools edit or a profile sync would.
    await port.setItem('fwm.test', JSON.stringify({ state: { handle: 'HVK 8842' }, version: 1 }));

    await expect(storage.getItem('fwm.test')).resolves.toBeNull();
    expect(onRejected).toHaveBeenCalledWith('fwm.test', 'plate-shaped-value');
    // And the blob is gone, so it cannot be read back into a store next launch.
    await expect(port.getItem('fwm.test')).resolves.toBeNull();
  });

  it('survives unparseable bytes without throwing', async () => {
    const onRejected = vi.fn();
    const storage = createGuardedPersistStorage<{ handle: string }>({ port, onRejected });
    await port.setItem('fwm.test', 'not json');
    await expect(storage.getItem('fwm.test')).resolves.toBeNull();
    expect(onRejected).toHaveBeenCalledWith('fwm.test', 'stored value is not valid JSON');
  });
});

describe('the installed port', () => {
  it('defaults to a NON-durable memory port and says so', () => {
    const previous = resetPersistPort();
    try {
      expect(isPersistDurable()).toBe(false);
      expect(getPersistPort().reason).toContain('memory');
    } finally {
      installPersistPort(previous);
    }
  });

  it('reports durability from whatever the composition root installed', async () => {
    const durable: PersistPort = { ...createMemoryPersistPort(), durable: true };
    const previous = installPersistPort(durable);
    try {
      expect(isPersistDurable()).toBe(true);
      await flush();
    } finally {
      installPersistPort(previous);
    }
  });
});
