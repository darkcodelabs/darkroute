/**
 * DELIVERY - that an alert actually reaches the driver's hands.
 *
 * Every camera tick here comes from the REAL `@fwm/core` engine driven by a
 * test clock, for the reason `stores/alert.test.ts` gives: a wire proved
 * against hand-written ticks proves nothing about the shipped driving loop.
 * This is the file that would have caught `buzz()` having no callers.
 *
 * =============================================================================
 * WHY THE VIBRATION AND SPEECH DOUBLES ARE LOCAL
 * =============================================================================
 * `testing/mocks.ts` has a `MockVibrationAdapter`, and it is mid-rename: it
 * still imports `assertCameraAlertOnly` and calls `patternFor(state)`, neither
 * of which `vibration.ts` exports any more, so `buzz()` throws a TypeError
 * before it records anything. It also has no speech-synthesis mock at all,
 * because `AdapterSet` has no `speech` member yet.
 *
 * So both doubles are built here, and both run the REAL guards - `assertCanBuzz`
 * and the real `SOURCE_PATTERNS` table - rather than a copy of them, for the
 * same reason the shared mocks do: a test that gets past the guard here would
 * get past it on a device. They record the SOURCE of every buzz, which is the
 * thing these tests are about now that three different sources may buzz and
 * only one of them is allowed the camera signature.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { alertActions, useAlertStore } from '../../stores/alert.ts';
import { createAlertEngine, createTestClock } from '../../stores/fwmCore.ts';
import type { AlertState, AlertTick, CameraLike } from '../../stores/fwmCore.ts';
import { positionActions } from '../../stores/position.ts';
import { routeActions } from '../../stores/route.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import { resetAllStores } from '../../stores/index.ts';
import { createCore } from '../adapters/core.ts';
import {
  ABUSE_AREA_TAG,
  CAMERA_ALERT_TAG,
  NAVIGATION_TAG,
  WATCHLIST_TAG,
  type NotificationEvent,
} from '../adapters/notifications.ts';
import type { SpeechRequest, SpeechSynthesisAdapter } from '../adapters/speech.ts';
import {
  SOURCE_PATTERNS,
  assertCanBuzz,
  patternFor,
  type HapticSource,
  type VibrationAdapter,
  type VibrationEvent,
  type VibrationRequest,
  type VibrationResult,
} from '../adapters/vibration.ts';
import { ok } from '../adapters/types.ts';
import { createMockAdapters } from '../adapters/testing/mocks.ts';
import type { MockAdapterSet, MockNotificationsAdapter } from '../adapters/testing/mocks.ts';
import type { AdapterSet } from '../adapters/set.ts';
import type { Maneuver, PlannedRoute, RoutePoint } from '../route/planRoute.ts';
import {
  cardTagFor,
  createAlertDelivery,
  createCountyAbuseSource,
  renderNotificationCard,
  type AbuseAreaSighting,
  type AbuseAreaSource,
  type AlertDelivery,
} from './delivery.ts';

// ---------------------------------------------------------------------------
// The two local doubles
// ---------------------------------------------------------------------------

type RecordedBuzz = { readonly source: HapticSource; readonly state?: AlertState };

type RecordingVibration = VibrationAdapter & { readonly buzzes: () => readonly RecordedBuzz[] };

function createRecordingVibration(): RecordingVibration {
  const core = createCore<VibrationEvent>();
  const recorded: RecordedBuzz[] = [];
  return {
    name: 'vibration',
    capability: ok,
    start: () => {
      core.setRunning(true);
    },
    stop: () => {
      core.setRunning(false);
    },
    patternFor,
    enabled: core.running,
    buzz(request: VibrationRequest): VibrationResult {
      // The real guard, not a copy of it.
      assertCanBuzz(request.source);
      const pattern = patternFor(request);
      if (!core.running()) {
        // Word for word what the real adapter returns, including the screen it
        // names - a double that refuses with a different sentence is one a test
        // can pass against while the device says something else.
        return { ok: false, pattern, reason: 'haptics are switched off in the map view panel' };
      }
      if (pattern.length === 0) {
        return { ok: false, pattern, reason: 'this alert state is silent by design' };
      }
      recorded.push({
        source: request.source,
        ...(request.state === undefined ? {} : { state: request.state }),
      });
      return { ok: true, pattern };
    },
    buzzes: () => [...recorded],
    current: core.current,
    error: core.error,
    subscribe: core.subscribe,
  };
}

type RecordingSpeech = SpeechSynthesisAdapter & { readonly said: () => readonly SpeechRequest[] };

function createRecordingSpeech(): RecordingSpeech {
  const core = createCore<never>();
  const recorded: SpeechRequest[] = [];
  return {
    name: 'speech',
    capability: ok,
    start: () => {
      core.setRunning(true);
    },
    stop: () => {
      core.setRunning(false);
    },
    speak(request: SpeechRequest) {
      // The switch is the adapter's running flag, exactly as in the real one:
      // a stopped adapter refuses rather than the caller branching.
      if (!core.running()) {
        return { ok: false, source: request.source, outcome: 'blocked' as const, cancelled: false };
      }
      recorded.push(request);
      return { ok: true, source: request.source, outcome: 'accepted' as const, cancelled: false };
    },
    enabled: core.running,
    speaking: () => false,
    said: () => [...recorded],
    current: core.current,
    error: core.error,
    subscribe: core.subscribe,
  };
}

// ---------------------------------------------------------------------------
// The drive
// ---------------------------------------------------------------------------

const CAMERA_A: CameraLike = { id: 'FWM-0442', lat: 39.11, lon: -84.5786, directionDeg: 180 };
const CAMERA_B: CameraLike = { id: 'FWM-0443', lat: 39.1101, lon: -84.5788, directionDeg: 180 };
const CAMERAS: readonly CameraLike[] = [CAMERA_A, CAMERA_B];

/** The same northbound approach the alert slice's own tests drive. */
const APPROACH_LATS = [39.1, 39.105, 39.1077, 39.1085, 39.1093];
/** And on past both of them, until the engine calls it clear again. */
const DEPART_LATS = [39.115, 39.13, 39.16, 39.2];
const START_MS = 1_000_000;
const STEP_MS = 2_000;
const SPEED_MPS = 21;

