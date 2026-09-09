/**
 * THE MAP VIEW PANEL ACTUALLY OPENS.
 *
 * This file exists because it did not. `MapViewPanel` returned `null` while
 * shut, which reads as the obvious thing to do and is wrong here: the panel
 * deliberately shares `.fwm-drive-panel` with the layers panel rather than
 * redefining the chrome, and that rule set is written `opacity: 0; visibility:
 * hidden` at rest, becoming visible only under `[data-fwm-open="true"]`. A
 * panel that is not mounted never carries the attribute. So pressing MAP VIEW
 * flipped the state, lit the pill, and put nothing on the screen.
 *
 * WHAT IS GUARDED, therefore, is not "the panel renders" - it always did - but
 * the contract between the component and the stylesheet it borrows:
 *
 *   1. IT STAYS MOUNTED WHEN SHUT, so the attribute exists to be toggled and
 *      so the slide has something to animate on the way out.
 *   2. IT SAYS WHICH STATE IT IS IN, in the attribute the CSS reads.
 *   3. A SHUT PANEL IS UNREACHABLE, by `aria-hidden` and `inert` as well as by
 *      the stylesheet - a test environment does not run the CSS, and neither
 *      does a screen reader that has scrolled past the visibility rule.
 *
 * The second half of this file is about the WARN DISTANCE, which is a slider
 * here now rather than a link out to settings. What is guarded there is that
 * the control cannot produce a threshold the engine would refuse, that both
 * ends the owner asked for are reachable, and that the reading is a distance
 * rather than the slider's own index.
 *
 * NONE OF THAT MOVED WHEN THE ROWS DID. The panel's contents are
 * `features/chrome/Menu.tsx`'s row types now - `MenuAction`, `MenuToggle`,
 * `MenuNavigate` and a `MenuSlider` added for this panel - instead of a private
 * `.fwm-drive-panel-*` set. Every query below still finds its control by ROLE
 * and by ACCESSIBLE NAME, which is why almost none of them had to change: a
 * restyle that breaks a role query has changed something it should not have.
 * The one that did is called out where it sits.
 */

import { createRef } from 'react';
import type { ReactElement, RefObject } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ALERT_THRESHOLD_STOPS_FT, DEFAULT_ALERT_THRESHOLD_FT } from '../../stores/fwmCore.ts';
import { resetAllStores, useSettingsStore } from '../../stores/index.ts';

import {
  MapViewPanel,
  VIEW_AUDIO,
  VIEW_CENTER,
  VIEW_DONE,
  VIEW_THRESHOLD,
  VIEW_VIBRATION,
  thresholdReading,
} from './MapViewPanel.tsx';

/**
 * THE PANEL WIRED THE WAY DRIVE WIRES IT.
 *
 * `thresholdFt` is a prop, fed from the store, exactly as `DriveScreen` feeds
 * it - so a test that moves the slider watches the whole loop close: the write
 * goes to the store, the subscription re-renders, and the readout is what the
 * driver would see. A hard-coded prop would have tested the input and nothing
 * behind it.
 */
function Harness({
  open,
  onClose = () => undefined,
  returnFocusTo = createRef<HTMLButtonElement>(),
}: {
  readonly open: boolean;
  readonly onClose?: () => void;
  readonly returnFocusTo?: RefObject<HTMLButtonElement | null>;
}): ReactElement {
  const thresholdFt = useSettingsStore((s) => s.thresholdFt);
  /* Wide is wired through the store for the same reason: pressing the row is
     supposed to move a persisted setting, and a hard-coded prop would have
     tested the button and nothing behind it. */
  const wide = useSettingsStore((s) => s.forceLandscape);
  return (
    <MapViewPanel
      open={open}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      panned={false}
      onCenter={() => undefined}
      headingUp={false}
      onToggleHeadingUp={() => undefined}
      cluster={false}
      onToggleCluster={() => undefined}
      tilt="flat"
      onNextTilt={() => undefined}
      full={false}
      onToggleFull={() => undefined}
      wide={wide}
      onToggleWide={() => {
        useSettingsStore.getState().setForceLandscape(!wide);
      }}
      thresholdFt={thresholdFt}
    />
  );
}

function panelWith(open: boolean): HTMLElement | null {
  const { container } = render(<Harness open={open} />);
  return container.querySelector<HTMLElement>('.fwm-drive-panel');
}

