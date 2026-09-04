# gap inbox -- ASK

> **STALENESS WARNING, added 2026-08-30.** The drawn screen here is v0's, and ASK is no longer a
> dock key.
>
> `apps/pwa/src/app/registry.v1.tsx:110` maps `ask: AskV1Screen`, and v1 is the
> default (`apps/pwa/src/app/design.ts:61`).
> `features/ask/AskV1Screen.tsx:11` renders `<AskScreen view={AskViewV1} />` -
> the v0 CONTAINER, unedited, with a v1 view. `askAnswer.ts` is shared, so the
> resolver entries still bind; the drawn ones describe `components/AskView.tsx`,
> not the shipped `components/AskViewV1.tsx`.
>
> Line 73's "the REPORT bar and the five dock keys" is v0's dock. v0 has five
> word-keys including ASK (`apps/pwa/src/app/screenState.ts:56`); v1 has five -
> Drive, Log, Mesh, More, Search - and ASK is not among them
> (`apps/pwa/src/components/dock/DockV1.tsx:66-76`). Under the default design
> ASK is a MORE tile (`features/more/MoreScreen.tsx:208-210`), so the entries
> below that turn on "entered from the dock key" no longer have a dock key to
> turn on.
>
> Read instead: `features/ask/components/AskViewV1.tsx`, `docs/STALENESS.md`.

Files: `apps/pwa/src/features/ask/**` (`AskScreen.tsx`, `askAnswer.ts`,
`components/*.tsx`, `ask.css`).

Sources read: `Flockys App Screens.dc.html` -- screen `04 · ASK - LISTENING`
(lines 265-322) and the `DOCK - REPLACES THE ICON ROW` panel (line 469);
`Flockys Watch.dc.html` -- `W9 · ASK - VOICE ONLY` (lines 215-231), which is the
only other place the design draws an answer; `Flockys Design System.dc.html`
section 08 (tokens) and the `fwmVoice` keyframe (line 24);
`docs/platform-capabilities.md` -- the two speech capability answers.

Everything ASK draws that the design does draw is a literal read from screen 04,
and all of it now ships: the 52px header, `ASK`, the wake-word chip, seven 6px
bars at 84px with their seven periods, `LISTENING…`, `YOU`, `DARKROUTE`,
`TAKE DETOUR`, `ON SWEEP`, `TRY`, and all three chips -- `cameras near me`,
`flocked today?`, `who owns FWM-0442`.

Two of those are drawn but not reachable from the built-in answerer, and both
are recorded below rather than counted as fidelity: `TAKE DETOUR` (no route
scoring exists, see `route-answers-cannot-be-computed`) and the armed
`WAKE WORD ON` state (arming is a press, see `wake-word-chip-is-drawn-as-a-label`).

## Cross-references, not new entries

The decision is already filed; ASK is another instance of it.

- `DESIGN-GAPS.md#micro-type-below-stated-floor` -- ASK's sites: the wake-word
  chip and the notice strip (10px), the `YOU` / `DARKROUTE` / `TRY` speaker labels
  (10px) and the TRY chip text (12px). All render at `var(--fwm-text-micro)`
  (11px), so the labels are marginally larger and the chip text marginally
  smaller than the reference.
- `DESIGN-GAPS.md#animations-are-not-tokens` -- see
  `voice-bar-periods-derived-from-dur-alert` below.
- `docs/gaps-inbox/radar-screen.md#spacing-scale-misses-10-14-and-30` -- ASK's
  14px stack gap, the 14px `YOU` indent, the 10px gaps under the speaker labels
  and above the action row, and the 6px gap under the `YOU` label all take the
  nearest step below.
- `docs/gaps-inbox/repo-tooling.md#type-metrics-not-tokenized` -- every `.1em`,
  `.06em`, `.18em` and `.2em` on this screen, expressed as
  `calc(var(--fwm-text-*) * n)`.
- `docs/gaps-inbox/design-value-enforcement.md#no-border-width-token` -- the 1px
  hairline and the 2px `YOU` rule, derived from `--fwm-space-1` (`/4`, `/2`) as
  component-scoped locals.
- `DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn` -- see
  `only-the-listening-caption-is-drawn` below.

## no-drawn-control-starts-listening

**The design draws the listening state and no way to enter it.** Screen 04 has a
header, a voice band, a caption, a transcript, an answer and chips. There is no
microphone button, no hold-to-talk key and no press target of any kind. The
bottom of the panel is the REPORT bar and the five dock keys, which are shell
chrome and belong to every screen.

**What I did.** The 84px voice band the design already draws IS the control: it
is a `<button>`, still and grey when idle, running and cyan while the microphone
is open. Pressing it opens the microphone; pressing it again closes it.

