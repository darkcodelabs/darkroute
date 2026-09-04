/**
 * THE TYPEFACE PICKER - two faces, and a sample set in each.
 *
 * Two, deliberately, and not a list of every font on the device. A font menu is
 * a thing to browse; this is a thing to answer once, and the answer is "the new
 * one" or "the one it used to be".
 *
 * The sample is set in the face it names, so the choice is made by LOOKING
 * rather than by reading a font's name and imagining it. It uses the words the
 * scope actually shows, at the size it shows them.
 */

import type { ReactElement } from 'react';

import { TYPEFACES, TYPEFACE_LABELS } from '../../../app/typeface.ts';
import type { Typeface } from '../../../app/typeface.ts';

export const TYPEFACE_SECTION = 'TYPEFACE';
export const TYPEFACE_CAPTION =
  'everything, readouts included. digits stay tabular either way, so nothing jitters as it counts.';
export const TYPEFACE_SAMPLE = 'NEAREST AHEAD · OVERLAND PARK';

export interface TypefacePickerProps {
  readonly active: Typeface;
  /** Absent means "not wired in this build" -- every option renders inert. */
  readonly onPick?: ((face: Typeface) => void) | undefined;
}

export function TypefacePicker({ active, onPick }: TypefacePickerProps): ReactElement {
  return (
    <div className="fwm-settings-typeface">
      <div className="fwm-settings-typeface-list" role="radiogroup" aria-label="typeface">
        {TYPEFACES.map((face) => {
          const selected = face === active;
          return (
            <button
              key={face}
              type="button"
              role="radio"
              aria-checked={selected}
              className="fwm-settings-typeface-option"
              data-fwm-settings-typeface={face}
              data-fwm-selected={selected ? 'true' : 'false'}
              disabled={onPick === undefined}
              onClick={
                onPick === undefined
                  ? undefined
                  : () => {
                      onPick(face);
                    }
              }
            >
              <span className="fwm-settings-typeface-name fwm-data">{TYPEFACE_LABELS[face]}</span>
              <span className="fwm-settings-typeface-sample">{TYPEFACE_SAMPLE}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
