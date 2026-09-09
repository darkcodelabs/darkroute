/**
 * TEST THE ALERT - proving each notification path on the actual phone.
 *
 * =============================================================================
 * WHY BUTTONS AND NOT A UNIT TEST
 * =============================================================================
 * `services/alerts/delivery.ts` is covered, `adapters/notifications.ts` is
 * covered, and neither of those can tell you the one thing that matters:
 * whether THIS phone, with THIS install, with the screen off and the app in the
 * background, actually raises a card. That answer depends on the OS
 * notification channel, the install mode, the battery optimiser and a
 * permission the browser may have granted months ago and quietly downgraded.
 * None of it is reachable from jsdom, and a driver finds out the alerter is
 * silent at the exact moment they needed it not to be.
 *
 * =============================================================================
 * ONE ROW PER THING THAT CAN GO WRONG SEPARATELY
 * =============================================================================
 * This was one button firing one camera payload, which proved one sixth of the
 * product. The four payload kinds do not share a failure: they carry different
 * tags, so an OS that drops one may keep another; `abuse-area` is the only
 * non-camera card that is allowed to make a sound; `navigation` is the only one
 * that runs the whole drive and so is the only one a battery optimiser gets a
 * chance to strangle; and the two camera states differ in `silent`, `renotify`
 * and `vibrate`, which is the entire lever set the platform gives us. A screen
 * that proves one of those and implies the rest is the same green-light-wired-
 * to-nothing this screen exists to replace.
 *
 * The rows are the section's existing row shape - `PermissionsV1`'s
 * `fwm-settingsv1-perm`, now brief 4's single-line 44px row: the label, then
 * what this row will post or what the platform just said, then the verdict
 * word. This component brings no stylesheet of its own, because no component in
 * this feature has one. `settingsV1.css` paints the whole screen, and a second
 * stylesheet for six rows that already have a shape would be a second place for
 * the row to drift.
 *
 * =============================================================================
 * SIX ROWS, WHERE THE SPEC PAGE DRAWS THREE
 * =============================================================================
 * `the_rest_of_the_app.dc.html` renders this group with three rows - camera in
 * range, several at once, entering an abuse area - and brief 4's prose says
 * "three Send rows" to match. That is the spec's SAMPLE DATA, and taking it as
 * a cap would delete the only on-device proof that `abuse-nearby`,
 * `navigation-turn` and `navigation-arriving` can be raised at all.
 *
 * The section above is the argument, and it has not changed: the payload kinds
 * do not share a failure mode, so a screen that proves three of them and
 * implies the other three is the green-light-wired-to-nothing this group exists
 * to replace. Brief 4's own framing is "a refactor, not a redesign - every
 * screen keeps its purpose, its data and its copy intent", and it names the
 * things it wants deleted (the permission stripes here; three cards on MORE)
 * rather than leaving a deletion to be inferred from a sample list. So all six
 * stay, in the spec's row shape, and the three the spec draws carry the spec's
 * own labels and metas word for word.
 *
 * `AlertTestV1.test.tsx` - "offers one row for every alert a driver can be
 * given" - pins all six by id. Reported rather than decided quietly.
 *
 * =============================================================================
 * THE COPY BUG THIS FILE SHIPPED, AND THE RULE THAT REPLACES IT
 * =============================================================================
 * The old payload put `'test alert · no camera is near you'` in `bearingLabel`,
 * a field whose contract reads "a bearing phrase, never a street or a
 * coordinate". The composer then appended its own count tail, which it could
 * not see contradicting the borrowed prose, and the card on the lock screen
 * read `500 ft / test alert · no camera is near you · 1 in range`. Three
 * clauses, two of them arguing.
 *
 * The rule now: a typed field carries the type of thing it names, and nothing
 * else. Every `bearingLabel` below is a string `features/radar/format.ts` can
 * actually produce - `AHEAD`, `RIGHT`, `AHEAD · SLIGHT LEFT` - and the test
 * asserts membership in that generated set rather than pattern-matching for
 * prose, so a disclaimer cannot be smuggled back in under any wording.
 *
 * THE DISCLAIMER GOES ON THIS SCREEN, and it is `ALERT_TEST_DISCLAIMER` plus
 * each row's own sub-line. Not on the card: the card being indistinguishable
 * from a real one is the point of pressing the button. A test that posts a
 * card marked as a test proves that the marked card can be posted, which is
 * not the thing anybody wanted to know. The driver pressing the button is, by
 * construction, looking at the screen that says so.
 *
 * The header comment this file used to carry claimed `body = bearingLabel`.
 * That was wrong even when it was written: `composeCameraAlert` builds the body
 * from the bearing AND the count tail, and the tail is exactly what turned one
 * author's disclaimer into a contradiction.
 *
 * =============================================================================
 * WHAT THIS SCREEN MAY CLAIM, AND WHAT IT MAY NOT
 * =============================================================================
 * The stated purpose is the platform's own verdict printed back, so:
 *
 *   THE CARD    `show()` returns `shown | cleared | blocked | unsupported |
 *               failed` and the word on the right is that word, verbatim.
 *               `blocked` means the OS refused and the driver must go to system
 *               settings; `unsupported` means this browser has no Notification
 *               API at all. Different problems, different fixes, different
 *               words. Even `shown` is not proof a card appeared - it means the
 *               call returned without throwing - so the sub-line says so.
 *
 *   THE BUZZ    `navigator.vibrate` returns true when the pattern was ACCEPTED.
 *               A device with no motor, a phone in do-not-disturb, an OS
 *               haptics switch turned off and a driver who simply did not
 *               notice all return true, and there is no callback to read back.
 *               `vibration.ts` states this in its own header. So `ok: true`
 *               prints as "buzz accepted", never as "it buzzed".
 *
 *   THE VOICE   not testable from here at all. `speech.ts` exists but is not in
 *               `AdapterSet`, so this component cannot reach it; adding a row
 *               that pretends to test the spoken warning would be the exact
 *               failure above with a new coat of paint. When the adapter is
 *               wired into the set, it gets rows - and its verdict is
 *               `accepted | dropped | blocked | unsupported | failed`, which is
 *               also not "the driver heard it".
 *
 * =============================================================================
 * THE ORDER OF THE THREE CALLS
 * =============================================================================
 * BUZZ FIRST, SYNCHRONOUSLY. The old code awaited `start()` and `request()` and
 * then `show()` - which races a service-worker lookup and a 250 ms card
 * deadline - before it touched the motor. `navigator.vibrate` is refused
 * without user activation, and by then several real milliseconds and at least
 * one task boundary have passed since the tap. The haptic is the half most
 * likely to be broken on a locked phone, so it runs in the click's own task,
 * before anything is awaited. The permission request is started there too: only
 * its `await` is deferred, so the prompt is still raised from the gesture.
 *
 * REQUEST BEFORE START, and this fixes a real bug. `notifications.start()`
 * refuses and sets itself not-running when the permission is not yet granted,
 * and `show()` then returns `blocked` with "the notifications adapter is
 * stopped". The old order - start, request, show - meant the very first press
 * after granting permission reported `blocked` next to a Notifications row
 * reading GRANTED. Two statements that cannot both be true. Asking first, then
 * starting, then showing is the only order in which a fresh grant works.
 *
 * =============================================================================
 * WHY IT IS ALLOWED TO BUZZ
 * =============================================================================
 * `adapters/vibration.ts` owns three patterns and refuses every source that has
 * none: camera, abuse area and turn cue each have one a driver can tell apart,
 * and watchlist, mesh, ui feedback and sync throw. Every row here names the
 * source its own payload would carry on the road, so what a driver feels in
 * this test is what they will feel when it matters. A row whose source has no
 * pattern would throw `SilentChannelError` and be reported as a refusal, which
 * is correct: the fix would be to drop the row, never to widen the guard.
 *
 * This component holds its OWN adapter set, so `vibration.start()` here starts
 * an instance nobody else uses. That means the test cannot tell you whether the
 * driver's Vibration switch in DRIVE's map view panel is on - it proves the
 * motor path, not the setting - and it also means pressing a row cannot change
 * that setting.
 *
 * =============================================================================
 * WHAT IS DELIBERATELY NOT HERE
 * =============================================================================
 * NO WATCHLIST ROW. It is the fourth payload kind and it is `silent: true` with
 * `SILENT_VIBRATION` and no sound, so there is nothing for a driver to observe
 * failing. The failure this screen catches is an alerter that says nothing when
 * it should have shouted; a channel that is silent by design has no such state.
 *
 * NO CARD IMAGE. `features/alert/cardImage.ts` renders the branded mini-card,
 * but `createPlatformAdapters()` does not pass a `renderCard`, so no
 * notification in this build carries one. Injecting one HERE would make the
 * test card prettier than the alert it is testing, which is a lie in the
 * flattering direction. It becomes true for this screen the moment it is true
 * in `set.ts`.
 */

