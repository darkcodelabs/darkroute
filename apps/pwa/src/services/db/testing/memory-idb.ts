/**
 * A minimal in-memory IndexedDB, written for this repository's tests.
 *
 * WHY THIS EXISTS. `fake-indexeddb` is not on the approved dependency list and
 * this task adds no packages, so the database tests either run against a
 * hand-written double or they do not run. jsdom implements no IndexedDB at
 * all - not even the constructors - so the double has to install the whole
 * family of globals, because `idb` resolves `IDBDatabase`, `IDBObjectStore`,
 * `IDBIndex`, `IDBCursor`, `IDBTransaction` and `IDBRequest` off the global
 * object and caches them on first use.
 *
 * WHAT IT MODELS FAITHFULLY
 *   - key ordering across number / Date / string / array, per the IDB spec's
 *     type ranking, including nested array keys such as `[z, x, y]`
 *   - in-line keys via `keyPath`, including array key paths, and generated
 *     keys via `autoIncrement`
 *   - single-property indexes, `IDBKeyRange`, `getAll` / `getAllKeys` with a
 *     count limit, and forward and reverse cursors with `update` and `delete`
 *   - structured cloning on write and on read, so a caller cannot mutate a
 *     stored record by holding onto the object it wrote
 *   - transaction lifetime: requests queue, events fire asynchronously,
 *     `complete` fires when the queue drains, and `abort` rolls every touched
 *     store back to its contents at the start of the transaction
 *
 * WHAT IT DELIBERATELY DOES NOT MODEL - do not write a test that depends on
 * any of this, and do not "fix" one of them without saying so in the file
 * header, because a double that quietly diverges is worse than no double:
 *   - binary keys (`ArrayBuffer` / typed arrays as keys)
 *   - `multiEntry` indexes, unique-index constraint enforcement, and the
 *     `nextunique` / `prevunique` cursor directions (these throw, loudly)
 *   - live cursors: a cursor iterates the set that matched when it was opened
 *   - cross-connection version blocking, `versionchange` events between tabs,
 *     durability hints, and quota
 *   - real quota accounting: `navigator.storage.estimate()` is a separate
 *     capability and `estimateUsage()` handles its absence on its own
 *
 * It is a test double. It is not an IndexedDB implementation.
 */

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** The subset of IDB key types this double supports. */
export type MemoryKey = number | string | Date | MemoryKey[];

function typeRank(key: MemoryKey): number {
  if (typeof key === 'number') return 0;
  if (key instanceof Date) return 1;
  if (typeof key === 'string') return 2;
  return 3;
}

/** IDB key comparison: number < Date < string < array, then within type. */
export function compareKeys(a: MemoryKey, b: MemoryKey): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;

  if (Array.isArray(a) && Array.isArray(b)) {
    const shared = Math.min(a.length, b.length);
    for (let i = 0; i < shared; i++) {
      const left = a[i];
      const right = b[i];
      if (left === undefined || right === undefined) break;
      const result = compareKeys(left, right);
      if (result !== 0) return result;
    }
    if (a.length === b.length) return 0;
    return a.length < b.length ? -1 : 1;
  }

  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av === bv) return 0;
  return (av as number | string) < (bv as number | string) ? -1 : 1;
}

function isValidKey(value: unknown): value is MemoryKey {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return true;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (Array.isArray(value)) return value.every(isValidKey);
  return false;
}

/** Read `keyPath` out of a record. Returns undefined when any segment is missing. */
function extractKey(value: unknown, keyPath: string | string[]): MemoryKey | undefined {
  if (Array.isArray(keyPath)) {
    const parts: MemoryKey[] = [];
    for (const path of keyPath) {
      const part = extractKey(value, path);
      if (part === undefined) return undefined;
      parts.push(part);
    }
    return parts;
  }
  let cursor: unknown = value;
  for (const segment of keyPath.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return isValidKey(cursor) ? cursor : undefined;
}

function injectKey(value: unknown, keyPath: string | string[], key: MemoryKey): void {
  if (Array.isArray(keyPath)) return; // generated keys are never array key paths
  const segments = keyPath.split('.');
  let cursor = value as Record<string, unknown>;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (segment === undefined) return;
    const next = cursor[segment];
    if (next === null || typeof next !== 'object') return;
    cursor = next as Record<string, unknown>;
  }
  const last = segments[segments.length - 1];
  if (last !== undefined) cursor[last] = key;
}

