/**
 * ESCAPE CLOSES THE TOPMOST SURFACE, AND ONLY THAT ONE.
 *
 * =============================================================================
 * THE REGRESSION THIS FILE EXISTS FOR
 * =============================================================================
 * DRIVE's map control panel binds its own `document` keydown for Escape. When
 * this hook bound another on the same phase, registration order decided the
 * outcome: the panel mounts with the screen and the overlay mounts later, so
 * ONE Escape press closed the report sheet AND the unrelated panel behind it,
 * and the sheet's focus restore then overwrote the panel's.
 *
 * Reading `event.defaultPrevented` did not prevent it. That guard was
 * one-directional - it checked a flag this hook never set - so it caught a view
 * that answers Escape through React (v0's INTEL card, which calls
 * preventDefault) and did nothing at all about a peer listener on `document`.
 *
 * The fix is the capture phase plus marking the event handled. Neither half is
 * enough alone, so both are asserted here rather than assumed: capture makes an
 * open overlay answer BEFORE anything beneath it whatever the mount order, and
 * stopping the event is what keeps the surface underneath from acting too.
 *
 * This is deliberately written against a PEER DOCUMENT LISTENER rather than
 * against MapControlPanel itself. The panel needs a map, and a map needs tiles
 * from another origin - so the real pairing cannot be driven in this
 * environment, and a test that needs the network is a test that gets deleted.
 * What is reproduced here is the mechanism, which is the part that broke.
 */

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useOverlayDismiss } from './useOverlayDismiss.ts';

const peers: (() => void)[] = [];

afterEach(() => {
  for (const remove of peers.splice(0)) remove();
});

/** A surface underneath, listening the way MapControlPanel does. */
function listenBeneath(): { fired: () => number } {
  let count = 0;
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') count += 1;
  };
  document.addEventListener('keydown', onKey);
  peers.push(() => {
    document.removeEventListener('keydown', onKey);
  });
  return { fired: () => count };
}

function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

describe('escape and the surface underneath', () => {
  it('closes the overlay without also closing what is beneath it', () => {
    // The peer registers FIRST, exactly as the panel does: it belongs to the
    // screen, and the overlay is raised over it afterwards. Before the fix this
    // ordering is what made the panel win the race and close too.
    const beneath = listenBeneath();
    const close = vi.fn();
    renderHook(() => useOverlayDismiss(close));

    pressEscape();

    expect(close).toHaveBeenCalledTimes(1);
    expect(beneath.fired()).toBe(0);
  });

  it('marks the event handled so nothing downstream acts on it either', () => {
    const close = vi.fn();
    renderHook(() => useOverlayDismiss(close));

    const event = pressEscape();

    // `defaultPrevented` is the flag this hook used to READ and never SET,
    // which is precisely why its own guard could not protect a peer.
    expect(event.defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('leaves the surface underneath alone once the overlay has unmounted', () => {
    const beneath = listenBeneath();
    const close = vi.fn();
    const { unmount } = renderHook(() => useOverlayDismiss(close));

    unmount();
    pressEscape();

    // A listener that outlives its overlay would silently eat Escape for every
    // surface beneath it for the rest of the session.
    expect(close).not.toHaveBeenCalled();
    expect(beneath.fired()).toBe(1);
  });

  it('ignores keys that are not Escape', () => {
    const close = vi.fn();
    renderHook(() => useOverlayDismiss(close));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

    expect(close).not.toHaveBeenCalled();
  });
});
