/**
 * ===========================================================================
 * FIXTURE DATA - NOT REAL SURVEILLANCE DATA
 * ===========================================================================
 *
 * Every record in this file is INVENTED. No camera described here has been
 * observed, reported, surveyed or confirmed by anyone. The identifiers, owner
 * types, confirmation counts, sharing flags and EFF Atlas references are
 * fabricated to exercise code paths, and the coordinates are synthetic points
 * chosen for their geometry, not for what is at them.
 *
 * Do not publish this file as a camera list. Do not seed a production database
 * from it. Do not screenshot it as evidence of anything. Anything written to
 * local storage from here is tagged `source: 'fixture'` at the tile layer
 * (`db/schema.ts` → `TileSource`) precisely so a fixture camera can never be
 * mistaken for a camera somebody actually reported.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE PLACES
 *
 * The design copy is set in Hamilton County, Ohio and names five locations:
 *
 *   "Reading & Tennessee   FWM-0442 · HOA · SHARED"      App Screens 03 · LOOKUP
 *   "I-71 N Exit 3         FWM-0118 · PD · SHARED"       App Screens 03 · LOOKUP
 *   "Vine St & 7th         FWM-0873 · PRIVATE"           App Screens 03 · LOOKUP
 *   "Colerain & Galbraith  FWM-1180 · PD-OWNED · SHARED" Screens II B5 · WATCHLIST
 *   "Reading Rd            5 CAMS / 1.2 MI"              App Screens 05 · LOG
 *
 * The ids and owner types above are the design's own. The latitudes and
 * longitudes are not: the design gives exactly one coordinate, the REPORT
 * sheet's "39.0997 N · 84.5786 W · ±4 M · 9 SATS · Reading Rd" (App Screens
 * 06), and one coordinate cannot lay out nine cameras. The rest are placed by
 * hand in the right county at the right sort of spacing.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SET IS BUILT TO EXERCISE
 *
 *   unknown facing    FWM-0873, FWM-0207, FWM-9042 carry `directionDeg: null`.
 *                     `null` is not "not facing you" - an unknown-facing camera
 *                     reads every plate it can see, so it stays in every list,
 *                     every count and every alert.
 *   disputed          FWM-0561: 2 confirmations against 9 disputes.
 *   inactive          FWM-0207: reported, then reported gone. Still a record.
 *   dedupe            FWM-9042 sits 18 ft from FWM-0442 - the same pole,
 *                     reported twice. Inside `DEFAULT_DEDUPE_EPSILON_FT` (50),
 *                     so `dedupeCameras` folds them into one, and the survivor
 *                     is the lexicographically smaller id, FWM-0442.
 *   multiple          FWM-0771 and FWM-0772 sit 60 ft apart - OUTSIDE the 50 ft
 *                     dedupe epsilon, so they survive as two records and can
 *                     both be inside the threshold at once, which is what
 *                     drives the `multiple` state ("2+ in range · 2-pulse
 *                     haptic", Design System § alert states).
 *
 * The 18 ft and 60 ft separations straddle the dedupe epsilon on purpose, and
 * `fixtures.test.ts` asserts both distances against `@fwm/core`'s own
 * `distanceFt`, so a change to the epsilon or to the geodesy breaks a test
 * rather than quietly turning two cameras into one.
 *
 * ---------------------------------------------------------------------------
 * PRIVACY
 *
 * There is no licence plate in this file and there is no vehicle position in
 * this file. A camera's own coordinate is not a person's coordinate; the
 * driver's position never appears in a fixture, a log line or a record.
 */

import type { CameraLike } from '../../services/simulator/fwmCore.ts';
import type { CameraOwnerType, CameraRecord } from '../../services/db/schema.ts';

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/**
 * Owner classes as the fixture models them.
 *
 * Four values, from the design's own labels: "PD · SHARED", "HOA · SHARED",
 * "PRIVATE", and the unattributed case the TRIAGE screen calls "UNVERIFIED
 * REPORTS · 1 confirmation only" (Screens II B4).
 *
 * NOTE - this is deliberately NOT `CameraOwnerType` from `db/schema.ts`, which
 * has five values (`police` · `inter_agency` · `hoa` · `private` ·
 * `unverified`). The storage layer models TRIAGE's filter rows, and one of
 * those rows - "INTER-AGENCY SHARED · any owner, shared feed" - is a SHARING
 * property, not an owner. Here it lives where it belongs, on
 * {@link CameraSharingFlags.interAgency}. {@link toCameraRecord} maps between
 * the two and never invents an `inter_agency` owner.
 */
