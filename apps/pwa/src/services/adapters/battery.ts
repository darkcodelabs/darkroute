/**
 * BATTERY STATUS.
 *
 * The watch node screen renders "BATT 100" and the phone needs to know when
 * holding a wake lock plus a high-accuracy GPS watch has become irresponsible.
 *
 * EXPECT THIS TO BE UNSUPPORTED
 *   `navigator.getBattery` was removed from Firefox and Safari as a
 *   fingerprinting surface and survives only in Chromium. That is the normal
 *   case, not a failure: `capability()` says so and every screen that shows a
 *   battery figure has to have a state for not having one. Nothing here
 *   estimates a level from anything else.
 */

import { createCore, createListenerBag, numberOrNull } from './core';
import { errorMessage, nav, no, ok, type Adapter, type Capability } from './types';

export interface BatteryState {
  /** 0..1. */
  readonly level: number;
  readonly charging: boolean;
  /** Seconds until full, or null when the platform says Infinity/unknown. */
  readonly chargingTimeS: number | null;
  /** Seconds until empty, or null when unknown. */
  readonly dischargingTimeS: number | null;
  readonly timestamp: number;
}

export interface BatteryAdapter extends Adapter<BatteryState> {
  /** True when the platform is chargeable and below the given fraction. */
  isBelow(fraction: number): boolean;
}

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
}

interface NavigatorWithBattery {
  getBattery?: () => Promise<BatteryManagerLike>;
}

function getBattery(): (() => Promise<BatteryManagerLike>) | undefined {
  const navigator = nav() as unknown as NavigatorWithBattery | undefined;
  return typeof navigator?.getBattery === 'function'
    ? navigator.getBattery.bind(navigator)
    : undefined;
}

export function batteryCapability(): Capability {
  if (nav() === undefined) return no('no navigator in this runtime');
  if (getBattery() === undefined) {
    return no(
      'the Battery Status API is not available in this browser (firefox and safari removed it)',
    );
  }
  return ok();
}

function finiteSeconds(value: number): number | null {
  const n = numberOrNull(value);
  return n === null || n === 0 ? null : n;
}

export function createBatteryAdapter(): BatteryAdapter {
  const core = createCore<BatteryState>();
  const listeners = createListenerBag();
  let manager: BatteryManagerLike | null = null;

  const sample = (): void => {
    if (manager === null) return;
    core.emit({
      level: manager.level,
      charging: manager.charging === true,
      chargingTimeS: finiteSeconds(manager.chargingTime),
      dischargingTimeS: finiteSeconds(manager.dischargingTime),
      timestamp: Date.now(),
    });
  };

  return {
    name: 'battery',

    capability: batteryCapability,

    /** Idempotent. Resolves once the first reading has been taken. */
    async start(): Promise<void> {
      const capability = batteryCapability();
      if (!capability.supported) {
        core.fail('unsupported', capability.reason ?? 'battery status is not available');
        return;
      }
      if (core.running()) return;
      core.setRunning(true);
      const read = getBattery();
      if (read === undefined) return;
      try {
        const next = await read();
        if (!core.running()) return; // stop() landed while we were awaiting
        manager = next;
        for (const event of [
          'levelchange',
          'chargingchange',
          'chargingtimechange',
          'dischargingtimechange',
        ]) {
          listeners.on(next, event, sample);
        }
        core.clearError();
        sample();
      } catch (cause) {
        core.setRunning(false);
        core.fail('battery-read-failed', errorMessage(cause, 'battery status could not be read'));
      }
    },

    /** Idempotent. */
    stop(): void {
      listeners.removeAll();
      manager = null;
      core.setRunning(false);
    },

    current: core.current,
    error: core.error,
    subscribe: core.subscribe,

    isBelow(fraction: number): boolean {
      const state = core.current();
      if (state === null) return false;
      return !state.charging && state.level < fraction;
    },
  };
}
