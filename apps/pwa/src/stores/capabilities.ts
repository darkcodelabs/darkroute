/**
 * CAPABILITIES - what this device can actually do, and what it has agreed to.
 *
 * The adapters in `services/adapters` answer both questions honestly; this
 * slice is where the answers are cached so a screen can render an explicit
 * unavailable state instead of a spinner that never resolves. Nothing in here
 * touches a browser API - every value arrives through an {@link AdapterSet}
 * handed in by the caller, which is what makes the whole slice testable with
 * `createMockAdapters()` and what keeps the sensor code in one directory.
 *
 * PERMISSIONS ARE NEVER PROMPTED FROM STATE
 *   {@link CapabilitiesActions.probe} and {@link CapabilitiesActions.readPermissions}
 *   are passive and safe to call on load: `capability()` is a synchronous
 *   feature probe and `permission()` is a passive read. {@link CapabilitiesActions.request}
 *   is the only method that can raise an OS dialog, and it MUST be called from
 *   a user gesture that obviously needs the thing - the onboarding screen's
 *   "ALLOW" row, the REPORT sheet's photo button, the ASK screen's microphone.
 *   Nothing may call it on mount, on hydration, or "to warm it up".
 *
 * `unknown` IS A REAL STATE
 *   Before the first probe, this slice reports `unknown` rather than guessing.
 *   A store that defaults to "unsupported" teaches screens to hide features
 *   that work; one that defaults to "supported" teaches them to lie.
 *
 * ONE ADAPTER'S ANSWER IS NEVER HELD FOR ANOTHER'S
 *   {@link CapabilitiesActions.readPermissions} used to collect all fifteen
 *   reads with `Promise.all` and publish one frozen map at the end, so the
 *   store learned NOTHING until the slowest adapter answered. Motion is the
 *   read that exposed it: on Android `permission()` is pure synchronous
 *   feature detection and settles in the first microtask, but the store did
 *   not hear about it until `navigator.permissions.query('clipboard-write')`
 *   and `('microphone')` came back -- measured at +8 ms answered, +267 ms
 *   published on a warm load and +791 ms on a cold one, on a 6x-throttled
 *   Pixel profile. That published-at latency is what varies from launch to
 *   launch, and it is what made the SETTINGS motion row read GRANTED on one
 *   load and OPTIONAL on the next with nothing changed in between.
 *
 *   Each read now publishes itself the moment it lands. The merge reads the
 *   CURRENT map after its own await, not one captured before it, so fifteen
 *   independent writes cannot clobber each other; the method still resolves
 *   only when every read has finished, which is what its callers await.
 */

import { create } from 'zustand';

import { ADAPTER_NAMES, capabilityReport } from '../services/adapters';
import type {
  AdapterError,
  AdapterName,
  AdapterSet,
  Capability,
  PermissionOutcome,
  RequestOutcome,
} from '../services/adapters';

export type { AdapterName, Capability, PermissionOutcome, RequestOutcome };

/** Three-valued, because "we have not looked" is not "no". */
export type CapabilityStatus = 'unknown' | 'supported' | 'unsupported';

/** Four-valued permission plus the pre-read state. */
export type PermissionStatus = PermissionOutcome | 'unknown';

export interface CapabilitiesState {
  /** Null until {@link CapabilitiesActions.probe} has run at least once. */
  readonly capabilities: Readonly<Record<AdapterName, Capability>> | null;
  /** Absent name means the passive read has not happened for that adapter. */
  readonly permissions: Readonly<Partial<Record<AdapterName, PermissionOutcome>>>;
  /** Last error each adapter reported. Never contains user data. */
  readonly errors: Readonly<Partial<Record<AdapterName, AdapterError>>>;
  readonly probedAtMs: number | null;
  /** The adapter whose OS prompt is open right now, or null. */
  readonly requesting: AdapterName | null;
}

export interface CapabilitiesActions {
  /** Synchronous feature probe of every adapter. Prompts nothing. */
  probe(adapters: AdapterSet, atMs: number): void;
  /**
   * Passive permission read of every adapter that has one. Prompts nothing.
   *
   * Publishes each answer as it arrives rather than batching them: see the
   * header. Resolving still means "all of them have answered".
   */
  readPermissions(adapters: AdapterSet): Promise<void>;
  /**
   * Raise the OS prompt for one adapter.
   *
   * ONLY from a user gesture that obviously needs the capability. Returns what
   * the platform decided; `unavailable` means there was no API to ask.
   */
  request(adapters: AdapterSet, name: AdapterName): Promise<RequestOutcome>;
  noteError(name: AdapterName, error: AdapterError | null): void;
  reset(): void;
}

export type CapabilitiesStore = CapabilitiesState & CapabilitiesActions;

