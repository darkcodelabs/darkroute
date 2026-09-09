/**
 * THE ALERT - v1. The full-screen takeover.
 *
 * SOURCE: the owner's reference render, `mapcards/alert_card.png`, which
 * replaced the four-line takeover this file used to draw.
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
 * PORTRAIT IS THE TARGET, NOT THE FALLBACK
 * =============================================================================
 * The reference render is tall, and a tall render laid out literally puts the
 * two keys below the fold on a phone - a takeover whose dismiss cannot be
 * reached is a takeover that cannot be dismissed, which on this surface is the
 * whole product failing. So the card is split in two: a HEAD that never scrolls
 * (kind, the distance figure, the street, the ETA line) and a BODY that does
 * (the facts, the picture, the two panels). The keys and the hint are siblings
 * of the card, outside its scroll, so they are on screen at every height.
 *
 * WHAT GIVES WAY ON A SHORT SCREEN, in order: the picture shrinks, then the
 * figure steps down a size, then the body scrolls. What never gives way is the
 * figure itself and the two keys. `alertV1.css` carries the arithmetic.
 *
 * =============================================================================
 * WHAT IT SAYS, AND WHAT IT REFUSES TO SAY
 * =============================================================================
 * Distance is real. Side is real WHEN THERE IS A HEADING - `relativeDirection`
 * is null without one, and this drops the side rather than guessing it, because
 * "right side" told to a driver whose camera is on the left is worse than no
 * side at all. The seconds are the same `etaSeconds` DRIVE uses, which returns
 * null when stopped, when there is no speed, or when the gap is not closing.
 *
 * Every fact below the figure is drawn only when the record actually carries
 * it. A takeover can be live for a camera whose record has already left the
 * cache - the alert engine measures positions, not records - and on that
 * takeover the street, the operator, the mount and both panels are simply
 * absent. There is no em-dash row here, which is a deliberate difference from
 * the INTEL card: that card is read stopped, where "unknown" is information,
 * and this one is read at 60 mph, where a column of dashes is noise over the
 * one number that matters.
 *
 * =============================================================================
 * REROUTE IS DRAWN NOW, AND IT IS REAL
 * =============================================================================
 * This file used to say REROUTE could not ship because "no maps app takes an
 * avoid-this waypoint from a URL". That was true of `navigateTo` and is no
 * longer the state of the app: the detour work gave DRIVE a device-side planner
 * (`planDriveDetour`) and a consent surface (`offerDetour`) that hands a
 * multi-stop route over only after an explicit yes. The key calls exactly that
 * pair, so the two surfaces cannot plan differently for the same drive.
 *
 * It SILENCES FIRST. This layer paints over every overlay by construction, so
 * an offer raised underneath it would be an invisible modal - the driver would
 * press REROUTE and watch nothing happen.
 */

import { useCallback, useMemo, useRef } from 'react';
import type { ReactElement, TouchEvent } from 'react';

import {
  alertActions,
  useAlertLog,
  useAlertTakeover,
  useCameraAssessments,
  useCachedCameras,
  useCurrentFix,
  useHeadingDeg,
  useIsClosing,
  useMuteRemainingMs,
  useSpeedMph,
} from '../../stores/index.ts';
import type { CameraRecord } from '../../stores/index.ts';
import { describeEta, etaSeconds } from '../drive/eta.ts';
import { planDriveDetour } from '../drive/detour.ts';
import { offerDetour } from '../drive/DetourOffer.tsx';
import { useSteadyHeading } from '../drive/steady.ts';
import { chipLabel, makerOf, mountOf, mountPhrase, readableTag } from '../intel/describe.ts';
import { openIntelCard } from '../intel/IntelScreen.tsx';
import {
  OWNER_LABEL,
  coveredDirections,
  dataAsOf,
  formatCoveredDirections,
  intelReads,
  tagValue,
} from '../intel/intelState.ts';
import { LazyMiniMap as MiniMap } from '../map/LazyMiniMap.tsx';
import { facingSpans } from '../map/miniMap.ts';
import { formatCoordinates } from '../radar/format.ts';
import { facingCardinal, laneCovered } from '../report/reportDraft.ts';

