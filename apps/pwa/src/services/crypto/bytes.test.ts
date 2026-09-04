import { describe, expect, it } from 'vitest';
import {
  ByteFormatError,
  concatBytes,
  constantTimeEqualHex,
  fromBase64Url,
  fromHex,
  isHash256Hex,
  sha256Hex,
  toBase64Url,
  toHex,
  utf8,
  utf8Decode,
} from './bytes';

const subtle = globalThis.crypto.subtle;

describe('hex', () => {
  it('round-trips every byte value', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect(fromHex(toHex(all))).toEqual(all);
  });

  it('emits lowercase and rejects uppercase input', () => {
    expect(toHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe('deadbeef');
    expect(() => fromHex('DEADBEEF')).toThrow(ByteFormatError);
  });

  it('rejects an odd-length string', () => {
    expect(() => fromHex('abc')).toThrow(ByteFormatError);
  });

  it('recognises a 256-bit hash only at exactly 64 lowercase hex characters', () => {
    expect(isHash256Hex('a'.repeat(64))).toBe(true);
    expect(isHash256Hex('A'.repeat(64))).toBe(false);
    expect(isHash256Hex('a'.repeat(63))).toBe(false);
    expect(isHash256Hex(64)).toBe(false);
  });
});

describe('base64url', () => {
  // RFC 4648 test vectors, unpadded and url-safe.
  it.each([
    ['', ''],
    ['f', 'Zg'],
    ['fo', 'Zm8'],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg'],
    ['fooba', 'Zm9vYmE'],
    ['foobar', 'Zm9vYmFy'],
  ])('encodes %o as %o', (input, expected) => {
    expect(toBase64Url(utf8(input))).toBe(expected);
    expect(utf8Decode(fromBase64Url(expected))).toBe(input);
  });

  it('uses the url-safe alphabet, never + or /', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbe]);
    const encoded = toBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(fromBase64Url(encoded)).toEqual(bytes);
  });

  it('round-trips random buffers of every remainder length', () => {
    for (let length = 0; length < 40; length++) {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length));
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
  });

  it('rejects padding and out-of-alphabet characters', () => {
    expect(() => fromBase64Url('Zm9vYg==')).toThrow(ByteFormatError);
    expect(() => fromBase64Url('Zm9v*g')).toThrow(ByteFormatError);
    expect(() => fromBase64Url('Z')).toThrow(ByteFormatError);
  });
});

describe('utf8', () => {
  it('round-trips astral and combining characters', () => {
    const value = 'flock \u{1F441} café क्ष';
    expect(utf8Decode(utf8(value))).toBe(value);
  });

  it('rejects invalid utf-8 rather than substituting U+FFFD', () => {
    expect(() => utf8Decode(new Uint8Array([0xc3, 0x28]))).toThrow(ByteFormatError);
  });
});

describe('concatBytes', () => {
  it('joins in argument order', () => {
    expect(concatBytes(new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3]))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });
});

describe('constantTimeEqualHex', () => {
  it('is true only for identical strings of identical length', () => {
    expect(constantTimeEqualHex('abcd', 'abcd')).toBe(true);
    expect(constantTimeEqualHex('abcd', 'abce')).toBe(false);
    expect(constantTimeEqualHex('abcd', 'abc')).toBe(false);
  });
});

describe('sha256Hex', () => {
  it('matches the published digest of the empty string', async () => {
    await expect(sha256Hex(subtle, utf8(''))).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the published digest of "abc"', async () => {
    await expect(sha256Hex(subtle, utf8('abc'))).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
