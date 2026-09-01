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
import { SERVICE_STATUSES } from '../../data/enums';
import {
  getServiceCategories,
  sortServiceNames,
  UNGROUPED_SERVICES,
} from '../../utils/serviceCategoriesStore';
import { companiesMatch } from '../../utils/listFlags';
import { isTryingAgain, tryingAgainTitle, TRYING_AGAIN, TRYING_AGAIN_COLORS } from '../../utils/tryingAgain';
import { SERVICE_STATUS_COLORS } from '../../utils/serviceStatusColors';
import { parseMulti } from '../common/columnLinks';
import { autoAddListFor, collectAutoAdds } from '../../utils/serviceAutoAdd';
import { scopeTokens, scopeTokenMatchesService } from '../../utils/scopeMatch';

// Same palette the company card's services board uses, so a service reads
// the same colour in both places.
const STATUS_COLORS = SERVICE_STATUS_COLORS;

// Which stage wins when several of an account's opps name the same service.
// Mirrors the company card's ordering: closed-won beats in-flight beats lost.
const STAGE_PRIORITY = {
  'Sold': 4, 'Verbal': 3, 'Quoted': 3, 'Quoting': 2,
  'Qualifying': 2, 'Lead': 1, 'Not Started': 1, 'Not Sold': 0,
};

// Bucket in the selection summary for anything in Scope that the board
// doesn't offer — a hidden service, or free text typed straight into the cell.
const OFF_BOARD = 'Not on the board';

