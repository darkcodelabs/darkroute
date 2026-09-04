/**
 * THE DETOUR OFFER - the one place a route may leave this phone.
 *
 * =============================================================================
 * WHY THERE IS A PROMPT AT ALL
 * =============================================================================
 * "Route around all 9" cannot be done on the device. There is no road graph
 * here and no routing engine, so the only way a driver gets a real detour is
 * for a maps app to build it - and the only handoff that can carry more than
 * one stop is an HTTPS directions URL (see `services/adapters/routeVia.ts`).
 * Opening that URL tells Google roughly where this car is and which way it is
 * pointing.
 *
 * That is in direct tension with what this product is for, and it is not a
 * tension the code can resolve on the driver's behalf. Some drivers will trade
 * that disclosure for a route around nine readers; some will not; the app does
 * not know which one is holding the phone. So it asks, in plain words, every
 * time, and it says exactly what would be sent and to whom.
 *
 * =============================================================================
 * THE THREE RULES THIS SURFACE IS BUILT ON
 * =============================================================================
 * NOTHING LEAVES UNTIL A KEY IS PRESSED. The plan is arithmetic on the device.
 * `routeVia` is called from one handler on this screen and from nowhere else in
 * the app, so "did anything get sent" is answerable by reading one function.
 *
 * NO IS FREE, AND IT IS WHAT DOING NOTHING GIVES YOU. Escape, the close key,
 * the refusal key and simply walking away are the same outcome, and that
 * outcome is silence. There is no timeout that proceeds.
 *
 * THERE IS NO REMEMBERED ANSWER. A "don't ask again" here would be a switch
 * that quietly turns a counter-surveillance app into one that pings Google
 * whenever a driver taps the biggest key on the screen. The prompt says so, so
 * that a driver who presses it twenty times knows the twentieth was as
 * deliberate as the first.
 *
 * =============================================================================
 * AND WHEN THERE IS NO ROUTE, IT SAYS THAT INSTEAD
 * =============================================================================
 * `features/radar/reroute.ts` carries the report this avoids: a key drawn at
 * full strength that silently does nothing, on a road where the honest
 * behaviour and a broken control look identical. Every press of the key raises
 * this surface. If `planDriveDetour` refused, this is where the reason is
 * printed - and there is no send key on it, because there is nothing to send.
 */

import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';

import { OverlayClose } from '../../components/overlay/OverlayClose.tsx';
import { useOverlayDismiss } from '../../components/overlay/useOverlayDismiss.ts';
import { navigationActions } from '../../stores/index.ts';
import type { Overlay } from '../../stores/index.ts';
import { MAX_HANDOFF_WAYPOINTS } from '../../stores/fwmCore.ts';
import { ROUTE_VIA_SERVICE, routeVia } from '../../services/adapters/routeVia.ts';
import type { RouteViaOutcome } from '../../services/adapters/routeVia.ts';

import type { DetourOutcome, DetourRefusal } from './detour.ts';

import './detourOffer.css';

/**
 * The overlay DRIVE raises. `modal`, not `sheet`: it is a question with two
 * answers, not a drawer that can be left half open behind the map.
 *
 * The id is not a screen id. Nothing deep-links here - the offer only exists
 * for as long as the position it was computed from is current, so a URL that
 * restored it would restore a stale route.
 */
export const DETOUR_OVERLAY: Overlay = Object.freeze({ id: 'detour', kind: 'modal' });

/**
 * The pending offer.
 *
 * A MODULE VARIABLE AND NOT THE OVERLAY. `Overlay` is deliberately
 * payload-free - see `app/screenState.ts` - because overlays are written into
 * `history.state`, and this payload is a set of points derived from where the
 * car is right now. INTEL keeps its camera id in a store for the same reason
 * and this keeps its route here, on the device, in memory, for the life of one
 * question.
 */
let pending: DetourOutcome | null = null;

/** Raise the offer. This is DRIVE's `Route around all N` handler. */
export function offerDetour(outcome: DetourOutcome): void {
  pending = outcome;
  navigationActions.openOverlay(DETOUR_OVERLAY);
}

/** What was planned, or null once the question has been answered. */
export function pendingDetour(): DetourOutcome | null {
  return pending;
}

/**
 * Put it away, and drop the route with it.
 *
 * The clear is the point, not tidiness. The plan describes where this car was
 * and where it was going at one moment; it goes stale in seconds and it is
 * nobody's business afterwards, so it does not outlive the surface that asked
 * about it. Pressing the key again re-plans from the live fix.
 */
export function closeDetourOffer(): void {
  pending = null;
  navigationActions.closeOverlay(DETOUR_OVERLAY.id);
}

export const DETOUR_LABEL = 'route around';

export const DETOUR_TITLE = `Send this detour to ${ROUTE_VIA_SERVICE}?`;
export const DETOUR_NONE_TITLE = 'Nothing to route around';

