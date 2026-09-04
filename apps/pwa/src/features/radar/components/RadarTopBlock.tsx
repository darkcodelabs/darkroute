/**
 * RADAR'S TOP BLOCK - v3. One row, four columns, and nothing else.
 *
 * =============================================================================
 * WHAT THIS REPLACES, AND WHY IT IS SMALLER
 * =============================================================================
 * It replaces the whole band between the header and the map: the corridor
 * strip, the CLEAR verdict, the REROUTE key, the GPS coordinate row, three stat
 * tiles, the hero distance readout and the state line. Seven stacked things,
 * each one line of text, together claiming about a third of a phone.
 *
 * They are one row now:
 *
 *   R2-1 PLATE   the posted limit, and your speed under it
 *   REROUTE      the key, over the corridor verdict, over the forecast
 *   LADDER       the road ahead, with its own caption and mile scale
 *   COMPASS      which way you point, and how good the fix is
 *
 * =============================================================================
 * WHAT WENT AWAY ON PURPOSE
 * =============================================================================
 * THE COORDINATES. `38.9183 N, 94.6920 W` is not a thing a driver acts on. It
 * was six digits of precision spending a full line to tell somebody something
 * the map already shows them by drawing them on it.
 *
 * THE HERO DISTANCE. `1.4 MI` in title type, directly above `CLEAR FOR 1.4 MI`
 * -- the same number, twice, in two sizes. The verdict keeps it, because the
 * verdict is the sentence a driver needs and the bare figure was not.
 *
 * THE SPEED AND HEADING TILES. Both are in the row now, as instruments rather
 * than as labelled numbers: the speed under the sign it should be read against,
 * the heading as a needle.
 *
 * THE TODAY TALLY moved up beside the database counts in the header, where it
 * is a tally and not a gauge -- "it never competes with the row".
 *
 * =============================================================================
 * THE 11px FLOOR
 * =============================================================================
 * "Every label stays at or above the 11px micro floor." Tightening a block is
 * easy if you are allowed to shrink type; this one is not. Everything that got
 * smaller got smaller by having less to say, not by being harder to read.
 */

import type { ReactElement } from 'react';

import {
  CORRIDOR_HEAT_STEPS,
  corridorClearLine,
  corridorClearSpan,
  corridorHotSpan,
  corridorMarks,
  corridorDistance,
  corridorPerMile,
  corridorThresholdSpan,
} from '../corridor.ts';
import type { Corridor } from '../corridor.ts';
import { canReroute } from '../reroute.ts';
import { NO_VALUE, formatCount } from '../format.ts';
import { speedPlateState } from '../speedLimit.ts';
import { Compass } from './Compass.tsx';

export const CORRIDOR_CAPTION = 'CORRIDOR AHEAD';
/**
 * What the ladder is showing when there is no direction of travel.
 *
 * The ladder is the same object either way -- same range, same scale, same
 * marks -- so the caption is the only thing that says whether the distances
 * are measured ALONG A ROAD or IN EVERY DIRECTION. Leaving it reading
 * "CORRIDOR AHEAD" over a proximity view would be the single most misleading
 * string on the screen: it would put cameras behind the driver on a ladder
 * captioned "ahead". See `aroundYou` in corridor.ts.
 */
export const PROXIMITY_CAPTION = 'AROUND YOU';
export const REROUTE_LABEL = 'REROUTE';

/**
 * THE TURN GLYPH.
 *
 * The key was the word REROUTE and a run of chevrons, and the chevrons were
 * doing two jobs badly: pointing at the key and standing in for the turn. The
 * design puts a drawn turn ABOVE the word and moves the chevrons into the
 * verdict, where they point along the road the verdict is about.
 *
 * Drawn rather than typed. A glyph from a font is at the mercy of whatever
 * fallback the device has, and an arrow that renders as a box on one phone is
 * an instrument that is broken on that phone.
 */
