import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { DataTable } from '../common/DataTable';
import { DateCell } from '../common/DateCell';
import {
  buildListRegistry,
  buildAvailableLists,
  resolveColumnLink,
  SelectCell,
  MultiSelectCell,
  LinkColumnsModal,
} from '../common/columnLinks';
import { getEffectiveDropdownLists } from '../../utils/dropdownListsStore';
import { loadDealsList, saveDealsOverride, clearDealsOverride, DEALS_LIST_EVENT } from '../../utils/dealsStore';
import { loadCommissions, COMMISSIONS_LIST_EVENT } from '../../utils/commissionsStore';
import { DEAL_IGNORED_KEY } from '../../utils/postSaleFollowUp';
import { HANDOFF_FIELDS, isFilled, isHandoffFieldDone } from '../../utils/dealHandoff';
import { loadOpps2Newest } from '../../utils/opps2Store';
import {
  loadSoldWarningIgnore, setSoldWarningIgnore, clearSoldWarningIgnore,
  SOLD_WARNING_IGNORE_EVENT,
  loadSoldWarningCollapsed,
  setSoldWarningCollapsed,
} from '../../utils/soldWarningIgnore';
import { DEAL_BFO_KEY, normBfo, indexCommissionsByBfo, dealTrackStatus, isDealTrackHealthy } from '../../utils/dealCommissions';
import {
  indexOppYear1ByBfo, oppYear1ForDeal, planOppYear1Fills,
  DEAL_SETUP_KEY, DEAL_RECURRING_KEY,
} from '../../utils/dealOppYear1';
import {
  asNumber, asDate, fmtCurrency, fmtPercent, fmtDate,
  DEAL_CURRENCY_KEYS, DEAL_DATE_KEYS, DEAL_PERCENT_KEYS, DEAL_CHECK_KEYS,
} from '../../utils/dealsFormat';
import { matchesCdm } from '../../utils/cdmMatch';
import { suggestClients, exactClientMatch } from '../../utils/clientSuggest';
import { STATUSES } from '../../data/enums';
import {
  loadDealClientMap, setDealClientMapping,
  loadDealClientIgnore, setDealClientIgnore,
  bulkSetDealClientIgnore, bulkSetDealClientMapping,
  DEALS_CLIENT_MAP_EVENT,
} from '../../utils/dealClientMap';
import { PasteImportModal } from './PasteImportModal';
import { planDealPaste, describeDealPaste } from '../../utils/dealsPasteMerge';
import { DealCommissionBreakdownModal } from './DealCommissionBreakdownModal';
import { DealHistoryModal } from './DealHistoryModal';

const MAPPED_COL_KEY = '__mappedToClient__';
const MAPPED_COL_LABEL = 'Mapped to Client';
const STATUS_COL_KEY = '__clientStatus__';
const STATUS_COL_LABEL = 'Client Status';
const PROGRESS_COL_KEY = '__progress__';
const PROGRESS_COL_LABEL = 'Progress';
// Per-deal flag (truthy → ignored). Lives on the deal row alongside
// other cell values so it persists through the same dealsStore path
// as everything else. Double-underscore prefix keeps it out of the
// generated column list (buildColumns filters those out).
//
// Defined in utils/postSaleFollowUp now that the Issues page, the Pipeline
// table and the Clients subtab all honour it too — ignoring a deal here
// stops it being chased there.
const PROGRESS_IGNORED_KEY = DEAL_IGNORED_KEY;

// The "ready to invoice" handoff fields the user wants to see at a
// glance on every deal. Defined in utils/dealHandoff now that the Issues
// page flags a deal with an outstanding item too; DealsView imports the
// list back so the two tabs can't drift apart on what the checklist is.
const PROGRESS_FIELDS = HANDOFF_FIELDS;

function normClient(s) { return String(s || '').toLowerCase().trim(); }

// Days/Paid on stores a per-row "hide" flag under a double-underscore
// key so the column is filtered out of the visible header set but the
// value still round-trips through the regular dealsStore.
const DAYS_PAID_ON_HIDDEN_KEY = '__daysPaidOnHidden';

// The Deal column that holds the BFO opportunity name. Labeled
// "BFO opp name" everywhere user-facing; the underlying key is the
// long string the user originally pasted from their tracker. The BFO
// matching helpers (DEAL_BFO_KEY / normBfo / indexCommissionsByBfo) live
// in utils/dealCommissions so the YOY Commissions chart can reuse them.

// Whole-day delta between a Due Date cell and today. Returns null when
// the cell can't be parsed as a date. Both sides are flattened to local
// midnight so the value doesn't drift around DST transitions.
function daysUntilDue(dueRaw) {
  const d = asDate(dueRaw);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

// The effective Days/Paid on value for a row — null when the cell is
// hidden, the deal is fully paid, or the Due Date is missing/unparseable.
// Shared by the cell renderer, the column sort, and the Revenue Recorded /
// Paid to Date "grey until overdue" coloring so all three stay in sync.
function effectiveDaysPaidOn(row) {
  if (isFilled(row[DAYS_PAID_ON_HIDDEN_KEY])) return null;
  const commStatus = String(row['Comm Status'] ?? '').trim().toLowerCase();
  if (commStatus === 'fully paid') return null;
  return daysUntilDue(row['Due Date']);
}

// Custom renderer for the "Days/Paid on" column. Shows the computed
// days-until-due delta from the row's Due Date, with a small × button
// that suppresses the value for this row (stored on __daysPaidOnHidden)
// and a ↻ to restore it.
function DaysPaidOnCell({ row }) {
  const hidden = isFilled(row[DAYS_PAID_ON_HIDDEN_KEY]);
  const onUpdate = row.__onUpdate;

  // Once a deal is marked Fully Paid, the days-until-due delta is no
  // longer meaningful — collapse the cell to blank so it doesn't keep
  // counting down (or showing "overdue") against a closed-out deal.
  const commStatus = String(row['Comm Status'] ?? '').trim().toLowerCase();
  if (commStatus === 'fully paid') {
    return <span />;
  }

  if (hidden) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%' }}>
        <span style={{ color: 'var(--color-text-muted)', flex: 1 }}>-</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onUpdate?.(row.id, DAYS_PAID_ON_HIDDEN_KEY, ''); }}
          title="Restore the computed days-until-due value"
          style={{ background: 'transparent', border: '1px solid var(--color-border)', color: '#475569', cursor: 'pointer', fontSize: '0.7rem', padding: '0 6px', borderRadius: 4, fontFamily: 'inherit', lineHeight: 1.4 }}
        >↻</button>
      </span>
    );
  }

  const delta = daysUntilDue(row['Due Date']);
  if (delta == null) {
    return <span style={{ color: 'var(--color-text-muted)' }}>-</span>;
  }

  const color = delta < 0 ? '#B91C1C' : delta <= 7 ? '#92400E' : '#0F172A';
  const label = delta === 0 ? 'Due today'
    : delta > 0 ? `${delta}d`
    : `${Math.abs(delta)}d overdue`;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%' }}>
      <span style={{ flex: 1, color, fontVariantNumeric: 'tabular-nums' }}>{label}</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onUpdate?.(row.id, DAYS_PAID_ON_HIDDEN_KEY, '1'); }}
        title="Hide the days-until-due value for this deal"
        style={{ background: 'transparent', border: '1px solid var(--color-border)', color: '#94A3B8', cursor: 'pointer', fontSize: '0.7rem', padding: '0 6px', borderRadius: 4, fontFamily: 'inherit', lineHeight: 1 }}
      >×</button>
    </span>
  );
}

// Editable cell wrapper. Renders the column's normal display until the
// user double-clicks, then swaps to an input typed to match the
// column kind: date picker for date fields, number for currency /
// percent / numeric, plain text otherwise (including Yes/No fields,
// which often need free-text values like "N/A" or "Pending" beyond
// the boolean default). Saves on Enter / blur, cancels on Escape.
// New rows auto-focus the first editable cell so the user can start
// typing immediately.
function EditableCell({ value, kind, render, onSave, autoFocus, listId, hoverTitle }) {
  // Dates edit as plain text in the same M/D/YYYY shape the cell shows,
  // so users can type the short form directly and copy/paste it like
  // any other text. asDate(...) handles parsing on save.
  const toDraft = (v) => {
    if (kind === 'date') return v == null || v === '' ? '' : fmtDate(v);
    return v == null ? '' : String(v);
  };
  const [editing, setEditing] = useState(!!autoFocus);
  const [draft, setDraft] = useState(toDraft(value));
  useEffect(() => {
    if (!editing) setDraft(kind === 'date'
      ? (value == null || value === '' ? '' : fmtDate(value))
      : (value == null ? '' : String(value)));
  }, [value, editing, kind]);

  function commit(next) {
    const v = next == null ? '' : String(next);
    onSave(v);
    setEditing(false);
  }
  function cancel() {
    setDraft(toDraft(value));
    setEditing(false);
  }

  if (!editing) {
    // hoverTitle lets a column override the default "Double-click to
    // edit" hint with the cell's actual content — handy for narrow
    // columns (e.g. Agreement Name) where the text often gets clipped.
    return (
      <span
        onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
        title={hoverTitle || 'Double-click to edit'}
        style={{ display: 'inline-block', width: '100%', cursor: 'text' }}
      >
        {render(value)}
      </span>
    );
  }

  const inputType = (kind === 'currency' || kind === 'percent' || kind === 'number') ? 'number'
    : 'text';
  return (
    <input
      autoFocus
      type={inputType}
      value={draft}
      step={inputType === 'number' ? 'any' : undefined}
      list={listId}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(draft); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
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

// Inline free-text editor used in the Progress popover for fields
// that aren't bound to a Dropdowns list. Holds a local draft so
// typing is instant; the parent learns about the change only when
// the user blurs or hits Enter (Escape reverts).
function ProgressTextEditor({ value, onCommit }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => { setDraft(value == null ? '' : String(value)); }, [value]);

  function commit() {
    const trimmed = draft.trim();
    const prev = String(value ?? '').trim();
    if (trimmed === prev) return;
    onCommit(trimmed);
  }

  return (
    <input
      type="text"
      value={draft}
      placeholder="-"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(value == null ? '' : String(value));
          e.currentTarget.blur();
        }
      }}
      style={{
        width: '100%', boxSizing: 'border-box',
        padding: '3px 6px',
        border: '1px solid var(--color-border)', borderRadius: 4,
        fontSize: '0.72rem', fontFamily: 'inherit',
        color: 'var(--color-text)', background: '#fff',
      }}
    />
  );
}

