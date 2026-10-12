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
import { makeAccountContactIndex } from './decisionMakerCoverage.js';
import { splitPeOwners } from './peOwners.js';

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

/** Whole days between an activity and now, never negative. */
export function daysSince(tsMs, nowMs = Date.now()) {
  if (tsMs == null) return null;
  return Math.max(0, Math.floor((nowMs - tsMs) / MS_PER_DAY));
}
