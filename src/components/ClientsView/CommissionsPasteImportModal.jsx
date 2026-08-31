import { useState, useMemo } from 'react';
import { COMMISSION_MONTH_NAMES } from '../../utils/commissionsStore';
import { planCommissionsPaste } from '../../utils/commissionsPasteMerge';

// Canonical destination columns. Order mirrors the table layout the
// user pastes in: identity columns, then monthly revenue, the FY
// total, and finally the monthly commission amounts. Columns are
// year-agnostic — a pasted "1/1/2026 Revenue" cell lands in the
// "January Revenue" column regardless of year.
function buildCanonical() {
  const cols = ['Name', 'Account Name', 'BFO Name', 'Project Name', 'Comm Start Date', 'Comm End Date', '%'];
  for (const m of COMMISSION_MONTH_NAMES) cols.push(`${m} Revenue`);
  cols.push('FY Revenue');
  for (const m of COMMISSION_MONTH_NAMES) cols.push(m);
  return cols;
}

export const COMMISSIONS_CANONICAL = buildCanonical();

// Cheap normalizer for header-vs-header comparisons. Lowercases,
// drops whitespace, "." and "$".
function normHeader(s) {
  return String(s || '').toLowerCase().replace(/[\s.$]/g, '');
}

const NORM_CANONICAL = COMMISSIONS_CANONICAL.map(c => ({ c, n: normHeader(c) }));

// Map a pasted source header onto a canonical destination. Direct
// month-name matches go through the normalized lookup; legacy
// "<m>/1/<year>" date headers (the way Excel sometimes labels monthly
// columns) are translated to the matching month name so the user can
// paste this year's data into year-agnostic columns without
// re-mapping each month by hand.
function autoMap(srcHeader) {
  const cleaned = String(srcHeader || '').trim().replace(/\.+$/, '');
  if (!cleaned) return '';

  // FY{year} Revenue → FY Revenue (year stripped, value rolls into the
  // single year-agnostic FY column).
  if (/^FY\d{4}\s+Revenue$/i.test(cleaned)) return 'FY Revenue';

  // <m>/1/<year> Revenue → "<Month> Revenue"
  const monthRev = /^(\d{1,2})\/1\/\d{4}\s+Revenue$/i.exec(cleaned);
  if (monthRev) {
    const mi = Number(monthRev[1]);
    if (mi >= 1 && mi <= 12) return `${COMMISSION_MONTH_NAMES[mi - 1]} Revenue`;
  }

  // <m>/1/<year> → "<Month>" (commission column)
  const month = /^(\d{1,2})\/1\/\d{4}$/.exec(cleaned);
  if (month) {
    const mi = Number(month[1]);
    if (mi >= 1 && mi <= 12) return COMMISSION_MONTH_NAMES[mi - 1];
  }

  const n = normHeader(cleaned);
  const hit = NORM_CANONICAL.find(x => x.n === n);
  return hit ? hit.c : '';
}

// Tab-separated parser. Mirrors PasteImportModal so cells with
// newlines / tabs / quotes (the Google-Sheets clipboard format) come
// through intact instead of getting torn at the first newline.
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

