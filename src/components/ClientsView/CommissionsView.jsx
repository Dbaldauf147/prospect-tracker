import { useMemo, useState, useEffect, useCallback } from 'react';
import { DataTable } from '../common/DataTable';
import { asNumber, asDate, fmtCurrency, fmtPercent, fmtDate } from '../../utils/dealsFormat';
import {
  loadCommissions, saveCommissionsOverride, clearCommissionsOverride,
  COMMISSION_MONTH_NAMES,
} from '../../utils/commissionsStore';
import { CommissionsPasteImportModal, COMMISSIONS_CANONICAL, normProjectName } from './CommissionsPasteImportModal';
import { loadOppsFromCache, findOppByBfoLink } from '../../utils/oppsCache';

// Lookup columns the user adds at the front of the table. Account Name
// is an autocomplete against the Table View prospect roster; BFO Name is
// the BFO Opportunity Name the user pastes from the Opps tab; Scope is
// a read-only lookup that resolves BFO Name against the cached Opps
// records.
const ACCOUNT_NAME_KEY = 'Account Name';
const BFO_NAME_KEY = 'BFO Name';
const SCOPE_KEY = 'Scope';

// Shared <datalist> id for the Account Name autocomplete — every cell
// editor on the column points at this list via `list="..."`.
const ACCOUNT_NAME_LIST_ID = 'commissions-account-name-suggestions';
// Same idea for BFO Name: the editor points at this list, which is
// populated with every BFO Opportunity Name ("BFO Link") from the Opps
// tab so the user gets predictive matches instead of retyping the name.
const BFO_NAME_LIST_ID = 'commissions-bfo-name-suggestions';

// Inline cell editor: shows the formatted value, swaps to a text input on
// double-click, commits on Enter / blur, cancels on Escape. `listId`
// hooks the input up to a <datalist> for autocomplete (Account Name).
function EditableCell({ value, render, onSave, listId }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => {
    if (!editing) setDraft(value == null ? '' : String(value));
  }, [value, editing]);

  function commit(next) {
    onSave(next == null ? '' : String(next));
    setEditing(false);
  }

  if (!editing) {
    return (
      <span
        onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
        title="Double-click to edit"
        style={{ display: 'inline-block', width: '100%', cursor: 'text' }}
      >
        {render(value)}
      </span>
    );
  }

  return (
    <input
      autoFocus
      type="text"
      value={draft}
      list={listId}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(draft); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(value == null ? '' : String(value)); setEditing(false); }
      }}
      style={{
        width: '100%', padding: '0.15rem 0.3rem',
        border: '1px solid #3B82F6', borderRadius: 4,
        fontSize: '0.7rem', fontFamily: 'inherit', background: '#fff', color: '#1E293B',
        boxSizing: 'border-box',
      }}
    />
  );
}

// Month columns are year-agnostic — "January" is the January commission
// $, "January Revenue" is its underlying project revenue, and "FY
// Revenue" is the annual roll-up. Helpers recognize those keys when
// summing / formatting; data pasted under the legacy "<m>/1/<year>"
// shape gets migrated to month names on load by commissionsStore.
const MONTH_NAME_SET = new Set(COMMISSION_MONTH_NAMES);
function isMonthCommissionKey(k) { return MONTH_NAME_SET.has(String(k || '').trim()); }
function isMonthRevenueKey(k) {
  const s = String(k || '').trim();
  if (!s.endsWith(' Revenue')) return false;
  return MONTH_NAME_SET.has(s.slice(0, s.length - ' Revenue'.length));
}
function isFYRevenueKey(k) { return String(k || '').trim() === 'FY Revenue'; }

const FY_COMMISSION_KEY = 'FY Commission';
const PAYMENT_STATUS_KEY = 'Payment Status';
// Per-row "last updated" timestamp. Stored under a __-prefixed key so it
// rides along on the row without counting as a data cell (countFilledCells
// and the paste-dedup scoring both skip __-keys) and without ever showing
// up as a pasteable/bulk-editable canonical column. Written as an ISO
// string — asDate parses that directly, whereas a bare epoch number would
// be misread as an Excel serial date.
const UPDATED_AT_KEY = '__updatedAt';
function nowStamp() { return new Date().toISOString(); }

const CURRENCY_KEYS = new Set();
const DATE_KEYS = new Set(['Comm Start Date', 'Comm End Date']);
const PERCENT_KEYS = new Set(['%']);

function defaultWidth(k) {
  if (k === ACCOUNT_NAME_KEY) return 200;
  if (k === BFO_NAME_KEY) return 200;
  if (k === SCOPE_KEY) return 180;
  if (k === FY_COMMISSION_KEY) return 130;
  if (k === PAYMENT_STATUS_KEY) return 110;
  if (k === UPDATED_AT_KEY) return 130;
  if (k === 'Name') return 170;
  if (k === 'Project Name') return 280;
  if (DATE_KEYS.has(k)) return 120;
  if (PERCENT_KEYS.has(k)) return 70;
  if (isFYRevenueKey(k)) return 130;
  if (isMonthRevenueKey(k) || isMonthCommissionKey(k)) return 110;
  return 130;
}

