# Taxonomy and export

What DarkRoute calls things, what each term actually means, how every concept
maps onto OpenStreetMap, DeFlock, the EFF Atlas of Surveillance and plain
CSV/GeoJSON — and runnable commands that turn the published files into those
shapes.

This document is written for **somebody building against this data who does not
work on it and has no reason to trust it.** Every mapping is a field
correspondence you can check, every count was measured across the full 132,068-
record archive, and every recipe in §4 was executed against the real files before
being written down. Where a mapping does not exist, this says so rather than
inventing one. The counts describe the dated audit snapshot named under
“Provenance of this document”, not a live total; the served `index.json` is the
current catalogue.

Companion documents: [DATA-PROVENANCE.md](./DATA-PROVENANCE.md) for where the
data comes from and how fresh it is; [DATA-CONTRACTS.md](./DATA-CONTRACTS.md)
for byte-level schemas, the signed record and the protobuf surface;
[LEGAL.md](./LEGAL.md) for the licensing position.

---

## 0. The shortest possible orientation

DarkRoute publishes **one entity type**: an ALPR/ANPR camera, at a point, derived
from an OpenStreetMap node. Everything else in this document is either a
property of that entity, a container for it, or a piece of runtime vocabulary
that never leaves the device.

```
/cameras/index.json         the catalogue — count, bbox, two timestamps
/cameras/11/{x}/{y}.json    the records, in slippy tiles at zoom 11
/cameras/overview.json      every camera as [lat, lon, lat, lon, …]
/cameras/tombstones.json    what was removed, and why
/cameras/counties.json      FIPS → county name     (stale counts — §5.6)
/cameras/places.json        GEOID → place name     (stale counts — §5.6)
```

Licence: **ODbL-1.0**. Attribution: `Map data © OpenStreetMap contributors`.
Both obligations follow the data into whatever you build. §5.2.

**The three things that break naive consumers**, up front so you do not have to
find them the hard way:

1. `overview.json` is `[lat, lon, …]`. **GeoJSON is `[lon, lat]`.** This is the
   single most common conversion bug in this domain.
2. `directionDeg: null` means **unknown**. Emitting `0` turns "we don't know"
   into "it faces north".
3. `tags` is an **untyped string map**, and for most keys absence is the
   majority case. Copy it through; do not coerce it into a fixed schema.

---

## 1. The canonical vocabulary

Definitions, not glossary filler. Each term states what it _is_, what it is
**not**, and where it is defined in code.

### 1.1 Camera

**A device that photographs vehicles and reads their number plates, at a fixed
point, mapped by somebody.**

Not: a surveillance camera in general, a speed camera, a red-light camera, a
gunshot detector, a doorbell. OSM holds all of those under
`man_made=surveillance`; DarkRoute takes only the subset that also carries
`surveillance:type=ALPR` or `ANPR`, matched case-insensitively.

**One record is one OSM node, which is one contributor's placement.** It is not a
physical-device inventory. A pole with three cameras on it may be one node or
three, depending on who mapped it. Two nodes a few feet apart may be one camera
mapped twice. The app deduplicates for alerting at runtime
(`DEFAULT_DEDUPE_EPSILON_FT = 50`) but the **published data is not deduplicated**
— collapsing two contributors' nodes into one in a published extract would be
asserting a fact about the world that nobody surveyed.

Source: `scripts/fetch-cameras.mjs` `normalise()`.

### 1.2 ALPR / ANPR

**Automatic Licence Plate Reader** (US) and **Automatic Number Plate
Recognition** (UK) are the same thing.

The retained first-party Overpass capture and hourly patrol both accept
**either**, case-insensitively:

```js
const type = (tags['surveillance:type'] ?? '').toUpperCase();
return type === 'ALPR' || type === 'ANPR';
```

The mapper-written spelling and case are preserved through capture and
transformation. An `anpr` source assertion is never rewritten into a false
`ALPR` tag.

### 1.3 Node — **this word means two unrelated things**

Flagged first because it is the one collision that will bite you.

| Sense         | Meaning                                                            | Where                       |
| ------------- | ------------------------------------------------------------------ | --------------------------- |
| **OSM node**  | a point object in OpenStreetMap; the origin of every camera record | §1.1, `id: "osm:<node id>"` |
| **Mesh node** | a Meshtastic LoRa radio in Bluetooth or radio range of the phone   | §1.13, `MeshNode`           |

They share no id space, no schema and no lifecycle. This document says "OSM
node" or "mesh node" and never bare "node" for either.

### 1.4 Mount

**What the camera is physically attached to** — pole, street lamp, traffic
signal, wall, gantry, building.

Carried as the OSM tag `camera:mount`, verbatim. DarkRoute has no mount
enumeration of its own for published data, because the tag has **397 distinct
values in this archive** and inventing an enum would mean discarding what the
mapper actually wrote. Normalise on read; §3.6 has the table.

The one place DarkRoute _does_ have an enum is the **report sheet**, where a
driver picks from `pole | solar | trailer | unsure`. That is an input
vocabulary, and the mapping out of it is deliberately lossy — see §3.1.

Not the same as **`camera:type`**, which is the physical _form_ — `fixed`,
`dome`, `panning`. 95.75% of this archive is `fixed`.

### 1.5 Facing (`directionDeg`)

**The compass direction the lens points TOWARD**, degrees clockwise from true
north, `[0, 360)`.

Not: the direction of traffic it watches. Not: the bearing from you to it.

`null` means **unknown**, and never "not facing you". An unknown-facing camera
reads every plate it can see, so it stays in every list, every count and every
alert. This rule is written into `@fwm/core`'s type comment and holds all the way
out to the published tile.

Six upstream encodings collapse into this one number — plain degrees, semicolon
lists, covered arcs, cardinal letters, omnidirectional, and absent. The parse
table and its two known bugs are [DATA-PROVENANCE.md](./DATA-PROVENANCE.md) §3.1,
and **`directionDeg` in the current archive is behind its own tags for 6,194
records** — §5.6 and the fix in §4.6.

Source: `packages/core/src/types.ts` `CameraLike`, `scripts/fetch-cameras.mjs`
`parseDirection()`.

### 1.6 Subject and observer

The two positions in a driver's report, and the distinction is the whole reason
the report schema was versioned.

| Term         | Meaning                                                                                                          | Published?             |
| ------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **subject**  | the **camera**. `subject_position` is where somebody established the camera is, or `null`.                       | **yes**, and only this |
| **observer** | the **phone**. `observer_position` is the driver's GPS fix. Provenance for the accuracy figure and nothing else. | **never**              |

`fwm-report/v1` had a single field, `position`, holding the phone's fix, which
three consumers read as the camera's. That produced cameras filed in traffic
lanes with a uniform offset, a duplicate-radius check comparing a road point
against pole points, and a seven-decimal record of where one person's car was.

**There is deliberately no `observer` member of `subject_position_source`.** "The
camera is where the driver was" is the v1 bug, and giving it a name would make it
expressible again. `osmNodePosition()` reads `subject_position` and nothing else,
and has **no parameter** to enable a fallback.

