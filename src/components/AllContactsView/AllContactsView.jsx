// All Contacts page — same layout / interactions / popup flow as the
// Key / Active / Client tabs, surfacing every contact that would
// appear on at least one of those rosters. Implemented as a wrapper
// around KeyContactsView with a combined selector, so clicking a
// name opens the same Edit HubSpot Contact popup the dedicated tabs
// use, the Met In Person / Tags / Events columns work identically,
// the All Contacts ↔ By Company toggle is preserved, and column
// widths / sort / visibility prefs persist independently under the
// "all-contacts" storage prefix.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { matchesCdm } from '../../utils/cdmMatch';
import { KeyContactsView, useOppsRecords } from '../KeyContactsView/KeyContactsView';
import { makeActiveSelector } from '../ActiveContactsView/ActiveContactsView';
import { collectClientDomains } from '../ClientContactsView/ClientContactsView';
import { getHubspotCache } from '../../utils/hubspotContactsCache';

const CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
const INVALID_STAGES = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);

const SCHNEIDER_COMPANY_RE = /\bschneider\s*electric\b/i;
const SCHNEIDER_DOMAIN_RE = /(^|\.)(se\.com|schneider-electric\.com|schneider\.com)$/i;
function isSchneiderContact(c) {
  if (SCHNEIDER_COMPANY_RE.test(String(c?.company || ''))) return true;
  const email = String(c?.email || '').toLowerCase().trim();
  const at = email.lastIndexOf('@');
  if (at >= 0) {
    const domain = email.slice(at + 1).trim();
    if (SCHNEIDER_DOMAIN_RE.test(domain)) return true;
  }
  return false;
}

const FREE_MAIL = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
  'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com',
]);

// Cheap fuzzy company-name compare — used to mirror the dedicated
// Active page's open-opp gate (an opp Account often differs in
// suffix / abbreviation from the contact's HubSpot Company text).
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

