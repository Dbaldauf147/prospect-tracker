// Prospecting > Tiered: your Tier 1-3 accounts and when anything last
// happened on each one.
//
// "Activity" is read from every place the app already records it against
// a company, and the newest of them wins:
//
//   - HubSpot emails and calls, from the compact email/phone index the
//     Activity tab writes (`hubspot-outreach-index`), looked up for every
//     contact at the account.
//   - HubSpot's own Last Contacted date on those contacts
//     (notes_last_contacted), which also catches meetings and logged
//     activity the index doesn't carry.
//   - The BFO Activity tab's Last Activity date, for any pasted row whose
//     Account is this account (by its name or its BFO Company Name).
//
// "Contacts at the account" is the same membership the company popup's
// Contacts tab shows (name match, plus whoever it adds by email domain or by
// hand, less anyone removed by hand), via makeAccountContactIndex. Hidden
// and Schneider contacts are skipped: an email between colleagues is not
// activity on the account.

import { TIERS } from '../data/enums.js';
import { matchesCdm } from './cdmMatch.js';
import { applyCompanyOverride, isSchneiderContact, rosterCompaniesMatch } from './contactRosters.js';
import { makeAccountContactIndex } from './decisionMakerCoverage.js';

const MS_PER_DAY = 86400000;

// How long since the last activity before the row reads as going cold, and
// then as cold. Used for the Days Since colour.
export const ACTIVITY_WARM_DAYS = 30;
export const ACTIVITY_COLD_DAYS = 90;

const tagsOf = (c) => String(c?.dans_tags || c?.dan_s_tags || c?.dans_tag || '').toLowerCase();
const idOf = (c) => String(c?.id || c?.vid || '');
const nameOf = (c) => [c?.firstname, c?.lastname].filter(Boolean).join(' ').trim() || String(c?.email || '');

function normalizePhone(p) {
  const digits = String(p || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

// Pasted dates arrive in whatever shape BFO exported them (M/D/YYYY, ISO,
// sometimes with a time). A bare ISO day is read as local midnight rather
// than UTC, so it doesn't show as the day before west of Greenwich.
function parseWhen(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = iso ? new Date(+iso[1], +iso[2] - 1, +iso[3]).getTime() : Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** This CDM's accounts that carry Tier 1, 2 or 3, in tier then name order. */
export function myTieredAccounts(prospects, cdmName) {
  return (prospects || [])
    .filter(p => p?.company && matchesCdm(p.cdm, cdmName) && TIERS.includes(String(p.tier || '').trim()))
    .sort((a, b) => TIERS.indexOf(String(a.tier).trim()) - TIERS.indexOf(String(b.tier).trim())
      || String(a.company).localeCompare(String(b.company)));
}

/**
 * The newest activity on each account.
 *
 * Returns Map(account id or company -> { tsMs, source, detail }) holding
 * only the accounts something was found for. `outreachIndex` is the parsed
 * `hubspot-outreach-index` ({ emails, phones }); `bfoActivity` the BFO
 * Activity record ({ headers, rows }). Either may be null.
 */
export function lastActivityByAccount({
  accounts, contacts, outreachIndex = null, bfoActivity = null,
  localFields = null, links = null, exclusions = null,
} = {}) {
  const out = new Map();
  const keyOf = (p) => p.id || p.company;
  const consider = (p, tsMs, source, detail) => {
    if (tsMs == null) return;
    const k = keyOf(p);
    const prev = out.get(k);
    if (!prev || tsMs > prev.tsMs) out.set(k, { tsMs, source, detail });
  };

  // Contacts grouped by company so the fuzzy compare runs once per distinct
  // company rather than once per contact.
  const byCompany = new Map();
  const usable = (c) => c && !tagsOf(c).includes('hide') && !isSchneiderContact(c);
  for (const raw of (contacts || [])) {
    const c = applyCompanyOverride(raw, localFields);
    if (!usable(c)) continue;
    const company = String(c.company || '').trim();
    if (!company) continue;
    const lc = company.toLowerCase();
    const at = byCompany.get(lc);
    if (at) at.contacts.push(c);
    else byCompany.set(lc, { company, lc, contacts: [c] });
  }
  const groups = [...byCompany.values()];
  const index = makeAccountContactIndex(contacts || [], { localFields, links, exclusions });
  const emails = outreachIndex?.emails || {};
  const phones = outreachIndex?.phones || {};

  for (const p of (accounts || [])) {
    const lc = String(p.company || '').toLowerCase().trim();
    const excluded = index.excludedFor(p);
    const seen = new Set();
    const at = [];
    const add = (c) => {
      const id = idOf(c);
      if (id && (seen.has(id) || excluded.has(id))) return;
      if (id) seen.add(id);
      at.push(c);
    };
    for (const g of groups) {
      if (g.lc === lc || rosterCompaniesMatch(p.company, g.company)) g.contacts.forEach(add);
    }
    for (const c of index.extraFor(p)) if (usable(c)) add(c);

    for (const c of at) {
      const em = String(c.email || '').trim().toLowerCase();
      const hitE = em ? emails[em] : null;
      if (hitE) consider(p, hitE.tsMs ?? parseWhen(hitE.ts), 'HubSpot email', nameOf(c));
      for (const ph of [c.phone, c.mobilephone]) {
        const hitP = phones[normalizePhone(ph)];
        if (hitP) consider(p, hitP.tsMs ?? parseWhen(hitP.ts), 'HubSpot call', nameOf(c));
      }
      consider(p, parseWhen(c.notes_last_contacted), 'HubSpot last contacted', nameOf(c));
    }
  }

  // BFO Activity rows, matched on their Account column.
  const headers = bfoActivity?.headers || [];
  const actCol = headers.find(h => /last\s*activity/i.test(h));
  const acctCol = headers.find(h => /^account(\s*name)?$/i.test(String(h).trim()))
    || headers.find(h => /account/i.test(h));
  const oppCol = headers.find(h => /opportunity\s*name/i.test(h));
  if (actCol && acctCol) {
    const latestByAccount = new Map();
    for (const r of (bfoActivity?.rows || [])) {
      const acct = String(r[acctCol] ?? '').trim();
      const tsMs = parseWhen(r[actCol]);
      if (!acct || tsMs == null) continue;
      const lc = acct.toLowerCase();
      const prev = latestByAccount.get(lc);
      if (!prev || tsMs > prev.tsMs) latestByAccount.set(lc, { acct, tsMs, opp: oppCol ? String(r[oppCol] ?? '').trim() : '' });
    }
    const bfoAccounts = [...latestByAccount.values()];
    for (const p of (accounts || [])) {
      const names = [p.company, p.bfoCompanyName].map(s => String(s || '').trim()).filter(Boolean);
      for (const b of bfoAccounts) {
        if (names.some(n => rosterCompaniesMatch(n, b.acct))) consider(p, b.tsMs, 'BFO activity', b.opp || b.acct);
      }
    }
  }
  return out;
}

/** Whole days between an activity and now, never negative. */
export function daysSince(tsMs, nowMs = Date.now()) {
  if (tsMs == null) return null;
  return Math.max(0, Math.floor((nowMs - tsMs) / MS_PER_DAY));
}
