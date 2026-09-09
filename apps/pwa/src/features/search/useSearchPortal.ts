/**
 * WHERE THE SEARCH PANEL'S DOM ACTUALLY LIVES, and why it is not where the
 * component that owns it lives.
 *
 * =============================================================================
 * TWO ANCESTORS BREAK THE PANEL, AND ONLY IN LANDSCAPE
 * =============================================================================
 * `features/chrome/TopBar.tsx` is the panel's host: it owns the query, the
 * place book, the on-device hits and the lookup results, and the brief's
 * one-component rule says it stays that way. But the bar is mounted deep inside
 * DRIVE, and on the landscape surface two rules between it and the viewport
 * make its subtree the wrong place for the panel's ELEMENTS to sit:
 *
 *   `drive.css`     `[data-fwm-surface='dash'] .fwm-drive-top { display: none }`
 *                   -- "NO TOP BAR IN LANDSCAPE", which is correct and stays.
 *                   `display: none` is not an unmount, so React state survives
 *                   it; the DOM does not. A hidden subtree has no layout, so a
 *                   scrolled list silently returns to the top, and a browser
 *                   moves focus to `<body>` when the focused element is hidden.
 *                   That stylesheet's own header admits the cost: "A driver who
 *                   was typing and rotated keeps their query and loses their
 *                   caret."
 *
 *   `global.css`    `[data-fwm-surface='dash'] ... .fwm-shell-screen` sets
 *                   `backdrop-filter: var(--dr-blur)`. A filtered element is a
 *                   CONTAINING BLOCK FOR `position: fixed` DESCENDANTS -- so
 *                   the panel, which `searchPanel.css` fixes to the viewport
 *                   because "it anchors itself to the PHONE rather than to this
 *                   bar", would silently start anchoring to the content column
 *                   instead. Its `left: 68` would become 68 past the column's
 *                   own left edge.
 *
 * Neither is a bug in the file that has it. Both are correct rules about the
 * surface they belong to, and both are fatal to an element that has to be fixed
 * to the viewport and visible while its host is hidden.
 *
 * =============================================================================
 * SO THE PANEL IS PORTALLED, AND THAT IS WHAT MAKES ROTATION A REFLOW
 * =============================================================================
 * "ROTATING NEVER RESETS. Query text, caret position, scroll offset, selected
 * route and keyboard focus all survive rotation. It is a reflow, not a remount."
 *
 * A portal is the only arrangement that delivers all five, because the two
 * halves of the problem want opposite things:
 *
 *   THE STATE must stay in `TopBar`, which is never unmounted by a rotation --
 *   `surface.ts` rewrites one attribute on `<html>` and React re-renders. Query
 *   and the picked route are React state and survive by construction.
 *
 *   THE ELEMENTS must stay OUT of `TopBar`'s DOM position, because that
 *   position is hidden in one of the two orientations. Caret, scroll offset and
 *   focus are properties of live DOM nodes, and they survive only if the nodes
 *   are never hidden, never detached and never re-created.
 *
 * One React tree, one state object, one element -- reparented to a container
 * that no surface rule ever touches. Rotating changes `data-fwm-orient` on the
 * panel and nothing else moves, which is the definition of a reflow.
 *
 * =============================================================================
 * WHY `document.body` AND NOT A SLOT IN `App.tsx`
 * =============================================================================
 * A slot would be a second thing to keep in sync: a container rendered by one
 * component and filled by another, with an ordering dependency between them on
 * first paint and an empty box left behind on every screen that has no bar.
 * `DriveScreen.tsx`'s header records the app already trying that shape once --
 * it "resolved `.fwm-shell-dock` in an effect and `createPortal`d" into a slot
 * somebody else was also filling, and got two docks.
 *
 * A container this module creates and owns cannot be double-filled, cannot be
 * hidden by a rule written about somewhere else, and disappears with the last
 * host that wanted one.
 *
 * INHERITANCE COSTS NOTHING HERE, which is the reason this is safe. Every token
 * the panel reads is declared on `:root` in `tokens.css` -- including the three
 * `--fwm-font-ui` overrides, which SETTINGS writes on the root element -- and
 * `searchPanel.css` sets `font-family: var(--fwm-font-ui)` on the panel itself
 * rather than inheriting one. Nothing the panel draws comes from an ancestor
 * class, so it draws identically wherever it is parented.
 */

import { useEffect, useState } from 'react';

/**
 * The container's class, so the stylesheet has something to name. It carries no
 * geometry of its own -- the panel inside it is `position: fixed` and decides
 * everything -- only the guarantee that this box never eats a press meant for
 * the map behind it.
 */
export const SEARCH_PORTAL_CLASS = 'fwm-search-portal';

/*
 * ONE CONTAINER FOR THE WHOLE APPLICATION, refcounted.
 *
 * There is one panel, so in practice there is one caller. It is refcounted
 * anyway for the same reason `useSurface.ts` refcounts its watcher: the cost of
 * being wrong about "there is only ever one" is a container left in the
 * document after its host unmounted, which is invisible, permanent, and exactly
 * the kind of leak nothing fails on.
 */
let container: HTMLElement | null = null;
let hosts = 0;

function acquire(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  hosts += 1;
  if (container === null) {
    container = document.createElement('div');
    container.className = SEARCH_PORTAL_CLASS;
    document.body.append(container);
  }
  return container;
}

function release(): void {
  hosts -= 1;
  if (hosts > 0 || container === null) return;
  container.remove();
  container = null;
}

/**
 * The element to portal the panel into, or `null` before the first effect has
 * run and on a server render.
 *
 * `null` on the first render is not a flaw to work around with a layout effect.
 * The panel is raised by a press, and there is no press before the first paint;
 * by the time anybody can open it the container has existed for one commit.
 */
export function useSearchPortal(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(acquire());
    return () => {
      release();
      setHost(null);
    };
  }, []);
  return host;
}

/**
 * Test-only. Drops the shared container so one test's portal cannot outlive its
 * `cleanup()` and be found by the next test's queries.
 */
export function resetSearchPortalForTests(): void {
  container?.remove();
  container = null;
  hosts = 0;
}
