# Plate data handling

The data contract for the one field in this product that could hurt someone: a licence plate.

Written 2026-08-20. This document is the source for the plate section of the public privacy page,
and it is deliberately specific - a privacy claim that cannot be checked against code is marketing.

---

## The short version

**A breach of our servers cannot expose a plate, because our servers never receive one.**

That is an architectural guarantee, not a cryptographic one, and it is the strongest statement in
this document. Encryption protects data you hold. Not holding it protects it better.

On the device, plates are encrypted at rest under a key that cannot be exported. And there is a
one-press removal that destroys the ciphertext, both keys and the match index together.

---

## Where a plate can exist

| Location | Holds a plate? | Notes |
|---|---|---|
| Neon Postgres | **No.** Never. No column exists. | There is nothing to dump. |
| Cloudflare Workers | **No.** Not stored, not logged. | Transits only if the plate check proxies (see below). |
| Cloudflare logs / analytics | **No.** | Plate values never appear in a URL, a query string or a header. |
| Backups, replicas, exports | **No.** | Follows from the first row: you cannot back up what was never written. |
| The device, in IndexedDB | **Yes - ciphertext only.** | Encrypted, see below. |
| The device, in memory | **Yes - briefly.** | Decrypted for display or matching, then dropped. |
| A third-party plate-check service | **Depends.** | The user's query reaches them by design. Disclosed explicitly - see "the plate check". |

Enforced in code, not just intended:

- `apps/pwa/src/services/db/repositories/plateVault.ts` rejects any write to the vault whose value
  is not exactly a sealed record, and any write carrying a plate-shaped string in a field that
  should hold an opaque identifier. The heuristic catches a plate embedded in free text, which is
  the realistic accident - someone puts a plate in a note, or spreads a form object into a record.
- The zustand persist middleware throws if a plate-shaped value reaches a serializer, so a plate
  cannot leak into persisted application state by refactor.
- `scripts/check-design-values.mjs` runs in CI. A future guard for plate-shaped literals in source
  belongs alongside it.

---

## How it is encrypted, exactly

| Property | Value |
|---|---|
| Cipher | AES-GCM, 256-bit |
| Key generation | `crypto.subtle.generateKey(..., extractable: false, ...)` - per install |
| Key storage | `CryptoKey` object in IndexedDB via structured clone, in a separate `fwm-crypto` database |
| IV | 12 fresh random bytes per record, never reused |
| AAD | `fwm-plate/v1:<recordId>` - binds each ciphertext to its own record |
| Blind index | HMAC-SHA-256 under a **second** non-exportable key, truncated to 128 bits, hex |
| Plaintext at rest | none |

Three details that matter more than they look:

**`extractable: false` is the point.** The raw key bytes cannot be read out by any JavaScript on the
origin, including our own code and including anything injected into it. There is no code path that
turns the key into a string, so there is no code path that accidentally logs it, syncs it, or ships
it in a crash report.

**The AAD binds ciphertext to its record.** Without it, an attacker with write access to the
database could swap one record's ciphertext into another record and the decryption would still
succeed, silently relabelling whose plate is whose. With it, that tampering fails to decrypt.

**The blind index is keyed, not hashed.** This is the difference between a real protection and
security theatre. A plain `SHA-256("HVK8842")` is worthless: the space of US plates is small enough
to enumerate exhaustively in seconds, so a hash is just a reversible encoding. Because the index is
an HMAC under a second non-exportable key, a dump of blind indexes on their own reveals nothing -
there is no offline attack without the key, and the key cannot be exported.

The signing key used for camera evidence gets the same treatment and one extra check: the code
inspects the generated private key and **refuses to run** if the runtime handed back an extractable
one, rather than quietly proceeding with a weaker guarantee.

---

## "If it gets dumped, it must be worthless"

Split into the two breaches, because they are not remotely equivalent.

### Breach of our infrastructure - worthless, guaranteed

Neon dumped, Workers compromised, a backup leaked, an insider, a subpoena. The attacker gets: camera
locations (already public and mostly ODbL-licensed), signed camera reports (evidence users chose to
file), anonymous session UUIDs, and public-record entries that were already published elsewhere.

They get **zero plates**, because no plate was ever sent. There is no key to steal, because there is
no ciphertext to decrypt. This holds regardless of how thoroughly the infrastructure is compromised.

This is the liability answer. The product cannot leak what it never collected.

### Breach of a user's device - degrades honestly

If someone dumps the browser profile off a phone they physically hold, they get ciphertext and two
non-exportable key handles.

What they **cannot** do: read the key material, take the ciphertext somewhere else and decrypt it,
or brute-force the blind index.