export function AllContactsView({ prospects = [], onSelectProspect, settings, updateSettings, cdmName = '' }) {
  const { user } = useAuth();
  const oppsRecords = useOppsRecords(user?.uid);

  // ---- Active gate (mirror of ActiveContactsView) -------------------
  // Build the same client-company exclusion set the Active page uses,
  // so a contact whose company is a current Client doesn't get pushed
  // out of the Active bucket here when the same user would still see
  // them on the Client tab. We keep the contact in if it matches Key
  // OR Client OR Active anyway.
  const activeClientFilter = useMemo(() => {
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

  // Companies (raw-cased strings) with at least one open / active opp.
  // Matches KeyContactsView's requireActiveOpp = true derivation so
  // the Active gate here lines up with the dedicated page's count.
  const activeOppCompanies = useMemo(() => {
    if (!oppsRecords || oppsRecords.length === 0) return [];
    const out = [];
    const seen = new Set();
    for (const r of oppsRecords) {
      const stage = String(r['Stage'] || '').trim();
      if (!stage || INVALID_STAGES.has(stage) || CLOSED_STAGES.has(stage)) continue;
      const acct = String(r['Account'] || '').trim();
      const k = acct.toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(acct);
    }
    return out;
  }, [oppsRecords]);

  // "Show hidden contacts" toggle. Same review-mode behaviour the
  // dedicated Active page exposes — when on, the page becomes a list
  // of every Hide-tagged contact that would otherwise have qualified
  // for Key / Active / Client, so the user can audit and un-hide via
  // the contact popup. Persisted in localStorage so the toggle
  // survives a refresh.
  const [showHidden, setShowHidden] = useState(() => {
    try { return localStorage.getItem('all-contacts:show-hidden') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('all-contacts:show-hidden', showHidden ? '1' : '0'); } catch {}
  }, [showHidden]);

  const baseActiveSelector = useMemo(
    () => makeActiveSelector(90, showHidden ? 'hidden' : 'visible', activeClientFilter),
    [activeClientFilter, showHidden]
  );
  const isActive = useCallback((c) => {
    if (!baseActiveSelector(c)) return false;
    const cName = String(c.company || '').trim();
    if (!cName) return false;
    const lc = cName.toLowerCase();
    if (activeOppCompanies.some(a => a.toLowerCase() === lc)) return true;
    if (activeOppCompanies.some(a => companiesMatch(a, cName))) return true;
    return false;
  }, [baseActiveSelector, activeOppCompanies]);

  // ---- Client gate (mirror of ClientContactsView) -------------------
  const clientProspects = useMemo(
    () => (prospects || []).filter(p => p.status === 'Client' && matchesCdm(p.cdm, cdmName)),
    [prospects, cdmName]
  );
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
  const isClient = useCallback((c) => {
    const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
    const hidden = tags.includes('hide');
    // Show Hidden flips the Hide gate so the page becomes a review of
    // suppressed contacts that would otherwise have qualified.
    if (showHidden ? !hidden : hidden) return false;
    if (tags.includes('left')) return false;
    if (isSchneiderContact(c)) return false;
    const company = String(c.company || '').trim();
    const companyLower = company.toLowerCase();
    const email = (c.email || '').toLowerCase().trim();
    const at = email.lastIndexOf('@');
    const domain = at >= 0 ? email.slice(at + 1).trim() : '';
    const domainOk = domain && !FREE_MAIL.has(domain);
    if (company && oldClientProspects.some(p => String(p.company || '').toLowerCase().trim() === companyLower)) return false;
    if (domainOk && oldClientDomains.has(domain)) return false;
    if (company && clientProspects.some(p => String(p.company || '').toLowerCase().trim() === companyLower)) return true;
    if (!company && domainOk && clientDomains.has(domain)) return true;
    return false;
  }, [clientProspects, oldClientProspects, clientDomains, oldClientDomains, showHidden]);

  // ---- Key gate (no-override default from KeyContactsView) ----------
  const isKey = useCallback((c) => {
    const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
    const hidden = tags.includes('hide');
    if (showHidden ? !hidden : hidden) return false;
    if (tags.includes('left')) return false;
    if (isSchneiderContact(c)) return false;
    return tags.includes('dan key target');
  }, [showHidden]);

  // Combined selector — a contact passes when it would land on at
  // least one of the dedicated rosters.
  const combinedSelector = useCallback(
    (c) => isKey(c) || isActive(c) || isClient(c),
    [isKey, isActive, isClient]
  );

  // Count of hide-tagged contacts that WOULD qualify if not hidden,
  // so the toggle pill shows the user how many they'd uncover. We
  // re-run the selectors with showHidden inverted via a probe that
  // mirrors the visible-mode gates and flips the Hide check.
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
  const hiddenCount = useMemo(() => {
    if (!hubspotContacts.length) return 0;
    // Build a "hidden mode" probe — same combined logic but with the
    // Hide gate flipped, so we count contacts that would surface if
    // the user toggled Show Hidden on.
    const baseHiddenActive = makeActiveSelector(90, 'hidden', activeClientFilter);
    const isActiveHidden = (c) => {
      if (!baseHiddenActive(c)) return false;
      const cName = String(c.company || '').trim();
      if (!cName) return false;
      const lc = cName.toLowerCase();
      if (activeOppCompanies.some(a => a.toLowerCase() === lc)) return true;
      if (activeOppCompanies.some(a => companiesMatch(a, cName))) return true;
      return false;
    };
    const isKeyHidden = (c) => {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (!tags.includes('hide')) return false;
      if (tags.includes('left')) return false;
      if (isSchneiderContact(c)) return false;
      return tags.includes('dan key target');
    };
    const isClientHidden = (c) => {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (!tags.includes('hide')) return false;
      if (tags.includes('left')) return false;
      if (isSchneiderContact(c)) return false;
      const company = String(c.company || '').trim();
      const companyLower = company.toLowerCase();
      const email = (c.email || '').toLowerCase().trim();
      const at = email.lastIndexOf('@');
      const domain = at >= 0 ? email.slice(at + 1).trim() : '';
      const domainOk = domain && !FREE_MAIL.has(domain);
      if (company && oldClientProspects.some(p => String(p.company || '').toLowerCase().trim() === companyLower)) return false;
      if (domainOk && oldClientDomains.has(domain)) return false;
      if (company && clientProspects.some(p => String(p.company || '').toLowerCase().trim() === companyLower)) return true;
      if (!company && domainOk && clientDomains.has(domain)) return true;
      return false;
    };
    let n = 0;
    for (const c of hubspotContacts) {
      if (isKeyHidden(c) || isActiveHidden(c) || isClientHidden(c)) n += 1;
    }
    return n;
  }, [hubspotContacts, activeClientFilter, activeOppCompanies, clientProspects, oldClientProspects, clientDomains, oldClientDomains]);

  const subtitle = (
    <>
      Every HubSpot contact that lands on at least one of the dedicated <strong>Key</strong>, <strong>Active</strong>, or <strong>Client</strong> rosters — same selectors and filters those tabs run, rolled up into a single list. Click a name to open <strong>Edit HubSpot Contact</strong>. Toggle <strong>All Contacts</strong> for a flat name-by-name table or <strong>By Company</strong> to roll them up by account with opportunities and decision-maker stats. Use the per-row <strong>Hide</strong> button to suppress contacts you don't want in the rosters.
      <div style={{ marginTop: 4 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: '#475569', cursor: 'pointer' }}>
          <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />
          <span>Show hidden contacts</span>
          <span
            title="HubSpot contacts you've hidden via the Hide button that would otherwise qualify for Key / Active / Client. Toggle on to review and un-hide via the contact popup."
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
      cdmName={cdmName}
      storagePrefix="all-contacts"
      pageTitle="All Contacts"
      pageSubtitle={subtitle}
      emptyTitle="No contacts found"
      emptyDetail={
        <>Nothing matched. A contact appears on this page when it would also appear on Key, Active, or Client Contacts. Try the dedicated tabs to see why a specific contact is being filtered out.</>
      }
      contactSelector={combinedSelector}
    />
  );
}
