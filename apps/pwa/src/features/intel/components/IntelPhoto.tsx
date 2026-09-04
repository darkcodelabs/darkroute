/**
 * `DROP PHOTO OF CAMERA` -- drawn, off, and it says so.
 *
 * SOURCE: `A4 · INTEL CARD`. A 120px hatched panel (115 deg stripes, 8px on
 * 8px, `--fwm-surface-1` on `--fwm-surface-2`) with one 10px/.18em mono label.
 *
 * =============================================================================
 * WHY IT IS OFF
 * =============================================================================
 * It used to be off because a phone photo carries the exact coordinates in its
 * EXIF and nothing in the app could strip them. That is no longer true:
 * `features/report/preparePhoto.ts` re-encodes through a canvas -- proven to
 * drop the metadata in a real browser by `e2e/preparePhoto.spec.ts` -- and the
 * report sheet attaches one photograph per report.
 *
 * It is off here for a different reason, and a weaker one: THE ATTACH PATH
 * LIVES ON THE REPORT SHEET, NOT ON THIS CARD. A photograph is stored under a
 * report id in `reportPhotos` and its digest is signed into that report's
 * payload; an intel card is a view of a camera record and has no report to hang
 * either half on. Wiring this key would mean inventing a second owner for a
 * photograph, which is a design decision nobody has made.
 *
 * The REPORT sheet's `PHOTO` tile is dark for its own reason and authored the
 * note; this imports that exact string rather than writing a second one. Two
 * screens explaining the same thing in two different sentences is how a product
 * starts sounding unsure of its own rules -- and the shared string is why
 * correcting it in `DetailTiles.tsx` corrected it here too.
 *
 * It comes through `features/report`'s barrel, which exports it, exactly as
 * this feature reaches RADAR and LOG. A deep path into another feature's
 * component file makes that file's internals this file's business.
 * GAP: docs/gaps-inbox/intel.md#photo-refusal-copy-reused-from-report
 */

import type { ReactElement } from 'react';

import { PHOTO_OFF_NOTE } from '../../report';

/** Exact copy from the panel. */
export const DROP_PHOTO_LABEL = 'DROP PHOTO OF CAMERA';

export { PHOTO_OFF_NOTE };

export interface IntelPhotoProps {
  /** False in this build - there is no report here to attach a photo to. See the header. */
  readonly available: boolean;
  /** Wired only if a photograph ever gets an owner that is not a report. Absent today. */
  readonly onDropPhoto?: (() => void) | undefined;
}

export function IntelPhoto({ available, onDropPhoto }: IntelPhotoProps): ReactElement {
  return (
    <div className="fwm-intel-photo-block">
      <button
        type="button"
        className="fwm-intel-photo"
        data-fwm-intel-photo={available ? 'ready' : 'unavailable'}
        disabled={!available || onDropPhoto === undefined}
        aria-label={available ? DROP_PHOTO_LABEL : `${DROP_PHOTO_LABEL} - ${PHOTO_OFF_NOTE}`}
        onClick={onDropPhoto}
      >
        <span className="fwm-intel-photo-label fwm-data">{DROP_PHOTO_LABEL}</span>
      </button>

      {available ? null : (
        <p className="fwm-intel-note fwm-data" data-fwm-intel-note="photo">
          {PHOTO_OFF_NOTE}
        </p>
      )}
    </div>
  );
}
