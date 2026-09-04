# Engineering gap records

This directory preserves the detailed implementation records behind the shorter
entries in [`DESIGN-GAPS.md`](../../DESIGN-GAPS.md). The name is historical: these
files began as a parallel-working inbox, but source comments and contributor docs
now use their stable anchors as public decision records.

Each record says what the shipped code does, which source material informed it,
what remains unresolved, and which alternatives were considered. References to
unpublished `.design-src*` files document historical provenance; the checked-in
code, tests, tokens, and public docs are the authority available to contributors.

Keep resolved entries rather than deleting them when they explain a non-obvious
choice. Mark stale material clearly, and update or supersede a record whenever the
implementation changes.

## Source authority

The unpublished design exports named throughout these records were historical
inputs, not files a public contributor is expected to possess. When those
inputs disagreed, the implementation used this order: an explicit product
instruction recorded in the public tree; the rendered screen references; the
design-system primitives and exported tokens; then existing repository
conventions. A record below may deliberately choose differently when a privacy,
accessibility or platform invariant makes the higher-ranked drawing impossible.
In every case, the checked-in code, tests, token set and this public record are
the reviewable authority for what ships.

## Touch-target floor

The design system states a 44 px phone touch-target minimum while several
rendered controls are visually 26–42 px high. The standing resolution keeps the
drawn size and extends the interactive area to `--fwm-touch-min` with padding or
a transparent pseudo-element. Watch and dash surfaces use their larger surface
tokens. Do not shrink the hit area to match a drawing, and do not enlarge a
drawn control when an invisible extension can satisfy both requirements.
