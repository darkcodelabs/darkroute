/**
 * THE DOCK'S GLYPHS, redrawn against `dockv3.dc.html`.
 *
 * V3 IS A DIFFERENT DRAWING SET, NOT A RESKIN. It redraws thirteen of the
 * marks this file already carried -- the five tab columns, the camera, the
 * warning, the check, the wifi -- and it draws five that did not exist: the
 * route branch, the v3 maneuver arrow, the rerouting spinner, the off-route
 * mark, and the eye. Every one below is copied from that file's own path data.
 * Where v3 redraws a name, the v3 geometry replaces the v2 geometry under the
 * same name, because the surface that used the old one is gone.
 *
 * THE ONE REPOINTED NAME IS `reroute`. In v2 it was a branch -- a line
 * splitting and rejoining. V3 draws the detour key's mark as an arrow leaving
 * a corner, at every one of the five places it appears, and there is no site
 * left that draws the branch. Same name, same meaning, new geometry.
 *
 * WHAT IS DELIBERATELY NOT COPIED.
 *
 *   COLOUR. The spec writes `stroke="#f5a524"`, `stroke="#98a2ac"` and a dozen
 *   other literals as presentation attributes. A hex here would fail
 *   `scripts/check-design-values.mjs` on sight and would be right in one skin
 *   and wrong in sixteen. So paint is `currentColor`: whatever renders a glyph
 *   sets `color` from a `var(--fwm-*)` token and the glyph inherits it. The
 *   two FILLED pips -- the warning's dot and the wifi's -- carry
 *   `fill="currentColor" stroke="none"` for the same reason, which is the
 *   spec's own `fill` with the literal taken out.
 *
 *   NOTHING ELSE. `viewBox`, `fill="none"`, `stroke-width`, `stroke-linecap`
 *   and `stroke-linejoin` are written here as presentation attributes exactly
 *   as the spec writes them, rather than pushed into a stylesheet. The glyphs
 *   then carry their own geometry and cannot be un-drawn by an edit to a CSS
 *   file the caller has never heard of -- which is the failure `icons.css`
 *   documents having already happened once on the MESH screen.
 *
 * STROKE WIDTH IS PER DRAWING NOW, AND THAT IS V3'S DOING. Brief 1 stated a
 * flat 1.75 and v2 honoured it in 38 of 40 renderings. V3 does not: it draws
 * the camera at 1.7, the tab marks at 1.8, the reroute and the route branch at
 * 1.9, the maneuver and the spinner at 2, the check at 2 and 2.2. So the
 * weight lives beside the drawing in `ICON_STROKE`, and `DEFAULT_STROKE`
 * covers only the marks v3 did not redraw. Two drawings are used at two
 * weights and their second site passes `strokeWidth`.
 *
 * NO TEXT-CHARACTER GLYPHS. Turn arrows key off a direction token through
 * `DOCK_TURN_ICON` and `DOCK_MANEUVER_ICON`, never off a character.
 */

import type { ReactElement } from 'react';

/**
 * A direction, as a token rather than an arrow character.
 *
 * These are the four flags the spec's own step data sets -- `{ up: true }`,
 * `{ right: true }`, `{ left: true }`, `{ end: true }`, exactly one per step.
 */
export type DockTurn = 'up' | 'right' | 'left' | 'end';

