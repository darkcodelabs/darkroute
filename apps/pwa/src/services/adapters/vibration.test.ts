/**
 * Three shapes, told apart. The two-pulse signature belongs to cameras, abuse
 * areas speak as long-short, a turn is one short pulse, and everything else in
 * the product is silent enough that asking it to buzz throws.
 *
 * The tests that matter most here are the structural ones: that the patterns
 * are the SAME OBJECTS the notification posts rather than copies of them, and
 * that no non-camera source can reach the camera signature by any combination
 * of arguments. Both are design rules, so both are asserted over the whole
 * input space rather than sampled.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  ABUSE_VIBRATION,
  ALERT_CHANNELS,
  CAMERA_VIBRATION,
  NAVIGATION_VIBRATION,
  SILENT_VIBRATION,
  isSilentChannel,
} from './notifications';
import {
  BUZZING_SOURCES,
  CAMERA_ALERT_PATTERNS,
  HAPTIC_SOURCES,
  SOURCE_PATTERNS,
  SilentChannelError,
  assertCanBuzz,
  createVibrationAdapter,
  patternFor,
  vibrationCapability,
  type HapticSource,
} from './vibration';
import { withGlobals } from './testing/globals';
import { ALERT_STATES, type AlertState } from './types';

/** The sources with no pattern, derived from the export rather than retyped. */
const REFUSED: readonly HapticSource[] = HAPTIC_SOURCES.filter(
  (source) => !(BUZZING_SOURCES as readonly HapticSource[]).includes(source),
);

/**
 * The patterns are written delay-first; `navigator.vibrate` reads index 0 as a
 * pulse, so the adapter drops the leading wait on the way out. This is the
 * same translation, restated, so a test failure says which end broke.
 */
function asSentToPlatform(pattern: readonly number[]): number[] {
  return pattern[0] === 0 ? [...pattern.slice(1)] : [...pattern];
}

function withVibrate(run: (vibrate: ReturnType<typeof vi.fn>) => void): void {
  const vibrate = vi.fn(() => true);
  withGlobals({ navigator: { vibrate } }, () => {
    run(vibrate);
  });
}

describe('the pattern table', () => {
  it('gives every source the pattern the design documents for it', () => {
    expect(SOURCE_PATTERNS['camera-alert']).toEqual(CAMERA_VIBRATION);
    expect(SOURCE_PATTERNS['abuse-area']).toEqual(ABUSE_VIBRATION);
    expect(SOURCE_PATTERNS.navigation).toEqual(NAVIGATION_VIBRATION);
    expect(SOURCE_PATTERNS.watchlist).toEqual(SILENT_VIBRATION);
    expect(SOURCE_PATTERNS['mesh-activity']).toEqual(SILENT_VIBRATION);
    expect(SOURCE_PATTERNS['ui-feedback']).toEqual(SILENT_VIBRATION);
    expect(SOURCE_PATTERNS.sync).toEqual(SILENT_VIBRATION);
  });

  it('points at the notification module rather than copying it', () => {
    // Identity, not equality. A copy is a second definition, and a second
    // definition is the drift that made the felt alert and the posted alert
    // two different alerts in the first place.
    expect(SOURCE_PATTERNS['camera-alert']).toBe(CAMERA_VIBRATION);
    expect(SOURCE_PATTERNS['abuse-area']).toBe(ABUSE_VIBRATION);
    expect(SOURCE_PATTERNS.navigation).toBe(NAVIGATION_VIBRATION);
  });

  it('invents no duration of its own', () => {
    const shared = new Set<number>([
      ...CAMERA_VIBRATION,
      ...ABUSE_VIBRATION,
      ...NAVIGATION_VIBRATION,
      ...SILENT_VIBRATION,
    ]);
    const used = new Set<number>();
    for (const source of HAPTIC_SOURCES) {
      for (const value of SOURCE_PATTERNS[source]) used.add(value);
    }
    for (const state of ALERT_STATES) {
      for (const value of CAMERA_ALERT_PATTERNS[state]) used.add(value);
    }
    for (const value of used) expect(shared.has(value)).toBe(true);
  });

  it('keeps the three shapes tellable apart from each other', () => {
    expect(CAMERA_VIBRATION).not.toEqual(ABUSE_VIBRATION);
    expect(CAMERA_VIBRATION).not.toEqual(NAVIGATION_VIBRATION);
    expect(ABUSE_VIBRATION).not.toEqual(NAVIGATION_VIBRATION);
  });

  it('agrees with BUZZING_SOURCES about which sources have a pattern', () => {
    // The guard narrows to BuzzingSource on a length check. A row that says
    // one thing and a union that says the other is how a silent channel gets
    // through, so they are asserted against each other.
    for (const source of HAPTIC_SOURCES) {
      const listed = (BUZZING_SOURCES as readonly HapticSource[]).includes(source);
      expect(SOURCE_PATTERNS[source].length > 0).toBe(listed);
    }
  });
});

