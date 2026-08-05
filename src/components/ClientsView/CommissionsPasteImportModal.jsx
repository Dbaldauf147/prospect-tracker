import { useState, useMemo } from 'react';
import { COMMISSION_MONTH_NAMES } from '../../utils/commissionsStore';

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

// Normalize a Project Name for duplicate matching — strips surrounding
// whitespace, collapses internal whitespace, and lowercases so trivial
// typing differences ("Acme — Phase 1" vs "ACME — Phase 1 ") count as
// the same project. Kept identical to (and the single source of truth
// for) the dedup key used by mergeAndDedupCommissions in CommissionsView,
// so the preview's "duplicate" call matches what the import actually does.
export function normProjectName(v) {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
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
  const [paste, setPaste] = useState(initialPaste);
  const [stage, setStage] = useState('paste');
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [parseError, setParseError] = useState('');
  // How to reconcile a pasted project that already exists on file:
  //  - 'merge' (default): union months cell by cell, keeping months this
  //    paste doesn't include.
  //  - 'replace': clear the existing row's months first, so only this
  //    paste's months survive (a clean per-project reset that still keeps
  //    the row's Account Name / BFO Name / Scope).
  const [dupeMode, setDupeMode] = useState('merge');

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

  // Normalized Project Names already on file. A pasted row whose project
  // matches one of these merges into the existing row rather than adding a
  // new one, so we flag it up front.
  const existingKeys = useMemo(() => {
    const set = new Set();
    for (const row of existingRows || []) {
      const key = normProjectName(row?.['Project Name']);
      if (key) set.add(key);
    }
    return set;
  }, [existingRows]);

  // Live import preview — re-runs whenever the mapping, pasted data, or
  // on-file roster changes so the user sees in real time what each pasted
  // row becomes:
  //   - added:             brand-new project → a new row.
  //   - existingDuplicates: matches a project already on file → merges into
  //                         that row (fiscal-year assembly across pastes).
  //   - pasteDuplicates:   the SAME project appears more than once *in this
  //                         paste* → each extra copy is imported as its own
  //                         row and flagged, not collapsed into the first.
  //   - skipped:           blank / no Project Name (with reasons).
  // handleImport consumes the same accepted list so the button never
  // disagrees with the on-screen counts.
  const importPreview = useMemo(() => {
    const accepted = [];
    const added = [];
    const existingDuplicates = [];
    const pasteDuplicates = [];
    const skipped = [];
    // Tracks project names already seen within this paste so the second (and
    // later) copy of a project is reported as a within-paste duplicate.
    const seenInPaste = new Set();
    for (let r = 0; r < rawRows.length; r++) {
      const cells = rawRows[r];
      const obj = {};
      for (let i = 0; i < headers.length; i++) {
        const dest = mapping[headers[i]];
        if (!dest) continue;
        const v = cells[i];
        if (v == null || v === '') continue;
        obj[dest] = v;
      }
      // Row numbers report against the user's pasted spreadsheet —
      // headers are row 1, the first data row is row 2, etc.
      const rowNumber = r + 2;
      if (Object.keys(obj).length === 0) {
        skipped.push({ rowNumber, reason: 'Blank row (no mapped cells had a value)' });
        continue;
      }
      const projectName = String(obj['Project Name'] || '').trim();
      if (!projectName) {
        skipped.push({ rowNumber, reason: 'Missing Project Name' });
        continue;
      }
      accepted.push(obj);
      const key = normProjectName(projectName);
      // Repeat within this paste wins the classification — it's imported as a
      // distinct flagged row regardless of whether the name is also on file.
      if (seenInPaste.has(key)) {
        pasteDuplicates.push({ rowNumber, projectName });
      } else if (existingKeys.has(key)) {
        existingDuplicates.push({ rowNumber, projectName });
      } else {
        added.push({ rowNumber, projectName });
      }
      seenInPaste.add(key);
    }
    const byReason = new Map();
    for (const s of skipped) {
      if (!byReason.has(s.reason)) byReason.set(s.reason, []);
      byReason.get(s.reason).push(s.rowNumber);
    }
    return { accepted, added, existingDuplicates, pasteDuplicates, skipped, byReason };
  }, [rawRows, headers, mapping, existingKeys]);

  function handleImport() {
    const { accepted } = importPreview;
    if (accepted.length === 0) {
      setParseError('Nothing to import: every pasted row was either blank or missing a Project Name.');
      return;
    }
    onImport(accepted, { replaceMonths: dupeMode === 'replace' });
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
            <div style={{ padding: '0.5rem 0.7rem', borderRadius: 6, border: `1px solid ${importPreview.skipped.length > 0 ? '#FCA5A5' : '#A7F3D0'}`, background: importPreview.skipped.length > 0 ? '#FEF2F2' : '#F0FDF4', fontSize: '0.72rem', color: '#1E293B', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.15rem 0.5rem' }}>
                <span><strong style={{ color: importPreview.added.length > 0 ? '#166534' : '#64748B' }}>{importPreview.added.length}</strong> new {importPreview.added.length === 1 ? 'row' : 'rows'} will be added</span>
                {importPreview.pasteDuplicates.length > 0 && (
                  <span>· <strong style={{ color: '#86198F' }}>{importPreview.pasteDuplicates.length}</strong> duplicate {importPreview.pasteDuplicates.length === 1 ? 'row' : 'rows'} (same Project Name repeated in this paste) will be imported as {importPreview.pasteDuplicates.length === 1 ? 'a separate flagged row' : 'separate flagged rows'}</span>
                )}
                {importPreview.existingDuplicates.length > 0 && (
                  <span>· <strong style={{ color: '#92400E' }}>{importPreview.existingDuplicates.length}</strong> {importPreview.existingDuplicates.length === 1 ? 'row' : 'rows'} already on file {dupeMode === 'replace'
                    ? 'will replace the existing row’s months: months not in this paste are cleared (Account Name / BFO Name / Scope kept)'
                    : 'will merge into existing: new values update it, months it doesn’t include are kept'} (not added again)</span>
                )}
                {importPreview.skipped.length > 0 && (
                  <span>· <strong style={{ color: '#991B1B' }}>{importPreview.skipped.length} skipped</strong></span>
                )}
                <span style={{ color: '#94A3B8' }}>· {rawRows.length} pasted {rawRows.length === 1 ? 'row' : 'rows'}</span>
              </div>
              {importPreview.pasteDuplicates.length > 0 && (
                <div style={{ color: '#86198F' }}>
                  <span style={{ fontWeight: 600 }}>Repeated in this paste (kept as separate flagged rows):</span>{' '}
                  {importPreview.pasteDuplicates.slice(0, 12).map((d, i) => (
                    <span key={d.rowNumber}>
                      {i > 0 && ', '}
                      <span title={`Row ${d.rowNumber}: same Project Name as an earlier row in this paste`}>
                        {d.projectName || `row ${d.rowNumber}`}
                      </span>
                    </span>
                  ))}
                  {importPreview.pasteDuplicates.length > 12 && <span style={{ color: '#94A3B8' }}>, +{importPreview.pasteDuplicates.length - 12} more</span>}
                </div>
              )}
              {importPreview.existingDuplicates.length > 0 && (
                <div style={{ color: '#78350F' }}>
                  <span style={{ fontWeight: 600 }}>Already on file (won't be added as new):</span>{' '}
                  {importPreview.existingDuplicates.slice(0, 12).map((d, i) => (
                    <span key={d.rowNumber}>
                      {i > 0 && ', '}
                      <span title={`Row ${d.rowNumber}: matches a project already on file`}>
                        {d.projectName || `row ${d.rowNumber}`}
                      </span>
                    </span>
                  ))}
                  {importPreview.existingDuplicates.length > 12 && <span style={{ color: '#94A3B8' }}>, +{importPreview.existingDuplicates.length - 12} more</span>}
                </div>
              )}
              {importPreview.byReason.size > 0 && (
                <ul style={{ margin: '0.1rem 0 0', padding: '0 0 0 1rem', color: '#7F1D1D' }}>
                  {[...importPreview.byReason.entries()].map(([reason, rowNums]) => (
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
            {/* How to reconcile projects that already exist on file. Only
                relevant when the paste hits a project already on file, so it's
                hidden otherwise to keep the common "all new rows" case clean.
                Within-paste duplicates never merge, so they don't gate this. */}
            {importPreview.existingDuplicates.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '0.25rem 1rem', padding: '0.4rem 0.6rem', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.72rem', color: '#334155' }}>
                <span style={{ fontWeight: 600, alignSelf: 'center' }}>When a project already exists:</span>
                <label style={{ display: 'inline-flex', alignItems: 'flex-start', gap: '0.3rem', cursor: 'pointer', maxWidth: 340 }} title="Fill in the months from this paste and keep any months an earlier paste already recorded (best for pasting one half of the fiscal year at a time).">
                  <input type="radio" name="commissions-dupe-mode" checked={dupeMode === 'merge'} onChange={() => setDupeMode('merge')} style={{ marginTop: 2, cursor: 'pointer' }} />
                  <span><strong>Merge months</strong>: keep months this paste doesn’t include</span>
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
                <button onClick={handleImport} disabled={mappedCount === 0 || importPreview.accepted.length === 0} title={dupeMode === 'replace'
                  ? "New rows are added; a project name repeated within this paste is imported as its own flagged row; a project already on file has its existing months cleared, then repopulated from only this paste (Account Name / BFO Name / Scope kept)."
                  : "New rows are added; a project name repeated within this paste is imported as its own flagged row; a project already on file is merged into cell by cell: each pasted value updates the row, and any months this paste doesn't include are kept."} style={{ padding: '0.4rem 0.9rem', border: 'none', borderRadius: 6, background: (mappedCount === 0 || importPreview.accepted.length === 0) ? '#94A3B8' : '#16A34A', color: '#fff', fontSize: '0.78rem', cursor: (mappedCount === 0 || importPreview.accepted.length === 0) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                  {importPreview.existingDuplicates.length > 0
                    ? `Add ${importPreview.added.length + importPreview.pasteDuplicates.length} · ${dupeMode === 'replace' ? 'replace' : 'merge'} ${importPreview.existingDuplicates.length} →`
                    : `Import ${importPreview.added.length + importPreview.pasteDuplicates.length} row${(importPreview.added.length + importPreview.pasteDuplicates.length) === 1 ? '' : 's'} →`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