import './alertV1.css';

export const ALERT_EYEBROW = 'DARKROUTE';
export const LIVE_LABEL = 'LIVE ALERT';
export const SILENCE_LABEL = 'Silence 10 min';
export const SILENCE_SUB = 'Hide alerts for 10 minutes';
export const REROUTE_LABEL = 'Reroute';
export const REROUTE_SUB = 'Find an alternate route';
export const VIEW_ON_MAP = 'View on map';
/* Both name what pressing them BUYS, not what they are. Ten minutes is the
   figure every other closure on this surface already quotes. */
export const ALERT_MUTE_LABEL = 'Silence 10 minutes';
export const ALERT_CLOSE_LABEL = 'Close and silence 10 minutes';
export const DETAILS_TITLE = 'CAMERA DETAILS';
export const COMMUNITY_TITLE = 'COMMUNITY INFO';
export const ALREADY_SILENCED = 'Already silenced';

/**
 * The line under the keys.
 *
 * It used to read TAP ANYWHERE TO DISMISS, and that stopped being true the
 * moment the card grew controls: a tap that lands on VIEW ON MAP or on a panel
 * must not also close the screen. The surface outside the card still dismisses
 * - see the scrim - and a downward swipe dismisses from anywhere that is not
 * the scrolling body, which is the gesture the render names and the one a thumb
 * makes without aiming.
 */
export const DISMISS_HINT = 'Swipe down to dismiss';

/* Drawn, never a text character - a font without a glyph substitutes a box, and
   these are the two controls the whole surface can be closed with. */
const MuteGlyph = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M11 5 6.5 9H4v6h2.5L11 19z"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinejoin="round"
    />
    <path d="M16 9.5l4 5M20 9.5l-4 5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
  </svg>
);

const CloseGlyph = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" />
  </svg>
);

/** How the side reads, when there is a heading to work it out from. */
export const SIDE_LABEL = {
  ahead: 'straight ahead',
  left: 'on your left',
  right: 'on your right',
  behind: 'behind you',
} as const;

/** Said in place of the side when the platform gave no heading. */
export const NO_SIDE = 'ahead on your route';

/** What the kind row says when the record is gone. See the header. */
export const KIND_FALLBACK = 'CAMERA';

/** Feet in a mile, for the headline figure. */
const FT_PER_MILE = 5280;

/** Below this the headline reads in feet; a fraction of a mile is not a distance. */
const MILE_FLOOR_FT = 1000;

/**
 * How far down a touch must travel to count as the dismiss swipe, in CSS px.
 *
 * Two touch targets. Under one, a thumb settling on the screen while the car
 * moves closes the warning it just raised; much over two and the gesture stops
 * being reachable one-handed on a phone in a mount.
 */
const SWIPE_DISMISS_PX = 88;

/** The overlay's own coordinate space - the SAME box `MiniMap` draws its mark
 *  in, so the two SVGs stack exactly. See `MiniMap`'s VIEW_BOX. */
const MAP_BOX = '-50 -50 100 100';

/**
 * WHERE THE VEHICLE MARK SITS, and why it is not to scale.
 *
 * The picture is centred on the CAMERA at a fixed zoom, so the vehicle's true
 * position is a bearing and a distance away from the middle - and converting
 * that distance into box units needs the box's ground span, which depends on
 * how many CSS pixels the browser gave it. Nothing in the DOM knows that
 * without measuring, and a mark placed at a guessed scale is a lie about how
 * far away the camera is, told next to a number that states it exactly.
 *
 * So the mark carries the DIRECTION only, at a fixed radius just inside the
 * frame, and the distance stays where it is honest: the figure at the top of
 * the card, and the chip beside this mark.
 */
const VEHICLE_RADIUS = 34;

/** A compass bearing as a point in {@link MAP_BOX}: 0 is north and north is up. */
function bearingPoint(deg: number, radius: number): { readonly x: number; readonly y: number } {
  const radians = (deg * Math.PI) / 180;
  return { x: radius * Math.sin(radians), y: -radius * Math.cos(radians) };
}

