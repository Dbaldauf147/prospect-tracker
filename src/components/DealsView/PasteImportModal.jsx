import { useState, useMemo } from 'react';

// Canonical destination columns recognised by the Deals subtab. Kept
// in sync with COLUMN_ORDER + HEADER_ALIASES in DealsView so the
// dropdown always offers the exact field name the rest of the app
// will read.
const CANONICAL = [
  'Client Name',
  'Commission Sheet Sent to Kathy',
  'Paperwork completed',
  'Billing information collected',
  'Closed Won',
  'On Client Tracker?',
  'BFO - Close after contract execution email has been sent',
  'Agreement Name',
  'Current Term Start Date',
  'Original Contract Start',
  'Setup',
  'Recurring Revenue',
  'Commission',
  'Revenue Recorded',
  'Paid to Date',
  'Delta',
  'Currently being paid',
  'Ticket',
  'Comm Status',
  'Due Date',
  'Days/Paid on',
  'GM',
  'Payment Terms',
  'End Date',
  'Auto renewal?',
  'Esc',
  'Current Value',
  'SUCON?',
  'Comm Tracker?',
  'Comm Tracker?2',
  'Comm Tracker?3',
  'Comm Tracker?4',
  'Comm Tracker?5',
  'Comm Tracker?6',
  'Combined',
  'Combine Project Name',
  'Commission Rate',
  'Year',
  'Month',
  'Follow Up On Sale',
];

const ALIASES = {
  'paperwork': 'Paperwork completed',
  'billing letter': 'Billing information collected',
  'combined bfo': 'Combined',
};

function autoMap(srcHeader) {
  const cleaned = String(srcHeader || '').trim().replace(/\.+$/, '');
  if (!cleaned) return '';
  const lower = cleaned.toLowerCase();
  const exact = CANONICAL.find(c => c.toLowerCase() === lower);
  if (exact) return exact;
  return ALIASES[lower] || '';
}

// Robust tab-separated parser for the Google-Sheets clipboard format:
// cells with newlines/tabs/quotes arrive wrapped in double quotes,
// with internal quotes doubled. A naive line.split('\n') would tear
// quoted multi-line cells in half.
function parseTSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let cellStarted = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; continue; }
        inQuotes = false;
        continue;
      }
      cell += ch;
      continue;
    }
    if (ch === '"' && !cellStarted) { inQuotes = true; cellStarted = true; continue; }
    if (ch === '\t') { row.push(cell); cell = ''; cellStarted = false; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; cellStarted = false; continue; }
    cell += ch;
    cellStarted = true;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  while (rows.length > 0 && rows[rows.length - 1].every(c => c === '')) rows.pop();
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map(h => String(h || '').trim());
  return { headers, rows: rows.slice(1) };
}

