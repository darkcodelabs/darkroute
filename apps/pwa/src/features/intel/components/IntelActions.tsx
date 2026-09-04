/**
 * The four actions, in two rows.
 *
 * SOURCE: `A4 · INTEL CARD`.
 *   row 1, 48px   `CONFIRM STILL THERE`  alert fill, black label, 13px/700/.1em
 *                 `DISPUTE`              destructive outline, 13px/600/.1em
 *   row 2, 44px   `MUTE THIS ONE`        line-strong outline, 12px/600/.08em
 *                 `SHARE`                the same
 *
 * =============================================================================
 * MUTE IS A TOGGLE, AND THE LABEL DOES NOT CHANGE
 * =============================================================================
 * The panel draws one mute state. A camera that is already silenced has to be
 * un-silenceable from the same button, so the key carries `aria-pressed` and a
 * `data-fwm-intel-muted` attribute and keeps the drawn copy. Inventing an
 * `UNMUTE THIS ONE` string would be writing copy the design never wrote for a
 * state it never drew.
 * GAP: docs/gaps-inbox/intel.md#mute-key-has-no-drawn-on-state
 *
 * THE KEY IS PER-CAMERA AND ONLY PER-CAMERA. {@link IntelActionsProps.mutedHere}
 * is named for it: a driver who muted EVERYTHING must not find this key already
 * pressed, press it, and silently un-mute a camera they never muted. "Silenced"
 * reaches the card as its state (and its hue); "muted here" is this key.
 *
 * HOW LONG IT LASTS IS NOT DRAWN HERE. `MUTE THIS ONE` writes a ten-minute
 * timer, and `IntelView` draws the countdown under these keys rather than
 * inside one -- the panel gives the key 44px and a fixed string, and a label
 * that changed length every second is a moving target in a car mount.
 * GAP: docs/gaps-inbox/intel.md#mute-this-one-is-a-ten-minute-timer
 *
 * MUTING REMOVES THE ALERT, NEVER THE RECORD. Nothing in this file or behind
 * this button removes the camera from SWEEP, from EXPOSURE or from this card.
 *
 * A key with nothing wired to it renders disabled rather than live and inert.
 */

import type { ReactElement } from 'react';

/** Exact copy from the panel. Do not re-word or re-case. */
export const CONFIRM_LABEL = 'CONFIRM STILL THERE';
export const DISPUTE_LABEL = 'DISPUTE';
export const MUTE_LABEL = 'MUTE THIS ONE';
export const SHARE_LABEL = 'SHARE';
/** Hands the camera to the phone's own maps app. */
export const NAVIGATE_LABEL = 'NAVIGATE HERE';

export interface IntelActionsProps {
  /**
   * True while THIS camera is on the per-camera mute list.
   *
   * Never true merely because everything is muted -- see the header. The name
   * says "here" so that a caller cannot pass a global mute into it by reading
   * the prop as "is this camera silenced".
   */
  readonly mutedHere: boolean;
  /** True while a queue write is in flight. Both primaries hold. */
  readonly busy: boolean;
  readonly onConfirm?: (() => void) | undefined;
  readonly onDispute?: (() => void) | undefined;
  readonly onToggleMute?: (() => void) | undefined;
  readonly onShare?: (() => void) | undefined;
  /**
   * Hands the camera's position to whatever maps app the phone has.
   *
   * Absent renders the key inert rather than missing: a card that shows a
   * distance and a direction and offers no way to get there is the obvious
   * thing to reach for, and a driver should be told it is unavailable rather
   * than left hunting for it.
   */
  readonly onNavigate?: (() => void) | undefined;
}

export function IntelActions({
  mutedHere,
  busy,
  onConfirm,
  onDispute,
  onToggleMute,
  onShare,
  onNavigate,
}: IntelActionsProps): ReactElement {
  return (
    <div className="fwm-intel-actions">
      <div className="fwm-intel-action-row" data-fwm-intel-action-row="primary">
        <button
          type="button"
          className="fwm-intel-action"
          data-fwm-intel-action="confirm"
          disabled={busy || onConfirm === undefined}
          onClick={onConfirm}
        >
          {CONFIRM_LABEL}
        </button>
        <button
          type="button"
          className="fwm-intel-action"
          data-fwm-intel-action="dispute"
          disabled={busy || onDispute === undefined}
          onClick={onDispute}
        >
          {DISPUTE_LABEL}
        </button>
      </div>

      <div className="fwm-intel-action-row" data-fwm-intel-action-row="secondary">
        <button
          type="button"
          className="fwm-intel-action"
          data-fwm-intel-action="mute"
          data-fwm-intel-muted={mutedHere ? 'true' : 'false'}
          aria-pressed={mutedHere}
          disabled={onToggleMute === undefined}
          onClick={onToggleMute}
        >
          {MUTE_LABEL}
        </button>
        <button
          type="button"
          className="fwm-intel-action"
          data-fwm-intel-action="share"
          disabled={onShare === undefined}
          onClick={onShare}
        >
          {SHARE_LABEL}
        </button>
        <button
          type="button"
          className="fwm-intel-action"
          data-fwm-intel-action="navigate"
          disabled={onNavigate === undefined}
          onClick={onNavigate}
        >
          {NAVIGATE_LABEL}
        </button>
      </div>
    </div>
  );
}
