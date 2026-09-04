/**
 * Shared adapter internals: the subscriber list, the last value, the last
 * error, the running flag, and a listener bag that guarantees `stop()` removes
 * exactly what `start()` added.
 *
 * Every adapter in this directory is a closure over one of these. Keeping the
 * bookkeeping in one place is what makes "start/stop is idempotent" and
 * "subscribe returns a working unsubscribe" true for all fifteen of them rather
 * than fourteen of them.
 */

import type { AdapterError, Unsubscribe } from './types';

/** Explicit no-op, in one place, so an empty function body never sneaks in. */
export function noop(): void {
  return undefined;
}

export interface AdapterCore<TValue> {
  subscribe(fn: (v: TValue) => void): Unsubscribe;
  /** Set the current value and notify every subscriber. */
  emit(value: TValue): void;
  current(): TValue | null;
  setCurrent(value: TValue | null): void;
  error(): AdapterError | null;
  fail(code: string, message: string): void;
  clearError(): void;
  /**
   * Told when the error changes, including back to `null`.
   *
   * `error()` alone is a getter, and a getter is only useful to somebody who
   * knows to look. The sensor runtime looked inside the VALUE subscription --
   * which never fires for an adapter that is failing to produce values -- so a
   * GPS watch that timed out or was refused at the OS prompt recorded its
   * error somewhere nothing would read. See `Adapter.subscribeToError`.
   */
  subscribeToError(fn: (error: AdapterError | null) => void): Unsubscribe;
  running(): boolean;
  setRunning(running: boolean): void;
  subscriberCount(): number;
}

export function createCore<TValue>(): AdapterCore<TValue> {
  const subscribers = new Set<(v: TValue) => void>();
  const errorSubscribers = new Set<(e: AdapterError | null) => void>();
  let value: TValue | null = null;
  let lastError: AdapterError | null = null;
  let isRunning = false;

  /**
   * Tell the error subscribers, without letting one of them silence the rest.
   *
   * Deliberately does NOT record a throwing subscriber as `lastError` the way
   * `emit` does: doing that from inside an error notification is a loop, and
   * the error being reported is more important than the reporter's bug.
   */
  function announce(next: AdapterError | null): void {
    for (const fn of [...errorSubscribers]) {
      try {
        fn(next);
      } catch {
        // Nothing to escalate to. See above.
      }
    }
  }

  const core: AdapterCore<TValue> = {
    subscribe(fn) {
      subscribers.add(fn);
      let live = true;
      return () => {
        if (!live) return;
        live = false;
        subscribers.delete(fn);
      };
    },

    emit(next) {
      value = next;
      // A throwing subscriber must not stop the other subscribers from seeing
      // an alert. Swallowing is not silence: it is recorded as an adapter error
      // and there is no console call in product code to leak a payload into.
      for (const fn of [...subscribers]) {
        try {
          fn(next);
        } catch (cause) {
          lastError = {
            code: 'subscriber-threw',
            message:
              cause instanceof Error && cause.message !== ''
                ? `a subscriber threw: ${cause.message}`
                : 'a subscriber threw',
          };
        }
      }
    },

    current() {
      return value;
    },

    setCurrent(next) {
      value = next;
    },

    error() {
      return lastError;
    },

    fail(code, message) {
      lastError = { code, message };
      announce(lastError);
    },

    clearError() {
      // Only when there was something to clear: a fix arriving calls this on
      // every single tick, and waking the runtime once a second to be told
      // nothing is wrong is how a subscription becomes a cost.
      if (lastError === null) return;
      lastError = null;
      announce(null);
    },

    subscribeToError(fn) {
      errorSubscribers.add(fn);
      let live = true;
      return () => {
        if (!live) return;
        live = false;
        errorSubscribers.delete(fn);
      };
    },

    running() {
      return isRunning;
    },

    setRunning(next) {
      isRunning = next;
    },

    subscriberCount() {
      return subscribers.size;
    },
  };

  return core;
}

// ---------------------------------------------------------------------------
// Listener bag
// ---------------------------------------------------------------------------

export interface ListenerBag {
  /** No-op when `target` is undefined, which is the case in a non-DOM runtime. */
  on(
    target: EventTarget | undefined,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions,
  ): void;
  /** Remove everything added since the last `removeAll()`. Idempotent. */
  removeAll(): void;
  size(): number;
}

export function createListenerBag(): ListenerBag {
  interface Entry {
    readonly target: EventTarget;
    readonly type: string;
    readonly handler: EventListener;
    readonly options: AddEventListenerOptions | undefined;
  }
  let entries: Entry[] = [];

  return {
    on(target, type, handler, options) {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, handler, options);
      entries.push({ target, type, handler, options });
    },
    removeAll() {
      const current = entries;
      entries = [];
      for (const entry of current) {
        try {
          entry.target.removeEventListener(entry.type, entry.handler, entry.options);
        } catch {
          // A target torn down before us cannot be un-listened. Nothing to do,
          // and nothing worth reporting: the listener died with the target.
        }
      }
    },
    size() {
      return entries.length;
    },
  };
}

/** Reads a numeric field that the platform may report as null or undefined. */
export function numberOrNull(input: unknown): number | null {
  return typeof input === 'number' && Number.isFinite(input) ? input : null;
}
