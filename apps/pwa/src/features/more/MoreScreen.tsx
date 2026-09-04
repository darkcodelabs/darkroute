/**
 * MORE - v1's hub for the destinations that do not need a permanent dock key.
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isMore` block.
 *
 * =============================================================================
 * WHY THIS SCREEN EXISTS
 * =============================================================================
 * v0 carries LOOKUP and ASK as dock keys and reaches SETTINGS, TRIAGE, HELP,
 * OFFLINE and ADMIN by URL or by a link buried in another screen. v1 puts all
 * seven behind one key. LOOK UP also has a direct Search dock key now; both
 * routes select the same screen. Keeping the tile preserves the hub's complete
 * index without making the dock the only way to discover search.
 *
 * =============================================================================
 * EVERY SUBTITLE IS READ
 * =============================================================================
 * The design writes "41 documented cases", "6 radios near you", "132k cameras
 * cached, 3 reports queued". Those are the design's placeholders and none of
 * them ships. Each tile and row here either reports a live count or says
 * nothing - a hub whose subtitles are fiction teaches a driver to distrust
 * every number in the product, and the numbers are the product.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { applyMode, isWatchSurface, resolveMode } from '../../app/mode.ts';
import type { FwmMode } from '../../app/mode.ts';
import { currentSurface } from '../../app/surface.ts';
import { openScreen } from '../../app/screenState.ts';
import { useSettingsStore } from '../../stores/index.ts';
import type { ScreenId } from '../../app/screenState.ts';
import { countyRecords } from '../../services/records/countyRecords.ts';
import { installController } from '../../services/pwa/installRegistry.ts';
import { hasInstalledRelatedApp } from '../../services/pwa/relatedApps.ts';
import type { InstallPromptStatus } from '../../services/pwa/installPrompt.ts';
import {
  useCachedCameraCount,
  useHeldReportCount,
  useIsPresenceLive,
  useNearbyDarkrouteCount,
  useOwnerTypesEnabled,
  usePendingSyncCount,
} from '../../stores/index.ts';
import { useAdmin } from '../admin/useAdmin.ts';
import { ReloadTitle } from '../../components/nav';

import './more.css';

export const MORE_TITLE = 'Everything else';

/**
 * THE LIGHT/DARK DEMO, and why it is two buttons rather than seventeen.
 *
 * SETTINGS already offers every mode as a swatch grid. This is not that: it is
 * the one comparison somebody actually wants to make on the way past - does
 * this thing look right in daylight - answered in one tap without leaving the
 * hub. `refinement` is the only LIGHT palette in the set (tokens.css says so
 * out loud) and `neon-grid` is the default dark one, so those are the two ends.
 */
export const THEME_DEMO_TITLE = 'Light and dark';
export const THEME_DEMO_SUB = 'switch the whole app, right here';
export const THEME_DEMO_LIGHT = 'Light';
export const THEME_DEMO_DARK = 'Dark';

/** The two ends of the demo. Both are real `FwmMode` ids. */
export const THEME_DEMO_MODES = { light: 'refinement', dark: 'neon-grid' } as const;

/**
 * Said instead of the buttons on a watch.
 *
 * `resolveMode` FORCES `night-watch` on an always-on face, so these buttons
 * would paint nothing and look broken. A control that does nothing is worse
 * than a control that says why it is not there.
 */
export const THEME_DEMO_WATCH = 'the watch face holds night watch; skins are for the phone.';

/** Said when neither end is selected, because SETTINGS offers fifteen others. */
export const THEME_DEMO_OTHER = 'a different skin is on - pick an end to switch.';

export const INSTALL_LABEL = 'Install on this phone';
export const INSTALL_SUB = 'a home-screen shortcut and standalone window';

/** Said when the browser has no `beforeinstallprompt` - Firefox, every iOS browser. */
export const INSTALL_MANUAL_SUB = 'use your browser menu: add to home screen';
export const INSTALLED_LABEL = 'Installed';
export const INSTALLED_SUB = 'running from your home screen';

/**
 * SAID WHEN THE COPY IS ON THE PHONE BUT YOU ARE IN A TAB.
 *
 * Chrome does not fire `beforeinstallprompt` for an app the device already
 * has, so the controller reports `no-event` and this screen fell through to
 * the manual row - telling somebody to add a home-screen icon they already
 * have. It is the right answer to the wrong question: the reason there is no
 * install offer is not that the browser cannot make one.
 *
 * `getInstalledRelatedApps()` is what tells the two apart, which is what the
 * manifest's `related_applications` entry exists to make answerable.
 */
/**
 * WHY THERE IS NO INSTALL OFFER, said out loud.
 *
 * The card had exactly two states - "Install" and the browser-menu fallback -
 * so every other reason the controller can give collapsed into "use your
 * browser menu", which is wrong for most of them and unanswerable for all of
 * them. Somebody who declined Chrome's own sheet once got a screen that told
 * them to add a home-screen icon by hand, forever, with nothing saying why.
 *
 * The controller has always known the reason. This prints it.
 */