// One row inside the Progress popover. Picks the right editor based
// on whether the user has linked this column to a Dropdowns list
// (Single / Multi select) or left it as free text.
function ProgressPopoverRow({ row, field, columnLinks, listRegistry, onSave }) {
  const raw = row[field.key];
  const filled = isHandoffFieldDone(row, field);
  const link = resolveColumnLink(field.key, columnLinks);
  const onChange = (v) => onSave?.(row.id, field.key, v);

  let editor;
  if (field.yesno) {
    editor = <SelectCell value={raw} onChange={onChange} options={['Yes', 'No']} />;
  } else if (link) {
    const opts = listRegistry?.get(link.listKey)?.options || [];
    editor = link.mode === 'multi'
      ? <MultiSelectCell value={raw} onChange={onChange} options={opts} />
      : <SelectCell value={raw} onChange={onChange} options={opts} />;
  } else {
    editor = <ProgressTextEditor value={raw} onCommit={onChange} />;
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.75rem' }}>
      <span
        title={filled ? 'Has a value' : 'Empty'}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: 4, border: '1px solid', borderColor: filled ? '#16A34A' : '#CBD5E1', background: filled ? '#16A34A' : '#fff', color: '#fff', fontSize: '0.65rem', fontWeight: 700, flexShrink: 0 }}
      >
        {filled ? '✓' : ''}
      </span>
      {field.href ? (
        <a
          href={field.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{ flex: 1, fontSize: '0.72rem', color: '#2563EB', textDecoration: 'underline', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={`${field.label}: open the Service Desk ticket form in a new tab`}
        >{field.label}</a>
      ) : (
        <span style={{ flex: 1, fontSize: '0.72rem', color: filled ? '#1E293B' : '#475569', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={field.label}>{field.label}</span>
      )}
      <div style={{ flex: '0 0 130px', minWidth: 0 }}>
        {editor}
      </div>
    </div>
  );
}

// Browser-native <datalist> ID for the Client Name autocomplete on
// the Deals tab. The datalist itself is rendered once at DealsView
// scope and shared by every Client Name cell that's in edit mode.
const CLIENT_NAME_LIST_ID = 'deals-client-name-suggestions';

// Cell renderer for the leading "Progress" column. Shows a compact
// X/4 pill colored by completion; click opens a popover with a small
// editor per handoff field — a Dropdowns-list picker when the column
// is linked, free-text otherwise. Saves go through the same updateCell
// path as the regular table cells.
function ProgressCell({ row, columnLinks, listRegistry, onSave, onDelete }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const btnRef = useRef(null);

  const ignored = isFilled(row[PROGRESS_IGNORED_KEY]);
  const done = PROGRESS_FIELDS.filter(f => isHandoffFieldDone(row, f)).length;
  const total = PROGRESS_FIELDS.length;
  const pct = total === 0 ? 0 : done / total;
  // Greyed-out pill when the user has opted this deal out of the
  // handoff tally. Otherwise the regular red/yellow/green progress
  // colors based on completion ratio.
  const bg = ignored ? '#F1F5F9' : pct === 1 ? '#DCFCE7' : pct === 0 ? '#FEE2E2' : '#FEF3C7';
  const fg = ignored ? '#94A3B8' : pct === 1 ? '#166534' : pct === 0 ? '#991B1B' : '#92400E';

  function openPopover(e) {
    e.stopPropagation();
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) { setOpen(true); return; }
    // Keep the popover on-screen: prefer opening below the pill, but
    // flip above when the row is near the bottom of the viewport and
    // there's more room overhead. Either way cap maxHeight so the body
    // scrolls inside the panel instead of bleeding off the page.
    const margin = 8;
    const viewportH = window.innerHeight || document.documentElement.clientHeight;
    const spaceBelow = viewportH - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const estimatedH = 420;
    const placeAbove = spaceBelow < estimatedH && spaceAbove > spaceBelow;
    const available = Math.max(180, placeAbove ? spaceAbove : spaceBelow);
    const top = placeAbove
      ? Math.max(margin, rect.top - margin - Math.min(estimatedH, spaceAbove))
      : rect.bottom + 4;
    setAnchor({
      left: rect.left,
      top,
      width: Math.max(rect.width, 320),
      maxHeight: available,
    });
    setOpen(true);
  }

  function toggleIgnore() {
    onSave?.(row.id, PROGRESS_IGNORED_KEY, ignored ? '' : '1');
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openPopover}
        title={ignored
          ? 'Ignored: this deal is opted out of the handoff tally. Click to edit.'
          : `${done} of ${total} handoff fields complete: click to edit`}
        style={{ padding: '2px 10px', border: '1px solid', borderColor: fg, borderRadius: 999, background: bg, color: fg, fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', minWidth: 56, textDecoration: ignored ? 'line-through' : 'none', opacity: ignored ? 0.85 : 1 }}
      >
        {done}/{total}{pct === 1 && !ignored ? ' ✓' : ''}
      </button>
      {open && createPortal(
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 4999, background: 'transparent' }}
          />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', left: anchor?.left ?? 0, top: anchor?.top ?? 0, width: anchor?.width ?? 320, maxWidth: 'calc(100vw - 16px)', maxHeight: anchor?.maxHeight ?? undefined, zIndex: 5000, background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.18)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F8FAFC', flex: '0 0 auto' }}>
              <strong style={{ fontSize: '0.75rem', color: '#1E293B' }}>
                Handoff progress · {ignored ? 'Ignored' : `${done}/${total}`}
              </strong>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 4px' }}
                aria-label="Close"
              >×</button>
            </div>
            <div style={{ padding: '0.25rem 0', flex: '1 1 auto', overflowY: 'auto', minHeight: 0 }}>
              {PROGRESS_FIELDS.map(f => (
                <ProgressPopoverRow
                  key={f.key}
                  row={row}
                  field={f}
                  columnLinks={columnLinks}
                  listRegistry={listRegistry}
                  onSave={onSave}
                />
              ))}
            </div>
            {onSave && (
              <div style={{ padding: '0.4rem 0.75rem', borderTop: '1px solid #E2E8F0', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flex: '0 0 auto' }}>
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', fontSize: '0.7rem', color: '#475569' }}
                  title="Don't count this deal in the X/N tally: its pill shows greyed-out."
                >
                  <input
                    type="checkbox"
                    checked={ignored}
                    onChange={toggleIgnore}
                    style={{ margin: 0, cursor: 'pointer' }}
                  />
                  <span>Ignore this deal{ignored ? '' : `: grey out the X/${PROGRESS_FIELDS.length}`}</span>
                </label>
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      const label = String(row['Client Name'] || '').trim() || 'this deal';
                      if (window.confirm(`Delete ${label}? This can't be undone.`)) {
                        onDelete(row.id);
                        setOpen(false);
                      }
                    }}
                    title="Remove this deal row from the tracker"
                    style={{
                      padding: '0.25rem 0.55rem',
                      background: 'transparent',
                      border: '1px solid #FCA5A5', borderRadius: 4,
                      color: '#B91C1C', fontSize: '0.7rem', fontWeight: 600,
                      fontFamily: 'inherit', cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >Delete deal</button>
                )}
              </div>
            )}
            {!onSave && (
              <div style={{ padding: '0.4rem 0.75rem', borderTop: '1px solid #E2E8F0', fontSize: '0.65rem', color: '#94A3B8', fontStyle: 'italic', flex: '0 0 auto' }}>
                Read-only: editing requires the inline-edit deploy.
              </div>
            )}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

// Color scheme for the per-deal Client Status pill. Matches the style
// used in ClientsView so the same status reads the same across views.
function statusPillStyle(status) {
  const s = normClient(status);
  if (s === 'client') return { background: '#DCFCE7', color: '#166534' };
  if (s === 'old client') return { background: '#F1F5F9', color: '#64748B' };
  if (s === 'prospect') return { background: '#DBEAFE', color: '#1E40AF' };
  if (s === 'lost - not sold' || s === 'lost') return { background: '#FEE2E2', color: '#991B1B' };
  if (s === 'hold off') return { background: '#FEF3C7', color: '#92400E' };
  return { background: '#F1F5F9', color: '#475569' };
}

// The ⚠ shown on a Client Name that matches no company in the Table
// View roster. Clicking it opens a small popover with a one-click
// "Add to Table View" button (plus a Status picker that defaults to
// Client, since a deal implies an active relationship, and stamps the
// current CDM so the new company lands as the user's account). Adding
// goes through the shared, idempotent addProspect — a double-click
// can't mint a duplicate — and once the company lands in Table View
// the roster updates and this warning clears on its own. An "Ignore"
// link drops the name into the same per-name ignore set the Mapped to
// Client column uses, for names that shouldn't ever be added.
function ClientNameWarning({ name, cdmName, onAdd, onIgnore }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const [status, setStatus] = useState('Client');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const btnRef = useRef(null);

  function openPopover(e) {
    e.stopPropagation();
    setError(null);
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const margin = 8;
      const width = 260;
      const estimatedH = 190;
      const viewportH = window.innerHeight || document.documentElement.clientHeight;
      const spaceBelow = viewportH - rect.bottom - margin;
      const placeAbove = spaceBelow < estimatedH && rect.top > spaceBelow;
      setAnchor({
        left: Math.max(margin, rect.right - width),
        top: placeAbove
          ? Math.max(margin, rect.top - margin - estimatedH)
          : rect.bottom + 4,
        width,
      });
    }
    setOpen(true);
  }

  async function handleAdd() {
    if (busy || !onAdd) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd({ company: name, status: status || 'Client', cdm: cdmName || '' });
      setOpen(false);
    } catch (err) {
      setError(err?.message || 'Could not add the company. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openPopover}
        onDoubleClick={(e) => e.stopPropagation()}
        title={`"${name}" isn't a company in Table View: click to add it`}
        style={{ flex: '0 0 auto', background: 'transparent', border: 'none', color: '#B45309', fontSize: '0.85rem', lineHeight: 1, cursor: 'pointer', padding: 0 }}
      >⚠</button>
      {open && createPortal(
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 4999, background: 'transparent' }}
          />
          <div
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', left: anchor?.left ?? 0, top: anchor?.top ?? 0, width: anchor?.width ?? 260, maxWidth: 'calc(100vw - 16px)', zIndex: 5000, background: '#fff', border: '1px solid #FCD34D', borderRadius: 8, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.18)', padding: '0.6rem 0.7rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
          >
            <div style={{ fontSize: '0.72rem', color: '#92400E', lineHeight: 1.35 }}>
              <strong>{name}</strong> isn&apos;t a company in Table View.
            </div>
            {onAdd ? (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', color: '#475569' }}>
                  <span style={{ flex: '0 0 auto' }}>Status</span>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    style={{ flex: 1, minWidth: 0, padding: '0.2rem 0.3rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.7rem', fontFamily: 'inherit', background: '#fff', color: '#1E293B' }}
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={busy}
                  style={{ padding: '0.35rem 0.6rem', border: '1px solid #16A34A', background: busy ? '#86EFAC' : '#16A34A', color: '#fff', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit', cursor: busy ? 'default' : 'pointer' }}
                >{busy ? 'Adding…' : '+ Add to Table View'}</button>
              </>
            ) : (
              <div style={{ fontSize: '0.68rem', color: '#94A3B8', fontStyle: 'italic' }}>
                Adding companies isn&apos;t available here.
              </div>
            )}
            {error && <div style={{ fontSize: '0.68rem', color: '#B91C1C' }}>{error}</div>}
            {onIgnore && (
              <button
                type="button"
                onClick={() => { onIgnore(name, true); setOpen(false); }}
                title="Stop warning about this name: it won't count against the unmapped tally either"
                style={{ padding: 0, background: 'none', border: 'none', color: '#64748B', textDecoration: 'underline', fontSize: '0.68rem', fontFamily: 'inherit', cursor: 'pointer', alignSelf: 'flex-start' }}
              >Ignore this name</button>
            )}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

// The picker the "Mapped to Client" cell opens: a type-to-search box
// over the client roster rather than a <select>. Two reasons it isn't
// a plain dropdown. The roster runs to 100+ names, so scrolling for
// one is slow and you have to know how the name was spelled on the
// Table View side to find it. And mounting a full <select> per
// unmapped row — 250 rows × 130 options — is 30k+ DOM nodes of
// dropdown, which alone can leave the table looking blank while the
// browser catches up. So the cell renders a tiny button until it's
// clicked, and the list that opens is filtered by what you type,
// ranked so prefix matches lead (see utils/clientSuggest).
//
// The list is portalled to the body: the table cell clips its
// overflow, and a dropdown that renders inside it would be cut off
// after two rows.
const SUGGEST_LIMIT = 50;

// Where the suggestion list goes for a cell at `rect`: under it
// normally, flipped above when the row sits near the bottom of the
// viewport, and never wider than the screen. Measured from the cell
// at the moment it's clicked — the input that replaces it occupies
// the same box — so the list has its position on first paint.
function suggestAnchor(rect) {
  const margin = 8;
  const wanted = 260;
  const width = Math.max(rect.width, 240);
  const viewportH = window.innerHeight || document.documentElement.clientHeight;
  const viewportW = window.innerWidth || document.documentElement.clientWidth;
  const spaceBelow = viewportH - rect.bottom - margin;
  const spaceAbove = rect.top - margin;
  const placeAbove = spaceBelow < wanted && spaceAbove > spaceBelow;
  return {
    left: Math.max(margin, Math.min(rect.left, viewportW - width - margin)),
    top: placeAbove
      ? Math.max(margin, rect.top - 4 - Math.min(wanted, spaceAbove))
      : rect.bottom + 4,
    width,
    maxHeight: Math.min(wanted, Math.max(120, placeAbove ? spaceAbove : spaceBelow)),
  };
}

function MappedClientPicker({ raw, manual, anchor, clientOptions, onChange, onClose }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef(null);

  const matches = useMemo(
    () => suggestClients(clientOptions, query, { limit: SUGGEST_LIMIT }),
    [clientOptions, query]
  );
  // "(Unmap)" only earns a row when there's a mapping to clear, and
  // only while the box is empty — once you're searching it's noise.
  const showUnmap = !!manual && !query.trim();
  const rows = showUnmap ? ['', ...matches] : matches;

  // Keep the highlighted row in view as the arrows walk past the fold.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="1"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, matches]);

  function commit(name) {
    onChange(raw, name);
    onClose();
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(i => (i + step + rows.length) % rows.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (rows.length === 0) return;
      commit(rows[Math.min(active, rows.length - 1)]);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      // Tabbing away commits what was typed only when it names an
      // option outright — a half-typed name is not a pick.
      const exact = exactClientMatch(clientOptions, query);
      if (exact) commit(exact); else onClose();
    }
  }

  const rowStyle = (isActive, muted) => ({
    display: 'block', width: '100%', textAlign: 'left',
    padding: '0.25rem 0.5rem', border: 'none',
    background: isActive ? '#EFF6FF' : 'transparent',
    color: muted ? '#64748B' : '#1E293B',
    fontSize: '0.7rem', fontFamily: 'inherit', fontStyle: muted ? 'italic' : 'normal',
    cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  });

  return (
    <>
      <input
        autoFocus
        type="text"
        value={query}
        placeholder={manual || 'Search clients…'}
        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        title="Type part of the client name — matches are ranked as you type"
        style={{
          width: '100%', padding: '0.2rem 0.3rem',
          border: '1px solid #3B82F6', borderRadius: 4,
          fontSize: '0.7rem', fontFamily: 'inherit', background: '#fff',
          color: '#1E293B', minWidth: 0,
        }}
      />
      {createPortal(
        <>
          <div
            onMouseDown={(e) => { e.preventDefault(); onClose(); }}
            style={{ position: 'fixed', inset: 0, zIndex: 4999, background: 'transparent' }}
          />
          <div
            ref={listRef}
            onMouseDown={(e) => e.preventDefault() /* keep focus in the input */}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed', left: anchor?.left ?? -9999, top: anchor?.top ?? -9999,
              width: anchor?.width ?? 240, maxWidth: 'calc(100vw - 16px)',
              maxHeight: anchor?.maxHeight ?? 260, overflowY: 'auto',
              zIndex: 5000, background: '#fff', border: '1px solid #CBD5E1',
              borderRadius: 6, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.18)',
              padding: '0.15rem 0',
            }}
          >
            {rows.length === 0 && (
              <div style={{ padding: '0.35rem 0.5rem', fontSize: '0.68rem', color: '#94A3B8', fontStyle: 'italic' }}>
                No client matches “{query.trim()}”
              </div>
            )}
            {rows.map((name, i) => (
              <button
                key={name || '__unmap__'}
                type="button"
                data-active={i === active ? '1' : '0'}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(name)}
                title={name || 'Clear this mapping'}
                style={rowStyle(i === active, !name)}
              >{name || '(Unmap)'}</button>
            ))}
            {matches.length >= SUGGEST_LIMIT && (
              <div style={{ padding: '0.3rem 0.5rem', fontSize: '0.62rem', color: '#94A3B8', borderTop: '1px solid #F1F5F9' }}>
                Showing the first {SUGGEST_LIMIT} — keep typing to narrow.
              </div>
            )}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

// Render the helper column as a lazy editor: a small button per cell
// that swaps for the search box above when clicked.
function MappedClientCell({ raw, manual, ignored, clientOptions, onChange, onToggleIgnore }) {
  // Non-null while the search box is open; carries the screen position
  // the suggestion list renders at, measured off the cell on click.
  const [openAt, setOpenAt] = useState(null);
  const btnRef = useRef(null);

  function openPicker(e) {
    e.stopPropagation();
    const rect = btnRef.current?.getBoundingClientRect();
    setOpenAt(rect ? suggestAnchor(rect) : {});
  }
  if (ignored) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, width: '100%' }}>
        <span style={{ flex: 1, padding: '1px 8px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: '#F1F5F9', color: '#64748B', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title="This source name is marked as ignored and won't count against the unmapped tally">
          ✕ Ignored
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleIgnore(raw, false); }}
          title="Restore this row to the unmapped list"
          style={{ padding: '0 6px', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', fontSize: '0.62rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >↺</button>
      </span>
    );
  }
  if (!openAt) {
    const label = manual || 'Map to client…';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, width: '100%' }}>
        <button
          ref={btnRef}
          type="button"
          onClick={openPicker}
          title={manual ? `Currently mapped to ${manual}. Click to change.` : 'Click to search for the matching client'}
          style={{
            flex: 1, minWidth: 0, padding: '0.2rem 0.4rem',
            border: '1px solid', borderColor: manual ? '#86EFAC' : '#FCD34D',
            borderRadius: 4, fontSize: '0.7rem', fontFamily: 'inherit',
            background: manual ? '#F0FDF4' : '#FFFBEB',
            color: manual ? '#166534' : '#92400E',
            textAlign: 'left', cursor: 'pointer',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >{label}</button>
        {!manual && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleIgnore(raw, true); }}
            title="Ignore this row: it won't count against the unmapped tally"
            style={{ padding: '0 6px', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >✕</button>
        )}
      </span>
    );
  }
  return (
    <MappedClientPicker
      raw={raw}
      manual={manual}
      anchor={openAt}
      clientOptions={clientOptions}
      onChange={onChange}
      onClose={() => setOpenAt(null)}
    />
  );
}

