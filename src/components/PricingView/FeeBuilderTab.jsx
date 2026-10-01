import { Fragment, useEffect, useRef, useState } from 'react';
import { sanitizeExcelWorkbook } from '../../utils/exportSanitize';
import styles from './ServicesTab.module.css';
import own from './FeeBuilderTab.module.css';
import { serviceKey, groupFeeRows, costsByKind } from '../../utils/pricingServices';
import { addFeeSummarySheet, addFeeComparisonSheet } from '../../utils/feeSummarySheets';
import { FEE_BUILDER_COLUMNS, isServiceDone, setServiceDone, toggleHiddenColumn } from '../../utils/feeBuilderChecklist';
import { savedSummary } from '../../utils/feeBuilderSaved';
import { feeCopyTsv, feeCopyHtml } from '../../utils/feeBuilderCopy';
import { writeRichCopy } from '../../utils/clipboardCopy';

// The Columns menu over the service table: a checkbox per column that can be
// hidden. Closes on a click anywhere outside it.
function ColumnsMenu({ hidden, onToggle, onShowAll }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const shown = FEE_BUILDER_COLUMNS.filter(c => !hidden.includes(c.key)).length;
  return (
    <div className={own.colMenuWrap} ref={ref}>
      <button type="button" className={own.smallBtn} onClick={() => setOpen(o => !o)}>
        Columns ({shown + 1}/{FEE_BUILDER_COLUMNS.length + 1})
      </button>
      {open && (
        <div className={own.colMenu}>
          <label className={own.colMenuItem} title="The service names the row, so it always shows">
            <input type="checkbox" checked disabled /> Service
          </label>
          {FEE_BUILDER_COLUMNS.map(c => (
            <label key={c.key} className={own.colMenuItem}>
              <input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => onToggle(c.key)} />
              {c.label}
            </label>
          ))}
          {hidden.length > 0 && (
            <button type="button" className={own.colMenuReset} onClick={onShowAll}>Show all columns</button>
          )}
        </div>
      )}
    </div>
  );
}

const fmtMoney = (n) => (typeof n === 'number' && Number.isFinite(n)
  ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : '');
const fmtPct = (n) => (typeof n === 'number' && Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '');
const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);
// The From cell for a fee line: every service the fee covers, comma
// separated. A fee several services wrote lists all of them, those whose
// row was left off for having no fee of its own included, since the one
// row that stays bills their costs too.
const feeKey = (name) => String(name || '').trim().toLowerCase();
function coveredByFee(shared) {
  const m = new Map();
  for (const c of shared || []) m.set(feeKey(c.fee), [...c.services, ...(c.unpriced || [])]);
  return m;
}
function fromLabel(g, covered) {
  const names = [];
  const add = (n) => { if (n && !names.includes(n)) names.push(n); };
  for (const r of g.subRows.length ? g.subRows : [g.row]) add(r.service);
  for (const n of covered.get(feeKey(g.row.name)) || []) add(n);
  const onSchedule = (g.subRows.length ? g.subRows : [g.row]).some(r => !r.service);
  if (onSchedule) add('On the schedule');
  return names.join(', ');
}

// A Fee / Unit that can be typed over. Holds what is typed until it is left
// (or Enter), then hands the number up; a cleared box puts the built fee back.
function FeeCell({ value, overridden, builtFee, onCommit, label }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '');
  const commit = () => {
    if (draft == null) return;
    const t = draft.replace(/[$,\s]/g, '');
    setDraft(null);
    if (t === '') { onCommit(null); return; }
    const n = Number(t);
    if (Number.isFinite(n) && n >= 0) onCommit(Math.round(n * 10000) / 10000);
  };
  return (
    <div className={own.feeCell}>
      <input
        className={`${own.feeInput} ${overridden ? own.feeInputTyped : ''}`}
        inputMode="decimal"
        value={shown}
        aria-label={`Fee per unit for ${label}`}
        title={overridden
          ? `Typed over${typeof builtFee === 'number' ? `, built at ${fmtMoney(builtFee)}` : ''}. Clear it to put the built fee back.`
          : 'Type a fee per unit to override the built one. The years, margin and totals follow it.'}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
        }}
      />
      {overridden && (
        <button type="button" className={own.resetBtn} onClick={() => onCommit(null)} title={`Put the built fee back${typeof builtFee === 'number' ? ` (${fmtMoney(builtFee)})` : ''}`}>
          ↺
        </button>
      )}
    </div>
  );
}

// A Unit Count that can be typed over, the same way as FeeCell: the fee per
// unit stays and bills on the new count. A cleared box puts the built count
// back.
function UnitCountCell({ value, overridden, builtCount, onCommit, label }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? (value ?? '');
  const commit = () => {
    if (draft == null) return;
    const t = draft.replace(/[,\s]/g, '');
    setDraft(null);
    if (t === '') { onCommit(null); return; }
    const n = Number(t);
    if (Number.isFinite(n) && n > 0) onCommit(n);
  };
  const built = builtCount != null && builtCount !== '' ? builtCount : null;
  return (
    <div className={own.feeCell}>
      <input
        className={`${own.feeInput} ${overridden ? own.feeInputTyped : ''}`}
        inputMode="decimal"
        value={shown}
        aria-label={`Unit count for ${label}`}
        title={overridden
          ? `Typed over${built != null ? `, built at ${built}` : ''}. Clear it to put the built count back.`
          : 'Type a unit count to override the built one. The fee per unit stays; the years, margin and totals follow it.'}
        onChange={(e) => {
          setDraft(e.target.value);
          // Live: a whole number typed so far bills straight away.
          const n = Number(e.target.value.replace(/[,\s]/g, ''));
          if (e.target.value.trim() !== '' && Number.isFinite(n) && n > 0) onCommit(n);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
        }}
      />
      {overridden && (
        <button type="button" className={own.resetBtn} onClick={() => { setDraft(null); onCommit(null); }} title={`Put the built count back${built != null ? ` (${built})` : ''}`}>
          ↺
        </button>
      )}
    </div>
  );
}