export const INSTALL_WHY: Readonly<Record<string, string>> = Object.freeze({
  'first-session': 'ask again after another launch or two.',
  'recently-declined': 'you backed out of the install sheet. we will offer again shortly.',
  'already-dismissed': 'you asked us not to offer this again.',
  'alert-active': 'not while a camera alert is live.',
});

export const INSTALL_ASK_AGAIN = 'Offer it again';

export const INSTALL_ELSEWHERE_LABEL = 'Already on this phone';
export const INSTALL_ELSEWHERE_SUB = 'open DarkRoute from your home screen';

/** A subtitle that has no number to report says nothing rather than guessing. */
const SILENT = '';

interface Tile {
  readonly kicker: string;
  readonly label: string;
  readonly sub: string;
  readonly screen: ScreenId;
  readonly hue: 'warn' | 'mesh' | 'ok' | 'scan';
}

interface Row {
  readonly label: string;
  readonly sub: string;
  readonly screen: ScreenId;
  readonly hue: 'warn' | 'mesh' | 'ok' | 'scan' | 'muted';
}

/**
 * Two buttons that repaint the whole app, and the honest states around them.
 *
 * WRITES THROUGH THE SAME PAIR SETTINGS USES - `setMode` then `applyMode` -
 * rather than touching `data-fwm-mode` itself. `mode.ts` is explicit that the
 * attribute is written synchronously by `applyMode` before the first paint and
 * that nothing else may write it; a second writer here is how the store and
 * the DOM start disagreeing about what skin is on. Store first, then apply, so
 * the skin changes on the press rather than one paint later.
 */
function ThemeDemo(): ReactElement {
  const mode = useSettingsStore((state) => state.mode);
  const [surface, setSurface] = useState(() => currentSurface());

  useEffect(() => {
    // The surface can change under a running app - a phone cast to a dash, a
    // watch companion - and the watch rule below depends on it.
    setSurface(currentSurface());
  }, []);

  const forced = isWatchSurface(surface) || resolveMode(mode, surface).reason === 'forced-watch';

  const pick = useCallback(
    (next: FwmMode): void => {
      if (isWatchSurface(surface)) return;
      useSettingsStore.getState().setMode(next);
      applyMode(next, surface);
    },
    [surface],
  );

  const isLight = mode === THEME_DEMO_MODES.light;
  const isDark = mode === THEME_DEMO_MODES.dark;

  return (
    <div className="fwm-more-theme">
      <span className="fwm-more-theme-label">{THEME_DEMO_TITLE}</span>
      <span className="fwm-more-theme-sub fwm-data">
        {forced ? THEME_DEMO_WATCH : !isLight && !isDark ? THEME_DEMO_OTHER : THEME_DEMO_SUB}
      </span>
      {/* A RADIO GROUP, not two toggles: they are mutually exclusive ends of
          one setting, and a screen reader should hear them that way. */}
      <div className="fwm-more-theme-keys" role="radiogroup" aria-label={THEME_DEMO_TITLE}>
        <button
          type="button"
          className="fwm-more-theme-key"
          role="radio"
          aria-checked={isLight}
          disabled={forced}
          data-fwm-selected={String(isLight)}
          data-fwm-theme-end="light"
          onClick={() => {
            pick(THEME_DEMO_MODES.light);
          }}
        >
          {THEME_DEMO_LIGHT}
        </button>
        <button
          type="button"
          className="fwm-more-theme-key"
          role="radio"
          aria-checked={isDark}
          disabled={forced}
          data-fwm-selected={String(isDark)}
          data-fwm-theme-end="dark"
          onClick={() => {
            pick(THEME_DEMO_MODES.dark);
          }}
        >
          {THEME_DEMO_DARK}
        </button>
      </div>
    </div>
  );
}

