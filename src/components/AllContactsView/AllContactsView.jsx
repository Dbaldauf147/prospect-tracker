import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { useOppsRecords } from '../KeyContactsView/KeyContactsView';
import { loadEffectiveRaClients, raClientName } from '../../utils/raClientsStore';

// One unified table that collects contacts from the Key / Active /
// Client rosters into a single list, with a coloured Category cell
// per row so the user can see at a glance where each contact lives.
//
// Mirrors the per-roster rules the dedicated tabs apply:
//   • Key     — HubSpot tag includes "Dan Key Target" (any CDM).
//   • Client  — contact's company matches an RA Clients entry.
//   • Active  — contact has email activity in the last 90 days AND
//               their company has at least one open opportunity on
//               the Opps tab. (Same rule as ActiveContactsView's
//               default + requireActiveOpp.)
// A contact can belong to more than one — Key + Client overlaps are
// shown as two pills in the same row.

const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com', 'me.com', 'msn.com']);
const SCHNEIDER_RE = /\bschneider\s*electric\b/i;
const SCHNEIDER_DOMAIN_RE = /(^|\.)(se\.com|schneider-electric\.com|schneider\.com)$/i;
const CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
const INVALID_STAGES = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);
const ACTIVITY_FIELDS = ['hs_email_last_send_date', 'hs_sales_email_last_replied', 'hs_email_last_open_date', 'hs_email_last_click_date', 'notes_last_contacted'];