/** The slider, by the name a screen reader hears. */
function slider(): HTMLInputElement {
  return screen.getByRole('slider', { name: VIEW_THRESHOLD }) as HTMLInputElement;
}

/** Drag to a stop by its feet, the way a thumb lands on one. */
function slideTo(ft: number): void {
  fireEvent.change(slider(), { target: { value: String(ALERT_THRESHOLD_STOPS_FT.indexOf(ft)) } });
}

beforeEach(() => {
  resetAllStores();
});

describe('the map view panel', () => {
  it('stays in the tree when shut, because the stylesheet hides it by attribute', () => {
    const panel = panelWith(false);
    expect(panel).not.toBeNull();
    expect(panel?.dataset['fwmOpen']).toBe('false');
  });

  it('says it is open, in the attribute `.fwm-drive-panel[data-fwm-open]` reads', () => {
    // The whole bug in one assertion: without this the panel is in the DOM at
    // `opacity: 0` and the pill looks pressed with nothing behind it.
    const panel = panelWith(true);
    expect(panel?.dataset['fwmOpen']).toBe('true');
  });

  it('keeps its rows out of reach while shut, for readers and for tab', () => {
    const panel = panelWith(false);
    expect(panel?.getAttribute('aria-hidden')).toBe('true');
    expect(panel?.hasAttribute('inert')).toBe(true);
  });

  it('hands its rows back when open', () => {
    const panel = panelWith(true);
    expect(panel?.hasAttribute('inert')).toBe(false);
    expect(panel?.textContent).toContain(VIEW_CENTER);
  });
});

/**
 * THE WAY OUT, WHICH IS THE SAME WAY OUT AS THE OTHER TWO CHIPS' PANELS.
 *
 * Found by pressing it: Escape shut the abuse menu and the layers panel and did
 * nothing on this one, because this was the only panel of the three that never
 * listened for the key. The assertions are the siblings' own - `AbuseMenu.test`
 * asks the same two questions - so the three cannot quietly dismiss three ways
 * again.
 */
describe('the way out', () => {
  it('shuts on Escape and returns focus to the pill that opened it', () => {
    const pill = document.createElement('button');
    document.body.appendChild(pill);
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} returnFocusTo={{ current: pill }} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(pill);
    pill.remove();
  });

  it('ignores Escape while it is already shut', () => {
    const onClose = vi.fn();
    render(<Harness open={false} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shuts on Done and returns focus the same way, so the two exits cannot drift', () => {
    const pill = document.createElement('button');
    document.body.appendChild(pill);
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} returnFocusTo={{ current: pill }} />);
    fireEvent.click(screen.getByRole('button', { name: VIEW_DONE }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(pill);
    pill.remove();
  });
});

