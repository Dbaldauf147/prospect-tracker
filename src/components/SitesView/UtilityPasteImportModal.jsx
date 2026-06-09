import { useState, useMemo } from 'react';

// Paste-import + column-mapping modal for the Utility Mapping tab. Lets
// the user copy a block of cells out of Excel / Google Sheets and paste
// it here instead of uploading a file. After pasting they confirm which
// pasted column is the utility name and which carries interval-data
// availability — the same two columns handleUpload's header heuristics
// auto-detect from a file.

// The two destinations the Utility Mapping list needs. Mirrors the
// nameCol / intervalCol pair that pickUtilityNameColumn /
// pickIntervalColumn resolve from an uploaded file.
const DEST_NAME = 'Utility Name';
const DEST_INTERVAL = 'Interval Data Available';
const DESTINATIONS = [DEST_NAME, DEST_INTERVAL];

// Same header heuristics as UtilityMappingView's file upload, so a
// pasted header row gets the obvious columns pre-selected.
function autoMap(header) {
  const h = String(header ?? '').trim();
  if (!h) return '';
  if (/interval|\bami\b|granular|smart\s*meter|green\s*button|availab/i.test(h)) return DEST_INTERVAL;
  if (/\b(utility|provider|lse|ldc|company|name)\b/i.test(h)) return DEST_NAME;
  return '';
}

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

export function UtilityPasteImportModal({ onClose, onImport }) {
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
      setParseError('Nothing to import — paste tab-separated cells copied from Excel or Google Sheets (include the header row).');
      return;
    }
    const m = {};
    for (const src of h) m[src] = autoMap(src);
    // If nothing auto-mapped to a name, default the first column to the
    // utility name so the user starts from a sensible guess.
    if (!Object.values(m).includes(DEST_NAME) && h.length) m[h[0]] = DEST_NAME;
    setHeaders(h);
    setRawRows(rows);
    setMapping(m);
    setStage('map');
  }

  const nameSrc = useMemo(() => headers.find(h => mapping[h] === DEST_NAME) || '', [headers, mapping]);
  const intervalSrc = useMemo(() => headers.find(h => mapping[h] === DEST_INTERVAL) || '', [headers, mapping]);
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
    if (!nameSrc) {
      setParseError('Pick which pasted column holds the utility name.');
      return;
    }
    if (!intervalSrc) {
      setParseError('Pick which pasted column holds interval-data availability.');
      return;
    }
    const nameIdx = headers.indexOf(nameSrc);
    const intervalIdx = headers.indexOf(intervalSrc);
    const parsed = rawRows
      .map(cells => {
        const raw = {};
        for (let i = 0; i < headers.length; i++) raw[headers[i]] = cells[i] ?? '';
        return {
          ...raw,
          name: String(cells[nameIdx] ?? '').trim(),
          interval: String(cells[intervalIdx] ?? '').trim(),
          _fileName: 'pasted data',
          _nameCol: nameSrc,
          _intervalCol: intervalSrc,
        };
      })
      .filter(r => r.name);
    if (parsed.length === 0) {
      setParseError('No utility names found in the chosen name column.');
      return;
    }
    onImport(parsed, { fileName: 'pasted data', count: parsed.length, nameCol: nameSrc, intervalCol: intervalSrc });
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, width: 'min(960px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(15, 23, 42, 0.3)' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <strong style={{ fontSize: '0.9rem', color: '#1E293B' }}>
            {stage === 'paste' ? 'Paste utilities from Excel' : `Map columns — ${rawRows.length} rows`}
          </strong>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', color: '#64748B', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {stage === 'paste' && (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
            <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.4 }}>
              In Excel (or Google Sheets), select the cells you want — <strong>including the header row</strong> — and copy with <strong>Cmd+C</strong> / <strong>Ctrl+C</strong>. Then click in the box below and paste. The next step lets you confirm which pasted column is the utility name and which is interval-data availability.
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
              {rawRows.length} rows · name from <strong>{nameSrc || '—'}</strong> · availability from <strong>{intervalSrc || '—'}</strong>
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
                            {DESTINATIONS.map(c => <option key={c} value={c}>{c}</option>)}
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
                <button onClick={handleImport} disabled={!nameSrc || !intervalSrc} style={{ padding: '0.4rem 0.9rem', border: 'none', borderRadius: 6, background: (!nameSrc || !intervalSrc) ? '#94A3B8' : '#16A34A', color: '#fff', fontSize: '0.78rem', cursor: (!nameSrc || !intervalSrc) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Use {rawRows.length} rows →</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
