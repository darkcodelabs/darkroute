# Data contracts

Every byte this project signs, stores, publishes or puts on a radio.

This document is written to be **sufficient on its own**. Somebody who has never
read the TypeScript should be able to use it to write an independent verifier for
a DarkRoute evidence record in another language, and an independent consumer of
the published camera data. Where the code is normative, the file and symbol are
named so you can check the claim rather than trust it.

Everything below was verified against the working tree by executing it. The
worked example in §2.8 was reproduced from a clean-room implementation written
from this document's prose alone — see §2.10 for how to repeat that.

**Companion documents:** [ARCHITECTURE.md](./ARCHITECTURE.md) (the flows),
[API.md](./API.md) (the HTTP surface), [DATA-PROVENANCE.md](./DATA-PROVENANCE.md)
(where the camera database comes from), [TAXONOMY.md](./TAXONOMY.md) (naming and
export), [LEGAL.md](./LEGAL.md) (the licence split),
[TRANSPARENCY.md](./TRANSPARENCY.md) (takedown publication).

---

## 0. Contract index

| Identifier                | What it governs                                      | Normative source                                        |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| `fwm-canonical-json/v1`   | The bytes that get hashed.                           | `apps/pwa/src/services/crypto/canonicalize.ts`          |
| `fwm-report/v2`           | The signed report payload.                           | `apps/pwa/src/features/report/reportDraft.ts`           |
| `fwm-report/v1`           | Superseded payload. Still read, never written.       | same                                                    |
| `fwm-evidence/v1`         | The signed, hash-linked record.                      | `apps/pwa/src/services/crypto/chain.ts`                 |
| `fwm-evidence-export/v1`  | The export document.                                 | `apps/pwa/src/features/dead-drop/evidenceExport.ts`     |
| `fwm-plate/v1`            | The sealed watchlist plate. Never leaves the device. | `apps/pwa/src/services/crypto/plate.ts`                 |
| `fwm-overview/v1`         | `/cameras/overview.json`.                            | `scripts/sync-cameras.mjs`                              |
| (unversioned)             | Camera tiles, `index.json`, tombstones, gazetteers.  | `scripts/fetch-cameras.mjs`, `scripts/sync-cameras.mjs` |
| (unversioned)             | The 16-byte sighting frame, LoRa port 256.           | `apps/pwa/src/features/node/sighting.ts`                |
| IndexedDB `fwm` v4        | Thirteen local stores.                               | `apps/pwa/src/services/db/schema.ts`                    |
| IndexedDB `fwm-crypto` v1 | Non-exportable key material.                         | `apps/pwa/src/services/crypto/keys.ts`                  |
| `meshtastic.*`            | Upstream protobufs, read and written.                | `@jsr/meshtastic__protobufs@2.7.26`                     |
| OSM tags                  | What a report becomes in OpenStreetMap.              | `apps/pwa/src/features/report/osmTags.ts`               |

### The distinction that carries the security properties

Two kinds of field appear throughout. Confusing them is the failure mode this
whole document exists to prevent.

|                                                      | **Signed**                                               | **Mutable bookkeeping**                               |
| ---------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| Covered by `payloadHash` / `chainHash` / `signature` | yes                                                      | **no**                                                |
| May change after capture                             | **never**                                                | yes                                                   |
| Changing it                                          | breaks verification, loudly                              | is the normal path                                    |
| Examples                                             | `payload`, `capturedAt`, `reportId`, `previousChainHash` | `syncState`, `attempts`, `nextAttemptAt`, `lastError` |

A verifier must hash **only** the signed fields, in the canonical form, and must
ignore bookkeeping entirely. A storage layer must never let a bookkeeping write
touch a signed field. Both halves are enforced in code and in tests; §8 indexes
which test holds which half.

---

## 1. `fwm-canonical-json/v1` — canonicalisation

**Normative source:** `apps/pwa/src/services/crypto/canonicalize.ts`
**Constant:** `CANONICAL_FORM = 'fwm-canonical-json/v1'`

A report payload is hashed and signed on the device. Anything re-hashing that
payload must reach **byte-identical** input. These rules are the specification;
the TypeScript is one conforming implementation.

`canonicalize(value)` returns the text. `canonicalBytes(value)` returns its UTF-8
bytes. **The bytes are what is hashed. Nothing else is ever hashed.**

### Rule 0 — output

JSON text with **no insignificant whitespace**, encoded UTF-8. No newline, no
indentation, no space after `:` or `,`.

### Rule 1 — accepted value types

Accepted: `null`, boolean, number, string, array, plain object.

**Rejected**, with a `CanonicalizationError`: `undefined` inside an array, `Date`,
`Map`, `Set`, `RegExp`, `BigInt`, symbol, function, class instances, boxed
primitives, typed arrays, and any object whose prototype is neither
`Object.prototype` nor `null`.

There is **no coercion and no `toJSON` hook**. An object that silently serialises
itself is an object whose bytes a second implementation cannot predict.

### Rule 2 — object properties

Only own, enumerable, string-keyed properties are serialised. Symbol-keyed
properties are **rejected**.

A property whose value is `undefined` is **dropped**, exactly as `JSON.stringify`
drops it: such a property has no JSON encoding and cannot survive the wire.

`undefined` **inside an array is rejected** rather than coerced to `null`, because
array position is meaningful and a silent `null` would change the hash of data the
author never wrote.

### Rule 3 — key normalisation and order

1. Normalise every key to Unicode **NFC**.
2. If two distinct keys normalise to the same NFC form, **reject** the object —
   the intended value is ambiguous.
3. Sort keys **ascending by the lexicographic order of their UTF-8 encoded
   bytes**.

UTF-8 byte order equals Unicode code-point order, so this is reproducible in any
language without agreeing on UTF-16 details.

```python
# Python
sorted(keys, key=lambda k: unicodedata.normalize("NFC", k).encode("utf-8"))
```

```go
// Go — strings are already UTF-8, so plain `<` after NFC is correct
sort.Slice(keys, func(i, j int) bool { return norm.NFC.String(keys[i]) < norm.NFC.String(keys[j]) })
```

> **Trap.** JavaScript's default `Array.prototype.sort` compares UTF-16 code units
> and is **not** equivalent for astral-plane keys. The reference implementation
> compares bytes explicitly.

### Rule 4 — strings

Normalise to NFC, then emit between double quotes. Escaped:

| Code point   | Escape |
| ------------ | ------ |
| `U+0022` `"` | `\"`   |
| `U+005C` `\` | `\\`   |
| `U+0008`     | `\b`   |
| `U+0009`     | `\t`   |
| `U+000A`     | `\n`   |
| `U+000C`     | `\f`   |
| `U+000D`     | `\r`   |

Every **other** code point below `U+0020` becomes `\u00XX` with **lowercase** hex.

Everything else — including `U+007F`, `U+2028`, `U+2029` and all non-ASCII — is
emitted **literally** and carried by the UTF-8 encoding.

**Lone surrogates are rejected.** They have no UTF-8 encoding, so no two
implementations could agree on their bytes.

### Rule 5 — numbers

`NaN`, `+Infinity` and `-Infinity` are **rejected**. Negative zero is emitted as
`0`.

**Exact integers** are emitted as a plain decimal integer: no fraction, no
exponent, no `+`, no leading zeros — regardless of how the source wrote it. `1`,
`1.0` and `1e0` are the same IEEE-754 double and therefore the same bytes: `1`.
Limited to `|n| <= 2^53-1`; larger is **rejected**, because the double no longer
identifies a unique integer.

**Non-integers** are emitted with **exactly 9 fractional digits**, rounding half
**away from zero** on the exact binary value, limited to `|n| < 1e15`. Nine digits
is roughly 0.1 mm of latitude, far beyond any sensor this product reads.

```javascript
// JavaScript — ECMA-262 defines the tie as "pick the larger n", i.e. away from zero
x.toFixed(9);
```

```python
# Python
from decimal import Decimal, ROUND_HALF_UP
str(Decimal(x).quantize(Decimal("1.000000000"), rounding=ROUND_HALF_UP))
```

`Decimal(x)` on a float takes the **exact binary value**, which is what `toFixed`
rounds, so the two agree including on exact ties such as `1/1024`.

> **Trap.** Do **not** use `%.9f` or `printf` on a server. C and Python's
> `format()` round half to **even** and disagree with this rule on those ties.

### Rule 6 — containers

```
array   [ value , value ]        order preserved, no trailing comma
object  { "key" : value , ... }  no trailing comma
empty   []   {}
```

Cycles are **rejected**. Nesting deeper than `MAX_DEPTH = 64` is **rejected**, so
a hostile or buggy payload cannot blow the stack during finalisation.

### Error surface

Every rejection is a `CanonicalizationError` carrying a `code` and a
JSON-pointer-ish `path` (e.g. `$.subject_position.lat`, `$.photos[2]`).

| Code                       | Cause                                 |
| -------------------------- | ------------------------------------- |
| `unsupported-type`         | Rule 1                                |
| `not-finite`               | `NaN` / `Infinity`                    |
| `integer-out-of-range`     | `abs(n) > 2^53-1`                     |
| `non-integer-out-of-range` | `abs(n) >= 1e15`                      |
| `lone-surrogate`           | unpaired surrogate in a key or string |
| `duplicate-normalised-key` | two keys with one NFC form            |
| `symbol-key`               | symbol-keyed property                 |
| `undefined-in-array`       | `undefined` at an array position      |
| `cycle`                    | value refers to itself                |
| `too-deep`                 | nesting past 64                       |

### Worked example

Payload as the app writes it, in source order:

```json
{
  "schema": "fwm-report/v2",
  "kind": "new_camera",
  "camera_id": null,
  "observer_position": { "lat": 39.0997, "lon": -84.5786 },
  "subject_position": { "lat": 39.09982, "lon": -84.57848 },
  "subject_position_source": "projected",
  "synthetic": false,
  "gps_accuracy_m": 4,
  "satellites": null,
  "facing_deg": 223,
  "facing_source": "compass",
  "mount": "pole",
  "make_model": "Flock Falcon",
  "photo": null
}
```

Canonical text — keys byte-sorted, integers bare, non-integers to 9 places, no
whitespace:

```
{"camera_id":null,"facing_deg":223,"facing_source":"compass","gps_accuracy_m":4,"kind":"new_camera","make_model":"Flock Falcon","mount":"pole","observer_position":{"lat":39.099700000,"lon":-84.578600000},"photo":null,"satellites":null,"schema":"fwm-report/v2","subject_position":{"lat":39.099820000,"lon":-84.578480000},"subject_position_source":"projected","synthetic":false}
```

```
SHA-256 of those UTF-8 bytes
  = e56b37c098d1bc1d01553319939fa8b734bcc9178a024bbde4b0e6699387570d
```

Note `223` and `4` emitted bare as exact integers, while `39.0997` becomes
`39.099700000`. That asymmetry is Rule 5 and it is the single most common place a
second implementation diverges.

**What that hash covers, exactly.** SHA-256 over the **376 UTF-8 bytes** of the
canonical text above, and that text carries `"photo":null` - a report filed
_without_ a photograph. It is not a hash left over from a photo-free era of this
format: the payload's key set has not changed, `fwm-report/v2` has not been
bumped, and those same 376 bytes are still what the app writes today when the
driver attaches nothing.

Attach a photograph and **exactly one value moves**. `photo` becomes the
lowercase-hex SHA-256 of the prepared JPEG bytes. Using SHA-256 of the three
ASCII bytes `abc` as a stand-in digest, so a reader can reproduce this line
without having a photograph to hand:

```
"photo":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

SHA-256 of the resulting 438 canonical bytes
  = 45c69e27157e475f23acef386843814873e82cd531a63a052e98385dbf6b8905
```

The picture itself never appears in the canonical bytes - only its digest does.
Where the bytes live, and why they are not in the record, is §2.1 and §4.6.

### Byte primitives

`apps/pwa/src/services/crypto/bytes.ts`. These are contracts too — a verifier that
accepts more than these does not reproduce the same rejections.

| Function                        | Contract                                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `utf8` / `utf8Decode`           | UTF-8. Decoding is **strict** (`fatal: true`): invalid sequences throw `ByteFormatError` rather than yielding `U+FFFD`.                                                           |
| `toHex` / `fromHex`             | **Lowercase hex only.** `fromHex` rejects uppercase and odd lengths. Lowercase hex is the only hash representation this codebase stores.                                          |
| `isHash256Hex`                  | Exactly 64 lowercase hex characters.                                                                                                                                              |
| `toBase64Url` / `fromBase64Url` | **Unpadded** base64url, RFC 4648 §5, alphabet `A–Z a–z 0–9 - _`. `fromBase64Url` **rejects padding** and lengths `≡ 1 (mod 4)`.                                                   |
| `concatBytes`                   | Concatenates in argument order. Callers depend on this being byte-exact.                                                                                                          |
| `constantTimeEqualHex`          | Length-independent equality for two hex strings. Used for blind-index comparison, where a timing oracle would leak which prefix of a watched plate an attacker guessed correctly. |
| `sha256Hex` / `sha256Bytes`     | SHA-256 via `SubtleCrypto`.                                                                                                                                                       |

---

## 2. The signed record

Two nested contracts. `fwm-report/v2` is the **payload**: what the driver
observed. `fwm-evidence/v1` is the **envelope**: the payload plus the hash chain
and the signature over it.

### 2.1 `fwm-report/v2` — the payload

**Source:** `apps/pwa/src/features/report/reportDraft.ts`
**Constants:** `REPORT_PAYLOAD_SCHEMA = 'fwm-report/v2'`,
`KNOWN_REPORT_SCHEMAS = ['fwm-report/v1', 'fwm-report/v2']`
**Producer:** `reportPayload(draft: ReportDraft, subject: ReportSubject, photoSha256: string | null = null): CanonicalObject`

Fourteen fields, all present on every record (the shape is fixed; nullability is
carried by `null`, never by omission). Everything here is covered by
`payloadHash`, and therefore by the signature.

| Field                     | Type                                          | Null?   | Meaning                                                                                                                                                                                              |
| ------------------------- | --------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`                  | `string`                                      | no      | `"fwm-report/v2"` for anything this build writes.                                                                                                                                                    |
| `kind`                    | `"new_camera" \| "confirm_existing"`          | no      | From `draft.mode` (`new` / `confirm`).                                                                                                                                                               |
| `camera_id`               | `string \| null`                              | **yes** | The camera being confirmed. **Always `null`** in `new_camera` mode.                                                                                                                                  |
| `observer_position`       | `{lat, lon}`                                  | no      | **The phone's fix.** Always present. Provenance for the accuracy figure and nothing else.                                                                                                            |
| `subject_position`        | `{lat, lon} \| null`                          | **yes** | **The camera's position**, when established. `null` until somebody establishes it — and `null` is the honest answer, never a copy of `observer_position`.                                            |
| `subject_position_source` | `"projected" \| "placed" \| "record" \| null` | **yes** | `null` exactly when `subject_position` is `null`.                                                                                                                                                    |
| `synthetic`               | `boolean`                                     | no      | `true` when the fix came from the scripted demo drive rather than a radio. **Signed** — see below.                                                                                                   |
| `gps_accuracy_m`          | `number \| null`                              | **yes** | Metres. Spelled to match `GPS_ACCURACY_FIELD` in `chain.ts`, so `EvidenceRecord.gpsAccuracyM` is a _projection_ of this number rather than a second copy that could drift.                           |
| `satellites`              | `number \| null`                              | **yes** | A browser never supplies one, so `null` on the web.                                                                                                                                                  |
| `facing_deg`              | `number \| null`                              | **yes** | Compass degrees the lens points **toward**.                                                                                                                                                          |
| `facing_source`           | `string \| null`                              | **yes** | `null` exactly when `facing_deg` is `null`.                                                                                                                                                          |
| `mount`                   | `MountKind \| null`                           | **yes** | `pole` / `solar` / `trailer` / `unsure`, or `null`.                                                                                                                                                  |
| `make_model`              | `string \| null`                              | **yes** | Trimmed free text. Forced to `null` when empty **or when it fails the plate-shape check** — see §2.2.                                                                                                |
| `photo`                   | `string \| null`                              | **yes** | **The digest, never the picture.** Lowercase-hex SHA-256 (64 chars) of the prepared JPEG bytes held in `reportPhotos` under the same `reportId`; `null` when the driver attached nothing. See below. |

