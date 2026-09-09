/**
 * THE TEST MENU MUST NOT FLATTER THE PLATFORM.
 *
 * Two failures are being pinned here, and both of them shipped.
 *
 * THE COPY. The old row put `'test alert · no camera is near you'` into
 * `bearingLabel` - "a bearing phrase, never a street or a coordinate" - and the
 * composer appended `· 1 in range` to it, so the card read `500 ft / test alert
 * · no camera is near you · 1 in range`. The regression test is not "does the
 * body look right": it is that every bearing sent is a string
 * `features/radar/format.ts` can actually produce. That set is GENERATED here by
 * running the real producer over its whole input domain rather than typed out,
 * so a new row cannot pass by inventing a plausible-looking phrase.
 *
 * THE VERDICT. A control that says the same thing whether the OS raised a card
 * or refused one is a green light wired to nothing, on the screen a driver opens
 * precisely because they suspect the alerter is silent. So: the word is the
 * adapter's, the refusal reason is the adapter's, and the buzz is reported as
 * ACCEPTED and never as felt - `navigator.vibrate` returns true for a phone with
 * no motor.
 *
 * WHY `vibration.buzz` IS REPLACED RATHER THAN DRIVEN THROUGH THE MOCK. The
 * shared mock in `adapters/testing/mocks.ts` still calls the removed
 * `assertCameraAlertOnly` and still takes `patternFor(state)`; it does not
 * compile against the current `vibration.ts` and throws a TypeError at runtime.
 * Both halves of the haptic verdict - accepted and refused - are the thing under
 * test, and they need to be driven from here anyway. When the mock is brought up
 * to the new API these tests keep working, because they only ever assert on what
 * the component printed.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ABUSE_AREA_TAG,
  ABUSE_VIBRATION,
  CAMERA_ALERT_TAG,
  CAMERA_VIBRATION,
  NAVIGATION_TAG,
  NAVIGATION_VIBRATION,
  type ComposedNotification,
  type NotificationPayload,
  type NotificationResult,
} from '../../../services/adapters/notifications.ts';
import {
  createMockAdapters,
  type MockAdapterSet,
} from '../../../services/adapters/testing/mocks.ts';
import type { VibrationRequest, VibrationResult } from '../../../services/adapters/vibration.ts';
import { fineDirection } from '../../radar/format.ts';
import {
  ALERT_TEST_DISCLAIMER,
  ALERT_TEST_IDLE,
  ALERT_TEST_PENDING,
  ALERT_TEST_ROWS,
  AlertTestV1,
  BUZZ_UNCONFIRMED,
  CARD_UNCONFIRMED,
} from './AlertTestV1.tsx';

/**
 * Every bearing this system can produce, built by running the producer. The
 * four sectors, plus the two halves of AHEAD; `headingDeg` is held at 0 and the
 * bearing swept, because the sign of the difference is what splits the sector.
 */
const PRODUCIBLE_BEARINGS = new Set<string>();
for (const direction of ['ahead', 'left', 'right', 'behind'] as const) {
  for (const bearingDeg of [0, 30, 90, 180, 270, 330]) {
    const label = fineDirection({ direction, bearingDeg, headingDeg: 0 });
    if (label !== null) PRODUCIBLE_BEARINGS.add(label);
  }
}

let adapters: MockAdapterSet;
/** Payloads that reached `show()`, in order. */
let sent: NotificationPayload[];
/** Requests that reached `buzz()`, in order. */
let buzzed: VibrationRequest[];
/** `request` / `start` / `show`, in the order the component called them. */
let calls: string[];
/** What the stubbed haptic answers. Rewritten by the tests that care. */
let buzzResult: VibrationResult;

beforeEach(() => {
  adapters = createMockAdapters();
  sent = [];
  buzzed = [];
  calls = [];
  buzzResult = { ok: true, pattern: CAMERA_VIBRATION };

  const show = adapters.notifications.show.bind(adapters.notifications);
  adapters.notifications.show = (payload: NotificationPayload): Promise<NotificationResult> => {
    calls.push('show');
    sent.push(payload);
    return show(payload);
  };
  const start = adapters.notifications.start.bind(adapters.notifications);
  adapters.notifications.start = (): void => {
    calls.push('start');
    start();
  };
  const request = adapters.notifications.request.bind(adapters.notifications);
  adapters.notifications.request = () => {
    calls.push('request');
    return request();
  };
  adapters.vibration.buzz = (req: VibrationRequest): VibrationResult => {
    buzzed.push(req);
    return buzzResult;
  };
});

