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

function parseTSV(text) {
  if (!text) return { headers: [], rows: [] };
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(l => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const split = (line) => line.split('\t');
  const rawHeaders = split(lines[0]).map(h => h.trim());
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
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await dbGet(STORE, KEY);
        if (cancelled) return;
        if (saved && saved.headers && saved.rows) setData(saved);
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, data, KEY).catch(err => console.warn('BFO save failed', err));
  }, [data]);

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
              {filtered.length} of {data.rows.length} rows{search ? ` matching "${search}"` : ''} · {data.headers.length} columns
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {data.headers.map(h => {
                      const isSorted = sortBy?.col === h;
                      return (
                        <th key={h} onClick={() => toggleSort(h)} title="Click to sort">
                          {h}
                          {isSorted && <span className={styles.sortArrow}>{sortBy.dir === 'asc' ? '▲' : '▼'}</span>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={i}>
                      {data.headers.map(h => {
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
