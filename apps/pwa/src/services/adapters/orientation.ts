/**
 * COMPASS / DEVICE ORIENTATION.
 *
 * One job: which way is the phone pointing. The report sheet uses it to
 * auto-fill "FACING · FROM COMPASS · 223° · covering the northbound lane", and
 * the watch report shows "HEADING 223°". Onboarding lists motion sensors as
 * OPTIONAL, and this adapter is built to be exactly that - the report sheet
 * still works with the arc adjusted by hand when there is no magnetometer.
 *
 * WHAT THIS CANNOT PROMISE
 *   `DeviceOrientationEvent` existing does not mean a magnetometer exists, and
 *   a non-absolute event carries a heading relative to wherever the device
 *   happened to be at page load - which is worthless as a compass. So the
 *   adapter waits for a usable event and records `no-heading-data` when none
 *   arrives, rather than emitting a number that looks like a bearing.
 *
 * SCREEN ROTATION
 *   Not compensated, deliberately: the PWA is orientation-locked to
 *   portrait-primary (design section 06), so screen angle is a constant here.
 *   If that lock is ever lifted this file needs `screen.orientation.angle`
 *   folded into the heading and a test to prove it.
 */

import { createCore, createListenerBag, numberOrNull } from './core';
import {
  doc,
  errorMessage,
  globalValue,
  no,
  ok,
  type Adapter,
  type Capability,
  type PermissionOutcome,
  type RequestOutcome,
} from './types';

export type HeadingSource = 'webkit-compass' | 'absolute-orientation' | 'relative-orientation';

export interface Heading {
  /** Degrees clockwise from north, 0 <= headingDeg < 360. */
  readonly headingDeg: number;
  readonly source: HeadingSource;
  /** Platform's own accuracy claim in degrees, when it makes one. */
  readonly accuracyDeg: number | null;
  /** False means the value drifts and must not be shown as a bearing. */
  readonly absolute: boolean;
  readonly timestamp: number;
}

export interface OrientationAdapter extends Adapter<Heading> {
  permission(): Promise<PermissionOutcome>;
  request(): Promise<RequestOutcome>;
  /** True once at least one usable absolute heading has arrived. */
  hasFix(): boolean;
}

/**
 * How long to wait for the first usable event before saying so. Sensor timing,
 * not a design duration: nothing on screen is animated by this number.
 */
export const HEADING_WAIT_MS = 4_000;

/** iOS 13+ gates the event behind a call that must come from a user gesture. */
interface OrientationConstructorLike {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
}

function orientationCtor(): OrientationConstructorLike | undefined {
  return globalValue<OrientationConstructorLike>('DeviceOrientationEvent');
}

function needsIosPermission(): boolean {
  return typeof orientationCtor()?.requestPermission === 'function';
}

export function orientationCapability(): Capability {
  if (orientationCtor() === undefined) {
    return no('DeviceOrientationEvent is not available in this browser');
  }
  if (globalValue<unknown>('addEventListener') === undefined && doc() === undefined) {
    return no('no window to receive orientation events');
  }
  return ok();
}

function normaliseDegrees(value: number): number {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Turn one event into a heading, or null when it carries nothing usable.
 * Exported because the conversion is the only interesting logic in this file
 * and it deserves a direct test rather than an event-plumbing test.
 */
export function headingFromEvent(event: DeviceOrientationEvent, atMs: number): Heading | null {
  const raw = event as unknown as Record<string, unknown>;

  // iOS: already a true-north compass heading, clockwise. Preferred when present.
  const webkit = numberOrNull(raw['webkitCompassHeading']);
  if (webkit !== null) {
    const accuracy = numberOrNull(raw['webkitCompassAccuracy']);
    return {
      headingDeg: normaliseDegrees(webkit),
      source: 'webkit-compass',
      // iOS reports -1 when the compass is uncalibrated. That is not an accuracy.
      accuracyDeg: accuracy !== null && accuracy >= 0 ? accuracy : null,
      absolute: true,
      timestamp: atMs,
    };
  }

  const alpha = numberOrNull(event.alpha);
  if (alpha === null) return null;

  // Spec alpha counts counter-clockwise from north, so a compass bearing is its
  // mirror. `absolute` false means the zero point is arbitrary: still emitted,
  // flagged, and the caller must not render it as a bearing.
  const absolute = event.absolute === true;
  return {
    headingDeg: normaliseDegrees(360 - alpha),
    source: absolute ? 'absolute-orientation' : 'relative-orientation',
    accuracyDeg: null,
    absolute,
    timestamp: atMs,
  };
}

export function createOrientationAdapter(): OrientationAdapter {
  const core = createCore<Heading>();
  const listeners = createListenerBag();
  let absoluteFix = false;
  let waitTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelWait = (): void => {
    if (waitTimer !== null) {
      clearTimeout(waitTimer);
      waitTimer = null;
    }
  };

  const onEvent = (event: Event): void => {
    const heading = headingFromEvent(event as DeviceOrientationEvent, Date.now());
    if (heading === null) return;
    if (heading.absolute) {
      absoluteFix = true;
      cancelWait();
      core.clearError();
    }
    core.emit(heading);
  };

  return {
    name: 'orientation',

    capability: orientationCapability,

    async permission(): Promise<PermissionOutcome> {
      if (!orientationCapability().supported) return 'unavailable';
      // Android/desktop have no permission for this event. iOS has one but
      // offers no passive read of it, so `prompt` is the honest answer until
      // request() has been through a user gesture.
      if (!needsIosPermission()) return 'granted';
      return 'prompt';
    },

    /**
     * USER GESTURE ONLY. iOS throws unless this is called inside a click or tap
     * handler. Wire it to the onboarding "MOTION SENSORS · OPTIONAL" row.
     */
    async request(): Promise<RequestOutcome> {
      const ctor = orientationCtor();
      if (ctor === undefined) return 'unavailable';
      const requestPermission = ctor.requestPermission;
      if (typeof requestPermission !== 'function') return 'granted';
      try {
        const state = await requestPermission();
        if (state === 'granted') return 'granted';
        return 'denied';
      } catch (cause) {
        core.fail('permission-request-failed', errorMessage(cause, 'compass permission failed'));
        return 'denied';
      }
    },

    /** Idempotent. Listens to both event names; whichever fires, wins. */
    start(): void {
      const capability = orientationCapability();
      if (!capability.supported) {
        core.fail('unsupported', capability.reason ?? 'compass is not available');
        return;
      }
      if (core.running()) return;
      core.setRunning(true);

      const target = globalValue<EventTarget>('window');
      listeners.on(target, 'deviceorientationabsolute', onEvent);
      listeners.on(target, 'deviceorientation', onEvent);

      waitTimer = setTimeout(() => {
        waitTimer = null;
        if (!absoluteFix) {
          core.fail(
            'no-heading-data',
            'no absolute compass heading from this device; set the facing arc by hand',
          );
        }
      }, HEADING_WAIT_MS);
    },

    /** Idempotent. */
    stop(): void {
      cancelWait();
      listeners.removeAll();
      core.setRunning(false);
    },

    current: core.current,
    error: core.error,
    subscribe: core.subscribe,

    hasFix(): boolean {
      return absoluteFix;
    },
  };
}
