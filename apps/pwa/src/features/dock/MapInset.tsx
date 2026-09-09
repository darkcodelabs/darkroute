/**
 * THE MAP INSET. A static tile, 56px in a drive row and 48px in a navigation
 * row, radius 12, showing the one thing words cannot: which way the camera
 * faces, or which way the turn goes.
 *
 * IT IS NOT A MAP AND MUST NOT BECOME ONE. `dockv3.dc.html` says it outright --
 * "It is a static tile, not a live map -- no pan, no zoom, no labels" -- and
 * the build this replaces put a live `MiniMap` in a 52px thumbnail: a MapLibre
 * instance, a tile fetch, a raster upload and a render loop, per dock row, on a
 * phone that is also drawing the real map behind the dock. The tile is inline
 * SVG. It costs one paint and it cannot go blank because the network did.
 *
 * WHAT IT DRAWS IS A SCHEMATIC, AND THE SPEC DREW ALL OF IT. Five tiles across
 * sections B and E, and every one is the same four parts in the same order:
 * a street grid, a route line, a subject, and you. The route curve is
 * FURNITURE -- identical in every tile of a given size, in the spec and here --
 * because a 48px square cannot carry a real street layout and pretending
 * otherwise would be drawing a map of nowhere. Only three things come from
 * data:
 *
 *   THE VARIANT     which of the five tiles this is, fixed by the state.
 *   THE FACING      the camera's bearing, which rotates the cone.
 *   THE TURN        left or right, which mirrors the corner and the chevron.
 *
 * Everything else -- coordinates, stroke weights, the dash pattern, the radii
 * of the four dots -- is lifted from the spec's own path data unchanged.
 *
 * PAINT IS `currentColor` AND ALPHA, WITH A CLASS ON EVERY PART.
 *
 * The spec hardcodes seven literals per tile -- a navy ground, white grid,
 * green route, amber or magenta cone, an ink dot. A hex here would fail
 * `scripts/check-design-values.mjs` on sight and would be right in one skin
 * and wrong in sixteen, so each part paints in `currentColor` at the spec's
 * own opacity and carries a class the stylesheet can take over: the cone and
 * the camera dot follow the state's hue, the route follows the route hue, the
 * grid and the ground follow the sunken surface. Rendered with no rules at
 * all it is a legible monochrome schematic rather than a black square, which
 * is the failure mode a class-only tile has.
 *
 * THE GROUND AND THE STREET GRID ARE NOT DRAWN HERE. The spec fills a `<rect>`
 * with a navy plate and strokes four grid lines over it; `dock.css` already
 * draws both on `.fwm-dock-inset` -- the plate as `--fwm-dock-sunk` and the
 * grid as two crossed repeating gradients, which is a diagram of a grid that
 * never moves and cannot fail to load. Drawing them again in here would be a
 * second grid half a pixel off the first. An SVG rect painted in
 * `currentColor` could not have been the plate anyway: it can only ever be
 * LIGHTER than the ink, and this ground has to be darker than the pane.
 */

import type { ReactElement } from 'react';

/** The two sizes, and nothing between them. Section G publishes both. */
export const DOCK_INSET_DRIVE = 56;
export const DOCK_INSET_NAV = 48;

/**
 * Which of the five tiles the spec draws.
 *
 *   camera           B APPROACHING and B UNDER SURVEILLANCE, 56px -- a route
 *                    running past a reader, its cone, and you inside it.
 *   route            E1 ROUTE PROPOSED, 48px -- the whole line, origin to
 *                    destination, before it is running.
 *   turn             E2 TURN IMMINENT, 48px -- the corner, lit, with the
 *                    maneuver chevron on it and you approaching.
 *   camera-on-route  E3 CAMERA ON ROUTE, 48px -- the same corner with a reader
 *                    sitting on it. The route recedes; the cone is the subject.
 *   off-route        E5 OFF ROUTE, 48px -- the route faded to a memory and a
 *                    dashed spur out to where you actually are.
 */
export type DockInsetVariant = 'camera' | 'route' | 'turn' | 'camera-on-route' | 'off-route';

/** Which way the corner bends. The spec draws right; left is its mirror. */
export type DockInsetTurn = 'left' | 'right';

/* ------------------------------------------------------------------------ *
 * THE FURNITURE
 *
 * Two route curves, and they are NOT one drawing scaled: the spec hand-places
 * both, and the 56px tile's road runs past a reader while the 48px one is a
 * whole trip end to end. Transcribed rather than derived.
 * ------------------------------------------------------------------------ */

/** The drive tile's route: a curve running up past the reader and off the top. */
const DRIVE_ROUTE = 'M-2 52C10 48 18 38 27 21L35 -2';

