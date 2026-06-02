import { useState, useMemo, useRef, useEffect } from 'react';
import { STAGE_AGE_GUIDANCE } from '../../data/dropdownLists';
import { getEffectiveServiceMetadata } from '../../data/serviceCatalog';
import {
  getEffectiveDropdownLists,
  makeCustomListKey,
} from '../../utils/dropdownListsStore';
import { QuestionsTab } from './QuestionsTab';
import styles from './DropdownsView.module.css';

const SERVICE_TABLE_COLUMNS = [
  { key: 'name',             label: 'Solutions',         width: 'auto', editable: false },
  { key: 'bfoTag',           label: 'BFO Tag',           width: 110,    editable: true  },
  { key: 'region',           label: 'Region',            width: 90,     editable: true  },
  { key: 'years',            label: 'Years',             width: 90,     editable: true  },
  { key: 'productLine',      label: 'Product Line',      width: 260,    editable: true  },
  { key: 'serviceType',      label: 'Service Type',      width: 110,    editable: true  },
  { key: 'localProjectName', label: 'Local Project Name', width: 200,   editable: true  },
];

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
        onClick={startEdit}
        title="Click to edit"
        style={{ display: 'inline-block', width: '100%', cursor: 'text', minHeight: '1em' }}
      >
        {value
          ? value
          : <span className={styles.serviceMutedCell}>—</span>}
      </span>
    );
  }
  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
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