/** Every drawing in the dock. One name per distinct geometry. */
export type DockIconName =
  /* --- the five tab marks, 21px, drawn only in the tab row --- */
  | 'navigate'        /* Map      -- the navigation cursor */
  | 'bars'            /* Exposure -- four ascending bars */
  | 'mesh-hex'        /* Mesh     -- hexagon and centre dot */
  | 'search'          /* Lookup   -- a magnifier */
  | 'menu'            /* More     -- three rules */
  /* --- the readers --- */
  | 'camera'          /* the ALPR body and lens. 20px in the collapsed row. */
  | 'camera-plus'     /* a NARROWER body with a plus, not a lens. The report key. */
  | 'plus-circle'     /* the unmapped-camera invitation */
  | 'eye'             /* B UNDER SURVEILLANCE. A lens looking back at you. */
  /* --- keys and affordances --- */
  | 'mute'            /* speaker with two slashes */
  | 'chevron-up'      /* v2's expand affordance. V3 deletes it; see the note. */
  | 'chevron-right'   /* a row's disclosure. The nearby list and the turn list. */
  | 'undo'
  | 'close'
  /* --- route --- */
  | 'route-branch'    /* E1 and F2 -- two nodes and the line between them */
  | 'maneuver-right'  /* E2, E3, F1 -- the 28-34px maneuver. NOT the step arrow. */
  | 'maneuver-left'   /* its mirror, written out rather than reflected */
  | 'turn-up'
  | 'turn-right'
  | 'turn-left'
  | 'turn-end'
  | 'reroute'         /* the detour key's mark, at all five of its sites */
  | 'refresh'         /* E4 REROUTING -- a circle closing on itself */
  | 'off-route'       /* E5 OFF ROUTE -- the route mark, struck through */
  | 'flag'
  /* --- status --- */
  | 'warning'         /* B APPROACHING */
  | 'wifi-off'        /* B OFFLINE */
  | 'clock'
  | 'check'           /* B CLEARED at 2, E6 ARRIVED at 2.2 */
  | 'newspaper'
  | 'gps-off'
  /* --- the arcade --- */
  | 'ship';          /* the PEW key. A notched triangle, nose up: Asteroids' own. */

/**
 * Direction token to drawing, for a step list that draws one.
 *
 * F1's turn list DELIBERATELY DRAWS NONE. V3 leads each step with its distance
 * in a fixed 44px cell instead, and the arrow is gone from the row -- so this
 * map has no site in the v3 dock and is kept only because the step data still
 * carries a direction and a future list may want it. `turn-end` is the
 * arrive-flag, a different drawing from `flag`; the spec ships both.
 */
export const DOCK_TURN_ICON: Readonly<Record<DockTurn, DockIconName>> = {
  up: 'turn-up',
  right: 'turn-right',
  left: 'turn-left',
  end: 'turn-end',
};

/**
 * Direction token to the MANEUVER drawing in the navigation family's 56px row.
 *
 * PARTIAL, AND STILL PARTIAL. V3 draws the maneuver arrow as a right turn and
 * nothing else. `maneuver-left` is here because the spec sets the precedent for
 * a hand-written mirror -- it ships `turn-left` as explicit coordinates rather
 * than a reflected `turn-right` -- and a left turn is half of all turns. There
 * is no straight-ahead and no arrive maneuver in v3 at any size, so `up` and
 * `end` render no mark rather than the wrong one. See the open questions.
 */
export const DOCK_MANEUVER_ICON: Readonly<Partial<Record<DockTurn, DockIconName>>> = {
  right: 'maneuver-right',
  left: 'maneuver-left',
};

