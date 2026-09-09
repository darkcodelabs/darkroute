/**
 * ARCHIVE: the filter rail, the map, the inspector -- frame A, wired.
 *
 * The rail counts what is IN VIEW, honestly labelled: the archive API answers
 * a bounding box, and the whole-archive owner split is not a number any
 * published file carries yet. The map is the phone's own basemap under the
 * same owner dots. The inspector shows everything a record knows -- street,
 * town, maker, mount, facing, tile -- and the raw record with its path, and
 * two ways out: the OSM node it came from, and the app's correction form.
 *
 * Below 1024 the rail is a chip row and the inspector a sheet; below 640 the
 * map takes a fixed 260 and the list owns the rest, nearest the map centre
 * first (frame D).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { ApiError, OWNERS, fetchCameras } from '../data/api.ts';
import type { Camera } from '../data/api.ts';
import { buildStyle, registerPmtiles } from './basemap.ts';
import type { Archive } from './Console.tsx';
import {
  cameraLabel,
  compass,
  correctionUrl,
  countByOwner,
  download,
  formatCount,
  formatMiles,
  matchesQuery,
  metresBetween,
  osmUrl,
  ownerKicker,
  ownerNote,
  tileOf,
  viewGeoJson,
} from './data.ts';

const START: [number, number] = [-94.6708, 38.9236];
const START_ZOOM = 12;
const LIMIT = 1000;

export interface ArchiveViewProps {
  readonly archive: Archive;
  readonly query: string;
  readonly theme: 'dark' | 'light';
}

interface Box {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export function ArchiveView({ archive, query, theme }: ArchiveViewProps): ReactElement {
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const [cameras, setCameras] = useState<readonly Camera[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [owner, setOwner] = useState<string | null>(null);
  const [showUnverified, setShowUnverified] = useState(true);
  const [selected, setSelected] = useState<Camera | null>(null);
  const [centre, setCentre] = useState<{ lat: number; lon: number }>({ lat: START[1], lon: START[0] });
  const [zoom, setZoom] = useState(START_ZOOM);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback((box: Box) => {
    if (box.east - box.west > 1.5 || box.north - box.south > 1.5) {
      setNote('zoom in to load cameras — one request covers at most 1.5°');
      return;
    }
    setBusy(true);
    setNote(null);
    fetchCameras(box, { limit: LIMIT })
      .then((result) => {
        setCameras(result.cameras);
        setTruncated(result.truncated);
      })
      .catch((cause: unknown) => {
        setNote(cause instanceof ApiError ? `${cause.code}: ${cause.message}` : 'the archive did not answer');
      })
      .finally(() => {
        setBusy(false);
      });
  }, []);

  useEffect(() => {
    if (holder.current === null || map.current !== null) return undefined;
    registerPmtiles();
    const instance = new maplibregl.Map({
      container: holder.current,
      style: buildStyle(theme),
      center: START,
      zoom: START_ZOOM,
      attributionControl: false,
    });
    map.current = instance;
    const read = (): void => {
      const b = instance.getBounds();
      const c = instance.getCenter();
      setCentre({ lat: c.lat, lon: c.lng });
      setZoom(instance.getZoom());
      load({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
    };
    instance.on('load', read);
    instance.on('moveend', read);
    return () => {
      for (const marker of markers.current.values()) marker.remove();
      markers.current.clear();
      instance.remove();
      map.current = null;
    };
    // Built once. The theme is applied by the effect below, not by rebuilding.
  }, [load]);

  useEffect(() => {
    map.current?.setStyle(buildStyle(theme));
  }, [theme]);

  const visible = useMemo(
    () =>
      cameras.filter(
        (c) =>
          (owner === null || (c.ownerType ?? 'unverified') === owner) &&
          (showUnverified || c.ownerType !== 'unverified') &&
          matchesQuery(c, query),
      ),
    [cameras, owner, showUnverified, query],
  );

  const counts = useMemo(() => countByOwner(cameras), [cameras]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null) return;
    const keep = new Set(visible.map((c) => c.id));
    for (const [id, marker] of markers.current) {
      if (!keep.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }
    for (const camera of visible) {
      let marker = markers.current.get(camera.id);
      if (marker === undefined) {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'dc-marker';
        dot.dataset['owner'] = camera.ownerType ?? 'unverified';
        dot.setAttribute('aria-label', cameraLabel(camera));
        dot.addEventListener('click', (event) => {
          event.stopPropagation();
          setSelected(camera);
        });
        marker = new maplibregl.Marker({ element: dot }).setLngLat([camera.lon, camera.lat]).addTo(instance);
        markers.current.set(camera.id, marker);
      }
      marker.getElement().dataset['selected'] = selected?.id === camera.id ? 'true' : 'false';
    }
  }, [visible, selected]);

  const nearest = useMemo(
    () =>
      [...visible]
        .map((c) => ({ camera: c, metres: metresBetween(centre, c) }))
        .sort((a, b) => a.metres - b.metres)
        .slice(0, 60),
    [visible, centre],
  );

  const copy = useCallback((label: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => {
        setCopied(null);
      }, 1200);
    });
  }, []);

  const exportView = useCallback(() => {
    download(`darkroute-view-${new Date().toISOString().slice(0, 10)}.geojson`, viewGeoJson(visible), 'application/geo+json');
  }, [visible]);

  const scale = useMemo(() => {
    const metresPerPixel = (156_543.03 * Math.cos((centre.lat * Math.PI) / 180)) / 2 ** zoom;
    const miles = (metresPerPixel * 44) / 1609.344;
    return miles >= 1 ? `${miles.toFixed(0)} mi` : `${(miles * 5280).toFixed(0)} ft`;
  }, [centre.lat, zoom]);

  const total = archive.stats?.cameras ?? null;
  const rail = (
    <>
      <div className="dc-rail-head">
        <div className="dc-kicker">What the archive holds</div>
        <div className="dc-sub">
          {formatCount(total)} cameras · {formatCount(archive.tombstones)} removed
        </div>
      </div>
      <button type="button" className="dc-row" aria-pressed={owner === null} onClick={() => { setOwner(null); }}>
        {owner === null ? <span className="dc-radio" aria-hidden="true" /> : <span className="dc-dot" aria-hidden="true" />}
        <span className="dc-row-name">All owners</span>
        <span className="dc-row-value">{formatCount(cameras.length)}</span>
      </button>
      {OWNERS.map((o) => (
        <button
          key={o.id}
          type="button"
          className="dc-row"
          aria-pressed={owner === o.id}
          onClick={() => {
            setOwner(owner === o.id ? null : o.id);
          }}
        >
          <span className="dc-dot" data-owner={o.id} aria-hidden="true" />
          <span className="dc-row-name">{o.label}</span>
          <span className="dc-row-value">{formatCount(counts[o.id] ?? 0)}</span>
        </button>
      ))}
      <div className="dc-rule" />
      <div className="dc-row">
        <span className="dc-row-name">Unverified</span>
        <span className="dc-row-note">community reports</span>
        <button
          type="button"
          className="dc-toggle"
          role="switch"
          aria-checked={showUnverified}
          data-hue="unverified"
          aria-label="Show unverified reports"
          onClick={() => {
            setShowUnverified(!showUnverified);
          }}
        />
      </div>
      <a className="dc-row" href="?tab=misuse">
        <span className="dc-row-name">Abuse areas</span>
        <span className="dc-row-note">{formatCount(archive.stats?.abuseRecords ?? null)} documented</span>
        <span className="dc-toggle" role="presentation" aria-checked="true" data-hue="police" />
      </a>
      <div className="dc-rule" />
      <div className="dc-rail-head">
        <div className="dc-kicker" data-tone="muted">In view</div>
      </div>
      <div className="dc-card">
        <div className="dc-figure-line">
          <span className="dc-figure">{formatCount(visible.length)}</span>
          <span className="dc-figure-note">{busy ? 'reading…' : truncated ? `of more than ${String(LIMIT)} in this bbox` : 'in this bbox'}</span>
        </div>
        <OwnerBars counts={counts} />
        <div className="dc-caption">by owner, this view</div>
      </div>
      <button type="button" className="dc-export" onClick={exportView} disabled={visible.length === 0}>
        <span>Export this view</span>
        <kbd>.geojson</kbd>
      </button>
      <div className="dc-note">
        Filters are a display concern. Nothing here changes what the archive contains or what the phone
        alerts on.
      </div>
    </>
  );

  const chips = (
    <div className="dc-chips" role="group" aria-label="Owner">
      <button type="button" className="dc-chip" aria-pressed={owner === null} onClick={() => { setOwner(null); }}>
        All {formatCount(cameras.length)}
      </button>
      {OWNERS.map((o) => (
        <button
          key={o.id}
          type="button"
          className="dc-chip"
          aria-pressed={owner === o.id}
          onClick={() => {
            setOwner(owner === o.id ? null : o.id);
          }}
        >
          <span className="dc-dot" data-owner={o.id} aria-hidden="true" />
          {SHORT[o.id] ?? o.label}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <aside className="dc-rail" aria-label="Filters">
        {rail}
      </aside>
      {chips}
      <section className="dc-main" aria-label="Map">
        <div className="dc-map" ref={holder} />
        <div className="dc-badge">
          <span className="dc-mono">
            z{zoom.toFixed(0)} · {centre.lat.toFixed(4)},{centre.lon.toFixed(4)}
          </span>
          <span className="dc-vr" aria-hidden="true" />
          <span className="dc-badge-note">
            tiles built {archive.built === null ? '—' : archive.built.slice(11, 16)}Z
          </span>
        </div>
        <div className="dc-zoom">
          <button type="button" aria-label="Zoom in" onClick={() => map.current?.zoomIn()}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => map.current?.zoomOut()}>
            −
          </button>
        </div>
        <div className="dc-scale" aria-hidden="true">
          <i />
          <span className="dc-mono">{scale}</span>
        </div>
        {note !== null ? <div className="dc-map-note">{note}</div> : null}
        {selected !== null ? (
          <div className="dc-sheet" role="dialog" aria-label="Camera">
            <div className="dc-sheet-head">
              <span className="dc-dot" data-owner={selected.ownerType ?? 'unverified'} aria-hidden="true" />
              <span className="dc-side-kicker" data-owner={selected.ownerType ?? 'unverified'}>
                {ownerKicker(selected.ownerType)}
              </span>
              <span className="dc-id">{selected.id}</span>
            </div>
            <div className="dc-sheet-title">
              <strong>{cameraLabel(selected)}</strong>
              <span>{facingLine(selected)}</span>
            </div>
            <div className="dc-actions">
              <a className="dc-btn" href={osmUrl(selected.id)} target="_blank" rel="noreferrer">
                Open in OSM
              </a>
              <button
                type="button"
                className="dc-btn"
                data-tone="accent"
                onClick={() => {
                  copy('json', JSON.stringify(selected, null, 2));
                }}
              >
                {copied === 'json' ? 'Copied' : 'Copy JSON'}
              </button>
            </div>
          </div>
        ) : null}
      </section>
      <aside className="dc-side" aria-label="Inspector">
        {selected === null ? (
          <div className="dc-empty">
            Click a camera to inspect it.
            <br />
            Pan or zoom to read a different part of the archive.
          </div>
        ) : (
          <Inspector camera={selected} copied={copied} onCopy={copy} onClose={() => { setSelected(null); }} />
        )}
      </aside>
      <div className="dc-list" role="list" aria-label="Nearest cameras">
        <div className="dc-list-head">
          <span className="dc-figure">{formatCount(visible.length)}</span>
          <span className="dc-figure-note">in this bbox · nearest first</span>
        </div>
        {nearest.map(({ camera, metres }) => (
          <button
            key={camera.id}
            type="button"
            className="dc-list-row"
            role="listitem"
            aria-pressed={selected?.id === camera.id}
            onClick={() => {
              setSelected(camera);
              map.current?.easeTo({ center: [camera.lon, camera.lat] });
            }}
          >
            <span className="dc-dot" data-owner={camera.ownerType ?? 'unverified'} aria-hidden="true" />
            <span className="dc-list-where">
              <span className="dc-list-name">{cameraLabel(camera)}</span>
              <span className="dc-list-id">{camera.id}</span>
            </span>
            <span className="dc-list-dist">{formatMiles(metres)}</span>
          </button>
        ))}
      </div>
    </>
  );
}

const SHORT: Readonly<Record<string, string>> = {
  police: 'Police',
  inter_agency: 'Shared',
  hoa: 'HOA',
  private: 'Private',
  unverified: 'Unverified',
};

function facingLine(camera: Camera): string {
  const point = compass(camera.directionDeg);
  const facing = camera.directionDeg === null || point === null ? null : `faces ${String(Math.round(camera.directionDeg))}° ${point}`;
  return [camera.locality ?? null, facing].filter((v): v is string => v !== null).join(' · ');
}

function OwnerBars({ counts }: { readonly counts: Readonly<Record<string, number>> }): ReactElement {
  const max = Math.max(1, ...OWNERS.map((o) => counts[o.id] ?? 0));
  return (
    <div className="dc-bars" aria-hidden="true">
      {OWNERS.map((o) => {
        const n = counts[o.id] ?? 0;
        return (
          <span
            key={o.id}
            style={{ height: `${String(Math.max(3, Math.round((n / max) * 34)))}px` }}
            data-hot={n > 0 && n === max ? 'true' : undefined}
          />
        );
      })}
    </div>
  );
}

interface InspectorProps {
  readonly camera: Camera;
  readonly copied: string | null;
  readonly onCopy: (label: string, text: string) => void;
  readonly onClose: () => void;
}

function Inspector({ camera, copied, onCopy, onClose }: InspectorProps): ReactElement {
  const owner = camera.ownerType ?? 'unverified';
  const tile = tileOf(camera.lat, camera.lon);
  const path = `/cameras/11/${String(tile.x)}/${String(tile.y)}`;
  const raw = JSON.stringify(
    {
      id: camera.id,
      lat: camera.lat,
      lon: camera.lon,
      ownerType: camera.ownerType,
      street: camera.street,
      cross: camera.cross,
      locality: camera.locality ?? null,
      operator: camera.operator,
      manufacturer: camera.manufacturer ?? null,
      mount: camera.mount ?? null,
      direction: camera.directionDeg,
    },
    null,
    2,
  );
  const point = compass(camera.directionDeg);
  return (
    <>
      <div className="dc-side-head">
        <span className="dc-dot" data-owner={owner} aria-hidden="true" />
        <span className="dc-side-kicker" data-owner={owner}>
          {ownerKicker(camera.ownerType)}
        </span>
        <button type="button" className="dc-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <h1 className="dc-title">{cameraLabel(camera)}</h1>
      <div className="dc-idline">
        <span className="dc-id">{camera.id}</span>
        <button
          type="button"
          className="dc-copy"
          onClick={() => {
            onCopy('id', camera.id);
          }}
        >
          {copied === 'id' ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="dc-callout" data-owner={owner}>
        {ownerNote(camera)}
      </div>
      <div className="dc-section">Provenance</div>
      <dl style={{ margin: 0 }}>
        <Row k="Where">{camera.locality ?? 'not recorded'}</Row>
        <Row k="Operator" tone={camera.operator === null ? 'muted' : undefined}>
          {camera.operator ?? 'unknown'}
        </Row>
        <Row k="Maker" tone={camera.manufacturer == null ? 'muted' : undefined}>
          {camera.manufacturer ?? 'not recorded'}
        </Row>
        <Row k="Mount" tone={camera.mount == null ? 'muted' : undefined}>
          {camera.mount?.replaceAll('_', ' ') ?? 'not recorded'}
        </Row>
        <Row k="Direction" tone={camera.directionDeg === null ? 'muted' : undefined}>
          {camera.directionDeg === null || point === null
            ? 'not recorded'
            : `${String(Math.round(camera.directionDeg))}° · ${point} approach`}
        </Row>
        <Row k="Off the road" tone={camera.streetM == null ? 'muted' : undefined}>
          {camera.streetM == null ? 'not measured' : `${String(camera.streetM)} m from ${camera.street ?? 'the road'}`}
        </Row>
        <Row k="Source">OpenStreetMap node, community edit</Row>
        <Row k="In tile" mono>
          {`z11/${String(tile.x)}/${String(tile.y)}`}
        </Row>
      </dl>
      <div className="dc-section">Raw</div>
      <div className="dc-raw">
        <div className="dc-raw-head">
          <span className="dc-mono">{path}</span>
          <button
            type="button"
            className="dc-copy"
            onClick={() => {
              onCopy('raw', raw);
            }}
          >
            {copied === 'raw' ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre>{raw}</pre>
      </div>
      <div className="dc-actions">
        <a className="dc-btn" href={osmUrl(camera.id)} target="_blank" rel="noreferrer">
          Open in OSM
        </a>
        <a className="dc-btn" data-tone="warn" href={correctionUrl(camera.id)} target="_blank" rel="noreferrer">
          Report a correction
        </a>
      </div>
    </>
  );
}

function Row({
  k,
  tone,
  mono,
  children,
}: {
  readonly k: string;
  readonly tone?: 'muted' | 'unverified' | 'ok' | undefined;
  readonly mono?: boolean;
  readonly children: ReactElement | string;
}): ReactElement {
  return (
    <div className="dc-kv">
      <dt>{k}</dt>
      <dd className={mono === true ? 'dc-mono' : undefined} data-tone={tone}>
        {children}
      </dd>
    </div>
  );
}
