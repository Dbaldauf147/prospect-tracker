import { useState } from 'react';
import styles from './OptionsTab.module.css';

const TYPE_OPTIONS = ['Setup', 'One Time', 'Recurring (monthly)'];
const UNIT_OPTIONS = ['Per Site', 'Per Account', 'Per Meter', 'Per User', 'Fixed'];
const MAX_YEARS = 5;
const EMPTY_ROW = () => ({
  feeSchedule: '', type: '', fee: '', unit: '', unitCount: '', startMonth: '',
});

function emptyOption(idx) {
  return {
    name: `Option ${idx + 1}`,
    years: 3,
    escPct: 4,
    rows: Array.from({ length: 12 }, EMPTY_ROW),
  };
}

const fmtMoneyWhole = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};

const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,\s%]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// Months a row is billed inside the requested year (1-indexed),
// honoring the contract length. One-time and Setup hit a single
// month (the start month); Recurring bills every month from start
// through the end of the contract.
function activeMonthsInYear(row, yearIdx, termYears) {
  const fee = toNum(row.fee);
  const uc = toNum(row.unitCount);
  if (fee == null || uc == null) return 0;
  const startMonth = toNum(row.startMonth);
  if (startMonth == null || startMonth < 1) return 0;
  const lastMonth = termYears * 12;
  if (startMonth > lastMonth) return 0;
  const yStart = (yearIdx - 1) * 12 + 1;
  const yEnd = yearIdx * 12;
  const t = (row.type || '').toLowerCase();
  if (t.startsWith('recurring')) {
    const billStart = Math.max(yStart, startMonth);
    const billEnd = Math.min(yEnd, lastMonth);
    return billEnd >= billStart ? billEnd - billStart + 1 : 0;
  }
  // Setup / One Time -> single hit at startMonth
  return startMonth >= yStart && startMonth <= yEnd ? 1 : 0;
}

// Per-year revenue for a single row, applying the annual escalator
// to the year the revenue is collected in (Year 1 = base).
function rowYearRevenue(row, yearIdx, termYears, escPct) {
  const months = activeMonthsInYear(row, yearIdx, termYears);
  if (!months) return 0;
  const fee = toNum(row.fee) || 0;
  const uc = toNum(row.unitCount) || 0;
  const esc = Math.pow(1 + (escPct || 0) / 100, yearIdx - 1);
  return fee * uc * months * esc;
}

// Parse tab- or comma-separated text from Excel into rows.
function parseRowsFromText(text) {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const cols = line.includes('\t') ? line.split('\t') : line.split(/\s*,\s*/);
    const cell = (i) => (cols[i] ?? '').trim();
    out.push({
      feeSchedule: cell(0),
      type: cell(1),
      fee: cell(2),
      unit: cell(3),
      unitCount: cell(4),
      startMonth: cell(5),
    });
  }
  return out;
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

