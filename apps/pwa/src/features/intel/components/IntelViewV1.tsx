/**
 * INTEL - v1. The camera modal.
 *
 * SOURCE: `the_rest_of_the_app.dc.html`, section B, the left-hand frame
 * ("CAMERA · was a full sheet, now 318 px tall"). Every number and every
 * colour below is written there; see `intelV1.css`, which carries the spec's
 * own pixel beside each token.
 *
 * A VIEW, NOT A SCREEN. `IntelScreen` still resolves the record, reads the
 * street off the live basemap when the archive has none, counts this device's
 * own passes, writes CONFIRM and DISPUTE through the queue and owns the mute
 * countdown. This draws that model.
 *
 * =============================================================================
 * IT STOPPED BEING A SHEET, AND THE REASON IS THE MAP BEHIND IT
 * =============================================================================
 * This was a full-bleed opaque sheet: a driver tapped a dot to ask "what is
 * that camera, there" and the app answered by hiding the there. Brief 4:
 * "Tapping a camera on the map should not hide the map - you tapped it BECAUSE
 * of where it is."
 *
 * So it is 342px of glass anchored above the dock, and it holds three facts and
 * two verdicts. Everything else - the eight provenance rows, the three tiles,
 * the mute, the share, the correction - is one level deeper behind `Details`,
 * which is {@link IntelDetailsV1}. Nothing was deleted; a full sheet is simply
 * the right shape for eight fields, most of which are an em dash.
 *
 * =============================================================================
 * THE DESIGN'S NUMBERS ARE PLACEHOLDERS AND THE MODEL'S ARE NOT
 * =============================================================================
 * The spec draws `Metcalf @ W 111th`, `1.5 mi NE · faces 135° · signal mast`
 * and `UNVERIFIED REPORT` against a purple dot. Every one of those is a design
 * file's invention, and this renders the model instead: a value nobody wrote
 * down is an em dash or is absent, never the mock's figure.
 *
 * That is not caution for its own sake. This is the one place a driver decides
 * whether a surveillance record is true - they press STILL THERE or IT'S GONE
 * on the strength of what it says - and a fabricated fact is a fabricated
 * reason to trust it.
 */

import { useEffect, useRef, useState } from 'react';
import { projectPoint, subscribeScreenPoints } from '../../map/screenPoint.ts';
import type { CSSProperties, ReactElement } from 'react';

import { BackKey, ReloadTitle } from '../../../components/nav';
import { OverlayClose } from '../../../components/overlay/OverlayClose.tsx';
import { LazyMiniMap as MiniMap } from '../../map/LazyMiniMap.tsx';
import { actionMessage, isActionFailure } from '../intelState.ts';
import type { IntelViewProps } from './IntelView.tsx';
import { IntelDetailsV1 } from './IntelDetailsV1.tsx';

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

/**
 * THE PRIMARY KEY, and it names what it now does.
 *
 * It said "Show it in maps", because it handed the coordinates to whatever map
 * application the phone had registered - which meant the one screen in this
 * product about a surveillance camera ended by telling a maps company you were
 * interested in it. DarkRoute routes for itself now: this sets the camera as a
 * destination and returns to the app's own map.
 */
export const INTEL_V1_GO_TO = 'Go to this camera';

/** Said when nothing is selected. The card is reachable with no camera. */
export const NO_CAMERA = 'no camera selected.';

export const CONFIRM_LABEL = 'Still there';
export const DISPUTE_LABEL = "It's gone";

/** The row that opens the deep sheet, and the spec's own word for it. */
export const DETAILS_LABEL = 'Details';

/**
 * What the SCRIM is called, and why there is one at all.
 *
 * The modal is 318px tall and `.fwm-shell-layer` is `inset: 0` with no
 * `pointer-events` rule, so the map above the card is INSIDE the layer: it is
 * visible, and every touch on it lands on an element that does nothing. That is
 * worse than an opaque sheet, because it looks live.
 *
 * A dismiss is the honest thing for that area to do. It is what the driver
 * means by tapping the map - "not this camera, that place" - and it is what
 * v0's card already does (`IntelView.tsx` draws a scrim button for the same
 * reason, in the same words). It carries no wash: the whole point of the
 * redesign is that the map stays visible, so the scrim paints nothing.
 *
 * The REPORT modal deliberately has no equivalent. Its sheet holds an unsent
 * draft and a photograph, and a stray touch outside a 282px card is not a good
 * enough reason to destroy them.
 */
