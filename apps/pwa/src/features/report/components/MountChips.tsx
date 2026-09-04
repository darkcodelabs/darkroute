/**
 * `POLE MOUNT` · `SOLAR` · `TRAILER` · `UNSURE`.
 *
 * SOURCE: v2 `06 · REPORT`. Four wrapping chips at 8px radius on
 * `--fwm-surface-control`, no edge; the pressed one gets the in-range tint as a
 * fill, a 1px tinted edge and `--fwm-alert-in-range-text` as its label. v1 drew
 * 999px outlined pills in UI type; v2 draws 8px filled chips in mono.
 *
 * ONE CHOICE, NOT FOUR SWITCHES. `UNSURE` and `POLE MOUNT` cannot both be true,
 * so the chips behave as a radio group that can also be empty - pressing the
 * pressed chip clears it, which is the only way back to "I have not said" once
 * a chip has been tapped by mistake. `aria-pressed` carries that third state
 * honestly; `role="radio"` could not express "none of them".
 */

import type { ReactElement } from 'react';

import { MOUNT_KINDS, MOUNT_LABEL } from '../reportDraft.ts';
import type { MountKind } from '../reportDraft.ts';

export interface MountChipsProps {
  readonly mount: MountKind | null;
  /** Absent renders the chips inert rather than pretending they select. */
  readonly onToggle?: ((mount: MountKind) => void) | undefined;
}

export function MountChips({ mount, onToggle }: MountChipsProps): ReactElement {
  return (
    <div className="fwm-report-chips" role="group" aria-label="mount">
      {MOUNT_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          className="fwm-report-chip"
          data-fwm-report-mount={kind}
          aria-pressed={mount === kind}
          disabled={onToggle === undefined}
          onClick={
            onToggle === undefined
              ? undefined
              : () => {
                  onToggle(kind);
                }
          }
        >
          {MOUNT_LABEL[kind]}
        </button>
      ))}
    </div>
  );
}
