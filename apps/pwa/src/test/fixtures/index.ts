/**
 * ===========================================================================
 * FIXTURE DATA - NOT REAL SURVEILLANCE DATA, NOT REAL EVIDENCE
 * ===========================================================================
 *
 * One import for the whole fixture set. Read the header of each module before
 * using it: the cameras are invented, and the report signatures are not
 * signatures.
 */

export {
  DEDUPE_PAIR_IDS,
  DEDUPE_PAIR_SEPARATION_FT,
  DESIGN_GOOD_ACCURACY_M,
  DESIGN_REPORT_POSITION,
  FIXTURE_CAMERAS,
  FIXTURE_CAMERA_IDS,
  FIXTURE_SOURCE_PREFIX,
  MULTIPLE_PAIR_IDS,
  MULTIPLE_PAIR_SEPARATION_FT,
  PAIR_SEPARATION_TOLERANCE_FT,
  activeFixtureCameras,
  fixtureCamera,
  fixtureCameras,
  toCameraLike,
  toCameraLikes,
  toCameraRecord,
  toCameraRecords,
  toDbOwnerType,
} from './cameras.ts';
export type {
  CameraSharingFlags,
  FixtureCameraRecord,
  FixtureCameraSource,
  FixtureOwnerType,
} from './cameras.ts';

export {
  FIXTURE_FETCHED_AT_MS,
  FIXTURE_TILES,
  FIXTURE_TILE_RING_RADIUS,
  FIXTURE_TILE_ZOOM,
  fixtureCameraRecords,
  fixtureRingAt,
  fixtureTileAt,
  fixtureTileChecks,
  fixtureTileInputs,
  fixtureTileKeys,
  fixtureTileMetaRecords,
  fixtureTileRecords,
  fixtureTilesFor,
  packIntoTiles,
} from './tiles.ts';
export type { FixtureTile, FixtureTileInputOptions } from './tiles.ts';

export {
  FIXTURE_CAPTURED_AT,
  FIXTURE_CHAIN_HEAD_HASH,
  FIXTURE_HASH_MARKER,
  FIXTURE_PUBLIC_KEY_ID,
  FIXTURE_PUBLIC_KEY_MARKER,
  FIXTURE_PUBLIC_KEY_SPKI,
  FIXTURE_QUEUED_REPORT_IDS,
  FIXTURE_REPORT_CHAIN,
  FIXTURE_REPORT_IDS,
  FIXTURE_SIGNATURE_MARKER,
  FIXTURE_SIGNED_REPORTS,
  fixtureHash,
  isFixtureEvidence,
} from './reports.ts';
