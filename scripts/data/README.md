# US county boundary geofence

`us-counties.geojson` is the deterministic territorial guard for the release
baseline and every qualifying upsert observed in the global OpenStreetMap
replication stream. A node is admitted only when its point falls in one of
these US Census county or county-equivalent polygons. The file covers the 50
states, DC, and Puerto Rico; it deliberately does not admit Canada, Mexico, the
US Virgin Islands, or points outside the simplified coastline.

Provenance:

- exact source: `plotly/datasets`, `geojson-counties-fips.json`;
- source URL:
  <https://raw.githubusercontent.com/plotly/datasets/95672208c26b44a6e32363b17a35b8caa1b5d2ef/geojson-counties-fips.json>;
- source commit: `95672208c26b44a6e32363b17a35b8caa1b5d2ef`
  (2019-08-06);
- underlying geography: US Census county and county-equivalent boundaries;
- features: 3,221;
- bytes: 3,216,816;
- SHA-256:
  `e540149b7525e71ee6b6cab6dea2a95205f11e0c3e7374d27a7c9c47ea96e8c0`;
- exact-file licence: MIT; see `PLOTLY-DATASETS-LICENSE.txt`.

The checksum is asserted by `sync-cameras.test.mjs`. Replacing this file is a
territorial-policy change, not a routine dependency bump: update the checksum,
re-run the Vancouver/Mexico/US/Puerto Rico fixtures, and review how many records
from a fresh US source baseline fall outside the new geometry.

## DeFlock-derived capture implementation

`capture-deflock-source.mjs` and `deflock-capture.mjs` derive their adaptive
Overpass query and element-to-GeoJSON semantics from
`flockhopper3/deflock-data` commit
`8d156b24db7090e870af3f007b0caece9b3c0951`. DarkRoute's source receipt pins
the exact upstream source-file hashes and the checked-in implementation hashes.
The upstream MIT notice is retained verbatim in `DEFLOCK-DATA-LICENSE.txt`.

## Reviewed camera-capture trust artifacts

An approved direct-capture release is complete only when these exact paths are
checked in and cross-bound by `deflock-us-source-review.json`:

- `deflock-us-overpass-response-ledger.json` — canonical response topology,
  response/code identities, endpoints, counts, and minimum actual OSM
  watermark;
- `deflock-us-overpass-responses.bundle.gz` — canonical retained response
  bodies with contributor `user`, `uid`, and `changeset` removed;
- `deflock-us-source.geojson.gz` — attributed raw seed-root union before the
  strict Census territory filter;
- `camera-predecessor.json` — exact deployment, pointer/flat/empty mode,
  inventory, live-id set, and source-tombstone identity;
- `camera-predecessor-tombstones.json` — exact captured predecessor deletion
  source when the predecessor is nonempty;
- `deflock-us-baseline-tombstones.json` — immutable, canonical tombstone input
  after migration and cutover reconciliation, before baseline transformation or
  replay; this is distinct from the mutable runtime `cameras/tombstones.json`;
- `deflock-us-source-review.json` — the human-approved v3 receipt binding every
  artifact above, the pinned geofence, the final reconciled tombstone ledger,
  transformation digest, and conservative replication floor.

The two gzip files are the only gzip data artifacts admitted by the curated
public seed. Their exact byte lengths and SHA-256 values come from the approved
receipt; a generic `.gz` allowance is not sufficient. The retained bundle and
GeoJSON embed `Map data © OpenStreetMap contributors`, `ODbL-1.0`, and
<https://opendatacommons.org/licenses/odbl/1-0/>. The DeFlock-derived code and
Plotly geofence retain their separate MIT notices named above.

The response topology also conserves every adaptive split. Child-box counts can
double-count a node on an inclusive shared boundary, so the validator unions the
canonical element keys from every terminal descendant body and requires that
distinct union to cover the parent count. A smaller union is mirror skew or data
loss and invalidates the capture even when the national minimum is still met.
Validation also deterministically re-encodes both gzip containers and the
compressed core in `continuity.json`; concatenated members, header comments,
and other semantically invisible container changes are rejected.

The receipt currently in this directory is a historical **unapproved** v2
record whose constituent Overpass watermarks were not retained. It is a
fail-closed diagnostic, not release approval. The capture bundle, raw GeoJSON,
and predecessor artifacts must not be fabricated or inferred from it; they are
created only by a new reviewed capture/cutover sequence.
