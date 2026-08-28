import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { STAGE_AGE_GUIDANCE } from '../../data/dropdownLists';
import { getEffectiveServiceMetadata, rolloutWeeks } from '../../data/serviceCatalog';
import {
  getServiceCategories,
  moveServiceToBucket,
  pruneServicesFromCategories,
  renameServiceInCategories,
  serviceBucketOf,
  UNGROUPED_SERVICES,
} from '../../utils/serviceCategoriesStore';
import {
  boardOnlyServiceCount,
  getEffectiveDropdownLists,
  makeCustomListKey,
} from '../../utils/dropdownListsStore';
import { QuestionsTab } from './QuestionsTab';
import { ServicesPricingTab } from './ServicesPricingTab';
import { TimelinesTab } from './TimelinesTab';
import { getTimelineTemplates } from '../../utils/timelineTemplatesStore';
import { getServicePricing, renameServicePricing } from '../../utils/servicePricing';
import { parseServiceRefs, formatServiceRef } from '../../utils/serviceStepDeps';
import { DataTable } from '../common/DataTable';
import { ServiceDetailModal } from './ServiceDetailModal';
import { parseMulti } from '../common/columnLinks';
import styles from './DropdownsView.module.css';

// Key the Services table's column prefs (widths, visibility, order) are
// stored under, in settings.tablePrefs and localStorage alike.
const SERVICES_TABLE_ID = 'dropdowns-services';

// Widths are the starting point only — the table persists whatever the user
// drags them to, per column, under settings.tablePrefs (see SERVICES_TABLE_ID).
const SERVICE_TABLE_COLUMNS = [
  { key: 'name',             label: 'Solutions',         width: 280,    editable: false },
  // BFO Tag and Local Project Name were two columns holding the same
  // "#DATA" / "#SUECO" string on every service, so they're one column now.
  // It writes `bfoTag`; the catalog hands the value back under both names,
  // so anything reading a Local Project Name still reads this cell.
  // Wide enough for the two-name header, which is what has to fit — the
  // tags themselves are short.
  { key: 'bfoTag',           label: 'BFO Tag / Local Project Name', width: 265, editable: true },
  // The box the services board files this service in ("DATA", "RA Modules",
  // …). Editing it moves the service on the board itself, so the Opps Scope
  // picker and the company card show it in its new box straight away.
  { key: 'serviceBucket',    label: 'Service Bucket',    width: 235,    editable: true  },
  { key: 'region',           label: 'Region',            width: 90,     editable: true  },
  { key: 'years',            label: 'Years',             width: 90,     editable: true  },
  { key: 'productLine',      label: 'Product Line',      width: 260,    editable: true  },
  { key: 'serviceType',      label: 'Service Type',      width: 110,    editable: true  },
  { key: 'timelineDriven',   label: 'Timeline Driven',   width: 120,    editable: true  },
  // Wider than the numbers in it need, because the header is what has to
  // fit: "Rollout Time (weeks)" is where the unit is stated.
  { key: 'rolloutTime',      label: 'Rollout Time (weeks)', width: 190, editable: true  },
  { key: 'dependsOn',        label: 'Dependent Rollout Services', width: 260, editable: true },
  { key: 'sme',              label: 'SME',               width: 150,    editable: true  },
  { key: 'ktm',              label: 'KTM',               width: 150,    editable: true  },
  // Row action rather than data. Pinned always-visible (see the table's
  // alwaysVisible), which also means it needs no reveal migration for users
  // who already have a saved column set.
  { key: 'hide',             label: 'Hide',              width: 58,     editable: false },
];

// Columns added to the Services table after it gained saved column prefs.
// A user with a stored visible-set has it without these keys, so DataTable
// would keep them hidden forever — each is revealed once, then its flag is
// recorded so a user who later hides it isn't re-fought.
const SERVICES_LATE_COLUMNS = [
  { key: 'sme',       flag: 'servicesSmeColumnRevealed' },
  { key: 'dependsOn', flag: 'servicesDependsOnColumnRevealed' },
  { key: 'ktm',       flag: 'servicesKtmColumnRevealed' },
  { key: 'serviceBucket', flag: 'servicesBucketColumnRevealed' },
  // Not a new column, but the survivor of the BFO Tag / Local Project Name
  // merge: a user who had hidden BFO Tag and kept Local Project Name would
  // otherwise be left with neither, since the retired key matches no column.
  { key: 'bfoTag',    flag: 'servicesMergedBfoTagColumnRevealed' },
];

// Clicking a Services row opens its detail popup, so every editor inside a
// cell has to keep its own clicks to itself — otherwise starting an edit
// would open the popup over the top of it. One helper rather than a
// hand-written stopPropagation per control, so a new editor can't quietly
// forget it.
const swallowClick = (e) => e.stopPropagation();

// Inline cell editor for the Services subtab. Renders the current
// value as plain text; clicking it swaps to an input that commits on
// blur / Enter and cancels on Escape. Empty value clears the
// override (so the cell falls back to the seed-catalog value if any).
function ServiceCell({ value, onCommit }) {
  const [draft, setDraft] = useState(null);
  const inputRef = useRef(null);
  const editing = draft !== null;
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function startEdit() { setDraft(value || ''); }
  function commit() {
    const trimmed = (draft ?? '').trim();
    setDraft(null);
    if (trimmed === (value || '')) return;
    onCommit(trimmed);
  }
  function cancel() { setDraft(null); }

  if (!editing) {
    return (
      <span
        onClick={(e) => { swallowClick(e); startEdit(); }}
        title="Click to edit"
        style={{ display: 'inline-block', width: '100%', cursor: 'text', minHeight: '1em' }}
      >
        {value
          ? value
          : <span className={styles.serviceMutedCell}>-</span>}
      </span>
    );
  }
  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      onClick={swallowClick}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      }}
      style={{
        width: '100%',
        padding: '3px 6px',
        border: '1px solid var(--color-accent)', borderRadius: 4,
        fontSize: '0.75rem', fontFamily: 'inherit',
        background: '#fff', color: 'var(--color-text)',
        boxSizing: 'border-box',
      }}
    />
  );
}

// Yes/No dropdown for the Services subtab's "Timeline Driven" column.
// Renders as a compact <select>; an empty value ("—") means the user
// hasn't set it yet and clears the override so the cell falls back to
// the seed value (currently none).
function ServiceYesNoCell({ value, onCommit }) {
  return (
    <select
      value={value || ''}
      onClick={swallowClick}
      onChange={(e) => {
        const next = e.target.value;
        if (next === (value || '')) return;
        onCommit(next);
      }}
      title="Is this service timeline driven?"
      style={{
        width: '100%',
        padding: '3px 4px',
        border: '1px solid transparent', borderRadius: 4,
        fontSize: '0.75rem', fontFamily: 'inherit',
        background: 'transparent', color: 'var(--color-text)',
        cursor: 'pointer', boxSizing: 'border-box',
      }}
    >
      <option value="">-</option>
      <option value="Yes">Yes</option>
      <option value="No">No</option>
    </select>
  );
}

// Service Bucket picker. The options are the boxes the services board
// actually has, so picking one moves the service into that box rather than
// recording a label beside it. "Other services" is the Scope picker's
// catch-all card, and choosing it takes the service out of every box.
function ServiceBucketCell({ value, options, onCommit }) {
  const current = value || UNGROUPED_SERVICES;
  return (
    <select
      value={current}
      onClick={swallowClick}
      onChange={(e) => {
        const next = e.target.value;
        if (next === current) return;
        onCommit(next);
      }}
      title="Which box of the services board this service sits in — the same boxes the Opps Scope picker and the company card show"
      style={{
        width: '100%',
        padding: '3px 4px',
        border: '1px solid transparent', borderRadius: 4,
        fontSize: '0.75rem', fontFamily: 'inherit',
        background: 'transparent', color: 'var(--color-text)',
        cursor: 'pointer', boxSizing: 'border-box',
      }}
    >
      {options.map(b => <option key={b} value={b}>{b}</option>)}
      <option value={UNGROUPED_SERVICES}>{UNGROUPED_SERVICES}</option>
    </select>
  );
}