export type FixtureOwnerType = 'pd' | 'hoa' | 'private' | 'unknown';

/** Where a record came from, before anyone confirmed or disputed it. */
export type FixtureCameraSource =
  /** The project's own crowdsourced dataset - "DARKROUTE DATASET" (Screens II A6). */
  | 'darkroute'
  /** EFF's Atlas of Surveillance - "EFF ATLAS · CROSS-REFERENCED" (Screens II A4). */
  | 'eff-atlas'
  /** A single user's REPORT sheet submission (App Screens 06). */
  | 'user-report'
  /** A municipal contract or public-records release. */
  | 'public-records';

/**
 * How far a record travels once a camera reads a plate.
 *
 * Sourced from the INTEL CARD: "INTER-AGENCY SHARING · YES · 412 AGENCIES"
 * (Screens II A4) and the LOOKUP rows' "· SHARED" suffix (App Screens 03).
 */
export interface CameraSharingFlags {
  /** The feed is shared beyond the owning agency. */
  readonly interAgency: boolean;
  /** How many agencies, when the source says. `null` when it does not. */
  readonly agencyCount: number | null;
  /** The record is published in the open contribution dataset. */
  readonly publicDataset: boolean;
}

/**
 * One fixture camera.
 *
 * Named `FixtureCameraRecord`, not `CameraRecord`, because `db/schema.ts`
 * already owns that name for the narrower shape it caches. This is the fuller
 * record the API is expected to serve; {@link toCameraRecord} narrows it and
 * {@link toCameraLike} reduces it to the four fields the alert engine reads.
 */
export interface FixtureCameraRecord {
  /** Design-format identifier, e.g. "FWM-0442". */
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  /**
   * Compass degrees the lens points TOWARD, or `null` when genuinely unknown.
   * The REPORT sheet captures this from the compass: "223° · covering the
   * northbound lane" (App Screens 06).
   */
  readonly directionDeg: number | null;
  /** Hardware, as the INTEL CARD's title reads: "FALCON" (Screens II A4). */
  readonly manufacturer: string;
  readonly ownerType: FixtureOwnerType;
  readonly source: FixtureCameraSource;
  /**
   * The id this record has in `source`.
   *
   * Every fixture value is prefixed {@link FIXTURE_SOURCE_PREFIX}, so a record
   * that leaked out of a test into a real store is identifiable by inspection.
   */
  readonly sourceRecordId: string;
  /** 0..1. What the source publishes, not something computed here. */
  readonly confidence: number;
  /** "CONFIRMED BY · 28 HAKCERS" (Screens II A4). */
  readonly confirmedCount: number;
  /** Disputes filed against the record - the INTEL CARD's "DISPUTE" action. */
  readonly disputedCount: number;
  /** `false` once the camera has been reported gone. The record survives. */
  readonly isActive: boolean;
  /** EFF Atlas of Surveillance cross-reference, or `null` when there is none. */
  readonly effAtlasId: string | null;
  readonly sharingFlags: CameraSharingFlags;
  /**
   * Human label, exactly as the design renders it. Fixture metadata - it is
   * not part of the record shape the API serves, and nothing routes on it.
   */
  readonly label: string;
}

/** Prefix on every fixture `sourceRecordId`. Never produced by a real source. */
export const FIXTURE_SOURCE_PREFIX = 'fixture:';

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

/**
 * The one coordinate the design states, from the REPORT sheet:
 * "POSITION · AUTO / 39.0997 N · 84.5786 W / ±4 M · 9 SATS · Reading Rd".
 *
 * Kept as the simulator's default home so a drive that starts nowhere in
 * particular starts where the design says the user is standing.
 */
export const DESIGN_REPORT_POSITION = { lat: 39.0997, lon: -84.5786 } as const;

/**
 * Horizontal accuracy the design shows on a good fix: "±4 M · 9 SATS".
 * Comfortably inside `DEFAULT_GPS_ACCURACY_LIMIT_M` (50), so a fixture drive
 * alerts unless a scenario deliberately degrades it.
 */
export const DESIGN_GOOD_ACCURACY_M = 4;

/**
 * Every fixture camera, ordered by id.
 *
 * Ordering is the id order `dedupeCameras` returns, so a test that compares an
 * engine result against this array does not have to sort first.
 */
