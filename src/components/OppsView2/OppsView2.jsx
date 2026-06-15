import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { doc, collection, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { ContactEditModal } from '../ProspectModal/ProspectModal';
import { toggleContactInEvents } from '../../utils/eventsStore';
import { DataTable } from '../common/DataTable';
import {
  buildListRegistry,
  buildAvailableLists,
  parseMulti,
  resolveColumnLink as resolveSharedColumnLink,
  SelectCell,
  MultiSelectCell,
  LinkColumnsModal,
} from '../common/columnLinks';
import { getEffectiveDropdownLists } from '../../utils/dropdownListsStore';
import { dbGet } from '../../utils/db';
import {
  OPPS2_FIRESTORE_COLLECTION,
  loadOpps2Cache,
  saveOpps2Cache,
  loadOpps2FromFirestore,
  saveOpps2ToFirestore,
  trySaveOpps2ToFirestore,
  flushOpps2ToFirestore,
  mergeOpps2Datasets,
} from '../../utils/opps2Store';
import { pushOpps2Backup } from '../../utils/opps2Backup';
import { loadOptionLinks, setOppOptionLink, OPTION_LINKS_EVENT } from '../../utils/pricingOptionLinks';
import { OPPS_PRICING_SNAPSHOT_EVENT } from '../../utils/oppsPricingSnapshot';
import { fmtMoneyWhole, toNum, unitCountOrOne, rowYearRevenue } from '../../utils/pricingOptionCalc';
import { getHubspotContacts } from '../../utils/hubspotContactsCache';
import { normalizeCompany } from '../../utils/companyNorm';
import { userLsGet, userLsSet } from '../../utils/userLs';
import { computeListFlags } from '../../utils/listFlags';
import { splitPeOwners, joinPeOwners } from '../../utils/peOwners';
import { TYPES, FRAMEWORKS } from '../../data/enums';
import { NewOppsScheduleModal } from './NewOppsScheduleModal';
import { downloadNewOppsOutlookDraft } from '../../utils/newOppsDigestEmail';
import { DEFAULT_EMAIL_SIGNATURE } from '../../data/emailSignature';
import { buildNewOppsTableHtml, downloadOppsTableOutlookDraft, NEW_OPPS_EMAIL_COLUMNS, NEW_OPPS_EMAIL_DEFAULT_COLUMN_KEYS } from '../../utils/newOppsEmailTable';
import styles from './OppsView2.module.css';

// Second Opps tab — user-entered opps stored in Firestore
// (`opps2Data/{uid}`) with an IndexedDB cache (`opps2-cache`, key
// `data`) for instant rehydration on reload. The original Opps tab
// stays the canonical Google Sheets view; Opps 2 is the place the
// user types new opps directly into the app.

// Opps 2 persistence (IndexedDB cache + chunked Firestore doc) lives in
// utils/opps2Store.js so other views can read/write through the same
// path; see the imports above.

// Detail-row visibility. The Opp details popup lets the user hide rows
// (header fields) they don't care to see. The choice is a single global
// preference applied to *every* opp's detail view (not per-opp) and is
// persisted in user-scoped localStorage so it survives reloads and is
// shared across the Opps 2 and Agents detail popups. Stored as a JSON
// array of field names.
const OPP_DETAIL_HIDDEN_FIELDS_KEY = 'opp-detail-hidden-fields';

// Per-user localStorage key holding the "No Further Action Today" clear
// schedules — one per mark type. These replace the old fixed
// start-of-day blank-all + 2 PM X sweep with user-configured
// day-of-week + time schedules set from the toolbar button.
const NFAT_SCHEDULES_KEY = 'opps2-nfat-schedules';

// The three things a schedule can clear from the tristate column:
// ✓ checks, ✗ X marks, or any non-blank value. Each gets its own
// independent schedule (days of week + time of day).
const NFAT_SCHEDULE_TYPES = ['check', 'x', 'any'];
const NFAT_TYPE_LABELS = { check: '✓ Check marks', x: '✗ X marks', any: 'Any value' };

function defaultNfatSchedules() {
  const base = { enabled: false, days: [1, 2, 3, 4, 5], time: '06:00', lastRunAt: 0 };
  return { check: { ...base }, x: { ...base }, any: { ...base } };
}

// Load the saved schedules, merged onto defaults so a partial/older
// stored shape still yields a complete config for every type.
function loadNfatSchedules() {
  const def = defaultNfatSchedules();
  try {
    const raw = userLsGet(NFAT_SCHEDULES_KEY);
    if (!raw) return def;
    const parsed = JSON.parse(raw);
    for (const t of NFAT_SCHEDULE_TYPES) {
      if (parsed && parsed[t]) def[t] = { ...def[t], ...parsed[t] };
    }
  } catch { /* fall back to defaults */ }
  return def;
}

// True when the tristate "No Further Action Today" value matches the
// clear type: 'check' for ✓/yes, 'x' for ✗/no, 'any' for anything set.
function nfatValueMatches(value, type) {
  const cur = String(value || '').trim().toLowerCase();
  if (cur === '') return false;
  if (type === 'any') return true;
  if (type === 'check') return cur === 'yes' || cur === 'true' || cur === '✓';
  if (type === 'x') return cur === 'no' || cur === 'false' || cur === '✗';
  return false;
}

function loadHiddenDetailFields() {
  try {
    const raw = userLsGet(OPP_DETAIL_HIDDEN_FIELDS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : []);
  } catch { return new Set(); }
}

function saveHiddenDetailFields(set) {
  try { userLsSet(OPP_DETAIL_HIDDEN_FIELDS_KEY, JSON.stringify([...set])); }
  catch (err) { console.warn('opps2: save hidden detail fields failed', err); }
}

// Default column set, seeded so the table has columns to show / sort /
// filter / hide / resize even before any data exists.
const DEFAULT_HEADERS = [
  'Account', 'Open Year', 'Contact', 'Stage', 'Scope', 'Source', 'Type', 'Sales Partner',
  'Start Date', 'Status', 'Quoted Amount', 'Sites', 'Age',
  'Last Client Heard From Us', 'Last Spoke', 'Follow Up', 'Call In', 'Notes',
  'Next Steps', 'No Further Action Today', 'Competition', 'Waiting On', 'Close Date', 'BFO Link', 'BFO Company Name',
  'Pricing Option',
  // Quote-stage detail columns. Captured via the QuotedFollowUpModal that
  // pops when an opp moves into the "Quoted" stage.
  'Quoted On', 'Chance?', 'Margin Email Date - Sales Leader Review Date',
];

// Key columns to show by default (the rest are available via Columns toggle)
const KEY_COLS = [
  'Account', 'Contact', 'Stage', 'Scope', 'Source', 'Type', 'Sales Partner',
  'Start Date', 'Status', 'Quoted Amount', 'Sites', 'Age',
  'Last Client Heard From Us', 'Last Spoke', 'Follow Up', 'Call In', 'Notes',
  'Next Steps', 'No Further Action Today', 'Competition', 'Waiting On', 'Close Date',
];

// Three-state-checkbox columns. Each cell click cycles
// blank → "Yes" (renders ✓) → "No" (renders ✗) → blank. Stored as
// the literal string so existing string-based filters / exports /
// downstream consumers still work without special handling.
const TRISTATE_COLUMNS = new Set(['No Further Action Today']);

// On-screen display label for an opp column key. The underlying data keys
// stay stable (so stored records, dedup, currency formatting and the stage
// prompts keep working); only the header text the user sees changes. The
// "BFO Link" key reads as "BFO Opportunity Name" and "Quoted Amount" reads
// as "Deal Size".
const HEADER_LABEL_OVERRIDES = {
  'BFO Link': 'BFO Opportunity Name',
  'Quoted Amount': 'Deal Size',
  // The rich per-step column ('Next Steps') reads as "Notes"; the older
  // plain 'Notes' field reads as "Memo" so the two headers don't clash.
  'Next Steps': 'Notes',
  'Notes': 'Memo',
};
function headerLabel(h) {
  return HEADER_LABEL_OVERRIDES[h] || h;
}

// Columns the user wants treated as dates — rendered with a calendar
// popup cell (HTML5 date input) and pre-populated with today on new
// opps so a fresh entry shows useful defaults instead of blanks.
const DATE_COLUMNS = new Set([
  'Start Date', 'Last Client Heard From Us', 'Follow Up',
  // Quote-stage dates, filled from the QuotedFollowUpModal.
  'Quoted On', 'Margin Email Date - Sales Leader Review Date',
]);

// Date columns that should be pre-seeded with today's date on a brand-new
// opp. The quote-stage dates are deliberately excluded — they stay blank
// until the opp actually reaches the Quoted stage.
const SEED_TODAY_DATE_COLUMNS = new Set(['Start Date', 'Last Client Heard From Us', 'Follow Up']);

// "New Opps" report — the actively-working, freshly-progressing opps
// surfaced in the New Opps subtab and the auto-emailed digest. An opp
// qualifies when it has a BFO Opportunity Name, its current Stage is Lead,
// Qualifying, or Quoting (which also excludes "Not Started"), and its
// *combined* time across the Lead + Qualifying + Quoting stages is at most
// NEW_OPPS_MAX_STAGE_AGE_DAYS days. These column keys drive the on-screen
// subtab and its Excel export; the emailed table uses its own fixed set
// (NEW_OPPS_EMAIL_COLUMNS in api/_lib/newOpps.js). "BFO Link" stores the
// BFO Opportunity Name; "BFO Address" is the live Salesforce URL.
const NEW_OPPS_MAX_STAGE_AGE_DAYS = 7;
const NEW_OPPS_ACTIVE_STAGES = ['Lead', 'Qualifying', 'Quoting'];
const NEW_OPPS_ACTIVE_STAGES_SET = new Set(NEW_OPPS_ACTIVE_STAGES);
const NEW_OPPS_REPORT_COLUMNS = [
  'Account', 'Open Year', 'Contact', 'Stage', 'Scope', 'Source', 'Type',
  'Sales Partner', 'Start Date', 'Status', 'Quoted Amount', 'Sites', 'Next Steps',
  'BFO Link', 'BFO Address',
];

const MONTH_FULL_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Parse a free-text Close Date into a Date. Accepts ISO (2026-06-01)
// and locale/US (6/1/2026, "June 1, 2026") entries. Returns null when
// the text isn't a recognizable date so a typo never clobbers the
// derived Close Year / Close Month columns.
function parseCloseDate(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const ts = Date.parse(s);
  if (Number.isNaN(ts)) return null;
  const d = new Date(ts);
  // Date.parse reads a bare ISO date (YYYY-MM-DD) as UTC midnight, which
  // can land on the previous day in a negative-offset timezone. Pull the
  // UTC parts back for ISO strings; slash/locale strings parse as local
  // so getFullYear/getMonth are already correct there.
  if (/^\d{4}-\d{2}/.test(s)) return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return d;
}

// Locate the "Close Year" / "Close Month" columns to auto-fill from a
// Close Date. Matched loosely (Close/Closed, optional space) so it works
// regardless of the exact label in the user's imported headers.
const CLOSE_YEAR_RE = /^closed?\s*year$/;
const CLOSE_MONTH_RE = /^closed?\s*month$/;
function findCloseDerivedColumns(headers) {
  const yearCols = [];
  const monthCols = [];
  for (const h of (headers || [])) {
    const norm = String(h || '').trim().toLowerCase();
    if (CLOSE_YEAR_RE.test(norm)) yearCols.push(h);
    else if (CLOSE_MONTH_RE.test(norm)) monthCols.push(h);
  }
  return { yearCols, monthCols };
}

// Stages the Days-in-Stage tab reports on. Ordered to mirror the
// pipeline progression so a row stays under one bucket as it moves
// forward. Closed stages (Sold / Not Sold) are intentionally excluded
// — the tab tracks how long active opps are stalling in each step.
const TRACKED_STAGES = ['Not Started', 'Lead', 'Qualifying', 'Quoting', 'Quoted', 'Contracting', 'Agreement Sent'];
const TRACKED_STAGES_SET = new Set(TRACKED_STAGES);

// Closed (won/lost) stages — an opp in one of these is no longer active.
// Mirrors the in-component CLOSED_STAGES used by the activity filter.
const CLOSED_STAGES_SET = new Set(['Sold', 'Not Sold']);

// Stage-specific "stalled too long" thresholds. An opp that has sat in
// one of these stages for more than `days` calendar days surfaces in the
// Days-in-Stage "Needs action" buckets with the paired suggestion. Stages
// not listed (Quoting, Contracting, Agreement Sent) have no threshold, so
// they never raise an action prompt.
const STAGE_ACTION_THRESHOLDS = {
  'Not Started': { days: 120, suggestion: 'Qualify or kill' },
  'Lead':        { days: 90,  suggestion: 'Qualify or kill' },
  'Qualifying':  { days: 60,  suggestion: 'Quote or kill' },
  'Quoted':      { days: 90,  suggestion: 'Contract or kill' },
};

// Pull-through opps ride along with a parent sale rather than running
// their own pipeline, so they're excluded from the Days-in-Stage view.
// Matched on the Scope text, mirroring PipelineView's close-rate filter.
const PULL_THROUGH_RE = /pull[\s-]?through/i;

// The stage-action rule an opp has tripped, or null if it's within the
// limit (or its stage has no limit). Shared by the kanban so flagged opps
// can render inline with their suggestion instead of in a separate list.
function stageActionFor(stage, days) {
  const rule = STAGE_ACTION_THRESHOLDS[stage];
  if (!rule || days == null || days <= rule.days) return null;
  return rule;
}

// Read-only columns whose value is derived from other cells.
//   Call In    = calendar days from today to the Follow Up date
//   Last Spoke = business days from Last Client Heard From Us to today
// Always append these to header sets loaded from the legacy Opps cache
// so they show up even when the cached headers predate the columns.
const COMPUTED_COLUMNS = ['Last Spoke', 'Call In'];

// Columns that should always be present on hydration even when the
// saved header set predates them. Includes the computed columns
// plus Next Steps (introduced after the original layout shipped) so
// users who saved their layout before this column existed still pick
// it up — and its "Find out the Story" default lands somewhere
// visible on the next new opp.
const ENSURED_COLUMNS = [...COMPUTED_COLUMNS, 'Next Steps', 'Pricing Option', 'No Further Action Today', 'Sales Partner',
  'Quoted On', 'Chance?', 'Margin Email Date - Sales Leader Review Date', 'BFO Company Name', 'PE Owner'];

// Strips zero-width / BOM characters. Built with fromCharCode so the
// source stays pure ASCII — embedding the literal invisible characters
// (or relying on \u escapes that tooling can mangle) is fragile.
const ZERO_WIDTH_RE = new RegExp([0x200B, 0x200C, 0x200D, 0xFEFF].map(c => String.fromCharCode(c)).join('|'), 'g');

// Normalize a cell value for matching: drop zero-width chars, trim, and
// casefold. Imported or pasted opps sometimes carry invisible characters
// or odd casing (e.g. a trailing zero-width space) that would otherwise
// dodge an exact string match even though the cell *looks* right in the UI.
function normCell(s) {
  return String(s ?? '').replace(ZERO_WIDTH_RE, '').trim().toLowerCase();
}

// The Flags column carries the auto USD 🚩. Match the header tolerantly
// (casing / whitespace / invisible chars, "Flag" or "Flags") so the
// indicator still renders if the saved column name isn't an exact
// "Flags" — otherwise the cell falls back to a plain text editor and the
// flag never shows.
function isFlagsColumn(h) {
  const n = normCell(h);
  return n === 'flags' || n === 'flag';
}

// Stages at or before Lead — these never warrant a USD value, so they
// never flag. Everything else (Qualifying, Quoting, Quoted, Contracting,
// Agreement Sent, Repricing, Sold, Not Sold, plus any future / legacy
// stage label) counts as "past Lead". Using an exclusion list rather than
// an allow list means an unexpected stage name still flags, matching the
// rule "anything past a Lead stage".
const STAGES_AT_OR_BEFORE_LEAD = new Set(['lead', 'not started', 'duplicate opp']);

// True when a row has progressed past Lead but the (often hidden) `USD?`
// column has no real value — blank, or just a dash / currency placeholder
// like "-", "—", "$-", or " - ". Stripping zero-width chars, currency
// symbols, commas, whitespace and every dash variant leaves an empty
// string only when there's no actual number behind it; a real figure such
// as "-500" or "$1,500" survives and won't flag. Surfaced as a 🚩 in the
// Flags column so the gap is visible at a glance without unhiding USD?.
function needsUsdFlag(row) {
  if (!row) return false;
  const stage = normCell(row['Stage']);
  if (!stage || STAGES_AT_OR_BEFORE_LEAD.has(stage)) return false;
  const usd = String(row['USD?'] ?? '')
    .replace(ZERO_WIDTH_RE, '')
    .replace(/[\s$,]/g, '')
    .replace(/[-–—−]/g, '');
  return usd === '';
}

// Record-level merge lives in opps2Store as `mergeOpps2Datasets` so the
// real-time listener, hydration reconcile, and the guarded flush all
// resolve conflicts identically (field-level by `_fieldUpdatedAt`).

// Build the `_fieldUpdatedAt` map for an edit: carry the row's prior
// per-field stamps forward and set `now` on every field that changed
// between `prev` and `next`. Lets the merge resolve concurrent edits to
// different fields of the same opp without one clobbering the other.
function stampChangedFields(prev, next, now) {
  const stamps = { ...(prev._fieldUpdatedAt || {}) };
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (k === '_fieldUpdatedAt' || k === '_rowUpdatedAt') continue;
    if (next[k] !== prev[k]) stamps[k] = now;
  }
  return stamps;
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Normalize a user-entered Quoted Amount to "$25,000" — USD currency
// with thousands separators and no decimals. Anything that doesn't
// parse to a number (empty, or legacy free-text like "TBD") is returned
// trimmed and unchanged so it isn't silently wiped.
function formatQuotedAmount(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  // Drop currency symbols, commas, and spaces; keep digits, sign, dot.
  const cleaned = s.replace(/[^0-9.-]/g, '');
  const n = Number(cleaned);
  if (cleaned === '' || !Number.isFinite(n)) return s;
  return fmtMoneyWhole(Math.round(n));
}

// Live-format the Amount field as the user types in the Quoted Amount
// popup, so the "$" and thousands separators appear on the fly (e.g.
// typing "25000" shows "$25,000"). Keeps a trailing decimal point and
// cents the user is mid-entering. Non-numeric free text (e.g. "TBD") is
// passed through untouched so legacy values stay editable.
function formatQuotedAmountLive(raw) {
  const s = String(raw ?? '');
  if (!s.trim()) return '';
  // Keep only digits and decimal points; drop "$", commas, spaces, etc.
  const cleaned = s.replace(/[^0-9.]/g, '');
  if (cleaned === '') return s.trim(); // free text like "TBD" — leave it
  const firstDot = cleaned.indexOf('.');
  const hasDot = firstDot !== -1;
  let intPart = hasDot ? cleaned.slice(0, firstDot) : cleaned;
  // Collapse any extra decimal points and cap cents at two digits.
  const decPart = hasDot ? cleaned.slice(firstDot + 1).replace(/\./g, '').slice(0, 2) : '';
  intPart = intPart.replace(/^0+(?=\d)/, ''); // trim leading zeros
  const withCommas = (intPart || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${withCommas}${hasDot ? `.${decPart}` : ''}`;
}

function makeBlankOpp(id, headers, accountOverride, sourceOverride, peOwnerOverride) {
  const row = { _id: id, id, _rowUpdatedAt: Date.now() }; // id mirrored so DataTable's row key stays stable across edits
  const cols = (Array.isArray(headers) && headers.length) ? headers : DEFAULT_HEADERS;
  for (const h of cols) row[h] = '';
  // Leave Account blank when there's no override so the inline cell
  // autocomplete (fed from Table View companies) starts surfacing
  // matches the moment the user types — instead of having to first
  // clear a placeholder string.
  row['Account'] = typeof accountOverride === 'string' && accountOverride.trim() ? accountOverride.trim() : '';
  row['Open Year'] = String(new Date().getFullYear());
  row['Stage'] = 'Not Started';
  row['Status'] = 'Client waiting on ESS team member';
  // Default Scope to AEM (the most common service the user tags on a
  // new opp) and seed the Next Steps column with the prompt the user
  // always types first. Set unconditionally — even if a column was
  // hidden via the columns toggle the value sticks around for when
  // it's unhidden later.
  row['Scope'] = 'AEM';
  row['Next Steps'] = 'Find out the Story';
  // Seed the BFO Opportunity Name (BFO Link) column with a dash so a
  // brand-new opp reads as "BFO opp still needs to be created" — the
  // same sentinel the rest of the app uses for untagged opps. Set
  // unconditionally so the value sticks even when the column is hidden.
  row['BFO Link'] = '-';
  // Source comes from the New Opp prompt — leave blank when the user
  // skipped the picker so the cell still surfaces its dropdown on
  // click.
  if (typeof sourceOverride === 'string' && sourceOverride.trim()) {
    row['Source'] = sourceOverride.trim();
  }
  // PE Owner comes from the New Opp prompt — set only when provided so a
  // blank still surfaces the column's autocomplete on click.
  if (typeof peOwnerOverride === 'string' && peOwnerOverride.trim() && cols.includes('PE Owner')) {
    row['PE Owner'] = peOwnerOverride.trim();
  }
  // Default the three date columns the user tracks day-to-day to
  // today's date. Stored as ISO (YYYY-MM-DD) so the HTML5 date input
  // accepts it directly; DateCell displays a localized format.
  const today = todayISO();
  for (const dateCol of SEED_TODAY_DATE_COLUMNS) {
    if (cols.includes(dateCol)) row[dateCol] = today;
  }
  // Seed Call In with an explicit 0 so a brand-new opp shows up
  // in every Call-In-gated view (Days in Stage, Stage History) from
  // the moment it's created. The first time the user picks a Follow
  // Up date, updateOppField drops this stored value so the live
  // compute (days from today to Follow Up) takes over — i.e. the
  // 0 is a starting point, not a manual override that sticks around.
  if (cols.includes('Call In')) row['Call In'] = 0;
  return row;
}

// Header combobox — same prefix-then-substring autocomplete as the
// Account-column EditableCell, but committing a value creates a brand
// new opp pre-filled with that company name instead of mutating a
// single cell. Lets the user surface an existing company by typing a
// few letters; typing something brand-new and pressing Enter still
// works and creates an opp with that new account name.
function AddCompanyCombobox({ suggestions, onCommit, placeholder = 'Add company…' }) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(0);
  const wrapRef = useRef(null);

  const matches = useMemo(() => {
    if (!suggestions?.length) return [];
    const q = String(draft || '').trim().toLowerCase();
    // No query yet — show the first 8 suggestions alphabetically so
    // the dropdown signals "predictive text is available" as soon as
    // the user clicks into the field.
    if (!q) return suggestions.slice(0, 8);
    const prefix = [];
    const sub = [];
    for (const s of suggestions) {
      const lower = String(s).toLowerCase();
      if (lower === q) continue;
      if (lower.startsWith(q)) prefix.push(s);
      else if (lower.includes(q)) sub.push(s);
      if (prefix.length + sub.length >= 25) break;
    }
    return [...prefix, ...sub].slice(0, 8);
  }, [draft, suggestions]);

  function commit(picked) {
    const v = (picked == null ? draft : picked).trim();
    if (!v) return;
    onCommit(v);
    setDraft('');
    setOpen(false);
    setHoverIdx(0);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => { setDraft(e.target.value); setOpen(true); setHoverIdx(0); }}
        onFocus={() => { if (draft) setOpen(true); }}
        onBlur={() => {
          requestAnimationFrame(() => {
            if (!wrapRef.current?.contains(document.activeElement)) setOpen(false);
          });
        }}
        onKeyDown={(e) => {
          if (open && matches.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIdx(i => (i + 1) % matches.length); return; }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setHoverIdx(i => (i - 1 + matches.length) % matches.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              commit(matches[hoverIdx] || matches[0]);
              return;
            }
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
          } else if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setDraft('');
            setOpen(false);
          }
        }}
        style={{
          width: 240,
          padding: '0.4rem 0.6rem',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--font-size-sm)',
          fontFamily: 'inherit',
          color: 'var(--color-text)',
          background: 'var(--color-bg)',
        }}
      />
      {open && matches.length > 0 && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'absolute', top: '100%', left: 0, minWidth: '100%',
            zIndex: 50, background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
            maxHeight: 240, overflowY: 'auto', fontSize: '0.82rem', marginTop: 2,
          }}
        >
          {matches.map((m, i) => (
            <div
              key={m + i}
              onClick={() => commit(m)}
              onMouseEnter={() => setHoverIdx(i)}
              style={{
                padding: '0.35rem 0.6rem', cursor: 'pointer',
                background: i === hoverIdx ? '#DCFCE7' : 'transparent',
                color: i === hoverIdx ? '#166534' : '#1E293B',
                fontWeight: i === hoverIdx ? 700 : 500,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >{m}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// Click-to-edit cell. Plain text by default; on click flips into an
// input that commits on Enter or blur and reverts on Escape. When
// `suggestions` is provided, the input also shows a prefix-then-
// substring autocomplete dropdown so the user can pick an existing
// company name (used for the Account column on Opps 2).
// Date cell — renders the value as M/D/YYYY for display, and pops a
// native HTML5 date input (calendar) on click so the user can pick a
// new value. Stores the chosen date as ISO (YYYY-MM-DD) so it round-
// trips cleanly through the same `<input type="date">` later.
function toISODate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (isNaN(t)) return '';
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateDisplay(raw) {
  const iso = toISODate(raw);
  if (!iso) return String(raw || '');
  // Render as M/D/YYYY without time-zone offset surprises (parse the
  // ISO string in local time, not UTC).
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  return `${m}/${d}/${y}`;
}

function DateCell({ value, onChange }) {
  // The native <input type="date"> is permanently mounted but visually
  // hidden and not directly interactable (pointer-events: none, tab
  // disabled). The only way to change the value is via the calendar
  // popup, which we open programmatically from the visible span's
  // click. This blocks every "edit the date itself" affordance the
  // browser exposes on a focused date input — segment typing, arrow-
  // key increments, and spin buttons — so the user can only pick a
  // calendar day.
  const inputRef = useRef(null);
  const iso = toISODate(value);
  const isEmpty = !value;
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        const el = inputRef.current;
        if (!el) return;
        try { el.showPicker?.(); } catch { /* older browser — no-op */ }
      }}
      style={{
        position: 'relative',
        display: 'block', cursor: 'pointer', minHeight: '1em',
        padding: '1px 2px',
        color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
      }}
      title="Click to pick a date"
    >
      {isEmpty ? '—' : formatDateDisplay(value)}
      <input
        ref={inputRef}
        type="date"
        value={iso}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        aria-hidden="true"
        style={{
          position: 'absolute', left: 0, top: 0,
          width: '100%', height: '100%',
          opacity: 0, pointerEvents: 'none',
          border: 0, padding: 0, margin: 0, background: 'transparent',
        }}
      />
    </span>
  );
}

// Break a free-text Next Steps cell into bullet items. Splits on
// newlines, strips any leading marker the user typed (- * • 1. etc.),
// and drops empty lines so the popup / hover render cleanly even when
// the source was loose prose.
function textToBulletItems(text) {
  return String(text ?? '')
    .split(/\r?\n+/)
    .map(line => line.replace(/^\s*(?:[-*•·▪►]|\d+[.)])\s*/, '').replace(NOTE_LINEBREAK_RE, '\n').trim())
    .filter(Boolean);
}

// Hard line breaks the user types *inside* a single Next Step box are
// stored as U+2028 (LINE SEPARATOR) rather than a plain "\n" so they
// survive the round-trip. textToBulletItems splits steps on "\n", so a
// "\n" inside one box would otherwise explode it into several boxes (and
// desync the parallel _nextStepsWaiting array). U+2028 still renders as a
// line break in the pre-formatted table cell, so the box looks the same.
const NOTE_LINEBREAK = String.fromCharCode(0x2028);
const NOTE_LINEBREAK_RE = new RegExp(NOTE_LINEBREAK, "g");
// Collapse a single box's internal newlines to U+2028 before steps are
// joined with "\n", so the box stays one step on reload.
const encodeNoteLine = (note) => String(note ?? '').trim().replace(/\r?\n/g, NOTE_LINEBREAK);

// Calendar days from today to the given ISO date. Positive = future,
// negative = past. Returns null for blank / unparseable dates.
function daysFromToday(rawISO) {
  const iso = toISODate(rawISO);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  const target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

// Whole calendar days between two ISO dates (b minus a). Negative when
// b is before a; null when either side is blank/unparseable.
function daysBetween(isoA, isoB) {
  const a = toISODate(isoA);
  const b = toISODate(isoB);
  if (!a || !b) return null;
  const [ay, am, ad] = a.split('-').map(n => parseInt(n, 10));
  const [by, bm, bd] = b.split('-').map(n => parseInt(n, 10));
  const da = new Date(ay, am - 1, ad);
  const db = new Date(by, bm - 1, bd);
  da.setHours(0, 0, 0, 0);
  db.setHours(0, 0, 0, 0);
  return Math.round((db - da) / 86400000);
}

// Whole business days (Mon–Fri) elapsed from the given ISO date to
// today. 0 when the date is today or in the future; null when blank.
function businessDaysSince(rawISO) {
  const iso = toISODate(rawISO);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  const start = new Date(y, m - 1, d);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (today <= start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur < today) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

// Convert "wall time in America/New_York" to a UTC ms timestamp. Used
// by the No-Further-Action-Today auto-clear so the cutoff lands at
// 2 PM Eastern regardless of the user's local timezone, and it stays
// correct across DST flips. One pass is enough — we compute the
// observed Eastern wall time of our initial UTC guess, take the
// difference, and apply it.
function easternWallToUtcMs(year, month, day, hour, minute) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = {};
  for (const p of fmt.formatToParts(new Date(guess))) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  const obs = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute),
  );
  return guess + (guess - obs);
}

// Eastern calendar parts (+ weekday, 0=Sun..6=Sat) for a UTC ms instant.
// Used to align the configurable No-Further-Action-Today clear schedules
// to Eastern days/times for every user, independent of browser timezone.
function easternDayParts(ms) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const out = {};
  for (const p of fmt.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[out.weekday];
  return { year: Number(out.year), month: Number(out.month), day: Number(out.day), dow };
}

// The most recent scheduled occurrence (UTC ms) at or before `nowMs` for
// a schedule that fires on the given Eastern weekdays at "HH:MM" Eastern.
// Returns null when nothing matches within the last week. The scheduler
// compares this against the schedule's lastRunAt: a newer occurrence means
// the clear is due — which also lets it catch up if the app was closed
// across a scheduled time.
function mostRecentNfatScheduleMs(days, time, nowMs = Date.now()) {
  if (!Array.isArray(days) || !days.length) return null;
  const [hh, mm] = String(time || '').split(':').map(n => parseInt(n, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  for (let k = 0; k < 8; k++) {
    const p = easternDayParts(nowMs - k * 24 * 60 * 60 * 1000);
    if (!days.includes(p.dow)) continue;
    const occ = easternWallToUtcMs(p.year, p.month, p.day, hh, mm);
    if (occ <= nowMs) return occ;
  }
  return null;
}

// Values the Opps Google sheet uses to mean "no data" in cells where
// the cell otherwise carries a number — treat them as blank rather
// than as a parseable string.
const BLANK_SENTINELS = new Set(['', '-', '#N/A', '#n/a', 'N/A', 'n/a']);

// True when a BFO field holds no real value — blank, "-", or an "#N/A"
// variant. Lowercased so casing doesn't matter.
function bfoFieldMissing(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '' || s === '-' || s === '#n/a' || s === 'n/a';
}

// Combined days an opp has spent across the Lead + Qualifying + Quoting
// stages: historical durations captured in `_stageHistory` plus the live
// days-so-far when the current Stage is one of those three. Mirrors the
// per-stage math the Stage History tab uses (and combinedActiveStageAge in
// api/_lib/newOpps.js) so the New Opps filter matches on screen and in the
// emailed digest.
function combinedActiveStageAge(r) {
  let total = 0;
  for (const h of (Array.isArray(r?._stageHistory) ? r._stageHistory : [])) {
    const s = String(h?.stage || '').trim();
    if (!NEW_OPPS_ACTIVE_STAGES_SET.has(s)) continue;
    const d = Number(h?.days);
    if (Number.isFinite(d) && d >= 0) total += d;
  }
  const stage = String(r?.['Stage'] || '').trim();
  if (NEW_OPPS_ACTIVE_STAGES_SET.has(stage)) {
    const enteredISO = toISODate(r?._stageEnteredAt) || toISODate(r?.['Start Date']);
    const currentDays = enteredISO ? Math.max(0, -daysFromToday(enteredISO)) : 0;
    total += currentDays;
  }
  return total;
}

// "Missing Data" flag for the Opps 2 table: the opp has a BFO
// Opportunity Name (BFO Link) but its BFO Address is still missing
// (blank / "-" / "#N/A"). These are the rows whose BFO Address needs
// to be filled in.
function oppMissingBfoAddress(row) {
  return !bfoFieldMissing(row?.['BFO Link']) && bfoFieldMissing(row?.['BFO Address']);
}

// Resolve the displayed value of a row's computed column. When the
// sheet shipped a literal value for that column (imported rows carry
// the Google Sheet's own formula output) we honor it — including
// blank sentinels, so a row the sheet decided to hide stays hidden in
// Opps 2. Hand-typed rows have no stored cell and fall through to a
// live compute from the source date. Returns null for "show blank",
// or a finite number for "show this".
function resolveComputedDays(row, storedKey, sourceField, compute) {
  if (row && storedKey in row) {
    const raw = row[storedKey];
    const s = raw == null ? '' : String(raw).trim();
    if (BLANK_SENTINELS.has(s)) return null;
  }
  // Always prefer a live compute from the source date so the cell
  // reflects today, not the stale snapshot the sheet shipped on
  // import. Falls back to the stored number only when the source
  // field is missing/unparseable (imported rows that arrived without
  // a date).
  const live = compute(row?.[sourceField]);
  if (live != null) return live;
  if (row && storedKey in row) {
    const raw = row[storedKey];
    const s = raw == null ? '' : String(raw).trim();
    const n = parseFloat(s.replace(/[,$%]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}
const resolveCallIn = (row) => resolveComputedDays(row, 'Call In', 'Follow Up', daysFromToday);
const resolveLastSpoke = (row) => resolveComputedDays(row, 'Last Spoke', 'Last Client Heard From Us', businessDaysSince);

// Days-in-Stage stall flag for an opp record. Returns { days, suggestion }
// when the opp has sat in its current stage longer than that stage's limit
// (same gates as the Days-in-Stage board: tracked stage, has a Call In,
// not a pull-through), or null otherwise. Ignores the per-opp
// `_ignoreStallFlag` so callers can offer an explicit ignore/restore.
function oppStageStall(row) {
  const stage = String(row?.['Stage'] || '').trim();
  if (!TRACKED_STAGES_SET.has(stage)) return null;
  if (resolveCallIn(row) == null) return null;
  if (PULL_THROUGH_RE.test(String(row?.['Scope'] || ''))) return null;
  const enteredISO = toISODate(row?._stageEnteredAt) || toISODate(row?.['Start Date']);
  const days = enteredISO ? -daysFromToday(enteredISO) : null;
  const rule = stageActionFor(stage, days);
  return rule ? { days, suggestion: rule.suggestion, limit: rule.days } : null;
}

// "Quoted Amount Missing" flag: an active opp (stage isn't a closed Sold /
// Not Sold) that has advanced past "Not Started" but still has no value in
// its Quoted Amount cell. Blank sentinels ("-", "#N/A", …) count as missing.
function oppMissingQuotedAmount(row) {
  const stage = String(row?.['Stage'] || '').trim();
  if (!stage || stage === 'Not Started') return false;
  if (CLOSED_STAGES_SET.has(stage)) return false;
  return bfoFieldMissing(row?.['Quoted Amount']);
}

// "Missing Margin Approval" flag: an opp at Quoted / Contracting /
// Agreement Sent that still has no Margin Email Date - Sales Leader Review
// Date (blank or a sentinel like "-" / "#N/A", which the cell shows as "—").
const MARGIN_APPROVAL_STAGES_SET = new Set(['Quoted', 'Contracting', 'Agreement Sent']);
function oppMissingMarginApproval(row) {
  const stage = String(row?.['Stage'] || '').trim();
  if (!MARGIN_APPROVAL_STAGES_SET.has(stage)) return false;
  return bfoFieldMissing(row?.['Margin Email Date - Sales Leader Review Date']);
}

// One-shot Call-In ascending sort used during initial hydration. Rows
// without a resolvable Call In sink to the bottom. A stable tiebreaker
// (original index) keeps the order deterministic when many rows share
// the same Call In value. Continuous re-sorting during editing would
// yank rows out from under the cursor — that's why this runs only on
// load and not in any update path.
function sortRecordsByCallInAsc(records) {
  if (!Array.isArray(records)) return records;
  const tagged = records.map((r, i) => {
    const n = resolveCallIn(r);
    const key = typeof n === 'number' && Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
    return { r, i, key };
  });
  tagged.sort((a, b) => (a.key - b.key) || (a.i - b.i));
  return tagged.map(x => x.r);
}

// Three-state checkbox cell. Click cycles blank → ✓ ("Yes") → ✗ ("No")
// → blank. The stored value is the string "Yes" / "No" / "" so it
// round-trips through the same JSON persistence path as every other
// Opps 2 cell — and falls through to the existing search / filter
// machinery unchanged.
function TristateCheckCell({ value, onChange, title }) {
  const cur = String(value || '').trim().toLowerCase();
  const state = cur === 'yes' || cur === 'true' || cur === '✓' ? 'yes'
    : cur === 'no' || cur === 'false' || cur === '✗' ? 'no'
    : 'blank';
  const next = { blank: 'Yes', yes: 'No', no: '' };
  const cycle = (e) => {
    e.stopPropagation();
    onChange?.(next[state]);
  };
  const glyph = state === 'yes' ? '✓' : state === 'no' ? '✗' : '';
  const fg = state === 'yes' ? '#15803D' : state === 'no' ? '#B91C1C' : 'var(--color-text-muted)';
  const bg = state === 'yes' ? '#DCFCE7' : state === 'no' ? '#FEE2E2' : '#fff';
  return (
    <span
      role="checkbox"
      aria-checked={state === 'yes' ? 'true' : state === 'no' ? 'false' : 'mixed'}
      tabIndex={0}
      onClick={cycle}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); cycle(e); }
      }}
      title={title || 'Click to cycle: blank → ✓ → ✗ → blank'}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 20, height: 20, lineHeight: 1,
        border: '1px solid var(--color-border)', borderRadius: 3,
        background: bg, color: fg, cursor: 'pointer',
        fontWeight: 700, fontSize: '0.95em', userSelect: 'none',
      }}
    >{glyph}</span>
  );
}

// Read-only cell for a column whose value is derived from another cell.
function ComputedCell({ value }) {
  const isEmpty = value == null || value === '';
  return (
    <span
      style={{
        display: 'block', minHeight: '1em',
        padding: '1px 2px',
        color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
      }}
      title="Computed value"
    >
      {isEmpty ? '—' : String(value)}
    </span>
  );
}

// Call In cell with a manual override. Clicking a populated cell
// stores a blank sentinel under 'Call In' so the row reads empty even
// though Follow Up still has a date; clicking the "+ add" affordance
// on a cleared cell deletes that override so the live compute takes
// over again. Falls through to the read-only ComputedCell when there's
// nothing to toggle (no Follow Up, no stored override).
function CallInCell({ row, onClear, onRestore }) {
  const storedKey = 'Call In';
  const hasStored = row && storedKey in row;
  const rawStored = hasStored ? row[storedKey] : undefined;
  const storedStr = rawStored == null ? '' : String(rawStored).trim();
  const isCleared = hasStored && BLANK_SENTINELS.has(storedStr);
  const live = daysFromToday(row?.['Follow Up']);
  const n = resolveCallIn(row);

  if (isCleared && live != null) {
    return (
      <span
        onClick={(e) => { e.stopPropagation(); onRestore(); }}
        title={`Restore Call In (${live})`}
        style={{
          display: 'block', cursor: 'pointer',
          color: 'var(--color-text-muted)', fontStyle: 'italic',
          textAlign: 'center', padding: '1px 2px',
        }}
      >+ add</span>
    );
  }

  if (n != null) {
    return (
      <span
        onClick={(e) => {
          e.stopPropagation();
          // Click-to-clear is destructive (it stamps the cell with the
          // BLANK sentinel and you have to find the "+ add" affordance
          // to undo it), and it's easy to brush this cell while
          // scanning the column. Guard with a confirm so a stray click
          // doesn't wipe the value.
          const label = String(row?.['Account'] || '').trim() || 'this row';
          if (window.confirm(`Remove the Call In value for ${label}?`)) {
            onClear();
          }
        }}
        title="Click to clear Call In"
        style={{ display: 'block', cursor: 'pointer' }}
      >
        <ComputedCell value={n} />
      </span>
    );
  }

  return <ComputedCell value="" />;
}

// Renders a frozen Pricing → Options snapshot saved onto the opp.
// Self-contained: doesn't read from Pricing's IndexedDB cache, so it
// keeps working even after the Pricing tab has been cleared.
function PricingOptionSnapshotView({ snapshot }) {
  if (!snapshot) return null;
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const yearTotals = Array.isArray(snapshot.yearTotals) ? snapshot.yearTotals : [];
  const termValues = Array.isArray(snapshot.termValues) ? snapshot.termValues : [];
  const year1Monthly = Array.isArray(snapshot.year1Monthly) ? snapshot.year1Monthly : [];
  const termYears = Math.max(1, Number(snapshot.years) || 1);
  return (
    <div style={{
      border: '1px solid var(--color-border)', borderRadius: 6,
      background: '#fafbfc', padding: '0.65rem 0.75rem',
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: '0.5rem', marginBottom: '0.5rem',
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{snapshot.name || '(unnamed)'}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
            {termYears}-year term · {snapshot.escPct || 0}% escalator
            {snapshot.savedAt ? ` · saved ${new Date(snapshot.savedAt).toLocaleDateString()}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Year 1</div>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{fmtMoneyWhole(snapshot.year1Total || 0)}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.6rem' }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Year breakdown</div>
          <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
            <tbody>
              {Array.from({ length: termYears }, (_, i) => (
                <tr key={`y-${i}`}>
                  <td style={{ padding: '2px 4px', color: 'var(--color-text-muted)' }}>Year {i + 1}</td>
                  <td style={{ padding: '2px 4px', textAlign: 'right' }}>{fmtMoneyWhole(yearTotals[i] || 0)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid var(--color-border)' }}>
                <td style={{ padding: '2px 4px', fontWeight: 600 }}>Total Contract Value</td>
                <td style={{ padding: '2px 4px', textAlign: 'right', fontWeight: 600 }}>{fmtMoneyWhole(termValues[termYears - 1] || 0)}</td>
              </tr>
              {snapshot.setupTotal ? (
                <tr>
                  <td style={{ padding: '2px 4px', color: 'var(--color-text-muted)' }}>Setup</td>
                  <td style={{ padding: '2px 4px', textAlign: 'right' }}>{fmtMoneyWhole(snapshot.setupTotal)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Year 1 monthly</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: '0.72rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {year1Monthly.map((_, i) => (
                    <th key={`mh-${i}`} style={{ padding: '2px 4px', color: 'var(--color-text-muted)', fontWeight: 500 }}>M{i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {year1Monthly.map((v, i) => (
                    <td key={`mv-${i}`} style={{ padding: '2px 4px', textAlign: 'right' }}>{fmtMoneyWhole(v)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
          Fee schedule ({rows.filter(r => r.fee || r.feeSchedule).length} rows)
        </div>
        <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 4 }}>
          <table style={{ width: '100%', fontSize: '0.74rem', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#f1f5f9' }}>
              <tr>
                <th style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 600 }}>Fee Schedule</th>
                <th style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 600 }}>Type</th>
                <th style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600 }}>Fee</th>
                <th style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 600 }}>Unit</th>
                <th style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600 }}>Est. Count</th>
                <th style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600 }}>Start Month</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter(r => r.fee || r.feeSchedule || r.type).map((r, idx) => (
                <tr key={idx} style={{ borderTop: '1px solid var(--color-border-light)' }}>
                  <td style={{ padding: '3px 6px' }}>{r.feeSchedule || '—'}</td>
                  <td style={{ padding: '3px 6px' }}>{r.type || '—'}</td>
                  <td style={{ padding: '3px 6px', textAlign: 'right' }}>{r.fee || '—'}</td>
                  <td style={{ padding: '3px 6px' }}>{r.unit || '—'}</td>
                  <td style={{ padding: '3px 6px', textAlign: 'right' }}>{r.unitCount || '—'}</td>
                  <td style={{ padding: '3px 6px', textAlign: 'right' }}>{r.startMonth || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Quoted Amount cell. Clicking the value opens a small editor popup
// with two fields — the dollar amount and an optional hyperlink. The
// cell itself stays icon-free: when a hyperlink is set the amount
// renders as a link to it, and a Pricing-Option snapshot still falls
// back to the existing "open the Opp details popup" affordance when
// no manual URL is set. All edits happen inside the popup.
function QuotedAmountCell({ value, onChange, snapshot, onViewSnapshot, url, onChangeUrl, services }) {
  const [open, setOpen] = useState(false);
  const [draftAmount, setDraftAmount] = useState(value ?? '');
  const [draftUrl, setDraftUrl] = useState(url ?? '');
  useEffect(() => { if (!open) setDraftAmount(value ?? ''); }, [value, open]);
  useEffect(() => { if (!open) setDraftUrl(url ?? ''); }, [url, open]);

  const closePopup = () => setOpen(false);
  const openPopup = (e) => {
    if (e) e.stopPropagation();
    setDraftAmount(value ?? '');
    setDraftUrl(url ?? '');
    setOpen(true);
  };
  const save = () => {
    const nextAmount = draftAmount;
    const trimmedUrl = (draftUrl || '').trim();
    const nextUrl = trimmedUrl && !/^https?:\/\//i.test(trimmedUrl) ? `https://${trimmedUrl}` : trimmedUrl;
    if (nextAmount !== (value ?? '')) onChange?.(nextAmount);
    if (nextUrl !== (url ?? '')) onChangeUrl?.(nextUrl);
    setOpen(false);
  };

  // Derive the at-a-glance figures the popup shows for a saved Pricing
  // Option (SIA) snapshot: which option was saved, the Year-1 Setup +
  // One Time fees (every non-recurring line that bills in year 1), and
  // the monthly Recurring fee (sum of each recurring line's base
  // fee × unit count). Recomputed from the frozen snapshot rows so it
  // stays correct even after the Pricing tab is cleared.
  const snapStats = useMemo(() => {
    if (!snapshot) return null;
    const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
    const years = Math.max(1, Number(snapshot.years) || 1);
    const esc = Number(snapshot.escPct) || 0;
    let setupOneTime = 0;
    let recurringMonthly = 0;
    let recurringAnnual = 0;
    for (const r of rows) {
      if (String(r.type || '').toLowerCase().startsWith('recurring')) {
        recurringMonthly += (toNum(r.fee) || 0) * unitCountOrOne(r.unitCount);
        // Year-1 recurring revenue — matches the pricing page's Year 1
        // "Recurring" column. Uses rowYearRevenue so a line that starts
        // after month 1 bills only its active months (not a flat ×12).
        recurringAnnual += rowYearRevenue(r, 1, years, esc);
      } else {
        // Setup / One Time lines bill a single month — rowYearRevenue
        // returns their amount only when that month lands in Year 1.
        setupOneTime += rowYearRevenue(r, 1, years, esc);
      }
    }
    const year1Total = Number(snapshot.year1Total) || 0;
    return { name: String(snapshot.name || '').trim(), setupOneTime, recurringMonthly, recurringAnnual, year1Total };
  }, [snapshot]);

  // Services bundled in the saved Option. Prefer the list frozen into
  // the snapshot (self-contained); fall back to the live per-Option
  // services map passed in (covers snapshots saved before services were
  // stored). Deduped, blanks dropped.
  const optionServices = useMemo(() => {
    const raw = (Array.isArray(snapshot?.services) && snapshot.services.length)
      ? snapshot.services
      : (Array.isArray(services) ? services : []);
    const seen = new Set();
    const out = [];
    for (const s of raw) {
      const v = String(s || '').trim();
      const k = v.toLowerCase();
      if (!v || seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  }, [snapshot, services]);

  // Cell display — no inline action buttons. The whole cell is the
  // click target for the editor popup; when a URL or snapshot is set
  // the value is styled as a link for affordance.
  const hasLink = !!url || !!snapshot;
  const display = value || (url ? '—' : (snapshot ? fmtMoneyWhole(snapshot.year1Total || 0) || '—' : '—'));
  return (
    <>
      <span
        onClick={openPopup}
        title="Click to edit the Deal Size and hyperlink"
        style={{
          display: 'block', cursor: 'pointer', minHeight: '1em', padding: '1px 2px',
          color: hasLink ? '#2563eb' : (value ? 'inherit' : 'var(--color-text-muted)'),
          textDecoration: hasLink ? 'underline' : 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >{display}</span>
      {open && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) closePopup(); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(15, 23, 42, 0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 8, padding: '1rem 1.25rem',
              minWidth: 360, maxWidth: 480, boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
              display: 'flex', flexDirection: 'column', gap: '0.75rem',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1E293B' }}>Deal Size</div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem', color: '#475569' }}>
              Amount
              <input
                autoFocus
                type="text"
                value={draftAmount}
                onChange={(e) => setDraftAmount(formatQuotedAmountLive(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); save(); }
                  else if (e.key === 'Escape') { e.preventDefault(); closePopup(); }
                }}
                placeholder="$0"
                style={{ padding: '0.4rem 0.55rem', border: '1px solid var(--color-border)', borderRadius: 4, fontFamily: 'inherit', fontSize: '0.88rem' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem', color: '#475569' }}>
              Sharepoint Hyperlink
              <input
                type="text"
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); save(); }
                  else if (e.key === 'Escape') { e.preventDefault(); closePopup(); }
                }}
                placeholder="https://…"
                style={{ padding: '0.4rem 0.55rem', border: '1px solid var(--color-border)', borderRadius: 4, fontFamily: 'inherit', fontSize: '0.82rem' }}
              />
            </label>
            {snapshot && snapStats && (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 4,
                padding: '0.5rem 0.6rem', background: '#F8FAFC',
                border: '1px solid var(--color-border-light)', borderRadius: 4,
                fontSize: '0.78rem', color: '#475569',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>Saved SIA Option</span>
                  <strong style={{ color: '#1E293B', textAlign: 'right' }}>{snapStats.name || '—'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>Setup Fees <span style={{ color: '#94A3B8' }}>(Setup + One Time, Yr 1)</span></span>
                  <strong style={{ color: '#1E293B' }}>{fmtMoneyWhole(snapStats.setupOneTime) || '$0'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>Recurring Fees <span style={{ color: '#94A3B8' }}>(monthly)</span></span>
                  <strong style={{ color: '#1E293B' }}>{fmtMoneyWhole(snapStats.recurringMonthly) || '$0'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>Recurring Fees <span style={{ color: '#94A3B8' }}>(annual)</span></span>
                  <strong style={{ color: '#1E293B' }}>{fmtMoneyWhole(snapStats.recurringAnnual) || '$0'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderTop: '1px solid var(--color-border-light)', paddingTop: 4, marginTop: 2 }}>
                  <span>Year 1 Total <span style={{ color: '#94A3B8' }}>(quoted)</span></span>
                  <strong style={{ color: '#1E293B' }}>{fmtMoneyWhole(snapStats.year1Total) || '$0'}</strong>
                </div>
              </div>
            )}
            {snapshot && optionServices.length > 0 && (
              <div style={{
                padding: '0.5rem 0.6rem', background: '#F8FAFC',
                border: '1px solid var(--color-border-light)', borderRadius: 4,
                fontSize: '0.78rem', color: '#475569',
              }}>
                <div style={{ fontWeight: 600, color: '#1E293B', marginBottom: 4 }}>
                  Services <span style={{ color: '#94A3B8', fontWeight: 400 }}>({optionServices.length})</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                  {optionServices.map((s, i) => (
                    <li key={`svc-${i}`} style={{ margin: '0.1rem 0' }}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {(url || snapshot) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: '0.78rem' }}>
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#2563eb', textDecoration: 'underline' }}
                    onClick={(e) => e.stopPropagation()}
                  >Open hyperlink ↗</a>
                )}
                {snapshot && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setOpen(false); onViewSnapshot?.(); }}
                    style={{ background: 'none', border: 'none', color: '#2563eb', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit' }}
                  >View saved Pricing Option snapshot</button>
                )}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={closePopup}
                style={{ padding: '0.35rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.82rem' }}
              >Cancel</button>
              <button
                type="button"
                onClick={save}
                style={{ padding: '0.35rem 0.95rem', border: 'none', background: '#2563eb', color: '#fff', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.82rem', fontWeight: 600 }}
              >Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Read-only "Pricing Option" cell: shows the option name linked to this
// opp from the Pricing → Options tab. The user can't type into it — the
// link is set from Pricing → Options ("Save to Opp…") and cleared with
// the × that appears here when a value is present.
function PricingOptionCell({ value, onClear }) {
  const isEmpty = !value;
  return (
    <span
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '1px 2px',
        color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
      }}
      title={isEmpty
        ? 'Set from the Pricing → Options tab: open an Option, then click “Save to Opp…”.'
        : `Linked Pricing Option: ${value}`}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {isEmpty ? '—' : value}
      </span>
      {!isEmpty && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClear?.(); }}
          title="Clear pricing-option link"
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: '#94a3b8', padding: '0 2px', fontSize: '0.85em', lineHeight: 1,
          }}
        >×</button>
      )}
    </span>
  );
}

// Opt-in hover popover for long-text cells (Next Steps). Mirrors the
// text in a portal-positioned dark box anchored to the cell so the
// content isn't clipped by the column width or by the table's
// horizontal scroll container. Only shows when the value would
// otherwise be cut off — a newline that gets squashed by the cell's
// single-line render, or text wider than the column.
function CellHoverPopover({ anchorRef, value, enabled }) {
  const [pos, setPos] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el || !enabled) return undefined;
    function onEnter() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const node = anchorRef.current;
        if (!node) return;
        const text = String(value ?? '');
        if (!text) return;
        const hasNewline = text.includes('\n');
        const hasOverflow = node.scrollWidth > node.clientWidth + 1;
        if (!hasNewline && !hasOverflow) return;
        const rect = node.getBoundingClientRect();
        const vh = window.innerHeight;
        const flipAbove = rect.bottom + 220 > vh && rect.top > 220;
        setPos({
          top: flipAbove ? rect.top - 4 : rect.bottom + 4,
          left: Math.min(rect.left, window.innerWidth - 500),
          flipAbove,
        });
      }, 250);
    }
    function onLeave() {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      setPos(null);
    }
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [anchorRef, value, enabled]);

  if (!pos || !enabled) return null;
  const items = textToBulletItems(value);
  return createPortal(
    <div
      style={{
        position: 'fixed', top: pos.top, left: pos.left,
        transform: pos.flipAbove ? 'translateY(-100%)' : 'none',
        background: '#1e293b', color: '#f8fafc',
        padding: '6px 10px', borderRadius: 4, fontSize: '0.78rem',
        maxWidth: 480, maxHeight: 320, overflow: 'auto',
        wordBreak: 'break-word', lineHeight: 1.4,
        boxShadow: '0 8px 22px rgba(15, 23, 42, 0.28)',
        zIndex: 10000, pointerEvents: 'none',
      }}
    >
      {items.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
          {items.map((it, i) => <li key={i} style={{ margin: '2px 0', whiteSpace: 'pre-wrap' }}>{it}</li>)}
        </ul>
      ) : (
        <span style={{ whiteSpace: 'pre-wrap' }}>{String(value ?? '')}</span>
      )}
    </div>,
    document.body,
  );
}

