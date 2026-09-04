# Licence

DarkRoute is **GPL-3.0-only**. Copyright © Corian Kennedy.

## It used to be MIT, and this is why it changed

The mesh is the reason. Talking to a node - reading its battery and its
neighbours, and moving anything over LoRa - means speaking the Meshtastic
protocol, which is protobufs over a BLE characteristic. The reference client
that speaks it, [`@meshtastic/js`](https://github.com/meshtastic/js), is
GPL-3.0-only. Linking it into an MIT app is not something you can do quietly:
the combined work has to be GPL-3.0.

The alternative was re-implementing the protocol to dodge the licence, which
is both more work and worse work - a second, unmaintained implementation of
somebody else's wire format, in an app that warns people about surveillance
hardware. Copyleft is a reasonable thing for this project to be under anyway,
and the mesh made it the honest choice rather than a preference.

Corian Kennedy represents that he was the sole copyright holder of the project
code when he made the relicence. This public repository begins with a squashed
root commit, so its Git history cannot independently establish that
representation. Copies actually distributed under MIT before the change keep
the licence grant they received; the current work published here is
GPL-3.0-only.

## What that means for you

You can use, study, change and share this. If you distribute a modified
version - including running it as the site somebody else uses - you have to
offer the source of your changes under the same licence.

## Third-party code

| Component                                                                 | Licence                                                                                | Why it is here                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@meshtastic/js`                                                          | GPL-3.0-only                                                                           | The Meshtastic protocol client. The reason for the relicence.                                                                                                                                                                                                                                     |
| `@jsr/meshtastic__protobufs` 2.7.26 (imported as `@meshtastic/protobufs`) | GPL-3.0-only                                                                           | Generated Meshtastic protocol definitions. Its generated npm `package.json` omits a `license` field, but the exact [JSR release](https://jsr.io/@meshtastic/protobufs@2.7.26) declares GPL-3.0-only and its tarball includes the full GPLv3 `LICENSE`. The SBOM records that evidence explicitly. |
| `maplibre-gl`                                                             | BSD-3-Clause                                                                           | The map renderer.                                                                                                                                                                                                                                                                                 |
| `@protomaps/basemaps`                                                     | BSD-3-Clause                                                                           | Basemap cartography.                                                                                                                                                                                                                                                                              |
| Protomaps sprite sheets, derived from tangrams/icons                      | MIT, Copyright 2017 Mapzen                                                             | Self-hosted basemap symbols. The complete notice is distributed beside the sprites at [`apps/pwa/public/basemap-assets/sprites/LICENSE.txt`](apps/pwa/public/basemap-assets/sprites/LICENSE.txt).                                                                                                 |
| Gradle wrapper 8.14.5                                                     | Apache-2.0 and the bundled-component notices in Gradle's distribution                  | Android build bootstrap scripts and JAR. The exact upstream licence file is at [`apps/android/gradle/LICENSE`](apps/android/gradle/LICENSE).                                                                                                                                                      |
| Plotly `geojson-counties-fips.json`                                       | MIT, Copyright (c) 2019 Plotly; underlying US Census geography is a US government work | Territorial admission geofence for OSM camera records. Pinned provenance and the complete notice are in [`scripts/data/`](scripts/data/README.md).                                                                                                                                                |
| DeFlock `deflock-data` query implementation                               | MIT, Copyright (c) 2026 Deflock                                                   | The retained-response camera capture derives its adaptive Overpass query and element transformation from pinned commit `8d156b24db7090e870af3f007b0caece9b3c0951`. The complete notice is [`scripts/data/DEFLOCK-DATA-LICENSE.txt`](scripts/data/DEFLOCK-DATA-LICENSE.txt).                                                                     |
| Noto Sans map-label glyph atlases                                         | OFL-1.1, Copyright 2022 The Noto Project Authors                                  | Three self-hosted MapLibre stacks (Regular, Medium and Italic), distributed as 768 PBF ranges. The complete licence is beside them at [`apps/pwa/public/basemap-assets/fonts/OFL.txt`](apps/pwa/public/basemap-assets/fonts/OFL.txt).                                               |
| Google Sans 13.002                                                        | OFL-1.1                                                                                | Self-hosted theme font.                                                                                                                                                                                                                                                                           |
| Chakra Petch 1.000                                                        | OFL-1.1                                                                                | Self-hosted optional interface font.                                                                                                                                                                                                                                                              |
| JetBrains Mono 2.211                                                      | OFL-1.1                                                                                | Self-hosted data font.                                                                                                                                                                                                                                                                            |

The seven interface-font files, their embedded copyright notices, exact source
URLs and SHA-256 digests are mapped in
[`apps/pwa/public/fonts/LICENSES.md`](apps/pwa/public/fonts/LICENSES.md); the
complete licence is beside them as
[`OFL-1.1.txt`](apps/pwa/public/fonts/OFL-1.1.txt). The separately distributed
Noto Sans map glyphs carry their own complete OFL copy at the path in the table.
The complete resolved software inventory is in [`sbom/sbom.json`](sbom/sbom.json);
the short table above calls out the runtime components and assets whose
licensing materially constrains this distribution.

Except where a file or cited third-party source states otherwise,
project-authored documentation is distributed under GPL-3.0-only with the
project code.

Map data is © OpenStreetMap contributors, under the
[ODbL](https://opendatacommons.org/licenses/odbl/). The camera records this app
ships are derived from OSM and carry the same obligation: the attribution on
the map is not decoration, and it does not come off.

## Node firmware

This project builds no firmware and distributes no firmware binary.

It used to. A GitHub Actions workflow patched a splash bitmap and about ten
user-visible strings into an upstream Meshtastic tag, built it, and published
the image to R2 - and this section carried the table of exactly which files
that touched, because the GPL claim rested on somebody being able to diff the
result against a public tag and find precisely what was named.

That is retired. The app pairs with whatever Meshtastic firmware is already on
your node, from Meshtastic's own maintained releases, and marks a node as a
darkroute participant by writing a SECONDARY channel over the Bluetooth link -
a runtime configuration change, not a build. The one thing the fork actually
bought, a default node name, was a default the app overwrites anyway.

The relicence to GPL-3.0 stands and is unaffected: it comes from linking
`@meshtastic/js`, which is GPL-3.0-only, not from having shipped a modified
binary. See the section at the top.

Images published under the old scheme remain reachable in R2 for anyone who
flashed one, and are no longer offered by the app.
