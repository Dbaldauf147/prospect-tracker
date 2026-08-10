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
import { loadClientStatusMap, CLIENT_STATUS_EVENT } from '../../utils/clientManagerStore';
import { isCancellingForSure } from '../../utils/serviceCoverage';

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

// A contact's Dan's Tags as individual values. Stored as one ';'-joined
// string (the separator the tag picker and the bulk tag editor write), so
// the Tags column's own value filter can only match the whole combination —
// "Decision Maker;Met In Person" is a single distinct value there. Splitting
// is what lets the tag filter below match a contact by any one of its tags.
function contactTagList(c) {
  return String(c?.dans_tags || c?.dan_s_tags || c?.dans_tag || '')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
}

// The three answers the contact popup records against a tag, in the order
// the filter offers them.
const TAG_STATUSES = [
  { key: 'yes',    label: 'Yes',      bg: '#DCFCE7', border: '#86EFAC', color: '#166534', tip: 'Contacts carrying this tag' },
  { key: 'unsure', label: 'Not sure', bg: '#FEF3C7', border: '#FCD34D', color: '#92400E', tip: 'Contacts answered "Not sure" for this tag in the contact popup' },
  { key: 'no',     label: 'No',       bg: '#FEE2E2', border: '#FCA5A5', color: '#991B1B', tip: 'Contacts answered "No" for this tag in the contact popup' },
];

