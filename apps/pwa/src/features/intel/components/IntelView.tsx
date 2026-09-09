/**
 * THE INTEL CARD, as a pure function of a view model.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `A4 · INTEL CARD - MODAL FROM SWEEP`,
 * plus `B9 · RECORD FLAGS - WHERE IT SURFACES` for the flagged-operator
 * variant. `IntelScreen.tsx` reads the stores and builds the model; this file
 * decides what is on screen and in what order, which is what makes every
 * state -- muted, no fix, no record, flagged -- renderable in a test without a
 * store, a fake GPS or a clock.
 *
 * =============================================================================
 * THE STACK, TOP TO BOTTOM
 * =============================================================================
 *   grabber        44x4, and the dismiss
 *   title row      hardware name (or the id) beside `425 FT · SW`
 *   id line        `FWM-0442 · …`, and the copy target
 *   record banner  B9, only when a flagged operator has citations
 *   three tiles    OWNER · MOUNT · FACING
 *   record block   the five fact rows
 *   photo drop     drawn, off, and it says so
 *   four actions   CONFIRM STILL THERE / DISPUTE, MUTE THIS ONE / SHARE
 *   mute line      only while this camera's own mute timer is running
 *   one status     only after an action; the panel draws none
 *
 * and the scrim -- the panel's `rgba(0,0,0,.72)` wash -- behind all of it.
 *
 * B9 draws the banner as "ON THE INTEL CARD" without saying where on it. It
 * goes above the tiles because it qualifies the OWNER tile directly beneath
 * it, and because a warning below three hundred pixels of record is a warning
 * the driver scrolls past.
 * GAP: docs/gaps-inbox/intel.md#record-banner-placement-not-drawn
 *
 * =============================================================================
 * THE SCRIM IS DRAWN FIRST AND REACHED LAST
 * =============================================================================
 * The scrim is a dismiss control (the panel draws no close button; the scrim
 * and the grabber are the two affordances it does draw). It is therefore a
 * `<button>` -- and it is the LAST element inside the dialog, not the first,
 * so that the first thing a screen reader or a keyboard reaches inside
 * `aria-modal="true"` is the camera, not "dismiss intel card". It keeps its
 * drawn position underneath the card through `z-index`, not through source
 * order.
 * GAP: docs/gaps-inbox/intel.md#modal-focus-order-and-trap
 *
 * =============================================================================
 * `aria-modal` IS A PROMISE, SO IT IS KEPT
 * =============================================================================
 * Declaring `aria-modal="true"` tells assistive tech that everything outside
 * this dialog is inert. That is only true if focus actually starts inside and
 * cannot leave: this file moves focus to the card on mount, cycles Tab within
 * it, and closes on Escape -- a keyboard's version of the scrim tap, not a new
 * drawn control.
 *
 * =============================================================================
 * MUTED IS A HUE AND A CLOCK, NOT A DELETION
 * =============================================================================
 * Nothing in this file is hidden, greyed out or disabled because the camera is
 * muted. The card keeps every fact, every tile and every action; muting reaches
 * the DOM as one hue, one `aria-pressed`, and one line saying how long it lasts
 * and that the camera is still drawn and still counted.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';

import {
  MUTE_STILL_COUNTED,
  actionMessage,
  isActionFailure,
  muteClockLabel,
} from '../intelState.ts';
import type { IntelActionOutcome, IntelViewModel } from '../intelState.ts';

import { IntelActions } from './IntelActions.tsx';
import { IntelFacts } from './IntelFacts.tsx';
import { IntelHeader } from './IntelHeader.tsx';
import { IntelPhoto } from './IntelPhoto.tsx';
import { IntelTiles } from './IntelTiles.tsx';
import { OperatorRecordBanner } from './OperatorRecordBanner.tsx';

/**
 * What the card says when SWEEP has not named a camera.
 *
 * The design never draws this: the card only exists as the result of tapping a
 * dot. It is reachable anyway -- `intel` is a screen id, so a deep link can ask
 * for it directly -- and the honest answer is better than an empty modal.
 * GAP: see DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn and
 * docs/gaps-inbox/intel.md#no-camera-selected-state-not-drawn
 */
export const NO_CAMERA_NOTE = 'NO CAMERA SELECTED · TAP A DOT ON SWEEP';

/**
 * Every stop inside the dialog, in drawn order.
 *
 * Buttons only, because buttons are the only interactive element this card has
 * -- there is no input, no link and no select anywhere on it, and a selector
 * that lists element types the card does not contain is a selector nobody can
 * check against the render.
 */
function tabStops(root: HTMLElement): readonly HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
}

