import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { DataTable } from '../common/DataTable';
import { asNumber, asDate, fmtCurrency, fmtPercent, fmtDate } from '../../utils/dealsFormat';
import {
  loadCommissions, saveCommissionsOverride, clearCommissionsOverride,
  COMMISSION_MONTH_NAMES, COMMISSIONS_LIST_EVENT,
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
const DAYS_SINCE_PAYMENT_KEY = 'Days Since Last Payment';
const LAST_PAYMENT_DATE_KEY = 'Last Payment Date';
// Per-row "last updated" timestamp. Stored under a __-prefixed key so it
// rides along on the row (the paste merge carries __-keys over like any
// other cell) without ever showing up as a pasteable/bulk-editable
// canonical column. Written as an ISO string — asDate parses that directly,
// whereas a bare epoch number would be misread as an Excel serial date.
const UPDATED_AT_KEY = '__updatedAt';
function nowStamp() { return new Date().toISOString(); }

const CURRENCY_KEYS = new Set();
const DATE_KEYS = new Set(['Comm Start Date', 'Comm End Date']);
const PERCENT_KEYS = new Set(['%']);

// Month/period cells a "replace months" import clears before overlaying the
// paste — the 12 revenue columns, the 12 commission columns, and the stored
// FY Revenue (recomputed from the months at render time anyway). Identity
// and user-mapped columns (Comm dates, %, Account/BFO/Scope, Name) are not
// period cells, so they survive a replace.
const PERIOD_KEYS = new Set(['FY Revenue']);
for (const m of COMMISSION_MONTH_NAMES) { PERIOD_KEYS.add(`${m} Revenue`); PERIOD_KEYS.add(m); }

function defaultWidth(k) {
  if (k === ACCOUNT_NAME_KEY) return 200;
  if (k === BFO_NAME_KEY) return 200;
  if (k === SCOPE_KEY) return 180;
  if (k === FY_COMMISSION_KEY) return 130;
  if (k === PAYMENT_STATUS_KEY) return 110;
  if (k === DAYS_SINCE_PAYMENT_KEY) return 150;
  if (k === LAST_PAYMENT_DATE_KEY) return 140;
  if (k === UPDATED_AT_KEY) return 130;
  if (k === 'Name') return 170;
  if (k === 'Project Name') return 280;
  if (DATE_KEYS.has(k)) return 120;
  if (PERCENT_KEYS.has(k)) return 70;
  if (isFYRevenueKey(k)) return 130;
  if (isMonthRevenueKey(k) || isMonthCommissionKey(k)) return 110;
  return 130;
}

// Fiscal-year awareness. The 12 month columns are plain calendar months
// (January…December), but a commission runs on its own fiscal window —
// Griffis, for instance, is 7/1/2025 → 6/30/2026, a July-through-June year
// that straddles two calendar years. These helpers key off the row's Comm
// Start / Comm End dates so the FY roll-ups reflect that window instead of
// blindly summing whichever calendar cells happen to be populated.

// The set of calendar-month indices (0 = January … 11 = December) that fall
// inside a row's commission window. A window spanning 12+ months (the usual
// full-year deal) covers every month, so we return null and let the caller
// count them all. A shorter window (e.g. a single-month non-recurring deal)
// returns just the months from the start month forward, wrapping across the
// year boundary. Returns null when either date is missing or unparseable so
// the FY total falls back to summing every populated month.
function fiscalWindowMonths(row) {
  const start = asDate(row?.['Comm Start Date']);
  const end = asDate(row?.['Comm End Date']);
  if (!start || !end) return null;
  const s = new Date(start);
  const e = new Date(end);
  if (e.getTime() < s.getTime()) return null;
  // Whole months spanned, inclusive of both endpoints' months.
  const monthSpan = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
  if (monthSpan >= 12) return null; // full fiscal year (or longer) → all months
  const set = new Set();
  for (let i = 0; i < monthSpan; i++) set.add((s.getMonth() + i) % 12);
  return set;
}

// Fiscal-year roll-up: sum the monthly cells that fall inside the row's
// commission window. `revenue` picks the "<Month> Revenue" columns; false
// picks the "<Month>" commission columns. When the window can't be pinned
// down (no / bad Comm dates) or spans a full year, every month counts —
// matching the previous "sum all 12" behavior. Returns null when no
// in-window month carries a value so the cell renders a muted dash.
function sumFiscalMonths(row, revenue) {
  const window = fiscalWindowMonths(row);
  let total = 0;
  let any = false;
  for (let i = 0; i < COMMISSION_MONTH_NAMES.length; i++) {
    if (window && !window.has(i)) continue;
    const key = revenue ? `${COMMISSION_MONTH_NAMES[i]} Revenue` : COMMISSION_MONTH_NAMES[i];
    const n = asNumber(row?.[key]);
    if (n == null) continue;
    total += n;
    any = true;
  }
  return any ? total : null;
}

// Calendar-month index (0 = January … 11 = December) behind a month column
// key — "March" → 2, "March Revenue" → 2. Returns -1 for non-month keys.
function monthIndexForKey(k) {
  const s = String(k || '').trim();
  const base = isMonthRevenueKey(k) ? s.slice(0, s.length - ' Revenue'.length) : s;
  return COMMISSION_MONTH_NAMES.indexOf(base);
}

// Is this an upcoming month that simply hasn't happened yet? True only when
// the current calendar year is genuinely relevant to the row's commission —
// i.e. the deal has a commission window, hasn't already ended, and doesn't
// start in a later year — AND the month is (a) later in the year than the
// current month and (b) inside the deal's fiscal window. Those cells render
// a greyed "-" so an unpaid future month reads as "not yet" rather than a
// real $0 or missing data. A commission that already ended, hasn't started,
// or has no dates at all has no pending months and is left untouched.
function isPendingFutureMonth(row, monthIdx) {
  if (monthIdx < 0) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  // Only months strictly after the current one count as "not happened yet".
  if (monthIdx <= today.getMonth()) return false;
  const start = asDate(row?.['Comm Start Date']);
  const end = asDate(row?.['Comm End Date']);
  // Need a commission window to assert the current year applies to this row.
  if (!start && !end) return false;
  // Commission already ended → nothing more is coming.
  if (end) { const e = new Date(end); e.setHours(0, 0, 0, 0); if (e.getTime() < today.getTime()) return false; }
  // Commission starts in a future year → the current year isn't relevant yet.
  if (start && start.getFullYear() > today.getFullYear()) return false;
  // Respect the deal's fiscal window: a future month outside the window
  // isn't a pending payment month for this deal.
  const window = fiscalWindowMonths(row);
  if (window && !window.has(monthIdx)) return false;
  return true;
}

// A commission paid this recently keeps a row Active even after its Comm
// End Date has passed: a recent payment wins over a closed/stale end date.
// ~2 months, so a deal that paid last month still reads Active this month.
const RECENT_PAYMENT_DAYS = 62;

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
      // End date has passed — but if a commission was actually paid in the
      // last ~2 months, keep the row Active anyway. lastPaymentDate resolves
      // the real year of the most recent monthly cell, and sources
      // 'month'/'ended' mean the date came from an actual paid month (not a
      // bare date field), so a prior-year row's stale month value can't fake
      // a recent payment.
      const last = lastPaymentDate(row);
      const fromPaidMonth = last && (last.source === 'month' || last.source === 'ended');
      if (fromPaidMonth) {
        const diffDays = Math.round((today.getTime() - last.date.getTime()) / 86400000);
        if (diffDays >= 0 && diffDays <= RECENT_PAYMENT_DAYS) {
          return {
            state: 'active',
            label: 'Active',
            title: `Last commission ${last.label} (${diffDays} day${diffDays === 1 ? '' : 's'} ago): recent, so Active even though Comm End Date ${fmtDate(end)} has passed`,
          };
        }
      }
      return {
        state: 'stopped',
        label: 'Stopped',
        title: fromPaidMonth
          ? `Comm End Date ${fmtDate(end)} is in the past; last commission ${last.label}`
          : `Comm End Date ${fmtDate(end)} is in the past`,
      };
    }
    return { state: 'active', label: 'Active', title: `Comm End Date ${fmtDate(end)}` };
  }
  // No Comm End Date. If there's no Comm Start Date either, the commission has
  // no date window on file — so we never infer Active from monthly cells. An
  // undated commission reads as unknown ("—", not Active and not asserted
  // Stopped) until a Comm Start and/or End Date is entered.
  const start = asDate(row?.['Comm Start Date']);
  let lastIdx = -1;
  for (let i = 0; i < COMMISSION_MONTH_NAMES.length; i++) {
    const n = asNumber(row?.[COMMISSION_MONTH_NAMES[i]]);
    if (n != null && n !== 0) lastIdx = i;
  }
  if (!start) {
    return {
      state: 'unknown',
      label: '-',
      title: lastIdx === -1
        ? 'No Comm Start or End Date and no commission entries on file'
        : `No Comm Start or End Date on file: not marked Active (most recent commission ${COMMISSION_MONTH_NAMES[lastIdx]})`,
    };
  }
  if (lastIdx === -1) return { state: 'unknown', label: '-', title: 'No Comm End Date and no commission entries on file' };
  const todayMonthIdx = new Date().getMonth();
  if (lastIdx >= todayMonthIdx - 1) {
    return { state: 'active', label: 'Active', title: `Most recent commission: ${COMMISSION_MONTH_NAMES[lastIdx]}` };
  }
  return { state: 'stopped', label: 'Stopped', title: `Most recent commission: ${COMMISSION_MONTH_NAMES[lastIdx]}: no payments since` };
}