describe('camera states', () => {
  it('is silent exactly where the notification channel is silent', () => {
    for (const state of ALERT_STATES) {
      expect(CAMERA_ALERT_PATTERNS[state].length === 0).toBe(
        isSilentChannel(ALERT_CHANNELS[state]),
      );
    }
  });

  it('answers an alerting state with the reserved signature', () => {
    expect(CAMERA_ALERT_PATTERNS.in_range).toEqual(CAMERA_VIBRATION);
    expect(CAMERA_ALERT_PATTERNS.multiple).toEqual(CAMERA_VIBRATION);
  });

  it('treats a camera request that names no state as the alert itself', () => {
    expect(patternFor({ source: 'camera-alert' })).toEqual(CAMERA_VIBRATION);
  });

  it('lets the state silence the alert but never reshape it', () => {
    for (const state of ALERT_STATES) {
      const pattern = patternFor({ source: 'camera-alert', state });
      expect(pattern.length === 0 || pattern === CAMERA_VIBRATION).toBe(true);
    }
  });
});

describe('the two-pulse signature', () => {
  it('is unreachable from any source that is not a camera', () => {
    // The design rule, asserted over the whole input space rather than a
    // sample: every source, every state, and the stateless request too.
    const states: readonly (AlertState | undefined)[] = [undefined, ...ALERT_STATES];
    for (const source of HAPTIC_SOURCES) {
      for (const state of states) {
        const pattern =
          state === undefined ? patternFor({ source }) : patternFor({ source, state });
        if (pattern.length > 0 && JSON.stringify(pattern) === JSON.stringify(CAMERA_VIBRATION)) {
          expect(source).toBe('camera-alert');
        }
      }
    }
  });

  it('is not what a non-camera source is given', () => {
    for (const source of HAPTIC_SOURCES) {
      if (source === 'camera-alert') continue;
      expect(SOURCE_PATTERNS[source]).not.toEqual(CAMERA_VIBRATION);
    }
  });
});

