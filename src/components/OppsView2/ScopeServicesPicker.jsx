// Scope picker for Opps 2 — the services board as a centred modal.
//
// The generic MultiSelectCell drops a 480px popover anchored under the cell,
// so on a Scope cell near the bottom or right of the table the list ran off
// the page with no way to scroll to it. Scope also has far more vocabulary
// than a normal linked column (the whole services catalog), and picking a
// service is a decision you make against what's already been sold to that
// account — which the flat list didn't show at all.
//
// So Scope gets its own picker: the same category board the company card
// uses (Services Explored), centred on screen, wide, and scrolling inside
// itself. Each service carries the status it already has for this account, so
// the pick is made with the account's history in view rather than blind.
//
// Read-only on status: this board picks Scope. Statuses are owned by the
// company card and by the opps themselves, and are shown here as context.

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { SERVICE_CATEGORIES, SERVICE_STATUSES } from '../../data/enums';
import { companiesMatch } from '../../utils/listFlags';
import { parseMulti } from '../common/columnLinks';

// Same palette the company card's services board uses, so a service reads
// the same colour in both places.
const STATUS_COLORS = {
  'Sold': { bg: '#DCFCE7', color: '#166534' },
  'Verbal': { bg: '#DCFCE7', color: '#166534' },
  'Renewal': { bg: '#F1F5F9', color: '#94A3B8' },
  'In Progress': { bg: '#FEF9C3', color: '#854D0E' },
  'Exploring': { bg: '#FEF9C3', color: '#854D0E' },
  'Qualifying': { bg: '#FEF9C3', color: '#854D0E' },
  'Quoting': { bg: '#FEF9C3', color: '#854D0E' },
  'Quoted': { bg: '#DBEAFE', color: '#1E40AF' },
  'Proposed': { bg: '#DBEAFE', color: '#1E40AF' },
  'Lead': { bg: '#FEF9C3', color: '#854D0E' },
  'Not Started': { bg: '#FEF9C3', color: '#854D0E' },
  'Not Sold': { bg: '#FEE2E2', color: '#991B1B' },
  'N/A': { bg: '#F1F5F9', color: '#94A3B8' },
};

// Which stage wins when several of an account's opps name the same service.
// Mirrors the company card's ordering: closed-won beats in-flight beats lost.
const STAGE_PRIORITY = {
  'Sold': 4, 'Verbal': 3, 'Quoted': 3, 'Quoting': 2,
  'Qualifying': 2, 'Lead': 1, 'Not Started': 1, 'Not Sold': 0,
};

const UNGROUPED = 'Other services';

// Split a Scope cell into its service tokens. Same separators the company
// card splits on, so a scope written "GHG; Budgets" matches either way.
function scopeTokens(scope) {
  return String(scope || '').split(/[;,/]+/).map(s => s.trim()).filter(Boolean);
}

// Service ← scope-token match. Deliberately loose (either side may contain
// the other) because Scope is typed shorthand — "GHG" should find "Comp GHG"
// — and it mirrors the company card's matching so the two boards agree.
function tokenMatchesItem(token, item) {
  const t = token.toLowerCase();
  const i = item.toLowerCase();
  return i === t || i.includes(t) || t.includes(i);
}

// The automatic status per service: the best stage among the account's opps
// that name it. This is the fallback the company card shows when no manual
// status has been set, so the two agree on what "auto" means.
function buildAutoStatuses({ account, oppRows, items, currentOppId }) {
  const out = new Map();
  const name = String(account || '').trim();
  if (!name) return out;

  for (const row of oppRows || []) {
    // The opp being edited is excluded: its own Scope is what this board is
    // choosing, so counting it would echo the current selection back as if
    // it were history.
    if (currentOppId != null && row?._id === currentOppId) continue;
    if (!companiesMatch(row?.Account, name)) continue;
    const stage = String(row?.Stage || '').trim();
    if (!stage) continue;
    for (const token of scopeTokens(row?.Scope)) {
      for (const item of items) {
        if (!tokenMatchesItem(token, item)) continue;
        const existing = out.get(item);
        const pri = STAGE_PRIORITY[stage] ?? 1;
        const existingPri = existing ? (STAGE_PRIORITY[existing] ?? 1) : -1;
        if (pri > existingPri) out.set(item, stage);
      }
    }
  }
  return out;
}

