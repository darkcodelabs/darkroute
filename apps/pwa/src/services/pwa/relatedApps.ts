/**
 * IS THIS ALREADY INSTALLED, somewhere other than this tab?
 *
 * =============================================================================
 * WHY THIS IS NOT `isStandalone()`
 * =============================================================================
 * `isStandalone()` answers "is this tab running as an installed app", which is
 * a fact about the WINDOW. This answers "does an installed copy exist on this
 * device", which is a fact about the DEVICE - and they differ in exactly the
 * case that matters: somebody who installed the app and is now looking at the
 * site in a browser tab. Asking them to install it again is the single most
 * annoying thing an install prompt can do.
 *
 * `navigator.getInstalledRelatedApps()` is the API for that. It needs
 * `related_applications` in the manifest naming what to look for - the PWA
 * itself by manifest URL, and the Play listing by package id for the TWA build.
 *
 * =============================================================================
 * IT IS ALLOWED TO KNOW NOTHING
 * =============================================================================
 * Chrome on Android only, and only over https. Firefox and every iOS browser
 * return nothing, which is indistinguishable from "not installed" - so a false
 * answer here must be the SAFE one. It is: `false` means the invite may show,
 * and the invite itself offers "keep using the website" and remembers a
 * refusal. Being asked once on a browser that cannot tell is survivable;
 * suppressing the offer for everyone whose browser cannot answer is not.
 */

/** Shape of one entry, as much of it as this app reads. */
interface RelatedApp {
  readonly platform?: string;
  readonly id?: string;
  readonly url?: string;
}

interface RelatedAppsNavigator {
  getInstalledRelatedApps?: () => Promise<readonly RelatedApp[]>;
}

/**
 * True when a related app is installed on this device.
 *
 * Never throws and never rejects: this gates an affordance, and an affordance
 * that can break a screen by asking a question is worse than no affordance.
 */
export async function hasInstalledRelatedApp(): Promise<boolean> {
  const nav = globalThis.navigator as unknown as RelatedAppsNavigator | undefined;
  const ask = nav?.getInstalledRelatedApps;
  if (typeof ask !== 'function') return false;
  try {
    const apps = await ask.call(nav);
    return Array.isArray(apps) && apps.length > 0;
  } catch {
    // A refusal, an insecure context, or a browser that has the method and not
    // the permission. All of them mean "cannot tell", which is `false`.
    return false;
  }
}

/** True when this browser can even be asked. Used only to explain, never to gate. */
export function canAskRelatedApps(): boolean {
  const nav = globalThis.navigator as unknown as RelatedAppsNavigator | undefined;
  return typeof nav?.getInstalledRelatedApps === 'function';
}