What they **may** be able to do: restore that profile onto a machine they control and execute code
on the same origin, at which point the browser will use the key in place. A non-exportable key
resists *extraction*; it does not resist *use* by an attacker who owns the environment holding it.

So the honest statement - and the one that belongs on the privacy page - is:

> a dump of our servers gets you nothing, because we never have your plate. a dump of your phone's
> storage gets you ciphertext, and the key that reads it can't be copied out. someone who has your
> unlocked phone, or a full copy of your browser profile, is a different problem, and no app-level
> encryption solves it.

Do not write "military-grade encryption". Write what is true.

### If a stronger device-level guarantee is wanted

The vault key can be wrapped by a key derived from a passkey (WebAuthn PRF) or a device unlock, so a
copied profile is inert without the user's biometric or PIN. It is genuinely stronger and it is not
free: it needs an unlock surface that no supplied design screen draws, it introduces a lockout mode
when the passkey is lost, and it means a plate cannot be matched while the device is locked.

**Not building it without a decision.** Filed as an open question rather than invented.

---

## Removal

`forgetLocalIdentity()` in `apps/pwa/src/services/privacy/forget.ts` is the single removal path, and
the UI must call this and nothing else.

It exists because plate material lives in two databases that know nothing about each other - the
ciphertext, blind index and key *reference* in `fwm`, and the actual `CryptoKey` in `fwm-crypto`.
Clearing one and not the other leaves half of it on the device. Neither half is exploitable alone,
but "we left half of it behind" is not a sentence anyone wants in a breach notice, and a user who
pressed delete meant it.

**Deletes:** encrypted plate values, the vault key, the blind-index key, the local match index, the
key reference, trip history, alert history.

**Keeps, deliberately:** signed camera reports and their hash chain. Each record commits to the one
before it, so deleting one in the middle breaks verification for every record after it. Shredding a
user's own evidence from inside a "clear my data" button would be the most destructive control in the
product. The report states how many were retained so the user can deal with them as a separate,
deliberate act.

**Behaviour:** the database clear runs first, so a failure in key destruction leaves an unreadable
key and no ciphertext - harmless. The reverse order could leave readable ciphertext with a live key,
which is the exact state the function exists to prevent. It is idempotent, and if key destruction
fails it reports that failure rather than claiming a clean wipe.

**Surfacing:** the removal control needs a home. No SETTINGS screen exists in the design sources
(`DESIGN-GAPS.md#no-settings-screen-exists`), so the candidates are the WATCHLIST screen, which
already owns plate management, and a global control wherever SETTINGS eventually lands. Both should
show `describeForgetReport()` output - the real counts, not a toast that says "done".

Tested in `forget.test.ts`: ciphertext destroyed, a stale record handle no longer decryptable after
the wipe, idempotent on a second press, key-store failure reported honestly, evidence retained.

---

## The plate check

The product asks a third-party service (haveibeenflocked) whether a plate has been seen, and shows
the answer. That query necessarily contains the plate.

Two architectures, in preference order:

1. **Browser calls them directly.** Our servers never see the plate, not even in transit. Requires
   their CORS policy to permit it and their terms to allow third-party clients. Under recon now.
2. **Our Worker forwards it.** No logging, no storage, no request-body capture on that route. The
   plate exists in Worker memory for the life of one request. Weaker, and the privacy page must say
   so plainly.

Either way, the page must disclose that the third party receives the query and applies **their** data
handling, which we do not control and should not characterise beyond what they publish. And we should
ask their permission before building on their service rather than discovering their position later.

---

## Watchlist

Kept, per the owner's decision on 2026-08-20. Alerting on new reads of a saved plate requires storing
that plate, and it is stored under the terms above: encrypted, device-only, removable.

Two mitigations worth carrying into the UI, because this feature has an obvious dual use - the design
copy itself acknowledges it with "Add only plates you're entitled to track":

- Plate *labels* ("mine", "partner", "trailer") stay in cleartext while the plate itself is
  ciphertext. The list is readable and useful without exposing a plate until the user reveals one.
- The design's own caveat is honest and should survive implementation verbatim: watchlist alerts are
  **inferred, not sourced** - the app knows a camera read something at that spot and that the
  pattern fits. It never queries a Flock system.

---

## Open questions

1. **Passkey-wrapped vault key** - stronger device-breach story, needs an unlock surface no screen
   draws and a lockout story. Decision needed.
2. **Plate check topology** - direct-from-browser vs proxied, pending the CORS and terms findings.
3. **Permission from haveibeenflocked** before building on their service.
4. **Where the removal control lives**, blocked on the missing SETTINGS screen.
5. **A CI guard for plate-shaped literals** in source, alongside the design-value checker.
