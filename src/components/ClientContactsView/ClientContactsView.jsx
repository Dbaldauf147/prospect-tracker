// Current Client Contacts page — same layout / interactions as the
// Key Contacts page, but the selector only keeps HubSpot contacts whose
// company matches a Table View prospect tagged status === 'Client'.
//
// Match is fuzzy (companiesMatch) on the company name, and falls back
// to email-domain match against the prospect's emailDomain / website
// fields so corporate emails on companies without an exact name still
// surface.

import { useMemo, useCallback, useState, useEffect } from 'react';
import { KeyContactsView } from '../KeyContactsView/KeyContactsView';
import { matchesCdm } from '../../utils/cdmMatch';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { collectClientDomains } from '../../utils/contactRosters';

const FREE_MAIL = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
  'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com',
]);

// Schneider Electric is the user's own employer — internal coworkers
// shouldn't show up in this list, so anything matching the company
// name or an @se.com / @schneider-electric.com email domain is
// excluded regardless of whether a "Schneider Electric" prospect
// happens to be tagged as a Client.
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
  return false;
}

export function ClientContactsView({ prospects = [], onSelectProspect, settings, updateSettings, updateSettingsPath, cdmName = '' }) {
  // Only the logged-in user's clients. Mirrors how ClientsView scopes
  // its list — `matchesCdm` handles "Dan Baldauf" / "Baldauf, Dan" /
  // "D. Baldauf" / "Dan B" variants. Without a configured cdmName we
  // intentionally show nothing rather than every CDM's clients, since
  // the page is meant to be a personal worklist.
  const clientProspects = useMemo(
    () => (prospects || []).filter(p => p.status === 'Client' && matchesCdm(p.cdm, cdmName)),
    [prospects, cdmName]
  );
  // Old Client wins over Client when both fuzzy-match a contact's
  // company — that way Brookfield Asset Management (Old Client) doesn't
  // sneak in via a near-name match to some other Brookfield-* current
  // Client. Old Client exclusion is *not* CDM-scoped because we want
  // to suppress an old-client name even when it's another CDM's now.
  const oldClientProspects = useMemo(
    () => (prospects || []).filter(p => p.status === 'Old Client'),
    [prospects]
  );
  const clientDomains = useMemo(() => {
    const set = new Set();
    for (const p of clientProspects) collectClientDomains(p, set);
    return set;
  }, [clientProspects]);
  const oldClientDomains = useMemo(() => {
    const set = new Set();
    for (const p of oldClientProspects) collectClientDomains(p, set);
    return set;
  }, [oldClientProspects]);

  // HubSpot cache, refreshed on cache-update events. Used to compute
  // which Client prospects don't yet have a contact rendering on this
  // page so the user can see which accounts still need someone added.
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
  const [gapOpen, setGapOpen] = useState(false);

  const selector = useCallback((c) => {
    const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
    if (tags.includes('hide')) return false;
    // Departed contacts live on the Changed Jobs tab — don't surface
    // them under their old client.
    if (tags.includes('left')) return false;
    if (isSchneiderContact(c)) return false;
    const company = String(c.company || '').trim();
    const companyLower = company.toLowerCase();
    const email = (c.email || '').toLowerCase().trim();
    const at = email.lastIndexOf('@');
    const domain = at >= 0 ? email.slice(at + 1).trim() : '';
    const domainOk = domain && !FREE_MAIL.has(domain);
    // Strict 1:1 name match against the relevant prospect lists. The
    // previous fuzzy companiesMatch was grouping e.g. "Marriott
    // International" contacts under a "Marriott" Client prospect via
    // the single-token rule. Now the contact's Company must exactly
    // equal a Client prospect's Company text (case-insensitive,
    // trimmed). Email-domain match remains as a backstop when the
    // contact has no company text on file.
    if (company && oldClientProspects.some(p => String(p.company || '').toLowerCase().trim() === companyLower)) return false;
    if (domainOk && oldClientDomains.has(domain)) return false;
    if (company && clientProspects.some(p => String(p.company || '').toLowerCase().trim() === companyLower)) return true;
    if (!company && domainOk && clientDomains.has(domain)) return true;
    return false;
  }, [clientProspects, clientDomains, oldClientProspects, oldClientDomains]);

  // Client prospects (CDM = me) that have *no* HubSpot contact
  // visible on this page. Mirrors the page's selector rules: a client
  // is "covered" when at least one passing contact links to it via an
  // exact company-name match (case-insensitive) or, when the contact
  // has no company text, via an email-domain match against the
  // prospect's emailDomain / website. The list is shown above the
  // table so the user can see which clients still need a contact
  // added.
  const clientsWithoutContacts = useMemo(() => {
    if (!clientProspects.length) return [];
    const clientByCompany = new Map();
    for (const p of clientProspects) {
      const k = String(p.company || '').toLowerCase().trim();
      if (k && !clientByCompany.has(k)) clientByCompany.set(k, p);
    }
    const clientByDomain = new Map();
    for (const p of clientProspects) {
      const ds = new Set();
      collectClientDomains(p, ds);
      for (const d of ds) {
        if (!clientByDomain.has(d)) clientByDomain.set(d, p);
      }
    }
    // Mirror what KeyContactsView does when it renders the table —
    // a user-typed _companyOverride wins over the raw HubSpot Company
    // value, so a contact whose HubSpot record has no Company text
    // (or a stale value) but whose override reads "American Campus
    // Communities Inc." still counts as covering the matching client
    // prospect. Without this, the gap report kept flagging clients
    // that already had visible contacts on the page just because the
    // underlying HubSpot field was empty.
    const localFields = settings?.contactLocalFields || {};
    const covered = new Set();
    for (const baseC of hubspotContacts) {
      const lf = localFields[String(baseC.id || baseC.vid || '')] || null;
      const c = lf && typeof lf._companyOverride === 'string' && lf._companyOverride
        ? { ...baseC, company: lf._companyOverride }
        : baseC;
      if (!selector(c)) continue;
      const company = String(c.company || '').toLowerCase().trim();
      if (company) {
        const p = clientByCompany.get(company);
        if (p) covered.add(p);
        continue;
      }
      const email = (c.email || '').toLowerCase().trim();
      const at = email.lastIndexOf('@');
      const domain = at >= 0 ? email.slice(at + 1).trim() : '';
      if (domain && !FREE_MAIL.has(domain)) {
        const p = clientByDomain.get(domain);
        if (p) covered.add(p);
      }
    }
    return clientProspects
      .filter(p => !covered.has(p))
      .sort((a, b) => String(a.company || '').localeCompare(String(b.company || '')));
  }, [clientProspects, hubspotContacts, selector, settings?.contactLocalFields]);

  const subtitle = (
    <>
      {clientsWithoutContacts.length > 0 && (
        <div style={{ margin: '6px 0 8px', padding: '0.5rem 0.7rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6 }}>
          <button
            type="button"
            onClick={() => setGapOpen(o => !o)}
            style={{ background: 'transparent', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: '0.72rem', color: '#92400E', fontWeight: 700, cursor: 'pointer' }}
            title="Click to expand the list of Client prospects (CDM = you) that don't have a HubSpot contact on this page yet."
          >
            {gapOpen ? '▾' : '▸'} {clientsWithoutContacts.length} client{clientsWithoutContacts.length === 1 ? '' : 's'} with no HubSpot contact on this page
          </button>
          {gapOpen && (
            <div style={{ marginTop: '0.4rem', maxHeight: 240, overflowY: 'auto', background: '#fff', border: '1px solid #FDE68A', borderRadius: 4 }}>
              {clientsWithoutContacts.map(p => (
                <div
                  key={p.id || p.company}
                  onClick={() => onSelectProspect && onSelectProspect(p)}
                  style={{ padding: '0.3rem 0.6rem', borderTop: '1px solid #FEF3C7', fontSize: '0.74rem', color: '#1E293B', cursor: onSelectProspect ? 'pointer' : 'default' }}
                  title={onSelectProspect ? `Open ${p.company} on the Table View` : p.company}
                >
                  {p.company || '(unnamed prospect)'}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      HubSpot contacts at companies tagged <code>Client</code> on the Table View where the CDM is <strong>{cdmName || '(set your CDM in Settings)'}</strong>. Toggle <strong>All Contacts</strong> for a flat name-by-name table or <strong>By Company</strong> to roll them up by account with opportunities and decision-maker stats.
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
      storagePrefix="client-contacts"
      pageTitle="Client Contacts"
      pageSubtitle={subtitle}
      emptyTitle="No client contacts found"
      emptyDetail={
        <>None of your <code>Client</code>-status prospects (CDM = {cdmName || '-'}) have HubSpot contacts yet. Set a prospect's Status to <code>Client</code> and CDM to your name on the Table View, then add HubSpot contacts at that company.</>
      }
      contactSelector={selector}
    />
  );
}
