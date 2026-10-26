// The Companies popup on Bulk Add Contacts: one line per company across the
// batch, with its Tier, Status and CDM. Columns can be hidden and resized
// (both remembered in this browser), every column has a filter box, and the
// ticked companies' contacts can be taken out of the batch in one go.
//
// The grouping itself (which rows belong to which company, what its Tier
// reads as) is the caller's: it is the same rule the grid uses, so it lives
// next to the grid.
import { useEffect, useMemo, useRef, useState } from 'react';
import { STATUS_COLORS } from '../../data/enums';
import { useSyncedTablePref, SET_PREF } from '../../hooks/useSyncedTablePref';
import { lsHas } from '../../utils/tablePrefsSync';
import { cellMatches, collectSuggestions, BLANKS_FILTER, NON_BLANKS_FILTER } from '../../utils/columnFilter';

const COLS = [
  { key: 'name',   label: 'Company',        w: 320, toggleable: false },
  { key: 'tier',   label: 'Tier',           w: 90 },
  { key: 'status', label: 'Company Status', w: 170 },
  { key: 'cdm',    label: 'CDM',            w: 240 },
  { key: 'count',  label: 'Contacts',       w: 100, numeric: true },
];
const WIDTHS_KEY = 'bulk-companies-col-widths';
const HIDDEN_KEY = 'bulk-companies-col-hidden';
// What this table's layout is called in settings.tablePrefs, so the widths
// and hidden columns follow the user to another machine. The local keys
// above still draw the first paint.
const PREFS_TABLE_ID = 'bulk-companies';
const asWidthMap = (m) => (m && typeof m === 'object' && !Array.isArray(m) ? m : {});
const SELECT_W = 36;

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}

// The whole page shows the resize cursor, and drags no text, while a
// column edge is being dragged.
function setBodyResizing(on) {
  document.body.style.cursor = on ? 'col-resize' : '';
  document.body.style.userSelect = on ? 'none' : '';
}

// What a column's filter matches against and what its box suggests.
function cellText(c, key) {
  if (key === 'count') return String(c.count);
  if (key === 'name') return c.name || '';
  return c[key] || '';
}

// The colour each Bulk Add status reads in, matching the grid's groups.
const STATUS_TONES = {
  'New':            ['#1D4ED8', '#DBEAFE'],
  'Update pending': ['#92400E', '#FEF3C7'],
  'In HubSpot':     ['#475569', '#F1F5F9'],
  'Added':          ['#15803D', '#DCFCE7'],
  'Updated':        ['#15803D', '#DCFCE7'],
  'Error':          ['#B91C1C', '#FEE2E2'],
};

// The contact popup's columns, and the text each one shows, filters on and
// suggests.
const CONTACT_COLS = [
  { key: 'name',     label: 'Name',      text: (r) => [r.firstname, r.lastname].filter(Boolean).join(' ') },
  { key: 'email',    label: 'Email',     text: (r) => r.email || '' },
  { key: 'jobtitle', label: 'Job title', text: (r) => r.jobtitle || '' },
  { key: 'status',   label: 'Status',    text: (r, statusOf) => (statusOf ? statusOf(r) : '') },
  { key: 'location', label: 'Location',  text: (r) => [r.city, r.state, r.country].map(v => String(v || '').trim()).filter(Boolean).join(', ') },
];