// Same fuzzy-match rule the rest of the app uses (PEPortfolioView /
// ProspectModal / ZoomInfoView). Catches "URW" / "URW Westfield",
// "Acme Inc" / "Acme", etc.
function companiesMatch(a, b) {
  const na = String(a || '').toLowerCase().trim();
  const nb = String(b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  const strip = s => s.replace(/\b(inc|llc|ltd|corp|co|lp)\b\.?/gi, '').replace(/[^a-z0-9 ]/g, '').trim();
  const sa = strip(na);
  const sb = strip(nb);
  if (sa && sb && (sa === sb || sa.includes(sb) || sb.includes(sa))) return true;
  return false;
}

const CORP_RE = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|holdings|group|grp)\b\.?/g;
function normalizeCompany(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/g, ' ')
    .replace(/[,.;:]+/g, ' ')
    .replace(CORP_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSchneider(c) {
  if (SCHNEIDER_RE.test(String(c?.company || ''))) return true;
  const e = String(c?.email || '').toLowerCase().trim();
  const at = e.lastIndexOf('@');
  if (at >= 0) {
    const d = e.slice(at + 1).trim();
    if (SCHNEIDER_DOMAIN_RE.test(d)) return true;
  }
  return false;
}

function emailDomainOf(c) {
  const e = String(c?.email || '').toLowerCase().trim();
  const at = e.lastIndexOf('@');
  if (at < 0) return '';
  const d = e.slice(at + 1).trim();
  return d && !FREE_MAIL.has(d) ? d : '';
}

function hasRecentActivity(c) {
  const cutoff = Date.now() - 90 * 86400000;
  for (const f of ACTIVITY_FIELDS) {
    const v = c?.[f];
    if (!v) continue;
    const ts = Date.parse(v);
    if (!Number.isNaN(ts) && ts >= cutoff) return true;
  }
  return false;
}

const CATEGORY_COLORS = {
  Key:    { bg: '#FEF3C7', border: '#FCD34D', color: '#92400E' },
  Active: { bg: '#DCFCE7', border: '#86EFAC', color: '#166534' },
  Client: { bg: '#DBEAFE', border: '#93C5FD', color: '#1E3A8A' },
};

function CategoryPills({ categories }) {
  if (!categories || categories.length === 0) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {categories.map(cat => {
        const c = CATEGORY_COLORS[cat] || { bg: '#F1F5F9', border: '#CBD5E1', color: '#334155' };
        return (
          <span
            key={cat}
            style={{
              background: c.bg,
              border: `1px solid ${c.border}`,
              color: c.color,
              padding: '1px 8px',
              borderRadius: 999,
              fontSize: '0.68rem',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >{cat}</span>
        );
      })}
    </span>
  );
}

// Column registry. `alwaysOn` columns can't be hidden via the
// Columns dropdown — Name is the row identifier and Category is the
// reason this view exists, so both stay locked-on.
const COLUMNS = [
  { key: 'name',     label: 'Name',         defaultWidth: 200, alwaysOn: true,
    text: r => r.name },
  { key: 'email',    label: 'Email',        defaultWidth: 220,
    text: r => r.email },
  { key: 'company',  label: 'Company',      defaultWidth: 200,
    text: r => r.company },
  { key: 'jobtitle', label: 'Title',        defaultWidth: 180,
    text: r => r.jobtitle },
  { key: 'location', label: 'City / State', defaultWidth: 140,
    text: r => [r.city, r.state].filter(Boolean).join(', ') },
  { key: 'phone',    label: 'Phone',        defaultWidth: 140,
    text: r => r.phone },
  { key: 'category', label: 'Category',     defaultWidth: 160, alwaysOn: true,
    text: r => r.categories.join(' ') },
];

const DEFAULT_VISIBLE = ['name', 'email', 'company', 'jobtitle', 'location', 'category'];
const VISIBLE_KEY = 'all-contacts-view:visible-cols';

export function AllContactsView({ prospects = [], onSelectProspect, settings }) {
  const { user } = useAuth();
  const oppsRecords = useOppsRecords(user?.uid);
  const [hubspotCache, setHubspotCache] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotCache().then(c => { if (!cancelled) setHubspotCache(c); }).catch(() => {});
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  // RA Clients data drives the Client category. Refresh on focus /
  // storage in case the user re-uploads on the Lists tab.
  const [raClients, setRaClients] = useState(() => {
    try { return loadEffectiveRaClients()?.data || []; } catch { return []; }
  });
  useEffect(() => {
    function refresh() { try { setRaClients(loadEffectiveRaClients()?.data || []); } catch { /* ignore */ } }
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // Pre-compute the open-opp account list so the Active rule is O(1)
  // per contact instead of O(opps).
  const activeOppAccountSet = useMemo(() => {
    const exact = new Set();
    const norm = new Set();
    for (const r of (oppsRecords || [])) {
      const stage = String(r?.Stage || '').trim();
      if (!stage || INVALID_STAGES.has(stage) || CLOSED_STAGES.has(stage)) continue;
      const raw = String(r?.Account || '').trim();
      if (!raw) continue;
      exact.add(raw.toLowerCase());
      const n = normalizeCompany(raw);
      if (n) norm.add(n);
    }
    return { exact, norm, raw: [...exact] };
  }, [oppsRecords]);

  // RA Clients: lower-cased company names + their email domains, with
  // a normalized fallback for fuzzy matching.
  const clientLookup = useMemo(() => {
    const exact = new Set();
    const norm = new Set();
    for (const row of raClients || []) {
      const name = raClientName(row);
      if (!name) continue;
      exact.add(name.toLowerCase().trim());
      const n = normalizeCompany(name);
      if (n) norm.add(n);
    }
    return { exact, norm };
  }, [raClients]);

  const rows = useMemo(() => {
    const cache = hubspotCache?.contacts || [];
    const local = settings?.contactLocalFields || {};
    const out = [];
    for (const baseC of cache) {
      const lf = local[String(baseC.id || baseC.vid || '')] || null;
      const c = lf && typeof lf._companyOverride === 'string' && lf._companyOverride
        ? { ...baseC, company: lf._companyOverride }
        : baseC;
      const tags = String(c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('hide')) continue;
      if (tags.includes('left')) continue;
      if (isSchneider(c)) continue;

      const companyLower = String(c.company || '').toLowerCase().trim();
      const domain = emailDomainOf(c);
      const categories = [];

      // Key
      if (tags.includes('dan key target')) categories.push('Key');

      // Client
      const isClient = (companyLower && (clientLookup.exact.has(companyLower) || clientLookup.norm.has(normalizeCompany(companyLower))))
        || (!companyLower && domain && [...clientLookup.exact].some(n => n.includes(domain.split('.')[0])));
      if (isClient) categories.push('Client');

      // Active (drops Key Targets and Clients to mirror the
      // dedicated Active page's exclusion rules — same logic as the
      // existing CSV export in KeyContactsView).
      if (!tags.includes('dan key target') && !isClient) {
        if (hasRecentActivity(c) && companyLower) {
          const cName = String(c.company || '').trim();
          const hit = activeOppAccountSet.exact.has(companyLower)
            || activeOppAccountSet.raw.some(a => companiesMatch(a, cName))
            || activeOppAccountSet.norm.has(normalizeCompany(cName));
          if (hit) categories.push('Active');
        }
      }

      if (categories.length === 0) continue;
      out.push({
        id: c.id || c.vid || c.email,
        contactId: c.id || c.vid,
        firstname: c.firstname || '',
        lastname: c.lastname || '',
        name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email || '(unnamed)',
        email: c.email || '',
        company: c.company || '',
        jobtitle: c.jobtitle || '',
        phone: c.phone || c.mobilephone || '',
        city: c.city || '',
        state: c.state || '',
        categories,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [hubspotCache, settings, clientLookup, activeOppAccountSet]);

  // Filter UI: free-text search + per-category toggle pills + per-
  // column substring filters (one input under each header). All AND
  // together so a "company contains acme" + "category contains key"
  // pair returns only rows that satisfy both.
  const [search, setSearch] = useState('');
  const [activeCats, setActiveCats] = useState(() => new Set(['Key', 'Active', 'Client']));
  const [colFilters, setColFilters] = useState({});

  // Visible-column set, persisted across reloads. Always contains the
  // alwaysOn columns regardless of what the user saved earlier.
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(VISIBLE_KEY));
      if (Array.isArray(saved) && saved.length > 0) {
        const set = new Set(saved);
        for (const c of COLUMNS) if (c.alwaysOn) set.add(c.key);
        return set;
      }
    } catch { /* ignore */ }
    return new Set(DEFAULT_VISIBLE);
  });
  useEffect(() => {
    try { localStorage.setItem(VISIBLE_KEY, JSON.stringify([...visibleCols])); } catch { /* ignore */ }
  }, [visibleCols]);

  function toggleColVisible(key) {
    setVisibleCols(prev => {
      const col = COLUMNS.find(c => c.key === key);
      if (col?.alwaysOn) return prev; // can't hide name / category
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const visibleColumnList = useMemo(
    () => COLUMNS.filter(c => visibleCols.has(c.key)),
    [visibleCols]
  );

  // Columns dropdown open/close state
  const [colsMenuOpen, setColsMenuOpen] = useState(false);
  const colsMenuRef = useRef(null);
  useEffect(() => {
    if (!colsMenuOpen) return;
    const onDown = (e) => { if (!colsMenuRef.current?.contains(e.target)) setColsMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [colsMenuOpen]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Prepare per-column filter predicates so we don't re-compute the
    // text getter on every row × column.
    const activeFilters = [];
    for (const col of visibleColumnList) {
      const raw = String(colFilters[col.key] || '').trim().toLowerCase();
      if (raw) activeFilters.push({ col, raw });
    }
    return rows.filter(r => {
      if (!r.categories.some(c => activeCats.has(c))) return false;
      if (q) {
        const haystack = [r.name, r.email, r.company, r.jobtitle].some(v => String(v || '').toLowerCase().includes(q));
        if (!haystack) return false;
      }
      for (const f of activeFilters) {
        const v = String(f.col.text(r) || '').toLowerCase();
        if (!v.includes(f.raw)) return false;
      }
      return true;
    });
  }, [rows, search, activeCats, colFilters, visibleColumnList]);

  function toggleCat(cat) {
    setActiveCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      // Don't allow zero categories — that empties the table without
      // explanation. Force at least one back on.
      if (next.size === 0) next.add(cat);
      return next;
    });
  }

  function pickProspect(row) {
    if (!onSelectProspect || !prospects?.length) return;
    const target = String(row.company || '').toLowerCase().trim();
    if (!target) return;
    const match = prospects.find(p => companiesMatch(p?.company, target));
    if (match) onSelectProspect(match);
  }

  const counts = useMemo(() => {
    const c = { Key: 0, Active: 0, Client: 0 };
    for (const r of rows) for (const cat of r.categories) c[cat]++;
    return c;
  }, [rows]);

  const cellStyle = { padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--color-border-light)', fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 };
  const headStyle = { ...cellStyle, position: 'sticky', top: 0, background: '#F1F5F9', fontWeight: 700, color: '#475569', fontSize: '0.7rem', borderBottom: '1px solid var(--color-border)', zIndex: 1, textAlign: 'left' };

  function renderCell(col, r) {
    if (col.key === 'name') return <span style={{ fontWeight: 600, color: '#1E293B' }}>{r.name}</span>;
    if (col.key === 'category') return <CategoryPills categories={r.categories} />;
    if (col.key === 'location') return [r.city, r.state].filter(Boolean).join(', ') || <span style={{ color: '#CBD5E1' }}>—</span>;
    const v = col.text(r);
    return v || <span style={{ color: '#CBD5E1' }}>—</span>;
  }

  const filterCount = Object.values(colFilters).filter(v => String(v || '').trim()).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ padding: '0.75rem 1rem 0.5rem', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flexShrink: 0 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>All Contacts</h2>
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
            {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} contacts
            <span style={{ marginLeft: 6 }}>· Key {counts.Key} · Active {counts.Active} · Client {counts.Client}</span>
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name / email / company…"
          style={{ padding: '0.35rem 0.55rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.8rem', minWidth: 240 }}
        />
        <div style={{ display: 'inline-flex', gap: 4 }}>
          {['Key', 'Active', 'Client'].map(cat => {
            const on = activeCats.has(cat);
            const c = CATEGORY_COLORS[cat];
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleCat(cat)}
                title={on ? `Hide ${cat} contacts` : `Show ${cat} contacts`}
                style={{
                  padding: '0.3rem 0.7rem',
                  border: `1px solid ${on ? c.border : 'var(--color-border)'}`,
                  background: on ? c.bg : '#fff',
                  color: on ? c.color : '#94A3B8',
                  borderRadius: 999,
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >{cat}</button>
            );
          })}
        </div>
        <div ref={colsMenuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setColsMenuOpen(o => !o)}
            title="Show or hide individual columns. Name and Category are always visible."
            style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text-secondary)', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
          >Columns ({visibleColumnList.length}/{COLUMNS.length})</button>
          {colsMenuOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 20,
              background: '#fff', border: '1px solid var(--color-border)', borderRadius: 6,
              boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
              minWidth: 220, padding: '0.4rem 0', fontSize: '0.78rem',
            }}>
              {COLUMNS.map(c => {
                const on = visibleCols.has(c.key);
                return (
                  <label
                    key={c.key}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '0.3rem 0.7rem', cursor: c.alwaysOn ? 'not-allowed' : 'pointer',
                      color: c.alwaysOn ? '#94A3B8' : 'var(--color-text)',
                    }}
                    title={c.alwaysOn ? `${c.label} is always visible.` : `Show / hide the ${c.label} column.`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={c.alwaysOn}
                      onChange={() => toggleColVisible(c.key)}
                      style={{ accentColor: '#0078D4' }}
                    />
                    <span style={{ flex: 1 }}>{c.label}</span>
                  </label>
                );
              })}
              <div style={{ borderTop: '1px solid #E2E8F0', marginTop: 4, padding: '0.3rem 0.7rem', display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setVisibleCols(new Set(COLUMNS.map(c => c.key)))}
                  style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text-secondary)' }}
                >Show all</button>
                <button
                  type="button"
                  onClick={() => setVisibleCols(new Set(COLUMNS.filter(c => c.alwaysOn).map(c => c.key)))}
                  style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text-secondary)' }}
                >Hide all</button>
              </div>
            </div>
          )}
        </div>
        {filterCount > 0 && (
          <button
            type="button"
            onClick={() => setColFilters({})}
            title="Clear every per-column filter"
            style={{ fontSize: '0.7rem', padding: '0.3rem 0.6rem', border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#B91C1C', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
          >Clear filters ({filterCount})</button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', margin: '0 1rem 1rem', border: '1px solid var(--color-border)', borderRadius: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', tableLayout: 'fixed' }}>
          <colgroup>
            {visibleColumnList.map(c => <col key={c.key} style={{ width: c.defaultWidth }} />)}
          </colgroup>
          <thead>
            <tr>
              {visibleColumnList.map(c => (
                <th key={c.key} style={headStyle}>{c.label}</th>
              ))}
            </tr>
            <tr>
              {visibleColumnList.map(c => (
                <th key={c.key} style={{ ...headStyle, top: 26, padding: '0.25rem 0.4rem', background: '#F8FAFC' }}>
                  <input
                    type="text"
                    value={colFilters[c.key] || ''}
                    onChange={e => setColFilters(prev => ({ ...prev, [c.key]: e.target.value }))}
                    placeholder="Filter…"
                    style={{ width: '100%', padding: '2px 6px', border: '1px solid var(--color-border)', borderRadius: 3, fontSize: '0.68rem', fontFamily: 'inherit', boxSizing: 'border-box' }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={visibleColumnList.length} style={{ ...cellStyle, padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                  {rows.length === 0
                    ? 'No contacts categorised as Key, Active, or Client yet — load the HubSpot cache and the Opps tab on the Lists page.'
                    : 'No matches for the current filter.'}
                </td>
              </tr>
            )}
            {filtered.map(r => (
              <tr
                key={r.id}
                onClick={() => pickProspect(r)}
                style={{ cursor: r.company ? 'pointer' : 'default' }}
                title={r.company ? `Open ${r.company} in the prospect popup` : ''}
              >
                {visibleColumnList.map(c => (
                  <td
                    key={c.key}
                    style={c.key === 'category' ? { ...cellStyle, overflow: 'visible' } : cellStyle}
                    title={String(c.text(r) || '')}
                  >
                    {renderCell(c, r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
