// Generic paste-and-store table. The user copies a printable-view table
// out of Salesforce / BFO (including the header row) and pastes it
// anywhere on the pane; the first row becomes the header and the data
// persists to IndexedDB until cleared or replaced. Search, click-to-sort,
// show/hide columns, drag-to-resize, and CSV export — the same mechanics
// the BFO Activity tab uses, minus the BFO-specific enrichment.
//
// Persistence is keyed by the `dataKey` / `prefsKey` props so several of
// these can share one IndexedDB store without clobbering each other.
import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './BFOActivityView.module.css';
import { dbGet, dbPut, dbDelete } from '../../utils/db';
import { parseTSV, compareValues, cleanHeader } from '../../utils/tsvTable';
import { LastUpdatedLine } from './LastUpdatedLine';

// Salesforce Leads print the Name column as "Last, First"; the Leads tab
// wants it shown as "First Last". Split on the first comma only, so any
// middle name / suffix that follows the first name stays put
// ("Varankaval, Rama" → "Rama Varankaval"). Values without a comma — or
// with an empty last/first half — are left untouched.
function flipNameToFirstLast(value) {
  const s = String(value ?? '').trim();
  const idx = s.indexOf(',');
  if (idx === -1) return s;
  const last = s.slice(0, idx).trim();
  const first = s.slice(idx + 1).trim();
  if (!last || !first) return s;
  return `${first} ${last}`;
}

// Flip the "Name" column (case-insensitive) of a freshly-parsed table
// from "Last, First" to "First Last". Returns the input unchanged when
// there's no Name column.
function withFlippedNames(parsed) {
  const nameHeader = parsed.headers.find(h => /^name$/i.test(String(h).trim()));
  if (!nameHeader) return parsed;
  const rows = parsed.rows.map(r => {
    const flipped = flipNameToFirstLast(r[nameHeader]);
    return flipped === r[nameHeader] ? r : { ...r, [nameHeader]: flipped };
  });
  return { headers: parsed.headers, rows };
}