function RerouteGlyph(): ReactElement {
  return (
    <svg className="fwm-topblock-key-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 21c0-3.5 2-4.5 4-5s4-1.5 4-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 15c0-2.5 1.6-3.2 3.2-3.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 11.5V6.5M16 6.5 12.9 9.6M16 6.5l3.1 3.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The mile posts under the ladder. The design draws exactly these four. */
const SCALE = ['NOW', '1 MI', '2 MI', '3 MI'];

export interface RadarTopBlockProps {
  readonly corridor: Corridor | null;
  readonly speedMph: number | null;
  /** OSM `maxspeed` for the way underneath, verbatim. Null shows a dash. */
  readonly maxspeed?: string | null | undefined;
  readonly headingDeg: number | null;
  /** Horizontal accuracy in metres, for the chip above the compass. */
  readonly accuracyM?: number | null | undefined;
  /**
   * Whether there is a position at all.
   *
   * NOT the same question as whether there is a corridor, and conflating the
   * two is what put "NO FIX" on a screen that was showing a live position and a
   * live speed. `corridorFor` refuses to answer without a HEADING, and the
   * orientation gate deliberately holds the heading null while the vehicle is
   * stationary -- a GPS course derived from two identical positions is noise,
   * and a scope that follows it spins at every red light.
   *
   * So a parked car has a perfectly good fix and no bearing, and the block has
   * to say which of those is missing. Telling a driver their GPS is broken when
   * it is working is the kind of wrong that makes somebody stop trusting the
   * whole instrument.
   */
  readonly hasFix?: boolean | undefined;
  /**
   * The driver's alert threshold, in feet - the SETTINGS value, unmodified.
   *
   * Drawn on the ladder as a band, because the threshold was the one distance
   * on this screen a driver could not see. See `corridorThresholdSpan`.
   */
  readonly thresholdFt?: number | undefined;
  readonly onReroute?: (() => void) | undefined;
  /**
   * Open the intel card for a camera on the ladder.
   *
   * Absent leaves the ladder a picture, which is what it was: forty-seven
   * cameras drawn as bars a driver could read and not reach. Each bar already
   * IS a camera -- the nearest one in its bucket -- so the same tap the map
   * offers for a dot is the obvious one to offer here, and it is the same
   * handler, so the two surfaces cannot disagree about what a tap does.
   */
  readonly onSelectCamera?: ((cameraId: string) => void) | undefined;
}

export function RadarTopBlock({
  corridor,
  speedMph,
  maxspeed = null,
  headingDeg,
  accuracyM = null,
  hasFix = false,
  thresholdFt,
  onReroute,
  onSelectCamera,
}: RadarTopBlockProps): ReactElement {
  const clearSpan = corridorClearSpan(corridor);
  const hotSpan = corridorHotSpan(corridor);
  const perMile = corridorPerMile(corridor);
  const plate = speedPlateState(speedMph, maxspeed);
  const thresholdSpan =
    thresholdFt === undefined ? null : corridorThresholdSpan(corridor, thresholdFt);

  /**
   * THE HEADLINE: the one answer, centred over the instrument it describes.
   *
   * "NEAREST 220 FT" when there is something ahead, "CLEAR FOR 3 MI" when there
   * is not, and the two absence states kept distinct -- a parked car has a
   * perfectly good fix and no bearing, and telling that driver their GPS is
   * broken is the kind of wrong that costs the whole instrument its credit.
   */
  const headline =
    corridor !== null ? corridorClearLine(corridor) : hasFix ? 'NO BEARING' : 'NO FIX';

  const accuracy =
    // GREATER THAN ZERO, not merely finite. A receiver never reports a
    // horizontal accuracy of zero -- it is what a MOCK provider supplies when
    // it has no error model, and it renders as "0 M": a perfect fix, which is
    // the most confident thing this can say and always a lie.
    typeof accuracyM === 'number' && Number.isFinite(accuracyM) && accuracyM > 0
      ? `±${String(Math.round(accuracyM))} M`
      : null;

  return (
    <section className="fwm-topblock" aria-label="road ahead">
      {/* ---------------------------------------------------------------
          LEFT: the posted limit over your own speed.
          Drawn as TYPE, not as a sign. The MUTCD plate was a white rectangle
          -- the brightest object on a black instrument panel at night -- for
          the number a driver needs least. The words carry the meaning; the
          plate was carrying the attention.
          --------------------------------------------------------------- */}
      <div className="fwm-topblock-speed" data-fwm-speed-over={plate.over ? 'true' : 'false'}>
        {/* THE POSTED LIMIT, as one reading to a screen reader.
            The three stacked words are one sign, not three labels, and the
            plate carried this label before it became type -- losing it would
            read out "SPEED", "LIMIT", "55" as three unrelated strings. */}
        <span
          className="fwm-topblock-speed-sign"
          role="img"
          aria-label={
            plate.limitMph === null
              ? 'posted speed limit unknown'
              : `posted speed limit ${String(plate.limitMph)}`
          }
        >
          <span className="fwm-topblock-speed-word">SPEED</span>
          <span className="fwm-topblock-speed-word">LIMIT</span>
          <span className="fwm-topblock-speed-limit fwm-data">{plate.limitLabel}</span>
        </span>
        <span
          className="fwm-topblock-speed-you fwm-data"
          data-fwm-speed-over={plate.over ? 'true' : 'false'}
          aria-label={
            plate.speedMph === null
              ? 'your speed unknown'
              : `your speed ${String(plate.speedMph)}${plate.over ? ', over the limit' : ''}`
          }
        >
          {plate.speedLabel}
        </span>
      </div>

      {/* ---------------------------------------------------------------
          CENTRE: the instrument. Headline, the two readings that flank it,
          the ladder, its scale, and the one control at the foot.
          --------------------------------------------------------------- */}
      <div className="fwm-topblock-ladder">
        <p
          className="fwm-topblock-headline fwm-data"
          data-fwm-verdict={corridor === null ? 'none' : 'live'}
        >
          {headline}
        </p>

        {/* The count and the density, one at each end of the ladder's width.
            A count alone does not scale -- 42 over three miles of interstate
            and 42 over three miles of downtown are not the same road -- so the
            density sits opposite it. */}
        <p className="fwm-topblock-readings fwm-data">
          <span className="fwm-topblock-around">
            {corridor === null ? NO_VALUE : `${formatCount(corridor.cameras.length)} AROUND YOU`}
          </span>
          <span className="fwm-topblock-density">
            {perMile === null ? NO_VALUE : `+${formatCount(perMile)} / M`}
          </span>
        </p>

        {/* NOT aria-hidden ANY MORE when the bars are reachable. It was hidden
            because it was decoration duplicating the headline; a control the
            keyboard can reach and the screen reader cannot name is worse than
            either. Without a handler it goes back to being a picture. */}
        <div
          className="fwm-topblock-bar"
          aria-hidden={onSelectCamera === undefined ? 'true' : undefined}
          {...(onSelectCamera === undefined
            ? {}
            : { role: 'group', 'aria-label': 'cameras on the road ahead' })}
        >
          {/* THE TWO WASHES, under the bars. They are what makes an empty
              ladder readable: the green says how much road is accounted for,
              the glow says where the cluster is. See `corridorClearSpan`. */}
          <span className="fwm-topblock-bar-clear" data-fwm-corridor-span={String(clearSpan)} />
          {hotSpan === null ? null : (
            <span className="fwm-topblock-bar-glow" data-fwm-corridor-span={String(hotSpan)} />
          )}
          {/* THE ALERT BAND, and the dotted rule that closes it.
              Under the marks on purpose: this says where the alert fires, and a
              camera bar inside it is the more urgent fact of the two. It is the
              only thing on the panel that is a SETTING rather than a reading,
              which is why it is drawn faint and dashed -- the visual language
              the sweep dial's threshold ring already uses. */}
          {thresholdSpan === null ? null : (
            <span
              className="fwm-topblock-bar-threshold"
              data-fwm-corridor-threshold={String(thresholdSpan)}
            />
          )}
          {corridorMarks(corridor).map((mark) => {
            const shared = {
              className: 'fwm-topblock-mark',
              'data-fwm-corridor-state': mark.state,
              'data-fwm-corridor-at': String(mark.at),
              'data-fwm-corridor-h': String(mark.height),
              'data-fwm-corridor-heat': String(mark.heat),
            } as const;
            if (onSelectCamera === undefined) return <span key={mark.id} {...shared} />;
            return (
              <button
                key={mark.id}
                type="button"
                {...shared}
                /* NEARER WINS AN OVERLAP. Bars are quantised to whole percent,
                   so two can sit three pixels apart while their widened hit
                   areas overlap by much more. `heat` is 0 at the near end, so
                   a lower heat gets the higher stack order and the camera you
                   reach first is the one a thumb lands on. */
                style={{ zIndex: CORRIDOR_HEAT_STEPS - mark.heat }}
                aria-label={
                  mark.count > 1
                    ? `${formatCount(mark.count)} cameras, nearest ${corridorDistance(mark.distanceFt)} ahead`
                    : `camera ${corridorDistance(mark.distanceFt)} ahead`
                }
                onClick={() => {
                  onSelectCamera(mark.id);
                }}
              />
            );
          })}
        </div>

        <p className="fwm-topblock-scale fwm-data" aria-hidden="true">
          {SCALE.map((post) => (
            <span className="fwm-topblock-post" key={post}>
              {post}
            </span>
          ))}
        </p>

        {/* THE ONE CONTROL, at the foot of the instrument it acts on.
            Unboxed: a rule around it made it compete with the ladder for a
            press a driver makes rarely. */}
        {/* DISABLED WHEN THERE IS NOTHING TO ROUTE AROUND.
            `rerouteWaypoint` refuses a corridor with no cameras in it and one
            with no heading -- both correct, both silent, and the key stayed
            drawn at full strength while the press did nothing. On a road
            reading CLEAR FOR 3 MI that is indistinguishable from broken.
            Same predicate as the handler, so the two cannot drift. */}
        {onReroute === undefined ? null : (
          <button
            type="button"
            className="fwm-topblock-key"
            disabled={!canReroute(corridor)}
            onClick={onReroute}
          >
            <RerouteGlyph />
            {REROUTE_LABEL}
          </button>
        )}
      </div>

      {/* ---------------------------------------------------------------
          RIGHT: which way, in words and in degrees.
          --------------------------------------------------------------- */}
      <div className="fwm-topblock-compass">
        <Compass headingDeg={headingDeg} />
        {/* ALWAYS DRAWN, even with nothing to say. The lamp answers "is there a
            fix at all", which the number alone could only answer by being
            present -- a distinction nobody makes at a glance on a mount. */}
        <span className="fwm-topblock-accuracy fwm-data" data-fwm-fix={hasFix ? 'live' : 'none'}>
          <span className="fwm-topblock-accuracy-lamp" aria-hidden="true" />
          {accuracy ?? ''}
        </span>
      </div>
    </section>
  );
}
