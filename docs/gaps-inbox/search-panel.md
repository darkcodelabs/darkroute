# gap inbox -- THE SEARCH ENTRY PANEL

Files: `apps/pwa/src/features/search/{SearchPanel.tsx,panel.ts,places.ts,searchPanel.css}`
plus their four test files; `features/chrome/{TopBar.tsx,topBarLive.css,icons.tsx}`;
new `--dr-*` in `styles/tokens.css`.

Source read: `DarkRoute Search Entry.html` (sections A-F and THE SIX TYPES) and
`DarkRoute Landscape Mode.html` (A4 and A5), both OPENED IN CHROMIUM at real
size and measured with `getBoundingClientRect()` / `getComputedStyle()` rather
than read off their prose. Backing code read before writing anything:
`features/chrome/TopBar.tsx` and its stylesheets, `features/lookup/search.ts`,
`services/route/{planRoute.ts,darkRoute.ts,corridor.ts}`, `stores/route.ts`,
`stores/history.ts`, `services/db/schema.ts`, `features/dock/ExpandedPanel.tsx`.

Everything below is a thing the design does not settle, settles twice, or
settles against itself. Nothing here was invented in the code; where a decision
had to be made to ship, the decision and its reasoning are stated.

## 1. TWO ARITHMETIC SLIPS IN THE SPEC, AND THEY ARE THE SAME SLIP TWICE

**F. GEOMETRY publishes `portrait panel 366 x 470`; the document draws 364 x 470.**
The panel declares no width -- `left: 12; right: 12; bottom: 12; height: 470` --
and its containing block is the mock phone's PADDING box. The phone is drawn
`390 x 620` border-box with a `1px solid rgb(38,45,54)` bezel, so the inside is
388 and `388 - 12 - 12 = 364`. On a real 390pt viewport with no bezel the same
declaration yields 366.

**Identically: `landscape panel 336 x 418`; the document draws 336 x 416.** The
landscape panel declares `left: 68; top: 8; bottom: 8; width: 336`. Its frame is
`940 x 434` border-box with the same 1px bezel, so `432 - 8 - 8 = 416` and the
chip's 418 is `434 - 16`.

Both chips subtract the insets from the BORDER box instead of the padding box.
**The chips are right for the device and the drawings are right for the mock.**

Built as: the panel declares NO width in portrait and NO height in landscape.
The insets are the design and the size follows the phone -- which is the only
spelling that is correct in both. Verified in Chromium at 390x620 and 940x434:
366 x 470 and 336 x 418 respectively.

**Ask:** correct the two captions, or accept that the two frames are drawn 2px
small.

## 2. THE LANDSCAPE BADGE IS 26, AND THE 19 IS AN ILLUSTRATION

Reported as a disagreement before the work started. It is not one. The A4 frame
of the landscape spec is the only place the landscape panel is drawn at real
size and its badge is exactly `26 x 26, radius 8, font-size 11, weight 700`.

The 19px badge is inside the SEARCH spec's own landscape mock, which carries the
caption "Shown at 620 px for comparison; ships at 940 x 434" -- and does not
even scale consistently (panel 238x272, row 32, field 34, badge 19; a nominal
0.66 would give 222 / 29 / 30 / 17). The 24x24 badges are section B's diagram
scale and the 28x28 are section D's. None of the three is a shipping size.

Built as: 30 portrait, 26 landscape.

## 3. FOUR DIFFERENCES BETWEEN THE ORIENTATIONS THAT THE BRIEF'S LIST OF SIX DOES NOT CARRY

All four are drawn, consistently, in both spec files:

| | portrait | landscape |
|---|---|---|
| name / sub / count / badge glyph | 15 / 12.5 / 13.5 / 12 | 13.5 / 11.5 / 12.5 / 11 |
| badge radius | 9 | 8 |
| panel shadow | `0 16px 44px rgba(0,0,0,0.55)` | `0 12px 34px rgba(0,0,0,0.5)` |
| overflow | not set | `hidden` |

