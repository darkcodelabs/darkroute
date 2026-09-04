# What this protects you from, and what it does not

Most of this document is about what DarkRoute does **not** do. That is
deliberate. An app in this category that lists only its strengths is asking to
be trusted in situations where it will get someone hurt, and the failure mode of
a privacy tool is not "it didn't work" — it is "somebody relied on it".

Read it before you rely on this app for anything that matters.

---

## Contents

- [0. The one-paragraph version](#0-the-one-paragraph-version)
- [1. What it actually does](#1-what-it-actually-does)
- [2. What it does not do](#2-what-it-does-not-do)
- [3. Adversaries, ranked, with an honest verdict for each](#3-adversaries-ranked-with-an-honest-verdict-for-each)
- [4. Assets, and what a compromise of each surrenders](#4-assets-and-what-a-compromise-of-each-surrenders)
- [5. Residual risks you accept by using it](#5-residual-risks-you-accept-by-using-it)
- [6. The mesh, in detail, because it is the sharpest edge](#6-the-mesh-in-detail-because-it-is-the-sharpest-edge)
- [7. Contributing to OpenStreetMap: public, attributed, permanent](#7-contributing-to-openstreetmap-public-attributed-permanent)
- [8. Assumptions this model rests on](#8-assumptions-this-model-rests-on)
- [9. How to check any of this](#9-how-to-check-any-of-this)
- [10. What would change this document](#10-what-would-change-this-document)

---

## 0. The one-paragraph version

DarkRoute protects **one specific thing**: it lets you find out where ALPR
cameras are without creating a record, anywhere but on your own phone, of having
asked. It does that by not having a backend to send anything to. It does **not**
hide your car from a camera, it does **not** make you anonymous on the road or
on the network, it does **not** survive a compromised or unlocked phone, and it
does **not** help against an adversary who has decided to target you
specifically. If someone is already interested in you as an individual, this app
is not the tool that changes your position, and treating it as one is the most
dangerous thing you could do with it.

---

## 1. What it actually does

Four things, each of which is an architectural property rather than a promise,
which means each can be checked by a stranger with a copy of the repository and
a browser's network tab.

### 1.1 It leaves no record of your interest in cameras

There is no account, no email address, no login, no session token, no device
registration and no server-side profile. The deployed server surface is one
public camera-tile Function and two Access-gated admin Functions; none accepts
an end-user identity or activity. the operator tooling contains operator curation tools
and a tested but undeployed report handler. No file under `functions/` exposes
that handler, and the PWA has no caller for it. `packages/api-client` exports
one placeholder boolean and is imported by nothing.

Consequence: there is no dataset of "who looked up cameras where" for anyone to
breach, buy, subpoena or leak. That is not a policy that a future maintainer
could quietly reverse in a settings toggle; reversing it requires adding a server
and a `fetch` that do not exist, in a public diff.

### 1.2 Your position has no way off the device

The driver's coordinates feed the alert engine and, if you deliberately file
one, a report. Both stay in IndexedDB on the phone.

The alert history — the record of what you drove past — stores distance,
heading, speed, camera id and state, and **never a latitude**
(`services/db/schema.ts:213`). A trip's exposure is a count and a distance, not
a track.

Camera data is fetched **by tile address**, and the tile address is computed on
your device from your fix (`packages/core/src/tiles.ts`). A z11 tile is roughly
**15 km across**. A tile request therefore discloses "somebody wanted this
square", never a coordinate. See §5.4 for the honest limits of that.

### 1.3 Plates never exist in the clear, and never in a URL

If you put a plate in the watchlist, it is encrypted at rest with AES-GCM-256
under a key generated `extractable: false`, with a fresh 12-byte IV per record
and AAD binding the ciphertext to its record id. Matching uses a **keyed** blind
index (HMAC-SHA-256, truncated), so equality works without decrypting and the
index is useless off your device — an unkeyed hash of a plate's short alphabet
would be brute-forced in seconds.

There is no passphrase, no account, no recovery and no cloud backup for the
vault, because each of those would invent somewhere for the plate to travel to.
Clearing site data destroys it. That is documented behaviour, not a bug.

### 1.4 It keeps working with the radio off

The app is offline-first. Cameras, basemap, gazetteer and documents are cached
so that a cold start with no network still warns you. This is a privacy property
as much as a reliability one: an app that must call home to work is an app that
produces a connection record every time you drive.

---

## 2. What it does not do

Stated flatly, in the order people get them wrong.

### 2.1 It does not hide you from the cameras

**A camera you drive past reads your plate.** Nothing in this app changes that.
The app tells you where cameras are so you can decide; it has no effect on what
a camera does when you are in front of it.

There is no cloaking, no jamming, no spoofing and no interference of any kind in
this project, and there never will be. See
[`LEGAL.md` §4](./LEGAL.md).

### 2.2 It does not tell you to cover your plate, and covering your plate is a different legal question

Choosing a route is lawful. Obscuring, covering, flipping or altering a licence
plate is a separate act that is unlawful in many jurisdictions and is actively
enforced. This project does not advise it, does not describe how to do it, and
treats the conflation of the two as a safety problem rather than a style
preference. See [`LEGAL.md`](./LEGAL.md).

### 2.3 It does not defeat a targeted adversary

If a specific person or agency has decided to find out where you go, they have
options this app does not touch: a warrant for your phone, your carrier's
location data, your car's telematics, a toll transponder, a physical tail, a
device on your vehicle, or simply the ALPR network itself, which is dense enough
in many places that avoiding all of it is not possible. Avoiding *some* cameras
against a *targeted* adversary can even be counterproductive, because a route
that is unusual is a route that is notable.

**This app is built against bulk, indiscriminate collection. It is not a
counter-surveillance tool against a determined individual adversary, and it does
not become one by being used carefully.**

### 2.4 It does not protect you if your phone is compromised

Everything this app protects lives on your device. Malware with sufficient
privilege, a forensic extraction tool, a device backup you enabled, a corporate
MDM profile, or another person holding your unlocked phone all read the
IndexedDB stores directly. The plate vault's key is non-exportable *to the web
page*; that is a browser-level protection against another origin and against
casual export, not against an attacker who owns the operating system.

Threats that begin with "the adversary already controls the device" are **out of
scope**, and no application-level design defeats them.

### 2.5 It does not make you anonymous on the network

Your ISP, your mobile carrier and Cloudflare see that you connected. During the
private beta, the site sits behind Cloudflare Access, which means Cloudflare
also sees **the identity you authenticated with** — the app requests
`GET /api/admin/me` on every load and that call carries your Access identity to
the edge (the administrative identity Function (not distributed), `features/admin/useAdmin.ts:66`).

Nothing in this app is a VPN or a proxy, and installing it changes nothing about
what your network operator can observe. If network-level unlinkability is what
you need, that is a different tool, used in addition.

### 2.6 It does not hide that you have it

The app is installable, visible on the home screen, and appears in the browser's
storage and cache lists. Its requests go to a known origin. If the specific risk
you face is somebody looking at your phone and objecting to the app's presence —
a partner, an employer, a border officer, an officer at a traffic stop — **this
app does not address that risk and does not try to.**

### 2.7 It does not give you legal cover

Knowing where a camera is is not a defence to anything, and this document is not
legal advice. What the project believes about the legality of publishing camera
locations, including the parts that are genuinely unsettled, is in
[`LEGAL.md`](./LEGAL.md) with sources.

### 2.8 It does not guarantee the map is right or complete

Camera data comes from OpenStreetMap contributors. It is as good as the last
person who mapped that street. **Cameras appear that are not there, and — the
dangerous direction — cameras are there that do not appear.** A silent map is
not evidence of a clear road. Treat the absence of a marker as "unknown", never
as "none". Provenance and freshness are documented in
[`DATA-PROVENANCE.md`](./DATA-PROVENANCE.md).

---

## 3. Adversaries, ranked, with an honest verdict for each

Ranked by how likely each is to actually matter to a real user of this app,
which is not the same as ranked by capability.

| # | Adversary | What they can do | Does this app help? |
|---|---|---|---|
| 1 | **Bulk ALPR collection itself** — the vendor's network and the agencies querying it | Read every plate that passes a camera, retain it, share it across jurisdictions, and query it later | **Partly.** It tells you where the cameras are so route choice is informed. It does nothing about the cameras you still pass. |
| 2 | **An app or service that would profile your interest in surveillance** — analytics, ad SDKs, a hosted backend, a data broker | Correlate your queries, your routes and your identity, then sell or surrender the result | **Yes, structurally.** There is no end-user account or activity-collection endpoint, and no analytics, telemetry or crash reporter. The camera and admin Functions do not accept this data; the future report handler is not deployed or called. |
| 3 | **A civil subpoena or a records request aimed at this project** | Compel production of user records | **Yes, structurally.** There are no user records to produce. You cannot be compelled to hand over what was never stored. Any such demand is published under [`TRANSPARENCY.md`](./TRANSPARENCY.md). |
| 4 | **Someone with physical access to your unlocked phone** | Read the watchlist, the reports, the alert history, the map | **No.** §2.4. Use the device's own lock, and the app's one-press data removal. |
| 5 | **Your network operator, or Cloudflare** | See that you connected, from what IP, when; during the beta, see your Access identity | **No.** §2.5. Tile addresses limit *what* they learn to ~15 km squares; they do not hide *that* you asked. |
| 6 | **A passive radio listener near you, if you use the mesh** | Hear that a transmission happened, from which node, when; read any broadcast message in full | **No — and this is the app's sharpest edge.** §6. |
| 7 | **A targeted investigation into you specifically** | Warrant, carrier data, telematics, physical surveillance | **No.** §2.3. |
| 8 | **A hostile contributor to OpenStreetMap** | Add cameras that do not exist, or delete ones that do | **Partly, and upstream.** OSM has its own review, revert and Data Working Group processes. This project reads the corpus and does not fork it. A poisoned map degrades the warnings; it does not expose the user. |
| 9 | **A supply-chain attack on this app's dependencies** | Inject code into the bundle that adds an outbound request | **Partly.** Lockfile committed, no third-party analytics or ad SDKs to hide inside, and the documented outbound surface in [`API.md`](./API.md) is short enough to audit. Reproducible builds are the real answer and are listed as a gap in [`AUDITING.md`](./AUDITING.md). |
| 10 | **Us — the maintainer, now or after a change of hands** | Ship an update that quietly starts collecting | **Partly, and this is why the documentation exists.** The defence is that it would take a public diff adding a `fetch` where there is none, against a documented surface, in a repository where the app displays the commit it was built from. That is a real defence and it is not a perfect one. |

---

## 4. Assets, and what a compromise of each surrenders

Modelled on SecureDrop's practice of stating, per component, what a compromise
**surrenders** versus what it **achieves** — because "an attacker gets access to
X" is not a finding until somebody says what X is worth.

| Asset | Where it lives | A compromise surrenders | It does **not** achieve |
|---|---|---|---|
| Live position fix | Memory; the position store | Where you are right now, if the attacker is already on the device | Any history — the fix is not written to a log |
| Alert history | IndexedDB | Which cameras you passed, when, how fast, in what direction | Your coordinates: **there is no latitude in the table** (`services/db/schema.ts:213`) |
| Filed reports | IndexedDB, signed and hash-chained | Both the camera's position and **your observer position** at the moment you filed — reports carry both, deliberately and separately | Anything you did not choose to file. The shipped PWA has no upload caller; the queue's `due`/`markSynced`/`markFailed` methods have **zero production callers** |
| Plate watchlist | IndexedDB, AES-GCM-256, non-exportable key | Nothing without the key. With OS-level compromise, the plates | Anything server-side — no PWA transport accepts or sends a plate |
| Mesh threads | Memory only, capped at 100 entries, gone on reload | Nothing after a reload | A durable record of who you talk to — that is why it is memory-only |
| Tile request log (at the edge) | Cloudflare | Which ~15 km squares an IP asked for, and when | A route or a coordinate — unless the pattern is fine-grained enough to reconstruct one, which is a **bug** and is in scope under [`SECURITY.md`](./SECURITY.md) |
| Access identity (beta only) | Cloudflare Access | That a named person uses the app | Where they went |
| The published camera archive | R2, and OSM upstream | Nothing about any user. It is public data by construction | Any information about *readers*. Anything that changes that is a vulnerability |

---

## 5. Residual risks you accept by using it

These are real, they are known, and they are written here rather than fixed
because in each case the fix is a product decision rather than a patch.

One previously reported disclosure is not present in the current build. The
[`navigateTo` adapter](../../apps/pwa/src/services/adapters/navigateTo.ts#L115)
constructs only a local `geo:` URI on supported non-iOS platforms and returns
`unavailable` before invoking its opener on iOS. The shipped v1
[Drive](../../apps/pwa/src/features/drive/DriveScreen.tsx#L1023) and
[Intel](../../apps/pwa/src/features/intel/IntelScreen.tsx#L386) screens also omit
their map controls there. There is no Google HTTPS fallback.

### 5.1 Plate export is an explicit cleartext escape hatch

The shipped UI has no plate-export control. The vault nevertheless exposes
[`exportPlatesWithWarning`](../../apps/pwa/src/services/crypto/plate.ts#L313): a
caller that explicitly passes `{ confirmed: true }` decrypts **every** stored
plate and returns the cleartext entries with a warning. Missing or false
confirmation is rejected. Once that result is saved or shared, the vault's
encryption no longer protects it. The confirmation affordance and final warning
copy remain unresolved in the
[plate-export gap record](../gaps-inbox/crypto-evidence.md#plate-export-warning-copy-unspecified);
no shipped screen currently reaches the API.

### 5.2 Dead-drop rows deliberately do not reverse-geocode

Filed reports still contain the observer position locally, as the asset table
above states. The dead-drop list deliberately never sends that filing position
to a reverse geocoder. Its
[`dropTitle`](../../apps/pwa/src/features/dead-drop/deadDropModel.ts#L209) uses
only the drop number plus an optional public camera ID; a new-camera report has
no suffix at all. This avoids transmitting the most sensitive report coordinate
at the cost of a human-readable street label. The decision and alternatives are
recorded in the
[dead-drop gap record](../gaps-inbox/dead-drop.md#place-names-cannot-be-produced-without-a-geocoder).

### 5.3 Voice input on Chromium sends audio to Google

The Web Speech API on Chromium streams audio to a Google service. That is the
platform's behaviour, not this app's choice. The app surfaces it rather than
hiding it — `sendsAudioOffDevice()` exists specifically to say so, and the ASK
screen warns before you use it. Typing does not do this.

### 5.4 The map and speed archives are fetched cross-origin and ungated

PMTiles range requests go to `tiles.darkroute.ai` — a host this project
operates, but a **different origin**, and unauthenticated. Basemap requests
disclose **the viewport you are looking at**. The z14 speed lookup is derived
directly from the current position and identifies roughly a **1.9 km square** at
a typical US latitude. Both are finer than the ~15 km camera-tile granularity.
The host and Cloudflare edge receive the requested ranges, IP and timestamp;
this project does not claim that edge logging is disabled.

The manifest pointer is origin-pinned (`isPermittedArchive`) and falls back to
an archive compiled into the build, so a pointer cannot silently move these
requests to somebody else's host. That controls the recipient. It does not make
the cross-origin range requests private or authenticated.

### 5.5 "15 km squares" is a bound on a single request, not on a sequence

One tile request tells an observer very little. A *sequence* of them, ordered in
time, tells them the direction of travel across a metropolitan area. The app
does not deliberately serialise requests to trace a route, and a change that
made requests finer, ordered, or timed in a way that reconstructs a track is
treated as a vulnerability, not a performance regression
([`SECURITY.md` §2](./SECURITY.md)). But the honest statement of the bound is:
*each request* discloses a ~15 km square. The set of them over an hour discloses
more than any one of them.

### 5.6 Deletion is as good as the browser's, and no better

One-press removal destroys the stores and the vault key together. What it cannot
reach is anything the platform copied out from under it: an OS-level backup, a
filesystem snapshot, unallocated blocks on flash storage that a forensic tool
can recover, or a synced browser profile. "Removed from the app" is not
"unrecoverable from the device", and any claim otherwise would be false.

### 5.7 The camera archive can be wrong in the direction that hurts

See §2.8. A missing marker is the failure that matters, and no amount of
engineering on this side fixes a camera nobody has mapped yet.

---

## 6. The mesh, in detail, because it is the sharpest edge

The app talks to a **stock Meshtastic node** over Web Bluetooth. There is no
custom firmware and no custom radio protocol. Everything below is a property of
Meshtastic and of radio, not of this app, and none of it can be engineered away
by an application on the other end of a Bluetooth link.

**If you are not sure you understand this section, do not use the mesh
features. The rest of the app does not require them.**

### 6.1 Transmitting is a physical act

Pressing send emits radio energy on a public ISM band, from your position, at
that moment. Direction-finding equipment is cheap and the technique is old. No
encryption of any kind addresses this. **The only defence against traffic
analysis on a radio is not transmitting.**

This is why the app's transmit surface is five explicit methods, each with
exactly one call site, each behind a button a person presses — enforced by a
test that reads every file in `features/node` and `features/mesh`
(`features/node/mesh.privacy.test.ts`). The rule is not "these are safe", it is
"none of these can be triggered by a timer, a retry or a background sync".

### 6.2 Packet headers are cleartext, even for encrypted messages

A direct message on firmware 2.5+ takes the PKI path — X25519 to a shared
secret, then AES-256-CCM — and **fails closed** rather than downgrading. The
*contents* are protected.

**The header is not.** Who sent it, who it is addressed to, and when, travel in
the clear to every node in range and every node that relays it. An observer
learns the social graph and the timing without reading a single message. In
stock firmware the sending node's identifier is stable and tied to the hardware,
so "the same node transmitted again" is a conclusion an observer can draw across
sessions.

### 6.3 A broadcast is not private, at all

`sendText` broadcasts to **every node in range**, and each of them stores it. On
Meshtastic's default channel the encryption key is published in Meshtastic's own
source code. Anyone with a $30 radio can read it.

Treat a channel message as a message posted publicly with your node's identifier
attached. The app caps messages at 180 characters and refuses plate-shaped text
(`features/node/chat.ts:65`), but no input filter makes a broadcast private.

### 6.4 Naming your node makes the name public

`setOwnerName` writes `longName`, which rides every NodeInfo packet the firmware
sends. **It goes on the air, later, by the firmware's own doing.** A node named
after you, your car or your callsign is a persistent public identifier
broadcast from wherever you are. Joining a group, by contrast, writes a
SECONDARY channel over the Bluetooth cable and puts **nothing** on the air —
the admin packet is addressed to the local node and short-circuits before the
radio.

### 6.5 Threads are memory-only, on purpose

Mesh conversations live in memory and are gone on reload, capped at 100 entries.
A durable transcript would be a written record on your phone of who you talk to,
which is precisely the artefact a device seizure wants. The cost is that you
lose your messages on reload. That is the trade, made deliberately.

### 6.6 What is never on the air

There is **no position packet, no position field, and no way to request another
node's position**. `sendWaypoint`, `requestPosition`, `traceRoute`,
`sendPacket`, `setModuleConfig`, `latitudeI`, `longitudeI`, `onPositionPacket`
and `onWaypointPacket` are all banned by name and the build fails if any of them
appears.

The camera-sighting frame that exists in the source (`features/node/sighting.ts`)
is 16 bytes carrying **the camera's** position, bearing and OSM id — it has no
field for the driver, its test asserts that it has none, and **nothing calls it**
in this build. If that ever changes, the caller is what the privacy test will
catch, and it will change in a public diff.

---

## 7. Contributing to OpenStreetMap: public, attributed, permanent

**No report filed in this app has ever reached OpenStreetMap.** The tag builder
and the editor link exist, are tested, and are called by nothing
(`features/report/osmTags.ts`); map data flows strictly one way today. Reports
stay on your device.

If and when contribution is wired up, it will be **your** OSM account making
**your** edit, through OSM's own editor, and the following will be true — none
of it is negotiable by this project, because it is how OpenStreetMap works:

- **Every edit is public, immediately.** Changesets are visible in real time and
  in the planet dumps.
- **Every edit is attributed to a named account, permanently.** OSM's full
  history dumps carry the username and the timestamp of every version of every
  object.
- **Every edit is mirrored beyond anyone's control.** The planet file and its
  diffs are downloaded and archived worldwide, continuously. Deleting something
  from OSM does not delete it from the copies.
- **The edit carries a location and a time.** Mapping a camera near where you
  live or work links an account to that place, at that moment. If your account
  name resembles your real name, that link is to you.
- **Redaction is a formal process, not a button.** Removing personal data from
  OSM's history requires the Data Working Group, and it does not reach the
  copies.

If you are in a position where an attributed public record of where you were is
a problem, **do not contribute** — use the app and file nothing. The warning
belongs in front of the first contribution, not in a changelog after it, and any
contribution flow this project ships must state it at the point of the edit.

Two upstream lessons shape that restraint: MAPS.ME reached the point where 36%
of its edits were duplicate POIs and drew systematic reverts and blocks; and
DeFlock — in this exact domain — had its editor preset removed after users
pasted placeholder text literally and filed real cameras with bracketed
placeholder operators. Automatic upload is not a shortcut, it is the mechanism
by which a project earns a community-wide revert. See
[`DATA-CONTRACTS.md` §6](./DATA-CONTRACTS.md).

---

## 8. Assumptions this model rests on

If any of these is false for you, the analysis above does not hold.

1. **Your device and its operating system are not compromised**, and the browser
   enforces origin isolation and the non-exportability of a
   `extractable: false` key.
2. **Your device is locked** and not routinely handed to other people unlocked.
3. **The bundle you are running is the one built from the published commit.**
   The app displays that commit on the *How this works* screen. Verifying that
   the commit produced the bundle needs reproducible builds, which this project
   does not yet have — an open gap, listed in [`AUDITING.md`](./AUDITING.md).
4. **Cloudflare is honest but observant.** It is not modelled as an attacker
   modifying the app in flight; it *is* modelled as seeing your IP, your request
   pattern, and — during the beta — your Access identity.
5. **OpenStreetMap's camera corpus is broadly accurate but incomplete**, and
   incompleteness is the direction that hurts (§2.8).
6. **Meshtastic's cryptography works as documented** for message contents, and
   its headers are cleartext as documented. This project did not audit
   Meshtastic and does not vouch for it.
7. **You are in the United States.** The legal analysis in
   [`LEGAL.md`](./LEGAL.md) is US-only, and this document's assumptions about
   what an adversary may lawfully do follow it.

One note on scope: this document describes the deployed PWA and Pages Functions.
The curation platform and the currently undeployed report gateway are described
under the operator tooling; neither adds an end-user account or changes the shipped
client's network surface.

---

## 9. How to check any of this

Do not take the claims above on trust; the whole point of writing them down is
that they can be falsified. [`AUDITING.md`](./AUDITING.md) has the full set of
commands. The short version:

```bash
# Every literal network call in the client, and every absolute URL.
rg -n 'fetch\(|XMLHttpRequest|EventSource\(|WebSocket\(' apps/pwa/src
rg -n "https?://" apps/pwa/src --glob '!*.test.*'

# Prove the negative on telemetry.
rg -in 'analytics|telemetry|sentry|gtag|posthog|mixpanel' apps/pwa/src

# Prove the shipped PWA has no report-upload caller.
rg -n 'fetch\(' apps/pwa/src/features/report apps/pwa/src/services/db

# Prove no coordinate is in the alert schema.
rg -n 'lat|lon' apps/pwa/src/services/db/schema.ts

# Prove the banned mesh calls are banned, and watch the test that enforces it.
rg -n 'sendWaypoint|requestPosition|traceRoute|sendPacket' apps/pwa/src
```

And the one that needs no source at all: put the phone in airplane mode, open
DevTools → Network, and reload. You should see the document and the cameras come
from the caches, and nothing go anywhere else.

---

## 10. What would change this document

This file is versioned with the code, and it is meant to move when the code
does. Specifically, it must be updated in the **same commit** as any change
that:

- adds an outbound request, or widens an existing one
- adds a persistent store, or adds a field to one — especially a coordinate
- wires up any transmit path on the mesh, including the sighting codec
- wires up OSM contribution, or any report upload
- adds an account, a session, a sync or a backup
- changes the tile granularity, or the ordering or timing of tile requests

A pull request that does any of those and leaves this file unchanged is
incomplete, and reviewers should say so.

**If you believe something in this document is wrong** — not that the app fails
to protect against something it says it does not protect against, but that a
claim here is *false* — that is a security report, and it is exactly the kind
this project most wants. [`SECURITY.md`](./SECURITY.md) says how to send it.

---

*This is a description of a piece of software, not legal or safety advice. It
tells you what the app does so you can decide what to do. It cannot tell you
whether your own situation is safe.*
