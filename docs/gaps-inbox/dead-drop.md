# DEAD DROP - gaps

> **STALENESS WARNING, added 2026-08-30.** This screen exists and is unreachable from the
> interface in either design.
>
> `DeadDropScreen` is registered only in the v0 registry
> (`apps/pwa/src/main.tsx:124`) and falls through under v1. But there is no
> `openScreen('dead-drop')` anywhere in `apps/pwa/src` - no dock key in either
> design, and no tile on MORE (`features/more/MoreScreen.tsx:185-263`). It is
> reachable only by typing `?screen=dead-drop`.
>
> The B2 panel entries below, and the crypto chain they describe
> (`services/crypto/{chain,keys,canonicalize}.ts`,
> `services/db/repositories/reportChain.ts`), are all still accurate about the
> code. They are not accurate about what a driver can open.
>
> Read instead: `docs/STALENESS.md`.

Panel: `Flockys Screens II.dc.html`, `B2 · DEAD DROP - QUEUE + EVIDENCE CHAIN`.
Backing engine: `services/crypto/{chain,keys,canonicalize}.ts`,
`services/db/repositories/reportChain.ts`, `services/db/repositories/pendingReports.ts`.

Everything below is something the design does not answer, contradicts, or that
the privacy invariants forbid rendering the way the panel draws it.

---

## <a id="place-names-cannot-be-produced-without-a-geocoder"></a>The row labels

`DROP 02 · Vine St` / `DROP 01 · I-71 ramp` / `DROP 00 · Reading Rd`

**Question.** Where does the street name come from?

**Finding.** Nowhere on this device. The signed payload
(`features/report/reportDraft.ts#reportPayload`) carries
`position: { lat, lon }`, `gps_accuracy_m`, `satellites`, `facing_deg`,
`facing_source`, `mount`, `make_model`, `camera_id`, `photo`. There is no
place name in it, no place name on `CameraRecord`, and no geocoder anywhere in
the repository. `stores/sync.ts#QueuedDrop.label` reserves the field and
documents it as coming "from the report's own camera record" - nothing
populates it, and the camera record has no such field either.

