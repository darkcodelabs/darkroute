/**
 * IMMERSIVE BY DEFAULT - the map runs to the edge of the phone.
 *
 * =============================================================================
 * WHY THIS IS NOT JUST A MANIFEST FIELD
 * =============================================================================
 * `display: "fullscreen"` in the manifest handles a Chrome WebAPK install:
 * launched from the home screen it comes up with no status bar. It does NOT
 * cover the TWA, whose display mode comes from an Android meta-data key
 * (`android.support.customtabs.trusted.DISPLAY_MODE`) and ignores the web
 * manifest entirely - see apps/android/app/src/main/AndroidManifest.xml.
 *
 * And it does nothing at all for a browser tab, which is how everybody sees the
 * app before they install it. There the only route is `requestFullscreen`, and
 * a page may call it only inside a user gesture with TRANSIENT ACTIVATION. A
 * page that asks on load is refused by every engine, so "fullscreen the instant
 * it loads" is not achievable in a tab and this does the next best thing: it
 * asks on the first gesture the driver was going to make anyway.
 *
 * =============================================================================
 * A REFUSAL IS NOT AN ANSWER. AN EXIT IS.
 * =============================================================================
 * This used to burn its one shot BEFORE asking: the flag was set and both
 * listeners removed synchronously, then the request went out and its rejection
 * was swallowed. So a single refused request killed immersive mode for the rest
 * of the session, and nothing anywhere reported it.
 *
 * That is the wrong shape, because the two ways a request can end mean opposite
 * things:
 *
 *   REJECTED   the browser did not act. Nobody decided anything, and the next
 *              gesture deserves another try. Which gestures carry activation
 *              varies by engine, by input type and by version - it is not a
 *              thing to hard-code a belief about.
 *
 *   ENTERED    it worked. From here the ONLY way out is the user's own - Escape
 *              or the system gesture - and that is a decision, so this stops
 *              for good. Re-asking after somebody deliberately left fullscreen
 *              is an app arguing with them.
 *
 * So: keep asking across gestures until one succeeds, then never again.
 *
 * =============================================================================
 * WHAT IT STILL WILL NOT DO
 * =============================================================================
 * Nothing when the app is ALREADY immersive - the normal case for an installed
 * copy, where there is no chrome to remove. And it never fires more than one
 * request at a time, so the pointerdown/pointerup/click burst a single tap
 * produces cannot stack three requests on top of each other.
 */

/** True once fullscreen has actually been ENTERED. Never reset by a refusal. */
let entered = false;

/** True while a request is outstanding, so one tap makes at most one request. */
let inFlight = false;

/**
 * SET BY THE PREFERENCE SWITCH TURNING OFF, AND IT EXISTS FOR A RACE.
 *
 * The switch is a click, and `armImmersive` listens for clicks on the document
 * in the capture phase - so the very tap that turns the preference OFF reaches
 * the arm FIRST and asks for fullscreen. The switch's own handler then runs,
 * exits (nothing to exit yet: the request is still pending), and writes the
 * store. A moment later the arm's request resolves and the app goes fullscreen.
 *
 * Turning the setting off turned it on. Measured, not theorised: clicking the
 * switch to OFF left `document.fullscreenElement` non-null.
 *
 * Tearing the listener down from App's effect cannot fix it - that happens a
 * render later, after the request is already in the air. Only something the
 * resolving request itself checks can, which is this.
 */
let suppressed = false;

function alreadyImmersive(): boolean {
  const view = globalThis.window;
  if (view === undefined) return false;
  if (globalThis.document?.fullscreenElement != null) return true;
  // The installed app, launched from the home screen with the manifest's own
  // display mode. Nothing to remove.
  return view.matchMedia?.('(display-mode: fullscreen)').matches === true;
}

/**
 * Every event that can carry user activation, in the order one tap fires them.
 *
 * ALL of them, rather than a bet on which one works. Whether a touch
 * `pointerdown` carries activation is engine- and version-specific: measured in
 * headless Chromium with a Pixel 7 touch profile, `pointerdown`, `pointerup`,
 * `touchend` and `click` ALL granted it - but a synthesized tap is not proof
 * about a real phone, and a report from a real device said the opposite.
 *
 * Listening to all of them and retrying on refusal makes that question stop
 * mattering: if the earliest one is refused, the next one in the same tap gets
 * its own try, and nothing is lost either way.
 */
/*
 * NO `pointerdown`, AND NO `pointerup`. THIS ONE BREAKS BUTTONS.
 *
 * Entering fullscreen RESIZES THE VIEWPORT - the status bar or the URL bar
 * goes, and every control on the screen moves. A browser decides a click by
 * where `pointerdown` and `pointerup` both landed, so shifting the layout
 * BETWEEN those two events means the finger comes up somewhere the button no
 * longer is, no `click` is ever generated, and the tap is silently eaten.
 *
 * That is a whole-app defect, not a fullscreen one: the first tap of a session
 * lands on some control, and that control does nothing. Reported as "half those
 * side rail buttons don't work or act funny".
 *
 * `click` and `touchend` fire AFTER the browser has already resolved the
 * target, so a resize from inside them cannot retarget anything - the event is
 * already on its way to the element that was pressed. They are a few
 * milliseconds later and they carry activation just as well.
 */
const GESTURES = ['touchend', 'click', 'keydown'] as const;

/**
 * Ask for fullscreen at the first opportunity a browser will accept.
 *
 * Returns a teardown, so a caller that unmounts leaves no listener behind. Safe
 * to call when there is no DOM - it does nothing and returns a no-op.
 */