// The board's cards: the user's own category layout (falling back to the
// seed catalog), plus a trailing card for anything in the column's linked
// list that no category claims — so a Solutions entry can never become
// unpickable just because it hasn't been filed into a box yet.
function buildCategories(settings, options) {
  const base = settings?.customServiceCategories
    || SERVICE_CATEGORIES.map(c => ({ name: c.name, items: [...c.items] }));
  const hidden = new Set(settings?.hiddenServices || []);
  const cats = base
    .map(c => ({ name: c.name, items: (c.items || []).filter(i => !hidden.has(i)) }))
    .filter(c => c.items.length > 0);

  const filed = new Set(cats.flatMap(c => c.items.map(i => i.toLowerCase())));
  const extra = (options || [])
    .map(o => String(o || '').trim())
    .filter(o => o && !hidden.has(o) && !filed.has(o.toLowerCase()));
  if (extra.length) cats.push({ name: UNGROUPED, items: [...new Set(extra)] });
  return cats;
}

// The status control, mirroring the company card's: the select shows the
// effective status, "— (auto)" clears the manual override back to whatever
// the account's opps imply, and an accent border marks a row that carries an
// override rather than a derived value.
//
// Without a company record to write to there's nothing to save against, so
// the control goes read-only and says why instead of silently dropping edits.
function StatusSelect({ item, manual, auto, onSet, disabled, disabledReason }) {
  const effective = manual || auto || '-';
  const colors = STATUS_COLORS[effective] || {};
  const title = disabled
    ? disabledReason
    : manual
      ? `Manual override: ${manual}.${auto ? ` Automatic status from another opp: ${auto}.` : ' No matching opp, so the automatic status is blank.'} Pick "- (auto)" to revert.`
      : auto
        ? `Automatic status from another opp on this account: ${auto}. Pick a status to set a manual override.`
        : 'No status yet. Pick one to set it on the company card.';

  return (
    <select
      value={effective}
      disabled={disabled}
      title={title}
      onChange={(e) => onSet(item, e.target.value)}
      // The row's label wraps only the checkbox and name, but stop the click
      // here regardless so opening the menu can never toggle the tick.
      onClick={(e) => e.stopPropagation()}
      style={{
        flex: '0 0 auto', maxWidth: 78, fontSize: '0.58rem', fontWeight: 700,
        padding: '0 1px', borderRadius: 3, cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'inherit', opacity: disabled ? 0.55 : 1,
        border: `1px solid ${manual ? 'var(--color-accent)' : 'var(--color-border)'}`,
        background: colors.bg || 'var(--color-surface)',
        color: colors.color || 'var(--color-text-muted)',
        fontStyle: !manual && auto ? 'italic' : 'normal',
      }}
    >
      {SERVICE_STATUSES.map(s => (
        <option key={s} value={s}>{s === '-' ? '- (auto)' : s}</option>
      ))}
    </select>
  );
}

