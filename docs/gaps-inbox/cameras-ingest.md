# gap record — camera ingest normalisation

Files: `scripts/fetch-cameras.mjs`, `scripts/fetch-cameras.test.mjs`,
`docs/public/DATA-PROVENANCE.md`.

OpenStreetMap camera tags are free text, while the runtime record has one
numeric bearing and one owner bucket. This record makes the lossy choices in
that conversion reviewable.

## A multi-bearing value keeps its first bearing

OSM may encode multiple approaches as a semicolon list such as `120;45`. A
`CameraRecord` can hold only one `directionDeg`, so the parser keeps the first
entry. It does not average the entries: `82.5` would be a direction the mapper
never supplied. Supporting every approach requires widening the public camera
schema to a bearing array and teaching the alert engine and UI how to consume
it; until then the first value is an explicit limitation.

## Covered arcs use a wrap-aware bisector

A value such as `338-23` describes an arc crossing north. Its bisector is
`0.5°`, not the naive arithmetic midpoint `180.5°`. The parser computes the
clockwise span modulo 360 and then its midpoint. `0-360` is treated separately:
it means omnidirectional, so the honest single-bearing value is `null`.

Cardinal and intercardinal values use the 16-point compass table. Plain numeric
degrees are normalised into `[0, 360)`. Empty or unparseable values remain
`null`; downstream code must read that as unknown, never as “not facing you.”

## Owner type is an inference, not evidence

`ownerTypeFor()` classifies the free-text `operator` tag with a narrow regex.
No operator becomes `unverified`; government words become `police`; HOA words
become `hoa`; three vendor names become `inter_agency`; other named operators
become `private`. It deliberately does not infer an owner from manufacturer
when the operator is absent.

The original `tags.operator` is retained in every record. Accountability work
must use that source text and tolerate its absence; the five-way bucket exists
for coarse UI filtering and is explicitly a guess.

## Change rule

Any change to these conversions needs fixtures for semicolon values, wrapped
arcs, `0-360`, cardinal values, missing operators and ambiguous operators. A
count-only archive check cannot detect a semantic reclassification of every
record.
