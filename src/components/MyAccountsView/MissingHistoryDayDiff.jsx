// All Missing History: click a day's Companies count to see which companies
// joined (and left) My Accounts that day. Compares the nightly cloud backups
// taken either side of the day (utils/backupMembership.js); the history row
// itself only holds counts. Sits under the company popup (z 200) so a
// clicked name opens on top of the list.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DataTable } from '../common/DataTable';
import { apiFetch } from '../../utils/apiFetch';
import { backupsForDay, diffMembership } from '../../utils/backupMembership';

const fmtDay = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const fmtCreated = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
};

async function fetchSlim(name) {
  const r = await apiFetch(`/api/backup-fetch?name=${encodeURIComponent(name)}&part=membership`);
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
  return body?.value || { prospects: [], mapped: [] };
}

export function MissingHistoryDayDiff({ day, prevDay, cdmName, settings, updateSettings, onSelectCompany, onClose }) {
  const [state, setState] = useState({ loading: true, error: '', before: null, after: null, diff: null });
  const [tab, setTab] = useState('joined');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch('/api/backups-list');
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
        const { before, after } = backupsForDay(body?.files || [], day, prevDay);
        if (!after) throw new Error(`There is no nightly backup from after ${fmtDay(day)} ended yet, so that day can't be compared.`);
        if (!before) throw new Error(`The nightly backup from before ${fmtDay(day)} is no longer kept (the last 30 nights are), so that day can't be compared.`);
        const [b, a] = await Promise.all([fetchSlim(before.name), fetchSlim(after.name)]);
        if (cancelled) return;
        setState({ loading: false, error: '', before, after, diff: diffMembership(b, a, cdmName) });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err?.message || String(err), before: null, after: null, diff: null });
      }
    })();
    return () => { cancelled = true; };
  }, [day, prevDay, cdmName]);

  const rows = state.diff ? state.diff[tab] : [];
  const columns = useMemo(() => [
    {
      key: 'company', label: 'Company', defaultWidth: 220, sticky: true,
      render: r => (onSelectCompany
        ? <span style={{ fontWeight: 600, color: 'var(--color-accent)', cursor: 'pointer' }} onClick={() => onSelectCompany(r)}>{r.company || '(no name)'}</span>
        : <span style={{ fontWeight: 600 }}>{r.company || '(no name)'}</span>),
    },
    { key: 'reason', label: 'What changed', defaultWidth: 260 },
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

  const tabBtn = (key, label, n) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      style={{
        padding: '0.25rem 0.7rem', borderRadius: 5, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        border: `1px solid ${tab === key ? '#2563EB' : '#CBD5E1'}`, background: tab === key ? '#EFF6FF' : '#fff', color: tab === key ? '#1D4ED8' : '#334155',
      }}
    >{`${label} (${n})`}</button>
  );

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, width: 1100, maxWidth: '100%', height: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B' }}>
              {prevDay ? `Companies that joined or left My Accounts, ${fmtDay(prevDay)} to ${fmtDay(day)}` : `Companies that joined or left My Accounts on ${fmtDay(day)}`}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#64748B', lineHeight: 1.45, maxWidth: 900 }}>
              Compares the nightly backups taken either side of the day
              {state.before && state.after ? ` (${fmtWhen(state.before.createdTime)} and ${fmtWhen(state.after.createdTime)})` : ''}.
              A company counts when its card has you as CDM, or is ticked as a Dan target, and isn&apos;t inactive or Qualifying.
              Companies brought onto the page only by an open opp aren&apos;t on the card, so they don&apos;t show here.
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '0.6rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', flex: 1, minHeight: 0 }}>
          {state.loading && <div style={{ fontSize: '0.8rem', color: '#64748B' }}>Reading the nightly backups...</div>}
          {state.error && <div style={{ fontSize: '0.78rem', padding: '0.45rem 0.6rem', borderRadius: 6, background: '#FEF3C7', color: '#92400E' }}>{state.error}</div>}
          {state.diff && (
            <>
              <div style={{ display: 'flex', gap: 6 }}>
                {tabBtn('joined', 'Joined', state.diff.joined.length)}
                {tabBtn('left', 'Left', state.diff.left.length)}
              </div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
                <DataTable
                  key={tab}
                  tableId="my-accounts-missing-history-day-diff"
                  exportFileName={`My Accounts ${tab} ${day}`}
                  columns={columns}
                  rows={rows}
                  defaultSort={{ key: 'company', direction: 'asc' }}
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
