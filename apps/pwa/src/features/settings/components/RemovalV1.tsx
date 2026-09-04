/**
 * DELETE EVERYTHING ON THIS DEVICE - v1's key.
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isSettings` block's
 * last element: an outlined key in the alert hue, full width.
 *
 * =============================================================================
 * WHY THIS IS NOT `RemovalControl`
 * =============================================================================
 * Same reason as `PermissionsV1`: that component is v0's chrome, and rendering
 * it inside a v1 page put a v0 control on it.
 *
 * =============================================================================
 * THE TWO-PRESS RULE IS UNCHANGED AND IS NOT THIS FILE'S
 * =============================================================================
 * `SettingsScreen` owns the phases. The first press ARMS and the second
 * COMMITS, nothing is destroyed by one tap, and the warning is shown BEFORE
 * the destructive press rather than after it. Every string below is v0's, from
 * `RemovalControl`, imported rather than retyped - the words on an
 * irreversible control are not a styling decision.
 *
 * `working` disables the key. A second press during a wipe would arm a second
 * wipe against a database that is being torn down.
 */

import type { ReactElement } from 'react';

import {
  REMOVAL_CANCEL_LABEL,
  REMOVAL_WARNING,
  type RemovalPhase,
} from './RemovalControl.tsx';

/** v1's sentence-case words for the same five phases. */
export const REMOVAL_V1_LABELS: Readonly<Record<RemovalPhase, string>> = Object.freeze({
  idle: 'Delete everything on this device',
  armed: 'Tap again to confirm',
  working: 'Deleting…',
  done: 'Delete everything on this device',
  unavailable: 'Delete everything on this device',
});

export interface RemovalV1Props {
  readonly phase: RemovalPhase;
  /** `describeForgetReport()` output. Empty until a removal has run. */
  readonly lines: readonly string[];
  /** Why nothing was removed, when nothing was. */
  readonly reason: string | null;
  /** Absent means "not wired in this build". */
  readonly onPress?: (() => void) | undefined;
  readonly onCancel?: (() => void) | undefined;
}

export function RemovalV1({
  phase,
  lines,
  reason,
  onPress,
  onCancel,
}: RemovalV1Props): ReactElement {
  return (
    <div className="fwm-settingsv1-removal" data-fwm-removal={phase}>
      {/* BEFORE the destructive press, never after it. */}
      {phase === 'armed' ? (
        <p className="fwm-settingsv1-removal-warning fwm-data" role="alert">
          {REMOVAL_WARNING}
        </p>
      ) : null}

      <button
        type="button"
        className="fwm-settingsv1-removal-key"
        disabled={onPress === undefined || phase === 'working'}
        onClick={onPress}
      >
        {REMOVAL_V1_LABELS[phase]}
      </button>

      {phase === 'armed' && onCancel !== undefined ? (
        <button type="button" className="fwm-settingsv1-removal-cancel" onClick={onCancel}>
          {REMOVAL_CANCEL_LABEL}
        </button>
      ) : null}

      {/* THE RECEIPT. The port's own lines, never a summary written here: what
          was removed is a fact about the database, not a claim this screen is
          entitled to make on its behalf. */}
      {lines.length === 0 ? null : (
        <ul className="fwm-settingsv1-removal-lines" aria-label="what was removed">
          {lines.map((line) => (
            <li className="fwm-settingsv1-removal-line fwm-data" key={line}>
              {line}
            </li>
          ))}
        </ul>
      )}

      {reason === null ? null : (
        <p className="fwm-settingsv1-removal-reason fwm-data" role="status">
          {reason}
        </p>
      )}
    </div>
  );
}
