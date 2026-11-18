// Prospecting > Targets: the sustainability targets saved on the company
// popups' Targets tabs, one row per company: the target whose refresh is due
// soonest (utils/companyTargets soonestTargetPerCompany), with a count of
// how many targets the company has. Read here, edited on the company: the
// company name opens its popup. Targets hidden on a company's tab stay out
// unless "Show hidden" is ticked, and a row that is a hidden target then
// reads greyed out the way it does there.
// The one thing edited here is Reached Out: a tick per company, saved on
// the company record as `targetsReachedOut`, for whether it has been
// contacted about its targets.
// Each target type saved gets its own subtab (targetTypeTabs): there the row
// is the company's soonest target OF THAT TYPE, and only companies that
// have one are listed. "All" is the page as it was. The open subtab is
// remembered; the column layout is one layout shared by all of them.
import { targetsSearchedAt, fmtSearched } from '../../utils/targetsSearched';
import { useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { allSavedTargets, soonestTargetPerCompany, isNoTargetRow, refreshDue, scopesLabel, targetLinkHref, targetLinkLabel, targetTypeTabs, targetTypeKey, REFRESH_CYCLE_YEARS, TARGET_SCOPES } from '../../utils/companyTargets';
import { reportingTier } from '../../utils/tierSource';

const REFRESH_COLORS = {
  overdue: { background: '#FEE2E2', color: '#991B1B' },
  due: { background: '#FEF3C7', color: '#92400E' },
  upcoming: { background: '#F1F5F9', color: '#334155' },
};
const YEAR_COLUMNS = [
  { key: 'yearSet', label: 'Year Set' },
  { key: 'baseYear', label: 'Base Year' },
  { key: 'targetYear1', label: 'Target Year 1' },
  { key: 'targetYear2', label: 'Target Year 2' },
];
const SCOPE_LABELS = { scope1: 'Scope 1', scope2: 'Scope 2', scope3: 'Scope 3' };
const dash = <span style={{ color: '#CBD5E1' }}>-</span>;
const TYPE_TAB_KEY = 'prospecting-targets:type-tab';
const ALL_TAB = '\u0000all';
function readSavedTypeTab() {
  try { return localStorage.getItem(TYPE_TAB_KEY) ?? ALL_TAB; } catch { return ALL_TAB; }
}

export function ProspectingTargets({ prospects, settings, updateSettings, updateProspect, onSelectProspect }) {
  const [showHidden, setShowHidden] = useState(false);
  const all = useMemo(() => allSavedTargets(prospects), [prospects]);
  const hiddenCount = all.filter(t => t.hidden).length;
  const listed = useMemo(() => (showHidden ? all : all.filter(t => !t.hidden)), [all, showHidden]);
  const typeTabs = useMemo(() => targetTypeTabs(listed), [listed]);
  const [savedTab, setSavedTab] = useState(readSavedTypeTab);
  // A remembered type nobody has any more falls back to All.
  const typeTab = savedTab !== ALL_TAB && typeTabs.some(t => t.key === savedTab) ? savedTab : ALL_TAB;
  const pickTab = key => {
    setSavedTab(key);
    try { localStorage.setItem(TYPE_TAB_KEY, key); } catch { /* private mode */ }
  };
  const inTab = t => typeTab === ALL_TAB || targetTypeKey(t) === typeTab;
  const rows = useMemo(
    () => soonestTargetPerCompany(typeTab === ALL_TAB ? listed : listed.filter(t => targetTypeKey(t) === typeTab)),
    [listed, typeTab],
  );
  const shown = all.filter(t => !t.hidden && inTab(t));
  const typeLabel = typeTab === ALL_TAB ? '' : typeTabs.find(t => t.key === typeTab)?.label || '';
  const allCompanies = new Set(listed.map(t => t.prospect.id)).size;
  const companies = new Set(shown.map(t => t.prospect.id)).size;
  // Companies whose soonest refresh is due this year or overdue.
  const dueNow = soonestTargetPerCompany(shown).filter(t => ['due', 'overdue'].includes(refreshDue(t)?.status)).length;

  const columns = [
    {
      key: 'company', label: 'Company', defaultWidth: 220,
      getSortValue: r => r.company.toLowerCase(),
      getFilterValue: r => r.company,
      exportValue: r => r.company,
      render: r => (onSelectProspect ? (
        <button
          type="button"
          onClick={() => onSelectProspect(r.prospect)}
          title={`Open ${r.company} (its Targets tab is where these are edited)`}
          style={{ padding: 0, border: 0, background: 'none', font: 'inherit', fontWeight: 600, color: '#1D4ED8', cursor: 'pointer', textAlign: 'left' }}
        >{r.company}</button>
      ) : <span style={{ fontWeight: 600 }}>{r.company}</span>),
    },
    {
      key: 'targetCount', label: 'Targets', defaultWidth: 90,
      getSortValue: r => r.targetCount,
      getFilterValue: r => String(r.targetCount),
      exportValue: r => r.targetCount,
      render: r => (
        <span
          style={{ fontVariantNumeric: 'tabular-nums' }}
          title={`${r.company} has ${r.targetCount} ${typeLabel ? `${typeLabel} ` : ''}${r.targetCount === 1 ? 'target' : 'targets'}; this row is the one due a refresh soonest`}
        >{r.targetCount}</span>
      ),
    },
    {
      key: 'reachedOut', label: 'Reached Out', defaultWidth: 135,
      getSortValue: r => (r.prospect.targetsReachedOut ? 1 : 0),
      getFilterValue: r => (r.prospect.targetsReachedOut ? 'Yes' : 'No'),
      exportValue: r => (r.prospect.targetsReachedOut ? 'Yes' : 'No'),
      render: r => (
        <label style={{ display: 'flex', justifyContent: 'center', cursor: updateProspect ? 'pointer' : 'default' }}>
          <input
            type="checkbox"
            checked={!!r.prospect.targetsReachedOut}
            disabled={!updateProspect}
            aria-label={`Reached out to ${r.company} about its targets`}
            title={r.prospect.targetsReachedOut ? 'Reached out about its targets. Untick to clear.' : 'Tick once you have reached out about its targets'}
            onChange={e => updateProspect(r.prospect.id, { targetsReachedOut: e.target.checked })}
            style={{ cursor: 'inherit' }}
          />
        </label>
      ),
    },
    {
      key: 'searchedAt', label: 'Last Searched', defaultWidth: 125,
      getSortValue: r => targetsSearchedAt(r.prospect) || null,
      getFilterValue: r => fmtSearched(targetsSearchedAt(r.prospect)),
      exportValue: r => targetsSearchedAt(r.prospect),
      render: r => {
        const day = targetsSearchedAt(r.prospect);
        return day
          ? <span style={{ fontVariantNumeric: 'tabular-nums' }} title="When this company's targets were last searched for (set on its Targets tab)">{fmtSearched(day)}</span>
          : dash;
      },
    },
    {
      key: 'tier', label: 'Tier', defaultWidth: 90,
      getFilterValue: r => reportingTier(r.prospect) || '',
      exportValue: r => reportingTier(r.prospect) || '',
      render: r => reportingTier(r.prospect) || dash,
    },
    {
      key: 'action', label: 'Action', defaultWidth: 110,
      getFilterValue: r => r.action,
      exportValue: r => r.action,
      render: r => r.action || dash,
    },
    {
      key: 'type', label: 'Target Type', defaultWidth: 180,
      getFilterValue: r => r.type,
      exportValue: r => r.type,
      render: r => r.type || dash,
    },
    {
      key: 'commitmentType', label: 'Commitment Type', defaultWidth: 140,
      getFilterValue: r => r.commitmentType,
      exportValue: r => r.commitmentType,
      render: r => r.commitmentType || dash,
    },
    ...YEAR_COLUMNS.map(c => ({
      key: c.key, label: c.label, defaultWidth: 105,
      getSortValue: r => (r[c.key] ? Number(r[c.key]) : null),
      getFilterValue: r => r[c.key],
      exportValue: r => r[c.key],
      render: r => (r[c.key] ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r[c.key]}</span> : dash),
    })),
    ...TARGET_SCOPES.map(k => ({
      key: k, label: SCOPE_LABELS[k], defaultWidth: 80,
      getSortValue: r => (r[k] ? 1 : 0),
      getFilterValue: r => (r[k] ? 'Yes' : 'No'),
      exportValue: r => (r[k] ? 'Yes' : 'No'),
      render: r => (r[k] ? <span style={{ color: '#16A34A', fontWeight: 800 }} aria-label="Yes">{'✓'}</span> : dash),
    })),
    {
      key: 'scopes', label: 'Scopes', defaultWidth: 90,
      getFilterValue: r => scopesLabel(r),
      exportValue: r => scopesLabel(r),
      render: r => scopesLabel(r) || dash,
    },
    {
      key: 'classification', label: 'Classification', defaultWidth: 130,
      getFilterValue: r => r.classification,
      exportValue: r => r.classification,
      render: r => r.classification || dash,
    },
    {
      key: 'status', label: 'Status', defaultWidth: 150,
      getFilterValue: r => r.status,
      exportValue: r => r.status,
      render: r => r.status || dash,
    },
    {
      key: 'datePublished', label: 'Date Published', defaultWidth: 120,
      getFilterValue: r => r.datePublished,
      exportValue: r => r.datePublished,
      render: r => (r.datePublished ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.datePublished}</span> : dash),
    },
    {
      key: 'sourceUrl', label: 'Link', defaultWidth: 190,
      getSortValue: r => targetLinkLabel(r.sourceUrl) || null,
      getFilterValue: r => targetLinkLabel(r.sourceUrl),
      exportValue: r => targetLinkHref(r.sourceUrl),
      render: r => {
        const href = targetLinkHref(r.sourceUrl);
        if (!href) return <span style={{ color: '#CBD5E1' }} title="No link saved. Add one on the company's Targets tab.">-</span>;
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" title={`Open ${href}`} style={{ color: '#1D4ED8' }}>
            {targetLinkLabel(r.sourceUrl)}
          </a>
        );
      },
    },
    {
      key: 'refreshDue', label: 'Refresh Due', defaultWidth: 160,
      getSortValue: r => refreshDue(r)?.year ?? null,
      getFilterValue: r => refreshDue(r)?.label || 'No year set',
      exportValue: r => refreshDue(r)?.year ?? '',
      render: r => {
        const due = refreshDue(r);
        if (!due) return <span style={{ color: '#94A3B8', fontSize: '0.75rem' }} title="No year set logged">-</span>;
        return (
          <span
            title={`Refreshed every ${REFRESH_CYCLE_YEARS} years: set in ${r.yearSet}, so due in ${due.year}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontVariantNumeric: 'tabular-nums' }}
          >
            <strong style={{ color: '#1E293B' }}>{due.year}</strong>
            <span style={{ ...REFRESH_COLORS[due.status], padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700 }}>{due.label}</span>
          </span>
        );
      },
    },
  ];

  return (
    <div style={{ padding: '0.25rem 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }} data-prospecting-targets>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', fontSize: '0.8rem', color: '#475569' }}>
        <span>
          <strong style={{ color: '#1E293B' }}>{companies}</strong> {companies === 1 ? 'company' : 'companies'} with
          {' '}<strong style={{ color: '#1E293B' }}>{shown.length}</strong> {typeLabel ? `${typeLabel} ` : ''}{shown.length === 1 ? 'target' : 'targets'} saved
          {dueNow > 0 && <>; <strong style={{ color: '#92400E' }}>{dueNow}</strong> due a refresh this year or overdue</>}.
          {' '}Each row is the company's {typeLabel ? `${typeLabel} target` : 'target'} with the soonest refresh. Add and edit them on each company's
          Targets tab; click a company to open it. Tick Reached Out once you have contacted a company about its targets.
        </span>
        {hiddenCount > 0 && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />
            Show hidden ({hiddenCount})
          </label>
        )}
      </div>
      {typeTabs.length > 0 && (
        <div role="tablist" aria-label="Target type" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', borderBottom: '1px solid #E2E8F0' }}>
          {[{ key: ALL_TAB, label: 'All', companies: allCompanies }, ...typeTabs].map(t => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={typeTab === t.key}
              onClick={() => pickTab(t.key)}
              title={t.key === ALL_TAB
                ? 'Every company, on its target with the soonest refresh'
                : `${t.companies} ${t.companies === 1 ? 'company' : 'companies'} with a ${t.label} target`}
              style={{
                padding: '0.35rem 0.8rem', border: 'none', background: 'none', fontFamily: 'inherit',
                fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer', marginBottom: -1, whiteSpace: 'nowrap',
                color: typeTab === t.key ? '#0A66C2' : '#64748B',
                borderBottom: `2px solid ${typeTab === t.key ? '#0A66C2' : 'transparent'}`,
              }}
            >{t.label} <span style={{ fontWeight: 500, opacity: 0.75 }}>({t.companies})</span></button>
          ))}
        </div>
      )}
      <div style={{ height: '70vh', minHeight: 300, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
        <DataTable
          tableId="prospecting-targets"
          columns={columns}
          rows={rows}
          alwaysVisible={['company']}
          defaultHidden={['scopes']}
          defaultSort={{ key: 'refreshDue', direction: 'asc' }}
          // Hidden targets sit below the rest and companies logged as having
          // no target set at the very bottom, both whatever the sort.
          rowGroup={r => (isNoTargetRow(r) ? 2 : r.hidden ? 1 : 0)}
          // A company ticked Reached Out reads green, and that wins over the
          // grey of a hidden or no-target row: the grey says "nothing to do
          // here yet", the tick says something was done.
          rowStyle={r => (r.prospect.targetsReachedOut ? { background: '#DCFCE7' }
            : isNoTargetRow(r) ? { opacity: 0.6, background: '#F1F5F9', filter: 'grayscale(1)' }
              : r.hidden ? { opacity: 0.45, background: '#F1F5F9' } : undefined)}
          emptyMessage={all.length ? 'No targets match the filters.' : 'No targets saved yet. Add them on a company popup\'s Targets tab.'}
          exportFileName={typeLabel ? `Company targets - ${typeLabel}` : 'Company targets'}
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>
    </div>
  );
}
