/**
 * The nine-column voice meter, and the only control that opens the microphone.
 *
 * SOURCE: `.design-src-v2/Flockys App Screens v2.dc.html`, `04 · ASK -
 * LISTENING` (lines 279-303) -- an 84px band holding a masked 5px dot field
 * and nine 11px columns 3px apart, bottom-aligned, each clipping a dot-matrix
 * fill that runs `fwmVoice` on its own period. Heights and periods live in
 * `ask.css`, one rule per column, exactly as the design assigns them.
 *
 * WHAT V2 CHANGED, AND WHAT IT DID NOT
 *   v1 drew seven solid 6px bars, vertically centred, 4px apart. v2 draws nine
 *   dot-matrix columns, bottom-aligned, 3px apart, on a dimmer lattice of the
 *   same 5px pitch. The first seven periods are v1's, unchanged; the two new
 *   columns carry 1.18s and .86s.
 *
 *   Nothing about the CONTROL moved: same button, same phases, same handler,
 *   same rule that the microphone only ever opens from a press. The redesign
 *   is entirely in what the band looks like while it is doing that.
 *
 * THE FIELD IS FIRST, AND THAT IS LOAD-BEARING
 *   The field and the columns are both positioned, so they paint in DOM order.
 *   The field is rendered first so the columns paint over it, which is the
 *   order v2 draws them in and the reason no z-index appears anywhere here.
 *
 * WHY IT IS A BUTTON
 *   The design draws only the listening state, so it draws no control that
 *   starts listening. Rather than invent a second element, the band the design
 *   already draws IS the control: still and grey when idle, running and cyan
 *   while the microphone is open.
 *   GAP: see docs/gaps-inbox/ask.md#no-drawn-control-starts-listening
 *
 * WHY IT CAN BE DISABLED
 *   Same rule as RADAR's degraded action: a platform with no speech recognition
 *   gets the control drawn and inert, not a live-looking control that silently
 *   does nothing, and never a fake transcript.
 *
 * NOTHING HERE TOUCHES THE MICROPHONE. The press handler comes from above and
 * runs on click, so the permission prompt can only ever follow a user gesture.
 */

import type { ReactElement } from 'react';

/**
 * Nine columns, keyed by position. The design assigns each one its own height
 * and its own period, and `ask.css` addresses them by this number rather than
 * by ordinal position -- the field occupies the button's first child slot.
 */
const BARS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export interface VoiceBarsProps {
  /** True while the microphone is open. Drives the animation and the label. */
  readonly listening: boolean;
  /** Absent means "this platform cannot listen" -- the band renders inert. */
  readonly onPress?: (() => void) | undefined;
}

export function VoiceBars({ listening, onPress }: VoiceBarsProps): ReactElement {
  return (
    <button
      type="button"
      className="fwm-ask-mic"
      data-fwm-ask-mic={listening ? 'listening' : 'idle'}
      disabled={onPress === undefined}
      aria-pressed={listening}
      aria-label={listening ? 'stop listening' : 'press to talk'}
      onClick={onPress}
    >
      <span className="fwm-ask-field" aria-hidden="true" />
      {BARS.map((bar) => (
        <span
          key={bar}
          className="fwm-ask-bar"
          data-fwm-ask-bar={String(bar)}
          aria-hidden="true"
        >
          <span className="fwm-ask-bar-fill" />
        </span>
      ))}
    </button>
  );
}
