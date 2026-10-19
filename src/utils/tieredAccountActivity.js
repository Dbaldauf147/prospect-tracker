// Prospecting > Tiered: your Tier 1-3 accounts and when anything last
// happened on each one.
//
// "Activity" is outreach to a contact at the account, and the newest of
// it wins:
//
//   - HubSpot emails and calls, from the compact email/phone index the
//     Activity tab writes (`hubspot-outreach-index`), looked up for every
//     contact at the account.
//   - HubSpot's own Last Contacted date on those contacts
//     (notes_last_contacted), which also catches meetings and logged
//     activity the index doesn't carry.
//
// BFO Activity rows are deliberately NOT read. They are matched on a fuzzy
// account name, so one Brookfield opportunity dated every Brookfield
// account, and they say nothing about who was reached.
//
// "Contacts at the account" is the same membership the company popup's
// Contacts tab shows (name match, plus whoever it adds by email domain or by
// hand, less anyone removed by hand), via makeAccountContactIndex. Hidden
// and Schneider contacts are skipped: an email between colleagues is not
// activity on the account.

import { TIERS } from '../data/enums.js';
import { matchesCdm } from './cdmMatch.js';
import { applyCompanyOverride, isSchneiderContact, rosterCompaniesMatch } from './contactRosters.js';
import { isDecisionMakerContact, makeAccountContactIndex } from './decisionMakerCoverage.js';
import { splitPeOwners } from './peOwners.js';
import { reportingTier } from './tierSource.js';

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

// Dates arrive as ISO strings or epoch-ish text, sometimes with a time. A bare ISO day is read as local midnight rather
// than UTC, so it doesn't show as the day before west of Greenwich.
function parseWhen(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = iso ? new Date(+iso[1], +iso[2] - 1, +iso[3]).getTime() : Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/**
 * This CDM's accounts that carry Tier 1, 2 or 3, in tier then name order.
 * An own target (Not on tier list, but Dan target) counts as Tier 3.
 */
export function myTieredAccounts(prospects, cdmName) {
  return (prospects || [])
    .filter(p => p?.company && matchesCdm(p.cdm, cdmName) && TIERS.includes(reportingTier(p)))
    .sort((a, b) => TIERS.indexOf(reportingTier(a)) - TIERS.indexOf(reportingTier(b))
      || String(a.company).localeCompare(String(b.company)));
}

/**
 * The newest activity on each account.
 *
 * Returns Map(account id or company -> { tsMs, source, detail, contact })
 * holding only the accounts something was found for. `contact` is the
 * person at the account most recently emailed, called or contacted in
 * HubSpot ({ id, name, email, company, owner, tsMs, source }). `owner` is
 * the account's PE owner / parent company when that is the company the
 * contact is actually at (see ownerVia), else ''. `outreachIndex` is the
 * parsed `hubspot-outreach-index` ({ emails, phones }), or null.
 */
export function lastActivityByAccount({
  accounts, contacts, outreachIndex = null,
  localFields = null, links = null, exclusions = null,
} = {}) {
  const out = new Map();
  const keyOf = (p) => p.id || p.company;
  const consider = (p, tsMs, source, contact) => {
    if (tsMs == null) return;
    const k = keyOf(p);
    const prev = out.get(k);
    if (prev && tsMs <= prev.tsMs) return;
    const company = String(contact.company || '').trim();
    out.set(k, {
      tsMs,
      source,
      detail: nameOf(contact),
      contact: {
        id: idOf(contact), name: nameOf(contact), email: String(contact.email || '').trim(),
        company, owner: ownerVia(p, company), tsMs, source,
      },
    });
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
      if (hitE) consider(p, hitE.tsMs ?? parseWhen(hitE.ts), 'HubSpot email', c);
      for (const ph of [c.phone, c.mobilephone]) {
        const hitP = phones[normalizePhone(ph)];
        if (hitP) consider(p, hitP.tsMs ?? parseWhen(hitP.ts), 'HubSpot call', c);
      }
      consider(p, parseWhen(c.notes_last_contacted), 'HubSpot last contacted', c);
    }
  }
  return out;
}

