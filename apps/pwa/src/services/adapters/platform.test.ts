/**
 * The remaining adapters: compass, motion, wake lock, network, visibility,
 * share, clipboard, photo capture, battery, ambient light.
 */

import { describe, expect, it, vi } from 'vitest';
import { createAmbientLightAdapter, ambientLightCapability } from './ambientLight';
import { batteryCapability, createBatteryAdapter } from './battery';
import { cameraCaptureCapability, createCameraCaptureAdapter } from './cameraCapture';
import { clipboardCapability, createClipboardAdapter } from './clipboard';
import { createMotionAdapter, magnitudeOf, sampleFromEvent } from './motion';
import { createNetworkAdapter, readNetworkState } from './network';
import { HEADING_WAIT_MS, createOrientationAdapter, headingFromEvent } from './orientation';
import { createShareAdapter, fileShareCapability, shareCapability } from './share';
import { createVisibilityAdapter } from './visibility';
import { createWakeLockAdapter, wakeLockCapability } from './screenWakeLock';
import { withGlobals, withGlobalsAsync } from './testing/globals';

// ---------------------------------------------------------------------------
// orientation
// ---------------------------------------------------------------------------

describe('compass', () => {
  it('prefers the ios compass heading, which is already true north', () => {
    const event = Object.assign(new Event('deviceorientation'), {
      webkitCompassHeading: 223.4,
      webkitCompassAccuracy: 8,
      alpha: 12,
      absolute: false,
    }) as unknown as DeviceOrientationEvent;

    const heading = headingFromEvent(event, 1);
    expect(heading?.headingDeg).toBeCloseTo(223.4);
    expect(heading?.source).toBe('webkit-compass');
    expect(heading?.accuracyDeg).toBe(8);
    expect(heading?.absolute).toBe(true);
  });

  it('treats an ios accuracy of -1 as no accuracy claim at all', () => {
    const event = Object.assign(new Event('deviceorientation'), {
      webkitCompassHeading: 10,
      webkitCompassAccuracy: -1,
    }) as unknown as DeviceOrientationEvent;
    expect(headingFromEvent(event, 1)?.accuracyDeg).toBeNull();
  });

  it('mirrors spec alpha into a clockwise bearing', () => {
    const event = Object.assign(new Event('deviceorientationabsolute'), {
      alpha: 90,
      absolute: true,
    }) as unknown as DeviceOrientationEvent;
    const heading = headingFromEvent(event, 1);
    expect(heading?.headingDeg).toBe(270);
    expect(heading?.source).toBe('absolute-orientation');
  });

  it('flags a relative reading so nothing renders it as a bearing', () => {
    const event = Object.assign(new Event('deviceorientation'), {
      alpha: 0,
      absolute: false,
    }) as unknown as DeviceOrientationEvent;
    const heading = headingFromEvent(event, 1);
    expect(heading?.absolute).toBe(false);
    expect(heading?.source).toBe('relative-orientation');
  });

  it('returns null for an event carrying nothing usable', () => {
    expect(
      headingFromEvent(new Event('deviceorientation') as DeviceOrientationEvent, 1),
    ).toBeNull();
  });

  it('says so when no absolute heading ever arrives', () => {
    vi.useFakeTimers();
    try {
      const adapter = createOrientationAdapter();
      adapter.start();
      expect(adapter.hasFix()).toBe(false);
      vi.advanceTimersByTime(HEADING_WAIT_MS + 1);
      expect(adapter.error()?.code).toBe('no-heading-data');
      expect(adapter.error()?.message).toMatch(/by hand/);
      adapter.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the wait once a real heading lands', () => {
    vi.useFakeTimers();
    try {
      const adapter = createOrientationAdapter();
      adapter.start();
      window.dispatchEvent(
        Object.assign(new Event('deviceorientationabsolute'), { alpha: 41, absolute: true }),
      );
      vi.advanceTimersByTime(HEADING_WAIT_MS + 1);
      expect(adapter.hasFix()).toBe(true);
      expect(adapter.error()).toBeNull();
      expect(adapter.current()?.headingDeg).toBe(319);
      adapter.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops listening after stop', () => {
    const adapter = createOrientationAdapter();
    adapter.start();
    adapter.stop();
    window.dispatchEvent(
      Object.assign(new Event('deviceorientationabsolute'), { alpha: 10, absolute: true }),
    );
    expect(adapter.current()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// motion
// ---------------------------------------------------------------------------

describe('motion', () => {
  it('reads both acceleration vectors and the rotation rate', () => {
    const event = Object.assign(new Event('devicemotion'), {
      acceleration: { x: 0.3, y: -0.4, z: 0 },
      accelerationIncludingGravity: { x: 0.3, y: -0.4, z: 9.8 },
      rotationRate: { alpha: 1, beta: 2, gamma: 3 },
      interval: 16,
    }) as unknown as DeviceMotionEvent;

    const sample = sampleFromEvent(event, 7);
    expect(sample.accelerationMps2).toEqual({ x: 0.3, y: -0.4, z: 0 });
    expect(sample.rotationRateDegPerS).toEqual({ alpha: 1, beta: 2, gamma: 3 });
    expect(sample.intervalMs).toBe(16);
    expect(sample.timestamp).toBe(7);
    expect(magnitudeOf(sample.accelerationMps2)).toBeCloseTo(0.5);
  });

  it('reports an all-null vector as absent rather than as zero motion', () => {
    const event = Object.assign(new Event('devicemotion'), {
      acceleration: { x: null, y: null, z: null },
    }) as unknown as DeviceMotionEvent;
    expect(sampleFromEvent(event, 1).accelerationMps2).toBeNull();
    expect(magnitudeOf(null)).toBeNull();
  });

  it('emits through the adapter and stops on stop', () => {
    const adapter = createMotionAdapter();
    adapter.start();
    window.dispatchEvent(
      Object.assign(new Event('devicemotion'), { acceleration: { x: 3, y: 4, z: 0 } }),
    );
    expect(adapter.lastMagnitude()).toBeCloseTo(5);
    adapter.stop();
    window.dispatchEvent(
      Object.assign(new Event('devicemotion'), { acceleration: { x: 30, y: 40, z: 0 } }),
    );
    expect(adapter.lastMagnitude()).toBeCloseTo(5);
  });
});

// ---------------------------------------------------------------------------
// wake lock
// ---------------------------------------------------------------------------

class FakeSentinel extends EventTarget {
  released = false;
  release = vi.fn(async () => {
    this.released = true;
    this.dispatchEvent(new Event('release'));
  });
}

describe('screen wake lock', () => {
  it('says why it cannot hold the screen on', () => {
    const capability = wakeLockCapability();
    expect(capability.supported).toBe(false);
    expect(capability.reason).toMatch(/wake lock/i);
  });

  it('takes the lock once for two starts and gives it back once', async () => {
    const sentinel = new FakeSentinel();
    const request = vi.fn(async () => sentinel);
    await withGlobalsAsync({ navigator: { wakeLock: { request } } }, async () => {
      const adapter = createWakeLockAdapter();
      await adapter.start();
      await adapter.start();
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith('screen');
      expect(adapter.current()?.held).toBe(true);
      expect(adapter.wanted()).toBe(true);

      adapter.stop();
      adapter.stop();
      expect(sentinel.release).toHaveBeenCalledTimes(1);
      expect(adapter.current()?.held).toBe(false);
      expect(adapter.wanted()).toBe(false);
    });
  });

  it('reports a platform release without pretending it still holds the screen', async () => {
    const sentinel = new FakeSentinel();
    await withGlobalsAsync(
      { navigator: { wakeLock: { request: async () => sentinel } } },
      async () => {
        const adapter = createWakeLockAdapter();
        await adapter.start();
        sentinel.dispatchEvent(new Event('release'));
        expect(adapter.current()?.held).toBe(false);
        expect(adapter.current()?.lastRelease).toBe('by-platform');
        adapter.stop();
      },
    );
  });

  it('surfaces a refusal instead of claiming the screen will stay on', async () => {
    await withGlobalsAsync(
      {
        navigator: {
          wakeLock: {
            request: async () => {
              throw new Error('not allowed');
            },
          },
        },
      },
      async () => {
        const adapter = createWakeLockAdapter();
        await adapter.start();
        expect(adapter.error()?.code).toBe('wake-lock-refused');
        expect(adapter.current()?.held).toBe(false);
        adapter.stop();
      },
    );
  });
});

// ---------------------------------------------------------------------------
// network
// ---------------------------------------------------------------------------

describe('network', () => {
  it('reports online with no connection detail when the browser has none', () => {
    const state = readNetworkState(5);
    expect(state.online).toBe(true);
    expect(state.effectiveType).toBeNull();
    expect(state.connectionType).toBeNull();
    expect(state.timestamp).toBe(5);
  });

  it('reads the connection detail where it exists, and rejects a bogus type', () => {
    withGlobals(
      {
        navigator: {
          onLine: true,
          connection: {
            effectiveType: '4g',
            downlink: 9.2,
            rtt: 50,
            saveData: false,
            type: 'wifi',
          },
        },
      },
      () => {
        const state = readNetworkState(1);
        expect(state.effectiveType).toBe('4g');
        expect(state.downlinkMbps).toBe(9.2);
        expect(state.connectionType).toBe('wifi');
        expect(createNetworkAdapter().isUnmetered()).toBe(true);
      },
    );
    withGlobals({ navigator: { onLine: true, connection: { effectiveType: 'lte' } } }, () => {
      expect(readNetworkState(1).effectiveType).toBeNull();
    });
  });

  it('refuses to call an unknown link unmetered', () => {
    withGlobals({ navigator: { onLine: true } }, () => {
      expect(createNetworkAdapter().isUnmetered()).toBe(false);
    });
    withGlobals({ navigator: { onLine: false, connection: { type: 'wifi' } } }, () => {
      expect(createNetworkAdapter().isUnmetered()).toBe(false);
    });
  });

  it('emits when the browser goes offline', () => {
    const adapter = createNetworkAdapter();
    const seen: boolean[] = [];
    adapter.subscribe((state) => seen.push(state.online));
    adapter.start();
    window.dispatchEvent(new Event('offline'));
    expect(seen).toHaveLength(2);
    adapter.stop();
    window.dispatchEvent(new Event('online'));
    expect(seen).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// visibility
// ---------------------------------------------------------------------------

describe('visibility', () => {
  it('emits the current state on start and follows visibilitychange', () => {
    const adapter = createVisibilityAdapter();
    const seen: string[] = [];
    adapter.subscribe((state) => seen.push(state.visibility));
    adapter.start();
    expect(seen).toEqual(['visible']);
    expect(adapter.isVisible()).toBe(true);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      expect(seen).toEqual(['visible', 'hidden']);
      expect(adapter.isVisible()).toBe(false);
    } finally {
      Reflect.deleteProperty(document as unknown as Record<string, unknown>, 'visibilityState');
    }
    adapter.stop();
  });

  it('tracks the frozen state that android uses to stop our timers', () => {
    const adapter = createVisibilityAdapter();
    adapter.start();
    document.dispatchEvent(new Event('freeze'));
    expect(adapter.current()?.frozen).toBe(true);
    window.dispatchEvent(new Event('pageshow'));
    expect(adapter.current()?.frozen).toBe(false);
    adapter.stop();
  });
});

// ---------------------------------------------------------------------------
// share
// ---------------------------------------------------------------------------

describe('share', () => {
  it('says why it cannot share here', () => {
    expect(shareCapability().supported).toBe(false);
    expect(fileShareCapability().supported).toBe(false);
  });

  it('never builds a url of its own', async () => {
    const share = vi.fn(async (_data: ShareData) => undefined);
    await withGlobalsAsync({ navigator: { share } }, async () => {
      const adapter = createShareAdapter();
      adapter.start();
      await adapter.share({ kind: 'app-link', title: 'darkroute', text: 'we watching back' });
      const data = (share.mock.calls[0]?.[0] ?? {}) as unknown as Record<string, unknown>;
      expect(data['url']).toBeUndefined();
    });
  });

  it('passes a caller-supplied url straight through', async () => {
    const share = vi.fn(async (_data: ShareData) => undefined);
    await withGlobalsAsync({ navigator: { share } }, async () => {
      const adapter = createShareAdapter();
      adapter.start();
      await adapter.share({
        kind: 'app-link',
        title: 'darkroute',
        text: 'we watching back',
        url: 'https://example.invalid/a',
      });
      const data = (share.mock.calls[0]?.[0] ?? {}) as unknown as Record<string, unknown>;
      expect(data['url']).toBe('https://example.invalid/a');
    });
  });

  it('treats a dismissed sheet as cancelled, not as an error', async () => {
    const abort = new Error('user bailed');
    abort.name = 'AbortError';
    await withGlobalsAsync(
      {
        navigator: {
          share: async () => {
            throw abort;
          },
        },
      },
      async () => {
        const adapter = createShareAdapter();
        adapter.start();
        const outcome = await adapter.share({ kind: 'camera-intel', title: 'x', text: 'y' });
        expect(outcome.status).toBe('cancelled');
        expect(adapter.error()).toBeNull();
      },
    );
  });

  it('refuses files the browser will not take', async () => {
    const canShare = vi.fn(() => false);
    await withGlobalsAsync(
      { navigator: { share: vi.fn(async () => undefined), canShare } },
      async () => {
        const adapter = createShareAdapter();
        adapter.start();
        const outcome = await adapter.share({
          kind: 'zone-audit-card',
          title: 'zone audit',
          text: '47 readers',
          files: [new File(['x'], 'card.png', { type: 'image/png' })],
        });
        expect(outcome.status).toBe('unsupported');
        expect(outcome.withFiles).toBe(true);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// clipboard
// ---------------------------------------------------------------------------

describe('clipboard', () => {
  it('says why it cannot copy here', () => {
    expect(clipboardCapability().supported).toBe(false);
  });

  it('copies and records the write', async () => {
    const writeText = vi.fn(async () => undefined);
    await withGlobalsAsync({ navigator: { clipboard: { writeText } } }, async () => {
      const adapter = createClipboardAdapter();
      adapter.start();
      await expect(adapter.writeText('camera-id', 'FWM-0442')).resolves.toBe(true);
      expect(writeText).toHaveBeenCalledWith('FWM-0442');
      expect(adapter.current()).toEqual({
        kind: 'camera-id',
        characters: 8,
        ok: true,
        timestamp: expect.any(Number) as unknown as number,
      });
    });
  });

  it('reports a refusal instead of claiming the copy worked', async () => {
    await withGlobalsAsync(
      {
        navigator: {
          clipboard: {
            writeText: async () => {
              throw new Error('blocked');
            },
          },
        },
      },
      async () => {
        const adapter = createClipboardAdapter();
        adapter.start();
        await expect(adapter.writeText('report-hash', 'abc')).resolves.toBe(false);
        expect(adapter.error()?.code).toBe('write-failed');
      },
    );
  });
});

// ---------------------------------------------------------------------------
// camera capture
// ---------------------------------------------------------------------------

describe('photo capture', () => {
  it('is supported wherever there is a document', () => {
    expect(cameraCaptureCapability().supported).toBe(true);
  });

  it('asks the os camera app, and never claims the exif was cleaned', async () => {
    const adapter = createCameraCaptureAdapter();
    adapter.start();
    const promise = adapter.capture();

    const input = document.body.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input?.getAttribute('capture')).toBe('environment');
    expect(input?.getAttribute('accept')).toBe('image/*');

    const file = new File(['jpeg-bytes'], 'cam.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input?.dispatchEvent(new Event('change'));

    const photo = await promise;
    expect(photo?.mimeType).toBe('image/jpeg');
    expect(photo?.metadataStripped).toBe(false);
    // The hidden input is taken back out of the document.
    expect(document.body.querySelector('input[type="file"]')).toBeNull();
    adapter.stop();
  });

  it('resolves null when the picker is abandoned', async () => {
    const adapter = createCameraCaptureAdapter();
    adapter.start();
    const promise = adapter.capture();
    adapter.abort();
    await expect(promise).resolves.toBeNull();
    adapter.stop();
  });
});

// ---------------------------------------------------------------------------
// battery
// ---------------------------------------------------------------------------

class FakeBattery extends EventTarget {
  level = 0.42;
  charging = false;
  chargingTime = 0;
  dischargingTime = 5400;
}

describe('battery', () => {
  it('says why it has no reading here', () => {
    const capability = batteryCapability();
    expect(capability.supported).toBe(false);
    expect(capability.reason).toMatch(/battery/i);
  });

  it('reads the level and follows a level change', async () => {
    const manager = new FakeBattery();
    await withGlobalsAsync({ navigator: { getBattery: async () => manager } }, async () => {
      const adapter = createBatteryAdapter();
      await adapter.start();
      expect(adapter.current()?.level).toBe(0.42);
      expect(adapter.current()?.chargingTimeS).toBeNull();
      expect(adapter.current()?.dischargingTimeS).toBe(5400);

      manager.level = 0.08;
      manager.dispatchEvent(new Event('levelchange'));
      expect(adapter.isBelow(0.1)).toBe(true);
      adapter.stop();
    });
  });
});

// ---------------------------------------------------------------------------
// ambient light
// ---------------------------------------------------------------------------

class FakeLightSensor extends EventTarget {
  static last: FakeLightSensor | null = null;
  illuminance = 0;
  started = 0;
  stopped = 0;

  constructor() {
    super();
    FakeLightSensor.last = this;
  }

  start(): void {
    this.started += 1;
  }

  stop(): void {
    this.stopped += 1;
  }
}

describe('ambient light', () => {
  it('is honest that almost nothing ships it', () => {
    const capability = ambientLightCapability();
    expect(capability.supported).toBe(false);
    expect(capability.reason).toMatch(/chromium-only|not available/i);
  });

  it('emits lux where the sensor exists, and is idempotent', () => {
    withGlobals({ AmbientLightSensor: FakeLightSensor }, () => {
      const adapter = createAmbientLightAdapter();
      adapter.start();
      adapter.start();
      const sensor = FakeLightSensor.last;
      expect(sensor?.started).toBe(1);

      if (sensor) sensor.illuminance = 12;
      sensor?.dispatchEvent(new Event('reading'));
      expect(adapter.lux()).toBe(12);

      adapter.stop();
      adapter.stop();
      expect(sensor?.stopped).toBe(1);
    });
  });

  it('records a sensor error rather than freezing on the last value', () => {
    withGlobals({ AmbientLightSensor: FakeLightSensor }, () => {
      const adapter = createAmbientLightAdapter();
      adapter.start();
      FakeLightSensor.last?.dispatchEvent(new Event('error'));
      expect(adapter.error()?.code).toBe('sensor-error');
      adapter.stop();
    });
  });
});
