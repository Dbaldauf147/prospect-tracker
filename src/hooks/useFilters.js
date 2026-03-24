import { useState, useMemo } from 'react';

export function useFilters(prospects) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    status: [],
    type: [],
    tier: [],
    geography: [],
    publicPrivate: [],
    frameworks: [],
  });
  const [sortConfig, setSortConfig] = useState({ key: 'company', direction: 'asc' });

  const filtered = useMemo(() => {
    let result = [...prospects];

    // Text search
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(p => {
        const text = [
          p.company, p.cdm, p.status, p.type, p.geography, p.publicPrivate,
          p.tier, p.hqRegion, p.notes, p.website,
          ...(p.assetTypes || []),
          ...(p.frameworks || []),
        ].filter(Boolean).join(' ').toLowerCase();
        return text.includes(term);
      });
    }

    // Apply filters (AND between categories, OR within)
    for (const [key, values] of Object.entries(filters)) {
      if (values.length === 0) continue;
      if (key === 'frameworks') {
        result = result.filter(p =>
          values.some(v => (p.frameworks || []).includes(v))
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

        // Handle nulls
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;

        // Numbers
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }

        // Strings
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
    setFilters({ status: [], type: [], tier: [], geography: [], publicPrivate: [], frameworks: [] });
    setSearchTerm('');
  }

  const activeFilterCount = Object.values(filters).reduce((sum, arr) => sum + arr.length, 0);

  return {
    filtered,
    searchTerm, setSearchTerm,
    filters, toggleFilter, clearFilters, activeFilterCount,
    sortConfig, toggleSort,
  };
}
