# Competitive and privacy comparison

Three files comparing DarkRoute with six other ALPR-related Android apps, plus
the evidence each claim rests on.

## Why this exists

Not to argue that everything else is bad. Several of these apps are good, and
two of them do things DarkRoute does not.

It exists because of what these apps are *about*. When you build around a
sensitive subject — and surveillance is one — the work is supposed to contribute
to privacy rather than quietly cost it. An app that maps cameras while shipping
an advertising ID, or that routes around them by sending your origin and
destination somewhere, has not made anyone safer; it has moved the exposure
somewhere the user cannot see. That is not usually malice. It is the ordinary
result of nobody having to write down what the thing actually does.

So the point of the matrix is due diligence, applied to everyone including us.
Every row is a claim someone can check: what permissions are declared, what the
developer's own Data Safety entry says, whether the source can be read, what
leaves the device and to whom. Laid out side by side, it lets a person choose
with their eyes open — including choosing something other than DarkRoute,
because for some people that will be the right answer.

**This is also why DarkRoute is built the way it is.** The design constraints —
no account, no analytics, the archive on the device, the tile address computed
locally so no coordinate is ever sent, a consent prompt in front of the one
feature that must talk to a third party — exist so that the answers in our own
column can be short and checkable. A privacy claim that cannot be verified is
just a nicer way of asking to be trusted, and asking to be trusted is the thing
this whole category should be trying to stop doing.

The standard applies to us first. That is why our own row was audited against
the source rather than accepted as written, and why the findings below are
uncomfortable rather than flattering.

| File | What it is |
| --- | --- |
| `darkroute_graphic_matrix.csv` | The scored feature/permission matrix. One row per app, 33 columns. Source data for the comparison graphic. |
| `darkroute_evidence_register.csv` | One row per checkable claim, with its source and how far it was verified. |
| `darkroute_competitive_privacy_matrix.xlsx` | The same comparison as a workbook. |

The apps compared are DeFlock.me, FlockHopper, Watch Tower Pro, DriveSight Dash
Cam, Flock Clocker and Flock U, against DarkRoute.

## Read this before quoting any number in it

**DarkRoute scored itself.** Every other app in the matrix was scored from
outside — a Play listing, a public repository, public package metadata, a
published privacy policy. DarkRoute's row was written by the project, and it
gives DarkRoute the top score in almost every column. That is exactly the shape
a competitive matrix takes when it is marketing rather than research, and it
should be read with that in mind.

The evidence register is the honest half. It is where a claim either has a
source a stranger can check or it says so.

Every DarkRoute claim in the register now cites a **file and line** rather than
a capability word. Those are not openable today because the curated tree is not
published; they are exact and stable, so the moment it is, each one can be
clicked and read. Competitor rows cite the public artefact - a Play listing, a
repository, a privacy policy - which is the equivalent for an app whose source
we do not hold.

## What was audited, and what it changed

The register's DarkRoute row originally read `Project-supplied` with the status
`User/project supplied; audit against source before publication`. That audit has
now been done against the tree this file is published from, and it replaced one
self-supplied row with six that each cite a file and line. Three
findings are worth stating plainly:

- **The cited public repository is published.** The row points at
  `github.com/darkcodelabs/darkroute` as DarkRoute's primary source. It was
  private with no commits pushed when this audit was written, which made the
  "open source" and "auditable" claims rest on a URL nobody could open; the
  register recorded that as `PENDING` rather than as verified. It opened on
  2026-09-03, as a single new root commit so the private history never went
  with it. **Every file:line in the register below is now checkable by
  anyone**, which was the point of citing lines rather than asserting
  capabilities.

- **Implemented is not the same as shipped, and the matrix does not
  distinguish them.** ALPR-aware routing, the expanded abuse-record set and the
  on-device county lookup are real in source and were not on the live site when
  the matrix was written.

- **The camera map scored 1 while the deployed build served none.** The
  deployed Function read every tile through a generation pointer that had never
  been published, so it returned 503 for every camera tile; only devices with a
  populated IndexedDB cache kept drawing cameras, and a fresh install got an
  empty map. Fixed in this tree. A score of 1 for "Camera
  map" and "Offline camera awareness" was true of the code and false of the
  product.

The permission claims did verify. `apps/android/app/src/main/AndroidManifest.xml`
declares only `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` and
`POST_NOTIFICATIONS` — no `ACCESS_BACKGROUND_LOCATION`, no camera, microphone,
overlay or advertising-ID permission — which is what the matrix's zeros in those
columns assert. LoRa/Meshtastic, GPX export, Garmin POI export and the county
abuse records are all present in source.

## Scoring

Feature columns are `1` (present), `0.5` (partial) or `0` (absent).
`On-road actionability`, `Offline/locality` and `Distinctive capability count`
are derived summaries, not independent measurements — they are sums of the
columns to their left, so an optimistic feature score inflates them twice.

## Provenance and fairness

Competitor rows are sourced from Google Play listings, Chrome-Stats package
metadata, public repositories and developers' own privacy policies, captured
2026-09-03. Those are point-in-time snapshots: Play Data Safety declarations and
permission sets change without notice, and a competitor may have shipped
something since.

Nothing here is a security assessment of another app. The matrix records what
each developer publicly declares plus what public metadata shows. Where a
competitor is marked as collecting data, that is their own Play declaration and
not a finding about their behaviour — and a declaration is a sign of a developer
doing the disclosure properly, not evidence of bad faith.

A zero in a column is not an accusation and a one is not an endorsement. Several
of these apps are solving a different problem: DeFlock.me is the better community
map and editor and says outright that navigation is not its focus; FlockHopper
does destination-based ALPR-reduced routing well. Different tools, different
trade-offs, all of them legible enough to compare — which is the only outcome
this file is actually arguing for.

## Updating this

Re-verify a claim before changing a score, and put the source in the register.
A row in the matrix with no corresponding register entry is a claim with no
evidence, which is the thing this directory exists to prevent.