/**
 * ONE ENGINE FOR THE WHOLE DRIVE, because leaving range is a transition and a
 * second engine started at the far end has never been in range to leave.
 */
function createDriver(): (lats: readonly number[]) => AlertTick[] {
  const clock = createTestClock(START_MS);
  const engine = createAlertEngine({ clock });
  return (lats) =>
    lats.map((lat) => {
      const tick = engine.update(
        {
          lat,
          lon: -84.5786,
          headingDeg: 0,
          speedMps: SPEED_MPS,
          accuracyM: 4,
          timestampMs: clock.now(),
        },
        CAMERAS,
      );
      clock.advance(STEP_MS);
      return tick;
    });
}

/**
 * Permission is driven through the ADAPTER, not through a fake global.
 *
 * The mock reproduces the real adapter's refusal exactly -- `show()` returns
 * `blocked` for anything but `granted` and never prompts -- so a test that
 * gets past it would get past the real one, which is the whole point of
 * testing through the adapter rather than around it.
 */
const permit = (state: 'granted' | 'denied' | 'prompt'): void => {
  notifications.mock.setPermission(state);
};

let mocks: MockAdapterSet;
let adapters: AdapterSet;
let notifications: MockNotificationsAdapter;
let vibration: RecordingVibration;
let speech: RecordingSpeech;
let delivery: AlertDelivery | null = null;

/**
 * EVERY POST, not every card on the shade.
 *
 * `notifications.shown()` reproduces the platform's replacement rule - one
 * entry per tag, the new card evicting the old - which is right for asking
 * "what is on the shade" and useless for asking "how many times did we post".
 * Counting it would make a repetition test vacuous: three abuse cards under one
 * tag read as one card, and a dedupe that had stopped working would pass. The
 * event stream is the count, and it is the same stream the adapter emits on a
 * device.
 */
let posts: NotificationEvent[] = [];

const postsFor = (tag: string): readonly NotificationEvent[] =>
  posts.filter((event) => event.tag === tag && event.outcome === 'shown');

beforeEach(() => {
  resetAllStores();
  // `resetAllStores` does not know about the route slice - it is memory-only
  // and cleared when a drive ends, which is a thing a test has to do itself.
  routeActions.clear();
  mocks = createMockAdapters();
  vibration = createRecordingVibration();
  adapters = { ...mocks, vibration };
  notifications = mocks.notifications;
  speech = createRecordingSpeech();
  posts = [];
  notifications.subscribe((event) => {
    posts.push(event);
  });
});

afterEach(() => {
  delivery?.stop();
  delivery = null;
  resetAllStores();
  routeActions.clear();
});

/** No abuse area anywhere, unless a test says otherwise. */
let sighting: AbuseAreaSighting | null = null;

const abuseAreas: AbuseAreaSource = {
  sight: () => sighting,
};

const start = (options: { readonly areas?: AbuseAreaSource } = {}): void => {
  sighting = null;
  delivery = createAlertDelivery({
    adapters,
    speech,
    abuseAreas: options.areas ?? abuseAreas,
  });
};

