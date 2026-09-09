/**
 * THE COMPASS - a needle that turns on a ring that does not.
 *
 * =============================================================================
 * THE RING NEVER SPINS
 * =============================================================================
 * The design says so explicitly, and it is the whole design. A compass rose
 * that rotates makes the driver read a moving label to learn which way they are
 * pointing; a needle that rotates against a fixed ring can be read as a SHAPE,
 * without reading anything. At a glance, on a mount, that is the difference
 * between an instrument and a decoration.
 *
 * It is also the same argument the scope's heading gate makes: the map may be
 * heading-up, but a thing that spins when the vehicle is standing still is
 * broken. The needle here takes the SETTLED heading -- the one
 * `orientation.ts` has already decided is real -- so at a red light it holds
 * still like everything else.
 *
 * =============================================================================
 * NO PLATE, NO FILL
 * =============================================================================
 * Everything else in the top row is a filled object: a white sign, a key, a
 * ladder. The compass is a hairline ring and a needle, so it reads as the
 * lightest thing in the row. It is supporting information -- which way am I
 * pointing -- and it should never pull the eye away from the corridor verdict.
 */

import type { ReactElement } from 'react';

import { formatHeadingCardinal } from '../format.ts';

/** The drawn box, in its own SVG units. */
const BOX = 40;
const CENTRE = BOX / 2;

/**
 * THE NEEDLE, IN TWO HALVES.
 *
 * It was one crimson kite, and at 40px on a mount that is a red blob on a
 * circle: nothing tells the end that POINTS from the end that trails, so the
 * reading is ambiguous by 180 degrees -- the one error a compass must not make.
 *
 * Two triangles meeting at the hub fixes it the way every compass anybody has
 * ever read is drawn: a saturated north, a pale south, and a hub over the
 * join. Which end is the front is then a matter of colour, not of shape, and
 * colour survives being small and being glanced at.
 */
const NEEDLE_LENGTH = 15;
const NEEDLE_HALF_W = 3.5;
const HUB_R = 3;

const NORTH = [
  `${String(CENTRE)},${String(CENTRE - NEEDLE_LENGTH)}`,
  `${String(CENTRE + NEEDLE_HALF_W)},${String(CENTRE)}`,
  `${String(CENTRE - NEEDLE_HALF_W)},${String(CENTRE)}`,
].join(' ');

const SOUTH = [
  `${String(CENTRE)},${String(CENTRE + NEEDLE_LENGTH)}`,
  `${String(CENTRE + NEEDLE_HALF_W)},${String(CENTRE)}`,
  `${String(CENTRE - NEEDLE_HALF_W)},${String(CENTRE)}`,
].join(' ');

export interface CompassProps {
  /** The settled heading in compass degrees, or null for no fix. */
  readonly headingDeg: number | null;
}

/** Every 30 degrees. The four cardinals are drawn longer -- see the marks. */
const TICKS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

export function Compass({ headingDeg }: CompassProps): ReactElement {
  const known = headingDeg !== null && Number.isFinite(headingDeg);
  const cardinal = formatHeadingCardinal(headingDeg);

  return (
    <div className="fwm-compass" data-fwm-compass={known ? 'live' : 'unknown'}>
      <svg
        className="fwm-compass-dial"
        viewBox={`0 0 ${String(BOX)} ${String(BOX)}`}
        role="img"
        aria-label={known ? `heading ${cardinal}` : 'heading unknown'}
      >
        {/* THE RING. Fixed, always. See the header. */}
        <circle className="fwm-compass-ring" cx={CENTRE} cy={CENTRE} r={CENTRE - 2} />
        {/* THE TICKS, every 30 degrees, on the ring and not on the needle.
            A bare circle gives the needle nothing to be read AGAINST -- the
            same angle looks the same at every heading, so the dial reads as
            decoration. The marks are what turn it into an instrument, and they
            do not rotate: the ring is the world, the needle is the vehicle. */}
        {TICKS.map((deg) => (
          <line
            key={deg}
            className="fwm-compass-tick"
            x1={CENTRE}
            y1={2}
            x2={CENTRE}
            y2={deg % 90 === 0 ? 7 : 5}
            transform={`rotate(${String(deg)} ${String(CENTRE)} ${String(CENTRE)})`}
          />
        ))}
        {known ? (
          <g transform={`rotate(${String(headingDeg)} ${String(CENTRE)} ${String(CENTRE)})`}>
            <polygon className="fwm-compass-needle-south" points={SOUTH} />
            <polygon className="fwm-compass-needle-north" points={NORTH} />
          </g>
        ) : null}
        {/* The hub is drawn LAST and does not rotate: it covers the seam where
            the two halves meet, which would otherwise show as a notch. */}
        {known ? <circle className="fwm-compass-hub" cx={CENTRE} cy={CENTRE} r={HUB_R} /> : null}
      </svg>
      {/* The word under the ring, not on it: a label that rotates is a label
          nobody can read. */}
      <span className="fwm-compass-cardinal">{cardinal}</span>
      {/* AND THE DEGREES UNDER THE WORD.
          `SW` is a 45-degree bucket, so it is the same word from 202 to 247.
          On a curving road the word holds still while the road turns, and the
          instrument looks stuck. The number is what actually moves. */}
      {known ? (
        <span className="fwm-compass-degrees fwm-data">
          {`${String(Math.round(headingDeg))}°`}
        </span>
      ) : null}
    </div>
  );
}
