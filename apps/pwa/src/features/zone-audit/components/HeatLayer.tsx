/**
 * The heat layer -- `HEAT LAYER · READS PER MILE DRIVEN`.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `B6 · ZONE AUDIT` -- a 210px panel,
 * 1px rule, diagonal hatch, three soft blobs in the clear / approaching /
 * in-range hues, and the caption bottom-left in 9px mono.
 *
 * WHY IT IS A GRID AND NOT THREE FLOATING BLOBS
 *   A blob's position is data, and the only way a data-driven position reaches
 *   the DOM is an inline `style`, which is how a raw length gets past the token
 *   checker. So the disc is an 8x6 grid and a cell's band is an attribute. Each
 *   blob bleeds half a cell past every edge, so neighbouring bands merge into
 *   the soft shapes B6 draws instead of reading as tiles.
 *   GAP: see docs/gaps-inbox/zone-audit.md#heat-grid-resolution-is-chosen-not-drawn
 *
 * WHAT IT DRAWS WHEN THERE IS NOTHING TO DRAW
 *   The reason, in words. A fake blob would be a lie about surveillance
 *   density, which is the one thing this screen exists to state accurately.
 *   GAP: see docs/gaps-inbox/zone-audit.md#heat-layer-has-no-drawn-empty-state
 *
 * THE CAPTION IS PASSED IN, NOT ASSUMED
 *   The layer measures a RATE only while a trip odometer exists to divide by.
 *   Otherwise it counts, and the caption has to say so -- the drawn line names
 *   a denominator, and printing it over a number nobody divided would be the
 *   same lie in words.
 *   GAP: see docs/gaps-inbox/zone-audit.md#heat-scope-falls-back-when-no-trip-is-open
 *
 * MUTED CAMERAS ARE IN HERE. Nothing in this component reads a mute, and no
 * attribute below can hide a cell.
 */

import type { ReactElement } from 'react';

import { HEAT_CAPTION } from '../zone.ts';
import type { HeatCell } from '../zone.ts';

export interface HeatLayerProps {
  readonly cells: readonly HeatCell[];
  /** B6 draws the overlay on. */
  readonly tripOverlay: boolean;
  /** Why there is nothing to draw, or null when there is. */
  readonly unavailable: string | null;
  /**
   * The line bottom-left. B6's own string when the layer is measuring the rate
   * B6 captions; the string for the scope it is actually in otherwise, because
   * a count carried under a rate's caption is a claim nobody measured.
   */
  readonly caption?: string;
}

export function HeatLayer({
  cells,
  tripOverlay,
  unavailable,
  caption = HEAT_CAPTION,
}: HeatLayerProps): ReactElement {
  return (
    <div
      className="fwm-zone-heat"
      data-fwm-zone-trip-overlay={tripOverlay ? 'on' : 'off'}
      data-fwm-zone-heat-state={unavailable === null ? 'drawn' : 'unavailable'}
    >
      <div className="fwm-zone-heat-hatch" aria-hidden="true" />
      {unavailable === null ? (
        <div className="fwm-zone-heat-grid" role="img" aria-label={caption}>
          {cells.map((cell) => (
            <div
              key={cell.index}
              className="fwm-zone-heat-cell"
              data-fwm-zone-heat-rank={cell.rank}
              data-fwm-zone-heat-trip={cell.onTrip ? 'true' : 'false'}
              data-fwm-zone-heat-reads={String(cell.reads)}
              data-fwm-zone-heat-cameras={String(cell.cameras)}
            >
              <span className="fwm-zone-heat-blob" aria-hidden="true" />
            </div>
          ))}
        </div>
      ) : (
        <p className="fwm-zone-heat-empty">{unavailable}</p>
      )}
      <p className="fwm-zone-heat-caption">{caption}</p>
    </div>
  );
}
