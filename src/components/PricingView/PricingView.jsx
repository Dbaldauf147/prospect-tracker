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

// Local-draft text cell — commits on blur/Enter so re-renders don't
// fight typing.
function CellTextInput({ initial, placeholder, type, align, onCommit }) {
  const [draft, setDraft] = useState(initial == null ? '' : String(initial));
  return (
    <input
      type={type || 'text'}
      className={styles.altCellInput}
      style={align === 'right' ? { textAlign: 'right' } : undefined}
      value={draft}
      placeholder={placeholder || ''}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(initial == null ? '' : String(initial)); e.currentTarget.blur(); }
      }}
    />
  );
}

// Parse tab- or comma-separated text into alt-fee rows. Each row is
// expected to have 6 columns matching the table: Item / Type / Fee /
// Unit / UnitCount / StartMonth. Excess columns are ignored, missing
// ones become empty.
function parseAltFeePaste(text) {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const cols = line.includes('\t') ? line.split('\t') : line.split(/\s*,\s*/);
    const cell = (i) => (cols[i] ?? '').trim();
    const feeNum = Number(cell(2).replace(/[$,\s]/g, ''));
    const ucNum = Number(cell(4));
    const smNum = Number(cell(5));
    const gmRaw = cell(6).replace('%', '').trim();
    const gmNum = gmRaw === '' ? null : Number(gmRaw);
    out.push({
      altItem: cell(0),
      type: cell(1),
      fee: Number.isFinite(feeNum) ? feeNum : 0,
      unit: cell(3),
      unitCount: Number.isFinite(ucNum) ? ucNum : cell(4),
      startMonth: Number.isFinite(smNum) ? smNum : cell(5) || 1,
      feeGmPct: Number.isFinite(gmNum) ? (gmNum > 1 ? gmNum / 100 : gmNum) : null,
    });
  }
  return out;
}