**Why.** Adding a second element would be adding a control the design does not
show, and the band is the only element on the screen that is already about the
microphone. Drawing it in idle (rather than creating it on press) means the
control can be found before it has been used. Grey-when-inactive is the product's
existing idiom for "present but not alerting" -- it is how muted cameras draw.

**Open question for the designer.** Is the band the intended affordance, or is
ASK meant to be entered already listening from the dock key, with the wake word
or a long-press as the only other way in? If the latter, the dock key needs a
second behaviour and this screen needs no control at all.

## only-the-listening-caption-is-drawn

`LISTENING…` is the design's, character for character, ellipsis included. The
other four captions are authored:

| phase | caption | why |
|---|---|---|
| idle | `PRESS TO TALK` | matches the adapter's own documented interaction |
| answering | `ANSWERING…` | same cadence as `LISTENING…` |
| answered | `PRESS TO TALK` | the screen is idle again; the card carries the result |
| unavailable | `VOICE UNAVAILABLE` | the platform has no recogniser |

**Open question.** Four strings the design never wrote, in the product's most
voice-forward screen. They should be reviewed by whoever owns the copy.

## wake-word-chip-is-drawn-as-a-label

**The design draws `WAKE WORD ON`, in green, as a static label.** Rendering that
on mount would mean the app opens the microphone -- continuously -- the moment
ASK appears, which the screen's own rule forbids and which the platform cannot
honour anyway.

