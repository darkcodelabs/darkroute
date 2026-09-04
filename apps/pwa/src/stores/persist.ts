/**
 * THE PERSISTENCE BOUNDARY
 * =============================================================================
 * Two of the eleven slices may survive a reload: `settings` and `session`.
 * Every other store is ephemeral memory, and that is a product decision, not an
 * oversight - a position fix, a camera assessment, a live alert and a peer's
 * distance are all things that must be re-earned from the sensors after a
 * restart rather than replayed from disk.
 *
 * WHAT MUST NEVER CROSS THIS BOUNDARY
 *
 *   Licence-plate values and watchlist entries. They live in the encrypted
 *   vault (`services/crypto/plate.ts`) under a non-exportable AES-GCM key, and
 *   are decrypted into ephemeral memory only for the moment a local match is
 *   computed. A plate in a persisted zustand blob would be a plate in cleartext
 *   in a browser store any script on the origin can read - which is the exact
 *   failure this product exists to prevent.
 *
 *   A comment saying so is not a control. {@link assertPersistSafe} is the
 *   control: it walks the whole value on its way to the serializer and throws
 *   {@link PlateShapedValueError} on a plate-shaped string, a plate-shaped KEY,
 *   or a field whose NAME implies plate custody at all - an empty `watchlist:
 *   []` throws too, because the shape is what must not exist here, not just
 *   today's contents of it.
 *
 * WHY NOT `localStorage`
 *   It is synchronous, unencrypted, readable by any script on the origin and
 *   trivially snapshotted; the repo's ESLint config bans the global outright.
 *   zustand's default storage is exactly that, so no store in this directory
 *   may take the default. Persistence goes through a {@link PersistPort} the
 *   composition root installs, and the built-in default is an explicitly
 *   NON-DURABLE in-memory port - see {@link isPersistDurable}. A store that has
 *   not been given a durable port says so instead of pretending to have saved.
 * =============================================================================
 */

import type { PersistStorage, StorageValue } from 'zustand/middleware';

import { looksLikePlate } from '../services/db/repositories/plateVault.ts';

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/**
 * Raised when a value on its way into persistence could be a plate.
 *
 * The message NEVER echoes the offending value. An exception message is a log
 * line, a crash report and a bug ticket waiting to happen, and this one is
 * raised precisely when the value might be the secret. `path` names the field,
 * not the contents.
 */
export class PlateShapedValueError extends Error {
  override readonly name = 'PlateShapedValueError';

  constructor(
    readonly path: string,
    readonly why: 'plate-shaped-value' | 'plate-shaped-key' | 'forbidden-field',
  ) {
    super(
      `refusing to persist ${path}: ${why}. Plate values and watchlist entries are ` +
        'local-only secrets and belong in the encrypted vault, never in a persisted store.',
    );
  }
}

/**
 * Field names that may not appear anywhere in a persisted store, whatever they
 * hold. Checked against the lowercased key with separators stripped, so
 * `plate_value`, `plateValue` and `PLATE-VALUE` are all the same name.
 *
 * `plateVaultKeyId` is deliberately absent from the substring list below by
 * being matched on `plate` - the vault key REFERENCE is not a plate, but it is
 * also not something a zustand blob needs, so the boundary is simply closed to
 * anything that says "plate". The db layer already stores that id, guarded.
 */
const FORBIDDEN_KEY_SUBSTRINGS: readonly string[] = ['plate', 'watchlist', 'licence', 'license'];

/** Depth cap. A cyclic or absurdly deep value is refused, never followed. */
const MAX_DEPTH = 12;

/**
 * A camera identifier as the camera database issues them.
 *
 * TWO SHAPES, AND THE SECOND ONE IS THE REAL ONE.
 *
 * "FWM-0442", "FWM-0118" - an uppercase prefix, a hyphen, then digits - is the
 * shape used throughout the DESIGN FILES, and it was the only shape this
 * pattern accepted. The shipped catalogue does not issue it. Every camera in
 * `apps/pwa/public/cameras/**` is `osm:<digits>`, because they are OpenStreetMap
 * nodes: 1163 of 1163 across a sample of the tiles, with no other prefix.
 *
 * The consequence was not a warning. `mutedCameras` is keyed by camera id, so
 * muting one real camera put `osm:13375397501` into the persisted payload, the
 * walker refused the whole blob as a forbidden field, and from then on EVERY
 * settings write threw - silently, because the throw escapes zustand's setState
 * wrapper and nothing catches it. The mute stayed in memory so the app looked
 * fine, and the next load hydrated from defaults: theme, glass, tone, tilt,
 * threshold and the onboarding flag all reset. On the read side the refusal
 * DELETES the stored blob rather than repairing it. It looked intermittent
 * because `pruneMutes` drops the key when the 10-minute mute expires, at which
 * point saving silently starts working again.
 *
 * WHY THIS EXISTS AT ALL. `looksLikePlate("FWM-0442")` is TRUE: seven mixed
 * alphanumerics either side of a single hyphen is exactly a plate's shape, and
 * that is not a bug in the detector - a plate and a camera id really are
 * structurally indistinguishable in isolation. So the exemption is POSITIONAL
 * rather than textual: it applies only to the keys of the fields named in
 * {@link ID_KEYED_FIELDS}, whose keys are ids the camera database chose and
 * that a user cannot type into. Everywhere else, a plate-shaped string is
 * still refused, which is why adding a persisted field that carries a camera
 * id has to be a deliberate conversation rather than a silent success.
 *
 * Both arms stay, and both are strict allowlists of MACHINE-ISSUED shapes. A
 * free-text key, or anything actually plate-shaped that is not one of these two
 * forms, is still refused. Widening this to "any string" would hand the
 * exemption to exactly the values it exists to catch.
 */
