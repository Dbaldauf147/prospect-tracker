import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

// Build a key → { key, label, options } map from an array of lists.
// Callers pass the user's effective lists (built-ins merged with the
// per-key overrides stored on settings.dropdownLists) so cell
// renderers and the Link Columns modal always see the latest
// vocabulary.
export function buildListRegistry(lists) {
  const map = new Map();
  for (const list of (lists || [])) {
    if (!list?.key) continue;
    map.set(list.key, list);
  }
  return map;
}

// Same lists, sorted by label — used to populate the picker inside
// the Link Columns modal.
export function buildAvailableLists(lists) {
  return [...(lists || [])].sort((a, b) =>
    String(a.label || '').localeCompare(String(b.label || ''))
  );
}

// Comma-separated string ↔ array helper used by the multi-select cell.
// Tolerates an already-array value so it round-trips cleanly with
// whatever shape upstream code stores.
export function parseMulti(value) {
  if (Array.isArray(value)) return value.map(s => String(s).trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

// Resolve a column's effective dropdown binding. User picks (from the
// Link Columns modal) win over the caller's built-in defaults; an
// explicit `none` from the user disables a default. Returns null when
// the column is free-text. The shared registry isn't consulted here —
// if the user previously bound the column to a list that's since been
// removed, the consumer's listRegistry.get(listKey)?.options || []
// fallback yields an empty option set and the cell shows the current
// value as-is.
export function resolveColumnLink(columnName, userLinks, defaultLinks = {}) {
  const user = userLinks?.[columnName];
  if (user) {
    if (user.listKey === 'none') return null;
    if (user.listKey && user.listKey !== 'default') {
      return { listKey: user.listKey, mode: user.mode === 'multi' ? 'multi' : 'single' };
    }
  }
  return defaultLinks[columnName] || null;
}

// Single-select cell — click to open a popover of options sourced from
// the Dropdowns page. Picking an option commits the value and closes
// the popover; "Clear" empties it.
export function SelectCell({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  // Popup is portaled to <body> so the table cell's overflow:hidden
  // can't clip it; position is recomputed from the wrapper's bounding
  // rect whenever the popup opens.
  const [popPos, setPopPos] = useState({ top: 0, left: 0, width: 0, maxHeight: 280, dropUp: false });
  const wrapRef = useRef(null);
  const popRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    // Flip the menu above the cell (and cap its height) when there isn't
    // enough room below — otherwise a Stage cell near the bottom of the
    // screen opens a menu that runs off the viewport and gets clipped.
    const GAP = 2;
    const MARGIN = 8; // keep a little breathing room from the viewport edge
    const DESIRED = 280;
    const spaceBelow = window.innerHeight - rect.bottom - GAP - MARGIN;
    const spaceAbove = rect.top - GAP - MARGIN;
    const dropUp = spaceBelow < Math.min(DESIRED, spaceAbove) && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(DESIRED, dropUp ? spaceAbove : spaceBelow));
    setPopPos({
      left: rect.left,
      width: rect.width,
      maxHeight,
      dropUp,
      top: dropUp ? undefined : rect.bottom + GAP,
      bottom: dropUp ? window.innerHeight - rect.top + GAP : undefined,
    });
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

  const current = String(value || '').trim();
  const isEmpty = !current;
  // Surface any pre-existing free-text value that isn't in the
  // configured list, so legacy data stays selectable instead of
  // silently dropping off the menu.
  const displayOptions = useMemo(() => {
    if (!current) return options;
    if (options.some(o => o.toLowerCase() === current.toLowerCase())) return options;
    return [current, ...options];
  }, [options, current]);

  function pick(opt) {
    onChange(opt);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <span
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'block', cursor: 'pointer', minHeight: '1em',
          padding: '1px 2px',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
        }}
        title="Click to pick a value"
      >
        {isEmpty ? '-' : current}
      </span>
      {open && createPortal(
        <div
          ref={popRef}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            ...(popPos.dropUp ? { bottom: popPos.bottom } : { top: popPos.top }),
            left: popPos.left,
            zIndex: 9999, minWidth: Math.max(popPos.width, 160), width: 240,
            background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.18)',
            fontSize: '0.82rem',
            // Reserve room for the Clear footer so the whole popover stays
            // within the space measured above/below the cell.
            maxHeight: popPos.maxHeight,
            display: 'flex', flexDirection: 'column',
          }}
        >
          <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
            {displayOptions.map(opt => {
              const selected = opt.toLowerCase() === current.toLowerCase();
              return (
                <div
                  key={opt}
                  onClick={() => pick(opt)}
                  style={{
                    padding: '0.35rem 0.6rem', cursor: 'pointer',
                    background: selected ? '#DCFCE7' : 'transparent',
                    color: selected ? '#166534' : '#1E293B',
                    fontWeight: selected ? 700 : 500,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >{opt}</div>
              );
            })}
          </div>
          {!isEmpty && (
            <div style={{
              display: 'flex', justifyContent: 'flex-end',
              padding: '0.3rem 0.5rem', borderTop: '1px solid var(--color-border-light)',
              background: 'var(--color-bg)',
            }}>
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                style={{
                  padding: '0.2rem 0.5rem', background: 'transparent',
                  border: '1px solid var(--color-border)', borderRadius: 3,
                  fontSize: '0.7rem', fontWeight: 600, fontFamily: 'inherit',
                  color: 'var(--color-text-muted)', cursor: 'pointer',
                }}
              >Clear</button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

// Multi-select cell — checkbox popover. Stores the chosen options as a
// comma-separated string so the value round-trips through plain text
// storage (CSV export, Firestore strings, etc.).
export function MultiSelectCell({ value, onChange, options, extraGroups, extraGroupsLabel, extraGroupsPlaceholder, nowrap, placeholder }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [popPos, setPopPos] = useState({ top: 0, left: 0 });
  const [quickPick, setQuickPick] = useState('');
  const wrapRef = useRef(null);
  const popRef = useRef(null);
  const selected = useMemo(() => parseMulti(value), [value]);
  const selectedSet = useMemo(() => new Set(selected.map(s => s.toLowerCase())), [selected]);
  const groups = useMemo(
    () => (Array.isArray(extraGroups) ? extraGroups.filter(g => g && g.label && Array.isArray(g.options) && g.options.length > 0) : []),
    [extraGroups],
  );

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setPopPos({ top: rect.bottom + 2, left: rect.left });
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

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.toLowerCase().includes(q));
  }, [options, query]);

  function toggle(opt) {
    const key = opt.toLowerCase();
    const next = selectedSet.has(key)
      ? selected.filter(s => s.toLowerCase() !== key)
      : [...selected, opt];
    onChange(next.join(', '));
  }

  function clearAll() {
    onChange('');
  }

  // Add every option in a named group to the current selection. Items
  // already selected are skipped (matched case-insensitively).
  function addGroup(groupLabel) {
    const g = groups.find(gr => gr.label === groupLabel);
    if (!g) return;
    const existing = new Set(selected.map(s => s.toLowerCase()));
    const next = selected.slice();
    for (const opt of g.options) {
      const lower = String(opt || '').toLowerCase();
      if (!lower || existing.has(lower)) continue;
      existing.add(lower);
      next.push(opt);
    }
    onChange(next.join(', '));
    setQuickPick('');
  }

  const isEmpty = selected.length === 0;
  // When nothing is selected and a placeholder was supplied, show it in
  // muted italics so it reads as a hint (e.g. Scope's default "AEM"),
  // not an actual selected service. Falls back to the plain "—" dash.
  const showPlaceholder = isEmpty && !!placeholder;
  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <span
        onClick={() => setOpen(o => !o)}
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
        title={showPlaceholder ? `${placeholder} (placeholder: no service selected)` : isEmpty ? 'Click to pick values' : selected.join(', ')}
      >
        {showPlaceholder ? placeholder : isEmpty ? '-' : selected.join(', ')}
      </span>
      {open && createPortal(
        <div
          ref={popRef}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', top: popPos.top, left: popPos.left,
            zIndex: 9999, width: 480, maxWidth: '92vw',
            background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.18)',
            fontSize: '0.9rem',
          }}
        >
          {groups.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.5rem 0.6rem',
              borderBottom: '1px solid var(--color-border-light)',
              background: 'var(--color-bg)',
            }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                {extraGroupsLabel || 'Quick add'}
              </span>
              <select
                value={quickPick}
                onChange={(e) => { const v = e.target.value; if (v) addGroup(v); }}
                style={{
                  flex: 1, minWidth: 0, padding: '0.3rem 0.4rem',
                  border: '1px solid var(--color-border)', borderRadius: 3,
                  fontSize: '0.8rem', fontFamily: 'inherit',
                  background: '#fff', color: 'var(--color-text)',
                }}
              >
                <option value="">{extraGroupsPlaceholder || '(pick one)'}</option>
                {groups.map(g => (
                  <option key={g.label} value={g.label}>{g.label} ({g.options.length})</option>
                ))}
              </select>
            </div>
          )}
          <div style={{ padding: '0.5rem 0.6rem', borderBottom: '1px solid var(--color-border-light)' }}>
            <input
              autoFocus
              type="text"
              value={query}
              placeholder="Filter options…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } }}
              style={{
                width: '100%', boxSizing: 'border-box',
                border: '1px solid var(--color-border)', borderRadius: 3,
                padding: '6px 8px', fontSize: 'inherit', fontFamily: 'inherit',
                color: 'var(--color-text)', background: '#fff',
              }}
            />
          </div>
          <div style={{ maxHeight: 440, overflowY: 'auto' }}>
            {filteredOptions.length === 0 ? (
              <div style={{ padding: '0.6rem 0.7rem', color: 'var(--color-text-muted)' }}>
                No matches
              </div>
            ) : filteredOptions.map(opt => {
              const checked = selectedSet.has(opt.toLowerCase());
              return (
                <label
                  key={opt}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.55rem',
                    padding: '0.4rem 0.7rem', cursor: 'pointer',
                    background: checked ? '#DCFCE7' : 'transparent',
                    color: checked ? '#166534' : '#1E293B',
                    fontWeight: checked ? 600 : 500,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt)}
                    style={{ margin: 0 }}
                  />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {opt}
                  </span>
                </label>
              );
            })}
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '0.4rem 0.6rem', borderTop: '1px solid var(--color-border-light)',
            background: 'var(--color-bg)',
          }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {selected.length} selected
            </span>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                type="button"
                onClick={clearAll}
                style={{
                  padding: '0.3rem 0.65rem', background: 'transparent',
                  border: '1px solid var(--color-border)', borderRadius: 3,
                  fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit',
                  color: 'var(--color-text-muted)', cursor: 'pointer',
                }}
              >Clear</button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  padding: '0.3rem 0.65rem', background: 'var(--color-accent)',
                  border: '1px solid var(--color-accent)', borderRadius: 3,
                  fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit',
                  color: '#fff', cursor: 'pointer',
                }}
              >Done</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Modal for binding columns to Dropdowns-tab lists. Each row mirrors
