/**
 * DEVICE MOTION - accelerometer and gyroscope.
 *
 * Used for two things and nothing else: telling "the car is moving" from "the
 * car is parked" (the watchlist screen's NOTIFY WHEN PARKED switch depends on
 * that distinction) and steadying the compass reading while reporting a camera.
 *
 * It is never used to derive position. Dead reckoning off a phone accelerometer
 * would be a location trace built without a location permission, which is
 * exactly the kind of thing this product exists to object to.
 */

import { createCore, createListenerBag, numberOrNull } from './core';
import {
  errorMessage,
  globalValue,
  no,
  ok,
  type Adapter,
  type Capability,
  type PermissionOutcome,
  type RequestOutcome,
} from './types';

export interface Vector3 {
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
}

export interface RotationRate {
  readonly alpha: number | null;
  readonly beta: number | null;
  readonly gamma: number | null;
}

export interface MotionSample {
  /** Metres per second squared, gravity excluded. Null on devices that only
   *  report the gravity-inclusive vector. */
  readonly accelerationMps2: Vector3 | null;
  readonly accelerationWithGravityMps2: Vector3 | null;
  /** Degrees per second. */
  readonly rotationRateDegPerS: RotationRate | null;
  /** Platform's sampling interval in milliseconds, when it reports one. */
  readonly intervalMs: number | null;
  readonly timestamp: number;
}

export interface MotionAdapter extends Adapter<MotionSample> {
  permission(): Promise<PermissionOutcome>;
  request(): Promise<RequestOutcome>;
  /** Magnitude of the last gravity-excluded acceleration vector, or null. */
  lastMagnitude(): number | null;
}

interface MotionConstructorLike {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
}

function motionCtor(): MotionConstructorLike | undefined {
  return globalValue<MotionConstructorLike>('DeviceMotionEvent');
}

export function motionCapability(): Capability {
  if (motionCtor() === undefined) {
    return no('DeviceMotionEvent is not available in this browser');
  }
  return ok();
}

function vector(input: DeviceMotionEventAcceleration | null | undefined): Vector3 | null {
  if (!input) return null;
  const x = numberOrNull(input.x);
  const y = numberOrNull(input.y);
  const z = numberOrNull(input.z);
  if (x === null && y === null && z === null) return null;
  return { x, y, z };
}

export function magnitudeOf(v: Vector3 | null): number | null {
  if (v === null) return null;
  const x = v.x ?? 0;
  const y = v.y ?? 0;
  const z = v.z ?? 0;
  return Math.sqrt(x * x + y * y + z * z);
}

export function sampleFromEvent(event: DeviceMotionEvent, atMs: number): MotionSample {
  const rate = event.rotationRate;
  return {
    accelerationMps2: vector(event.acceleration),
    accelerationWithGravityMps2: vector(event.accelerationIncludingGravity),
    rotationRateDegPerS: rate
      ? {
          alpha: numberOrNull(rate.alpha),
          beta: numberOrNull(rate.beta),
          gamma: numberOrNull(rate.gamma),
        }
      : null,
    intervalMs: numberOrNull(event.interval),
    timestamp: atMs,
  };
}

export function createMotionAdapter(): MotionAdapter {
  const core = createCore<MotionSample>();
  const listeners = createListenerBag();

  return {
    name: 'motion',

    capability: motionCapability,

    async permission(): Promise<PermissionOutcome> {
      if (!motionCapability().supported) return 'unavailable';
      if (typeof motionCtor()?.requestPermission !== 'function') return 'granted';
      return 'prompt';
    },

    /**
     * USER GESTURE ONLY. iOS rejects this outside a tap handler. Motion is
     * OPTIONAL in onboarding; a denial must leave every other screen working.
     */
    async request(): Promise<RequestOutcome> {
      const ctor = motionCtor();
      if (ctor === undefined) return 'unavailable';
      const requestPermission = ctor.requestPermission;
      if (typeof requestPermission !== 'function') return 'granted';
      try {
        return (await requestPermission()) === 'granted' ? 'granted' : 'denied';
      } catch (cause) {
        core.fail('permission-request-failed', errorMessage(cause, 'motion permission failed'));
        return 'denied';
      }
    },

    /** Idempotent. */
    start(): void {
      const capability = motionCapability();
      if (!capability.supported) {
        core.fail('unsupported', capability.reason ?? 'motion sensors are not available');
        return;
      }
      if (core.running()) return;
      core.setRunning(true);
      listeners.on(globalValue<EventTarget>('window'), 'devicemotion', (event) => {
        core.clearError();
        core.emit(sampleFromEvent(event as DeviceMotionEvent, Date.now()));
      });
    },

    /** Idempotent. */
    stop(): void {
      listeners.removeAll();
      core.setRunning(false);
    },

    current: core.current,
    error: core.error,
    subscribe: core.subscribe,

    lastMagnitude(): number | null {
      return magnitudeOf(core.current()?.accelerationMps2 ?? null);
    },
  };
}