// Canonical ordered column list — these are the headers the Deals
// sub-tab is expected to surface from the user's client-tracker
// workbook. The first column ("Client Name") is sticky.
// Headers in incoming workbooks that should fold into a canonical column
// name. Lets older "Paperwork completed" exports and newer "Paperwork"
// exports both land in the same field, and surfaces the shorter labels
// the user uses on the Clients tab's contract drill-down.
const HEADER_ALIASES = {
  'paperwork': 'Paperwork completed',
  'billing letter': 'Billing information collected',
  'combined bfo': 'Combined',
};

const COLUMN_ORDER = [
  'Client Name',
  'Commission Sheet Sent to Kathy',
  'Paperwork completed',
  'Billing information collected',
  'Closed Won',
  'On Client Tracker?',
  'BFO - Close after contract execution email has been sent',
  'Agreement Name',
  'Current Term Start Date',
  'Original Contract Start',
  'Setup',
  'Recurring Revenue',
  'Commission',
  'Revenue Recorded',
  'Paid to Date',
  'Delta',
  'Currently being paid',
  'Ticket',
  'Comm Status',
  'Due Date',
  'Days/Paid on',
  'GM',
  'Payment Terms',
  'End Date',
  'Auto renewal?',
  'Esc',
  'Current Value',
  'SUCON?',
  'Comm Tracker?',
  'Comm Tracker?2',
  'Comm Tracker?3',
  'Comm Tracker?4',
  'Comm Tracker?5',
  'Comm Tracker?6',
  'Combined',
  'Combine Project Name',
  'Commission Rate',
  'Year',
  'Month',
  'Follow Up On Sale',
];

// The Year column is derived, not stored — it always shows the calendar
// year of the deal's Original Contract Start date so the two can't drift
// apart. Returns '' when that date is missing or unparseable.
function dealYear(row) {
  const d = asDate(row?.['Original Contract Start']);
  return d ? String(d.getFullYear()) : '';
}

function buildColumns(rows, columnLinks, listRegistry, commissionsByBfo) {
  if (!rows.length) return [];
  const keys = new Set();
  // Skip 'id' and any double-underscore internal field (__onUpdate,
  // __newRow, etc.) — those are render-time scaffolding, not data.
  for (const r of rows) for (const k of Object.keys(r)) {
    if (k === 'id' || k.startsWith('__')) continue;
    keys.add(k);
  }
  // Year is always present since it's computed from Original Contract
  // Start — surface the column even when no workbook cell populated it.
  keys.add('Year');
  // Empty new-row case: nothing in the data has populated keys yet
  // (the user just clicked New Deal on a clean slate). Seed with the
  // canonical lineup so they have somewhere to type instead of staring
  // at a zero-column table.
  if (keys.size === 0) for (const k of COLUMN_ORDER) keys.add(k);

  // Lay out canonical columns first, then any extras the workbook
  // brought along, so unexpected headers still render at the end.
  const ordered = [];
  for (const k of COLUMN_ORDER) if (keys.has(k)) ordered.push(k);
  for (const k of keys) if (!ordered.includes(k)) ordered.push(k);

  return ordered.map((k, i) => {
    const sticky = i === 0;
    const isCurrency = DEAL_CURRENCY_KEYS.has(k);
    const isPercent = DEAL_PERCENT_KEYS.has(k);
    const isDate = DEAL_DATE_KEYS.has(k);
    const isCheck = DEAL_CHECK_KEYS.has(k);
    const isRevenueRecorded = k === 'Revenue Recorded';
    const isPaidToDate = k === 'Paid to Date';
    const isOppYear1Cell = k === DEAL_SETUP_KEY || k === DEAL_RECURRING_KEY;
    const isDaysPaidOn = k === 'Days/Paid on';
    const isCurrentlyBeingPaid = k === 'Currently being paid';
    const isYear = k === 'Year';
    const kind = isCheck ? 'check'
      : isCurrency ? 'currency'
      : isPercent ? 'percent'
      : isDate ? 'date'
      : 'text';
    // Display zero when a supporting currency cell is empty so the
    // compound "$X/($Y + $Z)" formulas on Revenue Recorded / Paid to
    // Date stay readable instead of collapsing to bare slashes.
    function currencyOrZero(v) {
      const n = asNumber(v);
      return fmtCurrency(n == null ? 0 : n);
    }
    function renderValue(v) {
      if (v == null || v === '') return <span style={{ color: 'var(--color-text-muted)' }}>-</span>;
      if (isCurrency) return <span style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtCurrency(v)}</span>;
      if (isPercent) return <span style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtPercent(v)}</span>;
      if (isDate) return <span style={{ color: '#334155' }}>{fmtDate(v)}</span>;
      return <span>{String(v)}</span>;
    }
    // Revenue Recorded reads as "$recorded/$(setup + recurring)" with
    // the two contract amounts summed into a single denominator.
    // Paid to Date reads as "$paid/$commission". The cell is colored
    // by how the numerator compares to the denominator:
    //   • match              → green
    //   • numerator > denom  → gold (more recorded / paid than expected)
    //   • numerator < denom  → red  (less recorded / paid than expected)
    //   • 0 / 0              → grey
    //   • explicitly ignored → grey (toggled by the ⊘ / ↻ button)
    // The ignored state is persisted per-row on a __ flag key so the
    // override doesn't leak into the visible column list.
    // Look the deal's BFO opp name up against the Commissions roster
    // and pull the matching summed total when one exists. Revenue
    // Recorded reads from the project's annual revenue total; Paid to
    // Date from its commission total. null when nothing matches — the
    // caller falls back to whatever's stored on the deal row in that
    // case so legacy pasted values keep working.
    function lookupCommissionNumerator(row) {
      const bfo = normBfo(row?.[DEAL_BFO_KEY]);
      if (!bfo) return null;
      const hit = commissionsByBfo?.get(bfo);
      if (!hit) return null;
      return isRevenueRecorded ? hit.revenue : hit.commission;
    }

    function renderCompound(row, v, linked = false) {
      const ignoreKey = isRevenueRecorded ? '__revenueRecordedIgnored' : '__paidToDateIgnored';
      const ignored = isFilled(row[ignoreKey]);
      // Prefer the live Commissions roll-up over whatever was pasted /
      // typed into this cell so the deal tracks the source-of-truth
      // Commissions tab without the user having to copy numbers across.
      const commNumerator = lookupCommissionNumerator(row);
      const numerator = commNumerator != null ? commNumerator : (asNumber(v) ?? 0);
      const denominator = isRevenueRecorded
        ? (asNumber(row['Setup']) ?? 0) + (asNumber(row['Recurring Revenue']) ?? 0)
        : (asNumber(row['Commission']) ?? 0);
      // Hold the cell in its neutral grey state until the deal's Days/Paid
      // on goes negative (overdue). Before that point the recorded /
      // paid amounts are still expected to be short of the contract, so
      // the green/gold/red comparison would be noise.
      const delta = effectiveDaysPaidOn(row);
      const overdue = delta != null && delta < 0;

      let bg = '#F1F5F9';
      let fg = '#475569';
      let stateTitle = 'No amounts yet';
      if (ignored) {
        bg = '#F1F5F9'; fg = '#475569';
        stateTitle = 'Ignored: click ↻ to re-enable status color';
      } else if (numerator === 0 && denominator === 0) {
        bg = '#F1F5F9'; fg = '#475569';
        stateTitle = 'Nothing recorded yet';
      } else if (!overdue) {
        bg = '#F1F5F9'; fg = '#475569';
        stateTitle = 'Status color appears once Days/Paid on goes overdue';
      } else if (numerator === denominator) {
        bg = '#DCFCE7'; fg = '#166534';
        stateTitle = 'Matches expected';
      } else if (numerator > denominator) {
        bg = '#FEF3C7'; fg = '#92400E';
        stateTitle = `Over by ${fmtCurrency(numerator - denominator)}`;
      } else {
        bg = '#FEE2E2'; fg = '#991B1B';
        stateTitle = `Short by ${fmtCurrency(denominator - numerator)}`;
      }

      const primary = commNumerator != null ? fmtCurrency(commNumerator) : currencyOrZero(v);
      const denomText = fmtCurrency(denominator);
      // Only the auto-populated (linked) cells have Commissions rows to break
      // down, so only those get the double-click affordance.
      const metricKey = isRevenueRecorded ? 'revenue' : 'paid';
      const openBreakdown = linked
        ? (e) => { e.stopPropagation(); row.__onShowCommissionBreakdown?.(row.id, metricKey); }
        : undefined;
      const fullTitle = commNumerator != null
        ? `Auto-populated from Commissions for "${String(row?.[DEAL_BFO_KEY] || '').trim()}": ${stateTitle}. Double-click for the mapped breakdown.`
        : stateTitle;
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%' }} title={fullTitle}>
          <span
            onDoubleClick={openBreakdown}
            style={{ flex: 1, padding: '1px 8px', borderRadius: 4, background: bg, color: fg, fontVariantNumeric: 'tabular-nums', fontWeight: 600, textAlign: 'left', textDecoration: ignored ? 'line-through' : 'none', cursor: linked ? 'zoom-in' : 'default' }}
          >
            {primary}/{denomText}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); row.__onUpdate?.(row.id, ignoreKey, ignored ? '' : '1'); }}
            onDoubleClick={(e) => e.stopPropagation()}
            title={ignored ? 'Re-enable status color for this cell' : 'Ignore this cell: show as grey'}
            style={{ background: 'transparent', border: '1px solid var(--color-border)', color: '#94A3B8', cursor: 'pointer', fontSize: '0.7rem', padding: '0 6px', borderRadius: 4, fontFamily: 'inherit', lineHeight: 1 }}
          >{ignored ? '↻' : '⊘'}</button>
        </span>
      );
    }
    // Closed Won gets a clickable column header that opens the
    // Schneider Electric ServiceDesk "Close after contract execution"
    // ticket form in a new tab — the operational handoff the user
    // wants to do the moment a deal flips to Closed Won.
    const closedWonHeaderUrl = k === 'Closed Won'
      ? 'https://servicedesk.ems.schneider-electric.com/servicedesk/customer/portal/35/create/3562'
      : null;
    return {
      key: k,
      label: k,
      kind,
      renderValue,
      defaultWidth: sticky ? 220 : isCheck ? 110 : isRevenueRecorded ? 210 : isPaidToDate ? 210 : isCurrency || isPercent ? 130 : isDate ? 130 : 150,
      // Date columns sort chronologically off the parsed epoch ms,
      // not the formatted "M/D/YYYY" display string — without this
      // the DataTable falls back to alphabetical text compare and
      // dates land out of order.
      ...(isDate ? { getSortValue: (row) => { const d = asDate(row[k]); return d ? d.getTime() : null; } } : {}),
      // Days/Paid on shows a computed delta, not a stored cell value, so
      // hand the sorter the same number the renderer uses. Hidden /
      // fully-paid / no-due-date rows come through as null and fall to
      // the bottom of the sort either direction.
      ...(isDaysPaidOn ? { getSortValue: (row) => effectiveDaysPaidOn(row) } : {}),
      // Year renders a value derived from Original Contract Start (see the
      // isYear render branch), so the filter, sort, and export must read
      // that same derived value — not the raw stored 'Year' cell. Without
      // this a deal shows e.g. "2026" from its contract date but a Year
      // filter (which would otherwise fall back to the blank stored cell)
      // silently skips it.
      ...(isYear ? {
        getFilterValue: (row) => dealYear(row),
        getSortValue: (row) => { const y = dealYear(row); return y ? Number(y) : null; },
        exportValue: (row) => dealYear(row),
      } : {}),
      ...(sticky ? { sticky: true } : {}),
      ...(closedWonHeaderUrl ? {
        renderHeader: (label) => (
          <a
            href={closedWonHeaderUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Open the Schneider Electric ServiceDesk close-after-contract form in a new tab"
            style={{ color: 'var(--color-accent, #3B82F6)', textDecoration: 'underline' }}
          >{label}</a>
        ),
      } : {}),
      render: (row) => {
        if (isDaysPaidOn) {
          return <DaysPaidOnCell row={row} />;
        }
        // Year is derived from Original Contract Start — render it
        // read-only so it always tracks that date instead of drifting to
        // a hand-typed value.
        if (isYear) {
          const year = dealYear(row);
          return year
            ? <span style={{ color: '#334155', fontVariantNumeric: 'tabular-nums' }}>{year}</span>
            : <span style={{ color: 'var(--color-text-muted)' }}>-</span>;
        }
        // Currently being paid mirrors the Commissions tab's Payment
        // Status pill — pulled by the deal's BFO opp name so the user
        // doesn't have to keep two columns in sync by hand. Falls back
        // to the editable cell when no match exists.
        if (isCurrentlyBeingPaid) {
          const bfo = normBfo(row?.[DEAL_BFO_KEY]);
          const hit = bfo ? commissionsByBfo?.get(bfo) : null;
          const status = hit?.paymentStatus;
          if (status) {
            const palette = status.state === 'active' ? { bg: '#DCFCE7', fg: '#166534' }
              : status.state === 'stopped' ? { bg: '#FEE2E2', fg: '#991B1B' }
              : { bg: '#F1F5F9', fg: '#64748B' };
            const title = `Auto-populated from Commissions for "${String(row?.[DEAL_BFO_KEY] || '').trim()}": ${status.title}`;
            return (
              <span title={title} style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 4, background: palette.bg, color: palette.fg, fontWeight: 600, fontSize: '0.7rem' }}>
                {status.label}
              </span>
            );
          }
        }
        // User-configured dropdown binding from the Link Columns modal
        // wins over the default text/number/date editor. The shared
        // Select/MultiSelect cells store the value as a string so the
        // existing dealsStore persistence round-trips it cleanly.
        const link = resolveColumnLink(k, columnLinks);
        if (link) {
          const opts = listRegistry?.get(link.listKey)?.options || [];
          const onChange = (v) => row.__onUpdate?.(row.id, k, v);
          if (link.mode === 'multi') {
            return <MultiSelectCell value={row[k]} onChange={onChange} options={opts} />;
          }
          return <SelectCell value={row[k]} onChange={onChange} options={opts} />;
        }
        // Revenue Recorded / Paid to Date auto-populate from the
        // Commissions tab when the deal's BFO opp name matches a
        // commission row — render the pill directly so the user
        // isn't tempted to double-click-edit a derived value that
        // wouldn't display anyway. Source-of-truth edits happen on
        // the Commissions tab.
        if ((isRevenueRecorded || isPaidToDate) && lookupCommissionNumerator(row) != null) {
          return renderCompound(row, row[k], true);
        }
        // Every date column gets the shared click-to-pick calendar cell
        // instead of the double-click text editor, matching how dates
        // behave elsewhere in the app. Picking a day stores ISO
        // (YYYY-MM-DD), which fmtDate/asDate already read, so sorting,
        // the derived Year column and exports keep working unchanged.
        // A value the calendar can't represent (e.g. the 'N/A' a deal can
        // carry on Follow Up On Sale, set from the Clients tab) still
        // renders as its own text rather than being blanked.
        if (isDate) {
          return (
            <DateCell
              value={row[k]}
              onChange={(v) => row.__onUpdate?.(row.id, k, v)}
            />
          );
        }
        // A blank Setup / Recurring Revenue cell on a deal tied to an opp
        // shows what that opp's saved Pricing Option would put there —
        // greyed and in brackets, because nothing is stored yet. It is a
        // preview of the Import above the grid, not a value: the deal's own
        // maths (the Revenue Recorded denominator, the drill-downs, the
        // export) keeps reading the stored cell, which is still empty.
        const oppPreview = isOppYear1Cell && !isFilled(row[k]) && row.__oppYear1__
          ? (k === DEAL_SETUP_KEY ? row.__oppYear1__.setup : row.__oppYear1__.recurring)
          : null;
        const cellRender = (isRevenueRecorded || isPaidToDate)
          ? (v) => renderCompound(row, v)
          : (Number.isFinite(oppPreview)
            ? (v) => (isFilled(v) ? renderValue(v) : (
              <span
                title={`From the opp tied to this deal${row.__oppYear1__.optionName ? ` (option “${row.__oppYear1__.optionName}”)` : ''}: ${k === DEAL_SETUP_KEY ? 'Year 1 Setup + One Time' : 'Year 1 recurring revenue'} ${fmtCurrency(oppPreview)}. Nothing is stored yet — use “Import Year 1 figures” above the grid, or type your own.`}
                style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#0F766E', fontStyle: 'italic', opacity: 0.85 }}
              >({fmtCurrency(oppPreview)})</span>
            ))
            : renderValue);
        // Long contract names get clipped in narrow cells; show the
        // full value as the hover tooltip on the Agreement Name column
        // so the user can read it without expanding the column.
        const hoverTitle = k === 'Agreement Name' && isFilled(row[k])
          ? String(row[k])
          : undefined;
        return (
          <EditableCell
            value={row[k]}
            kind={kind}
            render={cellRender}
            onSave={(v) => row.__onUpdate?.(row.id, k, v)}
            autoFocus={!!row.__newRow && sticky}
            listId={k === 'Client Name' ? CLIENT_NAME_LIST_ID : undefined}
            hoverTitle={hoverTitle}
          />
        );
      },
      exportValue: (row) => {
        if (isYear) return dealYear(row);
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
}