// The Rollout Time (weeks) cell. A number column: it shows the week count
// on its own — the unit is in the header — and edits through a number
// input rather than free text.
//
// Legacy free text that isn't a number of weeks is shown as it was saved,
// marked as needing a number, instead of being dropped or having a number
// guessed out of it: "4-6 weeks" was written by someone who meant both
// ends of a range, and picking one silently would lose half of what they
// said. Editing the cell replaces it with a number.
//
// A commit only writes when the value in the box actually changed, so
// clicking a cell and clicking away can't blank a legacy entry.
function ServiceWeeksCell({ value, onCommit }) {
  const [draft, setDraft] = useState(null);
  const initialRef = useRef('');
  const inputRef = useRef(null);
  const editing = draft !== null;
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const weeks = rolloutWeeks(value);
  const legacy = !!value && weeks === null;

  function startEdit() {
    // A legacy range opens empty — there's no one number to prefill it
    // with — with the old text still in front of the user as the
    // placeholder so they can see what they're replacing.
    const start = weeks === null ? '' : String(weeks);
    initialRef.current = start;
    setDraft(start);
  }
  function commit() {
    const typed = (draft ?? '').trim();
    setDraft(null);
    if (typed === initialRef.current) return;
    if (typed === '') { onCommit(''); return; }
    const n = Number(typed);
    // Not a usable week count: leave what's stored alone.
    if (!Number.isFinite(n) || n < 0) return;
    onCommit(String(n));
  }
  function cancel() { setDraft(null); }

  if (!editing) {
    return (
      <span
        onClick={(e) => { swallowClick(e); startEdit(); }}
        title={legacy
          ? `"${value}" isn't a number of weeks — click to replace it with one`
          : 'Click to edit: rollout time in weeks'}
        style={{ display: 'inline-block', width: '100%', cursor: 'text', minHeight: '1em' }}
      >
        {weeks !== null
          ? weeks
          : legacy
            ? <span className={styles.serviceLegacyWeeksCell}>{value}</span>
            : <span className={styles.serviceMutedCell}>-</span>}
      </span>
    );
  }
  return (
    <input
      ref={inputRef}
      type="number"
      min="0"
      step="0.5"
      inputMode="decimal"
      value={draft}
      placeholder={legacy ? value : 'weeks'}
      onClick={swallowClick}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      }}
      style={{
        width: '100%',
        padding: '3px 6px',
        border: '1px solid var(--color-accent)', borderRadius: 4,
        fontSize: '0.75rem', fontFamily: 'inherit',
        background: '#fff', color: 'var(--color-text)',
        boxSizing: 'border-box',
      }}
    />
  );
}

// The Dependent Rollout Services cell: the services that have to be rolled
// out before this one can start. Stored as a comma-separated list of
// Solutions names — the same shape every other multi-value column in the
// app uses, so it reads back through parseMulti and searches as plain text.
//
// Picked from the Solutions list rather than typed, so a dependency always
// names a service that exists; a row can't depend on itself, so it isn't
// offered. A name that no longer matches a live service (renamed or
// retired since it was picked) still shows, flagged, rather than being
// dropped — losing a mapping silently is worse than showing a stale one.
//
// The popover is portalled to the body: the table scrolls both ways inside
// its own wrapper, which would otherwise clip it.
function ServiceDependsCell({ value, options, selfName, onCommit }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rect, setRect] = useState(null);
  const cellRef = useRef(null);

  // Dependencies as { service, step }. This picker chooses SERVICES; the step
  // each one is refined to is chosen in the service's detail popup. Editing
  // here therefore has to carry those steps through untouched — ticking one
  // more service must not quietly re-plan every deal that was waiting on a
  // step of another.
  const refs = useMemo(() => parseServiceRefs(value), [value]);
  const selected = useMemo(() => refs.map(r => r.service), [refs]);
  const stepByService = useMemo(
    () => new Map(refs.map(r => [r.service.trim().toLowerCase(), r.step])), [refs]);
  const selectedSet = useMemo(
    () => new Set(selected.map(s => s.trim().toLowerCase())), [selected]);
  // Everything pickable: every other service, self excluded.
  const pickable = useMemo(
    () => options.filter(o => o.trim().toLowerCase() !== String(selfName).trim().toLowerCase()),
    [options, selfName]);
  const liveSet = useMemo(
    () => new Set(pickable.map(o => o.trim().toLowerCase())), [pickable]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? pickable.filter(o => o.toLowerCase().includes(q)) : pickable;
  }, [pickable, query]);

  function openPicker() {
    const el = cellRef.current;
    if (el) setRect(el.getBoundingClientRect());
    setQuery('');
    setOpen(true);
  }
  function close() { setOpen(false); setQuery(''); }

  // Order follows the Solutions list for picked names, so two rows with the
  // same dependencies read identically; anything stale trails at the end.
  function toggle(name) {
    const key = name.trim().toLowerCase();
    const next = selectedSet.has(key)
      ? refs.filter(r => r.service.trim().toLowerCase() !== key)
      : [...refs, { service: name, step: '' }];
    const byName = new Map(next.map(r => [r.service.trim().toLowerCase(), r]));
    const ordered = [
      ...pickable.filter(o => byName.has(o.trim().toLowerCase())).map(o => byName.get(o.trim().toLowerCase())),
      ...next.filter(r => !liveSet.has(r.service.trim().toLowerCase())),
    ];
    // r.localStep travels with r.step: toggling one dependency must not
    // quietly drop the step another one is anchored to.
    onCommit(ordered.map(r => formatServiceRef(r.service, r.step, r.localStep)).join(', '));
  }

  // This column lists SERVICES. Where one has been refined to a step, the
  // chip carries a "›" and says so — resolving the stored step id to its name
  // would mean handing all 139 cells the whole set of timelines, and the
  // service's own popup is where the step is read and chosen anyway.
  const refined = (name) => !!stepByService.get(name.trim().toLowerCase());
  const label = (name) => (refined(name) ? `${name} ›` : name);
  const depTitle = (name) => (refined(name)
    ? `${name} — waits on one step of it, not all of it. Open ${selfName} to see or change which.`
    : name);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const chip = (name, stale) => (
    <span
      key={name}
      title={stale ? `"${name}" isn't in the Solutions list any more` : depTitle(name)}
      className={stale ? styles.serviceDepChipStale : styles.serviceDepChip}
    >{label(name)}</span>
  );

  return (
    <>
      <span
        ref={cellRef}
        onClick={(e) => { swallowClick(e); openPicker(); }}
        title={selected.length > 0
          ? `Rolled out before ${selfName}: ${selected.map(label).join(', ')}. Click to change which services; a "›" marks one this waits only part-way through — open ${selfName} to pick the step.`
          : `Click to pick the services that must be rolled out before ${selfName}`}
        style={{ display: 'flex', flexWrap: 'nowrap', gap: 3, width: '100%', cursor: 'pointer', minHeight: '1em', overflow: 'hidden' }}
      >
        {/* One line, whatever the count: a service with five dependencies
            stacked five chips high and pushed every other column on the row
            down with it. The first one names what this is, the +N says how
            much more there is, and the whole list is a hover or a click
            away — neither of which costs the rows above and below. */}
        {selected.length > 0 ? (
          <>
            {chip(selected[0], !liveSet.has(selected[0].trim().toLowerCase()))}
            {selected.length > 1 && (
              <span
                className={styles.serviceDepChipMore}
                title={`Also: ${selected.slice(1).map(label).join(', ')}`}
              >+{selected.length - 1}</span>
            )}
          </>
        ) : <span className={styles.serviceMutedCell}>-</span>}
      </span>
      {open && rect && createPortal(
        <>
          {/* Click-away catcher, so the picker closes on any outside click
              without each cell wiring up its own document listener.

              Both of these stop propagation as well as the cell does: a
              portal renders into document.body but still bubbles its events
              up the React tree, so without it dismissing the picker would
              land as a click on the row underneath and open its popup. */}
          <div
            onClick={(e) => { swallowClick(e); close(); }}
            style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'transparent' }}
          />
          <div
            onClick={swallowClick}
            style={{
              position: 'fixed', zIndex: 9001,
              left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)),
              ...(window.innerHeight - rect.bottom < 280 && rect.top > window.innerHeight - rect.bottom
                ? { bottom: Math.round(window.innerHeight - rect.top + 4) }
                : { top: Math.round(rect.bottom + 4) }),
              width: 320, maxHeight: 300, background: '#fff',
              border: '1px solid var(--color-border)', borderRadius: 6,
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '0.4rem 0.45rem', borderBottom: '1px solid var(--color-border-light)' }}>
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search services…"
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '3px 6px',
                  border: '1px solid var(--color-border)', borderRadius: 4,
                  fontSize: '0.75rem', fontFamily: 'inherit',
                }}
              />
            </div>
            <div style={{ overflowY: 'auto', padding: '0.2rem 0' }}>
              {shown.length === 0 && (
                <div style={{ padding: '0.4rem 0.55rem', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                  No services match “{query}”.
                </div>
              )}
              {shown.map(name => {
                const on = selectedSet.has(name.trim().toLowerCase());
                return (
                  <label
                    key={name}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.4rem',
                      padding: '0.2rem 0.55rem', fontSize: '0.75rem', cursor: 'pointer',
                      background: on ? 'var(--color-bg)' : 'transparent',
                    }}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggle(name)} />
                    <span style={{ flex: 1, minWidth: 0 }}>{name}</span>
                  </label>
                );
              })}
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '0.35rem 0.5rem', borderTop: '1px solid var(--color-border-light)',
              fontSize: '0.7rem', color: 'var(--color-text-muted)',
            }}>
              <span>{selected.length} selected</span>
              <span style={{ display: 'flex', gap: '0.5rem' }}>
                {selected.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onCommit('')}
                    className={styles.serviceLinkEditBtn}
                  >Clear</button>
                )}
                <button type="button" onClick={close} className={styles.serviceLinkEditBtn}>Done</button>
              </span>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

