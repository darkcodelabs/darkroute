/**
 * THE EASTER EGG'S TOAST -- section E of `searchbar_and_buttons.dc.html`.
 *
 * One sentence in a pill of glass near the bottom of the map, put there by
 * tapping the mark. Android's build-number sequence, with one substitution:
 * the word is `haKCer`, capital K and capital C, and it is spelled that way in
 * all five strings below because it is a name and not a noun.
 *
 * NOT A LITERAL ANDROID TOAST, and the brief says so. `Toast.makeText` draws
 * the platform's grey lozenge in the platform's font at the platform's
 * position, which on this surface would be the one element in the product that
 * is not the product. This is the app's own surface wearing the app's own
 * language -- 999px of translucent glass with a hairline and the blur -- and
 * `pixelSweep.css` section 10 is where that is resolved.
 *
 * THIS COMPONENT HOLDS NOTHING. It is handed a sentence or a null and it draws
 * one or nothing. The tap counter, the 3.2s timer and the decision about which
 * sentence this is all live in `useChromeSweep` in `PixelSweep.tsx`, next to
 * the pulse they arrive with: the toast has no existence apart from the taps
 * that produce it, and a component that counted its own taps would be a second
 * copy of that state living where nothing else can see it.
 *
 * =============================================================================
 * WHAT THE COUNTER IS NOT
 * =============================================================================
 * It is session-only and it never persists. Not to `localStorage`, which this
 * repository bans outright, not to the vault, not to a query string. It gates
 * nothing, unlocks nothing, is not a setting, and is never logged. A delight
 * that writes something down is a feature, and a feature that arrives by
 * tapping a logo seven times is one nobody can find, turn off, or audit.
 */

import type { ReactElement } from 'react';

import './pixelSweep.css';

/**
 * HOW MANY TAPS THE SEQUENCE TAKES. Android's is seven, and this is Android's
 * sequence -- the count is the reference, not a tuning knob.
 */
export const HAKCER_TAPS = 7;

/** Taps 1 through 3 say nothing at all. The countdown starts at four. */
export const HAKCER_SILENT_TAPS = 3;

/**
 * HOW LONG THE SENTENCE STAYS, in milliseconds. 3.2s, and a new tap resets it
 * rather than queueing a second pill. `pixelSweep.css` carries the same 3.2s
 * as a token multiple and `PixelSweep.test.ts` asserts the two agree.
 */
export const TOAST_DISMISS_MS = 3200;

/**
 * THE FIVE SENTENCES, VERBATIM.
 *
 * Written out rather than assembled from a count and a pluraliser. The spec
 * page builds them with `'You are now ' + left + ' step' + (left === 1 ? '' :
 * 's') + ...`, which is the same five strings and one more place for a
 * plural to go wrong; these are the strings the brief tabulates, and the test
 * compares against these characters.
 */
export const HAKCER_TOASTS: Readonly<Record<number, string>> = {
  4: 'You are now 3 steps away from being a haKCer.',
  5: 'You are now 2 steps away from being a haKCer.',
  6: 'You are now 1 step away from being a haKCer.',
  7: 'You are now a haKCer!',
};

/** Every tap past the seventh. There is nowhere further to get to. */
export const HAKCER_ALREADY = 'No need, you are already a haKCer.';

/**
 * WHICH SENTENCE A TAP COUNT SAYS, or `null` for the three that say nothing.
 *
 * Pure, total and exported so the sequence can be asserted end to end without
 * rendering anything -- the count is the whole of the behaviour here and it is
 * the half most likely to drift by one.
 */
export function toastForTaps(taps: number): string | null {
  if (taps <= HAKCER_SILENT_TAPS) return null;
  if (taps > HAKCER_TAPS) return HAKCER_ALREADY;
  return HAKCER_TOASTS[taps] ?? null;
}

export interface ToastProps {
  /** The sentence to draw, or `null` to draw nothing. */
  readonly message: string | null;
}

export function Toast({ message }: ToastProps): ReactElement | null {
  if (message === null) return null;
  return (
    /*
     * `role="status"` rather than `alert`: this is not urgent, it interrupts
     * nothing, and `alert` would cut across whatever a screen reader was in
     * the middle of saying for the sake of a joke. Announced on mount, which
     * is the one moment there is anything to announce.
     */
    <div className="fwm-pxtoast" role="status">
      {message}
    </div>
  );
}
