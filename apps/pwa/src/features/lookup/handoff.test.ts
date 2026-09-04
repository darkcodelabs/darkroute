import { describe, expect, it, vi } from 'vitest';

import { HIBF_URL, handOff } from './handoff.ts';

function ports(copied = true) {
  const opened: string[] = [];
  const written: string[] = [];
  return {
    opened,
    written,
    clipboard: {
      write: vi.fn(async (text: string) => {
        written.push(text);
        return copied;
      }),
    },
    opener: {
      open: vi.fn((url: string) => {
        opened.push(url);
      }),
    },
  };
}

describe('the haveibeenflocked hand-off', () => {
  it('opens their site and leaves the plate on the clipboard', async () => {
    const p = ports();

    await expect(handOff('2GAT123', p)).resolves.toBe('copied-and-opened');

    expect(p.opened).toEqual([HIBF_URL]);
    expect(p.written).toEqual(['2GAT123']);
  });

  it('never puts the plate in the URL', async () => {
    // A plate in a URL is a plate in a browser history, a referrer header and
    // somebody else's server log. The clipboard is the whole point.
    const p = ports();

    await handOff('2GAT123', p);

    for (const url of p.opened) {
      expect(url).toBe(HIBF_URL);
      expect(url).not.toContain('2GAT123');
      expect(url).not.toContain('?');
    }
  });

  it('never touches their /api/ - the one path their robots.txt refuses', async () => {
    const p = ports();

    await handOff('2GAT123', p);

    for (const url of p.opened) expect(url).not.toContain('/api/');
  });

  it('copies before it opens, so the write still has user activation', async () => {
    const order: string[] = [];
    const p = {
      clipboard: {
        write: vi.fn(async () => {
          order.push('copy');
          return true;
        }),
      },
      opener: {
        open: vi.fn(() => {
          order.push('open');
        }),
      },
    };

    await handOff('2GAT123', p);

    expect(order).toEqual(['copy', 'open']);
  });

  it('still opens the site when the clipboard refuses', async () => {
    // A refused clipboard is an inconvenience - the driver types the plate.
    // Not opening at all would be the product failing at its one job here.
    const p = ports(false);

    await expect(handOff('2GAT123', p)).resolves.toBe('opened-only');
    expect(p.opened).toEqual([HIBF_URL]);
  });

  it('says so when nothing can be opened, rather than claiming it worked', async () => {
    await expect(handOff('2GAT123', { clipboard: null, opener: null })).resolves.toBe(
      'unavailable',
    );
  });
});