/** What the route IS, before anything about what it costs. */
export function detourPlanLine(stops: number, clearanceFt: number): string {
  const word = stops === 1 ? 'stop' : 'stops';
  return (
    `${String(stops)} ${word}, each put about ${String(clearanceFt)} ft to the clear side of the ` +
    'cameras it steers you around, and then back out onto the road just past the last one this ' +
    'phone knows about. it ends there because the app does not know where you are going.'
  );
}

/**
 * The berth that was actually achieved, which is not always the one asked for.
 *
 * A cluster's stop is placed off the far side of the cluster's MEAN, so a
 * camera at the near edge of a tight group can end up closer than the berth.
 * Printing the measured number rather than restating the request is the
 * difference between a fact and a promise.
 */
export function detourClosestLine(closestFt: number): string {
  const ft = Math.round(closestFt / 10) * 10;
  return `measured: the nearest any of these stops comes to a known camera is ${String(ft)} ft.`;
}

export function detourUnavoidableLine(count: number): string {
  const one = count === 1;
  return (
    `${String(count)} of the cameras ahead ${one ? 'sits' : 'sit'} on the road itself. moving the ` +
    `route sideways cannot clear ${one ? 'it' : 'them'}, so this detour does not: you will pass ` +
    `${one ? 'it' : 'them'}.`
  );
}

export function detourDroppedLine(count: number): string {
  const one = count === 1;
  return (
    `a maps link carries ${String(MAX_HANDOFF_WAYPOINTS)} stops at most, so ${String(count)} ` +
    `further ${one ? 'group' : 'groups'} of cameras ${one ? 'is' : 'are'} not in this route.`
  );
}

export const DETOUR_DISCLOSURE_LABEL = 'WHAT LEAVES THIS PHONE';

/**
 * THE SENTENCE THE WHOLE FEATURE TURNS ON.
 *
 * It has to be true in both directions. The link genuinely does not carry the
 * driver's position - `routeVia` sends no origin, and every point in it is one
 * this app computed - and saying only that would be the kind of true sentence
 * that leaves a false impression, because a stop 1000 ft to your left and an
 * end point a mile up your heading bound where you are perfectly well.
 */
export const DETOUR_DISCLOSURE =
  `${ROUTE_VIA_SERVICE} receives the stops and the point this route ends at. none of them is a ` +
  'place you have been - every one is a point this app worked out - but together they say ' +
  'roughly where you are now and which way you are going. your own position is not in the link: ' +
  'your maps app already has it, under its own permission. nothing in the link says these points ' +
  'have anything to do with cameras.';

export const DETOUR_LIMIT_LABEL = 'WHAT IT IS NOT';

/** `packages/core/src/avoidance.ts` says this first. It is repeated to the driver. */
export const DETOUR_LIMIT =
  'this app has no road map, so a stop can land in a field, in a river, or on the far side of a ' +
  'divided road. your maps app will route to the nearest driveable point instead, and that can ' +
  'be back past the camera. these are points to prefer, not a clear road.';

export const DETOUR_SEND = `Open ${ROUTE_VIA_SERVICE}`;
export const DETOUR_CANCEL = 'No, send nothing';
export const DETOUR_CLOSE = 'Close';

export const DETOUR_ASKED_EVERY_TIME =
  'nothing has left this phone yet, and nothing does unless you press the first key. you will be ' +
  'asked again next time - there is no remembered answer.';

/** Said when the handoff itself failed, rather than closing as if it worked. */
export const DETOUR_UNAVAILABLE = 'this browser would not open the link, so nothing was sent.';
export const DETOUR_INVALID = 'this route could not be made into a link, so nothing was sent.';

/**
 * Said when the overlay is on screen with no offer behind it.
 *
 * Reachable: `openOverlay` writes the stack into `history.state`, so a forward
 * gesture can put this back up after `closeDetourOffer` has dropped the route.
 * Re-planning silently from the current fix would answer a question the driver
 * asked at a different place on the road.
 */
export const DETOUR_EXPIRED =
  'this offer is gone. it was worked out from where you were the moment you pressed the key and ' +
  'it is not kept, so press Route around again.';

export function detourRefusalLine(
  reason: DetourRefusal,
  unavoidable: number,
  clearanceFt: number,
): string {
  switch (reason) {
    case 'no-fix':
      return 'there is no gps fix yet, so there is no line to plan a way around.';
    case 'no-heading':
      return (
        'this phone has not seen you moving, so there is no ahead. a detour needs a direction, ' +
        'and the heading a parked car reports is noise rather than a course.'
      );
    case 'nothing-ahead':
      return 'no cameras are being tracked right now, so there is nothing to route around.';
    case 'already-clear':
      return (
        `every camera ahead is already more than ${String(clearanceFt)} ft off the line you are ` +
        'travelling. a detour would not put more room between you and them.'
      );
    case 'all-unavoidable':
      return (
        `all ${String(unavoidable)} of the cameras ahead sit on the road you are on. moving a ` +
        'route sideways cannot clear a camera that is on it, so there is no detour to send.'
      );
  }
}

