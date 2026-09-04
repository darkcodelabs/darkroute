/**
 * CANONICAL SERIALISATION - fwm-canonical-json/v1
 * =============================================================================
 * A report payload is hashed and signed on the device. The backend re-hashes
 * the payload it receives and must reach BYTE-IDENTICAL input. This file is the
 * normative client implementation; the rules below are the specification. A
 * server that follows them reproduces these bytes exactly.
 *
 * RULE 0 - OUTPUT
 *   The output is a JSON text with NO insignificant whitespace, encoded UTF-8.
 *   `canonicalize()` returns the JS string; `canonicalBytes()` returns the UTF-8
 *   bytes, which are the thing that is actually hashed. Nothing else is hashed.
 *
 * RULE 1 - ACCEPTED VALUE TYPES
 *   null, boolean, number, string, array, plain object. Anything else is
 *   REJECTED with a CanonicalizationError: undefined inside an array, Date,
 *   Map, Set, RegExp, BigInt, symbol, function, class instances, boxed
 *   primitives, typed arrays, and objects with a prototype other than
 *   Object.prototype or null. There is no coercion and no `toJSON` hook - an
 *   object that silently serialises itself is an object whose bytes the server
 *   cannot predict.
 *
 * RULE 2 - OBJECT PROPERTIES
 *   Only own enumerable string-keyed properties are serialised. Symbol keys are
 *   rejected. A property whose value is `undefined` is DROPPED, exactly as
 *   JSON.stringify drops it, because such a property has no JSON encoding and
 *   therefore cannot survive a round trip through the wire. (`undefined` inside
 *   an ARRAY is rejected instead of being coerced to null, because array
 *   position is meaningful and a silent null would change the hash of data the
 *   author never wrote.)
 *
 * RULE 3 - KEY NORMALISATION AND ORDER
 *   Every key is normalised to Unicode NFC. If two distinct keys normalise to
 *   the same NFC form the object is REJECTED - the intended value is ambiguous.
 *   Keys are then sorted ASCENDING by the lexicographic order of their UTF-8
 *   ENCODED BYTES. UTF-8 byte order equals Unicode code-point order, so this is
 *   reproducible in any language without agreeing on UTF-16 details.
 *     Python:  sorted(keys, key=lambda k: unicodedata.normalize("NFC", k).encode("utf-8"))
 *     Go:      sort.Slice with norm.NFC then plain string `<` (Go strings are UTF-8)
 *   JavaScript's default `Array.prototype.sort` compares UTF-16 code units and
 *   is NOT equivalent for astral-plane keys; this file compares bytes.
 *
 * RULE 4 - STRINGS
 *   Normalised to NFC, then serialised between double quotes. Escaped:
 *     \"  \\  \b (U+0008)  \t (U+0009)  \n (U+000A)  \f (U+000C)  \r (U+000D)
 *   Every other code point below U+0020 becomes \u00XX with LOWERCASE hex.
 *   Everything else - including U+007F, U+2028, U+2029 and all non-ASCII - is
 *   emitted literally and carried by the UTF-8 encoding. Lone surrogates are
 *   REJECTED: they have no UTF-8 encoding, so no two implementations could
 *   agree on their bytes.
 *
 * RULE 5 - NUMBERS
 *   NaN, +Infinity and -Infinity are REJECTED. Negative zero is emitted as `0`.
 *   A value that is an exact integer is emitted as a plain decimal integer with
 *   no fraction, no exponent, no `+`, and no leading zeros, regardless of how it
 *   was written in the source JSON (`1`, `1.0` and `1e0` are the same IEEE-754
 *   double and therefore the same bytes: `1`). Integers are limited to
 *   |n| <= 2^53-1 (Number.MAX_SAFE_INTEGER); anything larger is REJECTED because
 *   the double no longer identifies a unique integer.
 *   A value that is NOT an exact integer is emitted with EXACTLY 9 fractional
 *   digits, rounding half AWAY FROM ZERO on the exact binary value, and is
 *   limited to |n| < 1e15. 9 digits is ~0.1 mm of latitude, far beyond any
 *   sensor this product reads.
 *     JavaScript:  x.toFixed(9)                       // ECMA-262 defines the tie as
 *                                                     // "pick the larger n", i.e. away from zero
 *     Python:      from decimal import Decimal, ROUND_HALF_UP
 *                  str(Decimal(x).quantize(Decimal("1.000000000"), rounding=ROUND_HALF_UP))
 *   Decimal(x) on a float in Python takes the EXACT binary value, which is what
 *   toFixed rounds, so the two agree including on exact ties such as 1/1024.
 *   Do not use `%.9f`/printf on the server: C and Python's format() round half
 *   to EVEN and disagree with this rule on those ties.
 *
 * RULE 6 - CONTAINERS
 *   Array: `[` value `,` value `]`, order preserved, no trailing comma.
 *   Object: `{` "key" `:` value `,` "key" `:` value `}`, no trailing comma.
 *   An empty array is `[]`; an empty object is `{}`.
 *   Cycles are REJECTED. Nesting deeper than MAX_DEPTH is REJECTED so a hostile
 *   or buggy payload cannot blow the stack during finalisation.
 * =============================================================================
 */

