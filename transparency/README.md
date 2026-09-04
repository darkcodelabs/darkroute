# Transparency archive

Legal demands received by this project, published in full text.

**Count: 0. Last affirmed: 2026-08-29.**

That count is a claim with a date on it, not an empty directory. When it is
non-zero it will be non-zero *here* first — before any decision about whether to
comply, and regardless of who sent the demand or how well-founded it looks.

The policy that governs this directory — what is redacted, what never is, the
timeline, and why there is no general warrant canary — is
[`docs/public/TRANSPARENCY.md`](../docs/public/TRANSPARENCY.md). **If this
directory and that policy ever disagree, this directory is the record and the
policy file is the bug.**

---

## What a notice in here means

**It means the notice arrived on the date shown. That is all it means.** It is
not evidence that the claim has merit, and it is not evidence that it does not.

That wording is taken almost verbatim from GitHub's own DMCA repository, which
states of the notices it publishes: *"It only means that we received the notice
on the indicated date. It does **not** mean that the content was unlawful or
wrong."*
([github/dmca](https://github.com/github/dmca/blob/master/README.md))

---

## What gets filed here

Anything that arrives as a legal demand about this project's content, code,
name or data:

- cease and desist letters, including trademark demands
- DMCA takedown notices and counter-notices
- subpoenas, preservation letters, court orders, and national-security process
  to the extent disclosure is lawful
- formal removal requests from a company, a vendor, a police department, a
  municipality or a government body
- any request that a marker, a record, a screen or a repository file be removed
  or changed, made under an assertion of legal right

Together with, in each case, **whatever response was sent** and **whatever
actually changed** as a result.

**Not filed here:** security vulnerability reports, which are handled privately
until fixed under [`docs/public/SECURITY.md`](../docs/public/SECURITY.md); and
ordinary correspondence, bug reports, hate mail and press enquiries, which are
not legal demands.

**Not ours to act on:** a demand to delete a camera from *OpenStreetMap*. This
project reads OSM; it does not own the camera database. Such a demand is filed
here, and the fact that it was routed to
[OSMF's takedown procedure](https://wiki.osmfoundation.org/wiki/Takedown_procedure)
is published with it. Removing a marker locally while the upstream OSM object
still stands would put the app and the public database silently out of step,
which is the exact failure this archive exists to make impossible.

---

## Layout

```
transparency/
├── README.md          this file — the index, the count, the conventions
├── TEMPLATE.md        front matter + skeleton for a new entry
├── index.csv          one row per demand, machine-readable
└── YYYY/
    └── MM/
        ├── YYYY-MM-DD-<sender-slug>.md
        ├── YYYY-MM-DD-<sender-slug>-response.md
        ├── YYYY-MM-DD-<sender-slug>-counternotice.md
        ├── YYYY-MM-DD-<sender-slug>-reversal.md
        └── YYYY-MM-DD-<sender-slug>-outcome.md
```

The date directories are the **date of receipt**, not the date of publication.
A notice received on the 29th and published on the 30th lives in that month's
directory under the 29th.

### File naming

`YYYY-MM-DD-<sender-slug>[-suffix].md`

- **`YYYY-MM-DD`** — the date the demand was received.
- **`<sender-slug>`** — the sending organisation (not the law firm, not the
  individual signatory), lowercased, non-alphanumerics collapsed to single
  hyphens. `Flock Safety, Inc.` → `flock-safety`. A demand from a private
  individual uses `private-individual`, per the carve-out in
  [`TRANSPARENCY.md` §3.4](../docs/public/TRANSPARENCY.md).
- **Collisions.** Two demands from the same sender on the same day get `-2`,
  `-3`, appended to the slug: `2026-08-04-example-vendor-2.md`.

This convention is copied, not invented. It is what `github/dmca` has used
across fifteen years and tens of thousands of files — its August 2026 directory
contains entries named `2026-08-04-mojang.md` and `2026-08-04-cloudreve-2.md` —
and it is copied because it sorts chronologically, greps cleanly, and has
already survived the volume this archive will never reach.

### Suffixes

| Suffix | The file contains | Precedent |
|---|---|---|
| *(none)* | The incoming demand, verbatim | github/dmca |
| `-response` | What this project sent back, in full | [Signal](https://signal.org/bigbrother/), [Tor abuse templates](https://community.torproject.org/relay/community-resources/tor-abuse-templates/) |
| `-counternotice` | A third party disputing an action taken here | [github/dmca 2025/06](https://github.com/github/dmca/tree/master/2025/06) |
| `-reversal` | An action reversed — by us, or by the sender withdrawing | [github/dmca 2025/06](https://github.com/github/dmca/tree/master/2025/06) |
| `-outcome` | What changed in the app, the data or the repository, and the commit that changed it | added here |

Suffixes chain, in the order the events happened, exactly as github/dmca chains
them: `2026-08-04-example-vendor-counternotice-reversal.md`.

`-outcome` exists because this project is the *recipient* of demands rather than
an intermediary forwarding them. A marker that quietly disappears with no
`-outcome` file is indistinguishable from a marker that was never there, and the
whole point of the archive is to make that difference visible.

---

## Required front matter

Every file in `YYYY/MM/` opens with a YAML block. The keys are fixed. A missing
key is written as `unknown` and never omitted, because an omitted key reads as
an oversight and `unknown` reads as a fact.

| Key | Required | Value |
|---|---|---|
| `date_received` | yes | `YYYY-MM-DD`, the date it actually arrived |
| `date_published` | yes | `YYYY-MM-DD`, the date this file was committed |
| `sender` | yes | The organisation or person asserting the right. Never redacted for an organisation. |
| `represented_by` | yes | Law firm, or `self` |
| `type` | yes | One of: `cease-and-desist`, `dmca`, `trademark`, `subpoena`, `preservation`, `court-order`, `removal-request`, `other` |
| `theory` | yes | The legal basis asserted, with the statute where one is cited — e.g. `trademark dilution (15 U.S.C. 1125(c))` |
| `targets` | yes | What the demand names: URLs, OSM object IDs, repository paths, app screens. `[invalid]` in this list marks a target that was not present or not ours. |
| `deadline_asserted` | yes | `YYYY-MM-DD`, or `none` |
| `confidentiality_requested` | yes | `yes` / `no`. A private party's request for confidentiality does not bind this project; the request itself is published. A lawful gag is recorded as `court-ordered` and its scope described to the extent permitted. |
| `response` | yes | Relative path to the `-response` file, or `none sent` |
| `outcome` | yes | Relative path to the `-outcome` file, or `no change` |
| `complied` | yes | `yes` / `partial` / `no` / `pending`. Stated plainly. Complying with a demand is not shameful; concealing that you complied is. |
| `lumen_url` | yes | The Lumen Database URL for the mirrored copy, or `pending`, or `not eligible` with a reason |
| `counsel` | yes | Who advised, if anyone — e.g. `EFF`, or `none` |
| `example` | **only on examples** | `true`. Real notices must never carry this key. Any file carrying `example: true` is a specimen and describes nothing that happened. |

---

## Redaction markers

Three markers, used inline in the body text where material was removed.

| Marker | Means |
|---|---|
| `[private]` | Personal contact details of a natural person, or third-party personal data the sender chose to include — a licence plate, a subscriber record, an IP address, a home address, a signature image |
| `[invalid]` | A URL, OSM object ID or marker named in the demand that was not present, was already gone, or was not this project's to act on |
| `[sealed]` | Material a court has actually sealed. Named as sealed, never silently dropped. |

`[private]` and `[invalid]` mean different things and are never used
interchangeably — `[invalid]` distinguishes *"we declined"* from *"there was
nothing there"*. This is github/dmca's convention, and its README records that
it overloaded `[private]` for both purposes until March 2021, which is precisely
the ambiguity worth avoiding.

**Never redacted:** the sending organisation, the law firm, the named attorney's
professional identity, the client, the legal theory, the statutes cited, the
remedy demanded, the deadline, the targets at issue, and the response sent. A
demand on a law firm's letterhead is a professional act performed for a client,
not private correspondence. The full rule, including the single narrow carve-out
for a private individual asserting a personal-safety concern, is
[`TRANSPARENCY.md` §3](../docs/public/TRANSPARENCY.md).

---

## Worked example

**Everything in the block below is fictional. No such notice has been received.
No such company, firm or person exists.** It is here so that the first real
notice has a format to follow instead of a format to invent, and so a reader can
see what an entry will look like before there is one to look at.

It is deliberately **not** stored as a file under `YYYY/MM/`, because a specimen
sitting in the archive directory is a specimen that will eventually be quoted as
a real event. The archive contains real notices only. Today it contains none.

The example uses [RFC 2606](https://www.rfc-editor.org/rfc/rfc2606) reserved
`example.com` addressing and an impossible receipt date of `0000-00-00`, so that
no fragment of it can be mistaken for a record even out of context.

Filename it demonstrates: `transparency/YYYY/MM/YYYY-MM-DD-example-vendor.md`

````markdown
---
example: true
date_received: 0000-00-00
date_published: 0000-00-00
sender: EXAMPLE VENDOR, INC. — FICTIONAL, FOR FORMAT ONLY
represented_by: EXAMPLE & PARTNERS LLP — FICTIONAL
type: cease-and-desist
theory: trademark dilution (15 U.S.C. 1125(c)); false advertising (15 U.S.C. 1125(a))
targets: >
  the project name and wordmark; the marker layer at /map;
  https://example.com/not-a-real-url [invalid]
deadline_asserted: 0000-00-00
confidentiality_requested: yes
response: ./0000-00-00-example-vendor-response.md
outcome: ./0000-00-00-example-vendor-outcome.md
complied: no
lumen_url: pending
counsel: none
---

# ⚠ EXAMPLE ONLY — NOT A REAL NOTICE ⚠

**This file is a formatting specimen. Nothing described in it happened. The
sender, the firm, the attorney and the URLs are fictional.**

# EXAMPLE VENDOR, INC. — cease-and-desist, 0000-00-00

**This notice is published because it was received on the date above. That is
all its presence here means.** It is not evidence that the claim has merit, and
it is not evidence that it does not. See
[`docs/public/TRANSPARENCY.md`](../docs/public/TRANSPARENCY.md).

Redactions below use `[private]` for personal contact details of natural persons
and for third-party personal data the sender included, `[invalid]` for targets
that were not present or not ours to act on, and `[sealed]` where a court has
sealed material. Nothing else is removed.

---

## The demand, verbatim

> EXAMPLE & PARTNERS LLP
> 1 Example Plaza, Suite 000
> Example City
> [private]
>
> VIA ELECTRONIC MAIL
>
> Re: Unauthorised use of the EXAMPLEVENDOR marks
>
> Dear Sir or Madam:
>
> This firm represents Example Vendor, Inc. ("Example Vendor"). It has come to
> our client's attention that you operate a mobile application which uses the
> EXAMPLEVENDOR mark and which publishes the locations of our client's
> equipment.
>
> 1. Cease and desist all use of the name "EXAMPLEVENDOR" or any variation
>    thereof.
> 2. Remove all markers identifying our client's devices, including those at
>    https://example.com/not-a-real-url [invalid].
> 3. Confirm compliance in writing by 0000-00-00.
>
> Our client considers the foregoing use to dilute its famous mark by blurring
> and by tarnishment under 15 U.S.C. § 1125(c), and to constitute false
> advertising under 15 U.S.C. § 1125(a).
>
> This letter is confidential and is not for publication.
>
> Very truly yours,
>
> A. Attorney
> Partner, Example & Partners LLP
> [private]

---

## Notes on processing

Factual annotations only. Argument belongs in the `-response` file.

- Received by email at the address published in `docs/public/SECURITY.md`.
- Target 3 in the letter's list was marked `[invalid]`: the URL named is not a
  URL this project serves and never has been.
- The sender's confidentiality request is recorded in the front matter and was
  not honoured. A private party cannot impose a publication ban by asking for
  one; the request itself is part of the record. See
  [`TRANSPARENCY.md` §5](../docs/public/TRANSPARENCY.md).
- Personal contact details of the signing attorney and the firm's direct line
  were replaced with `[private]`. The firm, the named attorney's professional
  identity, the client, the theory, the statutes and the deadline were not
  redacted, and will never be.
- No camera records were removed. Camera data originates in OpenStreetMap and is
  not this project's to delete; see the OSMF routing note in this README.
- Mirrored to the Lumen Database on 0000-00-00.

**⚠ END OF EXAMPLE. Nothing above occurred. ⚠**
````

---

## `index.csv`

One row per demand, so the archive can be counted without being read. Header:

```
date_received,sender,represented_by,type,theory,targets,complied,response,outcome,lumen_url,files
```

The file carries its header row today with no data rows beneath it. An empty
table with a header is a schema; an absent file is an intention.

---

## Mirrors

Every entry is also submitted to the
[Lumen Database](https://lumendatabase.org/) at Harvard Law School Library — a
research project that has collected legal complaints about online content since
2002 and now holds tens of millions of notices. `github/dmca` names Lumen as its
own model.

This is the single most important step in the whole procedure, because every
other step assumes this repository still exists, this account is still live, and
this host still serves it. A record that only lives where the pressure lands is
not a record.

*Verification note: Lumen's own published redaction policy could not be
confirmed at the time of writing — the FAQ and privacy pages did not resolve.
What Lumen does with submitter details should be checked directly before the
first submission rather than assumed from this file.*

---

## Contributions are not accepted

**Pull requests against this directory are refused.** It is a record of what was
received, not a wiki, and a record anyone can append to is not a record. This
mirrors github/dmca, whose README says the same thing more loudly: *"If you are
looking to file or dispute a takedown notice by posting to this repository,
please STOP 🛑 because we do not accept Pull Requests."*

Corrections — a transcription error, a broken link, a wrong date — go through an
issue and are made as commits by a maintainer, so the correction is itself in
the history.

---

## Sending a notice to this project

Use the address published in
[`docs/public/SECURITY.md`](../docs/public/SECURITY.md). It will be
acknowledged, it will be read, it will be answered — and it will be published
here, in full, within seven days of receipt, before any decision is made about
whether to comply. That is not a threat and it is not a negotiating position. It
is the only thing that makes the rest of this project's claims checkable, and it
is not available to be traded away.