/** The inner geometry of each 24x24 mark. */
const ICON_BODY: Readonly<Record<DockIconName, ReactElement>> = {
  /* The five tab marks, all redrawn by v3. */
  navigate: <path d="M3.6 11.2 20.4 4.4 13.6 21.2l-2.2-7.8z" />,
  bars: <path d="M6 15v4M11 9v10M16 12v7M21 6v13" />,
  'mesh-hex': (
    <>
      <path d="M12 3.5 19.5 8v8L12 20.5 4.5 16V8z" />
      <circle cx="12" cy="12" r="2.4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m15.8 15.8 4.2 4.2" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,

  /* The dock's camera, v3's narrower body and smaller lens. */
  camera: (
    <>
      <path d="M4 8.5h3l1.4-2h6.2l1.4 2h3v9H4z" />
      <circle cx="12" cy="12.6" r="2.6" />
    </>
  ),
  /* A SECOND camera, and not a variant of the first: the lens is replaced by a
   * plus. V2's drawing, kept -- v3 does not redraw the report key. */
  'camera-plus': (
    <>
      <path d="M4.5 8.5h3l1.4-2h6.2l1.4 2h3v9h-15z" />
      <path d="M12 10v5M9.5 12.5h5" />
    </>
  ),
  'plus-circle': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </>
  ),
  /* The lens looking back. Drawn only where a read is happening to you. */
  eye: (
    <>
      <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),

  mute: (
    <>
      <path d="M11 6.5 7.5 9.5H4.5v5h3L11 17.5z" />
      <path d="M16 9.5l4 5M20 9.5l-4 5" />
    </>
  ),
  /* V3 DELETES THE EXPAND CHEVRON -- "the whole pane is the target" -- so no
   * dock surface draws this any more. The name survives one integration so the
   * browse row keeps compiling while it loses its own chevron. */
  'chevron-up': <path d="M7 14.5 12 9.5l5 5" />,
  'chevron-right': <path d="M9.5 6.5 15 12l-5.5 5.5" />,
  undo: (
    <>
      <path d="M4 9.5h9a5 5 0 0 1 0 10h-4" />
      <path d="M7.5 6 4 9.5 7.5 13" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,

  /* E1 and F2. Two nodes and the road between them -- a route as an object
   * you are being offered, rather than an instruction you are being given. */
  'route-branch': (
    <>
      <circle cx="6" cy="18.5" r="2.6" />
      <circle cx="18" cy="5.5" r="2.6" />
      <path d="M8.4 17.4c4-1 3-6.8 7.4-9.4" />
    </>
  ),
  /* V3's maneuver, and it is not v2's scaled up: it sits lower in the box and
   * turns on a wider radius. Drawn at 34 in E2, 30 in E3 and F1. */
  'maneuver-right': (
    <>
      <path d="M9 20V10a4 4 0 0 1 4-4h5" />
      <path d="m14.5 2.5 4 3.5-4 3.5" />
    </>
  ),
  /* THE MIRROR, WRITTEN OUT. Reflected about x=12 with the arc's sweep flag
   * flipped, not applied as `scaleX(-1)`: a transform mirrors the round joins
   * with the path and the arrowhead comes back looking sheared. */
  'maneuver-left': (
    <>
      <path d="M15 20V10a4 4 0 0 0-4-4H6" />
      <path d="m9.5 2.5-4 3.5 4 3.5" />
    </>
  ),
  'turn-up': (
    <>
      <path d="M12 19.5V5.5" />
      <path d="M7.5 10 12 5.5 16.5 10" />
    </>
  ),
  'turn-right': (
    <>
      <path d="M8 19.5v-7A3.5 3.5 0 0 1 11.5 9H17" />
      <path d="M14 5.5 17.5 9 14 12.5" />
    </>
  ),
  /* The spec ships explicit coordinates for the mirror -- sweep flag 0 and its
   * own x values -- rather than reflecting `turn-right`. Do not replace this
   * with a CSS `scaleX(-1)`: that would also mirror the stroke's round joins. */
  'turn-left': (
    <>
      <path d="M16 19.5v-7A3.5 3.5 0 0 0 12.5 9H7" />
      <path d="M10 5.5 6.5 9 10 12.5" />
    </>
  ),
  'turn-end': (
    <>
      <path d="M7 20V5" />
      <path d="M7 5.5h9.5l-2.2 3.2 2.2 3.3H7" />
    </>
  ),
  /* THE DETOUR MARK. An arrow leaving a corner: the verb, so the key's face
   * does not have to carry it twice. */
  reroute: (
    <>
      <path d="M14 5h5v5" />
      <path d="M19 5 12 12v7" />
    </>
  ),
  /* E4. An arc that has not closed, with the head where it would close --
   * work in progress, and the one glyph in the family that implies motion
   * without animating. */
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.9-6.4" />
      <path d="M19 3v3.4h-3.4" />
    </>
  ),
  /* E5. The route mark with a rule struck through it, drawn at a lighter
   * weight than the mark so the strike reads as an interruption of the road
   * rather than as part of it. */
  'off-route': (
    <>
      <path d="M5 20v-6a5 5 0 0 1 5-5h4" />
      <path d="M3 3l18 18" strokeWidth={1.7} />
    </>
  ),
  /* Pole and pennant are separate paths in the spec and stay separate here --
   * joined into one `d` the stroke would round the corner where they meet. */
  flag: (
    <>
      <path d="M6 20.5V4" />
      <path d="M6 5h11l-2.5 3.4L17 11.8H6" />
    </>
  ),

  /* THE PIP IS FILLED, and that is v3's own `fill` with the literal removed.
   * V2 faked it with a stroked 0.4-unit segment; at 20px on a lit amber ground
   * that reads as a smudge rather than as the dot of an exclamation mark. */
  warning: (
    <>
      <path d="M12 4.5 21 19.5H3z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="16.8" r="0.7" fill="currentColor" stroke="none" />
    </>
  ),
  'wifi-off': (
    <>
      <path d="M4 4l16 16" />
      <path d="M2.5 9.5a15 15 0 0 1 6-3.4M15.5 6.1a15 15 0 0 1 6 3.4M6 13a10 10 0 0 1 3-1.7M15 11.3a10 10 0 0 1 3 1.7" />
      <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  check: <path d="M5 12.5 10 17.5 19.5 7.5" />,
  /* THE SHIP. Not in v3 -- the arcade is the owner's ask, not the spec's -- so
   * it is drawn here in the set's own vocabulary: 24 box, bare numbers, stroke
   * in `currentColor`, the notch at the tail that says Asteroids. */
  ship: <path d="M12 3.5 19 20 12 16.5 5 20z" />,
  newspaper: (
    <>
      <path d="M4.5 4.5h11.5v15H4.5z" />
      <path d="M16 8.5h3.5v9a2 2 0 0 1-3.5 1.4" />
      <path d="M7.5 8.5h5.5M7.5 12h5.5M7.5 15.5h3.5" />
    </>
  ),
  'gps-off': (
    <>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
      <path d="M4 4l16 16" />
    </>
  ),
};

/**
 * The stroke weight each drawing is born with.
 *
 * A table entry exists wherever v3 states a weight; `DEFAULT_STROKE` covers
 * only the marks v3 does not redraw. Two drawings appear at two weights and
 * the heavier site passes `strokeWidth`: `check` at 2.2 in E6 ARRIVED, and
 * `maneuver-right` at 2.3 in E2 TURN IMMINENT, where the maneuver is the
 * loudest thing on the glass.
 */
const DEFAULT_STROKE = 1.75;
const ICON_STROKE: Readonly<Partial<Record<DockIconName, number>>> = {
  ship: 1.8,
  navigate: 1.8,
  bars: 1.8,
  'mesh-hex': 1.8,
  search: 1.8,
  menu: 1.8,
  camera: 1.7,
  eye: 1.8,
  'chevron-right': 1.8,
  'route-branch': 1.9,
  'maneuver-right': 2,
  'maneuver-left': 2,
  reroute: 1.9,
  refresh: 2,
  'off-route': 2,
  warning: 1.9,
  'wifi-off': 1.8,
  check: 2,
};

export interface DockIconProps {
  /** Which drawing. */
  readonly name: DockIconName;
  /**
   * Rendered box, square, in CSS pixels. V3 draws glyphs at 15, 17, 20, 21,
   * 28, 30 and 34. 21 is the tab row's and the most common, so it is the
   * default; every other site passes its own.
   */
  readonly size?: number;
  /**
   * Override the stroke weight, for a drawing v3 uses at two.
   *
   * `check` is 2 in B CLEARED and 2.2 in E6 ARRIVED; `maneuver-right` is 2 in
   * E3 and F1 and 2.3 in E2. The weight is geometry rather than paint, so it
   * does not belong in the stylesheet; and it varies by SITE rather than by
   * drawing, so it cannot live in `ICON_STROKE`. This is the seam.
   */
  readonly strokeWidth?: number;
}

/**
 * One glyph.
 *
 * Always `aria-hidden`: in the tab row the label element beside it carries the
 * accessible name, and everywhere else the glyph is decoration on a row that
 * already reads. An icon-only key needs a name of its own, and that is the
 * key's job, not this one's.
 */
export function DockIcon({ name, size = 21, strokeWidth }: DockIconProps): ReactElement {
  return (
    <svg
      data-fwm-icon={name}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? ICON_STROKE[name] ?? DEFAULT_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_BODY[name]}
    </svg>
  );
}

/** Every name, for tests and for a spec page that redraws the whole set. */
export const DOCK_ICON_NAMES: readonly DockIconName[] = Object.keys(ICON_BODY) as DockIconName[];
