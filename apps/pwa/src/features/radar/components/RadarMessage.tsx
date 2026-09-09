/**
 * The copy block that replaces the readout in a degraded state.
 *
 * SOURCE: `Flockys App Screens.dc.html`, state matrix card 3 --
 *   "last fix 40s ago." / "showing cached cameras only."
 * and `Flockys Screens II.dc.html`, `A1 · ONBOARDING - PERMISSIONS` --
 *   "Required. Distance to cameras is computed on-device. Coordinates never
 *    leave the phone unless you file a report."
 *
 * Both strings are literal reads. The loading line is not: the design draws no
 * loading state for any screen.
 * GAP: see DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn and
 * docs/gaps-inbox/radar-screen.md#radar-loading-state-not-drawn
 */

import type { ReactElement } from 'react';

export interface RadarMessageProps {
  /** The lead sentence. Lowercase, blunt, as the design writes them. */
  readonly lead: string;
  /** A second, quieter line. Optional -- the matrix uses one, onboarding two. */
  readonly note?: string | null;
}

export function RadarMessage({ lead, note = null }: RadarMessageProps): ReactElement {
  return (
    <div className="fwm-radar-message" role="status">
      <span>{lead}</span>
      {note === null ? null : <span className="fwm-radar-message-note">{note}</span>}
    </div>
  );
}