// The Solutions cell of the Services table. Renders as a hyperlink when the
// user has saved a URL for that service; the pencil opens a tiny inline
// editor so per-service URLs can be added, updated, or cleared.
//
// It also carries the row's "open details" button. The whole row opens the
// popup, but nearly every cell is covered edge to edge by a click-to-edit
// editor that has to swallow its own clicks — leaving only the gaps between
// them to click on. So the affordance is spelled out once, here, on the
// column that names the row.
function ServiceNameCell({ name, url, onSaveUrl, onOpenDetails }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function startEdit() {
    setDraft(url || '');
    setEditing(true);
  }
  function commit() {
    const next = draft.trim();
    setEditing(false);
    if ((next || '') === (url || '')) return;
    onSaveUrl(name, next);
  }

  if (editing) {
    return (
      <div onClick={swallowClick} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          ref={inputRef}
          type="url"
          value={draft}
          placeholder="https://example.com"
          onClick={swallowClick}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
          }}
          style={{ flex: 1, minWidth: 0, padding: '3px 6px', border: '1px solid var(--color-accent)', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit' }}
        />
        <span style={{ fontSize: '0.62rem', color: 'var(--color-text-muted)' }}>{name}</span>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <button
        type="button"
        className={styles.serviceDetailsBtn}
        onClick={(e) => { swallowClick(e); onOpenDetails(); }}
        title={`Open ${name} — every field on one screen`}
        aria-label={`Open details for ${name}`}
      >⤢</button>
      {url ? (
        // The name is the user's own hyperlink when they've set one, so it
        // navigates rather than opening the popup; the ⤢ beside it is what
        // opens details on every row alike.
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className={styles.serviceLink}
          title={url}
          onClick={swallowClick}
        >{name}</a>
      ) : (
        <span
          onClick={(e) => { swallowClick(e); onOpenDetails(); }}
          title={`Open ${name} — every field on one screen`}
          style={{ color: 'var(--color-text)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >{name}</span>
      )}
      <button
        type="button"
        className={styles.serviceLinkEditBtn}
        onClick={(e) => { swallowClick(e); startEdit(); }}
        title={url ? 'Edit link' : 'Add link'}
        aria-label={url ? 'Edit link' : 'Add link'}
      >{url ? '✎' : '+ link'}</button>
      {url && (
        <button
          type="button"
          className={styles.serviceLinkEditBtn}
          onClick={(e) => { swallowClick(e); onSaveUrl(name, ''); }}
          title="Remove link"
          aria-label="Remove link"
        >×</button>
      )}
    </div>
  );
}

// Reference + edit page for the Dropdowns vocabulary that the rest of
// the app uses (Opps 2 column linking, Deals / Clients column linking).
// Each list card is editable in place — option rows commit on blur /
// Enter, the × button on a row removes a single option, and "+ Add
// option" appends a new entry. The card header lets the user rename
// the list and the trash icon removes it (built-ins are hidden behind
// settings.dropdownListsHidden so they can be restored later by
// clearing the setting; customs are deleted outright). The footer
// shows a "+ New list" button for creating a brand-new vocabulary.

// Single editable option row. Holds a local draft so typing is
// instant; the parent only learns about the change on commit (blur
// or Enter), which keeps Firestore writes per-edit not per-keystroke.
//
// When `linkEnabled` is set (the Solutions / Service Catalog card),
// the row grows a second column where the user can attach a
// presentation hyperlink for that option. The link commits on blur /
// Enter; clearing it removes the link.
function OptionRow({ value, onCommit, onRemove, linkEnabled, link, onSaveLink }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  const [linkEditing, setLinkEditing] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const linkInputRef = useRef(null);
  useEffect(() => { if (linkEditing) linkInputRef.current?.focus(); }, [linkEditing]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === value) return; // no-op
    if (trimmed === '') { onRemove(); return; }
    onCommit(trimmed);
  }
  function cancel() {
    setDraft(value);
  }

  function startLinkEdit() { setLinkDraft(link || ''); setLinkEditing(true); }
  function commitLink() {
    const next = linkDraft.trim();
    setLinkEditing(false);
    if ((next || '') === (link || '')) return;
    onSaveLink(value, next);
  }
  function cancelLink() { setLinkEditing(false); }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancel(); e.currentTarget.blur(); }
        }}
        style={{
          flex: 1, minWidth: 0,
          padding: '3px 6px',
          border: '1px solid transparent', borderRadius: 4,
          fontSize: '0.78rem', fontFamily: 'inherit',
          color: 'var(--color-text)', background: 'transparent',
        }}
        onFocus={(e) => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
        onBlurCapture={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
      />
      {linkEnabled && (
        <div className={styles.optionLinkCell}>
          {linkEditing ? (
            <input
              ref={linkInputRef}
              type="url"
              value={linkDraft}
              placeholder="https://…/presentation"
              onChange={(e) => setLinkDraft(e.target.value)}
              onBlur={commitLink}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitLink(); }
                else if (e.key === 'Escape') { e.preventDefault(); cancelLink(); }
              }}
              style={{
                flex: 1, minWidth: 0,
                padding: '3px 6px',
                border: '1px solid var(--color-accent)', borderRadius: 4,
                fontSize: '0.72rem', fontFamily: 'inherit',
                color: 'var(--color-text)', background: '#fff',
              }}
            />
          ) : link ? (
            <>
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className={styles.serviceLink}
                title={link}
              >🔗 Presentation</a>
              <button
                type="button"
                className={styles.serviceLinkEditBtn}
                onClick={startLinkEdit}
                title="Edit presentation link"
                aria-label="Edit presentation link"
              >✎</button>
              <button
                type="button"
                className={styles.serviceLinkEditBtn}
                onClick={() => onSaveLink(value, '')}
                title="Remove presentation link"
                aria-label="Remove presentation link"
              >×</button>
            </>
          ) : (
            <button
              type="button"
              className={styles.serviceLinkEditBtn}
              onClick={startLinkEdit}
              title="Add presentation link"
              aria-label="Add presentation link"
            >+ link</button>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        title="Remove this option"
        style={{
          flex: '0 0 auto',
          padding: '0', width: 20, height: 20, lineHeight: 1,
          background: 'transparent', border: '1px solid transparent', borderRadius: 4,
          color: '#94A3B8', fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#B91C1C'; e.currentTarget.style.borderColor = '#FCA5A5'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#94A3B8'; e.currentTarget.style.borderColor = 'transparent'; }}
      >×</button>
    </div>
  );
}

// Editable list title. Switches to an input on click and commits on
// blur / Enter; Escape reverts. Keeps the same look as the static
// title when not focused so the page stays calm.
function EditableTitle({ value, onCommit }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  function commit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) { setDraft(value); return; }
    onCommit(trimmed);
  }
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(value); e.currentTarget.blur(); }
      }}
      title="Click to rename"
      className={styles.cardTitle}
      style={{
        flex: 1, minWidth: 0,
        padding: '2px 4px',
        border: '1px solid transparent', borderRadius: 4,
        background: 'transparent', fontFamily: 'inherit',
      }}
      onFocus={(e) => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
      onBlurCapture={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
    />
  );
}

