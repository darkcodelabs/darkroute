/**
 * `PHOTO` and `MAKE / MODEL` - the two 56px keys.
 *
 * SOURCE: v2 `06 · REPORT`. Two equal keys side by side on
 * `--fwm-surface-control` at 8px radius with no edge, 12px/500 MONO labels at
 * .1em; the left one carries a 16x12 outlined block for the camera glyph, at
 * the one 3px corner in the whole of v2. v1 drew a 1px `line-strong` edge and
 * 13px/600 UI labels.
 *
 * =============================================================================
 * PHOTO IS DRAWN, AND IT IS OFF, AND THE REASON HAS CHANGED
 * =============================================================================
 * It used to be off because nothing in the app could strip a photo's EXIF, and
 * both this header and `PHOTO_OFF_NOTE` said so. That reason is dead:
 * `features/report/preparePhoto.ts` re-encodes through a canvas, which is
 * proven to drop the metadata in a real browser by `e2e/preparePhoto.spec.ts`,
 * and the sheet a driver actually files from attaches one photograph.
 *
 * This tile is still off for a smaller and more boring reason: THIS IS v0'S
 * LAYOUT AND THE BUILD DOES NOT ROUTE TO IT. `app/registry.v1.tsx` maps the
 * report screen to `ReportV1Screen` -> `ReportViewV1`, which draws its own
 * photo tile and is wired to `onAttachPhoto`. Nothing is wired behind this one,
 * so pressing it would do nothing at all. It stays dark until somebody wires
 * v0, which is a fact about v0's plumbing and not about photo metadata.
 *
 * The note under the row is what a driver reads, so it says where the control
 * they want actually is rather than restating a refusal that no longer exists.
 * GAP: see docs/gaps-inbox/report.md#photo-refusal-copy-is-authored
 *
 * =============================================================================
 * MAKE / MODEL OPENS A FIELD THE DESIGN DOES NOT DRAW
 * =============================================================================
 * The panel draws the tile and never the thing it opens. A tile that opens
 * nothing is not a control, so it discloses one text field, and the field is
 * plate-guarded upstream in `reportDraft.ts`.
 * GAP: see docs/gaps-inbox/report.md#make-model-opens-an-undrawn-field
 */

import { useState } from 'react';
import type { ReactElement } from 'react';

import type { MakeModelIssue } from '../reportDraft.ts';

/** Exact copy from the panel. */
export const PHOTO_LABEL = 'PHOTO';
export const MAKE_MODEL_LABEL = 'MAKE / MODEL';

/**
 * Authored. See the header.
 *
 * WAS: `PHOTO OFF · A PHOTO'S LOCATION TAG CANNOT BE STRIPPED YET`. That became
 * false the moment `preparePhoto()` was wired into the report sheet, and it is
 * imported verbatim by `features/intel`'s `IntelPhoto`, so one stale sentence
 * was printed on two screens. It now points at the place the photograph is
 * actually attached instead of denying that it can be.
 */
export const PHOTO_OFF_NOTE = 'PHOTO OFF · A PHOTO IS ADDED WHILE YOU FILE A REPORT';

export interface DetailTilesProps {
  /** False in this build - v0 has no attach wiring behind the tile. See the header. */
  readonly photoAvailable: boolean;
  readonly makeModel: string;
  readonly issue: MakeModelIssue | null;
  /** Absent renders the field read-only rather than pretending it takes text. */
  readonly onMakeModelChange?: ((value: string) => void) | undefined;
  /** Wired only when somebody gives v0 an attach path. Absent today. */
  readonly onPhoto?: (() => void) | undefined;
}

export function DetailTiles({
  photoAvailable,
  makeModel,
  issue,
  onMakeModelChange,
  onPhoto,
}: DetailTilesProps): ReactElement {
  // Open when there is already something in it: a value the driver typed must
  // never be hidden behind a closed disclosure.
  const [open, setOpen] = useState<boolean>(() => makeModel.trim() !== '');

  return (
    <section className="fwm-report-tiles-block" aria-label="camera detail">
      <div className="fwm-report-tiles">
        <button
          type="button"
          className="fwm-report-tile"
          data-fwm-report-capture={photoAvailable ? 'ready' : 'unavailable'}
          disabled={!photoAvailable || onPhoto === undefined}
          aria-label={photoAvailable ? PHOTO_LABEL : `${PHOTO_LABEL} - ${PHOTO_OFF_NOTE}`}
          onClick={onPhoto}
        >
          <span className="fwm-report-tile-glyph" aria-hidden="true" />
          <span className="fwm-report-tile-label">{PHOTO_LABEL}</span>
        </button>

        <button
          type="button"
          className="fwm-report-tile"
          data-fwm-report-tile="make-model"
          aria-expanded={open}
          onClick={() => {
            setOpen((was) => !was);
          }}
        >
          <span className="fwm-report-tile-label">{MAKE_MODEL_LABEL}</span>
        </button>
      </div>

      {photoAvailable ? null : (
        <p className="fwm-report-note" data-fwm-report-note="photo">
          {PHOTO_OFF_NOTE}
        </p>
      )}

      {open ? (
        <input
          className="fwm-report-field"
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          aria-label={MAKE_MODEL_LABEL}
          aria-invalid={issue !== null}
          data-fwm-report-make-model={issue ?? 'ok'}
          value={makeModel}
          readOnly={onMakeModelChange === undefined}
          onChange={
            onMakeModelChange === undefined
              ? undefined
              : (event) => {
                  onMakeModelChange(event.target.value);
                }
          }
        />
      ) : null}
    </section>
  );
}
