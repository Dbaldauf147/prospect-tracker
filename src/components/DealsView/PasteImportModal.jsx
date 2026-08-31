import { useState, useMemo } from 'react';
import { planDealPaste } from '../../utils/dealsPasteMerge';

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

export function PasteImportModal({ onClose, onImport, initialPaste = '', existingRows = [] }) {
  // A paste that arrived from Ctrl/Cmd+V on the page itself is already the
  // data — parse it up front and open straight on the mapping step, which is
  // the whole point of the popup. Clicking "Paste from Sheets" with an empty
  // clipboard still starts on the textarea.
  const [seed] = useState(() => {
    const text = String(initialPaste || '');
    if (!text.trim()) return null;
    const { headers: h, rows } = parseTSV(text);
    if (h.length === 0 || rows.length === 0) return null;
    const m = {};
    for (const src of h) m[src] = autoMap(src);
    return { headers: h, rows, mapping: m };
  });
  const [paste, setPaste] = useState(initialPaste);
  const [stage, setStage] = useState(seed ? 'map' : 'paste');
  const [headers, setHeaders] = useState(seed ? seed.headers : []);
  const [rawRows, setRawRows] = useState(seed ? seed.rows : []);
  const [mapping, setMapping] = useState(seed ? seed.mapping : {});
  const [parseError, setParseError] = useState('');
  // What to do with a cell where the deal on file and the paste disagree.
  // Default 'keep': the import fills blanks and otherwise leaves the roster
  // alone. 'overwrite' is there for the case the paste IS the correction.
  const [conflictMode, setConflictMode] = useState('keep');

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

  // The pasted grid turned into deal records under the current mapping.
  const records = useMemo(() => rawRows.map(cells => {
    const obj = {};
    for (let i = 0; i < headers.length; i++) {
      const dest = mapping[headers[i]];
      if (!dest) continue;
      const v = cells[i];
      if (v == null || v === '') continue;
      obj[dest] = v;
    }
    return obj;
  }), [rawRows, headers, mapping]);

  // Live preview of what the import does to the roster on file. The same
  // planner runs the actual import in DealsView, so the counts on the button
  // are the counts the user gets.
  const plan = useMemo(
    () => planDealPaste(existingRows, records, { overwriteConflicts: conflictMode === 'overwrite' }),
    [existingRows, records, conflictMode]
  );
  const { summary, results } = plan;
  const mergedRows = useMemo(() => results.filter(r => r.status === 'merged'), [results]);
  const conflictRows = useMemo(() => mergedRows.filter(r => r.conflicts.length > 0), [mergedRows]);
  const skippedByReason = useMemo(() => {
    const byReason = new Map();
    for (const r of results) {
      if (r.status !== 'skipped') continue;
      if (!byReason.has(r.reason)) byReason.set(r.reason, []);
      byReason.get(r.reason).push(r.rowNumber);
    }
    return [...byReason.entries()];
  }, [results]);
  const clientMapped = useMemo(
    () => headers.some(h => mapping[h] === 'Client Name'),
    [headers, mapping]
  );

  function handleImport() {
    if (summary.added === 0 && summary.merged === 0) {
      setParseError(clientMapped
        ? 'Nothing to import: every pasted row was blank or had no Client Name.'
        : 'Map one pasted column to Client Name — that’s what each row is matched on.');
      return;
    }
    onImport(records, { overwriteConflicts: conflictMode === 'overwrite' });
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

  const nothingToImport = summary.added === 0 && summary.merged === 0;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, width: 'min(1040px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(15, 23, 42, 0.3)' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <strong style={{ fontSize: '0.9rem', color: '#1E293B' }}>
            {stage === 'paste' ? 'Paste deals from Google Sheets' : `Map columns: ${rawRows.length} pasted rows`}
          </strong>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', color: '#64748B', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {stage === 'paste' && (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
            <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.4 }}>
              In Google Sheets, select the rows you want (including the header row) and copy with <strong>Cmd+C</strong> / <strong>Ctrl+C</strong>. Then click in the box below and paste — or just paste anywhere on the Deals page and this opens on the mapping step. Deals already on file are matched by <strong>Client Name</strong> (plus <strong>Agreement Name</strong> where there is one): new values fill in, and values already on the deal are left alone.
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

            {/* What the import does to the roster on file, recomputed as the
                mapping changes. Nothing here replaces a deal: rows that
                aren't on file are added, rows that are only gain values in
                cells that were blank. */}
            <div style={{ padding: '0.5rem 0.7rem', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 6, fontSize: '0.72rem', color: '#166534', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {!clientMapped ? (
                <div style={{ color: '#991B1B', fontWeight: 700 }}>
                  No pasted column maps to <strong>Client Name</strong> — that’s what each row is matched on, so nothing can be imported until one does.
                </div>
              ) : (
                <>
                  <div>
                    <strong>{summary.added}</strong> new deal{summary.added === 1 ? '' : 's'} added
                    {' · '}<strong>{summary.merged}</strong> already on file{summary.merged > 0 && <> — <strong>{summary.filledCells}</strong> blank cell{summary.filledCells === 1 ? '' : 's'} filled in, <strong>{summary.duplicateCells}</strong> duplicate value{summary.duplicateCells === 1 ? '' : 's'} ignored</>}
                    {summary.skipped > 0 && <> · <span style={{ color: '#92400E' }}><strong>{summary.skipped}</strong> row{summary.skipped === 1 ? '' : 's'} skipped</span></>}
                  </div>
                  <div style={{ color: '#3F6212' }}>
                    Deals this paste doesn’t mention are left exactly as they are — nothing is replaced.
                  </div>
                  {mergedRows.length > 0 && (
                    <div style={{ color: '#3F6212' }}>
                      Matched: {mergedRows.slice(0, 8).map(r => `${r.client}${r.agreement ? ` · ${r.agreement}` : ''}`).join(', ')}
                      {mergedRows.length > 8 && <> +{mergedRows.length - 8} more</>}
                    </div>
                  )}
                  {skippedByReason.map(([reason, nums]) => (
                    <div key={reason} style={{ color: '#92400E' }}>
                      {reason}: row{nums.length === 1 ? '' : 's'} {nums.slice(0, 12).join(', ')}{nums.length > 12 ? `, +${nums.length - 12} more` : ''}
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Cells where the deal on file and the paste disagree. These
                aren't duplicates, so they get their own decision rather than
                being quietly dropped. */}
            {summary.conflictCells > 0 && (
              <div style={{ padding: '0.5rem 0.7rem', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 6, fontSize: '0.72rem', color: '#92400E', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>
                  <strong>{summary.conflictCells}</strong> cell{summary.conflictCells === 1 ? '' : 's'} on {conflictRows.length} deal{conflictRows.length === 1 ? '' : 's'} already {summary.conflictCells === 1 ? 'carries' : 'carry'} a <em>different</em> value:
                </div>
                <div style={{ maxHeight: 90, overflowY: 'auto', color: '#78350F' }}>
                  {conflictRows.slice(0, 8).map(r => (
                    <div key={r.rowNumber} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <strong>{r.client}</strong>{r.agreement ? ` · ${r.agreement}` : ''}: {r.conflicts.slice(0, 4).map(c => `${c.field} "${c.existing}" → "${c.pasted}"`).join(', ')}{r.conflicts.length > 4 ? `, +${r.conflicts.length - 4} more` : ''}
                    </div>
                  ))}
                  {conflictRows.length > 8 && <div>+{conflictRows.length - 8} more deals</div>}
                </div>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', paddingTop: 2 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'flex-start', gap: '0.3rem', cursor: 'pointer' }} title="Fill blank cells only. A cell that already has a value keeps it, whether the paste repeats it or contradicts it.">
                    <input type="radio" name="deals-conflict-mode" checked={conflictMode === 'keep'} onChange={() => setConflictMode('keep')} style={{ marginTop: 2, cursor: 'pointer' }} />
                    <span><strong>Keep what’s on the deal</strong> (default): fill blanks only</span>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'flex-start', gap: '0.3rem', cursor: 'pointer' }} title="Let the pasted value overwrite the value already on the deal. Use this when the sheet is the correction.">
                    <input type="radio" name="deals-conflict-mode" checked={conflictMode === 'overwrite'} onChange={() => setConflictMode('overwrite')} style={{ marginTop: 2, cursor: 'pointer' }} />
                    <span><strong>Take the pasted value</strong> for {summary.conflictCells === 1 ? 'that cell' : `those ${summary.conflictCells} cells`}</span>
                  </label>
                </div>
              </div>
            )}

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
                <button
                  onClick={handleImport}
                  disabled={nothingToImport}
                  title="New deals are added and deals already on file fill in their blank cells only. Values already on a deal — and every deal this paste doesn't mention — are left alone."
                  style={{ padding: '0.4rem 0.9rem', border: 'none', borderRadius: 6, background: nothingToImport ? '#94A3B8' : '#16A34A', color: '#fff', fontSize: '0.78rem', cursor: nothingToImport ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
                >Add {summary.added} · fill {summary.merged} →</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