import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { createPlatformAdapters } from '../../../services/adapters';
import type {
  AdapterSet,
  NotificationPayload,
  NotificationResult,
  VibrationRequest,
} from '../../../services/adapters';

export const ALERT_TEST_HEADING = 'Test the alert';

/**
 * The sub-line under the group header.
 *
 * The first sentence is the spec's own. The second is the half of the old
 * three-sentence caption that carried an INSTRUCTION rather than a description,
 * and it is the reason a driver opens this group at all -- the failure being
 * hunted is an alerter that is silent with the screen off, which cannot be seen
 * with the screen on.
 */
export const ALERT_TEST_CAPTION =
  'raises a real notification down the same path the road does. lock the phone first and it ' +
  'tells you what your watch will actually get.';

/**
 * The only place the words "a test" appear. Not in a payload, and not on the
 * card - see the header. `data-fwm-warn` is the same treatment the durability
 * warning upstream wears, because this is the same class of statement: what you
 * are about to see is not what it says it is.
 */
export const ALERT_TEST_DISCLAIMER =
  'these are tests. nothing you press here means a camera, an abuse area or a turn is anywhere ' +
  'near you.';

/** What a row says in the action slot before it has been pressed. */
export const ALERT_TEST_IDLE = 'send';
/** And while the notification is in flight. The buzz has already happened. */
export const ALERT_TEST_PENDING = 'sending';

