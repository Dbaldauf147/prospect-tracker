import { useState, useMemo } from 'react';
import { companyDedupeKey } from '../../utils/firestoreSync';

// Destination prospect fields offered by the mapping dropdowns. Labels
// match the Table View column headers; aliases cover the header
// spellings seen in the Google Sheet / Excel exports (same set as the
// Upload Excel HEADER_MAP) so columns auto-map on paste.
const FIELDS = [
  { key: 'company', label: 'Company', aliases: ['account', 'account name', 'client', 'client name'] },
  { key: 'cdm', label: 'CDM', aliases: ['salesperson', 'sales rep', 'account owner'] },
  { key: 'status', label: 'Status', aliases: [] },
  { key: 'type', label: 'Type', aliases: ['account type'] },
  { key: 'geography', label: 'Geography', aliases: ['geo', 'region'] },
  { key: 'publicPrivate', label: 'Pub/Priv', aliases: ['public/private', 'public/ private', 'public private'] },
  { key: 'assetTypes', label: 'Asset Types', type: 'list', aliases: ['asset type'] },
  { key: 'peAum', label: 'PE AUM', type: 'number', aliases: ['pe aum', 'pe aum (billions)'] },
  { key: 'reAum', label: 'RE AUM', type: 'number', aliases: ['re aum', 're aum (billions)'] },
  { key: 'numberOfSites', label: 'Sites', type: 'number', aliases: ['number of sites', '# sites'] },
  { key: 'rank', label: 'Rank', aliases: [] },
  { key: 'tier', label: 'Tier', aliases: [] },
  { key: 'hqRegion', label: 'HQ Region', aliases: [] },
  { key: 'frameworks', label: 'Frameworks', type: 'frameworks', aliases: ['framework'] },
  { key: 'notes', label: 'Notes', aliases: [] },
  { key: 'website', label: 'Website', aliases: ['url', 'web site'] },
  { key: 'emailDomain', label: 'Email Domain', aliases: ['domain'] },
  { key: 'bfoCompanyName', label: 'BFO Company Name', aliases: [] },
  { key: 'peOwner', label: 'PE Owner', aliases: ['pe owner (if portfolio co)'] },
];

const VALID_FRAMEWORKS = new Set(['RECA', 'CSRD', 'CDP', 'GRESB', 'SBT', 'Ecovadis', 'UN PRI', 'CA SB', 'NZAM']);

function parseNumber(val) {
  if (!val || val === 'Missing Data') return null;
  const n = parseFloat(String(val).replace(/[,$]/g, ''));
  return isNaN(n) ? null : n;
}

function autoMap(srcHeader) {
  const lower = String(srcHeader || '').trim().toLowerCase();
  if (!lower) return '';
  const hit = FIELDS.find(f =>
    f.key.toLowerCase() === lower ||
    f.label.toLowerCase() === lower ||
    f.aliases.includes(lower)
  );
  return hit ? hit.key : '';
}