describe('the warn distance', () => {
  it('opens on 500 ft, which is the value every design file prints', () => {
    panelWith(true);
    expect(useSettingsStore.getState().thresholdFt).toBe(DEFAULT_ALERT_THRESHOLD_FT);
    expect(screen.getByRole('slider', { name: VIEW_THRESHOLD })).toHaveAttribute(
      'aria-valuetext',
      '500 ft',
    );
  });

  it('writes the store when it moves, because nothing else is listening', () => {
    panelWith(true);
    slideTo(250);
    expect(useSettingsStore.getState().thresholdFt).toBe(250);
  });

  it('reaches 25 ft and a mile, the two ends the owner asked for', () => {
    panelWith(true);

    slideTo(25);
    expect(useSettingsStore.getState().thresholdFt).toBe(25);
    expect(slider()).toHaveAttribute('aria-valuetext', '25 ft');

    slideTo(5280);
    expect(useSettingsStore.getState().thresholdFt).toBe(5280);
    expect(slider()).toHaveAttribute('aria-valuetext', '1 mi');
  });

  it('never produces a value the engine would throw on', () => {
    // The store asserts rather than clamps, so a slider that could emit an
    // illegal value would not render a wrong number - it would crash the panel
    // under a driver's thumb. Every position is walked here for that reason.
    panelWith(true);
    for (let index = 0; index < ALERT_THRESHOLD_STOPS_FT.length; index++) {
      expect(() => {
        fireEvent.change(slider(), { target: { value: String(index) } });
      }).not.toThrow();
    }
    expect(useSettingsStore.getState().thresholdFt).toBe(5280);
  });

  it('says feet up to the quarter mile and miles from there', () => {
    // Four digits of feet is a number a driver has to convert; a fraction of a
    // mile is a distance. 1320 is where that stops being a matter of taste.
    expect(thresholdReading(25)).toBe('25 ft');
    expect(thresholdReading(1000)).toBe('1000 ft');
    expect(thresholdReading(1320)).toBe('0.25 mi');
    expect(thresholdReading(2640)).toBe('0.5 mi');
    expect(thresholdReading(5280)).toBe('1 mi');
  });

  it('prints the stored number, not the stop it had to round the thumb to', () => {
    // The watch bezel steps 50 ft and v0's settings slider offers nineteen
    // values, so a stored threshold need not be one of this slider's stops.
    // The thumb goes to the nearest; the READING stays the truth, because it is
    // the number the engine is actually warning at.
    useSettingsStore.getState().setThresholdFt(400);
    panelWith(true);
    expect(slider()).toHaveAttribute('aria-valuetext', '400 ft');
    expect(slider().value).toBe(String(ALERT_THRESHOLD_STOPS_FT.indexOf(500)));
  });

  it('is a real slider to a reader, not an index it has to translate', () => {
    // Without `aria-valuetext` this announces "5 of 10", which says nothing
    // about a distance - the input's own value is a position in the stop list.
    panelWith(true);
    const input = slider();
    expect(input.getAttribute('aria-valuetext')).toBe('500 ft');
    expect(input.min).toBe('0');
    expect(input.max).toBe(String(ALERT_THRESHOLD_STOPS_FT.length - 1));
    // Keyboard reach is the native control's, and it only exists if the input
    // is enabled and in the tree while the panel is open.
    expect(input.disabled).toBe(false);
  });
});

describe('the two delivery switches that came from settings', () => {
  it('offers spoken warnings and vibration on the panel, not two screens away', () => {
    const panel = panelWith(true);
    expect(panel?.textContent).toContain(VIEW_AUDIO);
    expect(panel?.textContent).toContain(VIEW_VIBRATION);
  });

  it('writes each one to the store it was read from', () => {
    panelWith(true);
    expect(useSettingsStore.getState().audio).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(VIEW_AUDIO) }));
    expect(useSettingsStore.getState().audio).toBe(false);

    expect(useSettingsStore.getState().vibration).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(VIEW_VIBRATION) }));
    expect(useSettingsStore.getState().vibration).toBe(false);
  });

  /**
   * THE WORDS MOVED OFF THE SWITCH AND ONTO THE ROW, and the claim did not.
   *
   * These were `.fwm-drive-panel-switch` buttons that wrapped their own label
   * and note, so the state sentence was inside the control and `textContent`
   * found it there. They are `MenuToggle` rows now: the row prints the label
   * and the state in words and the switch is the target inside it, carrying
   * the label as its accessible name and `aria-checked` as the same fact for a
   * reader - `menu.css` section 6 states that arrangement, and `SwitchRow` and
   * `SettingsSwitch` already ran on it.
   *
   * So the assertion reads the row rather than the button. What it is still
   * guarding is exactly what it guarded before, and it is the half that is easy
   * to lose: THE STATE IS SPELLED OUT IN VISIBLE WORDS, not only in an
   * attribute. `aria-checked` alone would still pass a test that only read the
   * attribute, and a driver cannot read an attribute.
   */
  function audioRow(): HTMLElement {
    const key = screen.getByRole('switch', { name: new RegExp(VIEW_AUDIO) });
    const row = key.closest('.fwm-menu-row');
    expect(row, 'the spoken-warnings switch is not in a menu row').not.toBeNull();
    return row as HTMLElement;
  }

  it('says which way each switch is set, in words and in the aria state', () => {
    panelWith(true);
    const audio = screen.getByRole('switch', { name: new RegExp(VIEW_AUDIO) });
    expect(audio.getAttribute('aria-checked')).toBe('true');
    expect(audioRow().textContent).toContain('distance and side');

    fireEvent.click(audio);
    expect(screen.getByRole('switch', { name: new RegExp(VIEW_AUDIO) }).getAttribute('aria-checked')).toBe(
      'false',
    );
    // The unflattering half: a switch that is OFF has to say so on the row,
    // not just in an attribute nobody reads.
    expect(audioRow().textContent).toContain('off');
  });
});
