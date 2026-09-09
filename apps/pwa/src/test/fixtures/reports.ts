/**
 * ===========================================================================
 * FIXTURE DATA - NOT REAL EVIDENCE. THE SIGNATURES ARE NOT SIGNATURES.
 * ===========================================================================
 *
 * A DEAD DROP queue with the right SHAPE and none of the cryptography.
 *
 * Every `signature`, `chainHash`, `payloadHash` and `publicKeySpki` below is a
 * marked literal. Nothing was hashed. Nothing was signed. No key exists. These
 * records EXIST TO FILL A LIST, and they will be rejected by
 * `verifyChain()` - `payload-hash-mismatch` on the first record - which is the
 * correct behaviour and must never be "fixed" by relaxing verification.
 *
 * Three markers make that impossible to miss, and impossible to miss
 * programmatically:
 *
 *   hashes      begin with {@link FIXTURE_HASH_MARKER} - 24 hex characters that
 *               real SHA-256 output would land on with probability 2^-96.
 *   signatures  begin with the ASCII text FIXTURENOTAREALSIGNATURE.
 *   public keys begin with the ASCII text FIXTUREPUBLICKEYNOTREAL.
 *
 * {@link isFixtureEvidence} tests for them. Any code path that could put a
 * record on the wire should call it and refuse.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE CONTENTS COME FROM
 *
 * `Flockys Screens II.dc.html` B2 · DEAD DROP renders exactly this queue:
 *
 *   DROP 02 · Vine St     13:58 · photo · signed      HELD
 *   DROP 01 · I-71 ramp   13:12 · no photo · signed   HELD
 *   DROP 00 · Reading Rd  yesterday · accepted        SYNCED
 *
 * and, for the open drop, "sha256 8f04·822f·b975·e932·0ddb·14d4" above
 * "prev ea6c·81fb·9735·c591·9b44·3f8b". Those twenty-four hex characters are
 * carried through into the fixture hashes below so the fixture and the screen
 * are visibly the same queue. Two records HELD and one SYNCED is also what
 * makes the REPORT bar read "2 QUEUED" on every other screen.
 *
 * The design shows local clock times; `capturedAt` is UTC with milliseconds,
 * because that is the only format the chain will hash (`CAPTURED_AT_RE`).
 *
 * ---------------------------------------------------------------------------
 * PRIVACY
 *
 * A report payload carries the CAMERA's coordinate. That is the one coordinate
 * this product stores, and it is stored because "a camera report without a
 * position is not a report" (`db/schema.ts`). It carries the reporter's heading
 * and speed, which describe the vehicle rather than the place - the same line
 * `redact()` draws. It carries no licence plate, no watchlist entry, and no
 * position of the person who filed it.
 */

import {
  EVIDENCE_SCHEMA,
  GENESIS_CHAIN_HASH,
  GPS_ACCURACY_FIELD,
  type EvidenceRecord,
} from '../../services/crypto/chain.ts';
import type { CanonicalObject } from '../../services/crypto/canonicalize.ts';
import type { ReportChainRecord, SignedReportRecord } from '../../services/db/schema.ts';

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

/**
 * The first 24 hex characters of every fixture hash.
 *
 * Length matters: 24 hex characters is 96 bits, so the odds of a genuine
 * SHA-256 digest starting this way are about one in 8×10^28. A prefix short
 * enough to collide would be a marker that occasionally lies.
 */
export const FIXTURE_HASH_MARKER = 'facadefacadefacadefacade';

/** The first characters of every fixture signature. Valid base64url, unmistakable text. */
export const FIXTURE_SIGNATURE_MARKER = 'FIXTURENOTAREALSIGNATURE';

/** The first characters of every fixture public key. */
export const FIXTURE_PUBLIC_KEY_MARKER = 'FIXTUREPUBLICKEYNOTREAL';

/** Hex length of a SHA-256 digest. */
const HASH_HEX_LENGTH = 64;

/**
 * base64url length of a raw r||s ECDSA P-256 signature: 64 bytes, unpadded.
 * Kept structurally right so a length check somewhere downstream does not
 * reject a fixture for the wrong reason and hide the real problem.
 */
const SIGNATURE_B64URL_LENGTH = 86;

