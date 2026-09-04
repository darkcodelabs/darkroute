import { beforeEach, describe, expect, it } from 'vitest';

import type { GeoFix } from '../services/adapters';
import {
  fixAgeMs,
  positionActions,
  positionForDiagnostics,
  usePositionStore,
} from './position.ts';

const FIX: GeoFix = {
  // The one coordinate the design gives: "39.0997 N · 84.5786 W · ±4 M".
  lat: 39.0997,
  lon: -84.5786,
  accuracyM: 4,
  altitudeM: 231.4,
  altitudeAccuracyM: 6,
  speedMps: 21,
  headingDeg: 41,
  timestamp: 1_000_000,
};

beforeEach(() => {
  positionActions.reset();
});

describe('gps status', () => {
  it('starts unknown, not unavailable - nothing has been asked yet', () => {
    expect(usePositionStore.getState().gps).toBe('unknown');
  });

  it('reaches lock on the first fix and caches the mph conversion', () => {
    positionActions.ingestFix(FIX);
    const state = usePositionStore.getState();
    expect(state.gps).toBe('lock');
    expect(state.speedMps).toBe(21);
    expect(state.speedMph).toBeCloseTo(46.98, 1);
    expect(state.speedSource).toBe('gps');
  });

  it('keeps the last fix when it goes stale, because cached cameras still need it', () => {
    positionActions.ingestFix(FIX);
    positionActions.markStale();
    const state = usePositionStore.getState();
    expect(state.gps).toBe('stale');
    expect(state.fix).not.toBeNull();
    // "last fix 40s ago" - the readout the NO GPS state renders.
    expect(fixAgeMs(state, FIX.timestamp + 40_000)).toBe(40_000);
  });

  it('drops the fix when permission is refused', () => {
    positionActions.ingestFix(FIX);
    positionActions.markDenied();
    expect(usePositionStore.getState().fix).toBeNull();
    expect(usePositionStore.getState().gps).toBe('denied');
  });

  it('reports no satellite count on a plain browser rather than inventing one', () => {
    positionActions.ingestFix(FIX);
    // The web Geolocation API has no satellite count. Only the hardware bridge does.
    expect(usePositionStore.getState().satellites).toBeNull();
    usePositionStore.getState().setSatellites(9);
    expect(usePositionStore.getState().satellites).toBe(9);
  });
});

describe('heading', () => {
  it('prefers the GPS course over the compass', () => {
    positionActions.ingestFix(FIX);
    positionActions.ingestHeading({
      headingDeg: 180,
      source: 'webkit-compass',
      accuracyDeg: 10,
      absolute: true,
      timestamp: 1_000_100,
    });
    expect(usePositionStore.getState().headingDeg).toBe(41);
    expect(usePositionStore.getState().headingOrigin).toBe('gps');
  });

  it('falls back to the compass when the platform reports no course', () => {
    positionActions.ingestHeading({
      headingDeg: 223,
      source: 'absolute-orientation',
      accuracyDeg: null,
      absolute: true,
      timestamp: 1_000_100,
    });
    positionActions.ingestFix({ ...FIX, headingDeg: null });
    expect(usePositionStore.getState().headingDeg).toBe(223);
    expect(usePositionStore.getState().headingOrigin).toBe('compass');
  });
});

describe('privacy', () => {
  it('redacts a fix before it can become diagnostic text, and drops altitude', () => {
    positionActions.ingestFix(FIX);
    const redacted = positionForDiagnostics(usePositionStore.getState());
    expect(redacted).not.toBeNull();
    expect(redacted?.latApprox).toBe(39.1);
    expect(redacted?.lonApprox).toBe(-84.579);
    expect(redacted?.precision).toBe('approx-3dp');
    // A precise altitude plus a coarse position still identifies a garage floor.
    expect(Object.keys(redacted ?? {})).not.toContain('altitudeM');
  });

  it('returns null rather than a placeholder when there is no fix', () => {
    expect(positionForDiagnostics(usePositionStore.getState())).toBeNull();
  });
});

describe('motion', () => {
  const SAMPLE = {
    accelerationMps2: { x: 0.3, y: 0.4, z: 0 },
    accelerationWithGravityMps2: null,
    rotationRateDegPerS: null,
    intervalMs: 16,
    timestamp: 1_000_100,
  };

  it('records the magnitude', () => {
    positionActions.ingestFix(FIX);
    positionActions.ingestMotion(SAMPLE);
    expect(usePositionStore.getState().motionMagnitudeMps2).toBeCloseTo(0.5, 6);
  });

  /**
   * THE PERFORMANCE PROPERTY, and it is a correctness one too.
   *
   * `devicemotion` fires at up to 60 Hz. This used to rebuild `fix` on every
   * sample so it could carry the new magnitude, and the cost ran the length of
   * the app: every `useCurrentFix()` consumer re-rendered at sensor rate, and
   * `engineLoop` - which ticks on `state.fix` - ran the FULL alert engine over
   * the entire cached camera set sixty times a second.
   *
   * The identity of the fix is the signal that a POSITION changed. Nothing but
   * a position may change it.
   */
  it('does NOT mint a new fix, so the engine does not tick at sensor rate', () => {
    positionActions.ingestFix(FIX);
    const before = usePositionStore.getState().fix;

    for (let i = 0; i < 10; i += 1) positionActions.ingestMotion(SAMPLE);

    expect(usePositionStore.getState().fix).toBe(before);
  });

  it('carries the magnitude into the engine input on the next fix', () => {
    // The engine still gets its supporting evidence - one GPS sample later,
    // which is what `packages/core/src/types.ts` describes it as being for.
    positionActions.ingestMotion(SAMPLE);
    positionActions.ingestFix(FIX);
    expect(usePositionStore.getState().fix?.motionMagnitudeMps2).toBeCloseTo(0.5, 6);
  });
});
