/**
 * The send state and `EXPORT JSON`, with the transport boundary made visible.
 *
 * WHY EITHER CAN BE DISABLED
 *   DEAD DROP owns neither. Draining the queue is a network path this screen
 *   may not open, and there is no sanctioned destination on this device for an
 *   export whose bytes contain the driver's coordinates. A build that has not
 *   wired one renders the key the design draws, disabled, rather than a
 *   live-looking control that silently does nothing -- the pattern
 *   `features/radar/components/RadarAction.tsx` set for `RETRY SYNC`.
 *   GAP: see docs/gaps-inbox/dead-drop.md#export-json-has-no-sink-on-this-device
 *
 *   They are also disabled when there is nothing to act on: an empty queue has
 *   nothing to sync and no bytes to export, and pressing a key that would do
 *   neither teaches a driver that the screen is broken.
 */

import type { ReactElement } from 'react';

import {
  EXPORT_LABEL,
  SYNC_LABEL,
  SYNC_UNAVAILABLE_LABEL,
  SYNC_UNAVAILABLE_REASON,
} from '../deadDropModel.ts';

export interface DeadDropActionsProps {
  /** Absent means "not wired in this build" -- the key renders disabled. */
  readonly onSyncNow?: (() => void) | undefined;
  readonly onExport?: (() => void) | undefined;
  /** Something is held, so a sync would have work to do. */
  readonly canSync: boolean;
  /** A signed body is on disk, so an export would have bytes. */
  readonly canExport: boolean;
}

export function DeadDropActions({
  onSyncNow,
  onExport,
  canSync,
  canExport,
}: DeadDropActionsProps): ReactElement {
  const syncLabel = onSyncNow === undefined ? SYNC_UNAVAILABLE_LABEL : SYNC_LABEL;

  return (
    <div className="fwm-dead-drop-actions">
      <button
        type="button"
        className="fwm-dead-drop-action"
        data-fwm-dead-drop-action={syncLabel}
        disabled={onSyncNow === undefined || !canSync}
        onClick={onSyncNow}
        title={onSyncNow === undefined ? SYNC_UNAVAILABLE_REASON : undefined}
      >
        {syncLabel}
      </button>
      <button
        type="button"
        className="fwm-dead-drop-action"
        data-fwm-dead-drop-action={EXPORT_LABEL}
        disabled={onExport === undefined || !canExport}
        onClick={onExport}
      >
        {EXPORT_LABEL}
      </button>
    </div>
  );
}