import { utf8 } from './bytes';

/** Identifier for this rule set. Store it next to anything these bytes signed. */
export const CANONICAL_FORM = 'fwm-canonical-json/v1';

/** Fractional digits for every non-integer number. See RULE 5. */
export const FRACTION_DIGITS = 9;

/** Non-integers must satisfy |n| < this. See RULE 5. */
export const MAX_NON_INTEGER_MAGNITUDE = 1e15;

/** Deepest nesting accepted. A report payload is nowhere near this. */
export const MAX_DEPTH = 64;

export type CanonicalPrimitive = string | number | boolean | null;

export interface CanonicalObject {
  readonly [key: string]: CanonicalValue | undefined;
}

export type CanonicalValue = CanonicalPrimitive | readonly CanonicalValue[] | CanonicalObject;

export type CanonicalizationErrorCode =
  | 'unsupported-type'
  | 'not-finite'
  | 'integer-out-of-range'
  | 'non-integer-out-of-range'
  | 'lone-surrogate'
  | 'duplicate-normalised-key'
  | 'symbol-key'
  | 'undefined-in-array'
  | 'cycle'
  | 'too-deep';

/** Every rejection above surfaces as this error, with the offending path. */
export class CanonicalizationError extends Error {
  override readonly name = 'CanonicalizationError';
  readonly code: CanonicalizationErrorCode;
  /** JSON-pointer-ish path, e.g. `$.position.lat` or `$.photos[2]`. */
  readonly path: string;

  constructor(code: CanonicalizationErrorCode, path: string, message: string) {
    super(`${message} (at ${path})`);
    this.code = code;
    this.path = path;
  }
}

/** Canonical JSON text. Hash `canonicalBytes()`, not this. */
export function canonicalize(value: CanonicalValue): string {
  return write(value, '$', 0, new Set<object>());
}

/** The UTF-8 bytes of `canonicalize(value)`. This is what gets hashed. */
export function canonicalBytes(value: CanonicalValue): Uint8Array {
  return utf8(canonicalize(value));
}

/** True when `value` is a plain object: prototype Object.prototype or null. */
export function isPlainObject(value: unknown): value is CanonicalObject {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function write(value: CanonicalValue, path: string, depth: number, seen: Set<object>): string {
  if (depth > MAX_DEPTH) {
    throw new CanonicalizationError('too-deep', path, `nesting exceeds ${String(MAX_DEPTH)} levels`);
  }
  if (value === null) return 'null';

  const type = typeof value;
  if (type === 'boolean') return value === true ? 'true' : 'false';
  if (type === 'number') return writeNumber(value as number, path);
  if (type === 'string') return writeString(value as string, path);

  if (Array.isArray(value)) return writeArray(value, path, depth, seen);
  if (isPlainObject(value)) return writeObject(value, path, depth, seen);

  throw new CanonicalizationError(
    'unsupported-type',
    path,
    `value of type ${describe(value)} has no canonical form`,
  );
}

function writeArray(
  value: readonly CanonicalValue[],
  path: string,
  depth: number,
  seen: Set<object>,
): string {
  guardCycle(value, path, seen);
  const parts: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    const itemPath = `${path}[${String(i)}]`;
    if (item === undefined) {
      throw new CanonicalizationError(
        'undefined-in-array',
        itemPath,
        'undefined has no canonical form and must not be coerced to null inside an array',
      );
    }
    parts.push(write(item, itemPath, depth + 1, seen));
  }
  seen.delete(value);
  return `[${parts.join(',')}]`;
}

