/**
 * DELIVERY - the wire from the gate to the driver's hands.
 *
 * =============================================================================
 * WHAT WAS MISSING
 * =============================================================================
 * `packages/core` decides three delivery facts on every tick - `shouldAlertUser`
 * (the gate), `hapticPulses` (0/1/2) and `notifyCameraIds`. `stores/alert.ts`
 * re-evaluates them against the mute and publishes them. Two adapters exist to
 * act on them: `adapters/vibration.ts`, with its pattern table read off the
 * notification, and `adapters/notifications.ts`, with its channel table and its
 * composer.
 *
 * Nothing joined the two halves. `vibration.buzz()` and `notifications.show()`
 * had ZERO production callers - complete, tested, imported by nothing - so the
 * only thing an alert did was change some pixels. That is a driving alerter
 * that requires the driver to be looking at the screen, which is the one thing
 * a driving alerter must not be. The Vibration toggle in SETTINGS controlled
 * nothing at all.
 *
 * This file is that join, and it is deliberately only that.
 *
 * =============================================================================
 * IT DECIDES ONE THING, AND NAMES IT
 * =============================================================================
 * No threshold, no cooldown, no mute logic, no state machine. It reads what the
 * stores publish and calls adapters. If a rule ever appears here there will be
 * two answers to "is this an alert" and they will drift - the same reasoning
 * `engineLoop.ts` states for itself.
 *
 * The ONE decision it owns is WHICH PATH CARRIES THE HAPTIC, because that is a
 * question about two adapters and neither adapter can see the other. See THE
 * DOUBLE BUZZ below. Everything else is transport.
 *
 * In particular the per-camera COOLDOWN is already applied upstream:
 * `shouldAlertUser` is `cooled.length > 0`, so it is an EDGE, not a level, and
 * firing on every tick that publishes it is correct rather than repetitive.
 *
 * =============================================================================
 * WHY A STORE SUBSCRIPTION
 * =============================================================================
 * Same reason as the alert loop and the camera sync: a camera coming into
 * range does not arrive through a component tree, and delivery must outlive
 * whatever screen is mounted. A hook would stop buzzing the moment RADAR
 * unmounted, which is exactly when a driver is least able to look.
 *
 * =============================================================================
 * THE DOUBLE BUZZ, AND WHY THE PAGE IS NOW THE FALLBACK
 * =============================================================================
 * `ComposedNotification` carries a `vibrate` pattern now, so a camera alert has
 * TWO haptic paths and they fire from the same event. Left alone, a foregrounded
 * phone gets both within a few milliseconds of each other and the two 260ms
 * pulses smear into one buzz of no particular shape - which destroys the exact
 * thing `vibration.ts` calls the RESERVED camera signature. A double buzz is
 * worse than either single one.
 *
 * They cannot be merged, because neither adapter can suppress the other's
 * pattern from here. So they are ORDERED:
 *
 *   THE NOTIFICATION IS THE PRIMARY HAPTIC. It is the path that survives a dark
 *   screen, a backgrounded tab and a phone face-down in a mount, which is the
 *   whole reason the pattern was moved onto it.
 *
 *   THE PAGE BUZZ IS THE FALLBACK, fired only when the notification did not go
 *   out - no permission, the driver's notifications switch off, no Notification
 *   API, or a post that threw. In every one of those cases the page buzz is the
 *   ONLY warning a driver who is not looking will get, so it must still fire.
 *
 * THIS COSTS NO LATENCY WHERE LATENCY WOULD MATTER, and that is checked rather
 * than assumed: `show()` returns `unsupported` and `blocked` BEFORE it awaits
 * the card renderer, so every outcome that leads to a fallback buzz resolves in
 * a microtask. Only `shown` and `failed` pay the card's 250ms deadline, and
 * `shown` is the case that does not buzz from here at all.
 *
 * WHAT THIS DOES NOT CLAIM. A notification that was `shown` may still not have
 * buzzed - on Android 8+ the CHANNEL owns vibration, and a driver who muted the
 * channel or is in do-not-disturb gets nothing. That is stated in
 * `ComposedNotification.vibrate` and it is not recoverable here: there is no
 * read-back on either path. The rule above picks the path that is more likely
 * to reach a driver who is not looking at the screen, which is the only
 * comparison the platform lets this file make.
 *
 * =============================================================================
 * THE CARD RENDERER IS INJECTED HERE, AND THAT IS A STOPGAP
 * =============================================================================
 * `createNotificationsAdapter({ renderCard })` is what puts the branded PNG on
 * the shade, and the right place to pass it is `createPlatformAdapters()` in
 * `adapters/set.ts` - one adapter set, one renderer, and every caller of the
 * set gets cards including `features/settings/AlertTestV1.tsx`, which builds
 * its own set and would otherwise send a picture-less test alert.
 *
 * That file is not this task's to edit, so the renderer is applied to the set
 * this file builds for itself. Nothing shares an adapter set with delivery
 * today, so the two are indistinguishable in the running app; they stop being
 * indistinguishable the moment a second caller passes `adapters` in. See
 * `renderNotificationCard` for the exact three lines `set.ts` needs.
 *
 * =============================================================================
 * WHAT IS STILL NOT WIRED, AND WHY IT IS NOT HERE
 * =============================================================================
 * ABUSE AREAS: NEARBY. `AbuseAreaPayload` has two triggers and only `entered`
 * can be answered from the data on the device. See `createCountyAbuseSource`.
 *
 * TRIP FACTS. `NavigationPayload` will carry `etaMinutes` and `milesRemaining`
 * and nothing in this codebase computes either REMAINING figure - `route.miles`
 * and `route.seconds` are whole-route totals, and posting them as "remaining"
 * would print "22 min" while the driver pulls into the driveway. They are
 * omitted rather than approximated, and the card omits the line.
 */

