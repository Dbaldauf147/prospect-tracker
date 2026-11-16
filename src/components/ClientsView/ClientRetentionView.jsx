// Clients > Retention. Every company sold on the Opps tab, in three columns:
// "Sold" (still with us), "They left us" (status Old Client) and "Scope
// expired" (marked by hand), with the retention rate across the top. The
// split and the rate come from utils/clientRetention; this file only lays
// them out.
//
// Two kinds of move:
//   - Left / Back change the company's status (Old Client / Client),
//     through the same updateProspect the company popup saves with, so the
//     Clients / Old Clients tabs agree.
//   - Expired / Other are marks kept in settings.clientRetentionMarks and
//     touch nothing else. Other ("sold by someone else") takes the company off
//     the page and out of the rate; it is listed under the columns to undo.
import { useCallback, useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import {
  clientRetention, retentionPercent, withRetentionMark, RETENTION_MARKS_KEY,
} from '../../utils/clientRetention';

const usd = (n) => (n ? `$${Math.round(n).toLocaleString('en-US')}` : '-');

const btn = (accent) => ({
  padding: '0.1rem 0.35rem', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
  fontSize: '0.66rem', fontWeight: 600, whiteSpace: 'nowrap',
  border: `1px solid ${accent.border}`, background: accent.bg, color: accent.color,
});
const LEFT_BTN = { border: '#FCA5A5', bg: '#FEF2F2', color: '#B91C1C' };
const BACK_BTN = { border: '#86EFAC', bg: '#F0FDF4', color: '#166534' };
const EXPIRED_BTN = { border: '#FCD34D', bg: '#FFFBEB', color: '#92400E' };
const OTHER_BTN = { border: '#CBD5E1', bg: '#F8FAFC', color: '#475569' };

function Actions({ side, row, onMove, onMark }) {
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  const canMove = !!(row.prospectId && onMove);
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {side === 'retained' && canMove && (
        <button type="button" style={btn(LEFT_BTN)}
          title={`${row.company} left us: set its status to Old Client`}
          onClick={stop(() => onMove(row, 'Old Client'))}>Left</button>
      )}
      {side === 'left' && canMove && (
        <button type="button" style={btn(BACK_BTN)}
          title={`${row.company} is a client again: set its status to Client`}
          onClick={stop(() => onMove(row, 'Client'))}>Back</button>
      )}
      {side !== 'expired' && (
        <button type="button" style={btn(EXPIRED_BTN)}
          title={`${row.company}'s scope expired: move it to Scope expired, out of the retention rate. Its status is not changed`}
          onClick={stop(() => onMark(row, 'expired'))}>Expired</button>
      )}
      {side === 'expired' && (
        <button type="button" style={btn(BACK_BTN)}
          title={`Take ${row.company} out of Scope expired: back to ${row.status && row.status.trim().toLowerCase() === 'old client' ? 'They left us' : 'Sold'}, by its status`}
          onClick={stop(() => onMark(row, ''))}>Undo</button>
      )}
      <button type="button" style={btn(OTHER_BTN)}
        title={`${row.company} was sold by someone else: leave it off this page and out of the rate. Listed under the columns to undo`}
        onClick={stop(() => onMark(row, 'other'))}>Other</button>
    </span>
  );
}

function columnsFor({ side, onSelectProspect, onMove, onMark }) {
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
      key: 'move', label: 'Move', defaultWidth: 200,
      render: (r) => <Actions side={side} row={r} onMove={onMove} onMark={onMark} />,
      exportValue: () => '',
    },
  ];
}

function Side({ title, accent, rows, tableId, columns, settings, updateSettings, empty, note }) {
  return (
    <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '0.5rem 0.75rem', borderBottom: '1px solid #E2E8F0', background: accent }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B' }}>{title}</span>
        <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{rows.length} {rows.length === 1 ? 'company' : 'companies'}</span>
        {note && <span style={{ fontSize: '0.68rem', color: '#94A3B8' }}>{note}</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <DataTable
          tableId={tableId}
          exportFileName={title}
          columns={columns}
          rows={rows}
          alwaysVisible={['company']}
          emptyMessage={empty}
          // A third of a page each: the columns scale to fit rather than
          // scrolling the move buttons off the side.
          fitWidth
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>
    </div>
  );
}

