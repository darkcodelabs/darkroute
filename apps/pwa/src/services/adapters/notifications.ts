/**
 * NOTIFICATIONS - one channel per state, one tag that replaces.
 *
 * Design section 06 is the whole specification: "notifications: silent below
 * threshold, one channel per state, tag replaces so alerts never stack".
 * Onboarding repeats the promise to the user in the permission row: "One
 * channel, replaces itself, never stacks."
 *
 * HOW THAT IS IMPLEMENTED
 *   CHANNEL is per state, carried in `data.channel`, which is what an Android
 *   notification channel keys off. It decides sound and importance.
 *   TAG is what replacement keys off, and every camera alert shares ONE tag.
 *   A per-state tag would satisfy "one channel per state" and then quietly
 *   stack an APPROACHING card under an IN RANGE card, which is the exact
 *   failure the design forbids. County and watchlist get their own tags because
 *   they are not alerts and must not evict one.
 *
 * SILENCE
 *   `clear` and `approaching` are below the alert threshold and post silently.
 *   `in_range` and `multiple` are the alert and may make noise. County entry
 *   and watchlist are ALWAYS silent: "Silent, no vibration - alert haptics stay
 *   reserved for cameras."
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
  | 'county-record'
  | 'watchlist';

/** Every camera alert shares this tag, so a new state replaces the old card. */
export const CAMERA_ALERT_TAG = 'fwm-camera-alert';
export const COUNTY_RECORD_TAG = 'fwm-county-record';
export const WATCHLIST_TAG = 'fwm-watchlist';

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
  'county-record',
  'watchlist',
];

export function isSilentChannel(channel: NotificationChannel): boolean {
  return SILENT_CHANNELS.includes(channel);
}

/** The brand mark, the only image this product ships. */
const BADGE_URL = '/assets/darkroute-mark.png';

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

export interface CountyRecordPayload {
  readonly kind: 'county-record';
  /** "Hamilton Co" */
  readonly county: string;
  readonly incidentCount: number;
  readonly cameraCount: number;
  /** The single citable worst case. Names an agency, never an individual. */
  readonly worstCase?: string;
}

/**
 * Deliberately carries no plate, no camera id and no location. Everything the
 * user needs to identify the read is inside the app, behind the lock screen.
 */
export interface WatchlistPayload {
  readonly kind: 'watchlist';
  readonly newReadCount: number;
}

export type NotificationPayload = CameraAlertPayload | CountyRecordPayload | WatchlistPayload;

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

/** What actually gets handed to the platform. Kept visible for the tests. */
export interface ComposedNotification {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly channel: NotificationChannel;
  readonly silent: boolean;
  readonly renotify: boolean;
  readonly requireInteraction: boolean;
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

/** feet render bare; the unit lives in the copy. Lowercase, blunt. */
function composeCameraAlert(payload: CameraAlertPayload): ComposedNotification {
  const channel = ALERT_CHANNELS[payload.state];
  const silent = isSilentChannel(channel);
  const count = payload.inRangeCount;
  const tail = count > 0 ? ` · ${String(count)} in range` : '';
  return {
    title: `${String(Math.round(payload.distanceFt))} ft`,
    body: `${payload.bearingLabel}${tail}`,
    tag: CAMERA_ALERT_TAG,
    channel,
    silent,
    // A replacement must re-alert, or an approaching card silently mutating
    // into an in-range card would be the only warning the driver gets.
    renotify: !silent,
    requireInteraction: false,
  };
}

/* GAP: see DESIGN-GAPS.md#county-notification-title-and-body-split */
function composeCountyRecord(payload: CountyRecordPayload): ComposedNotification {
  const incidents = String(payload.incidentCount);
  const cameras = String(payload.cameraCount);
  return {
    title: `${payload.county}: ${incidents} documented misuse incidents, ${cameras} cameras.`,
    body: payload.worstCase ?? '',
    tag: COUNTY_RECORD_TAG,
    channel: 'county-record',
    silent: true,
    renotify: false,
    requireInteraction: false,
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
  };
}

export function composeNotification(payload: NotificationPayload): ComposedNotification {
  if (payload.kind === 'camera-alert') return composeCameraAlert(payload);
  if (payload.kind === 'county-record') return composeCountyRecord(payload);
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
  data: { channel: NotificationChannel };
}

function toPlatformOptions(composed: ComposedNotification): NotificationOptions {
  const options: PlatformNotificationOptions = {
    body: composed.body,
    tag: composed.tag,
    silent: composed.silent,
    renotify: composed.renotify,
    requireInteraction: composed.requireInteraction,
    badge: BADGE_URL,
    icon: BADGE_URL,
    data: { channel: composed.channel },
  };
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

export function createNotificationsAdapter(): NotificationsAdapter {
  const core = createCore<NotificationEvent>();
  // Only used on the non-service-worker path, where the platform gives us no
  // way to find a notification again by tag.
  const openByTag = new Map<string, Notification>();

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

      const options = toPlatformOptions(composed);
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