// Single editable list card. Filters its option list to whatever
// matches the global search term but always edits against the full
// underlying array.
function ListCard({ list, filter, wide, links, onSaveLink, onChange, onRenameLabel, onRemoveList }) {
  const linkEnabled = typeof onSaveLink === 'function';
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState('');
  const addInputRef = useRef(null);

  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  // Edits report what they did as well as the array they produced: on the
  // Solutions list a rename has to be applied to the services board too, and
  // the new array alone can't tell a rename from a delete-plus-add.
  function commitOption(idx, next) {
    const out = [...list.options];
    const from = list.options[idx];
    out[idx] = next;
    onChange(list.key, out, { renamedFrom: from, renamedTo: next });
  }
  function removeOption(idx) {
    const out = list.options.filter((_, i) => i !== idx);
    onChange(list.key, out);
  }
  function commitAdd() {
    const v = addDraft.trim();
    setAddDraft('');
    setAdding(false);
    if (!v) return;
    // No-op if the value already exists (case-insensitive).
    if (list.options.some(o => o.toLowerCase() === v.toLowerCase())) return;
    onChange(list.key, [...list.options, v]);
  }
  function cancelAdd() {
    setAddDraft('');
    setAdding(false);
  }

  function handleRemoveList() {
    const confirmMsg = list.builtin
      ? `Hide the built-in "${list.label}" list? You can restore it later from settings.`
      : `Delete the "${list.label}" list? This can't be undone.`;
    if (!window.confirm(confirmMsg)) return;
    onRemoveList(list.key, list.builtin);
  }

  const filterLower = filter.trim().toLowerCase();
  // Walk the original list so each entry keeps its real index — the
  // edit / remove handlers refer back to the underlying array, not
  // the filtered subset.
  const visible = list.options
    .map((opt, idx) => ({ opt, idx }))
    .filter(({ opt }) => !filterLower || String(opt).toLowerCase().includes(filterLower));

  return (
    <div className={styles.card} style={wide ? { gridColumn: 'span 2' } : undefined}>
      <div className={styles.cardHeader}>
        <EditableTitle value={list.label} onCommit={(next) => onRenameLabel(list.key, next)} />
        <span className={styles.cardCount}>{list.options.length}</span>
        <button
          type="button"
          onClick={handleRemoveList}
          title={list.builtin ? 'Hide this built-in list' : 'Delete this list'}
          style={{
            flex: '0 0 auto',
            padding: 0, width: 22, height: 22, lineHeight: 1,
            background: 'transparent', border: '1px solid transparent', borderRadius: 4,
            color: '#94A3B8', fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#B91C1C'; e.currentTarget.style.borderColor = '#FCA5A5'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#94A3B8'; e.currentTarget.style.borderColor = 'transparent'; }}
        >🗑</button>
      </div>
      <div className={`${styles.cardBody} ${wide ? styles.cardBodyTall : ''}`}>
        {linkEnabled && (
          <div className={styles.listColHeader}>
            <span className={styles.listColHeaderName}>Solution</span>
            <span className={styles.listColHeaderLink}>Presentation</span>
            <span className={styles.listColHeaderSpacer} />
          </div>
        )}
        {visible.length === 0 ? (
          <div className={styles.optionEmpty}>
            {list.options.length === 0 ? '(no options)' : '(no matches)'}
          </div>
        ) : (
          visible.map(({ opt, idx }) => (
            <OptionRow
              key={`${idx}-${opt}`}
              value={opt}
              onCommit={(next) => commitOption(idx, next)}
              onRemove={() => removeOption(idx)}
              linkEnabled={linkEnabled}
              link={linkEnabled ? (links?.[opt] || '') : ''}
              onSaveLink={onSaveLink}
            />
          ))
        )}
        {adding && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
            <input
              ref={addInputRef}
              type="text"
              value={addDraft}
              placeholder="New option…"
              onChange={(e) => setAddDraft(e.target.value)}
              onBlur={commitAdd}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitAdd(); }
                else if (e.key === 'Escape') { e.preventDefault(); cancelAdd(); }
              }}
              style={{
                flex: 1, minWidth: 0,
                padding: '3px 6px',
                border: '1px solid var(--color-accent)', borderRadius: 4,
                fontSize: '0.78rem', fontFamily: 'inherit',
                color: 'var(--color-text)', background: '#fff',
              }}
            />
          </div>
        )}
      </div>
      <div style={{ padding: '0.3rem 0.6rem 0.5rem', borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)' }}>
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={adding}
          style={{
            width: '100%', padding: '0.3rem 0.5rem',
            background: 'transparent',
            border: '1px dashed var(--color-border)', borderRadius: 4,
            fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit',
            color: 'var(--color-text-muted)',
            cursor: adding ? 'default' : 'pointer',
            opacity: adding ? 0.5 : 1,
          }}
        >+ Add option</button>
      </div>
    </div>
  );
}