export function PasteImportModal({ onClose, onImport }) {
  const [paste, setPaste] = useState('');
  const [stage, setStage] = useState('paste');
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [parseError, setParseError] = useState('');

  function handleNext() {
    setParseError('');
    const { headers: h, rows } = parseTSV(paste);
    if (h.length === 0 || rows.length === 0) {
      setParseError('Nothing to import: paste tab-separated data copied from Google Sheets.');
      return;
    }
    const m = {};
    for (const src of h) m[src] = autoMap(src);
    setHeaders(h);
    setRawRows(rows);
    setMapping(m);
    setStage('map');
  }

  function handleImport() {
    const records = rawRows
      .map(cells => {
        const obj = {};
        for (let i = 0; i < headers.length; i++) {
          const dest = mapping[headers[i]];
          if (!dest) continue;
          const v = cells[i];
          if (v == null || v === '') continue;
          obj[dest] = v;
        }
        return obj;
      })
      .filter(r => Object.keys(r).length > 0);
    if (records.length === 0) {
      setParseError('No mapped columns: pick at least one destination column.');
      return;
    }
    onImport(records);
  }

  const mappedCount = useMemo(
    () => headers.filter(h => mapping[h]).length,
    [headers, mapping]
  );
  const preview = useMemo(() => rawRows.slice(0, 3), [rawRows]);
  const unmappedSourceNames = useMemo(
    () => headers.filter(h => !mapping[h]),
    [headers, mapping]
  );
  const duplicateDestinations = useMemo(() => {
    const seen = new Map();
    for (const src of headers) {
      const dest = mapping[src];
      if (!dest) continue;
      seen.set(dest, (seen.get(dest) || 0) + 1);
    }
    return [...seen.entries()].filter(([, n]) => n > 1).map(([d]) => d);
  }, [headers, mapping]);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, width: 'min(960px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(15, 23, 42, 0.3)' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <strong style={{ fontSize: '0.9rem', color: '#1E293B' }}>
            {stage === 'paste' ? 'Paste deals from Google Sheets' : `Map columns: ${rawRows.length} rows`}
          </strong>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', color: '#64748B', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {stage === 'paste' && (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
            <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.4 }}>
              In Google Sheets, select the rows you want (including the header row) and copy with <strong>Cmd+C</strong> / <strong>Ctrl+C</strong>. Then click in the box below and paste. The next step lets you confirm which pasted column maps to each deal field.
            </div>
            <textarea
              value={paste}
              onChange={e => setPaste(e.target.value)}
              placeholder="Paste your tab-separated data here…"
              style={{ width: '100%', minHeight: 320, padding: '0.5rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.72rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical', boxSizing: 'border-box' }}
            />
            {parseError && (
              <div style={{ padding: '0.4rem 0.6rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#991B1B', fontSize: '0.72rem' }}>{parseError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button onClick={onClose} style={{ padding: '0.4rem 0.8rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={handleNext} disabled={!paste.trim()} style={{ padding: '0.4rem 0.9rem', border: 'none', borderRadius: 6, background: paste.trim() ? '#3B82F6' : '#94A3B8', color: '#fff', fontSize: '0.78rem', cursor: paste.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontWeight: 600 }}>Next: Map columns →</button>
            </div>
          </div>
        )}

        {stage === 'map' && (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1, minHeight: 0 }}>
            <div style={{ fontSize: '0.72rem', color: '#475569' }}>
              {rawRows.length} rows · <strong>{mappedCount}/{headers.length}</strong> columns mapped
              {unmappedSourceNames.length > 0 && <> · <span style={{ color: '#92400E' }}>{unmappedSourceNames.length} pasted column{unmappedSourceNames.length === 1 ? '' : 's'} will be skipped</span></>}
              {duplicateDestinations.length > 0 && <> · <span style={{ color: '#991B1B' }}>Multiple sources point at: {duplicateDestinations.join(', ')}</span></>}
            </div>
            <div style={{ overflow: 'auto', border: '1px solid #E2E8F0', borderRadius: 6, flex: 1, minHeight: 0 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.72rem' }}>
                <thead style={{ background: '#F1F5F9', position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #CBD5E1' }}>Source header</th>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #CBD5E1' }}>→ Destination</th>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #CBD5E1' }}>Preview (first 3 rows)</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((src, i) => {
                    const dest = mapping[src];
                    return (
                      <tr key={i} style={{ background: dest ? '#FFFFFF' : '#FFFBEB' }}>
                        <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #E2E8F0', fontWeight: 600, color: '#1E293B', whiteSpace: 'nowrap' }}>
                          {src || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>(blank)</span>}
                        </td>
                        <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #E2E8F0' }}>
                          <select
                            value={dest || ''}
                            onChange={e => setMapping(m => ({ ...m, [src]: e.target.value }))}
                            style={{ padding: '0.25rem 0.4rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', minWidth: 240, background: '#fff' }}
                          >
                            <option value="">(Skip)</option>
                            {CANONICAL.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #E2E8F0', color: '#64748B', maxWidth: 360 }}>
                          {preview.map((cells, pi) => (
                            <div key={pi} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={cells[i] ?? ''}>
                              {cells[i] || <span style={{ color: '#CBD5E1' }}>-</span>}
                            </div>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {parseError && (
              <div style={{ padding: '0.4rem 0.6rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#991B1B', fontSize: '0.72rem' }}>{parseError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              <button onClick={() => setStage('paste')} style={{ padding: '0.4rem 0.8rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>← Back</button>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={onClose} style={{ padding: '0.4rem 0.8rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={handleImport} disabled={mappedCount === 0} style={{ padding: '0.4rem 0.9rem', border: 'none', borderRadius: 6, background: mappedCount === 0 ? '#94A3B8' : '#16A34A', color: '#fff', fontSize: '0.78rem', cursor: mappedCount === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Replace deals with {rawRows.length} rows →</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
