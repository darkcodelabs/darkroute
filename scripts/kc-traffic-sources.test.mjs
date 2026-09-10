import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MONITORING_SOURCES } from './road-monitoring-sources.mjs';
import { fetchMonitoringSource } from './build-road-monitoring.mjs';

const kansas = () => MONITORING_SOURCES.find((source) => source.id === 'kansas-traffic');
const missouri = () => MONITORING_SOURCES.find((source) => source.id === 'missouri-traffic');
const camera = {
  id: 2370, public: true, name: 'US-69 SB at I-435', lastUpdated: 1789053434787,
  location: { latitude: 38.934603, longitude: -94.705459, routeId: 'US-69' },
  cameraOwner: { name: 'KC Scout' }, active: true,
  views: [{ type: 'STILL_IMAGE', url: 'https://www.kcscout.net/TransSuite.VCS.CameraSnapshots/K069SBC-22.jpg' }],
};

describe('Kansas City and Missouri traffic-camera sources', () => {
  it('collects the public KC Scout still and stable ID without downloading imagery', async () => {
    const calls = [];
    const result = await fetchMonitoringSource(kansas(), async (url) => {
      calls.push(url);
      return Response.json([camera]);
    });
    assert.deepEqual(calls, [kansas().endpoint]);
    assert.equal(result.records[0].id, 'kansas-traffic:2370');
    assert.equal(result.records[0].imageUrl, camera.views[0].url);
    assert.equal(result.records[0].operator, 'KC Scout');
    assert.equal(result.records[0].lat, 38.934603);
    assert.equal(result.records[0].sourceUpdatedAt, '2026-09-10T15:17:14.787Z');
  });

  it('keeps video-only equipment and rejects stale legacy, untrusted and nonimage links', () => {
    for (const url of [
      'https://www.kcscout.net/mapsubsystem/snapshots/K069SBC-22.jpg',
      'https://other.example/camera.jpg',
      'https://www.kcscout.net/TransSuite.VCS.CameraSnapshots/K069SBC-22.jpg?redirect=x',
      'http://www.kcscout.net/TransSuite.VCS.CameraSnapshots/K069SBC-22.jpg',
      'https://kdot-sfs3.us-east-1.skyvdn.com/camera.m3u8',
    ]) {
      assert.equal(kansas().normalize({ ...camera, views: [{ type: 'STILL_IMAGE', url }] }).imageUrl, null);
    }
    assert.equal(kansas().normalize({ ...camera, views: [{ type: 'WMP', url: camera.views[0].url }] }).imageUrl, null);
    const url = 'https://kscam.carsprogram.org/snapshots/GEN_5-015-0731-2-K-15&MACARTHURRD.jpeg';
    assert.equal(kansas().normalize({ ...camera, views: [{ type: 'STILL_IMAGE', url }] }).imageUrl, url);
  });

  it('excludes nonpublic records and fails malformed or out-of-coverage inventories', async () => {
    assert.equal(kansas().normalize({ ...camera, public: false }), null);
    assert.throws(() => kansas().normalize({ ...camera, public: undefined }), /Malformed/);
    assert.throws(() => kansas().normalize({ ...camera, id: '2370' }), /Malformed/);
    assert.throws(() => kansas().normalize({ ...camera, location: { longitude: 0, latitude: 0 } }), /Coordinates/);
    await assert.rejects(fetchMonitoringSource(kansas(), async () => Response.json({ cameras: [camera] })), /array/);
  });

  it('keeps MoDOT video errors unknown and retains unmatched KC Scout equipment', () => {
    const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [-90.2, 38.6] },
      properties: { CAM_ID: 501, DESCRIPTION: 'I-64 at Kingshighway', STREAM_ERROR: 'Y',
        URL2: 'https://sfs02-traveler.modot.mo.gov/rtplive/camera.stream/playlist.m3u8' } };
    const row = missouri().normalize(feature);
    assert.equal(row.id, 'missouri-traffic:501');
    assert.equal(row.status, 'unknown');
    assert.equal(row.imageUrl, null);
    const unmatched = missouri().normalize({ ...feature, properties: { ...feature.properties, CAM_ID: 6160,
      DESCRIPTION: 'US-50 EB AT HARRIS RD',
      URL2: 'https://traveler.modot.org/tisvc/api/Tms/CameraStream/M050EBC-08-LQ' } });
    assert.equal(unmatched.id, 'missouri-traffic:6160:M050EBC-08');
    assert.equal(unmatched.name, 'US-50 EB AT HARRIS RD');
    assert.equal(unmatched.imageUrl, null);
    assert.equal(missouri().duplicateKey(unmatched), 'M050EBC-08');
    assert.equal(missouri().duplicateKey(row), null);
    assert.equal(missouri().where, '1=1');
  });

  it('matches only actual published KC Scout IDs across the two inventories', () => {
    const scout = kansas().normalize(camera);
    const same = missouri().normalize({ type: 'Feature', geometry: { type: 'Point', coordinates: [-94.705459, 38.934603] },
      properties: { CAM_ID: 4277, DESCRIPTION: 'US-69 SB at I-435',
        URL2: 'https://traveler.modot.org/tisvc/api/Tms/CameraStream/K069SBC-22-LQ' } });
    assert.equal(missouri().duplicateOf, scout.sourceId);
    assert.equal(missouri().duplicateKey(same), missouri().duplicateKey(scout));
    assert.equal(missouri().duplicateKey({ ...scout,
      imageUrl: 'https://www.kcscout.net/TransSuite.VCS.CameraSnapshots/K069SBC-22-LQ.jpg' }), 'K069SBC-22');
    assert.notEqual(missouri().duplicateKey({ ...scout,
      imageUrl: 'https://www.kcscout.net/TransSuite.VCS.CameraSnapshots/k069sbc-22.jpg' }), missouri().duplicateKey(scout));
    assert.equal(missouri().duplicateKey({ ...scout, imageUrl: null }), null);
    assert.equal(missouri().duplicateKey({ ...scout, imageUrl: 'https://unrelated.example/K069SBC-22.jpg' }), null);
    assert.equal(missouri().duplicateKey({ ...scout, sourceId: 'unrelated' }), null);
  });
});