// Date the last commission payment on a row, from every dated signal it
// carries: the year-agnostic monthly commission cells plus the Comm Start
// Date / Comm End Date. The latest month with a value gives the *month* of
// the last payment; the commission window gives the *year*.
//
//  - Ended commission (Comm End Date in the past): anchor the last-paid
//    month to the end date's year and never let it land after the end date
//    itself. This keeps an old row (e.g. a 2023 Comm End Date) from
//    resolving its month into the current year and reading as a payment
//    that just happened.
//  - Open commission (end date in the future, or none): the month resolves
//    to its most-recent occurrence relative to today.
//  - No monthly cells at all: fall back to a past Comm End Date, then a
//    past Comm Start Date.
//
// Returns null when nothing datable is on the row. Each result's `date` is
// a JS Date at local midnight; `label` describes where it came from.
function lastPaymentDate(row) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const start = asDate(row?.['Comm Start Date']);
  const end = asDate(row?.['Comm End Date']);
  const startMid = start ? midnight(start) : null;
  const endMid = end ? midnight(end) : null;
  const endPast = endMid && endMid.getTime() <= today.getTime();

  // Day 0 of the following month is the last calendar day of this one.
  const endOfMonth = (idx, year) => midnight(new Date(year, idx + 1, 0));

  // Resolve a single year-agnostic month cell to the actual calendar date it
  // most likely represents. Kept per-month so the *most recent real date* can
  // win below, rather than the highest month index: a contract that straddles
  // a year boundary parks its recent months (Jan–Jun) at low indices and its
  // older months (Oct–Dec) at high indices, so picking by index alone
  // back-dates the result by a year.
  const resolveMonth = (idx) => {
    if (endPast) {
      let d = endOfMonth(idx, endMid.getFullYear());
      if (d.getTime() > endMid.getTime()) d = endMid;                 // never past the close
      if (startMid && d.getTime() < startMid.getTime()) d = endMid;   // month predates the window → use the close
      return { date: d, label: `${COMMISSION_MONTH_NAMES[idx]} ${d.getFullYear()}`, source: 'ended' };
    }
    // Open window: resolve to the month's most-recent occurrence at or before
    // the current month (this year if it has already come round, else last).
    const year = idx <= today.getMonth() ? today.getFullYear() : today.getFullYear() - 1;
    return { date: endOfMonth(idx, year), label: COMMISSION_MONTH_NAMES[idx], source: 'month' };
  };

  // Among every non-zero month cell, keep the one whose resolved date is the
  // most recent. Ties (e.g. several months clamped to a past Comm End Date)
  // fall to the highest index via >=, matching the old "last cell wins" pick.
  let best = null;
  for (let i = 0; i < COMMISSION_MONTH_NAMES.length; i++) {
    const n = asNumber(row?.[COMMISSION_MONTH_NAMES[i]]);
    if (n == null || n === 0) continue;
    const cand = resolveMonth(i);
    if (!best || cand.date.getTime() >= best.date.getTime()) best = cand;
  }
  if (best) return best;

  if (endPast) return { date: endMid, label: `Comm End Date ${fmtDate(end)}`, source: 'end' };
  if (startMid && startMid.getTime() <= today.getTime()) {
    return { date: startMid, label: `Comm Start Date ${fmtDate(start)}`, source: 'start' };
  }
  return null;
}

