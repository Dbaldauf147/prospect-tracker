import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
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
  { key: 'type2', label: 'Type 2', defaultWidth: 110, render: (row) => {
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
    const val = TYPE2_MAP[row.type] || '';
    const colors = {
      'Real Estate': { bg: '#DBEAFE', color: '#1E40AF' },
      'Private Equity': { bg: '#F3E8FF', color: '#7C3AED' },
      'Other': { bg: '#F3F4F6', color: '#6B7280' },
    };
    const s = colors[val] || colors['Other'];
    return val ? <span style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 600, background: s.bg, color: s.color }}>{val}</span> : <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
  }},
  { key: 'geography', label: 'Geography', defaultWidth: 100 },
  { key: 'publicPrivate', label: 'Pub/Priv', defaultWidth: 80 },
  { key: 'reAum', label: 'RE AUM', defaultWidth: 90, render: (row) => formatAum(row.reAum) },
  { key: 'peAum', label: 'PE AUM', defaultWidth: 90, render: (row) => formatAum(row.peAum) },
  { key: 'numberOfSites', label: 'Sites', defaultWidth: 70, render: (row) => row.numberOfSites != null ? row.numberOfSites.toLocaleString() : '—' },
  { key: 'frameworks', label: 'Frameworks', defaultWidth: 140, render: (row) => (row.frameworks || []).join(', ') || '—' },
  { key: 'hqRegion', label: 'HQ Region', defaultWidth: 130 },
  { key: 'naRegion', label: 'HQ Location', defaultWidth: 180, render: null },
  { key: 'cdm', label: 'CDM', defaultWidth: 120 },
  { key: 'notes', label: 'Notes', defaultWidth: 200 },
  { key: 'contactCount', label: 'Contacts', defaultWidth: 80, render: (row) => row.contactCount > 0 ? <span style={{ fontWeight: 700, color: '#0891B2' }}>{row.contactCount}</span> : <span style={{ color: 'var(--color-text-muted)' }}>0</span> },
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
  { key: 'dmFound', label: 'Decision Maker', defaultWidth: 140, render: (row) => row.dmFound
    ? <span title={row.dmNames} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        <span style={{ color: '#10B981', fontWeight: 700, fontSize: '0.75rem' }}>&#10003;</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text)' }}>{row.dmNames}</span>
      </span>
    : <span style={{ color: 'var(--color-danger)', fontWeight: 600, fontSize: '0.75rem' }}>Not Found</span>
  },
  { key: 'targetName', label: 'Target Accounts Name', defaultWidth: 200, render: null /* set in columns memo */ },
  { key: 'divisions', label: 'Divisions', defaultWidth: 200, render: null /* set in columns memo */ },
  { key: 'otherReps', label: 'Other Reps', defaultWidth: 260, render: (row) => {
    if (!row.otherReps || row.otherReps.length === 0) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>—</span>;
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


function DivisionPicker({ parentId, divisions, allCompanies, onAdd, onRemove, rules, onSetRule, onRemoveRule }) {
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
                    onClick={e => { e.stopPropagation(); filtered.slice(0, 30).forEach(c => { if (!divisionIds.has(c.id)) onAdd(parentId, c.id, c.company); }); }}
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

function TargetNamePicker({ values, companyId, targetOptions, onToggle, duplicates }) {
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
    setDropPos({ top: rect.bottom + 2, left: rect.left });
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
        title={hasDupe ? `⚠ Duplicate mapping: ${values.filter(v => duplicates.has(v)).join(', ')}` : (count > 1 ? values.join('\n') : '')}
        style={{ fontSize: '0.72rem', cursor: 'pointer', background: hasDupe ? '#FEF3C7' : count > 0 ? '#EBF2FC' : 'none', border: hasDupe ? '1px solid #F59E0B' : count > 0 ? '1px solid #BFDBFE' : '1px solid transparent', padding: '2px 8px', borderRadius: '4px', fontFamily: 'inherit', fontWeight: 500, color: hasDupe ? '#92400E' : count > 0 ? '#1E40AF' : 'var(--color-accent)', textAlign: 'left', lineHeight: 1.3 }}
      >
        {hasDupe && <span style={{ marginRight: '0.25rem' }}>&#9888;</span>}
        {count === 0 ? '— Click to map —' : count === 1 ? values[0] : `${values[0]} +${count - 1} more`}
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

function TierMismatchWarning({ row, onDismiss }) {
  const [open, setOpen] = useState(false);
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
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '0.6rem 0.8rem', minWidth: '200px',
          }}
        >
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.3rem' }}>Tier Mismatch</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
            Your tier: <strong>{row.myTier}</strong><br/>
            Target Accounts says: <strong>{row.targetTier}</strong>
          </div>
          <button
            onClick={() => { onDismiss(); setOpen(false); }}
            style={{
              width: '100%', padding: '0.35rem 0.6rem', border: 'none', borderRadius: '6px',
              background: 'var(--color-accent)', color: '#fff', fontSize: '0.72rem', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >Dismiss</button>
        </div>
      )}
    </span>
  );
}

export function MyAccountsView({ prospects, onSelect, onUpdate, onDelete, onAdd, targetAccountsData, settings, updateSettings }) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({});
  const [expandedBucket, setExpandedBucket] = useState(null);
  const [bucketFilter, setBucketFilter] = useState(null); // 'tier1' | 'tier2' | 'client' | 'pipeline' | null
  const [hqLookupRunning, setHqLookupRunning] = useState(false);
  const [inactiveMode, setInactiveMode] = useState('hide'); // 'hide' | 'only' | 'show'
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
      const res = await fetch('/api/hq-lookup', {
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

  function toggleTargetMapping(companyId, targetName) {
    const next = { ...targetMap };
    const existing = Array.isArray(next[companyId]) ? next[companyId] : (next[companyId] ? [next[companyId]] : []);
    if (existing.includes(targetName)) {
      const updated = existing.filter(n => n !== targetName);
      if (updated.length === 0) delete next[companyId];
      else next[companyId] = updated;
    } else {
      next[companyId] = [...existing, targetName];
    }
    updateSettings({ targetMap: next });
  }

  function addDivision(parentId, childId, childCompany) {
    const next = { ...divisionsMap };
    const existing = next[parentId] || [];
    if (!existing.find(d => d.id === childId)) {
      next[parentId] = [...existing, { id: childId, company: childCompany }];
    }
    updateSettings({ divisionsMap: next });
    return next;
  }

  function addDivisionRule(parentId, keyword) {
    const nextRules = { ...divisionRules };
    const existing = nextRules[parentId] || [];
    if (!existing.includes(keyword)) nextRules[parentId] = [...existing, keyword];
    // Auto-add all matching companies as divisions
    const matches = prospects.filter(c => c.id !== parentId && c.company.toLowerCase().includes(keyword.toLowerCase()));
    const nextDivisions = { ...divisionsMap };
    for (const c of matches) {
      const divExisting = nextDivisions[parentId] || [];
      if (!divExisting.find(d => d.id === c.id)) {
        nextDivisions[parentId] = [...divExisting, { id: c.id, company: c.company }];
      }
    }
    updateSettings({ divisionRules: nextRules, divisionsMap: nextDivisions });
  }

  function removeDivisionRule(parentId, ruleIndex) {
    const next = { ...divisionRules };
    const existing = [...(next[parentId] || [])];
    existing.splice(ruleIndex, 1);
    if (existing.length === 0) delete next[parentId];
    else next[parentId] = existing;
    updateSettings({ divisionRules: next });
  }

  function removeDivision(parentId, childId) {
    const next = { ...divisionsMap };
    next[parentId] = (next[parentId] || []).filter(d => d.id !== childId);
    if (next[parentId].length === 0) delete next[parentId];
    updateSettings({ divisionsMap: next });
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

      for (const r of sheet.records) {
        const companyForLog = findCol(r, ['Account', 'Company', 'Account Name', 'Client', 'Name']);
        let cdm = findCol(r, ['CDM', 'Salesperson', 'Sales Rep', 'Account Owner', 'Owner', 'Rep', 'Assigned', 'Team Member', 'Sales']).toLowerCase();
        if (!cdm) {
          cdm = Object.values(r).find(v => String(v || '').toLowerCase().includes('baldauf')) || '';
          cdm = String(cdm).toLowerCase();
        }
        if (!cdm.includes('baldauf') && !cdm.includes('dan b')) {
          if (companyForLog) skippedAccounts.push({ company: companyForLog, reason: `CDM="${cdm}" (not Baldauf)` });
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
    console.log(`Target Accounts: found ${accounts.length} Dan Baldauf Tier 1/2 accounts`);
    if (skippedAccounts.length > 0) console.log('Target Accounts SKIPPED:', skippedAccounts);
    return accounts;
  }, [targetAccountsData]);

  // All Target Accounts with their salesperson (for cross-rep detection)
  const allTargetReps = useMemo(() => {
    const data = targetAccountsData;
    if (!data?.sheets) return [];
    const results = [];

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
        let rep = findCol(r, ['CDM', 'Salesperson', 'Sales Rep', 'Account Owner', 'Owner', 'Rep', 'Assigned', 'Team Member']);
        if (!rep) continue;
        const repLower = rep.toLowerCase();
        // Skip Dan's own entries
        if (repLower.includes('baldauf') || repLower.includes('dan b')) continue;
        results.push({ company: company.trim(), rep: rep.trim() });
      }
    }
    return results;
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
  }, [prospects]);

  // Load opps cache and count active opps per account
  const [oppsRecords, setOppsRecords] = useState([]);
  useEffect(() => {
    // Try IndexedDB first, then localStorage fallback
    (async () => {
      try {
        const req = indexedDB.open('prospect-tracker-db', 3);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('target-accounts')) db.createObjectStore('target-accounts');
          if (!db.objectStoreNames.contains('opps-cache')) db.createObjectStore('opps-cache');
          if (!db.objectStoreNames.contains('clients-cache')) db.createObjectStore('clients-cache');
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

  const { activeOppsByAccount, totalOppsByAccount, suggestedStatusByAccount } = useMemo(() => {
    const active = {};
    const total = {};
    const stagesByAccount = {}; // account → { sold: N, notSold: N, other: N }
    if (oppsRecords.length === 0) return { activeOppsByAccount: active, totalOppsByAccount: total, suggestedStatusByAccount: {} };
    const closedStages = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
    for (const r of oppsRecords) {
      const account = (r['Account'] || '').toLowerCase();
      const stage = (r['Stage'] || '').trim();
      if (!account) continue;

      // Track stage breakdown for status suggestion
      if (!stagesByAccount[account]) stagesByAccount[account] = { sold: 0, notSold: 0, active: 0 };
      const invalidStages = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);
      if (stage === 'Sold') {
        stagesByAccount[account].sold++;
      } else if (stage === 'Not Sold' || stage === 'Lost') {
        stagesByAccount[account].notSold++;
      } else if (stage && !closedStages.has(stage) && !invalidStages.has(stage)) {
        stagesByAccount[account].active++;
      }

      // Existing active/total logic
      if (closedStages.has(stage)) continue;
      const openYear = (r['Open Year'] || '').trim();
      if (!/^\d{4}$/.test(openYear)) continue;
      total[account] = (total[account] || 0) + 1;
      const callIn = (r['Call In'] || '').trim();
      if (callIn && callIn !== '-') {
        active[account] = (active[account] || 0) + 1;
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

    // Debug: log Hellman & Friedman opps data
    for (const [account, stages] of Object.entries(stagesByAccount)) {
      if (account.includes('hellman')) {
        console.log(`Opps debug "${account}": sold=${stages.sold}, notSold=${stages.notSold}, active=${stages.active} → suggested: ${suggested[account]}`);
        // Log the actual opp records for this account
        const hfOpps = oppsRecords.filter(r => (r['Account'] || '').toLowerCase().includes('hellman'));
        hfOpps.forEach(r => console.log(`  Opp: Stage="${r['Stage']}", Account="${r['Account']}"`));
      }
    }

    return { activeOppsByAccount: active, totalOppsByAccount: total, suggestedStatusByAccount: suggested };
  }, [oppsRecords]);

  // Build source maps: which companies exist in each data source
  const BUCKET_TAGS = ['esg', 'procurement', 'utilities', 'climate risk', 'capital planning'];

  // Refresh HubSpot cache in background when My Accounts loads
  const [cacheVersion, setCacheVersion] = useState(0);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hubspot?action=contacts');
        const json = await res.json();
        if (json.contacts) {
          localStorage.setItem('hubspot-sync-cache', JSON.stringify({ ...json, syncedAt: new Date().toISOString() }));
          setCacheVersion(v => v + 1);
        }
      } catch {}
    })();
  }, []);

  // Listen for localStorage changes (e.g. contact edits from ProspectModal)
  useEffect(() => {
    const handler = () => setCacheVersion(v => v + 1);
    window.addEventListener('hubspot-cache-updated', handler);
    return () => window.removeEventListener('hubspot-cache-updated', handler);
  }, []);

  const { hubspotCompanies, decisionMakerByCompany, contactCountByCompany, bucketsByCompany } = useMemo(() => {
    const list = [];
    const dmMap = {}; // company lowercase → [names]
    const countMap = {}; // company lowercase → count
    const bucketMap = {}; // company lowercase → Set of matched bucket tags
    try {
      const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
      const seen = new Set();
      for (const c of (cache?.contacts || [])) {
        // Skip hidden contacts (those with 'Hide' tag)
        const contactTags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
        const isHidden = contactTags.includes('hide');
        const lower = (c.company || '').toLowerCase();
        if (lower) {
          if (!seen.has(lower)) { seen.add(lower); list.push(lower); }
          if (!isHidden) {
            countMap[lower] = (countMap[lower] || 0) + 1;
            // Track which buckets this company has covered
            const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').split(';').map(t => t.trim().toLowerCase()).filter(Boolean);
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
      }
    } catch {}
    return { hubspotCompanies: list, decisionMakerByCompany: dmMap, contactCountByCompany: countMap, bucketsByCompany: bucketMap };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospects, cacheVersion]);

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
      // Use Firestore tier if explicitly set (including '-' for no tier), otherwise fall back to map/target accounts
      let tier;
      if (p.tier === 'Tier 1' || p.tier === 'Tier 2' || p.tier === '-' || p.tier === '') {
        tier = p.tier || '-';
      } else {
        tier = findTier(p.company);
        if (!tier) {
          for (const t of targetAccounts) {
            if (companiesMatch(p.company, t.company)) { tier = t.tier; break; }
          }
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
      // Aggregate across parent company + all divisions
      const divisionNames = (divisionsMap[p.id] || []).map(d => (d.company || '').toLowerCase());
      const allCompanyNames = [companyLower, ...divisionNames];

      let activityCount = 0;
      for (const name of allCompanyNames) {
        activityCount += activityByCompany[name] || 0;
      }
      let oppsCount = 0;
      let totalOpps = 0;
      for (const name of allCompanyNames) {
        oppsCount += activeOppsByAccount[name] || 0;
        totalOpps += totalOppsByAccount[name] || 0;
      }
      const sources = [];
      sources.push('Google Sheets');
      if (fuzzyHas(hubspotCompanies, p.company)) sources.push('HubSpot');
      // Find matching Target Accounts names and tier — manual override first
      // Migrate old string format to array
      const rawMap = targetMap[p.id];
      let targetNames = Array.isArray(rawMap) ? rawMap : (rawMap ? [rawMap] : []);
      let targetTier = '';
      if (targetNames.length > 0) {
        const matched = targetAccounts.find(t => targetNames.includes(t.company));
        if (matched) targetTier = matched.tier;
      } else {
        for (const t of targetAccounts) {
          if (companiesMatch(p.company, t.company)) { targetNames = [t.company]; targetTier = t.tier; break; }
        }
      }
      if (targetNames.length > 0) sources.push('Target List');
      const tierMismatch = targetTier && targetTier !== tier && !p.ignoreTierMismatch;
      // Check for decision maker — fuzzy match across parent + divisions
      let dmNames = null;
      for (const [dmCompany, names] of Object.entries(decisionMakerByCompany)) {
        if (allCompanyNames.some(name => companiesMatch(name, dmCompany))) { dmNames = names; break; }
      }
      // Find similar accounts assigned to other salespeople (check parent + all divisions)
      const otherReps = allTargetReps.filter(t => allCompanyNames.some(name => companiesMatch(name, t.company)));
      // Count HubSpot contacts across parent + all divisions (fuzzy match)
      let contactCount = 0;
      const bucketsSeen = new Set();
      for (const [co, count] of Object.entries(contactCountByCompany)) {
        if (allCompanyNames.some(name => companiesMatch(name, co))) {
          contactCount += count;
          // Merge bucket coverage from matching company names
          if (bucketsByCompany[co]) {
            for (const b of bucketsByCompany[co]) bucketsSeen.add(b);
          }
        }
      }
      const bucketCount = bucketsSeen.size;
      // Suggested status based on opps data
      let suggestedStatus = 'Inside Sales'; // default: no opps
      for (const name of allCompanyNames) {
        if (suggestedStatusByAccount[name]) { suggestedStatus = suggestedStatusByAccount[name]; break; }
      }
      const statusMismatch = suggestedStatus !== p.status && p.status;
      const entry = { ...p, myTier: tier, activityCount, oppsCount, totalOpps, sources: sources.join(', '), dmFound: !!dmNames, dmNames: dmNames ? dmNames.join(', ') : '', cdmMismatch: !isBaldauf, targetNames, targetTier, tierMismatch, otherReps, contactCount, bucketCount, suggestedStatus, statusMismatch };
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
  }, [prospects, targetMap, targetAccounts, allTargetReps, activityByCompany, activeOppsByAccount, totalOppsByAccount, suggestedStatusByAccount, hubspotCompanies, targetCompanies, decisionMakerByCompany, contactCountByCompany, bucketsByCompany, divisionsMap]);

  const clientCount = statusCounts['Client'] || 0;
  const qualifyingCount = (statusCounts['Qualifying'] || 0) + (statusCounts['Inside Sales'] || 0);

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
        if (v == null || v === '' || v === '—' || (typeof v === 'string' && !v.trim())) {
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
  const INACTIVE_STATUSES = new Set(['Old Client', 'Hold Off', 'Lost - Not Sold']);
  const filteredAccounts = useMemo(() => {
    let result = allAccounts;
    // Inactive status filter
    if (inactiveMode === 'hide') result = result.filter(a => !INACTIVE_STATUSES.has(a.status));
    else if (inactiveMode === 'only') result = result.filter(a => INACTIVE_STATUSES.has(a.status));
    // Bucket filter
    if (bucketFilter === 'tier1') result = result.filter(a => a.myTier === 'Tier 1');
    else if (bucketFilter === 'tier2') result = result.filter(a => a.myTier === 'Tier 2');
    else if (bucketFilter === 'client') result = result.filter(a => a.status === 'Client');
    else if (bucketFilter === 'pipeline') result = result.filter(a => a.status === 'Qualifying' || a.status === 'Inside Sales');
    else if (bucketFilter === 'noTarget') result = result.filter(a => !a.targetNames || a.targetNames.length === 0);
    for (const [key, values] of Object.entries(filters)) {
      if (values.length > 0) {
        const wantsBlank = values.includes(BLANK_LABEL);
        const nonBlankValues = values.filter(v => v !== BLANK_LABEL);
        result = result.filter(a => {
          const val = String(a[key] ?? '').trim();
          const isEmpty = !val || val === '—';
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

  // Detect duplicate target account name mappings
  const duplicateTargetNames = useMemo(() => {
    const counts = {};
    for (const a of allAccounts) {
      for (const tn of (a.targetNames || [])) {
        if (tn) counts[tn] = (counts[tn] || 0) + 1;
      }
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
            {row.tierMismatch && <TierMismatchWarning row={row} onDismiss={() => onUpdate(row.id, { ignoreTierMismatch: true })} />}
          </span>
        )};
      }
      if (col.key === 'targetName') {
        return { ...col, render: (row) => <TargetNamePicker values={row.targetNames || []} companyId={row.id} targetOptions={allTargetNames} onToggle={toggleTargetMapping} duplicates={duplicateTargetNames} /> };
      }
      if (col.key === 'divisions') {
        return { ...col, render: (row) => <DivisionPicker parentId={row.id} divisions={divisionsMap[row.id] || []} allCompanies={allCompaniesForDivisions} onAdd={addDivision} onRemove={removeDivision} rules={divisionRules[row.id] || []} onSetRule={addDivisionRule} onRemoveRule={removeDivisionRule} /> };
      }
      if (col.key === 'status') {
        return { ...col, render: (row) => (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <InlineCell row={row} field="status" value={row.status} onUpdate={onUpdate} options={STATUSES} />
            {row.statusMismatch && (
              <span
                style={{ color: '#F59E0B', fontSize: '0.55rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                title={`Opps data suggests: ${row.suggestedStatus}\nClick to apply`}
                onClick={e => { e.stopPropagation(); onUpdate(row.id, { status: row.suggestedStatus }); }}
              >&#9888; {row.suggestedStatus}</span>
            )}
          </span>
        )};
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
        return { ...col, render: (row) => <InlineCell row={row} field="hqRegion" value={row.hqRegion} onUpdate={onUpdate} options={['North America', 'Outside of North America']} /> };
      }
      if (col.key === 'naRegion') {
        return { ...col, render: (row) => {
          if (row.hqRegion) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.65rem' }}>—</span>;
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
      if (['myTier', 'activityCount', 'oppsCount', 'contactCount', 'bucketCount', 'naRegion', 'type2', 'dmFound', 'sources', 'targetName', 'otherReps', 'divisions', '_hide'].includes(col.key)) {
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
  }, [onSelect, onUpdate, allTargetNames, divisionsMap, allCompaniesForDivisions, duplicateTargetNames]);

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
        {Object.entries(filterOptions).map(([key, options]) => {
          const col = ACCOUNT_COLUMNS.find(c => c.key === key);
          return <FilterDrop key={key} label={col?.label || key} options={options} selected={filters[key] || []} onToggle={v => toggleFilter(key, v)} />;
        })}
        {bucketFilter && <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '999px', background: '#EBF2FC', color: '#3B7DDD', fontWeight: 600 }}>Showing: {bucketFilter === 'tier1' ? 'Tier 1' : bucketFilter === 'tier2' ? 'Tier 2' : bucketFilter === 'client' ? 'Clients' : bucketFilter === 'noTarget' ? 'No Target Mapped' : 'In Pipeline'}</span>}
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
        <span className={styles.resultCount}>{filteredAccounts.length} of {allAccounts.length}</span>
      </div>
      {targetAccounts.length > 0 && (() => {
        const targetNames = targetAccounts.map(t => (t.company || '').toLowerCase());
        const myNames = allAccounts.map(a => (a.company || '').toLowerCase());
        // Also consider manual target name mappings as "matched"
        const mappedTargetNames = new Set(allAccounts.flatMap(a => (a.targetNames || []).map(n => n.toLowerCase())));
        const onlyMyAccounts = allAccounts.filter(a => (!a.targetNames || a.targetNames.length === 0) && !fuzzyHas(targetNames, a.company));
        const onlyTarget = targetAccounts.filter(t => !fuzzyHas(myNames, t.company) && !mappedTargetNames.has((t.company || '').toLowerCase()));
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
              <div className={styles.summaryValue}>{tier2.length}</div>
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
          <div className={styles.summaryLabel}>In Pipeline</div>
          <div className={styles.summaryValue}>{qualifyingCount}</div>
        </button>
        <button className={`${styles.summaryCard} ${bucketFilter === 'noTarget' ? styles.summaryCardActive : ''}`} style={{ borderLeftColor: '#9CA3AF', cursor: 'pointer' }} onClick={() => setBucketFilter(bucketFilter === 'noTarget' ? null : 'noTarget')}>
          <div className={styles.summaryLabel}>No Target Mapped</div>
          <div className={styles.summaryValue}>{allAccounts.filter(a => !a.targetNames || a.targetNames.length === 0).length}</div>
        </button>
      </div>
      {expandedBucket && (() => {
        const myNames = allAccounts.map(a => (a.company || '').toLowerCase());
        const mappedNames = new Set(allAccounts.flatMap(a => (a.targetNames || []).map(n => n.toLowerCase())));
        const tierLabel = expandedBucket === 'tier1' ? 'Tier 1' : 'Tier 2';
        const notInMyAccounts = targetAccounts
          .filter(t => t.tier === tierLabel && !fuzzyHas(myNames, t.company) && !mappedNames.has((t.company || '').toLowerCase()));
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
          rowStyle={(row) => {
            const s = row.status;
            return (s === 'Lost - Not Sold' || s === 'Hold Off' || s === 'Old Client') ? { opacity: 0.45 } : undefined;
          }}
          emptyMessage="No matching accounts found"
        />
      </div>
    </div>
  );
}
