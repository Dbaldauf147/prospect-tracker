import { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { sanitizeExcelWorkbook, sanitizeSheetJsWorkbook } from '../../utils/exportSanitize.js';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts';
import styles from './PricingView.module.css';
import { downloadPricingMarginWorkbook } from '../../utils/pricingMarginWorkbook';
import { useAuth } from '../../contexts/AuthContext';
import { parsePricingWorkbook, priceFromCostAndGm } from '../../utils/pricingParse';
import { dbGet, dbPut, dbDelete } from '../../utils/db';
import { buildAltFeeRowsFromAutomatedNames, altFeeUnitCount, feeDefaultKey, applyFeeDefaultToRows, reconcileScheduleWithFeeDefaults } from '../../utils/altFeeAutoBuild';
import { recurringFeePerUnit } from '../../utils/altFeePricing';
import { getEffectiveDropdownLists } from '../../utils/dropdownListsStore';
import { OptionsTab, OppPickerModal } from './OptionsTab';
import { PricingConversions } from './PricingConversions';
import { CompareTab } from './CompareTab';
import { BrokerFeesTab } from './BrokerFeesTab';
import { S2CTab } from './S2CTab';
import { CalculatorTab } from './CalculatorTab';
import { SetupFeeFloorPanel } from './SetupFeeFloorPanel';
import { isSetupFeeType } from '../../utils/setupFeeFloor';
import { buildPricingOptionSnapshot, cumulativeDealMargins } from '../../utils/pricingOptionCalc';
import { setOppPricingSnapshot } from '../../utils/oppsPricingSnapshot';
import { saveOppSourceFile, sourceFileMeta } from '../../utils/oppPricingSourceFile';
import {
  loadOptionLinks,
  setOppOptionLink,
  dropOptionFromLinks,
  dropLinksForWorkbook,
  findLinkedOppId,
  OPTION_LINKS_EVENT,
} from '../../utils/pricingOptionLinks';

// Local-draft text input keyed off the upstream value. The parent
// remounts the input (via React's `key` prop on the wrapping cell)
// whenever it wants to reset the draft — so this component never has
// to sync internal state to props at runtime.
function GmInput({ initialPct, placeholder, title, isOverride, disabled, onCommit }) {
  const initial = initialPct === null || initialPct === undefined ? '' : String(+initialPct.toFixed(2));
  const [draft, setDraft] = useState(initial);
  return (
    <input
      className={`${styles.cellInput} ${isOverride ? styles.overridden : ''}`}
      type="text"
      placeholder={placeholder}
      value={disabled ? '' : draft}
      title={title}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (!disabled) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(initial); e.currentTarget.blur(); }
      }}
    />
  );
}