// one of the caller's column headers and lets the user pick a source
// list + single/multi mode. "Default" leaves the binding to whatever
// the caller's defaultLinks map says, so built-in bindings stay in
// place unless explicitly overridden.
export function LinkColumnsModal({ headers, columnLinks, defaultLinks = {}, listRegistry, availableLists, onChange, onClose }) {
  const registry = listRegistry instanceof Map ? listRegistry : buildListRegistry(listRegistry || []);
  const lists = availableLists || buildAvailableLists(Array.from(registry.values()));
  const setBinding = (column, patch) => {
    const next = { ...(columnLinks || {}) };
    const current = next[column] || { listKey: 'default', mode: 'single' };
    const merged = { ...current, ...patch };
    if (merged.listKey === 'default') delete next[column];
    else next[column] = merged;
    onChange(next);
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 680, maxWidth: '94vw', maxHeight: '86vh',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)',
        }}>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
              Link columns to Dropdowns lists
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
              Pick a list for any column. Single = one value per cell, Multi = checkbox list.
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

        <div style={{ overflowY: 'auto', padding: '0.5rem 1rem 1rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)' }}>
                <th style={{ padding: '0.45rem 0.4rem', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Column</th>
                <th style={{ padding: '0.45rem 0.4rem', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Dropdown list</th>
                <th style={{ padding: '0.45rem 0.4rem', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Mode</th>
              </tr>
            </thead>
            <tbody>
              {headers.map(h => {
                const userBinding = columnLinks?.[h];
                const defaultBinding = defaultLinks[h];
                const effective = resolveColumnLink(h, columnLinks, defaultLinks);
                const selectedListKey = userBinding ? userBinding.listKey : 'default';
                const mode = userBinding?.mode || effective?.mode || 'single';
                return (
                  <tr key={h} style={{ borderTop: '1px solid var(--color-border-light)' }}>
                    <td style={{ padding: '0.5rem 0.4rem', fontWeight: 600, color: 'var(--color-text)' }}>{h}</td>
                    <td style={{ padding: '0.5rem 0.4rem' }}>
                      <select
                        value={selectedListKey}
                        onChange={(e) => setBinding(h, { listKey: e.target.value })}
                        style={{
                          width: '100%', padding: '0.35rem 0.45rem',
                          border: '1px solid var(--color-border)', borderRadius: 4,
                          fontSize: '0.82rem', fontFamily: 'inherit',
                          background: '#fff', color: 'var(--color-text)',
                        }}
                      >
                        <option value="default">
                          {defaultBinding
                            ? `Default (${registry.get(defaultBinding.listKey)?.label || defaultBinding.listKey})`
                            : 'Default (free text)'}
                        </option>
                        <option value="none">(No list (free text))</option>
                        <optgroup label="Dropdowns">
                          {lists.map(l => (
                            <option key={l.key} value={l.key}>{l.label}</option>
                          ))}
                        </optgroup>
                      </select>
                    </td>
                    <td style={{ padding: '0.5rem 0.4rem', whiteSpace: 'nowrap' }}>
                      <label style={{ marginRight: '0.6rem', cursor: effective ? 'pointer' : 'not-allowed', opacity: effective ? 1 : 0.4 }}>
                        <input
                          type="radio"
                          name={`mode-${h}`}
                          disabled={!effective}
                          checked={!!effective && mode === 'single'}
                          onChange={() => setBinding(h, {
                            listKey: selectedListKey === 'default' ? (defaultBinding?.listKey || 'none') : selectedListKey,
                            mode: 'single',
                          })}
                          style={{ marginRight: 4 }}
                        />Single
                      </label>
                      <label style={{ marginRight: '0.6rem', cursor: effective ? 'pointer' : 'not-allowed', opacity: effective ? 1 : 0.4 }}>
                        <input
                          type="radio"
                          name={`mode-${h}`}
                          disabled={!effective}
                          checked={!!effective && mode === 'multi'}
                          onChange={() => setBinding(h, {
                            listKey: selectedListKey === 'default' ? (defaultBinding?.listKey || 'none') : selectedListKey,
                            mode: 'multi',
                          })}
                          style={{ marginRight: 4 }}
                        />Multi
                      </label>
                      <label style={{ cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`mode-${h}`}
                          checked={!effective}
                          onChange={() => setBinding(h, { listKey: 'none', mode: 'single' })}
                          style={{ marginRight: 4 }}
                        />None
                      </label>
                    </td>
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
          <button
            type="button"
            onClick={() => onChange({})}
            style={{
              padding: '0.35rem 0.7rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Reset to defaults</button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
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
