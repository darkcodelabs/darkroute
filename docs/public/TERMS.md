# Terms of use

Last changed with the commit that carries this file. There is no separate
version number and no "effective date" you have to take on trust: this document
lives in the repository, and `git log docs/public/TERMS.md` is its complete
history. If it changes, the diff is public before you are asked to live with it.

**Written by the people who build DarkRoute. Not written by a lawyer, and not
reviewed by one.** That is stated up front because the rest of this project
refuses to imply an authority it does not have, and a terms page is the easiest
place in a product to quietly do exactly that.

## 1. What you are agreeing to, in one paragraph

DarkRoute is a free map of automatic licence plate readers, and a router that
tries to plan around them. You may use it for anything lawful. It collects
nothing about you, so there is no account to close and nothing to delete. It
comes with no warranty of any kind, its data is frequently wrong in ways this
page describes, and you remain entirely responsible for how you drive. If that
is not acceptable, do not use it.

Everything below is that paragraph, in detail, with the uncomfortable parts
first.

## 2. the data is wrong, and here is how

This is the section that matters most, and it is deliberately not at the bottom.

Every camera on this map is a claim somebody made in OpenStreetMap. Not a
sensor reading, not a government register, a volunteer placed a point and
tagged it. Most are right. Some are not. A camera can have been removed last
month, moved across the junction, or never have existed.

The archive on your phone has an age, and it may be old. DarkRoute rebuilds
from OpenStreetMap's replication stream on a schedule, and that schedule can
stop, it has, for six days at a stretch, without anybody noticing. The app
shows the age of the archive it is holding next to the camera count. If that
reading says the data is days old, believe it.

Absence of a camera means nothing. Roughly four fifths of the archive
carries no operator information at all, so "no reader shown here" is a statement
about our data and never a statement about the road. Drive as though there is
one.

The ownership labels are inferred, not verified. "Police / agency", "HOA",
"unverified" and the rest come from pattern-matching a free-text field. They are
a useful hint and they are not a finding of fact about who operates anything.

A planned detour is a set of points to prefer, not a cleared road. The app
has no road graph on the device. It can tell you a reader is ahead and suggest
somewhere else to aim; it cannot promise the route is driveable, legal in every
turn, or actually free of readers. It says so on the screen where you use it.

If any of that is a problem for what you are trying to do, this is the wrong
tool and no configuration will change it.

## 3. What you are responsible for

How you drive. Every road rule where you are still applies. DarkRoute
suggests places to go; it does not drive, and choosing a different legal route on
a public road is the only thing it is for. Nothing in this app is permission to
do anything you could not otherwise do.

What you do with the data. The archive is published so it can be checked and
reused. If you take it and build something, the licence in
[LEGAL](./LEGAL.md#5-licensing-each-licence-follows-its-work) follows it, and
what you do with it is yours.

What you submit. See §5.

Not looking at the screen while moving. Obvious, and stated anyway, because
an app that warns you about something ahead is an app that invites a glance at
exactly the wrong moment. The alerts are built to be understood without reading.

## 4. What this project does with you: nothing

There is no account, no login, no analytics, no crash reporter, no advertising
identifier, and no third-party script. The network policy is enforced by the
browser instead of by our good intentions, the Content-Security-Policy admits
two origins, and it is tight enough that Cloudflare's own beacon fails against
it on every page load.

Three things do leave your device, and all three are described in
[TRANSPARENCY](./TRANSPARENCY.md) with more detail than this page has room for:

- Basemap tiles are fetched by HTTP range request, which reveals roughly
  where you are looking to the host serving them. This is a real trade and the
  app names it on its own transparency screen instead of burying it here.
- A report you choose to submit, and only when you choose. See §5.
- A route you ask to hand off to a maps app, and only after the app has shown
  you exactly what would be sent and you have approved it that time. There is no
  "don't ask again", on purpose.

Camera data is fetched by tile address computed on your phone. The origin learns
that somebody wanted a particular square of the country, identical for every
driver in it, and never a coordinate.

**We cannot produce your data in response to a legal demand, because we do not
have it.** What we would publish if one arrived is in
[TRANSPARENCY](./TRANSPARENCY.md).

## 5. If you submit a report

Submitting is optional and nothing is sent until you approve a receipt showing
exactly what will go.

Where it goes. A report becomes a public pull request against the public
repository. It is reviewable, attributable to the submission instead of to you,
and nothing merges automatically.

What you are granting. By submitting, you confirm you observed what you are
reporting and you grant this project the right to publish it and to contribute
it onward to OpenStreetMap under
[ODbL-1.0](https://opendatacommons.org/licenses/odbl/1-0/). That grant is
necessary: OpenStreetMap requires whoever makes an edit to have the right to
license it, and DarkRoute makes the edit so that you do not need an account
there and your editing history never becomes public.

Do not submit anything that identifies a person. Not a plate, not a face, not
a name, not somebody's home as a landmark. A camera on a pole is infrastructure;
the people near it are not, and a report that carries them will be rejected.

A photo stays in the repository. OpenStreetMap does not host images, so a
picture you attach travels with the pull request and is not sent onward.

## 6. No warranty, and the limit of what we owe you

This software and its data are provided **as is**, without warranty of any kind,
express or implied, including any warranty of merchantability, fitness for a
particular purpose, accuracy, or non-infringement.

To the fullest extent the law where you are allows, the people who build
DarkRoute are not liable for any loss, damage, citation, penalty, injury or
other consequence arising from using it or relying on it, including where the
data was wrong, stale, missing, or right in a way that was still not enough.

This is a free tool given away with its source. There is no fee, no support
obligation, no service level and no promise it will exist next year. The code
licence at [LEGAL §5.1](./LEGAL.md#51-the-code-gpl-30-only) carries the same
disclaimer in the terms the GPL states it, and nothing on this page reduces the
rights that licence grants you.

Some jurisdictions do not allow exclusions like these. Where that is so, this
section applies as far as it lawfully can and no further.

## 7. What this project will not do

Committed to in [LEGAL §4](./LEGAL.md#4-what-this-project-will-not-do) and
repeated here because it is part of what you are agreeing to rely on:

- It will not identify, track or publish anything about a person.
- It will not accept plate data, and there is nowhere in the app to enter one.
- It will not become a police-location app. Roadwork and closures are a layer;
  officers are not, and will not be.
- It will not add analytics, an account system, or a tracker, under any
  commercial pressure to do so.

## 8. Ending it

Stop using it. There is nothing to cancel and no data of yours to remove,
because there was never any. Clearing your browser's storage for the site
removes the archive and any settings, all of which were only ever on your
device.

We may change or withdraw the hosted app at any time. The source and the data
are public and licensed so that it can be run by somebody else if we stop.

## 9. Reaching a human

`hello@darkroute.ai`, for anything on this page, a takedown, a correction, or a
legal question.

Security issues have their own route and their own commitments in
[SECURITY](./SECURITY.md). Please use that one instead of this address.

## 10. What else to read

| document | what it answers |
| --- | --- |
| [THREAT-MODEL](./THREAT-MODEL.md) | what this protects you from, and where the answer is "it does not" |
| [TRANSPARENCY](./TRANSPARENCY.md) | everything that leaves the device, and what a legal demand would produce |
| [LEGAL](./LEGAL.md) | the legal position, the licensing, and what has actually happened to projects like this |
| [DATA-PROVENANCE](./DATA-PROVENANCE.md) | where the camera data comes from and how to rebuild it |
| [AUDITING](./AUDITING.md) | the commands that let you check all of the above instead of believing it |
