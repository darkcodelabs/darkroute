/**
 * THE ADAPTER CONTRACT
 * =============================================================================
 * Screen components never touch a browser API. Every sensor, permission and
 * platform capability this product uses is reached through one shape, defined
 * here once, so a screen can be written against a promise the platform may not
 * keep - and rendered honestly when it does not.
 *
 * THREE RULES EVERY ADAPTER OBEYS
 *
 *   1. CAPABILITY-DETECT, NEVER THROW. `capability()` is a synchronous probe
 *      that is safe to call on any platform, including one where the API has
 *      been deleted from `globalThis`. It returns `{ supported: false, reason }`
 *      instead of throwing, and `reason` is a sentence a human can read.
 *      `start()` on an unsupported platform is a no-op that records an error;
 *      it does not throw and it does not pretend to have started.
 *
 *   2. PERMISSION PROMPTS COME FROM A USER GESTURE. `request()` is the only
 *      method that may surface an OS prompt, and every implementation carries a
 *      comment saying so. Nothing in this directory calls `request()` on import,
 *      on `start()`, or on page load. `permission()` is the passive read and is
 *      always safe.
 *
 *   3. NOTHING IS FAKED. An adapter never reports a value it did not receive
 *      from the platform, never claims a background capability the web cannot
 *      deliver, and never degrades to a plausible-looking stand-in. When it
 *      cannot do the job it says so through `capability()` and `error()`.
 *
 * PRIVACY
 *   Adapters carry the most sensitive data in the product. Exact coordinates
 *   never reach a log sink - see `redact()` in `./geolocation`. Licence plates
 *   and watchlist entries never reach a notification, a share payload or the
 *   clipboard; the adapters that could carry one take structured payloads
 *   instead of free text so that leaking a plate is not expressible.
 * =============================================================================
 */

/** Passive read of a permission. Safe to call at any time, prompts nothing. */
export type PermissionOutcome = 'granted' | 'denied' | 'prompt' | 'unavailable';

/** Result of an active prompt. `unavailable` means the platform has no API. */
export type RequestOutcome = 'granted' | 'denied' | 'unavailable';

/**
 * Whether this platform can do the thing at all.
 * `reason` is present exactly when `supported` is false.
 */
export interface Capability {
  readonly supported: boolean;
  readonly reason?: string;
}

/** A machine-readable code plus a sentence. Never contains user data. */
export interface AdapterError {
  readonly code: string;
  readonly message: string;
}

export type Unsubscribe = () => void;

/**
 * The one interface. `TValue` is what subscribers receive; `TOptions` is what
 * `start()` accepts, and is `void` for adapters that take none.
 */
export interface Adapter<TValue, TOptions = void> {
  readonly name: string;
  capability(): Capability;
  /** Passive permission read. Absent on adapters with no permission model. */
  permission?(): Promise<PermissionOutcome>;
  /** ONLY callable from a user gesture. Absent when nothing can be prompted. */
  request?(): Promise<RequestOutcome>;
  start(opts?: TOptions): Promise<void> | void;
  stop(): void;
  current(): TValue | null;
  error(): AdapterError | null;
  subscribe(fn: (v: TValue) => void): Unsubscribe;
  /**
   * Told when the adapter FAILS, rather than having to ask.
   *
   * THE BUG THIS EXISTS FOR. `error()` is a getter, so the only way to learn
   * about a failure was to read it -- and the sensor runtime read it inside the
   * VALUE subscription, which by definition does not fire when the adapter is
   * producing no values. A GPS watch that opened and then timed out, or whose
   * permission was refused at the OS prompt after `start()` had already
   * returned, recorded its error where nothing would ever look. RADAR sat on
   * "waiting for the first fix." indefinitely, with the copy for "location is
   * off." sitting one branch away and unreachable.
   *
   * Called with `null` when the error clears, which is how a tunnel ending
   * takes the message back off the screen.
   *
   * Optional because it is served by the shared core and an adapter is free not
   * to have one; every adapter built on `createCore` gets it for nothing.
   */
  subscribeToError?(fn: (error: AdapterError | null) => void): Unsubscribe;
}

export const ADAPTER_NAMES = [
  'geolocation',
  'orientation',
  'motion',
  'notifications',
  'vibration',
  'screenWakeLock',
  'speechRecognition',
  'cameraCapture',
  'share',
  'clipboard',
  'network',
  'visibility',
  'battery',
  'ambientLight',
  'twaLocationBridge',
] as const;

export type AdapterName = (typeof ADAPTER_NAMES)[number];

/**
 * The four alert states. Hue means state and nothing else; so does haptics.
 * `clear` is deliberately part of the union - it is a state, it just has no
 * haptic and no sound.
 */
export type AlertState = 'clear' | 'approaching' | 'in_range' | 'multiple';

export const ALERT_STATES: readonly AlertState[] = ['clear', 'approaching', 'in_range', 'multiple'];

// ---------------------------------------------------------------------------
// Capability helpers
// ---------------------------------------------------------------------------

/** `exactOptionalPropertyTypes` is on, so `reason` is omitted, not undefined. */
export function ok(): Capability {
  return { supported: true };
}

export function no(reason: string): Capability {
  return { supported: false, reason };
}

/**
 * Read a global by name without an `any` cast and without assuming it exists.
 * Deleting the name from `globalThis` - which the tests do - makes this return
 * `undefined`, which is the whole point.
 */
export function globalValue<T>(name: string): T | undefined {
  const bag = globalThis as unknown as Record<string, unknown>;
  return bag[name] as T | undefined;
}

export function hasGlobal(name: string): boolean {
  return globalValue<unknown>(name) !== undefined;
}

/** `navigator` is absent in a worker-less non-DOM runtime; never assume it. */
export function nav(): Navigator | undefined {
  return globalValue<Navigator>('navigator');
}

export function doc(): Document | undefined {
  return globalValue<Document>('document');
}

/**
 * Several APIs (clipboard, wake lock, sensors, service-worker notifications)
 * are hard-gated on a secure context. Reporting "not supported" without saying
 * why sends the reader hunting; this is the sentence they need.
 */
export function secureContextCapability(api: string): Capability | null {
  const secure = globalValue<boolean>('isSecureContext');
  if (secure === false) {
    return no(`${api} needs a secure context (https or localhost); this page is not one`);
  }
  return null;
}

/**
 * `navigator.permissions.query` with the failure modes the spec allows: the API
 * may be absent, and it may reject on a name a given browser does not know.
 * Both mean "cannot tell", not "denied".
 */
export async function queryPermission(name: string): Promise<PermissionOutcome> {
  const permissions = nav()?.permissions;
  if (!permissions || typeof permissions.query !== 'function') return 'unavailable';
  try {
    const status = await permissions.query({ name } as unknown as PermissionDescriptor);
    if (status.state === 'granted') return 'granted';
    if (status.state === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'unavailable';
  }
}

/** Message text for an unknown throw, with no user data in it. */
export function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message !== '') return cause.message;
  return fallback;
}
