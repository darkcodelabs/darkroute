import { describe, expect, it } from 'vitest';

import { readMapFlag } from './flag.ts';

function store(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & {
  readonly bag: Record<string, string>;
} {
  const bag = { ...initial };
  return {
    bag,
    getItem: (k: string) => bag[k] ?? null,
    setItem: (k: string, v: string) => {
      bag[k] = v;
    },
  };
}

describe('choosing the scope', () => {
  it('defaults to the MAP now that it is proven', () => {
    // It defaulted to the dial while the map was unproven. Keeping it that way
    // once the map worked would mean every fix went to the renderer being
    // replaced.
    expect(readMapFlag('', store())).toBe(true);
  });

  it('takes the map when asked', () => {
    expect(readMapFlag('?map=1', store())).toBe(true);
    expect(readMapFlag('?map=true', store())).toBe(true);
  });

  it('remembers the choice for the tab', () => {
    const s = store();
    readMapFlag('?map=1', s);
    expect(readMapFlag('', s)).toBe(true);
  });

  it('lets the query string turn it back off', () => {
    const s = store({ 'fwm.map': '1' });
    expect(readMapFlag('?map=0', s)).toBe(false);
    expect(readMapFlag('', s)).toBe(false);
  });

  it('survives a window that refuses storage entirely', () => {
    const hostile = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readMapFlag('?map=1', hostile)).toBe(true);
    expect(readMapFlag('', hostile)).toBe(true);
    expect(readMapFlag('', null)).toBe(true);
  });
});
