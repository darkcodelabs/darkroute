/**
 * CAN THIS DEVICE FLASH A BOARD.
 *
 * The failure this file exists to prevent is not a crash. It is a driver on a
 * phone pressing INSTALL, getting an empty device chooser, and concluding the
 * app is broken - because `'serial' in navigator` said yes on a device where
 * flashing cannot work.
 *
 * Every expectation below is anchored to MDN's compatibility data rather than
 * to what feels right:
 *
 *   chrome            89
 *   chrome_android    138, PARTIAL - Bluetooth RFCOMM ports only, never USB
 *   webview_android   NO
 *   safari, safari_ios NO
 *   firefox           151
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  bluetoothAvailable,
  grantedPortCount,
  isAndroid,
  isAndroidWebView,
  isIos,
  serialBlockReason,
  transportSupport,
} from './transport.ts';

const secure = (value: boolean): void => {
  (globalThis as unknown as { isSecureContext: boolean }).isSecureContext = value;
};
const original = globalThis.isSecureContext;
afterEach(() => {
  secure(original);
});

const UA = {
  desktop: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36',
  androidWebView:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0 Mobile Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
};

const navWith = (bag: Record<string, unknown>): Navigator => bag as unknown as Navigator;

describe('platform detection', () => {
  it('knows an iphone', () => {
    expect(isIos({ userAgent: UA.iphone })).toBe(true);
  });

  /**
   * iPadOS 13+ reports a DESKTOP Safari user agent. The touch points are the
   * only thing separating it from a real Mac, and getting it wrong offers USB
   * flashing on a device that categorically cannot do it.
   */
  it('sees through an ipad pretending to be a mac', () => {
    expect(isIos({ userAgent: UA.ipad, maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: UA.ipad, maxTouchPoints: 0 })).toBe(false);
  });

  it('tells an android webview from android chrome', () => {
    expect(isAndroid({ userAgent: UA.androidChrome })).toBe(true);
    expect(isAndroidWebView({ userAgent: UA.androidWebView })).toBe(true);
    expect(isAndroidWebView({ userAgent: UA.desktop })).toBe(false);
  });
});

describe('serial', () => {
  it('is available on a desktop with the api', () => {
    secure(true);
    const support = transportSupport(navWith({ userAgent: UA.desktop, serial: {} }));
    expect(support.serial).toBe(true);
    expect(support.serialBlock).toBeNull();
    // Serial first: it is the only transport that can install firmware.
    expect(support.available[0]).toBe('serial');
  });

  /**
   * THE ONE THAT MATTERS MOST. Chrome 138 on Android HAS `navigator.serial`
   * and will never list a USB device, because the implementation only surfaces
   * Bluetooth RFCOMM ports. A presence check reports this device as capable
   * and sends somebody to an empty chooser.
   */
  it('is refused on android even though the api is right there', () => {
    secure(true);
    const support = transportSupport(
      navWith({ userAgent: UA.androidChrome, serial: {}, bluetooth: {} }),
    );
    expect(support.serial).toBe(false);
    expect(support.serialBlock).toBe('android-bluetooth-only');
    // Bluetooth still works on the same device. A phone is a fine mesh client
    // and a hopeless flasher, and the screen has to say both.
    expect(support.bluetooth).toBe(true);
    expect(support.available).toEqual(['bluetooth']);
  });

  it('is refused in the android webview the TWA runs in', () => {
    secure(true);
    const support = transportSupport(navWith({ userAgent: UA.androidWebView, serial: {} }));
    expect(support.serialBlock).toBe('webview');
  });

  it('is refused on ios, where no browser can do it', () => {
    secure(true);
    // Chrome for iOS is WebKit underneath, so shipping `serial` here would
    // still be a lie. Tested WITH the api present for exactly that reason.
    const support = transportSupport(navWith({ userAgent: UA.iphone, serial: {} }));
    expect(support.serialBlock).toBe('ios');
  });

  it('is refused on an insecure origin before anything else is considered', () => {
    secure(false);
    const support = transportSupport(navWith({ userAgent: UA.desktop, serial: {}, bluetooth: {} }));
    expect(support.serialBlock).toBe('insecure');
    expect(support.available).toEqual([]);
  });

  it('is refused on a desktop browser without the api', () => {
    secure(true);
    expect(transportSupport(navWith({ userAgent: UA.desktop })).serialBlock).toBe('unsupported');
  });
});

describe('the reason names a remedy', () => {
  it('never just says "not supported"', () => {
    // "Not supported" is the least actionable sentence a screen can print.
    expect(serialBlockReason('ios')).toContain('computer');
    expect(serialBlockReason('android-bluetooth-only')).toContain('computer');
    expect(serialBlockReason('webview')).toContain('chrome');
    expect(serialBlockReason('insecure')).toContain('secure origin');
    expect(serialBlockReason('unsupported')).toContain('firefox');
    expect(serialBlockReason(null)).toBeNull();
  });

  it('tells an android user their board will not appear, not that it is unsupported', () => {
    // The trap is that it LOOKS supported. The copy has to name that.
    expect(serialBlockReason('android-bluetooth-only')).toContain('will not appear');
  });
});

describe('already-granted state', () => {
  it('counts ports the user authorised earlier, without prompting', async () => {
    const count = await grantedPortCount(
      navWith({ serial: { getPorts: async () => Promise.resolve([{}, {}]) } }),
    );
    expect(count).toBe(2);
  });

  it('reports zero rather than throwing when there is no api', async () => {
    await expect(grantedPortCount(navWith({}))).resolves.toBe(0);
  });

  it('asks whether a radio is actually on, not just whether the api exists', async () => {
    // The API existing and the machine having a radio that is switched on are
    // different things, and the difference is whether PAIR opens a chooser.
    await expect(
      bluetoothAvailable(navWith({ bluetooth: { getAvailability: async () => Promise.resolve(false) } })),
    ).resolves.toBe(false);
    await expect(
      bluetoothAvailable(navWith({ bluetooth: { getAvailability: async () => Promise.resolve(true) } })),
    ).resolves.toBe(true);
    await expect(bluetoothAvailable(navWith({}))).resolves.toBe(false);
  });
});
