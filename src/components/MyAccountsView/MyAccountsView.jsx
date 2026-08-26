import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { apiFetch } from '../../utils/apiFetch';
import { createPortal } from 'react-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { Badge } from '../common/Badge';
import { DataTable } from '../common/DataTable';
import { statusColor, formatAum } from '../../utils/formatters';
import { STATUSES, TYPES, TIERS, GEOGRAPHIES, PUBLIC_PRIVATE } from '../../data/enums';
import { getEffectiveDropdownLists } from '../../utils/dropdownListsStore';
import { computeListFlags, LIST_FLAG_BY_LABEL } from '../../utils/listFlags';
import { buildCompanyIndex, findMatchesInIndex, findStrictMatchesInIndex, hasMatchInIndex } from '../../utils/companyIndex';
import { getHubspotCache, setHubspotCachePreservingManual } from '../../utils/hubspotContactsCache';
import { dbGet } from '../../utils/db';
import { userLsGet, userLsSet } from '../../utils/userLs';
import { saveMyAccountsFlags } from '../../utils/myAccountsFlagsStore';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { loadList } from '../../utils/uploadedListStore';
import { MASTER_FIELDS, CANONICAL_HEADERS } from '../MasterSiteListView/masterSiteFields';
import { matchesCdm, resolveTargetAccountCdm } from '../../utils/cdmMatch';
import {
  addDivisionPatch,
  addDivisionsPatch,
  removeDivisionPatch,
  addDivisionRulePatch,
  removeDivisionRulePatch,
} from '../../utils/divisions';
import styles from './MyAccountsView.module.css';

function InlineCell({ row, field, value, onUpdate, type, options, displayValue }) {
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
      <option value="">-</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>;
  }
  if (editing) {
    return <input className={styles.inlineInput} type={type === 'number' ? 'number' : 'text'} value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} autoFocus onClick={e => e.stopPropagation()} />;
  }
  // displayValue lets callers render a friendly label (e.g. "1") while
  // the underlying value stored on the row stays canonical ("Tier 1")
  // so dropdown options and filters keep working.
  const shown = (displayValue !== undefined ? displayValue : value) || '-';
  return <span className={styles.cellEditable} onDoubleClick={startEdit}>{shown}</span>;
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

// Type → "Type 2" rollup, shared by the column renderer and its
// header filter so filtering matches the pill the user sees.
const TYPE2_MAP = {
  'Owner Operator': 'Real Estate',
  'Asset Management Firm': 'Real Estate',
  'Facility Manager': 'Real Estate',
  'Developer': 'Real Estate',
  'Private Equity': 'Private Equity',
  'Portfolio Company': 'Private Equity',
  'Other': 'Other',
  'Partner': 'Other',
};
const TYPE2_COLORS = {
  'Real Estate': { bg: '#DBEAFE', color: '#1E40AF' },
  'Private Equity': { bg: '#F3E8FF', color: '#7C3AED' },
  'Other': { bg: '#F3F4F6', color: '#6B7280' },
};

// "Company Type" subtab. Accounts with a blank Type still get a bucket so
// they stay visible (and fixable) instead of dropping out of the grouping.
const UNSPECIFIED_TYPE = 'No Type Set';
// Tier accents for the company chips — same palette as the tier summary
// cards on the main tab, so a Tier 1 reads red in both places.
const TIER_CHIP_COLORS = {
  'Tier 1': { bg: '#FEE2E2', color: '#B91C1C' },
  'Tier 2': { bg: '#DBEAFE', color: '#1D4ED8' },
  'Tier 3': { bg: '#FEF3C7', color: '#B45309' },
};
const TIER_ORDER = { 'Tier 1': 0, 'Tier 2': 1, 'Tier 3': 2 };

// The Master Site List (SitesView's "Master Site List" tab) persists its
// rows under this key via uploadedListStore. We load it here to show a
// per-company count of how many sites exist on that tab.
const MASTER_SITE_LIST_KEY = 'master-site-list-override';

// Build the native hover tooltip shown on a column header's ⚠ warning:
// a short description of what the flag means plus the list of accounts it
// applies to. Returns undefined when nothing is flagged so the header
// falls back to its plain label tooltip. The list is capped so a table-
// wide flag doesn't produce an unreadably long tooltip.
function warningHeaderTitle(description, companies) {
  const names = (companies || []).map(c => String(c || '').trim()).filter(Boolean);
  if (names.length === 0) return undefined;
  const CAP = 50;
  const shown = names.slice(0, CAP);
  const more = names.length - shown.length;
  return `${description} · ${names.length} account${names.length === 1 ? '' : 's'}:\n• ${shown.join('\n• ')}`
    + (more > 0 ? `\n…and ${more} more` : '');
}

const ACCOUNT_COLUMNS = [
  { key: 'company', label: 'Company', defaultWidth: 220, sticky: true, render: null /* set below */ },
  { key: 'myTier', label: 'Tier', defaultWidth: 130, render: null /* set in columns memo */ },
  { key: 'status', label: 'Status', defaultWidth: 130, render: (row) => row.status ? <Badge label={row.status} color={statusColor(row.status)} /> : '-' },
  { key: 'type', label: 'Type', defaultWidth: 160 },
  { key: 'type2', label: 'Type 2', defaultWidth: 110, getFilterValue: (row) => TYPE2_MAP[row.type] || '', render: (row) => {
    const val = TYPE2_MAP[row.type] || '';
    const s = TYPE2_COLORS[val] || TYPE2_COLORS['Other'];
    return val ? <span style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 600, background: s.bg, color: s.color }}>{val}</span> : <span style={{ color: 'var(--color-text-muted)' }}>-</span>;
  }},
  { key: 'geography', label: 'Geography', defaultWidth: 100 },
  { key: 'publicPrivate', label: 'Pub/Priv', defaultWidth: 80 },
  { key: 'reAum', label: 'RE AUM', defaultWidth: 90, render: (row) => formatAum(row.reAum) },
  { key: 'peAum', label: 'PE AUM', defaultWidth: 90, render: (row) => formatAum(row.peAum) },
  { key: 'numberOfSites', label: 'Sites', defaultWidth: 70, render: (row) => row.numberOfSites != null ? row.numberOfSites.toLocaleString() : '-' },
  { key: 'mslSiteCount', label: 'MSL Sites', defaultWidth: 80, render: (row) => {
    const n = row.mslSiteCount || 0;
    const tip = `${n.toLocaleString()} site${n === 1 ? '' : 's'} on the Master Site List for "${row.company || ''}"`;
    return n > 0
      ? <span title={tip} style={{ fontWeight: 700, color: 'var(--color-accent)', cursor: 'help' }}>{n.toLocaleString()}</span>
      : <span title={tip} style={{ color: 'var(--color-text-muted)', cursor: 'help' }}>0</span>;
  } },
  // Frameworks now render as pills via the listFlags column below — the
  // two surfaces (My Accounts column + prospect-modal Frameworks
  // dropdown) share storage via prospect.frameworks plus the Lists-page
  // confirmed mappings.
  { key: 'hqRegion', label: 'HQ Region', defaultWidth: 130 },
  { key: 'naRegion', label: 'HQ Location', defaultWidth: 180, render: null },
  { key: 'bfoCompanyId', label: 'BFO Company ID', defaultWidth: 120 },
  { key: 'bfoCompanyName', label: 'BFO Company Name', defaultWidth: 180 },
  { key: 'zoomCompanyId', label: 'Zoom Company ID', defaultWidth: 120 },
  { key: 'zoomCompanyName', label: 'Zoom Company Name', defaultWidth: 180 },
  { key: 'cdm', label: 'CDM', defaultWidth: 120 },
  { key: 'notes', label: 'Notes', defaultWidth: 200 },
  { key: 'contactCount', label: 'Contacts', defaultWidth: 80, render: (row) => {
    // Hover tip exposes how the matcher resolved this row so 0
    // counts have a debuggable explanation.
    const tip = `Match diagnostics for this row:
  Prospect company (as stored): "${row.company || ''}"
  HubSpot cache size: ${row._contactDebug?.cacheSize ?? '-'}
  Exact-name matches: ${row._contactDebug?.exactNameMatches ?? '-'}
  Domain matches: ${row._contactDebug?.domainMatches ?? '-'}
  Linked (pinned) matches: ${row._contactDebug?.linkedMatches ?? '-'}
  Prospect domains: ${row._contactDebug?.prospectDomains?.join(', ') || '(none registered)'}
  Sample HubSpot companies w/ overlapping tokens:
    ${(row._contactDebug?.similarContactCompanies || []).join('\n    ') || '(none found)'}`;
    if (row.contactCount > 0) {
      return <span title={tip} style={{ fontWeight: 700, color: '#0891B2', cursor: 'help' }}>{row.contactCount}</span>;
    }
    return <span title={tip} style={{ color: 'var(--color-text-muted)', cursor: 'help' }}>0</span>;
  } },
  { key: 'bucketCount', label: 'Stakeholders', defaultWidth: 90, render: (row) => {
    const count = row.bucketCount || 0;
    const color = count === 5 ? '#059669' : count >= 3 ? '#D97706' : count > 0 ? '#DC2626' : 'var(--color-text-muted)';
    return <span style={{ fontWeight: 700, color }}>{count}/5</span>;
  }},
  { key: 'activityCount', label: 'Activity (30d)', defaultWidth: 85, render: (row) => row.activityCount > 0 ? <span style={{ fontWeight: 700, color: 'var(--color-accent)' }}>{row.activityCount}</span> : <span style={{ color: 'var(--color-text-muted)' }}>0</span> },
  { key: 'oppsCount', label: 'Opps', defaultWidth: 70, render: (row) => {
    const active = row.oppsCount || 0;
    const total = row.totalOpps || 0;
    if (total === 0) return <span style={{ color: 'var(--color-text-muted)' }}>0/0</span>;
    return <span style={{ fontWeight: 700, color: active > 0 ? '#7C3AED' : 'var(--color-text-secondary)' }}>{active}/{total}</span>;
  }},
  { key: 'dmFound', label: 'Decision Maker', defaultWidth: 140, getFilterValue: (row) => row.dmFound ? (row.dmNames || 'Found') : 'Not Found', render: (row) => row.dmFound
    ? <span title={row.dmNames} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        <span style={{ color: '#10B981', fontWeight: 700, fontSize: '0.75rem' }}>&#10003;</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text)' }}>{row.dmNames}</span>
      </span>
    : <span style={{ color: 'var(--color-danger)', fontWeight: 600, fontSize: '0.75rem' }}>Not Found</span>
  },
  { key: 'targetName', label: 'Target Accounts Name', defaultWidth: 200, render: null /* set in columns memo */ },
  { key: 'divisions', label: 'Divisions', defaultWidth: 200, render: null /* set in columns memo */ },
  { key: 'otherReps', label: 'Other Reps', defaultWidth: 260, getFilterValue: (row) => (row.otherReps && row.otherReps.length ? [...new Set(row.otherReps.map(r => r.rep))].join(', ') : ''), render: (row) => {
    if (!row.otherReps || row.otherReps.length === 0) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>-</span>;
    // Deduplicate by rep name, collect all companies per rep
    const byRep = {};
    for (const r of row.otherReps) {
      const key = r.rep.toLowerCase();
      if (!byRep[key]) byRep[key] = { rep: r.rep, companies: [] };
      if (!byRep[key].companies.includes(r.company)) byRep[key].companies.push(r.company);
    }
    return <span style={{ display: 'flex', gap: '3px', flexWrap: 'nowrap', overflow: 'hidden' }}>
      {Object.values(byRep).map((r, i) => <span key={i} title={r.companies.join(', ')} style={{
        padding: '2px 6px', borderRadius: '4px', fontSize: '0.65rem',
        background: '#FEF9C3', color: '#92400E', lineHeight: 1.3, whiteSpace: 'nowrap', flexShrink: 0,
        cursor: 'default',
      }}>{r.rep}</span>)}
    </span>;
  }},
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
  { key: 'listFlags', label: 'Frameworks', defaultWidth: 220, render: null /* set in columns memo */ },
];

// Fuzzy company name matching — returns true if names are "close enough"
function companiesMatch(a, b) {
  const na = (a || '').toLowerCase().trim();
  const nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Ultra-tolerant equality. NFKD normalize, drop diacritics,
  // collapse non-alphanumeric runs to single spaces, lowercase,
  // and compare. Catches Unicode goblin diffs (non-breaking space,
  // smart-quote paren, em-dash) that break ===.
  const flatten = (s) => String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const fa = flatten(na);
  const fb = flatten(nb);
  if (fa && fb && fa === fb) return true;
  // Sorted-token-set equality so the match works regardless of
  // word order — catches "Teachers Insurance and Annuity
  // Association of America (TIAA)" vs "(TIAA) Teachers Insurance
  // and Annuity Association of America" where the tokens are the
  // same but the ordering differs.
  const STOP = new Set(['a', 'an', 'the', 'and', 'of', 'co', 'inc', 'llc', 'ltd', 'corp']);
  const sigTokens = (s) => flatten(s).split(' ').filter(t => t.length >= 2 && !STOP.has(t));
  const ta = sigTokens(na);
  const tb = sigTokens(nb);
  if (ta.length >= 2 && ta.length === tb.length) {
    const sortedA = [...ta].sort().join('|');
    const sortedB = [...tb].sort().join('|');
    if (sortedA === sortedB) return true;
  }
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
  // Acronym / single-token match. Catches the case where one side is
  // a short company name like "TIAA" and the other carries that as a
  // parenthesized abbreviation or leading token, e.g.
  // "(TIAA) Teachers Insurance and Annuity Association of America"
  // or "Jones Lang LaSalle (JLL)" vs "JLL". Treats parentheses as
  // word separators so the contents are first-class tokens.
  const tokensOf = (s) => s.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const sTokens = tokensOf(shorter);
  if (sTokens.length === 1 && sTokens[0].length >= 3) {
    if (tokensOf(longer).includes(sTokens[0])) return true;
  }
  return false;
}

function fuzzyHas(names, target) {
  for (const name of names) {
    if (companiesMatch(name, target)) return true;
  }
  return false;
}

// More permissive matcher for flagging Other Reps overlaps — matches on first-word
// e.g. "Carlyle" on someone else's list should flag "Carlyle Group" on yours
function otherRepMatch(a, b) {
  if (companiesMatch(a, b)) return true;
  const na = (a || '').toLowerCase().trim();
  const nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  const firstA = na.split(/[^a-z0-9]+/)[0] || '';
  const firstB = nb.split(/[^a-z0-9]+/)[0] || '';
  // Require 5+ chars in first word and they must match exactly
  if (firstA.length >= 5 && firstA === firstB) return true;
  return false;
}

// Target Accounts data is now passed as a prop from App.jsx


