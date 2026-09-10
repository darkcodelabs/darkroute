/** Public KanDrive / KC Scout and MoDOT equipment inventories. */
const MISSOURI = 'https://mapping.modot.mo.gov/arcgis/rest/services/TravelerInformation/NWSDATA/MapServer/0';
const canonicalCameraId = (id) => id.replace(/-LQ$/iu, '');

function missouriCameraId(value) {
  if (typeof value !== 'string') return null;
  const match = /^https:\/\/traveler\.modot\.org\/tisvc\/api\/Tms\/CameraStream\/([A-Za-z0-9_-]+)$/iu.exec(value);
  return match ? canonicalCameraId(match[1]) : null;
}

function duplicateCameraKey(record) {
  if (record.sourceId === 'missouri-traffic') {
    const match = /^missouri-traffic:\d+:([A-Za-z0-9_-]+)$/u.exec(record.id);
    return match ? canonicalCameraId(match[1]) : null;
  }
  if (record.sourceId === 'kansas-traffic' && typeof record.imageUrl === 'string') {
    const match = /^https:\/\/www\.kcscout\.net\/TransSuite\.VCS\.CameraSnapshots\/([A-Za-z0-9_-]+)\.jpg$/iu.exec(record.imageUrl);
    return match ? canonicalCameraId(match[1]) : null;
  }
  return null;
}

function kansasStill(views) {
  for (const view of views) {
    if (view?.type !== 'STILL_IMAGE' || typeof view.url !== 'string') continue;
    let url;
    try { url = new URL(view.url); } catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) continue;
    if ((url.hostname === 'www.kcscout.net' && /^\/TransSuite\.VCS\.CameraSnapshots\/[A-Za-z0-9_-]+\.jpg$/iu.test(url.pathname))
      || (url.hostname === 'kscam.carsprogram.org' && /^\/(?:snapshots\/)?[A-Za-z0-9_.&-]+\.jpe?g$/iu.test(url.pathname))) {
      return url.href;
    }
  }
  return null;
}

export function kcTrafficSources({ record, point }) {
  return [
    {
      id: 'kansas-traffic', name: 'Kansas and KC Scout traffic cameras', kind: 'traffic_camera',
      format: 'json', endpoint: 'https://kstg.carsprogram.org/cameras_v1/api/cameras',
      rows(data) {
        if (!Array.isArray(data)) throw new Error('Expected KanDrive camera inventory array');
        return data;
      },
      url: 'https://www.kandrive.gov/',
      attribution: 'Kansas Department of Transportation / KC Scout (KDOT and MoDOT) / listed camera operators',
      operator: 'Kansas Department of Transportation', licence: null,
      licenceUrl: 'https://www.kandrive.gov/help/tou.html',
      coverage: 'Kansas and the Kansas City metro on both sides of the state line, USA. Public KanDrive inventory includes KC Scout, KDOT, Kansas Turnpike Authority and local cameras. Only publisher-listed still images are linked; video-only cameras remain mapped. KC Scout images are subject to https://www.kcscout.net/UserLicense.aspx; preserve copyright and proprietary notices.',
      bounds: [-102.1, 36.9, -94.1, 40.1],
      normalize(p) {
        if (!p || !Number.isSafeInteger(p.id) || p.id < 0 || typeof p.public !== 'boolean') {
          throw new Error('Malformed KanDrive camera identifier or public flag');
        }
        if (!p.public) return null;
        if (!p.location || !Array.isArray(p.views)) throw new Error('Malformed KanDrive camera location or views');
        return record(this, p.id, [p.location.longitude, p.location.latitude], {
          name: p.name, road: p.location.routeId, operator: p.cameraOwner?.name,
          status: p.active === true ? 'active' : p.active === false ? 'inactive' : 'unknown',
          sourceUpdatedAt: p.lastUpdated, imageUrl: kansasStill(p.views),
        });
      },
    },
    {
      id: 'missouri-traffic', name: 'Missouri traffic cameras', kind: 'traffic_camera',
      format: 'arcgis', endpoint: MISSOURI,
      where: '1=1', duplicateOf: 'kansas-traffic', duplicateKey: duplicateCameraKey,
      fields: 'CAM_ID,DESCRIPTION,URL2,STREAM_ERROR',
      url: 'https://traveler.modot.org/', attribution: 'Missouri Department of Transportation',
      operator: 'MoDOT', licence: null, licenceUrl: MISSOURI,
      coverage: 'Missouri and the Kansas City metro on both sides of the state line, USA. MoDOT cameras with a matching KC Scout identifier in the actual KanDrive inventory are omitted; unmatched cameras remain mapped. Published video-stream errors do not establish hardware operating status. This source supplies video streams, so still-image links are unavailable.',
      bounds: [-95.9, 35.9, -89.0, 40.7],
      normalize(feature) {
        const p = feature?.properties;
        if (!p || !Number.isSafeInteger(p.CAM_ID) || p.CAM_ID < 0) throw new Error('Malformed MoDOT camera identifier');
        const cameraId = missouriCameraId(p.URL2);
        return record(this, cameraId ? `${p.CAM_ID}:${cameraId}` : p.CAM_ID, point(feature), {
          name: p.DESCRIPTION, road: p.DESCRIPTION,
        });
      },
    },
  ];
}
