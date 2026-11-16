// Clients > Retention. Every company sold on the Opps tab, in two columns:
// "Sold" (still with us) and "They left us" (status Old Client), with the
// retention rate across the top. The split and the rate come from
// utils/clientRetention; this file only lays them out.
//
// Moving a company between the columns is its status: "Left us" sets it to
// Old Client, "Back" sets it to Client, through the same updateProspect the
// company popup saves with, so the Clients / Old Clients tabs agree.
import { useCallback, useMemo } from 'react';
import { DataTable } from '../common/DataTable';
import { clientRetention, retentionPercent } from '../../utils/clientRetention';

const usd = (n) => (n ? `$${Math.round(n).toLocaleString('en-US')}` : '-');

const btn = (accent) => ({
  padding: '0.15rem 0.5rem', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
  fontSize: '0.68rem', fontWeight: 600, whiteSpace: 'nowrap',
  border: `1px solid ${accent.border}`, background: accent.bg, color: accent.color,
});
const LEFT_BTN = { border: '#FCA5A5', bg: '#FEF2F2', color: '#B91C1C' };
const BACK_BTN = { border: '#86EFAC', bg: '#F0FDF4', color: '#166534' };

function columnsFor({ side, onSelectProspect, onMove }) {
  return [
    {
      key: 'company', label: 'Company', defaultWidth: 170,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {r.prospectId && onSelectProspect ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSelectProspect(r.prospectId); }}
              title={r.accounts.length > 1 ? `Sold under: ${r.accounts.join(', ')}` : 'Open the company'}
              style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: '#1D4ED8', fontWeight: 600, fontFamily: 'inherit', fontSize: 'inherit', textAlign: 'left' }}
            >{r.company}</button>
          ) : <span style={{ fontWeight: 600 }}>{r.company}</span>}
          {!r.inTableView && (
            <span
              title="Sold on the Opps tab, but no Table View company matches this Account. It counts as retained until it's added and marked Old Client."
              style={{ fontSize: '0.6rem', fontWeight: 700, color: '#92400E', background: '#FEF3C7', borderRadius: 999, padding: '1px 6px', whiteSpace: 'nowrap' }}
            >Not in Table</span>
          )}
        </span>
      ),
      exportValue: (r) => r.company,
    },
    { key: 'status', label: 'Status', defaultWidth: 90, render: (r) => r.status || '-' },
    { key: 'cdm', label: 'CDM', defaultWidth: 100, render: (r) => r.cdm || '-' },
    { key: 'soldOpps', label: 'Opps', defaultWidth: 55 },
    { key: 'soldAmount', label: 'Sold $', defaultWidth: 100, render: (r) => usd(r.soldAmount), exportValue: (r) => r.soldAmount },
    {
      key: 'lastSold', label: 'Last Sold', defaultWidth: 90,
      render: (r) => r.lastSold || '-',
      getSortValue: (r) => r.lastSoldMs,
    },
    {
      key: 'move', label: 'Move', defaultWidth: 100,
      render: (r) => (r.prospectId && onMove ? (
        side === 'retained' ? (
          <button
            type="button"
            style={btn(LEFT_BTN)}
            title={`${r.company} left us: set its status to Old Client`}
            onClick={(e) => { e.stopPropagation(); onMove(r, 'Old Client'); }}
          >Left →</button>
        ) : (
          <button
            type="button"
            style={btn(BACK_BTN)}
            title={`${r.company} is a client again: set its status to Client`}
            onClick={(e) => { e.stopPropagation(); onMove(r, 'Client'); }}
          >← Back</button>
        )
      ) : null),
      exportValue: () => '',
    },
  ];
}

function Side({ title, accent, rows, tableId, columns, settings, updateSettings, empty }) {
  return (
    <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '0.5rem 0.75rem', borderBottom: '1px solid #E2E8F0', background: accent }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B' }}>{title}</span>
        <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{rows.length} {rows.length === 1 ? 'company' : 'companies'}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <DataTable
          tableId={tableId}
          exportFileName={title}
          columns={columns}
          rows={rows}
          alwaysVisible={['company']}
          emptyMessage={empty}
          // Half a page each: the columns scale to the half rather than
          // scrolling the move button off the side.
          fitWidth
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>
    </div>
  );
}

export function ClientRetentionView({ oppsRecords, prospects = [], settings, updateSettings, updateProspect, onSelectProspect }) {
  const result = useMemo(() => clientRetention(oppsRecords || [], prospects), [oppsRecords, prospects]);
  const selectById = useCallback((id) => {
    const p = prospects.find(x => x.id === id);
    if (p) onSelectProspect(p);
  }, [prospects, onSelectProspect]);
  const move = useCallback((row, status) => {
    Promise.resolve(updateProspect(row.prospectId, { status }))
      .catch(err => alert(`Could not update ${row.company}: ${err?.message || err}`));
  }, [updateProspect]);
  const openProspect = onSelectProspect ? selectById : null;
  const onMove = updateProspect ? move : null;
  const retainedCols = useMemo(() => columnsFor({ side: 'retained', onSelectProspect: openProspect, onMove }), [openProspect, onMove]);
  const leftCols = useMemo(() => columnsFor({ side: 'left', onSelectProspect: openProspect, onMove }), [openProspect, onMove]);
  const loading = oppsRecords == null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '0.75rem 1.25rem', gap: '0.75rem', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
        <div data-retention-rate title="Companies still with us, divided by every company with a Sold opp on the Opps tab. A company counts as left when its status is Old Client.">
          <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Retention Rate</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#0F172A', lineHeight: 1.1 }}>{loading ? '…' : retentionPercent(result.rate)}</div>
        </div>
        <div style={{ fontSize: '0.8rem', color: '#475569' }}>
          {loading
            ? 'Loading opps…'
            : `${result.retained.length} of ${result.total} sold ${result.total === 1 ? 'company' : 'companies'} still with us, ${result.left.length} left.`}
          <div style={{ fontSize: '0.7rem', color: '#94A3B8', marginTop: 2 }}>
            Every company with a Sold opp on the Opps tab. Status Old Client moves it to They left us.
          </div>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '0.75rem' }}>
        <Side
          title="Sold"
          accent="#F0FDF4"
          rows={result.retained}
          tableId="client-retention-sold"
          columns={retainedCols}
          settings={settings}
          updateSettings={updateSettings}
          empty={loading ? 'Loading…' : 'No Sold opps on the Opps tab yet'}
        />
        <Side
          title="They left us"
          accent="#FEF2F2"
          rows={result.left}
          tableId="client-retention-left"
          columns={leftCols}
          settings={settings}
          updateSettings={updateSettings}
          empty={loading ? 'Loading…' : 'Nobody has left: no sold company has status Old Client'}
        />
      </div>
    </div>
  );
}
