/**
 * The `TRY` suggestion chips.
 *
 * SOURCE: `.design-src-v2/Flockys App Screens v2.dc.html`, `04 · ASK -
 * LISTENING` (lines 324-331) -- the label `TRY` in 10px mono at .18em, then
 * three chips at 12px in #A7AFBD, filled #1B1E25 at an 8px radius:
 *
 *   cameras near me · flocked today? · who owns FWM-0442
 *
 * v2 turned these from outlined pills into filled keys -- the 1px #3A3F4B edge
 * came off, #1B1E25 came on, and the 999px corner became the 8px corner every
 * rectangular control in v2 shares. The three strings are unchanged, as is
 * everything in this file. See `docs/gaps-inbox/lookup-ask-v2.md`.
 *
 * ALL THREE SHIP
 *   `FWM-0442` is a CAMERA id, not a plate. The design draws it as one twice --
 *   `ID FWM-0442 · EFF ATLAS OK` on the SWEEP camera card and
 *   `FWM-0442 · HOA · SHARED` on the LOOKUP row -- so the chip asks who owns a
 *   piece of public infrastructure, which `FEATURES.plateLookup` does not gate
 *   and never did. An earlier build filtered it out as a plate lookup and
 *   shipped two of the design's three chips on a false premise.
 *   GAP: see docs/gaps-inbox/ask.md#fwm-0442-is-a-camera-id-not-a-plate
 *
 * THE CHIPS ARE BUTTONS
 *   The design draws them as static divs, but a suggestion that cannot be
 *   taken is not a suggestion -- and tapping one is the path to an answer that
 *   never opens the microphone at all.
 */

import type { ReactElement } from 'react';

/** Verbatim, in the design's order and casing. What the screen ships. */
export const TRY_CHIPS: readonly string[] = Object.freeze([
  'cameras near me',
  'flocked today?',
  'who owns FWM-0442',
]);

export interface TryChipsProps {
  readonly chips: readonly string[];
  /** Absent renders the chips inert rather than removing the row. */
  readonly onAsk?: ((question: string) => void) | undefined;
}

export function TryChips({ chips, onAsk }: TryChipsProps): ReactElement | null {
  if (chips.length === 0) return null;

  return (
    <div className="fwm-ask-try">
      <p className="fwm-ask-speaker">TRY</p>
      <div className="fwm-ask-chips" data-fwm-ask-chips={String(chips.length)}>
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            className="fwm-ask-chip"
            data-fwm-ask-chip={chip}
            disabled={onAsk === undefined}
            onClick={
              onAsk === undefined
                ? undefined
                : () => {
                    onAsk(chip);
                  }
            }
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}
