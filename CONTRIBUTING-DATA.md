# Sharing data with DarkRoute

You have cameras you have mapped, a drive log, or a set of observations, and
you want them to end up somewhere useful. Here is how, and, more importantly  -
here is where they should probably go instead of here.

## Read this first: most data belongs in OpenStreetMap, not in a pull request

If what you have is camera locations, the best place for them is
OpenStreetMap. We want them; the trouble is that putting them there
is strictly better for you and for everyone else:

- Everyone gets them. DarkRoute's archive is built from OSM. So is
  [DeFlock](https://deflock.me), and so is every project that comes after us. A
  camera you add to OSM reaches all of them. A camera you send only to us
  reaches only our users, and only until we stop maintaining this.
- It is attributable to you, permanently, under your own account.
- It outlives this project. If DarkRoute disappears tomorrow, an OSM node
  is still there.

Tag it as:

```
man_made=surveillance
surveillance:type=ALPR
```

plus `operator=*`, `manufacturer=*` and `camera:direction=*` where you know
them. [DeFlock's app](https://deflock.me) is a good way to do this from a
phone while you are standing in front of one.

We will pull it into the archive automatically within the hour. You do not
need to tell us.

## What actually belongs here

Things OpenStreetMap will not take, or that are about this project rather than
about the map:

| What | Where it goes |
|---|---|
| Documented misuse: an audit, a news report, a court filing about an agency abusing ALPR | `scripts/data/` misuse records, see below |
| A correction to our data: a camera we show that is gone, or misattributed | An issue, with the camera id from the app |
| Bulk observations that are not individually verifiable enough for OSM | A PR, clearly marked as unverified |
| Coverage gaps: a corridor you know is covered but the map is empty | An issue. This is useful; empty ≠ absent |

### Misuse records

The highest-value contribution and the hardest to gather. One row per county,
and every row must cite a source a stranger can open. Format:

```json
{
  "fips": "20091",
  "agency": "Example Police Department",
  "incidents": 2,
  "year": 2026,
  "sourceName": "Outlet name, 27 July 2026",
  "sourceUrl": "https://...",
  "summary": "One or two sentences. What was found, by whom, and what the finding was."
}
```

Rules, and they are not negotiable:

- A source URL is required. A record without one is an assertion, and the
  entire point of this set is that it is checkable. Uncited rows are counted
  and reported by the API precisely so they cannot hide.
- Primary sources beat aggregators. An audit document beats a news story
  about the audit; a news story beats a forum post.
- Summarise, do not editorialise. Say what was found. The reader does the
  outrage.
- No allegations without a finding. "Was accused of" is not "an audit
  found". If it is unresolved, say so in the summary or leave it out.

## Why there is no upload button

This app has no endpoint that accepts your data, and that is deliberate rather
than unfinished.

An anonymous write endpoint on a public archive is a way to put unattributable
claims into a dataset whose only real value is that every row can be traced
back to something. The moment we accept data nobody has to sign, the archive
becomes as trustworthy as the least careful person who found the URL, and we
would have no way to tell which rows those were.

A pull request is the same contribution, made in public: attributable,
reviewable by people who are not us, and visible while it is being decided.

The cost is a GitHub account, which is a real barrier. We think it is the right
one to accept, because the alternative is a submission queue that nobody
outside this project can audit. If that barrier is the thing stopping you, open
an issue and say so, that is useful feedback about a real trade-off, not a
complaint.

Your own reports never leave your phone. Reports you file in the app are
signed and hash-chained into local storage and are not uploaded anywhere. That
is not going to change quietly.

## Licensing

Camera and map data here is ODbL-1.0, from OpenStreetMap. The code is
GPL-3.0.

By opening a PR you are confirming that:

- You have the right to contribute what you are contributing.
- It is not copied from a source whose terms forbid redistribution. This rules
  out more than people expect, commercial camera databases, wardriving
  datasets like WiGLE (whose terms prohibit distributing the data "in its
  entirety or in any part", regardless of whether money changes hands), and
  scraped feeds from apps whose ToS forbid it.
- You are fine with it being republished under the licences above.

**If you are not sure whether a source permits this, ask before you open the
PR.** It is much easier to answer beforehand than to unpick afterwards, and
"not selling it" is not the same as "allowed to redistribute it".

## Practical steps

1. Fork the repository.
2. Put your data in the right place: misuse records in `scripts/data/`,
   anything else in an issue first so we can tell you where it goes.
3. One logical contribution per PR. Twelve counties in one PR is fine; twelve
   counties plus a code change is not.
4. In the PR description, say where the data came from and **how you
   verified it**. That is the part a reviewer actually needs.

Corrections to existing rows are as welcome as additions. If we have something
wrong, saying so is a contribution.