export function DropdownsView({ settings, updateSettings }) {
  const [activeTab, setActiveTab] = useState('lists');
  const [search, setSearch] = useState('');
  // The Services Pricing subtab's working estimate: which services are
  // ticked, how many sites / accounts / meters the account has, and the deal
  // size percentage-based fees take their cut of. Held here rather than in
  // the subtab so stepping over to Services to fix a rate and coming back
  // doesn't throw a half-built estimate away. Deliberately not saved — it's
  // a scratch calculation; the rate card it reads is what's in settings.
  const [pricingScenario, setPricingScenario] = useState({ services: [], counts: {}, dealSize: '' });
  const [serviceSearch, setServiceSearch] = useState('');
  const lists = useMemo(() => getEffectiveDropdownLists(settings), [
    settings?.dropdownLists,
    settings?.dropdownListLabels,
    settings?.dropdownListsHidden,
    settings?.dropdownCustomLists,
    // Solutions is served unioned with the services board (see
    // mergeBoardServices), so filing a service into a box on this very page
    // has to rebuild the list it came from.
    settings?.customServiceCategories,
  ]);

  // Per-service URLs the user can paste in for hyperlinking. Stored
  // alongside the other dropdown settings so they sync across devices.
  // Memoized (rather than a bare expression) because the Services table's
  // column definitions depend on it — a fresh {} each render would rebuild
  // them, and the table with them, on every keystroke elsewhere on the page.
  const serviceLinks = useMemo(
    () => ((settings?.serviceLinks && typeof settings.serviceLinks === 'object') ? settings.serviceLinks : {}),
    [settings?.serviceLinks],
  );
  function saveServiceLink(name, url) {
    const next = { ...serviceLinks };
    const trimmed = (url || '').trim();
    if (trimmed) next[name] = trimmed;
    else delete next[name];
    updateSettings?.({ serviceLinks: next });
  }

  // Per-service presentation hyperlinks shown as a second column on
  // the Solutions / Service Catalog card (Lists tab). Stored separately
  // from `serviceLinks` (the Services subtab's name-as-link feature) so
  // the two don't interfere. Keyed by service name; syncs across
  // devices alongside the other dropdown settings.
  const presentationLinks = (settings?.servicePresentationLinks && typeof settings.servicePresentationLinks === 'object')
    ? settings.servicePresentationLinks
    : {};
  function savePresentationLink(name, url) {
    const next = { ...presentationLinks };
    const trimmed = (url || '').trim();
    if (trimmed) next[name] = trimmed;
    else delete next[name];
    updateSettings?.({ servicePresentationLinks: next });
  }

  // User overrides for the Services subtab cells. Persisted under
  // settings.serviceOverrides so edits sync across devices. A blank
  // value clears that field's override so the cell falls back to the
  // seed catalog value. Memoized so the conditional fallback to `{}`
  // doesn't churn the serviceRows useMemo every render.
  const serviceOverrides = useMemo(
    () => (settings?.serviceOverrides && typeof settings.serviceOverrides === 'object')
      ? settings.serviceOverrides
      : {},
    [settings?.serviceOverrides]
  );
  // The services board's box layout. Service Bucket is a view onto this —
  // not a per-service field — so the Scope picker, the company card's
  // board and this column can't drift apart.
  const serviceCategories = useMemo(
    () => getServiceCategories(settings),
    [settings?.customServiceCategories],
  );
  // Not memoized: seventeen strings off an already-memoized array, and
  // nothing downstream keys off its identity.
  const serviceBucketNames = serviceCategories.map(c => c.name);
  // Move a service into another box. The first such edit writes the whole
  // layout to settings.customServiceCategories, which from then on is what
  // every board reads — the same thing dragging a service on the company
  // card has always done.
  function saveServiceBucket(name, bucket) {
    const next = moveServiceToBucket(serviceCategories, name, bucket, settings?.serviceRenames);
    if (next) updateSettings?.({ customServiceCategories: next });
  }
  function saveServiceField(name, field, value) {
    const next = { ...serviceOverrides };
    const row = { ...(next[name] || {}) };
    if (value == null || value === '') delete row[field];
    else row[field] = value;
    if (Object.keys(row).length === 0) delete next[name];
    else next[name] = row;
    updateSettings?.({ serviceOverrides: next });
  }

  // Solutions list drives the Services subtab — same source the Lists
  // tab edits, so adding a service in one place shows it in the other.
  // Effective metadata = seed catalog + user override, computed via
  // getEffectiveServiceMetadata so the editor and any downstream
  // consumers (AI Prompt etc.) see exactly the same values.
  const solutionsList = useMemo(() => lists.find(l => l.key === 'solutions'), [lists]);
  // Every service name, for the Dependent Rollout Services picker. Read off
  // the live Solutions list — the same source the rows come from — so a
  // service added there is immediately pickable as a dependency.
  const solutionNames = useMemo(() => solutionsList?.options || [], [solutionsList]);
  const serviceRows = useMemo(() => {
    const options = solutionsList?.options || [];
    return options.map(name => ({
      name,
      meta: getEffectiveServiceMetadata(name, serviceOverrides),
      // '' means no box claims it, which is the Scope picker's catch-all
      // card — named here so the cell and the search box read the same.
      bucket: serviceBucketOf(serviceCategories, name) || UNGROUPED_SERVICES,
    }));
  }, [solutionsList, serviceOverrides, serviceCategories]);
  // Services the user has retired. The same app-wide set the company card's
  // Services Explored board and the Opps Scope picker read, so hiding here
  // takes a service out of circulation everywhere rather than only on this
  // page — this tab is where the vocabulary is managed, so it's the natural
  // place to retire one.
  const hiddenServices = useMemo(
    () => new Set(settings?.hiddenServices || []),
    [settings?.hiddenServices],
  );
  const hiddenCount = hiddenServices.size;
  // What the Services Pricing subtab lists. Same rows as the Services table
  // — so a service added, renamed or re-filed there is priced under its new
  // identity without a second edit — minus the hidden ones: a service that's
  // out of the Opps Scope picker can't be in a deal, so pricing it is moot.
  const pricingServiceRows = useMemo(
    () => serviceRows.filter(r => !hiddenServices.has(r.name)),
    [serviceRows, hiddenServices],
  );
  const [showHiddenServices, setShowHiddenServices] = useState(false);
  // Rows that reached this table through the services board rather than the
  // Solutions list — the note under the search row explains them, since a
  // user who never added them here would otherwise wonder where they came
  // from. Zero for a user whose list already carries the whole board.
  const boardOnlyCount = useMemo(
    () => boardOnlyServiceCount(settings),
    [settings?.dropdownLists, settings?.customServiceCategories],
  );

  // The service whose popup is open, held by name rather than by the row
  // object the table handed over: every edit made in the popup rewrites
  // settings and rebuilds the rows, so a captured row would go stale the
  // moment the user typed in it. The name is the key everything else is
  // stored under, so it survives.
  const [detailName, setDetailName] = useState(null);
  const detailService = useMemo(
    () => (detailName ? serviceRows.find(r => r.name === detailName) || null : null),
    [detailName, serviceRows],
  );
  // A service deleted from the Solutions list (on the Lists tab, in another
  // tab, or on another device) while its popup is open leaves detailService
  // null, which renders no popup — the stale name needs no clearing up,
  // since nothing but that lookup ever reads it.

  // Which services list each service as something they wait on — the reverse
  // of the Dependent Rollout Services column. Nothing stores it, so it's
  // derived from every row's dependency list; the popup is the only place it
  // appears, since no single row can show it.
  const dependentsByService = useMemo(() => {
    const map = new Map();
    for (const { name, meta } of serviceRows) {
      for (const dep of parseMulti(meta?.dependsOn || '')) {
        const key = dep.trim().toLowerCase();
        if (!key) continue;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(name);
      }
    }
    return map;
  }, [serviceRows]);
  const toggleHideService = useCallback((name) => {
    const current = settings?.hiddenServices || [];
    const next = current.includes(name)
      ? current.filter(s => s !== name)
      : [...current, name];
    updateSettings?.({ hiddenServices: next });
  }, [settings?.hiddenServices, updateSettings]);

  // Adding a service from this tab. The rows come from the Solutions list,
  // so a new one is an option appended to that list — the same edit the
  // Lists tab makes, which is why both tabs show it straight away. Only the
  // name is asked for here; the twelve columns behind it start blank, and
  // the row's popup opens on the new service so they can be filled in on
  // one screen rather than hunted across a horizontal scrollbar.
  const [addingService, setAddingService] = useState(false);
  const [newServiceName, setNewServiceName] = useState('');
  const [addServiceNote, setAddServiceNote] = useState('');
  const newServiceRef = useRef(null);
  // Focus the name box when the form opens, and again when the popup that
  // opened over it closes — otherwise the next name in a batch has to be
  // clicked into.
  useEffect(() => {
    if (addingService && !detailName) newServiceRef.current?.focus();
  }, [addingService, detailName]);

  function closeAddService() {
    setAddingService(false);
    setNewServiceName('');
    setAddServiceNote('');
  }

  function commitNewService() {
    const name = newServiceName.trim();
    if (!name) return;
    const options = solutionsList?.options || [];
    const existing = options.find(o => String(o).toLowerCase() === name.toLowerCase());
    setNewServiceName('');
    // A name that's already in the list is almost always one the user
    // can't see — hidden, or filtered out by the search box. Silently
    // doing nothing reads as the button being broken, so clear whatever
    // is hiding it and say where it went instead.
    if (existing) {
      if (hiddenServices.has(existing)) toggleHideService(existing);
      setServiceSearch(existing);
      setDetailName(existing);
      setAddServiceNote(`“${existing}” is already in the list — here it is.`);
      return;
    }
    const updates = {
      dropdownLists: { ...(settings?.dropdownLists || {}), solutions: [...options, name] },
    };
    // Re-adding a name that was hidden earlier has to bring it back, or
    // the new service lands straight in the hidden set and never appears.
    if (hiddenServices.has(name)) {
      updates.hiddenServices = (settings?.hiddenServices || []).filter(s => s !== name);
    }
    updateSettings?.(updates);
    // New options append, which on a list this long drops the row off the
    // bottom of the table. Search for what was just added so it's still on
    // screen behind the popup — and still there when the popup closes.
    setServiceSearch(name);
    setDetailName(name);
    setAddServiceNote(`Added “${name}” — clear the search box for the full list.`);
  }

  const filteredServiceRows = useMemo(() => {
    const term = serviceSearch.trim().toLowerCase();
    const visible = showHiddenServices
      ? serviceRows
      : serviceRows.filter(({ name }) => !hiddenServices.has(name));
    if (!term) return visible;
    return visible.filter(({ name, meta, bucket }) => {
      if (name.toLowerCase().includes(term)) return true;
      if (bucket.toLowerCase().includes(term)) return true;
      if (!meta) return false;
      return [meta.bfoTag, meta.region, meta.years, meta.productLine, meta.serviceType, meta.timelineDriven, meta.rolloutTime, meta.dependsOn, meta.sme, meta.ktm]
        .some(v => String(v || '').toLowerCase().includes(term));
    });
  }, [serviceRows, serviceSearch, hiddenServices, showHiddenServices]);

  // Reveal any SERVICES_LATE_COLUMNS the user's stored visible-set predates,
  // once each. Gated on settings._lastWriteAt so we only act after synced
  // settings have actually loaded. Mirrors the same one-time reveal Opps 2
  // used when it added its PE Owner column.
  useEffect(() => {
    if (!settings || !settings._lastWriteAt) return;
    const due = SERVICES_LATE_COLUMNS.filter(c => !settings[c.flag]);
    if (due.length === 0) return;
    const updates = {};
    for (const c of due) updates[c.flag] = true;

    // Remote prefs win in DataTable when they're non-empty, so the keys
    // have to go in here or the reveal doesn't show. Built up across all
    // due columns so two arriving together are one write, not two.
    const remote = settings?.tablePrefs?.[SERVICES_TABLE_ID]?.visible;
    if (Array.isArray(remote) && remote.length > 0) {
      const add = due.map(c => c.key).filter(k => !remote.includes(k));
      if (add.length > 0) {
        updates.tablePrefs = {
          ...(settings.tablePrefs || {}),
          [SERVICES_TABLE_ID]: {
            ...(settings.tablePrefs[SERVICES_TABLE_ID] || {}),
            visible: [...remote, ...add],
          },
        };
      }
    }
    try {
      const LS_KEY = `prospect-col-visible-${SERVICES_TABLE_ID}`;
      const saved = JSON.parse(localStorage.getItem(LS_KEY));
      if (Array.isArray(saved) && saved.length > 0) {
        const add = due.map(c => c.key).filter(k => !saved.includes(k));
        if (add.length > 0) localStorage.setItem(LS_KEY, JSON.stringify([...saved, ...add]));
      }
    } catch { /* ignore */ }
    updateSettings?.(updates);
  }, [settings, updateSettings]);

  // Service Bucket was briefly stored as a per-service `serviceBucket`
  // override, before it became a view onto the board layout. Fold any of
  // those into the layout once and drop the retired key, so a bucket picked
  // while it worked that way still shows — on the board as well as here.
  // Gated on _lastWriteAt like the column reveal below: synced settings have
  // to have landed before we can tell an empty map from an unloaded one.
  useEffect(() => {
    if (!settings || !settings._lastWriteAt) return;
    if (settings.serviceBucketOverridesMigrated) return;
    const overrides = settings.serviceOverrides || {};
    const stale = Object.keys(overrides).filter(n => overrides[n]?.serviceBucket);
    if (stale.length === 0) {
      updateSettings?.({ serviceBucketOverridesMigrated: true });
      return;
    }
    let layout = null;
    const nextOverrides = { ...overrides };
    for (const name of stale) {
      const moved = moveServiceToBucket(
        layout || getServiceCategories(settings),
        name,
        overrides[name].serviceBucket,
        settings.serviceRenames,
      );
      if (moved) layout = moved;
      const row = { ...nextOverrides[name] };
      delete row.serviceBucket;
      if (Object.keys(row).length === 0) delete nextOverrides[name];
      else nextOverrides[name] = row;
    }
    updateSettings?.({
      // Only when a service actually moved: an override that named the box
      // it was already in shouldn't freeze the seed layout into settings.
      ...(layout ? { customServiceCategories: layout } : {}),
      serviceOverrides: nextOverrides,
      serviceBucketOverridesMigrated: true,
    });
  }, [settings, updateSettings]);

  // Flat rows for the table: one field per column so sorting, the search
  // box and the Excel export all read straight off the row, with the
  // pieces the cells need to render (link, muted state) alongside.
  const serviceTableRows = useMemo(() => filteredServiceRows.map(({ name, meta, bucket }) => ({
    id: name,
    name,
    bfoTag: meta?.bfoTag || '',
    serviceBucket: bucket,
    region: meta?.region || '',
    years: meta?.years || '',
    productLine: meta?.productLine || '',
    serviceType: meta?.serviceType || '',
    timelineDriven: meta?.timelineDriven || '',
    rolloutTime: meta?.rolloutTime || '',
    dependsOn: meta?.dependsOn || '',
    sme: meta?.sme || '',
    ktm: meta?.ktm || '',
    _url: serviceLinks[name] || '',
    _muted: !!meta?.graveyard,
    _hidden: hiddenServices.has(name),
  })), [filteredServiceRows, serviceLinks, hiddenServices]);

  // Column definitions. The declared width is only the starting point — the
  // table owns width and visibility from here, and Solutions stays pinned
  // since a row with no service name can't be identified. Rebuilt each
  // render rather than memoized: nine objects cost nothing, and memoizing
  // would mean stabilising the two save helpers for no real gain.
  const serviceColumns = SERVICE_TABLE_COLUMNS.map(col => ({
    key: col.key,
    label: col.label,
    defaultWidth: col.width,
    render: col.key === 'hide'
      ? (row) => (
        <button
          type="button"
          className={styles.serviceLinkEditBtn}
          onClick={(e) => { swallowClick(e); toggleHideService(row.name); }}
          title={row._hidden
            ? `Show "${row.name}" again: here, on the company card's services board, and in the Opps Scope picker`
            : `Hide "${row.name}": takes it out of this list, the company card's services board, and the Opps Scope picker`}
          aria-label={row._hidden ? `Show ${row.name}` : `Hide ${row.name}`}
        >{row._hidden ? '↩' : '✕'}</button>
      )
      : col.key === 'name'
      ? (row) => (
        <ServiceNameCell
          name={row.name}
          url={row._url}
          onSaveUrl={saveServiceLink}
          onOpenDetails={() => setDetailName(row.name)}
        />
      )
      : col.key === 'serviceBucket'
      ? (row) => (
        <ServiceBucketCell
          value={row.serviceBucket}
          options={serviceBucketNames}
          onCommit={(v) => saveServiceBucket(row.name, v)}
        />
      )
      : col.key === 'timelineDriven'
        ? (row) => (
          <ServiceYesNoCell
            value={row.timelineDriven}
            onCommit={(v) => saveServiceField(row.name, 'timelineDriven', v)}
          />
        )
        : col.key === 'rolloutTime'
          ? (row) => (
            <ServiceWeeksCell
              value={row.rolloutTime}
              onCommit={(v) => saveServiceField(row.name, 'rolloutTime', v)}
            />
          )
          : col.key === 'dependsOn'
            ? (row) => (
              <ServiceDependsCell
                value={row.dependsOn}
                options={solutionNames}
                selfName={row.name}
                onCommit={(v) => saveServiceField(row.name, 'dependsOn', v)}
              />
            )
            : (row) => (
              <ServiceCell
                value={row[col.key]}
                onCommit={(v) => saveServiceField(row.name, col.key, v)}
              />
            ),
    // Weeks sort by size, not as text — otherwise 10 lands between 1 and
    // 2 — and rows with nothing set (or legacy text that isn't a number)
    // tail the list either way rather than clumping at the top.
    ...(col.key === 'rolloutTime'
      ? { getSortValue: (row) => rolloutWeeks(row.rolloutTime) }
      : {}),
  }));

  // Save a list's full options array back to settings. We always
  // store the override even if the user happened to type the
  // built-in vocabulary back in — they may want to "lock" a list to
  // freeze it from future seed changes. Empty list overrides are
  // preserved (the user explicitly emptied it).
  function saveList(key, options, edit) {
    const current = settings?.dropdownLists || {};
    const updates = { dropdownLists: { ...current, [key]: options } };
    // Solutions is served unioned with the services board (see
    // mergeBoardServices), so a name taken off this list has to leave its box
    // as well — otherwise the union files it straight back and the delete
    // reads as broken. A rename is the same story with the old name.
    if (key === 'solutions') {
      let categories = getServiceCategories(settings);
      let moved = false;
      if (edit?.renamedFrom && edit?.renamedTo && edit.renamedFrom !== edit.renamedTo) {
        const renamed = renameServiceInCategories(categories, edit.renamedFrom, edit.renamedTo);
        if (renamed) { categories = renamed; moved = true; }
      }
      const pruned = pruneServicesFromCategories(categories, options);
      if (pruned) { categories = pruned; moved = true; }
      if (moved) updates.customServiceCategories = categories;
      // The rate card is keyed by service name, so a rename has to take the
      // price with it — otherwise renaming a service silently un-prices it.
      if (edit?.renamedFrom && edit?.renamedTo) {
        const repriced = renameServicePricing(getServicePricing(settings), edit.renamedFrom, edit.renamedTo);
        if (repriced) updates.servicePricing = repriced;
      }
    }
    updateSettings?.(updates);
  }

  function renameList(key, newLabel) {
    const current = settings?.dropdownListLabels || {};
    const next = { ...current, [key]: newLabel };
    updateSettings?.({ dropdownListLabels: next });
  }

  function removeList(key, builtin) {
    if (builtin) {
      const current = Array.isArray(settings?.dropdownListsHidden) ? settings.dropdownListsHidden : [];
      if (current.includes(key)) return;
      updateSettings?.({ dropdownListsHidden: [...current, key] });
    } else {
      const current = Array.isArray(settings?.dropdownCustomLists) ? settings.dropdownCustomLists : [];
      const next = current.filter(l => l.key !== key);
      const labels = { ...(settings?.dropdownListLabels || {}) };
      delete labels[key];
      const options = { ...(settings?.dropdownLists || {}) };
      delete options[key];
      updateSettings?.({ dropdownCustomLists: next, dropdownListLabels: labels, dropdownLists: options });
    }
  }

  function addNewList() {
    const label = window.prompt('Name for the new list:');
    const trimmed = (label || '').trim();
    if (!trimmed) return;
    const key = makeCustomListKey(trimmed);
    const current = Array.isArray(settings?.dropdownCustomLists) ? settings.dropdownCustomLists : [];
    updateSettings?.({
      dropdownCustomLists: [...current, { key, label: trimmed, options: [] }],
    });
  }

  // Solutions is shown in a wide card; the other lists in the small
  // grid. Split here so the JSX below stays readable.
  const namedLists = lists.filter(l => l.key !== 'solutions');
  const solutions = lists.find(l => l.key === 'solutions');

  const term = search.trim().toLowerCase();
  // Hide cards whose label and options both fail the search filter.
  // Editing remains available on visible cards.
  const cardMatches = (list) => {
    if (!term) return true;
    if (list.label.toLowerCase().includes(term)) return true;
    return list.options.some(o => String(o).toLowerCase().includes(term));
  };
  const visibleNamed = namedLists.filter(cardMatches);
  const solutionsVisible = solutions && cardMatches(solutions);

  // Every timeline template, normalized once: the Timelines subtab's count
  // badge reads its length, and the Services popup edits the steps of
  // whichever ones are attached to the service it's showing.
  const savedTimelines = settings?.timelineTemplates;
  const timelineTemplates = useMemo(
    () => getTimelineTemplates({ timelineTemplates: savedTimelines }),
    [savedTimelines]
  );
  const timelineCount = timelineTemplates.length;
  // Same write the Timelines tab makes. Normalizing on read means the first
  // save from the popup persists the built-in seeds alongside the edit, which
  // is exactly what "+ New timeline" over there does on its first save too.
  const saveTimelineTemplates = useCallback(
    (next) => updateSettings?.({ timelineTemplates: next }),
    [updateSettings],
  );

  const totalOptions = useMemo(
    () => lists.reduce((a, l) => a + l.options.length, 0),
    [lists]
  );
  const shownOptions = useMemo(
    () => lists.reduce((a, l) => {
      if (!cardMatches(l)) return a;
      if (!term) return a + l.options.length;
      return a + l.options.filter(o => String(o).toLowerCase().includes(term)).length;
    }, 0),
    [lists, term]
  );

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h2 className={styles.title}>Dropdowns</h2>
        <span className={styles.lastSync}>
          Edit the picklist vocabulary the Opps, Deals, and Clients tabs use when a column is linked to a list. Changes save automatically and sync across devices.
        </span>
      </div>

      <div className={styles.subtabs}>
        <button
          type="button"
          className={activeTab === 'lists' ? styles.subtabActive : styles.subtab}
          onClick={() => setActiveTab('lists')}
        >Lists</button>
        <button
          type="button"
          className={activeTab === 'services' ? styles.subtabActive : styles.subtab}
          onClick={() => setActiveTab('services')}
        >Services <span className={styles.subtabCount}>{serviceRows.length}</span></button>
        <button
          type="button"
          className={activeTab === 'pricing' ? styles.subtabActive : styles.subtab}
          onClick={() => setActiveTab('pricing')}
        >Services Pricing <span className={styles.subtabCount}>{pricingServiceRows.length}</span></button>
        <button
          type="button"
          className={activeTab === 'timelines' ? styles.subtabActive : styles.subtab}
          onClick={() => setActiveTab('timelines')}
        >Timelines <span className={styles.subtabCount}>{timelineCount}</span></button>
        <button
          type="button"
          className={activeTab === 'questions' ? styles.subtabActive : styles.subtab}
          onClick={() => setActiveTab('questions')}
        >Questions</button>
      </div>

      {activeTab === 'lists' ? (
        <>
          <div className={styles.searchRow}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search options or list name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button
              type="button"
              onClick={addNewList}
              title="Create a new dropdown list"
              style={{
                padding: '0.4rem 0.8rem',
                background: 'var(--color-accent)', color: '#fff',
                border: 'none', borderRadius: 'var(--radius-md)',
                fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >+ New list</button>
            <span className={styles.resultCount}>
              {term ? `${shownOptions} of ${totalOptions} options` : `${totalOptions} options across ${lists.length} lists`}
            </span>
          </div>

          <div className={styles.scroll}>
            <div className={styles.grid}>
              {visibleNamed.map(list => (
                <ListCard
                  key={list.key}
                  list={list}
                  filter={search}
                  onChange={saveList}
                  onRenameLabel={renameList}
                  onRemoveList={removeList}
                />
              ))}

              {solutionsVisible && (
                <ListCard
                  key={solutions.key}
                  list={solutions}
                  filter={search}
                  wide
                  links={presentationLinks}
                  onSaveLink={savePresentationLink}
                  onChange={saveList}
                  onRenameLabel={renameList}
                  onRemoveList={removeList}
                />
              )}
            </div>

            {!term && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Stage age guidance</h3>
                <table className={styles.guidanceTable}>
                  <thead>
                    <tr>
                      <th>Stage</th>
                      <th>Max Target Age</th>
                      <th>Next Move</th>
                    </tr>
                  </thead>
                  <tbody>
                    {STAGE_AGE_GUIDANCE.map(row => (
                      <tr key={row.stage}>
                        <td>{row.stage}</td>
                        <td>{row.maxAge}</td>
                        <td>{row.nextMove}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : activeTab === 'services' ? (
        <>
          <div className={styles.searchRow}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search services, BFO tags, regions, product lines…"
              value={serviceSearch}
              onChange={e => setServiceSearch(e.target.value)}
            />
            <span className={styles.resultCount}>
              {serviceSearch.trim()
                ? `${filteredServiceRows.length} of ${serviceRows.length} services`
                : `${serviceRows.length - (showHiddenServices ? 0 : hiddenCount)} services`}
              {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
            </span>
            {/* Hidden services are only reachable through this toggle, so it
                stays put whenever there are any — otherwise restoring one
                would mean knowing it existed. */}
            {hiddenCount > 0 && (
              <button
                type="button"
                className={styles.showHiddenBtn}
                onClick={() => setShowHiddenServices(v => !v)}
                title={showHiddenServices
                  ? 'Go back to hiding them'
                  : 'List the hidden services so they can be restored'}
              >{showHiddenServices ? 'Hide them again' : `Show ${hiddenCount} hidden`}</button>
            )}
            <button
              type="button"
              className={styles.addServiceBtn}
              onClick={() => (addingService ? closeAddService() : setAddingService(true))}
              title="Add a service to the Solutions list"
            >{addingService ? 'Done adding' : '+ Add service'}</button>
          </div>

          {/* Why rows nobody added here are in the table. Only shown while
              the board is actually contributing some — once the list carries
              them all, the rule holds silently. */}
          {boardOnlyCount > 0 && (
            <div className={styles.servicesBoardNote}>
              This list and the services board are one vocabulary: {boardOnlyCount} of these
              {' '}{boardOnlyCount === 1 ? 'is' : 'are'} filed in a box on the board and were never
              on the Solutions list. Filing a service into a box adds it here; deleting it here
              takes it off the board.
            </div>
          )}

          {/* The name is all this asks for — a service with no name can't be
              identified, and the rest of the row is filled in from the popup
              that opens on it. Stays open after each add, and behind the
              popup, so a batch of new services is one visit. */}
          {addingService && (
            <div className={styles.addServiceRow}>
              <input
                ref={newServiceRef}
                type="text"
                className={styles.addServiceInput}
                placeholder="New service name"
                value={newServiceName}
                onChange={e => { setNewServiceName(e.target.value); setAddServiceNote(''); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); commitNewService(); }
                  else if (e.key === 'Escape') { e.preventDefault(); closeAddService(); }
                }}
              />
              <button
                type="button"
                className={styles.addServiceSave}
                onClick={commitNewService}
                disabled={!newServiceName.trim()}
              >Add</button>
              <button
                type="button"
                className={styles.showHiddenBtn}
                onClick={closeAddService}
              >Cancel</button>
              {addServiceNote && <span className={styles.addServiceNote}>{addServiceNote}</span>}
            </div>
          )}

          {/* The shared table: drag a header edge to resize, use its Columns
              menu to hide what you don't need. Both persist per user under
              settings.tablePrefs[SERVICES_TABLE_ID], the same way Opps 2
              remembers its layout. */}
          <div className={styles.serviceTableWrap}>
            <DataTable
              tableId={SERVICES_TABLE_ID}
              columns={serviceColumns}
              rows={serviceTableRows}
              alwaysVisible={['name', 'hide']}
              // Anything in a cell that responds to a click swallows it
              // first (see swallowClick), so this fires for the row itself
              // — the padding around the cells, and any cell whose editor
              // isn't where the user clicked.
              onRowClick={(row) => setDetailName(row.name)}
              rowClassName={(row) => ((row._muted || row._hidden) ? styles.serviceRowMuted : undefined)}
              exportFileName="Services"
              settings={settings}
              updateSettings={updateSettings}
              emptyMessage={serviceRows.length === 0
                ? 'The Solutions dropdown list is empty. Use "+ Add service" above to start it off.'
                : `No services match "${serviceSearch}".`}
            />
          </div>

          {detailService && (
            <ServiceDetailModal
              service={detailService}
              url={serviceLinks[detailService.name] || ''}
              hidden={hiddenServices.has(detailService.name)}
              dependents={dependentsByService.get(detailService.name.trim().toLowerCase()) || []}
              options={solutionNames}
              templates={timelineTemplates}
              bucket={detailService.bucket}
              bucketOptions={serviceBucketNames}
              onSaveBucket={saveServiceBucket}
              onSaveField={saveServiceField}
              onSaveUrl={saveServiceLink}
              onToggleHide={toggleHideService}
              onSaveTemplates={saveTimelineTemplates}
              // The popup edits the four things a step needs; dates, format
              // and marker artwork live on the full stage table. Hand the
              // user over rather than growing a second copy of it in here.
              onOpenTimelines={() => { setDetailName(null); setActiveTab('timelines'); }}
              onClose={() => setDetailName(null)}
            />
          )}
        </>
      ) : activeTab === 'pricing' ? (
        <ServicesPricingTab
          settings={settings}
          updateSettings={updateSettings}
          serviceRows={pricingServiceRows}
          scenario={pricingScenario}
          setScenario={setPricingScenario}
        />
      ) : activeTab === 'timelines' ? (
        <TimelinesTab settings={settings} updateSettings={updateSettings} serviceOptions={serviceRows.map(r => r.name)} />
      ) : (
        <QuestionsTab settings={settings} updateSettings={updateSettings} serviceOptions={serviceRows.map(r => r.name)} />
      )}
    </div>
  );
}
