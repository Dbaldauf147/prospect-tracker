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
// Bump this whenever the parser output shape changes — older cached
// parses are silently discarded on hydration so the user re-uploads
// against the current parser.
const PARSER_VERSION = 8;

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
  const [globalGmPct, setGlobalGmPct] = useState(0.5);
  const [overrides, setOverrides] = useState({}); // { [itemId]: { gmPct } }
  const [activeOption, setActiveOption] = useState(null); // optionNumber or null
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
        // Drop caches written by an older parser — their workbook
        // shape may not match what the UI now expects.
        if (saved.parserVersion !== PARSER_VERSION) {
          await dbDelete(STORE, KEY).catch(() => {});
          hydratedRef.current = true;
          return;
        }
        if (saved.workbook) setWorkbook(saved.workbook);
        if (typeof saved.globalGmPct === 'number') setGlobalGmPct(saved.globalGmPct);
        if (saved.overrides) setOverrides(saved.overrides);
        if (typeof saved.activeOption === 'number') setActiveOption(saved.activeOption);
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
    const payload = { parserVersion: PARSER_VERSION, workbook, globalGmPct, overrides, activeOption };
    dbPut(STORE, payload, KEY).catch(err => console.warn('Failed to save pricing cache:', err));
  }, [workbook, globalGmPct, overrides, activeOption]);

  // Keep activeOption pointing at a real tab whenever the workbook changes.
  useEffect(() => {
    if (!workbook?.options?.length) return;
    const exists = workbook.options.some(o => o.optionNumber === activeOption);
    if (!exists) setActiveOption(workbook.options[0].optionNumber);
  }, [workbook, activeOption]);

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
      setActiveOption(parsed.options[0]?.optionNumber ?? null);
    } catch (err) {
      setError(err?.message || 'Failed to parse file.');
    }
  }

  function clearAll() {
    if (!confirm('Clear the loaded workbook and all markup overrides?')) return;
    setWorkbook(null);
    setOverrides({});
    setActiveOption(null);
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

  function priceFor(item) {
    const { gm, source } = effectiveGm(item);
    const price = priceFromCostAndGm(item.cts ?? null, gm);
    return { gm, source, price };
  }

  function exportCsv() {
    if (!workbook) return;
    const rows = [['Option', 'Section', 'Line Item', 'Type', 'CTS', 'Start Month', 'Comments', 'Effective GM%', 'GM Source', 'Marked-up Price']];
    for (const opt of workbook.options) {
      for (const sec of opt.sections) {
        for (const item of sec.items) {
          const { gm, source, price } = priceFor(item);
          rows.push([
            opt.sheetName,
            sec.title,
            item.description || '',
            item.type || '',
            item.cts ?? '',
            item.startMonth || '',
            item.comments || '',
            gm === null ? '' : (gm * 100).toFixed(2),
            source,
            price === null ? '' : price.toFixed(2),
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
          const { price: p } = priceFor(item);
          if (typeof item.cts === 'number') cost += item.cts;
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
              Click <strong>Upload workbook</strong> above. We'll read every sheet named "Option 1" through "Option 4" — including hidden ones — and pull line items from the section bounded by <strong>Delivery Team Inputs</strong> at the top and <strong>Cost Summary</strong> at the bottom. Set a global GM% (gross margin) to apply across all rows, or override individual line items.
            </div>
          </div>
        )}

        {workbook && workbook.options.length > 0 && (() => {
          const opt = workbook.options.find(o => o.optionNumber === activeOption) || workbook.options[0];
          const t = totals?.[opt.optionNumber];
          return (
            <>
              <div className={styles.tabStrip}>
                {workbook.options.map(o => {
                  const isActive = o.optionNumber === opt.optionNumber;
                  const tt = totals?.[o.optionNumber];
                  return (
                    <button
                      key={o.sheetName}
                      type="button"
                      className={isActive ? styles.tabActive : styles.tab}
                      onClick={() => setActiveOption(o.optionNumber)}
                      title={o.solutionDescription || o.sheetName}
                    >
                      <span className={styles.tabLabel}>{o.sheetName}</span>
                      {o.hidden && <span className={styles.tabHidden} title="Hidden in source workbook">·</span>}
                      {tt && typeof tt.price === 'number' && tt.price > 0 && (
                        <span className={styles.tabPrice}>{fmtMoney(tt.price)}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className={styles.optionPanel}>
                <div className={styles.optionPanelHeader}>
                  <div className={styles.optionHeaderLeft}>
                    <h2 className={styles.optionTitle}>{opt.sheetName}</h2>
                    {opt.hidden && <span className={styles.hiddenPill}>hidden in workbook</span>}
                  </div>
                  {t && (
                    <div className={styles.optionSummary}>
                      <span>Cost: <span className={styles.summaryNum}>{fmtMoney(t.cost)}</span></span>
                      <span>Marked-up: <span className={styles.summaryNum}>{fmtMoney(t.price)}</span></span>
                    </div>
                  )}
                </div>

                {opt.solutionDescription && (
                  <div className={styles.solutionDesc}>{opt.solutionDescription}</div>
                )}
                {opt.sections.length === 0 && (
                  <div className={styles.diagnostic}>
                    <div style={{ fontWeight: 600, marginBottom: '0.4rem' }}>
                      No line items detected on this sheet.
                    </div>
                    <div style={{ marginBottom: '0.5rem' }}>
                      The parser skips the first 18 rows of metadata, then looks for tables whose header row contains <em>Line Item + Type + CTS</em> (Cost to Serve), stopping at <em>Cost Summary</em>. Below are the {opt.rawSample?.length || 0} rows we read inside that range on <strong>{opt.sheetName}</strong>; if you can spot the line-item table here, share a screenshot of the relevant rows and I'll tune the detection.
                    </div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
                      Cells in sheet: {opt.cellCount ?? '?'} ·
                      Range: {opt.refUsed || '(none)'} ·
                      Total rows read: {opt.totalRows ?? '?'} ·
                      Cost Summary row: {opt.endIdx >= 0 ? opt.endIdx + 1 : 'not found'}
                    </div>
                    <div className={styles.rawScroll}>
                      <table className={styles.rawTable}>
                        <tbody>
                          {(opt.rawSample || []).map((row, ri) => (
                            <tr key={ri}>
                              <td className={styles.rawIdx}>{(opt.rawSampleOffset ?? 0) + ri + 1}</td>
                              {row.map((cell, ci) => (
                                <td key={ci}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {opt.sections.map((sec, sIdx) => {
                  const subtotalCost = sec.items.reduce((s, i) => s + (typeof i.cts === 'number' ? i.cts : 0), 0);
                  const subtotalPrice = sec.items.reduce((s, i) => {
                    const { price } = priceFor(i);
                    return s + (typeof price === 'number' ? price : 0);
                  }, 0);
                  return (
                    <div key={sIdx} className={styles.section}>
                      <h3 className={styles.sectionTitle}>{sec.title}</h3>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Line Item</th>
                            <th>Type</th>
                            <th className={styles.numCell}>CTS</th>
                            <th>Start Month</th>
                            <th>Comments</th>
                            <th className={styles.gmCell}>GM%</th>
                            <th className={styles.priceCell}>Marked-up Price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sec.items.map(item => {
                            const { gm, source, price } = priceFor(item);
                            const overrideVal = overrides[item.id]?.gmPct;
                            return (
                              <tr key={item.id}>
                                <td>{item.description}</td>
                                <td>{item.type || ''}</td>
                                <td className={styles.numCell}>{item.cts === null || item.cts === undefined ? '' : fmtMoney(item.cts)}</td>
                                <td>{item.startMonth || ''}</td>
                                <td>{item.comments || ''}</td>
                                <td className={styles.gmCell}>
                                  <GmInput
                                    key={`${item.id}:${overrideVal === undefined ? 'unset' : overrideVal}`}
                                    initialPct={overrideVal !== undefined ? overrideVal * 100 : null}
                                    isOverride={overrideVal !== undefined}
                                    placeholder={gm === null ? '' : `${Math.round(gm * 100)}%`}
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
                              </tr>
                            );
                          })}
                          <tr className={styles.totalsRow}>
                            <td colSpan={2}>Section subtotal</td>
                            <td className={styles.numCell}>{fmtMoney(subtotalCost)}</td>
                            <td colSpan={3} />
                            <td className={styles.priceCell}>{fmtMoney(subtotalPrice)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}
