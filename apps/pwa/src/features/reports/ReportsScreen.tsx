import { useEffect, useId, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { BACK_TO_MORE, BackKey, ReloadTitle } from '../../components/nav';
import { MisuseScreen } from '../misuse/MisuseScreen.tsx';
import { setMisuseCasesOnly } from '../misuse/misuseView.ts';
import { NewsScreen } from '../news/NewsScreen.tsx';
import './reports.css';

type ReportsTab = 'abuse' | 'news';
const TABS: readonly ReportsTab[] = ['abuse', 'news'];
const LABELS: Readonly<Record<ReportsTab, string>> = { abuse: 'Abuse', news: 'News' };

/** Shared report sources under one page; choosing a tab does not add a back step. */
export function ReportsScreen({ initialTab = 'abuse' }: { readonly initialTab?: ReportsTab } = {}): ReactElement {
  const [tab, setTab] = useState<ReportsTab>(initialTab);
  const id = useId();
  useEffect(() => { setMisuseCasesOnly(false); }, []);
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    let next: ReportsTab;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = tab === 'abuse' ? 'news' : 'abuse';
    else if (event.key === 'Home') next = 'abuse';
    else if (event.key === 'End') next = 'news';
    else return;
    event.preventDefault();
    setTab(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  };
  return <section className="fwm-reports" aria-label="Reports">
    <header className="fwm-reports-header">
      <BackKey to="more" label={BACK_TO_MORE} />
      <ReloadTitle title="Reports" className="fwm-reports-title" />
    </header>
    <div className="fwm-reports-tabs" role="tablist" aria-label="Report type">
      {TABS.map((key) => <button type="button" role="tab" key={key}
        id={`${id}-tab-${key}`} aria-controls={`${id}-panel-${key}`}
        aria-selected={tab === key} tabIndex={tab === key ? 0 : -1}
        className="fwm-reports-tab" onClick={() => { setTab(key); }} onKeyDown={onTabKey}>
        {LABELS[key]}
      </button>)}
    </div>
    {TABS.map((key) => <div key={key} className="fwm-reports-panel" role="tabpanel"
      id={`${id}-panel-${key}`} aria-labelledby={`${id}-tab-${key}`} hidden={tab !== key}>
      {tab !== key ? null : key === 'abuse' ? <MisuseScreen embedded onViewNews={() => { setTab('news'); }} /> : <NewsScreen embedded />}
    </div>)}
  </section>;
}

/** Existing bookmarks retain their topic while both routes show the Reports page. */
export function MisuseReportsScreen(): ReactElement { return <ReportsScreen />; }
export function NewsReportsScreen(): ReactElement { return <ReportsScreen initialTab="news" />; }
