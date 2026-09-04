/**
 * ONE PERMISSION CARD - the row the driver taps to grant something.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `A1 · ONBOARDING - PERMISSIONS`. Three
 * of these are drawn, in three different states:
 *
 *   LOCATION        GRANTED   left rule #3DE08A, status word #3DE08A
 *   NOTIFICATIONS   ALLOW     left rule #FFC02E, status word #FFC02E
 *   MOTION SENSORS  OPTIONAL  left rule #23262F, status word #6B7381
 *
 * So the status word is not one vocabulary but two overlaid: what the platform
 * has already decided (GRANTED), and what the card is asking for if it has not
 * (ALLOW for the two the product wants, OPTIONAL for the one it can live
 * without). {@link statusWordFor} is that table, and it is the only place the
 * mapping exists.
 *
 * A third thing has to be sayable, and the design does not draw it: the app has
 * not read the permission yet. That is CHECKING, and the reasoning for adding
 * it - along with the bug that came of not having it - is on
 * {@link statusWordFor}.
 *
 * WHAT THIS COMPONENT DOES NOT DO
 *   It does not call an adapter and it does not touch a store. It renders a
 *   permission state it was handed and reports a tap. `request()` may only be
 *   raised from a user gesture, and keeping the call in the screen means there
 *   is exactly one place to check that it is.
 *
 * A card with nothing left to ask for is `disabled`: an already-granted
 * permission has no prompt behind it, and a capability this phone does not have
 * cannot be granted by tapping. Neither is a failure and neither is hidden --
 * the status word says which one it is.
 */

import type { ReactElement } from 'react';

import type { CapabilityStatus, PermissionStatus } from '../../../stores/index.ts';

import '../onboarding.css';

/**
 * How badly the product wants this permission.
 *
 *   required     the product cannot do its job without it (location)
 *   recommended  a real degradation without it (notifications)
 *   optional     a convenience (motion sensors)
 *
 * `required` and `recommended` render the same word - the design draws
 * NOTIFICATIONS as ALLOW, not as REQUIRED - but they are not the same thing to
 * the screen: only a `required` denial gets an explanation and a retry.
 */
export type PermissionRole = 'required' | 'recommended' | 'optional';

/** The right-aligned word. Three come from the design; three are gap-filled. */
export type PermissionStatusWord =
  'GRANTED' | 'ALLOW' | 'OPTIONAL' | 'DENIED' | 'UNAVAILABLE' | 'CHECKING';

/** Drives `--fwm-permission-hue` / `--fwm-permission-word` in onboarding.css. */
export type PermissionTone =
  'granted' | 'allow' | 'optional' | 'denied' | 'unavailable' | 'checking';

/**
 * The status table.
 *
 * =============================================================================
 * WHY `unknown` GETS ITS OWN WORD, HAVING PREVIOUSLY BEEN FOLDED IN WITH
 * `prompt`
 * =============================================================================
 * It used to be folded, on the reasoning that both mean "not decided yet" and
 * that a sixth word for the 50 ms before `permissions.query()` resolves would
 * be a flicker rather than information. Both halves of that turned out to be
 * wrong on a phone.
 *
 * The fold is not free, it is a GUESS. `prompt` is something the OS said;
 * `unknown` is the app admitting it has not looked. Folding them makes the row
 * print ALLOW, or OPTIONAL, as though a platform had answered - and when the
 * real answer arrives and is GRANTED, the row was simply wrong for as long as
 * the read took. That is the bug this reversal fixes: MOTION SENSORS reads
 * OPTIONAL on a phone where the answer is, and always was, GRANTED. Location
 * has the same defect (ALLOW where the truth is GRANTED); it is just less
 * noticeable, because ALLOW is also the right word when the answer is `prompt`.
 *
 * And it is not 50 ms. Measured on a 6x-throttled Pixel profile against a real
 * build, the wrong word was on screen for 360 ms to 1.5 s, varying per launch
 * - long enough to read, which is exactly how it was reported: "GRANTED on one
 * load and OPTIONAL on the next, nothing changed in between". Most of that was
 * `readPermissions` batching fifteen reads behind the slowest; that is fixed in
 * `stores/capabilities.ts` and cuts the window to about a frame. This makes the
 * remaining frame honest instead of merely brief.
 *
 * CHECKING is deliberately not styled as an answer - see the tone table in
 * `onboarding.css` - and it is still requestable, see {@link isRequestable}.
 */
