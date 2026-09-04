import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { SweepTelemetry } from './SweepTelemetry.tsx';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;

describe('SWEEP telemetry privacy boundary', () => {
  it('renders the precise fix only as text, never as an attribute', () => {
    const { container } = render(
      <SweepTelemetry
        telemetry={{ headingDeg: 41, lat: 39.0997, lon: -84.5786, meshLive: true }}
      />,
    );

    expect(container.textContent).toContain('LAT 39.0997');
    expect(container.textContent).toContain('LON -84.5786');

    for (const element of container.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        expect(attribute.value).not.toContain('39.0997');
        expect(attribute.value).not.toContain('-84.5786');
      }
    }
  });

  it('does not transmit when rendered', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(
      <SweepTelemetry telemetry={{ headingDeg: null, lat: null, lon: null, meshLive: false }} />,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('keeps the touch stylesheet free of hover-only interaction', () => {
    const css = readFileSync(`${HERE}/../sweep.css`, 'utf8');
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/:hover\b/);
  });
});
