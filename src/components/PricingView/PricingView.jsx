import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts';
import styles from './PricingView.module.css';
import { parsePricingWorkbook, priceFromCostAndGm } from '../../utils/pricingParse';
import { dbGet, dbPut, dbDelete } from '../../utils/db';
import { OptionsTab } from './OptionsTab';
import { PricingConversions } from './PricingConversions';

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

function AltFeeTable({ rows, onChange, onAddRow, onRemoveRow, onReplaceRows, onAppendRows, globalGmPct, marginFor, yearRevenue, numYears = 1 }) {
  const fmtMoneyCell = (n) => {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '';
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  };
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
                const placeholder = computed
                  ? `${(computed.marginPct * 100).toFixed(1)}%`
                  : (typeof globalGmPct === 'number' ? `${Math.round(globalGmPct * 100)}%` : '');
                const fmt = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
                const title = computed
                  ? `Auto-margin for "${row.altItem}":
  • Total fee revenue: ${fmt(computed.totalFee)} (${computed.altRowCount} alt-fee row${computed.altRowCount === 1 ? '' : 's'} × unit count, recurring projected over term; total units = ${computed.totalUnits})
  • Total cost: ${fmt(computed.totalCost)} (${computed.matchCount} linked CTS row${computed.matchCount === 1 ? '' : 's'}, treated as totals; recurring/rolled projected over term)
  • Margin: (${fmt(computed.totalFee)} − ${fmt(computed.totalCost)}) ÷ ${fmt(computed.totalFee)} = ${(computed.marginPct * 100).toFixed(1)}%
Type a value to override.`
                  : 'No CTS items are linked to this Alt Fee item — falls back to the global GM%.';
                return (
                  <td className={styles.numCell} title={title}>
                    <CellTextInput
                      key={`alt-${idx}-feeGm-${row.feeGmPct ?? ''}-${computed ? computed.marginPct.toFixed(4) : 'n'}`}
                      initial={typeof row.feeGmPct === 'number' ? (row.feeGmPct * 100).toString() : ''}
                      placeholder={placeholder}
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
                );
              })()}
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
          {(() => {
            // Per-year totals split into Setup + One Time vs Recurring (monthly).
            const isRecurring = (t) => /recurring/i.test(t || '');
            const isOneTimeOrSetup = (t) => /^setup$|^one\s*time$/i.test(t || '');
            const sums = (predicate) => Array.from({ length: numYears }, (_, i) =>
              rows.reduce((s, r) => predicate(r.type) && yearRevenue ? s + yearRevenue(r, i + 1) : s, 0)
            );
            const setupOneTime = sums(isOneTimeOrSetup);
            const recurring = sums(isRecurring);
            const grand = setupOneTime.map((v, i) => v + recurring[i]);
            const renderTotalsRow = (label, values) => (
              <tr className={styles.totalsRow}>
                <td colSpan={6} style={{ textAlign: 'right', fontWeight: 600 }}>{label}</td>
                {values.map((v, i) => (
                  <td key={`tot-${label}-${i}`} className={styles.numCell}>
                    {v > 0 ? fmtMoneyCell(v) : ''}
                  </td>
                ))}
                <td colSpan={2} />
              </tr>
            );
            return (
              <>
                {renderTotalsRow('Setup + One Time', setupOneTime)}
                {renderTotalsRow('Recurring (monthly)', recurring)}
                {renderTotalsRow('Total', grand)}
              </>
            );
          })()}
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