const drive = (): void => {
  const run = createDriver();
  for (const tick of run(APPROACH_LATS)) alertActions.ingest(tick);
};

/**
 * The approach, a beat, and then on past both cameras.
 *
 * THE BEAT IS NOT DECORATION. A real drive puts a second between fixes and the
 * platform answers `show()` in a microtask, so by the time a driver has left
 * range delivery knows whether a card went up. Ingesting nine fixes in one
 * synchronous burst is a cadence no GPS produces, and a test written that way
 * would be asserting against a race rather than against the behaviour.
 */
const driveAndLeave = async (): Promise<void> => {
  const run = createDriver();
  for (const tick of run(APPROACH_LATS)) alertActions.ingest(tick);
  await settle();
  for (const tick of run(DEPART_LATS)) alertActions.ingest(tick);
};

/**
 * `notifications.show()` is async and delivery deliberately does not await it
 * from the subscription -- a driving loop must not block on the platform. The
 * chain is now longer than two microtasks (the adapter awaits its own
 * permission read, and delivery awaits the result before deciding the haptic),
 * so this drains the whole queue rather than counting the links in it.
 */
const settle = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

/** A fix at a place, as the position slice publishes it. */
const fixAt = (lat: number, lon: number): void => {
  positionActions.ingestFix({
    lat,
    lon,
    accuracyM: 4,
    altitudeM: null,
    altitudeAccuracyM: null,
    speedMps: SPEED_MPS,
    headingDeg: 0,
    timestamp: Date.now(),
  });
};

// ---------------------------------------------------------------------------

describe('haptics', () => {
  /**
   * THE REGRESSION THIS FILE EXISTS FOR, restated for the new rule.
   *
   * `vibration.buzz()` was complete, guarded, tested in isolation and called by
   * nothing in production. It has a caller now - but only when the notification
   * did not carry the pattern instead, so the drive that proves it is one where
   * the card cannot go out.
   */
  it('buzzes from the page when no card went out to carry the pattern', () => {
    useSettingsStore.getState().setVibration(true);
    useSettingsStore.getState().setCapabilityEnabled('notifications', false);
    start();
    drive();
    expect(vibration.buzzes().map((buzz) => buzz.source)).toContain('camera-alert');
  });

  /**
   * THE DOUBLE BUZZ. The notification carries `CAMERA_VIBRATION` itself now, so
   * a page-side buzz on top of a card that went out is two overlapping patterns
   * and no signature at all.
   */
  it('leaves the haptic to the card when the card went out', async () => {
    useSettingsStore.getState().setVibration(true);
    start();
    drive();
    await settle();
    expect(notifications.notifications.shown().length).toBeGreaterThan(0);
    expect(vibration.buzzes()).toEqual([]);
  });

  it('buzzes when the driver denied notification permission', async () => {
    useSettingsStore.getState().setVibration(true);
    start();
    permit('denied');
    drive();
    await settle();
    expect(notifications.notifications.shown()).toEqual([]);
    expect(vibration.buzzes().map((buzz) => buzz.source)).toContain('camera-alert');
  });

  it('is silent when the driver has switched vibration off', async () => {
    useSettingsStore.getState().setVibration(false);
    useSettingsStore.getState().setCapabilityEnabled('notifications', false);
    start();
    drive();
    await settle();
    expect(vibration.buzzes()).toEqual([]);
  });

  /**
   * The toggle is honoured by starting and stopping the ADAPTER, not by a
   * branch at the call site, so flipping it mid-drive has to take effect
   * without restarting delivery.
   */
  it('follows the vibration toggle changing mid-drive', async () => {
    useSettingsStore.getState().setCapabilityEnabled('notifications', false);
    useSettingsStore.getState().setVibration(false);
    start();
    drive();
    await settle();
    expect(vibration.buzzes()).toEqual([]);

    useSettingsStore.getState().setVibration(true);
    alertActions.reset();
    drive();
    await settle();
    expect(vibration.buzzes().length).toBeGreaterThan(0);
  });

  it('never buzzes twice for one delivery', async () => {
    useSettingsStore.getState().setVibration(true);
    useSettingsStore.getState().setCapabilityEnabled('notifications', false);
    start();
    const run = createDriver();
    const ticks = run(APPROACH_LATS);
    const last = ticks[ticks.length - 1] as AlertTick;
    alertActions.ingest(last);
    await settle();
    const after = vibration.buzzes().length;
    // Re-publishing the same tick must not re-buzz: the store bumps
    // `delivered` per ingest and delivery keys off it.
    useAlertStore.setState({ ticks: useAlertStore.getState().ticks + 1 });
    await settle();
    expect(vibration.buzzes().length).toBe(after);
  });
});

