/**
 * Deterministic global patching for adapter tests.
 *
 * Vitest's `stubGlobal` is restored by an internal `afterEach` whose ordering
 * relative to `@testing-library/react`'s `cleanup()` is not something a test
 * should have to reason about - and one of the things these tests do is remove
 * `document`. So this saves the property descriptor, applies the patch, and
 * restores it in a `finally` that runs before the test returns.
 *
 * Setting a name to `undefined` is how a test says "this browser does not have
 * the API", which is the case every adapter has to survive.
 */

export type GlobalPatch = Readonly<Record<string, unknown>>;

interface Saved {
  readonly name: string;
  readonly existed: boolean;
  readonly descriptor: PropertyDescriptor | undefined;
}

function apply(patch: GlobalPatch): Saved[] {
  const bag = globalThis as unknown as Record<string, unknown>;
  const saved: Saved[] = [];
  for (const name of Object.keys(patch)) {
    saved.push({
      name,
      existed: Object.prototype.hasOwnProperty.call(bag, name),
      descriptor: Object.getOwnPropertyDescriptor(bag, name),
    });
    Object.defineProperty(bag, name, {
      value: patch[name],
      configurable: true,
      writable: true,
      enumerable: true,
    });
  }
  return saved;
}

function restore(saved: readonly Saved[]): void {
  const bag = globalThis as unknown as Record<string, unknown>;
  for (const entry of [...saved].reverse()) {
    if (entry.existed && entry.descriptor) {
      Object.defineProperty(bag, entry.name, entry.descriptor);
    } else {
      Reflect.deleteProperty(bag, entry.name);
    }
  }
}

export function withGlobals<T>(patch: GlobalPatch, run: () => T): T {
  const saved = apply(patch);
  try {
    return run();
  } finally {
    restore(saved);
  }
}

export async function withGlobalsAsync<T>(patch: GlobalPatch, run: () => Promise<T>): Promise<T> {
  const saved = apply(patch);
  try {
    return await run();
  } finally {
    restore(saved);
  }
}

/**
 * The globals each adapter's capability probe reads. Blanking these is what
 * "the API is not in this browser" looks like from inside a test.
 */
export const CAPABILITY_GLOBALS: Readonly<Record<string, GlobalPatch>> = {
  geolocation: { navigator: undefined },
  orientation: { DeviceOrientationEvent: undefined },
  motion: { DeviceMotionEvent: undefined },
  notifications: { Notification: undefined },
  vibration: { navigator: undefined },
  screenWakeLock: { navigator: undefined },
  speechRecognition: { SpeechRecognition: undefined, webkitSpeechRecognition: undefined },
  cameraCapture: { document: undefined },
  share: { navigator: undefined },
  clipboard: { navigator: undefined },
  network: { navigator: undefined },
  visibility: { document: undefined },
  battery: { navigator: undefined },
  ambientLight: { AmbientLightSensor: undefined },
  twaLocationBridge: { DarkrouteNative: undefined },
};
