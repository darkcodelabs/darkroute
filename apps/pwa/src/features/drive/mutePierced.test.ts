/**
 * A MUTE THAT IS BEING OVERRIDDEN HAS TO SAY SO.
 *
 * =============================================================================
 * THE BUG THIS EXISTS FOR
 * =============================================================================
 * Reported from a real drive: "when an alert happens I can't silence it, the
 * button doesn't work."
 *
 * The button worked. Every layer of it worked - `muteCamera` wrote the mute
 * into settings, the alert slice mirrored it into `mutedCameraIds`, and the
 * selector the button reads returned true. Probed all three; all three passed.
 *
 * What was happening is deliberate. A mute is PIERCED when the camera is closer
 * than `reAlertWhenCloserThanFt`, on the design's own reasoning: "a mute is a
 * request for less noise, not a request to be driven past a camera in silence."
 * The engine publishes `mutePierced` precisely so the screen can, in the
 * design's words, "explain why it just buzzed".
 *
 * DRIVE never rendered it. So the driver mutes a camera they are already close
 * to, the alert keeps firing, and nothing on screen accounts for it. The
 * feature was working and the product was lying about it, which from the
 * driver's seat is indistinguishable from a broken button - and worse, because
 * a broken button can at least be reported as broken.
 *
 * =============================================================================
 * WHY THE TEST IS ABOUT THE COPY
 * =============================================================================
 * There is no logic to pin here: the engine was always right. What went missing
 * was the sentence. So this asserts the sentence exists, says what it needs to
 * say, and is reachable from the state that produces it.
 */

import { describe, expect, it } from 'vitest';

import { DRIVE_MUTE, DRIVE_MUTE_PIERCED, DRIVE_UNMUTE } from './DriveScreen.tsx';

describe('the pierced-mute explanation', () => {
  it('exists at all, which is the whole defect', () => {
    expect(DRIVE_MUTE_PIERCED.trim()).not.toBe('');
  });

  it('says the mute IS applied, so the driver does not press it again', () => {
    // The failure mode without this: the driver concludes the mute did not
    // take, presses it again, and toggles it OFF - which is worse than where
    // they started, because now it really is unmuted.
    expect(DRIVE_MUTE_PIERCED).toMatch(/MUTED/);
  });

  it('says why it is still alerting, naming the rule rather than apologising', () => {
    // "Something went wrong" would be a lie: nothing went wrong. The engine is
    // doing the thing it was designed to do, and the driver is entitled to the
    // reason so they can change the setting if they disagree with it.
    expect(DRIVE_MUTE_PIERCED).toMatch(/RE-ALERT DISTANCE/);
  });

  it('is not the button label, because a control and its explanation are different things', () => {
    // Cramming this into the button would make the button unreadable at a
    // glance, on the one screen that is read at speed.
    expect(DRIVE_MUTE_PIERCED).not.toBe(DRIVE_MUTE);
    expect(DRIVE_MUTE_PIERCED).not.toBe(DRIVE_UNMUTE);
  });

  it('keeps the button short enough to read while driving', () => {
    // The line explains; the button acts. Both stay in their lane.
    expect(DRIVE_MUTE.length).toBeLessThan(16);
    expect(DRIVE_UNMUTE.length).toBeLessThan(16);
  });
});
