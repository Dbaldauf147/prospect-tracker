import { useEffect, useMemo, useState } from 'react';
import {
  loadClientStatusMap, CLIENT_STATUS_EVENT,
  loadClientNotesMap, CLIENT_NOTES_EVENT,
} from '../../utils/clientManagerStore';
import { loadCoaItemOptions, saveCoaItemOptions, COA_ITEM_OPTIONS_EVENT } from '../../utils/coaItemOptions';
import {
  asDate, fmtCurrency, fmtPercent, fmtDate, isTruthy, isInactiveAgreement,
  DEAL_CURRENCY_KEYS, DEAL_DATE_KEYS, DEAL_PERCENT_KEYS, DEAL_CHECK_KEYS,
} from '../../utils/dealsFormat';
import {
  contractsSummary, coaRequirementRows, setCoaRequirement,
  coaRequirementsSummary, renameCoaRequirement, COA_REQUIRED_OPTIONS,
} from '../../utils/clientContracts';

// The company card's Contracts tab: the client's standing on the Clients tab,
// its agreements off the Deals subtab, and which COA exceptions its contracts
// need. See utils/clientContracts.js for the matching and the stored shape.

const MS_PER_DAY = 86400000;

// A per-company value off one of the Clients tab's maps, refreshed on its
// change event.
function useClientMapValue(load, eventName, company) {
  const [map, setMap] = useState(load);
  useEffect(() => {
    const refresh = () => setMap(load());
    window.addEventListener(eventName, refresh);
    return () => window.removeEventListener(eventName, refresh);
  }, [load, eventName]);
  return map[String(company || '').trim().toLowerCase()] || '';
}

const CONTRACT_COLUMNS = [
  { key: 'Agreement Name',          label: 'Agreement Name', minWidth: 280 },
  { key: 'Paperwork completed',     label: 'Paperwork', minWidth: 120 },
  { key: 'Original Contract Start', label: 'Original Start' },
  { key: 'Current Term Start Date', label: 'Current Term Start' },
  { key: 'End Date',                label: 'End Date' },
  { key: '__daysToEnd',             label: 'Days to End' },
  { key: 'Auto renewal?',           label: 'Auto renewal?' },
  { key: 'Esc',                     label: 'Esc' },
  { key: 'Payment Terms',           label: 'Payment Terms' },
  { key: 'Setup',                   label: 'Setup' },
  { key: 'Recurring Revenue',       label: 'Recurring' },
];

const muted = { color: '#94A3B8' };
const th = {
  padding: '0.35rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700,
  fontSize: '0.65rem', whiteSpace: 'nowrap', borderBottom: '1px solid #CBD5E1',
};
const td = { padding: '0.3rem 0.5rem', borderBottom: '1px solid #E2E8F0', verticalAlign: 'middle' };
const sectionTitle = {
  fontSize: '0.72rem', fontWeight: 700, color: '#334155', textTransform: 'uppercase',
  letterSpacing: '0.05em', margin: '0 0 0.4rem',
};
const hint = { fontSize: '0.72rem', color: '#64748B', margin: '0 0 0.5rem' };

function daysToEndCell(endRaw, inactive) {
  const d = asDate(endRaw);
  if (!d) return <span style={muted}>-</span>;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
  const color = inactive ? '#94A3B8' : days < 0 ? '#B91C1C' : days <= 30 ? '#92400E' : '#334155';
  return <span style={{ color, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{days}</span>;
}

function contractCell(key, value) {
  if (value == null || value === '') return <span style={muted}>-</span>;
  if (DEAL_CHECK_KEYS.has(key)) {
    const yes = isTruthy(value);
    return (
      <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: yes ? '#DCFCE7' : '#F1F5F9', color: yes ? '#166534' : '#64748B' }}>
        {yes ? 'Yes' : (typeof value === 'string' && value.trim() ? value : 'No')}
      </span>
    );
  }
  if (DEAL_CURRENCY_KEYS.has(key)) return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCurrency(value)}</span>;
  if (DEAL_PERCENT_KEYS.has(key)) return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtPercent(value)}</span>;
  if (DEAL_DATE_KEYS.has(key)) return <span>{fmtDate(value)}</span>;
  return <span>{String(value)}</span>;
}

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ padding: '0.45rem 0.7rem', border: '1px solid #E2E8F0', borderRadius: 8, background: '#F8FAFC', minWidth: 120 }}>
      <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: color || '#0F172A', marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.65rem', color: '#64748B', marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

