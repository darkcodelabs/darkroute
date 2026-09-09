/**
 * The `WAKE WORD ON` chip in ASK's header.
 *
 * SOURCE: `Flockys App Screens.dc.html`, `04 · ASK - LISTENING` -- 10px mono at
 * .1em in #3DE08A, right-aligned in the 52px header.
 *
 * =============================================================================
 * IT IS A CONTROL, NOT A LABEL, AND IT STARTS OFF
 * =============================================================================
 * The design draws the armed state. Rendering that on mount would mean the app
 * opens the microphone the moment ASK appears, which is exactly what the
 * screen's rules forbid. So the chip is a button, it starts `WAKE WORD OFF`,
 * and arming it is a press.
 * GAP: see docs/gaps-inbox/ask.md#wake-word-chip-is-drawn-as-a-label
 *
 * =============================================================================
 * IT REPORTS THE PESSIMISTIC ANSWER, NOT THE OPTIMISTIC ONE
 * =============================================================================
 * `speechCapability()` says whether push-to-talk works. This chip must use the
 * SEPARATE `wakeWordCapability()`, which additionally refuses whenever the
 * document is hidden or the implementation has no `continuous` flag:
 *
 *   "The `WAKE WORD ON` chip drawn in `04 · ASK` must render this reason
 *    instead of a broken promise."   -- docs/platform-capabilities.md
 *
 * When it is not supported the chip is disabled and the reason is rendered by
 * `AskNotice`, because a 10px nowrap chip cannot carry a sentence.
 */

import type { ReactElement } from 'react';

/** on = armed and listening for the wake word. off = available, not armed. */
export type WakeWordState = 'on' | 'off' | 'unavailable';

export interface WakeWordChipProps {
  readonly state: WakeWordState;
  /** Absent, or an `unavailable` state, renders the chip inert. */
  readonly onToggle?: (() => void) | undefined;
}

export function WakeWordChip({ state, onToggle }: WakeWordChipProps): ReactElement {
  const disabled = state === 'unavailable' || onToggle === undefined;

  return (
    <button
      type="button"
      className="fwm-ask-wake"
      data-fwm-ask-wake={state}
      disabled={disabled}
      aria-pressed={state === 'on'}
      onClick={onToggle}
    >
      {state === 'on' ? 'WAKE WORD ON' : 'WAKE WORD OFF'}
    </button>
  );
}
