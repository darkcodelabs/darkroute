# Data inventory and where to find it

DarkRoute publishes several independent datasets. The **camera count counts
ALPR locations only**. It does not include traffic cameras, other monitoring
equipment, agency deployments, articles, abuse records or work zones. Those
units cannot be added into one meaningful total.

Open the [API console](https://api.darkroute.ai/?tab=api) for dataset counts,
dates and download links, [Monitoring](https://api.darkroute.ai/?tab=monitoring)
for equipment, or [Reports](https://api.darkroute.ai/?tab=reports) for abuse,
news and EFF Atlas. A table's first 100 rows are a display limit; use **Show
100 more** or its export controls for the remaining matching records. The
camera query API has a separate, explicit result limit described below.

Reports provides a text search on phones and desktops. Its CSV export contains
every matching record, and **Download complete API JSON** contains the
unfiltered endpoint response. For Atlas, **Download raw Atlas snapshot** also
retains unplaced source rows and the raw snapshot's full metadata; these are
not present in the county-oriented API representation.

## Public datasets

The links below use the canonical `darkroute.ai` origin. The developer console
also forwards `/cameras/*`, `/api/v1/*` (or `/v1/*`) and the six listed
`/records/*.json` files on `api.darkroute.ai`. Other `/records/` names are not
part of that allowlist. Check HTTP status, content type and schema before
treating a response as a dataset.

| Dataset                      | Complete public data or entry point                                                                                                           | Meaning and visibility                                                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ALPR camera archive          | [Index](https://darkroute.ai/cameras/index.json), then `/cameras/11/{x}/{y}.json` tiles                                                       | Mapped ALPR locations and recorded attributes; used by the map, lookup, alerts and route avoidance. The index provides camera/tile counts and bounds. Use the complete published tile archive for full records. |
| Camera coordinate overview   | [overview.json](https://darkroute.ai/cameras/overview.json)                                                                                   | An object with `schema`, `count` and flat `coords: [lat, lon, lat, lon, …]`. It contains neither IDs nor the tile records' attributes. Used by the overview map and POI exports.                                |
| Camera removals              | [tombstones.json](https://darkroute.ai/cameras/tombstones.json)                                                                               | Historical removal records with IDs and reasons. They are separate from the active camera count; available to archive consumers and the console.                                                                |
| Camera county gazetteer      | [cameras/counties.json](https://darkroute.ai/cameras/counties.json)                                                                           | Names, FIPS codes and camera counts for counties represented in the archive.                                                                                                                                    |
| Camera place gazetteer       | [places.json](https://darkroute.ai/cameras/places.json)                                                                                       | Names, place codes and camera counts for represented cities/towns.                                                                                                                                              |
| Camera continuity            | [continuity.json](https://darkroute.ai/cameras/continuity.json)                                                                               | Publication evidence connecting the reviewed source capture to the selected replication generation. It is provenance, not additional camera locations.                                                          |
| Road monitoring              | [records/road-monitoring.json](https://darkroute.ai/records/road-monitoring.json) or [unfiltered API](https://darkroute.ai/api/v1/monitoring) | Complete equipment inventory and per-source metadata. Separate map switches and the console's Monitoring view expose the categories below.                                                                      |
| Documented ALPR abuse        | [records/counties.json](https://darkroute.ai/records/counties.json) or [abuse API](https://darkroute.ai/api/v1/abuse)                         | Dated source records naming agencies and county context; shown in Reports. A record is not a camera or an article count, and does not establish misconduct by every agency in its county.                       |
| ALPR news                    | [news API](https://darkroute.ai/api/v1/news)                                                                                                  | The complete retained headline feed, source links and collection status; shown in Reports → News. No `/records/news.json` download exists.                                                                      |
| EFF Atlas county context     | [records/atlas-counties.json](https://darkroute.ai/records/atlas-counties.json) or [Atlas API](https://darkroute.ai/api/v1/atlas)             | Agency ALPR deployments and partially recorded vendors grouped by county; Reports → EFF Atlas and camera context. Deployments are not individual camera locations, ownership attribution or confirmed abuse.    |
| Work-zone hazards            | [records/hazards.json](https://darkroute.ai/records/hazards.json)                                                                             | Roadwork/closure inventory with source, coverage and build date. This is separate from monitoring equipment. See the implementation and freshness limitation below.                                             |
| County boundary lookup       | [records/county-index.json](https://darkroute.ai/records/county-index.json)                                                                   | Compressed county polygons for county lookup on the device. This is reference geometry, not a camera or agency inventory.                                                                                       |
| Historical review candidates | [records/candidates.json](https://darkroute.ai/records/candidates.json)                                                                       | Existing packaged, unpromoted research candidates. Public availability does not promote them into the cited abuse archive or current news feed. They are not shown as confirmed cases.                          |

`GET /api/v1/cameras?bbox=west,south,east,north` returns up to 1,000 records
(200 by default), over at most 24 z11 tiles and 1.5° per side. Check `truncated`;
this endpoint is not a whole-archive export. [Stats](https://darkroute.ai/api/v1/stats)
reports the live camera generation. [OpenAPI](https://darkroute.ai/api/v1/openapi.json)
and the [network/API reference](public/API.md) describe query parameters and errors.

## Equipment categories, source metadata and photos

The unfiltered monitoring API returns all categories together, with `count`
equal to `total`. It has no pagination or result truncation. `kind` and `bbox`
filter the response; source counts still describe each full source inventory.
The raw snapshot contains the same `sources` and `records` without the API's
`query`, `count` and `total` envelope.

| `kind`             | September 10, 2026 observation | Interpretation                                                                        |
| ------------------ | -----------------------------: | ------------------------------------------------------------------------------------- |
| `traffic_camera`   |                          7,852 | Published traffic CCTV inventories, not evidence of ALPR capability.                  |
| `bluetooth_sensor` |                            912 | Published Bluetooth detector locations. No observed device identifiers are collected. |
| `probe_sensor`     |                          1,162 | Travel-time probes whose technology is not established as Bluetooth.                  |
| `red_light_camera` |                            300 | Published red-light enforcement locations.                                            |
| `speed_camera`     |                            209 | Published speed-enforcement locations.                                                |
| `toll_reader`      |                             70 | Toll gantry locations; a point may represent more than one directional gantry.        |
| `radar_sensor`     |                              0 | Supported category with no published source in this snapshot.                         |

These 10,505 records came from 25 source entries. Coverage is partial, including
some sources outside the US. The [road-monitoring guide](road-monitoring.md)
lists publishers, geographic limits, exclusions and camera deduplication.

Each source carries its URL, attribution, licence information, geographic
coverage, `count`, `checkedAt`, `fetchedAt`, `sourceUpdatedAt` and `status`
(`ok`, `stale`, `unavailable` or `retired`). Each record carries its source ID,
coordinates, category, name, optional operator/road/direction, source URL,
publisher-reported status and optional image metadata. A successful source
check does not prove that every device is operating.

`/api/v1/monitoring/image?id=...` requests an available publisher image for a
selected published record. Images are fetched on demand and are not an archive,
a continuous video stream or a separate count of monitored locations. Many
records have no public image. See [photo behavior](road-monitoring.md#photos-when-a-camera-is-opened).

## Live publication, packaged snapshots and freshness

| Data family                                      | Production source                                                                                                                                                                               | Freshness to inspect                                                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cameras, gazetteers and continuity               | A validated R2 camera generation selected together. The checked-in `apps/pwa/public/cameras/` tree is omitted from the production static build.                                                 | `generation`, `generatedAt`, replication `upstream`; metadata and tile responses must agree on generation.                                           |
| Monitoring                                       | Independent R2 `records/road-monitoring.json`; validated packaged fallback when no object is available. Storage read failures produce an error rather than silently selecting an older package. | Snapshot `generatedAt`, each source's status and separate check/retrieval/source dates; `x-darkroute-monitoring-source` identifies `r2` or `static`. |
| Atlas                                            | Independent R2 `records/atlas-counties.json`, with the same absence/fallback distinction.                                                                                                       | `fetchedAt`, `checkedAt`, totals and source attribution; `x-darkroute-atlas-source` identifies `r2` or `static`.                                     |
| News                                             | Independent R2 `news/feed.json`, exposed through `/api/v1/news`; no packaged feed fallback.                                                                                                     | `updatedAt`, `lastAttemptAt`, `coverage.status`, succeeded/attempted searches. A failed collector can retain earlier articles.                       |
| Abuse, hazards, county boundaries and candidates | Packaged files in `apps/pwa/public/records/`; their bytes change with a deployment, not with the camera publication pointer.                                                                    | Each file's own generation/build date and coverage. Do not substitute the app build date or camera generation.                                       |

Camera replication and the daily monitoring/Atlas and four-times-daily news
jobs run independently. A schedule is not proof of a successful refresh. A
fresh app bundle can serve an older source snapshot, and the public GitHub
snapshot can trail the live R2 camera archive. [Reports and freshness](reports.md)
explains article dates, Atlas source checks and retained data in more detail.

### Dated audit observations

The public endpoints were inspected on **September 10, 2026, around 20:30 UTC**.
These values document that inspection; fetch the linked datasets for current
counts and status.

| Dataset    | Observed public response                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Cameras    | 139,820; generated `2026-09-10T18:32:48.570Z`, replication watermark `2026-09-10T18:00:00Z`.                                       |
| Monitoring | 10,505 across 25 sources, all marked `ok`; generated `2026-09-10T15:37:52.811Z`.                                                   |
| Atlas      | 4,146 ALPR source rows, 4,142 county-matched rows, 3,574 agencies, 1,345 counties; retrieved September 9 and checked September 10. |
| News       | 295 retained articles; updated `2026-09-10T19:51:33.165Z`; collection **partial**, 1 of 9 searches succeeded.                      |
| Abuse      | 93 source records across 84 counties; generated September 3.                                                                       |
| Hazards    | 1,004 work-zone records, 400 Kansas and 604 Missouri; built `2026-09-04T19:22:47.462Z`. This was an old snapshot at audit time.    |

The inspected GitHub package instead held 139,613 cameras and 3,705 tombstones,
with 8,740 tiles, 2,382 county rows and 8,757 place rows, generated September 9.
It also held 3,221 county-boundary entries and 57 unpromoted candidates.
Those differences are publication scope and timing, not evidence that the
additional monitoring records were lost from the ALPR count.

## Enrichment, reference data and incomplete integrations

- **Camera enrichment is inside tile records.** OSM tags, manufacturer,
  operator, mount, direction and place/street context are attributes, not new
  locations. The compact coordinate overview and camera query response do not
  expose every field available in the raw tiles. See [data contracts](public/DATA-CONTRACTS.md)
  and [provenance](public/DATA-PROVENANCE.md).
- **Landmarks are an optional sidecar.** `scripts/build-landmarks.mjs` produces
  `/records/landmarks.json`, read by `services/records/landmarks.ts`. That file
  was absent from the inspected package. Existing reader support or a builder
  does not mean a complete landmark inventory is published. Missing lookups
  are allowed to return no result; this path is not in the console proxy's
  public records allowlist.
- **Hazards have a visibility limitation.** The inspected PWA loads the file
  when Roadwork is enabled and uses its coverage in the control. That source
  revision had no production consumer rendering `hazards()` records on the
  map. A successful download or an enabled toggle alone therefore did not
  establish a visible work-zone layer. The snapshot was also six days old;
  `hazards.ts` defines a 24-hour stale threshold. Check current implementation
  and the file's date before treating this as current road-condition coverage.
  Its 1,004 rows contained only two distinct `(s, i)` source/ID pairs because
  the published IDs repeat within each source. Those IDs cannot uniquely
  identify work zones; the row count is not a verified unique-location count.
- **Reference maps are separate assets.** County/place source polygons,
  basemap archives and their style/fonts/sprites support geographic labels
  and map rendering. They do not add surveillance records. County lookup uses
  `/records/county-index.json`; the basemap manifest is
  `https://tiles.darkroute.ai/basemap.json`. Builder inputs under `scripts/data/`
  and optional local source files are not all public HTTP datasets.

## Data that stays on a device

The PWA's local database contains downloaded camera tiles and cache metadata,
alerts, trip summaries, destinations, settings, pending reports/actions,
report evidence chains/photos, encrypted plate-vault data and local plate
matches. See [`services/db/schema.ts`](../apps/pwa/src/services/db/schema.ts)
and the [privacy/network description](public/API.md#27-what-the-client-still-never-sends).
These records are not a shared public dataset, and a server console cannot
enumerate another device's local history. A local pending report is not an
accepted camera record.

The public submission API is a separate, explicit correction flow: it opens
a review pull request, with an optional uploaded photo, and does not directly
write the camera archive. Private administrative state and operational
records are outside this public inventory and require the authorized private
console; public export routes do not expose them.

## Source map for maintainers

Paths are relative to the repository root. These identify the actual readers
and publishers so this inventory can be checked when a dataset changes.

| Family                            | Reader / presentation                                                                                                                                                 | Publisher / serving code                                                                                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Cameras and sidecars              | `apps/pwa/src/services/cameras/{catalogue,overview,gazetteer,sync}.ts`; `apps/desktop/src/console/{ArchiveView,CoverageView}.tsx`                                     | `scripts/{sync-cameras,publish-cameras}.mjs`; `functions/cameras/[[path]].ts`                                                                  |
| Monitoring                        | `apps/pwa/src/services/records/{roadMonitoring,useRoadMonitoring}.ts`; `apps/pwa/src/features/map/monitoringLayers.ts`; `apps/desktop/src/console/MonitoringView.tsx` | `scripts/{road-monitoring-refresh,road-monitoring-publish}.mjs`; `functions/records/road-monitoring.json.ts`; `functions/api/v1/monitoring.ts` |
| News                              | `apps/pwa/src/services/records/newsFeed.ts`; `apps/desktop/src/console/ReportsView.tsx`                                                                               | `scripts/{news-patrol,news-publish}.mjs`; `functions/api/v1/news.ts`                                                                           |
| Abuse                             | `apps/pwa/src/services/records/countyRecords.ts`; `apps/desktop/src/console/ReportsView.tsx`                                                                          | `apps/pwa/public/records/counties.json`; `scripts/check-record-citations.mjs`; `functions/api/v1/abuse.ts`                                     |
| Atlas                             | `apps/pwa/src/services/records/atlasCounties.ts`; `apps/desktop/src/console/ReportsView.tsx`                                                                          | `scripts/{atlas-refresh,atlas-publish}.mjs`; `functions/records/atlas-counties.json.ts`; `functions/api/v1/atlas.ts`                           |
| Hazards                           | `apps/pwa/src/services/records/hazards.ts`; Roadwork control in `apps/pwa/src/features/drive/DriveScreen.tsx`                                                         | `scripts/build-hazards.mjs`; packaged `apps/pwa/public/records/hazards.json`                                                                   |
| County lookup and landmarks       | `apps/pwa/src/services/records/{countyLocate,landmarks}.ts`                                                                                                           | `scripts/{build-county-index,build-landmarks}.mjs`                                                                                             |
| Camera enrichment                 | Raw camera tile consumers                                                                                                                                             | `scripts/{enrich-cameras,build-camera-context}.mjs`                                                                                            |
| Console inventory and raw aliases | `apps/desktop/src/console/ApiRefView.tsx`                                                                                                                             | `apps/desktop/functions/records/[[path]].ts`; fixed public-file allowlist                                                                      |
