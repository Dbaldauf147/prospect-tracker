import { useEffect, useRef, useState } from 'react';
import { parsePricingWorkbook } from '../../utils/pricingParse';
import styles from './CompareTab.module.css';

// Map a workbook Option's CTS rows into the Compare tab's row shape.
// Fee Bucket pulls the row's resolved Linked To tag (per-row override
// or saved default for its Line Item + Type) so the comparison groups
// by the same buckets the Linked To page wires up. Category is the
// line item description; numeric fields are kept as numbers.
function optionToCompareRows(opt, resolvedLinkedTo) {
  if (!opt || !Array.isArray(opt.sections)) return [];
  const rows = [];
  for (const sec of opt.sections) {
    for (const item of (sec.items || [])) {
      if (typeof item.cts !== 'number') continue;
      const linked = resolvedLinkedTo ? String(resolvedLinkedTo(item) || '').trim() : '';
      rows.push({
        id: newRowId(),
        feeBucket: linked,
        category: item.description || '',
        type: item.type || '',
        cts: item.cts,
        startMonth: item.startMonth ?? '',
      });
    }
  }
  return rows;
}

const TYPE_OPTIONS = ['Setup', 'One Time', 'Recurring (monthly)'];

// Stable per-row id so manual links between Current ↔ New rows survive
// edits / reorders. Rows that came from older state without an id get
// one backfilled on mount (see ensureRowIds below).
const newRowId = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* noop */ }
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
};

const EMPTY_ROW = () => ({
  id: newRowId(),
  feeBucket: '', category: '', type: '', cts: '', startMonth: '',
});

const ensureRowIds = (rows) =>
  (Array.isArray(rows) ? rows : []).map(r => (r && r.id ? r : { ...(r || {}), id: newRowId() }));

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

// Parse tab- or comma-separated text from Excel into rows. Columns:
// Fee Bucket / CTS Category / Type / CTS / Start Month. Extra columns
// are ignored.
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
      id: newRowId(),
      feeBucket: cell(0),
      category: cell(1),
      type: cell(2),
      cts: cell(3),
      startMonth: cell(4),
    });
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

function CellInput({ value, onCommit, align, placeholder, title }) {
  const initial = value == null ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  return (
    <input
      type="text"
      className={styles.input}
      style={align === 'right' ? { textAlign: 'right' } : undefined}
      value={draft}
      placeholder={placeholder || ''}
      title={title || (draft ? draft : undefined)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== initial) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(initial); e.currentTarget.blur(); }
      }}
    />
  );
}