/** E1's route: origin bottom-left, destination top-right, the whole trip. */
const OVERVIEW_ROUTE = 'M8 44C16 38 14 26 24 20 34 14 38 12 42 6';

/* ------------------------------------------------------------------------ *
 * THE CORNER, AND ITS MIRROR
 *
 * E2, E3 and E5 all draw the same corner -- up the tile and away to the right.
 * A left turn is that corner reflected about the tile's vertical centre, and
 * the reflection is written into the path data rather than applied as a CSS
 * `scaleX(-1)`, for the reason `icons.tsx` already gives about its own mirror:
 * a transform also mirrors the round joins and the dash phase. The spec sets
 * the precedent itself -- it ships `turn-left` as explicit coordinates rather
 * than as a reflected `turn-right`.
 * ------------------------------------------------------------------------ */

const CORNER: Readonly<Record<DockInsetTurn, string>> = {
  right: 'M24 48V22H48',
  left: 'M24 48V22H0',
};

/** The maneuver chevron sitting on the corner's far end, E2 only. */
const CHEVRON: Readonly<Record<DockInsetTurn, string>> = {
  right: 'M39 17l5.5 5-5.5 5',
  left: 'M9 17l-5.5 5 5.5 5',
};

/** Where the reader sits on the corner, E3. Mirrored with everything else. */
const CAMERA_ON_CORNER: Readonly<Record<DockInsetTurn, { readonly x: number; readonly y: number }>> =
  {
    right: { x: 33, y: 22 },
    left: { x: 15, y: 22 },
  };

/* ------------------------------------------------------------------------ *
 * THE CONE
 *
 * The one place a number becomes geometry. The spec draws three cones and all
 * three are the same wedge at different bearings: apex on the reader, two rays
 * about 25 degrees either side of the facing, running most of the way across
 * the tile. Measured off the spec's own triangles -- E3's rays sit 27.6 apart
 * from centre at a mean 16.6 long in a 48px box, the 56px pair 24.9 apart at
 * 27.8 -- and rounded to the half degree, because a wedge drawn from a real
 * bearing is the entire reason this tile exists.
 *
 * BEARING IS COMPASS, THE TILE IS SVG. North is up and degrees run clockwise,
 * which is 90 degrees off the SVG angle and on a y axis that points down --
 * hence the single subtraction below. Getting this wrong points every cone at
 * the wrong quarter of the road and nothing about the tile looks broken.
 * ------------------------------------------------------------------------ */

const CONE_HALF_ANGLE = 26;

const CONE_REACH_DRIVE = 27.8;
const CONE_REACH_NAV = 16.6;

/** The spec's own facing where a caller has not measured one. E3's bearing. */
const CONE_DEFAULT_BEARING = 149;

function conePath(x: number, y: number, bearingDeg: number, reach: number): string {
  const ray = (offset: number): string => {
    const radians = ((bearingDeg + offset - 90) * Math.PI) / 180;
    const rx = x + Math.cos(radians) * reach;
    const ry = y + Math.sin(radians) * reach;
    return `${rx.toFixed(1)} ${ry.toFixed(1)}`;
  };
  return `M${String(x)} ${String(y)}L${ray(-CONE_HALF_ANGLE)}L${ray(CONE_HALF_ANGLE)}Z`;
}

/* ------------------------------------------------------------------------ *
 * THE ALPHAS
 *
 * The spec's own, kept as numbers because that is what they are: a route at
 * 0.8 in E1 and 0.3 in E5 is the same line remembered less clearly, not two
 * colours. `dock.css` carries the same idea as `--fwm-dk-quiet` and says so.
 * ------------------------------------------------------------------------ */

const CONE_ALPHA = 0.32;
const ROUTE_ALPHA: Readonly<Record<DockInsetVariant, number>> = {
  camera: 0.45,
  route: 0.8,
  turn: 1,
  'camera-on-route': 0.75,
  'off-route': 0.3,
};

const ROUTE_WEIGHT: Readonly<Record<DockInsetVariant, number>> = {
  camera: 2.5,
  route: 3.2,
  turn: 4,
  'camera-on-route': 3.5,
  'off-route': 3.5,
};

export interface MapInsetProps {
  /** Which of the five tiles. Fixed by the state, never by the data. */
  readonly variant: DockInsetVariant;
  /**
   * The rendered box, square. `DOCK_INSET_DRIVE` in a 150px drive row,
   * `DOCK_INSET_NAV` in a 170px navigation row. There is no third size.
   */
  readonly size: number;
  /**
   * Which way the maneuver goes, for the three variants that draw a corner.
   * Right is what the spec draws; left mirrors it.
   */
  readonly turn?: DockInsetTurn;
  /**
   * The reader's facing, in compass degrees. Absent draws the spec's own
   * bearing rather than no cone: a reader whose facing nobody has measured is
   * still a reader, and the two states that draw this tile have already told
   * the driver it is there in words.
   */
  readonly facingDeg?: number;
}