export function ScopeServicesModal({
  value, onChange, onClose, options = [], account, prospects, updateProspect,
  settings, oppRows, currentOppId, extraGroups, extraGroupsLabel, extraGroupsPlaceholder,
  // Optional line in the header saying why the board opened — set when it's
  // raised by something other than a click on the Scope cell (e.g. an opp
  // leaving the Not Started stage).
  note,
}) {
  const [query, setQuery] = useState('');
  const [quickPick, setQuickPick] = useState('');

  const selected = useMemo(() => parseMulti(value), [value]);
  const selectedSet = useMemo(() => new Set(selected.map(s => s.toLowerCase())), [selected]);

  const categories = useMemo(() => buildCategories(settings, options), [settings, options]);
  const allItems = useMemo(() => categories.flatMap(c => c.items), [categories]);
  const renames = settings?.serviceRenames || {};
  const displayName = (item) => renames[item] || item;

  // The company record behind this opp's account — the same record the
  // company card edits, so a status set here lands in exactly the place the
  // card reads it back from.
  const prospect = useMemo(() => {
    const name = String(account || '').trim();
    if (!name) return null;
    return (prospects || []).find(p => companiesMatch(p?.company, name)) || null;
  }, [prospects, account]);
  const manualStatuses = prospect?.servicesExplored || {};
  const smes = prospect?.serviceSMEs || {};

  const autoStatuses = useMemo(
    () => buildAutoStatuses({ account, oppRows, items: allItems, currentOppId }),
    [account, oppRows, allItems, currentOppId],
  );

  // Statuses live on the company record, so editing needs one to exist. An
  // account with no matching company (or a caller that didn't pass an
  // updater) still sees its statuses — it just can't change them here.
  const canEditStatus = !!prospect?.id && typeof updateProspect === 'function';
  const cannotEditReason = !account
    ? 'This opp has no Account, so there is no company record to save a status against.'
    : !prospect
      ? `No company record matches “${account}”: add the company on the Table view to set statuses here.`
      : 'Status editing is unavailable on this screen.';

  const setStatus = (item, next) => {
    if (!canEditStatus) return;
    const current = { ...(prospect.servicesExplored || {}) };
    // "— (auto)" removes the override rather than storing a dash, matching
    // how the company card stores it.
    if (!next || next === '-') delete current[item];
    else current[item] = next;
    updateProspect(prospect.id, { servicesExplored: current });
  };

  const groups = useMemo(
    () => (Array.isArray(extraGroups) ? extraGroups.filter(g => g && g.label && Array.isArray(g.options) && g.options.length > 0) : []),
    [extraGroups],
  );

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function toggle(item) {
    const key = item.toLowerCase();
    const next = selectedSet.has(key)
      ? selected.filter(s => s.toLowerCase() !== key)
      : [...selected, item];
    onChange(next.join(', '));
  }

  function addGroup(label) {
    const g = groups.find(gr => gr.label === label);
    if (!g) return;
    const seen = new Set(selected.map(s => s.toLowerCase()));
    const next = selected.slice();
    for (const opt of g.options) {
      const lower = String(opt || '').toLowerCase();
      if (!lower || seen.has(lower)) continue;
      seen.add(lower);
      next.push(opt);
    }
    onChange(next.join(', '));
    setQuickPick('');
  }

  // Filtering hides non-matching services but keeps a card whose own name
  // matches, so searching a category name shows everything inside it.
  const term = query.trim().toLowerCase();
  const visible = categories
    .map(cat => {
      if (!term || cat.name.toLowerCase().includes(term)) return cat;
      return { ...cat, items: cat.items.filter(i => displayName(i).toLowerCase().includes(term) || i.toLowerCase().includes(term)) };
    })
    .filter(cat => cat.items.length > 0);
  const matchCount = visible.reduce((sum, c) => sum + c.items.length, 0);

  // Anything already in Scope that isn't on the board — a hidden service, or
  // free text typed straight into the cell. Listed so it can still be
  // removed here instead of being invisible but saved.
  const boardKeys = new Set(allItems.map(i => i.toLowerCase()));
  const offBoard = selected.filter(s => !boardKeys.has(s.toLowerCase()));

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9500, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '2rem 1rem',
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 1280, maxWidth: '96vw', maxHeight: '88vh',
          background: 'var(--color-surface)', borderRadius: 8,
          boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap',
          padding: '0.6rem 0.8rem', borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
        }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text)' }}>
            Scope: select services
          </span>
          {account && (
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
              {account}
            </span>
          )}
          {note && (
            <span style={{
              fontSize: '0.7rem', fontWeight: 600, color: '#92400E',
              background: '#FEF3C7', border: '1px solid #FDE68A',
              borderRadius: 999, padding: '1px 8px',
            }}>{note}</span>
          )}
          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#15803D' }}>
            {selected.length} selected
          </span>
          <input
            autoFocus
            type="text"
            value={query}
            placeholder="Filter services…"
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: '1 1 200px', minWidth: 140, boxSizing: 'border-box',
              border: '1px solid var(--color-border)', borderRadius: 3,
              padding: '5px 8px', fontSize: '0.78rem', fontFamily: 'inherit',
              color: 'var(--color-text)', background: 'var(--color-surface)',
            }}
          />
          {groups.length > 0 && (
            <select
              value={quickPick}
              onChange={(e) => { const v = e.target.value; if (v) addGroup(v); }}
              title={extraGroupsLabel || 'Quick add'}
              style={{
                maxWidth: 220, padding: '0.25rem 0.35rem',
                border: '1px solid var(--color-border)', borderRadius: 3,
                fontSize: '0.72rem', fontFamily: 'inherit',
                background: 'var(--color-surface)', color: 'var(--color-text)',
              }}
            >
              <option value="">{extraGroupsPlaceholder || '(pick an option)'}</option>
              {groups.map(g => (
                <option key={g.label} value={g.label}>{g.label} ({g.options.length})</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => onChange('')}
            style={{
              padding: '0.25rem 0.6rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 3,
              fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Clear</button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.25rem 0.7rem', background: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 3,
              fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#fff', cursor: 'pointer',
            }}
          >Done</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0.6rem' }}>
          {matchCount === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
              No services match “{query.trim()}”.
            </div>
          ) : (
            <div style={{
              display: 'grid', gap: '0.4rem',
              gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
              alignItems: 'start',
            }}>
              {visible.map(cat => (
                <div key={cat.name} style={{
                  border: '1px solid var(--color-border)', borderRadius: 5,
                  overflow: 'hidden', fontSize: '0.72rem',
                }}>
                  <div style={{
                    padding: '0.2rem 0.4rem', background: '#EFF6FF',
                    borderBottom: '1px solid var(--color-border)',
                    fontWeight: 700, fontSize: '0.65rem', color: '#1E40AF',
                  }}>{cat.name}</div>
                  <div style={{ padding: '0.1rem 0' }}>
                    {cat.items.map(item => {
                      const checked = selectedSet.has(item.toLowerCase());
                      const sme = String(smes[item] || '').trim();
                      const manual = String(manualStatuses[item] ?? '').trim();
                      return (
                        <div
                          key={item}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.25rem',
                            padding: '0.12rem 0.35rem',
                            background: checked ? '#DCFCE7' : 'transparent',
                          }}
                        >
                          {/* The label covers only the tick and the name —
                              the status select sits outside it so opening
                              the menu can't flip the Scope selection. */}
                          <label
                            title={sme ? `SME: ${sme}` : displayName(item)}
                            style={{
                              flex: 1, minWidth: 0, display: 'flex', alignItems: 'center',
                              gap: '0.3rem', cursor: 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(item)}
                              style={{ margin: 0, flex: '0 0 auto' }}
                            />
                            <span style={{
                              flex: 1, minWidth: 0, fontSize: '0.68rem',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              fontWeight: checked ? 700 : 500,
                              color: checked ? '#166534' : 'var(--color-text)',
                            }}>{displayName(item)}</span>
                          </label>
                          {sme && (
                            <span
                              title={`SME: ${sme}`}
                              style={{
                                flex: '0 0 auto', fontSize: '0.52rem', fontWeight: 700,
                                padding: '0.05rem 0.25rem', borderRadius: 3,
                                background: '#F1F5F9', color: '#64748B', whiteSpace: 'nowrap',
                              }}
                            >SME</span>
                          )}
                          <StatusSelect
                            item={item}
                            manual={manual && manual !== '-' ? manual : ''}
                            auto={autoStatuses.get(item) || ''}
                            onSet={setStatus}
                            disabled={!canEditStatus}
                            disabledReason={cannotEditReason}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {offBoard.length > 0 && (
            <div style={{
              marginTop: '0.6rem', paddingTop: '0.5rem',
              borderTop: '1px solid var(--color-border-light)',
              display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>
                Also in Scope (not on the board):
              </span>
              {offBoard.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggle(s)}
                  title="Remove from Scope"
                  style={{
                    padding: '0.1rem 0.4rem', borderRadius: 3,
                    border: '1px solid #BBF7D0', background: '#DCFCE7',
                    color: '#166534', fontSize: '0.65rem', fontWeight: 600,
                    fontFamily: 'inherit', cursor: 'pointer',
                  }}
                >{s} ×</button>
              ))}
            </div>
          )}
        </div>

        <div style={{
          padding: '0.35rem 0.8rem', borderTop: '1px solid var(--color-border)',
          background: 'var(--color-bg)', fontSize: '0.65rem', color: 'var(--color-text-muted)',
        }}>
          {canEditStatus
            ? 'Tick a service to put it in Scope. The status dropdown saves to the company card: italic means it is derived from another opp, “- (auto)” reverts to that.'
            : `${cannotEditReason} Ticking a service still sets Scope.`}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// The Scope cell itself. Displays exactly like the generic multi-select cell
// it replaces (same placeholder / truncation behaviour), but opens the board
// above instead of an anchored popover.
export function ScopeServicesCell({
  value, onChange, options, account, prospects, updateProspect, settings,
  oppRows, currentOppId, extraGroups, extraGroupsLabel, extraGroupsPlaceholder,
  nowrap, placeholder,
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => parseMulti(value), [value]);
  const isEmpty = selected.length === 0;
  const showPlaceholder = isEmpty && !!placeholder;

  return (
    <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <span
        onClick={() => setOpen(true)}
        style={{
          display: 'block', cursor: 'pointer', minHeight: '1em',
          padding: '1px 2px',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
          fontStyle: showPlaceholder ? 'italic' : 'normal',
          whiteSpace: nowrap ? 'nowrap' : 'normal',
          wordBreak: nowrap ? 'normal' : 'break-word',
          overflow: nowrap ? 'hidden' : undefined,
          textOverflow: nowrap ? 'ellipsis' : undefined,
        }}
        title={showPlaceholder ? `${placeholder} (placeholder: no service selected)` : isEmpty ? 'Click to pick services' : selected.join(', ')}
      >
        {showPlaceholder ? placeholder : isEmpty ? '-' : selected.join(', ')}
      </span>
      {open && (
        <ScopeServicesModal
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
          options={options}
          account={account}
          prospects={prospects}
          updateProspect={updateProspect}
          settings={settings}
          oppRows={oppRows}
          currentOppId={currentOppId}
          extraGroups={extraGroups}
          extraGroupsLabel={extraGroupsLabel}
          extraGroupsPlaceholder={extraGroupsPlaceholder}
        />
      )}
    </div>
  );
}
