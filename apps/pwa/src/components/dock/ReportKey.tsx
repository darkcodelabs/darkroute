/**
 * The REPORT key. One target, two gestures, and it has outlived two docks.
 *
 * SOURCE: `Flockys App Screens v2.dc.html` -- rendered identically on all five
 * dock screens as the last child of the 58px bar (a 1px x 22px `#22262F`
 * divider, then a 42x42 cell holding a 22px crimson eye mark and a count) --
 * plus the panel "DOCK -- REPLACES THE ICON ROW":
 *
 *   "REPORT is the last key in the bar, always far right: 42px eye mark on a
 *    tinted chip, split from the destinations by a hairline. Tap opens the
 *    sheet, 1s hold drops a pin. Amber badge = queued reports."
 *   "HOLD REPORT BUTTON 1s TO ONE-TAP DROP A PIN"   (06 REPORT)
 *   "PIN DROPPED"                                   (Flockys Watch.dc.html, W8)
 *
 * IT IS THE COMPONENT, NOT THE PLACE. It began as a standalone 52px crimson
 * bar above a row of word-keys; it became the sixth key inside a 58px bar; the
 * dock that drew that bar is now deleted and it is the circle beside v1's
 * floating pill (`DockV1.tsx`, and `dockV1.css` for the shape). Through all
 * three it has been the same two gestures, the same queue count, the same
 * refusal to arm a hold that has nothing behind it. Only the shape around it
 * has ever changed, which is why it is a component and not markup inside a
 * dock. Its own rules live in `reportKey.css`, next to it, for the same reason:
 * they used to live in the deleted dock's stylesheet and very nearly went with
 * it. It is deliberately NOT a destination -- it opens a sheet, so it carries
 * no `aria-current` and is not a member of `DockScreen`.
 *
 * TWO GESTURES, ONE TARGET
 *   tap         -> onReport(). Opens the report sheet.
 *   hold 1s     -> onPinDrop(). Drops a pin, no dialog. The tap NEVER fires.
 *   move/cancel -> neither fires. A hold that turns into a drag is not a tap,
 *                  and a driver who slides off the key meant to abort.
 *
 * Implemented on pointer events so one code path covers touch, pen and mouse.
 * `setPointerCapture` is NOT used: it is absent in jsdom and unnecessary here,
 * because a pointer leaving the key cancels the hold anyway.
 *
 * WHAT THIS COMPONENT DOES NOT DO
 *   - It never touches `navigator.vibrate`. The design asks for "1s, one
 *     haptic, no dialog", but haptics in this product are reserved for camera
 *     alerts and `services/adapters/vibration.ts` throws for every other
 *     source. `onHaptic` is the seam where that ruling lands; until then the
 *     confirmation is visual only.
 *     See docs/gaps-inbox/dock-report-bar.md#pin-drop-haptic-vs-camera-only.
 *   - It never reads GPS or heading, and it never asks for a permission on
 *     render. `onPinDrop` runs in the owner, which owns the geolocation
 *     adapter. With no `onPinDrop` the hold is not armed at all and the key
 *     says so (`data-fwm-pin-drop="unavailable"`) rather than pretending.
 *   - It never sees a plate, a queue row or a coordinate. It receives one
 *     number: how many items are waiting to sync.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from 'react';

import { openScreen } from '../../app/screenState.ts';

import './reportKey.css';

/** "1s hold drops a pin" -- Flockys App Screens v2.dc.html, dock panel. */
export const HOLD_TO_DROP_MS = 1000;

/**
 * How far a pointer may drift during a hold before it stops being a hold.
 * GAP: see DESIGN-GAPS.md#report-hold-move-slop -- the design specifies the
 * gesture but no tolerance, and a thumb on a phone in a car mount is never
 * still. Small enough that a deliberate drag aborts, large enough that a bumpy
 * road does not.
 */
export const HOLD_MOVE_SLOP_PX = 10;

/**
 * How long the pin-drop confirmation holds before the key reads REPORT again.
 * GAP: see DESIGN-GAPS.md#report-bar-confirm-dwell -- the design shows the
 * confirmation but never times it, so the one published dock timing stands in
 * rather than a new number.
 */
export const PIN_CONFIRM_DWELL_MS = HOLD_TO_DROP_MS;

/**
 * Exact strings from the design. Do not rewrite them.
 *
 * v2 draws no word on this key -- the mark is the eye and nothing else -- so
 * both strings are now the key's accessible name rather than painted type.
 * They are still the design's words: a screen reader should say what the
 * design says, and "PIN DROPPED" is still the receipt for the hold.
 * GAP: see docs/gaps-inbox/dock-v2.md#pin-drop-confirmation-is-undrawn-in-v2.
 */
export const REPORT_LABEL = 'REPORT CAMERA';
export const PIN_DROPPED_LABEL = 'PIN DROPPED';

