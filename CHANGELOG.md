# Changelog

All notable changes to DarkRoute are recorded here. The project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); releases use semantic
versions where the current product stage permits it.

## [Unreleased]

### Changed

- Public-release hardening and documentation reconciliation.

## [0.1.0] - 2026-09-01

### Added

- Offline-capable camera warnings, distance and ahead-of-route calculations,
  mute controls, and a map backed by a tiled public-camera archive.
- Local report drafting with device signatures, a hash chain, delayed release,
  optional metadata-stripped photographs, and OSM-compatible subject position.
- On-device plate matching, trip history, GPX/Garmin export, and optional
  Meshtastic communication over Web Bluetooth.
- A public audit, threat model, data contracts, provenance, taxonomy, security
  policy, and transparency archive linked to the running build commit.
- Cloudflare Pages Functions for camera tiles, archive pointers, and the
  Access-gated development administrator surface.

### Security

- The browser build requires a restrictive CSP and security headers.
- Public production fails closed for administrator routes when Cloudflare
  Access assertions are absent.