// Next Steps cell — single click opens the bullet-list popup. Inline
// editing isn't useful for this column because the editor in the popup
// is purpose-built for it (per-step Waiting On, bullet reorder, etc.).
// Hover still surfaces the full text via the shared popover so a quick
// glance doesn't require opening the modal.
function NextStepsCell({ value, onOpen }) {
  const ref = useRef(null);
  const isEmpty = value === '' || value == null;
  const text = isEmpty ? '—' : String(value);
  return (
    <>
      <span
        ref={ref}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        title="Click to edit in Notes"
        style={{
          display: 'block', cursor: 'pointer', minHeight: '1em',
          padding: '1px 2px', whiteSpace: 'pre', overflow: 'hidden',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
        }}
      >{text}</span>
      <CellHoverPopover anchorRef={ref} value={text} enabled={!isEmpty} />
    </>
  );
}

function EditableCell({ value, onChange, suggestions, onAddNew, addNewLabel, renderDisplay }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(0);
  // Dropdown is portaled to <body> so the table cell's overflow:hidden
  // can't clip it; position is recomputed from the wrapper's bounding
  // rect whenever the dropdown opens.
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const wrapRef = useRef(null);
  const textareaRef = useRef(null);
  useEffect(() => { if (!editing) setDraft(value ?? ''); }, [value, editing]);

  // Auto-grow the textarea to fit its contents so the user sees every
  // line of an Alt+Enter note while typing.
  useLayoutEffect(() => {
    if (!editing || !textareaRef.current) return;
    const ta = textareaRef.current;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }, [editing, draft]);

  // Matches are a mix of plain strings (existing suggestions) and an
  // optional `+ Add "X"` sentinel object at the end when `onAddNew` is
  // wired up and the current draft isn't an exact match to any
  // suggestion. Keeping both in one array means hover / keyboard nav
  // works uniformly. A suggestion item can also be `{ value, label,
  // secondary }` to render a richer two-line option (e.g. name +
  // email for the Contact column); `value` is what's stored and
  // matched against the query.
  const matchValue = (s) => {
    if (s && typeof s === 'object' && !s.__add) return String(s.value ?? '');
    return String(s ?? '');
  };
  const matches = useMemo(() => {
    const list = suggestions || [];
    const q = String(draft || '').trim().toLowerCase();
    if (!q) {
      // No query yet — surface the first 8 suggestions alphabetically
      // so the dropdown shows as soon as the cell is focused. The add
      // sentinel needs a non-empty draft, so it's not included here.
      return list.slice(0, 8);
    }
    const prefix = [];
    const sub = [];
    for (const s of list) {
      const lower = matchValue(s).toLowerCase();
      if (lower === q) continue;
      if (lower.startsWith(q)) prefix.push(s);
      else if (lower.includes(q)) sub.push(s);
      if (prefix.length + sub.length >= 25) break;
    }
    const result = [...prefix, ...sub].slice(0, 8);
    if (onAddNew) {
      const exact = list.some(s => matchValue(s).toLowerCase() === q);
      if (!exact) {
        const txt = draft.trim();
        const label = typeof addNewLabel === 'function' ? addNewLabel(txt) : `+ Add "${txt}"`;
        result.push({ __add: true, value: txt, label });
      }
    }
    return result;
  }, [draft, suggestions, onAddNew, addNewLabel]);

  const dropdownAvailable = (suggestions?.length || 0) > 0 || !!onAddNew;

  function commit(next) {
    const v = next == null ? draft : next;
    setEditing(false);
    setOpen(false);
    if ((v ?? '') !== (value ?? '')) onChange(v);
  }

  function pickMatch(m) {
    if (m && typeof m === 'object' && m.__add) {
      if (typeof onAddNew === 'function') onAddNew(m.value);
      setDraft(m.value);
      commit(m.value);
      return;
    }
    const v = m && typeof m === 'object' ? String(m.value ?? '') : m;
    setDraft(v);
    commit(v);
  }

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setDropPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
  }, [open, draft]);

  if (!editing) {
    const isEmpty = value === '' || value == null;
    const text = isEmpty ? '—' : String(value);
    const enterEdit = () => { setEditing(true); setOpen(dropdownAvailable); };
    // Let callers (e.g. the Account column) render a custom non-editing
    // display — such as a clickable company link — while keeping all of
    // EditableCell's editing/autocomplete behavior. `enterEdit` lets the
    // custom display drop back into the normal text editor.
    if (renderDisplay) return renderDisplay({ enterEdit, value, isEmpty, text });
    return (
      <span
        onClick={(e) => { e.stopPropagation(); enterEdit(); }}
        style={{
          // `white-space: pre` keeps Alt+Enter newlines on their own
          // line (so the row grows vertically to fit) while still
          // clipping anything wider than the column.
          display: 'block', cursor: 'text', minHeight: '1em',
          padding: '1px 2px', whiteSpace: 'pre', overflow: 'hidden',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
        }}
      >{text}</span>
    );
  }
  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={textareaRef}
        autoFocus
        rows={1}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setOpen(true); setHoverIdx(0); }}
        onFocus={() => { if (dropdownAvailable) setOpen(true); }}
        onBlur={() => {
          // Defer so a click on a suggestion lands first.
          requestAnimationFrame(() => {
            if (!wrapRef.current?.contains(document.activeElement)) commit();
          });
        }}
        onKeyDown={(e) => {
          if (open && matches.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIdx(i => (i + 1) % matches.length); return; }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setHoverIdx(i => (i - 1 + matches.length) % matches.length); return; }
            if (e.key === 'Tab')       { e.preventDefault(); pickMatch(matches[hoverIdx] || matches[0]); return; }
            if (e.key === 'Enter' && !(e.altKey || e.shiftKey)) {
              e.preventDefault();
              pickMatch(matches[hoverIdx] || matches[0]);
              return;
            }
            if (e.key === 'Escape')    { e.preventDefault(); setDraft(value ?? ''); setEditing(false); setOpen(false); return; }
          } else {
            // Alt+Enter / Shift+Enter inserts a newline (Excel
            // convention) — let the textarea handle it natively.
            // Plain Enter commits and exits edit mode.
            if (e.key === 'Enter' && !(e.altKey || e.shiftKey)) {
              e.preventDefault();
              e.currentTarget.blur();
              return;
            }
            if (e.key === 'Tab')    { e.preventDefault(); e.currentTarget.blur(); return; }
            if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); }
          }
        }}
        style={{
          width: '100%', boxSizing: 'border-box',
          border: '1px solid var(--color-accent)', borderRadius: 3,
          padding: '1px 4px',
          fontSize: 'inherit', fontFamily: 'inherit', color: 'var(--color-text)',
          background: '#fff', resize: 'none', overflow: 'hidden',
          lineHeight: 1.3,
        }}
      />
      {open && matches.length > 0 && createPortal(
        <div
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'fixed', top: dropPos.top, left: dropPos.left,
            minWidth: Math.max(dropPos.width, 160),
            zIndex: 9999, background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
            maxHeight: 220, overflowY: 'auto', fontSize: '0.78rem',
          }}
        >
          {matches.map((m, i) => {
            const isAdd = m && typeof m === 'object' && m.__add;
            const isRich = m && typeof m === 'object' && !m.__add;
            const label = isAdd ? m.label : (isRich ? (m.label ?? m.value) : m);
            const secondary = isRich ? m.secondary : null;
            const keyVal = isAdd ? '__add' : (isRich ? `${m.value}-${i}` : String(m) + i);
            const hovered = i === hoverIdx;
            return (
              <div
                key={keyVal}
                onClick={() => pickMatch(m)}
                onMouseEnter={() => setHoverIdx(i)}
                style={{
                  padding: '0.3rem 0.55rem', cursor: 'pointer',
                  background: hovered ? '#DCFCE7' : 'transparent',
                  color: hovered ? '#166534' : (isAdd ? '#7C3AED' : '#1E293B'),
                  fontStyle: isAdd ? 'italic' : 'normal',
                  fontWeight: hovered ? 700 : 500,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  borderTop: isAdd && i > 0 ? '1px solid var(--color-border-light)' : 'none',
                }}
              >
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
                {secondary && (
                  <div style={{
                    fontSize: '0.7rem',
                    color: hovered ? '#15803D' : 'var(--color-text-muted)',
                    fontWeight: 400,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{secondary}</div>
                )}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

// Contact-column cell — tag-style multi-pick scoped to the prospect
// whose `company` matches this row's Account. Shows current tags
// inline + a "+ Contacts" button (only when an Account is set) that
// opens a checkbox picker of every contact on that prospect with
// name on top and email muted underneath. Stores the chosen names
// as a comma-separated string so the same parseMulti round-trip
// works as for Scope.
// Build a set of normalized match keys for a company name, including
// the full name, the name with any parenthetical alias stripped, and
// each parenthetical alias on its own. Two companies are considered
// the same if their key sets intersect. This lets "Unibail-Rodamco-
// Westfield (URW)" match contact records stored under either the long
// form or just "URW".

// Free-mail providers we skip when matching contacts by email domain.
// Mirrors the FREE list inside ProspectModal so an @gmail.com contact
// doesn't match every Opp at every account.
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
  'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com',
]);

// Fuzzy company-name match used by the tagged-contacts roster, mirroring
// the looser equality the ProspectModal's contacts panel uses (incl. the
// acronym / single-token branch). Without this, an Opps 2 account like
// "Brookfield (NAM Multifamily)" can't see HubSpot contacts whose
// Company is just "Brookfield" — even though the prospect popup does.
function companyNameMatches(a, b) {
  const na = (a || '').toLowerCase().trim();
  const nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const flatten = (s) => String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const fa = flatten(na);
  const fb = flatten(nb);
  if (fa && fb && fa === fb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  const strip = s => s.replace(/\b(inc|llc|ltd|corp|co|lp)\b\.?/gi, '').replace(/[^a-z0-9 ]/g, '').trim();
  const sa = strip(na);
  const sb = strip(nb);
  if (sa === sb) return true;
  const sLonger = sa.length >= sb.length ? sa : sb;
  const sShorter = sa.length >= sb.length ? sb : sa;
  if (sShorter.length >= 4 && sShorter.length >= sLonger.length * 0.6 && sLonger.includes(sShorter)) return true;
  // Acronym / single-token branch: contact "Brookfield" matches Account
  // "Brookfield (NAM Multifamily)" because parens count as separators.
  const tokensOf = (s) => s.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const sTokens = tokensOf(shorter);
  if (sTokens.length === 1 && sTokens[0].length >= 3) {
    if (tokensOf(longer).includes(sTokens[0])) return true;
  }
  return false;
}

// Email domains tied to a prospect record — used as a fallback so a
// HubSpot contact whose Company text doesn't match the Account still
// shows up when their email sits on a known domain. Mirrors how the
// ProspectModal builds its baseContacts list.
function prospectEmailDomains(prospect) {
  const domains = new Set();
  if (!prospect) return domains;
  if (prospect.emailDomain) {
    for (const entry of String(prospect.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
      const at = entry.lastIndexOf('@');
      const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
      if (d) domains.add(d);
    }
  }
  if (prospect.website) {
    const d = String(prospect.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
    if (d) domains.add(d);
  }
  return domains;
}

function contactEmailDomain(email) {
  if (!email) return '';
  const at = String(email).lastIndexOf('@');
  if (at < 0) return '';
  const d = email.slice(at + 1).toLowerCase().trim();
  return (d && !FREE_EMAIL_DOMAINS.has(d)) ? d : '';
}

function companyMatchKeys(name) {
  const s = String(name || '').trim();
  const keys = new Set();
  if (!s) return keys;
  const full = normalizeCompany(s);
  if (full) keys.add(full);
  const aliases = [...s.matchAll(/\(([^)]+)\)/g)].map(m => m[1]);
  if (aliases.length > 0) {
    const stripped = normalizeCompany(s.replace(/\([^)]*\)/g, ' '));
    if (stripped) keys.add(stripped);
    for (const a of aliases) {
      const n = normalizeCompany(a);
      if (n) keys.add(n);
    }
  }
  return keys;
}

// Find the prospect record whose company best matches an opp's Account
// name. Prefer an exact normalized match over an alias-only match so
// "URW" on an opp doesn't accidentally pull from a prospect that happens
// to share an alias. Shared by the Contact and Account columns.
function findProspectForAccount(account, prospects) {
  const accountKeys = companyMatchKeys(account);
  if (accountKeys.size === 0) return null;
  let exact = null;
  let alias = null;
  const accountFull = normalizeCompany(account);
  for (const p of (prospects || [])) {
    const pk = companyMatchKeys(p?.company);
    if (pk.size === 0) continue;
    const full = normalizeCompany(p?.company);
    if (full && accountFull && full === accountFull) { exact = p; break; }
    for (const k of pk) { if (accountKeys.has(k)) { alias = alias || p; break; } }
  }
  return exact || alias;
}

// "BFO Company Name" lives on the Table View company record (prospect),
// not the opp. This cell sources its value from the prospect matching
// the opp's Account and writes edits straight back to that prospect's
// `bfoCompanyName`, so the two views stay in sync. When no Table View
// company matches there's nowhere to store the value, so it renders
// read-only with a hint to add the company on the Table View first.
function BfoCompanyNameCell({ account, prospects, updateProspect }) {
  const matched = useMemo(() => findProspectForAccount(account, prospects), [account, prospects]);
  if (!matched || !updateProspect) {
    return (
      <span
        style={{ color: 'var(--color-text-muted)' }}
        title={matched ? undefined : 'Add this company on the Table View to set its BFO Company Name'}
      >
        {String(matched?.bfoCompanyName || '').trim() || '—'}
      </span>
    );
  }
  return (
    <EditableCell
      value={matched.bfoCompanyName || ''}
      onChange={(v) => updateProspect(matched.id, { bfoCompanyName: v })}
    />
  );
}

// `contactEmails` / `onChangeEmails` persist the tagged contacts' emails on
// the opp row itself (hidden `_contactEmails` map, lowercased name → email),
// captured at tag time. The HubSpot contacts cache is an IndexedDB cache
// that can be cleared or go stale — without the stored map, a tag's email
// (resolved live from that cache) would silently vanish until a refresh.
function ContactCell({ value, onChange, account, peOwner, prospects, updateProspect, hubspotContacts, onOpenContact, onOpenCompany, contactEmails, onChangeEmails }) {
  // Single boolean for popover state — the popover handles both
  // viewing currently tagged contacts and adding new ones (from the
  // company roster or as a custom one-off tag), so the picker/view
  // split is gone.
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [customDraft, setCustomDraft] = useState('');
  const [popPos, setPopPos] = useState({ top: 0, bottom: null, left: 0, maxHeight: 0, placement: 'below' });
  const wrapRef = useRef(null);
  const popRef = useRef(null);
  const [copied, setCopied] = useState(null); // key of the last button that flashed "Copied!"

  const matched = useMemo(() => findProspectForAccount(account, prospects), [account, prospects]);

  // The opp's PE Owners are themselves companies in the Table View, so
  // resolve each one to a prospect too — their contacts get folded into
  // the same roster below so the user can tag the PE firms' people
  // alongside the deal company's. PE ownership normally lives on the
  // Table View company record (prospect.peOwner), not on each opp row,
  // so fall back to the matched company's peOwner when the opp's own PE
  // Owner column is blank. A company can list several owners
  // (comma-separated); each gets its own roster entry.
  const peOwnerStr = String(peOwner || matched?.peOwner || '').trim();
  const peResolved = useMemo(
    () => splitPeOwners(peOwnerStr).map(owner => ({
      owner,
      prospect: findProspectForAccount(owner, prospects),
    })),
    [peOwnerStr, prospects],
  );
  const peLabel = peResolved
    .map(({ owner, prospect }) => (prospect?.company || owner).trim())
    .filter(Boolean)
    .join(' & ');

  // Build the contact roster for this opp. Pull from two sources and
  // dedupe by name (case-insensitive):
  //   1. The HubSpot contacts cache, filtered by company match
  //   2. Any contacts attached directly to the matched prospect record
  // Each contact is gathered against the deal company AND, when the opp
  // has a PE Owner, that PE firm — tagged with its source company so the
  // mixed list stays legible. The HubSpot cache is the primary source
  // (most of the user's contacts live there); prospect.contacts is a
  // fallback for accounts that were curated manually.
  const contactOptions = useMemo(() => {
    if (!account && !matched && peResolved.length === 0) return [];
    // A reusable predicate: does this HubSpot contact belong to the
    // company described by `keys` / `names` / `domains`? Mirrors the
    // three-way match the cell has always used (key intersection, fuzzy
    // name, email domain) so the PE side matches identically.
    const makeMatcher = (keys, names, domains) => (c) => {
      const ck = companyMatchKeys(c?.company);
      if (ck.size > 0) {
        for (const k of ck) if (keys.has(k)) return true;
      }
      if (c?.company) {
        for (const n of names) if (n && companyNameMatches(c.company, n)) return true;
      }
      if (domains.size > 0) {
        const d = contactEmailDomain(c?.email);
        if (d && domains.has(d)) return true;
      }
      return false;
    };
    const accountKeys = new Set([
      ...companyMatchKeys(account),
      ...(matched ? companyMatchKeys(matched.company) : []),
    ]);
    const matchesCompany = makeMatcher(
      accountKeys,
      [account, matched?.company],
      prospectEmailDomains(matched),
    );
    // One matcher per PE owner so each firm's contacts get tagged with
    // that firm's name in the mixed roster.
    const peMatchers = peResolved.map(({ owner, prospect }) => ({
      label: (prospect?.company || owner).trim(),
      prospect,
      matches: makeMatcher(
        new Set([
          ...companyMatchKeys(owner),
          ...(prospect ? companyMatchKeys(prospect.company) : []),
        ]),
        [owner, prospect?.company],
        prospectEmailDomains(prospect),
      ),
    }));

    const seen = new Set();
    const out = [];
    const pushContact = (raw, source, company) => {
      if (!raw) return;
      const name = [raw.firstname, raw.lastname].filter(Boolean).join(' ').trim()
        || String(raw.email || '').trim();
      if (!name) return;
      const k = name.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push({
        name,
        email: String(raw.email || '').trim(),
        jobtitle: String(raw.jobtitle || '').trim(),
        source,
        company,
      });
    };
    // Deal company wins on a tie (checked first), so a contact shared by
    // both rosters is labeled with the deal company, not the PE firm.
    for (const c of (hubspotContacts || [])) {
      if (matchesCompany(c)) {
        pushContact(c, 'company', matched?.company || account);
      } else {
        const pm = peMatchers.find(m => m.matches(c));
        if (pm) pushContact(c, 'pe', pm.label);
      }
    }
    for (const c of (matched?.contacts || [])) pushContact(c, 'company', matched?.company || account);
    for (const pm of peMatchers) {
      for (const c of (pm.prospect?.contacts || [])) pushContact(c, 'pe', pm.label);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [account, hubspotContacts, matched, peResolved]);

  const selected = useMemo(() => parseMulti(value), [value]);
  const selectedSet = useMemo(() => new Set(selected.map(s => s.toLowerCase())), [selected]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contactOptions;
    return contactOptions.filter(o =>
      o.name.toLowerCase().includes(q) || o.email.toLowerCase().includes(q)
    );
  }, [contactOptions, query]);

  // Anchor the popover next to the cell, flipping above when the row
  // sits near the bottom of the viewport so a long contact list isn't
  // cut off. Also caps the popover's overall max height to whatever
  // vertical space is available on the chosen side; the internal lists
  // stay capped at their own maxHeights so the user can still scroll
  // through them individually.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const margin = 8;
    const gap = 2;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    // Prefer below — the popover's natural sit — unless there's
    // meaningfully more room above. The 200px floor on "below" keeps a
    // close-to-bottom row from flipping needlessly when there's still
    // some room (the list will scroll internally).
    const placeBelow = spaceBelow >= 200 || spaceBelow >= spaceAbove;
    if (placeBelow) {
      setPopPos({
        top: rect.bottom + gap,
        bottom: null,
        left: rect.left,
        maxHeight: Math.max(160, spaceBelow),
        placement: 'below',
      });
    } else {
      setPopPos({
        top: null,
        bottom: window.innerHeight - rect.top + gap,
        left: rect.left,
        maxHeight: Math.max(160, spaceAbove),
        placement: 'above',
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Back-fill: tags created before emails were persisted on the opp only
  // have their email in the live HubSpot cache. When the popover opens
  // (a deliberate, single-row interaction — no render-time or page-load
  // write storms) and the roster can resolve a tag that isn't stored yet,
  // save it so this opp's tags survive the next cache loss.
  useEffect(() => {
    if (!open || !onChangeEmails) return;
    const missing = {};
    for (const name of selected) {
      const key = name.toLowerCase();
      if (storedEmails[key]) continue;
      const live = contactByName.get(key)?.email;
      if (live) missing[key] = live;
    }
    if (Object.keys(missing).length > 0) {
      onChangeEmails({ ...storedEmails, ...missing });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The opp-stored name → email map (see the component comment). Always
  // normalized to lowercased-name keys; tolerate junk from older rows.
  const storedEmails = useMemo(() => {
    const out = {};
    if (contactEmails && typeof contactEmails === 'object') {
      for (const [k, v] of Object.entries(contactEmails)) {
        const key = String(k || '').trim().toLowerCase();
        const email = String(v || '').trim();
        if (key && email) out[key] = email;
      }
    }
    return out;
  }, [contactEmails]);

  function tagName(name, email) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    if (selectedSet.has(trimmed.toLowerCase())) return;
    onChange([...selected, trimmed].join(', '));
    // Persist the email on the opp so the tag survives a lost/stale
    // HubSpot cache. Tags without a known email store nothing.
    const e = String(email || '').trim();
    if (e && onChangeEmails) {
      onChangeEmails({ ...storedEmails, [trimmed.toLowerCase()]: e });
    }
  }

  function untag(name) {
    const key = String(name || '').toLowerCase();
    onChange(selected.filter(s => s.toLowerCase() !== key).join(', '));
    if (onChangeEmails && key in storedEmails) {
      const next = { ...storedEmails };
      delete next[key];
      onChangeEmails(next);
    }
  }

  // Custom tag — used by the "not from this company" path. Just adds
  // the typed name to this opp's tag list without touching the
  // prospect roster, so a one-off contact (consultant, broker,
  // someone at a different account) can ride along on this opp. When
  // the typed text is itself an email address, store it as the tag's
  // email too so it keeps rendering as an email.
  function tagCustom() {
    const name = customDraft.trim();
    if (!name) return;
    tagName(name, name.includes('@') ? name : '');
    setCustomDraft('');
  }

  const accountSelected = !!String(account || '').trim();
  const isEmpty = selected.length === 0;

  // Map tagged names back to their roster entry so the cell can show
  // emails (preferred) instead of names. Falls back to the raw tag
  // text when a tag doesn't resolve to a known contact.
  const contactByName = useMemo(() => {
    const map = new Map();
    for (const c of contactOptions) map.set(c.name.toLowerCase(), c);
    return map;
  }, [contactOptions]);

  // Resolve each tag's email: the live roster wins (freshest data), the
  // opp-stored map is the fallback that survives a lost HubSpot cache, and
  // a tag that is itself an email address renders as one.
  const taggedDetails = useMemo(() => selected.map(name => {
    const key = name.toLowerCase();
    const found = contactByName.get(key);
    const email = found?.email || storedEmails[key] || (name.includes('@') ? name : '');
    return { name, email };
  }), [selected, contactByName, storedEmails]);

  const displayString = useMemo(() => taggedDetails
    .map(t => t.email || t.name)
    .filter(Boolean)
    .join(', '), [taggedDetails]);

  function copyToClipboard(text, key) {
    if (!text) return;
    const writer = navigator?.clipboard?.writeText
      ? navigator.clipboard.writeText(text)
      : Promise.reject(new Error('clipboard unavailable'));
    Promise.resolve(writer)
      .then(() => {
        setCopied(key);
        setTimeout(() => setCopied((cur) => (cur === key ? null : cur)), 1100);
      })
      .catch(() => { /* clipboard blocked — user can still highlight manually */ });
  }

  const emailsOnly = taggedDetails.map(t => t.email).filter(Boolean).join(', ');
  const namesAndEmails = taggedDetails
    .map(t => t.email ? `${t.name} <${t.email}>` : t.name)
    .join('\n');

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, minHeight: '1em', minWidth: 0 }}
      onClick={(e) => e.stopPropagation()}
    >
      <span
        onClick={() => {
          if (isEmpty && !accountSelected) return;
          setOpen(o => !o);
        }}
        style={{
          flex: 1, minWidth: 0,
          cursor: (isEmpty && !accountSelected) ? 'default' : 'pointer',
          padding: '1px 2px',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          display: 'block',
        }}
        title={isEmpty
          ? (accountSelected ? 'Click to tag contacts' : 'Pick an Account first')
          : 'Click to view / copy contact details'}
      >
        {isEmpty ? '—' : displayString}
      </span>
      {/* The + Contacts pill only shows when the column is empty — once
          contacts are tagged, the user clicks the email list itself to
          open the same popover and the pill would just be noise. */}
      {accountSelected && isEmpty && (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            padding: '1px 6px', fontSize: '0.7rem', fontFamily: 'inherit',
            fontWeight: 600, color: '#166534', background: '#DCFCE7',
            border: '1px solid #86EFAC', borderRadius: 999, cursor: 'pointer',
            whiteSpace: 'nowrap', lineHeight: 1.4, flex: '0 0 auto',
          }}
          title="Tag contacts from this company"
        >+ Contacts</button>
      )}
      {open && createPortal(
        <div
          ref={popRef}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            ...(popPos.top != null ? { top: popPos.top } : {}),
            ...(popPos.bottom != null ? { bottom: popPos.bottom } : {}),
            left: popPos.left,
            zIndex: 9999, width: 380, maxWidth: '92vw',
            maxHeight: popPos.maxHeight, overflowY: 'auto',
            background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.18)',
            fontSize: '0.85rem',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.5rem 0.6rem',
            borderBottom: '1px solid var(--color-border-light)',
          }}>
            <div>
              <div style={{
                fontSize: '0.72rem', color: 'var(--color-text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600,
              }}>
                Tagged Contacts ({selected.length})
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--color-text)', marginTop: 1 }}>
                {onOpenCompany && matched ? (
                  <button
                    type="button"
                    onClick={() => { onOpenCompany(matched); setOpen(false); }}
                    title={`Open ${matched.company || account}'s company page`}
                    style={{
                      padding: 0, border: 'none', background: 'transparent',
                      fontFamily: 'inherit', fontSize: 'inherit', color: '#2563EB',
                      fontWeight: 600, cursor: 'pointer',
                      textDecoration: 'underline', textDecorationColor: '#93C5FD',
                      textUnderlineOffset: '2px',
                    }}
                  >{matched.company || account}</button>
                ) : (matched?.company || account || '—')}
              </div>
            </div>
            {!isEmpty && (
              <button
                type="button"
                onClick={() => { onChange(''); if (onChangeEmails) onChangeEmails({}); }}
                style={{
                  padding: '0.25rem 0.55rem', fontSize: '0.7rem', fontWeight: 600,
                  fontFamily: 'inherit', color: 'var(--color-text-muted)',
                  background: 'transparent', border: '1px solid var(--color-border)',
                  borderRadius: 3, cursor: 'pointer',
                }}
                title="Remove all tagged contacts"
              >Clear all</button>
            )}
          </div>

          {!isEmpty && (
            <>
              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                {taggedDetails.map((t, idx) => {
                  const key = `row-${idx}`;
                  return (
                    <div
                      key={`${t.name}-${idx}`}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                        padding: '0.45rem 0.7rem',
                        borderBottom: '1px solid var(--color-border-light)',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {onOpenContact ? (
                          <button
                            type="button"
                            onClick={() => { onOpenContact(t.name, t.email); setOpen(false); }}
                            title={`Open ${t.name}'s details`}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left',
                              padding: 0, border: 'none', background: 'transparent',
                              fontFamily: 'inherit', fontSize: 'inherit',
                              fontWeight: 600, color: '#2563EB', cursor: 'pointer',
                              textDecoration: 'underline', textDecorationColor: '#93C5FD',
                              textUnderlineOffset: '2px',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}
                          >{t.name}</button>
                        ) : (
                          <div style={{
                            fontWeight: 600, color: '#1E293B',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>{t.name}</div>
                        )}
                        <div style={{
                          fontSize: '0.75rem',
                          color: t.email ? 'var(--color-text-muted)' : '#94A3B8',
                          fontStyle: t.email ? 'normal' : 'italic',
                          userSelect: 'text',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{t.email || '(no email)'}</div>
                      </div>
                      {t.email && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(t.email, key)}
                          style={{
                            flex: '0 0 auto',
                            padding: '0.2rem 0.55rem', fontSize: '0.7rem', fontWeight: 600,
                            fontFamily: 'inherit',
                            color: copied === key ? '#166534' : 'var(--color-text-muted)',
                            background: copied === key ? '#DCFCE7' : 'transparent',
                            border: '1px solid var(--color-border)', borderRadius: 3,
                            cursor: 'pointer',
                          }}
                        >{copied === key ? 'Copied' : 'Copy'}</button>
                      )}
                      <button
                        type="button"
                        onClick={() => untag(t.name)}
                        title="Remove this tag"
                        style={{
                          flex: '0 0 auto',
                          width: 22, height: 22, padding: 0,
                          fontSize: '0.9rem', fontWeight: 600,
                          fontFamily: 'inherit', lineHeight: 1,
                          color: 'var(--color-text-muted)',
                          background: 'transparent',
                          border: '1px solid var(--color-border)', borderRadius: 3,
                          cursor: 'pointer',
                        }}
                      >×</button>
                    </div>
                  );
                })}
              </div>
              <div style={{
                display: 'flex', justifyContent: 'flex-end', gap: '0.4rem',
                padding: '0.4rem 0.6rem',
                borderBottom: '1px solid var(--color-border-light)',
                background: 'var(--color-bg)',
              }}>
                <button
                  type="button"
                  onClick={() => copyToClipboard(emailsOnly, 'all-emails')}
                  disabled={!emailsOnly}
                  style={{
                    padding: '0.25rem 0.6rem', fontSize: '0.72rem', fontWeight: 600,
                    fontFamily: 'inherit',
                    color: copied === 'all-emails' ? '#166534' : 'var(--color-text-muted)',
                    background: copied === 'all-emails' ? '#DCFCE7' : 'transparent',
                    border: '1px solid var(--color-border)', borderRadius: 3,
                    cursor: emailsOnly ? 'pointer' : 'not-allowed',
                    opacity: emailsOnly ? 1 : 0.5,
                  }}
                >{copied === 'all-emails' ? 'Copied' : 'Copy emails'}</button>
                <button
                  type="button"
                  onClick={() => copyToClipboard(namesAndEmails, 'all-pairs')}
                  style={{
                    padding: '0.25rem 0.6rem', fontSize: '0.72rem', fontWeight: 600,
                    fontFamily: 'inherit',
                    color: copied === 'all-pairs' ? '#166534' : 'var(--color-text-muted)',
                    background: copied === 'all-pairs' ? '#DCFCE7' : 'transparent',
                    border: '1px solid var(--color-border)', borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >{copied === 'all-pairs' ? 'Copied' : 'Copy names + emails'}</button>
              </div>
            </>
          )}

          {/* Add from the company's existing roster. */}
          <div style={{ padding: '0.5rem 0.6rem' }}>
            <div style={{
              fontSize: '0.7rem', color: 'var(--color-text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600,
              marginBottom: '0.3rem',
            }}>
              + Add from {matched?.company || account || 'this company'}
              {peLabel && <> &amp; {peLabel} <span style={{ color: '#7C3AED' }}>(PE Owner)</span></>}
            </div>
            <input
              type="text"
              value={query}
              placeholder="Filter contacts…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
              }}
              style={{
                width: '100%', boxSizing: 'border-box',
                border: '1px solid var(--color-border)', borderRadius: 3,
                padding: '5px 8px', fontSize: 'inherit', fontFamily: 'inherit',
                color: 'var(--color-text)', background: '#fff',
              }}
            />
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto', borderTop: '1px solid var(--color-border-light)' }}>
            {filteredOptions.length === 0 ? (
              <div style={{ padding: '0.6rem 0.7rem', color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
                {contactOptions.length === 0
                  ? 'No contacts on file for this company yet.'
                  : 'No contacts match the filter.'}
              </div>
            ) : filteredOptions.map(opt => {
              const isTagged = selectedSet.has(opt.name.toLowerCase());
              return (
                <div
                  key={opt.name}
                  onClick={() => isTagged ? untag(opt.name) : tagName(opt.name, opt.email)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.55rem',
                    padding: '0.4rem 0.7rem', cursor: 'pointer',
                    background: isTagged ? '#DCFCE7' : 'transparent',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      color: isTagged ? '#166534' : '#1E293B',
                      fontWeight: isTagged ? 600 : 500,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {opt.name}
                      {opt.source === 'pe' && (
                        <span
                          title={`PE Owner — ${opt.company}`}
                          style={{
                            marginLeft: 6, padding: '0 5px', fontSize: '0.62rem', fontWeight: 700,
                            color: '#6D28D9', background: '#F3E8FF', border: '1px solid #DDD6FE',
                            borderRadius: 999, verticalAlign: 'middle', whiteSpace: 'nowrap',
                          }}
                        >PE</span>
                      )}
                    </div>
                    {opt.email && (
                      <div style={{
                        fontSize: '0.72rem',
                        color: isTagged ? '#15803D' : 'var(--color-text-muted)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{opt.email}</div>
                    )}
                  </span>
                  <span style={{
                    flex: '0 0 auto', fontSize: '0.7rem', fontWeight: 600,
                    color: isTagged ? '#15803D' : 'var(--color-text-muted)',
                  }}>{isTagged ? '✓ Tagged' : '+ Add'}</span>
                </div>
              );
            })}
          </div>

          {/* Custom contact — someone NOT from this company. Just tags
              the name on this opp; doesn't touch the prospect roster. */}
          <div style={{
            padding: '0.5rem 0.6rem',
            borderTop: '1px solid var(--color-border-light)',
            background: 'var(--color-bg)',
          }}>
            <div style={{
              fontSize: '0.7rem', color: 'var(--color-text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600,
              marginBottom: '0.3rem',
            }}>
              + Add custom contact (not from this company)
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input
                type="text"
                value={customDraft}
                placeholder="Name…"
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
                  if (e.key === 'Enter') { e.preventDefault(); tagCustom(); }
                }}
                style={{
                  flex: 1, minWidth: 0, boxSizing: 'border-box',
                  border: '1px solid var(--color-border)', borderRadius: 3,
                  padding: '5px 8px', fontSize: 'inherit', fontFamily: 'inherit',
                  color: 'var(--color-text)', background: '#fff',
                }}
              />
              <button
                type="button"
                onClick={tagCustom}
                disabled={!customDraft.trim()}
                style={{
                  padding: '0.25rem 0.7rem', background: 'var(--color-accent)',
                  border: '1px solid var(--color-accent)', borderRadius: 3,
                  fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit',
                  color: '#fff',
                  cursor: customDraft.trim() ? 'pointer' : 'not-allowed',
                  opacity: customDraft.trim() ? 1 : 0.5,
                }}
              >Add</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Default column → list bindings for Opps 2 — preserve the original
// hard-coded behavior for new users. The user can override or extend
// these per column from the "Link columns" modal; picks made there
// (including an explicit `none`) win over these defaults.
const DEFAULT_COLUMN_LINKS = {
  Scope:  { listKey: 'solutions',    mode: 'multi'  },
  Source: { listKey: 'source',       mode: 'single' },
  Stage:  { listKey: 'status',       mode: 'single' },
  Status: { listKey: 'whoIsWaiting', mode: 'single' },
  'Chance?': { listKey: 'chance',    mode: 'single' },
};

// Thin wrapper around the shared resolver so existing call sites in
// this file don't need to thread DEFAULT_COLUMN_LINKS through every
// invocation.
function resolveColumnLink(columnName, userLinks) {
  return resolveSharedColumnLink(columnName, userLinks, DEFAULT_COLUMN_LINKS);
}


// Modal that fires right before a new opp is committed. Collects the
// fields the user wants set up front — Company (Account), Source,
// company Type, and PE Owner — instead of leaving them blank for inline
// editing. The Company and PE Owner inputs autocomplete from the same
// suggestion lists their table cells use (Table View companies + names
// already on this tab); Type prefills from the matched Table View
// record so it can be reviewed (and corrected) as part of the flow.
// When the typed Company doesn't already exist in Table View, the modal
// offers to add it there as a new company so the two views stay in
// sync. Account may be pre-filled when the flow came from the Add
// Company combobox.
function NewOppModal({ account: initialAccount, sourceOptions = [], companySuggestions = [], peOwnerSuggestions = [], prospects = [], onCreate, onCancel }) {
  const [company, setCompany] = useState(initialAccount || '');
  const [source, setSource] = useState('');
  // PE Owners as a chip list (a company can have several). Until the
  // user edits, the chips derive from the matched Table View company
  // (see `peOwners` below), so changing the Company re-prefills them
  // without a sync effect. The draft buffers the owner being typed.
  const [peOwnersInput, setPeOwnersInput] = useState([]);
  const [peOwnerDraft, setPeOwnerDraft] = useState('');
  const [peOwnerTouched, setPeOwnerTouched] = useState(false);
  // Same touched-buffer pattern for the company Type.
  const [typeInput, setTypeInput] = useState('');
  const [typeTouched, setTypeTouched] = useState(false);
  const [addToTableView, setAddToTableView] = useState(true);

  const trimmedCompany = company.trim();
  const matchedProspect = useMemo(
    () => (trimmedCompany ? findProspectForAccount(trimmedCompany, prospects) : null),
    [trimmedCompany, prospects],
  );
  const companyExists = !!matchedProspect;
  const companyType = String(matchedProspect?.type || '').trim();
  // Only meaningful when the Company is new (not yet in Table View).
  const canAddCompany = !!trimmedCompany && !companyExists;
  // Prefill the PE Owners from the matched Table View company until the
  // user edits the chips.
  const peOwners = peOwnerTouched ? peOwnersInput : splitPeOwners(matchedProspect?.peOwner || '');
  function addPeOwner(text) {
    const next = [...peOwners];
    for (const part of splitPeOwners(text)) {
      if (!next.some(o => o.toLowerCase() === part.toLowerCase())) next.push(part);
    }
    setPeOwnerTouched(true);
    setPeOwnersInput(next);
    setPeOwnerDraft('');
  }
  function removePeOwner(name) {
    setPeOwnerTouched(true);
    setPeOwnersInput(peOwners.filter(o => o !== name));
  }
  const peOwnerSuggestionSet = useMemo(
    () => new Set(peOwnerSuggestions.map(s => String(s).toLowerCase())),
    [peOwnerSuggestions],
  );
  // Prefill Type from the matched Table View company until the user
  // picks their own value.
  const type = typeTouched ? typeInput : companyType;

  // Company context shown once a company is entered: its CDM and account
  // Tier (from the Table View record) plus the frameworks it's associated
  // with on the Lists page. computeListFlags merges the Lists-page mappings
  // with the prospect's manual frameworks, keyed by lowercased company name.
  const cdm = String(matchedProspect?.cdm || '').trim();
  const tier = String(matchedProspect?.tier || '').trim();
  const [flaggedFrameworks, setFlaggedFrameworks] = useState([]);
  // User edits to the framework flags, scoped to the company they were
  // made for so changing the Company resets to that company's computed
  // flags (and a background prospects refresh can't clobber the edit).
  const [frameworkEdit, setFrameworkEdit] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!trimmedCompany) { if (!cancelled) setFlaggedFrameworks([]); return; }
      try {
        const flags = await computeListFlags([trimmedCompany], { prospects });
        if (cancelled) return;
        const set = flags.get(trimmedCompany.toLowerCase().trim()) || new Set();
        setFlaggedFrameworks([...set].sort((a, b) => a.localeCompare(b)));
      } catch {
        if (!cancelled) setFlaggedFrameworks([]);
      }
    })();
    return () => { cancelled = true; };
  }, [trimmedCompany, prospects]);
  const frameworks = (frameworkEdit && frameworkEdit.company === trimmedCompany)
    ? frameworkEdit.list
    : flaggedFrameworks;
  const frameworksEdited = !!(frameworkEdit && frameworkEdit.company === trimmedCompany)
    && (frameworks.length !== flaggedFrameworks.length || frameworks.some(f => !flaggedFrameworks.includes(f)));
  function toggleFramework(label) {
    const next = frameworks.includes(label)
      ? frameworks.filter(f => f !== label)
      : [...frameworks, label].sort((a, b) => a.localeCompare(b));
    setFrameworkEdit({ company: trimmedCompany, list: next });
  }
  // Keep a saved non-standard framework label selectable so editing
  // doesn't silently drop it.
  const frameworkOptions = useMemo(
    () => [...FRAMEWORKS, ...frameworks.filter(f => !FRAMEWORKS.includes(f))],
    [frameworks],
  );

  // Show the context panel once a company name is typed, so the
  // framework flags are selectable even for brand-new companies.
  const showCompanyInfo = !!trimmedCompany;

  function submit() {
    // Fold in a typed-but-uncommitted draft so an owner the user didn't
    // chip (no Enter / suggestion pick) still lands on the opp.
    const owners = [...peOwners];
    for (const part of splitPeOwners(peOwnerDraft)) {
      if (!owners.some(o => o.toLowerCase() === part.toLowerCase())) owners.push(part);
    }
    onCreate({
      company: trimmedCompany,
      source,
      peOwner: joinPeOwners(owners),
      type: type.trim(),
      frameworks,
      frameworksEdited,
      addToTableView: canAddCompany && addToTableView,
    });
  }

  const labelStyle = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 4, display: 'block' };
  const fieldStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '0.45rem 0.55rem',
    border: '1px solid var(--color-border)', borderRadius: 4,
    fontSize: '0.85rem', fontFamily: 'inherit',
    background: '#fff', color: 'var(--color-text)',
  };

  return createPortal(
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        style={{
          width: 440, maxWidth: '92vw',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)',
        }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
            New Opp
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            Set the Company, Source, Type, and PE Owner for the new row. All are optional and editable later.
          </div>
        </div>

        <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <div>
            <label style={labelStyle}>Company</label>
            <input
              autoFocus
              type="text"
              list="newopp-company-list"
              value={company}
              placeholder="Company name…"
              onChange={(e) => setCompany(e.target.value)}
              style={fieldStyle}
            />
            <datalist id="newopp-company-list">
              {companySuggestions.map(c => <option key={c} value={c} />)}
            </datalist>
            {trimmedCompany && companyExists && (
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                ✓ In Table View · type:{' '}
                <strong style={{ color: 'var(--color-text)' }}>{companyType || 'Unknown'}</strong>
              </div>
            )}
            {canAddCompany && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: 'var(--color-text)', marginTop: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={addToTableView}
                  onChange={(e) => setAddToTableView(e.target.checked)}
                />
                Add <strong>{trimmedCompany}</strong> to Table View (not found there yet)
              </label>
            )}
            {showCompanyInfo && (
              <div style={{
                marginTop: 8, padding: '0.5rem 0.6rem',
                background: 'var(--color-bg)', border: '1px solid var(--color-border-light)',
                borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 4,
                fontSize: '0.74rem', color: 'var(--color-text)',
              }}>
                <div><span style={{ color: 'var(--color-text-muted)' }}>CDM:</span>{' '}<strong>{cdm || '—'}</strong></div>
                <div><span style={{ color: 'var(--color-text-muted)' }}>Tier:</span>{' '}<strong>{tier || '—'}</strong></div>
                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>Frameworks:</span>{' '}
                  <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, verticalAlign: 'top' }}>
                    {frameworkOptions.map(f => {
                      const on = frameworks.includes(f);
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() => toggleFramework(f)}
                          title={on ? `Remove the ${f} flag` : `Flag ${f}`}
                          style={{
                            padding: '0px 6px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700,
                            fontFamily: 'inherit', cursor: 'pointer',
                            background: on ? '#EFF6FF' : 'transparent',
                            color: on ? '#1E3A8A' : 'var(--color-text-muted)',
                            border: on ? '1px solid #BFDBFE' : '1px dashed var(--color-border)',
                          }}
                        >{f}</button>
                      );
                    })}
                  </span>
                  {frameworksEdited && companyExists && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 3 }}>
                      Will update <strong>{matchedProspect.company}</strong>&apos;s Frameworks in Table View.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <label style={labelStyle}>Source</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              style={fieldStyle}
            >
              <option value="">— Select a Source —</option>
              {sourceOptions.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Type</label>
            <select
              value={type}
              onChange={(e) => { setTypeTouched(true); setTypeInput(e.target.value); }}
              style={fieldStyle}
            >
              <option value="">— Select a Type —</option>
              {/* Keep a saved non-standard type selectable so reviewing it
                  doesn't silently blank the dropdown. */}
              {type && !TYPES.includes(type) && <option value={type}>{type}</option>}
              {TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {companyExists && type !== companyType && (
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                {type
                  ? <>Will set <strong>{matchedProspect.company}</strong>&apos;s Type in Table View to <strong>{type}</strong> (currently <strong>{companyType || 'no type'}</strong>).</>
                  : <>Will clear <strong>{matchedProspect.company}</strong>&apos;s Type in Table View (currently <strong>{companyType}</strong>).</>}
              </div>
            )}
          </div>

          <div>
            <label style={labelStyle}>PE Owner{peOwners.length > 1 ? 's' : ''}</label>
            {peOwners.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 5 }}>
                {peOwners.map(o => (
                  <span key={o} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '1px 4px 1px 8px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600,
                    background: '#F3E8FF', color: '#6D28D9', border: '1px solid #DDD6FE',
                  }}>
                    {o}
                    <button
                      type="button"
                      onClick={() => removePeOwner(o)}
                      title={`Remove ${o}`}
                      style={{
                        border: 'none', background: 'transparent', cursor: 'pointer',
                        padding: 0, lineHeight: 1, fontSize: '0.78rem', color: '#7C3AED', fontFamily: 'inherit',
                      }}
                    >×</button>
                  </span>
                ))}
              </div>
            )}
            <input
              type="text"
              list="newopp-peowner-list"
              value={peOwnerDraft}
              placeholder={peOwners.length ? 'Add another PE Owner…' : 'PE Owner (if portfolio co)…'}
              onChange={(e) => {
                const v = e.target.value;
                // Picking a datalist suggestion fires a change with the
                // full name — commit it as a chip right away so another
                // owner can be added after it.
                if (peOwnerSuggestionSet.has(v.trim().toLowerCase())) { addPeOwner(v); return; }
                setPeOwnerDraft(v);
              }}
              onKeyDown={(e) => {
                // Enter or comma commits the typed owner as a chip
                // (Cmd/Ctrl+Enter still submits via the modal handler).
                if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === ',') {
                  if (peOwnerDraft.trim()) { e.preventDefault(); addPeOwner(peOwnerDraft); }
                  else if (e.key === ',') e.preventDefault();
                }
              }}
              style={fieldStyle}
            />
            <datalist id="newopp-peowner-list">
              {peOwnerSuggestions.map(p => <option key={p} value={p} />)}
            </datalist>
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.4rem',
          padding: '0.6rem 1rem',
          borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)',
        }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '0.35rem 0.7rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Cancel</button>
          <button
            type="button"
            onClick={submit}
            style={{
              padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#fff', cursor: 'pointer',
            }}
          >Create opp</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Popup that fires after Stage flips to "Not Sold". Prompts the user to
