# Aggregation and freshness policy

This is the public rule for deciding what may become a published fact, how
claims from different sources are kept apart, and what “fresh” means in this
repository. It describes the behavior the code implements today and calls out
the places where a future integration is only registered or proposed.

The short version: a reachable feed is not permission to publish it, two nearby
records are not automatically the same thing, and an absent record is not
automatically a deletion.

## Published scope

The published camera-location layer is an OpenStreetMap-derived database of
point nodes that qualify as ALPR or ANPR cameras. OpenStreetMap supplies the
camera identity, position, tags, element version, and element edit time when
those fields are present. Project code derives compact display fields and may
join separately sourced geographic labels; those transformations do not turn a
missing upstream fact into a known one.

The source register in `the operator toolingscripts/backend-client.mjs` is an admission and
routing mechanism. A source appearing there does **not** mean that it is
currently imported, displayed, or distributed. The camera layer described
above is the only source aggregation this policy claims is live.

This dataset contains camera locations and attributes. It does not contain
plates, camera reads, operator search results, driver locations, or photographs.

## Source admission

The authoring/curation backend admits a new observation only when all of these
are known:

1. `source_key` — a stable source name;
2. `source_record_id` — the upstream record at the source’s actual grain;
3. `retrieved_at` — when this copy was retrieved;
4. `licence` — the terms that apply to this claim; and
5. `source_url` — an HTTP(S) page a person can open to inspect the source.

`completeProvenance()` enforces those five fields at the authoring boundary. A
missing field, an invalid retrieval time, or a non-resolvable URL makes the
claim ineligible; the pipeline skips and counts it instead of inventing the
missing provenance.

The current static OSM tile pipeline predates that per-observation envelope. It
carries OSM identity on every record and source, licence, retrieval/build time,
and attribution at catalogue or artefact level. Moving that layer through the
curation backend must add the five-field envelope; this policy does not pretend
the legacy tile shape already contains fields it does not.

Admission also requires a declared record grain and stable identity. An agency
row is not a camera, a county polygon is not a camera, and a news report is not
an observation merely because all three mention the same place. A source whose
permission, licence, or record identity is unresolved stays link-only or
curation-only until that uncertainty is resolved.

Trust and redistribution are separate decisions. A source may be useful to a
reviewer but forbidden from every public artefact. Conversely, an openly
licensed source may still be incomplete, stale, or uncorroborated; its licence
does not upgrade its evidentiary weight.

## Licence and layer boundaries

The repository treats the OpenStreetMap-derived camera database as ODbL 1.0
data. Camera tiles and the catalogue carry `Map data © OpenStreetMap
contributors`, the licence identifier, and the ODbL 1.0 URI in their bodies.

The authoring backend routes sources into one of three structural destinations:

- `odbl_tree` for claims permitted in the shared ODbL extract;
- `own_layer` for a separately published layer with its own licence and
  attribution; or
- `never` for curation material that must not enter a public tile, export,
  screenshot payload, or API response.

Claims in different licence trees are not flattened into one database. A UI may
join separately labelled layers at render time, but the source identity,
licence, and attribution must remain recoverable. This is the repository’s
publication rule, not legal advice; [LEGAL.md](./LEGAL.md) records the project’s
licensing position.

## Source and transport roles

“Who asserted this fact?” and “which file transported it?” are different
questions.

- OpenStreetMap contributors are the factual source for the camera layer.
- A release bootstrap may read only the receipt-bound Overpass-shaped handoff
  emitted from DarkRoute's retained first-party Overpass capture. The capture
  uses a pinned, hash-bound DeFlock-derived query implementation, but DeFlock is
  neither the data host nor an independent factual source for this path.
- The scheduled delta source is OpenStreetMap’s hourly replication stream.
- Driver devices fetch the project’s own published camera tiles. They do not
  fetch DeFlock camera tiles or send a location to a third-party camera-data
  provider.

Capture/build time belongs separately from the underlying source identity. The
version-3 release receipt binds the complete response-plan topology, redacted
retained bodies, original-transport hashes, exact capture implementation,
strict US/DC/PR geofence, predecessor/tombstone inputs, minimum constituent OSM
watermark, and conservative hourly replay floor. Command-line overrides fail
closed. Obsolete local-carry and remote-PMTiles receipt shapes are not release
inputs: an unversioned or incompletely evidenced archive cannot distinguish a
coverage gap from a deleted or retagged node. A later operational replication
timestamp does not re-date the capture.

