/**
 * THE DETOUR OFFER - the one place a route leaves this phone.
 *
 * =============================================================================
 * WHAT THIS SURFACE USED TO BE, AND WHY IT CHANGED
 * =============================================================================
 * It used to say "Send this detour to Google Maps?", because there was no
 * routing engine within reach and the only handoff that could carry more than
 * one stop was an HTTPS directions URL. Pressing the key told Google roughly
 * where this car was and which way it was pointing.
 *
 * DarkRoute routes for itself now. `functions/api/v1/route.ts` asks
 * OpenStreetMap's router on the app's behalf, with each reader as a polygon it
 * may not enter, and the line is drawn on this app's own map. Nothing is handed
 * to a maps company, and the difference is not cosmetic: a via-point says "go
 * through here", and what a driver wants is "do not go through there".
 *
 * =============================================================================
 * SO WHY IS THERE STILL A PROMPT
 * =============================================================================
 * Because a route request still leaves the phone, and what it carries is the
 * most sensitive thing this application computes: the driver's position and
 * where they are going, in one payload. It goes to our own endpoint rather than
 * a third party's, which is better and is not the same as nothing.
 *
 * That is not a tension the code can resolve on the driver's behalf. So it
 * asks, in plain words, every time, and it says exactly what would be sent and
 * to whom - the difference from before being that the answer is now
 * `darkroute.ai` and the reasons to trust it are code in a public repository
 * rather than a company's policy page.
 *
 * =============================================================================
 * THE THREE RULES THIS SURFACE IS BUILT ON
 * =============================================================================
 * NOTHING LEAVES UNTIL A KEY IS PRESSED. The plan is arithmetic on the device.
 * The request is made from one handler on this screen, so "did anything get
 * sent" is answerable by reading one function.
 *
 * NO IS FREE, AND IT IS WHAT DOING NOTHING GIVES YOU. Escape, the close key,
 * the refusal key and simply walking away are the same outcome, and that
 * outcome is silence. There is no timeout that proceeds.
 *
 * THERE IS NO REMEMBERED ANSWER. A "don't ask again" here would be a switch
 * that quietly turns a counter-surveillance app into one that transmits a
 * position whenever a driver taps the biggest key on the screen. The prompt
 * says so, so that a driver who presses it twenty times knows the twentieth was
 * as deliberate as the first.
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
import { planDarkRoute } from '../../services/route/darkRoute.ts';
import { RouteRefused } from '../../services/route/planRoute.ts';
import { routeActions } from '../../stores/route.ts';

import type { CameraRecord } from '../../stores/cameras.ts';
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

/**
 * WHERE THE CAR IS AND WHAT IT IS STEERING AROUND, captured with the plan.
 *
 * The request needs an origin and a list of readers, and only DRIVE has either.
 * Captured at the MOMENT THE KEY WAS PRESSED rather than read live when the
 * driver answers: the question was asked about a place on the road, and
 * answering it thirty seconds later must not silently re-aim it from wherever
 * the car has got to since.
 */
export interface DetourContext {
  readonly from: { readonly lat: number; readonly lon: number };
  /**
   * EVERY camera on the phone, not just the ones ahead.
   *
   * The planner measures its own line against these after each round - a route
   * bent around the readers ahead of you is a different road with its own
   * readers on it, and handing over only the original list is how a build
   * shipped "2 avoided" over a line that passed nine.
   */
  readonly cameras: readonly CameraRecord[];
}

let pendingContext: DetourContext | null = null;

/** Raise the offer. This is DRIVE's `Route around all N` handler. */
export function offerDetour(outcome: DetourOutcome, context: DetourContext | null = null): void {
  pending = outcome;
  pendingContext = context;
  navigationActions.openOverlay(DETOUR_OVERLAY);
}

/** What was planned, or null once the question has been answered. */
export function pendingDetour(): DetourOutcome | null {
  return pending;
}

export function pendingDetourContext(): DetourContext | null {
  return pendingContext;
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
  pendingContext = null;
  navigationActions.closeOverlay(DETOUR_OVERLAY.id);
}

export const DETOUR_LABEL = 'route around';

export const DETOUR_TITLE = 'Plan this detour?';
export const DETOUR_NONE_TITLE = 'Nothing to route around';

/**
 * What the route IS, before anything about what it costs.
 *
 * =============================================================================
 * IT HAS TO SAY HOW MANY CAMERAS, NOT JUST HOW MANY STOPS
 * =============================================================================
 * The key says "Route around all 9". The planner GROUPS cameras that sit close
 * together along the line and gives each group one waypoint, so nine cameras
 * within a couple of blocks correctly produce ONE stop - see
 * `planDetour` in `packages/core/src/avoidance.ts`.
 *
 * This line used to say "1 stop" and stop there. A driver who pressed a key
 * promising nine, read "1 stop", and then saw a single via-point in their maps
 * app had every reason to conclude the feature had quietly done one camera and
 * dropped the other eight. It had not. The arithmetic was right and unstated,
 * which from the outside is indistinguishable from being wrong.
 *
 * So the count of cameras is carried here and reconciled out loud.
 */
