import { useEffect, useRef, useState } from 'react';
import styles from './CompareTab.module.css';

// Map a workbook Option's CTS rows into the Compare tab's row shape.
// Fee Bucket pulls the row's resolved Linked To tag (per-row override
// or saved default for its Line Item + Type) so the comparison groups
// by the same buckets the Linked To page wires up. Category is the
// line item description; numeric fields are kept as numbers.
function optionToCompareRows(opt, withCombine, resolvedLinkedTo) {
  if (!opt || !Array.isArray(opt.sections)) return [];
  const rows = [];
  for (const sec of opt.sections) {
    for (const item of (sec.items || [])) {
      if (typeof item.cts !== 'number') continue;
      const linked = resolvedLinkedTo ? String(resolvedLinkedTo(item) || '').trim() : '';
      const row = {
        feeBucket: linked,
        category: item.description || '',
        type: item.type || '',
        cts: item.cts,
        startMonth: item.startMonth ?? '',
        combine: '',
      };
      if (!withCombine) delete row.combine;
      rows.push(row);
    }
  }
  return rows;
}

const TYPE_OPTIONS = ['Setup', 'One Time', 'Recurring (monthly)'];

const EMPTY_ROW = () => ({
  feeBucket: '', category: '', type: '', cts: '', startMonth: '', combine: '',
});

const fmtMoney = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};

const fmtMoneySigned = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const abs = Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  if (n > 0) return `+${abs}`;
  if (n < 0) return `−${abs}`;
  return abs;
};

const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,\s%]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const isRecurring = (t) => (t || '').toLowerCase().startsWith('recurring');
const isSetup = (t) => (t || '').toLowerCase() === 'setup';
const isOneTime = (t) => (t || '').toLowerCase() === 'one time';

// Sum per type for a list of rows. Recurring totals are monthly;
// "annual" multiplies by 12. Setup / One Time are taken at face value
// (a one-shot dollar amount, not a rate).
function summarize(rows) {
  let recurringMonthly = 0;
  let setupTotal = 0;
  let oneTimeTotal = 0;
  for (const r of rows) {
    const v = toNum(r.cts) || 0;
    if (!v) continue;
    if (isRecurring(r.type)) recurringMonthly += v;
    else if (isSetup(r.type)) setupTotal += v;
    else if (isOneTime(r.type)) oneTimeTotal += v;
  }
  return {
    recurringMonthly,
    recurringAnnual: recurringMonthly * 12,
    setupTotal,
    oneTimeTotal,
    firstYear: setupTotal + oneTimeTotal + recurringMonthly * 12,
  };
}

// Parse tab- or comma-separated text from Excel into rows. The
// 7-column layout is: Fee Bucket / Category / Type / CTS / Start Month
// / (optional CM CTS — ignored) / (optional Combine label). The 5-col
// short form drops the trailing two.
function parseRowsFromText(text, withCombine) {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const cols = line.includes('\t') ? line.split('\t') : line.split(/\s*,\s*/);
    const cell = (i) => (cols[i] ?? '').trim();
    const r = {
      feeBucket: cell(0),
      category: cell(1),
      type: cell(2),
      cts: cell(3),
      startMonth: cell(4),
      combine: '',
    };
    if (withCombine) r.combine = cell(5);
    out.push(r);
  }
  return out;
}

// Normalize a category for matching. Lowercase, collapse whitespace,
// strip trailing parens / hyphenated qualifiers so "Foo - Detail" and
// "Foo" land in the same bucket when joining the two sides.
function normalizeCategory(s) {
  if (!s) return '';
  return String(s).trim().toLowerCase().replace(/\s+/g, ' ');
}

function CellInput({ value, onCommit, align, placeholder }) {
  const initial = value == null ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  return (
    <input
      type="text"
      className={styles.input}
      style={align === 'right' ? { textAlign: 'right' } : undefined}
      value={draft}
      placeholder={placeholder || ''}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== initial) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(initial); e.currentTarget.blur(); }
      }}
    />
  );
}