/**
 * The three sentences the screen is allowed to say about an outcome it cannot
 * verify. Exported because the tests assert on them by identity: a future
 * "vibration works" would have to be written here, in front of the reasoning
 * in the header, rather than typed into JSX.
 */
export const CARD_UNCONFIRMED = 'card sent. no api reports back that it appeared.';
export const BUZZ_UNCONFIRMED = 'buzz accepted. nothing reports back that it was felt.';
export const BUZZ_REFUSED = 'the phone refused the vibration.';

export interface AlertTestRow {
  /** Suffixes the test id and keys the verdict. */
  readonly id: string;
  readonly label: string;
  /**
   * What this row will post, in the driver's words. Shown until it is pressed.
   *
   * A FRAGMENT, NOT A SENTENCE, since brief 4. It sits in a right-aligned 13px
   * slot between the label and the verdict word, on a 390px phone, so it
   * ellipsises the moment it runs long -- the spec's own three are
   * `one at 420 ft - two-pulse`, `three at 260 ft - replaces` and
   * `red pane - named agency`, and the other three are compressed to match.
   * The prose these replaced said the same things at four times the length,
   * which was readable only because the old row stacked it on a second line.
   */
  readonly sub: string;
  /** Exactly what a real one of these carries. No test-only field anywhere. */
  readonly payload: NotificationPayload;
  /** And exactly what a real one of these feels like. */
  readonly haptic: VibrationRequest;
}

