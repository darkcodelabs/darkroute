# The legal position

What is settled, what is not, what this project will not do, and how a
copyleft code licence and a share-alike data licence coexist in one repository.

**Nothing in this file is legal advice.** It is a description of this project's
position and the public sources it rests on. Several of the questions below have
no controlling answer, and where that is the case it says so rather than
rounding up to confidence.

---

## 1. What this project is

A client that reads a public database of surveillance hardware, published by
volunteers on OpenStreetMap, and shows it on a map. It does not access any
camera. It does not access any vendor's systems. It does not obtain data by
scraping anyone. Every camera record originates in OSM under the ODbL and can
be traced to an OSM object ID and changeset.

That framing is not spin — it is the load-bearing fact for everything below.
The activity is *republishing publicly contributed, lawfully obtained
information about visible public infrastructure*.

---

## 2. What has actually happened to projects in this category

Not speculation. Documented events.

### 2.1 A trademark demand, refused, with no consequence

In January 2025 Flock Safety's counsel sent DeFlock — a crowdsourced OSM map of
ALPR cameras — a cease and desist demanding it "cease and desist all use of the
name 'DEFLOCK' or any variation thereof". The theory was trademark **dilution**
(blurring and tarnishment) and false advertising, not infringement.

EFF took the representation and refused: *"The claims alleged in your letter are
groundless, and Mr. Freeman will not be complying with your demands."* EFF's
reasoning: *"Federal anti-dilution law includes express carve-outs for any
noncommercial use of a mark and for any use in connection with criticizing or
commenting on the mark owner or its products."* EFF's senior staff attorney Cara
Gagliano noted the choice of theory was itself telling: *"Infringement requires
showing that consumers are likely to be confused by the use; Flock clearly
realizes how implausible that is here."*

Nothing further happened. DeFlock did not change its name.

