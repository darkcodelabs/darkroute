/**
 * THE CONSOLE'S BASEMAP: the same PMTiles archive the phone draws, read
 * straight from `tiles.darkroute.ai` by range request, with roads and water
 * and nothing else. No labels -- glyphs are another origin's asset and the
 * design draws none -- and no glass: the map is a pane beside the chrome, not
 * behind it.
 *
 * Light is not an inversion. "The basemap goes light too, which is the only
 * place the console diverges from the phone by necessity: a dark map under
 * light chrome reads as a hole."
 */

import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';

export const BASEMAP_URL = 'https://tiles.darkroute.ai/basemap-us-20260901-full-us.pmtiles';

let registered = false;

/** Register the `pmtiles://` protocol once for the page. */
export function registerPmtiles(): void {
  if (registered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));
  registered = true;
}

interface Palette {
  readonly earth: string;
  readonly water: string;
  readonly highway: string;
  readonly major: string;
  readonly minor: string;
  readonly boundary: string;
}

const DARK: Palette = {
  earth: '#0b0f14',
  water: '#0e1a24',
  highway: 'rgba(47, 212, 212, 0.38)',
  major: 'rgba(255, 255, 255, 0.16)',
  minor: 'rgba(255, 255, 255, 0.07)',
  boundary: 'rgba(255, 255, 255, 0.12)',
};

const LIGHT: Palette = {
  earth: '#f4f6f8',
  water: '#d8e4ec',
  highway: 'rgba(9, 96, 100, 0.55)',
  major: '#b7c0c9',
  minor: '#d9dee4',
  boundary: 'rgba(0, 0, 0, 0.14)',
};

export function buildStyle(theme: 'dark' | 'light'): StyleSpecification {
  const p = theme === 'light' ? LIGHT : DARK;
  return {
    version: 8,
    sources: {
      basemap: { type: 'vector', url: `pmtiles://${BASEMAP_URL}`, attribution: '' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': p.earth } },
      {
        id: 'water',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'water',
        paint: { 'fill-color': p.water },
      },
      {
        id: 'boundaries',
        type: 'line',
        source: 'basemap',
        'source-layer': 'boundaries',
        filter: ['<=', ['get', 'kind_detail'], 4],
        paint: { 'line-color': p.boundary, 'line-width': 0.8, 'line-dasharray': [3, 2] },
      },
      {
        id: 'roads-minor',
        type: 'line',
        source: 'basemap',
        'source-layer': 'roads',
        filter: ['in', ['get', 'kind'], ['literal', ['minor_road', 'other', 'path']]],
        minzoom: 11,
        paint: {
          'line-color': p.minor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 14, 1, 17, 3],
        },
      },
      {
        id: 'roads-major',
        type: 'line',
        source: 'basemap',
        'source-layer': 'roads',
        filter: ['==', ['get', 'kind'], 'major_road'],
        paint: {
          'line-color': p.major,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 12, 1.4, 16, 4],
        },
      },
      {
        id: 'roads-highway',
        type: 'line',
        source: 'basemap',
        'source-layer': 'roads',
        filter: ['==', ['get', 'kind'], 'highway'],
        paint: {
          'line-color': p.highway,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 12, 2, 16, 5],
        },
      },
    ],
  };
}
