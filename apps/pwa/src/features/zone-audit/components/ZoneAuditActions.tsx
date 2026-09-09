/**
 * `SHARE CARD` and `EXPORT CSV` -- the two 48px keys pinned to the bottom.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `B6 · ZONE AUDIT` -- two equal 48px
 * keys, radius 2: the first filled in the in-range hue with the page ground as
 * its text, the second outlined in `--fwm-line-strong`.
 *
 * WHY EITHER CAN BE DISABLED
 *   Both are disabled when there is nothing to act on -- a zone that could not
 *   be located has no counts to share and no rows to export, and a key that
 *   would do neither teaches a driver the screen is broken.
 *
 *   `EXPORT CSV` is additionally disabled whenever no sink is wired. There is
 *   nowhere sanctioned on this device to put the bytes: the clipboard adapter's
 *   `ClipboardKind` union has no CSV member and the share adapter's payload
 *   kinds do not cover a data file. Same call `B2 · DEAD DROP` made for
 *   `EXPORT JSON`.
 *   GAP: see docs/gaps-inbox/zone-audit.md#export-csv-has-no-sink-on-this-device
 */

import type { ReactElement } from 'react';

export const SHARE_LABEL = 'SHARE CARD';
export const EXPORT_LABEL = 'EXPORT CSV';

export interface ZoneAuditActionsProps {
  /** Absent means "not wired in this build" -- the key renders disabled. */
  readonly onShare?: (() => void) | undefined;
  readonly onExportCsv?: (() => void) | undefined;
  /** The zone resolved, so there is something to share. */
  readonly canShare: boolean;
  /** The zone has rows, so an export would have bytes. */
  readonly canExport: boolean;
}

export function ZoneAuditActions({
  onShare,
  onExportCsv,
  canShare,
  canExport,
}: ZoneAuditActionsProps): ReactElement {
  return (
    <div className="fwm-zone-actions">
      <button
        type="button"
        className="fwm-zone-action"
        data-fwm-zone-action={SHARE_LABEL}
        data-fwm-zone-action-tone="primary"
        disabled={onShare === undefined || !canShare}
        onClick={onShare}
      >
        {SHARE_LABEL}
      </button>
      <button
        type="button"
        className="fwm-zone-action"
        data-fwm-zone-action={EXPORT_LABEL}
        data-fwm-zone-action-tone="secondary"
        disabled={onExportCsv === undefined || !canExport}
        onClick={onExportCsv}
      >
        {EXPORT_LABEL}
      </button>
    </div>
  );
}