## Identity and merge rules

The canonical camera id is `osm:<node-id>`. It is stable because it comes from
the upstream record, not from coordinates or a name. OSM nodes, ways, and
relations have separate id spaces; the published camera layer accepts nodes
only.

The pipeline does not merge records merely because they are close together.
Nearby cross-source observations may become human-review candidates, but the
candidate itself is not an instruction to combine them. Within one source, two
upstream ids remain two assertions unless that source explicitly says
otherwise.

For an existing OSM camera, a newer upstream element version replaces the OSM
position and tags. Locally derived fields are carried forward only through the
narrow paths named in the scripts; a blanket object merge is forbidden because
it could restore a tag that an upstream editor removed. Unknown values remain
unknown. In particular, missing operator data defaults to `unverified`, not to
an inferred police or private owner.

Conflicts between independent sources remain source-labelled claims. They are
not silently resolved by source order, record count, or proximity.

## Removals and tombstones

The scheduled sync drives removal from the local OSM id set and explicit
OsmChange events:

- an explicit delete for a known camera id creates an `osm_delete` tombstone;
- a modification of a known id whose current tags no longer qualify creates an
  `osm_untag` tombstone;
- a newer qualifying modification that moves a known id outside the strict
  50-states/DC/PR geometry creates an `osm_out_of_scope` tombstone;
- a one-time legacy cutover may add a `cutover_reconciliation` tombstone only
  for the exact predecessor-live ids absent after the inherited ledger is
  applied, after the official current-node API proves each exact current
  version is deleted, unqualified, or out of scope. This set includes a live id
  that also has an inherited historical tombstone; the proved current entry
  replaces that stale tombstone;
- a delete for an unknown id is irrelevant; and
- absence from a partial response, mirror, tile, or interrupted fetch is not a
  deletion signal.

This id-first rule matters because an OSM delete need not carry the tags that
previously identified the record as a camera. The sync publishes an append-only
`tombstones.json` ledger so a client updating an older cache can remove a record
instead of only accumulating additions.

Bulk changes are subject to empty-baseline, removal, addition, and movement
circuit breakers. A guard failure writes no camera changes and advances no
watermark. Thresholds live beside the implementation in
`scripts/sync-cameras.mjs`; changing them is a reviewed code change, not an
operator-side guess.

The manual full-rebuild path has additional response, population, and identity
guards, but it does not synthesize a new tombstone for every small absence that
passes those guards. It is therefore an operator-controlled bootstrap and
recovery tool, not an independent deletion authority. Consumers should read a
tombstone as an explicit recorded removal, not as proof that the ledger captures
every historical absence across every rebuild.

## Freshness and publication

There are two deliberately different paths:

- **Bootstrap/rebuild:** an exact reviewed version-3 handoff derived from
  DarkRoute's retained first-party Overpass capture.
  `fetch-cameras.mjs` disables direct country-scale Overpass fetching.
- **Incremental sync:** hourly OSM replication diffs, applied in sequence by
  `sync-cameras.mjs`. The repository workflow is scheduled for ten minutes past
  each hour, but the scheduler is best-effort. This is a cadence, not an SLA.

The sync reads the published replication head, then applies each pending diff
in order, with a bounded catch-up batch. Its sequence watermark advances only
through a completely parsed diff. If no prior watermark exists, the first run
adopts the current head and applies no historical deletions because continuity
cannot be proved. Every approved-baseline live record and retained tombstone
has an OSM version. An equal or older version is ignored; sequence continuity
orders the stream, while version ordering also resolves multiple edits to one
id inside a single hourly sequence.

Normal scheduled runs use the 24-diff bound and may publish a coherent
intermediate generation, then converge without skipping sequences. The reviewed
bootstrap uses `--max 1000 --require-caught-up`; if that bound cannot reach the
head observed at the start, nothing is published.

The manifest of the current R2 generation is the canonical operational
watermark. `__camera/current.json` names one of three slots and binds its
`manifest.json` by generation id and SHA-256. That manifest binds one exact
replication sequence and timestamp to a sorted inventory of every archive file,
including byte length, MD5, and SHA-256. A camera tree checked into the source
repository may seed a reviewed bootstrap; it is not evidence of runtime
freshness.

