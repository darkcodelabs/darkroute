# Transparency

What gets published if somebody sends a legal demand, where it goes, what is
removed from it before publication, and why those specific things and not
others.

This file is the policy. The archive it describes is
[`/transparency/`](../../transparency/README.md), at the repository root. If the
two ever disagree, the archive is the record and this file is the bug.

---

## 0. The commitment, in one paragraph

Every legal demand this project receives about its content — takedown notice,
cease and desist, trademark demand, subpoena, preservation letter, court order,
a police request to remove a marker — is published here in full text, with only
the redactions listed in section 3, together with whatever response was sent.
Publication is not conditional on the demand being wrong, on us winning, or on
us complying. **A notice appearing here means only that it arrived on the date
shown. It is not evidence that the claim has merit, and it is not evidence that
it does not.**

That last sentence is lifted almost verbatim from GitHub's own DMCA repository,
which states: *"It only means that we received the notice on the indicated date.
It does **not** mean that the content was unlawful or wrong."*
([github/dmca README](https://github.com/github/dmca/blob/master/README.md))

---

## 1. Why an archive and not a statement

Three reasons, in descending order of how much they matter.

**Because the tool is only as trustworthy as its worst day.** DarkRoute tells
people where surveillance cameras are. The interesting question is not what it
does when nobody objects; it is what happens the first time a company's law
firm sends a letter. If that letter is answered privately and a marker quietly
disappears, every remaining marker becomes unfalsifiable. An archive makes the
absence of an entry mean something.

**Because the chilling effect is the point of the record.** GitHub explains its
own repository this way, quoting Chilling Effects: *"cease and desist letters
often silence Internet users, whether or not their claims have legal merit …
we post takedown notices here to document their potential to 'chill' speech."*
([github/dmca README](https://github.com/github/dmca/blob/master/README.md))
A demand that is never seen cannot be judged, and a demand nobody expects to be
seen is cheaper to send.

**Because it has already happened in this exact category.** In January 2025
Flock Safety's counsel sent DeFlock — a crowdsourced OSM map of ALPR cameras —
a cease and desist demanding it stop using the name "DeFlock". EFF represented
the maintainer, refused, and published both letters. 404 Media obtained and
posted the demand. The claim was trademark *dilution*, not infringement, and
EFF's answer was that federal anti-dilution law *"includes express carve-outs
for any noncommercial use of a mark and for any use in connection with
criticizing or commenting on the mark owner or its products."* Nothing further
happened.
([404 Media, 26 Feb 2025](https://www.404media.co/flock-threatens-open-source-developer-mapping-its-surveillance-cameras/) ·
[EFF, Feb 2025](https://www.eff.org/deeplinks/2025/02/anti-surveillance-mapmaker-refuses-flock-safetys-cease-and-desist-demand))

The reason that ended well is that it was public within weeks. This archive is
the mechanism that makes the same outcome possible without a journalist having
to obtain the letter first.

---

## 2. Prior art this copies, deliberately

Nothing here is invented. Each convention is taken from a project that has
operated it at volume.

| Source | What is borrowed | Where |
|---|---|---|
| **github/dmca** | Directory layout, `YYYY/MM/YYYY-MM-DD-slug.md` filenames, `-counternotice` / `-reversal` suffixes, the `[private]` and `[invalid]` markers, the "receipt is not merit" disclaimer, refusing PRs to the archive | <https://github.com/github/dmca> |
| **Lumen (Harvard Law School Library)** | Mirroring notices to an independent third party so the record survives the repo | <https://lumendatabase.org/> |
| **Signal, "Government Requests"** | Publishing the demand *and* the response together, in full, as the primary artifact rather than a summary count | <https://signal.org/bigbrother/> |
| **Tor Project abuse templates** | Shipping the *response* letters in the repo, not just the incoming notices, so an operator or a fork has something to send | <https://community.torproject.org/relay/community-resources/tor-abuse-templates/> |
| **OpenStreetMap Foundation** | A named designated agent, a documented filing route, and the DMCA §512(c)(3) element list a valid notice must contain | <https://wiki.osmfoundation.org/wiki/Takedown_procedure> |

GitHub's README names Lumen and Google as its own inspiration, so this is the
third generation of the same convention rather than a novel one.

---

## 3. What is redacted, and what is not

This is the part that decides whether the archive is honest.

### 3.1 Redacted — replaced inline with `[private]`

1. **Personal contact details of natural persons**: personal email addresses,
   direct phone numbers, home addresses, signature images, and any personal
   identifier of a junior employee or paralegal who merely transmitted the
   letter.
2. **Third-party personal data the sender chose to include**: licence plate
   numbers, vehicle descriptions tied to an individual, subscriber records,
   IP addresses, account identifiers. If a sender puts a plate number in a
   letter to a project that exists to argue against plate surveillance, that
   plate does not get republished.
3. **Anything a court has actually sealed.** Named as sealed, not silently
   dropped.

Nothing else. Not the sender, not the firm, not the theory, not the deadline.

### 3.2 Marked `[invalid]`

URLs, OSM object IDs, or map markers named in a demand that were not present,
already removed, or outside the project's control at the time of review. This
is GitHub's convention and the reason it exists is precision: it distinguishes
"we declined" from "there was nothing there".

GitHub's README is explicit that these two markers mean different things and
that `[private]` was overloaded for both before March 2021.

### 3.3 Never redacted

- The **sending organisation**, the **law firm**, and the **named attorney's
  professional identity**. A demand sent on a law firm's letterhead is a
  professional act performed on behalf of a client, not private correspondence.
  GitHub redacts "private information" only; the claimant is published. So is
  the firm — the DeFlock demand is publicly attributable to a named attorney at
  a named firm because 404 Media published it.
- The **legal theory**, the **statutes cited**, the **remedy demanded**, and any
  **deadline**.
- The **client** the demand is sent on behalf of.
- The **URLs, OSM object IDs and coordinates actually at issue**, unless they
  fall under 3.1(2).
- **Our response**, in full.

### 3.4 The one carve-out, stated so it cannot be used as a loophole

If a demand comes from a **private individual** rather than an organisation and
asserts a personal-safety concern — for example, that a camera marker sits on
their property and its coordinates now identify their home — the *substance* is
published with the individual's identity and address under `[private]`, and the
outcome is logged. What is never done is quietly disappearing the request. The
carve-out covers identity, never the existence of the request or its result.

This carve-out does not apply to a company, a police department, a municipality,
a vendor, or anyone represented by counsel.

---

## 4. Where it lives and what it is called

**At the repository root, as `transparency/`** — not under `docs/`. An archive
of legal demands is one of the first things a hostile reader goes looking for,
and github/dmca is a top-level repository for exactly that reason. Three
directories deep is where a thing goes when it is not meant to be found.

```
transparency/
├── README.md                  the index; states the count and the date it was last affirmed
├── TEMPLATE.md                front matter + skeleton for a new entry
├── index.csv                  one row per notice, machine-readable
└── YYYY/
    └── MM/
        ├── YYYY-MM-DD-<slug>.md
        ├── YYYY-MM-DD-<slug>-response.md
        └── YYYY-MM-DD-<slug>-outcome.md
```

`<slug>` is the sending organisation, lowercased and hyphenated. Two demands
from the same sender on the same day get `-2`, `-3`.

Suffixes, three of them from github/dmca's live vocabulary and one added
because DarkRoute is the recipient rather than an intermediary:

| Suffix | Meaning | Precedent |
|---|---|---|
| *(none)* | The incoming demand, verbatim | github/dmca |
| `-response` | What we sent back | Signal, Tor templates |
| `-counternotice` | A third party disputing an action we took | [github/dmca 2025/06](https://github.com/github/dmca/tree/master/2025/06) |
| `-reversal` | An action reversed, by us or by the sender withdrawing | [github/dmca 2025/06](https://github.com/github/dmca/tree/master/2025/06) |
| `-outcome` | What actually changed in the app or the data, and the commit that did it | — |

The naming is not decorative. It is copied because it sorts correctly, is
greppable, and has survived fifteen years and tens of thousands of files in
`github/dmca` — the August 2026 directory alone contains entries such as
`2026-08-04-mojang.md` and `2026-08-04-cloudreve-2.md`, and June 2025 contains
`2025-06-18-anthropic-counternotice.md` and
`2025-06-26-raven-b4-counternotice-reversal.md`.

### The empty state is a claim, not an absence

An empty directory reads as "not implemented". `transparency/README.md`
therefore carries a count and a date on which the count was last affirmed, and `index.csv`
carries a header row. Zero notices is a published fact with a timestamp, not a
silence. See section 6 for why that is the honest half of what a warrant canary
attempts.

### The archive does not accept contributions

Like github/dmca, pull requests against `transparency/` are refused. The
archive is a record of what was received, not a wiki. Corrections go through an
issue, so that the correction is itself in the history.

---

## 5. Procedure

1. **Receive.** Anything that reads as a legal demand goes to the address in
   [`SECURITY.md`](./SECURITY.md) or the repository's contact route. It is
   acknowledged, and the acknowledgement says it will be published.
2. **Do not act under deadline pressure alone.** A letter is not an order. The
   DeFlock demand set a deadline and was answered with a refusal.
3. **Publish within 7 days of receipt**, before any decision about compliance.
   Publication is not a bargaining chip and is never traded away. If a demand
   arrives with a request for confidentiality attached, the request itself is
   published; a private party cannot impose a gag by asking for one.
4. **Get counsel** for anything beyond a plainly meritless letter. EFF takes
   referrals in exactly this category and has already acted in it.
5. **Respond**, and publish the response beside the demand.
6. **Mirror to Lumen** (<https://lumendatabase.org/>) so the record outlives
   this repository, this account, and this host. This is the single most
   important step, because every other step assumes the repo still exists.
7. **Log the outcome**, including any change made and the commit that made it.
   A marker removed without an `-outcome` file is indistinguishable from a
   marker that was never there.

### The one thing that is never done

Data is not removed from OpenStreetMap on this project's say-so. DarkRoute reads
OSM; it does not own the camera database. A demand to remove a camera record is
routed to the OSMF takedown procedure and its designated agent
(<https://wiki.osmfoundation.org/wiki/Takedown_procedure>), and that routing is
published. Deleting a marker locally while the upstream object stands would
create a silent divergence between what the app shows and what the public
database says — which is the precise failure this whole document exists to
prevent.

---

## 6. Warrant canary: the decision, and the argument against

**Decision: no general warrant canary. A narrow, scoped statement instead.**
Reasoning below, because "we decided not to" is not an answer.

### What a canary is

A regularly published statement that a provider has *not* received legal process
it is forbidden from acknowledging. The theory is that while the government may
compel silence, the First Amendment's bar on compelled speech means it may not
compel a *lie* — EFF: *"while the government may be able to compel silence
through a gag order, it may not be able to compel an ISP to lie by falsely
stating that it has not received legal process when in fact it has."*
([EFF Warrant Canary FAQ](https://www.eff.org/deeplinks/2014/04/warrant-canary-faq))

### A well-run one

rsync.net has published a PGP-signed canary weekly since 2006, listing warrants
and subpoenas per jurisdiction, with news headlines embedded in the signed text
to prove the update could not have been written in advance. It is still current.
It also documents its own failure modes on the same page: *"This process is not
infallible … it does not prevent them from using force to coerce rsync.net to
produce false declarations."*
(<https://rsync.net/resources/notices/canary.txt>)

That is the bar. A canary without a signature, a fixed cadence, a currency
proof, and a published interpretation rule is decoration.

### The argument against

1. **Untested.** EFF's own FAQ concedes courts have *"not yet"* upheld one.
2. **It may not be the loophole it looks like.** Moxie Marlinspike, Sept 2014:
   *"every lawyer I've spoken to has indicated that having a 'canary' you remove
   or choose not to update would likely have the same legal consequences as
   simply posting something that explicitly says you've received something."*
   Bruce Schneier, March 2015, said he *"never believed [warrant canaries] would
   work."* (<https://en.wikipedia.org/wiki/Warrant_canary>)
3. **They fail in practice, measurably.** EFF, Freedom of the Press Foundation,
   NYU Law, Calyx and the Berkman Center ran Canary Watch for a year and closed
   it, reporting that canaries *"would have subtle changes in language or
   grammar, which can be hard to interpret … often were not updated at all, or
   were updated several days or weeks late … sometimes the warrant canary, along
   with the entire website would disappear without explanation … All of this
   uncertainty caused numerous false alarms."*
   ([EFF, May 2016](https://www.eff.org/deeplinks/2016/05/canary-watch-one-year-later))
4. **Courts will enforce gags on transparency reporting.** In *Twitter v.
   Garland* the Ninth Circuit upheld a restriction on Twitter publishing
   national-security transparency information; EFF asked the Supreme Court to
   reverse in 2023.
   ([EFF](https://www.eff.org/press/releases/eff-supreme-court-reverse-dangerous-prior-restraint-ruling-upholding-fbi-gag-xs))
5. **Some jurisdictions have simply banned them.** Australia's 2015 data
   retention amendments make it an offence to disclose the existence or
   non-existence of a journalist information warrant.
   (<https://en.wikipedia.org/wiki/Warrant_canary>)
6. **The domain-specific reason, which is the decisive one.** A canary is
   informative only if its removal would tell you something you could not
   otherwise learn. DarkRoute holds no accounts, no user records, no server-side
   position history, no deployed report route and no client upload caller.
   There is nothing a secret order for user data could produce. A canary
   reading "we have received no demand for user
   data" would be technically true, permanently, and would say nothing — it
   would launder an *architectural* property into an apparent *legal* one, which
   is precisely the kind of confidence theatre this project is supposed to be
   against.

### What is published instead

Two things, both narrow enough to mean something:

- **A dated count.** `transparency/README.md` states the number of demands
  received and the date the count was last affirmed. This covers the entire category that
  can lawfully be disclosed, which for a project with no user data is nearly all
  of it.
- **A build-integrity statement, tied to something checkable.** The only demand
  that could plausibly be both gagged and materially harmful here is one
  compelling a targeted change into a shipped build. The answer to that is not a
  canary, it is reproducible builds plus the commit stamp the app already
  displays: a reader who can rebuild the bundle from the published commit and
  get the same bytes does not need to be told the build is clean, they can see
  it. See [`AUDITING.md`](./AUDITING.md).

If a scoped canary is ever added, it must have all four rsync.net properties —
signed, fixed cadence, currency proof, published interpretation rule — or it
must not be added at all. A lapsed canary is worse than none, because Canary
Watch showed that lapse and trigger are indistinguishable to the reader.

---

## 7. What this document does not cover

- **Security vulnerability reports.** Those are [`SECURITY.md`](./SECURITY.md)
  and are handled privately until fixed. A vulnerability report is not a legal
  demand and is not published here on receipt.
- **The legal position itself** — what is settled, what is not, and what this
  project will not do — is [`LEGAL.md`](./LEGAL.md).
- **Data removal from OpenStreetMap**, which is upstream and is
  [OSMF's procedure](https://wiki.osmfoundation.org/wiki/Takedown_procedure),
  not ours.

---

*Nothing in this file is legal advice. It describes what this project commits to
publishing. It does not describe what any reader should do.*