// Sum every column on the row whose key matches `match`. Returns null
// when the row has no matching cells at all — the renderer falls back
// to a muted dash for that case so an empty roster row still reads as
// "no data" instead of "$0.00".
function sumMatchingCells(row, match) {
  let total = 0;
  let any = false;
  for (const k of Object.keys(row || {})) {
    if (!match(k)) continue;
    const n = asNumber(row[k]);
    if (n == null) continue;
    total += n;
    any = true;
  }
  return any ? total : null;
}

// "Are payments still rolling in or have they stopped?" — used by the
// Payment Status column. Prefers the explicit Comm End Date when set; if
// the row doesn't have one, falls back to the most recent non-zero
// monthly commission cell and compares it against today.
function paymentStatusFor(row) {
  const end = asDate(row?.['Comm End Date']);
  if (end) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const e = new Date(end); e.setHours(0, 0, 0, 0);
    if (e.getTime() < today.getTime()) {
      return { state: 'stopped', label: 'Stopped', title: `Comm End Date ${fmtDate(end)} is in the past` };
    }
    return { state: 'active', label: 'Active', title: `Comm End Date ${fmtDate(end)}` };
  }
  let lastIdx = -1;
  for (let i = 0; i < COMMISSION_MONTH_NAMES.length; i++) {
    const n = asNumber(row?.[COMMISSION_MONTH_NAMES[i]]);
    if (n != null && n !== 0) lastIdx = i;
  }
  if (lastIdx === -1) return { state: 'unknown', label: '—', title: 'No Comm End Date and no commission entries on file' };
  const todayMonthIdx = new Date().getMonth();
  if (lastIdx >= todayMonthIdx - 1) {
    return { state: 'active', label: 'Active', title: `Most recent commission: ${COMMISSION_MONTH_NAMES[lastIdx]}` };
  }
  return { state: 'stopped', label: 'Stopped', title: `Most recent commission: ${COMMISSION_MONTH_NAMES[lastIdx]} — no payments since` };
}

function PaymentStatusBadge({ state, label, title }) {
  const palette = state === 'active' ? { bg: '#DCFCE7', fg: '#166534' }
    : state === 'stopped' ? { bg: '#FEE2E2', fg: '#991B1B' }
    : { bg: '#F1F5F9', fg: '#64748B' };
  return (
    <span title={title} style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 4, background: palette.bg, color: palette.fg, fontWeight: 600, fontSize: '0.7rem' }}>
      {label}
    </span>
  );
}

// Plain-text cell used by Account Name / BFO Name / pasted Name fields.
function plainTextRender(v) {
  if (v == null || v === '') return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
  return <span>{String(v)}</span>;
}

// normProjectName (the dedup key) lives in CommissionsPasteImportModal so
// the paste preview and this merge classify duplicates identically — see
// the import there.

// How many "real" cells on this row carry a value. Used to pick the
// surviving row when two rows share a project name — whichever copy has
// more months / columns filled in beats the stale one.
function countFilledCells(row) {
  let n = 0;
  for (const k of Object.keys(row || {})) {
    if (k === 'id' || k.startsWith('__')) continue;
    const v = row[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s === '') continue;
    n++;
  }
  return n;
}

// Columns the user fills in by hand on top of the pasted roster, or
// that they can now paste in directly. The merge keeps a prior value
// whenever the incoming paste leaves the cell blank — so re-pasting
// refreshed commission data without an Account Name / BFO Name column
// doesn't wipe out the mapping the user already built up. When the
// incoming paste does provide a value, it wins.
const USER_MAPPED_KEYS = [ACCOUNT_NAME_KEY, BFO_NAME_KEY, SCOPE_KEY];

// Concatenate existing + newly-pasted commission rows and dedup by
// normalized Project Name. Rows without a project name pass through
// untouched (we have no key to group them by); for rows with one, the
// copy with more filled cells survives. Newer (incoming) rows win ties
// so a re-paste of an equally-filled row picks up any edits. The
// user-mapped lookup columns (Account Name, BFO Name, Scope) are
// always carried over from the existing row when there is one, since
// the paste source never includes them.
export function mergeAndDedupCommissions(existing, incoming) {
  const out = [];
  const winnerByKey = new Map();
  const existingByKey = new Map();
  function consider(row, isIncoming) {
    const key = normProjectName(row['Project Name']);
    if (!key) { out.push(row); return; }
    if (!isIncoming) existingByKey.set(key, row);
    const score = countFilledCells(row);
    const prev = winnerByKey.get(key);
    if (!prev || score > prev.score || (score === prev.score && isIncoming)) {
      winnerByKey.set(key, { row, score });
    }
  }
  for (const r of (existing || [])) consider(r, false);
  for (const r of (incoming || [])) consider(r, true);
  for (const [key, { row }] of winnerByKey.entries()) {
    const prior = existingByKey.get(key);
    if (prior && prior !== row) {
      const merged = { ...row };
      for (const k of USER_MAPPED_KEYS) {
        const incomingVal = row[k];
        const incomingHas = incomingVal != null && String(incomingVal).trim() !== '';
        if (incomingHas) continue;
        const priorVal = prior[k];
        if (priorVal != null && String(priorVal).trim() !== '') {
          merged[k] = priorVal;
        }
      }
      out.push(merged);
    } else {
      out.push(row);
    }
  }
  return out;
}