import { renderCardImage } from '../../features/alert/cardImage.ts';
import { coarseDirection } from '../../features/radar/format.ts';
import { zoneLive } from '../../features/radar/zoneLive.ts';
import { gazetteer } from '../cameras/gazetteer.ts';
import { countyLocator, type CountyLocator } from '../records/countyLocate.ts';
import {
  countyRecords,
  type CountyMisuseRecord,
  type CountyRecordsIndex,
} from '../records/countyRecords.ts';
import { createAnnouncer, spokenFor, type Announcer } from '../route/announce.ts';
import {
  ABUSE_AREA_TAG,
  CAMERA_ALERT_TAG,
  NAVIGATION_TAG,
  composeNotification,
  createNotificationsAdapter,
  type AbuseAreaPayload,
  type CameraAlertPayload,
  type CardRenderer,
  type NavigationPayload,
  type NotificationPayload,
} from '../adapters/notifications.ts';
import { createSpeechSynthesisAdapter, type SpeechSynthesisAdapter } from '../adapters/speech.ts';
import type { VibrationRequest } from '../adapters/vibration.ts';
import type { AdapterSet } from '../adapters/set.ts';
import { createPlatformAdapters } from '../adapters/set.ts';
import { isAlertingState, useAlertStore, type AlertSliceState } from '../../stores/alert.ts';
import { useCamerasStore } from '../../stores/cameras.ts';
import { usePositionStore, type PositionFix } from '../../stores/position.ts';
import { useRouteStore } from '../../stores/route.ts';
import { capabilityEnabled, useSettingsStore } from '../../stores/settings.ts';

/**
 * The three payloads a driver is DISTURBED by, which is the set this file
 * delivers. `watchlist` is deliberately outside it: it is a thing to find when
 * you next open the app, it has no haptic and it is not a `SpeechSource`.
 */
type DeliverablePayload = CameraAlertPayload | AbuseAreaPayload | NavigationPayload;

/**
 * The tag a payload's card is filed under, taken from the composer rather than
 * from a table of our own.
 *
 * A second table would drift, and the drift would be invisible: `cardImage.ts`
 * keys its object-URL cache on this tag and revokes the previous URL when the
 * same tag renders again, so a tag that disagreed with the notification's would
 * leak one PNG per alert and never replace a card's picture.
 */
export function cardTagFor(payload: NotificationPayload): string {
  return composeNotification(payload).tag;
}

/**
 * The renderer `createNotificationsAdapter` should be built with.
 *
 * Exported so `adapters/set.ts` can adopt it verbatim:
 *   `notifications: createNotificationsAdapter({ renderCard: renderNotificationCard })`
 *
 * It never throws and it may return null - both are normal, and the adapter
 * races it against a deadline and posts without a picture either way.
 */
export const renderNotificationCard: CardRenderer = (payload) =>
  renderCardImage(payload, cardTagFor(payload));