function CostTable({ title, rows, otherRows, otherLabel, onChange, onAddRow, onRemoveRow, onReplaceRows, onClear, tone, importOptions, onImportOption, getLinkedOtherId, setLink, clearLink, linkedOtherIds, linkedThisIds, onFileDrop, techDeprPct = 0 }) {
  // Lookup map keyed by category + type so each row compares against
  // the matching row(s) of the same type on the other side. Keying by
  // category alone collapses rows like "Commercial Client Manager"
  // across Setup / Recurring / One Time, which makes every one of
  // them look off by the sum of the others. Multiple rows that share
  // the same (category, type) are still summed under the key — when
  // both sides carry the same set, the sums cancel and the row shows
  // "=" as expected. Rows explicitly tied via the link button are
  // handled separately below and excluded from these sums.
  const compareKey = (r) => `${normalizeCategory(r.category)}||${(r.type || '').trim().toLowerCase()}`;
  const otherById = new Map();
  for (const r of (otherRows || [])) {
    if (r && r.id) otherById.set(r.id, r);
  }
  const otherByKey = new Map();
  for (const r of (otherRows || [])) {
    const cat = normalizeCategory(r.category);
    if (!cat) continue;
    if (linkedOtherIds && linkedOtherIds.has(r.id)) continue; // counted via its link, not auto-match
    const key = compareKey(r);
    const v = toNum(r.cts) || 0;
    otherByKey.set(key, (otherByKey.get(key) || 0) + v);
  }
  // Sum this side's rows the same way so a row's delta is computed
  // against the per-key total on each side — not its own single
  // value against the other side's sum.
  const thisByKey = new Map();
  for (const r of rows) {
    const cat = normalizeCategory(r.category);
    if (!cat) continue;
    if (linkedThisIds && linkedThisIds.has(r.id)) continue;
    const key = compareKey(r);
    const v = toNum(r.cts) || 0;
    thisByKey.set(key, (thisByKey.get(key) || 0) + v);
  }
  // Popover state for the per-row link picker. One open at a time.
  const [linkMenuFor, setLinkMenuFor] = useState(null); // row id whose menu is open
  const [linkFilter, setLinkFilter] = useState('');
  const linkMenuRef = useRef(null);
  useEffect(() => {
    if (!linkMenuFor) return;
    const handler = (e) => {
      if (linkMenuRef.current && !linkMenuRef.current.contains(e.target)) {
        setLinkMenuFor(null);
        setLinkFilter('');
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [linkMenuFor]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [flash, setFlash] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const importMenuRef = useRef(null);
  // Highlight state while a file is dragged over this side's panel. Only
  // set for actual file drags (not text / row selections) so hovering a
  // copied cell range doesn't flash the drop hint.
  const [fileDragOver, setFileDragOver] = useState(false);

  const isFileDrag = (e) => {
    const types = e.dataTransfer?.types;
    return !!types && Array.from(types).includes('Files');
  };
  function handleFileDragOver(e) {
    if (!onFileDrop || !isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (!fileDragOver) setFileDragOver(true);
  }
  function handleFileDragLeave(e) {
    if (!onFileDrop) return;
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setFileDragOver(false);
  }
  function handleFileDrop(e) {
    if (!onFileDrop || !isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setFileDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) onFileDrop(file);
  }

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
    const newRows = parseRowsFromText(text);
    if (!newRows.length) return;
    const padded = newRows.length < 10
      ? newRows.concat(Array.from({ length: 10 - newRows.length }, EMPTY_ROW))
      : newRows;
    onReplaceRows(padded);
    setFlash(`Pasted ${newRows.length} row${newRows.length === 1 ? '' : 's'}.`);
    window.setTimeout(() => setFlash(''), 2500);
  }

  const totals = summarize(rows);
  // Tech depreciation booked against each cost type's CTS at the rate
  // set on the Pricing subtab (Tech Depr. %). Recurring depr is monthly
  // (matches the recurring total); setup / one-time depr are one-shot.
  const deprPct = typeof techDeprPct === 'number' && techDeprPct > 0 ? techDeprPct : 0;
  const depr = {
    recurringMonthly: totals.recurringMonthly * deprPct,
    setup: totals.setupTotal * deprPct,
    oneTime: totals.oneTimeTotal * deprPct,
  };
  const deprPctLabel = `${(deprPct * 100).toFixed(1)}% of CTS`;
  const cellClass = tone === 'new' ? styles.cellNew : styles.cellCurrent;

  return (
    <div
      className={`${styles.tablePanel} ${fileDragOver ? styles.fileDragOver : ''}`.trim()}
      onPaste={handleTablePaste}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {fileDragOver && (
        <div className={styles.dropOverlay}>
          <div className={styles.dropOverlayText}>
            Drop a pricing workbook to import an Option into “{title}”
          </div>
        </div>
      )}
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
                      const hasData = rows.some(r => r.feeBucket || r.category || r.type || r.cts || r.startMonth);
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
            if (rows.every(r => !r.feeBucket && !r.category && !r.type && !r.cts && !r.startMonth)) {
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
            Tab-separated rows: Fee Bucket · CTS Category · Type · CTS · Start Month.
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
                const newRows = parseRowsFromText(pasteText);
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
              <th className={styles.colCombine} title={`Δ vs the matching row in ${otherLabel || 'the other table'}, or a missing-row marker.`}>Compare</th>
              <th className={styles.actionCol} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const k = `${idx}-${row.feeBucket}-${row.category}-${row.type}-${row.cts}-${row.startMonth}`;
              const cat = normalizeCategory(row.category);
              const rowKey = compareKey(row);
              const linkedOtherId = getLinkedOtherId ? getLinkedOtherId(row.id) : null;
              const linkedOther = linkedOtherId ? otherById.get(linkedOtherId) : null;
              let compareCell;
              if (linkedOther) {
                const thisSum = toNum(row.cts) || 0;
                const otherSum = toNum(linkedOther.cts) || 0;
                const delta = thisSum - otherSum;
                const linkLabel = (linkedOther.category || '').trim() || '(blank)';
                const sign = delta === 0
                  ? <span className={styles.compareMuted}>=</span>
                  : <span className={delta > 0 ? styles.deltaUp : styles.deltaDown}>{fmtMoneySigned(delta)}</span>;
                compareCell = (
                  <span title={`Tied to "${linkLabel}" in ${otherLabel || 'the other table'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span aria-hidden="true" style={{ fontSize: '0.7rem' }}>🔗</span>
                    {sign}
                  </span>
                );
              } else if (!cat) {
                compareCell = <span className={styles.compareMuted}>—</span>;
              } else if (otherByKey.has(rowKey)) {
                const otherSum = otherByKey.get(rowKey) || 0;
                const thisSum = thisByKey.get(rowKey) || 0;
                // Sign convention: positive means THIS side is more
                // expensive than the other. So the more expensive side
                // reads "+$X" (red), the cheaper side reads "−$X"
                // (green) — intuitively "this row costs more / less
                // than its match on the other side".
                const delta = thisSum - otherSum;
                if (delta === 0) {
                  compareCell = <span className={styles.compareMuted}>=</span>;
                } else {
                  compareCell = (
                    <span className={delta > 0 ? styles.deltaUp : styles.deltaDown}>
                      {fmtMoneySigned(delta)}
                    </span>
                  );
                }
              } else {
                compareCell = (
                  <span className={styles.compareMissing} title={`No ${row.type || 'matching'} row with category "${row.category}" found in ${otherLabel || 'the other table'}.`}>
                    Missing in {otherLabel || 'other'}
                  </span>
                );
              }
              // Candidates for the link picker: rows on the other side
              // with at least a category or CTS filled in, that aren't
              // already tied to a different row on this side (so each
              // other-side row only appears in one picker at a time).
              // The currently linked row for THIS picker stays in the
              // list so the user can confirm / re-pick it.
              const candidates = (otherRows || []).filter(r => {
                if (!r || !r.id) return false;
                if (!(r.category || r.feeBucket || r.cts)) return false;
                if (linkedOtherIds && linkedOtherIds.has(r.id) && r.id !== linkedOtherId) return false;
                return true;
              });
              const q = linkFilter.trim().toLowerCase();
              const visibleCandidates = q
                ? candidates.filter(r =>
                    (r.category || '').toLowerCase().includes(q)
                    || (r.feeBucket || '').toLowerCase().includes(q)
                    || (r.type || '').toLowerCase().includes(q))
                : candidates;
              return (
                <tr key={row.id || idx}>
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
                  <td className={`${cellClass} ${styles.compareCell}`} style={{ position: 'relative' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {compareCell}
                      <button
                        type="button"
                        className={styles.linkBtn}
                        onClick={() => {
                          if (linkMenuFor === row.id) { setLinkMenuFor(null); setLinkFilter(''); }
                          else { setLinkMenuFor(row.id); setLinkFilter(''); }
                        }}
                        title={linkedOther
                          ? `Tied to "${(linkedOther.category || '(blank)').trim()}" in ${otherLabel || 'the other table'}. Click to change or unlink.`
                          : `Tie this row to a specific row in ${otherLabel || 'the other table'}`}
                      >
                        {linkedOther ? '⛓' : '🔗'}
                      </button>
                    </span>
                    {linkMenuFor === row.id && (
                      <div ref={linkMenuRef} className={styles.linkMenu}>
                        <div className={styles.linkMenuHeader}>
                          Tie to a row in {otherLabel || 'the other table'}
                        </div>
                        <input
                          autoFocus
                          value={linkFilter}
                          onChange={(e) => setLinkFilter(e.target.value)}
                          placeholder="Search category, fee bucket, type…"
                          className={styles.linkMenuSearch}
                        />
                        {linkedOther && (
                          <button
                            type="button"
                            className={styles.linkMenuClear}
                            onClick={() => { if (clearLink) clearLink(row.id); setLinkMenuFor(null); setLinkFilter(''); }}
                          >Unlink (currently tied to "{(linkedOther.category || '(blank)').trim()}")</button>
                        )}
                        <div className={styles.linkMenuList}>
                          {visibleCandidates.length === 0 ? (
                            <div className={styles.linkMenuEmpty}>No rows match.</div>
                          ) : visibleCandidates.map(r => {
                            const ctsTxt = toNum(r.cts) != null ? fmtMoney(toNum(r.cts) || 0) : '';
                            const tag = [r.feeBucket, r.type, ctsTxt].filter(Boolean).join(' · ');
                            const isCurrent = linkedOther && linkedOther.id === r.id;
                            return (
                              <button
                                key={r.id}
                                type="button"
                                className={`${styles.linkMenuItem} ${isCurrent ? styles.linkMenuItemActive : ''}`}
                                onClick={() => { if (setLink) setLink(row.id, r.id); setLinkMenuFor(null); setLinkFilter(''); }}
                              >
                                <div className={styles.linkMenuItemTitle}>{(r.category || '').trim() || '(blank category)'}</div>
                                {tag && <div className={styles.linkMenuItemMeta}>{tag}</div>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </td>
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
              <td colSpan={3} style={{ textAlign: 'right' }}>Recurring</td>
              <td className={styles.numCell}>{fmtMoney(totals.recurringMonthly)}<span className={styles.unitTag}>/mo</span></td>
              <td colSpan={3} className={styles.deprCell}>
                {deprPct > 0 && totals.recurringMonthly ? (
                  <span className={styles.deprTag} title={`Tech depreciation — ${deprPctLabel}`}>
                    +{fmtMoney(depr.recurringMonthly)} tech depr/mo
                  </span>
                ) : null}
              </td>
            </tr>
            <tr className={styles.totalsRow}>
              <td colSpan={3} style={{ textAlign: 'right' }}>Setup</td>
              <td className={styles.numCell}>{fmtMoney(totals.setupTotal)}</td>
              <td colSpan={3} className={styles.deprCell}>
                {deprPct > 0 && totals.setupTotal ? (
                  <span className={styles.deprTag} title={`Tech depreciation — ${deprPctLabel}`}>
                    +{fmtMoney(depr.setup)} tech depr
                  </span>
                ) : null}
              </td>
            </tr>
            <tr className={styles.totalsRow}>
              <td colSpan={3} style={{ textAlign: 'right' }}>One-time</td>
              <td className={styles.numCell}>{fmtMoney(totals.oneTimeTotal)}</td>
              <td colSpan={3} className={styles.deprCell}>
                {deprPct > 0 && totals.oneTimeTotal ? (
                  <span className={styles.deprTag} title={`Tech depreciation — ${deprPctLabel}`}>
                    +{fmtMoney(depr.oneTime)} tech depr
                  </span>
                ) : null}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CompareTab({ state, setState, workbook, resolvedLinkedTo, techDeprPct = 0 }) {
  const importOptions = Array.isArray(workbook?.options) ? workbook.options : [];
  const safe = state && state.current && state.next
    ? state
    : {
        currentLabel: 'Old',
        nextLabel: 'Current',
        current: Array.from({ length: 10 }, EMPTY_ROW),
        next: Array.from({ length: 10 }, EMPTY_ROW),
        links: {},
      };

  // Backfill stable row ids and a links bag once, so legacy saved
  // state immediately supports manual row-to-row tying. Also migrate
  // the previous default labels ("Current" / "New") to the new
  // defaults ("Old" / "Current") so existing users see the rename
  // automatically — user-edited labels are left alone.
  useEffect(() => {
    if (!state || !state.current || !state.next) return;
    const needsIds = state.current.some(r => !r?.id) || state.next.some(r => !r?.id) || !state.links;
    const needsLabelMigration = state.currentLabel === 'Current' && state.nextLabel === 'New';
    if (!needsIds && !needsLabelMigration) return;
    setState({
      ...state,
      current: ensureRowIds(state.current),
      next: ensureRowIds(state.next),
      links: state.links && typeof state.links === 'object' ? state.links : {},
      ...(needsLabelMigration ? { currentLabel: 'Old', nextLabel: 'Current' } : {}),
    });
  }, [state, setState]);

  const update = (next) => setState(next);

  // Drop-to-import: when a pricing workbook is dropped on either side's
  // panel, parse it and open a picker asking which Option tab's costs to
  // pull in. `dropImport` holds { side, fileName, options, error } while
  // the picker is open; null when closed.
  const [dropImport, setDropImport] = useState(null);
  async function handleDroppedFile(side, file) {
    let options = [];
    let error = '';
    try {
      const buf = await file.arrayBuffer();
      const parsed = parsePricingWorkbook(buf);
      options = Array.isArray(parsed?.options) ? parsed.options : [];
      if (!options.length) error = `No “Option 1–5” tabs were found in “${file.name}”.`;
    } catch (err) {
      error = err?.message || `Could not read “${file.name}”.`;
    }
    setDropImport({ side, fileName: file.name, options, error });
  }

  const updateRow = (side) => (idx, key, value) => {
    const rows = safe[side].slice();
    rows[idx] = { ...rows[idx], [key]: value };
    update({ ...safe, [side]: rows });
  };
  const addRow = (side) => () => update({ ...safe, [side]: [...safe[side], EMPTY_ROW()] });
  // Drop any explicit row link that references ids no longer present
  // on either side. Prevents the link map from holding dangling rows
  // after deletions / clears / re-imports.
  const pruneLinks = (links, currentRows, nextRows) => {
    const curIds = new Set((currentRows || []).map(r => r?.id).filter(Boolean));
    const nxtIds = new Set((nextRows || []).map(r => r?.id).filter(Boolean));
    const out = {};
    for (const [cid, nid] of Object.entries(links || {})) {
      if (curIds.has(cid) && nxtIds.has(nid)) out[cid] = nid;
    }
    return out;
  };
  const removeRow = (side) => (idx) => {
    const rows = safe[side].slice();
    rows.splice(idx, 1);
    const finalRows = rows.length ? rows : [EMPTY_ROW()];
    const nextState = { ...safe, [side]: finalRows };
    nextState.links = pruneLinks(safe.links, nextState.current, nextState.next);
    update(nextState);
  };
  const replaceRows = (side) => (rows) => {
    const nextState = { ...safe, [side]: rows };
    nextState.links = pruneLinks(safe.links, nextState.current, nextState.next);
    update(nextState);
  };
  const importOption = (side) => (opt) => {
    const imported = optionToCompareRows(opt, resolvedLinkedTo);
    const padded = imported.length < 10
      ? imported.concat(Array.from({ length: 10 - imported.length }, EMPTY_ROW))
      : imported;
    const nextState = { ...safe, [side]: padded };
    nextState.links = pruneLinks(safe.links, nextState.current, nextState.next);
    update(nextState);
  };
  // Reset a side back to the empty 10-row template (mirrors the
  // initial state so totals + the per-category compare also reset).
  const clearSide = (side) => () => {
    const fresh = Array.from({ length: 10 }, EMPTY_ROW);
    const nextState = { ...safe, [side]: fresh };
    nextState.links = pruneLinks(safe.links, nextState.current, nextState.next);
    update(nextState);
  };

  // Row-link helpers. `links` is keyed by Current row id → Next row id;
  // both setLink callers normalize their (this, other) ids into that
  // canonical orientation. Linking either row replaces any prior link
  // either of them was part of.
  const links = (safe.links && typeof safe.links === 'object') ? safe.links : {};
  const setLinkFor = (side) => (thisId, otherId) => {
    if (!thisId || !otherId) return;
    const currentId = side === 'current' ? thisId : otherId;
    const nextId = side === 'current' ? otherId : thisId;
    const out = {};
    for (const [cid, nid] of Object.entries(links)) {
      if (cid === currentId) continue;
      if (nid === nextId) continue;
      out[cid] = nid;
    }
    out[currentId] = nextId;
    update({ ...safe, links: out });
  };
  const clearLinkFor = (side) => (thisId) => {
    if (!thisId) return;
    const out = {};
    for (const [cid, nid] of Object.entries(links)) {
      if (side === 'current' && cid === thisId) continue;
      if (side === 'next' && nid === thisId) continue;
      out[cid] = nid;
    }
    update({ ...safe, links: out });
  };
  const linkedFromCurrent = new Map(Object.entries(links));
  const linkedFromNext = new Map();
  for (const [cid, nid] of Object.entries(links)) linkedFromNext.set(nid, cid);
  const getLinkedOtherIdFor = (side) => (thisId) => {
    if (!thisId) return null;
    return side === 'current' ? (linkedFromCurrent.get(thisId) || null) : (linkedFromNext.get(thisId) || null);
  };
  const linkedCurrentIds = new Set(linkedFromCurrent.keys());
  const linkedNextIds = new Set(linkedFromNext.keys());

  const currentTotals = summarize(safe.current);
  const nextTotals = summarize(safe.next);

  // Build a side-by-side comparison: every distinct CTS Category that
  // appears on either side becomes a row, paired with its monthly
  // recurring on each side (the dominant cost type for these tables).
  // Explicit row links collapse a Current row + a New row into a
  // single entry (labeled with the New side's category, falling back
  // to Current's) regardless of category text. Unlinked rows still
  // match by normalized category as before.
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
    const currentById = new Map(safe.current.map(r => [r?.id, r]).filter(([id]) => id));
    const nextById = new Map(safe.next.map(r => [r?.id, r]).filter(([id]) => id));
    // Linked pairs first — each pair gets its own synthetic key so the
    // two rows always roll up together even if their categories differ.
    for (const [cid, nid] of Object.entries(links)) {
      const cur = currentById.get(cid);
      const nxt = nextById.get(nid);
      if (!cur && !nxt) continue;
      const label = (nxt?.category || cur?.category || '').trim() || '(blank)';
      const ent = ensure(`__link__:${cid}|${nid}`, label);
      const cv = toNum(cur?.cts) || 0;
      const nv = toNum(nxt?.cts) || 0;
      if (cur) {
        if (isRecurring(cur.type)) ent.oldMonthly += cv; else ent.oldSetup += cv;
      }
      if (nxt) {
        if (isRecurring(nxt.type)) ent.newMonthly += nv; else ent.newSetup += nv;
      }
    }
    for (const r of safe.current) {
      if (r && r.id && linkedCurrentIds.has(r.id)) continue;
      const cat = (r.category || '').trim();
      if (!cat) continue;
      const v = toNum(r.cts) || 0;
      const ent = ensure(keyFor(cat), cat);
      if (isRecurring(r.type)) ent.oldMonthly += v;
      else ent.oldSetup += v;
    }
    for (const r of safe.next) {
      if (r && r.id && linkedNextIds.has(r.id)) continue;
      const cat = (r.category || '').trim();
      if (!cat) continue;
      const v = toNum(r.cts) || 0;
      const ent = ensure(keyFor(cat), cat);
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
        {' '}{safe.currentLabel} and {safe.nextLabel} tables — totals, per-category deltas, and
        a first-year roll-up update as you edit. Each row's <strong>Compare</strong> column shows
        the delta vs the matching row on the other side, or a missing-row marker when the
        category isn't there. Click the 🔗 icon to manually tie a row to a specific row on the
        other side when the categories don't match exactly. You can also <strong>drag &amp; drop
        a pricing workbook</strong> (the same file you drop on the Pricing subtab) onto either
        table — you'll be asked which Option tab's costs to import.
      </div>

      <div className={styles.labelRow}>
        <label className={styles.miniField}>
          Left label
          <input
            value={safe.currentLabel}
            onChange={(e) => update({ ...safe, currentLabel: e.target.value })}
          />
        </label>
        <label className={styles.miniField}>
          Right label
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
          <div className={styles.summaryHeader}>Delta ({safe.nextLabel} − {safe.currentLabel})</div>
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
          otherRows={safe.next}
          otherLabel={safe.nextLabel}
          onChange={updateRow('current')}
          onAddRow={addRow('current')}
          onRemoveRow={removeRow('current')}
          onReplaceRows={replaceRows('current')}
          onClear={clearSide('current')}
          importOptions={importOptions}
          onImportOption={importOption('current')}
          getLinkedOtherId={getLinkedOtherIdFor('current')}
          setLink={setLinkFor('current')}
          clearLink={clearLinkFor('current')}
          linkedThisIds={linkedCurrentIds}
          linkedOtherIds={linkedNextIds}
          onFileDrop={(file) => handleDroppedFile('current', file)}
          techDeprPct={techDeprPct}
        />
        <CostTable
          title={safe.nextLabel}
          tone="new"
          rows={safe.next}
          otherRows={safe.current}
          otherLabel={safe.currentLabel}
          onChange={updateRow('next')}
          onAddRow={addRow('next')}
          onRemoveRow={removeRow('next')}
          onReplaceRows={replaceRows('next')}
          onClear={clearSide('next')}
          importOptions={importOptions}
          onImportOption={importOption('next')}
          getLinkedOtherId={getLinkedOtherIdFor('next')}
          setLink={setLinkFor('next')}
          clearLink={clearLinkFor('next')}
          linkedThisIds={linkedNextIds}
          linkedOtherIds={linkedCurrentIds}
          onFileDrop={(file) => handleDroppedFile('next', file)}
          techDeprPct={techDeprPct}
        />
      </div>

      <div className={styles.compareBlock}>
        <div className={styles.compareHeader}>
          Per-category comparison
          <span className={styles.compareHint}>
            Sorted by largest monthly delta. Matched by CTS Category text, plus any pairs you
            tied manually with the 🔗 icon.
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

      {dropImport && (
        <div className={styles.modalOverlay} onMouseDown={() => setDropImport(null)}>
          <div className={styles.modalCard} onMouseDown={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>
              Import costs into “{dropImport.side === 'current' ? safe.currentLabel : safe.nextLabel}”
            </div>
            <div className={styles.modalSub}>
              From <strong>{dropImport.fileName}</strong> — choose which Option tab to import the CTS costs from.
            </div>
            {dropImport.error ? (
              <div className={styles.modalError}>{dropImport.error}</div>
            ) : (
              <div className={styles.modalList}>
                {dropImport.options.map(opt => (
                  <button
                    key={opt.optionNumber}
                    type="button"
                    className={styles.modalItem}
                    onClick={() => {
                      const targetRows = dropImport.side === 'current' ? safe.current : safe.next;
                      const targetLabel = dropImport.side === 'current' ? safe.currentLabel : safe.nextLabel;
                      const hasData = targetRows.some(r => r.feeBucket || r.category || r.type || r.cts || r.startMonth);
                      if (hasData && !window.confirm(`Replace the rows in “${targetLabel}” with the CTS items from “${opt.sheetName}”?`)) return;
                      importOption(dropImport.side)(opt);
                      setDropImport(null);
                    }}
                  >
                    <span className={styles.modalItemTitle}>{opt.sheetName}</span>
                    <span className={styles.modalItemMeta}>
                      {(opt.sections || []).reduce((n, s) => n + (s.items ? s.items.filter(i => typeof i.cts === 'number').length : 0), 0)} CTS rows
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className={styles.modalActions}>
              <button type="button" className={styles.btn} onClick={() => setDropImport(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