#### `photo` — a digest, not an image

The field was reserved from the start and was `null` unconditionally until the
report sheet learned to attach one. **The key set did not change, so the schema
did not move**: `fwm-report/v2` still identifies these fourteen keys, and a
verifier that branched on `photo === null` still reads every record ever
written.

Half a megabyte of JPEG is not put in a signed record, for three reasons that
each stand alone. The record is frozen at signing time, so bytes could never be
added afterwards. `IMMUTABLE_REPORT_FIELDS` diffs fields by `JSON.stringify`,
which is neither a meaningful nor an affordable comparison over image bytes. And
a signed record is the one thing this app refuses to evict, so putting a
photograph inside it would make the biggest object on the device the one object
that can never be removed.

So the bytes live in `reportPhotos` (§4.6), keyed by `reportId`, and the
signature covers their digest. The consequence is deliberate and is the whole
reason for the split: **deleting the photograph breaks nothing.** The payload
hash, the chain hash and the signature are all still correct over a record that
now says, truthfully, "there was a photograph and this was its digest". A
verifier that cannot find the bytes has not found a broken record; it has found
a record whose photograph was erased, which is a state this app both permits and
performs (§4.9).

`photo` is **signed**, so a digest cannot be attached, swapped or removed after
the fact without breaking verification, and `createReportQueue().submit` refuses
before writing anything if the payload's digest does not match the bytes it was
handed (`PhotoDigestMismatchError`).

#### `subject_position_source`

