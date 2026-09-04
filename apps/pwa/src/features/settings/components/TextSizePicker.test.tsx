import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TEXT_SCALES } from '../../../app/textScale.ts';

import { TEXT_SIZE_SAMPLE, TextSizePicker } from './TextSizePicker.tsx';

describe('the text size picker', () => {
  it('offers every step on the ramp, labelled as a percentage', () => {
    render(<TextSizePicker active={1} />);

    const steps = screen.getAllByRole('radio');
    expect(steps).toHaveLength(TEXT_SCALES.length);
    expect(steps.map((s) => s.textContent)).toEqual([
      '88%',
      '100%',
      '113%',
      '125%',
      '138%',
      '150%',
    ]);
  });

  it('marks the applied step, and only that one', () => {
    render(<TextSizePicker active={1.25} />);

    const checked = screen.getAllByRole('radio').filter((s) => s.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent).toBe('125%');
  });

  it('reports the step that was pressed', () => {
    const onPick = vi.fn();
    render(<TextSizePicker active={1} onPick={onPick} />);

    fireEvent.click(screen.getByRole('radio', { name: '150%' }));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(1.5);
  });

  it('renders every step inert when nothing is wired, rather than dead controls', () => {
    render(<TextSizePicker active={1} />);

    for (const step of screen.getAllByRole('radio')) {
      expect(step).toBeDisabled();
    }
  });

  it('shows the sample at the smallest size the product uses', () => {
    // The point of the sample is that it is the hardest case. If it ever moves
    // to body text, the control stops answering the question it was built for.
    render(<TextSizePicker active={1} />);

    const sample = screen.getByText(TEXT_SIZE_SAMPLE);
    expect(sample.className).toContain('fwm-settings-textsize-sample');
    expect(TEXT_SIZE_SAMPLE).toContain('SPEED');
  });
});
