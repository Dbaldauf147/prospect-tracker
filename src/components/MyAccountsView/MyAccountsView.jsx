import { useState, useMemo, useRef, useEffect } from 'react';
import { Badge } from '../common/Badge';
import { DataTable } from '../common/DataTable';
import { statusColor, formatAum } from '../../utils/formatters';
import { STATUSES, TYPES, TIERS, GEOGRAPHIES, PUBLIC_PRIVATE } from '../../data/enums';
import styles from './MyAccountsView.module.css';

function InlineCell({ row, field, value, onUpdate, type, options }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  function startEdit(e) { if (e) e.stopPropagation(); setEditValue(value ?? ''); setEditing(true); }
  function save() {
    setEditing(false);
    const newVal = type === 'number' ? (editValue === '' ? null : Number(editValue)) : editValue;
    if (newVal !== value) onUpdate(row.id, { [field]: newVal });
  }

  if (editing && options) {
    return <select className={styles.inlineSelect} value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={save} autoFocus onClick={e => e.stopPropagation()}>
      <option value="">—</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>;
  }
  if (editing) {
    return <input className={styles.inlineInput} type={type === 'number' ? 'number' : 'text'} value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} autoFocus onClick={e => e.stopPropagation()} />;
  }
  return <span className={styles.cellEditable} onDoubleClick={startEdit}>{value || '—'}</span>;
}