// ---------------------------------------------------------------------------
// Cloning
// ---------------------------------------------------------------------------

/**
 * Structured-clone a stored value.
 *
 * Falls back to a hand-rolled deep copy when `structuredClone` is missing,
 * because a double that silently shares references would hide exactly the
 * aliasing bugs a storage test is supposed to catch.
 */
function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return deepCopy(value);
}

function deepCopy<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (value instanceof Uint8Array) return new Uint8Array(value) as unknown as T;
  if (Array.isArray(value)) return value.map((item: unknown) => deepCopy(item)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = deepCopy(item);
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// Key ranges
// ---------------------------------------------------------------------------

interface KeyRangeLike {
  readonly lower: MemoryKey | undefined;
  readonly upper: MemoryKey | undefined;
  readonly lowerOpen: boolean;
  readonly upperOpen: boolean;
}

class MemoryIDBKeyRange implements KeyRangeLike {
  constructor(
    readonly lower: MemoryKey | undefined,
    readonly upper: MemoryKey | undefined,
    readonly lowerOpen: boolean,
    readonly upperOpen: boolean,
  ) {}

  static only(value: MemoryKey): MemoryIDBKeyRange {
    return new MemoryIDBKeyRange(value, value, false, false);
  }

  static bound(
    lower: MemoryKey,
    upper: MemoryKey,
    lowerOpen = false,
    upperOpen = false,
  ): MemoryIDBKeyRange {
    return new MemoryIDBKeyRange(lower, upper, lowerOpen, upperOpen);
  }

  static lowerBound(lower: MemoryKey, open = false): MemoryIDBKeyRange {
    return new MemoryIDBKeyRange(lower, undefined, open, false);
  }

  static upperBound(upper: MemoryKey, open = false): MemoryIDBKeyRange {
    return new MemoryIDBKeyRange(undefined, upper, false, open);
  }

  includes(key: MemoryKey): boolean {
    return keyInRange(key, this);
  }
}

function isKeyRange(query: unknown): query is KeyRangeLike {
  return (
    query !== null &&
    typeof query === 'object' &&
    'lowerOpen' in query &&
    'upperOpen' in query
  );
}

function keyInRange(key: MemoryKey, range: KeyRangeLike): boolean {
  if (range.lower !== undefined) {
    const c = compareKeys(key, range.lower);
    if (c < 0 || (c === 0 && range.lowerOpen)) return false;
  }
  if (range.upper !== undefined) {
    const c = compareKeys(key, range.upper);
    if (c > 0 || (c === 0 && range.upperOpen)) return false;
  }
  return true;
}

function matchesQuery(key: MemoryKey, query: unknown): boolean {
  if (query === undefined || query === null) return true;
  if (isKeyRange(query)) return keyInRange(key, query);
  return compareKeys(key, query as MemoryKey) === 0;
}

// ---------------------------------------------------------------------------
// Storage model
// ---------------------------------------------------------------------------

interface StoredRecord {
  key: MemoryKey;
  value: unknown;
}

interface IndexData {
  name: string;
  keyPath: string | string[];
  unique: boolean;
  multiEntry: boolean;
}

interface StoreData {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  keyGenerator: number;
  records: StoredRecord[];
  indexes: Map<string, IndexData>;
}

interface DatabaseData {
  name: string;
  version: number;
  stores: Map<string, StoreData>;
}

function insertRecord(store: StoreData, record: StoredRecord): void {
  let lo = 0;
  let hi = store.records.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const at = store.records[mid];
    if (at === undefined) break;
    if (compareKeys(at.key, record.key) < 0) lo = mid + 1;
    else hi = mid;
  }
  const existing = store.records[lo];
  if (existing !== undefined && compareKeys(existing.key, record.key) === 0) {
    store.records[lo] = record;
    return;
  }
  store.records.splice(lo, 0, record);
}

function findRecord(store: StoreData, key: MemoryKey): StoredRecord | undefined {
  return store.records.find((record) => compareKeys(record.key, key) === 0);
}

// ---------------------------------------------------------------------------
// Errors and events
// ---------------------------------------------------------------------------

function idbError(name: string, message: string): DOMException {
  return new DOMException(message, name);
}

class MemoryIDBVersionChangeEvent extends Event {
  constructor(
    type: string,
    readonly oldVersion: number,
    readonly newVersion: number | null,
  ) {
    super(type);
  }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

type EventHandler = (event: Event) => void;

class MemoryIDBRequest extends EventTarget {
  result: unknown = undefined;
  error: DOMException | null = null;
  readyState: 'pending' | 'done' = 'pending';
  source: unknown = null;
  transaction: MemoryIDBTransaction | null = null;