export const FIXTURE_CAMERAS: readonly FixtureCameraRecord[] = [
  {
    id: 'FWM-0118',
    lat: 39.124_05,
    lon: -84.497_02,
    // The ramp camera watches traffic coming up the ramp, i.e. back down it.
    directionDeg: 205,
    manufacturer: 'Falcon',
    ownerType: 'pd',
    source: 'eff-atlas',
    sourceRecordId: `${FIXTURE_SOURCE_PREFIX}eff-atlas/oh-hamilton-0118`,
    confidence: 0.94,
    confirmedCount: 41,
    disputedCount: 0,
    isActive: true,
    effAtlasId: 'AOS-OH-2019-0771',
    sharingFlags: { interAgency: true, agencyCount: 412, publicDataset: true },
    label: 'I-71 N Exit 3',
  },
  {
    id: 'FWM-0207',
    lat: 39.139_85,
    lon: -84.500_47,
    // Reported gone before anyone recorded which way it pointed.
    directionDeg: null,
    manufacturer: 'Falcon',
    ownerType: 'unknown',
    source: 'user-report',
    sourceRecordId: `${FIXTURE_SOURCE_PREFIX}user-report/0207`,
    confidence: 0.21,
    confirmedCount: 3,
    disputedCount: 6,
    // INACTIVE. Pole removed during a resurfacing. The record stays: a camera
    // that was there last month is still the answer to "was I read in June".
    isActive: false,
    effAtlasId: null,
    sharingFlags: { interAgency: false, agencyCount: null, publicDataset: true },
    label: 'Reading Rd @ Rockdale',
  },
  {
    id: 'FWM-0442',
    lat: 39.144_32,
    lon: -84.496_81,
    // "FACING · 223°" (Screens II A4 · INTEL CARD).
    directionDeg: 223,
    manufacturer: 'Falcon',
    ownerType: 'hoa',
    source: 'darkroute',
    sourceRecordId: `${FIXTURE_SOURCE_PREFIX}darkroute/0442`,
    confidence: 0.97,
    // "CONFIRMED BY · 28 HAKCERS" (Screens II A4).
    confirmedCount: 28,
    disputedCount: 1,
    isActive: true,
    // "EFF ATLAS · CROSS-REFERENCED" (Screens II A4).
    effAtlasId: 'AOS-OH-2021-1145',
    // "INTER-AGENCY SHARING · YES · 412 AGENCIES" (Screens II A4).
    sharingFlags: { interAgency: true, agencyCount: 412, publicDataset: true },
    label: 'Reading & Tennessee',
  },
  {
    id: 'FWM-0561',
    lat: 39.134_87,
    lon: -84.503_27,
    directionDeg: 348,
    manufacturer: 'Falcon',
    ownerType: 'unknown',
    source: 'user-report',
    sourceRecordId: `${FIXTURE_SOURCE_PREFIX}user-report/0561`,
    // DISPUTED. Nine people say this is a traffic-count sensor, two say ALPR.
    // Low confidence, still active, still alerted on - a contested record is
    // not a retracted one.
    confidence: 0.18,
    confirmedCount: 2,
    disputedCount: 9,
    isActive: true,
    effAtlasId: null,
    sharingFlags: { interAgency: false, agencyCount: null, publicDataset: true },
    label: 'Reading Rd @ Forest',
  },
  {
    id: 'FWM-0771',
    lat: 39.130_66,
    lon: -84.505_83,
    // Northbound approach.
    directionDeg: 196,
    manufacturer: 'Falcon',
    ownerType: 'pd',
    source: 'darkroute',
    sourceRecordId: `${FIXTURE_SOURCE_PREFIX}darkroute/0771`,
    confidence: 0.91,
    confirmedCount: 19,
    disputedCount: 0,
    isActive: true,
    effAtlasId: 'AOS-OH-2022-0044',
    sharingFlags: { interAgency: true, agencyCount: 412, publicDataset: true },
    label: 'Reading Rd @ Blair · NB',
  },
  {
    id: 'FWM-0772',
    // 60.00 ft due north of FWM-0771 - the far side of the same intersection.
    // Outside DEFAULT_DEDUPE_EPSILON_FT (50), so these stay two records.
    lat: 39.130_824_73,
    lon: -84.505_83,
    // Southbound approach: the reciprocal of its twin.
    directionDeg: 16,
    manufacturer: 'Falcon',
    ownerType: 'pd',
    source: 'darkroute',
    sourceRecordId: `${FIXTURE_SOURCE_PREFIX}darkroute/0772`,
    confidence: 0.91,
    confirmedCount: 17,
    disputedCount: 0,
    isActive: true,
    effAtlasId: 'AOS-OH-2022-0045',
    sharingFlags: { interAgency: true, agencyCount: 412, publicDataset: true },
    label: 'Reading Rd @ Blair · SB',
  },
  {
    id: 'FWM-0873',
    lat: 39.102_41,
    lon: -84.513_77,
    // UNKNOWN FACING. A garage-mounted unit nobody has stood under with a
    // compass. It still reads every plate that passes, so it stays in the list.
    directionDeg: null,
    manufacturer: 'Sparrow',
    ownerType: 'private',
    source: 'user-report',
    sourceRecordId: `${FIXTURE_SOURCE_PREFIX}user-report/0873`,
    confidence: 0.66,
    confirmedCount: 7,
    disputedCount: 1,
    isActive: true,
    effAtlasId: null,
    sharingFlags: { interAgency: false, agencyCount: null, publicDataset: true },
    label: 'Vine St & 7th',
  },
  {
    id: 'FWM-1180',
    lat: 39.213_08,
    lon: -84.580_76,
    directionDeg: 90,
    manufacturer: 'Falcon',
    ownerType: 'pd',
    source: 'public-records',
    sourceRecordId: `${FIXTURE_SOURCE_PREFIX}public-records/hamilton-2026-q1-1180`,
    confidence: 0.99,
    confirmedCount: 63,
    disputedCount: 0,
    isActive: true,
    effAtlasId: 'AOS-OH-2020-0312',
    sharingFlags: { interAgency: true, agencyCount: 412, publicDataset: true },
    label: 'Colerain & Galbraith',
  },
  {
    id: 'FWM-9042',
    // DUPLICATE REPORT. 18.00 ft from FWM-0442 - the same pole, pinned by a
    // second contributor from the other side of the street. Inside the 50 ft
    // dedupe epsilon, so the engine folds it into FWM-0442 and the survivor
    // inherits FWM-0442's known 223° facing rather than this record's null.
    lat: 39.144_360_48,
    lon: -84.496_773_6,
    directionDeg: null,
    manufacturer: 'Falcon',
    ownerType: 'unknown',
    source: 'user-report',
    sourceRecordId: `${FIXTURE_SOURCE_PREFIX}user-report/9042`,
    confidence: 0.34,
    confirmedCount: 1,
    disputedCount: 0,
    isActive: true,
    effAtlasId: null,
    sharingFlags: { interAgency: false, agencyCount: null, publicDataset: true },
    label: 'Reading & Tennessee (duplicate report)',
  },
];