/**
 * THE MENU.
 *
 * Bearings are strings `fineDirection`/`coarseDirection` produce and nothing
 * else. Counties are named `Example Co` on purpose: the card states a number of
 * documented misuse incidents, and putting a fabricated count against a real
 * jurisdiction on a lock screen is a claim this product does not get to make
 * for the sake of a self-test. The name field carries a name either way, so the
 * shape being exercised is the real one.
 */
export const ALERT_TEST_ROWS: readonly AlertTestRow[] = [
  {
    id: 'camera-in-range',
    label: 'Camera in range',
    sub: 'one at 420 ft · two-pulse',
    payload: {
      kind: 'camera-alert',
      state: 'in_range',
      distanceFt: 420,
      bearingLabel: 'AHEAD · SLIGHT LEFT',
      inRangeCount: 1,
    },
    haptic: { source: 'camera-alert', state: 'in_range' },
  },
  {
    id: 'camera-multiple',
    label: 'Several at once',
    sub: 'three at 260 ft · replaces',
    payload: {
      kind: 'camera-alert',
      state: 'multiple',
      distanceFt: 260,
      bearingLabel: 'RIGHT',
      inRangeCount: 3,
    },
    haptic: { source: 'camera-alert', state: 'multiple' },
  },
  {
    id: 'abuse-entered',
    label: 'Entering abuse area',
    sub: 'red pane · named agency',
    payload: {
      kind: 'abuse-area',
      trigger: 'entered',
      county: 'Example Co',
      incidentCount: 3,
      cameraCount: 12,
      worstCase: 'plate reads shared with an agency outside the county',
    },
    haptic: { source: 'abuse-area' },
  },
  {
    id: 'abuse-nearby',
    label: 'Abuse area nearby',
    sub: '900 ft away · not entered',
    payload: {
      kind: 'abuse-area',
      trigger: 'nearby',
      county: 'Example Co',
      incidentCount: 3,
      cameraCount: 12,
      distanceFt: 900,
    },
    haptic: { source: 'abuse-area' },
  },
  {
    id: 'navigation-turn',
    label: 'Next turn',
    sub: 'turn card · one pulse',
    payload: {
      kind: 'navigation',
      instruction: 'Turn right onto West 119th Street.',
      turn: 'right',
      distanceFt: 800,
      etaMinutes: 14,
      milesRemaining: 6.2,
      avoided: 2,
    },
    haptic: { source: 'navigation' },
  },
  {
    id: 'navigation-arriving',
    label: 'Arriving',
    sub: 'last card · clears the turn',
    payload: {
      kind: 'navigation',
      instruction: 'Arrive at your destination.',
      turn: 'arrive',
      distanceFt: 40,
      milesRemaining: 0.1,
      avoided: 3,
      arriving: true,
    },
    haptic: { source: 'navigation' },
  },
];

