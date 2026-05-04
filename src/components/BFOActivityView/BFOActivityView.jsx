// Paste-and-display table for BFO Activity exports. The user copies
// rows from the source CRM and pastes them anywhere on the page; the
// first row is treated as the header. Data persists to IndexedDB so
// it survives reloads. Search + click-to-sort columns; Age cells
// color-coded green/amber/red.

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './BFOActivityView.module.css';
import { dbGet, dbPut, dbDelete } from '../../utils/db';

const STORE = 'bfo-activity';
const KEY = 'current';
const PREFS_KEY = 'prefs';

function parseTSV(text) {
  if (!text) return { headers: [], rows: [] };
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(l => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const split = (line) => line.split('\t');
  // BFO copies the active sort indicator into the header text — e.g.
  // "Age Sorted Descending" or "Close DateSorted Ascending" (note: BFO
  // sometimes drops the space between the column name and "Sorted").
  // Strip the suffix so the canonical column name survives the paste.
  const cleanHeader = (h) => String(h || '')
    .replace(/\s*[▲▼↑↓]\s*$/, '')
    .replace(/\s*sorted\s+(ascending|descending)\s*$/i, '')
    .trim();
  const rawHeaders = split(lines[0]).map(cleanHeader);
  // Make headers unique
  const seen = new Map();
  const headers = rawHeaders.map((h, i) => {
    const base = h || `Column ${i + 1}`;
    const c = seen.get(base) || 0;
    seen.set(base, c + 1);
    return c === 0 ? base : `${base} (${c + 1})`;
  });
  const rows = lines.slice(1).map(line => {
    const cells = split(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] ?? '').trim(); });
    return obj;
  });
  return { headers, rows };
}

function compareValues(a, b) {
  // Try number/currency first
  const numA = Number(String(a).replace(/[$,\s]/g, ''));
  const numB = Number(String(b).replace(/[$,\s]/g, ''));
  if (Number.isFinite(numA) && Number.isFinite(numB) && /\d/.test(String(a)) && /\d/.test(String(b))) {
    return numA - numB;
  }
  // Try date (M/D/YYYY)
  const dA = Date.parse(a);
  const dB = Date.parse(b);
  if (!Number.isNaN(dA) && !Number.isNaN(dB) && /\d/.test(String(a)) && /\d/.test(String(b))) {
    return dA - dB;
  }
  return String(a).localeCompare(String(b));
}

function ageClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (n <= 60) return styles.ageGreen;
  if (n <= 180) return styles.ageAmber;
  return styles.ageRed;
}

export function BFOActivityView() {
  const [data, setData] = useState({ headers: [], rows: [] });
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState(null); // { col, dir: 'asc'|'desc' }
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [flash, setFlash] = useState('');
  const [colWidths, setColWidths] = useState({}); // { [headerName]: pixelWidth }
  const [hiddenCols, setHiddenCols] = useState({}); // { [headerName]: true }
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await dbGet(STORE, KEY);
        if (!cancelled && saved && saved.headers && saved.rows) {
          // Older saved data may contain "Sorted Ascending/Descending"
          // baked into header names. Strip that suffix on load and
          // remap row keys so downstream column lookups work without
          // requiring a fresh paste.
          const cleanHeader = (h) => String(h || '')
            .replace(/\s*[▲▼↑↓]\s*$/, '')
            .replace(/\s*sorted\s+(ascending|descending)\s*$/i, '')
            .trim();
          const cleaned = saved.headers.map(cleanHeader);
          const needsRemap = cleaned.some((h, i) => h !== saved.headers[i]);
          if (needsRemap) {
            const rows = saved.rows.map(r => {
              const next = {};
              saved.headers.forEach((h, i) => { next[cleaned[i] || h] = r[h]; });
              return next;
            });
            setData({ headers: cleaned, rows });
          } else {
            setData({ headers: saved.headers, rows: saved.rows });
          }
        }
        // Prefs in a separate key so Clear can wipe data without losing
        // column widths or visibility.
        const prefs = await dbGet(STORE, PREFS_KEY);
        if (!cancelled && prefs) {
          if (prefs.colWidths) setColWidths(prefs.colWidths);
          if (prefs.hiddenCols) setHiddenCols(prefs.hiddenCols);
        }
        // Back-compat: if prefs are still embedded in the legacy
        // combined record, lift them out.
        if (!cancelled && !prefs && saved) {
          if (saved.colWidths) setColWidths(saved.colWidths);
          if (saved.hiddenCols) setHiddenCols(saved.hiddenCols);
        }
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, { headers: data.headers, rows: data.rows }, KEY).catch(err => console.warn('BFO data save failed', err));
  }, [data]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, { colWidths, hiddenCols }, PREFS_KEY).catch(err => console.warn('BFO prefs save failed', err));
  }, [colWidths, hiddenCols]);

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
      setFlash('Pasted text had no data rows.');
      window.setTimeout(() => setFlash(''), 2500);
      return;
    }
    setData(parsed);
    setFlash(`Imported ${parsed.rows.length} rows · ${parsed.headers.length} columns.`);
    window.setTimeout(() => setFlash(''), 2500);
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
    if (!confirm('Clear all BFO activity data?')) return;
    setData({ headers: [], rows: [] });
    dbDelete(STORE, KEY).catch(() => {});
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
    a.download = `bfo-activity-${new Date().toISOString().slice(0, 10)}.csv`;
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
    <div className={styles.wrapper} onPaste={handlePagePaste}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>BFO Activity</h1>
          <span className={styles.subtitle}>
            Paste rows from BFO (⌘V / Ctrl+V) anywhere on this page. First row is the header.
          </span>
        </div>
        <div className={styles.toolbar}>
          <input
            className={styles.searchInput}
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="button" className={styles.btn} onClick={() => setPasteOpen(o => !o)}>
            {pasteOpen ? 'Hide paste box' : 'Paste from BFO…'}
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
              Paste tab-separated rows from BFO. First row is treated as the header.
            </div>
            <textarea
              className={styles.pasteArea}
              rows={8}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'Account Name\tOpportunity Name\tAmount\t…\nDivco Capital\tSB - SUECO ...\tUSD 15,000.00\t…'}
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
            <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>No BFO data yet.</div>
            <div style={{ fontSize: 'var(--font-size-xs)' }}>
              Select your BFO Activity rows (including the header), copy, then paste anywhere on this page. We'll auto-detect columns and render a sortable table. The data persists in your browser until you clear or replace it.
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
                        const classes = [
                          isAge ? ageClass(v) : '',
                          (isAge || isAmount) ? styles.nowrapCell : '',
                        ].filter(Boolean).join(' ');
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
