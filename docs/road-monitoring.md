# Road monitoring

For the other public datasets, complete download links and separate record
counts, see the [data inventory](data-inventory.md).

Layers on the map display published traffic CCTV, red-light and speed
enforcement cameras, Bluetooth detectors, travel-time probe sensors, toll
gantries and radar sensors. Every category is on by default and has its own
switch. Existing installations enable all categories once when upgraded;
later per-category choices are saved. These inventories stay separate from
ALPR camera records, exposure totals, alerts and route avoidance.

With the default layers enabled, inventory metadata loads automatically while
the map is visible. Camera photos are requested only when a camera is opened.

Open a point for its operator, source, available dates and publisher-reported
status. Nearby ALPR counts use camera records already loaded on the device.
Proximity can help compare inventories; it does not establish that two records
are the same device or that their operators share data. An empty area means no
locations are included in these inventories, not that no monitoring exists.

## Current coverage

Counts below describe the expanded September 10, 2026 import. The live inventory and API
provide current counts and dates for each source.

| Publisher | Equipment | Locations |
| --- | --- | ---: |
| [Overland Park](https://maps.opkansas.org/traffic-cameras-map/) | Traffic cameras | 85 |
| [Caltrans, all 12 districts](https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm) | Traffic CCTV | 3,554 |
| [KanDrive / KC Scout](https://www.kandrive.gov/) | Kansas and Kansas City traffic cameras | 608 |
| [MoDOT](https://traveler.modot.org/) | Missouri and unmatched KC Scout traffic cameras | 569 |
| [Austin](https://data.austintexas.gov/d/b4k4-adkb) | Deployed traffic cameras | 817 |
| [Iowa DOT](https://511ia.org/) | Iowa DOT roadway traffic cameras | 735 |
| [WSDOT](https://wsdot.com/Travel/Real-time/Map/) | Roadway traffic cameras | 1,484 |
| [Chicago](https://data.cityofchicago.org/d/thvf-6diy) | Red-light camera locations | 300 |
| [Chicago](https://data.cityofchicago.org/d/4i42-qv3h) | Speed camera locations | 209 |
| [DelDOT / Delaware FirstMap](https://enterprise.firstmap.delaware.gov/arcgis/rest/services/Transportation/DE_Boundary_and_Point/FeatureServer/25) | Bluetooth detectors | 295 |
| [York Region, Canada](https://ww8.yorkmaps.ca/arcgis/rest/services/OpenData/Traffic/MapServer/2) | Bluetooth sensors | 499 |
| [ACT, Australia](https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services/ACTGOV_Bluetooth_Detector_Assets/FeatureServer/1) | Bluetooth detector assets | 118 |
| [Florida DOT](https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/eTraffic_Exhibit_A_Devices_Public/FeatureServer/0) | Travel-time probe sensors, technology unspecified | 1,162 |
| [New York State Thruway](https://data.ny.gov/Transportation/Thruway-Toll-Gantries/pfuu-4nqq) | Toll gantry locations | 70 |

These 10,505 locations include 7,852 traffic cameras and provide partial
geographic coverage. Kansas includes KC Scout cameras on both sides of the
state line. MoDOT entries are omitted only when the actual KanDrive inventory
contains a matching Scout camera identifier; unmatched cameras stay mapped.
This removes 311 confirmed aliases without treating nearby cameras as duplicates.
Kansas provides
409 still-image links, including 347 Scout snapshots; video-only cameras stay
mapped without an image. Missouri's separate feed supplies video streams,
so those records have no still photo.

Austin excludes desired, void and removed installations; construction status
does not establish live camera health. Iowa is limited to the publisher's
Iowa DOT roadway category. Washington covers roadway images on the WSDOT image
service; ferry, airport and external-provider cameras are excluded. This is
not a complete inventory of every city or road in those states.

Radar is a supported
category with no current source included. Austin's old Bluetooth/radar dataset
is excluded because its publisher says the devices were removed from operation.
Florida probes are not classified as Bluetooth without source evidence. The
Thruway inventory dates to 2023 and a point may represent two directional
gantries. Delaware supplies publisher-reported online/offline status but no
per-device verification date or mobility flag.

[DelDOT explains](https://deldot.gov/Programs/itms/index.shtml?dc=technology) that
Bluetooth detectors can match detected device identifiers and times between
stations to estimate travel time. These DarkRoute layers ingest equipment
locations and source metadata only, without device identifiers or observations
of people or vehicles. Traffic-camera coordinates alone do not establish plate
recognition, recording retention or data sharing.

## Photos when a camera is opened

Opening a traffic-camera point requests its available publisher snapshot.
The request goes through DarkRoute's same-origin image route; the publisher
does not receive the viewer's browser address, cookies or referrer. Only the
selected camera is requested. Closing the detail cancels the request and
releases the temporary browser image. Reopening retrieves another available
snapshot; it does not start a video stream.

Images are not collected with the inventory or archived by this feature.
The proxy accepts known camera IDs, checks a source-specific host/path
allowlist, rejects redirects, and bounds image size, time and content type.
It returns `Cache-Control: no-store`. A failed image leaves source details
available. A publisher may itself return an unavailable-image placeholder;
publisher-listed active status does not guarantee a current photo.
Snapshot retrieval time is not presented as the photograph's capture
time. Red-light cameras and other assets without public images have no photo.

## Shared feed and API

- `GET /records/road-monitoring.json`: the complete validated inventory.
- `GET /api/v1/monitoring`: the same inventory with `count`, `total` and `query`.
- `GET /api/v1/monitoring?kind=traffic_camera`: one equipment category.
- `GET /api/v1/monitoring?bbox=-94.8,38.75,-94.5,39.15`: locations in a box.
- `GET /api/v1/monitoring/image?id=overland-park-traffic%3A251`: a published photo.

`kind` accepts `traffic_camera`, `red_light_camera`, `speed_camera`,
`bluetooth_sensor`, `probe_sensor`, `toll_reader` or `radar_sensor`. A query can
combine `kind` and `bbox`. Source counts describe the full source inventory;
`count` describes the filtered response and `total` the complete inventory.
The filtered response is an API envelope, not a replacement raw snapshot.

Omit both filters to retrieve every category and all source metadata in one
JSON response. The monitoring API has no pagination or result truncation.
For a complete inventory export without the API envelope:

```sh
curl --fail --show-error --location \
  https://darkroute.ai/records/road-monitoring.json \
  --output road-monitoring.json
```

The schema is `darkroute-road-monitoring/v1`, defined in
`packages/core/src/roadMonitoring.ts`. Records include stable source IDs,
equipment kind, WGS84 coordinates, name, operator, road, direction, status,
source URL, source date and nullable public image URL. Sources include coverage,
attribution, licence information, counts and separate check/fetch/source dates.
Unknown operating status stays unknown. `active` means publisher-listed active,
not a live DarkRoute test of the device.

## Refresh and failure handling

The scheduled collector checks the official inventories daily. It paginates
bounded public GIS queries, validates the complete source before accepting it,
and conditionally publishes one shared snapshot. The app and developer console
read this same production feed. Visible enabled layers recheck for updates;
image requests happen only when the user opens a camera.

`checkedAt` is the latest collection attempt; `fetchedAt` is the last successful
inventory retrieval; `sourceUpdatedAt` is the publisher's date when supplied.
Retrieving an older inventory does not make its source date current. A failed
source keeps its last valid records and is marked `stale`; a source that has
never loaded is `unavailable`. Explicitly removed devices are excluded and an
explicitly retired source cannot keep showing its old devices as current.
Partial failures do not discard successful updates from other sources. Atomic
publication checks the prior object's ETag and rejects older generations.

The collector, normalizers and publisher are `scripts/build-road-monitoring.mjs`,
`scripts/road-monitoring-sources.mjs` and `scripts/road-monitoring-publish.mjs`.
The additional traffic-camera adapters are `scripts/kc-traffic-sources.mjs`
and `scripts/traffic-camera-sources.mjs`.
Source attribution and available terms remain attached to every inventory;
an absent licence field is not treated as a public-domain declaration.

To reproduce the inventory locally without publishing or fetching images:

```sh
node --dns-result-order=ipv4first scripts/build-road-monitoring.mjs \
  --previous apps/pwa/public/records/road-monitoring.json \
  --output /tmp/road-monitoring.json
```

Adding a source requires a stable publisher identifier, validated coordinates,
an explicit equipment category, bounded complete retrieval, attribution and
coverage information. Tests cover exclusions and malformed upstream responses.
New photo services also need a source-specific host/path entry and tests in
`functions/api/v1/monitoring/image.ts`; registering an inventory alone does not
authorize arbitrary image URLs. No API schema change is needed for another
source using the existing equipment categories.