// ---------------------------------------------------------------------------
// Named handles
//
// Scenarios address cameras by name rather than by index, so inserting a
// record into the array above cannot silently repoint a test.
// ---------------------------------------------------------------------------

export const FIXTURE_CAMERA_IDS = {
  /** Interstate ramp, PD-owned, shared to 412 agencies. */
  i71Exit3: 'FWM-0118',
  /** Removed from its pole. `isActive: false`. */
  readingRockdaleInactive: 'FWM-0207',
  /** The design's worked example: HOA, 223°, EFF Atlas cross-referenced. */
  readingTennessee: 'FWM-0442',
  /** Contested: 2 confirmations, 9 disputes. */
  readingForestDisputed: 'FWM-0561',
  /** Half of the 60 ft pair that produces `multiple`. Northbound. */
  readingBlairNorthbound: 'FWM-0771',
  /** The other half. 60 ft due north of its twin. Southbound. */
  readingBlairSouthbound: 'FWM-0772',
  /** Facing unknown - `directionDeg: null`. */
  vineSeventh: 'FWM-0873',
  /** The WATCHLIST screen's "a camera you've never passed before". */
  colerainGalbraith: 'FWM-1180',
  /** The duplicate report 18 ft from FWM-0442. Deduped away. */
  readingTennesseeDuplicate: 'FWM-9042',
} as const satisfies Readonly<Record<string, string>>;

/** The pair that must NOT merge, and must both fit inside one threshold. */
export const MULTIPLE_PAIR_IDS: readonly [string, string] = [
  FIXTURE_CAMERA_IDS.readingBlairNorthbound,
  FIXTURE_CAMERA_IDS.readingBlairSouthbound,
];

