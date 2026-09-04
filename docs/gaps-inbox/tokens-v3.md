# gap record — the v3 token modes

Files: `apps/pwa/src/styles/tokens.css`, `apps/pwa/src/app/mode.ts`,
`apps/pwa/src/features/settings/modes.ts`.

The later token pass added two modes that the original dark-only brief could not
describe: translucent `aurora` and light `refinement`. This record preserves the
decision visible in the shipped tokens without requiring the unpublished design
export that first introduced it.

## Refinement deliberately breaks the dark-only premise

The original brief says the base is black and there is no light theme. The later
mode definition is more specific and is now part of the public implementation,
so `refinement` ships as an explicit light mode instead of being silently folded
back into a dark palette.

This is not a layout fork. The mode may change colour, type, radius and glow; it
must not change hierarchy, copy, alert semantics or touch-target floors. The
four alert states retain their meanings even though their colours are remapped.

## A light mode must override every colour role it exposes

Dark modes can inherit a dark `:root` token without immediately becoming
unreadable. A light mode cannot: an inherited near-black surface becomes a black
hole, and a dark-theme disabled-text token can become stronger than body text.
The `refinement` block therefore names the ground, surfaces, text ramp, rules,
map palette, alerts, tints and instrument colours it uses. A regression test in
`features/settings/swatches.test.ts` pins the settings preview to the same mode
tokens.

`color-scheme: light` is also load-bearing. It tells the browser to paint
overscroll, form chrome and the installed-PWA safe area as light; background
declarations on the document do not control all of those surfaces.

## Open question

The repository now has both a dark-only product premise and an opt-in light
mode. The implementation resolves that conflict in favour of the explicit mode,
but product language should not promise “dark only” while `refinement` remains
selectable. Removing it requires removing the mode, its settings entry and its
system-chrome handling together—not merely deleting a token block.
