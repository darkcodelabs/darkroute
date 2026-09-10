/**
 * INTEL - v1. `Details`, the sheet one level under the camera modal.
 *
 * SOURCE: brief 4, section B. The camera modal keeps three facts and two
 * verdicts; this is where the rest of the card went - "EFF Atlas, inter-agency
 * sharing, first reported, confirmed by, your reads, in this county, covers,
 * data as of ... Eight em-dash fields, most of them empty - a full sheet is the
 * right shape for that, one level deeper."
 *
 * =============================================================================
 * NOTHING WAS DELETED, AND THAT IS THE WHOLE POINT OF THIS FILE
 * =============================================================================
 * The brief moves eight fields. It does not say what becomes of the three tiles
 * (OWNER / MOUNT / FACING), the mute countdown, MUTE THIS ONE, SHARE or the
 * correction key, all of which the full sheet drew and none of which the modal
 * has room for. They are here, because the alternative is deleting a control
 * the brief never asked anybody to delete.
 *
 * The tiles in particular have to be here. The modal's one summary line drops a
 * MOUNT or a FACING nobody wrote down - see `intelSummary` - and this card's
 * standing rule is that an unknown is STATED rather than omitted, because a
 * missing row reads as "this camera does not do that". The tiles are where it
 * is stated: an em dash, in the dim tone, exactly as before.
 *
 * =============================================================================
 * A SCREEN, NOT A MODAL, SO IT IS OPAQUE
 * =============================================================================
 * Brief 4: "Glass is for chrome floating over the map. A full screen has
 * nothing behind it, so blurring it costs a compositor pass and buys nothing."
 * This covers the modal AND the map, so there is nothing to see through it and
 * it takes `--dr-screen`. The two things above it in the layer - the exit at
 * the head of the title row, and the 150px the dock stands in - are the screen
 * geometry every other brief-4 surface uses.
 */

import { useState } from 'react';
import type { ReactElement } from 'react';

import { OverlayClose } from '../../../components/overlay/OverlayClose.tsx';
import { GROUND_NOTE } from '../../map/miniMap.ts';
import { CorrectionSheet } from '../CorrectionSheet.tsx';
import type { IntelViewModel } from '../intelState.ts';
import { IntelAtlasDetails } from './IntelAtlasDetails.tsx';

import '../intelDetailsV1.css';

/** The sheet's own name, and the word on the row that opens it. */
export const INTEL_DETAILS_TITLE = 'Details';

/** The words on the mute key, both ways round. */
export const MUTE_LABEL = 'Mute this one';
export const UNMUTE_LABEL = 'Unmute';

export const SHARE_LABEL = 'Share';

/**
 * THE WORDS ON THE CORRECTION KEY.
 *
 * Not "Report" - the app already has a REPORT flow for a camera that is not on
 * the map, and two keys called the same thing doing different things is how a
 * driver files the wrong one. This is for a camera the archive HAS and has
 * described wrongly, which is the complaint that prompted it: the brand.
 */
export const CORRECT_LABEL = 'Wrong details?';

export interface IntelDetailsV1Props {
  readonly model: IntelViewModel;
  /**
   * Back to the modal. REQUIRED, unlike every other handler on this card: the
   * sheet covers the map, the modal and the dock, and a surface with no exit is
   * the trap `OverlayClose` was extracted to end.
   */
  readonly onClose: () => void;
  readonly onToggleMute?: (() => void) | undefined;
  readonly onShare?: (() => void) | undefined;
}