| Value       | Meaning                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projected` | The driver said which side of the car and how far over; `subjectPosition.ts` resolved that against the observer fix and the heading. An estimate, offered as an estimate. |
| `placed`    | Put on a map by hand. **Nothing does this yet** — the member exists so a future map does not have to relabel every record that came before it.                            |
| `record`    | Carried over from the camera being confirmed, which already had a position somebody else established.                                                                     |

There is deliberately **no `observer` member**. "The camera is where the driver
was" is the v1 bug (§2.3), and giving it a name would make it expressible again.

The distinction is not bookkeeping. It is what a reviewer needs in order to judge
an edit, and it is the difference between an estimate offered as an estimate and a
GPS fix passed off as a survey.

### 2.2 Two fields that are signed for adversarial reasons

**`synthetic`.** The demo drive is reachable from Settings in a **production**
build and writes fabricated fixes into the same position store the report screen
reads. Nothing downstream can tell that record from a real one: it is signed by
the same key, its 4 m accuracy clears any accuracy gate as HIGH confidence, and
its tile source is `network` rather than `fixture`. The only place the distinction
still exists is the moment of capture — so it is captured there and **signed with
the rest of the payload**. Editing the queue to launder a demo record into a real
one breaks the payload hash and the signature with it.

**`make_model`.** Free text is where somebody writes a licence plate. The draft
layer runs `makeModelIssue()` before the payload is built, and a string that fails
it becomes `null` rather than being carried. This is the one place in the whole
system where user free text reaches a signed, potentially-published artefact, and
it fails closed.

### 2.3 The v1 → v2 change, and why

`fwm-report/v1` had a single field, `position`. It held **the phone's fix**, and
three separate consumers read it as the camera's.

|                            | What went wrong                                                                                                                                                                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wrong data**             | A camera filed at the driver's coordinates is a camera filed in a traffic lane, with a uniform offset from where it actually is.                                                                                                                                                                                 |
| **Wrong duplicate radius** | `nearbyExisting()` measures the 25 m duplicate radius from this field. Fed the driver's position it compares a _road point_ against _pole points_, so two drivers on opposite carriageways report the same camera forty metres apart and **both pass the check**.                                                |
| **Overshare**              | It is a seven-decimal record of where a specific person's car was. `services/adapters/geolocation.ts` calls its own `redact()` at three decimals "the ONLY safe way to turn a fix into something loggable". This was four orders of magnitude finer, and — for anything that ever leaves the device — permanent. |

v2 names the two positions separately and **refuses to guess**: `observer_position`
is always the phone; `subject_position` is the camera or `null`.

> **The migration is a read-side branch, not a rewrite.** v1 records stay valid and
> stay verifiable, because the chain hashes each payload exactly as it was
> written. **Nothing re-signs.** Rewriting a v1 payload into v2 shape would change
> its canonical bytes, break its `payloadHash`, and invalidate every signature from
> that record forward. Readers branch on `schema`; they never migrate in place.

The consequence for publication is absolute and is enforced in `osmTags.ts`: **every
v1 record is permanently ineligible for OSM upload**, because its only coordinate
is the driver. See §7.

### 2.4 `fwm-evidence/v1` — the envelope

**Source:** `apps/pwa/src/services/crypto/chain.ts`
**Constant:** `EVIDENCE_SCHEMA = 'fwm-evidence/v1'`

Each record commits to the record before it, so the **order** of a queue held
offline for weeks is provable without a server.

| Field               | Type                | Signed?           | Meaning                                                                                         |
| ------------------- | ------------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| `schema`            | `"fwm-evidence/v1"` | ✔                 | Envelope version.                                                                               |
| `reportId`          | `string`            | ✔                 | Lowercase RFC 4122 UUID. Matches `REPORT_ID_RE`.                                                |
| `capturedAt`        | `string`            | ✔                 | UTC RFC 3339, **exactly** three fractional digits, trailing `Z`. Matches `CAPTURED_AT_RE`.      |
| `payload`           | object              | ✔                 | The `fwm-report/*` payload. Deep-frozen.                                                        |
| `payloadHash`       | `string`            | ✔                 | 64 lowercase hex. `SHA-256(canonicalBytes(payload))`.                                           |
| `previousChainHash` | `string`            | ✔                 | 64 lowercase hex. `GENESIS_CHAIN_HASH` for the first record.                                    |
| `chainHash`         | `string`            | ✔                 | 64 lowercase hex. See §2.6.                                                                     |
| `signature`         | `string`            | —                 | base64url unpadded, **raw `r‖s`, 64 bytes**. The signature itself.                              |
| `publicKeyId`       | `string`            | ✔                 | 64 lowercase hex. `SHA-256(SPKI DER)`. A stable **pseudonymous per-install** identifier.        |
| `publicKeySpki`     | `string`            | ✔                 | base64url SPKI DER, so the record verifies **without a key directory**.                         |
| `gpsAccuracyM`      | `number \| null`    | ✔ (as projection) | Read out of `payload.gps_accuracy_m`. Covered by `payloadHash` via the payload, not separately. |
| `syncState`         | `SyncState`         | **✘**             | **Transport bookkeeping. Never hashed, never signed.**                                          |
| `supersedes`        | `string \| null`    | ✔                 | `reportId` of the record this one corrects.                                                     |

`syncState` is the **only** mutable field, and the omission is deliberate:

```
held      queued on the device, waiting for WiFi
syncing   an upload attempt is in flight
synced    the backend accepted it
rejected  dead-letter; the backend refused it and a human has to look
```

Legal moves (`LEGAL_SYNC_MOVES`):

```
held     -> syncing | rejected
syncing  -> synced | held | rejected
synced   -> (nothing; terminal)
rejected -> held
```

`advanceSyncState` returns a **new frozen record** and cannot touch a signed
field. There is no update operation on anything else.

### 2.5 Genesis

```
GENESIS_PREIMAGE   = "flockyswatchingme/evidence-chain/v1/genesis"   (ASCII, 43 bytes)
GENESIS_CHAIN_HASH = SHA-256(GENESIS_PREIMAGE)
                   = 066d33d6ca5f6ab67be623a05347a67090727da9298d92261592341685b8e0f0
```

Verify it yourself:

```console
$ printf '%s' 'flockyswatchingme/evidence-chain/v1/genesis' | sha256sum
066d33d6ca5f6ab67be623a05347a67090727da9298d92261592341685b8e0f0  -
```

It is **domain-separated rather than all-zeros** so that a genesis link can never
be confused with a zeroed or truncated field. An all-zero previous-hash is a bug
signature; this constant is not.

> The literal string retains the project's former name. It is a **hash preimage**:
> changing it would invalidate every record ever signed. It is frozen on purpose.

### 2.6 The two hashes

```
payload_hash = SHA-256( canonicalBytes(payload) )          # lowercase hex

chain_hash   = SHA-256( P || H || C || R )                 # lowercase hex
  P = previous_chain_hash, hex-decoded  -> exactly 32 bytes
  H = payload_hash,        hex-decoded  -> exactly 32 bytes
  C = captured_at as UTF-8              -> exactly 24 bytes
  R = report_id  as UTF-8               -> exactly 36 bytes
                                    total  124 bytes
```

Concatenation is **bare** — no separators, no length prefixes, no JSON. That is
safe **only** because all four fields have a fixed length, which is why the
formats are validated _before_ hashing:

```
captured_at  ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$
report_id    ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$
```

If you implement this, **validate both regexes before concatenating**. A
`captured_at` without milliseconds is 20 bytes, not 24, and a bare concatenation
of variable-length fields is a length-extension ambiguity: two different
(timestamp, id) pairs could produce identical preimages.

### 2.7 The signature

|                  |                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| Algorithm        | ECDSA, curve **P-256** (`SIGNING_ALGORITHM`)                                                          |
| Hash             | **SHA-256** (`SIGNING_PARAMS`)                                                                        |
| Message signed   | the **32 raw bytes** of `chain_hash` — _not_ its 64-character hex text                                |
| Effective digest | WebCrypto applies SHA-256 to the message, so the value actually signed is `SHA-256(chain_hash_bytes)` |
| Encoding         | raw **`r‖s`**, 64 bytes, base64url **unpadded**                                                       |
| Key id           | `publicKeyId = SHA-256(SPKI DER)`, lowercase hex                                                      |
| Key storage      | non-exportable `CryptoKey`, `extractable: false`                                                      |

> **Two traps for a second implementation.**
>
> 1. The message is the **decoded** hash, 32 bytes. Signing the hex string
>    produces a valid-looking signature that verifies against nothing.
> 2. The encoding is **raw `r‖s`**, not DER. OpenSSL, Go's `crypto/ecdsa` and most
>    JVM providers expect DER; convert `r‖s` to DER before verifying there.

### 2.8 A complete, real, verifiable record

Generated by executing the specification above, then re-verified from a
clean-room implementation written from this document's prose (§2.10).

```json
{
  "schema": "fwm-evidence/v1",
  "reportId": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "capturedAt": "2026-08-20T14:22:08.412Z",
  "payload": {
    "schema": "fwm-report/v2",
    "kind": "new_camera",
    "camera_id": null,
    "observer_position": { "lat": 39.0997, "lon": -84.5786 },
    "subject_position": { "lat": 39.09982, "lon": -84.57848 },
    "subject_position_source": "projected",
    "synthetic": false,
    "gps_accuracy_m": 4,
    "satellites": null,
    "facing_deg": 223,
    "facing_source": "compass",
    "mount": "pole",
    "make_model": "Flock Falcon",
    "photo": null
  },
  "payloadHash": "e56b37c098d1bc1d01553319939fa8b734bcc9178a024bbde4b0e6699387570d",
  "previousChainHash": "066d33d6ca5f6ab67be623a05347a67090727da9298d92261592341685b8e0f0",
  "chainHash": "1dc24d48129db40817135c96a3e27f3c84585ba27ee223712a71929f122d1a9b",
  "signature": "jocmdLRt5To0jox0oAcExExiEfT2i0pZhscXN-LvUBvhUy5kGWapAsuuo28SDh3XYgnOHrBu82aw8B72CZz3Aw",
  "publicKeyId": "3de378996eadeed1f522435da4f2b8a371cf8f05408b6a3b2e797a025a5a1fa3",
  "publicKeySpki": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE1ROTH6Ni8n5OdJYtSvP2jbOC_b5Bfcf7Ky469n7vr2PzcqQVTwEDcWv4lD2aHpQ7oAkx-eEwfo25yGK6wACaiw",
  "gpsAccuracyM": 4,
  "syncState": "held",
  "supersedes": null
}
```

The key pair is **throwaway, generated for this document**. `publicKeyId`,
`publicKeySpki` and `signature` differ for any real install. Every other value is
reproducible by anyone from the payload alone.

This record has `"photo": null` and its `payloadHash` is the 376-byte hash from
§1's worked example. A record with a photograph attached differs in that one
field and therefore in `payloadHash`, `chainHash` and `signature` — the digest is
signed, so it cannot be added or swapped afterwards. **The image bytes are not in
this document and are not in the export format either**; they live in
`reportPhotos` on the device (§4.6).

### 2.9 Verification algorithm

`verifyChain(records, options)` scans forward and returns the **first** break.

```
for each record, in order:
  0. shape check                    -> malformed-record
  1. schema == "fwm-evidence/v1"    -> wrong-schema
  2. reportId not seen before       -> duplicate-report-id
  3. previousChainHash == expected  -> bad-genesis (index 0) | broken-link (index > 0)
  4. capturedAt >= previous         -> out-of-order-timestamp
  5. SHA-256(canonicalBytes(payload)) == payloadHash
                                    -> payload-hash-mismatch
  6. recomputed chain hash == chainHash
                                    -> chain-hash-mismatch
  7. if pinned: publicKeyId == expectedPublicKeyId
                                    -> untrusted-public-key
  8. SHA-256(base64url_decode(publicKeySpki)) == publicKeyId
                                    -> public-key-id-mismatch
  9. ECDSA-P256-SHA256 verify(signature, message = hex_decode(chainHash))
                                    -> bad-signature
 10. if supersedes != null:
        supersedes != reportId      -> self-supersedes
        supersedes seen earlier     -> unknown-supersedes
  expected = record.chainHash
```

Result: `{ok: true, count, headChainHash}` or
`{ok: false, failure: {index, reportId, code, message}}`.

What this catches **by construction**:

| Attack                              | Detected as                                                     |
| ----------------------------------- | --------------------------------------------------------------- |
| Tampered payload                    | `payload-hash-mismatch`                                         |
| Tampered hash or timestamp          | `chain-hash-mismatch`                                           |
| Deleted middle record               | `broken-link`, at the record _after_ the hole                   |
| Reordered record                    | `broken-link`, at the first record out of place                 |
| Forged or foreign signature         | `bad-signature` / `public-key-id-mismatch`                      |
| Record re-signed by another install | `public-key-id-mismatch`, or `untrusted-public-key` when pinned |

Two design points worth copying:

- **Verification does not require the local signing key.** Every record carries
  the public key that signed it, so a chain stays checkable after the install's
  own key is gone — cleared site data, a restored export, somebody else's queue.
  All it needs is a digest implementation.
- **Step 8 runs per record, never cached on the claimed key id.** Caching on the
  _claimed_ id would let a later record carry a key nobody checked. A
  self-verifying record has to verify itself. (The _imported key object_ is cached,
  keyed by the SPKI itself — which is safe, because the SPKI is the thing that was
  checked.)

### 2.10 Verifying a DarkRoute record in another language

```
1. Serialise `payload` with fwm-canonical-json/v1 (§1). Encode UTF-8.
2. payload_hash == lowercase_hex(SHA256(those bytes))      -> else tampered payload
3. Validate captured_at and report_id against their regexes (§2.6). Then:
     preimage = hex_decode(previous_chain_hash)   # 32 bytes
             || hex_decode(payload_hash)          # 32 bytes
             || utf8(captured_at)                 # 24 bytes
             || utf8(report_id)                   # 36 bytes
   assert len(preimage) == 124
   chain_hash == lowercase_hex(SHA256(preimage))            -> else tampered link
4. spki = base64url_decode(public_key_spki)   # unpadded, alphabet A-Za-z0-9-_
   public_key_id == lowercase_hex(SHA256(spki))             -> else key id mismatch
5. Import spki as an ECDSA P-256 public key.
   sig = base64url_decode(signature)          # 64 bytes, raw r||s
   Convert r||s to DER if your library requires it.
   ECDSA-SHA256-verify(key, message = hex_decode(chain_hash), sig)
6. For a chain:
     record[0].previous_chain_hash == GENESIS_CHAIN_HASH
     record[n].previous_chain_hash == record[n-1].chain_hash   for all n > 0
     captured_at non-decreasing
     report_id unique
```

This document was checked by doing exactly that: an independent Node
implementation written from the prose above reproduced `payload_hash`,
`chain_hash` and `public_key_id` for §2.8 and verified its signature, without
importing anything from `apps/`.

### 2.11 Immutability and corrections

A finalised record is **deep-frozen** and has **no update operation**.

A correction is a **new record** whose `supersedes` names the record it replaces.
The superseded record **stays in the chain forever** — removing it would break
every link after it, which is the point. A verifier that wants the current view
walks the chain and applies `supersedes`; it never deletes.

### 2.12 `fwm-evidence-export/v1` — the export document

**Source:** `apps/pwa/src/features/dead-drop/evidenceExport.ts`
**Constant:** `EVIDENCE_EXPORT_SCHEMA = 'fwm-evidence-export/v1'`
**Filename:** `darkroute-evidence-<exported_at with : and . replaced by ->.json`

The document is itself written as **canonical JSON**, so two exports of the same
queue are **byte-identical**.

| Field                 | Meaning                                                         |
| --------------------- | --------------------------------------------------------------- |
| `schema`              | `"fwm-evidence-export/v1"`                                      |
| `canonical_form`      | `"fwm-canonical-json/v1"` — so a reader knows how to re-hash.   |
| `evidence_schema`     | `"fwm-evidence/v1"`                                             |
| `exported_at`         | UTC ISO-8601. Says nothing about the driver.                    |
| `genesis_chain_hash`  | The constant, carried so a verifier needs no out-of-band value. |
| `starting_chain_hash` | Where the first run begins.                                     |
| `head_chain_hash`     | The chain head across all records.                              |
| `count`               | Total records.                                                  |
| `run_count`           | Number of contiguous runs.                                      |
| `runs[]`              | `{starting_chain_hash, first_index, count, head_chain_hash}`    |
| `records[]`           | Every signed record, under **the record's own field names**.    |

#### Why `runs` exists

Bodies of synced reports may be purged, which leaves **holes**. A holed queue
emitted as one array would fail verification as a `broken-link` — correctly, but
uselessly, because the hole is expected. `runs` names each contiguous stretch and
the hash it starts from, so a verifier checks run by run:

```
for (const run of doc.runs) verifyChain(slice(run), { startingChainHash: run.starting_chain_hash })
```

The export **states where the hole is instead of hiding it**. It carries no
transport bookkeeping beyond the record's own `syncState`.

---

## 3. The published data files

Everything in this section is a **public URL**. Anyone may fetch it, and these
schemas are the contract for doing so.

### 3.1 Where the database comes from

|             |                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upstream    | **OpenStreetMap**, via Overpass                                                                                                                           |
| Query       | `man_made=surveillance` **+** `surveillance:type=ALPR` (and `ANPR`)                                                                                       |
| Licence     | **ODbL-1.0**                                                                                                                                              |
| Attribution | `Map data © OpenStreetMap contributors`                                                                                                                   |
| Footprint   | Strict containment in the pinned Census county/county-equivalent polygons for the 50 states, DC, and Puerto Rico; capture boxes are only query partitions |
| Tiling      | slippy tiles at **zoom 11** (`TILE_ZOOM`)                                                                                                                 |
| Bootstrap   | retained first-party Overpass capture → approved v3 receipt → `scripts/fetch-cameras-deflock.mjs` → `scripts/fetch-cameras.mjs`                           |
| Incremental | `scripts/sync-cameras.mjs`, from the OSM **hourly** diff stream                                                                                           |

Approved v3 publication performs one deterministic enrichment: `countyFips`
comes from the same vendored, hash-pinned Census geometry that defines release
territory. The unpinned historical TIGER road and Census place inputs are not
release inputs; approved records contain no `street`, `cross`, or `placeGeoid`,
and `places.json` is the canonical empty gazetteer.

See [DATA-PROVENANCE.md](./DATA-PROVENANCE.md) for the full rebuild procedure.

> **Attribution travels with the data.** Every tile and all six sidecars carry
> `attribution`, `licence`, and the exact ODbL `licenceUrl` **in their own
> bodies**, so the notice cannot be separated from the data by anyone who
> fetches one file. ODbL attaches to the extract regardless of shape.

### 3.2 Camera tile — `GET /cameras/{z}/{x}/{y}.json`

`z` is always `11`. A square with no ALPR in it is normally **absent**, and the
`404` is what the client reads as "genuinely empty" rather than as an error
(`services/cameras/sync.ts:171`). The dated legacy audit tree also contains nine
empty tile bodies; that measurement is not a promise about an approved v3
generation. In either generation, an absent tile and an empty camera array mean
the same thing to a consumer.

```json
{
  "z": 11,
  "x": 606,
  "y": 765,
  "attribution": "Map data © OpenStreetMap contributors",
  "licence": "ODbL-1.0",
  "licenceUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
  "cameras": [
    {
      "id": "osm:13398047427",
      "lat": 41.32554,
      "lon": -73.47414,
      "directionDeg": 175,
      "ownerType": "police",
      "confirmations": 1,
      "countyFips": "09001",
      "osmVersion": 4,
      "updatedAt": 1756224000000,
      "tags": {
        "camera:mount": "street_lamp",
        "direction": "175",
        "manufacturer": "Flock Safety",
        "operator": "Ridgefield Police Department",
        "surveillance:zone": "traffic"
      }
    }
  ]
}
```

_(Schema example. Counts and versions must be read from the generation being
served, not copied from the dated legacy audit tree.)_

| Camera field    | Type                    | Approved v3 | Meaning                                                                                                                  |
| --------------- | ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`            | `string`                | required    | Canonical `osm:<positive node id>`.                                                                                      |
| `lat`, `lon`    | finite `number`         | required    | WGS-84, rounded to five decimals, inside the pinned US/DC/PR county geometry and stored in its matching z11 tile.        |
| `directionDeg`  | `number \| null`        | required    | Compass direction the lens points **toward**; fractional bearings survive. `null` means unknown, never “not facing you.” |
| `ownerType`     | enum                    | required    | `police` / `inter_agency` / `hoa` / `private` / `unverified`; inferred from selected source text.                        |
| `confirmations` | positive integer        | required    | Current deterministic baseline value is `1`.                                                                             |
| `countyFips`    | canonical `string(5)`   | required    | Exact result of the pinned county lookup for these coordinates.                                                          |
| `osmVersion`    | positive integer        | required    | Exact OSM node version. `versionsKnown:true` is impossible if any live or tombstone version is absent.                   |
| `updatedAt`     | epoch-ms `number`       | required    | Exact source element timestamp, converted to milliseconds.                                                               |
| `tags`          | `Record<string,string>` | required    | Selected mapper-written tags only; values preserve spelling/case unless the entire contact-like value is omitted.        |

Those ten keys are the complete approved camera schema. Unknown keys and the
historical `street`, `cross`, and `placeGeoid` enrichments are rejected rather
than left outside the continuity digest.

> The older 132,068-record audit snapshot has optional enrichments and stale
> sidecars; its measurements remain reproducible in
> [`DATA-PROVENANCE.md` §6.3](./DATA-PROVENANCE.md). They do not describe the
> approved schema above. Approved sync regenerates exact county rows and an
> exact empty place sidecar on every change. To inspect the legacy omissions:
>
> ```bash
> node -e "const fs=require('fs'),p=require('path');const r='apps/pwa/public/cameras/11';
> let m={countyFips:0,placeGeoid:0,street:0,cross:0,osmVersion:0},n=0;
> for(const x of fs.readdirSync(r))for(const f of fs.readdirSync(p.join(r,x)))
>  for(const c of JSON.parse(fs.readFileSync(p.join(r,x,f),'utf8')).cameras){n++;
>   for(const k in m) if(!(k in c)) m[k]++;} console.log(n,m)"
> ```

**`tags` is a flat string map.** After the predicate-only keys are removed, its
only possible approved keys are `brand`, `camera:direction`, `camera:mount`,
`direction`, `manufacturer`, `operator`, `ref`, `start_date`, and
`surveillance:zone`. Absence is normal. Arbitrary upstream keys, contributor
metadata, and contact-like values are removed identically by capture, build,
sync, and independent replay. The dated legacy archive's broader tag-coverage
percentages are historical audit evidence, not a v3 transport promise.

### 3.3 `GET /cameras/index.json` — the catalogue

The following body is the dated legacy audit snapshot used by the field tables
in this document, not an example of an approved v3 source marker or a current
service count:

```json
{
  "zoom": 11,
  "generatedAt": "2026-08-26T20:00:10.314Z",
  "source": "OpenStreetMap (ODbL), via DeFlock hourly builds",
  "attribution": "Map data © OpenStreetMap contributors",
  "licence": "ODbL-1.0",
  "cameras": 132068,
  "tiles": 8605,
  "bbox": { "south": 17.5, "west": -168, "north": 71.5, "east": -64.5 },
  "baseUpstream": "2026-08-26T18:42:49.360Z",
  "upstream": "2026-08-26T19:00:00Z"
}
```

`generatedAt` is when **this build** ran; `upstream` is the OSM diff timestamp the
operational archive has applied. In an approved v3 generation,
`baseUpstream` is the minimum actual `osm3s.timestamp_osm_base` reparsed from
the capture's retained constituent bodies and does not advance with
replication. A DeFlock build time, local file time, or later operational
`upstream` cannot stand in for that source watermark. The approved index also
carries the receipt-bound `cameraSource` identity; the historical body above
predates it and the now-required `licenceUrl`.

### 3.4 `GET /cameras/overview.json` — `fwm-overview/v1`

Every camera as a flat coordinate array, for the zoomed-out map.

```json
{
  "schema": "fwm-overview/v1",
  "attribution": "Map data © OpenStreetMap contributors",
  "licence": "ODbL-1.0",
  "licenceUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
  "count": 132068,
  "coords": [22.2211, -159.4899, 22.2213, -159.4884, "…264136 numbers total…"]
}
```

`coords` is `[lat, lon, lat, lon, …]`, length `2 × count`. Flat rather than nested
because it is the **largest single extract the project publishes** and the pairing
overhead is real at 132k points.

> This file is the reason the attribution rule is written the way it is. It
> originally shipped `{schema, count, coords}` and nothing else — the biggest
> extract, one public URL, **no notice attached**, while every individual tile
> carried one. A reader who fetched one tile learned where the data came from; a
> reader who fetched _all of it_ learned nothing. That is exactly backwards, and
> `scripts/attribution.test.mjs` now fails the build if any published file drops
> the notice.

`schema` stays `fwm-overview/v1` across added keys: the reader in `MapCanvas.tsx`
reads `coords` and ignores the rest, and bumping the version would strand caches
over a change that removes no field.

### 3.5 `GET /cameras/tombstones.json` — the deletion ledger

```json
{
  "generatedAt": "2026-08-26T20:00:10.315Z",
  "upstream": "2026-08-26T19:00:00Z",
  "attribution": "Map data © OpenStreetMap contributors",
  "licence": "ODbL-1.0",
  "licenceUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
  "tombstones": [
    {
      "id": "osm:12341624190",
      "reason": "osm_delete",
      "seq": 122203,
      "osmVersion": 3
    }
  ]
}
```

**Tombstones, never `DELETE`.** A client that only ever merges additions would
keep a removed camera forever. `seq` is the OSM diff sequence that removed it, so
a client can tell whether it has already applied that deletion.

`reason` distinguishes an outright OSM delete, **the invisible retag**—an
object that still exists but no longer qualifies—and a newer qualifying node
that moved outside the strict release territory. The one-time
`cutover_reconciliation` reason is reserved for the complete set of legacy
predecessor-live ids absent after the inherited ledger is applied. That includes
a predecessor-live id with an inherited historical tombstone: reconciliation
must re-fetch it and replace the old entry with the proved current state. For
that reason, `osmVersion` is the exact current OSM node version and `seq` is the
official hourly observation fence used during reconciliation; it does not
pretend that an historical diff at that sequence removed the node. Every
approved generation requires the attribution, licence identifier, exact licence
URI, canonical node id, positive `osmVersion`, and duplicate-free canonical
ledger shown above.

### 3.6 `GET /cameras/counties.json` and `/cameras/places.json`

Gazetteers, for rendering a name next to a count. An approved generation derives
`counties.json` exactly from its live cameras and the pinned geometry:

```json
{
  "generatedAt": "2026-09-02T12:00:00.000Z",
  "source": "US Census county polygons, joined point-in-polygon",
  "attribution": "Map data © OpenStreetMap contributors",
  "licence": "ODbL-1.0",
  "licenceUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
  "counties": 1,
  "located": 3845,
  "unlocated": 0,
  "rows": [
    {
      "fips": "48201",
      "name": "Harris",
      "lsad": "County",
      "state": "TX",
      "label": "HARRIS CO, TX",
      "cameras": 3845
    }
  ]
}
```

```json
{
  "generatedAt": "2026-09-02T12:00:00.000Z",
  "source": "No place enrichment in the approved direct-capture baseline",
  "attribution": "Map data © OpenStreetMap contributors",
  "licence": "ODbL-1.0",
  "licenceUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
  "places": 0,
  "inPlace": 0,
  "unincorporated": 137000,
  "rows": []
}
```

The example camera totals are illustrative, not a release count. For approved
v3, `located` and `unincorporated` equal `index.cameras`, `unlocated` and
`inPlace` are zero, every county row and count is recomputed from the tiles, and
the place rows are always empty. Unknown keys, mismatched counts, or contact-like
strings make the generation invalid.

### 3.7 `GET /cameras/continuity.json` — independently replayable state

Every `versionsKnown:true` generation carries
`darkroute-camera-continuity/v1`. It binds the approved receipt hash; baseline
sequence and semantic live/tombstone digests; canonical resolved baseline
tombstones; either a `baseline-replay` or immutable-parent `replication`
transition; the exact contiguous numbered state/diff URLs, byte lengths, and
SHA-256 values; final replication state and counts; and a bounded canonical
gzip+base64 semantic core. The core covers every published camera field except
the separately validated deterministic enrichment fields and covers full
live-versus-tombstone membership.

The attester builds this body only after independently applying every official
diff to the exact receipt-bound capture and immutable baseline tombstone input.
The publisher repeats that derivation and compares canonical bytes before its
first candidate write. A mixed capture cannot claim the conservative floor as
its exact state: the candidate watermark must have crossed the newest retained
response `osm_base` and every input tombstone sequence.

### 3.8 The safety breakers on the pipeline

These are contracts too: they bound what a published file can ever contain, so a
consumer knows the shape of the worst case. `scripts/sync-cameras.mjs` **aborts the
run** rather than publishing when any of them trips.

| Constant                 | Value  | What it stops                                                                                  |
| ------------------------ | ------ | ---------------------------------------------------------------------------------------------- |
| `MAX_TOMBSTONE_FRACTION` | `0.01` | A run removing more than 1% of live cameras.                                                   |
| `MAX_TOMBSTONE_ABSOLUTE` | `500`  | The same, in absolute terms — ~8× measured daily churn.                                        |
| `MAX_UPSERT_ABSOLUTE`    | `5000` | A mass **addition**. The breaker originally watched only removals, which missed a bulk import. |
| `MAX_MOVE_M`             | `2000` | A camera that "moved" two kilometres is a coordinate error, not a relocation.                  |
| `MAX_MOVED_CAMERAS`      | `250`  | Many such moves at once.                                                                       |
| `MAX_DIFFS_PER_RUN`      | `24`   | Bounded work per run.                                                                          |

The 24-diff default may produce and publish a complete intermediate generation;
later scheduled runs converge without skipping a sequence. A bootstrap is
different: the workflow uses `--max 1000 --require-caught-up`, and refuses to
publish if that single bounded run cannot reach the head it observed.

Five standing rules govern the sync, and they are stated in the script itself:

```
RULE 0  absence is never evidence of deletion
RULE 1  a delete record need not tell us it was a camera
RULE 2  replay guard: a version we already hold is dropped
RULE 3  tombstones, never DELETE
RULE 5  watermarks come from state.txt, never from arithmetic
```

RULE 0 has teeth: an **unknown** qualifying node outside the footprint is
ignored. A **known** camera receiving a newer qualifying version outside the
strict footprint is explicitly removed with an `osm_out_of_scope` tombstone;
otherwise the old in-scope coordinates would survive while the watermark moved
past the relocation. With no watermark the run adopts the head and applies
_nothing_, because without proven continuity there is no basis for any deletion.

`scripts/fetch-cameras.mjs` carries the bootstrap's own breaker, named after the
incident that produced it: **"REFUSES THE ZERO THAT COST 19,000 CAMERAS"**. An
Overpass chunk that returns zero where cameras are held is a failed query, not an
empty region.

### 3.9 R2 generation and caching envelope

The public URL shapes above are logical archive keys. Atomic R2 publication
places them under one of three slots and selects the complete slot with:

```json
{
  "schema": "darkroute-camera-pointer/v1",
  "slot": "b",
  "generation": "<64 lowercase hex>",
  "manifestSha256": "<64 lowercase hex>",
  "previous": {
    "slot": "a",
    "generation": "<64 lowercase hex>",
    "manifestSha256": "<64 lowercase hex>"
  },
  "updatedAt": "2026-09-01T18:00:00.000Z"
}
```

`previous` is either that exact three-field reference or `null`. The object
lives at `__camera/current.json`; it selects
`__camera/slots/{slot}/data/{logical-key}`. Each slot's
`manifest.json` uses schema `darkroute-camera-generation/v1` and contains its
generation, `createdAt`, exact replication state, archive summary, and a
strictly sorted inventory:

```json
{
  "key": "11/606/765.json",
  "bytes": 8421,
  "md5": "<32 lowercase hex>",
  "sha256": "<64 lowercase hex>"
}
```

The replication object is exactly `stream`, `lastAppliedSeq`,
`lastAppliedTimestamp`, and `versionsKnown`. It is the published continuity
contract; diagnostic `lastRun` and runtime `basePointer` are not part of the
manifest. The generation id hashes replication, archive metadata, and inventory,
but not `createdAt`.

Hydration writes a runtime state object containing those four replication fields
and a `basePointer` equal to the complete pointer above. Sync may advance the
replication fields but must preserve that pointer exactly. Normal publication
refuses before candidate mutation unless the observed remote pointer equals
`basePointer`; a reviewed bootstrap state has no `basePointer` and may publish
only while the remote pointer is absent.

Every approved manifest inventory must contain all six sidecars — `index.json`,
`overview.json`, `tombstones.json`, `places.json`, `counties.json`, and
`continuity.json` — plus its canonical tile set. Publication holds a 180-minute
lease behind a 110-minute
hard write fence and revalidates that exact lease before candidate reconcile,
manifest write, and pointer write.

The Function accepts only the six named sidecars in §3.2–§3.7 and canonical
z11 tile paths whose x/y coordinates are in `[0, 2047]`. It reads the pointer on
every request. With an R2 binding, an absent, malformed, or unreadable pointer
returns `503` with `no-store`; the Function never reads the legacy bucket root.
An unbound deployment alone calls `context.next()` to preserve rollback to an
older static artefact.

For a `200` or tile `404`, the response also carries:

```
x-darkroute-camera-generation: <pointer generation>
```

All successful camera bodies otherwise use:

```
cache-control: public, max-age=3600, must-revalidate
etag:          <R2 httpEtag>
content-type:  application/json; charset=utf-8
```

A disallowed logical path is `400`. A missing tile is `404` **with the same
cache-control**, so an empty square is cached as cheaply as a full one. A
missing required sidecar is instead `503` with `no-store`. Successful responses
emit only the JSON content type, cache policy, R2 object ETag, and generation
header; arbitrary R2 metadata is not forwarded.

---

## 4. The persisted schemas

**Source:** `apps/pwa/src/services/db/schema.ts` (types and policy only — it opens
nothing, writes nothing and imports no browser API, so it is safe to import from a
worker or a test that never touches storage).

Two databases:

| Database     | Version | Holds                                              |
| ------------ | ------- | -------------------------------------------------- |
| `fwm`        | **4**   | Everything the app knows when the network is gone. |
| `fwm-crypto` | **1**   | Non-exportable `CryptoKey` objects. Nothing else.  |

### 4.1 Four privacy invariants enforced by the schema itself

1. **No store has a licence plate as a key, an index, or a cleartext value.**
   `plateVault` holds ciphertext, an IV, an opaque key id and numbers, keyed by an
   opaque `plateId` that carries no information about the plate.
   `assertPlateVaultRecordSafe()` is the runtime half, and every write goes
   through it.
2. **No store records the vehicle's exact position for alerting purposes.**
   `alerts` keeps distance and heading, never a latitude. The one place a
   coordinate is stored is a report the user deliberately filed — because a camera
   report without a position is not a report.
3. **Muting is a field on the alert record, not a filter on the write path.** A
   muted camera still writes its alert row, still counts toward exposure, still
   shows on SWEEP. Muting removes the _alert_, never the _record_.
4. **`reportPhotos` is the only store holding a picture of a real place, and it
   holds nothing else.** No capture time, no coordinates, no index, and bytes
   that were re-encoded before they arrived, so the camera's own location tag is
   gone. It is keyed by the report it belongs to, so every path that deletes a
   report deletes the photograph in the same breath.

### 4.2 Store map

| Store            | Key                        | Indexes                         | Signed content?                                   |
| ---------------- | -------------------------- | ------------------------------- | ------------------------------------------------- |
| `cameraTiles`    | `[z,x,y]`                  | `by-fetchedAt`                  | no                                                |
| `tileMeta`       | `[z,x,y]`                  | —                               | no                                                |
| `alerts`         | `id` (auto)                | `by-at`, `by-cameraId`          | no                                                |
| `trips`          | `id` (auto)                | `by-startedAt`                  | no                                                |
| `pendingReports` | `reportId`                 | **none**                        | **yes — the whole record**                        |
| `reportChain`    | `reportId`                 | `by-syncState`, `by-capturedAt` | **partly** (see §4.5)                             |
| `pendingActions` | `id` (auto)                | `by-state`, `by-nextAttemptAt`  | no                                                |
| `settings`       | `name`                     | —                               | no                                                |
| `storeBlobs`     | `name`                     | —                               | no                                                |
| `session`        | `key` (always `"current"`) | —                               | no                                                |
| `plateVault`     | `plateId`                  | —                               | no (encrypted)                                    |
| `plateMatches`   | `matchId`                  | `by-plateId`, `by-at`           | no                                                |
| `reportPhotos`   | `reportId`                 | **none**                        | no — but its **digest** is signed, in the payload |

`pendingReports` has **no index on purpose**: it is read by id, exported whole,
and never sorted by anything that is not already in `reportChain`.

`reportPhotos` has **no index for a stronger reason**, the same one `plateVault`
gives: an index over this store is an ordering an attacker can query, and
nothing needs one. It is read by report id and cleared wholesale. Its repository
deliberately exposes no `all()` either — **nothing in this app may enumerate
photographs.**

Adding a name to `STORE_NAMES` is not enough to create a store — a numbered
migration must do that — but **every name there must be reachable from some
migration or `openFwmDb()` refuses to open**. A forgotten migration is caught at
startup, not at the first read.

### 4.3 Migration history

| Version | Description                                                                                                                                                    |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**   | Create `cameraTiles`, `tileMeta`, `alerts`, `trips`, `pendingReports`, `reportChain`, `pendingActions`, `settings`, `session`, `plateVault`.                   |
| **2**   | Add `plateMatches`; index `reportChain` by `capturedAt`; backfill chain sync fields.                                                                           |
| **3**   | Add `storeBlobs`, the durable backing store for persisted preferences.                                                                                         |
| **4**   | Add `reportPhotos`, the byte store for photographs attached to reports. No index, no backfill: an existing report carries `photo: null` and simply has no row. |

Migrations are **append-only** and each is a pure function of the upgrade
transaction. Somebody who skipped four releases runs four migrations in order, not
one merged one. **A migration that would drop signed evidence is a bug, not a
migration.**

### 4.4 `CameraRecord` and the tile stores

`CameraRecord` is structurally compatible with `CameraLike` in `packages/core`
(`id`, `lat`, `lon`, `directionDeg`) so the alert engine consumes a cached record
directly. `@fwm/core` is deliberately **not imported** here: it is not yet a
dependency of `apps/pwa`, and the storage layer must not be the thing that wires it
in. Fields are otherwise as §3.2.

```ts
type TileSource = 'network' | 'fixture' | 'user';
```

`fixture` exists because the PWA ships a drive simulator, and **the simulator's
cameras must never be mistaken for cameras somebody actually reported**.

`tileMeta` is kept apart from the tile body so a freshness write never rewrites a
tile:

```ts
type TileFreshness = 'fresh' | 'stale' | 'unknown';
```

`unknown` is **not** a synonym for `stale`. It is the state before anything has
ever checked, and the OFFLINE screen says "treat clear as probably clear" precisely
because the app must not present an unchecked tile as a clean one.

Caps (`policy.ts`): `MAX_CAMERA_TILES = 512`, `TILE_HARD_EXPIRY_MS = 30 days`,
`DEFAULT_TILE_STALE_AFTER_MS = 24 hours`.

> **The one policy rule that is not a number:** signed evidence is never evicted.
> `pendingReports`, `reportChain` and `reportPhotos` are the three names in
> `EVICTION_EXEMPT_STORES`, and none of them appears in any eviction path in this
> codebase. If storage runs out with reports queued, the app **refuses the new
> write and says so** — it does not quietly delete the thing the user filed
> precisely because they expected to still have it in a month.

**`reportPhotos` is both capped and exempt, and that is not a contradiction.**
At up to 600 KB a row it is by far the largest store per record, so on size
alone it is the obvious thing to evict — and evicting it is exactly the harm the
exemption exists to prevent, arrived at sideways: a signed record would end up
citing a digest whose bytes _the app itself deleted without being asked_. So the
ceiling is enforced at the **write** end instead, which is what "refuses the new
write and says so" means for a store whose rows are pictures:
`MAX_REPORT_PHOTOS = 50` (a 30 MB worst case), and at the cap the report sheet
refuses the _photograph_ while still filing the _report_. Nothing is deleted to
make room.

A store that is capped and exempt reports `over > 0, evictable: false` from
`estimateUsage()`. That reads as "overdue, and deliberately nobody's to fix
silently", and it is the intended readout rather than an accounting bug.

### 4.5 `ReportChainRecord` — where signed meets mutable

This is the most security-relevant table in the app, because it is the one place
signed fields and transport bookkeeping sit in the same row.

| Field               | Signed?                     | Meaning                                                                                                                                                                                                                                                                  |
| ------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reportId`          | **✔ locked**                | Primary key.                                                                                                                                                                                                                                                             |
| `payloadHash`       | **✔ locked**                |                                                                                                                                                                                                                                                                          |
| `previousChainHash` | **✔ locked**                | `GENESIS_CHAIN_HASH` for the first drop; **never null**.                                                                                                                                                                                                                 |
| `chainHash`         | **✔ locked**                |                                                                                                                                                                                                                                                                          |
| `signature`         | **✔ locked**                |                                                                                                                                                                                                                                                                          |
| `publicKeyId`       | **✔ locked**                |                                                                                                                                                                                                                                                                          |
| `capturedAt`        | **✔ locked**                | Stored as the **ISO-8601 string the signed record carries**, verbatim, not an epoch number — so the row and the record can never disagree. A fixed-width UTC timestamp also sorts lexicographically in exactly chronological order, which is what `by-capturedAt` needs. |
| `syncState`         | ✘ mutable                   | `QueueSyncState`, five values.                                                                                                                                                                                                                                           |
| `attempts`          | ✘ mutable                   | Attempts against the server so far.                                                                                                                                                                                                                                      |
| `nextAttemptAt`     | ✘ mutable                   | Epoch ms the next attempt is due, or `null`.                                                                                                                                                                                                                             |
| `publishableAt`     | ✘ mutable, **write-locked** | See below.                                                                                                                                                                                                                                                               |
| `lastError`         | ✘ mutable                   | Last failure. **Never a plate.**                                                                                                                                                                                                                                         |
| `deadLetterReason`  | ✘ mutable                   | Why this became terminal.                                                                                                                                                                                                                                                |
| `syncedAt`          | ✘ mutable                   | Epoch ms the server acknowledged it.                                                                                                                                                                                                                                     |

The locked set is `IMMUTABLE_CHAIN_FIELDS`, and `reportChainRepository` diffs an
incoming write against what is stored, so an attempt to "fix" a hash **fails
loudly instead of quietly rewriting evidence**. The parallel constant for the body
store is `IMMUTABLE_REPORT_FIELDS`, which is every field of `EvidenceRecord`
**except `syncState`** — the deliberate omission, and the only one.

#### Two sync vocabularies, and why

```ts
type SyncState = 'held' | 'syncing' | 'synced' | 'rejected'; // the record
type QueueSyncState = 'pending' | 'syncing' | 'synced' | 'rejected' | 'dead_letter'; // the queue
```

The evidence chain models the record's **own opinion of itself**. The queue
additionally has to model _"we have stopped trying"_, which is what `dead_letter`
is. Without it, the only way to express "this will never succeed" is to delete the
row — and **deleting a signed report to tidy up a queue is the one thing this
layer must never do**.

`queueStateFromChain` and `chainStateFromQueue` are the **only** two places the
vocabularies meet. `pending ↔ held`; `dead_letter → rejected`, because from the
record's point of view a dead-lettered record is refused. The reason it stopped
being retried lives in `deadLetterReason`, where a human can read it.

#### `publishableAt` — a field the retry scheduler cannot compile against

This is the subtlest contract in the codebase and it is worth stating plainly.

`nextAttemptAt` is transport bookkeeping. It is **overwritten by `markFailed` on
every retry** and **nulled by `markSyncing`**.

A privacy hold stored in that field is therefore deleted by the first 429, the
first closed changeset, the first dropped tunnel. A jitter measured in **days**
collapses to a backoff measured in **seconds**, and the record uploads at a time
tightly correlated with where its author was. That failure is silent, lives in the
error path, and defeats the single mitigation everything else leans on.

So the hold gets its own field, and `ReportSyncPatch` — the type of every
transport write — **deliberately omits it**:

```ts
type ReportSyncPatch = Partial<
  Pick<
    ReportChainRecord,
    'syncState' | 'attempts' | 'nextAttemptAt' | 'lastError' | 'deadLetterReason' | 'syncedAt'
  >
>;
```

A transport that tries to touch `publishableAt` **does not compile**.

#### The two schedules, which must never be confused

|                                     | Range                             | Purpose                                                  |
| ----------------------------------- | --------------------------------- | -------------------------------------------------------- |
| **Publish hold** (`publishableAt`)  | uniform **1 to 7 days**           | Decorrelates upload time from capture time and location. |
| **Retry backoff** (`nextAttemptAt`) | 30 s, ×2, ceiling 1 h, 8 attempts | Recovers from a transient network failure.               |

```ts
PUBLISH_HOLD_MIN_MS = 24 * 60 * 60 * 1000; // 1 day
PUBLISH_HOLD_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
publishHoldMs(random) = round(MIN + clamp01(random()) * (MAX - MIN));

DEFAULT_BACKOFF_POLICY = {
  baseDelayMs: 30_000,
  factor: 2,
  maxDelayMs: 3_600_000,
  jitterRatio: 0.5,
  maxAttempts: 8,
};
```

Eight attempts gives a queued report just over four hours of trying. **"Dead" means
the app stops asking the network about it — the record is still on disk and still
exportable.**

`publishHoldMs` clamps a non-finite roll to `0` rather than propagating `NaN`, so a
broken random source yields the **minimum hold**, never no hold. The hold and the
backoff differ by roughly three orders of magnitude, which is deliberate:
`publishHold.test.ts` asserts the hold **"DWARFS the retry backoff, so the two
cannot be confused for each other"**.

### 4.6 The remaining stores

**`AlertRecord`** — `cameraId`, `state`, `distanceFt`, `headingDeg`, `speedMph`,
`at`, `muted`, `dismissed`. `muted` and `dismissed` are **recorded, never
applied**: the only thing `muted` ever suppressed was delivery — the sound, the
haptic, the takeover. **There is no latitude here, on purpose.** A trip's exposure
is a count and a distance, and neither needs the coordinates that produced them.

**`TripRecord`** — `startedAt`, `endedAt` (`null` while running), `distanceMi`,
`cameraIdsPassed`, `exposureCount`. Muted passes count.

**`PendingActionRecord`** — `confirm_camera` / `dispute_camera` / `claim_handle`.
Cheap, idempotent and replayable, which is why they retry. `subjectId` is a camera
id or a handle — **never a plate**; `body` is a small JSON-serialisable map,
**never a plate**. Reports are deliberately _not_ in this store: a report is signed
evidence and lives in `pendingReports`.

**`settings`** — a typed key-value table with a **closed name list**, one guard per
name. Note what is _not_ there: a default alert threshold. The engine's default is
`DEFAULT_ALERT_THRESHOLD_FT` in `packages/core`, and duplicating it here would
create a second place for a design value to drift. The store answers "not set"
honestly and readers pass their own fallback.

**`storeBlobs`** — separate from `settings` **on purpose**. Zustand persists a
whole slice as one opaque JSON string under a store name it chooses; sharing the
typed table would mean either widening the name union on every new slice or writing
rows the typed accessors would refuse to read back. Every blob has already passed
`assertPersistSafe` before it arrives: no plate, no plate-shaped key, **no field
whose _name_ implies plate custody**.

**`session`** — one row, key `"current"`. A server-issued anonymous UUID, **not
derived from anything on the device**, plus an optional display handle. There is no
login of any kind.

**`ReportPhotoRecord`** — `reportId` (the key, 1:1 with `pendingReports`),
`sha256`, `bytes`, `mimeType`, `sizeBytes`, `width`, `height`. That is the whole
row.

`bytes` is a **`Uint8Array` and never a `Blob`**. This is a storage contract, not
a style preference: `structuredClone` of a Blob in this repository's test
environment yields a plain object with `size: undefined` rather than throwing,
and the in-memory IndexedDB double's deep-copy fallback has no Blob branch
either, so a Blob would silently round-trip to an empty object in every storage
test while appearing to work in a browser.

**What is deliberately absent is the interesting half.** There is no capture
time. `PreparedPhoto` knows the shutter time and the signed record already
carries the submit time; storing the shutter time as well would add a second,
finer record of when a specific person stood in a specific place, and nothing
reads it. There is no coordinate, no camera id, no filename and no reference to
the source file. And there is no index, so nothing can order or enumerate these
rows — an ordering key here would be a fingerprint with no consumer.

**Why keyed on `reportId` rather than on the content hash.** Content addressing
dedupes, which sounds free and is not: two reports carrying the same image would
share one row, and purging the first would delete bytes the second still names.
It would also make the key itself a stable fingerprint of the picture. Keyed by
`reportId`, the store is 1:1 with the body, so every erase path in this codebase
is already "delete the key you were deleting anyway" — which is why
`purgeSynced()` drops a photograph in the same transaction as its report body,
and why an orphaned photograph, invisible to every screen and every count while
still sitting on disk, cannot arise.

The bytes that arrive here have already been through `preparePhoto()`: decoded,
EXIF orientation baked into the pixels, resized to `MAX_EDGE_PX = 1600` on the
long edge, and re-encoded as JPEG down a quality ladder until the result fits
`MAX_BYTES = 600 KB`. A canvas re-encode writes a file with no metadata at all,
which is why the sheet can state as fact rather than as hope that the location
tag is gone. **Nothing uploads this store**, and nothing exports it: it is not
part of `fwm-evidence-export/v1`.

### 4.7 `plateVault` and `plateMatches` — the two stores that never leave

**`fwm-plate/v1`**, `apps/pwa/src/services/crypto/plate.ts`.

| Field        | Meaning                                                                           |
| ------------ | --------------------------------------------------------------------------------- |
| `plateId`    | Random lowercase UUID. **Opaque, never derived from the plate.**                  |
| `schema`     | `"fwm-plate/v1"`                                                                  |
| `iv`         | base64url, **12 bytes, unique per record**.                                       |
| `ciphertext` | base64url AES-GCM output — ciphertext plus tag.                                   |
| `blindIndex` | Keyed, truncated HMAC of the normalised plate. Hex, **32 characters** (16 bytes). |
| `createdAt`  | ISO-8601, from the sealed record.                                                 |
| `keyId`      | Opaque id of the non-exportable AES-GCM key. **Never key material.**              |
| `updatedAt`  | Epoch ms. Storage bookkeeping, not evidence.                                      |
| `readCount`  | How many camera reads matched locally. **A count is not a plate.**                |

`PLATE_VAULT_FIELDS` is a **strict allowlist**, not a denylist: a field nobody
anticipated is exactly how a plate ends up in this store in the clear, so an
unanticipated field is a **rejected write**.

```
normalisePlate(p) = NFC(p).toUpperCase().replace(/[^A-Z0-9]/g, '')   # empty -> InvalidPlateError
blindIndex        = HMAC-SHA-256(indexKey, "fwm-plate-index/v1:" + normalisePlate(p))[0:16]  # hex
```

**Why the key is an opaque UUID.** A keyspace derived from the secret leaks the
secret to anyone who can enumerate it. Equality matching uses `blindIndex`, which
is useless without the vault key — so **a different install produces a different
index for the same plate**, and two vaults cannot be correlated.

**Why there is no label field.** The WATCHLIST screen shows labels — "mine",
"partner", "trailer". A label is free text, and free text is exactly where somebody
writes the plate a second time in the clear. When labels are implemented they get
sealed like everything else; they do not get a column.

Ciphertext is **bound to its record id**, so a copied ciphertext will not open in
another row.

`plateMatches` holds **no plate**: `plateId` is the opaque vault key, so a dump of
this store tells an attacker which cameras matched _something_, and nothing about
what.

### 4.8 `fwm-crypto` and key material

Four key ids, all non-exportable `CryptoKey` objects (`extractable: false`). **Key
material never appears in any record, export, log or blob.**

| Key id                        | Algorithm    | Use                                              |
| ----------------------------- | ------------ | ------------------------------------------------ |
| `evidence-signing-private-v1` | ECDSA P-256  | Signing evidence records.                        |
| `evidence-signing-public-v1`  | ECDSA P-256  | Verification; exported as SPKI into each record. |
| `plate-vault-aes-gcm-v1`      | AES-GCM      | Sealing plates.                                  |
| `plate-blind-index-hmac-v1`   | HMAC-SHA-256 | The blind index.                                 |

Key generation is `generateKey(..., extractable = false, ['sign','verify'])`, and
the pair is **read back after storage** to confirm it persisted before anything is
signed against it.

### 4.9 `clearLocalData()`

Returns a `ClearLocalDataReport` where **every number is counted before the delete,
not estimated after it**, so the confirmation a user reads is the truth about their
own device.

It removes: encrypted plate rows, the local match index, the secret settings
(`plateVault.keyId`, `plateVault.lastExportAt`), alerts, trips, and **every
attached photograph** — counted into `photosRemoved`.

It does **not** remove signed evidence. `signedReportsRemoved` is **always `0`**,
and the reason is stated in the source: _"a 'clear my data' button that silently
shreds the reports somebody filed is not a privacy feature."_ Clearing the vault
also does not end the evidence chain — the two are independent, and
`plate.test.ts` asserts it.

**Why the photographs go while the reports stay.** A signed report is a _link in
a chain_: deleting one breaks verification for every record after it, so the
button that promises privacy would be quietly destroying the user's own
evidence. A photograph is a _leaf_. What the chain committed to is the digest,
and the digest stays in the retained payload, so deleting the bytes breaks no
signature, no payload hash and no chain link. The retained report goes on saying
truthfully "there was a photograph, this was its digest", and the picture is
gone. Since it costs no integrity at all, and a photograph of a real place is the
artefact that most obviously puts a person somewhere, it goes.

That asymmetry is printed, not merely implemented. `describeForgetReport()`
states the photograph count on its own line, and the line reporting retained
reports carries the clause _"the photographs they named are gone - the signature
covers the digest, not the picture"_, because a user told only "2 signed camera
reports kept" would reasonably conclude the pictures were kept too. The SETTINGS
screen lists **`PHOTOS YOU ATTACHED / REMOVED`** and **`SIGNED CAMERA REPORTS /
KEPT`** as two separate rows for the same reason.

---

## 5. The Meshtastic protobuf surface

**Source:** `apps/pwa/src/features/node/mesh.ts`
**Direct dependency:** `@meshtastic/js@2.6.0-0` (pinned, exact)
**Protobufs:** `@jsr/meshtastic__protobufs@2.7.26`, resolved transitively as
`@meshtastic/protobufs`

DarkRoute defines **no protobuf schema of its own**. Every message below is
upstream Meshtastic. This section states exactly which ones are read, which are
written, and — importantly — which enum values this app has names for versus which
it passes through.

> **Why there is no custom firmware under this.** A custom protobuf would mean a
> custom firmware build, which means asking people to reflash a radio they depend
> on, in order to run code that watches for surveillance cameras. That is a worse
> ask than the feature is worth. Everything here works on stock firmware.

### 5.1 Messages READ (subscriptions)

Seven subscriptions. All of them are **passive** — the radio hears what it hears.

| Subscription             | Upstream message                          | What is taken                                                                     |
| ------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------- |
| `onMyNodeInfo`           | `meshtastic.MyNodeInfo`                   | Our own node number.                                                              |
| `onNodeInfoPacket`       | `meshtastic.NodeInfo` + `meshtastic.User` | `num`, `user.longName`, `user.shortName`, `user.role`, `user.hwModel`, `viaMqtt`. |
| `onDeviceMetadataPacket` | `meshtastic.DeviceMetadata`               | Firmware version, `hwModel`.                                                      |
| `onConfigPacket`         | `meshtastic.Config`                       | Only two variants — see below.                                                    |
| `onChannelPacket`        | `meshtastic.Channel`                      | `index`, `settings.name`, `role`.                                                 |
| `onMessagePacket`        | text payload                              | The message text and its sender.                                                  |
| `onMeshPacket`           | `meshtastic.MeshPacket`                   | **Every packet off the air, decodable or not.**                                   |

`onMeshPacket` fires **before the SDK's decode switch**, so a packet encrypted to
somebody else's channel still arrives and is still proof the radio works. That is
what turns the instrument panel from a still picture into a live one.

`onConfigPacket` reads exactly two variants:

| Variant                              | Taken                                                                                       | Deliberately not taken                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `lora` (`Config.LoRaConfig`)         | `region`, `modemPreset`, `hopLimit`, **plus the whole message retained** for merge-on-write | —                                                                                                                                      |
| `security` (`Config.SecurityConfig`) | **`privateKey.length` only** (`=== 32`)                                                     | The key bytes are **never read, bound or stored**. This is the app asking "can this radio seal a direct message at all", nothing more. |

### 5.2 Messages WRITTEN

Four SDK calls, five session methods. **Each has exactly one call site**, and that
call site is a person pressing a button.

| Session method                  | SDK call                                 | Message constructed           | Notes                                                                                                                      |
| ------------------------------- | ---------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `sendText(text)`                | `connection.sendText(text, 'broadcast')` | text payload                  | Broadcast.                                                                                                                 |
| `sendDirect(to, text)`          | `connection.sendText(text, to)`          | text payload                  | A node **number**, never `'broadcast'`. That is the whole difference, and it is what makes the firmware take its PKI path. |
| `joinChannel(index, name, psk)` | `connection.setChannel(...)`             | `Channel` + `ChannelSettings` | `role: SECONDARY`, **never `PRIMARY`**.                                                                                    |
| `setOwnerName(long, short)`     | `connection.setOwner(...)`               | `meshtastic.User`             | `longName` rides every NodeInfo, so it is public by construction, and the panel says so before the field.                  |
| `setLora(region, preset, hop)`  | `connection.setConfig(...)`              | `Config` / `lora` variant     | **Merged, not replaced** — see §5.4.                                                                                       |

#### `SECONDARY`, never `PRIMARY`

A **primary** channel sets the radio's frequency. Writing one would move somebody
off the mesh they already use, which is the one thing this must never do. A
**secondary** channel ignores radio settings and uses only its PSK — "only psk is
used", in the protobuf's own words — so the primary channel, the frequency, the
region and the modem preset are all untouched.

Writing one also **transmits nothing**: the admin packet is addressed to the local
node, and firmware's `Router::sendLocal` short-circuits before the radio. It is a
configuration write over the Bluetooth cable.

### 5.3 The seven banned calls

`mesh.privacy.test.ts` **fails the build** if any of these appears anywhere in the
feature. The list is not "everything we have not needed yet" — it is the set where
a single call does damage that cannot be undone from this app.

| Call              | Why it is banned                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sendPacket`      | The raw escape hatch. Anything reachable through it is reachable **without any of the gates**.                                                                               |
| `sendWaypoint`    | Puts a **coordinate** on the air. Never.                                                                                                                                     |
| `requestPosition` | Asks another node for its coordinates. Also never — the one thing this project must not do is collect positions.                                                             |
| `traceRoute`      | Makes every node on the path log that we asked.                                                                                                                              |
| `deleteMyNode`    | Wipes the radio's own database.                                                                                                                                              |
| `factoryReset`    | Unrecoverable, and takes the owner's keypair with it.                                                                                                                        |
| `setModuleConfig` | Sixteen module panels, none of which a driving app needs, and several of which (MQTT, Serial, External Notification) can start publishing traffic **off the mesh entirely**. |

Separately banned as **location fields**: `latitudeI`, `longitudeI`,
`onPositionPacket`, `onWaypointPacket`.

The same test file asserts the behavioural half: every channel write needs a
press, the app **joins nothing on its own**, and it **never broadcasts on a
timer**.

> `setOwner` and `setConfig` **left** the ban list when the config panels shipped.
> The promise did not get weaker, it got more precise: this is the owner's radio,
> and refusing to let them name it or set its region made the app less useful
> without making anybody safer — they simply used another app to do it. What
> replaced the ban is the one-file rule: exactly one call site, in `mesh.ts`,
> reviewable in one place.

### 5.4 The `setLora` merge rule

`Config.LoRaConfig` carries **20 fields** in 2.7.26:

```
usePreset  modemPreset  bandwidth  spreadFactor  codingRate  frequencyOffset
region  hopLimit  txEnabled  txPower  channelNum  overrideDutyCycle
sx126xRxBoostedGain  overrideFrequency  paFanDisabled  ignoreIncoming
ignoreMqtt  configOkToMqtt  femLnaMode  serialHalOnly
```

A partial `setConfig` **resets every field it omits to the protobuf default.** So
`setLora` reads the node's _current_ config — retained from `onConfigPacket` — and
writes it back with **three fields changed**, preserving the other **17**:

```ts
value: { ...current, region, modemPreset: preset, hopLimit }
```

Passing a fresh object would silently **re-enable transmit on a node somebody
deliberately muted** (`txEnabled`) and **drop a frequency override they set on
purpose** (`overrideFrequency`). `setLora` throws rather than guessing if the node
has not sent its LoRa config yet.

### 5.5 Enum mapping — this app's names against upstream

Four lookup tables. **This app never sends a name to a radio** — `regionCode()` and
`presetCode()` reverse the same table rather than maintaining a second one, because
"a hand-maintained second table is how a radio ends up set to Malaysia because
somebody renumbered a row."

#### `REGION_NAME` — `Config.LoRaConfig.RegionCode` — **accurate, incomplete**

Codes 1–18 all match upstream exactly (`1 US`, `2 EU 433`, `3 EU 868`, `4 CN`,
`5 JP`, `6 ANZ`, `7 KR`, `8 TW`, `9 RU`, `10 IN`, `11 NZ 865`, `12 TH`,
`13 LORA 24`, `14 UA 433`, `15 UA 868`, `16 MY 433`, `17 MY 919`, `18 SG 923`).

**Unmapped upstream values:** `0 UNSET`, `19 PH_433`, `20 PH_868`, `21 PH_915`,
`22 ANZ_433`, `23 KZ_433`, `24 KZ_863`.

#### `PRESET_NAME` — `Config.LoRaConfig.ModemPreset` — **accurate, incomplete**

Codes 0–8 all match upstream exactly (`0 LONG FAST` … `8 SHORT TURBO`).

**Unmapped upstream values:** `9 LONG_TURBO`, `10 LITE_FAST`, `11 LITE_SLOW`,
`12 NARROW_FAST`.

#### `ROLE_NAME` — `Config.DeviceConfig.Role` — **accurate**

`0 CLIENT`, `1 CLIENT_MUTE`, `2 ROUTER`, `3 ROUTER_CLIENT`, `4 REPEATER`,
`5 TRACKER`, `6 SENSOR`, `7 TAK`, `8 CLIENT_HIDDEN`, `9 LOST_AND_FOUND`,
`10 TAK_TRACKER`, `11 ROUTER_LATE`, `12 CLIENT_BASE`.

This is not decoration: a `ROUTER` repeats everything it hears and a `CLIENT_MUTE`
repeats nothing, so the roster's mix of roles is most of the answer to "why is this
mesh slow" or "why does nothing reach me".

#### `CHANNEL_ROLE` — `Channel.Role` — **accurate**

`0 DISABLED`, `1 PRIMARY`, `2 SECONDARY`.

#### `HARDWARE_NAME` — `meshtastic.HardwareModel` — **DIVERGENT**

**Sixteen of the nineteen codes in this table name a different board than upstream
2.7.26 does.** Verified by diffing `mesh.ts:354` against the generated enum in
`@jsr/meshtastic__protobufs@2.7.26/lib/mesh_pb.ts`.

| Code    | `HARDWARE_NAME` says      | Upstream 2.7.26        | Agree? | Real code for the label used   |
| ------- | ------------------------- | ---------------------- | ------ | ------------------------------ |
| 4       | `HELTEC V2.0`             | `TBEAM`                | ✘      | `HELTEC_V2_0 = 5`              |
| 9       | `HELTEC V3`               | `RAK4631`              | ✘      | `HELTEC_V3 = 43`               |
| 10      | `T-BEAM`                  | `HELTEC_V2_1`          | ✘      | `TBEAM = 4`                    |
| 12      | `T-ECHO`                  | `LILYGO_TBEAM_S3_CORE` | ✘      | `T_ECHO = 7`                   |
| 31      | `RAK4631`                 | `STATION_G2`           | ✘      | `RAK4631 = 9`                  |
| 39      | `RAK11310`                | `DIY_V1`               | ✘      | `RAK11310 = 26`                |
| **43**  | `HELTEC V3`               | `HELTEC_V3`            | **✔**  | —                              |
| 47      | `HELTEC WSL V3`           | `RPI_PICO`             | ✘      | `HELTEC_WSL_V3 = 44`           |
| 50      | `STATION G1`              | `T_DECK`               | ✘      | `STATION_G1 = 25`              |
| 61      | `RPI PICO`                | `CDEBYTE_EORA_S3`      | ✘      | `RPI_PICO = 47`                |
| 71      | `T-DECK`                  | `TRACKER_T1000_E`      | ✘      | `T_DECK = 50`                  |
| 75      | `T-WATCH S3`              | `ME25LS01_4Y10TD`      | ✘      | `T_WATCH_S3 = 51`              |
| 81      | `HELTEC WIRELESS TRACKER` | `SEEED_XIAO_S3`        | ✘      | `HELTEC_WIRELESS_TRACKER = 48` |
| 82      | `HELTEC WIRELESS PAPER`   | `MS24SF1`              | ✘      | `HELTEC_WIRELESS_PAPER = 49`   |
| 84      | `T-DECK PLUS`             | `WISMESH_TAP`          | ✘      | _(absent upstream)_            |
| 93      | `SEEED XIAO S3`           | `MUZI_BASE`            | ✘      | `SEEED_XIAO_S3 = 81`           |
| **103** | `T-LORA PAGER`            | `T_LORA_PAGER`         | **✔**  | —                              |
| 106     | `HELTEC MESH NODE T114`   | `RAK3312`              | ✘      | `HELTEC_MESH_NODE_T114 = 69`   |
| **255** | `PRIVATE HW`              | `PRIVATE_HW`           | **✔**  | —                              |

It is not a systematic offset — every label is a **real Meshtastic board name
attached to the wrong number**, consistent with a hand-typed table.

**Blast radius: cosmetic.** `HARDWARE_NAME` is read in exactly two places
(`mesh.ts:597` for the roster row, `mesh.ts:645` for the device panel) and the
result is a **display string only**. It reaches no packet, no key, no config write
and no stored record, so a wrong label cannot cause a wrong write. A node's board
is simply reported as the wrong model in the UI.

This is documented rather than silently corrected because this document is meant
to survive a reader diffing it against upstream. The fix is one table in
`apps/pwa/src/features/node/mesh.ts`.

### 5.6 Unmapped values: an asymmetry worth knowing

The file states its own rule — _"Anything unlisted prints its id rather than
guessing, so an unknown board reads as unknown instead of as the wrong one."_
**Two of the four tables do not follow it.**

| Table           | Fallback                          | Behaviour on an unmapped value |
| --------------- | --------------------------------- | ------------------------------ |
| `ROLE_NAME`     | `?? String(value)`                | Prints the number. **Honest.** |
| `HARDWARE_NAME` | `?? String(value)` / `?? MODEL n` | Prints the number. **Honest.** |
| `REGION_NAME`   | `?? null`                         | Renders **blank**.             |
| `PRESET_NAME`   | `?? null`                         | Renders **blank**.             |

So a node on `PH_915` (21) or `LONG_TURBO` (9) shows an **empty** region or preset
rather than an unmapped number — which reads as "no region set" instead of "a
region this build has no name for". Those are different facts. Also a one-line fix.

### 5.7 The send gate

```ts
MAX_MESSAGE_CHARS = 180;
```

`refuseToSend(text)` gates the text **before** it reaches `sendText`, which
deliberately does **not** re-check — "two places deciding what may go on the air is
how they drift apart."

`onMessagePacket` filters the radio's **echo** of our own transmissions, including
the `from === 0` case that arrives before `onMyNodeInfo` has told us our own node
number. Sent messages are recorded as ours at send time; the echo is not re-filed
as heard.

### 5.8 The sighting frame — 16 bytes on a private port

**Source:** `apps/pwa/src/features/node/sighting.ts`. This is the one wire format
DarkRoute defines itself. It is **not** a protobuf.

```
port 256 (meshtastic PRIVATE_APP — ours by convention, not by allocation)

offset  size  field         encoding
------  ----  ------------  ------------------------------------------------
     0     1  magic         0xF1
     1     1  kind          1 reported | 2 confirmed | 3 disputed
     2     4  lat           int32 big-endian, degrees x 100000
     6     4  lon           int32 big-endian, degrees x 100000
    10     2  directionDeg  uint16 big-endian, 0-359; 0xFFFF = unknown
    12     4  osmId         uint32 big-endian, OSM node id truncated; 0 = not in OSM
------  ----  ------------  ------------------------------------------------
             16 bytes total
```

Big-endian throughout. `1e-5` degrees matches the archive's own precision, so the
frame **carries no more precision than the published data has** — it cannot leak a
finer position than is already public.

**Decoding is hostile-input handling.** A packet on a shared private port can come
from anybody in radio range running anything. `decodeSighting` returns `null`
rather than a partly-filled object when any of these fails:

- length is not exactly 16
- magic is not `0xF1`
- kind is not 1, 2 or 3
- latitude or longitude is out of range
- **position is exactly `0,0`** — null island, which is what a zeroed or truncated
  packet decodes to, and where a real camera never is

A malformed packet that became a camera would put a marker on a driver's map at a
position a stranger chose.

**What may never be on the wire:** the frame has **no field for the driver**. No
observer position, no heading, no speed, no identity, no timestamp. It describes a
camera and nothing else. `sighting.test.ts` asserts this as
_"has no field for the driver"_.

---

## 6. The OSM tag contract

**Source:** `apps/pwa/src/features/report/osmTags.ts`

### 6.1 What this is not

This turns a driver's report into the exact tag set OSM expects for an ALPR
camera, and produces a link that opens the OSM editor at the right place.

**It does not upload anything.** There is no OAuth here, no changeset API call, no
automatic submission. That restraint is the design, not an unfinished edge, and
two documented outcomes are why:

- **MAPS.ME** reached the point where **36% of all its edits were duplicate POIs**,
  because the app stopped showing people what already existed nearby. The result
  was systematic manual reverts across multiple countries, DWG blocks, speed
  cameras filed as police stations, and a permanent reputational mark.
- **DeFlock** — in this exact domain, within the last year — had its iD editor
  preset **removed** because users pasted its placeholder text literally, filing
  real cameras as `operator=(AllentownPolice)`. The mechanism was a copy-pasteable
  instruction block, which is a feature anyone would ship without thinking twice.

So: **no copy-pasteable block containing placeholder syntax, ever.** The values the
app shows are final or they are absent.

Uploading under a user's own OAuth account is the right eventual shape. It needs an
**Organised Editing Activity** registered and announced at least two weeks before
the first write, plus a named human answering within two working days. A direct
competitor registered exactly that before writing anything and was told, verbatim,
_"your platform will be judged mainly by the worst-case-users"_. None of that is
code, and none of it should be skipped by writing the upload first.

### 6.2 Three corrections the obvious tagging gets wrong

Measured against the live corpus — **144,788 objects carrying
`surveillance:type=ALPR`** — not against intuition.

| #   | The obvious choice                         | What the corpus says                                                                                                                                                                                                               | What DarkRoute writes                                         |
| --- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | `operator=Flock Safety`                    | The community explicitly **split** these. Flock **builds** the camera; the **operator** is the agency that owns the footage. 73.2% carry a manufacturer tag; only **19.0%** carry an operator, because most people cannot know it. | `manufacturer=Flock Safety`, and **never** `operator`.        |
| 2   | `camera:direction`                         | The wiki documents it; the corpus does not use it. **`direction` appears on 93.6%** of these nodes, and `camera:direction` does not appear in the top co-occurring keys at all.                                                    | `direction`. **Write what the data uses; read both forever.** |
| 3   | `surveillance:type=camera` + `camera:type` | `camera:type` carries the **physical form** (fixed, panning, dome), which is a different question.                                                                                                                                 | `surveillance:type=ALPR`.                                     |

### 6.3 What `newCameraTags()` writes

Always:

```
man_made          = surveillance
surveillance:type = ALPR
surveillance      = public     # corpus majority: 75%
surveillance:zone = traffic    # corpus majority: 83%
camera:type       = fixed
```

Both `public` and `traffic` are true of any roadside ALPR **by definition** — it
watches a public road.

Conditionally:

| Tag                     | Written when                                               | Value                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `direction`             | a bearing exists                                           | `Math.round(((deg % 360) + 360) % 360)` — **whole degrees**. A compass on a phone in a moving car does not justify decimals, and OSM readers parse an integer bearing. |
| `camera:mount`          | the mount maps to something                                | see below                                                                                                                                                              |
| `manufacturer`          | the driver's free text **actually matches `/\bflock\b/i`** | `Flock Safety`                                                                                                                                                         |
| `manufacturer:wikidata` | same condition                                             | `Q108485435` — carried by 72.4% of ALPR nodes alongside the name                                                                                                       |

**Every field the driver left blank is absent rather than defaulted.** A tag nobody
observed is a claim nobody made, and it arrives in OSM under their name.

#### The mount map

```
pole    -> pole
solar   -> pole
trailer -> (nothing)
unsure  -> (nothing)
```

`unsure` maps to nothing because a driver at speed genuinely may not know, and
inventing `pole` because it is the commonest answer would put a **guess** into a
public database under their account.

`trailer` also maps to nothing, and that is a **change from what this file
originally said**. Measured against live taginfo:

| Value                      | Uses worldwide |
| -------------------------- | -------------- |
| `camera:mount=pole`        | 117,721        |
| `camera:mount=wall`        | 101,099        |
| `camera:mount=ceiling`     | 17,745         |
| `camera:mount=street_lamp` | 17,341         |
| **`camera:mount=trailer`** | **38**         |

Thirty-eight, with an unconsolidated long tail beside it (`speed trailer` 6,
`Trailer` 5, `pole_and_trailer` 5). Scoped to `surveillance:type=ALPR` it does not
appear **at all**. Pointing a whole userbase at a 38-use value is how an app
**invents a tag by force** — the specific failure the rest of the file exists to
avoid — and it would be this app that did it, since nothing has written a single
one yet.

The observation is not discarded, only the claim: the app still **records** that
the driver saw a trailer; it just does not assert a global tagging convention that
does not exist. If `camera:mount=trailer` gets consolidated and documented, this
becomes one line.

### 6.4 Changeset tags

```
created_by = DarkRoute <version>
comment    = <the driver's comment, or "Add ALPR camera" when empty>
hashtags   = #darkroute
source     = survey
```

**Space, not slash, in `created_by`.** Sampled across 100 live changesets: 83
space-form, 17 slash-form, and the slash-form is almost entirely legacy `JOSM/1.5`.
Every current editor writes a space — `iD 2.42.2`, `StreetComplete 63.4`,
`Every Door Android 7.1`, `DeFlock 2.11.0`. This is not cosmetic: **this string is
how a reviewer filters our edits**, so writing the minority form makes the app
harder to audit, which is the opposite of what the tag is for.

The hashtag is what makes the activity **findable** by the community. An organised
edit that cannot be found is one nobody can review, and being reviewable is the
whole basis for being allowed to do this at all.

`source=survey` says the driver stood next to it — telling a reviewer the value
came from the ground rather than from imagery.

### 6.5 The publication gate

**`osmNodePosition(payload)` reads `subject_position` and nothing else.** It will
not fall back to `observer_position`, and there is **no parameter to enable one**.

```ts
osmBlocker(payload):
  payload === null                             -> 'no-subject-position'
  payload.schema !== 'fwm-report/v2'           -> 'legacy-schema'
  payload.synthetic === true                   -> 'demo-origin'
  osmNodePosition(payload) === null            -> 'no-subject-position'
  otherwise                                    -> null   (publishable)
```

| Blocker               | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `legacy-schema`       | A `fwm-report/v1` record. Its only coordinate is the driver's fix, so **every v1 record is permanently ineligible, by construction**. Publishing them would file cameras in traffic lanes with a uniform offset — the exact pattern that gets a source mass-reverted — while publishing a fine-grained trail of where one person drove.                                                                                      |
| `demo-origin`         | Captured during the demo drive. The demo writes fabricated fixes into the real position store and is reachable from Settings in a production build; a report filed during it looks like a real one to every other check, and its 4 m accuracy passes any accuracy gate as HIGH confidence. **The only thing that can distinguish it is a flag set at capture time**, which is why the payload carries one and this reads it. |
| `no-subject-position` | Nobody established where the camera is. **"Not established" is an answer.**                                                                                                                                                                                                                                                                                                                                                  |

`osmNodePosition` also rejects non-numbers, non-finite values, arrays, and
out-of-range coordinates, so a malformed payload cannot reach an uploader.

A fallback here would be **invisible in review and catastrophic in aggregate**,
which is why the gate is a testable function that can return `null` rather than a
convention each caller is trusted to follow.

`osmEligibility.test.ts` pins the sharpest edge of this:
**"will not treat a missing flag as a passing flag"** — an absent `synthetic` is
not a pass.

### 6.6 Duplicate suppression

```ts
DUPLICATE_RADIUS_M = 25;
```

`nearbyExisting(lat, lon, records, radius)` returns candidates **sorted nearest
first**, because the answer is nearly always the first one. Records with unusable
coordinates are skipped rather than ranked as `NaN`.

This is the MAPS.ME lesson as a number. Its single biggest failure was ceasing to
show people what already existed nearby, and 36% of its edits became duplicates.
**Anything within this radius must be offered as "is it this one?" before a new
node is proposed.** The fix is not cleverness — it is showing the driver the
candidates before letting them create anything.

Note the interaction with §2.3: the radius is measured from `subject_position`.
Measured from the _observer_ fix — the v1 bug — it compares a road point against
pole points, and two drivers on opposite carriageways both pass the check for the
same camera.

### 6.7 The editor link

```
https://www.openstreetmap.org/edit?editor=id#map={z}/{lat:.5f}/{lon:.5f}
```

Zoom is clamped to `1..22`, default `19`. **Position only, no tag payload at all.**
iD has no supported way to pre-fill arbitrary tags from a URL, and the workaround —
handing the user a block of text to paste — is exactly what got DeFlock's preset
pulled. The app shows the tags as final values on screen; the editor opens where
the camera is; **the person does the edit**.

`editorUrl` returns `null` for a non-finite position rather than linking to null
island.

---

## 7. Building DarkRoute data into other data

The published files are deliberately boring JSON so that turning them into
something else is a short script rather than a project. Full mappings — GeoJSON,
CSV, the DeFlock and Atlas of Surveillance field correspondences — are in
[TAXONOMY.md](./TAXONOMY.md). The contract-level facts a converter needs:

1. **`id` is namespaced.** `osm:<node id>`. Split on the first `:`; do not assume
   the remainder is numeric forever.
2. **`directionDeg: null` means unknown, not absent-and-therefore-zero.** Emitting
   `0` for an unknown facing turns "we don't know" into "it faces north".
3. **Approved v3 records use the exact ten-key schema in §3.2.** Older
   `versionsKnown:false` audit files may have optional `street`, `cross`, and
   `placeGeoid`; do not project that legacy flexibility onto an approved
   generation.
4. **`tags` is a string map with a fixed allowed-key surface.** Copy its retained
   values through without recasing `ANPR`/`ALPR`, but do not reintroduce arbitrary
   upstream or contact-bearing keys.
5. **Deletions are tombstones.** A consumer that only merges additions will keep
   removed cameras forever. Apply `tombstones.json`, and use `seq` for idempotence.
6. **The licence travels.** ODbL-1.0 attaches to the extract regardless of shape.
   Any derived database must carry `Map data © OpenStreetMap contributors` and
   remain share-alike. See [LEGAL.md](./LEGAL.md).
7. **`overview.json` is `[lat, lon, …]`**, not `[lon, lat, …]`. GeoJSON is the
   other order; this is the single most common conversion bug.
8. **`continuity.json` is the semantic proof.** Verify it and its exact
   replication state when mirroring a `versionsKnown:true` generation; a file
   inventory hash alone does not prove the cameras came from the reviewed
   baseline and numbered diffs.

---

## 8. Invariants, indexed by test

Every claim in this document that could silently rot has a test holding it. Run
them with `pnpm --filter @fwm/pwa test` and `node --test scripts/`.

### Canonicalisation — `apps/pwa/src/services/crypto/canonicalize.test.ts`

| Invariant                                          | Test                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Output does not depend on key insertion order      | `is independent of the order the keys were written in`                                 |
| Output does not depend on object identity          | `is independent of object identity`                                                    |
| Same payload → same digest, always                 | `hashes the same payload to the same digest every time`                                |
| Bytes are the UTF-8 encoding of the text           | `produces bytes that are the utf-8 encoding of the text`                               |
| **Byte order, not UTF-16 order**                   | `sorts by utf-8 bytes, not by utf-16 code units`                                       |
| ASCII / Latin-1 / astral ordering                  | `orders ascii, latin-1 and astral keys by code point`                                  |
| `NaN` and both infinities rejected                 | `rejects NaN and both infinities`                                                      |
| Integer range enforced                             | `rejects integers past the safe range`                                                 |
| Non-integer range enforced                         | `rejects a non-integer too large for a fixed nine-digit fraction`                      |
| Only JSON-required escapes                         | `escapes only what JSON requires`                                                      |
| `U+007F`, `U+2028`, `U+2029` stay literal          | `leaves U+007F, U+2028, U+2029 and all non-ascii literal`                              |
| NFC before hashing                                 | `normalises to NFC before hashing`                                                     |
| Lone surrogate rejected                            | `rejects a lone surrogate`                                                             |
| NFC key collision rejected                         | `rejects two keys that normalise to the same NFC form`                                 |
| Array order preserved                              | `preserves array order`                                                                |
| `undefined` dropped in objects, rejected in arrays | `drops undefined-valued properties but rejects undefined in an array`                  |
| Cycles rejected, not hung on                       | `rejects a cycle instead of hanging`                                                   |
| A repeated sibling is not a cycle                  | `accepts a sibling repeated in two places, which is not a cycle`                       |
| Depth limit enforced                               | `rejects nesting past the depth limit`                                                 |
| Symbol keys rejected                               | `rejects symbol-keyed properties`                                                      |
| **No `toJSON` hook**                               | `never calls a toJSON hook: the object is rejected as a class instance`                |
| Plain objects only                                 | `accepts object literals and null-prototype objects only`                              |
| Errors name the offending path                     | `names the path of the offending value` / `names the index of an offending array item` |

### Evidence chain — `apps/pwa/src/services/crypto/chain.test.ts`

| Invariant                                     | Test                                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Genesis is the published preimage's hash**  | `is the sha-256 of the published preimage`                                                                                        |
| First record links to genesis                 | `is what the first record links to when no previous hash is supplied` / `rejects a chain whose first record links somewhere else` |
| Payload hashed with the canonical form        | `hashes the payload with the canonical form`                                                                                      |
| **The 124-byte preimage**                     | `builds chain_hash from exactly prev \|\| payload \|\| captured_at \|\| report_id`                                                |
| **Signs raw bytes, not hex**                  | `signs the raw bytes of chain_hash, not its hex text`                                                                             |
| Record and payload are frozen                 | `freezes the record and the payload it signed`                                                                                    |
| Ambiguous-hash inputs refused                 | `rejects inputs that would make a hash ambiguous`                                                                                 |
| `gpsAccuracyM` projects the signed payload    | `reads gpsAccuracyM out of the signed payload, and allows null`                                                                   |
| **No unsigned fallback**                      | `throws CryptoUnavailableError when the probe says unavailable`                                                                   |
| Verifies without the local key                | `still verifies when this install can no longer sign`                                                                             |
| Tampered payload detected                     | `detects a tampered payload and names the record`                                                                                 |
| Deleted record detected                       | `detects a deleted middle record at the record after the hole`                                                                    |
| Reorder detected                              | `detects a reordered record`                                                                                                      |
| Forgery detected                              | `detects a forged signature`                                                                                                      |
| Foreign key detected                          | `detects a record re-signed by another install`                                                                                   |
| Pinning works                                 | `can pin a chain to one install`                                                                                                  |
| Duplicate id rejected                         | `rejects a duplicated record`                                                                                                     |
| Timestamp order enforced                      | `rejects a record captured before the one it follows`                                                                             |
| Unknown schema rejected                       | `rejects a record declaring an unknown schema`                                                                                    |
| Corrections link, never delete                | `supersedes an earlier record with a new linked record`                                                                           |
| Dangling / self correction refused            | `rejects a correction pointing at a record that is not in the chain` / `refuses a record that supersedes itself`                  |
| **Sync advance never touches a signed field** | `returns a new record and leaves the original untouched` / `never changes a signed field`                                         |
| Illegal sync moves refused                    | `refuses an illegal move, including any move out of synced`                                                                       |
| Dead-letter and requeue allowed               | `allows the dead-letter path and a requeue`                                                                                       |

### Export — `apps/pwa/src/features/dead-drop/evidenceExport.test.ts`

| Invariant                               | Test                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Exported records verify untransformed   | `hands verifyChain the parsed records untransformed, and they pass`                                                 |
| **No key directory needed**             | `carries the public key that signed each record, so no key directory is needed`                                     |
| Purged bodies still verify              | `verifies a queue whose oldest bodies were purged after sync`                                                       |
| Runs exist because one array would fail | `would fail as one array - which is why it is not emitted as one`                                                   |
| Holes are stated, not hidden            | `states where the hole is instead of hiding it`                                                                     |
| No record dropped when splitting        | `drops no record on the floor when it splits the queue`                                                             |
| Tamper / reorder / drop caught          | `catches a payload changed after signing` / `catches a re-ordered queue` / `catches a dropped record in the middle` |
| Names its own formats                   | `names its own format, the canonical form and the evidence schema`                                                  |
| Record's own field names                | `exports every field of the signed record, under the record's own names`                                            |
| **Byte-identical between exports**      | `is byte-identical between two exports of the same queue`                                                           |
| Canonical, not pretty, JSON             | `writes canonical JSON, not pretty JSON`                                                                            |
| No extra bookkeeping                    | `carries no transport bookkeeping beyond the record's own syncState`                                                |
| Timestamp says nothing about the driver | `is a UTC stamp and says nothing about the driver`                                                                  |

### Storage — `apps/pwa/src/services/db/`

| Invariant                               | Test                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Migrations unique and ascending         | `migrations.test.ts` › `numbers every migration uniquely and in ascending order`                 |
| Fresh v0 creates every store            | `migrations.test.ts` › `creates every declared store on a fresh v0 database`                     |
| **Upgrade preserves every record**      | `migrations.test.ts` › `v0 -> v1 -> latest preserves every record written at v1`                 |
| A forgotten migration is caught         | `migrations.test.ts` › `assertSchemaComplete names the store a migration forgot`                 |
| Hold is never less than a day           | `publishHold.test.ts` › `never returns less than a day, whatever the roll`                       |
| Broken RNG does not collapse the hold   | `publishHold.test.ts` › `survives a broken random source without collapsing to zero`             |
| The hold actually spreads a drive       | `publishHold.test.ts` › `spreads one drive across different days, which is the entire mechanism` |
| **Hold and backoff cannot be confused** | `publishHold.test.ts` › `DWARFS the retry backoff, so the two cannot be confused for each other` |

### Plate vault — `apps/pwa/src/services/crypto/plate.test.ts`

| Invariant                                 | Test                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| Normalisation folds format, keeps content | `folds case, spacing and punctuation but keeps letters and digits`         |
| **Rejection does not echo the plate**     | `rejects a string with nothing to match on, without echoing it`            |
| **Nothing stored reveals the plate**      | `stores nothing that reveals the plate`                                    |
| Fresh IV per record                       | `draws a fresh IV every time, so the same plate encrypts differently`      |
| Ciphertext bound to its row               | `binds ciphertext to its record id, so a copied ciphertext will not open`  |
| Matching returns ids, never text          | `matches across formatting differences and returns ids, never plate text`  |
| **Vaults are not correlatable**           | `gives a different install a different index for the same plate`           |
| Export demands explicit confirmation      | `cannot happen as a side effect: it demands an explicit confirmation`      |
| Wipe leaves nothing decryptable           | `leaves nothing decryptable, not even a record captured beforehand`        |
| Wipe drops the match index too            | `drops the match index too: the same plate indexes differently afterwards` |
| **Wipe does not end the evidence chain**  | `does not end the evidence chain`                                          |

### OSM — `apps/pwa/src/features/report/`

| Invariant                                   | Test                                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| The ALPR triple is written                  | `osmTags.test.ts` › `writes the ALPR surveillance triple`                                                                              |
| **`direction`, not `camera:direction`**     | `osmTags.test.ts` › `writes 'direction', NOT 'camera:direction'`                                                                       |
| Bearings normalised to whole degrees        | `osmTags.test.ts` › `normalises a bearing into 0-359 whole degrees`                                                                    |
| **Manufacturer, never operator**            | `osmTags.test.ts` › `says MANUFACTURER for Flock, never operator` / `never emits an operator tag under any input`                      |
| No manufacturer the driver did not name     | `osmTags.test.ts` › `does NOT name a manufacturer the driver did not name`                                                             |
| Unsure and trailer write no mount           | `osmTags.test.ts` › `omits the mount when the driver said UNSURE` / `omits the mount for TRAILER too, because the value barely exists` |
| Changeset carries all four tags             | `osmTags.test.ts` › `carries created_by, a comment, the hashtag and the source`                                                        |
| **Editor link carries no tag payload**      | `osmTags.test.ts` › `carries no tag payload at all`                                                                                    |
| No link to null island                      | `osmTags.test.ts` › `refuses a non-finite position instead of linking to null island`                                                  |
| Duplicates found nearest-first              | `osmTags.test.ts` › `finds an existing camera a few metres away, nearest first`                                                        |
| **Never falls back to the observer**        | `osmEligibility.test.ts` › `NEVER falls back to the observer position`                                                                 |
| v1 records permanently ineligible           | `osmEligibility.test.ts` › `refuses a v1 record, whose only coordinate is the driver`                                                  |
| Demo records refused                        | `osmEligibility.test.ts` › `refuses a report captured during the demo drive`                                                           |
| **A missing flag is not a passing flag**    | `osmEligibility.test.ts` › `will not treat a missing flag as a passing flag`                                                           |
| Plate-shaped text never reaches the payload | `reportDraft.test.ts` › `refuses anything plate-shaped` / `keeps a plate out of the payload even if one somehow reaches it`            |
| Report without a position refused           | `reportDraft.test.ts` › `refuses a report with no position`                                                                            |

### Mesh — `apps/pwa/src/features/node/`

| Invariant                                     | Test                                                                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| The banned calls stay banned                  | `mesh.privacy.test.ts` › `reads at least the modules it is supposed to be guarding`                                                       |
| **No channel write without a press**          | `mesh.privacy.test.ts` › `joins nothing on its own - every channel write needs a press`                                                   |
| Only gated text is sent                       | `mesh.privacy.test.ts` › `sends only what the gate has passed`                                                                            |
| **Never broadcasts on a timer**               | `mesh.privacy.test.ts` › `never broadcasts on a timer`                                                                                    |
| Frame round-trips                             | `sighting.test.ts` › `survives the wire`                                                                                                  |
| Signed axes correct                           | `sighting.test.ts` › `keeps a southern, western camera on the right side of both axes`                                                    |
| Unknown bearing / unknown id are real answers | `sighting.test.ts` › `carries "direction unknown" as a real answer` / `carries "not in osm yet" as a real answer`                         |
| **Sixteen bytes**                             | `sighting.test.ts` › `costs sixteen bytes, because airtime is the scarce thing`                                                           |
| Hostile input refused                         | `sighting.test.ts` › `is refused when the magic is wrong` / `wrong length` / `unknown kind` / `at null island` / `latitude off the earth` |
| **No field for the driver**                   | `sighting.test.ts` › `has no field for the driver`                                                                                        |
| No excess precision                           | `sighting.test.ts` › `carries no more precision than the archive has`                                                                     |

### Pipeline — `scripts/`

| Invariant                                          | Test                                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Every published file names OpenStreetMap**       | `attribution.test.mjs` › `<name> names OpenStreetMap in its own body`                                               |
| The notice was not "fixed" by emptying the file    | `attribution.test.mjs` › `the overview still holds the points, so this did not fix the notice by emptying the file` |
| The reader still works                             | `attribution.test.mjs` › `the reader in MapCanvas keeps working, because nothing was renamed`                       |
| ANPR counts as well as ALPR                        | `sync-cameras.test.mjs` › `ANPR counts as well as ALPR`                                                             |
| A delete we hold is a tombstone                    | `sync-cameras.test.mjs` › `a delete of an id we hold is a tombstone, and needs no tags`                             |
| **The invisible retag tombstones**                 | `sync-cameras.test.mjs` › `a modify that drops the ALPR tag tombstones -- the invisible retag`                      |
| Unknown outside ignored; known move-out removed    | `sync-cameras.test.mjs` › `an unknown camera outside the footprint is ignored; a known move is tombstoned`          |
| AK, HI and PR are inside it                        | `sync-cameras.test.mjs` › `Alaska, Hawaii and Puerto Rico are INSIDE the footprint`                                 |
| Replay guard drops known versions                  | `sync-cameras.test.mjs` › `the replay guard drops a version we already have`                                        |
| **The zero that cost 19,000 cameras**              | `fetch-cameras.test.mjs` › `REFUSES THE ZERO THAT COST 19,000 CAMERAS`                                              |
| An empty ocean square is not an error              | `fetch-cameras.test.mjs` › `says nothing about a genuinely empty ocean square`                                      |
| The confirmed-count check catches what ratios miss | `fetch-cameras.test.mjs` › `THE PATROL-CONFIRMED COUNT IS WHAT CATCHES IT`                                          |
| A moved camera must move                           | `fetch-cameras.test.mjs` › `does NOT carry lat/lon -- a camera that moved must move`                                |

---

## 9. Known gaps and divergences

Stated here rather than left for a reader to discover, because a contract document
that hides its own soft spots is not auditable.

1. **`HARDWARE_NAME` disagrees with upstream on 16 of 19 codes** (§5.5). Cosmetic
   — display string only, reaching no packet, key, config write or stored record.
2. **`REGION_NAME` and `PRESET_NAME` render blank for unmapped values** (§5.6),
   contradicting the file's own stated rule that an unmapped value should print its
   number.
3. **`REGION_NAME` is missing seven upstream values** and `PRESET_NAME` four, as of
   protobufs 2.7.26.
4. **`subject_position_source: 'placed'` is never produced.** The member exists so
   a future map does not have to relabel earlier records.
5. **A record can name a photograph the device no longer holds.** `photo` carries
   the digest of bytes in `reportPhotos`, and `clearLocalData()` deletes those
   bytes while retaining the report (§4.9). That is deliberate, and it is stated
   here because a verifier must not read a missing photograph as a broken record:
   nothing is signed over the bytes' _presence_, only over their digest. There is
   no signal in the record distinguishing "erased" from "never attached" other
   than `photo` being non-null.
6. **`satellites` is always `null` on the web.** No browser reports it.
7. **`ownerType` is largely inferred**, not authoritative. `operator` is present on
   only 17.63% of records, so most owner classifications are derived.
8. **There is no report-submission endpoint.** Reports are signed, chained, held
   and exportable; nothing uploads them. `publishableAt` and the backoff schedule
   are built and tested against a transport that does not exist yet.
9. **`fwm-evidence-export/v1` is the only egress path for a signed record**, and it
   is user-initiated.
10. **The sighting frame's port 256 is convention, not allocation.** Another
    application on `PRIVATE_APP` could collide; the magic byte and the strict
    decoder are what make that survivable.
11. **`osmId` is truncated to 32 bits** in the sighting frame. OSM node ids have
    exceeded 2^32; a truncated id can collide.
12. **OSM upload is not implemented**, and per §6.1 must not be until an Organised
    Editing Activity is registered.

---

## Provenance of this document

Written against the working tree and **verified by execution**, not by reading:

- `GENESIS_CHAIN_HASH` recomputed from `GENESIS_PREIMAGE` with `sha256sum`.
- The §1 canonical text, the §2.8 `payloadHash`, `chainHash` and `publicKeyId`, and
  the §2.8 signature, all reproduced and verified by a **clean-room Node
  implementation written from this document's prose alone**, importing nothing from
  `apps/`. The 124-byte preimage length was asserted, not assumed.
- Every published-file sample in §3 is **real output**, read from
  `apps/pwa/public/cameras/`, truncated but not edited.
- The §5.5 enum tables were produced by diffing `mesh.ts` against the generated
  enums in `@jsr/meshtastic__protobufs@2.7.26`, and the `LoRaConfig` field count by
  counting the generated message.
- Every test name in §8 was read from the test files, not recalled.

Anything in this document that disagrees with the code is a **bug in this
document**. Report it the same way you would report a bug in the code — see
[SECURITY.md](./SECURITY.md).
