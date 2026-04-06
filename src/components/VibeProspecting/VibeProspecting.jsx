import { useState, useCallback } from 'react';
import styles from './VibeProspecting.module.css';

const INDUSTRY_OPTIONS = [
  'Asset Management', 'Real Estate', 'Private Equity',
  'Facility Management', 'Developer', 'Owner Operator', 'Other',
];

const DEPARTMENT_OPTIONS = [
  'c-suite', 'operations', 'engineering', 'sales',
  'marketing', 'finance', 'real estate', 'procurement', 'strategy',
];

const LEVEL_OPTIONS = [
  'c-suite', 'vice president', 'director', 'senior manager', 'manager',
];

const SIZE_OPTIONS = [
  '1-10', '11-50', '51-200', '201-500', '501-1000',
  '1001-5000', '5001-10000', '10001+',
];

const REVENUE_OPTIONS = [
  '1M-5M', '5M-10M', '10M-25M', '25M-75M', '75M-200M',
  '200M-500M', '500M-1B', '1B-10B', '10B+',
];

const HISTORY_KEY = 'vibe-prospecting-history';
const MAX_HISTORY = 10;

function getInitialFilters() {
  return {
    companyName: '',
    accountList: '',
    cdm: 'Dan Baldauf',
    industry: '',
    titleKeywords: '',
    titleExclude: '',
    departments: [],
    levels: [],
    companySizes: [],
    companyRevenues: [],
    country: 'US',
    hasEmail: true,
    limit: 50,
  };
}

function filtersToLabel(f) {
  const parts = [];
  if (f.companyName) parts.push(f.companyName);
  if (f.industry) parts.push(f.industry);
  if (f.titleKeywords) parts.push(`Include: "${f.titleKeywords.split('\n')[0]}${f.titleKeywords.split('\n').length > 1 ? '...' : ''}"`);
  if (f.titleExclude) parts.push(`Exclude: "${f.titleExclude.split('\n')[0]}..."`);
  if (f.departments.length) parts.push(`Dept: ${f.departments.join(', ')}`);
  if (f.levels.length) parts.push(`Level: ${f.levels.join(', ')}`);
  return parts.length ? parts.join(' | ') : 'All filters';
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch { return []; }
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

function toggleArrayValue(arr, val) {
  return arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val];
}

const ACCOUNT_LIST_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'tier1', label: 'Tier 1 Accounts' },
  { value: 'tier2', label: 'Tier 2 Accounts' },
  { value: 'all', label: 'All My Accounts' },
  { value: 'client', label: 'Clients' },
  { value: 'pipeline', label: 'In Pipeline' },
];

