/**
 * VISIBILITY / PAGE LIFECYCLE.
 *
 * The one adapter every other adapter has to respect. On Android a hidden
 * document loses the wake lock, loses geolocation callbacks, loses speech
 * recognition and can be frozen or discarded outright. Anything that claims to
 * keep working while hidden is either wrong or is the native TWA bridge.
 *
 * It is also what decides whether an alert is a screen or a notification: the
 * design routes a county entry to a heads-up notification only in the
 * "SCREEN OFF" state, and mirrors to the watch "only when the phone screen is
 * off - no duplicate buzz on both wrists and dash".
 */

import { createCore, createListenerBag } from './core';
import { doc, globalValue, no, ok, type Adapter, type Capability } from './types';

export type VisibilityValue = 'visible' | 'hidden';

export interface LifecycleState {
  readonly visibility: VisibilityValue;
  readonly focused: boolean;
  /** True between `freeze` and `resume`: the page is in the bfcache-adjacent
   *  frozen state and no timer of ours is running. */
  readonly frozen: boolean;
  /** True after `pagehide` with persisted=true, until the next `pageshow`. */
  readonly persisted: boolean;
  readonly timestamp: number;
}

export interface VisibilityAdapter extends Adapter<LifecycleState> {
  isVisible(): boolean;
}

export function visibilityCapability(): Capability {
  const document = doc();
  if (document === undefined) return no('no document in this runtime');
  if (typeof document.visibilityState !== 'string') {
    return no('document.visibilityState is not available in this runtime');
  }
  return ok();
}

export function createVisibilityAdapter(): VisibilityAdapter {
  const core = createCore<LifecycleState>();
  const listeners = createListenerBag();
  let frozen = false;
  let persisted = false;

  const read = (): LifecycleState => {
    const document = doc();
    return {
      visibility: document?.visibilityState === 'hidden' ? 'hidden' : 'visible',
      focused: document?.hasFocus?.() ?? false,
      frozen,
      persisted,
      timestamp: Date.now(),
    };
  };

  const sample = (): void => {
    core.emit(read());
  };

  return {
    name: 'visibility',

    capability: visibilityCapability,

    /** Idempotent. Emits the current state immediately. */
    start(): void {
      const capability = visibilityCapability();
      if (!capability.supported) {
        core.fail('unsupported', capability.reason ?? 'page lifecycle is not observable here');
        return;
      }
      if (core.running()) return;
      core.setRunning(true);

      const document = doc();
      const window = globalValue<EventTarget>('window');
      listeners.on(document, 'visibilitychange', sample);
      listeners.on(window, 'focus', sample);
      listeners.on(window, 'blur', sample);
      listeners.on(document, 'freeze', () => {
        frozen = true;
        sample();
      });
      listeners.on(document, 'resume', () => {
        frozen = false;
        sample();
      });
      listeners.on(window, 'pageshow', () => {
        persisted = false;
        frozen = false;
        sample();
      });
      listeners.on(window, 'pagehide', (event) => {
        persisted = (event as PageTransitionEvent).persisted === true;
        sample();
      });
      sample();
    },

    /** Idempotent. */
    stop(): void {
      listeners.removeAll();
      core.setRunning(false);
    },

    current: core.current,
    error: core.error,
    subscribe: core.subscribe,

    isVisible(): boolean {
      return (core.current() ?? read()).visibility === 'visible';
    },
  };
}
