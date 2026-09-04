/**
 * ONBOARDING - v1.
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isOnboard` block.
 *
 * A VIEW, NOT A SCREEN. `OnboardingScreen` still owns the capability probe,
 * the one-time completion flag, the synchronous local mark that survives a
 * reload race, and the refusal trap in `start()`. See `OnboardingView.tsx` for
 * why that logic has exactly one copy.
 *
 * =============================================================================
 * THE HEADLINE IS THE PITCH, AND THE COUNT UNDER IT IS NOT INVENTED
 * =============================================================================
 * The design writes "132,068 known cameras, kept on your phone." That is a
 * measurement of the shipped archive, and on FIRST RUN - which is the only time
 * this screen is seen - nothing has been cached yet, so the number would be
 * describing a download that has not happened.
 *
 * The sentence is rewritten to say what is true at the moment it is read: the
 * archive is copied to the phone, and the alerting runs off that copy. No
 * figure. A count on the one screen a driver has no way to check is the worst
 * possible place to put one.
 *
 * =============================================================================
 * "YOU CAN REFUSE TWO OF THEM" IS TRUE AND IS KEPT
 * =============================================================================
 * Location is required and the other two are not - `PermissionCard`'s roles say
 * so, `start()` enforces it, and the design's own line says it out loud. It is
 * the most useful sentence on the screen and it survives verbatim in meaning.
 */

import type { ReactElement } from 'react';

import { statusWordFor } from './PermissionCard.tsx';
import type { PermissionRole } from './PermissionCard.tsx';
import type { OnboardingPermission, OnboardingViewProps } from './OnboardingView.tsx';
import { useCapabilityEnabled, useSettingsStore } from '../../../stores/index.ts';

import '../onboardingV1.css';

export const HEADLINE_TOP = 'They read your plate.';
export const HEADLINE_BOTTOM = 'Now you see them first.';

export const LEDE_V1 =
  'the camera archive is copied to this phone, and the warnings run off that copy - so they keep ' +
  'working with no signal. three permissions and you are driving. you can refuse two of them.';

export const START_LABEL = 'Start watching back';

/** The three rows, in the design's order. Copy is the design's, shortened. */
const ROWS: readonly {
  readonly key: 'location' | 'notifications' | 'motion';
  readonly label: string;
  readonly sub: string;
  readonly role: PermissionRole;
}[] = [
  {
    key: 'location',
    label: 'Location',
    sub: 'required. distance is computed here and never leaves the phone.',
    role: 'required',
  },
  {
    key: 'notifications',
    label: 'Notifications',
    sub: 'asks the phone to show alert notices. refusable.',
    role: 'recommended',
  },
  {
    key: 'motion',
    label: 'Motion sensors',
    sub: 'fills in which way a camera faces when you report one. refusable.',
    role: 'optional',
  },
];

/*
 * WHAT A ROW SAYS ONCE ITS ANSWER IS IN.
 *
 * The row's own `sub` explains what the permission is FOR, which is the right
 * sentence while it is still a question and the wrong one afterwards. A driver
 * looking at a switch that will not move needs to know where it moves instead,
 * and that place is never this app.
 */
const GRANTED_SUB = 'on. switch it off here whenever you want.';
/*
 * The honest sentence for "off". The permission is still granted - only the
 * browser can take that back - and the app is not using it. Saying both is the
 * difference between a switch a driver can trust and one that quietly leaves a
 * sensor running.
 */
const OFF_SUB = 'off. the app is not using it. the permission itself stays until you clear it in your browser.';
const DENIED_SUB = 'refused. your browser\u2019s site settings are the only place to allow it.';
const UNAVAILABLE_SUB = 'this phone or browser does not offer it.';

