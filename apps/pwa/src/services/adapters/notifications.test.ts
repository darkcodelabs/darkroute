/**
 * "silent below threshold, one channel per state, tag replaces so alerts never
 * stack" - design section 06, checked line by line.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALERT_CHANNELS,
  CAMERA_ALERT_TAG,
  COUNTY_RECORD_TAG,
  WATCHLIST_TAG,
  composeNotification,
  createNotificationsAdapter,
  isSilentChannel,
  notificationsCapability,
  type NotificationPayload,
} from './notifications';
import { withGlobals, withGlobalsAsync } from './testing/globals';
import { ALERT_STATES } from './types';

interface Shown {
  readonly title: string;
  readonly options: Record<string, unknown>;
}

const shown: Shown[] = [];
const closed: string[] = [];

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  readonly tag: string;

  constructor(title: string, options?: NotificationOptions) {
    const bag = (options ?? {}) as unknown as Record<string, unknown>;
    this.tag = String(bag['tag'] ?? '');
    shown.push({ title, options: bag });
  }

  close(): void {
    closed.push(this.tag);
  }
}

function fakeGlobals(): Record<string, unknown> {
  return { Notification: FakeNotification, navigator: { userAgent: 'test' } };
}

const APPROACHING: NotificationPayload = {
  kind: 'camera-alert',
  state: 'approaching',
  distanceFt: 820,
  bearingLabel: 'ahead · closing',
  inRangeCount: 0,
};

const IN_RANGE: NotificationPayload = {
  kind: 'camera-alert',
  state: 'in_range',
  distanceFt: 425,
  bearingLabel: 'ahead · slight left',
  inRangeCount: 3,
};

beforeEach(() => {
  shown.length = 0;
  closed.length = 0;
  FakeNotification.permission = 'granted';
});

describe('channels', () => {
  it('has one channel per alert state, all distinct', () => {
    const channels = ALERT_STATES.map((state) => ALERT_CHANNELS[state]);
    expect(new Set(channels).size).toBe(ALERT_STATES.length);
  });

  it('keeps everything below the alert threshold silent', () => {
    expect(isSilentChannel(ALERT_CHANNELS.clear)).toBe(true);
    expect(isSilentChannel(ALERT_CHANNELS.approaching)).toBe(true);
    expect(isSilentChannel(ALERT_CHANNELS.in_range)).toBe(false);
    expect(isSilentChannel(ALERT_CHANNELS.multiple)).toBe(false);
  });

  it('keeps county entry and watchlist silent - haptics are for cameras', () => {
    expect(
      composeNotification({
        kind: 'county-record',
        county: 'Hamilton Co',
        incidentCount: 6,
        cameraCount: 88,
      }).silent,
    ).toBe(true);
    expect(composeNotification({ kind: 'watchlist', newReadCount: 1 }).silent).toBe(true);
  });
});

describe('composition', () => {
  it('renders the camera alert the way RADAR does', () => {
    const composed = composeNotification(IN_RANGE);
    expect(composed.title).toBe('425 ft');
    expect(composed.body).toBe('ahead · slight left · 3 in range');
    expect(composed.channel).toBe('alert-in-range');
  });

  it('renders the county line from the design copy', () => {
    const composed = composeNotification({
      kind: 'county-record',
      county: 'Hamilton Co',
      incidentCount: 6,
      cameraCount: 88,
      worstCase: 'Worst: repeated plate searches on an ex-partner, Jun 2026.',
    });
    expect(composed.title).toBe('Hamilton Co: 6 documented misuse incidents, 88 cameras.');
    expect(composed.body).toBe('Worst: repeated plate searches on an ex-partner, Jun 2026.');
    expect(composed.tag).toBe(COUNTY_RECORD_TAG);
  });

  it('cannot put a plate on a lock screen: the watchlist payload has no field for one', () => {
    const composed = composeNotification({ kind: 'watchlist', newReadCount: 1 });
    expect(composed.tag).toBe(WATCHLIST_TAG);
    expect(composed.title).toBe('new read on a watched plate');
    expect(composed.body).toBe('open darkroute to see which one.');
    // Nothing plate-shaped, and nothing that could locate the car.
    expect(JSON.stringify(composed)).not.toMatch(/[A-Z]{3}\s?\d{4}/);
  });

  it('pluralises without leaking how many plates are watched', () => {
    expect(composeNotification({ kind: 'watchlist', newReadCount: 4 }).title).toBe(
      '4 new reads on watched plates',
    );
  });
});

describe('tag replacement', () => {
  it('gives every camera alert the same tag so alerts never stack', async () => {
    await withGlobalsAsync(fakeGlobals(), async () => {
      const adapter = createNotificationsAdapter();
      adapter.start();

      await adapter.show(APPROACHING);
      await adapter.show(IN_RANGE);

      expect(shown).toHaveLength(2);
      expect(shown[0]?.options['tag']).toBe(CAMERA_ALERT_TAG);
      expect(shown[1]?.options['tag']).toBe(CAMERA_ALERT_TAG);
      // The first card was taken down before the second went up.
      expect(closed).toEqual([CAMERA_ALERT_TAG]);
    });
  });

  it('gives county and watchlist their own tags so they cannot evict an alert', () => {
    const county = composeNotification({
      kind: 'county-record',
      county: 'Hamilton Co',
      incidentCount: 6,
      cameraCount: 88,
    });
    const watchlist = composeNotification({ kind: 'watchlist', newReadCount: 1 });
    expect(new Set([CAMERA_ALERT_TAG, county.tag, watchlist.tag]).size).toBe(3);
  });

  it('re-alerts on replacement only when the channel is allowed to make noise', async () => {
    await withGlobalsAsync(fakeGlobals(), async () => {
      const adapter = createNotificationsAdapter();
      adapter.start();
      await adapter.show(APPROACHING);
      await adapter.show(IN_RANGE);

      expect(shown[0]?.options['silent']).toBe(true);
      expect(shown[0]?.options['renotify']).toBe(false);
      expect(shown[1]?.options['silent']).toBe(false);
      expect(shown[1]?.options['renotify']).toBe(true);
    });
  });

  it('routes the channel through data so android can key a channel off it', async () => {
    await withGlobalsAsync(fakeGlobals(), async () => {
      const adapter = createNotificationsAdapter();
      adapter.start();
      await adapter.show(IN_RANGE);
      expect(shown[0]?.options['data']).toEqual({ channel: 'alert-in-range' });
    });
  });

  it('takes the card down for clear rather than posting one', async () => {
    await withGlobalsAsync(fakeGlobals(), async () => {
      const adapter = createNotificationsAdapter();
      adapter.start();
      await adapter.show(IN_RANGE);
      const result = await adapter.show({
        kind: 'camera-alert',
        state: 'clear',
        distanceFt: 12_672,
        bearingLabel: 'nearest 2.4 mi',
        inRangeCount: 0,
      });
      expect(result.outcome).toBe('cleared');
      expect(shown).toHaveLength(1);
      expect(closed).toContain(CAMERA_ALERT_TAG);
    });
  });
});

describe('permission', () => {
  it('surfaces a denial as denied and never throws', async () => {
    await withGlobalsAsync(fakeGlobals(), async () => {
      FakeNotification.permission = 'denied';
      const adapter = createNotificationsAdapter();
      await expect(adapter.request()).resolves.toBe('denied');
      await expect(adapter.permission()).resolves.toBe('denied');
    });
  });

  it('refuses to post without permission, and says so', async () => {
    await withGlobalsAsync(fakeGlobals(), async () => {
      FakeNotification.permission = 'denied';
      const adapter = createNotificationsAdapter();
      adapter.start();
      expect(adapter.error()?.code).toBe('not-granted');

      const result = await adapter.show(IN_RANGE);
      expect(result.outcome).toBe('blocked');
      expect(shown).toHaveLength(0);
    });
  });

  it('reports unsupported, with a reason, where the api does not exist', async () => {
    const capability = notificationsCapability();
    expect(capability.supported).toBe(false);
    expect(capability.reason).toMatch(/notification/i);

    await withGlobalsAsync({ Notification: undefined }, async () => {
      const adapter = createNotificationsAdapter();
      const result = await adapter.show(IN_RANGE);
      expect(result.outcome).toBe('unsupported');
    });
  });
});

describe('emitted events', () => {
  it('carry a channel and a tag and no text at all', async () => {
    await withGlobalsAsync(fakeGlobals(), async () => {
      const adapter = createNotificationsAdapter();
      adapter.start();
      const seen: unknown[] = [];
      adapter.subscribe((event) => seen.push(event));
      await adapter.show(IN_RANGE);

      expect(seen).toHaveLength(1);
      // The full key set, asserted exactly: no title, no body, no distance.
      expect(Object.keys(seen[0] as object).sort()).toEqual([
        'channel',
        'outcome',
        'silent',
        'tag',
        'timestamp',
      ]);
      const json = JSON.stringify(seen[0]);
      expect(json).toContain('alert-in-range');
      expect(json).not.toContain('slight left');
    });
  });
});

describe('service worker path', () => {
  it('prefers the registration when one is available', async () => {
    const showNotification = vi.fn(async () => undefined);
    const getNotifications = vi.fn(async () => []);
    await withGlobalsAsync(
      {
        Notification: FakeNotification,
        navigator: {
          serviceWorker: {
            getRegistration: async () => ({ showNotification, getNotifications }),
          },
        },
      },
      async () => {
        const adapter = createNotificationsAdapter();
        adapter.start();
        await adapter.show(IN_RANGE);
        expect(showNotification).toHaveBeenCalledTimes(1);
        expect(shown).toHaveLength(0);
        const [, options] = showNotification.mock.calls[0] as unknown as [
          string,
          Record<string, unknown>,
        ];
        expect(options['tag']).toBe(CAMERA_ALERT_TAG);
      },
    );
  });
});

describe('stop', () => {
  it('is idempotent and takes down what it opened', async () => {
    await withGlobalsAsync(fakeGlobals(), async () => {
      const adapter = createNotificationsAdapter();
      adapter.start();
      await adapter.show(IN_RANGE);
      adapter.stop();
      adapter.stop();
      expect(closed).toEqual([CAMERA_ALERT_TAG]);
    });
  });
});

describe('capability with no window at all', () => {
  it('does not throw', () => {
    withGlobals({ Notification: undefined }, () => {
      expect(() => notificationsCapability()).not.toThrow();
    });
  });
});
