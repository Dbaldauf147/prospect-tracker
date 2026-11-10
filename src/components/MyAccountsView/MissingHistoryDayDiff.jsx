// All Missing History: click a day's Companies count to see which companies
// were added to and left My Accounts that day, with every company on either
// side listed so the two counts and the moves add up.
//
// Two sources, best first:
//   1. The history rows themselves, when both days recorded their company
//      ids (utils/missingHistory, from Nov 2026 on): exact.
//   2. The nightly cloud backups taken either side of the day, with the
//      page's own membership rule run over each on the server
//      (utils/backupMembership, api/backup-fetch part=membership).
// The rule is also run over today's live data and compared with the page,
// so a drift between the two shows here rather than as a silent miscount.
// Sits under the company popup (z 200) so a clicked name opens on top.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DataTable } from '../common/DataTable';
import { apiFetch } from '../../utils/apiFetch';
import { backupsForDay, diffMembership } from '../../utils/backupMembership';
import { countedMyAccounts } from '../../utils/myAccountsMembership';
import { dayCdmsById } from '../../utils/missingHistory';

const fmtDay = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const fmtCreated = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
};
const CHANGE_COLOR = { Added: '#047857', Left: '#B91C1C', Stayed: '#64748B' };

async function fetchMembership(name, cdmName) {
  const r = await apiFetch(`/api/backup-fetch?name=${encodeURIComponent(name)}&part=membership&cdm=${encodeURIComponent(cdmName || '')}`);
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
  return body?.value || { members: {}, cards: {}, mapped: [] };
}

// A history row as a membership: cards from the live prospects, with the
// CDM the day saved (row.cdms). A day saved before CDMs were kept has
// only today's card to go on, so its CDM is flagged cdmIsNow.
function membershipFromRow(row, cardsById) {
  const saved = dayCdmsById(row);
  const members = {};
  const cards = {};
  for (const id of row.ids) {
    members[id] = '';
    const p = cardsById.get(id);
    if (!p) continue;
    const card = { company: p.company, cdm: p.cdm, tier: p.tier, tierOwnTarget: p.tierOwnTarget, status: p.status, substatus: p.substatus, vertical: p.vertical, createdAt: typeof p.createdAt === 'string' ? p.createdAt : '' };
    if (saved) card.cdm = saved.get(String(id)) ?? '';
    else card.cdmIsNow = true;
    cards[id] = card;
  }
  return { members, cards, mapped: [] };
}