const row = (id: string): HTMLElement => screen.getByTestId(`settingsv1-alert-test-${id}`);

const word = (id: string): string | null => row(id).getAttribute('data-fwm-state');

function sub(id: string): string {
  const line = row(id).querySelector('.fwm-settingsv1-switch-sub');
  return line?.textContent ?? '';
}

async function press(id: string): Promise<void> {
  await act(async () => {
    fireEvent.click(row(id));
  });
  await waitFor(() => {
    expect(word(id)).not.toBe(ALERT_TEST_PENDING);
  });
}

/** The one card that reached the platform, as the platform received it. */
function card(): ComposedNotification {
  const shown = adapters.notifications.notifications.shown();
  expect(shown).toHaveLength(1);
  const only = shown[0];
  if (only === undefined) throw new Error('no card was posted');
  return only;
}

describe('the alert test menu', () => {
  it('sends nothing until a row is pressed', () => {
    render(<AlertTestV1 adapters={adapters} />);
    for (const entry of ALERT_TEST_ROWS) {
      expect(word(entry.id)).toBe(ALERT_TEST_IDLE);
      expect(sub(entry.id)).toBe(entry.sub);
    }
    expect(sent).toEqual([]);
    expect(buzzed).toEqual([]);
  });

  it('offers one row for every alert a driver can be given', () => {
    render(<AlertTestV1 adapters={adapters} />);
    expect(ALERT_TEST_ROWS.map((entry) => entry.id)).toEqual([
      'camera-in-range',
      'camera-multiple',
      'abuse-entered',
      'abuse-nearby',
      'navigation-turn',
      'navigation-arriving',
    ]);
  });

  it('says on the screen that these are tests, and nowhere in a payload', () => {
    render(<AlertTestV1 adapters={adapters} />);
    expect(screen.getByText(ALERT_TEST_DISCLAIMER)).toBeInTheDocument();
    for (const entry of ALERT_TEST_ROWS) {
      // The disclaimer lives on the chrome. A payload that carried it would be
      // the original bug in a different field.
      expect(JSON.stringify(entry.payload)).not.toMatch(/test/i);
    }
  });
});