**What I did.** The chip is a button. It ships `WAKE WORD OFF` in
`--fwm-text-muted` and arms only from a press, at which point it becomes
`WAKE WORD ON` in `--fwm-alert-clear` (#3DE08A, the colour the design draws). It
carries no border and no box, exactly as drawn; the 44px touch floor is reached
with `min-height` instead.

**Open question.** Is wake word meant to be a persisted setting that is on by
default after onboarding grants the microphone? That would still not open the
microphone on mount without a gesture somewhere, so it needs a design answer
about where that gesture lives.

## no-drawn-surface-for-the-wake-word-reason

`docs/platform-capabilities.md` requires two sentences to reach the driver:

1. the real reason the wake word cannot run ("must render this reason instead of
   a broken promise");
2. that Chromium's recogniser is network-backed, **before** the first press.

A 10px nowrap chip in a 52px header can carry neither.

**What I did.** Followed RADAR's OFFLINE strip -- full width, under the header,
mono micro, amber -- as `.fwm-ask-notice`. It is NOT a verbatim copy of that
rule, and an earlier draft of this file and of `AskNotice.tsx` claimed it was.
The differences, all deliberate: no pulsing `.fwm-radar-strip-dot`; no
`white-space: nowrap` / `text-overflow: ellipsis`; and `padding` plus
`line-height: 1.5` so the line wraps and grows past the 32px floor. A privacy
disclosure that ends in an ellipsis has not been disclosed.

The strip renders a LIST, in this order, deduplicated by text: the transient
line (an adapter error, or the wake-word-yielded note), then the speech or
wake-word capability reason, then the off-device-audio disclosure. It used to be
a priority chain that rendered exactly one, which meant the first recogniser
hiccup silently removed the only place the product admits that audio leaves the
phone. The two capability sentences are still the adapter's own strings rendered
verbatim, so the screen cannot drift from the platform.

**Open question.** ASK is the only screen with this strip. If more screens need
one it should be promoted to a shared component rather than copied.

## notice-strip-is-permanent-on-chromium

`sendsAudioOffDevice()` is true whenever `webkitSpeechRecognition` exists and
unprefixed `SpeechRecognition` does not -- which is Chrome, this product's
Android-first primary target. So the amber
`AUDIO LEAVES THE PHONE · THIS BROWSER USES A REMOTE SPEECH SERVICE` line is not
an exception path: on the main target it is the DEFAULT appearance of the
screen, permanently, between the 52px header and the voice band. The design
draws no such element at all.

**Why it stays.** It is a true statement about where the driver's voice goes,
`docs/platform-capabilities.md` requires it before the first press, and it is
the only place in the product that makes the disclosure. Hiding it after the
first press, or behind a tap, would make the disclosure conditional on the
driver having already spoken.

**Open question for the designer -- this one needs an answer, not a gap entry.**
A permanent 2-3 line amber strip above the voice band is a design decision, and
it was made here by default rather than drawn. Options a designer might prefer:
a persistent line inside the 52px header; a quieter grey treatment for the
standing disclosure with amber reserved for transient failures; or a one-time
disclosure at onboarding with a small permanent marker here. The current
treatment is the honest one, not necessarily the right one.

## off-device-audio-warning-is-authored

`AUDIO LEAVES THE PHONE · THIS BROWSER USES A REMOTE SPEECH SERVICE` and
`WAKE WORD OFF · THE MICROPHONE RUNS ONE SESSION AND PUSH-TO-TALK HAS IT` are
the two authored sentences in the notice strip. Both are cadenced on RADAR's
`NO NETWORK · RUNNING ON CACHE`. The first states `sendsAudioOffDevice()`, not
an assumption; the second states what the adapter just did. Both need a copy
review: the first is a privacy disclosure and it is the only place in the
product that makes it.

## the-listening-state-has-to-be-polled

**The speech adapter cannot say "the session ended", so the screen watches it.**
`services/adapters/core.ts` `fail(code, message)` sets `lastError` and notifies
nobody, and `speechRecognition.ts` handles the recogniser's `end` event by
setting `isListening = false` with no outbound signal. `subscribe()` carries
transcripts and nothing else.

That is a real defect, not a nuisance: the driver presses the band, the screen
paints `listening` (cyan animated bars plus `LISTENING…` in a live region), the
driver then DENIES the microphone prompt -- and the screen animated a voice
meter at a microphone that never opened, indefinitely. Chrome ending the session
on silence ("the session ends on silence" -- `docs/platform-capabilities.md`) did
the same thing. It contradicted this screen's own written rule: "Motion only
while the microphone is actually open. An idle screen that animates a voice
meter is claiming to hear something" (`ask.css`).

**What I did, in-feature.** While -- and only while -- the phase is `listening`,
`AskScreen` re-reads `speech.listening()` on a 250ms interval, and the moment it
comes back false it drops to `idle`/`answered`, disarms the wake chip and
renders whatever `speech.error()` left behind. The interval is created by the
press that opened the microphone and cleared the instant the phase changes, so
nothing polls on an idle screen.

**The right fix is one line outside this feature, and it is not mine to make.**
The adapter should tell its subscribers. Either `core.fail()` notifies an error
channel and `speechRecognition.ts` signals `end`, or `SpeechAdapter` grows a
`subscribeState()` alongside `subscribe()`. When that lands, delete the interval
here -- the screen already has the exact handler it needs.

## a-band-press-takes-the-microphone-from-wake-word

**The design draws the chip as an independent control; the platform is not.**
The adapter runs one recognition session at a time (`begin()`: "idempotent: one
session at a time"). A band press while wake word was armed used to call
`stop()` and disarm, and nothing else -- so the chip flipped from
`WAKE WORD ON` to `WAKE WORD OFF` as a silent side effect of an unrelated
control, and while wake word was armed there was NO way to push-to-talk at all.

**What I did.** The band press now yields: it stops the wake-word session, then
opens a push-to-talk session, so pressing the band is always a way to ask
something. The chip really does go off -- the session it named is gone -- and
the notice strip says why in one line rather than letting it happen silently.

**Open question.** Should the wake word re-arm itself when the push-to-talk
session ends? That is the behaviour a driver probably expects, and it needs the
adapter's end-of-session signal above before it can be built honestly.

## ask-owns-its-scroll

`App.tsx` renders `<main class="relative flex-1">` with no overflow of its own,
and `.fwm-ask-body` had none either, so the column simply grew: with the
permanent notice strip wrapped to two or three lines, a long transcript and a
long refusal, the `margin-top: auto` `TRY` row slid under the fixed dock chrome.
`.fwm-ask-body` now sets `overflow-y: auto`, the same call `dead-drop` made on
its list. A stylesheet assertion in `components/AskView.test.tsx` holds it.

## route-answers-cannot-be-computed

**The design's own showcase answer is refused.** Screen 04 renders

> seven on your usual route. the Madison detour drops it to two and costs you
> four minutes.

with `TAKE DETOUR` and `ON SWEEP` beneath it. That needs route surveillance
scoring (`B3 · PRE-DRIVE - ROUTE SURVEILLANCE SCORE`, not started) and a routing
engine with travel-time estimates. Neither exists, and neither is ASK's to
build.

**What I did.** `resolveAsk()` classifies anything route-shaped as `route` and
returns a refusal naming the reason. `TAKE DETOUR` is implemented, labelled and
styled exactly as drawn, and is emitted by nothing -- a test asserts that no
question produces it. The moment route scoring lands, the answerer emits the
action and the button is already there.

**Why.** Printing that sentence with numbers the device does not have is exactly
the failure the product's own rule forbids, and it is the most convincing
possible fake: it names a street.

**Weigh this as coverage, not fidelity.** `04 · ASK - LISTENING` IS the answered
route state, so the panel as drawn -- the `DARKROUTE` card reading "seven on your
usual route..." with the filled `TAKE DETOUR` beneath it -- cannot be reproduced
by typing the design's own transcript into the running app. What that transcript
produces is a grey refusal with no action row. The answered state itself is
reachable and is rendered: `AnswerCard` draws `take-detour` whenever an answer
names it, `components/AskView.test.tsx` renders exactly the panel's shape from a
route answer, and `AskScreen`'s `resolve` prop is the seam a real route answerer
plugs into. What does not exist is anything that can honestly EMIT that answer.

**Open question.** Which comes first, B3 or ASK's route intent? ASK's refusal
should be replaced the same day B3 ships, not left to rot.

## ask-has-no-answering-backend-at-all

The design shows ASK answering a question and says nothing about what answers it.
Source inspection finds a speech adapter but no assistant, model or query
service.

**What I did.** Wrote `askAnswer.ts`: a five-way classifier over a closed set of
intents, answering only from numbers the stores already hold --
`useCountInRange()`, `useNearestCamera()`, `useTodayPasses()`, `useGpsStatus()`
-- and refusing everything else by name. It is pure, has no clock, no storage
and no network, and never interpolates the question into its output.

**Why an answerer at all, rather than an injected one only?** Two of the three
TRY chips the design draws (`cameras near me`, `flocked today?`) map exactly onto
selectors that already exist, and the watch face answers the same kind of
question with the same kind of data (`W9`: "how many cameras on Reading?" ->
`FOUR · TWO SHARED`). Shipping a screen that refuses both of its own suggestions
would be a worse lie than answering them from real data.

**Open question.** Is ASK meant to grow into a real assistant (a model, a query
language) or stay a voice front-end over on-device facts? The `resolve` prop is
the seam either way, but the answer changes how much of the classifier survives.

## counts-spelled-as-words

Both design files that draw an answer spell counts as words -- the phone renders
"seven ... two ... four minutes", the watch renders `FOUR · TWO SHARED`.
`countWord()` spells 0-12 and switches to numerals above twelve, which is where
English stops having one word per number. Distances stay numeric (`425`, `0.6`),
matching every other readout in the product. The cut at twelve is mine; the
design never renders a count above seven.

## try-chips-are-below-the-touch-floor

Rendered `padding:9px 13px` at 12px, which lands a roughly 33px-tall control --
under the product's own 44px touch floor. Same call as RADAR's 44x36 header keys:
the floor wins, `min-height: var(--fwm-touch-min)`, and the chips read chunkier
than the reference. See `docs/gaps-inbox/radar-screen.md#radar-header-key-44x36`.

## fwm-0442-is-a-camera-id-not-a-plate

**This was shipped wrong and is now fixed.** An earlier build read `FWM-0442` as
a licence plate, named the third TRY chip `PLATE_CHIP`, filtered it out under
`FEATURES.plateLookup`, and routed the question to the plate refusal. The design
says otherwise, twice:

| where | drawn |
|---|---|
| `02 · SWEEP`, FALCON card | `OWNER: HOA · FACING: SW` / `ID FWM-0442 · EFF ATLAS OK` |
| `03 · LOOKUP`, first row | `FWM-0442 · HOA · SHARED` -- the camera that READ the plate `KY · 471 TRB` |

Three sibling gap docs already said so (`stores.md`: "A camera id (`FWM-0442`)";
`dead-drop.md`: "a public infrastructure id, not a position"; `report.md`: "a
camera id (\"FWM-0442\") is plate-shaped").

Two things were wrong because of it, and both are fixed:

1. The shipped screen rendered TWO of the design's THREE chips, a drawn element
   deleted on a false premise. `FEATURES.plateLookup` is about "has my plate been
   seen" and haveibeenflocked.com permission; it does not gate camera-owner data
   and never did. `visibleTryChips()` is gone -- `TRY_CHIPS` is what ships, and
   `AskScreen.test.tsx` now asserts all three from the running screen rather than
   only the view asserting them from a constant.
2. The design's own showcase suggestion was answered "plate lookup is switched
   off in this build. nothing about a plate is looked up, stored or sent." --
   false about the question asked, on the one screen whose whole contract is that
   it never says anything untrue. `classify()` now has a `camera-owner` intent.

An explicit plate word still wins: `who owns plate FWM 0442` classifies as
`plate`. And ASK still refuses plate questions even with the flag on, pointing at
LOOKUP -- a spoken plate is the single most sensitive string this product can
receive, and routing it into an answer would put it in a `role="status"` live
region.

## camera-owner-answers-come-only-from-the-cache

`who owns FWM-0442` is answered from `useCachedCameras()` -- the cameras slice's
own records, already in memory -- and from nothing else. No network call, no
lookup service, no derived guess:

| state | what ASK says |
|---|---|
| record cached with an `ownerType` | that owner class, in words (`a homeowners association owns that one.`) |
| record cached, no `ownerType` | refusal: the record carries no owner |
| nothing cached under that id | refusal: not cached on this device, so the owner is not known here |

The id is never repeated back into the answer, for the same reason a plate is
not: the card is a live region.

**Open question.** With no tiles cached, which is the state a fresh install is
in, the design's own chip answers with a refusal. That is honest but it is a
thin first impression, and it argues for ASK's chips being derived from what the
device actually holds rather than being three fixed strings. That is a design
decision, not a bug fix.

## the-plate-classifier-must-not-guess

`PLATE_SHAPED = /\b[a-z]{2,4} ?[0-9]{3,4}\b/` matched `is 500` in "is 500 feet
close", `us 127` in "cameras on us 127", and `PLATE_WORDS` carried bare
`who owns` and `owner` -- so "who owns that camera" and "who is the owner of this
camera" were refused with "plate lookup is switched off in this build", a
refusal naming a reason that is not the reason for a question containing no
plate. The file's own doc block claims refusals "name the real reason".

**What I did.** `who owns` / `owner` moved to `OWNER_WORDS` (a camera has an
owner too). The shape test now accepts both orders the LOOKUP panel draws
(`HVK 8842` and `471 TRB`) and rejects a match whose letters are an ordinary
short English word or a unit -- `NOT_PLATE_LETTERS`. `CAMERA_WORDS` also gained
`watched`, so "am i being watched" is answered by the app named DarkRoute Watching
Me instead of falling through to `unknown`.

**Open question.** `NOT_PLATE_LETTERS` is a hand-written list and a plate that
spells one of its entries is only caught when the driver says the word "plate".
That is the right trade for a screen that must not refuse for a false reason,
but it is a heuristic, and a real plate parser (state prefixes, format tables)
would be better.

## voice-band-and-bar-widths-have-no-token

Rendered `height:84px` on the band and `width:6px` per bar. Both are exact
multiples of tokens and are derived rather than invented:
`1.75 * --fwm-space-12` is 84px, `1.5 * --fwm-space-1` is 6px. Component-scoped
locals, not new tokens. The seven bar heights (70/100/55/85/65/95/50%) are
percentages, which the token set models no family for -- same class of value as
keyframe geometry.

## voice-bar-periods-derived-from-dur-alert

The design gives each bar its own `fwmVoice` period: .8s, 1.1s, .7s, 1.3s, .9s,
1.05s and .75s. All seven exceed `--fwm-dur-alert` (400ms), the longest duration
the system exports, so each is expressed as an exact multiple of that token
(2x, 2.75x, 1.75x, 3.25x, 2.25x, 2.625x, 1.875x) rather than as a literal. The
design's `ease-in-out` is rendered as `var(--fwm-ease-mech)`, the same
substitution RADAR made for `fwmPulse`. See
`DESIGN-GAPS.md#animations-are-not-tokens`.

## transcript-and-answer-type-steps-missing

| rendered | token used | delta |
|---|---|---|
| transcript 20px/600/1.3 | `--fwm-text-subtitle` (17px) | 3px smaller |
| answer 16px/1.5 | `--fwm-text-body` (15px) | 1px smaller |
| action labels 13px | `--fwm-text-body` (15px) | 2px larger |
| chip text 12px | `--fwm-text-micro` (11px) | 1px smaller |

Same family as `DESIGN-GAPS.md#token-set-does-not-cover-rendered-hero-sizes`:
the scale has six steps and the screens draw more sizes than that. The
transcript is the one that reads noticeably tighter than the reference, because
it is the largest body element on the screen.

## speech-adapter-cites-a-gap-anchor-that-does-not-exist

`services/adapters/speechRecognition.ts` carries
`/* GAP: see DESIGN-GAPS.md#wake-word-is-not-always-on */` above
`wakeWordCapability()`. There is no `wake-word-is-not-always-on` heading in
`DESIGN-GAPS.md`. Not fixed here -- that file is outside this feature -- but the
anchor should either be written or the comment repointed at
`docs/platform-capabilities.md`, which does state the rule.

## the answer card is a live region

`AnswerCard` is `role="status"` so an answer that lands while the driver is
looking at the road is announced. The design says nothing about announcement.
This is also why no answer may contain the question: a plate spoken into a live
region is a plate read aloud by the screen reader.