function writeObject(
  value: CanonicalObject,
  path: string,
  depth: number,
  seen: Set<object>,
): string {
  guardCycle(value, path, seen);

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new CanonicalizationError('symbol-key', path, 'symbol-keyed properties are not encodable');
  }

  const entries: { normalised: string; encoded: Uint8Array; raw: string }[] = [];
  const byNormalised = new Map<string, string>();

  for (const raw of Object.keys(value)) {
    if (value[raw] === undefined) continue; // RULE 2
    const normalised = raw.normalize('NFC');
    rejectLoneSurrogates(normalised, `${path}.${raw}`);
    const previous = byNormalised.get(normalised);
    if (previous !== undefined) {
      throw new CanonicalizationError(
        'duplicate-normalised-key',
        `${path}.${raw}`,
        `keys ${JSON.stringify(previous)} and ${JSON.stringify(raw)} both normalise to ${JSON.stringify(normalised)}`,
      );
    }
    byNormalised.set(normalised, raw);
    entries.push({ normalised, encoded: utf8(normalised), raw });
  }

  entries.sort((a, b) => compareBytes(a.encoded, b.encoded)); // RULE 3

  const parts: string[] = [];
  for (const entry of entries) {
    const child = value[entry.raw];
    // `child` cannot be undefined: undefined-valued keys were skipped above.
    const childPath = `${path}.${entry.normalised}`;
    parts.push(
      `${writeString(entry.normalised, childPath)}:${write(child as CanonicalValue, childPath, depth + 1, seen)}`,
    );
  }
  seen.delete(value);
  return `{${parts.join(',')}}`;
}

function guardCycle(value: object, path: string, seen: Set<object>): void {
  if (seen.has(value)) {
    throw new CanonicalizationError('cycle', path, 'value refers to itself');
  }
  seen.add(value);
}

function writeNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError(
      'not-finite',
      path,
      'NaN and Infinity have no canonical form; a sensor that produced one is a bug, not a value',
    );
  }
  if (Object.is(value, -0)) return '0'; // RULE 5
  if (Number.isInteger(value)) {
    if (Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new CanonicalizationError(
        'integer-out-of-range',
        path,
        'integer magnitude exceeds Number.MAX_SAFE_INTEGER',
      );
    }
    return value.toFixed(0);
  }
  if (Math.abs(value) >= MAX_NON_INTEGER_MAGNITUDE) {
    throw new CanonicalizationError(
      'non-integer-out-of-range',
      path,
      'non-integer magnitude is too large for a fixed 9-digit fraction',
    );
  }
  return value.toFixed(FRACTION_DIGITS);
}

const SHORT_ESCAPES: ReadonlyMap<number, string> = new Map([
  [0x08, '\\b'],
  [0x09, '\\t'],
  [0x0a, '\\n'],
  [0x0c, '\\f'],
  [0x0d, '\\r'],
  [0x22, '\\"'],
  [0x5c, '\\\\'],
]);

function writeString(value: string, path: string): string {
  const normalised = value.normalize('NFC');
  rejectLoneSurrogates(normalised, path);
  let out = '"';
  for (const ch of normalised) {
    const cp = ch.codePointAt(0) ?? 0;
    const short = SHORT_ESCAPES.get(cp);
    if (short !== undefined) {
      out += short;
    } else if (cp < 0x20) {
      out += `\\u00${cp.toString(16).padStart(2, '0')}`;
    } else {
      out += ch;
    }
  }
  return `${out}"`;
}

function rejectLoneSurrogates(value: string, path: string): void {
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0xd800 && cp <= 0xdfff) {
      throw new CanonicalizationError(
        'lone-surrogate',
        path,
        'string contains an unpaired surrogate, which has no UTF-8 encoding',
      );
    }
  }
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x - y;
  }
  return a.length - b.length;
}

function describe(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') {
    const ctor: unknown = (value as { constructor?: unknown }).constructor;
    const name =
      typeof ctor === 'function' ? ((ctor as { name?: string }).name ?? 'object') : 'object';
    return name;
  }
  return typeof value;
}
