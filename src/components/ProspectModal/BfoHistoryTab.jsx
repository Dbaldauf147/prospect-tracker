// Company popup > BFO History: the account's opportunities as BFO holds
// them, transcribed from the Oppty 360 tab by the Agents tab's BFO History
// task (or by hand) and pasted here. A paste replaces the list; see
// utils/bfoHistory for the format and the storage shape.
//
// Rows can be ignored, one at a time from the button at the front of the
// row or in bulk from the checkboxes. Ignored rows drop off the table (a
// "Show ignored" toggle brings them back, greyed, to restore) and stay
// ignored across a new paste; see setBfoHistoryIgnored.
//
// Rows can also be marked OK (checked, nothing to do): they stay on screen
// with a green tick and an OK column to filter on, and the mark also
// survives a new paste; see setBfoHistoryOk.
//
// "No BFO history" records that the company was checked and BFO holds no
// opportunities for it, so the Agents task skips it like a fresh paste; see
// markBfoHistoryNone.
import { useCallback, useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { BFO_HISTORY_COLUMNS, BFO_HISTORY_HEADER, parseBfoHistory, bfoHistoryRowKey, setBfoHistoryIgnored, setBfoHistoryOk, bfoHistoryMarks, bfoHistoryIsNone, markBfoHistoryNone } from '../../utils/bfoHistory';

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
const smallBtn = { padding: '0.3rem 0.75rem', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' };
const rowBtn = { background: 'none', border: '1px solid transparent', borderRadius: 4, padding: '0 4px', lineHeight: 1.2, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' };
// BFO Account sits after Status on screen; it is last in the paste format
// only so older headerless pastes still line up.
const byKey = (k) => BFO_HISTORY_COLUMNS.find(c => c.key === k);
const DISPLAY_COLUMNS = [byKey('status'), byKey('account'), ...BFO_HISTORY_COLUMNS.filter(c => c.key !== 'status' && c.key !== 'account')];
const WIDTHS = { account: 180, status: 90, name: 300, leader: 160, stage: 190, amount: 130, closeDate: 120, lastModified: 140, reporting: 110, probability: 110 };

export function BfoHistoryTab({ history, bfoCompanyName = '', onChange, settings, updateSettings }) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [showIgnored, setShowIgnored] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [filteredIds, setFilteredIds] = useState(null);
  const ignoredSet = useMemo(() => new Set(history?.ignored || []), [history]);
  const okSet = useMemo(() => new Set(history?.ok || []), [history]);
  const allRows = useMemo(() => (history?.rows || []).map((r, i) => {
    const key = bfoHistoryRowKey(r);
    return { id: String(i), ...r, _key: key, _ignored: ignoredSet.has(key), _ok: okSet.has(key) };
  }), [history, ignoredSet, okSet]);
  const ignoredCount = allRows.filter(r => r._ignored).length;
  const okCount = allRows.filter(r => r._ok && !r._ignored).length;
  const rows = useMemo(() => (showIgnored ? allRows : allRows.filter(r => !r._ignored)), [allRows, showIgnored]);
  const pastedLabel = history?.pastedAt
    ? new Date(history.pastedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : '';
  const openCount = allRows.filter(r => r.status === 'Open' && !r._ignored).length;
  const closedCount = allRows.filter(r => r.status === 'Closed' && !r._ignored).length;
  const isNone = bfoHistoryIsNone(history);
  const markNone = () => {
    if (allRows.length && !window.confirm('Replace the pasted opportunities with "No BFO history"?')) return;
    onChange(markBfoHistoryNone(history));
    setPasteOpen(false);
    setText('');
    setError('');
    setFlash('Marked as no BFO history.');
    window.setTimeout(() => setFlash(''), 4000);
  };

  // Selection only ever holds rows on screen: a row that gets hidden, or
  // filtered out, drops out of it so a bulk action can't reach it unseen.
  const onScreenIds = useMemo(() => new Set(filteredIds ?? rows.map(r => r.id)), [filteredIds, rows]);
  const selectedRows = rows.filter(r => selected.has(r.id) && onScreenIds.has(r.id));
  const onFilteredRowsChange = useCallback((list) => setFilteredIds(list.map(r => r.id)), []);

  const setIgnored = useCallback((targets, ignore) => {
    onChange(setBfoHistoryIgnored(history, targets.map(r => r._key), ignore));
    setSelected(new Set());
  }, [history, onChange]);
  const setOk = useCallback((targets, ok) => {
    onChange(setBfoHistoryOk(history, targets.map(r => r._key), ok));
    setSelected(new Set());
  }, [history, onChange]);
  const toggleSelected = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const onScreen = rows.filter(r => onScreenIds.has(r.id));
  const allOnScreenSelected = onScreen.length > 0 && onScreen.every(r => selected.has(r.id));
  const toggleAll = () => setSelected(allOnScreenSelected ? new Set() : new Set(onScreen.map(r => r.id)));

  const selectCol = {
    key: '__select__',
    label: '',
    defaultWidth: 100,
    renderHeader: () => (
      <input
        type="checkbox"
        aria-label="Select every row on screen"
        title="Select every row on screen"
        checked={allOnScreenSelected}
        onChange={toggleAll}
        onClick={(e) => e.stopPropagation()}
        style={{ cursor: 'pointer' }}
      />
    ),
    render: r => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <input
          type="checkbox"
          aria-label={`Select ${r.name}`}
          checked={selected.has(r.id)}
          onChange={() => toggleSelected(r.id)}
          onClick={(e) => e.stopPropagation()}
          style={{ cursor: 'pointer' }}
        />
        {!r._ignored && (
          <button type="button"
            style={{ ...rowBtn, color: r._ok ? '#15803D' : '#94A3B8', fontWeight: r._ok ? 700 : 400 }}
            title={r._ok ? 'Marked OK. Click to unmark' : 'Mark this row OK'}
            aria-label={`${r._ok ? 'Unmark' : 'Mark'} ${r.name} OK`}
            aria-pressed={r._ok}
            onClick={(e) => { e.stopPropagation(); setOk([r], !r._ok); }}>&#10003;</button>
        )}
        {r._ignored ? (
          <button type="button" style={{ ...rowBtn, color: '#2563EB' }} title="Restore this row" aria-label={`Restore ${r.name}`}
            onClick={(e) => { e.stopPropagation(); setIgnored([r], false); }}>&#8634;</button>
        ) : (
          <button type="button" style={{ ...rowBtn, color: '#94A3B8' }} title="Ignore this row (hides it)" aria-label={`Ignore ${r.name}`}
            onClick={(e) => { e.stopPropagation(); setIgnored([r], true); }}>&#10005;</button>
        )}
      </span>
    ),
    getSortValue: r => (r._ignored ? 1 : 0),
    exportValue: () => '',
  };

  const dataColumns = useMemo(() => DISPLAY_COLUMNS.map(c => ({
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
  const okCol = {
    key: '__ok__',
    label: 'OK',
    defaultWidth: 70,
    getSortValue: r => (r._ok ? 1 : 0),
    getFilterValue: r => (r._ok ? 'OK' : 'Not marked'),
    exportValue: r => (r._ok ? 'OK' : ''),
    render: r => (r._ok
      ? <span style={{ padding: '0.05rem 0.45rem', borderRadius: 999, background: '#DCFCE7', color: '#15803D', fontSize: '0.72rem', fontWeight: 600 }}>OK</span>
      : blank),
  };
  const columns = [selectCol, okCol, ...dataColumns];

  const save = () => {
    const { rows: parsed, error: err } = parseBfoHistory(text);
    if (err) { setError(err); return; }
    const open = parsed.filter(r => r.status === 'Open').length;
    const closed = parsed.filter(r => r.status === 'Closed').length;
    // A new paste replaces the rows but keeps what was ignored or marked OK.
    onChange({ rows: parsed, pastedAt: new Date().toISOString(), ...bfoHistoryMarks(history) });
    setText('');
    setError('');
    setPasteOpen(false);
    setFlash(`Saved ${parsed.length} opportunit${parsed.length === 1 ? 'y' : 'ies'} (${open} open, ${closed} closed).`);
    window.setTimeout(() => setFlash(''), 4000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.5rem' }}>
      <div style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>
        The opportunities BFO holds for {bfoCompanyName ? <strong>{bfoCompanyName}</strong> : 'this account'}, from {bfoCompanyName.includes(',') ? 'each account\'s' : 'its'} Oppty 360 tab
        (Opportunities of this Account: All of the above, both the Open and the Closed subtabs). The Agents tab&apos;s BFO History task fills this in; a new paste replaces the list.
      </div>
      {pastedLabel && isNone && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
          <span
            title={new Date(history.pastedAt).toString()}
            style={{ padding: '0.2rem 0.6rem', borderRadius: 999, background: '#F1F5F9', border: '1px solid #CBD5E1', color: '#334155', fontWeight: 600 }}
          >No BFO history, marked: {pastedLabel}</span>
          <span style={{ color: '#475569' }}>Checked in BFO and it holds no opportunities for this company.</span>
        </div>
      )}
      {pastedLabel && !isNone && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
          <span
            title={new Date(history.pastedAt).toString()}
            style={{ padding: '0.2rem 0.6rem', borderRadius: 999, background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#065F46', fontWeight: 600 }}
          >Pasted into the tracker: {pastedLabel}</span>
          <span style={{ color: '#475569' }}>
            {allRows.length} opportunit{allRows.length === 1 ? 'y' : 'ies'}: {openCount} open, {closedCount} closed{okCount ? `, ${okCount} OK` : ''}{ignoredCount ? `, ${ignoredCount} ignored` : ''}
          </span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => { setPasteOpen(o => !o); setError(''); }}
          style={{ padding: '0.3rem 0.75rem', borderRadius: 6, border: '1px solid #2563EB', background: pasteOpen ? '#EFF6FF' : '#2563EB', color: pasteOpen ? '#2563EB' : '#fff', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
        >{pasteOpen ? 'Cancel paste' : 'Paste BFO history'}</button>
        {!isNone && (
          <button
            type="button"
            onClick={markNone}
            title="BFO holds no opportunities for this company (or it has no account there). Takes it off the Agents tab's BFO History prompt for the next 30 days, like a paste."
            style={smallBtn}
          >No BFO history</button>
        )}
        {(allRows.length > 0 || isNone) && (
          <button
            type="button"
            onClick={() => { if (window.confirm('Clear the BFO History for this company?')) onChange(null); }}
            style={smallBtn}
          >Clear</button>
        )}
        {selectedRows.some(r => !r._ignored && !r._ok) && (
          <button type="button" style={{ ...smallBtn, borderColor: '#86EFAC', color: '#15803D', fontWeight: 600 }}
            onClick={() => setOk(selectedRows.filter(r => !r._ignored && !r._ok), true)}
          >Mark OK ({selectedRows.filter(r => !r._ignored && !r._ok).length})</button>
        )}
        {selectedRows.some(r => !r._ignored && r._ok) && (
          <button type="button" style={smallBtn}
            onClick={() => setOk(selectedRows.filter(r => !r._ignored && r._ok), false)}
          >Unmark OK ({selectedRows.filter(r => !r._ignored && r._ok).length})</button>
        )}
        {selectedRows.some(r => !r._ignored) && (
          <button type="button" style={{ ...smallBtn, borderColor: '#FCA5A5', color: '#B91C1C', fontWeight: 600 }}
            onClick={() => setIgnored(selectedRows.filter(r => !r._ignored), true)}
          >Ignore selected ({selectedRows.filter(r => !r._ignored).length})</button>
        )}
        {selectedRows.some(r => r._ignored) && (
          <button type="button" style={{ ...smallBtn, borderColor: '#93C5FD', color: '#2563EB', fontWeight: 600 }}
            onClick={() => setIgnored(selectedRows.filter(r => r._ignored), false)}
          >Restore selected ({selectedRows.filter(r => r._ignored).length})</button>
        )}
        {ignoredCount > 0 && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: '#475569', cursor: 'pointer' }}>
            <input type="checkbox" checked={showIgnored} onChange={(e) => { setShowIgnored(e.target.checked); setSelected(new Set()); }} />
            Show ignored ({ignoredCount})
          </label>
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
      {allRows.length > 0 ? (
        <div style={{ height: '55vh', display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          <DataTable
            tableId="prospect-bfo-history"
            exportFileName="BFO History"
            columns={columns}
            rows={rows}
            alwaysVisible={['__select__', 'name']}
            rowStyle={r => (r._ignored ? { opacity: 0.5 } : r._ok ? { background: '#F0FDF4' } : undefined)}
            onFilteredRowsChange={onFilteredRowsChange}
            emptyMessage={ignoredCount ? `Every row is ignored. Tick "Show ignored" to see them.` : 'No data found'}
            settings={settings}
            updateSettings={updateSettings}
          />
        </div>
      ) : !pasteOpen && !isNone && (
        <div style={{ fontSize: '0.8rem', color: '#94A3B8', padding: '1rem 0' }}>No BFO history pasted yet.</div>
      )}
    </div>
  );
}
