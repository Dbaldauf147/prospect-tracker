import { useState, useRef, useEffect } from 'react';
import { STATUSES, TYPES, TIERS, GEOGRAPHIES, PUBLIC_PRIVATE, FRAMEWORKS } from '../../data/enums';
import styles from './FilterBar.module.css';

function FilterDropdown({ label, options, selected, onToggle }) {
  const [open, setOpen] = useState(false);
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

  return (
    <div className={styles.filterGroup} ref={ref}>
      <button
        className={count > 0 ? styles.filterBtnActive : styles.filterBtn}
        onClick={() => setOpen(p => !p)}
      >
        {label}
        {count > 0 && <span className={styles.filterCount}>{count}</span>}
        <span style={{ fontSize: '0.6rem' }}>{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div className={styles.dropdown}>
          {options.map(opt => (
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

export function FilterBar({
  searchTerm, setSearchTerm,
  filters, toggleFilter, clearFilters, activeFilterCount,
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

      <FilterDropdown label="Status" options={STATUSES} selected={filters.status} onToggle={v => toggleFilter('status', v)} />
      <FilterDropdown label="Type" options={TYPES} selected={filters.type} onToggle={v => toggleFilter('type', v)} />
      <FilterDropdown label="Tier" options={TIERS} selected={filters.tier} onToggle={v => toggleFilter('tier', v)} />
      <FilterDropdown label="Geography" options={GEOGRAPHIES} selected={filters.geography} onToggle={v => toggleFilter('geography', v)} />
      <FilterDropdown label="Frameworks" options={FRAMEWORKS} selected={filters.frameworks} onToggle={v => toggleFilter('frameworks', v)} />

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