// Sentinel "days since last payment" for rows with no commission window on
// file (both Comm Start Date and Comm End Date blank). A large fixed count
// sinks them to the bottom of the default ascending sort instead of mixing
// them in with genuinely-dated rows.
const NO_COMM_DATES_DAYS = 1000;

// Whole days between the last payment and today, or null when the row has
// no datable payment. Clamped at 0 so a payment dated to the current
// (not-yet-closed) month reads as "0" rather than a negative count.
function daysSinceLastPayment(row) {
  // No commission dates at all → treat as NO_COMM_DATES_DAYS so the row
  // parks at the bottom of the list. This wins over any monthly-cell date
  // so a row without a commission window never reads as recently paid.
  const hasStart = !!asDate(row?.['Comm Start Date']);
  const hasEnd = !!asDate(row?.['Comm End Date']);
  if (!hasStart && !hasEnd) {
    return { days: NO_COMM_DATES_DAYS, info: { source: 'none', label: 'No Comm Start or End Date' } };
  }
  const info = lastPaymentDate(row);
  if (!info) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(info.date); d.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  return { days: Math.max(0, diff), info };
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
  if (v == null || v === '') return <span style={{ color: 'var(--color-text-muted)' }}>-</span>;
  return <span>{String(v)}</span>;
}

// normProjectName (the dedup key) lives in CommissionsPasteImportModal so
// the paste preview and this merge classify duplicates identically — see
// the import there.

// Concatenate existing + newly-pasted commission rows and dedup by
// normalized Project Name. Rows without a project name pass through
// untouched (we have no key to group them by).
//
// Rows that share a project name are merged CELL BY CELL rather than
// picking one whole row and discarding the other. This matters because a
// commission's fiscal year straddles two calendar years (Griffis runs
// 7/1/2025 → 6/30/2026, so its revenue lands in July–December one paste and
// January–June the next), and the 12 columns here are plain calendar
// months. Under the old "whichever copy has more filled cells wins" rule,
// re-pasting the second half either clobbered the first half's months or —
// because the on-file row also carries the hand-added Account Name / BFO
// Name / Scope — lost to the existing row and dropped the fresh figures
// entirely. Unioning fills each month into its own calendar slot so the
// full fiscal year assembles across successive snapshot pastes.
//
// Merge rule per cell: a non-blank incoming value wins (so a corrected
// month or a freshly-pasted one updates in place); a blank incoming value
// leaves the existing value alone (so months this snapshot didn't include —
// and the user-mapped Account Name / BFO Name / Scope the paste never
// carries — are preserved). The existing row seeds the base, so its
// __ignored flag and any earlier months ride along untouched.
//
// `replaceMonths` flips the month-handling for projects the paste touches:
// the existing row's month/period cells (PERIOD_KEYS) are cleared first, so
// only the months in this paste survive — a clean per-project reset without
// deleting the row and losing its Account Name / BFO Name / Scope. Identity
// columns (Comm dates, %, Name) and the user-mapped lookups are never period
// cells, so they still ride along. Projects the paste doesn't mention are
// untouched either way.
export function mergeAndDedupCommissions(existing, incoming, { replaceMonths = false } = {}) {
  const isBlank = (v) => v == null || String(v).trim() === '';
  // Overlay `addition`'s non-blank cells onto `base`, returning a new row.
  const unionInto = (base, addition) => {
    const merged = { ...base };
    for (const [k, v] of Object.entries(addition)) {
      if (isBlank(v)) continue;
      merged[k] = v;
    }
    return merged;
  };

  const out = [];
  const order = [];               // keyed projects, in first-seen order
  const existingByKey = new Map();
  const incomingByKey = new Map();
  const noteKey = (key) => { if (!existingByKey.has(key) && !incomingByKey.has(key)) order.push(key); };
  // Rows that repeat a Project Name *within this single paste*. The first
  // copy of a project merges/updates the on-file row as usual; a genuine
  // second copy in the same paste is two distinct deals that happen to share
  // a name, so it's kept as its own row (appended below) instead of being
  // unioned away. The table flags these live so they read differently — see
  // duplicateIdsFrom / rowStyle in CommissionsView.
  const pasteDuplicates = [];

  // Existing rows seed the base (and lead the output order); incoming rows
  // are gathered separately so a "replace months" import can wipe the base's
  // months before overlaying only what this paste carries.
  for (const row of (existing || [])) {
    const key = normProjectName(row['Project Name']);
    if (!key) { out.push(row); continue; }   // no key to group by → keep as-is
    noteKey(key);
    existingByKey.set(key, unionInto(existingByKey.get(key) || {}, row));
  }
  for (const row of (incoming || [])) {
    const key = normProjectName(row['Project Name']);
    if (!key) { out.push(row); continue; }
    if (incomingByKey.has(key)) {
      // Second (or later) occurrence of this project in the same paste →
      // preserve it as a separate row rather than collapsing the two.
      pasteDuplicates.push({ ...row });
      continue;
    }
    noteKey(key);
    incomingByKey.set(key, unionInto({}, row));
  }

  for (const key of order) {
    const base = existingByKey.get(key) || {};
    const add = incomingByKey.get(key);
    if (!add) { out.push(base); continue; }   // project not in this paste → untouched
    let seed = base;
    if (replaceMonths) {
      seed = {};
      for (const [k, v] of Object.entries(base)) {
        if (PERIOD_KEYS.has(k)) continue;     // drop existing months; paste repopulates
        seed[k] = v;
      }
    }
    out.push(unionInto(seed, add));
  }
  // Append the genuine within-paste duplicates last so they land right after
  // the roster they duplicate.
  out.push(...pasteDuplicates);
  return out;
}

