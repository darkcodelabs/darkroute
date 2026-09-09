/**
 * The fixture set makes geometric and structural claims in its comments. This
 * file turns every one of them into an assertion, measured with the code under
 * test, so a comment cannot quietly become wrong.
 */

import { describe, expect, it } from 'vitest';

import {
  dedupeCameras,
  distanceFt,
  latLonToTile,
  tileKey,
  DEFAULT_DEDUPE_EPSILON_FT,
} from '../../services/simulator/fwmCore.ts';
import {
  DEDUPE_PAIR_IDS,
  DEDUPE_PAIR_SEPARATION_FT,
  FIXTURE_CAMERAS,
  FIXTURE_CAMERA_IDS,
  FIXTURE_SOURCE_PREFIX,
  MULTIPLE_PAIR_IDS,
  MULTIPLE_PAIR_SEPARATION_FT,
  PAIR_SEPARATION_TOLERANCE_FT,
  activeFixtureCameras,
  fixtureCamera,
  toCameraLikes,
  toCameraRecord,
  toDbOwnerType,
} from './cameras.ts';
import {
  FIXTURE_TILES,
  FIXTURE_TILE_ZOOM,
  fixtureRingAt,
  fixtureTileInputs,
  fixtureTilesFor,
  packIntoTiles,
} from './tiles.ts';
import {
  FIXTURE_HASH_MARKER,
  FIXTURE_PUBLIC_KEY_MARKER,
  FIXTURE_REPORT_CHAIN,
  FIXTURE_SIGNATURE_MARKER,
  FIXTURE_SIGNED_REPORTS,
  fixtureHash,
  isFixtureEvidence,
} from './reports.ts';
import { CAPTURED_AT_RE, GENESIS_CHAIN_HASH, REPORT_ID_RE } from '../../services/crypto/chain.ts';

function separationFt(idA: string, idB: string): number {
  const a = fixtureCamera(idA);
  const b = fixtureCamera(idB);
  return distanceFt(a.lat, a.lon, b.lat, b.lon);
}