const HEX_RE = /^[0-9a-f]*$/;
const BASE64URL_FILL = 'x';

/**
 * Compose a marked, structurally valid, obviously fake digest.
 *
 * @throws RangeError if `tag` is not lowercase hex or does not fit.
 */
export function fixtureHash(tag: string): string {
  if (!HEX_RE.test(tag)) {
    throw new RangeError(`fixtureHash: tag must be lowercase hex, received ${tag}`);
  }
  const room = HASH_HEX_LENGTH - FIXTURE_HASH_MARKER.length;
  if (tag.length > room) {
    throw new RangeError(`fixtureHash: tag longer than ${String(room)} characters: ${tag}`);
  }
  return `${FIXTURE_HASH_MARKER}${tag.padEnd(room, '0')}`;
}

function fixtureSignature(tag: string): string {
  return `${FIXTURE_SIGNATURE_MARKER}${tag}`.padEnd(SIGNATURE_B64URL_LENGTH, BASE64URL_FILL);
}

/** Opaque device-key id. Names no key, because there is no key. */
export const FIXTURE_PUBLIC_KEY_ID = 'fixture-device-key-00';

/** SPKI slot, marked. Not a key. Will not verify anything. */
export const FIXTURE_PUBLIC_KEY_SPKI = `${FIXTURE_PUBLIC_KEY_MARKER}SPKI`.padEnd(120, BASE64URL_FILL);

/**
 * Is this record fixture data?
 *
 * A cheap, total guard. Call it before anything leaves the device. It answers
 * on structure alone - no crypto, no async, safe anywhere.
 */
export function isFixtureEvidence(record: {
  readonly payloadHash?: string;
  readonly chainHash?: string;
  readonly signature?: string;
  readonly publicKeySpki?: string;
}): boolean {
  return (
    (record.payloadHash?.startsWith(FIXTURE_HASH_MARKER) ?? false) ||
    (record.chainHash?.startsWith(FIXTURE_HASH_MARKER) ?? false) ||
    (record.signature?.startsWith(FIXTURE_SIGNATURE_MARKER) ?? false) ||
    (record.publicKeySpki?.startsWith(FIXTURE_PUBLIC_KEY_MARKER) ?? false)
  );
}

// ---------------------------------------------------------------------------
// The three drops
// ---------------------------------------------------------------------------

/**
 * Report ids.
 *
 * UUID-shaped so `REPORT_ID_RE` accepts them, and prefixed `f1c7` - "fict" in
 * hex-speak - so a grep for a report id in a log finds the fixture rather than
 * leaving somebody hunting for a submission that never happened.
 */
export const FIXTURE_REPORT_IDS = {
  drop00: 'f1c70000-0000-4000-8000-000000000000',
  drop01: 'f1c70000-0000-4000-8000-000000000001',
  drop02: 'f1c70000-0000-4000-8000-000000000002',
} as const;

/** Chain hashes, in order. Each drop's `previousChainHash` is the one before. */
const CHAIN_HASHES = {
  // "prev ea6c·81fb·9735·c591·9b44·3f8b" is what the screen shows above the
  // open drop, so it is drop 01's chain hash.
  drop00: fixtureHash('d00d00d00d00d00d00d00d00'),
  drop01: fixtureHash('ea6c81fb9735c5919b443f8b'),
  // "sha256 8f04·822f·b975·e932·0ddb·14d4" - the open drop's own hash.
  drop02: fixtureHash('8f04822fb975e9320ddb14d4'),
} as const;

const PAYLOAD_HASHES = {
  drop00: fixtureHash('0a'),
  drop01: fixtureHash('0b'),
  drop02: fixtureHash('0c'),
} as const;

/**
 * Capture times, UTC with milliseconds.
 *
 * Strictly increasing, because the chain rejects an out-of-order timestamp.
 * DROP 00 is the design's "yesterday"; the other two are the 13:12 and 13:58
 * the DEAD DROP list renders.
 */
export const FIXTURE_CAPTURED_AT = {
  drop00: '2026-08-18T17:41:09.000Z',
  drop01: '2026-08-19T17:12:04.000Z',
  drop02: '2026-08-19T17:58:31.000Z',
} as const;