// fill in the three close-out columns (Close Date, Reason Not Sold,
// Final Margin) so the downstream reporting tabs (AgentsView's
// Not-Sold BFO Status block + PipelineView's Final Margin table) have
// what they need without the user having to remember to hunt for the
// columns after the stage change.
//
// The modal pre-populates with whatever the row already has — the
// Close Date was just auto-stamped to today by updateOppField (when it
// was empty), so it shows up here ready to adjust. Save applies the
// three values via updateOppField (skipping fields the user left
// untouched). Skip leaves the row as-is — Stage is still set to Not
// Sold and the stamped Close Date stays.
function NotSoldFollowUpModal({ opp, reasonOptions, onSave, onClose }) {
  const [closeDate, setCloseDate] = useState(toISODate(opp?.['Close Date']) || '');
  const [reason, setReason] = useState(String(opp?.['Reason Not Sold'] ?? ''));
  const [finalMargin, setFinalMargin] = useState(String(opp?.['Final Margin'] ?? ''));

  function handleSave() {
    onSave({
      closeDate,
      reason,
      finalMargin: finalMargin.trim(),
    });
  }

  const labelStyle = { fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text)', display: 'block', marginBottom: 4 };
  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '0.45rem 0.55rem',
    border: '1px solid var(--color-border)', borderRadius: 4,
    fontSize: '0.85rem', fontFamily: 'inherit',
    background: '#fff', color: 'var(--color-text)',
  };

  // Only dismiss when the press *started* on the backdrop. Drag-selecting text
  // in a field and releasing the mouse over the dimmed backdrop otherwise fires
  // a click on the overlay that would close the popup mid-selection.
  const backdropMouseDown = useRef(false);

  return createPortal(
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        style={{
          width: 460, maxWidth: '92vw',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
            Close out this opportunity
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            <strong>{opp?.['Account'] || 'This opp'}</strong>
            {opp?.['Scope'] ? <> &middot; {opp['Scope']}</> : null}
            {' '}is now marked <strong>Not Sold</strong>. Fill in the close-out details below.
          </div>
        </div>

        <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <div>
            <label style={labelStyle}>Close Date</label>
            <input
              type="date"
              autoFocus
              value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Reason Not Sold</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={inputStyle}
            >
              <option value="">— Select a reason —</option>
              {reasonOptions.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Final Margin</label>
            <input
              type="text"
              value={finalMargin}
              onChange={(e) => setFinalMargin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
              }}
              placeholder="e.g. 22% or $4,500"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.6rem 1rem',
          borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.35rem 0.7rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Skip for now</button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#fff', cursor: 'pointer',
            }}
          >Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Popup that fires after Stage flips to "Sold". Prompts the user to
// fill in the three close-out columns (Reason Not Sold, Final Margin,
// Competition). The Close Date is set automatically to the date of the
// status change (see updateOppField) and shown here read-only so the
// user knows it was captured. Mirrors the NotSoldFollowUpModal pattern.
function SoldFollowUpModal({ opp, reasonOptions, competitionOptions, onSave, onClose }) {
  const [reason, setReason] = useState(String(opp?.['Reason Not Sold'] ?? ''));
  const [finalMargin, setFinalMargin] = useState(String(opp?.['Final Margin'] ?? ''));
  const [competition, setCompetition] = useState(String(opp?.['Competition'] ?? ''));

  function handleSave() {
    onSave({
      reason,
      finalMargin: finalMargin.trim(),
      competition: competition.trim(),
    });
  }

  const labelStyle = { fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text)', display: 'block', marginBottom: 4 };
  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '0.45rem 0.55rem',
    border: '1px solid var(--color-border)', borderRadius: 4,
    fontSize: '0.85rem', fontFamily: 'inherit',
    background: '#fff', color: 'var(--color-text)',
  };

  // Only dismiss when the press *started* on the backdrop. Drag-selecting text
  // in a field and releasing the mouse over the dimmed backdrop otherwise fires
  // a click on the overlay that would close the popup mid-selection.
  const backdropMouseDown = useRef(false);

  return createPortal(
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        style={{
          width: 460, maxWidth: '92vw',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
            Close out this opportunity
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            <strong>{opp?.['Account'] || 'This opp'}</strong>
            {opp?.['Scope'] ? <> &middot; {opp['Scope']}</> : null}
            {' '}is now marked <strong>Sold</strong>. Fill in the close-out details below.
          </div>
        </div>

        <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <div>
            <label style={labelStyle}>Close Date</label>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text)' }}>
              {formatDateDisplay(opp?.['Close Date']) || '—'}
              <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginLeft: 6 }}>
                (set to the status-change date)
              </span>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Reason Not Sold</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={inputStyle}
            >
              <option value="">— Select a reason —</option>
              {reasonOptions.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Final Margin</label>
            <input
              type="text"
              autoFocus
              value={finalMargin}
              onChange={(e) => setFinalMargin(e.target.value)}
              placeholder="e.g. 22% or $4,500"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Competition</label>
            <select
              value={competition}
              onChange={(e) => setCompetition(e.target.value)}
              style={inputStyle}
            >
              <option value="">— Select —</option>
              {competitionOptions.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.6rem 1rem',
          borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.35rem 0.7rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Skip for now</button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#fff', cursor: 'pointer',
            }}
          >Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Popup that fires when an opp's Stage flips from "Not Started" to
// "Lead". Prompts the user to enter the Quoted Amount on the spot so a
// freshly-activated opp carries a dollar figure into the pipeline.
// Pre-populates with whatever the row already has. Save applies the
// value via updateOppField; Skip leaves the row as-is (Stage is still
// Lead). Mirrors the NotSoldFollowUpModal pattern.
function LeadQuotedAmountModal({ opp, onSave, onClose }) {
  const [quotedAmount, setQuotedAmount] = useState(String(opp?.['Quoted Amount'] ?? ''));

  function handleSave() {
    onSave({ quotedAmount: quotedAmount.trim() });
  }

  const labelStyle = { fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text)', display: 'block', marginBottom: 4 };
  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '0.45rem 0.55rem',
    border: '1px solid var(--color-border)', borderRadius: 4,
    fontSize: '0.85rem', fontFamily: 'inherit',
    background: '#fff', color: 'var(--color-text)',
  };

  // Only dismiss when the press *started* on the backdrop. Drag-selecting text
  // in a field and releasing the mouse over the dimmed backdrop otherwise fires
  // a click on the overlay that would close the popup mid-selection.
  const backdropMouseDown = useRef(false);

  return createPortal(
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        style={{
          width: 420, maxWidth: '92vw',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
            Enter the Deal Size
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            <strong>{opp?.['Account'] || 'This opp'}</strong>
            {opp?.['Scope'] ? <> &middot; {opp['Scope']}</> : null}
            {' '}just moved to <strong>Lead</strong>. Add the Deal Size below.
          </div>
        </div>

        <div style={{ padding: '0.85rem 1rem' }}>
          <label style={labelStyle}>Deal Size</label>
          <input
            type="text"
            autoFocus
            value={quotedAmount}
            onChange={(e) => setQuotedAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
            }}
            placeholder="e.g. $25,000"
            style={inputStyle}
          />
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.6rem 1rem',
          borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.35rem 0.7rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Skip for now</button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#fff', cursor: 'pointer',
            }}
          >Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Prompt shown whenever an opp moves into the "Quoted" stage so the user
// can enter / review the quote-tracking data points (Quoted On, Chance?,
// Margin Email Date - Sales Leader Review Date). Pre-populated with the
// opp's current values (with fallbacks to alternate key names) so it
// doubles as a review screen. Mirrors the NotSoldFollowUpModal pattern.
function QuotedFollowUpModal({ opp, chanceOptions, onSave, onClose }) {
  // Read current values with fallbacks to the alternate key names other
  // views / imported sheets use, so existing data shows up here instead
  // of looking blank. The combined margin/review field also absorbs the
  // two legacy split columns if a row was saved before they merged.
  const curQuotedOn = opp?.['Quoted On'] ?? opp?.['Quoted Date'] ?? '';
  const curChance = opp?.['Chance?'] ?? opp?.['Chance'] ?? '';
  const curMarginReview = opp?.['Margin Email Date - Sales Leader Review Date']
    ?? opp?.['Margin Email Date'] ?? opp?.['Sales Leader Review Date'] ?? '';

  const [quotedOn, setQuotedOn] = useState(toISODate(curQuotedOn) || '');
  const [chance, setChance] = useState(String(curChance ?? ''));
  const [marginReviewDate, setMarginReviewDate] = useState(toISODate(curMarginReview) || '');

  function handleSave() {
    onSave({ quotedOn, chance, marginReviewDate });
  }

  // Shows the value already stored on the opp so the user reviews what's
  // there rather than entering blind. Hidden when there's nothing yet.
  const hintStyle = { fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: 3 };
  const dateHint = (raw) => {
    const v = (raw ?? '').toString().trim();
    return v ? <div style={hintStyle}>Currently: {formatDateDisplay(v)}</div> : null;
  };
  const textHint = (raw) => {
    const v = (raw ?? '').toString().trim();
    return v ? <div style={hintStyle}>Currently: {v}</div> : null;
  };

  const labelStyle = { fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text)', display: 'block', marginBottom: 4 };
  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '0.45rem 0.55rem',
    border: '1px solid var(--color-border)', borderRadius: 4,
    fontSize: '0.85rem', fontFamily: 'inherit',
    background: '#fff', color: 'var(--color-text)',
  };

  // Only dismiss when the press *started* on the backdrop. Drag-selecting text
  // in a field and releasing the mouse over the dimmed backdrop otherwise fires
  // a click on the overlay that would close the popup mid-selection.
  const backdropMouseDown = useRef(false);

  return createPortal(
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        style={{
          width: 460, maxWidth: '92vw',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
            Quote details
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            <strong>{opp?.['Account'] || 'This opp'}</strong>
            {opp?.['Scope'] ? <> &middot; {opp['Scope']}</> : null}
            {' '}is now <strong>Quoted</strong>. Enter or review the quote-tracking details below.
          </div>
        </div>

        <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <div>
            <label style={labelStyle}>Quoted On</label>
            <input
              type="date"
              autoFocus
              value={quotedOn}
              onChange={(e) => setQuotedOn(e.target.value)}
              style={inputStyle}
            />
            {dateHint(curQuotedOn)}
          </div>
          <div>
            <label style={labelStyle}>Chance?</label>
            <select
              value={chance}
              onChange={(e) => setChance(e.target.value)}
              style={inputStyle}
            >
              <option value="">— Select —</option>
              {chanceOptions.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            {textHint(curChance)}
          </div>
          <div>
            <label style={labelStyle}>Margin Email Date - Sales Leader Review Date</label>
            <input
              type="date"
              value={marginReviewDate}
              onChange={(e) => setMarginReviewDate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
              }}
              style={inputStyle}
            />
            {dateHint(curMarginReview)}
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.6rem 1rem',
          borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.35rem 0.7rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Skip for now</button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#fff', cursor: 'pointer',
            }}
          >Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Prompt shown whenever an opp's Follow Up date changes, asking the user
// to pick the new Status (Who is waiting) for that opp so it stays
// current with each follow-up. Cleared on Save or Skip.
function FollowUpStatusModal({ opp, statusOptions, onSave, onClose, onCancel }) {
  const curStatus = opp?.['Status'] ?? '';
  const [status, setStatus] = useState(String(curStatus ?? ''));
  const [salesPartner, setSalesPartner] = useState(String(opp?.['Sales Partner'] ?? ''));

  // Seed the Next Steps rows from the same source the standalone
  // NextStepsEditor uses so this popup edits them in the identical
  // Next Step / Waiting On format. Kept as local state and flattened
  // back on Save.
  const noteLines = useMemo(() => textToBulletItems(opp?.['Next Steps']), [opp]);
  const storedWaiting = Array.isArray(opp?._nextStepsWaiting) ? opp._nextStepsWaiting : [];
  const [rows, setRows] = useState(() => {
    const seed = noteLines.map((note, i) => ({ note, waitingOn: String(storedWaiting[i] || '') }));
    return seed.length > 0 ? seed : [{ note: '', waitingOn: '' }];
  });
  const updateRow = (idx, key, value) => setRows(prev => prev.map((r, i) => i === idx ? { ...r, [key]: value } : r));
  const addRow = () => setRows(prev => [...prev, { note: '', waitingOn: '' }]);
  const deleteRow = (idx) => setRows(prev => {
    const next = prev.filter((_, i) => i !== idx);
    return next.length > 0 ? next : [{ note: '', waitingOn: '' }];
  });

  function handleSave() {
    const kept = rows.filter(r => (r.note || '').trim() || (r.waitingOn || '').trim());
    const nextSteps = kept.map(r => encodeNoteLine(r.note)).join('\n');
    const nextStepsWaiting = kept.map(r => (r.waitingOn || '').trim());
    onSave({ status, nextSteps, nextStepsWaiting, salesPartner: salesPartner.trim() });
  }

  const hintStyle = { fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: 3 };
  const textHint = (raw) => {
    const v = (raw ?? '').toString().trim();
    return v ? <div style={hintStyle}>Currently: {v}</div> : null;
  };

  const labelStyle = { fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text)', display: 'block', marginBottom: 4 };
  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '0.45rem 0.55rem',
    border: '1px solid var(--color-border)', borderRadius: 4,
    fontSize: '0.85rem', fontFamily: 'inherit',
    background: '#fff', color: 'var(--color-text)',
  };

  // Only dismiss when the press *started* on the backdrop. Drag-selecting text
  // in a field and releasing the mouse over the dimmed backdrop otherwise fires
  // a click on the overlay that would close the popup mid-selection.
  const backdropMouseDown = useRef(false);

  return createPortal(
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        style={{
          width: 'min(820px, 94vw)', maxHeight: '88vh',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
            Update Status
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            <strong>{opp?.['Account'] || 'This opp'}</strong>
            {opp?.['Scope'] ? <> &middot; {opp['Scope']}</> : null}
            {' '}has a new <strong>Follow Up</strong> date. Pick the current Status and review the Notes below.
          </div>
        </div>

        <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem', overflow: 'auto' }}>
          <div>
            <label style={labelStyle}>Status</label>
            <select
              autoFocus
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={inputStyle}
            >
              <option value="">— Select —</option>
              {statusOptions.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            {textHint(curStatus)}
          </div>
          <div>
            <label style={labelStyle}>Sales Partner</label>
            <input
              type="text"
              value={salesPartner}
              onChange={(e) => setSalesPartner(e.target.value)}
              placeholder="—"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <NextStepsRowsEditor
              rows={rows}
              onUpdateRow={updateRow}
              onAddRow={addRow}
              onDeleteRow={deleteRow}
              onCommit={() => {}}
              onQuickWaiting={(idx, value) => updateRow(idx, 'waitingOn', value)}
            />
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.6rem 1rem',
          borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)',
        }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={onCancel}
              title="Put the Follow Up date back to what it was before this edit."
              style={{
                padding: '0.35rem 0.7rem', background: 'transparent',
                border: '1px solid var(--color-border)', borderRadius: 4,
                fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
                color: 'var(--color-text-muted)', cursor: 'pointer',
              }}
            >Cancel</button>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.35rem 0.7rem', background: 'transparent',
                border: '1px solid var(--color-border)', borderRadius: 4,
                fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
                color: 'var(--color-text-muted)', cursor: 'pointer',
              }}
            >Skip for now</button>
          </div>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#fff', cursor: 'pointer',
            }}
          >Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Popup that shows the basic info for one opp + a Delete button. Opened
