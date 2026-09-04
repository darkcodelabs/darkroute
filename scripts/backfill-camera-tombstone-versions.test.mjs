import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  backfillTombstoneVersions,
  parseBackfillArgs,
  resolveTombstoneVersion,
} from './backfill-camera-tombstone-versions.mjs';

const event = (over = {}) => ({
  action: 'modify',
  type: 'node',
  id: '10',
  version: 2,
  tags: { man_made: 'surveillance' },
  ...over,
});

test('the highest version in the exact diff owns a tombstone', () => {
  assert.equal(
    resolveTombstoneVersion({ id: 'osm:10', reason: 'osm_delete', seq: 100 }, [
      event({ action: 'modify', version: 2 }),
      event({ action: 'delete', version: 3, tags: {} }),
    ]),
    3,
  );
  assert.equal(
    resolveTombstoneVersion({ id: 'osm:10', reason: 'osm_untag', seq: 100 }, [
      event({ version: 4, tags: { amenity: 'bench' } }),
    ]),
    4,
  );
});

test('reason contradictions and absent historical events fail closed', () => {
  assert.throws(
    () =>
      resolveTombstoneVersion({ id: 'osm:10', reason: 'osm_delete', seq: 100 }, [
        event({ action: 'modify' }),
      ]),
    /says osm_delete/,
  );
  assert.throws(
    () =>
      resolveTombstoneVersion({ id: 'osm:10', reason: 'osm_untag', seq: 100 }, [
        event({ tags: { man_made: 'surveillance', 'surveillance:type': 'ALPR' } }),
      ]),
    /does not end unqualified/,
  );
  assert.throws(
    () => resolveTombstoneVersion({ id: 'osm:10', reason: 'osm_delete', seq: 100 }, []),
    /absent from its recorded replication sequence/,
  );
  assert.throws(
    () =>
      resolveTombstoneVersion({ id: 'osm:10', reason: 'osm_untag', seq: 100 }, [
        event({ action: 'create', tags: { amenity: 'bench' } }),
      ]),
    /does not end unqualified/,
  );
  assert.throws(
    () =>
      resolveTombstoneVersion({ id: 'osm:10', reason: 'osm_delete', seq: 100 }, [
        event({ action: 'delete', version: 3, tags: {} }),
        event({ action: 'delete', version: 3, tags: {} }),
      ]),
    /2 events at version 3/,
  );
});

test('an out-of-scope reason requires the exact qualifying modify outside the pinned territory', () => {
  const tombstone = { id: 'osm:10', reason: 'osm_out_of_scope', seq: 100 };
  const moved = event({
    version: 6,
    lat: 49.2827,
    lon: -123.1207,
    tags: { man_made: 'surveillance', 'surveillance:type': 'ANPR' },
  });
  assert.equal(
    resolveTombstoneVersion(tombstone, [moved], {
      countyIndex: { lookup: () => null },
    }),
    6,
  );
  assert.throws(
    () =>
      resolveTombstoneVersion(tombstone, [moved], {
        countyIndex: { lookup: () => ({ fips: '53033' }) },
      }),
    /does not end as a qualifying node outside/,
  );
  assert.throws(
    () => resolveTombstoneVersion(tombstone, [moved]),
    /does not end as a qualifying node outside/,
  );
});

test('out-of-scope history is classified at the exact five-decimal published point', () => {
  const tombstone = { id: 'osm:10', reason: 'osm_out_of_scope', seq: 100 };
  const calls = [];
  const countyIndex = {
    lookup: (lat, lon) => {
      calls.push([lat, lon]);
      return lat === 60.516 && lon === -173.11691 ? { fips: '02050' } : null;
    },
  };

  // Raw is barely outside, canonical is inside: it cannot prove removal.
  assert.throws(
    () =>
      resolveTombstoneVersion(
        tombstone,
        [
          event({
            version: 6,
            lat: 60.516002,
            lon: -173.1169099,
            tags: { man_made: 'surveillance', 'surveillance:type': 'ALPR' },
          }),
        ],
        { countyIndex },
      ),
    /does not end as a qualifying node outside/,
  );
  assert.deepEqual(calls, [[60.516, -173.11691]]);

  calls.length = 0;
  // Raw is barely inside a boundary, canonical is outside: the canonical
  // point is the one the exact-diff proof must accept.
  assert.equal(
    resolveTombstoneVersion(
      tombstone,
      [
        event({
          version: 7,
          lat: 60.516007,
          lon: -173.1169001,
          tags: { man_made: 'surveillance', 'surveillance:type': 'ANPR' },
        }),
      ],
      { countyIndex },
    ),
    7,
  );
  assert.deepEqual(calls, [[60.51601, -173.1169]]);
});

test('each sequence is loaded once, entry order is stable, and held versions are verified', async () => {
  const calls = [];
  const result = await backfillTombstoneVersions(
    [
      { id: 'osm:20', reason: 'osm_delete', seq: 101 },
      { id: 'osm:10', reason: 'osm_untag', seq: 100 },
      { id: 'osm:11', reason: 'osm_delete', seq: 100, osmVersion: 7 },
    ],
    async (seq, ids) => {
      calls.push({ seq, ids: [...ids].sort() });
      if (seq === 101) return [event({ id: '20', action: 'delete', version: 3, tags: {} })];
      return [
        event({ id: '10', version: 5 }),
        event({ id: '11', action: 'delete', version: 7, tags: {} }),
      ];
    },
  );

  assert.deepEqual(calls, [
    { seq: 100, ids: ['10', '11'] },
    { seq: 101, ids: ['20'] },
  ]);
  assert.deepEqual(result, {
    tombstones: [
      { id: 'osm:20', reason: 'osm_delete', seq: 101, osmVersion: 3 },
      { id: 'osm:10', reason: 'osm_untag', seq: 100, osmVersion: 5 },
      { id: 'osm:11', reason: 'osm_delete', seq: 100, osmVersion: 7 },
    ],
    added: 2,
    verified: 1,
    sequences: 2,
  });

  await assert.rejects(
    backfillTombstoneVersions(
      [{ id: 'osm:11', reason: 'osm_delete', seq: 100, osmVersion: 6 }],
      async () => [event({ id: '11', action: 'delete', version: 7, tags: {} })],
    ),
    /records version 6, but sequence 100 proves 7/,
  );
});

test('the backfill CLI is strict and resolves only explicit camera targets', () => {
  const parsed = parseBackfillArgs(['--dry', '--target=/tmp/camera-backfill']);
  assert.equal(parsed.dry, true);
  assert.equal(parsed.target, '/tmp/camera-backfill');
  assert.throws(() => parseBackfillArgs(['--dry', '--dry']), /may be supplied only once/);
  assert.throws(() => parseBackfillArgs(['--target']), /requires a non-empty value/);
  assert.throws(() => parseBackfillArgs(['--wat']), /unknown backfill argument/);
});
