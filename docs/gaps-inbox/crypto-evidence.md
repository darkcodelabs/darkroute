# Gap inbox - crypto-evidence (Web Crypto evidence chain + plate vault)

## plate-export-warning-copy-unspecified

- need: user-facing warning copy for the plate-vault export, and the confirmation
  affordance that precedes it
- screen: none exists. The plate vault (`apps/pwa/src/services/crypto/plate.ts`)
  exposes `exportPlatesWithWarning({ confirmed: true })`, which decrypts every
  stored plate into cleartext. That is the single most dangerous action in the
  product and nothing in the design describes how it is asked for or warned about.
- source: `Flockys Screens II.dc.html` renders `EXPORT JSON` and `EXPORT CSV`, but
  both are on B2 · DEAD DROP and export signed evidence, not plates. `DarkRoute App
  Screens.dc.html` LOOKUP says only "Plate never leaves this device. Matched
  against your own trip log - no Flock system is queried." - which is a promise
  the export breaks, so the export needs copy that says so.
- stand-in: `EXPORT_WARNING` in `plate.ts`, written in the lowercase blunt product
  voice: "this file holds your plates in the clear. anything that can read the
  file can read them. once it leaves the device the app cannot take it back."
- options:
  1. Draw a WATCHLIST/LOOKUP destructive-action sheet with hold-to-confirm, reusing
     the REPORT-bar 1s hold gesture that already exists, and put the warning there.
  2. Keep a plain two-step confirm dialog and use the stand-in copy as written.
  3. Cut the plate export entirely and only ship `destroyVault()`, so the LOOKUP
     promise stays literally true. The task requires the export to exist as an API;
     it does not require a UI to reach it.

## no-device-key-unavailable-state

- need: a rendered state for "this device cannot sign", covering every reason the
  probe can return: no Web Crypto, no `crypto.subtle`, insecure context, no
  IndexedDB, and a browser that cannot structured-clone a `CryptoKey`
- screen: B2 · DEAD DROP, the `SIGNED` row of the drop readout; and the REPORT
  sheet, which must refuse to file rather than queue an unsigned report
- source: `Flockys Screens II.dc.html` line 411 renders the row as
  `SIGNED   DEVICE KEY OK` in the clear hue. Only the OK case is drawn. The whole
  screen is built on "Reports are signed the moment you file them ... Nothing is
  edited after the fact" (line 399), so the not-OK case cannot be a silent
  fallback - `finalize()` throws `CryptoUnavailableError` and there is nowhere
  for that to land.
- stand-in: none rendered. `cryptoAvailability()` returns a discriminated union
  carrying `reason` + `detail`; the strings exist, the screen does not.
- options:
  1. Same row, destructive hue, reading `SIGNED   NO DEVICE KEY`, with the REPORT
     submit key disabled and a one-line explanation under the queue count.
  2. A full-width banner above the DEAD DROP queue in the destructive hue, since
     this blocks the entire filing flow and is not a per-drop detail.
  3. A dedicated blocked state for the REPORT sheet, matching whatever the
     permission-denied treatment turns out to be, so "we cannot do this" looks the
     same everywhere.

## sync-state-vocabulary-differs-from-storage

- need: one agreed name per queue state. The crypto record and the storage layer
  disagree, and the screen uses a third word.
- screen: B2 · DEAD DROP queue chips
- source: `Flockys Screens II.dc.html` renders the chips as `HELD` and `SYNCED`,
  and the DROP 00 row reads "yesterday · accepted". `apps/pwa/src/services/db/
  schema.ts` declares `SyncState = 'pending' | 'syncing' | 'synced' | 'rejected' |
  'dead_letter'`. `apps/pwa/src/services/crypto/chain.ts` declares
  `SyncState = 'held' | 'syncing' | 'synced' | 'rejected'`, following the screen.
- stand-in: `held` in the crypto layer; `pending` in the storage layer. Nothing
  maps between them yet, so a record written by one and read by the other loses.
- options:
  1. `held` everywhere - the screen word wins, storage renames `pending`.
  2. `pending` everywhere in code, with `HELD` as the display label only.
  3. Keep both and put an explicit mapping in one file, which is the option that
     eventually produces a bug.
