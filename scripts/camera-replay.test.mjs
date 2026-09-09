import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { loadCountiesBytes } from './counties.mjs';
import { replayCameraCore, replayDiffUrl, replayStateUrl } from './camera-replay.mjs';
import { DEFAULT_COUNTY_GEOFENCE, normalise } from './fetch-cameras.mjs';

const counties = loadCountiesBytes(readFileSync(DEFAULT_COUNTY_GEOFENCE));
const lat = 38.9;
const lon = -94.7;
const county = counties.lookup(lat, lon);

function response(url, bytes, over = {}) {
  return {
    ok: true,
    status: 200,
    url,
    headers: new Headers({ 'content-length': String(bytes.length) }),
    arrayBuffer: async () => bytes,
    ...over,
  };
}

test('independent replay binds exact state/diff bytes and applies the shared redacted policy', async () => {
  const sequence = 10;
  const state = Buffer.from('sequenceNumber=10\ntimestamp=2026-09-01T10\\:00\\:00Z\n');
  const diff = gzipSync(
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<osmChange version="0.6" generator="fixture"><modify>' +
        '<node id="1" version="2" timestamp="2026-09-01T09:59:00Z" lat="38.9" lon="-94.7">' +
        '<tag k="man_made" v="surveillance"/>' +
        '<tag k="surveillance:type" v="ANPR"/>' +
        '<tag k="operator" v="Safe Transit"/>' +
        '<tag k="contact:email" v="victim@example.org"/>' +
        '<tag k="note" v="unreviewed free text"/>' +
        '</node></modify></osmChange>',
    ),
    { mtime: 0 },
  );
  const requested = [];
  const fetchImpl = async (url, init) => {
    requested.push({ url, init });
    if (url === replayStateUrl(sequence)) return response(url, state);
    if (url === replayDiffUrl(sequence)) return response(url, diff);
    throw new Error(`unexpected URL ${url}`);
  };
  const baseline = normalise(
    {
      id: 1,
      lat,
      lon,
      version: 1,
      timestamp: '2026-09-01T09:00:00Z',
      tags: { man_made: 'surveillance', 'surveillance:type': 'ALPR' },
    },
    county,
  );
  const replay = await replayCameraCore({
    live: [baseline],
    tombstones: [],
    fromSequence: 9,
    throughSequence: sequence,
    countyIndex: counties,
    fetchImpl,
  });
  assert.equal(replay.live.length, 1);
  assert.equal(replay.live[0].osmVersion, 2);
  assert.equal(replay.live[0].countyFips, county.fips);
  assert.deepEqual(replay.live[0].tags, { operator: 'Safe Transit' });
  assert.equal(replay.timestamp, '2026-09-01T10:00:00.000Z');
  assert.equal(replay.diffs.length, 1);
  assert.equal(replay.diffs[0].stateBytes, state.length);
  assert.equal(replay.diffs[0].diffBytes, diff.length);
  assert.ok(requested.every(({ init }) => init.redirect === 'error'));
});

test('independent replay applies territory to the canonical five-decimal point', async () => {
  const sequence = 10;
  const state = Buffer.from('sequenceNumber=10\ntimestamp=2026-09-01T10\\:00\\:00Z\n');
  const diff = gzipSync(
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<osmChange version="0.6" generator="fixture"><modify>' +
        '<node id="1" version="2" timestamp="2026-09-01T09:59:00Z" lat="60.516007" lon="-173.1169001">' +
        '<tag k="man_made" v="surveillance"/><tag k="surveillance:type" v="ALPR"/>' +
        '</node></modify><create>' +
        '<node id="2" version="1" timestamp="2026-09-01T09:59:00Z" lat="60.516002" lon="-173.1169099">' +
        '<tag k="man_made" v="surveillance"/><tag k="surveillance:type" v="ANPR"/>' +
        '</node></create></osmChange>',
    ),
    { mtime: 0 },
  );
  const fetchImpl = async (url) => {
    if (url === replayStateUrl(sequence)) return response(url, state);
    if (url === replayDiffUrl(sequence)) return response(url, diff);
    throw new Error(`unexpected URL ${url}`);
  };
  const baseline = normalise(
    {
      id: 1,
      lat,
      lon,
      version: 1,
      timestamp: '2026-09-01T09:00:00Z',
      tags: { man_made: 'surveillance', 'surveillance:type': 'ALPR' },
    },
    county,
  );
  const replay = await replayCameraCore({
    live: [baseline],
    tombstones: [],
    fromSequence: 9,
    throughSequence: sequence,
    countyIndex: counties,
    fetchImpl,
  });
  assert.deepEqual(
    replay.live.map(({ id: cameraId }) => cameraId),
    ['osm:2'],
  );
  assert.equal(replay.live[0].lat, 60.516);
  assert.equal(replay.live[0].lon, -173.11691);
  assert.deepEqual(replay.tombstones, [
    { id: 'osm:1', reason: 'osm_out_of_scope', seq: 10, osmVersion: 2 },
  ]);
});

test('independent replay rejects an official-state redirect before reading a diff', async () => {
  await assert.rejects(
    replayCameraCore({
      live: [],
      tombstones: [],
      fromSequence: 9,
      throughSequence: 10,
      countyIndex: counties,
      fetchImpl: async (url) =>
        response(url, Buffer.from('x'), {
          url: 'https://attacker.invalid/state.txt',
        }),
    }),
    /resolved to/,
  );
});