export const INTEL_V1_SCRIM = 'close the camera card and go back to the map';

/**
 * WHERE THE READER IS ON THE SCREEN, so the card can hang above it.
 *
 * DeFlock does this and it is the right instinct: a card that appears over the
 * dot a driver just tapped is a card about THAT dot, and a sheet that slides in
 * at the bottom is a card about something, somewhere. The owner asked for the
 * former in as many words.
 *
 * The position is in the LAYER's coordinates, because that is what the card is
 * absolutely positioned inside. `projectPoint` answers in viewport space (the
 * map and this layer are `inset: 0` of two different parents), so the layer's
 * own rect is subtracted here, once, on every change.
 *
 * NULL MEANS "DO NOT ANCHOR" -- no map, no site, or the reader has been panned
 * off the screen -- and the card keeps its old place above the dock rather than
 * pointing at nothing. A rotation, a pan or a pinch re-runs this through the
 * subscription; nothing polls.
 */
function useReaderAnchor(
  site: { readonly lat: number; readonly lon: number } | null,
  layer: { readonly current: HTMLElement | null },
): { readonly x: number; readonly y: number } | null {
  const [anchor, setAnchor] = useState<{ readonly x: number; readonly y: number } | null>(null);
  useEffect(() => {
    if (site === null) {
      setAnchor(null);
      return undefined;
    }
    const place = (): void => {
      const point = projectPoint(site);
      const box = layer.current?.getBoundingClientRect();
      if (point === null || box === undefined) {
        setAnchor(null);
        return;
      }
      setAnchor({ x: point.x - box.left, y: point.y - box.top });
    };
    place();
    return subscribeScreenPoints(place);
  }, [site, layer]);
  return anchor;
}

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
  const layerRef = useRef<HTMLElement | null>(null);
  const anchor = useReaderAnchor(model?.site ?? null, layerRef);
  /*
   * THE DEEP SHEET IS THIS COMPONENT'S OWN STATE, not a second overlay id.
   *
   * Two other shapes were available and both are worse. A new entry in
   * `V1_OVERLAYS` would render the sheet INSTEAD of this modal - `App.tsx`
   * draws only the top overlay - which unmounts the container underneath and
   * throws away `outcome`, the one line saying whether the verdict the driver
   * just pressed was actually queued. A new `SECONDARY_SCREENS` id would put a
   * provenance list in the URL, which is the one thing this product refuses to
   * write there (see `IntelScreen`'s privacy note).
   *
   * So it is local, exactly as `correcting` was before it. The cost is that
   * Escape and the back gesture close the WHOLE card rather than stepping back
   * one level: `useOverlayDismiss` binds the document in the capture phase from
   * the container, which mounts first, so nothing rendered in here can answer
   * an Escape before it does. That is stated rather than worked around, because
   * the alternative shapes each lose something a driver can see.
   */
  const [detail, setDetail] = useState(false);

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
     *
     * IT IS NOT A MODAL. There is no camera for a card to sit beside, so there
     * is nothing for a 342px pane over a live map to be about: this branch
     * keeps the screen it always was.
     */
    return (
      <section className="fwm-intelv1-blank" aria-label="camera">
        {/* THE TITLE RELOADS IN THIS BRANCH AND NOT IN THE OTHER, which is the
            same distinction the two exit controls are drawn from. There is
            nothing here to throw away: no record, no queued action, no
            countdown - the branch exists precisely because the card is EMPTY -
            and a reload lands back on this screen with a fresh archive read,
            which is the one thing that could turn "no camera selected" into a
            camera. In the loaded branch it would discard the card. */}
        <header className="fwm-intelv1-blank-header">
          <BackKey to="radar" label={INTEL_V1_TO_DRIVE} />
          <ReloadTitle title={INTEL_V1_TITLE} className="fwm-intelv1-blank-title" />
        </header>
        <p className="fwm-intelv1-empty fwm-data">{NO_CAMERA}</p>
      </section>
    );
  }

  /*
   * THE OPERATOR TAG IS THE OWNER TILE, VERBATIM.
   *
   * Brief 4 asks for an "operator tag + hue dot", and `intelTiles` already
   * builds exactly that string: the mapper's own `operator` where there is one
   * ("OVERLAND PARK PD"), the four-way class where there is not ("POLICE"), and
   * an em dash where the record asserts neither. The spec draws
   * `UNVERIFIED REPORT`, which is the mock's own camera - `OWNER_LABEL` reads
   * `UNVERIFIED`, and the word REPORT is not a value this archive holds.
   *
   * Reading the tile rather than `ownerType` is what keeps absence honest. Most
   * OSM ALPR nodes carry no owner at all, and `unverified` is a class somebody
   * ASSERTED; a tag that fell through to it would tell a driver a stranger had
   * checked this camera when nobody has.
   */
  const owner = model.tiles.find((tile) => tile.label === 'OWNER');

  return (
    // THE OWNER CLASS, ON THE ROOT, so the card can be drawn in the hue the map
    // drew this camera's dot in. `unknown` rather than an omitted attribute: a
    // record with no owner is a real, common state that needs its own neutral
    // treatment, and a selector for it is easier to read than the absence of
    // one. See `intelV1.css`.
    <section
      ref={layerRef}
      className="fwm-intelv1"
      aria-label="camera"
      data-fwm-state={model.state}
      data-fwm-owner={model.ownerType ?? 'unknown'}
      data-fwm-anchored={anchor === null ? 'false' : 'true'}
      /* The two lengths the stylesheet positions the anchored card from. Written
         as custom properties rather than as `left`/`bottom` so the clamping and
         the gap above the dot stay in CSS, beside the rest of the geometry. */
      style={
        anchor === null
          ? undefined
          : ({ '--fwm-intelv1-x': `${String(anchor.x)}px`, '--fwm-intelv1-y': `${String(anchor.y)}px` } as CSSProperties)
      }
    >
      {/* THE MAP IS STILL THERE, SO TAPPING IT MEANS SOMETHING.
          See INTEL_V1_SCRIM. */}
      <button
        type="button"
        className="fwm-intelv1-scrim"
        aria-label={INTEL_V1_SCRIM}
        disabled={onDismiss === undefined}
        onClick={onDismiss}
      />

      <div className="fwm-intelv1-card">
        <div className="fwm-intelv1-head">
          <div className="fwm-intelv1-ident">
            {/* THE OPERATOR TAG AND ITS DOT. The dot takes the hue the map
                painted this camera's dot in - purple for unverified, since the
                owner's 2026-09-08 decision, and a neutral line for a record
                that asserts no owner at all. */}
            <p className="fwm-intelv1-owner">
              <span className="fwm-intelv1-owner-dot" aria-hidden="true" />
              <span className="fwm-intelv1-owner-tag fwm-data">{owner?.value ?? ''}</span>
            </p>

            {/* WHERE IT IS, WHICH IS WHY THE MODAL EXISTS. `model.street` is
                the cross street with the basemap fallback already applied; the
                identity title - a manufacturer, an operator or the id - is what
                a record with no street anywhere falls back to. */}
            <h1 className="fwm-intelv1-place">{model.street ?? model.identity.title}</h1>

            {/* HOW FAR, WHICH WAY IT LOOKS, AND WHAT IT IS BOLTED TO, on one
                line. Composed in `intelSummary` so the tags are read once. */}
            <p className="fwm-intelv1-readout">
              <span className="fwm-intelv1-distance">{model.readout.value}</span>
              <span className="fwm-intelv1-summary fwm-data">{model.summary}</span>
            </p>
          </div>

          {/* THE 62px INSET. The same picture the deep sheet's numbers describe,
              at the size the spec gives it here.
              NOT a second, static drawing of the same thing: `MiniMap` already
              owns the cone geometry, the dead-zone caption and the attribution,
              and a hand-cut SVG beside it would be a second renderer with its
              own idea of where the lens points.

              `credited`, AND THE CREDIT IS NOT LOST. ODbL wants the credit on
              the surface the tiles are drawn on, and this card carries it - on
              its `Details` sheet, which is one press away and has a line's worth
              of room for it. Measured before deciding: printed inside a 62px
              column, "© OpenStreetMap" wraps to three lines, breaks mid-word
              (the note is `overflow-wrap: anywhere`) and costs 36px of a 262px
              card. A credit nobody can read is not attribution.
              Only the ATTRIBUTION drops. `bare` still speaks - "no map cached
              here" is the picture admitting the ground is missing, which is the
              one thing a driver in a dead zone needs it to say, and it is worth
              the space on the rare card that shows it.

              No record, no coordinate, no map. The card keeps its shape and
              simply does not draw a picture it would have to invent. */}
          {model.site === null ? null : (
            <div className="fwm-intelv1-inset">
              <MiniMap
                lat={model.site.lat}
                lon={model.site.lon}
                facings={model.site.facings}
                credited
              />
            </div>
          )}

          {/* THE WAY OUT. The spec draws no close key on THIS frame and a 40px
              circle on its sibling, the drop-a-camera modal; the geometry table
              asks for one on every title row. Two of those three say draw it,
              and the third is the absence of a control on a surface that -
              opened from LOOK UP or from EXPOSURE - has no map behind it to tap
              away onto. It is the product's one close key, unchanged. */}
          <OverlayClose onClose={onDismiss} />
        </div>

        {/* THE PRIMARY. The only action here that is about the drive rather
            than about the record, so it gets the whole row and the arrow. */}
        {onNavigate === undefined ? null : (
          <button type="button" className="fwm-intelv1-primary" onClick={onNavigate}>
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
              <path d="M3.6 11.2 20.4 4.4 13.6 21.2l-2.2-7.8z" />
            </svg>
            <span>{INTEL_V1_GO_TO}</span>
          </button>
        )}

        {/* THE TWO VERDICTS. Both are absent rather than disabled-looking when
            there is no queue to write to: a build with no local storage cannot
            record either answer, and a key that swallows the press is worse
            than one that is visibly not offered. */}
        <div className="fwm-intelv1-verdicts">
          {onConfirm === undefined ? null : (
            <button
              type="button"
              className="fwm-intelv1-verdict"
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
              className="fwm-intelv1-verdict"
              data-fwm-key="dispute"
              disabled={busy}
              onClick={onDispute}
            >
              {DISPUTE_LABEL}
            </button>
          )}
        </div>

        {/* THE ROW INTO THE RECORD. The id is on it because it is what a driver
            quotes when they report a bad record, and because a row has to say
            what is behind it rather than just "more". */}
        <button
          type="button"
          className="fwm-intelv1-row"
          aria-expanded={detail}
          onClick={() => {
            setDetail(true);
          }}
        >
          <span className="fwm-intelv1-row-label">{DETAILS_LABEL}</span>
          <span className="fwm-intelv1-row-value fwm-data">{model.cameraId}</span>
          <svg
            className="fwm-intelv1-row-glyph"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9.5 6.5 15 12l-5.5 5.5" />
          </svg>
        </button>

        {/* THE CONTAINER'S OWN WORD FOR WHAT JUST HAPPENED, never invented here.
            The spec does not draw it, and it stays: the two keys above write to
            a queue that can refuse, and a verdict that silently did nothing is
            the failure this line exists to make visible. */}
        {outcome === null ? null : (
          <p
            className="fwm-intelv1-outcome fwm-data"
            role="status"
            data-fwm-failed={String(isActionFailure(outcome))}
          >
            {actionMessage(outcome)}
          </p>
        )}
      </div>

      {detail ? (
        <IntelDetailsV1
          model={model}
          onClose={() => {
            setDetail(false);
          }}
          onToggleMute={onToggleMute}
          onShare={onShare}
        />
      ) : null}
    </section>
  );
}