// Single row in the Services subtab. The Solutions cell renders as a
// hyperlink when the user has saved a URL for that service; clicking
// the pencil opens a tiny inline editor so per-service URLs can be
// added, updated, or cleared.
function ServiceRow({ name, meta, url, onSaveUrl, onSaveField }) {
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
  function cancel() {
    setEditing(false);
  }

  const muted = meta?.graveyard;
  return (
    <tr className={muted ? styles.serviceRowMuted : undefined}>
      <td className={styles.serviceNameCell}>
        {editing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              ref={inputRef}
              type="url"
              value={draft}
              placeholder="https://example.com"
              onChange={e => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
              }}
              style={{ flex: 1, minWidth: 0, padding: '3px 6px', border: '1px solid var(--color-accent)', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit' }}
            />
            <span style={{ fontSize: '0.62rem', color: 'var(--color-text-muted)' }}>{name}</span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className={styles.serviceLink}
                title={url}
              >{name}</a>
            ) : (
              <span style={{ color: 'var(--color-text)' }}>{name}</span>
            )}
            <button
              type="button"
              className={styles.serviceLinkEditBtn}
              onClick={startEdit}
              title={url ? 'Edit link' : 'Add link'}
              aria-label={url ? 'Edit link' : 'Add link'}
            >{url ? '✎' : '+ link'}</button>
            {url && (
              <button
                type="button"
                className={styles.serviceLinkEditBtn}
                onClick={() => onSaveUrl(name, '')}
                title="Remove link"
                aria-label="Remove link"
              >×</button>
            )}
          </div>
        )}
      </td>
      <td><ServiceCell value={meta?.bfoTag || ''}           onCommit={(v) => onSaveField(name, 'bfoTag', v)} /></td>
      <td><ServiceCell value={meta?.region || ''}           onCommit={(v) => onSaveField(name, 'region', v)} /></td>
      <td><ServiceCell value={meta?.years || ''}            onCommit={(v) => onSaveField(name, 'years', v)} /></td>
      <td><ServiceCell value={meta?.productLine || ''}      onCommit={(v) => onSaveField(name, 'productLine', v)} /></td>
      <td><ServiceCell value={meta?.serviceType || ''}      onCommit={(v) => onSaveField(name, 'serviceType', v)} /></td>
      <td><ServiceCell value={meta?.localProjectName || ''} onCommit={(v) => onSaveField(name, 'localProjectName', v)} /></td>
    </tr>
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
function OptionRow({ value, onCommit, onRemove }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === value) return; // no-op
    if (trimmed === '') { onRemove(); return; }
    onCommit(trimmed);
  }
  function cancel() {
    setDraft(value);
  }

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
function ListCard({ list, filter, wide, onChange, onRenameLabel, onRemoveList }) {
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState('');
  const addInputRef = useRef(null);

  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  function commitOption(idx, next) {
    const out = [...list.options];
    out[idx] = next;
    onChange(list.key, out);
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
        {visible.length === 0 ? (
          <div className={styles.optionEmpty}>
            {list.options.length === 0 ? '— no options —' : '— no matches —'}
          </div>
        ) : (
          visible.map(({ opt, idx }) => (
            <OptionRow
              key={`${idx}-${opt}`}
              value={opt}
              onCommit={(next) => commitOption(idx, next)}
              onRemove={() => removeOption(idx)}
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
  const [serviceSearch, setServiceSearch] = useState('');
  const lists = useMemo(() => getEffectiveDropdownLists(settings), [
    settings?.dropdownLists,
    settings?.dropdownListLabels,
    settings?.dropdownListsHidden,
    settings?.dropdownCustomLists,
  ]);

  // Per-service URLs the user can paste in for hyperlinking. Stored
  // alongside the other dropdown settings so they sync across devices.
  const serviceLinks = (settings?.serviceLinks && typeof settings.serviceLinks === 'object') ? settings.serviceLinks : {};
  function saveServiceLink(name, url) {
    const next = { ...serviceLinks };
    const trimmed = (url || '').trim();
    if (trimmed) next[name] = trimmed;
    else delete next[name];
    updateSettings?.({ serviceLinks: next });
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
  const serviceRows = useMemo(() => {
    const options = solutionsList?.options || [];
    return options.map(name => ({ name, meta: getEffectiveServiceMetadata(name, serviceOverrides) }));
  }, [solutionsList, serviceOverrides]);
  const filteredServiceRows = useMemo(() => {
    const term = serviceSearch.trim().toLowerCase();
    if (!term) return serviceRows;
    return serviceRows.filter(({ name, meta }) => {
      if (name.toLowerCase().includes(term)) return true;
      if (!meta) return false;
      return [meta.bfoTag, meta.region, meta.years, meta.productLine, meta.serviceType, meta.localProjectName]
        .some(v => String(v || '').toLowerCase().includes(term));
    });
  }, [serviceRows, serviceSearch]);

  // Save a list's full options array back to settings. We always
  // store the override even if the user happened to type the
  // built-in vocabulary back in — they may want to "lock" a list to
  // freeze it from future seed changes. Empty list overrides are
  // preserved (the user explicitly emptied it).
  function saveList(key, options) {
    const current = settings?.dropdownLists || {};
    const next = { ...current, [key]: options };
    updateSettings?.({ dropdownLists: next });
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
          Edit the picklist vocabulary the Opps 2, Deals, and Clients tabs use when a column is linked to a list. Changes save automatically and sync across devices.
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
                : `${serviceRows.length} services`}
            </span>
          </div>

          <div className={styles.scroll}>
            <div className={styles.section}>
              <table className={styles.serviceTable}>
                <colgroup>
                  {SERVICE_TABLE_COLUMNS.map(c => (
                    <col key={c.key} style={c.width === 'auto' ? undefined : { width: c.width }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {SERVICE_TABLE_COLUMNS.map(c => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredServiceRows.length === 0 ? (
                    <tr>
                      <td colSpan={SERVICE_TABLE_COLUMNS.length} className={styles.serviceEmpty}>
                        {serviceRows.length === 0
                          ? 'The Solutions dropdown list is empty. Add services on the Lists tab.'
                          : `No services match "${serviceSearch}".`}
                      </td>
                    </tr>
                  ) : (
                    filteredServiceRows.map(({ name, meta }) => (
                      <ServiceRow
                        key={name}
                        name={name}
                        meta={meta}
                        url={serviceLinks[name] || ''}
                        onSaveUrl={saveServiceLink}
                        onSaveField={saveServiceField}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <QuestionsTab settings={settings} updateSettings={updateSettings} serviceOptions={serviceRows.map(r => r.name)} />
      )}
    </div>
  );
}
