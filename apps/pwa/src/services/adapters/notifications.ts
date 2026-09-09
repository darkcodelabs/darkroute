/**
 * NOTIFICATIONS - one channel per state, one tag that replaces.
 *
 * Design section 06 is the whole specification: "notifications: silent below
 * threshold, one channel per state, tag replaces so alerts never stack".
 * Onboarding repeats the promise to the user in the permission row: "One
 * channel, replaces itself, never stacks."
 *
 * HOW THAT IS IMPLEMENTED
 *   TAG is what replacement keys off, and every camera alert shares ONE tag.
 *   A per-state tag would satisfy "one channel per state" and then quietly
 *   stack an APPROACHING card under an IN RANGE card, which is the exact
 *   failure the design forbids. County, watchlist and the turn card get their
 *   own tags because they are not camera alerts and must not evict one.
 *
 *   CHANNEL is a JS-side label and NOTHING MORE. This file used to claim that
 *   `data.channel` "is what an Android notification channel keys off", and that
 *   was false in every build that ever shipped. `notification.data` is an
 *   opaque structured-clone value handed back on `notificationclick`; Chrome
 *   never reads it, and the trusted-web-activity delegation AIDL carries only
 *   the platform tag, the id, the Notification itself and ONE channel name that
 *   Chrome chooses. A web page cannot name an Android channel. So every
 *   DarkRoute card lands on one shared channel, and importance, sound and the
 *   OS-level per-channel switch are shared across all of them.
 *
 *   What actually differentiates a state at the platform layer is `silent`,
 *   `renotify`, `vibrate` and the tag. Those are the whole lever set, and this
 *   file now uses all four. Per-state channels need native code -- an override
 *   of `onNotifyNotificationWithChannel` in ExtraFeaturesService -- and until
 *   that exists nothing here may pretend otherwise.
 *
 * SILENCE
 *   `clear` and `approaching` are below the alert threshold and post silently.
 *   `in_range` and `multiple` are the alert and may make noise. Watchlist is
 *   ALWAYS silent. County entry is NOT: a driver entering a jurisdiction with a
 *   documented misuse record asked to be told, and telling them silently is not
 *   telling them. Its haptic is deliberately unlike a camera's -- see the
 *   pattern table in vibration.ts.
 *
 * PRIVACY
 *   `show()` takes a structured payload, never a string. There is no parameter
 *   on the watchlist notification that a licence plate could be passed through,
 *   so a plate cannot reach a lock screen even by mistake. The emitted event
 *   carries a channel and a tag and no text at all, so subscribers (and any
 *   future logging path) have nothing sensitive to spill.
 *   This is a deliberate departure from screen B5, which renders the plate and
 *   the cross street in the watchlist card. On-device that is fine; on a lock
 *   screen it is not. See DESIGN-GAPS.md#watchlist-notification-omits-plate.
 */

import { createCore } from './core';
import {
  errorMessage,
  globalValue,
  nav,
  no,
  ok,
  type Adapter,
  type AlertState,
  type Capability,
  type PermissionOutcome,
  type RequestOutcome,
} from './types';

export type NotificationChannel =
  | 'alert-clear'
  | 'alert-approaching'
  | 'alert-in-range'
  | 'alert-multiple'
  | 'abuse-area'
  | 'watchlist'
  | 'navigation';

/** Every camera alert shares this tag, so a new state replaces the old card. */
export const CAMERA_ALERT_TAG = 'fwm-camera-alert';
/**
 * Was COUNTY_RECORD_TAG. The product calls this abuse everywhere a driver can
 * read it -- the abuse key, "show areas of abuse", "alert when entering abuse
 * area" -- and the code called it a county record, which is the unit the data
 * happens to be filed under rather than the thing being reported. One name.
 */
export const ABUSE_AREA_TAG = 'fwm-abuse-area';
export const WATCHLIST_TAG = 'fwm-watchlist';
/**
 * The turn card owns its own tag and replaces itself the whole drive. It must
 * never share the camera tag: a camera alert that evicted the next turn, or a
 * turn that evicted a camera warning, would each be the other one's fault.
 */
export const NAVIGATION_TAG = 'fwm-navigation';

export const ALERT_CHANNELS: Readonly<Record<AlertState, NotificationChannel>> = {
  clear: 'alert-clear',
  approaching: 'alert-approaching',
  in_range: 'alert-in-range',
  multiple: 'alert-multiple',
};

