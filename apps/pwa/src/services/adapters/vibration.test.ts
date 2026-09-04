/**
 * Haptics are reserved for cameras. That is the test.
 */

import { describe, expect, it, vi } from 'vitest';
import tokens from '../../styles/tokens.json';
import {
  CAMERA_ALERT_PATTERNS,
  PULSE_PATTERNS,
  SilentChannelError,
  assertCameraAlertOnly,
  createVibrationAdapter,
  patternForPulses,
  vibrationCapability,
  type HapticSource,
} from './vibration';
import { withGlobals } from './testing/globals';
import { ALERT_STATES } from './types';

const PULSE = tokens.duration.instant;

function withVibrate(run: (vibrate: ReturnType<typeof vi.fn>) => void): void {
  const vibrate = vi.fn(() => true);
  withGlobals({ navigator: { vibrate } }, () => {
    run(vibrate);
  });
}

describe('the guard', () => {
  const silentSources: HapticSource[] = [
    'county-entry',
    'watchlist',
    'mesh-activity',
    'ui-feedback',
    'sync',
  ];

  it.each(silentSources)('throws for a %s caller', (source) => {
    expect(() => {
      assertCameraAlertOnly(source);
    }).toThrow(SilentChannelError);
  });

  it('lets a camera alert through', () => {
    expect(() => {
      assertCameraAlertOnly('camera-alert');
    }).not.toThrow();
  });

  it('blocks a non-camera caller before the device can buzz', () => {
    withVibrate((vibrate) => {
      const adapter = createVibrationAdapter();
      adapter.start();

      expect(() => adapter.buzz({ source: 'county-entry', state: 'in_range' })).toThrow(
        SilentChannelError,
      );
      expect(() => adapter.buzz({ source: 'watchlist', state: 'multiple' })).toThrow(
        SilentChannelError,
      );
      // The whole point: nothing reached the platform.
      expect(vibrate).not.toHaveBeenCalled();
      adapter.stop();
    });
  });
});

describe('patterns', () => {
  /** A pattern is [on, off, on, ...]; the pulses are the even indices. */
  function pulseCount(pattern: readonly number[]): number {
    return pattern.filter((_, index) => index % 2 === 0).length;
  }

  it('is 0 / 1 / 2 / 2, the same counts packages/core hands us', () => {
    // HAPTIC_PULSES_BY_STATE in packages/core/src/alert.ts. The engine says how
    // many pulses; this file says what a pulse is. They must not disagree.
    expect(pulseCount(CAMERA_ALERT_PATTERNS.clear)).toBe(0);
    expect(pulseCount(CAMERA_ALERT_PATTERNS.approaching)).toBe(1);
    expect(pulseCount(CAMERA_ALERT_PATTERNS.in_range)).toBe(2);
    expect(pulseCount(CAMERA_ALERT_PATTERNS.multiple)).toBe(2);
  });

  it('matches the design: clear is silent, approaching is one pulse', () => {
    expect(CAMERA_ALERT_PATTERNS.clear).toEqual([]);
    expect(CAMERA_ALERT_PATTERNS.approaching).toEqual([PULSE]);
  });

  it('matches the design: an alert is a 2-pulse haptic', () => {
    expect(CAMERA_ALERT_PATTERNS.in_range).toEqual([PULSE, PULSE, PULSE]);
    expect(CAMERA_ALERT_PATTERNS.multiple).toEqual([PULSE, PULSE, PULSE]);
  });

  it('maps a pulse count straight to a pattern for engine callers', () => {
    expect(patternForPulses(0)).toEqual([]);
    expect(patternForPulses(1)).toEqual(CAMERA_ALERT_PATTERNS.approaching);
    expect(patternForPulses(2)).toEqual(CAMERA_ALERT_PATTERNS.multiple);
  });

  it('takes every duration from the token scale, never a literal', () => {
    const durations = new Set<number>();
    for (const state of ALERT_STATES) {
      for (const value of CAMERA_ALERT_PATTERNS[state]) durations.add(value);
    }
    for (const pattern of Object.values(PULSE_PATTERNS)) {
      for (const value of pattern) durations.add(value);
    }
    const scale = new Set<number>(Object.values(tokens.duration));
    for (const value of durations) expect(scale.has(value)).toBe(true);
  });
});

describe('buzzing', () => {
  it('sends the pattern to the platform for a camera alert', () => {
    withVibrate((vibrate) => {
      const adapter = createVibrationAdapter();
      adapter.start();
      const result = adapter.buzz({ source: 'camera-alert', state: 'multiple' });

      expect(result.ok).toBe(true);
      expect(vibrate).toHaveBeenCalledWith([PULSE, PULSE, PULSE]);
      expect(adapter.current()?.state).toBe('multiple');
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

  it('does nothing while haptics are switched off', () => {
    withVibrate((vibrate) => {
      const adapter = createVibrationAdapter();
      const result = adapter.buzz({ source: 'camera-alert', state: 'in_range' });
      expect(result.ok).toBe(false);
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
