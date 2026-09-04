/**
 * INTEL - v1. The camera detail.
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isIntel` block.
 *
 * A VIEW, NOT A SCREEN. `IntelScreen` still resolves the record, reads the
 * street off the live basemap when the archive has none, counts this device's
 * own passes, writes CONFIRM and DISPUTE through the queue and owns the mute
 * countdown. This draws that model.
 *
 * =============================================================================
 * THE DESIGN'S NUMBERS ARE PLACEHOLDERS AND THE MODEL'S ARE NOT
 * =============================================================================
 * v1 draws "CONFIRMED x3", "14 YOUR PASSES", "42 DAYS KNOWN" and a five-row
 * table ending in "Yesterday, 19:04". Every one of those is a design file's
 * invention. The model has real values for some of them and `known: false` for
 * the rest, and this renders exactly that: a tile whose value is unknown says
 * so with an em dash and does not borrow the design's figure.
 *
 * That is not caution for its own sake. This screen is the one place a driver
 * decides whether a surveillance record is true - they press STILL THERE or
 * IT'S GONE on the strength of what it says - and a fabricated confirmation
 * count is a fabricated reason to trust it.
 */

import type { ReactElement } from 'react';

import { BackKey, ReloadTitle } from '../../../components/nav';
import { actionMessage, isActionFailure } from '../intelState.ts';
import { OverlayClose } from '../../../components/overlay/OverlayClose.tsx';
import type { IntelViewProps } from './IntelView.tsx';
import { MiniMap } from '../../map/MiniMap.tsx';

import '../intelV1.css';

export const INTEL_V1_TITLE = 'Camera';

/**
 * What the `‹` says out loud here.
 *
 * "close the camera card", not "back to everything else": this control ends a
 * card raised over the map as often as it leaves a screen, and "back" would
 * name a destination that depends on how the card was opened.
 */
export const INTEL_V1_DISMISS = 'close the camera card';

/**
 * What the `‹` says when there is no card to close.
 *
 * A different name because it is a different promise: this one navigates to
 * DRIVE and always works, where the dismiss above depends on what raised the
 * card. Naming both "close" would make one of them a lie.
 */
export const INTEL_V1_TO_DRIVE = 'back to drive';

/** Said when nothing is selected. The card is reachable with no camera. */
export const NO_CAMERA = 'no camera selected.';

export const CONFIRM_LABEL = 'Still there';
export const DISPUTE_LABEL = "It's gone";

/** The words on the mute key, both ways round. */
export const MUTE_LABEL = 'Mute this one';
export const UNMUTE_LABEL = 'Unmute';

