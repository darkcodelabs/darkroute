# gap inbox -- design-value enforcement (scripts/check-design-values.mjs)

## no-border-width-token

- need: a border-width token. Section 08 ships `--fwm-line` and `--fwm-line-strong`
  (both colors) but nothing for the width, so `border: 1px solid var(--fwm-line)`
  cannot be written without a raw length.
- screen: every bordered surface -- cards, the dock top rule, sheet edges, the
  intel card, list separators. Surfaced by the checker, which reports the `1px`
  in `border: 1px solid var(--fwm-line)` under rule `length`.
- source: the design files literally render `border:1px solid <color>` 248 times,
  `border-bottom:1px solid <color>` 55 times, `border-left:1px solid` 25,
  `border-top:1px solid` 21, `border-top:2px solid transparent` 20 and
  `border:3px solid <color>` 14 times across all four .dc.html sources. Three
  distinct widths are in use: 1px hairline, 2px selected/active, 3px alert.
- stand-in: none. There is no near-enough token to borrow: the closest numeric
  match is `--fwm-radius-1` (2px), which is semantically wrong -- a radius is not
  a stroke width, and remapping radius per mode would silently change borders.
  Until this is resolved the checker reports these as `length` violations, which
  is the correct behaviour (a real value is genuinely missing).
- options:
  1. Add `--fwm-line-w: 1px`, `--fwm-line-w-2: 2px`, `--fwm-line-w-3: 3px` to the
     `:root` block in section 08. Mirrors the three widths actually drawn, and
     lets `cartridge-96` thicken borders the way it already flattens radii.
  2. Add a single `--fwm-hairline: 1px` and express the other two as state
     tokens (`--fwm-line-w-active: 2px`, `--fwm-line-w-alert: 3px`), which ties
     width to meaning the way hue is already tied to alert state.
  3. Do not tokenize; add a repo-wide allowlist entry exempting `^[123]px$` inside
     `border*` declarations. Cheapest, but it puts a design value back outside
     tokens.css and the four modes can never restyle borders.
