# DarkRoute — the public documentation set

DarkRoute warns drivers about automatic licence plate readers. It is a
privacy-first, offline-capable PWA: React 19, TypeScript strict, Vite, Zustand,
IndexedDB, MapLibre/PMTiles, Cloudflare Pages and Functions, with an optional
Meshtastic LoRa link over Web Bluetooth.

Everything in this directory exists for one reason. **The product is a claim
about what does *not* leave your phone, and a claim like that is worthless
unless a stranger who assumes you are lying can check it.** These documents are
written for that stranger. They are linked from inside the app itself — Settings
→ *How this works* — alongside the commit hash of the build you are running, so
you can confirm the source you are reading is the source that made the bundle
you have (`apps/pwa/src/features/docs/docs.ts`).

---

## Start here

| If you are… | Read |
|---|---|
| a sceptic who assumes this app is lying | [`AUDITING.md`](./AUDITING.md), then verify one claim yourself |
| a driver deciding whether to trust it | [`THREAT-MODEL.md`](./THREAT-MODEL.md) §2, the list of things it does **not** do |
| a journalist or researcher | [`DATA-PROVENANCE.md`](./DATA-PROVENANCE.md), then [`TAXONOMY.md`](./TAXONOMY.md) §4 |
| a lawyer | [`LEGAL.md`](./LEGAL.md), then [`/transparency/`](../../transparency/README.md) |
| building something on this data | [`TAXONOMY.md`](./TAXONOMY.md) §4, then [`DATA-CONTRACTS.md`](./DATA-CONTRACTS.md) §3 |
| writing an independent verifier | [`DATA-CONTRACTS.md`](./DATA-CONTRACTS.md) §1–§2 |
| contributing code | [`CONTRIBUTING.md`](./CONTRIBUTING.md), then [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| reporting a bug that leaks position | [`SECURITY.md`](./SECURITY.md) — a privacy leak counts as a vulnerability here |

---

## The documents

### [`AUDITING.md`](./AUDITING.md) — check it yourself

The commands. Every privacy claim this project makes, paired with the grep, the
test, the DevTools procedure or the API call that confirms or refutes it. §3
draws a reproducible random sample of the camera archive and diffs it against
OpenStreetMap live. §4 contains a complete independent signature verifier in
Node stdlib that imports nothing from this repository. §8 is what the audit
found and nobody has fixed yet.

**Read this first if you do not trust us.** It is the only document whose
claims you do not have to take on faith, because it consists of instructions
rather than assertions.

### [`THREAT-MODEL.md`](./THREAT-MODEL.md) — what this protects you from, and what it does not

Ten ranked adversaries with an honest verdict for each — including the
maintainer, at #10. An asset table stating what a compromise of each thing
*surrenders* and what it does *not* achieve. A residual-risks section naming
the real boundaries that remain: an explicit but unwired cleartext plate-export
API, dead-drop rows that deliberately refuse to reverse-geocode the filing
position, browser speech-to-text, and the basemap request pattern. Map handoff
uses a local `geo:` URI on supported non-iOS platforms; on iOS it is unavailable
and the shipped v1 Drive and Intel controls are absent.

Section 2 is eight flat refusals. It does not hide you from cameras. It is not
a VPN. A silent map is not evidence of a clear road.

### [`ARCHITECTURE.md`](./ARCHITECTURE.md) — how it works

Six flow diagrams: the camera pipeline, filing a report, the mesh link, and
cold boot with no network. Section 2 is the exhaustive table of **everything
that leaves the device**, deliberately placed near the top rather than at the
end. Section 7 is what is deliberately not built; section 8 indexes the dead
ends — code that exists, is tested, and has no caller.

### [`API.md`](./API.md) — the API reference

Every Cloudflare Function, every request the app makes, every static data
endpoint, the operator scripts, the service worker's cache strategies, and the
environment bindings. Each entry cites the file and line that implements it.
Section 8 tells you how to check the document against a live deployment rather
than believing the table.

### [`DATA-CONTRACTS.md`](./DATA-CONTRACTS.md) — the bytes, exactly

The canonicalisation rules at byte level, the signed evidence record and its
hash chain, the exact 124-byte preimage, the failure taxonomy, the published
file schemas with real samples, the twelve IndexedDB stores with every field
marked signed or mutable, and the Meshtastic protobuf surface.

Written so an independent verifier can be built from the prose alone. If you
find a discrepancy between this document and the code, the code is the
authority and the discrepancy is a bug in this file — report it.

### [`DATA-PROVENANCE.md`](./DATA-PROVENANCE.md) — where the camera data comes from

OpenStreetMap, under ODbL. The verbatim Overpass query, the four-program
pipeline, every safety breaker with its threshold and the incident that put it
there, how enrichment adds and never replaces, the publication path, the
freshness watermark and what it currently says. Section 4 is the negative
space: no plates, no reads, no contributor identity, no driver positions.
Section 7 rebuilds the whole archive from upstream; section 8 is eleven
self-checks you can run.

### [`TAXONOMY.md`](./TAXONOMY.md) — what we call things, and how to use this data

Sixteen defined terms; mapping tables to OSM tags in both directions, to
DeFlock and FlockHopper property by property, and to the EFF Atlas of
Surveillance as a join rather than a field map. Eleven working recipes for
GeoJSON, CSV, `.osm` and more. Section 5 is what *not* to do — the re-import
hazard, the Produced Work versus Derivative Database test, and twelve traps
that produce a silently wrong dataset.

### [`TRANSPARENCY.md`](./TRANSPARENCY.md) — what gets published when a demand arrives

The commitment, the scope, the redaction rules, and what is never redacted.
The archive itself is at [`/transparency/`](../../transparency/README.md) at
the repository root, with a dated count — currently zero — so silence is a
claim on the record rather than an absence of one.

### [`LEGAL.md`](./LEGAL.md) — the legal position

What is settled, what is genuinely unsettled, and the things this project will
not do regardless of who asks. Includes the separate question of what a
*driver* does: choosing a route is not the same act as obscuring a plate, which
is not the same act as interfering with a camera. Conflating them is how people
get hurt.

### [`SECURITY.md`](./SECURITY.md) — reporting a vulnerability

Including privacy leaks, which count as vulnerabilities here. A 90-day ceiling
after which the report is published regardless. Vendor systems are permanently
out of scope and that is not negotiable.

### [`CONTRIBUTING.md`](./CONTRIBUTING.md) — how to work on this

Toolchain, gates, the comment convention (comments name the specific defect,
not the feature), the commit convention, ten non-negotiable privacy rules each
paired with the test that enforces it, and a table of which document must
change when which code changes.

---

## Elsewhere in the repository

| Path | What it is |
|---|---|
| [`/transparency/`](../../transparency/README.md) | The takedown-notice archive, with its template and index |
| [`/LICENSE`](../../LICENSE) | GNU GPL v3.0 only |
| [`/NOTICE.md`](../../NOTICE.md) | Why the licence is GPL and not MIT |
| [`/docs/credits.md`](../credits.md) | The other projects in this space, and what each does better |
| [`/DESIGN-GAPS.md`](../../DESIGN-GAPS.md) | Decisions deliberately not made yet, referenced by `GAP:` markers in the source |

---

## How to read these honestly

**Numbers go stale.** Every measured figure in this set carries the date it was
measured and, where practical, the command that produced it. Re-run the command
rather than quoting the number. Where a document and the tree disagree, the tree
is right.

**Absence claims are the weak ones.** "No coordinate leaves the device" is a
proof of absence, established by enumerating every network primitive in the
source. That is strong but not a proof — a sufficiently indirect dynamic call
would evade it. `AUDITING.md` §2 gives you the greps; run them yourself rather
than accepting the conclusion.

**These documents contain findings against this project.** `AUDITING.md` §8,
`DATA-CONTRACTS.md` §9, `DATA-PROVENANCE.md` §9 and `ARCHITECTURE.md` §8 exist
because a transparency document that reports only clean results is a marketing
document. If you find something they missed, that is what
[`SECURITY.md`](./SECURITY.md) is for.