// A company name boiled down for comparing: lower case, corporate suffixes
// and punctuation gone, so "Brookfield (Self Storage)" and "Brookfield Self
// Storage, LLC" read the same.
const plain = (s) => String(s || '').toLowerCase()
  .replace(/\b(inc|llc|ltd|corp|co|lp)\b\.?/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The account's PE owner / parent company (its PE Owner field) that a
 * contact is really at, or '' when the contact is at the account itself.
 *
 * The contact is tied to the account by a loose name match, which is how a
 * contact at "Brookfield" lands on "Brookfield (Self Storage)". When that
 * contact's company is one of the account's owners and is not simply the
 * account's own name, the activity came through the owner.
 */
export function ownerVia(account, contactCompany) {
  const cc = plain(contactCompany);
  if (!cc) return '';
  const own = plain(account?.company);
  if (cc === own) return '';
  for (const o of splitPeOwners(account?.peOwner)) {
    const po = plain(o);
    if (!po) continue;
    if (cc === po) return o;
    if (!cc.includes(own) && rosterCompaniesMatch(o, contactCompany)) return o;
  }
  return '';
}

// The window the Tiered Activity summary counts an account as touched in.
export const ACTIVITY_SUMMARY_DAYS = 60;

/**
 * Per tier, how many accounts had any activity in the last `days` days:
 * [{ tier, total, active, pct }] for Tier 1, 2 and 3 in order. `pct` is
 * a whole percentage, null for a tier with no accounts. `activity` is the
 * lastActivityByAccount map; an account missing from it had none.
 */
export function tierActivityCoverage(accounts, activity, { days = ACTIVITY_SUMMARY_DAYS, nowMs = Date.now() } = {}) {
  return TIERS.map((tier) => {
    const inTier = (accounts || []).filter(p => reportingTier(p) === tier);
    const active = inTier.filter((p) => {
      const a = activity?.get(p.id || p.company);
      const d = a ? daysSince(a.tsMs, nowMs) : null;
      return d != null && d <= days;
    }).length;
    return { tier, total: inTier.length, active, pct: inTier.length ? Math.round((active / inTier.length) * 100) : null };
  });
}

/** Whole days between an activity and now, never negative. */
export function daysSince(tsMs, nowMs = Date.now()) {
  if (tsMs == null) return null;
  return Math.max(0, Math.floor((nowMs - tsMs) / MS_PER_DAY));
}

// --- firms active in the last 120 days, tiered or not -------------------------
//
// The Prospecting History chart of how many of your firms had any activity
// in a fixed 120 days, per tier with the untiered ones as a fourth bucket.
// Same "activity" as everything above. A fixed window rather than the
// tiles' Active within choice, so the bars stay comparable day to day.

export const ACTIVE_FIRMS_DAYS = 120;
export const NOT_TIERED = 'Not tiered';
export const ACTIVE_FIRM_BUCKETS = [...TIERS, NOT_TIERED];

/** Which ACTIVE_FIRM_BUCKETS entry an account counts under. */
export function firmBucket(p) {
  const t = reportingTier(p);
  return TIERS.includes(t) ? t : NOT_TIERED;
}

/** Every account on this CDM, tiered or not. */
export function myAccounts(prospects, cdmName) {
  return (prospects || []).filter(p => p?.company && matchesCdm(p.cdm, cdmName));
}

/**
 * Per bucket, how many of `accounts` had activity in the last `days` days:
 * { 'Tier 1': { active, total }, ..., 'Not tiered': { active, total } }.
 *
 * Only contacts with something inside the window are matched to accounts.
 * The answer is the same (an account's newest activity inside the window
 * came from one of them) and it keeps the fuzzy company match off the
 * thousands of contacts nobody has written to lately, which matters once
 * every untiered account is in the list too.
 */
export function activeFirmsByBucket({
  accounts, contacts, outreachIndex = null, localFields = null, links = null, exclusions = null,
  days = ACTIVE_FIRMS_DAYS, nowMs = Date.now(),
} = {}) {
  const emails = outreachIndex?.emails || {};
  const phones = outreachIndex?.phones || {};
  const inWindow = (ts) => {
    const d = daysSince(ts, nowMs);
    return d != null && d <= days;
  };
  const recent = (contacts || []).filter((c) => {
    const em = String(c?.email || '').trim().toLowerCase();
    const hitE = em ? emails[em] : null;
    if (hitE && inWindow(hitE.tsMs ?? parseWhen(hitE.ts))) return true;
    for (const ph of [c?.phone, c?.mobilephone]) {
      const hitP = phones[normalizePhone(ph)];
      if (hitP && inWindow(hitP.tsMs ?? parseWhen(hitP.ts))) return true;
    }
    return inWindow(parseWhen(c?.notes_last_contacted));
  });
  const activity = lastActivityByAccount({ accounts, contacts: recent, outreachIndex, localFields, links, exclusions });
  const out = Object.fromEntries(ACTIVE_FIRM_BUCKETS.map(b => [b, { active: 0, total: 0 }]));
  for (const p of (accounts || [])) {
    const slot = out[firmBucket(p)];
    slot.total += 1;
    const a = activity.get(p.id || p.company);
    if (a && inWindow(a.tsMs)) slot.active += 1;
  }
  return out;
}

// ── Contact rosters: who has had activity lately ────────────────────────
//
// Prospecting > History charts, for three lists of people, how many have
// had activity in the last 30, 60, 90 and 120 days (all four are recorded;
// the charts show 30, 90 and 120 and the share with none in 120). "Activity" is the same
// outreach the account-level reading above counts, taken per contact: a
// HubSpot email or call from the outreach index, or HubSpot's Last
// Contacted date - whichever is newest.

export const ROSTER_ACTIVITY_WINDOWS = [30, 60, 90, 120];

/** The newest outreach to one contact, in ms, or null when there's none. */
export function contactLastOutreachMs(c, outreachIndex = null) {
  let best = null;
  const take = (ms) => { if (ms != null && (best == null || ms > best)) best = ms; };
  const em = String(c?.email || '').trim().toLowerCase();
  const hitE = em ? outreachIndex?.emails?.[em] : null;
  if (hitE) take(hitE.tsMs ?? parseWhen(hitE.ts));
  for (const ph of [c?.phone, c?.mobilephone]) {
    const n = normalizePhone(ph);
    const hitP = n ? outreachIndex?.phones?.[n] : null;
    if (hitP) take(hitP.tsMs ?? parseWhen(hitP.ts));
  }
  take(parseWhen(c?.notes_last_contacted));
  return best;
}

/**
 * Per roster, how many contacts had activity within each window:
 * [{ key, label, total, windows: [{ days, active, pct }] }] for Dan Key
 * Target, Dan Key Prospect and Decision Makers, in that order.
 *
 * The lists are the contacts pages' own: `gates` is makeRosterGates (the
 * Key and Key Prospect gates, and the cancelling / Don't Track client
 * exclusion every roster applies), `myCdmGate` is the Decision Makers
 * page's "at one of my accounts" gate. `pct` is a whole percentage, null
 * for a roster with nobody on it.
 */
export function rosterActivityCounts({
  contacts, gates, myCdmGate = null, outreachIndex = null, localFields = null,
  windows = ROSTER_ACTIVITY_WINDOWS, nowMs = Date.now(),
} = {}) {
  const rosters = rosterDefs(gates, myCdmGate);
  const tally = rosters.map(() => ({ total: 0, active: windows.map(() => 0) }));
  if (!gates) return finish();
  const cutoffs = windows.map(d => nowMs - d * MS_PER_DAY);
  eachRosterMember({ contacts, gates, rosters, outreachIndex, localFields }, (i, _c, ts) => {
    tally[i].total += 1;
    cutoffs.forEach((cut, w) => { if (ts != null && ts >= cut) tally[i].active[w] += 1; });
  });
  return finish();

  function finish() {
    return rosters.map((r, i) => ({
      key: r.key,
      label: r.label,
      total: tally[i].total,
      windows: windows.map((days, w) => ({
        days,
        active: tally[i].active[w],
        pct: tally[i].total ? Math.round((tally[i].active[w] / tally[i].total) * 100) : null,
      })),
    }));
  }
}

// The three rosters and who is on each, shared by the counts above and the
// people list below so the two can't disagree.
function rosterDefs(gates, myCdmGate) {
  return [
    { key: 'keyTarget', label: 'Dan Key Target', on: (c) => gates.gateFor.key(c) },
    { key: 'keyProspect', label: 'Dan Key Prospect', on: (c) => gates.gateFor.keyProspect(c) },
    { key: 'decisionMakers', label: 'Decision Makers', on: (c, raw) => isDecisionMakerContact(raw) && (!myCdmGate || myCdmGate(raw)) },
  ];
}

// Calls visit(rosterIndex, contact, lastOutreachMs) for every person on
// every roster, client exclusions left out.
function eachRosterMember({ contacts, gates, rosters, outreachIndex, localFields }, visit) {
  for (const raw of (contacts || [])) {
    const c = localFields ? applyCompanyOverride(raw, localFields) : raw;
    let ts;
    let excluded;
    rosters.forEach((r, i) => {
      if (!r.on(c, raw)) return;
      if (excluded === undefined) excluded = !!gates.clientExclusionOf(c);
      if (excluded) return;
      if (ts === undefined) ts = contactLastOutreachMs(c, outreachIndex);
      visit(i, c, ts);
    });
  }
}

/**
 * Per roster, the people rosterActivityCounts counts:
 * [{ key, label, people: [{ contact, lastMs }] }], in the same order.
 * What the History charts' Excel download lists.
 */
export function rosterActivityPeople({ contacts, gates, myCdmGate = null, outreachIndex = null, localFields = null } = {}) {
  const rosters = rosterDefs(gates, myCdmGate);
  const people = rosters.map(() => []);
  if (gates) eachRosterMember({ contacts, gates, rosters, outreachIndex, localFields }, (i, contact, lastMs) => people[i].push({ contact, lastMs }));
  return rosters.map((r, i) => ({ key: r.key, label: r.label, people: people[i] }));
}