describe('notifications', () => {
  it('shows one when the gate opens', async () => {
    start();
    drive();
    await settle();
    expect(notifications.notifications.shown().length).toBeGreaterThan(0);
  });

  /**
   * NEVER PROMPTS. A permission dialog raised by a camera coming into range is
   * a dialog raised while driving. ONBOARDING and SETTINGS ask, in the calm.
   */
  it('stays quiet rather than prompting when permission was never granted', async () => {
    start();
    permit('prompt');
    drive();
    await settle();
    expect(notifications.notifications.shown()).toEqual([]);
    // THE POINT: no prompt was raised. `request()` is the only thing that
    // prompts and delivery must never call it.
    expect(notifications.mock.requests()).toBe(0);
  });

  it('stays quiet when permission was denied', async () => {
    start();
    permit('denied');
    drive();
    await settle();
    expect(notifications.notifications.shown()).toEqual([]);
  });

  /**
   * WHAT GOES TO THE OPERATING SYSTEM. A notification lands on a lock screen,
   * so it may carry a distance and a bearing phrase and never a street, a
   * coordinate or a camera id.
   */
  it('carries a bearing phrase and no location whatsoever', async () => {
    start();
    drive();
    await settle();
    const [first] = notifications.notifications.shown();
    expect(first).toBeDefined();
    const payload = JSON.stringify(first);
    expect(payload).not.toMatch(/-84\.5|39\.1/);
    expect(payload).not.toContain('FWM-0442');
  });

  it('respects the notifications switch without disarming the warning', async () => {
    useSettingsStore.getState().setVibration(true);
    useSettingsStore.getState().setCapabilityEnabled('notifications', false);
    start();
    drive();
    await settle();
    expect(notifications.notifications.shown()).toEqual([]);
    // Turning notifications off is "stop putting things on my lock screen",
    // not "stop warning me".
    expect(vibration.buzzes().length).toBeGreaterThan(0);
  });
});

describe('the camera card coming down', () => {
  /**
   * THE UNREACHABLE CLEAR. `show()`'s `clear` branch was dead code: delivery
   * only ran on the `delivered` counter, which only moves inside
   * `shouldAlertUser`, which is `in_range || multiple`. So a camera card stayed
   * on the shade after the driver had passed the camera, saying "425 ft ·
   * AHEAD" about a reader half a mile behind them.
   */
  it('takes the card down when the driver leaves range', async () => {
    start();
    await driveAndLeave();
    await settle();
    expect(useAlertStore.getState().state).toBe('clear');
    expect(notifications.notifications.cleared()).toContain(CAMERA_ALERT_TAG);
  });

  it('leaves nothing standing on the shade after the driver has gone', async () => {
    start();
    await driveAndLeave();
    await settle();
    // The mock reproduces the real replacement rule, so a tag that was cleared
    // is a tag with nothing under it.
    const tags = notifications.notifications.shown().map((entry) => entry.tag);
    expect(tags).not.toContain(CAMERA_ALERT_TAG);
  });

  /**
   * A clear that fires for a card nobody saw would emit a `cleared` event for
   * an empty tag, which makes the event stream unreadable - and it would fire
   * on the very first tick of every drive, before anything was ever posted.
   */
  it('does not take down a card that was never put up', async () => {
    start();
    permit('denied');
    await driveAndLeave();
    await settle();
    expect(notifications.notifications.cleared()).not.toContain(CAMERA_ALERT_TAG);
  });
});

describe('speech', () => {
  it('speaks the distance and the side, which is what the switch promises', async () => {
    useSettingsStore.getState().setAudio(true);
    start();
    drive();
    await settle();
    const [first] = speech.said();
    expect(first?.source).toBe('camera-alert');
    expect(first?.text).toMatch(/^camera(s)?, \d+ feet/);
  });

  /**
   * THE SWITCH THAT CONTROLLED NOTHING. `settings.audio` was written,
   * persisted, rehydrated and rendered as "Spoken warnings" with no reader
   * anywhere in `src`.
   */
  it('says nothing when spoken warnings are off', async () => {
    useSettingsStore.getState().setAudio(false);
    start();
    drive();
    await settle();
    expect(speech.said()).toEqual([]);
  });

  it('follows the audio toggle changing mid-drive', async () => {
    useSettingsStore.getState().setAudio(false);
    start();
    drive();
    await settle();
    expect(speech.said()).toEqual([]);

    useSettingsStore.getState().setAudio(true);
    alertActions.reset();
    drive();
    await settle();
    expect(speech.said().length).toBeGreaterThan(0);
  });

  /**
   * A LOCK SCREEN AND A SPEAKER ARE THE SAME PROBLEM. The spoken warning is
   * built from the structured payload, so there is no path a street, a
   * coordinate or a plate could travel down to reach it.
   */
  it('speaks no street, no coordinate and no camera id', async () => {
    useSettingsStore.getState().setAudio(true);
    start();
    drive();
    await settle();
    const spoken = speech.said().map((request) => request.text);
    expect(spoken.length).toBeGreaterThan(0);
    for (const text of spoken) {
      expect(text).not.toMatch(/-84\.5|39\.1/);
      expect(text).not.toContain('FWM-0442');
    }
  });
});