Producing `Vine St` from `39.0997 N 84.5786 W` means sending the driver's exact
filing position to a reverse-geocoding service. That is the single most
sensitive value in the product and the one thing the report path is built to
never transmit (`reportQueue.ts`: "There is no `fetch` in this file and no
upload path anywhere behind it").

**What I did.** The row title is `DROP 02`, with `· <camera id>` appended only
when the report confirms a camera the record already names (`payload.camera_id`,
e.g. `FWM-0442` - a public infrastructure id, not a position). A report that
names no camera renders the drop number alone. No fake street name is
substituted, and nothing on this screen reverse-geocodes.

**To close it.** Either add a `label` to the signed payload that the driver
types themselves at filing time (REPORT's file to change, not this screen's),
or ship an on-device offline street index. Both are out of scope here.

---

## <a id="heading-row-has-no-speed"></a>`HEADING  223° · 47 MPH`

**Question.** Which of the record's fields are these two numbers?

**Finding.** `223` is in the record: it is `payload.facing_deg`, and the REPORT
sheet seeds that from the vehicle's compass heading (`facing_source: "compass"`)
when the driver does not set it by hand. `47 MPH` is in no signed field. The
payload schema `fwm-report/v1` has no speed, and the chain covers only the
payload - so a speed rendered here would have to come from a live store, i.e. a
number that was never signed, displayed inside a card whose entire claim is
"this is what was signed".

**What I did.** The HEADING row renders `223°` and nothing else. When
`facing_deg` is null it renders ` - `.

**To close it.** Add `speed_mph` to `fwm-report/v1` and stamp it at filing time.
That is a change to `features/report/reportDraft.ts` and to the payload schema,
which needs a coordinated schema change.

---

## <a id="photo-row-has-nothing-to-count"></a>`PHOTO  1 · 2.1 MB`

> **SUPERSEDED IN PART, 2026-08-31.** The count half of this finding is fixed;
> the size half is not, and is now unfixable by design rather than by omission.
> The original finding follows, then what changed.

**Finding.** `reportDraft.ts#reportPayload` sets `photo: null`, always, and its
own comment says so: "`photo` is `null`, always, in this build." There is no
attachment store, no blob in `pendingReports`, and no byte count to render.

**What I did.** The card's PHOTO row renders `NONE`. The list meta line renders
`no photo` - the design's own variant, drawn on DROP 01. No size is invented.

**What changed.** A driver can attach one photograph to a report, and the
payload's `photo` field now carries its SHA-256 rather than `null`.
`format.ts#hasPhoto()` already read the payload and returned true for any
non-null value, so `dropPhoto()` began returning `1` and `photoWord()` began
returning `photo` **with no code change** - the row and the meta line were
written against the payload rather than against the belief that the field was
always empty, and that is why they came out right on their own.

**The `2.1 MB` half stays unrenderable, and now for a stated reason.** The byte
count lives on the `reportPhotos` row, and that store deliberately has no
`all()` and no index: nothing in this app may enumerate photographs. Rendering a
size on this panel would mean giving the dead drop a reader over the photograph
store, which is a larger concession than a missing number is worth. The row says
`1`, not `1 · 2.1 MB`.

**The meta line is two terms on an accepted row, three on a held one.** That is
what the panel draws: `13:58 · photo · signed` and `13:12 · no photo · signed`,
but `yesterday · accepted`. The middle term says what this device is still
holding to hand over, so `metaTerms()` draws it only when there is something to
say: a drop the backend already accepted has nothing left to hand over, and a
drop whose body was purged has no photo field to read - `no photo` there would
be a claim about evidence this device no longer holds.

---

## <a id="signed-row-is-a-verification-not-a-label"></a>`SIGNED  DEVICE KEY OK`

**Question.** Is `DEVICE KEY OK` a static label or a result?

**What I did.** Treated it as a result, because a static one would be the exact
lie the chain exists to prevent. The screen runs `verifyChain()` over the signed
bodies it loaded - order, linkage, payload hash, chain hash and every ECDSA
signature - and renders:

| verdict | string | hue |
|---|---|---|
| verified | `DEVICE KEY OK` | `--fwm-alert-clear` (as drawn) |
| first break | `CHAIN BROKEN` | `--fwm-alert-in-range` |
| after a break, or when this platform has no WebCrypto to check with | `UNVERIFIED` | `--fwm-text-muted` |
| body purged after sync | `BODY NOT HELD` | `--fwm-text-muted` |

Four verdicts, and `VERDICT_LABELS` in `deadDropModel.ts` has exactly these
four. There is deliberately no `CHECKING` state: the card is not drawn at all
until the queue has been read, so a verdict is never mid-flight while something
is on screen to carry it. (An earlier draft of this file listed a fifth,
`CHECKING`, that the code never rendered. It is gone.)

Only the first row is drawn by the design. The other three are authored, and are
the honest readings of states the engine can genuinely produce
(`ChainFailureCode` has thirteen members; `pendingReports.purgeSynced()` deletes
acknowledged bodies while `reportChain` keeps their rows forever).

A row-level break outranks everything: `reportChain.verifyLinkage()` walks every
row from genesis, including rows whose body was purged, so it can see a hole the
body verification cannot even reach. When it reports one, the row at the break
reads `CHAIN BROKEN` and everything after it reads `UNVERIFIED`, whatever the
signatures say.

A ROW/BODY DISAGREEMENT RANKS WITH IT. The card prints CAPTURED and both hashes
off the queue row and POSITION / HEADING / PHOTO out of the signed body, so the
two halves are compared field for field on everything the signature covers
(`ROW_BODY_FIELDS` in `deadDropQueue.ts`: `reportId`, `capturedAt`,
`payloadHash`, `previousChainHash`, `chainHash`, `signature`, `publicKeyId`).
Without that comparison a body rewritten coherently - new payload, recomputed
hashes, re-signed under an attacker's own key, whose `publicKeyId` matches its
own SPKI - passes `verifyChain` and prints the attacker's coordinates beside the
row's untouched sha256 under a green `DEVICE KEY OK`. `syncState` is excluded
from the comparison on purpose: the row's is a `QueueSyncState` (`pending`) and
the record's is a `SyncState` (`held`), they are two vocabularies for transport
bookkeeping, and neither is hashed or signed.

---

## <a id="a-purge-can-leave-a-hole-in-the-middle"></a>A purge can leave a hole in the MIDDLE of the queue

**Finding.** `pendingReports.purgeSynced()` deletes EVERY body whose sync state
is `synced`, not only the oldest ones, while `reportChain` keeps every row
forever. The moment one drop is acknowledged while an older one is still
`pending`, `rejected` or `dead_letter` - the case `reportChain.ts` says never
goes away - the surviving bodies have a hole in the middle, and the record after
the hole legitimately links to a body that is gone.

Verified as ONE array, that queue reports `broken-link` at the record after the
hole and the screen prints `CHAIN BROKEN`, in the in-range hue, over evidence
that is perfectly intact. The same array handed to `buildEvidenceExport()`
produces a document that fails `verifyChain` for the same wrong reason.

**What I did.** The held bodies are split into RUNS - a run is a maximal stretch
of drops that are adjacent in the row order and still hold their body - and each
run is verified against its OWN `startingChainHash`, which is its first record's
own `previousChainHash`. The split is by presence alone; nothing inspects a hash
to decide where a run restarts, so a run that fails to verify fails for a real
reason.

The export states the same structure. `runs` names each stretch by
`first_index`, `count`, `starting_chain_hash` and `head_chain_hash` over the flat
`records` array, so an independent verifier does one `verifyChain` per run. A
queue with no holes - the ordinary case, and the purged-PREFIX case - has exactly
one run whose `starting_chain_hash` is the document's, and the single-call
verification in the `evidenceExport.ts` header still works unchanged.

**To close it.** Nothing here is open. The one thing runs cannot do is PROVE the
order across a hole; see the next entry.

---

## <a id="an-export-carries-bodies-not-rows"></a>An export carries bodies, not queue rows

**Finding.** `EXPORT JSON` emits `EvidenceRecord`s - the signed bodies. The
`reportChain` rows are not in it. Two consequences a reader of an export should
know about:

1. A purged drop leaves a gap that the export can DESCRIBE (`runs`) but cannot
   BRIDGE. Run *n+1* states the hash it continues from; nothing in the document
   proves that hash was ever the head of run *n*. The rows hold exactly the
   link that would prove it.
2. The row/body comparison this screen performs is a device-local check. An
   export made on a device whose bodies disagree with their rows carries the
   bodies, and a verifier reading only the file cannot see the disagreement -
   the screen shows `CHAIN BROKEN`, the file does not.

**What I did.** Documented both. Neither is a reason to weaken what IS emitted,
and neither is a reason to drop evidence from an export.

**To close it.** Add the signed projection of each `ReportChainRecord`
(`reportId`, `capturedAt`, `payloadHash`, `previousChainHash`, `chainHash`,
`signature`, `publicKeyId` - and none of the transport bookkeeping) as a second
top-level array, so a verifier can walk the full order from genesis and check
every surviving body against its row. That is a format decision worth making
once, with the backend that will consume it.

---

## <a id="the-signing-key-is-not-pinned"></a>The chain is not pinned to this install's key

**Finding.** `verifyChain` accepts `expectedPublicKeyId`, and DEAD DROP does not
pass it. A record signed by any key whose SPKI hashes to its own declared
`publicKeyId` verifies.

**Why.** Pinning would mean this screen can only verify drops THIS install
signed. A queue restored from an export, a queue read after site data was
cleared, or somebody else's drops handed over for checking would all report
`untrusted-public-key` - `CHAIN BROKEN` - for evidence that is fine. The whole
point of carrying `publicKeySpki` on every record is that a chain stays checkable
without a key directory and after the signing key is gone.

**What that leaves open.** An attacker with arbitrary write access to IndexedDB
who rewrites BOTH stores coherently - the body and its queue row, re-signed
under their own key - defeats every check on this screen. The row/body
comparison catches a rewrite of either half alone; nothing on-device catches a
rewrite of both, because at that point no residue of the original signature is
left to compare against. Pinning to the install's own non-extractable signing
key is the only thing that would, and it costs the three legitimate cases above.

**To close it.** A verdict that distinguishes "signed by this device" from
"signed by a device, and here is which one" - which is a design question about a
row the panel does not draw, not a code change this screen can make alone.

---

## <a id="a-device-with-no-webcrypto-says-so"></a>A device with no WebCrypto says so

**Finding.** `verifyChain` throws `CryptoUnavailableError` when there is no
`crypto.subtle`. The queue itself still reads back perfectly well - the rows,
the hashes and the bodies are all on disk - so this is not a load failure and
must not blank the screen. But every verdict then reads `UNVERIFIED`, and
`UNVERIFIED` with no explanation reads like an accusation against the driver's
own evidence.

**What I did.** `snapshot.verifiable` carries the outage, and the detail card
renders `THIS DEVICE CANNOT CHECK A SIGNATURE` under the hash block, in
`--fwm-alert-approaching` - the caution hue, not the in-range hue that
`CHAIN BROKEN` owns. The panel draws no such line.

`describeLoadFailure()` deliberately has no `CryptoUnavailableError` branch: it
would be unreachable (the error is caught where the verification runs), and a
missing signature check is not a reason to tell the driver their queue could not
be read.

---

## <a id="queueddrop-label-carries-a-camera-id-not-a-place"></a>`QueuedDrop.label` carries a camera id, not a place

**Finding.** `stores/sync.ts` documents that field as
`"Vine St", "I-71 ramp" - a place, from the report's own camera record`. Nothing
on this device can produce a place name (see the row-labels entry above), and
DEAD DROP is the only writer of the field: `publishedDrops()` writes
`payload.camera_id`, e.g. `FWM-0442`.

So the shared contract says one thing and its only writer does another. Any
consumer that later renders `label` as a place will print a camera id.

**What I did.** Nothing to the shared file - `stores/sync.ts` is outside this
feature and needs a coordinated contract change. The divergence is written down here and
in `DeadDropScreen.tsx` at the point of the write, and the screen's own test
locks the value to a camera id so the meaning cannot drift further unnoticed.

**To close it.** In `stores/sync.ts`, either rename the field to `cameraId` and
restate its contract as "the public camera id the report names, or null", or keep
`label` and restate it as "whatever the filing screen can honestly name this
drop by - today a camera id; never a reverse-geocoded place". One line of
comment plus, for the rename, its consumers.

---

## <a id="only-two-queue-states-are-drawn"></a>The panel draws `HELD` and `SYNCED` only

**Finding.** `QueueSyncState` has five members: `pending`, `syncing`, `synced`,
`rejected`, `dead_letter`. The panel draws two.

**What I did.** Kept the two drawn strings and hues exactly
(`HELD`/`--fwm-alert-approaching`, `SYNCED`/`--fwm-alert-clear`) and authored
three more rather than hiding rows: `SYNCING`/`--fwm-accent-scan`,
`REFUSED`/`--fwm-alert-in-range` (rejected), `STUCK`/`--fwm-alert-in-range`
(dead letter). Hiding them was not an option -
`reportChain.ts` is explicit that "DEAD LETTER IS NOT DELETION… still signed,
still exportable, still part of the chain".

The header count stays what the design shows: `3 HELD` counts held drops
(pending + syncing), which is exactly the three the panel labels HELD - the
featured DROP 03 plus DROP 02 and DROP 01. Synced, refused and stuck drops are
not in it.

---

## <a id="export-json-has-no-sink-on-this-device"></a>`EXPORT JSON` - where does the file go?

**Question.** The panel draws the button and names no destination.

**Finding.** There is no sanctioned destination in this repository.

- `services/adapters/clipboard.ts` reserves the kind `export-json`, but its
  privacy header is unambiguous: "A licence plate, a watchlist entry or **a
  coordinate** must never be written to it." An evidence export is a list of
  signed payloads and every one of them contains `position: { lat, lon }`. The
  clipboard is therefore the wrong sink, reserved kind or not.
- `services/adapters/share.ts` has no evidence-export `SharePayloadKind`, and
  adding one means editing a shared file.
- There is no file-download adapter and no `createObjectURL` anywhere in
  `apps/pwa/src`.

**What I did.** The screen *builds* the export - that part is entirely this
screen's job and is fully implemented and tested - and hands it to an injected
`onExport` handler. With no handler wired, the button renders exactly as the
design draws it and is disabled, per the pattern
`features/radar/components/RadarAction.tsx` established for `RETRY SYNC`.
Nothing is uploaded, nothing is copied, nothing is written to a URL.

**The export format.** `buildEvidenceExport()` emits
`fwm-evidence-export/v1`: an envelope of `schema`, `canonical_form`,
`evidence_schema`, `exported_at`, `genesis_chain_hash`, `starting_chain_hash`,
`head_chain_hash`, `count`, `run_count`, `runs`, and `records`. `records` holds each
`EvidenceRecord` **verbatim, field for field, under its own field names**, so a
verifier can `JSON.parse(text).records` and pass the array straight to
`verifyChain()` with no transformation. The text itself is produced by
`canonicalize()` (`fwm-canonical-json/v1`), so two exports of the same queue are
byte-identical and each embedded payload re-canonicalises to the exact bytes its
`payloadHash` covers. `dead-drop/evidenceExport.test.ts` proves the round trip
by re-verifying a parsed export.

`starting_chain_hash` is carried because `pendingReports.purgeSynced()` can
remove acknowledged bodies from the front of the queue; without it an export of
a partial queue would look like a chain with a bad genesis. `runs` is carried
because that same purge can remove them from the MIDDLE - see
[A purge can leave a hole in the MIDDLE of the queue](#a-purge-can-leave-a-hole-in-the-middle)
and [An export carries bodies, not queue rows](#an-export-carries-bodies-not-rows).

**To close it.** A file-save adapter (or a share kind for signed evidence),
reviewed for the fact that the bytes contain the driver's coordinates.

---

## <a id="sync-now-is-not-this-screens-to-perform"></a>`SYNC NOW`

**Finding.** There is no sync service in `apps/pwa/src/services` - the queue,
its backoff and its dead-letter policy are in `reportChain.ts`, but nothing
drains it, and this screen may not add a network path.

**What I did.** Same pattern: injected `onSyncNow`, disabled when unwired or
when nothing is held. Pressing it does not mark anything as syncing - moving a
row to `syncing` with no request in flight would be a state the queue could
never leave.

---

## <a id="every-timestamp-is-utc"></a>Row times are UTC, like the featured card

**Finding.** The featured card is explicit: `14:22:08.412 UTC`. The row times
(`13:58`, `13:12`) carry no zone, and `DROP 00` says `yesterday`.

**What I did.** Every time on this screen is UTC, read straight off the signed
`capturedAt` with no `Date` parsing and no local-zone conversion. Same UTC day
as now renders `HH:MM`; the previous UTC day renders `yesterday`; anything older
renders the ISO date `YYYY-MM-DD`, which the design never draws. Mixing a local
row time with a UTC card time would put two different clocks on one panel, and
signed evidence has exactly one clock.

---

## <a id="the-featured-card-is-the-newest-drop"></a>Which drop gets the big card?

**Finding.** The panel features `DROP 03`, which is both the newest drop and a
held one, so the rule is ambiguous.

**What I did.** Newest drop, whatever its state - the card is a detail view of
the top of the queue, and a card that skipped a synced newest drop would leave
the driver's most recent filing undisplayable. The list below shows every
remaining drop, newest first, exactly as drawn.

---

## <a id="no-empty-or-loading-state-is-drawn"></a>Empty and loading

**Finding.** The panel draws a queue with four drops in it and nothing else.

**What I did** (see `DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn`):
the header status slot renders `READING` while the database is opening and
`UNAVAILABLE` when there is no IndexedDB; the featured card is not drawn at all
when there is nothing to feature; the list renders `NOTHING QUEUED`. The signing
statement card stays in every state, because it is a statement of policy that is
true whether or not anything is queued. No placeholder drop is ever rendered.

---

## <a id="type-and-spacing-steps-the-token-set-misses"></a>Type and spacing steps the token set misses

Rendered by the panel, absent from `tokens.css`: the 13px action-key label on
`SYNC NOW` / `EXPORT JSON` (nearest: `--fwm-text-micro` 11px - a ~15% shrink on
the two largest touch targets on the screen; the keys themselves stay 48px, so
the touch target is unaffected), body copy at 16px and 15px
(nearest: `--fwm-text-subtitle` 17px / `--fwm-text-body` 15px), mono at 11px and
10px (nearest: `--fwm-text-micro` 11px - 10px is below the stated floor, see
`DESIGN-GAPS.md#micro-type-below-stated-floor`), the 14px body stack and the
10px/12px hash-block padding (nearest: `--fwm-space-3` 12px / `--fwm-space-4`
16px), the 60px list row and 48px action key (`--fwm-touch-min` 44px clears the
touch floor; `--fwm-space-12` is 48px), and the 1px hairline
(`calc(var(--fwm-space-1) / 4)`, the derived local `log.css` already uses -
see `docs/gaps-inbox/design-value-enforcement.md#no-border-width-token`).

No token was invented. Every one of these takes the nearest token or a `calc()`
over one.

---

## <a id="the-callout-tint"></a>The callout tint `rgba(255,192,46,.06)`

**Finding.** The signing-statement card is filled with the approaching hue at 6%
opacity. `tokens.css` has no tint tokens and no opacity scale.

**What I did.** `color-mix()` is not available to me either - the checker's
`color-fn` rule bans it by name. The card takes `--fwm-surface-1` behind its
`--fwm-alert-approaching` border, which is the same treatment every other card
on the panel gets and the only one the token set can express. Same for the
`rgba(255,45,94,.07)` and `rgba(61,224,138,.06)` tints on the sibling panels, so
whatever is decided should be decided once, for all of them.