- [404 Media, 26 Feb 2025](https://www.404media.co/flock-threatens-open-source-developer-mapping-its-surveillance-cameras/)
- [EFF, Feb 2025](https://www.eff.org/deeplinks/2025/02/anti-surveillance-mapmaker-refuses-flock-safetys-cease-and-desist-demand)

**Lesson taken:** the realistic first move against a project like this is a
letter, not a lawsuit, and the correct response is counsel plus publication —
which is why [`TRANSPARENCY.md`](./TRANSPARENCY.md) exists before any letter has
arrived.

### 2.2 The nearest non-ALPR analogue: publishing police locations

In December 2014 the LAPD chief wrote to Google objecting to Waze's
police-reporting feature, arguing it could be misused to endanger officers, and
police agencies pressed Google to remove it. Google declined, and the feature
remains. No legal action followed.
(<https://en.wikipedia.org/wiki/Waze>)

**Lesson taken:** institutional objection to publishing the location of law
enforcement assets is well precedented, and so is it not converting into
litigation.

### 2.3 The risk that is real, and is not about the map

Fusion centres are circulating intelligence bulletins about ALPR mapping.
404 Media obtained bulletins from the Colorado Information Analysis Center, the
Wisconsin Statewide Intelligence Center, the North Florida Fusion eXchange, the
New Jersey State Police and others, telling police to *"increase patrols around
ALPR"* and warning about DeFlock's public events. One bulletin describes a
June 2026 traffic stop in which police found *"a device … that could be used to
identify the locations of Flock cameras."* Another 404 Media report documents a
man charged with three felonies over a 3D-printed decoy camera.

DeFlock's maintainer responded: *"DeFlock has never called for disabling cameras
or covering license plates … Some of the activity referenced in these bulletins
originates from accounts using the DeFlock name without our authorization."*

- [404 Media, 12 Aug 2026](https://www.404media.co/the-government-is-monitoring-anti-flock-tiktok-and-instagram-accounts/)
- [404 Media, 25 Aug 2026](https://www.404media.co/man-charged-with-3-felonies-for-breaking-3d-printed-decoy-flock-camera/)

**Lesson taken, and it is the most important one in this file:** the material
legal risk in this category is not that mapping gets held unlawful. It is that
mapping gets *conflated with vandalism* by people writing law-enforcement
bulletins. That conflation is answered by conduct, not by argument — see
section 4.

---

## 3. Is mapping publicly visible cameras protected activity in the US?

**Short answer: there is strong support for yes, and no case squarely on point.
Be suspicious of anyone who tells you it is settled either way.**

### What supports it

- **Publishing lawfully obtained truthful information about a matter of public
  concern is strongly protected.** In *Bartnicki v. Vopper*, 532 U.S. 514
  (2001), the Supreme Court held that *"a stranger's illegal conduct does not
  suffice to remove the First Amendment shield from speech about a matter of
  public concern"*, affirming protection for a broadcaster who published a
  recording he had obtained lawfully but which a third party had intercepted
  illegally. DarkRoute's position is considerably stronger than the facts of
  *Bartnicki*, because nothing in the chain is unlawful at any point: the
  underlying observations are of hardware in plain public view, contributed
  voluntarily to a public database.
  ([Cornell LII](https://www.law.cornell.edu/supct/html/99-1687.ZS.html))
- **The government's own position elsewhere.** ALPR deployments are routinely
  disclosed by the operating agencies themselves through vendor transparency
  portals, procurement records and council minutes — the raw material EFF's
  Atlas of Surveillance is built from
  (<https://atlasofsurveillance.org/about>). Information a municipality
  publishes about its own cameras is not information a vendor can claim as
  secret.
- **EFF has already asserted First Amendment protection for exactly this
  project category**, in writing, on behalf of a client, and the demand was
  dropped (§2.1).
- **The data is not the project's to be enjoined over.** The camera records live
  in OpenStreetMap. A demand aimed at this repository does not reach them.

### What is genuinely unsettled

- **No US court has ruled on whether publishing ALPR camera locations is
  protected.** The DeFlock matter ended in correspondence. There is no
  precedent, favourable or otherwise. Anyone citing one is citing something
  else.
- **Trademark dilution remains available as a harassment vector**, even where
  the carve-outs make it likely to fail. Gagliano called dilution *"a much more
  nebulous concept that we think raises serious constitutional questions"*. The
  cost of a meritless dilution claim is real even when the claim is not.
- **State law varies and is moving.** Statutes on interfering with public-safety
  equipment, and on obstructing or altering licence plates, differ by state and
  are being actively applied (§2.3). This project takes no position on them
  beyond section 4.
- **Anti-SLAPP protection is state-by-state** and does not exist federally in
  general form. Whether a meritless suit can be disposed of cheaply depends
  heavily on where it is filed.
- **This analysis is US-only.** Nothing here says anything about the UK, EU,
  Australia or anywhere else, and at least one of those (Australia) has
  legislated in adjacent territory in ways that change the answer.

### A separate question: what the *driver* does

The sections above are about whether this project may publish. Whether a user
may act on what it publishes is a different question, and the two get conflated
constantly — including, per §2.3, in law-enforcement bulletins.

- **Choosing a route is lawful.** There is no offence in preferring one public
  road to another, and no US statute makes it unlawful to drive a longer way
  round. An ALPR reading is a record of a car on a road; declining to put your
  car on that road is not evasion of anything, because nothing is owed.
- **Obscuring, covering, flipping or altering a licence plate is a different
  act**, regulated separately by state vehicle codes, unlawful in many places,
  and actively enforced. It has nothing to do with route choice and this
  project will not advise on it (§4).
- **Interfering with a camera is a different act again**, and in the documented
  cases it has been charged seriously: a man was charged with **three felonies**
  for breaking a 3D-printed *decoy* Flock camera in a sting operation.
  ([404 Media](https://www.404media.co/man-charged-with-3-felonies-for-breaking-3d-printed-decoy-flock-camera/))
- **The risk of the conflation is real even when the conduct is not.** The
  fusion-centre bulletins in §2.3 discuss mapping, detection hardware and
  vandalism in the same breath. Behaving in a way that keeps those three
  distinguishable is a safety measure, not a legal formality.

What the app can and cannot do for a user, stated without hedging, is
[`THREAT-MODEL.md`](./THREAT-MODEL.md). It is blunter than this file, because it
is about consequences rather than argument.

### What follows

The right posture is not "we are safe". It is: the activity has strong
constitutional support, the realistic threat is cost rather than loss, the
mitigation is counsel plus publicity plus conduct, and the archive in
[`TRANSPARENCY.md`](./TRANSPARENCY.md) is set up before it is needed rather
than after.

---

## 4. What this project will not do

Stated so the boundary is legible from outside, and so it can be pointed at.

- **It does not tell anyone to damage, obstruct, disable or interfere with any
  camera, pole, solar panel or network.** Not in the app, not in the docs, not
  in the issue tracker. Content advocating it will be removed and the
  contributor asked to stop.
- **It does not tell anyone to obscure, cover, flip or alter a licence plate.**
  Route choice is lawful; plate obstruction is not, in many places, and
  conflating them would be both wrong and dangerous advice.
- **It does not probe, scan, access or accept reports about any camera's or
  vendor's systems.** See [`SECURITY.md` §2](./SECURITY.md).
- **It does not collect, store or transmit user movement data**, which means it
  has nothing to hand over. This is an architectural fact, checkable per
  [`AUDITING.md`](./AUDITING.md), not a promise.
- **It does not fork the OSM tagging taxonomy** or re-host anyone else's
  database. See [`TAXONOMY.md`](./TAXONOMY.md) and
  [`DATA-PROVENANCE.md`](./DATA-PROVENANCE.md).
- **It does not remove data from OpenStreetMap on request.** Those go to
  [OSMF's takedown procedure](https://wiki.osmfoundation.org/wiki/Takedown_procedure).

---

## 5. Licensing: each licence follows its work

The project code and original documentation are GPL-3.0-only, the OSM-derived
camera database is ODbL-1.0, and the three bundled font families are OFL-1.1.
Those licences govern different works. They do not conflict, and the reason is
worth stating precisely, because "GPL plus ODbL" looks like a conflict to a
reader who has only seen copyleft applied to code. The font files and their
notices are mapped separately in [`../../NOTICE.md`](../../NOTICE.md).

### 5.1 The code: GPL-3.0-only

`LICENSE` is the GNU General Public License version 3. Every publishable package
manifest — `package.json`, `apps/pwa/package.json`,
`packages/api-client/package.json`, and `packages/core/package.json` — declares
`GPL-3.0-only`.

**Why, and whether it is required.** The mesh feature links
[`@meshtastic/js`](https://github.com/meshtastic/js), which declares
`GPL-3.0-only` in its own published package metadata. A combined work that links
a GPL-3.0-only library is GPL-3.0. This is not a preference; it is the licence
of the dependency. See [`../../NOTICE.md`](../../NOTICE.md) for the history,
including that the project was previously MIT. The authority to make that
change is an explicit representation by Corian Kennedy that he was the sole
copyright holder at the time. The public repository starts at a squashed root
commit, so its history cannot independently prove that representation; this
document does not pretend otherwise.

**Measured dependency inventory.** From a frozen pnpm install, `pnpm licenses
list --json --long` reports 652 package names, 679 installed name/version pairs
and 17 raw licence labels. The generated SBOM contains 778 lockfile-resolved
third-party components; the larger count includes optional platform packages
that are not installed on this Linux host. The earlier claim of 2,086 packages
was a count of repeated dependency-tree occurrences, not packages, and was
wrong. `scripts/sanitize-sbom.mjs` also reconciles cdxgen's incomplete pnpm
dependency graph against the lockfile: the result has all 1,642 lockfile edges,
three explicit root-to-workspace aggregation edges, and all 782 root,
workspace, and third-party nodes reachable from the root. The regression suite
pins those counts and the Wrangler-to-libvips path. cdxgen omitted licence
metadata on 201 of those third-party components; the sanitizer fills those
gaps from exact-version npm metadata whose SHA-512 integrity matches the
lockfile-derived component hash. All 778 third-party components now carry a
licence choice, and the checked-in evidence map plus tests make that coverage
reproducible. These are the reproducing commands:

```sh
pnpm install --frozen-lockfile
pnpm licenses list --json --long | jq '{
  license_labels: (keys | length),
  package_names: ([.[][] | .name] | unique | length),
  name_versions: ([.[][] | .name as $name | .versions[] | "\($name)@\(.)"] | unique | length)
}'
pnpm dlx @cyclonedx/cdxgen@12.8.4 -t npm --spec-version 1.6 -o sbom/sbom.json
node scripts/generate-sbom-license-evidence.mjs
node scripts/sanitize-sbom.mjs
node --test scripts/sbom.test.mjs
jq '.components | length' sbom/sbom.json
```

After correcting the Meshtastic protobuf misclassification described below,
the licence expressions represented are: MIT, Apache-2.0, Apache-2.0 AND
BSD-3-Clause, Apache-2.0 AND LGPL-3.0-or-later, Apache-2.0 AND
LGPL-3.0-or-later AND MIT, MIT OR Apache-2.0, MIT-0, BlueOak-1.0.0, ISC,
BSD-2-Clause, BSD-3-Clause, GPL-3.0-only, LGPL-3.0-or-later, CC-BY-4.0,
MPL-2.0, CC0-1.0, 0BSD, and MIT OR CC0-1.0. No AGPL, SSPL, BUSL, Commons
Clause, non-commercial or proprietary label appears in that inventory. That is
an inventory result, not proof that every file bundled by every dependency has
been legally audited.

Two consequences a reader should be told rather than left to discover:

- **Apache-2.0** appears in 61 installed package paths, including compound
  expressions. Apache-2.0 is compatible with GPLv3 and *incompatible* with
  GPLv2. `GPL-3.0-only` is therefore the correct expression. A
  `GPL-2.0-or-later` claim would be broken, and so would relicensing "down".
- `@meshtastic/js@2.6.0-0` is a prerelease and is **marked deprecated on npm**
  ("Package no longer supported") while also being the `latest` dist-tag. That
  is a maintenance fact, not a licensing one, but a hostile auditor will find it
  in under a minute and it should be acknowledged rather than discovered.
- Its transitive dependency `@meshtastic/protobufs` resolves to
  `@jsr/meshtastic__protobufs@2.7.26`. Its generated npm `package.json` has no
  `license` field, but the exact [JSR release](https://jsr.io/@meshtastic/protobufs@2.7.26)
  declares `GPL-3.0-only`, and the exact tarball contains the full GPLv3 text as
  `LICENSE`. pnpm's licence command incorrectly reports this package as
  lowercase `lgpl`: its [fallback licence-text scanner](https://github.com/pnpm/pnpm/blob/v9.15.9/reviewing/license-scanner/src/getPkgInfo.ts#L164-L187)
  matches that substring in the `why-not-lgpl.html` URL near the end of the GPL
  text. The SBOM and `NOTICE.md` therefore record the evidenced GPL-3.0-only
  result explicitly instead of repeating that heuristic.
- The pinned deployment CLI `wrangler@4.128.0` is a development-only tool. Its
  Miniflare/Sharp chain installs two optional platform packages,
  `@img/sharp-libvips-linux-x64@1.3.1` and the matching `linuxmusl-x64`
  package, under `LGPL-3.0-or-later`. They remain in ignored `node_modules` and
  are absent from the PWA bundle and public seed. The lockfile inventory also
  names eight non-host libvips platform variants; all ten are recorded as
  `LGPL-3.0-or-later` in the SBOM because the frozen development/deployment
  toolchain includes those optional resolutions.

### 5.2 The data: ODbL 1.0, and it is not the code licence

Every camera record originates in OpenStreetMap, which is licensed under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
by the OpenStreetMap Foundation (<https://www.openstreetmap.org/copyright>).

The GPL governs the program. The ODbL governs the database. Neither licence
reaches into the other's subject matter — a GPL application that reads an ODbL
database is not a derivative of the database, and an ODbL database rendered by
GPL code does not become GPL. They travel together in one repository the way a
program and a data file travel together on one disc.

What the ODbL does require of this project, by section:

| ODbL section | Requirement | What DarkRoute must do |
|---|---|---|
| **§4.2** Notices | If you publicly convey the Database or a Derivative Database, do so under this licence, include the licence or its URI **in the data and in the documentation**, and keep notices intact | The published camera archive must carry the ODbL URI and the OSM attribution *inside* the artefact, not only on the website |
| **§4.3** Produced Work notice | A notice "reasonably calculated to make any Person … aware that Content was obtained from the Database … and that it is available under this License" | The on-map attribution string. It is a licence condition, not decoration |
| **§4.4(b)** Share alike | "Extraction or Re-utilisation of the whole or a Substantial part of the Contents into a new database is a Derivative Database" | The extracted camera archive **is** a Derivative Database and must be offered under ODbL |
| **§4.5(b)** | Creating a Produced Work does **not** create a Derivative Database | The rendered map alone is a Produced Work. The shipped data file is not |
| **§4.5(c)** | Internal use within an organisation is not public use | A genuinely internal build is out of scope. A public beta is not obviously internal — see the flag below |
| **§4.6** Access | Publicly using a Derivative Database obliges you to offer recipients a machine-readable copy of the entire Derivative Database, or a file of the alterations / the method of making them, free over the internet | Publishing the extract **and** the fetch/build script satisfies this. Publishing only the tiles does not |
| **§4.7(a)** | You may not impose technological measures that restrict the rights the licence grants | See the flag below |
| **§4.7(b)** | Unless you also make an unrestricted copy available, at no additional fee, at least as accessible | The parallel-distribution escape hatch |

**A flag, not a finding.** [`API.md`](./API.md) records that the `/cameras/*`
proxy "inherits the site's Access policy" during the private beta. If the
Access-gated artefact is the ODbL Derivative Database and no unrestricted
parallel copy is offered, that is a §4.7(a) question, resolvable either by
§4.5(c) if the beta is genuinely internal or by §4.7(b) parallel distribution if
it is not. This project's answer is to publish the extract and the build script
openly regardless, which moots the question. **Whether a closed tester beta
counts as "internal" under §4.5(c) is genuinely unclear and should not be
assumed.**

**Attribution specifics**, from the OSMF Attribution Guideline adopted
2021-06-25 (<https://osmfoundation.org/wiki/Licence/Attribution_Guidelines>):

- Attribution must be to **"OpenStreetMap"**, and must make clear the data is
  under the ODbL — satisfied by linking the word to
  `openstreetmap.org/copyright`.
- For a browsable map, the credit "should typically appear in a corner of the
  map", or adjacent to it, or on a splash screen.
- It **may** collapse — on a dismiss interaction, on pan/zoom, or automatically
  after five seconds — but "the user must still be able to find the licence
  information if they look for it, for example from an '(i)' button in the
  corner of the map or an 'About' option in a menu."
- For **databases** specifically: "You must include attribution to OpenStreetMap
  and either the text of the ODbL or a link to it as part of the database …
  in a location (such as a relevant directory) where users would be likely to
  look for it, such as a readme file, or within the data or metadata."

### 5.3 What the repository must state, and where

For a stranger to verify the above without asking anyone:

1. **`LICENSE`** — GPL-3.0 full text. Present.
2. **`NOTICE.md`** — the material runtime components and bundled fonts, with
   their licences and provenance. Present. The complete dependency inventory is
   the generated [`../../sbom/sbom.json`](../../sbom/sbom.json), including the
   evidence-backed correction for `@jsr/meshtastic__protobufs`.
3. **A data-licence statement that is not buried in the code licence.** The ODbL
   applies to the camera archive; the GPL does not. Stating this in one place,
   plainly, prevents a downstream reuser from assuming the whole repository is
   GPL and stripping the OSM attribution as "just a comment".
4. **The ODbL URI and the OSM attribution inside the published data artefact**
   (§4.2, and the OSMF "Databases" scenario), not only in the UI.
5. **The extraction method** — the exact query and the script — published, which
   is what discharges §4.6 and is documented in
   [`DATA-PROVENANCE.md`](./DATA-PROVENANCE.md).
6. **Documentation licence.** OSM's own documentation is CC BY-SA 2.0. Except
   where a file or cited third-party source says otherwise, this project's
   original prose is GPL-3.0-only with the code, as stated in `NOTICE.md`.

---

## 6. Repository hygiene that this position depends on

A legal position that rests on "the code does what we say" is only as good as a
stranger's ability to check it. The files that credible privacy projects ship
for exactly this purpose, named so they can be copied rather than described:

- **`reproducible-builds/`** — Signal-Android ships a directory containing a
  Docker build environment and an `apkdiff.py`, with a README that walks a
  stranger from a published tag to a byte comparison against the installed app.
  Signal has done this since version 3.15.0 in March 2016.
  (<https://github.com/signalapp/Signal-Android/tree/main/reproducible-builds>)
- **A documented reproducible build in the build guide** — GrapheneOS carries a
  "Reproducible builds" section inside <https://grapheneos.org/build>, alongside
  documented release-key generation.
- **`SECURITY.md`**, **`SOURCE_OFFER`** (the GPL §6 written offer for binaries),
  **`supply-chain/`** (`audits.toml`, `config.toml`, `imports.lock` —
  `cargo-vet` dependency audits), and **`.well-known/`** — all at the root of
  SecureDrop. (<https://github.com/freedomofpress/securedrop>)
- **`security-insights.yml`** — the OpenSSF machine-readable security-posture
  file, which "fills the gap between a plain-text SECURITY.md and an SBOM".
  (<https://github.com/ossf/security-insights-spec>)
- **OpenSSF Scorecard** — an external, adversarial, automated audit of exactly
  the things a hostile reader checks: pinned dependencies, branch protection,
  signed releases, CI tests, SAST. (<https://github.com/ossf/scorecard>)
- **Build provenance attestations** — SLSA-style signed statements binding an
  artefact to the workflow and commit that produced it.
  (<https://slsa.dev/spec/v1.0/levels>,
  <https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds>)

The definition worth quoting to anyone who asks why this matters: reproducible
builds are "a set of software development practices that create an
independently-verifiable path from source to binary code."
(<https://reproducible-builds.org/>)

For this repository specifically, the concrete gaps are enumerated in
[`AUDITING.md`](./AUDITING.md) rather than here, so that the list a reader
checks and the list a maintainer fixes are the same list.

---

## 7. Contact

Legal correspondence: the address in [`SECURITY.md`](./SECURITY.md). It will be
acknowledged, it will be answered, and — per
[`TRANSPARENCY.md`](./TRANSPARENCY.md) — it will be published.
