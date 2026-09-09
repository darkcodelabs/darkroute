/**
 * THE REPORT KEY. One 54px circle, drawn identically in all nineteen states.
 *
 * IT IS NOT INSIDE THE PANE. `Dock` returns it as the pane's PREVIOUS SIBLING
 * -- right-aligned, pulled down six pixels so it laps over the pane's top edge.
 * Putting it inside the shell would take a bite out of one of the three locked
 * heights and would put a sixth destination in a five-column grid.
 *
 * IT NO LONGER SHARES ITS CORNER WITH ANYTHING. v2 drew a grey expand chevron
 * in the same place and the two collided; v3 deletes the chevron outright and
 * makes the whole pane the tap target, so the key has that corner to itself.
 *
 * It is also the one element that ignores the state machine entirely. Its ring
 * is the magenta rail in every state, including the amber-surfaced APPROACHING
 * and the red-surfaced ABUSE ZONE, ENTERING. Reporting a camera is always
 * available and never escalates, so it never changes colour.
 *
 * IT IS THE SAME GLASS AS THE PANE. Thin ground, crossed grain, blur, hairline
 * -- a 54px surface floating over a live map, and a solid plate with a cast
 * shadow on it is the exact pair the chrome brief bans.
 *
 * ITS GLYPH IS NOT THE DOCK'S CAMERA. `camera-plus` has a narrower body and a
 * plus where the lens goes; `camera` has a wider body and a stroked lens. The
 * spec ships both and they mean different things -- "add a camera" versus "a
 * camera". `icons.tsx` keeps them apart; do not unify them here.
 */

import type { ReactElement } from 'react';

import { DockIcon } from './icons.tsx';

/**
 * The accessible name.
 *
 * The spec's key carries no label, no `aria-label` and no `title` -- it is a
 * static page and nothing there has to be announced. An icon button with no
 * accessible name is unusable, so it gets one here.
 *
 * Sentence case, because it is content rather than one of the 11px tracked
 * labels, and because it is only ever spoken.
 */
export const DOCK_REPORT_LABEL = 'Report camera';

/** The glyph inside the 54px circle. */
const REPORT_ICON = 24;

export interface ReportButtonProps {
  readonly onReport: () => void;
}

export function ReportButton({ onReport }: ReportButtonProps): ReactElement {
  return (
    <button
      type="button"
      className="fwm-dock-report"
      aria-label={DOCK_REPORT_LABEL}
      onClick={() => {
        onReport();
      }}
    >
      <DockIcon name="camera-plus" size={REPORT_ICON} />
    </button>
  );
}
