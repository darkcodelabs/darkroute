/** Official roadway CCTV inventories; camera availability is not polled here. */
const IOWA = 'https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Traffic_Cameras_View/FeatureServer/0';
const WSDOT = 'https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer/0';
const WSDOT_ROAD_DIRS = ['nw', 'sw', 'orflow', 'rweather', 'spokane', 'nc', 'sc'];
const IOWA_IMAGE = /^https:\/\/atmsqf\.iowadot\.gov\/snapshots\/public\/(?:metro|wwd|rural)\/[a-z0-9_.-]+\.(?:jpg|jpeg)$/iu;

export function additionalTrafficSources({ record, point }) {
  return [
    {
      id: 'austin-traffic', name: 'Austin traffic cameras', kind: 'traffic_camera',
      format: 'socrata', endpoint: 'https://data.austintexas.gov/resource/b4k4-adkb.json',
      metadata: 'https://data.austintexas.gov/api/views/b4k4-adkb.json',
      url: 'https://data.austintexas.gov/Transportation-and-Mobility/Traffic-Cameras/b4k4-adkb',
      attribution: 'City of Austin, Texas', operator: 'Austin Transportation and Public Works',
      licence: 'Public Domain', licenceUrl: 'https://data.austintexas.gov/api/views/b4k4-adkb.json',
      coverage: 'Austin, Texas, USA. Daily traffic-camera inventory. Desired, void and removed installations are excluded. The published construction status does not establish current camera operation.',
      bounds: [-98.2, 29.9, -97.3, 30.8],
      normalize(p) {
        // Desired and void entries are proposals, not deployed camera locations.
        if (['DESIRED', 'VOID', 'REMOVED'].includes(String(p.camera_status).trim().toUpperCase())) return null;
        return record(this, p.camera_id, point({ geometry: p.location }), {
          name: p.location_name, road: [p.primary_st, p.cross_st].filter(Boolean).join(' / '),
          sourceUpdatedAt: p.modified_date, imageUrl: p.screenshot_address,
        });
      },
    },
    {
      id: 'iowa-traffic', name: 'Iowa DOT traffic cameras', kind: 'traffic_camera',
      format: 'arcgis', endpoint: IOWA, where: "Type = 'Iowa DOT'",
      fields: 'FID,device_id,Desc_,Route,Type,ImageURL',
      url: 'https://www.arcgis.com/home/item.html?id=c4063f200a7b4da5826e2ac86c677cf5',
      attribution: 'Iowa Department of Transportation', operator: 'Iowa DOT',
      licence: 'CC BY 4.0; Iowa DOT GIS Data Terms of Use',
      licenceUrl: 'https://www.arcgis.com/sharing/rest/content/items/c4063f200a7b4da5826e2ac86c677cf5?f=json',
      coverage: 'Iowa, USA. Daily inventory of the publisher-designated Iowa DOT traffic CCTV category; RWIS and rest-area/parking camera categories are excluded. Individual operating status is not reported. Previews are limited to official Iowa DOT image hosting.',
      bounds: [-96.7, 40.3, -90.1, 43.6],
      normalize(feature) {
        const p = feature.properties;
        if (p.Type !== 'Iowa DOT') throw new Error('Unexpected Iowa camera category');
        return record(this, p.device_id, point(feature), {
          name: p.Desc_, road: p.Route,
          imageUrl: typeof p.ImageURL === 'string' && IOWA_IMAGE.test(p.ImageURL) ? p.ImageURL : null,
        });
      },
    },
    {
      id: 'wsdot-traffic', name: 'Washington roadway cameras', kind: 'traffic_camera',
      format: 'arcgis', endpoint: WSDOT,
      where: WSDOT_ROAD_DIRS.map((directory) => `LOWER(ImageURL) LIKE 'https://images.wsdot.wa.gov/${directory}/%'`).join(' OR '),
      fields: 'OBJECTID,CameraTitle,ImageURL,CompassDirection',
      url: WSDOT, attribution: 'Washington State Department of Transportation', operator: 'WSDOT',
      licence: null, licenceUrl: WSDOT,
      coverage: 'Washington state highways and adjoining border roads, USA. Partial scope: WSDOT-hosted roadway and road-weather image directories only; airport, ferry and external-host cameras are excluded. Individual operating status is not reported.',
      bounds: [-124.9, 45.4, -116.8, 49.1],
      normalize(feature) {
        const p = feature.properties;
        const image = new URL(p.ImageURL);
        // Encode literal at-signs in publisher filenames as path data.
        image.pathname = image.pathname.replaceAll('@', '%40');
        return record(this, p.OBJECTID, point(feature), {
          name: p.CameraTitle, direction: p.CompassDirection, imageUrl: image.href,
        });
      },
    },
  ];
}