export interface IntelViewHandlers {
  /** Closes the card. Wired to the grabber, the scrim and Escape. */
  readonly onDismiss?: (() => void) | undefined;
  readonly onCopyId?: (() => void) | undefined;
  readonly onConfirm?: (() => void) | undefined;
  readonly onDispute?: (() => void) | undefined;
  readonly onToggleMute?: (() => void) | undefined;
  readonly onShare?: (() => void) | undefined;
  /** Opens the phone's maps app at this camera. */
  readonly onNavigate?: (() => void) | undefined;
  /** Opens RECORD scoped to this operator. Absent hides the sources link. */
  readonly onSeeSources?: (() => void) | undefined;
  /** Wired only when a build can strip a photo's metadata. Absent today. */
  readonly onDropPhoto?: (() => void) | undefined;
}

export type IntelViewProps = IntelViewHandlers & {
  /** Null when nothing is selected. Renders {@link NO_CAMERA_NOTE}. */
  readonly model: IntelViewModel | null;
  /** True while a queue write is in flight. */
  readonly busy?: boolean;
  /** The last action's result, or null. One line, under the actions. */
  readonly outcome?: IntelActionOutcome | null;
};

export function IntelView({
  model,
  busy = false,
  outcome = null,
  ...handlers
}: IntelViewProps): ReactElement {
  const rootRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const { onDismiss } = handlers;

  // The dialog opens on the card itself rather than on its first control: the
  // driver's question is "what is this camera", and landing on CONFIRM STILL
  // THERE answers a different one.
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>): void => {
      if (event.key === 'Escape') {
        if (onDismiss === undefined) return;
        event.preventDefault();
        onDismiss();
        return;
      }
      if (event.key !== 'Tab') return;

      const root = rootRef.current;
      if (root === null) return;
      const stops = tabStops(root);
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (first === undefined || last === undefined) {
        // Nothing is wired: hold focus on the card rather than letting Tab
        // walk out of a dialog that claims everything else is inert.
        event.preventDefault();
        cardRef.current?.focus();
        return;
      }

      const active = document.activeElement;
      if (event.shiftKey) {
        if (active !== first && active !== cardRef.current) return;
        event.preventDefault();
        last.focus();
        return;
      }
      if (active !== last) return;
      event.preventDefault();
      first.focus();
    },
    [onDismiss],
  );

  return (
    <section
      ref={rootRef}
      className="fwm-intel"
      data-fwm-intel-state={model?.state ?? 'none'}
      data-fwm-intel-flagged={model?.operatorRecord === null || model === null ? 'false' : 'true'}
      role="dialog"
      aria-modal="true"
      aria-label="camera intel"
      onKeyDown={onKeyDown}
    >
      <div className="fwm-intel-card" ref={cardRef} tabIndex={-1}>
        {model === null ? (
          <p className="fwm-intel-note fwm-data" data-fwm-intel-note="empty">
            {NO_CAMERA_NOTE}
          </p>
        ) : (
          <>
            <IntelHeader
              identity={model.identity}
              readout={model.readout}
              cameraId={model.cameraId}
              onDismiss={handlers.onDismiss}
              onCopyId={handlers.onCopyId}
            />

            <OperatorRecordBanner
              record={model.operatorRecord}
              onSeeSources={handlers.onSeeSources}
            />

            <IntelTiles tiles={model.tiles} />

            <IntelFacts facts={model.facts} />

            <IntelPhoto available={model.photoAvailable} onDropPhoto={handlers.onDropPhoto} />

            <IntelActions
              mutedHere={model.mutedCamera}
              busy={busy}
              onConfirm={handlers.onConfirm}
              onDispute={handlers.onDispute}
              onToggleMute={handlers.onToggleMute}
              onShare={handlers.onShare}
              onNavigate={handlers.onNavigate}
            />

            {model.muteCountdown === null ? null : (
              <p className="fwm-intel-note fwm-data" data-fwm-intel-note="mute" role="status">
                <span className="fwm-intel-mute-clock">{muteClockLabel(model.muteCountdown)}</span>
                {` · ${MUTE_STILL_COUNTED}`}
              </p>
            )}

            {outcome === null ? null : (
              <p
                className="fwm-intel-note fwm-data"
                data-fwm-intel-note="outcome"
                data-fwm-intel-tone={isActionFailure(outcome) ? 'alert' : 'default'}
                role="status"
              >
                {actionMessage(outcome)}
              </p>
            )}
          </>
        )}
      </div>

      {handlers.onDismiss === undefined ? (
        <div className="fwm-intel-scrim" aria-hidden="true" />
      ) : (
        <button
          type="button"
          className="fwm-intel-scrim"
          aria-label="dismiss intel card"
          onClick={handlers.onDismiss}
        />
      )}
    </section>
  );
}
