# gap inbox -- onboarding (apps/pwa/src/features/onboarding)

> **STALENESS WARNING, added 2026-08-30.** The drawn states here are v0's. The behaviour is
> still live, and the difference matters.
>
> `apps/pwa/src/app/registry.v1.tsx:117` maps
> `onboarding: OnboardingV1Screen`, and v1 is the default
> (`apps/pwa/src/app/design.ts:61`). But
> `features/onboarding/OnboardingV1Screen.tsx:11` renders
> `<OnboardingScreen view={OnboardingViewV1} />` - the v0 CONTAINER, unedited,
> with a v1 view passed in.
>
> So: every entry below about permission FLOW - the denied state, the gesture
> that may request location, what happens on refusal - still binds, because
> the container that enforces it is the one still running. Every entry about
> what the screen DRAWS - the 10px labels, the card border, the 3px status
> rule, the A1 layout - describes `components/OnboardingView.tsx`, not the
> shipped `components/OnboardingViewV1.tsx`.
>
> One number named in the v1 view is deliberately absent: v1's
> "132,068 cameras" line is not shipped (`registry.v1.tsx:113-116`).
>
> Read instead: `features/onboarding/components/OnboardingViewV1.tsx`,
> `docs/STALENESS.md`.

Screen: `A1 · ONBOARDING - PERMISSIONS`, `Flockys Screens II.dc.html`.

Three gaps this feature hits are already filed in shared records and are cited
from the code rather than re-filed here:
`#micro-type-below-stated-floor` (the 10px labels in A1),
`#no-border-width-token` (the 1px card border and the 3px status rule) and
`#type-metrics-not-tokenized` (every letter-spacing and line-height on the
screen). The six below are new.

## onboarding-location-denied-has-no-designed-state

- need: a drawn state, and copy, for "the OS refused location".
- screen: A1 · ONBOARDING - PERMISSIONS. It is the one permission the product
  cannot work without, and the only one whose denial has to be explained.
- source: A1 renders LOCATION in its granted state only, and the fine print says
  "you can skip everything except location". Nothing in any of the four design
  files draws the refused state -- grepping all four for "denied", "location
  off" or a permission-failure panel returns nothing. The nearest drawn
  relatives are `A2 · OFFLINE - DEGRADED` (a left rule in the state hue over
  mono body copy, plus a 48px RETRY SYNC button) and the RADAR `NO FIX / NO GPS
  / RETRY LOCK` tile, which is a lost-fix state, not a refused-permission one.
- stand-in: A2's caveat-block shape in `--fwm-destructive`, with authored copy:
  "LOCATION DENIED" / "Distance to cameras is computed from your position.
  Without it there are no alerts, and a report cannot record where a camera is."
  / "Turn location on for this site in your browser settings, then retry." /
  "RETRY LOCATION". Behaviour: the first START WATCHING tap that comes back
  denied stays on the screen and shows this; a second tap completes anyway,
  because most browsers never re-show the dialog and a hard gate would be a
  screen some drivers can never leave.
- options:
  1. Draw the state in A1 and write the copy -- preferred; it is the first
     screen and the only one where the product's core promise can fail outright.
  2. Route a denial to a dedicated full-screen explainer (an A1b frame), which
     has room for the per-browser "how to turn it back on" instructions this
     stand-in deliberately does not attempt.
  3. Keep it inline as above and decide only the copy.

## onboarding-space-steps-10-14-18-20

- need: space steps at 10px, 14px, 18px and 20px, or a decision that the four
  existing steps are canonical and the design renders should snap to them.
- screen: A1 throughout -- header padding 18px 0 24px, tagline margin-top 10px,
  card list gap 10px and margin-top 20px, card padding 14px 16px, handle hint
  margin-top 6px, fine print margin-top 14px.
- source: `--fwm-space-*` is 4 / 8 / 12 / 16 / 24 / 32 / 48. The A1 frame uses
  6, 10, 14, 18 and 20 as well, and 10 and 14 sit exactly between two steps, so
  there is no "nearest" to pick.
- stand-in: the nearest step, rounded toward the tighter one where it is a tie
  (10 -> 8 for gaps, 12 for the tagline's optical gap under a title; 14 -> 12;
  18 -> 16; 20 -> 24 for the section break above the cards; 6 -> 4).
- options:
  1. Add `--fwm-space-5: 20px` and treat 6/10/14/18 as design drift to be
     re-snapped -- smallest change, keeps the scale legible.
  2. Move to a 2px-based scale (4/6/8/10/12/14/16/18/20/24/32/48) that can
     express every value the four design files actually render.
  3. Declare the current scale canonical and re-cut the A1 frame against it.