F. GEOMETRY publishes "radius 22 panel · 12 row · 9 badge" as though the badge
radius were universal; it is the portrait number.

Built as: values on the one geometry block in `searchPanel.css`, not as
branches. Four selectors in the whole stylesheet read `data-fwm-orient` and a
test holds it to four.

**Ask:** add these to the difference table, or bless them. As written, the
brief's "a behaviour that differs and is not one of those six is a bug" makes
the drawing a bug.

## 4. THE LANDSCAPE SPEC STILL PROMISES a SPEED GATE, IN TWO PLACES

- section C, row "Search bar": "Becomes the top right-rail button, opening the
  destination panel in A4 -- voice and one-tap first, **keyboard locked in
  motion**."
- section D, card "No search bar -- a destination panel": "...and **a text field
  that locks above 5 mph**."

Its own A4 body says the opposite ("the field is always live, with no speed gate
on it"), the search spec's principle 04 and E. RULES say the opposite, and the
brief says the opposite twice.

Built as: NO GATE. `SearchPanel.tsx` is handed no speed, reads none, and a test
greps its own source for `speed|velocity|mph|moving|motionLock` and fails on a
hit -- because a prop somebody adds later is how this would come back.

**Ask:** strike the two sentences.

## 5. ROW ANATOMY IS DRAWN TWO INCOMPATIBLE WAYS

Sections A and B draw `badge · name · sub-line · camera count`, which is what
the brief states. Section D draws CAMERA rows with a two-line right side --
distance over a verb, "1.6 mi" over "SHOW" -- and no count, plus group headers
("DESTINATIONS / TAP TO ROUTE", "CAMERAS · INDEXED / TAP TO SHOW") that A and B
have no equivalent of.

Built as: the count is for DESTINATION rows (saved, recent, map result) and the
distance-over-verb stack is for CAMERA and ABUSE rows. The reasoning: a camera
is not somewhere you are going, so "cameras on the route to this camera" is not
a question, and E. RULES names exactly the three destination types when it says
every row shows its count ("Saved, recent and map results alike"). Group headers
are drawn only when both groups are present, because a DESTINATIONS header over
a list containing nothing else is a header explaining itself.

**This is an inference. It wants confirming.**

## 5a. THE PLAIN ROW IS EDGED IN TWO SECTIONS AND BARE IN THE OTHER TWO

Sections A (the 1:1 portrait phone) and the landscape file's A3/A4 (the 1:1
940 x 434 phone) draw a row with NO border and NO background: the badge and the
count carry every bit of the colour. Sections B and D give EVERY row
`border: 1px rgba(255,255,255,0.07)` over `background: rgba(255,255,255,0.035)`,
including the ones with no state on them.

Built as: BARE. A and A3 are the two drawings at ship geometry -- the ones the
F. GEOMETRY chips describe and the ones every row height in the stylesheet was
read out of -- and B and D are catalogues whose rows are 44 and 46 on a
portrait-sized field. A press still fills the row at that same 0.035, and the
two emphasised states (a history match, the default route) take the edge and
wash the spec gives them.

A comment in `searchPanel.css` used to claim section B drew a plain row. It does
not; the comment is corrected and now states the contradiction.

**Ask:** confirm bare. If B and D are the intent, one rule moves it.

## 5b. THE CAMERA ROW HAS a WHOLE COLOUR SYSTEM THAT IS NOT BUILT

Section D tints a camera row in its operator's hue, on five surfaces at once,
and none of the five is drawn today -- the row is built with a tinted BADGE
EDGE and a muted everything-else:

| what | section D draws | built today |
|---|---|---|
| group heading, cameras | `#ff7ad2` | `--dr-owner-flock`, `#ff3dbe` |
| camera badge edge | `rgba(255,61,190,0.45)` and its police/purple twins | the flat role hue, alpha 1 |
| camera badge fill | `rgba(255,61,190,0.12)` and twins | none |
| camera row edge | `rgba(255,61,190,0.22)` and twins | none |
| camera row fill | `rgba(255,61,190,0.05)` and twins | none |
| camera sub-line | `#d99bc4` / `#cf8f97` / `#b0a3d8` | `--dr-ink-muted` |
| camera distance | `#ffa8de` / `#ff9aa6` / `#c4b5fd` | `--dr-ink-3` |
| camera verb | the same operator ink | `--dr-ink-muted` |

Every one of those is a hue the file states, and the section they are in is the
one that argues hardest for them: "a camera is not a destination, so its row has
to look different AND DO something different."

NOT BUILT, deliberately, and it is the only finding in this pass that was left
alone. Doing it right needs a text step for each operator -- `#ff7ad2` is to
`--dr-owner-flock` what `--dr-owner-unverified-text` already is to
`--dr-owner-unverified` -- and each new role needs a light twin in the three
pale skins that a phone-dark-only drawing cannot supply without inventing one.
That is a colour-system decision, not a geometry fix.

**Ask:** bless the operator text steps and their light column, and this is four
rules and two tokens.

## 5c. THE GROUP HEADER IS DRAWN AT ONE SIZE AND THE PANEL HAS TWO

Section D is where the header exists -- 30 tall, padding `0 6`, gap 9, label and
verb at 10.5 -- and D is portrait. The landscape files never draw a mixed list,
so there is no landscape header to read. Built as: ONE size, shared by both
orientations, because the eight locals landscape re-cuts are the ones the file
gives it two of and this is not one of them.

**Ask:** if a landscape header should scale with the row it captions, it needs
drawing.

## 6. THE BADGE SET IS NINE, NOT FIVE

The brief lists H / W / star / return-arrow / bullseye. The spec also ships the
fisheye (camera, tinted per operator, with a purple variant for unverified), the
triangle (abuse area), the arrow (maneuver, in the routing state) and numeric
1 / 2 / 3 (route options in PICKED). The five in the brief are the ones a
DESTINATION row can carry; the other four are drawn.

Built as: all nine, as the codepoints read out of the rendered document --
U+2605, U+21BB, U+25CE, U+25C9, U+25B2, U+2192 -- with the escape written beside
each in `panel.ts` because a bare U+21BB is a character a diff cannot show you.

## 7. THE PICKED DEFAULT ROW IS GREEN, AND THE BRIEF CALLS IT ACCENT

The brief: "the fewest-cameras row is the accent-filled default". The accent is
cyan `#2fd4d4`. The spec draws that row `border rgba(126,235,150,0.34)` over
`rgba(126,235,150,0.07)`, badge edge `0.42`, title `rgb(168,239,192)` -- which
is the ZERO-CAMERAS green, not the accent.

Built as: GREEN, per the drawing. The reasoning: the row's own count is drawn in
that same green two inches to the right of its title, and a cyan row carrying a
green number would be saying "chosen" and "clear" in two colours for one fact.

**Ask:** confirm. If the brief's word is the intent, one token swap in
`searchPanel.css` moves it.

## 8. SMALLER CONTRADICTIONS, EACH SETTLED THE SAME WAY -- THE REAL-SIZE FRAME WINS