// The as-built schedule as a workbook: a fee several services share is one
// line with a grouped (collapsible) sub-row per service under it, then the
// total and the option's totals now and as built. Group lines and totals
// are styled apart from the rows under them so they read as totals.
async function exportPlan(plan) {
  const { Workbook } = await import('exceljs');
  const numYears = plan.numYears || 1;
  const yearIdx = Array.from({ length: numYears }, (_, i) => i);
  const money = (n) => (typeof n === 'number' && Number.isFinite(n) && n !== 0 ? Math.round(n * 100) / 100 : null);
  const pct = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
  const MONEY = '$#,##0.00';
  const PCT = '0.0%';
  const thin = { style: 'thin', color: { argb: 'FFCBD5E1' } };
  const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

  const wb = new Workbook();
  const sub = `${plan.optionName || 'Option'}  ·  as built by the Fee Builder`;
  // Fee Summary reads the way a client would: lines with the same name and
  // structure are one fee. The As built sheet below keeps every line.
  addFeeSummarySheet(wb, { rows: plan.rows, subtitle: `${sub}  ·  like fees combined`, condense: true });
  const ws = wb.addWorksheet('As built', { properties: { outlineProperties: { summaryBelow: false } } });
  const headers = ['Fee', 'From', 'Type', 'Fee / Unit', 'Unit', 'Unit Count', 'Start Month', ...yearIdx.map(i => `Y${i + 1}`), 'Term', 'Margin'];
  const moneyCols = [4, ...yearIdx.map(i => 8 + i), 8 + numYears];
  const marginCol = 9 + numYears;
  ws.columns = [30, 34, 20, 12, 12, 11, 11, ...yearIdx.map(() => 14), 14, 10].map(width => ({ width }));

  const head = ws.addRow(headers);
  head.eachCell(c => { c.font = { bold: true }; c.fill = fill('FFF1F5F9'); c.border = { bottom: thin }; });
  const formats = (row) => {
    for (const c of moneyCols) row.getCell(c).numFmt = MONEY;
    row.getCell(marginCol).numFmt = PCT;
  };
  const line = (r, name, from) => ws.addRow([
    name, from, r.type || '', typeof r.feePerUnit === 'number' ? r.feePerUnit : null, r.unit || '',
    r.unitCount ?? null, r.startMonth ?? null, ...yearIdx.map(i => money(r.years?.[i])), money(r.term), pct(r.margin),
  ]);

  const covered = coveredByFee(plan.shared);
  for (const g of groupFeeRows(plan.rows)) {
    const top = line(g.row, g.row.name, fromLabel(g, covered));
    formats(top);
    if (g.subRows.length) {
      top.eachCell({ includeEmpty: true }, c => { c.font = { bold: true }; c.fill = fill('FFEEF2FF'); });
    }
    for (const sr of g.subRows) {
      const sub = line(sr, sr.name, sr.service || 'On the schedule');
      formats(sub);
      sub.outlineLevel = 1;
      sub.getCell(1).alignment = { indent: 2 };
      sub.getCell(1).font = { color: { argb: 'FF64748B' } };
    }
  }
  // Pass-through rows bill at cost, so they sit out of the margin.
  const marginRows = plan.rows.filter(r => !r.passThrough);
  const termAll = sum(marginRows.map(r => r.term));
  const costAll = sum(marginRows.map(r => r.cost));
  const total = ws.addRow(['Total', '', '', null, '', null, null, ...yearIdx.map(i => money(plan.after.feeByYear[i])),
    money(sum(plan.after.feeByYear)), termAll > 0 ? (termAll - costAll) / termAll : null]);
  formats(total);
  total.eachCell({ includeEmpty: true }, c => {
    c.font = { bold: true };
    c.fill = fill('FFE2E8F0');
    c.border = { top: thin, bottom: { style: 'double', color: { argb: 'FF64748B' } } };
  });

  ws.addRow([]);
  const th = ws.addRow([`${plan.optionName} totals`, ...yearIdx.map(i => `Y${i + 1} fees`), 'Term fees', 'Term cost', 'Deal margin']);
  th.eachCell(c => { c.font = { bold: true }; c.fill = fill('FFF1F5F9'); c.border = { bottom: thin }; });
  for (const [label, t] of [['Now on the schedule', plan.before], ['As built', plan.after]]) {
    const r = ws.addRow([label, ...yearIdx.map(i => money(t.feeByYear[i])), money(sum(t.feeByYear)), money(sum(t.costByYear)),
      t.margin?.finalMargin != null ? t.margin.finalMargin : null]);
    for (let c = 2; c <= numYears + 3; c++) r.getCell(c).numFmt = MONEY;
    r.getCell(numYears + 4).numFmt = PCT;
    if (label === 'As built') r.eachCell(c => { c.font = { bold: true }; });
  }

  addFeeComparisonSheet(wb, {
    costLines: plan.costLines || [],
    pricing: { rows: plan.beforeRows || [], totals: plan.before },
    builder: { rows: plan.rows, totals: plan.after },
    numYears,
    subtitle: sub,
  });

  sanitizeExcelWorkbook(wb);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fee-schedule-${String(plan.optionName || 'option').replace(/[^\w.-]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function fmtSavedAt(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// The Saved settings bar: saves the picks, typed fees and done ticks for the
// deal this SIA is for, and loads them back. Uploading the same deal's SIA
// again loads them on its own; the note says so. Load saved... opens the
// list of every deal saved.
function SavedSettingsBar({ saved: s }) {
  const [flash, setFlash] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const say = (msg) => { setFlash(msg); window.setTimeout(() => setFlash(''), 4000); };
  const missingNote = (missing) => (missing?.length
    ? ` ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not on this SIA, so ${missing.length === 1 ? 'its' : 'their'} settings were left off.`
    : '');
  return (
    <div className={own.savedBar}>
      <div className={own.bar}>
        <strong>Saved settings for {s.dealLabel}</strong>
        <span className={own.muted}>
          {s.saved ? `Saved ${fmtSavedAt(s.saved.savedAt)}` : 'Not saved yet'}
        </span>
        <span className={styles.barSpacer} />
        <button
          type="button"
          className={own.smallBtn}
          title={`Save the fee structure picks, typed fees and done ticks for ${s.dealLabel}. Uploading this deal's SIA again brings them back.`}
          onClick={() => {
            if (s.saved && !window.confirm(`Replace the settings saved for ${s.dealLabel} on ${fmtSavedAt(s.saved.savedAt)}?`)) return;
            if (s.onSave()) say(`Saved the Fee Builder settings for ${s.dealLabel}.`);
          }}
        >
          {s.saved ? 'Update saved settings' : 'Save settings'}
        </button>
        <button
          type="button"
          className={own.smallBtn}
          disabled={s.all.length === 0}
          title={s.all.length ? 'Pick from every deal with saved settings' : 'Nothing saved yet'}
          onClick={() => setListOpen(true)}
        >
          Load saved...
        </button>
      </div>
      {s.restored && !flash && (
        <div className={own.muted}>
          Loaded the settings saved for {s.restored.label} on {fmtSavedAt(s.restored.savedAt)} with this SIA.{missingNote(s.restored.missing)}
        </div>
      )}
      {flash && <div className={styles.flash}>{flash}</div>}
      {listOpen && (
        <SavedListModal
          entries={s.all}
          currentKey={s.saved?.key || s.dealKey}
          onClose={() => setListOpen(false)}
          onLoad={(entry) => {
            if (!window.confirm(`Load the settings saved for ${entry.label} onto this SIA? The picks and typed fees on screen are replaced.`)) return;
            const r = s.onLoad(entry.key);
            setListOpen(false);
            if (r) say(`Loaded the settings saved for ${entry.label}.${missingNote(r.missing)}`);
          }}
          onDelete={(entry) => {
            if (!window.confirm(`Delete the settings saved for ${entry.label}?`)) return;
            s.onDelete(entry.key);
          }}
        />
      )}
    </div>
  );
}

// The popup behind Load saved...: every deal with saved Fee Builder
// settings, this SIA's deal first, with a search over the deal and file.
function SavedListModal({ entries, currentKey, onClose, onLoad, onDelete }) {
  const [query, setQuery] = useState('');
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const q = query.trim().toLowerCase();
  const list = entries
    .filter(e => !q || `${e.label} ${e.fileName || ''}`.toLowerCase().includes(q))
    .sort((a, b) => (b.key === currentKey) - (a.key === currentKey));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return (
    <div className={own.modalOverlay} onMouseDown={onClose}>
      <div
        className={own.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Saved Fee Builder settings"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={own.modalHead}>
          <h3 className={own.modalTitle}>Saved Fee Builder settings</h3>
          <button type="button" className={own.modalClose} onClick={onClose} aria-label="Close">×</button>
        </div>
        <input
          autoFocus
          type="text"
          className={own.modalSearch}
          placeholder="Search by deal or file name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className={own.modalList}>
          {list.length === 0 ? (
            <div className={own.modalEmpty}>{entries.length ? 'No matches.' : 'Nothing saved yet.'}</div>
          ) : list.map(e => {
            const sum = savedSummary(e);
            return (
              <div key={e.key} className={own.modalItem}>
                <div className={own.modalItemText}>
                  <div>
                    <strong>{e.label}</strong>
                    {e.key === currentKey && <span className={own.thisDeal}>This SIA</span>}
                  </div>
                  <div className={own.muted}>
                    Saved {fmtSavedAt(e.savedAt)}{e.fileName ? `, from ${e.fileName}` : ''}
                  </div>
                  <div className={own.muted}>
                    {sum.sheets.length
                      ? `${sum.sheets.join(', ')}: ${plural(sum.picks, 'pick')}, ${plural(sum.typed, 'typed fee')}, ${sum.done} done`
                      : 'Every service on its standard structure'}
                  </div>
                </div>
                <button type="button" className={own.smallBtn} onClick={() => onLoad(e)}>Load</button>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => onDelete(e)}
                  title={`Delete the settings saved for ${e.label}. What is on screen stays.`}
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Fee Builder subtab: one row per service in SIA scope (and any other
// service that has saved fee structures), each with a pick of the fee
// structures saved for it on the Services subtab. The picks together
// rebuild the option's Alternative Fee schedule: a preview first, then one
// Build button writes it.
//
//   setPicks      (optionNumber, updater) updates that option's
//                 { [serviceKey]: structureId | '' }, '' = leave as is,
//                 absent = the service's standard structure when in scope
//   planFor       () => the services, their picks, the rebuilt schedule and
//                 the option's totals for the active option
//   onCopyPicks   (fromOption, toOption) gives toOption the same picks as
//                 fromOption, replacing its own
//   onApply       (plan) => writes it, true when it did
//   oppLink       the Opps row the active option is saved to, the same link
//                 as the Pricing subtab's "Save to Opp…":
//                 { optionName, label (null when unlinked), onSave, onUnlink }
//   savedSettings the settings saved for this SIA's deal (see
//                 feeBuilderSaved.js): { dealKey, dealLabel, saved,
//                 restored, all (every deal saved), onSave, onLoad(key),
//                 onDelete(key) }, null with no deal
export function FeeBuilderTab({
  workbook, activeOption, setActiveOption, setPicks, planFor, onCopyPicks, onApply, onOpenServices, setFeeOverrides,
  hiddenColumns, setHiddenColumns, doneState, setDoneState, oppLink = null, savedSettings = null,
}) {
  const [showAll, setShowAll] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const [flash, setFlash] = useState('');
  const [copyFlash, setCopyFlash] = useState('');
  // Fee rows ticked in the as-built table for Copy selected, by row id.
  // Kept per option so switching options starts with nothing ticked.
  const [picked, setPicked] = useState({ option: null, ids: {}, last: null });
  const [rowCopyFlash, setRowCopyFlash] = useState('');
  const opt = workbook?.options?.find(o => o.optionNumber === activeOption) || workbook?.options?.[0] || null;

  if (!workbook) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.intro}>
          Pick a fee structure for each service and the Alternative Fee schedule is built from them.
          Upload an SIA on the <strong>Pricing</strong> subtab to start.
        </p>
      </div>
    );
  }

  const plan = planFor ? planFor() : null;
  const rows = plan?.services || [];
  const listed = rows.filter(r => r.inScope || showAll);
  const hiddenCount = rows.length - listed.length;
  const noStructures = listed.filter(r => r.inScope && r.structures.length === 0).length;
  // Picks are kept per option, so each option's fee structures stay put
  // while another is being worked on.
  const optionNumber = plan?.optionNumber ?? opt?.optionNumber;
  const setPick = (name, id) => setPicks?.(optionNumber, prev => ({ ...prev, [serviceKey(name)]: id }));
  const setAll = (mode) => setPicks?.(optionNumber, () => {
    const next = {};
    for (const r of rows) {
      if (mode === 'none') next[serviceKey(r.name)] = '';
    }
    return next;
  });
  // Columns the user has hidden, and the per-service "done" ticks for this
  // SIA and option (see feeBuilderChecklist.js).
  const hidden = Array.isArray(hiddenColumns) ? hiddenColumns : [];
  const showCol = (key) => !hidden.includes(key);
  const isDone = (name) => isServiceDone(doneState, workbook.id, optionNumber, name);
  const setDone = (name, on) => setDoneState?.(prev => setServiceDone(prev, workbook.id, optionNumber, name, on));
  const doneCount = listed.filter(r => isDone(r.name)).length;
  const numYears = plan?.numYears || 1;
  const yearIdx = Array.from({ length: numYears }, (_, i) => i);
  const building = plan?.perService?.length || 0;
  const covered = coveredByFee(plan?.shared);
  const typedCount = (plan?.rows || []).filter(r => r.overridden || r.unitsOverridden).length;
  const canType = !!setFeeOverrides && !!plan;
  // One row's fee typed over, or put back (null).
  const setFee = (updates) => setFeeOverrides?.(plan.optionNumber, prev => {
    const next = { ...prev };
    for (const [k, v] of updates) { if (v == null) delete next[k]; else next[k] = v; }
    return next;
  });
  // A fee grouped from several rows: the typed total is shared across them
  // in the proportion they had, or evenly when they came to nothing.
  const setGroupFee = (subRows, total) => {
    if (total == null) { setFee(subRows.map(r => [r.key, null])); return; }
    const was = sum(subRows.map(r => r.feePerUnit));
    setFee(subRows.map(r => [r.key, was > 0 ? (Number(r.feePerUnit) || 0) * (total / was) : total / subRows.length]));
  };

  // The as-built rows that can be ticked for Copy selected, in table order:
  // each fee line, then the rows grouped under it while they are shown.
  const feeGroups = plan ? groupFeeRows(plan.rows) : [];
  const tickable = [];
  feeGroups.forEach((g, gi) => {
    const key = String(g.row.name || '').trim().toLowerCase();
    tickable.push({ id: `${key}-${gi}`, row: g.row });
    if (g.subRows.length && !collapsed[key]) g.subRows.forEach((r, si) => tickable.push({ id: `${key}-${gi}-${si}`, row: r }));
  });
  const pickedIds = picked.option === optionNumber ? picked.ids : {};
  const pickedRows = tickable.filter(t => pickedIds[t.id]);
  const allPicked = tickable.length > 0 && pickedRows.length === tickable.length;
  // A shift-click ticks (or unticks) every row between it and the last one clicked.
  const togglePick = (id, shift) => setPicked(prev => {
    const ids = { ...(prev.option === optionNumber ? prev.ids : {}) };
    const on = !ids[id];
    const at = tickable.findIndex(t => t.id === id);
    const from = shift && prev.option === optionNumber ? tickable.findIndex(t => t.id === prev.last) : -1;
    const span = from >= 0 ? tickable.slice(Math.min(from, at), Math.max(from, at) + 1) : [{ id }];
    for (const t of span) { if (on) ids[t.id] = true; else delete ids[t.id]; }
    return { option: optionNumber, ids, last: id };
  });
  const pickAll = (on) => setPicked({
    option: optionNumber,
    ids: on ? Object.fromEntries(tickable.map(t => [t.id, true])) : {},
    last: null,
  });
  const copyPicked = async () => {
    const list = pickedRows.map(t => t.row);
    const ok = await writeRichCopy(feeCopyTsv(list), feeCopyHtml(list));
    setRowCopyFlash(ok
      ? `Copied ${list.length} fee row${list.length === 1 ? '' : 's'} with headers. Paste into Excel.`
      : 'Copy failed: the browser blocked the clipboard.');
    window.setTimeout(() => setRowCopyFlash(''), 3000);
  };
  const pickCell = (id, label) => (
    <td className={own.pickCol}>
      <input
        type="checkbox"
        checked={!!pickedIds[id]}
        onChange={() => {}}
        onClick={(e) => togglePick(id, e.shiftKey)}
        aria-label={`Select ${label} to copy`}
        title="Select this row to copy. Shift-click selects every row between."
      />
    </td>
  );

  return (
    <div className={styles.wrapper}>
      <p className={styles.intro}>
        Pick a fee structure for each service and the Alternative Fee schedule on the option is built from them.
        Each service starts on its <span className={styles.star}>★</span> standard structure. Blank fees are filled
        with the standard fee from the service&apos;s costs, the same as <strong>Apply to Option</strong> on the
        Services subtab. Fee structures are set up per service on the <strong>Services</strong> subtab.
      </p>

      {(workbook.options.length > 1 || oppLink) && (
        <div className={own.optionRow}>
          {workbook.options.length > 1 && (
            <div className={styles.optionStrip}>
              {workbook.options.map(o => (
                <button
                  key={o.sheetName}
                  type="button"
                  className={o.optionNumber === opt?.optionNumber ? styles.optionActive : styles.option}
                  onClick={() => setActiveOption(o.optionNumber)}
                >
                  {o.sheetName}
                </button>
              ))}
            </div>
          )}
          {oppLink && (
            oppLink.label ? (
              <span className={own.oppChip} title={`${oppLink.optionName} is saved to the Opps row ${oppLink.label}`}>
                {oppLink.optionName} saved to: {oppLink.label}
                <button
                  type="button"
                  className={own.oppChipClear}
                  onClick={oppLink.onUnlink}
                  title="Unlink from this Opp"
                  aria-label="Unlink from this Opp"
                >×</button>
              </span>
            ) : (
              <button
                type="button"
                className={own.smallBtn}
                onClick={oppLink.onSave}
                title={`Save "${oppLink.optionName}" to an Opps row: links it and saves its fees, margin and the SIA file onto the opp.`}
              >
                Save {oppLink.optionName} to Opp…
              </button>
            )
          )}
        </div>
      )}

      {savedSettings && <SavedSettingsBar key={workbook.id} saved={savedSettings} />}

      <section className={styles.section}>
        <div className={own.bar}>
          <h4 className={styles.sectionTitle}>Fee structure by service</h4>
          {listed.length > 0 && (
            <span className={own.doneCount}>{doneCount} of {listed.length} done</span>
          )}
          <span className={styles.barSpacer} />
          {setHiddenColumns && (
            <ColumnsMenu
              hidden={hidden}
              onToggle={(key) => setHiddenColumns(prev => toggleHiddenColumn(prev, key))}
              onShowAll={() => setHiddenColumns([])}
            />
          )}
          {onCopyPicks && workbook.options.length > 1 && (
            <select
              className={own.copySelect}
              value=""
              aria-label="Copy the fee structures from another option"
              title={`Pick the same fee structure for every service as another option does. ${plan?.optionName || 'This option'}'s own picks are replaced.`}
              onChange={(e) => {
                const from = workbook.options.find(o => String(o.optionNumber) === e.target.value);
                if (!from) return;
                const to = plan?.optionName || opt?.sheetName || 'this option';
                if (!window.confirm(`Copy the fee structure picks from ${from.sheetName} to ${to}? The picks on ${to} are replaced.`)) return;
                onCopyPicks(from.optionNumber, optionNumber);
                setCopyFlash(`Copied the fee structure picks from ${from.sheetName} to ${to}.`);
                window.setTimeout(() => setCopyFlash(''), 4000);
              }}
            >
              <option value="">Copy from option...</option>
              {workbook.options.filter(o => o.optionNumber !== optionNumber).map(o => (
                <option key={o.sheetName} value={String(o.optionNumber)}>{o.sheetName}</option>
              ))}
            </select>
          )}
          <button type="button" className={own.smallBtn} onClick={() => setAll('standard')}>Use standard for all</button>
          <button type="button" className={own.smallBtn} onClick={() => setAll('none')}>No fees for all</button>
          <label className={own.toggle}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show services outside SIA scope{hiddenCount > 0 && !showAll ? ` (${hiddenCount})` : ''}
          </label>
        </div>
        {copyFlash && <div className={styles.flash}>{copyFlash}</div>}
        {listed.length === 0 ? (
          <p className={styles.note}>
            No services in SIA scope on {plan?.optionName || 'this option'}. Tie cost lines to services on the <strong>Linked To</strong> subtab.
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                {setDoneState && <th className={own.doneCol} title="Tick a service off once its fees are sorted">Done</th>}
                <th>Service</th>
                {showCol('costLines') && <th className={styles.num}>Cost lines</th>}
                {showCol('cts') && <th className={styles.num}>CTS</th>}
                {showCol('current') && <th>On the schedule now</th>}
                {showCol('structure') && <th>Fee structure</th>}
                {showCol('writes') && <th>Fees it writes</th>}
              </tr>
            </thead>
            <tbody>
              {listed.map(r => {
                const built = plan.perService.find(p => p.service === r.name);
                const done = isDone(r.name);
                return (
                  <tr key={r.name} className={done ? own.doneRow : undefined}>
                    {setDoneState && (
                      <td className={own.doneCol}>
                        <input
                          type="checkbox"
                          checked={done}
                          onChange={(e) => setDone(r.name, e.target.checked)}
                          aria-label={`Mark ${r.name} done`}
                          title={done ? 'Done. Untick to mark it as still to do.' : 'Mark this service done'}
                        />
                      </td>
                    )}
                    <td>
                      <div>{r.name}</div>
                      <div className={styles.subNote}>
                        {r.inScope ? <span className={styles.scopeTag}>In SIA scope</span> : 'Not in SIA scope'}
                        {r.bucket ? ` ${r.bucket}` : ''}
                      </div>
                    </td>
                    {showCol('costLines') && <td className={styles.num}>{r.costCount || ''}</td>}
                    {showCol('cts') && <td className={styles.num}>{r.costCts ? fmtMoney(r.costCts) : ''}</td>}
                    {showCol('current') && <td className={own.muted}>{r.currentFees.length ? r.currentFees.join(', ') : 'Nothing'}</td>}
                    {showCol('structure') && <td>
                      {!r.inScope ? (
                        <span className={own.muted} title="Only services with cost lines on this option build fees">
                          No cost lines on this option, so no fees
                        </span>
                      ) : r.structures.length === 0 ? (
                        <button type="button" className={styles.linkBtn} onClick={onOpenServices}>
                          No saved structures, set one up
                        </button>
                      ) : (
                        <select
                          className={own.select}
                          value={r.pickedId}
                          onChange={(e) => setPick(r.name, e.target.value)}
                        >
                          <option value="">No fees</option>
                          {r.structures.map(st => (
                            <option key={st.id} value={st.id}>
                              {st.id === r.standardId ? '★ ' : ''}{st.name || 'Untitled'}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>}
                    {showCol('writes') && <td>
                      {built ? (
                        <>
                          {built.added.map(a => a.altItem).join(', ') || <span className={own.muted}>No named fees</span>}
                          {built.removed.length > 0 && (
                            <div className={styles.subNote}>Replaces {built.removed.map(x => x.altItem).join(', ')}</div>
                          )}
                        </>
                      ) : <span className={own.muted}>No fees</span>}
                    </td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {noStructures > 0 && (
          <p className={styles.note}>
            {noStructures} service{noStructures === 1 ? ' has' : 's have'} no saved fee structure yet, so {noStructures === 1 ? 'it adds' : 'they add'} no
            fees. Save one from the SIA setup on the Services subtab.
          </p>
        )}
      </section>

      {plan && (
        <section className={styles.section}>
          <div className={own.bar}>
            <h4 className={styles.sectionTitle}>Alternative Fee schedule on {plan.optionName}, as built</h4>
            <span className={styles.barSpacer} />
            <button
              type="button"
              className={own.smallBtn}
              disabled={pickedRows.length === 0}
              onClick={copyPicked}
              title="Copy the selected rows (Fee line item, Type, Fee, Unit, Units, Start Month) to paste into Excel. Tick rows with the boxes on the left."
            >
              Copy selected{pickedRows.length ? ` (${pickedRows.length})` : ''}
            </button>
            <button
              type="button"
              className={own.smallBtn}
              disabled={plan.rows.length === 0}
              onClick={() => { exportPlan(plan).catch(err => window.alert(`Export failed: ${err?.message || err}`)); }}
              title="Download this schedule as an Excel file. A fee shared by several services is grouped with a sub-row for each."
            >
              Export to Excel
            </button>
            <button
              type="button"
              className={styles.applyBtn}
              disabled={building === 0 && typedCount === 0}
              onClick={() => {
                if (onApply?.(plan)) {
                  setFlash(`Built the Alternative Fee schedule on ${plan.optionName} from ${building} service fee structure${building === 1 ? '' : 's'}.`);
                  window.setTimeout(() => setFlash(''), 4000);
                }
              }}
            >
              Build fee schedule on {plan.optionName}
            </button>
          </div>
          {flash && <div className={styles.flash}>{flash}</div>}
          {rowCopyFlash && <div className={styles.flash}>{rowCopyFlash}</div>}
          <p className={styles.note}>
            A preview. Nothing changes on the Pricing subtab until you build it. Every row comes from a service&apos;s
            picked structure on the Services subtab. Type over a Fee / Unit or a Unit Count to override it; the
            years, margins and totals follow. A grouped fee shares the typed total across its rows, and a typed
            count goes on each of them.
            {typedCount > 0 && (
              <>
                {' '}{typedCount} row{typedCount === 1 ? '' : 's'} typed over.{' '}
                <button type="button" className={styles.linkBtn} onClick={() => setFeeOverrides(plan.optionNumber, () => ({}))}>
                  Put all back
                </button>
              </>
            )}
          </p>
          {plan.shared.length > 0 && (
            <div className={own.info}>
              Fee names written by more than one service keep a row for each, grouped under the fee below:{' '}
              {plan.shared.map(c => `${c.fee} (${c.services.join(', ')})`).join('; ')}.
              {plan.shared.filter(c => c.unpriced.length).map(c => (
                <Fragment key={c.fee}>
                  {' '}{c.unpriced.join(', ')} had no fee of {c.unpriced.length === 1 ? 'its' : 'their'} own for {c.fee}, so
                  that row is left off rather than billing the other service&apos;s costs twice.
                </Fragment>
              ))}
            </div>
          )}
          {plan.dropped?.length > 0 && (
            <div className={own.info}>
              Only fees from the Services subtab are built. Building takes {plan.dropped.length === 1 ? 'this row' : `these ${plan.dropped.length} rows`} off
              the schedule, since no picked structure writes {plan.dropped.length === 1 ? 'it' : 'them'}:{' '}
              {plan.dropped.map(r => r.altItem).join(', ')}.
            </div>
          )}
          {plan.moves?.length > 0 && (
            <div className={own.info}>
              Building moves {plan.moves.length} cost line{plan.moves.length === 1 ? '' : 's'} onto the fee{' '}
              {plan.moves.length === 1 ? 'it is' : 'they are'} priced into, since the fee{' '}
              {plan.moves.length === 1 ? 'it is' : 'they are'} logged on now leaves the schedule:{' '}
              {plan.moves.map(m => `${m.lineItem} (${m.from || 'no fee'} to ${m.to})`).join('; ')}.
            </div>
          )}
          {plan.rows.length === 0 ? (
            <p className={styles.note}>No fee rows.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={own.pickCol}>
                    <input
                      type="checkbox"
                      checked={allPicked}
                      ref={(el) => { if (el) el.indeterminate = pickedRows.length > 0 && !allPicked; }}
                      onChange={() => pickAll(!allPicked)}
                      aria-label="Select every row to copy"
                      title="Select every row to copy"
                    />
                  </th>
                  <th>Fee</th>
                  <th>From</th>
                  <th>Type</th>
                  <th className={styles.num}>Fee / Unit</th>
                  <th>Unit</th>
                  <th className={styles.num}>Unit Count</th>
                  <th className={styles.num}>Start Month</th>
                  {yearIdx.map(i => <th key={i} className={styles.num}>{`Y${i + 1}`}</th>)}
                  <th className={styles.num}>Term</th>
                  <th className={styles.num} title="Term fees against the term cost of the cost lines the fee prices">Margin</th>
                </tr>
              </thead>
              <tbody>
                {feeGroups.map((g, gi) => {
                  const key = String(g.row.name || '').trim().toLowerCase();
                  const isGroup = g.subRows.length > 0;
                  const open = isGroup && !collapsed[key];
                  const editable = (r) => canType && !!r.key;
                  const subsEditable = isGroup && g.subRows.every(editable) && typeof g.row.feePerUnit === 'number';
                  const cells = (r, fee, count) => (
                    <>
                      <td className={styles.num}>{fee || fmtMoney(r.feePerUnit)}</td>
                      <td>{r.unit}</td>
                      <td className={styles.num}>{count || (r.unitCount ?? '')}</td>
                      <td className={styles.num}>{r.startMonth ?? ''}</td>
                      {yearIdx.map(yi => <td key={yi} className={styles.num}>{r.years[yi] ? fmtMoney(r.years[yi]) : ''}</td>)}
                      <td className={styles.num}>{r.term ? fmtMoney(r.term) : ''}</td>
                      <td className={styles.num}>{fmtPct(r.margin)}</td>
                    </>
                  );
                  if (!isGroup) {
                    const r = g.row;
                    return (
                      <tr key={`${key}-${gi}`} className={r.service ? own.newRow : undefined}>
                        {pickCell(`${key}-${gi}`, r.name)}
                        <td>{r.name}{r.passThrough && <span className={styles.subNote}> pass-through</span>}</td>
                        <td className={r.service ? undefined : own.muted}>{fromLabel(g, covered)}</td>
                        <td>{r.type}</td>
                        {cells(r, editable(r) && (
                          <FeeCell value={r.feePerUnit} overridden={r.overridden} builtFee={r.builtFee} label={r.name}
                            onCommit={(v) => setFee([[r.key, v]])} />
                        ), editable(r) && (
                          <UnitCountCell value={r.unitCount} overridden={r.unitsOverridden} builtCount={r.builtUnitCount} label={r.name}
                            onCommit={(v) => setFee([[r.unitsKey, v]])} />
                        ))}
                      </tr>
                    );
                  }
                  return (
                    <Fragment key={`${key}-${gi}`}>
                      <tr className={own.groupRow}>
                        {pickCell(`${key}-${gi}`, g.row.name)}
                        <td>
                          <button
                            type="button"
                            className={own.caretBtn}
                            onClick={() => setCollapsed(prev => ({ ...prev, [key]: open }))}
                            aria-expanded={open}
                            title={open ? 'Hide the rows behind this fee' : 'Show the rows behind this fee'}
                          >
                            <span aria-hidden="true">{open ? '▾' : '▸'}</span> {g.row.name}
                          </button>
                        </td>
                        <td>{fromLabel(g, covered)}</td>
                        <td>{g.row.type}</td>
                        {cells(g.row, subsEditable && (
                          <FeeCell
                            value={g.row.feePerUnit}
                            overridden={g.subRows.some(r => r.overridden)}
                            builtFee={g.subRows.every(r => typeof (r.overridden ? r.builtFee : r.feePerUnit) === 'number')
                              ? sum(g.subRows.map(r => (r.overridden ? r.builtFee : r.feePerUnit))) : null}
                            label={g.row.name}
                            onCommit={(v) => setGroupFee(g.subRows, v)}
                          />
                        ), isGroup && g.subRows.every(editable) && (
                          // The count typed on a grouped fee goes on every row under it.
                          <UnitCountCell
                            value={g.row.unitCount}
                            overridden={g.subRows.some(r => r.unitsOverridden)}
                            builtCount={g.subRows[0].builtUnitCount}
                            label={g.row.name}
                            onCommit={(v) => setFee(g.subRows.map(r => [r.unitsKey, v]))}
                          />
                        ))}
                      </tr>
                      {open && g.subRows.map((r, si) => (
                        <tr key={si} className={`${own.subRow} ${r.service ? own.newRow : ''}`}>
                          {pickCell(`${key}-${gi}-${si}`, `${r.name}, ${r.service || 'on the schedule'}`)}
                          <td>{r.name}{r.passThrough && <span className={styles.subNote}> pass-through</span>}</td>
                          <td className={r.service ? undefined : own.muted}>{r.service || 'On the schedule'}</td>
                          <td>{r.type}</td>
                          {cells(r, editable(r) && (
                            <FeeCell value={r.feePerUnit} overridden={r.overridden} builtFee={r.builtFee} label={`${r.name}, ${r.service || 'on the schedule'}`}
                              onCommit={(v) => setFee([[r.key, v]])} />
                          ), editable(r) && (
                            <UnitCountCell value={r.unitCount} overridden={r.unitsOverridden} builtCount={r.builtUnitCount} label={`${r.name}, ${r.service || 'on the schedule'}`}
                              onCommit={(v) => setFee([[r.unitsKey, v]])} />
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                <tr className={own.totalRow}>
                  <td colSpan={8}>Total</td>
                  {yearIdx.map(yi => <td key={yi} className={styles.num}>{fmtMoney(plan.after.feeByYear[yi])}</td>)}
                  <td className={styles.num}>{fmtMoney(sum(plan.after.feeByYear))}</td>
                  <td
                    className={styles.num}
                    title="Fees against the cost lines they price, leaving out pass-through fees. Deal margin below also counts cost no fee prices."
                  >
                    {(() => {
                      const kept = plan.rows.filter(r => !r.passThrough);
                      const t = sum(kept.map(r => r.term));
                      return t > 0 ? fmtPct((t - sum(kept.map(r => r.cost))) / t) : '';
                    })()}
                  </td>
                </tr>
              </tbody>
            </table>
          )}

          <div className={styles.previewLabel}>{plan.optionName} totals</div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th />
                {yearIdx.map(i => <th key={i} className={styles.num}>{`Y${i + 1} fees`}</th>)}
                <th className={styles.num}>Term fees</th>
                <th className={styles.num}>Term cost</th>
                <th className={styles.num}>Deal margin</th>
              </tr>
            </thead>
            <tbody>
              {[['Now on the schedule', plan.before], ['As built', plan.after]].map(([label, t]) => (
                <tr key={label}>
                  <td>{label}</td>
                  {yearIdx.map(yi => <td key={yi} className={styles.num}>{fmtMoney(t.feeByYear[yi])}</td>)}
                  <td className={styles.num}>{fmtMoney(sum(t.feeByYear))}</td>
                  <td className={styles.num}>{fmtMoney(sum(t.costByYear))}</td>
                  <td className={styles.num}>{t.margin?.finalMargin != null ? fmtPct(t.margin.finalMargin) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.previewLabel}>{plan.optionName} costs by type</div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th />
                {yearIdx.map(i => <th key={i} className={styles.num}>{`Y${i + 1} cost`}</th>)}
                <th className={styles.num}>Term cost</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Now on the schedule', (c) => !!c.pricingFee],
                ['As built', (c) => !!c.builderFee],
              ].map(([label, counted]) => {
                // The cost lines each side logs on a fee, by kind; the
                // Total matches the Term cost above.
                const { rows: kinds, total } = costsByKind(plan.costLines, plan.numYears || 1, counted);
                return (
                  <Fragment key={label}>
                    <tr><td colSpan={yearIdx.length + 2}><strong>{label}</strong></td></tr>
                    {kinds.map(k => (
                      <tr key={k.kind}>
                        <td style={{ paddingLeft: 24 }}>{k.kind}</td>
                        {yearIdx.map(yi => <td key={yi} className={styles.num}>{fmtMoney(k.byYear[yi])}</td>)}
                        <td className={styles.num}>{fmtMoney(sum(k.byYear))}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ paddingLeft: 24 }}><strong>Total</strong></td>
                      {yearIdx.map(yi => <td key={yi} className={styles.num}><strong>{fmtMoney(total[yi])}</strong></td>)}
                      <td className={styles.num}><strong>{fmtMoney(sum(total))}</strong></td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