describe('abuse areas', () => {
  const JACKSON: AbuseAreaSighting = {
    trigger: 'entered',
    key: '29095',
    county: 'JACKSON CO, MO',
    incidentCount: 3,
    worstCase: 'Kansas City Police Department',
  };

  /**
   * THE SWITCH THAT DID NOT EXIST WHEN THESE TESTS WERE WRITTEN.
   *
   * Every assertion below was written against a `considerAbuse` that fired for
   * anyone entering a recorded county, gated only by the mute. Brief 4 section
   * A puts it behind `Alert on entry`, DRAWN OFF, so the shipped default is now
   * silence and these tests have to ask for the behaviour they are about.
   *
   * Turned on HERE rather than in the file's own `beforeEach` on purpose: the
   * global reset restoring the real default is what makes the two tests at the
   * foot of this block - the ones about the switch itself - mean anything.
   */
  beforeEach(() => {
    useSettingsStore.getState().setAbuseAlertOnEntry(true);
  });

  it('posts a card on entering a documented area', async () => {
    start();
    sighting = JACKSON;
    fixAt(39.1, -94.58);
    await settle();
    const posted = notifications.notifications.shown().find((c) => c.tag === ABUSE_AREA_TAG);
    expect(posted?.title).toContain('JACKSON CO, MO');
  });

  /**
   * THE WHOLE POINT OF THE KEY. A driver parked inside a recorded county gets
   * a fix a second; without the key they would get a card a second.
   */
  it('tells the driver once per area, not once per fix', async () => {
    start();
    sighting = JACKSON;
    fixAt(39.1, -94.58);
    fixAt(39.1001, -94.58);
    fixAt(39.1002, -94.58);
    await settle();
    expect(postsFor(ABUSE_AREA_TAG)).toHaveLength(1);
  });

  it('takes the card down when the driver leaves the area', async () => {
    start();
    sighting = JACKSON;
    fixAt(39.1, -94.58);
    await settle();
    sighting = null;
    fixAt(39.2, -94.58);
    await settle();
    expect(notifications.notifications.cleared()).toContain(ABUSE_AREA_TAG);
  });

  /**
   * A MUTE DELAYS THE TELLING, IT DOES NOT CANCEL IT. Marking the area told
   * while withholding the card would mean a driver who muted one camera on the
   * way in never hears about the county at all.
   */
  it('withholds the card while muted and posts it once the mute lifts', async () => {
    start();
    sighting = JACKSON;
    alertActions.muteAll(Date.now());
    fixAt(39.1, -94.58);
    await settle();
    expect(notifications.notifications.shown().some((c) => c.tag === ABUSE_AREA_TAG)).toBe(false);

    alertActions.unmuteAll(Date.now());
    fixAt(39.1001, -94.58);
    await settle();
    expect(notifications.notifications.shown().some((c) => c.tag === ABUSE_AREA_TAG)).toBe(true);
  });

  /**
   * THE SIGNATURE STAYS RESERVED. Two firm pulses mean a camera; an abuse area
   * is long-short, and a driver who braked for this one would have braked for a
   * county record.
   */
  it('buzzes with the abuse pattern, never the camera signature', async () => {
    useSettingsStore.getState().setVibration(true);
    useSettingsStore.getState().setCapabilityEnabled('notifications', false);
    start();
    sighting = JACKSON;
    fixAt(39.1, -94.58);
    await settle();
    expect(vibration.buzzes()).toEqual([{ source: 'abuse-area' }]);
    expect(patternFor({ source: 'abuse-area' })).not.toBe(SOURCE_PATTERNS['camera-alert']);
  });

  /**
   * THE GAZETTEER LABEL IS A STRIP FORMAT - "JACKSON CO, MO" - and a speech
   * engine reads "co" as a word and "MO" as two letters. The eye gets the
   * place, the ear gets the fact.
   */
  it('speaks the record without reading the county label out loud', async () => {
    useSettingsStore.getState().setAudio(true);
    start();
    sighting = JACKSON;
    fixAt(39.1, -94.58);
    await settle();
    const said = speech.said().find((request) => request.source === 'abuse-area');
    expect(said?.text).toBe('entering an area with 3 documented incidents of misuse');
  });

  it('counts the cameras around the driver rather than inventing a county total', async () => {
    start();
    sighting = JACKSON;
    fixAt(39.1, -94.58);
    await settle();
    const posted = notifications.notifications.shown().find((c) => c.tag === ABUSE_AREA_TAG);
    // No tiles are loaded in this test, so the honest answer is zero cameras -
    // not a fabricated county figure. The record is still reported.
    expect(posted?.body).toBe('3 documented misuse · 0 cameras · Kansas City Police Department');
  });

  /* ---------------------------------------------------------------------- *
   * THE TWO SWITCHES THE ABUSE MENU ADDED
   * ---------------------------------------------------------------------- */

  /**
   * ALERT ON ENTRY, OFF - WHICH IS THE SHIPPED DEFAULT.
   *
   * Note there is no `setAbuseAlertOnEntry(true)` undone here: the block's
   * `beforeEach` turns it on and this turns it back off, so the assertion is
   * about the switch and not about the order of two setups.
   */
  it('posts nothing on entry while Alert on entry is off', async () => {
    useSettingsStore.getState().setAbuseAlertOnEntry(false);
    start();
    sighting = JACKSON;
    fixAt(39.1, -94.58);
    await settle();
    expect(notifications.notifications.shown().some((c) => c.tag === ABUSE_AREA_TAG)).toBe(false);
  });

  /**
   * AND IT SPENDS THE TRANSITION RATHER THAN HOLDING IT, WHICH IS THE OPPOSITE
   * OF WHAT THE MUTE DOES AND IS DELIBERATE.
   *
   * A mute means "not now", so the area is left untold and the card arrives
   * when the mute lifts. This switch means "not at all": somebody who turned
   * entry alerts off is not waiting for them, and holding the key would post a
   * card about a county they entered and left an hour ago the moment they
   * changed their mind. So the border is consumed silently and the next thing
   * that happens is the next border.
   */
  it('consumes the crossing silently rather than banking it for later', async () => {
    useSettingsStore.getState().setAbuseAlertOnEntry(false);
    start();
    sighting = JACKSON;
    fixAt(39.1, -94.58);
    await settle();

    useSettingsStore.getState().setAbuseAlertOnEntry(true);
    fixAt(39.1001, -94.58);
    await settle();
    expect(notifications.notifications.shown().some((c) => c.tag === ABUSE_AREA_TAG)).toBe(false);
  });

  /**
   * NAME THE AGENCY REACHES ONE FIELD AND NOTHING ELSE.
   *
   * Off, the body is what it said before an agency was ever added to it. The
   * title, the counts, the tag, the haptic and the spoken line are untouched -
   * `abuseSpeech` never read `worstCase` in the first place.
   */
  it('drops the agency from the card body while Name the agency is off', async () => {
    useSettingsStore.getState().setAbuseNameAgency(false);
    start();
    sighting = JACKSON;
    fixAt(39.1, -94.58);
    await settle();
    const posted = notifications.notifications.shown().find((c) => c.tag === ABUSE_AREA_TAG);
    expect(posted?.body).toBe('3 documented misuse · 0 cameras');
    expect(posted?.title).toContain('JACKSON CO, MO');
  });
});

