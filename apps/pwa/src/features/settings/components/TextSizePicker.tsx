/**
 * TEXT SIZE, as a radio group.
 *
 * NOT IN THE DESIGN FILE, and here anyway.
 *
 * The type ramp bottoms out at `--fwm-text-micro` (11px), and that is the size
 * of every label on the product - SPEED, HEADING, TODAY, REP, SET, VOL, the
 * dock keys. Three separate things mean a driver cannot do anything about it:
 * the ramp is fixed by the design; `index.html` sets `user-scalable=no`, which
 * section 06 requires verbatim, so pinch-zoom is gone; and a correct
 * `width=device-width` viewport opts the page out of Chrome's font boosting,
 * so Android's own text-scaling setting does not reach it either.
 *
 * So the control is the product's to provide. `app/textScale.ts` carries the
 * reasoning for the ramp and the 1.5 ceiling.
 * GAP: see docs/gaps-inbox/settings.md#text-size-is-not-in-the-design-file
 *
 * WHY THE SAMPLE ROW IS NOT A PREVIEW
 *   Picking a size applies it to the whole document immediately, so the preview
 *   is the screen the driver is already looking at - the same argument
 *   `ModePicker` makes for not drawing mode cards. The sample below the picker
 *   is one line at `--fwm-text-micro`, present so the smallest size on the
 *   product is visible while choosing, rather than only discoverable by going
 *   back to RADAR and squinting at a tile.
 */

import type { ReactElement } from 'react';

import { TEXT_SCALES, formatTextScale } from '../../../app/textScale.ts';
import type { TextScale } from '../../../app/textScale.ts';

export const TEXT_SIZE_SECTION = 'TEXT SIZE';
export const TEXT_SIZE_CAPTION =
  'scales the words. buttons and the dock stay where they are.';
/** Rendered at the smallest size the product uses, on purpose. */
export const TEXT_SIZE_SAMPLE = 'SPEED · HEADING · TODAY';

export interface TextSizePickerProps {
  readonly active: TextScale;
  /** Absent means "not wired in this build" - every step renders inert. */
  readonly onPick?: ((scale: TextScale) => void) | undefined;
}

export function TextSizePicker({ active, onPick }: TextSizePickerProps): ReactElement {
  return (
    <div className="fwm-settings-textsize">
      <div className="fwm-settings-textsize-list" role="radiogroup" aria-label="text size">
        {TEXT_SCALES.map((scale) => {
          const selected = scale === active;
          return (
            <button
              key={scale}
              type="button"
              role="radio"
              aria-checked={selected}
              className="fwm-settings-textsize-step"
              data-fwm-settings-textsize={String(scale)}
              data-fwm-selected={selected ? 'true' : 'false'}
              disabled={onPick === undefined}
              onClick={
                onPick === undefined
                  ? undefined
                  : () => {
                      onPick(scale);
                    }
              }
            >
              {formatTextScale(scale)}
            </button>
          );
        })}
      </div>

      <p className="fwm-settings-textsize-sample fwm-data">{TEXT_SIZE_SAMPLE}</p>
    </div>
  );
}