describe('what each row sends', () => {
  it('sends one camera in range, bearing only, no count tail', async () => {
    render(<AlertTestV1 adapters={adapters} />);
    await press('camera-in-range');

    expect(sent).toEqual([
      {
        kind: 'camera-alert',
        state: 'in_range',
        distanceFt: 420,
        bearingLabel: 'AHEAD · SLIGHT LEFT',
        inRangeCount: 1,
      },
    ]);
    const posted = card();
    expect(posted.title).toBe('420 ft');
    // The whole body. One camera says nothing the title does not, so the
    // composer withholds the tail - and there is no disclaimer to argue with.
    expect(posted.body).toBe('AHEAD · SLIGHT LEFT');
    expect(posted.tag).toBe(CAMERA_ALERT_TAG);
    expect(posted.silent).toBe(false);
    expect(posted.vibrate).toEqual(CAMERA_VIBRATION);
    expect(buzzed).toEqual([{ source: 'camera-alert', state: 'in_range' }]);
  });

  it('sends several cameras with the count tail the composer adds', async () => {
    render(<AlertTestV1 adapters={adapters} />);
    await press('camera-multiple');

    expect(sent).toEqual([
      {
        kind: 'camera-alert',
        state: 'multiple',
        distanceFt: 260,
        bearingLabel: 'RIGHT',
        inRangeCount: 3,
      },
    ]);
    const posted = card();
    expect(posted.title).toBe('260 ft');
    expect(posted.body).toBe('RIGHT · 3 in range');
    expect(posted.tag).toBe(CAMERA_ALERT_TAG);
    expect(buzzed).toEqual([{ source: 'camera-alert', state: 'multiple' }]);
  });

  it('sends an abuse area entered, with the county in the title', async () => {
    render(<AlertTestV1 adapters={adapters} />);
    await press('abuse-entered');

    expect(sent).toEqual([
      {
        kind: 'abuse-area',
        trigger: 'entered',
        county: 'Example Co',
        incidentCount: 3,
        cameraCount: 12,
        worstCase: 'plate reads shared with an agency outside the county',
      },
    ]);
    const posted = card();
    expect(posted.title).toBe('entering Example Co');
    expect(posted.body).toBe(
      '3 documented misuse · 12 cameras · plate reads shared with an agency outside the county',
    );
    expect(posted.tag).toBe(ABUSE_AREA_TAG);
    // Not silent, and not the camera signature. Both are the point of the row.
    expect(posted.silent).toBe(false);
    expect(posted.vibrate).toEqual(ABUSE_VIBRATION);
    expect(buzzed).toEqual([{ source: 'abuse-area' }]);
  });

  it('sends an abuse area nearby, which is a distance rather than a crossing', async () => {
    render(<AlertTestV1 adapters={adapters} />);
    await press('abuse-nearby');

    expect(sent).toEqual([
      {
        kind: 'abuse-area',
        trigger: 'nearby',
        county: 'Example Co',
        incidentCount: 3,
        cameraCount: 12,
        distanceFt: 900,
      },
    ]);
    const posted = card();
    expect(posted.title).toBe('Example Co · 900 ft');
    expect(posted.body).toBe('3 documented misuse · 12 cameras');
    expect(posted.tag).toBe(ABUSE_AREA_TAG);
  });

  it('sends the next turn with the street named and the trip figures under it', async () => {
    render(<AlertTestV1 adapters={adapters} />);
    await press('navigation-turn');

    expect(sent).toEqual([
      {
        kind: 'navigation',
        instruction: 'Turn right onto West 119th Street.',
        turn: 'right',
        distanceFt: 800,
        etaMinutes: 14,
        milesRemaining: 6.2,
        avoided: 2,
      },
    ]);
    const posted = card();
    expect(posted.title).toBe('800 ft · Turn right onto West 119th Street.');
    expect(posted.body).toBe('14 min · 6.2 mi · 2 avoided');
    expect(posted.tag).toBe(NAVIGATION_TAG);
    expect(posted.vibrate).toEqual(NAVIGATION_VIBRATION);
    expect(buzzed).toEqual([{ source: 'navigation' }]);
  });

  it('sends the arrival card, which leads with arriving rather than a distance', async () => {
    render(<AlertTestV1 adapters={adapters} />);
    await press('navigation-arriving');

    expect(sent).toEqual([
      {
        kind: 'navigation',
        instruction: 'Arrive at your destination.',
        turn: 'arrive',
        distanceFt: 40,
        milesRemaining: 0.1,
        avoided: 3,
        arriving: true,
      },
    ]);
    const posted = card();
    expect(posted.title).toBe('arriving · Arrive at your destination.');
    expect(posted.body).toBe('0.1 mi · 3 avoided');
    expect(posted.tag).toBe(NAVIGATION_TAG);
  });

  it('keeps each row’s verdict on its own row', async () => {
    render(<AlertTestV1 adapters={adapters} />);
    await press('camera-in-range');
    await press('navigation-turn');

    expect(word('camera-in-range')).toBe('shown');
    expect(word('navigation-turn')).toBe('shown');
    expect(word('abuse-nearby')).toBe(ALERT_TEST_IDLE);
    expect(sub('abuse-nearby')).toBe(ALERT_TEST_ROWS[3]?.sub);
  });
});

describe('the bearing field', () => {
  it('never carries prose - only a phrase the direction formatter produces', () => {
    const bearings = ALERT_TEST_ROWS.map((entry) => entry.payload).filter(
      (payload) => payload.kind === 'camera-alert',
    );
    expect(bearings).not.toHaveLength(0);
    for (const payload of bearings) {
      expect([...PRODUCIBLE_BEARINGS]).toContain(payload.bearingLabel);
    }
  });

  it('has a producible set worth asserting against', () => {
    // Guards the test above from passing vacuously if `fineDirection` ever
    // starts answering null: an empty set makes `toContain` fail, but a set
    // containing one wrong string would not be obvious.
    expect([...PRODUCIBLE_BEARINGS].sort()).toEqual([
      'AHEAD',
      'AHEAD · SLIGHT LEFT',
      'AHEAD · SLIGHT RIGHT',
      'BEHIND',
      'LEFT',
      'RIGHT',
    ]);
  });
});

