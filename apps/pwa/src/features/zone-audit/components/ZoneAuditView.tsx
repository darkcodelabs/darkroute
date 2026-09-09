/**
 * `B6 · ZONE AUDIT - SHAREABLE CARD + HEAT LAYER`, as a pure function of a view
 * model.
 *
 * Element order is the panel's order: header, heat layer, legend row,
 * `SHARE CARD - RENDERS AS AN IMAGE` eyebrow, the card, and the `SHARE CARD` /
 * `EXPORT CSV` keys at the bottom.
 *
 * The REPORT bar and the five dock word-keys are NOT here: they are shell
 * chrome (`app/App.tsx` + `components/dock`), rendered on every screen, and
 * drawing a second copy would put two docks on the page. B6 draws neither.
 *
 * This component reads no store, calls no browser API and takes no clock. It is
 * the seam the state tests render against.
 */

import type { ReactElement } from 'react';

import { SHARE_CARD_EYEBROW } from '../zone.ts';
import type { HeatCell, ZoneRadiusMi, ZoneStats } from '../zone.ts';

import { HeatLayer } from './HeatLayer.tsx';
import { HeatLegend } from './HeatLegend.tsx';
import { ShareCard } from './ShareCard.tsx';
import { ZoneAuditActions } from './ZoneAuditActions.tsx';
import { ZoneAuditHeader } from './ZoneAuditHeader.tsx';

/** B6's title, verbatim. */
export const ZONE_AUDIT_TITLE = 'ZONE AUDIT';

/**
 * What the last press did.
 *
 * B6 draws no feedback of any kind, so each string states the outcome plainly
 * rather than implying a success the platform did not give.
 * GAP: see DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn
 */
export type ZoneNotice = 'shared' | 'share-unavailable' | 'share-failed' | 'csv-exported';

export const ZONE_NOTICES: Readonly<Record<ZoneNotice, string>> = Object.freeze({
  shared: 'CARD SHARED',
  'share-unavailable': 'SHARING IS NOT AVAILABLE ON THIS DEVICE',
  'share-failed': 'THE SHARE SHEET FAILED',
  /**
   * What the file HAS in it, not a blanket promise it cannot keep.
   *
   * `NO LOCATION` was the previous string and it was too strong: the rows are
   * public camera ids, and a set of ids drawn from one 2 mi disc describes an
   * AREA even though no field in the file is a coordinate, a bearing or a
   * distance. Naming the contents lets the driver decide who gets the file.
   * GAP: see docs/gaps-inbox/zone-audit.md#the-csv-id-set-still-describes-an-area
   */
  'csv-exported': 'CSV EXPORTED · CAMERA IDS ONLY, NO PLATE, NO COORDINATES',
});

export interface ZoneAuditViewModel {
  readonly radiusMi: ZoneRadiusMi;
  readonly cells: readonly HeatCell[];
  /** The heat layer's caption, which names the scope its numbers were taken in. */
  readonly heatCaption: string;
  /** Why the layer has nothing to draw, or null when it has. */
  readonly heatUnavailable: string | null;
  readonly tripOverlay: boolean;
  /** Null until the zone can be located. The card then prints em dashes. */
  readonly stats: ZoneStats | null;
  /** What named the zone, when anything did. Never a coordinate. */
  readonly place: string | null;
  readonly atMs: number;
  /** Absolute origin from app config. Never built here. */
  readonly origin: string | null;
  /** Cameras the export would carry. Zero disables the key. */
  readonly exportableRows: number;
  readonly notice: ZoneNotice | null;
}

export interface ZoneAuditViewHandlers {
  readonly onRadius?: (() => void) | undefined;
  readonly onTripOverlay?: (() => void) | undefined;
  readonly onShare?: (() => void) | undefined;
  readonly onExportCsv?: (() => void) | undefined;
}

export type ZoneAuditViewProps = ZoneAuditViewHandlers & {
  readonly model: ZoneAuditViewModel;
};

export function ZoneAuditView({
  model,
  onRadius,
  onTripOverlay,
  onShare,
  onExportCsv,
}: ZoneAuditViewProps): ReactElement {
  return (
    <section
      className="fwm-zone"
      data-fwm-zone-screen="zone-audit"
      data-fwm-zone-radius={String(model.radiusMi)}
    >
      <ZoneAuditHeader title={ZONE_AUDIT_TITLE} radiusMi={model.radiusMi} onRadius={onRadius} />
      <div className="fwm-zone-body">
        <HeatLayer
          cells={model.cells}
          tripOverlay={model.tripOverlay}
          unavailable={model.heatUnavailable}
          caption={model.heatCaption}
        />
        <HeatLegend tripOverlay={model.tripOverlay} onTripOverlay={onTripOverlay} />
        <div className="fwm-zone-section-label">{SHARE_CARD_EYEBROW}</div>
        <ShareCard
          stats={model.stats}
          radiusMi={model.radiusMi}
          place={model.place}
          atMs={model.atMs}
          origin={model.origin}
        />
        {/* ALWAYS RENDERED, EMPTY UNTIL THERE IS SOMETHING TO SAY. B6 draws no
            notice at all, so this element is an addition -- and an addition
            that appears on the first press would shove the two footer keys
            down the moment the driver touched one, which is a worse departure
            from the drawn panel than a reserved line is. It holds its line
            box, and it is a live region so the outcome is announced rather
            than only drawn. */}
        <p
          className="fwm-zone-notice"
          data-fwm-zone-notice={model.notice ?? 'none'}
          role="status"
          aria-live="polite"
        >
          {model.notice === null ? '' : ZONE_NOTICES[model.notice]}
        </p>
        <ZoneAuditActions
          onShare={onShare}
          onExportCsv={onExportCsv}
          canShare={model.stats !== null}
          canExport={model.exportableRows > 0}
        />
      </div>
    </section>
  );
}