describe('the county abuse source', () => {
  const hit = { fips: '29095', name: 'Jackson' };

  const locator = (found: { fips: string; name: string } | null) => ({
    locate: () => Promise.resolve(found),
    locateLoaded: () => found,
  });

  const records = (
    incidents: number,
    rows: readonly { agency: string; incidents: number; year: number }[],
  ) => ({
    forCounty: () => ({
      fips: '29095',
      incidents,
      records: rows.map((row) => ({
        fips: '29095',
        agency: row.agency,
        summary: 'a documented misuse',
        incidents: row.incidents,
        year: row.year,
        sourceUrl: 'https://example.org/report',
        sourceName: 'Example',
      })),
    }),
    all: () => [],
    generatedAt: () => null,
    ready: () => true,
  });

  const at = { lat: 39.1, lon: -94.58, headingDeg: 0, speedMps: 0, accuracyM: 4 };

  it('says nothing when the county index has not answered yet', () => {
    const source = createCountyAbuseSource({
      locator: locator(null),
      records: records(3, []),
      nameFor: () => null,
    });
    expect(source.sight(at)).toBeNull();
  });

  /**
   * NULL IS UNDOCUMENTED, NEVER CLEAN. `countyRecords.ts` sets that rule and a
   * card for an absence would be the app making a claim about American policing
   * on the strength of a file that has no row.
   */
  it('says nothing for a county with no record on file', () => {
    const source = createCountyAbuseSource({
      locator: locator(hit),
      records: { ...records(0, []), forCounty: () => null },
      nameFor: () => null,
    });
    expect(source.sight(at)).toBeNull();
  });

  it('reports the county as entered, keyed on its fips', () => {
    const source = createCountyAbuseSource({
      locator: locator(hit),
      records: records(3, [{ agency: 'KCPD', incidents: 3, year: 2023 }]),
      nameFor: () => 'JACKSON CO, MO',
    });
    expect(source.sight(at)).toEqual({
      trigger: 'entered',
      key: '29095',
      county: 'JACKSON CO, MO',
      incidentCount: 3,
      worstCase: 'KCPD',
    });
  });

  /**
   * `forCounty` returns a county's rows in FILE ORDER - only the flat feed is
   * sorted - so `records[0]` would cite whichever row the curator typed first.
   */
  it('cites the record with the most incidents, not the first one on file', () => {
    const source = createCountyAbuseSource({
      locator: locator(hit),
      records: records(9, [
        { agency: 'First On File', incidents: 1, year: 2024 },
        { agency: 'The Worst One', incidents: 8, year: 2019 },
      ]),
      nameFor: () => null,
    });
    expect(source.sight(at)?.worstCase).toBe('The Worst One');
  });

  /** The gazetteer is generation-bound and answers null during a transition. */
  it('falls back to the polygon name when the gazetteer has no label yet', () => {
    const source = createCountyAbuseSource({
      locator: locator(hit),
      records: records(3, [{ agency: 'KCPD', incidents: 3, year: 2023 }]),
      nameFor: () => null,
    });
    expect(source.sight(at)?.county).toBe('Jackson');
  });

  /**
   * A megabyte of county geometry, fetched once. A retry on every fix would
   * re-fetch it for the whole time a phone spends in a dead spot.
   */
  it('warms the index once and never again from the driving path', () => {
    let fetches = 0;
    const source = createCountyAbuseSource({
      locator: {
        locate: () => {
          fetches += 1;
          return Promise.resolve(null);
        },
        locateLoaded: () => null,
      },
      records: records(3, []),
      nameFor: () => null,
    });
    source.sight(at);
    source.sight(at);
    source.sight(at);
    expect(fetches).toBe(1);
  });
});

