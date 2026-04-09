import { useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
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

const TITLE_PRESETS_KEY = 'vibe-title-presets';
function loadTitlePresets() {
  try { return JSON.parse(localStorage.getItem(TITLE_PRESETS_KEY)) || []; } catch { return []; }
}
function saveTitlePresets(presets) {
  localStorage.setItem(TITLE_PRESETS_KEY, JSON.stringify(presets));
}

function companiesMatch(a, b) {
  const na = (a || '').toLowerCase().trim();
  const nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  const strip = s => s.replace(/\b(inc|llc|ltd|corp|co|lp)\b\.?/gi, '').replace(/[^a-z0-9 ]/g, '').trim();
  const sa = strip(na);
  const sb = strip(nb);
  if (sa === sb) return true;
  const sLonger = sa.length >= sb.length ? sa : sb;
  const sShorter = sa.length >= sb.length ? sb : sa;
  if (sShorter.length >= 4 && sShorter.length >= sLonger.length * 0.6 && sLonger.includes(sShorter)) return true;
  return false;
}

export function VibeProspecting({ prospects = [], onUpdate }) {
  const [filters, setFilters] = useState(getInitialFilters);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [history, setHistory] = useState(loadHistory);
  const [formOpen, setFormOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [titlePresets, setTitlePresets] = useState(loadTitlePresets);
  const [presetName, setPresetName] = useState('');
  const companyFileRef = useRef(null);
  const contactFileRef = useRef(null);
  const [companyUploadResult, setCompanyUploadResult] = useState(null);
  const [contactUploadResult, setContactUploadResult] = useState(null);

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

  // Zoom Company Upload — overwrites Zoom data in prospects
  function handleCompanyUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !onUpdate) return;
    setError('');
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        let rows;
        if (file.name.endsWith('.csv')) {
          const text = new TextDecoder().decode(evt.target.result);
          const parsed = parseCSV(text);
          if (parsed.length < 2) { setError('No data found'); return; }
          const headers = parsed[0].map(h => h.trim());
          rows = [];
          for (let i = 1; i < parsed.length; i++) {
            const obj = {};
            headers.forEach((h, j) => { obj[h] = (parsed[i][j] || '').trim(); });
            rows.push(obj);
          }
        } else {
          const wb = XLSX.read(evt.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json(ws);
        }
        if (rows.length === 0) { setError('No data found'); return; }
        const headers = Object.keys(rows[0]);

        // Find columns flexibly
        const findCol = (keywords) => {
          for (const h of headers) {
            const lower = h.toLowerCase();
            for (const kw of keywords) { if (lower.includes(kw)) return h; }
          }
          return null;
        };
        const accountCol = findCol(["dan's account", 'account name', 'account', 'my account']);
        const zoomNameCol = findCol(['zoom company name', 'zooom company name', 'zoom name']);
        const zoomIdCol = findCol(['zoom company id', 'zoom id', 'company id']);
        const websiteCol = findCol(['website', 'url', 'domain']);

        let matched = 0;
        for (const row of rows) {
          const accountName = accountCol ? (row[accountCol] || '').trim() : '';
          const zoomName = zoomNameCol ? (row[zoomNameCol] || '').trim() : '';
          const zoomId = zoomIdCol ? String(row[zoomIdCol] || '').trim() : '';
          const website = websiteCol ? (row[websiteCol] || '').trim() : '';
          const matchName = accountName || zoomName;
          if (!matchName) continue;

          const prospect = prospects.find(p => companiesMatch(p.company, matchName));
          if (prospect) {
            const updates = {};
            if (zoomName) updates.zoomCompanyName = zoomName;
            if (zoomId) updates.zoomCompanyId = zoomId;
            if (website && !prospect.website) updates.website = website;
            if (Object.keys(updates).length > 0) {
              onUpdate(prospect.id, updates);
              matched++;
            }
          }
        }
        setCompanyUploadResult({ rows, headers, fileName: file.name, matched });
        setSuccess(`Zoom company import complete: ${matched} accounts updated from ${file.name}`);
      } catch (err) { setError('Failed to parse file: ' + err.message); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  // Zoom Contact Upload — maps ZoomInfo CSV to HubSpot contact fields
  function handleContactUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        // Handle both CSV and XLSX
        let rows;
        if (file.name.endsWith('.csv')) {
          const text = new TextDecoder().decode(evt.target.result);
          const parsed = parseCSV(text);
          if (parsed.length < 2) { setError('No data found'); return; }
          const headers = parsed[0].map(h => h.trim());
          rows = [];
          for (let i = 1; i < parsed.length; i++) {
            const obj = {};
            headers.forEach((h, j) => { obj[h] = (parsed[i][j] || '').trim(); });
            rows.push(obj);
          }
        } else {
          const wb = XLSX.read(evt.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json(ws);
        }
        if (rows.length === 0) { setError('No data found'); return; }
        const headers = Object.keys(rows[0]);

        // ZoomInfo → HubSpot field mapping
        const mapped = rows.map(r => ({
          first_name: r['First Name'] || '',
          last_name: r['Last Name'] || '',
          name: [r['First Name'], r['Last Name']].filter(Boolean).join(' '),
          title: r['Job Title'] || '',
          company: r['Company Name'] || '',
          email: r['Email Address'] || '',
          phone: r['Direct Phone Number'] || r['Mobile phone'] || '',
          city: r['Person City'] || '',
          state: r['Person State'] || '',
          country: r['Country'] || '',
          linkedin_url: r['LinkedIn Contact Profile URL'] || '',
          // Extra ZoomInfo fields for reference
          zoomContactId: r['ZoomInfo Contact ID'] || '',
          zoomCompanyId: r['ZoomInfo Company ID'] || '',
          managementLevel: r['Management Level'] || '',
          department: r['Department'] || '',
          website: r['Website'] || '',
        })).filter(r => r.email || r.name);

        setContactUploadResult({ rows: mapped, headers, fileName: file.name });
        setResults(mapped);
        setSelected(new Set());
        setSuccess(`Contact file loaded: ${mapped.length} contacts from ${file.name}`);
      } catch (err) { setError('Failed to parse file: ' + err.message); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  // CSV Import
  const fileInputRef = useRef(null);

  function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return [];
    // Parse header — handle quoted fields
    function parseLine(line) {
      const fields = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ''; continue; }
        current += ch;
      }
      fields.push(current.trim());
      return fields;
    }
    const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9_ ]/g, '').trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const vals = parseLine(lines[i]);
      const obj = {};
      headers.forEach((h, j) => { obj[h] = vals[j] || ''; });
      rows.push(obj);
    }
    return rows;
  }

  function mapZoomInfoRow(row) {
    // ZoomInfo CSV column names → our prospect format
    // Common ZoomInfo columns: First Name, Last Name, Job Title, Company Name, Email Address, Direct Phone Number, City, State/Province, Country, LinkedIn URL, etc.
    const find = (...keys) => {
      for (const k of keys) {
        for (const [col, val] of Object.entries(row)) {
          if (col.includes(k) && val) return val;
        }
      }
      return '';
    };
    return {
      first_name: find('first name', 'first_name', 'firstname'),
      last_name: find('last name', 'last_name', 'lastname'),
      name: [find('first name', 'first_name', 'firstname'), find('last name', 'last_name', 'lastname')].filter(Boolean).join(' ') || find('full name', 'contact name', 'name'),
      title: find('job title', 'title', 'job_title'),
      company: find('company name', 'company', 'organization'),
      email: find('email address', 'email', 'e-mail'),
      phone: find('direct phone', 'phone number', 'phone', 'mobile'),
      city: find('city'),
      state: find('state', 'province', 'region'),
      country: find('country'),
      linkedin_url: find('linkedin', 'linkedin url', 'linkedin contact profile url'),
      company_domain: find('website', 'company url', 'domain'),
    };
  }

  function handleCSVImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setSuccess('');
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const rows = parseCSV(evt.target.result);
        if (rows.length === 0) { setError('No data found in CSV file.'); return; }
        const mapped = rows.map(mapZoomInfoRow).filter(r => r.name || r.first_name || r.last_name);

        // Apply title exclude filters if set
        const titlesExclude = (filters.titleExclude || '').split('\n').map(s => s.trim().toLowerCase()).filter(Boolean);
        let filtered = mapped;
        if (titlesExclude.length > 0) {
          filtered = mapped.filter(r => {
            const title = (r.title || '').toLowerCase();
            return !titlesExclude.some(ex => title.includes(ex));
          });
        }

        setResults(filtered);
        setSelected(new Set());
        setSuccess(`Imported ${filtered.length} contacts from ${file.name}${filtered.length < mapped.length ? ` (${mapped.length - filtered.length} excluded by title filter)` : ''}`);
      } catch (err) {
        setError('Failed to parse CSV: ' + err.message);
      }
    };
    reader.readAsText(file);
    // Reset file input so same file can be re-imported
    e.target.value = '';
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

              <div style={{ gridColumn: '2 / 4' }}>
                {/* Saved presets row */}
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Saved Presets:</span>
                  {titlePresets.map((p, i) => (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                      <button
                        type="button"
                        onClick={() => {
                          updateFilter('titleKeywords', p.include || '');
                          updateFilter('titleExclude', p.exclude || '');
                        }}
                        style={{
                          padding: '0.2rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 500,
                          cursor: 'pointer', fontFamily: 'inherit', border: '1px solid var(--color-border)',
                          background: 'var(--color-surface)', color: 'var(--color-text-secondary)',
                        }}
                      >{p.name}</button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = titlePresets.filter((_, j) => j !== i);
                          setTitlePresets(next);
                          saveTitlePresets(next);
                        }}
                        style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: '0.7rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                        title="Delete preset"
                      >&times;</button>
                    </span>
                  ))}
                  {titlePresets.length === 0 && <span style={{ fontSize: '0.7rem', color: '#9CA3AF', fontStyle: 'italic' }}>None saved</span>}
                </div>
                {/* Save current as preset */}
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.6rem' }}>
                  <input
                    type="text"
                    placeholder="Preset name..."
                    value={presetName}
                    onChange={e => setPresetName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && presetName.trim() && (filters.titleKeywords || filters.titleExclude)) {
                        e.preventDefault();
                        const next = [...titlePresets, { name: presetName.trim(), include: filters.titleKeywords, exclude: filters.titleExclude }];
                        setTitlePresets(next);
                        saveTitlePresets(next);
                        setPresetName('');
                      }
                    }}
                    style={{ padding: '0.25rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.72rem', fontFamily: 'inherit', width: '160px' }}
                  />
                  <button
                    type="button"
                    disabled={!presetName.trim() || (!filters.titleKeywords && !filters.titleExclude)}
                    onClick={() => {
                      const next = [...titlePresets, { name: presetName.trim(), include: filters.titleKeywords, exclude: filters.titleExclude }];
                      setTitlePresets(next);
                      saveTitlePresets(next);
                      setPresetName('');
                    }}
                    style={{
                      padding: '0.25rem 0.6rem', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit', border: 'none',
                      background: (!presetName.trim() || (!filters.titleKeywords && !filters.titleExclude)) ? '#E2E8F0' : 'var(--color-accent)',
                      color: (!presetName.trim() || (!filters.titleKeywords && !filters.titleExclude)) ? '#94A3B8' : '#fff',
                    }}
                  >Save Preset</button>
                </div>
                {/* Title textareas */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
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
                onClick={() => fileInputRef.current?.click()}
              >
                Import ZoomInfo CSV
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={handleCSVImport}
              />
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

      {/* Zoom Upload Sections */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1.5rem' }}>
        {/* Zoom Company Upload */}
        <div style={{ border: '1px solid var(--color-border)', borderRadius: '8px', padding: '1rem' }}>
          <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 0.5rem 0' }}>Zoom Company Upload</h3>
          <p style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', margin: '0 0 0.75rem 0' }}>
            Upload a ZoomInfo company export to map Zoom Company Names and IDs to your accounts. Use "Import Zoom Mapping" on the My Accounts page to apply.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => {
                const myAccounts = prospects.filter(p => {
                  if (!p.company) return false;
                  const cdm = (p.cdm || '').toLowerCase();
                  if (!cdm.includes('baldauf') && !cdm.includes('dan b')) return false;
                  return p.tier === 'Tier 1' || p.tier === 'Tier 2' || p.tier === 'Tier 3';
                }).sort((a, b) => (a.company || '').localeCompare(b.company || ''));
                const wsData = [
                  ["Dan's Account Name", 'Zoom Company Name', 'Website', 'Zoom Company ID'],
                  ...myAccounts.map(p => [p.company, p.zoomCompanyName || '', p.website || '', p.zoomCompanyId || '']),
                ];
                const csv = wsData.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'My_Company_Data.csv';
                a.click();
                URL.revokeObjectURL(url);
              }}
              style={{ padding: '0.35rem 0.7rem', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: 'var(--color-surface)', color: 'var(--color-accent)' }}
            >Download My Company Data</button>
            <button
              onClick={() => companyFileRef.current?.click()}
              style={{ padding: '0.35rem 0.7rem', border: 'none', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: 'var(--color-accent)', color: '#fff' }}
            >Upload Company File</button>
            <input ref={companyFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleCompanyUpload} />
          </div>
          {companyUploadResult && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#10B981', fontWeight: 600 }}>
              ✓ {companyUploadResult.fileName}: {companyUploadResult.rows.length} rows, columns: {companyUploadResult.headers.slice(0, 5).join(', ')}{companyUploadResult.headers.length > 5 ? '...' : ''}
            </div>
          )}
        </div>

        {/* Zoom Contact Upload */}
        <div style={{ border: '1px solid var(--color-border)', borderRadius: '8px', padding: '1rem' }}>
          <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 0.5rem 0' }}>Zoom Contact Upload</h3>
          <p style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', margin: '0 0 0.5rem 0' }}>
            Upload a ZoomInfo contact export (.csv or .xlsx). Contacts load into the table above for review, then push to HubSpot.
          </p>
          <div style={{ fontSize: '0.65rem', color: '#9CA3AF', marginBottom: '0.75rem' }}>
            Maps: First Name, Last Name, Job Title, Company Name, Email Address, Direct Phone Number, LinkedIn Contact Profile URL, City, State, Country
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => contactFileRef.current?.click()}
              style={{ padding: '0.35rem 0.7rem', border: 'none', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: 'var(--color-accent)', color: '#fff' }}
            >Upload Contact File</button>
            <input ref={contactFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleContactUpload} />
          </div>
          {contactUploadResult && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#10B981', fontWeight: 600 }}>
              ✓ {contactUploadResult.fileName}: {contactUploadResult.rows.length} contacts loaded — review in table above, then push to HubSpot
            </div>
          )}
        </div>
      </div>

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
