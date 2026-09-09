/**
 * THE READER COLUMN - the closest camera, and the list of what comes after it.
 *
 * =============================================================================
 * ONE COMPONENT, DRAWN TWICE, AND THE SOURCE PROVES THEY ARE THE SAME
 * =============================================================================
 * This is monitor column 1 AND navigation column 3. In `Dynamic Cards (3)` both
 * open `flex: 1.35 0 min(93cqw, 400px)` and every child under them is
 * identical; the only difference is a right border monitor carries and
 * navigation does not, which lives on the host card's selector rather than on a
 * variant prop here. So this component has no variants.
 *
 * =============================================================================
 * IT OWNS THE LIST, AND THAT IS WHAT MAKES 180px WORK
 * =============================================================================
 * The card's height is locked. The version before this one put four pinned
 * children in this column - the reader, a heading, the list, and a key row -
 * which is more fixed content than the box has, so the list was crushed to one
 * row and the keys were cut off.
 *
 * The design's answer is structural rather than taller: the route-around and
 * mute keys fold INTO the reader box's third line beside the NEARBY count, and
 * the heading goes. Two pinned children, and the list takes the remainder.
 *
 * =============================================================================
 * WHAT THIS NO LONGER DRAWS
 * =============================================================================
 * The alert-state ramp, the landmark line, the mute-pierced note and the full
 * compass rosette are all gone, because the design draws none of them. Two of
 * those are worth naming so their loss is a decision on the record rather than
 * an oversight:
 *
 *   `piercedNote` said "MUTED - STILL ALERTING BECAUSE THIS ONE IS INSIDE YOUR
 *   RE-ALERT DISTANCE", and its own note recorded that dropping it once before
 *   showed up later as "why is it beeping at a camera I silenced".
 *
 *   `landmark` drew "@ Walmart Supercenter" - the thing a driver can match
 *   through a windscreen, where a street pair only helps once you are already
 *   at the junction.
 *
 * Both are flagged to the owner rather than quietly kept.
 */

import type { ReactElement, ReactNode } from 'react';

import type { CameraOwnerType } from '../../stores/cameras.ts';

import './closestPanel.css';

/** The design's own words. */
export const CLOSEST_CHIP = 'CLOSEST';
export const CLOSEST_NEARBY = 'NEARBY';

/**
 * Which owner a dot is painted for - the archive's own field, not a second
 * vocabulary. LOOK UP already paints these exact values from the same
 * `ownerType`, so the two surfaces cannot disagree about who runs a camera.
 */
export type ClosestOwner = CameraOwnerType | 'unknown';

export interface ClosestRow {
  readonly id: string;
  /** '1.5 mi', already formatted. */
  readonly dist: string;
  /** 'METCALF AVE at W 111TH ST'. */
  readonly street: string;
  /** 'faces w · on a pole', or '' when the archive carries neither. */
  readonly detail: string;
  readonly owner: ClosestOwner;
}

export interface ClosestPanelProps {
  /** '1.5 mi', already formatted - the design prints the unit inline. */
  readonly miles: string;
  /** 'METCALF AVE @ W 111TH' - the cross street, shrinks before the pill does. */
  readonly where: string;
  /** 'FLOCK SAFETY · traffic signal · faces SE' - brand, mount and facing. */
  readonly detail: string;
  /** '9 · within 5 mi' - the count beside the NEARBY label. */
  readonly nearbyCount: string;
  /** The compass, as the design's two glyphs. */
  readonly compass: string;

  readonly onRouteAround: () => void;
  /** The key's face: the design draws an arrow and a number, e.g. '9'. */
  readonly routeAroundCount: string;
  readonly routeAroundLabel: string;

  readonly onMute: () => void;
  readonly muted: boolean;
  readonly muteLabel: string;