describe('the guard', () => {
  it.each(REFUSED)('throws for a %s caller, which has no pattern', (source) => {
    expect(() => {
      assertCanBuzz(source);
    }).toThrow(SilentChannelError);
  });

  it.each(BUZZING_SOURCES)('lets a %s through', (source) => {
    expect(() => {
      assertCanBuzz(source);
    }).not.toThrow();
  });

  it('names the source it refused', () => {
    try {
      assertCanBuzz('watchlist');
      expect.unreachable('the guard should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SilentChannelError);
      expect((error as SilentChannelError).source).toBe('watchlist');
    }
  });

  it('blocks a silent source before the device can buzz', () => {
    withVibrate((vibrate) => {
      const adapter = createVibrationAdapter();
      adapter.start();

      for (const source of REFUSED) {
        expect(() => adapter.buzz({ source, state: 'in_range' })).toThrow(SilentChannelError);
      }
      // The whole point: nothing reached the platform.
      expect(vibrate).not.toHaveBeenCalled();
      adapter.stop();
    });
  });
});

describe('buzzing', () => {
  it('sends the camera signature to the platform', () => {
    withVibrate((vibrate) => {
      const adapter = createVibrationAdapter();
      adapter.start();
      const result = adapter.buzz({ source: 'camera-alert', state: 'multiple' });

      expect(result.ok).toBe(true);
      expect(vibrate).toHaveBeenCalledWith(asSentToPlatform(CAMERA_VIBRATION));
      expect(adapter.current()?.source).toBe('camera-alert');
      expect(adapter.current()?.state).toBe('multiple');
      adapter.stop();
    });
  });

  it('sends the abuse pattern, which is not the camera signature', () => {
    withVibrate((vibrate) => {
      const adapter = createVibrationAdapter();
      adapter.start();
      const result = adapter.buzz({ source: 'abuse-area' });

      expect(result.ok).toBe(true);
      expect(vibrate).toHaveBeenCalledWith(asSentToPlatform(ABUSE_VIBRATION));
      expect(vibrate).not.toHaveBeenCalledWith(asSentToPlatform(CAMERA_VIBRATION));
      // No state was passed and none is invented.
      expect(adapter.current()?.state).toBeUndefined();
      adapter.stop();
    });
  });

  it('sends a turn cue the motor can actually run', () => {
    withVibrate((vibrate) => {
      const adapter = createVibrationAdapter();
      adapter.start();
      const result = adapter.buzz({ source: 'navigation' });

      expect(result.ok).toBe(true);
      const sent = asSentToPlatform(NAVIGATION_VIBRATION);
      // THE REGRESSION. Handed to `navigator.vibrate` as written, `[0, 180]`
      // is a 0ms pulse followed by a pause: nothing at all.
      expect(sent.length).toBeGreaterThan(0);
      expect(sent[0]).toBeGreaterThan(0);
      expect(vibrate).toHaveBeenCalledWith(sent);
      adapter.stop();
    });
  });

  it('reports the pattern it asked for, in the form the notification posts', () => {
    withVibrate((vibrate) => {
      const adapter = createVibrationAdapter();
      adapter.start();
      const result = adapter.buzz({ source: 'camera-alert', state: 'in_range' });

      // One definition, two forms: the result names the pattern the design
      // does, and the platform got the same pattern in the units it reads.
      expect(result.pattern).toEqual(CAMERA_VIBRATION);
      expect(vibrate).toHaveBeenCalledWith(asSentToPlatform(CAMERA_VIBRATION));
      adapter.stop();
    });
  });

  it('refuses to buzz for clear, which is silent by design', () => {
    withVibrate((vibrate) => {
      const adapter = createVibrationAdapter();
      adapter.start();
      const result = adapter.buzz({ source: 'camera-alert', state: 'clear' });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/silent/i);
      expect(vibrate).not.toHaveBeenCalled();
      adapter.stop();
    });
  });

  it('refuses to buzz for approaching, which the notification posts silently', () => {
    withVibrate((vibrate) => {
      const adapter = createVibrationAdapter();
      adapter.start();
      const result = adapter.buzz({ source: 'camera-alert', state: 'approaching' });
      expect(result.ok).toBe(false);
      expect(vibrate).not.toHaveBeenCalled();
      adapter.stop();
    });
  });

  it('does nothing while haptics are switched off', () => {
    withVibrate((vibrate) => {
      const adapter = createVibrationAdapter();
      const result = adapter.buzz({ source: 'camera-alert', state: 'in_range' });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/map view panel/i);
      expect(vibrate).not.toHaveBeenCalled();
    });
  });

  it('cancels an in-flight pattern on stop', () => {
    withVibrate((vibrate) => {
      const adapter = createVibrationAdapter();
      adapter.start();
      adapter.buzz({ source: 'camera-alert', state: 'in_range' });
      adapter.stop();
      expect(vibrate).toHaveBeenLastCalledWith(0);
      adapter.stop(); // idempotent: no second cancel
      expect(vibrate).toHaveBeenCalledTimes(2);
    });
  });

  it('reports a refusal from the browser instead of claiming a buzz', () => {
    const vibrate = vi.fn(() => false);
    withGlobals({ navigator: { vibrate } }, () => {
      const adapter = createVibrationAdapter();
      adapter.start();
      const result = adapter.buzz({ source: 'camera-alert', state: 'in_range' });
      expect(result.ok).toBe(false);
      expect(adapter.error()?.code).toBe('vibrate-rejected');
      // Nothing was emitted: a refused pattern is not a haptic that happened.
      expect(adapter.current()).toBeNull();
    });
  });
});

describe('unsupported platforms', () => {
  it('says why, and buzz stays a no-op', () => {
    withGlobals({ navigator: { userAgent: 'iphone' } }, () => {
      const capability = vibrationCapability();
      expect(capability.supported).toBe(false);
      expect(capability.reason).toMatch(/vibrat/i);

      const adapter = createVibrationAdapter();
      adapter.start();
      const result = adapter.buzz({ source: 'camera-alert', state: 'in_range' });
      expect(result.ok).toBe(false);
      expect(adapter.enabled()).toBe(false);
    });
  });
});
