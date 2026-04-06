import { useState, useMemo } from 'react';

// Array fields where filter checks membership (OR within the array)
const ARRAY_FIELDS = new Set(['frameworks', 'assetTypes']);

// All filterable columns with labels
export const FILTER_COLUMNS = [
  { key: 'status', label: 'Status' },
  { key: 'type', label: 'Type' },
  { key: 'tier', label: 'Tier' },
  { key: 'geography', label: 'Geography' },
  { key: 'publicPrivate', label: 'Public/Private' },
  { key: 'cdm', label: 'CDM' },
  { key: 'hqRegion', label: 'HQ Region' },
  { key: 'frameworks', label: 'Frameworks' },
  { key: 'assetTypes', label: 'Asset Types' },
];

export function useFilters(prospects) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState(() => {
    const init = {};
    for (const col of FILTER_COLUMNS) init[col.key] = [];
    return init;
  });
  const [sortConfig, setSortConfig] = useState({ key: 'company', direction: 'asc' });

  // Build unique options for each filterable column from the actual data
  const filterOptions = useMemo(() => {
    const opts = {};
    for (const col of FILTER_COLUMNS) {
      const valSet = new Set();
      for (const p of prospects) {
        const val = p[col.key];
        if (ARRAY_FIELDS.has(col.key)) {
          if (Array.isArray(val)) val.forEach(v => { if (v) valSet.add(v); });
        } else {
          if (val) valSet.add(val);
        }
      }
      opts[col.key] = [...valSet].sort();
    }
    return opts;
  }, [prospects]);

  const filtered = useMemo(() => {
    let result = [...prospects];

    // Text search
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(p => {
        const text = [
          p.company, p.cdm, p.status, p.type, p.geography, p.publicPrivate,
          p.tier, p.hqRegion, p.notes, p.website, p.rank,
          p.bfoCompanyName, p.zoomCompanyName, p.emailDomain,
          p.contactTypes, p.salesperson, p.peOrRe, p.tierList,
          ...(p.assetTypes || []),
          ...(p.frameworks || []),
        ].filter(Boolean).join(' ').toLowerCase();
        return text.includes(term);
      });
    }

    // Apply filters (AND between categories, OR within)
    for (const [key, values] of Object.entries(filters)) {
      if (values.length === 0) continue;
      if (ARRAY_FIELDS.has(key)) {
        result = result.filter(p =>
          values.some(v => (p[key] || []).includes(v))
        );
      } else {
        result = result.filter(p => values.includes(p[key]));
      }
    }

    // Sort
    if (sortConfig.key) {
      result.sort((a, b) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];

        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;

        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }

        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [prospects, searchTerm, filters, sortConfig]);

  function toggleSort(key) {
    setSortConfig(prev => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  }

  function toggleFilter(category, value) {
    setFilters(prev => {
      const current = prev[category] || [];
      const next = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      return { ...prev, [category]: next };
    });
  }

  function clearFilters() {
    const empty = {};
    for (const col of FILTER_COLUMNS) empty[col.key] = [];
    setFilters(empty);
    setSearchTerm('');
  }

  function loadSavedFilter(savedFilters, savedSearchTerm) {
    const merged = {};
    for (const col of FILTER_COLUMNS) merged[col.key] = savedFilters[col.key] || [];
    setFilters(merged);
    setSearchTerm(savedSearchTerm || '');
  }

  const activeFilterCount = Object.values(filters).reduce((sum, arr) => sum + arr.length, 0);

  return {
    filtered,
    searchTerm, setSearchTerm,
    filters, filterOptions, toggleFilter, clearFilters, loadSavedFilter, activeFilterCount,
    sortConfig, toggleSort,
  };
}