// The companies marked sold by someone else, as chips to undo.
function OtherList({ rows, onMark }) {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  return (
    <div style={{ flexShrink: 0, border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff', padding: '0.4rem 0.75rem' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}
      >{open ? '▾' : '▸'} Sold by someone else <span style={{ fontWeight: 500, color: '#64748B' }}>{rows.length} {rows.length === 1 ? 'company' : 'companies'}, left out of this page and the rate</span></button>
      {open && (
        <div data-retention-other style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {rows.map(r => (
            <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0.1rem 0.5rem', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 999, fontSize: '0.72rem', color: '#334155', fontWeight: 600 }}>
              {r.company}
              <button
                type="button"
                aria-label={`Put ${r.company} back`}
                title={`${r.company} is yours after all: put it back on the page`}
                onClick={() => onMark(r, '')}
                style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: '#94A3B8', fontSize: '0.8rem', lineHeight: 1, fontFamily: 'inherit' }}
              >×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ClientRetentionView({ oppsRecords, prospects = [], settings, updateSettings, updateProspect, onSelectProspect }) {
  const marks = settings?.[RETENTION_MARKS_KEY];
  const result = useMemo(() => clientRetention(oppsRecords || [], prospects, marks || {}), [oppsRecords, prospects, marks]);
  const selectById = useCallback((id) => {
    const p = prospects.find(x => x.id === id);
    if (p) onSelectProspect(p);
  }, [prospects, onSelectProspect]);
  const move = useCallback((row, status) => {
    Promise.resolve(updateProspect(row.prospectId, { status }))
      .catch(err => alert(`Could not update ${row.company}: ${err?.message || err}`));
  }, [updateProspect]);
  const mark = useCallback((row, value) => {
    updateSettings?.({ [RETENTION_MARKS_KEY]: withRetentionMark(marks, row.id, value) });
  }, [marks, updateSettings]);
  const openProspect = onSelectProspect ? selectById : null;
  const onMove = updateProspect ? move : null;
  const cols = useMemo(() => {
    const make = (side) => columnsFor({ side, onSelectProspect: openProspect, onMove, onMark: mark });
    return { retained: make('retained'), left: make('left'), expired: make('expired') };
  }, [openProspect, onMove, mark]);
  const loading = oppsRecords == null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '0.75rem 1.25rem', gap: '0.75rem', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
        <div data-retention-rate title="Companies still with us, divided by those plus the ones that left (status Old Client). Scope expired and sold by someone else are left out.">
          <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Retention Rate</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#0F172A', lineHeight: 1.1 }}>{loading ? '…' : retentionPercent(result.rate)}</div>
        </div>
        <div style={{ fontSize: '0.8rem', color: '#475569' }}>
          {loading
            ? 'Loading opps…'
            : `${result.retained.length} of ${result.total} ${result.total === 1 ? 'company' : 'companies'} still with us, ${result.left.length} left.`
              + (result.expired.length ? ` ${result.expired.length} scope expired, not counted.` : '')}
          <div style={{ fontSize: '0.7rem', color: '#94A3B8', marginTop: 2 }}>
            Every company with a Sold opp on the Opps tab. Status Old Client moves it to They left us. Expired and Other are marks kept here: neither counts in the rate.
          </div>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '0.75rem' }}>
        <Side
          title="Sold"
          accent="#F0FDF4"
          rows={result.retained}
          tableId="client-retention-sold"
          columns={cols.retained}
          settings={settings}
          updateSettings={updateSettings}
          empty={loading ? 'Loading…' : 'No Sold opps on the Opps tab yet'}
        />
        <Side
          title="They left us"
          accent="#FEF2F2"
          rows={result.left}
          tableId="client-retention-left"
          columns={cols.left}
          settings={settings}
          updateSettings={updateSettings}
          empty={loading ? 'Loading…' : 'Nobody has left: no sold company has status Old Client'}
        />
        <Side
          title="Scope expired"
          accent="#FFFBEB"
          rows={result.expired}
          tableId="client-retention-expired"
          columns={cols.expired}
          settings={settings}
          updateSettings={updateSettings}
          note="not in the rate"
          empty={loading ? 'Loading…' : 'None yet: click Expired on a company to move it here'}
        />
      </div>
      <OtherList rows={result.other} onMark={mark} />
    </div>
  );
}