describe('fixture cameras', () => {
  it('is ordered by id, with unique ids', () => {
    const ids = FIXTURE_CAMERAS.map((camera) => camera.id);
    expect(ids).toStrictEqual([...ids].sort((a, b) => a.localeCompare(b)));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks every record as fixture-sourced', () => {
    for (const camera of FIXTURE_CAMERAS) {
      expect(camera.sourceRecordId.startsWith(FIXTURE_SOURCE_PREFIX)).toBe(true);
    }
  });

  it('covers the record states the alert paths have to handle', () => {
    expect(FIXTURE_CAMERAS.some((c) => c.directionDeg === null)).toBe(true);
    expect(FIXTURE_CAMERAS.some((c) => c.isActive === false)).toBe(true);
    expect(FIXTURE_CAMERAS.some((c) => c.disputedCount > c.confirmedCount)).toBe(true);
    expect(FIXTURE_CAMERAS.some((c) => c.effAtlasId !== null)).toBe(true);
    expect(FIXTURE_CAMERAS.some((c) => c.sharingFlags.interAgency)).toBe(true);
    expect(new Set(FIXTURE_CAMERAS.map((c) => c.ownerType))).toStrictEqual(
      new Set(['pd', 'hoa', 'private', 'unknown']),
    );
  });

  it('excludes only the inactive record from the active list', () => {
    const active = activeFixtureCameras().map((c) => c.id);
    expect(active).not.toContain(FIXTURE_CAMERA_IDS.readingRockdaleInactive);
    expect(active.length).toBe(FIXTURE_CAMERAS.length - 1);
  });

  it('separates the multiple pair by 60 ft - outside the dedupe epsilon', () => {
    const [a, b] = MULTIPLE_PAIR_IDS;
    const gap = separationFt(a, b);
    expect(gap).toBeGreaterThan(DEFAULT_DEDUPE_EPSILON_FT);
    expect(Math.abs(gap - MULTIPLE_PAIR_SEPARATION_FT)).toBeLessThanOrEqual(
      PAIR_SEPARATION_TOLERANCE_FT,
    );
  });

  it('separates the dedupe pair by 18 ft - inside the dedupe epsilon', () => {
    const [a, b] = DEDUPE_PAIR_IDS;
    const gap = separationFt(a, b);
    expect(gap).toBeLessThan(DEFAULT_DEDUPE_EPSILON_FT);
    expect(Math.abs(gap - DEDUPE_PAIR_SEPARATION_FT)).toBeLessThanOrEqual(
      PAIR_SEPARATION_TOLERANCE_FT,
    );
  });

  it('folds the dedupe pair into one record and keeps the known facing', () => {
    const [survivorId, duplicateId] = DEDUPE_PAIR_IDS;
    const deduped = dedupeCameras(toCameraLikes([fixtureCamera(survivorId), fixtureCamera(duplicateId)]));
    expect(deduped).toHaveLength(1);
    const [merged] = deduped;
    expect(merged?.id).toBe(survivorId);
    expect(merged?.mergedIds).toStrictEqual([survivorId, duplicateId].sort((a, b) => a.localeCompare(b)));
    // The duplicate carries a null facing; the survivor's 223 deg must survive.
    expect(merged?.directionDeg).toBe(fixtureCamera(survivorId).directionDeg);
    expect(merged?.directionDeg).not.toBeNull();
  });

  it('keeps the multiple pair as two records through dedupe', () => {
    const [a, b] = MULTIPLE_PAIR_IDS;
    const deduped = dedupeCameras(toCameraLikes([fixtureCamera(a), fixtureCamera(b)]));
    expect(deduped.map((c) => c.id)).toStrictEqual([a, b]);
  });

  it('keeps every other pair well clear of the dedupe epsilon', () => {
    const intentional = new Set([DEDUPE_PAIR_IDS.join('|'), MULTIPLE_PAIR_IDS.join('|')]);
    for (let i = 0; i < FIXTURE_CAMERAS.length; i++) {
      for (let j = i + 1; j < FIXTURE_CAMERAS.length; j++) {
        const a = FIXTURE_CAMERAS[i];
        const b = FIXTURE_CAMERAS[j];
        if (a === undefined || b === undefined) continue;
        if (intentional.has(`${a.id}|${b.id}`)) continue;
        expect(distanceFt(a.lat, a.lon, b.lat, b.lon)).toBeGreaterThan(DEFAULT_DEDUPE_EPSILON_FT);
      }
    }
  });

  it('throws on an unknown id rather than returning an empty drive', () => {
    expect(() => fixtureCamera('FWM-0000')).toThrow(RangeError);
  });

  it('never maps an owner onto inter_agency', () => {
    for (const camera of FIXTURE_CAMERAS) {
      expect(toDbOwnerType(camera.ownerType)).not.toBe('inter_agency');
      expect(toCameraRecord(camera).ownerType).not.toBe('inter_agency');
    }
  });

  it('omits updatedAt rather than stamping one', () => {
    for (const camera of FIXTURE_CAMERAS) {
      expect(Object.hasOwn(toCameraRecord(camera), 'updatedAt')).toBe(false);
    }
  });
});

describe('fixture tiles', () => {
  it('places every camera in exactly one tile at the working zoom', () => {
    const seen = new Set<string>();
    for (const tile of FIXTURE_TILES) {
      expect(tile.z).toBe(FIXTURE_TILE_ZOOM);
      for (const camera of tile.cameras) {
        expect(seen.has(camera.id)).toBe(false);
        seen.add(camera.id);
        // The camera is in the tile the engine's own addressing puts it in.
        expect(tileKey(latLonToTile(camera.lat, camera.lon, FIXTURE_TILE_ZOOM))).toBe(tile.key);
      }
    }
    expect(seen.size).toBe(FIXTURE_CAMERAS.length);
  });

  it('is ordered and stable', () => {
    const keys = FIXTURE_TILES.map((tile) => tile.key);
    expect(keys).toStrictEqual([...keys].sort((a, b) => a.localeCompare(b)));
    expect(packIntoTiles(FIXTURE_CAMERAS)).toStrictEqual([...FIXTURE_TILES]);
  });

  it('puts each intentional pair in one tile', () => {
    expect(fixtureTilesFor(DEDUPE_PAIR_IDS)).toHaveLength(1);
    expect(fixtureTilesFor(MULTIPLE_PAIR_IDS)).toHaveLength(1);
  });

  it('tags every repository input as fixture-sourced', () => {
    const inputs = fixtureTileInputs();
    expect(inputs.length).toBe(FIXTURE_TILES.length);
    for (const input of inputs) expect(input.source).toBe('fixture');
  });

  it('produces a 3x3 fetch ring around a coordinate', () => {
    const camera = fixtureCamera(FIXTURE_CAMERA_IDS.readingTennessee);
    const ring = fixtureRingAt(camera.lat, camera.lon);
    expect(ring).toHaveLength(9);
    expect(ring.some((tile) => tileKey(tile) === tileKey(latLonToTile(camera.lat, camera.lon, FIXTURE_TILE_ZOOM)))).toBe(true);
  });
});