const CAMERA_ID_RE = /^(?:[A-Z]{2,6}-\d{2,8}|osm:\d{1,20})$/;

/**
 * Persisted fields whose KEYS are camera identifiers.
 *
 * Exactly one today: `mutedCameras`, camera id -> epoch ms the mute expires.
 * Keys here are checked against {@link CAMERA_ID_RE} and refused if they do not
 * match, so the exemption cannot be used to smuggle in a free-text key.
 * Compared with separators stripped and lowercased.
 */
const ID_KEYED_FIELDS: ReadonlySet<string> = new Set(['mutedcameras']);

/**
 * A server-issued anonymous session id. Nothing else may claim this shape.
 *
 * Same story as {@link CAMERA_ID_RE}: `looksLikePlate` is TRUE for a UUID -
 * "7425-40de" compacts to eight mixed alphanumerics, which is a plate's shape -
 * and the detector is not wrong to say so. So the exemption is positional
 * again: it applies only to the values of the fields in
 * {@link ID_VALUE_FIELDS}, and a value there that is NOT a UUID is refused
 * outright, so the exemption cannot be used to smuggle in free text.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Persisted fields whose VALUE is a server-issued UUID.
 *
 * Exactly one today: `sessionId`. Compared with separators stripped and
 * lowercased.
 */
const ID_VALUE_FIELDS: ReadonlySet<string> = new Set(['sessionid']);

/**
 * How the walker should judge the thing it is looking at.
 *
 *   free-text        the default. Any plate-shaped string is refused.
 *   camera-id-keys   the object's KEYS are camera ids and must look like one.
 *   uuid-value       the value must be a UUID and is not plate-checked.
 */
type WalkMode = 'free-text' | 'camera-id-keys' | 'uuid-value';

function modeForKey(key: string): WalkMode {
  const flat = normaliseKey(key);
  if (ID_KEYED_FIELDS.has(flat)) return 'camera-id-keys';
  if (ID_VALUE_FIELDS.has(flat)) return 'uuid-value';
  return 'free-text';
}

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function keyIsForbidden(key: string): boolean {
  const flat = normaliseKey(key);
  return FORBIDDEN_KEY_SUBSTRINGS.some((needle) => flat.includes(needle));
}

function walk(value: unknown, path: string, depth: number, mode: WalkMode): void {
  if (depth > MAX_DEPTH) {
    throw new PlateShapedValueError(path, 'forbidden-field');
  }
  if (typeof value === 'string') {
    if (mode === 'uuid-value') {
      if (!UUID_RE.test(value)) throw new PlateShapedValueError(path, 'forbidden-field');
      return;
    }
    if (looksLikePlate(value)) throw new PlateShapedValueError(path, 'plate-shaped-value');
    return;
  }
  if (value === null || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walk(value[i], `${path}[${String(i)}]`, depth + 1, 'free-text');
    }
    return;
  }

  if (value instanceof Map || value instanceof Set) {
    // A Map or a Set does not survive JSON.stringify anyway, so persisting one
    // is a bug regardless of contents. Refusing it here turns "the setting
    // silently became {}" into a loud failure at the write.
    throw new PlateShapedValueError(path, 'forbidden-field');
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (mode === 'camera-id-keys') {
      // Inside an id-keyed field. The key must BE an id; nothing else is
      // allowed through this door, plate-shaped or otherwise.
      if (!CAMERA_ID_RE.test(key)) throw new PlateShapedValueError(childPath, 'forbidden-field');
    } else {
      if (keyIsForbidden(key)) throw new PlateShapedValueError(childPath, 'forbidden-field');
      // A watchlist keyed BY plate hides the secret in the key, where a value
      // walk would never look at it.
      if (looksLikePlate(key)) throw new PlateShapedValueError(childPath, 'plate-shaped-key');
    }
    walk(child, childPath, depth + 1, modeForKey(key));
  }
}

/**
 * Walk a value and throw if anything in it could be a plate.
 *
 * Exported so the boundary can be asserted directly in a test, and so a future
 * writer (an export path, a share payload) can reuse the same judgement instead
 * of writing a second, weaker one.
 *
 * @throws PlateShapedValueError naming the field, never its contents.
 */
