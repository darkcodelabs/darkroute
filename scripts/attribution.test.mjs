/**
 * ODbL ATTRIBUTION TRAVELS WITH EVERY PUBLISHED EXTRACT.
 *
 * =============================================================================
 * WHY THIS IS A TEST AND NOT A CONVENTION
 * =============================================================================
 * `fetch-cameras.mjs` states the obligation plainly: the moment this project
 * holds a table derived from OpenStreetMap nodes, "Map data © OpenStreetMap
 * contributors" must appear on every surface that renders the points, and every
 * tile carries the string IN ITS OWN BODY "so it cannot be separated from the
 * data".
 *
 * That rule was kept in the tiles and in `index.json`, and missed in exactly
 * one place - `overview.json`, which is the LARGEST extract the project
 * publishes: 132,068 points behind a single public URL, shipped as
 * `{schema, count, coords}` with no notice at all.
 *
 * It is the wrong way round. Fetch one tile and you learn where the data came
 * from; fetch all of it and you learned nothing. The obligation attaches to the
 * extract regardless of its shape, and the bigger the extract the more clearly
 * it attaches.
 *
 * A comment would not have caught it, because a comment did not: the rule was
 * written down in `fetch-cameras.mjs` the whole time. So it is asserted against
 * the artifacts that actually ship.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { ATTRIBUTION, LICENCE, LICENCE_URL, buildCameraOverview } from './fetch-cameras.mjs';
import {
  OSM_ATTRIBUTION,
  OSM_LICENCE,
  OSM_LICENCE_URL,
  encodeResponseBundle,
  rawDatasetFromBodies,
} from './deflock-capture.mjs';

const ROOT = new URL('../apps/pwa/public/cameras/', import.meta.url);
const REPLICATION = JSON.parse(
  readFileSync(new URL('./camera-sync-state.json', import.meta.url), 'utf8'),
);

function read(name) {
  return JSON.parse(readFileSync(new URL(name, ROOT), 'utf8'));
}

/**
 * The checked legacy false-version snapshot predates the tombstone notice
 * migration. The later approved-data PR must install its true-version archive
 * and state together; that state activates this exact artifact assertion.
 */
const PUBLISHED = [
  'overview.json',
  'index.json',
  ...(REPLICATION.versionsKnown ? ['tombstones.json'] : []),
];

describe('published OSM extracts carry their own attribution', () => {
  it('the retained direct-capture GeoJSON embeds attribution and an ODbL URI', () => {
    const { collection } = rawDatasetFromBodies([], []);
    assert.equal(collection.attribution, OSM_ATTRIBUTION);
    assert.equal(collection.attribution, ATTRIBUTION);
    assert.equal(collection.licence, OSM_LICENCE);
    assert.equal(collection.licence, LICENCE);
    assert.equal(collection.licenceUrl, OSM_LICENCE_URL);
  });

  it('the retained response bundle embeds the same attribution and ODbL URI', () => {
    const decoded = gunzipSync(encodeResponseBundle([])).toString('utf8');
    assert.match(decoded, /Map data © OpenStreetMap contributors/);
    assert.match(decoded, /ODbL-1\.0/);
    assert.match(decoded, /opendatacommons\.org\/licenses\/odbl\/1-0/);
  });
  it('new published camera bodies embed the exact ODbL URI', () => {
    assert.equal(buildCameraOverview([]).licenceUrl, LICENCE_URL);
    assert.equal(LICENCE_URL, OSM_LICENCE_URL);
  });
  for (const name of PUBLISHED) {
    it(`${name} names OpenStreetMap in its own body`, () => {
      const doc = read(name);
      assert.equal(
        doc.attribution,
        ATTRIBUTION,
        `${name} must carry the attribution string, not rely on a sibling file for it`,
      );
      assert.equal(doc.licence, LICENCE, `${name} must name the licence it is published under`);
      if (REPLICATION.versionsKnown) {
        assert.equal(doc.licenceUrl, LICENCE_URL, `${name} must embed the exact ODbL URI`);
      }
    });
  }

  it('the overview still holds the points, so this did not fix the notice by emptying the file', () => {
    // A guard against the cheapest way to make the assertion above pass.
    const doc = read('overview.json');
    assert.ok(Array.isArray(doc.coords), 'coords must still be an array');
    assert.ok(doc.count > 100_000, `expected the full extract, got ${String(doc.count)}`);
    assert.equal(
      doc.coords.length,
      doc.count * 2,
      'coords is a flat lat,lon pair list, so its length is twice the count',
    );
  });

  it('the reader in MapCanvas keeps working, because nothing was renamed', () => {
    // `MapCanvas.tsx` reads `coords` and ignores everything else. Adding keys is
    // safe; renaming or bumping `schema` would strand caches for no reason.
    const doc = read('overview.json');
    assert.equal(doc.schema, 'fwm-overview/v1');
    assert.ok('coords' in doc);
  });
});