/** The pair that MUST merge. Survivor first. */
export const DEDUPE_PAIR_IDS: readonly [string, string] = [
  FIXTURE_CAMERA_IDS.readingTennessee,
  FIXTURE_CAMERA_IDS.readingTennesseeDuplicate,
];

/** Nominal separation of {@link MULTIPLE_PAIR_IDS}, feet. Above the 50 ft epsilon. */
export const MULTIPLE_PAIR_SEPARATION_FT = 60;

/** Nominal separation of {@link DEDUPE_PAIR_IDS}, feet. Below the 50 ft epsilon. */
export const DEDUPE_PAIR_SEPARATION_FT = 18;

/**
 * Rounding slack on the two separations above, feet.
 *
 * The coordinates are stored to eight decimal places (~1.1 mm), so the
 * separations land within a few thousandths of a foot of nominal. The
 * assertions use this rather than an exact equality, because an exact equality
 * against a rounded literal is a test that passes for the wrong reason.
 */
export const PAIR_SEPARATION_TOLERANCE_FT = 0.01;

// ---------------------------------------------------------------------------
// Lookup and projection
// ---------------------------------------------------------------------------

const BY_ID: ReadonlyMap<string, FixtureCameraRecord> = new Map(
  FIXTURE_CAMERAS.map((camera) => [camera.id, camera]),
);

/**
 * One fixture camera by id.
 *
 * @throws RangeError when the id is not in the set. A scenario naming a camera
 *         that does not exist is a bug in the scenario, not an empty drive.
 */
export function fixtureCamera(id: string): FixtureCameraRecord {
  const camera = BY_ID.get(id);
  if (camera === undefined) {
    throw new RangeError(
      `fixtureCamera: no fixture camera with id ${id}. Known ids: ${FIXTURE_CAMERAS.map((c) => c.id).join(', ')}`,
    );
  }
  return camera;
}

/** Several fixture cameras by id, in the order asked for. */
export function fixtureCameras(ids: readonly string[]): FixtureCameraRecord[] {
  return ids.map(fixtureCamera);
}

/** Only the records a live map would draw. Inactive records are excluded here and nowhere else. */
export function activeFixtureCameras(): FixtureCameraRecord[] {
  return FIXTURE_CAMERAS.filter((camera) => camera.isActive);
}

/**
 * Reduce to the four fields `@fwm/core` reads.
 *
 * Note what is NOT filtered: `isActive`, `disputedCount` and `confidence` do
 * not appear, because the alert engine does not take opinions about a record -
 * it measures distance. Deciding that a disputed or inactive camera should not
 * alert is a TRIAGE decision, made above the engine, by the caller choosing
 * which records to hand in.
 */
export function toCameraLike(camera: FixtureCameraRecord): CameraLike {
  return {
    id: camera.id,
    lat: camera.lat,
    lon: camera.lon,
    directionDeg: camera.directionDeg,
  };
}

export function toCameraLikes(cameras: readonly FixtureCameraRecord[]): CameraLike[] {
  return cameras.map(toCameraLike);
}

/**
 * Owner class as the storage layer names it.
 *
 * `inter_agency` is never produced. That value describes a shared feed, and
 * sharing lives on `sharingFlags.interAgency` here; inventing an owner out of
 * a sharing flag would lose the real owner, which is the only thing the TRIAGE
 * screen's "POLICE / AGENCY" row is actually filtering on.
 */
export function toDbOwnerType(ownerType: FixtureOwnerType): CameraOwnerType {
  if (ownerType === 'pd') return 'police';
  if (ownerType === 'hoa') return 'hoa';
  if (ownerType === 'private') return 'private';
  return 'unverified';
}

/**
 * Narrow to the cached shape in `db/schema.ts`.
 *
 * `updatedAt` is omitted rather than stamped: the field means "when the source
 * last modified this", and a fixture has no source that modified anything.
 * Under `exactOptionalPropertyTypes` an absent field and an `undefined` one are
 * different, and absent is the honest one.
 */
export function toCameraRecord(camera: FixtureCameraRecord): CameraRecord {
  return {
    id: camera.id,
    lat: camera.lat,
    lon: camera.lon,
    directionDeg: camera.directionDeg,
    ownerType: toDbOwnerType(camera.ownerType),
    confirmations: camera.confirmedCount,
  };
}

export function toCameraRecords(cameras: readonly FixtureCameraRecord[]): CameraRecord[] {
  return cameras.map(toCameraRecord);
}
