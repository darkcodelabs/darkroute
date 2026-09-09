/**
 * THE ONE NUMBER A PHOTOGRAPH PUTS INTO THE SIGNED RECORD.
 *
 * =============================================================================
 * WHY A DIGEST AND NOT THE BYTES
 * =============================================================================
 * `pendingReports` holds a signed `EvidenceRecord` whose immutability check
 * diffs twelve fields by `JSON.stringify`. Half a megabyte of JPEG in there
 * would be neither a meaningful nor an affordable comparison, and the record is
 * frozen at signing time, so bytes could never be added afterwards anyway.
 *
 * So the payload carries the SHA-256 of the prepared bytes and the bytes live
 * in `reportPhotos`, keyed on the same `reportId`. The signature covers the
 * digest, which is what lets `clearLocalData()` delete a photograph without
 * breaking the chain: the retained report keeps saying, truthfully, "there was
 * a photo and this was its digest".
 *
 * =============================================================================
 * ONE DIGEST IMPLEMENTATION IN THIS CODEBASE
 * =============================================================================
 * This delegates to `sha256Hex()` in `services/crypto/bytes.ts`, the same
 * function the evidence chain and the plate vault hash with. A second
 * hand-rolled digest here could drift in its hex casing or its buffer handling
 * and the divergence would only ever show up as a report whose stored bytes did
 * not match its own signed payload.
 *
 * `keys.ts` has a `resolveSubtle()` that would do the lookup below, and does
 * not export it. Rather than widen that module's surface for one caller, this
 * file resolves the ambient `crypto.subtle` itself and REJECTS when there is
 * none - a rejection rather than a throw, because every caller is already in a
 * promise chain and a synchronous throw from an async helper is a second
 * failure shape for the same fact.
 */

import { sha256Hex } from '../../services/crypto/bytes.ts';

/** Thrown when the runtime has no WebCrypto to hash with. */
export class PhotoDigestUnavailableError extends Error {
  override readonly name = 'PhotoDigestUnavailableError';

  constructor() {
    super('this device cannot hash a photo');
  }
}

/**
 * The lowercase-hex SHA-256 of the prepared JPEG, exactly as it will be stored.
 *
 * Hash the bytes that go on disk, never the pre-encode file: the payload's
 * `photo` field names what `reportPhotos` holds, and `preparePhoto()` produces
 * a different file from the one the camera handed over.
 */
export async function photoSha256(bytes: Uint8Array, subtle?: SubtleCrypto): Promise<string> {
  const resolved = subtle ?? globalThis.crypto?.subtle;
  if (resolved === undefined) throw new PhotoDigestUnavailableError();
  return sha256Hex(resolved, bytes);
}
