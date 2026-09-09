import { describe, expect, it } from 'vitest';
import {
  CanonicalizationError,
  MAX_DEPTH,
  canonicalBytes,
  canonicalize,
  isPlainObject,
  type CanonicalValue,
} from './canonicalize';
import { sha256Hex, utf8Decode } from './bytes';

const subtle = globalThis.crypto.subtle;

/** U+0063 U+0061 U+0066 U+00E9 -- the precomposed form. */
const E_ACUTE_NFC = 'café';
/** U+0063 U+0061 U+0066 U+0065 U+0301 -- the decomposed form, same grapheme. */
const E_ACUTE_NFD = 'café';
/** U+0000 and U+001F: the two ends of the range JSON must escape. */
const CONTROL_PAIR = String.fromCodePoint(0x00, 0x1f);
/** U+007F, U+2028, U+2029: NOT escaped by this canonical form. */
const UNESCAPED_ODDBALLS = String.fromCodePoint(0x7f, 0x2028, 0x2029);

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof CanonicalizationError) return error.code;
    return `unexpected:${String(error)}`;
  }
  return 'did-not-throw';
}

describe('stability', () => {
  it('is independent of the order the keys were written in', () => {
    const a = { zulu: 1, alpha: 2, mike: 3 };
    const b = { mike: 3, zulu: 1, alpha: 2 };
    expect(canonicalize(a)).toBe('{"alpha":2,"mike":3,"zulu":1}');
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('is independent of object identity', () => {
    const payload = { position: { lat: 39.0997, lon: -84.5786 }, mounts: ['pole', 'mast'] };
    const clone = JSON.parse(JSON.stringify(payload)) as CanonicalValue;
    expect(payload).not.toBe(clone);
    expect(canonicalize(clone)).toBe(canonicalize(payload));
  });

  it('hashes the same payload to the same digest every time', async () => {
    const payload = {
      captured_at: '2026-08-20T14:22:08.412Z',
      gps_accuracy_m: 4,
      heading_deg: 223,
      position: { lat: 39.0997, lon: -84.5786 },
      speed_mph: 47,
    };
    const shuffled = {
      speed_mph: 47,
      position: { lon: -84.5786, lat: 39.0997 },
      heading_deg: 223,
      gps_accuracy_m: 4,
      captured_at: '2026-08-20T14:22:08.412Z',
    };
    const first = await sha256Hex(subtle, canonicalBytes(payload));
    const second = await sha256Hex(subtle, canonicalBytes(payload));
    const third = await sha256Hex(subtle, canonicalBytes(shuffled));
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('produces bytes that are the utf-8 encoding of the text', () => {
    const value = { note: `${E_ACUTE_NFC} \u{1F441}` };
    expect(utf8Decode(canonicalBytes(value))).toBe(canonicalize(value));
  });
});

describe('key ordering', () => {
  it('sorts by utf-8 bytes, not by utf-16 code units', () => {
    // U+FFFD is one code unit (0xFFFD); U+10000 is the surrogate pair
    // 0xD800 0xDC00. A naive JS sort puts the astral key FIRST because
    // 0xD800 < 0xFFFD. Code-point (and therefore utf-8) order puts it LAST.
    const naive = ['�', '\u{10000}'].sort();
    expect(naive[0]).toBe('\u{10000}');
    expect(canonicalize({ '\u{10000}': 1, '�': 2 })).toBe('{"�":2,"\u{10000}":1}');
  });

  it('orders ascii, latin-1 and astral keys by code point', () => {
    expect(canonicalize({ '\u{1F600}': 3, 'é': 2, z: 1 })).toBe(
      '{"z":1,"é":2,"\u{1F600}":3}',
    );
  });
});

describe('numbers', () => {
  it.each([
    [0, '0'],
    [-0, '0'],
    [1, '1'],
    [1.0, '1'],
    [1e0, '1'],
    [-7, '-7'],
    [Number.MAX_SAFE_INTEGER, '9007199254740991'],
    [0.5, '0.500000000'],
    [39.0997, '39.099700000'],
    [-84.5786, '-84.578600000'],
    // Exact tie at the 10th decimal: 1/1024 is 0.0009765625 exactly. Half away
    // from zero rounds UP. A server rounding half-to-even would emit ...562,
    // which is why the rule is written down in canonicalize.ts.
    [1 / 1024, '0.000976563'],
  ])('writes %o as %o', (input, expected) => {
    expect(canonicalize(input)).toBe(expected);
  });

  it('rejects NaN and both infinities', () => {
    expect(codeOf(() => canonicalize(Number.NaN))).toBe('not-finite');
    expect(codeOf(() => canonicalize(Number.POSITIVE_INFINITY))).toBe('not-finite');
    expect(codeOf(() => canonicalize(Number.NEGATIVE_INFINITY))).toBe('not-finite');
  });

  it('rejects integers past the safe range', () => {
    expect(codeOf(() => canonicalize(2 ** 53))).toBe('integer-out-of-range');
    expect(codeOf(() => canonicalize(-(2 ** 53)))).toBe('integer-out-of-range');
  });

  it('rejects a non-integer too large for a fixed nine-digit fraction', () => {
    expect(codeOf(() => canonicalize(1e15 + 0.5))).toBe('non-integer-out-of-range');
  });
});

describe('strings', () => {
  it('escapes only what JSON requires', () => {
    expect(canonicalize('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(canonicalize('\b\t\n\f\r')).toBe('"\\b\\t\\n\\f\\r"');
    expect(canonicalize(CONTROL_PAIR)).toBe('"\\u0000\\u001f"');
  });

  it('leaves U+007F, U+2028, U+2029 and all non-ascii literal', () => {
    const value = `${E_ACUTE_NFC} \u{1F441}${UNESCAPED_ODDBALLS}`;
    expect(canonicalize(value)).toBe(`"${value}"`);
  });

  it('normalises to NFC before hashing', () => {
    expect(E_ACUTE_NFC).not.toBe(E_ACUTE_NFD);
    expect(canonicalize(E_ACUTE_NFD)).toBe(canonicalize(E_ACUTE_NFC));
    expect(canonicalize({ a: E_ACUTE_NFD })).toBe(`{"a":"${E_ACUTE_NFC}"}`);
    expect(canonicalize({ [E_ACUTE_NFD]: 1 })).toBe(`{"${E_ACUTE_NFC}":1}`);
  });

  it('rejects a lone surrogate', () => {
    expect(codeOf(() => canonicalize('\uD800'))).toBe('lone-surrogate');
    expect(codeOf(() => canonicalize({ '\uDC00': 1 }))).toBe('lone-surrogate');
  });

  it('rejects two keys that normalise to the same NFC form', () => {
    expect(codeOf(() => canonicalize({ [E_ACUTE_NFC]: 1, [E_ACUTE_NFD]: 2 }))).toBe(
      'duplicate-normalised-key',
    );
  });
});

describe('containers', () => {
  it('writes empty containers', () => {
    expect(canonicalize({})).toBe('{}');
    expect(canonicalize([])).toBe('[]');
  });

  it('preserves array order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('drops undefined-valued properties but rejects undefined in an array', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalize({ a: 1 })).toBe(canonicalize({ a: 1, b: undefined }));
    expect(codeOf(() => canonicalize([1, undefined, 3] as unknown as CanonicalValue))).toBe(
      'undefined-in-array',
    );
  });

  it('rejects a cycle instead of hanging', () => {
    const looped: Record<string, unknown> = { name: 'drop' };
    looped['self'] = looped;
    expect(codeOf(() => canonicalize(looped as CanonicalValue))).toBe('cycle');
  });

  it('accepts a sibling repeated in two places, which is not a cycle', () => {
    const shared = { mount: 'pole' };
    expect(canonicalize({ a: shared, b: shared })).toBe(
      '{"a":{"mount":"pole"},"b":{"mount":"pole"}}',
    );
  });

  it('rejects nesting past the depth limit', () => {
    let deep: CanonicalValue = 1;
    for (let i = 0; i <= MAX_DEPTH + 1; i++) deep = { deep };
    expect(codeOf(() => canonicalize(deep))).toBe('too-deep');
  });
});

describe('rejected types', () => {
  it.each([
    ['Date', new Date(0)],
    ['Map', new Map()],
    ['Set', new Set()],
    ['RegExp', /x/],
    ['Uint8Array', new Uint8Array(1)],
    ['class instance', new (class Camera { id = 'cam-1'; })()],
    ['boxed number', Object(1)],
    ['undefined', undefined],
    ['function', () => 1],
  ])('rejects %s', (_label, value) => {
    expect(codeOf(() => canonicalize(value as unknown as CanonicalValue))).toBe('unsupported-type');
  });

  it('rejects symbol-keyed properties', () => {
    const withSymbol = { a: 1, [Symbol('s')]: 2 };
    expect(codeOf(() => canonicalize(withSymbol as unknown as CanonicalValue))).toBe('symbol-key');
  });

  it('never calls a toJSON hook: the object is rejected as a class instance', () => {
    class Sneaky {
      toJSON(): string {
        return 'not what was signed';
      }
    }
    expect(codeOf(() => canonicalize(new Sneaky() as unknown as CanonicalValue))).toBe(
      'unsupported-type',
    );
  });
});

describe('isPlainObject', () => {
  it('accepts object literals and null-prototype objects only', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null) as object)).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
  });
});

describe('error reporting', () => {
  it('names the path of the offending value', () => {
    try {
      canonicalize({ position: { lat: Number.NaN } });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalizationError);
      expect((error as CanonicalizationError).path).toBe('$.position.lat');
    }
  });

  it('names the index of an offending array item', () => {
    try {
      canonicalize({ photos: [1, new Date(0) as unknown as CanonicalValue] });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as CanonicalizationError).path).toBe('$.photos[1]');
    }
  });
});