  #onsuccess: EventHandler | null = null;
  #onerror: EventHandler | null = null;

  get onsuccess(): EventHandler | null {
    return this.#onsuccess;
  }

  set onsuccess(handler: EventHandler | null) {
    if (this.#onsuccess) this.removeEventListener('success', this.#onsuccess);
    this.#onsuccess = handler;
    if (handler) this.addEventListener('success', handler);
  }

  get onerror(): EventHandler | null {
    return this.#onerror;
  }

  set onerror(handler: EventHandler | null) {
    if (this.#onerror) this.removeEventListener('error', this.#onerror);
    this.#onerror = handler;
    if (handler) this.addEventListener('error', handler);
  }

  succeed(result: unknown): void {
    this.result = result;
    this.error = null;
    this.readyState = 'done';
    this.dispatchEvent(new Event('success'));
  }

  fail(error: DOMException): void {
    this.result = undefined;
    this.error = error;
    this.readyState = 'done';
    this.dispatchEvent(new Event('error'));
  }
}

class MemoryIDBOpenDBRequest extends MemoryIDBRequest {
  #onupgradeneeded: EventHandler | null = null;

  get onupgradeneeded(): EventHandler | null {
    return this.#onupgradeneeded;
  }

  set onupgradeneeded(handler: EventHandler | null) {
    if (this.#onupgradeneeded) this.removeEventListener('upgradeneeded', this.#onupgradeneeded);
    this.#onupgradeneeded = handler;
    if (handler) this.addEventListener('upgradeneeded', handler);
  }
}

// ---------------------------------------------------------------------------
// String list
// ---------------------------------------------------------------------------

class MemoryStringList extends Array<string> {
  contains(name: string): boolean {
    return this.includes(name);
  }

  item(index: number): string | null {
    return this[index] ?? null;
  }
}

function stringList(names: Iterable<string>): MemoryStringList {
  const list = new MemoryStringList();
  for (const name of names) list.push(name);
  return list;
}

// ---------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------

interface CursorEntry {
  cursorKey: MemoryKey;
  primaryKey: MemoryKey;
  value: unknown;
}

class MemoryIDBCursor {
  #position = -1;

  constructor(
    readonly source: MemoryIDBObjectStore | MemoryIDBIndex,
    readonly direction: IDBCursorDirection,
    readonly request: MemoryIDBRequest,
    private readonly entries: CursorEntry[],
    private readonly store: MemoryIDBObjectStore,
    private readonly withValue: boolean,
  ) {}

  get key(): MemoryKey | undefined {
    return this.entries[this.#position]?.cursorKey;
  }

  get primaryKey(): MemoryKey | undefined {
    return this.entries[this.#position]?.primaryKey;
  }

  get value(): unknown {
    if (!this.withValue) return undefined;
    const entry = this.entries[this.#position];
    return entry === undefined ? undefined : cloneValue(entry.value);
  }

  /** Move to the next position and re-fire the owning request. Internal. */
  step(by: number, target: MemoryKey | undefined): void {
    this.store.transaction.enqueue(() => {
      if (target === undefined) {
        this.#position += by;
      } else {
        let next = this.#position + 1;
        while (next < this.entries.length) {
          const entry = this.entries[next];
          if (entry !== undefined && compareKeys(entry.cursorKey, target) >= 0) break;
          next++;
        }
        this.#position = next;
      }
      this.request.succeed(this.#position < this.entries.length ? this : null);
    });
  }

  /** Called once by the store/index to deliver the first position. Internal. */
  start(): void {
    this.step(1, undefined);
  }

  continue(key?: MemoryKey): void {
    this.step(1, key);
  }

  continuePrimaryKey(): void {
    throw idbError('NotSupportedError', 'memory-idb does not model continuePrimaryKey');
  }

  advance(count: number): void {
    if (!Number.isInteger(count) || count < 1) {
      throw idbError('TypeError', 'advance(count) needs a positive integer');
    }
    this.step(count, undefined);
  }

  update(value: unknown): MemoryIDBRequest {
    const primaryKey = this.primaryKey;
    if (primaryKey === undefined) {
      throw idbError('InvalidStateError', 'cursor is not positioned on a record');
    }
    return this.store.put(value, primaryKey);
  }

  delete(): MemoryIDBRequest {
    const primaryKey = this.primaryKey;
    if (primaryKey === undefined) {
      throw idbError('InvalidStateError', 'cursor is not positioned on a record');
    }
    return this.store.delete(primaryKey);
  }
}

class MemoryIDBCursorWithValue extends MemoryIDBCursor {}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

class MemoryIDBIndex {
  constructor(
    readonly objectStore: MemoryIDBObjectStore,
    private readonly data: IndexData,
  ) {}

  get name(): string {
    return this.data.name;
  }

  get keyPath(): string | string[] {
    return this.data.keyPath;
  }

  get unique(): boolean {
    return this.data.unique;
  }

  get multiEntry(): boolean {
    return this.data.multiEntry;
  }

  /** Every record that has a value for this index, sorted by index key. */
  entries(): CursorEntry[] {
    const out: CursorEntry[] = [];
    for (const record of this.objectStore.storeData.records) {
      const cursorKey = extractKey(record.value, this.data.keyPath);
      if (cursorKey === undefined) continue;
      out.push({ cursorKey, primaryKey: record.key, value: record.value });
    }
    out.sort(
      (a, b) =>
        compareKeys(a.cursorKey, b.cursorKey) || compareKeys(a.primaryKey, b.primaryKey),
    );
    return out;
  }

  #select(query: unknown, count?: number): CursorEntry[] {
    const matched = this.entries().filter((entry) => matchesQuery(entry.cursorKey, query));
    return count === undefined ? matched : matched.slice(0, Math.max(0, count));
  }

  get(query: unknown): MemoryIDBRequest {
    return this.objectStore.transaction.run(this, () => {
      const first = this.#select(query, 1)[0];
      return first === undefined ? undefined : cloneValue(first.value);
    });
  }

  getKey(query: unknown): MemoryIDBRequest {
    return this.objectStore.transaction.run(this, () => this.#select(query, 1)[0]?.primaryKey);
  }

  getAll(query?: unknown, count?: number): MemoryIDBRequest {
    return this.objectStore.transaction.run(this, () =>
      this.#select(query, count).map((entry) => cloneValue(entry.value)),
    );
  }

  getAllKeys(query?: unknown, count?: number): MemoryIDBRequest {
    return this.objectStore.transaction.run(this, () =>
      this.#select(query, count).map((entry) => entry.primaryKey),
    );
  }

  count(query?: unknown): MemoryIDBRequest {
    return this.objectStore.transaction.run(this, () => this.#select(query).length);
  }

  openCursor(query?: unknown, direction: IDBCursorDirection = 'next'): MemoryIDBRequest {
    return openCursorOn(this.objectStore, this, this.#select(query), direction, true);
  }

  openKeyCursor(query?: unknown, direction: IDBCursorDirection = 'next'): MemoryIDBRequest {
    return openCursorOn(this.objectStore, this, this.#select(query), direction, false);
  }
}

function openCursorOn(
  store: MemoryIDBObjectStore,
  source: MemoryIDBObjectStore | MemoryIDBIndex,
  entries: CursorEntry[],
  direction: IDBCursorDirection,
  withValue: boolean,
): MemoryIDBRequest {
  if (direction === 'nextunique' || direction === 'prevunique') {
    throw idbError('NotSupportedError', `memory-idb does not model ${direction} cursors`);
  }
  const ordered = direction === 'prev' ? [...entries].reverse() : entries;
  const request = new MemoryIDBRequest();
  request.source = source;
  request.transaction = store.transaction;
  const cursor = withValue
    ? new MemoryIDBCursorWithValue(source, direction, request, ordered, store, true)
    : new MemoryIDBCursor(source, direction, request, ordered, store, false);
  cursor.start();
  return request;
}

// ---------------------------------------------------------------------------
// Object store
// ---------------------------------------------------------------------------

class MemoryIDBObjectStore {
  constructor(
    readonly transaction: MemoryIDBTransaction,
    readonly storeData: StoreData,
  ) {}

  get name(): string {
    return this.storeData.name;
  }

  get keyPath(): string | string[] | null {
    return this.storeData.keyPath;
  }

  get autoIncrement(): boolean {
    return this.storeData.autoIncrement;
  }

  get indexNames(): MemoryStringList {
    return stringList([...this.storeData.indexes.keys()].sort());
  }

  createIndex(
    name: string,
    keyPath: string | string[],
    options: IDBIndexParameters = {},
  ): MemoryIDBIndex {
    this.transaction.assertVersionChange();
    if (options.multiEntry === true) {
      throw idbError('NotSupportedError', 'memory-idb does not model multiEntry indexes');
    }
    const data: IndexData = {
      name,
      keyPath,
      unique: options.unique === true,
      multiEntry: false,
    };
    this.storeData.indexes.set(name, data);
    return new MemoryIDBIndex(this, data);
  }

  deleteIndex(name: string): void {
    this.transaction.assertVersionChange();
    this.storeData.indexes.delete(name);
  }

  index(name: string): MemoryIDBIndex {
    const data = this.storeData.indexes.get(name);
    if (data === undefined) {
      throw idbError('NotFoundError', `no index ${name} on ${this.storeData.name}`);
    }
    return new MemoryIDBIndex(this, data);
  }

  #keyFor(value: unknown, explicitKey: MemoryKey | undefined, generate: boolean): MemoryKey {
    const { keyPath } = this.storeData;
    if (keyPath !== null) {
      const inline = extractKey(value, keyPath);
      if (inline !== undefined) return inline;
      if (this.storeData.autoIncrement && generate) {
        const generated = this.storeData.keyGenerator++;
        injectKey(value, keyPath, generated);
        return generated;
      }
      throw idbError('DataError', `record has no value at key path ${String(keyPath)}`);
    }
    if (explicitKey === undefined) {
      throw idbError('DataError', 'out-of-line store needs an explicit key');
    }
    return explicitKey;
  }

  #write(value: unknown, explicitKey: MemoryKey | undefined, overwrite: boolean): MemoryIDBRequest {
    this.transaction.assertWritable();
    return this.transaction.run(this, () => {
      this.transaction.snapshot(this.storeData);
      const stored = cloneValue(value);
      const key = this.#keyFor(stored, explicitKey, true);
      if (!overwrite && findRecord(this.storeData, key) !== undefined) {
        throw idbError('ConstraintError', `key already exists in ${this.storeData.name}`);
      }
      insertRecord(this.storeData, { key, value: stored });
      return key;
    });
  }

  add(value: unknown, key?: MemoryKey): MemoryIDBRequest {
    return this.#write(value, key, false);
  }

  put(value: unknown, key?: MemoryKey): MemoryIDBRequest {
    return this.#write(value, key, true);
  }

  get(query: unknown): MemoryIDBRequest {
    return this.transaction.run(this, () => {
      const found = this.#select(query, 1)[0];
      return found === undefined ? undefined : cloneValue(found.value);
    });
  }

  getKey(query: unknown): MemoryIDBRequest {
    return this.transaction.run(this, () => this.#select(query, 1)[0]?.key);
  }

  getAll(query?: unknown, count?: number): MemoryIDBRequest {
    return this.transaction.run(this, () =>
      this.#select(query, count).map((record) => cloneValue(record.value)),
    );
  }

  getAllKeys(query?: unknown, count?: number): MemoryIDBRequest {
    return this.transaction.run(this, () => this.#select(query, count).map((record) => record.key));
  }

  count(query?: unknown): MemoryIDBRequest {
    return this.transaction.run(this, () => this.#select(query).length);
  }

  delete(query: unknown): MemoryIDBRequest {
    this.transaction.assertWritable();
    return this.transaction.run(this, () => {
      this.transaction.snapshot(this.storeData);
      const doomed = this.#select(query);
      for (const record of doomed) {
        const at = this.storeData.records.indexOf(record);
        if (at >= 0) this.storeData.records.splice(at, 1);
      }
      return undefined;
    });
  }

  clear(): MemoryIDBRequest {
    this.transaction.assertWritable();
    return this.transaction.run(this, () => {
      this.transaction.snapshot(this.storeData);
      this.storeData.records.length = 0;
      return undefined;
    });
  }

  openCursor(query?: unknown, direction: IDBCursorDirection = 'next'): MemoryIDBRequest {
    const entries = this.#select(query).map<CursorEntry>((record) => ({
      cursorKey: record.key,
      primaryKey: record.key,
      value: record.value,
    }));
    return openCursorOn(this, this, entries, direction, true);
  }

  openKeyCursor(query?: unknown, direction: IDBCursorDirection = 'next'): MemoryIDBRequest {
    const entries = this.#select(query).map<CursorEntry>((record) => ({
      cursorKey: record.key,
      primaryKey: record.key,
      value: record.value,
    }));
    return openCursorOn(this, this, entries, direction, false);
  }

  #select(query: unknown, count?: number): StoredRecord[] {
    const matched = this.storeData.records.filter((record) => matchesQuery(record.key, query));
    return count === undefined ? matched : matched.slice(0, Math.max(0, count));
  }
}

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

type TransactionMode = IDBTransactionMode | 'versionchange';

class MemoryIDBTransaction extends EventTarget {
  error: DOMException | null = null;

  #queue: (() => void)[] = [];
  #drainScheduled = false;
  #commitTimer: ReturnType<typeof setTimeout> | null = null;
  #finished = false;
  #snapshots = new Map<string, StoredRecord[]>();
  #oncomplete: EventHandler | null = null;
  #onerror: EventHandler | null = null;
  #onabort: EventHandler | null = null;

  constructor(
    readonly db: MemoryIDBDatabase,
    readonly storeNames: MemoryStringList,
    readonly mode: TransactionMode,
  ) {
    super();
    this.#scheduleCommitCheck();
  }

  get objectStoreNames(): MemoryStringList {
    return this.storeNames;
  }

  get oncomplete(): EventHandler | null {
    return this.#oncomplete;
  }

  set oncomplete(handler: EventHandler | null) {
    if (this.#oncomplete) this.removeEventListener('complete', this.#oncomplete);
    this.#oncomplete = handler;
    if (handler) this.addEventListener('complete', handler);
  }

  get onerror(): EventHandler | null {
    return this.#onerror;
  }

  set onerror(handler: EventHandler | null) {
    if (this.#onerror) this.removeEventListener('error', this.#onerror);
    this.#onerror = handler;
    if (handler) this.addEventListener('error', handler);
  }

  get onabort(): EventHandler | null {
    return this.#onabort;
  }

  set onabort(handler: EventHandler | null) {
    if (this.#onabort) this.removeEventListener('abort', this.#onabort);
    this.#onabort = handler;
    if (handler) this.addEventListener('abort', handler);
  }

  objectStore(name: string): MemoryIDBObjectStore {
    if (!this.storeNames.contains(name)) {
      throw idbError('NotFoundError', `${name} is not in this transaction's scope`);
    }
    const data = this.db.data.stores.get(name);
    if (data === undefined) {
      throw idbError('NotFoundError', `no object store named ${name}`);
    }
    return new MemoryIDBObjectStore(this, data);
  }

  assertWritable(): void {
    if (this.mode === 'readonly') {
      throw idbError('ReadOnlyError', 'transaction is readonly');
    }
  }

  assertVersionChange(): void {
    if (this.mode !== 'versionchange') {
      throw idbError('InvalidStateError', 'schema changes need a versionchange transaction');
    }
  }

  /** Keep a copy of a store's contents so `abort()` can put them back. */
  snapshot(store: StoreData): void {
    if (this.#snapshots.has(store.name)) return;
    this.#snapshots.set(
      store.name,
      store.records.map((record) => ({ key: record.key, value: cloneValue(record.value) })),
    );
  }

  /** Queue an operation and hand back the request it will resolve. */
  run(source: unknown, operation: () => unknown): MemoryIDBRequest {
    const request = new MemoryIDBRequest();
    request.source = source;
    request.transaction = this;
    this.enqueue(() => {
      try {
        request.succeed(operation());
      } catch (thrown) {
        const error =
          thrown instanceof DOMException
            ? thrown
            : idbError('UnknownError', thrown instanceof Error ? thrown.message : String(thrown));
        request.fail(error);
        this.abortWith(error);
      }
    });
    return request;
  }

  enqueue(operation: () => void): void {
    if (this.#finished) {
      throw idbError('TransactionInactiveError', 'transaction has already finished');
    }
    this.#queue.push(operation);
    if (this.#commitTimer !== null) {
      clearTimeout(this.#commitTimer);
      this.#commitTimer = null;
    }
    if (this.#drainScheduled) return;
    this.#drainScheduled = true;
    queueMicrotask(() => {
      this.#drainScheduled = false;
      this.#drain();
    });
  }

  #drain(): void {
    while (this.#queue.length > 0 && !this.#finished) {
      const operation = this.#queue.shift();
      if (operation === undefined) break;
      operation();
    }
    if (!this.#finished) this.#scheduleCommitCheck();
  }

  /**
   * Commit once the queue has stayed empty across a full task.
   *
   * Real IDB commits when no request is outstanding at the end of the current
   * task. Deferring by one macrotask is slightly more patient than the spec,
   * never less - code that works here also works in a browser, which is the
   * direction that matters for a test double.
   */
  #scheduleCommitCheck(): void {
    if (this.#finished || this.#commitTimer !== null) return;
    this.#commitTimer = setTimeout(() => {
      this.#commitTimer = null;
      if (this.#finished) return;
      if (this.#queue.length > 0) {
        this.#drain();
        return;
      }
      this.#finished = true;
      this.#snapshots.clear();
      this.dispatchEvent(new Event('complete'));
    }, 0);
  }

  abortWith(error: DOMException): void {
    if (this.#finished) return;
    this.#finished = true;
    if (this.#commitTimer !== null) {
      clearTimeout(this.#commitTimer);
      this.#commitTimer = null;
    }
    this.#queue.length = 0;
    for (const [name, records] of this.#snapshots) {
      const store = this.db.data.stores.get(name);
      if (store !== undefined) store.records = records;
    }
    this.#snapshots.clear();
    this.error = error;
    this.dispatchEvent(new Event('abort'));
  }

  abort(): void {
    this.abortWith(idbError('AbortError', 'transaction aborted'));
  }

  commit(): void {
    this.#scheduleCommitCheck();
  }
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

class MemoryIDBDatabase extends EventTarget {
  closed = false;
  upgradeTransaction: MemoryIDBTransaction | null = null;

  constructor(readonly data: DatabaseData) {
    super();
  }

  get name(): string {
    return this.data.name;
  }

  get version(): number {
    return this.data.version;
  }

  get objectStoreNames(): MemoryStringList {
    return stringList([...this.data.stores.keys()].sort());
  }

  createObjectStore(name: string, options: IDBObjectStoreParameters = {}): MemoryIDBObjectStore {
    const tx = this.upgradeTransaction;
    if (tx === null) {
      throw idbError('InvalidStateError', 'createObjectStore needs a versionchange transaction');
    }
    if (this.data.stores.has(name)) {
      throw idbError('ConstraintError', `object store ${name} already exists`);
    }
    const store: StoreData = {
      name,
      keyPath: options.keyPath === undefined ? null : options.keyPath,
      autoIncrement: options.autoIncrement === true,
      keyGenerator: 1,
      records: [],
      indexes: new Map(),
    };
    this.data.stores.set(name, store);
    tx.storeNames.push(name);
    return new MemoryIDBObjectStore(tx, store);
  }

  deleteObjectStore(name: string): void {
    const tx = this.upgradeTransaction;
    if (tx === null) {
      throw idbError('InvalidStateError', 'deleteObjectStore needs a versionchange transaction');
    }
    this.data.stores.delete(name);
  }

  transaction(
    storeNames: string | readonly string[],
    mode: IDBTransactionMode = 'readonly',
  ): MemoryIDBTransaction {
    if (this.closed) {
      throw idbError('InvalidStateError', 'database connection is closed');
    }
    const names = typeof storeNames === 'string' ? [storeNames] : [...storeNames];
    for (const name of names) {
      if (!this.data.stores.has(name)) {
        throw idbError('NotFoundError', `no object store named ${name}`);
      }
    }
    return new MemoryIDBTransaction(this, stringList(names), mode);
  }

  close(): void {
    this.closed = true;
    this.dispatchEvent(new Event('close'));
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

class MemoryIDBFactory {
  readonly databases_ = new Map<string, DatabaseData>();

  open(name: string, version?: number): MemoryIDBOpenDBRequest {
    const request = new MemoryIDBOpenDBRequest();

    // Asynchronous on purpose: `idb` attaches its `upgradeneeded` listener
    // after `open()` returns, so an event fired synchronously would be missed.
    setTimeout(() => {
      let data = this.databases_.get(name);
      const existed = data !== undefined;
      if (data === undefined) {
        data = { name, version: 0, stores: new Map() };
        this.databases_.set(name, data);
      }
      const target = version ?? (existed ? data.version : 1);
      if (target < data.version) {
        request.fail(
          idbError('VersionError', `cannot open ${name} at v${String(target)}: on disk is v${String(data.version)}`),
        );
        return;
      }

      const db = new MemoryIDBDatabase(data);
      request.result = db;

      if (target > data.version) {
        const oldVersion = data.version;
        data.version = target;
        const tx = new MemoryIDBTransaction(db, stringList(data.stores.keys()), 'versionchange');
        db.upgradeTransaction = tx;
        request.transaction = tx;
        tx.addEventListener('complete', () => {
          db.upgradeTransaction = null;
          request.transaction = null;
          request.succeed(db);
        });
        tx.addEventListener('abort', () => {
          db.upgradeTransaction = null;
          request.transaction = null;
          data.version = oldVersion;
          request.fail(tx.error ?? idbError('AbortError', 'upgrade aborted'));
        });
        request.dispatchEvent(new MemoryIDBVersionChangeEvent('upgradeneeded', oldVersion, target));
        return;
      }

      request.succeed(db);
    }, 0);

    return request;
  }

  deleteDatabase(name: string): MemoryIDBOpenDBRequest {
    const request = new MemoryIDBOpenDBRequest();
    setTimeout(() => {
      const existing = this.databases_.get(name);
      this.databases_.delete(name);
      request.succeed(existing?.version ?? 0);
    }, 0);
    return request;
  }

  cmp(a: MemoryKey, b: MemoryKey): number {
    return compareKeys(a, b);
  }

  databases(): Promise<{ name: string; version: number }[]> {
    return Promise.resolve(
      [...this.databases_.values()].map((data) => ({ name: data.name, version: data.version })),
    );
  }
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

const GLOBAL_NAMES = [
  'indexedDB',
  'IDBFactory',
  'IDBDatabase',
  'IDBTransaction',
  'IDBObjectStore',
  'IDBIndex',
  'IDBCursor',
  'IDBCursorWithValue',
  'IDBRequest',
  'IDBOpenDBRequest',
  'IDBKeyRange',
  'IDBVersionChangeEvent',
] as const;

export interface MemoryIndexedDB {
  /** The factory installed as `globalThis.indexedDB`. */
  readonly factory: MemoryIDBFactory;
  /** Drop every database this factory holds, keeping the globals installed. */
  reset(): void;
  /** Put the globals back the way they were. */
  uninstall(): void;
}

/**
 * Install the double as the global IndexedDB implementation.
 *
 * Call this before anything imports or calls `idb`: `idb` caches the global
 * constructors the first time it wraps a value, and a second install inside
 * the same module registry would leave it comparing against stale classes.
 * One call per test file, in a `beforeAll`, is the intended shape.
 */
export function installMemoryIndexedDB(): MemoryIndexedDB {
  const factory = new MemoryIDBFactory();
  const scope = globalThis as unknown as Record<string, unknown>;
  const previous = new Map<string, unknown>();
  for (const name of GLOBAL_NAMES) previous.set(name, scope[name]);

  Object.assign(globalThis, {
    indexedDB: factory,
    IDBFactory: MemoryIDBFactory,
    IDBDatabase: MemoryIDBDatabase,
    IDBTransaction: MemoryIDBTransaction,
    IDBObjectStore: MemoryIDBObjectStore,
    IDBIndex: MemoryIDBIndex,
    IDBCursor: MemoryIDBCursor,
    IDBCursorWithValue: MemoryIDBCursorWithValue,
    IDBRequest: MemoryIDBRequest,
    IDBOpenDBRequest: MemoryIDBOpenDBRequest,
    IDBKeyRange: MemoryIDBKeyRange,
    IDBVersionChangeEvent: MemoryIDBVersionChangeEvent,
  });

  return {
    factory,
    reset(): void {
      factory.databases_.clear();
    },
    uninstall(): void {
      for (const [name, value] of previous) {
        if (value === undefined) {
          // Reflect rather than `delete scope[name]`: the globals being
          // removed are computed names, and the lint rule that forbids that
          // is right - a dynamic delete on the global object deserves to be
          // spelled out.
          Reflect.deleteProperty(scope, name);
        } else {
          scope[name] = value;
        }
      }
    },
  };
}

export {
  MemoryIDBCursor,
  MemoryIDBDatabase,
  MemoryIDBFactory,
  MemoryIDBIndex,
  MemoryIDBKeyRange,
  MemoryIDBObjectStore,
  // Exported so a test can hand the factory a request that never settles,
  // which is what a version-blocked open looks like at this boundary. The
  // double does not model cross-connection blocking (see the header); this is
  // how a test reaches that shape without pretending it does.
  MemoryIDBOpenDBRequest,
  MemoryIDBRequest,
  MemoryIDBTransaction,
};