export function IntelViewV1({
  model,
  busy = false,
  outcome = null,
  onDismiss,
  onConfirm,
  onDispute,
  onToggleMute,
  onNavigate,
  onShare,
}: IntelViewProps): ReactElement {
  if (model === null) {
    /*
     * =========================================================================
     * THE EMPTY CARD WAS THE WORST TRAP OF THE LOT, and it took a headless
     * pass to find because every existing test renders this branch and asserts
     * the sentence, which is correct and is not the problem.
     * =========================================================================
     * `?screen=intel` with nothing selected - an old bookmark, a shared link, a
     * notification whose camera has since been dropped from the archive -
     * returned early, ABOVE the header, so the `‹` the loaded card draws was
     * not here. The dock is still on screen, but no key is lit, because INTEL
     * is behind no hub: the driver is on a screen that says "no camera
     * selected" and nothing on it acknowledges that they might want to leave.
     *
     * DRIVE, not `onDismiss`. There is no card to close, and `closeIntelCard`
     * falls through to `navigationActions.back()`, which returns false and does
     * NOTHING on a cold deep link - a control that looks like an exit and is
     * not one is worse than no control. DRIVE is where the map with the
     * cameras on it is, which is the only useful answer to "no camera
     * selected".
     */
    return (
      <section className="fwm-intelv1" aria-label="camera">
        {/* THE WAY OUT IS DRAWN HERE TOO, and it is a BackKey rather than the
            close key the loaded card draws. `OverlayClose` renders DISABLED
            when it has no handler, which is precisely this branch on a cold
            deep link: `onDismiss` is undefined, so the driver would get a
            greyed-out X on the one screen with nothing else to touch. There is
            no card to close here anyway. DRIVE is where the map with the
            cameras on it is, which is the only useful answer to "no camera
            selected", so this navigates unconditionally. */}
        {/* THE TITLE RELOADS IN THIS BRANCH AND NOT IN THE OTHER, which is the
            same distinction the two exit controls above are drawn from. There
            is nothing here to throw away: no record, no queued action, no
            countdown - the branch exists precisely because the card is EMPTY -
            and a reload lands back on this screen with a fresh archive read,
            which is the one thing that could turn "no camera selected" into a
            camera. In the loaded branch it would discard the card. */}
        <header className="fwm-intelv1-header">
          <BackKey to="radar" label={INTEL_V1_TO_DRIVE} />
          <ReloadTitle title={INTEL_V1_TITLE} className="fwm-intelv1-screen-title" />
        </header>
        <p className="fwm-intelv1-empty fwm-data">{NO_CAMERA}</p>
      </section>
    );
  }

  return (
    // THE OWNER CLASS, ON THE ROOT, so the whole card can be drawn in the hue
    // the map drew this camera's dot in. `unknown` rather than an omitted
    // attribute: a record with no owner is a real, common state that needs its
    // own neutral treatment, and a selector for it is easier to read than the
    // absence of one. See `intelV1.css`.
    <section
      className="fwm-intelv1"
      aria-label="camera"
      data-fwm-state={model.state}
      data-fwm-owner={model.ownerType ?? 'unknown'}
    >
      {/* A PLAIN `<h1>`, AND IT IS THE ONLY PAGE TITLE IN v1 THAT IS NOT A
          RELOAD KEY. Every other title is `ReloadTitle` - see
          `components/nav/ReloadTitle.tsx` - and this one is carved out for the
          same reason the close key below is an `OverlayClose` rather than a
          chevron: the loaded card is raised OVER the map far more often than it
          is a screen, and this component cannot tell which it is.

          Reloading from inside the overlay does not refresh the card, it
          destroys it - `openIntelCard` is in-memory selection, so the page
          comes back on DRIVE with nothing selected. A driver who has just
          pressed STILL THERE, or is watching the mute countdown, would lose it
          by tapping the word above what they were reading. The empty branch has
          nothing to lose and does reload; this one keeps the word inert, which
          is the honest thing for a word that cannot keep the promise. */}
      <header className="fwm-intelv1-header">
        <h1 className="fwm-intelv1-screen-title">{INTEL_V1_TITLE}</h1>
        <span className="fwm-intelv1-id fwm-data">{model.cameraId}</span>
        {/* THE SAME CLOSE KEY THE REPORT SHEET DRAWS, at the same corner.
            This was a back chevron, and a chevron is a promise about where you
            came from that a modal raised over the map cannot keep. The card is
            an overlay far more often than it is a screen, so it now says the
            true thing -- close -- with the sheet's own round 44px target. */}
        <OverlayClose onClose={onDismiss} />
      </header>

      {/* THE HERO. Framed in the OWNER'S hue - see the block on
          `data-fwm-owner` in `intelV1.css` for why that beat the alert state,
          which this card still says in words and in `data-fwm-state`. */}
      <div className="fwm-intelv1-hero">
        {/* The panel's own line under the title - a street and a town when the
            record has them, and the container's NOTE when it does not.
            `sublineIsNote` is why the two are distinguishable: a note is the
            product explaining an absence, not a fact about this camera. */}
        <span
          className="fwm-intelv1-kicker fwm-data"
          data-fwm-note={String(model.identity.sublineIsNote)}
        >
          {model.identity.subline}
        </span>
        <h2 className="fwm-intelv1-place">{model.identity.title}</h2>

        {/* HOW FAR, AND WHERE.
            The readout answers "3.7 MI NE" and leaves the reader to imagine the
            rest, which is a lot to ask of somebody deciding whether this is the
            camera they just drove past. The picture beside it is the same fact
            in the form the eye reads fastest: this junction, that corner, lens
            pointing that way.
            It costs nothing anybody can be tracked by. MapLibre is already in
            the bundle, the archive is already on the phone, and the camera's
            coordinates are already in the record - so the only new thing on
            screen is a read of data this device already holds.
            The panel draws no map here, or anywhere on this card.
            GAP: docs/gaps-inbox/intel.md#hero-carries-a-map-the-panel-never-drew */}
        <div className="fwm-intelv1-locate">
          <p className="fwm-intelv1-readout">
            <span className="fwm-intelv1-distance">{model.readout.value}</span>
            <span className="fwm-intelv1-unit fwm-data">{model.readout.unit}</span>
            {model.readout.cardinal === null ? null : (
              <span className="fwm-intelv1-cardinal fwm-data">{model.readout.cardinal}</span>
            )}
          </p>
          {/* No record, no coordinate, no map. The card keeps its shape and
              simply does not draw a picture it would have to invent. */}
          {model.site === null ? null : (
            <MiniMap
              lat={model.site.lat}
              lon={model.site.lon}
              facings={model.site.facings}
            />
          )}
        </div>

        <div className="fwm-intelv1-tiles">
          {model.tiles.map((tile) => (
            <div
              className="fwm-intelv1-tile"
              key={tile.label}
              data-fwm-known={String(tile.known)}
            >
              <span className="fwm-intelv1-tile-value">{tile.value}</span>
              <span className="fwm-intelv1-tile-label fwm-data">{tile.label}</span>
            </div>
          ))}
        </div>
      </div>

      <ul className="fwm-intelv1-facts" aria-label="what is known">
        {model.facts.map((fact) => (
          <li
            className="fwm-intelv1-fact"
            key={fact.label}
            data-fwm-tone={fact.tone}
            data-fwm-known={String(fact.known)}
          >
            {/* VALUE FIRST, LABEL UNDER IT - the order the tiles above use.
                These read as one block with those now, so the two must agree;
                a grid where half the cells are label-first and half are not is
                two designs in one card. */}
            <span className="fwm-intelv1-fact-value">{fact.value}</span>
            <span className="fwm-intelv1-fact-label fwm-data">{fact.label}</span>
          </li>
        ))}
      </ul>

      {model.muteCountdown === null ? null : (
        <p className="fwm-intelv1-mute-note fwm-data">muted · {model.muteCountdown}</p>
      )}

      {/* THE PRIMARY, full width and first. It is the only action here that is
          about the drive rather than about the record, and the design gives it
          the whole row and a pin. */}
      {onNavigate === undefined ? null : (
        <button
          type="button"
          className="fwm-intelv1-primary"
          onClick={onNavigate}
        >
          <svg
            className="fwm-intelv1-primary-glyph"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 21s6.5-6.1 6.5-10.4A6.5 6.5 0 0 0 5.5 10.6C5.5 14.9 12 21 12 21Z" />
            <circle cx="12" cy="10.4" r="2.3" />
          </svg>
          <span>Show it in maps</span>
        </button>
      )}

      {/* THE TWO VERDICTS. Both are absent rather than disabled-looking when
          there is no queue to write to: a build with no local storage cannot
          record either answer, and a key that swallows the press is worse than
          one that is visibly not offered. */}
      <div className="fwm-intelv1-actions">
        {onConfirm === undefined ? null : (
          <button
            type="button"
            className="fwm-intelv1-key"
            data-fwm-key="confirm"
            disabled={busy}
            onClick={onConfirm}
          >
            {CONFIRM_LABEL}
          </button>
        )}
        {onDispute === undefined ? null : (
          <button
            type="button"
            className="fwm-intelv1-key"
            data-fwm-key="dispute"
            disabled={busy}
            onClick={onDispute}
          >
            {DISPUTE_LABEL}
          </button>
        )}
      </div>

      <div className="fwm-intelv1-actions">
        {onToggleMute === undefined ? null : (
          <button type="button" className="fwm-intelv1-key" onClick={onToggleMute}>
            {model.mutedCamera ? UNMUTE_LABEL : MUTE_LABEL}
          </button>
        )}
        {onShare === undefined ? null : (
          <button type="button" className="fwm-intelv1-key" onClick={onShare}>
            Share
          </button>
        )}
      </div>

      {/* The container's own word for what just happened. Never invented here. */}
      {outcome === null ? null : (
        <p
          className="fwm-intelv1-outcome fwm-data"
          role="status"
          data-fwm-failed={String(isActionFailure(outcome))}
        >
          {actionMessage(outcome)}
        </p>
      )}
    </section>
  );
}
