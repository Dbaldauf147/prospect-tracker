import { useMemo, useState, useEffect, useRef } from 'react';
import { DataTable } from '../common/DataTable';
import { FollowUpOnSaleCell } from '../common/FollowUpOnSaleCell';
import { matchesCdm } from '../../utils/cdmMatch';
import { buildTargetTierResolver } from '../../utils/targetTier';
import { DealsView } from '../DealsView/DealsView';
import { CommissionsView } from './CommissionsView';
import { ContractServicesView } from './ContractServicesView';
import { ContractLanguageView } from './ContractLanguageView';
import { loadDealsList, saveDealsOverride } from '../../utils/dealsStore';
import { loadDealClientMap, DEALS_CLIENT_MAP_EVENT } from '../../utils/dealClientMap';
import {
  loadClientManagerMap, setClientManager, CLIENT_MANAGER_EVENT,
  loadClientInPersonMap, setClientInPerson, CLIENT_IN_PERSON_EVENT,
  loadClientStatusMap, setClientStatus, CLIENT_STATUS_EVENT,
  loadClientStatusSetAtMap, setClientStatusSetAt, CLIENT_STATUS_SET_AT_EVENT,
  loadClientNotesMap, setClientNotes, CLIENT_NOTES_EVENT,
  loadClientUntrackedMap, setClientUntracked, CLIENT_UNTRACKED_EVENT,
  loadClientLouisvilleMap, setClientLouisville, CLIENT_LOUISVILLE_EVENT,
} from '../../utils/clientManagerStore';
import { ClientFieldsPasteModal } from './ClientFieldsPasteModal';
import {
  asDate, fmtCurrency, fmtPercent, fmtDate, isTruthy,
  DEAL_CURRENCY_KEYS, DEAL_DATE_KEYS, DEAL_PERCENT_KEYS, DEAL_CHECK_KEYS,
} from '../../utils/dealsFormat';
import {
  buildListRegistry, buildAvailableLists, resolveColumnLink,
  SelectCell, MultiSelectCell, LinkColumnsModal,
} from '../common/columnLinks';
import { getEffectiveDropdownLists } from '../../utils/dropdownListsStore';
import { getIndicativeAnalysisMeta } from '../../utils/firestoreSync';
// Shared with the Issues tab so both surfaces agree on what's expired.
import { isInactiveAgreement, normClientName, soonestExpiration } from '../../utils/clientIssues';
import { dealSoldDate, postSaleFollowUpRows } from '../../utils/postSaleFollowUp';

const MS_PER_DAY = 86400000;

// Master Analysis lookups for clients whose record carries no saved-analysis
// marker, cached for the session (prospectId → meta | null) so switching
// subtabs or re-filtering doesn't re-read the same documents. Saves made
// after this page loaded arrive through the record marker instead, so a
// cached miss can't hide a fresh save.
const analysisMetaCache = new Map();
// How many of those metadata reads to run at once.
const ANALYSIS_PROBE_BATCH = 8;

// A client row is tinted light red as a "needs a status" warning when its
// soonest renewal is inside this many days AND the Status column is still
// blank. Shared by the row-highlight logic and the on-page legend so the two
// can't drift apart.
const RENEWAL_WARNING_DAYS = 270;

// "Reached out to CM" is a time-boxed status: it auto-clears this many days
// after it's set, and a countdown shows how long is left. Kept as one
// constant so the timer, the badge, and any copy stay in sync.
const REACHED_OUT_TIMER_DAYS = 30;
function isReachedOutToCM(status) {
  const s = String(status || '');
  return /reached\s*out/i.test(s) && /\bcm\b/i.test(s);
}
// Days left before a "Reached out to CM" status auto-clears, given the ISO
// date it was set. null when there's no stamp. Can go 0 / negative once the
// window has elapsed (the row-scan effect then clears the status).
function reachedOutDaysLeft(setAtISO) {
  if (!setAtISO) return null;
  const set = new Date(setAtISO);
  if (Number.isNaN(set.getTime())) return null;
  set.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const elapsed = Math.round((today.getTime() - set.getTime()) / MS_PER_DAY);
  return REACHED_OUT_TIMER_DAYS - elapsed;
}
function todayISODate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Column layout for the per-client contract drill-down. Each entry's
// `key` is the canonical field name stored on the deal row; `label` is
// the heading shown on the Clients tab. Several labels are shorter
// aliases of the Deals-subtab headers — the upload normalizer in
// DealsView already folds them onto the same key.
const CONTRACT_COLUMNS = [
  { key: 'Agreement Name',          label: 'Agreement Name', minWidth: 420 },
  { key: 'Paperwork completed',     label: 'Paperwork', minWidth: 220 },
  { key: 'Current Term Start Date', label: 'Current Term Start Date' },
  { key: 'Payment Terms',           label: 'Payment Terms' },
  { key: 'End Date',                label: 'End Date', minWidth: 130 },
  { key: '__daysToEnd',             label: 'Days to End Date', minWidth: 130 },
  { key: 'Auto renewal?',           label: 'Auto renewal?' },
  { key: 'Esc',                     label: 'Esc', minWidth: 140 },
];

// Whole-day delta between a contract End Date and today, rendered as
// a colored cell. Negative means the date has already passed; rows
// inside 30 days run amber so renewals are easy to spot. Cancelled /
// expired rows render in grey to match the rest of the inactive row.
function renderDaysToEnd(endRaw, inactive) {
  const d = asDate(endRaw);
  if (!d) return <span style={{ color: '#94A3B8' }}>-</span>;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
  const color = inactive
    ? '#94A3B8'
    : days < 0 ? '#B91C1C'
    : days <= 30 ? '#92400E'
    : '#334155';
  const label = days === 0
    ? 'Today'
    : days > 0 ? `${days}d`
    : `${Math.abs(days)}d ago`;
  return <span style={{ color, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{label}</span>;
}

// Shared Tier pill used by both the account's own Tier column and the
// mapped Target Tier column. Tier 1 pops red (top accounts), Tier 2 blue,
// anything else slate; blank / "-" renders an em dash. `title` adds a
// hover tooltip (e.g. which target account the mapped tier came from).
function tierBadge(tier, title) {
  const t = String(tier || '').trim();
  if (!t || t === '-') return <span style={{ color: '#94A3B8' }} title={title}>-</span>;
  const palette = /1/.test(t)
    ? { bg: '#FEE2E2', color: '#B91C1C' }
    : /2/.test(t)
    ? { bg: '#DBEAFE', color: '#1E40AF' }
    : { bg: '#F1F5F9', color: '#475569' };
  return (
    <span title={title} style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: palette.bg, color: palette.color, whiteSpace: 'nowrap' }}>
      {t}
    </span>
  );
}

// Inline editor for the Client Manager column. Local draft so typing
// stays snappy; commits on blur or Enter, reverts on Escape. The
// container swallows click + keydown so editing doesn't trigger the
// row-open popup or table-level shortcuts.
function ClientManagerCell({ company, value, onCommit }) {
  const [draft, setDraft] = useState(value || '');
  const [focused, setFocused] = useState(false);
  useEffect(() => { setDraft(value || ''); }, [value]);
  // Escape restores the draft and blurs, but blur() runs its handler
  // before React has re-rendered — so commit() still reads the abandoned
  // text and saves the very edit Escape just discarded.
  const cancelled = useRef(false);
  function commit() {
    if (cancelled.current) { cancelled.current = false; return; }
    const next = draft.trim();
    if (next === (value || '').trim()) return;
    onCommit(company, next);
  }
  return (
    <input
      type="text"
      value={draft}
      placeholder="-"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') {
          e.preventDefault();
          cancelled.current = true;
          setDraft(value || '');
          e.currentTarget.blur();
        }
      }}
      style={{
        width: '100%', boxSizing: 'border-box',
        padding: '3px 6px',
        border: `1px solid ${focused ? '#3B82F6' : 'transparent'}`, borderRadius: 4,
        background: focused ? '#fff' : 'transparent', color: '#1E293B',
        fontSize: '0.72rem', fontFamily: 'inherit',
      }}
    />
  );
}