export function VibeProspecting({ prospects = [] }) {
  const [filters, setFilters] = useState(getInitialFilters);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [history, setHistory] = useState(loadHistory);
  const [formOpen, setFormOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);

  const updateFilter = useCallback((key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const toggleMulti = useCallback((key, value) => {
    setFilters(prev => ({ ...prev, [key]: toggleArrayValue(prev[key], value) }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(getInitialFilters());
  }, []);

  // Search
  async function handleSearch() {
    setError('');
    setSuccess('');
    setLoading(true);
    setSelected(new Set());
    try {
      const res = await fetch('/api/vibe-prospect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Search failed (${res.status})`);
      }
      const data = await res.json();
      const prospects = data.prospects || data.results || data || [];
      setResults(Array.isArray(prospects) ? prospects : []);

      // Save to history
      const entry = { filters: { ...filters }, date: new Date().toISOString(), resultCount: prospects.length };
      const updated = [entry, ...history.filter(h => JSON.stringify(h.filters) !== JSON.stringify(filters))].slice(0, MAX_HISTORY);
      setHistory(updated);
      saveHistory(updated);
    } catch (err) {
      setError(err.message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  // Push to HubSpot
  async function handlePushToHubSpot() {
    if (selected.size === 0) {
      setError('Select at least one prospect to push to HubSpot.');
      return;
    }
    setError('');
    setSuccess('');
    setPushing(true);
    try {
      const contacts = results.filter((_, i) => selected.has(i)).map(r => ({
        firstName: r.first_name || r.firstName || '',
        lastName: r.last_name || r.lastName || '',
        email: r.email || '',
        phone: r.phone_number || r.phone || '',
        title: r.title || r.job_title || '',
        company: r.company || r.organization_name || r.company_name || '',
        linkedinUrl: r.linkedin_url || r.linkedinUrl || '',
        city: r.city || '',
        state: r.state || '',
        country: r.country || '',
      }));
      const res = await fetch('/api/hubspot?action=push-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Push failed (${res.status})`);
      }
      const data = await res.json();
      setSuccess(`Successfully pushed ${data.created || contacts.length} contact(s) to HubSpot.`);
      setSelected(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setPushing(false);
    }
  }

  // Selection
  function toggleSelect(index) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(results.map((_, i) => i)));
  }

  function deselectAll() {
    setSelected(new Set());
  }

  // Load from history
  function loadFromHistory(entry) {
    setFilters({ ...getInitialFilters(), ...entry.filters });
    setFormOpen(true);
  }

  function removeHistory(index) {
    const updated = history.filter((_, i) => i !== index);
    setHistory(updated);
    saveHistory(updated);
  }

  // Render helpers
  function renderCheckboxGroup(options, filterKey) {
    return (
      <div className={styles.checkboxGroup}>
        {options.map(opt => {
          const checked = filters[filterKey].includes(opt);
          return (
            <label key={opt} className={checked ? styles.checkboxLabelChecked : styles.checkboxLabel}>
              <input
                type="checkbox"
                className={styles.checkboxHidden}
                checked={checked}
                onChange={() => toggleMulti(filterKey, opt)}
              />
              {opt}
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Vibe Prospecting</h1>
        {results.length > 0 && (
          <span className={styles.resultCount}>{results.length} result{results.length !== 1 ? 's' : ''} found</span>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {success && <div className={styles.success}>{success}</div>}

      {/* Search Criteria Form */}
      <div className={styles.formSection}>
        <button className={styles.formSectionToggle} onClick={() => setFormOpen(v => !v)}>
          <span className={formOpen ? styles.chevronOpen : styles.chevron}>&#9654;</span>
          Search Criteria
        </button>
        {formOpen && (
          <>
            <div className={styles.formGrid} style={{ marginTop: '0.75rem' }}>
              {(() => {
                // Compute CDM options and filtered prospects
                const cdmSet = new Set();
                prospects.forEach(p => { if (p.cdm) cdmSet.add(p.cdm); });
                const cdmOptions = [...cdmSet].sort();
                const cdmFiltered = filters.cdm
                  ? prospects.filter(p => p.cdm === filters.cdm)
                  : prospects;

                function applyListFilter(list, listValue) {
                  if (listValue === 'tier1') return list.filter(p => p.tier === 'Tier 1');
                  if (listValue === 'tier2') return list.filter(p => p.tier === 'Tier 2');
                  if (listValue === 'client') return list.filter(p => p.status === 'Client');
                  if (listValue === 'pipeline') return list.filter(p => p.status === 'Qualifying' || p.status === 'Inside Sales');
                  return list;
                }

                function refreshCompanyNames(listValue, cdmValue) {
                  let base = cdmValue ? prospects.filter(p => p.cdm === cdmValue) : prospects;
                  if (listValue) {
                    base = applyListFilter(base, listValue);
                    const names = base.map(p => p.company).filter(Boolean).join(', ');
                    updateFilter('companyName', names);
                  } else {
                    updateFilter('companyName', '');
                  }
                }

                return (
                  <>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>CDM</label>
                      <select
                        className={styles.select}
                        value={filters.cdm}
                        onChange={e => {
                          const val = e.target.value;
                          updateFilter('cdm', val);
                          refreshCompanyNames(filters.accountList, val);
                        }}
                      >
                        <option value="">All CDMs</option>
                        {cdmOptions.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>

                    <div className={styles.formGroupFull}>
                      <label className={styles.label}>Target Account List</label>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        {ACCOUNT_LIST_OPTIONS.map(opt => {
                          const isActive = filters.accountList === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => {
                                updateFilter('accountList', opt.value);
                                refreshCompanyNames(opt.value, filters.cdm);
                              }}
                              style={{
                                padding: '0.3rem 0.7rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600,
                                cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                                border: isActive ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                                background: isActive ? 'var(--color-accent)' : 'var(--color-surface)',
                                color: isActive ? '#fff' : 'var(--color-text-secondary)',
                              }}
                            >
                              {opt.label}
                              {opt.value && (() => {
                                const count = applyListFilter(cdmFiltered, opt.value).length;
                                return <span style={{ marginLeft: '0.3rem', opacity: 0.7 }}>({count})</span>;
                              })()}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                );
              })()}

              <div className={styles.formGroup}>
                <label className={styles.label}>Company Name</label>
                <input
                  className={styles.input}
                  type="text"
                  placeholder="e.g. CBRE, JLL..."
                  value={filters.companyName}
                  onChange={e => updateFilter('companyName', e.target.value)}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Industry</label>
                <select
                  className={styles.select}
                  value={filters.industry}
                  onChange={e => updateFilter('industry', e.target.value)}
                >
                  <option value="">All Industries</option>
                  {INDUSTRY_OPTIONS.map(ind => (
                    <option key={ind} value={ind}>{ind}</option>
                  ))}
                </select>
              </div>

              <div style={{ gridColumn: '2 / 4', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Titles to Include</label>
                  <textarea
                    className={styles.input}
                    placeholder={'One per line, e.g.:\nVP Sustainability\nDirector ESG\nHead of Energy'}
                    value={filters.titleKeywords}
                    onChange={e => updateFilter('titleKeywords', e.target.value)}
                    rows={4}
                    style={{ resize: 'vertical', minHeight: '60px', lineHeight: '1.5' }}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label}>Titles to Exclude</label>
                  <textarea
                    className={styles.input}
                    placeholder={'One per line, e.g.:\nIntern\nAssistant\nJunior'}
                    value={filters.titleExclude}
                    onChange={e => updateFilter('titleExclude', e.target.value)}
                    rows={4}
                    style={{ resize: 'vertical', minHeight: '60px', lineHeight: '1.5' }}
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Country</label>
                <input
                  className={styles.input}
                  type="text"
                  value={filters.country}
                  onChange={e => updateFilter('country', e.target.value)}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Has Email</label>
                <label className={styles.singleCheckbox}>
                  <input
                    type="checkbox"
                    checked={filters.hasEmail}
                    onChange={e => updateFilter('hasEmail', e.target.checked)}
                  />
                  Only show prospects with email
                </label>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Number of Results</label>
                <input
                  className={styles.numberInput}
                  type="number"
                  min={1}
                  max={1000}
                  value={filters.limit}
                  onChange={e => updateFilter('limit', Math.min(1000, Math.max(1, Number(e.target.value) || 1)))}
                />
              </div>
            </div>

            <div className={styles.actions}>
              <button
                className={styles.searchBtn}
                onClick={handleSearch}
                disabled={loading}
              >
                {loading ? 'Searching...' : 'Search Prospects'}
              </button>
              <button className={styles.clearBtn} onClick={clearFilters}>
                Clear Filters
              </button>
              {results.length > 0 && (
                <button
                  className={styles.pushBtn}
                  onClick={handlePushToHubSpot}
                  disabled={pushing || selected.size === 0}
                >
                  {pushing ? 'Pushing...' : `Push ${selected.size} to HubSpot`}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Results */}
      {loading && <div className={styles.loading}>Searching for prospects...</div>}

      {!loading && results.length > 0 && (
        <>
          <div className={styles.selectToolbar}>
            <span className={styles.selectedCount}>{selected.size} of {results.length} selected</span>
            <button className={styles.selectAllBtn} onClick={selectAll}>Select All</button>
            <button className={styles.selectAllBtn} onClick={deselectAll}>Deselect All</button>
            {selected.size > 0 && (
              <button
                className={styles.pushBtn}
                onClick={handlePushToHubSpot}
                disabled={pushing}
                style={{ padding: '0.3rem 0.8rem', fontSize: 'var(--font-size-xs)' }}
              >
                {pushing ? 'Pushing...' : `Push ${selected.size} to HubSpot`}
              </button>
            )}
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={selected.size === results.length && results.length > 0}
                      onChange={() => selected.size === results.length ? deselectAll() : selectAll()}
                    />
                  </th>
                  <th>Name</th>
                  <th>Title</th>
                  <th>Company</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Location</th>
                  <th>LinkedIn</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const name = [r.first_name || r.firstName, r.last_name || r.lastName].filter(Boolean).join(' ') || r.name || '-';
                  const title = r.title || r.job_title || '-';
                  const company = r.company || r.organization_name || r.company_name || '-';
                  const email = r.email || '-';
                  const phone = r.phone_number || r.phone || '-';
                  const location = [r.city, r.state, r.country].filter(Boolean).join(', ') || '-';
                  const linkedin = r.linkedin_url || r.linkedinUrl || '';

                  return (
                    <tr key={i}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(i)}
                          onChange={() => toggleSelect(i)}
                        />
                      </td>
                      <td className={styles.contactName}>{name}</td>
                      <td>{title}</td>
                      <td>{company}</td>
                      <td className={styles.contactEmail}>{email}</td>
                      <td className={styles.metaText}>{phone}</td>
                      <td className={styles.metaText}>{location}</td>
                      <td>
                        {linkedin ? (
                          <a href={linkedin} target="_blank" rel="noopener noreferrer" className={styles.linkedinLink}>
                            Profile
                          </a>
                        ) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && results.length === 0 && !error && (
        <div className={styles.empty}>
          Configure your search criteria above and click "Search Prospects" to find leads.
        </div>
      )}

      {/* Search History */}
      {history.length > 0 && (
        <div className={styles.formSection + ' ' + styles.historySection}>
          <button className={styles.formSectionToggle} onClick={() => setHistoryOpen(v => !v)}>
            <span className={historyOpen ? styles.chevronOpen : styles.chevron}>&#9654;</span>
            Recent Searches ({history.length})
          </button>
          {historyOpen && (
            <div className={styles.historyList} style={{ marginTop: '0.75rem' }}>
              {history.map((entry, i) => (
                <div key={i} className={styles.historyItem} onClick={() => loadFromHistory(entry)}>
                  <div className={styles.historyMeta}>
                    <span className={styles.historyLabel}>{filtersToLabel(entry.filters)}</span>
                    <span className={styles.historyDate}>
                      {new Date(entry.date).toLocaleString()} &middot; {entry.resultCount} results
                    </span>
                  </div>
                  <button
                    className={styles.historyRemove}
                    onClick={e => { e.stopPropagation(); removeHistory(i); }}
                    title="Remove"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
