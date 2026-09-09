/**
 * THE PINNED CONTEXT INPUT: what the receipt binds, what a record receives,
 * and how a street sign abbreviates.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { abbreviate } from './build-camera-context.mjs';
import {
  applyContext,
  isReleaseContextIdentity,
  loadReleaseContext,
  releaseContextIdentity,
  releaseContextPlaces,
} from './fetch-cameras.mjs';

const DOC = {
  schema: 'darkroute-camera-context/v1',
  generatedAt: '2026-09-09T17:20:39.480Z',
  basemap: { name: 'basemap.pmtiles', bytes: 1, sha256: 'a'.repeat(64), zoom: 14 },
  places: { vintage: 'cb_2023_us_place_500k', shpSha256: 'b'.repeat(64), dbfSha256: 'c'.repeat(64) },
  cameras: 3,
  streets: ['W 95th St', 'Santa Fe Trail Dr'],
  localities: [
    { name: 'Overland Park', kind: 'place', geoid: '2053775', lsad: '25', stateFips: '20' },
    { name: 'Johnson County', kind: 'county', geoid: '20091', lsad: 'County', stateFips: '20' },
  ],
  rows: { 'osm:1': [0, 1, 4, 0], 'osm:2': [1, -1, 310, 1], 'osm:3': [-1, -1, -1, 1] },
};
const bytes = Buffer.from(JSON.stringify(DOC));

describe('the release context identity', () => {
  it('names the bytes and the basemap they came from', () => {
    const identity = releaseContextIdentity(bytes);
    assert.equal(identity.path, 'scripts/data/camera-context.json');
    assert.equal(identity.bytes, bytes.length);
    assert.equal(identity.cameras, 3);
    assert.equal(identity.basemapSha256, 'a'.repeat(64));
    assert.equal(isReleaseContextIdentity(identity), true);
    assert.equal(isReleaseContextIdentity({ ...identity, path: 'elsewhere' }), false);
  });

  it('refuses bytes that are not the pinned ones', () => {
    const pinned = releaseContextIdentity(bytes);
    const other = Buffer.from(JSON.stringify({ ...DOC, generatedAt: '2026-09-10T00:00:00.000Z' }));
    assert.throws(() => loadReleaseContext(other, pinned), /does not match the identity/);
  });

  it('refuses a document that miscounts its rows or carries an empty name', () => {
    assert.throws(
      () => releaseContextIdentity(Buffer.from(JSON.stringify({ ...DOC, cameras: 2 }))),
      /reviewed shape/,
    );
    assert.throws(
      () => releaseContextIdentity(Buffer.from(JSON.stringify({ ...DOC, streets: ['', 'x'] }))),
      /reviewed shape/,
    );
  });
});

describe('applying the context to a record', () => {
  const context = loadReleaseContext(bytes, releaseContextIdentity(bytes));
  it('copies street, cross, distance and locality where the row has them', () => {
    assert.deepEqual(applyContext({ id: 'osm:1', lat: 1, lon: 2 }, context), {
      id: 'osm:1',
      lat: 1,
      lon: 2,
      street: 'W 95th St',
      cross: 'Santa Fe Trail Dr',
      streetM: 4,
      locality: 'Overland Park',
      placeGeoid: '2053775',
    });
  });
  it('leaves out what the row does not have, and never invents a street', () => {
    assert.deepEqual(applyContext({ id: 'osm:2' }, context), {
      id: 'osm:2',
      street: 'Santa Fe Trail Dr',
      streetM: 310,
      locality: 'Johnson County',
    });
    assert.deepEqual(applyContext({ id: 'osm:3' }, context), { id: 'osm:3', locality: 'Johnson County' });
    assert.deepEqual(applyContext({ id: 'osm:9' }, context), { id: 'osm:9' });
  });
});

describe('the place rows the context yields', () => {
  it('lists each Census place once with its count, and never a county', () => {
    assert.deepEqual(releaseContextPlaces(bytes), [
      { geoid: '2053775', name: 'Overland Park', label: 'OVERLAND PARK', lsad: '25', stateFips: '20', cameras: 1 },
    ]);
  });
});

describe('abbreviating a road name the way a sign does', () => {
  it('shortens directions and suffixes and leaves everything else', () => {
    assert.equal(abbreviate('West 95th Street'), 'W 95th St');
    assert.equal(abbreviate('Santa Fe Trail Drive'), 'Santa Fe Trail Dr');
    assert.equal(abbreviate('Shawnee Mission Parkway'), 'Shawnee Mission Pkwy');
    assert.equal(abbreviate('Kamehameha Highway'), 'Kamehameha Hwy');
    assert.equal(abbreviate('Broadway'), 'Broadway');
    assert.equal(abbreviate('Avenue A'), 'Avenue A');
    assert.equal(abbreviate('North Avenue Northeast'), 'N Ave NE');
  });
});
