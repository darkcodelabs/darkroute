# Reporting a vulnerability

Including privacy leaks, which count here.

This file is the public-facing policy. `.github/SECURITY.md` carries the same
contact details and exists so GitHub's UI finds it; if the two disagree, this
one is authoritative and the other is a bug.

---

## 0. What counts as a vulnerability in this project

Most projects define a vulnerability as something that lets an attacker take
over a machine. That definition is too narrow here and would cause real reports
to be triaged as feature requests.

DarkRoute exists so that a driver can find out where ALPR cameras are without
producing a record of having asked. **The asset is the user's movements.** So a
vulnerability in this project is anything that causes, or makes it possible to
infer, the following leaving the device or becoming visible to someone who
should not see it:

- current or historical position, or the route taken
- which cameras were looked at, alerted on, or avoided
- anything entered into a watchlist, including plates
- report history, alert history, or timing patterns that reveal any of the above
- the fact that this app is installed or running, where that fact is not
  necessary to render a map

**A privacy leak is a security bug here and is triaged as one.** A pull request
that adds analytics, a crash reporter, a font CDN, a remote error sink, or any
outbound request carrying a coordinate is a vulnerability, not a feature, and
reporting one is welcome.

This is a deliberate scope widening. Compare a conventional policy: SecureDrop's
is two sentences and a GPG fingerprint
([`SECURITY.md`](https://github.com/freedomofpress/securedrop/blob/develop/SECURITY.md)),
Tailscale's is one paragraph
([`SECURITY.md`](https://github.com/tailscale/tailscale/blob/main/SECURITY.md)).
Both are correct for what they are. Neither would tell a researcher that a
telemetry endpoint is in scope, and here it is the single most likely defect.

---

## 1. How to report

**Do not open a public issue.** Not because disclosure is unwelcome, but because
a movement-tracking leak is exploitable in the window between the issue being
filed and the fix shipping, and the people it is exploitable against are the
people this app is for.

Use, in order of preference:

1. **GitHub private vulnerability reporting** — the repository's **Security**
   tab → **Report a vulnerability**. This is the fastest route and creates a
   private advisory thread.
2. **Email** — [`cory@darkcode.ai`](mailto:cory@darkcode.ai), as published at
   [`https://darkroute.ai/.well-known/security.txt`](https://darkroute.ai/.well-known/security.txt),
   per [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116.txt). Encrypt to the
   key with full fingerprint
   `1833 C305 17BD 656D BFA6 1418 2388 27E9 13E5 D960`. The public key is
   committed at `apps/pwa/public/.well-known/security-key.asc`; if the deployed
   and repository copies differ, treat both as compromised and say so publicly.

Include: what you did, what happened, what you expected, the affected build
(the app's **How this works** screen shows the commit it was built from), and —
if it is a leak — the exact request, storage key, or log line that carries the
data.

You may report anonymously. Nothing here requires you to identify yourself, and
credit in the advisory is offered, not assumed.

---

## 2. Scope

### In scope

| Surface | Examples of what we want to hear about |
|---|---|
| The PWA bundle | XSS, prototype pollution, dependency compromise, any outbound request not documented in [`API.md`](./API.md) |
| Service worker and caches | Cached responses that reveal browsing or route history; a cache that survives "remove my data" |
| IndexedDB / local stores | Plates, watchlists, reports or alert history readable by another origin, another app, or a forensic tool after deletion |
| Tile request patterns | Anything that narrows the user's position below the documented granularity. Tile addresses are computed on-device and a z11 tile is roughly 15 km across; a change that makes requests finer, ordered, or timed in a way that reconstructs a route is a bug |
| Cloudflare Functions | The camera proxy and the Access-gated tester endpoints — auth bypass, IP or identity logging, cache keys carrying user data |
| Meshtastic / Web Bluetooth / LoRa | Anything that makes a node, a device, or a person identifiable or locatable beyond what the Meshtastic protocol already does; anything that writes a persistent identifier to a radio |
| Build and release | A published bundle that does not correspond to the published commit; a compromised dependency; a workflow that could inject code |
| The published camera archive | Anything that makes *readers* of the data identifiable |

### Explicitly out of scope, and this boundary is not negotiable

**Vulnerabilities in ALPR cameras, in Flock Safety's systems, in any vendor's
systems, or in any third party's networks.** This project does not want those
reports, will not accept them, will not forward them, and will not act on them.
They will be deleted unread where that is possible.

This is stated bluntly for two reasons. First, it is a legal boundary: probing
someone else's systems is a different activity from mapping publicly visible
hardware, and conflating the two would import risk this project has no reason to
carry. Second, it is already being conflated *for* us — a Wisconsin/Northeast
Florida fusion centre bulletin obtained by 404 Media records a June 2026 traffic
stop in which police noted that a driver "is actively involved in the DeFlock
movement and has written software … to scan and locate vulnerabilities in
internet connected devices."
([404 Media, Aug 2026](https://www.404media.co/the-government-is-monitoring-anti-flock-tiktok-and-instagram-accounts/))
Keeping that class of report out of this project's inbox is the only way the
distinction stays legible.

Also out of scope: physical interference with cameras or their mountings;
anything about obscuring, covering or altering a licence plate; social
engineering of maintainers; volumetric denial of service; and reports whose only
content is a scanner's output with no analysis.

---

## 3. What happens next

| Stage | Commitment |
|---|---|
| Acknowledgement | 48 hours |
| Initial assessment, with a severity call and a plan | 5 business days |
| Fix for a confirmed leak of user movement data | Prioritised above all other work |
| Fix for other confirmed issues | 14 business days, or a published reason why not |
| Public advisory | On fix, or at 90 days from report, whichever is first |

The 90-day ceiling exists so that this policy cannot become an indefinite gag.
If a fix is not ready at 90 days, the advisory is published anyway, saying so.
A reporter who publishes at 90 days has not violated anything.

### The extra commitment that this project owes and most do not

**If a defect caused user movement data to leave devices, we tell users, and we
publish a post-mortem.** A fix does not undo a leak that already happened; a
person whose routes were exposed needs to know in order to make their own
decisions. The post-mortem states what leaked, over what period, where it went,
how many builds were affected, and what changed so it cannot recur. It is
published in the repository and surfaced in the app's **How this works** screen.

That obligation is not conditional on the leak being exploited, being reported
publicly, or being legally required to disclose.

---

## 4. Safe harbour, and its honest limits

Security and privacy research conducted in good faith against **this project's
own code, builds and infrastructure** is authorised. We will not pursue legal
action, and we will not report you, for research that:

- targets only assets listed as in scope above,
- avoids accessing, modifying or retaining other people's data — if you
  encounter any, stop and tell us,
- avoids degrading service for others,
- gives us the window in section 3 before public disclosure.

**The limits, stated because a safe harbour that overstates itself is worse than
none:**

- This authorisation binds **this project only**. It cannot and does not waive
  the rights of Cloudflare, GitHub, npm, OpenStreetMap, a mobile OS vendor, an
  app store, or any other third party whose terms you may also be subject to.
- It is **not** immunity from the Computer Fraud and Abuse Act, from any state
  computer-crime statute, or from any other law. No private party can grant
  that. It is a statement of what we will do, not a statement of what a
  prosecutor will do.
- It does **not** extend to any system this project does not operate. See the
  out-of-scope boundary in section 2, which is the same sentence twice on
  purpose.

If you are unsure whether something is in scope, ask first. Asking is free.

---

## 5. Supported versions

Only the current release. This is a single-maintainer project and any other
claim would be false; a hostile reader is right to treat a support matrix listing
five branches as evidence that nobody has thought about it.

The app displays the commit it was built from on the **How this works** screen.
That commit, not a version string, is the thing to quote in a report.

---

## 6. What this file does not cover

- **Legal demands** — takedown notices, cease and desists, subpoenas. Those are
  [`TRANSPARENCY.md`](./TRANSPARENCY.md), and they are published on receipt
  rather than handled privately.
- **The legal position** of the project — [`LEGAL.md`](./LEGAL.md).
- **What the app protects you from and what it does not** —
  [`THREAT-MODEL.md`](./THREAT-MODEL.md). A report that something is not
  protected when the threat model already says so is not a vulnerability; a
  report that the threat model is *wrong* very much is.