## onboarding-lede-16px-has-no-step

- need: a 16px type step, or a ruling on which existing step the A1 lede and the
  START WATCHING label take.
- screen: A1 lede paragraph ("Cameras read your plate as you drive…") and the
  START WATCHING label, both rendered at 16px.
- source: the type table steps body 15px / .9375rem to subtitle 17px /
  1.0625rem. 16px is exactly between them. Section 02 lists no 16px step.
- stand-in: `--fwm-text-subtitle` (17px) for both -- the lede is the screen's
  reading copy and the button is its primary action, so erring larger is the
  safer direction for a screen read one-handed.
- options:
  1. Add `--fwm-text-lede: 1rem` for exactly this role.
  2. Rule that the lede is `--fwm-text-subtitle` and the button label is
     `--fwm-text-body`, and re-cut A1 at those sizes.
  3. Keep the stand-in and accept the 1px difference.

## onboarding-button-heights-have-no-token

- need: button height tokens. A1's primary button is 56px; A2's secondary
  button (RETRY SYNC) and the Design System's own "BUTTONS · h48 · radius 2"
  panel are 48px; `--fwm-touch-min` is 44px.
- screen: A1 START WATCHING (56px) and the retry in the denied state (48px,
  borrowed from A2).
- source: `Flockys Design System.dc.html` section 04 panel header says
  "BUTTONS · h48 · radius 2", and A1 renders its primary at 56px, so the system
  and the screen already disagree by one size.
- stand-in: derived from the touch floor rather than borrowed from a space step:
  `calc(var(--fwm-touch-min) + var(--fwm-space-3))` = 56px and
  `calc(var(--fwm-touch-min) + var(--fwm-space-1))` = 48px. Both land on the
  rendered value exactly today, and both grow with `--fwm-touch-min` on the dash
  surface, where the floor is 68px and a fixed 56px button would be under it.
- options:
  1. Add `--fwm-btn-h: 48px` and `--fwm-btn-h-primary: 56px`.
  2. Keep the derivation and document it as the rule (button height = touch
     floor plus one space step), which is the only form that survives
     `dash-cast` without a second block.
  3. Rule that every button is h48 per section 04 and re-cut A1.

## permission-denied-and-unavailable-have-no-hue

- need: the status-word hue for a permission the driver refused, and for one the
  device does not have.
- screen: A1's three permission cards. The design draws GRANTED (#3DE08A),
  ALLOW (#FFC02E) and OPTIONAL (rule #23262F, word #6B7381) and stops there.
- source: A1 renders exactly three states. Nothing in the design files renders a
  refused permission or an absent sensor.
- stand-in: DENIED takes `--fwm-destructive` for both the rule and the word --
  it is the product's non-alert negative token and `A2 · OFFLINE` already uses
  it for the "NO" rows, so a refusal cannot be mistaken for an alert state.
  UNAVAILABLE takes a `--fwm-line-strong` rule with a `--fwm-text-muted` word,
  because "this phone has no compass" is a fact about hardware, not a refusal,
  and should not read as red.
- options:
  1. Adopt the stand-in and add the two rows to the A1 state matrix.
  2. Give DENIED the alert-in-range hue for consistency with the rest of the
     app's "bad" colour -- rejected here because hue means alert state.
  3. Drop the word entirely for UNAVAILABLE and grey the whole card, which is
     one fewer state to specify but hides the reason.

## handle-switch-track-has-no-token

- need: track and knob sizes for the toggle control.
- screen: A1's SHOW A HANDLE switch; the same control recurs in B4, B5, the
  settings surface and the Design System's "TOGGLE · SLIDER · CHIPS" panel.
- source: the control renders 56x30 with a 24x24 knob inset 3px, eleven times
  across the design files, plus a 44x26 variant with the same knob in two places
  in Screens II. The space scale has 48 and 32 but not 56, 30, 26 or 3.
- stand-in: track `var(--fwm-space-12)` x `var(--fwm-space-8)` (48x30 -> 48x32),
  knob `var(--fwm-space-6)` (24px, exact), inset and travel derived as
  `(track height - knob) / 2` so the knob stays centred and the two end gaps
  stay equal under any rescaling. The ON state is not a gap: the Design System's
  toggle panel specifies track #3DE08A with a #000 knob pinned right.
- options:
  1. Add `--fwm-switch-w: 56px` / `--fwm-switch-h: 30px` / `--fwm-switch-knob:
     24px` and settle the 44x26 variant as a second size or as drift.
  2. Express the switch entirely in terms of the knob
     (`track = knob * 2 + inset * 2`), which needs only an inset token.
  3. Accept the 48x32 stand-in and re-cut the design renders.
