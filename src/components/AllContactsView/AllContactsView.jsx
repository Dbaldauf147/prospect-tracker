import { useEffect, useMemo, useState } from 'react';
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

  // Filter UI: free-text search + per-category toggle pills.
  const [search, setSearch] = useState('');
  const [activeCats, setActiveCats] = useState(() => new Set(['Key', 'Active', 'Client']));
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (!r.categories.some(c => activeCats.has(c))) return false;
      if (!q) return true;
      return [r.name, r.email, r.company, r.jobtitle].some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [rows, search, activeCats]);

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
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', margin: '0 1rem 1rem', border: '1px solid var(--color-border)', borderRadius: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 200 }} />
            <col style={{ width: 220 }} />
            <col style={{ width: 200 }} />
            <col style={{ width: 180 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 160 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={headStyle}>Name</th>
              <th style={headStyle}>Email</th>
              <th style={headStyle}>Company</th>
              <th style={headStyle}>Title</th>
              <th style={headStyle}>City / State</th>
              <th style={headStyle}>Category</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...cellStyle, padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
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
                <td style={{ ...cellStyle, fontWeight: 600, color: '#1E293B' }} title={r.name}>{r.name}</td>
                <td style={cellStyle} title={r.email}>{r.email || <span style={{ color: '#CBD5E1' }}>—</span>}</td>
                <td style={cellStyle} title={r.company}>{r.company || <span style={{ color: '#CBD5E1' }}>—</span>}</td>
                <td style={cellStyle} title={r.jobtitle}>{r.jobtitle || <span style={{ color: '#CBD5E1' }}>—</span>}</td>
                <td style={cellStyle} title={[r.city, r.state].filter(Boolean).join(', ')}>
                  {[r.city, r.state].filter(Boolean).join(', ') || <span style={{ color: '#CBD5E1' }}>—</span>}
                </td>
                <td style={{ ...cellStyle, overflow: 'visible' }}>
                  <CategoryPills categories={r.categories} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