export function DetourOffer(): ReactElement {
  /*
   * READ ONCE, AT MOUNT. `closeDetourOffer` clears the module variable and
   * pops the overlay in the same call, and a component that re-read the
   * variable on every render could paint the expired state for a frame on its
   * way out. Same reasoning as `openerAtMount` in `useOverlayDismiss`.
   */
  const [offer] = useState<DetourOutcome | null>(pendingDetour);
  const [failure, setFailure] = useState<RouteViaOutcome | null>(null);

  /** Escape, the close key and the refusal key all land here. */
  const dismiss = useOverlayDismiss(closeDetourOffer);

  const send = useCallback(() => {
    if (offer === null || offer.kind !== 'route') return;
    const outcome = routeVia({ destination: offer.to, via: offer.plan.waypoints });
    if (outcome === 'opened') {
      dismiss();
      return;
    }
    // NOT dismissed. A prompt that vanishes after a handoff that did not
    // happen leaves the driver believing a route is open in another app.
    setFailure(outcome);
  }, [offer, dismiss]);

  /*
   * The two halves, narrowed once. `offer` is also allowed to be null - the
   * overlay can be re-raised by a forward gesture after the route was dropped
   * - and that is a third state with its own sentence, not an empty route.
   */
  const route = offer?.kind === 'route' ? offer : null;
  const refusal = offer?.kind === 'none' ? offer : null;

  return (
    <section className="fwm-detour" aria-label={DETOUR_LABEL}>
      <div className="fwm-detour-head">
        <h1 className="fwm-detour-title">
          {route === null ? DETOUR_NONE_TITLE : DETOUR_TITLE}
        </h1>
        {/* The same close key every overlay draws. See OverlayClose.tsx. */}
        <OverlayClose onClose={dismiss} />
      </div>

      {route === null ? (
        <>
          <p className="fwm-detour-lead">
            {refusal === null
              ? DETOUR_EXPIRED
              : detourRefusalLine(refusal.reason, refusal.unavoidable, refusal.clearanceFt)}
          </p>
          {/* NO SEND KEY. There is no route, so there is nothing to consent
              to, and a greyed-out primary would only invite a press. */}
          <button type="button" className="fwm-detour-key" onClick={dismiss}>
            {DETOUR_CLOSE}
          </button>
        </>
      ) : (
        <>
          <p className="fwm-detour-lead">
            {detourPlanLine(route.plan.waypoints.length, route.plan.clearanceFt)}
          </p>

          {route.closestFt === null ? null : (
            <p className="fwm-detour-note fwm-data">{detourClosestLine(route.closestFt)}</p>
          )}

          {/* THE TWO HONEST SUBTRACTIONS, drawn only when they are non-zero.
              A camera on the road and a camera past the link's stop limit are
              both cameras this route does not help with, and a driver who
              learns that from the road rather than from the prompt has been
              sold something. */}
          {route.plan.unavoidable === 0 ? null : (
            <p className="fwm-detour-warn">{detourUnavoidableLine(route.plan.unavoidable)}</p>
          )}
          {route.plan.dropped === 0 ? null : (
            <p className="fwm-detour-warn">{detourDroppedLine(route.plan.dropped)}</p>
          )}

          <div className="fwm-detour-block">
            <p className="fwm-detour-block-label fwm-data">{DETOUR_DISCLOSURE_LABEL}</p>
            <p className="fwm-detour-block-body">{DETOUR_DISCLOSURE}</p>
          </div>

          <div className="fwm-detour-block">
            <p className="fwm-detour-block-label fwm-data">{DETOUR_LIMIT_LABEL}</p>
            <p className="fwm-detour-block-body">{DETOUR_LIMIT}</p>
          </div>

          {failure === null ? null : (
            <p className="fwm-detour-note fwm-data" role="status">
              {failure === 'invalid' ? DETOUR_INVALID : DETOUR_UNAVAILABLE}
            </p>
          )}

          <button
            type="button"
            className="fwm-detour-key"
            data-fwm-key="primary"
            onClick={send}
          >
            {DETOUR_SEND}
          </button>
          {/* OUTLINED, NOT GREYED - the install invite's rule, and the same
              reason. Refusing is a real answer and the better one for plenty
              of drivers, so it is not styled as the mistake. */}
          <button type="button" className="fwm-detour-key" onClick={dismiss}>
            {DETOUR_CANCEL}
          </button>
          <p className="fwm-detour-note fwm-data">{DETOUR_ASKED_EVERY_TIME}</p>
        </>
      )}
    </section>
  );
}
