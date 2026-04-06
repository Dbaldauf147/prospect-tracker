import { useState, useRef, useEffect } from 'react';
import { FILTER_COLUMNS } from '../../hooks/useFilters';
import styles from './FilterBar.module.css';

const SAVED_FILTERS_KEY = 'prospect-saved-filters';

function loadSavedFilters() {
  try { return JSON.parse(localStorage.getItem(SAVED_FILTERS_KEY)) || []; } catch { return []; }
}

function saveSavedFilters(list) {
  localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(list));
}

function FilterDropdown({ label, options, selected, onToggle }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const count = selected.length;
  const filtered = search.trim()
    ? options.filter(o => o.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <div className={styles.filterGroup} ref={ref}>
      <button
        className={count > 0 ? styles.filterBtnActive : styles.filterBtn}
        onClick={() => { setOpen(p => !p); setSearch(''); }}
      >
        {label}
        {count > 0 && <span className={styles.filterCount}>{count}</span>}
        <span style={{ fontSize: '0.6rem' }}>{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div className={styles.dropdown}>
          {options.length > 8 && (
            <input
              className={styles.dropdownSearch}
              type="text"
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          )}
          {filtered.length === 0 && (
            <div className={styles.dropdownEmpty}>No matches</div>
          )}
          {filtered.map(opt => (
            <label key={opt} className={styles.dropdownItem}>
              <input
                className={styles.dropdownCheck}
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => onToggle(opt)}
              />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function SavedFiltersMenu({ filters, searchTerm, onLoad }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(loadSavedFilters);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleSave() {
    const label = name.trim();
    if (!label) return;
    const entry = { id: Date.now(), label, filters: { ...filters }, searchTerm };
    const next = [entry, ...saved];
    setSaved(next);
    saveSavedFilters(next);
    setName('');
    setNaming(false);
  }

  function handleDelete(id) {
    const next = saved.filter(s => s.id !== id);
    setSaved(next);
    saveSavedFilters(next);
  }

  function handleLoad(entry) {
    onLoad(entry.filters, entry.searchTerm || '');
    setOpen(false);
  }

  // Count active filters to decide if save is meaningful
  const hasFilters = Object.values(filters).some(arr => arr.length > 0) || searchTerm.trim();

  return (
    <div className={styles.filterGroup} ref={ref}>
      <button
        className={styles.savedFiltersBtn}
        onClick={() => { setOpen(p => !p); setNaming(false); }}
      >
        Saved Filters
        {saved.length > 0 && <span className={styles.filterCount}>{saved.length}</span>}
      </button>
      {open && (
        <div className={styles.savedDropdown}>
          {hasFilters && !naming && (
            <button className={styles.saveCurrentBtn} onClick={() => setNaming(true)}>
              Save current filters
            </button>
          )}
          {naming && (
            <div className={styles.saveNameRow}>
              <input
                className={styles.saveNameInput}
                type="text"
                placeholder="Filter name..."
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setNaming(false); }}
                autoFocus
              />
              <button className={styles.saveNameBtn} onClick={handleSave}>Save</button>
            </div>
          )}
          {saved.length === 0 && !naming && (
            <div className={styles.savedEmpty}>No saved filters yet</div>
          )}
          {saved.map(entry => (
            <div key={entry.id} className={styles.savedItem}>
              <button className={styles.savedItemName} onClick={() => handleLoad(entry)}>
                {entry.label}
              </button>
              <span className={styles.savedItemMeta}>
                {Object.values(entry.filters).reduce((s, a) => s + a.length, 0)} filters
              </span>
              <button className={styles.savedItemDelete} onClick={() => handleDelete(entry.id)}>&times;</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FilterBar({
  searchTerm, setSearchTerm,
  filters, filterOptions, toggleFilter, clearFilters, activeFilterCount,
  onLoadSavedFilter,
  view, setView,
  onAddNew,
  resultCount, totalCount,
}) {
  return (
    <div className={styles.bar}>
      <div className={styles.searchWrap}>
        <span className={styles.searchIcon}>&#128269;</span>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search prospects..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      {FILTER_COLUMNS.map(col => (
        <FilterDropdown
          key={col.key}
          label={col.label}
          options={filterOptions[col.key] || []}
          selected={filters[col.key] || []}
          onToggle={v => toggleFilter(col.key, v)}
        />
      ))}

      <SavedFiltersMenu filters={filters} searchTerm={searchTerm} onLoad={onLoadSavedFilter} />

      {activeFilterCount > 0 && (
        <button className={styles.clearBtn} onClick={clearFilters}>Clear all</button>
      )}

      <span className={styles.resultCount}>{resultCount} of {totalCount}</span>

      <div className={styles.actions}>
        <div className={styles.viewToggle}>
          <button className={view === 'table' ? styles.viewBtnActive : styles.viewBtn} onClick={() => setView('table')}>Table</button>
          <button className={view === 'kanban' ? styles.viewBtnActive : styles.viewBtn} onClick={() => setView('kanban')}>Pipeline</button>
        </div>
        <button className={styles.addBtn} onClick={onAddNew}>+ Add</button>
      </div>
    </div>
  );
}