export function MissingHistoryDayDiff({ day, prevDay, dayRow, prevRow, cdmName, getLiveCheck, settings, updateSettings, onSelectCompany, onClose }) {
  const [state, setState] = useState({ loading: true, error: '', source: '', before: null, after: null, diff: null });
  const [tab, setTab] = useState('All');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (Array.isArray(dayRow?.ids) && Array.isArray(prevRow?.ids)) {
          const live = getLiveCheck?.();
          const cardsById = new Map((live?.inputs?.prospects || []).map(p => [String(p.id), p]));
          const b = membershipFromRow(prevRow, cardsById);
          const a = membershipFromRow(dayRow, cardsById);
          if (!cancelled) setState({ loading: false, error: '', source: 'ids', before: null, after: null, diff: diffMembership(b, a) });
          return;
        }
        const r = await apiFetch('/api/backups-list');
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
        const { before, after } = backupsForDay(body?.files || [], day, prevDay);
        if (!after) throw new Error(`There is no nightly backup from after ${fmtDay(day)} ended yet, so that day can't be compared.`);
        if (!before) throw new Error(`The nightly backup from before ${fmtDay(day)} is no longer kept (the last 30 nights are), so that day can't be compared.`);
        const [b, a] = await Promise.all([fetchMembership(before.name, cdmName), fetchMembership(after.name, cdmName)]);
        if (!cancelled) setState({ loading: false, error: '', source: 'backups', before, after, diff: diffMembership(b, a) });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err?.message || String(err), source: '', before: null, after: null, diff: null });
      }
    })();
    return () => { cancelled = true; };
  }, [day, prevDay, dayRow, prevRow, cdmName, getLiveCheck]);

  // The rule run over today's data, against the page's own count. Only
  // meaningful for the backup source, which relies on the rule.
  const ruleCheck = useMemo(() => {
    if (state.source !== 'backups') return null;
    const live = getLiveCheck?.();
    if (!live?.inputs || !live?.ids) return null;
    const ruled = new Set([...countedMyAccounts(live.inputs).keys()].map(String));
    const page = new Set(live.ids.map(String));
    const byId = new Map((live.inputs.prospects || []).map(p => [String(p.id), p.company || '']));
    const onlyRule = [...ruled].filter(id => !page.has(id)).map(id => byId.get(id) || id);
    const onlyPage = [...page].filter(id => !ruled.has(id)).map(id => byId.get(id) || id);
    return { page: page.size, ruled: ruled.size, onlyRule, onlyPage };
  }, [state.source, getLiveCheck]);

  const allRows = state.diff?.rows || [];
  const rows = tab === 'All' ? allRows : allRows.filter(r => r.change === tab);
  const counts = state.diff?.counts;

  const columns = useMemo(() => [
    {
      key: 'company', label: 'Company', defaultWidth: 220, sticky: true,
      render: r => (onSelectCompany
        ? <span style={{ fontWeight: 600, color: 'var(--color-accent)', cursor: 'pointer' }} onClick={() => onSelectCompany(r)}>{r.company || '(no name)'}</span>
        : <span style={{ fontWeight: 600 }}>{r.company || '(no name)'}</span>),
    },
    { key: 'change', label: 'Change', defaultWidth: 90, render: r => <span style={{ fontWeight: 700, color: CHANGE_COLOR[r.change] }}>{r.change}</span> },
    { key: 'whatChanged', label: 'What Changed', defaultWidth: 260 },
    { key: 'whyBefore', label: 'On the List Before Because', defaultWidth: 150 },
    { key: 'whyAfter', label: 'On the List After Because', defaultWidth: 150 },
    { key: 'cdmBefore', label: 'CDM Before', defaultWidth: 130 },
    { key: 'cdmAfter', label: 'CDM After', defaultWidth: 130 },
    {
      key: 'mappedThatDay', label: 'Mapped to Targets That Day', defaultWidth: 120,
      getSortValue: r => (r.mappedThatDay ? 1 : 0),
      getFilterValue: r => (r.mappedThatDay ? 'Yes' : 'No'),
      exportValue: r => (r.mappedThatDay ? 'Yes' : 'No'),
      render: r => (r.mappedThatDay ? 'Yes' : <span style={{ color: '#94A3B8' }}>No</span>),
    },
    { key: 'tier', label: 'Tier', defaultWidth: 90 },
    { key: 'vertical', label: 'Vertical', defaultWidth: 140 },
    { key: 'status', label: 'Status', defaultWidth: 110 },
    {
      key: 'createdAt', label: 'Added to Tracker', defaultWidth: 120,
      getSortValue: r => Date.parse(r.createdAt || '') || 0,
      getFilterValue: r => fmtCreated(r.createdAt),
      exportValue: r => fmtCreated(r.createdAt),
      render: r => fmtCreated(r.createdAt) || <span style={{ color: '#94A3B8' }}>-</span>,
    },
  ], [onSelectCompany]);

  const tabBtn = (key, n) => (
    <button
      key={key}
      type="button"
      onClick={() => setTab(key)}
      style={{
        padding: '0.25rem 0.7rem', borderRadius: 5, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        border: `1px solid ${tab === key ? '#2563EB' : '#CBD5E1'}`, background: tab === key ? '#EFF6FF' : '#fff', color: tab === key ? '#1D4ED8' : '#334155',
      }}
    >{`${key} (${n.toLocaleString()})`}</button>
  );

  const histBefore = prevRow?.companies;
  const histAfter = dayRow?.companies;
  const matchesHistory = counts && histBefore != null && histAfter != null && counts.before === histBefore && counts.after === histAfter;
  const note = { fontSize: '0.74rem', padding: '0.45rem 0.6rem', borderRadius: 6, lineHeight: 1.5 };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, width: 1200, maxWidth: '100%', height: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B' }}>
              {prevDay ? `My Accounts companies, ${fmtDay(prevDay)} to ${fmtDay(day)}` : `My Accounts companies on ${fmtDay(day)}`}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#64748B', lineHeight: 1.45, maxWidth: 1000 }}>
              {state.source === 'ids'
                ? 'From the company lists the history recorded on those two days. '
                : `From the nightly backups taken either side of the day${state.before && state.after ? ` (${fmtWhen(state.before.createdTime)} and ${fmtWhen(state.after.createdTime)})` : ''}, with the My Accounts rules run over each: your CDM and Tier 1/2, on your Targets list, or a Client; a Dan target; or an open opp. `}
              Inactive and Qualifying companies are left out, as on the history. Every company on either side is listed, so Export Excel on All gives the whole picture.
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '0.6rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1, minHeight: 0 }}>
          {state.loading && <div style={{ fontSize: '0.8rem', color: '#64748B' }}>Reading the nightly backups...</div>}
          {state.error && <div style={{ ...note, background: '#FEF3C7', color: '#92400E' }}>{state.error}</div>}
          {counts && (
            <div style={{ ...note, background: '#F8FAFC', color: '#334155' }}>
              <strong>{counts.before.toLocaleString()}</strong> before
              {' + '}<strong style={{ color: CHANGE_COLOR.Added }}>{counts.added.toLocaleString()} added</strong>
              {' - '}<strong style={{ color: CHANGE_COLOR.Left }}>{counts.left.toLocaleString()} left</strong>
              {' = '}<strong>{counts.after.toLocaleString()}</strong> after
              {` (${counts.stayed.toLocaleString()} stayed). `}
              {histBefore != null && histAfter != null && (matchesHistory
                ? <span style={{ color: '#047857' }}>{`Matches the history: ${histBefore.toLocaleString()} to ${histAfter.toLocaleString()}.`}</span>
                : <span style={{ color: '#92400E' }}>{`The history recorded ${histBefore.toLocaleString()} to ${histAfter.toLocaleString()}. The difference is companies the page counted differently that day than the backups show (for example opps or Targets rows that changed between the backup and the reading).`}</span>)}
            </div>
          )}
          {ruleCheck && (ruleCheck.onlyRule.length || ruleCheck.onlyPage.length) ? (
            <div style={{ ...note, background: '#FEF3C7', color: '#92400E' }} title={[...ruleCheck.onlyPage.map(n => `On the page only: ${n}`), ...ruleCheck.onlyRule.map(n => `From the rules only: ${n}`)].join('\n')}>
              {`Check against today's page: the rules give ${ruleCheck.ruled.toLocaleString()} companies, the page shows ${ruleCheck.page.toLocaleString()} (${ruleCheck.onlyPage.length} only on the page, ${ruleCheck.onlyRule.length} only from the rules). Hover for the names.`}
            </div>
          ) : ruleCheck ? (
            <div style={{ ...note, background: '#F0FDF4', color: '#166534' }}>
              {`Check against today's page: the rules give the same ${ruleCheck.page.toLocaleString()} companies the page shows.`}
            </div>
          ) : null}
          {state.diff && (
            <>
              <div style={{ display: 'flex', gap: 6 }}>
                {tabBtn('All', allRows.length)}
                {tabBtn('Added', counts.added)}
                {tabBtn('Left', counts.left)}
                {tabBtn('Stayed', counts.stayed)}
              </div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
                <DataTable
                  key={tab}
                  tableId="my-accounts-missing-history-day-moves"
                  exportFileName={`My Accounts ${tab} ${prevDay || ''} to ${day}`}
                  columns={columns}
                  rows={rows}
                  alwaysVisible={['company']}
                  gridLines
                  settings={settings}
                  updateSettings={updateSettings}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