export function armImmersive(): () => void {
  const doc = globalThis.document;
  if (doc === undefined || entered) return () => undefined;

  const off = (): void => {
    for (const type of GESTURES) doc.removeEventListener(type, request, true);
  };

  /** Stop for good. Called on success, and when the user leaves fullscreen. */
  const finish = (): void => {
    entered = true;
    inFlight = false;
    off();
  };

  function request(): void {
    if (entered || inFlight) return;

    // Already immersive - an installed copy, or fullscreen entered elsewhere.
    // Nothing to ask for, and nothing to keep listening for.
    if (alreadyImmersive()) {
      finish();
      return;
    }

    const root = doc.documentElement;
    if (root.requestFullscreen === undefined) {
      // No Fullscreen API on an element at all - iOS Safari. Asking again on
      // every gesture for the rest of the session would be pure waste.
      finish();
      return;
    }

    inFlight = true;
    try {
      // `navigationUI: 'hide'` is a hint, not a guarantee - Android honours it,
      // desktop ignores it.
      void root.requestFullscreen({ navigationUI: 'hide' }).then(
        () => {
          // THE PREFERENCE WON WHILE THIS WAS IN THE AIR. Undo it rather than
          // keep a screen the driver just asked to give back.
          if (suppressed) {
            inFlight = false;
            exitImmersive();
            return;
          }
          // It worked. From here the only way out is the user's own, and that
          // is final: see the header.
          finish();
        },
        () => {
          // The browser did not act. Nobody decided anything, so the next
          // gesture gets a turn.
          inFlight = false;
        },
      );
    } catch {
      // A synchronous throw - a permissions policy that forbids it outright.
      // That will not change during the session.
      finish();
    }
  }

  // CAPTURE PHASE, so a control that stops propagation - the dock keys do -
  // cannot swallow the gesture before it gets here. This never preventDefaults
  // and never stops propagation, so whatever the driver pressed still happens.
  for (const type of GESTURES) doc.addEventListener(type, request, true);

  return off;
}

/**
 * ENTER FULLSCREEN NOW, from inside a click.
 *
 * This is the FOCUS BUTTON's path, which is the one that has always worked:
 * a real `onClick` carries transient activation on every engine and input type,
 * with none of the doubt that surrounds a `pointerdown` on touch. The settings
 * switch calls this, so turning the preference on takes effect on that tap
 * rather than on some later gesture.
 *
 * MUST be called synchronously inside the handler. Awaiting anything first
 * spends the activation and the request is refused.
 */
export function enterImmersive(): void {
  const doc = globalThis.document;
  // Turning it back ON clears the suppression the OFF set.
  suppressed = false;
  /*
   * GUARDED ON THE ELEMENT, NOT ON THE DISPLAY MODE.
   *
   * It used `alreadyImmersive()`, which is true whenever the manifest launched
   * an installed copy fullscreen - so in that copy the key could not enter, and
   * because there was then no `fullscreenElement`, it could not exit either. A
   * dead control in exactly the app the whole feature is for.
   *
   * Element fullscreen is a SEPARATE mechanism from the manifest's display
   * mode, and asking for it in a launched-fullscreen app is allowed: it takes
   * the remaining cutout band and, more importantly, it gives a
   * `fullscreenElement`, which is what makes the toggle able to toggle.
   *
   * The ARM still uses `alreadyImmersive()`. It must not fight an installed
   * copy on the first stray tap; this is a press somebody made on purpose.
   */
  if (doc === undefined || doc.fullscreenElement != null) return;
  try {
    void doc.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).then(
      () => {
        // Whatever the arm was doing, it is done: we are in.
        entered = true;
      },
      () => undefined,
    );
  } catch {
    // No Fullscreen API, or a policy that forbids it.
  }
}

/**
 * LEAVE FULLSCREEN, which only the preference switch may do.
 *
 * Nothing else in the app calls this - see `DriveScreen.fullscreen.test.ts`,
 * which fails the build if DRIVE ever regains an exit. Turning a preference OFF
 * is the one place an exit is the user asking for it rather than the app
 * overriding them.
 */
export function exitImmersive(): void {
  const doc = globalThis.document;
  // Set FIRST and unconditionally: a request already in flight resolves after
  // this returns, and this flag is the only thing it will check.
  suppressed = true;
  if (doc?.fullscreenElement == null) return;
  try {
    void doc.exitFullscreen?.().catch(() => undefined);
  } catch {
    // Already gone.
  }
}

/**
 * THE PLATFORM PUT US HERE, AND NO WEB API CAN UNDO IT.
 *
 * An installed copy launched from the home screen with the manifest's own
 * `display: "fullscreen"` reports the display mode but sets NO
 * `fullscreenElement` - there is no Fullscreen API element, because the page
 * never requested one. Both halves of a toggle are inert against that:
 * `requestFullscreen` is refused as redundant and `exitFullscreen` has nothing
 * to exit, so the launch chrome cannot be handed back by any code we can write.
 *
 * Measured, Pixel 7 profile with the display-mode query forced to match: the
 * DRIVE key rendered `aria-pressed="false"` over an app that was fullscreen,
 * and tapping it changed nothing in either direction.
 *
 * True ONLY in that case. A tab that entered fullscreen itself has a non-null
 * `fullscreenElement` and reads false, which is what keeps the toggle working
 * everywhere it can actually work.
 */
export function immersiveIsLaunchMode(): boolean {
  return (
    globalThis.document?.fullscreenElement == null &&
    globalThis.window?.matchMedia?.('(display-mode: fullscreen)').matches === true
  );
}

/** Test seam. Nothing in the app calls this. */
export function resetImmersiveForTests(): void {
  entered = false;
  inFlight = false;
  suppressed = false;
}