// Free-text Status editor used when no Dropdowns list is bound to
// the column. When a list IS bound, ClientsView uses the shared
// SelectCell from columnLinks instead.
function ClientStatusTextCell({ company, value, onCommit }) {
  const [draft, setDraft] = useState(value || '');
  const [focused, setFocused] = useState(false);
  useEffect(() => { setDraft(value || ''); }, [value]);
  // See ClientManagerCell: blur runs before the re-render, so without
  // this an escaped edit is still what commit() reads and saves.
  const cancelled = useRef(false);
  function commit() {
    if (cancelled.current) { cancelled.current = false; return; }
    const next = draft.trim();
    if (next === (value || '').trim()) return;
    onCommit(company, next);
  }
  return (
    <input
      type="text"
      value={draft}
      placeholder="-"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') {
          e.preventDefault();
          cancelled.current = true;
          setDraft(value || '');
          e.currentTarget.blur();
        }
      }}
      style={{
        width: '100%', boxSizing: 'border-box',
        padding: '3px 6px',
        border: `1px solid ${focused ? '#3B82F6' : 'transparent'}`, borderRadius: 4,
        background: focused ? '#fff' : 'transparent', color: '#1E293B',
        fontSize: '0.72rem', fontFamily: 'inherit',
      }}
    />
  );
}

// Multi-line free-form notes cell. Uses a textarea so the user can
// hit Enter for a new line; commits on blur. The cell grows up to a
// max height and scrolls — keeps long notes from blowing out the row.
function NotesCell({ company, value, onCommit }) {
  const [draft, setDraft] = useState(value || '');
  const [focused, setFocused] = useState(false);
  useEffect(() => { setDraft(value || ''); }, [value]);
  function commit() {
    if (draft === (value || '')) return;
    onCommit(company, draft);
  }
  return (
    <textarea
      value={draft}
      placeholder="-"
      rows={focused ? 3 : 1}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); setDraft(value || ''); e.currentTarget.blur(); }
      }}
      style={{
        width: '100%', boxSizing: 'border-box',
        padding: '3px 6px',
        border: `1px solid ${focused ? '#3B82F6' : 'transparent'}`, borderRadius: 4,
        background: focused ? '#fff' : 'transparent', color: '#1E293B',
        fontSize: '0.72rem', fontFamily: 'inherit',
        resize: 'vertical', minHeight: 24, maxHeight: 160,
        whiteSpace: 'pre-wrap',
      }}
    />
  );
}

// Per-client In Person Meeting flag. Centered checkbox; the table
// row already has no onRowClick so a click on the box only toggles
// the flag, but stop propagation anyway to be safe.
function InPersonCell({ company, checked, onChange }) {
  return (
    <label
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
    >
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(company, e.target.checked)}
        style={{ cursor: 'pointer' }}
      />
    </label>
  );
}