// Delimited parser for the Excel / Google Sheets clipboard format:
// cells with newlines/delimiters/quotes arrive wrapped in double
// quotes, with internal quotes doubled. A naive line.split('\n') would
// tear quoted multi-line cells in half. Excel copies as tab-separated;
// a plain CSV paste (no tabs on the first line) falls back to commas.
function parseDelimited(text) {
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstLine = s.slice(0, s.indexOf('\n') === -1 ? s.length : s.indexOf('\n'));
  const delim = firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let cellStarted = false;
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
    if (ch === delim) { row.push(cell); cell = ''; cellStarted = false; continue; }
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

// Convert one pasted row into a prospect object using the mapping,
// applying the same per-field typing as the Upload Excel flow.
function rowToProspect(cells, headers, mapping) {
  const record = {};
  for (let i = 0; i < headers.length; i++) {
    const key = mapping[headers[i]];
    if (!key) continue;
    const val = cells[i] != null ? String(cells[i]).trim() : '';
    if (!val) continue;
    const field = FIELDS.find(f => f.key === key);
    if (field?.type === 'list') {
      record[key] = val.split(',').map(t => t.trim()).filter(Boolean);
    } else if (field?.type === 'frameworks') {
      record[key] = val.split(',').map(t => t.trim()).filter(t => VALID_FRAMEWORKS.has(t));
    } else if (field?.type === 'number') {
      const n = parseNumber(val);
      if (n != null) record[key] = n;
    } else {
      record[key] = val;
    }
  }
  return record;
}

// Paste-from-Excel mass add for Table View. Stage 1 takes the raw
// clipboard text; stage 2 shows the column-mapping table (auto-mapped
// where headers match, with a dropdown per pasted column) plus a live
// new-vs-duplicate count against the existing prospects. Import is
// additive only — existing companies are skipped, never overwritten.
export function PasteAddModal({ existingProspects, onImport, onClose }) {
  const [paste, setPaste] = useState('');
  const [stage, setStage] = useState('paste');
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [parseError, setParseError] = useState('');

  function handleNext() {
    setParseError('');
    const { headers: h, rows } = parseDelimited(paste);
    if (h.length === 0 || rows.length === 0) {
      setParseError('Nothing to import — copy the rows (including the header row) from Excel and paste here.');
      return;
    }
    const m = {};
    for (const src of h) m[src] = autoMap(src);
    setHeaders(h);
    setRawRows(rows);
    setMapping(m);
    setStage('map');
  }

  const mappedCount = useMemo(() => headers.filter(h => mapping[h]).length, [headers, mapping]);
  const companyMapped = useMemo(() => headers.some(h => mapping[h] === 'company'), [headers, mapping]);
  const preview = useMemo(() => rawRows.slice(0, 3), [rawRows]);
  const duplicateDestinations = useMemo(() => {
    const seen = new Map();
    for (const src of headers) {
      const dest = mapping[src];
      if (!dest) continue;
      seen.set(dest, (seen.get(dest) || 0) + 1);
    }
    return [...seen.entries()].filter(([, n]) => n > 1).map(([d]) => FIELDS.find(f => f.key === d)?.label || d);
  }, [headers, mapping]);

  // Live add/skip preview against the current prospects, so the import
  // button says exactly what will happen before it's clicked.
  const plan = useMemo(() => {
    if (!companyMapped) return null;
    const existing = new Set(
      (existingProspects || []).map(p => companyDedupeKey(p?.company)).filter(Boolean)
    );
    const records = rawRows.map(cells => rowToProspect(cells, headers, mapping));
    const toAdd = [];
    const dupes = [];
    let noCompany = 0;
    for (const r of records) {
      if (!r.company) { noCompany++; continue; }
      const key = companyDedupeKey(r.company);
      if (!key || existing.has(key)) { dupes.push(r.company); continue; }
      existing.add(key);
      toAdd.push(r);
    }
    return { toAdd, dupes, noCompany };
  }, [companyMapped, existingProspects, rawRows, headers, mapping]);

  function handleImport() {
    if (!plan || plan.toAdd.length === 0) return;
    onImport(plan);
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, width: 'min(960px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(15, 23, 42, 0.3)' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <strong style={{ fontSize: '0.9rem', color: '#1E293B' }}>
            {stage === 'paste' ? 'Paste companies from Excel' : `Map columns — ${rawRows.length} rows`}
          </strong>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', color: '#64748B', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {stage === 'paste' && (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
            <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.4 }}>
              In Excel (or Google Sheets), select the rows you want <strong>including the header row</strong> and copy with <strong>Cmd+C</strong> / <strong>Ctrl+C</strong>, then paste below. The next step shows which pasted column maps to each Table View field. Companies already in Table View are skipped — this adds, it never overwrites.
            </div>
            <textarea
              value={paste}
              onChange={e => setPaste(e.target.value)}
              placeholder="Paste your copied rows here…"
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
              {!companyMapped && <> · <span style={{ color: '#991B1B', fontWeight: 700 }}>map a column to Company to enable the import</span></>}
              {duplicateDestinations.length > 0 && <> · <span style={{ color: '#991B1B' }}>Multiple sources point at: {duplicateDestinations.join(', ')}</span></>}
              {plan && (
                <> · <span style={{ color: '#166534', fontWeight: 700 }}>{plan.toAdd.length} new</span>
                {plan.dupes.length > 0 && <> · <span style={{ color: '#92400E' }}>{plan.dupes.length} already in Table View (skipped)</span></>}
                {plan.noCompany > 0 && <> · <span style={{ color: '#92400E' }}>{plan.noCompany} without a company (skipped)</span></>}</>
              )}
            </div>
            <div style={{ overflow: 'auto', border: '1px solid #E2E8F0', borderRadius: 6, flex: 1, minHeight: 0 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.72rem' }}>
                <thead style={{ background: '#F1F5F9', position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #CBD5E1' }}>Pasted column</th>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #CBD5E1' }}>→ Table View field</th>
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
                            {FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              <button onClick={() => setStage('paste')} style={{ padding: '0.4rem 0.8rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>← Back</button>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={onClose} style={{ padding: '0.4rem 0.8rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <button
                  onClick={handleImport}
                  disabled={!plan || plan.toAdd.length === 0}
                  style={{ padding: '0.4rem 0.9rem', border: 'none', borderRadius: 6, background: (!plan || plan.toAdd.length === 0) ? '#94A3B8' : '#16A34A', color: '#fff', fontSize: '0.78rem', cursor: (!plan || plan.toAdd.length === 0) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
                >
                  {plan ? `Add ${plan.toAdd.length} compan${plan.toAdd.length === 1 ? 'y' : 'ies'} →` : 'Add companies →'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