/** Below the threshold nothing may make a sound. */
export const SILENT_CHANNELS: readonly NotificationChannel[] = [
  'alert-clear',
  'alert-approaching',
  'watchlist',
];

export function isSilentChannel(channel: NotificationChannel): boolean {
  return SILENT_CHANNELS.includes(channel);
}

/**
 * BADGE is the small status-bar stencil. Android draws it as a ~24dp alpha
 * mask, so it has to be single-colour-plus-alpha or it renders as a grey
 * smear. `darkroute-mark.png` is pure white with an alpha channel and ~12%
 * built-in padding, which is exactly the shape that slot wants.
 */
const BADGE_URL = '/assets/darkroute-mark.png';

/**
 * ICON is the large icon on the right of the card, drawn UNTINTED. The badge
 * mark was used here too, which meant a white-on-transparent glyph rendered
 * invisible on a light notification shade -- a real part of "the cards look
 * plain". The full-colour app icon is the correct asset for an untinted slot.
 */
const ICON_URL = '/assets/darkroute-app-icon.png';

/**
 * How long the card renderer gets before the alert goes out without it. A
 * warning that waited on a picture would be a warning that arrived late, and
 * late is the one thing this product cannot be.
 */
const CARD_DEADLINE_MS = 250;

export interface CameraAlertPayload {
  readonly kind: 'camera-alert';
  readonly state: AlertState;
  /** Distance to the nearest camera, in feet, as RADAR renders it. */
  readonly distanceFt: number;
  /** "ahead · slight left" - a bearing phrase, never a street or a coordinate. */
  readonly bearingLabel: string;
  /** How many cameras are inside the threshold right now. */
  readonly inRangeCount: number;
}

export interface AbuseAreaPayload {
  readonly kind: 'abuse-area';
  /**
   * ENTERED means the driver crossed into the area. NEARBY means a documented
   * incident is close but the area has not been entered. They are different
   * sentences and they must not be collapsed: one is "you are in it", the
   * other is "it is over there".
   */
  readonly trigger: 'entered' | 'nearby';
  /** "Hamilton Co" */
  readonly county: string;
  readonly incidentCount: number;
  readonly cameraCount: number;
  /** Only meaningful for `nearby`. Feet to the nearest documented incident. */
  readonly distanceFt?: number;
  /** The single citable worst case. Names an agency, never an individual. */
  readonly worstCase?: string;
}

/**
 * THE TURN CARD.
 *
 * Carries a street name, which is a departure from every other payload in this
 * file. That is deliberate and it is the one place it is right: the driver
 * asked for this route, typed the destination, and a turn instruction that
 * refuses to name the street is not an instruction. The camera payloads still
 * refuse a street, because nobody asked to have their position narrated.
 */
export interface NavigationPayload {
  readonly kind: 'navigation';
  /** The router's own sentence: "Turn right onto West 119th Street." */
  readonly instruction: string;
  /** One of `TurnKind` from services/route. Chooses the glyph on the card. */
  readonly turn: string;
  /** Distance to the manoeuvre along the road, in feet. */
  readonly distanceFt: number;
  /** Minutes remaining for the whole trip, when the route knows. */
  readonly etaMinutes?: number;
  /** Miles remaining for the whole trip, when the route knows. */
  readonly milesRemaining?: number;
  /**
   * Cameras the route is still routing around. Omitted from the card at zero:
   * "0 avoided" is a line that costs a glance to read and tells the driver
   * nothing they did not already know from the absence of a warning.
   */
  readonly avoided?: number;
  /** True for the final manoeuvre, which takes the card down after it. */
  readonly arriving?: boolean;
}

/**
 * Deliberately carries no plate, no camera id and no location. Everything the
 * user needs to identify the read is inside the app, behind the lock screen.
 */
export interface WatchlistPayload {
  readonly kind: 'watchlist';
  readonly newReadCount: number;
}

export type NotificationPayload =
  | CameraAlertPayload
  | AbuseAreaPayload
  | WatchlistPayload
  | NavigationPayload;