export function MoreScreen(): ReactElement {
  const cameras = useCachedCameraCount();
  const held = useHeldReportCount();
  const pending = usePendingSyncCount();
  /**
   * PRESENCE IS OFF IN THIS BUILD (`config/features.ts`), so `nearbyCount` is
   * a standing zero rather than a measurement. "0 radios heard" would be this
   * screen reporting a sweep that never ran, which is the one thing a hub full
   * of counts must not do - so the count is only spoken when presence is
   * actually live, and the row describes the feature otherwise.
   */
  const presenceLive = useIsPresenceLive();
  const peers = useNearbyDarkrouteCount();
  const owners = useOwnerTypesEnabled();
  const identity = useAdmin();

  const [install, setInstall] = useState<InstallPromptStatus | null>(null);

  // The controller is App's. It may be absent (tests, watch surfaces, a build
  // that disabled it) and the screen simply draws the manual row then.
  useEffect(() => {
    const controller = installController();
    if (controller === null) return undefined;
    setInstall(controller.status());
    return controller.subscribe(setInstall);
  }, []);

  /** What the controller is holding, when it is holding something explainable. */
  const refusalNote = install === null ? null : (INSTALL_WHY[install.reason] ?? null);

  const onAskAgain = useCallback(() => {
    void installController()?.allowAgain();
  }, []);

  const onInstall = useCallback(() => {
    // MUST be inside the gesture: the browser refuses a prompt raised anywhere
    // else, and `prompt()` returns `blocked` rather than throwing when it is.
    void installController()?.prompt();
  }, []);

  const queued = held + pending;
  const installable = install?.canPrompt === true;
  const installed = install?.installed === true;

  /**
   * A copy on the device, seen from a browser tab.
   *
   * Asked once on mount and never again: it is a question about what is on the
   * phone, not about anything on this screen.
   */
  const [installedElsewhere, setInstalledElsewhere] = useState(false);
  useEffect(() => {
    let live = true;
    void hasInstalledRelatedApp().then((found) => {
      if (live) setInstalledElsewhere(found);
    });
    return () => {
      live = false;
    };
  }, []);

  /** How many owner types are still switched on, which is what TRIAGE sets. */
  const ownersOn = Object.values(owners).filter(Boolean).length;

  /**
   * How many documented cases are on file.
   *
   * Read straight off the record index rather than held in state: the file
   * loads once and the number never changes afterwards, so a subscription
   * would be machinery for a constant.
   */
  const misuseCount = countyRecords.all().length;

  const tiles: readonly Tile[] = [
    {
      kicker: 'MISUSE',
      label: 'Who abused it',
      // NOTHING until the file is loaded. "0 documented cases" is a claim about
      // American policing this app has not earned.
      sub: misuseCount === 0 ? SILENT : `${String(misuseCount)} documented cases`,
      screen: 'misuse',
      hue: 'warn',
    },
    {
      kicker: 'INTERRUPTIONS',
      label: 'Alert diet',
      sub: `${String(ownersOn)} owner types on`,
      screen: 'triage',
      hue: 'warn',
    },
    {
      kicker: 'RECEIPTS',
      label: 'What it knows',
      sub: 'answers with file paths',
      screen: 'help',
      hue: 'ok',
    },
    {
      kicker: 'ASK',
      label: 'Hands free',
      sub: 'spoken, matched on the phone',
      screen: 'ask',
      hue: 'scan',
    },
    {
      kicker: 'LOOK UP',
      label: 'Find a camera',
      // The one search in this product that never leaves the device, which is
      // the whole reason it is worth having a tile.
      sub: cameras === null ? SILENT : `searches ${String(cameras)} on this phone`,
      screen: 'lookup',
      hue: 'scan',
    },
  ];

  const rows: Row[] = [
    {
      // FIRST, above settings. The question this row answers - "why should I
      // believe any of this" - is asked before somebody goes looking for a
      // preferences screen, and a transparency route buried under Settings is
      // a transparency route nobody finds.
      label: 'How this works',
      sub: 'the docs, the data, and the commit this build came from',
      screen: 'docs',
      hue: 'scan',
    },
    {
      label: 'Settings and themes',
      sub: 'distance, palette, wipe',
      screen: 'settings',
      hue: 'scan',
    },
    {
      label: 'Offline readiness',
      sub:
        queued === 0
          ? 'what still works with no signal'
          : `${String(queued)} report${queued === 1 ? '' : 's'} waiting to send`,
      screen: 'offline',
      hue: 'ok',
    },
    {
      label: 'Mesh radios',
      sub: !presenceLive
        ? 'off-grid chat, no sim and no account'
        : peers === 0
          ? 'no radios heard'
          : `${String(peers)} heard nearby`,
      screen: 'node',
      hue: 'mesh',
    },
  ];

  /*
   * ADMIN IS NOT A ROW EVERYBODY SEES.
   *
   * It used to render unconditionally, with the sub text switching to "needs an
   * access identity" for anybody who was not a moderator. That is a fine
   * developer affordance and the wrong thing to publish: it tells every visitor
   * that a moderator surface exists and invites them to go and rattle it.
   * `AdminLink.tsx:29` already had the right rule - `if (!identity.admin) return
   * null` - and this list did not.
   *
   * It also settles the two-host question without any hostname logic. Admin
   * stays on the Access-gated host; the public one carries no
   * `Cf-Access-Jwt-Assertion` header, so `verifyAccess` returns null,
   * `isAdmin` is false, and the row simply is not there. The existing
   * fail-closed auth does the work, and nothing has to know which domain it is
   * running on - which is the version that cannot drift when a domain changes.
   */
  if (identity.admin) {
    rows.push({
      label: 'Admin',
      sub: 'moderator tools',
      screen: 'admin',
      hue: 'muted',
    });
  }

  return (
    <section className="fwm-more" aria-label="more">
      {/* =====================================================================
          NO BACK KEY HERE, AND THAT IS THE DECISION RATHER THAN AN OMISSION.
          =====================================================================
          Every screen behind this hub now draws `BackKey` pointed at MORE.
          MORE is where those arrows END. It is a dock key in v1 - the dock
          lights it while you stand on it - so it is a root in exactly the way
          DRIVE, LOG and MESH are, and the only parent it could name is itself.
          An arrow that navigates to the screen you are already looking at is
          not a way out, it is a control that does nothing.

          There is no v0 case to answer either: v0's dock has no hub key and
          nothing under v0 navigates to this id, so `?screen=more` on the old
          skin renders the unbuilt placeholder and never this screen.

          The way off MORE is the dock, three keys of it, all going somewhere
          else. That is the same answer iOS and Android give for a tab root.
          ================================================================== */}
      <ReloadTitle title={MORE_TITLE} className="fwm-more-title" />

      {/* THE INSTALL CARD, in all three of its real states. Installed is not the
          same as installable, and neither is the same as a browser that has no
          install event at all - drawing one button for three situations is how
          a driver ends up tapping something that cannot work. */}
      {installed ? (
        <p className="fwm-more-install" data-fwm-install="installed">
          <span className="fwm-more-install-label">{INSTALLED_LABEL}</span>
          <span className="fwm-more-install-sub fwm-data">{INSTALLED_SUB}</span>
        </p>
      ) : installable ? (
        <button
          type="button"
          className="fwm-more-install"
          data-fwm-install="ready"
          onClick={onInstall}
        >
          <span className="fwm-more-install-label">{INSTALL_LABEL}</span>
          <span className="fwm-more-install-sub fwm-data">{INSTALL_SUB}</span>
        </button>
      ) : installedElsewhere ? (
        /* The device HAS it; this is a tab. Saying "add to home screen" here
           tells somebody to make a second icon they already own. */
        <p className="fwm-more-install" data-fwm-install="elsewhere">
          <span className="fwm-more-install-label">{INSTALL_ELSEWHERE_LABEL}</span>
          <span className="fwm-more-install-sub fwm-data">{INSTALL_ELSEWHERE_SUB}</span>
        </p>
      ) : refusalNote !== null ? (
        /* A GATE SAID NO, AND IT SAYS WHICH. A refusal the app is holding is
           the one case with a way back, so it carries the button. */
        <div className="fwm-more-install" data-fwm-install="refused">
          <span className="fwm-more-install-label">{INSTALL_LABEL}</span>
          <span className="fwm-more-install-sub fwm-data">{refusalNote}</span>
          {install?.reason === 'already-dismissed' ? (
            <button type="button" className="fwm-more-install-again" onClick={onAskAgain}>
              {INSTALL_ASK_AGAIN}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="fwm-more-install" data-fwm-install="manual">
          <span className="fwm-more-install-label">{INSTALL_LABEL}</span>
          <span className="fwm-more-install-sub fwm-data">{INSTALL_MANUAL_SUB}</span>
        </p>
      )}

      {/* THE LIGHT/DARK DEMO. Sits above the destinations because it acts on
          the screen you are standing on rather than sending you somewhere. */}
      <ThemeDemo />

      <div className="fwm-more-tiles">
        {tiles.map((tile) => (
          <button
            type="button"
            key={tile.screen}
            className="fwm-more-tile"
            data-fwm-hue={tile.hue}
            onClick={() => {
              openScreen(tile.screen);
            }}
          >
            <span className="fwm-more-tile-kicker fwm-data">{tile.kicker}</span>
            <span className="fwm-more-tile-label">{tile.label}</span>
            {tile.sub === SILENT ? null : (
              <span className="fwm-more-tile-sub fwm-data">{tile.sub}</span>
            )}
          </button>
        ))}
      </div>

      <ul className="fwm-more-rows" aria-label="more destinations">
        {rows.map((row) => (
          <li key={row.screen}>
            <button
              type="button"
              className="fwm-more-row"
              data-fwm-hue={row.hue}
              onClick={() => {
                openScreen(row.screen);
              }}
            >
              <span className="fwm-more-dot" aria-hidden="true" />
              <span className="fwm-more-row-where">
                <span className="fwm-more-row-label">{row.label}</span>
                <span className="fwm-more-row-sub fwm-data">{row.sub}</span>
              </span>
              <span className="fwm-more-row-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="fwm-more-replay"
        onClick={() => {
          openScreen('onboarding');
        }}
      >
        Replay intro
      </button>
    </section>
  );
}