export function detourPlanLine(stops: number, clearanceFt: number, cameras: number): string {
  const tail =
    `and then back out onto the road just past the last one this phone knows about. it ends ` +
    'there because the app does not know where you are going.';
  const berth = `about ${String(clearanceFt)} ft to the clear side`;

  if (stops === 1) {
    return (
      `1 stop, and it clears ${cameras === 1 ? 'the camera' : `all ${String(cameras)} cameras`} ` +
      `ahead of you${
        cameras === 1
          ? ''
          : ' - they sit close enough together along your line that one detour takes the route ' +
            'past every one of them'
      }. it goes ${berth}, ${tail}`
    );
  }
  if (stops === cameras) {
    return `${String(stops)} stops, one for each camera ahead, each ${berth} of it, ${tail}`;
  }
  return (
    `${String(stops)} stops covering all ${String(cameras)} cameras ahead - the ones close ` +
    `together share a stop - each put ${berth} of the cameras it steers you around, ${tail}`
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
 * It has to be true in both directions, and it got HARDER to write when the
 * handoff was replaced. The old version could truthfully say the link carried
 * no origin. This one cannot: the request carries the live fix, because that is
 * what a router needs to route from.
 *
 * So it says that first, plainly, before saying who receives it - a disclosure
 * that leads with the reassuring half and buries the payload is the shape of a
 * privacy policy, not of an honest question.
 */
export const DETOUR_DISCLOSURE =
  'this sends your position, the point this route ends at, and the cameras to steer around - to ' +
  'darkroute.ai, which asks an OpenStreetMap router on your behalf so the router is handed ' +
  'coordinates by a server rather than by your phone. nothing goes to a maps company. the ' +
  'request is not logged and the answer is not cached. that is a promise about code you can ' +
  'read, which is the most any of this can honestly be.';

export const DETOUR_LIMIT_LABEL = 'WHAT IT IS NOT';

/**
 * WHAT IT IS NOT, and this changed with the router.
 *
 * The old warning was that the app had no road map, so a computed stop could
 * land in a field and a maps app would route to the nearest driveable point -
 * possibly back past the camera. A real router solves over real roads, so that
 * particular failure is gone.
 *
 * What replaces it is smaller and still worth saying: an exclusion is a box
 * around a mapped reader, so this avoids the cameras the archive KNOWS about,
 * and a reader nobody has mapped is one it will drive you straight past.
 */
export const DETOUR_LIMIT =
  'this steers around the cameras in the archive. a reader nobody has mapped yet is one it ' +
  'cannot know to avoid, and in a dense area there may be no legal route that clears all of ' +
  'them - if so it will say that rather than pretend.';

export const DETOUR_SEND = 'Plan it';
export const DETOUR_CANCEL = 'No, send nothing';
export const DETOUR_CLOSE = 'Close';

export const DETOUR_ASKED_EVERY_TIME =
  'nothing has left this phone yet, and nothing does unless you press the first key. you will be ' +
  'asked again next time - there is no remembered answer.';

/** Said when the request itself failed, rather than closing as if it worked. */
export const DETOUR_UNAVAILABLE = 'that route could not be planned, so nothing is on the map.';
export const DETOUR_PLANNING = 'Planning…';
/** What the destination is called on the card once this route is planned. */
export function detourDestinationName(count: number): string {
  return count === 1 ? 'Around 1 reader' : `Around ${String(count)} readers`;
}

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
  const [context] = useState<DetourContext | null>(pendingDetourContext);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  /** Escape, the close key and the refusal key all land here. */
  const dismiss = useOverlayDismiss(closeDetourOffer);

  const send = useCallback(() => {
    if (offer === null || offer.kind !== 'route' || context === null || sending) return;
    setSending(true);
    setFailure(null);

    /*
     * The destination goes in FIRST, so the card is on screen showing
     * "planning" while the request is in flight. Setting it also clears any
     * previous route, which is right: this is a different drive.
     */
    routeActions.setDestination({
      name: detourDestinationName(offer.plan.consideredCameras),
      detail: '',
      lat: offer.to.lat,
      lon: offer.to.lon,
    });
    routeActions.planning();

    planDarkRoute({ from: context.from, to: offer.to, cameras: context.cameras })
      .then((built) => {
        routeActions.planned(built.route, built.avoided, built.remaining);
        dismiss();
      })
      .catch((cause: unknown) => {
        /*
         * NOT dismissed, and the reason is on this surface rather than only on
         * the card behind it: a prompt that vanishes after a request that did
         * not happen leaves the driver believing a route is up.
         *
         * The server's own sentence where there is one - "no driving route
         * avoids all of those" is a real answer that names what to do next.
         */
        const detail =
          cause instanceof RouteRefused ? cause.message : DETOUR_UNAVAILABLE;
        setFailure(detail);
        routeActions.failed(detail);
      })
      .finally(() => {
        setSending(false);
      });
  }, [offer, context, sending, dismiss]);

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
            {detourPlanLine(
              route.plan.waypoints.length,
              route.plan.clearanceFt,
              route.plan.consideredCameras,
            )}
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
              {failure}
            </p>
          )}

          <button
            type="button"
            className="fwm-detour-key"
            data-fwm-key="primary"
            disabled={sending}
            onClick={send}
          >
            {sending ? DETOUR_PLANNING : DETOUR_SEND}
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
