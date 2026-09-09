import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { buildPredecessorEvidence } from './camera-predecessor.mjs';
import { buildCutoverLedger } from './reconcile-camera-cutover.mjs';
import {
  ATTRIBUTION,
  DEFAULT_COUNTY_GEOFENCE,
  LICENCE,
  LICENCE_URL,
  releaseTombstoneIdentity,
} from './fetch-cameras.mjs';

describe('camera cutover reconciliation', () => {
  it('emits the unchanged canonical ledger when an empty predecessor has no uncovered ids', async () => {
    const ledger = {
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      generatedAt: '2026-09-01T20:00:00.000Z',
      upstream: '2026-09-01T20:00:00Z',
      tombstones: [],
    };
    const bytes = Buffer.from(`${JSON.stringify(ledger)}\n`);
    const predecessor = buildPredecessorEvidence({
      mode: 'empty-r2',
      entries: [],
      deployment: {
        provider: 'cloudflare-r2',
        accountId: 'account',
        bucket: 'bucket',
      },
      capturedAt: '2026-09-01T20:05:00.000Z',
    });
    const result = await buildCutoverLedger({
      capture: { collection: { type: 'FeatureCollection', features: [] } },
      tombstoneLedger: {
        ...ledger,
        bytes,
        identity: releaseTombstoneIdentity(bytes, ledger),
      },
      predecessor,
      predecessorTombstoneBytes: null,
      geofenceBytes: readFileSync(DEFAULT_COUNTY_GEOFENCE),
      fetchImpl: async () => {
        throw new Error('no network request expected for an empty predecessor');
      },
      transformCollection: () => ({ cameras: [], territorialCameras: [] }),
    });

    assert.deepEqual(result.ledger, ledger);
    assert.deepEqual(result.bytes, bytes);
    assert.deepEqual(result.entries, []);
    assert.equal(result.after, null);
  });

  it('replaces an inherited tombstone when its id is also predecessor-live and absent', async () => {
    const inherited = {
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      generatedAt: '2026-09-01T19:00:00.000Z',
      upstream: '2026-09-01T19:00:00Z',
      tombstones: [{ id: 'osm:99', reason: 'osm_delete', seq: 10, osmVersion: 2 }],
    };
    const bytes = Buffer.from(`${JSON.stringify(inherited)}\n`);
    const predecessor = buildPredecessorEvidence({
      mode: 'legacy-flat-root',
      entries: [
        { key: 'index.json', body: Buffer.from('{}') },
        { key: 'tombstones.json', body: bytes },
        {
          key: '11/1/2.json',
          body: Buffer.from(JSON.stringify({ cameras: [{ id: 'osm:99' }] })),
        },
      ],
      deployment: {
        provider: 'cloudflare-r2',
        accountId: 'account',
        bucket: 'bucket',
      },
      capturedAt: '2026-09-01T20:05:00.000Z',
    });
    const currentNode = {
      type: 'node',
      id: 99,
      version: 5,
      timestamp: '2026-09-01T19:30:00Z',
      visible: true,
      lat: 49.2,
      lon: -123.1,
      tags: {},
    };
    const fetchImpl = async (url) =>
      url.endsWith('state.txt')
        ? {
            ok: true,
            status: 200,
            url,
            text: async () => 'sequenceNumber=12\ntimestamp=2026-09-01T20\\:00\\:00Z\n',
          }
        : {
            ok: true,
            status: 200,
            url,
            json: async () => ({ elements: [currentNode] }),
          };
    const result = await buildCutoverLedger({
      capture: { collection: { type: 'FeatureCollection', features: [] } },
      tombstoneLedger: {
        ...inherited,
        bytes,
        identity: releaseTombstoneIdentity(bytes, inherited),
      },
      predecessor,
      predecessorTombstoneBytes: bytes,
      geofenceBytes: readFileSync(DEFAULT_COUNTY_GEOFENCE),
      fetchImpl,
      now: () => new Date('2026-09-01T20:06:00.000Z'),
      transformCollection: () => ({ cameras: [], territorialCameras: [] }),
      loadTombstoneSequence: async () => [
        { type: 'node', id: 99, action: 'delete', version: 2, tags: {} },
      ],
    });

    assert.deepEqual(result.entries, [
      { id: 'osm:99', reason: 'cutover_reconciliation', seq: 12, osmVersion: 5 },
    ]);
    assert.deepEqual(result.ledger.tombstones, result.entries);
    assert.equal(result.after.seq, 12);
  });

  it('records a live node the OSM API returns with no tags at all', async () => {
    /*
     * THE COMMONEST SHAPE IN A REAL CUTOVER, AND IT USED TO KILL THE RUN.
     *
     * A camera whose tags a mapper stripped is a live, visible node with valid
     * coordinates and NO `tags` key -- the OSM API omits the key rather than
     * sending an empty map. That is exactly the removal this ledger exists to
     * record, and the old check read the absent key as a malformed response:
     * "official OSM node osm:99 has invalid geometry or tags", on node
     * 10155751371, three thousand ids into a national reconciliation.
     */
    const inherited = {
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      generatedAt: '2026-09-01T19:00:00.000Z',
      upstream: '2026-09-01T19:00:00Z',
      tombstones: [],
    };
    const bytes = Buffer.from(`${JSON.stringify(inherited)}\n`);
    const predecessor = buildPredecessorEvidence({
      mode: 'legacy-flat-root',
      entries: [
        { key: 'index.json', body: Buffer.from('{}') },
        { key: 'tombstones.json', body: bytes },
        {
          key: '11/1/2.json',
          body: Buffer.from(JSON.stringify({ cameras: [{ id: 'osm:99' }] })),
        },
      ],
      deployment: { provider: 'cloudflare-r2', accountId: 'account', bucket: 'bucket' },
      capturedAt: '2026-09-01T20:05:00.000Z',
    });
    // Untagged, inside the pinned territory, and still standing as geometry.
    const untagged = {
      type: 'node',
      id: 99,
      version: 4,
      timestamp: '2026-09-01T19:30:00Z',
      visible: true,
      lat: 38.9183,
      lon: -94.692,
    };
    const fetchImpl = async (url) =>
      url.endsWith('state.txt')
        ? {
            ok: true,
            status: 200,
            url,
            text: async () => 'sequenceNumber=12\ntimestamp=2026-09-01T20\\:00\\:00Z\n',
          }
        : { ok: true, status: 200, url, json: async () => ({ elements: [untagged] }) };
    const result = await buildCutoverLedger({
      capture: { collection: { type: 'FeatureCollection', features: [] } },
      tombstoneLedger: { ...inherited, bytes, identity: releaseTombstoneIdentity(bytes, inherited) },
      predecessor,
      predecessorTombstoneBytes: bytes,
      geofenceBytes: readFileSync(DEFAULT_COUNTY_GEOFENCE),
      fetchImpl,
      now: () => new Date('2026-09-01T20:06:00.000Z'),
      transformCollection: () => ({ cameras: [], territorialCameras: [] }),
      loadTombstoneSequence: async () => [],
    });
    assert.deepEqual(result.entries, [
      { id: 'osm:99', reason: 'cutover_reconciliation', seq: 12, osmVersion: 4 },
    ]);
  });

  it('still refuses a tag map that is malformed rather than absent', async () => {
    const inherited = {
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      generatedAt: '2026-09-01T19:00:00.000Z',
      upstream: '2026-09-01T19:00:00Z',
      tombstones: [],
    };
    const bytes = Buffer.from(`${JSON.stringify(inherited)}\n`);
    const predecessor = buildPredecessorEvidence({
      mode: 'legacy-flat-root',
      entries: [
        { key: 'index.json', body: Buffer.from('{}') },
        { key: 'tombstones.json', body: bytes },
        {
          key: '11/1/2.json',
          body: Buffer.from(JSON.stringify({ cameras: [{ id: 'osm:99' }] })),
        },
      ],
      deployment: { provider: 'cloudflare-r2', accountId: 'account', bucket: 'bucket' },
      capturedAt: '2026-09-01T20:05:00.000Z',
    });
    const malformed = {
      type: 'node',
      id: 99,
      version: 4,
      timestamp: '2026-09-01T19:30:00Z',
      visible: true,
      lat: 38.9183,
      lon: -94.692,
      tags: ['man_made'],
    };
    const fetchImpl = async (url) =>
      url.endsWith('state.txt')
        ? {
            ok: true,
            status: 200,
            url,
            text: async () => 'sequenceNumber=12\ntimestamp=2026-09-01T20\\:00\\:00Z\n',
          }
        : { ok: true, status: 200, url, json: async () => ({ elements: [malformed] }) };
    await assert.rejects(
      buildCutoverLedger({
        capture: { collection: { type: 'FeatureCollection', features: [] } },
        tombstoneLedger: {
          ...inherited,
          bytes,
          identity: releaseTombstoneIdentity(bytes, inherited),
        },
        predecessor,
        predecessorTombstoneBytes: bytes,
        geofenceBytes: readFileSync(DEFAULT_COUNTY_GEOFENCE),
        fetchImpl,
        transformCollection: () => ({ cameras: [], territorialCameras: [] }),
        loadTombstoneSequence: async () => [],
      }),
      /malformed OSM tag map/,
    );
  });

  // A predecessor id names an element but not an element type. These three
  // cases fix what the node-only prover may conclude when the node namespace
  // has never held the id at all.
  const wayScenario = ({ tags, wayVisible = true, wayFound = true, nodes = [] }) => {
    const inherited = {
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      generatedAt: '2026-09-01T19:00:00.000Z',
      upstream: '2026-09-01T19:00:00Z',
      tombstones: [],
    };
    const bytes = Buffer.from(`${JSON.stringify(inherited)}\n`);
    const predecessor = buildPredecessorEvidence({
      mode: 'legacy-flat-root',
      entries: [
        { key: 'index.json', body: Buffer.from('{}') },
        { key: 'tombstones.json', body: bytes },
        {
          key: '11/1/2.json',
          body: Buffer.from(JSON.stringify({ cameras: [{ id: 'osm:77' }] })),
        },
      ],
      deployment: { provider: 'cloudflare-r2', accountId: 'account', bucket: 'bucket' },
      capturedAt: '2026-09-01T20:05:00.000Z',
    });
    const way = {
      type: 'way',
      id: 77,
      version: 4,
      timestamp: '2026-09-01T19:30:00Z',
      ...(wayVisible ? {} : { visible: false }),
      tags,
    };
    // Two member nodes whose mean sits on the Kansas side of the state line.
    const members = [
      {
        type: 'node',
        id: 1,
        lat: 38.8,
        lon: -94.91,
        version: 1,
        timestamp: '2026-01-01T00:00:00Z',
      },
      {
        type: 'node',
        id: 2,
        lat: 38.81,
        lon: -94.9,
        version: 1,
        timestamp: '2026-01-01T00:00:00Z',
      },
      way,
    ];
    const fetchImpl = async (url) => {
      if (url.endsWith('state.txt')) {
        return {
          ok: true,
          status: 200,
          url,
          text: async () => 'sequenceNumber=12\ntimestamp=2026-09-01T20\\:00\\:00Z\n',
        };
      }
      if (url.includes('/nodes.json')) {
        return nodes.length === 0
          ? { ok: false, status: 404, url }
          : { ok: true, status: 200, url, json: async () => ({ elements: nodes }) };
      }
      if (url.includes('/ways.json')) {
        return wayFound
          ? { ok: true, status: 200, url, json: async () => ({ elements: [way] }) }
          : { ok: false, status: 404, url };
      }
      if (url.includes('/full.json')) {
        return { ok: true, status: 200, url, json: async () => ({ elements: members }) };
      }
      throw new Error(`unexpected request ${url}`);
    };
    return {
      capture: { collection: { type: 'FeatureCollection', features: [] } },
      tombstoneLedger: {
        ...inherited,
        bytes,
        identity: releaseTombstoneIdentity(bytes, inherited),
      },
      predecessor,
      predecessorTombstoneBytes: bytes,
      geofenceBytes: readFileSync(DEFAULT_COUNTY_GEOFENCE),
      fetchImpl,
      now: () => new Date('2026-09-01T20:06:00.000Z'),
      transformCollection: () => ({ cameras: [], territorialCameras: [] }),
      loadTombstoneSequence: async () => [],
    };
  };

  it('refuses an id whose way is still a qualifying in-scope camera', async () => {
    await assert.rejects(
      buildCutoverLedger(
        wayScenario({ tags: { man_made: 'surveillance', 'surveillance:type': 'ALPR' } }),
      ),
      /osm:77 is still a qualifying in-scope camera mapped as an OSM way/,
    );
  });

  it('records a way that exists but does not qualify as osm_out_of_scope', async () => {
    const result = await buildCutoverLedger(wayScenario({ tags: { building: 'yes' } }));

    assert.deepEqual(result.entries, [
      { id: 'osm:77', reason: 'osm_out_of_scope', seq: 12, osmVersion: 4 },
    ]);
    assert.deepEqual(result.ledger.tombstones, result.entries);
  });

  it('refuses, naming both namespaces, when an id is absent from each', async () => {
    // The refusal is unchanged in strength and clearer in wording: the old
    // message said "omitted predecessor node", which is the one thing an id
    // the node namespace has never held is definitely not.
    await assert.rejects(
      buildCutoverLedger(wayScenario({ tags: { building: 'yes' }, wayFound: false })),
      /osm:77 is held by neither the node nor the way namespace/,
    );
  });
});
