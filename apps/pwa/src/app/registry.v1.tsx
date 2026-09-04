/**
 * THE v1 SCREEN REGISTRY.
 *
 * =============================================================================
 * WHAT THIS FILE IS
 * =============================================================================
 * The redesign, screen by screen. Every entry here is a NEW component
 * registered under an EXISTING screen id, and `main.tsx` merges this over the
 * v0 registry when the design is v1:
 *
 *     { ...SCREENS, ...V1_SCREENS }
 *
 * Two consequences, both deliberate.
 *
 * AN ID ABSENT FROM HERE FALLS THROUGH TO ITS v0 SCREEN. That is what lets the
 * redesign land one screen at a time: there is never a half-built app, only an
 * app where some screens are redesigned and the rest are the ones that already
 * work.
 *
 * A v0 COMPONENT IS NEVER EDITED. `RadarView.test.tsx` alone is 826 lines and
 * 55 cases rendering `RadarView` directly; a design branch inside it forks all
 * 55, while a second component under the same id leaves all 55 untouched and
 * passing. That is the whole argument for the seam being here.
 *
 * =============================================================================
 * WHAT IS NOT DUPLICATED
 * =============================================================================
 * The stores, the alert engine, the map, the GPS watch and every service. A v1
 * screen reads the same state a v0 screen reads. The redesign is a surface,
 * and the machinery under it does not get a second copy.
 */

import type { ComponentType } from 'react';

import type { ScreenRegistry } from './App.tsx';

import { DriveScreen } from '../features/drive/DriveScreen.tsx';
import { ExposureScreen } from '../features/exposure/ExposureScreen.tsx';
import { MeshScreen } from '../features/mesh/MeshScreen.tsx';
import { OfflineV1Screen } from '../features/offline/OfflineV1Screen.tsx';
import { AdminV1Screen } from '../features/admin/AdminV1Screen.tsx';
import { MoreScreen } from '../features/more/MoreScreen.tsx';
import { SettingsV1Screen } from '../features/settings/SettingsV1Screen.tsx';
import { TriageV1Screen } from '../features/triage/TriageV1Screen.tsx';
import { HelpV1Screen } from '../features/help/HelpV1Screen.tsx';
import { LookupV1Screen } from '../features/lookup/LookupV1Screen.tsx';
import { IntelV1Screen } from '../features/intel/IntelV1Screen.tsx';
import { ReportV1Screen } from '../features/report/ReportV1Screen.tsx';
import { AskV1Screen } from '../features/ask/AskV1Screen.tsx';
import { OnboardingV1Screen } from '../features/onboarding/OnboardingV1Screen.tsx';
import { DocsScreen } from '../features/docs/DocsScreen.tsx';
import { MisuseScreen } from '../features/misuse/MisuseScreen.tsx';
import { InstallInvite } from '../features/install/InstallInvite.tsx';
import { DetourOffer } from '../features/drive/DetourOffer.tsx';

export const V1_SCREENS: ScreenRegistry = {
  /**
   * DRIVE replaces RADAR. Same id, because it is the same place in the
   * product: the screen a driver is on while driving. The dock key, the
   * navigation, the alert takeover's restore path and every `?screen=radar`
   * link keep working without knowing anything changed.
   */
  radar: DriveScreen,

  /** EXPOSURE replaces LOG: the same record, led by the count rather than the table. */
  log: ExposureScreen,

  /** MESH replaces NODE: the same feature, split into what it is and how to use it. */
  node: MeshScreen,

  /** OFFLINE, as a list of what still works rather than an apology. */
  offline: OfflineV1Screen,

  /** ADMIN, with the tools listed and every queue depth left as an em dash. */
  admin: AdminV1Screen,

  /**
   * MORE. The one entry here with no v0 counterpart at all: v0's dock has no
   * hub key, so nothing under v0 ever navigates to this id and it correctly
   * renders the unbuilt placeholder there.
   */
  more: MoreScreen,

  /**
   * SETTINGS. The one v1 entry that is not a new screen at all: the container
   * is v0's, unedited, with a different view passed in. See
   * `features/settings/components/SettingsViewV1.tsx`.
   */
  settings: SettingsV1Screen,

  /** TRIAGE, led by the projected interruption rate. Same container as v0. */
  triage: TriageV1Screen,

  /** HELP, as cards. The answers are `answers.ts`, unchanged and complete. */
  help: HelpV1Screen,

  /**
   * LOOKUP changes QUESTION in v1: v0 asks whether an operator searched your
   * plate, v1 asks where the cameras are. Both ship - v0's whole screen renders
   * inside v1's, behind a row. See `features/lookup/LookupV1Screen.tsx`.
   */
  lookup: LookupV1Screen,

  /** INTEL, the camera detail. Every unknown value stays an em dash. */
  intel: IntelV1Screen,

  /** REPORT, as v1's bottom sheet. Reachable as a screen and as an overlay. */
  report: ReportV1Screen,

  /** ASK, listing the questions the resolver can answer rather than the design's five. */
  ask: AskV1Screen,

  /**
   * ONBOARDING. The one screen seen exactly once, so it is also the one whose
   * numbers are least checkable - which is why v1's "132,068 cameras" line is
   * not shipped. See `components/OnboardingViewV1.tsx`.
   */
  onboarding: OnboardingV1Screen,

  /**
   * MISUSE. Forty-seven cited records across thirty-eight counties, every one
   * fact-checked before it was written and gated by
   * `scripts/check-record-citations.mjs`. `scripts/misuse-patrol.mjs` watches
   * for new reporting daily and opens a review PR; it never writes a record.
   */
  misuse: MisuseScreen,
  docs: DocsScreen,
};

/**
 * THE v1 OVERLAYS.
 *
 * REPORT and INTEL are each reachable two ways - as a screen and as a layer
 * raised over whatever you were on - and `main.tsx` registers both. The v1
 * components have to be substituted in BOTH registries or the dock's report
 * circle would raise the v0 sheet over a v1 app.
 */
export const V1_OVERLAYS: Readonly<Record<string, ComponentType>> = {
  report: ReportV1Screen,
  intel: IntelV1Screen,
  /**
   * THE INSTALL INVITE. Raised by `App` once the controller says it may be -
   * never on a first launch, never during an alert, never once refused - and
   * offering install, open, or keep using the website with the refusal
   * remembered. See `features/install/InstallInvite.tsx`.
   */
  install: InstallInvite,
  /**
   * THE DETOUR OFFER, raised by DRIVE's `Route around all N` key.
   *
   * An overlay rather than a screen because it is a question about a route
   * that only exists for as long as the fix it was computed from: there is
   * nothing here to deep-link to, and `V1_SCREENS` deliberately has no
   * counterpart. It is the only surface in the app that can send anything to
   * a maps service, and it does so only after an explicit yes - see the header
   * of `features/drive/DetourOffer.tsx`.
   */
  detour: DetourOffer,
};