const NO_PERMISSIONS: Readonly<Partial<Record<AdapterName, PermissionOutcome>>> = Object.freeze({});
const NO_ERRORS: Readonly<Partial<Record<AdapterName, AdapterError>>> = Object.freeze({});

const INITIAL_STATE: CapabilitiesState = Object.freeze({
  capabilities: null,
  permissions: NO_PERMISSIONS,
  errors: NO_ERRORS,
  probedAtMs: null,
  requesting: null,
});

export function createCapabilitiesStore() {
  return create<CapabilitiesStore>()((set, get) => ({
    ...INITIAL_STATE,

    probe(adapters, atMs) {
      set({ capabilities: Object.freeze(capabilityReport(adapters)), probedAtMs: atMs });
    },

    async readPermissions(adapters) {
      await Promise.all(
        ADAPTER_NAMES.map(async (name): Promise<void> => {
          const adapter = adapters[name];
          if (typeof adapter.permission !== 'function') return;
          let outcome: PermissionOutcome;
          // A passive read must never be the reason a screen fails to render.
          try {
            outcome = await adapter.permission();
          } catch {
            outcome = 'unavailable';
          }
          // Merged against whatever the map holds AT THIS MOMENT, read after
          // the await rather than captured before it, so fifteen independent
          // lands cannot overwrite one another.
          set({ permissions: Object.freeze({ ...get().permissions, [name]: outcome }) });
        }),
      );
    },

    async request(adapters, name) {
      const adapter = adapters[name];
      if (typeof adapter.request !== 'function') {
        // Nothing to prompt for. Recorded honestly rather than reported as a
        // denial, because a denial is something the user did.
        set({ permissions: Object.freeze({ ...get().permissions, [name]: 'unavailable' }) });
        return 'unavailable';
      }
      set({ requesting: name });
      try {
        const outcome = await adapter.request();
        set({
          permissions: Object.freeze({ ...get().permissions, [name]: outcome }),
          requesting: null,
        });
        return outcome;
      } catch {
        set({ requesting: null });
        return 'unavailable';
      }
    },

    noteError(name, error) {
      const current = get().errors;
      // Rebuilt rather than deleted: a computed-key `delete` is banned by the
      // lint config, and the whole record is five entries at worst.
      const next: Partial<Record<AdapterName, AdapterError>> = {};
      for (const adapter of ADAPTER_NAMES) {
        if (adapter === name) continue;
        const existing = current[adapter];
        if (existing !== undefined) next[adapter] = existing;
      }
      if (error !== null) next[name] = error;
      set({ errors: Object.freeze(next) });
    },

    reset() {
      set({ ...INITIAL_STATE });
    },
  }));
}

export const useCapabilitiesStore = createCapabilitiesStore();

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function capabilityStatus(
  capabilities: Readonly<Record<AdapterName, Capability>> | null,
  name: AdapterName,
): CapabilityStatus {
  if (capabilities === null) return 'unknown';
  return capabilities[name].supported ? 'supported' : 'unsupported';
}

/** Three-valued, and a primitive - the cheapest thing a screen can subscribe to. */
export const useCapabilityStatus = (name: AdapterName): CapabilityStatus =>
  useCapabilitiesStore((s) => capabilityStatus(s.capabilities, name));

/** The full probe result including the human-readable reason, or null. */
export const useCapability = (name: AdapterName): Capability | null =>
  useCapabilitiesStore((s) => s.capabilities?.[name] ?? null);

export const usePermission = (name: AdapterName): PermissionStatus =>
  useCapabilitiesStore((s) => s.permissions[name] ?? 'unknown');

export const useAdapterError = (name: AdapterName): AdapterError | null =>
  useCapabilitiesStore((s) => s.errors[name] ?? null);

export const useCapabilitiesProbed = (): boolean =>
  useCapabilitiesStore((s) => s.capabilities !== null);

export const useRequestingPermission = (): AdapterName | null =>
  useCapabilitiesStore((s) => s.requesting);

/**
 * Location is the one permission the product cannot work without.
 *
 * "Required. Distance to cameras is computed on-device."
 * - Flockys Screens II.dc.html, A1 · ONBOARDING
 */
export const useLocationPermission = (): PermissionStatus => usePermission('geolocation');

export const capabilitiesActions = {
  probe: (adapters: AdapterSet, atMs: number): void => {
    useCapabilitiesStore.getState().probe(adapters, atMs);
  },
  readPermissions: (adapters: AdapterSet): Promise<void> =>
    useCapabilitiesStore.getState().readPermissions(adapters),
  request: (adapters: AdapterSet, name: AdapterName): Promise<RequestOutcome> =>
    useCapabilitiesStore.getState().request(adapters, name),
  noteError: (name: AdapterName, error: AdapterError | null): void => {
    useCapabilitiesStore.getState().noteError(name, error);
  },
  reset: (): void => {
    useCapabilitiesStore.getState().reset();
  },
};
