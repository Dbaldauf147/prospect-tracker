import { lazy, Suspense, useState } from 'react';
import { PipelineView } from '../PipelineView/PipelineView';

// YOY and Progress are heavy and were already code-split at the App
// level; keep them lazy here so opening Charts only pulls in the tab
// the user actually views.
const YOYView = lazy(() => import('../YOYView/YOYView').then(m => ({ default: m.YOYView })));
const ProgressView = lazy(() => import('../ProgressView/ProgressView').then(m => ({ default: m.ProgressView })));
const WeeklyReportView = lazy(() => import('../WeeklyReportView/WeeklyReportView').then(m => ({ default: m.WeeklyReportView })));

const TABS = [
  { key: 'yoy', label: 'YOY' },
  { key: 'progress', label: 'Progress' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'weekly', label: 'Weekly Report' },
];

// Host for the "Charts" top-level tab: YOY / Progress / Pipeline as
// sub-tabs. Each sub-view still renders its own full-height layout, so
// this just stacks a thin sub-tab bar above the active one.
export function ChartsView({ prospects, settings, updateSettings, cdmName, onSelectProspect }) {
  const [tab, setTab] = useState('yoy');
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', borderBottom: '1px solid #E2E8F0', padding: '0.5rem 1rem 0', flexShrink: 0 }}>
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: active ? '2px solid #2563EB' : '2px solid transparent',
                color: active ? '#2563EB' : '#64748B',
                fontSize: '0.85rem',
                fontWeight: 700,
                padding: '0.5rem 0.9rem',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {tab === 'yoy' && (
          <Suspense fallback={<div className="loading">Loading view…</div>}>
            <YOYView />
          </Suspense>
        )}
        {tab === 'progress' && (
          <Suspense fallback={<div className="loading">Loading view…</div>}>
            <ProgressView prospects={prospects} settings={settings} cdmName={cdmName} />
          </Suspense>
        )}
        {tab === 'pipeline' && <PipelineView prospects={prospects} cdmName={cdmName} settings={settings} onSelectProspect={onSelectProspect} />}
        {tab === 'weekly' && (
          <Suspense fallback={<div className="loading">Loading view…</div>}>
            <WeeklyReportView settings={settings} updateSettings={updateSettings} cdmName={cdmName} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