describe('fixture reports', () => {
  it('is a chain of three, two of them queued', () => {
    expect(FIXTURE_SIGNED_REPORTS).toHaveLength(3);
    expect(FIXTURE_SIGNED_REPORTS.filter((r) => r.syncState === 'held')).toHaveLength(2);
    expect(FIXTURE_SIGNED_REPORTS.filter((r) => r.syncState === 'synced')).toHaveLength(1);
  });

  it('links each record to the one before it', () => {
    expect(FIXTURE_SIGNED_REPORTS[0]?.previousChainHash).toBe(GENESIS_CHAIN_HASH);
    for (let i = 1; i < FIXTURE_SIGNED_REPORTS.length; i++) {
      expect(FIXTURE_SIGNED_REPORTS[i]?.previousChainHash).toBe(FIXTURE_SIGNED_REPORTS[i - 1]?.chainHash);
    }
  });

  it('is structurally valid where the chain checks formats', () => {
    for (const record of FIXTURE_SIGNED_REPORTS) {
      expect(record.reportId).toMatch(REPORT_ID_RE);
      expect(record.capturedAt).toMatch(CAPTURED_AT_RE);
      expect(record.chainHash).toHaveLength(64);
      expect(record.payloadHash).toHaveLength(64);
      expect(record.chainHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('captures in strictly increasing time order', () => {
    const times = FIXTURE_SIGNED_REPORTS.map((r) => Date.parse(r.capturedAt));
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1] ?? 0);
    }
  });

  it('marks every hash, signature and key as fixture data', () => {
    for (const record of FIXTURE_SIGNED_REPORTS) {
      expect(record.payloadHash.startsWith(FIXTURE_HASH_MARKER)).toBe(true);
      expect(record.chainHash.startsWith(FIXTURE_HASH_MARKER)).toBe(true);
      expect(record.signature.startsWith(FIXTURE_SIGNATURE_MARKER)).toBe(true);
      expect(record.publicKeySpki.startsWith(FIXTURE_PUBLIC_KEY_MARKER)).toBe(true);
      expect(isFixtureEvidence(record)).toBe(true);
    }
    for (const row of FIXTURE_REPORT_CHAIN) expect(isFixtureEvidence(row)).toBe(true);
  });

  it('does not flag a record that carries no marker', () => {
    expect(
      isFixtureEvidence({
        payloadHash: 'a'.repeat(64),
        chainHash: 'b'.repeat(64),
        signature: 'c'.repeat(86),
        publicKeySpki: 'd'.repeat(120),
      }),
    ).toBe(false);
  });

  it('carries no licence plate anywhere in a payload', () => {
    const serialised = JSON.stringify(FIXTURE_SIGNED_REPORTS.map((r) => r.payload));
    expect(serialised).not.toMatch(/plate/i);
    // The design's watchlist plate, which must never appear in a report.
    expect(serialised).not.toContain('HVK');
  });

  it('mirrors the chain rows against the signed records', () => {
    expect(FIXTURE_REPORT_CHAIN).toHaveLength(FIXTURE_SIGNED_REPORTS.length);
    for (const [index, row] of FIXTURE_REPORT_CHAIN.entries()) {
      const record = FIXTURE_SIGNED_REPORTS[index];
      expect(row.reportId).toBe(record?.reportId);
      expect(row.chainHash).toBe(record?.chainHash);
      expect(row.payloadHash).toBe(record?.payloadHash);
      expect(row.previousChainHash).toBe(record?.previousChainHash);
      expect(row.capturedAt).toBe(record?.capturedAt);
    }
  });

  it('rejects a non-hex or oversized fixture hash tag', () => {
    expect(() => fixtureHash('zz')).toThrow(RangeError);
    expect(() => fixtureHash('a'.repeat(41))).toThrow(RangeError);
  });
});