// Indices of rows that duplicate an earlier row's Project Name, computed off
// the underlying data order so the flag is stable regardless of how the table
// is sorted. The first occurrence of a name is the "original" (never flagged);
// every later row that repeats it is the duplicate. Blank Project Names are
// never flagged — there's no name to collide on.
function duplicateIdsFrom(data) {
  const seen = new Set();
  const dupes = new Set();
  for (let i = 0; i < (data?.length || 0); i++) {
    const key = normProjectName(data[i]?.['Project Name']);
    if (!key) continue;
    if (seen.has(key)) dupes.add(i);
    else seen.add(key);
  }
  return dupes;
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
      // The Scope column renders nothing to the row object (it's a live
      // lookup), so the in-table column filter has to resolve the same
      // displayed string here — otherwise the filter dropdown sees only
      // blanks. Mirrors the render branches: '' when there's no BFO Name,
      // 'no match' when the BFO Name resolves to no Opps row, else the
      // matched Scope. Lets the user filter the column down to "no match".
      getFilterValue: (row) => {
        const bfo = String(row[BFO_NAME_KEY] || '').trim();
        if (!bfo) return '';
        const opp = findOppByBfoLink(oppsCache, bfo);
        if (!opp) return 'no match';
        return String(opp[SCOPE_KEY] || '').trim();
      },
      render: (row) => {
        const bfo = String(row[BFO_NAME_KEY] || '').trim();
        if (!bfo) return <span style={{ color: 'var(--color-text-muted)' }} title="Paste a BFO Opportunity Name in the previous column to look up its Scope">-</span>;
        const opp = findOppByBfoLink(oppsCache, bfo);
        if (!opp) return <span style={{ color: '#B91C1C' }} title="No Opps row matches this BFO Opportunity Name">no match</span>;
        const scope = String(opp[SCOPE_KEY] || '').trim();
        if (!scope) return <span style={{ color: 'var(--color-text-muted)' }} title="Matching Opps row has no Scope set">-</span>;
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
    return <span style={{ color: 'var(--color-text-muted)' }} title={emptyTitle}>-</span>;
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
  // Account Name and BFO Name live in COMMISSIONS_CANONICAL too (they're
  // pasteable destinations), but the front lookup columns already render them
  // as the interactive, autocompleted versions. Drop the canonical duplicates
  // so each key produces exactly one column. Without this the table shows a
  // second "BFO Name" column whenever the saved column order predates the
  // front one — orderColumns only collapses a duplicate key when the saved
  // order already lists it.
  const frontKeys = new Set(front.map(c => c.key));
  const canonical = COMMISSIONS_CANONICAL.filter(k => !frontKeys.has(k)).map((k) => {
    const isCurrency = CURRENCY_KEYS.has(k) || isMonthRevenueKey(k) || isFYRevenueKey(k) || isMonthCommissionKey(k);
    const isDate = DATE_KEYS.has(k);
    const isPercent = PERCENT_KEYS.has(k);
    // FY Revenue is computed at render time from the monthly revenue cells
    // that fall inside the row's commission window — the user wants a live
    // total for the deal's fiscal year, not whatever was pasted. Sort /
    // export both follow the same computed number.
    if (isFYRevenueKey(k)) {
      return {
        key: k,
        label: k,
        defaultWidth: defaultWidth(k),
        getSortValue: (row) => sumFiscalMonths(row, true),
        render: (row) => renderSumCell(
          sumFiscalMonths(row, true),
          'No monthly revenue entries on this row',
          `Sum of the monthly revenue cells across the commission's fiscal year`,
        ),
        exportValue: (row) => sumFiscalMonths(row, true) ?? '',
      };
    }
    return {
      key: k,
      label: k,
      defaultWidth: defaultWidth(k),
      ...(isDate ? { getSortValue: (row) => { const d = asDate(row[k]); return d ? d.getTime() : null; } } : {}),
      ...(isCurrency || isPercent ? { getSortValue: (row) => asNumber(row[k]) } : {}),
      // Every canonical column here is user-entered data (Name, Project
      // Name, Comm dates, %, monthly revenue / commission), so make each
      // one editable inline — double-click swaps to a text input that
      // commits on Enter / blur, saving through the same updateCell path
      // as the Account Name / BFO Name front columns. The derived columns
      // (FY Revenue / Commission, Payment Status, etc.) are built
      // separately and stay read-only. The display (non-editing) formatter
      // closes over `row` so the "pending future month" greying below still
      // works — it needs the row's commission window, not just the value.
      render: (row) => {
        const renderValue = (v) => {
          // Upcoming months of the current year, on deals whose commission
          // runs through it, read as a greyed "-" (distinct from the "—" used
          // for genuinely empty cells) so they're clearly "not paid yet"
          // rather than a real $0 or missing data. Only overrides an empty or
          // zero cell — a real value is never hidden.
          if (isMonthCommissionKey(k) || isMonthRevenueKey(k)) {
            const n0 = asNumber(v);
            if ((v == null || v === '' || n0 === 0) && isPendingFutureMonth(row, monthIndexForKey(k))) {
              return (
                <span
                  title="Hasn’t happened yet: upcoming month for this commission year"
                  style={{ display: 'block', textAlign: 'left', color: '#94A3B8', background: '#F1F5F9', borderRadius: 3, fontVariantNumeric: 'tabular-nums' }}
                >-</span>
              );
            }
          }
          if (v == null || v === '') return <span style={{ color: 'var(--color-text-muted)' }}>-</span>;
          if (isCurrency) return <span style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtCurrency(v)}</span>;
          if (isPercent) return <span style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtPercent(v)}</span>;
          if (isDate) return <span style={{ color: '#334155' }}>{fmtDate(v)}</span>;
          return <span>{String(v)}</span>;
        };
        return (
          <EditableCell
            value={row[k]}
            render={renderValue}
            onSave={(v) => row.__onUpdate?.(row.id, k, v)}
          />
        );
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
  // Mirror of the FY Revenue column, but summing the monthly commission
  // cells inside the commission's fiscal window — sits at the tail of the
  // table where the user wanted it. Followed by the derived Payment Status
  // pill.
  const fyCommissionCol = {
    key: FY_COMMISSION_KEY,
    label: FY_COMMISSION_KEY,
    defaultWidth: defaultWidth(FY_COMMISSION_KEY),
    getSortValue: (row) => sumFiscalMonths(row, false),
    render: (row) => renderSumCell(
      sumFiscalMonths(row, false),
      'No monthly commission entries on this row',
      `Sum of the monthly commission cells across the commission's fiscal year`,
    ),
    exportValue: (row) => sumFiscalMonths(row, false) ?? '',
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
  // Derived "Last Payment Date" column — the calendar date of the row's
  // most recent commission, resolved from the monthly cells together with
  // the Comm Start / Comm End dates (see lastPaymentDate). Muted dash when
  // nothing on the row can date it. Sorts on the raw timestamp; exports the
  // formatted date.
  const lastPaymentDateCol = {
    key: LAST_PAYMENT_DATE_KEY,
    label: LAST_PAYMENT_DATE_KEY,
    defaultWidth: defaultWidth(LAST_PAYMENT_DATE_KEY),
    getSortValue: (row) => { const r = lastPaymentDate(row); return r ? r.date.getTime() : null; },
    render: (row) => {
      const r = lastPaymentDate(row);
      if (!r) return <span style={{ color: 'var(--color-text-muted)' }} title="No monthly commission entries or commission dates to derive a last payment date from">-</span>;
      return <span style={{ color: '#334155' }} title={`Derived from ${r.label}`}>{fmtDate(r.date)}</span>;
    },
    exportValue: (row) => { const r = lastPaymentDate(row); return r ? fmtDate(r.date) : ''; },
  };
  // Derived "Days Since Last Payment" column — how long it's been since the
  // most recent commission on the row. Muted dash when there's nothing to
  // date it from; the count shifts to amber past 30 days and red past 60 so
  // stalled payouts stand out at a glance. Sorts / exports off the raw count.
  const daysSincePaymentCol = {
    key: DAYS_SINCE_PAYMENT_KEY,
    label: DAYS_SINCE_PAYMENT_KEY,
    defaultWidth: defaultWidth(DAYS_SINCE_PAYMENT_KEY),
    getSortValue: (row) => { const r = daysSinceLastPayment(row); return r ? r.days : null; },
    render: (row) => {
      const r = daysSinceLastPayment(row);
      if (!r) return <span style={{ color: 'var(--color-text-muted)' }} title="No monthly commission entries or commission dates to date the last payment from">-</span>;
      // Rows with no commission window carry the fixed sentinel — render it
      // muted (not the red "overdue" scale) and explain the placeholder, so
      // it doesn't read as a genuine 1000-day-old payment.
      if (r.info.source === 'none') {
        return (
          <span
            title={`No Comm Start or End Date on file: treated as ${r.days.toLocaleString('en-US')} days so it sorts to the bottom`}
            style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-muted)' }}
          >
            {r.days.toLocaleString('en-US')}
          </span>
        );
      }
      const color = r.days > 60 ? '#B91C1C' : r.days > 30 ? '#B45309' : '#0F172A';
      const dateStr = (r.info.source === 'month' || r.info.source === 'ended')
        ? `Last commission in ${r.info.label} (${fmtDate(r.info.date)})`
        : `Last payment on ${fmtDate(r.info.date)}`;
      return (
        <span
          title={`${dateStr} · ${r.days} day${r.days === 1 ? '' : 's'} ago`}
          style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color, fontWeight: r.days > 60 ? 700 : 400 }}
        >
          {r.days.toLocaleString('en-US')}
        </span>
      );
    },
    exportValue: (row) => { const r = daysSinceLastPayment(row); return r ? r.days : ''; },
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
      if (!d) return <span style={{ color: 'var(--color-text-muted)' }} title="No edits recorded yet: this row hasn't been changed since the Last Updated column was added">-</span>;
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
          title={on ? 'Row is ignored: click to restore.' : 'Mark this row as ignored (greys it out).'}
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
  // Per-row "keep" toggle for the duplicate Project Name warning. Only
  // meaningful on rows that share a Project Name with an earlier row, so the
  // cell is blank everywhere else. Marking a row "Kept" acknowledges it as a
  // genuinely distinct deal: the row stays fully active (unlike Ignore, which
  // greys it out and drops it from totals) but stops counting toward the
  // duplicate banner and loses its fuchsia flag. Self-heals — rename or delete
  // the collision and the toggle disappears on its own.
  const dupeOkCol = {
    key: '__dupeOk',
    label: '',
    defaultWidth: 76,
    render: (row) => {
      if (!row.__isDupeCandidate) return null;
      const on = !!row.__dupeOk;
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            row.__onToggleDupeOk?.(row.id);
          }}
          title={on
            ? 'Duplicate warning dismissed: this row is kept as a distinct deal. Click to flag it again.'
            : 'Keep this row as a distinct deal and dismiss the duplicate Project Name warning.'}
          style={{
            background: on ? '#F5D0FE' : 'transparent',
            border: '1px solid #E9A5F1',
            color: '#86198F',
            borderRadius: 4, padding: '0 6px',
            fontSize: '0.72rem', fontFamily: 'inherit', cursor: 'pointer', lineHeight: 1.4,
            fontWeight: 600, whiteSpace: 'nowrap',
          }}
        >{on ? 'Kept' : 'Keep'}</button>
      );
    },
    exportValue: (row) => (row.__dupeOk ? 'Kept (duplicate acknowledged)' : ''),
  };
  return [selectCol, ...front, ...canonical, fyCommissionCol, paymentStatusCol, lastPaymentDateCol, daysSincePaymentCol, updatedAtCol, ignoreCol, dupeOkCol, deleteCol];
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