  /**
   * THE LITTLE MAP OF THIS READER, handed in as a node.
   *
   * ONE instance, for the closest camera only - which is what it was before and
   * what worked. The rule this respects is that there is never one PER ROW:
   * `MiniMap` is a full MapLibre map, and eight of them evicted the scope's own
   * WebGL context and blacked out the real map.
   */
  readonly picture: ReactNode;
  /** Opens this camera's intel card. The whole reader box is the target. */
  readonly onOpen: () => void;
  readonly openLabel: string;

  readonly rows: readonly ClosestRow[];
  readonly onPick: (cameraId: string) => void;
  /** Said when there is no fix, or nothing within the radius. */
  readonly emptyNote: string | null;
}

export function ClosestPanel({
  miles,
  where,
  detail,
  nearbyCount,
  compass,
  picture,
  onOpen,
  openLabel,
  onRouteAround,
  routeAroundCount,
  routeAroundLabel,
  onMute,
  muted,
  muteLabel,
  rows,
  onPick,
  emptyNote,
}: ClosestPanelProps): ReactElement {
  return (
    <section className="fwm-closest" aria-label="Closest camera and what is nearby">
      <div className="fwm-closest-head">
        {/* THE PRESS OVER THE WHOLE BOX, and it sits OUTSIDE the picture rather
            than over it. A button inside an `aria-hidden` subtree is the worst
            of both - still reachable by keyboard, still invisible to a screen
            reader - so it is a sibling, stretched across the box behind the
            keys. The keys sit above it and take their own presses. */}
        <button
          type="button"
          className="fwm-closest-open"
          aria-label={openLabel}
          onClick={onOpen}
        />

        {/* THE LITTLE MAP OF THIS READER: where it is and which way it looks.
            A real picture, not a hatch - it is the one thing on the card that
            shows the facing cone. ONE instance, for the closest camera only;
            one per row is what blacked out the scope. */}
        <div className="fwm-closest-map" aria-hidden="true">
          {picture}
          <span className="fwm-closest-rose-slot fwm-data">{compass}</span>
        </div>

        <div className="fwm-closest-face">
          <p className="fwm-closest-figure-row">
            <span className="fwm-closest-figure fwm-data">{miles}</span>
            <span className="fwm-closest-where fwm-data">{where}</span>
            <span className="fwm-closest-chip fwm-data">{CLOSEST_CHIP}</span>
          </p>

          <p className="fwm-closest-detail fwm-data">{detail}</p>

          <div className="fwm-closest-keys">
            <span className="fwm-closest-nearby fwm-data">
              {CLOSEST_NEARBY}{' '}
              <span className="fwm-closest-nearby-count">{nearbyCount}</span>
            </span>

            <button
              type="button"
              className="fwm-closest-key"
              data-fwm-closest-key="route"
              aria-label={routeAroundLabel}
              onClick={onRouteAround}
            >
              {`➤ ${routeAroundCount}`}
            </button>

            {/* `aria-pressed` as well as the label: the name says what the press
                WILL do and the state says what is true now, and a driver using
                a screen reader is entitled to both without pressing anything. */}
            <button
              type="button"
              className="fwm-closest-key"
              data-fwm-closest-key="mute"
              aria-pressed={muted}
              aria-label={muteLabel}
              onClick={onMute}
            >
              {'⃠'}
            </button>
          </div>
        </div>
      </div>

      {emptyNote === null ? (
        <ul className="fwm-closest-list" aria-label="Cameras nearby">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="fwm-closest-row"
                onClick={() => {
                  onPick(row.id);
                }}
              >
                <span
                  className="fwm-closest-row-dot"
                  data-fwm-owner={row.owner}
                  aria-hidden="true"
                />
                <span className="fwm-closest-row-dist fwm-data">{row.dist}</span>
                <span className="fwm-closest-row-text fwm-data">
                  {row.street}
                  {row.detail === '' ? null : (
                    <span className="fwm-closest-row-detail">{` · ${row.detail}`}</span>
                  )}
                </span>
                <span className="fwm-closest-row-chevron" aria-hidden="true">
                  {'›'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fwm-closest-empty fwm-data">{emptyNote}</p>
      )}
    </section>
  );
}
