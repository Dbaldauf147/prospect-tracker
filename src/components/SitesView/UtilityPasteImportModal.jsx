import { useState, useMemo } from 'react';

// Paste-import + column-mapping modal for the Utility Mapping tab. Lets
// the user copy a block of cells out of Excel / Google Sheets and paste
// it here instead of uploading a file. After pasting they confirm which
// pasted column is the utility name and which carries interval-data
// availability — the same two columns handleUpload's header heuristics
// auto-detect from a file.

// The two destinations the interval-data Utility Mapping list needs.
// Mirrors the nameCol / intervalCol pair that pickUtilityNameColumn /
// pickIntervalColumn resolve from an uploaded file.
const DEST_NAME = 'Utility Name';
const DEST_INTERVAL = 'Interval Data Available';

// Default field config — the interval-data mapping. Each field carries
// the output `key` written onto every parsed row (and used to derive the
// `_<key>Col` provenance tag + the `<key>Col` meta entry), the visible
// destination `label`, whether it's `required`, and a header-matching
// predicate used to pre-select the obvious source column on paste.
const DEFAULT_FIELDS = [
  { key: 'name', label: DEST_NAME, required: true, match: (h) => /\b(utility|provider|lse|ldc|company|name)\b/i.test(h) },
  { key: 'interval', label: DEST_INTERVAL, required: true, match: (h) => /interval|\bami\b|granular|smart\s*meter|green\s*button|availab/i.test(h) },
];

