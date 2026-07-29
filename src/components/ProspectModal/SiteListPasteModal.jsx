import { useState, useMemo } from 'react';

// Canonical site-list columns the company popup maps pasted Excel data
// onto. Kept in this fixed order so the combined Site List Overview on the
// Email Drafts page lines every company's sites up under the same headers.
const SITE_LIST_COLUMNS = [
  'Company',
  'Site Name',
  'Property Type',
  'Street Address',
  'City',
  'State / Province',
  'Country',
  'ZIP / Postal Code',
];

// Header aliases — normalised (lowercased, alphanumeric-only) source header
// → canonical column. Lets common Excel spellings auto-map.
const ALIASES = {
  companyname: 'Company',
  account: 'Company',
  accountname: 'Company',
  site: 'Site Name',
  sitename: 'Site Name',
  location: 'Site Name',
  locationname: 'Site Name',
  propertyname: 'Site Name',
  building: 'Site Name',
  propertytype: 'Property Type',
  type: 'Property Type',
  assettype: 'Property Type',
  address: 'Street Address',
  streetaddress: 'Street Address',
  street: 'Street Address',
  addressline1: 'Street Address',
  address1: 'Street Address',
  addr: 'Street Address',
  city: 'City',
  town: 'City',
  state: 'State / Province',
  province: 'State / Province',
  stateprovince: 'State / Province',
  region: 'State / Province',
  country: 'Country',
  zip: 'ZIP / Postal Code',
  zipcode: 'ZIP / Postal Code',
  postal: 'ZIP / Postal Code',
  postalcode: 'ZIP / Postal Code',
  zippostalcode: 'ZIP / Postal Code',
  postcode: 'ZIP / Postal Code',
};

function normHeader(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function autoMap(srcHeader) {
  const norm = normHeader(srcHeader);
  if (!norm) return '';
  const exact = SITE_LIST_COLUMNS.find(c => normHeader(c) === norm);
  if (exact) return exact;
  return ALIASES[norm] || '';
}

// Robust tab-separated parser for the Excel / Google-Sheets clipboard
// format: cells containing newlines/tabs/quotes arrive wrapped in double
// quotes with internal quotes doubled. Mirrors DealsView's PasteImportModal.
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

// Paste-and-map flow for a company's site list. onImport receives
// { headers, rows } where headers is the subset of SITE_LIST_COLUMNS that
// got mapped (in canonical order) and rows are header→value objects.
export function SiteListPasteModal({ companyName = '', onClose, onImport }) {
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
      setParseError('Nothing to import — paste tab-separated rows copied from Excel (include the header row).');
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
    // Build records keyed by canonical column, then keep only the mapped
    // columns (in canonical order) as the stored headers.
    const records = rawRows
      .map(cells => {
        const obj = {};
        for (let i = 0; i < headers.length; i++) {
          const dest = mapping[headers[i]];
          if (!dest) continue;
          const v = cells[i];
          if (v == null || v === '') continue;
          obj[dest] = String(v).trim();
        }
        return obj;
      })
      .filter(r => Object.keys(r).length > 0);
    if (records.length === 0) {
      setParseError('No mapped columns — pick at least one destination column.');
      return;
    }
    const usedDest = new Set();
    for (const src of headers) { if (mapping[src]) usedDest.add(mapping[src]); }
    const outHeaders = SITE_LIST_COLUMNS.filter(c => usedDest.has(c));
    // Default any unset Company cell to the popup's company so the overview
    // can still attribute the sites.
    if (outHeaders.includes('Company') && companyName) {
      for (const r of records) { if (!r.Company) r.Company = companyName; }
    }
    onImport({ headers: outHeaders, rows: records });
  }

  const mappedCount = useMemo(() => headers.filter(h => mapping[h]).length, [headers, mapping]);
  const preview = useMemo(() => rawRows.slice(0, 3), [rawRows]);
  const unmappedSourceNames = useMemo(() => headers.filter(h => !mapping[h]), [headers, mapping]);
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
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 6000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, width: 'min(960px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(15, 23, 42, 0.3)' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <strong style={{ fontSize: '0.9rem', color: '#1E293B' }}>
            {stage === 'paste' ? `Paste site list from Excel${companyName ? ` — ${companyName}` : ''}` : `Map columns — ${rawRows.length} rows`}
          </strong>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', color: '#64748B', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {stage === 'paste' && (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
            <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.4 }}>
              In Excel, select the site rows you want (including the header row) and copy with <strong>Ctrl+C</strong> / <strong>Cmd+C</strong>. Click in the box below and paste. The next step lets you confirm which pasted column maps to each site field.
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
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #CBD5E1' }}>→ Site field</th>
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
                            style={{ padding: '0.25rem 0.4rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', minWidth: 200, background: '#fff' }}
                          >
                            <option value="">— Skip —</option>
                            {SITE_LIST_COLUMNS.map(c => <option key={c} value={c}>{c}</option>)}
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
                <button onClick={handleImport} disabled={mappedCount === 0} style={{ padding: '0.4rem 0.9rem', border: 'none', borderRadius: 6, background: mappedCount === 0 ? '#94A3B8' : '#16A34A', color: '#fff', fontSize: '0.78rem', cursor: mappedCount === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Save {rawRows.length} site{rawRows.length === 1 ? '' : 's'} →</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
