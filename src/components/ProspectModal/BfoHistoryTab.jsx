// Company popup > BFO History: the account's opportunities as BFO holds
// them, transcribed from the Oppty 360 tab by the Agents tab's BFO History
// task (or by hand) and pasted here. A paste replaces the list; see
// utils/bfoHistory for the format and the storage shape.
import { useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { BFO_HISTORY_COLUMNS, BFO_HISTORY_HEADER, parseBfoHistory } from '../../utils/bfoHistory';

const blank = <span style={{ color: '#CBD5E1' }}>-</span>;
const RIGHT = new Set(['amount', 'probability']);
const amountValue = (s) => {
  const n = Number(String(s || '').replace(/[^0-9.-]/g, ''));
  return String(s || '').trim() && Number.isFinite(n) ? n : null;
};
const dateValue = (s) => {
  const t = Date.parse(s || '');
  return Number.isFinite(t) ? t : null;
};
const WIDTHS = { status: 90, name: 300, leader: 160, stage: 190, amount: 130, closeDate: 120, lastModified: 140, reporting: 110, probability: 110 };

export function BfoHistoryTab({ history, bfoCompanyName = '', onChange, settings, updateSettings }) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const rows = useMemo(() => (history?.rows || []).map((r, i) => ({ id: String(i), ...r })), [history]);
  const pastedLabel = history?.pastedAt
    ? new Date(history.pastedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : '';
  const openCount = rows.filter(r => r.status === 'Open').length;
  const closedCount = rows.filter(r => r.status === 'Closed').length;

  const columns = useMemo(() => BFO_HISTORY_COLUMNS.map(c => ({
    key: c.key,
    label: c.label,
    defaultWidth: WIDTHS[c.key] || 140,
    getSortValue: r => {
      if (c.key === 'amount') return amountValue(r.amount);
      if (c.key === 'probability') return amountValue(r.probability);
      if (c.key === 'closeDate' || c.key === 'lastModified') return dateValue(r[c.key]);
      return String(r[c.key] || '').toLowerCase() || null;
    },
    getFilterValue: r => r[c.key] || '',
    exportValue: r => r[c.key] || '',
    render: r => (r[c.key]
      ? <span style={RIGHT.has(c.key) ? { display: 'block', textAlign: 'right' } : undefined}>{r[c.key]}</span>
      : blank),
  })), []);

  const save = () => {
    const { rows: parsed, error: err } = parseBfoHistory(text);
    if (err) { setError(err); return; }
    const open = parsed.filter(r => r.status === 'Open').length;
    const closed = parsed.filter(r => r.status === 'Closed').length;
    onChange({ rows: parsed, pastedAt: new Date().toISOString() });
    setText('');
    setError('');
    setPasteOpen(false);
    setFlash(`Saved ${parsed.length} opportunit${parsed.length === 1 ? 'y' : 'ies'} (${open} open, ${closed} closed).`);
    window.setTimeout(() => setFlash(''), 4000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.5rem' }}>
      <div style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>
        The opportunities BFO holds for {bfoCompanyName ? <strong>{bfoCompanyName}</strong> : 'this account'}, from its Oppty 360 tab
        (Opportunities of this Account: All of the above, both the Open and the Closed subtabs). The Agents tab&apos;s BFO History task fills this in; a new paste replaces the list.
      </div>
      {pastedLabel && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
          <span
            title={new Date(history.pastedAt).toString()}
            style={{ padding: '0.2rem 0.6rem', borderRadius: 999, background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#065F46', fontWeight: 600 }}
          >Pasted into the tracker: {pastedLabel}</span>
          <span style={{ color: '#475569' }}>
            {rows.length} opportunit{rows.length === 1 ? 'y' : 'ies'}: {openCount} open, {closedCount} closed
          </span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => { setPasteOpen(o => !o); setError(''); }}
          style={{ padding: '0.3rem 0.75rem', borderRadius: 6, border: '1px solid #2563EB', background: pasteOpen ? '#EFF6FF' : '#2563EB', color: pasteOpen ? '#2563EB' : '#fff', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
        >{pasteOpen ? 'Cancel paste' : 'Paste BFO history'}</button>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={() => { if (window.confirm('Clear the BFO History for this company?')) onChange(null); }}
            style={{ padding: '0.3rem 0.75rem', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >Clear</button>
        )}
        {flash && <span style={{ fontSize: '0.78rem', color: '#15803D', fontWeight: 600 }}>{flash}</span>}
      </div>
      {pasteOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <textarea
            aria-label="Paste BFO history"
            placeholder={`Paste the tab-separated table here, header first:\n${BFO_HISTORY_HEADER}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            spellCheck={false}
            style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', padding: '0.5rem', border: '1px solid #CBD5E1', borderRadius: 6, boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={save}
              disabled={!text.trim()}
              style={{ padding: '0.3rem 0.75rem', borderRadius: 6, border: 'none', background: text.trim() ? '#15803D' : '#94A3B8', color: '#fff', fontSize: '0.78rem', fontWeight: 600, cursor: text.trim() ? 'pointer' : 'default', fontFamily: 'inherit' }}
            >Save BFO history</button>
            {error && <span style={{ fontSize: '0.78rem', color: '#B91C1C' }}>{error}</span>}
          </div>
        </div>
      )}
      {rows.length > 0 ? (
        <div style={{ height: '55vh', display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          <DataTable
            tableId="prospect-bfo-history"
            exportFileName="BFO History"
            columns={columns}
            rows={rows}
            alwaysVisible={['name']}
            settings={settings}
            updateSettings={updateSettings}
          />
        </div>
      ) : !pasteOpen && (
        <div style={{ fontSize: '0.8rem', color: '#94A3B8', padding: '1rem 0' }}>No BFO history pasted yet.</div>
      )}
    </div>
  );
}
