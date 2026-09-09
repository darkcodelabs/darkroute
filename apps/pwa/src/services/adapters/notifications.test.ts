/**
 * "silent below threshold, one channel per state, tag replaces so alerts never
 * stack" - design section 06, checked line by line.
 *
 * And the half that used to go unchecked. This file once asserted that
 * `data.channel` was "what android keys a channel off", which was never true in
 * any build that shipped: `data` is an opaque structured clone handed back on
 * notificationclick and the platform never reads it. So every assertion about
 * what makes one state different from another is made against the four fields
 * that DO reach the OS - `silent`, `renotify`, `vibrate` and the tag.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ABUSE_AREA_TAG,
  ABUSE_VIBRATION,
  ALERT_CHANNELS,
  CAMERA_ALERT_TAG,
  CAMERA_VIBRATION,
  NAVIGATION_TAG,
  NAVIGATION_VIBRATION,
  NOTIFICATION_KINDS,
  SILENT_VIBRATION,
  WATCHLIST_TAG,
  composeNotification,
  createNotificationsAdapter,
  isSilentChannel,
  notificationsCapability,
  type AbuseAreaPayload,
  type CameraAlertPayload,
  type CardRenderer,
  type NavigationPayload,
  type NotificationKind,
  type NotificationPayload,
  type WatchlistPayload,
} from './notifications';
import { withGlobals, withGlobalsAsync } from './testing/globals';
import { ALERT_STATES } from './types';

interface Shown {
  readonly title: string;
  readonly options: Record<string, unknown>;
}

const shown: Shown[] = [];
const closed: string[] = [];

/** Chrome draws two. `maxActions` is writable so a test can shrink it. */
const PLATFORM_MAX_ACTIONS = 2;

/**
 * Longer than the adapter's internal card deadline by any plausible margin.
 * The deadline itself is not exported and should not be: a test that pins the
 * exact millisecond would fail the day someone tunes it, which is not a bug.
 */
const WELL_PAST_THE_CARD_DEADLINE_MS = 1_000;

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static maxActions = PLATFORM_MAX_ACTIONS;
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

/** noUncheckedIndexedAccess: a missing card is a failed test, not `undefined`. */
function optionsAt(index: number): Record<string, unknown> {
  const entry = shown[index];
  if (entry === undefined) throw new Error(`nothing was posted at index ${String(index)}`);
  return entry.options;
}

/** Posts one payload through the real adapter and hands back what the platform got. */
async function post(
  payload: NotificationPayload,
  renderCard?: CardRenderer,
): Promise<Record<string, unknown>> {
  return withGlobalsAsync(fakeGlobals(), async () => {
    const adapter = createNotificationsAdapter(renderCard === undefined ? {} : { renderCard });
    adapter.start();
    await adapter.show(payload);
    return optionsAt(shown.length - 1);
  });
}

const APPROACHING: CameraAlertPayload = {
  kind: 'camera-alert',
  state: 'approaching',
  distanceFt: 820,
  bearingLabel: 'ahead · closing',
  inRangeCount: 0,
};

const IN_RANGE: CameraAlertPayload = {
  kind: 'camera-alert',
  state: 'in_range',
  distanceFt: 425,
  bearingLabel: 'ahead · slight left',
  inRangeCount: 3,
};

const ENTERED: AbuseAreaPayload = {
  kind: 'abuse-area',
  trigger: 'entered',
  county: 'Hamilton Co',
  incidentCount: 6,
  cameraCount: 88,
};

const NEARBY: AbuseAreaPayload = {
  kind: 'abuse-area',
  trigger: 'nearby',
  county: 'Hamilton Co',
  incidentCount: 6,
  cameraCount: 88,
  distanceFt: 1_200,
};

const TURN: NavigationPayload = {
  kind: 'navigation',
  instruction: 'Turn right onto West 119th Street.',
  turn: 'right',
  distanceFt: 900,
};

const WATCHLIST: WatchlistPayload = { kind: 'watchlist', newReadCount: 1 };

const SAMPLES: Readonly<Record<NotificationKind, NotificationPayload>> = {
  'camera-alert': IN_RANGE,
  'abuse-area': ENTERED,
  watchlist: WATCHLIST,
  navigation: TURN,
};