export function IntelDetailsV1({
  model,
  onClose,
  onToggleMute,
  onShare,
}: IntelDetailsV1Props): ReactElement {
  /* Open only while somebody is filling it in. Nothing about a correction
     outlives the sheet it was started from. */
  const [correcting, setCorrecting] = useState(false);

  return (
    <section className="fwm-inteldetailv1" aria-label="camera details">
      {/* THE TITLE TRACK. 56px, fixed, and the exit is at its HEAD - the
          geometry brief 4 gives every screen, as against the modal underneath,
          whose sibling frame in the spec draws its close key at the tail. */}
      <header className="fwm-inteldetailv1-head">
        <OverlayClose onClose={onClose} />
        {/* A PLAIN `<h1>`, for the same reason the modal's is. This is drawn
            over an unsaved surface - a queued verdict, a running mute timer, a
            half-typed correction - and `ReloadTitle` would throw all of it away
            on a tap that looks inert. */}
        <h1 className="fwm-inteldetailv1-title">{INTEL_DETAILS_TITLE}</h1>
        <span className="fwm-inteldetailv1-id fwm-data">{model.cameraId}</span>
      </header>

      {/* THE BAND BETWEEN THE TRACK AND THE DOCK, and the only thing that
          scrolls. See `intelDetailsV1.css`. */}
      <div className="fwm-inteldetailv1-band">
        <ul className="fwm-inteldetailv1-tiles" aria-label="what it is">
          {model.tiles.map((tile) => (
            <li
              className="fwm-inteldetailv1-tile"
              key={tile.label}
              data-fwm-known={String(tile.known)}
            >
              <span className="fwm-inteldetailv1-tile-value">{tile.value}</span>
              <span className="fwm-inteldetailv1-tile-label fwm-data">{tile.label}</span>
            </li>
          ))}
        </ul>

        {/* THE EIGHT FIELDS, as brief 4's rows rather than as v1's grid of
            cells: 44px, radius 12, a hairline each, label left and value right.
            An unknown is drawn and dimmed, never dropped. */}
        <ul className="fwm-inteldetailv1-facts" aria-label="what is known">
          {model.facts.map((fact) => (
            <li
              className="fwm-inteldetailv1-fact"
              key={fact.label}
              data-fwm-tone={fact.tone}
              data-fwm-known={String(fact.known)}
              data-fwm-atlas={fact.label === 'EFF ATLAS' ? 'true' : undefined}
            >
              <span className="fwm-inteldetailv1-fact-label fwm-data">{fact.label}</span>
              <span className="fwm-inteldetailv1-fact-value">{fact.value}</span>
              {fact.label === 'EFF ATLAS' ? <IntelAtlasDetails atlas={model.atlas} /> : null}
            </li>
          ))}
        </ul>

        {model.muteCountdown === null ? null : (
          <p className="fwm-inteldetailv1-mute fwm-data">muted · {model.muteCountdown}</p>
        )}

        <div className="fwm-inteldetailv1-keys">
          {onToggleMute === undefined ? null : (
            <button type="button" className="fwm-inteldetailv1-key" onClick={onToggleMute}>
              {model.mutedCamera ? UNMUTE_LABEL : MUTE_LABEL}
            </button>
          )}
          {onShare === undefined ? null : (
            <button type="button" className="fwm-inteldetailv1-key" onClick={onShare}>
              {SHARE_LABEL}
            </button>
          )}

          {/* CORRECTING THE ARCHIVE, from the sheet where the error is visible.
              Self-contained rather than another handler threaded through both
              views: the sheet talks to the public submission API directly and
              needs nothing from the screen except which camera is on it. */}
          <button
            type="button"
            className="fwm-inteldetailv1-key"
            aria-expanded={correcting}
            onClick={() => {
              setCorrecting(!correcting);
            }}
          >
            {CORRECT_LABEL}
          </button>
        </div>

        {/* THE ODbL CREDIT FOR THE PICTURE ON THE MODAL, and it is here rather
            than under the picture for a measured reason: at 62px the caption
            wraps to three lines, breaks mid-word and costs 36px of a 262px
            card, which is a credit nobody can read. The modal therefore passes
            `credited` and this line carries it, one press away, on the surface
            with room for it. `GROUND_NOTE.ground` rather than a second copy of
            the string - the picture and the credit say the same thing because
            they are the same constant. */}
        <p className="fwm-inteldetailv1-credit fwm-data">{GROUND_NOTE.ground}</p>

        {correcting ? (
          <CorrectionSheet
            cameraId={model.cameraId}
            /* What the card is currently claiming, so the correction reads as a
               delta rather than an assertion floating free of anything. */
            current={{
              operator: model.identity.title,
              ownerType: model.ownerType ?? undefined,
            }}
            /* AND EVERYTHING ELSE THE CARD SHOWED. "Submit wrong details is
               missing a lot" -- owner, 2026-09-09, reading a review that said
               Archive says: --, Position: --. The camera's position and every
               known fact go with the claim; the driver's own fix does not. */
            lat={model.site?.lat}
            lon={model.site?.lon}
            archive={{
              ...(model.street === null ? {} : { street: model.street }),
              title: model.identity.title,
              ...(model.ownerType === undefined ? {} : { owner: model.ownerType }),
              ...Object.fromEntries(
                model.facts
                  .filter((fact) => fact.known)
                  .map((fact) => [String(fact.label).toLowerCase(), fact.value]),
              ),
            }}
            onClose={() => {
              setCorrecting(false);
            }}
          />
        ) : null}
      </div>
    </section>
  );
}