function CostTable({ title, rows, onChange, onAddRow, onRemoveRow, onReplaceRows, onClear, withCombine, tone, importOptions, onImportOption }) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [flash, setFlash] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const importMenuRef = useRef(null);

  useEffect(() => {
    if (!importOpen) return;
    const handler = (e) => {
      if (importMenuRef.current && !importMenuRef.current.contains(e.target)) {
        setImportOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [importOpen]);

  function handleTablePaste(e) {
    const cd = e.clipboardData;
    if (!cd) return;
    const text = cd.getData('text/plain');
    if (!text) return;
    const looksTabular = text.includes('\t') || text.includes('\n');
    if (!looksTabular) return;
    e.preventDefault();
    e.stopPropagation();
    const newRows = parseRowsFromText(text, withCombine);
    if (!newRows.length) return;
    const padded = newRows.length < 10
      ? newRows.concat(Array.from({ length: 10 - newRows.length }, EMPTY_ROW))
      : newRows;
    onReplaceRows(padded);
    setFlash(`Pasted ${newRows.length} row${newRows.length === 1 ? '' : 's'}.`);
    window.setTimeout(() => setFlash(''), 2500);
  }

  const totals = summarize(rows);
  const cellClass = tone === 'new' ? styles.cellNew : styles.cellCurrent;

  return (
    <div className={styles.tablePanel} onPaste={handleTablePaste}>
      <div className={styles.tableHeader}>
        <div className={styles.tableTitle}>{title}</div>
        {importOptions && (
          <div className={styles.importWrap} ref={importMenuRef}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => setImportOpen(o => !o)}
              title="Replace these rows with the CTS items from a Pricing Option."
            >
              Import from Option ▾
            </button>
            {importOpen && (
              <div className={styles.importMenu}>
                {importOptions.length === 0 ? (
                  <div className={styles.importMenuEmpty}>No options loaded. Upload a workbook on the Pricing subtab.</div>
                ) : importOptions.map(opt => (
                  <button
                    key={opt.optionNumber}
                    type="button"
                    className={styles.importMenuItem}
                    onClick={() => {
                      const hasData = rows.some(r => r.feeBucket || r.category || r.type || r.cts || r.startMonth || r.combine);
                      if (hasData && !window.confirm(`Replace the rows in "${title}" with the CTS items from "${opt.sheetName}"?`)) return;
                      onImportOption(opt);
                      setImportOpen(false);
                      setFlash(`Imported from "${opt.sheetName}".`);
                      window.setTimeout(() => setFlash(''), 2500);
                    }}
                  >
                    {opt.sheetName}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button type="button" className={styles.btn} onClick={() => setPasteOpen(o => !o)}>
          {pasteOpen ? 'Close paste' : 'Paste from Excel'}
        </button>
        <button type="button" className={styles.btn} onClick={onAddRow}>+ Row</button>
        <button
          type="button"
          className={styles.btnDanger}
          onClick={() => {
            if (rows.every(r => !r.feeBucket && !r.category && !r.type && !r.cts && !r.startMonth && !r.combine)) {
              onClear();
              return;
            }
            if (window.confirm(`Clear all rows from "${title}"? This cannot be undone.`)) onClear();
          }}
        >Clear</button>
        {flash && <span className={styles.flash}>{flash}</span>}
      </div>

      {pasteOpen && (
        <div className={styles.pasteBox}>
          <div className={styles.pasteHint}>
            Tab-separated rows: Fee Bucket · CTS Category · Type · CTS · Start Month
            {withCombine ? ' · (CM CTS — optional, ignored) · Combine (optional)' : ''}.
            You can also click into the table and paste directly.
          </div>
          <textarea
            className={styles.pasteArea}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'Sourcing\tElectric Power Origination\tRecurring (monthly)\t$381.00\t1'}
            rows={5}
          />
          <div className={styles.pasteActions}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                const newRows = parseRowsFromText(pasteText, withCombine);
                if (!newRows.length) return;
                const padded = newRows.length < 10
                  ? newRows.concat(Array.from({ length: 10 - newRows.length }, EMPTY_ROW))
                  : newRows;
                onReplaceRows(padded);
                setPasteText('');
                setPasteOpen(false);
                setFlash(`Pasted ${newRows.length} row${newRows.length === 1 ? '' : 's'}.`);
                window.setTimeout(() => setFlash(''), 2500);
              }}
            >Replace rows</button>
            <button type="button" className={styles.btn} onClick={() => { setPasteText(''); setPasteOpen(false); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className={styles.gridWrap}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th className={styles.colBucket}>Fee Bucket</th>
              <th className={styles.colCategory}>CTS Category</th>
              <th className={styles.colType}>Type</th>
              <th className={`${styles.colCts} ${styles.numCell}`}>CTS</th>
              <th className={`${styles.colStart} ${styles.numCell}`}>Start Month</th>
              {withCombine && <th className={styles.colCombine}>Combine</th>}
              <th className={styles.actionCol} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const k = `${idx}-${row.feeBucket}-${row.category}-${row.type}-${row.cts}-${row.startMonth}-${row.combine}`;
              return (
                <tr key={idx}>
                  <td className={cellClass}>
                    <CellInput key={`fb-${k}`} value={row.feeBucket} onCommit={(v) => onChange(idx, 'feeBucket', v)} />
                  </td>
                  <td className={cellClass}>
                    <CellInput key={`ct-${k}`} value={row.category} onCommit={(v) => onChange(idx, 'category', v)} />
                  </td>
                  <td className={cellClass}>
                    <select
                      className={styles.input}
                      value={row.type || ''}
                      onChange={(e) => onChange(idx, 'type', e.target.value)}
                    >
                      <option value="">—</option>
                      {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                      {row.type && !TYPE_OPTIONS.includes(row.type) && (
                        <option value={row.type}>{row.type}</option>
                      )}
                    </select>
                  </td>
                  <td className={`${cellClass} ${styles.numCell}`}>
                    <CellInput
                      key={`cts-${k}`}
                      value={row.cts !== '' && row.cts != null && toNum(row.cts) != null
                        ? `$${(toNum(row.cts) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : (row.cts ?? '')}
                      align="right"
                      onCommit={(v) => onChange(idx, 'cts', v)}
                    />
                  </td>
                  <td className={`${cellClass} ${styles.numCell}`}>
                    <CellInput key={`sm-${k}`} value={row.startMonth} align="right" onCommit={(v) => onChange(idx, 'startMonth', v)} />
                  </td>
                  {withCombine && (
                    <td className={cellClass}>
                      <CellInput key={`cm-${k}`} value={row.combine} onCommit={(v) => onChange(idx, 'combine', v)} />
                    </td>
                  )}
                  <td className={styles.actionCell}>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => onRemoveRow(idx)}
                      title="Remove row"
                    >×</button>
                  </td>
                </tr>
              );
            })}
            <tr className={styles.totalsRow}>
              <td colSpan={3} style={{ textAlign: 'right' }}>Totals</td>
              <td className={styles.numCell}>{fmtMoney(totals.recurringMonthly)}<span className={styles.unitTag}>/mo</span></td>
              <td className={styles.numCell}>{fmtMoney(totals.setupTotal + totals.oneTimeTotal)}<span className={styles.unitTag}>setup</span></td>
              {withCombine && <td />}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CompareTab({ state, setState, workbook, resolvedLinkedTo }) {
  const importOptions = Array.isArray(workbook?.options) ? workbook.options : [];
  const safe = state && state.current && state.next
    ? state
    : {
        currentLabel: 'Current',
        nextLabel: 'New',
        current: Array.from({ length: 10 }, EMPTY_ROW),
        next: Array.from({ length: 10 }, EMPTY_ROW),
      };

  const update = (next) => setState(next);

  const updateRow = (side) => (idx, key, value) => {
    const rows = safe[side].slice();
    rows[idx] = { ...rows[idx], [key]: value };
    update({ ...safe, [side]: rows });
  };
  const addRow = (side) => () => update({ ...safe, [side]: [...safe[side], EMPTY_ROW()] });
  const removeRow = (side) => (idx) => {
    const rows = safe[side].slice();
    rows.splice(idx, 1);
    update({ ...safe, [side]: rows.length ? rows : [EMPTY_ROW()] });
  };
  const replaceRows = (side) => (rows) => update({ ...safe, [side]: rows });
  const importOption = (side) => (opt) => {
    const withCombine = side === 'next';
    const imported = optionToCompareRows(opt, withCombine, resolvedLinkedTo);
    const padded = imported.length < 10
      ? imported.concat(Array.from({ length: 10 - imported.length }, EMPTY_ROW))
      : imported;
    update({ ...safe, [side]: padded });
  };
  // Reset a side back to the empty 10-row template (mirrors the
  // initial state so totals + the per-category compare also reset).
  const clearSide = (side) => () => update({ ...safe, [side]: Array.from({ length: 10 }, EMPTY_ROW) });

  const currentTotals = summarize(safe.current);
  const nextTotals = summarize(safe.next);

  // Build a side-by-side comparison: every distinct CTS Category that
  // appears on either side becomes a row, paired with its monthly
  // recurring on each side (the dominant cost type for these tables).
  // Rows on the "new" side carrying a Combine value are bucketed
  // under that combine key on the current side.
  const compareRows = (() => {
    const byKey = new Map();
    const keyFor = (s) => normalizeCategory(s);
    const ensure = (key, displayLabel) => {
      if (!byKey.has(key)) {
        byKey.set(key, { key, label: displayLabel, oldMonthly: 0, newMonthly: 0, oldSetup: 0, newSetup: 0 });
      } else if (displayLabel && !byKey.get(key).label) {
        byKey.get(key).label = displayLabel;
      }
      return byKey.get(key);
    };
    for (const r of safe.current) {
      const cat = (r.category || '').trim();
      if (!cat) continue;
      const v = toNum(r.cts) || 0;
      const ent = ensure(keyFor(cat), cat);
      if (isRecurring(r.type)) ent.oldMonthly += v;
      else ent.oldSetup += v;
    }
    for (const r of safe.next) {
      const cat = (r.category || '').trim();
      if (!cat) continue;
      const combineKey = r.combine && r.combine.trim() ? keyFor(r.combine) : keyFor(cat);
      const v = toNum(r.cts) || 0;
      const ent = ensure(combineKey, r.combine?.trim() || cat);
      if (isRecurring(r.type)) ent.newMonthly += v;
      else ent.newSetup += v;
    }
    const list = Array.from(byKey.values()).map(e => ({
      ...e,
      deltaMonthly: e.newMonthly - e.oldMonthly,
      deltaSetup: e.newSetup - e.oldSetup,
    }));
    list.sort((a, b) => Math.abs(b.deltaMonthly) - Math.abs(a.deltaMonthly));
    return list;
  })();

  const deltaMonthly = nextTotals.recurringMonthly - currentTotals.recurringMonthly;
  const deltaSetup = (nextTotals.setupTotal + nextTotals.oneTimeTotal) - (currentTotals.setupTotal + currentTotals.oneTimeTotal);

  return (
    <div className={styles.wrapper}>
      <div className={styles.intro}>
        Compare two cost-to-serve scenarios side by side. Paste blocks from Excel into the
        Current and New tables — totals, per-category deltas, and a first-year roll-up update
        as you edit. Use the <strong>Combine</strong> column on the New side to merge multiple
        new categories into a single current-side bucket.
      </div>

      <div className={styles.labelRow}>
        <label className={styles.miniField}>
          Current label
          <input
            value={safe.currentLabel}
            onChange={(e) => update({ ...safe, currentLabel: e.target.value })}
          />
        </label>
        <label className={styles.miniField}>
          New label
          <input
            value={safe.nextLabel}
            onChange={(e) => update({ ...safe, nextLabel: e.target.value })}
          />
        </label>
      </div>

      <div className={styles.summaryStrip}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryHeader}>{safe.currentLabel}</div>
          <div className={styles.summaryGrid}>
            <div>Recurring</div><div className={styles.numCell}>{fmtMoney(currentTotals.recurringMonthly)}<span className={styles.unitTag}>/mo</span></div>
            <div>Annualized</div><div className={styles.numCell}>{fmtMoney(currentTotals.recurringAnnual)}</div>
            <div>Setup + One-time</div><div className={styles.numCell}>{fmtMoney(currentTotals.setupTotal + currentTotals.oneTimeTotal)}</div>
            <div>Year 1 total</div><div className={styles.numCell}>{fmtMoney(currentTotals.firstYear)}</div>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryHeader}>{safe.nextLabel}</div>
          <div className={styles.summaryGrid}>
            <div>Recurring</div><div className={styles.numCell}>{fmtMoney(nextTotals.recurringMonthly)}<span className={styles.unitTag}>/mo</span></div>
            <div>Annualized</div><div className={styles.numCell}>{fmtMoney(nextTotals.recurringAnnual)}</div>
            <div>Setup + One-time</div><div className={styles.numCell}>{fmtMoney(nextTotals.setupTotal + nextTotals.oneTimeTotal)}</div>
            <div>Year 1 total</div><div className={styles.numCell}>{fmtMoney(nextTotals.firstYear)}</div>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryHeader}>Delta (New − Current)</div>
          <div className={styles.summaryGrid}>
            <div>Recurring</div>
            <div className={`${styles.numCell} ${deltaMonthly > 0 ? styles.deltaUp : deltaMonthly < 0 ? styles.deltaDown : ''}`}>
              {fmtMoneySigned(deltaMonthly)}<span className={styles.unitTag}>/mo</span>
            </div>
            <div>Annualized</div>
            <div className={`${styles.numCell} ${deltaMonthly > 0 ? styles.deltaUp : deltaMonthly < 0 ? styles.deltaDown : ''}`}>
              {fmtMoneySigned(deltaMonthly * 12)}
            </div>
            <div>Setup + One-time</div>
            <div className={`${styles.numCell} ${deltaSetup > 0 ? styles.deltaUp : deltaSetup < 0 ? styles.deltaDown : ''}`}>
              {fmtMoneySigned(deltaSetup)}
            </div>
            <div>Year 1 total</div>
            <div className={`${styles.numCell} ${(nextTotals.firstYear - currentTotals.firstYear) > 0 ? styles.deltaUp : (nextTotals.firstYear - currentTotals.firstYear) < 0 ? styles.deltaDown : ''}`}>
              {fmtMoneySigned(nextTotals.firstYear - currentTotals.firstYear)}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.tablesRow}>
        <CostTable
          title={safe.currentLabel}
          tone="current"
          rows={safe.current}
          onChange={updateRow('current')}
          onAddRow={addRow('current')}
          onRemoveRow={removeRow('current')}
          onReplaceRows={replaceRows('current')}
          onClear={clearSide('current')}
          withCombine={false}
          importOptions={importOptions}
          onImportOption={importOption('current')}
        />
        <CostTable
          title={safe.nextLabel}
          tone="new"
          rows={safe.next}
          onChange={updateRow('next')}
          onAddRow={addRow('next')}
          onRemoveRow={removeRow('next')}
          onReplaceRows={replaceRows('next')}
          onClear={clearSide('next')}
          withCombine
          importOptions={importOptions}
          onImportOption={importOption('next')}
        />
      </div>

      <div className={styles.compareBlock}>
        <div className={styles.compareHeader}>
          Per-category comparison
          <span className={styles.compareHint}>
            Sorted by largest monthly delta. Categories are matched on the New side's
            Combine value when present, otherwise on CTS Category.
          </span>
        </div>
        <div className={styles.compareTableWrap}>
          <table className={styles.compareTable}>
            <thead>
              <tr>
                <th>CTS Category</th>
                <th className={styles.numCell}>{safe.currentLabel} /mo</th>
                <th className={styles.numCell}>{safe.nextLabel} /mo</th>
                <th className={styles.numCell}>Δ /mo</th>
                <th className={styles.numCell}>Δ Annual</th>
                <th className={styles.numCell}>{safe.currentLabel} Setup</th>
                <th className={styles.numCell}>{safe.nextLabel} Setup</th>
                <th className={styles.numCell}>Δ Setup</th>
              </tr>
            </thead>
            <tbody>
              {compareRows.length === 0 && (
                <tr><td colSpan={8} className={styles.empty}>Add or paste rows above to populate the comparison.</td></tr>
              )}
              {compareRows.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className={styles.numCell}>{r.oldMonthly ? fmtMoney(r.oldMonthly) : '—'}</td>
                  <td className={styles.numCell}>{r.newMonthly ? fmtMoney(r.newMonthly) : '—'}</td>
                  <td className={`${styles.numCell} ${r.deltaMonthly > 0 ? styles.deltaUp : r.deltaMonthly < 0 ? styles.deltaDown : ''}`}>
                    {r.deltaMonthly ? fmtMoneySigned(r.deltaMonthly) : '—'}
                  </td>
                  <td className={`${styles.numCell} ${r.deltaMonthly > 0 ? styles.deltaUp : r.deltaMonthly < 0 ? styles.deltaDown : ''}`}>
                    {r.deltaMonthly ? fmtMoneySigned(r.deltaMonthly * 12) : '—'}
                  </td>
                  <td className={styles.numCell}>{r.oldSetup ? fmtMoney(r.oldSetup) : '—'}</td>
                  <td className={styles.numCell}>{r.newSetup ? fmtMoney(r.newSetup) : '—'}</td>
                  <td className={`${styles.numCell} ${r.deltaSetup > 0 ? styles.deltaUp : r.deltaSetup < 0 ? styles.deltaDown : ''}`}>
                    {r.deltaSetup ? fmtMoneySigned(r.deltaSetup) : '—'}
                  </td>
                </tr>
              ))}
              {compareRows.length > 0 && (
                <tr className={styles.compareTotalsRow}>
                  <td>Totals</td>
                  <td className={styles.numCell}>{fmtMoney(currentTotals.recurringMonthly)}</td>
                  <td className={styles.numCell}>{fmtMoney(nextTotals.recurringMonthly)}</td>
                  <td className={`${styles.numCell} ${deltaMonthly > 0 ? styles.deltaUp : deltaMonthly < 0 ? styles.deltaDown : ''}`}>{fmtMoneySigned(deltaMonthly)}</td>
                  <td className={`${styles.numCell} ${deltaMonthly > 0 ? styles.deltaUp : deltaMonthly < 0 ? styles.deltaDown : ''}`}>{fmtMoneySigned(deltaMonthly * 12)}</td>
                  <td className={styles.numCell}>{fmtMoney(currentTotals.setupTotal + currentTotals.oneTimeTotal)}</td>
                  <td className={styles.numCell}>{fmtMoney(nextTotals.setupTotal + nextTotals.oneTimeTotal)}</td>
                  <td className={`${styles.numCell} ${deltaSetup > 0 ? styles.deltaUp : deltaSetup < 0 ? styles.deltaDown : ''}`}>{fmtMoneySigned(deltaSetup)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