export function assertPersistSafe(value: unknown, path = '$'): void {
  walk(value, path, 0, 'free-text');
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/**
 * Where persisted bytes actually go.
 *
 * Async by contract because the only durable option on this platform is
 * IndexedDB. `durable` is not decoration: a screen that tells the driver their
 * settings are saved must be able to find out whether that is true.
 */
export interface PersistPort {
  /** True only when a reload will find the bytes again. */
  readonly durable: boolean;
  /** A sentence for the UI when `durable` is false. */
  readonly reason?: string;
  getItem(name: string): Promise<string | null>;
  setItem(name: string, value: string): Promise<void>;
  removeItem(name: string): Promise<void>;
}

/**
 * The honest default: a Map. It works, it round-trips within a session, and it
 * loses everything on reload - which is exactly what it reports.
 */
export function createMemoryPersistPort(reason?: string): PersistPort {
  const cells = new Map<string, string>();
  return {
    durable: false,
    reason:
      reason ??
      'settings are held in memory for this session only; no durable store has been installed',
    getItem(name) {
      return Promise.resolve(cells.get(name) ?? null);
    },
    setItem(name, value) {
      cells.set(name, value);
      return Promise.resolve();
    },
    removeItem(name) {
      cells.delete(name);
      return Promise.resolve();
    },
  };
}

let activePort: PersistPort = createMemoryPersistPort();

/**
 * Install the real port. Called once by the composition root, which is the only
 * place that knows whether IndexedDB opened.
 *
 * Returns the port that was replaced, so a test can put the old one back.
 */
export function installPersistPort(port: PersistPort): PersistPort {
  const previous = activePort;
  activePort = port;
  return previous;
}

export function getPersistPort(): PersistPort {
  return activePort;
}

/** Does a reload actually find the bytes again? Screens may render this. */
export function isPersistDurable(): boolean {
  return activePort.durable;
}

/** Back to the non-durable default. Test teardown, and `clearLocalData()`. */
export function resetPersistPort(): PersistPort {
  return installPersistPort(createMemoryPersistPort());
}

// ---------------------------------------------------------------------------
// The storage adapter zustand's persist middleware takes
// ---------------------------------------------------------------------------

export interface GuardedStorageOptions {
  /**
   * Use this port instead of the installed one. Passing the port itself rather
   * than reading the module global lets one test own its own storage.
   */
  readonly port?: PersistPort;
  /**
   * Called when stored bytes are refused or unparseable. The store then
   * hydrates from its defaults. Never receives the offending value.
   */
  readonly onRejected?: (name: string, reason: string) => void;
}

/**
 * A `PersistStorage`, deliberately NOT a `StateStorage`.
 *
 * The difference is the whole point: `StateStorage` receives a string that
 * zustand has already serialised, so a guard there could only regex a blob.
 * `PersistStorage` receives the live object, so {@link assertPersistSafe} can
 * inspect real keys and real values before a single byte is written.
 */
export function createGuardedPersistStorage<S>(
  options: GuardedStorageOptions = {},
): PersistStorage<S, Promise<void>> {
  const resolvePort = (): PersistPort => options.port ?? activePort;

  return {
    async getItem(name: string): Promise<StorageValue<S> | null> {
      const raw = await resolvePort().getItem(name);
      if (raw === null) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        options.onRejected?.(name, 'stored value is not valid JSON');
        return null;
      }
      try {
        // Bytes on disk have been through a browser upgrade, a profile sync and
        // possibly a devtools edit since they were written. Refusing to HYDRATE
        // a plate-shaped blob matters as much as refusing to write one: a value
        // that gets read back into a store is a value that gets written again.
        assertPersistSafe(parsed, `${name}<stored>`);
      } catch (cause) {
        // Do not throw on the read path. Hydration failing loudly at startup
        // means a phone that will not open its own settings; dropping the blob
        // and reporting it means a phone that opens with defaults.
        options.onRejected?.(
          name,
          cause instanceof PlateShapedValueError ? cause.why : 'stored value was refused',
        );
        await resolvePort().removeItem(name);
        return null;
      }
      return parsed as StorageValue<S>;
    },

    /**
     * THROWS, SYNCHRONOUSLY, BEFORE ANYTHING IS WRITTEN.
     *
     * Deliberately not an `async` method: zustand's persist middleware calls
     * `setItem` from inside `set()`, so a synchronous throw propagates out of
     * the action and out of the component that called it. An `async` guard
     * would surface the same refusal as an unhandled rejection three ticks
     * later, which is how a privacy control becomes a log line nobody reads.
     *
     * The in-memory write has already happened by the time this runs - the
     * middleware sets state first. That is acceptable and the reason the throw
     * is loud: nothing reached storage, and the caller is told at the call
     * site rather than left believing a secret was saved.
     */
    setItem(name: string, value: StorageValue<S>): Promise<void> {
      assertPersistSafe(value, name);
      return resolvePort().setItem(name, JSON.stringify(value));
    },

    async removeItem(name: string): Promise<void> {
      await resolvePort().removeItem(name);
    },
  };
}
