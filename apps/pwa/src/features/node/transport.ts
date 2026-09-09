/**
 * WHAT THIS BROWSER CAN ACTUALLY REACH A NODE OVER.
 *
 * =============================================================================
 * API PRESENCE IS NOT CAPABILITY, AND THAT IS THE WHOLE POINT OF THIS FILE
 * =============================================================================
 * The obvious check is `'serial' in navigator`, and it is wrong in the way that
 * matters most: it says yes on a phone where flashing cannot work, so the
 * driver presses INSTALL, gets an empty device chooser, and concludes the app
 * is broken. From MDN's compatibility data, checked rather than assumed:
 *
 *   chrome                  89
 *   chrome_android          138, PARTIAL - "Serial ports are only available if
 *                           they're provided by Bluetooth RFCOMM serial port
 *                           emulation."
 *   webview_android         NO      (crbug.com/40740509)
 *   safari / safari_ios     NO
 *   firefox                 151
 *
 * Read that second line carefully. On Android, `navigator.serial` EXISTS from
 * Chrome 138 and will never list the ESP32 on the end of a USB cable, because
 * the implementation only surfaces Bluetooth RFCOMM ports. The API answering
 * "yes" is not the API being able to do the job.
 *
 * `webview_android: NO` is the other one worth stating: this app also ships as
 * a TWA, which is an Android WebView, so the installer cannot work inside the
 * installed Android app either. Same URL, same code, no serial.
 *
 * And iOS is not a Safari problem. Every browser on iOS is WebKit underneath -
 * Chrome for iOS included - so there is no browser on an iPhone that can flash
 * a board, and Google's own documentation says so outright: "Currently, iPhone
 * and iPad don't allow USB, Serial, or HID devices to connect to webpages in
 * Chrome."
 *
 * So the honest answer is: FLASHING NEEDS A DESKTOP. This file says that
 * rather than letting somebody find out from an empty chooser.
 *
 * =============================================================================
 * BLUETOOTH IS A DIFFERENT QUESTION WITH A DIFFERENT ANSWER
 * =============================================================================
 * Web Bluetooth works on Android Chrome and on desktop, and not on iOS. It
 * cannot flash anything - the ESP32 bootloader speaks UART only - but it is
 * how you talk to a node that already has firmware. A phone is a perfectly
 * good mesh client and a hopeless flasher, and the screen has to be able to
 * say both at once.
 *
 * =============================================================================
 * NOTHING HERE PROMPTS
 * =============================================================================
 * `requestPort` and `requestDevice` show choosers and must come from a real
 * user gesture. This module only asks questions that can be answered without
 * one: which APIs exist, whether a Bluetooth radio is actually present, and
 * which ports the user has ALREADY granted.
 */

/** The links a secure page can open to a device in the car. */
export type NodeTransport = 'bluetooth' | 'serial';

/** Why serial cannot be used here, or null when it can. */
export type SerialBlock =
  | 'insecure'
  | 'ios'
  | 'android-bluetooth-only'
  | 'webview'
  | 'unsupported'
  | null;

export interface TransportSupport {
  /** Web Bluetooth is present. Managing a node, never flashing one. */
  readonly bluetooth: boolean;
  /** Web Serial is present AND can be expected to see a USB device. */
  readonly serial: boolean;
  /** Why not, when `serial` is false. */
  readonly serialBlock: SerialBlock;
  /**
   * True only on a secure origin.
   *
   * BOTH APIS REQUIRE ONE, and `localhost` counts. Reported separately because
   * it changes what the absence MEANS: on an insecure origin the APIs are not
   * missing, they are withheld, and the remedy is the address bar rather than
   * a different machine.
   */
  readonly secureContext: boolean;
  /** Every transport this browser can open, best first. */
  readonly available: readonly NodeTransport[];
}

interface UserAgentish {
  readonly userAgent?: string;
  readonly platform?: string;
  readonly maxTouchPoints?: number;
}

/**
 * iOS, including iPadOS pretending to be a Mac.
 *
 * iPadOS 13+ reports a desktop Safari user agent, so the touch-point check is
 * what tells a real Mac from an iPad. A Mac reports 0.
 */
export function isIos(nav: UserAgentish | undefined): boolean {
  const ua = nav?.userAgent ?? '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1;
}

/** Android, whether Chrome or a WebView. */
export function isAndroid(nav: UserAgentish | undefined): boolean {
  return /Android/.test(nav?.userAgent ?? '');
}

/**
 * An Android WebView, which is what the installed TWA runs in.
 *
 * `wv` is the marker Chrome puts in a WebView user agent. Not perfect - some
 * WebViews omit it - but a false negative here only means the screen offers
 * something that then finds no ports, which is the state everything else on
 * Android is in anyway.
 */