/** First letter up, rest as the archive wrote it: "on traffic signals" reads as
 *  a sentence in the fact column and SHOUTS in the panel below it. */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * WHAT THE THING ON THE POLE IS, in the words the mapper used.
 *
 * `surveillance:type` first (ALPR / ANPR - the tag DEFLOCK settled on and the
 * one this archive is built from), then `camera:type`, which carries the
 * physical form and is where a value like `speed_camera` lives. A tag that
 * already says CAMERA is not made to say it twice.
 *
 * Falls back to the bare word rather than to nothing: the engine only ever
 * raises this screen for a camera, so "CAMERA" is the one claim that survives
 * the record going missing.
 */
function cameraKind(record: CameraRecord | null): string {
  const raw = readableTag(tagValue(record, 'surveillance:type') ?? tagValue(record, 'camera:type'));
  if (raw === null) return KIND_FALLBACK;
  const kind = raw.toUpperCase();
  return kind.includes(KIND_FALLBACK) ? kind : `${kind} ${KIND_FALLBACK}`;
}

/** One line in the fact column: a mark, and the thing it is about. */
interface AlertFact {
  readonly id: string;
  readonly glyph: FactMark;
  readonly text: string;
}

/** One line in a disclosure panel. Only ever built from a value that exists. */
interface PanelRow {
  readonly label: string;
  readonly value: string;
}

function row(label: string, value: string | null): PanelRow | null {
  return value === null || value === '' ? null : { label, value };
}

type FactMark = 'mount' | 'facing' | 'lane' | 'pin' | 'link';

/**
 * The marks, drawn rather than fetched.
 *
 * Geometry only - every stroke and fill is `currentColor` and comes from
 * `alertV1.css`, the same division `components/dock/icons.css` makes, so a row
 * that changes hue takes its mark with it.
 */
function Mark({ of }: { readonly of: FactMark }): ReactElement {
  return (
    <svg className="fwm-alertv1-glyph" viewBox="0 0 24 24" aria-hidden="true">
      {of === 'mount' ? <path d="M12 3 V21 M6 7 H18 M9 3 H15" /> : null}
      {of === 'facing' ? <path d="M12 12 L4 6 A10 10 0 0 0 4 18 Z M12 12 h8" /> : null}
      {of === 'lane' ? <path d="M5 21 L9 3 M19 21 L15 3 M12 6 v3 M12 12 v3 M12 18 v3" /> : null}
      {of === 'pin' ? <path d="M12 21 C12 21 5 14.5 5 10 A7 7 0 0 1 19 10 C19 14.5 12 21 12 21 Z M12 10 h.01" /> : null}
      {of === 'link' ? <path d="M14 4 H20 V10 M20 4 L11 13 M18 14 V19 A1 1 0 0 1 17 20 H5 A1 1 0 0 1 4 19 V7 A1 1 0 0 1 5 6 H10" /> : null}
    </svg>
  );
}

/**
 * The mark on the kind tile: a body, a lens barrel and an aperture - the shape
 * a fixed ALPR reader actually has, rather than the hand-held camera every icon
 * set ships, because this product's whole subject is the pole-mounted kind.
 * `ClosestPanel` draws the same shape for the same reason; it is private to
 * that file, and a takeover cannot reach into a sibling feature's internals.
 */
function CameraMark(): ReactElement {
  return (
    <svg className="fwm-alertv1-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="7" width="12" height="10" rx="2" />
      <path d="M14.5 11.2 L21 8 V16 L14.5 12.8 Z" />
      <circle className="fwm-alertv1-glyph-fill" cx="8.5" cy="12" r="2.2" />
    </svg>
  );
}

/** The speaker on the silence key. The slash is the VERB - this key only ever
 *  offers to silence, so the slash is always drawn. */