// Build the three lookup columns the user adds in front of the imported
// roster: Account Name (autocomplete from prospects), BFO Name (free
// text — the BFO Opportunity Name the user pastes), and Scope (read-only
// lookup that resolves BFO Name against the cached Opps records).
function buildFrontColumns(oppsCache) {
  return [
    {
      key: ACCOUNT_NAME_KEY,
      label: ACCOUNT_NAME_KEY,
      defaultWidth: defaultWidth(ACCOUNT_NAME_KEY),
      sticky: true,
      render: (row) => (
        <EditableCell
          value={row[ACCOUNT_NAME_KEY]}
          render={plainTextRender}
          onSave={(v) => row.__onUpdate?.(row.id, ACCOUNT_NAME_KEY, v)}
          listId={ACCOUNT_NAME_LIST_ID}
        />
      ),
      exportValue: (row) => row[ACCOUNT_NAME_KEY] ?? '',
    },
    {
      key: BFO_NAME_KEY,
      label: BFO_NAME_KEY,
      defaultWidth: defaultWidth(BFO_NAME_KEY),
      render: (row) => (
        <EditableCell
          value={row[BFO_NAME_KEY]}
          render={plainTextRender}
          onSave={(v) => row.__onUpdate?.(row.id, BFO_NAME_KEY, v)}
          listId={BFO_NAME_LIST_ID}
        />
      ),
      exportValue: (row) => row[BFO_NAME_KEY] ?? '',
    },
    {
      key: SCOPE_KEY,
      label: SCOPE_KEY,
      defaultWidth: defaultWidth(SCOPE_KEY),
      // Scope is derived from the Opps cache — sort and export off the
      // resolved value, not whatever (nothing) is stored on the row.
      getSortValue: (row) => {
        const opp = findOppByBfoLink(oppsCache, row[BFO_NAME_KEY]);
        return opp ? String(opp[SCOPE_KEY] || '') : '';
      },
      render: (row) => {
        const bfo = String(row[BFO_NAME_KEY] || '').trim();
        if (!bfo) return <span style={{ color: 'var(--color-text-muted)' }} title="Paste a BFO Opportunity Name in the previous column to look up its Scope">—</span>;
        const opp = findOppByBfoLink(oppsCache, bfo);
        if (!opp) return <span style={{ color: '#B91C1C' }} title="No Opps row matches this BFO Opportunity Name">no match</span>;
        const scope = String(opp[SCOPE_KEY] || '').trim();
        if (!scope) return <span style={{ color: 'var(--color-text-muted)' }} title="Matching Opps row has no Scope set">—</span>;
        return <span title={`From Opps row for "${bfo}"`}>{scope}</span>;
      },
      exportValue: (row) => {
        const opp = findOppByBfoLink(oppsCache, row[BFO_NAME_KEY]);
        return opp ? (opp[SCOPE_KEY] || '') : '';
      },
    },
  ];
}

// Pill-style currency cell used by the auto-summed FY Revenue / FY
// Commission columns so they read as derived totals, not editable cells.
function renderSumCell(total, emptyTitle, sumTitle) {
  if (total == null) {
    return <span style={{ color: 'var(--color-text-muted)' }} title={emptyTitle}>—</span>;
  }
  return (
    <span
      title={sumTitle}
      style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#0F172A', fontWeight: 600 }}
    >
      {fmtCurrency(total)}
    </span>
  );
}

// Columns the user can drive from the bulk-edit bar. Derived columns
// (Scope is read from the Opps cache, FY Revenue / FY Commission are
// summed at render time, Payment Status is computed) are excluded
// because setting them on a row wouldn't survive the next render.
function buildBulkEditableKeys() {
  const out = [
    ACCOUNT_NAME_KEY, BFO_NAME_KEY,
    'Name', 'Project Name',
    'Comm Start Date', 'Comm End Date', '%',
  ];
  for (const m of COMMISSION_MONTH_NAMES) out.push(`${m} Revenue`);
  for (const m of COMMISSION_MONTH_NAMES) out.push(m);
  return out;
}
const BULK_EDITABLE_KEYS = buildBulkEditableKeys();