export function isAndroidWebView(nav: UserAgentish | undefined): boolean {
  const ua = nav?.userAgent ?? '';
  return isAndroid(nav) && (/; wv\)/.test(ua) || /Version\/\d+\.\d+ Chrome/.test(ua));
}

export function transportSupport(
  nav: Navigator | undefined = globalThis.navigator,
): TransportSupport {
  const bag = nav as unknown as (UserAgentish & { bluetooth?: unknown; serial?: unknown }) | undefined;
  const secure = globalThis.isSecureContext === true;

  const bluetooth = secure && bag?.bluetooth !== undefined && bag.bluetooth !== null;
  const hasSerialApi = bag?.serial !== undefined && bag.serial !== null;

  let serialBlock: SerialBlock = null;
  if (!secure) serialBlock = 'insecure';
  else if (isIos(bag)) serialBlock = 'ios';
  else if (isAndroidWebView(bag)) serialBlock = 'webview';
  // ORDER MATTERS: Android is checked before the API test, because on Android
  // the API can be PRESENT and still never show a USB device. Testing for the
  // API first would report serial as available on exactly the devices where it
  // silently cannot work.
  else if (isAndroid(bag)) serialBlock = 'android-bluetooth-only';
  else if (!hasSerialApi) serialBlock = 'unsupported';

  const serial = serialBlock === null;

  const available: NodeTransport[] = [];
  // SERIAL FIRST when it is real: it is the only one that can install
  // firmware, which is the thing somebody came to this screen to do.
  if (serial) available.push('serial');
  if (bluetooth) available.push('bluetooth');

  return { bluetooth, serial, serialBlock, secureContext: secure, available };
}

/**
 * Why serial is unavailable, in words that name the remedy.
 *
 * "Not supported" is the least actionable sentence a screen can print. Each of
 * these says what to change instead.
 */
export function serialBlockReason(block: SerialBlock): string | null {
  switch (block) {
    case null:
      return null;
    case 'insecure':
      return 'this page is not on a secure origin, so the browser withholds serial access.';
    case 'ios':
      return 'no browser on iphone or ipad can talk to usb - chrome for ios is webkit underneath, ' +
        'and apple does not allow it. flashing needs a computer.';
    case 'webview':
      return 'the installed android app runs in a webview, which has no serial support at all. ' +
        'open the site in chrome, or better, flash from a computer.';
    case 'android-bluetooth-only':
      return 'chrome on android exposes serial only for bluetooth serial ports, never for a usb ' +
        'cable - your board will not appear in the chooser. flashing needs a computer.';
    case 'unsupported':
      return 'this browser has no web serial. chrome or edge 89+, or firefox 151+, on a computer.';
  }
}

/** Why there is no way to reach a node at all, or null when there is one. */
export function transportBlocker(support: TransportSupport): string | null {
  if (support.available.length > 0) return null;
  if (!support.secureContext) {
    return 'this page is not on a secure origin, so the browser withholds both bluetooth and serial.';
  }
  return 'this browser can reach a node neither over usb nor over bluetooth.';
}

/** How a transport is named to a driver. */
export const TRANSPORT_LABEL: Readonly<Record<NodeTransport, string>> = {
  bluetooth: 'BLUETOOTH',
  serial: 'USB',
};

/**
 * Ports the user has ALREADY authorised, without prompting.
 *
 * A grant persists for the origin, so a board paired once is remembered. Being
 * able to say "1 device already authorised" before anything is pressed is the
 * difference between a permission screen that reports state and one that only
 * ever asks.
 */
export async function grantedPortCount(
  nav: Navigator | undefined = globalThis.navigator,
): Promise<number> {
  const serial = (nav as unknown as { serial?: { getPorts?: () => Promise<unknown[]> } })?.serial;
  if (serial?.getPorts === undefined) return 0;
  try {
    return (await serial.getPorts()).length;
  } catch {
    return 0;
  }
}

/**
 * Whether a Bluetooth radio is actually present and on.
 *
 * `getAvailability()` is the only question Web Bluetooth answers without a
 * gesture, and it is worth asking: the API existing and the machine having a
 * radio that is switched on are different things, and the difference is the
 * whole gap between "pair" doing nothing and "pair" opening a chooser.
 */
export async function bluetoothAvailable(
  nav: Navigator | undefined = globalThis.navigator,
): Promise<boolean> {
  const bt = (nav as unknown as { bluetooth?: { getAvailability?: () => Promise<boolean> } })
    ?.bluetooth;
  if (bt?.getAvailability === undefined) return false;
  try {
    return await bt.getAvailability();
  } catch {
    return false;
  }
}