/** Every payload kind, in one list, so a test menu can enumerate them. */
export const NOTIFICATION_KINDS = [
  'camera-alert',
  'abuse-area',
  'watchlist',
  'navigation',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationOutcome = 'shown' | 'cleared' | 'blocked' | 'unsupported' | 'failed';

export interface NotificationEvent {
  readonly channel: NotificationChannel;
  readonly tag: string;
  readonly outcome: NotificationOutcome;
  readonly silent: boolean;
  readonly timestamp: number;
}

export interface NotificationResult {
  readonly outcome: NotificationOutcome;
  readonly channel: NotificationChannel;
  readonly tag: string;
  readonly silent: boolean;
  readonly reason?: string;
}

/**
 * One button on the card. Android shows at most `Notification.maxActions` of
 * them (two, on Chrome), and they are the one part of a web notification that
 * bridges to a watch as something tappable -- which is why they are here and
 * why the list is ordered most-useful-first rather than alphabetically.
 *
 * `icon` is deliberately absent. Android ignores action icons; only desktop
 * draws them, and a field that works on one platform and is silently dropped
 * on the one we ship to is a field that will be believed.
 */
export interface NotificationAction {
  readonly action: string;
  readonly title: string;
}

/** What actually gets handed to the platform. Kept visible for the tests. */
export interface ComposedNotification {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly channel: NotificationChannel;
  readonly silent: boolean;
  readonly renotify: boolean;
  readonly requireInteraction: boolean;
  /**
   * The haptic signature, in `navigator.vibrate` form, carried ON the
   * notification rather than fired separately from the page.
   *
   * This is the field whose absence was the whole "it does not buzz" bug. A
   * page-side `navigator.vibrate` needs a visible document with user
   * activation, which is exactly what a phone in a mount with the screen off
   * does not have. The notification manager has no such requirement.
   *
   * Honesty about what the platform does with it: on Android 8+ a channel owns
   * vibration, so the pattern is a request rather than a guarantee. What IS
   * guaranteed is the difference between asking and not asking, and until now
   * this code never asked.
   */
  readonly vibrate: readonly number[];
  /** `when` on the Android card. The moment detected, not the moment posted. */
  readonly timestamp: number;
  readonly actions: readonly NotificationAction[];
  /** Where a tap should land. Read back by the worker's notificationclick. */
  readonly url: string;
}

/**
 * Renders the branded mini-card that becomes the notification's `image`.
 *
 * Injected rather than imported so this adapter stays a pure string composer
 * that a test can run without a canvas. `null` means "no card this time" and
 * is a normal answer, not a failure: the notification still posts, just
 * without the picture.
 */
export type CardRenderer = (payload: NotificationPayload) => Promise<string | null>;

export interface NotificationsAdapterOptions {
  readonly renderCard?: CardRenderer;
}

export interface NotificationsAdapter extends Adapter<NotificationEvent> {
  permission(): Promise<PermissionOutcome>;
  request(): Promise<RequestOutcome>;
  show(payload: NotificationPayload): Promise<NotificationResult>;
  /** Close whatever is on screen for this tag. Never throws. */
  clear(tag: string): Promise<void>;
  compose(payload: NotificationPayload): ComposedNotification;
}

interface NotificationCtorLike {
  new (title: string, options?: NotificationOptions): Notification;
  permission: NotificationPermission;
  requestPermission?: () => Promise<NotificationPermission>;
}

function notificationCtor(): NotificationCtorLike | undefined {
  return globalValue<NotificationCtorLike>('Notification');
}

export function notificationsCapability(): Capability {
  if (notificationCtor() === undefined) {
    return no('the Notification API is not available in this browser');
  }
  const secure = globalValue<boolean>('isSecureContext');
  if (secure === false) {
    return no('notifications need a secure context (https or localhost); this page is not one');
  }
  return ok();
}

/**
 * THE HAPTIC SIGNATURES.
 *
 * Three shapes a driver can tell apart without looking, which is the entire
 * point of a haptic in a car:
 *
 *   camera    two firm pulses      the warning. Reserved. Nothing else uses it.
 *   abuse     one long, one short  a record, not a road hazard.
 *   turn      one short pulse      a cue, the quietest thing here.
 *
 * The old page-side patterns were `[90, 90, 90]` -- two 90ms taps, at or below
 * the perceptible floor through a pocket or a phone mount, which is the second
 * half of why the test alert felt like it did nothing. These are longer on
 * purpose. They live here rather than in tokens.json because a vibration
 * duration is not a design token: 90ms is a correct animation and a wrong buzz,
 * and pointing both at `duration.instant` is what made them the same number.
 */
export const CAMERA_VIBRATION: readonly number[] = [0, 260, 120, 260];
export const ABUSE_VIBRATION: readonly number[] = [0, 400, 140, 160];
export const NAVIGATION_VIBRATION: readonly number[] = [0, 180];
export const SILENT_VIBRATION: readonly number[] = [];

/** feet render bare; the unit lives in the copy. Lowercase, blunt. */
function composeCameraAlert(payload: CameraAlertPayload): ComposedNotification {
  const channel = ALERT_CHANNELS[payload.state];
  const silent = isSilentChannel(channel);
  const count = payload.inRangeCount;
  /*
   * The count only earns a place when it says something the title does not.
   * "1 in range" next to a distance is the same fact twice; two or more is a
   * different fact. This is also what let the test alert print "no camera is
   * near you · 1 in range": one author wrote a disclaimer into the bearing
   * slot, and this line appended a contradiction it could not see.
   */
  const tail = count > 1 ? ` · ${String(count)} in range` : '';
  const bearing = payload.bearingLabel.trim();
  const body = bearing.length > 0 ? `${bearing}${tail}` : tail.replace(' · ', '');
  return {
    title: `${String(Math.round(payload.distanceFt))} ft`,
    body,
    tag: CAMERA_ALERT_TAG,
    channel,
    silent,
    // A replacement must re-alert, or an approaching card silently mutating
    // into an in-range card would be the only warning the driver gets.
    renotify: !silent,
    requireInteraction: false,
    vibrate: silent ? SILENT_VIBRATION : CAMERA_VIBRATION,
    timestamp: Date.now(),
    actions: [
      { action: 'mute', title: 'Mute 10 min' },
      { action: 'open', title: 'Open' },
    ],
    url: '/?screen=drive',
  };
}

function composeAbuseArea(payload: AbuseAreaPayload): ComposedNotification {
  const incidents = String(payload.incidentCount);
  const cameras = String(payload.cameraCount);
  const entered = payload.trigger === 'entered';
  /*
   * Two sentences, not one with a conditional clause in it. The old composer
   * put the whole record in the title, where Android truncates it at roughly
   * forty characters and the number the driver needed fell off the end.
   */
  const title = entered
    ? `entering ${payload.county}`
    : `${payload.county} · ${String(Math.round(payload.distanceFt ?? 0))} ft`;
  const record = `${incidents} documented misuse · ${cameras} cameras`;
  return {
    title,
    body: payload.worstCase === undefined ? record : `${record} · ${payload.worstCase}`,
    tag: ABUSE_AREA_TAG,
    channel: 'abuse-area',
    // NOT silent. See the header: a driver who asked to be told they are
    // entering a jurisdiction with a record is not told by a silent card.
    silent: false,
    renotify: true,
    requireInteraction: false,
    vibrate: ABUSE_VIBRATION,
    timestamp: Date.now(),
    actions: [
      { action: 'records', title: 'See records' },
      { action: 'mute', title: 'Mute 10 min' },
    ],
    url: '/?screen=abuse',
  };
}

function composeNavigation(payload: NavigationPayload): ComposedNotification {
  const ft = Math.round(payload.distanceFt);
  /*
   * Under 100 ft the number stops helping and starts arriving late. "now" is
   * what a driver needs at the mouth of the turn.
   */
  const lead = payload.arriving === true ? 'arriving' : ft < 100 ? 'now' : `${String(ft)} ft`;
  const parts: string[] = [];
  if (payload.etaMinutes !== undefined) parts.push(`${String(Math.round(payload.etaMinutes))} min`);
  if (payload.milesRemaining !== undefined) {
    parts.push(`${payload.milesRemaining.toFixed(1)} mi`);
  }
  if (payload.avoided !== undefined && payload.avoided > 0) {
    parts.push(`${String(payload.avoided)} avoided`);
  }
  return {
    title: `${lead} · ${payload.instruction}`,
    body: parts.join(' · '),
    tag: NAVIGATION_TAG,
    channel: 'navigation',
    silent: false,
    renotify: true,
    requireInteraction: false,
    vibrate: NAVIGATION_VIBRATION,
    timestamp: Date.now(),
    actions: [
      { action: 'reroute', title: 'Reroute' },
      { action: 'end', title: 'End' },
    ],
    url: '/?screen=drive',
  };
}

/* GAP: see DESIGN-GAPS.md#watchlist-notification-omits-plate */
function composeWatchlist(payload: WatchlistPayload): ComposedNotification {
  const n = payload.newReadCount;
  return {
    title: n === 1 ? 'new read on a watched plate' : `${String(n)} new reads on watched plates`,
    body: 'open darkroute to see which one.',
    tag: WATCHLIST_TAG,
    channel: 'watchlist',
    silent: true,
    renotify: false,
    requireInteraction: false,
    vibrate: SILENT_VIBRATION,
    timestamp: Date.now(),
    actions: [{ action: 'open', title: 'Open' }],
    url: '/?screen=watchlist',
  };
}

export function composeNotification(payload: NotificationPayload): ComposedNotification {
  if (payload.kind === 'camera-alert') return composeCameraAlert(payload);
  if (payload.kind === 'abuse-area') return composeAbuseArea(payload);
  if (payload.kind === 'navigation') return composeNavigation(payload);
  return composeWatchlist(payload);
}

/**
 * Fields that lib.dom types inconsistently across TypeScript versions (renotify
 * and friends moved to the service-worker variant). Declared here so the option
 * object is fully typed on the way out and cast exactly once.
 */
interface PlatformNotificationOptions {
  body: string;
  tag: string;
  silent: boolean;
  renotify: boolean;
  requireInteraction: boolean;
  badge: string;
  icon: string;
  timestamp: number;
  vibrate?: number[];
  image?: string;
  actions?: NotificationAction[];
  data: { channel: NotificationChannel; kind: NotificationKind; url: string };
}

/**
 * Android shows two action buttons; desktop shows more. Ask the platform
 * rather than hard-coding two, and tolerate the property being absent.
 */
function maxActions(): number {
  const ctor = notificationCtor() as unknown as { maxActions?: number } | undefined;
  const declared = ctor?.maxActions;
  return typeof declared === 'number' && declared >= 0 ? declared : 2;
}

function toPlatformOptions(
  composed: ComposedNotification,
  kind: NotificationKind,
  image: string | null,
): NotificationOptions {
  const options: PlatformNotificationOptions = {
    body: composed.body,
    tag: composed.tag,
    silent: composed.silent,
    renotify: composed.renotify,
    requireInteraction: composed.requireInteraction,
    badge: BADGE_URL,
    icon: ICON_URL,
    timestamp: composed.timestamp,
    data: { channel: composed.channel, kind, url: composed.url },
  };
  /*
   * `silent: true` and a vibration pattern are a contradiction, and Chrome
   * resolves it by honouring the silence. Sending both would leave a reader of
   * this code believing the quiet channels buzz.
   */
  if (!composed.silent && composed.vibrate.length > 0) {
    options.vibrate = [...composed.vibrate];
  }
  const allowed = maxActions();
  if (allowed > 0 && composed.actions.length > 0) {
    options.actions = composed.actions.slice(0, allowed).map((a) => ({ ...a }));
  }
  if (image !== null) options.image = image;
  return options as unknown as NotificationOptions;
}

interface RegistrationLike {
  showNotification?: (title: string, options?: NotificationOptions) => Promise<void>;
  getNotifications?: (filter?: { tag?: string }) => Promise<Notification[]>;
}

async function serviceWorkerRegistration(): Promise<RegistrationLike | undefined> {
  const container = nav()?.serviceWorker;
  if (!container || typeof container.getRegistration !== 'function') return undefined;
  try {
    const registration = await container.getRegistration();
    if (registration && typeof registration.showNotification === 'function') {
      return registration as unknown as RegistrationLike;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function createNotificationsAdapter(
  options: NotificationsAdapterOptions = {},
): NotificationsAdapter {
  const core = createCore<NotificationEvent>();
  // Only used on the non-service-worker path, where the platform gives us no
  // way to find a notification again by tag.
  const openByTag = new Map<string, Notification>();
  const renderCard = options.renderCard;

  /**
   * The card is a nice-to-have and the warning is not. A renderer that throws,
   * hangs on a font, or runs somewhere without a canvas must cost the driver
   * nothing, so it is raced against a deadline and every failure resolves to
   * "post it without the picture".
   */
  const cardFor = async (payload: NotificationPayload): Promise<string | null> => {
    if (renderCard === undefined) return null;
    try {
      return await Promise.race([
        renderCard(payload),
        new Promise<null>((resolve) => {
          setTimeout(() => {
            resolve(null);
          }, CARD_DEADLINE_MS);
        }),
      ]);
    } catch {
      return null;
    }
  };

  const emit = (result: NotificationResult): NotificationResult => {
    core.emit({
      channel: result.channel,
      tag: result.tag,
      outcome: result.outcome,
      silent: result.silent,
      timestamp: Date.now(),
    });
    return result;
  };

  const closeLocal = (tag: string): void => {
    const open = openByTag.get(tag);
    if (open) {
      try {
        open.close();
      } catch {
        // Already closed by the platform. Nothing to recover.
      }
      openByTag.delete(tag);
    }
  };

  // Standalone, not a method: `show()` needs it and must not depend on `this`,
  // which disappears the moment a caller destructures the adapter.
  const clearTag = async (tag: string): Promise<void> => {
    closeLocal(tag);
    const registration = await serviceWorkerRegistration();
    if (!registration?.getNotifications) return;
    try {
      const open = await registration.getNotifications({ tag });
      for (const notification of open) notification.close();
    } catch {
      // Nothing to close, or the registration went away. Either is fine.
    }
  };

  return {
    name: 'notifications',

    capability: notificationsCapability,

    /** Passive read. Never prompts. */
    async permission(): Promise<PermissionOutcome> {
      const ctor = notificationCtor();
      if (ctor === undefined) return 'unavailable';
      if (ctor.permission === 'granted') return 'granted';
      if (ctor.permission === 'denied') return 'denied';
      return 'prompt';
    },

    /**
     * USER GESTURE ONLY. Wire this to the onboarding "NOTIFICATIONS · ALLOW"
     * row. Chrome ignores a request that is not tied to a user activation, and
     * a prompt on page load is how a user learns to press Block forever.
     */
    async request(): Promise<RequestOutcome> {
      const ctor = notificationCtor();
      if (ctor === undefined) return 'unavailable';
      if (typeof ctor.requestPermission !== 'function') return 'unavailable';
      try {
        const state = await ctor.requestPermission();
        return state === 'granted' ? 'granted' : 'denied';
      } catch (cause) {
        core.fail(
          'permission-request-failed',
          errorMessage(cause, 'the notification permission request failed'),
        );
        return 'denied';
      }
    },

    /** Enable posting. Does not prompt: an ungranted permission is an error. */
    start(): void {
      const capability = notificationsCapability();
      if (!capability.supported) {
        core.fail('unsupported', capability.reason ?? 'notifications are not available');
        return;
      }
      if (notificationCtor()?.permission !== 'granted') {
        core.fail('not-granted', 'notification permission has not been granted');
        core.setRunning(false);
        return;
      }
      core.clearError();
      core.setRunning(true);
    },

    /** Stop posting and take down anything still on screen. Idempotent. */
    stop(): void {
      for (const tag of [...openByTag.keys()]) closeLocal(tag);
      core.setRunning(false);
    },

    compose: composeNotification,

    async show(payload: NotificationPayload): Promise<NotificationResult> {
      const composed = composeNotification(payload);
      const base = { channel: composed.channel, tag: composed.tag, silent: composed.silent };

      const capability = notificationsCapability();
      if (!capability.supported) {
        return emit({
          ...base,
          outcome: 'unsupported',
          reason: capability.reason ?? 'notifications are not available',
        });
      }
      if (notificationCtor()?.permission !== 'granted') {
        return emit({ ...base, outcome: 'blocked', reason: 'notification permission not granted' });
      }
      if (!core.running()) {
        return emit({
          ...base,
          outcome: 'blocked',
          reason: 'the notifications adapter is stopped',
        });
      }
      // CLEAR is the absence of an alert. It takes the alert card down rather
      // than posting a card that says nothing is wrong.
      if (payload.kind === 'camera-alert' && payload.state === 'clear') {
        await clearTag(CAMERA_ALERT_TAG);
        return emit({ ...base, outcome: 'cleared' });
      }

      const options = toPlatformOptions(composed, payload.kind, await cardFor(payload));
      try {
        const registration = await serviceWorkerRegistration();
        if (registration?.showNotification) {
          await registration.showNotification(composed.title, options);
        } else {
          const Ctor = notificationCtor();
          if (Ctor === undefined) {
            return emit({ ...base, outcome: 'unsupported', reason: 'no Notification constructor' });
          }
          closeLocal(composed.tag);
          openByTag.set(composed.tag, new Ctor(composed.title, options));
        }
        core.clearError();
        return emit({ ...base, outcome: 'shown' });
      } catch (cause) {
        const reason = errorMessage(cause, 'the notification could not be shown');
        core.fail('show-failed', reason);
        return emit({ ...base, outcome: 'failed', reason });
      }
    },

    clear: clearTag,

    current: core.current,
    error: core.error,
    subscribe: core.subscribe,
  };
}