beforeEach(() => {
  shown.length = 0;
  closed.length = 0;
  FakeNotification.permission = 'granted';
  FakeNotification.maxActions = PLATFORM_MAX_ACTIONS;
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

  it('names the channel in data as a label only - the tag is what the platform sees', async () => {
    await withGlobalsAsync(fakeGlobals(), async () => {
      const adapter = createNotificationsAdapter();
      adapter.start();
      await adapter.show(APPROACHING);
      await adapter.show(IN_RANGE);

      const quiet = optionsAt(0);
      const loud = optionsAt(1);
      // The two cards carry different channel labels and land on the SAME
      // platform channel, because they share a tag and a web page cannot name
      // an android channel. `data` is only what notificationclick reads back.
      expect(quiet['data']).toEqual({
        channel: 'alert-approaching',
        kind: 'camera-alert',
        url: '/?screen=drive',
      });
      expect(loud['data']).toEqual({
        channel: 'alert-in-range',
        kind: 'camera-alert',
        url: '/?screen=drive',
      });
      expect(quiet['tag']).toBe(loud['tag']);
      // What actually differentiates them, all four of it.
      expect(quiet['silent']).toBe(true);
      expect(loud['silent']).toBe(false);
      expect(quiet['renotify']).toBe(false);
      expect(loud['renotify']).toBe(true);
      expect('vibrate' in quiet).toBe(false);
      expect(loud['vibrate']).toEqual([...CAMERA_VIBRATION]);
    });
  });
});

describe('haptics on the notification', () => {
  it('gives the in-range alert the camera pattern and lets it make noise', () => {
    const composed = composeNotification(IN_RANGE);
    expect(composed.silent).toBe(false);
    expect(composed.vibrate).toEqual(CAMERA_VIBRATION);
  });

  it('composes approaching silent, with no pattern to contradict the silence', () => {
    const composed = composeNotification(APPROACHING);
    expect(composed.silent).toBe(true);
    expect(composed.vibrate).toEqual(SILENT_VIBRATION);
  });

  it('omits the vibrate key entirely on a silent card rather than sending an empty one', async () => {
    const options = await post(APPROACHING);
    // Absent, not empty. An empty pattern is still a request, and a reader of
    // the posted options would take it as one.
    expect('vibrate' in options).toBe(false);
    expect(Object.keys(options)).not.toContain('vibrate');
  });

  it('gives the abuse card a pattern a driver can tell apart from a camera', () => {
    expect(composeNotification(ENTERED).vibrate).toEqual(ABUSE_VIBRATION);
    expect(ABUSE_VIBRATION).not.toEqual(CAMERA_VIBRATION);
  });

  it('gives the turn card the quietest pattern of the three', () => {
    expect(composeNotification(TURN).vibrate).toEqual(NAVIGATION_VIBRATION);
    expect(NAVIGATION_VIBRATION).not.toEqual(CAMERA_VIBRATION);
  });
});

describe('camera composition', () => {
  it('renders the camera alert the way RADAR does', () => {
    const composed = composeNotification(IN_RANGE);
    expect(composed.title).toBe('425 ft');
    expect(composed.body).toBe('ahead · slight left · 3 in range');
    expect(composed.channel).toBe('alert-in-range');
  });

  it('prints the in-range count only when it is not the distance said twice', () => {
    const one = composeNotification({ ...IN_RANGE, inRangeCount: 1 });
    // The bug this closes: "no camera is near you · 1 in range", one author's
    // disclaimer in the bearing slot and a tail that could not see it.
    expect(one.body).toBe('ahead · slight left');
    expect(one.body).not.toContain('in range');

    expect(composeNotification({ ...IN_RANGE, inRangeCount: 2 }).body).toBe(
      'ahead · slight left · 2 in range',
    );
  });

  it('does not open the body with a dangling separator when there is no bearing', () => {
    const composed = composeNotification({
      kind: 'camera-alert',
      state: 'multiple',
      distanceFt: 300,
      bearingLabel: '',
      inRangeCount: 4,
    });
    expect(composed.body).toBe('4 in range');
    expect(composed.body.startsWith('·')).toBe(false);
    expect(composed.body.trimStart()).toBe(composed.body);
  });
});

