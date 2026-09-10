/** Official equipment inventories only. No images, Bluetooth identifiers or vehicle observations. */
import { createHash } from 'node:crypto';

const text = (value) => value == null ? null : String(value).replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 1000) || null;
export const iso = (value) => {
  if (value == null || value === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const key = (...values) => createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 24);
const point = (feature) => {
  if (feature?.geometry?.type !== 'Point') throw new Error('Expected point geometry');
  return feature.geometry.coordinates;
};
function record(source, id, coordinates, values) {
  const [lon, lat] = coordinates.map(Number);
  const [west, south, east, north] = source.bounds;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lon < west || lon > east || lat < south || lat > north) {
    throw new Error(`Coordinates outside ${source.id} coverage`);
  }
  if (id == null || id === '') throw new Error('Missing equipment identifier');
  return {
    id: `${source.id}:${id}`, sourceId: source.id, kind: source.kind,
    lat, lon, name: text(values.name) ?? `${source.name} ${id}`,
    operator: text(values.operator ?? source.operator), road: text(values.road),
    direction: text(values.direction)?.slice(0, 200) ?? null,
    status: values.status ?? 'unknown', sourceUrl: source.url,
    sourceUpdatedAt: iso(values.sourceUpdatedAt), imageUrl: text(values.imageUrl),
  };
}

const OP = 'https://maps.opkansas.org/mapping/rest/services/MapViewer/Traffic_Cameras/MapServer/0';
const YORK = 'https://ww8.yorkmaps.ca/arcgis/rest/services/OpenData/Traffic/MapServer/2';
const ACT = 'https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services/ACTGOV_Bluetooth_Detector_Assets/FeatureServer/1';
const FDOT = 'https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/eTraffic_Exhibit_A_Devices_Public/FeatureServer/0';
const NY = 'https://services2.arcgis.com/gubH6kG9JCAsMX2M/arcgis/rest/services/NY_State_Thruway_Toll_Gantries/FeatureServer/0';
const DELDOT = 'https://enterprise.firstmap.delaware.gov/arcgis/rest/services/Transportation/DE_Boundary_and_Point/FeatureServer/25';