/**
 * WHAT A DOCUMENTED-ABUSE AREA LOOKS LIKE FROM HERE.
 *
 * Narrow on purpose. This file must not learn what a county is, and the source
 * must not learn what a notification is, because the two answers change on
 * different schedules: the geometry gets better when a v3 camera capture lands,
 * and the copy gets better when somebody reads the card in a car.
 *
 * `key` is the identity that decides whether this is NEWS. Delivery fires when
 * it CHANGES and stays quiet while it does not, so a driver parked inside a
 * recorded county is told once rather than once per GPS fix. A county FIPS is
 * the right key for the same reason `countyRecords.ts` files on one: names
 * repeat and boundaries do not.
 *
 * `cameraCount` is deliberately NOT here - see `camerasAround`.
 */
export interface AbuseAreaSighting {
  /** ENTERED means "you are in it". NEARBY means "it is over there". */
  readonly trigger: 'entered' | 'nearby';
  readonly key: string;
  /** As a card prints it. Never spoken - see `abuseSpeech`. */
  readonly county: string;
  readonly incidentCount: number;
  /** Feet to the nearest documented incident. `nearby` only. */
  readonly distanceFt?: number;
  /** The single citable worst case. An agency, never an individual. */
  readonly worstCase?: string;
}

export interface AbuseAreaSource {
  /**
   * The area at this fix, or null.
   *
   * CALLED ON EVERY FIX, so it must be cheap and it must never block: an
   * implementation that fetches on this path would put a megabyte of geometry
   * between a driver and their next turn. The county source below answers from
   * an index it warms in the background and returns null until it is held.
   */
  sight(at: PositionFix): AbuseAreaSighting | null;
}

export interface CountyAbuseSourceOptions {
  readonly locator?: CountyLocator;
  readonly records?: CountyRecordsIndex;
  /** Turns a FIPS into "JOHNSON CO, KS". Falls back to the polygon's own name. */
  readonly nameFor?: (fips: string) => string | null;
}

/**
 * The worst case a card may cite: the most incidents, then the most recent.
 *
 * `forCounty` hands back the county's records in FILE ORDER - only the flat
 * feed is sorted - so picking `records[0]` would cite whichever row the curator
 * happened to type first. That is not a defensible "worst".
 */
function worstOf(records: readonly CountyMisuseRecord[]): CountyMisuseRecord | null {
  let worst: CountyMisuseRecord | null = null;
  for (const record of records) {
    if (worst === null) {
      worst = record;
      continue;
    }
    if (record.incidents > worst.incidents) worst = record;
    else if (record.incidents === worst.incidents && record.year > worst.year) worst = record;
  }
  return worst;
}

/**
 * THE ONLY ABUSE-AREA TRIGGER THE DEVICE CAN ANSWER TODAY, and the honest
 * shape of the one it cannot.
 *
 * ENTERED works: `countyLocate.ts` does point-in-polygon against 3,221 county
 * rings on the device, `countyRecords.ts` says whether that county has a
 * documented record, and neither asks a network where the driver is standing.
 *
 * NEARBY IS NOT IMPLEMENTED, and it is not implemented because there is nothing
 * to measure a distance TO. `CountyMisuseRecord` carries an agency, a summary,
 * a count, a year and a citation - no coordinate anywhere - and `CountyLocator`
 * answers a boolean "is this point inside" with no distance-to-edge. So the two
 * numbers `AbuseAreaPayload`'s `nearby` trigger needs - how far, and to what -
 * do not exist.
 *
 * The alternative was a proxy: read the county off the CAMERAS around the
 * driver and call a record in it "nearby". Measured on the live archive, 0 of
 * 868 cameras carry `countyFips` - `zoneLive.countyFips` is null in the app
 * that ships - so that branch would be dead code that reads as a feature. It is
 * the same trap `MisuseScreen.tsx` documents at length after NEAR ME shipped
 * disabled for exactly this reason.
 *
 * WHAT A CALLER MUST SUPPLY TO MAKE NEARBY FIRE: an `AbuseAreaSource` whose
 * `sight()` returns `{ trigger: 'nearby', distanceFt }`. Everything downstream
 * of the interface is already written and tested - the composer, the card, the
 * haptic, the dedupe and the take-down all treat the two triggers as peers.
 */