// One company's Bulk Add rows, opened from its Contacts count. Every column
// filters; each row's x takes that contact out of the batch, the same as
// the grid's x, and Remove shown takes out every row the filters leave.
function CompanyContactsModal({ company, statusOf, onClose, onRemove }) {
  const [filters, setFilters] = useState({});
  const th = { textAlign: 'left', padding: '0.45rem 0.6rem', fontSize: '0.68rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em', background: '#F8FAFC', whiteSpace: 'nowrap' };
  const td = { padding: '0.4rem 0.6rem', fontSize: '0.78rem', borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle' };
  const btn = { padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', borderRadius: 6, background: '#fff', color: 'var(--color-text-secondary)', fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
  const blank = <span style={{ color: '#CBD5E1' }}>-</span>;
  const sorted = [...company.rows].sort((a, b) =>
    `${a.lastname || ''} ${a.firstname || ''} ${a.email}`.localeCompare(`${b.lastname || ''} ${b.firstname || ''} ${b.email}`));
  const active = CONTACT_COLS.filter(c => String(filters[c.key] || '').trim());
  const shown = active.length
    ? sorted.filter(r => active.every(c => cellMatches(c.text(r, statusOf), filters[c.key])))
    : sorted;
  const suggestions = Object.fromEntries(CONTACT_COLS.map(c => [c.key, collectSuggestions(sorted.map(r => c.text(r, statusOf)))]));

  function removeShown() {
    if (!shown.length) return;
    const what = active.length ? `the ${shown.length} contact${shown.length === 1 ? '' : 's'} these filters show` : `all ${shown.length} contact${shown.length === 1 ? '' : 's'}`;
    if (!window.confirm(`Remove ${what} at ${company.name || 'no company'} from Bulk Add Contacts?\n\nThis only takes them out of this batch. Nothing in HubSpot changes.`)) return;
    onRemove(shown.map(r => r.email));
    setFilters({});
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1110, padding: '2rem' }}
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        style={{ background: '#fff', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', width: 'min(1200px, 100%)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>
              {company.name || 'No company'}: {company.count} contact{company.count === 1 ? '' : 's'} in this batch
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '0.25rem' }}>
              Only this company&apos;s rows in Bulk Add Contacts. The x takes a contact out of the batch; nothing in HubSpot changes.
            </div>
          </div>
          <button type="button" onClick={onClose} title="Back to companies" style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '1.2rem', padding: 0, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '0.6rem 1.25rem', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={removeShown}
            disabled={!shown.length}
            title="Take every contact the filters leave showing out of the batch"
            style={shown.length
              ? { ...btn, background: '#DC2626', borderColor: '#DC2626', color: '#fff' }
              : { ...btn, color: '#94A3B8', cursor: 'default' }}
          >
            {active.length ? `Remove ${shown.length} shown` : `Remove all ${shown.length}`}
          </button>
          {active.length > 0 && (
            <>
              <span style={{ fontSize: '0.74rem', color: '#64748B' }}>Showing {shown.length} of {sorted.length}</span>
              <button type="button" style={btn} onClick={() => setFilters({})}>Clear filters</button>
            </>
          )}
        </div>
        <div style={{ overflow: 'auto', minHeight: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
              <tr>
                {CONTACT_COLS.map(c => <th key={c.key} style={th}>{c.label}</th>)}
                <th style={{ ...th, width: 36 }} />
              </tr>
              <tr>
                {CONTACT_COLS.map(c => (
                  <th key={c.key} style={{ padding: '2px 4px 6px', background: '#F8FAFC', borderBottom: '1px solid var(--color-border)' }}>
                    <input
                      type="text"
                      value={filters[c.key] || ''}
                      onChange={e => setFilters(prev => ({ ...prev, [c.key]: e.target.value }))}
                      placeholder="Filter..."
                      list={`bulk-company-contacts-filter-${c.key}`}
                      title={`Type to filter, or pick ${BLANKS_FILTER} / ${NON_BLANKS_FILTER}`}
                      style={{ width: '100%', padding: '2px 6px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.7rem', fontFamily: 'inherit', boxSizing: 'border-box', fontWeight: 400 }}
                    />
                    <datalist id={`bulk-company-contacts-filter-${c.key}`}>
                      <option value={BLANKS_FILTER} />
                      <option value={NON_BLANKS_FILTER} />
                      {suggestions[c.key].map(v => <option key={v} value={v} />)}
                    </datalist>
                  </th>
                ))}
                <th style={{ background: '#F8FAFC', borderBottom: '1px solid var(--color-border)' }} />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={CONTACT_COLS.length + 1} style={{ ...td, textAlign: 'center', color: '#94A3B8', fontStyle: 'italic', padding: '1.25rem' }}>No contacts match these filters.</td>
                </tr>
              )}
              {shown.map(r => {
                const [name, , , status, location] = CONTACT_COLS.map(c => c.text(r, statusOf));
                const [fg, bg] = STATUS_TONES[status] || ['#475569', '#F1F5F9'];
                return (
                  <tr key={r.email}>
                    <td style={{ ...td, fontWeight: 600 }}>{name || blank}</td>
                    <td style={{ ...td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.74rem' }}>{r.email}</td>
                    <td style={td}>{r.jobtitle || blank}</td>
                    <td style={td}>
                      {status ? <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '1px 8px', borderRadius: 999, color: fg, background: bg, whiteSpace: 'nowrap' }}>{status}</span> : blank}
                    </td>
                    <td style={td}>{location || blank}</td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => onRemove([r.email])}
                        title="Remove this contact from the batch"
                        style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '0.95rem', padding: '0 4px', lineHeight: 1 }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#DC2626'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#94A3B8'; }}
                      >×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function BulkCompaniesModal({ companies, rowCount, onClose, onOpenCompany, onRemoveContacts, statusOf, settings = null, updateSettings = null }) {
  const [widths, setWidths] = useSyncedTablePref({
    tableId: PREFS_TABLE_ID, field: 'widths', settings, updateSettings,
    readLocal: () => asWidthMap(loadJson(WIDTHS_KEY, {})),
    writeLocal: (w) => saveJson(WIDTHS_KEY, w),
    hasLocal: () => lsHas(WIDTHS_KEY),
    fromRemote: asWidthMap,
  });
  const [hidden, setHidden] = useSyncedTablePref({
    tableId: PREFS_TABLE_ID, field: 'hidden', settings, updateSettings,
    readLocal: () => { const v = loadJson(HIDDEN_KEY, []); return new Set(Array.isArray(v) ? v : []); },
    writeLocal: (set) => saveJson(HIDDEN_KEY, [...set]),
    hasLocal: () => lsHas(HIDDEN_KEY),
    ...SET_PREF,
  });
  const [filters, setFilters] = useState({});
  const [selected, setSelected] = useState(() => new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  // The company whose contacts are open on top, by key. Looked up in the
  // live list, so removing its last contact closes it.
  const [drillKey, setDrillKey] = useState(null);
  const drillCompany = drillKey ? companies.find(c => c.key === drillKey) : null;
  const pickerRef = useRef(null);

  useEffect(() => {
    // With a company's contacts open on top, Escape steps back to the
    // companies rather than shutting both.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (drillCompany) setDrillKey(null);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, drillCompany]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e) => { if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  const cols = useMemo(() => COLS.filter(c => !hidden.has(c.key)), [hidden]);
  const widthOf = (c) => widths[c.key] || c.w;

  const suggestions = useMemo(() => {
    const out = {};
    for (const col of COLS) out[col.key] = collectSuggestions(companies.map(c => cellText(c, col.key)));
    return out;
  }, [companies]);

  // A hidden column's filter would narrow the list with nothing on screen
  // saying why, so only the shown columns filter.
  const shown = useMemo(() => {
    const active = cols.map(c => [c.key, filters[c.key]]).filter(([, q]) => String(q || '').trim());
    if (!active.length) return companies;
    return companies.filter(c => active.every(([key, q]) => cellMatches(cellText(c, key), q)));
  }, [companies, cols, filters]);

  const filtering = cols.some(c => String(filters[c.key] || '').trim());
  const allShownSelected = shown.length > 0 && shown.every(c => selected.has(c.key));
  const selectedCompanies = companies.filter(c => selected.has(c.key));
  const selectedContactCount = selectedCompanies.reduce((n, c) => n + c.count, 0);

  function startResize(e, col) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(col);
    const move = (ev) => setWidths(prev => ({ ...prev, [col.key]: Math.max(60, startW + ev.clientX - startX) }));
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      setBodyResizing(false);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    setBodyResizing(true);
  }

  function toggleHidden(key) {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleSelected(key) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleAllShown() {
    setSelected(prev => {
      const next = new Set(prev);
      if (allShownSelected) for (const c of shown) next.delete(c.key);
      else for (const c of shown) next.add(c.key);
      return next;
    });
  }

  function removeSelected() {
    if (!selectedCompanies.length) return;
    const names = selectedCompanies.map(c => c.name || 'No company');
    const preview = names.slice(0, 8).join(', ') + (names.length > 8 ? `, and ${names.length - 8} more` : '');
    const msg = `Remove ${selectedContactCount} contact${selectedContactCount === 1 ? '' : 's'} at ${selectedCompanies.length} compan${selectedCompanies.length === 1 ? 'y' : 'ies'} from Bulk Add Contacts?\n\n${preview}\n\nThis only takes them out of this batch. Nothing in HubSpot changes.`;
    if (!window.confirm(msg)) return;
    onRemoveContacts(selectedCompanies.flatMap(c => c.emails));
    setSelected(new Set());
  }

  const btn = {
    padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', borderRadius: 6, background: '#fff',
    color: 'var(--color-text-secondary)', fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  };
  const th = {
    position: 'relative', textAlign: 'left', padding: '0.45rem 0.6rem', fontSize: '0.68rem', fontWeight: 700, color: '#64748B',
    textTransform: 'uppercase', letterSpacing: '0.03em', background: '#F8FAFC', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  };
  const td = { padding: '0.4rem 0.6rem', fontSize: '0.78rem', borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  const blank = <span style={{ color: '#CBD5E1' }}>-</span>;
  const tableWidth = SELECT_W + cols.reduce((n, c) => n + widthOf(c), 0);

  function renderCell(c, col) {
    switch (col.key) {
      case 'name': {
        if (!c.name) return <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>No company</span>;
        if (c.prospect && onOpenCompany) {
          return (
            <button
              type="button"
              onClick={() => onOpenCompany(c.prospect)}
              title={`Open ${c.name}`}
              style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-accent)', fontWeight: 600, fontSize: 'inherit', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >{c.name}</button>
          );
        }
        return <span title={`${c.name}: not matched to a company in the tracker`} style={{ fontWeight: 600 }}>{c.name}</span>;
      }
      case 'status': {
        if (!c.status) return blank;
        const color = STATUS_COLORS[c.status];
        return <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '1px 8px', borderRadius: 999, color: color || '#475569', background: color ? `${color}1A` : '#F1F5F9' }}>{c.status}</span>;
      }
      case 'count': return (
        <button
          type="button"
          onClick={() => setDrillKey(c.key)}
          title={`Show the ${c.count} Bulk Add contact${c.count === 1 ? '' : 's'} at ${c.name || 'no company'}`}
          style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-accent)', fontWeight: 600, fontSize: 'inherit', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2 }}
        >{c.count}</button>
      );
      default: return c[col.key] ? <span title={c[col.key]}>{c[col.key]}</span> : blank;
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1.25rem' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', width: 'min(1400px, 100%)', height: '92vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '1rem 1.25rem 0.75rem', borderBottom: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>
                Companies in this batch ({filtering ? `${shown.length} of ${companies.length}` : companies.length})
              </div>
              <div style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '0.25rem' }}>
                Every company across the {rowCount} Bulk Add contact{rowCount === 1 ? '' : 's'}, most contacts first. Tick companies to remove their contacts from the batch.
              </div>
            </div>
            <button type="button" onClick={onClose} title="Close" style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '1.2rem', padding: 0, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={removeSelected}
              disabled={!selectedCompanies.length}
              title="Take every contact at the ticked companies out of Bulk Add Contacts"
              style={selectedCompanies.length
                ? { ...btn, background: '#DC2626', borderColor: '#DC2626', color: '#fff' }
                : { ...btn, color: '#94A3B8', cursor: 'default' }}
            >
              {selectedCompanies.length
                ? `Remove ${selectedContactCount} contact${selectedContactCount === 1 ? '' : 's'} (${selectedCompanies.length} compan${selectedCompanies.length === 1 ? 'y' : 'ies'})`
                : 'Remove contacts'}
            </button>
            {selectedCompanies.length > 0 && (
              <button type="button" style={btn} onClick={() => setSelected(new Set())}>Clear selection</button>
            )}
            <span style={{ flex: 1 }} />
            {filtering && (
              <button type="button" style={btn} onClick={() => setFilters({})}>Clear filters</button>
            )}
            <div ref={pickerRef} style={{ position: 'relative' }}>
              <button type="button" style={btn} onClick={() => setPickerOpen(v => !v)}>
                Columns ({cols.length}/{COLS.length})
              </button>
              {pickerOpen && (
                <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 10, background: '#fff', border: '1px solid var(--color-border)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: '0.35rem', minWidth: 190 }}>
                  {COLS.map(col => (
                    <label
                      key={col.key}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.3rem 0.45rem', fontSize: '0.78rem', borderRadius: 4, cursor: col.toggleable === false ? 'default' : 'pointer', color: col.toggleable === false ? '#94A3B8' : 'var(--color-text)' }}
                    >
                      <input
                        type="checkbox"
                        checked={!hidden.has(col.key)}
                        disabled={col.toggleable === false}
                        onChange={() => toggleHidden(col.key)}
                      />
                      {col.label}
                    </label>
                  ))}
                  {Object.keys(widths).length > 0 && (
                    <button
                      type="button"
                      onClick={() => setWidths({})}
                      style={{ ...btn, width: '100%', marginTop: 4, fontSize: '0.7rem' }}
                    >Reset column widths</button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', width: tableWidth, minWidth: '100%' }}>
            <colgroup>
              <col style={{ width: SELECT_W }} />
              {cols.map(c => <col key={c.key} style={{ width: widthOf(c) }} />)}
            </colgroup>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
              <tr>
                <th style={{ ...th, textAlign: 'center', padding: '0.45rem 0' }}>
                  <input
                    type="checkbox"
                    checked={allShownSelected}
                    onChange={toggleAllShown}
                    disabled={!shown.length}
                    title={allShownSelected ? 'Untick every company shown' : 'Tick every company shown'}
                  />
                </th>
                {cols.map(c => (
                  <th key={c.key} style={{ ...th, textAlign: c.numeric ? 'right' : 'left' }} title={c.label}>
                    {c.label}
                    <span
                      onMouseDown={(e) => startResize(e, c)}
                      title="Drag to resize"
                      style={{ position: 'absolute', right: 0, top: '20%', bottom: '20%', width: 7, cursor: 'col-resize', borderRight: '2px solid var(--color-border-light)' }}
                    />
                  </th>
                ))}
              </tr>
              <tr>
                <th style={{ background: '#F8FAFC', borderBottom: '1px solid var(--color-border)' }} />
                {cols.map(c => (
                  <th key={c.key} style={{ padding: '2px 4px 6px', background: '#F8FAFC', borderBottom: '1px solid var(--color-border)' }}>
                    <input
                      type="text"
                      value={filters[c.key] || ''}
                      onChange={e => setFilters(prev => ({ ...prev, [c.key]: e.target.value }))}
                      placeholder="Filter..."
                      list={`bulk-companies-filter-${c.key}`}
                      title={`Type to filter, or pick ${BLANKS_FILTER} / ${NON_BLANKS_FILTER}`}
                      style={{ width: '100%', padding: '2px 6px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.7rem', fontFamily: 'inherit', boxSizing: 'border-box', fontWeight: 400 }}
                    />
                    <datalist id={`bulk-companies-filter-${c.key}`}>
                      <option value={BLANKS_FILTER} />
                      <option value={NON_BLANKS_FILTER} />
                      {suggestions[c.key].map(v => <option key={v} value={v} />)}
                    </datalist>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(c => {
                const isSel = selected.has(c.key);
                return (
                  <tr key={c.key} style={{ background: isSel ? '#FEF2F2' : undefined }}>
                    <td style={{ ...td, textAlign: 'center', padding: '0.4rem 0' }}>
                      <input type="checkbox" checked={isSel} onChange={() => toggleSelected(c.key)} />
                    </td>
                    {cols.map(col => (
                      <td key={col.key} style={{ ...td, textAlign: col.numeric ? 'right' : 'left', color: col.numeric ? '#475569' : undefined }}>
                        {renderCell(c, col)}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={cols.length + 1} style={{ ...td, textAlign: 'center', color: '#94A3B8', fontStyle: 'italic', padding: '1.25rem' }}>
                    {companies.length ? 'No companies match these filters.' : 'No contacts in the batch.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {drillCompany && (
        <CompanyContactsModal
          company={drillCompany}
          statusOf={statusOf}
          onClose={() => setDrillKey(null)}
          onRemove={onRemoveContacts}
        />
      )}
    </div>
  );
}