export function CommissionsPasteImportModal({ onClose, onImport, initialPaste = '', existingRows = [] }) {
  // A paste that arrived from Ctrl/Cmd+V on the page itself is already the
  // data — parse it up front and open straight on the mapping step, which is
  // the whole point of the popup. Clicking "Paste from Excel" with an empty
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
  // How to reconcile a cell that a pasted project and the row already on file
  // BOTH have a value for:
  //  - 'fill' (default): the row on file keeps it. Pasted values land only in
  //    blank cells, so a re-paste fills the gaps and changes nothing else.
  //  - 'update': the pasted value wins, so a corrected figure updates in place.
  //  - 'replace': clear the existing row's months first, so only this paste's
  //    months survive (a clean per-project reset that still keeps the row's
  //    Account Name / BFO Name / Scope).
  const [dupeMode, setDupeMode] = useState('fill');

  function handleNext() {
    setParseError('');
    const { headers: h, rows } = parseTSV(paste);
    if (h.length === 0 || rows.length === 0) {
      setParseError('Nothing to import: paste tab-separated data copied from Excel or Google Sheets.');
      return;
    }
    const m = {};
    for (const src of h) m[src] = autoMap(src);
    setHeaders(h);
    setRawRows(rows);
    setMapping(m);
    setStage('map');
  }

  // The pasted grid turned into commission records under the current mapping.
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

  // Live import preview — the same planner that runs the actual import, so
  // the counts on the button are the counts the user gets. It re-runs
  // whenever the mapping, the pasted data, the on-file roster or the dupe
  // mode changes, and classifies each pasted row:
  //   - added:            brand-new project → a new row.
  //   - merged:           matches a project already on file → merges into
  //                       that row (fiscal-year assembly across pastes).
  //   - pasteDuplicate:   the SAME project appears more than once *in this
  //                       paste* → each extra copy is imported as its own
  //                       row and flagged, not collapsed into the first.
  //   - skipped:          blank / no Project Name (with reasons).
  const plan = useMemo(
    () => planCommissionsPaste(existingRows, records, { dupeMode }),
    [existingRows, records, dupeMode]
  );
  const { summary, results } = plan;
  const added = useMemo(() => results.filter(r => r.status === 'added'), [results]);
  const mergedRows = useMemo(() => results.filter(r => r.status === 'merged'), [results]);
  const pasteDuplicates = useMemo(() => results.filter(r => r.status === 'pasteDuplicate'), [results]);
  const skipped = useMemo(() => results.filter(r => r.status === 'skipped'), [results]);
  const conflictRows = useMemo(() => mergedRows.filter(r => r.conflicts?.length > 0), [mergedRows]);
  const byReason = useMemo(() => {
    const out = new Map();
    for (const r of skipped) {
      if (!out.has(r.reason)) out.set(r.reason, []);
      out.get(r.reason).push(r.rowNumber);
    }
    return out;
  }, [skipped]);
  const importedRowCount = added.length + pasteDuplicates.length;

  function handleImport() {
    if (importedRowCount === 0 && mergedRows.length === 0) {
      setParseError('Nothing to import: every pasted row was either blank or missing a Project Name.');
      return;
    }
    onImport(records, { dupeMode });
  }

  const mappedCount = useMemo(
    () => headers.filter(h => mapping[h]).length,
    [headers, mapping]
  );
  const preview = useMemo(() => rawRows.slice(0, 3), [rawRows]);
  const nothingToImport = mappedCount === 0 || (importedRowCount === 0 && mergedRows.length === 0);
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
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, width: 'min(1100px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(15, 23, 42, 0.3)' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <strong style={{ fontSize: '0.9rem', color: '#1E293B' }}>
            {stage === 'paste' ? 'Paste commissions from Excel' : `Map columns: ${rawRows.length} rows`}
          </strong>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', color: '#64748B', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {stage === 'paste' && (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
            <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.4 }}>
              In Excel, select the rows you want (including the header row) and copy with <strong>Ctrl+C</strong> / <strong>Cmd+C</strong>. Then click in the box below and paste. The next step lets you confirm which pasted column maps to each commission field.
            </div>
            <textarea
              autoFocus
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
            {/* Per-row outcome summary. Splits the pasted rows: brand-new
                rows that will be ADDED, within-paste duplicates (same Project
                Name repeated in this paste) that are IMPORTED as their own
                flagged rows, projects already on file that MERGE into the
                existing row, and rows dropped entirely (with reasons). The
                user pastes expecting a clean picture of what lands and what's
                redundant, so each bucket is called out explicitly. */}
            <div style={{ padding: '0.5rem 0.7rem', borderRadius: 6, border: `1px solid ${skipped.length > 0 ? '#FCA5A5' : '#A7F3D0'}`, background: skipped.length > 0 ? '#FEF2F2' : '#F0FDF4', fontSize: '0.72rem', color: '#1E293B', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.15rem 0.5rem' }}>
                <span><strong style={{ color: added.length > 0 ? '#166534' : '#64748B' }}>{added.length}</strong> new {added.length === 1 ? 'row' : 'rows'} will be added</span>
                {pasteDuplicates.length > 0 && (
                  <span>· <strong style={{ color: '#86198F' }}>{pasteDuplicates.length}</strong> duplicate {pasteDuplicates.length === 1 ? 'row' : 'rows'} (same Project Name repeated in this paste) will be imported as {pasteDuplicates.length === 1 ? 'a separate flagged row' : 'separate flagged rows'}</span>
                )}
                {mergedRows.length > 0 && (
                  <span>· <strong style={{ color: '#92400E' }}>{mergedRows.length}</strong> {mergedRows.length === 1 ? 'row' : 'rows'} already on file {dupeMode === 'replace'
                    ? 'will have their months cleared and repopulated from this paste (Account Name / BFO Name / Scope kept)'
                    : dupeMode === 'update'
                      ? 'will merge into existing: each pasted value updates the row, months it doesn’t include are kept'
                      : 'will merge into existing: blank cells fill in, values already recorded are kept'} (not added again)</span>
                )}
                {skipped.length > 0 && (
                  <span>· <strong style={{ color: '#991B1B' }}>{skipped.length} skipped</strong></span>
                )}
                <span style={{ color: '#94A3B8' }}>· {rawRows.length} pasted {rawRows.length === 1 ? 'row' : 'rows'}</span>
              </div>
              {mergedRows.length > 0 && (
                <div style={{ color: '#166534' }}>
                  <strong>{summary.filledCells}</strong> blank cell{summary.filledCells === 1 ? '' : 's'} will fill in
                  {' · '}<strong>{summary.duplicateCells}</strong> duplicate value{summary.duplicateCells === 1 ? '' : 's'} ignored
                  {summary.clearedCells > 0 && <> · <strong>{summary.clearedCells}</strong> month cell{summary.clearedCells === 1 ? '' : 's'} cleared</>}
                  . Projects this paste doesn’t mention are left exactly as they are.
                </div>
              )}
              {pasteDuplicates.length > 0 && (
                <div style={{ color: '#86198F' }}>
                  <span style={{ fontWeight: 600 }}>Repeated in this paste (kept as separate flagged rows):</span>{' '}
                  {pasteDuplicates.slice(0, 12).map((d, i) => (
                    <span key={d.rowNumber}>
                      {i > 0 && ', '}
                      <span title={`Row ${d.rowNumber}: same Project Name as an earlier row in this paste`}>
                        {d.projectName || `row ${d.rowNumber}`}
                      </span>
                    </span>
                  ))}
                  {pasteDuplicates.length > 12 && <span style={{ color: '#94A3B8' }}>, +{pasteDuplicates.length - 12} more</span>}
                </div>
              )}
              {mergedRows.length > 0 && (
                <div style={{ color: '#78350F' }}>
                  <span style={{ fontWeight: 600 }}>Already on file (won't be added as new):</span>{' '}
                  {mergedRows.slice(0, 12).map((d, i) => (
                    <span key={d.rowNumber}>
                      {i > 0 && ', '}
                      <span title={`Row ${d.rowNumber}: matches a project already on file`}>
                        {d.projectName || `row ${d.rowNumber}`}
                      </span>
                    </span>
                  ))}
                  {mergedRows.length > 12 && <span style={{ color: '#94A3B8' }}>, +{mergedRows.length - 12} more</span>}
                </div>
              )}
              {byReason.size > 0 && (
                <ul style={{ margin: '0.1rem 0 0', padding: '0 0 0 1rem', color: '#7F1D1D' }}>
                  {[...byReason.entries()].map(([reason, rowNums]) => (
                    <li key={reason}>
                      <strong>{rowNums.length}</strong> {rowNums.length === 1 ? 'row' : 'rows'}: {reason}
                      <span style={{ color: '#94A3B8' }}> ({rowNums.length <= 10
                        ? `row${rowNums.length === 1 ? '' : 's'} ${rowNums.join(', ')}`
                        : `rows ${rowNums.slice(0, 10).join(', ')}, +${rowNums.length - 10} more`})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Cells where the row on file and the paste disagree. These
                aren't duplicates, so they're spelled out rather than quietly
                resolved — the mode below decides which value survives. */}
            {summary.conflictCells > 0 && (
              <div style={{ padding: '0.5rem 0.7rem', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 6, fontSize: '0.72rem', color: '#92400E', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>
                  <strong>{summary.conflictCells}</strong> cell{summary.conflictCells === 1 ? '' : 's'} on {conflictRows.length} project{conflictRows.length === 1 ? '' : 's'} already {summary.conflictCells === 1 ? 'carries' : 'carry'} a <em>different</em> value
                  {dupeMode === 'fill' ? ' — kept as-is unless you pick another mode below:' : ' — the pasted value will win:'}
                </div>
                <div style={{ maxHeight: 90, overflowY: 'auto', color: '#78350F' }}>
                  {conflictRows.slice(0, 8).map(r => (
                    <div key={r.rowNumber} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <strong>{r.projectName}</strong>: {r.conflicts.slice(0, 4).map(c => `${c.field} "${c.existing}" → "${c.pasted}"`).join(', ')}{r.conflicts.length > 4 ? `, +${r.conflicts.length - 4} more` : ''}
                    </div>
                  ))}
                  {conflictRows.length > 8 && <div>+{conflictRows.length - 8} more projects</div>}
                </div>
              </div>
            )}

            {/* How to reconcile projects that already exist on file. Only
                relevant when the paste hits a project already on file, so it's
                hidden otherwise to keep the common "all new rows" case clean.
                Within-paste duplicates never merge, so they don't gate this. */}
            {mergedRows.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '0.25rem 1rem', padding: '0.4rem 0.6rem', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.72rem', color: '#334155' }}>
                <span style={{ fontWeight: 600, alignSelf: 'center' }}>When a project already exists:</span>
                <label style={{ display: 'inline-flex', alignItems: 'flex-start', gap: '0.3rem', cursor: 'pointer', maxWidth: 340 }} title="Fill in the cells this project has no value for yet and leave everything already recorded alone — a pasted figure that repeats or contradicts one on file changes nothing. Months an earlier paste recorded are kept either way.">
                  <input type="radio" name="commissions-dupe-mode" checked={dupeMode === 'fill'} onChange={() => setDupeMode('fill')} style={{ marginTop: 2, cursor: 'pointer' }} />
                  <span><strong>Fill blanks only</strong> (default): keep every figure already on file</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'flex-start', gap: '0.3rem', cursor: 'pointer', maxWidth: 340 }} title="Let each pasted value update the row, so a corrected figure lands. Months this paste doesn't include are still kept.">
                  <input type="radio" name="commissions-dupe-mode" checked={dupeMode === 'update'} onChange={() => setDupeMode('update')} style={{ marginTop: 2, cursor: 'pointer' }} />
                  <span><strong>Update with pasted values</strong>: corrections overwrite</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'flex-start', gap: '0.3rem', cursor: 'pointer', maxWidth: 360 }} title="Clear the existing row's months first, then fill in only the months from this paste. Account Name / BFO Name / Scope are kept. Use this to reset a project whose earlier months were wrong.">
                  <input type="radio" name="commissions-dupe-mode" checked={dupeMode === 'replace'} onChange={() => setDupeMode('replace')} style={{ marginTop: 2, cursor: 'pointer' }} />
                  <span><strong>Replace months</strong>: clear existing months, use only this paste</span>
                </label>
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
                            {COMMISSIONS_CANONICAL.map(c => <option key={c} value={c}>{c}</option>)}
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
                <button onClick={handleImport} disabled={nothingToImport} title={dupeMode === 'replace'
                  ? "New rows are added; a project name repeated within this paste is imported as its own flagged row; a project already on file has its existing months cleared, then repopulated from only this paste (Account Name / BFO Name / Scope kept)."
                  : dupeMode === 'update'
                    ? "New rows are added; a project name repeated within this paste is imported as its own flagged row; a project already on file is merged into cell by cell: each pasted value updates the row, and any months this paste doesn't include are kept."
                    : "New rows are added; a project name repeated within this paste is imported as its own flagged row; a project already on file fills in only the cells it had no value for — every figure already recorded, and every project this paste doesn't mention, is left alone."} style={{ padding: '0.4rem 0.9rem', border: 'none', borderRadius: 6, background: nothingToImport ? '#94A3B8' : '#16A34A', color: '#fff', fontSize: '0.78rem', cursor: nothingToImport ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                  {mergedRows.length > 0
                    ? `Add ${importedRowCount} · ${dupeMode === 'replace' ? 'replace' : dupeMode === 'update' ? 'update' : 'fill'} ${mergedRows.length} →`
                    : `Import ${importedRowCount} row${importedRowCount === 1 ? '' : 's'} →`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
