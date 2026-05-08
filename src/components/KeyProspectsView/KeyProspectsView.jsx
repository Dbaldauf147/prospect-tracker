// Key Prospects page — HubSpot contacts at Tier 1 / Tier 2 accounts
// (CDM = me) that are tagged Decision Maker AND whose company has no
// opps on the Opps tab yet. Same layout / interactions as the other
// roster tabs since this is a thin wrapper around KeyContactsView
// with a custom selector.

import { useCallback, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { matchesCdm } from '../../utils/cdmMatch';
import { KeyContactsView, useOppsRecords } from '../KeyContactsView/KeyContactsView';

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

// Shared fuzzy company-name compare so a contact's HubSpot Company
// text doesn't have to exactly match a prospect / opp Account string
// (handles suffix / abbreviation drift).
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

export function KeyProspectsView({ prospects = [], onSelectProspect, settings, updateSettings, cdmName = '' }) {
  const { user } = useAuth();
  const oppsRecords = useOppsRecords(user?.uid);

  // Tier 1 / Tier 2 prospects on this CDM's Table View — the universe
  // a contact's company has to live in to qualify.
  const myTierAccounts = useMemo(() => {
    return (prospects || []).filter(p => {
      if (!matchesCdm(p.cdm, cdmName)) return false;
      const t = (p.tier || '').toLowerCase();
      return t === 'tier 1' || t === 'tier 2';
    });
  }, [prospects, cdmName]);

  // Set of lowercase company names that have ANY opp on the Opps tab —
  // matched both exactly and via the same fuzzy companiesMatch the
  // dedicated Active page uses, so a prospect "Acme Corp" with an opp
  // Account "Acme Corporation" still counts as worked.
  const accountsWithOpps = useMemo(() => {
    const set = new Set();
    if (!oppsRecords) return set;
    for (const r of oppsRecords) {
      const acct = String(r['Account'] || '').trim().toLowerCase();
      if (acct) set.add(acct);
    }
    return set;
  }, [oppsRecords]);

  const oppAccountsArr = useMemo(() => Array.from(accountsWithOpps), [accountsWithOpps]);

  // For each Tier 1/2 prospect, decide if its company has any opp.
  // Cached as a Map<lowercaseCompanyName, hasOpp> so the selector
  // runs in O(1) per contact instead of re-doing the fuzzy scan.
  const tierAccountStatus = useMemo(() => {
    const map = new Map();
    for (const p of myTierAccounts) {
      const lc = String(p.company || '').toLowerCase().trim();
      if (!lc) continue;
      let hasOpp = accountsWithOpps.has(lc);
      if (!hasOpp) {
        for (const acct of oppAccountsArr) {
          if (companiesMatch(p.company, acct)) { hasOpp = true; break; }
        }
      }
      map.set(lc, { tier: p.tier, hasOpp });
    }
    return map;
  }, [myTierAccounts, accountsWithOpps, oppAccountsArr]);

  // Contact selector: Decision Maker at a Tier 1 / Tier 2 account on
  // my CDM whose company has no opps yet. Hide / Left / Schneider are
  // excluded as they are everywhere else in the roster pages.
  const selector = useCallback((c) => {
    const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
    if (tags.includes('hide')) return false;
    if (tags.includes('left')) return false;
    if (isSchneiderContact(c)) return false;
    if (!tags.includes('decision maker')) return false;
    const company = String(c.company || '').trim();
    if (!company) return false;
    const lc = company.toLowerCase();
    const direct = tierAccountStatus.get(lc);
    if (direct) return !direct.hasOpp;
    // Fuzzy: a contact whose Company is "Brookfield Properties" vs a
    // prospect "Brookfield Asset Management" — fall through to the
    // companiesMatch loop. First fuzzy hit wins.
    for (const p of myTierAccounts) {
      if (companiesMatch(p.company, company)) {
        const pLc = String(p.company || '').toLowerCase().trim();
        const status = tierAccountStatus.get(pLc);
        if (status) return !status.hasOpp;
      }
    }
    return false;
  }, [tierAccountStatus, myTierAccounts]);

  const subtitle = (
    <>HubSpot contacts tagged <strong>Decision Maker</strong> at <strong>Tier 1</strong> / <strong>Tier 2</strong> accounts on your Table View (CDM = <strong>{cdmName || '(set your CDM in Settings)'}</strong>) whose company has <strong>no opps yet</strong> on the Opps tab — your warm-but-untouched list. Click a name to open <strong>Edit HubSpot Contact</strong>. Toggle <strong>By Company</strong> to see decision makers grouped by account.</>
  );

  return (
    <KeyContactsView
      prospects={prospects}
      onSelectProspect={onSelectProspect}
      settings={settings}
      updateSettings={updateSettings}
      cdmName={cdmName}
      storagePrefix="key-prospects"
      pageTitle="Key Prospects"
      pageSubtitle={subtitle}
      emptyTitle="No Key Prospects yet"
      emptyDetail={
        <>None of your Tier 1 / Tier 2 accounts have decision-maker contacts without opps. Either every Tier 1 / 2 account already has at least one opp on the Opps tab, or no contacts at those accounts are tagged <code>Decision Maker</code> in HubSpot. Tag a few decision makers and they'll show up here.</>
      }
      contactSelector={selector}
    />
  );
}
