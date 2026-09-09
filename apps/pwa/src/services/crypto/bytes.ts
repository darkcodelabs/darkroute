/**
 * Byte primitives shared by the evidence chain and the plate vault.
 *
 * Everything here is deterministic and dependency-free. No design values live
 * in this file; the alphabets below are wire formats, not visual choices.
 */

const HEX_DIGITS = '0123456789abcdef';

const HEX_BY_BYTE: readonly string[] = Array.from({ length: 256 }, (_unused, i) => {
  const hi = HEX_DIGITS[(i >> 4) & 0x0f] ?? '0';
  const lo = HEX_DIGITS[i & 0x0f] ?? '0';
  return `${hi}${lo}`;
});

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const BASE64URL_LOOKUP: ReadonlyMap<string, number> = new Map(
  Array.from(BASE64URL_ALPHABET, (ch, i) => [ch, i] as const),
);

const HEX_RE = /^[0-9a-f]*$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

/** Thrown when a wire-format string cannot be decoded. */
export class ByteFormatError extends Error {
  override readonly name = 'ByteFormatError';
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

/** UTF-8 encode. The canonical form of every string this module hashes. */
export function utf8(value: string): Uint8Array {
  return textEncoder.encode(value);
}

/** UTF-8 decode, strict: invalid sequences throw rather than yielding U+FFFD. */
export function utf8Decode(bytes: Uint8Array): string {
  try {
    return textDecoder.decode(bytes);
  } catch (cause) {
    throw new ByteFormatError(`not valid utf-8: ${String(cause)}`);
  }
}

/** Lowercase hex. The only hash representation this codebase stores. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += HEX_BY_BYTE[byte] ?? '00';
  return out;
}

/** Decode lowercase hex. Uppercase is rejected: storage is normalised. */
export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new ByteFormatError('hex string has odd length');
  if (!HEX_RE.test(hex)) throw new ByteFormatError('hex string has non lowercase-hex characters');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** A 32-byte hash in lowercase hex is 64 characters. Used everywhere. */
export function isHash256Hex(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && HEX_RE.test(value);
}

/** base64url, unpadded (RFC 4648 §5). Used for signatures and ciphertext. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    out +=
      (BASE64URL_ALPHABET[(triple >> 18) & 0x3f] ?? '') +
      (BASE64URL_ALPHABET[(triple >> 12) & 0x3f] ?? '') +
      (BASE64URL_ALPHABET[(triple >> 6) & 0x3f] ?? '') +
      (BASE64URL_ALPHABET[triple & 0x3f] ?? '');
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const a = bytes[i] ?? 0;
    out +=
      (BASE64URL_ALPHABET[(a >> 2) & 0x3f] ?? '') + (BASE64URL_ALPHABET[(a << 4) & 0x3f] ?? '');
  } else if (remaining === 2) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    out +=
      (BASE64URL_ALPHABET[(a >> 2) & 0x3f] ?? '') +
      (BASE64URL_ALPHABET[((a << 4) | (b >> 4)) & 0x3f] ?? '') +
      (BASE64URL_ALPHABET[(b << 2) & 0x3f] ?? '');
  }
  return out;
}

/** Decode unpadded base64url. Padding characters are rejected, not tolerated. */
export function fromBase64Url(value: string): Uint8Array {
  if (!BASE64URL_RE.test(value)) {
    throw new ByteFormatError('base64url string has characters outside the unpadded alphabet');
  }
  if (value.length % 4 === 1) throw new ByteFormatError('base64url string has an impossible length');
  const full = Math.floor(value.length / 4);
  const remaining = value.length % 4;
  const outLength = full * 3 + (remaining === 2 ? 1 : remaining === 3 ? 2 : 0);
  const out = new Uint8Array(outLength);
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (const ch of value) {
    const v = BASE64URL_LOOKUP.get(ch);
    if (v === undefined) throw new ByteFormatError('base64url string has an unknown character');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/** Concatenate in argument order. Callers rely on this being byte-exact. */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Length-independent equality for two hex strings of the SAME expected length.
 * Used for blind-index comparison, where a timing oracle would leak which
 * prefix of a watched plate an attacker guessed correctly.
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a.codePointAt(i) ?? 0) ^ (b.codePointAt(i) ?? 0);
  }
  return diff === 0;
}

/** SHA-256, returned as lowercase hex. */
export async function sha256Hex(subtle: SubtleCrypto, data: Uint8Array): Promise<string> {
  const digest = await subtle.digest('SHA-256', data as BufferSource);
  return toHex(new Uint8Array(digest));
}

/** SHA-256, returned as raw bytes. */
export async function sha256Bytes(subtle: SubtleCrypto, data: Uint8Array): Promise<Uint8Array> {
  const digest = await subtle.digest('SHA-256', data as BufferSource);
  return new Uint8Array(digest);
}
