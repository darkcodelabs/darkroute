# Credits

DarkRoute is late to this. The map it warns you with, the tag scheme that makes
that map readable, and most of what is publicly known about how ALPR networks
actually operate were all produced by other people, mostly unpaid, over several
years. This file names them.

It is not a courtesy list. Two of these projects are direct upstream
dependencies, one of them supplies every camera in the app, and several are
doing work this app deliberately does not attempt.

## Where the data comes from

**OpenStreetMap contributors** - every ALPR node the app holds. Licensed
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/), which attaches to this
project too: the attribution string travels in the body of every tile and every
published extract. See `scripts/fetch-cameras.mjs`.

**[DeFlock](https://deflock.org)** - the reason there is anything to fetch.
DeFlock established ALPR mapping on OSM as a practice and, critically, settled
the **tagging taxonomy** that makes the data queryable at all:
`man_made=surveillance` + `surveillance:type=ALPR`, with `direction`,
`camera:mount` and `manufacturer` beside it. Roughly 147,000 objects now carry
that scheme. DarkRoute reads it unchanged. The write-back tag builder is built
and tested but is not wired to OpenStreetMap yet; if it is wired, it will use
the same vocabulary because a second one would fragment the corpus and help
nobody.

DeFlock also declined to become a routing app, and said why: maintaining a
routing engine is a different problem from maintaining a database. That was the
correct call and this project benefits from it.

## Routing, which several people got to first

**[Drivers Against Flock](https://driversagainstflock.com)** - turn-by-turn
navigation with no account, no tracker and no trip history, built for
glanceability at speed, with Android Auto and CarPlay. The interface discipline
here - oversized type, high contrast, calm heads-up warnings instead of alarms -
is a standard worth measuring against.

**FlockHopper** - two routes per trip, fastest and quieter, with self-hosted
tiles and a proxied geocoder so the user is not handed to a third party in the
process of avoiding surveillance.

**FlockDetour** - the "honest tradeoff": minutes added and readers avoided,
shown side by side before the drive rather than buried in settings. Their
documented sample - 1.4 miles past eight cameras versus 3.5 miles past none, for
about five minutes - is the clearest statement of the actual trade anyone has
published. Also: staged verification of user reports, to keep the database from
filling with false positives.

## Discovery by other means

**[Flock Finder](https://github.com/SimeonOnSecurity)** - a genuinely different
approach. Flock cameras wake to upload and broadcast WiFi frames while they do;
the first three bytes of the MAC identify the manufacturer. Cross-referencing 31
known Flock OUI prefixes against [WiGLE](https://wigle.net)'s crowdsourced
database has plotted 40,000+ suspected cameras across 109 countries, with no
volunteer having to see any of them. The project also publishes ESP32 detector
firmware for live in-vehicle detection.

**WiGLE** - the wardriving corpus that makes the above possible.

## Auditing: what was already done to you

**[Have I Been Flocked?](https://haveibeenflocked.com)** - 243 million searches
recovered by FOIA, normalised, searchable by plate, with the query discarded
rather than stored. Its First Amendment and Immigration reports isolate searches
justified by reference to protests, religious gatherings, journalism or
immigration status. This is the only project on the list that tells you what has
already happened, and it is the one that most changes what people think ALPRs
are for.

**[Eyes on Flock](https://eyesonflock.com)** - aggregates Flock's own
transparency portals, which are real but scattered one municipality at a time,
into something a researcher can compare across jurisdictions.

**[Atlas of Surveillance](https://atlasofsurveillance.org)** (Electronic
Frontier Foundation) - the macro view: ALPRs alongside body cams, drones,
cell-site simulators and real-time crime centres, built from procurement records,
council minutes and FOIA.

**[Surveillance Watch](https://surveillancewatch.io)** - maps the vendors rather
than the cameras: funding, ownership, contracts.

**Footnote4a** - investigative reporting on contracts, court tests and Fourth
Amendment questions.

**Benn Jordan and 404 Media** - demonstrated that numerous public-safety camera
systems were reachable on the open internet without meaningful authentication,
including historical footage with deletion rights.

## Policy and organising

**[Plate Privacy Project](https://plateprivacy.com)** (Institute for Justice) -
140+ documented abuse cases, litigation, and model retention legislation.

**[ALPR Watch](https://alprwatch.org)** - scrapes council agendas for "Flock",
"ALPR", "Vigilant", so people can show up to the meeting *before* a multi-year
contract is signed quietly.

**StopFlock / BanFlock** - the economic argument. Their Champaign, Illinois work
(over $1.15M for 62 ALPRs; 26% of "solved" crimes gun-related; neighbouring
Urbana refused the cameras and saw a larger drop in gun violence) is the kind of
evidence that actually moves a council.

**ACLU** - the "Get the Flock Out" toolkit.

**Fight for the Future** - the Flock Out Zine and organising material.

**Rural Privacy Network** - small-city organising, which the national toolkits
mostly do not address.

## Regional

**Are You Flocked** (Olathe / Johnson County, Kansas), **Eyes Off Indiana**
(nightly-refreshed, 92-county ranking), **flockcameralocations.com**. Local
projects consistently hold detail the national ones do not, because somebody
lives there.

---

## What DarkRoute deliberately does not do

Stated here so the boundary is legible rather than implied:

- **It does not fork the taxonomy.** DeFlock's tag scheme is the tag scheme.
- **It does not re-host anyone's data.** Cameras come from OSM under ODbL.
- **It does not audit past searches.** That is Have I Been Flocked?, and doing it
  badly beside it would be worse than not doing it.
- **It does not scrape transparency portals.** Eyes on Flock does that.
- **It does not tell you to obscure a plate.** Route choice is legal in all fifty
  states; plate flippers and reflective sprays are not, and FlockDetour is right
  to say so plainly.

If a project here wants attribution changed, removed, or corrected, that is a
one-line change and it will be made on request.