// Scope → service matching lives in src/utils/scopeMatch.js, shared with
// the company card and the Pipeline coverage table so all three boards
// agree on which services a Scope names.

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
        if (!scopeTokenMatchesService(token, item)) continue;
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
  const hidden = new Set(settings?.hiddenServices || []);
  const cats = getServiceCategories(settings)
    .map(c => ({ name: c.name, items: c.items.filter(i => !hidden.has(i)) }))
    .filter(c => c.items.length > 0);

  const filed = new Set(cats.flatMap(c => c.items.map(i => i.toLowerCase())));
  const extra = (options || [])
    .map(o => String(o || '').trim())
    .filter(o => o && !hidden.has(o) && !filed.has(o.toLowerCase()));
  if (extra.length) {
    cats.push({
      name: UNGROUPED_SERVICES,
      items: sortServiceNames([...new Set(extra)], settings?.serviceRenames),
    });
  }
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
  // Memoized because the selection summary depends on it: a fresh {} literal
  // every render would rebuild that list on every keystroke in the filter box.
  const renames = useMemo(() => settings?.serviceRenames || {}, [settings?.serviceRenames]);
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

  // Services that come with other services, per the Auto-add Services column
  // on Dropdowns › Services. Ticking one here ticks whatever it names, so a
  // service that is never sold alone can't be picked alone by accident.
  //
  // Additive only: the extras are ordinary ticks from the moment they land,
  // so any of them can be taken straight back off, and taking one off does
  // not un-tick the service that brought it. They come back only if the
  // trigger is unticked and ticked again.
  //
  // A cell can spell a service differently from the board (casing drift, or
  // a name typed by hand), so an auto-add is resolved to the board's own
  // spelling where it matches a row — otherwise it would tick nothing and
  // land in the off-board bucket instead.
  const canonical = useMemo(() => {
    const byLower = new Map(allItems.map(i => [i.toLowerCase(), i]));
    return (name) => byLower.get(String(name || '').trim().toLowerCase()) || name;
  }, [allItems]);

  // What each service on the board pulls in, so a row can say so before it's
  // ticked rather than only after. One pass over the board's items — the
  // lists themselves are a settings lookup per service.
  const autoAddByItem = useMemo(() => {
    const map = new Map();
    for (const item of allItems) {
      const list = autoAddListFor(item, settings?.serviceOverrides)
        .map(canonical)
        .filter(Boolean);
      if (list.length > 0) map.set(item, list);
    }
    return map;
  }, [allItems, settings?.serviceOverrides, canonical]);

  // What the last tick pulled in, for the line under the header. Cleared on
  // the next edit: it reports one action, not a running tally.
  const [autoAdded, setAutoAdded] = useState([]);

  function toggle(item) {
    const key = item.toLowerCase();
    if (selectedSet.has(key)) {
      setAutoAdded([]);
      onChange(selected.filter(s => s.toLowerCase() !== key).join(', '));
      return;
    }
    const next = [...selected, item];
    const extra = collectAutoAdds([item], settings?.serviceOverrides, {
      canonical,
      present: next,
    });
    setAutoAdded(extra);
    onChange([...next, ...extra].join(', '));
  }

  function addGroup(label) {
    const g = groups.find(gr => gr.label === label);
    if (!g) return;
    const seen = new Set(selected.map(s => s.toLowerCase()));
    const next = selected.slice();
    const picked = [];
    for (const opt of g.options) {
      const lower = String(opt || '').toLowerCase();
      if (!lower || seen.has(lower)) continue;
      seen.add(lower);
      next.push(opt);
      picked.push(opt);
    }
    // The quick-add lists are picked by a person too, so they carry the same
    // implications a tick does.
    const extra = collectAutoAdds(picked, settings?.serviceOverrides, {
      canonical,
      present: next,
    });
    setAutoAdded(extra);
    onChange([...next, ...extra].join(', '));
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

  // What's in Scope right now, grouped the way the board is grouped, for the
  // summary strip under the header. Deliberately NOT filtered by the search
  // box: it answers "what has this opp got?", which is the one question the
  // board itself can't answer once you start typing or scrolling past a card.
  //
  // Services the board doesn't offer (hidden, or free text typed straight into
  // the cell) collect in a trailing OFF_BOARD group, so they can still be
  // removed here rather than being invisible but saved.
  const selectedGroups = useMemo(() => {
    const placement = new Map();
    for (const cat of categories) {
      for (const item of cat.items) placement.set(item.toLowerCase(), { item, category: cat.name });
    }
    const byCategory = new Map();
    for (const raw of selected) {
      const hit = placement.get(String(raw).toLowerCase());
      const category = hit ? hit.category : OFF_BOARD;
      // Prefer the board's spelling over whatever the cell happened to store,
      // so the chip matches the row it ticks.
      const value = hit ? hit.item : raw;
      if (!byCategory.has(category)) byCategory.set(category, []);
      byCategory.get(category).push({ value, label: hit ? (renames[hit.item] || hit.item) : raw });
    }
    // Board order, with the off-board stragglers last.
    const ordered = categories
      .map(cat => ({ category: cat.name, items: byCategory.get(cat.name) || [] }))
      .filter(g => g.items.length > 0);
    if (byCategory.has(OFF_BOARD)) ordered.push({ category: OFF_BOARD, items: byCategory.get(OFF_BOARD) });
    return ordered;
  }, [selected, categories, renames]);

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
            onClick={() => { setAutoAdded([]); onChange(''); }}
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

        {/* Selection summary. Sits outside the scrolling board so it stays
            put while you hunt through categories, and capped at a few rows of
            chips so a 40-service Scope can't push the board off screen. */}
        <div style={{
          flex: '0 0 auto', maxHeight: 96, overflowY: 'auto',
          padding: '0.4rem 0.8rem', borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
        }}>
          {autoAdded.length > 0 && (
            <div
              title="These services are listed as Auto-add Services on Dropdowns › Services. They are ordinary ticks now — remove any of them with its × above."
              style={{
                marginBottom: '0.3rem', fontSize: '0.65rem', fontWeight: 600,
                color: '#1E40AF',
              }}
            >
              Added automatically: {autoAdded.join(', ')}
            </div>
          )}
          {selected.length === 0 ? (
            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              Nothing in Scope yet — tick a service below to add it.
            </div>
          ) : (
            // Wider gap between groups than within one (0.75 vs 0.25), so the
            // category labels read as headings rather than as another chip.
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-text-muted)', flex: '0 0 auto' }}>
                In Scope:
              </span>
              {selectedGroups.map(group => (
                <span key={group.category} style={{ display: 'flex', alignItems: 'baseline', gap: '0.25rem', flexWrap: 'wrap' }}>
                  <span
                    title={group.category === OFF_BOARD
                      ? 'In Scope but not offered by the board — a hidden service, or text typed straight into the cell.'
                      : group.category}
                    style={{
                      fontSize: '0.58rem', fontWeight: 700, whiteSpace: 'nowrap',
                      color: group.category === OFF_BOARD ? '#92400E' : '#1E40AF',
                      textTransform: 'uppercase', letterSpacing: '0.02em',
                    }}
                  >{group.category}</span>
                  {group.items.map(it => (
                    <button
                      key={it.value}
                      type="button"
                      onClick={() => toggle(it.value)}
                      title={`Remove “${it.label}” from Scope`}
                      style={{
                        padding: '0.1rem 0.4rem', borderRadius: 3,
                        border: `1px solid ${group.category === OFF_BOARD ? '#FDE68A' : '#BBF7D0'}`,
                        background: group.category === OFF_BOARD ? '#FEF3C7' : '#DCFCE7',
                        color: group.category === OFF_BOARD ? '#92400E' : '#166534',
                        fontSize: '0.65rem', fontWeight: 600,
                        fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
                      }}
                    >{it.label} ×</button>
                  ))}
                </span>
              ))}
            </div>
          )}
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
                      const pulls = autoAddByItem.get(item) || [];
                      const sme = String(smes[item] || '').trim();
                      const manual = String(manualStatuses[item] ?? '').trim();
                      const auto = autoStatuses.get(item) || '';
                      // Already has a status on the company card and an opp
                      // names it again: back in play. The tick's green still
                      // wins the row, since that is this board's job.
                      const retry = isTryingAgain(manual, auto);
                      return (
                        <div
                          key={item}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.25rem',
                            // Lets the "Trying again" chip drop to its own
                            // line in a narrow card instead of squeezing the
                            // service name away.
                            flexWrap: 'wrap',
                            padding: '0.12rem 0.35rem',
                            background: checked ? '#DCFCE7' : retry ? TRYING_AGAIN_COLORS.bg : 'transparent',
                          }}
                        >
                          {/* The label covers only the tick and the name —
                              the status select sits outside it so opening
                              the menu can't flip the Scope selection. */}
                          <label
                            title={sme ? `SME: ${sme}` : displayName(item)}
                            style={{
                              flex: 1, minWidth: '4.5rem', display: 'flex', alignItems: 'center',
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
                          {pulls.length > 0 && (
                            <span
                              title={`Ticking ${displayName(item)} also adds: ${pulls.join(', ')}. Set on Dropdowns › Services (Auto-add Services).`}
                              style={{
                                flex: '0 0 auto', fontSize: '0.52rem', fontWeight: 700,
                                padding: '0.05rem 0.25rem', borderRadius: 3,
                                background: '#DBEAFE', color: '#1E40AF', whiteSpace: 'nowrap',
                              }}
                            >+{pulls.length}</span>
                          )}
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
                            auto={auto}
                            onSet={setStatus}
                            disabled={!canEditStatus}
                            disabledReason={cannotEditReason}
                          />
                          {/* Last in the row so it is the chip that wraps
                              when the card is narrow — the tick, name and
                              status stay on line one. */}
                          {retry && (
                            <span
                              title={tryingAgainTitle(manual, auto)}
                              style={{
                                flex: '0 0 auto', fontSize: '0.52rem', fontWeight: 700,
                                padding: '0.05rem 0.25rem', borderRadius: 3, whiteSpace: 'nowrap',
                                background: TRYING_AGAIN_COLORS.bg, color: TRYING_AGAIN_COLORS.color,
                                border: `1px solid ${TRYING_AGAIN_COLORS.border}`,
                              }}
                            >{TRYING_AGAIN}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>

        <div style={{
          padding: '0.35rem 0.8rem', borderTop: '1px solid var(--color-border)',
          background: 'var(--color-bg)', fontSize: '0.65rem', color: 'var(--color-text-muted)',
        }}>
          {canEditStatus
            ? 'Tick a service to put it in Scope. A “+N” means it brings that many services with it (Dropdowns › Services › Auto-add Services) — they arrive as ordinary ticks and can be removed. The status dropdown saves to the company card: italic means it is derived from another opp, “- (auto)” reverts to that.'
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