const REQUIRED_COLORS = {
  yes: { background: '#FEF3C7', color: '#92400E', border: '#FDE68A' },
  no: { background: '#F1F5F9', color: '#475569', border: '#CBD5E1' },
  '': { background: '#FFFFFF', color: '#64748B', border: '#CBD5E1' },
};

// Notes cell: keeps its own draft so the debounced autosave of the record
// doesn't fight the cursor, and commits on blur.
function NotesInput({ value, onCommit }) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) { setPrev(value); setDraft(value); }
  return (
    <input
      type="text"
      value={draft}
      placeholder="Add notes, e.g. MSA clause 4.2"
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      style={{ width: '100%', boxSizing: 'border-box', fontSize: '0.72rem', padding: '0.25rem 0.4rem', border: '1px solid #CBD5E1', borderRadius: 4, fontFamily: 'inherit' }}
    />
  );
}

// The item name while the list is being edited: rename in place (blur or
// Enter commits, Escape reverts, emptying removes). Same feel as a row on the
// Dropdowns COA Items tab, since it edits that same list.
function ItemNameInput({ value, onCommit }) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) { setPrev(value); setDraft(value); }
  return (
    <input
      type="text"
      value={draft}
      aria-label={`Rename ${value}`}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(value); setTimeout(() => e.target.blur(), 0); }
      }}
      style={{ flex: 1, minWidth: 0, fontSize: '0.72rem', fontWeight: 600, color: '#1E293B', padding: '0.2rem 0.35rem', border: '1px solid #CBD5E1', borderRadius: 4, fontFamily: 'inherit' }}
    />
  );
}

const iconBtn = {
  flex: '0 0 auto', width: 20, height: 20, lineHeight: 1, padding: 0,
  background: 'transparent', border: '1px solid transparent', borderRadius: 4,
  color: '#94A3B8', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'inherit',
};
const smallBtn = {
  padding: '0.2rem 0.55rem', borderRadius: 6, fontSize: '0.68rem', fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
};