// from the row-level info button so the user can eyeball the full record
// without having to hunt through the (often horizontally scrolled) row.
export function OppInfoModal({
  opp,
  headers,
  onClose,
  onDelete,
  onFieldChange,
  columnLinks,
  listRegistry,
  companySuggestions,
  peOwnerSuggestions,
  prospects,
  updateProspect,
  hubspotContacts,
  pricingOptionServices,
  pricingOptionLinkName,
  onOpenContact,
  onOpenCompany,
}) {
  // Globally-hidden detail rows (header fields) + a session toggle to
  // temporarily reveal them. Declared before the early return so the
  // hook order stays stable. The hidden set is a global preference, so
  // toggling a row here hides/shows it on every opp's detail popup.
  const [hiddenFields, setHiddenFields] = useState(() => loadHiddenDetailFields());
  const [showHiddenRows, setShowHiddenRows] = useState(false);
  const toggleDetailField = useCallback((field) => {
    setHiddenFields(prev => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field); else next.add(field);
      saveHiddenDetailFields(next);
      return next;
    });
  }, []);
  if (!opp) return null;
  // Show every header column the row has a value for, in the same order
  // the table presents them, so the popup matches the user's mental
  // model of the row. Computed columns are pulled from the live row
  // (the parent computes them into the opp before passing it in).
  // Guarantee "BFO Company Name" shows here and sits right after the
  // BFO Opportunity Name (BFO Link) field — saved layouts that predate
  // the column would otherwise bury it at the very end (or omit it
  // until the next hydration appends it).
  const orderedFields = (headers || [])
    .filter(h => h && h !== '_select' && h !== '_info' && h !== '_actions' && h !== 'BFO Company Name');
  {
    const idx = orderedFields.indexOf('BFO Link');
    if (idx >= 0) orderedFields.splice(idx + 1, 0, 'BFO Company Name');
    else orderedFields.push('BFO Company Name');
  }
  // Count of currently-hidden rows among the fields this opp actually
  // shows, so the "Show N hidden" toggle reflects what's collapsed here.
  const hiddenCount = orderedFields.filter(h => hiddenFields.has(h)).length;
  const formatValue = (key, raw) => {
    if (raw == null || raw === '') return '—';
    if (DATE_COLUMNS.has(key)) return formatDateDisplay(raw);
    return String(raw);
  };
  const renderEditor = (h) => {
    const value = opp[h];
    // Computed columns stay read-only — they're derived from sibling
    // fields and don't have a stored value to edit.
    if (h === 'Call In' || h === 'Last Spoke') {
      return (
        <span style={{ color: 'var(--color-text-muted)' }}>
          {value == null || value === '' ? '—' : String(value)}
        </span>
      );
    }
    // Sourced from the matching Table View company, independent of the
    // opp's own edit callback, so it works even in the read-only modal.
    if (h === 'BFO Company Name') {
      return <BfoCompanyNameCell account={opp['Account']} prospects={prospects} updateProspect={updateProspect} />;
    }
    if (!onFieldChange) {
      // Fallback to the original read-only renderer when the modal is
      // mounted without an edit callback.
      return <span>{formatValue(h, value)}</span>;
    }
    const onChange = (v) => onFieldChange(h, v);
    if (DATE_COLUMNS.has(h)) {
      return <DateCell value={value} onChange={onChange} />;
    }
    if (TRISTATE_COLUMNS.has(h)) {
      return <TristateCheckCell value={value} onChange={onChange} title={`${h}: blank → ✓ → ✗ → blank`} />;
    }
    const link = columnLinks ? resolveColumnLink(h, columnLinks) : null;
    if (link && listRegistry) {
      const opts = listRegistry.get(link.listKey)?.options || [];
      if (link.mode === 'multi') {
        const extraGroups = link.listKey === 'solutions'
          ? Object.entries(pricingOptionServices || {})
              .map(([sheetName, services]) => ({
                label: sheetName,
                options: Array.isArray(services) ? services : [],
              }))
              .filter(g => g.options.length > 0)
              .sort((a, b) => a.label.localeCompare(b.label))
          : undefined;
        return (
          <MultiSelectCell
            value={value}
            onChange={onChange}
            options={opts}
            extraGroups={extraGroups}
            extraGroupsLabel="Add from Pricing Option"
            extraGroupsPlaceholder="— pick an option —"
            nowrap={h === 'Scope'}
          />
        );
      }
      return <SelectCell value={value} onChange={onChange} options={opts} />;
    }
    if (h === 'Contact') {
      return (
        <ContactCell
          value={value}
          onChange={onChange}
          account={opp['Account']}
          peOwner={opp['PE Owner']}
          prospects={prospects}
          updateProspect={updateProspect}
          hubspotContacts={hubspotContacts}
          onOpenContact={onOpenContact}
          onOpenCompany={onOpenCompany}
          contactEmails={opp._contactEmails}
          onChangeEmails={(m) => onFieldChange('_contactEmails', m)}
        />
      );
    }
    return (
      <EditableCell
        value={value}
        onChange={onChange}
        suggestions={h === 'Account' ? companySuggestions : h === 'PE Owner' ? peOwnerSuggestions : undefined}
      />
    );
  };
  // Only dismiss when the press *started* on the backdrop, so drag-selecting
  // text in a field and releasing over the backdrop doesn't close the popup.
  const backdropMouseDown = useRef(false);

  return createPortal(
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 1100, maxWidth: '94vw', maxHeight: '92vh',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: '0.7rem', color: 'var(--color-text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600,
            }}>Opp details</div>
            <div style={{
              fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {String(opp['Account'] || '').trim() || '(no account)'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.3rem 0.65rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Close</button>
        </div>

        <div style={{ overflowY: 'auto', padding: '0.5rem 1rem 0.75rem' }}>
          {needsUsdFlag(opp) && (
            // Same rule as the Flags-column 🚩: deal is Qualifying or
            // later but USD? has no real value. Surfaced here too so it's
            // visible even when the Flags column is hidden in the table.
            <div style={{
              margin: '0.25rem 0 0.75rem',
              padding: '0.6rem 0.8rem',
              border: '1px solid #FCA5A5', borderRadius: 6,
              background: '#FEF2F2', fontSize: '0.8rem',
              color: '#991B1B', lineHeight: 1.4,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: '1rem', flexShrink: 0 }}>🚩</span>
              <span>
                <strong>Missing USD value.</strong> This opp is at the{' '}
                <strong>{String(opp['Stage'] || '').trim() || 'current'}</strong> stage but the{' '}
                <strong>USD?</strong> field is blank or “-”. Fill it in to clear the flag.
              </span>
            </div>
          )}
          {opp._pricingOption ? (
            <div style={{ margin: '0.25rem 0 0.75rem' }}>
              <div style={{
                fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em',
                color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: '0.35rem',
              }}>Pricing Option (saved snapshot)</div>
              <PricingOptionSnapshotView snapshot={opp._pricingOption} />
            </div>
          ) : pricingOptionLinkName ? (
            // Linked to a Pricing Option by name, but no saved snapshot
            // on the record yet — likely a link created before the
            // snapshot feature shipped. Tell the user how to recapture.
            <div style={{
              margin: '0.25rem 0 0.75rem',
              padding: '0.6rem 0.8rem',
              border: '1px dashed var(--color-border)', borderRadius: 6,
              background: '#fff8e1', fontSize: '0.8rem',
              color: '#92400e', lineHeight: 1.4,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>
                Linked to <em>{pricingOptionLinkName}</em>, but no saved snapshot here yet.
              </div>
              <div>
                Open the Pricing tab, find that option, and click <strong>Save to Opp…</strong>
                again to capture the rows + Year 1 fees onto this opp. The new save
                will appear here.
              </div>
            </div>
          ) : null}
          {hiddenCount > 0 && (
            <div style={{
              display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
              margin: '0 0 0.35rem',
            }}>
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: '0.74rem', color: 'var(--color-text-muted)',
                fontWeight: 600, cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={showHiddenRows}
                  onChange={e => setShowHiddenRows(e.target.checked)}
                />
                Show {hiddenCount} hidden {hiddenCount === 1 ? 'row' : 'rows'}
              </label>
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <tbody>
              {orderedFields.map(h => {
                const isHidden = hiddenFields.has(h);
                if (isHidden && !showHiddenRows) return null;
                const label = headerLabel(h);
                return (
                  <tr key={h} style={{
                    borderTop: '1px solid var(--color-border-light)',
                    opacity: isHidden ? 0.5 : undefined,
                  }}>
                    <td style={{
                      padding: '0.45rem 0.4rem 0.45rem 0',
                      width: 24, verticalAlign: 'top',
                    }}>
                      <button
                        type="button"
                        onClick={() => toggleDetailField(h)}
                        title={isHidden
                          ? `Show "${label}" on every opp's details`
                          : `Hide "${label}" on every opp's details`}
                        aria-label={isHidden ? `Show ${label}` : `Hide ${label}`}
                        style={{
                          width: 18, height: 18, lineHeight: '16px',
                          padding: 0, borderRadius: 4,
                          border: '1px solid var(--color-border)',
                          background: isHidden ? '#E2E8F0' : 'transparent',
                          color: 'var(--color-text-muted)',
                          fontSize: '0.72rem', fontFamily: 'inherit',
                          cursor: 'pointer', display: 'block',
                        }}
                      >{isHidden ? '+' : '×'}</button>
                    </td>
                    <td style={{
                      padding: '0.45rem 0.5rem 0.45rem 0',
                      fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em',
                      color: 'var(--color-text-muted)', fontWeight: 600,
                      width: 170, verticalAlign: 'top',
                    }}>{label}</td>
                    <td style={{
                      padding: '0.45rem 0',
                      color: 'var(--color-text)',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>{renderEditor(h)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.6rem 1rem', borderTop: '1px solid var(--color-border-light)',
          background: 'var(--color-bg)',
        }}>
          {onDelete ? (
            <button
              type="button"
              onClick={() => {
                const label = String(opp['Account'] || '').trim() || 'this opp';
                if (window.confirm(`Delete ${label}? This can't be undone.`)) {
                  onDelete(opp._id);
                  onClose();
                }
              }}
              style={{
                padding: '0.4rem 0.85rem', background: '#FEE2E2',
                border: '1px solid #FCA5A5', borderRadius: 4,
                fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
                color: '#B91C1C', cursor: 'pointer',
              }}
            >Delete opp</button>
          ) : <span />}
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.4rem 0.95rem', background: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#fff', cursor: 'pointer',
            }}
          >Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Toolbar that pops in above the table once 1+ rows are checked. Lets
// the user push a single value into every selected opp at once (Stage,
// Status, Source, Scope, etc.) or bulk-delete them. The field list is
// driven by the column header set so it tracks whatever columns the
// user currently has + any list bindings they've set up.
function MassEditBar({ selectedCount, headers, columnLinks, listRegistry, onApply, onDelete, onClear, onEmailTable }) {
  const editableFields = useMemo(() => {
    const out = [];
    for (const h of headers || []) {
      if (!h || h === '_select' || h === '_info' || h === '_actions') continue;
      if (COMPUTED_COLUMNS.includes(h)) continue;
      out.push(h);
    }
    return out;
  }, [headers]);
  const [field, setField] = useState('Stage');
  const [textValue, setTextValue] = useState('');
  const [multiValue, setMultiValue] = useState('');
  // Whichever field is picked, reset both value buffers so a stale
  // value from the previous field doesn't get applied by accident.
  useEffect(() => { setTextValue(''); setMultiValue(''); }, [field]);

  const link = resolveColumnLink(field, columnLinks);
  const isDate = DATE_COLUMNS.has(field);
  const listOptions = link ? (listRegistry?.get(link.listKey)?.options || []) : null;
  const valueToApply = link && link.mode === 'multi' ? multiValue : textValue;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
      margin: '0 1.25rem 0.5rem',
      padding: '0.5rem 0.75rem',
      background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6,
      fontSize: '0.82rem',
    }}>
      <span style={{ fontWeight: 700, color: '#1E3A8A' }}>
        {selectedCount} selected
      </span>
      <span style={{ color: 'var(--color-text-muted)' }}>·</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        <span style={{ color: 'var(--color-text-muted)' }}>Set</span>
        <select
          value={field}
          onChange={(e) => setField(e.target.value)}
          style={{
            padding: '0.3rem 0.45rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        >
          {editableFields.map(h => (
            <option key={h} value={h}>{headerLabel(h)}</option>
          ))}
        </select>
      </label>
      <span style={{ color: 'var(--color-text-muted)' }}>to</span>
      {link && link.mode === 'multi' ? (
        <select
          multiple
          value={parseMulti(multiValue)}
          onChange={(e) => {
            const picked = Array.from(e.target.selectedOptions).map(o => o.value);
            setMultiValue(picked.join(', '));
          }}
          size={Math.min(6, Math.max(3, (listOptions || []).length))}
          style={{
            minWidth: 200, padding: '0.25rem 0.4rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        >
          {(listOptions || []).map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : link ? (
        <select
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          style={{
            minWidth: 180, padding: '0.3rem 0.45rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        >
          <option value="">— pick a value —</option>
          {(listOptions || []).map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : isDate ? (
        <input
          type="date"
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          style={{
            padding: '0.25rem 0.4rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        />
      ) : (
        <input
          type="text"
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          placeholder="New value (blank to clear)"
          style={{
            minWidth: 200, padding: '0.3rem 0.45rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        />
      )}
      <button
        type="button"
        onClick={() => onApply(field, valueToApply)}
        style={{
          padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
          border: '1px solid var(--color-accent)', borderRadius: 4,
          fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
          color: '#fff', cursor: 'pointer',
        }}
      >Apply to {selectedCount}</button>
      <button
        type="button"
        onClick={onEmailTable}
        title="Build a plain bordered table of the selected opps (choose which columns), ready to paste into an email"
        style={{
          padding: '0.35rem 0.7rem', background: '#fff',
          border: '1px solid #009530', borderRadius: 4,
          fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
          color: '#009530', cursor: 'pointer',
        }}
      >Email table</button>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Delete ${selectedCount} selected opp${selectedCount === 1 ? '' : 's'}? This can't be undone.`)) {
            onDelete();
          }
        }}
        style={{
          padding: '0.35rem 0.7rem', background: '#FEE2E2',
          border: '1px solid #FCA5A5', borderRadius: 4,
          fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
          color: '#B91C1C', cursor: 'pointer',
        }}
      >Delete selected</button>
      <button
        type="button"
        onClick={onClear}
        style={{
          padding: '0.35rem 0.7rem', background: 'transparent',
          border: '1px solid var(--color-border)', borderRadius: 4,
          fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
          color: 'var(--color-text-muted)', cursor: 'pointer',
        }}
      >Clear selection</button>
    </div>
  );
}

// Preview + copy modal for the Mass Edit "Email table" export. Lets the
// user pick which columns to include, then renders a plain black-and-white
// bordered table for the selected opps and copies it to the clipboard as
// rich HTML (text/html) so it pastes into Outlook / Gmail as a clean grid,
// with a plain-text fallback.
function EmailTableModal({ records, onClose, signature }) {
  const previewRef = useRef(null);
  const [copied, setCopied] = useState(false);
  // Selected column keys, defaulting to NEW_OPPS_EMAIL_DEFAULT_COLUMN_KEYS
  // (the rest stay available to toggle on). Kept as a Set; the table is
  // built in the canonical NEW_OPPS_EMAIL_COLUMNS order regardless of the
  // order the user toggles them.
  const [selectedKeys, setSelectedKeys] = useState(() => new Set(NEW_OPPS_EMAIL_DEFAULT_COLUMN_KEYS));
  const toggleKey = (key) => setSelectedKeys(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const orderedKeys = useMemo(
    () => NEW_OPPS_EMAIL_COLUMNS.map(c => c.key).filter(k => selectedKeys.has(k)),
    [selectedKeys]
  );
  const html = useMemo(() => buildNewOppsTableHtml(records, orderedKeys), [records, orderedKeys]);

  const copy = useCallback(async () => {
    const plain = previewRef.current?.innerText || '';
    let ok = false;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new window.ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          }),
        ]);
        ok = true;
      }
    } catch { /* fall through to execCommand */ }
    if (!ok) {
      // Fallback: select the rendered preview and run the legacy copy so
      // the table still lands on the clipboard with its borders.
      try {
        const range = document.createRange();
        range.selectNodeContents(previewRef.current);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        ok = document.execCommand('copy');
        sel.removeAllRanges();
      } catch { ok = false; }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      alert('Could not copy automatically — select the table below and copy with Ctrl/Cmd+C.');
    }
  }, [html]);

  // Download an Outlook draft (.eml) of the selected opps: subject "Small
  // Deal Size Help", greeting "Keith,", the chosen columns as the table,
  // and the user's signature. Same flow as the New Opps "Download Outlook
  // draft" — double-click the file to open it in Outlook.
  const createDraft = useCallback(() => {
    if (orderedKeys.length === 0) return;
    downloadOppsTableOutlookDraft(records, orderedKeys, { signature });
  }, [records, orderedKeys, signature]);

  return createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
        style={{
          width: 'min(1000px, 95vw)', maxHeight: '90vh',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
        }}>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
              Email table
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
              {records.length} opp{records.length === 1 ? '' : 's'}. Pick columns, then create an Outlook draft (or copy the table).
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={createDraft}
              disabled={orderedKeys.length === 0}
              title='Download an Outlook draft (.eml) — subject "Small Deal Size Help", starting "Keith," with your signature. Double-click the file to open it in Outlook.'
              style={{
                padding: '0.4rem 0.9rem', background: orderedKeys.length === 0 ? '#94A3B8' : '#0F6CBD',
                border: `1px solid ${orderedKeys.length === 0 ? '#94A3B8' : '#0F6CBD'}`, borderRadius: 4,
                fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
                color: '#fff', cursor: orderedKeys.length === 0 ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
              }}
            >Create Outlook draft</button>
            <button
              type="button"
              onClick={copy}
              disabled={orderedKeys.length === 0}
              style={{
                padding: '0.4rem 0.9rem', background: 'transparent',
                border: `1px solid ${orderedKeys.length === 0 ? 'var(--color-border)' : '#009530'}`, borderRadius: 4,
                fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
                color: orderedKeys.length === 0 ? 'var(--color-text-muted)' : (copied ? '#059669' : '#009530'),
                cursor: orderedKeys.length === 0 ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
              }}
            >{copied ? 'Copied!' : 'Copy table'}</button>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.4rem 0.8rem', background: 'transparent',
                border: '1px solid var(--color-border)', borderRadius: 4,
                fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
                color: 'var(--color-text-muted)', cursor: 'pointer',
              }}
            >Close</button>
          </div>
        </div>
        <div style={{
          padding: '0.6rem 1rem', borderBottom: '1px solid var(--color-border-light)',
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem 0.85rem',
        }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>Columns</span>
          <button
            type="button"
            onClick={() => setSelectedKeys(new Set(NEW_OPPS_EMAIL_COLUMNS.map(c => c.key)))}
            style={{ fontSize: '0.72rem', fontFamily: 'inherit', color: '#1E40AF', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >Select all</button>
          <button
            type="button"
            onClick={() => setSelectedKeys(new Set())}
            style={{ fontSize: '0.72rem', fontFamily: 'inherit', color: '#1E40AF', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >Clear</button>
          <span style={{ color: 'var(--color-border)' }}>|</span>
          {NEW_OPPS_EMAIL_COLUMNS.map(c => (
            <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--color-text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={selectedKeys.has(c.key)} onChange={() => toggleKey(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
        <div style={{ padding: '1rem', overflow: 'auto', background: '#F8FAFC' }}>
          <div
            ref={previewRef}
            style={{ background: '#fff', padding: '1rem', borderRadius: 6, border: '1px solid var(--color-border-light)' }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Tab- or comma-separated value parser that handles quoted fields,
// escaped quotes, and CRLF / LF endings. Same shape the Opps tab uses
// — duplicated here to keep the bulk-import modal self-contained.
function parseTabularText(text, delimiter) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === delimiter) { current.push(field); field = ''; }
      else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(field); field = '';
        if (ch === '\r') i++;
        rows.push(current); current = [];
      } else field += ch;
    }
  }
  if (field || current.length > 0) { current.push(field); rows.push(current); }
  return rows;
}

// Auto-detect whether a pasted blob is tab-separated (Google Sheets
// copy) or comma-separated (downloaded CSV). The first newline's worth
// of text is enough to decide reliably.
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
}

// Bulk Import modal — paste a Google-Sheet-shaped block, review the
// column mapping the modal auto-detected (and adjust by hand), see
// warnings about rows that won't import, and commit. The caller owns
// the actual setData / persistence; we just hand back the additions.
function BulkImportModal({ existingHeaders, existingRecords, dedupKeyFor, onClose, onImport }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState({});
  const [importing, setImporting] = useState(false);
  // When on, every formerly-skipped row gets imported anyway with a
  // `Review` note explaining why it was flagged (and, for dupes of an
  // existing row, the existing row gets a back-reference Review note
  // too). Lets the user audit the collisions in-place on Opps2
  // instead of fixing the source before re-pasting.
  const [flagAndImportAll, setFlagAndImportAll] = useState(false);
  const targetOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const h of (existingHeaders || [])) {
      if (h && !seen.has(h)) { seen.add(h); out.push(h); }
    }
    return out;
  }, [existingHeaders]);

  // Map of existing opp `_id` → 1..N display rank (matches the Opp #
  // column the parent table renders). Lets the dedup reasons and the
  // Excel export name a colliding opp by its visible number rather
  // than its raw internal id.
  const rankById = useMemo(() => {
    const map = new Map();
    const ids = (existingRecords || [])
      .map(r => r?._id)
      .filter(id => id != null)
      .sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
    ids.forEach((id, idx) => map.set(id, idx + 1));
    return map;
  }, [existingRecords]);

  // Esc / backdrop closes (but not while a commit is mid-flight).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !importing) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, importing]);

  function handleParse() {
    const raw = String(text || '').trim();
    if (!raw) { setParsed(null); return; }
    const delimiter = detectDelimiter(raw);
    const rows = parseTabularText(raw, delimiter);
    if (!rows.length) { setParsed(null); return; }
    const headers = rows[0].map(h => String(h || '').trim());
    const dataRows = rows.slice(1).filter(r => r.some(c => String(c || '').trim() !== ''));
    setParsed({ headers, rows: dataRows, delimiter });
    // Auto-map: exact match (case-insensitive) to an existing Opps 2
    // column, else "skip". User can override on any row.
    const lowerTargets = new Map(targetOptions.map(t => [t.toLowerCase(), t]));
    const auto = {};
    for (const h of headers) {
      if (!h) continue;
      const hit = lowerTargets.get(h.toLowerCase());
      auto[h] = hit || '';
    }
    setMapping(auto);
  }

  // Build the rows to insert + the list of skip reasons for each
  // pasted row. Mapping decides which source columns flow through;
  // duplicates are detected against existingRecords using the same
  // dedup key the parent uses for the Opps-tab import.
  const analysis = useMemo(() => {
    if (!parsed) return null;
    const additions = [];
    const skipped = [];
    // Map of dedup-key → existing record so a "duplicate" skip can
    // name the existing row, not just the opaque key. Without this,
    // a phantom Opps 2 record (e.g. a row whose Account+Scope match
    // but whose fields look blank in the table) blocks the paste with
    // no breadcrumb back to whatever's matching.
    const existingByKey = new Map();
    for (const r of (existingRecords || [])) {
      const k = dedupKeyFor(r);
      if (k && !existingByKey.has(k)) existingByKey.set(k, r);
    }
    const seenInPaste = new Map();
    for (let i = 0; i < parsed.rows.length; i++) {
      const cells = parsed.rows[i];
      const record = {};
      let hasMappedData = false;
      for (let j = 0; j < parsed.headers.length; j++) {
        const src = parsed.headers[j];
        const target = mapping[src];
        if (!target) continue;
        const val = String(cells[j] ?? '').trim();
        record[target] = val;
        if (val) hasMappedData = true;
      }
      const lineNo = i + 2; // +1 for header row, +1 for 1-indexed display
      if (!hasMappedData) {
        skipped.push({ lineNo, pasteRecord: record, reason: 'Empty row' });
        continue;
      }
      const key = dedupKeyFor(record);
      if (!key) {
        skipped.push({ lineNo, pasteRecord: record, reason: 'Missing dedup key (need BFO Link or Account + Scope + Year)' });
        continue;
      }
      if (existingByKey.has(key)) {
        const existing = existingByKey.get(key);
        // When BFO Link is the thing that matched, a different Account
        // on the paste row almost always means the source columns
        // shifted (e.g. an Account cell that belongs to a different
        // BFO opportunity). Flag the row so the user can remap names
        // or fix the source before re-pasting.
        const pasteAcct = String(record['Account'] || '').trim().toLowerCase();
        const existingAcct = String(existing['Account'] || '').trim().toLowerCase();
        const accountMismatch = key.startsWith('bfo:') && !!pasteAcct && !!existingAcct && pasteAcct !== existingAcct;
        const oppNum = rankById.get(existing._id) ?? existing._id;
        skipped.push({
          lineNo,
          accountMismatch,
          pasteAccount: record['Account'] || '',
          existingAccount: existing['Account'] || '',
          pasteRecord: record,
          existingRecord: existing,
          key,
          reason: `Duplicate opp (opp# ${oppNum})`,
        });
        continue;
      }
      if (seenInPaste.has(key)) {
        skipped.push({
          lineNo,
          pasteRecord: record,
          key,
          reason: `Duplicate opp (paste line ${seenInPaste.get(key)})`,
        });
        continue;
      }
      seenInPaste.set(key, lineNo);
      additions.push(record);
    }
    return { additions, skipped };
  }, [parsed, mapping, existingRecords, dedupKeyFor]);

  // Convert a skipped entry into an addition with `_reviewReason` (and
  // `_existingMatchId` when we know which existing row it collided
  // with). Used in flag-and-import mode so the parent can stamp the
  // Review column and back-reference the existing row.
  function flagSkippedAsAddition(s) {
    let reviewReason;
    if (s.existingRecord) {
      const accountSuffix = s.accountMismatch && s.existingAccount
        ? ` (existing account: "${s.existingAccount}")`
        : '';
      reviewReason = `Possible duplicate of opp# ${rankById.get(s.existingRecord._id) ?? s.existingRecord._id}${accountSuffix}`;
    } else if (s.reason.startsWith('Duplicate opp (paste line')) {
      reviewReason = s.reason.replace(/^Duplicate opp/, 'Possible duplicate');
    } else {
      reviewReason = s.reason;
    }
    const out = { ...(s.pasteRecord || {}), _reviewReason: reviewReason };
    if (s.existingRecord?._id != null) out._existingMatchId = s.existingRecord._id;
    return out;
  }

  const importableCount = analysis
    ? analysis.additions.length + (flagAndImportAll ? analysis.skipped.length : 0)
    : 0;

  async function handleImport() {
    if (!analysis || importableCount === 0) return;
    setImporting(true);
    try {
      const toImport = flagAndImportAll
        ? [...analysis.additions, ...analysis.skipped.map(flagSkippedAsAddition)]
        : analysis.additions;
      await onImport(toImport, parsed.headers, mapping);
    } finally {
      setImporting(false);
    }
  }

  // Build an .xlsx of every skipped row so the user can investigate
  // duplicates outside the modal. Columns: line / reason / dedup key
  // / account mismatch flag, then a Paste vs Existing pair for each
  // mapped target column so it's obvious which fields differ.
  async function handleExportDuplicates() {
    if (!analysis || analysis.skipped.length === 0) return;
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    const ws = wb.addWorksheet('Skipped rows');
    const mappedTargets = Array.from(new Set(
      Object.values(mapping || {}).filter(Boolean)
    ));
    const baseCols = [
      { header: 'Source line', key: '_lineNo', width: 12 },
      { header: 'Reason', key: '_reason', width: 28 },
      { header: 'Account mismatch (existing)', key: '_mismatch', width: 36 },
    ];
    const pairCols = mappedTargets.flatMap(t => [
      { header: `Paste · ${t}`, key: `paste__${t}`, width: 22 },
      { header: `Existing · ${t}`, key: `existing__${t}`, width: 22 },
    ]);
    ws.columns = [...baseCols, ...pairCols];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    for (const s of analysis.skipped) {
      const row = {
        _lineNo: s.lineNo,
        _reason: s.reason,
        _mismatch: s.accountMismatch ? (s.existingAccount || '(blank)') : '',
      };
      for (const t of mappedTargets) {
        row[`paste__${t}`] = s.pasteRecord ? (s.pasteRecord[t] ?? '') : '';
        row[`existing__${t}`] = s.existingRecord ? (s.existingRecord[t] ?? '') : '';
      }
      const added = ws.addRow(row);
      if (s.accountMismatch) {
        added.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        });
      }
    }
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to:   { row: 1 + analysis.skipped.length, column: ws.columns.length },
    };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Opps bulk import - skipped rows - ${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const mappedCount = useMemo(() => {
    if (!parsed) return 0;
    return parsed.headers.reduce((n, h) => n + (mapping[h] ? 1 : 0), 0);
  }, [parsed, mapping]);

  return (
    <div
      onClick={importing ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 8, padding: '1rem 1.25rem',
          width: 'min(900px, 96vw)', maxHeight: '90vh', overflow: 'auto',
          boxShadow: '0 18px 50px rgba(15, 23, 42, 0.32)',
          display: 'flex', flexDirection: 'column', gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>Bulk import from a Google Sheet</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none',
              cursor: importing ? 'not-allowed' : 'pointer',
              fontSize: '1.2rem', color: '#64748B', padding: '0 4px', lineHeight: 1,
            }}
          >×</button>
        </div>
        <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569', lineHeight: 1.45 }}>
          Copy a header row + data rows from your Google Sheet and paste below. The modal auto-detects tab or comma separation. Columns with the same name auto-map; tweak the dropdowns to point a source column at a different Opps column, or set it to <em>Skip</em>. Duplicates against existing Opps rows are skipped (same dedup as Import from Opps - Old tab).
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste here…"
          rows={6}
          spellCheck={false}
          style={{
            width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.78rem',
            padding: '0.5rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 6,
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleParse}
            disabled={!text.trim() || importing}
            style={{
              padding: '0.4rem 0.85rem', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              background: '#fff', color: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 6,
              cursor: (!text.trim() || importing) ? 'not-allowed' : 'pointer',
            }}
          >Parse</button>
          {parsed && (
            <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
              {parsed.rows.length} data row{parsed.rows.length === 1 ? '' : 's'} · {parsed.headers.length} source column{parsed.headers.length === 1 ? '' : 's'} · {mappedCount} mapped · delimiter: {parsed.delimiter === '\t' ? 'tab' : 'comma'}
            </span>
          )}
        </div>

        {parsed && (
          <>
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.35rem' }}>Column mapping</div>
              <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC' }}>
                      <th style={{ textAlign: 'left', padding: '0.35rem 0.55rem', borderBottom: '1px solid var(--color-border-light)' }}>Source column</th>
                      <th style={{ textAlign: 'left', padding: '0.35rem 0.55rem', borderBottom: '1px solid var(--color-border-light)' }}>→ Opps column</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.headers.map((h, idx) => (
                      <tr key={`${h}|${idx}`}>
                        <td style={{ padding: '0.3rem 0.55rem', borderBottom: '1px solid var(--color-border-light)', color: '#0f172a' }}>{h || <span style={{ color: '#94A3B8' }}>(unnamed col {idx + 1})</span>}</td>
                        <td style={{ padding: '0.3rem 0.55rem', borderBottom: '1px solid var(--color-border-light)' }}>
                          <select
                            value={mapping[h] || ''}
                            onChange={(e) => setMapping(prev => ({ ...prev, [h]: e.target.value }))}
                            style={{ width: '100%', fontFamily: 'inherit', fontSize: '0.74rem', padding: '2px 4px' }}
                          >
                            <option value="">— Skip this column —</option>
                            {targetOptions.map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {analysis && (() => {
              const mismatchCount = analysis.skipped.filter(s => s.accountMismatch).length;
              const flaggedLabel = flagAndImportAll ? 'flagged for review' : 'skipped';
              const flaggedBg = flagAndImportAll ? '#FFFBEB' : '#FEF3C7';
              const flaggedBorder = flagAndImportAll ? '#FCD34D' : '#FDE68A';
              return (
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 220px', padding: '0.5rem 0.75rem', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 6 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#166534' }}>{analysis.additions.length} clean row{analysis.additions.length === 1 ? '' : 's'} will import</div>
                  </div>
                  <div style={{ flex: '1 1 220px', padding: '0.5rem 0.75rem', background: flaggedBg, border: `1px solid ${flaggedBorder}`, borderRadius: 6 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#92400E' }}>{analysis.skipped.length} row{analysis.skipped.length === 1 ? '' : 's'} {flaggedLabel}</div>
                  </div>
                  {mismatchCount > 0 && (
                    <div style={{ flex: '1 1 220px', padding: '0.5rem 0.75rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 6 }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#991B1B' }}>⚠ {mismatchCount} account name mismatch{mismatchCount === 1 ? '' : 'es'}</div>
                      <div style={{ fontSize: '0.7rem', color: '#7F1D1D', marginTop: 2 }}>BFO Link matched an existing row but the Account differs — check column alignment or remap the names.</div>
                    </div>
                  )}
                </div>
              );
            })()}

            {analysis && analysis.skipped.length > 0 && (
              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                padding: '0.5rem 0.75rem', background: '#FFFBEB',
                border: '1px solid #FCD34D', borderRadius: 6,
                fontSize: '0.75rem', color: '#7C2D12', cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={flagAndImportAll}
                  onChange={(e) => setFlagAndImportAll(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <strong>Import the {analysis.skipped.length} skipped row{analysis.skipped.length === 1 ? '' : 's'} anyway and flag them for review.</strong>
                  {' '}A <code>Review</code> column will be added (if it doesn't exist) and populated with the reason on each flagged row. Existing rows that look like duplicates of an imported row also get a back-reference note so you can audit them on Opps. Clear the cell once you've checked it.
                </span>
              </label>
            )}

            {analysis && analysis.skipped.length > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem', gap: '0.5rem' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0f172a' }}>
                    Skipped rows — source line{analysis.skipped.length === 1 ? '' : 's'} {analysis.skipped.map(s => s.lineNo).join(', ')}
                  </div>
                  <button
                    type="button"
                    onClick={handleExportDuplicates}
                    title="Download an .xlsx of every skipped row with paste vs existing values"
                    style={{
                      padding: '0.3rem 0.7rem', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit',
                      background: '#fff', color: 'var(--color-accent)',
                      border: '1px solid var(--color-accent)', borderRadius: 6, cursor: 'pointer',
                    }}
                  >Export to Excel</button>
                </div>
                <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 6 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC' }}>
                        <th style={{ textAlign: 'left', padding: '0.3rem 0.55rem', width: 80 }}>Source line</th>
                        <th style={{ textAlign: 'left', padding: '0.3rem 0.55rem', width: 280 }}>Account (paste vs existing)</th>
                        <th style={{ textAlign: 'left', padding: '0.3rem 0.55rem' }}>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.skipped.map((s, i) => {
                        const rowBg = s.accountMismatch ? '#FEE2E2' : undefined;
                        const showAccountCell = s.pasteAccount != null || s.existingAccount != null;
                        return (
                          <tr key={i} style={{ background: rowBg }}>
                            <td style={{ padding: '0.25rem 0.55rem', borderBottom: '1px solid var(--color-border-light)', color: '#64748B' }}>{s.lineNo}</td>
                            <td style={{ padding: '0.25rem 0.55rem', borderBottom: '1px solid var(--color-border-light)', color: '#0f172a', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                              {showAccountCell ? (
                                <>
                                  <div><strong>Paste:</strong> {s.pasteAccount || <em style={{ color: '#94A3B8' }}>(blank)</em>}</div>
                                  <div><strong>Existing:</strong> {s.existingAccount || <em style={{ color: '#94A3B8' }}>(blank)</em>}</div>
                                </>
                              ) : <span style={{ color: '#94A3B8' }}>—</span>}
                            </td>
                            <td style={{ padding: '0.25rem 0.55rem', borderBottom: '1px solid var(--color-border-light)', color: '#0f172a', whiteSpace: 'normal', wordBreak: 'break-word' }}>{s.reason}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {analysis && analysis.additions.length > 0 && (
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.35rem' }}>Preview (first 5)</div>
                <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 6 }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: '0.7rem', width: '100%' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC' }}>
                        {targetOptions.filter(t => Object.values(mapping).includes(t)).map(t => (
                          <th key={t} style={{ textAlign: 'left', padding: '0.3rem 0.55rem', whiteSpace: 'nowrap', borderBottom: '1px solid var(--color-border-light)' }}>{t}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.additions.slice(0, 5).map((row, i) => (
                        <tr key={i}>
                          {targetOptions.filter(t => Object.values(mapping).includes(t)).map(t => (
                            <td key={t} style={{ padding: '0.25rem 0.55rem', borderBottom: '1px solid var(--color-border-light)', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(row[t] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            style={{
              padding: '0.4rem 0.85rem', fontSize: '0.8rem', fontFamily: 'inherit',
              background: '#fff', color: '#475569',
              border: '1px solid var(--color-border)', borderRadius: 6,
              cursor: importing ? 'not-allowed' : 'pointer',
            }}
          >Cancel</button>
          <button
            type="button"
            onClick={handleImport}
            disabled={importing || importableCount === 0}
            style={{
              padding: '0.4rem 0.95rem', fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
              background: 'var(--color-accent)', color: '#fff',
              border: '1px solid var(--color-accent)', borderRadius: 6,
              cursor: (importing || importableCount === 0) ? 'not-allowed' : 'pointer',
              opacity: (importing || importableCount === 0) ? 0.6 : 1,
            }}
          >{importing ? 'Importing…' : `Import ${importableCount} row${importableCount === 1 ? '' : 's'}`}</button>
        </div>
      </div>
    </div>
  );
}

// Modal opened on double-click of a Next Steps cell. Renders the
// per-step rows as a two-column table (Next Step / Waiting On) so the
// user can edit each entry in place. The notes are flattened back to a
// newline-joined string under 'Next Steps' (keeps search, sort, export,
// and the in-table cell render working), and the parallel waiting-on
// array is stored alongside under '_nextStepsWaiting'.
// Textarea that grows to fit its content so long Next Step notes
// aren't clipped to a single line. Resizes on every value change and
// once on mount so existing rows render at their full height the
// instant the popup opens.
function AutoGrowTextarea({ value, onChange, onBlur, placeholder, style }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      style={style}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      placeholder={placeholder}
      rows={2}
    />
  );
}

// The Next Step / Waiting On rows table shared by the standalone
// NextStepsEditor modal and the Follow Up status popup, so both edit
// Next Steps in the exact same format. Presentational only — the
// parent owns the `rows` state and the add / delete / commit handlers.
function NextStepsRowsEditor({ rows, onUpdateRow, onAddRow, onDeleteRow, onCommit, onQuickWaiting }) {
  const inputStyle = {
    width: '100%', padding: '0.4rem 0.5rem', border: '1px solid #CBD5E1',
    borderRadius: 4, fontSize: '0.85rem', fontFamily: 'inherit',
    lineHeight: 1.4, resize: 'vertical', minHeight: 56, background: '#fff',
    overflow: 'hidden',
  };
  return (
    <>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <thead>
          <tr style={{ background: '#F1F5F9', textAlign: 'left', color: '#475569' }}>
            <th style={{ padding: '0.4rem 0.5rem', fontWeight: 600, width: '55%', borderBottom: '1px solid #E2E8F0' }}>Note</th>
            <th style={{ padding: '0.4rem 0.5rem', fontWeight: 600, width: '40%', borderBottom: '1px solid #E2E8F0' }}>Waiting On</th>
            <th style={{ width: 32, borderBottom: '1px solid #E2E8F0' }} aria-label="" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} style={{ verticalAlign: 'top' }}>
              <td style={{ padding: '0.3rem 0.4rem 0.3rem 0', borderBottom: '1px solid #F1F5F9' }}>
                <AutoGrowTextarea
                  style={inputStyle}
                  value={row.note}
                  onChange={(e) => onUpdateRow(idx, 'note', e.target.value)}
                  onBlur={onCommit}
                  placeholder="What needs to happen?"
                />
              </td>
              <td style={{ padding: '0.3rem 0.4rem', borderBottom: '1px solid #F1F5F9' }}>
                <AutoGrowTextarea
                  style={inputStyle}
                  value={row.waitingOn}
                  onChange={(e) => onUpdateRow(idx, 'waitingOn', e.target.value)}
                  onBlur={onCommit}
                  placeholder="Who / what?"
                />
                <button
                  type="button"
                  onClick={() => (onQuickWaiting ? onQuickWaiting(idx, 'Me') : onUpdateRow(idx, 'waitingOn', 'Me'))}
                  title="We're waiting on me — set Waiting On to “Me”"
                  style={{
                    marginTop: 4, padding: '0.2rem 0.55rem', border: '1px solid #BFDBFE',
                    borderRadius: 4, background: '#EFF6FF', color: '#1E40AF',
                    fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >Me</button>
              </td>
              <td style={{ padding: '0.3rem 0 0.3rem 0.2rem', borderBottom: '1px solid #F1F5F9', textAlign: 'right' }}>
                <button
                  type="button"
                  onClick={() => onDeleteRow(idx)}
                  aria-label="Delete step"
                  title="Delete step"
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: '#94A3B8', fontSize: '1rem', padding: '0 4px', lineHeight: 1,
                  }}
                >×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: '0.6rem' }}>
        <button
          type="button"
          onClick={onAddRow}
          style={{
            padding: '0.35rem 0.7rem', border: '1px solid #BFDBFE', borderRadius: 4,
            background: '#EFF6FF', color: '#1E40AF', fontSize: '0.75rem', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >+ Add step</button>
      </div>
    </>
  );
}

function NextStepsEditor({ opp, onClose, updateOppField }) {
  const noteLines = useMemo(() => textToBulletItems(opp?.['Next Steps']), [opp]);
  const storedWaiting = Array.isArray(opp?._nextStepsWaiting) ? opp._nextStepsWaiting : [];
  const initialRows = useMemo(() => {
    const rows = noteLines.map((note, i) => ({ note, waitingOn: String(storedWaiting[i] || '') }));
    return rows.length > 0 ? rows : [{ note: '', waitingOn: '' }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opp]);
  const [rows, setRows] = useState(initialRows);

  function commit(nextRows) {
    const kept = nextRows.filter(r => (r.note || '').trim() || (r.waitingOn || '').trim());
    const notesText = kept.map(r => encodeNoteLine(r.note)).join('\n');
    const waiting = kept.map(r => (r.waitingOn || '').trim());
    updateOppField(opp._id, 'Next Steps', notesText);
    updateOppField(opp._id, '_nextStepsWaiting', waiting);
  }

  function updateRow(idx, key, value) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [key]: value } : r));
  }

  function addRow() {
    setRows(prev => {
      const next = [...prev, { note: '', waitingOn: '' }];
      commit(next);
      return next;
    });
  }

  function deleteRow(idx) {
    setRows(prev => {
      const next = prev.filter((_, i) => i !== idx);
      const safe = next.length > 0 ? next : [{ note: '', waitingOn: '' }];
      commit(safe);
      return safe;
    });
  }

  const account = String(opp?.['Account'] || '').trim() || '(no account)';

  // One-click activity marks. Stamps today's date on `_calledOn` /
  // `_metOn` (clicking again the same day clears it). The Agents page
  // reads these stamps so a marked call or meeting shows up in its
  // Activity table and the BFO Activity AI prompt without needing a
  // phone-touch phrase in the notes text.
  const markBtn = (field, icon, label) => {
    const today = todayISO();
    const stamped = toISODate(opp?.[field]);
    const isToday = stamped === today;
    return (
      <button
        type="button"
        onClick={() => updateOppField(opp._id, field, isToday ? '' : today)}
        title={isToday
          ? `Marked "${label}" today — click to unmark`
          : stamped
            ? `Last marked "${label}" on ${stamped} — click to mark again for today (shows on the Agents page's BFO Activity list)`
            : `Mark "${label}" today — shows on the Agents page's BFO Activity list`}
        style={{
          display: 'inline-block', padding: '3px 10px', borderRadius: 999,
          fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap',
          cursor: 'pointer', fontFamily: 'inherit',
          background: isToday ? '#DCFCE7' : '#fff',
          color: isToday ? '#166534' : '#64748B',
          border: isToday ? '1px solid #86EFAC' : '1px dashed #CBD5E1',
        }}
      >{icon} {label}{isToday ? ' ✓' : ''}</button>
    );
  };

  // Only treat a backdrop click as "close" when the press *started* on the
  // backdrop. Without this, drag-selecting text in a field and releasing the
  // mouse over the dimmed backdrop fires a click whose target is the overlay,
  // which would close the popup mid-selection.
  const backdropMouseDown = useRef(false);

  return (
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 8, padding: '1rem 1.25rem',
          width: 'min(1100px, 96vw)', maxHeight: '88vh', overflow: 'auto',
          boxShadow: '0 18px 50px rgba(15, 23, 42, 0.32)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem', gap: '1rem' }}>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Notes — {account}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: '0.72rem', color: '#64748B' }}>
              Sales Partner
              <input
                key={String(opp?.['Sales Partner'] ?? '')}
                type="text"
                defaultValue={String(opp?.['Sales Partner'] ?? '')}
                placeholder="—"
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim();
                  if (v !== String(opp?.['Sales Partner'] ?? '').trim()) updateOppField(opp._id, 'Sales Partner', v);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                  else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.value = String(opp?.['Sales Partner'] ?? ''); e.currentTarget.blur(); }
                }}
                style={{ padding: '2px 6px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.78rem', fontFamily: 'inherit', color: '#334155', minWidth: 170 }}
              />
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {markBtn('_calledOn', '📞', 'Called')}
            {markBtn('_metOn', '🤝', 'Meeting')}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: '1.1rem', color: '#64748B', padding: '0 4px', lineHeight: 1,
              }}
            >×</button>
          </div>
        </div>
        <NextStepsRowsEditor
          rows={rows}
          onUpdateRow={updateRow}
          onAddRow={addRow}
          onDeleteRow={deleteRow}
          onCommit={() => commit(rows)}
          onQuickWaiting={(idx, value) => setRows(prev => {
            const next = prev.map((r, i) => i === idx ? { ...r, waitingOn: value } : r);
            commit(next);
            return next;
          })}
        />
      </div>
    </div>
  );
}

// Modal for configuring the "No Further Action Today" clear schedules.
// Each mark type (✓ checks, ✗ X marks, any value) gets an independent
// schedule: an on/off toggle, the Eastern weekdays it runs on, and a
// time of day. Also offers a "Clear now" button per type. Times run in
// Eastern and only fire while the app is open in a browser (catching up
// on the next open if a scheduled time was missed).
function NfatScheduleModal({ schedules, onSave, onClearNow, onClose }) {
  const [draft, setDraft] = useState(() => {
    const def = defaultNfatSchedules();
    for (const t of NFAT_SCHEDULE_TYPES) {
      if (schedules?.[t]) def[t] = { ...def[t], ...schedules[t] };
    }
    return def;
  });
  const WEEKDAYS = [
    { v: 0, label: 'Sun' }, { v: 1, label: 'Mon' }, { v: 2, label: 'Tue' },
    { v: 3, label: 'Wed' }, { v: 4, label: 'Thu' }, { v: 5, label: 'Fri' },
    { v: 6, label: 'Sat' },
  ];
  const patch = (type, changes) =>
    setDraft(d => ({ ...d, [type]: { ...d[type], ...changes } }));
  const toggleDay = (type, v) =>
    setDraft(d => {
      const set = new Set(d[type].days || []);
      if (set.has(v)) set.delete(v); else set.add(v);
      return { ...d, [type]: { ...d[type], days: [...set].sort((a, b) => a - b) } };
    });
  const save = () => {
    // Re-baseline lastRunAt to now for every type so saving never
    // retro-fires a scheduled time that already passed earlier today —
    // only future occurrences trigger a clear.
    const now = Date.now();
    const next = {};
    for (const t of NFAT_SCHEDULE_TYPES) next[t] = { ...draft[t], lastRunAt: now };
    onSave(next);
    onClose();
  };
  const clearNow = (type) => {
    const n = onClearNow(type);
    window.alert(n > 0
      ? `Cleared ${NFAT_TYPE_LABELS[type]} from ${n} row${n === 1 ? '' : 's'}.`
      : `No matching "${NFAT_TYPE_LABELS[type]}" values to clear.`);
  };

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface, #fff)', color: 'var(--color-text)', borderRadius: 8, padding: '1.25rem', width: 'min(560px, 94vw)', maxHeight: '85vh', overflow: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Clear “No Further Action Today”</h3>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
        <p style={{ marginTop: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
          Set a schedule for each mark type, or clear it right now. Schedules run on the chosen days at the chosen time (US Eastern) and only fire while this app is open — a missed time catches up the next time you open it.
        </p>
        {NFAT_SCHEDULE_TYPES.map(type => {
          const s = draft[type];
          return (
            <div key={type} style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: '0.75rem', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!s.enabled}
                    onChange={e => patch(type, { enabled: e.target.checked })}
                  />
                  {NFAT_TYPE_LABELS[type]}
                </label>
                <button
                  type="button"
                  onClick={() => clearNow(type)}
                  style={{ padding: '0.3rem 0.6rem', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', color: 'inherit' }}
                  title={`Clear ${NFAT_TYPE_LABELS[type]} now`}
                >Clear now</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center', opacity: s.enabled ? 1 : 0.5 }}>
                {WEEKDAYS.map(d => {
                  const on = (s.days || []).includes(d.v);
                  return (
                    <button
                      key={d.v}
                      type="button"
                      disabled={!s.enabled}
                      onClick={() => toggleDay(type, d.v)}
                      style={{
                        padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-md)',
                        border: `1px solid ${on ? '#2563EB' : 'var(--color-border)'}`,
                        background: on ? '#2563EB' : 'transparent',
                        color: on ? '#fff' : 'inherit',
                        fontSize: '0.74rem', fontWeight: 600,
                        cursor: s.enabled ? 'pointer' : 'not-allowed',
                      }}
                    >{d.label}</button>
                  );
                })}
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                  at
                  <input
                    type="time"
                    value={s.time || '06:00'}
                    disabled={!s.enabled}
                    onChange={e => patch(type, { time: e.target.value })}
                    style={{ padding: '0.2rem 0.3rem', fontFamily: 'inherit', fontSize: '0.8rem' }}
                  />
                </span>
              </div>
            </div>
          );
        })}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button type="button" onClick={onClose} style={{ padding: '0.4rem 0.8rem', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', color: 'inherit' }}>Cancel</button>
          <button type="button" onClick={save} style={{ padding: '0.4rem 0.9rem', background: '#2563EB', border: '1px solid #2563EB', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', color: '#fff' }}>Save schedule</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function OppsView2({ settings, updateSettings, prospects = [], updateProspect, addProspect, onSelectProspect } = {}) {
  const { user, isAdmin } = useAuth();
  // Seeded with DEFAULT_HEADERS so the table renders columns immediately;
  // the hydration effect below replaces this with the user's saved
  // headers + records once Firestore / IndexedDB returns.
  const [data, setData] = useState({ headers: DEFAULT_HEADERS, records: [] });
  const [loading, setLoading] = useState(true);
  const [error] = useState(null);

  // One-time migration: the PE Owner column was added after this table
  // shipped, so existing users have a saved visible-columns set (local
  // and/or synced) that omits it — DataTable then keeps it hidden. Reveal
  // it once so it shows up on new and existing opps. Gated on
  // settings._lastWriteAt so we only act after synced settings have
  // actually loaded, and marked done in settings so it never re-fights a
  // user who later chooses to hide the column.
  useEffect(() => {
    if (!settings || !settings._lastWriteAt) return;
    if (settings.opps2PeOwnerRevealed) return;
    const updates = { opps2PeOwnerRevealed: true };
    const remote = settings?.tablePrefs?.opps2?.visible;
    if (Array.isArray(remote) && remote.length > 0 && !remote.includes('PE Owner')) {
      updates.tablePrefs = {
        ...(settings.tablePrefs || {}),
        opps2: { ...(settings.tablePrefs.opps2 || {}), visible: [...remote, 'PE Owner'] },
      };
    }
    try {
      const LS_KEY = 'prospect-col-visible-opps2';
      const saved = JSON.parse(localStorage.getItem(LS_KEY));
      if (Array.isArray(saved) && saved.length > 0 && !saved.includes('PE Owner')) {
        localStorage.setItem(LS_KEY, JSON.stringify([...saved, 'PE Owner']));
      }
    } catch { /* ignore */ }
    updateSettings?.(updates);
  }, [settings, updateSettings]);
  // Set when a Firestore cloud save fails so the failure is visible in
  // the UI instead of only the console. A silent failure here once let
  // edits live only in local IndexedDB while other devices kept showing
  // stale data; the banner makes that state impossible to miss.
  const [syncError, setSyncError] = useState(false);
  // The specific reason the last cloud write failed (permission denied,
  // quota exhausted, offline, …) so the banner can say *why*, not just
  // "it failed".
  const [syncErrorDetail, setSyncErrorDetail] = useState('');
  // Wall-clock of the last confirmed Firestore write this session, shown
  // in the banner so the user knows how long their edits have been
  // local-only.
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  // True while a manual "Retry now" is in flight, to disable the button
  // and avoid clearing the banner optimistically before the write acks.
  const [retryingSync, setRetryingSync] = useState(false);

  // HubSpot contacts cache feeds the Contact column's per-row picker.
  // Most contact rosters live here (not on the prospect record), so
  // pull from this cache and re-pull whenever the HubSpot view emits
  // a refresh event.
  const [hubspotContacts, setHubspotContacts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotContacts()
        .then(list => { if (!cancelled) setHubspotContacts(Array.isArray(list) ? list : []); })
        .catch(() => { if (!cancelled) setHubspotContacts([]); });
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('hubspot-cache-updated', refresh);
    };
  }, []);

  // Per-Pricing-Option services bundle, used by the Scope cell to
  // offer an "Add from Pricing Option" bulk-add. PricingView keeps a
  // pre-derived copy in IndexedDB, but we also fall back to deriving
  // from the raw cached workbook + Line Item → Services mapping —
  // otherwise the picker would be empty whenever the user lands on
  // Opps 2 without having opened the Pricing tab in this session.
  // Map of `oppId → Pricing Option name` owned by the Pricing tab.
  // We render the "Pricing Option" column from this map so the link
  // lives in one place — saving from Pricing or clearing from here
  // both go through `setOppOptionLink`.
  const [optionLinks, setOptionLinks] = useState({});
  useEffect(() => {
    let cancelled = false;
    loadOptionLinks().then(val => { if (!cancelled) setOptionLinks(val || {}); });
    const onChange = (e) => {
      const detail = e?.detail;
      if (detail && typeof detail === 'object') setOptionLinks(detail);
    };
    window.addEventListener(OPTION_LINKS_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(OPTION_LINKS_EVENT, onChange);
    };
  }, []);
  const [pricingOptionServicesCache, setPricingOptionServicesCache] = useState({});
  const [pricingWorkbook, setPricingWorkbook] = useState(null);
  const [lineItemServices, setLineItemServices] = useState({});
  useEffect(() => {
    let cancelled = false;
    const loadWorkbook = () => dbGet('pricing-cache', 'current')
      .then(val => { if (!cancelled && val && val.workbook) setPricingWorkbook(val.workbook); })
      .catch(() => {});
    const loadMapping = () => dbGet('pricing-cache', 'lineItemServices')
      .then(val => { if (!cancelled && val && typeof val === 'object') setLineItemServices(val); })
      .catch(() => {});
    const loadDerived = () => dbGet('pricing-cache', 'pricingOptionServices')
      .then(val => { if (!cancelled && val && typeof val === 'object') setPricingOptionServicesCache(val); })
      .catch(() => {});
    loadWorkbook();
    loadMapping();
    loadDerived();
    const onMapping = (e) => {
      const detail = e?.detail;
      if (detail && typeof detail === 'object') setLineItemServices(detail); else loadMapping();
    };
    const onDerived = (e) => {
      const detail = e?.detail;
      if (detail && typeof detail === 'object') setPricingOptionServicesCache(detail); else loadDerived();
      // Workbook changes ride along with derived-bundle changes — refresh.
      loadWorkbook();
    };
    window.addEventListener('pricing:lineItemServicesChanged', onMapping);
    window.addEventListener('pricing:optionServicesChanged', onDerived);
    return () => {
      cancelled = true;
      window.removeEventListener('pricing:lineItemServicesChanged', onMapping);
      window.removeEventListener('pricing:optionServicesChanged', onDerived);
    };
  }, []);

  const pricingOptionServices = useMemo(() => {
    // Local derivation always wins when a workbook is in the cache —
    // it can't be stale relative to the inputs in this tab. The
    // pre-derived copy is only used when the workbook is missing
    // (e.g. PricingView populated it but the cache has since been
    // partially cleared, or a cross-tab edit beat us to it).
    if (pricingWorkbook && Array.isArray(pricingWorkbook.options) && pricingWorkbook.options.length > 0) {
      const out = {};
      for (const o of pricingWorkbook.options) {
        const seen = new Set();
        const services = [];
        for (const sec of (o.sections || [])) {
          for (const item of (sec.items || [])) {
            const key = String(item.description || '').trim().toLowerCase();
            const mapped = key ? lineItemServices?.[key] : null;
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
    }
    return pricingOptionServicesCache;
  }, [pricingWorkbook, lineItemServices, pricingOptionServicesCache]);
  // Persisting only kicks in after the initial hydration finishes —
  // otherwise the seed value would be written back, wiping the saved
  // state for any user who happens to refresh before the load
  // resolves.
  const hydratedRef = useRef(false);
  // State mirror of hydratedRef so effects can re-run *after* the initial
  // load + reconcile settles. A ref alone doesn't trigger a re-render, so
  // the once-per-day NFAT clear needs this to fire against the final
  // reconciled data instead of the intermediate IndexedDB cache paint.
  const [hydrated, setHydrated] = useState(false);
  const firestoreSaveTimerRef = useRef(null);
  // _updatedAt timestamp of the most recent blob we wrote to Firestore.
  // The onSnapshot listener compares against this to skip our own echoes.
  const lastFsSavedAtRef = useRef(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('opps');
  // New Opps subtab: controls the recurring-email schedule manager modal.
  const [newOppsScheduleOpen, setNewOppsScheduleOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Dedicated Start Date range for the "By Source" tab. Kept separate
  // from the (hidden) global dateFrom/dateTo so the source summary can
  // be scoped to a time window without touching the other tabs.
  const [sourceFrom, setSourceFrom] = useState('');
  const [sourceTo, setSourceTo] = useState('');
  // "By Source" tab activity filter: 'active' (open stages, the default
  // for this tab), 'closed' (Sold / Not Sold), or 'all'. Mirrors the
  // main tab's Show control.
  const [sourceActivityFilter, setSourceActivityFilter] = useState('active');
  // "By Source" drilldown: the Source whose opps the user clicked through
  // to. null when the list modal is closed.
  const [sourceDrillDown, setSourceDrillDown] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [activityFilter, setActivityFilter] = useState('all');
  const [showHiddenByFilter, setShowHiddenByFilter] = useState(false);
  // Rows that don't have an active Call In number (no Follow Up date,
  // or the value was manually cleared) are treated as "history" — they
  // aren't on a callback schedule and don't need to render alongside
  // active opps. Hidden by default so the page loads fewer rows;
  // surfaced on demand via the "Show history" button.
  const [hideHistory, setHideHistory] = useState(true);
  // Days-in-Stage kanban — Not Started rows are often noise (intake
  // backlog), so we let the user hide that column without losing the
  // data. Defaulted to visible so the column is discoverable.
  const [hideNotStarted, setHideNotStarted] = useState(false);
  const servicesDefaultAppliedRef = useRef(false);
  useEffect(() => {
    if (activeTab === 'services' && !servicesDefaultAppliedRef.current) {
      servicesDefaultAppliedRef.current = true;
      setActivityFilter(prev => (prev === 'all' ? 'active' : prev));
    }
  }, [activeTab]);
  const [hiddenServices, setHiddenServices] = useState(() => new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  // null when idle; { account } when the user clicked + New Opp (or
  // committed the Add Company combobox) and the Source-picker modal
  // is open. Account flows through so the modal can show "Adding
  // <company>" when the company is already known.
  const [pendingNewOpp, setPendingNewOpp] = useState(null);
  // _id of the opp that just had its Stage flipped to "Not Sold". When
  // set, the NotSoldFollowUpModal asks the user to fill in Close Date
  // (auto-stamped to the status-change date in updateOppField, shown
  // pre-filled for adjustment), Reason Not Sold, and Final Margin so
  // the close-out reporting views have what they need. Cleared on Save
  // or Skip.
  const [notSoldPromptId, setNotSoldPromptId] = useState(null);
  // _id of the opp that just moved into the "Quoted" stage. When set,
  // the QuotedFollowUpModal asks the user to enter / review Quoted On,
  // Chance?, and Margin Email Date - Sales Leader Review Date. Cleared on
  // Save or Skip.
  const [quotedPromptId, setQuotedPromptId] = useState(null);
  // _id of the opp that just had its Stage flipped to "Sold". When set,
  // the SoldFollowUpModal asks the user to fill in Reason Not Sold,
  // Final Margin, and Competition. The Close Date is auto-stamped to the
  // status-change date in updateOppField. Cleared on Save or Skip.
  const [soldPromptId, setSoldPromptId] = useState(null);
  // _id of the opp that just moved from "Not Started" to "Lead". When
  // set, the LeadQuotedAmountModal prompts the user to enter the Quoted
  // Amount so a newly-activated opp carries a dollar figure. Cleared on
  // Save or Skip.
  const [leadQuotedPromptId, setLeadQuotedPromptId] = useState(null);
  // _id of the opp that just had its Follow Up date changed. When set,
  // the FollowUpStatusModal asks the user to pick the new Status
  // (Who is waiting) for that opp. Cleared on Save or Skip.
  const [followUpStatusPromptId, setFollowUpStatusPromptId] = useState(null);
  // Snapshot of the Follow Up (and its sibling Call In) value from before
  // the edit that opened the FollowUpStatusModal. Lets the modal's Cancel
  // button put the Follow Up date back to what it was originally.
  const [followUpStatusPrev, setFollowUpStatusPrev] = useState(null);
  // Imperative sort trigger handed to the DataTable. Bumping it re-ranks
  // the table by Call In ascending — fired once the Follow Up status
  // popup is dismissed so the re-scheduled opp lands in its new
  // soonest-first position.
  const [callInSortSignal, setCallInSortSignal] = useState(null);
  const requestCallInSort = useCallback(() => {
    setCallInSortSignal({ key: 'Call In', direction: 'asc', nonce: Date.now() });
  }, []);
  // _id of the opp whose info popup is open, or null when no popup
  // is showing. Resolved against the live records list on render so
  // the popup always reflects the latest cell edits.
  const [infoOppId, setInfoOppId] = useState(null);
  // Double-clicking the Next Steps cell opens a read-only popup showing
  // the full value (useful when the column is narrow and the entry
  // spans multiple Alt+Enter lines). Closing is via the modal's own
  // Close / × buttons — Esc is intentionally not wired so accidental
  // presses don't blow away an in-flight edit.
  const [nextStepsPopupId, setNextStepsPopupId] = useState(null);
  // Mass-edit selection — set of row _id's the user has checked. The
  // mass-edit toolbar shows whenever this is non-empty.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // Mass-edit mode. The checkbox column is only rendered (and the
  // bulk toolbar is only available) while this is on, so the default
  // view is uncluttered.
  const [massEditOn, setMassEditOn] = useState(false);
  // _ids of rows that DataTable is currently showing (after column
  // filters / search). Lets the select-column header offer a
  // "select all rows in the current filter" checkbox so the user
  // can mass-edit a filtered subset without per-row clicking.
  const [filteredRowIds, setFilteredRowIds] = useState(() => new Set());
  // When on, the table view is narrowed to just the rows the user has
  // ticked. The button only renders when there's at least one
  // selection, and we auto-flip back off as soon as the selection is
  // cleared (so the table doesn't go empty under the user).
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const handleFilteredRowsChange = useCallback((rows) => {
    setFilteredRowIds(prev => {
      const next = new Set();
      for (const r of (rows || [])) if (r?._id != null) next.add(r._id);
      if (prev.size === next.size) {
        let same = true;
        for (const id of prev) if (!next.has(id)) { same = false; break; }
        if (same) return prev;
      }
      return next;
    });
  }, []);
  // The HubSpot contact currently open in the rich ContactEditModal,
  // launched when the user clicks a tagged-contact name on the
  // Contact cell's popover. Null when no modal is open.
  const [editingContact, setEditingContact] = useState(null);
  useEffect(() => {
    if (showOnlySelected && selectedIds.size === 0) setShowOnlySelected(false);
  }, [showOnlySelected, selectedIds]);
  // Set while the "Import from Opps tab" one-time copy is running so
  // the button locks out double-clicks and shows a "Importing…"
  // label.
  const [importingFromOpps, setImportingFromOpps] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  // Dedup key for the Opps → Opps 2 one-time import. BFO Link is the
  // natural unique id; for rows that lack one we fall back to a
  // composite of Account + Open Year + Scope + Start Date so a
  // legacy hand-typed Opps 2 entry doesn't get blocked by a fuzzy
  // match against a Google-Sheets row with the same Account in a
  // different year.
  const oppDedupKeyForImport = useCallback((r) => {
    if (!r) return '';
    const bfo = String(r['BFO Link'] || '').trim().toLowerCase();
    if (bfo && bfo !== '-' && bfo !== '#n/a') return `bfo:${bfo}`;
    const acct = String(r['Account'] || '').trim().toLowerCase();
    const year = String(r['Open Year'] || '').trim();
    const scope = String(r['Scope'] || '').trim().toLowerCase();
    const start = String(r['Start Date'] || '').trim();
    if (!acct && !year && !scope && !start) return '';
    return `acct:${acct}|${year}|${scope}|${start}`;
  }, []);

  // One-time copy from the Opps tab's IndexedDB cache into Opps 2.
  // Adds only — every existing Opps 2 record is left exactly as-is.
  // Dedup is by BFO Link (with the composite fallback above), so a
  // re-run only adds rows that are new since the last import. The
  // user is free to re-click this any time they refresh the Opps tab
  // and want the new rows mirrored over.
  const importFromOppsTab = useCallback(async () => {
    if (importingFromOpps) return;
    setImportingFromOpps(true);
    try {
      let opps = null;
      try { opps = await dbGet('opps-cache', 'data'); } catch { /* ignore */ }
      const incoming = Array.isArray(opps?.records) ? opps.records : [];
      if (!incoming.length) {
        window.alert(
          'No Opps - Old tab data found in this browser. Open the Opps - Old tab once so it ' +
          'fetches the Google Sheet, then come back and click Import again.'
        );
        return;
      }
      const baseHeaders = data?.headers?.length ? data.headers : DEFAULT_HEADERS;
      const baseRecords = data?.records || [];
      const existingKeys = new Set();
      for (const r of baseRecords) {
        const k = oppDedupKeyForImport(r);
        if (k) existingKeys.add(k);
      }
      let nextId = baseRecords.reduce((m, r) => Math.max(m, Number(r?._id) || 0), 0);
      const additions = [];
      let skippedDuplicate = 0;
      // Bring everything across — every row the Opps tab cached is fair
      // game. The Opps cache parser already drops rows with no Account
      // and no other data, so we don't need a second guard here. Older
      // versions of this import filtered on Open Year and on having
      // Account-or-BFO Link, which silently dropped legitimate rows
      // (e.g. opps still missing an Open Year value) and produced a
      // smaller Opps 2 dataset than the source Opps tab.
      for (const r of incoming) {
        const key = oppDedupKeyForImport(r);
        if (!key || existingKeys.has(key)) { skippedDuplicate += 1; continue; }
        existingKeys.add(key);
        nextId += 1;
        // Stamp the row so per-row merge has a real signal — without it
        // an imported row counts as ts 0 (oldest) and could be dropped.
        additions.push({ ...r, _id: nextId, id: nextId, _source: 'opps-import', _rowUpdatedAt: Date.now() });
      }
      if (!additions.length) {
        window.alert(
          `Nothing new to import — every Opps - Old tab row (${incoming.length}) is ` +
          `already on Opps (duplicates skipped: ${skippedDuplicate}).`
        );
        return;
      }
      // Union headers so any columns the Opps tab tracks but Opps 2's
      // saved layout doesn't yet know about become selectable from the
      // Columns toggle. Preserve Opps 2's column order.
      const headerSet = new Set(baseHeaders);
      const mergedHeaders = [...baseHeaders];
      for (const h of (opps?.headers || [])) {
        if (h && !headerSet.has(h)) { headerSet.add(h); mergedHeaders.push(h); }
      }
      // Build the next state explicitly so we can persist it
      // synchronously below — relying solely on the debounced
      // save-effect lets a quick refresh / tab switch lose the import
      // (component unmount cancels the pending Firestore write, and on
      // the next load the stale Firestore copy wins over IndexedDB).
      const nextRecords = [...additions, ...(data?.records || [])];
      const nextState = { ...(data || {}), headers: mergedHeaders, records: nextRecords };
      // Snapshot the pre-import dataset (forced) so a bad import is one
      // click to undo from the Backups dropdown.
      await pushOpps2Backup(data, 'pre-import (Opps - Old tab)', { force: true });
      setData(nextState);
      // Cancel any in-flight debounced Firestore save so the explicit
      // write below isn't immediately followed by a stale debounced one.
      if (firestoreSaveTimerRef.current) {
        clearTimeout(firestoreSaveTimerRef.current);
        firestoreSaveTimerRef.current = null;
      }
      await saveOpps2Cache(nextState);
      let firestoreWarning = '';
      if (user?.uid) {
        try {
          const ts = await saveOpps2ToFirestore(user.uid, nextState);
          if (ts != null) lastFsSavedAtRef.current = ts;
        } catch (err) {
          console.error('Import from Opps tab: Firestore save failed:', err);
          firestoreWarning = `\n\nWarning: cross-device sync failed (${err?.message || err}). Rows are safe on this device — hydration now picks the newer of IndexedDB vs Firestore, so a refresh here will keep them.`;
        }
      }
      window.alert(
        `Imported ${additions.length} row${additions.length === 1 ? '' : 's'} ` +
        `from the Opps - Old tab. Skipped ${skippedDuplicate} already on Opps.${firestoreWarning}`
      );
    } catch (err) {
      console.error('Import from Opps tab failed:', err);
      window.alert(`Import failed: ${err?.message || err}`);
    } finally {
      setImportingFromOpps(false);
    }
  }, [importingFromOpps, data, oppDedupKeyForImport, user?.uid]);

  // Commit a batch of rows produced by the Bulk Import modal. The
  // modal has already done dedup + column mapping; we just splice the
  // additions into state and persist synchronously (same shape as the
  // Import-from-Opps path so refresh / tab-switch can't drop the
  // writes). New columns from the source paste merge into the Opps 2
  // header set so they're selectable from the Columns toggle.
  const commitBulkImport = useCallback(async (additions, sourceHeaders, mapping) => {
    if (!Array.isArray(additions) || additions.length === 0) return;
    const baseHeaders = data?.headers?.length ? data.headers : DEFAULT_HEADERS;
    const baseRecords = data?.records || [];
    const headerSet = new Set(baseHeaders);
    const mergedHeaders = [...baseHeaders];
    // The mapping values are the target Opps 2 columns; any new ones
    // (e.g. a sheet column the user mapped to a custom Opps 2 column)
    // get appended so they show up in the column toggle.
    for (const target of Object.values(mapping || {})) {
      if (target && !headerSet.has(target)) { headerSet.add(target); mergedHeaders.push(target); }
    }
    // Flag-and-import mode: rows arrive carrying `_reviewReason` (and,
    // for duplicate-of-existing rows, `_existingMatchId`). Stamp the
    // Review column on the new rows and post a back-reference Review
    // note on the existing rows so the user can audit collisions
    // in-place.
    const anyFlagged = additions.some(r => r?._reviewReason);
    if (anyFlagged && !headerSet.has('Review')) {
      headerSet.add('Review');
      mergedHeaders.push('Review');
    }
    let nextId = baseRecords.reduce((m, r) => Math.max(m, Number(r?._id) || 0), 0);
    // Map of existing _id → list of new opp ranks that point at it,
    // so a single existing row that collides with multiple imported
    // rows lists every match instead of overwriting.
    const existingFlagsByMatchId = new Map();
    // Display rank = position in the ascending sort of all _ids
    // (matches the Opp # column). After import: existing ranks stay
    // the same; new ones get baseRecords.length + 1 onward (since
    // they have the highest _ids).
    const baseExistingCount = baseRecords.filter(r => r?._id != null).length;
    const stamped = additions.map((r, idx) => {
      const id = ++nextId;
      const newRank = baseExistingCount + idx + 1;
      const { _reviewReason, _existingMatchId, ...rest } = r;
      const out = { ...rest, _id: id, id, _source: 'bulk-import', _rowUpdatedAt: Date.now() };
      if (_reviewReason) out['Review'] = _reviewReason;
      if (_existingMatchId != null) {
        const list = existingFlagsByMatchId.get(_existingMatchId) || [];
        list.push(newRank);
        existingFlagsByMatchId.set(_existingMatchId, list);
      }
      return out;
    });
    const flaggedExistingRecords = existingFlagsByMatchId.size > 0
      ? baseRecords.map(r => {
          const matches = existingFlagsByMatchId.get(r?._id);
          if (!matches?.length) return r;
          const label = matches.length === 1
            ? `Possible duplicate of imported opp# ${matches[0]}`
            : `Possible duplicate of imported opps# ${matches.join(', ')}`;
          const existing = String(r['Review'] || '').trim();
          const next = existing ? `${existing} · ${label}` : label;
          // This is a modification of an existing row — stamp it so the
          // Review note wins a merge against another device's copy.
          return { ...r, Review: next, _rowUpdatedAt: Date.now() };
        })
      : baseRecords;
    const nextRecords = [...stamped, ...flaggedExistingRecords];
    const nextState = { ...(data || {}), headers: mergedHeaders, records: nextRecords };
    // Snapshot the pre-import dataset (forced) so a bad bulk import is
    // one click to undo from the Backups dropdown.
    await pushOpps2Backup(data, 'pre-import (bulk paste)', { force: true });
    setData(nextState);
    if (firestoreSaveTimerRef.current) {
      clearTimeout(firestoreSaveTimerRef.current);
      firestoreSaveTimerRef.current = null;
    }
    await saveOpps2Cache(nextState);
    let firestoreWarning = '';
    if (user?.uid) {
      try {
        const ts = await saveOpps2ToFirestore(user.uid, nextState);
        if (ts != null) lastFsSavedAtRef.current = ts;
      } catch (err) {
        console.error('Bulk import: Firestore save failed:', err);
        firestoreWarning = `\n\nWarning: cross-device sync failed (${err?.message || err}). Rows are safe on this device.`;
      }
    }
    setBulkImportOpen(false);
    // Suppress unused-arg lint — sourceHeaders is informational only.
    void sourceHeaders;
    const flaggedNewCount = additions.filter(r => r?._reviewReason).length;
    const flaggedExistingCount = existingFlagsByMatchId.size;
    const flagSuffix = flaggedNewCount > 0
      ? `\n\nFlagged for review: ${flaggedNewCount} imported row${flaggedNewCount === 1 ? '' : 's'}${flaggedExistingCount > 0 ? ` + ${flaggedExistingCount} existing row${flaggedExistingCount === 1 ? '' : 's'}` : ''}. Look in the Review column.`
      : '';
    window.alert(`Imported ${additions.length} row${additions.length === 1 ? '' : 's'} from the pasted sheet.${flagSuffix}${firestoreWarning}`);
  }, [data, user?.uid]);

  // Look the tagged contact's full HubSpot record up by email (most
  // reliable) and fall back to a case-insensitive name match. When
  // nothing matches, fabricate a minimal record so ContactEditModal
  // can still display the name + email the user already had visible.
  const openContactDetails = useCallback((name, email) => {
    const normEmail = String(email || '').trim().toLowerCase();
    const normName = String(name || '').trim().toLowerCase();
    let found = null;
    if (normEmail) {
      found = (hubspotContacts || []).find(c => String(c?.email || '').trim().toLowerCase() === normEmail);
    }
    if (!found && normName) {
      found = (hubspotContacts || []).find(c => {
        const cName = [c?.firstname, c?.lastname].filter(Boolean).join(' ').trim().toLowerCase();
        return cName === normName;
      });
    }
    if (!found) {
      const parts = String(name || '').trim().split(/\s+/);
      found = {
        firstname: parts[0] || '',
        lastname: parts.slice(1).join(' ') || '',
        email: email || '',
      };
    }
    setEditingContact(found);
  }, [hubspotContacts]);

  // Open the prospect record for a tagged contact's company. Caller
  // hands us the already-resolved prospect (ContactCell has it via
  // the same companyMatchKeys lookup that drives the contact roster),
  // so we just hand it to the App-level handler that owns the modal.
  const openCompanyDetails = useCallback((prospect) => {
    if (!prospect || !onSelectProspect) return;
    onSelectProspect(prospect);
  }, [onSelectProspect]);

  // ContactEditModal saves through these handlers so per-contact
  // notes / nicknames / etc. land in the same Firestore settings
  // maps every other view writes to (Key Contacts uses the same
  // set). `silent` saves come from the modal's tag-autosave path —
  // don't close the modal in that case.
  const closeContactModal = useCallback((updated, opts) => {
    if (!opts?.silent) setEditingContact(null);
    void updated;
  }, []);
  const saveContactNote = useCallback((cid, note) => {
    const cur = settings?.contactNotes || {};
    const next = { ...cur };
    if (note && note.trim()) next[cid] = note; else delete next[cid];
    updateSettings({ contactNotes: next });
  }, [settings?.contactNotes, updateSettings]);
  const saveContactOldEmails = useCallback((cid, val) => {
    const cur = settings?.contactOldEmails || {};
    const next = { ...cur };
    if (val && val.trim()) next[cid] = val; else delete next[cid];
    updateSettings({ contactOldEmails: next });
  }, [settings?.contactOldEmails, updateSettings]);
  const saveContactNickname = useCallback((cid, val) => {
    const cur = settings?.contactNicknames || {};
    const next = { ...cur };
    if (val && val.trim()) next[cid] = val; else delete next[cid];
    updateSettings({ contactNicknames: next });
  }, [settings?.contactNicknames, updateSettings]);
  const saveContactTeamName = useCallback((cid, val) => {
    const cur = settings?.contactTeamNames || {};
    const next = { ...cur };
    if (val && val.trim()) next[cid] = val.trim(); else delete next[cid];
    updateSettings({ contactTeamNames: next });
  }, [settings?.contactTeamNames, updateSettings]);
  const saveContactReportsTo = useCallback((cid, managerIds) => {
    const cur = settings?.contactReportsTo || {};
    const next = { ...cur };
    const arr = Array.isArray(managerIds)
      ? managerIds.filter(Boolean).map(String)
      : (managerIds ? [String(managerIds)] : []);
    if (arr.length > 0) next[cid] = arr; else delete next[cid];
    updateSettings({ contactReportsTo: next });
  }, [settings?.contactReportsTo, updateSettings]);
  const saveContactFamily = useCallback((cid, info) => {
    const cur = settings?.contactFamilies || {};
    const next = { ...cur };
    const partner = String(info?.partner || '').trim();
    const kids = String(info?.kids || '').trim();
    if (!partner && !kids) delete next[cid];
    else next[cid] = { partner, kids };
    updateSettings({ contactFamilies: next });
  }, [settings?.contactFamilies, updateSettings]);
  const saveContactMetInPerson = useCallback((cid, met) => {
    const cur = settings?.contactMetInPerson || {};
    updateSettings({ contactMetInPerson: { ...cur, [cid]: !!met } });
  }, [settings?.contactMetInPerson, updateSettings]);
  const saveContactInvitedToLouisville = useCallback((cid, invited) => {
    const cur = settings?.contactInvitedToLouisville || {};
    updateSettings({ contactInvitedToLouisville: { ...cur, [cid]: !!invited } });
  }, [settings?.contactInvitedToLouisville, updateSettings]);

  // Hydration — load the user's saved opps. Both stores are kicked off
  // in parallel, but we paint whichever resolves first (IndexedDB
  // almost always wins) so the table is visible before the Firestore
  // round-trip lands. Once both are in we reconcile by `_updatedAt` and
  // merge any IDB-only Pricing-Option snapshots, same as before.
  useEffect(() => {
    if (!user?.uid) {
      // Logged-out / pre-auth: keep the seed but don't enable saves
      // (we'd hit the dbPut scoping guard).
      setLoading(false);
      return;
    }
    let cancelled = false;
    let painted = false;
    hydratedRef.current = false;
    setHydrated(false);
    setLoading(true);

    function applyResult(next) {
      const headerSet = new Set((next.headers || []).map(h => String(h || '').trim()).filter(Boolean));
      const extra = ENSURED_COLUMNS.filter(c => !headerSet.has(c));
      let withCols = extra.length ? { ...next, headers: [...(next.headers || []), ...extra] } : next;
      // Mirror `id` ← `_id` on every loaded record. New / imported rows
      // already carry this (see makeBlankOpp), but legacy and sheet-synced
      // rows can arrive with only `_id`. DataTable keys its row identity —
      // including the Call In freeze-sort snapshot — on `id`, so a missing
      // `id` would drop the row from that snapshot and the Call In header
      // click would appear to do nothing.
      {
        const recs = withCols.records || [];
        if (recs.some(r => r && r.id == null && r._id != null)) {
          withCols = {
            ...withCols,
            records: recs.map(r => (r && r.id == null && r._id != null ? { ...r, id: r._id } : r)),
          };
        }
      }
      // Initial-load only: order rows by Call In ascending so the most
      // urgent rows land at the top. Once hydratedRef flips true (after
      // reconcile finishes), every later setData skips this branch so
      // edits don't reorder rows mid-keystroke.
      if (!hydratedRef.current) {
        withCols = { ...withCols, records: sortRecordsByCallInAsc(withCols.records || []) };
      }
      setData(withCols);
      painted = true;
    }

    const fsPromise = loadOpps2FromFirestore(user.uid);
    const idbPromise = loadOpps2Cache();

    let fromFs = null;
    let fromIdb = null;
    let fsDone = false;
    let idbDone = false;

    function reconcile() {
      if (cancelled || !fsDone || !idbDone) return;
      // Read both stores so we can carry over Pricing-Option snapshots
      // written by the Pricing tab into IDB but not yet replicated to
      // Firestore. Without this safety net, a stale Firestore copy
      // would clobber the snapshot on `saveOpps2Cache`.
      const fsHas = fromFs && (Array.isArray(fromFs.records) || Array.isArray(fromFs.headers));
      const idbHas = fromIdb && (Array.isArray(fromIdb.records) || Array.isArray(fromIdb.headers));
      let next = null;
      if (fsHas && idbHas) {
        // PER-ROW reconcile (not whole-document last-write-wins). The
        // newest `_rowUpdatedAt` wins for each opp, so a stale full copy
        // on either side — e.g. a background tab that flushed later, or a
        // manual blob restore — can no longer revert rows edited more
        // recently on another device. IDB is the merge base so any
        // IDB-only Pricing-Option snapshot survives the union.
        next = mergeOpps2Datasets(fromIdb, fromFs);
        // Pricing-Option carve-out: a row the Pricing tab wrote into IDB
        // seconds ago may carry a `_pricingOption` that the merged
        // (possibly remote-won) row lacks. Re-apply those from IDB.
        const idbById = new Map();
        for (const r of (fromIdb?.records || [])) {
          if (r?._id != null) idbById.set(String(r._id), r);
        }
        let touched = false;
        const reconciled = (next.records || []).map(r => {
          const idbRow = idbById.get(String(r?._id));
          if (idbRow?._pricingOption && !r?._pricingOption) {
            touched = true;
            return {
              ...r,
              _pricingOption: idbRow._pricingOption,
              'Quoted Amount': idbRow['Quoted Amount'] ?? r['Quoted Amount'],
            };
          }
          return r;
        });
        if (touched) next = { ...next, records: reconciled };
        // Persist the merged union to BOTH stores so they converge and
        // the cloud reflects every device's latest rows. Replaces the old
        // "push only when IDB looked newer" path, which let a whole-doc
        // timestamp decide and so dropped rows that lived only in the
        // copy that happened to look older.
        saveOpps2Cache(next);
        trySaveOpps2ToFirestore(user.uid, next)
          .then(ts => { if (ts != null) lastFsSavedAtRef.current = ts; });
      } else if (idbHas) {
        // Cloud empty / unreadable — local cache is all we have; push it
        // up so the cloud catches up to whatever never made the round trip.
        next = fromIdb;
        trySaveOpps2ToFirestore(user.uid, next)
          .then(ts => { if (ts != null) lastFsSavedAtRef.current = ts; });
      } else if (fsHas) {
        // Cold local cache — seed it from the cloud.
        next = fromFs;
        saveOpps2Cache(next);
      }
      if (next) {
        applyResult(next);
        // Snapshot the dataset we loaded this session into the rolling
        // backup ring (forced, bypassing the throttle) so there's always
        // a known-good restore point captured before any local edits.
        pushOpps2Backup(next, 'session-load', { force: true });
      }
      setLoading(false);
      hydratedRef.current = true;
      setHydrated(true);
    }

    idbPromise.then(res => {
      if (cancelled) return;
      fromIdb = res;
      idbDone = true;
      // Render-while-fetching: paint the local cache the moment it
      // lands so the user sees the table before Firestore resolves.
      const idbHas = res && (Array.isArray(res.records) || Array.isArray(res.headers));
      if (!painted && idbHas) {
        applyResult(res);
        setLoading(false);
      }
      reconcile();
    }).catch(() => { idbDone = true; reconcile(); });

    fsPromise.then(res => {
      if (cancelled) return;
      fromFs = res;
      fsDone = true;
      // Cold-cache case: IDB had nothing, FS arrived first. Paint it
      // before the IDB read returns so we're not waiting on either.
      const fsHas = res && (Array.isArray(res.records) || Array.isArray(res.headers));
      if (!painted && fsHas) {
        applyResult(res);
        setLoading(false);
      }
      reconcile();
    }).catch(() => { fsDone = true; reconcile(); });

    return () => { cancelled = true; };
  }, [user?.uid]);

  // The Pricing → Options tab writes the snapshot directly into our
  // IndexedDB cache (so it survives a Pricing tab Clear) — when that
  // happens, patch the affected row in place. Reading the whole cache
  // back here would risk clobbering an in-flight cell edit that's only
  // in component state but not yet flushed to IDB.
  useEffect(() => {
    if (!user?.uid) return;
    function onSnapshotChanged(e) {
      if (!hydratedRef.current) return;
      const detail = e?.detail;
      if (!detail || detail.oppId == null) return;
      setData(prev => {
        const records = prev?.records || [];
        const idx = records.findIndex(r => String(r._id) === String(detail.oppId));
        if (idx === -1) return prev;
        const updates = detail.record || {};
        const merged = { ...records[idx] };
        if ('_pricingOption' in updates) merged._pricingOption = updates._pricingOption || null;
        if ('Quoted Amount' in updates) merged['Quoted Amount'] = updates['Quoted Amount'];
        const next = records.slice();
        next[idx] = merged;
        return { ...prev, records: next };
      });
    }
    window.addEventListener(OPPS_PRICING_SNAPSHOT_EVENT, onSnapshotChanged);
    return () => window.removeEventListener(OPPS_PRICING_SNAPSHOT_EVENT, onSnapshotChanged);
  }, [user?.uid]);

  // Real-time sync — subscribe to Firestore changes on the opps2 document
  // so edits from another browser (or device) arrive within ~500ms without
  // a page reload. The listener skips our own saves (identified by
  // lastFsSavedAtRef) and the initial snapshot that fires before hydration
  // completes. Incoming data is merged at the record level via
  // mergeOpps2Datasets so in-flight local edits are never overwritten by a
  // stale remote value for the same row.
  useEffect(() => {
    if (!user?.uid) return;
    const parentRef = doc(db, OPPS2_FIRESTORE_COLLECTION, user.uid);
    const unsub = onSnapshot(parentRef, async (snap) => {
      // Skip until our own initial load (getDoc + reconcile) is done.
      if (!hydratedRef.current) return;
      // Skip snapshots that only reflect our OWN un-acknowledged local
      // writes. Firestore's latency compensation fires the listener with
      // the locally-buffered value (metadata.hasPendingWrites === true)
      // before the server acks. Acting on those echoes merges them back
      // into state, which triggers another debounced save, which fires
      // the listener again — an infinite loop that enqueues a fresh
      // multi-megabyte chunked write each pass until the SDK throws
      // "resource-exhausted: Write stream exhausted maximum allowed
      // queued writes". We only care about server-confirmed updates here
      // (genuine edits from another device), which always arrive with
      // hasPendingWrites === false.
      if (snap.metadata?.hasPendingWrites) return;
      if (!snap.exists()) return;
      const raw = snap.data() || {};
      // Convert the ISO updatedAt field on the Firestore doc to ms so we
      // can compare it against lastFsSavedAtRef (also in ms).
      const remoteTs = raw.updatedAt ? Date.parse(raw.updatedAt) : 0;
      // Skip echoes of our own writes.
      if (remoteTs > 0 && remoteTs === lastFsSavedAtRef.current) return;
      // Reassemble the chunked JSON.
      try {
        let json = null;
        if (Number.isFinite(raw.chunkCount) && raw.chunkCount > 0) {
          const parts = new Array(raw.chunkCount).fill('');
          const chunksSnap = await getDocs(collection(parentRef, 'chunks'));
          chunksSnap.forEach((d) => {
            const idx = Number(d.id);
            if (Number.isFinite(idx) && idx >= 0 && idx < parts.length) {
              parts[idx] = String(d.data()?.json || '');
            }
          });
          json = parts.join('');
        } else if (raw.json) {
          json = raw.json;
        }
        if (!json) return;
        const remote = JSON.parse(json);
        setData(local => mergeOpps2Datasets(local, remote));
      } catch (err) {
        console.error('opps2: real-time sync failed to apply remote update', err);
      }
    }, (err) => {
      console.error('opps2: real-time listener error', err);
    });
    return () => unsub();
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track the latest data + uid in refs so the unmount-flush effect
  // (which only runs on mount/unmount) can read the most recent values
  // without re-subscribing on every keystroke.
  const latestDataRef = useRef(data);
  const latestUidRef = useRef(user?.uid);
  useEffect(() => { latestDataRef.current = data; }, [data]);
  useEffect(() => { latestUidRef.current = user?.uid; }, [user?.uid]);

  // Persistence — IndexedDB writes immediately (cheap, survives
  // reload), Firestore writes are debounced 1.5s so a flurry of cell
  // edits collapses into a single round-trip. The saved _updatedAt is
  // captured so the real-time listener can skip our own echoes.
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveOpps2Cache(data);
    if (!user?.uid) return;
    if (firestoreSaveTimerRef.current) clearTimeout(firestoreSaveTimerRef.current);
    firestoreSaveTimerRef.current = setTimeout(async () => {
      // Use the throwing variant so we can capture *why* the cloud write
      // failed (permission, quota, offline) and show it in the banner —
      // a denied/exhausted write must never go unnoticed while edits sit
      // only in the local cache.
      try {
        const ts = await saveOpps2ToFirestore(user.uid, data);
        lastFsSavedAtRef.current = ts;
        setLastSyncedAt(ts);
        setSyncError(false);
        setSyncErrorDetail('');
      } catch (err) {
        console.error('opps2: Firestore save failed', err);
        setSyncError(true);
        setSyncErrorDetail(err?.message || String(err));
      }
      // Drop a throttled snapshot into the rolling backup ring once edits
      // have settled. pushOpps2Backup self-throttles (one per few minutes)
      // and dedups by _updatedAt, so this is cheap on a flurry of saves.
      pushOpps2Backup(data, 'autosave');
    }, 1500);
    return () => {
      if (firestoreSaveTimerRef.current) clearTimeout(firestoreSaveTimerRef.current);
    };
  }, [data, user?.uid]);

  // Manual "Retry now" from the sync-failure banner. Writes the latest
  // data straight to Firestore (no debounce) and only clears the banner
  // once the write actually acks, so a still-failing connection keeps
  // the warning up instead of flickering it away.
  const retrySync = useCallback(async () => {
    if (!latestUidRef.current || retryingSync) return;
    setRetryingSync(true);
    try {
      const ts = await saveOpps2ToFirestore(latestUidRef.current, latestDataRef.current);
      lastFsSavedAtRef.current = ts;
      setLastSyncedAt(ts);
      setSyncError(false);
      setSyncErrorDetail('');
    } catch (err) {
      console.error('opps2: manual retry failed', err);
      setSyncError(true);
      setSyncErrorDetail(err?.message || String(err));
    } finally {
      setRetryingSync(false);
    }
  }, [retryingSync]);

  // Flush any pending Firestore save on unmount — without this, a
  // user who clicks Import (or makes a quick edit) and then switches
  // tabs inside the 1.5s debounce window loses the write. On next
  // hydration the stale Firestore copy wins over the up-to-date IDB
  // cache, so the change appears to vanish.
  useEffect(() => {
    return () => {
      if (firestoreSaveTimerRef.current && latestUidRef.current) {
        clearTimeout(firestoreSaveTimerRef.current);
        firestoreSaveTimerRef.current = null;
        // Guarded flush: merge against the cloud copy first so this
        // (possibly stale) tab can't blind-overwrite rows that are newer
        // in Firestore. App stays alive across an in-app tab switch, so
        // the async read-merge-write completes.
        flushOpps2ToFirestore(latestUidRef.current, latestDataRef.current)
          .then(ts => { if (ts != null) lastFsSavedAtRef.current = ts; });
      }
    };
  }, []);

  // Flush any pending Firestore save when the tab is closed / reloaded
  // so the last keystroke before a reload still survives the round
  // trip.
  useEffect(() => {
    function flush() {
      if (firestoreSaveTimerRef.current && user?.uid) {
        clearTimeout(firestoreSaveTimerRef.current);
        firestoreSaveTimerRef.current = null;
        // Guarded flush (best-effort on unload): merge against the cloud
        // so a stale tab closing can't revert newer rows. If the async
        // write doesn't finish before the tab dies, IDB still holds the
        // data and the next per-row hydration reconcile recovers it.
        flushOpps2ToFirestore(user.uid, data);
      }
    }
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [data, user?.uid]);

  const addNewOpp = useCallback((accountName, source, peOwner) => {
    setData(prev => {
      const records = prev?.records || [];
      const headers = prev?.headers?.length ? prev.headers : DEFAULT_HEADERS;
      const nextId = records.reduce((m, r) => Math.max(m, r._id || 0), 0) + 1;
      return { ...prev, headers, records: [makeBlankOpp(nextId, headers, accountName, source, peOwner), ...records] };
    });
  }, []);

  // ---- Undo stack -------------------------------------------------
  // In-memory history of the last UNDO_LIMIT cell mutations. Each
  // updateOppField / deleteOppField call snapshots the prior value
  // (including the sibling columns that get dropped as a side effect)
  // and pushes it here; the Undo button + Ctrl/Cmd+Z pop the top
  // entry and re-apply it via a private mutator that doesn't push
  // back onto the stack. Resets on reload because it's React state
  // only — Firestore + IndexedDB persist the *current* row state, not
  // its history.
  const UNDO_LIMIT = 50;
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);
  const [undoStack, setUndoStack] = useState([]);
  const pushUndoEntry = useCallback((entry) => {
    if (!entry || !entry.fields?.length) return;
    setUndoStack(prev => {
      const next = [...prev, entry];
      if (next.length > UNDO_LIMIT) next.shift();
      return next;
    });
  }, []);
  const undoLastChange = useCallback(() => {
    setUndoStack(prev => {
      if (!prev.length) return prev;
      const entry = prev[prev.length - 1];
      setData(d => {
        const records = d?.records || [];
        return {
          ...d,
          records: records.map(r => {
            if (r._id !== entry.id) return r;
            const next = { ...r };
            for (const f of entry.fields) {
              if (f.hadField) next[f.field] = f.prevValue;
              else delete next[f.field];
            }
            return next;
          }),
        };
      });
      return prev.slice(0, -1);
    });
  }, []);

  // Configurable per-type clear schedules (✓ / ✗ / any), persisted in
  // per-user localStorage. The toolbar button opens a modal to edit these.
  const [nfatSchedules, setNfatSchedules] = useState(loadNfatSchedules);
  const [nfatScheduleOpen, setNfatScheduleOpen] = useState(false);
  const saveNfatSchedules = useCallback((next) => {
    setNfatSchedules(next);
    try { userLsSet(NFAT_SCHEDULES_KEY, JSON.stringify(next)); } catch { /* quota */ }
  }, []);

  // Blank the matching "No Further Action Today" cells for a given clear
  // type ('check' → ✓, 'x' → ✗, 'any' → anything set). Shared by the
  // configurable schedules and the modal's "Clear now" buttons. Clears the
  // value, drops the `_nfatSetAt` tracking stamp, and bumps
  // `_rowUpdatedAt` so the cleared value wins the cross-device merge over
  // a stale mark on another device. Returns the number of rows cleared.
  const clearNfat = useCallback((type) => {
    const recs = dataRef.current?.records || [];
    const count = recs.reduce(
      (n, r) => n + (nfatValueMatches(r?.['No Further Action Today'], type) ? 1 : 0),
      0,
    );
    if (count > 0) {
      setData(prev => {
        const rs = prev?.records || [];
        let touched = false;
        const next = rs.map(r => {
          if (!nfatValueMatches(r?.['No Further Action Today'], type)) return r;
          touched = true;
          const copy = { ...r };
          copy['No Further Action Today'] = '';
          delete copy._nfatSetAt;
          copy._rowUpdatedAt = Date.now();
          return copy;
        });
        if (!touched) return prev;
        return { ...prev, records: next };
      });
    }
    return count;
  }, []);

  // Global Cmd/Ctrl+Z. Skipped when the user has an input/textarea
  // focused so the browser's native text-undo still works mid-edit;
  // the toolbar button stays available either way.
  useEffect(() => {
    function onKeyDown(e) {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta || e.shiftKey || e.altKey) return;
      if ((e.key || '').toLowerCase() !== 'z') return;
      const ae = document.activeElement;
      const tag = (ae?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || ae?.isContentEditable) return;
      e.preventDefault();
      undoLastChange();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undoLastChange]);

  const updateOppField = useCallback((id, field, rawValue) => {
    // Auto-format a user-entered Quoted Amount to currency ($25,000) so
    // the stored value — and every view that reads it — stays consistent,
    // regardless of how the user typed it (25000, 25,000, $25000.50…).
    const value = field === 'Quoted Amount' ? formatQuotedAmount(rawValue) : rawValue;
    // Snapshot the prior cell state before the mutation so the Undo
    // stack can restore it. We also snapshot the sibling columns that
    // are dropped as a side effect (Follow Up → Call In, Last Client
    // Heard From Us → Last Spoke) so a single undo restores all of
    // them in one step instead of leaving the user to chase the
    // computed column back to life via "+ add".
    const row = (dataRef.current?.records || []).find(r => r._id === id);
    const stageChanged = !!row && field === 'Stage' && String(row[field] ?? '') !== String(value ?? '');
    // A changed Follow Up date prompts the user to set the new Status
    // (Who is waiting) for that opp. Compared on the ISO date so a
    // reformat of the same day doesn't trigger the prompt.
    const followUpChanged = !!row && field === 'Follow Up'
      && (toISODate(row[field]) || '') !== (toISODate(value) || '');
    // When the user enters a Close Date, mirror its year + month into the
    // "Close Year" / "Close Month" columns so the Opp details stay in
    // sync without manual entry. A cleared date clears them; an
    // unparseable entry leaves them untouched so a typo doesn't wipe
    // good data.
    let closeDerived = null;
    if (row && field === 'Close Date') {
      const { yearCols, monthCols } = findCloseDerivedColumns(dataRef.current?.headers);
      if (yearCols.length || monthCols.length) {
        const d = parseCloseDate(value);
        const cleared = String(value ?? '').trim() === '';
        if (d || cleared) {
          closeDerived = {
            yearCols,
            monthCols,
            yearVal: d ? String(d.getFullYear()) : '',
            monthVal: d ? MONTH_FULL_NAMES[d.getMonth()] : '',
          };
        }
      }
    }
    // When the Stage flips TO "Sold" or "Not Sold", stamp the Close Date
    // with the date of the status change (today) and mirror it into the
    // derived Close Year / Close Month columns, just like a manual Close
    // Date edit would. Computed here so it can be snapshotted for undo
    // and applied inside the setData mapper below. For Not Sold the
    // follow-up popup opens right after, pre-filled with the stamped
    // date, so the user can adjust it on the spot.
    //
    // Only fill an EMPTY Close Date — never overwrite one already on the
    // row. Re-marking a deal Sold (or a bulk Stage update) used to clobber
    // a real close date with today's date, which silently moved last
    // year's sales into the current year on the YOY Annual Sales chart.
    const hasCloseDate = !!row && String(row['Close Date'] ?? '').trim() !== '';
    const newStageNorm = String(value ?? '').trim().toLowerCase();
    let closeStamp = null;
    if (stageChanged && !hasCloseDate && (newStageNorm === 'sold' || newStageNorm === 'not sold')) {
      const today = todayISO();
      const { yearCols, monthCols } = findCloseDerivedColumns(dataRef.current?.headers);
      const d = parseCloseDate(today);
      closeStamp = {
        date: today,
        yearCols,
        monthCols,
        yearVal: d ? String(d.getFullYear()) : '',
        monthVal: d ? MONTH_FULL_NAMES[d.getMonth()] : '',
      };
    }
    if (row) {
      const snap = (f) => ({ field: f, hadField: f in row, prevValue: f in row ? row[f] : undefined });
      const fields = [snap(field)];
      if (field === 'Follow Up' && 'Call In' in row) fields.push(snap('Call In'));
      if (field === 'Last Client Heard From Us' && 'Last Spoke' in row) fields.push(snap('Last Spoke'));
      // Snapshot the auto-stamped Close Date (+ derived columns) so one
      // undo of the Sold / Not Sold stage change also restores them.
      if (closeStamp) {
        fields.push(snap('Close Date'));
        for (const c of [...closeStamp.yearCols, ...closeStamp.monthCols]) fields.push(snap(c));
      }
      // Days-in-Stage reads `_stageEnteredAt`; snapshot it alongside the
      // Stage edit so an undo restores both in one step. The Stage
      // History tab reads `_stageHistory`, so we snapshot that too.
      if (stageChanged) {
        fields.push(snap('_stageEnteredAt'));
        fields.push(snap('_stageHistory'));
      }
      // No Further Action Today flips track when the row was marked
      // (see `_nfatSetAt`) so the daily start-of-day auto-clear can
      // tell yesterday's leftovers from today's marks. Snapshot it
      // for undo too.
      if (field === 'No Further Action Today') fields.push(snap('_nfatSetAt'));
      // Snapshot the auto-filled Close Year / Close Month so one undo of
      // the Close Date edit restores them in the same step.
      if (closeDerived) {
        for (const c of [...closeDerived.yearCols, ...closeDerived.monthCols]) fields.push(snap(c));
      }
      pushUndoEntry({ id, fields });
    }
    setData(prev => {
      const records = prev?.records || [];
      return {
        ...prev,
        records: records.map(r => {
          if (r._id !== id) return r;
          const now = Date.now();
          const next = { ...r, [field]: value, _rowUpdatedAt: now };
          // When the source date for a computed column changes, drop
          // any sheet-imported stored value on the computed column so
          // the render falls back to a live recompute. Without this, an
          // imported row that arrived with a blank Call In would stay
          // blank forever even after the user picks a new Follow Up.
          if (field === 'Follow Up' && 'Call In' in next) delete next['Call In'];
          if (field === 'Last Client Heard From Us' && 'Last Spoke' in next) delete next['Last Spoke'];
          // Auto-fill the derived Close Year / Close Month columns from
          // the new Close Date (computed above).
          if (closeDerived) {
            for (const c of closeDerived.yearCols) next[c] = closeDerived.yearVal;
            for (const c of closeDerived.monthCols) next[c] = closeDerived.monthVal;
          }
          // Auto-stamp the Close Date (+ derived columns) when the stage
          // flips to Sold or Not Sold, using the status-change date.
          if (closeStamp) {
            next['Close Date'] = closeStamp.date;
            for (const c of closeStamp.yearCols) next[c] = closeStamp.yearVal;
            for (const c of closeStamp.monthCols) next[c] = closeStamp.monthVal;
          }
          // Stamp the stage-entry date whenever Stage flips to a new
          // value so Days-in-Stage measures "time since the last move"
          // rather than the row's age. We also push a history entry
          // for the stage being left so the Stage History tab can
          // report per-stage days for each opp.
          if (stageChanged) {
            const today = todayISO();
            const prevStage = String(r['Stage'] ?? '').trim();
            const prevEntered = toISODate(r._stageEnteredAt) || toISODate(r['Start Date']);
            const dur = prevEntered ? daysBetween(prevEntered, today) : null;
            const days = dur == null ? null : Math.max(0, dur);
            const prior = Array.isArray(r._stageHistory) ? r._stageHistory : [];
            next._stageHistory = [
              ...prior,
              { stage: prevStage, enteredAt: prevEntered || '', exitedAt: today, days },
            ];
            next._stageEnteredAt = today;
          }
          // Track when the No-Further-Action-Today X was placed so the
          // 2 PM Eastern sweep can clear stale ones without nuking a
          // mark the user just made.
          if (field === 'No Further Action Today') {
            const norm = String(value ?? '').trim().toLowerCase();
            if (norm === 'no') next._nfatSetAt = new Date().toISOString();
            else delete next._nfatSetAt;
          }
          // Record per-field edit times so a concurrent edit to a
          // *different* field of this same opp on another device merges
          // field-by-field, instead of one whole-row version clobbering
          // the other. Stamp exactly the fields this edit changed.
          next._fieldUpdatedAt = stampChangedFields(r, next, now);
          return next;
        }),
      };
    });
    // Prompt for the close-out details (Close Date / Reason Not Sold /
    // Final Margin) whenever the Stage flips TO "Not Sold". Skipped on
    // bulk mass-edits — those run through the bulk path below and we
    // don't want to multi-modal across selections.
    if (stageChanged && String(value ?? '').trim().toLowerCase() === 'not sold') {
      setNotSoldPromptId(id);
    }
    // Prompt for the quote-tracking data points (Quoted On / Chance? /
    // Margin Email Date - Sales Leader Review Date) whenever the Stage
    // flips TO "Quoted" so they can be entered or reviewed on the spot.
    if (stageChanged && String(value ?? '').trim().toLowerCase() === 'quoted') {
      setQuotedPromptId(id);
    }
    // Prompt for the close-out details (Reason Not Sold / Final Margin /
    // Competition) whenever the Stage flips TO "Sold". The Close Date was
    // already auto-stamped above.
    if (stageChanged && String(value ?? '').trim().toLowerCase() === 'sold') {
      setSoldPromptId(id);
    }
    // Prompt for the Quoted Amount whenever the Stage flips FROM "Not
    // Started" TO "Lead", so the number is captured the moment the opp
    // becomes active.
    if (
      stageChanged
      && String(row['Stage'] ?? '').trim().toLowerCase() === 'not started'
      && String(value ?? '').trim().toLowerCase() === 'lead'
    ) {
      setLeadQuotedPromptId(id);
    }
    // Whenever the Follow Up date changes, prompt for the new Status so
    // the "Who is waiting" value stays current with each follow-up.
    if (followUpChanged) {
      setFollowUpStatusPromptId(id);
      // Remember the pre-edit Follow Up (and the sibling Call In that
      // gets dropped as a side effect) so the modal's Cancel button can
      // restore the original date.
      setFollowUpStatusPrev({
        hadFollowUp: 'Follow Up' in row,
        followUp: row['Follow Up'],
        hadCallIn: 'Call In' in row,
        callIn: row['Call In'],
      });
    }
  }, [pushUndoEntry]);

  // Restore the Follow Up date (and its sibling Call In) to the snapshot
  // taken before the edit that opened the FollowUpStatusModal. Writes the
  // values back directly via setData rather than updateOppField so the
  // restore doesn't itself count as a change and re-open the prompt.
  const revertFollowUpDate = useCallback((id, prev) => {
    if (!prev) return;
    setData(cur => {
      const records = cur?.records || [];
      return {
        ...cur,
        records: records.map(r => {
          if (r._id !== id) return r;
          const now = Date.now();
          const next = { ...r, _rowUpdatedAt: now };
          if (prev.hadFollowUp) next['Follow Up'] = prev.followUp;
          else delete next['Follow Up'];
          if (prev.hadCallIn) next['Call In'] = prev.callIn;
          else delete next['Call In'];
          next._fieldUpdatedAt = stampChangedFields(r, next, now);
          return next;
        }),
      };
    });
  }, []);

  // Drop a field entirely from a row. Used to clear a user-set Call In
  // override so the live compute from Follow Up takes over again — the
  // sentinel-checking path in resolveComputedDays only ignores the
  // stored value when the key is missing, not just empty.
  const deleteOppField = useCallback((id, field) => {
    const row = (dataRef.current?.records || []).find(r => r._id === id);
    if (row && field in row) {
      pushUndoEntry({ id, fields: [{ field, hadField: true, prevValue: row[field] }] });
    }
    setData(prev => {
      const records = prev?.records || [];
      return {
        ...prev,
        records: records.map(r => {
          if (r._id !== id) return r;
          if (!(field in r)) return r;
          const next = { ...r };
          delete next[field];
          return next;
        }),
      };
    });
  }, [pushUndoEntry]);

  const deleteOpp = useCallback((id) => {
    setData(prev => {
      const records = prev?.records || [];
      // Tombstone the id so the delete propagates across devices instead
      // of the row resurrecting from a stale copy on the next merge.
      return {
        ...prev,
        records: records.filter(r => r._id !== id),
        _deletedIds: { ...(prev?._deletedIds || {}), [String(id)]: Date.now() },
      };
    });
    setSelectedIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const updateManyOppFields = useCallback((ids, field, value) => {
    const idSet = ids instanceof Set ? ids : new Set(ids);
    if (!idSet.size || !field) return;
    setData(prev => {
      const records = prev?.records || [];
      const stamp = field === 'Stage' ? todayISO() : null;
      return {
        ...prev,
        records: records.map(r => {
          if (!idSet.has(r._id)) return r;
          const now = Date.now();
          const next = { ...r, [field]: value, _rowUpdatedAt: now };
          // Same stage-entry stamp the single-row path applies, so bulk
          // moves through Days-in-Stage start the clock at the bulk
          // edit instead of the rows' original Start Date. Also append
          // a stage-history entry for the stage being left so the
          // Stage History tab matches what the single-row updater
          // produces.
          if (stamp && String(r[field] ?? '') !== String(value ?? '')) {
            const prevStage = String(r[field] ?? '').trim();
            const prevEntered = toISODate(r._stageEnteredAt) || toISODate(r['Start Date']);
            const dur = prevEntered ? daysBetween(prevEntered, stamp) : null;
            const days = dur == null ? null : Math.max(0, dur);
            const prior = Array.isArray(r._stageHistory) ? r._stageHistory : [];
            next._stageHistory = [
              ...prior,
              { stage: prevStage, enteredAt: prevEntered || '', exitedAt: stamp, days },
            ];
            next._stageEnteredAt = stamp;
          }
          // Track when No-Further-Action-Today gets flipped via the
          // mass-edit bar, same as the single-row updater. The 2 PM
          // Eastern sweep needs the stamp to decide what to clear.
          if (field === 'No Further Action Today') {
            const norm = String(value ?? '').trim().toLowerCase();
            if (norm === 'no') next._nfatSetAt = new Date().toISOString();
            else delete next._nfatSetAt;
          }
          next._fieldUpdatedAt = stampChangedFields(r, next, now);
          return next;
        }),
      };
    });
  }, []);

  const deleteManyOpps = useCallback((ids) => {
    const idSet = ids instanceof Set ? ids : new Set(ids);
    if (!idSet.size) return;
    setData(prev => {
      const records = prev?.records || [];
      const now = Date.now();
      const deletedIds = { ...(prev?._deletedIds || {}) };
      for (const id of idSet) deletedIds[String(id)] = now;
      return { ...prev, records: records.filter(r => !idSet.has(r._id)), _deletedIds: deletedIds };
    });
    setSelectedIds(new Set());
  }, []);

  const updateColumnLinks = useCallback((nextLinks) => {
    setData(prev => ({ ...(prev || {}), columnLinks: nextLinks || {} }));
  }, []);

  const toggleHideService = useCallback((scope) => {
    setHiddenServices(prev => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope); else next.add(scope);
      return next;
    });
  }, []);

  // Run the configured "No Further Action Today" clear schedules. For each
  // enabled type, if its most recent scheduled occurrence (Eastern weekday
  // + time) is newer than the last time it ran, the clear fires — which
  // also catches up a scheduled time that passed while the app was closed.
  // We re-check on mount (after hydration) and every minute the tab is
  // open, so a tab left open across a scheduled time self-clears. Gating on
  // `hydrated` ensures we clear the reconciled dataset, not the cache paint.
  useEffect(() => {
    if (!hydrated) return undefined;
    const tick = () => {
      const now = Date.now();
      let changed = false;
      const next = { ...nfatSchedules };
      for (const type of NFAT_SCHEDULE_TYPES) {
        const s = next[type];
        if (!s?.enabled) continue;
        const occ = mostRecentNfatScheduleMs(s.days, s.time, now);
        if (occ == null || (s.lastRunAt || 0) >= occ) continue;
        clearNfat(type);
        next[type] = { ...s, lastRunAt: now };
        changed = true;
      }
      // Persist the advanced lastRunAt stamps so a missed-run catch-up
      // doesn't re-fire on the next tick / reload.
      if (changed) saveNfatSchedules(next);
    };
    tick();
    const t = window.setInterval(tick, 60_000);
    return () => window.clearInterval(t);
  }, [hydrated, nfatSchedules, clearNfat, saveNfatSchedules]);

  const headers = data?.headers || [];
  const columnLinks = data?.columnLinks || {};
  // Effective dropdown vocabulary: built-in lists overlaid with the
  // user's edits from the Dropdowns tab. Recomputed when the user
  // tweaks a list so cells and the Link Columns modal stay in sync.
  const dropdownLists = useMemo(
    () => getEffectiveDropdownLists(settings),
    [settings?.dropdownLists]
  );
  const listRegistry = useMemo(() => buildListRegistry(dropdownLists), [dropdownLists]);
  const availableLists = useMemo(() => buildAvailableLists(dropdownLists), [dropdownLists]);
  const records = useMemo(() => data?.records || [], [data]);

  // Drop any selection ids that no longer match a live record (e.g.
  // after a hydration that replaced records, or a delete that came in
  // through another path). Keeps the mass-edit count honest.
  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const alive = new Set(records.map(r => r._id));
      let changed = false;
      const next = new Set();
      for (const id of prev) {
        if (alive.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [records]);

  // Sorted, deduped list of company names — fed into the Account
  // column's autocomplete. Pulls from Table View prospects first
  // (the user's authoritative customer list); also folds in any
  // Account names already present in this tab's opps so adding a
  // follow-up opp for an existing account still autocompletes even
  // when the Table View hasn't loaded.
  const companySuggestions = useMemo(() => {
    const seen = new Set();
    const out = [];
    const push = (name) => {
      const c = String(name || '').trim();
      if (!c) return;
      const k = c.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(c);
    };
    for (const p of (prospects || [])) push(p?.company);
    for (const r of (data?.records || [])) push(r?.Account);
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, [prospects, data?.records]);

  // Predictive-text source for the PE Owner column. Mirrors the PE Owner
  // picker in the company popup: every Table View company is offered, but
  // Private Equity firms are surfaced first since a portfolio company's
  // PE Owner is normally one of those firms. Any PE Owner already typed
  // into an opp is folded in too so follow-ups autocomplete.
  const peOwnerSuggestions = useMemo(() => {
    const seen = new Set();
    const pe = [];
    const others = [];
    const push = (name, isPe) => {
      const c = String(name || '').trim();
      if (!c) return;
      const k = c.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      (isPe ? pe : others).push(c);
    };
    for (const p of (prospects || [])) {
      if (String(p?.type) === 'Private Equity') push(p?.company, true);
    }
    for (const p of (prospects || [])) push(p?.company, false);
    for (const r of (data?.records || [])) {
      for (const o of splitPeOwners(r?.['PE Owner'])) push(o, false);
    }
    pe.sort((a, b) => a.localeCompare(b));
    others.sort((a, b) => a.localeCompare(b));
    return [...pe, ...others];
  }, [prospects, data?.records]);

  // Map of opp `_id` → 1..N display rank. Ranks by ascending `_id` so
  // the relative creation order of surviving opps is preserved, but
  // gaps from deleted rows are compacted out — the column reads as a
  // simple count of opps on the page rather than as the raw internal
  // id. Stays a stable per-opp value across sort/filter (it's a
  // property of the row's `_id`, not the rendered position), but does
  // shift when opps are added or deleted.
  const oppNumberById = useMemo(() => {
    const map = new Map();
    const ids = (data?.records || [])
      .map(r => r?._id)
      .filter(id => id != null)
      .sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
    ids.forEach((id, idx) => map.set(id, idx + 1));
    return map;
  }, [data?.records]);

  const columns = useMemo(() => {
    const seen = new Set();
    const mapped = headers
      .filter(h => {
        if (!h || seen.has(h)) return false;
        seen.add(h);
        return true;
      })
      .map(h => ({
        key: h,
        label: headerLabel(h),
        defaultWidth: h === 'Notes' ? 250 : h === 'Next Steps' ? 240 : h === 'Account' ? 200 : h === 'BFO Link' ? 220 : h === 'Scope' ? 220 : TRISTATE_COLUMNS.has(h) ? 90 : h.length > 20 ? 160 : 120,
        sticky: h === 'Account',
        // Every cell is click-to-edit so a freshly created opp can be
        // filled in directly. getFilterValue exposes the raw text to
        // the per-column filter so search keeps working on the value
        // the user sees, not the rendered <input>.
        // Computed columns derive from sibling fields (and may honor a
        // sheet-imported literal); surface the live displayed value so
        // search / filter match what the cell actually shows.
        getFilterValue: (row) => {
          if (h === 'Call In') {
            const n = resolveCallIn(row);
            return n == null ? '' : String(n);
          }
          if (h === 'Last Spoke') {
            const n = resolveLastSpoke(row);
            return n == null ? '' : String(n);
          }
          if (h === 'Waiting On') {
            const stacked = (Array.isArray(row._nextStepsWaiting) ? row._nextStepsWaiting : [])
              .map(s => String(s || '').trim())
              .filter(Boolean)
              .join('\n');
            return stacked || String(row[h] ?? '');
          }
          if (isFlagsColumn(h)) {
            // Expose the auto "needs USD" flag to the column filter /
            // search so the user can isolate flagged rows by typing
            // "needs USD" (or 🚩), on top of any manual flag text.
            const manual = String(row[h] ?? '').trim();
            return needsUsdFlag(row) ? `🚩 needs USD ${manual}`.trim() : manual;
          }
          return row[h] ?? '';
        },
        // Sort by the same displayed value — without this, DataTable
        // falls back to the stored (empty / stale) cell and the order
        // doesn't match what you see (e.g. negative "overdue" days
        // wouldn't lead an ascending sort).
        getSortValue: (h === 'Call In' || h === 'Last Spoke')
          ? (row) => (h === 'Call In' ? resolveCallIn(row) : resolveLastSpoke(row))
          : undefined,
        // Call In is derived from Follow Up. If the table re-sorted on
        // every edit, typing a new Follow Up date would yank the row out
        // from under the cursor as its Call In recomputed. Freeze the
        // order at click time so manual triage stays stable — the user
        // re-clicks the header when they want a fresh ranking.
        freezeSortOrder: h === 'Call In' ? true : undefined,
        render: (row) => {
          if (isFlagsColumn(h)) {
            // Auto 🚩 when the deal is past Lead but the `USD?` field has
            // no real value (blank or "-"). Stays editable so manual flag
            // notes can sit alongside the auto indicator.
            const auto = needsUsdFlag(row);
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {auto && (
                  <span
                    title="Stage is Qualifying or later but the USD? field is blank or “-”"
                    style={{ fontSize: '0.95rem', flexShrink: 0, lineHeight: 1 }}
                  >🚩</span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <EditableCell
                    value={row[h]}
                    onChange={(v) => updateOppField(row._id, h, v)}
                  />
                </div>
              </div>
            );
          }
          if (h === 'Call In') {
            // Click-to-clear / click-to-restore. The cell still
            // computes live from Follow Up by default; the user can
            // override to blank per opp (stores a sentinel) and undo
            // that override with the "+ add" affordance.
            return (
              <CallInCell
                row={row}
                onClear={() => updateOppField(row._id, 'Call In', '-')}
                onRestore={() => deleteOppField(row._id, 'Call In')}
              />
            );
          }
          if (TRISTATE_COLUMNS.has(h)) {
            return (
              <TristateCheckCell
                value={row[h]}
                onChange={(v) => updateOppField(row._id, h, v)}
                title={`${h}: blank → ✓ → ✗ → blank`}
              />
            );
          }
          if (h === 'Pricing Option') {
            // Read-only column populated from the Pricing → Options tab.
            // The cell shows the linked option name (or em-dash). A
            // small × button clears the link in place.
            const linked = optionLinks[String(row._id)] || '';
            return (
              <PricingOptionCell
                value={linked}
                onClear={() => setOppOptionLink(row._id, '')}
              />
            );
          }
          if (h === 'Quoted Amount') {
            // When the opp has a Pricing-Option snapshot attached, the
            // cell renders as a hyperlink that opens the Opp details
            // popup (where the snapshot detail lives) and exposes a
            // small ✎ for inline override edits. A manual URL on
            // `_quotedAmountUrl` takes precedence so users can attach
            // a quote PDF / BFO doc / etc.
            // Resolve the linked Option's services from the live
            // per-Option map (keyed by sheetName, which equals the saved
            // snapshot's name / the opp's Pricing Option link). Used as a
            // fallback for snapshots saved before services were frozen in.
            const optName = String(row._pricingOption?.name || optionLinks[String(row._id)] || '').trim();
            const cellServices = (optName && pricingOptionServices) ? (pricingOptionServices[optName] || []) : [];
            return (
              <QuotedAmountCell
                value={row[h]}
                snapshot={row._pricingOption || null}
                onChange={(v) => updateOppField(row._id, h, v)}
                onViewSnapshot={() => setInfoOppId(row._id)}
                url={row._quotedAmountUrl || ''}
                onChangeUrl={(u) => updateOppField(row._id, '_quotedAmountUrl', u)}
                services={cellServices}
              />
            );
          }
          if (h === 'Last Spoke') {
            // Business days since the Last Client Heard From Us date —
            // mirrors the Call In logic above, honoring a sheet-imported
            // blank when present.
            const n = resolveLastSpoke(row);
            return <ComputedCell value={n == null ? '' : n} />;
          }
          if (DATE_COLUMNS.has(h)) {
            return <DateCell value={row[h]} onChange={(v) => updateOppField(row._id, h, v)} />;
          }
          const link = resolveColumnLink(h, columnLinks);
          if (link) {
            const opts = listRegistry.get(link.listKey)?.options || [];
            if (link.mode === 'multi') {
              // Surface the Pricing-tab per-Option services bundle only
              // when this cell's vocabulary is the Solutions catalog
              // (the source of those mappings) — so the quick picker
              // doesn't appear on unrelated multi-select cells the user
              // might bind to other lists.
              const extraGroups = link.listKey === 'solutions'
                ? Object.entries(pricingOptionServices || {})
                    .map(([sheetName, services]) => ({
                      label: sheetName,
                      options: Array.isArray(services) ? services : [],
                    }))
                    .filter(g => g.options.length > 0)
                    .sort((a, b) => a.label.localeCompare(b.label))
                : undefined;
              return (
                <MultiSelectCell
                  value={row[h]}
                  onChange={(v) => updateOppField(row._id, h, v)}
                  options={opts}
                  extraGroups={extraGroups}
                  extraGroupsLabel="Add from Pricing Option"
                  extraGroupsPlaceholder="— pick an option —"
                  nowrap={h === 'Scope'}
                />
              );
            }
            return (
              <SelectCell
                value={row[h]}
                onChange={(v) => updateOppField(row._id, h, v)}
                options={opts}
              />
            );
          }
          if (h === 'Contact') {
            return (
              <ContactCell
                value={row[h]}
                onChange={(v) => updateOppField(row._id, h, v)}
                account={row['Account']}
                peOwner={row['PE Owner']}
                prospects={prospects}
                updateProspect={updateProspect}
                hubspotContacts={hubspotContacts}
                onOpenContact={openContactDetails}
                onOpenCompany={openCompanyDetails}
                contactEmails={row._contactEmails}
                onChangeEmails={(m) => updateOppField(row._id, '_contactEmails', m)}
              />
            );
          }
          if (h === 'Waiting On') {
            // Mirror the popup's per-step Waiting On values into the
            // table column. The Next Steps editor stores a parallel
            // array (_nextStepsWaiting) aligned with each note line, so
            // joining the non-empty entries with newlines stacks them
            // visually in the cell (white-space: pre keeps each on its
            // own row; auto-grow row heights handle vertical fit).
            // When the popup hasn't been used yet, fall back to the
            // legacy editable field so a manually-typed value still
            // shows and stays editable.
            const stacked = (Array.isArray(row._nextStepsWaiting) ? row._nextStepsWaiting : [])
              .map(s => String(s || '').trim())
              .filter(Boolean)
              .join('\n');
            if (stacked) {
              return (
                <span
                  onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); setNextStepsPopupId(row._id); }}
                  title="Double-click to edit in Notes"
                  style={{
                    display: 'block', cursor: 'pointer', minHeight: '1em',
                    padding: '1px 2px', whiteSpace: 'pre', overflow: 'hidden',
                  }}
                >{stacked}</span>
              );
            }
          }
          if (h === 'Next Steps') {
            return (
              <NextStepsCell
                value={row[h]}
                onOpen={() => setNextStepsPopupId(row._id)}
              />
            );
          }
          if (h === 'BFO Company Name') {
            return <BfoCompanyNameCell account={row['Account']} prospects={prospects} updateProspect={updateProspect} />;
          }
          return (
            <EditableCell
              value={row[h]}
              onChange={(v) => updateOppField(row._id, h, v)}
              suggestions={h === 'Account' ? companySuggestions : h === 'PE Owner' ? peOwnerSuggestions : undefined}
              renderDisplay={h === 'Account' ? ({ enterEdit, isEmpty, text }) => {
                const matched = isEmpty ? null : findProspectForAccount(row[h], prospects);
                // No matching prospect — fall back to the normal
                // click-to-edit text cell.
                if (!matched) {
                  return (
                    <span
                      onClick={(e) => { e.stopPropagation(); enterEdit(); }}
                      style={{
                        display: 'block', cursor: 'text', minHeight: '1em',
                        padding: '1px 2px', whiteSpace: 'pre', overflow: 'hidden',
                        color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
                      }}
                    >{text}</span>
                  );
                }
                // Matched a prospect — render the company name as a link
                // that opens the company popup. Double-click still edits.
                return (
                  <span
                    onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); enterEdit(); }}
                    style={{
                      display: 'block', minHeight: '1em',
                      padding: '1px 2px', whiteSpace: 'pre', overflow: 'hidden',
                    }}
                  >
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openCompanyDetails(matched); }}
                      title={`Open ${matched.company || row[h]}'s company page (double-click to edit)`}
                      style={{
                        padding: 0, border: 'none', background: 'transparent',
                        fontFamily: 'inherit', fontSize: 'inherit', color: '#2563EB',
                        fontWeight: 600, cursor: 'pointer',
                        textDecoration: 'underline', textDecorationColor: '#93C5FD',
                        textUnderlineOffset: '2px',
                      }}
                    >{text}</button>
                  </span>
                );
              } : undefined}
            />
          );
        },
      }));
    // Trailing actions column — × button per row for delete. Lives
    // outside the headers loop so it can't be hidden via the columns
    // toggle (you always need a way to delete a row).
    const actions = {
      key: '_actions',
      label: '',
      defaultWidth: 44,
      getFilterValue: () => '',
      render: (row) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const label = String(row['Account'] || '').trim() || 'this opp';
            if (window.confirm(`Delete ${label}? This can't be undone.`)) {
              deleteOpp(row._id);
            }
          }}
          title="Delete this opp"
          style={{
            padding: '0', width: 22, height: 22, lineHeight: 1,
            fontSize: '0.95rem', fontWeight: 600, fontFamily: 'inherit',
            color: '#94A3B8', background: 'transparent',
            border: '1px solid var(--color-border)', borderRadius: 4,
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#B91C1C'; e.currentTarget.style.borderColor = '#B91C1C'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#94A3B8'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
        >×</button>
      ),
    };
    // Selection checkbox — prepended so the user can flip rows on/off
    // for mass-edit. The header checkbox toggles every row in the
    // current filter (so a user can filter to "Stage = Quoting" and
    // mass-select with one click).
    const selectCol = {
      key: '_select',
      label: '',
      defaultWidth: 36,
      getFilterValue: () => '',
      renderHeader: () => {
        const filteredArr = Array.from(filteredRowIds);
        let selectedInFilter = 0;
        for (const id of filteredArr) if (selectedIds.has(id)) selectedInFilter += 1;
        const allSelected = filteredArr.length > 0 && selectedInFilter === filteredArr.length;
        const someSelected = selectedInFilter > 0 && !allSelected;
        return (
          <input
            type="checkbox"
            ref={(el) => { if (el) el.indeterminate = someSelected; }}
            checked={allSelected}
            disabled={filteredArr.length === 0}
            onChange={(e) => {
              const checked = e.target.checked;
              setSelectedIds(prev => {
                const next = new Set(prev);
                if (checked) {
                  for (const id of filteredArr) next.add(id);
                } else {
                  for (const id of filteredArr) next.delete(id);
                }
                return next;
              });
            }}
            style={{ margin: 0, cursor: filteredArr.length === 0 ? 'not-allowed' : 'pointer' }}
            title={filteredArr.length === 0
              ? 'No filtered rows to select'
              : allSelected
                ? `Clear selection for all ${filteredArr.length} filtered row${filteredArr.length === 1 ? '' : 's'}`
                : `Select all ${filteredArr.length} filtered row${filteredArr.length === 1 ? '' : 's'}`}
          />
        );
      },
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row._id)}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const checked = e.target.checked;
            setSelectedIds(prev => {
              const next = new Set(prev);
              if (checked) next.add(row._id);
              else next.delete(row._id);
              return next;
            });
          }}
          style={{ margin: 0, cursor: 'pointer' }}
          title="Select for mass edit"
        />
      ),
    };
    // Info button — opens a modal showing the row's basic info and a
    // delete button. Inserted right before Next Steps so the user
    // doesn't have to scroll the row to get a summary.
    const infoCol = {
      key: '_info',
      label: '',
      defaultWidth: 40,
      getFilterValue: () => '',
      render: (row) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setInfoOppId(row._id); }}
          title="Show opp info"
          style={{
            padding: '0', width: 22, height: 22, lineHeight: 1,
            fontSize: '0.85rem', fontWeight: 700, fontFamily: 'inherit',
            color: 'var(--color-accent)', background: '#fff',
            border: '1px solid var(--color-accent)', borderRadius: '50%',
            cursor: 'pointer',
          }}
        >i</button>
      ),
    };
    // "Flags" — surfaces per-opp attention flags: a BFO Opportunity Name
    // with no BFO Address yet, and the Days-in-Stage stall flag (opp sat
    // in its stage past the limit). The stall flag can be ignored per opp
    // (stored on `_ignoreStallFlag`), which also clears it on the
    // Days-in-Stage board. Synthetic (not a stored field), placed right
    // after the BFO Opportunity Name column for context; falls back to
    // the end when that column is hidden.
    const chipBase = {
      display: 'inline-block', padding: '1px 8px', borderRadius: 999,
      fontSize: '0.65rem', fontWeight: 700, whiteSpace: 'nowrap',
    };
    const flagSummary = (row) => {
      const parts = [];
      if (oppMissingBfoAddress(row)) parts.push('Missing BFO Address');
      if (oppMissingQuotedAmount(row)) parts.push('Deal Size Missing');
      if (oppMissingMarginApproval(row)) parts.push('Missing Margin Approval');
      const stall = oppStageStall(row);
      if (stall && !row?._ignoreStallFlag) parts.push(`Stalled: ${stall.suggestion}`);
      return parts.join('; ');
    };
    const missingDataCol = {
      key: '_missingData',
      label: 'Flags',
      defaultWidth: 200,
      getFilterValue: (row) => flagSummary(row),
      getSortValue: (row) => {
        let n = 0;
        if (oppMissingBfoAddress(row)) n += 1;
        if (oppMissingQuotedAmount(row)) n += 1;
        if (oppMissingMarginApproval(row)) n += 1;
        if (oppStageStall(row) && !row?._ignoreStallFlag) n += 1;
        return n;
      },
      exportValue: (row) => flagSummary(row),
      render: (row) => {
        const missingAddr = oppMissingBfoAddress(row);
        const missingQuote = oppMissingQuotedAmount(row);
        const missingMargin = oppMissingMarginApproval(row);
        const stall = oppStageStall(row);
        const ignored = !!row?._ignoreStallFlag;
        if (!missingAddr && !missingQuote && !missingMargin && !stall) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
        return (
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
            {missingAddr && (
              <span
                title="Has a BFO Opportunity Name but no BFO Address — add the BFO Address."
                style={{ ...chipBase, background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}
              >⚠ No BFO Address</span>
            )}
            {missingQuote && (
              <span
                title={`Active opp in "${String(row['Stage'] || '').trim()}" with no Deal Size — add the Deal Size.`}
                style={{ ...chipBase, background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}
              >⚠ Deal Size Missing</span>
            )}
            {missingMargin && (
              <span
                title={`Opp in "${String(row['Stage'] || '').trim()}" with no Margin Email Date - Sales Leader Review Date — get margin approval.`}
                style={{ ...chipBase, background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}
              >⚠ Missing Margin Approval</span>
            )}
            {stall && !ignored && (
              <>
                <span
                  title={`Stalled ${stall.days}d in ${row['Stage']} (limit ${stall.limit}d) → ${stall.suggestion}`}
                  style={{ ...chipBase, background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D' }}
                >⚠ {stall.suggestion}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); updateOppField(row._id, '_ignoreStallFlag', true); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Ignore this stall flag for this opp (also clears it on the Days in Stage board)"
                  style={{
                    border: 'none', background: 'none', cursor: 'pointer', padding: '0 2px',
                    fontSize: '0.62rem', color: '#92400E', fontFamily: 'inherit', textDecoration: 'underline',
                  }}
                >ignore</button>
              </>
            )}
            {stall && ignored && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span
                  title={`Stall flag ignored (${stall.days}d in ${row['Stage']}).`}
                  style={{ ...chipBase, fontWeight: 600, background: '#F1F5F9', color: '#94A3B8', border: '1px solid #E2E8F0' }}
                >stall ignored</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); updateOppField(row._id, '_ignoreStallFlag', false); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Restore this stall flag"
                  style={{
                    border: 'none', background: 'none', cursor: 'pointer', padding: '0 2px',
                    fontSize: '0.62rem', color: 'var(--color-accent)', fontFamily: 'inherit', textDecoration: 'underline',
                  }}
                >restore</button>
              </span>
            )}
          </span>
        );
      },
    };
    const bfoLinkIdx = mapped.findIndex(c => c.key === 'BFO Link');
    if (bfoLinkIdx >= 0) mapped.splice(bfoLinkIdx + 1, 0, missingDataCol);
    else mapped.push(missingDataCol);
    // Splice the info column in just before Next Steps when it's
    // present in the visible header set. Falls back to appending so
    // a user who hid Next Steps still gets the button.
    const nextStepsIdx = mapped.findIndex(c => c.key === 'Next Steps');
    const withInfo = nextStepsIdx >= 0
      ? [...mapped.slice(0, nextStepsIdx), infoCol, ...mapped.slice(nextStepsIdx)]
      : [...mapped, infoCol];
    // Sequential 1..N display rank — ranks surviving opps by their
    // underlying `_id` (which is still assigned monotonically), so the
    // column always runs from 1 up over the current dataset rather than
    // exposing gaps from deleted rows. Lives leftmost (right after the
    // mass-edit checkbox when that's on). Non-sticky so the existing
    // sticky Account column still acts as the horizontal-scroll anchor.
    const oppNumCol = {
      key: '_oppNum',
      label: 'Opp #',
      defaultWidth: 70,
      getFilterValue: (row) => String(oppNumberById.get(row._id) ?? ''),
      getSortValue: (row) => oppNumberById.get(row._id) ?? 0,
      // The number lives in a derived map keyed by `_id`, not under the
      // column's key, so DataTable's default export (which reads
      // `row[col.key]`) would emit blanks. Map it through explicitly.
      exportValue: (row) => oppNumberById.get(row._id) ?? '',
      render: (row) => (
        <span style={{ fontVariantNumeric: 'tabular-nums', color: '#475569' }}>
          {oppNumberById.get(row._id) ?? ''}
        </span>
      ),
    };
    return massEditOn
      ? [selectCol, oppNumCol, ...withInfo, actions]
      : [oppNumCol, ...withInfo, actions];
  }, [headers, columnLinks, listRegistry, updateOppField, deleteOppField, deleteOpp, companySuggestions, peOwnerSuggestions, prospects, updateProspect, hubspotContacts, selectedIds, pricingOptionServices, optionLinks, massEditOn, oppNumberById, filteredRowIds]);

  const CLOSED_STAGES = useMemo(() => new Set(['Sold', 'Not Sold']), []);

  // Rows the current Date / Status / Show / Hide-history filters allow.
  // Always computed so `hiddenByFilterCount` stays accurate even when
  // the Show-hidden toggle is on.
  const filteredByActiveFilters = useMemo(() => {
    const fromTs = dateFrom ? Date.parse(dateFrom) : null;
    const toTs = dateTo ? Date.parse(dateTo) + 86399999 : null;
    return records.filter(r => {
      // History gate runs first so it short-circuits before the more
      // expensive date / stage checks for the bulk of dormant rows.
      if (hideHistory && resolveCallIn(r) == null) return false;
      if (fromTs != null || toTs != null) {
        const raw = r['Start Date'];
        const ts = raw ? Date.parse(raw) : NaN;
        if (isNaN(ts)) return false;
        if (fromTs != null && ts < fromTs) return false;
        if (toTs != null && ts > toTs) return false;
      }
      if (statusFilter !== 'all' && (r['Status'] || '').trim() !== statusFilter) return false;
      const stage = (r['Stage'] || '').trim();
      if (activityFilter === 'active' && CLOSED_STAGES.has(stage)) return false;
      if (activityFilter === 'closed' && !CLOSED_STAGES.has(stage)) return false;
      return true;
    });
  }, [records, dateFrom, dateTo, statusFilter, activityFilter, hideHistory, CLOSED_STAGES]);

  // Standalone count of rows the Hide-history gate is suppressing, so
  // the toggle button can show "Show history (N)" without depending on
  // the rest of the filter chain.
  const historyCount = useMemo(
    () => records.reduce((n, r) => n + (resolveCallIn(r) == null ? 1 : 0), 0),
    [records],
  );

  // When the user clicks "Show hidden", bypass the active filters and
  // surface every row — the filter inputs are left untouched so a
  // second click returns to the filtered view. Aggregates (stage
  // chips, service breakdown) follow the same source so the page
  // reflects whatever the table is showing.
  const hiddenByFilterCount = records.length - filteredByActiveFilters.length;
  const prefiltered = showHiddenByFilter ? records : filteredByActiveFilters;

  // Global search across every column on each record — see OppsView for
  // the same shape. Trims + lowercases the term so the value the user
  // typed lines up with the stored cell text.
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const searched = !term ? prefiltered : prefiltered.filter(r =>
      Object.values(r).some(v => v != null && v !== '' && String(v).toLowerCase().includes(term))
    );
    if (showOnlySelected && selectedIds.size > 0) {
      return searched.filter(r => selectedIds.has(r._id));
    }
    return searched;
  }, [prefiltered, search, showOnlySelected, selectedIds]);

  // Mass Edit → "Email table": the selected opps to feed the preview/copy
  // modal (which lets the user pick columns and copies a plain bordered
  // table). Null when closed.
  const [emailTableRecords, setEmailTableRecords] = useState(null);
  const handleEmailTable = useCallback(() => {
    const recs = dataRef.current?.records || [];
    const byId = new Map(recs.map(r => [r._id, r]));
    // Keep the current table (filtered) order; append any selected rows
    // that aren't in the current view (e.g. filtered out after selecting).
    const ordered = [];
    const seen = new Set();
    for (const r of filtered) {
      if (selectedIds.has(r._id) && byId.has(r._id)) { ordered.push(byId.get(r._id)); seen.add(r._id); }
    }
    for (const id of selectedIds) {
      if (!seen.has(id) && byId.has(id)) ordered.push(byId.get(id));
    }
    if (ordered.length === 0) return;
    setEmailTableRecords(ordered);
  }, [filtered, selectedIds]);

  // "New Opps" subtab: actively-working opps that are progressing quickly —
  // a BFO Opportunity Name is set, the current Stage is Lead/Qualifying/
  // Quoting (so never "Not Started"), and the combined time across those
  // three stages is at most NEW_OPPS_MAX_STAGE_AGE_DAYS days. Freshest
  // (lowest combined age) first. Mirrors filterNewOpps in
  // api/_lib/newOpps.js so the on-screen list matches the emailed file.
  const newOpps = useMemo(() => {
    return records
      .map(r => ({ r, age: combinedActiveStageAge(r) }))
      .filter(({ r, age }) => {
        const stage = String(r['Stage'] || '').trim();
        if (!NEW_OPPS_ACTIVE_STAGES_SET.has(stage)) return false;
        if (bfoFieldMissing(r['BFO Link'])) return false;
        return age <= NEW_OPPS_MAX_STAGE_AGE_DAYS;
      })
      .sort((a, b) =>
        a.age - b.age || String(a.r['Account'] || '').localeCompare(String(b.r['Account'] || '')))
      .map(({ r }) => r);
  }, [records]);

  // The New Opps subtab + emailed digest share one focused column set, in
  // canonical report order. Keys missing from this dataset's headers (e.g.
  // "BFO Address" on a default-headers install) still get a minimal column
  // def so the BFO fields always show on the subtab and stay pickable for
  // the emailed table.
  const newOppsColumns = useMemo(
    () => NEW_OPPS_REPORT_COLUMNS.map(key =>
      columns.find(c => c.key === key) || {
        key,
        label: headerLabel(key),
        defaultWidth: key === 'BFO Address' ? 260 : 160,
      }
    ),
    [columns]
  );

  // SE-branded (Schneider green) Excel of the new opps shown, mirroring the
  // server-built file the scheduled email attaches.
  const handleExportNewOpps = useCallback(async () => {
    if (newOpps.length === 0) return;
    const { Workbook } = await import('exceljs');
    const SE_GREEN_DARK = 'FF009530';
    const SE_GREEN_LIGHT = 'FFE6F7EC';
    const SE_GREEN = 'FF3DCD58';
    const cols = NEW_OPPS_REPORT_COLUMNS
      .map(key => newOppsColumns.find(c => c.key === key))
      .filter(Boolean);
    const wb = new Workbook();
    wb.creator = 'Schneider Electric · Prospect Tracker';
    wb.created = new Date();
    const ws = wb.addWorksheet('New Opps', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }],
    });
    ws.columns = cols.map(c => ({ width: Math.min(Math.max(String(c.label).length + 4, 16), 40) }));

    ws.mergeCells(1, 1, 1, cols.length);
    const title = ws.getCell(1, 1);
    title.value = `New Opportunities · ${newOpps.length} opp${newOpps.length === 1 ? '' : 's'}`;
    title.font = { name: 'Nunito Sans', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
    title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(1).height = 28;
    ws.getRow(2).height = 6;

    const headerRow = ws.getRow(3);
    cols.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = col.label;
      cell.font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: SE_GREEN_DARK } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      cell.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
    });
    headerRow.height = 22;

    newOpps.forEach((r, idx) => {
      const row = ws.getRow(4 + idx);
      cols.forEach((col, i) => {
        const cell = row.getCell(i + 1);
        cell.value = r[col.key] ?? '';
        cell.font = { name: 'Nunito Sans', size: 10 };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: false };
        if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6FCF8' } };
      });
      row.height = 18;
    });
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: cols.length } };

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `new-opps-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [newOpps, newOppsColumns]);

  const serviceBreakdown = useMemo(() => {
    // The breakdown only shows on the "By Service" tab. Skipping the
    // O(N×services) work while the Opportunities tab is active shaves
    // a noticeable chunk off the first render with large datasets.
    if (activeTab !== 'services') return { rows: [], total: prefiltered.length };
    const stats = {};
    const totalOpps = prefiltered.length;
    for (const r of prefiltered) {
      const raw = (r['Scope'] || '').trim();
      const cleaned = raw && raw !== '-' && raw !== '#N/A' ? raw : '';
      const services = cleaned
        ? cleaned.split(',').map(s => s.trim()).filter(Boolean)
        : ['(Unspecified)'];
      const stage = (r['Stage'] || '').trim();
      const isWin = stage === 'Sold';
      const isLoss = stage === 'Not Sold';
      const seen = new Set();
      for (const s of services) {
        if (seen.has(s)) continue;
        seen.add(s);
        if (!stats[s]) stats[s] = { total: 0, wins: 0, losses: 0 };
        stats[s].total += 1;
        if (isWin) stats[s].wins += 1;
        else if (isLoss) stats[s].losses += 1;
      }
    }
    const rows = Object.entries(stats)
      .map(([scope, s]) => {
        const decided = s.wins + s.losses;
        return {
          scope,
          count: s.total,
          wins: s.wins,
          winRate: decided > 0 ? (s.wins / decided) * 100 : null,
          percent: totalOpps > 0 ? (s.total / totalOpps) * 100 : 0,
        };
      })
      .sort((a, b) => b.count - a.count);
    return { rows, total: totalOpps };
  }, [prefiltered, activeTab]);

  const filtersActive = !!(dateFrom || dateTo || statusFilter !== 'all' || activityFilter !== 'all');
  const clearFilters = () => {
    setDateFrom(''); setDateTo(''); setStatusFilter('all'); setActivityFilter('all');
  };

  // Rows for the Days-in-Stage tab. Reads `_stageEnteredAt` (stamped by
  // updateOppField when Stage flips) and falls back to Start Date so
  // pre-existing opps that have never had a stage change still
  // contribute something instead of showing blank. Sorted descending by
  // days so the longest-stalling opps lead the list.
  const stageDaysRows = useMemo(() => {
    if (activeTab !== 'stageDays') return [];
    const rows = [];
    for (const r of records) {
      const stage = String(r['Stage'] || '').trim();
      if (!TRACKED_STAGES_SET.has(stage)) continue;
      // Mirror the Opportunities tab's history gate — opps with no
      // Call In aren't on a callback schedule, so they shouldn't crowd
      // the kanban either.
      if (resolveCallIn(r) == null) continue;
      // Pull-through opps follow a parent sale, so keep them off the board.
      if (PULL_THROUGH_RE.test(String(r['Scope'] || ''))) continue;
      const enteredISO = toISODate(r._stageEnteredAt) || toISODate(r['Start Date']);
      const days = enteredISO ? -daysFromToday(enteredISO) : null;
      const scope = String(r['Scope'] ?? '').trim();
      rows.push({
        id: r._id,
        Account: r['Account'] || '',
        Stage: stage,
        days,
        enteredAt: enteredISO || '',
        startDate: toISODate(r['Start Date']) || '',
        scope: scope && scope !== '-' && scope !== '#N/A' ? scope : '',
        _hasExplicitEntry: !!toISODate(r._stageEnteredAt),
        ignoreStall: !!r._ignoreStallFlag,
      });
    }
    rows.sort((a, b) => {
      // Null days (no Start Date either) settle at the bottom so the
      // top of the list always shows real numbers.
      if (a.days == null && b.days == null) return 0;
      if (a.days == null) return 1;
      if (b.days == null) return -1;
      return b.days - a.days;
    });
    return rows;
  }, [activeTab, records]);

  // Group Days-in-Stage rows by stage so the Kanban view can render one
  // column per stage with its cards stacked beneath. stageDaysRows is
  // pre-sorted descending by days, so each bucket's order falls out for
  // free — longest-stalling firms lead each column.
  const stageDaysByStage = useMemo(() => {
    const map = new Map(TRACKED_STAGES.map(s => [s, []]));
    for (const r of stageDaysRows) {
      if (map.has(r.Stage)) map.get(r.Stage).push(r);
    }
    return map;
  }, [stageDaysRows]);

  // Rows for the Stage History tab. Same gate as the Days-in-Stage tab
  // so the two tabs cover the same set of opps. For each row we sum
  // historical days per TRACKED_STAGE from `_stageHistory` (an opp can
  // revisit a stage, in which case its entries add up) and add the
  // live days-so-far against the row's current stage. Rows that haven't
  // moved stages since this feature shipped will only have a value in
  // their current-stage column — that's expected (we can only report
  // history we've actually captured).
  const stageHistoryRows = useMemo(() => {
    if (activeTab !== 'stageHistory') return [];
    const rows = [];
    for (const r of records) {
      const stage = String(r['Stage'] || '').trim();
      if (!TRACKED_STAGES_SET.has(stage)) continue;
      if (resolveCallIn(r) == null) continue;
      const daysByStage = Object.fromEntries(TRACKED_STAGES.map(s => [s, 0]));
      const visited = new Set();
      for (const h of (Array.isArray(r._stageHistory) ? r._stageHistory : [])) {
        const s = String(h?.stage || '').trim();
        if (!TRACKED_STAGES_SET.has(s)) continue;
        const d = Number(h?.days);
        if (!Number.isFinite(d) || d < 0) continue;
        daysByStage[s] += d;
        visited.add(s);
      }
      const enteredISO = toISODate(r._stageEnteredAt) || toISODate(r['Start Date']);
      const currentDays = enteredISO ? Math.max(0, -daysFromToday(enteredISO)) : null;
      if (currentDays != null) {
        daysByStage[stage] += currentDays;
        visited.add(stage);
      }
      const total = TRACKED_STAGES.reduce((s, k) => s + (daysByStage[k] || 0), 0);
      const scope = String(r['Scope'] ?? '').trim();
      rows.push({
        id: r._id,
        Account: r['Account'] || '',
        Scope: scope && scope !== '-' && scope !== '#N/A' ? scope : '',
        currentStage: stage,
        daysByStage,
        visitedStages: visited,
        total,
      });
    }
    rows.sort((a, b) => b.total - a.total || a.Account.localeCompare(b.Account));
    return rows;
  }, [activeTab, records]);

  const stageHistoryColumns = useMemo(() => {
    const num = (v) => (typeof v === 'number' && v > 0) ? v : '';
    const numCell = (v) => (
      <div style={{ textAlign: 'right' }}>{num(v)}</div>
    );
    const cols = [
      { key: 'Account', label: 'Account', defaultWidth: 220 },
      { key: 'Scope', label: 'Scope', defaultWidth: 180 },
      { key: 'currentStage', label: 'Current Stage', defaultWidth: 140 },
    ];
    for (const stage of TRACKED_STAGES) {
      cols.push({
        key: `stage:${stage}`,
        label: stage,
        defaultWidth: 110,
        getSortValue: (row) => row.daysByStage?.[stage] || 0,
        render: (row) => numCell(row.daysByStage?.[stage]),
      });
    }
    cols.push({
      key: 'total',
      label: 'Total days',
      defaultWidth: 110,
      getSortValue: (row) => row.total || 0,
      render: (row) => <div style={{ textAlign: 'right', fontWeight: 600 }}>{num(row.total)}</div>,
    });
    return cols;
  }, []);

  const servicesColumns = useMemo(() => [
    { key: 'scope', label: 'Service (Scope)', defaultWidth: 260 },
    {
      key: 'wins',
      label: 'Wins',
      defaultWidth: 90,
      render: (row) => <div style={{ textAlign: 'right' }}>{row.wins}</div>,
    },
    {
      key: 'winRate',
      label: 'Win Rate',
      defaultWidth: 110,
      render: (row) => (
        <div style={{ textAlign: 'right' }}>
          {row.winRate == null ? '—' : `${row.winRate.toFixed(1)}%`}
        </div>
      ),
    },
    {
      key: 'percent',
      label: '% of Total',
      defaultWidth: 220,
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ minWidth: '48px', textAlign: 'right' }}>{row.percent.toFixed(1)}%</span>
          <div className={styles.serviceBar} style={{ flex: 1 }}>
            <div className={styles.serviceBarFill} style={{ width: `${row.percent}%` }} />
          </div>
        </div>
      ),
    },
    {
      key: 'count',
      label: 'Total Opps',
      defaultWidth: 110,
      render: (row) => (
        <div style={{ textAlign: 'right', fontWeight: 600 }}>{row.count}</div>
      ),
    },
    {
      key: '_actions',
      label: '',
      defaultWidth: 90,
      render: (row) => (
        <button
          className={styles.hideServiceBtn}
          onClick={(e) => { e.stopPropagation(); toggleHideService(row.scope); }}
          title={row._hidden ? 'Unhide service' : 'Hide service'}
        >
          {row._hidden ? 'Unhide' : 'Hide'}
        </button>
      ),
    },
  ], [toggleHideService]);

  // Leads grouped by Source for the "By Source" tab, scoped to the
  // tab's own Start Date range. Mirrors serviceBreakdown's shape
  // (count / wins / win rate / % of total) but keyed on the Source
  // field and computed off every record rather than `prefiltered`, so
  // the time-range filter here is the only thing narrowing the set.
  // Map a record to its normalised Source bucket. Shared by the summary
  // table and the click-through drilldown so the two never disagree on
  // which opp belongs to which source.
  const sourceKeyOf = useCallback((r) => {
    const raw = (r['Source'] || '').trim();
    const cleaned = raw && raw !== '-' && raw !== '#N/A' ? raw : '';
    return cleaned || '(Unspecified)';
  }, []);

  // Apply the "By Source" tab's own Start Date range + activity filter to
  // a single record. Returns true when the opp should be counted.
  const sourceRowMatches = useCallback((r) => {
    const fromTs = sourceFrom ? Date.parse(sourceFrom) : null;
    const toTs = sourceTo ? Date.parse(sourceTo) + 86399999 : null;
    if (fromTs != null || toTs != null) {
      const raw = r['Start Date'];
      const ts = raw ? Date.parse(raw) : NaN;
      if (isNaN(ts)) return false;
      if (fromTs != null && ts < fromTs) return false;
      if (toTs != null && ts > toTs) return false;
    }
    const stage = (r['Stage'] || '').trim();
    // Activity filter: 'active' drops closed (Sold / Not Sold) opps,
    // 'closed' keeps only those, 'all' keeps everything.
    if (sourceActivityFilter === 'active' && CLOSED_STAGES.has(stage)) return false;
    if (sourceActivityFilter === 'closed' && !CLOSED_STAGES.has(stage)) return false;
    return true;
  }, [sourceFrom, sourceTo, sourceActivityFilter, CLOSED_STAGES]);

  const sourceBreakdown = useMemo(() => {
    if (activeTab !== 'bySource') return { rows: [], total: 0 };
    const stats = {};
    let total = 0;
    for (const r of records) {
      if (!sourceRowMatches(r)) continue;
      const stage = (r['Stage'] || '').trim();
      const source = sourceKeyOf(r);
      if (!stats[source]) stats[source] = { total: 0, wins: 0, losses: 0 };
      stats[source].total += 1;
      if (stage === 'Sold') stats[source].wins += 1;
      else if (stage === 'Not Sold') stats[source].losses += 1;
      total += 1;
    }
    const rows = Object.entries(stats)
      .map(([source, s]) => {
        const decided = s.wins + s.losses;
        return {
          source,
          count: s.total,
          wins: s.wins,
          winRate: decided > 0 ? (s.wins / decided) * 100 : null,
          percent: total > 0 ? (s.total / total) * 100 : 0,
        };
      })
      .sort((a, b) => b.count - a.count);
    return { rows, total };
  }, [activeTab, records, sourceRowMatches, sourceKeyOf]);

  // The opps behind the source the user clicked in the summary table.
  // Scoped to the same filters so the count matches the row they clicked.
  const sourceDrillRows = useMemo(() => {
    if (!sourceDrillDown) return [];
    return records
      .filter(r => sourceRowMatches(r) && sourceKeyOf(r) === sourceDrillDown)
      .sort((a, b) => {
        const ta = a['Start Date'] ? Date.parse(a['Start Date']) : NaN;
        const tb = b['Start Date'] ? Date.parse(b['Start Date']) : NaN;
        if (isNaN(ta) && isNaN(tb)) return 0;
        if (isNaN(ta)) return 1;
        if (isNaN(tb)) return -1;
        return tb - ta;
      });
  }, [sourceDrillDown, records, sourceRowMatches, sourceKeyOf]);

  const sourceColumns = useMemo(() => [
    {
      key: 'source',
      label: 'Source',
      defaultWidth: 240,
      render: (row) => (
        <span style={{ color: 'var(--color-link, #2563EB)', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
          {row.source}
        </span>
      ),
    },
    {
      key: 'count',
      label: 'Leads',
      defaultWidth: 90,
      render: (row) => <div style={{ textAlign: 'right', fontWeight: 600 }}>{row.count}</div>,
    },
    {
      key: 'wins',
      label: 'Wins',
      defaultWidth: 90,
      render: (row) => <div style={{ textAlign: 'right' }}>{row.wins}</div>,
    },
    {
      key: 'winRate',
      label: 'Win Rate',
      defaultWidth: 110,
      render: (row) => (
        <div style={{ textAlign: 'right' }}>
          {row.winRate == null ? '—' : `${row.winRate.toFixed(1)}%`}
        </div>
      ),
    },
    {
      key: 'percent',
      label: '% of Total',
      defaultWidth: 220,
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ minWidth: '48px', textAlign: 'right' }}>{row.percent.toFixed(1)}%</span>
          <div className={styles.serviceBar} style={{ flex: 1 }}>
            <div className={styles.serviceBarFill} style={{ width: `${row.percent}%` }} />
          </div>
        </div>
      ),
    },
  ], []);

  return (
    <div className={styles.wrapper}>
      {syncError && (
        <div className={styles.syncBanner} role="alert" aria-live="assertive">
          <span>
            <strong>⚠ Cloud sync failed — your changes are saved on this device only.</strong>{' '}
            Other devices may show older data, and these edits will be lost if
            you clear this browser. Check your connection and Firestore access,
            then retry.
            {syncErrorDetail && (
              <><br /><span className={styles.syncBannerDetail}>Reason: {syncErrorDetail}</span></>
            )}
            <br />
            <span className={styles.syncBannerDetail}>
              {lastSyncedAt
                ? `Last successful cloud sync: ${new Date(lastSyncedAt).toLocaleTimeString()}.`
                : 'No successful cloud sync yet this session.'}
            </span>
          </span>
          <button
            type="button"
            className={styles.syncBannerRetry}
            onClick={retrySync}
            disabled={retryingSync}
          >
            {retryingSync ? 'Retrying…' : 'Retry now'}
          </button>
        </div>
      )}
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Opps</h2>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <AddCompanyCombobox
            suggestions={companySuggestions}
            onCommit={(name) => setPendingNewOpp({ account: name })}
          />
          <button
            type="button"
            onClick={() => setLinkModalOpen(true)}
            style={{
              padding: '0.45rem 0.85rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text)', cursor: 'pointer',
            }}
            title="Bind columns to Dropdowns-tab lists"
          >Link columns</button>
          <button
            type="button"
            onClick={importFromOppsTab}
            disabled={importingFromOpps}
            style={{
              padding: '0.45rem 0.85rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text)', cursor: importingFromOpps ? 'progress' : 'pointer',
            }}
            title="One-time copy of every row from the Opps - Old tab cache that isn't already on Opps"
          >{importingFromOpps ? 'Importing…' : 'Import from Opps - Old tab'}</button>
          <button
            type="button"
            onClick={() => setBulkImportOpen(true)}
            style={{
              padding: '0.45rem 0.85rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text)', cursor: 'pointer',
            }}
            title="Paste data from a Google Sheet with the same columns and review the mapping before importing"
          >Bulk import</button>
          <button
            type="button"
            onClick={() => setNfatScheduleOpen(true)}
            style={{
              padding: '0.45rem 0.85rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text)', cursor: 'pointer',
            }}
            title="Schedule automatic clears of the No Further Action Today column (✓ / ✗ / any), or clear now"
          >Clear No Further Action</button>
          <button
            type="button"
            onClick={undoLastChange}
            disabled={!undoStack.length}
            style={{
              padding: '0.45rem 0.85rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)', fontWeight: 600, fontFamily: 'inherit',
              color: undoStack.length ? 'var(--color-text)' : 'var(--color-text-muted)',
              cursor: undoStack.length ? 'pointer' : 'not-allowed',
              opacity: undoStack.length ? 1 : 0.6,
            }}
            title={undoStack.length
              ? `Undo last change (${undoStack.length} in history) — Ctrl/Cmd+Z`
              : 'No recent changes to undo'}
          >↶ Undo</button>
          <button className={styles.syncBtn} onClick={() => setPendingNewOpp({})}>+ New Opp</button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {linkModalOpen && (
        <LinkColumnsModal
          headers={headers}
          columnLinks={columnLinks}
          defaultLinks={DEFAULT_COLUMN_LINKS}
          listRegistry={listRegistry}
          availableLists={availableLists}
          onChange={updateColumnLinks}
          onClose={() => setLinkModalOpen(false)}
        />
      )}

      {bulkImportOpen && (
        <BulkImportModal
          existingHeaders={data?.headers?.length ? data.headers : DEFAULT_HEADERS}
          existingRecords={data?.records || []}
          dedupKeyFor={oppDedupKeyForImport}
          onClose={() => setBulkImportOpen(false)}
          onImport={commitBulkImport}
        />
      )}

      {nfatScheduleOpen && (
        <NfatScheduleModal
          schedules={nfatSchedules}
          onSave={saveNfatSchedules}
          onClearNow={clearNfat}
          onClose={() => setNfatScheduleOpen(false)}
        />
      )}

      {pendingNewOpp && (
        <NewOppModal
          account={pendingNewOpp.account}
          sourceOptions={listRegistry.get('source')?.options || []}
          companySuggestions={companySuggestions}
          peOwnerSuggestions={peOwnerSuggestions}
          prospects={prospects}
          onCreate={({ company, source, peOwner, type, frameworks, frameworksEdited, addToTableView }) => {
            // Create the company on Table View first (when requested and
            // it isn't there yet) so the new opp's Account immediately
            // resolves to a real prospect record. addProspect is
            // idempotent by company name, so a race that re-adds an
            // existing company is harmless.
            if (addToTableView && company && addProspect) {
              try {
                Promise.resolve(addProspect({ company, peOwner: peOwner || '', type: type || '', frameworks: frameworksEdited ? frameworks : [] }))
                  .catch(err => console.error('opps2: add company to Table View failed', err));
              } catch (err) {
                console.error('opps2: add company to Table View failed', err);
              }
            } else if (company && updateProspect) {
              // Existing Table View company: the modal prefilled Type and
              // Frameworks from its record, so a different value here is a
              // reviewed correction — persist it back to the prospect.
              const matched = findProspectForAccount(company, prospects);
              if (matched) {
                const updates = {};
                if (type !== String(matched.type || '').trim()) updates.type = type;
                if (frameworksEdited) updates.frameworks = frameworks;
                if (Object.keys(updates).length) {
                  Promise.resolve(updateProspect(matched.id, updates))
                    .catch(err => console.error('opps2: update company failed', err));
                }
              }
            }
            addNewOpp(company, source, peOwner);
            setPendingNewOpp(null);
          }}
          onCancel={() => setPendingNewOpp(null)}
        />
      )}

      {notSoldPromptId != null && (() => {
        const opp = records.find(r => r._id === notSoldPromptId);
        if (!opp) return null;
        return (
          <NotSoldFollowUpModal
            opp={opp}
            reasonOptions={listRegistry.get('reasonNotSold')?.options || []}
            onSave={({ closeDate, reason, finalMargin }) => {
              // Only push fields whose value actually changed so the
              // undo stack stays uncluttered with no-op snapshots.
              if (closeDate !== (toISODate(opp['Close Date']) || '')) {
                updateOppField(opp._id, 'Close Date', closeDate);
              }
              if (reason !== String(opp['Reason Not Sold'] ?? '')) {
                updateOppField(opp._id, 'Reason Not Sold', reason);
              }
              if (finalMargin !== String(opp['Final Margin'] ?? '').trim()) {
                updateOppField(opp._id, 'Final Margin', finalMargin);
              }
              setNotSoldPromptId(null);
            }}
            onClose={() => setNotSoldPromptId(null)}
          />
        );
      })()}

      {soldPromptId != null && (() => {
        const opp = records.find(r => r._id === soldPromptId);
        if (!opp) return null;
        return (
          <SoldFollowUpModal
            opp={opp}
            reasonOptions={listRegistry.get('reasonNotSold')?.options || []}
            competitionOptions={listRegistry.get('competition')?.options || []}
            onSave={({ reason, finalMargin, competition }) => {
              // Only push fields whose value actually changed so the
              // undo stack stays uncluttered with no-op snapshots.
              if (reason !== String(opp['Reason Not Sold'] ?? '')) {
                updateOppField(opp._id, 'Reason Not Sold', reason);
              }
              if (finalMargin !== String(opp['Final Margin'] ?? '').trim()) {
                updateOppField(opp._id, 'Final Margin', finalMargin);
              }
              if (competition !== String(opp['Competition'] ?? '').trim()) {
                updateOppField(opp._id, 'Competition', competition);
              }
              setSoldPromptId(null);
            }}
            onClose={() => setSoldPromptId(null)}
          />
        );
      })()}

      {leadQuotedPromptId != null && (() => {
        const opp = records.find(r => r._id === leadQuotedPromptId);
        if (!opp) return null;
        return (
          <LeadQuotedAmountModal
            opp={opp}
            onSave={({ quotedAmount }) => {
              // Only push when the value actually changed so the undo
              // stack stays uncluttered with no-op snapshots.
              if (quotedAmount !== String(opp['Quoted Amount'] ?? '').trim()) {
                updateOppField(opp._id, 'Quoted Amount', quotedAmount);
              }
              setLeadQuotedPromptId(null);
            }}
            onClose={() => setLeadQuotedPromptId(null)}
          />
        );
      })()}

      {quotedPromptId != null && (() => {
        const opp = records.find(r => r._id === quotedPromptId);
        if (!opp) return null;
        return (
          <QuotedFollowUpModal
            opp={opp}
            chanceOptions={listRegistry.get('chance')?.options || []}
            onSave={({ quotedOn, chance, marginReviewDate }) => {
              // Only push fields whose value actually changed so the
              // undo stack stays uncluttered with no-op snapshots.
              const curQuotedOn = toISODate(opp['Quoted On'] ?? opp['Quoted Date']) || '';
              if (quotedOn !== curQuotedOn) {
                updateOppField(opp._id, 'Quoted On', quotedOn);
              }
              if (chance !== String(opp['Chance?'] ?? opp['Chance'] ?? '')) {
                updateOppField(opp._id, 'Chance?', chance);
              }
              const curMarginReview = toISODate(
                opp['Margin Email Date - Sales Leader Review Date']
                ?? opp['Margin Email Date'] ?? opp['Sales Leader Review Date']
              ) || '';
              if (marginReviewDate !== curMarginReview) {
                updateOppField(opp._id, 'Margin Email Date - Sales Leader Review Date', marginReviewDate);
              }
              setQuotedPromptId(null);
            }}
            onClose={() => setQuotedPromptId(null)}
          />
        );
      })()}

      {followUpStatusPromptId != null && (() => {
        const opp = records.find(r => r._id === followUpStatusPromptId);
        if (!opp) return null;
        const link = resolveColumnLink('Status', columnLinks);
        const statusOpts = (link && listRegistry.get(link.listKey)?.options) || [];
        return (
          <FollowUpStatusModal
            opp={opp}
            statusOptions={statusOpts}
            onSave={({ status, nextSteps, nextStepsWaiting, salesPartner }) => {
              if (status !== String(opp['Status'] ?? '')) {
                updateOppField(opp._id, 'Status', status);
              }
              if (nextSteps !== String(opp['Next Steps'] ?? '')) {
                updateOppField(opp._id, 'Next Steps', nextSteps);
              }
              if (salesPartner !== String(opp['Sales Partner'] ?? '').trim()) {
                updateOppField(opp._id, 'Sales Partner', salesPartner);
              }
              const curWaiting = Array.isArray(opp._nextStepsWaiting) ? opp._nextStepsWaiting : [];
              if (JSON.stringify(nextStepsWaiting) !== JSON.stringify(curWaiting)) {
                updateOppField(opp._id, '_nextStepsWaiting', nextStepsWaiting);
              }
              setFollowUpStatusPromptId(null);
              setFollowUpStatusPrev(null);
              requestCallInSort();
            }}
            onClose={() => { setFollowUpStatusPromptId(null); setFollowUpStatusPrev(null); requestCallInSort(); }}
            onCancel={() => {
              revertFollowUpDate(opp._id, followUpStatusPrev);
              setFollowUpStatusPromptId(null);
              setFollowUpStatusPrev(null);
              requestCallInSort();
            }}
          />
        );
      })()}

      {sourceDrillDown != null && createPortal(
        <div
          onClick={() => setSourceDrillDown(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--color-surface, #fff)', color: 'var(--color-text)', borderRadius: 8, padding: '1.25rem', width: 'min(820px, 94vw)', maxHeight: '82vh', overflow: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem' }}>
                Source: {sourceDrillDown}
                <span style={{ marginLeft: 8, fontWeight: 400, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  {sourceDrillRows.length} opp{sourceDrillRows.length === 1 ? '' : 's'}
                </span>
              </h3>
              <button type="button" onClick={() => setSourceDrillDown(null)} style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'inherit' }}>×</button>
            </div>
            <p style={{ marginTop: 0, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              Opps in this source, matching the current date range and Show filter. Click a row to open its details.
            </p>
            {sourceDrillRows.length === 0 ? (
              <div style={{ padding: '1rem', color: 'var(--color-text-muted)' }}>No opps to display.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Account</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Contact</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Stage</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Scope</th>
                    <th style={{ padding: '0.4rem 0.5rem', whiteSpace: 'nowrap' }}>Start Date</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceDrillRows.map(r => (
                    <tr
                      key={r._id}
                      onClick={() => { setInfoOppId(r._id); setSourceDrillDown(null); }}
                      style={{ borderBottom: '1px solid var(--color-border)', cursor: 'pointer' }}
                    >
                      <td style={{ padding: '0.4rem 0.5rem', fontWeight: 600 }}>{r['Account'] || '—'}</td>
                      <td style={{ padding: '0.4rem 0.5rem' }}>{r['Contact'] || '—'}</td>
                      <td style={{ padding: '0.4rem 0.5rem' }}>{r['Stage'] || '—'}</td>
                      <td style={{ padding: '0.4rem 0.5rem' }}>{r['Scope'] || '—'}</td>
                      <td style={{ padding: '0.4rem 0.5rem', whiteSpace: 'nowrap' }}>{r['Start Date'] || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>,
        document.body
      )}

      {infoOppId != null && (() => {
        const opp = records.find(r => r._id === infoOppId);
        if (!opp) return null;
        // Splat in the computed values so the popup shows the same
        // numbers the table cells do without re-deriving them inside
        // the modal.
        const augmented = {
          ...opp,
          'Call In': (() => { const n = resolveCallIn(opp); return n == null ? '' : n; })(),
          'Last Spoke': (() => { const n = resolveLastSpoke(opp); return n == null ? '' : n; })(),
        };
        return (
          <OppInfoModal
            opp={augmented}
            headers={headers}
            onClose={() => setInfoOppId(null)}
            onDelete={deleteOpp}
            onFieldChange={(field, value) => updateOppField(opp._id, field, value)}
            columnLinks={columnLinks}
            listRegistry={listRegistry}
            companySuggestions={companySuggestions}
            peOwnerSuggestions={peOwnerSuggestions}
            prospects={prospects}
            updateProspect={updateProspect}
            hubspotContacts={hubspotContacts}
            pricingOptionServices={pricingOptionServices}
            pricingOptionLinkName={optionLinks[String(opp._id)] || ''}
            onOpenContact={openContactDetails}
            onOpenCompany={openCompanyDetails}
          />
        );
      })()}

      {nextStepsPopupId != null && (() => {
        const opp = records.find(r => r._id === nextStepsPopupId);
        if (!opp) return null;
        return (
          <NextStepsEditor
            key={opp._id}
            opp={opp}
            onClose={() => setNextStepsPopupId(null)}
            updateOppField={updateOppField}
          />
        );
      })()}

      {editingContact && (
        <ContactEditModal
          contact={editingContact}
          onSave={closeContactModal}
          onClose={() => setEditingContact(null)}
          contactNotes={settings?.contactNotes || {}}
          onSaveNote={saveContactNote}
          contactOldEmails={settings?.contactOldEmails || {}}
          onSaveOldEmails={saveContactOldEmails}
          contactNicknames={settings?.contactNicknames || {}}
          onSaveNickname={saveContactNickname}
          contactTeamNames={settings?.contactTeamNames || {}}
          onSaveTeamName={saveContactTeamName}
          contactReportsTo={settings?.contactReportsTo || {}}
          onSaveReportsTo={saveContactReportsTo}
          ccMap={settings?.ccMap || {}}
          onSaveCcMap={(m) => updateSettings({ ccMap: m })}
          toAlsoMap={settings?.toAlsoMap || {}}
          onSaveToAlsoMap={(m) => updateSettings({ toAlsoMap: m })}
          contactFamilies={settings?.contactFamilies || {}}
          onSaveFamily={saveContactFamily}
          contactMetInPerson={settings?.contactMetInPerson || {}}
          onSaveMetInPerson={saveContactMetInPerson}
          contactInvitedToLouisville={settings?.contactInvitedToLouisville || {}}
          onSaveInvitedToLouisville={saveContactInvitedToLouisville}
          events={settings?.events || []}
          onToggleContactEvent={(eventId, c) => updateSettings({ events: toggleContactInEvents(settings?.events || [], eventId, c) })}
          companyContacts={(hubspotContacts || []).filter(c => {
            const cCompany = String(c?.company || '').trim().toLowerCase();
            const tgt = String(editingContact?.company || '').trim().toLowerCase();
            return cCompany && tgt && cCompany === tgt;
          })}
          emailDomains={[]}
          companyNames={(prospects || []).map(p => p.company).filter(Boolean)}
        />
      )}

      <div className={styles.tabs}>
        <button
          className={activeTab === 'opps' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('opps')}
        >Opportunities</button>
        <button
          className={activeTab === 'newOpps' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('newOpps')}
        >New Opps{newOpps.length ? ` (${newOpps.length})` : ''}</button>
        <button
          className={activeTab === 'services' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('services')}
        >By Service</button>
        <button
          className={activeTab === 'bySource' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('bySource')}
        >By Source</button>
        <button
          className={activeTab === 'stageDays' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('stageDays')}
        >Days in Stage</button>
        <button
          className={activeTab === 'stageHistory' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('stageHistory')}
        >Stage History</button>
      </div>

      <div className={styles.filterRow}>
        {/* Start Date range + Status filters intentionally hidden — the
            underlying state stays at its no-op defaults (empty range,
            status "all") so nothing is filtered out. */}
        <label className={styles.filterLabel}>
          Show
          <select
            className={styles.filterInput}
            value={activityFilter}
            onChange={e => setActivityFilter(e.target.value)}
          >
            <option value="active">Active only</option>
            <option value="closed">Closed only</option>
            <option value="all">All</option>
          </select>
        </label>
        {filtersActive && (
          <button className={styles.clearFiltersBtn} onClick={clearFilters}>Clear filters</button>
        )}
        <button
          className={styles.clearFiltersBtn}
          onClick={() => setHideHistory(v => !v)}
          disabled={hideHistory && historyCount === 0}
          title={hideHistory
            ? 'Rows with no Call In number are hidden as history. Click to include them.'
            : 'Hide rows with no Call In number — they aren’t on a callback schedule.'}
        >
          {hideHistory
            ? `Show history${historyCount ? ` (${historyCount})` : ''}`
            : 'Hide history'}
        </button>
        <button
          className={styles.clearFiltersBtn}
          onClick={() => setShowHiddenByFilter(v => !v)}
          disabled={!showHiddenByFilter && hiddenByFilterCount === 0}
          title={showHiddenByFilter
            ? 'Re-apply the Date / Status / Show filters above.'
            : hiddenByFilterCount > 0
              ? 'Temporarily reveal every row hidden by the current filters without changing the filter inputs.'
              : 'No rows are currently hidden by the Date / Status / Show filters.'}
        >
          {showHiddenByFilter
            ? 'Re-apply filters'
            : `Show hidden${hiddenByFilterCount ? ` (${hiddenByFilterCount})` : ''}`}
        </button>
      </div>

      {activeTab === 'opps' && (
        <>
          <div className={styles.searchRow}>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Search across all columns (Account, Stage, Scope, Notes, BFO Address, …)"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <span className={styles.resultCount}>{filtered.length} of {prefiltered.length}{filtersActive && prefiltered.length !== records.length ? ` (filtered from ${records.length})` : ''}</span>
            <button
              type="button"
              onClick={() => {
                setMassEditOn(on => {
                  // Leaving mass-edit mode clears any in-flight
                  // selection so the bulk toolbar disappears and the
                  // next time the user re-enters they start fresh.
                  if (on) setSelectedIds(new Set());
                  return !on;
                });
              }}
              title={massEditOn
                ? 'Hide the selection checkboxes and exit mass-edit mode.'
                : 'Show selection checkboxes so you can pick multiple rows to edit at once.'}
              style={{
                marginLeft: '0.5rem',
                padding: '0.3rem 0.7rem',
                fontSize: '0.78rem',
                fontWeight: 600,
                fontFamily: 'inherit',
                color: massEditOn ? '#fff' : '#1E3A8A',
                background: massEditOn ? '#2563EB' : '#fff',
                border: `1px solid ${massEditOn ? '#2563EB' : '#93C5FD'}`,
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >{massEditOn ? 'Exit Mass Edit' : 'Mass Edit'}</button>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setShowOnlySelected(v => !v)}
                title={showOnlySelected
                  ? 'Show every row again. Your selection is kept.'
                  : 'Hide every row that isn\'t currently selected.'}
                style={{
                  marginLeft: '0.5rem',
                  padding: '0.3rem 0.7rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  color: showOnlySelected ? '#fff' : '#166534',
                  background: showOnlySelected ? '#16A34A' : '#fff',
                  border: `1px solid ${showOnlySelected ? '#16A34A' : '#86EFAC'}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >{showOnlySelected ? `Showing ${selectedIds.size} selected — Show all` : `Show ${selectedIds.size} selected only`}</button>
            )}
          </div>

          {massEditOn && selectedIds.size > 0 && (
            <MassEditBar
              selectedCount={selectedIds.size}
              headers={headers}
              columnLinks={columnLinks}
              listRegistry={listRegistry}
              onApply={(field, value) => updateManyOppFields(selectedIds, field, value)}
              onDelete={() => deleteManyOpps(selectedIds)}
              onClear={() => setSelectedIds(new Set())}
              onEmailTable={handleEmailTable}
            />
          )}

          {loading && !data ? (
            <div className={styles.loading}>Loading...</div>
          ) : (
            <DataTable
              tableId="opps2"
              columns={columns}
              rows={filtered}
              sortSignal={callInSortSignal}
              alwaysVisible={['Account', '_select', '_info']}
              // No default sort — editing Follow Up / Last Client Heard From
              // Us would otherwise re-rank rows by Call In on every keystroke
              // and yank the row out from under the cursor. The Call In
              // header click still toggles a manual sort when the user
              // actually wants to triage by urgency.
              enableColumnFilters
              onFilteredRowsChange={handleFilteredRowsChange}
              emptyMessage="No opps yet — click + New Opp to create one."
              settings={settings}
              updateSettings={updateSettings}
              // Notes / Next Steps can grow taller via Alt+Enter newlines,
              // so the fixed-rowHeight virtualization spacers misalign and
              // the user ends up scrolled into a "ghost" zone with no
              // rendered rows. variableRowHeight renders every row and lets
              // content-visibility handle off-screen perf.
              variableRowHeight
              rowStyle={(row) => {
                // Tint closed opps so the table reads at a glance —
                // light green for wins, light red for losses. Rows the
                // user has marked "No Further Action Today" go light
                // grey ("Yes") or light yellow ("No" / X) and win
                // against the stage tint so today's do-nothing rows
                // visibly recede. The style also lands on every <td>
                // (including the sticky Account column) so the row
                // is solidly coloured edge to edge.
                const nfat = String(row?.['No Further Action Today'] || '').trim().toLowerCase();
                if (nfat === 'yes') return { background: '#E5E7EB' };
                if (nfat === 'no') return { background: '#FEF9C3' };
                const stage = String(row?.Stage || '').trim();
                if (stage === 'Sold') return { background: '#DCFCE7' };
                if (stage === 'Not Sold') return { background: '#FEE2E2' };
                return undefined;
              }}
            />
          )}
        </>
      )}

      {activeTab === 'newOpps' && (
        <>
          <div className={styles.searchRow}>
            <span className={styles.resultCount}>
              {newOpps.length} active opp{newOpps.length === 1 ? '' : 's'} (≤ {NEW_OPPS_MAX_STAGE_AGE_DAYS} days in Lead/Qualifying/Quoting)
            </span>
            <button
              type="button"
              onClick={handleExportNewOpps}
              disabled={newOpps.length === 0}
              title={newOpps.length ? 'Download these new opps as an SE-formatted Excel file' : 'No new opps to export'}
              style={{
                marginLeft: '0.5rem', padding: '0.3rem 0.7rem', fontSize: '0.78rem', fontWeight: 600,
                fontFamily: 'inherit', color: newOpps.length ? '#fff' : '#94A3B8',
                background: newOpps.length ? '#009530' : '#E2E8F0',
                border: `1px solid ${newOpps.length ? '#009530' : '#CBD5E1'}`,
                borderRadius: 6, cursor: newOpps.length ? 'pointer' : 'not-allowed',
              }}
            >Export to Excel</button>
            <button
              type="button"
              onClick={() => downloadNewOppsOutlookDraft(newOpps, {
                // To / subject / greeting use the util's defaults
                // (keith.mchugh@se.com, "Dan B New Opportunities",
                // "Hey Keith,"). Signature is the same one the Draft
                // Email tab appends: the saved settings.emailSignature,
                // falling back to the bundled default for the admin.
                signature: settings?.emailSignature || (isAdmin ? DEFAULT_EMAIL_SIGNATURE : ''),
              })}
              disabled={newOpps.length === 0}
              title={newOpps.length
                ? 'Download an Outlook draft (.eml) of this email — open it in Outlook to review and send it yourself'
                : 'No new opps to draft'}
              style={{
                marginLeft: '0.5rem', padding: '0.3rem 0.7rem', fontSize: '0.78rem', fontWeight: 600,
                fontFamily: 'inherit', color: newOpps.length ? '#0F6CBD' : '#94A3B8',
                background: '#fff',
                border: `1px solid ${newOpps.length ? '#0F6CBD' : '#CBD5E1'}`,
                borderRadius: 6, cursor: newOpps.length ? 'pointer' : 'not-allowed',
              }}
            >Download Outlook draft</button>
            <button
              type="button"
              onClick={() => setNewOppsScheduleOpen(true)}
              title="Schedule a recurring email that sends these new opps as a table in the email body"
              style={{
                marginLeft: '0.5rem', padding: '0.3rem 0.7rem', fontSize: '0.78rem', fontWeight: 600,
                fontFamily: 'inherit', color: '#009530', background: '#fff',
                border: '1px solid #009530', borderRadius: 6, cursor: 'pointer',
              }}
            >Schedule email</button>
          </div>
          <div style={{ padding: '0 0 0.5rem', fontSize: '0.72rem', color: '#64748B' }}>
            Shows opps with a BFO Opportunity Name whose current stage is Lead, Qualifying, or Quoting and whose combined time across those stages is ≤ {NEW_OPPS_MAX_STAGE_AGE_DAYS} days.
          </div>
          {loading && !data ? (
            <div className={styles.loading}>Loading...</div>
          ) : (
            <DataTable
              tableId="opps2-new"
              columns={newOppsColumns}
              rows={newOpps}
              alwaysVisible={['Account']}
              enableColumnFilters
              variableRowHeight
              emptyMessage={`No active opps within ${NEW_OPPS_MAX_STAGE_AGE_DAYS} days in Lead/Qualifying/Quoting.`}
              settings={settings}
              updateSettings={updateSettings}
            />
          )}
        </>
      )}

      <NewOppsScheduleModal
        open={newOppsScheduleOpen}
        onClose={() => setNewOppsScheduleOpen(false)}
        uid={user?.uid}
        email={user?.email}
        oppsRows={newOpps}
      />

      {emailTableRecords && (
        <EmailTableModal
          records={emailTableRecords}
          signature={settings?.emailSignature || (isAdmin ? DEFAULT_EMAIL_SIGNATURE : '')}
          onClose={() => setEmailTableRecords(null)}
        />
      )}

      {activeTab === 'services' && (
        <>
          <div className={styles.searchRow}>
            <span className={styles.resultCount}>
              {(() => {
                const visibleCount = serviceBreakdown.rows.filter(r => showHidden || !hiddenServices.has(r.scope)).length;
                return `${visibleCount} service${visibleCount === 1 ? '' : 's'} · ${serviceBreakdown.total} total opps`;
              })()}
            </span>
            {hiddenServices.size > 0 && (
              <label className={styles.showHiddenLabel}>
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={e => setShowHidden(e.target.checked)}
                />
                Show {hiddenServices.size} hidden
              </label>
            )}
          </div>
          <DataTable
            tableId="opps2-services"
            columns={servicesColumns}
            rows={serviceBreakdown.rows
              .filter(r => showHidden || !hiddenServices.has(r.scope))
              .map(r => ({ ...r, id: r.scope, _hidden: hiddenServices.has(r.scope) }))}
            alwaysVisible={['scope']}
            rowStyle={(row) => row._hidden ? { opacity: 0.5 } : undefined}
            emptyMessage="No services to display."
            settings={settings}
            updateSettings={updateSettings}
          />
        </>
      )}

      {activeTab === 'bySource' && (
        <>
          <div className={styles.searchRow}>
            <label className={styles.filterLabel}>
              From
              <input
                type="date"
                className={styles.filterInput}
                value={sourceFrom}
                max={sourceTo || undefined}
                onChange={e => setSourceFrom(e.target.value)}
              />
            </label>
            <label className={styles.filterLabel}>
              To
              <input
                type="date"
                className={styles.filterInput}
                value={sourceTo}
                min={sourceFrom || undefined}
                onChange={e => setSourceTo(e.target.value)}
              />
            </label>
            <label className={styles.filterLabel}>
              Show
              <select
                className={styles.filterInput}
                value={sourceActivityFilter}
                onChange={e => setSourceActivityFilter(e.target.value)}
              >
                <option value="active">Active only</option>
                <option value="closed">Closed only</option>
                <option value="all">All</option>
              </select>
            </label>
            {(sourceFrom || sourceTo || sourceActivityFilter !== 'active') && (
              <button
                className={styles.clearFiltersBtn}
                onClick={() => { setSourceFrom(''); setSourceTo(''); setSourceActivityFilter('active'); }}
              >Clear filters</button>
            )}
            <span className={styles.resultCount}>
              {sourceBreakdown.rows.length} source{sourceBreakdown.rows.length === 1 ? '' : 's'} · {sourceBreakdown.total} {sourceActivityFilter === 'active' ? 'active ' : sourceActivityFilter === 'closed' ? 'closed ' : ''}lead{sourceBreakdown.total === 1 ? '' : 's'}
              {(sourceFrom || sourceTo) ? ' in range' : ''} · click a source to see its opps
            </span>
          </div>
          <DataTable
            tableId="opps2-source"
            columns={sourceColumns}
            rows={sourceBreakdown.rows.map(r => ({ ...r, id: r.source }))}
            alwaysVisible={['source']}
            emptyMessage="No leads to display for this time range."
            onRowClick={(row) => setSourceDrillDown(row.source)}
            settings={settings}
            updateSettings={updateSettings}
          />
        </>
      )}

      {activeTab === 'stageDays' && (
        <>
          <div className={styles.searchRow}>
            <label className={styles.showHiddenLabel}>
              <input
                type="checkbox"
                checked={hideNotStarted}
                onChange={e => setHideNotStarted(e.target.checked)}
              />
              Hide Not Started ({(stageDaysByStage.get('Not Started') || []).length})
            </label>
            <span style={{ fontSize: '0.72rem', color: '#B45309', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{
                width: 10, height: 10, borderRadius: 2,
                background: '#FEF3C7', border: '1px solid #FCD34D', display: 'inline-block',
              }} />
              ⚠ flagged = stalled past its stage limit (hover for the suggested move)
            </span>
          </div>
          <div style={{
            display: 'flex', gap: 12, overflowX: 'auto',
            padding: '12px 0', alignItems: 'flex-start',
          }}>
            {TRACKED_STAGES.filter(s => !(hideNotStarted && s === 'Not Started')).map(stage => {
              const items = stageDaysByStage.get(stage) || [];
              return (
                <div key={stage} style={{
                  flex: '0 0 220px', width: 220,
                  background: '#F1F5F9', borderRadius: 6, padding: 8,
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'baseline',
                    justifyContent: 'space-between',
                    padding: '2px 4px 6px',
                    borderBottom: '1px solid #CBD5E1',
                  }}>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{stage}</span>
                    <span style={{ fontSize: '0.72rem', color: '#64748B' }}>{items.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {items.length === 0 ? (
                      <div style={{
                        color: '#94A3B8', fontSize: '0.72rem',
                        textAlign: 'center', padding: '8px 0',
                      }}>—</div>
                    ) : items.map(row => {
                      const dayBadgeTitle = row.enteredAt
                        ? `Stage entered ${formatDateDisplay(row.enteredAt)}${row._hasExplicitEntry ? '' : ' (fallback to Start Date)'}`
                        : 'No entry date recorded.';
                      // Flagged opps (stalled past the stage's limit) stay
                      // in the same column but render in amber, with the
                      // suggested move on the card and in the hover — so
                      // the board doubles as the "needs action" list. Opps
                      // the user ignored on the Opps tab don't flag here.
                      const action = row.ignoreStall ? null : stageActionFor(row.Stage, row.days);
                      // Account-name hover surfaces the row's Scope so
                      // the kanban reads like a triage board — no need
                      // to bounce back to the Opportunities tab to see
                      // what the opp is actually selling.
                      const accountTitle = action
                        ? `Stalled ${row.days}d (> ${action.days}d) → ${action.suggestion}${row.scope ? `\nScope: ${row.scope}` : ''}`
                        : (row.scope ? `Scope: ${row.scope}` : 'No scope set on this opp.');
                      return (
                        <div
                          key={row.id}
                          style={{
                            background: action ? '#FEF3C7' : '#FFFFFF', borderRadius: 4,
                            border: `1px solid ${action ? '#FCD34D' : '#E2E8F0'}`,
                            padding: '6px 8px',
                            display: 'flex', flexDirection: 'column', gap: 3,
                          }}
                        >
                          <div style={{
                            display: 'flex', alignItems: 'center',
                            justifyContent: 'space-between', gap: 8,
                          }}>
                            <span
                              title={accountTitle}
                              style={{
                                fontSize: '0.8rem', fontWeight: 500,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                minWidth: 0, cursor: 'help',
                              }}
                            >
                              {action && <span title="Stalled past its stage limit">⚠ </span>}
                              {row.Account || <span style={{ color: '#94A3B8' }}>(no account)</span>}
                            </span>
                            <span
                              title={dayBadgeTitle}
                              style={{
                                fontSize: '0.72rem', fontWeight: action ? 700 : 600,
                                color: action ? '#B45309' : (row.days != null && row.days > 30 ? '#DC2626' : '#475569'),
                                fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                              }}
                            >
                              {row.days == null ? '—' : `${row.days}d`}
                            </span>
                          </div>
                          {action && (
                            <span style={{
                              fontSize: '0.68rem', fontWeight: 600, color: '#B45309',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {action.suggestion}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {activeTab === 'stageHistory' && (
        <>
          <div className={styles.searchRow}>
            <span className={styles.resultCount}>
              {stageHistoryRows.length} opp{stageHistoryRows.length === 1 ? '' : 's'}
            </span>
            <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
              Per-stage days come from each Stage change you log. The current stage&rsquo;s
              column also includes the time since the last move. Opps that haven&rsquo;t
              moved stages yet will only have a value in their current-stage column.
            </span>
          </div>
          <DataTable
            tableId="opps2-stage-history"
            columns={stageHistoryColumns}
            rows={stageHistoryRows}
            alwaysVisible={['Account']}
            emptyMessage="No tracked opps to show."
            settings={settings}
            updateSettings={updateSettings}
          />
        </>
      )}
    </div>
  );
}