function AltFeeTable({ rows, onChange, onAddRow, onRemoveRow, onReplaceRows, onAppendRows, globalGmPct }) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [flash, setFlash] = useState('');
  const parsed = pasteOpen ? parseAltFeePaste(pasteText) : [];

  // Intercept paste anywhere on the table. If the clipboard text
  // looks like multi-row tabular data (more than one row, or any
  // tabs), parse it and replace the table with the pasted rows.
  // Single-value pastes are left alone so a normal paste into a
  // single cell still works.
  function handleTablePaste(e) {
    const cd = e.clipboardData;
    if (!cd) return;
    const text = cd.getData('text/plain');
    if (!text) return;
    const looksTabular = text.includes('\t') || text.includes('\n');
    if (!looksTabular) return; // let the browser paste into the focused input
    e.preventDefault();
    e.stopPropagation();
    const newRows = parseAltFeePaste(text);
    if (newRows.length === 0) return;
    onReplaceRows(newRows);
    setFlash(`Pasted ${newRows.length} row${newRows.length === 1 ? '' : 's'} from clipboard.`);
    window.setTimeout(() => setFlash(''), 2500);
  }

  return (
    <div className={styles.altFeeWrap} onPaste={handleTablePaste}>
      <h3 className={styles.summaryTitle}>Alternative Fee Structure / Schedule</h3>
      {flash && <div className={styles.pasteFlash}>{flash}</div>}
      <table className={styles.altTable}>
        <thead>
          <tr>
            <th style={{ minWidth: 220 }}>Alternative Fee Structure/Schedule</th>
            <th style={{ minWidth: 140 }}>Type</th>
            <th className={styles.numCell} style={{ minWidth: 120 }}>Fee</th>
            <th style={{ minWidth: 120 }}>Unit</th>
            <th className={styles.numCell} style={{ width: 90 }}>Unit Count</th>
            <th className={styles.numCell} style={{ width: 80, maxWidth: 90 }}>Fee Start Month</th>
            <th className={styles.numCell} style={{ width: 90 }}>Fee GM%</th>
            <th style={{ width: 32 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx}>
              <td>
                <CellTextInput
                  key={`alt-${idx}-altItem-${row.altItem ?? ''}`}
                  initial={row.altItem}
                  onCommit={(v) => onChange(idx, 'altItem', v)}
                />
              </td>
              <td>
                <select
                  className={styles.altCellInput}
                  value={row.type || ''}
                  onChange={(e) => onChange(idx, 'type', e.target.value)}
                >
                  <option value="">—</option>
                  <option value="Setup">Setup</option>
                  <option value="One Time">One Time</option>
                  <option value="Recurring (monthly)">Recurring (monthly)</option>
                </select>
              </td>
              <td className={styles.numCell}>
                <CellTextInput
                  key={`alt-${idx}-fee-${row.fee ?? ''}`}
                  initial={typeof row.fee === 'number'
                    ? `$${row.fee.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : (row.fee ? `$${row.fee}` : '')}
                  align="right"
                  onCommit={(v) => {
                    const n = Number(String(v).replace(/[$,\s]/g, ''));
                    onChange(idx, 'fee', Number.isFinite(n) ? n : 0);
                  }}
                />
              </td>
              <td>
                <select
                  className={styles.altCellInput}
                  value={row.unit || ''}
                  onChange={(e) => onChange(idx, 'unit', e.target.value)}
                >
                  <option value="">—</option>
                  <option value="Fixed">Fixed</option>
                  <option value="Per Site">Per Site</option>
                  <option value="Per Account">Per Account</option>
                  <option value="Per Meter">Per Meter</option>
                </select>
              </td>
              <td className={styles.numCell}>
                <CellTextInput
                  key={`alt-${idx}-unitCount-${row.unitCount ?? ''}`}
                  initial={row.unitCount}
                  align="right"
                  onCommit={(v) => onChange(idx, 'unitCount', v)}
                />
              </td>
              <td className={styles.numCell}>
                <CellTextInput
                  key={`alt-${idx}-startMonth-${row.startMonth ?? ''}`}
                  initial={row.startMonth}
                  align="right"
                  onCommit={(v) => onChange(idx, 'startMonth', v)}
                />
              </td>
              <td className={styles.numCell}>
                <CellTextInput
                  key={`alt-${idx}-feeGm-${row.feeGmPct ?? ''}`}
                  initial={typeof row.feeGmPct === 'number' ? (row.feeGmPct * 100).toString() : ''}
                  placeholder={typeof globalGmPct === 'number' ? `${Math.round(globalGmPct * 100)}%` : ''}
                  align="right"
                  onCommit={(v) => {
                    const trimmed = String(v ?? '').replace('%', '').trim();
                    if (!trimmed) { onChange(idx, 'feeGmPct', null); return; }
                    const n = Number(trimmed);
                    if (!Number.isFinite(n)) return;
                    onChange(idx, 'feeGmPct', n > 1 ? n / 100 : n);
                  }}
                />
              </td>
              <td>
                <button
                  type="button"
                  className={styles.rowDelBtn}
                  title="Remove row"
                  onClick={() => onRemoveRow(idx)}
                >×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" className={styles.actionBtn} onClick={onAddRow}>+ Add row</button>
        <button type="button" className={styles.actionBtn} onClick={() => setPasteOpen(o => !o)}>
          {pasteOpen ? 'Hide paste box' : 'Paste from spreadsheet…'}
        </button>
      </div>
      {pasteOpen && (
        <div className={styles.pasteBox}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>
            Paste tab-separated rows (6 columns: Item · Type · Fee · Unit · Unit Count · Fee Start Month). Type values like "One Time" / "Recurring (monthly)" and Unit values like "Per Site" / "Per Account" will round-trip into the dropdowns.
          </div>
          <textarea
            className={styles.pasteArea}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'New sites\tOne Time\t$130.00\tPer Site\t25\t1\n…'}
            rows={8}
          />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              {parsed.length} row{parsed.length === 1 ? '' : 's'} parsed
            </span>
            <button
              type="button"
              className={styles.actionBtn}
              disabled={parsed.length === 0}
              onClick={() => { onAppendRows(parsed); setPasteText(''); setPasteOpen(false); }}
            >Append</button>
            <button
              type="button"
              className={styles.actionBtn}
              disabled={parsed.length === 0}
              onClick={() => { onReplaceRows(parsed); setPasteText(''); setPasteOpen(false); }}
            >Replace all</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Free-text per-row cell input. Local-draft like GmInput so typing
// doesn't fight a re-rendered controlled value.
function LinkedToInput({ initial, isDefault, onCommit }) {
  const [draft, setDraft] = useState(initial || '');
  return (
    <input
      className={`${styles.linkedInput} ${isDefault ? styles.linkedDefault : ''}`}
      type="text"
      value={draft}
      placeholder="Tie to…"
      title={isDefault ? 'Auto-filled from saved default for this Line Item + Type. Edit to override.' : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(initial || ''); e.currentTarget.blur(); }
      }}
    />
  );
}

const COLS = [
  { key: 'lineItem',  label: 'Line Item',         defaultWidth: 280 },
  { key: 'type',      label: 'Type',              defaultWidth: 140 },
  { key: 'cts',       label: 'CTS',               defaultWidth: 110, cellClass: undefined },
  { key: 'start',     label: 'Start Month',       defaultWidth: 100 },
  { key: 'comments',  label: 'Comments',          defaultWidth: 280 },
  { key: 'gm',        label: 'GM%',               defaultWidth: 90 },
  { key: 'price',     label: 'Marked-up Price',   defaultWidth: 140 },
  { key: 'linkedTo',  label: 'Linked To',         defaultWidth: 200 },
];

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
  const [colWidths, setColWidths] = useState({}); // { [colKey]: pixelWidth }
  const [altFees, setAltFees] = useState({}); // { [optionNumber]: [{ altItem, type, fee, unit, unitCount, startMonth }] }
  const [linkedToDefaults, setLinkedToDefaults] = useState({}); // { [`${lineItem}::${type}`]: 'value' }
  const [termMonths, setTermMonths] = useState(36);
  const [annualEscalator, setAnnualEscalator] = useState(0.03);
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
        if (saved.colWidths) setColWidths(saved.colWidths);
        if (saved.altFees) setAltFees(saved.altFees);
        if (saved.linkedToDefaults) setLinkedToDefaults(saved.linkedToDefaults);
        if (typeof saved.termMonths === 'number') setTermMonths(saved.termMonths);
        if (typeof saved.annualEscalator === 'number') setAnnualEscalator(saved.annualEscalator);
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
    const payload = { parserVersion: PARSER_VERSION, workbook, globalGmPct, overrides, activeOption, colWidths, altFees, linkedToDefaults, termMonths, annualEscalator };
    dbPut(STORE, payload, KEY).catch(err => console.warn('Failed to save pricing cache:', err));
  }, [workbook, globalGmPct, overrides, activeOption, colWidths, altFees, linkedToDefaults, termMonths, annualEscalator]);

  // Term-value of a monthly amount under an annual escalator: each
  // 12-month band charges at month1 × (1 + esc)^yearIndex.
  function projectMonthlyOverTerm(monthly, escPct, months) {
    if (typeof monthly !== 'number' || !Number.isFinite(monthly)) return 0;
    if (!months || months <= 0) return 0;
    const esc = typeof escPct === 'number' && Number.isFinite(escPct) ? escPct : 0;
    let total = 0;
    let remaining = months;
    let mult = 1;
    while (remaining > 0) {
      const band = Math.min(12, remaining);
      total += monthly * mult * band;
      remaining -= band;
      mult *= (1 + esc);
    }
    return total;
  }

  const linkedToDefaultKey = (lineItem, type) =>
    `${(lineItem || '').trim().toLowerCase()}::${(type || '').trim().toLowerCase()}`;

  // Resolve the displayed Linked To value for an item: per-row
  // override wins; otherwise fall back to the saved default for the
  // (Line Item, Type) pair.
  function resolvedLinkedTo(item) {
    const ov = overrides[item.id]?.linkedTo;
    if (ov !== undefined) return ov;
    return linkedToDefaults[linkedToDefaultKey(item.description, item.type)] || '';
  }

  // Drag-to-resize column handler. Captures the starting width and
  // mouse X, then updates `colWidths[key]` on mousemove until mouseup.
  function startColResize(key, evt) {
    evt.preventDefault();
    evt.stopPropagation();
    const startX = evt.clientX;
    const colDef = COLS.find(c => c.key === key);
    const startW = colWidths[key] ?? colDef?.defaultWidth ?? 140;
    const onMove = (e) => {
      const next = Math.max(60, startW + (e.clientX - startX));
      setColWidths(w => ({ ...w, [key]: next }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

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

  // 9 empty starter rows that match the Excel template — used when
  // an option's alt-fee table hasn't been edited yet.
  const altFeeStarter = () => Array.from({ length: 9 }, () => ({
    altItem: '', type: '', fee: 0, unit: '', unitCount: '', startMonth: 1,
  }));

  function updateAltFeeCell(optionNumber, idx, field, value) {
    setAltFees(prev => {
      const list = (prev[optionNumber] || altFeeStarter()).slice();
      const row = { ...(list[idx] || {}), [field]: value };
      list[idx] = row;
      return { ...prev, [optionNumber]: list };
    });
  }

  function addAltFeeRow(optionNumber) {
    setAltFees(prev => {
      const list = (prev[optionNumber] || altFeeStarter()).slice();
      list.push({ altItem: '', type: '', fee: 0, unit: '', unitCount: '', startMonth: 1 });
      return { ...prev, [optionNumber]: list };
    });
  }

  function removeAltFeeRow(optionNumber, idx) {
    setAltFees(prev => {
      const list = (prev[optionNumber] || []).slice();
      list.splice(idx, 1);
      return { ...prev, [optionNumber]: list };
    });
  }

  function replaceAltFeeRows(optionNumber, newRows) {
    setAltFees(prev => ({ ...prev, [optionNumber]: newRows.slice() }));
  }

  function appendAltFeeRows(optionNumber, newRows) {
    setAltFees(prev => {
      const existing = (prev[optionNumber] || altFeeStarter()).slice();
      // Drop trailing fully-empty starter rows so the appended rows
      // don't sit below a wall of blanks.
      while (existing.length > 0) {
        const r = existing[existing.length - 1];
        const isEmpty = !r.altItem && !r.type && !r.unit && !r.unitCount &&
          (typeof r.fee !== 'number' || r.fee === 0) &&
          (r.startMonth === '' || r.startMonth === 1);
        if (!isEmpty) break;
        existing.pop();
      }
      return { ...prev, [optionNumber]: [...existing, ...newRows] };
    });
  }

  function setItemLinkedTo(item, raw) {
    const itemId = item.id;
    const trimmed = (raw || '').trim();
    setOverrides(prev => {
      const next = { ...prev };
      if (!trimmed) {
        if (next[itemId]) {
          const { linkedTo: _drop, ...rest } = next[itemId];
          if (Object.keys(rest).length === 0) delete next[itemId];
          else next[itemId] = rest;
        }
      } else {
        next[itemId] = { ...next[itemId], linkedTo: trimmed };
      }
      return next;
    });
  }

  // Save / clear the (Line Item, Type) default from the row's
  // currently-resolved value via the star button next to the input.
  function toggleLinkedToDefault(item) {
    const key = linkedToDefaultKey(item.description, item.type);
    const currentValue = resolvedLinkedTo(item).trim();
    const existing = linkedToDefaults[key] || '';
    setLinkedToDefaults(prev => {
      const next = { ...prev };
      if (currentValue && existing !== currentValue) {
        next[key] = currentValue;
      } else if (existing) {
        delete next[key];
      }
      return next;
    });
  }

  function setItemGm(itemId, raw) {
    setOverrides(prev => {
      const next = { ...prev };
      const parsed = parsePctInput(raw);
      if (parsed === null) {
        // Clearing GM% -> drop just the gmPct field, keep other
        // per-row state (e.g. linkedTo).
        if (next[itemId]) {
          const { gmPct: _drop, ...rest } = next[itemId];
          if (Object.keys(rest).length === 0) delete next[itemId];
          else next[itemId] = rest;
        }
      } else {
        next[itemId] = { ...next[itemId], gmPct: parsed };
      }
      return next;
    });
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
    const rows = [['Option', 'Section', 'Line Item', 'Type', 'CTS', 'Start Month', 'Comments', 'Effective GM%', 'GM Source', 'Marked-up Price', 'Linked To']];
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
            resolvedLinkedTo(item),
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

          <label className={styles.gmField} title="Number of months in the contract term — used to project recurring (monthly) totals.">
            Term
            <input
              className={styles.gmInput}
              type="number"
              step="1"
              min="0"
              max="240"
              value={termMonths}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                setTermMonths(Math.max(0, Math.min(240, Math.round(n))));
              }}
            />
            <span>mo</span>
          </label>

          <label className={styles.gmField} title="Annual fee escalator applied to recurring (monthly) fees year-over-year.">
            Escalator
            <input
              className={styles.gmInput}
              type="number"
              step="0.5"
              min="0"
              max="50"
              value={Math.round(annualEscalator * 1000) / 10}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                setAnnualEscalator(Math.max(0, Math.min(0.5, n / 100)));
              }}
            />
            <span>%/yr</span>
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
                {(() => {
                  const flatItems = opt.sections.flatMap(s => s.items);
                  if (flatItems.length === 0) return null;
                  const totalCost = flatItems.reduce((s, i) => s + (typeof i.cts === 'number' ? i.cts : 0), 0);
                  const totalPrice = flatItems.reduce((s, i) => {
                    const { price } = priceFor(i);
                    return s + (typeof price === 'number' ? price : 0);
                  }, 0);
                  // Aggregate by Type for the summary panel under the table.
                  // For "Recurring (monthly)" we also project the term value
                  // using the annual escalator and term length from the toolbar.
                  const sumByType = (typeRe, isRecurring) => flatItems.reduce((acc, i) => {
                    if (!typeRe.test(i.type || '')) return acc;
                    const { price } = priceFor(i);
                    if (typeof i.cts === 'number') acc.cost += i.cts;
                    if (typeof price === 'number') acc.price += price;
                    if (isRecurring) {
                      acc.termCost += projectMonthlyOverTerm(i.cts ?? null, annualEscalator, termMonths);
                      acc.termPrice += projectMonthlyOverTerm(price ?? null, annualEscalator, termMonths);
                    }
                    return acc;
                  }, { cost: 0, price: 0, termCost: 0, termPrice: 0 });
                  const setup = sumByType(/^setup$/i, false);
                  const recurring = sumByType(/recurring.*monthly|monthly.*recurring|^recurring/i, true);
                  const oneTime = sumByType(/^one\s*time$/i, false);
                  const grandTermCost = setup.cost + oneTime.cost + recurring.termCost;
                  const grandTermPrice = setup.price + oneTime.price + recurring.termPrice;
                  return (
                    <div className={styles.section}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            {COLS.map(col => (
                              <th
                                key={col.key}
                                className={col.cellClass}
                                style={{ width: colWidths[col.key] ?? col.defaultWidth }}
                              >
                                <span className={styles.thInner}>
                                  <span className={styles.thLabel}>{col.label}</span>
                                  <span
                                    className={styles.colResizer}
                                    onMouseDown={(e) => startColResize(col.key, e)}
                                    title="Drag to resize column"
                                  />
                                </span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {flatItems.map(item => {
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
                                <td>
                                  {(() => {
                                    const key = linkedToDefaultKey(item.description, item.type);
                                    const savedDefault = linkedToDefaults[key] || '';
                                    const currentVal = resolvedLinkedTo(item);
                                    const isFromDefault = overrides[item.id]?.linkedTo === undefined && !!savedDefault;
                                    const matchesDefault = !!savedDefault && savedDefault === currentVal.trim();
                                    const canSetDefault = !!currentVal.trim() && !matchesDefault;
                                    const canClearDefault = matchesDefault;
                                    return (
                                      <div className={styles.linkedCell}>
                                        <LinkedToInput
                                          key={`linked:${item.id}:${currentVal}`}
                                          initial={currentVal}
                                          isDefault={isFromDefault}
                                          onCommit={(raw) => setItemLinkedTo(item, raw)}
                                        />
                                        <button
                                          type="button"
                                          className={`${styles.defaultStar} ${matchesDefault ? styles.defaultStarOn : ''}`}
                                          onClick={() => toggleLinkedToDefault(item)}
                                          disabled={!canSetDefault && !canClearDefault}
                                          title={
                                            matchesDefault
                                              ? `Default for "${item.description}" · ${item.type || '(no type)'}. Click to clear.`
                                              : canSetDefault
                                              ? `Save "${currentVal}" as the default for "${item.description}" · ${item.type || '(no type)'}.`
                                              : 'Type a value above, then click to save it as the default.'
                                          }
                                        >
                                          {matchesDefault ? '★' : '☆'}
                                        </button>
                                      </div>
                                    );
                                  })()}
                                </td>
                              </tr>
                            );
                          })}
                          <tr className={styles.totalsRow}>
                            <td colSpan={2}>Total</td>
                            <td className={styles.numCell}>{fmtMoney(totalCost)}</td>
                            <td colSpan={3} />
                            <td className={styles.priceCell}>{fmtMoney(totalPrice)}</td>
                            <td />
                          </tr>
                        </tbody>
                      </table>

                      <div className={styles.bottomRow}>
                      <AltFeeTable
                        rows={altFees[opt.optionNumber] || altFeeStarter()}
                        globalGmPct={globalGmPct}
                        onChange={(idx, field, value) => updateAltFeeCell(opt.optionNumber, idx, field, value)}
                        onAddRow={() => addAltFeeRow(opt.optionNumber)}
                        onRemoveRow={(idx) => removeAltFeeRow(opt.optionNumber, idx)}
                        onReplaceRows={(rows) => replaceAltFeeRows(opt.optionNumber, rows)}
                        onAppendRows={(rows) => appendAltFeeRows(opt.optionNumber, rows)}
                      />
                      <div className={styles.summaryPanel}>
                        <h3 className={styles.summaryTitle}>Totals by type</h3>
                        <div className={styles.summaryMeta}>
                          Term:{' '}
                          <input
                            className={styles.metaInput}
                            type="number"
                            step="1"
                            min="0"
                            max="240"
                            value={termMonths}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              if (!Number.isFinite(n)) return;
                              setTermMonths(Math.max(0, Math.min(240, Math.round(n))));
                            }}
                          />
                          {' '}months · Annual escalator:{' '}
                          <input
                            className={styles.metaInput}
                            type="number"
                            step="0.5"
                            min="0"
                            max="50"
                            value={Math.round(annualEscalator * 1000) / 10}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              if (!Number.isFinite(n)) return;
                              setAnnualEscalator(Math.max(0, Math.min(0.5, n / 100)));
                            }}
                          />
                          %
                        </div>
                        <table className={styles.summaryTable}>
                          <thead>
                            <tr>
                              <th>Bucket</th>
                              <th className={styles.numCell}>Cost</th>
                              <th className={styles.priceCell}>Marked-up</th>
                              <th className={styles.priceCell}>Term value (marked-up)</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>Setup</td>
                              <td className={styles.numCell}>{fmtMoney(setup.cost)}</td>
                              <td className={styles.priceCell}>{fmtMoney(setup.price)}</td>
                              <td className={styles.priceCell}>{fmtMoney(setup.price)}</td>
                            </tr>
                            <tr>
                              <td>Recurring (monthly)</td>
                              <td className={styles.numCell}>{fmtMoney(recurring.cost)}</td>
                              <td className={styles.priceCell}>{fmtMoney(recurring.price)}</td>
                              <td className={styles.priceCell}>{fmtMoney(recurring.termPrice)}</td>
                            </tr>
                            {(oneTime.cost > 0 || oneTime.price > 0) && (
                              <tr>
                                <td>One Time</td>
                                <td className={styles.numCell}>{fmtMoney(oneTime.cost)}</td>
                                <td className={styles.priceCell}>{fmtMoney(oneTime.price)}</td>
                                <td className={styles.priceCell}>{fmtMoney(oneTime.price)}</td>
                              </tr>
                            )}
                            <tr className={styles.summaryGrandRow}>
                              <td>Total contract value</td>
                              <td className={styles.numCell}>{fmtMoney(grandTermCost)}</td>
                              <td className={styles.priceCell}>{fmtMoney(totalPrice)}</td>
                              <td className={styles.priceCell}>{fmtMoney(grandTermPrice)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      </div>
                    </div>
                  );
                })()}
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}
