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
});
