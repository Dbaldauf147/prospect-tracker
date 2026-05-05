// Active Contacts page — same layout / interactions as the Key
// Contacts page, but the contact selector is "anyone I've actually
// been emailing with" rather than "tagged Dan Key Target".
//
// We reuse KeyContactsView and just override the selector + copy +
// localStorage prefix so column widths, filters, sort, and view-mode
// preferences are kept distinct from the Key Contacts tab.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { KeyContactsView } from '../KeyContactsView/KeyContactsView';
import { getHubspotCache } from '../../utils/hubspotContactsCache';

const WINDOW_OPTIONS = [
  { key: 30,  label: 'Last 30 days' },
  { key: 90,  label: 'Last 90 days' },
  { key: 180, label: 'Last 180 days' },
  { key: 365, label: 'Last year' },
  { key: 0,   label: 'Any time' },
];

function parseHubspotDate(v) {
  if (!v) return NaN;
  const ts = Date.parse(v);
  if (!Number.isNaN(ts)) return ts;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// Schneider Electric is the user's own employer — internal coworkers
// shouldn't show up in the Active Contacts list, so anything matching
// the company name (or an @se.com / @schneider-electric.com email
// domain) is excluded regardless of activity.
const SCHNEIDER_COMPANY_RE = /\bschneider\s*electric\b/i;
const SCHNEIDER_DOMAIN_RE = /(^|\.)(se\.com|schneider-electric\.com|schneider\.com)$/i;
function isSchneiderContact(c) {
  if (SCHNEIDER_COMPANY_RE.test(String(c.company || ''))) return true;
  const email = String(c.email || '').toLowerCase().trim();
  const at = email.lastIndexOf('@');
  if (at >= 0) {
    const domain = email.slice(at + 1).trim();
    if (SCHNEIDER_DOMAIN_RE.test(domain)) return true;
  }
  return false;
}

// Cheap fuzzy company-name match used to recognize current-client
// contacts (so they're suppressed from Active Contacts since they
// already live on the Client Contacts tab). Mirrors the heuristic in
// ClientContactsView but kept local to avoid a cross-component import.
function companiesMatch(a, b) {
  const na = (a || '').toLowerCase().trim();
  const nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  const strip = s => s.replace(/\b(inc|llc|ltd|corp|co|lp)\b\.?/gi, '').replace(/[^a-z0-9 ]/g, '').trim();
  return strip(na) === strip(nb);
}

const FREE_MAIL = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
  'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com',
]);

// A contact is "active" when at least one HubSpot email-activity
// timestamp (sent / replied / opened / clicked / last contacted) sits
// inside the chosen window. Window of 0 → any timestamp present.
// Schneider coworkers, "Dan Key Target"-tagged contacts, and contacts
// whose company is already a current Client are all filtered so this
// page shows only people who don't already live on Key Contacts or
// Client Contacts. The selector can be inverted (`mode = 'hidden'`)
// to surface ONLY hide-tagged active contacts so the user can review
// what's been suppressed.
function makeActiveSelector(windowDays, mode = 'visible', { clientCompanies = [], clientDomains = new Set() } = {}) {
  const cutoff = windowDays > 0 ? Date.now() - windowDays * 86400000 : null;
  return (c) => {
    const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
    const hidden = tags.includes('hide');
    if (mode === 'hidden') {
      if (!hidden) return false;
    } else {
      if (hidden) return false;
      if (tags.includes('dan key target')) return false;
    }
    if (isSchneiderContact(c)) return false;
    // Drop client-company contacts so they don't double up with the
    // Client Contacts tab. Match by company name (fuzzy) first, then
    // by email domain when the prospect carries one.
    if (clientCompanies.length || clientDomains.size) {
      const company = String(c.company || '').trim();
      if (company && clientCompanies.some(name => companiesMatch(name, company))) return false;
      const email = (c.email || '').toLowerCase().trim();
      const at = email.lastIndexOf('@');
      if (at >= 0) {
        const domain = email.slice(at + 1).trim();
        if (domain && !FREE_MAIL.has(domain) && clientDomains.has(domain)) return false;
      }
    }
    const fields = [
      c.hs_email_last_send_date,
      c.hs_sales_email_last_replied,
      c.hs_email_last_open_date,
      c.hs_email_last_click_date,
      c.notes_last_contacted,
    ];
    for (const v of fields) {
      const ts = parseHubspotDate(v);
      if (Number.isNaN(ts)) continue;
      if (cutoff === null) return true;
      if (ts >= cutoff) return true;
    }
    return false;
  };
}

