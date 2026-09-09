# Camera sync: why it stalls, and how to clear it

The camera archive stops advancing when the checked-in **source review receipt**
is not approved. That is the whole mechanism. It is not a bug, it is not a
broken script, and it is not something a code change should route around.

This document exists because the stall was reported for a week as "three stacked
gates" without anyone writing down that all three are the same fact, or that
clearing it needs one human decision that no script is allowed to make.

## The state that stalls it

`scripts/data/deflock-us-source-review.json`:

```json
{
  "schema": "darkroute-deflock-source-review/v2",
  "sourceWatermark": {
    "status": "unapproved",
    "reason": "fetch run 33556526679 did not retain osm3s.timestamp_osm_base for its constituent Overpass responses; observationStartedAt is runner wall time and cannot authorize a replication floor",
    "minimumOsmBase": null,
    "responseLedger": null
  },
  "replicationFloor": null
}
```

Read the `reason` field, because it is the answer. The upstream fetch run
recorded **the runner's wall-clock time** instead of the OSM base timestamps
that Overpass returns in `osm3s.timestamp_osm_base`. Wall-clock time says when a
machine happened to run; it says nothing about how old the data in the response
was. Without the base timestamps there is no provable **replication floor**, no
lower bound on the freshness of what was captured, so the receipt refuses to
authorize one and sets `replicationFloor: null`.

`validateSourceReview` in `scripts/fetch-cameras-deflock.mjs` then throws:

```
source review is explicitly unapproved: fetch run 33556526679 did not retain
osm3s.timestamp_osm_base ...
```

### The other two "gates" were this one

- "the response ledger is missing": `responseLedger: null` is the receipt
  saying it has none. The file is absent because the run never produced one.
- "the schema is v2 and the validator rejects v2": it does not. It rejects
  *this* v2 receipt, for the reason quoted above. The comment above the check is
  explicit that recognising the unapproved shape only improves the diagnostic:

  > no v2 receipt, including a synthetically "approved" one, is a trust root.

There is one gate. Editing the JSON to say `"approved"` clears nothing real: it
produces exactly the synthetic receipt that comment refuses.

## Why the check is not the thing to weaken

This app's promise is that the reader on the map is really there. A camera
archive with no verifiable freshness floor is one where nobody can say whether a
reader was removed last month, and a driver routing around a camera that is gone, or past one that was added, is being told something false by a tool whose
only job is to be right about that.

The refusal is fail-closed on purpose. Stale-but-labelled is a product; stale-
and-silent is a liability.

## Clearing it

Three steps. The pipeline already exists; only step 3 is a decision.

### 1. Capture, first-party, with the bodies retained

```bash
node scripts/capture-deflock-source.mjs --out=/tmp/darkroute-source-capture
```

Runs the pinned DeFlock adaptive Overpass query as a replay-auditable artifact,
**retaining the response bodies**, which is the thing the failed upstream run
did not do, and therefore the thing that makes this capture able to prove a
floor. Long-running and it talks to Overpass: run it in a named `tmux`, not in a
shell you might lose.

Endpoints and retry/backoff live in `scripts/overpass.mjs`; the per-request
timeout is 55s. Do not parallelise it and do not retry it in a loop, Overpass
is a donated public endpoint and this query is large.

The capture writes nothing until it completes and **cannot resume**. A failed
run leaves an empty `--out` directory and starts from the first seed next time.

#### The failure you will actually hit

```
Error: tile:[30.5,-115.16,37,-105.32]: data response has 4047 features;
       probe promised 4045
```

This is correct behaviour, not a bug. Each leaf is probed for a count and then
fetched, and `countProbeIsConsistent` demands `actual === probed` with **no
tolerance**, from its own comment:

> Count and data queries must agree exactly. Any churn or mirror skew retries
> the leaf; accepting a percentage delta would make thousands of omissions
> indistinguishable from a complete release baseline.

Two things produce a mismatch:

1. **Real churn**: somebody edited OSM between the probe and the fetch. Two
   added ALPR nodes is exactly what a 2-feature delta looks like.
2. **Mirror skew**: the leaf's probe and its data came from *different*
   mirrors, which are not in lockstep. The capture deliberately excludes the
   count endpoint when fetching data, so this happens whenever a mirror is
   unhealthy and the fetch falls through to another one.

Cause 2 is the one to check first, because it is visible in the log: count the
`504` / `429` / `aborted` lines above the error. A run with a dozen of them was
bouncing between mirrors, and a re-run once the endpoints are healthy is the
whole remedy. **Do not re-run immediately after a run that saw 429s**, that is
adding load to the endpoint that just told you it was overloaded, and it makes
the next attempt more likely to fail, not less.

Re-run at a quieter hour, **after checking the mirrors are actually up**:

```bash
for u in https://overpass.deflock.org https://overpass.kumi.systems https://overpass-api.de; do
  printf '%-34s ' "$u"
  curl -s -o /dev/null -w '%{http_code} in %{time_total}s\n' -m 30 \
    --data-urlencode 'data=[out:json][timeout:25];node["man_made"="surveillance"]["surveillance:type"~"^(ALPR|ANPR)$",i](38.9,-94.7,39.0,-94.6);out count;' \
    "$u/api/interpreter"
done
```

`000` means the mirror is not answering at all. Drop it for the run:

```bash
FWM_OVERPASS_SKIP='https://overpass.kumi.systems/api/interpreter' \
  node scripts/capture-deflock-source.mjs --out=/tmp/darkroute-source-capture
```

`FWM_OVERPASS_SKIP` will leave a single endpoint if that is all there is, see
the note in `queryOverpassCandidate`. Cross-mirror independence is a preference
now, not a requirement: the endpoints that did not answer the count are tried
first, and the counting instance is used as a fallback instead of the run being
failed. The owner's ruling, 2026-09-06, is that if one mirror gives us the data
then we have the data; a second source is validation, not a freshness gate. The
split is tallied and printed at the end of every run.

#### The mirrors are not interchangeable, and one of them cannot do subtractions

`overpass.deflock.org` **has no areas database.** Asked for the CA subtraction it
returns HTTP 200 with an HTML body:

```
Error: runtime error: open64: 2 No such file or directory
       /opt/overpass/db//osm3s_areas Unix_Socket::7
```

That is permanent, not load. The tile queries are bounding boxes and it serves
them fine and fast, all 88 data leaves passed against it alone. The subtraction
query uses `area["ISO3166-1"="CA"]`, and that needs a database it does not run.

Check before choosing what to skip:

```bash
for u in https://overpass.deflock.org https://overpass.kumi.systems https://overpass-api.de; do
  printf '%-34s ' "$u"
  curl -s -m 60 --data-urlencode \
    'data=[out:json][timeout:25];area["ISO3166-1"="CA"]["admin_level"="2"]->.a;out count;' \
    "$u/api/interpreter" | grep -oE 'runtime error[^<]*|osm3s' | head -1
done
```

A run therefore needs **at least one areas-capable mirror active**, whatever else
it skips. Skipping down to `deflock.org` alone gets you through every tile and
then dies at `subtraction:CA` every time.

#### What happens when you are down to two mirrors

Skipping a dead endpoint is necessary and not sufficient. The data query
excludes whichever endpoint answered the count, so with `n` endpoints every data
request lands on one of `n - 1`. At three healthy mirrors that is two carrying
data; at two it is **one**, and the whole capture funnels onto it.

That is what killed the third attempt: kumi skipped, `deflock.org` answering
counts, and all 87 data leaves piling onto `overpass-api.de`, seven HTTP 429s
and a dead run, with `deflock.org` never appearing in the log at all.

`tileConcurrency()` in `scripts/deflock-capture.mjs` now derives the batch size
from the endpoints in play, holding about two requests in flight per data
mirror: three endpoints gives 4, two gives 2. Nothing to tune by hand, but if
you are down to two mirrors, expect the run to take roughly twice as long, and
do not "speed it up" by raising it. The 429 is the mirror asking you not to.

### 2. Propose a receipt

```bash
node scripts/propose-deflock-source-review.mjs \
  --capture-dir=/tmp/darkroute-source-capture \
  --camera-target=/tmp/darkroute-camera-release/cameras \
  --predecessor=/tmp/darkroute-predecessor/camera-predecessor.json \
  --out=/tmp/darkroute-source-capture/deflock-us-source-review.proposed.json
```

Validates the capture, applies the staged deletion ledger and the strict
US/DC/PR geofence, discovers the official hourly overlap, and writes a receipt
whose status is **deliberately `unapproved`**. This script never approves a
source and never writes camera tiles or sync state.

### 3. a human approves one field

From the proposal script's own header:

> Human review is the only operation allowed to promote that one field to
> `approved`.

Read the proposed receipt, the watermark, the `minimumOsmBase` it now carries,
the replication floor it derives, and if it is sound, promote
`sourceWatermark.status` to `approved` and check the receipt in alongside its
response ledger.

**This step is the owner's and cannot be delegated to an agent.** An agent
flipping that field is precisely the synthetic approval the validator exists to
refuse, and it would be indistinguishable in the file from a real review.

Sync accepts the source once the receipt validates.

## Verifying

```bash
node -e "import('./scripts/fetch-cameras-deflock.mjs').then(m => {
  m.validateSourceReview(JSON.parse(require('node:fs').readFileSync(
    'scripts/data/deflock-us-source-review.json','utf8')));
  console.log('receipt validates');
})"
```

Throwing is the current, correct behaviour. It printing `receipt validates` is
the goal.