describe('navigation', () => {
  const BASE_LAT = 39.0;
  const LON = -94.6;
  const FOOT_LAT = 0.3048 / 111_320;
  const STEP_FT = 1000;
  const TURN_FT = 6000;
  const END_FT = 12_000;

  function shape(): RoutePoint[] {
    const count = END_FT / STEP_FT + 1;
    return Array.from({ length: count }, (_, i) => ({
      lat: BASE_LAT + i * STEP_FT * FOOT_LAT,
      lon: LON,
    }));
  }

  function maneuver(
    instruction: string,
    beginShapeIndex: number,
    turn: Maneuver['turn'],
  ): Maneuver {
    return { instruction, street: '', miles: 0, seconds: 0, turn, beginShapeIndex };
  }

  function testRoute(): PlannedRoute {
    return {
      shape: shape(),
      miles: 2.3,
      seconds: 300,
      avoided: 4,
      maneuvers: [
        maneuver('Drive north.', 0, 'start'),
        maneuver('Turn right onto West 119th Street.', TURN_FT / STEP_FT, 'right'),
        maneuver('Your destination is on the left.', END_FT / STEP_FT, 'arrive'),
      ],
    };
  }

  /** `awayFt` feet before the turn, on the line. */
  const driveTo = (awayFt: number): void => {
    fixAt(BASE_LAT + (TURN_FT - awayFt) * FOOT_LAT, LON);
  };

  const plan = (route: PlannedRoute): void => {
    routeActions.planned(route, [], []);
  };

  it('posts the turn card when a rung comes due', async () => {
    useSettingsStore.getState().setAudio(true);
    start();
    plan(testRoute());
    driveTo(1200);
    await settle();
    const card = notifications.notifications.shown().find((c) => c.tag === NAVIGATION_TAG);
    expect(card?.title).toContain('Turn right onto West 119th Street.');
  });

  /**
   * The ladder is `announce.ts`'s and this only owes it a tick. What is proved
   * here is that delivery does not re-ask on every fix and turn one rung into
   * a card a second.
   */
  it('says the same rung once however many fixes arrive inside it', async () => {
    start();
    plan(testRoute());
    driveTo(1200);
    driveTo(1190);
    driveTo(1180);
    await settle();
    expect(postsFor(NAVIGATION_TAG)).toHaveLength(1);
  });

  it('speaks the rung in the words a driver uses rather than reading the feet out', async () => {
    useSettingsStore.getState().setAudio(true);
    start();
    plan(testRoute());
    driveTo(1200);
    await settle();
    const said = speech.said().find((request) => request.source === 'navigation');
    expect(said?.text).toBe('in a quarter mile, turn right onto West 119th Street');
  });

  /** A route is new information about the same fix - a car planning in a
      driveway gets no second fix to trigger on. */
  it('announces a route planned while the car is standing still', async () => {
    start();
    driveTo(1200);
    await settle();
    expect(notifications.notifications.shown().some((c) => c.tag === NAVIGATION_TAG)).toBe(false);

    plan(testRoute());
    await settle();
    expect(notifications.notifications.shown().some((c) => c.tag === NAVIGATION_TAG)).toBe(true);
  });

  it('takes the turn card down when the trip ends', async () => {
    start();
    plan(testRoute());
    driveTo(1200);
    await settle();
    routeActions.clear();
    await settle();
    expect(notifications.notifications.cleared()).toContain(NAVIGATION_TAG);
  });

  it('says nothing at all when there is no route', async () => {
    start();
    driveTo(1200);
    driveTo(400);
    await settle();
    expect(notifications.notifications.shown()).toEqual([]);
    expect(speech.said()).toEqual([]);
  });

  /**
   * A turn cue is the quietest thing in the haptic vocabulary and it must not
   * be mistakable for the camera signature.
   */
  it('buzzes the turn cue with its own pattern when no card went out', async () => {
    useSettingsStore.getState().setVibration(true);
    useSettingsStore.getState().setCapabilityEnabled('notifications', false);
    start();
    plan(testRoute());
    driveTo(1200);
    await settle();
    expect(vibration.buzzes()).toEqual([{ source: 'navigation' }]);
  });
});