describe('the verdict it prints', () => {
  it('prints the adapter’s refusal rather than a success it did not get', async () => {
    adapters.notifications.show = (payload: NotificationPayload): Promise<NotificationResult> => {
      sent.push(payload);
      return Promise.resolve({
        outcome: 'blocked',
        channel: 'alert-in-range',
        tag: CAMERA_ALERT_TAG,
        silent: false,
        reason: 'the phone refused',
      });
    };

    render(<AlertTestV1 adapters={adapters} />);
    await press('camera-in-range');

    expect(word('camera-in-range')).toBe('blocked');
    expect(sub('camera-in-range')).toContain('the phone refused');
    // The success sentence must be nowhere near a refusal.
    expect(sub('camera-in-range')).not.toContain(CARD_UNCONFIRMED);
  });

  it('prints unsupported as its own word, not as a failure', async () => {
    adapters.notifications.show = (): Promise<NotificationResult> =>
      Promise.resolve({
        outcome: 'unsupported',
        channel: 'navigation',
        tag: NAVIGATION_TAG,
        silent: false,
        reason: 'the Notification API is not available in this browser',
      });

    render(<AlertTestV1 adapters={adapters} />);
    await press('navigation-turn');

    expect(word('navigation-turn')).toBe('unsupported');
    expect(sub('navigation-turn')).toContain('not available in this browser');
  });

  it('says a buzz was accepted and never that it was felt', async () => {
    render(<AlertTestV1 adapters={adapters} />);
    await press('camera-in-range');

    expect(word('camera-in-range')).toBe('shown');
    expect(sub('camera-in-range')).toBe(`${CARD_UNCONFIRMED} ${BUZZ_UNCONFIRMED}`);
    // `navigator.vibrate` returns true on a phone with no motor, so no wording
    // that asserts the driver felt anything may appear here.
    expect(sub('camera-in-range')).not.toMatch(/works|vibrated|it buzzed|you felt/i);
  });

  it('prints the vibration adapter’s own refusal', async () => {
    buzzResult = {
      ok: false,
      pattern: CAMERA_VIBRATION,
      reason: 'haptics are switched off in the map view panel',
    };

    render(<AlertTestV1 adapters={adapters} />);
    await press('camera-in-range');

    expect(sub('camera-in-range')).toContain('haptics are switched off in the map view panel');
    expect(sub('camera-in-range')).not.toContain(BUZZ_UNCONFIRMED);
  });

  it('reports a thrown notification as failed, with the message', async () => {
    adapters.notifications.show = (): Promise<NotificationResult> =>
      Promise.reject(new Error('the service worker went away'));

    render(<AlertTestV1 adapters={adapters} />);
    await press('abuse-entered');

    expect(word('abuse-entered')).toBe('failed');
    expect(sub('abuse-entered')).toContain('the service worker went away');
  });
});

describe('the user gesture', () => {
  it('buzzes inside the click, before anything is awaited', () => {
    render(<AlertTestV1 adapters={adapters} />);
    act(() => {
      fireEvent.click(row('camera-in-range'));
    });

    // Nothing has yielded yet: no microtask between the tap and this line. The
    // motor call and the permission request have both already been made, and
    // the notification - which awaits a service-worker lookup - has not.
    expect(buzzed).toHaveLength(1);
    expect(calls).toEqual(['request']);
  });

  it('asks for permission before it starts posting', async () => {
    render(<AlertTestV1 adapters={adapters} />);
    await press('camera-in-range');

    // start() refuses on an ungranted permission and leaves the adapter
    // not-running, and show() answers a stopped adapter with `blocked`. Asking
    // first is the only order in which a fresh grant works.
    expect(calls).toEqual(['request', 'start', 'show']);
  });
});