export function PasteTableView({
  title,
  subtitle,
  placeholder,
  storeName,
  dataKey,
  prefsKey,
  csvPrefix = 'table',
  emptyHint,
  // When set, the "Name" column is rewritten from "Last, First" to
  // "First Last" as rows are pasted in.
  flipNameColumn = false,
  // Optional hook run with the freshly parsed { headers, rows } after a
  // paste lands, for a page that wants to do something else with the same
  // table (the Leads subtab maps new leads over to Marketing Leads).
  // Whatever string it returns is appended to the paste confirmation.
  onRowsPasted,
}) {
  const [data, setData] = useState({ headers: [], rows: [] });
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState(null); // { col, dir: 'asc'|'desc' }
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [flash, setFlash] = useState('');
  const [colWidths, setColWidths] = useState({});
  const [hiddenCols, setHiddenCols] = useState({});
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const hydratedRef = useRef(false);
  // One timer for the flash line, so a longer message isn't cut short by
  // the timeout an earlier paste left running.
  const flashTimerRef = useRef(null);

  function showFlash(message, ms) {
    setFlash(message);
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlash(''), ms);
  }

  useEffect(() => () => {
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await dbGet(storeName, dataKey);
        if (!cancelled && saved && saved.headers && saved.rows) {
          // Older saved data may carry "Sorted Ascending/Descending" baked
          // into header names — strip it on load and remap row keys.
          const cleaned = saved.headers.map(cleanHeader);
          const needsRemap = cleaned.some((h, i) => h !== saved.headers[i]);
          // updatedAt travels with the rows rather than in its own state:
          // the save effect below fires on `data`, so a separate field would
          // save twice on every paste and could save new rows against the old
          // timestamp.
          const updatedAt = typeof saved.updatedAt === 'number' ? saved.updatedAt : null;
          if (needsRemap) {
            const rows = saved.rows.map(r => {
              const next = {};
              saved.headers.forEach((h, i) => { next[cleaned[i] || h] = r[h]; });
              return next;
            });
            setData({ headers: cleaned, rows, updatedAt });
          } else {
            setData({ headers: saved.headers, rows: saved.rows, updatedAt });
          }
        }
        const prefs = await dbGet(storeName, prefsKey);
        if (!cancelled && prefs) {
          if (prefs.colWidths) setColWidths(prefs.colWidths);
          if (prefs.hiddenCols) setHiddenCols(prefs.hiddenCols);
        }
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, [storeName, dataKey, prefsKey]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(storeName, { headers: data.headers, rows: data.rows, updatedAt: data.updatedAt ?? null }, dataKey)
      .catch(err => console.warn('table data save failed', err));
  }, [data, storeName, dataKey]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(storeName, { colWidths, hiddenCols }, prefsKey).catch(err => console.warn('table prefs save failed', err));
  }, [colWidths, hiddenCols, storeName, prefsKey]);

  function toggleHidden(col) {
    setHiddenCols(h => {
      const next = { ...h };
      if (next[col]) delete next[col];
      else next[col] = true;
      return next;
    });
  }

  function startColResize(col, evt) {
    evt.preventDefault();
    evt.stopPropagation();
    const startX = evt.clientX;
    const startW = colWidths[col] ?? 160;
    const onMove = (e) => {
      const next = Math.max(60, startW + (e.clientX - startX));
      setColWidths(w => ({ ...w, [col]: next }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function importPaste(text) {
    const parsed = parseTSV(text);
    if (parsed.rows.length === 0) {
      showFlash('Pasted text had no data rows.', 2500);
      return;
    }
    const next = flipNameColumn ? withFlippedNames(parsed) : parsed;
    // A paste is the only thing that moves the clock — not a reload, not a
    // column resize.
    setData({ ...next, updatedAt: Date.now() });
    let extra = '';
    if (onRowsPasted) {
      // The table is already saved above — a failure in the hook must not
      // cost the user the paste.
      try { extra = onRowsPasted(next) || ''; }
      catch (err) { console.warn('paste hook failed', err); }
    }
    const base = `Imported ${next.rows.length} rows · ${next.headers.length} columns.`;
    showFlash(extra ? `${base} ${extra}` : base, extra ? 12000 : 2500);
  }

  function handlePagePaste(e) {
    const cd = e.clipboardData;
    if (!cd) return;
    const text = cd.getData('text/plain');
    if (!text || (!text.includes('\t') && !text.includes('\n'))) return;
    e.preventDefault();
    importPaste(text);
  }

  function clearAll() {
    if (!confirm('Clear all data on this tab?')) return;
    setData({ headers: [], rows: [], updatedAt: null });
    dbDelete(storeName, dataKey).catch(() => {});
  }

  function exportCsv() {
    if (data.rows.length === 0) return;
    const escape = (v) => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const lines = [
      data.headers.map(escape).join(','),
      ...data.rows.map(r => data.headers.map(h => escape(r[h])).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${csvPrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = data.rows;
    if (q) {
      rows = rows.filter(r => data.headers.some(h => String(r[h] ?? '').toLowerCase().includes(q)));
    }
    if (sortBy) {
      const col = sortBy.col;
      const dir = sortBy.dir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => compareValues(a[col], b[col]) * dir);
    }
    return rows;
  }, [data, search, sortBy]);

  function toggleSort(col) {
    setSortBy(prev => {
      if (!prev || prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      return null;
    });
  }

  return (
    <div className={styles.pane} onPaste={handlePagePaste}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{title}</h1>
          <span className={styles.subtitle}>{subtitle}</span>
          <LastUpdatedLine updatedAt={data.updatedAt} hasRows={data.rows.length > 0} />
        </div>
        <div className={styles.toolbar}>
          <input
            className={styles.searchInput}
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="button" className={styles.btn} onClick={() => setPasteOpen(o => !o)}>
            {pasteOpen ? 'Hide paste box' : 'Paste…'}
          </button>
          {data.headers.length > 0 && (
            <div className={styles.colsMenuWrap}>
              <button type="button" className={styles.btn} onClick={() => setColMenuOpen(o => !o)}>
                Columns ▾
              </button>
              {colMenuOpen && (
                <div className={styles.colsMenu}>
                  {data.headers.map(h => (
                    <label key={h} className={styles.colsMenuItem}>
                      <input
                        type="checkbox"
                        checked={!hiddenCols[h]}
                        onChange={() => toggleHidden(h)}
                      />
                      <span>{h}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {data.rows.length > 0 && (
            <>
              <button type="button" className={styles.btn} onClick={exportCsv}>Export CSV</button>
              <button type="button" className={styles.btnDanger} onClick={clearAll}>Clear</button>
            </>
          )}
        </div>
      </div>

      {flash && (
        <div style={{ padding: '0 1.25rem 0.25rem' }}>
          <div className={styles.pasteFlash}>{flash}</div>
        </div>
      )}

      <div className={styles.body}>
        {pasteOpen && (
          <div className={styles.pasteBox}>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>
              Paste tab-separated rows. First row is treated as the header.
            </div>
            <textarea
              className={styles.pasteArea}
              rows={8}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={placeholder}
            />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
              <button
                type="button"
                className={styles.btn}
                onClick={() => { importPaste(pasteText); setPasteText(''); setPasteOpen(false); }}
              >Import</button>
              <button
                type="button"
                className={styles.btn}
                onClick={() => setPasteOpen(false)}
              >Cancel</button>
            </div>
          </div>
        )}

        {data.rows.length === 0 ? (
          <div className={styles.empty}>
            <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>No data yet.</div>
            <div style={{ fontSize: 'var(--font-size-xs)' }}>
              {emptyHint || "Select the rows (including the header), copy, then paste anywhere on this page. We'll auto-detect columns and render a sortable table. The data persists in your browser until you clear or replace it."}
            </div>
          </div>
        ) : (
          <>
            <div className={styles.summary}>
              {(() => {
                const visible = data.headers.filter(h => !hiddenCols[h]);
                const hidden = data.headers.length - visible.length;
                return `${filtered.length} of ${data.rows.length} rows${search ? ` matching "${search}"` : ''} · ${visible.length} of ${data.headers.length} columns visible${hidden ? ` (${hidden} hidden)` : ''}`;
              })()}
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {data.headers.filter(h => !hiddenCols[h]).map(h => {
                      const isSorted = sortBy?.col === h;
                      return (
                        <th key={h} style={{ width: colWidths[h] ?? 160 }}>
                          <span className={styles.thInner}>
                            <span onClick={() => toggleSort(h)} title="Click to sort" style={{ flex: 1 }}>
                              {h}
                              {isSorted && <span className={styles.sortArrow}>{sortBy.dir === 'asc' ? '▲' : '▼'}</span>}
                            </span>
                            <span
                              className={styles.colResizer}
                              onMouseDown={(e) => startColResize(h, e)}
                              title="Drag to resize column"
                            />
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={i}>
                      {data.headers.filter(h => !hiddenCols[h]).map(h => {
                        const v = r[h] ?? '';
                        const isAge = /^age$/i.test(h);
                        const isAmount = /^amount$/i.test(h);
                        const classes = [(isAge || isAmount) ? styles.nowrapCell : ''].filter(Boolean).join(' ');
                        return <td key={h} className={classes}>{v}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