export function ContractsTab({ company, deals, clientManager, coaRequirements, onChangeCoaRequirements }) {
  const status = useClientMapValue(loadClientStatusMap, CLIENT_STATUS_EVENT, company);
  const clientNotes = useClientMapValue(loadClientNotesMap, CLIENT_NOTES_EVENT, company);

  const [catalog, setCatalog] = useState(loadCoaItemOptions);
  useEffect(() => {
    const refresh = () => setCatalog(loadCoaItemOptions());
    window.addEventListener(COA_ITEM_OPTIONS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(COA_ITEM_OPTIONS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const summary = useMemo(() => contractsSummary(deals), [deals]);
  const coaRows = useMemo(() => coaRequirementRows(coaRequirements, catalog), [coaRequirements, catalog]);
  const coaSummary = coaRequirementsSummary(coaRows);

  const update = (item, patch) => onChangeCoaRequirements(setCoaRequirement(coaRequirements, item, patch));

  // Editing the list itself. It is the one shared list (Dropdowns, COA
  // Items), so every change here shows on every company card and every opp.
  const [editingList, setEditingList] = useState(false);
  const [addDraft, setAddDraft] = useState('');

  function commitList(next) {
    saveCoaItemOptions(next);
    setCatalog(loadCoaItemOptions());
  }
  function renameItem(idx, next) {
    const from = catalog[idx];
    const trimmed = String(next || '').trim();
    if (!trimmed) { removeItem(idx); return; }
    if (trimmed === from) return;
    // A rename onto a name already on the list would merge two rows; refuse
    // it rather than silently dropping one.
    if (catalog.some((o, i) => i !== idx && o.toLowerCase() === trimmed.toLowerCase())) {
      window.alert(`"${trimmed}" is already on the COA list.`);
      setCatalog([...catalog]);
      return;
    }
    commitList(catalog.map((it, i) => (i === idx ? trimmed : it)));
    // Carry this company's own answer across. Other companies keep theirs
    // under the old name, shown as "removed from list" until re-answered.
    const moved = renameCoaRequirement(coaRequirements, from, trimmed);
    if (JSON.stringify(moved) !== JSON.stringify(coaRequirements || {})) onChangeCoaRequirements(moved);
  }
  function removeItem(idx) {
    const name = catalog[idx];
    if (!window.confirm(
      `Remove "${name}" from the COA list?\n\n`
      + 'It stops appearing on every company card and every opp. '
      + 'Companies and opps that already recorded an answer for it keep it.'
    )) { setCatalog([...catalog]); return; }
    commitList(catalog.filter((_, i) => i !== idx));
  }
  function moveItem(idx, delta) {
    const to = idx + delta;
    if (to < 0 || to >= catalog.length) return;
    const next = [...catalog];
    [next[idx], next[to]] = [next[to], next[idx]];
    commitList(next);
  }
  function addItem(value) {
    const v = String(value || '').trim();
    if (!v) return;
    if (catalog.some(o => o.toLowerCase() === v.toLowerCase())) return;
    commitList([...catalog, v]);
  }
  function commitAdd() {
    addItem(addDraft);
    setAddDraft('');
  }

  const endColor = summary.soonestEndDays == null ? undefined
    : summary.soonestEndDays < 0 ? '#B91C1C'
    : summary.soonestEndDays <= 90 ? '#92400E' : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      <section>
        <h3 style={sectionTitle}>Overview</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <Stat label="Client Manager" value={clientManager || <span style={muted}>-</span>} />
          <Stat label="Client Status" value={status || <span style={muted}>-</span>} />
          <Stat
            label="Agreements"
            value={summary.total ? `${summary.active} active` : <span style={muted}>None</span>}
            sub={summary.inactive ? `${summary.inactive} cancelled or expired` : undefined}
          />
          <Stat
            label="Soonest Expiration"
            value={summary.soonestEnd ? fmtDate(summary.soonestEnd) : <span style={muted}>-</span>}
            sub={summary.soonestEndDays == null ? undefined
              : summary.soonestEndDays < 0 ? `${Math.abs(summary.soonestEndDays)} days ago`
              : `in ${summary.soonestEndDays} days`}
            color={endColor}
          />
          <Stat label="Client Since" value={summary.firstStart ? fmtDate(summary.firstStart) : <span style={muted}>-</span>} />
          <Stat label="Active Recurring" value={summary.recurring != null ? fmtCurrency(summary.recurring) : <span style={muted}>-</span>} />
          <Stat label="Auto-renewing" value={summary.active ? `${summary.autoRenewCount} of ${summary.active}` : <span style={muted}>-</span>} />
        </div>
        {clientNotes && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#334155', whiteSpace: 'pre-wrap', padding: '0.4rem 0.6rem', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6 }}>
            <strong style={{ color: '#64748B' }}>Clients tab notes: </strong>{clientNotes}
          </div>
        )}
      </section>

      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
          <h3 style={sectionTitle}>COA Requirements</h3>
          <button
            type="button"
            onClick={() => { setEditingList(v => !v); setAddDraft(''); }}
            title="Add, rename, reorder or remove COA items. The list is shared by every company and every opp."
            style={editingList
              ? { ...smallBtn, border: '1px solid #2563EB', background: '#2563EB', color: '#FFFFFF' }
              : { ...smallBtn, border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#334155' }}
          >{editingList ? 'Done' : 'Edit list'}</button>
        </div>
        <p style={hint}>
          Which COA approval items this client's contracts need. The items are the same on every company.
          {' '}{coaSummary.required} required, {coaSummary.notRequired} not required, {coaSummary.unset} not set.
        </p>
        {editingList && (
          <div style={{ ...hint, padding: '0.35rem 0.6rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, color: '#1E40AF' }}>
            Editing the shared COA list. Changes apply to every company card and every opp (it is the same list as Dropdowns, COA Items).
          </div>
        )}
        {coaRows.length === 0 && !editingList ? (
          <div style={{ ...hint, fontStyle: 'italic' }}>The COA list is empty. Press Edit list to add items.</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', fontSize: '0.72rem', width: '100%' }}>
            <thead>
              <tr style={{ background: '#F1F5F9' }}>
                <th style={{ ...th, width: '30%' }}>COA Item</th>
                <th style={{ ...th, width: 150 }}>Required?</th>
                <th style={th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {coaRows.map(r => {
                const c = REQUIRED_COLORS[r.required] || REQUIRED_COLORS[''];
                return (
                  <tr key={r.key} style={{ background: r.required === 'yes' ? '#FFFBEB' : undefined }}>
                    <td style={{ ...td, fontWeight: 600, color: '#1E293B' }}>
                      {editingList && r.inCatalog ? (() => {
                        const idx = catalog.findIndex(o => o.toLowerCase() === r.key);
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <ItemNameInput value={r.item} onCommit={v => renameItem(idx, v)} />
                            <button type="button" style={iconBtn} disabled={idx <= 0} onClick={() => moveItem(idx, -1)} title="Move up">▲</button>
                            <button type="button" style={iconBtn} disabled={idx >= catalog.length - 1} onClick={() => moveItem(idx, 1)} title="Move down">▼</button>
                            <button type="button" style={{ ...iconBtn, fontSize: '0.9rem', color: '#B91C1C' }} onClick={() => removeItem(idx)} title="Remove from the COA list">×</button>
                          </div>
                        );
                      })() : r.item}
                      {editingList && !r.inCatalog && (
                        <button type="button" onClick={() => addItem(r.item)} title="Put this item back on the shared COA list"
                          style={{ ...smallBtn, marginLeft: 6, padding: '0.05rem 0.4rem', fontSize: '0.6rem', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#334155' }}>
                          Add back to list
                        </button>
                      )}
                      {!r.inCatalog && (
                        <span title="No longer on the Dropdowns COA Items list. Kept because it has an answer." style={{ marginLeft: 6, fontSize: '0.6rem', fontWeight: 600, color: '#94A3B8' }}>
                          (removed from list)
                        </span>
                      )}
                    </td>
                    <td style={td}>
                      <select
                        value={r.required}
                        onChange={e => update(r.item, { required: e.target.value })}
                        aria-label={`Is ${r.item} required for this client?`}
                        style={{ fontSize: '0.72rem', padding: '0.2rem 0.35rem', borderRadius: 4, border: `1px solid ${c.border}`, background: c.background, color: c.color, fontWeight: 600, fontFamily: 'inherit' }}
                      >
                        {COA_REQUIRED_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td style={td}>
                      <NotesInput value={r.notes} onCommit={v => update(r.item, { notes: v })} />
                    </td>
                  </tr>
                );
              })}
              {editingList && (
                <tr>
                  <td style={td} colSpan={3}>
                    <input
                      type="text"
                      value={addDraft}
                      placeholder="+ Add a COA item, e.g. Non-standard payment terms"
                      aria-label="Add a COA item"
                      onChange={e => setAddDraft(e.target.value)}
                      onBlur={commitAdd}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); commitAdd(); }
                        else if (e.key === 'Escape') { e.preventDefault(); setAddDraft(''); }
                      }}
                      style={{ width: '30%', minWidth: 220, boxSizing: 'border-box', fontSize: '0.72rem', padding: '0.25rem 0.4rem', border: '1px dashed #94A3B8', borderRadius: 4, fontFamily: 'inherit' }}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3 style={sectionTitle}>Agreements</h3>
        {deals.length === 0 ? (
          <div style={{ ...hint, fontStyle: 'italic' }}>
            No contracts found for this client. Upload contract data on Clients, Deals: the Client Name column must match this company or one of its former names.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.7rem', width: 'max-content', minWidth: '100%' }}>
              <thead>
                <tr style={{ background: '#F1F5F9' }}>
                  {CONTRACT_COLUMNS.map(col => (
                    <th key={col.key} style={{ ...th, minWidth: col.minWidth }}>{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deals.map((d, i) => {
                  const inactive = isInactiveAgreement(d);
                  return (
                    <tr key={d.id ?? i} style={{ background: inactive ? '#F1F5F9' : (i % 2 ? '#F8FAFC' : '#FFFFFF'), color: inactive ? '#94A3B8' : '#1E293B', opacity: inactive ? 0.7 : 1 }}>
                      {CONTRACT_COLUMNS.map(col => (
                        <td key={col.key} style={{ ...td, whiteSpace: 'nowrap', minWidth: col.minWidth }}>
                          {col.key === '__daysToEnd'
                            ? daysToEndCell(d['End Date'], inactive)
                            : contractCell(col.key, d[col.key])}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