interface RowVerdict {
  /** The word in the action slot. The adapter's, or `sending`. */
  readonly word: string;
  readonly detail: string;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The haptic half, run to completion inside the click. Returns the sentence the
 * sub-line may print, which is never "it buzzed" - see the header.
 */
function buzzNow(set: AdapterSet, request: VibrationRequest): string {
  try {
    // Started for the same reason `delivery.ts` starts it before it ever
    // buzzes. This is this component's own instance, so it neither reads nor
    // writes the driver's Vibration switch.
    set.vibration.start();
    const result = set.vibration.buzz(request);
    if (result.ok) return BUZZ_UNCONFIRMED;
    return result.reason ?? BUZZ_REFUSED;
  } catch (cause) {
    // `SilentChannelError`, if a row ever names a source with no pattern. A
    // programming error, printed rather than swallowed.
    return `${BUZZ_REFUSED} ${messageOf(cause)}`;
  }
}

function verdictDetail(result: NotificationResult, haptic: string): string {
  const card =
    result.outcome === 'shown'
      ? CARD_UNCONFIRMED
      : (result.reason ?? `the notification came back ${result.outcome}.`);
  return `${card} ${haptic}`;
}

export interface AlertTestV1Props {
  /** Injected in tests so nothing touches a real platform. */
  readonly adapters?: AdapterSet;
}

export function AlertTestV1({ adapters }: AlertTestV1Props = {}): ReactElement {
  const set = useMemo(() => adapters ?? createPlatformAdapters(), [adapters]);
  const [verdicts, setVerdicts] = useState<Readonly<Record<string, RowVerdict>>>({});
  const [pending, setPending] = useState<string | null>(null);

  const send = useCallback(
    (row: AlertTestRow): void => {
      /*
       * EVERYTHING THAT NEEDS THE TAP HAPPENS HERE, in the click's own task.
       * The buzz, because `navigator.vibrate` is refused without user
       * activation; and `request()`, because a permission prompt raised from
       * anything but a gesture is refused too. Only the AWAIT of the request is
       * deferred into the tail below - the call itself has already been made.
       */
      const haptic = buzzNow(set, row.haptic);
      const asked = set.notifications.request();

      setPending(row.id);
      setVerdicts((prev) => ({ ...prev, [row.id]: { word: ALERT_TEST_PENDING, detail: haptic } }));

      void (async () => {
        try {
          await asked;
          /*
           * STARTED AFTER THE REQUEST RESOLVES. `start()` refuses on an
           * ungranted permission and leaves the adapter not-running, and a
           * not-running adapter answers `show()` with `blocked` - which reads
           * on screen exactly like the OS refusing. See the header.
           */
          set.notifications.start();
          const result = await set.notifications.show(row.payload);
          setVerdicts((prev) => ({
            ...prev,
            [row.id]: { word: result.outcome, detail: verdictDetail(result, haptic) },
          }));
        } catch (cause) {
          setVerdicts((prev) => ({
            ...prev,
            [row.id]: { word: 'failed', detail: `${messageOf(cause)} ${haptic}` },
          }));
        } finally {
          setPending(null);
        }
      })();
    },
    [set],
  );

  return (
    <div className="fwm-settingsv1-group" role="group" aria-label={ALERT_TEST_HEADING}>
      <div className="fwm-settingsv1-group-head">
        {/* AMBER, which is this group's hue on the spec page and the product's
            own meaning for "somebody is doing something you should know
            about". It is the header that carries it, not a stripe on every
            row -- see `settingsV1.css` section 3. */}
        <h2 className="fwm-settingsv1-group-label" data-fwm-hue="amber">
          {ALERT_TEST_HEADING}
        </h2>
        <p className="fwm-settingsv1-group-note fwm-data">{ALERT_TEST_CAPTION}</p>
      </div>

      <ul className="fwm-settingsv1-perms">
        {ALERT_TEST_ROWS.map((row) => {
          const verdict = verdicts[row.id];
          const word = verdict?.word ?? ALERT_TEST_IDLE;
          return (
            <li key={row.id}>
              <button
                type="button"
                className="fwm-settingsv1-perm"
                data-testid={`settingsv1-alert-test-${row.id}`}
                data-fwm-state={word}
                disabled={pending === row.id}
                onClick={() => {
                  send(row);
                }}
              >
                {/* `.fwm-settingsv1-perm-rule` -- the left-border colour stripe
                    -- was here, and brief 4 deletes it by name. The row is a
                    label, then what this row will post or what the platform
                    just said, then the verdict word. */}
                <span className="fwm-settingsv1-switch-label">{row.label}</span>
                <span className="fwm-settingsv1-switch-sub fwm-data">
                  {verdict?.detail ?? row.sub}
                </span>
                <span className="fwm-settingsv1-perm-word fwm-data">{word}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* THE AMBER NOTE, AND IT SITS UNDER THE ROWS RATHER THAN OVER THEM. The
          spec draws it there, and the placement is the argument: a disclaimer
          read before you have seen what it is about is a disclaimer nobody
          reads. `data-fwm-warn` is the same treatment the durability warning
          wears, because it is the same class of statement. */}
      <p className="fwm-settingsv1-note" data-fwm-warn="true">
        {ALERT_TEST_DISCLAIMER}
      </p>
    </div>
  );
}
