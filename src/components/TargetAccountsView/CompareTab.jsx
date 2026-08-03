import { useState, useMemo, useRef } from 'react';
import { matchesCdm } from '../../utils/cdmMatch';
import styles from './TargetAccountsView.module.css';

// Header matchers reused from the upload help table: the first column
// that looks like a company / account name is the name key; CDM is
// matched broadly so "CDM", "Salesperson", "Account Owner", etc. all
// resolve to the same field.
const NAME_RE = /account|company|name|client/i;
const CDM_RE = /cdm|salesperson|sales\s*rep|account\s*owner|^rep$/i;

function pickHeader(headers, re) {
  if (!Array.isArray(headers)) return null;
  for (const h of headers) {
    const s = String(h || '').trim();
    if (s && re.test(s)) return s;
  }
  return null;
}

// Same name normalization as the rest of the Lists views — drop punctuation,
// corp suffixes, case, and extra whitespace so "CBRE, Inc." and "cbre"
// land on the same key when diffing.
const CORP_SUFFIXES = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|oy|ab|spa|kk|pty|holdings|group|grp)\b\.?/g;
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(CORP_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function parseWorkbook(buffer) {
  // Pulled in on use — the spreadsheet library is ~140 KB gzipped and this
  // tab only needs it once a workbook is actually uploaded.
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheets = {};
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (json.length < 2) continue;
    const headers = json[0].map(h => String(h || '').trim());
    const records = [];
    for (let i = 1; i < json.length; i++) {
      const row = json[i];
      const record = {};
      let hasData = false;
      for (let j = 0; j < headers.length; j++) {
        const h = headers[j];
        if (!h) continue;
        const val = row[j] != null ? String(row[j]).trim() : '';
        record[h] = val;
        if (val) hasData = true;
      }
      if (hasData) records.push(record);
    }
    if (records.length > 0) sheets[sheetName] = { headers, records };
  }
  return sheets;
}

// Collect rows from the current Target Accounts list that match the
// passed cdmName. Walks every sheet (target-accounts uploads can be
// multi-sheet) and picks the first name/CDM column on each. Returns
// { row, name, cdm, sheet } records so the UI can show provenance.
function collectForCdm(data, cdmName) {
  const out = [];
  if (!data?.sheets) return out;
  for (const [sheetName, sheet] of Object.entries(data.sheets)) {
    const nameKey = pickHeader(sheet.headers, NAME_RE) || sheet.headers[0];
    const cdmKey = pickHeader(sheet.headers, CDM_RE);
    if (!nameKey) continue;
    for (const r of sheet.records) {
      const name = String(r[nameKey] || '').trim();
      if (!name) continue;
      const cdm = cdmKey ? String(r[cdmKey] || '').trim() : '';
      if (cdmKey && !matchesCdm(cdm, cdmName)) continue;
      // No CDM column on the sheet — include every row, since the
      // user has no way to filter further.
      out.push({ row: r, name, cdm, sheet: sheetName });
    }
  }
  return out;
}

function collectFromUpload(sheets, cdmName) {
  const out = [];
  for (const [sheetName, sheet] of Object.entries(sheets || {})) {
    const nameKey = pickHeader(sheet.headers, NAME_RE) || sheet.headers[0];
    const cdmKey = pickHeader(sheet.headers, CDM_RE);
    if (!nameKey) continue;
    for (const r of sheet.records) {
      const name = String(r[nameKey] || '').trim();
      if (!name) continue;
      const cdm = cdmKey ? String(r[cdmKey] || '').trim() : '';
      if (cdmKey && !matchesCdm(cdm, cdmName)) continue;
      out.push({ row: r, name, cdm, sheet: sheetName });
    }
  }
  return out;
}

