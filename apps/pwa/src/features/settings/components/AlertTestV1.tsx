/**
 * SEND A TEST ALERT - proving the notification path on the actual phone.
 *
 * =============================================================================
 * WHY A BUTTON AND NOT A UNIT TEST
 * =============================================================================
 * `services/alerts/delivery.ts` is covered, `adapters/notifications.ts` is
 * covered, and neither of those can tell you the one thing that matters: whether
 * THIS phone, with THIS install, with the screen off and the app in the
 * background, actually raises a card. That answer depends on the OS notification
 * channel, the install mode, the battery optimiser and a permission the browser
 * may have granted months ago and quietly downgraded. None of it is reachable
 * from jsdom, and a driver finds out the alerter is silent at the exact moment
 * they needed it not to be.
 *
 * So: the same adapters the real alert uses, called with a payload that says out
 * loud that it is a test, and the platform's own verdict printed back.
 *
 * =============================================================================
 * IT REPORTS THE OUTCOME WORD, NOT "SENT"
 * =============================================================================
 * `show()` returns `shown | cleared | blocked | unsupported | failed`. Printing
 * "sent" for all five would be the failure this whole screen exists to avoid -
 * `blocked` means the OS refused and the driver must go to system settings, and
 * `unsupported` means this browser has no Notification API at all. Those are
 * different problems with different fixes, so they get different words.
 *
 * =============================================================================
 * WHY IT IS ALLOWED TO BUZZ
 * =============================================================================
 * `adapters/vibration.ts` throws `SilentChannelError` for every source except
 * `camera-alert`, because a buzz in this product means a camera and nothing
 * else. This passes `camera-alert` deliberately: a test alert is a camera alert
 * the driver asked for on purpose, and testing the alerter without the haptic
 * would leave the half most likely to be broken on a locked phone untested. If
 * that ever stops being true, the fix is to drop the buzz here - never to widen
 * the guard.
 */

import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { createPlatformAdapters } from '../../../services/adapters';
import type { AdapterSet } from '../../../services/adapters';

export const ALERT_TEST_HEADING = 'Test the alert';
export const ALERT_TEST_CAPTION =
  'raises one real notification through the same path a camera does. lock the phone first and it ' +
  'tells you what your watch will actually get.';

export const ALERT_TEST_LABEL = 'Send a test alert';
export const ALERT_TEST_SUB = 'one card, tagged as a test. it replaces itself, it never stacks.';

/**
 * The distance and bearing a real IN RANGE alert would carry, with the bearing
 * line saying what it is. The composer prints `title = "{distance} ft"` and
 * `body = bearingLabel`, so this is the sentence that lands on the lock screen.
 */
export const ALERT_TEST_BEARING = 'test alert · no camera is near you';
const ALERT_TEST_DISTANCE_FT = 500;

/** What the button says while nothing has been tried yet. */
export const ALERT_TEST_IDLE = 'send';

export interface AlertTestV1Props {
  /** Injected in tests so nothing touches a real platform. */
  readonly adapters?: AdapterSet;
}

export function AlertTestV1({ adapters }: AlertTestV1Props = {}): ReactElement {
  const set = useMemo(() => adapters ?? createPlatformAdapters(), [adapters]);
  const [word, setWord] = useState<string>(ALERT_TEST_IDLE);
  const [detail, setDetail] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const send = useCallback((): void => {
    setBusy(true);
    setDetail('');
    void (async () => {
      try {
        /*
         * STARTED FIRST, and this is the bug that shipped: `show()` returns
         * `blocked` with "the notifications adapter is stopped" on an adapter
         * that was never started, which reads on screen exactly like the OS
         * refusing permission. It said `blocked` next to a Notifications row
         * saying GRANTED - two statements that cannot both be true, which is
         * how it was caught.
         *
         * This component builds its OWN adapter set rather than sharing the
         * delivery service's, so nothing had started it. `delivery.ts` does the
         * same thing at its own line 89 before it ever calls `show()`.
         */
        await set.notifications.start();

        // ASKS SECOND, from a tap. `request()` is a no-op when already granted,
        // and a permission prompt raised from anything but a gesture is refused
        // by the browser anyway.
        await set.notifications.request();

        const result = await set.notifications.show({
          kind: 'camera-alert',
          state: 'in_range',
          distanceFt: ALERT_TEST_DISTANCE_FT,
          bearingLabel: ALERT_TEST_BEARING,
          inRangeCount: 1,
        });

        setWord(result.outcome);
        setDetail(result.reason ?? '');

        // The haptic half, and only when the card actually appeared. Buzzing
        // after a blocked notification would say the alerter works when the
        // thing being tested just failed.
        if (result.outcome === 'shown') {
          // Started for the same reason as the notifications adapter above:
          // `delivery.ts` starts this one too before it ever buzzes.
          set.vibration.start();
          const buzz = set.vibration.buzz({ source: 'camera-alert', state: 'in_range' });
          if (!buzz.ok) setDetail(buzz.reason ?? 'the phone refused the vibration');
        }
      } catch (error) {
        setWord('failed');
        setDetail(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    })();
  }, [set]);

  return (
    <div className="fwm-settingsv1-card">
      <div className="fwm-settingsv1-card-head">
        <h2 className="fwm-settingsv1-card-title">{ALERT_TEST_HEADING}</h2>
      </div>
      <p className="fwm-settingsv1-note fwm-data">{ALERT_TEST_CAPTION}</p>

      <ul className="fwm-settingsv1-perms">
        <li>
          <button
            type="button"
            className="fwm-settingsv1-perm"
            data-testid="settingsv1-alert-test"
            data-fwm-state={word}
            disabled={busy}
            onClick={send}
          >
            <span className="fwm-settingsv1-perm-rule" aria-hidden="true" />
            <span className="fwm-settingsv1-switch-where">
              <span className="fwm-settingsv1-switch-label">{ALERT_TEST_LABEL}</span>
              <span className="fwm-settingsv1-switch-sub fwm-data">
                {detail === '' ? ALERT_TEST_SUB : detail}
              </span>
            </span>
            <span className="fwm-settingsv1-perm-word fwm-data">{word}</span>
          </button>
        </li>
      </ul>
    </div>
  );
}