If you are consuming DarkRoute data: you will only ever see subject positions.
Observer positions do not leave the device.
[DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §2.1, §6.5.

### 1.7 Owner type

**A five-way bucket over the OSM `operator` tag**, inferred by regex.

`police | inter_agency | hoa | private | unverified`

**82.31% of the archive is `unverified`**, because OSM carries `operator` on
17.69% of these nodes. That is the honest answer, not a placeholder.

**This is the only inferred field in the published record. Treat it as a
convenience index over `tags.operator`, never as evidence.** If you are doing
accountability work — FOIA, a council meeting, a lawsuit — read `tags.operator`
and accept that it is absent five times out of six. §3.6 has the regex and the
distribution.

### 1.8 Confirmations

**How many independent placements stand behind this record.**

Always `1` today: one OSM node is one contributor's placement, and DarkRoute's
own confirmations do not exist yet because reports are not uploaded. It is
published so that a consumer's schema does not have to change when they do.

Do not read it as a quality score.

### 1.9 Alert state

**The four-state machine that drives what the driver sees and feels.** Runtime
only — no published file contains one.

```
clear | approaching | in_range | multiple
```

| State         | Entered when                                     | Haptic   |
| ------------- | ------------------------------------------------ | -------- |
| `clear`       | nothing inside 1,000 ft, or no camera known      | 0 pulses |
| `approaching` | nearest camera in **(threshold, 1000] ft**       | 1 pulse  |
| `in_range`    | nearest camera **≤ threshold**, exactly 1 inside | 2 pulses |
| `multiple`    | nearest ≤ threshold, **≥ 2** inside              | 2 pulses |

Threshold is the driver's setting: default **500 ft**, range 100–1,000, step 50.

**Hue means state and nothing else.** `in_range` and `multiple` share a pulse
count on purpose and are told apart by colour.

**Hysteresis is asymmetric.** Entering costs `thresholdFt`; leaving costs
`thresholdFt + hysteresisFt` (default 50 ft, one bezel step). Without it a camera
sitting at 500.0 ft with a metre of GPS jitter toggles the whole screen several
times a second.

**Muting changes the state machine not at all.** A muted camera still transitions,
still stores its assessment, still writes a history row, still moves the exposure
counter. Mute touches exactly three derived fields — `shouldAlertUser`,
`hapticPulses`, `notifyCameraIds`. There is a test that drives the same tick
sequence twice, muted and unmuted, and asserts the two records are identical. A
mute inside 150 ft is pierced anyway, and the app says so out loud.

Source: `packages/core/src/alert.ts`, `packages/core/src/types.ts`.

### 1.10 Proximity band

**A distance ring, in feet.** Two distinct sets, and they are not the same thing:

| Set             | Values                                       | What they are for                    |
| --------------- | -------------------------------------------- | ------------------------------------ |
| **SWEEP rings** | `100, 300, 500, 1000` ft                     | the drawn rings on the radar display |
| **Alert bands** | `≤ threshold`, `(threshold, 1000]`, `> 1000` | what actually changes state          |

`APPROACHING_OUTER_FT = 1000` is the outer edge of any alerting at all.

Distances are **feet, in the product's own vocabulary**, because every design
source and every screen is in feet. Conversions to metres happen at the geometry
boundary (`feetToMetres`), never in the UI.

### 1.11 Relative direction

**Which quadrant the camera sits in, relative to where the vehicle is pointing.**

```
ahead | left | right | behind
```

Four 90° sectors, `ahead` centred on the heading (`AHEAD_HALF_ANGLE_DEG = 45`).
The radar draws a finer label on top ("AHEAD · SLIGHT LEFT"); that is
presentation, derived from the raw relative angle, not from this type.

### 1.12 Facing-the-vehicle

**Whether the camera's lens is pointed back at you**, as opposed to which
quadrant it is in.

`isFacingVehicle(cameraDirection, vehicleBearingToCamera, tolerance = 30°)`
returns `true`, `false`, or **`null` when the facing is unknown** — never `false`.
The tolerance is ±30°, a 60° wedge, which is what the report sheet's facing dial
draws.

Three separate concepts that novices merge, kept apart on purpose:

|                     | Question                                      |
| ------------------- | --------------------------------------------- |
| `directionDeg`      | where is the lens pointed, in absolute terms? |
| `relativeDirection` | where is the camera, relative to my heading?  |
| `isFacingVehicle`   | is the lens pointed at me?                    |

### 1.13 Mesh node

**A Meshtastic LoRa radio the phone can see** — over Bluetooth (the one it is
connected to) or over the air (everything that radio has heard).

Fields: node number as hex, long and short name, SNR, battery percent or voltage,
hops away, last-heard (**the radio's clock, not the phone's**, so a roster entry
predating the app session still has an honest age), channel utilisation, air-time,
whether it has announced a public key, role, hardware, and `viaMqtt`.

`viaMqtt` is surfaced plainly because **an MQTT-bridged node is not evidence that
anything is in radio range**, and a roster that hides the difference makes the
mesh look healthier than it is.

DarkRoute defines **no protobuf of its own** — every message is upstream
Meshtastic, on stock firmware. [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §5.

### 1.14 Channel

**One row of the radio's channel table**: an index, a name, and a role of
`DISABLED`, `PRIMARY` or `SECONDARY`.

DarkRoute writes **`SECONDARY`, never `PRIMARY`**. A primary channel sets the
radio's frequency; writing one would move somebody off the mesh they already use.
A secondary channel ignores radio settings and uses only its PSK, so the primary
channel, the frequency, the region and the modem preset are all untouched.
Writing one also transmits nothing — the admin packet is addressed to the local
node.

### 1.15 Sighting

**A 16-byte frame describing a camera**, broadcast on Meshtastic private port 256. The only wire format DarkRoute defines itself, and it is not a protobuf.

It has **no field for the driver** — no observer position, no heading, no speed,
no identity, no timestamp. It describes a camera and nothing else, and
`sighting.test.ts` asserts exactly that. Coordinates are `1e-5` degrees, matching
the published archive's precision, so the frame cannot leak a finer position than
is already public. [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §5.8.

### 1.16 Tombstone

**A published statement that a camera id was removed, and why.**

```json
{ "id": "osm:12341624190", "reason": "osm_delete", "seq": 122203, "osmVersion": 3 }
```

| `reason`                 | Meaning                                                                                   | Count                   |
| ------------------------ | ----------------------------------------------------------------------------------------- | ----------------------- |
| `osm_delete`             | the OSM node was deleted upstream                                                         | 179                     |
| `osm_untag`              | the node still exists but is no longer tagged as an ALPR                                  | 17                      |
| `osm_out_of_scope`       | a newer qualifying version moved outside the strict 50-states/DC/PR geometry              | 0                       |
| `cutover_reconciliation` | one-time legacy predecessor continuity, proven against the exact current OSM node version | 0 in the audit snapshot |

A tombstone exists because **a client that only ever merges additions never
forgets anything.** Removals have to be published explicitly. For the three
`osm_*` reasons, `seq` is the OSM replication sequence that carried the change.
For `cutover_reconciliation`, it is the official hourly observation fence for
the current-version API proof, not a claim that that diff removed the node.
Together with the exact `osmVersion`, it makes the ledger ordered and
idempotent. A predecessor-live id is checked even when an inherited historical
tombstone has the same id; the proved current reconciliation entry replaces
that stale entry rather than treating it as coverage.

**Absence from a fetch is never a tombstone.** That is Rule 0 of the whole
pipeline, and it is why this file exists rather than a diffing convention.

---

## 2. The record, field by field

One camera, verbatim from tile `11/606/765`:

```json
{
  "id": "osm:13398047427",
  "lat": 41.32554,
  "lon": -73.47414,
  "directionDeg": 175,
  "ownerType": "police",
  "confirmations": 1,
  "countyFips": "09001",
  "placeGeoid": "0965685",
  "tags": {
    "camera:mount": "street_lamp",
    "camera:type": "fixed",
    "check_date": "2025-08-26",
    "direction": "175",
    "manufacturer": "Flock Safety",
    "mapillary": "2518291208548633",
    "operator": "Ridgefield Police Department",
    "surveillance": "public",
    "surveillance:zone": "traffic"
  }
}
```

| Field           | Type                    | Coverage        | Authority    | Notes for a consumer                                                                              |
| --------------- | ----------------------- | --------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| `id`            | `string`                | 100%            | OSM          | `osm:<node id>`. **Split on the first `:`**; do not assume the remainder stays numeric forever.   |
| `lat`, `lon`    | `number`                | 100%            | OSM          | WGS-84, **5 dp** (~1.1 m).                                                                        |
| `directionDeg`  | `number \| null`        | 93.82% non-null | derived      | `null` = unknown. See §4.6 before you trust it.                                                   |
| `ownerType`     | enum                    | 100% present    | **inferred** | 82.31% `unverified`. Convenience index, not evidence.                                             |
| `confirmations` | `number`                | 100%            | ours         | always `1`.                                                                                       |
| `countyFips`    | `string(5)`             | 98.02%          | US Census    | absent for 2,621 records; **no nearest-county fallback**.                                         |
| `placeGeoid`    | `string(7)`             | 78.75%          | US Census    | absent for 28,062 records, mostly unincorporated land. "Near Overland Park" ≠ "in Overland Park". |
| `street`        | `string`                | 77.73%          | TIGER 2023   | upper-cased. Absent for 29,416 records with no road within 40 m.                                  |
| `cross`         | `string`                | 64.29%          | TIGER 2023   | nearest _different_ named road.                                                                   |
| `osmVersion`    | `number`                | **1.45%**       | OSM          | present only on records the hourly patrol has touched.                                            |
| `updatedAt`     | `number`                | **0.06%**       | OSM          | epoch ms.                                                                                         |
| `tags`          | `Record<string,string>` | 99.96%          | OSM mappers  | **untyped**, 212 distinct keys.                                                                   |

Tile envelope:

| Field          | Notes                                                                   |
| -------------- | ----------------------------------------------------------------------- |
| `z`, `x`, `y`  | always `z: 11`                                                          |
| `attribution`  | `Map data © OpenStreetMap contributors` — **in every tile body**        |
| `licence`      | `ODbL-1.0`                                                              |
| `streetSource` | `US Census TIGER/Line 2023 ROADS (all roads)` — on 8,508 of 8,605 tiles |
| `cameras`      | the array                                                               |

**A tile with no ALPR in it returns 404.** That is "genuinely empty", not an
error, and it is the majority of the country.

---

## 3. Mapping tables

### 3.1 → OpenStreetMap tags

OSM is the source, but the retained first-party capture intentionally projects a
documented tag surface instead of copying every mapper tag. Values that survive
that projection remain mapper-written strings; derived fields must be
reconstructed or dropped.

| DarkRoute         | OSM                                  | Direction                 | Notes                                                                                                                                                                                      |
| ----------------- | ------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`              | element id, `node/<n>`               | **exact**, strip `osm:`   | ways are excluded on purpose — §5.5                                                                                                                                                        |
| `lat`, `lon`      | node position                        | **exact**, 5 dp           |                                                                                                                                                                                            |
| —                 | `man_made=surveillance`              | **implicit**              | stripped as redundant; re-add on export                                                                                                                                                    |
| —                 | `surveillance:type=ALPR\|ANPR`       | **implicit**              | case-insensitive admission; mapper spelling/case is retained                                                                                                                               |
| `directionDeg`    | `direction`, else `camera:direction` | **lossy**                 | six encodings → one number; multi-direction loses all but the first                                                                                                                        |
| `ownerType`       | `operator`                           | **derived, one-way**      | do not reconstruct `operator` from it                                                                                                                                                      |
| `countyFips`      | —                                    | **no counterpart**        | Census, not OSM                                                                                                                                                                            |
| `placeGeoid`      | —                                    | **no counterpart**        | Census, not OSM                                                                                                                                                                            |
| `street`, `cross` | —                                    | **no counterpart**        | TIGER, not OSM. Do **not** write these into OSM.                                                                                                                                           |
| `confirmations`   | —                                    | **no counterpart**        | ours                                                                                                                                                                                       |
| `osmVersion`      | element `version`                    | **exact**                 |                                                                                                                                                                                            |
| `updatedAt`       | element `timestamp`                  | **exact**, ms ↔ ISO-8601  |                                                                                                                                                                                            |
| `tags.*`          | selected mapper tags                 | **selected, value-exact** | `brand`, `manufacturer`, `operator`, `surveillance:zone`, `camera:mount`, `direction`, `camera:direction`, `ref`, and `start_date`; the two query tags are stripped from published records |

`direction` / `camera:direction` is parsed separately into `directionDeg`; the
first resolvable bearing is retained, including fractional degrees. The capture
does not claim that tags outside the table survived. A later adapter must not
describe this selected surface as a verbatim copy of the complete OSM tag map.

**What the app writes when a driver reports a camera** — `newCameraTags()`, and
this is the vocabulary DarkRoute contributes back:

```
man_made          = surveillance
surveillance:type = ALPR
surveillance      = public          # corpus majority, 76.48%
surveillance:zone = traffic         # corpus majority, 83.81%
camera:type       = fixed
direction         = <whole degrees>          when a bearing exists
camera:mount      = pole                     when the mount maps
manufacturer      = Flock Safety             only when the text matches /\bflock\b/i
manufacturer:wikidata = Q108485435           same condition
```

Three corrections in there that the obvious tagging gets wrong, each measured
against the live corpus rather than intuition:

| Obvious choice                             | What the corpus says                                                                                      | What DarkRoute writes                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `operator=Flock Safety`                    | the community **split** these: Flock _builds_ the camera, the operator _owns the footage_                 | `manufacturer=Flock Safety`, and **never** `operator`         |
| `camera:direction`                         | the wiki documents it; the corpus does not use it — `direction` is on 97.22%, `camera:direction` on 1.73% | `direction`. **Write what the data uses; read both forever.** |
| `surveillance:type=camera` + `camera:type` | `camera:type` carries the physical _form_, a different question                                           | `surveillance:type=ALPR`                                      |

The report sheet's mount enum maps out deliberately lossily:

```
pole    -> camera:mount=pole
solar   -> camera:mount=pole
trailer -> (nothing)
unsure  -> (nothing)
```

`unsure` maps to nothing because a driver at speed genuinely may not know, and
inventing `pole` because it is the commonest answer would put a **guess** into a
public database under their account. `trailer` maps to nothing because
`camera:mount=trailer` has **38 uses worldwide** and does not appear at all under
`surveillance:type=ALPR` — pointing a userbase at a 38-use value is how an app
invents a tag by force. The observation is still recorded locally; only the
global claim is withheld.

**Every field the driver left blank is absent rather than defaulted.** A tag
nobody observed is a claim nobody made, and it arrives in OSM under their name.

Full contract: [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §6.

### 3.2 → DeFlock / FlockHopper GeoJSON

DeFlock's bulk export (`data.dontgetflocked.com/cameras.geojson.gz`) is the same
OSM-derived data in a different shape. DarkRoute treats that archive as a
possible build-time transport for OSM records, not as a second factual source
or an independent confirmation. Driver devices do not fetch it. See the public
[source and transport policy](./AGGREGATION-POLICY.md#source-and-transport-roles).

That means **conversion between the two is a rename, not a transformation** — for
the fields both carry.

| DarkRoute                   | DeFlock property                    | Correspondence                                                                                                                      |
| --------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `id` (`osm:<n>`)            | `osmId` (number) + `osmType`        | **exact**, ours is prefixed and node-only                                                                                           |
| `lat`, `lon`                | `geometry.coordinates` `[lon, lat]` | **order is swapped**                                                                                                                |
| `directionDeg`              | `direction` (number)                | **near-exact**; theirs is 0–359.5, int or float                                                                                     |
| —                           | `directions` (array)                | **we drop this.** 8,141 of our records (6.16%) have a semicolon list; we keep the first, they keep all. **DeFlock is richer here.** |
| —                           | `directionCardinal`                 | we resolve cardinals into `directionDeg`; they keep the letters                                                                     |
| `tags.manufacturer`         | `brand`                             | theirs is **normalised** from `manufacturer` _or_ `brand`; ours is verbatim                                                         |
| `tags.operator`             | `operator`                          | **exact**, both ~17% populated                                                                                                      |
| `tags["surveillance:zone"]` | `surveillanceZone`                  | **exact**, both dirty                                                                                                               |
| `tags["camera:mount"]`      | `mountType`                         | **exact**, both dirty (397 vs 398 distinct values)                                                                                  |
| `tags.ref`                  | `ref`                               | exact                                                                                                                               |
| `tags.start_date`           | `startDate`                         | exact                                                                                                                               |
| `osmVersion`                | `osmVersion`                        | **exact** — theirs is 100%, ours is 1.45%                                                                                           |
| `updatedAt` (epoch ms)      | `osmTimestamp` (ISO-8601)           | **exact**, unit differs — theirs is 100%, ours is 0.06%                                                                             |
| `ownerType`                 | —                                   | **no counterpart.** Ours, inferred.                                                                                                 |
| `countyFips`, `placeGeoid`  | —                                   | **no counterpart.** Census join; DeFlock has no state or province field at all.                                                     |
| `street`, `cross`           | —                                   | **no counterpart.** TIGER join.                                                                                                     |
| `confirmations`             | —                                   | no counterpart                                                                                                                      |

**Where each is stronger, stated plainly:**

|                      | DeFlock/FlockHopper                       | DarkRoute                                     |
| -------------------- | ----------------------------------------- | --------------------------------------------- |
| element coverage     | nodes **and** ways (18 ways)              | nodes only, by design (§5.5)                  |
| multi-direction      | `directions` array, all bearings          | first only — a real loss                      |
| per-record freshness | `osmVersion` + `osmTimestamp` at **100%** | 1.45% / 0.06%                                 |
| geographic joins     | none                                      | county FIPS, place GEOID, street, cross       |
| removals             | not published as a ledger                 | `tombstones.json` with reason + sequence      |
| shape                | one 35.5 MB file, plus hourly PMTiles     | 8,605 addressable tiles, plus a flat overview |

If you already consume DeFlock, DarkRoute's tiles buy you **addressability,
Census joins and an explicit deletion ledger.** If you already consume DarkRoute,
DeFlock buys you **complete OSM versioning and every bearing on a multi-camera
pole.** They are not competitors at the data layer; they are the same OSM corpus
cut two ways.

### 3.3 → EFF Atlas of Surveillance

**This is a join, not a field mapping, and pretending otherwise is the mistake.**

|             | Atlas                                       | DarkRoute                         |
| ----------- | ------------------------------------------- | --------------------------------- |
| grain       | **agency × technology**                     | **camera**                        |
| rows        | 4,145 ALPR rows                             | 132,068 camera records            |
| coordinates | **none, at all**                            | every record                      |
| key         | `NEWAOSNUMBER (ORI9)`, e.g. `OHCIP0000ALPR` | `osm:<node id>`                   |
| licence     | **CC BY 4.0**                               | ODbL-1.0                          |
| carries     | vendor, summary, 1–3 sourced links          | position, facing, tags, geography |

**There is no field correspondence between an Atlas row and a camera record,
because they describe different objects.** The only bridge is the operator name.

| DarkRoute       | Atlas                            | How                                                                                                             |
| --------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `tags.operator` | agency name                      | **string match, after normalisation.** Available on 17.69% of records.                                          |
| `countyFips`    | Atlas `County`, resolved to FIPS | **geographic**, agency-level only                                                                               |
| —               | `ORI9`                           | store this, **not** the `AOSNUMBER`: 3,240 numbers in the 1..18,419 range are retired and a cached one will 404 |

Four source-grain and provenance rules are worth inheriting whatever you build
([policy](./AGGREGATION-POLICY.md#identity-and-merge-rules)):

1. **Never plot an Atlas row on a map.** They have no coordinates; their own map
   geocodes from the agency city and their `/methodology` says it "makes
   mistakes". EFF's About page explicitly asks people **not** to send them camera
   locations, and points at DeFlock instead.
2. **Never hard-delete a withdrawn row.** You may already have shown somebody a
   citation built on it. A vanished id means "EFF removed the row", never "the
   camera is gone".
3. **Normalise `County` before it touches anything.** Strip `U+200E`, strip
   trailing `.` and `|`, fix `Conuty` / `Coutny` / `Counthy` / `Parsih`, drop
   `#REF!`, split `"Berkeley County/ Charleston County."`, then resolve
   `(state, county)` → FIPS. 175 county names repeat across states.
4. **Be honest about what a match means.** With an operator match, "cross-
   referenced" is a fair label. With geography alone, the honest label is
   "_n_ agencies in this county" — which is a different and weaker claim.

Attribution CC BY 4.0 requires, verbatim from the contract:

```
Source: Atlas of Surveillance, a project of the Electronic Frontier Foundation
and the University of Nevada, Reno Reynolds School of Journalism — CC BY 4.0 —
modified
```

with a per-record permalink to `https://www.atlasofsurveillance.org/a/{ori9}`.
The "modified" indication is required by §3(a)(1) and any county normalisation or
agency join counts as modification.

### 3.4 → plain CSV

A flat table. **Lossy on purpose**, and you should know exactly how.

| CSV column                   | From                        | Loss                                                       |
| ---------------------------- | --------------------------- | ---------------------------------------------------------- |
| `id`                         | `id`                        | none                                                       |
| `lat`, `lon`                 | `lat`, `lon`                | none                                                       |
| `direction_deg`              | `directionDeg`              | **`null` and empty become indistinguishable** — 8,160 rows |
| `owner_type`                 | `ownerType`                 | none                                                       |
| `manufacturer`               | `tags.manufacturer`         | none                                                       |
| `operator`                   | `tags.operator`             | none                                                       |
| `camera_mount`               | `tags["camera:mount"]`      | none                                                       |
| `camera_type`                | `tags["camera:type"]`       | none                                                       |
| `surveillance_zone`          | `tags["surveillance:zone"]` | none                                                       |
| `county_fips`, `place_geoid` | same                        | none                                                       |
| `street`, `cross`            | same                        | none                                                       |
| —                            | **the other ~200 tag keys** | **dropped entirely**                                       |

**The `null` collapse is the hazard.** In JSON, `directionDeg: null` says "we do
not know". In CSV it is an empty cell, which also means "this column is empty".
Exactly 8,160 rows are affected. If facing matters to your analysis, either add
an explicit `direction_known` column or use GeoJSON. §4.4.

The escaping is real, not hypothetical — this archive contains
`Neology, Inc.` in `manufacturer` and
`surveillance:zone = "fireworks,weponds,and secoret bfs"`. Use a CSV writer
(`@csv` in jq does this correctly); do not join with commas by hand.

### 3.5 → GeoJSON

The near-lossless target.

| GeoJSON                                          | From                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `Feature.id`                                     | `id`                                                                            |
| `geometry`                                       | `{ "type": "Point", "coordinates": [lon, lat] }` — **note the order**           |
| `properties.*`                                   | every derived field plus **the whole published selected `tags` map, flattened** |
| top-level `attribution`, `licence`, `licenceUrl` | copied from the tile envelope                                                   |

`attribution`, `licence`, and `licenceUrl` are not standard GeoJSON members,
and that is fine —
RFC 7946 §6.1 allows foreign members, and ODbL §4.2 asks the notice to travel _in
the data_. Put them at the top level of the `FeatureCollection`; do not drop them.

Flattening `tags` into `properties` is the right default because OSM tag keys
(`camera:mount`) are legal JSON keys and nothing collides with the derived names
if you snake_case those. If you would rather nest, keep `properties.tags` intact
— just do not silently discard it.

### 3.6 Value normalisation — the tables you will actually need

These are OSM tag values as mappers wrote them. **Every one of these fields is
free text; none is an enum.** Measured across all 132,068 records.

**`camera:mount`** — 40,366 records (30.56%), **397 distinct values**:

| Value                                                            | Count       | Normalises to                                                    |
| ---------------------------------------------------------------- | ----------- | ---------------------------------------------------------------- |
| `pole`                                                           | 30,236      | `pole`                                                           |
| `street_lamp`                                                    | 3,480       | `street_lamp`                                                    |
| `traffic_signals`                                                | 2,588       | `traffic_signal`                                                 |
| `post`                                                           | 2,042       | `pole`                                                           |
| `traffic_signal`                                                 | 643         | `traffic_signal`                                                 |
| `wall`                                                           | 265         | `wall`                                                           |
| `gantry`                                                         | 177         | `gantry`                                                         |
| `building`                                                       | 85          | `building`                                                       |
| `bridge`                                                         | 43          | `bridge`                                                         |
| `Pole`                                                           | 40          | `pole` — **case**                                                |
| `ceiling`                                                        | 35          | `ceiling`                                                        |
| `utility pole`                                                   | 31          | `pole` — **space**                                               |
| `trailer`                                                        | 26          | `trailer`                                                        |
| `light pole` / `telephone pole` / `utility_pole` / `streetlight` | 18/17/16/15 | `pole` / `street_lamp`                                           |
| `fixed`, `PTZ`, `sign`                                           | 11/8/10     | **not a mount at all** — `camera:type` values in the wrong field |

Minimum viable normalisation: lower-case, replace spaces with underscores, then
fold `post|utility_pole|light_pole|telephone_pole|streetlight → pole`,
`traffic_signals → traffic_signal`.

**`surveillance`** — 116,213 records (87.99%), **90 distinct values**:

| Value                       | Count   | Share  |
| --------------------------- | ------- | ------ |
| `public`                    | 101,001 | 76.48% |
| `traffic`                   | 11,160  | 8.45%  |
| `outdoor`                   | 2,219   | 1.68%  |
| `camera`                    | 1,360   | 1.03%  |
| `private`                   | 152     | 0.12%  |
| everything else (85 values) | 321     | 0.24%  |

Those top four are **not four distinct facts. They are four people guessing at
the same one.** Anything filtering on `surveillance=public` silently drops
~15,000 cameras. The long tail includes `flock`, `alpr`, `ALPR`,
`man_made=surveillance` (the key pasted into the value), `trafic`, `teaffic`,
`pubic`, and one `unconstitutional_4th_amendment`.

Section 6 proposes collapsing this to three values across the whole ecosystem.

**`surveillance:zone`** — 115,437 records (87.41%), **114 distinct values**:

| Value      | Count   | Share  |
| ---------- | ------- | ------ |
| `traffic`  | 110,689 | 83.81% |
| `street`   | 1,822   | 1.38%  |
| `parking`  | 819     | 0.62%  |
| `town`     | 607     | 0.46%  |
| `entrance` | 525     | 0.40%  |
| `public`   | 299     | 0.23%  |

**`camera:type`** — 126,877 records (96.07%), 45 distinct values:

| Value                   | Count   | Share  |
| ----------------------- | ------- | ------ |
| `fixed`                 | 126,460 | 95.75% |
| `dome`                  | 185     | 0.14%  |
| `panning`               | 84      | 0.06%  |
| `PTZ` / `pan tilt zoom` | 27 / 13 | —      |

**`operator:type`** — 3,997 records (**3.03%**), 20 distinct values:

| Value                                                                 | Count                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------- |
| `private`                                                             | 1,693                                                         |
| `government`                                                          | 1,075                                                         |
| `Public`                                                              | 590                                                           |
| `public`                                                              | 506                                                           |
| `municipal police`                                                    | 35                                                            |
| `police department`                                                   | 31                                                            |
| `business`, `university`, `Law Enforcement`, `law enforcement agency` | 18 / 12 / 10 / 7                                              |
| the remaining 10 values                                               | ≤ 5 each, including `Sherrif's Office` and `private_buisness` |

**3.03% coverage with `Public` and `public` as separate values** is not enough
resolution to answer "is this a police camera or a homeowners' association
camera", and those are very different facts about a street.

**`manufacturer`** — 121,485 records (91.99%):

| Value                     | Count   | Share  |
| ------------------------- | ------- | ------ |
| Flock Safety              | 103,555 | 78.41% |
| Motorola Solutions        | 6,396   | 4.84%  |
| Genetec                   | 3,088   | 2.34%  |
| Axis Communications       | 1,354   | 1.03%  |
| Leonardo                  | 1,091   | 0.83%  |
| PlateSmart/CyclopsTchnlgs | 660     | 0.50%  |
| Rekor                     | 600     | 0.45%  |
| Ubicquia, Inc.            | 568     | 0.43%  |
| Neology, Inc.             | 511     | 0.39%  |
| Flock Group Inc.          | 481     | 0.36%  |

Note `Flock Safety` and `Flock Group Inc.` are the same company under two
strings. Normalise on the `manufacturer:wikidata` QID (`Q108485435` for Flock)
where present — it is on 1,678 records — or on a name table.

**`ownerType`**, ours, and the regex behind it:

```js
if (operator === '')                                          return 'unverified';
if (/police|sheriff|patrol|dept|department of|city of|
     county|state of|dot\b/.test(operator))                    return 'police';
if (/hoa|homeowner|association|neighborhood|community/
     .test(operator))                                          return 'hoa';
if (/flock safety|genetec|motorola/.test(operator))            return 'inter_agency';
return 'private';
```

| Value          | Count   | Share  |
| -------------- | ------- | ------ |
| `unverified`   | 108,711 | 82.31% |
| `police`       | 14,665  | 11.10% |
| `private`      | 6,304   | 4.77%  |
| `inter_agency` | 2,182   | 1.65%  |
| `hoa`          | 206     | 0.16%  |

### 3.7 Concepts with no counterpart anywhere

Not everything maps. These are DarkRoute's runtime vocabulary and no published
file, ours or anyone else's, contains one:

| Concept                             | Why it does not map                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| alert state                         | depends on the driver's threshold, heading and history. Not a property of a camera. |
| proximity band                      | same                                                                                |
| relative direction                  | same                                                                                |
| observer position                   | **never leaves the device.** §1.6                                                   |
| trip, exposure count, alert history | on-device only, and carry no coordinate                                             |
| mesh node, channel, sighting frame  | radio-layer, ephemeral                                                              |
| plate vault, plate matches          | local-only by schema, never published, never a source for anything here             |

If you are building an interchange format for this domain, **do not include a
place for the observer**. The absence is the point.

---

## 4. Export recipes

Every command below was run against the real archive before being written down;
the outputs quoted are what it produced. `jq 1.7` and `node 22`.

### 4.0 Get the data

There is no API to get access to. The archive is a set of static files, and
there are two routes to them.

**From a deployment — works today.** Every file is served under `/cameras/`,
which is also what discharges ODbL §4.6 (see
[DATA-PROVENANCE §7.1](./DATA-PROVENANCE.md#71-the-dataset-is-served-not-shipped)).
Pull the two index files and whichever tiles you want:

```bash
mkdir cameras && cd cameras
BASE=https://<deployment>
for f in index.json overview.json tombstones.json counties.json places.json; do
  curl -s "$BASE/cameras/$f" -o "$f"
done
jq '{zoom, cameras, tiles, generatedAt}' index.json
#   { "zoom": 11, "cameras": 132068, "tiles": 8605, "generatedAt": "..." }
```

**`index.json` does not list the tiles.** `tiles` is a _count_. There is no
manifest, because the app never needs one: it knows which tile it wants from the
coordinate it is standing on, and a tile with no cameras simply 404s. So derive
the list from `overview.json`, which holds every camera as flat
`[lat, lon, lat, lon, …]`:

```bash
node -e '
const fs = require("fs");
const { coords } = JSON.parse(fs.readFileSync("overview.json", "utf8"));
const z = 11, n = 2 ** z, seen = new Set();
for (let i = 0; i + 1 < coords.length; i += 2) {
  const lat = coords[i], lon = coords[i + 1], r = lat * Math.PI / 180;
  const x = Math.floor((lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  seen.add(`${x}/${y}`);
}
console.log([...seen].join("\n"));
' > tiles.txt
wc -l tiles.txt          # 8605

while read -r t; do
  mkdir -p "11/${t%/*}"
  curl -s "$BASE/cameras/11/$t.json" -o "11/$t.json"
done < tiles.txt
```

That is the standard slippy-tile projection at z11, the same one the archive was
built with. **It yields 8,596 tiles, and `index.json` says 8,605.** The gap is
real and it is not an error in either number:

|       |                                                            |
| ----- | ---------------------------------------------------------- |
| 8,596 | tiles containing at least one camera — all 132,068 of them |
| **9** | tiles whose every camera has since been deleted upstream   |
| 8,605 | files on disk                                              |

The nine are kept deliberately. A client that has cached a tile needs an
authoritative _"this tile is now empty"_, and a 404 is not that — it is
indistinguishable from a tile that was never fetched. So an emptied tile stays,
as `{"cameras": [], …}`, and the removed records appear in `tombstones.json`
(196 entries, each with the reason). Deleting the file instead would leave every
existing install showing cameras that are gone.

If your derived count is anything other than 8,596, stop: the zoom or the
projection has changed underneath you.

**From the repository — at release.** A reviewed archive snapshot is tracked in
git as the bootstrap seed and reproducible source input. It is not a record
history or the current operational generation: the public repository begins at
a squashed release root, and hourly updates go to R2 without Git commits.

```bash
git clone https://github.com/darkcodelabs/darkroute.git
cd darkroute/apps/pwa/public/cameras
ls          # 11/ index.json overview.json tombstones.json counties.json places.json
```

The repository is public. Its history starts at the squashed release root;
private pre-public commits are not part of it, so there is no earlier commit to
check out. This document used to hand the clone over
as the only route and call it the thing that discharges §4.6, which was wrong on
both counts — the deployment was already doing that job. `pnpm check:links` now
probes every URL in these documents and fails on a dead one, so the claim cannot
drift back.

**Two working directories are used below.** The `jq` recipes (§4.1–§4.3, §4.7–§4.10)
run from wherever the `cameras` files are, by either route above. The `node`
recipes (§4.4–§4.6) import the project's own parser and therefore need the
source tree, run **from the repository root** — each one says so. Mixing them up
is the only way these fail.

### 4.1 One tile → GeoJSON

```bash
jq -c '{
  type: "FeatureCollection",
  attribution: .attribution,
  licence: .licence,
  features: [ .cameras[] | {
    type: "Feature",
    id: .id,
    geometry: { type: "Point", coordinates: [ .lon, .lat ] },
    properties: (
      ({ owner_type: .ownerType, confirmations: .confirmations,
         county_fips: .countyFips, place_geoid: .placeGeoid,
         street: .street, cross: .cross }
       | with_entries(select(.value != null)))
      + { direction_deg: .directionDeg }
      + (.tags // {})
    )
  } ]
}' 11/606/765.json
```

The `with_entries(select(.value != null))` drops genuinely-absent optional
fields, and `direction_deg` is then added back **unconditionally** so that
`null` survives as an explicit "unknown". That ordering is the whole trick.

### 4.2 The whole archive → one valid GeoJSON FeatureCollection

Streams, so it never holds 132,068 features in memory.

```bash
{ printf '{"type":"FeatureCollection",\n';
  printf '"attribution":"Map data © OpenStreetMap contributors",\n';
  printf '"licence":"ODbL-1.0",\n"features":[\n';
  find 11 -name '*.json' -print0 | xargs -0 cat \
    | jq -c '.cameras[] | {
        type: "Feature", id: .id,
        geometry: { type: "Point", coordinates: [ .lon, .lat ] },
        properties: (
          ({ owner_type: .ownerType, confirmations: .confirmations,
             county_fips: .countyFips, place_geoid: .placeGeoid,
             street: .street, cross: .cross }
           | with_entries(select(.value != null)))
          + { direction_deg: .directionDeg } + (.tags // {}) ) }' \
    | sed '$ ! s/$/,/' ;
  printf ']}\n'; } > cameras.geojson

jq -e '.type, (.features|length), .attribution' cameras.geojson
```

Measured: **5.5 s, 50 MB, 132,068 features**, and it validates. `sed '$ ! s/$/,/'`
appends a comma to every line but the last — do **not** reach for
`paste -sd','`, which cycles delimiters and produces invalid JSON.

For a streaming consumer, drop the wrapper and keep the NDJSON — one feature per
line, which is what most tools would rather have anyway.

### 4.3 → CSV

```bash
{ printf 'id,lat,lon,direction_deg,direction_known,owner_type,manufacturer,operator,';
  printf 'camera_mount,camera_type,surveillance_zone,county_fips,place_geoid,street,cross\n';
  find 11 -name '*.json' -print0 | xargs -0 cat \
    | jq -r '.cameras[] | [
        .id, .lat, .lon,
        .directionDeg, (.directionDeg != null),
        .ownerType,
        (.tags["manufacturer"]        // ""),
        (.tags["operator"]            // ""),
        (.tags["camera:mount"]        // ""),
        (.tags["camera:type"]         // ""),
        (.tags["surveillance:zone"]   // ""),
        (.countyFips // ""), (.placeGeoid // ""),
        (.street // ""), (.cross // "")
      ] | @csv'; } > cameras.csv

wc -l cameras.csv     # 132069 (header + 132068)
```

Measured: **18 MB**, and `direction_known` is `false` on exactly 8,160 rows.
`@csv` renders `null` as an empty field, which is why
`direction_known` is carried explicitly — without it, 8,160 unknown facings are
indistinguishable from an empty column (§3.4). `@csv` also quotes and escapes
correctly, which matters: `Neology, Inc.` and
`fireworks,weponds,and secoret bfs` are both real values in this archive.

### 4.4 → OSM-compatible Overpass JSON, with a round-trip proof

This is the shape `fetch-cameras.mjs` itself reads, so it round-trips exactly.

From `apps/pwa/public/cameras`:

```bash
jq -c '{
  version: 0.6,
  generator: "DarkRoute export — data from OpenStreetMap, ODbL-1.0",
  osm3s: { copyright: .attribution },
  elements: [ .cameras[]
    | { type: "node", id: (.id | ltrimstr("osm:") | tonumber),
        lat: .lat, lon: .lon }
      + (if .osmVersion then { version: .osmVersion } else {} end)
      + (if .updatedAt  then { timestamp: (.updatedAt/1000 | todate) } else {} end)
      + { tags: ({ "man_made": "surveillance",
                   "surveillance:type": "ALPR" } + (.tags // {})) } ]
}' 11/606/765.json > tile.overpass.json
```

Note the two query tags being **put back**: they are stripped from stored records
as redundant, and an OSM-shaped consumer expects them.

**Proof that this round-trips.** Feed it back through the project's own
`normalise()` and compare to the tile it came from — **from the repository
root**, with `tile.overpass.json` moved there:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { normalise } from './scripts/fetch-cameras.mjs';
const dump = JSON.parse(readFileSync('tile.overpass.json','utf8'));
const orig = JSON.parse(readFileSync('apps/pwa/public/cameras/11/606/765.json','utf8')).cameras;
dump.elements.map(n => normalise(n)).forEach((a, i) => {
  const b = orig[i];
  const same = a.id === b.id && a.lat === b.lat && a.lon === b.lon
    && a.directionDeg === b.directionDeg && a.ownerType === b.ownerType
    && JSON.stringify(a.tags) === JSON.stringify(b.tags);
  console.log(a.id, same ? 'IDENTICAL' : 'DIFFERS');
});"
```

Output: `IDENTICAL` on all four records
(id / lat / lon / directionDeg / ownerType / tags).

### 4.5 → `.osm` XML, for JOSM or osmium

**Read-only.** See the `upload="never"` attribute and §5.1 before you open this
in an editor. Run **from the repository root**.

```bash
node --input-type=module -e "
import { readdirSync, readFileSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
                          .replace(/>/g,'&gt;').replace(/\"/g,'&quot;');
const out = createWriteStream('cameras.osm');
out.write('<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n');
out.write('<osm version=\"0.6\" generator=\"DarkRoute export\" upload=\"never\">\n');
out.write('  <!-- Map data (c) OpenStreetMap contributors, ODbL-1.0.\n');
out.write('       OSM-DERIVED. Never upload this back to OpenStreetMap. -->\n');
let n = 0;
(function walk(d){ for (const e of readdirSync(d, { withFileTypes: true })) {
  const p = join(d, e.name);
  if (e.isDirectory()) { walk(p); continue; }
  if (!e.name.endsWith('.json')) continue;
  for (const c of JSON.parse(readFileSync(p,'utf8')).cameras ?? []) {
    n++;
    const v = c.osmVersion === undefined ? '' : \` version=\"\${c.osmVersion}\"\`;
    out.write(\`  <node id=\"\${c.id.slice(4)}\" lat=\"\${c.lat}\" lon=\"\${c.lon}\"\${v} visible=\"true\">\n\`);
    const tags = { man_made:'surveillance', 'surveillance:type':'ALPR', ...(c.tags ?? {}) };
    for (const [k, val] of Object.entries(tags))
      out.write(\`    <tag k=\"\${esc(k)}\" v=\"\${esc(val)}\"/>\n\`);
    out.write('  </node>\n');
  }
}})('apps/pwa/public/cameras/11');
out.end('</osm>\n', () => console.log(n, 'nodes written'));"
```

Measured: **132,068 nodes, 49 MB**, and it parses under a real XML parser.

**Real positive OSM ids, no `action` attribute, `upload="never"`.** Negative ids
would tell JOSM these are new objects, and `action="modify"` would invite an
upload — both of which are exactly the thing §5.1 forbids. Keeping the real ids
means the objects are recognisable as the upstream ones they are.

### 4.6 Re-derive `directionDeg` — do this if facing matters

**6,194 records (4.69%) carry `directionDeg: null` while their own tags contain a
bearing** the current parser can read. [DATA-PROVENANCE.md](./DATA-PROVENANCE.md)
§6.6 explains why. Recover them — **from the repository root**:

```bash
node --input-type=module -e "
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDirection } from './scripts/fetch-cameras.mjs';
let n = 0, recovered = 0;
(function walk(d){ for (const e of readdirSync(d,{withFileTypes:true})) {
  const p = join(d, e.name);
  if (e.isDirectory()) { walk(p); continue; }
  if (!e.name.endsWith('.json')) continue;
  for (const c of JSON.parse(readFileSync(p,'utf8')).cameras ?? []) { n++;
    const t = c.tags ?? {};
    const fresh = parseDirection(t.direction, t['camera:direction'] ?? null);
    if (fresh !== c.directionDeg) recovered++;
    // emit { ...c, directionDeg: fresh } here
  }
}})('apps/pwa/public/cameras/11');
console.log(n, 'records;', recovered, 'facings recovered');"
```

Output: `132068 records; 6194 facings recovered`. Of those, **1,816** have their
facing on `camera:direction`, and **4,378** have it written as a covered arc
(`321-6`, `137-182`) which needs the wrap-aware bisector.

**If you write your own parser rather than importing this one**, the arc case is
the trap: `338-23` is a 45° arc across north, its bisector is 0.5, and the naive
midpoint `(338+23)/2 = 180.5` is due **south** — the reciprocal. 15.81% of arcs
wrap past north. And `0-360` means _omnidirectional_, which has no facing at all;
a bisector of 180 would be a fabricated one.

### 4.7 `overview.json` → GeoJSON MultiPoint

The cheapest way to get every camera: 826 KB gzipped, no ids, no tags.

```bash
jq -c '{
  type: "Feature",
  properties: { attribution: .attribution, licence: .licence,
                licenceUrl: .licenceUrl, count: .count },
  geometry: { type: "MultiPoint",
              coordinates: [ .coords | _nwise(2) | [ .[1], .[0] ] ] }
}' overview.json > overview.geojson
```

`[.[1], .[0]]` is the **lat,lon → lon,lat swap**. Get this wrong and every camera
in the United States appears in Somalia.

### 4.8 Join county and place names

```bash
# per-county counts, recomputed from the records (do NOT trust counties.json's
# own row counts — §5.6)
find 11 -name '*.json' -print0 | xargs -0 cat \
  | jq -r '.cameras[].countyFips // empty' | sort | uniq -c | sort -rn | head -10 \
  | while read n fips; do
      printf '%-7s %-6s %s\n' "$n" "$fips" \
        "$(jq -r --arg f "$fips" '.rows[]|select(.fips==$f)|.label' counties.json)"
    done
```

Output:

```
3841    48201  HARRIS CO, TX
3258    06037  LOS ANGELES CO, CA
2178    17031  COOK CO, IL
2152    06065  RIVERSIDE CO, CA
1554    48113  DALLAS CO, TX
```

`places.json` is the same shape, keyed `geoid` instead of `fips`.

### 4.9 Apply the deletion ledger

Only needed for an **incremental** consumer. A fresh full fetch does not need it:
verified, **zero** of the 196 tombstoned ids appear in the current tile tree.

```bash
jq -r '.tombstones[].id' tombstones.json | sort > dead.txt
# then, against whatever you cached earlier:
jq -r '.id' your-cached.ndjson | sort > live.txt
comm -12 dead.txt live.txt          # ids you are still holding that are gone
```

Use `seq` for idempotence — it is the OSM replication sequence that carried the
removal, so re-applying the same ledger is a no-op.

### 4.10 Verify what you got

Run these before you build anything on top:

```bash
# the catalogue agrees with the files
jq '.cameras, .tiles' index.json        # -> 132068  then  8605
find 11 -name '*.json' | wc -l          # -> 8605     (matches .tiles)
find 11 -name '*.json' -print0 | xargs -0 cat \
  | jq '.cameras|length' | paste -sd+ | bc
                                        # -> 132068   (matches .cameras)

# how fresh, and by which clock
jq '{ generatedAt, upstream }' index.json

# attribution is present in the bodies you are about to redistribute
find 11 -name '*.json' -print0 | xargs -0 cat \
  | jq -r 'select(.attribution != "Map data © OpenStreetMap contributors"
                  or .licence != "ODbL-1.0") | "\(.x)/\(.y)"' | wc -l    # 0
```

More self-checks — the PII scans, the field-name audit, the staleness drift — are
in [DATA-PROVENANCE.md](./DATA-PROVENANCE.md) §8.

---

## 5. What not to do with this data

### 5.1 Do not push it back into OpenStreetMap

**This is the most damaging thing you could do with this dataset, and it is easy
to do by accident.**

The data is OSM-derived. Re-importing it creates duplicate nodes, resurrects
objects that mappers deliberately deleted, and overwrites hand-corrected
positions with a stale copy of themselves. It is a mass-revert event and a DWG
block, and it damages the corpus every project in this category depends on —
including yours.

Two documented failures in this exact space, both in
[DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §6.1:

- **MAPS.ME** reached the point where **36% of all its edits were duplicate
  POIs**, because the app stopped showing people what already existed nearby.
  Systematic manual reverts across multiple countries, DWG blocks, speed cameras
  filed as police stations, and a permanent reputational mark.
- **DeFlock** — in this exact domain, within the last year — had its iD editor
  preset **removed** because users pasted its placeholder text literally, filing
  real cameras as `operator=(AllentownPolice)`. The mechanism was a
  copy-pasteable instruction block, which is a feature anyone would ship without
  thinking twice.

**DarkRoute does not upload either.** There is no OAuth, no changeset API call,
no automatic submission. The report flow shows a driver final tag values on
screen and opens `openstreetmap.org/edit` at the right position — **position
only, no tag payload**, because the copy-pasteable-block workaround is precisely
what got DeFlock's preset pulled. **The person does the edit.**

If you intend to write to OSM at any volume, the process is not code:

1. register an **Organised Editing Activity** and announce it at least two weeks
   before the first write;
2. name a human who answers within two working days;
3. expect to be told, as a direct competitor in this space was told verbatim,
   _"your platform will be judged mainly by the worst-case-users"_.

And regardless of any of that: **never write `street`, `cross`, `countyFips` or
`placeGeoid` into OSM.** They are US Census derivations, not observations, and
they do not belong in that database.

### 5.2 Licence constraints

Camera data is **ODbL-1.0**. That attaches to you the moment you hold a table
derived from it.

**Work out which thing you are making**, because the obligations differ:

| You are making                                                     | ODbL calls it                       | You must                                                                                                                                                      |
| ------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a rendered map, an image, a printed report, a route                | a **Produced Work** (§4.5(b))       | carry a §4.3 notice making people aware the content came from OSM under ODbL                                                                                  |
| a database, an extract, a CSV, a GeoJSON file, a table in your app | a **Derivative Database** (§4.4(b)) | offer it under ODbL, keep the licence and attribution **in the data**, and offer recipients the whole thing or your alterations free over the internet (§4.6) |

Extraction or re-utilisation of "the whole or a Substantial part of the Contents
into a new database **is** a Derivative Database". 132,068 records is a
substantial part. So is one state.

**The minimum that discharges it:**

```
Map data © OpenStreetMap contributors
https://www.openstreetmap.org/copyright
Open Database License 1.0 — https://opendatacommons.org/licenses/odbl/1-0/
```

carried **in the artefact**, not only on your website. Every recipe in §4 copies
`attribution`, `licence`, and `licenceUrl` through for this reason. The OSMF attribution
guideline says it explicitly for databases: include it "as part of the database …
in a location where users would be likely to look for it, such as a readme file,
or within the data or metadata".

If you also take DarkRoute's **code**, that is **GPL-3.0-only** — a separate
licence over a separate work. The GPL governs the program; the ODbL governs the
database; neither reaches into the other's subject matter.
[LEGAL.md](./LEGAL.md) §5.

Two other licences ride along if you use the corresponding fields:

- `street` / `cross` / `countyFips` / `placeGeoid` derive from **US Census**
  products — a US federal government work, public domain, no obligation. The
  published files cite them anyway, in `streetSource` and in each sidecar's
  `source`, because a consumer needs to know which authority said what.
- Anything you join from the **EFF Atlas** is **CC BY 4.0** and needs the full
  attribution string in §3.3, including the word _modified_.

### 5.3 The privacy line

**This dataset describes hardware bolted to poles in public. It must never
describe people.**

Three rules, in descending order of how badly you will regret breaking them:

1. **Never join a plate to this.** There are no plates in this data and there is
   no place to put one. If you build a system where a plate and a camera location
   meet, you have built the surveillance system this dataset exists to map. This
   is not a licence condition; it is the reason the project exists.
2. **Never join a driver to this.** No observer positions leave the device, and
   an interchange format for this domain should have **no field for the
   observer**. If you accept user reports, keep the reporter's position separate
   from the camera's position and publish only the camera's — the schema-level
   version of this is [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §2.1.
3. **Do not enrich this into a dossier on a person.** 23,357 records carry an
   `operator` string, and 213 carry an `addr:*` tag for the premises. Those name
   _organisations_ and _places_. Turning them into a file on a named individual —
   a homeowner, a business owner, an officer — is outside anything this data is
   for, and publishing that under an OSM attribution string would make OSM's
   volunteers a party to it.

DarkRoute's own plate features exist and are worth understanding as a boundary:
they live in two IndexedDB stores that are **local-only by schema**, never sync,
never appear in any export, and are not a source for anything in this document
([DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §4.7). Nothing in the publishing
pipeline can reach them.

### 5.4 Do not treat absence as evidence

The rule the entire pipeline is built on, and it applies to consumers too:

> **An absent record is not a deleted camera.**

A 404 on a tile means "no ALPR in this square" — but a failed fetch, a truncated
response, a timeout, or an Overpass instance returning **HTTP 200 with an empty
body** all look identical to a naive reader. That last one is not hypothetical:
it deleted 19,000 cameras from this archive once, and the run exited zero.
[DATA-PROVENANCE.md](./DATA-PROVENANCE.md) §2.3.

Concretely:

- **do not** diff two fetches and treat the difference as removals — use
  `tombstones.json`;
- **do not** treat a missing `operator` as "no operator" — it is _unknown_, on
  82% of records;
- **do not** treat `directionDeg: null` as "not facing me" — it is _unknown_, and
  an unknown-facing camera reads every plate it can see;
- **do not** treat a missing `placeGeoid` as "not in a city" — 28,062 records
  have none, most of them on unincorporated land where no city exists to name;
- **do not** treat a missing `check_date` as recent. **0.64%** of records have
  one. Nothing in this dataset knows how stale any individual dot is.

### 5.5 Do not fork the vocabulary

DeFlock settled the tag scheme, roughly 147,000 objects now carry it, and
**DarkRoute reads it unchanged. Its unwired, tested write-back builder uses the
same vocabulary.** A second vocabulary for the same thing fragments the corpus
and helps nobody.

If you need a concept this taxonomy lacks, the useful move is to propose it —
§6 — not to mint `surveillance:type=alpr_camera` and hope. The long tail in §3.6
is what that looks like at scale: `flock`, `flock_camera`, `flock_saftey`,
`alpr_flock`, `flock_360_ptz_camera`, each written by somebody solving their own
problem locally.

Two DarkRoute-specific conventions you may safely rely on and should not
reinvent:

- **`id` is namespaced.** `osm:<node id>`. A future non-OSM source gets its own
  prefix rather than colliding. Split on the first `:`.
- **ways are excluded.** OSM ids are unique only within an element type, and 210
  camera ids fall inside the live _way_ id range — so a deleted building could
  tombstone a camera in another state. DeFlock's export carries 18 ways; we carry
  none. If you merge the two sources, key on `(osmType, osmId)`, never on `osmId`
  alone.

### 5.6 The specific traps, collected

Ranked by how many people will hit them.

| #   | Trap                                                                      | Consequence                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `overview.json` is `[lat, lon]`; GeoJSON is `[lon, lat]`                  | every camera lands in the wrong hemisphere                                                                                                                                                                                  |
| 2   | `directionDeg: null` emitted as `0`                                       | "unknown" silently becomes "faces north"                                                                                                                                                                                    |
| 3   | `counties.json` / `places.json` row counts are **6 days stale**           | off by up to 98 in one county, 575 in total. Set-differenced: **9** county FIPS in the records have no gazetteer row, and **3** rows have no records left. **Use them as gazetteers; recompute counts from records** (§4.8) |
| 4   | `directionDeg` is behind its own tags on 6,194 records                    | 4.69% show "facing unknown" when the tags carry a bearing. §4.6                                                                                                                                                             |
| 5   | CSV collapses `null` and empty                                            | 8,160 unknown facings become indistinguishable from an empty column. Carry `direction_known`. §4.3                                                                                                                          |
| 6   | coercing `tags` into a fixed schema                                       | 212 distinct keys, and a mapper may invent one tomorrow                                                                                                                                                                     |
| 7   | filtering on `surveillance=public`                                        | drops ~15,000 cameras that say `traffic`, `outdoor` or `camera`                                                                                                                                                             |
| 8   | `camera:mount` treated as an enum                                         | 397 distinct values, including `Pole` beside `pole`                                                                                                                                                                         |
| 9   | reading `ownerType` as evidence                                           | it is a regex over a tag that is absent 82% of the time                                                                                                                                                                     |
| 10  | merging DeFlock and DarkRoute on `osmId` alone                            | their 18 ways can collide with our node ids                                                                                                                                                                                 |
| 11  | assuming `osmVersion` / `updatedAt` are present                           | 1.45% and 0.06%                                                                                                                                                                                                             |
| 12  | dropping `attribution`, `licence`, or `licenceUrl` from `tombstones.json` | rejected: every newly publishable camera body carries all three and the ledger/generation gates require them                                                                                                                |

---

## 6. Converging the taxonomy

This proposal is addressed to DeFlock, FlockHopper, ALPR Watch, Drivers Against
Flock, EFF's Atlas of Surveillance and anyone else mapping this hardware. It is
**not** a new schema, a new database or a new format — OSM is the substrate and
should stay the substrate. It is an agreement about which tags we write and
what the values mean.

The three asks that carry most of the value and require nobody to change code:

1. **Collapse `surveillance` to three values** — `public`, `outdoor`, `indoor`.
   `traffic` is a `surveillance:zone` value and always was; `camera` says nothing
   at all. The 11,160 `surveillance=traffic` nodes become
   `surveillance=public` + `surveillance:zone=traffic`, which most already carry.
2. **Make `operator` and `operator:type` first-class**, with a fixed
   `operator:type` enumeration. These are the fields accountability needs most
   and the ones we have collectively left blank — 17.69% and 3.03%.
3. **Add provenance** — `source`, `source:url`, `check_date`. `check_date` is on
   **0.64%** of nodes. Every project in this category shows users a map that
   implies currency and none of us can say how old a given dot is. It is the
   cheapest credibility win available to all of us.

What DarkRoute offers in exchange, and this document is part of it: the
measurements across the full archive, the tombstone ledger in whatever format is
useful, and an open interface — slippy tiles at `/cameras/{z}/{x}/{y}.json`, plus
`index.json`, `overview.json` and `tombstones.json`. Cacheable, addressable, no
key.

If the answer is "your value collapse is wrong and here is why", that is a good
outcome. The bad outcome is five projects continuing to write four different
values for the same fact into a database we all read.

Nobody did this wrong. It is what happens when several projects tag against the
same schema without agreeing what the values mean.

---

## Provenance of this document

Every count, distribution and percentage was measured against the archive at
`apps/pwa/public/cameras/` — `index.json` `generatedAt`
`2026-08-26T20:00:10.314Z`, `upstream` `2026-08-26T19:00:00Z`, **132,068 records
across 8,605 tiles, the full set, not a sample.**

Every recipe in §4 was executed against those files before being written here,
and the outputs quoted — 132,068 features, 50 MB GeoJSON in 5.5 s, 17 MB CSV,
49 MB `.osm` parsing under a real XML parser, 6,194 recovered facings, four
`IDENTICAL` round-trips — are what it produced.

Definitions were read from `packages/core/src/types.ts`,
`packages/core/src/alert.ts`, `packages/core/src/geo.ts`,
`scripts/fetch-cameras.mjs`, `scripts/sync-cameras.mjs`,
`apps/pwa/src/features/node/mesh.ts`, `apps/pwa/src/features/node/sighting.ts`
and `apps/pwa/src/features/report/`.

The DeFlock and EFF Atlas correspondences above are field and record-grain
mappings; they do not assign either distribution authority it does not have.
The public source-admission and licence boundaries are in
[AGGREGATION-POLICY.md](./AGGREGATION-POLICY.md). The convergence proposal is
§6 above.

Companion documents: [DATA-PROVENANCE.md](./DATA-PROVENANCE.md),
[DATA-CONTRACTS.md](./DATA-CONTRACTS.md), [API.md](./API.md),
[LEGAL.md](./LEGAL.md), [`../credits.md`](../credits.md).