/**
 * One tile.
 *
 * `aria-hidden`, always. Every row that draws one already says in text what
 * the tile is a picture of -- the distance, the street, the operator -- and a
 * schematic with no labels has nothing to add to a screen reader that the row
 * above it has not already said.
 */
export function MapInset({ variant, size, turn = 'right', facingDeg }: MapInsetProps): ReactElement {
  const reach = size === DOCK_INSET_DRIVE ? CONE_REACH_DRIVE : CONE_REACH_NAV;

  const corner = variant === 'camera' || variant === 'route' ? null : CORNER[turn];
  const camera = variant === 'camera-on-route' ? CAMERA_ON_CORNER[turn] : null;

  return (
    <span className="fwm-dock-inset" data-fwm-inset={variant}>
      <svg
        viewBox={`0 0 ${String(size)} ${String(size)}`}
        width={size}
        height={size}
        aria-hidden="true"
        focusable="false"
      >
        {/* The route. `data-fwm-lit` is E2 only: the corner you are about to
            take is the subject there, so it is drawn in the accent rather than
            in the route green, and the stylesheet needs to see which. */}
        <path
          className="fwm-dock-inset-route"
          data-fwm-lit={variant === 'turn' ? 'true' : undefined}
          d={corner ?? (variant === 'route' ? OVERVIEW_ROUTE : DRIVE_ROUTE)}
          stroke="currentColor"
          strokeWidth={ROUTE_WEIGHT[variant]}
          strokeOpacity={ROUTE_ALPHA[variant]}
          strokeLinecap="round"
          fill="none"
        />

        {/* THE READER AND ITS CONE, drawn together or not at all. A cone with
            no apex mark is a stain on the tile; a mark with no cone is a dot
            that has stopped saying the only thing this picture is for. */}
        {variant === 'camera' ? (
          <>
            <path
              className="fwm-dock-inset-cone"
              d={conePath(27, 21, facingDeg ?? CONE_DEFAULT_BEARING, reach)}
              fill="currentColor"
              fillOpacity={CONE_ALPHA}
            />
            <circle className="fwm-dock-inset-mark" cx={27} cy={21} r={4} fill="currentColor" />
          </>
        ) : null}

        {camera === null ? null : (
          <>
            <path
              className="fwm-dock-inset-cone"
              d={conePath(camera.x, camera.y, facingDeg ?? CONE_DEFAULT_BEARING, reach)}
              fill="currentColor"
              fillOpacity={CONE_ALPHA}
            />
            <circle
              className="fwm-dock-inset-mark"
              cx={camera.x}
              cy={camera.y}
              r={3.6}
              fill="currentColor"
            />
          </>
        )}

        {/* E2's maneuver chevron, sitting on the far end of the lit corner. */}
        {variant === 'turn' ? (
          <path
            className="fwm-dock-inset-turn"
            d={CHEVRON[turn]}
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ) : null}

        {/* E5's spur. Dashed, because the line between the route and where you
            are is not a road -- it is the distance you have drifted. */}
        {variant === 'off-route' ? (
          <path
            className="fwm-dock-inset-drift"
            d="M24 46 13 34"
            stroke="currentColor"
            strokeWidth={2.4}
            strokeDasharray="3 3.5"
            strokeLinecap="round"
            fill="none"
          />
        ) : null}

        {/* E1's destination: a ring rather than a dot, because you are not
            there yet. The filled dot beside it is where the trip starts. */}
        {variant === 'route' ? (
          <>
            <circle className="fwm-dock-inset-you" cx={8} cy={44} r={3.6} fill="currentColor" />
            <circle
              className="fwm-dock-inset-goal"
              cx={42}
              cy={6}
              r={3.4}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            />
          </>
        ) : null}

        {/* YOU, last, so nothing paints over the one dot the driver looks for.
            Its place is the variant's: on the corner in E2, short of the
            reader in E3, out on the end of the spur in E5, and inside the cone
            in the drive tile -- which is the whole point of that tile. */}
        {variant === 'turn' ? (
          <circle className="fwm-dock-inset-you" cx={24} cy={36} r={4.5} fill="currentColor" />
        ) : null}
        {variant === 'camera-on-route' ? (
          <circle className="fwm-dock-inset-you" cx={24} cy={38} r={4} fill="currentColor" />
        ) : null}
        {variant === 'off-route' ? (
          <circle className="fwm-dock-inset-you" cx={13} cy={34} r={4} fill="currentColor" />
        ) : null}
        {variant === 'camera' ? (
          <circle className="fwm-dock-inset-you" cx={37} cy={32} r={3.6} fill="currentColor" />
        ) : null}
      </svg>
    </span>
  );
}
