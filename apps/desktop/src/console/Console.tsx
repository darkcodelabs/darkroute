/**
 * THE CONSOLE SHELL, copied from frame A of `DarkRoute Console.html` and wired.
 *
 * 56 bar, four tabs, a search field, two keys; the centre pane swaps per tab;
 * 32 status bar carrying attribution, build stamp and counts. The rails belong
 * to the tabs that mean something with them: Archive has both, Misuse and
 * Coverage keep the left one, the API reference drops both for a 760 px
 * measure. Below 1024 the rails collapse and below 640 the tabs fold into a
 * menu -- `console.css` owns those rules, this file only names the parts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { fetchStats } from '../data/api.ts';
import type { Stats } from '../data/api.ts';
import { ArchiveView } from './ArchiveView.tsx';
import { ApiRefView } from './ApiRefView.tsx';
import { CoverageView } from './CoverageView.tsx';
import { fetchCounties, fetchIndex, fetchTombstones, formatCount } from './data.ts';
import type { CountyRow } from './data.ts';
import { ReportsView } from './ReportsView.tsx';
import { MonitoringView } from './MonitoringView.tsx';
import './console.css';

export type TabId = 'archive' | 'reports' | 'monitoring' | 'api' | 'coverage';

export const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
  { id: 'archive', label: 'Archive' },
  { id: 'reports', label: 'Reports' },
  { id: 'monitoring', label: 'Monitoring' },
  { id: 'api', label: 'API' },
  { id: 'coverage', label: 'Coverage' },
];

const RAILS: Readonly<Record<TabId, 'both' | 'left' | 'none'>> = {
  archive: 'both',
  reports: 'none',
  monitoring: 'none',
  api: 'none',
  coverage: 'left',
};

const THEME_KEY = 'darkroute.console.theme';

function tabFromLocation(): TabId {
  const wanted = new URLSearchParams(globalThis.location?.search ?? '').get('tab');
  if (wanted === 'misuse') return 'reports';
  return TABS.some((t) => t.id === wanted) ? (wanted as TabId) : 'archive';
}

export interface Archive {
  readonly stats: Stats | null;
  readonly tombstones: number | null;
  readonly counties: readonly CountyRow[] | null;
  readonly built: string | null;
  readonly tiles: number | null;
  readonly state: 'pending' | 'ok' | 'down';
}

export function Console(): ReactElement {
  const [tab, setTab] = useState<TabId>(tabFromLocation);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      /* private windows throw; the default below stands */
    }
    return 'dark';
  });
  const [archive, setArchive] = useState<Archive>({
    stats: null,
    tombstones: null,
    counties: null,
    built: null,
    tiles: null,
    state: 'pending',
  });

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* remembering it is a convenience, not a requirement */
    }
  }, [theme]);

  useEffect(() => {
    const url = new URL(globalThis.location.href);
    url.searchParams.set('tab', tab);
    globalThis.history.replaceState(null, '', url);
  }, [tab]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      fetchStats(controller.signal),
      fetchTombstones(controller.signal),
      fetchCounties(controller.signal),
      fetchIndex(controller.signal),
    ]).then(([stats, tombstones, counties, index]) => {
      if (controller.signal.aborted) return;
      const ok = stats.status === 'fulfilled';
      setArchive({
        stats: ok ? stats.value : null,
        tombstones: tombstones.status === 'fulfilled' ? tombstones.value.tombstones.length : null,
        counties: counties.status === 'fulfilled' ? counties.value.rows : null,
        built: index.status === 'fulfilled' ? index.value.generatedAt : ok ? stats.value.generatedAt : null,
        tiles: index.status === 'fulfilled' ? index.value.tiles : null,
        state: ok ? 'ok' : 'down',
      });
    });
    return () => {
      controller.abort();
    };
  }, []);

  const choose = useCallback((next: TabId) => {
    setTab(next);
    setMenu(false);
  }, []);

  const built = useMemo(() => {
    if (archive.built === null) return '—';
    const d = new Date(archive.built);
    if (Number.isNaN(d.getTime())) return archive.built;
    const day = d.toISOString().slice(0, 10);
    const hm = d.toISOString().slice(11, 16);
    return `${day} ${hm}Z`;
  }, [archive.built]);

  return (
    <div className="dc" data-rails={RAILS[tab]} data-tab={tab}>
      <header className="dc-bar">
        <span className="dc-bloom" aria-hidden="true" />
        <img className="dc-mark" src="/mark.png" alt="" aria-hidden="true" />
        <span className="dc-word-text">darkroute.ai</span>
        <span className="dc-vr" aria-hidden="true" />
        <nav className="dc-tabs" role="tablist" aria-label="Console">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className="dc-tab"
              aria-selected={t.id === tab}
              onClick={() => {
                choose(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <span className="dc-spacer" />
        {tab !== 'monitoring' && tab !== 'reports' ? <label className="dc-search">
          <input
            type="search"
            value={query}
            placeholder="street, cross street, osm id, agency"
            aria-label="Search the archive"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
            }}
          />
          <kbd>/</kbd>
        </label> : null}
        <span className="dc-keys">
          <button
            type="button"
            className="dc-key"
            aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
            onClick={() => {
              setTheme(theme === 'dark' ? 'light' : 'dark');
            }}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          {/* `?app`: the apex sends a desk browser here otherwise, and this key
              is the one place a desk asks for the phone surface on purpose. */}
          <a className="dc-key" href="https://darkroute.ai/?app" aria-label="Open the driving app">
            <PhoneIcon />
          </a>
        </span>
        <button
          type="button"
          className="dc-menu"
          aria-label="Menu"
          aria-expanded={menu}
          onClick={() => {
            setMenu(!menu);
          }}
        >
          <MenuIcon />
        </button>
        {menu ? (
          <div className="dc-menu-sheet" role="menu">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                className="dc-tab"
                aria-selected={t.id === tab}
                onClick={() => {
                  choose(t.id);
                }}
              >
                {t.label}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className="dc-tab"
              onClick={() => {
                setTheme(theme === 'dark' ? 'light' : 'dark');
                setMenu(false);
              }}
            >
              {theme === 'dark' ? 'Light theme' : 'Dark theme'}
            </button>
          </div>
        ) : null}
      </header>

      {tab === 'archive' ? <ArchiveView archive={archive} query={query} theme={theme} /> : null}
      {tab === 'reports' ? <ReportsView archive={archive} query={query} onQueryChange={setQuery} /> : null}
      {tab === 'monitoring' ? <MonitoringView /> : null}
      {tab === 'api' ? <ApiRefView archive={archive} /> : null}
      {tab === 'coverage' ? <CoverageView archive={archive} query={query} /> : null}

      <footer className="dc-status" aria-label="Archive status">
        <span>Map data © OpenStreetMap contributors</span>
        <a href="https://darkroute.ai/alpr/">ALPR camera guide</a>
        <span className="dc-mono">ODbL-1.0</span>
        <span className="dc-spacer" />
        <span>build {built}</span>
        <span>z11 tiles{archive.tiles === null ? '' : ` · ${formatCount(archive.tiles)}`}</span>
        <span>{formatCount(archive.stats?.cameras ?? null)} ALPR cameras</span>
        <span>{formatCount(archive.tombstones)} tombstones</span>
        <span className="dc-ok" data-state={archive.state}>
          {archive.state === 'ok' ? 'build ok' : archive.state === 'pending' ? 'reading' : 'archive unreachable'}
        </span>
      </footer>
    </div>
  );
}

function SunIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
  );
}

function PhoneIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18h2" />
    </svg>
  );
}

function MenuIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
