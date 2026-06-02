import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { saveList, loadList, clearList } from '../../utils/uploadedListStore';
import { loadUtilityRates } from '../../utils/utilityRatesStore';
import { parseBestSheet } from '../../utils/xlsxParse';
import { lookupUtilityForZip } from '../../utils/utilityClassify';
import { userLsGet, userLsSet } from '../../utils/userLs';
import {
  MASTER_FIELDS,
  CANONICAL_HEADERS,
  emptyRow,
  detectMasterMapping,
  rowFromMapping,
  rowKey,
  isRowEmpty,
} from './masterSiteFields';
import styles from './MasterSiteListView.module.css';

// Master Site List lives in its own IDB list (mirrored to Firestore by
// uploadedListStore), separate from the Utility Lookup sites table.
const MASTER_STORAGE_KEY = 'master-site-list-override';
// The key the Utility Lookup page (SitesView) reads/writes its sites from.
const SITES_STORAGE_KEY = 'sites-list-override';
// Per-user UI preferences (column widths + hidden columns).
const WIDTHS_LS_KEY = 'master-site-list:col-widths';
const HIDDEN_LS_KEY = 'master-site-list:hidden-cols';

const ALL = '__all__';

// Every togglable/resizable column, in display order. The eight editable
// fields plus the two derived (read-only) Utility Lookup columns. The "#"
// row-number and delete columns are fixed and not part of this list.
const COLUMNS = [
  ...MASTER_FIELDS.map(f => ({ key: f.key, label: f.label, kind: 'field' })),
  { key: '__utility__', label: 'Indicative Utility', kind: 'utility', title: 'Indicative electric utility pulled from the Utility Lookup zip table' },
  { key: '__status__', label: 'Status', kind: 'status', title: 'Regulated vs Deregulated, derived from the indicative utility' },
];

// Sensible starting widths (px) per column; anything missing uses 140.
const DEFAULT_WIDTHS = {
  company: 180, propertyName: 180, subsector: 130, country: 120,
  address: 220, city: 130, state: 90, zip: 90,
  __utility__: 200, __status__: 120,
};
const MIN_COL_WIDTH = 60;

function colWidthOf(widths, key) {
  const w = widths[key];
  return Number.isFinite(w) ? w : (DEFAULT_WIDTHS[key] || 140);
}

function readJsonLs(key, fallback) {
  try {
    const raw = userLsGet(key);
    return raw ? (JSON.parse(raw) ?? fallback) : fallback;
  } catch { return fallback; }
}