function payloadFor(fields: {
  readonly kind: 'new_camera' | 'confirm_existing';
  readonly cameraId: string | null;
  readonly lat: number;
  readonly lon: number;
  readonly facingDeg: number | null;
  readonly ownerType: string;
  readonly mount: string;
  readonly photoCount: number;
  readonly accuracyM: number;
  readonly reporterHeadingDeg: number;
  readonly reporterSpeedMph: number;
  readonly placeLabel: string;
}): CanonicalObject {
  return {
    kind: fields.kind,
    camera_id: fields.cameraId,
    camera_lat: fields.lat,
    camera_lon: fields.lon,
    facing_deg: fields.facingDeg,
    owner_type: fields.ownerType,
    mount: fields.mount,
    photo_count: fields.photoCount,
    // The field name the chain projects `gpsAccuracyM` from. Must be present.
    [GPS_ACCURACY_FIELD]: fields.accuracyM,
    reporter_heading_deg: fields.reporterHeadingDeg,
    reporter_speed_mph: fields.reporterSpeedMph,
    place_label: fields.placeLabel,
  };
}

/**
 * DROP 00 · Reading Rd - yesterday · accepted · SYNCED.
 * The genesis record: its `previousChainHash` is the real, public
 * `GENESIS_CHAIN_HASH` constant, which is not a secret and not a signature.
 */
const DROP_00: EvidenceRecord = {
  schema: EVIDENCE_SCHEMA,
  reportId: FIXTURE_REPORT_IDS.drop00,
  capturedAt: FIXTURE_CAPTURED_AT.drop00,
  payload: payloadFor({
    kind: 'confirm_existing',
    cameraId: 'FWM-0207',
    lat: 39.139_85,
    lon: -84.500_47,
    facingDeg: null,
    ownerType: 'unknown',
    mount: 'utility_pole',
    photoCount: 0,
    accuracyM: 6,
    reporterHeadingDeg: 41,
    reporterSpeedMph: 38,
    placeLabel: 'Reading Rd',
  }),
  payloadHash: PAYLOAD_HASHES.drop00,
  previousChainHash: GENESIS_CHAIN_HASH,
  chainHash: CHAIN_HASHES.drop00,
  signature: fixtureSignature('D00'),
  publicKeyId: FIXTURE_PUBLIC_KEY_ID,
  publicKeySpki: FIXTURE_PUBLIC_KEY_SPKI,
  gpsAccuracyM: 6,
  syncState: 'synced',
  supersedes: null,
};

/** DROP 01 · I-71 ramp - 13:12 · no photo · signed · HELD. */
const DROP_01: EvidenceRecord = {
  schema: EVIDENCE_SCHEMA,
  reportId: FIXTURE_REPORT_IDS.drop01,
  capturedAt: FIXTURE_CAPTURED_AT.drop01,
  payload: payloadFor({
    kind: 'confirm_existing',
    cameraId: 'FWM-0118',
    lat: 39.124_05,
    lon: -84.497_02,
    facingDeg: 205,
    ownerType: 'pd',
    mount: 'gantry',
    photoCount: 0,
    accuracyM: 9,
    reporterHeadingDeg: 12,
    reporterSpeedMph: 62,
    placeLabel: 'I-71 ramp',
  }),
  payloadHash: PAYLOAD_HASHES.drop01,
  previousChainHash: CHAIN_HASHES.drop00,
  chainHash: CHAIN_HASHES.drop01,
  signature: fixtureSignature('D01'),
  publicKeyId: FIXTURE_PUBLIC_KEY_ID,
  publicKeySpki: FIXTURE_PUBLIC_KEY_SPKI,
  gpsAccuracyM: 9,
  syncState: 'held',
  supersedes: null,
};

/**
 * DROP 02 · Vine St - 13:58 · photo · signed · HELD.
 * The open drop, with the design's "223° · 47 MPH" and "PHOTO 1 · 2.1 MB".
 */