- **The typing field's trailing slot** is drawn as a `1.5 x 19` accent CARET BAR
  at real size (landscape A5, and section D's mixed-query panel) and as a
  "clear" text label at diagram scale (section B, state 2). Built as: the MIC
  stays, in every editable state, because "voice is a peer, not a fallback" is a
  rule and the word in the small drawing is an annotation -- the same way
  "voice" stands in for the mic in state 1 of that same row of pictures. The
  caret is the browser's own, because the field is a real `<input>`.
- **The map-result leading glyph** is a bordered bullseye badge in sections B
  and D and a bare 17px pin SVG in landscape A5 and in both first-run rows.
  Built as: the badge on result rows, the pin on the two first-run rows -- which
  is what each frame draws in the place it draws it.
- **The pin's stroke width** is 1.8 in the search spec's first-run rows and 1.7
  in the landscape A5 rows. Built as 1.8, from the file this panel is built from.
- **Keyboard reserve. WITHDRAWN -- the two numbers agree.** F. GEOMETRY says
  "keyboard reserve 200 landscape" and A5 draws the panel at 218, and an earlier
  reading of this entry called that a reserve of 206 and a contradiction. It
  dropped the GAP between the panel and the keyboard, which A5 draws: panel
  bottom 226, keyboard band top 232 in the 432 mock, so 8 on a real viewport --
  the same inset every other edge on that surface takes. The frame closes
  exactly: `8 + 218 + 8 + 200 = 434`. Built as: the height (218) as the
  fallback, with `visualViewport` measuring the real keyboard over it, because
  200 is one keyboard on one device and a suggestion strip is taller.
- **First run's own two steps.** Section C's panel is a 5px grid with an extra
  `margin-top: 3px` on the card AND on Set home, so the card sits 8 under the
  field and the first key sits 8 under the card. Built as: the 5 and the 3 above
  Set home exactly; the card's own 3 is not carried, because in the built panel
  the card's top edge is set by `.fwm-search-list`'s 6 and portrait has no field
  above it to be 8 clear of. Card-to-key is 8 and key-to-key is 5, as drawn.
- **Set work's pin is a different colour from its label. CLOSED 2026-09-09.**
  Section C strokes it `#c3cbd3` under a `#e8ecf0` label; the pin painted in
  `currentColor`, so it took the label's ink. Built as: the one row where they
  differ says so --
  `.fwm-search-set[data-fwm-kind='work'] .fwm-chrome-icon` takes `--dr-ink-3`
  (`#c3cbd3`) and the label keeps `--dr-ink-2` (`#e8ecf0`), which is the file's
  own pair.
- **The grain. WITHDRAWN -- there is no deviation.** This entry said the spec
  draws `rgba(255,255,255,0.024)` against the token's 0.022. It does not:
  `DarkRoute Search Entry.html` writes `rgba(255,255,255,0.022)` twelve times
  and the string `0.024` zero times, and the dock and landscape files write it
  another 32 and 78 times at the same 0.022. The 0.024 was a readback of the
  built app, not a reading of the drawing -- Chromium stores a legacy `rgba()`
  alpha as one byte, so 0.022 lands on 6/255 and `getComputedStyle` prints
  "0.024"; 0.024 prints the same string. The two are indistinguishable through
  the CSSOM, so no measurement can show this value drifting either way.
- **Which dash.** "A row that cannot compute a count shows a dash" does not say
  which, and the repository's `NO_VALUE` is an EM dash. Built as an EN dash,
  because "first run is a sentence" forbids em dashes on this surface in the
  same breath as it forbids a zero.

## THINGS THE DESIGN NEVER DRAWS, WHICH HAD TO BE DECIDED TO SHIP

### A. THE PORTRAIT KEYBOARD CASE IS NEVER DRAWN

E. RULES: "Portrait: panel shortens to sit above the keyboard and keeps the
field pinned top." There is no portrait-with-keyboard frame in either file --
no measured height, no reserve, no row count.

Built as: the panel is bottom-anchored and its `max-height` subtracts
`var(--fwm-search-keyboard, 0px)`, which the HOST sets from whatever the
platform will tell it. Unset it is zero and the rule reduces to "not taller than
the screen". The field is `flex: none` at the top of the column so it stays
pinned by construction. **No reserve is invented here.**

### B. HOW THE PORTRAIT PANEL IS OPENED IS NEVER DRAWN, AND THE 56px BAR IS NOT IN THE PICTURE

The search spec's portrait frame draws the panel over a map with NOTHING above
it -- no search bar. The landscape spec deletes the search bar outright and
opens the panel from a right-rail button. But the brief freezes a 56px portrait
search bar that exists today and says its "BEHAVIOUR and the PANEL it opens are
what change".

So: the panel's field and the bar's field both exist, and the spec never shows
them in the same picture.

Built as: the bar is a HOST. Both fields read and write ONE query, so they are
two views of one state instead of two states. The bar opens the panel on focus,
which is the behaviour it already had. The panel itself never calls `focus()`,
which is the half of "opens with the keyboard down" that belongs to the
component -- in landscape, where the opener is a rail button, the keyboard is
down.

**Consequence worth naming:** in portrait there are two search fields in the
accessibility tree while the panel is up, with different names ("Search address,
street or camera" on the bar, "Where to?" on the panel). The brief said
`TOPBAR_PLACEHOLDER` should become "Where to?"; **it was not changed**, because
giving both fields the same accessible name is worse than having two, and the
bar's string comes from the bar's own frozen spec.

**Ask:** decide whether the portrait bar keeps a field at all once the panel
ships, or whether the panel is opened some other way.

### C. NOBODY CAN COMPUTE THE CAMERA COUNTS YET, AND THE PANEL WILL NOT FAKE THEM

The count is the point of the panel, and no function in this application answers
"how many cameras are on the fastest route to X". `darkRoute.ts` counts readers
on an ALREADY-PLANNED route. Planning one per row would mean, on open, nine
origin-destination pairs sent for a question nobody has asked -- and
`services/route/planRoute.ts` opens with the rule that nothing in it may run
except from a direct user action, singling out "no call while somebody types".
That pair -- where you are and where you are going -- is precisely the record an
ALPR network is assembled to build.

Built as: counts arrive as data (`CountLookup`), the panel draws the DASH the
rule requires for every row it has not been given one for, and it REPORTS the
uncounted rows through `onCountsNeeded` so a host with a right to ask can go and
ask. It never prints a zero it did not measure.

**What would close this honestly:** a corridor count against the cameras already
cached on the phone would be free and private, but a straight-line corridor is
not "the fastest route" and the footer says it is. That is a product decision,
not a screen one.

**Today the panel ships with every count a dash.**

### D. THE HISTORY IS NOW PERSISTED -- CLOSED, with four things opened

The book is one row in a new `destinations` object store (schema v6), written
through by `stores/destinations.ts` and read back by
`services/db/repositories/destinations.ts`. `features/search/places.ts` did not
change: it is still the model, still pure, still where every rule lives.

Both asks in the previous version of this entry are done. The threat-model note
is invariant 2 in `services/db/schema.ts`, rewritten -- it used to say there was
exactly ONE store holding a coordinate, and there are two, both of them
coordinates the user TYPED instead of positions the phone measured.
`features/settings/removal.test.ts` now seeds a book with a saved place and a
recent, asserts both are gone, and asserts the receipt line that says so.

Four things this opened, none of them blocking:

**D1. `places.ts` has no `forgetSaved`, and section C says "long-press ANY row".**
`forgetRecent` covers the recents. The saved half is composed in
`stores/destinations.forgetPlace()`, which is the one behaviour in that file
that is a RULE instead of wiring. It belongs in `places.ts` beside its
neighbour. It was not put there because that file was being edited in parallel
and a second author reaching into it mid-flight is how two half-rules end up in
one function. **Ask:** move it, with the other rules' tests.

**D2. `forgetRecent` returns a fresh object even when nothing matched.**
`expireRecents` short-circuits and returns the same book; `forgetRecent`,
`forgetAllRecents` and `promoteToSaved` do not. The store compares identity to
decide whether to write, so a long-press that landed on nothing would have put a
disk write behind it. Worked around in `forgetPlace` by comparing lengths.
**Ask:** make the four consistent -- return the argument when the rule is a
no-op -- and the workaround deletes itself.

**D3. THE `Saved places` ROW LOST ITS CHEVRON.** The spec draws it as a navigate
row. There is no `places` member in `SECONDARY_SCREENS` and what is behind that
chevron -- renaming, reordering, deleting a saved place -- is a screen nobody has
drawn. Built as a plain row stating the count and the names, which is what the
spec's own value slot says. Same resolution `SettingsViewV1` already made for
`Theme ›`. `Keep for ›` KEPT its chevron and earns it: it is a `<details>` fold
drawn as the 44px row, opening onto the four choices.

**D4. THE RED ROW TAKES TWO PRESSES, WHICH THE SPEC DOES NOT DRAW.** Section C
draws one row with a count and no armed state. Built as arm-then-confirm,
matching `RemovalControl`'s rule for the only other irreversible local deletion
in the product: a mis-tap costs nine places with no undo, no server copy, and --
by design -- no record they existed. **Ask:** if one tap is wanted, delete
`armed` from `ForgetPhase` and the branch that reads it.

### D5. THE PRIVACY SETTINGS LIVE IN THE ZUSTAND SLICE, NOT IN `SettingsValueMap`

`Remember places` and `Keep for` are `rememberPlaces` / `keepPlacesDays` on
`stores/settings.ts`, persisted into `storeBlobs` with every other preference.

They were briefly added to `SettingsValueMap` in `services/db/schema.ts` instead
-- the typed, guarded, closed-name-list settings table -- and taken back out. That
table is READ BY NOTHING in the app: the only production caller is
`clearLocalData()` reading `plateVault.keyId`. Every control on SETTINGS reads
the zustand slice, and putting these two in the other table would have meant a
second hydration gate on one settings group, or two homes for one preference.

**Ask:** the typed settings table is dead weight or it is the intended home for
preferences and nothing was migrated to it. Worth a decision either way -- a
guarded, name-closed store with one live key is a trap for the next person who
finds it and assumes it is the real one.

### E. VOICE HAS NO RECOGNISER

Nothing in this application references `SpeechRecognition` or `getUserMedia` for
speech. The mic is drawn in every editable state at full accent inside the
field, because "voice is a peer, not a fallback" is a rule about the DRAWING as
much as the behaviour -- and it is a `<button>` only when a host wires
`onVoice`, otherwise a mark. A dead control is worse than an honest mark.

**Still to build:** matching on the phone against the local place list first,
falling through to the geocoder only on a miss.

### F. TWO PRESENTATIONS OF ROUTE ALTERNATIVES NOW EXIST

`features/dock/ExpandedPanel.tsx` already draws a `route-choice` view -- 54px
rows with a radio and headlines like "18 min · avoids 3 of 5" -- and
`useDockState.ts:1482` feeds it a hard-coded empty array. PICKED is a second
shape for the same decision, with different geometry and different words
("Fewest cameras / Fastest / Avoid abuse areas", 44px rows, 1/2/3 badges).

**Not reconciled here.** It is above this surface, and neither of us should pick
unilaterally. But the app will offer route options two ways with two vocabularies
until somebody does.

### G. THE ROUTING STATE IS DRAWN AS a PANEL AND CAPTIONED AS a DISMISSAL

Section B's fourth card draws a field reading "Route started" with an "end" key
and two rows under it. Its own caption says "The panel dismisses and the dock
takes over". Built as: the panel renders NOTHING in routing -- a hidden 470px
sheet still holds a focused field and the keyboard would stay up over a map
somebody is now driving by. The strings are exported (`SEARCH_END`) for whoever
builds the dock's version.

### H. PICKED AND ROUTING ARE NEVER DRAWN AT SHIPPING SIZE

Only in section B's 313px-wide diagram (44px rows, 24px badges, 13/11/12px
type). Their portrait geometry is derived from the landscape mock's own rule --
"no row is removed, reordered or relabelled" -- so they take the same 52 / 30 /
15 / 12.5 / 13.5 as every other row. Section D's group headers and 46px camera
rows exist only at 654px wide and are built at the panel's own row height for
the same reason.