// Bulk-edit toolbar. Pops in above the table whenever the user has
// at least one row selected. Picks a target column, takes a value,
// and routes the write through onApply / onDelete on the parent.
function BulkEditBar({ selectedCount, onApply, onDelete, onSetIgnored, onClearSelection }) {
  const [field, setField] = useState(BULK_EDITABLE_KEYS[0]);
  const [value, setValue] = useState('');
  return (
    <div style={{
      margin: '0 1.25rem 0.5rem', padding: '0.5rem 0.75rem',
      background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6,
      display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
      fontSize: '0.75rem', color: '#1E3A8A',
    }}>
      <strong>{selectedCount}</strong> selected · set
      <select
        value={field}
        onChange={(e) => setField(e.target.value)}
        style={{ padding: '0.25rem 0.4rem', border: '1px solid #93C5FD', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit', background: '#fff' }}
        title="Pick which column to set on every selected row"
      >
        {BULK_EDITABLE_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
      </select>
      to
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="value (leave blank to clear)"
        style={{ flex: 1, minWidth: 160, maxWidth: 320, padding: '0.25rem 0.4rem', border: '1px solid #93C5FD', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit', background: '#fff' }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onApply(field, value); setValue(''); }
        }}
      />
      <button
        type="button"
        onClick={() => { onApply(field, value); setValue(''); }}
        title={`Set ${field} = "${value}" on all ${selectedCount} selected rows`}
        style={{ padding: '0.3rem 0.7rem', border: 'none', borderRadius: 4, background: '#2563EB', color: '#fff', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
      >Apply</button>
      <button
        type="button"
        onClick={() => onApply(field, '')}
        title={`Clear ${field} on all ${selectedCount} selected rows`}
        style={{ padding: '0.3rem 0.7rem', border: '1px solid #93C5FD', borderRadius: 4, background: '#fff', color: '#1E3A8A', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}
      >Clear field</button>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        onClick={() => onSetIgnored?.(true)}
        title="Grey out every selected row (excluded from YOY totals)"
        style={{ padding: '0.3rem 0.7rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#334155', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}
      >Mark ignored</button>
      <button
        type="button"
        onClick={() => onSetIgnored?.(false)}
        title="Restore every selected row"
        style={{ padding: '0.3rem 0.7rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#334155', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}
      >Unignore</button>
      <button
        type="button"
        onClick={onDelete}
        title="Delete every selected row"
        style={{ padding: '0.3rem 0.7rem', border: '1px solid #FCA5A5', borderRadius: 4, background: '#fff', color: '#B91C1C', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
      >Delete selected</button>
      <button
        type="button"
        onClick={onClearSelection}
        title="Deselect every row"
        style={{ padding: '0.3rem 0.7rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}
      >Cancel</button>
    </div>
  );
}

// Per-row selection checkbox. Lives in its own sticky column on the
// far left of the table. The "select all" header is rendered by
// `buildSelectHeader` inside the component so it can close over the
// current visible-rows state setter.
function buildSelectCol(renderHeader) {
  return {
    key: '__select',
    label: '',
    defaultWidth: 36,
    sticky: true,
    renderHeader,
    render: (row) => (
      <input
        type="checkbox"
        checked={!!row.__isSelected}
        onClick={(e) => e.stopPropagation()}
        onChange={() => row.__onToggleSelect?.(row.id)}
        style={{ cursor: 'pointer' }}
        aria-label="Select row for bulk actions"
      />
    ),
    exportValue: () => '',
  };
}

function buildColumns(oppsCache, selectCol) {
  const front = buildFrontColumns(oppsCache);
  const canonical = COMMISSIONS_CANONICAL.map((k) => {
    const isCurrency = CURRENCY_KEYS.has(k) || isMonthRevenueKey(k) || isFYRevenueKey(k) || isMonthCommissionKey(k);
    const isDate = DATE_KEYS.has(k);
    const isPercent = PERCENT_KEYS.has(k);
    // FY Revenue is computed at render time from the 12 monthly revenue
    // cells to its left — the user wants a live total, not whatever was
    // pasted. Sort / export both follow the same computed number.
    if (isFYRevenueKey(k)) {
      return {
        key: k,
        label: k,
        defaultWidth: defaultWidth(k),
        getSortValue: (row) => sumMatchingCells(row, isMonthRevenueKey),
        render: (row) => renderSumCell(
          sumMatchingCells(row, isMonthRevenueKey),
          'No monthly revenue entries on this row',
          `Sum of the 12 monthly revenue cells across the year`,
        ),
        exportValue: (row) => sumMatchingCells(row, isMonthRevenueKey) ?? '',
      };
    }
    return {
      key: k,
      label: k,
      defaultWidth: defaultWidth(k),
      ...(isDate ? { getSortValue: (row) => { const d = asDate(row[k]); return d ? d.getTime() : null; } } : {}),
      ...(isCurrency || isPercent ? { getSortValue: (row) => asNumber(row[k]) } : {}),
      render: (row) => {
        const v = row[k];
        if (v == null || v === '') return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
        if (isCurrency) return <span style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtCurrency(v)}</span>;
        if (isPercent) return <span style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtPercent(v)}</span>;
        if (isDate) return <span style={{ color: '#334155' }}>{fmtDate(v)}</span>;
        return <span>{String(v)}</span>;
      },
      exportValue: (row) => {
        const v = row[k];
        if (v == null) return '';
        if (isCurrency || isPercent) {
          const n = asNumber(v);
          return n != null ? n : v;
        }
        return v;
      },
    };
  });
  // Mirror of the FY Revenue column, but summing the 12 monthly
  // commission cells — sits at the tail of the table where the user
  // wanted it. Followed by the derived Payment Status pill.
  const fyCommissionCol = {
    key: FY_COMMISSION_KEY,
    label: FY_COMMISSION_KEY,
    defaultWidth: defaultWidth(FY_COMMISSION_KEY),
    getSortValue: (row) => sumMatchingCells(row, isMonthCommissionKey),
    render: (row) => renderSumCell(
      sumMatchingCells(row, isMonthCommissionKey),
      'No monthly commission entries on this row',
      `Sum of the 12 monthly commission cells across the year`,
    ),
    exportValue: (row) => sumMatchingCells(row, isMonthCommissionKey) ?? '',
  };
  const paymentStatusCol = {
    key: PAYMENT_STATUS_KEY,
    label: PAYMENT_STATUS_KEY,
    defaultWidth: defaultWidth(PAYMENT_STATUS_KEY),
    getSortValue: (row) => paymentStatusFor(row).state,
    render: (row) => {
      const s = paymentStatusFor(row);
      return <PaymentStatusBadge state={s.state} label={s.label} title={s.title} />;
    },
    exportValue: (row) => paymentStatusFor(row).label,
  };
  // Read-only "Last Updated" column. Stamped whenever a row is edited
  // (single cell, bulk set, ignore toggle) or added / refreshed through a
  // paste import. Rows imported before this column existed have no stamp,
  // so they read as a muted dash until the next edit touches them. Sorts
  // on the raw timestamp; the tooltip shows the full local date + time.
  const updatedAtCol = {
    key: UPDATED_AT_KEY,
    label: 'Last Updated',
    defaultWidth: defaultWidth(UPDATED_AT_KEY),
    getSortValue: (row) => { const d = asDate(row[UPDATED_AT_KEY]); return d ? d.getTime() : null; },
    render: (row) => {
      const raw = row[UPDATED_AT_KEY];
      const d = asDate(raw);
      if (!d) return <span style={{ color: 'var(--color-text-muted)' }} title="No edits recorded yet — this row hasn't been changed since the Last Updated column was added">—</span>;
      return <span style={{ color: '#334155' }} title={`Last updated ${d.toLocaleString('en-US')}`}>{fmtDate(d)}</span>;
    },
    exportValue: (row) => { const d = asDate(row[UPDATED_AT_KEY]); return d ? fmtDate(d) : ''; },
  };
  // Trailing per-row delete cell. Lives in its own column so the user
  // can wipe a stale project without clearing every other row through
  // the Clear button.
  const deleteCol = {
    key: '__delete',
    label: '',
    defaultWidth: 44,
    render: (row) => (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const label = String(row['Project Name'] || row['Name'] || 'this row').trim() || 'this row';
          if (!window.confirm(`Delete "${label}" from the commissions roster?`)) return;
          row.__onDelete?.(row.id);
        }}
        title="Delete this row"
        style={{
          background: 'transparent', border: '1px solid var(--color-border)',
          color: '#B91C1C', borderRadius: 4, padding: '0 6px',
          fontSize: '0.78rem', fontFamily: 'inherit', cursor: 'pointer', lineHeight: 1.4,
        }}
      >×</button>
    ),
    exportValue: () => '',
  };
  // Per-row "ignore" toggle. Greys out the row everywhere it's rendered
  // without affecting the underlying data — useful for parking
  // intentionally-skipped projects (one-off corrections, refund rows,
  // duplicates) where the user wants a visual mute, not a delete.
  const ignoreCol = {
    key: '__ignored',
    label: '',
    defaultWidth: 64,
    render: (row) => {
      const on = !!row.__ignored;
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            row.__onToggleIgnore?.(row.id);
          }}
          title={on ? 'Row is ignored — click to restore.' : 'Mark this row as ignored (greys it out).'}
          style={{
            background: on ? '#E2E8F0' : 'transparent',
            border: '1px solid var(--color-border)',
            color: on ? '#475569' : '#64748B',
            borderRadius: 4, padding: '0 6px',
            fontSize: '0.72rem', fontFamily: 'inherit', cursor: 'pointer', lineHeight: 1.4,
            fontWeight: 600,
          }}
        >{on ? 'Ignored' : 'Ignore'}</button>
      );
    },
    exportValue: (row) => (row.__ignored ? 'Ignored' : ''),
  };
  return [selectCol, ...front, ...canonical, fyCommissionCol, paymentStatusCol, updatedAtCol, ignoreCol, deleteCol];
}

// A project row needs an Account Name tied to it. Flag it for the
// warning banner when it's a real project row (has a Project Name or a
// pasted Name), its Account Name cell is blank, and it hasn't been
// explicitly marked ignored — ignored rows are intentionally parked, so
// they never warn.
function isMissingAccountName(row) {
  if (!row || row.__ignored) return false;
  const project = String(row['Project Name'] ?? row['Name'] ?? '').trim();
  if (!project) return false;
  const account = String(row[ACCOUNT_NAME_KEY] ?? '').trim();
  return account === '';
}

export function CommissionsView({ settings, updateSettings, prospects = [] }) {
  const [{ data, source }, setStore] = useState(() => loadCommissions());
  const [search, setSearch] = useState('');
  // When on, the table narrows to just the rows the warning banner is
  // flagging (missing Account Name, not ignored) so the user can fix
  // them in one pass.
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [initialPaste, setInitialPaste] = useState('');
  // Transient result banner for the "Fill Account Names from BFO" action.
  const [fillStatus, setFillStatus] = useState('');
  // Cached Opps records, used by the Scope lookup column. Refreshes on
  // mount and when the window regains focus so pasting on the Opps tab
  // and switching back here reflects new entries without a reload.
  const [oppsCache, setOppsCache] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      loadOppsFromCache().then(c => { if (!cancelled) setOppsCache(c || null); }).catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, []);

  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'commissions-list-override') setStore(loadCommissions());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Page-level paste handler. When the user hits Ctrl/Cmd+V anywhere on
  // the Commissions tab — including the empty-state placeholder, the
  // toolbar, or the table — pop the import modal open with the
  // clipboard text pre-filled so they don't have to click Paste from
  // Excel first. Skipped while a real input / textarea has focus so the
  // search box and the modal's own textarea keep working normally.
  useEffect(() => {
    function onPaste(e) {
      if (showPaste) return;
      const ae = document.activeElement;
      const tag = ae && ae.tagName ? ae.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (ae && ae.isContentEditable)) return;
      const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
      if (!text || !text.trim()) return;
      e.preventDefault();
      setInitialPaste(text);
      setShowPaste(true);
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [showPaste]);

  // Selection state for the bulk-edit toolbar. Row "ids" are the raw
  // array indices on the underlying data; we clear the selection after
  // every bulk mutation so a shifted index never resurfaces as a
  // mis-targeted edit. `visibleIds` mirrors the rows the DataTable is
  // actually rendering (after both the search box and any in-table
  // column-filter chips have been applied), so the header "select all"
  // checkbox grabs only what the user can see.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [visibleIds, setVisibleIds] = useState([]);
  const onTableFilteredRowsChange = useCallback((tableRows) => {
    setVisibleIds(tableRows.map(r => r.id));
  }, []);

  const toggleSelect = (rowId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(prev => {
      const visible = visibleIds;
      const allSelected = visible.length > 0 && visible.every(id => prev.has(id));
      if (allSelected) {
        // Toggle off — clear just the visible ones, leave any
        // off-screen selection alone (the user can still see the count
        // and act on it via the toolbar).
        const next = new Set(prev);
        for (const id of visible) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visible) next.add(id);
      return next;
    });
  };

  // Closure-captured renderHeader so the select-all checkbox sees the
  // live selection state without forcing the column list to rebuild on
  // every toggle.
  const selectColHeader = () => {
    const visible = visibleIds;
    const allSelected = visible.length > 0 && visible.every(id => selectedIds.has(id));
    const someSelected = !allSelected && visible.some(id => selectedIds.has(id));
    return (
      <input
        type="checkbox"
        checked={allSelected}
        ref={(el) => { if (el) el.indeterminate = someSelected; }}
        onClick={(e) => e.stopPropagation()}
        onChange={selectAllVisible}
        style={{ cursor: 'pointer' }}
        title="Select / clear every row currently visible in the table"
      />
    );
  };

  const columns = useMemo(
    () => buildColumns(oppsCache, buildSelectCol(selectColHeader)),
    // selectColHeader closes over selectedIds. tableId depends only on
    // the column keys (stable), so re-creating the array on every
    // selection toggle re-renders the header without remounting the
    // table.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [oppsCache, selectedIds]
  );
  const tableId = useMemo(() => 'commissions:' + columns.map(c => c.key).sort().join('|'), [columns]);

  // Page-level autocomplete pool for the Account Name column —
  // mirrors the Deals tab's Client Name suggestions so the user gets
  // predictive matches against every company already in Table View.
  const accountNameSuggestions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const p of (prospects || [])) {
      const c = String(p?.company || '').trim();
      if (!c) continue;
      const k = c.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, [prospects]);

  // Predictive-text pool for the BFO Name column — every BFO Opportunity
  // Name ("BFO Link") on the cached Opps records. Deduped case-insensitively
  // and sorted; placeholder values ("-", blank, "#N/A") are dropped so the
  // list only offers real opp names to match Scope against.
  const bfoNameSuggestions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const r of (oppsCache?.records || [])) {
      const name = String(r?.['BFO Link'] ?? '').trim();
      if (!name || name === '-') continue;
      if (name.toUpperCase().startsWith('#N/A')) continue;
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(name);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, [oppsCache]);

  // Flip the __ignored flag on a row. A truthy flag greys the row out
  // everywhere it's rendered (and excludes it from the YOY commission
  // totals). Persisted via the same override store as every other
  // cell edit.
  function toggleIgnored(rowId) {
    const idx = Number(rowId);
    if (!Number.isFinite(idx)) return;
    setStore(prev => {
      const next = [...prev.data];
      const current = { ...(next[idx] || {}) };
      if (current.__ignored) delete current.__ignored;
      else current.__ignored = true;
      current[UPDATED_AT_KEY] = nowStamp();
      next[idx] = current;
      try { saveCommissionsOverride(next); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: next, source: 'override' };
    });
  }

  // Bulk version — set or clear __ignored on every selected row.
  function bulkSetIgnored(flag) {
    if (selectedIds.size === 0) return;
    setStore(prev => {
      const next = prev.data.map((row, i) => {
        if (!selectedIds.has(i)) return row;
        const out = { ...row };
        if (flag) out.__ignored = true;
        else delete out.__ignored;
        out[UPDATED_AT_KEY] = nowStamp();
        return out;
      });
      try { saveCommissionsOverride(next); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: next, source: 'override' };
    });
    setSelectedIds(new Set());
  }

  // Save a single cell back to localStorage / the in-memory data array.
  // Empty values delete the key entirely so empty cells render the muted
  // "—" placeholder. Mirrors the DealsView updateCell pattern.
  function updateCell(rowId, key, value) {
    const idx = Number(rowId);
    if (!Number.isFinite(idx)) return;
    setStore(prev => {
      const next = [...prev.data];
      const current = { ...(next[idx] || {}) };
      if (value === '' || value == null) delete current[key];
      else current[key] = value;
      current[UPDATED_AT_KEY] = nowStamp();
      next[idx] = current;
      try { saveCommissionsOverride(next); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: next, source: 'override' };
    });
  }

  // Drop a single row from the roster. Triggered by the trailing × cell
  // on each row; a confirm() prompt keeps a stray click from nuking a
  // project. Row ids are the raw array index so we splice the original
  // data array, not the filtered view.
  function deleteRow(rowId) {
    const idx = Number(rowId);
    if (!Number.isFinite(idx)) return;
    setStore(prev => {
      const next = [...prev.data];
      if (idx < 0 || idx >= next.length) return prev;
      next.splice(idx, 1);
      try { saveCommissionsOverride(next); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: next, source: 'override' };
    });
  }

  const rows = useMemo(
    () => data.map((r, i) => ({
      ...r,
      id: i,
      __onUpdate: updateCell,
      __onDelete: deleteRow,
      __onToggleIgnore: toggleIgnored,
      __isSelected: selectedIds.has(i),
      __onToggleSelect: toggleSelect,
    })),
    [data, selectedIds]
  );

  // Count of project rows missing an Account Name (and not ignored) —
  // drives the warning banner. Computed off the raw data so it reflects
  // the whole roster, not just the rows passing the current search /
  // filter.
  const missingAccountCount = useMemo(
    () => data.reduce((n, r) => n + (isMissingAccountName(r) ? 1 : 0), 0),
    [data],
  );

  // Once everything's been mapped (or ignored), drop out of the
  // "only missing" view so the table doesn't strand the user on an
  // empty list.
  useEffect(() => {
    if (missingAccountCount === 0 && showOnlyMissing) setShowOnlyMissing(false);
  }, [missingAccountCount, showOnlyMissing]);

  const filtered = useMemo(() => {
    let base = rows;
    if (showOnlyMissing) base = base.filter(isMissingAccountName);
    if (!search.trim()) return base;
    const term = search.toLowerCase();
    return base.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(term)));
  }, [rows, search, showOnlyMissing]);

  // Bulk mutations operate on the full underlying data array; row ids
  // are indices into that array, so we just rebuild it once. After
  // every mutation we wipe the selection so a stale index (rows have
  // shifted up or values have already been written) can't re-trigger
  // an edit on the wrong row.
  function bulkSet(key, rawValue) {
    if (!key) return;
    if (selectedIds.size === 0) return;
    setStore(prev => {
      const next = prev.data.map((row, i) => {
        if (!selectedIds.has(i)) return row;
        const out = { ...row };
        if (rawValue === '' || rawValue == null) delete out[key];
        else out[key] = rawValue;
        out[UPDATED_AT_KEY] = nowStamp();
        return out;
      });
      try { saveCommissionsOverride(next); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: next, source: 'override' };
    });
    setSelectedIds(new Set());
  }

  function bulkDelete() {
    if (selectedIds.size === 0) return;
    const n = selectedIds.size;
    if (!window.confirm(`Delete ${n} selected commission row${n === 1 ? '' : 's'}?`)) return;
    setStore(prev => {
      const next = prev.data.filter((_row, i) => !selectedIds.has(i));
      try { saveCommissionsOverride(next); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: next, source: 'override' };
    });
    setSelectedIds(new Set());
  }

  function handleImport(records) {
    setStore(prev => {
      // Stamp every incoming row with "now" as its Last Updated time.
      // Because the merge keeps each surviving row's own object, a row
      // that's actually added or refreshed by this paste carries the
      // fresh stamp, while an existing row that either wins the dedup or
      // isn't touched at all keeps its prior stamp — so an unrelated row
      // never looks freshly-updated just because a different row pasted.
      const stamp = nowStamp();
      const stamped = (records || []).map(r => ({ ...r, [UPDATED_AT_KEY]: stamp }));
      // Merge the freshly-pasted records into whatever's already on
      // file, then dedup by Project Name so re-pasting a refreshed
      // commission roster doesn't pile duplicate rows on top of the
      // existing data. When two rows share a project name, the one
      // with more filled cells (months / columns) wins — the user's
      // expectation is that the more complete snapshot survives.
      const merged = mergeAndDedupCommissions(prev.data || [], stamped);
      try { saveCommissionsOverride(merged); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: merged, source: 'override' };
    });
    setShowPaste(false);
  }

  function handleClear() {
    if (!window.confirm('Clear all imported commissions data?')) return;
    clearCommissionsOverride();
    setStore({ data: [], source: 'empty' });
  }

  // Populate the Account Name column from each row's BFO Name by resolving
  // it against the cached Opps records — the same BFO → Opp lookup the
  // Scope column uses, reading the matched Opp's Account. Only fills rows
  // whose Account Name is still blank so a manually-entered account is
  // never overwritten. Reports a short summary of what happened.
  function fillAccountNamesFromBfo() {
    if (!oppsCache?.records?.length) {
      setFillStatus('Opps data isn’t loaded yet — open the Opps tab once so the BFO → Account lookup has data, then try again.');
      return;
    }
    let filled = 0, alreadySet = 0, noMatch = 0;
    const next = data.map(row => {
      const bfo = String(row[BFO_NAME_KEY] || '').trim();
      if (!bfo) return row;
      const opp = findOppByBfoLink(oppsCache, bfo);
      const account = opp ? String(opp['Account'] || '').trim() : '';
      if (!account) { noMatch++; return row; }
      if (String(row[ACCOUNT_NAME_KEY] || '').trim()) { alreadySet++; return row; }
      filled++;
      return { ...row, [ACCOUNT_NAME_KEY]: account };
    });
    if (filled > 0) {
      try { saveCommissionsOverride(next); } catch (err) { console.warn('Save commissions failed', err); }
      setStore({ data: next, source: 'override' });
    }
    const parts = [`Filled ${filled} account name${filled === 1 ? '' : 's'} from BFO matches`];
    if (alreadySet > 0) parts.push(`${alreadySet} row${alreadySet === 1 ? '' : 's'} already had an account`);
    if (noMatch > 0) parts.push(`${noMatch} BFO name${noMatch === 1 ? '' : 's'} had no Opps match`);
    setFillStatus(parts.join(' · ') + '.');
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Predictive-text source for every Account Name cell. Rendered
          once at the view level so each EditableCell input just points
          at it via list="..." — matches the Deals tab pattern. */}
      <datalist id={ACCOUNT_NAME_LIST_ID}>
        {accountNameSuggestions.map(name => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {/* Predictive-text source for every BFO Name cell — the BFO
          Opportunity Names ("BFO Link") pulled from the Opps tab. */}
      <datalist id={BFO_NAME_LIST_ID}>
        {bfoNameSuggestions.map(name => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1E293B' }}>Commissions</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '0.15rem' }}>
            {rows.length === 0
              ? 'Paste your monthly commission roster from Excel — the next step maps each pasted column to a destination.'
              : `${rows.length} commission row${rows.length === 1 ? '' : 's'} on file.`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setShowPaste(true)}
            title="Paste tab-separated rows copied from Excel. The next step lets you confirm which pasted column maps to each commission field."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid #16A34A', background: '#16A34A', color: '#fff', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >Paste from Excel</button>
          {rows.length > 0 && (
            <button
              type="button"
              onClick={fillAccountNamesFromBfo}
              title="Look up each row's BFO Name against the cached Opps records and fill in the matching Opp's Account for any row whose Account Name is still blank."
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #3B82F6', background: 'white', color: '#2563EB', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >Fill Account Names from BFO</button>
          )}
          {source === 'override' && (
            <button
              type="button"
              onClick={handleClear}
              title="Remove the imported commissions list"
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >Clear</button>
          )}
        </div>
      </div>
      {fillStatus && (
        <div style={{ padding: '0 1.25rem 0.5rem', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, color: '#1E3A8A', fontSize: '0.75rem' }}>
            <span style={{ flex: 1 }}>{fillStatus}</span>
            <button type="button" onClick={() => setFillStatus('')} aria-label="Dismiss" style={{ background: 'transparent', border: 'none', color: '#1E3A8A', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>
        </div>
      )}

      <div style={{ padding: '0 1.25rem 0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter commissions…"
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
          {filtered.length} of {rows.length}
        </span>
      </div>

      {missingAccountCount > 0 && (
        <div
          role="alert"
          style={{
            margin: '0 1.25rem 0.5rem', padding: '0.5rem 0.75rem',
            background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 6,
            display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
            fontSize: '0.75rem', color: '#92400E',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: '0.9rem' }}>⚠️</span>
          <span>
            <strong>{missingAccountCount}</strong> project{missingAccountCount === 1 ? '' : 's'} {missingAccountCount === 1 ? 'has' : 'have'} no <strong>Account Name</strong> tied to {missingAccountCount === 1 ? 'it' : 'them'} and {missingAccountCount === 1 ? "isn't" : "aren't"} marked ignored.
          </span>
          <span style={{ color: '#B45309' }}>Add an Account Name, or mark the row ignored, to clear this.</span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setShowOnlyMissing(v => !v)}
            title={showOnlyMissing ? 'Show every commission row again' : 'Filter the table down to just the flagged rows'}
            style={{ padding: '0.3rem 0.7rem', border: '1px solid #D97706', borderRadius: 4, background: showOnlyMissing ? '#D97706' : '#fff', color: showOnlyMissing ? '#fff' : '#92400E', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
          >{showOnlyMissing ? 'Show all rows' : 'Show only these'}</button>
        </div>
      )}

      {selectedIds.size > 0 && (
        <BulkEditBar
          selectedCount={selectedIds.size}
          onApply={bulkSet}
          onDelete={bulkDelete}
          onSetIgnored={bulkSetIgnored}
          onClearSelection={() => setSelectedIds(new Set())}
        />
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {rows.length === 0 ? (
          <div style={{ margin: '0 1.25rem', padding: '1.25rem', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569', textAlign: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>No commissions yet</div>
            <div style={{ fontSize: '0.78rem' }}>
              Click <strong>Paste from Excel</strong> to drop in copied commission rows. The popup will map each pasted column (Name, Account Name, BFO Name, Project Name, monthly revenue, monthly commission…) onto its destination.
            </div>
          </div>
        ) : (
          <DataTable
            key={tableId}
            tableId={tableId}
            columns={columns}
            rows={filtered}
            emptyMessage={search ? `No rows match "${search}"` : 'No commissions to display'}
            enableColumnFilters
            rowStyle={(row) => row.__ignored ? { opacity: 0.45, background: '#F8FAFC', color: '#64748B' } : undefined}
            onFilteredRowsChange={onTableFilteredRowsChange}
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
      </div>

      {showPaste && (
        <CommissionsPasteImportModal
          onClose={() => { setShowPaste(false); setInitialPaste(''); }}
          onImport={(records) => { handleImport(records); setInitialPaste(''); }}
          initialPaste={initialPaste}
          existingRows={data}
        />
      )}
    </div>
  );
}
