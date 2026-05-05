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

export function ClientContactsView({ prospects = [], onSelectProspect, settings, updateSettings }) {
  const clientProspects = useMemo(
    () => (prospects || []).filter(p => p.status === 'Client'),
    [prospects]
  );
  const clientDomains = useMemo(() => {
    const set = new Set();
    for (const p of clientProspects) collectDomains(p, set);
    return set;
  }, [clientProspects]);

  const selector = useCallback((c) => {
    const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
    if (tags.includes('hide')) return false;
    if (isSchneiderContact(c)) return false;
    const company = String(c.company || '').trim();
    if (company) {
      for (const p of clientProspects) {
        if (companiesMatch(p.company, company)) return true;
      }
    }
    const email = (c.email || '').toLowerCase().trim();
    const at = email.lastIndexOf('@');
    if (at >= 0) {
      const domain = email.slice(at + 1).trim();
      if (domain && !FREE_MAIL.has(domain) && clientDomains.has(domain)) return true;
    }
    return false;
  }, [clientProspects, clientDomains]);

  return (
    <KeyContactsView
      prospects={prospects}
      onSelectProspect={onSelectProspect}
      settings={settings}
      updateSettings={updateSettings}
      storagePrefix="client-contacts"
      pageTitle="Client Contacts"
      pageSubtitle={
        <>HubSpot contacts at companies tagged <code>Client</code> on the Table View. Toggle <strong>All Contacts</strong> for a flat name-by-name table or <strong>By Company</strong> to roll them up by account with opportunities and decision-maker stats.</>
      }
      emptyTitle="No client contacts found"
      emptyDetail={
        <>Either no Table View prospects are tagged <code>Client</code> yet, or none of those companies have HubSpot contacts. Set a prospect's Status to <code>Client</code> on the Table View, then add HubSpot contacts at that company.</>
      }
      contactSelector={selector}
    />
  );
}