export const MONITORING_SOURCES = [
  {
    id: 'delaware-bluetooth', name: 'Delaware Bluetooth detectors', kind: 'bluetooth_sensor',
    format: 'arcgis', endpoint: DELDOT, where: '1=1',
    fields: 'OBJECTID,PERMITNUM,STATUS,DEVICE_TYPE,SYSTEM_STATUS,LOCATION,PUBLIC_NAME,OWNER',
    url: DELDOT, attribution: 'DelDOT / Delaware FirstMap', operator: 'DelDOT',
    licence: null, licenceUrl: 'https://delaware.gov/topics/data.shtml',
    coverage: 'Delaware and adjoining Maryland roads, USA. Publisher-listed Bluetooth detector locations and operating status; no individual verification date or mobility flag is supplied.',
    bounds: [-76.3, 38.4, -75, 39.9],
    normalize(feature) {
      const p = feature.properties;
      if (String(p.DEVICE_TYPE).trim().toUpperCase() !== 'BLUETOOTH DETECTOR') throw new Error('Unexpected Delaware device type');
      const status = String(p.STATUS).trim().toUpperCase();
      if (['REMOVED', 'RETIRED', 'DECOMMISSIONED'].includes(status)) return null;
      const system = String(p.SYSTEM_STATUS).trim().toUpperCase();
      return record(this, p.PERMITNUM, point(feature), { name: p.PUBLIC_NAME ?? p.LOCATION, road: p.LOCATION,
        operator: p.OWNER, status: status !== 'EXISTING' ? 'unknown' : system === 'ONLINE' ? 'active' : system === 'OFFLINE' ? 'inactive' : 'unknown' });
    },
  },
  {
    id: 'overland-park-traffic', name: 'Overland Park traffic cameras', kind: 'traffic_camera',
    format: 'arcgis', endpoint: OP, fields: 'OBJECTID,DisplayId,Attribute7', where: '1=1',
    url: 'https://maps.opkansas.org/traffic-cameras-map/',
    attribution: 'City of Overland Park', operator: 'City of Overland Park',
    licence: null, licenceUrl: 'https://maps.opkansas.org/mapping/rest/services/MapViewer/Traffic_Cameras/MapServer/info/iteminfo',
    coverage: 'Overland Park, Kansas, USA', bounds: [-94.8, 38.75, -94.5, 39.15],
    normalize(feature) {
      const p = feature.properties;
      return record(this, p.OBJECTID, point(feature), { name: p.DisplayId, road: p.DisplayId, imageUrl: p.Attribute7 });
    },
  },
  {
    id: 'york-bluetooth', name: 'York Region Bluetooth sensors', kind: 'bluetooth_sensor',
    format: 'arcgis', endpoint: YORK, fields: 'OBJECTID,FACILITYID,READERID', where: '1=1',
    url: YORK, attribution: 'The Regional Municipality of York', operator: 'York Region',
    licence: 'York Region Open Data Licence', licenceUrl: 'https://www.arcgis.com/sharing/rest/content/items/78cc02388af248c0b7a30eda6adfade0/data',
    coverage: 'York Region, Toronto metro, Ontario, Canada. Publisher lists these sensors as active; individual devices are not polled.',
    bounds: [-80.2, 43.6, -79.1, 44.7],
    normalize(feature) {
      const p = feature.properties;
      return record(this, p.OBJECTID, point(feature), { name: p.READERID ?? p.FACILITYID, status: 'active' });
    },
  },
  {
    id: 'act-bluetooth', name: 'ACT Bluetooth detector assets', kind: 'bluetooth_sensor',
    format: 'arcgis', endpoint: ACT, where: '1=1',
    fields: 'ASSET_ID,ASSET_SUB_TYPE,ASSET_NAME,LOCATION,SUBURB,OWNERSHIP,MAINTAINED_BY,LAST_EDITED_DATE',
    url: ACT, attribution: '© Australian Capital Territory', operator: null,
    licence: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    coverage: 'Canberra, Australian Capital Territory, Australia. Mapped inventory is incomplete; operating status is not reported.',
    bounds: [148.7, -35.96, 149.4, -35.1],
    normalize(feature) {
      const p = feature.properties;
      return record(this, p.ASSET_ID, point(feature), { name: p.ASSET_NAME, road: p.LOCATION,
        operator: p.OWNERSHIP, sourceUpdatedAt: p.LAST_EDITED_DATE });
    },
  },
  {
    id: 'florida-probe', name: 'Florida travel-time probe sensors', kind: 'probe_sensor',
    format: 'arcgis', endpoint: FDOT, where: "SigDes1='PDDS' OR SigDes2='Probe Data Detection System'",
    fields: 'GlobalID,Status,County,City,MainAgen,OnStreet,AtStreet,last_edited_date,FlagForRemoval,LocationDescription',
    url: FDOT, attribution: 'Florida Department of Transportation, public eTraffic device inventory', operator: null,
    licence: null, licenceUrl: 'https://www.arcgis.com/home/item.html?id=671e9ef954284e5f8028c021c06b5a49',
    coverage: 'Florida, USA. Probe-detection equipment; underlying technology is unspecified. Records flagged for removal are excluded.',
    bounds: [-87.7, 24.2, -79.7, 31.2],
    normalize(feature) {
      const p = feature.properties;
      if (String(p.FlagForRemoval).toLowerCase() === 'yes') return null;
      const state = String(p.Status).toLowerCase();
      return record(this, p.GlobalID, point(feature), { name: p.LocationDescription ?? p.OnStreet,
        road: p.OnStreet, operator: p.MainAgen, sourceUpdatedAt: p.last_edited_date,
        status: state === 'active' ? 'active' : state === 'inactive' ? 'inactive' : 'unknown' });
    },
  },
  ...['speed', 'red-light'].map((type) => {
    const dataset = type === 'speed' ? '4i42-qv3h' : 'thvf-6diy';
    return {
      id: `chicago-${type}`, name: `Chicago ${type} cameras`, kind: type === 'speed' ? 'speed_camera' : 'red_light_camera',
      format: 'socrata', endpoint: `https://data.cityofchicago.org/resource/${dataset}.json`,
      metadata: `https://data.cityofchicago.org/api/views/${dataset}.json`,
      url: `https://data.cityofchicago.org/d/${dataset}`, attribution: 'City of Chicago', operator: 'City of Chicago',
      licence: null, licenceUrl: 'https://www.chicago.gov/city/en/narr/foia/data_disclaimer.html',
      coverage: 'Chicago, Illinois, USA. Location inventory; individual operating status is not reported.',
      bounds: [-88, 41.5, -87.4, 42.1],
      normalize(p) {
        return record(this, p.id ?? key(p.intersection, p.first_approach, p.second_approach), [p.longitude, p.latitude], {
          name: p.address ?? p.intersection, road: p.address ?? p.intersection,
          direction: [p.first_approach, p.second_approach].filter(Boolean).join(' / '),
        });
      },
    };
  }),
  ...Array.from({ length: 12 }, (_, index) => {
    const district = index + 1;
    return {
      id: `caltrans-d${district}`, name: `Caltrans District ${district} traffic cameras`, kind: 'traffic_camera',
      format: 'caltrans', endpoint: `https://cwwp2.dot.ca.gov/data/d${district}/cctv/cctvStatusD${String(district).padStart(2, '0')}.json`,
      url: 'https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm',
      attribution: 'California Department of Transportation', operator: 'Caltrans',
      licence: 'Caltrans Conditions of Use', licenceUrl: 'https://dot.ca.gov/conditions-of-use',
      coverage: `California state highways, District ${district}, USA. Traffic CCTV; plate recognition is not established by this inventory.`,
      bounds: [-124.6, 32.3, -113.9, 42.1],
      normalize(raw) {
        const p = raw.cctv;
        if (p?.location == null) throw new Error('Malformed Caltrans camera');
        const location = p.location;
        return record(this, key(location.locationName, location.route, location.direction), [location.longitude, location.latitude], {
          name: location.locationName, road: location.route, direction: location.direction,
          status: String(p.inService) === 'true' ? 'active' : String(p.inService) === 'false' ? 'inactive' : 'unknown',
          sourceUpdatedAt: Number(p.recordTimestamp?.recordEpoch) > 0 ? Number(p.recordTimestamp.recordEpoch) * 1000 : null,
          imageUrl: p.imageData?.static?.currentImageURL,
        });
      },
    };
  }),
  {
    id: 'ny-thruway-tolls', name: 'New York Thruway toll gantries', kind: 'toll_reader',
    format: 'arcgis', endpoint: NY, fields: 'OBJECTID,NAME,ROAD,TOLL_TYPE', where: '1=1',
    url: 'https://data.ny.gov/Transportation/Thruway-Toll-Gantries/pfuu-4nqq',
    attribution: 'New York State Thruway Authority', operator: 'New York State Thruway Authority',
    licence: null, licenceUrl: 'https://data.ny.gov/Transportation/Thruway-Toll-Gantries/pfuu-4nqq',
    coverage: 'New York State Thruway, USA. Inventory last edited in 2023; one point may represent gantries in both directions. Operating status is not reported.',
    bounds: [-80, 40.4, -73.1, 45.1],
    normalize(feature) {
      const p = feature.properties;
      return record(this, p.OBJECTID, point(feature), { name: p.NAME, road: p.ROAD });
    },
  },
];
