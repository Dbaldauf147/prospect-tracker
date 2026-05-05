// Current Client Contacts page — same layout / interactions as the
// Key Contacts page, but the selector only keeps HubSpot contacts whose
// company matches a Table View prospect tagged status === 'Client'.
//
// Match is fuzzy (companiesMatch) on the company name, and falls back
// to email-domain match against the prospect's emailDomain / website
// fields so corporate emails on companies without an exact name still
// surface.

import { useMemo, useCallback } from 'react';
import { KeyContactsView } from '../KeyContactsView/KeyContactsView';
import { matchesCdm } from '../../utils/cdmMatch';

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

function collectDomains(p, into) {
  if (!p) return;
  if (p.emailDomain) {
    for (const entry of String(p.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
      const at = entry.lastIndexOf('@');
      const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
      if (d) into.add(d);
    }
  }
  if (p.website) {
    const d = String(p.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
    if (d) into.add(d);
  }
}

export function ClientContactsView({ prospects = [], onSelectProspect, settings, updateSettings, cdmName = '' }) {
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
    for (const p of clientProspects) collectDomains(p, set);
    return set;
  }, [clientProspects]);
  const oldClientDomains = useMemo(() => {
    const set = new Set();
    for (const p of oldClientProspects) collectDomains(p, set);
    return set;
  }, [oldClientProspects]);

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

  return (
    <KeyContactsView
      prospects={prospects}
      onSelectProspect={onSelectProspect}
      settings={settings}
      updateSettings={updateSettings}
      cdmName={cdmName}
      storagePrefix="client-contacts"
      pageTitle="Client Contacts"
      pageSubtitle={
        <>HubSpot contacts at companies tagged <code>Client</code> on the Table View where the CDM is <strong>{cdmName || '(set your CDM in Settings)'}</strong>. Toggle <strong>All Contacts</strong> for a flat name-by-name table or <strong>By Company</strong> to roll them up by account with opportunities and decision-maker stats.</>
      }
      emptyTitle="No client contacts found"
      emptyDetail={
        <>None of your <code>Client</code>-status prospects (CDM = {cdmName || '—'}) have HubSpot contacts yet. Set a prospect's Status to <code>Client</code> and CDM to your name on the Table View, then add HubSpot contacts at that company.</>
      }
      contactSelector={selector}
    />
  );
}