export function createCountyAbuseSource(options: CountyAbuseSourceOptions = {}): AbuseAreaSource {
  const locator = options.locator ?? countyLocator;
  const records = options.records ?? countyRecords;
  const nameFor =
    options.nameFor ?? ((fips: string): string | null => gazetteer.county(fips)?.label ?? null);

  /*
   * Warmed once, and never again from this path.
   *
   * `locate()` fetches a megabyte of county geometry the first time it is
   * called; `locateLoaded()` is pure arithmetic over whatever is already held.
   * So the hot path only ever calls the second one, and the first is kicked off
   * exactly once so that it eventually has something to read. A retry loop here
   * would re-fetch a megabyte on every fix in a dead spot.
   */
  let warmed = false;

  return {
    sight(at: PositionFix): AbuseAreaSighting | null {
      const hit = locator.locateLoaded(at.lat, at.lon);
      if (hit === null) {
        if (!warmed) {
          warmed = true;
          void locator.locate(at.lat, at.lon);
        }
        return null;
      }
      // Null here is UNDOCUMENTED, never CLEAN - `countyRecords.ts` sets that
      // rule and this is it being kept. Nothing is posted for an absence.
      const summary = records.forCounty(hit.fips);
      if (summary === null) return null;
      const worst = worstOf(summary.records);
      return {
        trigger: 'entered',
        key: hit.fips,
        // The gazetteer's label is what every other screen prints for a county.
        // The polygon's own bare name is the fallback, because a card that says
        // "Johnson" is worse than one that says "JOHNSON CO, KS" and far better
        // than one that says nothing while the tile generation settles.
        county: nameFor(hit.fips) ?? hit.name,
        incidentCount: summary.incidents,
        ...(worst === null ? {} : { worstCase: worst.agency }),
      };
    },
  };
}

/**
 * Cameras within the watched-area radius of the driver, counted the way ZONE
 * AUDIT and RADAR count them so the card cannot disagree with the screen.
 *
 * THIS IS "AROUND YOU", NOT "IN THIS COUNTY", and the card's `cameraCount` slot
 * gets it because the county figure cannot be had: cameras carry no county
 * FIPS in the shipped archive (0 of 868), so counting per county would return
 * zero everywhere. "12 cameras" next to "entering JOHNSON CO, KS" is a true
 * sentence about the driver's surroundings; a zero would be a false one about
 * the county.
 */
function camerasAround(at: PositionFix): number {
  return zoneLive(at, useCamerasStore.getState().cameras).total;
}

/** What a camera alert sounds like: "camera, 425 feet, ahead". */
function cameraSpeech(payload: CameraAlertPayload): string {
  const subject = payload.inRangeCount > 1 ? `${String(payload.inRangeCount)} cameras` : 'camera';
  const feet = `${String(Math.round(payload.distanceFt))} feet`;
  /*
   * The switch's own copy is "distance and side, once per camera", and this
   * says one word more than that. A bare "425 feet, ahead" arriving out of a
   * silent car is a measurement of nothing - the driver has to guess what was
   * measured, and the other thing this adapter says out loud is also a distance
   * ("in 500 feet, turn right"). One noun makes it a warning.
   *
   * The separator is swapped rather than kept: RADAR's finer labels are joined
   * with a middle dot for the eye, and a speech engine reads it as a pause of
   * no meaning or as the word "dot".
   */
  const side = payload.bearingLabel.trim().toLowerCase().replace(' · ', ', ');
  return side === '' ? `${subject}, ${feet}` : `${subject}, ${feet}, ${side}`;
}

/**
 * What an abuse area sounds like - AND IT DOES NOT SAY THE COUNTY'S NAME.
 *
 * The name a card prints comes from the gazetteer, whose `label` is documented
 * as "pre-formatted for a strip": "JOHNSON CO, KS". That is a glance format,
 * abbreviated and capitalised for a row of pixels, and handing it to a speech
 * engine is the same category error `announce.ts` refuses when it declines to
 * read a card's exact feet out loud. "co" is not a word, "KS" is two letters,
 * and a driver hears something between "company" and nothing.
 *
 * So the ear gets the fact and the eye gets the place: the county is on the
 * card, on the notification title and on RADAR, all of which are already in
 * front of the driver when this is spoken.
 */
function abuseSpeech(payload: AbuseAreaPayload): string {
  const n = payload.incidentCount;
  const incidents = `${String(n)} documented ${n === 1 ? 'incident' : 'incidents'} of misuse`;
  return payload.trigger === 'entered'
    ? `entering an area with ${incidents}`
    : `${incidents} nearby`;
}

/**
 * The haptic request for a payload.
 *
 * `state` is passed for a camera and for nothing else, because it is the only
 * source whose pattern a state may narrow - `vibration.ts` says so in
 * `VibrationRequest`, and passing one for an abuse area would be asking the
 * table a question it has no row for.
 */