function SilenceMark(): ReactElement {
  return (
    <svg className="fwm-alertv1-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9.5 H7.5 L12 5.5 V18.5 L7.5 14.5 H4 Z" />
      <line className="fwm-alertv1-glyph-stroke" x1="15" y1="9" x2="21" y2="15" />
      <line className="fwm-alertv1-glyph-stroke" x1="21" y1="9" x2="15" y2="15" />
    </svg>
  );
}

/** The navigation arrow on the reroute key. */
function RerouteMark(): ReactElement {
  return (
    <svg className="fwm-alertv1-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 3 L3 10.5 L11 13 L13.5 21 Z" />
    </svg>
  );
}

/** The chevron on a disclosure panel. `alertV1.css` turns it when the panel is
 *  open, so the mark and the state cannot disagree. */
function ChevronMark(): ReactElement {
  return (
    <svg className="fwm-alertv1-chev" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 10 L12 15 L17 10" />
    </svg>
  );
}

/** A disclosure panel, or nothing when the record filled none of its rows. */
function Panel({ title, rows }: { readonly title: string; readonly rows: readonly PanelRow[] }):
  ReactElement | null {
  if (rows.length === 0) return null;
  return (
    /* CLOSED BY DEFAULT, and that is the layout decision as much as a
       disclosure one: these two blocks are the tallest thing in the card and
       the least urgent, so on the shortest phone they cost a title row each
       until somebody stopped and asked for them. */
    <details className="fwm-alertv1-panel">
      <summary className="fwm-alertv1-panel-head">
        <span className="fwm-alertv1-panel-title">{title}</span>
        <ChevronMark />
      </summary>
      <dl className="fwm-alertv1-panel-rows">
        {rows.map((entry) => (
          <div className="fwm-alertv1-row" key={entry.label}>
            <dt className="fwm-alertv1-row-label">{entry.label}</dt>
            <dd className="fwm-alertv1-row-value fwm-data">{entry.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function AlertV1(): ReactElement | null {
  const takeover = useAlertTakeover();
  const assessments = useCameraAssessments();
  const cameras = useCachedCameras();
  const speedMph = useSpeedMph();
  const closing = useIsClosing();
  const mutedMs = useMuteRemainingMs();
  const log = useAlertLog();
  const fix = useCurrentFix();
  const headingDeg = useHeadingDeg();
  // The STEADY heading, not the raw one: `planDriveDetour` refuses a course
  // computed inside a parked phone's error cloud rather than routing off it.
  const routeHeading = useSteadyHeading(headingDeg, speedMph);

  const silence = useCallback(() => {
    alertActions.muteAll(Date.now());
  }, []);

  const dismiss = useCallback(() => {
    // DISMISSING IS SILENCING, and `alertActions.dismiss()` is the thing being
    // turned down rather than a mechanism that does not exist. That action ends
    // the takeover cleanly and does NOT re-raise on the next tick: it sets
    // `dismissedEpisode = episode`, and `alert.ts` starts a fresh episode only
    // when a non-alerting state becomes an alerting one - "never the next
    // camera", in its own words. Which is exactly the problem. The next reader
    // on the same road IS the next episode, so a takeover closed without muting
    // is back a few hundred feet later, and a corridor of them is a screen the
    // driver swipes over and over.
    //
    // So there is no third state here: the swipe, the scrim and the SILENCE key
    // all buy the same stated ten minutes. It is also the only reading the
    // surface supports - a hint that says "swipe down to dismiss" sitting beside
    // a key that says "Silence 10 min" must not leave a driver guessing which of
    // the two they just got.
    alertActions.muteAll(Date.now());
  }, []);

  const reroute = useCallback(() => {
    // Silence first - see the header. This layer covers every overlay, so the
    // offer would be raised underneath it and the key would look broken.
    alertActions.muteAll(Date.now());
    offerDetour(
      planDriveDetour(fix, routeHeading, assessments),
      fix === null ? null : { from: { lat: fix.lat, lon: fix.lon }, cameras },
    );
  }, [fix, routeHeading, assessments, cameras]);

  /**
   * THE SWIPE, and why the body is excluded from it.
   *
   * The card's lower half scrolls. A drag that starts there is a scroll, and
   * treating it as a dismiss would close the screen every time somebody read
   * past the fold - so the gesture only counts when it begins outside that box.
   * Distance between touchstart and touchend, not velocity: a driver's swipe on
   * a phone in a mount is slow and deliberate, and a fling threshold rejects it.
   */
  const swipeFromY = useRef<number | null>(null);

  const onTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('.fwm-alertv1-more') != null) {
      swipeFromY.current = null;
      return;
    }
    swipeFromY.current = event.touches[0]?.clientY ?? null;
  }, []);

  const onTouchEnd = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      const from = swipeFromY.current;
      swipeFromY.current = null;
      if (from === null) return;
      const to = event.changedTouches[0]?.clientY ?? null;
      if (to === null) return;
      if (to - from >= SWIPE_DISMISS_PX) dismiss();
    },
    [dismiss],
  );

  const cameraId = takeover.active ? takeover.cameraId : null;
  const assessment =
    cameraId === null ? null : (assessments.find((entry) => entry.id === cameraId) ?? null);

  // Null is a real outcome: the takeover can be live for a camera whose record
  // has already left the cache. The screen still warns; it just cannot name it.
  const record = cameraId === null ? null : (cameras.find((cam) => cam.id === cameraId) ?? null);

  /** The cones the picture draws - every direction the mapper wrote, not just
   *  the derived one. The same call DRIVE makes for the same picture. */
  const facings = useMemo(
    () => facingSpans(coveredDirections(record), record?.directionDeg ?? null),
    [record],
  );

  if (!takeover.active) return null;

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
      // The engine's own reading of whether the gap is shrinking, passed
      // through rather than re-derived here, so this screen and DRIVE cannot
      // tell one drive two different stories. Note WHICH value withholds the
      // countdown: `etaSeconds` returns null on FALSE - a camera being driven
      // away from has no arrival to count down to - and lets NULL through,
      // because null is only the first fix or two, before there is any history
      // to compare against, and `eta.ts` takes a shrinking distance as the
      // common case there.
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
   * road' fallback: on a takeover a missing street drops the clause. A
   * placeholder here would print a phrase about a road nobody named, in the
   * largest text on the screen, while the driver is looking at the road.
   */
  const where =
    record === null || record.street === undefined
      ? null
      : record.cross === undefined
        ? record.street
        : `${record.street} at ${record.cross}`;

  const operator = chipLabel(record?.ownerType, record);
  const lane = laneCovered(record?.directionDeg ?? null);

  /** `~ 3 SEC · covering the northbound lane`, minus whatever is unknown. */
  const quiet = [eta === null ? null : `~ ${eta}`, lane]
    .filter((part): part is string => part !== null)
    .join(' · ');

  const mount = mountPhrase(record);
  const facingDeg = record?.directionDeg ?? null;

  /**
   * THE FACT COLUMN - what this camera is, beside what it is doing to you.
   *
   * `facingVehicle` is the one line here that is about THIS approach rather
   * than about the record, and it is tri-state on purpose: null is "the record
   * never said which way the lens points", which is not the same claim as "it
   * is not pointed at you" and must not render as one.
   */
  const candidates: readonly (AlertFact | null)[] = [
    mount === null ? null : { id: 'mount', glyph: 'mount', text: sentence(mount) },
    facingDeg === null
      ? null
      : {
          id: 'facing',
          glyph: 'facing',
          text: `Facing ${facingCardinal(facingDeg)} (${String(Math.round(facingDeg))}°)`,
        },
    assessment === null || assessment.facingVehicle === null
      ? null
      : {
          id: 'lane',
          glyph: 'lane',
          text: assessment.facingVehicle ? 'Covers your lane' : 'Points away from you',
        },
    assessment === null
      ? null
      : {
          id: 'coords',
          glyph: 'pin',
          text: formatCoordinates(assessment.lat, assessment.lon),
        },
  ];
  const facts = candidates.filter((fact): fact is AlertFact => fact !== null);

  const detailRows = [
    row('Brand', makerOf(record)),
    /* The TAG, not the sentence the fact column above builds from it: a
       label/value pair reads as a table, and "Mount: On traffic signals" is a
       sentence with a heading stuck on the front of it. */
    row('Mount', mountOf(record)),
    row('Facing', formatCoveredDirections(coveredDirections(record))),
    row(
      'Last seen',
      record?.updatedAt === undefined ? null : dataAsOf(new Date(record.updatedAt).toISOString()),
    ),
    row('OSM', record?.id ?? null),
  ].filter((entry): entry is PanelRow => entry !== null);

  /**
   * EVERY ROW HERE NEEDS THE RECORD, including the two that could be answered
   * without it.
   *
   * This device's read count and the number of cameras being measured are true
   * whether or not the cache still holds the camera - so with only their own
   * guards, a takeover whose record had expired still drew this panel, titled
   * COMMUNITY INFO, three inches under a figure that had just refused to name
   * the thing it was about. A panel whose title claims more than its rows can
   * say is the placeholder this screen exists not to print. Gating them on the
   * record empties the array, and `Panel` draws nothing on an empty one - the
   * same mechanism that already takes CAMERA DETAILS away.
   */
  const communityRows = [
    row(
      'Confirmed by',
      record?.confirmations === undefined ? null : `${String(record.confirmations)} hakcers`,
    ),
    /* THIS DEVICE'S OWN HISTORY and nothing else - the same count and the same
       predicate the INTEL card prints, so a driver who opens the card after
       dismissing this does not read two different numbers for one camera. */
    record === null || cameraId === null
      ? null
      : row('Your reads', String(intelReads(log, cameraId, Date.now()))),
    /* WHAT THE ENGINE IS MEASURING RIGHT NOW, which is the honest reading of
       "in this area": every camera assessed against this fix. Not a count of
       the cache, which is a tile set the size of a county. */
    record === null ? null : row('In this area', `${String(assessments.length)} measured`),
    row('Verification', record?.ownerType === undefined ? null : OWNER_LABEL[record.ownerType]),
  ].filter((entry): entry is PanelRow => entry !== null);

  const vehicle =
    assessment === null
      ? null
      : bearingPoint(assessment.bearingDeg + 180, VEHICLE_RADIUS);

  return (
    <section
      className="fwm-alertv1"
      data-fwm-state={takeover.state}
      aria-label="camera alert"
      role="alertdialog"
      aria-live="assertive"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* THE SURFACE AROUND THE CARD IS THE DISMISS TARGET, behind everything
          rather than over it: a thumb that lands in the gutter silences, and a
          thumb that lands on a control does what that control says. It used to
          cover the card too, which was right when the card was four lines of
          text and is wrong now that it holds a link and two panels. */}
      <button type="button" className="fwm-alertv1-scrim" aria-label="dismiss" onClick={dismiss} />

      <header className="fwm-alertv1-top">
        <p className="fwm-alertv1-eyebrow fwm-data">{ALERT_EYEBROW}</p>
        <p className="fwm-alertv1-live fwm-data">
          <span className="fwm-alertv1-live-dot" aria-hidden="true" />
          {LIVE_LABEL}
        </p>
      </header>

      <article className="fwm-alertv1-card">
        {/* NEVER SCROLLS. See the header: the figure is the one thing on this
            screen a driver reads without looking straight at it. */}
        {/* CLOSE AND MUTE, ON THE CARD, WHERE A THUMB CAN FIND THEM.
            Both actions already existed - the scrim, a downward swipe and the
            SILENCE key all bought the same ten minutes - but every one of them
            was a gesture or below the fold. A takeover whose dismiss cannot be
            SEEN is a takeover a driver fights. They are the same two closures,
            drawn. */}
        <div className="fwm-alertv1-keys-top">
          <button
            type="button"
            className="fwm-alertv1-key-top"
            aria-label={ALERT_MUTE_LABEL}
            onClick={silence}
          >
            {MuteGlyph}
          </button>
          <button
            type="button"
            className="fwm-alertv1-key-top"
            aria-label={ALERT_CLOSE_LABEL}
            onClick={dismiss}
          >
            {CloseGlyph}
          </button>
        </div>

        <div className="fwm-alertv1-head">
          <div className="fwm-alertv1-kind">
            <span className="fwm-alertv1-tile" aria-hidden="true">
              <CameraMark />
            </span>
            <span className="fwm-alertv1-kind-label">{cameraKind(record)}</span>
            {/* An ATTRIBUTION, outlined rather than filled - the kind is what
                the thing is, this is who runs it, and two filled chips would
                read as two titles. Absent when nobody has said. */}
            {operator === null ? null : (
              <span className="fwm-alertv1-operator fwm-data">{operator}</span>
            )}
          </div>

          <p className="fwm-alertv1-figure-row">
            <span className="fwm-alertv1-figure fwm-data">{figure}</span>
            <span className="fwm-alertv1-unit">
              <span className="fwm-alertv1-unit-word">{useMiles ? 'MILES' : 'FEET'}</span>
              <span className="fwm-alertv1-side">{side}</span>
            </span>
          </p>

          {where === null ? null : (
            <p className="fwm-alertv1-where">
              <Mark of="pin" />
              <span className="fwm-alertv1-where-text">{where}</span>
            </p>
          )}

          {quiet === '' ? null : <p className="fwm-alertv1-quiet fwm-data">{quiet}</p>}
        </div>

        {/* THE ONE SCROLLING BOX on the surface. Everything a stopped driver
            might want and a moving one must not have to hunt for. */}
        <div className="fwm-alertv1-more">
          {facts.length === 0 ? null : (
            <ul className="fwm-alertv1-facts">
              {facts.map((fact) => (
                <li className="fwm-alertv1-fact" key={fact.id}>
                  <Mark of={fact.glyph} />
                  <span className="fwm-alertv1-fact-text fwm-data">{fact.text}</span>
                </li>
              ))}
              {/* THE CARD THIS OPENS IS WHERE THE APP DRAWS ONE CAMERA ON THE
                  MAP. Only offered when there is a record to open - selecting
                  an id the cache has dropped raises an empty card. It silences
                  on the way out, because leaving the takeover up over the card
                  would cover the thing the driver just asked to see. */}
              {record === null ? null : (
                <li className="fwm-alertv1-fact">
                  <Mark of="link" />
                  <button
                    type="button"
                    className="fwm-alertv1-fact-link"
                    onClick={() => {
                      dismiss();
                      openIntelCard(record.id);
                    }}
                  >
                    {VIEW_ON_MAP}
                  </button>
                </li>
              )}
            </ul>
          )}

          {assessment === null ? null : (
            <div className="fwm-alertv1-map">
              {/* THE PICTURE ITSELF IS `MiniMap`, lazily loaded, exactly as
                  DRIVE and INTEL draw it. A second still-map renderer would be
                  a second road classification and a second set of bugs.
                  Positioned from the ASSESSMENT rather than from the record, so
                  a takeover for a camera the cache has dropped still gets one. */}
              <MiniMap lat={assessment.lat} lon={assessment.lon} facings={facings} />

              {/* NORTH, AND ONLY NORTH. `MiniMap` builds with no bearing and
                  never sets one, so the picture is north-up in every card that
                  draws it; a rosette that spun would be an instrument
                  contradicting the photograph under it. */}
              <span className="fwm-alertv1-north fwm-data" aria-hidden="true">
                N
              </span>

              {/* NO "3D" BADGE, though the reference render carries one beside
                  this. `MiniMap` builds its map with a zoom and nothing else -
                  no bearing, no pitch, and its own header states there is no
                  rotate - so the badge would label a mode the picture cannot be
                  in. A control surface that names a mode it is not in is how a
                  driver stops believing the rest of the panel. */}

              {vehicle === null ? null : (
                <svg className="fwm-alertv1-overlay" viewBox={MAP_BOX} aria-hidden="true">
                  <line
                    className="fwm-alertv1-sightline"
                    x1={0}
                    y1={0}
                    x2={vehicle.x}
                    y2={vehicle.y}
                  />
                  <circle className="fwm-alertv1-vehicle" cx={vehicle.x} cy={vehicle.y} r={4} />
                </svg>
              )}

              {/* NO SCALE BAR, AND THE REASON THIS FILE USED TO GIVE FOR THAT
                  WAS THE WRONG ONE.

                  It said the box is sized `--fwm-minimap-size: 100%`, so how
                  much ground a CSS pixel covers falls out of how wide the card
                  ended up and nothing here can know it without measuring. That
                  is the argument for VEHICLE_RADIUS, where the mark's offset is
                  a fraction of the BOX - and it does not carry over. A scale bar
                  needs no box width at all: it is a fixed number of CSS pixels
                  labelled with what those pixels span, and metres per CSS pixel
                  is `156543.03 * cos(lat) / 2^zoom`, both of which are known
                  here. `MINI_MAP_ZOOM` is exported and fixed at 16, and the
                  latitude is `assessment.lat`.

                  WHAT ACTUALLY BLOCKS IT is which zoom convention that formula
                  is in. The constant is the resolution of a 256px tile scheme;
                  MapLibre's transform sizes the world in 512px tiles, so its
                  zoom 16 is one step finer and the true figure is HALF the one
                  `miniMap.ts`'s own header states - 0.93 m/px at latitude 39,
                  not 1.86. The basemap here is a vector `pmtiles://` source, so
                  it is MapLibre's convention that governs, and the module the
                  number would be imported from documents the other one.

                  A factor of two is not a rounding error on this surface. A bar
                  reading 200 FT beside a picture in which 200 ft is some other
                  length invites the distance to be read off the picture instead
                  of off the figure that states it exactly, which is the one
                  reading this whole screen exists to protect. So: no bar until
                  somebody has put a ruler on a real render and settled the
                  convention in `miniMap.ts`, where the arithmetic belongs. A
                  blank is honest. A confident wrong value is not. */}
              <span className="fwm-alertv1-you fwm-data">Your location</span>
            </div>
          )}

          <div className="fwm-alertv1-panels">
            <Panel title={DETAILS_TITLE} rows={detailRows} />
            <Panel title={COMMUNITY_TITLE} rows={communityRows} />
          </div>
        </div>
      </article>

      {/* OUTSIDE THE CARD'S SCROLL, so both are on screen at every height. */}
      <div className="fwm-alertv1-keys">
        {/* The accessible name is the WORD ON THE KEY, not the whole block: the
            sub-line is guidance about what silencing does, and a screen reader
            announcing "Silence 10 min Hide alerts for 10 minutes" reads as two
            controls. The sub-line stays visible for the eye. */}
        <button
          type="button"
          className="fwm-alertv1-key"
          data-fwm-alert-key="filled"
          aria-label={SILENCE_LABEL}
          onClick={silence}
        >
          <SilenceMark />
          <span className="fwm-alertv1-key-text">
            <span className="fwm-alertv1-key-label">{SILENCE_LABEL}</span>
            {/* NOT "for this camera". This key calls `muteAll`, which is what
                keeps dismissal and silence the same act for a camera whose
                record is gone - and a key that claimed to mute one camera while
                muting every one of them would be the app lying about its own
                state the first time a driver checked. */}
            <span className="fwm-alertv1-key-sub">{SILENCE_SUB}</span>
          </span>
        </button>

        <button
          type="button"
          className="fwm-alertv1-key"
          data-fwm-alert-key="outline"
          aria-label={REROUTE_LABEL}
          onClick={reroute}
        >
          <RerouteMark />
          <span className="fwm-alertv1-key-text">
            <span className="fwm-alertv1-key-label">{REROUTE_LABEL}</span>
            <span className="fwm-alertv1-key-sub">{REROUTE_SUB}</span>
          </span>
        </button>
      </div>

      <p className="fwm-alertv1-hint fwm-data">
        {mutedMs > 0 ? ALREADY_SILENCED : DISMISS_HINT}
      </p>
    </section>
  );
}