// Split one line of pasted text into cells, honoring tabs first (the
// usual clipboard format out of Excel/Sheets) then falling back to a
// simple CSV split with basic quote handling.
function splitPasteLine(line) {
  if (line.includes('\t')) return line.split('\t');
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Parse a block of pasted rows into canonical master rows. If the first
// line looks like headers we map by header text; otherwise we assume the
// columns are in the documented order (Company, Property Name, ...).
function parsePastedRows(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return [];
  const firstCells = splitPasteLine(lines[0]).map(c => c.trim());
  const looksLikeHeader = firstCells.some(c => MASTER_FIELDS.some(f =>
    f.label.toLowerCase() === c.toLowerCase() || c.toLowerCase().includes('company') || c.toLowerCase().includes('property')));

  if (looksLikeHeader) {
    const mapping = detectMasterMapping(firstCells);
    // Map detected header text back to its column index.
    const idxByField = {};
    for (const f of MASTER_FIELDS) {
      const hdr = mapping[f.key];
      idxByField[f.key] = hdr ? firstCells.findIndex(c => c === hdr) : -1;
    }
    return lines.slice(1).map(line => {
      const cells = splitPasteLine(line);
      const row = emptyRow();
      for (const f of MASTER_FIELDS) {
        const i = idxByField[f.key];
        if (i >= 0 && cells[i] != null) row[f.key] = String(cells[i]).trim();
      }
      return row;
    }).filter(r => !isRowEmpty(r));
  }

  // No header — positional mapping in field order.
  return lines.map(line => {
    const cells = splitPasteLine(line);
    const row = emptyRow();
    MASTER_FIELDS.forEach((f, i) => { if (cells[i] != null) row[f.key] = String(cells[i]).trim(); });
    return row;
  }).filter(r => !isRowEmpty(r));
}

export function MasterSiteListView() {
  const [rows, setRows] = useState([]);
  const [zipMap, setZipMap] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [companyFilter, setCompanyFilter] = useState(ALL);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState('');
  const [colWidths, setColWidths] = useState(() => readJsonLs(WIDTHS_LS_KEY, {}));
  const [hiddenCols, setHiddenCols] = useState(() => new Set(readJsonLs(HIDDEN_LS_KEY, [])));
  const [showColMenu, setShowColMenu] = useState(false);
  const fileInputRef = useRef(null);
  const colMenuRef = useRef(null);
  const resizeRef = useRef(null); // { key, startX, startW } during a drag
  const skipSave = useRef(true);

  // Persist column widths / hidden columns per user.
  useEffect(() => { userLsSet(WIDTHS_LS_KEY, JSON.stringify(colWidths)); }, [colWidths]);
  useEffect(() => { userLsSet(HIDDEN_LS_KEY, JSON.stringify([...hiddenCols])); }, [hiddenCols]);

  // Close the Columns popover on outside click / Escape.
  useEffect(() => {
    if (!showColMenu) return;
    const onDown = (e) => { if (!colMenuRef.current?.contains(e.target)) setShowColMenu(false); };
    const onKey = (e) => { if (e.key === 'Escape') setShowColMenu(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [showColMenu]);

  // Column-resize drag: track the live pointer and widen/narrow the
  // column under the grabbed handle. Listeners live on document so the
  // drag keeps working even when the pointer leaves the header cell.
  useEffect(() => {
    function onMove(e) {
      const r = resizeRef.current;
      if (!r) return;
      const next = Math.max(MIN_COL_WIDTH, r.startW + (e.clientX - r.startX));
      setColWidths(prev => ({ ...prev, [r.key]: next }));
    }
    function onUp() {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, []);

  const startResize = useCallback((key, e) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { key, startX: e.clientX, startW: colWidthOf(colWidths, key) };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [colWidths]);

  const toggleColumn = useCallback((key) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const visibleColumns = useMemo(() => COLUMNS.filter(c => !hiddenCols.has(c.key)), [hiddenCols]);

  // Initial load: master rows + the zip→utility lookup table.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [saved, util] = await Promise.all([
        loadList(MASTER_STORAGE_KEY).catch(() => null),
        loadUtilityRates().catch(() => null),
      ]);
      if (cancelled) return;
      if (Array.isArray(saved)) setRows(saved);
      if (util?.zipMap) setZipMap(util.zipMap);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist on change (skip the first render after load so we don't
  // immediately rewrite what we just read).
  useEffect(() => {
    if (!loaded) return;
    if (skipSave.current) { skipSave.current = false; return; }
    saveList(MASTER_STORAGE_KEY, rows).catch(() => {});
  }, [rows, loaded]);

  const companies = useMemo(() => {
    const set = new Set();
    for (const r of rows) { const c = String(r.company || '').trim(); if (c) set.add(c); }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  // Visible rows carry their index in the full array so edits/deletes
  // target the right row even while filtered.
  const visible = useMemo(() => {
    const idx = rows.map((r, i) => ({ r, i }));
    if (companyFilter === ALL) return idx;
    return idx.filter(({ r }) => String(r.company || '').trim() === companyFilter);
  }, [rows, companyFilter]);

  const updateCell = useCallback((index, key, value) => {
    setRows(prev => {
      const next = prev.slice();
      next[index] = { ...next[index], [key]: value };
      return next;
    });
  }, []);

  const deleteRow = useCallback((index) => {
    setRows(prev => prev.filter((_, i) => i !== index));
  }, []);

  function addRow() {
    const seed = emptyRow();
    if (companyFilter !== ALL) seed.company = companyFilter;
    setRows(prev => [...prev, seed]);
  }

  // Append rows, dropping any that duplicate an existing row by
  // company|property|zip. Returns the number actually added.
  function appendDeduped(incoming) {
    let added = 0;
    setRows(prev => {
      const seen = new Set(prev.map(rowKey));
      const toAdd = [];
      for (const r of incoming) {
        if (isRowEmpty(r)) continue;
        const k = rowKey(r);
        if (seen.has(k)) continue;
        seen.add(k);
        toAdd.push(r);
      }
      added = toAdd.length;
      return toAdd.length ? [...prev, ...toAdd] : prev;
    });
    return added;
  }

  function doPaste() {
    const parsed = parsePastedRows(pasteText);
    if (!parsed.length) { alert('No rows found in the pasted text.'); return; }
    const added = appendDeduped(parsed);
    setShowPaste(false);
    setPasteText('');
    setBusy(`Added ${added} row${added === 1 ? '' : 's'} (skipped ${parsed.length - added} duplicate${parsed.length - added === 1 ? '' : 's'}).`);
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const { rows: parsed, headers } = parseBestSheet(new Uint8Array(buf));
      const mapping = detectMasterMapping(headers);
      const mapped = parsed.map(r => rowFromMapping(r, mapping));
      const added = appendDeduped(mapped);
      setBusy(`Imported ${added} new row${added === 1 ? '' : 's'} from ${file.name}.`);
    } catch (err) {
      alert(`Could not read file: ${err?.message || err}`);
    }
  }

  // Pull sites from the Utility Lookup page into this list. Scoped to the
  // selected company when one is chosen in the filter.
  async function importFromUtilityLookup() {
    setBusy('Importing from Utility Lookup…');
    try {
      const sites = await loadList(SITES_STORAGE_KEY);
      if (!Array.isArray(sites) || !sites.length) {
        setBusy('Utility Lookup has no site data to import. Upload a sites file there first.');
        return;
      }
      const headers = Object.keys(sites[0] || {});
      const mapping = detectMasterMapping(headers);
      let mapped = sites.map(r => rowFromMapping(r, mapping)).filter(r => !isRowEmpty(r));
      if (companyFilter !== ALL) {
        mapped = mapped.filter(r => String(r.company || '').trim() === companyFilter);
      }
      const added = appendDeduped(mapped);
      const scope = companyFilter === ALL ? 'all companies' : `"${companyFilter}"`;
      setBusy(`Imported ${added} new site${added === 1 ? '' : 's'} (${scope}) from Utility Lookup.`);
    } catch (err) {
      setBusy(`Import failed: ${err?.message || err}`);
    }
  }

  // Push the (optionally company-filtered) rows into the Utility Lookup
  // page. Non-destructive: existing Utility Lookup sites are kept and we
  // append our rows, reusing that table's own column headers when they
  // exist so its layout/detection stays intact. If it's empty we seed it
  // with the canonical headers.
  async function exportToUtilityLookup() {
    const scopeRows = (companyFilter === ALL ? rows : rows.filter(r => String(r.company || '').trim() === companyFilter))
      .filter(r => !isRowEmpty(r));
    if (!scopeRows.length) { alert('No rows to export.'); return; }
    const scope = companyFilter === ALL ? 'all companies' : `"${companyFilter}"`;
    if (!confirm(`Add ${scopeRows.length} site${scopeRows.length === 1 ? '' : 's'} (${scope}) to the Utility Lookup page? Existing Utility Lookup sites are kept; duplicates are skipped.`)) return;
    setBusy('Exporting to Utility Lookup…');
    try {
      const existing = await loadList(SITES_STORAGE_KEY);
      const hasExisting = Array.isArray(existing) && existing.length > 0;

      if (hasExisting) {
        // Map our fields onto the existing table's headers so appended
        // rows line up with its columns; skip fields that have no home.
        const headers = Object.keys(existing[0] || {});
        const mapping = detectMasterMapping(headers);
        const existingMaster = existing.map(r => rowFromMapping(r, mapping));
        const seen = new Set(existingMaster.map(rowKey));
        const toAppend = [];
        for (const r of scopeRows) {
          const k = rowKey(r);
          if (seen.has(k)) continue;
          seen.add(k);
          const obj = {};
          for (const h of headers) obj[h] = '';
          for (const f of MASTER_FIELDS) {
            const h = mapping[f.key];
            if (h) obj[h] = r[f.key] || '';
          }
          toAppend.push(obj);
        }
        if (!toAppend.length) { setBusy('Nothing to export — all selected sites already exist in Utility Lookup.'); return; }
        await saveList(SITES_STORAGE_KEY, [...existing, ...toAppend]);
        setBusy(`Added ${toAppend.length} site${toAppend.length === 1 ? '' : 's'} to Utility Lookup. Open the Utility Lookup tab to see them.`);
      } else {
        // Empty target — seed with canonical headers.
        const out = scopeRows.map(r => {
          const obj = {};
          MASTER_FIELDS.forEach((f, i) => { obj[CANONICAL_HEADERS[i]] = r[f.key] || ''; });
          return obj;
        });
        await saveList(SITES_STORAGE_KEY, out);
        setBusy(`Sent ${out.length} site${out.length === 1 ? '' : 's'} to Utility Lookup. Open the Utility Lookup tab to see them.`);
      }
    } catch (err) {
      setBusy(`Export failed: ${err?.message || err}`);
    }
  }

  function exportExcel() {
    const scopeRows = companyFilter === ALL ? rows : rows.filter(r => String(r.company || '').trim() === companyFilter);
    const data = scopeRows.filter(r => !isRowEmpty(r)).map(r => {
      const o = {};
      MASTER_FIELDS.forEach((f, i) => { o[CANONICAL_HEADERS[i]] = r[f.key] || ''; });
      const look = lookupUtilityForZip(zipMap, r.zip);
      o['Indicative Utility'] = look.utility || '';
      o['Regulated/Deregulated'] = look.status || '';
      return o;
    });
    if (!data.length) { alert('No rows to export.'); return; }
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Master Site List');
    XLSX.writeFile(wb, 'master-site-list.xlsx');
  }

  function clearAll() {
    if (!confirm('Clear the entire Master Site List? This cannot be undone.')) return;
    setRows([]);
    clearList(MASTER_STORAGE_KEY).catch(() => {});
    setBusy('Cleared.');
  }

  if (!loaded) return <div className={styles.empty}>Loading…</div>;

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <button className={styles.btnPrimary} onClick={addRow}>+ Add Row</button>
        <button className={styles.btn} onClick={() => setShowPaste(true)}>Paste Rows</button>
        <button className={styles.btn} onClick={() => fileInputRef.current?.click()}>Import File…</button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          onChange={onFile}
        />

        <select className={styles.select} value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}>
          <option value={ALL}>All companies ({rows.length})</option>
          {companies.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <button className={styles.btn} onClick={importFromUtilityLookup} title="Pull sites in from the Utility Lookup page">↙ From Utility Lookup</button>
        <button className={styles.btn} onClick={exportToUtilityLookup} title="Send the selected sites to the Utility Lookup page">↗ To Utility Lookup</button>

        <div className={styles.colMenuWrap} ref={colMenuRef}>
          <button className={styles.btn} onClick={() => setShowColMenu(v => !v)} title="Show or hide columns">
            Columns ▾
          </button>
          {showColMenu && (
            <div className={styles.colMenu} role="menu">
              {COLUMNS.map(c => (
                <label key={c.key} className={styles.colMenuItem}>
                  <input
                    type="checkbox"
                    checked={!hiddenCols.has(c.key)}
                    onChange={() => toggleColumn(c.key)}
                  />
                  {c.label}
                </label>
              ))}
              <div className={styles.colMenuDivider} />
              <button className={styles.colMenuReset} onClick={() => { setHiddenCols(new Set()); setColWidths({}); }}>
                Reset columns & widths
              </button>
            </div>
          )}
        </div>

        <span className={styles.spacer} />

        <span className={styles.count}>{visible.length} shown</span>
        <button className={styles.btn} onClick={exportExcel}>Export Excel</button>
        <button className={styles.btnDanger} onClick={clearAll}>Clear</button>
      </div>

      {busy && <div className={styles.hint}>{busy}</div>}

      <div className={styles.tableWrap}>
        <table className={styles.table} style={{ tableLayout: 'fixed', width: 'auto' }}>
          <colgroup>
            <col style={{ width: 44 }} />
            {visibleColumns.map(c => <col key={c.key} style={{ width: colWidthOf(colWidths, c.key) }} />)}
            <col style={{ width: 40 }} />
          </colgroup>
          <thead>
            <tr>
              <th className={styles.rowNum}>#</th>
              {visibleColumns.map(c => (
                <th key={c.key} title={c.title || c.label}>
                  <span className={styles.thLabel}>{c.label}</span>
                  <span
                    className={styles.resizer}
                    title="Drag to resize"
                    onMouseDown={(e) => startResize(c.key, e)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length + 2} className={styles.empty}>
                  No sites yet. Add a row, paste a list, import a file, or pull from the Utility Lookup page.
                </td>
              </tr>
            ) : visible.map(({ r, i }) => {
              const look = lookupUtilityForZip(zipMap, r.zip);
              return (
                <tr key={i}>
                  <td className={styles.rowNum}>{i + 1}</td>
                  {visibleColumns.map(c => {
                    if (c.kind === 'field') {
                      return (
                        <td key={c.key}>
                          <input
                            className={styles.cellInput}
                            value={r[c.key] || ''}
                            onChange={e => updateCell(i, c.key, e.target.value)}
                          />
                        </td>
                      );
                    }
                    if (c.kind === 'utility') {
                      return (
                        <td key={c.key} className={styles.derived}>
                          {look.utility || <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                        </td>
                      );
                    }
                    // status
                    return (
                      <td key={c.key} className={styles.derived}>
                        {look.status === 'Regulated'
                          ? <span className={`${styles.badge} ${styles.badgeReg}`}>Regulated</span>
                          : look.status === 'Deregulated'
                            ? <span className={`${styles.badge} ${styles.badgeDereg}`}>Deregulated</span>
                            : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                      </td>
                    );
                  })}
                  <td>
                    <button className={styles.del} title="Delete row" onClick={() => deleteRow(i)}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!zipMap && (
        <div className={styles.hint}>
          Tip: the Indicative Utility / Status columns fill in once a zip → utility table has been uploaded on the Utility Lookup page.
        </div>
      )}

      {showPaste && (
        <div className={styles.modalBackdrop} onClick={() => setShowPaste(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Paste sites</h3>
            <p className={styles.modalText}>
              Paste rows copied from Excel or Sheets. Columns:{' '}
              <strong>{CANONICAL_HEADERS.join(' · ')}</strong>. A header row is auto-detected; otherwise columns are read in that order.
            </p>
            <textarea
              className={styles.textarea}
              autoFocus
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder={CANONICAL_HEADERS.join('\t')}
            />
            <div className={styles.modalActions}>
              <button className={styles.btn} onClick={() => { setShowPaste(false); setPasteText(''); }}>Cancel</button>
              <button className={styles.btnPrimary} onClick={doPaste}>Add Rows</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