function hapticFor(payload: DeliverablePayload): VibrationRequest {
  return payload.kind === 'camera-alert'
    ? { source: 'camera-alert', state: payload.state }
    : { source: payload.kind };
}

export interface AlertDeliveryOptions {
  /** Injected in tests. The app builds its own. */
  readonly adapters?: AdapterSet;
  /**
   * The mouth. Injected separately because `AdapterSet` has no `speech` member
   * yet and `adapters/set.ts` is not this task's file to widen - see the report
   * note. When it is widened this option collapses into `adapters`.
   */
  readonly speech?: SpeechSynthesisAdapter;
  /** Where documented-abuse areas come from. Defaults to the county index. */
  readonly abuseAreas?: AbuseAreaSource;
  /** The turn ladder. Defaults to a fresh one; a drive gets exactly one. */
  readonly announcer?: Announcer;
}

export interface AlertDelivery {
  stop(): void;
}

export function createAlertDelivery(options: AlertDeliveryOptions = {}): AlertDelivery {
  const adapters =
    options.adapters ??
    ({
      ...createPlatformAdapters(),
      // THE CARD. See the header - this belongs in `createPlatformAdapters`.
      notifications: createNotificationsAdapter({ renderCard: renderNotificationCard }),
    } satisfies AdapterSet);
  const { vibration, notifications } = adapters;
  const speech = options.speech ?? createSpeechSynthesisAdapter();
  const abuseAreas = options.abuseAreas ?? createCountyAbuseSource();
  const announcer = options.announcer ?? createAnnouncer();

  /**
   * NO PERMISSION CHECK LIVES HERE, and that is the correct layering rather
   * than an omission.
   *
   * `notifications.show()` already refuses with `outcome: 'blocked'` when the
   * permission is anything but `granted`, and it does so WITHOUT PROMPTING -
   * only `request()` prompts, and this file never calls it. A dialog raised by
   * a camera coming into range is a dialog raised while driving, at the moment
   * the driver can least deal with it; ONBOARDING and SETTINGS ask, in the
   * calm, and this only ever spends what they granted.
   *
   * Re-deriving "may I" here would be a second copy of a rule the adapter
   * already enforces, and the copy is the one that goes stale.
   */
  notifications.start();

  /**
   * THE TWO TOGGLES ARE THE ADAPTERS' RUNNING FLAGS, not branches at the call
   * site.
   *
   * `buzz()` already refuses with "haptics are switched off in the map view
   * panel" when its adapter is not running, and `speak()` refuses with "spoken
   * warnings are switched off in the map view panel" when its own is. So
   * honouring the preferences means starting and stopping the adapters and
   * letting their guards do the rest. A second check here would be a second
   * place for each answer to live.
   *
   * BOTH SWITCHES ARE ON THAT PANEL NOW, not on SETTINGS - they moved with the
   * warn distance, and the settings copy was deleted rather than mirrored.
   * Nothing here changed: the store fields are still `vibration` and `audio`
   * and this is still their only reader. Only the screen that writes them, and
   * the screen the refusals name, moved.
   *
   * `audio` had NO reader at all until now. It was written, persisted,
   * rehydrated and rendered as a switch, and there was no speech synthesis
   * anywhere in `src` for it to gate - which is why "Spoken warnings" was
   * silent by construction rather than by a bug in the gate.
   */
  const applySwitches = (state: { readonly vibration: boolean; readonly audio: boolean }): void => {
    if (state.vibration) vibration.start();
    else vibration.stop();
    if (state.audio) speech.start();
    else speech.stop();
  };
  applySwitches(useSettingsStore.getState());

  const unsubSettings = useSettingsStore.subscribe((state, previous) => {
    if (state.vibration !== previous.vibration || state.audio !== previous.audio) {
      applySwitches(state);
    }
  });

  /**
   * ONE DELIVERY: say it, show it, and buzz on exactly one of the two paths.
   *
   * Returns whether a card is now standing under this payload's tag, which is
   * what the take-down logic keys off. `false` covers "blocked", "the switch is
   * off" and "the post threw" alike - in all three there is nothing on the
   * shade to take down later.
   */
  const deliver = async (
    payload: DeliverablePayload,
    say: string,
    wantsCard: boolean,
    wantsBuzz: boolean,
  ): Promise<boolean> => {
    /*
     * SPEECH IS NOT GATED ON THE CARD, unlike the haptic. A notification makes
     * no speech of its own, so there is no second voice to collide with and no
     * ordering to get right - the only gate is the driver's own switch, which
     * lives in the adapter.
     *
     * `payload.kind` IS the `SpeechSource`: the three names are the same three
     * strings, deliberately, and `watchlist` is absent from both sets for the
     * same reason - it is the one surface that holds a plate.
     */
    speech.speak({ source: payload.kind, text: say });

    /*
     * THE DRIVER'S OWN SWITCH. Checked here, not at `start()`, because the
     * switch can be thrown mid-drive and the delivery loop is already running
     * by then - gating the subscription would honour it only until the next
     * launch.
     *
     * Turning notifications off means "stop putting things on my lock screen",
     * not "stop warning me". It does not disarm the product: the buzz below
     * becomes the warning, exactly as it was before the pattern moved onto the
     * notification.
     */
    const result =
      wantsCard && capabilityEnabled('notifications') ? await notifications.show(payload) : null;
    const standing = result?.outcome === 'shown';
    // THE FALLBACK, not a second buzz. See THE DOUBLE BUZZ in the header.
    if (wantsBuzz && !standing) vibration.buzz(hapticFor(payload));
    return standing;
  };

  // ==========================================================================
  // CAMERAS
  // ==========================================================================

  /**
   * Whether a camera card is on the shade right now.
   *
   * Tracked rather than assumed, because the take-down below must not fire for
   * a card that was never posted - a `clear` on an empty tag is harmless but it
   * emits a `cleared` event, and an event stream that reports taking down cards
   * nobody saw is one nobody can read.
   */
  let cameraCardStanding = false;

  /**
   * THE CLEAR THAT COULD NEVER RUN.
   *
   * `notifications.show()` has a branch that takes the camera card DOWN when
   * the state is `clear`, and until now nothing could reach it. Delivery only
   * ran on the `delivered` counter, `delivered` only moves while the engine is
   * firing, and the engine only fires inside `shouldAlertUser` - which is
   * `isAlertingState`, which is `in_range || multiple`. So `clear` was
   * unreachable by construction, and a camera card sat on the shade after the
   * driver had passed the camera until the OS got bored of it. The card said
   * "425 ft · AHEAD" about a reader that was now half a mile behind.
   *
   * This runs on EVERY publish, before the delivery edge, because leaving range
   * is not an alert and does not bump a counter.
   *
   * APPROACHING TAKES THE CARD DOWN TOO, rather than replacing it with a
   * quieter one. Posting an approaching card here would be a downgrade nobody
   * asked for - a fresh silent card, with a fresh timestamp, saying a camera is
   * further away than the last card said. The design's rule is "silent below
   * the threshold", and the quietest thing below the threshold is no card.
   */
  const takeDownCameraCard = (state: AlertSliceState): void => {
    if (!cameraCardStanding || isAlertingState(state.state)) return;
    cameraCardStanding = false;
    void notifications.show({
      kind: 'camera-alert',
      state: 'clear',
      // Composed and then discarded: `show()` builds the notification before it
      // reads the state, and the clear branch returns without using it. Zeroes
      // rather than the last known values, so nothing here can be mistaken for
      // a measurement that was taken.
      distanceFt: 0,
      bearingLabel: '',
      inRangeCount: 0,
    });
  };

  const deliverCamera = (state: AlertSliceState): void => {
    const payload: CameraAlertPayload = {
      kind: 'camera-alert',
      state: state.state,
      // The engine's own cached distance. Never recomputed here -- a second
      // measurement would let the notification disagree with the screen.
      distanceFt: state.nearestDistanceFt ?? 0,
      // A BEARING PHRASE, never a street and never a coordinate. This string
      // goes to the operating system, which puts it on a lock screen.
      //
      // Read from the CAMERAS store rather than the alert slice, which keeps
      // only the nearest camera's id and distance. Same tick either way: both
      // slices are written from one `ingest`.
      bearingLabel:
        coarseDirection(useCamerasStore.getState().nearest?.relativeDirection ?? null) ?? '',
      inRangeCount: state.notifyCameraIds.length,
    };
    void deliver(
      payload,
      cameraSpeech(payload),
      state.notifyCameraIds.length > 0,
      state.hapticPulses > 0,
    ).then((standing) => {
      // Only ever set. A later failed post must not "un-stand" a card that is
      // still on the shade from the post before it.
      if (standing) cameraCardStanding = true;
    });
  };

  /**
   * The last tick we delivered for.
   *
   * The store publishes on every ingest, including ones that change nothing
   * about delivery. `delivered` is bumped by the slice for exactly this
   * purpose, so a re-render or an unrelated field change cannot re-buzz.
   */
  let lastDelivered = useAlertStore.getState().delivered;

  const unsubAlert = useAlertStore.subscribe((state) => {
    // Before the edge, deliberately: leaving range is not an alert.
    takeDownCameraCard(state);

    if (state.delivered === lastDelivered) return;
    lastDelivered = state.delivered;

    // THE GATE, and nothing else. Mute, accuracy, stationarity and cooldown
    // have all already been spent by the time this is true.
    if (!state.shouldAlertUser) return;

    deliverCamera(state);
  });

  // ==========================================================================
  // ABUSE AREAS
  // ==========================================================================

  /**
   * The area we last told the driver about, so entering one is news exactly
   * once. Null means "not in a recorded area", which is also a transition worth
   * acting on - it is what takes the card down.
   */
  let lastAbuseKey: string | null = null;
  let abuseCardStanding = false;

  const considerAbuse = (fix: PositionFix): void => {
    /*
     * THE MUTE IS READ BEFORE THE KEY IS SPENT, and the order is the whole
     * behaviour. "MUTE 10 MIN" means "stop disturbing me", and an unsolicited
     * card about the county the driver is sitting in is a disturbance - so it
     * is withheld. But withholding it AFTER marking the area told would mean a
     * driver who muted one camera on the way in never hears about the area at
     * all. Returning first leaves the area untold, so the telling is DELAYED by
     * the mute rather than cancelled by it.
     *
     * Read off the alert slice, which recomputes it on every ingest and on
     * every mute action - so it is as fresh as the last tick, which is the same
     * freshness the camera gate has.
     */
    if (useAlertStore.getState().muted) return;

    /*
     * ALERT ON ENTRY, AND IT IS READ AFTER THE MUTE FOR THE SAME REASON THE
     * MUTE IS READ FIRST -- BUT IT BEHAVES THE OTHER WAY ROUND, ON PURPOSE.
     *
     * The mute returns BEFORE `lastAbuseKey` is spent, so the telling is
     * delayed rather than cancelled: a driver who muted one camera on the way
     * into a county still hears about the county when the mute lapses.
     *
     * This switch is not a delay, it is a refusal. Somebody who turned abuse
     * entry alerts off is not waiting for them, and leaving the key unspent
     * would mean the card arrives the moment they turn the switch back on --
     * about a county they entered and left an hour ago. So the key IS spent
     * and the transition is consumed silently: the area is marked told, and
     * the next thing that happens is the next border.
     *
     * The take-down below still runs. A card raised while the switch was on
     * must come down when the driver leaves the area, whatever the switch says
     * by then -- a standing card reading "entering JOHNSON CO, KS" is a lie the
     * moment you are out of it, and that is true of an orphaned one too.
     */
    const settings = useSettingsStore.getState();

    const sighting = abuseAreas.sight(fix);
    const key = sighting?.key ?? null;
    if (key === lastAbuseKey) return;
    lastAbuseKey = key;

    if (sighting === null) {
      // LEFT THE AREA. Same defect as the camera card, same fix: a card that
      // says "entering JOHNSON CO, KS" is a lie the moment you are out of it.
      if (abuseCardStanding) {
        abuseCardStanding = false;
        void notifications.clear(ABUSE_AREA_TAG);
      }
      return;
    }

    // The switch, spent transition and all. See the note above the read.
    if (!settings.abuseAlertOnEntry) return;

    const payload: AbuseAreaPayload = {
      kind: 'abuse-area',
      trigger: sighting.trigger,
      county: sighting.county,
      incidentCount: sighting.incidentCount,
      cameraCount: camerasAround(fix),
      ...(sighting.distanceFt === undefined ? {} : { distanceFt: sighting.distanceFt }),
      /*
       * NAME THE AGENCY, and it is gated HERE rather than in the source.
       *
       * `createCountyAbuseSource` answers "what is documented in this county",
       * which is a fact about the data and the same fact whatever the driver
       * has switched on; gating it there would make an injected source in a
       * test answer differently depending on a setting it knows nothing about.
       * Whether that fact is SAID is a delivery preference, and delivery is
       * this file.
       *
       * It reaches exactly one field. `composeAbuseArea` appends `worstCase`
       * to the body after the counts and does nothing else with it, and
       * `abuseSpeech` never reads it -- the ear gets the incident count and the
       * eye gets the place. So off means the card body ends at
       * "N documented misuse - M cameras", which is what it said before the
       * agency was ever added to it.
       */
      ...(sighting.worstCase === undefined || !settings.abuseNameAgency
        ? {}
        : { worstCase: sighting.worstCase }),
    };
    void deliver(payload, abuseSpeech(payload), true, true).then((standing) => {
      if (standing) abuseCardStanding = true;
    });
  };

  // ==========================================================================
  // NAVIGATION
  // ==========================================================================

  let navCardStanding = false;

  const considerRoute = (fix: PositionFix | null): void => {
    const route = useRouteStore.getState().route;
    /*
     * THE ANNOUNCER IS CALLED EVEN WITH NO ROUTE, and that is not a wasted
     * call: passing null is how a trip ENDS, and it is what clears the rungs
     * that have been spent. Skipping it would leave a finished drive's ladder
     * in place, so the next route's first turn would be announced from
     * whichever rung the last one stopped on.
     */
    const { payload } = announcer.consider(route, fix);

    if (route === null) {
      // The drive is over. The turn card outlives nothing.
      if (navCardStanding) {
        navCardStanding = false;
        void notifications.clear(NAVIGATION_TAG);
      }
      return;
    }
    /*
     * Null covers three different silences and all three are correct: nothing
     * is due on this rung, the driver is off the route, or there is no next
     * manoeuvre. `announce.ts` owns which is which; this file only owes it the
     * tick. An off-route driver keeps the card they have - it names where they
     * were going, which is the one thing still true.
     */
    if (payload === null) return;

    void deliver(payload, spokenFor(payload), true, true).then((standing) => {
      if (standing) navCardStanding = true;
    });
  };

  /**
   * A TICK PER FIX, not per WRITE, compared by IDENTITY - the same rule
   * `engineLoop.ts` states for the same store. A heading, a satellite count or
   * an error note is a write to the position slice and is not a new place to
   * be, and running the abuse lookup or the turn ladder for one would spend a
   * rung on no new information.
   */
  let lastFix = usePositionStore.getState().fix;
  const unsubPosition = usePositionStore.subscribe((state) => {
    if (state.fix === null || state.fix === lastFix) return;
    lastFix = state.fix;
    considerAbuse(state.fix);
    considerRoute(state.fix);
  });

  /**
   * A ROUTE IS ALSO NEW INFORMATION ABOUT THE SAME FIX.
   *
   * A driver who plans a route while stopped gets no new fix, and without this
   * the first turn would wait for one - which for a car in a driveway is a
   * minute of silence with a route on the screen. Same reasoning as the camera
   * subscription in `engineLoop.ts`, and the same identity comparison:
   * `planRoute()` returns a fresh object per answer, so a new reference is a
   * new route and anything else is the same one arriving again.
   */
  let lastRoute = useRouteStore.getState().route;
  const unsubRoute = useRouteStore.subscribe((state) => {
    if (state.route === lastRoute) return;
    lastRoute = state.route;
    considerRoute(usePositionStore.getState().fix);
  });

  // A route or a fix may already be in the stores - a delivery started after a
  // drive was under way. Without this the first announcement waits for the next
  // GPS sample, which a stationary car does not produce.
  const existing = usePositionStore.getState().fix;
  if (existing !== null) {
    considerAbuse(existing);
    considerRoute(existing);
  }

  return {
    stop(): void {
      unsubAlert();
      unsubSettings();
      unsubPosition();
      unsubRoute();
      vibration.stop();
      speech.stop();
      notifications.stop();
      /*
       * Take down everything still on the lock screen. A camera alert left
       * standing after the app stopped watching claims a road it is no longer
       * reading, and the same is true of an abuse area and of a turn on a route
       * nothing is following any more.
       *
       * The card PNGs behind them are not revoked here on purpose:
       * `renderCardImage` revokes the previous URL for a tag whenever that tag
       * renders again, so at most three ever exist, and they die with the
       * document. A revoke here would race the close and could blank a card
       * that is still on screen.
       */
      void notifications.clear(CAMERA_ALERT_TAG);
      void notifications.clear(ABUSE_AREA_TAG);
      void notifications.clear(NAVIGATION_TAG);
    },
  };
}
