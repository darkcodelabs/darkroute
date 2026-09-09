/**
 * `NEW CAMERA` / `CONFIRM EXISTING` - the toggle at the top of the sheet.
 *
 * SOURCE: v2 `06 · REPORT`. Two halves inside a `--fwm-surface-track` trough at
 * 8px radius with a 3px inset; the pressed half is filled with the in-range hue
 * at 6px radius and lettered in `--fwm-text-on-alert`, the other is muted text
 * on nothing. v1's 1px-edged, 2px-radius box is gone - v2 is "flat borderless
 * controls, fill-based depth" and the trough is what an edge used to be.
 *
 * Two buttons rather than a segmented `<div>` pair: this switches what the
 * report IS, and it has to be reachable and announceable. `aria-pressed` is
 * what says which half is live.
 */

import type { ReactElement } from 'react';

import { MODE_LABEL, REPORT_MODES } from '../reportDraft.ts';
import type { ReportMode } from '../reportDraft.ts';

export interface ModeToggleProps {
  readonly mode: ReportMode;
  /** Absent renders the toggle inert rather than pretending it switches. */
  readonly onSelect?: ((mode: ReportMode) => void) | undefined;
}

export function ModeToggle({ mode, onSelect }: ModeToggleProps): ReactElement {
  return (
    <div className="fwm-report-modes" role="group" aria-label="report kind">
      {REPORT_MODES.map((candidate) => (
        <button
          key={candidate}
          type="button"
          className="fwm-report-mode"
          data-fwm-report-mode-key={candidate}
          aria-pressed={candidate === mode}
          disabled={onSelect === undefined}
          onClick={
            onSelect === undefined
              ? undefined
              : () => {
                  onSelect(candidate);
                }
          }
        >
          {MODE_LABEL[candidate]}
        </button>
      ))}
    </div>
  );
}
