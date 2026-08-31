import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { dbGet } from '../../utils/db';
import {
  loadOptionLinks,
  setOppOptionLink,
  renameOptionInLinks,
  dropOptionFromLinks,
  findLinkedOppId,
  OPTION_LINKS_EVENT,
} from '../../utils/pricingOptionLinks';
import { buildPricingOptionSnapshot } from '../../utils/pricingOptionCalc';
import {
  setOppPricingSnapshot,
  clearOppPricingSnapshot,
} from '../../utils/oppsPricingSnapshot';
import { sortByCallInAsc, resolveCallIn, callInDateISO, formatDateDisplay } from '../../utils/oppsCallIn';
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

// Est. Unit Count column treats a blank entry as 1 so a row with just a
// fee still produces revenue. An explicit 0 is honored.
const unitCountOrOne = (v) => {
  const n = toNum(v);
  return n == null ? 1 : n;
};

// Months a row is billed inside the requested year (1-indexed),
// honoring the contract length. One-time and Setup hit a single
// month (the start month); Recurring bills every month from start
// through the end of the contract.
function activeMonthsInYear(row, yearIdx, termYears) {
  const fee = toNum(row.fee);
  if (fee == null) return 0;
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
  const uc = unitCountOrOne(row.unitCount);
  const esc = Math.pow(1 + (escPct || 0) / 100, yearIdx - 1);
  return fee * uc * months * esc;
}

