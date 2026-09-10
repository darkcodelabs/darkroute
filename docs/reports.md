# Reports, news and EFF Atlas

The map's **Reports** button opens the existing menu and its three abuse
alert controls. **Read reports** opens a full Reports page with **Abuse** first
and selected by default, followed by **News**. Existing News shortcuts open
the News tab. The cases-only filter remains available within the Abuse tab;
**All** restores recent reporting and Atlas context. Camera alerts continue to
use the full camera dataset, and the existing settings remain available.

## Shared production data

| Data | Public interface | Refresh behavior |
| --- | --- | --- |
| ALPR news | `/api/v1/news` | Collected four times daily; published independently of app builds. |
| Documented abuse | `/api/v1/abuse` | Reads the same cited county archive as the app; includes its generation date. |
| EFF Atlas | `/api/v1/atlas` | Checked daily; reads the same published county snapshot as the app. |
| Atlas offline snapshot | `/records/atlas-counties.json` | Current published snapshot, with the packaged file as an initial fallback. |

Abuse and Atlas API calls accept an optional five-digit `fips` county code.
Camera records expose their existing county code for this join. An Atlas entry
documents that an agency operates ALPR technology; it does not establish who
owns an individual camera, inter-agency sharing, or misconduct.

The app and public API console use these production sources. Refreshing the
Atlas runs the existing county builder; it does not maintain a second agency
database. Public article headlines and links are automatically published, but
they do not become confirmed case records or camera ownership claims.

## Reading freshness

News reports the last collection attempt and whether coverage was complete,
partial or unavailable. An upstream failure retains the previous articles and
their dates. A headline's **Seen** date is the collector's observation date.

Atlas distinguishes when its CSV was retrieved (`fetchedAt`) from when the
source was last checked (`checkedAt`). Neither date claims to be the date EFF
last investigated an agency. Failed checks leave the last valid publication
intact. Unknown county coverage is not evidence that an agency has no cameras.

Connected app screens refresh shared data without sending a location, search
query, visitor identifier or browsing history. Offline screens use available
cached records and retain their original timestamps. Schedules cannot guarantee
upstream completeness; the dates and coverage fields remain visible for that
reason.