// Multi-checkbox menu for toggling column visibility on a table.
function ColumnsMenu({ open, onToggle, columns, hiddenFn, onItemToggle }) {
  return (
    <div className={styles.colsMenuWrap}>
      <button type="button" className={styles.actionBtn} onClick={onToggle}>
        Columns ▾
      </button>
      {open && (
        <div className={styles.colsMenu}>
          {columns.map(col => (
            <label key={col.key} className={styles.colsMenuItem}>
              <input
                type="checkbox"
                checked={!hiddenFn(col.key)}
                onChange={() => onItemToggle(col.key)}
              />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Local-draft text cell — commits on blur/Enter so re-renders don't
// fight typing. Pass `listId` to bind the input to a <datalist> for
// dropdown suggestions while still allowing free-text entry.
function CellTextInput({ initial, placeholder, type, align, listId, onCommit, disabled }) {
  const [draft, setDraft] = useState(initial == null ? '' : String(initial));
  return (
    <input
      type={type || 'text'}
      className={styles.altCellInput}
      style={align === 'right' ? { textAlign: 'right' } : undefined}
      value={draft}
      placeholder={placeholder || ''}
      list={listId}
      disabled={disabled}
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
    // Skip a header row pasted alongside the data (e.g. from the
    // built-in Copy button). The first column on a header reads
    // "Alternative Fee…" or "Item" and the second is the literal
    // word "Type".
    if (/^(alternative\s*fee|item)\b/i.test(cell(0)) && /^type$/i.test(cell(1))) continue;
    const feeRaw = cell(2).replace(/[$,\s]/g, '');
    const feeNum = feeRaw === '' ? null : Number(feeRaw);
    const ucNum = Number(cell(4));
    const smNum = Number(cell(5));
    const gmRaw = cell(6).replace('%', '').trim();
    const gmNum = gmRaw === '' ? null : Number(gmRaw);
    const passRaw = cell(7).trim().toLowerCase();
    const passThrough = passRaw === 'yes' || passRaw === 'y' || passRaw === 'true' || passRaw === '1' || passRaw === 'pass' || passRaw === 'pass-through' || passRaw === 'passthrough';
    out.push({
      altItem: cell(0),
      type: cell(1),
      fee: Number.isFinite(feeNum) ? feeNum : null,
      unit: cell(3),
      unitCount: Number.isFinite(ucNum) ? ucNum : cell(4),
      startMonth: cell(5) === '' ? null : (Number.isFinite(smNum) && smNum > 0 ? smNum : null),
      feeGmPct: Number.isFinite(gmNum) ? (gmNum > 1 ? gmNum / 100 : gmNum) : null,
      passThrough,
    });
  }
  return out;
}

function AltFeeTable({ rows, onChange, onAddRow, onMoveRow, onRemoveRow, onReplaceRows, onAppendRows, onClearRows, onBuildRows, buildRows = [], automatedNameCount = 0, globalGmPct, marginFor, yearRevenue, autoFeeFor, autoStartMonthFor, siteCount, accountCount, altItemSuggestions = [], costByYear, passThroughByYear, passThroughRevenueByYear, numYears = 1 }) {
  const altItemListId = useId();
  const [dragFrom, setDragFrom] = useState(null); // row currently being dragged
  const [dragOverIdx, setDragOverIdx] = useState(null); // insertion point (0..rows.length)
  function rowDragStart(idx, e) {
    setDragFrom(idx);
    e.dataTransfer.effectAllowed = 'move';
    // Setting payload so Firefox actually fires drag events.
    try { e.dataTransfer.setData('text/plain', String(idx)); } catch { /* ignore */ }
  }
  function rowDragOver(idx, e) {
    if (dragFrom === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    const next = before ? idx : idx + 1;
    if (next !== dragOverIdx) setDragOverIdx(next);
  }
  function rowDrop(idx, e) {
    e.preventDefault();
    if (dragFrom === null || !onMoveRow) { setDragFrom(null); setDragOverIdx(null); return; }
    const target = dragOverIdx ?? idx;
    onMoveRow(dragFrom, target);
    setDragFrom(null);
    setDragOverIdx(null);
  }
  function rowDragEnd() {
    setDragFrom(null);
    setDragOverIdx(null);
  }
  // When the user picks Per Site / Per Account, fill Unit Count from
  // the SIA metadata if the cell is still the default placeholder
  // (blank or the seed value of 1).
  function handleUnitChange(idx, row, unit) {
    onChange(idx, 'unit', unit);
    const uc = row.unitCount;
    const isDefault = uc === '' || uc === null || uc === undefined || uc === 1 || uc === '1';
    if (!isDefault) return;
    if (unit === 'Per Site' && typeof siteCount === 'number' && siteCount > 0) {
      onChange(idx, 'unitCount', siteCount);
    } else if (unit === 'Per Account' && typeof accountCount === 'number' && accountCount > 0) {
      onChange(idx, 'unitCount', accountCount);
    }
  }
  const fmtFeeInput = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtMoneyCell = (n) => {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '';
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [flash, setFlash] = useState('');
  const parsed = pasteOpen ? parseAltFeePaste(pasteText) : [];

  // TSV (tab-separated) snapshot of the table — data rows only, no
  // header. The Fee column uses the effective fee (manual if present,
  // otherwise the auto-computed marked-up fee from linked CTS rows)
  // so the export reflects what the user sees. Pastes cleanly into
  // Excel and round-trips through the paste box.
  function buildTsv() {
    const lines = [];
    for (const r of rows) {
      const manualFee = Number(r.fee);
      const hasManual = r.fee != null && r.fee !== '' && Number.isFinite(manualFee) && manualFee >= 0;
      const auto = !hasManual && autoFeeFor ? autoFeeFor(r) : null;
      const fee = hasManual ? manualFee : (typeof auto === 'number' ? auto : '');
      const feeCell = typeof fee === 'number' ? fee.toFixed(2) : '';
      const gmCell = typeof r.feeGmPct === 'number' ? (r.feeGmPct * 100).toFixed(1) + '%' : '';
      const manualSm = Number(r.startMonth);
      const hasManualSm = r.startMonth != null && r.startMonth !== '' && Number.isFinite(manualSm) && manualSm > 0;
      const autoSm = !hasManualSm && autoStartMonthFor ? autoStartMonthFor(r) : null;
      const smCell = hasManualSm
        ? r.startMonth
        : (typeof autoSm === 'number' && autoSm > 0 ? autoSm : '');
      lines.push([
        r.altItem || '',
        r.type || '',
        feeCell,
        r.unit || '',
        r.unitCount === '' || r.unitCount == null ? '' : r.unitCount,
        smCell,
        gmCell,
        r.passThrough ? 'yes' : '',
      ].join('\t'));
    }
    return lines.join('\n');
  }

  async function handleCopy() {
    const tsv = buildTsv();
    try {
      await navigator.clipboard.writeText(tsv);
      setFlash(`Copied ${rows.length} row${rows.length === 1 ? '' : 's'} to clipboard: paste into Excel.`);
    } catch {
      // Clipboard API blocked (insecure context, permissions). Fall
      // back to opening the paste box prefilled so the user can copy
      // the text manually.
      setPasteText(tsv);
      setPasteOpen(true);
      setFlash('Clipboard blocked: copy the text below manually.');
    }
    window.setTimeout(() => setFlash(''), 2500);
  }

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

  // "Build from Automated Fee Names": one row per fee the cost table's
  // Automated Fee Name column already implies, for the names the schedule
  // doesn't price yet. It only ever adds rows — nothing typed in here is
  // touched — so it's safe to press on a schedule that's already half built.
  const buildCount = buildRows.length;
  const buildNames = (() => {
    const seen = [];
    for (const r of buildRows) {
      const name = String(r.altItem || '').trim();
      if (name && !seen.includes(name)) seen.push(name);
    }
    return seen;
  })();
  const buildTitle = buildCount > 0
    ? `Add ${buildCount} fee row${buildCount === 1 ? '' : 's'} for ${buildNames.slice(0, 4).join(', ')}${buildNames.length > 4 ? `, +${buildNames.length - 4} more` : ''}. Each row is typed to match the costs carrying its name; its fee and start month derive from them.`
    : automatedNameCount > 0
    ? 'Every Automated Fee Name on this option already has a row in the schedule.'
    : 'No Automated Fee Names on this option\u2019s cost rows yet \u2014 fill in the Automated Fee Name column above, then build the schedule from it.';

  return (
    <div className={styles.altFeeWrap} onPaste={handleTablePaste}>
      <div className={styles.altFeeReminder}>
        Reminder: start with bulk fees to create wiggle room for negotiations.
      </div>
      <div className={styles.altFeeHeader}>
        <h3 className={styles.summaryTitle}>Alternative Fee Structure / Schedule</h3>
        {onBuildRows && (
          <button
            type="button"
            className={buildCount > 0 ? styles.buildBtnOn : styles.buildBtn}
            disabled={buildCount === 0}
            onClick={() => {
              onBuildRows(buildRows);
              setFlash(`Built ${buildCount} fee row${buildCount === 1 ? '' : 's'} from the Automated Fee Names. Fees derive from the costs carrying each name \u2014 type over any of them to fix a price.`);
              window.setTimeout(() => setFlash(''), 5000);
            }}
            title={buildTitle}
          >
            Build from Automated Fee Names{buildCount > 0 ? ` (${buildCount})` : ''}
          </button>
        )}
      </div>
      {flash && <div className={styles.pasteFlash}>{flash}</div>}
      <datalist id={altItemListId}>
        {altItemSuggestions.map(opt => <option key={opt} value={opt} />)}
      </datalist>
      <table className={styles.altTable}>
        <thead>
          <tr>
            <th style={{ width: 22 }} title="Drag a row by this handle to reorder." />
            <th style={{ width: 260, whiteSpace: 'nowrap' }}>Alternative Fee Structure/Schedule</th>
            <th style={{ width: 110, whiteSpace: 'nowrap' }}>Type</th>
            <th className={styles.numCell} style={{ width: 95, whiteSpace: 'nowrap' }}>Fee</th>
            <th style={{ width: 100, whiteSpace: 'nowrap' }}>Unit</th>
            <th className={styles.numCell} style={{ width: 95, whiteSpace: 'nowrap' }}>Unit Count</th>
            <th className={styles.numCell} style={{ width: 80, maxWidth: 90 }}>Fee Start Month</th>
            {Array.from({ length: numYears }, (_, i) => (
              <th key={`yh-${i}`} className={styles.numCell} style={{ width: 90 }}>{`Y${i + 1}`}</th>
            ))}
            <th className={styles.numCell} style={{ width: 90 }}>Fee GM%</th>
            <th style={{ width: 100, whiteSpace: 'nowrap' }} title="Bill this fee at face cost (no margin). Revenue still shows in totals but it's excluded from the Deal margin.">Pass-through</th>
            <th style={{ width: 32 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const isDragging = dragFrom === idx;
            const showInsertBefore = dragFrom !== null && dragOverIdx === idx;
            const showInsertAfter = dragFrom !== null && dragOverIdx === idx + 1;
            const passThrough = row.passThrough === true;
            return (
            <tr
              key={idx}
              className={`${isDragging ? styles.dragRowGhost : ''} ${showInsertBefore ? styles.dragInsertBefore : ''} ${showInsertAfter ? styles.dragInsertAfter : ''} ${passThrough ? styles.passThroughRow : ''}`.trim() || undefined}
              onDragOver={(e) => rowDragOver(idx, e)}
              onDrop={(e) => rowDrop(idx, e)}
              onDragEnd={rowDragEnd}
            >
              <td className={styles.dragHandleCell}>
                <span
                  className={styles.dragHandle}
                  draggable={!!onMoveRow}
                  onDragStart={(e) => rowDragStart(idx, e)}
                  title="Drag to reorder this row"
                >⋮⋮</span>
              </td>
              <td>
                <CellTextInput
                  key={`alt-${idx}-altItem-${row.altItem ?? ''}`}
                  initial={row.altItem}
                  listId={altItemListId}
                  onCommit={(v) => onChange(idx, 'altItem', v)}
                />
              </td>
              <td>
                <select
                  className={styles.altCellInput}
                  value={row.type || ''}
                  onChange={(e) => onChange(idx, 'type', e.target.value)}
                >
                  <option value="">-</option>
                  <option value="Setup">Setup</option>
                  <option value="One Time">One Time</option>
                  <option value="Recurring (monthly)">Recurring (monthly)</option>
                </select>
              </td>
              {(() => {
                const auto = autoFeeFor ? autoFeeFor(row) : null;
                const hasManualFee = typeof row.fee === 'number' && Number.isFinite(row.fee) && row.fee >= 0;
                const initial = hasManualFee ? fmtFeeInput(row.fee) : '';
                const placeholder = typeof auto === 'number' ? fmtFeeInput(auto) : '';
                const title = typeof auto === 'number'
                  ? `Auto-calculated from marked-up linked CTS (${fmtFeeInput(auto)} per unit). Type a value to override.`
                  : 'Tie this row to CTS rows via the Linked To column, then pick Type / Unit Count to auto-calculate the fee.';
                return (
                  <td className={styles.numCell} title={title}>
                    <CellTextInput
                      key={`alt-${idx}-fee-${row.fee ?? ''}-${typeof auto === 'number' ? auto.toFixed(2) : 'n'}`}
                      initial={initial}
                      placeholder={placeholder}
                      align="right"
                      onCommit={(v) => {
                        const trimmed = String(v ?? '').trim();
                        if (!trimmed) { onChange(idx, 'fee', null); return; }
                        const n = Number(trimmed.replace(/[$,\s]/g, ''));
                        if (!Number.isFinite(n)) return;
                        onChange(idx, 'fee', n);
                      }}
                    />
                  </td>
                );
              })()}
              <td>
                <select
                  className={styles.altCellInput}
                  value={row.unit || ''}
                  onChange={(e) => handleUnitChange(idx, row, e.target.value)}
                >
                  <option value="">-</option>
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
              {(() => {
                const autoSm = autoStartMonthFor ? autoStartMonthFor(row) : null;
                const manualSm = Number(row.startMonth);
                const hasManualSm = row.startMonth != null && row.startMonth !== '' && Number.isFinite(manualSm) && manualSm > 0;
                const placeholder = typeof autoSm === 'number' && autoSm > 0 ? String(autoSm) : '';
                const title = typeof autoSm === 'number' && autoSm > 0
                  ? `Auto-derived from linked CTS rows (month ${autoSm}). Type a value to override.`
                  : 'Set the month this fee starts billing. Defaults to month 1 when no linked CTS row carries a start month.';
                return (
                  <td className={styles.numCell} title={title}>
                    <CellTextInput
                      key={`alt-${idx}-startMonth-${row.startMonth ?? ''}-${placeholder || 'n'}`}
                      initial={hasManualSm ? row.startMonth : ''}
                      placeholder={placeholder}
                      align="right"
                      onCommit={(v) => onChange(idx, 'startMonth', v)}
                    />
                  </td>
                );
              })()}
              {Array.from({ length: numYears }, (_, yi) => {
                const rev = yearRevenue ? yearRevenue(row, yi + 1) : 0;
                return (
                  <td key={`y-${idx}-${yi}`} className={styles.numCell}>
                    {rev > 0 ? fmtMoneyCell(rev) : ''}
                  </td>
                );
              })}
              {(() => {
                const computed = marginFor ? marginFor(row.altItem) : null;
                const explicitZeroFee = typeof row.fee === 'number' && row.fee === 0;
                const placeholder = passThrough
                  ? 'pass'
                  : (computed
                    ? `${(computed.marginPct * 100).toFixed(1)}%`
                    : (explicitZeroFee
                      ? ''
                      : (typeof globalGmPct === 'number' ? `${Math.round(globalGmPct * 100)}%` : '')));
                const fmt = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const title = passThrough
                  ? 'Pass-through fee: billed at face cost, contributes no margin.'
                  : (computed
                    ? `Auto-margin for "${row.altItem}":
  • Total fee revenue: ${fmt(computed.totalFee)} (${computed.altRowCount} alt-fee row${computed.altRowCount === 1 ? '' : 's'} × unit count, recurring projected over term; total units = ${computed.totalUnits})
  • Total cost: ${fmt(computed.totalCost)} (${computed.matchCount} linked CTS row${computed.matchCount === 1 ? '' : 's'}, treated as totals; recurring/rolled projected over term)
  • Margin: (${fmt(computed.totalFee)} − ${fmt(computed.totalCost)}) ÷ ${fmt(computed.totalFee)} = ${(computed.marginPct * 100).toFixed(1)}%
Type a value to override.`
                    : 'No CTS items are linked to this Alt Fee item: falls back to the global GM%.');
                return (
                  <td className={styles.numCell} title={title}>
                    <CellTextInput
                      key={`alt-${idx}-feeGm-${row.feeGmPct ?? ''}-${passThrough ? 'pass' : (computed ? computed.marginPct.toFixed(4) : 'n')}`}
                      initial={passThrough ? '' : (typeof row.feeGmPct === 'number' ? (row.feeGmPct * 100).toString() : '')}
                      placeholder={placeholder}
                      align="right"
                      disabled={passThrough}
                      onCommit={(v) => {
                        const trimmed = String(v ?? '').replace('%', '').trim();
                        if (!trimmed) { onChange(idx, 'feeGmPct', null); return; }
                        const n = Number(trimmed);
                        if (!Number.isFinite(n)) return;
                        onChange(idx, 'feeGmPct', n > 1 ? n / 100 : n);
                      }}
                    />
                  </td>
                );
              })()}
              <td className={styles.passThroughCell}>
                <label className={styles.passThroughLabel} title="Bill this fee at face cost (no margin). The line still appears in totals but is excluded from Deal margin.">
                  <input
                    type="checkbox"
                    checked={passThrough}
                    onChange={(e) => onChange(idx, 'passThrough', e.target.checked)}
                  />
                  {passThrough ? 'Pass' : ''}
                </label>
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
            );
          })}
        </tbody>
      </table>
      {(() => {
        // Two side-by-side summary tables under the alt-fee table.
        //   LEFT  ("Total fees"): every fee, including pass-through.
        //   RIGHT ("Revenue less pass-through"): same Setup + One Time
        //         and Recurring rows (the breakdown stays as-billed)
        //         but Total fee drops to revenue net of pass-through.
        //         Only rendered when the deal has any pass-through.
        // Deal margin and Linked CTS cost are identical in both — the
        // existing margin formula already excludes pass-through from
        // both sides, so the % doesn't change between scenarios.
        const isRecurring = (t) => /recurring/i.test(t || '');
        const isOneTimeOrSetup = (t) => /^setup$|^one\s*time$/i.test(t || '');
        const sums = (predicate) => Array.from({ length: numYears }, (_, i) =>
          rows.reduce((s, r) => predicate(r.type) && yearRevenue ? s + yearRevenue(r, i + 1) : s, 0)
        );
        const setupOneTime = sums(isOneTimeOrSetup);
        const recurring = sums(isRecurring);
        const grand = setupOneTime.map((v, i) => v + recurring[i]);
        const costs = Array.isArray(costByYear) ? costByYear : Array.from({ length: numYears }, () => 0);
        const ctsPasses = Array.isArray(passThroughByYear) ? passThroughByYear : Array.from({ length: numYears }, () => 0);
        const altPasses = Array.from({ length: numYears }, (_, i) =>
          rows.reduce((s, r) => (r.passThrough && yearRevenue ? s + yearRevenue(r, i + 1) : s), 0)
        );
        const passes = ctsPasses.map((v, i) => v + altPasses[i]);
        const ctsPassRev = Array.isArray(passThroughRevenueByYear) ? passThroughRevenueByYear : ctsPasses;
        const revLessPass = grand.map((v, i) => v - (ctsPassRev[i] || 0) - (altPasses[i] || 0));
        const anyPassThrough = passes.some(v => v > 0);
        // "Deal margin" is the deal's cumulative margin through each year,
        // not that single year's margin in isolation: a heavy Year-1 setup
        // fee keeps lifting the blended margin in later years. Accumulate
        // fee / cost (and the pass-through carve-outs) year over year, then
        // apply the same pass-through-excluded formula to the running totals.
        // Shared with the snapshot saved onto an Opp (see
        // dealMarginForOption) so the two can never disagree.
        const { marginByYear: margins } = cumulativeDealMargins({
          feeByYear: grand,
          costByYear: costs,
          ctsPassByYear: ctsPasses,
          altPassByYear: altPasses,
        });
        const fmtPctCell = (n) => n == null ? '' : `${(n * 100).toFixed(1)}%`;
        const hasCost = Array.isArray(costByYear);

        const cellMoney = (v, showZero = false) => (showZero || v > 0) ? fmtMoneyCell(v) : '';

        const renderScenario = (heading, totalFeeValues) => (
          <table className={styles.scenarioTable}>
            <thead>
              <tr>
                <th>{heading}</th>
                {Array.from({ length: numYears }, (_, i) => (
                  <th key={`yh-${i}`} className={styles.numCell}>Year {i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Setup + One Time</td>
                {setupOneTime.map((v, i) => (
                  <td key={`so-${i}`} className={styles.numCell}>{cellMoney(v)}</td>
                ))}
              </tr>
              <tr>
                <td>Recurring (monthly)</td>
                {recurring.map((v, i) => (
                  <td key={`rec-${i}`} className={styles.numCell}>{cellMoney(v)}</td>
                ))}
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Total fee</td>
                {totalFeeValues.map((v, i) => (
                  <td key={`tot-${i}`} className={styles.numCell} style={{ fontWeight: 600 }}>{cellMoney(v, true)}</td>
                ))}
              </tr>
              {hasCost && (
                <tr>
                  <td>Deal margin</td>
                  {margins.map((v, i) => (
                    <td key={`m-${i}`} className={styles.numCell}>{fmtPctCell(v)}</td>
                  ))}
                </tr>
              )}
              {hasCost && (
                <tr>
                  <td>Linked CTS cost</td>
                  {costs.map((v, i) => (
                    <td key={`c-${i}`} className={styles.numCell}>{cellMoney(v, true)}</td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        );

        return (
          <div className={styles.scenarioWrap}>
            {renderScenario('Total fees', grand)}
            {anyPassThrough && renderScenario('Revenue less pass-through', revLessPass)}
          </div>
        );
      })()}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" className={styles.actionBtn} onClick={onAddRow}>+ Add row</button>
        <button
          type="button"
          className={styles.actionBtn}
          onClick={handleCopy}
          title="Copy this table as tab-separated rows. Paste straight into Excel."
        >
          Copy to clipboard
        </button>
        <button type="button" className={styles.actionBtn} onClick={() => setPasteOpen(o => !o)}>
          {pasteOpen ? 'Hide paste box' : 'Paste from spreadsheet…'}
        </button>
        {onClearRows && (
          <button
            type="button"
            className={styles.actionBtnDanger}
            onClick={() => {
              const hasData = rows.some(r => (r.altItem || '').trim() || (r.type || '').trim() || r.fee != null || (r.unit || '').trim());
              if (hasData && !window.confirm('Clear the Alternative Fee schedule? This cannot be undone.')) return;
              onClearRows();
              setFlash('Cleared.');
              window.setTimeout(() => setFlash(''), 2000);
            }}
            title="Reset the Alternative Fee schedule to blank starter rows."
          >Clear</button>
        )}
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

// The Line Item → Services rows: every line item on the active workbook
// option, plus every saved mapping that still names a service (so entries
// stay reachable after the workbook is cleared). Deduped case-insensitively;
// workbook ordering wins for names it knows, saved-only entries follow
// alphabetically.
function lineItemMappingRows(workbookItems, lineItemServices) {
  const out = [];
  const seen = new Set();
  for (const item of workbookItems || []) {
    const name = String(item.description || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name });
  }
  const savedExtras = [];
  for (const key of Object.keys(lineItemServices || {})) {
    if (!key || seen.has(key)) continue;
    const services = lineItemServices[key];
    if (!Array.isArray(services) || services.length === 0) continue;
    seen.add(key);
    savedExtras.push({ key, name: key });
  }
  savedExtras.sort((a, b) => a.name.localeCompare(b.name));
  return out.concat(savedExtras);
}

// Which of those rows still need an answer, split by what's wrong with them:
//
//   unset   no services picked at all
//   offList services picked, but not one of them is still in the Dropdowns
//           tab's Solutions / Service Catalog
//
// The second case is the one a plain "has any services?" check misses. The
// mapping stores service names as text, so renaming or deleting a service on
// the Dropdowns tab leaves the line item pointing at a name that no longer
// exists — mapped on paper, and useless to the Scope picker that reads it.
// Only a mapping naming a service the list still has counts as mapped.
//
// With an empty catalog there is nothing to check against — everything would
// read as off-list, which says "your catalog is empty" in the most confusing
// way available — so that check is skipped and the section's own "add
// services on the Dropdowns tab first" notice carries it instead.
//
// Ignored line items are out of all of this: ticking Ignore is the user
// saying this one needs no service, which is an answer.
//
// Shared by the Linked To editor that fixes these and the banner on the
// Pricing subtab that says they exist, so the two can't disagree about what
// counts as mapped.
function unmappedLineItems({ workbookItems, lineItemServices, lineItemIgnored, solutionsOptions }) {
  const rows = lineItemMappingRows(workbookItems, lineItemServices);
  const known = new Set((solutionsOptions || []).map(o => String(o).trim().toLowerCase()).filter(Boolean));
  const unset = [];
  const offList = [];
  for (const row of rows) {
    if (lineItemIgnored?.[row.key]) continue;
    const services = Array.isArray(lineItemServices?.[row.key]) ? lineItemServices[row.key] : [];
    if (services.length === 0) { unset.push(row); continue; }
    if (known.size === 0) continue;
    if (!services.some(s => known.has(String(s).trim().toLowerCase()))) offList.push(row);
  }
  return { rows, unset, offList, all: unset.concat(offList) };
}

// "2 with nothing picked, 1 pointing only at a service the Dropdowns list no
// longer has" — the split behind the total, or '' when every one of them is
// simply blank and the total already said it.
function unmappedBreakdown({ unset, offList }) {
  if (offList.length === 0) return '';
  const parts = [];
  if (unset.length > 0) parts.push(`${unset.length} with nothing picked`);
  parts.push(offList.length === 1
    ? '1 pointing only at a service the Dropdowns list no longer has'
    : `${offList.length} pointing only at services the Dropdowns list no longer has`);
  return parts.join(', ');
}

// Is this service still one the Dropdowns tab offers? An empty catalog
// vouches for nothing rather than condemning everything, matching the rule
// above.
function isKnownService(service, solutionsOptions) {
  if (!Array.isArray(solutionsOptions) || solutionsOptions.length === 0) return true;
  const want = String(service || '').trim().toLowerCase();
  return solutionsOptions.some(o => String(o).trim().toLowerCase() === want);
}

// Inline editor that maps a Line Item (description) to one or more
// services from the Solutions / Service Catalog. The mapping is keyed
// by lowercase line item name so it persists across workbooks and
// matches case-insensitively. Rows come from two sources combined:
// every line item in the current workbook option plus every saved
// mapping (so entries stay reachable after the workbook is cleared).
function LineItemServicesSection({ workbookItems, lineItemServices, setLineItemServices, lineItemIgnored, setLineItemIgnored, solutionsOptions }) {
  const [draftItem, setDraftItem] = useState('');
  const [filter, setFilter] = useState('');

  const rows = useMemo(
    () => lineItemMappingRows(workbookItems, lineItemServices),
    [workbookItems, lineItemServices],
  );

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => r.name.toLowerCase().includes(q));
  }, [rows, filter]);

  function updateServices(key, services) {
    const next = { ...(lineItemServices || {}) };
    if (!services || services.length === 0) {
      delete next[key];
    } else {
      next[key] = services;
    }
    setLineItemServices(next);
  }

  function toggleIgnore(key) {
    const next = { ...(lineItemIgnored || {}) };
    if (next[key]) delete next[key];
    else next[key] = true;
    setLineItemIgnored(next);
  }

  // Line items still needing an answer — nothing picked, or picks the
  // Dropdowns catalog no longer lists. Same call the Pricing subtab's banner
  // makes, so clicking through from there lands on exactly these rows.
  const unmapped = useMemo(
    () => unmappedLineItems({ workbookItems, lineItemServices, lineItemIgnored, solutionsOptions }),
    [workbookItems, lineItemServices, lineItemIgnored, solutionsOptions],
  );

  function addLineItem() {
    const name = draftItem.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (!(lineItemServices || {})[key]) {
      setLineItemServices({ ...(lineItemServices || {}), [key]: [] });
    }
    setDraftItem('');
  }

  const mappedCount = Object.values(lineItemServices || {})
    .filter(arr => Array.isArray(arr) && arr.length > 0).length;
  const hasSolutions = Array.isArray(solutionsOptions) && solutionsOptions.length > 0;

  return (
    <section className={styles.linkedSection}>
      <h3 className={styles.linkedSubheading}>Line Item → Services ({mappedCount})</h3>
      <p className={styles.linkedHint}>
        Tie each pricing Line Item to one or more services from the Dropdowns tab's
        Solutions / Service Catalog. Opps' Scope column can then bulk-add the
        union of services across every line item in a Pricing Option from an
        "Add from Pricing Option" picker.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter line items…"
          style={{
            flex: '0 1 220px', padding: '0.3rem 0.45rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        />
        <input
          type="text"
          value={draftItem}
          onChange={(e) => setDraftItem(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLineItem(); } }}
          placeholder="Add a custom line item…"
          style={{
            flex: '0 1 260px', padding: '0.3rem 0.45rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        />
        <button
          type="button"
          onClick={addLineItem}
          disabled={!draftItem.trim()}
          style={{
            padding: '0.3rem 0.7rem', background: draftItem.trim() ? 'var(--color-accent)' : 'transparent',
            color: draftItem.trim() ? '#fff' : 'var(--color-text-muted)',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
            cursor: draftItem.trim() ? 'pointer' : 'not-allowed',
          }}
        >Add line item</button>
      </div>
      {!hasSolutions && (
        <div className={styles.linkedEmptyInline}>
          Solutions / Service Catalog list is empty. Add services to it on the Dropdowns tab first.
        </div>
      )}
      {unmapped.all.length > 0 && (() => {
        const n = unmapped.all.length;
        const breakdown = unmappedBreakdown(unmapped);
        return (
          <div className={styles.unmappedWarning} role="alert">
            ⚠ {n} line item{n === 1 ? '' : 's'} still need{n === 1 ? 's' : ''} a service
            {breakdown && <> — {breakdown} (those are the red chips)</>}
            . Map {n === 1 ? 'it' : 'them'} below, or tick <strong>Ignore</strong> to set the ones you don't need aside.
          </div>
        );
      })()}
      {filteredRows.length === 0 ? (
        <div className={styles.linkedEmptyInline}>
          {rows.length === 0
            ? 'No line items yet. Upload a workbook on the Pricing subtab or add a custom line item above.'
            : 'No line items match the filter.'}
        </div>
      ) : (
        <table className={styles.linkedTable}>
          <thead>
            <tr>
              <th style={{ width: '32%' }}>Line Item</th>
              <th>Services</th>
              <th style={{ width: 70 }}>Ignore</th>
              <th style={{ width: 32 }} />
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(row => {
              const services = Array.isArray(lineItemServices?.[row.key]) ? lineItemServices[row.key] : [];
              const ignored = !!lineItemIgnored?.[row.key];
              return (
                <tr key={row.key} style={ignored ? { opacity: 0.5 } : undefined}>
                  <td>{row.name}</td>
                  <td>
                    <ServicesPicker
                      selected={services}
                      options={solutionsOptions}
                      onChange={(next) => updateServices(row.key, next)}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={ignored}
                      onChange={() => toggleIgnore(row.key)}
                      title={ignored
                        ? 'Ignored: greyed out and excluded from the missing-mapping warning. Uncheck to track it again.'
                        : 'Ignore this line item: greys it out and drops it from the missing-mapping warning.'}
                      style={{ cursor: 'pointer' }}
                    />
                  </td>
                  <td>
                    {services.length > 0 && (
                      <button
                        type="button"
                        className={styles.rowDelBtn}
                        title="Clear all services for this line item"
                        onClick={() => updateServices(row.key, [])}
                      >×</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

// Chip-style multi-select for the Line Item → Services table. Shows
// the currently-picked services as chips with × buttons, plus a
// dropdown that adds the next pick. Keeping selection inline (no
// popover) so a long table of mappings stays scannable.
function ServicesPicker({ selected, options, onChange }) {
  const [adding, setAdding] = useState('');
  const selectedSet = useMemo(() => new Set(selected.map(s => s.toLowerCase())), [selected]);
  const remaining = useMemo(() => options.filter(o => !selectedSet.has(o.toLowerCase())), [options, selectedSet]);

  function addService(service) {
    if (!service) return;
    if (selectedSet.has(service.toLowerCase())) return;
    onChange([...selected, service]);
    setAdding('');
  }
  function removeService(service) {
    onChange(selected.filter(s => s.toLowerCase() !== service.toLowerCase()));
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center' }}>
      {selected.map(s => {
        // A pick the Dropdowns catalog no longer lists — renamed or deleted
        // there since this mapping was made. It reads as mapped but feeds
        // the Scope picker a service that doesn't exist, so it's called out
        // in red rather than left looking done.
        const known = isKnownService(s, options);
        return (
          <span
            key={s}
            title={known ? undefined : `"${s}" is not in the Dropdowns tab's Solutions / Service Catalog. Remove it and pick a current service, or add it back on the Dropdowns tab.`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 6px 2px 8px',
              background: known ? '#DCFCE7' : '#FEE2E2',
              color: known ? '#166534' : '#991B1B',
              border: `1px solid ${known ? '#86EFAC' : '#FCA5A5'}`,
              borderRadius: 999,
              fontSize: '0.75rem', fontWeight: 600,
            }}
          >
            {known ? s : `⚠ ${s}`}
            <button
              type="button"
              onClick={() => removeService(s)}
              title={`Remove ${s}`}
              style={{
                padding: 0, width: 14, height: 14, lineHeight: 1,
                background: 'transparent', border: 'none',
                color: known ? '#166534' : '#991B1B', cursor: 'pointer', fontSize: '0.85rem',
              }}
            >×</button>
          </span>
        );
      })}
      {remaining.length > 0 && (
        <select
          value={adding}
          onChange={(e) => addService(e.target.value)}
          style={{
            padding: '0.2rem 0.35rem',
            border: '1px solid var(--color-border)', borderRadius: 3,
            fontSize: '0.78rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        >
          <option value="">+ Add service…</option>
          {remaining.map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      )}
    </div>
  );
}

// Small numeric-ish input for the Linked To page's Fee Start Month
// column. Local-draft pattern so re-renders don't fight typing. Empty
// or non-positive commits drop the override; the placeholder shows the
// auto-derived value from the CTS rows on the active option.
function LinkedStartMonthInput({ initial, placeholder, onCommit }) {
  const [draft, setDraft] = useState(initial === null || initial === undefined ? '' : String(initial));
  return (
    <input
      type="text"
      value={draft}
      placeholder={placeholder || ''}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(initial === null || initial === undefined ? '' : String(initial)); e.currentTarget.blur(); }
      }}
      style={{
        width: 60,
        padding: '1px 4px',
        border: '1px solid var(--color-border)', borderRadius: 3,
        fontSize: '0.78rem', fontFamily: 'inherit', textAlign: 'right',
        background: '#fff', color: 'var(--color-text)',
      }}
    />
  );
}

// Maps CTS Line Item costs to pass-through billing. Pass-through is a
// property of the (Line Item, Type) pair — not of an individual row —
// so ticking one here bills every matching CTS row at face cost on
// every option, with no markup and no contribution to Deal margin.
// Pairs come from every option in the loaded workbook, plus any pair
// already mapped (so a mapping stays clearable after the workbook it
// came from is gone).
function PassThroughSection({
  workbook,
  activeOpt,
  linkedToPassThroughDefaults,
  setLinkedToPassThroughDefault,
  linkedToDefaultKey,
  effectiveType,
}) {
  const [filter, setFilter] = useState('');
  const [mappedOnly, setMappedOnly] = useState(false);

  const rows = useMemo(() => {
    const byKey = new Map();
    const activeNumber = activeOpt?.optionNumber;
    for (const opt of workbook?.options || []) {
      for (const section of opt.sections || []) {
        for (const item of section.items || []) {
          const key = linkedToDefaultKey(item.description, effectiveType(item));
          let row = byKey.get(key);
          if (!row) {
            row = {
              key,
              lineItem: item.description || '',
              type: effectiveType(item),
              options: new Set(),
              activeCts: null,
              reachable: true,
            };
            byKey.set(key, row);
          }
          row.options.add(opt.sheetName);
          if (opt.optionNumber === activeNumber && typeof item.cts === 'number') {
            row.activeCts = (row.activeCts || 0) + item.cts;
          }
        }
      }
    }
    // Mapped pairs the current workbook can't reach still need a row —
    // otherwise the mapping is invisible and impossible to undo.
    for (const [key, on] of Object.entries(linkedToPassThroughDefaults || {})) {
      if (!on || byKey.has(key)) continue;
      const [keyItem, keyType] = String(key).split('::');
      byKey.set(key, {
        key,
        lineItem: keyItem || '',
        type: keyType || '',
        options: new Set(),
        activeCts: null,
        reachable: false,
      });
    }
    return [...byKey.values()].sort((a, b) =>
      (a.lineItem || '').localeCompare(b.lineItem || '')
      || (a.type || '').localeCompare(b.type || ''));
  }, [workbook, activeOpt, linkedToPassThroughDefaults, linkedToDefaultKey, effectiveType]);

  const mappedCount = rows.filter(r => linkedToPassThroughDefaults?.[r.key] === true).length;

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter(r => {
      if (mappedOnly && linkedToPassThroughDefaults?.[r.key] !== true) return false;
      if (!q) return true;
      return r.lineItem.toLowerCase().includes(q) || (r.type || '').toLowerCase().includes(q);
    });
  }, [rows, filter, mappedOnly, linkedToPassThroughDefaults]);

  return (
    <section className={styles.linkedSection}>
      <h3 className={styles.linkedSubheading}>Pass-through line items ({mappedCount})</h3>
      <p className={styles.linkedHint}>
        Tick a Line Item + Type pair to bill its CTS to the customer at face cost — no markup, and excluded
        from Deal margin (its revenue and cost cancel out). The mapping applies to every matching row on every
        option and persists across uploaded files, the Clear button, and parser updates. Rows mapped here are
        shaded on the Pricing table and their GM% cell reads <code>pass</code>.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter line items…"
          style={{
            flex: '0 1 220px', padding: '0.3rem 0.45rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.8rem' }}>
          <input
            type="checkbox"
            checked={mappedOnly}
            onChange={(e) => setMappedOnly(e.target.checked)}
          />
          Pass-through only
        </label>
      </div>
      {filteredRows.length === 0 ? (
        <div className={styles.linkedEmptyInline}>
          {rows.length === 0
            ? 'No line items yet. Upload a workbook on the Pricing subtab.'
            : (mappedOnly && mappedCount === 0
              ? 'Nothing is mapped as pass-through yet.'
              : 'No line items match the filter.')}
        </div>
      ) : (
        <table className={styles.linkedTable}>
          <thead>
            <tr>
              <th style={{ width: '38%' }}>Line Item</th>
              <th>Type</th>
              <th>CTS ({activeOpt?.sheetName || 'active option'})</th>
              <th>On options</th>
              <th style={{ width: 110 }}>Pass-through</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(row => {
              const on = linkedToPassThroughDefaults?.[row.key] === true;
              return (
                <tr key={row.key} className={on ? styles.passThroughRow : undefined}>
                  <td>
                    {row.lineItem || <span className={styles.linkedMuted}>-</span>}
                    {workbook && !row.reachable && (
                      <span className={styles.linkedMuted}> · not in this workbook</span>
                    )}
                  </td>
                  <td>{row.type || <span className={styles.linkedMuted}>-</span>}</td>
                  <td>
                    {row.activeCts == null
                      ? <span className={styles.linkedMuted}>-</span>
                      : fmtMoney(row.activeCts)}
                  </td>
                  <td>
                    {row.options.size === 0
                      ? <span className={styles.linkedMuted}>-</span>
                      : [...row.options].join(', ')}
                  </td>
                  <td title="Bill every CTS row with this Line Item + Type at cost, on every option.">
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem' }}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => setLinkedToPassThroughDefault && setLinkedToPassThroughDefault(row.key, e.target.checked)}
                      />
                      {on ? 'Yes' : 'No'}
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

// Read-only panel describing the existing Linked To logic and showing
// the active relationships on the current workbook. Rendered on the
// "Linked To" page subtab.
function LinkedToPanel({
  workbook,
  activeOption,
  setActiveOption,
  overrides,
  linkedToDefaults,
  linkedToUnitDefaults,
  setLinkedToUnitDefault,
  linkedToStartMonthDefaults,
  setLinkedToStartMonthDefault,
  linkedToPassThroughDefaults,
  feeDefaults,
  setFeeDefaultField,
  removeFeeDefault,
  linkedToOptionsList,
  setLinkedToPassThroughDefault,
  altFees,
  resolvedLinkedTo,
  effectiveType,
  linkedToDefaultKey,
  removeLinkedToDefault,
  lineItemServices,
  setLineItemServices,
  lineItemIgnored,
  setLineItemIgnored,
  solutionsOptions,
}) {
  const opt = workbook?.options.find(o => o.optionNumber === activeOption) || workbook?.options[0];
  const flatItems = opt ? opt.sections.flatMap(s => s.items) : [];

  // Per-row overrides on the active option, including ones that are
  // explicit empty strings (which mute an inherited default).
  const overrideRows = flatItems
    .map(item => {
      const ov = overrides[item.id]?.linkedTo;
      if (ov === undefined) return null;
      return { item, override: ov, type: effectiveType(item) };
    })
    .filter(Boolean);

  // Every saved (Line Item, Type) default, regardless of whether the
  // current workbook has a row matching it. When a workbook is loaded,
  // we surface the original-case Line Item / Type from a matching row;
  // unreachable defaults (or defaults shown without any workbook) fall
  // back to the stored lowercase key. Each row carries a delete button
  // so defaults can be cleaned up even when no file is loaded.
  // Pick the active option's alt-fee rows so we can auto-fill the Unit
  // column from whichever row carries the matching alt item. Lowercase
  // match keeps "Network Services" / "network services" aligned with
  // how Linked-To resolution works elsewhere on the page.
  const activeAltRows = opt ? (altFees?.[opt.optionNumber] || []) : [];
  const unitByAltItemLower = new Map();
  for (const r of activeAltRows) {
    const t = String(r.altItem || '').trim().toLowerCase();
    if (!t) continue;
    if (!unitByAltItemLower.has(t)) unitByAltItemLower.set(t, r.unit || '');
  }
  const unitCountForOption = (unit) => {
    if (unit === 'Per Site' && typeof opt?.siteCount === 'number' && opt.siteCount > 0) return opt.siteCount;
    if (unit === 'Per Account' && typeof opt?.accountCount === 'number' && opt.accountCount > 0) return opt.accountCount;
    return null;
  };

  const defaultEntries = (() => {
    const labelByKey = new Map();
    // Earliest start month seen on any CTS row matching this
    // (Line Item, Type) pair on the active option. Same value flows
    // into the alt-fee row tagged with this default's Linked To.
    const startMonthByKey = new Map();
    for (const item of flatItems) {
      const key = linkedToDefaultKey(item.description, effectiveType(item));
      if (!labelByKey.has(key)) labelByKey.set(key, { lineItem: item.description, type: effectiveType(item) });
      const sm = Number(item.startMonth);
      if (Number.isFinite(sm) && sm > 0) {
        const prev = startMonthByKey.get(key);
        if (prev == null || sm < prev) startMonthByKey.set(key, sm);
      }
    }
    const rows = [];
    for (const [key, value] of Object.entries(linkedToDefaults)) {
      if (!value) continue;
      const labels = labelByKey.get(key);
      const [keyItem, keyType] = key.split('::');
      const tagLower = String(value).trim().toLowerCase();
      const autoUnit = tagLower ? (unitByAltItemLower.get(tagLower) || '') : '';
      const overrideUnit = linkedToUnitDefaults?.[key] || '';
      const effectiveUnit = overrideUnit || autoUnit;
      const autoStartMonth = startMonthByKey.get(key) ?? null;
      const overrideStartMonthRaw = linkedToStartMonthDefaults?.[key];
      const overrideStartMonth = Number.isFinite(Number(overrideStartMonthRaw)) && Number(overrideStartMonthRaw) > 0
        ? Number(overrideStartMonthRaw)
        : null;
      rows.push({
        key,
        value,
        lineItem: labels?.lineItem || keyItem || '',
        type: labels?.type ?? (keyType || ''),
        reachable: !!labels,
        autoUnit,
        overrideUnit,
        effectiveUnit,
        autoStartMonth,
        overrideStartMonth,
        effectiveStartMonth: overrideStartMonth ?? autoStartMonth,
      });
    }
    rows.sort((a, b) => (a.lineItem || '').localeCompare(b.lineItem || ''));
    return rows;
  })();

  // Every Automated Fee Name in play, so each one can carry its own Fee
  // Type / Fee Start Month / Unit default. Names come from the saved
  // (Line Item, Type) defaults, per-row overrides, the alt-fee schedules of
  // every option, and the hand-added dropdown options — deduped
  // case-insensitively, first casing seen wins for display. A name the user
  // removed from the dropdown is dropped too, unless something still uses it
  // or it already carries a default.
  const feeNameEntries = (() => {
    const label = new Map();  // lower -> display casing
    const used = new Set();   // lower names something actually references
    const add = (name, isUsed) => {
      const trimmed = String(name || '').trim();
      if (!trimmed) return;
      const k = trimmed.toLowerCase();
      if (!label.has(k)) label.set(k, trimmed);
      if (isUsed) used.add(k);
    };
    for (const v of Object.values(linkedToDefaults || {})) add(v, true);
    for (const o of Object.values(overrides || {})) if (o?.linkedTo) add(o.linkedTo, true);
    for (const rows of Object.values(altFees || {})) {
      for (const r of (rows || [])) add(r?.altItem, true);
    }
    for (const c of (linkedToOptionsList?.custom || [])) add(c, false);
    // Last, so a name already seen somewhere keeps that casing — these keys
    // are lowercased.
    for (const k of Object.keys(feeDefaults || {})) add(k, true);
    const hidden = new Set((linkedToOptionsList?.hidden || []).map(v => String(v).trim().toLowerCase()));
    return [...label.entries()]
      .filter(([k]) => used.has(k) || !hidden.has(k))
      .map(([k, name]) => {
        const def = feeDefaults?.[k] || null;
        return {
          key: k,
          name,
          type: def?.type || '',
          startMonth: Number.isFinite(Number(def?.startMonth)) && Number(def?.startMonth) > 0
            ? Number(def.startMonth)
            : null,
          unit: def?.unit || '',
          hasDefault: !!def && Object.keys(def).length > 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  })();

  // Group rows by the alt-fee tag they currently resolve to. Untagged
  // rows go under "(no link)".
  const byTag = new Map();
  for (const item of flatItems) {
    const tag = resolvedLinkedTo(item).trim();
    const key = tag || '(no link)';
    if (!byTag.has(key)) byTag.set(key, []);
    byTag.get(key).push(item);
  }
  // Surface tags referenced by alt-fee rows even when no CTS row links
  // to them yet — those are the dangling alt-fee tags the user might
  // want to wire up.
  const altRows = opt ? (altFees[opt.optionNumber] || []) : [];
  const altTags = new Set();
  for (const r of altRows) {
    const t = (r.altItem || '').trim();
    if (t) altTags.add(t);
  }
  for (const t of altTags) {
    if (!byTag.has(t)) byTag.set(t, []);
  }
  const tagEntries = Array.from(byTag.entries())
    .filter(([k]) => k !== '(no link)')
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className={styles.linkedPanel}>
      <section className={styles.linkedDocBlock}>
        <h2 className={styles.linkedHeading}>How "Linked To" works</h2>
        <ul className={styles.linkedDocList}>
          <li>
            Every upper-table CTS row carries a free-text <strong>Linked To</strong> tag. It connects a cost row
            to the alt-fee item (lower table) that recovers that cost.
          </li>
          <li>
            Resolution order: a <strong>per-row override</strong> always wins. With no override, the row falls
            back to the saved <strong>default for its (Line Item, Type) pair</strong>. With neither, the row is unlinked.
          </li>
          <li>
            The ☆ / ★ button next to the input <strong>promotes the current value to the default</strong> for
            that (Line Item, Type) pair across every option: or clears it. Defaults persist with the page state.
          </li>
          <li>
            Alt-fee margin: for each alt-fee tag, the page sums <em>fee × unit count</em> over alt-fee rows
            sharing the tag (recurring rows are projected over the term with the annual escalator), then sums
            CTS over upper-table rows whose resolved Linked To matches the tag. <code>margin% = (fee − cost) / fee</code>.
          </li>
          <li>
            The bottom-of-page breakdown chart filters rows by the tag selected in its dropdown: only CTS rows
            whose resolved Linked To matches that tag contribute to the chart.
          </li>
          <li>
            <strong>Pass-through</strong> is mapped on the same (Line Item, Type) pair, in the section below.
            A mapped pair bills its CTS at face cost on every option — no markup, and excluded from Deal
            margin. There is no per-row toggle on the pricing table.
          </li>
          <li>
            Matching is case-insensitive and ignores surrounding whitespace.
          </li>
        </ul>
      </section>

      <section className={styles.linkedSection}>
        <h3 className={styles.linkedSubheading}>Saved defaults ({defaultEntries.length})</h3>
        <p className={styles.linkedHint}>
          Defaults apply to any row matching the same Line Item + Type, on any option, unless that row has its own override. They persist across uploaded files, the Clear button, and parser updates.
        </p>
        {defaultEntries.length === 0 ? (
          <div className={styles.linkedEmptyInline}>No saved defaults yet. Click the ☆ next to any Linked To input to save one.</div>
        ) : (
          <table className={styles.linkedTable}>
            <thead>
              <tr>
                <th>Line Item</th>
                <th>Type</th>
                <th>Unit</th>
                <th>Default Linked To</th>
                <th>Fee Start Month</th>
                <th style={{ width: 32 }} />
              </tr>
            </thead>
            <tbody>
              {defaultEntries.map(d => {
                const unitCount = unitCountForOption(d.effectiveUnit);
                return (
                  <tr key={d.key}>
                    <td>
                      {d.lineItem || <span className={styles.linkedMuted}>-</span>}
                      {workbook && !d.reachable && <span className={styles.linkedMuted}> · not on this option</span>}
                    </td>
                    <td>{d.type || <span className={styles.linkedMuted}>-</span>}</td>
                    <td>
                      <select
                        value={d.overrideUnit}
                        onChange={(e) => setLinkedToUnitDefault && setLinkedToUnitDefault(d.key, e.target.value)}
                        title={d.overrideUnit
                          ? 'Override saved for this Line Item + Type. Clear to fall back to the matching alt-fee row.'
                          : d.autoUnit
                            ? `Auto-filled from the "${d.value}" alt-fee row. Pick a value to override.`
                            : 'Pick a unit. Per Site / Per Account inherit the SIA count automatically.'}
                        style={{
                          padding: '1px 4px',
                          border: '1px solid var(--color-border)', borderRadius: 3,
                          fontSize: '0.78rem', fontFamily: 'inherit',
                          background: '#fff', color: 'var(--color-text)',
                        }}
                      >
                        <option value="">{d.autoUnit ? `Auto: ${d.autoUnit}` : '-'}</option>
                        <option value="Fixed">Fixed</option>
                        <option value="Per Site">Per Site</option>
                        <option value="Per Account">Per Account</option>
                        <option value="Per Meter">Per Meter</option>
                      </select>
                      {unitCount != null && (
                        <span className={styles.linkedMuted} style={{ marginLeft: 6 }}>({unitCount})</span>
                      )}
                    </td>
                    <td><code>{d.value}</code></td>
                    <td title={d.overrideStartMonth != null
                      ? `Override saved for this Line Item + Type. Auto would be ${d.autoStartMonth ?? '-'}. Clear to fall back to the CTS row's start month.`
                      : (d.autoStartMonth != null
                        ? `Auto-derived from the CTS rows matching this Line Item + Type on the active option (month ${d.autoStartMonth}). Type a value to override; the override flows into the matching alt-fee row's Fee Start Month.`
                        : 'Type a value to set the Fee Start Month for any alt-fee row linked to this default.')}>
                      <LinkedStartMonthInput
                        key={`${d.key}-${d.overrideStartMonth ?? ''}-${d.autoStartMonth ?? ''}`}
                        initial={d.overrideStartMonth ?? ''}
                        placeholder={d.autoStartMonth != null ? String(d.autoStartMonth) : ''}
                        onCommit={(v) => setLinkedToStartMonthDefault && setLinkedToStartMonthDefault(d.key, v)}
                      />
                    </td>
                    <td>
                      {removeLinkedToDefault && (
                        <button
                          type="button"
                          className={styles.rowDelBtn}
                          title="Remove this saved default"
                          onClick={() => removeLinkedToDefault(d.key)}
                        >×</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <PassThroughSection
        workbook={workbook}
        activeOpt={opt}
        linkedToPassThroughDefaults={linkedToPassThroughDefaults}
        setLinkedToPassThroughDefault={setLinkedToPassThroughDefault}
        linkedToDefaultKey={linkedToDefaultKey}
        effectiveType={effectiveType}
      />

      <section className={styles.linkedSection}>
        <h3 className={styles.linkedSubheading}>Fee defaults ({feeNameEntries.length})</h3>
        <p className={styles.linkedHint}>
          Defaults for the fees themselves — the values in the <strong>Default Linked To</strong> column above.
          Setting a Fee Type or Unit here retypes every Alternative Fee schedule row carrying that name, on every
          option, and pre-fills the rows built for it later (Build from Automated Fee Names, the per-row
          <strong>+ Fee</strong> button, and the schedule an uploaded SIA brings with it). A Fee Type also keeps
          the name to a single row, whatever its costs are typed as. Fee Start Month applies live to every row
          carrying the name unless that row has a typed-in value of its own. Clearing a default leaves the rows
          it already set alone.
        </p>
        {feeNameEntries.length === 0 ? (
          <div className={styles.linkedEmptyInline}>
            No fee names yet. Tag a row&apos;s Automated Fee Name — or save a default above — and it shows up here.
          </div>
        ) : (
          <table className={styles.linkedTable}>
            <thead>
              <tr>
                <th>Fee Name</th>
                <th>Fee Type</th>
                <th>Fee Start Month</th>
                <th>Unit</th>
                <th style={{ width: 32 }} />
              </tr>
            </thead>
            <tbody>
              {feeNameEntries.map(f => {
                const unitCount = unitCountForOption(f.unit);
                return (
                  <tr key={f.key}>
                    <td><code>{f.name}</code></td>
                    <td title="Type for every schedule row built for this fee. With one set, the fee gets a single row instead of one per cost bucket.">
                      <select
                        value={f.type}
                        onChange={(e) => setFeeDefaultField && setFeeDefaultField(f.name, 'type', e.target.value)}
                        style={{
                          padding: '1px 4px',
                          border: '1px solid var(--color-border)', borderRadius: 3,
                          fontSize: '0.78rem', fontFamily: 'inherit',
                          background: '#fff', color: 'var(--color-text)',
                        }}
                      >
                        <option value="">-</option>
                        <option value="Setup">Setup</option>
                        <option value="One Time">One Time</option>
                        <option value="Recurring (monthly)">Recurring (monthly)</option>
                      </select>
                    </td>
                    <td title="Fee Start Month for every schedule row carrying this name. Outranks the month derived from the linked CTS rows; a value typed on the row itself still wins.">
                      <LinkedStartMonthInput
                        key={`fee-${f.key}-${f.startMonth ?? ''}`}
                        initial={f.startMonth ?? ''}
                        placeholder=""
                        onCommit={(v) => setFeeDefaultField && setFeeDefaultField(f.name, 'startMonth', v)}
                      />
                    </td>
                    <td title="Unit for every schedule row built for this fee. Per Site / Per Account inherit the SIA count automatically.">
                      <select
                        value={f.unit}
                        onChange={(e) => setFeeDefaultField && setFeeDefaultField(f.name, 'unit', e.target.value)}
                        style={{
                          padding: '1px 4px',
                          border: '1px solid var(--color-border)', borderRadius: 3,
                          fontSize: '0.78rem', fontFamily: 'inherit',
                          background: '#fff', color: 'var(--color-text)',
                        }}
                      >
                        <option value="">-</option>
                        <option value="Fixed">Fixed</option>
                        <option value="Per Site">Per Site</option>
                        <option value="Per Account">Per Account</option>
                        <option value="Per Meter">Per Meter</option>
                      </select>
                      {unitCount != null && (
                        <span className={styles.linkedMuted} style={{ marginLeft: 6 }}>({unitCount})</span>
                      )}
                    </td>
                    <td>
                      {f.hasDefault && removeFeeDefault && (
                        <button
                          type="button"
                          className={styles.rowDelBtn}
                          title="Clear every default saved for this fee"
                          onClick={() => removeFeeDefault(f.name)}
                        >×</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <LineItemServicesSection
        workbookItems={flatItems}
        lineItemServices={lineItemServices}
        setLineItemServices={setLineItemServices}
        lineItemIgnored={lineItemIgnored}
        setLineItemIgnored={setLineItemIgnored}
        solutionsOptions={solutionsOptions}
      />

      {!workbook ? (
        <div className={styles.linkedEmpty}>
          Upload a workbook on the <strong>Pricing</strong> subtab to see per-row overrides and live tag wiring.
        </div>
      ) : (
        <>
          <div className={styles.subtabStrip} style={{ marginTop: '0.75rem' }}>
            {workbook.options.map(o => {
              const isActive = o.optionNumber === (opt?.optionNumber);
              return (
                <button
                  key={o.sheetName}
                  type="button"
                  className={isActive ? styles.subtabActive : styles.subtab}
                  onClick={() => setActiveOption(o.optionNumber)}
                >
                  {o.sheetName}
                </button>
              );
            })}
          </div>

          <section className={styles.linkedSection}>
            <h3 className={styles.linkedSubheading}>Per-row overrides ({overrideRows.length})</h3>
            <p className={styles.linkedHint}>
              Overrides set on individual rows of this option. An empty override mutes any inherited default.
            </p>
            {overrideRows.length === 0 ? (
              <div className={styles.linkedEmptyInline}>No per-row overrides on this option.</div>
            ) : (
              <table className={styles.linkedTable}>
                <thead>
                  <tr><th>Line Item</th><th>Type</th><th>Override</th></tr>
                </thead>
                <tbody>
                  {overrideRows.map(({ item, override, type }) => (
                    <tr key={item.id}>
                      <td>{item.description}</td>
                      <td>{type || <span className={styles.linkedMuted}>-</span>}</td>
                      <td>
                        {override
                          ? <code>{override}</code>
                          : <span className={styles.linkedMuted}>(cleared: inherits nothing)</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className={styles.linkedSection}>
            <h3 className={styles.linkedSubheading}>Tag → linked CTS rows ({tagEntries.length})</h3>
            <p className={styles.linkedHint}>
              Live mapping of resolved Linked To values to the CTS rows that carry them. Tags marked
              <span className={styles.linkedBadge}> alt-fee</span> are referenced by at least one alt-fee
              row; tags with no badge are linked only on the CTS side and will not contribute to alt-fee margin.
            </p>
            {tagEntries.length === 0 ? (
              <div className={styles.linkedEmptyInline}>No Linked To tags resolve on this option yet.</div>
            ) : (
              <table className={styles.linkedTable}>
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Source</th>
                    <th>Linked CTS row</th>
                    <th>Type</th>
                    <th>Start Month</th>
                  </tr>
                </thead>
                <tbody>
                  {tagEntries.map(([tag, items]) => {
                    const lower = tag.toLowerCase();
                    const altMatch = Array.from(altTags).some(t => t.toLowerCase() === lower);
                    const sourceCell = altMatch
                      ? <span className={styles.linkedBadge}>alt-fee</span>
                      : <span className={styles.linkedMuted}>CTS only</span>;
                    if (items.length === 0) {
                      return (
                        <tr key={tag}>
                          <td><code>{tag}</code></td>
                          <td>{sourceCell}</td>
                          <td colSpan={3}>
                            <span className={styles.linkedMuted}>none: alt-fee tag with no CTS rows linked</span>
                          </td>
                        </tr>
                      );
                    }
                    return items.map((it, idx) => {
                      const sm = Number(it.startMonth);
                      const startMonthCell = Number.isFinite(sm) && sm > 0
                        ? sm
                        : <span className={styles.linkedMuted}>-</span>;
                      return (
                        <tr key={`${tag}-${it.id}`}>
                          {idx === 0 && (
                            <>
                              <td rowSpan={items.length}><code>{tag}</code></td>
                              <td rowSpan={items.length}>{sourceCell}</td>
                            </>
                          )}
                          <td>{it.description}</td>
                          <td>{effectiveType(it)}</td>
                          <td>{startMonthCell}</td>
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// Free-text per-row cell input. Local-draft like GmInput so typing
// doesn't fight a re-rendered controlled value.
function LinkedToInput({ initial, isDefault, onCommit, suggestions = [] }) {
  const [draft, setDraft] = useState(initial || '');
  const listId = useId();
  return (
    <>
      <input
        className={`${styles.linkedInput} ${isDefault ? styles.linkedDefault : ''}`}
        type="text"
        value={draft}
        placeholder="Tie to…"
        title={isDefault ? 'Auto-filled from saved default for this Line Item + Type. Edit to override.' : undefined}
        list={suggestions.length > 0 ? listId : undefined}
        autoComplete="off"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(initial || ''); e.currentTarget.blur(); }
        }}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map(s => <option key={s} value={s} />)}
        </datalist>
      )}
    </>
  );
}

// Manager popup for the Linked To dropdown vocabulary, opened from the
// ± button on the pricing table's Linked To column header. Lists every
// option the dropdown currently offers (auto-derived tags + the user's
// custom adds) with a remove button, shows removed ones with a restore
// button, and takes new options via the input at the top. Add/remove
// handlers live on the parent (addLinkedToOption / removeLinkedToOption)
// so the curation persists with the rest of the pricing cache.
function LinkedToOptionsModal({ autoTags = [], optionsList, onAdd, onRemove, onClose }) {
  const [draft, setDraft] = useState('');
  const custom = optionsList?.custom || [];
  const hidden = optionsList?.hidden || [];
  const hiddenSet = new Set(hidden.map(s => String(s).trim().toLowerCase()));
  const customSet = new Set(custom.map(s => String(s).trim().toLowerCase()));
  const seen = new Map();
  for (const name of [...autoTags, ...custom]) {
    const trimmed = String(name || '').trim();
    if (!trimmed) continue;
    const k = trimmed.toLowerCase();
    if (!seen.has(k) && !hiddenSet.has(k)) seen.set(k, trimmed);
  }
  const visible = [...seen.values()].sort((a, b) => a.localeCompare(b));
  const removed = [...hidden].sort((a, b) => a.localeCompare(b));
  const submit = () => {
    const v = draft.trim();
    if (!v) return;
    onAdd(v);
    setDraft('');
  };
  const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, padding: '0.25rem 0' };
  const xBtnStyle = { padding: '0 7px', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', fontSize: '0.78rem', fontFamily: 'inherit', color: '#b91c1c', cursor: 'pointer', lineHeight: 1.6 };
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
        style={{ width: 440, maxWidth: '92vw', maxHeight: '80vh', background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>Linked To dropdown options</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            These options appear in every row&apos;s Linked To dropdown. Tags already used on saved defaults, alt-fee rows, or row overrides are suggested automatically; removing one keeps it out of the dropdown without touching the rows that use it.
          </div>
        </div>
        <div style={{ padding: '0.85rem 1rem', overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: '0.7rem' }}>
            <input
              autoFocus
              type="text"
              value={draft}
              placeholder="Add an option…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
              style={{ flex: 1, boxSizing: 'border-box', padding: '0.4rem 0.55rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.82rem', fontFamily: 'inherit' }}
            />
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim()}
              style={{ padding: '0.35rem 0.8rem', border: '1px solid var(--color-accent)', borderRadius: 4, background: draft.trim() ? 'var(--color-accent)' : 'var(--color-border-light)', color: draft.trim() ? '#fff' : 'var(--color-text-muted)', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit', cursor: draft.trim() ? 'pointer' : 'not-allowed' }}
            >Add</button>
          </div>
          {visible.length === 0 ? (
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '0.3rem 0' }}>
              No dropdown options yet: add one above, or tag a row and they&apos;ll be suggested automatically.
            </div>
          ) : visible.map(name => {
            const isCustom = customSet.has(name.toLowerCase());
            return (
              <div key={name} style={rowStyle}>
                <span style={{ flex: 1, fontSize: '0.82rem', color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>
                  {name}
                  {isCustom && <span style={{ marginLeft: 6, fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>(added)</span>}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(name)}
                  title={isCustom ? 'Remove this option from the dropdown' : 'Remove this auto-suggested tag from the dropdown (rows using it are unaffected)'}
                  style={xBtnStyle}
                >×</button>
              </div>
            );
          })}
          {removed.length > 0 && (
            <>
              <div style={{ margin: '0.7rem 0 0.3rem', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>
                Removed
              </div>
              {removed.map(name => (
                <div key={name} style={rowStyle}>
                  <span style={{ flex: 1, fontSize: '0.82rem', color: 'var(--color-text-muted)', textDecoration: 'line-through', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>{name}</span>
                  <button
                    type="button"
                    onClick={() => onAdd(name)}
                    title="Restore this option to the dropdown"
                    style={{ ...xBtnStyle, color: 'var(--color-text)' }}
                  >↩</button>
                </div>
              ))}
            </>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0.6rem 1rem', borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '0.35rem 0.85rem', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit', color: 'var(--color-text)', cursor: 'pointer' }}
          >Done</button>
        </div>
      </div>
    </div>
  );
}

const COLS = [
  { key: 'lineItem',    label: 'Line Item',         defaultWidth: 280 },
  { key: 'type',        label: 'Type',              defaultWidth: 140 },
  { key: 'cts',         label: 'CTS',               defaultWidth: 110 },
  { key: 'techDepr',    label: 'Tech Depr.',        defaultWidth: 110 },
  { key: 'start',       label: 'Start Month',       defaultWidth: 100 },
  { key: 'comments',    label: 'Comments',          defaultWidth: 280 },
  { key: 'gm',          label: 'GM%',               defaultWidth: 90 },
  { key: 'price',       label: 'Marked-up Price',   defaultWidth: 140 },
  { key: 'linkedTo',    label: 'Automated Fee Name', defaultWidth: 200 },
  { key: 'siaFee',      label: 'Fee Name Below',     defaultWidth: 190 },
];

// Pass-through used to be a per-row checkbox on the pricing table; it's
// now mapped per (Line Item, Type) pair on the Linked To subtab. Older
// caches and state exports can still carry per-row `passThrough` flags
// that nothing can clear any more, so they're stripped on the way in.
function stripPassThroughOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object') return {};
  let touched = false;
  const next = {};
  for (const [id, ov] of Object.entries(overrides)) {
    if (ov && typeof ov === 'object' && 'passThrough' in ov) {
      touched = true;
      const { passThrough: _drop, ...rest } = ov;
      if (Object.keys(rest).length > 0) next[id] = rest;
    } else {
      next[id] = ov;
    }
  }
  return touched ? next : overrides;
}

const SUMMARY_COLS = [
  { key: 'bucket',     label: 'Bucket',                       defaultWidth: 200 },
  { key: 'cost',       label: 'Cost',                         defaultWidth: 110 },
  { key: 'techDepr',   label: 'Tech Depr.',                   defaultWidth: 110 },
  { key: 'totalCost',  label: 'Total cost (incl. tech depr)', defaultWidth: 150 },
  { key: 'price',      label: 'Marked-up',                    defaultWidth: 130 },
  { key: 'termPrice',  label: 'Term value (marked-up)',       defaultWidth: 160 },
];

const STORE = 'pricing-cache';
const KEY = 'current';
// Saved Linked-To defaults live under their own key so they survive
// parser-version cache wipes, file removal, and switching to a new
// SIA workbook. They're user-curated mappings, not parser output.
const LINKED_TO_DEFAULTS_KEY = 'linkedToDefaults';
// Per (Line Item, Type) Unit override for the Linked-To defaults
// table. Same key shape as LINKED_TO_DEFAULTS_KEY ("lineitem::type",
// lowercased) so a row can carry both a Default Linked To and a
// Default Unit. Persisted on its own DB key for the same reason
// linkedToDefaults are — these mappings outlive workbook reloads.
const LINKED_TO_UNIT_DEFAULTS_KEY = 'linkedToUnitDefaults';
// Per (Line Item, Type) Fee Start Month override. Same key shape, kept
// in its own DB key so it survives workbook reloads / parser bumps.
// Overrides the CTS row's own startMonth when auto-deriving the alt-fee
// row's Fee Start Month and when rendering the Linked To Saved defaults
// table's Fee Start Month column.
const LINKED_TO_START_MONTH_DEFAULTS_KEY = 'linkedToStartMonthDefaults';
// Per (Line Item, Type) Pass-through default. CTS rows matching the
// pair are billed at cost (no markup) unless a per-row override on the
// pricing table says otherwise. Persisted on its own DB key.
const LINKED_TO_PASS_THROUGH_DEFAULTS_KEY = 'linkedToPassThroughDefaults';
// Per-fee defaults, keyed by Automated Fee Name (lowercased, trimmed):
// { [feeName]: { type, startMonth, unit } }. Where the keys above describe a
// COST row's (Line Item, Type) pair, these describe the FEE itself — the
// values in the Default Linked To column — and pre-fill the Alternative Fee
// schedule row built for that name. Its own DB key, for the same reason the
// rest are: they're user-curated and outlive any one workbook.
const FEE_DEFAULTS_KEY = 'feeDefaults';
// User-curated vocabulary for the per-row Linked To dropdown on the
// pricing page. `custom` holds options the user added by hand; `hidden`
// suppresses auto-derived suggestions (tags pulled from saved defaults,
// alt-fee rows, and per-row overrides) the user removed. Persisted on
// its own key so the curation survives parser bumps and Clear-button
// workbook wipes, like the Linked-To defaults above.
const LINKED_TO_OPTIONS_KEY = 'linkedToOptionsList';
// Line Item → Services catalog mapping. Keyed by lowercase line item
// name; value is an array of service strings from the Dropdowns-tab
// Solutions / Service Catalog. Persisted on its own key so it survives
// parser bumps and Clear-button workbook wipes, just like Linked-To
// defaults.
const LINE_ITEM_SERVICES_KEY = 'lineItemServices';
const LINE_ITEM_SERVICES_EVENT = 'pricing:lineItemServicesChanged';
// Line items the user has chosen to ignore in the Line Item → Services
// table. Keyed by lowercase line item name (same shape as the services
// map) and persisted on its own key so the choice survives parser bumps
// and Clear-button wipes. Ignored rows are greyed out and excluded from
// the "missing a service mapping" warning.
const LINE_ITEM_IGNORED_KEY = 'lineItemIgnored';
// Per-Option services bundle derived from the loaded workbook + the
// Line Item → Services mapping. Persisted separately so Opps 2 can
// offer an "Add from Pricing Option" picker on its Scope cell without
// needing to walk the workbook itself.
const OPTION_SERVICES_KEY = 'pricingOptionServices';
const OPTION_SERVICES_EVENT = 'pricing:optionServicesChanged';
// Raw bytes of the most-recently uploaded SIA workbook so that
// "Save to Opp" can attach the source file to the opp without
// requiring the user to re-upload. Stored as a Blob so reload
// rehydrates it cleanly.
const WORKBOOK_SOURCE_KEY = 'workbookSourceBlob';
// Bump this whenever the parser output shape changes — older cached
// parses are silently discarded on hydration so the user re-uploads
// against the current parser.
const PARSER_VERSION = 10;
// Every uploaded SIA gets its own id. "Saved to: <opp>" links are
// stored against it, so a new upload — or a Clear — can never leave an
// opp mapped to whatever file replaced it, even when the new file has
// sheets named exactly like the old one ("Option 1", …).
function newWorkbookId() {
  return `wb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
// Sheet inside Pricing-page exports carrying a JSON snapshot of
// the full page state. Presence of this sheet on a dropped file
// switches the import path from fee-workbook parsing to state
// rehydration. The legacy double-underscore name is still accepted
// for any exports produced before the rename.
const STATE_SHEET_NAME = 'Pricing State';
const LEGACY_STATE_SHEET_NAMES = ['__pricing_state__'];

const fmtMoney = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Pricing page-wide convention: always show two decimal places on
// every currency cell, including aggregated totals.
const fmtMoneyWhole = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

export function PricingView({ settings } = {}) {
  const { user } = useAuth();
  const solutionsOptions = useMemo(() => {
    const lists = getEffectiveDropdownLists(settings);
    const solutions = lists.find(l => l.key === 'solutions');
    return Array.isArray(solutions?.options) ? solutions.options : [];
  }, [settings]);
  const [workbook, setWorkbook] = useState(null); // { fileName, options, sheetNames, loadedAt }
  const [globalGmPct, setGlobalGmPct] = useState(0.5);
  const [overrides, setOverrides] = useState({}); // { [itemId]: { gmPct } }
  const [activeOption, setActiveOption] = useState(null); // optionNumber or null
  const [colWidths, setColWidths] = useState({}); // { [colKey]: pixelWidth }
  const [altFees, setAltFees] = useState({}); // { [optionNumber]: [{ altItem, type, fee, unit, unitCount, startMonth }] }
  // Which of the two fee-name columns the analysis runs off. 'below'
  // maps each cost to a row of the fee schedule underneath (the Fee Name
  // Below pick, falling back to the tag); 'automated' groups costs by
  // their Automated Fee Name to build a fee structure from scratch.
  const [feeMapBy, setFeeMapBy] = useState('below');
  const [exportingMargin, setExportingMargin] = useState(false);
  const [linkedToDefaults, setLinkedToDefaults] = useState({}); // { [`${lineItem}::${type}`]: 'value' }
  const [linkedToUnitDefaults, setLinkedToUnitDefaults] = useState({}); // { [`${lineItem}::${type}`]: 'Per Site' | 'Per Account' | 'Fixed' | 'Per Meter' }
  const [linkedToStartMonthDefaults, setLinkedToStartMonthDefaults] = useState({}); // { [`${lineItem}::${type}`]: number } — overrides the CTS row's startMonth for the auto-derive that feeds alt-fee rows
  const [linkedToPassThroughDefaults, setLinkedToPassThroughDefaults] = useState({}); // { [`${lineItem}::${type}`]: true } — sets pass-through for every CTS row matching the pair, unless the per-row override says otherwise
  const [feeDefaults, setFeeDefaults] = useState({}); // { [feeName]: { type, startMonth, unit } } — per-fee defaults for the Alternative Fee schedule (see FEE_DEFAULTS_KEY)
  const [linkedToOptionsList, setLinkedToOptionsList] = useState({ custom: [], hidden: [] }); // user-curated Linked To dropdown vocabulary (see LINKED_TO_OPTIONS_KEY)
  const [linkedToOptionsModal, setLinkedToOptionsModal] = useState(null); // { autoTags: string[] } — open state for the Linked To options manager
  const [lineItemServices, setLineItemServices] = useState({}); // { [lineItemKey]: string[] }
  const [lineItemIgnored, setLineItemIgnored] = useState({}); // { [lineItemKey]: true } — line items the user opted to ignore (greyed out, excluded from the unmapped warning)
  const [termMonths, setTermMonths] = useState(36);
  const [annualEscalator, setAnnualEscalator] = useState(0.03);
  // Separate escalator for CTS costs — defaults to 3.85% so margin
  // compression year-over-year reflects supplier cost creep, while
  // revenue still escalates at the annual contract rate above.
  const [costEscalator, setCostEscalator] = useState(0.0385);
  const [chartTag, setChartTag] = useState(''); // selected line-item / tag for the breakdown chart
  const [chartView, setChartView] = useState('chart'); // 'chart' | 'table'
  const [chartVisible, setChartVisible] = useState(false); // "Line item year-over-year" panel — hidden by default, user opts in via Show
  const [chartUnitCounts, setChartUnitCounts] = useState({}); // per-line-item unit count (keyed by lowercased tag) for the Fee / Unit column
  const [techDeprPct, setTechDeprPct] = useState(0.04);
  const [colVisibility, setColVisibility] = useState({}); // upper table: { [colKey]: bool, default true }
  const [hideEmptyCtsRows, setHideEmptyCtsRows] = useState(true); // upper table: hide line items with no CTS value by default; user opts in to show them
  const [summaryColWidths, setSummaryColWidths] = useState({});
  const [summaryColVisibility, setSummaryColVisibility] = useState({});
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [summaryMenuOpen, setSummaryMenuOpen] = useState(false);
  const [pageSubtab, setPageSubtab] = useState('pricing'); // 'pricing' | 'linkedTo' | 'options' | 'compare' | 'brokerFees' | 's2c' | 'calculator'
  const [optionsTabData, setOptionsTabData] = useState(null); // OptionsTab state: array of { name, years, escPct, rows: [...] }
  const [compareTabData, setCompareTabData] = useState(null); // CompareTab state: { currentLabel, nextLabel, current: [...], next: [...] }
  const [brokerFeesData, setBrokerFeesData] = useState(null); // BrokerFeesTab state: array of { company, loadEp, feeEp, rfps, loadNg, feeNg }
  const [s2cTabData, setS2cTabData] = useState(null); // S2CTab state: array of { costElement, setup, setupUom, ongoing, ongoingUom }
  // Opps 2 records + Option ↔ Opp link map, shared with the Options
  // sub-tab so saving from either tab updates the Opps 2 "Pricing
  // Option" column. Loaded on mount and refreshed on the cross-tab
  // event so a save anywhere shows up live.
  const [opps2Records, setOpps2Records] = useState([]);
  const [optionLinks, setOptionLinks] = useState({});
  const [pricingPickerOpen, setPricingPickerOpen] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const hydratedRef = useRef(false);
  // Raw Blob of the uploaded SIA workbook. Kept alive in a ref so
  // "Save to Opp" can attach it without re-reading the file input.
  // Also persisted to IndexedDB (see WORKBOOK_SOURCE_KEY) so a page
  // reload doesn't lose it as long as the parsed workbook is still
  // hydrated.
  const workbookSourceRef = useRef(null);

  // Hydrate from IndexedDB on first mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Linked-To defaults are loaded first from their own key so
        // they survive even if the main cache is wiped (parser bump).
        // Fall back to the legacy field on the main cache for users
        // upgrading from before the split.
        const savedDefaults = await dbGet(STORE, LINKED_TO_DEFAULTS_KEY);
        if (!cancelled && savedDefaults && typeof savedDefaults === 'object') {
          setLinkedToDefaults(savedDefaults);
        }
        const savedUnitDefaults = await dbGet(STORE, LINKED_TO_UNIT_DEFAULTS_KEY);
        if (!cancelled && savedUnitDefaults && typeof savedUnitDefaults === 'object') {
          setLinkedToUnitDefaults(savedUnitDefaults);
        }
        const savedStartMonthDefaults = await dbGet(STORE, LINKED_TO_START_MONTH_DEFAULTS_KEY);
        if (!cancelled && savedStartMonthDefaults && typeof savedStartMonthDefaults === 'object') {
          setLinkedToStartMonthDefaults(savedStartMonthDefaults);
        }
        const savedPassThroughDefaults = await dbGet(STORE, LINKED_TO_PASS_THROUGH_DEFAULTS_KEY);
        if (!cancelled && savedPassThroughDefaults && typeof savedPassThroughDefaults === 'object') {
          setLinkedToPassThroughDefaults(savedPassThroughDefaults);
        }
        const savedFeeDefaults = await dbGet(STORE, FEE_DEFAULTS_KEY);
        if (!cancelled && savedFeeDefaults && typeof savedFeeDefaults === 'object') {
          setFeeDefaults(savedFeeDefaults);
        }
        const savedOptionsList = await dbGet(STORE, LINKED_TO_OPTIONS_KEY);
        if (!cancelled && savedOptionsList && typeof savedOptionsList === 'object') {
          setLinkedToOptionsList({
            custom: Array.isArray(savedOptionsList.custom) ? savedOptionsList.custom : [],
            hidden: Array.isArray(savedOptionsList.hidden) ? savedOptionsList.hidden : [],
          });
        }
        const savedLineItemServices = await dbGet(STORE, LINE_ITEM_SERVICES_KEY);
        if (!cancelled && savedLineItemServices && typeof savedLineItemServices === 'object') {
          setLineItemServices(savedLineItemServices);
        }
        const savedLineItemIgnored = await dbGet(STORE, LINE_ITEM_IGNORED_KEY);
        if (!cancelled && savedLineItemIgnored && typeof savedLineItemIgnored === 'object') {
          setLineItemIgnored(savedLineItemIgnored);
        }
        const saved = await dbGet(STORE, KEY);
        if (cancelled || !saved) { hydratedRef.current = true; return; }
        // Drop caches written by an older parser — their workbook
        // shape may not match what the UI now expects. Linked-To
        // defaults are preserved via the separate key above.
        if (saved.parserVersion !== PARSER_VERSION) {
          await dbDelete(STORE, KEY).catch(() => {});
          if (!savedDefaults && saved.linkedToDefaults) setLinkedToDefaults(saved.linkedToDefaults);
          if (!savedUnitDefaults && saved.linkedToUnitDefaults) setLinkedToUnitDefaults(saved.linkedToUnitDefaults);
          if (!savedStartMonthDefaults && saved.linkedToStartMonthDefaults) setLinkedToStartMonthDefaults(saved.linkedToStartMonthDefaults);
          if (!savedPassThroughDefaults && saved.linkedToPassThroughDefaults) setLinkedToPassThroughDefaults(saved.linkedToPassThroughDefaults);
          if (!savedFeeDefaults && saved.feeDefaults) setFeeDefaults(saved.feeDefaults);
          if (!savedOptionsList && saved.linkedToOptionsList && typeof saved.linkedToOptionsList === 'object') {
            setLinkedToOptionsList({
              custom: Array.isArray(saved.linkedToOptionsList.custom) ? saved.linkedToOptionsList.custom : [],
              hidden: Array.isArray(saved.linkedToOptionsList.hidden) ? saved.linkedToOptionsList.hidden : [],
            });
          }
          hydratedRef.current = true;
          return;
        }
        if (saved.workbook) {
          // Caches written before workbooks carried an id get one now.
          // `legacyLinks` marks it as the workbook any untagged (name-
          // only) link was made against, so its "Saved to:" chips keep
          // working until the file is cleared or replaced.
          setWorkbook(saved.workbook.id
            ? saved.workbook
            : { ...saved.workbook, id: newWorkbookId(), legacyLinks: true });
        }
        if (typeof saved.globalGmPct === 'number') setGlobalGmPct(saved.globalGmPct);
        if (saved.overrides) setOverrides(stripPassThroughOverrides(saved.overrides));
        if (typeof saved.activeOption === 'number') setActiveOption(saved.activeOption);
        if (saved.colWidths) setColWidths(saved.colWidths);
        if (saved.altFees) {
          // Bring the cached schedule back in line with the saved fee
          // defaults before it goes on screen: a row that arrived with an
          // upload, or was built before its fee had a default, is stale
          // otherwise — and a stale row is one a fee can be typed into,
          // billing what the live row already bills.
          const hydratedFeeDefaults = (savedFeeDefaults && typeof savedFeeDefaults === 'object')
            ? savedFeeDefaults
            : (saved.feeDefaults || {});
          setAltFees(reconcileScheduleWithFeeDefaults(
            saved.altFees,
            hydratedFeeDefaults,
            saved.workbook?.options || [],
          ));
        }
        if (saved.feeMapBy === 'automated' || saved.feeMapBy === 'below') setFeeMapBy(saved.feeMapBy);
        if (!savedDefaults && saved.linkedToDefaults) setLinkedToDefaults(saved.linkedToDefaults);
        if (!savedUnitDefaults && saved.linkedToUnitDefaults) setLinkedToUnitDefaults(saved.linkedToUnitDefaults);
        if (!savedStartMonthDefaults && saved.linkedToStartMonthDefaults) setLinkedToStartMonthDefaults(saved.linkedToStartMonthDefaults);
        if (!savedPassThroughDefaults && saved.linkedToPassThroughDefaults) setLinkedToPassThroughDefaults(saved.linkedToPassThroughDefaults);
        if (!savedFeeDefaults && saved.feeDefaults) setFeeDefaults(saved.feeDefaults);
        if (!savedOptionsList && saved.linkedToOptionsList && typeof saved.linkedToOptionsList === 'object') {
          setLinkedToOptionsList({
            custom: Array.isArray(saved.linkedToOptionsList.custom) ? saved.linkedToOptionsList.custom : [],
            hidden: Array.isArray(saved.linkedToOptionsList.hidden) ? saved.linkedToOptionsList.hidden : [],
          });
        }
        if (!savedLineItemServices && saved.lineItemServices && typeof saved.lineItemServices === 'object') setLineItemServices(saved.lineItemServices);
        if (!savedLineItemIgnored && saved.lineItemIgnored && typeof saved.lineItemIgnored === 'object') setLineItemIgnored(saved.lineItemIgnored);
        if (typeof saved.termMonths === 'number') setTermMonths(saved.termMonths);
        if (typeof saved.annualEscalator === 'number') setAnnualEscalator(saved.annualEscalator);
        if (typeof saved.costEscalator === 'number') setCostEscalator(saved.costEscalator);
        if (typeof saved.chartTag === 'string') setChartTag(saved.chartTag);
        if (saved.chartView === 'chart' || saved.chartView === 'table') setChartView(saved.chartView);
        if (typeof saved.chartVisible === 'boolean') setChartVisible(saved.chartVisible);
        if (saved.chartUnitCounts && typeof saved.chartUnitCounts === 'object') setChartUnitCounts(saved.chartUnitCounts);
        if (typeof saved.techDeprPct === 'number') setTechDeprPct(saved.techDeprPct);
        if (saved.colVisibility) setColVisibility(saved.colVisibility);
        if (typeof saved.hideEmptyCtsRows === 'boolean') setHideEmptyCtsRows(saved.hideEmptyCtsRows);
        if (saved.summaryColWidths) setSummaryColWidths(saved.summaryColWidths);
        if (saved.summaryColVisibility) setSummaryColVisibility(saved.summaryColVisibility);
        if (saved.pageSubtab === 'pricing' || saved.pageSubtab === 'linkedTo' || saved.pageSubtab === 'options' || saved.pageSubtab === 'compare' || saved.pageSubtab === 'brokerFees' || saved.pageSubtab === 's2c' || saved.pageSubtab === 'calculator') setPageSubtab(saved.pageSubtab);
        if (Array.isArray(saved.s2cTabData)) setS2cTabData(saved.s2cTabData);
        if (Array.isArray(saved.optionsTabData)) setOptionsTabData(saved.optionsTabData);
        if (saved.compareTabData && typeof saved.compareTabData === 'object') setCompareTabData(saved.compareTabData);
        if (Array.isArray(saved.brokerFeesData)) setBrokerFeesData(saved.brokerFeesData);
        // Rehydrate the uploaded SIA workbook bytes so "Save to Opp"
        // can still attach the source file after a page reload.
        try {
          const sourceBlob = await dbGet(STORE, WORKBOOK_SOURCE_KEY);
          if (!cancelled && sourceBlob instanceof Blob) {
            workbookSourceRef.current = sourceBlob;
          }
        } catch { /* ignore */ }
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
    const payload = { parserVersion: PARSER_VERSION, workbook, globalGmPct, overrides, activeOption, colWidths, altFees, feeMapBy, linkedToDefaults, linkedToUnitDefaults, linkedToStartMonthDefaults, linkedToPassThroughDefaults, feeDefaults, linkedToOptionsList, lineItemServices, lineItemIgnored, termMonths, annualEscalator, costEscalator, chartTag, chartView, chartVisible, chartUnitCounts, techDeprPct, colVisibility, hideEmptyCtsRows, summaryColWidths, summaryColVisibility, pageSubtab, optionsTabData, compareTabData, brokerFeesData, s2cTabData };
    dbPut(STORE, payload, KEY).catch(err => console.warn('Failed to save pricing cache:', err));
  }, [workbook, globalGmPct, overrides, activeOption, colWidths, altFees, feeMapBy, linkedToDefaults, linkedToUnitDefaults, linkedToStartMonthDefaults, linkedToPassThroughDefaults, feeDefaults, linkedToOptionsList, lineItemServices, lineItemIgnored, termMonths, annualEscalator, costEscalator, chartTag, chartView, chartVisible, chartUnitCounts, techDeprPct, colVisibility, hideEmptyCtsRows, summaryColWidths, summaryColVisibility, pageSubtab, optionsTabData, compareTabData, brokerFeesData, s2cTabData]);

  // Mirror Linked-To defaults under their dedicated key so they
  // outlive the main cache (parser-version bumps, Clear button,
  // file removal). The main-cache copy above is kept for in-app
  // state-snapshot exports.
  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, linkedToDefaults, LINKED_TO_DEFAULTS_KEY).catch(err => console.warn('Failed to save linked-to defaults:', err));
  }, [linkedToDefaults]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, linkedToUnitDefaults, LINKED_TO_UNIT_DEFAULTS_KEY).catch(err => console.warn('Failed to save linked-to unit defaults:', err));
  }, [linkedToUnitDefaults]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, linkedToOptionsList, LINKED_TO_OPTIONS_KEY).catch(err => console.warn('Failed to save linked-to options list:', err));
  }, [linkedToOptionsList]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, linkedToStartMonthDefaults, LINKED_TO_START_MONTH_DEFAULTS_KEY).catch(err => console.warn('Failed to save linked-to start-month defaults:', err));
  }, [linkedToStartMonthDefaults]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, linkedToPassThroughDefaults, LINKED_TO_PASS_THROUGH_DEFAULTS_KEY).catch(err => console.warn('Failed to save linked-to pass-through defaults:', err));
  }, [linkedToPassThroughDefaults]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, feeDefaults, FEE_DEFAULTS_KEY).catch(err => console.warn('Failed to save fee defaults:', err));
  }, [feeDefaults]);

  // Line items on the active option that still need a service, for the
  // banner on the Pricing subtab. Computed from the same rows and the same
  // rule the Linked To editor runs, and off the active option for the same
  // reason that page's table is: the banner has to name the work the table
  // it links to will actually show.
  const unmappedForBanner = useMemo(() => {
    const opt = workbook?.options.find(o => o.optionNumber === activeOption) || workbook?.options?.[0];
    const items = opt ? opt.sections.flatMap(sec => sec.items) : [];
    return unmappedLineItems({
      workbookItems: items,
      lineItemServices,
      lineItemIgnored,
      solutionsOptions,
    });
  }, [workbook, activeOption, lineItemServices, lineItemIgnored, solutionsOptions]);

  // Persist Line Item → Services mapping on its own key and broadcast
  // a custom event so other views (Opps 2's Scope cell) can refresh
  // their cached copy without waiting for a remount.
  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, lineItemServices, LINE_ITEM_SERVICES_KEY).catch(err => console.warn('Failed to save line-item services:', err));
    try {
      window.dispatchEvent(new CustomEvent(LINE_ITEM_SERVICES_EVENT, { detail: lineItemServices }));
    } catch { /* CustomEvent unavailable */ }
  }, [lineItemServices]);

  // Persist the ignored-line-item set on its own key so it outlives the
  // main cache (parser bumps, Clear button). No broadcast event — the
  // ignore flag is only consumed inside this view's mapping table.
  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, lineItemIgnored, LINE_ITEM_IGNORED_KEY).catch(err => console.warn('Failed to save ignored line items:', err));
  }, [lineItemIgnored]);

  // Derive a per-Pricing-Option services bundle by walking each option's
  // line items, looking up their saved services in lineItemServices,
  // and unioning the results (case-insensitive dedupe, original casing
  // preserved). Keyed by sheet name so the Opps 2 picker can show the
  // same labels the Pricing tab does.
  const pricingOptionServices = useMemo(() => {
    if (!workbook || !Array.isArray(workbook.options)) return {};
    const out = {};
    for (const o of workbook.options) {
      const seen = new Set();
      const services = [];
      for (const sec of (o.sections || [])) {
        for (const item of (sec.items || [])) {
          const key = String(item.description || '').trim().toLowerCase();
          const mapped = key && lineItemServices ? lineItemServices[key] : null;
          if (!Array.isArray(mapped)) continue;
          for (const s of mapped) {
            const k = String(s || '').toLowerCase();
            if (!k || seen.has(k)) continue;
            seen.add(k);
            services.push(s);
          }
        }
      }
      out[o.sheetName] = services;
    }
    return out;
  }, [workbook, lineItemServices]);

  // Persist the derived per-Option bundle and broadcast a change so
  // Opps 2 can refresh its picker without needing the workbook itself.
  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, pricingOptionServices, OPTION_SERVICES_KEY).catch(err => console.warn('Failed to save option services:', err));
    try {
      window.dispatchEvent(new CustomEvent(OPTION_SERVICES_EVENT, { detail: pricingOptionServices }));
    } catch { /* CustomEvent unavailable */ }
  }, [pricingOptionServices]);

  // Effective per-row cost = supplier CTS + tech depreciation. Tech
  // depr is item.cts × techDeprPct for non-pass-through rows (pass-
  // through bills at face cost, so no depreciation is booked against
  // it). Every cost-projection path that drives margin or the cost
  // export uses this so the depreciation burden flows through both
  // the per-year cost breakdown and the Deal margin calc.
  function ctsItemEffectiveCost(item) {
    if (typeof item.cts !== 'number') return 0;
    if (isPassThrough(item)) return item.cts;
    return item.cts * (1 + techDeprPct);
  }

  // Per-year cost contribution from a single upper-table CTS item.
  // Setup / One Time hit year 1 in full; Rolled variants amortize
  // evenly across the term and escalate; Recurring (monthly) bills
  // 12 months per year and escalates.
  function ctsItemYearCost(item, yearIndex) {
    if (typeof item.cts !== 'number') return 0;
    const t = effectiveType(item);
    const isRecurring = /recurring.*monthly|monthly.*recurring|^recurring/i.test(t);
    const yearStart = (yearIndex - 1) * 12 + 1;
    const yearEnd = yearIndex * 12;
    // CTS row's Start Month (column on the pricing table) — defaults
    // to 1. Mirrors how altFeeYearRevenue treats the alt-fee row's
    // startMonth so the per-year cost breakdown lines up with the
    // per-year revenue breakdown for any pass-through link.
    const startMonth = Math.max(1, Math.round(Number(item.startMonth) || 1));
    // Effective per-row cost folds tech depr into non-pass-through
    // cost so margin reflects depreciation alongside supplier cost.
    const baseCost = ctsItemEffectiveCost(item);
    if (isRecurring) {
      const billStart = Math.max(yearStart, startMonth);
      const billEnd = Math.min(yearEnd, termMonths);
      if (billEnd < billStart) return 0;
      const months = billEnd - billStart + 1;
      const esc = Math.pow(1 + costEscalator, yearIndex - 1);
      return baseCost * months * esc;
    }
    // Setup / One Time + Setup-Rolled / One-Time-Rolled: cost lands
    // upfront in the year containing startMonth. Rolled variants still
    // amortize their *billing* over the term on the revenue side
    // (autoFee / altFeeYearRevenue handle that), but the cost has
    // already been incurred — so margin should book it in Y1 instead
    // of spreading it monthly.
    if (startMonth > termMonths) return 0;
    if (startMonth >= yearStart && startMonth <= yearEnd) return baseCost;
    return 0;
  }

  // Per-year revenue (marked-up price) from a single upper-table CTS
  // item — the price mirror of ctsItemYearCost. Setup / One Time land
  // upfront in the year containing their start month; Recurring
  // (monthly) bills 12 months per year; Rolled variants amortize their
  // billing evenly across the term. Recurring / Rolled revenue escalates
  // with the revenue escalator (annualEscalator), matching how term
  // price is projected elsewhere. Used by the line-item year-over-year
  // table so a tag with linked CTS rows but no Alternative Fee row still
  // shows the Fee and Margin from the prices the customer actually pays.
  function ctsItemYearRevenue(item, yearIndex) {
    if (typeof item.cts !== 'number') return 0;
    const { price } = priceFor(item);
    if (typeof price !== 'number' || !Number.isFinite(price)) return 0;
    const t = effectiveType(item);
    const isRecurring = /recurring.*monthly|monthly.*recurring|^recurring/i.test(t);
    const isRolled = /\brolled\b/i.test(t);
    const yearStart = (yearIndex - 1) * 12 + 1;
    const yearEnd = yearIndex * 12;
    const startMonth = Math.max(1, Math.round(Number(item.startMonth) || 1));
    if (isRecurring) {
      const billStart = Math.max(yearStart, startMonth);
      const billEnd = Math.min(yearEnd, termMonths);
      if (billEnd < billStart) return 0;
      const months = billEnd - billStart + 1;
      const esc = Math.pow(1 + annualEscalator, yearIndex - 1);
      return price * months * esc;
    }
    if (isRolled && termMonths > 0) {
      // Cost books upfront (ctsItemYearCost) but billing is amortized
      // across the term on the revenue side, so spread the price evenly
      // over every month of the term and escalate it annually.
      const billStart = Math.max(yearStart, startMonth);
      const billEnd = Math.min(yearEnd, termMonths);
      if (billEnd < billStart) return 0;
      const months = billEnd - billStart + 1;
      const esc = Math.pow(1 + annualEscalator, yearIndex - 1);
      return (price / termMonths) * months * esc;
    }
    if (startMonth > termMonths) return 0;
    if (startMonth >= yearStart && startMonth <= yearEnd) return price;
    return 0;
  }

  // Revenue from a single Alt Fee row in calendar year `yearIndex`
  // (1-based). Setup / One Time charges land in the year containing
  // their start month. Recurring (monthly) bills every month from
  // startMonth through termMonths, escalated each year.
  function altFeeYearRevenue(row, yearIndex) {
    const manualFee = Number(row.fee);
    const hasManualFee = row.fee != null && row.fee !== '' && Number.isFinite(manualFee) && manualFee >= 0;
    const fee = hasManualFee ? manualFee : (autoFeePerUnitFor(row) ?? 0);
    const uc = Number(row.unitCount);
    if (!Number.isFinite(fee) || fee <= 0 || !Number.isFinite(uc) || uc <= 0) return 0;
    const manualSm = Number(row.startMonth);
    const hasManualSm = row.startMonth != null && row.startMonth !== '' && Number.isFinite(manualSm) && manualSm > 0;
    const startMonth = Math.max(1, Math.round(hasManualSm ? manualSm : (autoStartMonthFor(row) || 1)));
    const yearStart = (yearIndex - 1) * 12 + 1;
    const yearEnd = yearIndex * 12;
    const isRecurring = /recurring/i.test(row.type || '');

    if (!isRecurring) {
      if (startMonth > termMonths) return 0;
      if (startMonth >= yearStart && startMonth <= yearEnd) return fee * uc;
      return 0;
    }
    const billStart = Math.max(yearStart, startMonth);
    const billEnd = Math.min(yearEnd, termMonths);
    if (billEnd < billStart) return 0;
    const monthCount = billEnd - billStart + 1;
    const escMult = Math.pow(1 + annualEscalator, yearIndex - 1);
    return fee * uc * monthCount * escMult;
  }

  // Per-unit fee auto-computed from the marked-up prices of CTS rows
  // linked to this alt-fee row. Type matching:
  //   alt-fee Setup              ← CTS Setup           (face value)
  //   alt-fee One Time           ← CTS One Time        (face value)
  //   alt-fee Recurring (monthly)← CTS Recurring (monthly)            (face monthly)
  //                                + CTS Setup Rolled / One Time Rolled
  //                                  (billed across the term, cost booked once)
  // A recurring row prices to the whole term rather than to year 1 — its
  // fee escalates slower than its cost does, so a year-1 derivation drifts
  // under target every year after. See recurringFeePerUnit.
  // Returns null if there is no linked + type-matched markup yet, or
  // the row has no usable unit count.
  function autoFeePerUnitFor(row) {
    if (!workbook) return null;
    const target = (row.altItem || '').trim().toLowerCase();
    if (!target) return null;
    const opt = workbook.options.find(o => o.optionNumber === activeOption);
    if (!opt) return null;
    const uc = Number(row.unitCount);
    if (!Number.isFinite(uc) || uc <= 0) return null;
    const rowType = (row.type || '').trim();
    if (!rowType) return null;
    const isRecurringRow = /recurring/i.test(rowType);
    // Setup and One Time are treated as the same bucket — both alt-fee
    // types pull face value from CTS rows of either Setup or One Time
    // (plain, not Rolled). Rolled variants flow into the Recurring
    // bucket and are amortized over the term.
    const isSetupOrOneTimeRow = /^(setup|one\s*time)$/i.test(rowType);

    // Kept apart because the term treats them differently: a monthly cost
    // escalates over the term, a Rolled one is incurred once upfront, and
    // an upfront row's fee doesn't escalate at all.
    let recurringMonthlyPrice = 0;
    let rolledUpfrontPrice = 0;
    let upfrontPrice = 0;
    for (const sec of opt.sections) {
      for (const item of sec.items) {
        if (mappingNameFor(item).trim().toLowerCase() !== target) continue;
        const { price } = priceFor(item);
        if (typeof price !== 'number' || !Number.isFinite(price)) continue;
        const t = effectiveType(item);
        const itemIsRecurring = /recurring/i.test(t);
        const itemIsRolled = /\brolled\b/i.test(t);
        const itemIsSetupOrOneTime = /^(setup|one\s*time)$/i.test(t);

        if (isRecurringRow) {
          if (itemIsRecurring) recurringMonthlyPrice += price;
          else if (itemIsRolled) rolledUpfrontPrice += price;
        } else if (isSetupOrOneTimeRow && itemIsSetupOrOneTime) {
          upfrontPrice += price;
        }
      }
    }
    // Round to two decimals so the value the user sees in the Fee
    // column is exactly the same number used by every downstream
    // calculation (year revenue, margin, totals). Without rounding,
    // a displayed $1.93 can multiply out from an underlying $1.9263.
    if (isRecurringRow) {
      const perUnit = recurringFeePerUnit({
        recurringMonthlyPrice,
        rolledUpfrontPrice,
        annualEscalator,
        costEscalator,
        termMonths,
        unitCount: uc,
      });
      if (perUnit == null) return null;
      return Math.round(perUnit * 100) / 100;
    }
    if (upfrontPrice <= 0) return null;
    return Math.round((upfrontPrice / uc) * 100) / 100;
  }

  // Fee Start Month for an alt-fee row: the fee's own saved default when it
  // has one, else the earliest start month from the CTS rows linked to this
  // alt-fee row's tag. Falls back through type matching (Setup/One Time bucket vs
  // Recurring incl. Rolled) so a Setup alt-fee row picks up the start
  // month of the upfront CTS lines and a Recurring row picks up the
  // monthly ones. Returns null if no linked rows carry a usable start
  // month.
  function autoStartMonthFor(row) {
    const target = feeDefaultKey(row?.altItem);
    if (!target) return null;
    // A Fee Start Month saved for this fee on the Linked To page speaks for
    // the fee itself, so it outranks whatever its costs start at. The row
    // can still override it by typing a value.
    const defSm = Number(feeDefaults[target]?.startMonth);
    if (Number.isFinite(defSm) && defSm > 0) return Math.round(defSm);
    if (!workbook) return null;
    const opt = workbook.options.find(o => o.optionNumber === activeOption);
    if (!opt) return null;
    const rowType = String(row?.type || '').trim();
    const isRecurringRow = /recurring/i.test(rowType);
    const isSetupOrOneTimeRow = /^(setup|one\s*time)$/i.test(rowType);

    let bestTyped = null;
    let bestAny = null;
    for (const sec of opt.sections) {
      for (const item of sec.items) {
        if (mappingNameFor(item).trim().toLowerCase() !== target) continue;
        const sm = effectiveItemStartMonth(item);
        if (!Number.isFinite(sm) || sm <= 0) continue;
        if (bestAny == null || sm < bestAny) bestAny = sm;
        const t = effectiveType(item);
        const itemIsRecurring = /recurring/i.test(t);
        const itemIsRolled = /\brolled\b/i.test(t);
        const itemIsSetupOrOneTime = /^(setup|one\s*time)$/i.test(t);
        const typeMatches = (isRecurringRow && (itemIsRecurring || itemIsRolled))
          || (isSetupOrOneTimeRow && itemIsSetupOrOneTime);
        if (typeMatches && (bestTyped == null || sm < bestTyped)) bestTyped = sm;
      }
    }
    return bestTyped ?? bestAny;
  }

  // For an Alt Fee tag, compute the total margin across ALL alt-fee
  // rows sharing that tag and ALL upper-table CTS rows linked to it.
  //
  //   totalUnits = Σ unitCount over alt-fee rows with this tag
  //                (used to compute fee revenue, not cost)
  //   totalFee   = Σ over alt-fee rows of fee × unitCount, with
  //                Recurring (monthly) rows projected over the term
  //                using the annual escalator
  //   totalCost  = Σ over linked upper-table CTS rows of their term
  //                cost. CTS values are treated as totals (not
  //                per-unit), so no unit-count multiplication. Per
  //                type:
  //                  Setup / One Time          → CTS (face)
  //                  Setup Rolled / One Time Rolled → CTS amortized
  //                                              over the term with
  //                                              the escalator
  //                  Recurring (monthly)       → CTS projected over
  //                                              the term with the
  //                                              escalator
  //   marginPct  = (totalFee − totalCost) / totalFee
  function altFeeMarginFor(altItemName) {
    if (!workbook) return null;
    const target = (altItemName || '').trim().toLowerCase();
    if (!target) return null;
    const opt = workbook.options.find(o => o.optionNumber === activeOption);
    if (!opt) return null;

    const altRows = (altFees[opt.optionNumber] || []).filter(r =>
      (r.altItem || '').trim().toLowerCase() === target);
    if (altRows.length === 0) return null;

    const totalUnits = altRows.reduce((s, r) => {
      const uc = Number(r.unitCount);
      return s + (Number.isFinite(uc) ? uc : 0);
    }, 0);

    const totalFee = altRows.reduce((s, r) => {
      const manualFee = Number(r.fee);
      const hasManualFee = r.fee != null && r.fee !== '' && Number.isFinite(manualFee) && manualFee >= 0;
      const fee = hasManualFee ? manualFee : (autoFeePerUnitFor(r) ?? 0);
      const uc = Number(r.unitCount);
      if (!Number.isFinite(fee) || fee <= 0 || !Number.isFinite(uc) || uc <= 0) return s;
      const isRecurring = /recurring/i.test(r.type || '');
      if (isRecurring) return s + projectMonthlyOverTerm(fee, annualEscalator, termMonths) * uc;
      return s + fee * uc;
    }, 0);
    if (totalFee <= 0) return null;

    const linked = [];
    for (const sec of opt.sections) {
      for (const item of sec.items) {
        if (mappingNameFor(item).trim().toLowerCase() === target) linked.push(item);
      }
    }

    const totalCost = linked.reduce((s, item) => {
      if (typeof item.cts !== 'number') return s;
      const t = effectiveType(item);
      const isRecurring = /recurring.*monthly|monthly.*recurring|^recurring/i.test(t);
      // Effective cost folds tech depr into non-pass-through cost.
      const baseCost = ctsItemEffectiveCost(item);
      if (isRecurring) return s + projectMonthlyOverTerm(baseCost, costEscalator, termMonths);
      // Setup / One Time + Setup-Rolled / One-Time-Rolled: cost is
      // booked upfront, not amortized — the customer is billed on a
      // rolled schedule but our cost has already been incurred.
      return s + baseCost;
    }, 0);

    return {
      totalCost,
      totalFee,
      totalUnits,
      matchCount: linked.length,
      altRowCount: altRows.length,
      marginPct: (totalFee - totalCost) / totalFee,
    };
  }
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
    return linkedToDefaults[linkedToDefaultKey(item.description, effectiveType(item))] || '';
  }

  // Start month for a CTS item, honoring the per-(Line Item, Type)
  // override saved on the Linked To page over the workbook value.
  function effectiveItemStartMonth(item) {
    const key = linkedToDefaultKey(item.description, effectiveType(item));
    const ov = linkedToStartMonthDefaults[key];
    if (ov != null) {
      const n = Number(ov);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const sm = Number(item.startMonth);
    return Number.isFinite(sm) && sm > 0 ? sm : null;
  }

  // Drag-to-resize for either the upper-table or summary-table cols.
  function startColResize(scope, key, evt) {
    evt.preventDefault();
    evt.stopPropagation();
    const cols = scope === 'summary' ? SUMMARY_COLS : COLS;
    const colDef = cols.find(c => c.key === key);
    const widthsState = scope === 'summary' ? summaryColWidths : colWidths;
    const setWidths = scope === 'summary' ? setSummaryColWidths : setColWidths;
    const startX = evt.clientX;
    const startW = widthsState[key] ?? colDef?.defaultWidth ?? 140;
    const onMove = (e) => {
      const next = Math.max(60, startW + (e.clientX - startX));
      setWidths(w => ({ ...w, [key]: next }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const colHidden = (key) => colVisibility[key] === false;
  const summaryColHidden = (key) => summaryColVisibility[key] === false;
  function toggleColVisible(key) {
    setColVisibility(v => ({ ...v, [key]: v[key] === false }));
  }
  function toggleSummaryColVisible(key) {
    setSummaryColVisibility(v => ({ ...v, [key]: v[key] === false }));
  }

  // Keep activeOption pointing at a real tab whenever the workbook changes.
  useEffect(() => {
    if (!workbook?.options?.length) return;
    const exists = workbook.options.some(o => o.optionNumber === activeOption);
    if (!exists) setActiveOption(workbook.options[0].optionNumber);
  }, [workbook, activeOption]);

  // Hydrate Opps 2 records + Option ↔ Opp link map for the per-option
  // "Save to Opp" button on the Pricing sub-tab. Updates broadcast from
  // the Options sub-tab (or another browser tab) flow back through the
  // same cross-tab event used everywhere else.
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

  // Pull the JSON snapshot out of a dropped Pricing-page export. The
  // state sheet stores the payload in chunked rows (column A, row 2+)
  // because individual cells max out at 32,767 characters in Excel.
  // Returns the parsed snapshot, or null if the sheet isn't present
  // or its payload can't be parsed.
  function readPricingStateFromBuffer(buf) {
    const wb = XLSX.read(buf, { type: 'array' });
    const found = [STATE_SHEET_NAME, ...LEGACY_STATE_SHEET_NAMES].find(n => wb.SheetNames.includes(n));
    if (!found) return null;
    const sheet = wb.Sheets[found];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });
    const chunks = aoa.slice(1).map(r => String(r?.[0] ?? ''));
    const json = chunks.join('');
    if (!json) return null;
    return JSON.parse(json);
  }

  function restorePricingState(s) {
    if (s.workbook) {
      // Restoring a state export swaps the workbook out too, so the
      // outgoing file's Opp links go with it. The restored workbook is
      // treated as a fresh upload for linking purposes — a snapshot
      // built on another device can't own links in this device's map.
      clearLoadedWorkbookOptionLinks(workbook);
      setWorkbook({ ...s.workbook, id: newWorkbookId(), legacyLinks: false });
    }
    if (typeof s.globalGmPct === 'number') setGlobalGmPct(s.globalGmPct);
    setOverrides(stripPassThroughOverrides(s.overrides || {}));
    if (typeof s.activeOption === 'number') setActiveOption(s.activeOption);
    else if (s.workbook?.options?.[0]?.optionNumber != null) setActiveOption(s.workbook.options[0].optionNumber);
    setColWidths(s.colWidths || {});
    setAltFees(s.altFees || {});
    // Merge incoming snapshot defaults on top of existing ones so a
    // round-tripped state file doesn't wipe defaults the user built
    // up on this device. An empty {} in the snapshot is a no-op.
    if (s.linkedToDefaults && typeof s.linkedToDefaults === 'object') {
      setLinkedToDefaults(prev => ({ ...prev, ...s.linkedToDefaults }));
    }
    if (s.linkedToUnitDefaults && typeof s.linkedToUnitDefaults === 'object') {
      setLinkedToUnitDefaults(prev => ({ ...prev, ...s.linkedToUnitDefaults }));
    }
    if (s.feeDefaults && typeof s.feeDefaults === 'object') {
      setFeeDefaults(prev => ({ ...prev, ...s.feeDefaults }));
    }
    if (s.linkedToOptionsList && typeof s.linkedToOptionsList === 'object') {
      // Same union semantics as the defaults above — fold the snapshot's
      // curated dropdown options into this device's list.
      setLinkedToOptionsList(prev => {
        const union = (a, b) => {
          const seen = new Set((a || []).map(v => String(v).trim().toLowerCase()));
          const out = [...(a || [])];
          for (const v of (b || [])) {
            const k = String(v).trim().toLowerCase();
            if (k && !seen.has(k)) { seen.add(k); out.push(String(v).trim()); }
          }
          return out;
        };
        return {
          custom: union(prev.custom, s.linkedToOptionsList.custom),
          hidden: union(prev.hidden, s.linkedToOptionsList.hidden),
        };
      });
    }
    if (typeof s.termMonths === 'number') setTermMonths(s.termMonths);
    if (typeof s.annualEscalator === 'number') setAnnualEscalator(s.annualEscalator);
    if (typeof s.costEscalator === 'number') setCostEscalator(s.costEscalator);
    if (typeof s.chartTag === 'string') setChartTag(s.chartTag);
    if (s.chartView === 'chart' || s.chartView === 'table') setChartView(s.chartView);
    if (typeof s.chartVisible === 'boolean') setChartVisible(s.chartVisible);
    if (s.chartUnitCounts && typeof s.chartUnitCounts === 'object') setChartUnitCounts(s.chartUnitCounts);
    if (typeof s.techDeprPct === 'number') setTechDeprPct(s.techDeprPct);
    setColVisibility(s.colVisibility || {});
    if (typeof s.hideEmptyCtsRows === 'boolean') setHideEmptyCtsRows(s.hideEmptyCtsRows);
    setSummaryColWidths(s.summaryColWidths || {});
    setSummaryColVisibility(s.summaryColVisibility || {});
  }

  async function handleFile(file) {
    setError('');
    try {
      const buf = await file.arrayBuffer();
      const snapshot = readPricingStateFromBuffer(buf);
      if (snapshot) {
        restorePricingState(snapshot);
        return;
      }
      const parsed = parsePricingWorkbook(buf);
      // Stash the raw bytes so "Save to Opp" can attach them later.
      // Use a Blob (not the raw ArrayBuffer) so IndexedDB rehydrates
      // it as a downloadable file on next mount.
      const sourceBlob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      workbookSourceRef.current = sourceBlob;
      dbPut(STORE, sourceBlob, WORKBOOK_SOURCE_KEY).catch(err => {
        console.warn('Failed to cache workbook source blob:', err);
      });
      // A new SIA replaces the one on screen, so unlink any Opp the
      // outgoing workbook was "Saved to" before we swap it out. The
      // incoming file gets its own id, so it starts with no links of
      // its own even if its sheet names match the outgoing ones.
      await clearLoadedWorkbookOptionLinks(workbook);
      setWorkbook({
        id: newWorkbookId(),
        fileName: file.name,
        options: parsed.options,
        sheetNames: parsed.sheetNames,
        loadedAt: Date.now(),
      });
      setOverrides({});
      // Fresh file → reset the global margin to the 50% default so a
      // stale saved value from a prior workbook doesn't carry over.
      setGlobalGmPct(0.5);
      setActiveOption(parsed.options[0]?.optionNumber ?? null);
      // Seed the Alternative Fee schedule from the cost rows' Linked To
      // tags rather than the workbook's own alt-fee table. Every unique
      // tag a cost row resolves to becomes one alt-fee row; the user
      // fills the fee later. Unit pre-fills from linkedToUnitDefaults
      // when set, and Per Site / Per Account inherit the SIA metadata
      // count. Pad to 9 rows so the grid keeps its Excel-template feel.
      // Normalize an SIA alt-fee Type string into one of the alt-fee
      // dropdown values so imported rows render as selected (and match
      // the seeded rows for the fill pass). Idempotent — already-normal
      // values map back to themselves.
      const normAltType = (raw) => {
        const t = String(raw || '').trim();
        if (/recurring/i.test(t)) return 'Recurring (monthly)';
        if (/^setup/i.test(t)) return 'Setup';
        if (/^one\s*time/i.test(t)) return 'One Time';
        return t;
      };

      const seeded = {};
      for (const opt of parsed.options) {
        const flatItems = (opt.sections || []).flatMap(s => s.items || []);
        // Tag → first matching cost item, so we can pull a unit default
        // off whichever (lineItem, type) pair produced the tag.
        const firstItemByTag = new Map();
        for (const item of flatItems) {
          const k = linkedToDefaultKey(item.description, item.type || '');
          const tag = (linkedToDefaults[k] || '').trim();
          if (!tag || firstItemByTag.has(tag)) continue;
          firstItemByTag.set(tag, item);
        }
        const tags = Array.from(firstItemByTag.keys()).sort((a, b) => a.localeCompare(b));
        // If the uploaded SIA already has its own Alternative Fee
        // Structure/Schedule filled in, treat the file as the source of
        // truth: use its fee rows verbatim and skip the auto-seeded
        // Linked-To rows entirely, so the file's fees REPLACE the fees
        // this tool would otherwise build (instead of stacking on top of
        // them). The parser only yields real rows; we keep the ones
        // carrying an actual fee so blank template rows don't add noise.
        const wbAltRows = (opt.altFees || []).filter(a => a && a.fee != null);
        let rows;
        if (wbAltRows.length > 0) {
          rows = wbAltRows.map(wb => {
            // The file's fee row still loses to a default the user saved
            // for that fee name: the default is the answer for this fee
            // everywhere, the file's row is whatever one workbook happened
            // to carry.
            const feeDef = feeDefaults[feeDefaultKey(wb.altItem)] || null;
            const unit = feeDef?.unit || wb.unit || '';
            let unitCount = wb.unitCount == null ? 1 : wb.unitCount;
            if (feeDef?.unit) {
              unitCount = 1;
              if (unit === 'Per Site' && typeof opt.siteCount === 'number' && opt.siteCount > 0) unitCount = opt.siteCount;
              else if (unit === 'Per Account' && typeof opt.accountCount === 'number' && opt.accountCount > 0) unitCount = opt.accountCount;
            }
            return {
              altItem: wb.altItem,
              type: feeDef?.type || normAltType(wb.type),
              fee: wb.fee,
              unit,
              unitCount,
              // A saved Fee Start Month answers for the fee, so leave the
              // row blank and let autoStartMonthFor read the default.
              startMonth: feeDef?.startMonth != null ? null : (wb.startMonth == null ? null : wb.startMonth),
            };
          });
        } else {
          // No alt-fee table in the file → seed the schedule from the
          // cost rows' Linked To tags so the user has a starting grid to
          // fill in.
          rows = tags.map(tag => {
            const item = firstItemByTag.get(tag);
            const unitKey = linkedToDefaultKey(item.description, item.type || '');
            // Defaults saved for the fee name itself win over the ones
            // saved for the cost row's (Line Item, Type) pair.
            const feeDef = feeDefaults[feeDefaultKey(tag)] || null;
            const unit = feeDef?.unit || linkedToUnitDefaults[unitKey] || '';
            let unitCount = 1;
            if (unit === 'Per Site' && typeof opt.siteCount === 'number' && opt.siteCount > 0) {
              unitCount = opt.siteCount;
            } else if (unit === 'Per Account' && typeof opt.accountCount === 'number' && opt.accountCount > 0) {
              unitCount = opt.accountCount;
            }
            // Map the cost item's type into one of the alt-fee dropdown
            // values so the seeded row renders as selected. Rolled
            // variants normalize to their base (Setup Rolled → Setup,
            // One Time Rolled → One Time) since the alt-fee table doesn't
            // expose Rolled types — the user can refine if needed.
            const rawType = String(item.type || '').trim();
            let type = feeDef?.type || '';
            if (!type) {
              if (/recurring/i.test(rawType)) type = 'Recurring (monthly)';
              else if (/^setup/i.test(rawType)) type = 'Setup';
              else if (/^one\s*time/i.test(rawType)) type = 'One Time';
            }
            // Leave startMonth null so autoStartMonthFor derives it from
            // the linked CTS rows; the user can type a value to override.
            return { altItem: tag, type, fee: null, unit, unitCount, startMonth: null };
          });
        }
        while (rows.length < 9) rows.push({ altItem: '', type: '', fee: null, unit: '', unitCount: 1, startMonth: null });
        seeded[opt.optionNumber] = rows;
      }
      setAltFees(seeded);
    } catch (err) {
      setError(err?.message || 'Failed to parse file.');
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }
  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!dragOver) setDragOver(true);
  }
  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
  }

  // Drop any "Saved to:" Opp links that point at the workbook currently
  // loaded in the Pricing tab. Called when the SIA is cleared or replaced
  // so the chip (and the Opps 2 "Pricing Option" column it feeds) doesn't
  // dangle against a workbook that's no longer on screen. One atomic
  // write covers every option — dropping them one at a time raced, and
  // a workbook with two linked options could keep one of the links.
  function clearLoadedWorkbookOptionLinks(wb) {
    if (!wb) return Promise.resolve();
    // Untagged legacy links are matched by sheet name, but only for a
    // workbook that predates link tagging — never for one whose links
    // all carry its id.
    const legacyNames = wb.legacyLinks
      ? (wb.options || []).map(o => (o.sheetName || '').trim()).filter(Boolean)
      : [];
    return dropLinksForWorkbook(wb.id, legacyNames).catch(() => {});
  }

  function clearAll() {
    if (!confirm('Clear the loaded workbook, markup overrides, and the Alternative Fee schedule? Saved Linked-To defaults are kept.')) return;
    // The SIA is going away, so unlink any Opp it was "Saved to".
    clearLoadedWorkbookOptionLinks(workbook);
    setWorkbook(null);
    setOverrides({});
    setActiveOption(null);
    setAltFees({});
    setError('');
    // Linked-To defaults live under their own key (LINKED_TO_DEFAULTS_KEY)
    // and are intentionally preserved across Clear / file changes.
    dbDelete(STORE, KEY).catch(() => {});
    // The source-file blob is tied to the loaded workbook — drop it
    // alongside. Per-opp copies already saved via "Save to Opp" are
    // kept (they live in the pricing-source-files store keyed by oppId
    // so they survive the Pricing tab being cleared).
    workbookSourceRef.current = null;
    dbDelete(STORE, WORKBOOK_SOURCE_KEY).catch(() => {});
  }

  // Clone the active option in-place on the loaded workbook. The new
  // option gets a fresh optionNumber, a unique sheet name ("(Clone)"
  // suffix, with a counter if that name is already taken), and item
  // IDs regenerated against the new sheet name so per-row overrides
  // don't leak between original and clone. Alt-fee rows are deep-
  // copied to the new option number. The clone lives on the in-memory
  // workbook only, so removing the file (Clear / Replace) wipes it
  // automatically along with everything else parsed from the upload.
  function cloneActiveOption() {
    if (!workbook || !Array.isArray(workbook.options) || workbook.options.length === 0) return;
    const src = workbook.options.find(o => o.optionNumber === activeOption) || workbook.options[0];
    if (!src) return;

    const used = new Set(workbook.options.map(o => o.sheetName));
    const baseName = `${src.sheetName} (Clone)`;
    let newSheetName = baseName;
    let n = 2;
    while (used.has(newSheetName)) {
      newSheetName = `${src.sheetName} (Clone ${n})`;
      n += 1;
    }
    const newOptionNumber = workbook.options.reduce((m, o) => Math.max(m, o.optionNumber || 0), 0) + 1;

    const cloned = JSON.parse(JSON.stringify(src));
    cloned.sheetName = newSheetName;
    cloned.optionNumber = newOptionNumber;
    cloned.isClone = true;
    cloned.clonedFrom = src.sheetName;
    cloned.sections = (cloned.sections || []).map(sec => ({
      ...sec,
      items: (sec.items || []).map((item, idx) => ({
        ...item,
        // Mirror the parser's id pattern so resolveColumnLink and
        // override lookups behave identically on the clone.
        id: `${newSheetName}::${sec.title}::${idx}::${String(item.description || '').slice(0, 40)}`,
      })),
    }));

    setWorkbook(prev => prev ? { ...prev, options: [...prev.options, cloned] } : prev);
    setAltFees(prev => {
      const srcRows = prev[src.optionNumber];
      if (!Array.isArray(srcRows) || srcRows.length === 0) return prev;
      return { ...prev, [newOptionNumber]: srcRows.map(r => ({ ...r })) };
    });
    setActiveOption(newOptionNumber);
  }

  // Drop a cloned Option from the in-memory workbook. Only options
  // produced by Clone option (isClone === true) are deletable here —
  // sheets from the source workbook stick around so the user can
  // always re-clone from the original. Active option follows the
  // deletion: if the user was sitting on the clone we switch to the
  // option it was cloned from, falling back to the first remaining
  // option. Per-option state (alt-fee rows, per-row overrides) tied
  // to the clone's optionNumber + item ids is dropped along with it.
  function deleteClonedOption(optionNumber) {
    if (!workbook || !Array.isArray(workbook.options)) return;
    const target = workbook.options.find(o => o.optionNumber === optionNumber);
    if (!target || !target.isClone) return;
    if (!window.confirm(`Delete the cloned option "${target.sheetName}"? Any markup overrides and alt-fee rows on this clone will be removed.`)) return;

    // The clone is going away, so any Opp it was "Saved to" gets
    // unlinked with it rather than dangling on a name that no longer
    // exists in this workbook.
    dropOptionFromLinks((target.sheetName || '').trim(), {
      source: 'pricing',
      workbookId: workbook.id,
      allowLegacy: !!workbook.legacyLinks,
    }).catch(() => {});

    const remaining = workbook.options.filter(o => o.optionNumber !== optionNumber);
    setWorkbook(prev => prev ? { ...prev, options: remaining } : prev);
    setAltFees(prev => {
      if (!(optionNumber in prev)) return prev;
      const next = { ...prev };
      delete next[optionNumber];
      return next;
    });
    setOverrides(prev => {
      const droppedIds = new Set();
      for (const sec of (target.sections || [])) {
        for (const item of (sec.items || [])) {
          if (item.id) droppedIds.add(item.id);
        }
      }
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(prev)) {
        if (droppedIds.has(id)) { delete next[id]; changed = true; }
      }
      return changed ? next : prev;
    });
    if (activeOption === optionNumber) {
      const fallback = remaining.find(o => o.sheetName === target.clonedFrom)
        || remaining[0];
      setActiveOption(fallback ? fallback.optionNumber : null);
    }
  }

  // 9 empty starter rows that match the Excel template — used when
  // an option's alt-fee table hasn't been edited yet.
  const altFeeStarter = () => Array.from({ length: 9 }, () => ({
    altItem: '', type: '', fee: null, unit: '', unitCount: 1, startMonth: null,
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
      list.push({ altItem: '', type: '', fee: null, unit: '', unitCount: 1, startMonth: null });
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

  // Drag-and-drop reordering. `from` and `to` are indices into the
  // current row array; the row at `from` is removed and reinserted at
  // the position that `to` represents after the removal. Out-of-range
  // or no-op moves are skipped.
  function moveAltFeeRow(optionNumber, from, to) {
    if (from === to || from < 0 || to < 0) return;
    setAltFees(prev => {
      const list = (prev[optionNumber] || []).slice();
      if (from >= list.length || to > list.length) return prev;
      const [row] = list.splice(from, 1);
      const insertAt = to > from ? to - 1 : to;
      list.splice(insertAt, 0, row);
      return { ...prev, [optionNumber]: list };
    });
  }

  // Write the solved Setup-fee floor into the schedule's Fee column. One pass
  // over the rows rather than a call per row: the floor only holds as a set,
  // and a half-applied schedule is a price nobody chose.
  function applySetupFeeFloor(optionNumber, updates) {
    if (!Array.isArray(updates) || updates.length === 0) return;
    setAltFees(prev => {
      const list = (prev[optionNumber] || altFeeStarter()).slice();
      for (const u of updates) {
        const row = list[u.index];
        if (!row || !Number.isFinite(u.fee)) continue;
        list[u.index] = { ...row, fee: u.fee };
      }
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
        const isEmpty = !r.altItem && !r.type && !r.unit &&
          (!r.unitCount || r.unitCount === 1 || r.unitCount === '1') &&
          (typeof r.fee !== 'number' || r.fee === 0) &&
          (r.startMonth == null || r.startMonth === '' || r.startMonth === 1);
        if (!isEmpty) break;
        existing.pop();
      }
      return { ...prev, [optionNumber]: [...existing, ...newRows] };
    });
  }

  // The Alternative Fee schedule's Type dropdown offers three values; the
  // pricing table's Type column carries more (the Rolled variants). Map a
  // cost row's type onto the schedule type that would price it — Rolled
  // bills monthly across the term, so it belongs with Recurring, which is
  // the bucket autoFeePerUnitFor already pulls it into. Anything else is
  // left blank rather than guessed: a schedule row with no type derives no
  // fee, which reads as "pick one" instead of quietly pricing wrongly.
  function altFeeTypeForCtsType(t) {
    const s = String(t || '').trim();
    if (!s) return '';
    if (/recurring/i.test(s) || /\brolled\b/i.test(s)) return 'Recurring (monthly)';
    if (/^one\s*time$/i.test(s)) return 'One Time';
    if (/^setup$/i.test(s)) return 'Setup';
    return '';
  }

  // Unit Count to pair with a unit on this option — the same fill the
  // schedule's own Unit dropdown does when you pick Per Site / Per Account.
  function unitCountForUnit(unit, opt) {
    return altFeeUnitCount(unit, { siteCount: opt?.siteCount, accountCount: opt?.accountCount });
  }

  // The whole Alternative Fee schedule this option's Automated Fee Names
  // imply, minus whatever the schedule already carries — what the "Build
  // from Automated Fee Names" button appends. Same idea as the per-row
  // "+ Fee" button above, run across every cost line at once: names come
  // off the costs, fees and start months are left to derive from them.
  //
  // Deliberately reads the Automated Fee Name (not mappingNameFor) whatever
  // Map by is set to — the button says which column it builds from, and a
  // cost pinned to some other schedule row still carries the name that names
  // its fee.
  function automatedFeeBuildRows(opt) {
    if (!opt) return [];
    const costs = [];
    for (const sec of (opt.sections || [])) {
      for (const item of (sec.items || [])) {
        const effType = effectiveType(item);
        costs.push({
          name: resolvedLinkedTo(item),
          type: effType,
          unit: linkedToUnitDefaults?.[linkedToDefaultKey(item.description, effType)] || '',
          cost: ctsItemEffectiveCost(item),
          passThrough: isPassThrough(item),
        });
      }
    }
    return buildAltFeeRowsFromAutomatedNames({
      costs,
      existingRows: altFees[opt.optionNumber] || [],
      feeDefaults,
      siteCount: opt.siteCount,
      accountCount: opt.accountCount,
    });
  }

  // Add a row to this option's Alternative Fee schedule for a cost row's
  // Automated Fee Name, so a name the cost already carries has something to
  // price against. Fee and Fee Start Month are deliberately left blank:
  // the schedule derives both from the CTS rows carrying the tag, and a
  // written-in value would freeze what should keep following the costs.
  // Unit comes from the saved Linked To default when there is one.
  //
  // Adding a name the schedule already has would split one fee across two
  // rows, so that case does nothing (the button offering it is disabled).
  function createAltFeeFromLinkedTo(item) {
    const opt = workbook?.options.find(o => o.optionNumber === activeOption);
    if (!opt) return;
    const name = resolvedLinkedTo(item).trim();
    if (!name) return;
    const lower = name.toLowerCase();
    const exists = (altFees[opt.optionNumber] || [])
      .some(r => String(r.altItem || '').trim().toLowerCase() === lower);
    if (exists) return;
    const effType = effectiveType(item);
    // The fee's own saved defaults win over what the cost row implies: the
    // user set them for this fee name, whatever line item it hangs off.
    const def = feeDefaultsFor(name);
    const unit = def?.unit || linkedToUnitDefaults?.[linkedToDefaultKey(item.description, effType)] || '';
    appendAltFeeRows(opt.optionNumber, [{
      altItem: name,
      type: def?.type || altFeeTypeForCtsType(effType),
      fee: null,
      unit,
      unitCount: unitCountForUnit(unit, opt),
      // Left blank so autoStartMonthFor keeps deriving it — from the fee's
      // saved default when there is one, else the linked CTS rows.
      startMonth: null,
    }]);
  }

  function effectiveType(item) {
    const ov = overrides[item.id]?.typeOverride;
    return (ov === undefined || ov === null || ov === '') ? (item.type || '') : ov;
  }

  function setItemType(itemId, newType) {
    setOverrides(prev => {
      const next = { ...prev };
      if (!newType) {
        if (next[itemId]) {
          const { typeOverride: _drop, ...rest } = next[itemId];
          if (Object.keys(rest).length === 0) delete next[itemId];
          else next[itemId] = rest;
        }
      } else {
        next[itemId] = { ...next[itemId], typeOverride: newType };
      }
      return next;
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

  // The fee-schedule row this cost line is tied to. Linked To carries the
  // typical (cross-SIA) fee name; when this workbook's own fee schedule uses
  // different wording, the SIA Fee column pins the row to a specific schedule
  // row instead. An explicit pick wins; '' means "deliberately unmapped";
  // with no pick at all we fall back to the Linked To tag, which is what the
  // schedule matched on before this column existed — so untouched rows price
  // exactly as they did.
  function resolvedSiaFee(item) {
    const ov = overrides[item.id]?.siaFee;
    if (ov !== undefined) return ov;
    return resolvedLinkedTo(item);
  }

  // The fee name every calculation on this page matches costs by. Which
  // column that is, is the user's choice: Fee Name Below ties each cost
  // to a row of the schedule underneath, Automated Fee Name groups costs
  // by the typical fee name so a structure can be built from them. Every
  // total, margin, auto-fee and warning reads this, never a column
  // directly, so the whole page moves together when the choice changes.
  function mappingNameFor(item) {
    return feeMapBy === 'automated' ? resolvedLinkedTo(item) : resolvedSiaFee(item);
  }

  // Set / clear a row's SIA Fee pick. `null` drops the override so the row
  // goes back to following its Linked To tag.
  function setItemSiaFee(item, value) {
    const itemId = item.id;
    setOverrides(prev => {
      const next = { ...prev };
      if (value === null) {
        if (next[itemId]) {
          const { siaFee: _drop, ...rest } = next[itemId];
          if (Object.keys(rest).length === 0) delete next[itemId];
          else next[itemId] = rest;
        }
      } else {
        next[itemId] = { ...next[itemId], siaFee: String(value) };
      }
      return next;
    });
  }

  // Add / remove entries in the Linked To dropdown vocabulary (the
  // datalist on each pricing-table row), managed from the ± button on
  // the column header. Adding clears a matching hidden entry, so
  // re-adding (or restoring) a removed option brings it back; removing
  // remembers the name in `hidden` so auto-derived tags that are still
  // in use on defaults / alt fees / overrides stay suppressed.
  function addLinkedToOption(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    setLinkedToOptionsList(prev => {
      const hidden = (prev.hidden || []).filter(h => String(h).trim().toLowerCase() !== lower);
      const custom = (prev.custom || []).some(c => String(c).trim().toLowerCase() === lower)
        ? (prev.custom || [])
        : [...(prev.custom || []), trimmed];
      return { custom, hidden };
    });
  }
  function removeLinkedToOption(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    setLinkedToOptionsList(prev => {
      const custom = (prev.custom || []).filter(c => String(c).trim().toLowerCase() !== lower);
      const hidden = (prev.hidden || []).some(h => String(h).trim().toLowerCase() === lower)
        ? (prev.hidden || [])
        : [...(prev.hidden || []), trimmed];
      return { custom, hidden };
    });
  }

  // Save / clear the (Line Item, Type) default from the row's
  // currently-resolved value via the star button next to the input.
  function toggleLinkedToDefault(item) {
    const key = linkedToDefaultKey(item.description, effectiveType(item));
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

  function removeLinkedToDefault(key) {
    setLinkedToDefaults(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setLinkedToUnitDefaults(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setLinkedToStartMonthDefaults(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setLinkedToPassThroughDefaults(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // Save / clear the Fee Start Month override for a (Line Item, Type)
  // pair. A non-positive / non-numeric value drops the override so the
  // CTS row's own startMonth (auto-derived) takes back over.
  function setLinkedToStartMonthDefault(key, raw) {
    setLinkedToStartMonthDefaults(prev => {
      const next = { ...prev };
      const n = Number(String(raw ?? '').replace(/[^\d.-]/g, ''));
      if (!Number.isFinite(n) || n <= 0) {
        if (key in next) delete next[key];
        else return prev;
      } else {
        next[key] = Math.round(n);
      }
      return next;
    });
  }

  // Save / clear the Unit default for a (Line Item, Type) pair. Empty
  // string drops the override so the auto-fill (matching alt-fee row's
  // unit) takes back over.
  function setLinkedToUnitDefault(key, unit) {
    setLinkedToUnitDefaults(prev => {
      const next = { ...prev };
      if (!unit) {
        if (key in next) delete next[key];
        else return prev;
      } else {
        next[key] = unit;
      }
      return next;
    });
  }

  // The per-fee defaults saved for an Automated Fee Name, or null. Keyed
  // case-insensitively, like every other Linked To lookup on the page.
  function feeDefaultsFor(name) {
    const k = feeDefaultKey(name);
    return k ? (feeDefaults[k] || null) : null;
  }

  // Save / clear one field of a fee's defaults. An empty value drops just
  // that field, and a fee left with no fields at all drops out entirely so
  // the table doesn't keep an empty row around. startMonth is stored as a
  // rounded positive number; anything else clears it.
  function setFeeDefaultField(name, field, value) {
    const key = feeDefaultKey(name);
    if (!key) return;
    setFeeDefaults(prev => {
      const current = prev[key] || {};
      let next;
      if (field === 'startMonth') {
        const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
        next = (Number.isFinite(n) && n > 0)
          ? { ...current, startMonth: Math.round(n) }
          : (() => { const { startMonth: _drop, ...rest } = current; return rest; })();
      } else {
        const v = String(value || '').trim();
        if (v) next = { ...current, [field]: v };
        else { const { [field]: _drop, ...rest } = current; next = rest; }
      }
      const out = { ...prev };
      if (Object.keys(next).length === 0) {
        if (!(key in prev)) return prev;
        delete out[key];
      } else {
        out[key] = next;
      }
      return out;
    });
    applyFeeDefaultToSchedules(key, field, value);
  }

  // Push a Type / Unit default onto the schedule rows that already carry the
  // fee's name, on every option — see applyFeeDefaultToRows for the retype
  // and the de-duplication it does.
  function applyFeeDefaultToSchedules(key, field, value) {
    setAltFees(prev => {
      let changed = false;
      const next = {};
      for (const [optNum, rows] of Object.entries(prev || {})) {
        const opt = workbook?.options?.find(o => String(o.optionNumber) === String(optNum));
        const applied = applyFeeDefaultToRows(rows || [], {
          key, field, value,
          siteCount: opt?.siteCount,
          accountCount: opt?.accountCount,
        });
        if (applied !== (rows || [])) changed = true;
        next[optNum] = applied;
      }
      return changed ? next : prev;
    });
  }

  function removeFeeDefault(name) {
    const key = feeDefaultKey(name);
    setFeeDefaults(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
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

  // Pass-through is mapped per (Line Item, Type) pair on the Linked To
  // subtab — there is no per-row toggle, so every CTS row carrying the
  // same Line Item + Type bills the same way on every option.
  function isPassThrough(item) {
    const key = linkedToDefaultKey(item.description, effectiveType(item));
    return linkedToPassThroughDefaults[key] === true;
  }

  // Linked-CTS cost for one option, split per year and with the
  // pass-through subset carved out — the numbers behind the Alt Fee
  // table's "Deal margin" / "Linked CTS cost" rows.
  //
  // Only CTS rows whose resolved Linked To matches an alt-fee tag count:
  // an unlinked cost line has no fee to be a margin against (the table
  // warns about those separately).
  //
  //   costByYear               — all linked CTS cost in that year
  //   passThroughByYear        — the pass-through slice of it (cost side)
  //   passThroughRevenueByYear — the same rows' revenue side, using the
  //                              per-unit-rounded cost that actually
  //                              lands in Total fee, so revenue less
  //                              pass-through carries no rounding ghost
  function optionCostBreakdown(opt) {
    const numYears = Math.max(1, Math.ceil(termMonths / 12));
    const zeros = () => Array.from({ length: numYears }, () => 0);
    const passThroughByYear = zeros();
    const passThroughRevenueByYear = zeros();
    if (!opt) return { numYears, costByYear: zeros(), passThroughByYear, passThroughRevenueByYear };

    const altRowsForOpt = altFees[opt.optionNumber] || [];
    const altTagSet = new Set(
      altRowsForOpt.map(r => (r.altItem || '').trim().toLowerCase()).filter(Boolean)
    );
    const altRowByTag = new Map();
    for (const r of altRowsForOpt) {
      const k = (r.altItem || '').trim().toLowerCase();
      if (k && !altRowByTag.has(k)) altRowByTag.set(k, r);
    }
    // Round the per-unit cost the same way auto-fee rounds (see
    // autoFeePerUnitFor) and run it back through ctsItemYearCost via a
    // shim object so the year / startMonth / escalator logic stays in
    // one place.
    function ctsItemPassThroughRevenue(it, yearIndex) {
      const tag = mappingNameFor(it).trim().toLowerCase();
      const altRow = tag ? altRowByTag.get(tag) : null;
      const uc = altRow ? Number(altRow.unitCount) : NaN;
      if (!altRow || !Number.isFinite(uc) || uc <= 0) {
        return ctsItemYearCost(it, yearIndex);
      }
      const rounded = Math.round((it.cts / uc) * 100) / 100;
      const shim = { ...it, cts: rounded * uc };
      return ctsItemYearCost(shim, yearIndex);
    }

    const costByYear = Array.from({ length: numYears }, (_, yi) => {
      let sum = 0;
      for (const sec of (opt.sections || [])) {
        for (const it of (sec.items || [])) {
          const tag = mappingNameFor(it).trim().toLowerCase();
          if (!tag || !altTagSet.has(tag)) continue;
          const c = ctsItemYearCost(it, yi + 1);
          sum += c;
          if (isPassThrough(it)) {
            passThroughByYear[yi] += c;
            passThroughRevenueByYear[yi] += ctsItemPassThroughRevenue(it, yi + 1);
          }
        }
      }
      return sum;
    });
    return { numYears, costByYear, passThroughByYear, passThroughRevenueByYear };
  }

  // The option's Deal margin — the same cumulative, pass-through-net
  // percentage the Alt Fee table's "Deal margin" row shows, with the
  // last year's value (margin over the full term) as `finalMargin`.
  // That's the number quoted as the deal's margin, so it rides along on
  // the snapshot saved to an Opp.
  //
  // Returns nulls rather than zeros when there's nothing to divide by
  // (no fees, or no linked CTS cost at all) — a deal with no cost side
  // isn't a 100%-margin deal, it's a deal whose margin isn't known here.
  function dealMarginForOption(opt) {
    const { numYears, costByYear, passThroughByYear } = optionCostBreakdown(opt);
    const rows = opt ? (altFees[opt.optionNumber] || []) : [];
    const feeByYear = Array.from({ length: numYears }, (_, i) =>
      rows.reduce((s, r) => s + altFeeYearRevenue(r, i + 1), 0));
    const altPassByYear = Array.from({ length: numYears }, (_, i) =>
      rows.reduce((s, r) => (r.passThrough ? s + altFeeYearRevenue(r, i + 1) : s), 0));
    const hasCost = costByYear.some(v => v > 0);
    if (!hasCost) {
      return { marginByYear: null, finalMargin: null, termRevenue: null, termCost: null };
    }
    return cumulativeDealMargins({
      feeByYear,
      costByYear,
      ctsPassByYear: passThroughByYear,
      altPassByYear,
    });
  }

  // Save / clear the Pass-through default for a (Line Item, Type) pair.
  // Falsy drops the key so the default no longer applies.
  function setLinkedToPassThroughDefault(key, on) {
    setLinkedToPassThroughDefaults(prev => {
      const next = { ...prev };
      if (on) next[key] = true;
      else if (key in next) delete next[key];
      else return prev;
      return next;
    });
  }

  function effectiveGm(item) {
    if (isPassThrough(item)) return { gm: 0, source: 'passThrough' };
    const ov = overrides[item.id];
    if (ov && typeof ov.gmPct === 'number') return { gm: ov.gmPct, source: 'override' };
    if (typeof globalGmPct === 'number') return { gm: globalGmPct, source: 'global' };
    if (typeof item.gmPct === 'number') return { gm: item.gmPct, source: 'sheet' };
    return { gm: null, source: 'none' };
  }

  function priceFor(item) {
    const { gm, source } = effectiveGm(item);
    if (source === 'passThrough') {
      return { gm: 0, source, price: typeof item.cts === 'number' ? item.cts : null };
    }
    // Mark up against the effective cost (CTS + tech depr) so the
    // displayed Deal margin equals the target GM exactly. Marking up
    // against raw CTS leaves tech depr unrecovered and shows a margin
    // ~techDeprPct below target.
    const effCost = typeof item.cts === 'number' ? ctsItemEffectiveCost(item) : null;
    const price = priceFromCostAndGm(effCost, gm);
    return { gm, source, price };
  }

  function exportCsv() {
    if (!workbook) return;
    const wb = XLSX.utils.book_new();

    // One sheet per option, formatted so parsePricingWorkbook can
    // read this file back through the same path it uses for a fresh
    // fee workbook upload. The parser skips the first 18 rows, then
    // looks for header rows containing both "Type" and "CTS"; the
    // section title is the nearest single-cell row above each header.
    // A trailing "Cost Summary" anchor bounds the data range.
    for (const opt of workbook.options) {
      const rows = [];
      for (let i = 0; i < 18; i++) rows.push([]);
      for (const sec of opt.sections) {
        rows.push([sec.title]);
        rows.push(['Line Item', 'Type', 'CTS', 'Start Month', 'Comments', 'GM %', 'Marked-up Price']);
        for (const item of sec.items) {
          const { price } = priceFor(item);
          rows.push([
            item.description || '',
            effectiveType(item),
            item.cts ?? '',
            item.startMonth || '',
            item.comments || '',
            item.gmPct != null ? item.gmPct : '',
            price != null ? price : '',
          ]);
        }
        rows.push([]);
      }
      rows.push(['Cost Summary']);

      const ws = XLSX.utils.aoa_to_sheet(rows);
      // Apply percent format to the GM% column (col F → index 5).
      // GM values are stored as decimals (0.5 = 50 %); the parser's
      // toPct handles both forms but humans read 50 % more easily.
      for (let r = 0; r < rows.length; r++) {
        if (rows[r].length < 6) continue;
        const v = rows[r][5];
        if (typeof v !== 'number') continue;
        const addr = XLSX.utils.encode_cell({ c: 5, r });
        if (ws[addr]) ws[addr].z = '0%';
      }
      const sheetName = opt.sheetName || `Option ${opt.optionNumber}`;
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    // State sheet — JSON snapshot of every piece of state the
    // IndexedDB cache persists, chunked into 30k-char cells so each
    // value stays under Excel's 32,767 cell-text limit. Dropping
    // this workbook back rehydrates from this sheet for full
    // fidelity; without it the per-option sheets above still parse
    // cleanly as a fresh fee workbook (no overrides preserved).
    const snapshot = {
      parserVersion: PARSER_VERSION,
      workbook, globalGmPct, overrides, activeOption, colWidths,
      altFees, linkedToDefaults, termMonths, annualEscalator, costEscalator,
      chartTag, chartView, chartVisible, chartUnitCounts, techDeprPct, colVisibility,
      summaryColWidths, summaryColVisibility,
    };
    const json = JSON.stringify(snapshot);
    const CHUNK = 30000;
    const stateRows = [['DO NOT EDIT: Pricing page round-trip payload. Drop this workbook back onto the Pricing page to restore state.']];
    for (let i = 0; i < json.length; i += CHUNK) stateRows.push([json.slice(i, i + CHUNK)]);
    const stateWs = XLSX.utils.aoa_to_sheet(stateRows);
    XLSX.utils.book_append_sheet(wb, stateWs, STATE_SHEET_NAME);

    sanitizeSheetJsWorkbook(wb);
    XLSX.writeFile(wb, `pricing-markup-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // Per-month CTS cost for a single line item, 1-based monthIndex.
  // Mirrors ctsItemYearCost but resolves the cost down to a single
  // month so the monthly-cost export can lay everything out across
  // the term. Setup / One Time lands in startMonth; Recurring bills
  // each month from startMonth through termMonths; Rolled amortizes
  // cts/termMonths every month from month 1. costEscalator compounds
  // annually (year 1 = months 1..12, year 2 = months 13..24, …).
  function ctsItemMonthlyCost(item, monthIndex) {
    if (typeof item.cts !== 'number') return 0;
    if (monthIndex < 1 || monthIndex > termMonths) return 0;
    const t = effectiveType(item);
    const isRecurring = /recurring.*monthly|monthly.*recurring|^recurring/i.test(t);
    const startMonth = Math.max(1, Math.round(Number(item.startMonth) || 1));
    const yearIdx = Math.ceil(monthIndex / 12);
    const esc = Math.pow(1 + costEscalator, yearIdx - 1);
    // Includes tech depr on non-pass-through cost so the monthly-cost
    // export matches what flows into the margin calc.
    const baseCost = ctsItemEffectiveCost(item);
    if (isRecurring) {
      if (monthIndex < startMonth) return 0;
      return baseCost * esc;
    }
    // Setup / One Time + Setup-Rolled / One-Time-Rolled: cost lands
    // upfront in the row's startMonth (Rolled bills the customer over
    // the term but we've already paid the supplier).
    return monthIndex === startMonth ? baseCost : 0;
  }

  // Excel export: monthly CTS cost for every line item on the active
  // Option, across the full term, with a totals row. Each line item
  // is one row; columns are Section · Line Item · Type · Start Month
  // · Term Total · M1 … MN. The bottom row sums every month + the
  // grand total. Filename: Monthly-Costs-<option>-<date>.xlsx.
  function exportMonthlyCosts() {
    if (!workbook) return;
    const opt = workbook.options.find(o => o.optionNumber === activeOption) || workbook.options[0];
    if (!opt) return;
    const term = Math.max(1, Math.min(360, termMonths || 36));
    const monthHeaders = Array.from({ length: term }, (_, i) => `M${i + 1}`);
    const rows = [];
    rows.push([`Monthly Costs: ${opt.sheetName}`]);
    rows.push([`Term: ${term} months · Cost escalator: ${(costEscalator * 100).toFixed(2)}% / yr · Tech depreciation: ${(techDeprPct * 100).toFixed(2)}% (folded into each non-pass-through row's cost)`]);
    rows.push([]);
    rows.push(['Section', 'Line Item', 'Type', 'Start Month', 'Term Total', ...monthHeaders]);

    const monthTotals = Array.from({ length: term }, () => 0);
    let grandTotal = 0;
    for (const sec of opt.sections) {
      for (const item of sec.items) {
        if (typeof item.cts !== 'number') continue;
        const monthly = Array.from({ length: term }, (_, i) => ctsItemMonthlyCost(item, i + 1));
        const rowTotal = monthly.reduce((s, v) => s + v, 0);
        for (let i = 0; i < term; i++) monthTotals[i] += monthly[i];
        grandTotal += rowTotal;
        rows.push([
          sec.title || '',
          item.description || '',
          effectiveType(item),
          item.startMonth || 1,
          rowTotal,
          ...monthly,
        ]);
      }
    }
    rows.push([
      '',
      'TOTAL',
      '',
      '',
      grandTotal,
      ...monthTotals,
    ]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Apply $#,##0.00 to every numeric cell from col E (Term Total)
    // onward — that's columns 4..(4 + term).
    const headerRowIdx = 3; // 0-based
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      for (let c = 4; c <= 4 + term; c++) {
        const v = rows[r][c];
        if (typeof v !== 'number') continue;
        const addr = XLSX.utils.encode_cell({ c, r });
        if (ws[addr]) ws[addr].z = '"$"#,##0.00';
      }
    }
    // Column widths: A 18, B 32, C 18, D 12, E 14, monthly cols 12 each.
    ws['!cols'] = [
      { wch: 18 }, { wch: 32 }, { wch: 18 }, { wch: 12 }, { wch: 14 },
      ...monthHeaders.map(() => ({ wch: 12 })),
    ];
    // Freeze the header row and the first 4 label columns so the
    // monthly grid scrolls cleanly.
    ws['!freeze'] = { xSplit: 4, ySplit: headerRowIdx + 1 };

    const wb = XLSX.utils.book_new();
    const sheetName = (`Monthly Costs ${opt.sheetName || `Option ${opt.optionNumber}`}`).slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const slug = (opt.sheetName || `Option-${opt.optionNumber}`).replace(/[^a-zA-Z0-9-]+/g, '-');
    sanitizeSheetJsWorkbook(wb);
    XLSX.writeFile(wb, `Monthly-Costs-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // Commercial Reference export — writes the active Option's cost line
  // items in the SE Commercial Reference template format (Commercial
  // Reference, Unit Amount, Quantity). Each item's CTS is annualized:
  // Recurring (monthly) costs are multiplied by 12 so every row reads
  // as a yearly figure; Setup / One Time costs pass through as-is.
  // Quantity is always 1. Filename: CommercialReference-<option>-<date>.csv.
  function exportCommercialRef() {
    if (!workbook) return;
    const opt = workbook.options.find(o => o.optionNumber === activeOption) || workbook.options[0];
    if (!opt) return;
    const escape = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lineRows = [];
    for (const sec of opt.sections) {
      for (const item of sec.items) {
        if (typeof item.cts !== 'number') continue;
        const isMonthly = /recurring.*monthly|monthly.*recurring|^recurring/i.test(effectiveType(item));
        const unitAmount = item.cts * (isMonthly ? 12 : 1);
        // Plain numbers, no currency formatting; skip zero-value line items.
        if (unitAmount === 0) continue;
        lineRows.push([item.description || '', unitAmount.toFixed(2), 1]);
      }
    }
    if (!lineRows.length) {
      window.alert('No cost line items to export on this Option.');
      return;
    }
    const lines = [
      ['Commercial Reference', 'Unit Amount', 'Quantity'].join(','),
      ...lineRows.map(cols => cols.map(escape).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = (opt.sheetName || `Option-${opt.optionNumber}`).replace(/[^a-zA-Z0-9-]+/g, '-');
    a.href = url;
    a.download = `CommercialReference-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Margin Request Template export — fills the standard SE template
  // with one block per loaded Pricing Option. Services come from the
  // per-option services bundle, Fee Structure is the option's Alt Fee
  // table summarized, Margin is the term-projected option margin
  // rounded to a whole percent, and Escalator is the annual revenue
  // escalator. Customer Name / SIA Link / RFP fields are left blank
  // for the user to fill in.
  // Fee-margin Excel for the active option: what each fee bills over the
  // term, the cost items behind it, and the margin that falls out. Reads
  // the same helpers the page renders from — priceFor, ctsItemYearCost,
  // altFeeYearRevenue, mappingNameFor — so the report can't disagree with
  // what's on screen. Every cost item lands in exactly one section: its
  // fee's, or the unmapped block at the end.
  async function exportFeeMargin() {
    const optNow = workbook?.options.find(o => o.optionNumber === activeOption) || workbook?.options[0];
    if (!optNow) return;
    setExportingMargin(true);
    try {
      const numYears = Math.max(1, Math.ceil(termMonths / 12));
      const years = Array.from({ length: numYears }, (_, i) => i + 1);
      const zeros = () => years.map(() => 0);
      const costItems = optNow.sections.flatMap(sec => sec.items);

      const costRow = (item) => {
        const { gm, price } = priceFor(item);
        const cts = typeof item.cts === 'number' ? item.cts : null;
        const passThrough = isPassThrough(item);
        const costByYear = years.map(y => ctsItemYearCost(item, y));
        return {
          lineItem: item.description || '(unnamed line item)',
          type: effectiveType(item),
          passThrough,
          cts,
          techDepr: cts == null ? null : (passThrough ? 0 : cts * techDeprPct),
          effectiveCost: cts == null ? null : ctsItemEffectiveCost(item),
          gmPct: typeof gm === 'number' ? gm : null,
          price: typeof price === 'number' ? price : null,
          costByYear,
          termCost: costByYear.reduce((a, b) => a + b, 0),
        };
      };

      // Group the schedule's fee rows by name — costs match a name, not a
      // row, so two rows sharing a name are one fee line here.
      const feeRows = altFees[optNow.optionNumber] || [];
      const byName = new Map();
      for (const row of feeRows) {
        const name = String(row.altItem || '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (!byName.has(key)) byName.set(key, { name, rows: [] });
        byName.get(key).rows.push(row);
      }

      const claimed = new Set();
      const fees = [...byName.values()].map(({ name, rows }) => {
        const key = name.toLowerCase();
        const mine = costItems.filter(it => mappingNameFor(it).trim().toLowerCase() === key);
        mine.forEach(it => claimed.add(it.id));
        const costs = mine.map(costRow);
        const costByYear = costs.reduce((acc, c) => acc.map((v, i) => v + c.costByYear[i]), zeros());
        const revenueByYear = rows.reduce(
          (acc, row) => acc.map((v, i) => v + altFeeYearRevenue(row, i + 1)), zeros());
        const termCost = costByYear.reduce((a, b) => a + b, 0);
        const termRevenue = revenueByYear.reduce((a, b) => a + b, 0);
        const first = rows[0] || {};
        const manual = rows.find(r => r.fee != null && r.fee !== '' && Number.isFinite(Number(r.fee)));
        const auto = autoFeePerUnitFor(first);
        return {
          name,
          type: [...new Set(rows.map(r => String(r.type || '').trim()).filter(Boolean))].join(' / '),
          unit: [...new Set(rows.map(r => String(r.unit || '').trim()).filter(Boolean))].join(' / '),
          unitCount: rows.reduce((s, r) => s + (Number(r.unitCount) || 0), 0),
          feePerUnit: manual ? Number(manual.fee) : (auto ?? null),
          feeSource: manual ? 'typed' : (auto == null ? 'none' : 'auto'),
          costs, costByYear, termCost,
          revenueByYear, termRevenue,
          marginByYear: revenueByYear.map((rev, i) => (rev > 0 ? (rev - costByYear[i]) / rev : null)),
          margin: termRevenue > 0 ? (termRevenue - termCost) / termRevenue : null,
        };
      });

      const unmappedCosts = costItems.filter(it => !claimed.has(it.id)).map(costRow);
      const totals = {
        revenueByYear: fees.reduce((acc, f) => acc.map((v, i) => v + f.revenueByYear[i]), zeros()),
        costByYear: fees.reduce((acc, f) => acc.map((v, i) => v + f.costByYear[i]), zeros()),
        termRevenue: fees.reduce((s, f) => s + f.termRevenue, 0),
        termCost: fees.reduce((s, f) => s + f.termCost, 0),
      };
      totals.margin = totals.termRevenue > 0
        ? (totals.termRevenue - totals.termCost) / totals.termRevenue : null;

      await downloadPricingMarginWorkbook({
        generatedAt: new Date(),
        fileName: workbook?.fileName || '',
        optionName: optNow.sheetName || `Option ${optNow.optionNumber}`,
        termMonths, numYears,
        annualEscalator, costEscalator, techDeprPct,
        globalGmPct: typeof globalGmPct === 'number' ? globalGmPct : null,
        mapBy: feeMapBy === 'automated' ? 'Automated Fee Name' : 'Fee Name Below',
        fees,
        unmapped: {
          costs: unmappedCosts,
          termCost: unmappedCosts.reduce((s, c) => s + c.termCost, 0),
        },
        costItemCount: costItems.length,
        mappedCostItemCount: claimed.size,
        totals,
      });
    } finally {
      setExportingMargin(false);
    }
  }

  async function exportMarginRequest() {
    if (!workbook || !Array.isArray(workbook.options) || workbook.options.length === 0) return;
    const { Workbook } = await import('exceljs');

    const SE_GREEN_DARK = 'FF009530';
    const LABEL_BG     = 'FFF1F5F9';
    const VALUE_BG     = 'FFFFFFFF';
    const OPTION_BG    = 'FFE5E7EB';
    const TEXT_DARK    = 'FF1E293B';
    const TEXT_MUTED   = 'FF64748B';
    const BORDER       = 'FFD4DDE1';

    const wb = new Workbook();
    wb.creator = 'Schneider Electric · Prospect Tracker';
    const ws = wb.addWorksheet('Margin Request', {
      properties: { tabColor: { argb: SE_GREEN_DARK } },
      views: [{ showGridLines: false }],
    });
    ws.columns = [
      { width: 24 }, // A: row labels / "Option N"
      { width: 32 }, // B: services / term value / Yes/No value
      { width: 14 }, // C: "Fee Structure" label
      { width: 44 }, // D: Fee Structure value
      { width: 14 }, // E: Margin / Escalator labels
      { width: 14 }, // F: Margin / Escalator values
    ];
    const SPAN = 6;
    const thinBorder = { style: 'thin', color: { argb: BORDER } };
    const allBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
    const setBordered = (cell) => { cell.border = allBorders; };
    const greenBanner = (cellRange, text) => {
      const [r1, c1, r2, c2] = cellRange;
      ws.mergeCells(r1, c1, r2, c2);
      const cell = ws.getCell(r1, c1);
      cell.value = text;
      cell.font = { name: 'Calibri', bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      for (let c = c1; c <= c2; c++) setBordered(ws.getCell(r1, c));
      ws.getRow(r1).height = 22;
    };
    const setLabel = (cell, text, opts = {}) => {
      cell.value = text;
      cell.font = { name: 'Calibri', bold: !opts.italic, italic: !!opts.italic, size: 11, color: { argb: opts.italic ? TEXT_MUTED : TEXT_DARK } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LABEL_BG } };
      cell.alignment = { vertical: 'middle', horizontal: opts.italic ? 'right' : 'left', indent: 1, wrapText: true };
      setBordered(cell);
    };
    const setValue = (cell, value, opts = {}) => {
      if (value !== undefined && value !== null) cell.value = value;
      cell.font = { name: 'Calibri', size: 11, color: { argb: TEXT_DARK } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.bg || VALUE_BG } };
      cell.alignment = { vertical: 'middle', horizontal: opts.align || 'left', indent: 1, wrapText: true };
      if (opts.numFmt) cell.numFmt = opts.numFmt;
      setBordered(cell);
    };

    // --- Header block --------------------------------------------------
    greenBanner([1, 1, 1, SPAN], 'Margin Request Template');

    setLabel(ws.getCell(2, 1), 'Customer Name');
    ws.mergeCells(2, 2, 2, SPAN);
    setValue(ws.getCell(2, 2), '');

    setLabel(ws.getCell(3, 1), 'Sales Investment Analyzer (SIA) Link');
    ws.mergeCells(3, 2, 3, SPAN);
    setValue(ws.getCell(3, 2), '');

    setLabel(ws.getCell(4, 1), 'Is this an RFP?');
    setLabel(ws.getCell(4, 2), 'Yes/No', { italic: true });
    ws.mergeCells(4, 3, 4, 4);
    setValue(ws.getCell(4, 3), 'No');
    setLabel(ws.getCell(4, 5), 'Due Date', { italic: true });
    setValue(ws.getCell(4, 6), 'N/A');

    // --- Options ------------------------------------------------------
    greenBanner([5, 1, 5, SPAN], 'SIA Options Seeking Approval');

    // Per-option margin: (termPrice − termCost) / termPrice, projecting
    // recurring revenue + cost over the term with the active escalators
    // (mirrors the per-option roll-up on the Pricing page).
    const computeOptionMargin = (opt) => {
      let termCost = 0, termPrice = 0;
      for (const sec of (opt.sections || [])) {
        for (const item of (sec.items || [])) {
          const { price } = priceFor(item);
          const t = effectiveType(item);
          const isRecurring = /^recurring/i.test(t);
          const isRolled = /\brolled\b/i.test(t);
          if (isRecurring) {
            termCost += projectMonthlyOverTerm(item.cts ?? null, costEscalator, termMonths);
            termPrice += projectMonthlyOverTerm(price ?? null, annualEscalator, termMonths);
          } else if (isRolled && termMonths > 0) {
            if (typeof item.cts === 'number') termCost += item.cts;
            const monthlyPrice = typeof price === 'number' ? price / termMonths : null;
            termPrice += projectMonthlyOverTerm(monthlyPrice, annualEscalator, termMonths);
          } else {
            if (typeof item.cts === 'number') termCost += item.cts;
            if (typeof price === 'number') termPrice += price;
          }
        }
      }
      if (!Number.isFinite(termPrice) || termPrice <= 0) return null;
      return (termPrice - termCost) / termPrice;
    };

    // Compact summary of an option's Alt Fee rows. Empty rows are
    // dropped; each kept row reads as "{altItem}: ${fee}/{unit}" plus
    // a "({type})" qualifier when the row has one. Falls back to a
    // dash so the cell isn't ambiguous when no alt fees are entered.
    const summarizeAltFees = (opt) => {
      const list = altFees?.[opt.optionNumber] || [];
      const lines = [];
      for (const r of list) {
        const item = String(r?.altItem || '').trim();
        const feeNum = Number(r?.fee);
        if (!item && !Number.isFinite(feeNum)) continue;
        const unit = String(r?.unit || '').trim();
        const type = String(r?.type || '').trim();
        const feeTxt = Number.isFinite(feeNum)
          ? `$${feeNum.toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit ? `/${unit}` : ''}`
          : '';
        const main = [item, feeTxt].filter(Boolean).join(': ');
        lines.push(type ? `${main} (${type})` : main);
      }
      return lines.length > 0 ? lines.join('\n') : '-';
    };

    let row = 6;
    const escPct = Math.round((annualEscalator || 0) * 100);
    const termYrs = termMonths ? termMonths / 12 : 0;
    workbook.options.forEach((opt, idx) => {
      const optionLabel = `Option ${idx + 1}`;
      // Row 1 of the block — option header strip.
      setLabel(ws.getCell(row, 1), optionLabel);
      ws.mergeCells(row, 2, row, SPAN);
      setValue(ws.getCell(row, 2), opt.sheetName || '', { bg: OPTION_BG });
      ws.getCell(row, 2).font = { name: 'Calibri', bold: true, size: 11, color: { argb: TEXT_DARK } };
      ws.getRow(row).height = 20;

      // Row 2 — Services | (Fee Structure label) | (Fee Structure value, merged with row 3) | Margin label/value
      setLabel(ws.getCell(row + 1, 1), 'Services', { italic: true });
      const services = (pricingOptionServices?.[opt.sheetName] || []).filter(Boolean);
      setValue(ws.getCell(row + 1, 2), services.length > 0 ? services.join('\n') : '-');
      setLabel(ws.getCell(row + 1, 3), 'Fee Structure', { italic: true });
      // Merge Fee Structure value across rows 2 and 3 of the block.
      ws.mergeCells(row + 1, 4, row + 2, 4);
      setValue(ws.getCell(row + 1, 4), summarizeAltFees(opt));
      setLabel(ws.getCell(row + 1, 5), 'Margin', { italic: true });
      const margin = computeOptionMargin(opt);
      if (margin == null) {
        setValue(ws.getCell(row + 1, 6), '-', { align: 'right' });
      } else {
        setValue(ws.getCell(row + 1, 6), Math.round(margin * 100) / 100, { align: 'right', numFmt: '0%' });
      }

      // Row 3 — Term | Term value | (Fee Structure value continues) | Escalator label/value
      setLabel(ws.getCell(row + 2, 1), 'Term', { italic: true });
      setValue(ws.getCell(row + 2, 2), termYrs || '-', termYrs ? { numFmt: '0.##" yrs"' } : {});
      // Fee Structure label cell on row 3 stays empty (the value spans
      // from row 2). Tag it with the label-styled empty cell so the
      // border lines up with its row neighbours.
      setLabel(ws.getCell(row + 2, 3), '', { italic: true });
      setLabel(ws.getCell(row + 2, 5), 'Escalator', { italic: true });
      setValue(ws.getCell(row + 2, 6), escPct / 100, { align: 'right', numFmt: '0%' });

      ws.getRow(row + 1).height = Math.max(22, services.length * 14);
      ws.getRow(row + 2).height = 22;
      row += 3;
    });

    sanitizeExcelWorkbook(wb);
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fileSlug = (workbook.fileName || 'Pricing').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-]+/g, '-');
    a.download = `Margin-Request-${fileSlug}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

  // The Target GM% the uploaded SIA carries, so the page can offer it
  // instead of the margin being typed in by hand. The active Option sheet's
  // own target wins; failing that, the first sheet in the book that has one
  // (the target is usually the same across a workbook's options). Null when
  // the file has no target — including a workbook parsed before this was
  // read, which simply won't offer the button until it's uploaded again.
  const siaGm = useMemo(() => {
    const opts = workbook?.options || [];
    if (opts.length === 0) return null;
    const active = opts.find(o => o.optionNumber === activeOption);
    const hit = (typeof active?.targetGmPct === 'number' ? active : opts.find(o => typeof o.targetGmPct === 'number'));
    if (!hit || typeof hit.targetGmPct !== 'number') return null;
    return { pct: hit.targetGmPct, sheetName: hit.sheetName, useTargetGm: hit.useTargetGm ?? null };
  }, [workbook, activeOption]);
  // Whether the box already holds the SIA's number — down to the tenth of a
  // percent the field itself edits in, so a value typed to match still reads
  // as "from SIA" rather than offering to set what is already set.
  const siaGmApplied = !!siaGm && Math.round(siaGm.pct * 1000) === Math.round(globalGmPct * 1000);

  return (
    <div
      className={styles.wrapper}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      style={dragOver ? { outline: '2px dashed var(--color-accent)', outlineOffset: -4, background: '#F0F9FF' } : undefined}
    >
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Pricing</h1>
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
            {/* The SIA's own Target GM%, offered rather than applied: the
                margin is still typed here by default, and this only fills it
                in when the user asks for it. */}
            {siaGm && (
              siaGmApplied ? (
                <span
                  className={styles.gmSourceTag}
                  title={`Matches the Target GM% on ${siaGm.sheetName}${siaGm.useTargetGm === false ? ' (that sheet priced off its individual line GM%, not this target)' : ''}`}
                >from SIA</span>
              ) : (
                <button
                  type="button"
                  className={styles.gmImportBtn}
                  onClick={() => setGlobalGmPct(siaGm.pct)}
                  title={`Use the Target GM% read from ${siaGm.sheetName} (${fmtPct(siaGm.pct)})${siaGm.useTargetGm === false ? '. That sheet is set to price off its individual line GM% rather than this target.' : ''}`}
                >Use SIA {fmtPct(siaGm.pct)}</button>
              )
            )}
          </label>

          <label className={styles.gmField} title="Number of months in the contract term: used to project recurring (monthly) totals.">
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

          <label className={styles.gmField} title="Cost escalator applied to recurring (monthly) and rolled CTS costs year-over-year. Separate from the revenue escalator so margin can compress over time.">
            Cost Esc.
            <input
              className={styles.gmInput}
              type="number"
              step="0.05"
              min="0"
              max="50"
              value={Math.round(costEscalator * 10000) / 100}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                setCostEscalator(Math.max(0, Math.min(0.5, n / 100)));
              }}
            />
            <span>%/yr</span>
          </label>

          <label className={styles.gmField} title="Tech depreciation rate applied as a derived column on each cost.">
            Tech Depr.
            <input
              className={styles.gmInput}
              type="number"
              step="0.5"
              min="0"
              max="50"
              value={Math.round(techDeprPct * 1000) / 10}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                setTechDeprPct(Math.max(0, Math.min(0.5, n / 100)));
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
              <button
                className={styles.actionBtn}
                onClick={exportMonthlyCosts}
                title="Excel export of monthly CTS cost for every line item on the active Option, across the full term, with a totals row at the bottom."
              >
                Monthly costs ⇩
              </button>
              <button
                className={styles.actionBtn}
                onClick={exportMarginRequest}
                title="Fill the SE Margin Request Template with one block per Pricing Option: Services, Term, Alt Fee Structure, Margin, and Escalator."
              >
                Margin Request ⇩
              </button>
              <button className={styles.actionBtnDanger} onClick={clearAll}>Clear</button>
            </>
          )}
        </div>
      </div>

      {workbook && pageSubtab === 'pricing' && (
        <div style={{ padding: '0 1.25rem 0.5rem' }} className={styles.fileMeta}>
          <strong>{workbook.fileName}</strong>
          {' · '}
          {workbook.options.length} option sheet{workbook.options.length === 1 ? '' : 's'} found
          {(() => {
            const sites = workbook.options.find(o => typeof o.siteCount === 'number')?.siteCount;
            const accounts = workbook.options.find(o => typeof o.accountCount === 'number')?.accountCount;
            if (sites == null && accounts == null) return null;
            return (
              <>
                {' · '}
                {sites != null && <span title="Pulled from the SIA metadata block">{sites.toLocaleString()} site{sites === 1 ? '' : 's'}</span>}
                {sites != null && accounts != null && ' · '}
                {accounts != null && <span title="Pulled from the SIA metadata block">{accounts.toLocaleString()} account{accounts === 1 ? '' : 's'}</span>}
              </>
            );
          })()}
        </div>
      )}

      {error && (
        <div style={{ margin: '0 1.25rem 0.5rem', color: '#b91c1c' }}>{error}</div>
      )}

      {/* Unmapped line items are only fixable on the Linked To subtab, which
          means nothing says they exist until you happen to go there. Say it
          here, where the workbook is actually being worked, and make it the
          way in. */}
      {pageSubtab === 'pricing' && unmappedForBanner.all.length > 0 && (() => {
        const n = unmappedForBanner.all.length;
        const breakdown = unmappedBreakdown(unmappedForBanner);
        const names = unmappedForBanner.all.slice(0, 15).map(r => r.name).join(', ');
        const more = n > 15 ? `, +${n - 15} more` : '';
        return (
          <button
            type="button"
            className={styles.unmappedBanner}
            onClick={() => setPageSubtab('linkedTo')}
            title={`Still to map: ${names}${more}`}
          >
            <span aria-hidden="true">⚠</span>
            <span>
              <strong>{n} line item{n === 1 ? '' : 's'}</strong>
              {' '}on this option {n === 1 ? 'is' : 'are'} neither mapped to a service nor ignored
              {breakdown && <> — {breakdown}</>}
              . Open <strong>Linked To → Line Item → Services</strong> to fix {n === 1 ? 'it' : 'them'}.
            </span>
          </button>
        );
      })()}

      {pageSubtab === 'pricing' && <PricingConversions />}

      <div className={styles.subtabStrip}>
        <button
          type="button"
          className={pageSubtab === 'pricing' ? styles.subtabActive : styles.subtab}
          onClick={() => setPageSubtab('pricing')}
        >
          Pricing
        </button>
        <button
          type="button"
          className={pageSubtab === 'linkedTo' ? styles.subtabActive : styles.subtab}
          onClick={() => setPageSubtab('linkedTo')}
        >
          Linked To
        </button>
        <button
          type="button"
          className={pageSubtab === 'options' ? styles.subtabActive : styles.subtab}
          onClick={() => setPageSubtab('options')}
        >
          Options
        </button>
        <button
          type="button"
          className={pageSubtab === 'compare' ? styles.subtabActive : styles.subtab}
          onClick={() => setPageSubtab('compare')}
        >
          Compare
        </button>
        <button
          type="button"
          className={pageSubtab === 'brokerFees' ? styles.subtabActive : styles.subtab}
          onClick={() => setPageSubtab('brokerFees')}
        >
          Broker Fees
        </button>
        <button
          type="button"
          className={pageSubtab === 's2c' ? styles.subtabActive : styles.subtab}
          onClick={() => setPageSubtab('s2c')}
        >
          S2C
        </button>
        <button
          type="button"
          className={pageSubtab === 'calculator' ? styles.subtabActive : styles.subtab}
          onClick={() => setPageSubtab('calculator')}
        >
          Calculator
        </button>
      </div>

      {pageSubtab === 'linkedTo' && (
        <LinkedToPanel
          workbook={workbook}
          activeOption={activeOption}
          setActiveOption={setActiveOption}
          overrides={overrides}
          linkedToDefaults={linkedToDefaults}
          linkedToUnitDefaults={linkedToUnitDefaults}
          setLinkedToUnitDefault={setLinkedToUnitDefault}
          linkedToStartMonthDefaults={linkedToStartMonthDefaults}
          setLinkedToStartMonthDefault={setLinkedToStartMonthDefault}
          linkedToPassThroughDefaults={linkedToPassThroughDefaults}
          setLinkedToPassThroughDefault={setLinkedToPassThroughDefault}
          feeDefaults={feeDefaults}
          setFeeDefaultField={setFeeDefaultField}
          removeFeeDefault={removeFeeDefault}
          linkedToOptionsList={linkedToOptionsList}
          altFees={altFees}
          resolvedLinkedTo={resolvedLinkedTo}
          effectiveType={effectiveType}
          linkedToDefaultKey={linkedToDefaultKey}
          removeLinkedToDefault={removeLinkedToDefault}
          lineItemServices={lineItemServices}
          setLineItemServices={setLineItemServices}
          lineItemIgnored={lineItemIgnored}
          setLineItemIgnored={setLineItemIgnored}
          solutionsOptions={solutionsOptions}
        />
      )}

      {pageSubtab === 'options' && (
        <OptionsTab
          options={optionsTabData || []}
          setOptions={setOptionsTabData}
        />
      )}

      {pageSubtab === 'compare' && (
        <CompareTab
          state={compareTabData}
          setState={setCompareTabData}
          workbook={workbook}
          /* Fee Bucket groups by whichever column the Pricing tab is
             mapping with, so the comparison and the option totals can't
             bucket a cost two different ways. */
          resolvedLinkedTo={mappingNameFor}
          effectiveType={effectiveType}
          techDeprPct={techDeprPct}
        />
      )}

      {pageSubtab === 'brokerFees' && (
        <BrokerFeesTab
          rows={brokerFeesData}
          setRows={setBrokerFeesData}
        />
      )}

      {pageSubtab === 's2c' && (
        <S2CTab
          rows={s2cTabData}
          setRows={setS2cTabData}
        />
      )}

      {pageSubtab === 'calculator' && <CalculatorTab />}

      <div className={styles.body} style={pageSubtab !== 'pricing' ? { display: 'none' } : undefined}>
        {!workbook && (
          <div className={styles.empty}>
            <div>No workbook loaded.</div>
            <div style={{ fontSize: 'var(--font-size-xs)' }}>
              Click <strong>Upload workbook</strong> above. We'll read every sheet named "Option 1" through "Option 5" (including hidden ones), and pull line items from the section bounded by <strong>Delivery Team Inputs</strong> at the top and <strong>Cost Summary</strong> at the bottom. Set a global GM% (gross margin) to apply across all rows, or override individual line items.
            </div>
          </div>
        )}

        {workbook && workbook.options.length > 0 && (() => {
          const opt = workbook.options.find(o => o.optionNumber === activeOption) || workbook.options[0];
          const t = totals?.[opt.optionNumber];
          // Sheet name doubles as the link label so the Pricing-subtab
          // chip matches what Opps 2 displays under "Pricing Option".
          const optionLabel = (opt.sheetName || '').trim();
          // Only links saved from *this* workbook count — a link left
          // over from a file that also had an "Option 1" must not chip
          // itself onto the one loaded now.
          const linkedOppId = optionLabel
            ? findLinkedOppId(optionLinks, {
              name: optionLabel,
              source: 'pricing',
              workbookId: workbook.id,
              allowLegacy: !!workbook.legacyLinks,
            })
            : null;
          const linkedOpp = linkedOppId
            ? opps2Records.find(r => String(r._id) === String(linkedOppId)) || null
            : null;
          const linkedLabel = linkedOpp
            ? `${linkedOpp.Account || '(no Account)'}${linkedOpp.Scope ? ` · ${linkedOpp.Scope}` : ''}`
            : (linkedOppId ? `(opp ${linkedOppId})` : null);
          return (
            <>
              <div className={styles.tabStrip}>
                {workbook.options.map(o => {
                  const isActive = o.optionNumber === opt.optionNumber;
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
                      {o.isClone && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); deleteClonedOption(o.optionNumber); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              deleteClonedOption(o.optionNumber);
                            }
                          }}
                          title="Delete this cloned option"
                          style={{
                            marginLeft: 6,
                            padding: '0 4px',
                            borderRadius: 999,
                            fontSize: '0.85em',
                            lineHeight: 1,
                            cursor: 'pointer',
                            opacity: 0.75,
                          }}
                        >×</span>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={exportCommercialRef}
                      title={`Export "${opt.sheetName}" cost line items as a Commercial Reference CSV. Monthly costs are annualized (×12); Quantity is always 1.`}
                    >Commercial Ref ⇩</button>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      disabled={exportingMargin}
                      onClick={exportFeeMargin}
                      title={`Export "${opt.sheetName}" as an Excel report: a summary of every fee line's term revenue, cost and margin, plus a per-fee breakdown of the cost items behind it and how they mark up across the term. Costs with no fee are listed too.`}
                    >{exportingMargin ? 'Building…' : 'Fee Margin Excel ⇩'}</button>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={cloneActiveOption}
                      title={`Clone "${opt.sheetName}" into a new Option on this workbook. The clone is temporary: it goes away when you remove or replace the file.`}
                    >Clone option</button>
                    {linkedLabel ? (
                      <span
                        className={styles.savedChip}
                        title={`Linked to Opps row: ${linkedLabel}`}
                      >
                        Saved to: {linkedLabel}
                        <button
                          type="button"
                          className={styles.savedChipClear}
                          onClick={() => {
                            if (linkedOppId) setOppOptionLink(linkedOppId, '').catch(() => {});
                          }}
                          title="Unlink from this Opp"
                        >×</button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => {
                          if (!optionLabel) {
                            window.alert('This Option has no sheet name to link.');
                            return;
                          }
                          setPricingPickerOpen(true);
                        }}
                        title={`Save "${opt.sheetName}" to an Opps row.`}
                      >Save to Opp…</button>
                    )}
                    {/* Which fee-name column every number on this page is
                        calculated from. */}
                    <div className={styles.mapBy} role="group" aria-label="Map costs to fees by">
                      <span className={styles.mapByLabel}>Map by</span>
                      <button
                        type="button"
                        className={feeMapBy === 'automated' ? styles.mapByOn : styles.mapByOff}
                        aria-pressed={feeMapBy === 'automated'}
                        onClick={() => setFeeMapBy('automated')}
                        title="Group costs by their Automated Fee Name to build a fee structure from them. Fees with no typed amount are derived from the costs that carry the same name."
                      >Automated Fee Name</button>
                      <button
                        type="button"
                        className={feeMapBy === 'below' ? styles.mapByOn : styles.mapByOff}
                        aria-pressed={feeMapBy === 'below'}
                        onClick={() => setFeeMapBy('below')}
                        title="Map each cost to the row of the fee schedule below that its Fee Name Below points at. Rows with no pick follow their Automated Fee Name."
                      >Fee Name Below</button>
                    </div>
                    <ColumnsMenu
                      open={colMenuOpen}
                      onToggle={() => setColMenuOpen(o => !o)}
                      columns={COLS}
                      hiddenFn={colHidden}
                      onItemToggle={toggleColVisible}
                    />
                    {(() => {
                      const emptyCtsCount = opt.sections
                        .flatMap(s => s.items)
                        .filter(i => typeof i.cts !== 'number').length;
                      if (emptyCtsCount === 0) return null;
                      return (
                        <button
                          type="button"
                          className={styles.actionBtn}
                          onClick={() => setHideEmptyCtsRows(v => !v)}
                          title={hideEmptyCtsRows
                            ? `${emptyCtsCount} line item${emptyCtsCount === 1 ? '' : 's'} with no CTS value ${emptyCtsCount === 1 ? 'is' : 'are'} hidden. Click to show them.`
                            : `Showing ${emptyCtsCount} line item${emptyCtsCount === 1 ? '' : 's'} with no CTS value. Click to hide them.`}
                        >
                          {hideEmptyCtsRows
                            ? `Show empty-CTS rows (${emptyCtsCount})`
                            : `Hide empty-CTS rows (${emptyCtsCount})`}
                        </button>
                      );
                    })()}
                    {t && (
                      <div className={styles.optionSummary}>
                        <span>Cost: <span className={styles.summaryNum}>{fmtMoney(t.cost)}</span></span>
                        <span>Marked-up: <span className={styles.summaryNum}>{fmtMoney(t.price)}</span></span>
                      </div>
                    )}
                  </div>
                </div>

                {(typeof opt.siteCount === 'number' || typeof opt.accountCount === 'number') && (
                  <div className={styles.optionMeta} title="Pulled from the SIA metadata block on this Option sheet">
                    {typeof opt.siteCount === 'number' && (
                      <>{opt.siteCount.toLocaleString()} site{opt.siteCount === 1 ? '' : 's'}</>
                    )}
                    {typeof opt.siteCount === 'number' && typeof opt.accountCount === 'number' && ' · '}
                    {typeof opt.accountCount === 'number' && (
                      <>{opt.accountCount.toLocaleString()} account{opt.accountCount === 1 ? '' : 's'}</>
                    )}
                  </div>
                )}

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
                  // Predictive-text suggestions for the per-row Linked
                  // To input. Unions every tag the user has touched —
                  // saved (Line Item, Type) defaults, alt-fee rows on
                  // this option, and per-row overrides — deduped
                  // case-insensitively while preserving the original
                  // casing for display. The raw auto-derived union is
                  // kept separate so the ± options manager can tell
                  // auto tags from hand-added ones; the dropdown itself
                  // then folds in the user's custom options and drops
                  // the removed (hidden) ones.
                  const linkedToAutoTags = (() => {
                    const seen = new Map();
                    const add = (name) => {
                      const trimmed = String(name || '').trim();
                      if (!trimmed) return;
                      const k = trimmed.toLowerCase();
                      if (!seen.has(k)) seen.set(k, trimmed);
                    };
                    for (const v of Object.values(linkedToDefaults)) add(v);
                    for (const r of (altFees[opt.optionNumber] || [])) add(r.altItem);
                    for (const o of Object.values(overrides)) if (o?.linkedTo) add(o.linkedTo);
                    return [...seen.values()];
                  })();
                  const linkedToSuggestions = (() => {
                    const hiddenTags = new Set((linkedToOptionsList.hidden || []).map(s => String(s).trim().toLowerCase()));
                    const seen = new Map();
                    for (const name of [...linkedToAutoTags, ...(linkedToOptionsList.custom || [])]) {
                      const trimmed = String(name || '').trim();
                      if (!trimmed) continue;
                      const k = trimmed.toLowerCase();
                      if (!seen.has(k) && !hiddenTags.has(k)) seen.set(k, trimmed);
                    }
                    return [...seen.values()].sort((a, b) => a.localeCompare(b));
                  })();
                  // The fee rows this option's schedule actually carries —
                  // the only values the SIA Fee column offers, so a row can
                  // never point at a fee that isn't in the table below.
                  // Deduped case-insensitively, kept in schedule order.
                  const feeScheduleNames = (() => {
                    const seen = new Set();
                    const out = [];
                    for (const r of (altFees[opt.optionNumber] || [])) {
                      const name = String(r.altItem || '').trim();
                      if (!name) continue;
                      const k = name.toLowerCase();
                      if (seen.has(k)) continue;
                      seen.add(k);
                      out.push(name);
                    }
                    return out;
                  })();
                  const totalCost = flatItems.reduce((s, i) => s + (typeof i.cts === 'number' ? i.cts : 0), 0);
                  const totalPrice = flatItems.reduce((s, i) => {
                    const { price } = priceFor(i);
                    return s + (typeof price === 'number' ? price : 0);
                  }, 0);
                  // Aggregate by effective Type for the summary panel.
                  // "Rolled" variants amortize the cost across the term and
                  // project with the annual escalator (same shape as the
                  // recurring-monthly projection). Plain Setup / One Time
                  // contribute their face value to the term column.
                  const sumByType = (typeRe, isRecurring) => flatItems.reduce((acc, i) => {
                    const t = effectiveType(i);
                    if (!typeRe.test(t)) return acc;
                    const { price } = priceFor(i);
                    const isRolled = /\brolled\b/i.test(t);
                    const itemPassThrough = isPassThrough(i);
                    if (typeof i.cts === 'number') {
                      acc.cost += i.cts;
                      // Tech depreciation is applied only to non-pass-through
                      // cost — pass-through rows are billed at face cost so
                      // we don't book any depreciation against them.
                      if (!itemPassThrough) acc.depreciableCost += i.cts;
                    }
                    if (typeof price === 'number') acc.price += price;

                    if (isRecurring) {
                      acc.termCost += projectMonthlyOverTerm(i.cts ?? null, costEscalator, termMonths);
                      acc.termPrice += projectMonthlyOverTerm(price ?? null, annualEscalator, termMonths);
                    } else if (isRolled && termMonths > 0) {
                      // Rolled: revenue is amortized over the term so
                      // termPrice still projects with the escalator,
                      // but the cost is booked upfront (full face
                      // value, no projection) so margin math reflects
                      // when we actually pay.
                      const monthlyPrice = typeof price === 'number' ? price / termMonths : null;
                      if (typeof i.cts === 'number') acc.termCost += i.cts;
                      acc.termPrice += projectMonthlyOverTerm(monthlyPrice, annualEscalator, termMonths);
                    } else {
                      if (typeof i.cts === 'number') acc.termCost += i.cts;
                      if (typeof price === 'number') acc.termPrice += price;
                    }
                    return acc;
                  }, { cost: 0, depreciableCost: 0, price: 0, termCost: 0, termPrice: 0 });
                  // Setup and One Time (and their Rolled variants) share
                  // a single bucket for fee/margin math, but the Totals
                  // by Type table below still breaks them out so the
                  // user can see what each contributes.
                  const setup = sumByType(/^setup(\s+rolled)?$/i, false);
                  const oneTime = sumByType(/^one\s*time(\s+rolled)?$/i, false);
                  const setupOneTime = {
                    cost: setup.cost + oneTime.cost,
                    depreciableCost: setup.depreciableCost + oneTime.depreciableCost,
                    price: setup.price + oneTime.price,
                    termCost: setup.termCost + oneTime.termCost,
                    termPrice: setup.termPrice + oneTime.termPrice,
                  };
                  const recurring = sumByType(/recurring.*monthly|monthly.*recurring|^recurring/i, true);
                  const grandTermCost = setupOneTime.termCost + recurring.termCost;
                  const grandTermPrice = setupOneTime.termPrice + recurring.termPrice;
                  return (
                    <div className={styles.section}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            {COLS.filter(c => !colHidden(c.key)).map(col => (
                              <th
                                key={col.key}
                                style={{ width: colWidths[col.key] ?? col.defaultWidth }}
                              >
                                <span className={styles.thInner}>
                                  <span className={styles.thLabel}>{col.label}</span>
                                  {((col.key === 'linkedTo' && feeMapBy === 'automated')
                                    || (col.key === 'siaFee' && feeMapBy === 'below')) && (
                                    <span
                                      className={styles.inUseDot}
                                      title="In use: every total, margin and auto-fee on this page is calculated from this column. Switch with the Map by control above."
                                    />
                                  )}
                                  {col.key === 'linkedTo' && (
                                    <button
                                      type="button"
                                      onClick={() => setLinkedToOptionsModal({ autoTags: linkedToAutoTags })}
                                      title="Add or remove options in the Automated Fee Name dropdown"
                                      style={{ marginLeft: 4, padding: '0 5px', border: '1px solid var(--color-border)', borderRadius: 3, background: '#fff', fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', cursor: 'pointer', lineHeight: 1.4, fontFamily: 'inherit' }}
                                    >±</button>
                                  )}
                                  <span
                                    className={styles.colResizer}
                                    onMouseDown={(e) => startColResize('main', col.key, e)}
                                    title="Drag to resize column"
                                  />
                                </span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {flatItems.filter(item => !hideEmptyCtsRows || typeof item.cts === 'number').map(item => {
                            const { gm, source, price } = priceFor(item);
                            const overrideVal = overrides[item.id]?.gmPct;
                            const passThrough = isPassThrough(item);
                            const techDepr = (typeof item.cts === 'number' && !passThrough) ? item.cts * techDeprPct : (passThrough ? 0 : null);
                            return (
                              <tr key={item.id} className={passThrough ? styles.passThroughRow : undefined}>
                                {!colHidden('lineItem') && <td>{item.description}</td>}
                                {!colHidden('type') && (
                                  <td>
                                    {(() => {
                                      const t = effectiveType(item);
                                      const knownOptions = ['Setup', 'Setup Rolled', 'One Time', 'One Time Rolled', 'Recurring (monthly)'];
                                      return (
                                        <select
                                          className={styles.typeSelect}
                                          value={t}
                                          onChange={(e) => setItemType(item.id, e.target.value)}
                                          title="Click to change type. 'Rolled' variants amortize the cost over the term but still bucket under Setup or One Time."
                                        >
                                          {t && !knownOptions.includes(t) && <option value={t}>{t}</option>}
                                          <option value="">-</option>
                                          <option value="Setup">Setup</option>
                                          <option value="Setup Rolled">Setup Rolled</option>
                                          <option value="One Time">One Time</option>
                                          <option value="One Time Rolled">One Time Rolled</option>
                                          <option value="Recurring (monthly)">Recurring (monthly)</option>
                                        </select>
                                      );
                                    })()}
                                  </td>
                                )}
                                {!colHidden('cts') && <td className={styles.numCell}>{item.cts === null || item.cts === undefined ? '' : fmtMoney(item.cts)}</td>}
                                {!colHidden('techDepr') && (
                                  <td className={styles.numCell} title={`${(techDeprPct * 100).toFixed(1)}% of CTS`}>
                                    {techDepr === null ? '' : fmtMoney(techDepr)}
                                  </td>
                                )}
                                {!colHidden('start') && <td>{item.startMonth || ''}</td>}
                                {!colHidden('comments') && <td>{item.comments || ''}</td>}
                                {!colHidden('gm') && (
                                  <td className={styles.gmCell}>
                                    <GmInput
                                      key={`${item.id}:${passThrough ? 'pass' : (overrideVal === undefined ? 'unset' : overrideVal)}`}
                                      initialPct={passThrough ? null : (overrideVal !== undefined ? overrideVal * 100 : null)}
                                      isOverride={!passThrough && overrideVal !== undefined}
                                      placeholder={passThrough ? 'pass' : (gm === null ? '' : `${Math.round(gm * 100)}%`)}
                                      disabled={passThrough}
                                      title={
                                        passThrough
                                          ? 'Pass-through row: billed to the customer at cost. Unmap this Line Item + Type on the Linked To subtab to apply markup.'
                                          : source === 'override'
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
                                )}
                                {!colHidden('price') && <td className={styles.priceCell}>{fmtMoney(price)}</td>}
                                {!colHidden('linkedTo') && (() => {
                                  const tagName = resolvedLinkedTo(item).trim();
                                  const tagMapped = !!feeScheduleNames.find(n => n.toLowerCase() === tagName.toLowerCase());
                                  return (
                                  <td
                                    className={tagMapped ? styles.mappedCell : undefined}
                                    title={tagMapped ? `Mapped to "${tagName}" in the fee schedule below.` : undefined}
                                  >
                                    {(() => {
                                      const effType = effectiveType(item);
                                      const key = linkedToDefaultKey(item.description, effType);
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
                                            suggestions={linkedToSuggestions}
                                          />
                                          <button
                                            type="button"
                                            className={`${styles.defaultStar} ${matchesDefault ? styles.defaultStarOn : ''}`}
                                            onClick={() => toggleLinkedToDefault(item)}
                                            disabled={!canSetDefault && !canClearDefault}
                                            title={
                                              matchesDefault
                                                ? `Default for "${item.description}" · ${effType || '(no type)'}. Click to clear.`
                                                : canSetDefault
                                                ? `Save "${currentVal}" as the default for "${item.description}" · ${effType || '(no type)'}.`
                                                : 'Type a value above, then click to save it as the default.'
                                            }
                                          >
                                            {matchesDefault ? '★' : '☆'}
                                          </button>
                                          {/* A name with no row under it prices nothing — this puts
                                              the row there, typed to match the cost, with its fee
                                              left to derive from the costs carrying the name. */}
                                          <button
                                            type="button"
                                            className={styles.addFeeBtn}
                                            onClick={() => createAltFeeFromLinkedTo(item)}
                                            disabled={!currentVal.trim() || tagMapped}
                                            title={
                                              !currentVal.trim()
                                                ? 'Give this cost an Automated Fee Name first, then add it to the fee schedule below.'
                                                : tagMapped
                                                ? `"${tagName}" is already a row in the Alternative Fee schedule below.`
                                                : `Add "${currentVal.trim()}" to the Alternative Fee schedule below as ${feeDefaultsFor(currentVal)?.type || altFeeTypeForCtsType(effType) || 'an untyped row'}. Its fee and start month derive from every cost carrying this name.`
                                            }
                                          >
                                            + Fee
                                          </button>
                                        </div>
                                      );
                                    })()}
                                  </td>
                                  );
                                })()}
                                {!colHidden('siaFee') && (() => {
                                  const resolved = resolvedSiaFee(item).trim();
                                  const feeMapped = !!feeScheduleNames.find(n => n.toLowerCase() === resolved.toLowerCase());
                                  return (
                                  <td
                                    className={feeMapped ? styles.mappedCell : undefined}
                                    title={feeMapped ? `Mapped to "${resolved}" in the fee schedule below.` : undefined}
                                  >
                                    {(() => {
                                      const picked = overrides[item.id]?.siaFee;
                                      const tag = resolvedLinkedTo(item).trim();
                                      const current = picked !== undefined ? picked.trim() : tag;
                                      const lower = current.toLowerCase();
                                      // Match the schedule's own casing so the
                                      // <select> value lines up with an option.
                                      const match = current
                                        ? feeScheduleNames.find(n => n.toLowerCase() === lower)
                                        : '';
                                      const inherited = picked === undefined && !!match;
                                      const stale = !!current && !match;
                                      return (
                                        <select
                                          className={styles.typeSelect}
                                          style={inherited ? { fontStyle: 'italic', color: 'var(--color-text-muted)' } : undefined}
                                          value={match || (stale ? '__stale__' : '')}
                                          onChange={(e) => {
                                            const v = e.target.value;
                                            if (v === '__auto__') setItemSiaFee(item, null);
                                            else if (v !== '__stale__') setItemSiaFee(item, v);
                                          }}
                                          title={
                                            feeScheduleNames.length === 0
                                              ? 'No fee rows in the Alternative Fee schedule below yet: add one and it shows up here.'
                                              : inherited
                                              ? `Following the Automated Fee Name "${tag}". Pick a fee row to pin this cost to it instead.`
                                              : stale
                                              ? `"${current}" is not a row in the fee schedule below: this cost isn't tied to any fee.`
                                              : 'Which row of the Alternative Fee schedule below this cost is tied to.'
                                          }
                                        >
                                          <option value="">-</option>
                                          {feeScheduleNames.map(n => <option key={n} value={n}>{n}</option>)}
                                          {stale && <option value="__stale__">{current} (not in schedule)</option>}
                                          {picked !== undefined && tag && (
                                            <option value="__auto__">↺ Follow Automated Fee Name ({tag})</option>
                                          )}
                                        </select>
                                      );
                                    })()}
                                  </td>
                                  );
                                })()}
                              </tr>
                            );
                          })}
                          {(() => {
                            const totalDepr = flatItems.reduce((s, i) => s + ((typeof i.cts === 'number' && !isPassThrough(i)) ? i.cts * techDeprPct : 0), 0);
                            const cells = [];
                            COLS.filter(c => !colHidden(c.key)).forEach(col => {
                              switch (col.key) {
                                case 'lineItem':
                                  cells.push(<td key={col.key}>Total</td>);
                                  break;
                                case 'cts':
                                  cells.push(<td key={col.key} className={styles.numCell}>{fmtMoney(totalCost)}</td>);
                                  break;
                                case 'techDepr':
                                  cells.push(<td key={col.key} className={styles.numCell}>{fmtMoney(totalDepr)}</td>);
                                  break;
                                case 'price':
                                  cells.push(<td key={col.key} className={styles.priceCell}>{fmtMoney(totalPrice)}</td>);
                                  break;
                                default:
                                  cells.push(<td key={col.key} />);
                              }
                            });
                            return <tr className={styles.totalsRow}>{cells}</tr>;
                          })()}
                        </tbody>
                      </table>

                      <div className={styles.bottomRow}>
                      <div className={styles.summaryPanel}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                          <h3 className={styles.summaryTitle} style={{ margin: 0 }}>Totals by type</h3>
                          <ColumnsMenu
                            open={summaryMenuOpen}
                            onToggle={() => setSummaryMenuOpen(o => !o)}
                            columns={SUMMARY_COLS}
                            hiddenFn={summaryColHidden}
                            onItemToggle={toggleSummaryColVisible}
                          />
                        </div>
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
                          % · Cost escalator:{' '}
                          <input
                            className={styles.metaInput}
                            type="number"
                            step="0.05"
                            min="0"
                            max="50"
                            value={Math.round(costEscalator * 10000) / 100}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              if (!Number.isFinite(n)) return;
                              setCostEscalator(Math.max(0, Math.min(0.5, n / 100)));
                            }}
                          />
                          % · Tech depr:{' '}
                          <input
                            className={styles.metaInput}
                            type="number"
                            step="0.5"
                            min="0"
                            max="50"
                            value={Math.round(techDeprPct * 1000) / 10}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              if (!Number.isFinite(n)) return;
                              setTechDeprPct(Math.max(0, Math.min(0.5, n / 100)));
                            }}
                          />
                          %
                        </div>
                        {(() => {
                          const cellClassFor = (k) => k === 'bucket' ? '' : (k === 'cost' || k === 'techDepr' || k === 'totalCost') ? styles.numCell : styles.priceCell;
                          const renderHeaders = () => SUMMARY_COLS.filter(c => !summaryColHidden(c.key)).map(col => (
                            <th key={col.key} style={{ width: summaryColWidths[col.key] ?? col.defaultWidth }} className={cellClassFor(col.key)}>
                              <span className={styles.thInner}>
                                <span className={styles.thLabel}>{col.label}</span>
                                <span
                                  className={styles.colResizer}
                                  onMouseDown={(e) => startColResize('summary', col.key, e)}
                                  title="Drag to resize column"
                                />
                              </span>
                            </th>
                          ));
                          const renderRow = (label, vals) => (
                            <tr>
                              {SUMMARY_COLS.filter(c => !summaryColHidden(c.key)).map(col => {
                                if (col.key === 'bucket') return <td key={col.key}>{label}</td>;
                                const v = vals[col.key];
                                return <td key={col.key} className={cellClassFor(col.key)}>{typeof v === 'number' ? fmtMoneyWhole(v) : ''}</td>;
                              })}
                            </tr>
                          );
                          // Year-1 annualized basis for the per-period
                          // columns (Cost / Tech Depr / Total cost /
                          // Marked-up). Setup and One Time hit Y1 in
                          // full; Recurring multiplies the monthly
                          // figure by 12 so the bucket reads as the
                          // year's run-rate instead of a single month.
                          // "Term value (marked-up)" stays projected
                          // over the full term.
                          const recAnnualCost  = recurring.cost  * 12;
                          const recAnnualPrice = recurring.price * 12;
                          const recAnnualDeprCost = recurring.depreciableCost * 12;
                          const summaryY1Cost  = setupOneTime.cost + recAnnualCost;
                          const summaryY1Price = setupOneTime.price + recAnnualPrice;
                          // Tech depreciation excludes pass-through rows
                          // — their cost is billed straight through and
                          // doesn't accrue a depreciation charge.
                          const summaryY1Depr  = (setupOneTime.depreciableCost + recAnnualDeprCost) * techDeprPct;
                          const setupDepr = setup.depreciableCost * techDeprPct;
                          const oneTimeDepr = oneTime.depreciableCost * techDeprPct;
                          const recurringDepr = recurring.depreciableCost * techDeprPct;
                          const recurringAnnualDepr = recAnnualDeprCost * techDeprPct;
                          return (
                            <table className={styles.summaryTable}>
                              <thead><tr>{renderHeaders()}</tr></thead>
                              <tbody>
                                {renderRow('Setup', { cost: setup.cost, techDepr: setupDepr, totalCost: setup.cost + setupDepr, price: setup.price, termPrice: setup.termPrice })}
                                {(oneTime.cost > 0 || oneTime.price > 0) && renderRow('One Time', { cost: oneTime.cost, techDepr: oneTimeDepr, totalCost: oneTime.cost + oneTimeDepr, price: oneTime.price, termPrice: oneTime.termPrice })}
                                {renderRow('Recurring (monthly)', { cost: recurring.cost, techDepr: recurringDepr, totalCost: recurring.cost + recurringDepr, price: recurring.price })}
                                {renderRow('Recurring (annual)', { cost: recAnnualCost, techDepr: recurringAnnualDepr, totalCost: recAnnualCost + recurringAnnualDepr, price: recAnnualPrice, termPrice: recurring.termPrice })}
                                <tr className={styles.summaryGrandRow}>
                                  {SUMMARY_COLS.filter(c => !summaryColHidden(c.key)).map(col => {
                                    if (col.key === 'bucket') return <td key={col.key}>Total contract value</td>;
                                    const map = {
                                      cost: summaryY1Cost,
                                      techDepr: summaryY1Depr,
                                      totalCost: summaryY1Cost + summaryY1Depr,
                                      price: summaryY1Price,
                                      termPrice: grandTermPrice,
                                    };
                                    return <td key={col.key} className={cellClassFor(col.key)}>{fmtMoneyWhole(map[col.key])}</td>;
                                  })}
                                </tr>
                              </tbody>
                            </table>
                          );
                        })()}
                      </div>

                      {(() => {
                        // Year 1 cash-flow check. Revenue: sum
                        // altFeeYearRevenue(row, 1) over this option's
                        // alt-fee rows. Cost: per item, Setup / One
                        // Time hit Y1 in full; Rolled variants also
                        // book the full cost upfront (billing is
                        // amortized but the cost has already been
                        // incurred); Recurring (monthly) charges 12
                        // months of cost in Y1 at face value (escalator
                        // only kicks in from Y2). If revenue − cost is
                        // negative, flag it.
                        const flatItems = opt.sections.flatMap(s => s.items);
                        const y1Cost = flatItems.reduce((acc, i) => {
                          if (typeof i.cts !== 'number') return acc;
                          // Effective cost folds in tech depr for
                          // non-pass-through rows so the warning
                          // matches the Linked CTS cost row in the
                          // Alt Fee summary.
                          const c = ctsItemEffectiveCost(i);
                          if (!c) return acc;
                          const t = effectiveType(i);
                          const isRecurring = /recurring.*monthly|monthly.*recurring|^recurring/i.test(t);
                          if (isRecurring) return acc + c * 12;
                          return acc + c;
                        }, 0);
                        const feeRows = altFees[opt.optionNumber] || [];
                        const y1RevByRow = feeRows.map(r => altFeeYearRevenue(r, 1));
                        const y1Revenue = y1RevByRow.reduce((s, v) => s + v, 0);
                        const y1CashFlow = y1Revenue - y1Cost;

                        // Split Year-1 revenue into what the Setup-fee floor is
                        // allowed to cut and what it has to hold fixed. Only
                        // Setup rows are in scope, and pass-through rows are
                        // held even so: they bill at face cost, so discounting
                        // one spends margin rather than the year's slack.
                        let fixedY1Revenue = 0;
                        const setupRows = [];
                        feeRows.forEach((r, idx) => {
                          const rev = y1RevByRow[idx];
                          if (!isSetupFeeType(r.type) || r.passThrough === true) {
                            fixedY1Revenue += rev;
                            return;
                          }
                          const manualFee = Number(r.fee);
                          const hasManualFee = r.fee != null && r.fee !== ''
                            && Number.isFinite(manualFee) && manualFee >= 0;
                          const fee = hasManualFee ? manualFee : (autoFeePerUnitFor(r) ?? 0);
                          setupRows.push({
                            key: `setup-${idx}`,
                            index: idx,
                            label: String(r.altItem || '').trim() || `Fee row ${idx + 1}`,
                            fee,
                            unitCount: Number(r.unitCount) || 0,
                            y1Revenue: rev,
                            isAuto: !hasManualFee,
                          });
                        });

                        const fmtAbs = (n) => Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        return (
                          <>
                            {y1CashFlow < 0 && (
                              <div className={styles.year1Warning} role="alert">
                                ⚠ Negative cash flow in Year 1: projected revenue {fmtAbs(y1Revenue)} vs cost {fmtAbs(y1Cost)} (shortfall {fmtAbs(y1CashFlow)}). Consider restructuring fees or shifting Setup costs.
                              </div>
                            )}
                            <SetupFeeFloorPanel
                              y1Cost={y1Cost}
                              fixedY1Revenue={fixedY1Revenue}
                              setupRows={setupRows}
                              onApply={(updates) => applySetupFeeFloor(opt.optionNumber, updates)}
                            />
                          </>
                        );
                      })()}

                      {(() => {
                        // Suggestion list for the altItem combobox:
                        // every distinct Linked To tag used by a CTS
                        // row on this option (override or saved default),
                        // plus tags already typed on alt-fee rows.
                        // Free-text entry is still allowed.
                        const seen = new Map();
                        const add = (name) => {
                          const trimmed = (name || '').trim();
                          if (!trimmed) return;
                          const k = trimmed.toLowerCase();
                          if (!seen.has(k)) seen.set(k, trimmed);
                        };
                        for (const sec of opt.sections) {
                          for (const it of sec.items) add(mappingNameFor(it));
                        }
                        for (const r of (altFees[opt.optionNumber] || [])) add(r.altItem);
                        const altItemSuggestions = [...seen.values()].sort((a, b) => a.localeCompare(b));

                        // Linked-CTS cost per year (all of it, plus the
                        // pass-through slice) — shared with the margin
                        // frozen onto an Opp at "Save to Opp" time, so
                        // the table and the snapshot can't disagree.
                        const {
                          numYears: numYearsLocal,
                          costByYear,
                          passThroughByYear,
                          passThroughRevenueByYear,
                        } = optionCostBreakdown(opt);
                        // Fee tags on this option, used below to flag cost
                        // rows that aren't linked to any fee.
                        const altTagSet = new Set(
                          (altFees[opt.optionNumber] || [])
                            .map(r => (r.altItem || '').trim().toLowerCase())
                            .filter(Boolean)
                        );

                        // Cost line items whose Linked To doesn't match any
                        // alt-fee tag in this section — either blank or a
                        // tag with no corresponding fee row. Their cost is
                        // invisible to the Deal-margin / Linked CTS totals
                        // above, so flag them. Aggregate distinct items
                        // (description + type + tag) and sum their face cost.
                        const unlinkedByKey = new Map();
                        for (const sec of opt.sections) {
                          for (const it of sec.items) {
                            const cost = ctsItemEffectiveCost(it);
                            if (!(cost > 0)) continue;
                            const tag = mappingNameFor(it).trim();
                            if (tag && altTagSet.has(tag.toLowerCase())) continue;
                            const type = effectiveType(it);
                            const desc = String(it.description || '').trim() || '(unnamed line item)';
                            const key = `${desc.toLowerCase()}|${type.toLowerCase()}|${tag.toLowerCase()}`;
                            const prev = unlinkedByKey.get(key);
                            if (prev) { prev.cost += cost; }
                            else unlinkedByKey.set(key, { desc, type, tag, cost });
                          }
                        }
                        const unlinkedCostItems = [...unlinkedByKey.values()]
                          .sort((a, b) => b.cost - a.cost);

                        // The rows "Build from Automated Fee Names" would add,
                        // plus how many names the column carries at all — the
                        // button words itself differently for a schedule that's
                        // already complete and one with no names to build from.
                        const buildRows = automatedFeeBuildRows(opt);
                        const automatedNameCount = new Set(
                          opt.sections
                            .flatMap(s => s.items)
                            .map(it => resolvedLinkedTo(it).trim().toLowerCase())
                            .filter(Boolean)
                        ).size;

                        return (
                          <>
                          {unlinkedCostItems.length > 0 && (
                            <div className={styles.unlinkedWarning} role="alert">
                              <strong>
                                ⚠ {unlinkedCostItems.length} cost line item{unlinkedCostItems.length === 1 ? '' : 's'} not linked to any fee in this section
                              </strong>
                              {' '}- their cost isn&apos;t captured in the Deal margin / Linked CTS totals. Set each row&apos;s{' '}
                              {feeMapBy === 'automated' ? 'Automated Fee Name' : 'Fee Name Below'} to a fee from the schedule.
                              <ul>
                                {unlinkedCostItems.map((u, i) => (
                                  <li key={`unlinked-${i}`}>
                                    {u.desc}
                                    {u.type ? ` · ${u.type}` : ''}
                                    {' '}
                                    <span className={styles.unlinkedNote}>
                                      ({u.tag ? <>mapped to &ldquo;<span className={styles.unlinkedTag}>{u.tag}</span>&rdquo;: no matching fee</> : 'no fee name set'}
                                      {`, cost ${fmtMoney(u.cost)}`})
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <AltFeeTable
                            rows={altFees[opt.optionNumber] || altFeeStarter()}
                            globalGmPct={globalGmPct}
                            marginFor={altFeeMarginFor}
                            yearRevenue={altFeeYearRevenue}
                            autoFeeFor={autoFeePerUnitFor}
                            autoStartMonthFor={autoStartMonthFor}
                            siteCount={opt.siteCount}
                            accountCount={opt.accountCount}
                            altItemSuggestions={altItemSuggestions}
                            costByYear={costByYear}
                            passThroughByYear={passThroughByYear}
                            passThroughRevenueByYear={passThroughRevenueByYear}
                            numYears={numYearsLocal}
                            onChange={(idx, field, value) => updateAltFeeCell(opt.optionNumber, idx, field, value)}
                            onAddRow={() => addAltFeeRow(opt.optionNumber)}
                            onMoveRow={(from, to) => moveAltFeeRow(opt.optionNumber, from, to)}
                            onRemoveRow={(idx) => removeAltFeeRow(opt.optionNumber, idx)}
                            onReplaceRows={(rows) => replaceAltFeeRows(opt.optionNumber, rows)}
                            onAppendRows={(rows) => appendAltFeeRows(opt.optionNumber, rows)}
                            onClearRows={() => replaceAltFeeRows(opt.optionNumber, altFeeStarter())}
                            buildRows={buildRows}
                            automatedNameCount={automatedNameCount}
                            onBuildRows={(rows) => appendAltFeeRows(opt.optionNumber, rows)}
                          />
                          </>
                        );
                      })()}
                      </div>

                      {(() => {
                        // Build list of unique tags from this Option:
                        // every alt-fee row's altItem + every linked-to
                        // value (override + saved default) on a CTS row.
                        const seen = new Map(); // canonical key -> displayed name
                        const add = (name) => {
                          const trimmed = (name || '').trim();
                          if (!trimmed) return;
                          const k = trimmed.toLowerCase();
                          if (!seen.has(k)) seen.set(k, trimmed);
                        };
                        for (const r of (altFees[opt.optionNumber] || [])) add(r.altItem);
                        for (const sec of opt.sections) {
                          for (const it of sec.items) add(mappingNameFor(it));
                        }
                        const tagOptions = [...seen.values()].sort((a, b) => a.localeCompare(b));
                        const tag = chartTag && seen.has(chartTag.toLowerCase())
                          ? seen.get(chartTag.toLowerCase())
                          : (tagOptions[0] || '');
                        const numYears = Math.max(1, Math.ceil(termMonths / 12));
                        const years = Array.from({ length: numYears }, (_, i) => i + 1);
                        const target = (tag || '').trim().toLowerCase();
                        const linkedItems = target
                          ? opt.sections.flatMap(s => s.items).filter(i => mappingNameFor(i).trim().toLowerCase() === target)
                          : [];
                        const matchingAltRows = target
                          ? (altFees[opt.optionNumber] || []).filter(r => (r.altItem || '').trim().toLowerCase() === target)
                          : [];
                        // Fee comes from Alternative Fee rows sharing the
                        // tag. When the tag has none (it was only tagged on
                        // CTS rows' Linked To for cost), fall back to the
                        // marked-up-price revenue of those linked CTS rows so
                        // the Fee and Margin still populate. Decide the source
                        // once for the whole line item — never mix alt-fee and
                        // CTS revenue across years — so a one-time alt fee in
                        // Y1 doesn't leak CTS revenue into later years.
                        const altRevenueByYear = years.map(y => matchingAltRows.reduce((s, r) => s + altFeeYearRevenue(r, y), 0));
                        const useAltRevenue = altRevenueByYear.some(v => v > 0);
                        const chartData = years.map((y, i) => {
                          const cost = linkedItems.reduce((s, it) => s + ctsItemYearCost(it, y), 0);
                          const fee = useAltRevenue
                            ? altRevenueByYear[i]
                            : linkedItems.reduce((s, it) => s + ctsItemYearRevenue(it, y), 0);
                          return { year: `Y${y}`, Cost: Math.round(cost), Fee: Math.round(fee) };
                        });
                        // Unit count for the Fee / Unit column. Use the value
                        // the user typed for this line item; if they haven't
                        // typed one, fall back to the total unit count on the
                        // matching Alternative Fee rows so the column is
                        // populated out of the box when that data exists.
                        const storedUnits = chartUnitCounts[target];
                        const typedUnits = Number(storedUnits);
                        const hasTypedUnits = storedUnits != null && storedUnits !== ''
                          && Number.isFinite(typedUnits) && typedUnits > 0;
                        const autoUnits = matchingAltRows.reduce((s, r) => {
                          const uc = Number(r.unitCount);
                          return s + (Number.isFinite(uc) ? uc : 0);
                        }, 0);
                        const unitCount = hasTypedUnits ? typedUnits : autoUnits;
                        const hasUnits = Number.isFinite(unitCount) && unitCount > 0;
                        return (
                          <div className={styles.chartPanel}>
                            <div className={styles.chartHeader}>
                              <h3 className={styles.summaryTitle} style={{ margin: 0 }}>Line item year-over-year</h3>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                {chartVisible && (
                                  <>
                                    <div className={styles.viewToggle}>
                                      <button
                                        type="button"
                                        className={chartView === 'chart' ? styles.viewToggleOn : styles.viewToggleBtn}
                                        onClick={() => setChartView('chart')}
                                      >Chart</button>
                                      <button
                                        type="button"
                                        className={chartView === 'table' ? styles.viewToggleOn : styles.viewToggleBtn}
                                        onClick={() => setChartView('table')}
                                      >Table</button>
                                    </div>
                                    <label className={styles.chartTagLabel}>
                                      Line item:{' '}
                                      <select
                                        className={styles.chartTagSelect}
                                        value={tag}
                                        onChange={(e) => setChartTag(e.target.value)}
                                        disabled={tagOptions.length === 0}
                                      >
                                        {tagOptions.length === 0 && <option value="">(no tagged items yet)</option>}
                                        {tagOptions.map(t => <option key={t} value={t}>{t}</option>)}
                                      </select>
                                    </label>
                                    <label className={styles.chartTagLabel} title="Number of units for this line item. The Fee / Unit column divides each year's fee by this count.">
                                      Units:{' '}
                                      <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        className={styles.chartTagSelect}
                                        style={{ width: '5.5rem' }}
                                        value={target ? (chartUnitCounts[target] ?? '') : ''}
                                        placeholder={autoUnits > 0 ? String(autoUnits) : '-'}
                                        disabled={!target}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          setChartUnitCounts(m => ({ ...m, [target]: v }));
                                        }}
                                      />
                                    </label>
                                  </>
                                )}
                                {/* Same report as the option header's button —
                                    this panel is where the per-line-item
                                    margin questions get asked, so the export
                                    that answers them for every line belongs
                                    here too. */}
                                <button
                                  type="button"
                                  className={styles.viewToggleBtn}
                                  disabled={exportingMargin}
                                  onClick={exportFeeMargin}
                                  title="Export every fee line on this option to Excel: a summary of term revenue, cost and margin per line, plus a per-line breakdown of the cost items behind it and how they mark up across the term."
                                >{exportingMargin ? 'Building…' : 'Fee Margin Excel ⇩'}</button>
                                <button
                                  type="button"
                                  className={styles.viewToggleBtn}
                                  onClick={() => setChartVisible(v => !v)}
                                  title={chartVisible ? 'Hide the line item year-over-year breakdown' : 'Show the line item year-over-year breakdown'}
                                >{chartVisible ? 'Hide' : 'Show'}</button>
                              </div>
                            </div>
                            {chartVisible && (tag ? (
                              chartView === 'table' ? (
                                <table className={styles.summaryTable}>
                                  <thead>
                                    <tr>
                                      <th>Year</th>
                                      <th className={styles.numCell}>Cost</th>
                                      <th className={styles.priceCell}>Fee</th>
                                      <th className={styles.priceCell} title={hasUnits ? `Fee ÷ ${unitCount.toLocaleString('en-US')} units` : 'Enter a unit count above to see fee per unit'}>Fee / Unit</th>
                                      <th className={styles.priceCell}>Margin</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {chartData.map(d => {
                                      const margin = d.Fee > 0 ? ((d.Fee - d.Cost) / d.Fee) : null;
                                      return (
                                        <tr key={d.year}>
                                          <td>{d.year}</td>
                                          <td className={styles.numCell}>{fmtMoney(d.Cost)}</td>
                                          <td className={styles.priceCell}>{fmtMoney(d.Fee)}</td>
                                          <td className={styles.priceCell}>{hasUnits ? fmtMoney(d.Fee / unitCount) : ''}</td>
                                          <td className={styles.priceCell}>{margin === null ? '' : `${(margin * 100).toFixed(1)}%`}</td>
                                        </tr>
                                      );
                                    })}
                                    <tr className={styles.summaryGrandRow}>
                                      <td>Total</td>
                                      <td className={styles.numCell}>{fmtMoney(chartData.reduce((s, d) => s + d.Cost, 0))}</td>
                                      <td className={styles.priceCell}>{fmtMoney(chartData.reduce((s, d) => s + d.Fee, 0))}</td>
                                      <td className={styles.priceCell}>{hasUnits ? fmtMoney(chartData.reduce((s, d) => s + d.Fee, 0) / unitCount) : ''}</td>
                                      <td className={styles.priceCell}>{(() => {
                                        const tc = chartData.reduce((s, d) => s + d.Cost, 0);
                                        const tf = chartData.reduce((s, d) => s + d.Fee, 0);
                                        return tf > 0 ? `${(((tf - tc) / tf) * 100).toFixed(1)}%` : '';
                                      })()}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              ) : (
                                <div style={{ width: '100%', height: 280 }}>
                                  <ResponsiveContainer>
                                    <BarChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 4 }}>
                                      <CartesianGrid strokeDasharray="3 3" />
                                      <XAxis dataKey="year" />
                                      <YAxis tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
                                      <Tooltip formatter={(v) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
                                      <Legend />
                                      <Bar dataKey="Cost" fill="#ef4444" />
                                      <Bar dataKey="Fee" fill="#2563eb" />
                                    </BarChart>
                                  </ResponsiveContainer>
                                </div>
                              )
                            ) : (
                              <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', padding: '1rem 0' }}>
                                Tag at least one CTS row's <strong>Linked To</strong> column or fill in the <strong>Alternative Fee Structure / Schedule</strong> with an item name to populate this chart.
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}
              </div>
            </>
          );
        })()}
      </div>

      {pricingPickerOpen && (() => {
        const opt = workbook?.options.find(o => o.optionNumber === activeOption) || workbook?.options[0];
        const label = (opt?.sheetName || '').trim();
        return (
          <OppPickerModal
            opps={opps2Records}
            optionName={label}
            onPick={async (oppId) => {
              // Convert the workbook's Alt-Fee rows for this option to
              // the OptionsTab row shape and resolve any auto-computed
              // fees to concrete numbers, so `buildPricingOptionSnapshot`
              // produces a self-contained snapshot that survives a
              // Pricing-tab Clear (or a workbook re-upload).
              const altRowsForOpt = opt ? (altFees[opt.optionNumber] || []) : [];
              const rows = altRowsForOpt.map(r => {
                const manualFee = Number(r.fee);
                const hasManualFee = r.fee != null && r.fee !== ''
                  && Number.isFinite(manualFee) && manualFee >= 0;
                const resolvedFee = hasManualFee ? manualFee : (autoFeePerUnitFor(r) ?? 0);
                const manualSm = Number(r.startMonth);
                const hasManualSm = r.startMonth != null && r.startMonth !== ''
                  && Number.isFinite(manualSm) && manualSm > 0;
                const resolvedSm = hasManualSm ? manualSm : (autoStartMonthFor(r) || 1);
                return {
                  feeSchedule: r.altItem || '',
                  type: r.type || '',
                  fee: resolvedFee,
                  unit: r.unit || '',
                  unitCount: r.unitCount,
                  startMonth: resolvedSm,
                };
              });
              // Deal margin for this option, frozen in alongside the
              // fees: the Opp view has no cost side of its own, so
              // without this the saved option shows what the customer
              // pays and nothing about what the deal earns.
              const margin = dealMarginForOption(opt);
              const snapshot = buildPricingOptionSnapshot({
                name: label,
                years: Math.max(1, Math.round((termMonths || 12) / 12)),
                escPct: (Number(annualEscalator) || 0) * 100,
                services: (opt && pricingOptionServices) ? (pricingOptionServices[opt.sheetName] || []) : [],
                rows,
                marginByYear: margin.marginByYear,
                finalMargin: margin.finalMargin,
                termRevenue: margin.termRevenue,
                termCost: margin.termCost,
              });
              // Attach a copy of the uploaded SIA workbook to this opp
              // so the Opps 2 popup can offer a download later — even
              // after the Pricing tab has been cleared or a different
              // workbook loaded. Metadata (fileName, size) rides on the
              // snapshot; the bytes live in their own IDB store keyed
              // by oppId.
              const sourceBlob = workbookSourceRef.current;
              const sourceName = workbook?.fileName || 'workbook.xlsx';
              if (sourceBlob) {
                snapshot.sourceFile = sourceFileMeta(sourceName, sourceBlob);
              }
              try {
                // Await both writes so the picker doesn't close before
                // Firestore has the snapshot — otherwise Opps 2's next
                // hydration can overwrite our IDB write with a pre-write
                // Firestore copy and the user sees only the link.
                await setOppOptionLink(oppId, label, {
                  source: 'pricing',
                  workbookId: workbook?.id,
                });
                await setOppPricingSnapshot(user?.uid, oppId, snapshot);
                if (sourceBlob) {
                  // Best-effort source-file copy. Failure here doesn't
                  // invalidate the snapshot — the user just won't see a
                  // Download button on the opp until they re-save.
                  try { await saveOppSourceFile(oppId, sourceBlob, sourceName); }
                  catch (err) { console.warn('Save source file failed:', err); }
                }
                setPricingPickerOpen(false);
              } catch (err) {
                console.error('Save to Opp (Pricing): snapshot save failed', { err, uid: user?.uid, oppId });
                const denied = err?.code === 'permission-denied'
                  || /insufficient permissions/i.test(err?.message || '');
                window.alert(
                  'Saved the link, but the Pricing snapshot failed to save to Firestore. ' +
                  'Year 1 fees and the saved details may not appear on the Opp.\n\n' +
                  (denied
                    ? 'Firestore denied the write (permission error): this is a security-rules issue, not your network. '
                      + 'The deployed rules need to allow the opps2Data document for your account.'
                    : 'Check your network and try again.') +
                  '\n\n' +
                  (err?.message || String(err))
                );
              }
            }}
            onClose={() => setPricingPickerOpen(false)}
          />
        );
      })()}

      {linkedToOptionsModal && (
        <LinkedToOptionsModal
          autoTags={linkedToOptionsModal.autoTags}
          optionsList={linkedToOptionsList}
          onAdd={addLinkedToOption}
          onRemove={removeLinkedToOption}
          onClose={() => setLinkedToOptionsModal(null)}
        />
      )}
    </div>
  );
}