Before applying a diff in normal operation, the workflow pins the current pointer and its
manifest, restores that manifest's exact inventory plus an explicit runtime
state file, and verifies the generation hash, every object hash and length, all
six required sidecars, tile and camera floors, tile metadata, attribution,
unique camera ids, tombstone separation, and `index.json` / `overview.json`
counts. That state includes the manifest's four replication fields and the full
hydrated pointer as `basePointer`; sync preserves the pointer while advancing
replication. Only a complete success replaces the local camera directory. Fetch
and sync receive an explicit guarded `--target`; neither infers freshness from a
checkout.

Every mutating sync is followed by semantic attestation. The attester starts
from the exact approved retained capture and immutable baseline tombstone
input, crosses the newest constituent response/tombstone observation, applies
the complete contiguous official numbered diff range, and writes
`continuity.json` only when that independently derived live/tombstone core and
replication state exactly equal the candidate. Publication repeats that replay
before its first R2 candidate write; byte-coherent but fabricated tiles are not
a valid generation.

Normal publication first requires the observed R2 pointer to equal the exact
hydrated `basePointer`; it refuses before candidate mutation if another
generation won the race. Bootstrap has no base pointer and requires the remote
pointer to be absent. Publication then reconciles the one slot not protected as
current or previous, deleting stale objects only within that recyclable
candidate. A 180-minute lease, a 110-minute hard write fence, and exact lease
revalidation before reconciliation, manifest write, and pointer write bound the
transaction. It verifies an exact relist, writes the candidate manifest after
all data, and conditionally replaces `__camera/current.json` last. The current
and previous slots are immutable while protected, so an interrupted upload
cannot expose a mixed snapshot and the pointer can be rolled back to its
previous reference with a conditional write. The scheduled workflow does not
commit the generated camera tree or runtime state to Git.

The timestamps have narrow meanings:

- `index.json.generatedAt` is when the local catalogue was regenerated;
- `index.json.upstream` is the source timestamp supplied to a bootstrap or the
  exact timestamp of the last replication diff applied by sync. It is not a
  physical inspection time and, during bounded catch-up, does not imply the
  moving stream head has been reached;
- `index.json.baseUpstream`, when present, is the minimum actual
  `osm3s.timestamp_osm_base` parsed from every accepted constituent response in
  the reviewed capture and does not advance with replication;
- a record’s `updatedAt`, when present, is the OSM element’s last edit time, not
  the date the hardware was installed or last seen in person; and
- the authoritative operational progress marker is the exact applied
  replication sequence and timestamp in the current R2 generation manifest.

A stale timestamp must be shown as stale or unknown. It must not be converted
into “camera removed”, “area clear”, or any equivalent safety claim.

## External lookup boundary

Have I Been Flocked? is not an aggregation source for this repository. Its
search concerns operator lookups found in released audit logs; it does not
answer whether a camera photographed a plate. Its coverage is retrospective and
incomplete, so a missing result would not prove that no search occurred.

The app has no automated HIBF API integration and no backend proxy. The only
implemented hand-off opens the bare `https://haveibeenflocked.com/` homepage and
copies the plate to the device clipboard so the user can decide whether to paste
it. The plate is never put into the URL. The feature flag remains off unless an
authorized integration is established or the feature is redesigned as a
local-only query.

The local lookup quota is a product safety limit, not a claim about an outside
service’s limits. No third-party freshness, availability, completeness, or
response semantics are part of DarkRoute’s data guarantee.

## Change control

Adding a source or changing a source’s role requires a reviewed update to the
source register, its provenance adapter, licence routing, tests, and this
policy. A new endpoint, a permissive CORS response, or a technically accessible
file is not enough by itself.

The executable references for this policy are:

- `the operator toolingscripts/backend-client.mjs` — provenance, source routing, and merge
  candidates;
- `scripts/capture-deflock-source.mjs` and `scripts/deflock-capture.mjs` — the
  retained first-party capture and its proof topology;
- `scripts/camera-predecessor.mjs`,
  `scripts/migrate-camera-tombstone-ledger.mjs`, and
  `scripts/reconcile-camera-cutover.mjs` — predecessor and one-time cutover
  continuity evidence;
- `scripts/fetch-cameras.mjs` — bootstrap, normalization, and rebuild guards;
- `scripts/hydrate-cameras.mjs` — exact object-store restoration and atomic
  local replacement;
- `scripts/sync-cameras.mjs` — sequential diffs, tombstones, and watermarks;
- `scripts/publish-cameras.mjs` — publication gates; and
- [DATA-PROVENANCE.md](./DATA-PROVENANCE.md) and
  [TAXONOMY.md](./TAXONOMY.md) — field-level provenance and public schema.