function DiffSection({ title, color, rows, emptyLabel }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${color.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '0.5rem 0.75rem', background: color.bg, color: color.fg, fontSize: '0.78rem', fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{title}</span>
        <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: '0.75rem', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{emptyLabel}</div>
      ) : (
        <ul style={{ margin: 0, padding: '0.25rem 0', listStyle: 'none', maxHeight: 360, overflowY: 'auto' }}>
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', color: 'var(--color-text)', borderBottom: i === rows.length - 1 ? 'none' : '1px solid #F1F5F9' }}>
              <div style={{ fontWeight: 600 }}>{r.name}</div>
              {(r.cdm || r.sheet) && (
                <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: 1 }}>
                  {r.cdm ? `CDM: ${r.cdm}` : 'No CDM column'}{r.sheet ? ` · sheet: ${r.sheet}` : ''}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CompareTab({ currentData, cdmName }) {
  const [upload, setUpload] = useState(null); // { fileName, sheets }
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);

  function processFile(file) {
    if (!file) return;
    setLoading(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const sheets = await parseWorkbook(e.target.result);
        if (Object.keys(sheets).length === 0) {
          setError('No data rows found in the uploaded file.');
          setLoading(false);
          return;
        }
        setUpload({ fileName: file.name, sheets });
      } catch (err) {
        setError(`Failed to parse file: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };
    reader.onerror = () => { setError('Failed to read file'); setLoading(false); };
    reader.readAsArrayBuffer(file);
  }

  function handleFileChange(e) {
    processFile(e.target.files?.[0]);
    e.target.value = '';
  }

  const diff = useMemo(() => {
    if (!upload) return null;
    const baseRows = collectForCdm(currentData, cdmName);
    const newRows = collectFromUpload(upload.sheets, cdmName);
    // Index by normalized name so trivial casing / corp-suffix tweaks
    // don't masquerade as added or removed rows.
    const baseByNorm = new Map();
    for (const r of baseRows) {
      const k = normalizeName(r.name);
      if (k && !baseByNorm.has(k)) baseByNorm.set(k, r);
    }
    const newByNorm = new Map();
    for (const r of newRows) {
      const k = normalizeName(r.name);
      if (k && !newByNorm.has(k)) newByNorm.set(k, r);
    }
    const added = [];
    const removed = [];
    const unchanged = [];
    for (const [k, r] of newByNorm) {
      if (baseByNorm.has(k)) unchanged.push(r);
      else added.push(r);
    }
    for (const [k, r] of baseByNorm) {
      if (!newByNorm.has(k)) removed.push(r);
    }
    const cmp = (a, b) => a.name.localeCompare(b.name);
    added.sort(cmp); removed.sort(cmp); unchanged.sort(cmp);
    return { added, removed, unchanged, baseCount: baseRows.length, newCount: newRows.length };
  }, [upload, currentData, cdmName]);

  const cdmLabel = cdmName ? `CDM "${cdmName}"` : 'the configured CDM';

  return (
    <div style={{ padding: '0.75rem 1.25rem 1.25rem', overflowY: 'auto', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '0.75rem 1rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, marginBottom: '0.75rem', fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
        Upload a Target Accounts list to diff against the one currently loaded.
        Both sides are filtered to {cdmLabel} — any row whose CDM column doesn't match is ignored.
        Names are normalized (case + corp suffixes) before comparing.
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <label className={styles.uploadBtn}>
          Upload list to compare
          <input ref={fileRef} className={styles.fileInput} type="file" accept=".xlsx,.xls,.csv,.tsv" onChange={handleFileChange} />
        </label>
        {upload && (
          <>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {upload.fileName}
            </span>
            <button
              type="button"
              onClick={() => setUpload(null)}
              style={{ padding: '0.3rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 6, background: '#fff', color: 'var(--color-text-secondary)', fontSize: '0.72rem', fontFamily: 'inherit', cursor: 'pointer' }}
            >Clear</button>
          </>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.loading}>Processing file…</div>}

      {!upload && !loading && (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', border: '2px dashed var(--color-border)', borderRadius: 8, fontSize: '0.8rem' }}>
          Upload an Excel or CSV file to see what's added, removed, or unchanged
          versus the current Target Accounts list for {cdmLabel}.
        </div>
      )}

      {diff && (
        <>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginBottom: '0.75rem' }}>
            <span><strong>{diff.baseCount}</strong> current rows for {cdmLabel}</span>
            <span>·</span>
            <span><strong>{diff.newCount}</strong> uploaded rows for {cdmLabel}</span>
            <span>·</span>
            <span style={{ color: '#15803D' }}>+{diff.added.length} added</span>
            <span style={{ color: '#B91C1C' }}>−{diff.removed.length} removed</span>
            <span style={{ color: 'var(--color-text-muted)' }}>={diff.unchanged.length} unchanged</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
            <DiffSection
              title="Added (in upload, not in current)"
              color={{ bg: '#DCFCE7', fg: '#166534', border: '#86EFAC' }}
              rows={diff.added}
              emptyLabel="No new accounts in the upload."
            />
            <DiffSection
              title="Removed (in current, not in upload)"
              color={{ bg: '#FEE2E2', fg: '#991B1B', border: '#FCA5A5' }}
              rows={diff.removed}
              emptyLabel="Nothing was dropped from the current list."
            />
            <DiffSection
              title="Unchanged (in both)"
              color={{ bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1' }}
              rows={diff.unchanged}
              emptyLabel="No rows match between the two lists."
            />
          </div>
        </>
      )}
    </div>
  );
}
