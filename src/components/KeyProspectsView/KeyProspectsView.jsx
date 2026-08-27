// Key Prospects page — HubSpot contacts at Tier 1 / Tier 2 accounts
// (CDM = me) that are tagged Decision Maker AND whose company has no
// opps on the Opps tab yet. Same layout / interactions as the other
// roster tabs since this is a thin wrapper around KeyContactsView
// with a custom selector.
//
// A gap-report banner above the table also surfaces the inverse list:
// Tier 1 / Tier 2 accounts (CDM = me) that have ZERO opps AND ZERO
// decision-maker contacts on this tab — the truly-untouched accounts
// where the next step is to find / tag a decision maker.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { matchesCdm } from '../../utils/cdmMatch';
import { KeyContactsView, useOppsRecords } from '../KeyContactsView/KeyContactsView';
import { getHubspotCache } from '../../utils/hubspotContactsCache';

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

export function KeyProspectsView({ prospects = [], onSelectProspect, settings, updateSettings, updateSettingsPath, cdmName = '' }) {
  const { user } = useAuth();
  const oppsRecords = useOppsRecords(user?.uid);

  // HubSpot cache, refreshed on cache-update events. Used by the gap
  // report below to figure out which Tier 1 / Tier 2 accounts have no
  // decision-maker contacts on this page.
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

  // Tier 1 / Tier 2 prospects on this CDM's Table View — the universe
  // a contact's company has to live in to qualify.
  const myTierAccounts = useMemo(() => {
    return (prospects || []).filter(p => {
      if (!matchesCdm(p.cdm, cdmName)) return false;
      // Clients aren't prospects — keep them off the warm-but-untouched list.
      if (p.status === 'Client') return false;
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

  // Set of lowercase company strings (taken from passing-the-selector
  // HubSpot contacts) representing Tier 1 / Tier 2 accounts that DO
  // have a decision-maker contact tagged in HubSpot. Used by both the
  // missing-DM banner and the untouched-account banner below.
  const localFields = settings?.contactLocalFields || {};
  const passingDmContacts = useMemo(() => {
    const out = [];
    for (const baseC of hubspotContacts) {
      const lf = localFields[String(baseC.id || baseC.vid || '')] || null;
      const c = lf && typeof lf._companyOverride === 'string' && lf._companyOverride
        ? { ...baseC, company: lf._companyOverride }
        : baseC;
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('hide') || tags.includes('left')) continue;
      if (isSchneiderContact(c)) continue;
      if (!tags.includes('decision maker')) continue;
      const company = String(c.company || '').trim();
      if (!company) continue;
      out.push({ company, lc: company.toLowerCase() });
    }
    return out;
  }, [hubspotContacts, localFields]);

  function accountHasDm(p) {
    const pLc = String(p.company || '').toLowerCase().trim();
    if (!pLc) return false;
    for (const c of passingDmContacts) {
      if (c.lc === pLc) return true;
      if (companiesMatch(p.company, c.company)) return true;
    }
    return false;
  }

  // Tier 1 / Tier 2 accounts (CDM = me) with no decision-maker contact
  // tagged in HubSpot — regardless of whether the account has opps.
  // Broader than untouchedAccounts below; surfaces accounts where the
  // user is missing a Decision Maker tag even on actively-worked
  // companies, so they can go fix the tagging.
  const accountsMissingDm = useMemo(() => {
    if (myTierAccounts.length === 0) return [];
    const out = [];
    for (const p of myTierAccounts) {
      if (accountHasDm(p)) continue;
      const pLc = String(p.company || '').toLowerCase().trim();
      const status = tierAccountStatus.get(pLc);
      out.push({ ...p, _hasOpp: !!status?.hasOpp });
    }
    out.sort((a, b) => {
      const tierA = (a.tier || '').toLowerCase();
      const tierB = (b.tier || '').toLowerCase();
      if (tierA !== tierB) return tierA.localeCompare(tierB);
      return String(a.company || '').localeCompare(String(b.company || ''));
    });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTierAccounts, tierAccountStatus, passingDmContacts]);

  // Tier 1 / Tier 2 accounts (CDM = me) with NO opps AND no contact on
  // this tab — i.e. no decision-maker contact whose Company resolves
  // (exact or fuzzy) to this prospect. Strict subset of the missing-DM
  // list — the truly-untouched accounts.
  const untouchedAccounts = useMemo(() => {
    if (myTierAccounts.length === 0) return [];
    const out = [];
    for (const p of myTierAccounts) {
      const pLc = String(p.company || '').toLowerCase().trim();
      if (!pLc) continue;
      const status = tierAccountStatus.get(pLc);
      if (status?.hasOpp) continue;
      if (accountHasDm(p)) continue;
      out.push(p);
    }
    out.sort((a, b) => {
      const tierA = (a.tier || '').toLowerCase();
      const tierB = (b.tier || '').toLowerCase();
      if (tierA !== tierB) return tierA.localeCompare(tierB);
      return String(a.company || '').localeCompare(String(b.company || ''));
    });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTierAccounts, tierAccountStatus, passingDmContacts]);

  const [gapOpen, setGapOpen] = useState(false);
  const [missingDmOpen, setMissingDmOpen] = useState(false);

  const subtitle = (
    <>
      {accountsMissingDm.length > 0 && (
        <div style={{ margin: '6px 0 8px', padding: '0.5rem 0.7rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 6 }}>
          <button
            type="button"
            onClick={() => setMissingDmOpen(o => !o)}
            style={{ background: 'transparent', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: '0.72rem', color: '#991B1B', fontWeight: 700, cursor: 'pointer' }}
            title="Tier 1 / Tier 2 accounts on your Table View where no contact at the company is tagged Decision Maker. Tag a decision maker in HubSpot to clear the row."
          >
            {missingDmOpen ? '▾' : '▸'} {accountsMissingDm.length} Tier 1 / 2 account{accountsMissingDm.length === 1 ? '' : 's'} with no Decision Maker tagged
          </button>
          {missingDmOpen && (
            <div style={{ marginTop: '0.4rem', maxHeight: 280, overflowY: 'auto', background: '#fff', border: '1px solid #FCA5A5', borderRadius: 4 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px', padding: '0.25rem 0.6rem', background: '#FEF2F2', borderBottom: '1px solid #FCA5A5', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#991B1B', position: 'sticky', top: 0 }}>
                <div>Account</div>
                <div style={{ textAlign: 'right' }}>Tier</div>
                <div style={{ textAlign: 'right' }}>Has Opps?</div>
              </div>
              {accountsMissingDm.map(p => (
                <div
                  key={p.id || p.company}
                  onClick={() => onSelectProspect && onSelectProspect(p)}
                  style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px', padding: '0.3rem 0.6rem', borderTop: '1px solid #FEE2E2', fontSize: '0.74rem', cursor: onSelectProspect ? 'pointer' : 'default' }}
                  title={onSelectProspect ? `Open ${p.company} on the Table View` : p.company}
                >
                  <div style={{ color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.company || '(unnamed prospect)'}</div>
                  <div style={{ textAlign: 'right', fontWeight: 600, color: '#7C2D12' }}>{p.tier || '-'}</div>
                  <div style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.66rem', color: p._hasOpp ? '#166534' : '#94A3B8' }}>{p._hasOpp ? 'Yes' : 'No'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {untouchedAccounts.length > 0 && (
        <div style={{ margin: '6px 0 8px', padding: '0.5rem 0.7rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6 }}>
          <button
            type="button"
            onClick={() => setGapOpen(o => !o)}
            style={{ background: 'transparent', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: '0.72rem', color: '#92400E', fontWeight: 700, cursor: 'pointer' }}
            title="Tier 1 / Tier 2 accounts with no opps and no decision-maker contact on this tab. These are the truly-untouched accounts."
          >
            {gapOpen ? '▾' : '▸'} {untouchedAccounts.length} Tier 1 / 2 account{untouchedAccounts.length === 1 ? '' : 's'} with no opps and no decision-maker contact
          </button>
          {gapOpen && (
            <div style={{ marginTop: '0.4rem', maxHeight: 280, overflowY: 'auto', background: '#fff', border: '1px solid #FDE68A', borderRadius: 4 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', padding: '0.25rem 0.6rem', background: '#FFFBEB', borderBottom: '1px solid #FDE68A', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#92400E', position: 'sticky', top: 0 }}>
                <div>Account</div>
                <div style={{ textAlign: 'right' }}>Tier</div>
              </div>
              {untouchedAccounts.map(p => (
                <div
                  key={p.id || p.company}
                  onClick={() => onSelectProspect && onSelectProspect(p)}
                  style={{ display: 'grid', gridTemplateColumns: '1fr 80px', padding: '0.3rem 0.6rem', borderTop: '1px solid #FEF3C7', fontSize: '0.74rem', cursor: onSelectProspect ? 'pointer' : 'default' }}
                  title={onSelectProspect ? `Open ${p.company} on the Table View` : p.company}
                >
                  <div style={{ color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.company || '(unnamed prospect)'}</div>
                  <div style={{ textAlign: 'right', fontWeight: 600, color: '#7C2D12' }}>{p.tier || '-'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      HubSpot contacts tagged <strong>Decision Maker</strong> at <strong>Tier 1</strong> / <strong>Tier 2</strong> accounts on your Table View (CDM = <strong>{cdmName || '(set your CDM in Settings)'}</strong>) whose company has <strong>no opps yet</strong> on the Opps tab: your warm-but-untouched list. Click a name to open <strong>Edit HubSpot Contact</strong>. Toggle <strong>By Company</strong> to see decision makers grouped by account.
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
      storagePrefix="key-prospects"
      pageTitle="Key Prospects"
      pageSubtitle={subtitle}
      emptyTitle="No Key Prospects yet"
      emptyDetail={
        <>None of your Tier 1 / Tier 2 accounts have decision-maker contacts without opps. Either every Tier 1 / 2 account already has at least one opp on the Opps tab, or no contacts at those accounts are tagged <code>Decision Maker</code> in HubSpot. Tag a few decision makers and they'll show up here.</>
      }
      contactSelector={selector}
      defaultViewMode="companies"
    />
  );
}