export function ActiveContactsView({ prospects = [], onSelectProspect, settings, updateSettings }) {
  const [windowDays, setWindowDays] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('active-contacts:window-days'));
      if (WINDOW_OPTIONS.some(o => o.key === saved)) return saved;
    } catch {}
    return 90;
  });
  useEffect(() => { try { localStorage.setItem('active-contacts:window-days', String(windowDays)); } catch {} }, [windowDays]);
  // KeyContactsView reports how many contacts the unmapped-past-30
  // filter would surface; we render it next to the toggle so the user
  // can see at a glance whether flipping the switch is worth it.
  const [unmappedPast30Count, setUnmappedPast30Count] = useState(0);
  // "Show hidden" lets the user audit / un-hide contacts that were
  // suppressed via the Hide button. We swap the selector to filter for
  // hide-tagged rows only, so the table becomes a review of suppressed
  // contacts rather than the normal active list.
  const [showHidden, setShowHidden] = useState(false);
  // We watch the HubSpot cache directly to compute how many
  // hide-tagged contacts have email activity in the current window —
  // that's the badge value next to the toggle.
  const [hubspotContacts, setHubspotContacts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      getHubspotCache().then(c => { if (!cancelled) setHubspotContacts(c?.contacts || []); }).catch(() => {});
    }
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);
  // Surface contacts whose company hasn't been added to the Table View
  // yet — useful for hunting down accounts you've started conversations
  // with but haven't tracked. Toggling this also forces a 30-day window
  // because that's the canonical "still in conversation" cutoff and
  // also relaxes the open-opp gate (an unmapped company has no opps yet
  // by definition).
  const [unmappedOnly, setUnmappedOnly] = useState(() => {
    try { return localStorage.getItem('active-contacts:unmapped-only') === '1'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem('active-contacts:unmapped-only', unmappedOnly ? '1' : '0'); } catch {} }, [unmappedOnly]);
  const effectiveWindow = unmappedOnly ? 30 : windowDays;
  // Build the client-company exclusion set so contacts at current
  // clients drop out of Active Contacts (they live on Client Contacts
  // already). Includes prospect-registered email domains for fuzzy
  // matches when the company text differs from the prospect's name.
  const clientFilter = useMemo(() => {
    const companies = [];
    const domains = new Set();
    for (const p of (prospects || [])) {
      if (p.status !== 'Client') continue;
      if (p.company) companies.push(p.company);
      if (p.emailDomain) {
        for (const entry of String(p.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
          const at = entry.lastIndexOf('@');
          const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
          if (d) domains.add(d);
        }
      }
      if (p.website) {
        const d = String(p.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
        if (d) domains.add(d);
      }
    }
    return { clientCompanies: companies, clientDomains: domains };
  }, [prospects]);
  const selector = useCallback(
    makeActiveSelector(effectiveWindow, showHidden ? 'hidden' : 'visible', clientFilter),
    [effectiveWindow, showHidden, clientFilter]
  );
  const hiddenCount = useMemo(() => {
    const probe = makeActiveSelector(effectiveWindow, 'hidden', clientFilter);
    let n = 0;
    for (const c of hubspotContacts) if (probe(c)) n += 1;
    return n;
  }, [hubspotContacts, effectiveWindow, clientFilter]);

  const subtitle = (
    <>
      HubSpot contacts you've emailed back-and-forth with whose company
      also has at least one open / active opportunity in the Opps
      tab — sent, opened, clicked, replied, or otherwise touched in the
      selected window. <em>Excludes</em> Dan Key Targets and current
      Client contacts (those live on the Key Contacts and Client
      Contacts tabs). Toggle <strong>All Contacts</strong> for a flat
      table or <strong>By Company</strong> to roll them up by account.
      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: unmappedOnly ? '#94A3B8' : '#475569' }}>
          Window:
          <select
            value={windowDays}
            onChange={e => setWindowDays(Number(e.target.value))}
            disabled={unmappedOnly}
            style={{ fontSize: '0.7rem', padding: '1px 4px', border: '1px solid #CBD5E1', borderRadius: 4, fontFamily: 'inherit' }}
          >
            {WINDOW_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: '#475569', cursor: 'pointer' }}>
          <input type="checkbox" checked={unmappedOnly} onChange={e => setUnmappedOnly(e.target.checked)} />
          <span>Show only contacts (past 30 days) whose company is <strong>not</strong> in the Table View</span>
          <span
            title="HubSpot contacts active in the past 30 days whose company isn't tracked on the Table View yet."
            style={{
              display: 'inline-block',
              padding: '0 6px',
              fontSize: '0.62rem',
              fontWeight: 700,
              borderRadius: 999,
              background: unmappedPast30Count > 0 ? '#FEF3C7' : '#F1F5F9',
              color: unmappedPast30Count > 0 ? '#92400E' : '#94A3B8',
              border: '1px solid ' + (unmappedPast30Count > 0 ? '#FDE68A' : '#E2E8F0'),
              minWidth: 18,
              textAlign: 'center',
            }}
          >{unmappedPast30Count}</span>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: '#475569', cursor: 'pointer' }}>
          <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />
          <span>Show hidden contacts</span>
          <span
            title="HubSpot contacts you've hidden via the Hide button that still have activity in the current window. Toggle this on to review them and clear the Hide tag from the contact popup if needed."
            style={{
              display: 'inline-block',
              padding: '0 6px',
              fontSize: '0.62rem',
              fontWeight: 700,
              borderRadius: 999,
              background: hiddenCount > 0 ? '#FEE2E2' : '#F1F5F9',
              color: hiddenCount > 0 ? '#991B1B' : '#94A3B8',
              border: '1px solid ' + (hiddenCount > 0 ? '#FCA5A5' : '#E2E8F0'),
              minWidth: 18,
              textAlign: 'center',
            }}
          >{hiddenCount}</span>
        </label>
      </div>
    </>
  );

  return (
    <KeyContactsView
      prospects={prospects}
      onSelectProspect={onSelectProspect}
      settings={settings}
      updateSettings={updateSettings}
      storagePrefix="active-contacts"
      pageTitle="Active Contacts"
      pageSubtitle={subtitle}
      emptyTitle={unmappedOnly ? 'No unmapped contacts in the past 30 days' : 'No active contacts found'}
      emptyDetail={unmappedOnly
        ? <>Every contact you've emailed in the last 30 days already maps to a Table View company. Add a new prospect or check Email Domain entries on the Table View if you expected hits here.</>
        : <>Nothing matched in this window. A contact only appears here when (1) HubSpot shows recent email activity and (2) the contact's company has at least one open / active opportunity in the Opps tab. Try widening the range above, or paste fresh HubSpot / Opps data.</>}
      contactSelector={selector}
      requireActiveOpp={!unmappedOnly}
      unmappedOnly={unmappedOnly}
      showSuggestedCompany={unmappedOnly}
      onUnmappedPast30CountChange={setUnmappedPast30Count}
    />
  );
}