function FilterDrop({ label, options, selected, onToggle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const count = selected.length;
  return (
    <div className={styles.filterGroup} ref={ref}>
      <button className={count > 0 ? styles.filterBtnActive : styles.filterBtn} onClick={() => setOpen(p => !p)}>
        {label}{count > 0 && <span className={styles.filterCount}>{count}</span>}
      </button>
      {open && (
        <div className={styles.filterDropdown}>
          {options.map(opt => (
            <label key={opt} className={styles.filterItem}>
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => onToggle(opt)} style={{ accentColor: 'var(--color-accent)' }} />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Dan's tiered account names (normalized lowercase for matching)
const MY_ACCOUNTS = new Map([
  ['blue owl capital', 'Tier 1'],
  ['brookfield asset management', 'Tier 1'],
  ['cbre investment management', 'Tier 1'],
  ['cerberus capital management', 'Tier 1'],
  ['nationwide', 'Tier 1'],
  ['goldman sachs asset management', 'Tier 1'],
  ['hellman & friedman', 'Tier 1'],
  ['jones lang lasalle (jll)', 'Tier 1'],
  ['jp morgan asset management real estate', 'Tier 1'],
  ['nuveen real estate, a tiaa co.', 'Tier 1'],
  ['pnc', 'Tier 1'],
  ['prologis', 'Tier 1'],
  ['simon property group', 'Tier 1'],
  ['thoma bravo', 'Tier 1'],
  ['ventas', 'Tier 1'],
  ['ameriprise financial', 'Tier 2'],['affinius capital, a usaa co.', 'Tier 2'],['affinius capital', 'Tier 2'],
  ['american homes 4 rent', 'Tier 2'],['article student living', 'Tier 2'],['article student living, llc', 'Tier 2'],
  ['bank ozk', 'Tier 2'],['bok financial', 'Tier 2'],['berkeley partners', 'Tier 2'],
  ['chubb, ltd.', 'Tier 2'],['cibc', 'Tier 2'],['eos hospitality', 'Tier 2'],
  ['formerly washreit', 'Tier 2'],['washreit', 'Tier 2'],['invitation homes', 'Tier 2'],
  ['lineage logistics (a bay grove co.)', 'Tier 2'],['lineage logistics', 'Tier 2'],
  ['bluerock residential growth reit', 'Tier 2'],['boxer properties', 'Tier 2'],
  ['cabot properties', 'Tier 2'],['cadillac fairview', 'Tier 2'],['cbre', 'Tier 2'],
  ['lpl financial', 'Tier 2'],['clayton, dubilier & rice (cdr)', 'Tier 2'],
  ['new york life', 'Tier 2'],['community healthcare trust inc.', 'Tier 2'],
  ['costar group, inc.', 'Tier 2'],['deloitte', 'Tier 2'],['northern trust', 'Tier 2'],
  ['park hotels & resorts', 'Tier 2'],['divcowest', 'Tier 2'],['realterm', 'Tier 2'],
  ['diversified healthcare trust', 'Tier 2'],['sofi', 'Tier 2'],
  ['teachers insurance and annuity association of america (tiaa)', 'Tier 2'],['tiaa', 'Tier 2'],
  ['dream industrial (a dream unlimited co.)', 'Tier 2'],['dream industrial', 'Tier 2'],
  ['easterly government properties inc.', 'Tier 2'],['eastgroup properties (egp)', 'Tier 2'],
  ['edens', 'Tier 2'],['education realty trust inc. (a greystar co.)', 'Tier 2'],['education realty trust inc.', 'Tier 2'],
  ['equity lifestyle properties', 'Tier 2'],['ey consulting', 'Tier 2'],['gbx group', 'Tier 2'],
  ['griffis residential', 'Tier 2'],['harrison street', 'Tier 2'],['hines', 'Tier 2'],
  ['hobbs brook real estate', 'Tier 2'],['industrious', 'Tier 2'],
  ['international workplace group (iwg)', 'Tier 2'],['invesco real estate', 'Tier 2'],
  ['jackson financial group', 'Tier 2'],['jamestown properties', 'Tier 2'],
  ['kilroy realty', 'Tier 2'],['kimco realty corporation', 'Tier 2'],
  ['kite realty group trust', 'Tier 2'],['klein enterprises, llc', 'Tier 2'],['klein enterprises', 'Tier 2'],
  ['lennar corp.', 'Tier 2'],['macerich', 'Tier 2'],['merritt properties', 'Tier 2'],
  ["moody's", 'Tier 2'],['piedmont office realty trust inc.', 'Tier 2'],
  ['popular, inc.', 'Tier 2'],['price waterhouse coopers (pwc)', 'Tier 2'],
  ['principal financial group', 'Tier 2'],['pritzker private capital (ppc-pc)', 'Tier 2'],
  ['pulte group', 'Tier 2'],['realty income', 'Tier 2'],['remedy reit', 'Tier 2'],
  ['renew senior living', 'Tier 2'],['rinchem company', 'Tier 2'],['rmr group', 'Tier 2'],
  ["shearer's foods", 'Tier 2'],['silver lake', 'Tier 2'],['south bay development company', 'Tier 2'],
  ['starwood capital group', 'Tier 2'],['store capital', 'Tier 2'],['strategic value partners', 'Tier 2'],
  ['tishman speyer properties inc.', 'Tier 2'],['trammell crow company, (a cbre co.)', 'Tier 2'],
  ['trammell crow company (a cbre co.)', 'Tier 2'],['trammell crow company', 'Tier 2'],
  ['tricon residential', 'Tier 2'],['usaa', 'Tier 2'],['vertiv', 'Tier 2'],
  ['westinghouse (a brookfield co.)', 'Tier 2'],['wework', 'Tier 2'],
  ['whitestone reit', 'Tier 2'],['wilsonart international, inc.', 'Tier 2'],['wsp global', 'Tier 2'],
]);

function findTier(companyName) {
  const key = (companyName || '').toLowerCase().trim();
  if (MY_ACCOUNTS.has(key)) return MY_ACCOUNTS.get(key);
  for (const [k, tier] of MY_ACCOUNTS) {
    if (k.startsWith(key) || key.startsWith(k)) return tier;
  }
  return null;
}

const ACCOUNT_COLUMNS = [
  { key: 'company', label: 'Company', defaultWidth: 220, sticky: true, render: null /* set below */ },
  { key: 'myTier', label: 'Tier', defaultWidth: 130, render: null /* set in columns memo */ },
  { key: 'status', label: 'Status', defaultWidth: 130, render: (row) => row.status ? <Badge label={row.status} color={statusColor(row.status)} /> : '—' },
  { key: 'type', label: 'Type', defaultWidth: 160 },
  { key: 'geography', label: 'Geography', defaultWidth: 100 },
  { key: 'publicPrivate', label: 'Pub/Priv', defaultWidth: 80 },
  { key: 'reAum', label: 'RE AUM', defaultWidth: 90, render: (row) => formatAum(row.reAum) },
  { key: 'peAum', label: 'PE AUM', defaultWidth: 90, render: (row) => formatAum(row.peAum) },
  { key: 'numberOfSites', label: 'Sites', defaultWidth: 70, render: (row) => row.numberOfSites != null ? row.numberOfSites.toLocaleString() : '—' },
  { key: 'frameworks', label: 'Frameworks', defaultWidth: 140, render: (row) => (row.frameworks || []).join(', ') || '—' },
  { key: 'hqRegion', label: 'HQ Region', defaultWidth: 110 },
  { key: 'cdm', label: 'CDM', defaultWidth: 120 },
  { key: 'notes', label: 'Notes', defaultWidth: 200 },
  { key: 'activityCount', label: 'Activity (30d)', defaultWidth: 85, render: (row) => row.activityCount > 0 ? <span style={{ fontWeight: 700, color: 'var(--color-accent)' }}>{row.activityCount}</span> : <span style={{ color: 'var(--color-text-muted)' }}>0</span> },
  { key: 'oppsCount', label: 'Active Opps', defaultWidth: 85, render: (row) => row.oppsCount > 0 ? <span style={{ fontWeight: 700, color: '#7C3AED' }}>{row.oppsCount}</span> : <span style={{ color: 'var(--color-text-muted)' }}>0</span> },
  { key: 'totalOpps', label: 'Total Opps', defaultWidth: 80, render: (row) => row.totalOpps > 0 ? <span style={{ fontWeight: 700, color: 'var(--color-text-secondary)' }}>{row.totalOpps}</span> : <span style={{ color: 'var(--color-text-muted)' }}>0</span> },
  { key: 'dmFound', label: 'Decision Maker', defaultWidth: 140, render: (row) => row.dmFound
    ? <span title={row.dmNames} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        <span style={{ color: '#10B981', fontWeight: 700, fontSize: '0.75rem' }}>&#10003;</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text)' }}>{row.dmNames}</span>
      </span>
    : <span style={{ color: 'var(--color-danger)', fontWeight: 600, fontSize: '0.75rem' }}>Not Found</span>
  },
  { key: 'targetName', label: 'Target Accounts Name', defaultWidth: 200, render: null /* set in columns memo */ },
  { key: 'sources', label: 'Sources', defaultWidth: 160, render: (row) => {
    const parts = (row.sources || '').split(', ').filter(Boolean);
    return <span style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
      {parts.map(s => <span key={s} style={{
        padding: '1px 6px', borderRadius: '999px', fontSize: '0.62rem', fontWeight: 600,
        background: s === 'HubSpot' ? '#EDE9FE' : s === 'Target List' ? '#ECFDF5' : '#EBF2FC',
        color: s === 'HubSpot' ? '#7C3AED' : s === 'Target List' ? '#059669' : '#3B7DDD',
      }}>{s}</span>)}
    </span>;
  }},
];

// Fuzzy company name matching — returns true if names are "close enough"
function companiesMatch(a, b) {
  const na = (a || '').toLowerCase().trim();
  const nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  // One contains the other — but only if the shorter is at least 60% of the longer
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  // Strip common suffixes and compare
  const strip = s => s.replace(/\b(inc|llc|ltd|corp|co|lp)\b\.?/gi, '').replace(/[^a-z0-9 ]/g, '').trim();
  const sa = strip(na);
  const sb = strip(nb);
  if (sa === sb) return true;
  // After stripping, check containment with same length ratio
  const sLonger = sa.length >= sb.length ? sa : sb;
  const sShorter = sa.length >= sb.length ? sb : sa;
  if (sShorter.length >= 4 && sShorter.length >= sLonger.length * 0.6 && sLonger.includes(sShorter)) return true;
  return false;
}

function fuzzyHas(names, target) {
  for (const name of names) {
    if (companiesMatch(name, target)) return true;
  }
  return false;
}

// Target Accounts data is now passed as a prop from App.jsx

const TARGET_MAP_KEY = 'my-accounts-target-map';
function loadTargetMap() { try { return JSON.parse(localStorage.getItem(TARGET_MAP_KEY)) || {}; } catch { return {}; } }
function saveTargetMap(m) { localStorage.setItem(TARGET_MAP_KEY, JSON.stringify(m)); }

function TargetNamePicker({ value, companyId, targetOptions, onPick, isDuplicate }) {
  const [editing, setEditing] = useState(false);
  const [inputText, setInputText] = useState('');
  const ref = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setEditing(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [editing]);

  function startEditing() {
    setInputText(value || '');
    setEditing(true);
  }

  const filtered = inputText.trim()
    ? targetOptions.filter(t => t.toLowerCase().includes(inputText.toLowerCase()))
    : targetOptions;

  if (!editing) {
    return (
      <span
        style={{ fontSize: '0.75rem', color: value ? (isDuplicate ? '#EF4444' : 'var(--color-text)') : 'var(--color-accent)', cursor: 'pointer', padding: '1px 3px', borderRadius: '4px', fontWeight: isDuplicate ? 600 : 400, background: isDuplicate ? '#FEF2F2' : 'transparent' }}
        onClick={startEditing}
        title={isDuplicate ? 'Duplicate — this target account is mapped to multiple companies' : ''}
      >
        {isDuplicate && '⚠ '}{value || '— Click to map —'}
      </span>
    );
  }

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <input
        ref={inputRef}
        style={{ width: '100%', padding: '0.25rem 0.4rem', border: '1px solid var(--color-accent)', borderRadius: '4px', fontSize: '0.75rem', fontFamily: 'inherit' }}
        type="text"
        placeholder="Type to search..."
        value={inputText}
        onChange={e => setInputText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') setEditing(false);
          if (e.key === 'Enter' && filtered.length === 1) { onPick(companyId, filtered[0]); setEditing(false); }
        }}
        autoFocus
        onClick={e => e.stopPropagation()}
      />
      <div style={{ position: 'absolute', top: 'calc(100% + 2px)', left: 0, background: '#fff', border: '1px solid var(--color-border)', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', padding: '0.3rem', minWidth: '250px', maxHeight: '220px', overflowY: 'auto', zIndex: 50 }}>
        {value && (
          <div
            style={{ padding: '0.25rem 0.4rem', fontSize: '0.7rem', color: 'var(--color-danger)', cursor: 'pointer', borderRadius: '4px' }}
            onClick={() => { onPick(companyId, ''); setEditing(false); }}
            onMouseOver={e => e.currentTarget.style.background = 'var(--color-danger-light)'}
            onMouseOut={e => e.currentTarget.style.background = ''}
          >
            ✕ Clear mapping
          </div>
        )}
        {filtered.map(t => (
          <div
            key={t}
            style={{ padding: '0.25rem 0.4rem', fontSize: '0.72rem', cursor: 'pointer', borderRadius: '4px', fontWeight: t === value ? 600 : 400, color: t === value ? 'var(--color-accent)' : 'var(--color-text)' }}
            onClick={() => { onPick(companyId, t); setEditing(false); }}
            onMouseOver={e => e.currentTarget.style.background = 'var(--color-accent-light)'}
            onMouseOut={e => e.currentTarget.style.background = ''}
          >
            {t}
          </div>
        ))}
        {filtered.length === 0 && <div style={{ padding: '0.4rem', fontSize: '0.7rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>No matches</div>}
      </div>
    </div>
  );
}

export function MyAccountsView({ prospects, onSelect, onUpdate, onDelete, onAdd, targetAccountsData }) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ myTier: [], status: [], type: [], geography: [] });
  const [expandedBucket, setExpandedBucket] = useState(null);
  const [targetMap, setTargetMap] = useState(loadTargetMap);

  function setTargetMapping(companyId, targetName) {
    setTargetMap(prev => {
      const next = { ...prev };
      if (targetName) next[companyId] = targetName;
      else delete next[companyId];
      saveTargetMap(next);
      return next;
    });
  }

  function toggleFilter(key, value) {
    setFilters(prev => {
      const arr = prev[key] || [];
      return { ...prev, [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] };
    });
  }

  function clearFilters() {
    setFilters({ myTier: [], status: [], type: [], geography: [] });
    setSearch('');
  }

  const activeFilterCount = Object.values(filters).reduce((s, a) => s + a.length, 0);

  // Parse Target Accounts from prop data
  const targetAccounts = useMemo(() => {
    const data = targetAccountsData;
    if (!data?.sheets) return [];
    const accounts = [];

    function findCol(r, keywords) {
      for (const key of Object.keys(r)) {
        const lower = key.toLowerCase();
        for (const kw of keywords) {
          if (lower.includes(kw.toLowerCase())) return (r[key] || '').trim();
        }
      }
      return '';
    }

    for (const sheetName of data.sheetNames || []) {
      const sheet = data.sheets[sheetName];
      if (!sheet?.records) continue;
      if (sheet.headers) console.log(`Target Accounts sheet "${sheetName}" columns:`, sheet.headers.filter(Boolean));

      for (const r of sheet.records) {
        let cdm = findCol(r, ['CDM', 'Salesperson', 'Sales Rep', 'Account Owner', 'Owner', 'Rep', 'Assigned', 'Team Member', 'Sales']).toLowerCase();
        if (!cdm) {
          cdm = Object.values(r).find(v => String(v || '').toLowerCase().includes('baldauf')) || '';
          cdm = String(cdm).toLowerCase();
        }
        if (!cdm.includes('baldauf') && !cdm.includes('dan b')) continue;
        let tier = findCol(r, ['Tier', 'Account Tier', 'Tier Level', 'Target']);
        if (!tier) {
          tier = Object.values(r).find(v => /Tier\s*[12]/i.test(String(v || ''))) || '';
          tier = String(tier);
        }
        if (!tier.match(/(Tier\s*)?[12]/i)) continue;
        const company = findCol(r, ['Account', 'Company', 'Account Name', 'Client', 'Name']);
        if (!company) continue;
        const normalizedTier = tier.match(/1/) ? 'Tier 1' : 'Tier 2';
        accounts.push({ company: company.trim(), tier: normalizedTier, ...r });
      }
    }
    console.log(`Target Accounts: found ${accounts.length} Dan Baldauf Tier 1/2 accounts`);
    return accounts;
  }, [targetAccountsData]);

  // Load activity cache and count per company
  const activityByCompany = useMemo(() => {
    const counts = {};
    try {
      const cache = JSON.parse(localStorage.getItem('hubspot-activity-cache'));
      if (!cache) return counts;

      // Build domain→company map from prospects
      const domainMap = new Map();
      const contactMap = new Map();
      try {
        const hsCache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
        for (const c of (hsCache?.contacts || [])) {
          if (c.email && c.company) contactMap.set(c.email.toLowerCase(), c.company.toLowerCase());
        }
      } catch {}
      for (const p of prospects) {
        if (p.emailDomain) {
          const atIdx = p.emailDomain.lastIndexOf('@');
          const domain = atIdx >= 0 ? p.emailDomain.slice(atIdx + 1).toLowerCase() : p.emailDomain.toLowerCase();
          if (domain && p.company) domainMap.set(domain, p.company.toLowerCase());
        }
        if (p.website) {
          const d = p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase();
          if (d && p.company) domainMap.set(d, p.company.toLowerCase());
        }
      }

      function matchCompany(email) {
        if (!email) return null;
        const parts = email.split(/[;,]/).map(s => s.trim().toLowerCase()).filter(Boolean);
        for (const e of parts) {
          if (e.endsWith('@se.com')) continue;
          if (contactMap.has(e)) return contactMap.get(e);
          const atIdx = e.lastIndexOf('@');
          if (atIdx >= 0) {
            const domain = e.slice(atIdx + 1);
            if (domainMap.has(domain)) return domainMap.get(domain);
          }
        }
        return null;
      }

      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      for (const e of (cache.emails || [])) {
        if (e.hs_timestamp && new Date(e.hs_timestamp).getTime() < thirtyDaysAgo) continue;
        const co = matchCompany(e.hs_email_to_email) || matchCompany(e.hs_email_from_email);
        if (co) counts[co] = (counts[co] || 0) + 1;
      }
      for (const c of (cache.calls || [])) {
        if (c.hs_timestamp && new Date(c.hs_timestamp).getTime() < thirtyDaysAgo) continue;
        const co = matchCompany(c.hs_call_to_number) || matchCompany(c.hs_call_from_number);
        if (co) counts[co] = (counts[co] || 0) + 1;
      }
    } catch {}
    return counts;
  }, [prospects]);

  // Load opps cache and count active opps per account
  const [oppsRecords, setOppsRecords] = useState([]);
  useEffect(() => {
    // Try IndexedDB first, then localStorage fallback
    (async () => {
      try {
        const req = indexedDB.open('prospect-tracker-db', 2);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('target-accounts')) db.createObjectStore('target-accounts');
          if (!db.objectStoreNames.contains('opps-cache')) db.createObjectStore('opps-cache');
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('opps-cache', 'readonly');
          const store = tx.objectStore('opps-cache');
          const getReq = store.get('data');
          getReq.onsuccess = () => {
            const data = getReq.result;
            if (data?.records) setOppsRecords(data.records);
          };
        };
      } catch {}
      // Fallback to localStorage
      try {
        const cache = JSON.parse(localStorage.getItem('opps-cache'));
        if (cache?.records && oppsRecords.length === 0) setOppsRecords(cache.records);
      } catch {}
    })();
  }, []);

  const { activeOppsByAccount, totalOppsByAccount } = useMemo(() => {
    const active = {};
    const total = {};
    if (oppsRecords.length === 0) return { activeOppsByAccount: active, totalOppsByAccount: total };
    const closedStages = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
    for (const r of oppsRecords) {
      const account = (r['Account'] || '').toLowerCase();
      const stage = r['Stage'] || '';
      if (!account || closedStages.has(stage)) continue;
      total[account] = (total[account] || 0) + 1;
      const callIn = (r['Call In'] || '').trim();
      if (callIn && callIn !== '-') {
        active[account] = (active[account] || 0) + 1;
      }
    }
    return { activeOppsByAccount: active, totalOppsByAccount: total };
  }, [oppsRecords]);

  // Build source maps: which companies exist in each data source
  const { hubspotCompanies, decisionMakerByCompany } = useMemo(() => {
    const list = [];
    const dmMap = {}; // company lowercase → { found: boolean, name: string }
    try {
      const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
      const seen = new Set();
      for (const c of (cache?.contacts || [])) {
        const lower = (c.company || '').toLowerCase();
        if (lower && !seen.has(lower)) { seen.add(lower); list.push(lower); }
        if (lower && (c.decision_maker === 'true' || c.decision_maker === 'Yes')) {
          const name = [c.firstname, c.lastname].filter(Boolean).join(' ');
          if (!dmMap[lower]) dmMap[lower] = [];
          dmMap[lower].push(name || c.email || 'Unknown');
        }
      }
    } catch {}
    return { hubspotCompanies: list, decisionMakerByCompany: dmMap };
  }, []);

  const targetCompanies = useMemo(() => {
    const seen = new Set();
    return targetAccounts.map(t => (t.company || '').toLowerCase()).filter(c => { if (!c || seen.has(c)) return false; seen.add(c); return true; });
  }, [targetAccounts]);

  const { tier1, tier2, allAccounts, statusCounts } = useMemo(() => {
    const t1 = [];
    const t2 = [];
    const counts = {};

    const skippedCdm = [];
    for (const p of prospects) {
      // Use Firestore tier if it's a valid Tier 1/2, otherwise fall back to map/target accounts
      let tier = (p.tier === 'Tier 1' || p.tier === 'Tier 2') ? p.tier : findTier(p.company);
      if (!tier) {
        for (const t of targetAccounts) {
          if (companiesMatch(p.company, t.company)) { tier = t.tier; break; }
        }
      }
      if (!tier) continue;
      const cdm = (p.cdm || '').toLowerCase().trim();
      const isBaldauf = cdm.includes('baldauf');
      if (!isBaldauf) {
        skippedCdm.push({ company: p.company, cdm: p.cdm });
        continue;
      }
      const companyLower = (p.company || '').toLowerCase();
      const activityCount = activityByCompany[companyLower] || 0;
      const oppsCount = activeOppsByAccount[companyLower] || 0;
      const totalOpps = totalOppsByAccount[companyLower] || 0;
      const sources = [];
      sources.push('Google Sheets');
      if (fuzzyHas(hubspotCompanies, p.company)) sources.push('HubSpot');
      // Find matching Target Accounts name and tier — manual override first
      let targetName = targetMap[p.id] || '';
      let targetTier = '';
      if (targetName) {
        const matched = targetAccounts.find(t => t.company === targetName);
        if (matched) targetTier = matched.tier;
      } else {
        for (const t of targetAccounts) {
          if (companiesMatch(p.company, t.company)) { targetName = t.company; targetTier = t.tier; break; }
        }
      }
      if (targetName) sources.push('Target List');
      const tierMismatch = targetTier && targetTier !== tier;
      // Check for decision maker — fuzzy match company name against dmMap keys
      let dmNames = null;
      for (const [dmCompany, names] of Object.entries(decisionMakerByCompany)) {
        if (companiesMatch(companyLower, dmCompany)) { dmNames = names; break; }
      }
      const entry = { ...p, myTier: tier, activityCount, oppsCount, totalOpps, sources: sources.join(', '), dmFound: !!dmNames, dmNames: dmNames ? dmNames.join(', ') : '', cdmMismatch: !isBaldauf, targetName, targetTier, tierMismatch };
      if (tier === 'Tier 1') t1.push(entry);
      else t2.push(entry);
      const s = p.status || 'Unknown';
      counts[s] = (counts[s] || 0) + 1;
    }

    t1.sort((a, b) => (a.company || '').localeCompare(b.company || ''));
    t2.sort((a, b) => (a.company || '').localeCompare(b.company || ''));
    if (skippedCdm.length > 0) console.log('My Accounts: skipped (CDM not Baldauf):', skippedCdm);
    console.log(`My Accounts: ${t1.length} Tier 1, ${t2.length} Tier 2`);
    return { tier1: t1, tier2: t2, allAccounts: [...t1, ...t2], statusCounts: counts };
  }, [prospects, targetMap, targetAccounts, activityByCompany, activeOppsByAccount, totalOppsByAccount, hubspotCompanies, targetCompanies, decisionMakerByCompany]);

  const clientCount = statusCounts['Client'] || 0;
  const qualifyingCount = (statusCounts['Qualifying'] || 0) + (statusCounts['Inside Sales'] || 0);

  // Filter options derived from data
  const filterOptions = useMemo(() => ({
    myTier: [...new Set(allAccounts.map(a => a.myTier).filter(Boolean))].sort(),
    status: [...new Set(allAccounts.map(a => a.status).filter(Boolean))].sort(),
    type: [...new Set(allAccounts.map(a => a.type).filter(Boolean))].sort(),
    geography: [...new Set(allAccounts.map(a => a.geography).filter(Boolean))].sort(),
  }), [allAccounts]);

  // Apply filters and search
  const filteredAccounts = useMemo(() => {
    let result = allAccounts;
    for (const [key, values] of Object.entries(filters)) {
      if (values.length > 0) result = result.filter(a => values.includes(a[key]));
    }
    if (search.trim()) {
      const term = search.toLowerCase();
      result = result.filter(a =>
        [a.company, a.status, a.type, a.geography, a.hqRegion, a.notes, a.cdm]
          .filter(Boolean).join(' ').toLowerCase().includes(term)
      );
    }
    return result;
  }, [allAccounts, filters, search]);

  // All company names from Target Accounts file (not just Dan Baldauf's)
  const allTargetNames = useMemo(() => {
    if (!targetAccountsData?.sheets) return [];
    const names = new Set();
    for (const sheetName of targetAccountsData.sheetNames || []) {
      const sheet = targetAccountsData.sheets[sheetName];
      if (!sheet?.records) continue;
      for (const r of sheet.records) {
        // Find company/account column
        for (const key of Object.keys(r)) {
          const lower = key.toLowerCase();
          if (lower.includes('account') || lower.includes('company') || lower.includes('name')) {
            const val = (r[key] || '').trim();
            if (val && val.length > 1) names.add(val);
            break;
          }
        }
      }
    }
    return [...names].sort();
  }, [targetAccountsData]);

  // Detect duplicate target account name mappings
  const duplicateTargetNames = useMemo(() => {
    const counts = {};
    for (const a of allAccounts) {
      const tn = a.targetName;
      if (tn) counts[tn] = (counts[tn] || 0) + 1;
    }
    const dupes = new Set();
    for (const [name, count] of Object.entries(counts)) {
      if (count > 1) dupes.add(name);
    }
    return dupes;
  }, [allAccounts]);

  // Set the company column render with onSelect, and make editable columns use InlineCell
  const columns = useMemo(() => {
    const mapped = ACCOUNT_COLUMNS.map(col => {
      if (col.key === 'company') {
        return { ...col, render: (row) => <span style={{ fontWeight: 600, color: 'var(--color-text)', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onSelect(row); }}>{row.company}</span> };
      }
      if (col.key === 'myTier') {
        return { ...col, render: (row) => (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <InlineCell row={row} field="tier" value={row.myTier} onUpdate={onUpdate} options={TIERS} />
            {row.tierMismatch && <span style={{ color: '#F59E0B', fontSize: '0.6rem', fontWeight: 600 }} title={`Target Accounts says ${row.targetTier}`}>&#9888; {row.targetTier}</span>}
          </span>
        )};
      }
      if (col.key === 'targetName') {
        return { ...col, render: (row) => <TargetNamePicker value={row.targetName} companyId={row.id} targetOptions={allTargetNames} onPick={setTargetMapping} isDuplicate={!!row.targetName && duplicateTargetNames.has(row.targetName)} /> };
      }
      if (col.key === 'status') {
        return { ...col, render: (row) => <InlineCell row={row} field="status" value={row.status} onUpdate={onUpdate} options={STATUSES} /> };
      }
      if (col.key === 'type') {
        return { ...col, render: (row) => <InlineCell row={row} field="type" value={row.type} onUpdate={onUpdate} options={TYPES} /> };
      }
      if (col.key === 'geography') {
        return { ...col, render: (row) => <InlineCell row={row} field="geography" value={row.geography} onUpdate={onUpdate} options={GEOGRAPHIES} /> };
      }
      if (col.key === 'publicPrivate') {
        return { ...col, render: (row) => <InlineCell row={row} field="publicPrivate" value={row.publicPrivate} onUpdate={onUpdate} options={PUBLIC_PRIVATE} /> };
      }
      if (col.key === 'reAum') {
        return { ...col, render: (row) => <InlineCell row={row} field="reAum" value={row.reAum} onUpdate={onUpdate} type="number" /> };
      }
      if (col.key === 'peAum') {
        return { ...col, render: (row) => <InlineCell row={row} field="peAum" value={row.peAum} onUpdate={onUpdate} type="number" /> };
      }
      if (col.key === 'numberOfSites') {
        return { ...col, render: (row) => <InlineCell row={row} field="numberOfSites" value={row.numberOfSites} onUpdate={onUpdate} type="number" /> };
      }
      if (col.key === 'hqRegion') {
        return { ...col, render: (row) => <InlineCell row={row} field="hqRegion" value={row.hqRegion} onUpdate={onUpdate} /> };
      }
      if (col.key === 'cdm') {
        return { ...col, render: (row) => <InlineCell row={row} field="cdm" value={row.cdm} onUpdate={onUpdate} /> };
      }
      if (col.key === 'notes') {
        return { ...col, render: (row) => <InlineCell row={row} field="notes" value={row.notes} onUpdate={onUpdate} /> };
      }
      if (col.key === 'rank') {
        return { ...col, render: (row) => <InlineCell row={row} field="rank" value={row.rank} onUpdate={onUpdate} /> };
      }
      if (col.key === 'tier') {
        return { ...col, render: (row) => <InlineCell row={row} field="tier" value={row.tier} onUpdate={onUpdate} options={TIERS} /> };
      }
      if (col.key === 'website') {
        return { ...col, render: (row) => <InlineCell row={row} field="website" value={row.website} onUpdate={onUpdate} /> };
      }
      if (col.key === 'emailDomain') {
        return { ...col, render: (row) => <InlineCell row={row} field="emailDomain" value={row.emailDomain} onUpdate={onUpdate} /> };
      }
      // Skip computed columns — they stay read-only
      if (['myTier', 'activityCount', 'oppsCount', 'totalOpps', 'dmFound', 'sources', 'targetName', '_hide'].includes(col.key)) {
        return col;
      }
      // Make any remaining columns editable as text
      if (!col.render) {
        return { ...col, render: (row) => <InlineCell row={row} field={col.key} value={row[col.key]} onUpdate={onUpdate} /> };
      }
      return col;
    });
    // Add hide column
    mapped.push({
      key: '_hide',
      label: '',
      defaultWidth: 40,
      render: (row) => <button className={styles.deleteBtn} onClick={(e) => { e.stopPropagation(); if (confirm(`Remove "${row.company}" from the database?`)) onDelete(row.id); }} title="Remove">&#x2715;</button>,
    });
    return mapped;
  }, [onSelect, onUpdate, allTargetNames, duplicateTargetNames]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.filterBar}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search accounts..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <FilterDrop label="Tier" options={filterOptions.myTier} selected={filters.myTier} onToggle={v => toggleFilter('myTier', v)} />
        <FilterDrop label="Status" options={filterOptions.status} selected={filters.status} onToggle={v => toggleFilter('status', v)} />
        <FilterDrop label="Type" options={filterOptions.type} selected={filters.type} onToggle={v => toggleFilter('type', v)} />
        <FilterDrop label="Geography" options={filterOptions.geography} selected={filters.geography} onToggle={v => toggleFilter('geography', v)} />
        {activeFilterCount > 0 && <button className={styles.clearBtn} onClick={clearFilters}>Clear all</button>}
        <span className={styles.resultCount}>{filteredAccounts.length} of {allAccounts.length}</span>
      </div>
      {targetAccounts.length > 0 && (() => {
        const targetNames = targetAccounts.map(t => (t.company || '').toLowerCase());
        const myNames = allAccounts.map(a => (a.company || '').toLowerCase());
        const onlyMyAccounts = allAccounts.filter(a => !fuzzyHas(targetNames, a.company));
        const onlyTarget = targetAccounts.filter(t => !fuzzyHas(myNames, t.company));
        console.log('Target accounts loaded:', targetAccounts.map(t => t.company));
        console.log('My accounts loaded:', allAccounts.map(a => a.company));
        console.log('On Target but NOT My Accounts:', onlyTarget.map(t => t.company));
        console.log('On My Accounts but NOT Target:', onlyMyAccounts.map(a => a.company));
        if (onlyMyAccounts.length === 0 && onlyTarget.length === 0) return null;
        return (
          <div className={styles.mismatchSection}>
            {onlyMyAccounts.length > 0 && (
              <div className={styles.missingBanner}>
                <div className={styles.missingTitle}>
                  {onlyMyAccounts.length} on My Accounts but NOT on Target Accounts List
                </div>
                <div className={styles.missingList}>
                  {onlyMyAccounts.map(a => (
                    <span key={a.company} className={styles.missingChip}>
                      {a.company}
                      <Badge label={a.myTier} color={a.myTier === 'Tier 1' ? '#DC2626' : '#3B82F6'} />
                    </span>
                  ))}
                </div>
              </div>
            )}
            {onlyTarget.length > 0 && (
              <div className={styles.addedBanner}>
                <div className={styles.addedTitle}>
                  {onlyTarget.length} on Target Accounts List but NOT on My Accounts
                </div>
                <div className={styles.missingList}>
                  {onlyTarget.map((t, i) => (
                    <span key={i} className={styles.addedChip}>
                      {t.company}
                      <Badge label={t.tier} color={t.tier === 'Tier 1' ? '#DC2626' : '#3B82F6'} />
                      <button className={styles.addChipBtn} onClick={() => onAdd({
                        company: t.company,
                        cdm: 'Dan Baldauf',
                        status: '',
                        type: '',
                        geography: '',
                        publicPrivate: '',
                        assetTypes: [],
                        peAum: null,
                        reAum: null,
                        numberOfSites: null,
                        rank: '',
                        tier: t.tier,
                        hqRegion: '',
                        frameworks: [],
                        notes: '',
                        website: '',
                        emailDomain: '',
                      })} title={`Add ${t.company} to My Accounts`}>+ Add</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
      <div className={styles.summary}>
        {(() => {
          const myNames = allAccounts.map(a => (a.company || '').toLowerCase());
          const t1Missing = targetAccounts.filter(t => t.tier === 'Tier 1' && !fuzzyHas(myNames, t.company)).length;
          const t2Missing = targetAccounts.filter(t => t.tier === 'Tier 2' && !fuzzyHas(myNames, t.company)).length;
          return <>
            <button className={`${styles.summaryCard} ${expandedBucket === 'tier1' ? styles.summaryCardActive : ''}`} style={{ borderLeftColor: '#DC2626' }} onClick={() => setExpandedBucket(expandedBucket === 'tier1' ? null : 'tier1')}>
              <div className={styles.summaryLabel}>Tier 1</div>
              <div className={styles.summaryValue}>{tier1.length}</div>
              {t1Missing > 0 && <div className={styles.summaryBreakdown} style={{ color: '#DC2626' }}>{t1Missing} not in list</div>}
            </button>
            <button className={`${styles.summaryCard} ${expandedBucket === 'tier2' ? styles.summaryCardActive : ''}`} style={{ borderLeftColor: '#3B82F6' }} onClick={() => setExpandedBucket(expandedBucket === 'tier2' ? null : 'tier2')}>
              <div className={styles.summaryLabel}>Tier 2</div>
              <div className={styles.summaryValue}>{tier2.length}</div>
              {t2Missing > 0 && <div className={styles.summaryBreakdown} style={{ color: '#3B82F6' }}>{t2Missing} not in list</div>}
            </button>
          </>;
        })()}
        <div className={styles.summaryCard} style={{ borderLeftColor: '#3B7DDD' }}>
          <div className={styles.summaryLabel}>Total</div>
          <div className={styles.summaryValue}>{tier1.length + tier2.length}</div>
        </div>
        <div className={styles.summaryCard} style={{ borderLeftColor: '#10B981' }}>
          <div className={styles.summaryLabel}>Clients</div>
          <div className={styles.summaryValue}>{clientCount}</div>
        </div>
        <div className={styles.summaryCard} style={{ borderLeftColor: '#F59E0B' }}>
          <div className={styles.summaryLabel}>In Pipeline</div>
          <div className={styles.summaryValue}>{qualifyingCount}</div>
        </div>
      </div>
      {expandedBucket && (() => {
        const myNames = allAccounts.map(a => (a.company || '').toLowerCase());
        const tierLabel = expandedBucket === 'tier1' ? 'Tier 1' : 'Tier 2';
        const notInMyAccounts = targetAccounts
          .filter(t => t.tier === tierLabel && !fuzzyHas(myNames, t.company));
        if (notInMyAccounts.length === 0) return (
          <div className={styles.bucketList}>
            <div className={styles.bucketHeader}>
              <span className={styles.bucketTitle}>{tierLabel} — Not in My Accounts</span>
              <button className={styles.bucketClose} onClick={() => setExpandedBucket(null)}>&times;</button>
            </div>
            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>All {tierLabel} companies are already in My Accounts</div>
          </div>
        );
        return (
          <div className={styles.bucketList}>
            <div className={styles.bucketHeader}>
              <span className={styles.bucketTitle}>{tierLabel} — {notInMyAccounts.length} Not in My Accounts</span>
              <button className={styles.bucketClose} onClick={() => setExpandedBucket(null)}>&times;</button>
            </div>
            <div className={styles.bucketGrid}>
              {notInMyAccounts.map((t, i) => (
                <span key={i} className={styles.bucketChip} onClick={() => { setSearch(t.company); setExpandedBucket(null); }}>
                  {t.company}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      <div className={styles.tableWrap}>
        <DataTable
          tableId="my-accounts"
          columns={columns}
          rows={filteredAccounts}
          alwaysVisible={['company']}
          emptyMessage="No matching accounts found"
        />
      </div>
    </div>
  );
}