// Read-only panel describing the existing Linked To logic and showing
// the active relationships on the current workbook. Rendered on the
// "Linked To" page subtab.
function LinkedToPanel({
  workbook,
  activeOption,
  setActiveOption,
  overrides,
  linkedToDefaults,
  altFees,
  resolvedLinkedTo,
  effectiveType,
  linkedToDefaultKey,
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

  // Saved (Line Item, Type) defaults that are reachable from at least
  // one row on this option — keeps the panel focused on what's wired
  // up here, not orphan keys left from other workbooks.
  const reachableDefaults = (() => {
    const out = [];
    const seen = new Set();
    for (const item of flatItems) {
      const key = linkedToDefaultKey(item.description, effectiveType(item));
      if (seen.has(key)) continue;
      const val = linkedToDefaults[key];
      if (!val) continue;
      seen.add(key);
      out.push({ key, lineItem: item.description, type: effectiveType(item), value: val });
    }
    return out;
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
            that (Line Item, Type) pair across every option — or clears it. Defaults persist with the page state.
          </li>
          <li>
            Alt-fee margin: for each alt-fee tag, the page sums <em>fee × unit count</em> over alt-fee rows
            sharing the tag (recurring rows are projected over the term with the annual escalator), then sums
            CTS over upper-table rows whose resolved Linked To matches the tag. <code>margin% = (fee − cost) / fee</code>.
          </li>
          <li>
            The bottom-of-page breakdown chart filters rows by the tag selected in its dropdown — only CTS rows
            whose resolved Linked To matches that tag contribute to the chart.
          </li>
          <li>
            Matching is case-insensitive and ignores surrounding whitespace.
          </li>
        </ul>
      </section>

      {!workbook ? (
        <div className={styles.linkedEmpty}>
          Upload a workbook on the <strong>Pricing</strong> subtab to see the live Linked To wiring.
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
            <h3 className={styles.linkedSubheading}>Saved defaults ({reachableDefaults.length})</h3>
            <p className={styles.linkedHint}>
              Defaults apply to any row matching the same Line Item + Type, on any option, unless that row has its own override.
            </p>
            {reachableDefaults.length === 0 ? (
              <div className={styles.linkedEmptyInline}>No saved defaults are reachable from rows on this option.</div>
            ) : (
              <table className={styles.linkedTable}>
                <thead>
                  <tr><th>Line Item</th><th>Type</th><th>Default Linked To</th></tr>
                </thead>
                <tbody>
                  {reachableDefaults.map(d => (
                    <tr key={d.key}>
                      <td>{d.lineItem}</td>
                      <td>{d.type || <span className={styles.linkedMuted}>—</span>}</td>
                      <td><code>{d.value}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

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
                      <td>{type || <span className={styles.linkedMuted}>—</span>}</td>
                      <td>
                        {override
                          ? <code>{override}</code>
                          : <span className={styles.linkedMuted}>(cleared — inherits nothing)</span>}
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
                  <tr><th>Tag</th><th>Source</th><th>Linked CTS rows</th></tr>
                </thead>
                <tbody>
                  {tagEntries.map(([tag, items]) => {
                    const lower = tag.toLowerCase();
                    const altMatch = Array.from(altTags).some(t => t.toLowerCase() === lower);
                    return (
                      <tr key={tag}>
                        <td><code>{tag}</code></td>
                        <td>
                          {altMatch && <span className={styles.linkedBadge}>alt-fee</span>}
                          {!altMatch && <span className={styles.linkedMuted}>CTS only</span>}
                        </td>
                        <td>
                          {items.length === 0
                            ? <span className={styles.linkedMuted}>none — alt-fee tag with no CTS rows linked</span>
                            : (
                              <ul className={styles.linkedRowList}>
                                {items.map(it => (
                                  <li key={it.id}>
                                    {it.description}
                                    <span className={styles.linkedMuted}> · {effectiveType(it)}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                        </td>
                      </tr>
                    );
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
  { key: 'cts',       label: 'CTS',               defaultWidth: 110 },
  { key: 'techDepr',  label: 'Tech Depr.',        defaultWidth: 110 },
  { key: 'start',     label: 'Start Month',       defaultWidth: 100 },
  { key: 'comments',  label: 'Comments',          defaultWidth: 280 },
  { key: 'gm',        label: 'GM%',               defaultWidth: 90 },
  { key: 'price',     label: 'Marked-up Price',   defaultWidth: 140 },
  { key: 'linkedTo',  label: 'Linked To',         defaultWidth: 200 },
];

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
// Bump this whenever the parser output shape changes — older cached
// parses are silently discarded on hydration so the user re-uploads
// against the current parser.
const PARSER_VERSION = 8;
// Sheet inside Pricing-page exports carrying a JSON snapshot of
// the full page state. Presence of this sheet on a dropped file
// switches the import path from fee-workbook parsing to state
// rehydration. The legacy double-underscore name is still accepted
// for any exports produced before the rename.
const STATE_SHEET_NAME = 'Pricing State';
const LEGACY_STATE_SHEET_NAMES = ['__pricing_state__'];

const fmtMoney = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
};

const fmtMoneyWhole = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
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
  const [chartTag, setChartTag] = useState(''); // selected line-item / tag for the breakdown chart
  const [chartView, setChartView] = useState('chart'); // 'chart' | 'table'
  const [techDeprPct, setTechDeprPct] = useState(0.04);
  const [colVisibility, setColVisibility] = useState({}); // upper table: { [colKey]: bool, default true }
  const [summaryColWidths, setSummaryColWidths] = useState({});
  const [summaryColVisibility, setSummaryColVisibility] = useState({});
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [summaryMenuOpen, setSummaryMenuOpen] = useState(false);
  const [pageSubtab, setPageSubtab] = useState('pricing'); // 'pricing' | 'linkedTo' | 'options'
  const [optionsTabData, setOptionsTabData] = useState(null); // OptionsTab state: array of { name, years, escPct, rows: [...] }
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
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
        if (typeof saved.chartTag === 'string') setChartTag(saved.chartTag);
        if (saved.chartView === 'chart' || saved.chartView === 'table') setChartView(saved.chartView);
        if (typeof saved.techDeprPct === 'number') setTechDeprPct(saved.techDeprPct);
        if (saved.colVisibility) setColVisibility(saved.colVisibility);
        if (saved.summaryColWidths) setSummaryColWidths(saved.summaryColWidths);
        if (saved.summaryColVisibility) setSummaryColVisibility(saved.summaryColVisibility);
        if (saved.pageSubtab === 'pricing' || saved.pageSubtab === 'linkedTo' || saved.pageSubtab === 'options') setPageSubtab(saved.pageSubtab);
        if (Array.isArray(saved.optionsTabData)) setOptionsTabData(saved.optionsTabData);
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
    const payload = { parserVersion: PARSER_VERSION, workbook, globalGmPct, overrides, activeOption, colWidths, altFees, linkedToDefaults, termMonths, annualEscalator, chartTag, chartView, techDeprPct, colVisibility, summaryColWidths, summaryColVisibility, pageSubtab, optionsTabData };
    dbPut(STORE, payload, KEY).catch(err => console.warn('Failed to save pricing cache:', err));
  }, [workbook, globalGmPct, overrides, activeOption, colWidths, altFees, linkedToDefaults, termMonths, annualEscalator, chartTag, chartView, techDeprPct, colVisibility, summaryColWidths, summaryColVisibility, pageSubtab, optionsTabData]);

  // Per-year cost contribution from a single upper-table CTS item.
  // Setup / One Time hit year 1 in full; Rolled variants amortize
  // evenly across the term and escalate; Recurring (monthly) bills
  // 12 months per year and escalates.
  function ctsItemYearCost(item, yearIndex) {
    if (typeof item.cts !== 'number') return 0;
    const t = effectiveType(item);
    const isRecurring = /recurring.*monthly|monthly.*recurring|^recurring/i.test(t);
    const isRolled = /\brolled\b/i.test(t);
    const yearStart = (yearIndex - 1) * 12 + 1;
    const yearEnd = yearIndex * 12;
    if (isRecurring) {
      const billStart = Math.max(yearStart, 1);
      const billEnd = Math.min(yearEnd, termMonths);
      if (billEnd < billStart) return 0;
      const months = billEnd - billStart + 1;
      const esc = Math.pow(1 + annualEscalator, yearIndex - 1);
      return item.cts * months * esc;
    }
    if (isRolled && termMonths > 0) {
      // Amortize CTS across the term, then bill each year's months at
      // an escalated monthly rate.
      const monthlyAmt = item.cts / termMonths;
      const billStart = Math.max(yearStart, 1);
      const billEnd = Math.min(yearEnd, termMonths);
      if (billEnd < billStart) return 0;
      const months = billEnd - billStart + 1;
      const esc = Math.pow(1 + annualEscalator, yearIndex - 1);
      return monthlyAmt * months * esc;
    }
    // Setup / One Time: lands entirely in Y1.
    return yearIndex === 1 ? item.cts : 0;
  }

  // Revenue from a single Alt Fee row in calendar year `yearIndex`
  // (1-based). Setup / One Time charges land in the year containing
  // their start month. Recurring (monthly) bills every month from
  // startMonth through termMonths, escalated each year.
  function altFeeYearRevenue(row, yearIndex) {
    const fee = Number(row.fee);
    const uc = Number(row.unitCount);
    if (!Number.isFinite(fee) || !Number.isFinite(uc) || uc <= 0) return 0;
    const startMonth = Math.max(1, Math.round(Number(row.startMonth) || 1));
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
      const fee = Number(r.fee);
      const uc = Number(r.unitCount);
      if (!Number.isFinite(fee) || !Number.isFinite(uc) || uc <= 0) return s;
      const isRecurring = /recurring/i.test(r.type || '');
      if (isRecurring) return s + projectMonthlyOverTerm(fee, annualEscalator, termMonths) * uc;
      return s + fee * uc;
    }, 0);
    if (totalFee <= 0) return null;

    const linked = [];
    for (const sec of opt.sections) {
      for (const item of sec.items) {
        if (resolvedLinkedTo(item).trim().toLowerCase() === target) linked.push(item);
      }
    }

    const totalCost = linked.reduce((s, item) => {
      if (typeof item.cts !== 'number') return s;
      const t = effectiveType(item);
      const isRecurring = /recurring.*monthly|monthly.*recurring|^recurring/i.test(t);
      const isRolled = /\brolled\b/i.test(t);
      if (isRecurring) return s + projectMonthlyOverTerm(item.cts, annualEscalator, termMonths);
      if (isRolled && termMonths > 0) return s + projectMonthlyOverTerm(item.cts / termMonths, annualEscalator, termMonths);
      return s + item.cts;
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
    if (s.workbook) setWorkbook(s.workbook);
    if (typeof s.globalGmPct === 'number') setGlobalGmPct(s.globalGmPct);
    setOverrides(s.overrides || {});
    if (typeof s.activeOption === 'number') setActiveOption(s.activeOption);
    else if (s.workbook?.options?.[0]?.optionNumber != null) setActiveOption(s.workbook.options[0].optionNumber);
    setColWidths(s.colWidths || {});
    setAltFees(s.altFees || {});
    setLinkedToDefaults(s.linkedToDefaults || {});
    if (typeof s.termMonths === 'number') setTermMonths(s.termMonths);
    if (typeof s.annualEscalator === 'number') setAnnualEscalator(s.annualEscalator);
    if (typeof s.chartTag === 'string') setChartTag(s.chartTag);
    if (s.chartView === 'chart' || s.chartView === 'table') setChartView(s.chartView);
    if (typeof s.techDeprPct === 'number') setTechDeprPct(s.techDeprPct);
    setColVisibility(s.colVisibility || {});
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
      altFees, linkedToDefaults, termMonths, annualEscalator,
      chartTag, chartView, techDeprPct, colVisibility,
      summaryColWidths, summaryColVisibility,
    };
    const json = JSON.stringify(snapshot);
    const CHUNK = 30000;
    const stateRows = [['DO NOT EDIT — Pricing page round-trip payload. Drop this workbook back onto the Pricing page to restore state.']];
    for (let i = 0; i < json.length; i += CHUNK) stateRows.push([json.slice(i, i + CHUNK)]);
    const stateWs = XLSX.utils.aoa_to_sheet(stateRows);
    XLSX.utils.book_append_sheet(wb, stateWs, STATE_SHEET_NAME);

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
        </div>
      )}

      {error && (
        <div style={{ margin: '0 1.25rem 0.5rem', color: '#b91c1c' }}>{error}</div>
      )}

      <PricingConversions />

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
      </div>

      {pageSubtab === 'linkedTo' && (
        <LinkedToPanel
          workbook={workbook}
          activeOption={activeOption}
          setActiveOption={setActiveOption}
          overrides={overrides}
          linkedToDefaults={linkedToDefaults}
          altFees={altFees}
          resolvedLinkedTo={resolvedLinkedTo}
          effectiveType={effectiveType}
          linkedToDefaultKey={linkedToDefaultKey}
        />
      )}

      {pageSubtab === 'options' && (
        <OptionsTab
          options={optionsTabData || []}
          setOptions={setOptionsTabData}
        />
      )}

      <div className={styles.body} style={pageSubtab !== 'pricing' ? { display: 'none' } : undefined}>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <ColumnsMenu
                      open={colMenuOpen}
                      onToggle={() => setColMenuOpen(o => !o)}
                      columns={COLS}
                      hiddenFn={colHidden}
                      onItemToggle={toggleColVisible}
                    />
                    {t && (
                      <div className={styles.optionSummary}>
                        <span>Cost: <span className={styles.summaryNum}>{fmtMoney(t.cost)}</span></span>
                        <span>Marked-up: <span className={styles.summaryNum}>{fmtMoney(t.price)}</span></span>
                      </div>
                    )}
                  </div>
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
                    if (typeof i.cts === 'number') acc.cost += i.cts;
                    if (typeof price === 'number') acc.price += price;

                    if (isRecurring) {
                      acc.termCost += projectMonthlyOverTerm(i.cts ?? null, annualEscalator, termMonths);
                      acc.termPrice += projectMonthlyOverTerm(price ?? null, annualEscalator, termMonths);
                    } else if (isRolled && termMonths > 0) {
                      const monthlyCost = typeof i.cts === 'number' ? i.cts / termMonths : null;
                      const monthlyPrice = typeof price === 'number' ? price / termMonths : null;
                      acc.termCost += projectMonthlyOverTerm(monthlyCost, annualEscalator, termMonths);
                      acc.termPrice += projectMonthlyOverTerm(monthlyPrice, annualEscalator, termMonths);
                    } else {
                      if (typeof i.cts === 'number') acc.termCost += i.cts;
                      if (typeof price === 'number') acc.termPrice += price;
                    }
                    return acc;
                  }, { cost: 0, price: 0, termCost: 0, termPrice: 0 });
                  const setup = sumByType(/^setup(\s+rolled)?$/i, false);
                  const recurring = sumByType(/recurring.*monthly|monthly.*recurring|^recurring/i, true);
                  const oneTime = sumByType(/^one\s*time(\s+rolled)?$/i, false);
                  const grandTermCost = setup.termCost + oneTime.termCost + recurring.termCost;
                  const grandTermPrice = setup.termPrice + oneTime.termPrice + recurring.termPrice;
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
                          {flatItems.map(item => {
                            const { gm, source, price } = priceFor(item);
                            const overrideVal = overrides[item.id]?.gmPct;
                            const techDepr = typeof item.cts === 'number' ? item.cts * techDeprPct : null;
                            return (
                              <tr key={item.id}>
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
                                          <option value="">—</option>
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
                                )}
                                {!colHidden('price') && <td className={styles.priceCell}>{fmtMoney(price)}</td>}
                                {!colHidden('linkedTo') && (
                                  <td>
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
                                        </div>
                                      );
                                    })()}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                          {(() => {
                            const totalDepr = flatItems.reduce((s, i) => s + (typeof i.cts === 'number' ? i.cts * techDeprPct : 0), 0);
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
                          const totalDeprAll = (setup.cost + recurring.cost + oneTime.cost) * techDeprPct;
                          return (
                            <table className={styles.summaryTable}>
                              <thead><tr>{renderHeaders()}</tr></thead>
                              <tbody>
                                {renderRow('Setup', { cost: setup.cost, techDepr: setup.cost * techDeprPct, totalCost: setup.cost * (1 + techDeprPct), price: setup.price, termPrice: setup.termPrice })}
                                {renderRow('Recurring (monthly)', { cost: recurring.cost, techDepr: recurring.cost * techDeprPct, totalCost: recurring.cost * (1 + techDeprPct), price: recurring.price, termPrice: recurring.termPrice })}
                                {(oneTime.cost > 0 || oneTime.price > 0) && renderRow('One Time', { cost: oneTime.cost, techDepr: oneTime.cost * techDeprPct, totalCost: oneTime.cost * (1 + techDeprPct), price: oneTime.price, termPrice: oneTime.termPrice })}
                                <tr className={styles.summaryGrandRow}>
                                  {SUMMARY_COLS.filter(c => !summaryColHidden(c.key)).map(col => {
                                    if (col.key === 'bucket') return <td key={col.key}>Total contract value</td>;
                                    const map = {
                                      cost: grandTermCost,
                                      techDepr: totalDeprAll,
                                      totalCost: grandTermCost + totalDeprAll,
                                      price: totalPrice,
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
                        // Time hit Y1 in full; Rolled variants
                        // amortize across the term so Y1 gets 12
                        // months' worth; Recurring (monthly) charges
                        // 12 months of cost in Y1 at face value
                        // (escalator only kicks in from Y2). If
                        // revenue − cost is negative, flag it.
                        const flatItems = opt.sections.flatMap(s => s.items);
                        const y1Cost = flatItems.reduce((acc, i) => {
                          const c = typeof i.cts === 'number' ? i.cts : 0;
                          if (!c) return acc;
                          const t = effectiveType(i);
                          const isRecurring = /recurring.*monthly|monthly.*recurring|^recurring/i.test(t);
                          const isRolled = /\brolled\b/i.test(t);
                          if (isRecurring) return acc + c * 12;
                          if (isRolled && termMonths > 0) return acc + (c / termMonths) * 12;
                          return acc + c;
                        }, 0);
                        const y1Revenue = (altFees[opt.optionNumber] || [])
                          .reduce((s, r) => s + altFeeYearRevenue(r, 1), 0);
                        const y1CashFlow = y1Revenue - y1Cost;
                        if (y1CashFlow >= 0) return null;
                        const fmtAbs = (n) => Math.abs(Math.round(n)).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
                        return (
                          <div className={styles.year1Warning} role="alert">
                            ⚠ Negative cash flow in Year 1 — projected revenue {fmtAbs(y1Revenue)} vs cost {fmtAbs(y1Cost)} (shortfall {fmtAbs(y1CashFlow)}). Consider restructuring fees or shifting Setup costs.
                          </div>
                        );
                      })()}

                      <AltFeeTable
                        rows={altFees[opt.optionNumber] || altFeeStarter()}
                        globalGmPct={globalGmPct}
                        marginFor={altFeeMarginFor}
                        yearRevenue={altFeeYearRevenue}
                        numYears={Math.max(1, Math.ceil(termMonths / 12))}
                        onChange={(idx, field, value) => updateAltFeeCell(opt.optionNumber, idx, field, value)}
                        onAddRow={() => addAltFeeRow(opt.optionNumber)}
                        onRemoveRow={(idx) => removeAltFeeRow(opt.optionNumber, idx)}
                        onReplaceRows={(rows) => replaceAltFeeRows(opt.optionNumber, rows)}
                        onAppendRows={(rows) => appendAltFeeRows(opt.optionNumber, rows)}
                      />
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
                          for (const it of sec.items) add(resolvedLinkedTo(it));
                        }
                        const tagOptions = [...seen.values()].sort((a, b) => a.localeCompare(b));
                        const tag = chartTag && seen.has(chartTag.toLowerCase())
                          ? seen.get(chartTag.toLowerCase())
                          : (tagOptions[0] || '');
                        const numYears = Math.max(1, Math.ceil(termMonths / 12));
                        const years = Array.from({ length: numYears }, (_, i) => i + 1);
                        const target = (tag || '').trim().toLowerCase();
                        const linkedItems = target
                          ? opt.sections.flatMap(s => s.items).filter(i => resolvedLinkedTo(i).trim().toLowerCase() === target)
                          : [];
                        const matchingAltRows = target
                          ? (altFees[opt.optionNumber] || []).filter(r => (r.altItem || '').trim().toLowerCase() === target)
                          : [];
                        const chartData = years.map(y => {
                          const cost = linkedItems.reduce((s, it) => s + ctsItemYearCost(it, y), 0);
                          const fee = matchingAltRows.reduce((s, r) => s + altFeeYearRevenue(r, y), 0);
                          return { year: `Y${y}`, Cost: Math.round(cost), Fee: Math.round(fee) };
                        });
                        return (
                          <div className={styles.chartPanel}>
                            <div className={styles.chartHeader}>
                              <h3 className={styles.summaryTitle} style={{ margin: 0 }}>Line item year-over-year</h3>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
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
                              </div>
                            </div>
                            {tag ? (
                              chartView === 'table' ? (
                                <table className={styles.summaryTable}>
                                  <thead>
                                    <tr>
                                      <th>Year</th>
                                      <th className={styles.numCell}>Cost</th>
                                      <th className={styles.priceCell}>Fee</th>
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
                                          <td className={styles.priceCell}>{margin === null ? '' : `${(margin * 100).toFixed(1)}%`}</td>
                                        </tr>
                                      );
                                    })}
                                    <tr className={styles.summaryGrandRow}>
                                      <td>Total</td>
                                      <td className={styles.numCell}>{fmtMoney(chartData.reduce((s, d) => s + d.Cost, 0))}</td>
                                      <td className={styles.priceCell}>{fmtMoney(chartData.reduce((s, d) => s + d.Fee, 0))}</td>
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
                                      <Tooltip formatter={(v) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} />
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
                            )}
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
    </div>
  );
}
