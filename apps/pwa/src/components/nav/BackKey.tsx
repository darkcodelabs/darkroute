/**
 * THE BACK KEY - one control, reused by every screen that is not a root.
 *
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * MISUSE and INTEL each drew their own round `‹` at the top left, with
 * byte-identical CSS under two different class names. Every other screen behind
 * MORE drew nothing at all, so SETTINGS, OFFLINE, DOCS, HELP, LOOK UP, ASK,
 * ALERT DIET and ADMIN were reached and then only left by hitting the dock -
 * which on those screens lights MORE, the place you came from, and does not
 * take you there.
 *
 * Two copies of a control is how the third copy ends up subtly different. This
 * is the one copy: same 44px circle, same glyph, same hue as the two that
 * already shipped, and the two originals now render it rather than their own.
 *
 * =============================================================================
 * BACK IS A FIXED PARENT, NOT A HISTORY POP
 * =============================================================================
 * `history.back()` unwinds whatever the browser happens to be holding. That is
 * a different destination depending on how you arrived, it can walk out of the
 * app entirely when the screen was a deep link or a manifest shortcut, and it
 * is unanswerable from the markup - a driver cannot see where the arrow goes.
 *
 * So each screen names its parent and this navigates there with `openScreen`,
 * the app's own adapter, which writes `?screen=` and pushes one history entry
 * the same way the dock does. `MisuseScreen` already worked this way; this
 * keeps that rule and gives it to everybody else.
 *
 * The cost is real and worth stating: DRIVE's gear opens SETTINGS directly, so
 * backing out of SETTINGS lands on MORE rather than on DRIVE. That is one tap
 * from where you were, it is the same tap every time, and it is a place the
 * driver can see named on the control. Remembering the entry point instead
 * would mean a second navigation model living beside `screenState`, which is
 * the thing this file exists to avoid having two of.
 *
 * =============================================================================
 * THE NAME IS THE DESTINATION
 * =============================================================================
 * A bare `‹` announces as "button" and nothing else. `label` is required rather
 * than optional, and callers pass the whole phrase - "back to everything else"
 * - because "back" on its own tells a screen-reader user that something will
 * move and not what to.
 */

import type { ReactElement } from 'react';

import { openScreen } from '../../app/screenState.ts';
import type { ScreenId } from '../../app/screenState.ts';

import './nav.css';

/**
 * The drawn glyph: U+2039, SINGLE LEFT-POINTING ANGLE QUOTATION MARK.
 *
 * Not `<` and not an SVG chevron. It is what MISUSE and INTEL already draw, it
 * has a matching `›` that MORE's rows use for the outbound direction, and it
 * renders in the app's own face at every text scale with no icon budget.
 */
export const BACK_GLYPH = '‹';

/**
 * The name eight screens share, because they share a parent.
 *
 * MORE is v1's hub and everything except DRIVE, LOG and MESH sits behind it,
 * so "back to everything else" is spoken by SETTINGS, OFFLINE, DOCS, HELP,
 * LOOK UP, ASK, ALERT DIET, ADMIN and MISUSE alike. Written once here rather
 * than nine times: it is MORE's own title in a sentence, and if that title
 * changes the arrows must change with it.
 */
export const BACK_TO_MORE = 'back to everything else';

interface BackKeyBase {
  /** The accessible name, spoken in full. "back to everything else", not "back". */
  readonly label: string;
}

/**
 * Either a destination or a handler, never both and never neither.
 *
 * A union rather than two optional props, so a screen cannot ship a back key
 * wired to nothing - which is exactly the failure this component exists to
 * stop, and which a pair of optionals would happily compile.
 */
export type BackKeyProps =
  | (BackKeyBase & {
      /** Where the arrow goes. Navigated with `openScreen`. */
      readonly to: ScreenId;
      readonly onBack?: never;
    })
  | (BackKeyBase & {
      readonly to?: never;
      /**
       * Used instead of navigating. INTEL is reachable as a modal over the map
       * AND as a screen, so its dismiss has to close an overlay when there is
       * one - a screen id cannot express that.
       */
      readonly onBack: () => void;
    });

export function BackKey(props: BackKeyProps): ReactElement {
  return (
    <button
      type="button"
      className="fwm-backkey"
      /* The destination, readable from the DOM. A headless check can assert
         every screen's arrow points somewhere real without reaching into a
         handler; `custom` is INTEL's overlay dismiss. */
      data-fwm-back-to={props.onBack === undefined ? props.to : 'custom'}
      aria-label={props.label}
      onClick={() => {
        if (props.onBack === undefined) openScreen(props.to);
        else props.onBack();
      }}
    >
      {/* Hidden from the accessibility tree: `aria-label` above is the name,
          and a punctuation mark read out beside it is noise. */}
      <span aria-hidden="true">{BACK_GLYPH}</span>
    </button>
  );
}
