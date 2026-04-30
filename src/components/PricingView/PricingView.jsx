import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import styles from './PricingView.module.css';
import { parsePricingWorkbook, priceFromCostAndGm } from '../../utils/pricingParse';
import { dbGet, dbPut, dbDelete } from '../../utils/db';

// Local-draft text input keyed off the upstream value. The parent
// remounts the input (via React's `key` prop on the wrapping cell)
// whenever it wants to reset the draft — so this component never has
// to sync internal state to props at runtime.
function GmInput({ initialPct, placeholder, title, isOverride, onCommit }) {
  const initial = initialPct === null || initialPct === undefined ? '' : String(+initialPct.toFixed(2));
  const [draft, setDraft] = useState(initial);
  return (
    <input
      className={`${styles.cellInput} ${isOverride ? styles.overridden : ''}`}
      type="text"
      placeholder={placeholder}
      value={draft}
      title={title}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(initial); e.currentTarget.blur(); }
      }}
    />
  );
}

const STORE = 'pricing-cache';
const KEY = 'current';

const fmtMoney = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
};

const fmtPct = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return `${(n * 100).toFixed(1)}%`;
};

function parsePctInput(s) {
  if (s === '' || s === null || s === undefined) return null;
  const n = Number(String(s).replace('%', '').trim());
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

export function PricingView() {
  const [workbook, setWorkbook] = useState(null); // { fileName, options, sheetNames, loadedAt }
  const [globalGmPct, setGlobalGmPct] = useState(0.6);
  const [overrides, setOverrides] = useState({}); // { [itemId]: { gmPct } }
  const [collapsed, setCollapsed] = useState({}); // { [optionNumber]: bool }
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const hydratedRef = useRef(false);

  // Hydrate from IndexedDB on first mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await dbGet(STORE, KEY);
        if (cancelled || !saved) { hydratedRef.current = true; return; }
        if (saved.workbook) setWorkbook(saved.workbook);
        if (typeof saved.globalGmPct === 'number') setGlobalGmPct(saved.globalGmPct);
        if (saved.overrides) setOverrides(saved.overrides);
        if (saved.collapsed) setCollapsed(saved.collapsed);
      } catch (err) {
        console.warn('Failed to load pricing cache:', err);
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist on changes (skip the first render until hydration finishes).
  useEffect(() => {
    if (!hydratedRef.current) return;
    const payload = { workbook, globalGmPct, overrides, collapsed };
    dbPut(STORE, payload, KEY).catch(err => console.warn('Failed to save pricing cache:', err));
  }, [workbook, globalGmPct, overrides, collapsed]);

  async function handleFile(file) {
    setError('');
    try {
      const buf = await file.arrayBuffer();
      const parsed = parsePricingWorkbook(buf);
      setWorkbook({
        fileName: file.name,
        options: parsed.options,
        sheetNames: parsed.sheetNames,
        loadedAt: Date.now(),
      });
      setOverrides({});
      setCollapsed({});
    } catch (err) {
      setError(err?.message || 'Failed to parse file.');
    }
  }

  function clearAll() {
    if (!confirm('Clear the loaded workbook and all markup overrides?')) return;
    setWorkbook(null);
    setOverrides({});
    setCollapsed({});
    setError('');
    dbDelete(STORE, KEY).catch(() => {});
  }

  function setItemGm(itemId, raw) {
    const next = { ...overrides };
    const parsed = parsePctInput(raw);
    if (parsed === null) {
      // Empty -> remove override (revert to global / sheet GM%).
      delete next[itemId];
    } else {
      next[itemId] = { ...next[itemId], gmPct: parsed };
    }
    setOverrides(next);
  }

  function effectiveGm(item) {
    const ov = overrides[item.id];
    if (ov && typeof ov.gmPct === 'number') return { gm: ov.gmPct, source: 'override' };
    if (typeof globalGmPct === 'number') return { gm: globalGmPct, source: 'global' };
    if (typeof item.gmPct === 'number') return { gm: item.gmPct, source: 'sheet' };
    return { gm: null, source: 'none' };
  }

  function exportCsv() {
    if (!workbook) return;
    const rows = [['Option', 'Section', 'Description', 'Type', 'Cost to Serve', 'Effective GM%', 'GM Source', 'Marked-up Price', 'Comments']];
    for (const opt of workbook.options) {
      for (const sec of opt.sections) {
        for (const item of sec.items) {
          const { gm, source } = effectiveGm(item);
          const price = priceFromCostAndGm(item.cost ?? null, gm);
          rows.push([
            opt.sheetName,
            sec.title,
            item.description || '',
            item.type || '',
            item.cost ?? '',
            gm === null ? '' : (gm * 100).toFixed(2),
            source,
            price === null ? '' : price.toFixed(2),
            item.comments || '',
          ]);
        }
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pricing');
    XLSX.writeFile(wb, `pricing-markup-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const totals = useMemo(() => {
    if (!workbook) return null;
    const perOption = {};
    for (const opt of workbook.options) {
      let cost = 0, price = 0;
      for (const sec of opt.sections) {
        for (const item of sec.items) {
          if (typeof item.cost === 'number') cost += item.cost;
          const { gm } = effectiveGm(item);
          const p = priceFromCostAndGm(item.cost ?? null, gm);
          if (typeof p === 'number') price += p;
        }
      }
      perOption[opt.optionNumber] = { cost, price };
    }
    return perOption;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workbook, overrides, globalGmPct]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Pricing</h1>
          <span className={styles.subtitle}>
            Upload a fee workbook to pull cost data from its Option 1 / 2 / 3 / 4 sheets and apply markup.
          </span>
        </div>

        <div className={styles.toolbar}>
          <label className={styles.gmField}>
            Global GM%
            <input
              className={styles.gmInput}
              type="number"
              step="1"
              min="0"
              max="99"
              value={Math.round(globalGmPct * 1000) / 10}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                setGlobalGmPct(Math.max(0, Math.min(0.99, n / 100)));
              }}
            />
            <span>%</span>
          </label>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.xlsm"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
          <button className={styles.uploadBtn} onClick={() => fileInputRef.current?.click()}>
            {workbook ? 'Replace file' : 'Upload workbook'}
          </button>

          {workbook && (
            <>
              <button className={styles.actionBtn} onClick={exportCsv}>Export</button>
              <button className={styles.actionBtnDanger} onClick={clearAll}>Clear</button>
            </>
          )}
        </div>
      </div>

      {workbook && (
        <div style={{ padding: '0 1.25rem 0.5rem' }} className={styles.fileMeta}>
          <strong>{workbook.fileName}</strong>
          {' · '}
          {workbook.options.length} option sheet{workbook.options.length === 1 ? '' : 's'} found
          {workbook.sheetNames?.length ? ` · sheets: ${workbook.sheetNames.join(', ')}` : ''}
        </div>
      )}

      {error && (
        <div style={{ margin: '0 1.25rem 0.5rem', color: '#b91c1c' }}>{error}</div>
      )}

      <div className={styles.body}>
        {!workbook && (
          <div className={styles.empty}>
            <div>No workbook loaded.</div>
            <div style={{ fontSize: 'var(--font-size-xs)' }}>
              Click <strong>Upload workbook</strong> above. We'll read every sheet named "Option 1" through "Option 4" — including hidden ones — and pull each section's line items into the table below. Set a global GM% (gross margin) to apply across all rows, or override individual line items.
            </div>
          </div>
        )}

        {workbook?.options.map(opt => {
          const isCollapsed = !!collapsed[opt.optionNumber];
          const t = totals?.[opt.optionNumber];
          return (
            <div key={opt.sheetName} className={styles.optionCard}>
              <div
                className={styles.optionHeader}
                onClick={() => setCollapsed(c => ({ ...c, [opt.optionNumber]: !c[opt.optionNumber] }))}
              >
                <div className={styles.optionHeaderLeft}>
                  <h2 className={styles.optionTitle}>
                    {isCollapsed ? '▸' : '▾'} {opt.sheetName}
                  </h2>
                  {opt.hidden && <span className={styles.hiddenPill}>hidden in workbook</span>}
                  {opt.solutionDescription && (
                    <span className={styles.optionMeta}>· {opt.solutionDescription}</span>
                  )}
                </div>
                {t && (
                  <div className={styles.optionSummary}>
                    <span>Cost: <span className={styles.summaryNum}>{fmtMoney(t.cost)}</span></span>
                    <span>Marked-up: <span className={styles.summaryNum}>{fmtMoney(t.price)}</span></span>
                  </div>
                )}
              </div>

              {!isCollapsed && (
                <div className={styles.optionBody}>
                  {opt.solutionDescription && (
                    <div className={styles.solutionDesc}>{opt.solutionDescription}</div>
                  )}
                  {opt.sections.length === 0 && (
                    <div style={{ fontStyle: 'italic', color: 'var(--color-text-muted)' }}>
                      No line items detected on this sheet.
                    </div>
                  )}
                  {opt.sections.map((sec, sIdx) => (
                    <div key={sIdx} className={styles.section}>
                      <h3 className={styles.sectionTitle}>{sec.title}</h3>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Description</th>
                            <th>Type</th>
                            <th className={styles.numCell}>Cost to Serve</th>
                            <th className={styles.gmCell}>GM%</th>
                            <th className={styles.priceCell}>Marked-up Price</th>
                            <th>Comments</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sec.items.map(item => {
                            const { gm, source } = effectiveGm(item);
                            const price = priceFromCostAndGm(item.cost ?? null, gm);
                            const overrideVal = overrides[item.id]?.gmPct;
                            return (
                              <tr key={item.id}>
                                <td>{item.description}</td>
                                <td>{item.type || ''}</td>
                                <td className={styles.numCell}>{item.cost === null || item.cost === undefined ? '' : fmtMoney(item.cost)}</td>
                                <td className={styles.gmCell}>
                                  <GmInput
                                    key={`${item.id}:${overrideVal === undefined ? 'unset' : overrideVal}`}
                                    initialPct={overrideVal !== undefined ? overrideVal * 100 : null}
                                    isOverride={overrideVal !== undefined}
                                    placeholder={gm === null ? '' : `${(gm * 100).toFixed(1)}${source === 'override' ? '' : ` (${source[0]})`}`}
                                    title={
                                      source === 'override'
                                        ? 'Per-line override. Clear to revert to global GM%.'
                                        : source === 'global'
                                        ? `Using global GM% (${fmtPct(globalGmPct)}). Type a value to override.`
                                        : source === 'sheet'
                                        ? `Using sheet GM% (${fmtPct(item.gmPct)}). Type a value to override.`
                                        : 'No GM% set.'
                                    }
                                    onCommit={(raw) => setItemGm(item.id, raw)}
                                  />
                                </td>
                                <td className={styles.priceCell}>{fmtMoney(price)}</td>
                                <td>{item.comments || ''}</td>
                              </tr>
                            );
                          })}
                          <tr className={styles.totalsRow}>
                            <td colSpan={2}>Section subtotal</td>
                            <td className={styles.numCell}>
                              {fmtMoney(sec.items.reduce((s, i) => s + (typeof i.cost === 'number' ? i.cost : 0), 0))}
                            </td>
                            <td />
                            <td className={styles.priceCell}>
                              {fmtMoney(sec.items.reduce((s, i) => {
                                const { gm } = effectiveGm(i);
                                const p = priceFromCostAndGm(i.cost ?? null, gm);
                                return s + (typeof p === 'number' ? p : 0);
                              }, 0))}
                            </td>
                            <td />
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