// Robust tab-separated parser for the spreadsheet clipboard format:
// cells with newlines/tabs/quotes arrive wrapped in double quotes, with
// internal quotes doubled. Shared shape with DealsView's PasteImportModal.
function parseTSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let cellStarted = false;
  const s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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
  // Make header names unique + non-empty so the mapping table and the
  // per-row objects stay keyed unambiguously.
  const seen = new Map();
  const headers = rows[0].map((h, i) => {
    const base = String(h || '').trim() || `Column ${i + 1}`;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
  return { headers, rows: rows.slice(1) };
}

export function UtilityPasteImportModal({
  onClose,
  onImport,
  title = 'Paste utilities from Excel',
  fields = DEFAULT_FIELDS,
}) {
  const [paste, setPaste] = useState('');
  const [stage, setStage] = useState('paste');
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [parseError, setParseError] = useState('');

  const destinations = useMemo(() => fields.map(f => f.label), [fields]);
  const requiredFields = useMemo(() => fields.filter(f => f.required), [fields]);

  // Pre-select the obvious source column for each destination using the
  // per-field header predicates.
  function autoMap(header) {
    const h = String(header ?? '').trim();
    if (!h) return '';
    for (const f of fields) if (f.match(h)) return f.label;
    return '';
  }

  function handleNext() {
    setParseError('');
    const { headers: h, rows } = parseTSV(paste);
    if (h.length === 0 || rows.length === 0) {
      setParseError('Nothing to import — paste tab-separated cells copied from Excel or Google Sheets (include the header row).');
      return;
    }
    const m = {};
    for (const src of h) m[src] = autoMap(src);
    // If nothing auto-mapped to the first required field, default the
    // first column to it so the user starts from a sensible guess.
    const firstRequired = requiredFields[0];
    if (firstRequired && !Object.values(m).includes(firstRequired.label) && h.length) {
      m[h[0]] = firstRequired.label;
    }
    setHeaders(h);
    setRawRows(rows);
    setMapping(m);
    setStage('map');
  }

  // Source header chosen for each destination label, keyed by label.
  const srcByDest = useMemo(() => {
    const out = {};
    for (const f of fields) out[f.label] = headers.find(h => mapping[h] === f.label) || '';
    return out;
  }, [fields, headers, mapping]);
  const missingRequired = requiredFields.filter(f => !srcByDest[f.label]);
  const preview = useMemo(() => rawRows.slice(0, 3), [rawRows]);

  // Only one source column can feed each destination — picking a new
  // source for a destination clears any prior source pointing at it.
  function setDestForSource(src, dest) {
    setMapping(prev => {
      const next = { ...prev };
      if (dest) {
        for (const k of Object.keys(next)) if (next[k] === dest) next[k] = '';
      }
      next[src] = dest;
      return next;
    });
  }

  function handleImport() {
    setParseError('');
    if (missingRequired.length) {
      setParseError(`Pick which pasted column holds: ${missingRequired.map(f => f.label).join(', ')}.`);
      return;
    }
    // Resolve the source column index for every mapped field once.
    const fieldIdx = fields.map(f => ({ field: f, idx: srcByDest[f.label] ? headers.indexOf(srcByDest[f.label]) : -1 }));
    const nameField = fields.find(f => f.key === 'name') || requiredFields[0];
    const meta = { fileName: 'pasted data', count: 0 };
    for (const f of fields) meta[`${f.key}Col`] = srcByDest[f.label] || '';
    const parsed = rawRows
      .map(cells => {
        const raw = {};
        for (let i = 0; i < headers.length; i++) raw[headers[i]] = cells[i] ?? '';
        const row = { ...raw, _fileName: 'pasted data' };
        for (const { field, idx } of fieldIdx) {
          row[field.key] = idx >= 0 ? String(cells[idx] ?? '').trim() : '';
          row[`_${field.key}Col`] = srcByDest[field.label] || '';
        }
        return row;
      })
      .filter(r => r[nameField.key]);
    if (parsed.length === 0) {
      setParseError('No utility names found in the chosen name column.');
      return;
    }
    meta.count = parsed.length;
    onImport(parsed, meta);
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, width: 'min(960px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(15, 23, 42, 0.3)' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <strong style={{ fontSize: '0.9rem', color: '#1E293B' }}>
            {stage === 'paste' ? title : `Map columns — ${rawRows.length} rows`}
          </strong>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', color: '#64748B', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {stage === 'paste' && (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
            <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.4 }}>
              In Excel (or Google Sheets), select the cells you want — <strong>including the header row</strong> — and copy with <strong>Cmd+C</strong> / <strong>Ctrl+C</strong>. Then click in the box below and paste. The next step lets you confirm which pasted column maps to each field: {destinations.join(', ')}.
            </div>
            <textarea
              value={paste}
              onChange={e => setPaste(e.target.value)}
              placeholder="Paste your tab-separated data here…"
              autoFocus
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
              {rawRows.length} rows · {fields.map(f => (
                <span key={f.label}>{f.label} from <strong>{srcByDest[f.label] || '—'}</strong>{' '}</span>
              ))}
            </div>
            <div style={{ overflow: 'auto', border: '1px solid #E2E8F0', borderRadius: 6, flex: 1, minHeight: 0 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.72rem' }}>
                <thead style={{ background: '#F1F5F9', position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #CBD5E1' }}>Source header</th>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #CBD5E1' }}>→ Maps to</th>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #CBD5E1' }}>Preview (first 3 rows)</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((src, i) => {
                    const dest = mapping[src];
                    return (
                      <tr key={i} style={{ background: dest ? '#FFFFFF' : '#FFFBEB' }}>
                        <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #E2E8F0', fontWeight: 600, color: '#1E293B', whiteSpace: 'nowrap' }}>
                          {src}
                        </td>
                        <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #E2E8F0' }}>
                          <select
                            value={dest || ''}
                            onChange={e => setDestForSource(src, e.target.value)}
                            style={{ padding: '0.25rem 0.4rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', minWidth: 220, background: '#fff' }}
                          >
                            <option value="">— Skip —</option>
                            {destinations.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #E2E8F0', color: '#64748B', maxWidth: 360 }}>
                          {preview.map((cells, pi) => (
                            <div key={pi} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={cells[i] ?? ''}>
                              {cells[i] || <span style={{ color: '#CBD5E1' }}>—</span>}
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
                <button onClick={handleImport} disabled={missingRequired.length > 0} style={{ padding: '0.4rem 0.9rem', border: 'none', borderRadius: 6, background: missingRequired.length ? '#94A3B8' : '#16A34A', color: '#fff', fontSize: '0.78rem', cursor: missingRequired.length ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Use {rawRows.length} rows →</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