export interface ReportKeyProps {
  /**
   * Items waiting to sync, rendered as the amber badge.
   *
   * SEAM: this is a prop, not a store read. `usePendingSyncCount()` does not
   * exist yet -- `apps/pwa/src/stores` has no queue selector -- and the value
   * it will return is `pendingSyncCount(db).total` from `services/db` (reports
   * + actions; dead letters are deliberately excluded there because a stuck
   * item is not a queued one). Until that lands the default is 0 and the key
   * renders no badge, rather than a number nobody measured.
   */
  readonly queuedCount?: number;
  /** Tap. Defaults to opening the report screen through the screen-state adapter. */
  readonly onReport?: () => void;
  /**
   * Hold 1s. Drops a pin with GPS + heading, no dialog. Omitted means the
   * capability is not wired: the hold is not armed and nothing pretends.
   */
  readonly onPinDrop?: () => void;
  /** Fired once, on drop only, never on tap. See the note above. */
  readonly onHaptic?: () => void;
}

export function ReportKey({
  queuedCount = 0,
  onReport,
  onPinDrop,
  onHaptic,
}: ReportKeyProps = {}): ReactElement {
  const holdTimer = useRef<number | null>(null);
  const confirmTimer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const dropped = useRef(false);
  const cancelled = useRef(false);
  const [confirming, setConfirming] = useState(false);

  const report =
    onReport ??
    (() => {
      openScreen('report');
    });

  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  // A dock can unmount mid-hold (surface change, mode change, route swap).
  // Neither timer may outlive it.
  useEffect(
    () => () => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    },
    [],
  );

  const abort = useCallback(() => {
    clearHold();
    cancelled.current = true;
  }, [clearHold]);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      // Secondary buttons are neither a tap nor a hold.
      if (event.button !== 0) return;
      clearHold();
      dropped.current = false;
      cancelled.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      // No pin-drop handler means no pin-drop capability. The tap still works.
      if (onPinDrop === undefined) return;
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null;
        dropped.current = true;
        // Order matters: the confirmation is the receipt for the drop, so the
        // drop happens first and the key only claims it afterwards.
        onHaptic?.();
        onPinDrop();
        setConfirming(true);
        if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
        confirmTimer.current = window.setTimeout(() => {
          confirmTimer.current = null;
          setConfirming(false);
        }, PIN_CONFIRM_DWELL_MS);
      }, HOLD_TO_DROP_MS);
    },
    [clearHold, onHaptic, onPinDrop],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const start = origin.current;
      if (start === null || dropped.current || cancelled.current) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.hypot(dx, dy) > HOLD_MOVE_SLOP_PX) abort();
    },
    [abort],
  );

  const handlePointerUp = useCallback(() => {
    clearHold();
    const held = dropped.current;
    const aborted = cancelled.current;
    const started = origin.current !== null;
    origin.current = null;
    dropped.current = false;
    cancelled.current = false;
    // A hold that already dropped a pin must never also open the sheet.
    if (held || aborted || !started) return;
    report();
  }, [clearHold, report]);

  const handlePointerCancel = useCallback(() => {
    abort();
    origin.current = null;
  }, [abort]);

  // Pointer events do not fire for a keyboard. Enter / Space are a tap.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.repeat) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      report();
    },
    [report],
  );

  return (
    <button
      type="button"
      className="fwm-dock-report-key"
      data-fwm-dock-key="report"
      data-fwm-confirming={confirming ? 'true' : 'false'}
      data-fwm-pin-drop={onPinDrop === undefined ? 'unavailable' : 'hold'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerCancel}
      onKeyDown={handleKeyDown}
    >
      {/* The brand eye, drawn as a mask over a flat fill so the one shipped
          brand image can take the hue. 22px inside a 42px cell, on all five
          rendered docks. */}
      <span className="fwm-report-eye" aria-hidden="true" />
      {/* The key's accessible name, and the receipt for the hold. Clipped out
          of the picture -- v2 paints no word here -- but never removed from
          the tree, because an unnamed icon button is an unusable one. */}
      <span className="fwm-dock-word" aria-live="polite">
        {confirming ? PIN_DROPPED_LABEL : REPORT_LABEL}
      </span>
      {/* Nothing queued draws nothing: the design only ever renders a non-zero
        * count, and a zero badge would be a status about the absence of status.
        * GAP: see DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn
        *
        * v2 paints the bare numeral. v1's bar wrote "2 QUEUED" in full, and a
        * numeral alone is meaningless read aloud, so the badge is the numeral
        * for the eye and the sentence stays in the accessible name. */}
      {queuedCount > 0 ? (
        <>
          <span className="fwm-report-badge fwm-data" data-fwm-queued={queuedCount} aria-hidden="true">
            {queuedCount}
          </span>
          <span className="fwm-dock-word">{queuedCount} QUEUED</span>
        </>
      ) : null}
    </button>
  );
}