// Revenue billed by a single row in a specific contract month
// (1-indexed, where 1..12 = Year 1). Setup / One Time hits only the
// row's start month; Recurring bills every month from its start
// through the end of the contract, with the escalator applied to the
// year the revenue lands in.
function rowMonthRevenue(row, month, termYears, escPct) {
  const fee = toNum(row.fee);
  if (fee == null) return 0;
  const uc = unitCountOrOne(row.unitCount);
  const startMonth = toNum(row.startMonth);
  if (startMonth == null || startMonth < 1) return 0;
  const lastMonth = termYears * 12;
  if (month < startMonth || month > lastMonth) return 0;
  const yearIdx = Math.ceil(month / 12);
  const esc = Math.pow(1 + (escPct || 0) / 100, yearIdx - 1);
  const t = (row.type || '').toLowerCase();
  if (t.startsWith('recurring')) return fee * uc * esc;
  return month === startMonth ? fee * uc : 0;
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

function OptionPanel({ opt, onChange, savedToLabel, onClickSave, onClearSave }) {
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
  // Reset every row and the term / escalator inputs back to defaults
  // while keeping the option's name (so the user's tab labelling
  // survives a Clear).
  const clearOption = () => onChange({
    name: opt.name,
    years: 3,
    escPct: 4,
    rows: Array.from({ length: 12 }, EMPTY_ROW),
  });

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
    .reduce((s, r) => s + (toNum(r.fee) || 0) * unitCountOrOne(r.unitCount), 0);

  // Year 1 monthly fee breakdown (12 numbers + a year-end total). Each
  // entry is the sum across every row in this option for that contract
  // month. Drives the per-month strip below the grid.
  const year1Monthly = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    return opt.rows.reduce((s, r) => s + rowMonthRevenue(r, month, termYears, esc), 0);
  });
  const year1MonthlyTotal = year1Monthly.reduce((s, v) => s + v, 0);

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
        <button type="button" className={styles.btnDanger} onClick={clearOption}>Clear</button>
        {savedToLabel ? (
          <span
            className={styles.savedChip}
            title={`Linked to Opps row: ${savedToLabel}`}
          >
            Saved to: {savedToLabel}
            <button
              type="button"
              className={styles.savedChipClear}
              onClick={onClearSave}
              title="Unlink from this Opp"
            >×</button>
          </span>
        ) : (
          <button type="button" className={styles.btn} onClick={onClickSave}>
            Save to Opp…
          </button>
        )}
        {flash && <span className={styles.flash}>{flash}</span>}
      </div>

      {pasteOpen && (
        <div className={styles.pasteBox}>
          <div className={styles.pasteHint}>
            Tab-separated rows: Fee Schedule · Type · Fee · Unit · Est. Unit Count · Fee Start Month.
            You can also just click into the table and paste: multi-row clipboard data is auto-detected.
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

      <div className={styles.gridWrap}>
        <table className={styles.grid}>
          <colgroup>
            <col className={styles.colFeeSchedule} />
            <col className={styles.colType} />
            <col className={styles.colFee} />
            <col className={styles.colUnit} />
            <col className={styles.colUnitCount} />
            <col className={styles.colStartMonth} />
            {Array.from({ length: MAX_YEARS }, (_, i) => (
              <col key={`yc-${i}`} className={styles.colYear} />
            ))}
            <col className={styles.colAction} />
          </colgroup>
          <thead>
            <tr>
              <th className={styles.colInput}>Fee Schedule</th>
              <th className={styles.colInput}>Type</th>
              <th className={styles.colInput}>Fee</th>
              <th className={styles.colInput}>Unit</th>
              <th className={styles.colInput}>Est. Unit Count</th>
              <th className={styles.colInput}>Fee Start Month</th>
              {Array.from({ length: MAX_YEARS }, (_, i) => (
                <th key={`yh-${i}`} className={styles.colCalc}>{`Year ${i + 1}`}</th>
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
                      <option value="">-</option>
                      {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className={styles.tan}>
                    <CellInput
                      key={`fee-${rowKey}`}
                      value={row.fee !== '' && row.fee != null && !Number.isNaN(toNum(row.fee))
                        ? `$${(toNum(row.fee) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : (row.fee ?? '')}
                      onCommit={(v) => updateRow(idx, 'fee', v)}
                    />
                  </td>
                  <td className={styles.tan}>
                    <select
                      className={styles.input}
                      value={row.unit || ''}
                      onChange={(e) => updateRow(idx, 'unit', e.target.value)}
                    >
                      <option value="">-</option>
                      {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                      {row.unit && !UNIT_OPTIONS.includes(row.unit) && (
                        <option value={row.unit}>{row.unit}</option>
                      )}
                    </select>
                  </td>
                  <td className={styles.tan}>
                    <CellInput key={`uc-${rowKey}`} value={row.unitCount} onCommit={(v) => updateRow(idx, 'unitCount', v)} />
                  </td>
                  <td className={`${styles.tan} ${startMonthEmpty && (row.feeSchedule || row.type || row.fee) ? styles.missingStart : ''}`}>
                    <CellInput key={`sm-${rowKey}`} value={row.startMonth} onCommit={(v) => updateRow(idx, 'startMonth', v)} />
                  </td>
                  {yearVals.map((v, i) => (
                    <td key={`yv-${idx}-${i}`} className={styles.calc}>
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
              <td colSpan={6}>Year totals</td>
              {yearTotals.map((v, i) => (
                <td key={`yt-${i}`}>{fmtMoneyWhole(v)}</td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <div className={styles.monthlyBlock}>
        <div className={styles.monthlyHeader}>Year 1 monthly total fees</div>
        <div className={styles.gridWrap}>
          <table className={styles.monthlyTable}>
            <thead>
              <tr>
                {Array.from({ length: 12 }, (_, i) => (
                  <th key={`mh-${i}`}>{`M${i + 1}`}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                {year1Monthly.map((v, i) => (
                  <td key={`mv-${i}`}>{fmtMoneyWhole(v)}</td>
                ))}
                <td className={styles.monthlyTotal}>{fmtMoneyWhole(year1MonthlyTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function OptionsTab({ options, setOptions }) {
  const { user } = useAuth();
  const list = options && options.length ? options : [emptyOption(0)];
  const [activeIdx, setActiveIdx] = useState(0);
  const safeIdx = Math.min(activeIdx, list.length - 1);
  const opt = list[safeIdx];

  // Opps 2 records (for the picker) and Option ↔ Opp link map. Loaded
  // from IndexedDB on mount and refreshed when either store fires its
  // change event so a save in another tab shows up live here too.
  const [opps2Records, setOpps2Records] = useState([]);
  const [optionLinks, setOptionLinks] = useState({});
  useEffect(() => {
    let cancelled = false;
    dbGet('opps2-cache', 'data')
      .then(val => { if (!cancelled && val && Array.isArray(val.records)) setOpps2Records(val.records); })
      .catch(() => {});
    loadOptionLinks().then(val => { if (!cancelled) setOptionLinks(val || {}); });
    const onLinks = (e) => {
      const detail = e?.detail;
      if (detail && typeof detail === 'object') { setOptionLinks(detail); return; }
      // The Firestore mirror dispatches a plain Event when it pulls a newer
      // copy of the links down at signin — no detail to read, so go and get
      // the value it just wrote.
      loadOptionLinks().then(val => { if (!cancelled) setOptionLinks(val || {}); });
    };
    window.addEventListener(OPTION_LINKS_EVENT, onLinks);
    return () => {
      cancelled = true;
      window.removeEventListener(OPTION_LINKS_EVENT, onLinks);
    };
  }, []);

  // Which opp (if any) the active option is linked to. Links are keyed
  // by opp id, but we want to display the Account name in the chip.
  const linkedOppId = useMemo(() => {
    const name = (opt?.name || '').trim();
    if (!name) return null;
    // Scoped to this subtab's links: a "Option 1" saved from the SIA
    // workbook subtab belongs to that file, not to this hand-built
    // option that happens to share the name.
    return findLinkedOppId(optionLinks, { name, source: 'options', allowLegacy: true });
  }, [opt?.name, optionLinks]);
  const linkedOpp = useMemo(() => {
    if (!linkedOppId) return null;
    return opps2Records.find(r => String(r._id) === String(linkedOppId)) || null;
  }, [linkedOppId, opps2Records]);
  const linkedLabel = linkedOpp
    ? `${linkedOpp.Account || '(no Account)'}${linkedOpp.Scope ? ` · ${linkedOpp.Scope}` : ''}`
    : (linkedOppId ? `(opp ${linkedOppId})` : null);

  // Note: the snapshot is intentionally frozen at "Save to Opp" time
  // (see `onPickOpp` below) — it doesn't auto-refresh as the user keeps
  // editing the option. The user can re-click Save to Opp to capture a
  // fresh snapshot, which guarantees the opp's saved fees survive a
  // Pricing-tab Clear or accidental row wipe.

  const updateOpt = (next) => {
    const copy = list.slice();
    copy[safeIdx] = next;
    setOptions(copy);
    // Keep the link map in sync when the user renames an option so the
    // "Pricing Option" column on Opps 2 doesn't strand on the old name.
    const prevName = (opt?.name || '').trim();
    const nextName = (next?.name || '').trim();
    if (prevName && nextName && prevName !== nextName) {
      renameOptionInLinks(prevName, nextName, { source: 'options' }).catch(() => {});
    }
  };

  const addOption = () => {
    const next = [...list, emptyOption(list.length)];
    setOptions(next);
    setActiveIdx(next.length - 1);
  };

  const removeOption = (idx) => {
    const removed = list[idx];
    if (removed?.name) dropOptionFromLinks(removed.name, { source: 'options' }).catch(() => {});
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

  const [pickerOpen, setPickerOpen] = useState(false);
  // While the snapshot is being persisted (IDB + Firestore) we keep the
  // picker open so the user can't navigate away mid-flight and miss the
  // Firestore write (which would let Opps 2's next hydration overwrite
  // the IDB snapshot with a pre-write Firestore copy).
  const [saving, setSaving] = useState(false);
  const openPicker = () => {
    if (!(opt?.name || '').trim()) {
      // Linking by name only makes sense once the option has one.
      window.alert('Give this Option a name before saving it to an Opp.');
      return;
    }
    setPickerOpen(true);
  };
  const onClearSave = async () => {
    if (!linkedOppId) return;
    try {
      await setOppOptionLink(linkedOppId, '');
      // Also drop the frozen snapshot that was saved onto the opp so the
      // Opps 2 row stops rendering the rich detail / Year 1 link.
      await clearOppPricingSnapshot(user?.uid, linkedOppId);
    } catch (err) {
      console.error('Save to Opp: clear failed', err);
    }
  };
  const onPickOpp = async (oppId) => {
    if (saving) return;
    const name = (opt?.name || '').trim();
    setSaving(true);
    try {
      await setOppOptionLink(oppId, name, { source: 'options' });
      // Freeze a self-contained copy of this option onto the opp so it
      // survives a Pricing-tab Clear. Also auto-fills Quoted Amount with
      // Year 1 total — the user can write over it later. Await both so
      // the Firestore write completes before the picker closes (and
      // before the user can navigate to Opps 2).
      if (opt) {
        const snapshot = buildPricingOptionSnapshot(opt);
        await setOppPricingSnapshot(user?.uid, oppId, snapshot);
      }
      setPickerOpen(false);
    } catch (err) {
      console.error('Save to Opp: snapshot save failed', err);
      window.alert(
        'Saved the link, but the Pricing Option snapshot failed to save to Firestore. ' +
        'Year 1 fees and the saved details may not appear on the Opp. Check your network and try again.\n\n' +
        (err?.message || String(err))
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.intro}>
        Build pricing scenarios in an Excel-style grid. Edit the tan input cells, or paste a
        block from Excel: Year 1–{MAX_YEARS} revenue, Total Contract Value, and the Setup /
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
      <OptionPanel
        opt={opt}
        onChange={updateOpt}
        savedToLabel={linkedLabel}
        onClickSave={openPicker}
        onClearSave={onClearSave}
      />
      {pickerOpen && (
        <OppPickerModal
          opps={opps2Records}
          optionName={opt?.name || ''}
          onPick={onPickOpp}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

export function OppPickerModal({ opps, optionName, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ranked = (opps || [])
      .map(r => ({
        r,
        // The picker is keyed on what the user sees in Opps 2 — Account
        // for "who", Scope/Stage for "which deal". Other fields stay
        // out of the search corpus so a typo in Notes can't pull
        // unrelated opps to the top.
        hay: `${r.Account || ''}  ${r.Scope || ''}  ${r.Stage || ''}  ${r.Source || ''}  ${r['BFO Link'] || ''}`.toLowerCase(),
      }))
      .filter(({ r, hay }) => !!(r.Account || r.Scope) && (!q || hay.includes(q)))
      .map(({ r }) => r);
    // Order the same way the Opps 2 page does — Call In ascending, so the
    // most urgent (most overdue) opps sit at the top — instead of A→Z by
    // Account. Predictive filtering above still narrows the list first.
    return sortByCallInAsc(ranked).slice(0, 200);
  }, [opps, query]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 10, padding: '1rem 1.1rem',
          width: 'min(560px, 92vw)', maxHeight: '80vh', display: 'flex',
          flexDirection: 'column', gap: '0.75rem', boxShadow: '0 20px 60px rgba(15,23,42,0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>
            Save "{optionName || 'Option'}" to an Opp
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: '1.2rem', color: '#64748b',
            }}
          >×</button>
        </div>
        <input
          autoFocus
          type="text"
          placeholder="Search Opps by Account, Scope, Stage…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            padding: '0.5rem 0.65rem', border: '1px solid var(--color-border, #cbd5e1)',
            borderRadius: 6, fontSize: '0.9rem', fontFamily: 'inherit',
          }}
        />
        <div style={{ overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '0.75rem', color: '#64748b', fontSize: '0.85rem' }}>
              {opps.length === 0
                ? 'No Opps rows found in this browser. Open the Opps tab first to load them.'
                : 'No matches.'}
            </div>
          ) : filtered.map(r => (
            <button
              key={r._id}
              type="button"
              onClick={() => onPick(r._id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                gap: 2, width: '100%', textAlign: 'left', padding: '0.5rem 0.7rem',
                border: 'none', borderBottom: '1px solid #f1f5f9', background: '#fff',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{r.Account || '-'}</span>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                {(() => {
                  const iso = callInDateISO(r);
                  const days = resolveCallIn(r);
                  if (!iso) return 'Call in: -';
                  const when = typeof days === 'number' && Number.isFinite(days)
                    ? ` (${days === 0 ? 'today' : days > 0 ? `in ${days}d` : `${-days}d ago`})`
                    : '';
                  return `Call in: ${formatDateDisplay(iso)}${when}`;
                })()}
              </span>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                {[r.Scope, r.Stage, r.Source].filter(Boolean).join(' · ') || 'No Scope / Stage'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