describe('abuse area', () => {
  it('says "you are in it" and "it is over there" as different sentences', () => {
    const entered = composeNotification(ENTERED);
    const nearby = composeNotification(NEARBY);
    expect(entered.title).toBe('entering Hamilton Co');
    expect(nearby.title).toBe('Hamilton Co · 1200 ft');
    expect(entered.title).not.toBe(nearby.title);
  });

  it('is not silent - a driver who asked to be told is not told quietly', () => {
    expect(composeNotification(ENTERED).silent).toBe(false);
    expect(composeNotification(NEARBY).silent).toBe(false);
  });

  it('keeps the counts in the body where android will not truncate them', () => {
    expect(composeNotification(ENTERED).body).toBe('6 documented misuse · 88 cameras');
    expect(
      composeNotification({ ...ENTERED, worstCase: 'repeated plate searches on an ex-partner' })
        .body,
    ).toBe('6 documented misuse · 88 cameras · repeated plate searches on an ex-partner');
  });
});

describe('navigation', () => {
  it('swaps the number for "now" at the mouth of the turn', () => {
    expect(composeNotification(TURN).title).toBe('900 ft · Turn right onto West 119th Street.');
    expect(composeNotification({ ...TURN, distanceFt: 60 }).title).toBe(
      'now · Turn right onto West 119th Street.',
    );
  });

  it('says "arriving" on the last manoeuvre, whatever the distance is', () => {
    expect(composeNotification({ ...TURN, distanceFt: 40, arriving: true }).title).toBe(
      'arriving · Turn right onto West 119th Street.',
    );
    expect(composeNotification({ ...TURN, distanceFt: 900, arriving: true }).title).toBe(
      'arriving · Turn right onto West 119th Street.',
    );
  });

  it('joins the trip figures it has and omits the ones the route does not know', () => {
    expect(
      composeNotification({ ...TURN, etaMinutes: 14, milesRemaining: 6.4, avoided: 3 }).body,
    ).toBe('14 min · 6.4 mi · 3 avoided');
    expect(composeNotification({ ...TURN, etaMinutes: 14 }).body).toBe('14 min');
    expect(composeNotification({ ...TURN, avoided: 3 }).body).toBe('3 avoided');
    expect(composeNotification(TURN).body).toBe('');
  });

  it('names a street, which every camera payload refuses to do', () => {
    // The asymmetry is the privacy position: the driver typed this destination.
    expect(composeNotification(TURN).title).toContain('West 119th Street');
    expect(JSON.stringify(composeNotification(IN_RANGE))).not.toMatch(/street|ave|blvd/i);
  });
});

describe('watchlist', () => {
  it('cannot put a plate on a lock screen: the watchlist payload has no field for one', () => {
    const composed = composeNotification(WATCHLIST);
    expect(composed.tag).toBe(WATCHLIST_TAG);
    expect(composed.title).toBe('new read on a watched plate');
    expect(composed.body).toBe('open darkroute to see which one.');
    // Nothing plate-shaped, and nothing that could locate the car.
    expect(JSON.stringify(composed)).not.toMatch(/[A-Z]{3}\s?\d{4}/);
  });

  it('stays silent, with no pattern - haptics mean a camera', () => {
    const composed = composeNotification(WATCHLIST);
    expect(composed.silent).toBe(true);
    expect(composed.renotify).toBe(false);
    expect(composed.vibrate).toEqual(SILENT_VIBRATION);
  });

  it('pluralises without leaking how many plates are watched', () => {
    expect(composeNotification({ kind: 'watchlist', newReadCount: 4 }).title).toBe(
      '4 new reads on watched plates',
    );
  });
});

