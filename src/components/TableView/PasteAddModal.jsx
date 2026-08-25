import { useState, useMemo } from 'react';
import { companyDedupeKey } from '../../utils/firestoreSync';
import { FIELDS, autoMap, parseDelimitedRows, cellsToProspect } from './pasteFields';

// Split the clipboard text into a header row plus data rows. The cell
// parsing itself (quoting, tab-vs-comma) is shared with the bulk add.
function parseDelimited(text) {
  const rows = parseDelimitedRows(text);
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map(h => String(h || '').trim());
  return { headers, rows: rows.slice(1) };
}

// Convert one pasted row into a prospect object using the header->field
// mapping, applying the same per-field typing as the Upload Excel flow.
function rowToProspect(cells, headers, mapping) {
  return cellsToProspect(cells, headers.map(h => mapping[h] || ''));
}

// Paste-from-Excel mass add for Table View. Stage 1 takes the raw
// clipboard text; stage 2 shows the column-mapping table (auto-mapped
// where headers match, with a dropdown per pasted column) plus a live
// new-vs-duplicate count against the existing prospects. The default
// 'add' mode is additive only — existing companies are skipped, never
// overwritten. mode="upsert" (used by the PE Portfolio Blue Owl tab)
// instead matches pasted rows to existing companies and fills their
// blank fields, with an Overwrite checkbox to also replace values that
// differ; `defaults` supplies fields applied to every row the paste
// doesn't itself provide (e.g. a PE Owner for the tab doing the paste).
export function PasteAddModal({ existingProspects, onImport, onClose, mode = 'add', defaults }) {
  const [paste, setPaste] = useState('');
  const [stage, setStage] = useState('paste');
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [parseError, setParseError] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const upsert = mode === 'upsert';

  function handleNext() {
    setParseError('');
    const { headers: h, rows } = parseDelimited(paste);
    if (h.length === 0 || rows.length === 0) {
      setParseError('Nothing to import: copy the rows (including the header row) from Excel and paste here.');
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
  // button says exactly what will happen before it's clicked. In upsert
  // mode, matched companies are diffed instead of skipped: pasted values
  // landing on blank fields are gap-fills (always applied), values that
  // differ from a non-blank field apply only when Overwrite is ticked.
  const plan = useMemo(() => {
    if (!companyMapped) return null;
    const records = rawRows.map(cells => rowToProspect(cells, headers, mapping));
    if (!upsert) {
      const existing = new Set(
        (existingProspects || []).map(p => companyDedupeKey(p?.company)).filter(Boolean)
      );
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
    }
    const byKey = new Map();
    for (const p of (existingProspects || [])) {
      const k = companyDedupeKey(p?.company);
      if (k && !byKey.has(k)) byKey.set(k, p);
    }
    const isEmpty = (v) => v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === '');
    const sameValue = (a, b) => {
      if (Array.isArray(a) || Array.isArray(b)) {
        return JSON.stringify(Array.isArray(a) ? a : [a]) === JSON.stringify(Array.isArray(b) ? b : [b]);
      }
      if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
      return String(a).trim() === String(b).trim();
    };
    const toAdd = [];
    const toUpdate = [];
    const unchanged = [];
    let noCompany = 0;
    const seenNew = new Set();
    for (const r of records) {
      if (!r.company) { noCompany++; continue; }
      const effective = { ...(defaults || {}), ...r };
      const key = companyDedupeKey(r.company);
      const match = key ? byKey.get(key) : null;
      if (!match) {
        // Dedupe repeats within the paste itself; addProspect's
        // company-key backstop would catch them anyway, but the second
        // copy would silently drop its extra fields.
        if (!key || seenNew.has(key)) { unchanged.push(r.company); continue; }
        seenNew.add(key);
        toAdd.push(effective);
        continue;
      }
      const fills = {};
      const diffs = {};
      for (const [field, val] of Object.entries(effective)) {
        if (field === 'company') continue;
        const cur = match[field];
        if (isEmpty(cur)) { fills[field] = val; continue; }
        if (!sameValue(cur, val)) diffs[field] = val;
      }
      const changes = { ...fills, ...(overwrite ? diffs : {}) };
      if (Object.keys(changes).length > 0) {
        toUpdate.push({ id: match.id, company: match.company, changes, fillCount: Object.keys(fills).length, diffCount: Object.keys(diffs).length });
      } else {
        unchanged.push(match.company);
      }
    }
    return { toAdd, toUpdate, unchanged, noCompany, dupes: [] };
  }, [companyMapped, existingProspects, rawRows, headers, mapping, upsert, defaults, overwrite]);

  const planActionable = !!plan && (plan.toAdd.length > 0 || (plan.toUpdate?.length || 0) > 0);

  function handleImport() {
    if (!planActionable) return;
    onImport(plan);
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, width: 'min(960px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(15, 23, 42, 0.3)' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <strong style={{ fontSize: '0.9rem', color: '#1E293B' }}>
            {stage === 'paste' ? 'Paste companies from Excel' : `Map columns: ${rawRows.length} rows`}
          </strong>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', color: '#64748B', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {stage === 'paste' && (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
            <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.4 }}>
              In Excel (or Google Sheets), select the rows you want <strong>including the header row</strong> and copy with <strong>Cmd+C</strong> / <strong>Ctrl+C</strong>, then paste below. The next step shows which pasted column maps to each Table View field. {upsert
                ? <>Companies already in Table View get their <strong>blank fields filled</strong> from the paste (tick Overwrite on the next step to also replace values that differ); new companies are added.</>
                : <>Companies already in Table View are skipped: this adds, it never overwrites.</>}
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
                {upsert && <> · <span style={{ color: '#1D4ED8', fontWeight: 700 }}>{plan.toUpdate.length} to update</span></>}
                {upsert && plan.unchanged.length > 0 && <> · <span style={{ color: '#64748B' }}>{plan.unchanged.length} unchanged</span></>}
                {plan.dupes.length > 0 && <> · <span style={{ color: '#92400E' }}>{plan.dupes.length} already in Table View (skipped)</span></>}
                {plan.noCompany > 0 && <> · <span style={{ color: '#92400E' }}>{plan.noCompany} without a company (skipped)</span></>}</>
              )}
            </div>
            {upsert && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: '#475569', cursor: 'pointer' }}>
                <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
                Overwrite values that differ (otherwise only blank fields are filled)
              </label>
            )}
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
                            <option value="">(Skip)</option>
                            {FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              <button onClick={() => setStage('paste')} style={{ padding: '0.4rem 0.8rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>← Back</button>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={onClose} style={{ padding: '0.4rem 0.8rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <button
                  onClick={handleImport}
                  disabled={!planActionable}
                  style={{ padding: '0.4rem 0.9rem', border: 'none', borderRadius: 6, background: !planActionable ? '#94A3B8' : '#16A34A', color: '#fff', fontSize: '0.78rem', cursor: !planActionable ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
                >
                  {!plan
                    ? (upsert ? 'Apply →' : 'Add companies →')
                    : upsert
                    ? `Apply: add ${plan.toAdd.length} · update ${plan.toUpdate.length} →`
                    : `Add ${plan.toAdd.length} compan${plan.toAdd.length === 1 ? 'y' : 'ies'} →`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