describe('the card renderer', () => {
  /**
   * The card and the notification MUST share a tag: `cardImage.ts` keys its
   * object-URL cache on it and revokes the previous URL when the same tag
   * renders again, so a disagreement would leak one PNG per alert and never
   * replace a card's picture.
   */
  it('files every card under the same tag its notification uses', () => {
    expect(
      cardTagFor({
        kind: 'camera-alert',
        state: 'in_range',
        distanceFt: 420,
        bearingLabel: 'AHEAD',
        inRangeCount: 1,
      }),
    ).toBe(CAMERA_ALERT_TAG);
    expect(
      cardTagFor({
        kind: 'abuse-area',
        trigger: 'entered',
        county: 'JACKSON CO, MO',
        incidentCount: 3,
        cameraCount: 12,
      }),
    ).toBe(ABUSE_AREA_TAG);
    expect(cardTagFor({ kind: 'watchlist', newReadCount: 2 })).toBe(WATCHLIST_TAG);
    expect(
      cardTagFor({
        kind: 'navigation',
        instruction: 'Turn right.',
        turn: 'right',
        distanceFt: 400,
      }),
    ).toBe(NAVIGATION_TAG);
  });

  it('gives the four kinds four different tags, so no card evicts another', () => {
    const tags = new Set([CAMERA_ALERT_TAG, ABUSE_AREA_TAG, WATCHLIST_TAG, NAVIGATION_TAG]);
    expect(tags.size).toBe(4);
  });

  /**
   * jsdom has no canvas, so the renderer's honest answer here is "no picture".
   * The contract that matters at this seam is that it RESOLVES rather than
   * throwing: the adapter races it against a deadline and posts either way, and
   * a warning must never be lost to a missing picture.
   */
  it('resolves to no picture rather than throwing where there is no canvas', async () => {
    await expect(
      renderNotificationCard({
        kind: 'camera-alert',
        state: 'in_range',
        distanceFt: 420,
        bearingLabel: 'AHEAD',
        inRangeCount: 1,
      }),
    ).resolves.toBeNull();
  });
});

describe('stopping', () => {
  it('takes every tag down, so nothing outlives the app watching the road', async () => {
    start();
    delivery?.stop();
    delivery = null;
    await settle();
    const cleared = notifications.notifications.cleared();
    expect(cleared).toContain(CAMERA_ALERT_TAG);
    expect(cleared).toContain(ABUSE_AREA_TAG);
    expect(cleared).toContain(NAVIGATION_TAG);
  });

  it('stops warning after it is stopped', async () => {
    useSettingsStore.getState().setVibration(true);
    useSettingsStore.getState().setAudio(true);
    start();
    delivery?.stop();
    delivery = null;
    drive();
    await settle();
    expect(vibration.buzzes()).toEqual([]);
    expect(speech.said()).toEqual([]);
    expect(notifications.notifications.shown()).toEqual([]);
  });
});