function DivisionPicker({ parentId, divisions, allCompanies, onAdd, onAddMany, onRemove, rules, onSetRule, onRemoveRule }) {
  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 });
  const [showRuleInput, setShowRuleInput] = useState(false);
  const [ruleText, setRuleText] = useState('');
  const anchorRef = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (anchorRef.current?.contains(e.target)) return;
      if (dropRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setDropPos({ top: rect.bottom + 2, left: rect.left });
  }, [open, inputText]);

  const parentRules = rules || [];
  const divisionIds = new Set(divisions.map(d => d.id));
  const filtered = inputText.trim()
    ? allCompanies.filter(c => c.id !== parentId && c.company.toLowerCase().includes(inputText.toLowerCase()))
    : [];

  const count = divisions.length;

  return (
    <span ref={anchorRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setInputText(''); setOpen(p => !p); }}
        style={{ fontSize: '0.72rem', cursor: 'pointer', background: count > 0 ? '#F0FDF4' : 'none', border: count > 0 ? '1px solid #BBF7D0' : '1px solid transparent', padding: '2px 8px', borderRadius: '4px', fontFamily: 'inherit', fontWeight: 500, color: count > 0 ? '#166534' : 'var(--color-accent)', whiteSpace: 'nowrap' }}
      >
        {count > 0 ? `${count} Division${count !== 1 ? 's' : ''}` : '+ Add'}
      </button>
      {open && createPortal(
        <div
          ref={dropRef}
          style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: '0.3rem', minWidth: '300px', maxHeight: '350px', zIndex: 9999, display: 'flex', flexDirection: 'column' }}
        >
          <input
            style={{ width: '100%', padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '0.75rem', fontFamily: 'inherit', marginBottom: '0.25rem', boxSizing: 'border-box' }}
            type="text"
            placeholder="Search companies to add..."
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            autoFocus
            onClick={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
          />
          {/* Auto-map rules */}
          {parentRules.length > 0 && (
            <div style={{ padding: '0.2rem 0.4rem', marginBottom: '0.25rem' }}>
              <div style={{ fontSize: '0.62rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.2rem' }}>Auto-Map Rules</div>
              {parentRules.map((rule, ri) => (
                <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.15rem 0.3rem', background: '#EFF6FF', borderRadius: '4px', marginBottom: '0.15rem', fontSize: '0.68rem' }}>
                  <span style={{ color: '#1D4ED8', fontWeight: 600 }}>Contains "{rule}"</span>
                  <span style={{ color: '#94a3b8', fontSize: '0.6rem' }}>({allCompanies.filter(c => c.id !== parentId && c.company.toLowerCase().includes(rule.toLowerCase())).length} matches)</span>
                  <button onClick={e => { e.stopPropagation(); onRemoveRule(parentId, ri); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem', lineHeight: 1 }} onMouseEnter={e => e.target.style.color = '#EF4444'} onMouseLeave={e => e.target.style.color = '#94a3b8'}>&times;</button>
                </div>
              ))}
            </div>
          )}
          {!showRuleInput ? (
            <button onClick={e => { e.stopPropagation(); setShowRuleInput(true); setRuleText(''); }} style={{ display: 'block', width: '100%', padding: '0.3rem', border: '1px dashed #CBD5E1', borderRadius: '4px', background: 'none', fontSize: '0.68rem', color: '#3B7DDD', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, marginBottom: '0.3rem' }}>
              + Auto-map by keyword
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.3rem', padding: '0 0.1rem' }}>
              <input
                type="text" value={ruleText} onChange={e => setRuleText(e.target.value)} placeholder='e.g. "Schneider"'
                style={{ flex: 1, padding: '0.25rem 0.4rem', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '0.7rem', fontFamily: 'inherit' }}
                autoFocus onClick={e => e.stopPropagation()}
                onKeyDown={e => { if (e.key === 'Enter' && ruleText.trim()) { onSetRule(parentId, ruleText.trim()); setRuleText(''); setShowRuleInput(false); } if (e.key === 'Escape') setShowRuleInput(false); }}
              />
              <button onClick={e => { e.stopPropagation(); if (ruleText.trim()) { onSetRule(parentId, ruleText.trim()); setRuleText(''); setShowRuleInput(false); } }} disabled={!ruleText.trim()} style={{ padding: '0.25rem 0.5rem', border: 'none', borderRadius: '4px', background: ruleText.trim() ? '#3B7DDD' : '#E2E8F0', color: '#fff', fontSize: '0.68rem', fontWeight: 600, cursor: ruleText.trim() ? 'pointer' : 'default', fontFamily: 'inherit' }}>Add</button>
              <button onClick={e => { e.stopPropagation(); setShowRuleInput(false); }} style={{ padding: '0.25rem 0.4rem', border: '1px solid #CBD5E1', borderRadius: '4px', background: '#fff', fontSize: '0.68rem', cursor: 'pointer', fontFamily: 'inherit', color: '#64748B' }}>Cancel</button>
            </div>
          )}
          <div style={{ overflowY: 'auto', maxHeight: '280px' }}>
            {divisions.length > 0 && (
              <div style={{ padding: '0.2rem 0.4rem', fontSize: '0.62rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '0.2rem' }}>Current Divisions</div>
            )}
            {divisions.map(d => (
              <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.5rem', fontSize: '0.72rem', cursor: 'pointer', borderRadius: '4px', color: '#166534' }}
                onMouseOver={e => e.currentTarget.style.background = '#f1f5f9'}
                onMouseOut={e => e.currentTarget.style.background = ''}
              >
                <input type="checkbox" checked onChange={() => onRemove(parentId, d.id)} style={{ accentColor: '#22C55E' }} onClick={e => e.stopPropagation()} />
                <span style={{ fontWeight: 500 }}>{d.company}</span>
              </label>
            ))}
            {inputText.trim() && filtered.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.2rem 0.4rem', marginTop: '0.3rem', borderTop: divisions.length > 0 ? '1px solid #f1f5f9' : 'none', paddingTop: '0.4rem' }}>
                <span style={{ fontSize: '0.62rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Search Results ({filtered.length})</span>
                {filtered.some(c => !divisionIds.has(c.id)) && (
                  <button
                    // One bulk write — adding them one at a time made each
                    // call build on the same pre-add settings, so only the
                    // last company in the batch survived.
                    onClick={e => { e.stopPropagation(); onAddMany(parentId, filtered.slice(0, 30).filter(c => !divisionIds.has(c.id))); }}
                    style={{ fontSize: '0.62rem', fontWeight: 600, color: '#3B7DDD', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '0.1rem 0.3rem' }}
                  >Select All</button>
                )}
              </div>
            )}
            {inputText.trim() && filtered.slice(0, 30).map(c => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.5rem', fontSize: '0.72rem', cursor: 'pointer', borderRadius: '4px', color: '#1e293b' }}
                onMouseOver={e => e.currentTarget.style.background = '#f1f5f9'}
                onMouseOut={e => e.currentTarget.style.background = ''}
              >
                <input type="checkbox" checked={divisionIds.has(c.id)} onChange={() => divisionIds.has(c.id) ? onRemove(parentId, c.id) : onAdd(parentId, c.id, c.company)} style={{ accentColor: '#22C55E' }} onClick={e => e.stopPropagation()} />
                <span style={{ fontWeight: 500 }}>{c.company}</span>
                {c.status && <span style={{ fontSize: '0.62rem', color: '#94a3b8' }}>{c.status}</span>}
              </label>
            ))}
            {inputText.trim() && filtered.length === 0 && <div style={{ padding: '0.4rem', fontSize: '0.7rem', color: '#94a3b8', textAlign: 'center' }}>No matches</div>}
            {!inputText.trim() && divisions.length === 0 && <div style={{ padding: '0.4rem', fontSize: '0.7rem', color: '#94a3b8', textAlign: 'center' }}>Type to search companies</div>}
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}

function TargetNamePicker({ values, companyId, companyName, targetOptions, onToggle, duplicates }) {
  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 });
  const anchorRef = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (anchorRef.current?.contains(e.target)) return;
      if (dropRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const dropHeight = 350;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    let top;
    if (spaceBelow >= dropHeight || spaceBelow >= spaceAbove) {
      top = rect.bottom + 2;
    } else {
      top = rect.top - Math.min(dropHeight, spaceAbove) - 2;
    }
    let left = rect.left;
    if (left + 300 > window.innerWidth) left = window.innerWidth - 310;
    setDropPos({ top, left });
  }, [open, inputText]);

  const selectedSet = new Set(values);
  const filtered = inputText.trim()
    ? targetOptions.filter(t => t.toLowerCase().includes(inputText.toLowerCase()))
    : [];

  const count = values.length;
  const hasDupe = duplicates && values.some(v => duplicates.has(v));

  return (
    <span ref={anchorRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setInputText(''); setOpen(p => !p); }}
        title={hasDupe ? values.filter(v => duplicates.has(v)).map(v => {
          const others = (duplicates.get(v) || []).filter(c => c !== companyName);
          return `"${v}" also mapped to: ${others.join(', ')}`;
        }).join('\n') : (count > 1 ? values.join('\n') : '')}
        style={{ fontSize: '0.72rem', cursor: 'pointer', background: hasDupe ? '#FEF3C7' : count > 0 ? '#EBF2FC' : 'none', border: hasDupe ? '1px solid #F59E0B' : count > 0 ? '1px solid #BFDBFE' : '1px solid transparent', padding: '2px 8px', borderRadius: '4px', fontFamily: 'inherit', fontWeight: 500, color: hasDupe ? '#92400E' : count > 0 ? '#1E40AF' : 'var(--color-accent)', textAlign: 'left', lineHeight: 1.3 }}
      >
        {hasDupe && <span style={{ marginRight: '0.25rem' }}>&#9888;</span>}
        {count === 0 ? '(Click to map)' : count === 1 ? values[0] : `${values[0]} +${count - 1} more`}
      </button>
      {open && createPortal(
        <div
          ref={dropRef}
          style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: '0.3rem', minWidth: '300px', maxHeight: '350px', zIndex: 9999, display: 'flex', flexDirection: 'column' }}
        >
          <input
            style={{ width: '100%', padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '0.75rem', fontFamily: 'inherit', marginBottom: '0.25rem', boxSizing: 'border-box' }}
            type="text"
            placeholder="Search target accounts..."
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            autoFocus
            onClick={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
          />
          <div style={{ overflowY: 'auto', maxHeight: '280px' }}>
            {values.length > 0 && (
              <div style={{ padding: '0.2rem 0.4rem', fontSize: '0.62rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '0.2rem' }}>Mapped Target Accounts</div>
            )}
            {values.map(v => (
              <label key={v} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.5rem', fontSize: '0.72rem', cursor: 'pointer', borderRadius: '4px', color: '#1E40AF' }}
                onMouseOver={e => e.currentTarget.style.background = '#f1f5f9'}
                onMouseOut={e => e.currentTarget.style.background = ''}
              >
                <input type="checkbox" checked onChange={() => onToggle(companyId, v)} style={{ accentColor: '#3B82F6' }} onClick={e => e.stopPropagation()} />
                <span style={{ fontWeight: 500 }}>{v}</span>
              </label>
            ))}
            {inputText.trim() && filtered.length > 0 && (
              <div style={{ padding: '0.2rem 0.4rem', fontSize: '0.62rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '0.3rem', borderTop: values.length > 0 ? '1px solid #f1f5f9' : 'none', paddingTop: '0.4rem' }}>Search Results</div>
            )}
            {inputText.trim() && filtered.map(t => (
              <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.5rem', fontSize: '0.72rem', cursor: 'pointer', borderRadius: '4px', color: '#1e293b' }}
                onMouseOver={e => e.currentTarget.style.background = '#f1f5f9'}
                onMouseOut={e => e.currentTarget.style.background = ''}
              >
                <input type="checkbox" checked={selectedSet.has(t)} onChange={() => onToggle(companyId, t)} style={{ accentColor: '#3B82F6' }} onClick={e => e.stopPropagation()} />
                <span style={{ fontWeight: 500 }}>{t}</span>
              </label>
            ))}
            {inputText.trim() && filtered.length === 0 && <div style={{ padding: '0.4rem', fontSize: '0.7rem', color: '#94a3b8', textAlign: 'center' }}>No matches</div>}
            {!inputText.trim() && values.length === 0 && <div style={{ padding: '0.4rem', fontSize: '0.7rem', color: '#94a3b8', textAlign: 'center' }}>Type to search target accounts</div>}
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}

function StatusMismatchWarning({ row, onUpdate }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const dropRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target) && dropRef.current && !dropRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <span ref={ref}>
      <span
        style={{ color: '#F59E0B', fontSize: '0.55rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
        onClick={e => { e.stopPropagation(); setOpen(p => !p); }}
      >&#9888; {row.suggestedStatus}</span>
      {open && createPortal(
        <div
          ref={dropRef}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: ref.current ? ref.current.getBoundingClientRect().bottom + 4 : 100,
            left: ref.current ? ref.current.getBoundingClientRect().left : 100,
            zIndex: 10000,
            background: '#fff', border: '1px solid var(--color-border)', borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '0.6rem 0.8rem', minWidth: '220px',
          }}
        >
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.3rem' }}>Status Suggestion</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
            Current: <strong>{row.status}</strong><br/>
            Opps suggests: <strong>{row.suggestedStatus}</strong>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexDirection: 'column' }}>
            <button
              onClick={() => { onUpdate(row.id, { status: row.suggestedStatus }); setOpen(false); }}
              title="Take the opps-derived My Accounts status and write it into the Table View row"
              style={{
                padding: '0.4rem 0.6rem', border: 'none', borderRadius: '6px',
                background: 'var(--color-accent)', color: '#fff', fontSize: '0.72rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Import Table View Status</button>
            <button
              onClick={() => { onUpdate(row.id, { hideStatusSuggestion: true }); setOpen(false); }}
              title="Keep the Table View status as-is and stop suggesting changes for this company"
              style={{
                padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px',
                background: '#fff', color: 'var(--color-text)', fontSize: '0.72rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Update Table View Status</button>
            <button
              onClick={() => { onUpdate(row.id, { dismissedSuggestedStatus: row.suggestedStatus }); setOpen(false); }}
              title="Dismiss this specific suggestion for now. It will reappear if the suggested status changes."
              style={{
                padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px',
                background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '0.72rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Ignore</button>
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}

// Drop-down warning when an account's Type doesn't match what the
// opps data implies (currently only 'Portfolio Company' triggered by
// a PE-Partner-sourced opp). Same UX pattern as StatusMismatchWarning.
function TypeMismatchWarning({ row, onUpdate }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const dropRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target) && dropRef.current && !dropRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <span ref={ref}>
      <span
        style={{ color: '#F59E0B', fontSize: '0.55rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
        onClick={e => { e.stopPropagation(); setOpen(p => !p); }}
        title={`Opps sourced from a PE Partner: suggest Type = "${row.suggestedType}"`}
      >&#9888; {row.suggestedType}</span>
      {open && createPortal(
        <div
          ref={dropRef}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: ref.current ? ref.current.getBoundingClientRect().bottom + 4 : 100,
            left: ref.current ? ref.current.getBoundingClientRect().left : 100,
            zIndex: 10000,
            background: '#fff', border: '1px solid var(--color-border)', borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '0.6rem 0.8rem', minWidth: '240px',
          }}
        >
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.3rem' }}>Type Suggestion</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
            Current: <strong>{row.type || '-'}</strong><br/>
            At least one opp has <strong>Source = PE Partner</strong>, which usually means{' '}
            <strong>{row.suggestedType}</strong>.
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexDirection: 'column' }}>
            <button
              onClick={() => { onUpdate(row.id, { type: row.suggestedType }); setOpen(false); }}
              title={`Set Type to "${row.suggestedType}"`}
              style={{
                padding: '0.4rem 0.6rem', border: 'none', borderRadius: '6px',
                background: 'var(--color-accent)', color: '#fff', fontSize: '0.72rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Set Type to {row.suggestedType}</button>
            <button
              onClick={() => { onUpdate(row.id, { hideTypeSuggestion: true }); setOpen(false); }}
              title="Keep the current Type and stop suggesting changes for this company"
              style={{
                padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px',
                background: '#fff', color: 'var(--color-text)', fontSize: '0.72rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Keep current Type</button>
            <button
              onClick={() => { onUpdate(row.id, { dismissedSuggestedType: row.suggestedType }); setOpen(false); }}
              title="Dismiss this suggestion for now. It will reappear if the suggested Type ever changes."
              style={{
                padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px',
                background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '0.72rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Ignore</button>
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}

function SimilarNamesWarning({ matches, onDismiss }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const badgeRef = useRef(null);
  const popoverRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = e => {
      const t = e.target;
      if (badgeRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  if (!matches || matches.length === 0) return null;
  return (
    <>
      <span
        ref={badgeRef}
        title={`${matches.length} similar name${matches.length === 1 ? '' : 's'} in Table View: click for details`}
        onClick={e => {
          e.stopPropagation();
          if (badgeRef.current) {
            const rect = badgeRef.current.getBoundingClientRect();
            setPos({ top: rect.bottom + 4, left: rect.left });
          }
          setOpen(p => !p);
        }}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', background: '#FEF3C7', border: '1px solid #F59E0B', color: '#92400E', fontSize: '0.62rem', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
      >⚠</span>
      {open && createPortal(
        <div
          ref={popoverRef}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000,
            background: '#fff', border: '1px solid var(--color-border)', borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '0.6rem 0.8rem', minWidth: '260px', maxWidth: '360px',
          }}
        >
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.3rem' }}>Similar names in Table View</div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem', maxHeight: 240, overflowY: 'auto' }}>
            {matches.map(m => (
              <li key={m.id || m.company} style={{ padding: '2px 0', borderBottom: '1px dashed #F1F5F9' }}>• {m.company}</li>
            ))}
          </ul>
          <button
            onClick={() => { onDismiss(); setOpen(false); }}
            style={{
              padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px',
              background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '0.72rem', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit', width: '100%',
            }}
          >Ignore this warning</button>
        </div>,
        document.body
      )}
    </>
  );
}

function TierMismatchWarning({ row, onApply, onDismiss }) {  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <span style={{ position: 'relative' }} ref={ref}>
      <span
        style={{ color: '#F59E0B', fontSize: '0.6rem', fontWeight: 600, cursor: 'pointer' }}
        title={`Target Accounts says ${row.targetTier}`}
        onClick={e => { e.stopPropagation(); setOpen(p => !p); }}
      >&#9888; {row.targetTier}</span>
      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: '4px',
            background: '#fff', border: '1px solid var(--color-border)', borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '0.6rem 0.8rem', minWidth: '220px',
          }}
        >
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.3rem' }}>Tier Mismatch</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
            Your tier: <strong>{row.myTier || '-'}</strong><br/>
            Target Accounts says: <strong>{row.targetTier}</strong>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <button
              onClick={() => { onApply(); setOpen(false); }}
              style={{
                padding: '0.4rem 0.6rem', border: 'none', borderRadius: '6px',
                background: 'var(--color-accent)', color: '#fff', fontSize: '0.72rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Update to {row.targetTier}</button>
            <button
              onClick={() => { onDismiss(); setOpen(false); }}
              style={{
                padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px',
                background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '0.72rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Dismiss</button>
          </div>
        </div>
      )}
    </span>
  );
}

// Hover popup attached to the Opps cell on the My Accounts table.
// Shows the actual opp records (Stage / Scope / Status / Quoted Amount /
// Start Date / Source) that fed the active/total counter, fuzzy-matches
// included. Open on mouseenter, close on mouseleave with a short delay
// so the user can move the cursor onto the popup itself without it
// vanishing mid-read.
function OppsHoverPopup({ row }) {
  const active = row.oppsCount || 0;
  const total = row.totalOpps || 0;
  const opps = row.feedingOpps || [];
  const wrapRef = useRef(null);
  const closeTimerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  function show() {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      const popupW = 560;
      const left = Math.min(window.innerWidth - popupW - 8, Math.max(8, r.right - popupW + 40));
      setPos({ top: r.bottom + 4, left });
    }
    setOpen(true);
  }
  function scheduleHide() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setOpen(false), 200);
  }

  if (total === 0) return <span style={{ color: 'var(--color-text-muted)' }}>0/0</span>;

  return (
    <span
      ref={wrapRef}
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
      style={{ fontWeight: 700, color: active > 0 ? '#7C3AED' : 'var(--color-text-secondary)', cursor: opps.length ? 'help' : 'default' }}
    >
      {active}/{total}
      {open && opps.length > 0 && createPortal(
        <div
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 10001,
            background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15,23,42,0.18)', padding: '0.55rem 0.7rem',
            minWidth: 480, maxWidth: 620, maxHeight: 360, overflowY: 'auto',
            color: 'var(--color-text)', fontSize: '0.7rem',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#475569', fontSize: '0.7rem' }}>
            {opps.length} opp{opps.length === 1 ? '' : 's'} feeding {active}/{total}
            <span style={{ fontWeight: 500, color: '#94A3B8', marginLeft: 6 }}>(active / total)</span>
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.66rem' }}>
            <thead>
              <tr style={{ color: '#64748B', fontWeight: 700 }}>
                <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' }}>Account</th>
                <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' }}>Stage</th>
                <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' }}>Scope</th>
                <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' }}>Status</th>
                <th style={{ textAlign: 'right', padding: '3px 6px', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' }}>Quoted</th>
                <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' }}>Start</th>
                <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' }}>Source</th>
              </tr>
            </thead>
            <tbody>
              {opps.map((o, i) => (
                <tr key={o._id ?? i}>
                  <td style={{ padding: '3px 6px', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }} title={o['Account']}>{o['Account'] || '-'}</td>
                  <td style={{ padding: '3px 6px', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{o['Stage'] || '-'}</td>
                  <td style={{ padding: '3px 6px', borderBottom: '1px solid #F1F5F9', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o['Scope']}>{o['Scope'] || '-'}</td>
                  <td style={{ padding: '3px 6px', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{o['Status'] || '-'}</td>
                  <td style={{ padding: '3px 6px', borderBottom: '1px solid #F1F5F9', textAlign: 'right', whiteSpace: 'nowrap' }}>{o['Quoted Amount'] || '-'}</td>
                  <td style={{ padding: '3px 6px', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{o['Start Date'] || '-'}</td>
                  <td style={{ padding: '3px 6px', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{o['Source'] || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
        document.body
      )}
    </span>
  );
}

function parseXlsx(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        // Pulled in on use: the spreadsheet library is ~140 KB gzipped and
        // this page only needs it when a file is actually imported.
        const XLSX = await import('xlsx');
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(ws));
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

// Fields offered in the My Accounts mass-edit toolbar. Dropdown fields
// carry their `options`; number fields set type:'number'; everything else
// is a free-text input. Keys match the prospect fields written via onUpdate.
const BULK_FIELDS = [
  { key: 'tier', label: 'Tier', options: TIERS },
  { key: 'status', label: 'Status', options: STATUSES },
  { key: 'type', label: 'Type', options: TYPES },
  { key: 'geography', label: 'Geography', options: GEOGRAPHIES },
  { key: 'publicPrivate', label: 'Public / Private', options: PUBLIC_PRIVATE },
  { key: 'hqRegion', label: 'HQ Region', options: ['North America', 'Outside of North America'] },
  { key: 'cdm', label: 'CDM' },
  { key: 'reAum', label: 'RE AUM', type: 'number' },
  { key: 'peAum', label: 'PE AUM', type: 'number' },
  { key: 'numberOfSites', label: '# Sites', type: 'number' },
  { key: 'rank', label: 'Rank' },
  { key: 'website', label: 'Website' },
  { key: 'emailDomain', label: 'Email Domain' },
  { key: 'notes', label: 'Notes' },
  { key: 'bfoCompanyId', label: 'BFO Company ID' },
  { key: 'bfoCompanyName', label: 'BFO Company Name' },
  { key: 'zoomCompanyId', label: 'Zoom Company ID' },
  { key: 'zoomCompanyName', label: 'Zoom Company Name' },
];

// Opps-only rows are synthetic (no backing prospect doc), so they can't be
// bulk-edited. Everything else keys off its real prospect id.
function isBulkSelectable(row) {
  return !!row?.id && !String(row.id).startsWith('opps-only:');
}

// Statuses that take an account out of active rotation. Module-scoped so
// both the filtered-view logic and the Issues-flag publisher share one set.
const INACTIVE_STATUSES = new Set(['Old Client', 'Hold Off', 'Lost - Not Sold']);

export function MyAccountsView({ prospects, onSelect, onUpdate, onDelete, onAdd, onFindDuplicates, onDedupe, targetAccountsData, settings, updateSettings, cdmName, mode }) {
  const { user, isAdmin } = useAuth();
  const savedView = settings?.viewFilters?.myAccounts;
  const [search, setSearch] = useState(savedView?.search || '');
  const [filters, setFilters] = useState(savedView?.filters || {});
  const [expandedBucket, setExpandedBucket] = useState(null);
  const [bucketFilter, setBucketFilter] = useState(savedView?.bucketFilter ?? null); // 'tier1' | 'tier2' | 'client' | 'pipeline' | null
  const [hqLookupRunning, setHqLookupRunning] = useState(false);
  const [dedupeRunning, setDedupeRunning] = useState(false);
  const [tierSyncRunning, setTierSyncRunning] = useState(false);
  // Rows the table is currently showing, after its in-table column filters.
  // Fed by DataTable so the Zoom Export button matches Export Excel.
  const [tableVisibleRows, setTableVisibleRows] = useState(null);
  const handleTableFilteredRows = useCallback(rows => setTableVisibleRows(rows), []);
  const [tier3BulkRunning, setTier3BulkRunning] = useState(false);
  // Mass edit: checkbox selection + a field/value applied to all selected rows.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkField, setBulkField] = useState('');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkRunning, setBulkRunning] = useState(false);
  const [inactiveMode, setInactiveMode] = useState(savedView?.inactiveMode || 'hide'); // 'hide' | 'only' | 'show'
  // Company Type subtab: the one Type the grouping is narrowed to, or null
  // for every type. Set by clicking a type card.
  const [typeFocus, setTypeFocus] = useState(null);
  // companyLowerName → Set<listLabel>. Built further below once
  // allAccounts is resolved; declared here so it's available while
  // building the row entries.
  const [listFlagsByCompany, setListFlagsByCompany] = useState(() => new Map());

  // HubSpot contact cache (IndexedDB-backed). Declared here near the top so
  // useMemos lower in the function body can safely reference it without TDZ.
  const [hubspotCache, setHubspotCacheState] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotCache().then(c => { if (!cancelled) setHubspotCacheState(c); }).catch(() => {});
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  // Master Site List → per-company site count AND the rows themselves.
  // Loaded once on mount from the same store the Master Site List tab
  // persists to, keyed on the trimmed, lowercased company name. The count
  // map drives the "MSL Sites" column; the rows map backs the popup that
  // opens when that count is clicked (both built from the same filter so the
  // clicked number always equals the number of rows shown).
  const [mslCountByCompany, setMslCountByCompany] = useState(() => new Map());
  const [mslRowsByCompany, setMslRowsByCompany] = useState(() => new Map());
  const [sitesPopup, setSitesPopup] = useState(null); // { company, rows } | null
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await loadList(MASTER_SITE_LIST_KEY);
        if (cancelled || !Array.isArray(rows)) return;
        const counts = new Map();
        const byCompany = new Map();
        for (const r of rows) {
          const c = String(r?.company || '').trim().toLowerCase();
          if (!c) continue;
          counts.set(c, (counts.get(c) || 0) + 1);
          if (!byCompany.has(c)) byCompany.set(c, []);
          byCompany.get(c).push(r);
        }
        setMslCountByCompany(counts);
        setMslRowsByCompany(byCompany);
      } catch { /* no master list yet — counts stay 0 */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Open the site-list popup for an account, gathering the Master Site List
  // rows across its parent company and any division names — the same set the
  // "MSL Sites" count is summed over, so the popup matches that number.
  function openSitesPopup(row) {
    const names = [
      String(row.company || '').trim().toLowerCase(),
      ...((divisionsMap[row.id] || []).map(d => String(d.company || '').trim().toLowerCase())),
    ];
    const seen = new Set();
    const rows = [];
    for (const name of names) {
      if (!name || seen.has(name)) continue;
      seen.add(name);
      for (const r of (mslRowsByCompany.get(name) || [])) rows.push(r);
    }
    setSitesPopup({ company: row.company || '-', rows });
  }

  // Download the popped-up company's sites as an .xlsx, using the Master Site
  // List's own canonical headers.
  async function exportSitesExcel(company, rows) {
    const data = (rows || []).map(r => {
      const o = {};
      MASTER_FIELDS.forEach((f, i) => { o[CANONICAL_HEADERS[i]] = r[f.key] || ''; });
      return o;
    });
    if (!data.length) { alert('No sites to export.'); return; }
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sites');
    const safe = String(company || 'sites').replace(/[^\w.-]+/g, '_').slice(0, 40) || 'sites';
    XLSX.writeFile(wb, `${safe}-sites.xlsx`);
  }

  // Hydrate filter state once settings arrive after login, then debounce-persist changes.
  const viewHydratedRef = useRef(!!savedView);
  useEffect(() => {
    if (viewHydratedRef.current) return;
    const s = settings?.viewFilters?.myAccounts;
    if (s) {
      if (s.search != null) setSearch(s.search);
      if (s.filters) setFilters(s.filters);
      if (s.bucketFilter !== undefined) setBucketFilter(s.bucketFilter);
      if (s.inactiveMode) setInactiveMode(s.inactiveMode);
      viewHydratedRef.current = true;
    }
  }, [settings]);
  const viewSaveTimerRef = useRef(null);
  useEffect(() => {
    if (!updateSettings || !viewHydratedRef.current) return;
    clearTimeout(viewSaveTimerRef.current);
    viewSaveTimerRef.current = setTimeout(() => {
      const current = settings?.viewFilters || {};
      updateSettings({
        viewFilters: {
          ...current,
          myAccounts: { search, filters, bucketFilter, inactiveMode },
        },
      });
    }, 600);
    return () => clearTimeout(viewSaveTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filters, bucketFilter, inactiveMode]);
  const hideMismatch = settings.hideMismatch ?? false;
  const targetMap = settings.targetMap || {};
  const hqRegionMap = settings.hqRegionMap || {};
  const divisionsMap = settings.divisionsMap || {};
  const divisionRules = settings.divisionRules || {};

  async function bulkLookupHqRegion(onlyMissing = false) {
    let companies;
    if (onlyMissing) {
      companies = prospects.filter(p => p.company && !hqRegionMap[p.id]).map(p => p.company);
    } else {
      companies = prospects.map(p => p.company).filter(Boolean);
    }
    if (companies.length === 0) return;
    setHqLookupRunning(true);
    try {
      const res = await apiFetch('/api/hq-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companies }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      // Start fresh when doing full lookup (not onlyMissing)
      const next = onlyMissing ? { ...hqRegionMap } : {};
      for (const [company, info] of Object.entries(json.results || {})) {
        const p = prospects.find(pr => pr.company === company);
        if (p && info.location) {
          next[p.id] = info.location;
        }
      }
      updateSettings({ hqRegionMap: next });
    } catch (err) {
      console.error('HQ lookup failed:', err);
    } finally {
      setHqLookupRunning(false);
    }
  }

  // Auto-detect HQ region for new accounts that don't have one set and don't have hqRegion
  useEffect(() => {
    const missing = prospects.filter(p => p.company && !hqRegionMap[p.id] && !p.hqRegion);
    if (missing.length > 0 && !hqLookupRunning) {
      bulkLookupHqRegion(true);
    }
  }, [prospects.length]);

  function clearHqLocations() {
    updateSettings({ hqRegionMap: {} });
  }

  // Find and remove duplicate prospect records (same company stored as
  // two+ documents). Previews the count first, then collapses each set
  // into its most complete record on confirm. Fixes duplicates that
  // surface across every page, since they all read the same collection.
  async function handleDedupe() {
    if (!onFindDuplicates || !onDedupe || dedupeRunning) return;
    setDedupeRunning(true);
    try {
      const groups = await onFindDuplicates();
      const extra = groups.reduce((s, g) => s + (g.docs.length - 1), 0);
      if (extra === 0) {
        alert('No duplicate accounts found.');
        return;
      }
      const sample = groups.slice(0, 12).map(g => `• ${g.docs[0].company} (${g.docs.length} copies)`).join('\n');
      const more = groups.length > 12 ? `\n…and ${groups.length - 12} more` : '';
      const ok = window.confirm(
        `Found ${extra} duplicate record${extra === 1 ? '' : 's'} across ${groups.length} ${groups.length === 1 ? 'company' : 'companies'}:\n\n${sample}${more}\n\n` +
        'Remove the extra copies, keeping the most complete record for each (and backfilling any missing fields from the copies)?\n\nThis cannot be undone.'
      );
      if (!ok) return;
      const result = await onDedupe();
      alert(`Removed ${result.removed} duplicate record${result.removed === 1 ? '' : 's'} across ${result.groups} ${result.groups === 1 ? 'company' : 'companies'}.`);
    } catch (err) {
      console.error('De-dupe failed:', err);
      alert('De-dupe failed: ' + (err?.message || err));
    } finally {
      setDedupeRunning(false);
    }
  }

  const zoomFileRef = useRef(null);
  const [zoomImportPreview, setZoomImportPreview] = useState(null); // { rows, headers, mapping }

  const ZOOM_FIELDS = [
    { key: 'zoomCompanyName', label: 'Zoom Company Name', keywords: ['zoom', 'company name', 'zooom'] },
    { key: 'zoomCompanyId', label: 'Zoom Company ID', keywords: ['zoom company id', 'zoom id', 'company id'] },
    { key: 'matchCompany', label: 'Match to Account Name', keywords: ["dan's account", 'account name', 'account', 'company'] },
    { key: 'website', label: 'Website', keywords: ['website', 'url', 'domain'] },
  ];

  async function handleZoomFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await parseXlsx(file);
      if (rows.length === 0) { alert('No data found'); return; }
      const headers = Object.keys(rows[0]);
      // Auto-detect mapping
      const mapping = {};
      for (const field of ZOOM_FIELDS) {
        let best = '';
        for (const h of headers) {
          const lower = h.toLowerCase();
          for (const kw of field.keywords) {
            if (lower.includes(kw)) { best = h; break; }
          }
          if (best) break;
        }
        mapping[field.key] = best;
      }
      setZoomImportPreview({ rows, headers, mapping });
    } catch (err) {
      alert('Failed to read file: ' + err.message);
    }
    e.target.value = '';
  }

  function executeZoomImport() {
    if (!zoomImportPreview) return;
    const { rows, mapping } = zoomImportPreview;
    const nameCol = mapping.zoomCompanyName;
    const idCol = mapping.zoomCompanyId;
    const matchCol = mapping.matchCompany;
    if (!nameCol && !matchCol) { alert('Please map at least a company name column'); return; }

    let matched = 0;
    for (const row of rows) {
      const zoomName = nameCol ? (row[nameCol] || '').trim() : '';
      const zoomId = idCol ? String(row[idCol] || '').trim() : '';
      const matchName = matchCol ? (row[matchCol] || '').trim() : zoomName;
      if (!matchName) continue;
      const prospect = prospects.find(p => companiesMatch(p.company, matchName));
      if (prospect) {
        const updates = {};
        if (zoomName) updates.zoomCompanyName = zoomName;
        if (zoomId) updates.zoomCompanyId = zoomId;
        if (Object.keys(updates).length > 0) {
          onUpdate(prospect.id, updates);
          matched++;
        }
      }
    }
    setZoomImportPreview(null);
    alert(`Zoom import complete: ${matched} accounts updated`);
  }

  function toggleTargetMapping(companyId, targetName) {
    const next = { ...targetMap };
    const existing = Array.isArray(next[companyId]) ? next[companyId] : (next[companyId] ? [next[companyId]] : []);
    if (existing.includes(targetName)) {
      const updated = existing.filter(n => n !== targetName);
      // Store empty array (not undefined) so fuzzy fallback doesn't re-match
      next[companyId] = updated;
    } else {
      next[companyId] = [...existing, targetName];
    }
    updateSettings({ targetMap: next });
  }

  // Division mutations live in utils/divisions.js so this column and the
  // company popup's Divisions section write the mapping the same way.
  function addDivision(parentId, childId, childCompany) {
    updateSettings(addDivisionPatch(settings, parentId, { id: childId, company: childCompany }));
  }

  function addDivisions(parentId, children) {
    updateSettings(addDivisionsPatch(settings, parentId, children));
  }

  function addDivisionRule(parentId, keyword) {
    updateSettings(addDivisionRulePatch(settings, parentId, keyword, prospects));
  }

  function removeDivisionRule(parentId, ruleIndex) {
    updateSettings(removeDivisionRulePatch(settings, parentId, ruleIndex));
  }

  function removeDivision(parentId, childId) {
    updateSettings(removeDivisionPatch(settings, parentId, childId));
  }

  // All companies for division picker (from all prospects, not just My Accounts)
  const allCompaniesForDivisions = useMemo(() => {
    return prospects.map(p => ({ id: p.id, company: p.company, status: p.status })).sort((a, b) => (a.company || '').localeCompare(b.company || ''));
  }, [prospects]);

  function toggleFilter(key, value) {
    setFilters(prev => {
      const arr = prev[key] || [];
      return { ...prev, [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] };
    });
  }

  function clearFilters() {
    setFilters({});
    setSearch('');
    setBucketFilter(null);
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

    const skippedAccounts = [];
    for (const sheetName of data.sheetNames || []) {
      const sheet = data.sheets[sheetName];
      if (!sheet?.records) continue;
      if (sheet.headers) console.log(`Target Accounts sheet "${sheetName}" columns:`, sheet.headers.filter(Boolean));

      const cdmLastName = (cdmName || '').toLowerCase().split(/\s+/).filter(Boolean).pop() || '';
      for (const r of sheet.records) {
        const companyForLog = findCol(r, ['Account', 'Company', 'Account Name', 'Client', 'Name']);
        let cdm = resolveTargetAccountCdm(r, settings?.targetCdmColumn).toLowerCase();
        if (!cdm && cdmLastName) {
          cdm = Object.values(r).find(v => String(v || '').toLowerCase().includes(cdmLastName)) || '';
          cdm = String(cdm).toLowerCase();
        }
        if (!matchesCdm(cdm, cdmName)) {
          if (companyForLog) skippedAccounts.push({ company: companyForLog, reason: `CDM="${cdm}" (not ${cdmName || 'configured CDM'})` });
          continue;
        }
        let tier = findCol(r, ['Tier', 'Account Tier', 'Tier Level', 'Target']);
        if (!tier) {
          tier = Object.values(r).find(v => /Tier\s*[12]/i.test(String(v || ''))) || '';
          tier = String(tier);
        }
        if (!tier.match(/(Tier\s*)?[12]/i)) {
          if (companyForLog) skippedAccounts.push({ company: companyForLog, reason: `Tier="${tier}" (not Tier 1/2)` });
          continue;
        }
        const company = findCol(r, ['Account', 'Company', 'Account Name', 'Client', 'Name']);
        if (!company) continue;
        const normalizedTier = tier.match(/1/) ? 'Tier 1' : 'Tier 2';
        accounts.push({ company: company.trim(), tier: normalizedTier, ...r });
      }
    }
    console.log(`Target Accounts: found ${accounts.length} ${cdmName || 'CDM'} Tier 1/2 accounts`);
    if (skippedAccounts.length > 0) console.log('Target Accounts SKIPPED:', skippedAccounts);
    return accounts;
  }, [targetAccountsData, cdmName, settings?.targetCdmColumn]);

  // All-tier view of the CDM's Target Accounts — same rows as
  // `targetAccounts` above, but WITHOUT the Tier 1/2 restriction and with
  // a tier normalizer that keeps Tier 3+. Used only to surface a tier
  // mismatch when an account that's already in My Accounts sits at Tier 3
  // (or lower) on the Targets list. The Tier 1/2 `targetAccounts` still
  // drives the target book, the missing-target buckets, and the 'Target
  // List' source badge, so those are unchanged.
  const targetAccountTiers = useMemo(() => {
    const data = targetAccountsData;
    if (!data?.sheets) return [];
    const findCol = (r, keywords) => {
      for (const key of Object.keys(r)) {
        const lower = key.toLowerCase();
        for (const kw of keywords) {
          if (lower.includes(kw.toLowerCase())) return String(r[key] || '').trim();
        }
      }
      return '';
    };
    const cdmLastName = (cdmName || '').toLowerCase().split(/\s+/).filter(Boolean).pop() || '';
    const out = [];
    for (const sheetName of data.sheetNames || []) {
      const sheet = data.sheets[sheetName];
      if (!sheet?.records) continue;
      for (const r of sheet.records) {
        let cdm = resolveTargetAccountCdm(r, settings?.targetCdmColumn).toLowerCase();
        if (!cdm && cdmLastName) {
          cdm = String(Object.values(r).find(v => String(v || '').toLowerCase().includes(cdmLastName)) || '').toLowerCase();
        }
        if (!matchesCdm(cdm, cdmName)) continue;
        const company = findCol(r, ['Account', 'Company', 'Account Name', 'Client', 'Name']);
        if (!company) continue;
        let tierRaw = findCol(r, ['Tier', 'Account Tier', 'Tier Level', 'Target']);
        if (!tierRaw) tierRaw = String(Object.values(r).find(v => /Tier\s*[1-9]/i.test(String(v || ''))) || '');
        const m = tierRaw.match(/(?:Tier\s*)?([1-9])/i);
        if (!m) continue;
        out.push({ company: company.trim(), tier: `Tier ${m[1]}` });
      }
    }
    return out;
  }, [targetAccountsData, cdmName, settings?.targetCdmColumn]);

  // Same all-tier parse as `targetAccountTiers`, but WITHOUT the CDM
  // filter. Used ONLY as a fallback resolver for the tier-mismatch flag:
  // an account that's already in My Accounts should still surface a
  // Targets-list tier difference even when the workbook row carrying the
  // tier isn't attributed to the configured CDM (a blank owner cell, or an
  // account tiered under another rep). The account is already "yours" by
  // the time the mismatch is computed, so the owner column shouldn't gate
  // the *warning*. Deliberately never feeds the target book, the
  // missing-target buckets, or the 'Target List' source badge.
  const targetAccountTiersAllReps = useMemo(() => {
    const data = targetAccountsData;
    if (!data?.sheets) return [];
    const findCol = (r, keywords) => {
      for (const key of Object.keys(r)) {
        const lower = key.toLowerCase();
        for (const kw of keywords) {
          if (lower.includes(kw.toLowerCase())) return String(r[key] || '').trim();
        }
      }
      return '';
    };
    const out = [];
    for (const sheetName of data.sheetNames || []) {
      const sheet = data.sheets[sheetName];
      if (!sheet?.records) continue;
      for (const r of sheet.records) {
        const company = findCol(r, ['Account', 'Company', 'Account Name', 'Client', 'Name']);
        if (!company) continue;
        let tierRaw = findCol(r, ['Tier', 'Account Tier', 'Tier Level', 'Target']);
        if (!tierRaw) tierRaw = String(Object.values(r).find(v => /Tier\s*[1-9]/i.test(String(v || ''))) || '');
        const m = tierRaw.match(/(?:Tier\s*)?([1-9])/i);
        if (!m) continue;
        out.push({ company: company.trim(), tier: `Tier ${m[1]}` });
      }
    }
    return out;
  }, [targetAccountsData]);

  // All Target Accounts with their salesperson (for cross-rep detection)
  const allTargetReps = useMemo(() => {
    const data = targetAccountsData;
    if (!data?.sheets) return [];
    const results = [];
    // Prefer the explicitly mapped "New Sales rep" column, then the
    // mapped salesperson/CDM column, then a keyword guess. The New Sales
    // column wins because that's the rep this badge is meant to surface;
    // without a mapping the scan can grab a current-rep column sitting to
    // the left of the New Sales column.
    const repCol = String(settings?.targetRepColumn || '').trim() || String(settings?.targetCdmColumn || '').trim();

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
      for (const r of sheet.records) {
        const company = findCol(r, ['Account', 'Company', 'Account Name', 'Client', 'Name']);
        if (!company) continue;
        // Prefer the mapped column when this sheet carries it; otherwise
        // fall back to the keyword scan so sheets without that column
        // still resolve a rep.
        const rep = resolveTargetAccountCdm(r, repCol);
        if (!rep) continue;
        // Skip the current user's own entries — we only want OTHER reps here
        if (matchesCdm(rep, cdmName)) continue;
        results.push({ company: company.trim(), rep: rep.trim() });
      }
    }
    return results;
  }, [targetAccountsData, cdmName, settings?.targetRepColumn, settings?.targetCdmColumn]);

  // Load activity cache and count per company
  const activityByCompany = useMemo(() => {
    const counts = {};
    try {
      const cache = JSON.parse(userLsGet('hubspot-activity-cache'));
      if (!cache) return counts;

      // Build domain→company map from prospects
      const domainMap = new Map();
      const contactMap = new Map();
      for (const c of (hubspotCache?.contacts || [])) {
        if (c.email && c.company) contactMap.set(c.email.toLowerCase(), c.company.toLowerCase());
      }
      for (const p of prospects) {
        if (p.emailDomain) {
          // Support multiple email domains separated by newlines, semicolons, or commas
          const entries = p.emailDomain.split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
          for (const entry of entries) {
            const atIdx = entry.lastIndexOf('@');
            const domain = atIdx >= 0 ? entry.slice(atIdx + 1).toLowerCase() : entry.toLowerCase();
            if (domain && p.company) domainMap.set(domain, p.company.toLowerCase());
          }
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
  }, [prospects, hubspotCache]);

  // Load opps data. Priority: IndexedDB (fresh from Opps tab) -> localStorage
  // -> Firestore (synced across devices by Opps tab). The Firestore fallback
  // matters when the user hasn't visited the Opps tab in this browser yet —
  // without it, My Accounts would be missing every opps-derived company.
  const [oppsRecords, setOppsRecords] = useState([]);
  useEffect(() => {
    let cancelled = false;
    async function loadFromIndexedDB() {
      try {
        const data = await loadOppsFromCache();
        return data?.records || null;
      } catch { return null; }
    }
    async function loadFromFirestore() {
      // Opps 2 is the canonical store — fall back to its Firestore
      // doc when local IDB is empty (e.g. fresh browser, never
      // opened Opps 2 here yet).
      if (!user?.uid) return null;
      try {
        const ref = doc(db, 'opps2Data', user.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) return null;
        const raw = snap.data();
        if (!raw?.json) return null;
        const parsed = JSON.parse(raw.json);
        return parsed?.records || null;
      } catch { return null; }
    }
    (async () => {
      let records = await loadFromIndexedDB();
      if (!records || records.length === 0) records = await loadFromFirestore();
      if (!cancelled && records && records.length > 0) setOppsRecords(records);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const { activeOppsByAccount, totalOppsByAccount, openOppsByAccount, suggestedStatusByAccount, displayNameByAccount, pePartnerAccountSet, oppsRecordsByAccount } = useMemo(() => {
    const active = {};
    const total = {};
    const open = {}; // non-closed, non-invalid opps (for Tier 3 inclusion)
    const stagesByAccount = {};
    const displayName = {}; // lowercase key -> original-case name (first seen)
    const peSet = new Set(); // lowercase account names with any opp tagged Source = PE Partner
    const recordsByAccount = {}; // lowercase account -> array of opp records (used for the hover popup on the My Accounts Opps cell)
    if (oppsRecords.length === 0) return { activeOppsByAccount: active, totalOppsByAccount: total, openOppsByAccount: open, suggestedStatusByAccount: {}, displayNameByAccount: displayName, pePartnerAccountSet: peSet, oppsRecordsByAccount: recordsByAccount };
    const closedStages = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
    for (const r of oppsRecords) {
      const rawAccount = (r['Account'] || '').trim();
      const account = rawAccount.toLowerCase();
      const stage = (r['Stage'] || '').trim();
      if (!account) continue;
      if (!displayName[account]) displayName[account] = rawAccount;

      // Track stage breakdown for status suggestion
      if (!stagesByAccount[account]) stagesByAccount[account] = { sold: 0, notSold: 0, active: 0 };
      const invalidStages = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);
      const stageLower = stage.toLowerCase();
      if (stageLower === 'sold' || stageLower === 'won' || stageLower === 'closed won' || stageLower === 'sold - won') {
        stagesByAccount[account].sold++;
      } else if (stageLower === 'not sold' || stageLower === 'lost' || stageLower === 'closed lost' || stageLower === 'lost - not sold') {
        stagesByAccount[account].notSold++;
      } else if (stage && !closedStages.has(stage) && !invalidStages.has(stage)) {
        stagesByAccount[account].active++;
      }

      // Track PE Partner-sourced opps so we can nudge the account's
      // Type toward 'Portfolio Company' when it isn't already.
      const sourceVal = String(r['Source'] || '').trim().toLowerCase();
      if (sourceVal.includes('pe partner') || sourceVal === 'pe partner') peSet.add(account);

      // Count all opps (including closed) in total, only open in active
      if (!invalidStages.has(stage)) {
        total[account] = (total[account] || 0) + 1;
        if (!recordsByAccount[account]) recordsByAccount[account] = [];
        recordsByAccount[account].push(r);
      }
      if (!closedStages.has(stage) && !invalidStages.has(stage)) {
        open[account] = (open[account] || 0) + 1;
        const callIn = (r['Call In'] || '').trim();
        if (callIn && callIn !== '-' && callIn !== '0') {
          active[account] = (active[account] || 0) + 1;
        }
      }
    }

    // Build suggested status per account
    // Sold deals always take priority → Client
    const suggested = {};
    for (const [account, stages] of Object.entries(stagesByAccount)) {
      if (stages.sold > 0) {
        suggested[account] = 'Client';
      } else if (stages.active > 0) {
        suggested[account] = 'Qualifying';
      } else if (stages.notSold > 0) {
        suggested[account] = 'Lost - Not Sold';
      }
    }

    // Debug: log all accounts containing pnc — gated behind
    // localStorage.debug-myaccounts so production runs don't flood
    // the console (and crush the main thread) every render.
    let DBG_OPPS = false;
    try { DBG_OPPS = !!(typeof localStorage !== 'undefined' && localStorage.getItem('debug-myaccounts')); } catch {}
    if (DBG_OPPS) {
      for (const [account, stages] of Object.entries(stagesByAccount)) {
        if (account.includes('pnc') || account.includes('hellman')) {
          console.log(`Opps debug "${account}": sold=${stages.sold}, notSold=${stages.notSold}, active=${stages.active} → suggested: ${suggested[account]}`);
          const opps = oppsRecords.filter(r => (r['Account'] || '').toLowerCase() === account);
          opps.forEach(r => console.log(`  Opp: Stage="${r['Stage']}", Account="${r['Account']}"`));
        }
      }
      const soldOpps = oppsRecords.filter(r => (r['Stage'] || '').toLowerCase().includes('sold') || (r['Stage'] || '').toLowerCase().includes('won'));
      console.log('All Sold/Won opps:', soldOpps.map(r => `"${r['Account']}" Stage="${r['Stage']}"`));
    }

    return { activeOppsByAccount: active, totalOppsByAccount: total, openOppsByAccount: open, suggestedStatusByAccount: suggested, displayNameByAccount: displayName, pePartnerAccountSet: peSet, oppsRecordsByAccount: recordsByAccount };
  }, [oppsRecords]);

  // Dismissed companies — companies the user manually deleted that should not be auto-recreated
  const dismissedCompanies = settings.dismissedCompanies || [];
  const [showDismissed, setShowDismissed] = useState(false);

  function undismissCompany(companyName) {
    const current = settings.dismissedCompanies || [];
    updateSettings({ dismissedCompanies: current.filter(d => d !== companyName) });
  }

  // Log for debugging
  useEffect(() => {
    if (dismissedCompanies.length > 0) console.log('Dismissed companies:', dismissedCompanies);
  }, [dismissedCompanies.length]);

  function dismissCompany(companyName) {
    const lower = (companyName || '').toLowerCase().trim();
    if (!lower) return;
    const current = settings.dismissedCompanies || [];
    if (current.some(d => d.toLowerCase() === lower)) return;
    updateSettings({ dismissedCompanies: [...current, companyName] });
  }

  function isDismissed(companyName) {
    const lower = (companyName || '').toLowerCase().trim();
    if (!lower) return false;
    return dismissedCompanies.some(d => (d || '').toLowerCase().trim() === lower);
  }

  // Auto-create prospects for opps companies with OPEN opps not already in Table View
  const autoCreateRanRef = useRef(new Set()); // track which companies we've already created
  useEffect(() => {
    if (!onAdd || Object.keys(openOppsByAccount).length === 0 || prospects.length === 0) return;
    const existingLower = new Set(prospects.map(p => (p.company || '').toLowerCase()));
    const missing = [];
    console.log('Auto-create check: openOpps accounts:', Object.keys(openOppsByAccount).length, 'prospects:', prospects.length, 'dismissed:', dismissedCompanies.length);
    for (const oppsCompany of Object.keys(openOppsByAccount)) {
      if (!oppsCompany) continue;
      // Skip dismissed companies
      if (isDismissed(oppsCompany)) { console.log('  Skipping dismissed:', oppsCompany); continue; }
      let found = false;
      for (const existing of existingLower) {
        if (companiesMatch(existing, oppsCompany)) { found = true; break; }
      }
      if (!found && !autoCreateRanRef.current.has(oppsCompany)) {
        // Find the original cased name from opps records
        const original = oppsRecords.find(r => (r['Account'] || '').toLowerCase() === oppsCompany);
        const name = original ? original['Account'] : oppsCompany;
        missing.push({ key: oppsCompany, name });
      }
    }
    if (missing.length > 0) {
      console.log(`Auto-creating ${missing.length} prospects from opps:`, missing.map(m => m.name));
      for (const { key, name } of missing) {
        autoCreateRanRef.current.add(key);
        onAdd({ company: name, status: 'Inside Sales', tier: '', type: '', geography: '', publicPrivate: '', assetTypes: [], peAum: null, reAum: null, numberOfSites: null, rank: '', hqRegion: '', frameworks: [], notes: '', website: '', emailDomain: '', cdm: cdmName || '' });
      }
    }
  }, [openOppsByAccount, prospects.length, cdmName]);

  // Clean up auto-created prospects that no longer have open opps and have no tier
  useEffect(() => {
    if (!onDelete || Object.keys(openOppsByAccount).length === 0 || prospects.length === 0) return;
    for (const p of prospects) {
      // Only clean up accounts with no tier set (auto-created Tier 3 candidates)
      if (p.tier) continue;
      const companyLower = (p.company || '').toLowerCase();
      let hasOpenOpp = false;
      for (const [oppsCompany, count] of Object.entries(openOppsByAccount)) {
        if (count > 0 && companiesMatch(companyLower, oppsCompany)) { hasOpenOpp = true; break; }
      }
      if (!hasOpenOpp) {
        // Check if it has any data worth keeping (contacts, notes, etc.)
        if (!p.notes && !p.website && !p.emailDomain && !p.zoomCompanyName) {
          console.log(`Cleaning up auto-created prospect: ${p.company}`);
          onDelete(p.id);
        }
      }
    }
  }, [openOppsByAccount, prospects.length]);

  // Build source maps: which companies exist in each data source
  const BUCKET_TAGS = ['esg', 'procurement', 'utilities', 'climate risk', 'capital planning'];

  // Background-refresh contacts from HubSpot when My Accounts loads.
  // /api/hubspot uses a single server-side token tied to the admin's
  // portal, so non-admins can't usefully populate the cache — skip the
  // call rather than thrash a 401.
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const res = await apiFetch('/api/hubspot?action=contacts');
        const json = await res.json();
        if (json.contacts) {
          // Slim each contact to essential fields to keep the cache compact.
          const slimContacts = json.contacts.map(c => ({
            id: c.id, vid: c.vid, firstname: c.firstname, lastname: c.lastname,
            email: c.email, phone: c.phone, jobtitle: c.jobtitle, company: c.company,
            hs_linkedin_url: c.hs_linkedin_url, linkedin_url: c.linkedin_url, hs_linkedinid: c.hs_linkedinid,
            city: c.city, state: c.state, country: c.country,
            dans_tags: c.dans_tags, dan_s_tags: c.dan_s_tags, dans_tag: c.dans_tag,
            decision_maker: c.decision_maker, role: c.role,
            hs_sequences_is_enrolled: c.hs_sequences_is_enrolled,
            notes_last_contacted: c.notes_last_contacted,
          }));
          try {
            await setHubspotCachePreservingManual({ ...json, contacts: slimContacts, syncedAt: new Date().toISOString() });
          } catch (err) {
            console.warn('HubSpot cache write failed:', err.message);
          }
        }
      } catch {}
    })();
  }, [isAdmin]);

  const { hubspotCompanies, decisionMakerByCompany, contactsByCompany, bucketsByCompany, contactsByEmailDomain, bucketsByEmailDomain, linkableContactById } = useMemo(() => {
    const list = [];
    const dmMap = {}; // company lowercase → [names]
    const contactsMap = {}; // company lowercase → Set<contactId>
    const linkMap = {}; // contact id|vid → cid (non-hidden only)
    const bucketMap = {}; // company lowercase → Set of matched bucket tags
    // Email-domain-keyed parallels so a prospect can pick up
    // contacts whose Company text is "TIAA" / "TIAA-CREF" / blank
    // when the prospect has tiaa.org registered under emailDomain
    // or website.
    const domainContacts = {}; // domain → Set<contactId>
    const domainBuckets = {}; // domain → Set of bucket tags
    try {
      const cache = hubspotCache;
      const seen = new Set();
      const FREE = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com']);
      for (const c of (cache?.contacts || [])) {
        const contactTags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
        const isHidden = contactTags.includes('hide');
        const cid = c.id || c.email || (c.firstname + '|' + c.lastname);
        const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').split(';').map(t => t.trim().toLowerCase()).filter(Boolean);
        const lower = (c.company || '').toLowerCase();
        // Index non-hidden contacts by HubSpot id so the account contact
        // count can also include people explicitly pinned to a company
        // (settings.companyContactLinks) — mirroring the popup — even when
        // their Company text doesn't match. Keyed by id|vid like the popup
        // stores links; value is the canonical cid so dedup still works.
        if (!isHidden) {
          const linkId = String(c.id || c.vid || '');
          if (linkId) linkMap[linkId] = cid;
        }
        if (lower) {
          if (!seen.has(lower)) { seen.add(lower); list.push(lower); }
          if (!isHidden) {
            if (!contactsMap[lower]) contactsMap[lower] = new Set();
            contactsMap[lower].add(cid);
            if (!bucketMap[lower]) bucketMap[lower] = new Set();
            for (const tag of tags) {
              if (BUCKET_TAGS.includes(tag)) bucketMap[lower].add(tag);
            }
          }
        }
        if (lower && !isHidden && contactTags.includes('decision maker')) {
          const name = [c.firstname, c.lastname].filter(Boolean).join(' ');
          if (!dmMap[lower]) dmMap[lower] = [];
          dmMap[lower].push(name || c.email || 'Unknown');
        }
        if (!isHidden && c.email) {
          const at = c.email.lastIndexOf('@');
          if (at >= 0) {
            const domain = c.email.slice(at + 1).toLowerCase().trim();
            if (domain && !FREE.has(domain)) {
              if (!domainContacts[domain]) domainContacts[domain] = new Set();
              domainContacts[domain].add(cid);
              if (!domainBuckets[domain]) domainBuckets[domain] = new Set();
              for (const tag of tags) {
                if (BUCKET_TAGS.includes(tag)) domainBuckets[domain].add(tag);
              }
            }
          }
        }
      }
    } catch {}
    return {
      hubspotCompanies: list,
      decisionMakerByCompany: dmMap,
      contactsByCompany: contactsMap,
      bucketsByCompany: bucketMap,
      contactsByEmailDomain: domainContacts,
      bucketsByEmailDomain: domainBuckets,
      linkableContactById: linkMap,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospects, hubspotCache]);

  const targetCompanies = useMemo(() => {
    const seen = new Set();
    return targetAccounts.map(t => (t.company || '').toLowerCase()).filter(c => { if (!c || seen.has(c)) return false; seen.add(c); return true; });
  }, [targetAccounts]);

  const { tier1, tier2, allAccounts, statusCounts } = useMemo(() => {
    const t1 = [];
    const t2 = [];
    const counts = {};

    // Precomputed indices over the per-prospect inner-loop data sources.
    // Each used to be O(prospects × keys) via companiesMatch in a nested
    // loop; the index lookup turns each per-prospect query into ~O(1).
    const oppsIndex = buildCompanyIndex(Object.keys(totalOppsByAccount));
    const openOppsIndex = buildCompanyIndex(Object.keys(openOppsByAccount));
    const targetAccountsIndex = buildCompanyIndex(targetAccounts.map(t => t.company || ''));
    const targetByName = new Map();
    for (const t of targetAccounts) {
      const k = (t.company || '').toLowerCase().trim();
      if (k && !targetByName.has(k)) targetByName.set(k, t);
    }
    // All-tier lookups (incl. Tier 3+), used only to resolve the true
    // Targets-list tier for the mismatch flag.
    const targetTierByName = new Map();
    for (const t of targetAccountTiers) {
      const k = (t.company || '').toLowerCase().trim();
      if (k && !targetTierByName.has(k)) targetTierByName.set(k, t.tier);
    }
    const targetTierIndex = buildCompanyIndex(targetAccountTiers.map(t => t.company || ''));
    // All-reps fallback lookups (no CDM filter) — only consulted when the
    // CDM-scoped resolution above finds no Targets tier, so an already-
    // included account still flags a mismatch against a tier attributed to
    // another rep / a blank owner cell.
    const targetTierByNameAllReps = new Map();
    for (const t of targetAccountTiersAllReps) {
      const k = (t.company || '').toLowerCase().trim();
      if (k && !targetTierByNameAllReps.has(k)) targetTierByNameAllReps.set(k, t.tier);
    }
    const targetTierIndexAllReps = buildCompanyIndex(targetAccountTiersAllReps.map(t => t.company || ''));
    const contactsByCompanyIndex = buildCompanyIndex(Object.keys(contactsByCompany));
    const dmIndex = buildCompanyIndex(Object.keys(decisionMakerByCompany));
    const peIndex = buildCompanyIndex([...(pePartnerAccountSet || [])]);
    const suggestedStatusKeys = Object.keys(suggestedStatusByAccount || {});
    const suggestedStatusIndex = buildCompanyIndex(suggestedStatusKeys);

    const skippedCdm = [];
    for (const p of prospects) {
      // Skip dismissed companies
      if (isDismissed(p.company)) continue;
      // Use Firestore tier if explicitly set, otherwise fall back to map/target accounts
      let tier;
      if (p.tier === 'Tier 1' || p.tier === 'Tier 2' || p.tier === 'Tier 3') {
        // Any explicitly-chosen tier wins — including Tier 3. Previously
        // Tier 3 fell through to the hardcoded map below, so setting a
        // mapped account (e.g. one the map lists as Tier 2) to Tier 3 got
        // silently re-upgraded back to Tier 2. The target-list difference
        // is still surfaced via the tierMismatch warning, so the user's
        // explicit choice should stick here.
        tier = p.tier;
      } else if (p.tier === '-' || p.tier === '') {
        // Blank / no-tier accounts default to Tier 3 instead of showing a dash.
        tier = 'Tier 3';
      } else {
        tier = findTier(p.company);
        if (!tier) {
          for (const tName of findMatchesInIndex(targetAccountsIndex, p.company)) {
            const t = targetByName.get((tName || '').toLowerCase().trim());
            if (t) { tier = t.tier; break; }
          }
        }
      }
      // If no tier, check if the company has ANY opps (open or closed) — if
      // so, include as Tier 3. Closed-deal companies (Sold/Not Sold/etc.)
      // still deserve a line in My Accounts.
      if (!tier) {
        const companyLower = (p.company || '').toLowerCase();
        let hasAnyOpp = false;
        for (const oppsCompany of findMatchesInIndex(oppsIndex, companyLower)) {
          if ((totalOppsByAccount[oppsCompany] || 0) > 0) { hasAnyOpp = true; break; }
        }
        if (!hasAnyOpp) continue;
        tier = 'Tier 3';
      }
      const cdm = (p.cdm || '').toLowerCase().trim();
      const isBaldauf = matchesCdm(p.cdm, cdmName);
      if (!isBaldauf) {
        // Still include if the company has an OPEN opp. Closed-only history
        // (Sold/Not Sold) on a non-CDM account isn't enough to keep it
        // in My Accounts — that's how JPMC was sneaking in.
        // Use a STRICT opp match here: a non-CDM account should only be
        // pulled in by an opp that genuinely belongs to it, not by a
        // brand-prefix coincidence (e.g. a "Blackstone" opp dragging in
        // the separate "Blackstone GP Stakes" account).
        const compLower = (p.company || '').toLowerCase();
        let hasOpenOpp = false;
        for (const oppsCompany of findStrictMatchesInIndex(openOppsIndex, compLower)) {
          if ((openOppsByAccount[oppsCompany] || 0) > 0) { hasOpenOpp = true; break; }
        }
        if (!hasOpenOpp) {
          skippedCdm.push({ company: p.company, cdm: p.cdm });
          continue;
        }
      }
      const companyLower = (p.company || '').toLowerCase();
      // Aggregate across parent company + all divisions
      const divisionNames = (divisionsMap[p.id] || []).map(d => (d.company || '').toLowerCase());
      const allCompanyNames = [companyLower, ...divisionNames];

      let activityCount = 0;
      for (const name of allCompanyNames) {
        activityCount += activityByCompany[name] || 0;
      }
      let oppsCount = 0;
      let totalOpps = 0;
      // Collect the actual opp records that are feeding the count so the
      // Opps cell can show a hover popup of the underlying opps. Same
      // exact-then-fuzzy pattern as the count math above; dedup via _id
      // since one opp could match more than one of allCompanyNames.
      const feedingOpps = [];
      const feedingSeen = new Set();
      const pushOpp = (r) => {
        const id = r?._id;
        if (id == null || feedingSeen.has(id)) return;
        feedingSeen.add(id);
        feedingOpps.push(r);
      };
      for (const name of allCompanyNames) {
        // Exact match
        oppsCount += openOppsByAccount[name] || 0;
        totalOpps += totalOppsByAccount[name] || 0;
        for (const r of (oppsRecordsByAccount[name] || [])) pushOpp(r);
        // Fuzzy match for opps — first non-exact hit wins (matches the
        // original `break`-after-first-match semantics).
        for (const oppsCompany of findMatchesInIndex(openOppsIndex, name)) {
          if (oppsCompany !== name) { oppsCount += openOppsByAccount[oppsCompany] || 0; break; }
        }
        for (const oppsCompany of findMatchesInIndex(oppsIndex, name)) {
          if (oppsCompany !== name) {
            totalOpps += totalOppsByAccount[oppsCompany] || 0;
            for (const r of (oppsRecordsByAccount[oppsCompany] || [])) pushOpp(r);
            break;
          }
        }
      }
      const sources = [];
      sources.push('Google Sheets');
      if (fuzzyHas(hubspotCompanies, p.company)) sources.push('HubSpot');
      // Find matching Target Accounts names and tier — manual override first
      // Migrate old string format to array
      const rawMap = targetMap[p.id];
      const hasExplicitMapping = rawMap !== undefined; // explicit empty array means user cleared it
      let targetNames = Array.isArray(rawMap) ? rawMap : (rawMap ? [rawMap] : []);
      let targetTier = '';
      if (targetNames.length > 0) {
        const matched = targetAccounts.find(t => targetNames.includes(t.company));
        if (matched) targetTier = matched.tier;
        // Mapped name isn't in the Tier 1/2 book — resolve its true tier
        // (Tier 3+) purely so the mismatch flag can fire.
        if (!targetTier) {
          for (const nm of targetNames) {
            const tt = targetTierByName.get((nm || '').toLowerCase().trim());
            if (tt) { targetTier = tt; break; }
          }
        }
        // Nothing under the configured CDM — fall back to the all-reps
        // parse so a mapped name tiered under another rep still flags.
        if (!targetTier) {
          for (const nm of targetNames) {
            const tt = targetTierByNameAllReps.get((nm || '').toLowerCase().trim());
            if (tt) { targetTier = tt; break; }
          }
        }
      } else if (!hasExplicitMapping) {
        // Only fuzzy-match if user never explicitly set/cleared the mapping
        for (const tName of findMatchesInIndex(targetAccountsIndex, p.company)) {
          const t = targetByName.get((tName || '').toLowerCase().trim());
          if (t) { targetNames = [t.company]; targetTier = t.tier; break; }
        }
        // No Tier 1/2 target matched. Check the all-tier lookup so a Tier
        // 3+ target still surfaces a tier mismatch (e.g. My Accounts Tier
        // 2 vs Targets Tier 3). Deliberately don't touch targetNames /
        // sources so the target book and 'Target List' badge stay Tier
        // 1/2 only.
        if (!targetTier) {
          for (const tName of findMatchesInIndex(targetTierIndex, p.company)) {
            const tt = targetTierByName.get((tName || '').toLowerCase().trim());
            if (tt) { targetTier = tt; break; }
          }
        }
        // Still nothing under the configured CDM — fall back to the
        // all-reps parse so a Targets tier attributed to another rep (or a
        // blank CDM cell) still flags a mismatch for an account that's
        // already in My Accounts. This is what surfaces e.g. TIAA showing
        // Tier 2 here while the Targets list has it at Tier 3.
        if (!targetTier) {
          for (const tName of findMatchesInIndex(targetTierIndexAllReps, p.company)) {
            const tt = targetTierByNameAllReps.get((tName || '').toLowerCase().trim());
            if (tt) { targetTier = tt; break; }
          }
        }
      }
      if (targetNames.length > 0) sources.push('Target List');
      const tierMismatch = targetTier && targetTier !== tier && !p.ignoreTierMismatch;
      // Check for decision maker — fuzzy match across parent + divisions
      let dmNames = null;
      for (const name of allCompanyNames) {
        let found = false;
        for (const dmCompany of findMatchesInIndex(dmIndex, name)) {
          dmNames = decisionMakerByCompany[dmCompany];
          if (dmNames) { found = true; break; }
        }
        if (found) break;
      }
      // Find accounts assigned to other salespeople — exact match on this row's mapped Target Account name(s) only
      const targetNameSet = new Set((targetNames || []).map(n => (n || '').toLowerCase().trim()).filter(Boolean));
      const otherReps = targetNameSet.size === 0
        ? []
        : allTargetReps.filter(t => targetNameSet.has((t.company || '').toLowerCase().trim()));
      // Count HubSpot contacts across parent + all divisions, matching
      // by Company text first then by email domain so TIAA-style
      // accounts (varied Company values like "TIAA" / "TIAA-CREF" /
      // "(TIAA) Teachers...") still pick up every contact that shares
      // the registered email domain. Track contact IDs in a Set so
      // each contact is counted at most once even when both the
      // company-text and email-domain rules match.
      const matchedContactIds = new Set();
      const bucketsSeen = new Set();
      let exactNameMatches = 0;
      const matchedCos = new Set();
      for (const name of allCompanyNames) {
        for (const co of findMatchesInIndex(contactsByCompanyIndex, name)) matchedCos.add(co);
      }
      for (const co of matchedCos) {
        const ids = contactsByCompany[co];
        if (!ids) continue;
        for (const id of ids) matchedContactIds.add(id);
        exactNameMatches += ids.size;
        if (bucketsByCompany[co]) {
          for (const b of bucketsByCompany[co]) bucketsSeen.add(b);
        }
      }
      const prospectDomains = new Set();
      if (p.emailDomain) {
        for (const entry of String(p.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
          const at = entry.lastIndexOf('@');
          const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
          if (d) prospectDomains.add(d);
        }
      }
      if (p.website) {
        const d = String(p.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
        if (d) prospectDomains.add(d);
      }
      let domainMatches = 0;
      for (const d of prospectDomains) {
        const ids = contactsByEmailDomain[d];
        if (ids) {
          for (const id of ids) matchedContactIds.add(id);
          domainMatches += ids.size;
        }
        if (bucketsByEmailDomain[d]) {
          for (const b of bucketsByEmailDomain[d]) bucketsSeen.add(b);
        }
      }
      // Contacts the user explicitly pinned to this company on the popup
      // (settings.companyContactLinks, keyed by lowercased company name).
      // Include them in the count — minus any since-hidden ones — so the
      // Contacts column matches what the popup shows.
      let linkedMatches = 0;
      const linkKey = (p.company || '').trim().toLowerCase();
      for (const lid of ((settings?.companyContactLinks || {})[linkKey] || [])) {
        const cid = linkableContactById[String(lid)];
        if (cid != null && !matchedContactIds.has(cid)) { matchedContactIds.add(cid); linkedMatches++; }
      }
      const contactCount = matchedContactIds.size;
      const bucketCount = bucketsSeen.size;
      // Find contact-company strings that share any significant token
      // with the prospect's name so we can spot formatting diffs
      // (missing paren, extra suffix, etc.) at a glance via the
      // Contacts-cell tooltip. Limited to the first 8 matches to
      // keep the tooltip readable.
      const companyWords = new Set(
        String(p.company || '')
          .normalize('NFKD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .split(' ')
          .filter(t => t.length >= 4)
      );
      const similarContactCompanies = [];
      if (companyWords.size > 0) {
        for (const co of Object.keys(contactsByCompany)) {
          const coWords = co.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ');
          if (coWords.some(w => w.length >= 4 && companyWords.has(w))) {
            const size = contactsByCompany[co].size;
            similarContactCompanies.push(`"${co}" (${size})`);
            if (similarContactCompanies.length >= 8) break;
          }
        }
      }
      const _contactDebug = {
        cacheSize: Object.values(contactsByCompany).reduce((s, set) => s + set.size, 0),
        exactNameMatches,
        domainMatches,
        linkedMatches,
        prospectDomains: [...prospectDomains],
        similarContactCompanies,
      };
      // Suggested status based on opps data (fuzzy match company names).
      // Only suggest when we actually find opps for this company — no match
      // means no data to base a suggestion on, so we stay silent.
      let suggestedStatus = '';
      for (const name of allCompanyNames) {
        if (suggestedStatusByAccount[name]) { suggestedStatus = suggestedStatusByAccount[name]; break; }
        let found = false;
        for (const oppsCompany of findMatchesInIndex(suggestedStatusIndex, name)) {
          const status = suggestedStatusByAccount[oppsCompany];
          if (status) { suggestedStatus = status; found = true; break; }
        }
        if (found) break;
      }
      const statusMismatch = !!(!p.hideStatusSuggestion && suggestedStatus && suggestedStatus !== p.status && p.status && p.dismissedSuggestedStatus !== suggestedStatus);
      // Any opp sourced from a "PE Partner" nudges Type → Portfolio
      // Company. Fuzzy-match against the row's company + divisions to
      // catch e.g. 'Acme Holdings' vs 'Acme Holdings LLC'.
      let pePartnerHit = false;
      for (const name of allCompanyNames) {
        if (pePartnerAccountSet.has(name)) { pePartnerHit = true; break; }
        if (hasMatchInIndex(peIndex, name)) { pePartnerHit = true; break; }
      }
      const suggestedType = pePartnerHit ? 'Portfolio Company' : '';
      const typeMismatch = !!suggestedType
        && p.type !== suggestedType
        && p.dismissedSuggestedType !== suggestedType
        && !p.hideTypeSuggestion;
      // Hide accounts with zero open opps — UNLESS they're one of Dan's
      // strategic (Tier 1/Tier 2) accounts or one of his active Clients.
      // A won Client on Dan's book belongs on the list even with no open
      // opp and no tier tag (a blank tier resolves to "-" above, which is
      // not strategic, so status carries it instead).
      const isStrategicTier = tier === 'Tier 1' || tier === 'Tier 2';
      const keepForDan = isBaldauf && (isStrategicTier || p.status === 'Client');
      if (!keepForDan && (!oppsCount || oppsCount === 0)) continue;
      // Master Site List count for this account — summed across the parent
      // company and any division names, matched on the normalized name.
      let mslSiteCount = 0;
      for (const name of allCompanyNames) mslSiteCount += mslCountByCompany.get(String(name).trim()) || 0;
      const entry = { ...p, myTier: tier, activityCount, oppsCount, totalOpps, feedingOpps, sources: sources.join(', '), dmFound: !!dmNames, dmNames: dmNames ? dmNames.join(', ') : '', cdmMismatch: !isBaldauf, targetNames, targetName: (targetNames || []).join(', '), targetTier, tierMismatch, otherReps, contactCount, bucketCount, mslSiteCount, _contactDebug, suggestedStatus, statusMismatch, suggestedType, typeMismatch };
      if (tier === 'Tier 1') t1.push(entry);
      else t2.push(entry); // Tier 2 and Tier 3 both go in t2 array
      const s = p.status || 'Unknown';
      counts[s] = (counts[s] || 0) + 1;
    }

    // Second pass: any company in the Opps sheet with 1+ opps that isn't
    // already covered by a prospect gets a synthetic Tier 3 entry so it
    // shows up in My Accounts. This surfaces deals happening on companies
    // that aren't yet in the Table View.
    let oppsOnlyAdded = 0;
    // Diagnostic: dump everything we can see about specific accounts the
    // user has asked about so we can confirm why they're (not) showing.
    // Gated behind localStorage.debug-myaccounts so production sessions
    // don't flood the console (and crush the main thread) with these.
    let DEBUG_MA = false;
    let DEBUG_MA_RAW = '';
    try {
      DEBUG_MA_RAW = (typeof localStorage !== 'undefined' && localStorage.getItem('debug-myaccounts')) || '';
      DEBUG_MA = !!DEBUG_MA_RAW;
    } catch { /* localStorage unavailable */ }
    // Default watch-list. Set localStorage['debug-myaccounts'] to a
    // comma-separated list of names (e.g. "edens") to watch those specific
    // accounts instead — handy for diagnosing why one account isn't showing.
    const DEBUG_BASE_RX = /(urw|unibail|rodamco|westfield|\bara\b|ara\s*partners|jpmc|jp\s*morgan|jpmorgan)/i;
    const debugCustomTerms = DEBUG_MA_RAW && !/^(1|true|on|yes)$/i.test(DEBUG_MA_RAW.trim())
      ? DEBUG_MA_RAW.split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : [];
    const DEBUG_RX = debugCustomTerms.length
      ? new RegExp('(' + debugCustomTerms.join('|') + ')', 'i')
      : DEBUG_BASE_RX;
    const debugProspects = DEBUG_MA ? prospects.filter(p => DEBUG_RX.test(p.company || '')) : [];
    const debugOppsKeys = DEBUG_MA ? Object.keys(totalOppsByAccount).filter(k => DEBUG_RX.test(k)) : [];
    const renderedAccountNamesLower = new Set([...t1, ...t2].map(e => (e.company || '').toLowerCase()));
    if (DEBUG_MA && (debugProspects.length > 0 || debugOppsKeys.length > 0)) {
      const payload = {
        loggedInCdmName: cdmName,
        prospects: debugProspects.map(p => {
          const inList = renderedAccountNamesLower.has((p.company || '').toLowerCase());
          const compLower = (p.company || '').toLowerCase();
          let openHits = 0;
          for (const oc of findMatchesInIndex(openOppsIndex, compLower)) {
            const oCount = openOppsByAccount[oc] || 0;
            if (oCount > 0) openHits += oCount;
          }
          return {
            company: p.company,
            cdm: p.cdm,
            status: p.status,
            tier: p.tier,
            isBaldauf: matchesCdm(p.cdm, cdmName),
            openOppsForCompany: openHits,
            isInRenderedList: inList,
          };
        }),
        oppsAccounts: debugOppsKeys.map(k => ({
          key: k,
          total: totalOppsByAccount[k],
          open: openOppsByAccount[k] || 0,
          display: displayNameByAccount[k],
        })),
      };
      // eslint-disable-next-line no-console
      console.log('[MyAccountsView] debug-account diagnostics:', payload);
      // Inline JSON so the user doesn't have to expand the Object in the
      // console — the full contents appear in the log line itself.
      // eslint-disable-next-line no-console
      console.log('[MyAccountsView] debug-account JSON:', JSON.stringify(payload, null, 2));
    } else if (DEBUG_MA && debugCustomTerms.length > 0) {
      // The custom watch term matched no prospect AND no opps account —
      // i.e. the account isn't in either dataset (e.g. it exists only as a
      // Target Accounts row, not as a prospect record), so the prospect
      // pass never builds a My Accounts row for it.
      // eslint-disable-next-line no-console
      console.log(`[MyAccountsView] debug: no prospect or opps account matched ${JSON.stringify(DEBUG_MA_RAW)}. Logged-in CDM: ${JSON.stringify(cdmName)}. Prospects scanned: ${prospects.length}.`);
    }

    // Index prospects by company name so the opps-only surface below
    // can match each opps account against any prospect in O(1) instead
    // of a full scan per account.
    const prospectByCompany = new Map();
    for (const p of prospects) {
      const k = (p?.company || '').toLowerCase().trim();
      if (k && !prospectByCompany.has(k)) prospectByCompany.set(k, p);
    }
    const prospectsIndex = buildCompanyIndex(prospects.map(p => p?.company || ''));
    for (const [accountLower, count] of Object.entries(totalOppsByAccount)) {
      if (!count || count < 1) continue;
      // Require an open opp (non-closed) for the opps-only surface so it
      // matches the prospect-path filter above — no closed-only accounts.
      if (!openOppsByAccount[accountLower]) continue;
      const displayNameRaw = displayNameByAccount[accountLower] || accountLower;
      const debugInteresting = DEBUG_MA && DEBUG_RX.test(displayNameRaw);
      if (isDismissed(displayNameRaw)) {
        if (debugInteresting) console.log('[MyAccountsView] debug skipped by isDismissed:', displayNameRaw);
        continue;
      }
      // Skip if any prospect we've already included matches this opps account
      let matched = false;
      let matchedProspect = null;
      for (const pCompany of findMatchesInIndex(prospectsIndex, displayNameRaw)) {
        const p = prospectByCompany.get((pCompany || '').toLowerCase().trim());
        if (p) { matched = true; matchedProspect = p; break; }
      }
      if (debugInteresting) {
        console.log('[MyAccountsView] debug opps-only decision:', {
          account: displayNameRaw,
          matched,
          matchedProspect: matchedProspect ? { company: matchedProspect.company, cdm: matchedProspect.cdm } : null,
        });
      }
      if (matched) continue;

      const oppsCount = activeOppsByAccount[accountLower] || 0;
      const suggestedStatus = suggestedStatusByAccount[accountLower] || '';
      const entry = {
        id: `opps-only:${accountLower}`,
        company: displayNameRaw,
        status: '',
        cdm: '',
        tier: 'Tier 3',
        myTier: 'Tier 3',
        activityCount: 0,
        oppsCount,
        totalOpps: count,
        feedingOpps: oppsRecordsByAccount[accountLower] || [],
        sources: 'Opps Sheet',
        dmFound: false,
        dmNames: '',
        cdmMismatch: false,
        targetNames: [],
        targetName: '',
        targetTier: '',
        tierMismatch: false,
        otherReps: [],
        contactCount: 0,
        bucketCount: 0,
        mslSiteCount: mslCountByCompany.get(String(displayNameRaw || '').trim().toLowerCase()) || 0,
        suggestedStatus,
        statusMismatch: false, // no stored status to compare against
        suggestedType: '',
        typeMismatch: false,
        _oppsOnly: true,
      };
      t2.push(entry);
      oppsOnlyAdded++;
    }

    const all = [...t1, ...t2];
    all.sort((a, b) => (a.company || '').localeCompare(b.company || ''));
    if (DEBUG_MA && skippedCdm.length > 0) console.log('My Accounts: skipped (CDM not Baldauf):', skippedCdm);
    if (DEBUG_MA) console.log(`My Accounts: ${t1.length} Tier 1, ${t2.length} Tier 2 (incl ${oppsOnlyAdded} opps-only)`);
    return { tier1: t1, tier2: t2, allAccounts: all, statusCounts: counts };
  }, [prospects, targetMap, targetAccounts, targetAccountTiers, targetAccountTiersAllReps, allTargetReps, activityByCompany, activeOppsByAccount, totalOppsByAccount, suggestedStatusByAccount, displayNameByAccount, hubspotCompanies, targetCompanies, decisionMakerByCompany, contactsByCompany, bucketsByCompany, contactsByEmailDomain, bucketsByEmailDomain, linkableContactById, settings?.companyContactLinks, divisionsMap, pePartnerAccountSet, mslCountByCompany]);

  const clientCount = statusCounts['Client'] || 0;
  const tier3Count = allAccounts.filter(a => a.myTier === 'Tier 3').length;

  // Accounts whose stored Tier differs from the Target Accounts tier and
  // hasn't been individually dismissed — these are the ⚠ flags shown in
  // the Tier column. The bulk button below applies them all at once.
  const tierFlagged = useMemo(
    () => allAccounts.filter(a => a.tierMismatch && a.targetTier && a.id),
    [allAccounts]
  );

  // Bulk-apply every Tier-mismatch flag: set each flagged account's
  // stored tier to the tier its Target Accounts row specifies. Mirrors
  // the per-row "Update to {targetTier}" action in the Tier column, run
  // across all flagged accounts at once.
  async function applyAllTierFlags() {
    if (tierSyncRunning) return;
    if (tierFlagged.length === 0) {
      alert('No tier flags to apply: every account already matches its Target Accounts tier.');
      return;
    }
    const sample = tierFlagged.slice(0, 12)
      .map(a => `• ${a.company}: ${a.myTier || '-'} → ${a.targetTier}`)
      .join('\n');
    const more = tierFlagged.length > 12 ? `\n…and ${tierFlagged.length - 12} more` : '';
    const ok = window.confirm(
      `Update ${tierFlagged.length} account tier${tierFlagged.length === 1 ? '' : 's'} to match Target Accounts:\n\n${sample}${more}`
    );
    if (!ok) return;
    setTierSyncRunning(true);
    try {
      await Promise.all(tierFlagged.map(a => onUpdate(a.id, { tier: a.targetTier })));
    } catch (err) {
      console.error('Tier sync failed:', err);
      alert('Tier sync failed: ' + (err?.message || err));
    } finally {
      setTierSyncRunning(false);
    }
  }

  // One-click: move every account in the "on My Accounts but NOT on Target
  // Accounts List" banner down to Tier 3. Only accounts backed by a real
  // record id can be updated; the rest are surfaced in the confirm.
  async function moveOnlyMyAccountsToTier3(list) {
    if (tier3BulkRunning) return;
    const updatable = (list || []).filter(a => a.id);
    if (updatable.length === 0) {
      alert('No updatable accounts: these rows have no saved record to write to.');
      return;
    }
    const sample = updatable.slice(0, 12).map(a => `• ${a.company}: ${a.myTier || '-'} → Tier 3`).join('\n');
    const more = updatable.length > 12 ? `\n…and ${updatable.length - 12} more` : '';
    const skipped = (list || []).length - updatable.length;
    const skippedNote = skipped > 0 ? `\n\n(${skipped} not saved yet and will be skipped.)` : '';
    const ok = window.confirm(
      `Move ${updatable.length} account${updatable.length === 1 ? '' : 's'} not on the Target Accounts List to Tier 3:\n\n${sample}${more}${skippedNote}`
    );
    if (!ok) return;
    setTier3BulkRunning(true);
    try {
      await Promise.all(updatable.map(a => onUpdate(a.id, { tier: 'Tier 3' })));
    } catch (err) {
      console.error('Bulk Tier 3 update failed:', err);
      alert('Bulk Tier 3 update failed: ' + (err?.message || err));
    } finally {
      setTier3BulkRunning(false);
    }
  }

  // Prospects whose tier-mismatch warning was previously dismissed (the
  // per-row "Dismiss" action sets ignoreTierMismatch). Count the raw
  // prospect list, not just the visible rows, so the reset also catches
  // dismissals on accounts hidden by the current filters.
  const ignoredTierMismatches = useMemo(
    () => (prospects || []).filter(p => p.ignoreTierMismatch),
    [prospects]
  );

  // Undo every previously-dismissed tier mismatch so the ⚠ flags
  // re-appear for re-review. Same effect as the clean-slate reset that
  // runs on a new Target Accounts upload, but on demand from the toolbar.
  async function resetTierMismatchIgnores() {
    if (ignoredTierMismatches.length === 0) return;
    const n = ignoredTierMismatches.length;
    const ok = window.confirm(
      `Restore ${n} previously-dismissed tier mismatch${n === 1 ? '' : 'es'}? The ⚠ flags will re-appear so you can review them again.`
    );
    if (!ok) return;
    try {
      await Promise.all(ignoredTierMismatches.map(p => onUpdate(p.id, { ignoreTierMismatch: false })));
    } catch (err) {
      console.error('Reset tier-mismatch dismissals failed:', err);
      alert('Reset failed: ' + (err?.message || err));
    }
  }

  // Publish the resolved My-Accounts company names to localStorage so
  // the List tabs can filter against the exact same set (not just the
  // broader Baldauf-CDM prospect pool). Written whenever allAccounts
  // recomputes; any mount of UploadedListView re-reads on render.
  useEffect(() => {
    try {
      const names = allAccounts.map(a => (a.company || '').trim()).filter(Boolean);
      userLsSet('my-accounts:active-names', JSON.stringify(names));
    } catch {}
  }, [allAccounts]);

  // Publish the tier / status / HQ-Region flags so the Issues tab can list
  // them. One record per (account, flag); synthetic opps-only rows are
  // skipped since they have no backing prospect to open or edit. The
  // HQ-Region flag mirrors the column header's rule (missing region on a
  // non-inactive account).
  useEffect(() => {
    try {
      const flags = [];
      for (const a of allAccounts) {
        if (!a.id || String(a.id).startsWith('opps-only:')) continue;
        if (a.tierMismatch) flags.push({ id: a.id, company: a.company || '', kind: 'tier', myTier: a.myTier || '', targetTier: a.targetTier || '' });
        if (a.statusMismatch) flags.push({ id: a.id, company: a.company || '', kind: 'status', status: a.status || '', suggestedStatus: a.suggestedStatus || '' });
        if (!a.hqRegion && !INACTIVE_STATUSES.has(a.status)) flags.push({ id: a.id, company: a.company || '', kind: 'hqRegion', status: a.status || '' });
      }
      saveMyAccountsFlags(flags);
    } catch {}
  }, [allAccounts]);

  // Build the List Flags aggregate. Runs when allAccounts changes so
  // flags match against the exact ~132 accounts the user sees on this
  // tab — not the broader Baldauf-CDM prospect pool. Also refreshes
  // when mappings change elsewhere (via the custom
  // 'my-accounts-coverage-changed' event dispatched from
  // UploadedListView) so returning from a list tab shows the latest.
  const [flagVersion, setFlagVersion] = useState(0);
  useEffect(() => {
    const bump = () => setFlagVersion(v => v + 1);
    window.addEventListener('my-accounts-coverage-changed', bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener('my-accounts-coverage-changed', bump);
      window.removeEventListener('storage', bump);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const names = allAccounts.map(a => a.company).filter(Boolean);
      const flags = await computeListFlags(names, { prospects: allAccounts });
      if (!cancelled) setListFlagsByCompany(flags);
    })();
    return () => { cancelled = true; };
  }, [allAccounts, flagVersion]);

  // Dynamic filter options — any visible column with ≤30 unique string values gets a filter
  const SKIP_FILTER_KEYS = new Set(['company', 'notes', 'dmNames', 'targetName', 'otherReps', 'sources', 'divisions', '_hide', 'id', 'createdAt', 'updatedAt', 'assetTypes', 'frameworks']);
  const BLANK_LABEL = '(Blank)';
  const filterOptions = useMemo(() => {
    const opts = {};
    for (const col of ACCOUNT_COLUMNS) {
      if (SKIP_FILTER_KEYS.has(col.key)) continue;
      const vals = new Set();
      let hasBlank = false;
      let tooMany = false;
      for (const a of allAccounts) {
        let v = a[col.key];
        if (v == null || v === '' || v === '-' || (typeof v === 'string' && !v.trim())) {
          hasBlank = true;
          continue;
        }
        if (typeof v === 'object') continue;
        v = String(v).trim();
        if (!v) { hasBlank = true; continue; }
        vals.add(v);
        if (vals.size > 30) { tooMany = true; break; }
      }
      if (!tooMany && vals.size >= 2) {
        const sorted = [...vals].sort();
        if (hasBlank) sorted.push(BLANK_LABEL);
        opts[col.key] = sorted;
      }
    }
    return opts;
  }, [allAccounts]);

  // Apply filters, bucket filter, and search
  const filteredAccounts = useMemo(() => {
    let result = allAccounts;
    // Inactive status filter
    if (inactiveMode === 'hide') result = result.filter(a => !INACTIVE_STATUSES.has(a.status));
    else if (inactiveMode === 'only') result = result.filter(a => INACTIVE_STATUSES.has(a.status));
    // Bucket filter
    if (bucketFilter === 'tier1') result = result.filter(a => a.myTier === 'Tier 1');
    else if (bucketFilter === 'tier2') result = result.filter(a => a.myTier === 'Tier 2');
    else if (bucketFilter === 'client') result = result.filter(a => a.status === 'Client');
    else if (bucketFilter === 'pipeline') result = result.filter(a => a.myTier === 'Tier 3');
    else if (bucketFilter === 'noTarget') result = result.filter(a => !a.targetNames || a.targetNames.length === 0);
    for (const [key, values] of Object.entries(filters)) {
      if (values.length > 0) {
        const wantsBlank = values.includes(BLANK_LABEL);
        const nonBlankValues = values.filter(v => v !== BLANK_LABEL);
        result = result.filter(a => {
          const val = String(a[key] ?? '').trim();
          const isEmpty = !val || val === '-';
          if (wantsBlank && isEmpty) return true;
          if (nonBlankValues.length > 0 && nonBlankValues.includes(val)) return true;
          return false;
        });
      }
    }
    if (search.trim()) {
      const term = search.toLowerCase();
      result = result.filter(a =>
        [a.company, a.status, a.type, a.geography, a.hqRegion, a.notes, a.cdm]
          .filter(Boolean).join(' ').toLowerCase().includes(term)
      );
    }
    return result;
  }, [allAccounts, filters, search, bucketFilter, inactiveMode]);

  // Company Type subtab: the same accounts, bucketed by the Type column.
  // Built off allAccounts (not filteredAccounts) so the column filters and
  // tier-card buckets that only exist on the table tab can't silently
  // shrink the grouping; the inactive toggle and the search box are the
  // two filters this tab does honour.
  const typeGroups = useMemo(() => {
    let rows = allAccounts;
    if (inactiveMode === 'hide') rows = rows.filter(a => !INACTIVE_STATUSES.has(a.status));
    else if (inactiveMode === 'only') rows = rows.filter(a => INACTIVE_STATUSES.has(a.status));
    if (search.trim()) {
      const term = search.toLowerCase();
      rows = rows.filter(a =>
        [a.company, a.type, a.status, a.myTier].filter(Boolean).join(' ').toLowerCase().includes(term)
      );
    }
    const byType = new Map();
    for (const a of rows) {
      const label = (a.type || '').trim() || UNSPECIFIED_TYPE;
      if (!byType.has(label)) byType.set(label, []);
      byType.get(label).push(a);
    }
    const groups = [...byType.entries()].map(([type, accounts]) => ({
      type,
      type2: TYPE2_MAP[type] || '',
      count: accounts.length,
      clients: accounts.filter(a => a.status === 'Client').length,
      accounts: accounts.slice().sort((a, b) => {
        const ta = TIER_ORDER[a.myTier] ?? 9;
        const tb = TIER_ORDER[b.myTier] ?? 9;
        if (ta !== tb) return ta - tb;
        return (a.company || '').localeCompare(b.company || '');
      }),
    }));
    // Biggest bucket first, with the untyped accounts pinned last so they
    // read as a to-do rather than as a category of firm.
    groups.sort((a, b) =>
      (a.type === UNSPECIFIED_TYPE ? 1 : 0) - (b.type === UNSPECIFIED_TYPE ? 1 : 0)
      || b.count - a.count
      || a.type.localeCompare(b.type)
    );
    return { groups, total: rows.length };
  }, [allAccounts, inactiveMode, search]);

  // Publish the visible (post-filter) company list to a second
  // localStorage key so downstream features (like the Bulk Add
  // Contacts "Accounts without contacts" export) can target exactly
  // the set the user sees on-screen rather than the full tier1+tier2
  // pool.
  useEffect(() => {
    try {
      const names = filteredAccounts.map(a => (a.company || '').trim()).filter(Boolean);
      // Don't clobber an existing populated list with an empty one —
      // the initial render of this tab can have an empty
      // filteredAccounts before prospects load.
      if (names.length === 0) return;
      userLsSet('my-accounts:filtered-names', JSON.stringify(names));
    } catch {}
  }, [filteredAccounts]);

  // Download a CSV of the CURRENTLY FILTERED My Accounts that have
  // no HubSpot contact on file yet. Pulls Zoom Company ID / Zoom
  // Company Name / Website from the matching Table View prospect so
  // the user can take the file into ZoomInfo (or similar) to build
  // the first contact list for each empty account. Lives on this
  // view so we have direct access to filteredAccounts — no more
  // localStorage round-trip.
  // Both Zoom CSVs are the same four columns matched the same way — Company
  // plus the Zoom ID / name / website pulled off the matching prospect. Only
  // the set of accounts differs, so the building and downloading lives here
  // and each button just decides which rows to hand over.
  function downloadZoomCsv(accounts, filename) {
    const CORP_SUFFIXES = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|oy|ab|spa|kk|pty|holdings|group|grp)\b\.?/g;
    const norm = s => String(s || '')
      .toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/\(.*?\)/g, ' ')
      .replace(/\[.*?\]/g, ' ')
      .replace(/&/g, ' and ')
      .replace(CORP_SUFFIXES, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Lookup prospects by normalized company name to pull Zoom + site.
    const prospectByNorm = new Map();
    for (const p of prospects) {
      const k = norm(p.company);
      if (k && !prospectByNorm.has(k)) prospectByNorm.set(k, p);
    }

    const header = ['Company', 'Zoom Company ID', 'Zoom Company Name', 'Zoom Website'];
    const rows = [header];
    for (const a of accounts) {
      const p = prospectByNorm.get(norm(a.company));
      rows.push([
        a.company || '',
        p?.zoomCompanyId || '',
        p?.zoomCompanyName || '',
        p?.website || '',
      ]);
    }
    const csvCell = v => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = rows.map(r => r.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadAccountsWithoutContacts() {
    if (filteredAccounts.length === 0) {
      alert('There are no accounts in the current view.');
      return;
    }
    // Use the same contact count the Contacts column shows (matches by
    // company-name index across divisions AND by email domain, de-duped by
    // contact ID). The previous exact-normalized-company-text match was
    // stricter than the column, so accounts whose contacts only matched by
    // domain or by a differently-worded Company field (e.g. PNC) were
    // wrongly listed as having no contacts.
    const empty = filteredAccounts.filter(a => (a.contactCount || 0) === 0);
    if (empty.length === 0) {
      alert('Every company in the current My Accounts view already has at least one HubSpot contact.');
      return;
    }
    downloadZoomCsv(empty, `my-accounts-no-contacts-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  // Same CSV, cut to the accounts still being worked by inside sales.
  function downloadZoomExport() {
    // Sits beside Export Excel, so it exports the same rows that button
    // would — the table's own filtered set, not just the page filters.
    const source = tableVisibleRows || filteredAccounts;
    const insideSales = source.filter(a => a.status === 'Inside Sales');
    if (insideSales.length === 0) {
      alert('No accounts in the current view have a status of Inside Sales.');
      return;
    }
    downloadZoomCsv(insideSales, `my-accounts-inside-sales-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  // All company names from Target Accounts file (not just Dan Baldauf's)
  const allTargetNames = useMemo(() => {
    if (!targetAccountsData?.sheets) return [];
    const names = new Set();
    const companyKeywords = ['account name', 'account', 'company name', 'company', 'client name', 'client'];
    for (const sheetName of targetAccountsData.sheetNames || []) {
      const sheet = targetAccountsData.sheets[sheetName];
      if (!sheet?.records || !sheet.records.length) continue;
      // Find the best company column from headers
      const headers = sheet.headers || Object.keys(sheet.records[0]).filter(k => k !== '_id');
      let companyCol = null;
      for (const kw of companyKeywords) {
        for (const h of headers) {
          if (h.toLowerCase().trim() === kw) { companyCol = h; break; }
        }
        if (companyCol) break;
      }
      // Fallback: partial match
      if (!companyCol) {
        for (const kw of companyKeywords) {
          for (const h of headers) {
            if (h.toLowerCase().includes(kw)) { companyCol = h; break; }
          }
          if (companyCol) break;
        }
      }
      if (!companyCol) continue;
      console.log(`Target Accounts allTargetNames: using column "${companyCol}" from sheet "${sheetName}"`);
      for (const r of sheet.records) {
        const val = (r[companyCol] || '').trim();
        if (val && val.length > 1) names.add(val);
      }
    }
    console.log(`Target Accounts allTargetNames: ${names.size} unique names`);
    return [...names].sort();
  }, [targetAccountsData]);

  // Detect duplicate target account name mappings — map of targetName -> [company names]
  const duplicateTargetNames = useMemo(() => {
    const byTarget = {};
    for (const a of allAccounts) {
      for (const tn of (a.targetNames || [])) {
        if (tn) {
          if (!byTarget[tn]) byTarget[tn] = [];
          byTarget[tn].push(a.company);
        }
      }
    }
    const dupes = new Map();
    for (const [name, companies] of Object.entries(byTarget)) {
      if (companies.length > 1) dupes.set(name, companies);
    }
    return dupes;
  }, [allAccounts]);

  // For each account, the set of OTHER Table View prospects whose
  // company name normalizes to the same key — catches near-duplicate
  // spellings like "Affinius Capital" vs "Affinius Capital, a USAA Co."
  // that would otherwise live as separate prospects. Normalization
  // strips parentheticals, corporate suffixes, and punctuation.
  const similarNamesByAccount = useMemo(() => {
    const CORP_SUFFIXES = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|oy|ab|spa|kk|pty|holdings|group|grp)\b\.?/g;
    const norm = s => String(s || '')
      .toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/\(.*?\)/g, ' ')
      .replace(/\[.*?\]/g, ' ')
      .replace(/&/g, ' and ')
      .replace(CORP_SUFFIXES, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Group every prospect's company by its normalized key.
    const byNorm = new Map();
    for (const p of prospects) {
      const raw = (p.company || '').trim();
      if (!raw) continue;
      const k = norm(raw);
      if (!k) continue;
      if (!byNorm.has(k)) byNorm.set(k, []);
      byNorm.get(k).push({ id: p.id, company: raw });
    }
    // Walk the accounts and collect the other entries that share a
    // key but differ in display spelling. Account companies can
    // themselves appear in the group; filter those out.
    const out = new Map();
    for (const a of allAccounts) {
      if (a.ignoreSimilarNames) continue;
      const raw = (a.company || '').trim();
      if (!raw) continue;
      const k = norm(raw);
      const group = byNorm.get(k);
      if (!group || group.length < 2) continue;
      const rawLower = raw.toLowerCase();
      const others = group.filter(g => g.company.toLowerCase() !== rawLower);
      if (others.length > 0) out.set(rawLower, others);
    }
    return out;
  }, [prospects, allAccounts]);

  // Set the company column render with onSelect, and make editable columns use InlineCell
  const columns = useMemo(() => {
    const mapped = ACCOUNT_COLUMNS.map(col => {
      if (col.key === 'company') {
        const similarAccounts = filteredAccounts.filter(a => similarNamesByAccount.has((a.company || '').toLowerCase().trim())).map(a => a.company);
        return {
          ...col,
          label: similarAccounts.length > 0 ? `Company ⚠ ${similarAccounts.length}` : 'Company',
          headerTitle: warningHeaderTitle('Similar names in Table View', similarAccounts),
          render: (row) => {
            const similar = similarNamesByAccount.get((row.company || '').toLowerCase().trim());
            return (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontWeight: 600, color: 'var(--color-text)', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onSelect(row); }}>{row.company}</span>
                {similar && similar.length > 0 && (
                  <SimilarNamesWarning
                    matches={similar}
                    onDismiss={() => onUpdate(row.id, { ignoreSimilarNames: true })}
                  />
                )}
              </span>
            );
          },
        };
      }
      if (col.key === 'myTier') {
        return { ...col, render: (row) => {
          const stripped = (row.myTier || '').replace(/^\s*tier\s*/i, '').trim();
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <InlineCell
                row={row}
                field="tier"
                value={row.myTier}
                displayValue={stripped || row.myTier}
                onUpdate={onUpdate}
                options={TIERS}
              />
              {row.tierMismatch && <TierMismatchWarning
                row={row}
                onApply={() => onUpdate(row.id, { tier: row.targetTier })}
                onDismiss={() => onUpdate(row.id, { ignoreTierMismatch: true })}
              />}
            </span>
          );
        }};
      }
      if (col.key === 'oppsCount') {
        return { ...col, render: (row) => <OppsHoverPopup row={row} /> };
      }
      if (col.key === 'targetName') {
        return { ...col, getFilterValue: (row) => (row.targetNames || []).join(', '), render: (row) => <TargetNamePicker values={row.targetNames || []} companyId={row.id} companyName={row.company} targetOptions={allTargetNames} onToggle={toggleTargetMapping} duplicates={duplicateTargetNames} /> };
      }
      if (col.key === 'listFlags') {
        return { ...col, getFilterValue: (row) => {
          const set = listFlagsByCompany.get((row.company || '').toLowerCase().trim());
          return set ? [...set].join(', ') : '';
        }, render: (row) => {
          const set = listFlagsByCompany.get((row.company || '').toLowerCase().trim());
          const flags = set ? [...set] : [];
          if (!flags.length) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>-</span>;
          return (
            <span style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
              {flags.map(label => {
                const color = LIST_FLAG_BY_LABEL[label]?.color || { bg: '#F1F5F9', text: '#334155' };
                return (
                  <span
                    key={label}
                    title={label}
                    style={{ padding: '1px 6px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: color.bg, color: color.text, whiteSpace: 'nowrap' }}
                  >{label}</span>
                );
              })}
            </span>
          );
        }};
      }
      if (col.key === 'divisions') {
        return { ...col, getFilterValue: (row) => (divisionsMap[row.id] || []).map(d => d.company).filter(Boolean).join(', '), render: (row) => <DivisionPicker parentId={row.id} divisions={divisionsMap[row.id] || []} allCompanies={allCompaniesForDivisions} onAdd={addDivision} onAddMany={addDivisions} onRemove={removeDivision} rules={divisionRules[row.id] || []} onSetRule={addDivisionRule} onRemoveRule={removeDivisionRule} /> };
      }
      if (col.key === 'status') {
        const mismatchAccounts = filteredAccounts.filter(a => a.statusMismatch).map(a => a.company);
        return { ...col, label: mismatchAccounts.length > 0 ? `Status ⚠ ${mismatchAccounts.length}` : 'Status', headerTitle: warningHeaderTitle('Status differs from opps-derived suggestion', mismatchAccounts), render: (row) => (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <InlineCell row={row} field="status" value={row.status} onUpdate={onUpdate} options={STATUSES} />
            {row.statusMismatch && <StatusMismatchWarning row={row} onUpdate={onUpdate} />}
          </span>
        )};
      }
      if (col.key === 'type') {
        const typeMismatchAccounts = filteredAccounts.filter(a => a.typeMismatch).map(a => a.company);
        // Source the dropdown options from the configurable "Type" list on
        // the Dropdowns tab; fall back to the built-in enum if it's been
        // hidden or emptied there.
        const typeList = getEffectiveDropdownLists(settings).find(l => l.key === 'type');
        const typeOptions = (typeList && typeList.options && typeList.options.length) ? typeList.options : TYPES;
        return { ...col, label: typeMismatchAccounts.length > 0 ? `Type ⚠ ${typeMismatchAccounts.length}` : 'Type', headerTitle: warningHeaderTitle('Type differs from PE-partner-derived suggestion', typeMismatchAccounts), render: (row) => (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <InlineCell row={row} field="type" value={row.type} onUpdate={onUpdate} options={typeOptions} />
            {row.typeMismatch && <TypeMismatchWarning row={row} onUpdate={onUpdate} />}
          </span>
        )};
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
        const missingAccounts = filteredAccounts.filter(a => !a.hqRegion && !INACTIVE_STATUSES.has(a.status)).map(a => a.company);
        return { ...col, label: missingAccounts.length > 0 ? `HQ Region ⚠ ${missingAccounts.length}` : 'HQ Region', headerTitle: warningHeaderTitle('Missing HQ Region', missingAccounts), render: (row) => <InlineCell row={row} field="hqRegion" value={row.hqRegion} onUpdate={onUpdate} options={['North America', 'Outside of North America']} /> };
      }
      if (col.key === 'naRegion') {
        return { ...col, getFilterValue: (row) => (row.hqRegion ? '' : (hqRegionMap[row.id] || '')), render: (row) => {
          if (row.hqRegion) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.65rem' }}>-</span>;
          const val = hqRegionMap[row.id] || '';
          return (
            <span
              style={{ fontSize: '0.72rem', color: val ? 'var(--color-text)' : 'var(--color-text-muted)', cursor: 'text' }}
              onClick={e => {
                e.stopPropagation();
                const newVal = prompt('HQ Location (City, State, Country):', val);
                if (newVal !== null) {
                  const next = { ...hqRegionMap, [row.id]: newVal.trim() };
                  updateSettings({ hqRegionMap: next });
                }
              }}
            >{val || 'Click to set'}</span>
          );
        }};
      }
      if (col.key === 'bfoCompanyId') {
        return { ...col, render: (row) => <InlineCell row={row} field="bfoCompanyId" value={row.bfoCompanyId} onUpdate={onUpdate} /> };
      }
      if (col.key === 'bfoCompanyName') {
        return { ...col, render: (row) => <InlineCell row={row} field="bfoCompanyName" value={row.bfoCompanyName} onUpdate={onUpdate} /> };
      }
      if (col.key === 'zoomCompanyId') {
        return { ...col, render: (row) => <InlineCell row={row} field="zoomCompanyId" value={row.zoomCompanyId} onUpdate={onUpdate} /> };
      }
      if (col.key === 'zoomCompanyName') {
        return { ...col, render: (row) => <InlineCell row={row} field="zoomCompanyName" value={row.zoomCompanyName} onUpdate={onUpdate} /> };
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
      // MSL Sites count is clickable: opens a popup of the company's Master
      // Site List rows with an Excel download. Even "0" is clickable so the
      // popup can explain there are none yet.
      if (col.key === 'mslSiteCount') {
        return { ...col, render: (row) => {
          const n = row.mslSiteCount || 0;
          const tip = n > 0
            ? `View ${n.toLocaleString()} site${n === 1 ? '' : 's'} from the Master Site List for "${row.company || ''}"`
            : `No sites on the Master Site List for "${row.company || ''}": click for details`;
          return (
            <span
              style={{ fontWeight: n > 0 ? 700 : 400, color: n > 0 ? 'var(--color-accent)' : 'var(--color-text-muted)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px' }}
              title={tip}
              onClick={(e) => { e.stopPropagation(); openSitesPopup(row); }}
            >{n.toLocaleString()}</span>
          );
        }};
      }
      // Skip computed columns — they stay read-only
      if (['myTier', 'activityCount', 'oppsCount', 'contactCount', 'bucketCount', 'naRegion', 'type2', 'dmFound', 'sources', 'targetName', 'otherReps', 'divisions', 'listFlags', '_hide'].includes(col.key)) {
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
      render: (row) => <button className={styles.deleteBtn} onClick={(e) => { e.stopPropagation(); if (confirm(`Remove "${row.company}" from the database?`)) { dismissCompany(row.company); onDelete(row.id); } }} title="Remove">&#x2715;</button>,
    });
    return mapped;
  }, [onSelect, onUpdate, allTargetNames, divisionsMap, allCompaniesForDivisions, duplicateTargetNames, listFlagsByCompany, similarNamesByAccount, filteredAccounts, mslRowsByCompany, settings?.dropdownLists, settings?.dropdownListsHidden]);

  // Prepend a checkbox column for the mass-edit selection. Opps-only rows
  // render no checkbox since they have no backing prospect to update.
  const columnsWithSelect = useMemo(() => {
    const selectColumn = {
      key: '__select__',
      label: '',
      defaultWidth: 36,
      render: (row) => {
        if (!isBulkSelectable(row)) return null;
        return (
          <input
            type="checkbox"
            checked={selectedIds.has(row.id)}
            onChange={(e) => {
              e.stopPropagation();
              setSelectedIds(prev => {
                const next = new Set(prev);
                if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
                return next;
              });
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ cursor: 'pointer', accentColor: 'var(--color-accent)' }}
            aria-label="Select row for bulk edit"
          />
        );
      },
    };
    return [selectColumn, ...columns];
  }, [columns, selectedIds]);

  // Selectable ids among the currently filtered/visible rows, and how many
  // of them are already selected — drives the select-all-visible toggle.
  const selectableVisibleIds = useMemo(
    () => (filteredAccounts || []).filter(isBulkSelectable).map(r => r.id),
    [filteredAccounts]
  );
  const selectedVisibleCount = selectableVisibleIds.filter(id => selectedIds.has(id)).length;
  const allVisibleSelected = selectableVisibleIds.length > 0 && selectedVisibleCount === selectableVisibleIds.length;

  function toggleSelectAllVisible() {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) for (const id of selectableVisibleIds) next.delete(id);
      else for (const id of selectableVisibleIds) next.add(id);
      return next;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }

  const bulkFieldDef = BULK_FIELDS.find(f => f.key === bulkField) || null;

  // Apply the chosen field/value to every selected (real) prospect at once.
  async function applyBulkEdit() {
    if (bulkRunning || !bulkFieldDef) return;
    const ids = [...selectedIds].filter(id => id && !String(id).startsWith('opps-only:'));
    if (ids.length === 0) return;
    const value = bulkFieldDef.type === 'number'
      ? (bulkValue === '' ? '' : Number(bulkValue))
      : bulkValue;
    if (bulkFieldDef.type === 'number' && bulkValue !== '' && Number.isNaN(value)) {
      alert(`"${bulkValue}" is not a valid number.`);
      return;
    }
    const shown = bulkValue === '' ? '(blank)' : bulkValue;
    const ok = window.confirm(`Set ${bulkFieldDef.label} = "${shown}" on ${ids.length} selected account${ids.length === 1 ? '' : 's'}?`);
    if (!ok) return;
    setBulkRunning(true);
    try {
      await Promise.all(ids.map(id => onUpdate(id, { [bulkFieldDef.key]: value })));
      setSelectedIds(new Set());
      setBulkValue('');
    } catch (err) {
      console.error('Bulk edit failed:', err);
      alert('Bulk edit failed: ' + (err?.message || err));
    } finally {
      setBulkRunning(false);
    }
  }

  // Company Type subtab — the My Accounts firms grouped by their Type
  // column instead of listed row-by-row. It renders from the same hooks as
  // the table below, so the two tabs can never disagree about which firms
  // are in the list. Everything past this point is the standard table.
  if (mode === 'companyType') {
    const { groups, total } = typeGroups;
    const shown = typeFocus ? groups.filter(g => g.type === typeFocus) : groups;
    const pct = n => (total ? Math.round((n / total) * 100) : 0);
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
          <button
            onClick={() => setInactiveMode(prev => prev === 'hide' ? 'only' : prev === 'only' ? 'show' : 'hide')}
            title="Cycle how inactive accounts (Old Client / Hold Off / Lost - Not Sold) are counted: hidden → only → all"
            style={{ padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}
          >
            {inactiveMode === 'only' ? 'Inactive only' : inactiveMode === 'show' ? 'Showing all' : 'Inactive hidden'}
          </button>
          {typeFocus && (
            <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '999px', background: '#EBF2FC', color: '#3B7DDD', fontWeight: 600 }}>Showing: {typeFocus}</span>
          )}
          {typeFocus && <button className={styles.clearBtn} onClick={() => setTypeFocus(null)}>Clear type</button>}
          <span className={styles.resultCount}>
            {total} account{total === 1 ? '' : 's'} · {groups.length} type{groups.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className={styles.summary} style={{ flexWrap: 'wrap', gap: '0.6rem' }}>
          {groups.map(g => {
            const accent = TYPE2_COLORS[g.type2]?.color || '#9CA3AF';
            return (
              <button
                key={g.type}
                className={`${styles.summaryCard} ${typeFocus === g.type ? styles.summaryCardActive : ''}`}
                style={{ borderLeftColor: accent, cursor: 'pointer', flex: '1 1 160px', minWidth: 160, textAlign: 'left', padding: '0.7rem 0.9rem' }}
                onClick={() => setTypeFocus(typeFocus === g.type ? null : g.type)}
                title={`Show only ${g.type} accounts`}
              >
                {/* Two lines reserved for the label so a wrapping type name
                    ("Asset Management Firm") doesn't push its count out of
                    line with the shorter cards beside it. */}
                <div className={styles.summaryLabel} style={{ minHeight: '2.2em', lineHeight: 1.1 }}>{g.type}</div>
                <div className={styles.summaryValue}>{g.count}</div>
                <div className={styles.summaryBreakdown}>
                  {pct(g.count)}% of accounts{g.clients > 0 ? ` · ${g.clients} client${g.clients === 1 ? '' : 's'}` : ''}
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: '1rem' }}>
          {shown.length === 0 && (
            <div className={styles.empty}>
              {total === 0 ? 'No accounts to group yet.' : 'No accounts match the current search.'}
            </div>
          )}
          {shown.map(g => {
            const t2 = TYPE2_COLORS[g.type2];
            return (
              <div key={g.type} className={styles.bucketList}>
                <div className={styles.bucketHeader}>
                  <span className={styles.bucketTitle}>
                    {g.type}
                    {g.type2 && (
                      <span style={{ marginLeft: '0.4rem', padding: '1px 6px', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 600, background: t2.bg, color: t2.color }}>{g.type2}</span>
                    )}
                  </span>
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                    {g.count} firm{g.count === 1 ? '' : 's'} · {pct(g.count)}%
                  </span>
                </div>
                <div className={styles.bucketGrid} style={{ maxHeight: 'none' }}>
                  {g.accounts.map(a => {
                    const tier = TIER_CHIP_COLORS[a.myTier];
                    return (
                      <span
                        key={a.id || a.company}
                        className={styles.bucketChip}
                        title={`${a.company}${a.myTier ? ` · ${a.myTier}` : ''}${a.status ? ` · ${a.status}` : ''} · ${a.contactCount || 0} contact${(a.contactCount || 0) === 1 ? '' : 's'} — click to open`}
                        onClick={() => onSelect(a)}
                      >
                        {tier && (
                          <span style={{ padding: '0 5px', borderRadius: '999px', fontSize: '0.6rem', fontWeight: 700, background: tier.bg, color: tier.color }}>
                            {a.myTier.replace('Tier ', 'T')}
                          </span>
                        )}
                        {a.company}
                        {a.status === 'Client' && (
                          <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#059669' }}>CLIENT</span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      {(() => {
        // Company mappings resolve against `targetAccounts` — the Target
        // Accounts list, filtered to this CDM + Tier 1/2. When that list
        // comes back empty, every auto-fuzzy mapping silently vanishes and
        // the picker dropdown empties, which reads as "all my mappings
        // disappeared." Surface the two ways it collapses so the failure is
        // actionable instead of mysterious: (1) the Target Accounts data
        // never loaded, or (2) it loaded but nothing matched the CDM.
        if (!prospects || prospects.length === 0) return null;
        if (targetAccounts.length > 0) return null;
        const dataLoaded = !!(targetAccountsData && targetAccountsData.sheets &&
          (targetAccountsData.sheetNames || []).some(n => targetAccountsData.sheets[n]?.records?.length));
        return (
          <div
            role="status"
            style={{
              display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
              padding: '0.6rem 0.85rem', margin: '0 0 0.6rem',
              background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '8px',
              fontSize: '0.78rem', color: '#991B1B', lineHeight: 1.4,
            }}
          >
            <span style={{ fontSize: '1rem', lineHeight: 1 }}>&#9888;</span>
            <span>
              <strong>Company mappings can&rsquo;t resolve: your Target Accounts list is empty.</strong>{' '}
              {dataLoaded
                ? <>The list loaded, but no accounts matched your CDM{cdmName ? <> &ldquo;{cdmName}&rdquo;</> : ' (no CDM name set)'}. Check your CDM name in Settings, or the owner/CDM column on the Target Accounts sheet (Lists &rarr; Targets).</>
                : <>The Target Accounts list didn&rsquo;t load. Open Lists &rarr; Targets to re-upload it: auto-mapped companies will repopulate once it&rsquo;s back.</>}
            </span>
          </div>
        );
      })()}
      <div className={styles.filterBar}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search accounts..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {Object.entries(filterOptions).map(([key, options]) => {
          const col = ACCOUNT_COLUMNS.find(c => c.key === key);
          return <FilterDrop key={key} label={col?.label || key} options={options} selected={filters[key] || []} onToggle={v => toggleFilter(key, v)} />;
        })}
        {(() => {
          // Surface inactive-hidden matches only — the accounts list
          // also hides prospects assigned to other CDMs / no-tier
          // rows, but those don't read as "hidden" to the user. The
          // ones they care about are companies in their territory
          // that are being hidden by the inactiveMode=hide filter
          // (Old Client / Hold Off / Lost - Not Sold). Skip the
          // banner entirely when inactiveMode is already showing
          // them.
          const term = search.trim().toLowerCase();
          if (!term) return null;
          if (inactiveMode !== 'hide') return null;
          const inactiveStatuses = new Set(['Old Client', 'Hold Off', 'Lost - Not Sold']);
          const seen = new Set();
          const hidden = [];
          for (const p of (prospects || [])) {
            const name = (p.company || '').trim();
            if (!name) continue;
            const lower = name.toLowerCase();
            if (!lower.includes(term)) continue;
            if (seen.has(lower)) continue;
            if (!inactiveStatuses.has(p.status)) continue;
            if (!matchesCdm(p.cdm, cdmName)) continue;
            seen.add(lower);
            hidden.push({ name, status: p.status });
            if (hidden.length >= 10) break;
          }
          if (hidden.length === 0) return null;
          return (
            <div
              role="status"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.3rem',
                padding: '0.25rem 0.55rem',
                background: '#FEF3C7',
                border: '1px solid #F59E0B',
                borderRadius: '6px',
                fontSize: '0.7rem',
                color: '#92400E',
                fontWeight: 600,
              }}
              title="These accounts match your search but are hidden by the Inactive filter. Click the Inactive summary card to reveal them."
            >
              ⚠ Inactive hidden:
              {hidden.map(h => (
                <span key={h.name} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.05rem 0.45rem', background: '#fff', border: '1px solid #FDE68A', borderRadius: '999px' }}>
                  <span style={{ color: '#92400E' }}>{h.name}</span>
                  <span style={{ color: '#B45309', fontWeight: 500, fontSize: '0.62rem' }}>· {h.status}</span>
                </span>
              ))}
            </div>
          );
        })()}
        {(() => {
          // Surface dismissed matches — dismissed companies are removed
          // from the accounts list entirely, so searching for one comes up
          // empty with no explanation. Flag them like inactive-hidden rows,
          // with a quick restore so they can be brought back to the list.
          const term = search.trim().toLowerCase();
          if (!term) return null;
          const matched = dismissedCompanies.filter(name => (name || '').toLowerCase().includes(term)).slice(0, 10);
          if (matched.length === 0) return null;
          return (
            <div
              role="status"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.3rem',
                padding: '0.25rem 0.55rem',
                background: '#F1F5F9',
                border: '1px solid #CBD5E1',
                borderRadius: '6px',
                fontSize: '0.7rem',
                color: '#475569',
                fontWeight: 600,
              }}
              title="These accounts match your search but were dismissed. Click × to restore one to your list."
            >
              🚫 Dismissed:
              {matched.map(name => (
                <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.05rem 0.45rem', background: '#fff', border: '1px solid #E2E8F0', borderRadius: '999px' }}>
                  <span style={{ color: '#475569' }}>{name}</span>
                  <button
                    onClick={() => undismissCompany(name)}
                    title="Restore"
                    style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '0.75rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                    onMouseEnter={e => e.target.style.color = '#22C55E'}
                    onMouseLeave={e => e.target.style.color = '#94A3B8'}
                  >&times;</button>
                </span>
              ))}
            </div>
          );
        })()}
        {bucketFilter && <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '999px', background: '#EBF2FC', color: '#3B7DDD', fontWeight: 600 }}>Showing: {bucketFilter === 'tier1' ? 'Tier 1' : bucketFilter === 'tier2' ? 'Tier 2' : bucketFilter === 'client' ? 'Clients' : bucketFilter === 'noTarget' ? 'No Target Mapped' : 'Tier 3'}</span>}
        {(activeFilterCount > 0 || bucketFilter) && <button className={styles.clearBtn} onClick={clearFilters}>Clear all</button>}
        <button
          onClick={bulkLookupHqRegion}
          disabled={hqLookupRunning}
          style={{ padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.7rem', fontWeight: 600, cursor: hqLookupRunning ? 'wait' : 'pointer', fontFamily: 'inherit', color: 'var(--color-accent)', whiteSpace: 'nowrap' }}
        >
          {hqLookupRunning ? 'Looking up HQs...' : 'Auto-detect HQ Location'}
        </button>
        {Object.keys(hqRegionMap).length > 0 && (
          <button
            onClick={clearHqLocations}
            style={{ padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: '#DC2626', whiteSpace: 'nowrap' }}
          >
            Clear HQ Data
          </button>
        )}
        <button
          onClick={() => zoomFileRef.current?.click()}
          style={{ padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-accent)', whiteSpace: 'nowrap' }}
        >Import Zoom Mapping</button>
        <input ref={zoomFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleZoomFileSelect} />
        <button
          onClick={downloadAccountsWithoutContacts}
          title="Download a CSV of the accounts in the current view that have no HubSpot contacts yet, with their Zoom / website data from Table View"
          style={{ padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-accent)', whiteSpace: 'nowrap' }}
        >⇩ Accounts w/o contacts</button>
        <button
          onClick={applyAllTierFlags}
          disabled={tierSyncRunning || tierFlagged.length === 0}
          title="Set every flagged account's Tier to the tier its Target Accounts row specifies: applies all the ⚠ tier-mismatch flags in the Tier column at once."
          style={{ padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.7rem', fontWeight: 600, cursor: (tierSyncRunning || tierFlagged.length === 0) ? 'default' : 'pointer', fontFamily: 'inherit', color: tierFlagged.length === 0 ? 'var(--color-text-secondary)' : '#F59E0B', whiteSpace: 'nowrap', opacity: tierFlagged.length === 0 ? 0.6 : 1 }}
        >
          {tierSyncRunning ? 'Updating tiers…' : `⚠ Apply tier flags${tierFlagged.length ? ` (${tierFlagged.length})` : ''}`}
        </button>
        {ignoredTierMismatches.length > 0 && (
          <button
            onClick={resetTierMismatchIgnores}
            title="Restore every tier-mismatch flag you previously dismissed so the ⚠ warnings re-appear for review."
            style={{ padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-accent)', whiteSpace: 'nowrap' }}
          >
            ↺ Restore dismissed flags ({ignoredTierMismatches.length})
          </button>
        )}
        {onDedupe && (
          <button
            onClick={handleDedupe}
            disabled={dedupeRunning}
            title="Find accounts saved as two or more records (the same company twice) and collapse each into its most complete record. Removes the duplicate rows you see here and on other pages."
            style={{ padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.7rem', fontWeight: 600, cursor: dedupeRunning ? 'wait' : 'pointer', fontFamily: 'inherit', color: '#DC2626', whiteSpace: 'nowrap' }}
          >
            {dedupeRunning ? 'Removing duplicates…' : 'Remove duplicates'}
          </button>
        )}
        <span className={styles.resultCount}>{filteredAccounts.length} of {allAccounts.length}</span>
      </div>
      {targetAccounts.length > 0 && (() => {
        const targetNames = targetAccounts.map(t => (t.company || '').toLowerCase());
        const myNames = allAccounts.map(a => (a.company || '').toLowerCase());
        // Also consider manual target name mappings as "matched"
        const mappedTargetNames = new Set(allAccounts.flatMap(a => (a.targetNames || []).map(n => n.toLowerCase())));
        const onlyMyAccounts = allAccounts.filter(a => a.myTier !== 'Tier 3' && (!a.targetNames || a.targetNames.length === 0) && !fuzzyHas(targetNames, a.company));
        const onlyTarget = targetAccounts.filter(t => !fuzzyHas(myNames, t.company) && !mappedTargetNames.has((t.company || '').toLowerCase()));
        try {
          if (typeof localStorage !== 'undefined' && localStorage.getItem('debug-myaccounts')) {
            console.log('Target accounts loaded:', targetAccounts.map(t => t.company));
            console.log('My accounts loaded:', allAccounts.map(a => a.company));
            console.log('On Target but NOT My Accounts:', onlyTarget.map(t => t.company));
            console.log('On My Accounts but NOT Target:', onlyMyAccounts.map(a => a.company));
          }
        } catch {}
        if (onlyMyAccounts.length === 0 && onlyTarget.length === 0) return null;
        return (
          <div className={styles.mismatchSection}>
            {onlyMyAccounts.length > 0 && (
              <div className={styles.missingBanner}>
                <div className={styles.missingTitle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span>{onlyMyAccounts.length} on My Accounts but NOT on Target Accounts List</span>
                  <button
                    type="button"
                    onClick={() => moveOnlyMyAccountsToTier3(onlyMyAccounts)}
                    disabled={tier3BulkRunning}
                    title="Set every account listed here (on My Accounts but not on the Target Accounts List) to Tier 3."
                    style={{ padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid #3B82F6', background: tier3BulkRunning ? 'var(--color-surface)' : '#3B82F6', color: tier3BulkRunning ? 'var(--color-text-secondary)' : '#fff', fontSize: '0.7rem', fontWeight: 700, cursor: tier3BulkRunning ? 'wait' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                  >
                    {tier3BulkRunning ? 'Moving…' : `Move all to Tier 3 (${onlyMyAccounts.length})`}
                  </button>
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
                        cdm: cdmName || '',
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
          const mappedNames = new Set(allAccounts.flatMap(a => (a.targetNames || []).map(n => n.toLowerCase())));
          const t1Missing = targetAccounts.filter(t => t.tier === 'Tier 1' && !fuzzyHas(myNames, t.company) && !mappedNames.has((t.company || '').toLowerCase())).length;
          const t2Missing = targetAccounts.filter(t => t.tier === 'Tier 2' && !fuzzyHas(myNames, t.company) && !mappedNames.has((t.company || '').toLowerCase())).length;
          return <>
            <button className={`${styles.summaryCard} ${bucketFilter === 'tier1' ? styles.summaryCardActive : ''}`} style={{ borderLeftColor: '#DC2626' }} onClick={() => { setBucketFilter(bucketFilter === 'tier1' ? null : 'tier1'); setExpandedBucket(expandedBucket === 'tier1' ? null : 'tier1'); }}>
              <div className={styles.summaryLabel}>Tier 1</div>
              <div className={styles.summaryValue}>{tier1.length}</div>
              {t1Missing > 0 && <div className={styles.summaryBreakdown} style={{ color: '#DC2626' }}>{t1Missing} not in list</div>}
            </button>
            <button className={`${styles.summaryCard} ${bucketFilter === 'tier2' ? styles.summaryCardActive : ''}`} style={{ borderLeftColor: '#3B82F6' }} onClick={() => { setBucketFilter(bucketFilter === 'tier2' ? null : 'tier2'); setExpandedBucket(expandedBucket === 'tier2' ? null : 'tier2'); }}>
              <div className={styles.summaryLabel}>Tier 2</div>
              <div className={styles.summaryValue}>{tier2.filter(a => a.myTier === 'Tier 2').length}</div>
              {t2Missing > 0 && <div className={styles.summaryBreakdown} style={{ color: '#3B82F6' }}>{t2Missing} not in list</div>}
            </button>
          </>;
        })()}
        <button
          className={`${styles.summaryCard} ${inactiveMode !== 'hide' ? styles.summaryCardActive : ''}`}
          style={{ borderLeftColor: inactiveMode === 'only' ? '#EF4444' : inactiveMode === 'show' ? '#F59E0B' : '#9CA3AF', cursor: 'pointer' }}
          onClick={() => setInactiveMode(prev => prev === 'hide' ? 'only' : prev === 'only' ? 'show' : 'hide')}
        >
          <div className={styles.summaryLabel}>{inactiveMode === 'only' ? 'Inactive Only' : inactiveMode === 'show' ? 'Showing All' : 'Inactive Hidden'}</div>
          <div className={styles.summaryValue}>{allAccounts.filter(a => INACTIVE_STATUSES.has(a.status)).length}</div>
        </button>
        <button className={`${styles.summaryCard} ${bucketFilter === 'client' ? styles.summaryCardActive : ''}`} style={{ borderLeftColor: '#10B981', cursor: 'pointer' }} onClick={() => setBucketFilter(bucketFilter === 'client' ? null : 'client')}>
          <div className={styles.summaryLabel}>Clients</div>
          <div className={styles.summaryValue}>{clientCount}</div>
        </button>
        <button className={`${styles.summaryCard} ${bucketFilter === 'pipeline' ? styles.summaryCardActive : ''}`} style={{ borderLeftColor: '#F59E0B', cursor: 'pointer' }} onClick={() => setBucketFilter(bucketFilter === 'pipeline' ? null : 'pipeline')}>
          <div className={styles.summaryLabel}>Tier 3</div>
          <div className={styles.summaryValue}>{tier3Count}</div>
        </button>
        <button className={`${styles.summaryCard} ${bucketFilter === 'noTarget' ? styles.summaryCardActive : ''}`} style={{ borderLeftColor: '#9CA3AF', cursor: 'pointer' }} onClick={() => setBucketFilter(bucketFilter === 'noTarget' ? null : 'noTarget')}>
          <div className={styles.summaryLabel}>No Target Mapped</div>
          <div className={styles.summaryValue}>{allAccounts.filter(a => !a.targetNames || a.targetNames.length === 0).length}</div>
        </button>
      </div>
      {dismissedCompanies.length > 0 && (
        <div style={{ padding: '0 1.25rem 0.4rem' }}>
          <button
            onClick={() => setShowDismissed(o => !o)}
            style={{ fontSize: '0.65rem', color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}
          >{showDismissed ? 'Hide' : 'Show'} {dismissedCompanies.length} dismissed compan{dismissedCompanies.length === 1 ? 'y' : 'ies'}</button>
          {showDismissed && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.3rem' }}>
              {dismissedCompanies.map(name => (
                <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.1rem 0.5rem', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '999px', fontSize: '0.65rem', color: '#64748B' }}>
                  {name}
                  <button
                    onClick={() => undismissCompany(name)}
                    title="Restore"
                    style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '0.75rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                    onMouseEnter={e => e.target.style.color = '#22C55E'}
                    onMouseLeave={e => e.target.style.color = '#94A3B8'}
                  >&times;</button>
                </span>
              ))}
              <button
                onClick={() => { if (confirm('Clear all dismissed companies? They may be auto-recreated on next load.')) updateSettings({ dismissedCompanies: [] }); }}
                style={{ fontSize: '0.62rem', color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}
              >Clear all</button>
            </div>
          )}
        </div>
      )}
      {expandedBucket && (() => {
        const myNames = allAccounts.map(a => (a.company || '').toLowerCase());
        const mappedNames = new Set(allAccounts.flatMap(a => (a.targetNames || []).map(n => n.toLowerCase())));
        const tierLabel = expandedBucket === 'tier1' ? 'Tier 1' : 'Tier 2';
        const notInMyAccounts = targetAccounts
          .filter(t => t.tier === tierLabel && !fuzzyHas(myNames, t.company) && !mappedNames.has((t.company || '').toLowerCase()));
        if (notInMyAccounts.length === 0) return (
          <div className={styles.bucketList}>
            <div className={styles.bucketHeader}>
              <span className={styles.bucketTitle}>{tierLabel}: Not in My Accounts</span>
              <button className={styles.bucketClose} onClick={() => setExpandedBucket(null)}>&times;</button>
            </div>
            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>All {tierLabel} companies are already in My Accounts</div>
          </div>
        );
        return (
          <div className={styles.bucketList}>
            <div className={styles.bucketHeader}>
              <span className={styles.bucketTitle}>{tierLabel}: {notInMyAccounts.length} Not in My Accounts</span>
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

      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', padding: '0.4rem 0.75rem', borderTop: '1px solid var(--color-border)' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: selectableVisibleIds.length ? 'pointer' : 'default' }}>
          <input
            type="checkbox"
            checked={allVisibleSelected}
            ref={el => { if (el) el.indeterminate = selectedVisibleCount > 0 && !allVisibleSelected; }}
            disabled={selectableVisibleIds.length === 0}
            onChange={toggleSelectAllVisible}
            style={{ cursor: 'pointer', accentColor: 'var(--color-accent)' }}
          />
          Select all ({selectableVisibleIds.length})
        </label>
        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: selectedIds.size ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
          {selectedIds.size} selected
        </span>
        <select
          value={bulkField}
          onChange={e => { setBulkField(e.target.value); setBulkValue(''); }}
          disabled={selectedIds.size === 0}
          style={{ padding: '0.25rem 0.5rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.7rem', fontFamily: 'inherit', cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer' }}
        >
          <option value="">Field to set…</option>
          {BULK_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        {bulkFieldDef && (bulkFieldDef.options
          ? (
            <select
              value={bulkValue}
              onChange={e => setBulkValue(e.target.value)}
              style={{ padding: '0.25rem 0.5rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.7rem', fontFamily: 'inherit', cursor: 'pointer' }}
            >
              <option value="">(blank)</option>
              {bulkFieldDef.options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input
              type={bulkFieldDef.type === 'number' ? 'number' : 'text'}
              value={bulkValue}
              onChange={e => setBulkValue(e.target.value)}
              placeholder={`New ${bulkFieldDef.label}…`}
              style={{ padding: '0.25rem 0.5rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.7rem', fontFamily: 'inherit', minWidth: 140 }}
            />
          ))}
        <button
          onClick={applyBulkEdit}
          disabled={bulkRunning || selectedIds.size === 0 || !bulkFieldDef}
          style={{ padding: '0.25rem 0.7rem', borderRadius: '6px', border: 'none', background: (bulkRunning || selectedIds.size === 0 || !bulkFieldDef) ? 'var(--color-border)' : 'var(--color-accent)', color: '#fff', fontSize: '0.7rem', fontWeight: 600, cursor: (bulkRunning || selectedIds.size === 0 || !bulkFieldDef) ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
        >
          {bulkRunning ? 'Applying…' : `Apply to ${selectedIds.size}`}
        </button>
        {selectedIds.size > 0 && (
          <button
            onClick={clearSelection}
            style={{ padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}
          >
            Clear selection
          </button>
        )}
      </div>
      <div className={styles.tableWrap}>
        <DataTable
          tableId="my-accounts"
          exportFileName="My Accounts export"
          onFilteredRowsChange={handleTableFilteredRows}
          toolbarActions={[{
            key: 'zoom-export',
            label: 'Zoom Export',
            title: 'Download a CSV of the rows shown here whose status is Inside Sales: Company, Zoom Company ID, Zoom Company Name, Zoom Website',
            onClick: downloadZoomExport,
          }]}
          columns={columnsWithSelect}
          rows={filteredAccounts}
          alwaysVisible={['__select__', 'company']}
          enableColumnFilters
          rowStyle={(row) => {
            const s = row.status;
            return (s === 'Lost - Not Sold' || s === 'Hold Off' || s === 'Old Client') ? { opacity: 0.45 } : undefined;
          }}
          emptyMessage="No matching accounts found"
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>

      {/* Zoom Import Column Mapping Modal */}
      {zoomImportPreview && createPortal(
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setZoomImportPreview(null)}>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', width: '520px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>Column Mapping</h3>
              <button onClick={() => setZoomImportPreview(null)} style={{ background: 'none', border: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer' }}>&times;</button>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', margin: '0 0 1rem 0' }}>
              {zoomImportPreview.rows.length} rows found. Map your file columns to the fields below:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.25rem' }}>
              {ZOOM_FIELDS.map(field => {
                const detected = zoomImportPreview.mapping[field.key];
                return (
                  <div key={field.key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: '160px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)' }}>{field.label}</div>
                    <span style={{ color: '#94A3B8', fontSize: '0.75rem' }}>&rarr;</span>
                    <select
                      value={detected}
                      onChange={e => setZoomImportPreview(prev => ({
                        ...prev,
                        mapping: { ...prev.mapping, [field.key]: e.target.value },
                      }))}
                      style={{ flex: 1, padding: '0.35rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.78rem', fontFamily: 'inherit', background: detected ? '#DCFCE7' : '#FEF2F2', color: detected ? '#166534' : '#DC2626' }}
                    >
                      <option value="">(Not mapped)</option>
                      {zoomImportPreview.headers.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                    {detected && <span style={{ color: '#10B981', fontSize: '0.7rem', fontWeight: 600 }}>&#10003;</span>}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setZoomImportPreview(null)} style={{ padding: '0.5rem 1rem', border: '1px solid var(--color-border)', borderRadius: '6px', background: '#fff', fontSize: '0.8rem', fontFamily: 'inherit', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>Cancel</button>
              <button onClick={executeZoomImport} style={{ padding: '0.5rem 1rem', border: 'none', borderRadius: '6px', background: 'var(--color-accent)', color: '#fff', fontSize: '0.8rem', fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600 }}>Import</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {sitesPopup && createPortal(
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setSitesPopup(null)}>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '1.25rem 1.5rem', width: '920px', maxWidth: '96vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>
                {sitesPopup.company}: Sites <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>({sitesPopup.rows.length})</span>
              </h3>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                <button
                  onClick={() => exportSitesExcel(sitesPopup.company, sitesPopup.rows)}
                  disabled={!sitesPopup.rows.length}
                  style={{ padding: '0.4rem 0.85rem', border: 'none', borderRadius: '6px', background: sitesPopup.rows.length ? 'var(--color-accent)' : 'var(--color-border)', color: '#fff', fontSize: '0.78rem', fontFamily: 'inherit', fontWeight: 600, cursor: sitesPopup.rows.length ? 'pointer' : 'default' }}
                >Export Excel</button>
                <button onClick={() => setSitesPopup(null)} style={{ background: 'none', border: 'none', fontSize: '1.3rem', color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
              </div>
            </div>
            {sitesPopup.rows.length === 0 ? (
              <p style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', margin: '1rem 0' }}>
                No sites found for this company in the Master Site List. Add them on the Master Site List page (Lists &rarr; Master Site List).
              </p>
            ) : (
              <div style={{ overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.74rem' }}>
                  <thead>
                    <tr>
                      <th style={{ position: 'sticky', top: 0, background: 'var(--color-surface-alt)', textAlign: 'right', fontWeight: 700, color: 'var(--color-text-secondary)', padding: '0.45rem 0.6rem', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>#</th>
                      {MASTER_FIELDS.map(f => (
                        <th key={f.key} style={{ position: 'sticky', top: 0, background: 'var(--color-surface-alt)', textAlign: 'left', fontWeight: 700, color: 'var(--color-text-secondary)', padding: '0.45rem 0.6rem', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sitesPopup.rows.map((r, i) => (
                      <tr key={i}>
                        <td style={{ padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--color-border-light)', textAlign: 'right', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{i + 1}</td>
                        {MASTER_FIELDS.map(f => (
                          <td key={f.key} style={{ padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--color-border-light)', whiteSpace: 'nowrap', color: 'var(--color-text)' }}>
                            {r[f.key] || <span style={{ color: 'var(--color-text-muted)' }}>-</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
