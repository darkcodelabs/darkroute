/**
 * AMBIENT LIGHT SENSOR.
 *
 * The only thing this is for: deciding, without asking, that the car went into
 * a tunnel or that the sun went down, so the display can drop to the dimmest
 * mode. It is a nicety. Nothing about alerting depends on it.
 *
 * EXPECT THIS TO BE UNSUPPORTED
 *   `AmbientLightSensor` ships in Chromium only, behind
 *   chrome://flags/#enable-generic-sensor-extra-classes, and nowhere else at
 *   all. The honest default answer on every phone in the field today is "no",
 *   and that is what `capability()` returns. Screens must key off the clock or
 *   an explicit setting; they must not wait for a lux reading that will never
 *   arrive.
 */

import { createCore } from './core';
import {
  errorMessage,
  globalValue,
  no,
  ok,
  queryPermission,
  type Adapter,
  type Capability,
  type PermissionOutcome,
  type RequestOutcome,
} from './types';

export interface AmbientLightSample {
  readonly illuminanceLux: number;
  readonly timestamp: number;
}

export interface AmbientLightAdapter extends Adapter<AmbientLightSample> {
  permission(): Promise<PermissionOutcome>;
  request(): Promise<RequestOutcome>;
  /** Placeholder-free convenience: null when there has never been a reading. */
  lux(): number | null;
}

/** Sensor polling rate in hertz. A sensor tuning value, not a design duration. */
export const SENSOR_FREQUENCY_HZ = 1;

interface SensorLike {
  illuminance?: number;
  start: () => void;
  stop: () => void;
  addEventListener: (type: string, handler: (event?: Event) => void) => void;
}

type SensorCtor = new (options?: { frequency?: number }) => SensorLike;

function sensorCtor(): SensorCtor | undefined {
  return globalValue<SensorCtor>('AmbientLightSensor');
}

export function ambientLightCapability(): Capability {
  if (sensorCtor() === undefined) {
    return no('AmbientLightSensor is not available in this browser (chromium-only, behind a flag)');
  }
  const secure = globalValue<boolean>('isSecureContext');
  if (secure === false) {
    return no('sensors need a secure context (https or localhost); this page is not one');
  }
  return ok();
}

export function createAmbientLightAdapter(): AmbientLightAdapter {
  const core = createCore<AmbientLightSample>();
  let sensor: SensorLike | null = null;

  return {
    name: 'ambientLight',

    capability: ambientLightCapability,

    async permission(): Promise<PermissionOutcome> {
      if (!ambientLightCapability().supported) return 'unavailable';
      return queryPermission('ambient-light-sensor');
    },

    /**
     * USER GESTURE ONLY. Chromium prompts for the sensor group the first time a
     * sensor starts. Nothing calls this on load; auto-dim is opt-in from
     * settings, where the tap that flips the switch is the gesture.
     */
    async request(): Promise<RequestOutcome> {
      const capability = ambientLightCapability();
      if (!capability.supported) return 'unavailable';
      const state = await queryPermission('ambient-light-sensor');
      if (state === 'granted') return 'granted';
      if (state === 'denied') return 'denied';
      // There is no explicit request call for sensors: starting one is the
      // request. Report unavailable rather than claiming a decision was made.
      return 'unavailable';
    },

    /** Idempotent. */
    start(): void {
      const capability = ambientLightCapability();
      if (!capability.supported) {
        core.fail('unsupported', capability.reason ?? 'the ambient light sensor is not available');
        return;
      }
      if (core.running()) return;
      const Ctor = sensorCtor();
      if (Ctor === undefined) return;
      try {
        const next = new Ctor({ frequency: SENSOR_FREQUENCY_HZ });
        next.addEventListener('reading', () => {
          const lux = next.illuminance;
          if (typeof lux !== 'number' || !Number.isFinite(lux)) return;
          core.clearError();
          core.emit({ illuminanceLux: lux, timestamp: Date.now() });
        });
        next.addEventListener('error', () => {
          core.fail('sensor-error', 'the ambient light sensor stopped reporting');
        });
        next.start();
        sensor = next;
        core.setRunning(true);
      } catch (cause) {
        sensor = null;
        core.setRunning(false);
        core.fail('sensor-start-failed', errorMessage(cause, 'the light sensor refused to start'));
      }
    },

    /** Idempotent. */
    stop(): void {
      const running = sensor;
      sensor = null;
      core.setRunning(false);
      if (running) {
        try {
          running.stop();
        } catch {
          // Sensor already dead. Nothing to release.
        }
      }
    },

    current: core.current,
    error: core.error,
    subscribe: core.subscribe,

    lux(): number | null {
      return core.current()?.illuminanceLux ?? null;
    },
  };
}
