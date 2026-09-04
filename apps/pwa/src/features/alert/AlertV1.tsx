/**
 * THE ALERT - v1. The full-screen takeover.
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isAlert` block.
 *
 * =============================================================================
 * THIS IS THE ONE v1 SURFACE WITH NO v0 COUNTERPART
 * =============================================================================
 * v0 has no alert LAYER. Its takeover is an attribute on `RadarView` -
 * `[data-fwm-radar-takeover="true"]`, which `radar.css` turns into an opaque
 * fill over RADAR - so a driver on LOG, MESH or SETTINGS when a camera comes
 * into range gets nothing at all. That was survivable while RADAR was where
 * everybody was; v1's dock has five destinations and a hub behind one of them,
 * so it stopped being survivable.
 *
 * So this is registered as App's `alertLayer`, which paints over the screen AND
 * over any open sheet, on every screen, and it is the reason
 * `presentation() === 'camera-alert'` now has something to draw.
 *
 * =============================================================================
 * WHAT IT SAYS, AND WHAT IT REFUSES TO SAY
 * =============================================================================
 * The design writes "0.2 / miles ahead, right side / Police agency camera on
 * Peachtree. About 18 seconds."
 *
 * Distance is real. Side is real WHEN THERE IS A HEADING - `relativeDirection`
 * is null without one, and this drops the side rather than guessing it, because
 * "right side" told to a driver whose camera is on the left is worse than no
 * side at all. The seconds are the same `etaSeconds` DRIVE uses, which returns
 * null when stopped, when there is no speed, or when the gap is not closing.
 *
 * REROUTE IS NOT DRAWN. The design's first key hands the camera to a maps app
 * as a waypoint to AVOID, and no maps app takes an avoid-this waypoint from a
 * URL - `navigateTo` can only route somebody TO a point, which on this screen
 * is the opposite of what the key promises. SILENCE is real and is the key
 * that ships.
 * GAP: docs/gaps-inbox/alert-v1.md#reroute-is-drawn-and-is-not-implemented -
 * reroute needs a routing engine, not a link.
 */

import { useCallback } from 'react';
import type { ReactElement } from 'react';

import {
  alertActions,
  useAlertTakeover,
  useCameraAssessments,
  useCachedCameras,
  useIsClosing,
  useMuteRemainingMs,
  useSpeedMph,
} from '../../stores/index.ts';
import { describeEta, etaSeconds } from '../drive/eta.ts';

import './alertV1.css';

export const ALERT_EYEBROW = 'DARKROUTE';
export const SILENCE_LABEL = 'Silence 10 min';
export const DISMISS_HINT = 'TAP ANYWHERE TO DISMISS';

/** How the side reads, when there is a heading to work it out from. */
export const SIDE_LABEL = {
  ahead: 'straight ahead',
  left: 'on your left',
  right: 'on your right',
  behind: 'behind you',
} as const;

/** Said in place of the side when the platform gave no heading. */
export const NO_SIDE = 'ahead on your route';

/** Feet in a mile, for the headline figure. */
const FT_PER_MILE = 5280;

/** Below this the headline reads in feet; a fraction of a mile is not a distance. */
const MILE_FLOOR_FT = 1000;

export function AlertV1(): ReactElement | null {
  const takeover = useAlertTakeover();
  const assessments = useCameraAssessments();
  const cameras = useCachedCameras();
  const speedMph = useSpeedMph();
  const closing = useIsClosing();
  const mutedMs = useMuteRemainingMs();

  const silence = useCallback(() => {
    alertActions.muteAll(Date.now());
  }, []);

  const dismiss = useCallback(() => {
    // Dismissing is silencing. There is no third state: a takeover that closes
    // without muting re-raises itself on the next tick, which is a driver
    // tapping the same screen every two seconds at 60 mph.
    alertActions.muteAll(Date.now());
  }, []);

  if (!takeover.active) return null;

  const cameraId = takeover.cameraId;
  const assessment =
    cameraId === null ? null : (assessments.find((entry) => entry.id === cameraId) ?? null);

  // Null is a real outcome: the takeover can be live for a camera whose record
  // has already left the cache. The screen still warns; it just cannot name it.
  const record = cameraId === null ? null : (cameras.find((cam) => cam.id === cameraId) ?? null);

  const distanceFt = assessment?.distanceFt ?? null;
  const useMiles = distanceFt !== null && distanceFt >= MILE_FLOOR_FT;
  const figure =
    distanceFt === null
      ? '—'
      : useMiles
        ? (distanceFt / FT_PER_MILE).toFixed(1)
        : String(Math.round(distanceFt));

  const side =
    assessment?.relativeDirection === null || assessment?.relativeDirection === undefined
      ? NO_SIDE
      : SIDE_LABEL[assessment.relativeDirection];

  const eta = describeEta(
    etaSeconds({
      distanceFt,
      speedMph,
      // The engine's own reading of whether the gap is shrinking. Null when it
      // cannot tell, which `etaSeconds` treats as "say nothing" rather than as
      // "not closing" - a countdown withheld is better than one that is wrong.
      closing,
    }),
  );

  /**
   * THE CORNER, not just the road.
   *
   * This read `street` alone, and a cross street is exactly the fact a takeover
   * is for: "on METCALF AVE" is a four-mile road, "on METCALF AVE at W 95TH ST"
   * is a place. The archive carries a cross street on 64.29% of records, so
   * this dropped the useful half of the location on two thirds of alerts.
   *
   * Same nested form DRIVE has always used, deliberately WITHOUT its 'unnamed
   * road' fallback: on a takeover a missing street drops the clause, and the
   * join below already does that. A placeholder here would print a phrase about
   * a road nobody named, in the largest text on the screen, while the driver is
   * looking at the road.
   */
  const where =
    record === undefined || record === null || record.street === undefined
      ? null
      : record.cross === undefined
        ? record.street
        : `${record.street} at ${record.cross}`;

  return (
    <section
      className="fwm-alertv1"
      data-fwm-state={takeover.state}
      aria-label="camera alert"
      role="alertdialog"
      aria-live="assertive"
    >
      <p className="fwm-alertv1-eyebrow fwm-data">{ALERT_EYEBROW}</p>

      <div className="fwm-alertv1-body">
        <p className="fwm-alertv1-figure">{figure}</p>
        <p className="fwm-alertv1-headline">
          {useMiles ? 'miles' : 'feet'} {side}
        </p>
        <p className="fwm-alertv1-detail fwm-data">
          {[where === null ? null : `on ${where}`, eta]
            .filter((part): part is string => part !== null)
            .join(' · ')}
        </p>
      </div>

      <div className="fwm-alertv1-keys">
        {/* One key. See the header for why REROUTE is not drawn. */}
        <button type="button" className="fwm-alertv1-key" onClick={silence}>
          {SILENCE_LABEL}
        </button>
      </div>

      {/* The whole surface is the dismiss target, which is what a driver's
          thumb will find without looking. The line says so. */}
      <button type="button" className="fwm-alertv1-scrim" aria-label="dismiss" onClick={dismiss} />
      <p className="fwm-alertv1-hint fwm-data">
        {mutedMs > 0 ? 'ALREADY SILENCED' : DISMISS_HINT}
      </p>
    </section>
  );
}
