/**
 * THE PAGE TITLE, AS A CONTROL.
 *
 * The bug this component was written for is that DRIVE's wordmark reloaded and
 * thirteen other titles were dead words, so these assert the four things that
 * make a title a control rather than a decoration -
 *
 *   it RELOADS, through `location`, with no screen having to remember to;
 *   it is a REAL BUTTON, so it is focusable and reachable from a keyboard;
 *   it SAYS WHAT IT DOES before it is pressed, because "Settings, button" does
 *     not warn anybody that pressing it throws the page away;
 *   it is STILL A HEADING, so the thirteen screens that had an `h1` keep one.
 *
 * The 44px target is asserted in `reloadTitle.source.test.ts` off the CSS rule
 * rather than here: jsdom has no layout engine, so `getBoundingClientRect` is
 * 0x0 for everything and a test that read it would pass on a broken build. The
 * real measurement is the headless pass.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RELOAD_PROMISE, ReloadTitle, reloadTitleLabel } from './ReloadTitle.tsx';

/**
 * jsdom refuses to navigate and will not let `location.reload` be spied on, so
 * the whole object is stubbed. `unstubGlobals: true` in vitest.config.ts puts
 * the real one back after every test.
 */
function stubReload(): ReturnType<typeof vi.fn> {
  const reload = vi.fn();
  vi.stubGlobal('location', { reload });
  return reload;
}

describe('ReloadTitle', () => {
  it('reloads the page when the title is pressed', () => {
    const reload = stubReload();
    render(<ReloadTitle title="Settings" className="fwm-settingsv1-title" />);

    fireEvent.click(screen.getByRole('button', { name: reloadTitleLabel('Settings') }));

    expect(reload, 'the title did nothing, which is what twelve screens shipped').toHaveBeenCalledTimes(
      1,
    );
  });

  it('says that it reloads before it is pressed, not after', () => {
    render(<ReloadTitle title="Settings" className="fwm-settingsv1-title" />);

    const key = screen.getByRole('button', { name: reloadTitleLabel('Settings') });
    // "Settings, button" tells a screen-reader user that something will happen
    // and not what. Reloading is destructive; it gets named.
    expect(key.getAttribute('aria-label')).toBe(`Settings - ${RELOAD_PROMISE}`);
    expect(key.getAttribute('aria-label')).not.toBe('Settings');
  });

  it('shows the title and only the title', () => {
    render(<ReloadTitle title="Everything else" className="fwm-more-title" />);

    // The promise is spoken, never drawn: the screen's name is what is on the
    // screen, and a visible "- reload this page" would be a caption nobody
    // asked for on all fourteen pages.
    expect(screen.getByRole('button').textContent).toBe('Everything else');
  });

  it('is still a heading, carrying the screen its own title class', () => {
    const { container } = render(<ReloadTitle title="Mesh" className="fwm-mesh-title" />);

    // Both halves matter. The `h1` is what a heading-navigation user finds the
    // top of the screen with, and the class is what the feature stylesheet
    // types it through - drop either and "make the title tappable" has quietly
    // cost the screen its title.
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.tagName).toBe('H1');
    expect(heading.className).toBe('fwm-mesh-title');
    expect(container.querySelector('h1 > button.fwm-reloadtitle')).not.toBeNull();
  });

  it('is a button that cannot submit a form it is standing in', () => {
    render(<ReloadTitle title="Ask" className="fwm-askv1-title" />);

    // `type` defaults to "submit" on a bare <button>. REPORT is a form and the
    // next screen with a form would post it by having its own title pressed.
    const key = screen.getByRole('button');
    expect(key.getAttribute('type')).toBe('button');
    // Focusable from the keyboard: it is a real button with no tabindex taken
    // off it, which a <span onClick> would not be.
    expect(key.getAttribute('tabindex')).toBeNull();
  });

  it('publishes that it is a reload key on the element', () => {
    render(<ReloadTitle title="Docs" className="fwm-docs-title" />);

    // What the headless pass reads to prove every page's title is a control,
    // without pressing one and losing the page it was measuring.
    expect(screen.getByRole('button').getAttribute('data-fwm-reload-title')).toBe('true');
  });

  it('runs an injected handler instead of reloading, and does not do both', () => {
    const reload = stubReload();
    const onReload = vi.fn();
    render(<ReloadTitle title="Admin" className="fwm-adminv1-title" onReload={onReload} />);

    fireEvent.click(screen.getByRole('button'));

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(reload, 'a handler must not also reload').not.toHaveBeenCalled();
  });

  it('builds the same name every page says, from the page own word', () => {
    // One phrase, fourteen titles. DRIVE's hand-written label was exactly this
    // string, which is how that screen migrated without changing what it says.
    expect(reloadTitleLabel('DarkRoute')).toBe('DarkRoute - reload this page');
    expect(reloadTitleLabel('Look up')).toBe('Look up - reload this page');
  });
});