function renderContractCell(key, value) {
  if (value == null || value === '') return <span style={{ color: '#94A3B8' }}>-</span>;
  if (DEAL_CHECK_KEYS.has(key)) {
    const yes = isTruthy(value);
    return (
      <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: yes ? '#DCFCE7' : '#F1F5F9', color: yes ? '#166534' : '#64748B' }}>
        {yes ? 'Yes' : (typeof value === 'string' && value.trim() ? value : 'No')}
      </span>
    );
  }
  if (DEAL_CURRENCY_KEYS.has(key)) return <span style={{ fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtCurrency(value)}</span>;
  if (DEAL_PERCENT_KEYS.has(key)) return <span style={{ fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtPercent(value)}</span>;
  if (DEAL_DATE_KEYS.has(key)) return <span style={{ color: '#334155' }}>{fmtDate(value)}</span>;
  return <span style={{ color: '#1E293B' }}>{String(value)}</span>;
}

function ContractTable({ deals }) {
  if (!deals || deals.length === 0) {
    return (
      <div style={{ padding: '0.75rem 1.25rem', color: '#64748B', fontSize: '0.75rem', fontStyle: 'italic' }}>
        No contracts found for this client. Upload contract data on the Deals subtab: the Client Name column must match this client.
      </div>
    );
  }
  // Cancelled / Expired agreements sink to the bottom — they're still
  // worth seeing as history but shouldn't crowd the active rows. Inside
  // each group sort by End Date ascending so the soonest-expiring
  // contracts surface first; rows with no End Date drop to the bottom
  // of their group.
  const sorted = [...deals].sort((a, b) => {
    const ai = isInactiveAgreement(a) ? 1 : 0;
    const bi = isInactiveAgreement(b) ? 1 : 0;
    if (ai !== bi) return ai - bi;
    const aDate = asDate(a['End Date']);
    const bDate = asDate(b['End Date']);
    if (!aDate && !bDate) return 0;
    if (!aDate) return 1;
    if (!bDate) return -1;
    return aDate.getTime() - bDate.getTime();
  });
  return (
    <div style={{ overflowX: 'auto', padding: '0.5rem 0.75rem 0.75rem' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.7rem', width: 'max-content', minWidth: '100%' }}>
        <thead>
          <tr style={{ background: '#F1F5F9' }}>
            {CONTRACT_COLUMNS.map(col => (
              <th key={col.key} style={{ padding: '0.35rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700, fontSize: '0.65rem', whiteSpace: 'nowrap', borderBottom: '1px solid #CBD5E1', minWidth: col.minWidth }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((d, i) => {
            const inactive = isInactiveAgreement(d);
            const baseBg = i % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
            return (
            <tr key={i} style={{ background: inactive ? '#F1F5F9' : baseBg, color: inactive ? '#94A3B8' : undefined, opacity: inactive ? 0.7 : 1 }}>
              {CONTRACT_COLUMNS.map(col => (
                <td key={col.key} style={{ padding: '0.3rem 0.5rem', whiteSpace: 'nowrap', borderBottom: '1px solid #E2E8F0', minWidth: col.minWidth }}>
                  {col.key === '__daysToEnd'
                    ? renderDaysToEnd(d['End Date'], inactive)
                    : renderContractCell(col.key, d[col.key])}
                </td>
              ))}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Whole-day delta between when a deal was sold and today, rendered as a
// colored cell. A post-sale follow-up should land soon after the sale, so the
// longer a deal has gone without one the more overdue it is: rows past 30 days
// run red, rows past a week run amber. Undated rows render an em dash.
function renderDaysSinceSold(soldRaw) {
  const d = asDate(soldRaw);
  if (!d) return <span style={{ color: '#94A3B8' }}>-</span>;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - start.getTime()) / MS_PER_DAY);
  const color = days > 30 ? '#B91C1C'
    : days > 7 ? '#92400E'
    : '#334155';
  const label = days === 0
    ? 'Today'
    : days > 0 ? `${days}d ago`
    : `in ${Math.abs(days)}d`;
  return <span style={{ color, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{label}</span>;
}

// Columns shown on the Post-Sale Follow-Up subtab. A post-sale follow-up is
// driven by how long it's been since the deal was sold (not when the contract
// expires), so this leads with Date Sold / Days Since Sold.
const POST_SALE_COLUMNS = [
  { key: 'Client Name',       label: 'Client', minWidth: 200 },
  { key: 'Agreement Name',    label: 'Agreement Name', minWidth: 360 },
  { key: '__dateSold',        label: 'Date Sold', minWidth: 120 },
  { key: '__daysSinceSold',   label: 'Days Since Sold', minWidth: 130 },
  { key: 'Closed Won',        label: 'Closed Won', minWidth: 110 },
  { key: 'Follow Up On Sale', label: 'Follow Up On Sale', minWidth: 170 },
];

// Persisted, user-adjustable column widths for the Post-Sale Follow-Up
// table. Mirrors the DataTable convention (prospect-col-widths-<tableId>)
// so the storage layout stays consistent across the app, but this bespoke
// table isn't a DataTable so it manages its own widths here. Widths below
// this floor are clamped so a column can't be dragged shut.
const POST_SALE_WIDTHS_KEY = 'prospect-col-widths-postsale';
const POST_SALE_MIN_WIDTH = 60;

function loadPostSaleWidths() {
  try { return JSON.parse(localStorage.getItem(POST_SALE_WIDTHS_KEY)) || {}; } catch { return {}; }
}
function savePostSaleWidths(w) {
  try { localStorage.setItem(POST_SALE_WIDTHS_KEY, JSON.stringify(w)); } catch {}
}

// "Post-Sale Follow-Up" subtab: every uploaded deal missing a Follow Up On
// Sale value, flagged for attention. Sourced from the same uploaded deals
// list the Deals subtab shows (so it stays in sync with that data).
function PostSaleFollowUpView({ deals, onUpdateFollowUp }) {
  const [query, setQuery] = useState('');
  const [colWidths, setColWidths] = useState(loadPostSaleWidths);

  const getWidth = (col) => colWidths[col.key] || col.minWidth;

  // Drag-to-resize a column from its right edge. Tracks the pointer on
  // document (not the handle) so the drag keeps working past the header,
  // persisting the new width to localStorage as it goes.
  function handleResizeStart(e, colKey) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const col = POST_SALE_COLUMNS.find(c => c.key === colKey);
    const startWidth = colWidths[colKey] || col.minWidth;

    function onMouseMove(ev) {
      const next = Math.max(POST_SALE_MIN_WIDTH, startWidth + (ev.clientX - startX));
      setColWidths(prev => {
        const updated = { ...prev, [colKey]: next };
        savePostSaleWidths(updated);
        return updated;
      });
    }
    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function resetWidths() {
    setColWidths({});
    savePostSaleWidths({});
  }

  // The shared row builder the Pipeline table and the Issues detector run on:
  // same skips (blank spacer rows, deals ignored on the Deals subtab, deals
  // that already have a follow-up date) and the same longest-since-sold-first
  // order this subtab was doing by hand. One definition, so a deal can't be
  // owed here and settled there.
  const flagged = useMemo(() => postSaleFollowUpRows(deals), [deals]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flagged;
    return flagged.filter(d =>
      String(d['Client Name'] ?? d['Client Name '] ?? '').toLowerCase().includes(q)
      || String(d['Agreement Name'] ?? '').toLowerCase().includes(q));
  }, [flagged, query]);

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '1rem 1.25rem 1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>Post-Sale Follow-Up</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
            Deals from the Deals subtab with no <strong>Follow Up On Sale</strong> value: these still need a post-sale follow-up.
          </div>
        </div>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter by client or agreement…"
          style={{ flex: '0 1 320px', padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: '#64748B', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#FEE2E2', border: '1px solid #FCA5A5', flexShrink: 0 }} />
        <span><strong style={{ color: '#B91C1C' }}>{filtered.length}</strong> deal{filtered.length === 1 ? '' : 's'} flagged: missing a Follow Up On Sale value.</span>
        <span style={{ color: '#CBD5E1' }}>·</span>
        <span style={{ color: '#94A3B8' }}>Drag a column edge to resize.</span>
        {Object.keys(colWidths).length > 0 && (
          <button
            type="button"
            onClick={resetWidths}
            style={{ background: 'transparent', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: '0.68rem', color: '#64748B', cursor: 'pointer', padding: '1px 6px', fontFamily: 'inherit' }}
            title="Restore the default column widths"
          >Reset widths</button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: '0.75rem 0', color: '#64748B', fontSize: '0.8rem', fontStyle: 'italic' }}>
          {deals && deals.length
            ? 'Every uploaded deal has a Follow Up On Sale value: nothing to follow up on.'
            : 'No deals uploaded yet. Upload contract data on the Deals subtab.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: 8 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.72rem', tableLayout: 'fixed', width: POST_SALE_COLUMNS.reduce((s, c) => s + getWidth(c), 0), minWidth: '100%' }}>
            <colgroup>
              {POST_SALE_COLUMNS.map(col => (
                <col key={col.key} style={{ width: getWidth(col) }} />
              ))}
            </colgroup>
            <thead>
              <tr style={{ background: '#F1F5F9' }}>
                {POST_SALE_COLUMNS.map(col => (
                  <th key={col.key} style={{ position: 'relative', padding: '0.4rem 0.6rem', textAlign: 'left', color: '#475569', fontWeight: 700, fontSize: '0.66rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', borderBottom: '1px solid #CBD5E1' }} title={col.label}>
                    {col.label}
                    <span
                      onMouseDown={e => handleResizeStart(e, col.key)}
                      title="Drag to resize"
                      style={{ position: 'absolute', top: 0, right: 0, height: '100%', width: 8, cursor: 'col-resize', userSelect: 'none' }}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, i) => (
                <tr key={i} style={{ background: '#FEF2F2', borderBottom: '1px solid #FEE2E2' }}>
                  {POST_SALE_COLUMNS.map(col => (
                    <td key={col.key} style={{ padding: '0.35rem 0.6rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {col.key === '__dateSold'
                        ? (dealSoldDate(d) ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDate(d['Original Contract Start'])}</span> : <span style={{ color: '#94A3B8' }}>-</span>)
                        : col.key === '__daysSinceSold'
                        ? renderDaysSinceSold(d['Original Contract Start'])
                        : col.key === 'Follow Up On Sale'
                          ? <FollowUpOnSaleCell deal={d} onSave={onUpdateFollowUp} />
                          : renderContractCell(col.key, d[col.key] ?? d[`${col.key} `])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const SUBTAB_STORAGE_KEY = 'clients-view:active-subtab';
function readSavedSubtab() {
  try {
    const s = localStorage.getItem(SUBTAB_STORAGE_KEY);
    if (s === 'clients' || s === 'oldclients' || s === 'deals' || s === 'commissions' || s === 'postsale' || s === 'contractservices') return s;
  } catch {}
  return 'clients';
}

function getServicesCount(p) {
  const svc = p.servicesExplored || {};
  return Object.values(svc).filter(v => v && v !== '-').length;
}

// Loose status check — tolerate trailing whitespace and casing drift in the data.
function normStatus(s) {
  return String(s || '').trim().toLowerCase();
}
function isClient(p) { return normStatus(p.status) === 'client'; }
function isOldClient(p) { return normStatus(p.status) === 'old client'; }

export function ClientsView({ prospects = [], cdmName, settings, updateSettings, user, targetAccountsData, addProspect, updateProspect }) {
  const [subtab, setSubtab] = useState(readSavedSubtab);
  function selectSubtab(key) {
    setSubtab(key);
    try { localStorage.setItem(SUBTAB_STORAGE_KEY, key); } catch {}
  }

  // The Clients and Old Clients subtabs share this view; the only real
  // difference is which Status the primary list filters on. The secondary
  // "Include …" toggle pulls in the other bucket. Labels and the table id
  // (so column widths persist independently) follow the active subtab.
  const isOldMode = subtab === 'oldclients';
  const primaryMatch = isOldMode ? isOldClient : isClient;
  const secondaryMatch = isOldMode ? isClient : isOldClient;
  const statusLabel = isOldMode ? 'Old Client' : 'Client';
  const otherLabel = isOldMode ? 'Client' : 'Old Client';
  const headingLabel = isOldMode ? 'Old Clients' : 'Clients';
  const tableId = isOldMode ? 'oldclients' : 'clients';

  const [showOld, setShowOld] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  // Load uploaded deals so each client row can drill down into its
  // own contracts. Re-read on the cross-tab storage event so an
  // upload from the Deals subtab in another window shows up here.
  const [dealsList, setDealsList] = useState(() => loadDealsList().data);
  const [clientMap, setClientMap] = useState(() => loadDealClientMap());
  const [managerMap, setManagerMap] = useState(() => loadClientManagerMap());
  const [inPersonMap, setInPersonMap] = useState(() => loadClientInPersonMap());
  const [statusMap, setStatusMap] = useState(() => loadClientStatusMap());
  const [statusSetAtMap, setStatusSetAtMap] = useState(() => loadClientStatusSetAtMap());
  const [notesMap, setNotesMap] = useState(() => loadClientNotesMap());
  const [untrackedMap, setUntrackedMap] = useState(() => loadClientUntrackedMap());
  const [louisvilleMap, setLouisvilleMap] = useState(() => loadClientLouisvilleMap());
  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'deals-list-override') setDealsList(loadDealsList().data);
      if (e.key === 'deals-client-map') setClientMap(loadDealClientMap());
      if (e.key === 'clients-manager-map') setManagerMap(loadClientManagerMap());
      if (e.key === 'clients-inperson-map') setInPersonMap(loadClientInPersonMap());
      if (e.key === 'clients-status-map') setStatusMap(loadClientStatusMap());
      if (e.key === 'clients-status-set-at') setStatusSetAtMap(loadClientStatusSetAtMap());
      if (e.key === 'clients-notes-map') setNotesMap(loadClientNotesMap());
      if (e.key === 'clients-untracked-map') setUntrackedMap(loadClientUntrackedMap());
      if (e.key === 'clients-louisville-map') setLouisvilleMap(loadClientLouisvilleMap());
    }
    function onClientMap() { setClientMap(loadDealClientMap()); }
    function onManagerMap() { setManagerMap(loadClientManagerMap()); }
    function onInPersonMap() { setInPersonMap(loadClientInPersonMap()); }
    function onStatusMap() { setStatusMap(loadClientStatusMap()); }
    function onStatusSetAtMap() { setStatusSetAtMap(loadClientStatusSetAtMap()); }
    function onNotesMap() { setNotesMap(loadClientNotesMap()); }
    function onUntrackedMap() { setUntrackedMap(loadClientUntrackedMap()); }
    function onLouisvilleMap() { setLouisvilleMap(loadClientLouisvilleMap()); }
    window.addEventListener('storage', onStorage);
    window.addEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
    window.addEventListener(CLIENT_MANAGER_EVENT, onManagerMap);
    window.addEventListener(CLIENT_IN_PERSON_EVENT, onInPersonMap);
    window.addEventListener(CLIENT_STATUS_EVENT, onStatusMap);
    window.addEventListener(CLIENT_STATUS_SET_AT_EVENT, onStatusSetAtMap);
    window.addEventListener(CLIENT_NOTES_EVENT, onNotesMap);
    window.addEventListener(CLIENT_UNTRACKED_EVENT, onUntrackedMap);
    window.addEventListener(CLIENT_LOUISVILLE_EVENT, onLouisvilleMap);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
      window.removeEventListener(CLIENT_MANAGER_EVENT, onManagerMap);
      window.removeEventListener(CLIENT_IN_PERSON_EVENT, onInPersonMap);
      window.removeEventListener(CLIENT_STATUS_EVENT, onStatusMap);
      window.removeEventListener(CLIENT_STATUS_SET_AT_EVENT, onStatusSetAtMap);
      window.removeEventListener(CLIENT_NOTES_EVENT, onNotesMap);
      window.removeEventListener(CLIENT_UNTRACKED_EVENT, onUntrackedMap);
      window.removeEventListener(CLIENT_LOUISVILLE_EVENT, onLouisvilleMap);
    };
  }, []);
  // Refresh deals + client map whenever we switch back to the Clients
  // subtab — same-window upload / mapping changes on the Deals subtab
  // don't fire storage.
  useEffect(() => {
    if (subtab === 'clients' || subtab === 'oldclients' || subtab === 'postsale') {
      setDealsList(loadDealsList().data);
      setClientMap(loadDealClientMap());
      setManagerMap(loadClientManagerMap());
      setInPersonMap(loadClientInPersonMap());
      setStatusMap(loadClientStatusMap());
      setStatusSetAtMap(loadClientStatusSetAtMap());
      setNotesMap(loadClientNotesMap());
      setUntrackedMap(loadClientUntrackedMap());
      setLouisvilleMap(loadClientLouisvilleMap());
    }
  }, [subtab]);

  // Record (or clear) a deal's Follow Up On Sale date from the Post-Sale
  // Follow-Up subtab. Matches the row by reference in the current list, writes
  // the same M/D/YYYY string the Deals subtab stores, and persists through the
  // shared deals override so the Deals subtab and Issues badge stay in sync.
  function updateFollowUpOnSale(targetDeal, value) {
    setDealsList(prev => {
      const idx = prev.indexOf(targetDeal);
      if (idx < 0) return prev;
      const next = [...prev];
      const current = { ...next[idx] };
      const v = String(value ?? '').trim();
      if (!v) delete current['Follow Up On Sale'];
      else current['Follow Up On Sale'] = v;
      next[idx] = current;
      try { saveDealsOverride(next); } catch (err) { console.warn('Save follow-up failed', err); }
      return next;
    });
  }

  // One-time migration for the Tier / Target Tier columns. DataTable
  // permanently hides any column that didn't exist when a user last
  // customized their visible-columns set, so users who've touched the
  // Columns menu would find these stuck under "Hidden columns". Inject any
  // that are missing into their saved set — both the localStorage copy and
  // the Firestore-synced tablePrefs — so they show without hunting. Sticky
  // per-table flag (bumped when new columns are added) so re-hiding still
  // sticks. Only ADDs; never removes a column.
  useEffect(() => {
    if (!settings) return;
    const nextTablePrefs = { ...(settings.tablePrefs || {}) };
    let touchedRemote = false;
    for (const tid of ['clients', 'oldclients']) {
      const flag = `clients-view:mig-tier-cols-v2-${tid}`;
      let alreadyDone = true;
      try { alreadyDone = !!localStorage.getItem(flag); } catch { /* storage blocked */ }
      if (alreadyDone) continue;
      const remote = settings.tablePrefs?.[tid]?.visible;
      let lsSaved = null;
      try {
        const raw = JSON.parse(localStorage.getItem(`prospect-col-visible-${tid}`));
        if (Array.isArray(raw)) lsSaved = raw;
      } catch { /* ignore malformed */ }
      // Firestore prefs win when present; else the local set. No saved
      // customization at all means every column already shows.
      const saved = Array.isArray(remote) && remote.length > 0
        ? remote
        : (Array.isArray(lsSaved) && lsSaved.length > 0 ? lsSaved : null);
      try { localStorage.setItem(flag, '1'); } catch { /* storage blocked */ }
      if (!saved) continue;
      const next = [...saved];
      let changed = false;
      // Tier sits after CDM; Target Tier sits right after Tier.
      if (!next.includes('tier')) {
        const cdmIdx = next.indexOf('cdm');
        if (cdmIdx >= 0) next.splice(cdmIdx, 0, 'tier'); else next.push('tier');
        changed = true;
      }
      if (!next.includes('targetTier')) {
        const tierIdx = next.indexOf('tier');
        if (tierIdx >= 0) next.splice(tierIdx + 1, 0, 'targetTier'); else next.push('targetTier');
        changed = true;
      }
      if (!changed) continue;
      try { localStorage.setItem(`prospect-col-visible-${tid}`, JSON.stringify(next)); } catch { /* storage blocked */ }
      nextTablePrefs[tid] = { ...(settings.tablePrefs?.[tid] || {}), visible: next };
      touchedRemote = true;
    }
    if (touchedRemote && updateSettings) updateSettings({ tablePrefs: nextTablePrefs });
  }, [settings, updateSettings]);

  // Same one-time injection for the Master Analysis column, under its own
  // flag so users who already ran the Tier migration still get it.
  useEffect(() => {
    if (!settings) return;
    const nextTablePrefs = { ...(settings.tablePrefs || {}) };
    let touchedRemote = false;
    for (const tid of ['clients', 'oldclients']) {
      const flag = `clients-view:mig-master-analysis-col-${tid}`;
      let alreadyDone = true;
      try { alreadyDone = !!localStorage.getItem(flag); } catch { /* storage blocked */ }
      if (alreadyDone) continue;
      const remote = settings.tablePrefs?.[tid]?.visible;
      let lsSaved = null;
      try {
        const raw = JSON.parse(localStorage.getItem(`prospect-col-visible-${tid}`));
        if (Array.isArray(raw)) lsSaved = raw;
      } catch { /* ignore malformed */ }
      const saved = Array.isArray(remote) && remote.length > 0
        ? remote
        : (Array.isArray(lsSaved) && lsSaved.length > 0 ? lsSaved : null);
      try { localStorage.setItem(flag, '1'); } catch { /* storage blocked */ }
      if (!saved || saved.includes('masterAnalysis')) continue;
      // Sits right after Sites, matching the column order below.
      const next = [...saved];
      const sitesIdx = next.indexOf('numberOfSites');
      if (sitesIdx >= 0) next.splice(sitesIdx + 1, 0, 'masterAnalysis');
      else next.push('masterAnalysis');
      try { localStorage.setItem(`prospect-col-visible-${tid}`, JSON.stringify(next)); } catch { /* storage blocked */ }
      nextTablePrefs[tid] = { ...(settings.tablePrefs?.[tid] || {}), visible: next };
      touchedRemote = true;
    }
    if (touchedRemote && updateSettings) updateSettings({ tablePrefs: nextTablePrefs });
  }, [settings, updateSettings]);

  // Same one-time injection for the Sites / Accounts pair. Accounts is new,
  // and Sites — while it has always existed — may sit under "Hidden columns"
  // for anyone who trimmed it, which would leave the pair half-shown. Its own
  // flag so users who already ran the earlier migrations still get it.
  useEffect(() => {
    if (!settings) return;
    const nextTablePrefs = { ...(settings.tablePrefs || {}) };
    let touchedRemote = false;
    for (const tid of ['clients', 'oldclients']) {
      const flag = `clients-view:mig-sites-accounts-cols-${tid}`;
      let alreadyDone = true;
      try { alreadyDone = !!localStorage.getItem(flag); } catch { /* storage blocked */ }
      if (alreadyDone) continue;
      const remote = settings.tablePrefs?.[tid]?.visible;
      let lsSaved = null;
      try {
        const raw = JSON.parse(localStorage.getItem(`prospect-col-visible-${tid}`));
        if (Array.isArray(raw)) lsSaved = raw;
      } catch { /* ignore malformed */ }
      const saved = Array.isArray(remote) && remote.length > 0
        ? remote
        : (Array.isArray(lsSaved) && lsSaved.length > 0 ? lsSaved : null);
      try { localStorage.setItem(flag, '1'); } catch { /* storage blocked */ }
      if (!saved) continue;
      const next = [...saved];
      let changed = false;
      // Sites goes back after Services; Accounts right after Sites, matching
      // the column order below.
      if (!next.includes('numberOfSites')) {
        const servicesIdx = next.indexOf('services');
        if (servicesIdx >= 0) next.splice(servicesIdx + 1, 0, 'numberOfSites');
        else next.push('numberOfSites');
        changed = true;
      }
      if (!next.includes('numberOfAccounts')) {
        const sitesIdx = next.indexOf('numberOfSites');
        if (sitesIdx >= 0) next.splice(sitesIdx + 1, 0, 'numberOfAccounts');
        else next.push('numberOfAccounts');
        changed = true;
      }
      if (!changed) continue;
      try { localStorage.setItem(`prospect-col-visible-${tid}`, JSON.stringify(next)); } catch { /* storage blocked */ }
      nextTablePrefs[tid] = { ...(settings.tablePrefs?.[tid] || {}), visible: next };
      touchedRemote = true;
    }
    if (touchedRemote && updateSettings) updateSettings({ tablePrefs: nextTablePrefs });
  }, [settings, updateSettings]);

  // User-configurable column-to-Dropdowns-list bindings, mirroring the
  // Deals / Opps 2 "Link columns" feature. Lets the Status column on
  // this table pull picks from a Dropdowns-tab list.
  const columnLinks = settings?.clientsColumnLinks || {};
  const updateColumnLinks = (next) => {
    updateSettings?.({ clientsColumnLinks: next || {} });
  };
  const dropdownLists = useMemo(
    () => getEffectiveDropdownLists(settings),
    // The Solutions list is served unioned with the services board layout
    // (see mergeBoardServices), so it moves when a service is filed into a
    // box as well as when a list is edited.
    [settings?.dropdownLists, settings?.customServiceCategories]
  );
  const listRegistry = useMemo(() => buildListRegistry(dropdownLists), [dropdownLists]);
  const availableLists = useMemo(() => buildAvailableLists(dropdownLists), [dropdownLists]);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Result banner for the last import, so a bulk write says what it did
  // rather than just repainting the table.
  const [importNote, setImportNote] = useState('');

  // Group deals by client. A row's raw Client Name is preferred, but
  // when the user has explicitly mapped that source name to a different
  // client via the helper column on the Deals subtab, we group it
  // under the mapped name instead.
  const dealsByClient = useMemo(() => {
    const map = new Map();
    for (const d of dealsList) {
      const raw = normClientName(d['Client Name']);
      if (!raw) continue;
      const mapped = clientMap[raw];
      const k = mapped ? normClientName(mapped) : raw;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(d);
    }
    return map;
  }, [dealsList, clientMap]);

  function toggleExpand(id) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Only the configured user's clients. Filter to the tab's primary
  // Status by default, or include the other bucket when the toggle is on.
  const clients = useMemo(() => (
    prospects
      .filter(p => matchesCdm(p.cdm, cdmName))
      .filter(p => primaryMatch(p) || (showOld && secondaryMatch(p)))
      .sort((a, b) => (a.company || '').localeCompare(b.company || ''))
  ), [prospects, showOld, cdmName, primaryMatch, secondaryMatch]);

  // Resolver for the Tier a client inherits from the Target Accounts list
  // it's mapped to (explicit My Accounts mapping first, fuzzy name match as
  // fallback). Rebuilt when the target book, CDM, or mapping changes.
  const resolveTargetTier = useMemo(
    () => buildTargetTierResolver({ targetAccountsData, cdmName, settings }),
    [targetAccountsData, cdmName, settings?.targetMap, settings?.targetCdmColumn]
  );

  const q = query.trim().toLowerCase();
  const filtered = q
    ? clients.filter(c => {
        const ck = normClientName(c.company);
        return (
          (c.company || '').toLowerCase().includes(q) ||
          (c.cdm || '').toLowerCase().includes(q) ||
          (c.tier || '').toLowerCase().includes(q) ||
          (resolveTargetTier(c).tier || '').toLowerCase().includes(q) ||
          (c.type || '').toLowerCase().includes(q) ||
          (c.website || '').toLowerCase().includes(q) ||
          (managerMap[ck] || '').toLowerCase().includes(q) ||
          (statusMap[ck] || '').toLowerCase().includes(q)
        );
      })
    : clients;

  const myProspects = useMemo(() => prospects.filter(p => matchesCdm(p.cdm, cdmName)), [prospects, cdmName]);
  const activeCount = myProspects.filter(primaryMatch).length; // primary bucket for this tab
  const oldCount = myProspects.filter(secondaryMatch).length;  // the "Include …" bucket

  // Diagnostic counts for the empty state.
  const totalProspects = prospects.length;
  const allClients = useMemo(() => prospects.filter(primaryMatch).length, [prospects, primaryMatch]);
  const uniqueCdms = useMemo(() => {
    const s = new Set();
    for (const p of prospects) {
      const v = (p.cdm || '').trim();
      if (v) s.add(v);
    }
    return Array.from(s).sort();
  }, [prospects]);

  // Master Analysis status per client. Saves made from Utility Lookup
  // stamp a lightweight `indicativeAnalysisMeta` marker on the prospect
  // record, so most rows resolve with no extra reads (and a save made
  // while this page is open shows up as soon as the record syncs).
  // Analyses saved before that marker existed live only in the prospect's
  // /analyses subcollection, so rows without a marker get one metadata-
  // only document read each rather than wrongly reading "Not saved".
  const [analysisProbes, setAnalysisProbes] = useState({});
  useEffect(() => {
    let cancelled = false;
    const ids = clients
      .filter(c => c?.id && !c.indicativeAnalysisMeta)
      .map(c => c.id);
    if (ids.length === 0) return undefined;
    (async () => {
      // Cache hits resolve without a read, so a batch mixing known and
      // unknown ids costs only the unknown ones.
      for (let i = 0; i < ids.length; i += ANALYSIS_PROBE_BATCH) {
        const batch = ids.slice(i, i + ANALYSIS_PROBE_BATCH);
        const metas = await Promise.all(batch.map(id => (
          analysisMetaCache.has(id)
            ? analysisMetaCache.get(id)
            : getIndicativeAnalysisMeta(id).catch(() => null)
        )));
        if (cancelled) return;
        const found = {};
        batch.forEach((id, j) => {
          analysisMetaCache.set(id, metas[j] || null);
          found[id] = metas[j] || null;
        });
        setAnalysisProbes(prev => ({ ...prev, ...found }));
      }
    })();
    return () => { cancelled = true; };
  }, [clients]);

  const rows = useMemo(() => filtered.map(c => {
    const ck = normClientName(c.company);
    const clientDeals = dealsByClient.get(ck) || [];
    const next = soonestExpiration(clientDeals);
    const untracked = !!untrackedMap[ck];
    const tt = resolveTargetTier(c);
    // Marker on the record first, then the probe. `undefined` means the
    // probe hasn't come back yet — distinct from a probe that returned
    // nothing, so the cell can say "checking" instead of "not saved".
    const analysis = c.indicativeAnalysisMeta
      || (c.id && Object.prototype.hasOwnProperty.call(analysisProbes, c.id) ? analysisProbes[c.id] : undefined);
    return {
      ...c,
      id: c.id,
      masterAnalysis: analysis || null,
      masterAnalysisChecked: analysis !== undefined,
      targetTier: tt.tier,
      targetTierName: tt.name,
      targetTierSource: tt.source,
      services: getServicesCount(c),
      contractCount: clientDeals.length,
      soonestExpiration: next.date,
      // Untracked rows blank Days Until so they fall through the
      // default ascending sort (nulls go last) and don't compete with
      // active accounts for attention.
      daysUntilExpiration: untracked ? null : next.days,
      clientManager: managerMap[ck] || '',
      inPersonMeeting: !!inPersonMap[ck],
      invitedToLouisville: !!louisvilleMap[ck],
      Status: statusMap[ck] || '',
      // Days left before a "Reached out to CM" status auto-clears (null for
      // any other status, or until the set-at stamp is backfilled below).
      reachedOutDaysLeft: isReachedOutToCM(statusMap[ck]) ? reachedOutDaysLeft(statusSetAtMap[ck]) : null,
      notes: notesMap[ck] || '',
      untracked,
    };
  }), [filtered, dealsByClient, managerMap, inPersonMap, louisvilleMap, statusMap, statusSetAtMap, notesMap, untrackedMap, resolveTargetTier, analysisProbes]);

  // Drive the "Reached out to CM" 30-day timer: start the clock for any such
  // status that has no stamp yet (e.g. set before this shipped), and clear
  // the status once the window has elapsed. Scans the CDM's client list on
  // every relevant change; each branch only writes when something actually
  // needs doing, so it settles rather than looping.
  useEffect(() => {
    for (const c of clients) {
      const ck = normClientName(c.company);
      if (!isReachedOutToCM(statusMap[ck])) continue;
      const setAt = statusSetAtMap[ck];
      if (!setAt) { setClientStatusSetAt(c.company, todayISODate()); continue; }
      const left = reachedOutDaysLeft(setAt);
      if (left != null && left <= 0) setClientStatus(c.company, '');
    }
  }, [clients, statusMap, statusSetAtMap]);

  const columns = useMemo(() => [
    {
      key: 'company', label: 'Company', defaultWidth: 260, sticky: true,
      render: (row) => {
        const isOpen = expandedIds.has(row.id);
        const count = row.contractCount;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleExpand(row.id); }}
              title={count > 0 ? `${isOpen ? 'Hide' : 'Show'} ${count} contract${count === 1 ? '' : 's'}` : 'No contracts uploaded for this client'}
              style={{
                width: 18, height: 18, padding: 0, border: '1px solid #CBD5E1', borderRadius: 4,
                background: isOpen ? '#1E293B' : '#FFFFFF', color: isOpen ? '#FFFFFF' : '#475569',
                fontSize: '0.65rem', lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >{isOpen ? '▾' : '▸'}</button>
            <span style={{ fontWeight: 600, color: '#1E293B' }}>{row.company || '-'}</span>
          </span>
        );
      },
    },
    {
      key: 'status', label: 'Account Status', defaultWidth: 130,
      render: (row) => {
        const isOld = isOldClient(row);
        return (
          <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: isOld ? '#F1F5F9' : '#DCFCE7', color: isOld ? '#64748B' : '#166534' }}>
            {row.status || '-'}
          </span>
        );
      },
    },
    {
      key: 'Status', label: 'Renewal Status', defaultWidth: 160,
      getSortValue: (row) => (row.Status || '').toLowerCase(),
      getFilterValue: (row) => row.Status || '',
      render: (row) => {
        const link = resolveColumnLink('Status', columnLinks);
        let cell;
        if (link) {
          const opts = listRegistry?.get(link.listKey)?.options || [];
          const onChange = (v) => setClientStatus(row.company, v);
          cell = link.mode === 'multi'
            ? <MultiSelectCell value={row.Status} onChange={onChange} options={opts} />
            : <SelectCell value={row.Status} onChange={onChange} options={opts} />;
        } else {
          cell = (
            <ClientStatusTextCell
              company={row.company}
              value={row.Status}
              onCommit={setClientStatus}
            />
          );
        }
        // Countdown badge for the time-boxed "Reached out to CM" status: how
        // many days until it auto-clears (30 days after it was set).
        if (row.reachedOutDaysLeft == null) return cell;
        const left = Math.max(0, row.reachedOutDaysLeft);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ flex: 1, minWidth: 0 }}>{cell}</span>
            <span
              title={`This status auto-clears in ${left} day${left === 1 ? '' : 's'} · ${REACHED_OUT_TIMER_DAYS} days after "Reached out to CM" was set.`}
              style={{ flexShrink: 0, fontSize: '0.64rem', fontWeight: 700, color: left <= 7 ? '#B45309' : '#92400E', background: '#FEF9C3', border: '1px solid #FDE047', borderRadius: 999, padding: '1px 6px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
            >{left}d</span>
          </div>
        );
      },
    },
    {
      key: 'tier', label: 'Tier', defaultWidth: 100,
      // Order Tier 1 → 2 → 3, blanks last, so a Tier sort surfaces the
      // top accounts first regardless of ascending / descending.
      getSortValue: (row) => {
        const m = String(row.tier || '').match(/(\d+)/);
        return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
      },
      getFilterValue: (row) => row.tier || '',
      render: (row) => tierBadge(row.tier),
    },
    {
      key: 'targetTier', label: 'Target Tier', defaultWidth: 120,
      // Tier the account inherits from the Target Accounts list it's
      // mapped to (via My Accounts). Sorts / filters like Tier.
      getSortValue: (row) => {
        const m = String(row.targetTier || '').match(/(\d+)/);
        return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
      },
      getFilterValue: (row) => row.targetTier || '',
      render: (row) => {
        if (!row.targetTier) {
          return <span style={{ color: '#94A3B8' }} title="Not mapped to a Target Account (or the mapped account has no tier). Map it on the My Accounts tab.">-</span>;
        }
        const via = row.targetTierName
          ? `From Target Account "${row.targetTierName}"${row.targetTierSource === 'fuzzy' ? ' (name match)' : ''}`
          : 'From the mapped Target Account';
        return tierBadge(row.targetTier, via);
      },
    },
    { key: 'cdm', label: 'CDM', defaultWidth: 160 },
    {
      key: 'clientManager', label: 'Client Manager', defaultWidth: 180,
      getSortValue: (row) => (row.clientManager || '').toLowerCase(),
      render: (row) => (
        <ClientManagerCell
          company={row.company}
          value={row.clientManager}
          onCommit={setClientManager}
        />
      ),
    },
    {
      key: 'inPersonMeeting', label: 'In Person Meeting', defaultWidth: 150,
      getSortValue: (row) => row.inPersonMeeting ? 1 : 0,
      getFilterValue: (row) => row.inPersonMeeting ? 'Yes' : 'No',
      render: (row) => (
        <InPersonCell
          company={row.company}
          checked={row.inPersonMeeting}
          onChange={setClientInPerson}
        />
      ),
    },
    {
      key: 'invitedToLouisville', label: 'Invited to Louisville?', defaultWidth: 160,
      getSortValue: (row) => row.invitedToLouisville ? 1 : 0,
      getFilterValue: (row) => row.invitedToLouisville ? 'Yes' : 'No',
      render: (row) => (
        <InPersonCell
          company={row.company}
          checked={row.invitedToLouisville}
          onChange={setClientLouisville}
        />
      ),
    },
    {
      key: 'untracked', label: "Don't Track", defaultWidth: 110,
      getSortValue: (row) => row.untracked ? 1 : 0,
      getFilterValue: (row) => row.untracked ? 'Yes' : 'No',
      render: (row) => (
        <InPersonCell
          company={row.company}
          checked={row.untracked}
          onChange={setClientUntracked}
        />
      ),
    },
    { key: 'type', label: 'Type', defaultWidth: 140 },
    {
      key: 'services', label: 'Services', defaultWidth: 100,
      render: (row) => (
        <span style={{ color: row.services > 0 ? '#059669' : '#94A3B8', fontWeight: row.services > 0 ? 600 : 400 }}>
          {row.services || '-'}
        </span>
      ),
    },
    {
      key: 'numberOfSites', label: 'Sites', defaultWidth: 90,
      render: (row) => (
        <span style={{ color: '#475569' }}>{row.numberOfSites || '-'}</span>
      ),
    },
    {
      // Utility accounts (bills) behind the client's sites. Same source as
      // the company popup's Number of Accounts: typed there, or stamped by
      // a Utility Lookup save. Sits next to Sites since the two are read
      // together — sites are the portfolio, accounts are what gets billed.
      key: 'numberOfAccounts', label: 'Accounts', defaultWidth: 100,
      render: (row) => (
        <span style={{ color: '#475569' }}>{row.numberOfAccounts || '-'}</span>
      ),
    },
    {
      key: 'masterAnalysis', label: 'Master Analysis', defaultWidth: 140,
      // Whether a Master Analysis has been saved to this company's popup
      // (Utility Lookup → ⬇ Master Analysis → Save to Company). Saved
      // first so a sort surfaces the companies that have one.
      getSortValue: (row) => (row.masterAnalysis ? 1 : 0),
      getFilterValue: (row) => (
        row.masterAnalysis ? 'Saved' : row.masterAnalysisChecked ? 'Not saved' : 'Checking'
      ),
      // The row value is the analysis metadata object, so the export needs
      // its own mapper or every saved row would land as "[object Object]".
      exportValue: (row) => {
        if (!row.masterAnalysis) return row.masterAnalysisChecked ? 'Not saved' : '';
        const when = row.masterAnalysis.savedAt ? new Date(row.masterAnalysis.savedAt) : null;
        return when && !Number.isNaN(when.getTime()) ? `Saved ${fmtDate(when)}` : 'Saved';
      },
      render: (row) => {
        if (!row.masterAnalysis) {
          if (!row.masterAnalysisChecked) {
            return <span style={{ color: '#CBD5E1' }} title="Checking for a saved Master Analysis…">…</span>;
          }
          return (
            <span
              style={{ color: '#94A3B8' }}
              title={`No Master Analysis saved to ${row.company || 'this company'}'s popup. Save one from Utility Lookup: load the sites, then "⬇ Master Analysis" → "Save to Company".`}
            >-</span>
          );
        }
        const meta = row.masterAnalysis;
        const when = meta.savedAt ? new Date(meta.savedAt) : null;
        const whenLabel = when && !Number.isNaN(when.getTime()) ? fmtDate(when) : null;
        const kb = meta.sizeBytes ? ` · ${Math.round(meta.sizeBytes / 1024).toLocaleString()} KB` : '';
        return (
          <span
            title={`${meta.fileName || 'Master Analysis'}: saved ${whenLabel || 'previously'}${kb}. Open this company's popup to download it.`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}
          >
            <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: '#DCFCE7', color: '#166534', whiteSpace: 'nowrap' }}>
              Saved
            </span>
            {whenLabel && (
              <span style={{ fontSize: '0.68rem', color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>{whenLabel}</span>
            )}
          </span>
        );
      },
    },
    {
      key: 'soonestExpiration', label: 'Soonest Expiration', defaultWidth: 150,
      getSortValue: (row) => row.soonestExpiration ? row.soonestExpiration.getTime() : null,
      render: (row) => (
        <span style={{ color: row.soonestExpiration ? '#334155' : '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>
          {row.soonestExpiration ? fmtDate(row.soonestExpiration) : '-'}
        </span>
      ),
    },
    {
      key: 'daysUntilExpiration', label: 'Days Until', defaultWidth: 110,
      getSortValue: (row) => row.daysUntilExpiration == null ? null : row.daysUntilExpiration,
      render: (row) => {
        if (row.daysUntilExpiration == null) return <span style={{ color: '#94A3B8' }}>-</span>;
        const d = row.daysUntilExpiration;
        // Highlight contracts that are inside the typical 90-day renewal window
        // so they pop without the user having to sort the column manually.
        const color = d <= 30 ? '#B91C1C' : d <= 90 ? '#B45309' : '#475569';
        return (
          <span style={{ color, fontWeight: d <= 90 ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}>
            {d}
          </span>
        );
      },
    },
    {
      key: 'website', label: 'Website', defaultWidth: 240,
      render: (row) => {
        if (!row.website) return '-';
        return (
          <a
            href={/^https?:\/\//i.test(row.website) ? row.website : `https://${row.website}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ color: '#0A66C2', textDecoration: 'none', fontSize: '0.72rem' }}
          >
            {row.website}
          </a>
        );
      },
    },
    {
      key: 'notes', label: 'Notes', defaultWidth: 320,
      getSortValue: (row) => (row.notes || '').toLowerCase(),
      getFilterValue: (row) => row.notes || '',
      render: (row) => (
        <NotesCell
          company={row.company}
          value={row.notes}
          onCommit={setClientNotes}
        />
      ),
    },
  ], [expandedIds, columnLinks, listRegistry]);

  const subtabBar = (
    <div style={{ display: 'flex', gap: '0.25rem', padding: '0.5rem 1.25rem 0', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
      {[
        { key: 'clients', label: 'Clients' },
        { key: 'oldclients', label: 'Old Clients' },
        { key: 'deals', label: 'Deals' },
        { key: 'commissions', label: 'Commissions' },
        { key: 'postsale', label: 'Post-Sale Follow-Up' },
        { key: 'contractservices', label: 'Contract Services' },
        { key: 'contractlanguage', label: 'Contract Language' },
      ].map(t => {
        const active = subtab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => selectSubtab(t.key)}
            style={{
              padding: '0.45rem 0.85rem',
              border: '1px solid',
              borderColor: active ? '#CBD5E1' : 'transparent',
              borderBottomColor: active ? '#fff' : 'transparent',
              borderRadius: '6px 6px 0 0',
              marginBottom: -1,
              background: active ? '#fff' : 'transparent',
              color: active ? '#1E293B' : '#64748B',
              fontSize: '0.78rem',
              fontWeight: active ? 700 : 600,
              cursor: active ? 'default' : 'pointer',
              fontFamily: 'inherit',
            }}
          >{t.label}</button>
        );
      })}
    </div>
  );

  if (subtab === 'deals') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {subtabBar}
        <DealsView settings={settings} updateSettings={updateSettings} prospects={prospects} cdmName={cdmName} user={user} addProspect={addProspect} />
      </div>
    );
  }

  if (subtab === 'commissions') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {subtabBar}
        <CommissionsView settings={settings} updateSettings={updateSettings} prospects={prospects} />
      </div>
    );
  }

  if (subtab === 'postsale') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {subtabBar}
        <PostSaleFollowUpView deals={dealsList} onUpdateFollowUp={updateFollowUpOnSale} />
      </div>
    );
  }

  if (subtab === 'contractservices') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {subtabBar}
        <ContractServicesView prospects={prospects} settings={settings} updateSettings={updateSettings} updateProspect={updateProspect} user={user} />
      </div>
    );
  }

  if (subtab === 'contractlanguage') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {subtabBar}
        <ContractLanguageView settings={settings} user={user} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {subtabBar}
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>{headingLabel}</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
            {cdmName ? `${cdmName}'s ${headingLabel.toLowerCase()}` : `Your ${headingLabel.toLowerCase()}`}: every prospect with CDM = {cdmName || 'your CDM'} and <strong>Status = {statusLabel}</strong>
            {showOld ? ` or ${otherLabel}` : ''}. Click ▸ to expand a client&apos;s contracts.
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: '#475569', cursor: 'pointer' }}>
          <input type="checkbox" checked={showOld} onChange={e => setShowOld(e.target.checked)} />
          <span>Include {otherLabel}s ({oldCount})</span>
        </label>
      </div>

      <div style={{ padding: '0 1.25rem 0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter by company, CDM, Tier, Target Tier, Client Manager, Status, type, website…"
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <button
          type="button"
          onClick={() => setLinkModalOpen(true)}
          title="Bind the Status column to a Dropdowns-tab list so the cell picks from a fixed option list."
          style={{ padding: '0.4rem 0.8rem', border: '1px solid #E2E8F0', background: 'white', borderRadius: 6, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >Link columns</button>
        <button
          type="button"
          onClick={() => { setImportNote(''); setImportOpen(true); }}
          title="Paste Company / Client Manager / Renewal Status / Don't Track rows from a spreadsheet to fill these columns in bulk."
          style={{ padding: '0.4rem 0.8rem', border: '1px solid #E2E8F0', background: 'white', borderRadius: 6, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >Import fields</button>
        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
          {filtered.length} of {activeCount}{showOld ? ` ${statusLabel.toLowerCase()} · ${oldCount} ${otherLabel.toLowerCase()}` : ''}
        </span>
      </div>

      {importNote && (
        <div style={{ margin: '0 1.25rem 0.5rem', padding: '0.4rem 0.7rem', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 6, fontSize: '0.74rem', color: '#166534', display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexShrink: 0 }}>
          <span>{importNote}</span>
          <button type="button" onClick={() => setImportNote('')} style={{ background: 'none', border: 'none', color: '#166534', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.74rem' }}>Dismiss</button>
        </div>
      )}

      {/* Always-visible diagnostic strip so 'blank page' is never actually blank. */}
      <div style={{ padding: '0 1.25rem 0.5rem', fontSize: '0.68rem', color: '#64748B', flexShrink: 0 }}>
        Loaded {totalProspects} prospects · {myProspects.length} match CDM &quot;{cdmName || '(unset)'}&quot; · {allClients} are Status={statusLabel} · showing {clients.length}
      </div>

      {/* Legend so the red row tint is self-explanatory on the page. */}
      <div style={{ padding: '0 1.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.68rem', color: '#64748B', flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#FEE2E2', border: '1px solid #FCA5A5', flexShrink: 0 }} />
        <span>
          Red rows need attention: the soonest contract expires within {RENEWAL_WARNING_DAYS} days and the <strong>Status</strong> column is still blank. Set a Status to clear the highlight.
        </span>
        <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#FEF9C3', border: '1px solid #FDE047', flexShrink: 0, marginLeft: '0.6rem' }} />
        <span>Yellow rows are in progress: <strong>Status</strong> is &ldquo;Reached out to CM&rdquo;; the badge counts down the {REACHED_OUT_TIMER_DAYS} days until that status auto-clears.</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {clients.length === 0 ? (
          <div style={{ margin: '0 1.25rem', padding: '1.25rem', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem', textAlign: 'center' }}>No {headingLabel.toLowerCase()} found for {cdmName || 'this user'}</div>
            <div style={{ fontSize: '0.78rem', marginBottom: '0.75rem', textAlign: 'center' }}>
              Set a prospect&apos;s <strong>CDM</strong> to {cdmName || 'your CDM name'} and <strong>Status</strong> to <code>{statusLabel}</code> in My Accounts to list it here.
            </div>
            <div style={{ fontSize: '0.72rem', background: '#F8FAFC', padding: '0.6rem 0.8rem', borderRadius: 6, color: '#334155' }}>
              <div><strong>Diagnostic:</strong></div>
              <div>Total prospects loaded: {totalProspects}</div>
              <div>Prospects matching CDM &quot;{cdmName || '(unset)'}&quot;: {myProspects.length}</div>
              <div>Prospects with Status = {statusLabel}: {allClients}</div>
              <div>{cdmName || 'Your CDM'} + {statusLabel}: {activeCount}</div>
              {totalProspects === 0 && (
                <div style={{ color: '#B91C1C', marginTop: '0.5rem' }}>
                  Prospects haven&apos;t loaded yet. If this sticks, check your network / login.
                </div>
              )}
              {totalProspects > 0 && myProspects.length === 0 && uniqueCdms.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div>No CDM value matches &quot;{cdmName || '(unset)'}&quot;. Unique CDMs in your data:</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', marginTop: '0.25rem', maxHeight: '120px', overflow: 'auto', background: '#fff', padding: '0.4rem', borderRadius: 4 }}>
                    {uniqueCdms.slice(0, 40).map((c, i) => <div key={i}>{c}</div>)}
                    {uniqueCdms.length > 40 && <div>… and {uniqueCdms.length - 40} more</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <DataTable
            tableId={tableId}
            exportFileName={isOldMode ? 'Old Clients export' : 'Clients export'}
            columns={columns}
            rows={rows}
            alwaysVisible={['company']}
            defaultSort={{ key: 'daysUntilExpiration', direction: 'asc' }}
            rowStyle={(row) => {
              // Untracked clients sit greyed at the bottom (Days Until
              // is blanked above so the default ascending sort drops
              // them past every row with a real date).
              if (row.untracked) {
                return { background: '#F1F5F9', color: '#94A3B8' };
              }
              const s = String(row.Status || '').trim();
              // Tint yellow once the user has "Reached out to CM" about a
              // client — these are in progress, distinct from the red rows
              // that still need any status at all.
              if (/reached\s*out/i.test(s) && /\bcm\b/i.test(s)) {
                return { background: '#FEF9C3' };
              }
              // Tint the row light red when a renewal is closing in
              // (<270 days) and the Status column is unset — those are
              // the clients that need a status set before they slip.
              const noStatus = s === '' || s === '-' || s === '\u2014' || s === '\u2013';
              if (row.daysUntilExpiration != null && row.daysUntilExpiration < RENEWAL_WARNING_DAYS && noStatus) {
                return { background: '#FEE2E2' };
              }
              return undefined;
            }}
            expandedRowIds={expandedIds}
            renderExpansion={(row) => (
              <ContractTable deals={dealsByClient.get(normClientName(row.company)) || []} />
            )}
            emptyMessage={q ? `No clients match "${query}"` : 'No clients to display'}
            enableColumnFilters
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
      </div>
      {importOpen && (
        <ClientFieldsPasteModal
          // Match against every client this CDM has, old ones included, so a
          // pasted row still lands when the "Include Old Clients" toggle is
          // off — the toggle is a view filter, not a statement about which
          // clients exist.
          companies={myProspects
            .filter(p => primaryMatch(p) || secondaryMatch(p))
            .map(p => p.company)
            .filter(Boolean)}
          current={{
            manager: managerMap, status: statusMap, notes: notesMap,
            inPerson: inPersonMap, louisville: louisvilleMap, untracked: untrackedMap,
          }}
          onApply={(writes) => {
            // Each write goes through the same setter a typed edit uses, so
            // the change events fire and the Firestore mirror picks it up.
            const setters = {
              manager: setClientManager, status: setClientStatus, notes: setClientNotes,
              inPerson: setClientInPerson, louisville: setClientLouisville, untracked: setClientUntracked,
            };
            const touched = new Set();
            for (const w of writes) {
              const fn = setters[w.key];
              if (!fn) continue;
              fn(w.company, w.value);
              touched.add(w.company);
            }
            setImportOpen(false);
            setImportNote(`Imported ${writes.length} value${writes.length === 1 ? '' : 's'} across ${touched.size} client${touched.size === 1 ? '' : 's'}.`);
          }}
          onClose={() => setImportOpen(false)}
        />
      )}
      {linkModalOpen && (
        <LinkColumnsModal
          headers={['Status']}
          columnLinks={columnLinks}
          listRegistry={listRegistry}
          availableLists={availableLists}
          onChange={updateColumnLinks}
          onClose={() => setLinkModalOpen(false)}
        />
      )}
    </div>
  );
}
