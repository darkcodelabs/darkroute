import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Archive } from './Console.tsx';
import { ReportsView } from './ReportsView.tsx';

const archive: Archive = { stats: null, tombstones: null, counties: null, built: null, tiles: null, state: 'pending' };
const render = (search: string) => {
  vi.stubGlobal('location', { search });
  return renderToStaticMarkup(createElement(ReportsView, { archive, query: '' }));
};
afterEach(() => vi.unstubAllGlobals());

describe('Reports entry view', () => {
  it('opens Abuse first for Reports and the legacy misuse link', () => {
    for (const search of ['?tab=reports', '?tab=misuse', '?tab=reports&report=unknown']) {
      const html = render(search);
      expect(html).toContain('<h1>Documented abuse</h1>');
      expect(html.indexOf('>Abuse</button>')).toBeLessThan(html.indexOf('>News</button>'));
      expect(html.indexOf('>News</button>')).toBeLessThan(html.indexOf('>EFF Atlas</button>'));
    }
  });

  it('preserves explicit News and Atlas links', () => {
    expect(render('?tab=reports&report=news')).toContain('<h1>ALPR news</h1>');
    expect(render('?tab=reports&report=atlas')).toContain('<h1>EFF Atlas of Surveillance</h1>');
  });
});
