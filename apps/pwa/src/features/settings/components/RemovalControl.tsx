/**
 * The one removal path, as a control.
 *
 * SOURCE (the button): `Flockys Design System.dc.html` section 04,
 * `BUTTONS · h48 · radius 2` -- the third button, `Clear alert log`: 48px,
 * radius 2, a 1px destructive-orange outline, orange label, no fill. The
 * disabled state is section 04's fourth button, `Syncing…`. `A3 · CONNECT -
 * NODE PAIRING` draws the same outline button as `FORGET NODE`.
 *
 * =============================================================================
 * TWO PRESSES, BECAUSE ONE IS NOT A DECISION IN A MOVING CAR
 * =============================================================================
 * A single tap that destroys a driver's trip history, alert history and
 * encrypted plates is a mis-tap waiting to happen on a phone in a mount. So the
 * first press arms and the second commits, with a visible way out. No modal:
 * the design ships no confirmation dialog anywhere, and a sheet over a driving
 * screen is worse than a second tap on the control they are already touching.
 * GAP: see docs/gaps-inbox/settings.md#no-confirmation-pattern-is-drawn
 *
 * =============================================================================
 * THE RESULT IS COUNTS, NOT A REASSURANCE
 * =============================================================================
 * `describeForgetReport()` produces the lines, every figure counted before the
 * delete. `docs/plate-data-handling.md#removal` asks for exactly that -- "the
 * real counts, not a toast that says done" -- and it is what makes the retained
 * evidence visible rather than a surprise. When key destruction fails, one of
 * those lines says so, and this component prints it unchanged.
 */

import type { ReactElement } from 'react';

/** Where the control is in its two-press cycle. */
export type RemovalPhase = 'idle' | 'armed' | 'working' | 'done' | 'unavailable';

/** Section 04's outline-destructive button, at each phase. */
export const REMOVAL_LABELS: Readonly<Record<RemovalPhase, string>> = Object.freeze({
  idle: 'FORGET ME',
  armed: 'TAP AGAIN TO CONFIRM',
  working: 'Forgetting…',
  done: 'FORGET ME',
  unavailable: 'FORGET ME',
});

export const REMOVAL_CANCEL_LABEL = 'CANCEL';

/** What the first press is about to do, said before it is done. */
export const REMOVAL_WARNING =
  'this erases your saved plates, both encryption keys, the match index, your trips and your alert history. it cannot be undone.';

export interface RemovalControlProps {
  readonly phase: RemovalPhase;
  /** `describeForgetReport()` output. Empty until a removal has run. */
  readonly lines: readonly string[];
  /** Why nothing was removed, when nothing was. */
  readonly reason: string | null;
  /** Absent means "not wired in this build". */
  readonly onPress?: (() => void) | undefined;
  readonly onCancel?: (() => void) | undefined;
}

export function RemovalControl({
  phase,
  lines,
  reason,
  onPress,
  onCancel,
}: RemovalControlProps): ReactElement {
  const busy = phase === 'working';
  const inert = onPress === undefined || busy;

  return (
    <div className="fwm-settings-removal" data-fwm-settings-removal={phase}>
      {phase === 'armed' ? (
        <p className="fwm-settings-removal-warning fwm-data" role="alert">
          {REMOVAL_WARNING}
        </p>
      ) : null}

      {lines.length > 0 ? (
        <ul className="fwm-settings-removal-report fwm-data" aria-label="what was removed">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {reason !== null ? (
        <p className="fwm-settings-removal-reason fwm-data" role="status">
          {reason}
        </p>
      ) : null}

      <div className="fwm-settings-removal-actions">
        <button
          type="button"
          className="fwm-settings-removal-button"
          disabled={inert}
          onClick={inert ? undefined : onPress}
        >
          {REMOVAL_LABELS[phase]}
        </button>

        {phase === 'armed' ? (
          <button
            type="button"
            className="fwm-settings-removal-cancel"
            disabled={onCancel === undefined}
            onClick={onCancel}
          >
            {REMOVAL_CANCEL_LABEL}
          </button>
        ) : null}
      </div>
    </div>
  );
}
