/**
 * WHICH SCOPE RADAR DRAWS - the dial, or the map.
 *
 * The migration to MapLibre is a replacement of the whole rendering surface,
 * and the old dial is a working, shipped thing somebody may be demonstrating
 * this morning. Swapping it wholesale in one commit means any defect in the new
 * path takes the product with it.
 *
 * So both exist for a short while and a flag chooses. This is NOT meant to
 * become a permanent fork: the moment the map path is verified on a real phone,
 * it becomes the default and the dial comes out. A second renderer kept "just
 * in case" is two renderers to fix every bug in.
 *
 *   (default) the MapLibre scope
 *   ?map=0    the dial, while it still exists
 *
 * The choice sticks for the tab, because a driver testing this should not have
 * to re-add a query string every time the app navigates.
 */

const KEY = 'fwm.map';

export function readMapFlag(
  search: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
): boolean {
  let chosen: boolean | null = null;
  try {
    const raw = new URLSearchParams(search).get('map');
    if (raw === '1' || raw === 'true') chosen = true;
    else if (raw === '0' || raw === 'false') chosen = false;
  } catch {
    chosen = null;
  }

  if (chosen !== null) {
    try {
      storage?.setItem(KEY, chosen ? '1' : '0');
    } catch {
      // A private-mode window that refuses storage still gets the flag for
      // this navigation; it just will not remember it.
    }
    return chosen;
  }

  try {
    // THE MAP IS THE DEFAULT NOW. It was opt-in while it was unproven, which
    // was right then and is wrong now: MapLibre renders, centres, clusters and
    // pans correctly, and keeping the dial as the thing everybody sees means
    // every fix goes to the renderer being replaced. `?map=0` still returns to
    // the dial while it exists, and it is not going to exist for long.
    return storage?.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

/** The live answer for this tab. */
export function mapEnabled(): boolean {
  const location = globalThis.location ?? null;
  const storage = (() => {
    try {
      return globalThis.sessionStorage ?? null;
    } catch {
      return null;
    }
  })();
  return readMapFlag(location?.search ?? '', storage);
}