export function OnboardingViewV1({
  model,
  onRequestLocation,
  onRequestNotifications,
  onRequestMotion,
  onStart,
}: OnboardingViewProps): ReactElement {
  const ask: Record<'location' | 'notifications' | 'motion', () => void> = {
    location: onRequestLocation,
    notifications: onRequestNotifications,
    motion: onRequestMotion,
  };

  const state: Record<'location' | 'notifications' | 'motion', OnboardingPermission> = {
    location: model.location,
    notifications: model.notifications,
    motion: model.motion,
  };

  /*
   * THE APP-LEVEL SWITCH, which is the half that can be turned OFF.
   *
   * The OS grant is one-way - nothing hands a permission back - so a row that
   * only reflected the grant could only ever be switched on, and a driver who
   * changed their mind had to be sent to their browser's settings to be
   * listened to. This is the other half: the grant stays, the app stops using
   * it, and `sensors.ts` and `alerts/delivery.ts` are where that is honoured.
   *
   * Read per row rather than as one object so a row re-renders only when its
   * own switch moves.
   */
  const enabled: Record<'location' | 'notifications' | 'motion', boolean> = {
    location: useCapabilityEnabled('geolocation'),
    notifications: useCapabilityEnabled('notifications'),
    motion: useCapabilityEnabled('motion'),
  };
  const gated = { location: 'geolocation', notifications: 'notifications', motion: 'motion' } as const;

  return (
    <section className="fwm-onboardingv1" data-testid="onboarding">
      <h1 className="fwm-onboardingv1-headline">
        {HEADLINE_TOP}
        <br />
        {HEADLINE_BOTTOM}
      </h1>

      <p className="fwm-onboardingv1-lede">{LEDE_V1}</p>

      <ul className="fwm-onboardingv1-permissions">
        {ROWS.map((row) => {
          // The SAME word v0's card shows, from the same function, so the two
          // screens cannot disagree about what the OS said.
          const word = statusWordFor(row.role, state[row.key].permission, state[row.key].capability);
          // Not `isRequestable`, deliberately: this screen keeps a refused row
          // inert, where v0's card offers a retry. CHECKING joins the tappable
          // list for the reason given on `isRequestable` - a row whose read has
          // not landed may well have a prompt behind it, and LOCATION is the
          // press this product depends on.
          const requestable = word === 'ALLOW' || word === 'OPTIONAL' || word === 'CHECKING';
          const granted = word === 'GRANTED';
          // ON means the OS allows it AND the driver has not switched it off.
          const on = granted && enabled[row.key];
          // Pressable when there is a prompt behind it, or when the OS has
          // already said yes and the only thing left to move is our own use of
          // it - which moves both ways.
          const pressable = requestable || granted;
          return (
            <li key={row.key}>
              <button
                type="button"
                className="fwm-onboardingv1-permission"
                data-testid={`permission-${row.key}`}
                data-fwm-state={word}
                /*
                 * A SWITCH THAT ONLY GOES ONE WAY, AND SAYS SO.
                 *
                 * `role="switch"` because that is what it looks like and what
                 * it does: off, press, on. The half that is NOT a switch is
                 * turning it back off - no web API hands a permission back, so
                 * only the browser's own site settings can revoke one.
                 *
                 * That is why a granted row is `aria-disabled` rather than
                 * `disabled`. A `disabled` button is skipped by a screen
                 * reader's control navigation, so the one reader who most needs
                 * to be told "this is on, and here is where to change it" would
                 * be the one who never reaches the row. Keyboard focus stays,
                 * the state is announced, and the press is refused in the
                 * handler instead.
                 *
                 * UNAVAILABLE is genuinely `disabled`: there is no prompt
                 * behind it on this device and nothing to explain going
                 * anywhere.
                 */
                role="switch"
                aria-checked={on}
                disabled={word === 'UNAVAILABLE'}
                aria-disabled={!pressable}
                onClick={() => {
                  if (!pressable) return;
                  if (granted) {
                    // Both directions, and no prompt either way: the OS has
                    // already answered, so this only moves whether we USE the
                    // answer.
                    useSettingsStore.getState().setCapabilityEnabled(gated[row.key], !enabled[row.key]);
                    return;
                  }
                  // Not granted yet, so there is a real prompt behind this and
                  // the press has to reach it while it is still a user gesture.
                  // Switching our own use back on first, so a driver who
                  // turned it off, then off again at the OS, then allows it
                  // here, is not left with a granted permission the app is
                  // still ignoring.
                  useSettingsStore.getState().setCapabilityEnabled(gated[row.key], true);
                  ask[row.key]();
                }}
              >
                <span className="fwm-onboardingv1-rule" aria-hidden="true" />
                <span className="fwm-onboardingv1-where">
                  <span className="fwm-onboardingv1-label">{row.label}</span>
                  <span className="fwm-onboardingv1-sub fwm-data">
                    {granted
                      ? enabled[row.key]
                        ? GRANTED_SUB
                        : OFF_SUB
                      : word === 'DENIED'
                        ? DENIED_SUB
                        : word === 'UNAVAILABLE'
                          ? UNAVAILABLE_SUB
                          : row.sub}
                  </span>
                </span>
                {/* Decoration. The state a screen reader hears is on the
                    button; this is the same state drawn for the eye, exactly
                    as `HandleToggle` does it. */}
                <span className="fwm-onboardingv1-track" aria-hidden="true">
                  <span className="fwm-onboardingv1-knob" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* The refusal notice is the container's business - it decides whether
          location was really denied - and this only says so. The first press
          of START after a refusal goes through; see `OnboardingScreen`. */}
      {model.locationDenied ? (
        <p className="fwm-onboardingv1-denied fwm-data" role="status">
          location is refused. the warnings cannot work without it - your phone&apos;s settings are
          the only place to change that. pressing start again continues anyway.
        </p>
      ) : null}

      <button type="button" className="fwm-onboardingv1-start" onClick={onStart}>
        {START_LABEL}
      </button>

      <p className="fwm-onboardingv1-fineprint fwm-data">
        no account · no analytics · GPL-3.0-only source
      </p>
    </section>
  );
}