// A row that already carries an Account Name should also have the BFO
// (Opportunity) Name that ties it to a BFO opp — without it, Scope and the
// BFO → Account fill can't resolve. Flag it for the warning banner when
// it's not ignored, has an Account Name filled in, and its BFO Name cell
// is blank.
function isMissingBfoName(row) {
  if (!row || row.__ignored) return false;
  const account = String(row[ACCOUNT_NAME_KEY] ?? '').trim();
  if (account === '') return false;
  const bfo = String(row[BFO_NAME_KEY] ?? '').trim();
  return bfo === '';
}

export function CommissionsView({ settings, updateSettings, prospects = [] }) {
  const [{ data, source }, setStore] = useState(() => loadCommissions());
  const [search, setSearch] = useState('');
  // Which subtab is active: 'all' shows the full roster; 'activelyPaid'
  // narrows to deals that had commission or revenue paid in the last 3 months.
  const [subtab, setSubtab] = useState('all');
  // When on, the table narrows to just the rows the warning banner is
  // flagging (missing Account Name, not ignored) so the user can fix
  // them in one pass.
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);
  // Same idea, for the "has an Account Name but no BFO Name" warning — the
  // two "show only" filters are mutually exclusive (a row can't be in both
  // sets), so turning one on clears the other.
  const [showOnlyMissingBfo, setShowOnlyMissingBfo] = useState(false);
  // Same idea, for the "duplicate Project Name" flag. Mutually exclusive with
  // the other two "show only" filters.
  const [showOnlyDuplicates, setShowOnlyDuplicates] = useState(false);
  // "Active only" filter: keep just the rows whose Payment Status is still
  // Active (commissions currently paying out), hiding Stopped / unknown rows.
  const [showActiveOnly, setShowActiveOnly] = useState(false);
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
    // Same-window change event — also fires when the Firestore mirror
    // hydrates a newer roster at signin.
    const onChanged = () => setStore(loadCommissions());
    window.addEventListener('storage', onStorage);
    window.addEventListener(COMMISSIONS_LIST_EVENT, onChanged);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(COMMISSIONS_LIST_EVENT, onChanged);
    };
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
  // The select-all handler and header checkbox live inside the memoized
  // `columns` (rebuilt only on oppsCache / selectedIds changes), so a plain
  // closure over `visibleIds` goes stale the moment a filter narrows the
  // table without touching those deps — select-all would then act on the
  // pre-filter row set (and bulk-ignore every row). Mirror the visible ids
  // into a ref so those handlers always read the current filtered set.
  const visibleIdsRef = useRef([]);
  const onTableFilteredRowsChange = useCallback((tableRows) => {
    const ids = tableRows.map(r => r.id);
    visibleIdsRef.current = ids;
    setVisibleIds(ids);
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
      const visible = visibleIdsRef.current;
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
    const visible = visibleIdsRef.current;
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

  // Flip the __dupeOk flag on a row — acknowledges a duplicate Project Name
  // as a genuinely distinct deal so it stops counting toward the duplicate
  // banner. Unlike __ignored the row stays fully active; this only silences
  // the warning. Persisted via the same override store as every cell edit.
  function toggleDupeOk(rowId) {
    const idx = Number(rowId);
    if (!Number.isFinite(idx)) return;
    setStore(prev => {
      const next = [...prev.data];
      const current = { ...(next[idx] || {}) };
      if (current.__dupeOk) delete current.__dupeOk;
      else current.__dupeOk = true;
      current[UPDATED_AT_KEY] = nowStamp();
      next[idx] = current;
      try { saveCommissionsOverride(next); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: next, source: 'override' };
    });
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

  // Rows that repeat an earlier row's Project Name. Recomputed live off the
  // data so it self-heals: rename one of the pair (or delete it) and the
  // flag clears on its own. These are the "duplicate candidates" — the rows
  // that get the inline Keep toggle.
  const duplicateIds = useMemo(() => duplicateIdsFrom(data), [data]);

  // Candidates the user hasn't acknowledged with "Keep" (__dupeOk). This is
  // the set that actually drives the banner, the count, the row tint and the
  // "show only" filter — a kept row is a distinct deal, not a warning.
  const flaggedDuplicateIds = useMemo(() => {
    const out = new Set();
    duplicateIds.forEach(i => { if (!data[i]?.__dupeOk) out.add(i); });
    return out;
  }, [duplicateIds, data]);

  // Mark every still-flagged duplicate row as kept in one pass — clears the
  // banner while leaving the rows fully active.
  function dismissAllDuplicates() {
    setStore(prev => {
      const dupes = duplicateIdsFrom(prev.data);
      let changed = false;
      const next = prev.data.map((row, i) => {
        if (!dupes.has(i) || row.__dupeOk) return row;
        changed = true;
        return { ...row, __dupeOk: true, [UPDATED_AT_KEY]: nowStamp() };
      });
      if (!changed) return prev;
      try { saveCommissionsOverride(next); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: next, source: 'override' };
    });
    setShowOnlyDuplicates(false);
  }

  const rows = useMemo(
    () => data.map((r, i) => ({
      ...r,
      id: i,
      __onUpdate: updateCell,
      __onDelete: deleteRow,
      __onToggleIgnore: toggleIgnored,
      __onToggleDupeOk: toggleDupeOk,
      __isSelected: selectedIds.has(i),
      __onToggleSelect: toggleSelect,
      __isDupeCandidate: duplicateIds.has(i),
      __isDuplicate: flaggedDuplicateIds.has(i),
    })),
    [data, selectedIds, duplicateIds, flaggedDuplicateIds]
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

  // Count of rows that have an Account Name but no BFO Name (and aren't
  // ignored) — drives the second warning banner. Off the raw data so it
  // reflects the whole roster, not just the filtered view.
  const missingBfoCount = useMemo(
    () => data.reduce((n, r) => n + (isMissingBfoName(r) ? 1 : 0), 0),
    [data],
  );

  useEffect(() => {
    if (missingBfoCount === 0 && showOnlyMissingBfo) setShowOnlyMissingBfo(false);
  }, [missingBfoCount, showOnlyMissingBfo]);

  // How many rows duplicate an earlier row's Project Name and haven't been
  // acknowledged with "Keep" — drives the duplicate banner. Off the flagged
  // set so kept rows drop out and the banner clears once all are dismissed.
  const duplicateCount = flaggedDuplicateIds.size;

  useEffect(() => {
    if (duplicateCount === 0 && showOnlyDuplicates) setShowOnlyDuplicates(false);
  }, [duplicateCount, showOnlyDuplicates]);

  // How many rows are still paying out (Payment Status: Active). Drives both
  // the green "Active only" toggle and the "Actively Paid" subtab — the two
  // are the same set, so the subtab shows exactly what the toggle counts.
  const activeCount = useMemo(
    () => rows.reduce((n, r) => n + (paymentStatusFor(r).state === 'active' ? 1 : 0), 0),
    [rows],
  );

  const filtered = useMemo(() => {
    let base = rows;
    if (subtab === 'activelyPaid') base = base.filter(r => paymentStatusFor(r).state === 'active');
    if (showOnlyMissing) base = base.filter(isMissingAccountName);
    else if (showOnlyMissingBfo) base = base.filter(isMissingBfoName);
    else if (showOnlyDuplicates) base = base.filter(r => r.__isDuplicate);
    if (showActiveOnly) base = base.filter(r => paymentStatusFor(r).state === 'active');
    if (!search.trim()) return base;
    const term = search.toLowerCase();
    return base.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(term)));
  }, [rows, search, subtab, showOnlyMissing, showOnlyMissingBfo, showOnlyDuplicates, showActiveOnly]);

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

  function handleImport(records, { replaceMonths = false } = {}) {
    setStore(prev => {
      // Stamp every incoming row with "now" as its Last Updated time. The
      // merge overlays each incoming row's non-blank cells (including this
      // stamp) onto the matching project, so a project the paste touches
      // carries the fresh stamp while an existing project the paste doesn't
      // mention keeps its prior stamp — an unrelated row never looks
      // freshly-updated just because a different row pasted.
      const stamp = nowStamp();
      const stamped = (records || []).map(r => ({ ...r, [UPDATED_AT_KEY]: stamp }));
      // Merge the freshly-pasted records into whatever's already on file,
      // deduping by Project Name so re-pasting a refreshed roster doesn't
      // pile duplicate rows on top of the existing data. Rows sharing a
      // project name are unioned cell by cell (see mergeAndDedupCommissions)
      // so a snapshot covering one half of the fiscal year fills its months
      // without dropping the months an earlier snapshot already recorded —
      // unless the user asked to replace months, in which case each touched
      // project's existing months are cleared and repopulated from the paste.
      const merged = mergeAndDedupCommissions(prev.data || [], stamped, { replaceMonths });
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
      setFillStatus('Opps data isn’t loaded yet: open the Opps tab once so the BFO → Account lookup has data, then try again.');
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
              ? 'Paste your monthly commission roster from Excel: the next step maps each pasted column to a destination.'
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

      {/* Subtab bar — same look as the Activity page subtabs. "Actively Paid"
          narrows the table to commissions still paying out (Payment Status:
          Active) — the same set the green Active only button filters to. */}
      <div style={{ padding: '0 1.25rem', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--color-border)', marginBottom: '0.6rem' }}>
          {[
            { key: 'all', label: 'All', count: rows.length },
            { key: 'activelyPaid', label: 'Actively Paid', count: activeCount },
          ].map(t => {
            const isActive = subtab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setSubtab(t.key)}
                title={t.key === 'activelyPaid'
                  ? 'Commissions still paying out (Payment Status: Active): the same set as the green Active only button'
                  : 'Every commission row on file'}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                  color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  padding: '0.5rem 0.75rem',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {t.label}
                <span style={{
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: isActive ? 'var(--color-accent)' : '#E2E8F0',
                  color: isActive ? '#fff' : '#475569',
                }}>{t.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ padding: '0 1.25rem 0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter commissions…"
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <button
          type="button"
          onClick={() => setShowActiveOnly(v => !v)}
          aria-pressed={showActiveOnly}
          title={showActiveOnly
            ? 'Showing only commissions still paying out: click to show all rows'
            : 'Show only commissions still paying out (Payment Status: Active), hiding stopped ones'}
          style={{
            padding: '0.35rem 0.7rem', border: '1px solid #16A34A', borderRadius: 6,
            background: showActiveOnly ? '#16A34A' : '#fff',
            color: showActiveOnly ? '#fff' : '#166534',
            fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit', whiteSpace: 'nowrap',
          }}
        >Active only{activeCount ? ` (${activeCount})` : ''}</button>
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
            onClick={() => { setShowOnlyMissing(v => !v); setShowOnlyMissingBfo(false); setShowOnlyDuplicates(false); }}
            title={showOnlyMissing ? 'Show every commission row again' : 'Filter the table down to just the flagged rows'}
            style={{ padding: '0.3rem 0.7rem', border: '1px solid #D97706', borderRadius: 4, background: showOnlyMissing ? '#D97706' : '#fff', color: showOnlyMissing ? '#fff' : '#92400E', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
          >{showOnlyMissing ? 'Show all rows' : 'Show only these'}</button>
        </div>
      )}

      {missingBfoCount > 0 && (
        <div
          role="alert"
          style={{
            margin: '0 1.25rem 0.5rem', padding: '0.5rem 0.75rem',
            background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 6,
            display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
            fontSize: '0.75rem', color: '#9A3412',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: '0.9rem' }}>⚠️</span>
          <span>
            <strong>{missingBfoCount}</strong> row{missingBfoCount === 1 ? '' : 's'} with an <strong>Account Name</strong> {missingBfoCount === 1 ? 'has' : 'have'} no <strong>BFO Name</strong> {missingBfoCount === 1 ? "and isn't" : "and aren't"} marked ignored.
          </span>
          <span style={{ color: '#C2410C' }}>Add a BFO Name, or mark the row ignored, to clear this.</span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => { setShowOnlyMissingBfo(v => !v); setShowOnlyMissing(false); setShowOnlyDuplicates(false); }}
            title={showOnlyMissingBfo ? 'Show every commission row again' : 'Filter the table down to just the flagged rows'}
            style={{ padding: '0.3rem 0.7rem', border: '1px solid #EA580C', borderRadius: 4, background: showOnlyMissingBfo ? '#EA580C' : '#fff', color: showOnlyMissingBfo ? '#fff' : '#9A3412', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
          >{showOnlyMissingBfo ? 'Show all rows' : 'Show only these'}</button>
        </div>
      )}

      {duplicateCount > 0 && (
        <div
          role="alert"
          style={{
            margin: '0 1.25rem 0.5rem', padding: '0.5rem 0.75rem',
            background: '#FDF4FF', border: '1px solid #E9A5F1', borderRadius: 6,
            display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
            fontSize: '0.75rem', color: '#86198F',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: '0.9rem' }}>⧉</span>
          <span>
            <strong>{duplicateCount}</strong> row{duplicateCount === 1 ? '' : 's'} {duplicateCount === 1 ? 'shares' : 'share'} a <strong>Project Name</strong> with another row: imported and kept as {duplicateCount === 1 ? 'a separate row' : 'separate rows'}, not merged.
          </span>
          <span style={{ color: '#A21CAF' }}>Edit the Project Name, or delete the row, if it isn’t really a distinct deal. Or hit <strong>Keep</strong> to dismiss the warning for a genuine deal.</span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => { setShowOnlyDuplicates(v => !v); setShowOnlyMissing(false); setShowOnlyMissingBfo(false); }}
            title={showOnlyDuplicates ? 'Show every commission row again' : 'Filter the table down to just the duplicate rows'}
            style={{ padding: '0.3rem 0.7rem', border: '1px solid #C026D3', borderRadius: 4, background: showOnlyDuplicates ? '#C026D3' : '#fff', color: showOnlyDuplicates ? '#fff' : '#86198F', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
          >{showOnlyDuplicates ? 'Show all rows' : 'Show only these'}</button>
          <button
            type="button"
            onClick={dismissAllDuplicates}
            title="Keep all flagged rows as distinct deals and dismiss this warning. Each stays fully active; re-flag one anytime with its Kept toggle."
            style={{ padding: '0.3rem 0.7rem', border: '1px solid #C026D3', borderRadius: 4, background: '#fff', color: '#86198F', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
          >Keep all</button>
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
            // Lead with the rows that were paid most recently — lowest "Days
            // Since Last Payment" first. Rows with no datable payment sort to
            // the bottom (the comparator parks nulls there either direction).
            defaultSort={{ key: DAYS_SINCE_PAYMENT_KEY, direction: 'asc' }}
            emptyMessage={search ? `No rows match "${search}"` : 'No commissions to display'}
            // Clean, human-readable name for the built-in Export Excel
            // button. Without these the file falls back to the internal
            // tableId ("commissions:Account Name|BFO Name|…"), which the
            // filename sanitizer turns into a mangled dash-joined string.
            exportFileName="Commissions"
            exportPrimarySheetName="Commissions"
            enableColumnFilters
            // Ignored rows grey out (wins if a row is both). A duplicate
            // Project Name gets a fuchsia tint + left accent so it reads as
            // "flagged, still here" rather than an error.
            rowStyle={(row) => row.__ignored
              ? { opacity: 0.45, background: '#F8FAFC', color: '#64748B' }
              : row.__isDuplicate
                ? { background: '#FDF4FF', boxShadow: 'inset 3px 0 0 #C026D3' }
                : undefined}
            onFilteredRowsChange={onTableFilteredRowsChange}
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
      </div>

      {showPaste && (
        <CommissionsPasteImportModal
          onClose={() => { setShowPaste(false); setInitialPaste(''); }}
          onImport={(records, opts) => { handleImport(records, opts); setInitialPaste(''); }}
          initialPaste={initialPaste}
          existingRows={data}
        />
      )}
    </div>
  );
}
