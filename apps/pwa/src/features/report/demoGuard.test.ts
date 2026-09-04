/**
 * A REPORT CANNOT BE FILED FROM INSIDE THE DEMO.
 *
 * =============================================================================
 * THE SHAPE OF THE PROBLEM
 * =============================================================================
 * `features/demo/demoDrive.ts` walks a scripted route and writes the fixes
 * through `positionActions.ingestScriptedFix` - the SAME store the report sheet
 * reads. It starts at 41.8819 / -87.6206, which is Michigan Avenue in downtown
 * Chicago, and stamps `accuracyM: 4`.
 *
 * Three things make that dangerous rather than merely odd:
 *
 *   1. `DemoControl` mounts unconditionally from the Settings screen. There is
 *      no `import.meta.env.DEV` guard anywhere in `features/demo/`, so it is in
 *      production builds.
 *   2. The report sheet opens from ANY screen, so it is reachable mid-demo
 *      without leaving the demo.
 *   3. A report filed there is indistinguishable downstream. It is signed by
 *      the same key, its 4 m accuracy reads as excellent to any accuracy gate,
 *      and its tile source is `network` rather than `fixture`.
 *
 * Nobody has to act in bad faith. A person tries the demo to see what the app
 * does, the sheet is right there, and they press the button.
 *
 * The demo itself stays - it is how somebody evaluates this app without
 * driving. What goes is the ability to file from within it, and the check sits
 * in `submitBlocker` so the sheet says WHY rather than just failing.
 */

import { describe, expect, it } from 'vitest';

import { emptyDraft, reportStatus, submitBlocker } from './reportDraft.ts';

const READY = {
  draft: emptyDraft('new'),
  hasPosition: true,
  cameraId: null,
  submitting: false,
} as const;

describe('the demo guard', () => {
  it('blocks submission while the demo owns the position store', () => {
    expect(submitBlocker({ ...READY, demoActive: true })).toBe('demo-active');
  });

  it('outranks the position check, because during a demo there IS a position', () => {
    // Ordering matters and is easy to get wrong. If `no-position` were tested
    // first, a demo with a fix would fall through it and report as ready - the
    // guard would be present in the code and absent in effect.
    expect(submitBlocker({ ...READY, hasPosition: true, demoActive: true })).toBe('demo-active');
    expect(submitBlocker({ ...READY, hasPosition: false, demoActive: true })).toBe('demo-active');
  });

  it('still lets a real drive through', () => {
    expect(submitBlocker({ ...READY, demoActive: false })).toBeNull();
    // Absent behaves as absent, not as true - callers that predate the flag
    // must not be silently blocked.
    expect(submitBlocker(READY)).toBeNull();
  });

  it('yields to `submitting`, so a send already in flight is not relabelled', () => {
    expect(submitBlocker({ ...READY, submitting: true, demoActive: true })).toBe('submitting');
  });

  it('tells the driver which thing is fake, not that something failed', () => {
    const status = reportStatus({
      blocker: 'demo-active',
      queuedReports: 0,
      wifiOnly: false,
      failure: null,
    });
    expect(status).toEqual({
      tone: 'blocked',
      text: 'DEMO DRIVE · THIS POSITION IS NOT REAL · STOP THE DEMO TO REPORT',
    });
  });
});