export function statusWordFor(
  role: PermissionRole,
  permission: PermissionStatus,
  capability: CapabilityStatus,
): PermissionStatusWord {
  // "This phone does not have the hardware" outranks everything else: there is
  // no prompt behind the card and there never will be on this device. It is a
  // synchronous fact from `probe()`, so it is known before any read lands and
  // it is worth saying even while the permission itself is unread.
  if (capability === 'unsupported' || permission === 'unavailable') return 'UNAVAILABLE';
  if (permission === 'unknown') return 'CHECKING';
  if (permission === 'granted') return 'GRANTED';
  if (permission === 'denied') return 'DENIED';
  return role === 'optional' ? 'OPTIONAL' : 'ALLOW';
}

export function toneFor(word: PermissionStatusWord): PermissionTone {
  switch (word) {
    case 'CHECKING':
      return 'checking';
    case 'GRANTED':
      return 'granted';
    case 'ALLOW':
      return 'allow';
    case 'OPTIONAL':
      return 'optional';
    case 'DENIED':
      return 'denied';
    case 'UNAVAILABLE':
      return 'unavailable';
  }
}

/**
 * Is there a prompt behind this card?
 *
 * DENIED stays tappable on purpose. Most browsers resolve a re-request
 * immediately as denied without showing the OS dialog again, and that is worth
 * finding out honestly: the retry either works (the driver changed it in site
 * settings and came back) or it does not, and the word stays DENIED. What it
 * must never do is disappear and leave no way back.
 *
 * CHECKING is tappable for the mirror-image reason: the passive read has not
 * come back, so the app does not know that there is NOT a prompt behind the
 * row. Disabling it would make onboarding's LOCATION button - the one press
 * the whole product depends on - inert for the first few hundred milliseconds
 * after the screen appears, which is precisely when a driver reaches for it.
 * `request()` is the authoritative answer in any case, and it is safe on every
 * outcome: an already-granted permission resolves without a dialog.
 */
export function isRequestable(word: PermissionStatusWord): boolean {
  return word === 'ALLOW' || word === 'OPTIONAL' || word === 'DENIED' || word === 'CHECKING';
}

export interface PermissionCardProps {
  /** The label, uppercase, exactly as the design draws it. */
  readonly label: string;
  /** The mono body copy under the label. Verbatim from A1. */
  readonly body: string;
  readonly role: PermissionRole;
  readonly permission: PermissionStatus;
  readonly capability: CapabilityStatus;
  /** Called on tap, and only when there is a prompt behind the card. */
  readonly onRequest: () => void;
  /** Stable hook for tests and for the screen's denial routing. */
  readonly testId: string;
}

export function PermissionCard({
  label,
  body,
  role,
  permission,
  capability,
  onRequest,
  testId,
}: PermissionCardProps): ReactElement {
  const word = statusWordFor(role, permission, capability);
  const requestable = isRequestable(word);

  return (
    <li>
      <button
        type="button"
        className="fwm-permission-card"
        data-fwm-permission={testId}
        data-fwm-permission-tone={toneFor(word)}
        data-testid={testId}
        disabled={!requestable}
        onClick={onRequest}
      >
        <span className="fwm-permission-row">
          <span className="fwm-permission-label">{label}</span>
          <span className="fwm-permission-status">{word}</span>
        </span>
        <span className="fwm-permission-body">{body}</span>
      </button>
    </li>
  );
}