export function DealsView({ settings, updateSettings, prospects = [], cdmName, user, addProspect }) {
  const [{ data, source }, setStore] = useState(() => loadDealsList());
  // Opps 2 records, loaded once so the page can flag Sold opps that have
  // no matching deal here (see soldMissingDeals below). Picks the newest
  // of the local cache and the synced Firestore copy so the warning
  // reflects what the Opps 2 tab would show, even on a fresh device.
  const [opps2Records, setOpps2Records] = useState([]);
  // Per-opp dismissals for the "Sold opp has no matching deal" banner, so
  // the user can silence a flagged opp they've decided not to track here.
  const [soldIgnore, setSoldIgnore] = useState(() => loadSoldWarningIgnore());
  // Whether the Sold-opp banner is folded up. Remembered per user, so a page
  // that's been read stays out of the way across reloads — the heading and
  // its count stay either way, so nothing goes quiet.
  const [soldCollapsed, setSoldCollapsed] = useState(() => loadSoldWarningCollapsed());
  // Commissions roster feeds the Revenue Recorded / Paid to Date auto-
  // population. Re-hydrated on the storage event so a paste on the
  // Commissions tab in another window flows through here without a
  // reload.
  const [commissionsData, setCommissionsData] = useState(() => loadCommissions().data || []);
  const [search, setSearch] = useState('');
  const [uploadError, setUploadError] = useState(null);
  const [showPaste, setShowPaste] = useState(false);
  // Clipboard text captured by the page-level paste handler, handed to the
  // modal so it can open straight on the column-mapping step.
  const [initialPaste, setInitialPaste] = useState('');
  // One-line report of what the last paste import did, shown in the notice
  // strip — a merge is quiet by design, so it has to say what it changed.
  const [pasteNote, setPasteNote] = useState('');
  // Which deal cell's commission breakdown popup is open: { rowId, metric }
  // where metric is 'revenue' (Revenue Recorded) or 'paid' (Paid to Date).
  // Opened by double-clicking an auto-populated Revenue Recorded / Paid to
  // Date cell.
  const [breakdown, setBreakdown] = useState(null);
  // Which deal's full history drill-down is open (raw row index, or null).
  // Opened from the 📊 button in each row's pinned leading block — the
  // grid edits cells on double-click, so a plain row click can't be the
  // trigger without stealing the first half of every edit.
  const [historyRowId, setHistoryRowId] = useState(null);
  const [clientMap, setClientMap] = useState(() => loadDealClientMap());
  const [ignoreSet, setIgnoreSet] = useState(() => loadDealClientIgnore());
  const [onlyUnmapped, setOnlyUnmapped] = useState(false);
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [bulkPick, setBulkPick] = useState('');
  // Bulk-edit selection (row indices) + the active column / value the
  // user wants to push out to all selected rows. The toolbar lives
  // above the table and only appears when at least one row is ticked.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkEditColumn, setBulkEditColumn] = useState('');
  const [bulkEditValue, setBulkEditValue] = useState('');
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const fileInputRef = useRef(null);

  // User-configurable column-to-Dropdowns-list bindings. Mirrors the
  // Opps 2 "Link columns" feature so a deal column can pull picks
  // straight from the Dropdowns reference lists. Stored on the user's
  // synced settings so it follows them across devices.
  const columnLinks = settings?.dealsColumnLinks || {};
  const updateColumnLinks = (next) => {
    updateSettings?.({ dealsColumnLinks: next || {} });
  };
  // Effective dropdown vocabulary for cell renderers / Link Columns
  // modal. Mirrors OppsView2 — picks up user edits made on the
  // Dropdowns tab through settings.dropdownLists.
  const dropdownLists = useMemo(
    () => getEffectiveDropdownLists(settings),
    // The Solutions list is served unioned with the services board layout
    // (see mergeBoardServices), so it moves when a service is filed into a
    // box as well as when a list is edited.
    [settings?.dropdownLists, settings?.customServiceCategories]
  );
  const listRegistry = useMemo(() => buildListRegistry(dropdownLists), [dropdownLists]);
  const availableLists = useMemo(() => buildAvailableLists(dropdownLists), [dropdownLists]);

  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'deals-list-override') setStore(loadDealsList());
      if (e.key === 'deals-client-map') setClientMap(loadDealClientMap());
      if (e.key === 'deals-client-ignore') setIgnoreSet(loadDealClientIgnore());
      if (e.key === 'commissions-list-override') setCommissionsData(loadCommissions().data || []);
    }
    function onClientMap() {
      setClientMap(loadDealClientMap());
      setIgnoreSet(loadDealClientIgnore());
    }
    function onSoldIgnore() {
      setSoldIgnore(loadSoldWarningIgnore());
    }
    // This page only READS commissions, so reacting to the change event
    // can't feed back into its own writes.
    const onCommissions = () => setCommissionsData(loadCommissions().data || []);
    // The deals roster changed under us — another tab, or the Firestore
    // mirror hydrating a restored copy at signin. Safe to listen for our
    // own writes too now that commitDeals saves outside the state updater.
    const onDealsList = () => setStore(loadDealsList());
    window.addEventListener('storage', onStorage);
    window.addEventListener(DEALS_LIST_EVENT, onDealsList);
    window.addEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
    window.addEventListener(SOLD_WARNING_IGNORE_EVENT, onSoldIgnore);
    window.addEventListener(COMMISSIONS_LIST_EVENT, onCommissions);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(DEALS_LIST_EVENT, onDealsList);
      window.removeEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
      window.removeEventListener(SOLD_WARNING_IGNORE_EVENT, onSoldIgnore);
      window.removeEventListener(COMMISSIONS_LIST_EVENT, onCommissions);
    };
  }, []);

  // Pull the Opps 2 records so we can warn about Sold opps that aren't
  // represented on the Deals page. A cancelled flag guards against a
  // late resolve writing state after unmount / a user change.
  useEffect(() => {
    let cancelled = false;
    loadOpps2Newest(user?.uid)
      .then((d) => {
        if (cancelled) return;
        setOpps2Records(Array.isArray(d?.records) ? d.records : []);
      })
      .catch(() => { if (!cancelled) setOpps2Records([]); });
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Active + Old Client roster the helper-column dropdown picks from.
  // CDM-matching Client / Old Client prospects come first, but any
  // Old Client in the pool — even ones whose CDM has drifted to
  // another rep — is included too, since a deal row often points at
  // an account that's been reassigned over time. Falls back to every
  // CDM-matching prospect when no clients are flagged yet. Status
  // comparison collapses internal whitespace so "Old  Client",
  // "old\tclient", etc. still match.
  const clientOptions = useMemo(() => {
    const normStatus = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const cdmList = prospects.filter(p => matchesCdm(p.cdm, cdmName));
    const myClients = cdmList.filter(p => {
      const s = normStatus(p.status);
      return s === 'client' || s === 'old client';
    });
    const allOldClients = prospects.filter(p => normStatus(p.status) === 'old client');
    const pool = (myClients.length > 0 || allOldClients.length > 0)
      ? [...myClients, ...allOldClients]
      : cdmList;
    const names = new Set();
    for (const p of pool) {
      const name = String(p.company || '').trim();
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [prospects, cdmName]);

  // Every company name in the Table View prospect roster — feeds the
  // <datalist> the Client Name cell uses for predictive text. Broader
  // than clientOptions on purpose: the user wants autocomplete to
  // match any company they've already added to Table View, not just
  // those currently tagged as a client.
  const companySuggestions = useMemo(() => {
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

  // Normalized set a deal's Client Name auto-maps against. Built from
  // EVERY company in the Table View roster (companySuggestions), not just
  // the CDM/status-filtered client pool — so an exact name match auto-maps
  // regardless of who owns the account or whether it's tagged Client / Old
  // Client. The Mapped-to-Client dropdown still offers the narrower
  // clientOptions pool for manual assignment.
  const clientNameSet = useMemo(
    () => new Set(companySuggestions.map(n => normClient(n))),
    [companySuggestions]
  );

  // Lookup from normalized company name to prospect, so the Client
  // Status column can resolve each deal row to its prospect record.
  // Picks the first prospect with a non-empty status when more than
  // one shares a name, so we surface the "real" status instead of a
  // blank duplicate.
  const prospectByName = useMemo(() => {
    const out = new Map();
    for (const p of prospects) {
      const key = normClient(p.company);
      if (!key) continue;
      const existing = out.get(key);
      if (!existing || (!existing.status && p.status)) out.set(key, p);
    }
    return out;
  }, [prospects]);

  // The roster as of the last write, tracked in a ref alongside the state.
  //
  // Every mutation below used to compute its next roster inside a
  // setStore(prev => …) updater and save from in there. That had to stop:
  // saveDealsOverride dispatches DEALS_LIST_EVENT, this page now listens
  // for it (so a Firestore-restored roster lands without a reload), and a
  // listener firing from inside this component's own updater would recurse.
  //
  // Reading plain `data` from the render closure instead would have been a
  // regression: importOppYear1 calls updateCells once per fill in a loop,
  // and every iteration would have read the same stale roster, so only the
  // last fill would survive. The ref is updated synchronously by
  // commitDeals, so a batch in one tick still chains write on write.
  const dealsRef = useRef(data);
  useEffect(() => { dealsRef.current = data; }, [data]);

  // Persist a new roster and put it on screen. The single place that
  // writes deals, so the save stays outside every state updater.
  //
  // These four are useCallback'd with no dependencies — they read the
  // roster from the ref rather than from the render, so their identity
  // never has to change. That keeps the `rows` and column memos below
  // from rebuilding on every render just to pick up a new closure.
  const commitDeals = useCallback((next) => {
    dealsRef.current = next;
    setStore({ data: next, source: 'override' });
    try { saveDealsOverride(next); } catch (err) { console.warn('Save deals failed', err); }
  }, []);

  // Per-cell saves write the new value into the stored deal and
  // persist through dealsStore (localStorage + Firestore mirror).
  // Used by inline cell editing (double-click) and the progress
  // popover's checkbox toggles. Falsy / empty saves drop the key
  // entirely so empty cells render the muted "—" placeholder.
  const updateCell = useCallback((rowId, key, value) => {
    const idx = Number(rowId);
    if (!Number.isFinite(idx)) return;
    const next = [...dealsRef.current];
    const current = { ...(next[idx] || {}) };
    if (value === '' || value == null) delete current[key];
    else current[key] = value;
    next[idx] = current;
    commitDeals(next);
  }, [commitDeals]);

  // Write several cells on one row in a single pass — a projection saves
  // four keys at once, and routing each through updateCell would persist
  // the whole roster four times over.
  const updateCells = useCallback((rowId, patch) => {
    const idx = Number(rowId);
    if (!Number.isFinite(idx)) return;
    const next = [...dealsRef.current];
    const current = { ...(next[idx] || {}) };
    for (const [key, value] of Object.entries(patch || {})) {
      if (value === '' || value == null) delete current[key];
      else current[key] = value;
    }
    next[idx] = current;
    commitDeals(next);
  }, [commitDeals]);

  // Page-level paste handler. Ctrl/Cmd+V anywhere on the Deals tab — the
  // empty state, the toolbar, the table — opens the column-mapping popup
  // with the clipboard text already parsed, so pasting from Sheets is the
  // one gesture it sounds like. Skipped while a real input / textarea has
  // focus so the search box, the inline cell editors and the modal's own
  // textarea keep pasting normally. Mirrors the Commissions subtab.
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

  function addNewDeal() {
    // Pre-fill Due Date 60 days from today so the Days/Paid on
    // delta has something to render against the moment the row
    // appears. Stored in the same M/D/YYYY shape Excel exports use.
    const due = new Date();
    due.setDate(due.getDate() + 60);
    const dueDateStr = due.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
    commitDeals([{ 'Due Date': dueDateStr }, ...dealsRef.current]);
  }

  // A new deal seeded from a flagged Sold opp. Carries over the BFO opp
  // name (so the row immediately matches the opp and clears the warning)
  // plus the Account → Client Name and the opp's GM. Mirrors addNewDeal's
  // Due Date seed so Days/Paid on renders right away.
  //
  // Shared by the per-opp button and the add-all one, so a deal seeded in
  // a batch is identical to one seeded on its own.
  function dealRowFromOpp(opp, dueDateStr) {
    const row = { 'Due Date': dueDateStr };
    if (opp.bfo) row[DEAL_BFO_KEY] = opp.bfo;
    if (opp.account) row['Client Name'] = opp.account;
    if (opp.gm) row['GM'] = opp.gm;
    return row;
  }

  function seedDueDate() {
    const due = new Date();
    due.setDate(due.getDate() + 60);
    return due.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  }

  function addDealFromOpp(opp) {
    commitDeals([dealRowFromOpp(opp, seedDueDate()), ...dealsRef.current]);
  }

  // Every flagged opp at once, in the order the banner lists them, in a
  // single store pass — so the override file takes one write rather than
  // one per deal, and the whole batch lands or none of it does.
  //
  // An opp with no BFO opp name still gets its deal, exactly as the
  // per-opp button gives it one. It just can't stop warning, because the
  // warning is "these two aren't linked" and only a BFO name links them —
  // which is why the confirmation says so before the click rather than
  // leaving a row of warnings looking like the button missed them.
  function addAllDealsFromOpps(opps) {
    if (!opps.length) return;
    const noBfo = opps.filter(o => !o.bfo).length;
    const ask = `Add ${opps.length} new deal${opps.length === 1 ? '' : 's'}, one for each suggested opp?`
      + (noBfo > 0
        ? `\n\n${noBfo} of them ${noBfo === 1 ? 'has' : 'have'} no BFO opp name, so ${noBfo === 1 ? 'that opp' : 'those opps'} will keep warning until you set one.`
        : '');
    if (!window.confirm(ask)) return;
    const dueDateStr = seedDueDate();
    commitDeals([...opps.map(o => dealRowFromOpp(o, dueDateStr)), ...dealsRef.current]);
  }

  // Bulk-edit helpers. Selection lives in DealsView state (Set of row
  // indices) and survives table re-renders since `rows` is derived
  // deterministically from `data`. Apply pushes the picked value into
  // every selected row in one setStore pass so the override file gets
  // a single write instead of N round-trips through updateCell.
  function toggleSelected(rowId) {
    const idx = Number(rowId);
    if (!Number.isFinite(idx)) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function applyBulkEdit() {
    if (!bulkEditColumn || selectedIds.size === 0) return;
    commitDeals(dealsRef.current.map((row, idx) => {
      if (!selectedIds.has(idx)) return row;
      const updated = { ...row };
      const v = bulkEditValue;
      if (v === '' || v == null) delete updated[bulkEditColumn];
      else updated[bulkEditColumn] = v;
      return updated;
    }));
  }

  // Flip the Handoff-progress "ignored" flag on every selected deal.
  // `mode` toggles which way to push it: ignore greys out the first
  // column pill, restore removes the flag.
  function applyBulkIgnore(mode) {
    if (selectedIds.size === 0) return;
    commitDeals(dealsRef.current.map((row, idx) => {
      if (!selectedIds.has(idx)) return row;
      const updated = { ...row };
      if (mode === 'ignore') updated[PROGRESS_IGNORED_KEY] = '1';
      else delete updated[PROGRESS_IGNORED_KEY];
      return updated;
    }));
  }

  // Drop a deal row entirely. Wired into the Progress popover's
  // "Delete deal" button so the user can prune rows that shouldn't be
  // in the tracker without hunting for the underlying source.
  const deleteDeal = useCallback((rowId) => {
    const idx = Number(rowId);
    if (!Number.isFinite(idx)) return;
    const current = dealsRef.current;
    if (idx < 0 || idx >= current.length) return;
    commitDeals(current.filter((_, i) => i !== idx));
  }, [commitDeals]);

  // Open the commission breakdown popup for a deal's Revenue Recorded /
  // Paid to Date cell. Wired to a double-click on the auto-populated pill;
  // stores the raw row index + metric so the modal reads the live deal.
  function showCommissionBreakdown(rowId, metric) {
    const idx = Number(rowId);
    if (!Number.isFinite(idx)) return;
    setBreakdown({ rowId: idx, metric });
  }

  // Opps that can hand a deal its Year-1 money, keyed by BFO opportunity
  // name. Only opps carrying a saved Pricing Option are in here — an opp
  // with no option has nothing to give.
  const oppYear1ByBfo = useMemo(() => indexOppYear1ByBfo(opps2Records), [opps2Records]);

  const rows = useMemo(
    // A row counts as the freshly-added "new" row (and gets autofocused
    // on its Client Name cell) as long as the top row hasn't been given
    // a Client Name yet. Anchoring this to Client Name rather than the
    // raw key count lets addNewDeal seed defaults like Due Date without
    // disabling the autofocus behavior.
    () => data.map((r, i) => ({
      ...r,
      id: i,
      __onUpdate: updateCell,
      __onShowCommissionBreakdown: showCommissionBreakdown,
      __newRow: i === 0 && !isFilled(r['Client Name']),
      // Year-1 Setup / Recurring from the opp this deal's BFO name ties it
      // to, when that opp has a saved Pricing Option. Carried on the row so
      // a blank cell can show what it would be filled with, and so the
      // contract-value denominator can count it before anyone imports.
      __oppYear1__: oppYear1ForDeal(oppYear1ByBfo, r),
    })),
    // updateCell is useCallback'd with a stable identity, so listing it
    // here satisfies the exhaustive-deps rule without costing a rebuild.
    [data, oppYear1ByBfo, updateCell]
  );
  // Sold Opps 2 opps that don't line up with any deal here. The link
  // between the two is the BFO opportunity name — "BFO Link" on an opp,
  // DEAL_BFO_KEY on a deal — so a Sold opp is flagged when it has no BFO
  // name at all, or its BFO name matches no deal row. Surfaces as a
  // warning banner so the user can add the missing deal (or assign the
  // opp's BFO name) before it slips through the cracks.
  const soldMissingDeals = useMemo(() => {
    // Treat dash / #N/A placeholders as "no BFO name", matching the Opps 2
    // import dedup so a "-" cell doesn't read as a real, matchable name.
    const realBfo = (v) => {
      const n = normBfo(v);
      return n === '-' || n === '#n/a' ? '' : n;
    };
    const sold = opps2Records.filter(
      (r) => String(r?.['Stage'] ?? '').trim().toLowerCase() === 'sold'
    );
    if (sold.length === 0) return [];
    const dealBfoNames = new Set();
    for (const r of data) {
      const n = realBfo(r?.[DEAL_BFO_KEY]);
      if (n) dealBfoNames.add(n);
    }
    return sold
      .filter((r) => {
        const n = realBfo(r?.['BFO Link']);
        return !n || !dealBfoNames.has(n);
      })
      .map((r) => {
        const account = String(r?.['Account'] ?? '').trim();
        const scope = String(r?.['Scope'] ?? '').trim();
        const bfo = String(r?.['BFO Link'] ?? '').trim();
        // Stable dismissal key: prefer the opp's _id; fall back to an
        // account/scope/BFO composite so opps without an _id still
        // persist their own ignore state.
        const ignoreKey = r?._id != null
          ? `id:${r._id}`
          : `k:${account}|${scope}|${bfo}`.toLowerCase();
        // GM to carry onto a new deal. Sold opps record their margin as
        // "Final Margin" (the close-out field); fall back to a plain GM /
        // Margin column if the data uses one of those names instead.
        const gm = String(r?.['GM'] ?? r?.['Final Margin'] ?? r?.['Margin'] ?? '').trim();
        return { id: r?._id, account, scope, bfo, ignoreKey, gm };
      });
  }, [opps2Records, data]);

  // Split the flagged opps into the ones still showing and the ones the
  // user has dismissed, so the banner can hide dismissals while still
  // offering a Reset to bring them all back.
  const visibleSoldMissing = useMemo(
    () => soldMissingDeals.filter((o) => !soldIgnore.has(o.ignoreKey)),
    [soldMissingDeals, soldIgnore]
  );
  const ignoredSoldCount = soldMissingDeals.length - visibleSoldMissing.length;

  // Rolled-up Commissions data, keyed by normalized BFO opp name. Feeds
  // the Revenue Recorded / Paid to Date auto-population in buildColumns.
  const commissionsByBfo = useMemo(
    () => indexCommissionsByBfo(commissionsData),
    [commissionsData]
  );
  // Deals whose tied opp can fill a blank Setup / Recurring Revenue. Planned
  // rather than written: money going into the roster is the user's call, and
  // a deal whose figures were typed off the signed agreement must not have
  // the quote pushed over them (planOppYear1Fills only ever fills blanks).
  const oppYear1Fills = useMemo(
    () => planOppYear1Fills(data, oppYear1ByBfo),
    [data, oppYear1ByBfo],
  );
  const [oppYear1Note, setOppYear1Note] = useState('');
  function importOppYear1() {
    if (oppYear1Fills.length === 0) return;
    let cells = 0;
    for (const fill of oppYear1Fills) {
      updateCells(fill.index, fill.patch);
      cells += Object.keys(fill.patch).length;
    }
    setOppYear1Note(
      `Imported ${cells} figure${cells === 1 ? '' : 's'} into `
      + `${oppYear1Fills.length} deal${oppYear1Fills.length === 1 ? '' : 's'} from their opps.`
    );
    setTimeout(() => setOppYear1Note(''), 6000);
  }

  const baseColumns = useMemo(
    () => buildColumns(rows, columnLinks, listRegistry, commissionsByBfo),
    [rows, columnLinks, listRegistry, commissionsByBfo]
  );
  // Inject a helper "Mapped to Client" column right after the sticky
  // Client Name. The column is read-only when the row's Client Name
  // already matches an active client, and otherwise renders a small
  // dropdown that persists the user's pick via dealClientMap. Only
  // surfaces when prospects are passed in.
  const columns = useMemo(() => {
    if (baseColumns.length === 0) return baseColumns;
    // Leading checkbox column for bulk-edit selection. Underscore-key
    // so DataTable's filter row leaves it alone, and the header
    // renders a compact "select-all-visible" toggle that respects the
    // currently filtered row set.
    const selectCol = {
      key: '__bulkSelect__',
      label: '',
      defaultWidth: 36,
      // Pinned with Progress and Client Name below. A checkbox that scrolled
      // out from under the frozen block would slide behind it and read as
      // broken, so the whole leading block travels together.
      sticky: true,
      renderHeader: () => null,
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row.id)}
          onChange={(e) => { e.stopPropagation(); toggleSelected(row.id); }}
          onClick={(e) => e.stopPropagation()}
          title="Select this deal for bulk edit"
          style={{ cursor: 'pointer' }}
        />
      ),
      exportValue: () => '',
      getFilterValue: () => '',
    };
    // Drill-down button: opens the deal's commissions & revenue history
    // (expected vs actual, month by month). Pinned with the rest of the
    // leading block so it's reachable however far right the sheet is
    // scrolled, and kept out of filtering / export since it carries no
    // value of its own.
    // The button also carries the deal's commission-tracking status
    // (Missing / On track / Completed, set inside the modal) as its tint,
    // so the state is scannable down the grid without opening anything.
    const historyCol = {
      key: '__dealHistory__',
      label: '',
      defaultWidth: 40,
      sticky: true,
      renderHeader: () => null,
      render: (row) => {
        const st = dealTrackStatus(row);
        return (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setHistoryRowId(row.id); }}
            onDoubleClick={(e) => e.stopPropagation()}
            title={`Commissions & revenue history for this deal: expected vs actual${st.key ? ` · status: ${st.label}` : ''}`}
            style={{ background: st.key ? st.bg : 'transparent', border: `1px solid ${st.key ? st.border : 'transparent'}`, borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem', lineHeight: 1, padding: '2px 4px' }}
          >📊</button>
        );
      },
      exportValue: (row) => dealTrackStatus(row).key || '',
      getFilterValue: () => '',
    };
    // Leading column shows a compact handoff-progress pill for each
    // deal (e.g. "2/4") and opens a popover with the four fields.
    // Always added — independent of the Mapped to Client / Status
    // helpers below, which depend on the prospect roster.
    const progressCol = {
      key: PROGRESS_COL_KEY,
      label: PROGRESS_COL_LABEL,
      defaultWidth: 90,
      sticky: true,
      render: (row) => (
        <ProgressCell
          row={row}
          columnLinks={columnLinks}
          listRegistry={listRegistry}
          onSave={updateCell}
          onDelete={deleteDeal}
        />
      ),
      exportValue: (row) => {
        if (isFilled(row[PROGRESS_IGNORED_KEY])) return 'Ignored';
        const done = PROGRESS_FIELDS.filter(f => isHandoffFieldDone(row, f)).length;
        return `${done}/${PROGRESS_FIELDS.length}`;
      },
      getFilterValue: () => '',
    };
    // Client Name stays pinned alongside Progress, so the two columns that
    // say which deal a row is stay on screen however far right the sheet is
    // scrolled — there are forty-odd columns after them, and a commission
    // figure with no client against it is unreadable. Also decorate the cell
    // with a ⚠ warning when the deal's Client Name matches no company
    // in the Table View roster — directly or through a hand-mapping to
    // a client. This is broader than the "Mapped to Client" helper,
    // which only checks the active-client subset: a name can be a real
    // Table View company that just isn't tagged as a client (that shows
    // the yellow "Map to client…" prompt), versus a name that matches
    // nothing in Table View at all (a typo, or an account never added)
    // — only the latter gets the ⚠. Stays silent when the roster hasn't
    // loaded (prospectByName empty) so there's nothing to match against,
    // and respects the same per-name ignore set as the mapping column.
    const clientNameBaseRender = baseColumns[0].render;
    const clientNameCol = {
      ...baseColumns[0],
      sticky: true,
      render: (row) => {
        const raw = String(row['Client Name'] || '').trim();
        const norm = normClient(raw);
        const mapped = clientMap[norm];
        const unknownToTableView = !!raw
          && prospectByName.size > 0
          && !ignoreSet.has(norm)
          && !prospectByName.has(norm)
          && !(mapped && prospectByName.has(normClient(mapped)));
        if (!unknownToTableView) return clientNameBaseRender(row);
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}>
            <span style={{ flex: 1, minWidth: 0 }}>{clientNameBaseRender(row)}</span>
            <ClientNameWarning
              name={raw}
              cdmName={cdmName}
              onAdd={addProspect || null}
              onIgnore={setDealClientIgnore}
            />
          </span>
        );
      },
    };
    if (clientNameSet.size === 0) {
      return [selectCol, historyCol, progressCol, clientNameCol, ...baseColumns.slice(1)];
    }
    const helperCol = {
      key: MAPPED_COL_KEY,
      label: MAPPED_COL_LABEL,
      defaultWidth: 220,
      render: (row) => {
        const raw = String(row['Client Name'] || '').trim();
        if (!raw) return <span style={{ color: '#94A3B8' }}>-</span>;
        const norm = normClient(raw);
        const auto = clientNameSet.has(norm);
        const manual = clientMap[norm];
        const ignored = ignoreSet.has(norm);
        if (auto) {
          return (
            <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: '#DCFCE7', color: '#166534' }} title="Client Name matches a company in Table View">
              ✓ Matches
            </span>
          );
        }
        return (
          <MappedClientCell
            raw={raw}
            manual={manual}
            ignored={ignored}
            clientOptions={clientOptions}
            onChange={setDealClientMapping}
            onToggleIgnore={setDealClientIgnore}
          />
        );
      },
      exportValue: (row) => {
        const raw = String(row['Client Name'] || '').trim();
        if (!raw) return '';
        const norm = normClient(raw);
        if (clientNameSet.has(norm)) return raw;
        if (ignoreSet.has(norm)) return '(ignored)';
        return clientMap[norm] || '';
      },
    };
    // Looks up the prospect status for each deal row. Uses the
    // mapped target when the user has hand-mapped this source name,
    // otherwise the raw Client Name. Both sides are normalized.
    const statusCol = {
      key: STATUS_COL_KEY,
      label: STATUS_COL_LABEL,
      defaultWidth: 130,
      render: (row) => {
        const raw = String(row['Client Name'] || '').trim();
        if (!raw) return <span style={{ color: '#94A3B8' }}>-</span>;
        const norm = normClient(raw);
        const mapped = clientMap[norm];
        const lookupKey = mapped ? normClient(mapped) : norm;
        const prospect = prospectByName.get(lookupKey);
        const status = prospect?.status;
        if (!status) return <span style={{ color: '#94A3B8' }}>-</span>;
        const pill = statusPillStyle(status);
        return (
          <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, ...pill }}>
            {status}
          </span>
        );
      },
      exportValue: (row) => {
        const raw = String(row['Client Name'] || '').trim();
        if (!raw) return '';
        const norm = normClient(raw);
        const mapped = clientMap[norm];
        const lookupKey = mapped ? normClient(mapped) : norm;
        return prospectByName.get(lookupKey)?.status || '';
      },
      getFilterValue: (row) => {
        const raw = String(row['Client Name'] || '').trim();
        if (!raw) return '';
        const norm = normClient(raw);
        const mapped = clientMap[norm];
        const lookupKey = mapped ? normClient(mapped) : norm;
        return prospectByName.get(lookupKey)?.status || '';
      },
    };
    // Order: select · history · progress · client name · mapped-to-client · status · rest.
    return [selectCol, historyCol, progressCol, clientNameCol, helperCol, statusCol, ...baseColumns.slice(1)];
  }, [baseColumns, clientOptions, clientNameSet, clientMap, ignoreSet, prospectByName, columnLinks, listRegistry, selectedIds, cdmName, addProspect, updateCell, deleteDeal]);
  const tableId = useMemo(
    () => 'deals:' + columns.map(c => c.key).sort().join('|'),
    [columns]
  );
  // Bulk-select, the history drill-down and the progress pill are
  // affordances rather than data, so they stay on screen whatever the
  // user hides from the column picker.
  const alwaysVisible = useMemo(
    () => columns.slice(0, 3).map(c => c.key),
    [columns]
  );
  // Headers that the Link Columns modal lets the user bind to a
  // Dropdowns list. Helper / computed columns (progress pill, Mapped
  // to Client, Client Status) carry an `__` prefix and never get a
  // free-text editor, so a dropdown binding wouldn't apply.
  const linkableHeaders = useMemo(
    () => columns.map(c => c.key).filter(k => !String(k).startsWith('__')),
    [columns]
  );

  function isRowUnmapped(row) {
    if (clientNameSet.size === 0) return false;
    const raw = String(row['Client Name'] || '').trim();
    if (!raw) return false;
    const norm = normClient(raw);
    if (clientNameSet.has(norm)) return false;
    if (clientMap[norm]) return false;
    if (ignoreSet.has(norm)) return false;
    return true;
  }

  // A row counts as "incomplete handoff" when it isn't opted-out via
  // the Progress popover and at least one of the PROGRESS_FIELDS is
  // still blank. Mirrors the X/N math the pill shows in the first
  // column so the filter button stays in lockstep with the badge.
  const incompleteCount = useMemo(
    () => rows.filter(r => !isFilled(r[PROGRESS_IGNORED_KEY])
      && PROGRESS_FIELDS.some(f => !isHandoffFieldDone(r, f))).length,
    [rows]
  );

  const filtered = useMemo(() => {
    let out = rows;
    if (search.trim()) {
      const term = search.toLowerCase();
      out = out.filter(r =>
        Object.values(r).some(v => String(v).toLowerCase().includes(term))
      );
    }
    if (onlyUnmapped) out = out.filter(isRowUnmapped);
    if (onlyIncomplete) {
      out = out.filter(r => !isFilled(r[PROGRESS_IGNORED_KEY])
        && PROGRESS_FIELDS.some(f => !isHandoffFieldDone(r, f)));
    }
    return out;
  }, [search, rows, onlyUnmapped, onlyIncomplete, clientNameSet, clientMap, ignoreSet, clientOptions]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    try {
      const buf = await file.arrayBuffer();
      // Pulled in on use — the spreadsheet library is ~140 KB gzipped
      // and this page only needs it for import / export.
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buf, { cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('Workbook has no sheets');
      const parsed = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('No rows parsed');

      // Normalize headers: trim whitespace, strip stray trailing
      // periods so 'Client Name ' or 'Client Name.' still lands under
      // the canonical column, then fold aliases (e.g. 'Paperwork' ->
      // 'Paperwork completed') so old and new tracker exports share
      // the same underlying column.
      const normalizeHeader = (h) => {
        const cleaned = String(h || '').trim().replace(/\.+$/, '');
        const aliased = HEADER_ALIASES[cleaned.toLowerCase()];
        return aliased || cleaned;
      };
      const cleaned = parsed
        .map(r => {
          const out = {};
          for (const k of Object.keys(r)) out[normalizeHeader(k)] = r[k];
          return out;
        })
        .filter(r => Object.values(r).some(v => v !== '' && v != null));

      if (cleaned.length === 0) throw new Error('All rows were blank.');
      saveDealsOverride(cleaned);
      setStore(loadDealsList());
    } catch (err) {
      const msg = err?.name === 'QuotaExceededError'
        ? 'Upload too large for browser storage (max ~5 MB). Try trimming unused columns.'
        : (err?.message || 'Failed to read file');
      setUploadError(msg);
    }
  }

  function handleRevert() {
    if (!window.confirm('Clear the uploaded deals list?')) return;
    clearDealsOverride();
    setStore(loadDealsList());
  }

  // Merge a pasted batch into the roster instead of replacing it. New deals
  // are appended; a deal already on file fills in only the cells that were
  // blank, so a value already recorded here survives a re-paste of the sheet
  // (see planDealPaste). Appending — rather than prepending — keeps every
  // existing row index pointing at the same deal, which the selection, the
  // history drill-down and the per-cell saves all rely on.
  function handlePasteImport(records, { overwriteConflicts = false } = {}) {
    const { next, summary } = planDealPaste(dealsRef.current, records, { overwriteConflicts });
    commitDeals(next);
    setPasteNote(describeDealPaste(summary));
    setShowPaste(false);
    setInitialPaste('');
  }

  // Count rows whose Client Name doesn't match any active client,
  // hasn't been hand-mapped, and hasn't been explicitly ignored.
  // Surfaces the work the user still has to do after a paste import.
  const unmappedCount = useMemo(() => {
    if (clientNameSet.size === 0) return 0;
    let n = 0;
    for (const r of rows) {
      const raw = String(r['Client Name'] || '').trim();
      if (!raw) continue;
      const norm = normClient(raw);
      if (clientNameSet.has(norm)) continue;
      if (clientMap[norm]) continue;
      if (ignoreSet.has(norm)) continue;
      n++;
    }
    return n;
  }, [rows, clientNameSet, clientMap, ignoreSet]);

  // Distinct unmapped source-name strings drive bulk actions: ignoring
  // or assigning happens per source name, so each "Brookfield (BPREP
  // US fund)" only needs one decision regardless of how many deal
  // rows share it.
  const distinctUnmappedNames = useMemo(() => {
    const out = new Map();
    for (const r of rows) {
      if (!isRowUnmapped(r)) continue;
      const raw = String(r['Client Name'] || '').trim();
      if (!raw) continue;
      const norm = normClient(raw);
      if (!out.has(norm)) out.set(norm, raw);
    }
    return out;
  }, [rows, clientNameSet, clientMap, ignoreSet, clientOptions]);

  function handleBulkIgnore() {
    if (distinctUnmappedNames.size === 0) return;
    if (!window.confirm(`Ignore all ${distinctUnmappedNames.size} unmapped Client Name${distinctUnmappedNames.size === 1 ? '' : 's'}? You can undo per row with the ↺ button.`)) return;
    bulkSetDealClientIgnore([...distinctUnmappedNames.values()], true);
  }

  function handleBulkMap() {
    if (!bulkPick) return;
    if (distinctUnmappedNames.size === 0) return;
    if (!window.confirm(`Map all ${distinctUnmappedNames.size} unmapped Client Name${distinctUnmappedNames.size === 1 ? '' : 's'} to "${bulkPick}"?`)) return;
    bulkSetDealClientMapping([...distinctUnmappedNames.values()], bulkPick);
    setBulkPick('');
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Predictive-text source for every Client Name cell. Rendered
          once at the view level so each EditableCell input just
          points at it via the list="..." attribute. */}
      <datalist id={CLIENT_NAME_LIST_ID}>
        {companySuggestions.map(name => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>Deals</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
            {rows.length} deals{source === 'override' ? ' · uploaded' : ''}. Upload an Excel export, or paste from Google Sheets (Cmd/Ctrl+V anywhere here) to add new deals and fill in blanks on the ones already listed.
            {unmappedCount > 0 && (
              <> · <span style={{ color: '#92400E', fontWeight: 700 }}>{unmappedCount} row{unmappedCount === 1 ? '' : 's'} with unmatched Client Names</span>: use the <em>Mapped to Client</em> column to assign or ignore.</>
            )}
            {ignoreSet.size > 0 && (
              <> · <span style={{ color: '#64748B' }}>{ignoreSet.size} ignored</span></>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleUpload}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={addNewDeal}
            title="Add a blank deal row at the top of the table: start typing into any cell to populate it."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid #16A34A', background: '#16A34A', color: '#fff', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >+ New Deal</button>
          <button
            type="button"
            onClick={() => setShowPaste(true)}
            title="Paste tab-separated rows copied from Google Sheets — or just hit Cmd/Ctrl+V anywhere on this page. The next step lets you confirm which pasted column maps to each deal field. New deals are added and deals already here fill in their blank cells; values already on a deal are left alone."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >Paste from Sheets</button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Replace the Deals table by uploading a new Excel file."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >Upload Excel</button>
          <button
            type="button"
            onClick={() => setLinkModalOpen(true)}
            title="Bind deal columns to Dropdowns-tab lists so cells pick from a fixed option list."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >Link columns</button>
          {source === 'override' && (
            <button
              type="button"
              onClick={handleRevert}
              title="Remove the uploaded deals list"
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >Clear</button>
          )}
        </div>
      </div>

      {/* The page's notices — an upload error, the Year 1 import offer, the
          Sold opps with no deal — in one bounded, scrollable strip.
          
          Each of these sits in a fixed-height flex column and refuses to
          shrink, and the Sold-opp warning lists every opp it found. Twenty
          of them made a banner taller than the window, and because the page
          itself doesn't scroll (the table below owns the only scrollbar)
          there was no way to reach the table at all. They keep every row and
          every button; the strip stops at a third of the window and scrolls
          its own contents. */}
      <div style={{ flexShrink: 0, maxHeight: '34vh', overflowY: 'auto' }}>
      {uploadError && (
        <div style={{ margin: '0 1.25rem 0.5rem', padding: '0.5rem 0.75rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#991B1B', fontSize: '0.8rem' }}>
          {uploadError}
        </div>
      )}

      {/* What the last paste import actually changed. A merge touches cells
          scattered through a long table, so the counts are the only way to
          see it happened — dismissible, since it's a receipt, not a task. */}
      {pasteNote && (
        <div style={{ margin: '0 1.25rem 0.5rem', padding: '0.5rem 0.75rem', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 6, color: '#166534', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ flex: 1 }}>{pasteNote}</span>
          <button
            type="button"
            onClick={() => setPasteNote('')}
            aria-label="Dismiss import summary"
            style={{ background: 'transparent', border: 'none', color: '#166534', fontSize: '1rem', lineHeight: 1, cursor: 'pointer', padding: '0 2px' }}
          >×</button>
        </div>
      )}

      {(oppYear1Fills.length > 0 || oppYear1Note) && (
        <div style={{ margin: '0 1.25rem 0.5rem', padding: '0.6rem 0.85rem', background: '#F0FDFA', border: '1px solid #99F6E4', borderRadius: 6, color: '#0F766E', fontSize: '0.8rem', flexShrink: 0 }}>
          {oppYear1Fills.length > 0 ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', marginBottom: 4 }}>
                <strong>
                  {oppYear1Fills.length} deal{oppYear1Fills.length === 1 ? '' : 's'} can take Year 1 figures from {oppYear1Fills.length === 1 ? 'its' : 'their'} opp
                </strong>
                <button
                  type="button"
                  onClick={importOppYear1}
                  title="Write each deal's Year 1 Setup and Year 1 recurring revenue from the Pricing Option saved on the opp its BFO opp name ties it to. Only blank cells are filled — a figure already on the deal is left alone."
                  style={{
                    padding: '0.15rem 0.55rem', background: '#0F766E', border: '1px solid #0F766E',
                    borderRadius: 4, color: '#fff', fontSize: '0.72rem', fontWeight: 700,
                    fontFamily: 'inherit', cursor: 'pointer',
                  }}
                >Import Year 1 figures</button>
              </div>
              <div style={{ fontSize: '0.74rem', marginBottom: 6 }}>
                Their <strong>BFO opp name</strong> matches an opp carrying a saved Pricing Option, and the deal&apos;s
                {' '}<strong>Setup</strong> / <strong>Recurring Revenue</strong> {oppYear1Fills.length === 1 ? 'is' : 'are'} still blank.
                Blank cells only — anything already filled in is left alone. The bracketed figures in the grid are what would be written.
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
                {oppYear1Fills.slice(0, 8).map((f) => (
                  <li key={f.index}>
                    <strong>{f.client || 'Unnamed deal'}</strong>
                    {f.agreement ? <> &middot; {f.agreement}</> : null}
                    {': '}
                    {[
                      f.patch[DEAL_SETUP_KEY] != null ? `Setup ${fmtCurrency(f.patch[DEAL_SETUP_KEY])}` : null,
                      f.patch[DEAL_RECURRING_KEY] != null ? `Recurring ${fmtCurrency(f.patch[DEAL_RECURRING_KEY])}` : null,
                    ].filter(Boolean).join(' · ')}
                    {f.optionName ? <span style={{ color: '#0D9488' }}> (option &ldquo;{f.optionName}&rdquo;)</span> : null}
                    {f.oppCount > 1 ? <span style={{ color: '#B45309' }}> — {f.oppCount} opps share this BFO name; using the first with an option</span> : null}
                  </li>
                ))}
              </ul>
              {oppYear1Fills.length > 8 && (
                <div style={{ fontSize: '0.7rem', marginTop: 4 }}>+{oppYear1Fills.length - 8} more</div>
              )}
            </>
          ) : null}
          {oppYear1Note && (
            <div style={{ fontSize: '0.74rem', fontWeight: 700, marginTop: oppYear1Fills.length > 0 ? 6 : 0 }}>{oppYear1Note}</div>
          )}
        </div>
      )}

      {visibleSoldMissing.length > 0 && (
        <div style={{ margin: '0 1.25rem 0.5rem', padding: '0.6rem 0.85rem', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 6, color: '#92400E', fontSize: '0.8rem', flexShrink: 0 }}>
          {/* The heading folds the banner and carries the one action that
              applies to every row in it. What the heading says never changes
              with the fold — the count is the warning, and it keeps showing
              whether or not the list under it is open, which is why Add all
              stays reachable while folded too. The two are siblings rather
              than nested: a button inside a button is neither valid nor
              clickable. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: soldCollapsed ? 0 : 4 }}>
            <button
              type="button"
              onClick={() => {
                const next = !soldCollapsed;
                setSoldCollapsed(next);
                setSoldWarningCollapsed(next);
              }}
              aria-expanded={!soldCollapsed}
              title={soldCollapsed
                ? 'Show the flagged opps'
                : 'Fold this away — the count stays, and the opps come back when you open it'}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0,
                padding: 0, background: 'none', border: 'none', textAlign: 'left',
                font: 'inherit', fontWeight: 700, color: 'inherit', cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: '0.7rem' }}>{soldCollapsed ? '\u25B8' : '\u25BE'}</span>
              <span>
                ⚠ {visibleSoldMissing.length} Sold {visibleSoldMissing.length === 1 ? 'opp has' : 'opps have'} no matching deal here
              </span>
            </button>
            {/* The same seeding as the per-row button, for the whole list. */}
            <button
              type="button"
              onClick={() => addAllDealsFromOpps(visibleSoldMissing)}
              title={`Create ${visibleSoldMissing.length} new deal${visibleSoldMissing.length === 1 ? '' : 's'}, each seeded with its opp's BFO opp name, Client Name, and GM`}
              style={{
                flex: '0 0 auto', padding: '0.15rem 0.6rem', background: '#92400E',
                border: '1px solid #92400E', borderRadius: 4, color: '#fff',
                fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
              }}
            >Add all deals suggested</button>
          </div>
          {!soldCollapsed && (
          <div style={{ fontSize: '0.74rem', marginBottom: 6 }}>
            These opportunities are marked <strong>Sold</strong> in Opps but their BFO opp name isn&apos;t on the Deals page. Add the deal (or set the opp&apos;s BFO Opportunity Name) so it shows up here.
          </div>
          )}
          {!soldCollapsed && (<>
          {/* The list scrolls inside the banner rather than growing it: every
              flagged opp keeps its Add / Ignore buttons, while the heading
              above stays put and the table below stays on screen. */}
          <ul style={{
            margin: 0, paddingLeft: '1.1rem', paddingRight: '0.25rem',
            display: 'flex', flexDirection: 'column', gap: 3,
            maxHeight: '24vh', overflowY: 'auto',
          }}>
            {visibleSoldMissing.map((o) => (
              <li key={o.ignoreKey} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span>
                  <strong>{o.account || 'Unknown account'}</strong>
                  {o.scope ? <> &middot; {o.scope}</> : null}
                  {o.bfo
                    ? <span style={{ color: '#B45309' }}>: BFO opp name &ldquo;{o.bfo}&rdquo; not found on Deals</span>
                    : <span style={{ color: '#B45309' }}>: no BFO opp name set</span>}
                </span>
                <button
                  type="button"
                  onClick={() => addDealFromOpp(o)}
                  title="Create a new deal seeded with this opp's BFO opp name, Client Name, and GM"
                  style={{
                    flex: '0 0 auto', padding: '0 0.45rem', background: '#92400E',
                    border: '1px solid #92400E', borderRadius: 4, color: '#fff',
                    fontSize: '0.68rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                  }}
                >Add to new deal</button>
                <button
                  type="button"
                  onClick={() => setSoldWarningIgnore(o.ignoreKey, true)}
                  title="Stop warning about this opp"
                  style={{
                    flex: '0 0 auto', padding: '0 0.4rem', background: 'transparent',
                    border: '1px solid #FCD34D', borderRadius: 4, color: '#92400E',
                    fontSize: '0.68rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                  }}
                >Ignore</button>
              </li>
            ))}
          </ul>
          {ignoredSoldCount > 0 && (
            <div style={{ fontSize: '0.7rem', marginTop: 6 }}>
              {ignoredSoldCount} ignored ·{' '}
              <button
                type="button"
                onClick={() => clearSoldWarningIgnore()}
                style={{ padding: 0, background: 'none', border: 'none', color: '#92400E', textDecoration: 'underline', fontSize: '0.7rem', fontFamily: 'inherit', cursor: 'pointer' }}
              >Reset</button>
            </div>
          )}
          </>)}
        </div>
      )}

      {visibleSoldMissing.length === 0 && ignoredSoldCount > 0 && (
        <div style={{ margin: '0 1.25rem 0.5rem', fontSize: '0.7rem', color: '#94A3B8', flexShrink: 0 }}>
          {ignoredSoldCount} Sold-opp {ignoredSoldCount === 1 ? 'warning' : 'warnings'} ignored ·{' '}
          <button
            type="button"
            onClick={() => clearSoldWarningIgnore()}
            style={{ padding: 0, background: 'none', border: 'none', color: '#64748B', textDecoration: 'underline', fontSize: '0.7rem', fontFamily: 'inherit', cursor: 'pointer' }}
          >Reset</button>
        </div>
      )}
      </div>

      <div style={{ padding: '0 1.25rem 0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter deals…"
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
          {filtered.length} of {rows.length}
        </span>
        {clientNameSet.size > 0 && (
          <button
            type="button"
            onClick={() => setOnlyUnmapped(v => !v)}
            disabled={unmappedCount === 0 && !onlyUnmapped}
            title={unmappedCount === 0 ? 'No unmapped rows remain' : (onlyUnmapped ? 'Show all rows' : 'Show only rows whose Client Name is not yet mapped or matched')}
            style={{
              padding: '0.35rem 0.7rem',
              border: '1px solid',
              borderColor: onlyUnmapped ? '#92400E' : '#FCD34D',
              borderRadius: 6,
              background: onlyUnmapped ? '#92400E' : '#FFFBEB',
              color: onlyUnmapped ? '#fff' : '#92400E',
              fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit',
              cursor: (unmappedCount === 0 && !onlyUnmapped) ? 'not-allowed' : 'pointer',
              opacity: (unmappedCount === 0 && !onlyUnmapped) ? 0.5 : 1,
            }}
          >{onlyUnmapped ? `✓ Showing unmapped (${unmappedCount})` : `Show only unmapped (${unmappedCount})`}</button>
        )}
        <button
          type="button"
          onClick={() => setOnlyIncomplete(v => !v)}
          disabled={incompleteCount === 0 && !onlyIncomplete}
          title={incompleteCount === 0
            ? 'Every deal has a fully-checked Handoff progress'
            : (onlyIncomplete
                ? 'Show all rows'
                : `Show only deals whose Handoff progress is less than ${PROGRESS_FIELDS.length}/${PROGRESS_FIELDS.length}`)}
          style={{
            padding: '0.35rem 0.7rem',
            border: '1px solid',
            borderColor: onlyIncomplete ? '#991B1B' : '#FCA5A5',
            borderRadius: 6,
            background: onlyIncomplete ? '#991B1B' : '#FEF2F2',
            color: onlyIncomplete ? '#fff' : '#991B1B',
            fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit',
            cursor: (incompleteCount === 0 && !onlyIncomplete) ? 'not-allowed' : 'pointer',
            opacity: (incompleteCount === 0 && !onlyIncomplete) ? 0.5 : 1,
          }}
        >{onlyIncomplete
          ? `✓ Showing incomplete (${incompleteCount})`
          : `Show only < ${PROGRESS_FIELDS.length}/${PROGRESS_FIELDS.length} (${incompleteCount})`}</button>
        {(() => {
          const visibleIds = filtered.map(r => r.id);
          const visibleCount = visibleIds.length;
          const allSelected = visibleCount > 0 && visibleIds.every(id => selectedIds.has(id));
          return (
            <button
              type="button"
              onClick={() => {
                if (allSelected) {
                  setSelectedIds(prev => {
                    const next = new Set(prev);
                    for (const id of visibleIds) next.delete(id);
                    return next;
                  });
                } else {
                  setSelectedIds(prev => {
                    const next = new Set(prev);
                    for (const id of visibleIds) next.add(id);
                    return next;
                  });
                }
              }}
              disabled={visibleCount === 0}
              title={visibleCount === 0
                ? 'No rows visible to select'
                : allSelected
                  ? `Deselect the ${visibleCount} visible row${visibleCount === 1 ? '' : 's'}`
                  : `Tick the bulk-edit checkbox on every visible row (${visibleCount})`}
              style={{
                padding: '0.35rem 0.7rem',
                border: '1px solid',
                borderColor: allSelected ? '#1D4ED8' : '#93C5FD',
                borderRadius: 6,
                background: allSelected ? '#1D4ED8' : '#EFF6FF',
                color: allSelected ? '#fff' : '#1D4ED8',
                fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit',
                cursor: visibleCount === 0 ? 'not-allowed' : 'pointer',
                opacity: visibleCount === 0 ? 0.5 : 1,
              }}
            >{allSelected ? `✓ All visible selected (${visibleCount})` : `Select all (${visibleCount})`}</button>
          );
        })()}
      </div>

      {selectedIds.size > 0 && (() => {
        const link = bulkEditColumn ? resolveColumnLink(bulkEditColumn, columnLinks) : null;
        const linkedOpts = link ? (listRegistry?.get(link.listKey)?.options || []) : null;
        return (
          <div style={{ margin: '0 1.25rem 0.5rem', padding: '0.5rem 0.75rem', background: '#EFF6FF', border: '1px solid #93C5FD', borderRadius: 6, display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
            <strong style={{ fontSize: '0.72rem', color: '#1D4ED8' }}>
              {selectedIds.size} selected
            </strong>
            <span style={{ fontSize: '0.7rem', color: '#1E40AF' }}>· set</span>
            <select
              value={bulkEditColumn}
              onChange={(e) => { setBulkEditColumn(e.target.value); setBulkEditValue(''); }}
              style={{ padding: '0.25rem 0.4rem', border: '1px solid #93C5FD', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', background: '#fff', color: '#1E293B', maxWidth: 220 }}
            >
              <option value="">(Column…)</option>
              {linkableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <span style={{ fontSize: '0.7rem', color: '#1E40AF' }}>=</span>
            {linkedOpts ? (
              <select
                value={bulkEditValue}
                onChange={(e) => setBulkEditValue(e.target.value)}
                disabled={!bulkEditColumn}
                style={{ padding: '0.25rem 0.4rem', border: '1px solid #93C5FD', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', background: '#fff', color: '#1E293B', maxWidth: 220 }}
              >
                <option value="">(clear)</option>
                {linkedOpts.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            ) : (
              <input
                type="text"
                value={bulkEditValue}
                onChange={(e) => setBulkEditValue(e.target.value)}
                placeholder="New value (blank = clear)"
                disabled={!bulkEditColumn}
                style={{ padding: '0.25rem 0.4rem', border: '1px solid #93C5FD', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', background: bulkEditColumn ? '#fff' : '#F1F5F9', color: '#1E293B', minWidth: 160 }}
              />
            )}
            <button
              type="button"
              onClick={() => {
                if (!bulkEditColumn) return;
                const label = bulkEditValue === ''
                  ? `Clear ${bulkEditColumn} on ${selectedIds.size} deal${selectedIds.size === 1 ? '' : 's'}?`
                  : `Set ${bulkEditColumn} to "${bulkEditValue}" on ${selectedIds.size} deal${selectedIds.size === 1 ? '' : 's'}?`;
                if (!window.confirm(label)) return;
                applyBulkEdit();
              }}
              disabled={!bulkEditColumn}
              style={{ padding: '0.3rem 0.7rem', border: 'none', borderRadius: 4, background: bulkEditColumn ? '#1D4ED8' : '#94A3B8', color: '#fff', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: bulkEditColumn ? 'pointer' : 'not-allowed' }}
            >Apply to {selectedIds.size}</button>
            <span style={{ fontSize: '0.7rem', color: '#1E40AF' }}>·</span>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(`Mark ${selectedIds.size} deal${selectedIds.size === 1 ? '' : 's'} as Ignored? Their Handoff progress pills will grey out.`)) return;
                applyBulkIgnore('ignore');
              }}
              title="Grey out the Handoff progress pill on every selected deal"
              style={{ padding: '0.3rem 0.7rem', border: '1px solid #64748B', borderRadius: 4, background: '#64748B', color: '#fff', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
            >✕ Ignore {selectedIds.size}</button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(`Restore ${selectedIds.size} deal${selectedIds.size === 1 ? '' : 's'} into the Handoff progress tally?`)) return;
                applyBulkIgnore('restore');
              }}
              title="Re-include the selected deals in the Handoff progress tally"
              style={{ padding: '0.3rem 0.7rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
            >↻ Restore</button>
            <button
              type="button"
              onClick={clearSelection}
              style={{ padding: '0.3rem 0.7rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
            >Clear selection</button>
          </div>
        );
      })()}

      {onlyUnmapped && distinctUnmappedNames.size > 0 && (
        <div style={{ margin: '0 1.25rem 0.5rem', padding: '0.5rem 0.75rem', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 6, display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
          <strong style={{ fontSize: '0.72rem', color: '#92400E' }}>
            {distinctUnmappedNames.size} distinct unmapped Client Name{distinctUnmappedNames.size === 1 ? '' : 's'}
          </strong>
          <span style={{ fontSize: '0.7rem', color: '#92400E' }}>· apply to all:</span>
          <select
            value={bulkPick}
            onChange={(e) => setBulkPick(e.target.value)}
            style={{ padding: '0.25rem 0.4rem', border: '1px solid #FCD34D', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', background: '#fff', color: '#1E293B', maxWidth: 280 }}
          >
            <option value="">(Map all to client…)</option>
            {clientOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            type="button"
            onClick={handleBulkMap}
            disabled={!bulkPick}
            style={{ padding: '0.3rem 0.7rem', border: 'none', borderRadius: 4, background: bulkPick ? '#16A34A' : '#94A3B8', color: '#fff', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: bulkPick ? 'pointer' : 'not-allowed' }}
          >Map all</button>
          <span style={{ fontSize: '0.7rem', color: '#92400E' }}>or</span>
          <button
            type="button"
            onClick={handleBulkIgnore}
            style={{ padding: '0.3rem 0.7rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
          >✕ Ignore all unmapped</button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {rows.length === 0 ? (
          <div style={{ margin: '0 1.25rem', padding: '1.25rem', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569', textAlign: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>No deals yet</div>
            <div style={{ fontSize: '0.78rem' }}>
              Click <strong>+ New Deal</strong> to add a blank row and type into the cells, <strong>Paste from Sheets</strong> (or just Cmd/Ctrl+V on this page) to drop in copied Google Sheets rows, or <strong>Upload Excel</strong> for a workbook.
            </div>
          </div>
        ) : (
          <DataTable
            key={tableId}
            tableId={tableId}
            columns={columns}
            rows={filtered}
            defaultSort={{ key: 'Days/Paid on', direction: 'desc' }}
            alwaysVisible={alwaysVisible}
            rowStyle={(row) => {
              // A deal marked On track or Completed reads green down the
              // whole row — the point of the status is to see, without
              // reading a column, which deals still need chasing.
              //
              // It wins over the unmatched-client amber below: the amber
              // says a Client Name hasn't been mapped, which the header
              // count and the "Show only unmapped" filter both still say,
              // while the green is a call the user made on this deal by
              // hand and would look ignored if a row swallowed it.
              if (isDealTrackHealthy(row)) return { background: '#F0FDF4' };
              if (clientNameSet.size === 0) return undefined;
              const raw = String(row['Client Name'] || '').trim();
              if (!raw) return undefined;
              const norm = normClient(raw);
              if (clientNameSet.has(norm)) return undefined;
              if (clientMap[norm]) return undefined;
              if (ignoreSet.has(norm)) return undefined;
              return { background: '#FFFBEB' };
            }}
            emptyMessage={search ? `No deals match "${search}"` : 'No deals to display'}
            enableColumnFilters
            // Name the downloaded workbook "Deal Export - <date>.xlsx".
            exportFileName="Deal Export"
            // Always include Commission and the derived Year in the Excel
            // export, even when the user has hidden them on screen.
            exportExtraColumnKeys={['Commission', 'Year']}
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
      </div>
      {showPaste && (
        <PasteImportModal
          onClose={() => { setShowPaste(false); setInitialPaste(''); }}
          onImport={handlePasteImport}
          initialPaste={initialPaste}
          existingRows={data}
        />
      )}
      {linkModalOpen && (
        <LinkColumnsModal
          headers={linkableHeaders}
          columnLinks={columnLinks}
          listRegistry={listRegistry}
          availableLists={availableLists}
          onChange={updateColumnLinks}
          onClose={() => setLinkModalOpen(false)}
        />
      )}
      {historyRowId != null && data[historyRowId] && (
        <DealHistoryModal
          // Keyed on the row so opening a different deal remounts the modal
          // — its projection inputs seed from the deal being shown, and a
          // plain prop update would leave the previous deal's numbers in.
          key={historyRowId}
          deal={data[historyRowId]}
          commissionsRows={commissionsData}
          onClose={() => setHistoryRowId(null)}
          // The per-metric popup stacks on top (higher z-index) and closing
          // it drops back to the history modal, so the deep dive doesn't
          // lose the user their place.
          onOpenBreakdown={(metric) => setBreakdown({ rowId: historyRowId, metric })}
          onUpdateDeal={(patch) => updateCells(historyRowId, patch)}
        />
      )}
      {breakdown && data[breakdown.rowId] && (
        <DealCommissionBreakdownModal
          deal={data[breakdown.rowId]}
          metric={breakdown.metric}
          commissionsRows={commissionsData}
          onClose={() => setBreakdown(null)}
        />
      )}
    </div>
  );
}