describe('every kind', () => {
  it.each(NOTIFICATION_KINDS)('composes %s into a titled card with a tag', (kind) => {
    const composed = composeNotification(SAMPLES[kind]);
    expect(composed.title.length).toBeGreaterThan(0);
    expect(composed.tag.length).toBeGreaterThan(0);
    expect(composed.timestamp).toBeGreaterThan(0);
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
      expect(optionsAt(0)['tag']).toBe(CAMERA_ALERT_TAG);
      expect(optionsAt(1)['tag']).toBe(CAMERA_ALERT_TAG);
      // The first card was taken down before the second went up.
      expect(closed).toEqual([CAMERA_ALERT_TAG]);
    });
  });

  it('gives every non-camera card its own tag so none of them can evict an alert', () => {
    const tags = [CAMERA_ALERT_TAG, ABUSE_AREA_TAG, WATCHLIST_TAG, NAVIGATION_TAG];
    expect(new Set(tags).size).toBe(tags.length);
    expect(composeNotification(ENTERED).tag).toBe(ABUSE_AREA_TAG);
    expect(composeNotification(TURN).tag).toBe(NAVIGATION_TAG);
  });

  it('re-alerts on replacement only when the channel is allowed to make noise', async () => {
    await withGlobalsAsync(fakeGlobals(), async () => {
      const adapter = createNotificationsAdapter();
      adapter.start();
      await adapter.show(APPROACHING);
      await adapter.show(IN_RANGE);

      expect(optionsAt(0)['silent']).toBe(true);
      expect(optionsAt(0)['renotify']).toBe(false);
      expect(optionsAt(1)['silent']).toBe(false);
      expect(optionsAt(1)['renotify']).toBe(true);
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

describe('the two icon slots', () => {
  it('sends a different asset to badge than to icon', async () => {
    const options = await post(IN_RANGE);
    // BADGE is a 24dp alpha mask; ICON is drawn untinted. Pointing both at the
    // white-on-transparent mark is what rendered the icon invisible on a light
    // shade, so the two must not be the same url.
    expect(options['badge']).not.toBe(options['icon']);
    expect(String(options['badge'])).toMatch(/mark/);
    expect(String(options['icon'])).toMatch(/app-icon/);
  });
});

describe('actions', () => {
  it('slices the buttons down to what the platform says it will draw', async () => {
    await withGlobalsAsync(fakeGlobals(), async () => {
      FakeNotification.maxActions = 1;
      const adapter = createNotificationsAdapter();
      adapter.start();
      await adapter.show(IN_RANGE);
      // Ordered most-useful-first, so the survivor is the useful one.
      expect(optionsAt(0)['actions']).toEqual([{ action: 'mute', title: 'Mute 10 min' }]);
    });
  });

  it('sends both buttons when the platform will draw both', async () => {
    const options = await post(IN_RANGE);
    expect(options['actions']).toEqual([
      { action: 'mute', title: 'Mute 10 min' },
      { action: 'open', title: 'Open' },
    ]);
  });
});

describe('the drawn card', () => {
  it('goes out as the image when the renderer produces one', async () => {
    const options = await post(IN_RANGE, async () => 'blob:darkroute/card');
    expect(options['image']).toBe('blob:darkroute/card');
  });

  it('leaves image off entirely when the renderer declines to draw', async () => {
    const options = await post(IN_RANGE, async () => null);
    expect('image' in options).toBe(false);
  });

  it('leaves image off when no renderer was injected at all', async () => {
    const options = await post(IN_RANGE);
    expect('image' in options).toBe(false);
  });

  it('posts the warning anyway when the renderer throws', async () => {
    vi.useFakeTimers();
    try {
      await withGlobalsAsync(fakeGlobals(), async () => {
        const adapter = createNotificationsAdapter({
          renderCard: () => Promise.reject(new Error('no canvas in this runtime')),
        });
        adapter.start();
        const result = await adapter.show(IN_RANGE);
        expect(result.outcome).toBe('shown');
        expect('image' in optionsAt(0)).toBe(false);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('posts the warning anyway when the renderer hangs', async () => {
    vi.useFakeTimers();
    try {
      await withGlobalsAsync(fakeGlobals(), async () => {
        // A warning that waited on a picture would be a warning that arrived
        // late, and late is the one thing this product cannot be.
        const adapter = createNotificationsAdapter({
          renderCard: () => new Promise<string | null>(() => undefined),
        });
        adapter.start();
        const pending = adapter.show(IN_RANGE);
        await vi.advanceTimersByTimeAsync(WELL_PAST_THE_CARD_DEADLINE_MS);
        const result = await pending;

        expect(result.outcome).toBe('shown');
        expect(shown).toHaveLength(1);
        expect('image' in optionsAt(0)).toBe(false);
      });
    } finally {
      vi.useRealTimers();
    }
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
