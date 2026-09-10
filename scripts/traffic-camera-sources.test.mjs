import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MONITORING_SOURCES } from './road-monitoring-sources.mjs';
import { fetchMonitoringSource } from './build-road-monitoring.mjs';

const findSource = (id) => {
  const source = MONITORING_SOURCES.find((entry) => entry.id === id);
  assert.ok(source, `${id} must be registered`);
  return source;
};
const feature = (coordinates, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties });
const austin = {
  camera_id: '1', location_name: '830 BLK W RUNDBERG LN', camera_status: 'TURNED_ON',
  primary_st: 'RUNDBERG LN', modified_date: '2023-07-18T20:45:00.000Z',
  screenshot_address: 'https://cctv.austinmobility.io/image/1.jpg',
  location: { type: 'Point', coordinates: [-97.698158, 30.363686] },
};
const iowa = feature([-95.935793, 41.346072], {
  FID: 756875, device_id: 59613872, Desc_: 'CB - I-680 @ MM 1.1 (130th St)', Route: 'I-680', Type: 'Iowa DOT',
  ImageURL: 'https://atmsqf.iowadot.gov/SNAPSHOTS/PUBLIC/Metro/cbtv74hd.jpeg',
});
const washington = feature([-122.33955, 47.58386], {
  OBJECTID: 1003, CameraTitle: 'SR-99 @ S Walker St',
  ImageURL: 'https://images.wsdot.wa.gov/nw/099vc02969.jpg', CompassDirection: 'N',
});

describe('additional official traffic camera inventories', () => {
  it('uses Austin camera IDs and preserves unknown operational health independently of construction status', () => {
    const source = findSource('austin-traffic');
    const row = source.normalize(austin);
    assert.equal(row.id, 'austin-traffic:1');
    assert.equal(row.status, 'unknown');
    assert.equal(row.sourceUpdatedAt, austin.modified_date);
    assert.equal(row.imageUrl, austin.screenshot_address);
    assert.equal(row.lat, 30.363686);
    for (const camera_status of ['DESIRED', 'VOID', 'REMOVED']) {
      assert.equal(source.normalize({ ...austin, camera_status }), null);
    }
    assert.equal(source.normalize({ ...austin, camera_status: 'UNRECOGNIZED' }).status, 'unknown');
    assert.throws(() => source.normalize({ ...austin, location: null }), /point geometry/);
  });

  it('reads all Austin rows before removing proposals and retired locations', async () => {
    const source = findSource('austin-traffic');
    const rows = [austin, ...['DESIRED', 'VOID', 'REMOVED'].map((camera_status, index) => ({ ...austin, camera_id: String(index + 2), camera_status }))];
    const result = await fetchMonitoringSource(source, async (url) => {
      if (url === source.metadata) return Response.json({ rowsUpdatedAt: 1788591349 });
      const params = new URL(url).searchParams;
      if (params.has('$select')) return Response.json([{ count: '4' }]);
      assert.equal(params.get('$limit'), '4');
      return Response.json(rows);
    });
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].id, 'austin-traffic:1');
  });

  it('uses stable Iowa device IDs rather than rotating GIS object IDs and excludes other categories', () => {
    const source = findSource('iowa-traffic');
    const row = source.normalize(iowa);
    assert.equal(row.id, 'iowa-traffic:59613872');
    assert.equal(row.status, 'unknown');
    assert.equal(row.road, 'I-680');
    assert.equal(row.imageUrl, iowa.properties.ImageURL);
    assert.equal(source.normalize({ ...iowa, properties: { ...iowa.properties, FID: 999999 } }).id, row.id);
    assert.throws(() => source.normalize({ ...iowa, properties: { ...iowa.properties, Type: 'RWIS' } }), /category/);
    const external = source.normalize({ ...iowa, properties: { ...iowa.properties, ImageURL: 'https://public.carsprogram.org/cameras/IA/example.png' } });
    assert.equal(external.id, row.id);
    assert.equal(external.imageUrl, null);
  });

  it('retains Washington camera identity, direction and uncertain health, including border locations', () => {
    const source = findSource('wsdot-traffic');
    const row = source.normalize(washington);
    assert.equal(row.id, 'wsdot-traffic:1003');
    assert.equal(row.direction, 'N');
    assert.equal(row.status, 'unknown');
    assert.equal(row.imageUrl, washington.properties.ImageURL);
    const rawImage = ['https://images.wsdot.wa.gov/rweather/Medium_HorseHeaven', 'I-82.jpg'].join('@');
    const encoded = source.normalize({ ...washington, properties: { ...washington.properties, ImageURL: rawImage } });
    assert.equal(encoded.imageUrl, 'https://images.wsdot.wa.gov/rweather/Medium_HorseHeaven%40I-82.jpg');
    const border = source.normalize({ ...washington, geometry: { type: 'Point', coordinates: [-122.75, 49.002251] } });
    assert.equal(border.lat, 49.002251);
    assert.throws(() => source.normalize({ ...washington, geometry: { type: 'Point', coordinates: [0, 0] } }), /outside/);
  });

  it('sends the same documented roadway scope on the Washington count and page requests', async () => {
    const source = findSource('wsdot-traffic');
    assert.match(source.coverage, /Partial scope/);
    assert.ok(!source.where.includes('/airports/') && !source.where.includes('/wsf/'));
    await fetchMonitoringSource(source, async (url) => {
      const params = new URL(url).searchParams;
      if (!new URL(url).pathname.endsWith('/query')) return Response.json({ objectIdField: 'OBJECTID', maxRecordCount: 2000 });
      assert.equal(params.get('where'), source.where);
      if (params.has('returnCountOnly')) return Response.json({ count: 1 });
      return Response.json({ type: 'FeatureCollection', features: [washington] });
    });
  });
});