const DROP_02: EvidenceRecord = {
  schema: EVIDENCE_SCHEMA,
  reportId: FIXTURE_REPORT_IDS.drop02,
  capturedAt: FIXTURE_CAPTURED_AT.drop02,
  payload: payloadFor({
    kind: 'new_camera',
    cameraId: null,
    lat: 39.102_41,
    lon: -84.513_77,
    facingDeg: 223,
    ownerType: 'private',
    mount: 'solar_pole',
    photoCount: 1,
    // "±4 M · 9 SATS" on the REPORT sheet.
    accuracyM: 4,
    reporterHeadingDeg: 223,
    reporterSpeedMph: 47,
    placeLabel: 'Vine St',
  }),
  payloadHash: PAYLOAD_HASHES.drop02,
  previousChainHash: CHAIN_HASHES.drop01,
  chainHash: CHAIN_HASHES.drop02,
  signature: fixtureSignature('D02'),
  publicKeyId: FIXTURE_PUBLIC_KEY_ID,
  publicKeySpki: FIXTURE_PUBLIC_KEY_SPKI,
  gpsAccuracyM: 4,
  syncState: 'held',
  supersedes: null,
};

/**
 * The queue, oldest first - chain order, which is also `by-capturedAt` order.
 *
 * DEAD DROP renders it newest first ("DROP 02 · DROP 01 · DROP 00"); that is a
 * presentation decision and belongs in the screen, not in the data.
 */
export const FIXTURE_SIGNED_REPORTS: readonly SignedReportRecord[] = [DROP_00, DROP_01, DROP_02];

/** The two the REPORT bar counts as "2 QUEUED". */
export const FIXTURE_QUEUED_REPORT_IDS: readonly string[] = [
  FIXTURE_REPORT_IDS.drop01,
  FIXTURE_REPORT_IDS.drop02,
];

// ---------------------------------------------------------------------------
// Chain rows
// ---------------------------------------------------------------------------

/**
 * `reportChain` rows matching {@link FIXTURE_SIGNED_REPORTS}.
 *
 * `attempts` is 0 and `nextAttemptAt` is null on both held rows: the design's
 * copy is "held until you're on WiFi", which is a queue that has not tried and
 * failed - it is a queue that has not tried. A fixture that pre-loads retry
 * state would make the backoff tests pass against a state no fresh install
 * ever reaches. `dead_letter` and `rejected` are deliberately not represented;
 * a test that wants them should drive a row there through the repository,
 * which is the only path production has.
 */
export const FIXTURE_REPORT_CHAIN: readonly ReportChainRecord[] = [
  {
    reportId: FIXTURE_REPORT_IDS.drop00,
    payloadHash: PAYLOAD_HASHES.drop00,
    previousChainHash: GENESIS_CHAIN_HASH,
    chainHash: CHAIN_HASHES.drop00,
    signature: fixtureSignature('D00'),
    publicKeyId: FIXTURE_PUBLIC_KEY_ID,
    capturedAt: FIXTURE_CAPTURED_AT.drop00,
    syncState: 'synced',
    attempts: 1,
    nextAttemptAt: null,
    publishableAt: null,
    lastError: null,
    deadLetterReason: null,
    syncedAt: Date.parse(FIXTURE_CAPTURED_AT.drop00) + 3_600_000,
  },
  {
    reportId: FIXTURE_REPORT_IDS.drop01,
    payloadHash: PAYLOAD_HASHES.drop01,
    previousChainHash: CHAIN_HASHES.drop00,
    chainHash: CHAIN_HASHES.drop01,
    signature: fixtureSignature('D01'),
    publicKeyId: FIXTURE_PUBLIC_KEY_ID,
    capturedAt: FIXTURE_CAPTURED_AT.drop01,
    syncState: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    publishableAt: null,
    lastError: null,
    deadLetterReason: null,
    syncedAt: null,
  },
  {
    reportId: FIXTURE_REPORT_IDS.drop02,
    payloadHash: PAYLOAD_HASHES.drop02,
    previousChainHash: CHAIN_HASHES.drop01,
    chainHash: CHAIN_HASHES.drop02,
    signature: fixtureSignature('D02'),
    publicKeyId: FIXTURE_PUBLIC_KEY_ID,
    capturedAt: FIXTURE_CAPTURED_AT.drop02,
    syncState: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    publishableAt: null,
    lastError: null,
    deadLetterReason: null,
    syncedAt: null,
  },
];

/** Head of the fixture chain - what a new record would link back to. */
export const FIXTURE_CHAIN_HEAD_HASH = CHAIN_HASHES.drop02;