function OptionPanel({ opt, onChange }) {
  const [flash, setFlash] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const termYears = Math.max(1, Math.min(MAX_YEARS, Number(opt.years) || 1));
  const esc = Number(opt.escPct) || 0;

  const updateRow = (idx, key, value) => {
    const rows = opt.rows.slice();
    rows[idx] = { ...rows[idx], [key]: value };
    onChange({ ...opt, rows });
  };

  const addRow = () => onChange({ ...opt, rows: [...opt.rows, EMPTY_ROW()] });
  const removeRow = (idx) => {
    const rows = opt.rows.slice();
    rows.splice(idx, 1);
    onChange({ ...opt, rows: rows.length ? rows : [EMPTY_ROW()] });
  };

  function handleTablePaste(e) {
    const cd = e.clipboardData;
    if (!cd) return;
    const text = cd.getData('text/plain');
    if (!text) return;
    const looksTabular = text.includes('\t') || text.includes('\n');
    if (!looksTabular) return;
    e.preventDefault();
    e.stopPropagation();
    const newRows = parseRowsFromText(text);
    if (!newRows.length) return;
    // Pad to at least 12 rows so the empty tan area mimics Excel.
    const padded = newRows.length < 12
      ? newRows.concat(Array.from({ length: 12 - newRows.length }, EMPTY_ROW))
      : newRows;
    onChange({ ...opt, rows: padded });
    setFlash(`Pasted ${newRows.length} row${newRows.length === 1 ? '' : 's'}.`);
    window.setTimeout(() => setFlash(''), 2500);
  }

  const yearTotals = Array.from({ length: MAX_YEARS }, (_, i) => {
    const year = i + 1;
    if (year > termYears) return 0;
    return opt.rows.reduce((sum, r) => sum + rowYearRevenue(r, year, termYears, esc), 0);
  });

  // Term value Yn = sum of years 1..n if contract ran for n years.
  // Beyond the configured contract length, the term value is 0.
  const termValues = Array.from({ length: MAX_YEARS }, (_, i) => {
    const t = i + 1;
    if (t > termYears) return 0;
    let sum = 0;
    for (let y = 1; y <= t; y += 1) {
      sum += opt.rows.reduce((s, r) => s + rowYearRevenue(r, y, t, esc), 0);
    }
    return sum;
  });

  const setupTotal = opt.rows
    .filter(r => (r.type || '').toLowerCase() === 'setup')
    .reduce((s, r) => s + (toNum(r.fee) || 0) * (toNum(r.unitCount) || 0), 0);

  return (
    <div className={styles.optionPanel} onPaste={handleTablePaste}>
      <div className={styles.optHeader}>
        <input
          className={styles.optName}
          value={opt.name}
          onChange={(e) => onChange({ ...opt, name: e.target.value })}
          placeholder="Option name"
        />
        <label className={styles.miniField}>
          Years
          <input
            type="number"
            min={1}
            max={MAX_YEARS}
            value={opt.years}
            onChange={(e) => onChange({ ...opt, years: Number(e.target.value) || 1 })}
          />
        </label>
        <label className={styles.miniField}>
          Esc %
          <input
            type="number"
            step="0.1"
            value={opt.escPct}
            onChange={(e) => onChange({ ...opt, escPct: Number(e.target.value) || 0 })}
          />
        </label>
        <button type="button" className={styles.btn} onClick={() => setPasteOpen(o => !o)}>
          {pasteOpen ? 'Close paste' : 'Paste from Excel'}
        </button>
        <button type="button" className={styles.btn} onClick={addRow}>+ Row</button>
        {flash && <span className={styles.flash}>{flash}</span>}
      </div>

      {pasteOpen && (
        <div className={styles.pasteBox}>
          <div className={styles.pasteHint}>
            Tab-separated rows: Fee Schedule · Type · Fee · Unit · Est. Unit Count · Fee Start Month.
            You can also just click into the table and paste — multi-row clipboard data is auto-detected.
          </div>
          <textarea
            className={styles.pasteArea}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'BPS Per Site Year 1\tOne Time\t$850.00\tPer Site\t26\t1\nBenchmarking\tRecurring (monthly)\t$50.00\tPer Site\t51\t1'}
            rows={5}
          />
          <div className={styles.pasteActions}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                const newRows = parseRowsFromText(pasteText);
                if (!newRows.length) return;
                const padded = newRows.length < 12
                  ? newRows.concat(Array.from({ length: 12 - newRows.length }, EMPTY_ROW))
                  : newRows;
                onChange({ ...opt, rows: padded });
                setPasteText('');
                setPasteOpen(false);
                setFlash(`Pasted ${newRows.length} row${newRows.length === 1 ? '' : 's'}.`);
                window.setTimeout(() => setFlash(''), 2500);
              }}
            >
              Replace rows
            </button>
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
              <th className={styles.colInput}>Fee Schedule</th>
              <th className={styles.colInput}>Type</th>
              <th className={`${styles.colInput} ${styles.numCell}`}>Fee</th>
              <th className={styles.colInput}>Unit</th>
              <th className={`${styles.colInput} ${styles.numCell}`}>Est. Unit Count</th>
              <th className={`${styles.colInput} ${styles.numCell}`}>Fee Start Month</th>
              {Array.from({ length: MAX_YEARS }, (_, i) => (
                <th key={`yh-${i}`} className={`${styles.colCalc} ${styles.numCell}`}>{`Year ${i + 1}`}</th>
              ))}
              <th className={styles.actionCol} />
            </tr>
          </thead>
          <tbody>
            {opt.rows.map((row, idx) => {
              const yearVals = Array.from({ length: MAX_YEARS }, (_, i) =>
                rowYearRevenue(row, i + 1, termYears, esc)
              );
              const rowKey = `${idx}-${row.feeSchedule}-${row.type}-${row.fee}-${row.unit}-${row.unitCount}-${row.startMonth}`;
              const startMonthEmpty = !row.startMonth && row.startMonth !== 0;
              return (
                <tr key={idx}>
                  <td className={styles.tan}>
                    <CellInput key={`fs-${rowKey}`} value={row.feeSchedule} onCommit={(v) => updateRow(idx, 'feeSchedule', v)} />
                  </td>
                  <td className={styles.tan}>
                    <select
                      className={styles.input}
                      value={row.type || ''}
                      onChange={(e) => updateRow(idx, 'type', e.target.value)}
                    >
                      <option value="">—</option>
                      {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className={`${styles.tan} ${styles.numCell}`}>
                    <CellInput
                      key={`fee-${rowKey}`}
                      value={row.fee !== '' && row.fee != null && !Number.isNaN(toNum(row.fee))
                        ? `$${(toNum(row.fee) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : (row.fee ?? '')}
                      align="right"
                      onCommit={(v) => updateRow(idx, 'fee', v)}
                    />
                  </td>
                  <td className={styles.tan}>
                    <select
                      className={styles.input}
                      value={row.unit || ''}
                      onChange={(e) => updateRow(idx, 'unit', e.target.value)}
                    >
                      <option value="">—</option>
                      {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                      {row.unit && !UNIT_OPTIONS.includes(row.unit) && (
                        <option value={row.unit}>{row.unit}</option>
                      )}
                    </select>
                  </td>
                  <td className={`${styles.tan} ${styles.numCell}`}>
                    <CellInput key={`uc-${rowKey}`} value={row.unitCount} align="right" onCommit={(v) => updateRow(idx, 'unitCount', v)} />
                  </td>
                  <td className={`${styles.tan} ${styles.numCell} ${startMonthEmpty && (row.feeSchedule || row.type || row.fee) ? styles.missingStart : ''}`}>
                    <CellInput key={`sm-${rowKey}`} value={row.startMonth} align="right" onCommit={(v) => updateRow(idx, 'startMonth', v)} />
                  </td>
                  {yearVals.map((v, i) => (
                    <td key={`yv-${idx}-${i}`} className={`${styles.calc} ${styles.numCell}`}>
                      {v ? fmtMoneyWhole(v) : '$0'}
                    </td>
                  ))}
                  <td className={styles.actionCell}>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => removeRow(idx)}
                      title="Remove row"
                    >×</button>
                  </td>
                </tr>
              );
            })}
            <tr className={styles.totalsRow}>
              <td colSpan={6} style={{ textAlign: 'right' }}>Year totals</td>
              {yearTotals.map((v, i) => (
                <td key={`yt-${i}`} className={styles.numCell}>{fmtMoneyWhole(v)}</td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <div className={styles.summary}>
        <div className={styles.summaryBlock}>
          <div className={styles.summaryHeader}>Total Contract Value</div>
          <table className={styles.summaryTable}>
            <tbody>
              {termValues.map((v, i) => {
                const t = i + 1;
                return (
                  <tr key={`tv-${i}`} className={t > termYears ? styles.dim : ''}>
                    <td>Year {t}</td>
                    <td className={styles.numCell}>{fmtMoneyWhole(v)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={styles.summaryBlock}>
          <div className={styles.summaryHeader}>Setup &amp; Year Breakdown</div>
          <table className={styles.summaryTable}>
            <tbody>
              <tr>
                <td>Setup</td>
                <td className={styles.numCell}>{fmtMoneyWhole(setupTotal)}</td>
              </tr>
              {Array.from({ length: termYears }, (_, i) => (
                <tr key={`yb-${i}`}>
                  <td>Year {i + 1}</td>
                  <td className={styles.numCell}>{fmtMoneyWhole(yearTotals[i] || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function OptionsTab({ options, setOptions }) {
  const list = options && options.length ? options : [emptyOption(0)];
  const [activeIdx, setActiveIdx] = useState(0);
  const safeIdx = Math.min(activeIdx, list.length - 1);
  const opt = list[safeIdx];

  const updateOpt = (next) => {
    const copy = list.slice();
    copy[safeIdx] = next;
    setOptions(copy);
  };

  const addOption = () => {
    const next = [...list, emptyOption(list.length)];
    setOptions(next);
    setActiveIdx(next.length - 1);
  };

  const removeOption = (idx) => {
    if (list.length <= 1) {
      setOptions([emptyOption(0)]);
      setActiveIdx(0);
      return;
    }
    const next = list.slice();
    next.splice(idx, 1);
    setOptions(next);
    if (safeIdx >= next.length) setActiveIdx(next.length - 1);
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.intro}>
        Build pricing scenarios in an Excel-style grid. Edit the tan input cells, or paste a
        block from Excel — Year 1–{MAX_YEARS} revenue, Total Contract Value, and the Setup /
        Year breakdown all recompute automatically.
      </div>
      <div className={styles.optTabStrip}>
        {list.map((o, i) => (
          <button
            key={i}
            type="button"
            className={i === safeIdx ? styles.optTabActive : styles.optTab}
            onClick={() => setActiveIdx(i)}
          >
            <span>{o.name || `Option ${i + 1}`}</span>
            {list.length > 1 && (
              <span
                className={styles.optTabClose}
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); removeOption(i); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); removeOption(i); } }}
                title="Remove option"
              >×</span>
            )}
          </button>
        ))}
        <button type="button" className={styles.optAddBtn} onClick={addOption}>+ Option</button>
      </div>
      <OptionPanel opt={opt} onChange={updateOpt} />
    </div>
  );
}