// One contact's answer for one tag, read the same way the contact popup
// reads it: the tag being present IS the Yes — HubSpot only ever holds tags
// that apply — while No and Not sure are answers HubSpot can't express and
// live in settings.contactTagReview. No answer at all returns ''.
//
// That asymmetry is why this page could only ever show the Yes contacts
// under a tag: answering No takes the tag off, so the contact left the tag
// filter along with the answer.
function contactTagStatus(c, tag, reviewMap) {
  if (!tag) return '';
  const lower = tag.toLowerCase();
  if (contactTagList(c).some(t => t.toLowerCase() === lower)) return 'yes';
  const cid = c?.id ?? c?.vid;
  const answers = cid == null ? null : reviewMap?.[cid];
  if (!answers || typeof answers !== 'object') return '';
  // Keyed by the tag as the popup spelled it, so match case-insensitively
  // for the same reason the tag filter itself does.
  for (const [k, v] of Object.entries(answers)) {
    if (k.toLowerCase() !== lower) continue;
    return (v === 'no' || v === 'unsure') ? v : '';
  }
  return '';
}

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

  // ---- Cancelling clients ------------------------------------------
  // A client whose Clients-tab Status says "Cancelling for Sure" is on its
  // way out, so its people don't belong on a roster of who to work. The
  // status map is the Clients tab's own store, keyed by company name
  // lowercased + trimmed, and it's re-read on the same events the Clients
  // tab fires so a status change here takes effect without a reload.
  const [clientStatusMap, setClientStatusMap] = useState(() => loadClientStatusMap());
  useEffect(() => {
    function onStorage(e) { if (e.key === 'clients-status-map') setClientStatusMap(loadClientStatusMap()); }
    function onStatus() { setClientStatusMap(loadClientStatusMap()); }
    window.addEventListener('storage', onStorage);
    window.addEventListener(CLIENT_STATUS_EVENT, onStatus);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CLIENT_STATUS_EVENT, onStatus);
    };
  }, []);

  // The cancelling accounts, by name and by email domain. Domains come off
  // the account record (its Email Domain and Website), so a contact whose
  // HubSpot Company text is spelled differently from the account — the
  // common case — is caught too. Names alone would miss most of them.
  const cancellingClients = useMemo(() => {
    const companies = new Set();
    const domains = new Set();
    for (const p of (prospects || [])) {
      const key = String(p?.company || '').trim().toLowerCase();
      if (!key || !isCancellingForSure(clientStatusMap[key])) continue;
      companies.add(key);
      collectClientDomains(p, domains);
    }
    return { companies, domains };
  }, [prospects, clientStatusMap]);

  // Is this contact one of a cancelling account's people? Free-mail domains
  // are nobody's account domain, so they never match on domain — a personal
  // gmail address at a cancelling client is caught by the company name or
  // not at all, rather than by a domain every account could share.
  const isAtCancellingClient = useCallback((c) => {
    if (cancellingClients.companies.size === 0 && cancellingClients.domains.size === 0) return false;
    const company = String(c?.company || '').trim().toLowerCase();
    if (company && cancellingClients.companies.has(company)) return true;
    const email = String(c?.email || '').toLowerCase().trim();
    const at = email.lastIndexOf('@');
    const domain = at >= 0 ? email.slice(at + 1).trim() : '';
    return !!domain && !FREE_MAIL.has(domain) && cancellingClients.domains.has(domain);
  }, [cancellingClients]);

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

  // ---- Key Prospect gate (mirror of KeyProspectsView) ---------------
  // A contact is a "Key Prospect" when it's tagged Decision Maker at a
  // Tier 1 / Tier 2 account on this CDM whose company has no opps yet.
  const myTierAccounts = useMemo(() => {
    return (prospects || []).filter(p => {
      if (!matchesCdm(p.cdm, cdmName)) return false;
      // Clients aren't prospects — keep them out of the Key Prospect bucket.
      if (p.status === 'Client') return false;
      const t = (p.tier || '').toLowerCase();
      return t === 'tier 1' || t === 'tier 2';
    });
  }, [prospects, cdmName]);

  const allOppAccounts = useMemo(() => {
    const set = new Set();
    if (!oppsRecords) return set;
    for (const r of oppsRecords) {
      const acct = String(r['Account'] || '').trim().toLowerCase();
      if (acct) set.add(acct);
    }
    return set;
  }, [oppsRecords]);
  const allOppAccountsArr = useMemo(() => Array.from(allOppAccounts), [allOppAccounts]);

  // Map<lowercase company, { tier, hasOpp }> for the Tier 1/2 accounts.
  const tierAccountStatus = useMemo(() => {
    const map = new Map();
    for (const p of myTierAccounts) {
      const lc = String(p.company || '').toLowerCase().trim();
      if (!lc) continue;
      let hasOpp = allOppAccounts.has(lc);
      if (!hasOpp) {
        for (const acct of allOppAccountsArr) {
          if (companiesMatch(p.company, acct)) { hasOpp = true; break; }
        }
      }
      map.set(lc, { tier: p.tier, hasOpp });
    }
    return map;
  }, [myTierAccounts, allOppAccounts, allOppAccountsArr]);

  // Shared decision: does this contact sit at a Tier 1/2 account (CDM = me)
  // with no opps yet? `tags` is the lowercased dans_tags string.
  const isKeyProspectAtTierAccount = useCallback((c) => {
    const company = String(c.company || '').trim();
    if (!company) return false;
    const lc = company.toLowerCase();
    const direct = tierAccountStatus.get(lc);
    if (direct) return !direct.hasOpp;
    for (const p of myTierAccounts) {
      if (companiesMatch(p.company, company)) {
        const status = tierAccountStatus.get(String(p.company || '').toLowerCase().trim());
        if (status) return !status.hasOpp;
      }
    }
    return false;
  }, [tierAccountStatus, myTierAccounts]);

  // "Show hidden contacts" toggle. Same review-mode behaviour the
  // dedicated Active page exposes — when on, the page becomes a list
  // of every Hide-tagged contact that would otherwise have qualified
  // for Key / Active / Client, so the user can audit and un-hide via
  // the contact popup. Persisted in localStorage so the toggle
  // survives a refresh.
  const [showHidden, setShowHidden] = useState(() => {
    try { return localStorage.getItem('all-contacts:show-hidden') === '1'; } catch { return false; }
  });

  // Clickable category filter driven by the Totals pills. null = show
  // all; otherwise narrow to 'Key' / 'Active' / 'Client'. Clicking the
  // active pill again clears it.
  const [categoryFilter, setCategoryFilter] = useState(null);
  // Chosen Dan's Tag, or '' for no tag gate. Transient like categoryFilter
  // (not persisted) — it's an exploration filter, not a page preference.
  const [tagFilter, setTagFilter] = useState('');
  // Which of the three tag answers to show, as a Set of TAG_STATUSES keys.
  // Empty means no status gate — the tag filter behaves as it always has,
  // showing the contacts that carry the tag. Transient, like the tag itself.
  const [tagStatusFilter, setTagStatusFilter] = useState(() => new Set());
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

  // ---- Key Prospect gate --------------------------------------------
  const isKeyProspect = useCallback((c) => {
    const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
    const hidden = tags.includes('hide');
    if (showHidden ? !hidden : hidden) return false;
    if (tags.includes('left')) return false;
    if (isSchneiderContact(c)) return false;
    if (!tags.includes('decision maker')) return false;
    return isKeyProspectAtTierAccount(c);
  }, [showHidden, isKeyProspectAtTierAccount]);

  // Roster gate — a contact passes when it would land on at least one of
  // the dedicated rosters and isn't at an account that's cancelling. The
  // exclusion sits here, above the individual gates, so it holds however
  // the contact would otherwise have qualified. The tag filter composes on
  // top of this below.
  const rosterSelector = useCallback(
    (c) => !isAtCancellingClient(c) && (isKey(c) || isActive(c) || isClient(c) || isKeyProspect(c)),
    [isAtCancellingClient, isKey, isActive, isClient, isKeyProspect]
  );

  // (combinedSelector — the roster gate plus the tag gate — is defined with
  // the tag list further down, since it needs the loaded HubSpot cache.)

  // Categorisation function for the Category column. Returns the
  // array of labels (Key / Active / Client / Key Prospect) the contact
  // qualifies for so KeyContactsView can render a colored pill per label.
  const categorizeContact = useCallback((c) => {
    const out = [];
    if (isKey(c)) out.push('Key');
    if (isActive(c)) out.push('Active');
    if (isClient(c)) out.push('Client');
    if (isKeyProspect(c)) out.push('Key Prospect');
    return out;
  }, [isKey, isActive, isClient, isKeyProspect]);

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
    const isKeyProspectHidden = (c) => {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (!tags.includes('hide')) return false;
      if (tags.includes('left')) return false;
      if (isSchneiderContact(c)) return false;
      if (!tags.includes('decision maker')) return false;
      return isKeyProspectAtTierAccount(c);
    };
    let n = 0;
    for (const c of hubspotContacts) {
      // Same cancelling exclusion the roster gate applies, so the badge
      // doesn't promise contacts that Show Hidden wouldn't surface.
      if (isAtCancellingClient(c)) continue;
      if (isKeyHidden(c) || isActiveHidden(c) || isClientHidden(c) || isKeyProspectHidden(c)) n += 1;
    }
    return n;
  }, [hubspotContacts, activeClientFilter, activeOppCompanies, clientProspects, oldClientProspects, clientDomains, oldClientDomains, isKeyProspectAtTierAccount, isAtCancellingClient]);

  // Per-category totals across the loaded HubSpot cache. Uses the
  // visible-mode selectors (showHidden = false) so the numbers reflect
  // what each dedicated tab would surface today, not the inverted
  // "review hidden" view. Each category counted independently and the
  // total is the de-duped union across all three.
  const categoryCounts = useMemo(() => {
    const visibleActiveBase = makeActiveSelector(90, 'visible', activeClientFilter);
    const visIsActive = (c) => {
      if (!visibleActiveBase(c)) return false;
      const cName = String(c.company || '').trim();
      if (!cName) return false;
      const lc = cName.toLowerCase();
      if (activeOppCompanies.some(a => a.toLowerCase() === lc)) return true;
      if (activeOppCompanies.some(a => companiesMatch(a, cName))) return true;
      return false;
    };
    const visIsKey = (c) => {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('hide') || tags.includes('left')) return false;
      if (isSchneiderContact(c)) return false;
      return tags.includes('dan key target');
    };
    const visIsClient = (c) => {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('hide') || tags.includes('left')) return false;
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
    const visIsKeyProspect = (c) => {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('hide') || tags.includes('left')) return false;
      if (isSchneiderContact(c)) return false;
      if (!tags.includes('decision maker')) return false;
      return isKeyProspectAtTierAccount(c);
    };
    let key = 0, active = 0, client = 0, keyProspect = 0, total = 0, cancelling = 0;
    const localFields = settings?.contactLocalFields || {};
    for (const baseC of hubspotContacts) {
      const lf = localFields[String(baseC.id || baseC.vid || '')] || null;
      const c = lf && typeof lf._companyOverride === 'string' && lf._companyOverride
        ? { ...baseC, company: lf._companyOverride }
        : baseC;
      const k = visIsKey(c);
      const a = visIsActive(c);
      const cl = visIsClient(c);
      const kp = visIsKeyProspect(c);
      // Counted, not tallied into the pills: how many the cancelling
      // exclusion took out. A page that quietly shrinks is worse than one
      // that says what it left behind.
      if (isAtCancellingClient(c)) {
        if (k || a || cl || kp) cancelling++;
        continue;
      }
      if (k) key++;
      if (a) active++;
      if (cl) client++;
      if (kp) keyProspect++;
      if (k || a || cl || kp) total++;
    }
    return { key, active, client, keyProspect, total, cancelling };
  }, [hubspotContacts, activeClientFilter, activeOppCompanies, clientProspects, oldClientProspects, clientDomains, oldClientDomains, settings?.contactLocalFields, isKeyProspectAtTierAccount, isAtCancellingClient]);

  // Every distinct tag worn by a contact on this page, with how many wear
  // it, most-used first. Derived from the roster gate rather than the full
  // HubSpot cache so the list only offers tags that actually return rows,
  // and counted before the tag gate so the numbers don't collapse to the
  // current selection.
  //
  // Tags that differ only in case are one entry, shown in whichever spelling
  // the most contacts use (ties broken alphabetically, so the label doesn't
  // hinge on cache order). Matching is case-insensitive either way — the
  // spelling only decides what the dropdown reads.
  const tagOptions = useMemo(() => {
    const byKey = new Map();
    for (const c of hubspotContacts) {
      if (!rosterSelector(c)) continue;
      const seenHere = new Set();
      for (const tag of contactTagList(c)) {
        const key = tag.toLowerCase();
        // A tag repeated within one contact still only counts once.
        if (seenHere.has(key)) continue;
        seenHere.add(key);
        let hit = byKey.get(key);
        if (!hit) { hit = { count: 0, spellings: new Map() }; byKey.set(key, hit); }
        hit.count += 1;
        hit.spellings.set(tag, (hit.spellings.get(tag) || 0) + 1);
      }
    }
    return [...byKey.values()]
      .map(({ count, spellings }) => ({
        count,
        tag: [...spellings.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [hubspotContacts, rosterSelector]);

  // The tag actually in force. A tag that stops existing — retagged from the
  // bulk editor, or the cache reloaded without it — falls back to no filter
  // rather than stranding the page on an empty list with nothing in the
  // dropdown to undo it. Derived, so the recovery needs no effect.
  const activeTag = useMemo(() => (
    tagFilter && tagOptions.some(o => o.tag.toLowerCase() === tagFilter.toLowerCase()) ? tagFilter : ''
  ), [tagFilter, tagOptions]);

  // The tag review answers, and the status gate actually in force. Statuses
  // only mean anything against one tag — an answer is per contact per tag —
  // so with no tag chosen the toggles are inert (and disabled in the UI).
  // Memoized: the `|| {}` fallback would otherwise hand a fresh object to
  // the memo and the selector on every render, re-filtering the whole page.
  const tagReviewMap = useMemo(() => settings?.contactTagReview || {}, [settings?.contactTagReview]);
  const activeStatuses = activeTag ? tagStatusFilter : null;
  const statusGateOn = !!activeStatuses && activeStatuses.size > 0;

  // How many contacts sit behind each status for the chosen tag. Counted off
  // the roster gate rather than the current selection, so the numbers on the
  // pills don't collapse as you toggle them — same reason the tag dropdown
  // counts before its own gate.
  const tagStatusCounts = useMemo(() => {
    const out = { yes: 0, unsure: 0, no: 0 };
    if (!activeTag) return out;
    for (const c of hubspotContacts) {
      if (!rosterSelector(c)) continue;
      const s = contactTagStatus(c, activeTag, tagReviewMap);
      if (s) out[s] += 1;
    }
    return out;
  }, [hubspotContacts, rosterSelector, activeTag, tagReviewMap]);

  // Combined selector — the roster gate plus the chosen tag. Filtering here
  // rather than at the row level means the whole page follows the tag: the
  // flat table, the By Company rollup, Travel, and every column's filter
  // dropdown all see the narrowed set.
  const combinedSelector = useCallback((c) => {
    if (!rosterSelector(c)) return false;
    if (!activeTag) return true;
    // With statuses toggled on, the gate is the contact's answer for this
    // tag — which is the only way a No / Not sure contact can appear at all,
    // since neither carries the tag.
    if (statusGateOn) return activeStatuses.has(contactTagStatus(c, activeTag, tagReviewMap));
    // Exact match per tag, not substring — "Key" must not sweep in every
    // "Dan Key Target" contact.
    return contactTagList(c).some(t => t.toLowerCase() === activeTag.toLowerCase());
  }, [rosterSelector, activeTag, statusGateOn, activeStatuses, tagReviewMap]);

  const subtitle = (
    <>
      Every HubSpot contact that lands on at least one of the dedicated <strong>Key</strong>, <strong>Active</strong>, <strong>Client</strong>, or <strong>Key Prospect</strong> rosters: same selectors and filters those tabs run, rolled up into a single list. Click a name to open <strong>Edit HubSpot Contact</strong>. Toggle <strong>All Contacts</strong> for a flat name-by-name table, <strong>By Company</strong> to roll them up by account with opportunities and decision-maker stats, or <strong>Travel</strong> to pick a state/city and see everyone in that area. Contacts at accounts whose Status on the Clients tab is <strong>Cancelling for Sure</strong> are left out. Use the per-row <strong>Hide</strong> button to suppress contacts you don't want in the rosters. Tick the row checkboxes and hit <strong>Edit Tags</strong> (or open <strong>Mass Edit</strong> and pick the <strong>Tags</strong> field) to add, remove, or replace Dan's Tags across every selected contact at once.
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 700 }}>Totals:</span>
        {[
          { cat: null,     label: 'All',    count: categoryCounts.total,  bg: '#F1F5F9', border: '#CBD5E1', color: '#334155', tip: 'Show all contacts (clear the category filter)' },
          { cat: 'Key',    label: 'Key',    count: categoryCounts.key,    bg: '#FEF3C7', border: '#FCD34D', color: '#92400E', tip: 'Click to show only contacts tagged Dan Key Target' },
          { cat: 'Active', label: 'Active', count: categoryCounts.active, bg: '#DCFCE7', border: '#86EFAC', color: '#166534', tip: 'Click to show only contacts in the active window with an open opp (mirrors the Active Contacts page)' },
          { cat: 'Client', label: 'Client', count: categoryCounts.client, bg: '#DBEAFE', border: '#93C5FD', color: '#1E3A8A', tip: 'Click to show only contacts whose company is a current Client on your CDM (mirrors the Client Contacts page)' },
          { cat: 'Key Prospect', label: 'Key Prospect', count: categoryCounts.keyProspect, bg: '#EDE9FE', border: '#C4B5FD', color: '#5B21B6', tip: 'Click to show only Decision Maker contacts at Tier 1 / Tier 2 accounts on your CDM whose company has no opps yet (mirrors the Key Prospects page)' },
        ].map(({ cat, label, count, bg, border, color, tip }) => {
          const selected = categoryFilter === cat;
          return (
            <button
              key={label}
              data-category-pill={label}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              title={tip}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '1px 8px', borderRadius: 999,
                background: selected ? color : bg,
                border: `1px solid ${selected ? color : border}`,
                color: selected ? '#fff' : color,
                fontSize: '0.68rem', fontWeight: 700,
                fontFamily: 'inherit', cursor: 'pointer',
                boxShadow: selected ? `0 0 0 2px ${border}` : 'none',
              }}
            >
              {label} <span style={{ fontWeight: 800 }}>{count}</span>
            </button>
          );
        })}
        {categoryCounts.cancelling > 0 && (
          <span
            data-cancelling-note
            title={'Contacts at accounts whose Status on the Clients tab is "Cancelling for Sure". They\'d otherwise qualify for one of the rosters; change the account\'s Status there to bring them back.'}
            style={{
              padding: '1px 8px', borderRadius: 999,
              background: '#F1F5F9', border: '1px dashed #CBD5E1', color: '#64748B',
              fontSize: '0.68rem', fontWeight: 700,
            }}
          >
            {categoryCounts.cancelling} at cancelling clients, left out
          </span>
        )}
      </div>
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <label htmlFor="all-contacts-tag-filter" style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 700 }}>Tag:</label>
        <select
          id="all-contacts-tag-filter"
          value={activeTag}
          onChange={e => setTagFilter(e.target.value)}
          title="Show only contacts carrying this tag. Unlike the Tags column filter, this matches a contact by any one of its tags."
          style={{
            padding: '2px 6px', borderRadius: 4,
            border: '1px solid ' + (activeTag ? '#6366F1' : '#CBD5E1'),
            background: activeTag ? '#EEF2FF' : '#fff',
            color: activeTag ? '#3730A3' : '#334155',
            fontSize: '0.7rem', fontWeight: activeTag ? 700 : 400,
            fontFamily: 'inherit', maxWidth: 260,
          }}
        >
          <option value="">All tags</option>
          {tagOptions.map(({ tag, count }) => (
            <option key={tag} value={tag}>{tag} ({count})</option>
          ))}
        </select>
        {activeTag ? (
          <button
            type="button"
            onClick={() => { setTagFilter(''); setTagStatusFilter(new Set()); }}
            title="Clear the tag filter"
            style={{
              padding: '1px 8px', borderRadius: 999,
              border: '1px solid #C7D2FE', background: '#EEF2FF', color: '#3730A3',
              fontSize: '0.68rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
            }}
          >Clear</button>
        ) : null}
        {/* Tag statuses. The answers live per contact per tag, so they only
            mean anything once a tag is chosen — disabled until then rather
            than hidden, so the control doesn't appear out of nowhere. */}
        <span
          style={{ fontSize: '0.7rem', color: activeTag ? '#475569' : '#94A3B8', fontWeight: 700, marginLeft: 6 }}
          title={activeTag ? undefined : 'Pick a tag first — an answer is recorded per contact per tag'}
        >Tag statuses:</span>
        {TAG_STATUSES.map(({ key, label, bg, border, color, tip }) => {
          const on = activeTag && tagStatusFilter.has(key);
          const count = tagStatusCounts[key];
          return (
            <button
              key={key}
              type="button"
              disabled={!activeTag}
              aria-pressed={!!on}
              onClick={() => setTagStatusFilter((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key); else next.add(key);
                return next;
              })}
              title={activeTag
                ? `${tip}. Toggle to show only the answers you pick; with none picked the tag filter behaves as before.`
                : 'Pick a tag first — an answer is recorded per contact per tag'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '1px 8px', borderRadius: 999,
                background: !activeTag ? '#F8FAFC' : on ? color : bg,
                border: `1px solid ${!activeTag ? '#E2E8F0' : on ? color : border}`,
                color: !activeTag ? '#CBD5E1' : on ? '#fff' : color,
                fontSize: '0.68rem', fontWeight: 700, fontFamily: 'inherit',
                cursor: activeTag ? 'pointer' : 'not-allowed',
                boxShadow: on ? `0 0 0 2px ${border}` : 'none',
              }}
            >
              {label}{activeTag ? <span style={{ fontWeight: 800 }}>{count}</span> : null}
            </button>
          );
        })}
      </div>
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
        <>Nothing matched. A contact appears on this page when it would also appear on Key, Active, Client, or Key Prospects. Try the dedicated tabs to see why a specific contact is being filtered out.</>
      }
      contactSelector={combinedSelector}
      categorizeContact={categorizeContact}
      categoryFilter={categoryFilter}
      linkCompanyToProspect
    />
  );
}
