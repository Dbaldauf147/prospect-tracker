// Active Contacts page — same layout / interactions as the Key
// Contacts page, but the contact selector is "anyone I've actually
// been emailing with" rather than "tagged Dan Key Target".
//
// We reuse KeyContactsView and just override the selector + copy +
// localStorage prefix so column widths, filters, sort, and view-mode
// preferences are kept distinct from the Key Contacts tab.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { KeyContactsView, useOppsRecords } from '../KeyContactsView/KeyContactsView';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { useAuth } from '../../contexts/AuthContext';
import { FREE_MAIL, makeActiveSelector } from '../../utils/contactRosters';

const CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
const INVALID_STAGES = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);

const WINDOW_OPTIONS = [
  { key: 30,  label: 'Last 30 days' },
  { key: 90,  label: 'Last 90 days' },
  { key: 180, label: 'Last 180 days' },
  { key: 365, label: 'Last year' },
  { key: 0,   label: 'Any time' },
];

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

export function ActiveContactsView({ prospects = [], onSelectProspect, settings, updateSettings, updateSettingsPath, cdmName }) {
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
  // Active opps with no HubSpot contact at the same company — the
  // gap report sits above the table so the user can see which
  // accounts still need a person added.
  const { user } = useAuth();
  const oppsRecords = useOppsRecords(user?.uid);
  const [oppsGapOpen, setOppsGapOpen] = useState(false);
  // Surface contacts whose company hasn't been added to the Table View
  // yet — useful for hunting down accounts you've started conversations
  // with but haven't tracked. Toggling this also forces a 30-day window
  // because that's the canonical "still in conversation" cutoff and
  // also relaxes the open-opp gate (an unmapped company has no opps yet
  // by definition). Hoisted above the client/gap memos so the gap can
  // mirror the page's effective window.
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
  // Account names belonging to a current/past Client relationship.
  // Opps on these accounts are covered by the Client Contacts page and
  // shouldn't be flagged here even if no contact appears on the Active
  // Contacts table. Old Client is included because those relationships
  // are still tracked off this page (e.g. Brookfield (NAM Multifamily)).
  const clientAccountNames = useMemo(() => {
    const names = [];
    for (const p of (prospects || [])) {
      if (p.status !== 'Client' && p.status !== 'Old Client') continue;
      if (p.company) names.push(p.company);
    }
    return names;
  }, [prospects]);
  const oppsWithoutContacts = useMemo(() => {
    if (!oppsRecords || oppsRecords.length === 0 || hubspotContacts.length === 0) return [];
    // Normalize both sides before comparing so the gap report doesn't
    // surface companies where the user already has a contact under a
    // slightly different spelling. We:
    //   1. Lowercase + trim.
    //   2. Strip trailing parentheticals like "(a Stonepeak co.)" so
    //      "Akumin (a Stonepeak co.)" matches "Akumin".
    //   3. Drop common trailing/leading punctuation ("Apollo,").
    //   4. Strip standalone corporate suffixes (Inc / LLC / Ltd / etc.).
    //   5. Collapse interior whitespace.
    const CORP_RE = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|holdings|group|grp)\b\.?/g;
    const normalize = (s) => String(s || '')
      .toLowerCase()
      .replace(/\s*\([^)]*\)\s*$/g, ' ')
      .replace(/[,.;:]+/g, ' ')
      .replace(CORP_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Anyone who actually shows up on the Active Contacts table counts
    // as "we have a contact at this company" — the page already filters
    // out hidden / left / Schneider / Key Target / current-Client rows,
    // so reusing its selector keeps the gap in lockstep with what the
    // user sees below. We *also* fold in Dan-Key-Target-tagged contacts
    // (which the visible selector strips, since they live on the Key
    // Contacts tab) so a company with Key Targets but no Active row
    // doesn't get flagged here — the user already has those people on
    // the other tab. Hidden / left rows stay excluded. Track raw
    // company strings too so the opp-side lookup can fall back to
    // companiesMatch fuzz when the normalized strings don't line up
    // (e.g. "Berkeley Research Group, LLC" contact vs opp Account
    // "Berkeley Research Group (a Towerbrook co.)").
    const visibleSelector = makeActiveSelector(effectiveWindow, 'visible', clientFilter);
    const isKeyTargetContact = (c) => {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('hide') || tags.includes('left')) return false;
      return tags.includes('dan key target');
    };
    // Tokens used by the fallback matcher below — we split on space AND
    // hyphen so "Unibail-Rodamco-Westfield" tokenizes to
    // ["unibail","rodamco","westfield"]. We keep tokens ≥ 5 chars and
    // drop a list of generic finance / geography words so two
    // unrelated firms don't get linked just because they both have
    // "Capital" or "Partners" in the name.
    const TOKEN_STOPWORDS = new Set([
      'capital', 'partners', 'asset', 'assets', 'estate', 'global', 'international',
      'management', 'advisors', 'advisers', 'ventures', 'equity', 'investments',
      'investment', 'associates', 'trust', 'services', 'financial', 'private',
      'american', 'holdings', 'holding', 'company', 'realty', 'properties',
      'property', 'industries', 'industrial', 'commercial', 'national', 'corporation',
      'incorporated',
    ]);
    const tokenize = (s) => normalize(s)
      .split(/[\s\-]+/)
      .filter(t => t.length >= 5 && !TOKEN_STOPWORDS.has(t));
    // Trailing parenthetical alias on the opp Account — e.g.
    // "Unibail-Rodamco-Westfield (URW)" → "urw". A contact whose
    // company text equals or contains the alias clears the gap.
    const aliasOf = (s) => {
      const m = String(s || '').match(/\(([^)]+)\)\s*$/);
      return m ? m[1].toLowerCase().trim() : null;
    };
    const contactCompaniesNorm = new Set();
    const contactCompaniesRaw = [];
    const contactTokenSets = [];
    // Email domain set (lowercased, free-mail filtered) used by the
    // last-resort matcher below — covers contacts whose HubSpot
    // company field is empty but whose @something.com domain still
    // tells us where they work (e.g. mila@urw.com clearing the
    // "Unibail-Rodamco-Westfield (URW)" opp Account, or a Toronto
    // Pearson contact at @torontopearson.com clearing "Toronto
    // Airport"). The previous matchers only inspect c.company, so
    // empty-company rows used to slip through.
    const contactDomains = [];
    // Mirror what KeyContactsView does when it renders the table — a
    // user-typed _companyOverride wins over the raw HubSpot Company
    // value, so a contact whose HubSpot record has no Company text
    // (or a stale value) but whose override reads "Toronto Airport"
    // still counts as covering the matching opp Account. Without this,
    // the gap report kept flagging accounts that already had visible
    // contacts on the page just because the underlying HubSpot field
    // was empty.
    const localFields = settings?.contactLocalFields || {};
    for (const baseC of hubspotContacts) {
      const lf = localFields[String(baseC.id || baseC.vid || '')] || null;
      const c = lf && typeof lf._companyOverride === 'string' && lf._companyOverride
        ? { ...baseC, company: lf._companyOverride }
        : baseC;
      if (!visibleSelector(c) && !isKeyTargetContact(c)) continue;
      const raw = String(c.company || '').trim();
      const co = normalize(raw);
      if (co) {
        contactCompaniesNorm.add(co);
        contactCompaniesRaw.push(raw);
        const toks = tokenize(raw);
        if (toks.length) contactTokenSets.push({ raw, tokens: new Set(toks), normLower: co });
      }
      const email = String(c.email || '').toLowerCase().trim();
      const at = email.lastIndexOf('@');
      if (at >= 0) {
        const d = email.slice(at + 1).trim();
        if (d && !FREE_MAIL.has(d)) contactDomains.push(d);
      }
    }
    // Group active opps by Account; track count per company. Skip
    // pseudo-Accounts that aren't real companies — "Conferences" is a
    // placeholder used for trade-show / event-sourced opps where
    // there's no company to map a contact to, so it doesn't belong in
    // a "no contact at the company" gap report. Also skip accounts
    // belonging to a Client or Old Client prospect — those live on the
    // Client Contacts page.
    const NON_COMPANY_ACCOUNTS = new Set(['conferences']);
    const isClientAccount = (acct) => clientAccountNames.some(name => companiesMatch(name, acct));
    const byCompany = new Map();
    for (const r of oppsRecords) {
      const stage = String(r.Stage || '').trim();
      if (!stage || INVALID_STAGES.has(stage) || CLOSED_STAGES.has(stage)) continue;
      const acct = String(r.Account || '').trim();
      if (!acct) continue;
      const key = normalize(acct);
      if (NON_COMPANY_ACCOUNTS.has(key)) continue;
      if (isClientAccount(acct)) continue;
      if (!byCompany.has(key)) byCompany.set(key, { account: acct, opps: [] });
      byCompany.get(key).opps.push(r);
    }
    // Surface only companies with no contact on the Active Contacts
    // table. Exact normalized lookup first, then companiesMatch fuzzy,
    // then a prefix-token fallback so a contact at "Antin" clears an
    // opp Account "Antin Infrastructure Partners" (companiesMatch's
    // shorter≥60%-of-longer substring rule misses short prefixes),
    // then a token / alias fallback so "Westfield" or "URW" clear an
    // opp Account "Unibail-Rodamco-Westfield (URW)".
    const matchesByPrefix = (contactRaw, oppAcct) => {
      const a = normalize(contactRaw);
      const b = normalize(oppAcct);
      if (!a || !b) return false;
      if (a === b) return true;
      if (a.length >= 4 && b.startsWith(a + ' ')) return true;
      if (b.length >= 4 && a.startsWith(b + ' ')) return true;
      return false;
    };
    const out = [];
    for (const [key, info] of byCompany.entries()) {
      if (contactCompaniesNorm.has(key)) continue;
      if (contactCompaniesRaw.some(raw => companiesMatch(raw, info.account) || matchesByPrefix(raw, info.account))) continue;
      // Token / alias fallback. Tokens are ≥ 5 chars after stripping
      // corporate suffixes, so a single shared distinctive token
      // ("westfield", "rodamco") is treated as the same company. The
      // alias check covers initialisms in trailing parens — "URW" by
      // itself doesn't tokenize (too short) but should still match
      // when it equals the contact's company text or appears as one
      // of the contact's tokens.
      const oppTokens = new Set(tokenize(info.account));
      const oppAlias = aliasOf(info.account);
      const aliasMatch = oppAlias
        && contactTokenSets.some(s => s.normLower === oppAlias || s.tokens.has(oppAlias));
      const tokenMatch = oppTokens.size > 0
        && contactTokenSets.some(s => {
          for (const t of s.tokens) if (oppTokens.has(t)) return true;
          return false;
        });
      // Domain-substring fallback: when a visible contact has no
      // company text on file, fall back to the @domain piece of
      // their email. If the opp Account's parenthetical alias
      // ("urw") OR any of its distinctive tokens ("westfield",
      // "toronto") appears as a substring inside any contact's
      // domain string, treat the company as covered.
      const aliasDomainMatch = oppAlias
        && oppAlias.length >= 3
        && contactDomains.some(d => d.includes(oppAlias));
      const tokenDomainMatch = oppTokens.size > 0
        && contactDomains.some(d => {
          for (const t of oppTokens) if (t.length >= 5 && d.includes(t)) return true;
          return false;
        });
      if (aliasMatch || tokenMatch || aliasDomainMatch || tokenDomainMatch) continue;
      out.push(info);
    }
    out.sort((a, b) => b.opps.length - a.opps.length || a.account.localeCompare(b.account));
    return out;
  }, [oppsRecords, hubspotContacts, clientFilter, clientAccountNames, effectiveWindow, settings?.contactLocalFields]);
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
      {oppsWithoutContacts.length > 0 && (
        <div style={{ margin: '6px 0 8px', padding: '0.5rem 0.7rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6 }}>
          <button
            type="button"
            onClick={() => setOppsGapOpen(o => !o)}
            style={{ background: 'transparent', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: '0.72rem', color: '#92400E', fontWeight: 700, cursor: 'pointer' }}
          >
            {oppsGapOpen ? '▾' : '▸'} {oppsWithoutContacts.length} active opp{oppsWithoutContacts.length === 1 ? '' : 's'} with no HubSpot contact at the company
          </button>
          {oppsGapOpen && (
            <div style={{ marginTop: '0.4rem', maxHeight: 240, overflowY: 'auto', background: '#fff', border: '1px solid #FDE68A', borderRadius: 4 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px', padding: '0.25rem 0.6rem', background: '#FFFBEB', borderBottom: '1px solid #FDE68A', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#92400E' }}>
                <div>Account</div>
                <div style={{ textAlign: 'right' }}>Active Opps</div>
              </div>
              {oppsWithoutContacts.map(({ account, opps }) => (
                <div key={account} style={{ display: 'grid', gridTemplateColumns: '1fr 70px', padding: '0.3rem 0.6rem', borderTop: '1px solid #FEF3C7', fontSize: '0.74rem' }} title={`${opps.length} active opp${opps.length === 1 ? '' : 's'} on ${account}`}>
                  <div style={{ color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account}</div>
                  <div style={{ textAlign: 'right', fontWeight: 600, color: '#7C2D12' }}>{opps.length}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      HubSpot contacts you've emailed back-and-forth with whose company
      also has at least one open / active opportunity in the Opps
      tab: sent, opened, clicked, replied, or otherwise touched in the
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
      updateSettingsPath={updateSettingsPath}
      cdmName={cdmName}
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
